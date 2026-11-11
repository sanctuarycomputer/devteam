// Speed without a different answer: the batched git reader, reads at a commit, the store of git
// facts that never change, and how many git processes a refresh and an answer start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitReadFns, gitFactFns } from './lib/kit.mjs';

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

test('git facts: kept only when definite, and asked again when what they depend on moves', (t) => {
  const { dir, g } = tmpRepo(t);
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-facts-'));
  t.after(() => fs.rmSync(run, { recursive: true, force: true }));
  const commit = (f) => { fs.writeFileSync(path.join(dir, f), f); g(['add', '-A']); g(['commit', '-qm', f]); return g(['rev-parse', 'HEAD']); };
  const a = commit('a');
  const b = commit('b');
  const F = () => gitFactFns(dir, run);
  const store = () => JSON.parse(fs.readFileSync(path.join(run, 'cache', 'git-facts.json'), 'utf8')).e;

  // a commit's date, and ancestry both ways, are kept and read back without git
  let f = F();
  assert.equal(f.commitDateOf(a), Date.parse(g(['show', '-s', '--format=%cI', a])));
  assert.equal(f.ancestorOf(a, b), true);
  assert.equal(f.ancestorOf(b, a), false);
  f.exit();
  assert.equal(Object.keys(store()).length, 3, 'a date and two ancestry answers');

  // releases: none yet, then a tag, then a release candidate beside it, then the tag deleted
  f = F();
  assert.equal(f.releasedInAt(a), null);
  f.exit();
  g(['tag', 'v2.0.0', b]);
  assert.equal(F().releasedInAt(a), 'v2.0.0', 'a new tag changes the tag list, so the answer is asked again');
  g(['tag', 'v1.9.0-rc1', b]);
  assert.equal(F().releasedInAt(a), 'v2.0.0', 'a release candidate never counts');
  g(['tag', '-d', 'v2.0.0']);
  assert.equal(F().releasedInAt(a), null, 'a deleted tag is noticed');

  // an object that isn't here: no answer, nothing kept; once it arrives, the real one
  const other = tmpRepo(t);
  fs.writeFileSync(path.join(other.dir, 'x'), 'x');
  other.g(['add', '-A']);
  other.g(['commit', '-qm', 'x']);
  const x = other.g(['rev-parse', 'HEAD']);
  f = F();
  assert.equal(f.ancestorOf(x, b), null);
  assert.ok(Number.isNaN(f.commitDateOf(x)));
  f.exit();
  assert.equal(Object.keys(store()).some((k) => k.includes(x)), false, 'an error is never kept');
  g(['fetch', '-q', other.dir, 'main:refs/heads/other']);
  assert.equal(F().ancestorOf(x, 'refs/heads/other'), true);

  // a store that doesn't parse is ignored and written fresh
  fs.writeFileSync(path.join(run, 'cache', 'git-facts.json'), '{ not json');
  f = F();
  assert.equal(f.ancestorOf(a, b), true);
  f.exit();
  assert.equal(store()[Object.keys(store())[0]] !== undefined, true);

  // two processes writing at once: the file parses and holds what each added
  const p1 = F();
  const p2 = F();
  p1.commitDateOf(a);
  p2.commitDateOf(b);
  p1.exit();
  p2.exit();
  const keys = Object.keys(store());
  assert.ok(keys.some((k) => k.endsWith(a)) && keys.some((k) => k.endsWith(b)), 'the second writer reads the first one\'s additions');
});

test('git facts: a shallow clone deepened gets new ancestry answers', (t) => {
  const { dir, g } = tmpRepo(t);
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-facts-'));
  t.after(() => fs.rmSync(run, { recursive: true, force: true }));
  for (const f of ['a', 'b', 'c']) { fs.writeFileSync(path.join(dir, f), f); g(['add', '-A']); g(['commit', '-qm', f]); }
  const first = g(['rev-list', '--max-parents=0', 'HEAD']);
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-shallow-'));
  t.after(() => fs.rmSync(clone, { recursive: true, force: true }));
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${dir}`, clone]);
  let f = gitFactFns(clone, run);
  assert.notEqual(f.ancestorOf(first, 'HEAD'), true, 'not provable in a shallow clone');
  f.exit();
  execFileSync('git', ['fetch', '-q', '--unshallow'], { cwd: clone });
  f = gitFactFns(clone, run);
  assert.equal(f.ancestorOf(first, 'HEAD'), true, 'deepened: asked again');
});
