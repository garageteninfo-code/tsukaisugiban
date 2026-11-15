#!/usr/bin/env node
// 見本：にせの AI の会社＋使いすぎ番を立ち上げ、架空の社員 3 人で何回か使ってから、管理画面を開ける状態にする。
// 本物の AI は呼ばない・API キーは要らない。データは「一時_見本」フォルダ（終わったら消してよい）。
// 使い方：node bin/demo.mjs [--port 8788]  → 表示された管理画面の住所と鍵で開く。Ctrl+C で止める。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway } from '../lib/gateway.mjs';
import { createFakeUpstream } from '../test/fakeUpstream.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..', '一時_見本');
fs.rmSync(dir, { recursive: true, force: true });
const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 8788;
const fake = createFakeUpstream({ delayMs: 30 });
const up = await fake.listen();
const ADMIN = 'adm_demo_only_not_secret';
const gw = createGateway({ dataDir: dir, upstreams: { anthropic: up, openai: up }, keys: { anthropic: 'fake-key', openai: 'fake-key' }, adminKey: ADMIN });
gw.store.data.prices['fake-model'] = { input: 1000, output: 1000, provisional: false };
gw.store.data.settings.companyName = '架空工業株式会社';
gw.store.data.caps.company = { day: 500, month: 5000 };
gw.store.data.caps.defaultPerson = { day: 60, month: 600 };
gw.store.data.caps.tool['AI受付係'] = { day: 100, month: 1000 };
gw.store.data.toolOptions['AI受付係'] = { redactPersonal: false };
gw.store.save();
await gw.listen(port, '127.0.0.1');
const base = `http://127.0.0.1:${port}`;
const issue = async (person, tool) => (await (await fetch(base + '/admin/api/tokens', { method: 'POST', headers: { authorization: 'Bearer ' + ADMIN, 'content-type': 'application/json' }, body: JSON.stringify({ person, tool }) })).json()).token;
const ask = (tok, text) => fetch(base + '/anthropic/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': tok }, body: JSON.stringify({ model: 'fake-model', max_tokens: 20, messages: [{ role: 'user', content: text }] }) }).then((r) => r.text());
const a = await issue('佐藤(架空)', 'Dify'), b = await issue('田中(架空)', 'Dify'), c = await issue('受付(架空)', 'AI受付係');
for (let i = 0; i < 3; i++) await ask(a, `見積もりの文を作って。お客様の電話は 090-0000-000${i} です`);
for (let i = 0; i < 8; i++) await ask(b, '社内の鍵は sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 です。要約して');
for (let i = 0; i < 4; i++) await ask(c, '予約：氏名：山田太郎、電話 06-0000-0000');
console.log(`見本の管理画面：${base}/admin`);
console.log(`管理画面の鍵（見本用）：${ADMIN}`);
const stop = async () => { await gw.close(); await fake.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
