// 使いすぎ番：社員・道具と AI の会社（Anthropic / OpenAI 互換）の間に置く、小さな中継。依存なし（node の標準だけ）。
//
// 1 回の依頼の流れ：
//   社員の鍵を確かめる → 本文を読む → 単価の分かるモデルか → 遮断中でないか → 出力の上限を下げる
//   → 送る前に個人情報・鍵を伏せる → 見込みの金額を出す → 会社・人・道具の「日」「月」の上限に収まるなら予約（await なし）
//   → 会社の API キーに付け替えて送る（社員の鍵は外へ出さない）→ 返事をそのまま流す（逐次の返事も 1 かたまりずつ）
//   → 返事の使用量で実際の金額を出して記録の鎖に書く（本文は書かない）→ 予約を外す → 8 割・上限で知らせる
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ledger, breakerIsOpen, breakerNext, costMilliYen, estimateInputTokens, fmtYen, periodsOf, priceFor } from './budget.mjs';
import { UsageChain } from './chain.mjs';
import { ConfigStore, newSecret } from './store.mjs';
import { redactBody } from './redactBody.mjs';
import { monthlyReport } from './report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(HERE, '..', 'web');

const ROUTES = {
  '/anthropic/v1/messages': { provider: 'anthropic', upstreamPath: '/v1/messages' },
  '/openai/v1/chat/completions': { provider: 'openai', upstreamPath: '/v1/chat/completions' },
};

const SCOPE_JA = { company: '会社全体', person: '人', tool: '道具' };
const SPAN_JA = { day: '今日', month: '今月' };

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const SEC_HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'cache-control': 'no-store' };

function cleanName(s) {
  const v = String(s ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f<>"'`]/g, '').trim();
  return v.length >= 1 && v.length <= 40 ? v : null;
}
function yenOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100_000_000 ? n : undefined;
}

/** 返事の使用量（Anthropic / OpenAI の形）を {input, output, cacheWrite, cacheRead} にそろえる。 */
function usageFrom(provider, u, cur = {}) {
  if (!u || typeof u !== 'object') return cur;
  if (provider === 'anthropic') {
    const o = { ...cur };
    if (Number.isFinite(u.input_tokens)) o.input = u.input_tokens;
    if (Number.isFinite(u.output_tokens)) o.output = u.output_tokens;
    if (Number.isFinite(u.cache_creation_input_tokens)) o.cacheWrite = u.cache_creation_input_tokens;
    if (Number.isFinite(u.cache_read_input_tokens)) o.cacheRead = u.cache_read_input_tokens;
    return o;
  }
  // OpenAI：割引のある cached_tokens も満額で数える（多め＝安全側）
  return { ...cur, ...(Number.isFinite(u.prompt_tokens) ? { input: u.prompt_tokens } : {}), ...(Number.isFinite(u.completion_tokens) ? { output: u.completion_tokens } : {}) };
}

/** 逐次の返事（SSE）を 1 かたまりずつ読み、使用量だけを拾う。中身はそのまま社員へ流す。 */
function sseUsageParser(provider) {
  const dec = new TextDecoder();
  let buf = '';
  let usage = {};
  const onEvent = (block) => {
    const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let j; try { j = JSON.parse(data); } catch { return; }
    if (provider === 'anthropic') {
      if (j.type === 'message_start') usage = usageFrom(provider, j.message?.usage, usage);
      if (j.type === 'message_delta') usage = usageFrom(provider, j.usage, usage);
    } else if (j.usage) usage = usageFrom(provider, j.usage, usage);
  };
  return {
    push(chunk) {
      buf += dec.decode(chunk, { stream: true });
      let m;
      while ((m = /\r?\n\r?\n/.exec(buf))) { onEvent(buf.slice(0, m.index)); buf = buf.slice(m.index + m[0].length); }
    },
    end() { buf += dec.decode(); if (buf.trim()) onEvent(buf); buf = ''; return usage; },
    get usage() { return usage; },
  };
}

function errorBody(provider, status, type, message) {
  return provider === 'anthropic'
    ? { type: 'error', error: { type, message } }
    : { error: { message, type, code: type } };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0; let over = false;
    req.on('data', (c) => { size += c.length; if (size > limit) over = true; else chunks.push(c); });
    req.on('end', () => (over ? reject(Object.assign(new Error('too large'), { status: 413 })) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

export function createGateway(opts = {}) {
  const dataDir = opts.dataDir || path.join(HERE, '..', 'data');
  const store = new ConfigStore(dataDir);
  const chain = new UsageChain(dataDir);
  const ledger = new Ledger();
  const upstreams = { anthropic: 'https://api.anthropic.com', openai: 'https://api.openai.com', ...(opts.upstreams || {}) };
  const keys = opts.keys || { anthropic: process.env.TSUKAISUGI_ANTHROPIC_KEY || '', openai: process.env.TSUKAISUGI_OPENAI_KEY || '' };
  const now = opts.now || (() => Date.now());
  const breakers = { anthropic: { fails: 0, openUntil: 0 }, openai: { fails: 0, openUntil: 0 } };
  let firstAdminKey = null;
  if (opts.adminKey) store.setAdminKey(opts.adminKey);
  else if (!store.data.adminKeyHash) { firstAdminKey = newSecret('adm_'); store.setAdminKey(firstAdminKey); }

  // 記録の鎖から今日・今月の使用量と、出した知らせを戻す（記録が正。設定のファイルには金額を持たない）
  for (const r of chain.readRows()) {
    if (r.type === 'use' && r.costMilliYen) ledger.add(r.person, r.tool, r.costMilliYen, Date.parse(r.ts));
    if (r.type === 'alert' && r.alertKey) ledger.alerted.add(r.alertKey);
  }

  const capOf = (scope, name, span) => store.capMilli(scope, name, span);
  const log = (body) => chain.append({ ts: new Date(now()).toISOString(), ...body });

  function checkAlerts(person, tool, at) {
    for (const k of Ledger.keysFor(person, tool, at)) {
      const cap = capOf(k.scope, k.name, k.span);
      if (!cap) continue;
      const used = ledger.usedOf(k.key);
      for (const ratio of store.data.settings.alertRatios) {
        const ak = `${k.key}|${ratio}`;
        if (used >= cap * ratio && !ledger.alerted.has(ak)) {
          ledger.alerted.add(ak);
          const who = k.scope === 'company' ? '会社全体' : `${SCOPE_JA[k.scope]}「${k.name}」`;
          log({ type: 'alert', alertKey: ak, scope: k.scope, name: k.name, span: k.span, period: k.period, ratio, usedMilliYen: used, capMilliYen: cap,
            note: `${who}の${SPAN_JA[k.span]}の使用が上限の ${Math.round(ratio * 100)}% に達しました（${fmtYen(used)} ／ 上限 ${fmtYen(cap)}）` });
        }
      }
    }
  }

  function send(res, status, obj, extra = {}) {
    const s = JSON.stringify(obj);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(s), ...SEC_HEADERS, ...extra });
    res.end(s);
  }

  // ---------------- 中継 ----------------
  async function handleProxy(req, res, route) {
    const { provider, upstreamPath } = route;
    const started = now();
    const auth = String(req.headers.authorization || '');
    const tokenStr = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : String(req.headers['x-api-key'] || '').trim();
    const rec = store.findToken(tokenStr);
    if (!rec) return send(res, 401, errorBody(provider, 401, 'authentication_error', '使いすぎ番：鍵が違うか、無効にされています。管理者に鍵の発行を頼んでください。'));
    const { person, tool } = rec;
    const refuse = (status, type, msg, extra = {}) => {
      log({ type: 'refused', person, tool, provider, model: extra.model, reason: type, note: msg, ...(extra.redacted ? { redacted: extra.redacted } : {}) });
      return send(res, status, errorBody(provider, status, type, '使いすぎ番：' + msg));
    };

    let body;
    try { body = JSON.parse((await readBody(req, store.data.settings.maxBodyBytes)).toString('utf8')); }
    catch (e) { return e.status === 413 ? refuse(413, 'request_too_large', '本文が大きすぎます。') : send(res, 400, errorBody(provider, 400, 'invalid_request_error', '使いすぎ番：本文が JSON ではありません。')); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, errorBody(provider, 400, 'invalid_request_error', '使いすぎ番：本文の形が違います。'));

    const model = String(body.model || '');
    const price = priceFor(store.data.prices, model);
    if (!price) return refuse(400, 'unknown_model_price', `モデル「${model.slice(0, 60)}」の単価が登録されていないので送りません（上限を守れないため）。管理画面の「単価」で登録してください。`, { model });
    if (breakerIsOpen(breakers[provider], now())) return refuse(503, 'circuit_open', `${provider} への送信が続けて失敗したので、しばらく止めています（自動で再開します）。`, { model });
    if (!keys[provider]) return refuse(500, 'no_company_key', `会社の ${provider} の API キーが設定されていません（環境変数）。`, { model });

    // 出力の上限（見込みの金額はこの値で数える＝これより多くは出ない）
    const st = store.data.settings;
    const field = provider === 'openai' && body.max_completion_tokens !== undefined ? 'max_completion_tokens' : 'max_tokens';
    const asked = Number(body[field]);
    const maxOut = Math.min(Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : st.defaultMaxOutput, st.maxOutputTokens);
    body[field] = maxOut;
    const stream = body.stream === true;
    if (stream && provider === 'openai') body.stream_options = { ...(body.stream_options || {}), include_usage: true };

    // 送る前に伏せる
    const personal = store.data.toolOptions[tool]?.redactPersonal ?? st.redactPersonal;
    const red = redactBody(body, { personal });
    const outBody = red.body;

    // 見込みの金額で予約（この行から tryReserve まで await を挟まない）
    const estIn = estimateInputTokens(outBody);
    const estMilli = costMilliYen(price, { input: estIn, output: maxOut }, st.yenPerUsd);
    const rv = ledger.tryReserve(person, tool, estMilli, capOf, now());
    if (!rv.ok) {
      const h = rv.hit;
      const who = h.scope === 'company' ? '会社全体' : `${SCOPE_JA[h.scope]}「${h.name}」`;
      const ak = `${h.key}|1`;
      if (!ledger.alerted.has(ak)) {
        ledger.alerted.add(ak);
        log({ type: 'alert', alertKey: ak, scope: h.scope, name: h.name, span: h.span, period: h.period, ratio: 1, usedMilliYen: h.used, capMilliYen: h.cap,
          note: `${who}の${SPAN_JA[h.span]}の上限（${fmtYen(h.cap)}）に達したため、依頼を止め始めました` });
      }
      return refuse(429, 'spend_limit', `${who}の${SPAN_JA[h.span]}の上限（${fmtYen(h.cap)}）を超えるので送りませんでした（使用 ${fmtYen(h.used)}・送信中 ${fmtYen(h.inflight)}・この依頼の見込み ${fmtYen(h.est)}）。${h.span === 'day' ? '明日になると戻ります。' : '来月になると戻ります。'}`, { model, redacted: red.kinds });
    }

    // 送る（会社の鍵に付け替える。社員の鍵・社員の authorization は外へ出さない）
    const payload = Buffer.from(JSON.stringify(outBody));
    const url = new URL(upstreamPath, upstreams[provider]);
    const headers = { 'content-type': 'application/json', 'content-length': payload.length, accept: req.headers.accept || (stream ? 'text/event-stream' : 'application/json') };
    if (provider === 'anthropic') {
      headers['x-api-key'] = keys.anthropic;
      headers['anthropic-version'] = String(req.headers['anthropic-version'] || '2023-06-01');
      if (req.headers['anthropic-beta']) headers['anthropic-beta'] = String(req.headers['anthropic-beta']);
    } else headers.authorization = 'Bearer ' + keys.openai;

    let settled = false;
    const finish = (status, usage, extra = {}) => {
      if (settled) return; settled = true;
      const hasUsage = Number.isFinite(usage?.input) || Number.isFinite(usage?.output);
      if (!extra.charge && !hasUsage) { ledger.release(rv.id); }
      const actual = hasUsage
        ? costMilliYen(price, { input: usage.input || 0, output: usage.output ?? maxOut, cacheWrite: usage.cacheWrite, cacheRead: usage.cacheRead }, st.yenPerUsd)
        : extra.charge ? estMilli : 0;
      if (hasUsage || extra.charge) ledger.settle(rv.id, actual, person, tool, now());
      log({ type: 'use', person, tool, provider, model, status, stream, inTok: usage?.input ?? null, outTok: usage?.output ?? null,
        cacheWrite: usage?.cacheWrite, cacheRead: usage?.cacheRead, costMilliYen: actual, estMilliYen: estMilli,
        estimated: !hasUsage && !!extra.charge, redacted: red.kinds, ms: now() - started, ...(extra.note ? { note: extra.note } : {}) });
      if (actual) checkAlerts(person, tool, Date.parse(new Date(now()).toISOString()));
    };

    const lib = url.protocol === 'https:' ? https : http;
    const upReq = lib.request(url, { method: 'POST', headers, timeout: 10 * 60_000 }, (up) => {
      const status = up.statusCode || 502;
      breakers[provider] = breakerNext(breakers[provider], !(status >= 500 || status === 429), now(), st.breakerThreshold, st.breakerCooldownMs);
      const ctype = String(up.headers['content-type'] || '');
      const passHeaders = { 'content-type': ctype || 'application/json', ...SEC_HEADERS };
      for (const h of ['request-id', 'x-request-id', 'retry-after']) if (up.headers[h]) passHeaders[h] = up.headers[h];
      if (status >= 200 && status < 300 && ctype.includes('text/event-stream')) {
        const p = sseUsageParser(provider);
        res.writeHead(status, { ...passHeaders, 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.flushHeaders?.();
        up.on('data', (c) => { p.push(c); res.write(c); });
        up.on('end', () => { const u = p.end(); res.end(); finish(status, u, { charge: true }); });
        up.on('error', () => { res.destroy(); finish(status, p.usage, { charge: true, note: '返事の途中で切れた' }); });
        return;
      }
      const chunks = [];
      up.on('data', (c) => chunks.push(c));
      up.on('end', () => {
        const buf = Buffer.concat(chunks);
        let usage = {};
        if (status >= 200 && status < 300) { try { usage = usageFrom(provider, JSON.parse(buf.toString('utf8')).usage); } catch { /* 使用量が読めない＝見込みで数える */ } }
        res.writeHead(status, { ...passHeaders, 'content-length': buf.length });
        res.end(buf);
        // 2xx は使用量が無くても見込みで数える（安全側）。誤りの返事は数えない（AI の会社は誤りに請求しない）
        finish(status, usage, { charge: status >= 200 && status < 300 });
      });
      up.on('error', () => { if (!res.headersSent) send(res, 502, errorBody(provider, 502, 'api_error', '使いすぎ番：AI の会社からの返事が途中で切れました。')); finish(502, {}, {}); });
    });
    upReq.on('timeout', () => upReq.destroy(new Error('timeout')));
    upReq.on('error', (e) => {
      if (!settled && !res.headersSent) {
        breakers[provider] = breakerNext(breakers[provider], false, now(), st.breakerThreshold, st.breakerCooldownMs);
        send(res, 502, errorBody(provider, 502, 'api_error', '使いすぎ番：AI の会社へつながりませんでした。'));
        finish(502, {}, { note: 'つながらない: ' + String(e.code || e.message).slice(0, 40) });
      } else finish(502, {}, { charge: true, note: '途中で切れた' });
    });
    // 社員が途中でやめた＝ AI の会社への依頼も切る（使いすぎを止める）。数えるのは見込み（安全側）
    res.on('close', () => { if (!res.writableFinished) { upReq.destroy(); finish(499, {}, { charge: true, note: '社員の側で切れた' }); } });
    upReq.end(payload);
  }

  // ---------------- 管理画面 ----------------
  const isLoopback = (a) => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  function adminGate(req, res) {
    const port = server.address()?.port;
    const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
    if (!isLoopback(req.socket.remoteAddress)) { send(res, 403, { error: '管理画面は、この PC の中からだけ開けます。' }); return false; }
    if (!allowed.has(String(req.headers.host || ''))) { send(res, 403, { error: '宛先の名前が違います。' }); return false; }
    return true;
  }
  function adminAuthed(req) {
    const a = String(req.headers.authorization || '');
    return store.checkAdminKey(a.toLowerCase().startsWith('bearer ') ? a.slice(7).trim() : '');
  }

  function usageView() {
    const t = now();
    const { day, month } = periodsOf(t);
    const row = (scope, name) => {
      const d = `${scope}|${name}|d:${day}`, m = `${scope}|${name}|m:${month}`;
      return { name, dayUsed: ledger.usedOf(d), dayInflight: ledger.inflightOf(d), dayCap: capOf(scope, name, 'day'),
        monthUsed: ledger.usedOf(m), monthInflight: ledger.inflightOf(m), monthCap: capOf(scope, name, 'month') };
    };
    const people = new Set([...Object.keys(store.data.caps.person), ...store.data.tokens.map((x) => x.person)]);
    const tools = new Set([...Object.keys(store.data.caps.tool), ...store.data.tokens.map((x) => x.tool)]);
    for (const k of ledger.used.keys()) { const [s, n] = k.split('|'); if (s === 'person') people.add(n); if (s === 'tool') tools.add(n); }
    return { day, month, company: row('company', '*'), people: [...people].sort().map((n) => row('person', n)), tools: [...tools].sort().map((n) => row('tool', n)) };
  }

  async function handleAdminApi(req, res, pathname, query) {
    if (!adminAuthed(req)) return send(res, 401, { error: '管理画面の鍵が違います。' });
    const D = store.data;
    let j = {};
    if (req.method === 'POST') {
      if (!String(req.headers['content-type'] || '').includes('application/json')) return send(res, 415, { error: 'JSON で送ってください。' });
      try { j = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}'); } catch { return send(res, 400, { error: '本文が読めません。' }); }
    }
    const audit = (action, detail) => log({ type: 'admin', action, detail });

    if (req.method === 'GET' && pathname === '/admin/api/state') {
      const rows = chain.readRows();
      return send(res, 200, {
        settings: D.settings, caps: D.caps, prices: D.prices, toolOptions: D.toolOptions,
        tokens: D.tokens.map(({ hash, ...t }) => t), usage: usageView(),
        alerts: rows.filter((r) => r.type === 'alert').slice(-30).reverse(),
        recent: rows.filter((r) => r.type === 'use' || r.type === 'refused').slice(-30).reverse()
          .map((r) => ({ ts: r.ts, type: r.type, person: r.person, tool: r.tool, model: r.model, costMilliYen: r.costMilliYen, estimated: r.estimated, redacted: r.redacted, note: r.note, status: r.status })),
        breakers, verify: chain.verify(), keysSet: { anthropic: !!keys.anthropic, openai: !!keys.openai },
      });
    }
    if (req.method === 'POST' && pathname === '/admin/api/caps') {
      const scope = j.scope;
      const day = yenOrNull(j.day), month = yenOrNull(j.month);
      if (day === undefined || month === undefined) return send(res, 400, { error: '上限は 0 以上の数（円）か空にしてください。' });
      if (scope === 'company') D.caps.company = { day, month };
      else if (scope === 'defaultPerson') D.caps.defaultPerson = { day, month };
      else if (scope === 'person' || scope === 'tool') {
        const name = cleanName(j.name); if (!name) return send(res, 400, { error: '名前は 1〜40 文字にしてください。' });
        if (j.remove) delete D.caps[scope][name]; else D.caps[scope][name] = { day, month };
      } else return send(res, 400, { error: '範囲が違います。' });
      store.save(); audit('上限の変更', { scope, name: j.name ?? null, day, month, remove: !!j.remove });
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && pathname === '/admin/api/tokens') {
      const person = cleanName(j.person), tool = cleanName(j.tool || '未指定');
      if (!person || !tool) return send(res, 400, { error: '名前と道具は 1〜40 文字にしてください。' });
      const { token, rec } = store.issueToken(person, tool);
      audit('鍵の発行', { id: rec.id, person, tool });
      return send(res, 200, { token, id: rec.id, person, tool });
    }
    if (req.method === 'POST' && pathname === '/admin/api/tokens/revoke') {
      const rec = store.revokeToken(String(j.id || ''));
      if (!rec) return send(res, 404, { error: 'その鍵はありません（または無効にずみ）。' });
      audit('鍵を無効にした', { id: rec.id, person: rec.person, tool: rec.tool });
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && pathname === '/admin/api/settings') {
      const s = D.settings, changed = {};
      if (j.yenPerUsd !== undefined) { const n = Number(j.yenPerUsd); if (!(n > 0 && n < 10000)) return send(res, 400, { error: '為替が変です。' }); s.yenPerUsd = n; changed.yenPerUsd = n; }
      if (j.maxOutputTokens !== undefined) { const n = Math.floor(Number(j.maxOutputTokens)); if (!(n >= 1 && n <= 200000)) return send(res, 400, { error: '出力の上限が変です。' }); s.maxOutputTokens = n; changed.maxOutputTokens = n; }
      if (j.redactPersonal !== undefined) { s.redactPersonal = !!j.redactPersonal; changed.redactPersonal = s.redactPersonal; }
      if (j.companyName !== undefined) { const n = cleanName(j.companyName); if (!n) return send(res, 400, { error: '会社名は 1〜40 文字にしてください。' }); s.companyName = n; changed.companyName = n; }
      if (j.toolName !== undefined) {
        const t = cleanName(j.toolName); if (!t) return send(res, 400, { error: '道具の名前が変です。' });
        if (j.toolRedactPersonal === null) delete D.toolOptions[t]; else D.toolOptions[t] = { redactPersonal: !!j.toolRedactPersonal };
        changed.tool = { name: t, redactPersonal: j.toolRedactPersonal };
      }
      store.save(); audit('設定の変更', changed);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && pathname === '/admin/api/prices') {
      const model = String(j.model || '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9._:/-]{0,79}$/.test(model)) return send(res, 400, { error: 'モデル名が変です。' });
      if (j.remove) { delete D.prices[model]; store.save(); audit('単価の削除', { model }); return send(res, 200, { ok: true }); }
      const input = Number(j.input), output = Number(j.output);
      if (!(input >= 0 && output >= 0 && input < 10000 && output < 10000)) return send(res, 400, { error: '単価（100万トークンあたりの米ドル）が変です。' });
      D.prices[model] = { input, output, provisional: false, setAt: new Date(now()).toISOString() };
      store.save(); audit('単価の登録', { model, input, output });
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && pathname === '/admin/api/verify') {
      const fp = j.seq && j.hash ? { seq: Number(j.seq), hash: String(j.hash).trim().toLowerCase() } : null;
      return send(res, 200, chain.verify(fp));
    }
    if (req.method === 'GET' && pathname === '/admin/api/report') {
      const month = /^\d{4}-\d{2}$/.test(query.get('month') || '') ? query.get('month') : periodsOf(now()).month;
      const text = monthlyReport(chain.readRows(), month, chain.verify(), D.settings.companyName || '（会社名）');
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', ...SEC_HEADERS });
      return res.end(text);
    }
    return send(res, 404, { error: 'ありません。' });
  }

  function serveStatic(res, file, type) {
    let buf;
    try { buf = fs.readFileSync(path.join(opts.webDir || WEB_DIR, file)); } catch { return send(res, 404, { error: 'ありません。' }); }
    res.writeHead(200, { 'content-type': type, 'content-security-policy': CSP, ...SEC_HEADERS });
    res.end(buf);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      const route = ROUTES[u.pathname];
      if (route) {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST だけです。' });
        return await handleProxy(req, res, route);
      }
      if (u.pathname === '/health') return send(res, 200, { ok: true });
      if (u.pathname === '/admin' || u.pathname.startsWith('/admin/')) {
        if (!adminGate(req, res)) return;
        if (u.pathname === '/admin' || u.pathname === '/admin/') return serveStatic(res, 'admin.html', 'text/html; charset=utf-8');
        if (u.pathname === '/admin/admin.js') return serveStatic(res, 'admin.js', 'text/javascript; charset=utf-8');
        if (u.pathname === '/admin/admin.css') return serveStatic(res, 'admin.css', 'text/css; charset=utf-8');
        if (u.pathname.startsWith('/admin/api/')) return await handleAdminApi(req, res, u.pathname, u.searchParams);
      }
      return send(res, 404, { error: 'ありません。' });
    } catch (e) {
      if (!res.headersSent) send(res, 500, { error: '使いすぎ番の中で誤りが起きました。' });
      else res.destroy();
      console.error('[使いすぎ番]', e?.stack || e);
    }
  });

  return {
    server, store, chain, ledger, breakers, firstAdminKey,
    listen(port = 8787, host = '127.0.0.1') { return new Promise((r) => server.listen(port, host, () => r(server.address()))); },
    close() { return new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }); },
  };
}
