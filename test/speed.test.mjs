// Speed without a different answer: the batched git reader, reads at a commit, the store of git
// facts that never change, and how many git processes a refresh and an answer start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitReadFns } from './lib/kit.mjs';

const tmpRepo = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-speed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const g = (args, cwd = dir) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  g(['init', '-q', '-b', 'main']);
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) g(['config', k, v]);
  return { dir, g };
};

test('the batched reader: each file reads back exactly as git show gives it', (t) => {
  const { dir, g } = tmpRepo(t);
  const files = {
    'log/multi.jsonl': '{"detail":"naïve — em dash ✓ 日本"}\n{"b":2}\n',
    'log/no-newline.jsonl': '{"a":1}',
    'log/empty.jsonl': '',
    'log/two-newlines.jsonl': 'x\n\n',
    'a dir/with space.md': '# spaced\n',
  };
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), body); }
  const bin = crypto.randomBytes(5000);
  fs.writeFileSync(path.join(dir, 'blob.bin'), bin);
  g(['add', '-A']);
  g(['commit', '-qm', 'files']);
  const sha = g(['rev-parse', 'HEAD']);
  const R = gitReadFns(dir);
  const all = [...Object.keys(files), 'blob.bin', 'log/missing.jsonl'];
  R.prefetchAt(sha, all);
  for (const f of all) assert.equal(R.showAt(sha, f), R.git(['show', `${sha}:${f}`]), `${f} reads as git show gives it`);
  const batch = R.gitBatch([`${sha}:blob.bin`, `${sha}:nope`]);
  assert.ok(Buffer.compare(batch.get(`${sha}:blob.bin`).bytes, bin) === 0, 'bytes come back whole');
  assert.equal(batch.get(`${sha}:nope`), null, 'a missing path is null');
  assert.equal(R.gitBatch([`${sha}:a\nb`]).get(`${sha}:a\nb`), null, 'a spec with a newline is never sent');
  // a ref name isn't kept: it can move
  assert.equal(R.showAt('main', 'log/multi.jsonl'), R.git(['show', 'main:log/multi.jsonl']));
  assert.equal([...R.atCommit.keys()].some((k) => k.includes('\0main\0')), false, 'a ref name never enters the memo');
});

test('the batched reader: output cut short leaves the rest missing, never a slice of the next object', (t) => {
  const { dir, g } = tmpRepo(t);
  fs.writeFileSync(path.join(dir, 'a'), 'aaaa\n');
  fs.writeFileSync(path.join(dir, 'b'), 'bbbb\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'ab']);
  const sha = g(['rev-parse', 'HEAD']);
  const R = gitReadFns(dir);
  const specs = [`${sha}:a`, `${sha}:b`];
  const full = execFileSync('git', ['cat-file', '--batch'], { cwd: dir, input: `${specs.join('\n')}\n` });
  for (let cut = 0; cut < full.length; cut++) {
    const got = R.parseBatch(full.subarray(0, cut), specs);
    for (const s of specs) { const o = got.get(s); if (o) assert.equal(o.bytes.toString(), s.endsWith(':a') ? 'aaaa\n' : 'bbbb\n', `cut at ${cut}`); }
  }
  const whole = R.parseBatch(full, specs);
  assert.equal(whole.get(specs[1]).bytes.toString(), 'bbbb\n');
});
