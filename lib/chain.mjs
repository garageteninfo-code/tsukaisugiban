// 改ざんに気づける使用記録（ハッシュの鎖）。依存なし。
// 元：以前の社内の試作の lib/auditChain.ts（行ごとに前の行の指紋をつなぐ・鎖の外の「控え」で末尾の削除に気づく）と
//     lib/auditCore.ts の canonicalJson（キーを並べ替えて同じ中身なら同じ文字列にする）。DB を使わず、1 行 1 件の JSONL にした。
//
// 1 行 = { ...中身, seq, prev, hash }。hash = sha256(prev + '|' + canonicalJson(中身＋seq))。
// 1 行でも書き換える・消す・並べ替えると、そこから先の鎖が合わなくなる。
// 末尾をまとめて消されると残りはつながったままなので、最後の行の番号と指紋を別のファイル（控え）に置いて比べる。
// ⚠ 記録と控えの両方を、計算し直して書き換えられる人（この PC の管理者）には、鎖だけでは勝てない。
//   そこで月の報告に「指紋」を印刷し、社長が紙やメモに残す。後から確かめる時にその指紋を渡すと、丸ごとの作り直しにも気づける。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const GENESIS = 'GENESIS';

export function canonicalJson(value) {
  const seen = new WeakSet();
  const norm = (v) => {
    if (v === null || typeof v !== 'object') return typeof v === 'number' && Object.is(v, -0) ? 0 : v;
    if (seen.has(v)) return null;
    seen.add(v);
    if (Array.isArray(v)) return v.map(norm);
    const out = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = norm(v[k]);
    return out;
  };
  return JSON.stringify(norm(value));
}

export function hashOf(body, seq, prev) {
  return crypto.createHash('sha256').update(prev + '|' + canonicalJson({ ...body, seq })).digest('hex');
}

/** 記録の鎖。1 つのプロセスの中で同期の書き込みだけを使う（並んだ追記で鎖が枝分かれしない）。 */
export class UsageChain {
  constructor(dir) {
    this.file = path.join(dir, 'usage-log.jsonl');
    this.anchorFile = path.join(dir, 'anchor.json');
    fs.mkdirSync(dir, { recursive: true });
    this.seq = 0;
    this.tip = GENESIS;
    const v = this.verify();
    this.lastVerify = v;
    // 壊れていても止めずに後ろへ足す（記録を止めると上限も止まる）。画面に赤で出し、壊れた所は v.brokenAtSeq で分かる。
    const rows = this.readRows();
    if (rows.length) { const last = rows[rows.length - 1]; this.seq = Number(last.seq) || rows.length; this.tip = String(last.hash || GENESIS); }
  }

  readRows() {
    let raw = '';
    try { raw = fs.readFileSync(this.file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    const rows = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch { rows.push({ __bad: line }); }
    }
    return rows;
  }

  append(body) {
    const seq = this.seq + 1;
    const prev = this.tip;
    const clean = JSON.parse(JSON.stringify(body));
    const hash = hashOf(clean, seq, prev);
    const row = { ...clean, seq, prev, hash };
    fs.appendFileSync(this.file, JSON.stringify(row) + '\n');
    this.seq = seq; this.tip = hash;
    const tmp = this.anchorFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ seq, hash, at: new Date().toISOString() }));
    fs.renameSync(tmp, this.anchorFile);
    return row;
  }

  /** 鎖の全体を計算し直す。expectFingerprint（報告に印刷した指紋＝{seq, hash}）を渡すと丸ごとの作り直しにも気づく。 */
  verify(expectFingerprint = null) {
    const rows = this.readRows();
    let prev = GENESIS;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const want = i + 1;
      if (r.__bad !== undefined) return { ok: false, count: rows.length, brokenAtSeq: want, reason: '読めない行がある（書き換え）' };
      if (Number(r.seq) !== want) return { ok: false, count: rows.length, brokenAtSeq: want, reason: `番号が飛んでいる・入れ替わっている（${want} のはずが ${r.seq}）` };
      if (r.prev !== prev) return { ok: false, count: rows.length, brokenAtSeq: want, reason: '前の行とのつながりが合わない（削除・入れ替え）' };
      const { seq, prev: _p, hash, ...body } = r;
      if (hashOf(body, seq, prev) !== hash) return { ok: false, count: rows.length, brokenAtSeq: want, reason: '行の中身が書き換えられている' };
      prev = hash;
    }
    let anchor = null;
    try { anchor = JSON.parse(fs.readFileSync(this.anchorFile, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') return { ok: false, count: rows.length, reason: '控えのファイルが読めない' }; }
    if (anchor) {
      if (rows.length < anchor.seq) return { ok: false, count: rows.length, brokenAtSeq: rows.length + 1, reason: `末尾が消されている（控えは ${anchor.seq} 件）` };
      if (anchor.seq > 0 && rows[anchor.seq - 1]?.hash !== anchor.hash) return { ok: false, count: rows.length, brokenAtSeq: anchor.seq, reason: '控えと合わない（記録が差し替えられた）' };
    } else if (rows.length) {
      return { ok: false, count: rows.length, reason: '控えのファイルが無い（消された）' };
    }
    if (expectFingerprint) {
      const at = rows[Number(expectFingerprint.seq) - 1];
      if (!at) return { ok: false, count: rows.length, reason: `報告の指紋の行（${expectFingerprint.seq} 番）が無い` };
      if (!String(at.hash).startsWith(String(expectFingerprint.hash))) return { ok: false, count: rows.length, brokenAtSeq: Number(expectFingerprint.seq), reason: '報告に印刷した指紋と合わない（記録が作り直された）' };
    }
    const last = rows[rows.length - 1];
    return { ok: true, count: rows.length, fingerprint: last ? { seq: last.seq, hash: String(last.hash).slice(0, 16) } : null };
  }
}
