// 試験の準備：にせの AI の会社＋使いすぎ番を、空いている番号で立ち上げる。データは test の下の一時フォルダ（終わったら消す）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createGateway } from '../lib/gateway.mjs';
import { createFakeUpstream } from './fakeUpstream.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FAKE_COMPANY_KEYS = { anthropic: 'fake-company-anthropic-key-0000', openai: 'fake-company-openai-key-0000' };
export const ADMIN_KEY = 'adm_test_only_' + crypto.randomBytes(6).toString('hex');

export async function setup(o = {}) {
  const dir = path.join(HERE, 'tmp-' + crypto.randomBytes(4).toString('hex'));
  const fake = createFakeUpstream(o.fake || {});
  const upBase = await fake.listen();
  const gw = createGateway({ dataDir: dir, upstreams: { anthropic: upBase, openai: upBase }, keys: FAKE_COMPANY_KEYS, adminKey: ADMIN_KEY });
  // 試験用の単価：1 トークン 0.15 円（1,000 米ドル／100 万トークン × 150 円）＝金額の動きが見やすい
  gw.store.data.prices['fake-model'] = { input: 1000, output: 1000, provisional: false };
  Object.assign(gw.store.data.settings, o.settings || {});
  if (o.caps) Object.assign(gw.store.data.caps, o.caps);
  gw.store.save();
  const addr = await gw.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}`;
  const admin = async (p, body) => {
    const r = await fetch(base + '/admin/api/' + p, body === undefined ? { headers: { authorization: 'Bearer ' + ADMIN_KEY } }
      : { method: 'POST', headers: { authorization: 'Bearer ' + ADMIN_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const t = r.headers.get('content-type') || '';
    return { status: r.status, data: t.includes('json') ? await r.json() : await r.text() };
  };
  const token = async (person, tool) => (await admin('tokens', { person, tool })).data.token;
  const ask = (tok, text, extra = {}, provider = 'anthropic') => fetch(base + (provider === 'anthropic' ? '/anthropic/v1/messages' : '/openai/v1/chat/completions'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(provider === 'anthropic' ? { 'x-api-key': tok, 'anthropic-version': '2023-06-01' } : { authorization: 'Bearer ' + tok }) },
    body: JSON.stringify({ model: 'fake-model', max_tokens: 20, messages: [{ role: 'user', content: text }], ...extra }),
  });
  return {
    gw, fake, base, dir, admin, token, ask,
    async close() { await gw.close(); await fake.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}
