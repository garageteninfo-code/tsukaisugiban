#!/usr/bin/env node
// 起動：node bin/start.mjs [--port 8787] [--host 127.0.0.1] [--data ./data] [--reset-admin]
// 会社の API キーは環境変数で渡す（ファイルに書かない）：TSUKAISUGI_ANTHROPIC_KEY / TSUKAISUGI_OPENAI_KEY
// 社内の別の PC から使う時だけ --host 0.0.0.0（⚠ 平文の http。信頼できる社内の網の中だけで。管理画面はこの PC からだけ）
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway } from '../lib/gateway.mjs';
import { ConfigStore, newSecret } from '../lib/store.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(opt('--data', path.join(here, '..', 'data')));
const port = Number(opt('--port', 8787));
const host = opt('--host', '127.0.0.1');

let resetKey = null;
if (args.includes('--reset-admin')) { resetKey = newSecret('adm_'); new ConfigStore(dataDir).setAdminKey(resetKey); }

const gw = createGateway({ dataDir });
const addr = await gw.listen(port, host);
const shown = gw.firstAdminKey || resetKey;
console.log(`使いすぎ番 起動：http://${addr.address}:${addr.port}`);
console.log(`  管理画面：http://127.0.0.1:${addr.port}/admin （この PC の中からだけ）`);
console.log(`  会社の鍵：Anthropic ${process.env.TSUKAISUGI_ANTHROPIC_KEY ? 'あり' : 'なし'}／OpenAI ${process.env.TSUKAISUGI_OPENAI_KEY ? 'あり' : 'なし'}（中身は表示しません）`);
console.log(`  記録の確かめ：${gw.chain.lastVerify.ok ? '問題なし' : '問題あり：' + gw.chain.lastVerify.reason}`);
if (shown) console.log(`\n  管理画面の鍵（この 1 回だけ表示・控えてください）：${shown}\n`);
const stop = async () => { await gw.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
