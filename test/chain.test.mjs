// 記録の鎖：書き換え・途中の削除・入れ替え・末尾の削除・丸ごとの作り直しに気づく。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { UsageChain, hashOf, GENESIS } from '../lib/chain.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
function fresh(n = 5) {
  const dir = path.join(HERE, 'tmp-chain-' + crypto.randomBytes(4).toString('hex'));
  const c = new UsageChain(dir);
  for (let i = 0; i < n; i++) c.append({ ts: `2026-11-14T0${i}:00:00.000Z`, type: 'use', person: '架空' + i, tool: 'Dify', costMilliYen: 1000 * (i + 1) });
  return { c, dir, file: path.join(dir, 'usage-log.jsonl'), done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const lines = (f) => fs.readFileSync(f, 'utf8').trim().split('\n');
const write = (f, ls) => fs.writeFileSync(f, ls.join('\n') + '\n');

test('手を加えていなければ問題なし・指紋が出る', () => {
  const t = fresh();
  try {
    const v = t.c.verify();
    assert.equal(v.ok, true); assert.equal(v.count, 5); assert.equal(v.fingerprint.seq, 5);
  } finally { t.done(); }
});

test('金額を書き換えると気づく', () => {
  const t = fresh();
  try {
    const ls = lines(t.file); const r = JSON.parse(ls[2]); r.costMilliYen = 1; ls[2] = JSON.stringify(r); write(t.file, ls);
    const v = t.c.verify();
    assert.equal(v.ok, false); assert.equal(v.brokenAtSeq, 3); assert.match(v.reason, /書き換え/);
  } finally { t.done(); }
});

test('途中の行を消すと気づく・入れ替えると気づく', () => {
  const t = fresh();
  try {
    const ls = lines(t.file);
    write(t.file, [ls[0], ls[2], ls[3], ls[4]]);
    assert.equal(t.c.verify().ok, false);
    write(t.file, [ls[0], ls[2], ls[1], ls[3], ls[4]]);
    assert.equal(t.c.verify().ok, false);
  } finally { t.done(); }
});

test('末尾をまとめて消すと、鎖の外の控えで気づく', () => {
  const t = fresh();
  try {
    write(t.file, lines(t.file).slice(0, 3));
    const v = t.c.verify();
    assert.equal(v.ok, false); assert.match(v.reason, /末尾が消されている/);
  } finally { t.done(); }
});

test('記録と控えを丸ごと作り直されても、報告に印刷した指紋で気づく', () => {
  const t = fresh();
  try {
    const fp = t.c.verify().fingerprint;
    // 悪意のある人が 2 番の金額を下げ、鎖を全部計算し直し、控えも書き直す
    const rows = lines(t.file).map((l) => JSON.parse(l));
    rows[1].costMilliYen = 10;
    let prev = GENESIS;
    const out = rows.map((r) => { const { seq, prev: _p, hash: _h, ...body } = r; const hash = hashOf(body, seq, prev); const row = { ...body, seq, prev, hash }; prev = hash; return JSON.stringify(row); });
    write(t.file, out);
    fs.writeFileSync(path.join(t.dir, 'anchor.json'), JSON.stringify({ seq: 5, hash: prev }));
    assert.equal(t.c.verify().ok, true, '鎖と控えだけでは気づけない（正直な限界）');
    const v = t.c.verify(fp);
    assert.equal(v.ok, false); assert.match(v.reason, /指紋と合わない/);
  } finally { t.done(); }
});

test('控えのファイルを消すと気づく', () => {
  const t = fresh();
  try {
    fs.rmSync(path.join(t.dir, 'anchor.json'));
    assert.equal(t.c.verify().ok, false);
  } finally { t.done(); }
});
