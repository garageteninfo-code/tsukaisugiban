// 上限：同時にたくさん送っても、会社・人・道具の上限を超えない（送る前の予約）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';

const usedRows = (t) => t.gw.chain.readRows().filter((r) => r.type === 'use');

test('会社の 1 日の上限：同時に 30 件送っても上限を超えない', async () => {
  const t = await setup({ fake: { delayMs: 150 }, caps: { company: { day: 100, month: 1000 }, defaultPerson: { day: null, month: null } } });
  try {
    const tok = await t.token('佐藤（架空）', 'Dify');
    const res = await Promise.all(Array.from({ length: 30 }, () => t.ask(tok, 'こんにちは。見積もりの文を考えてください。')));
    const codes = res.map((r) => r.status);
    await Promise.all(res.map((r) => r.text()));
    const ok = codes.filter((c) => c === 200).length;
    const refused = codes.filter((c) => c === 429).length;
    const rows = usedRows(t);
    const est = rows[0].estMilliYen;
    const total = rows.reduce((s, r) => s + r.costMilliYen, 0);
    assert.equal(ok + refused, 30);
    assert.equal(ok, Math.floor(100_000 / est), `見込み ${est / 1000} 円で 100 円まで＝${Math.floor(100_000 / est)} 件のはず`);
    assert.ok(total <= 100_000, `合計 ${total / 1000} 円が上限 100 円以下`);
    assert.ok(t.fake.state.maxInflight >= 2, '本当に同時に走っていた');
    assert.equal(t.fake.state.requests.length, ok, '止めた依頼は AI の会社へ 1 件も届いていない');
    assert.equal(t.gw.ledger.reservations.size, 0, '予約が残っていない');
    // 止めた依頼は記録に残り、知らせも出る
    assert.equal(t.gw.chain.readRows().filter((r) => r.type === 'refused' && r.reason === 'spend_limit').length, refused);
    assert.ok(t.gw.chain.readRows().some((r) => r.type === 'alert' && r.scope === 'company'));
  } finally { await t.close(); }
});

test('人の上限と道具の上限：別々に効く・ほかの人は止まらない', async () => {
  const t = await setup({ fake: { delayMs: 80 }, caps: { company: { day: 10_000, month: 100_000 }, defaultPerson: { day: 40, month: null }, tool: { '受付ボット': { day: 25, month: null } } } });
  try {
    const a = await t.token('田中（架空）', 'Dify');
    const b = await t.token('鈴木（架空）', 'Dify');
    const c = await t.token('鈴木（架空）', '受付ボット');
    const ra = await Promise.all(Array.from({ length: 10 }, () => t.ask(a, 'テスト')));
    const rb = await Promise.all(Array.from({ length: 10 }, () => t.ask(c, 'テスト')));
    await Promise.all([...ra, ...rb].map((r) => r.text()));
    const rows = usedRows(t);
    const sum = (f) => rows.filter(f).reduce((s, r) => s + r.costMilliYen, 0);
    assert.ok(sum((r) => r.person === '田中（架空）') <= 40_000, '田中さんは 1 日 40 円まで');
    assert.ok(sum((r) => r.tool === '受付ボット') <= 25_000, '受付ボットは 1 日 25 円まで');
    assert.ok(ra.some((r) => r.status === 429) && rb.some((r) => r.status === 429));
    // 鈴木さんは Dify ではまだ使える（人の上限 40 円のうち受付ボットで 25 円以下しか使っていない）
    const r2 = await t.ask(b, 'テスト'); await r2.text();
    assert.equal(r2.status, 200);
  } finally { await t.close(); }
});

test('AI の会社が誤りを返した時は数えず、予約も外れる', async () => {
  const t = await setup({ caps: { company: { day: 30, month: null }, defaultPerson: { day: null, month: null } } });
  try {
    const tok = await t.token('山本（架空）', 'Dify');
    t.fake.state.failNext = 3;
    for (let i = 0; i < 3; i++) { const r = await t.ask(tok, 'テスト'); await r.text(); assert.equal(r.status, 500); }
    assert.equal(t.gw.ledger.reservations.size, 0);
    assert.equal(usedRows(t).reduce((s, r) => s + r.costMilliYen, 0), 0);
    const r = await t.ask(tok, 'テスト'); await r.text();
    assert.equal(r.status, 200, '誤りの分で上限を食っていない');
  } finally { await t.close(); }
});

test('出力の上限：大きすぎる max_tokens は下げて送る・単価の無いモデルは送らない', async () => {
  const t = await setup({ settings: { maxOutputTokens: 50 }, caps: { company: { day: 100_000, month: null } } });
  try {
    const tok = await t.token('伊藤（架空）', 'Dify');
    const r = await t.ask(tok, 'テスト', { max_tokens: 100000 }); await r.text();
    assert.equal(r.status, 200);
    assert.equal(t.fake.state.requests[0].body.max_tokens, 50);
    const r2 = await t.ask(tok, 'テスト', { model: 'unknown-model-x' }); const j = await r2.json();
    assert.equal(r2.status, 400);
    assert.match(j.error.message, /単価が登録されていない/);
    assert.equal(t.fake.state.requests.length, 1);
  } finally { await t.close(); }
});

test('再起動しても今日の使用量は記録から戻る（上限がリセットされない）', async () => {
  const t = await setup({ caps: { company: { day: 100, month: null }, defaultPerson: { day: null, month: null } } });
  try {
    const tok = await t.token('高橋（架空）', 'Dify');
    for (let i = 0; i < 3; i++) await (await t.ask(tok, 'テスト')).text();
    const before = t.gw.ledger.usedOf(t.gw.ledger.constructor.keysFor('高橋（架空）', 'Dify', Date.now())[0].key);
    const { createGateway } = await import('../lib/gateway.mjs');
    const gw2 = createGateway({ dataDir: t.dir, keys: {}, adminKey: 'adm_x' });
    const after = gw2.ledger.usedOf(gw2.ledger.constructor.keysFor('高橋（架空）', 'Dify', Date.now())[0].key);
    assert.ok(before > 0);
    assert.equal(after, before);
  } finally { await t.close(); }
});
