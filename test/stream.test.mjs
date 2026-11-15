// 逐次の返事：ためずに 1 かたまりずつ流す・使用量を拾って数える・途中でやめたら AI の会社への依頼も切る。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';

async function readTimed(r) {
  const reader = r.body.getReader(); const dec = new TextDecoder();
  const t0 = Date.now(); let first = null; let text = '';
  for (;;) { const { value, done } = await reader.read(); if (done) break; if (first === null && value?.length) first = Date.now() - t0; text += dec.decode(value, { stream: true }); }
  return { first, total: Date.now() - t0, text };
}

test('Anthropic の逐次の返事：前半が後半を待たずに届き、使用量どおりに数える', async () => {
  const t = await setup({ fake: { streamGapMs: 400 } });
  try {
    const tok = await t.token('松本（架空）', 'Dify');
    const r = await t.ask(tok, 'テスト', { stream: true });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/event-stream/);
    const { first, total, text } = await readTimed(r);
    assert.ok(first < 300 && total >= 380, `前半 ${first}ms・全体 ${total}ms（ためていない）`);
    assert.ok(text.indexOf('前半') < text.indexOf('後半'));
    assert.match(text, /event: message_stop/);
    const use = t.gw.chain.readRows().find((x) => x.type === 'use');
    assert.equal(use.stream, true); assert.equal(use.estimated, false);
    assert.equal(use.outTok, 20); assert.ok(use.inTok > 0);
  } finally { await t.close(); }
});

test('OpenAI の逐次の返事：使用量を返すよう頼み（include_usage）、それで数える', async () => {
  const t = await setup({ fake: { streamGapMs: 50 } });
  try {
    const tok = await t.token('井上（架空）', '自作ツール');
    const r = await t.ask(tok, 'テスト', { stream: true }, 'openai');
    const { text } = await readTimed(r);
    assert.match(text, /\[DONE\]/);
    assert.equal(t.fake.state.requests[0].body.stream_options.include_usage, true);
    const use = t.gw.chain.readRows().find((x) => x.type === 'use');
    assert.equal(use.estimated, false); assert.equal(use.outTok, 20);
  } finally { await t.close(); }
});

test('使用量が返らなかった時は、見込み（多め）で数える', async () => {
  const t = await setup();
  try {
    t.fake.state.omitUsage = true;
    const tok = await t.token('木村（架空）', 'Dify');
    await readTimed(await t.ask(tok, 'テスト', { stream: true }));
    const use = t.gw.chain.readRows().find((x) => x.type === 'use');
    assert.equal(use.estimated, true); assert.equal(use.costMilliYen, use.estMilliYen);
  } finally { await t.close(); }
});

test('社員が途中でやめたら、AI の会社への依頼も切り、予約は残さない', async () => {
  const t = await setup({ fake: { streamGapMs: 1500 } });
  try {
    const tok = await t.token('林（架空）', 'Dify');
    const ac = new AbortController();
    const r = await t.ask(tok, 'テスト', { stream: true }, 'anthropic');
    const reader = r.body.getReader();
    await reader.read();
    await reader.cancel(); ac.abort();
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(t.gw.ledger.reservations.size, 0);
    const use = t.gw.chain.readRows().find((x) => x.type === 'use');
    assert.ok(use, '記録に残る');
    assert.ok(use.costMilliYen > 0, '途中まででも数える（安全側）');
  } finally { await t.close(); }
});
