// 円の上限・送る前の予約・失敗が続いた時の遮断。依存なし。
// 元：以前の社内の試作の
//   lib/aiReservation.ts … 通した依頼の見込みを「予約」として持ち、次の依頼の確かめに足す。比べてから予約までの間に await を挟まない。
//   lib/aiPreflight.ts   … 送る前に「この 1 回の見込み（入力の概算＋出力の上限）」を足して比べる。単価の分からないモデルは通さない。
//   lib/usageCost.ts     … 費用は記録した時の単価で残す（後から単価を変えても過去の金額は動かない）。
//   lib/aiBreaker.ts     … 連続で失敗したら一定時間すぐ断る。
// 変えた所：トークンでなく円で、会社・人・道具ごとに「日」と「月」（日本時間）を見る。

// ---------- 日本時間の日と月 ----------
export function periodsOf(ms) {
  const d = new Date(ms + 9 * 3600_000).toISOString();
  return { day: d.slice(0, 10), month: d.slice(0, 7) };
}

// ---------- 単価（100 万トークンあたりの米ドル） ----------
/** モデル名に合う単価。完全一致 → 前方一致（日付つきの名前）の順。分からなければ null。 */
export function priceFor(prices, model) {
  const m = String(model || '').trim().toLowerCase();
  if (!m) return null;
  if (prices[m]) return prices[m];
  let best = null;
  for (const k of Object.keys(prices)) if (m.startsWith(k.toLowerCase()) && (!best || k.length > best.length)) best = k;
  return best ? prices[best] : null;
}

/** 1/1000 円の整数で数える（小数の足し算のずれを避ける）。 */
export function costMilliYen(p, usage, yenPerUsd, cacheRates = { write: 1.25, read: 0.1 }) {
  const inUsd = ((usage.input || 0) + (usage.cacheWrite || 0) * cacheRates.write + (usage.cacheRead || 0) * cacheRates.read) * p.input / 1e6;
  const outUsd = (usage.output || 0) * p.output / 1e6;
  return Math.ceil((inUsd + outUsd) * yenPerUsd * 1000);
}

// ---------- 送る前の見込み ----------
/**
 * 入力のトークンの見込み（多めに数える）。本文の JSON の文字数をそのままトークン数とみなす
 * （英語は実際の 3〜4 倍、日本語はほぼ同じか多め＝安全側）。画像は 1 枚 1,600 トークンとして数え、base64 の中身は数えない。
 */
export function estimateInputTokens(body) {
  let images = 0;
  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      if (v.type === 'image' || v.type === 'image_url' || v.type === 'input_image') { images++; return null; }
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = strip(x);
      return o;
    }
    return v;
  };
  const s = JSON.stringify(strip({ system: body.system, messages: body.messages, tools: body.tools }));
  return [...s].length + images * 1600;
}

// ---------- 上限と予約 ----------
export const RESERVATION_TTL_MS = 15 * 60_000;

export class Ledger {
  constructor() {
    this.used = new Map();      // 'company|*|d:2026-11-14' → 1/1000 円
    this.inflight = new Map();
    this.reservations = new Map();
    this.seq = 0;
    this.alerted = new Set();   // 一度出した知らせ（同じ期間に何度も出さない）
  }

  static keysFor(person, tool, ms) {
    const { day, month } = periodsOf(ms);
    const out = [];
    for (const [scope, name] of [['company', '*'], ['person', person], ['tool', tool]]) {
      out.push({ scope, name, span: 'day', period: day, key: `${scope}|${name}|d:${day}` });
      out.push({ scope, name, span: 'month', period: month, key: `${scope}|${name}|m:${month}` });
    }
    return out;
  }

  usedOf(key) { return this.used.get(key) || 0; }
  inflightOf(key) { this.expire(); return this.inflight.get(key) || 0; }

  expire(now = Date.now()) {
    for (const [id, r] of this.reservations) if (now - r.at > RESERVATION_TTL_MS) this.release(id);
  }

  /**
   * 上限に収まるなら予約して番号を返す。収まらなければ { ok:false, hit }。
   * ⚠ この関数の中に await を入れない（比べてから予約するまでに、別の依頼に割り込まれないため）。
   * capOf(scope, name, span) は 1/1000 円の上限（null＝上限なし）。
   */
  tryReserve(person, tool, estMilli, capOf, now = Date.now()) {
    this.expire(now);
    const keys = Ledger.keysFor(person, tool, now);
    for (const k of keys) {
      const cap = capOf(k.scope, k.name, k.span);
      if (cap === null || cap === undefined) continue;
      const total = this.usedOf(k.key) + (this.inflight.get(k.key) || 0) + estMilli;
      if (total > cap) return { ok: false, hit: { ...k, cap, used: this.usedOf(k.key), inflight: this.inflight.get(k.key) || 0, est: estMilli } };
    }
    const id = ++this.seq;
    for (const k of keys) this.inflight.set(k.key, (this.inflight.get(k.key) || 0) + estMilli);
    this.reservations.set(id, { id, keys: keys.map((k) => k.key), est: estMilli, at: now });
    return { ok: true, id, keys };
  }

  release(id) {
    const r = this.reservations.get(id);
    if (!r) return false;
    for (const k of r.keys) {
      const v = (this.inflight.get(k) || 0) - r.est;
      if (v > 0) this.inflight.set(k, v); else this.inflight.delete(k);
    }
    this.reservations.delete(id);
    return true;
  }

  /** 実際の費用を足す（予約は外す）。予約の時刻の期間で数える（日をまたいだ長い依頼も、始めた日に数える）。 */
  settle(id, actualMilli, person, tool, now = Date.now()) {
    const r = this.reservations.get(id);
    const at = r ? r.at : now;
    this.release(id);
    this.add(person, tool, actualMilli, at);
  }

  add(person, tool, milli, ms) {
    for (const k of Ledger.keysFor(person, tool, ms)) this.used.set(k.key, this.usedOf(k.key) + milli);
  }
}

// ---------- 失敗が続いた時の遮断（AI の会社ごと） ----------
export function breakerNext(cur, ok, now, threshold = 5, cooldownMs = 30_000) {
  if (ok) return { fails: 0, openUntil: 0 };
  const fails = (cur?.fails || 0) + 1;
  return fails >= threshold ? { fails: 0, openUntil: now + cooldownMs } : { fails, openUntil: 0 };
}
export function breakerIsOpen(st, now) { return !!(st && st.openUntil > now); }

export function yen(milli) { return Math.round(milli) / 1000; }
export function fmtYen(milli) {
  const y = milli / 1000;
  return (y < 10 ? y.toFixed(2) : Math.round(y).toLocaleString('ja-JP')) + '円';
}
