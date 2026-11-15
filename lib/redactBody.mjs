// AI へ送る本文の中の文字を、送る前に伏せる。検出は jpGuard.mjs（日本の個人情報・鍵の検出）。
// 本文の形（Anthropic の messages・OpenAI の chat/completions）に依らず、文字の値を全部たどる。
// たどらない所：モデル名・役割・種類・番号など、伏せると AI の会社が受け取れなくなる値と、画像などの base64 の中身。
import { redact } from './jpGuard.mjs';

const SKIP_KEYS = new Set(['model', 'role', 'type', 'id', 'tool_use_id', 'tool_call_id', 'media_type', 'data', 'url', 'image_url',
  'cache_control', 'stream', 'detail', 'format', 'mime_type', 'file_id', 'signature', 'reasoning_effort', 'service_tier']);

/** 本文（解釈済みの JSON）を伏せた写しと、種類ごとの数を返す。元の本文は変えない。 */
export function redactBody(body, { personal = true } = {}) {
  const kinds = {};
  let count = 0;
  const walk = (v, key) => {
    if (typeof v === 'string') {
      if (SKIP_KEYS.has(key)) return v;
      const r = redact(v, { personal });
      if (r.count) { count += r.count; for (const k of r.kinds) kinds[k] = (kinds[k] || 0) + (r.text.split(`[伏せ字:${k}]`).length - 1); }
      return r.text;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = SKIP_KEYS.has(k) && typeof x !== 'object' ? x : (k === 'image_url' || k === 'source' && x?.type === 'base64') ? x : walk(x, k);
      return o;
    }
    return v;
  };
  // 名前（ツールの名前・関数名）は伏せない＝ AI の会社の決まった形を壊さないため。説明文や引数の中身は伏せる。
  const out = walk(body, '');
  if (Array.isArray(body.tools)) out.tools = body.tools.map((t, i) => ({ ...out.tools[i], name: t.name, ...(t.function ? { function: { ...out.tools[i].function, name: t.function.name } } : {}) }));
  return { body: out, count, kinds };
}
