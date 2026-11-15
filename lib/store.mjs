// 設定の保存（上限・単価・鍵の一覧）。1 つの JSON を書き換え用の一時ファイル→名前の付け替えで保存する。
// 鍵そのもの（会社の API キー・社員の鍵・管理画面の鍵）はここに書かない。社員と管理画面の鍵は sha256 の指紋だけを持つ。
// 会社の API キーは環境変数（TSUKAISUGI_ANTHROPIC_KEY / TSUKAISUGI_OPENAI_KEY）から読むだけ。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
export function newSecret(prefix) { return prefix + crypto.randomBytes(24).toString('base64url'); }

/** 単価は初めは空。AI のモデルの単価は、利用者が AI の会社の公式の料金表を見て、管理画面の「単価」で入れる。
 *  単価の無いモデルへの依頼は送らない（上限を守れないため）。 */
export const DEFAULT_PRICES = {};

export function defaultConfig() {
  return {
    version: 1,
    adminKeyHash: null,
    settings: {
      yenPerUsd: 150,            // 為替の目安（円/米ドル）。請求の正は AI の会社の請求書
      redactPersonal: true,      // 電話・メール・住所・氏名・生年月日も伏せる（鍵・カード・マイナンバーはいつも伏せる）
      maxOutputTokens: 4096,     // 1 回の出力の上限（これより大きい指定は下げて送る）
      defaultMaxOutput: 1024,    // 出力の上限の指定が無い時に付ける値
      alertRatios: [0.8, 1],     // この割合を超えたら知らせる
      breakerThreshold: 5,
      breakerCooldownMs: 30_000,
      maxBodyBytes: 8 * 1024 * 1024,
    },
    caps: {
      company: { day: 1000, month: 10000 },   // 円。初めから会社全体には上限を付けておく（付け忘れ＝青天井を防ぐ）
      defaultPerson: { day: 300, month: 3000 },
      person: {},                              // { '佐藤': { day, month } }
      tool: {},                                // { 'AI受付係': { day, month } }
    },
    toolOptions: {},                           // { '受付ボット': { redactPersonal: false } }
    prices: { ...DEFAULT_PRICES },
    tokens: [],                                // { id, hash, person, tool, createdAt, revokedAt }
  };
}

export class ConfigStore {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    fs.mkdirSync(dir, { recursive: true });
    try { this.data = { ...defaultConfig(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; }
    catch (e) { if (e.code !== 'ENOENT') throw new Error('設定のファイルが読めません: ' + e.message); this.data = defaultConfig(); this.save(); }
    this.data.settings = { ...defaultConfig().settings, ...this.data.settings };
  }
  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  /** 1/1000 円の上限。null＝上限なし。人は個別の上限 → 既定の上限の順。 */
  capMilli(scope, name, span) {
    const c = this.data.caps;
    let v;
    if (scope === 'company') v = c.company?.[span];
    else if (scope === 'person') v = (c.person[name] ?? c.defaultPerson)?.[span];
    else v = c.tool[name]?.[span];
    return v === null || v === undefined || v === '' ? null : Math.round(Number(v) * 1000);
  }

  issueToken(person, tool) {
    const token = newSecret('tsk_');
    const rec = { id: 'k' + crypto.randomBytes(4).toString('hex'), hash: sha256(token), person, tool, createdAt: new Date().toISOString(), revokedAt: null };
    this.data.tokens.push(rec);
    this.save();
    return { token, rec };
  }
  findToken(token) {
    if (typeof token !== 'string' || !token.startsWith('tsk_')) return null;
    const h = sha256(token);
    const rec = this.data.tokens.find((t) => t.hash === h);
    return rec && !rec.revokedAt ? rec : null;
  }
  revokeToken(id) {
    const rec = this.data.tokens.find((t) => t.id === id);
    if (!rec || rec.revokedAt) return null;
    rec.revokedAt = new Date().toISOString();
    this.save();
    return rec;
  }
  setAdminKey(key) { this.data.adminKeyHash = sha256(key); this.save(); }
  checkAdminKey(key) {
    if (!this.data.adminKeyHash || typeof key !== 'string' || !key) return false;
    const a = Buffer.from(sha256(key), 'hex'), b = Buffer.from(this.data.adminKeyHash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}
