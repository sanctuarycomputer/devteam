// box-pins changed --smoke cleans up after itself: stopped by a signal or mid-reader, run from a git
// hook, and the worktrees it and an interrupted add leave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, cg, changedKit, changedRepo, fakeBins, leftNothing, lsOr, nextSmokeRun, onBranch, pinsEnv, SCRIPT, smokeRun, tmp } from './lib/machine-fixture.mjs';

test('box-pins changed --smoke stopped by a signal exits 2 and leaves nothing', async () => {
  changedKit();
  cg(['checkout', '-q', '-B', 'smoke-signal', 'v9.1.0']);
  const tmpd = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'smoke-tmp-')));
  let killed = false;
  const done = new Promise((resolve) => {
    const c = execFile(process.execPath, [path.join(changedRepo, SCRIPT), 'box-pins', 'changed', '--since', 'v9.1.0', '--smoke'], { cwd: changedRepo, encoding: 'utf8', env: pinsEnv({ TMPDIR: tmpd }), timeout: 600000 }, (err, stdout, stderr) => resolve({ status: err ? err.code : 0, signal: err?.signal ?? null, stdout, stderr }));
    // once the first fixture is being made, mid-run
    const poll = setInterval(() => {
      const made = lsOr(tmpd).some((d) => fs.existsSync(path.join(tmpd, d, 'since', 'smoke-fixture')));
      if (made && !killed) { killed = true; clearInterval(poll); c.kill('SIGTERM'); }
    }, 50);
    c.on('close', () => clearInterval(poll));
  });
  const r = await done;
  assert.ok(killed, 'the signal was sent mid-run');
  assert.equal(r.status, 2, `${r.signal} ${r.stderr}${r.stdout}`);
  assert.equal(r.stdout, '');
  leftNothing(tmpd);
});

test('box-pins changed --smoke runs from a git hook\'s environment: GIT_DIR and its relatives reach no fixture', () => {
  changedKit();
  cg(['checkout', '-q', '-B', 'smoke-hook', 'v9.1.0']);
  const head = cg(['rev-parse', 'HEAD']);
  const gitDir = path.join(changedRepo, '.git');
  const s = smokeRun(['--since', 'v9.1.0', '--to', 'v9.1.0'], { GIT_DIR: gitDir, GIT_WORK_TREE: changedRepo, GIT_INDEX_FILE: path.join(gitDir, 'index'), GH_TOKEN: 'smoke-not-a-token' });
  assert.equal(s.r.status, 0, s.r.stderr + s.r.stdout);
  assert.equal(s.r.stdout, 'kind: patch\n');
  assert.equal(cg(['rev-parse', 'HEAD']), head, 'the caller\'s repo is untouched');
  assert.equal(cg(['status', '--porcelain']), '');
  leftNothing(s.tmpd);
});

test('box-pins changed --smoke stopped mid-reader kills what the reader started too', async () => {
  // the --to kit, read by the image as a project's kit (DEVTEAM_ROLE=operator), hangs, then writes
  onBranch('smoke-orphan', { [SCRIPT]: after('function cmdHello() {\n', "  if (process.env.DEVTEAM_ROLE === 'operator') { execFileSync('sleep', ['6']); const d = path.join(path.dirname(process.argv[1]), '..', 'run', 'late'); fs.mkdirSync(d, { recursive: true }); }\n") });
  const tmpd = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'smoke-tmp-')));
  const trace = path.join(tmp, `smoke-trace-${nextSmokeRun()}.jsonl`);
  let killed = false;
  const r = await new Promise((resolve) => {
    const c = execFile(process.execPath, [path.join(changedRepo, SCRIPT), 'box-pins', 'changed', '--since', 'v9.1.0', '--smoke'], { cwd: changedRepo, encoding: 'utf8', env: pinsEnv({ TMPDIR: tmpd, DEVTEAM_SMOKE_TRACE: trace }), timeout: 600000 }, (err, stdout, stderr) => resolve({ status: err ? err.code : 0, signal: err?.signal ?? null, stdout, stderr }));
    // the --since fixture's four readers are done: the --to fixture's first reader is hanging in hello
    let seen = 0;
    const poll = setInterval(() => {
      const n = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).length : 0;
      if (n >= 4 && !seen) seen = Date.now();
      if (seen && Date.now() - seen > 2000 && !killed) { killed = true; clearInterval(poll); c.kill('SIGTERM'); }
    }, 50);
    c.on('close', () => clearInterval(poll));
  });
  assert.ok(killed, 'the signal was sent mid-reader');
  assert.equal(r.status, 2, `${r.signal} ${r.stderr}${r.stdout}`);
  assert.equal(r.stdout, '');
  // long enough for an orphaned hello to wake and write
  await new Promise((resolve) => setTimeout(resolve, 8000));
  leftNothing(tmpd);
});

test('box-pins changed --smoke removes its own worktree and leaves another stale record alone (kit-306)', () => {
  changedKit();
  cg(['checkout', '-q', '-B', 'smoke-stale', 'v9.1.0']);
  // a worktree of the caller's whose folder is gone: a prune would drop its record, the smoke must not
  const stale = path.join(fs.realpathSync(tmp), 'stale-wt');
  cg(['worktree', 'add', '-q', '--detach', stale, 'v9.1.0']);
  fs.rmSync(stale, { recursive: true, force: true });
  let tmpd;
  try {
    const s = smokeRun(['--since', 'v9.1.0', '--to', 'v9.1.0']);
    tmpd = s.tmpd;
    assert.equal(s.r.status, 0, s.r.stderr + s.r.stdout);
    assert.equal(s.r.stdout, 'kind: patch\n');
    const listed = cg(['worktree', 'list', '--porcelain']).split('\n').filter((l) => l.startsWith('worktree '));
    assert.ok(listed.includes(`worktree ${stale}`), `the stale record is still there\n${listed.join('\n')}`);
    assert.equal(listed.length, 2, `the main checkout and the stale record; the smoke's own is gone\n${listed.join('\n')}`);
  } finally {
    cg(['worktree', 'prune']);
  }
  leftNothing(tmpd);
});

test('box-pins changed --smoke removes a worktree an interrupted add left locked "initializing" (kit-306)', () => {
  changedKit();
  cg(['checkout', '-q', '-B', 'smoke-locked', 'v9.1.0']);
  // a git on PATH whose worktree add makes the worktree, leaves it locked as an add cut short does,
  // and fails: the smoke dies (2), and its cleanup must still remove that worktree and its record
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const shim = fakeBins('locked-git', { git: `w=; if [ "$1" = worktree ] && [ "$2" = add ]; then w=$5; elif [ "$1" = -c ] && [ "$3" = worktree ] && [ "$4" = add ]; then w=$7; fi\nif [ -n "$w" ]; then "${realGit}" "$@" || exit 1; "${realGit}" worktree lock --reason initializing "$w" || exit 1; exit 1; fi\nexec "${realGit}" "$@"` });
  const s = smokeRun(['--since', 'v9.1.0'], { PATH: `${shim}${path.delimiter}${pinsEnv().PATH}` });
  assert.equal(s.r.status, 2, s.r.stderr + s.r.stdout);
  assert.equal(s.r.stdout, '');
  assert.match(s.r.stderr, /^devteam: box-pins changed: --smoke: git worktree add of [0-9a-f]{40} failed \(exit 1\)/m);
  leftNothing(s.tmpd);
});
