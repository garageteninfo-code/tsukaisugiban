// 使いすぎ番の管理画面。外の読み込み無し・innerHTML を使わない（名前などは textContent で入れる）。
'use strict';
let KEY = '';
try { KEY = sessionStorage.getItem('tsukaisugiAdmin') || ''; } catch { /* 使えない時は毎回入れる */ }
const $ = (s) => document.querySelector(s);
const yen = (m) => (m === null || m === undefined ? '—' : (m / 1000 < 10 ? (m / 1000).toFixed(2) : Math.round(m / 1000).toLocaleString('ja-JP')) + '円');
const capYen = (m) => (m === null || m === undefined ? 'なし' : yen(m));
const KIND = { api_key: 'APIキー', private_key: '秘密鍵', credential_phrase: 'パスワード等', credit_card: 'カード', my_number: 'マイナンバー', phone: '電話', email: 'メール', address: '住所', name: '氏名', birth: '生年月日', jwt: '鍵', aws_key: 'AWSの鍵', bearer: '認証の鍵', credential_assign: '鍵の値', github_token: 'GitHubの鍵', payment_secret: '決済の鍵', slack_token: 'Slackの鍵', url_password: 'URLのパスワード' };

function el(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined && text !== null) e.textContent = String(text); if (cls) e.className = cls; return e; }
function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = bad ? 'bad' : 'ok'; setTimeout(() => { if (t.textContent === msg) t.textContent = ''; }, 5000); }

async function api(path, body) {
  const r = await fetch('/admin/api/' + path, body === undefined
    ? { headers: { authorization: 'Bearer ' + KEY } }
    : { method: 'POST', headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 401) { showLogin('鍵が違います。'); throw new Error('401'); }
  const type = r.headers.get('content-type') || '';
  const data = type.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data && data.error) || ('誤り ' + r.status));
  return data;
}

function showLogin(msg) { $('#app').hidden = true; $('#login').hidden = false; $('#loginMsg').textContent = msg || ''; }

function bar(used, cap) {
  const wrap = el('div', null, 'bar'); const i = el('i');
  const r = cap ? Math.min(1, used / cap) : 0;
  i.style.width = Math.round(r * 100) + '%';
  if (r >= 1) i.className = 'bad'; else if (r >= 0.8) i.className = 'warn';
  wrap.append(i); return wrap;
}

function usageCell(used, inflight, cap) {
  const td = el('td', null, 'num');
  td.append(el('span', yen(used) + (inflight ? `（送信中 ${yen(inflight)}）` : '')));
  if (cap) td.append(bar(used + inflight, cap));
  return td;
}

function fill(tbody, rows, make) { tbody.textContent = ''; for (const r of rows) tbody.append(make(r)); if (!rows.length) { const tr = el('tr'); const td = el('td', 'まだありません', 'note'); td.colSpan = 7; tr.append(td); tbody.append(tr); } }

function setForm(form, vals) { for (const [k, v] of Object.entries(vals)) { const i = form.elements[k]; if (!i) continue; if (i.type === 'checkbox') i.checked = !!v; else i.value = v === null || v === undefined ? '' : v; } }

async function load() {
  const s = await api('state');
  $('#login').hidden = true; $('#app').hidden = false;
  const u = s.usage;
  // いまの状態
  const st = $('#status'); st.textContent = '';
  const card = (title, main, sub, cls) => { const c = el('div', null, 'card'); c.append(el('span', title, 'note'), el('b', main, cls), el('span', sub, 'note')); return c; };
  st.append(card(`今日（${u.day}）会社全体`, yen(u.company.dayUsed), `上限 ${capYen(u.company.dayCap)}`, u.company.dayCap && u.company.dayUsed >= u.company.dayCap ? 'bad' : ''));
  st.lastChild.append(bar(u.company.dayUsed, u.company.dayCap));
  st.append(card(`今月（${u.month}）会社全体`, yen(u.company.monthUsed), `上限 ${capYen(u.company.monthCap)}`));
  st.lastChild.append(bar(u.company.monthUsed, u.company.monthCap));
  st.append(card('記録の確かめ', s.verify.ok ? '問題なし' : '問題あり', s.verify.ok ? `${s.verify.count} 件・指紋 ${s.verify.fingerprint ? s.verify.fingerprint.seq + ' 番 ' + s.verify.fingerprint.hash : 'まだなし'}` : s.verify.reason, s.verify.ok ? 'ok' : 'bad'));
  const keys = Object.entries(s.keysSet).map(([k, v]) => `${k}：${v ? '設定あり' : 'なし'}`).join('／');
  const open = Object.entries(s.breakers).filter(([, b]) => b.openUntil > Date.now()).map(([k]) => k);
  st.append(card('会社の API キー（中身は表示しません）', open.length ? '一時停止中：' + open.join('・') : '動いています', keys, open.length ? 'warn' : ''));

  setForm($('#companyForm'), s.caps.company);
  setForm($('#defaultPersonForm'), s.caps.defaultPerson);

  fill($('#peopleTable tbody'), u.people, (p) => {
    const tr = el('tr'); tr.append(el('td', p.name), usageCell(p.dayUsed, p.dayInflight, p.dayCap), usageCell(p.monthUsed, p.monthInflight, p.monthCap));
    tr.append(el('td', `${capYen(p.dayCap)} ／ ${capYen(p.monthCap)}${s.caps.person[p.name] ? '' : '（既定）'}`)); return tr;
  });
  fill($('#toolTable tbody'), u.tools, (t) => {
    const tr = el('tr'); tr.append(el('td', t.name), usageCell(t.dayUsed, t.dayInflight, t.dayCap), usageCell(t.monthUsed, t.monthInflight, t.monthCap));
    tr.append(el('td', `${capYen(t.dayCap)} ／ ${capYen(t.monthCap)}`));
    const o = s.toolOptions[t.name]; tr.append(el('td', o ? (o.redactPersonal ? '伏せる' : '伏せない') : '会社の設定')); return tr;
  });
  fill($('#tokenTable tbody'), s.tokens.slice().reverse(), (t) => {
    const tr = el('tr'); tr.append(el('td', t.id), el('td', t.person), el('td', t.tool), el('td', (t.createdAt || '').slice(0, 10)), el('td', t.revokedAt ? '無効' : '有効', t.revokedAt ? 'note' : 'ok'));
    const td = el('td');
    if (!t.revokedAt) { const b = el('button', '無効にする', 'sub'); b.type = 'button'; b.addEventListener('click', async () => { if (!confirm(`${t.person}（${t.tool}）の鍵を無効にします。元に戻せません。よいですか？`)) return; try { await api('tokens/revoke', { id: t.id }); toast('無効にしました'); load(); } catch (e) { toast(e.message, true); } }); td.append(b); }
    tr.append(td); return tr;
  });
  const al = $('#alerts'); al.textContent = '';
  for (const a of s.alerts) al.append(el('li', `${(a.ts || '').slice(0, 16).replace('T', ' ')}　${a.note}`, a.ratio >= 1 ? 'bad' : 'warn'));
  if (!s.alerts.length) al.append(el('li', 'なし', 'note'));
  fill($('#recentTable tbody'), s.recent, (r) => {
    const tr = el('tr');
    const red = Object.entries(r.redacted || {}).map(([k, c]) => `${KIND[k] || k}${c}`).join('・') || '—';
    tr.append(el('td', (r.ts || '').slice(5, 16).replace('T', ' ')), el('td', r.person), el('td', r.tool), el('td', r.model || '—'),
      el('td', r.type === 'use' ? yen(r.costMilliYen) + (r.estimated ? '（見込み）' : '') : '—', 'num'), el('td', red),
      el('td', r.type === 'refused' ? '止めた：' + (r.note || '') : String(r.status || ''), r.type === 'refused' ? 'warn' : ''));
    return tr;
  });
  setForm($('#settingsForm'), { companyName: s.settings.companyName || '', yenPerUsd: s.settings.yenPerUsd, maxOutputTokens: s.settings.maxOutputTokens, redactPersonal: s.settings.redactPersonal });
  fill($('#priceTable tbody'), Object.entries(s.prices), ([m, p]) => {
    const tr = el('tr'); tr.append(el('td', m + (p.provisional ? '（仮）' : ''), p.provisional ? 'warn' : ''), el('td', p.input, 'num'), el('td', p.output, 'num'));
    const td = el('td'); const b = el('button', '消す', 'sub'); b.type = 'button';
    b.addEventListener('click', async () => { if (!confirm(`${m} の単価を消します（このモデルへの依頼は送らなくなります）。`)) return; try { await api('prices', { model: m, remove: true }); load(); } catch (e) { toast(e.message, true); } });
    td.append(b); tr.append(td); return tr;
  });
}

function onSubmit(sel, fn) {
  $(sel).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { const msg = await fn(Object.fromEntries(new FormData(ev.target)), ev.target); toast(msg || '保存しました'); await load(); } catch (e) { if (e.message !== '401') toast(e.message, true); }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  $('#loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault(); KEY = $('#adminKey').value.trim();
    try { sessionStorage.setItem('tsukaisugiAdmin', KEY); } catch { /* 保存できなくても今は使える */ }
    try { await load(); } catch (e) { if (e.message !== '401') showLogin(e.message); }
  });
  onSubmit('#companyForm', (v) => api('caps', { scope: 'company', day: v.day, month: v.month }));
  onSubmit('#defaultPersonForm', (v) => api('caps', { scope: 'defaultPerson', day: v.day, month: v.month }));
  onSubmit('#personCapForm', (v) => api('caps', { scope: 'person', name: v.name, day: v.day, month: v.month }));
  onSubmit('#toolCapForm', (v) => api('caps', { scope: 'tool', name: v.name, day: v.day, month: v.month }));
  onSubmit('#issueForm', async (v, f) => {
    const r = await api('tokens', { person: v.person, tool: v.tool || '未指定' });
    $('#newToken').hidden = false; $('#newTokenText').textContent = r.token;
    $('#newTokenHint').textContent = `送り先の例：Anthropic 形式は http://この PC の住所:${location.port}/anthropic 、OpenAI 形式は http://この PC の住所:${location.port}/openai/v1`;
    f.reset(); return `${r.person}（${r.tool}）の鍵を発行しました`;
  });
  onSubmit('#settingsForm', (v) => api('settings', { companyName: v.companyName || undefined, yenPerUsd: v.yenPerUsd, maxOutputTokens: v.maxOutputTokens, redactPersonal: v.redactPersonal === 'on' }));
  onSubmit('#toolOptForm', (v) => api('settings', { toolName: v.toolName, toolRedactPersonal: v.mode === 'default' ? null : v.mode === 'on' }));
  onSubmit('#priceForm', (v) => api('prices', { model: v.model, input: v.input, output: v.output }));
  onSubmit('#verifyForm', async (v) => {
    const r = await api('verify', v.seq && v.hash ? { seq: v.seq, hash: v.hash } : {});
    const m = $('#verifyMsg'); m.textContent = r.ok ? `問題なし（${r.count} 件）${v.seq ? '・前の報告の指紋とも一致' : ''}` : `問題あり：${r.reason}`; m.className = r.ok ? 'ok' : 'bad';
    return '確かめました';
  });
  onSubmit('#reportForm', async (v) => { $('#report').textContent = await api('report?month=' + encodeURIComponent(v.month || '')); return '報告を作りました'; });
  $('#copyReport').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#report').textContent); toast('写しました'); } catch { toast('写せませんでした。選んで写してください。', true); } });
  if (KEY) load().catch(() => {}); else showLogin('');
});
