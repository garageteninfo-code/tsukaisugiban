// 鍵：社員の鍵が無い・違う・無効なら通さない。管理画面は鍵・この PC・宛先の名前を確かめる。厳しい CSP。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setup, ADMIN_KEY } from './helpers.mjs';

test('社員の鍵：無い・違う・無効にした鍵は 401 で、AI の会社に届かない', async () => {
  const t = await setup();
  try {
    assert.equal((await t.ask('', 'テスト')).status, 401);
    assert.equal((await t.ask('tsk_wrongwrongwrong', 'テスト')).status, 401);
    const tok = await t.token('中村（架空）', 'Dify');
    const ok = await t.ask(tok, 'テスト'); await ok.text();
    assert.equal(ok.status, 200);
    const id = t.gw.store.data.tokens[0].id;
    assert.equal((await t.admin('tokens/revoke', { id })).status, 200);
    assert.equal((await t.ask(tok, 'テスト')).status, 401);
    assert.equal(t.fake.state.requests.length, 1);
    // 設定のファイルに鍵そのものは無い（指紋だけ）
    assert.ok(!JSON.stringify(t.gw.store.data).includes(tok));
    assert.ok(!JSON.stringify(t.gw.store.data).includes(ADMIN_KEY));
  } finally { await t.close(); }
});

test('管理画面：鍵が無い・違うと 401、宛先の名前が違うと 403（DNS の付け替え対策）', async () => {
  const t = await setup();
  try {
    assert.equal((await fetch(t.base + '/admin/api/state')).status, 401);
    assert.equal((await fetch(t.base + '/admin/api/state', { headers: { authorization: 'Bearer adm_wrong' } })).status, 401);
    assert.equal((await t.admin('state')).status, 200);
    const port = new URL(t.base).port;
    const status = await new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port, path: '/admin/api/state', headers: { host: 'evil.example:' + port, authorization: 'Bearer ' + ADMIN_KEY } }, (r) => { r.resume(); resolve(r.statusCode); });
    });
    assert.equal(status, 403);
  } finally { await t.close(); }
});

test('管理画面のページ：厳しい CSP・外の読み込み無し・社員の鍵では管理の操作ができない', async () => {
  const t = await setup();
  try {
    const r = await fetch(t.base + '/admin');
    const html = await r.text();
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /default-src 'none'/); assert.match(csp, /script-src 'self'/); assert.match(csp, /frame-ancestors 'none'/);
    assert.ok(!/https?:\/\//.test(html.replace(/http:\/\/この PC/g, '')), '外の URL を読み込まない');
    assert.ok(!/<script>|style=|onclick=/i.test(html), 'インラインのスクリプト・スタイルが無い');
    const tok = await t.token('小林（架空）', 'Dify');
    assert.equal((await fetch(t.base + '/admin/api/state', { headers: { authorization: 'Bearer ' + tok } })).status, 401);
  } finally { await t.close(); }
});

test('管理の操作は記録の鎖に残る（鍵そのものは残さない）', async () => {
  const t = await setup();
  try {
    const tok = await t.token('加藤（架空）', 'Dify');
    await t.admin('caps', { scope: 'person', name: '加藤（架空）', day: 50, month: 500 });
    const rows = t.gw.chain.readRows().filter((r) => r.type === 'admin');
    assert.deepEqual(rows.map((r) => r.action), ['鍵の発行', '上限の変更']);
    assert.ok(!JSON.stringify(rows).includes(tok));
  } finally { await t.close(); }
});
