// 月の報告（日本語・社長や親会社・取引先に渡せる形）。記録の鎖から作る（記録に無いことは書かない）。
import { fmtYen, periodsOf } from './budget.mjs';

const KIND_JA = {
  api_key: 'APIキー', private_key: '秘密鍵', credential_phrase: 'パスワード等', credit_card: 'カード番号', my_number: 'マイナンバー',
  phone: '電話番号', email: 'メール', address: '住所', name: '氏名', birth: '生年月日', jwt: 'ログインの鍵',
  aws_key: 'AWSの鍵', bearer: '認証の鍵', credential_assign: '鍵の設定値', github_token: 'GitHubの鍵', payment_secret: '決済の鍵',
  slack_token: 'Slackの鍵', url_password: 'URL内のパスワード',
};
export const kindJa = (k) => KIND_JA[k] || k;

export function summarize(rows, month) {
  const people = new Map(), tools = new Map();
  const total = { n: 0, refused: 0, inTok: 0, outTok: 0, milli: 0, estimated: 0, redacted: {} };
  const bump = (map, name) => { if (!map.has(name)) map.set(name, { n: 0, refused: 0, inTok: 0, outTok: 0, milli: 0, estimated: 0, redacted: {} }); return map.get(name); };
  const alerts = [];
  for (const r of rows) {
    if (!r.ts || periodsOf(Date.parse(r.ts)).month !== month) continue;
    if (r.type === 'alert') { alerts.push(r); continue; }
    if (r.type !== 'use' && r.type !== 'refused') continue;
    for (const s of [total, bump(people, r.person || '不明'), bump(tools, r.tool || '不明')]) {
      if (r.type === 'refused') { s.refused++; continue; }
      s.n++; s.inTok += r.inTok || 0; s.outTok += r.outTok || 0; s.milli += r.costMilliYen || 0;
      if (r.estimated) s.estimated++;
      for (const [k, c] of Object.entries(r.redacted || {})) s.redacted[k] = (s.redacted[k] || 0) + c;
    }
  }
  return { total, people, tools, alerts };
}

const redLine = (red) => {
  const e = Object.entries(red);
  return e.length ? e.map(([k, c]) => `${kindJa(k)} ${c}`).join('・') : 'なし';
};

export function monthlyReport(rows, month, verify, companyName = '（会社名）') {
  const { total, people, tools, alerts } = summarize(rows, month);
  const L = [];
  L.push(`# AI の使用の報告（${month.replace('-', '年')}月）`);
  L.push('');
  L.push(`${companyName} ／ 作成：使いすぎ番（試作）／ 作成日時：${new Date().toISOString().slice(0, 16).replace('T', ' ')}（UTC）`);
  L.push('');
  L.push('## 会社全体');
  L.push(`- 使った回数：${total.n} 回（上限・失敗で止めた回数：${total.refused} 回）`);
  L.push(`- 金額の目安：${fmtYen(total.milli)}（入力 ${total.inTok.toLocaleString()}・出力 ${total.outTok.toLocaleString()} トークン）`);
  if (total.estimated) L.push(`- うち ${total.estimated} 回は AI の会社から使用量が返らず、見込み（多め）で数えた`);
  L.push(`- 送る前に伏せた情報：${redLine(total.redacted)}`);
  L.push('');
  L.push('## 人ごと');
  L.push('| 名前 | 回数 | 金額の目安 | 止めた | 伏せた情報 |');
  L.push('|---|---:|---:|---:|---|');
  for (const [name, s] of [...people].sort((a, b) => b[1].milli - a[1].milli)) L.push(`| ${name} | ${s.n} | ${fmtYen(s.milli)} | ${s.refused} | ${redLine(s.redacted)} |`);
  L.push('');
  L.push('## 道具ごと');
  L.push('| 道具 | 回数 | 金額の目安 | 止めた |');
  L.push('|---|---:|---:|---:|');
  for (const [name, s] of [...tools].sort((a, b) => b[1].milli - a[1].milli)) L.push(`| ${name} | ${s.n} | ${fmtYen(s.milli)} | ${s.refused} |`);
  L.push('');
  L.push('## 知らせ（上限の 8 割・上限に達した等）');
  if (!alerts.length) L.push('- なし');
  for (const a of alerts) L.push(`- ${a.ts.slice(0, 16).replace('T', ' ')} ${a.note}`);
  L.push('');
  L.push('## 記録の確かめ');
  if (verify.ok) {
    L.push(`- 結果：問題なし（${verify.count} 件の記録をすべて計算し直して一致）`);
    if (verify.fingerprint) L.push(`- **指紋：${verify.fingerprint.seq} 番 ${verify.fingerprint.hash}** … この行を紙やメモに残してください。次に確かめる時にこの指紋を入れると、記録が丸ごと作り直されていないかも分かります。`);
  } else {
    L.push(`- 結果：**問題あり**（${verify.reason}${verify.brokenAtSeq ? `・${verify.brokenAtSeq} 番の行から` : ''}）`);
  }
  L.push('');
  L.push('---');
  L.push('金額は公開の単価×為替の目安です。請求の正は AI の会社の請求書です。記録には本文を残していません（伏せた情報は種類と数だけ）。');
  return L.join('\n');
}
