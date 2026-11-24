// A new session's worktree starts from what origin holds, read by sha, never from a local ref a
// session can write without a push (kit-790). A ticket that hasn't run takes its branch from origin
// or makes it from origin's main: a local ticket/<id> origin doesn't hold at that commit is refused,
// and a tracking ref for a branch origin lacks is ignored. A ticket that ran keeps its local branch
// (its unpushed work: worker --remove keeps it). A linked repo's main is read with an explicit
// refspec, so a session that blanks remote.origin.fetch can't leave a moved origin/<main> in place.
// Each case is its own subtest, so each one's red line is its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, hasTmux, multiFixture, write } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const tmux = { skip: !hasTmux && 'no tmux' };
const git = (args, cwd, input) => execFileSync('git', args, { cwd, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
// a branch's upstream, or null when it has none (git exits 128)
const upstream = (cwd, b) => { try { return git(['rev-parse', '--abbrev-ref', `${b}@{u}`], cwd); } catch { return null; } };
const hasRef = (cwd, ref) => { try { git(['rev-parse', '--verify', '--quiet', ref], cwd); return true; } catch { return false; } };
const marker = (dir) => fs.readFileSync(path.join(dir, 'marker.txt'), 'utf8');
// marker.txt says "real" on a new commit of branch, pushed to origin
function markReal(cwd, branch) {
  write(path.join(cwd, 'marker.txt'), 'real\n');
  git(['add', 'marker.txt'], cwd);
  git(['commit', '-qm', 'marker'], cwd);
  git(['push', '-q', 'origin', branch], cwd);
  return git(['rev-parse', 'HEAD'], cwd);
}
// a local commit on parent whose marker.txt says what, never pushed: what a session can plant
function planted(cwd, parent, what = 'planted') {
  const blob = git(['hash-object', '-w', '--stdin'], cwd, `${what}\n`);
  const entries = git(['ls-tree', parent], cwd).split('\n').filter((l) => l.split('\t')[1] !== 'marker.txt');
  entries.push(`100644 blob ${blob}\tmarker.txt`);
  return git(['commit-tree', git(['mktree'], cwd, `${entries.join('\n')}\n`), '-p', parent, '-m', what], cwd);
}
// the start's act lines, from the live log
const acts = (old) => fs.readdirSync(path.join(old, 'docs/devteam/run/log')).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(old, 'docs/devteam/run/log', f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).filter((x) => x.type === 'act').map((x) => x.what);
// a window's name from "made worker <id> in <session:window> at …", closed on the fixture's own tmux server
const closeWindow = (F, made) => execFileSync('tmux', ['kill-window', '-t', `=${/ in (\S+) at /.exec(made)[1]}`], { env: F.env({}), stdio: 'ignore' });
const ticketJson = (id) => JSON.stringify({ title: id, feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: [`ch/${id}/**`], done_when: ['the tidy check passes in CI'] });

test('home: a new ticket\'s worktree starts from origin, not from local refs', async (t) => {
  const F = fleetFixture('start-from-origin');
  const { old, ok, run } = F;
  const wt = (id) => path.join(old, '.worktrees', id);
  const ticket = (id) => ok(old, ['ticket', 'add', id, '--json', ticketJson(id)], SUP);
  try {
    const real = markReal(old, 'main');
    await t.test('B4: a local ticket branch at origin\'s commit is used', tmux, () => {
      ticket('ch-04-d');
      git(['push', '-q', 'origin', `${real}:refs/heads/ticket/ch-04-d`], old);
      git(['branch', 'ticket/ch-04-d', real], old);
      ok(old, ['worker', 'ch-04-d'], SUP);
      assert.equal(git(['rev-parse', 'HEAD'], wt('ch-04-d')), real, 'B4');
    });
    await t.test('B6: a branch only on origin starts at origin\'s commit and tracks it', tmux, () => {
      ticket('ch-06-f');
      git(['push', '-q', 'origin', `${real}:refs/heads/ticket/ch-06-f`], old);
      ok(old, ['worker', 'ch-06-f'], SUP);
      assert.equal(git(['rev-parse', 'HEAD'], wt('ch-06-f')), real, 'B6');
      assert.equal(upstream(old, 'ticket/ch-06-f'), 'origin/ticket/ch-06-f', 'B6: tracks origin');
    });
    await t.test('B7: a ref on origin whose name only ends in the branch\'s is not the branch', tmux, () => {
      ticket('ch-08-h');
      git(['push', '-q', 'origin', `${real}:refs/heads/x/refs/heads/ticket/ch-08-h`], old);
      git(['push', '-q', 'origin', `${planted(old, real)}:refs/heads/x/refs/heads/main`], old);
      ok(old, ['worker', 'ch-08-h'], SUP);
      assert.equal(git(['rev-parse', 'HEAD'], wt('ch-08-h')), real, 'B7');
      assert.equal(upstream(old, 'ticket/ch-08-h'), 'origin/main', 'B7: tracks main');
    });
    await t.test('H1: a new branch is based on origin\'s main by sha, not on origin/main read again', tmux, () => {
      ticket('ch-07-g');
      // a git on PATH that moves origin/main to a planted commit just before the checkout, as a
      // session could between the launch's read and makeSession's
      const moved = planted(old, real, 'moved');
      const bin = path.join(F.base, 'git-moves-main');
      const said = path.join(F.base, 'moved.txt');
      const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
      write(path.join(bin, 'git'), `#!/bin/sh\ncase " $* " in *" worktree add "*) [ -e '${said}' ] || { '${realGit}' update-ref refs/remotes/origin/main ${moved} && echo moved > '${said}'; } ;; esac\nexec '${realGit}' "$@"\n`);
      fs.chmodSync(path.join(bin, 'git'), 0o755);
      ok(old, ['worker', 'ch-07-g'], { ...SUP, PATH: `${bin}${path.delimiter}${process.env.PATH}` });
      assert.ok(fs.existsSync(said), 'H1: origin/main was moved before the checkout');
      assert.equal(marker(wt('ch-07-g')), 'real\n', 'H1: origin\'s main, not the moved ref');
    });
    await t.test('H3: a checkout that lands on another commit than the one chosen is undone and refused', tmux, () => {
      ticket('ch-14-n');
      // a git on PATH that checks out a planted commit in place of the last argument: what a session
      // that moves the branch while worktree add runs gets
      const moved = planted(old, git(['rev-parse', 'origin/main'], old), 'moved');
      const bin = path.join(F.base, 'git-lands-elsewhere');
      const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
      write(path.join(bin, 'git'), `#!${process.execPath}\nconst a = process.argv.slice(2);\nconst i = a.indexOf('worktree');\nif (i >= 0 && a[i + 1] === 'add') a[a.length - 1] = '${moved}';\nconst r = require('child_process').spawnSync('${realGit}', a, { stdio: 'inherit' });\nprocess.exit(r.status ?? 1);\n`);
      fs.chmodSync(path.join(bin, 'git'), 0o755);
      const r = run(old, ['worker', 'ch-14-n'], { ...SUP, PATH: `${bin}${path.delimiter}${process.env.PATH}` });
      assert.notEqual(r.status, 0, `H3: refused, not started: ${r.out}`);
      assert.match(r.err, /the new worktree holds [0-9a-f]{8}, not [0-9a-f]{8}: .*so nothing was started/, 'H3');
      assert.ok(!fs.existsSync(wt('ch-14-n')), 'H3: no worktree');
      assert.ok(!hasRef(old, 'refs/heads/ticket/ch-14-n'), 'H3: the branch this launch made is gone');
    });
  } finally { F.done(); }
});

test('a linked repo: the worker\'s base is its origin\'s main whatever the checkout\'s remote config says', async (t) => {
  const F = multiFixture('start-from-origin-link');
  const { old, runIn, ticket } = F;
  const wt = (id) => path.join(old, '.worktrees', id);
  try {
    const real = markReal(F.console, 'trunk');
    const moved = planted(F.console, real, 'moved');
    await t.test('L1: a blanked remote.origin.fetch and a moved origin/trunk', tmux, () => {
      ticket('console-01-a');
      git(['config', '--unset-all', 'remote.origin.fetch'], F.console);
      git(['update-ref', 'refs/remotes/origin/trunk', moved], F.console);
      const r = runIn(old, ['worker', 'console-01-a'], SUP);
      assert.equal(r.status, 0, r.err);
      assert.equal(git(['rev-parse', 'HEAD'], wt('console-01-a')), real, 'L1: origin\'s trunk');
    });
    await t.test('L2: an unset remote.origin.url and a moved origin/trunk', tmux, () => {
      ticket('console-02-b');
      const url = git(['config', '--get', 'remote.origin.url'], F.console);
      git(['config', '--unset', 'remote.origin.url'], F.console);
      git(['update-ref', 'refs/remotes/origin/trunk', moved], F.console);
      try {
        const r = runIn(old, ['worker', 'console-02-b'], SUP);
        assert.notEqual(r.status, 0, `L2: refused, not started: ${r.out}`);
        assert.match(r.err, /is a checkout of nothing|in console: it has no origin url/, 'L2: says why');
        assert.ok(!fs.existsSync(wt('console-02-b')), 'L2: no worktree');
      } finally { git(['config', 'remote.origin.url', url], F.console); }
    });
  } finally { F.done(); }
});
