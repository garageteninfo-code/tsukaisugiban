// 伏せ字：AI の会社に届く前に伏せる・会社の鍵に付け替える・記録に本文を残さない。データはすべて架空。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, FAKE_COMPANY_KEYS } from './helpers.mjs';

const PHONE = '090-1234-5678';
const CARD = '4111 1111 1111 1111';
const KEY = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const MAIL = 'yamada.taro@example.jp';

test('電話・カード・鍵・メールは AI の会社に届く前に伏せる（Anthropic 形式・system と content の配列も）', async () => {
  const t = await setup();
  try {
    const tok = await t.token('受付（架空）', 'AI受付係');
    const r = await t.ask(tok, [{ type: 'text', text: `お客様の電話は${PHONE}、メールは${MAIL}です。` }, { type: 'text', text: `カード番号 ${CARD}` }],
      { system: `社内の鍵は ${KEY} です` });
    assert.equal(r.status, 200); await r.text();
    const got = t.fake.state.requests[0];
    for (const s of [PHONE, CARD, KEY, MAIL]) assert.ok(!got.raw.includes(s), `${s} が届いていない`);
    assert.match(got.raw, /\[伏せ字:phone\]/); assert.match(got.raw, /\[伏せ字:credit_card\]/); assert.match(got.raw, /\[伏せ字:api_key\]/);
    // 会社の鍵に付け替え、社員の鍵は外へ出さない
    assert.equal(got.headers['x-api-key'], FAKE_COMPANY_KEYS.anthropic);
    assert.ok(!JSON.stringify(got.headers).includes(tok));
    // 記録には種類と数だけ・本文は無い
    const log = fs.readFileSync(path.join(t.dir, 'usage-log.jsonl'), 'utf8');
    for (const s of [PHONE, CARD, KEY, MAIL, 'お客様']) assert.ok(!log.includes(s), `記録に ${s} が無い`);
    const use = t.gw.chain.readRows().find((x) => x.type === 'use');
    assert.deepEqual(Object.keys(use.redacted).sort(), ['api_key', 'credit_card', 'email', 'phone']);
  } finally { await t.close(); }
});

test('OpenAI 形式でも伏せる・道具ごとに「個人情報は伏せない」にしても鍵とカードは伏せる', async () => {
  const t = await setup();
  try {
    await t.admin('settings', { toolName: '予約受付', toolRedactPersonal: false });
    const tok = await t.token('受付（架空）', '予約受付');
    const r = await t.ask(tok, `電話 ${PHONE}・カード番号 ${CARD}・鍵 ${KEY}`, {}, 'openai');
    assert.equal(r.status, 200); await r.text();
    const got = t.fake.state.requests[0];
    assert.equal(got.path, '/v1/chat/completions');
    assert.equal(got.headers.authorization, 'Bearer ' + FAKE_COMPANY_KEYS.openai);
    assert.ok(got.raw.includes(PHONE), 'この道具では電話は伏せない設定');
    assert.ok(!got.raw.includes(CARD) && !got.raw.includes(KEY), 'カードと鍵はいつも伏せる');
  } finally { await t.close(); }
});

test('道具の定義（名前）は壊さず、引数の中の個人情報は伏せる', async () => {
  const t = await setup();
  try {
    const tok = await t.token('開発（架空）', '自作ツール');
    const tools = [{ name: 'lookup_customer', description: `顧客を探す。例：${PHONE}`, input_schema: { type: 'object', properties: { phone: { type: 'string' } } } }];
    const r = await t.ask(tok, 'テスト', { tools }); await r.text();
    const got = t.fake.state.requests[0].body;
    assert.equal(got.tools[0].name, 'lookup_customer');
    assert.ok(!JSON.stringify(got).includes(PHONE));
    assert.equal(got.tools[0].input_schema.type, 'object');
  } finally { await t.close(); }
});
