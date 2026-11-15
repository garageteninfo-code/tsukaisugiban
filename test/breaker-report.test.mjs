// 遮断：AI の会社の誤りが続いたらしばらくすぐ断る。月の報告：日本語で人ごと・道具ごと・伏せた数・指紋。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';

test('誤りが 5 回続いたら、6 回目は AI の会社に送らずに 503', async () => {
  const t = await setup();
  try {
    const tok = await t.token('清水（架空）', 'Dify');
    t.fake.state.failNext = 5;
    for (let i = 0; i < 5; i++) await (await t.ask(tok, 'テスト')).text();
    const r = await t.ask(tok, 'テスト'); const j = await r.json();
    assert.equal(r.status, 503); assert.match(j.error.message, /しばらく止めています/);
    assert.equal(t.fake.state.requests.length, 5);
  } finally { await t.close(); }
});

test('月の報告：人ごとの回数・金額・伏せた情報・知らせ・記録の指紋', async () => {
  const t = await setup({ caps: { company: { day: 100_000, month: null }, defaultPerson: { day: 30, month: null } } });
  try {
    await t.admin('settings', { companyName: '架空工業株式会社' });
    // 名前は NFKC でそろえる（全角のかっこ → 半角）
    const a = await t.token('佐々木（架空）', 'Dify');
    const b = await t.token('山口（架空）', 'AI受付係');
    await (await t.ask(a, 'お客様の電話は 090-1111-2222 です')).text();
    for (let i = 0; i < 5; i++) await (await t.ask(b, 'テスト')).text();
    const month = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7);
    const { status, data } = await t.admin('report?month=' + month);
    assert.equal(status, 200);
    assert.match(data, /架空工業株式会社/);
    assert.match(data, /\| 佐々木\(架空\) \| 1 \|/);
    assert.match(data, /電話番号 1/);
    assert.match(data, /\| 山口\(架空\) \| [1-9] \|/);
    assert.match(data, /止めた回数：[1-9]/);
    assert.match(data, /人「山口\(架空\)」の今日の上限（30円）に達した/);
    assert.match(data, /指紋：\d+ 番 [0-9a-f]{16}/);
    assert.match(data, /請求の正は AI の会社の請求書/);
    assert.ok(!data.includes('090-1111-2222'));
    // 報告の指紋で確かめる口
    const fp = data.match(/指紋：(\d+) 番 ([0-9a-f]{16})/);
    const v = await t.admin('verify', { seq: fp[1], hash: fp[2] });
    assert.equal(v.data.ok, true);
  } finally { await t.close(); }
});
