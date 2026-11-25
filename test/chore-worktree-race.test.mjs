// A chore start whose git worktree add meets a sibling's half-made entry (kit-857). git writes
// .git/worktrees/<name>/commondir by creating it and then filling it, and a git worktree add that
// reads the entry in between dies on the empty file. Here a git on PATH empties a sibling's commondir
// just before the first add (the rest of the start runs as ever), and the test fills it again, or not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const realGit = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HALF = /fatal: failed to read \S*worktrees\/chore-b\/commondir/;

function raceFixture(name) {
  const F = fleetFixture(name);
  const { old, g } = F;
  const wt = (s) => path.join(old, '.worktrees', `chore-${s}`);
  const entry = (s) => path.join(old, '.git', 'worktrees', `chore-${s}`);
  const at = (ref) => { try { return g(['rev-parse', '--verify', '--quiet', ref], old); } catch { return null; } };
  const config = () => { try { return g(['config', '--local', '--get-regexp', '^branch\\.'], old); } catch { return ''; } };
  g(['worktree', 'add', '-q', '-b', 'chore-b', wt('b'), 'main'], old);
  fs.writeFileSync(path.join(wt('b'), 'mine.txt'), 'the sibling\'s own work\n');
  const common = path.join(entry('b'), 'commondir');
  const whole = fs.readFileSync(common, 'utf8');
  // the sibling as it stands: its entry's files, its .git, its branch, its work
  const sibling = () => ({ files: Object.fromEntries(fs.readdirSync(entry('b')).filter((f) => f !== 'commondir' && fs.statSync(path.join(entry('b'), f)).isFile()).sort().map((f) => [f, fs.readFileSync(path.join(entry('b'), f), 'hex')])), git: fs.readFileSync(path.join(wt('b'), '.git'), 'utf8'), tip: at('refs/heads/chore-b'), mine: fs.readFileSync(path.join(wt('b'), 'mine.txt'), 'utf8') });
  const bin = fs.mkdtempSync(path.join(F.base, 'shims-'));
  const tries = path.join(bin, 'tries');
  const armed = path.join(bin, 'empty-it');
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\ncase " $* " in *" worktree add "*) ;; *) exec ${JSON.stringify(realGit)} "$@" ;; esac\nif [ -e ${JSON.stringify(armed)} ]; then rm ${JSON.stringify(armed)}; if [ -e ${JSON.stringify(path.join(bin, 'move-first'))} ]; then rm ${JSON.stringify(path.join(bin, 'move-first'))}; ${JSON.stringify(realGit)} branch -q -f chore-c origin/main || exit 99; fi; : > ${JSON.stringify(common)}; fi\n${JSON.stringify(realGit)} "$@"\ncode=$?\necho "$code" >> ${JSON.stringify(tries)}\nexit $code\n`, { mode: 0o755 });
  const start = (slug) => {
    const t0 = Date.now();
    const c = spawn(process.execPath, [path.join(old, 'docs/devteam/scripts/devteam.mjs'), 'chore', 'start', slug], { cwd: old, env: { ...F.env(SUP), PATH: `${bin}${path.delimiter}${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    return new Promise((resolve) => c.on('close', (status) => resolve({ status, out, err, ms: Date.now() - t0 })));
  };
  // whole lines only: the file is there before its line is
  const codes = () => (fs.existsSync(tries) ? fs.readFileSync(tries, 'utf8').split('\n').slice(0, -1) : []);
  // the first add has failed over the empty commondir
  const failedOnce = async () => {
    const end = Date.now() + 60000;
    while (!codes().length) { assert.ok(Date.now() < end, 'no add was tried in 60 s'); await sleep(20); }
    assert.equal(codes()[0], '128', 'the first add met the empty commondir');
  };
  const arm = () => fs.writeFileSync(armed, '');
  const fill = () => fs.writeFileSync(common, whole);
  return { ...F, wt, entry, at, config, common, sibling, start, bin, codes, failedOnce, arm, fill };
}

test('a start that meets a sibling\'s half-made entry succeeds once the entry is whole', async () => {
  const F = raceFixture('wt-race-whole');
  try {
    const was = F.sibling();
    F.arm();
    const done = F.start('a');
    await F.failedOnce();
    await sleep(300);
    F.fill();
    const r = await done;
    assert.equal(r.status, 0, `the start outlives the half-made entry: ${r.err}`);
    assert.equal(F.g(['rev-parse', '--abbrev-ref', 'HEAD'], F.wt('a')), 'chore-a');
    assert.equal(F.at('refs/heads/chore-a'), F.at('refs/remotes/origin/main'));
    assert.deepEqual(F.sibling(), was, 'the sibling\'s worktree is as it was');
  } finally { F.done(); }
});

test('an entry left half made fails the start within the limit, named, with nothing left behind', async (t) => {
  const F = raceFixture('wt-race-stuck');
  try {
    const was = F.sibling();
    await t.test('a new branch', async () => {
      // a branch whose name goes on from this one's keeps its own config
      F.g(['config', 'branch.chore-a.b.remote', 'origin'], F.old);
      const config = F.config();
      F.arm();
      const r = await F.start('a');
      assert.notEqual(r.status, 0);
      assert.match(r.err, HALF, 'git\'s words stay');
      assert.match(r.err, /the entry chore-b .*half made after 5 s/, 'the entry and the limit are named');
      assert.ok(r.ms >= 5000 && r.ms < 20000, `gave up after ${r.ms} ms`);
      assert.equal(F.at('refs/heads/chore-a'), null, 'no branch is left');
      assert.equal(F.config(), config, 'no branch config is left');
      assert.ok(!fs.existsSync(F.wt('a')), 'no worktree is left');
      assert.ok(!fs.existsSync(F.entry('a')), 'no entry is left');
      assert.equal(fs.readFileSync(F.common, 'utf8'), '', 'the sibling\'s entry is left as it is');
      assert.deepEqual(F.sibling(), was);
    });
    await t.test('a new branch, main moving on during the wait', async () => {
      F.fill();
      fs.unlinkSync(path.join(F.bin, 'tries'));
      F.arm();
      const done = F.start('e');
      await F.failedOnce();
      F.g(['commit', '-q', '--allow-empty', '-m', 'landed meanwhile'], F.old);
      F.g(['push', '-q', 'origin', 'main'], F.old);
      const r = await done;
      assert.match(r.err, /the entry chore-b .*half made after 5 s/);
      assert.equal(F.at('refs/heads/chore-e'), null, 'no branch is left, main having moved');
      assert.doesNotMatch(F.config(), /chore-e\./, 'nor its config');
    });
    await t.test('a branch that was there', async () => {
      F.fill();
      const tip = F.g(['rev-parse', 'main'], F.old);
      F.g(['branch', 'chore-c', tip], F.old);
      F.g(['commit', '-q', '--allow-empty', '-m', 'main moved on'], F.old);
      F.g(['push', '-q', 'origin', 'main'], F.old);
      // a merged branch starts from main: the try moves it there, then meets the empty commondir
      fs.writeFileSync(path.join(F.bin, 'move-first'), '');
      F.arm();
      const r = await F.start('c');
      assert.ok(!fs.existsSync(path.join(F.bin, 'move-first')), 'the try moved the branch');
      assert.notEqual(r.status, 0);
      assert.match(r.err, /the entry chore-b .*half made after 5 s/);
      assert.equal(F.at('refs/heads/chore-c'), tip, 'the branch that was there stays where it was');
      assert.ok(!fs.existsSync(F.wt('c')) && !fs.existsSync(F.entry('c')));
    });
  } finally { F.done(); }
});

test('a worktree another start makes meanwhile is not taken', async () => {
  const F = raceFixture('wt-race-taken');
  try {
    F.arm();
    const done = F.start('a');
    await F.failedOnce();
    await sleep(500); // past the failed try, into the wait
    // another start of the same slug, whose worktree is there by the time the entry is whole
    const tip = F.at('refs/heads/main');
    fs.mkdirSync(F.wt('a'));
    fs.writeFileSync(path.join(F.wt('a'), 'theirs.txt'), 'theirs\n');
    F.fill();
    const r = await done;
    assert.notEqual(r.status, 0);
    assert.deepEqual(fs.readdirSync(F.wt('a')), ['theirs.txt']);
    assert.equal(F.at('refs/heads/chore-a'), tip, 'the branch is left to the one whose worktree is there');
  } finally { F.done(); }
});

test('a failure of any other cause is not retried and keeps git\'s words', async (t) => {
  const F = raceFixture('wt-race-other');
  try {
    await t.test('the branch is checked out elsewhere', async () => {
      const there = path.join(F.old, '.worktrees', 'elsewhere');
      F.g(['worktree', 'add', '-q', '-b', 'chore-a', there, 'main'], F.old);
      const r = await F.start('a');
      assert.equal(r.status, 1);
      assert.deepEqual(F.codes(), ['128'], 'one try');
      assert.match(r.err, /devteam: git -c core\.useReplaceRefs=false worktree add --quiet -B chore-a \S+ \S+ failed: fatal: [^\n]*elsewhere'?\s*$/, 'git\'s words, and no more');
      assert.ok(F.at('refs/heads/chore-a'));
    });
    await t.test('a hook that met the half-made entry, the worktree made', async () => {
      const hook = path.join(F.old, '.git', 'hooks', 'post-checkout');
      fs.mkdirSync(path.dirname(hook), { recursive: true });
      fs.writeFileSync(hook, '#!/bin/sh\necho "fatal: failed to read .git/worktrees/chore-b/commondir: Success" >&2\necho "the hook refused" >&2\nexit 1\n', { mode: 0o755 });
      fs.unlinkSync(path.join(F.bin, 'tries'));
      try {
        const r = await F.start('f');
        assert.equal(r.status, 1);
        assert.deepEqual(F.codes(), ['1'], 'one try over a failing hook');
        assert.match(r.err, /the hook refused\s*$/);
      } finally { fs.unlinkSync(hook); }
    });
    await t.test('a commondir that can\'t be read', { skip: process.getuid() === 0 && 'root reads everything' }, async () => {
      fs.chmodSync(F.common, 0);
      try {
        const r = await F.start('d');
        assert.equal(r.status, 1);
        assert.equal(F.codes().length, 2, 'one try more, this start\'s');
        assert.match(r.err, /chore-b\/commondir: Permission denied\s*$/);
        assert.doesNotMatch(r.err, /half made/);
      } finally { fs.chmodSync(F.common, 0o644); }
    });
  } finally { F.done(); }
});
