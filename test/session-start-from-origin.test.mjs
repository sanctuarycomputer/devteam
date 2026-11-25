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
    await t.test('B1: a local ticket branch origin doesn\'t have is refused', tmux, () => {
      ticket('ch-01-a');
      git(['branch', 'ticket/ch-01-a', planted(old, real)], old);
      const r = run(old, ['worker', 'ch-01-a'], SUP);
      assert.notEqual(r.status, 0, `B1: refused, not started: ${r.out}`);
      assert.match(r.err, /origin has no ticket\/ch-01-a, so nothing was started/, 'B1');
      assert.ok(!fs.existsSync(wt('ch-01-a')), 'B1: no worktree');
    });
    await t.test('B2: a local ticket branch at another commit than origin\'s is refused', tmux, () => {
      ticket('ch-02-b');
      git(['push', '-q', 'origin', `${real}:refs/heads/ticket/ch-02-b`], old);
      git(['branch', 'ticket/ch-02-b', planted(old, real)], old);
      const r = run(old, ['worker', 'ch-02-b'], SUP);
      assert.notEqual(r.status, 0, `B2: refused, not started: ${r.out}`);
      assert.match(r.err, /but origin's is at [0-9a-f]{8}, so nothing was started/, 'B2');
      assert.ok(!fs.existsSync(wt('ch-02-b')), 'B2: no worktree');
    });
    await t.test('B3: a tracking ref for a branch origin lacks is ignored, with a word', tmux, () => {
      ticket('ch-03-c');
      git(['update-ref', 'refs/remotes/origin/ticket/ch-03-c', planted(old, real)], old);
      const r = run(old, ['worker', 'ch-03-c'], SUP);
      assert.equal(r.status, 0, r.err);
      assert.equal(git(['rev-parse', 'HEAD'], wt('ch-03-c')), real, 'B3: from origin\'s main');
      assert.match(r.err, /tracking ref here \([0-9a-f]{8}\) is ignored/, 'B3: says so');
      assert.ok(!hasRef(old, 'refs/remotes/origin/ticket/ch-03-c'), 'B3: the stale tracking ref is gone');
    });
    await t.test('B4: a local ticket branch at origin\'s commit is used', tmux, () => {
      ticket('ch-04-d');
      git(['push', '-q', 'origin', `${real}:refs/heads/ticket/ch-04-d`], old);
      git(['branch', 'ticket/ch-04-d', real], old);
      ok(old, ['worker', 'ch-04-d'], SUP);
      assert.equal(git(['rev-parse', 'HEAD'], wt('ch-04-d')), real, 'B4');
    });
    await t.test('B5: a ticket that ran keeps its local branch (worker --remove keeps it)', tmux, () => {
      ticket('ch-05-e');
      ok(old, ['worker', 'ch-05-e'], SUP);
      write(path.join(wt('ch-05-e'), 'ch/ch-05-e/work.txt'), 'unpushed\n');
      git(['add', '-A'], wt('ch-05-e'));
      git(['commit', '-qm', 'unpushed work'], wt('ch-05-e'));
      const head = git(['rev-parse', 'HEAD'], wt('ch-05-e'));
      ok(old, ['worker', 'ch-05-e', '--remove', '--force'], SUP);
      const r = run(old, ['worker', 'ch-05-e', '--resume'], SUP);
      assert.equal(r.status, 0, r.err);
      assert.equal(git(['rev-parse', 'HEAD'], wt('ch-05-e')), head, 'B5');
      assert.match(r.err, /ticket\/ch-05-e starts at [0-9a-f]{8}, 1 commit origin doesn't hold yet/, 'B5: says so');
      assert.ok(acts(old).some((w) => /^made worker ch-05-e .*1 commit origin doesn't hold yet/.test(w)), 'B5: in the start\'s act');
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
      try {
        ok(old, ['worker', 'ch-08-h'], SUP);
        assert.equal(git(['rev-parse', 'HEAD'], wt('ch-08-h')), real, 'B7');
        assert.equal(upstream(old, 'ticket/ch-08-h'), 'origin/main', 'B7: tracks main');
      } finally { git(['push', '-q', 'origin', ':refs/heads/x/refs/heads/main', ':refs/heads/x/refs/heads/ticket/ch-08-h'], old); }
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
    await t.test('H2: a local branch moved between the read and the checkout is refused, not used', tmux, () => {
      ticket('ch-10-j');
      git(['push', '-q', 'origin', `${real}:refs/heads/ticket/ch-10-j`], old);
      git(['branch', 'ticket/ch-10-j', real], old);
      const moved = planted(old, real, 'moved');
      const bin = path.join(F.base, 'git-moves-branch');
      const said = path.join(F.base, 'moved-branch.txt');
      const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
      write(path.join(bin, 'git'), `#!/bin/sh\ncase " $* " in *" worktree add "*) [ -e '${said}' ] || { '${realGit}' update-ref refs/heads/ticket/ch-10-j ${moved} && echo moved > '${said}'; } ;; esac\nexec '${realGit}' "$@"\n`);
      fs.chmodSync(path.join(bin, 'git'), 0o755);
      const r = run(old, ['worker', 'ch-10-j'], { ...SUP, PATH: `${bin}${path.delimiter}${process.env.PATH}` });
      assert.ok(fs.existsSync(said), 'H2: the branch was moved before the checkout');
      assert.notEqual(r.status, 0, `H2: refused, not started: ${r.out}`);
      assert.match(r.err, /the new worktree holds [0-9a-f]{8}, not [0-9a-f]{8}: .*so nothing was started/, 'H2');
      assert.ok(!fs.existsSync(wt('ch-10-j')), 'H2: no worktree');
    });
    await t.test('B9: a ticket that ran, its local branch diverged from origin\'s, is refused', tmux, () => {
      ticket('ch-11-k');
      ok(old, ['worker', 'ch-11-k'], SUP);
      ok(old, ['worker', 'ch-11-k', '--remove', '--force'], SUP);
      git(['push', '-q', 'origin', `${planted(old, real, 'origin-side')}:refs/heads/ticket/ch-11-k`], old);
      git(['branch', '-f', 'ticket/ch-11-k', planted(old, real, 'local-side')], old);
      const r = run(old, ['worker', 'ch-11-k', '--resume'], SUP);
      assert.notEqual(r.status, 0, `B9: refused, not started: ${r.out}`);
      assert.match(r.err, /and neither holds the other, so nothing was started/, 'B9');
      assert.ok(!fs.existsSync(wt('ch-11-k')), 'B9: no worktree');
    });
    await t.test('B8: a stopped launch\'s branch, behind origin\'s main, starts at origin\'s main with a word', tmux, () => {
      ticket('ch-12-l');
      const made = ok(old, ['worker', 'ch-12-l'], SUP);
      // a launch that never ran: its worktree and window gone, its branch (the kit's) left at the old main
      ok(old, ['worker', 'ch-12-l', '--remove', '--force'], SUP);
      closeWindow(F, made);
      write(path.join(old, 'marker.txt'), 'newer\n');
      git(['commit', '-qam', 'newer'], old);
      git(['push', '-q', 'origin', 'main'], old);
      const newer = git(['rev-parse', 'HEAD'], old);
      const r = run(old, ['worker', 'ch-12-l'], SUP);
      assert.equal(r.status, 0, r.err);
      assert.equal(git(['rev-parse', 'HEAD'], wt('ch-12-l')), newer, 'B8: origin\'s main');
      assert.equal(marker(wt('ch-12-l')), 'newer\n', 'B8: origin\'s files');
      assert.equal(git(['status', '--porcelain'], wt('ch-12-l')), '', 'B8: a clean checkout');
      assert.match(r.err, /ticket\/ch-12-l here \([0-9a-f]{8}\) holds nothing origin's main doesn't/, 'B8: says so');
    });
    await t.test('B10: a ticket that ran, whose later launch stopped before it ran, keeps its commits', tmux, () => {
      ticket('ch-13-m');
      closeWindow(F, ok(old, ['worker', 'ch-13-m'], SUP));
      ok(wt('ch-13-m'), ['phase', 'build'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'ch-13-m' });
      write(path.join(wt('ch-13-m'), 'ch/ch-13-m/work.txt'), 'unpushed\n');
      git(['add', '-A'], wt('ch-13-m'));
      git(['commit', '-qm', 'unpushed work'], wt('ch-13-m'));
      const head = git(['rev-parse', 'HEAD'], wt('ch-13-m'));
      ok(old, ['worker', 'ch-13-m', '--remove', '--force'], SUP);
      // resumed with its worktree gone: a fresh start, logged "starting", then stopped again before it ran
      closeWindow(F, ok(old, ['worker', 'ch-13-m', '--resume'], SUP));
      ok(old, ['worker', 'ch-13-m', '--remove', '--force'], SUP);
      const r = run(old, ['worker', 'ch-13-m'], SUP);
      assert.equal(r.status, 0, `B10: started: ${r.err}`);
      assert.equal(git(['rev-parse', 'HEAD'], wt('ch-13-m')), head, 'B10');
      assert.match(r.err, /ticket\/ch-13-m starts at [0-9a-f]{8}, 1 commit origin doesn't hold yet/, 'B10: says so');
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
    await t.test('H4: when a ran ticket\'s checkout lands elsewhere, its branch is put back on its own commit', tmux, () => {
      ticket('ch-15-o');
      ok(old, ['worker', 'ch-15-o'], SUP);
      write(path.join(wt('ch-15-o'), 'ch/ch-15-o/work.txt'), 'unpushed\n');
      git(['add', '-A'], wt('ch-15-o'));
      git(['commit', '-qm', 'unpushed work'], wt('ch-15-o'));
      const head = git(['rev-parse', 'HEAD'], wt('ch-15-o'));
      ok(old, ['worker', 'ch-15-o', '--remove', '--force'], SUP);
      const moved = planted(old, head, 'moved');
      const bin = path.join(F.base, 'git-lands-elsewhere-2');
      const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
      write(path.join(bin, 'git'), `#!${process.execPath}\nconst a = process.argv.slice(2);\nconst i = a.indexOf('worktree');\nif (i >= 0 && a[i + 1] === 'add') a[a.length - 1] = '${moved}';\nconst r = require('child_process').spawnSync('${realGit}', a, { stdio: 'inherit' });\nprocess.exit(r.status ?? 1);\n`);
      fs.chmodSync(path.join(bin, 'git'), 0o755);
      const r = run(old, ['worker', 'ch-15-o', '--resume'], { ...SUP, PATH: `${bin}${path.delimiter}${process.env.PATH}` });
      assert.notEqual(r.status, 0, `H4: refused, not started: ${r.out}`);
      assert.ok(!fs.existsSync(wt('ch-15-o')), 'H4: no worktree');
      assert.ok(hasRef(old, 'refs/heads/ticket/ch-15-o'), 'H4: the branch is still there');
      assert.equal(git(['rev-parse', 'refs/heads/ticket/ch-15-o'], old), head, 'H4: the branch is back on its own commit');
    });
    await t.test('B11: a tag with the branch\'s name doesn\'t make a right checkout read as a wrong one', tmux, () => {
      ticket('ch-16-p');
      git(['tag', 'ticket/ch-16-p', real], old);
      const r = run(old, ['worker', 'ch-16-p'], SUP);
      assert.equal(r.status, 0, `B11: started: ${r.err}`);
      assert.equal(git(['symbolic-ref', 'HEAD'], wt('ch-16-p')), 'refs/heads/ticket/ch-16-p', 'B11: on the branch');
    });
    await t.test('H5: a checkout of the right commit that isn\'t on the branch is undone and refused', tmux, () => {
      ticket('ch-17-q');
      const bin = path.join(F.base, 'git-detaches');
      const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
      // the add makes the branch, then leaves the worktree's HEAD detached at the same commit
      write(path.join(bin, 'git'), `#!${process.execPath}\nconst { spawnSync } = require('child_process');\nconst a = process.argv.slice(2);\nconst i = a.indexOf('worktree');\nconst r = spawnSync('${realGit}', a, { stdio: 'inherit' });\nif (i >= 0 && a[i + 1] === 'add') spawnSync('${realGit}', ['checkout', '-q', '--detach'], { cwd: a.at(-2), stdio: 'inherit' });\nprocess.exit(r.status ?? 1);\n`);
      fs.chmodSync(path.join(bin, 'git'), 0o755);
      const r = run(old, ['worker', 'ch-17-q'], { ...SUP, PATH: `${bin}${path.delimiter}${process.env.PATH}` });
      assert.notEqual(r.status, 0, `H5: refused, not started: ${r.out}`);
      assert.match(r.err, /the new worktree isn't on ticket\/ch-17-q: .*so nothing was started/, 'H5');
      assert.ok(!fs.existsSync(wt('ch-17-q')), 'H5: no worktree');
      assert.ok(!hasRef(old, 'refs/heads/ticket/ch-17-q'), 'H5: the branch this launch made is gone');
    });
    // a ticket that ran, its worktree gone and one unpushed commit on its branch
    const ranWithWork = (id) => {
      ticket(id);
      ok(old, ['worker', id], SUP);
      git(['commit', '-q', '--allow-empty', '-m', 'unpushed work'], wt(id));
      const head = git(['rev-parse', 'HEAD'], wt(id));
      ok(old, ['worker', id, '--remove', '--force'], SUP);
      return head;
    };
    // a git on PATH that fails every call whose words match
    const failing = (name, words) => {
      const bin = path.join(F.base, name);
      const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
      write(path.join(bin, 'git'), `#!/bin/sh\ncase " $* " in ${words}) '${realGit}' "$@" >/dev/null; echo 'fatal: failed by the test' >&2; exit 128 ;; esac\nexec '${realGit}' "$@"\n`);
      fs.chmodSync(path.join(bin, 'git'), 0o755);
      return { ...SUP, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    };
    await t.test('H6: a local branch git fails to read is never reset', tmux, () => {
      const head = ranWithWork('ch-18-r');
      const r = run(old, ['worker', 'ch-18-r', '--resume'], failing('git-no-read', `*' rev-parse '*'refs/heads/ticket/ch-18-r'*`));
      assert.notEqual(r.status, 0, `H6: refused, not started: ${r.out}`);
      assert.equal(git(['rev-parse', 'refs/heads/ticket/ch-18-r'], old), head, 'H6: the branch keeps its commit');
    });
    await t.test('H7: a history git fails to compare is refused as that, not judged', tmux, () => {
      const head = ranWithWork('ch-19-s');
      const r = run(old, ['worker', 'ch-19-s', '--resume'], failing('git-no-compare', `*' merge-base '*`));
      assert.notEqual(r.status, 0, `H7: refused, not started: ${r.out}`);
      assert.match(r.err, /git could not compare ticket\/ch-19-s with origin's: failed by the test; nothing was started/, 'H7');
      assert.equal(git(['rev-parse', 'refs/heads/ticket/ch-19-s'], old), head, 'H7: the branch keeps its commit');
    });
    await t.test('H8: kept commits git fails to count are refused, not counted as none', tmux, () => {
      const head = ranWithWork('ch-23-w');
      const r = run(old, ['worker', 'ch-23-w', '--resume'], failing('git-no-count', `*' rev-list --count '*`));
      assert.notEqual(r.status, 0, `H8: refused, not started: ${r.out}`);
      assert.match(r.err, /git could not compare ticket\/ch-23-w with origin's: failed by the test; nothing was started/, 'H8');
      assert.equal(git(['rev-parse', 'refs/heads/ticket/ch-23-w'], old), head, 'H8: the branch keeps its commit');
    });
    await t.test('B12: a symbolic tracking ref is removed, not the branch it names', tmux, () => {
      ticket('ch-20-t');
      git(['branch', 'bystander', real], old);
      git(['symbolic-ref', 'refs/remotes/origin/ticket/ch-20-t', 'refs/heads/bystander'], old);
      const r = run(old, ['worker', 'ch-20-t'], SUP);
      assert.equal(r.status, 0, r.err);
      assert.ok(hasRef(old, 'refs/heads/bystander'), 'B12: the bystander branch is still there');
      assert.ok(!hasRef(old, 'refs/remotes/origin/ticket/ch-20-t'), 'B12: the tracking ref is gone');
    });
    await t.test('B13: a symbolic local branch is refused', tmux, () => {
      ticket('ch-21-u');
      git(['branch', 'bystander-2', real], old);
      git(['symbolic-ref', 'refs/heads/ticket/ch-21-u', 'refs/heads/bystander-2'], old);
      const r = run(old, ['worker', 'ch-21-u'], SUP);
      assert.notEqual(r.status, 0, `B13: refused, not started: ${r.out}`);
      assert.match(r.err, /ticket\/ch-21-u here is a symbolic ref to refs\/heads\/bystander-2, so nothing was started/, 'B13');
      assert.equal(git(['rev-parse', 'refs/heads/bystander-2'], old), real, 'B13: the branch it names is unmoved');
    });
    await t.test('B14: a grafts file doesn\'t make a planted commit part of origin\'s history', tmux, () => {
      ticket('ch-22-v');
      const main = git(['rev-parse', 'HEAD'], old);
      const mine = planted(old, main);
      git(['branch', 'ticket/ch-22-v', mine], old);
      const grafts = path.join(old, '.git/info/grafts');
      write(grafts, `${main} ${mine}\n${mine}\n`);
      try {
        const r = run(old, ['worker', 'ch-22-v'], SUP);
        assert.notEqual(r.status, 0, `B14: refused, not started: ${r.out}`);
        assert.match(r.err, /origin has no ticket\/ch-22-v, so nothing was started/, 'B14');
      } finally { fs.rmSync(grafts); }
    });
    // a git on PATH that runs sh first (once) on the first call whose words match, then the real git
    const before = (name, words, sh) => {
      const bin = path.join(F.base, name);
      const said = path.join(F.base, `${name}.txt`);
      const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
      write(path.join(bin, 'git'), `#!/bin/sh\ncase " $* " in ${words}) [ -e '${said}' ] || { ${sh(realGit)} && echo done > '${said}'; } ;; esac\nexec '${realGit}' "$@"\n`);
      fs.chmodSync(path.join(bin, 'git'), 0o755);
      return { said, env: { ...SUP, PATH: `${bin}${path.delimiter}${process.env.PATH}` } };
    };
    // a git on PATH that refuses every call whose words match, doing nothing
    const refusing = (name, words) => before(name, words, () => `{ echo 'error: refused by the test' >&2; exit 4; }`).env;
    await t.test('K1: a tracking ref that is the last one on a ran ticket\'s commits is kept under a named ref', tmux, () => {
      ticket('ch-30-a');
      closeWindow(F, ok(old, ['worker', 'ch-30-a'], SUP));
      git(['commit', '-q', '--allow-empty', '-m', 'pushed work'], wt('ch-30-a'));
      const head = git(['rev-parse', 'HEAD'], wt('ch-30-a'));
      ok(wt('ch-30-a'), ['phase', 'build'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'ch-30-a' });
      ok(old, ['worker', 'ch-30-a', '--remove', '--force'], SUP);
      git(['branch', '-qD', 'ticket/ch-30-a'], old);
      git(['update-ref', 'refs/remotes/origin/ticket/ch-30-a', head], old);
      const r = run(old, ['worker', 'ch-30-a', '--resume'], SUP);
      assert.equal(r.status, 0, r.err);
      const held = git(['for-each-ref', '--format=%(refname)', '--contains', head], old);
      assert.notEqual(held, '', 'K1: a ref still holds the commits');
      assert.match(r.err, new RegExp(`kept at refs/devteam/kept/ticket/ch-30-a/${head}`), 'K1: the words give the full sha');
      assert.ok(acts(old).some((w) => /^made worker ch-30-a /.test(w) && w.includes(head)), 'K1: in the start\'s act');
    });
    await t.test('K7: a symbolic tracking ref is removed and nothing is kept for it', tmux, () => {
      ticket('ch-52-w');
      git(['branch', 'bystander-4', planted(old, git(['rev-parse', 'origin/main'], old), 'other')], old);
      git(['symbolic-ref', 'refs/remotes/origin/ticket/ch-52-w', 'refs/heads/bystander-4'], old);
      ok(old, ['worker', 'ch-52-w'], SUP);
      assert.ok(hasRef(old, 'refs/heads/bystander-4'), 'K7: the branch it names stays');
      assert.equal(git(['for-each-ref', 'refs/devteam/kept/ticket/ch-52-w/'], old), '', 'K7: nothing kept');
    });
    await t.test('K2: a stale tracking ref whose commits the start holds is removed and not kept', tmux, () => {
      const head = ranWithWork('ch-31-b');
      git(['update-ref', 'refs/remotes/origin/ticket/ch-31-b', head], old);
      ok(old, ['worker', 'ch-31-b', '--resume'], SUP);
      assert.ok(!hasRef(old, 'refs/remotes/origin/ticket/ch-31-b'), 'K2: the tracking ref is gone');
      assert.equal(git(['for-each-ref', 'refs/devteam/kept/ticket/ch-31-b/'], old), '', 'K2: nothing kept');
    });
    await t.test('M1: a commit that lands on a ran ticket\'s branch before the checkout stays on it', tmux, () => {
      const head = ranWithWork('ch-32-c');
      const landed = planted(old, head, 'landed');
      const b = before('git-lands-1', "*' worktree add '*", (g) => `'${g}' update-ref refs/heads/ticket/ch-32-c ${landed}`);
      const r = run(old, ['worker', 'ch-32-c', '--resume'], b.env);
      assert.ok(fs.existsSync(b.said), 'M1: the commit landed');
      assert.equal(git(['rev-parse', 'refs/heads/ticket/ch-32-c'], old), landed, 'M1: it stays on the branch');
      assert.notEqual(r.status, 0, `M1: refused, not started: ${r.out}`);
      assert.ok(!fs.existsSync(wt('ch-32-c')), 'M1: no worktree');
    });
    await t.test('M2: a commit that lands on a ran ticket\'s branch behind origin\'s main, after the read, stays on it', tmux, () => {
      ticket('ch-33-d');
      ok(old, ['worker', 'ch-33-d'], SUP);
      ok(old, ['worker', 'ch-33-d', '--remove', '--force'], SUP);
      const at = git(['rev-parse', 'refs/heads/ticket/ch-33-d'], old);
      git(['commit', '-q', '--allow-empty', '-m', 'newer main'], old);
      git(['push', '-q', 'origin', 'main'], old);
      const landed = planted(old, at, 'landed');
      const b = before('git-lands-2', "*' merge-base '*", (g) => `'${g}' update-ref refs/heads/ticket/ch-33-d ${landed}`);
      const r = run(old, ['worker', 'ch-33-d', '--resume'], b.env);
      assert.ok(fs.existsSync(b.said), 'M2: the commit landed');
      assert.equal(git(['rev-parse', 'refs/heads/ticket/ch-33-d'], old), landed, 'M2: it stays on the branch');
      assert.notEqual(r.status, 0, `M2: refused, not started: ${r.out}`);
      assert.ok(!fs.existsSync(wt('ch-33-d')), 'M2: no worktree');
    });
    await t.test('M3: a branch behind origin that another worktree has is refused and not moved', tmux, () => {
      ticket('ch-34-e');
      ok(old, ['worker', 'ch-34-e'], SUP);
      ok(old, ['worker', 'ch-34-e', '--remove', '--force'], SUP);
      const at = git(['rev-parse', 'refs/heads/ticket/ch-34-e'], old);
      git(['commit', '-q', '--allow-empty', '-m', 'newer main again'], old);
      git(['push', '-q', 'origin', 'main'], old);
      const other = path.join(F.base, 'elsewhere');
      git(['worktree', 'add', '-q', other, 'ticket/ch-34-e'], old);
      const r = run(old, ['worker', 'ch-34-e', '--resume'], SUP);
      assert.notEqual(r.status, 0, `M3: refused, not started: ${r.out}`);
      assert.equal(git(['rev-parse', 'refs/heads/ticket/ch-34-e'], old), at, 'M3: the branch is unmoved');
      assert.equal(git(['status', '--porcelain'], other), '', 'M3: the other worktree is clean');
    });
    await t.test('M4: a commit that lands on a ran ticket\'s branch during the checkout stays on it', tmux, () => {
      ticket('ch-43-n');
      ok(old, ['worker', 'ch-43-n'], SUP);
      ok(old, ['worker', 'ch-43-n', '--remove', '--force'], SUP);
      const at = git(['rev-parse', 'refs/heads/ticket/ch-43-n'], old);
      git(['commit', '-q', '--allow-empty', '-m', 'newest main'], old);
      git(['push', '-q', 'origin', 'main'], old);
      const landed = planted(old, at, 'landed');
      const b = before('git-lands-3', "*' worktree add '*", (g) => `{ '${g}' "$@" && '${g}' update-ref refs/heads/ticket/ch-43-n ${landed} && exit 0; }`);
      const r = run(old, ['worker', 'ch-43-n', '--resume'], b.env);
      assert.notEqual(r.status, 0, `M4: refused, not started: ${r.out}`);
      assert.equal(git(['rev-parse', 'refs/heads/ticket/ch-43-n'], old), landed, 'M4: it stays on the branch');
      assert.ok(!fs.existsSync(wt('ch-43-n')), 'M4: no worktree');
    });
    await t.test('M10: a branch behind main starts where main gained a submodule, with submodule.recurse on', tmux, () => {
      ticket('ch-59-d');
      ok(old, ['worker', 'ch-59-d'], SUP);
      ok(old, ['worker', 'ch-59-d', '--remove', '--force'], SUP);
      const sm = path.join(F.base, 'sm');
      git(['init', '-q', '-b', 'main', sm], old);
      git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'sm'], sm);
      git(['-c', 'protocol.file.allow=always', 'submodule', '--quiet', 'add', sm, 'sm'], old);
      git(['commit', '-qm', 'a submodule'], old);
      git(['push', '-q', 'origin', 'main'], old);
      git(['config', 'submodule.recurse', 'true'], old);
      try {
        const r = run(old, ['worker', 'ch-59-d', '--resume'], SUP);
        assert.equal(r.status, 0, `M10: started: ${r.err}`);
      } finally { git(['config', '--unset', 'submodule.recurse'], old); }
    });
    await t.test('M11: a replace ref on main\'s commit doesn\'t swap the files of a moved branch', tmux, () => {
      ticket('ch-60-e');
      ok(old, ['worker', 'ch-60-e'], SUP);
      ok(old, ['worker', 'ch-60-e', '--remove', '--force'], SUP);
      write(path.join(old, 'marker.txt'), 'main for M11\n');
      git(['commit', '-qam', 'main for M11'], old);
      git(['push', '-q', 'origin', 'main'], old);
      const main = git(['rev-parse', 'HEAD'], old);
      const other = planted(old, git(['rev-parse', 'HEAD~1'], old), 'replaced');
      git(['replace', main, other], old);
      git(['config', 'core.useReplaceRefs', 'true'], old);
      try {
        const r = run(old, ['worker', 'ch-60-e', '--resume'], SUP);
        assert.equal(r.status, 0, `M11: started: ${r.err}`);
        assert.equal(marker(wt('ch-60-e')), 'main for M11\n', 'M11: the real files');
      } finally { git(['config', '--unset', 'core.useReplaceRefs'], old); git(['replace', '-d', main], old); }
    });
    await t.test('M12: an upstream set by hand to another remote is left', tmux, () => {
      ticket('ch-61-f');
      git(['push', '-q', 'origin', `${real}:refs/heads/ticket/ch-61-f`], old);
      git(['config', 'branch.ticket/ch-61-f.remote', '.'], old);
      git(['config', 'branch.ticket/ch-61-f.merge', 'refs/heads/main'], old);
      ok(old, ['worker', 'ch-61-f'], SUP);
      assert.equal(git(['config', '--get', 'branch.ticket/ch-61-f.remote'], old), '.', 'M12: the remote stays');
    });
    await t.test('K9: a symbolic tracking ref that changes before its removal is left, and the launch refused', tmux, () => {
      ticket('ch-62-g');
      const main = git(['rev-parse', 'origin/main'], old);
      const newer = planted(old, main, 'newer');
      const ref = 'refs/remotes/origin/ticket/ch-62-g';
      git(['branch', 'bystander-7', main], old);
      git(['symbolic-ref', ref, 'refs/heads/bystander-7'], old);
      const b = before('git-moves-symbolic', `*' -d ${ref} '*`, (g) => `'${g}' update-ref --no-deref ${ref} ${newer}`);
      const r = run(old, ['worker', 'ch-62-g'], b.env);
      assert.ok(fs.existsSync(b.said), 'K9: it changed');
      assert.notEqual(r.status, 0, `K9: refused, not started: ${r.out}`);
      assert.equal(git(['rev-parse', ref], old), newer, 'K9: the tracking ref stays');
    });
    for (const [tag, id, words, what] of [['M5', 'ch-44-o', `*' update-ref --no-deref refs/heads/ticket/ch-44-o '*`, 'before the move'], ['M6', 'ch-45-p', `*' read-tree '*`, 'after the move']]) {
      await t.test(`${tag}: a commit that lands on a ran ticket\'s branch ${what} stays on it`, tmux, () => {
        ticket(id);
        ok(old, ['worker', id], SUP);
        ok(old, ['worker', id, '--remove', '--force'], SUP);
        const at = git(['rev-parse', `refs/heads/ticket/${id}`], old);
        git(['commit', '-q', '--allow-empty', '-m', `main for ${tag}`], old);
        git(['push', '-q', 'origin', 'main'], old);
        const landed = planted(old, at, 'landed');
        const b = before(`git-lands-${tag}`, words, (g) => `'${g}' update-ref refs/heads/ticket/${id} ${landed}`);
        const r = run(old, ['worker', id, '--resume'], b.env);
        assert.ok(fs.existsSync(b.said), `${tag}: the commit landed`);
        assert.equal(git(['rev-parse', `refs/heads/ticket/${id}`], old), landed, `${tag}: it stays on the branch`);
        assert.notEqual(r.status, 0, `${tag}: refused, not started: ${r.out}`);
        assert.ok(!fs.existsSync(wt(id)), `${tag}: no worktree`);
      });
    }
    await t.test('M7: a branch behind origin in mid-rebase in another worktree is refused and not moved', tmux, () => {
      ticket('ch-46-q');
      ok(old, ['worker', 'ch-46-q'], SUP);
      ok(old, ['worker', 'ch-46-q', '--remove', '--force'], SUP);
      const at = git(['rev-parse', 'refs/heads/ticket/ch-46-q'], old);
      git(['commit', '-q', '--allow-empty', '-m', 'main for M7'], old);
      git(['push', '-q', 'origin', 'main'], old);
      const other = path.join(F.base, 'rebasing');
      git(['worktree', 'add', '-q', other, 'ticket/ch-46-q'], old);
      try { execFileSync('git', ['rebase', '-q', '--exec', 'false', '--root'], { cwd: other, stdio: 'ignore' }); } catch {}
      assert.ok(fs.existsSync(git(['rev-parse', '--path-format=absolute', '--git-path', 'rebase-merge'], other)), 'M7: mid-rebase');
      const r = run(old, ['worker', 'ch-46-q', '--resume'], SUP);
      assert.notEqual(r.status, 0, `M7: refused, not started: ${r.out}`);
      assert.equal(git(['rev-parse', 'refs/heads/ticket/ch-46-q'], old), at, 'M7: the branch is unmoved');
      assert.ok(!fs.existsSync(wt('ch-46-q')), 'M7: no worktree');
    });
    await t.test('M8: a retry after a push tracks the branch, whatever a refused launch wrote', tmux, () => {
      const head = ranWithWork('ch-47-r');
      git(['config', '--remove-section', 'branch.ticket/ch-47-r'], old);
      const other = path.join(F.base, 'elsewhere-2');
      git(['worktree', 'add', '-q', other, 'ticket/ch-47-r'], old);
      assert.notEqual(run(old, ['worker', 'ch-47-r', '--resume'], SUP).status, 0, 'M8: refused');
      git(['worktree', 'remove', '--force', other], old);
      git(['push', '-q', 'origin', `${head}:refs/heads/ticket/ch-47-r`], old);
      git(['config', '--add', 'branch.ticket/ch-47-r.merge', 'refs/heads/main'], old); // several values
      const r = run(old, ['worker', 'ch-47-r', '--resume'], SUP);
      assert.equal(r.status, 0, `M8: the retry starts: ${r.err}`);
      assert.equal(upstream(old, 'ticket/ch-47-r'), 'origin/ticket/ch-47-r', 'M8: tracks its own branch');
    });
    await t.test('M9: when the files can\'t be checked out at the moved branch, the launch is undone and the branch put back', tmux, () => {
      ticket('ch-53-x');
      ok(old, ['worker', 'ch-53-x'], SUP);
      ok(old, ['worker', 'ch-53-x', '--remove', '--force'], SUP);
      const at = git(['rev-parse', 'refs/heads/ticket/ch-53-x'], old);
      write(path.join(old, 'marker.txt'), 'main for M9\n');
      git(['commit', '-qam', 'main for M9'], old);
      git(['push', '-q', 'origin', 'main'], old);
      const r = run(old, ['worker', 'ch-53-x', '--resume'], refusing('git-no-files', `*' read-tree '*`));
      assert.notEqual(r.status, 0, `M9: refused, not started: ${r.out}`);
      assert.ok(!fs.existsSync(wt('ch-53-x')), 'M9: no worktree');
      assert.equal(git(['rev-parse', 'refs/heads/ticket/ch-53-x'], old), at, 'M9: the branch is back');
      ok(old, ['worker', 'ch-53-x', '--resume'], SUP);
      assert.equal(git(['rev-parse', 'HEAD'], wt('ch-53-x')), git(['rev-parse', 'origin/main'], old), 'M9: the retry is at origin\'s main');
      assert.equal(marker(wt('ch-53-x')), 'main for M9\n', 'M9: the retry has origin\'s files');
      assert.equal(git(['status', '--porcelain'], wt('ch-53-x')), '', 'M9: the retry\'s files are its commit\'s');
    });
    // two launches of one ticket: a whole one runs just before the other's call that matches
    for (const [tag, id, words, prep] of [['T1', 'ch-54-y', "*' worktree add '*", (x) => { ticket(x); closeWindow(F, ok(old, ['worker', x], SUP)); ok(wt(x), ['phase', 'build'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: x }); git(['commit', '-q', '--allow-empty', '-m', 'unpushed work'], wt(x)); ok(old, ['worker', x, '--remove', '--force'], SUP); git(['config', '--remove-section', `branch.ticket/${x}`], old); }], ['T2', 'ch-55-z', "*' update-ref --no-deref refs/heads/ticket/ch-55-z '*", ticket]]) {
      await t.test(`${tag}: of two launches of one ticket, the winner keeps its upstream`, tmux, () => {
        prep(id);
        const other = path.join(F.base, `other-${tag}.sh`);
        const b = before(`git-second-${tag}`, words, () => `sh '${other}'`);
        // the inner launch runs with a plain PATH, so its own git isn't the stand-in
        write(other, `cd '${old}' && PATH='${process.env.PATH}' '${process.execPath}' docs/devteam/scripts/devteam.mjs worker ${id} >/dev/null 2>&1\n`);
        const r = run(old, ['worker', id], b.env);
        assert.notEqual(r.status, 0, `${tag}: the other is refused: ${r.out}`);
        assert.ok(fs.existsSync(b.said), `${tag}: the other launch finished`);
        assert.ok(fs.existsSync(wt(id)), `${tag}: it has its worktree`);
        assert.equal(upstream(old, `ticket/${id}`), 'origin/main', `${tag}: its upstream stays`);
      });
    }
    await t.test('K8: a symbolic ref planted at the kept name is not written through', tmux, () => {
      const head = ranWithWork('ch-56-a');
      const lost = planted(old, head, 'lost');
      git(['update-ref', 'refs/remotes/origin/ticket/ch-56-a', lost], old);
      git(['branch', 'bystander-5', head], old);
      git(['symbolic-ref', `refs/devteam/kept/ticket/ch-56-a/${lost}`, 'refs/heads/bystander-5'], old);
      ok(old, ['worker', 'ch-56-a', '--resume'], SUP);
      assert.equal(git(['rev-parse', 'refs/heads/bystander-5'], old), head, 'K8: the branch it names is unmoved');
      assert.equal(git(['rev-parse', `refs/devteam/kept/ticket/ch-56-a/${lost}`], old), lost, 'K8: the commits are kept');
    });
    await t.test('S3: a configured refspec doesn\'t make the start\'s fetch write another branch', tmux, () => {
      ticket('ch-57-b');
      const main = git(['rev-parse', 'origin/main'], old);
      git(['push', '-q', 'origin', `${planted(old, main, 'pushed')}:refs/heads/ticket/ch-57-b`], old);
      git(['branch', 'bystander-6', main], old);
      git(['config', '--add', 'remote.origin.fetch', '+refs/heads/ticket/ch-57-b:refs/heads/bystander-6'], old);
      try {
        ok(old, ['worker', 'ch-57-b'], SUP);
        assert.equal(git(['rev-parse', 'refs/heads/bystander-6'], old), main, 'S3: the other branch is unmoved');
      } finally { git(['config', '--unset', 'remote.origin.fetch', 'bystander-6'], old); }
    });
    await t.test('K3: when the commits can\'t be kept, the tracking ref stays', tmux, () => {
      const head = ranWithWork('ch-48-s');
      const lost = planted(old, head, 'lost');
      git(['update-ref', 'refs/remotes/origin/ticket/ch-48-s', lost], old);
      git(['update-ref', 'refs/devteam/kept/ticket/ch-48-s', head], old);
      const r = run(old, ['worker', 'ch-48-s', '--resume'], SUP);
      assert.notEqual(r.status, 0, `K3: refused, not started: ${r.out}`);
      assert.ok(hasRef(old, 'refs/remotes/origin/ticket/ch-48-s'), 'K3: the tracking ref stays');
      assert.equal(git(['rev-parse', 'refs/remotes/origin/ticket/ch-48-s'], old), lost, 'K3: unmoved');
      assert.ok(!fs.existsSync(wt('ch-48-s')), 'K3: no worktree');
    });
    await t.test('K4: the act names what this start kept first, and only names that are a full sha', tmux, () => {
      const head = ranWithWork('ch-49-t');
      const kept = (n) => git(['update-ref', `refs/devteam/kept/ticket/ch-49-t/${n}`, head], old);
      for (const c of '0123') kept(c.repeat(40));
      for (let i = 0; i < 3; i += 1) kept(`0/${String(i).repeat(200)}`);
      const lost = planted(old, head, 'lost');
      git(['update-ref', 'refs/remotes/origin/ticket/ch-49-t', lost], old);
      ok(old, ['worker', 'ch-49-t', '--resume'], SUP);
      const act = acts(old).filter((w) => /^made worker ch-49-t /.test(w)).pop();
      assert.ok(act?.includes(`kept at refs/devteam/kept/ticket/ch-49-t/${lost},`), `K4: this start's first: ${act}`);
      assert.match(act, / and 2 more$/, 'K4: the rest counted');
      assert.equal(act.split('refs/devteam/kept/').length - 1, 3, 'K4: three named');
    });
    await t.test('K5: a tracking ref on an annotated tag doesn\'t stop the launch', tmux, () => {
      ticket('ch-50-u');
      git(['tag', '-a', '-m', 'x', 'annotated', planted(old, git(['rev-parse', 'origin/main'], old))], old);
      git(['update-ref', 'refs/remotes/origin/ticket/ch-50-u', git(['rev-parse', 'annotated'], old)], old);
      const r = run(old, ['worker', 'ch-50-u'], SUP);
      assert.equal(r.status, 0, `K5: started: ${r.err}`);
      assert.ok(!hasRef(old, 'refs/remotes/origin/ticket/ch-50-u'), 'K5: the tracking ref is gone');
    });
    await t.test('K6: a tracking ref moved before its removal is left, and the launch refused', tmux, () => {
      const head = ranWithWork('ch-51-v');
      const lost = planted(old, head, 'lost');
      const newer = planted(old, lost, 'newer');
      git(['update-ref', 'refs/remotes/origin/ticket/ch-51-v', lost], old);
      const b = before('git-moves-tracking', "*' -d refs/remotes/origin/ticket/ch-51-v '*", (g) => `'${g}' update-ref refs/remotes/origin/ticket/ch-51-v ${newer}`);
      const r = run(old, ['worker', 'ch-51-v', '--resume'], b.env);
      assert.ok(fs.existsSync(b.said), 'K6: it moved');
      assert.notEqual(r.status, 0, `K6: refused, not started: ${r.out}`);
      assert.equal(git(['rev-parse', 'refs/remotes/origin/ticket/ch-51-v'], old), newer, 'K6: the tracking ref stays');
    });
    // what a retry after a failed write must do: start fresh, upstream set, the kept commits in its act
    const retried = (id, head, tag) => {
      assert.ok(!fs.existsSync(wt(id)), `${tag}: no worktree`);
      const r = run(old, ['worker', id, '--resume'], SUP);
      assert.equal(r.status, 0, `${tag}: the retry starts: ${r.err}`);
      assert.match(r.out, new RegExp(`made worker ${id} `), `${tag}: no resume typed where no session exists`);
      assert.equal(upstream(old, `ticket/${id}`), 'origin/main', `${tag}: the upstream is set`);
      assert.equal(git(['rev-parse', 'HEAD'], wt(id)), head, `${tag}: on its own commit`);
      assert.ok(acts(old).some((w) => new RegExp(`^made worker ${id} .*1 commit origin doesn't hold yet`).test(w)), `${tag}: the kept commits in its act`);
      return r;
    };
    for (const [id, key] of [['ch-35-f', 'remote'], ['ch-36-g', 'merge']]) {
      await t.test(`U1-${key}: an upstream that can't be written leaves no worktree, and a retry completes the launch`, tmux, () => {
        const head = ranWithWork(id);
        git(['config', '--remove-section', `branch.ticket/${id}`], old);
        const r = run(old, ['worker', id, '--resume'], refusing(`git-no-${key}`, `*' config '*'branch.ticket/${id}.${key} '[or]*`));
        assert.notEqual(r.status, 0, `U1-${key}: refused: ${r.out}`);
        retried(id, head, `U1-${key}`);
      });
    }
    await t.test('U2: a stale tracking ref that can\'t be removed leaves no worktree, and a retry completes the launch', tmux, () => {
      const head = ranWithWork('ch-37-h');
      git(['config', '--remove-section', 'branch.ticket/ch-37-h'], old);
      const lost = planted(old, git(['rev-parse', 'origin/main'], old), 'lost');
      git(['update-ref', 'refs/remotes/origin/ticket/ch-37-h', lost], old);
      const r = run(old, ['worker', 'ch-37-h', '--resume'], refusing('git-no-delete', `*' update-ref '*' -d refs/remotes/origin/ticket/ch-37-h '*`));
      assert.notEqual(r.status, 0, `U2: refused: ${r.out}`);
      retried('ch-37-h', head, 'U2');
      assert.ok(acts(old).some((w) => /^made worker ch-37-h /.test(w) && w.includes(`refs/devteam/kept/ticket/ch-37-h/${lost}`)), 'U2: the ref\'s commits in the act');
    });
    await t.test('U3: a retry names what a launch stopped after the removal kept', tmux, () => {
      const head = ranWithWork('ch-38-i');
      git(['config', '--remove-section', 'branch.ticket/ch-38-i'], old);
      const lost = planted(old, git(['rev-parse', 'origin/main'], old), 'lost');
      git(['update-ref', 'refs/remotes/origin/ticket/ch-38-i', lost], old);
      const r = run(old, ['worker', 'ch-38-i', '--resume'], refusing('git-no-remote-2', `*' config '*'branch.ticket/ch-38-i.remote '[or]*`));
      assert.notEqual(r.status, 0, `U3: refused: ${r.out}`);
      assert.ok(!hasRef(old, 'refs/remotes/origin/ticket/ch-38-i'), 'U3: the tracking ref was removed');
      retried('ch-38-i', head, 'U3');
      assert.ok(acts(old).some((w) => /^made worker ch-38-i /.test(w) && w.includes(`refs/devteam/kept/ticket/ch-38-i/${lost}`)), 'U3: the kept ref in the act');
    });
    await t.test('U4: a branch.<b>.remote with several values doesn\'t stop the launch', tmux, () => {
      ticket('ch-39-j');
      for (const v of ['x', 'y']) git(['config', '--add', 'branch.ticket/ch-39-j.remote', v], old);
      const r = run(old, ['worker', 'ch-39-j'], SUP);
      assert.equal(r.status, 0, `U4: started: ${r.err}`);
      assert.equal(upstream(old, 'ticket/ch-39-j'), 'origin/main', 'U4: the upstream is set');
    });
    await t.test('O2: a home whose origin has two urls is refused', tmux, () => {
      ticket('ch-40-k');
      const url = git(['config', '--get', 'remote.origin.url'], old);
      git(['config', '--add', 'remote.origin.url', url], old);
      try {
        const r = run(old, ['worker', 'ch-40-k'], SUP);
        assert.notEqual(r.status, 0, `O2: refused, not started: ${r.out}`);
        assert.match(r.err, /could not fetch origin main in home: its origin has 2 urls/, 'O2');
        assert.ok(!fs.existsSync(wt('ch-40-k')), 'O2: no worktree');
      } finally { git(['config', '--replace-all', 'remote.origin.url', url], old); }
    });
    await t.test('S1: a symbolic tracking ref of the ticket\'s branch is not written through', tmux, () => {
      ticket('ch-41-l');
      const main = git(['rev-parse', 'origin/main'], old);
      const pushed = planted(old, main, 'pushed');
      git(['push', '-q', 'origin', `${pushed}:refs/heads/ticket/ch-41-l`], old);
      git(['branch', 'bystander-3', main], old);
      git(['symbolic-ref', 'refs/remotes/origin/ticket/ch-41-l', 'refs/heads/bystander-3'], old);
      const r = run(old, ['worker', 'ch-41-l'], SUP);
      assert.equal(r.status, 0, r.err);
      assert.equal(git(['rev-parse', 'refs/heads/bystander-3'], old), main, 'S1: the branch it names is unmoved');
      assert.equal(git(['rev-parse', 'HEAD'], wt('ch-41-l')), pushed, 'S1: from origin\'s branch');
      assert.equal(git(['rev-parse', 'refs/remotes/origin/ticket/ch-41-l'], old), pushed, 'S1: the tracking ref is origin\'s');
    });
    await t.test('S4: a tracking ref git can\'t set is refused', tmux, () => {
      ticket('ch-58-c');
      git(['push', '-q', 'origin', `${real}:refs/heads/ticket/ch-58-c`], old);
      const r = run(old, ['worker', 'ch-58-c'], refusing('git-no-tracking', `*' update-ref --no-deref refs/remotes/origin/ticket/ch-58-c '*`));
      assert.notEqual(r.status, 0, `S4: refused, not started: ${r.out}`);
      assert.match(r.err, /could not fetch origin main in home: .*refused by the test/, 'S4: in git\'s words');
      assert.ok(!fs.existsSync(wt('ch-58-c')), 'S4: no worktree');
    });
    await t.test('A1: a commit origin named that the fetch doesn\'t bring is refused', tmux, () => {
      ticket('ch-42-m');
      const main = git(['rev-parse', 'origin/main'], old);
      const url = git(['config', '--get', 'remote.origin.url'], old);
      const named = path.join(F.base, 'elsewhere-clone');
      git(['clone', '-q', url, named], old);
      git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'only on origin'], named);
      const gone = git(['rev-parse', 'HEAD'], named);
      git(['push', '-q', 'origin', `${gone}:refs/heads/ticket/ch-42-m`], named);
      // origin's branch is moved back between ls-remote and the fetch
      const b = before('git-origin-moves', `*' fetch '*'ticket/ch-42-m'*`, (g) => `'${g}' --git-dir='${url}' update-ref refs/heads/ticket/ch-42-m ${main}`);
      const r = run(old, ['worker', 'ch-42-m'], b.env);
      assert.ok(fs.existsSync(b.said), 'A1: origin moved');
      assert.notEqual(r.status, 0, `A1: refused, not started: ${r.out}`);
      assert.match(r.err, new RegExp(`${gone.slice(0, 8)} did not arrive`), 'A1');
      assert.ok(!fs.existsSync(wt('ch-42-m')), 'A1: no worktree');
    });
    await t.test('P2: a push while the start reads origin, its branch then deleted there, isn\'t set back: the commit is kept', tmux, () => {
      ticket('ch-71-b');
      const url = git(['config', '--get', 'remote.origin.url'], old);
      const first = planted(old, git(['rev-parse', 'origin/main'], old), 'first');
      git(['push', '-q', 'origin', `${first}:refs/heads/ticket/ch-71-b`], old);
      const newer = planted(old, first, 'newer');
      const b = before('git-pushes-2', `*" cat-file -e ${first}"*`, (g) => `'${g}' push -q origin ${newer}:refs/heads/ticket/ch-71-b && '${g}' --git-dir='${url}' update-ref -d refs/heads/ticket/ch-71-b`);
      const r = run(old, ['worker', 'ch-71-b'], b.env);
      assert.ok(fs.existsSync(b.said), 'P2: it was pushed');
      assert.notEqual(git(['for-each-ref', '--format=%(refname)', '--contains', newer], old), '', 'P2: a ref still holds the commit');
      assert.equal(r.status, 0, `P2: started: ${r.err}`);
    });
    await t.test('P5: a push of main while the start reads origin isn\'t set back', tmux, () => {
      ticket('ch-70-a');
      const main = git(['rev-parse', 'origin/main'], old);
      git(['push', '-q', 'origin', `${main}:refs/heads/ticket/ch-70-a`], old);
      const newer = git(['commit-tree', `${main}^{tree}`, '-p', main, '-m', 'main for P5'], old);
      const b = before('git-pushes-main', `*' fetch '*'ticket/ch-70-a'*`, (g) => `'${g}' push -q origin ${newer}:refs/heads/main`);
      const r = run(old, ['worker', 'ch-70-a'], b.env);
      assert.ok(fs.existsSync(b.said), 'P5: it was pushed');
      git(['merge', '-q', '--ff-only', newer], old);
      assert.equal(r.status, 0, `P5: started: ${r.err}`);
      assert.equal(git(['rev-parse', 'refs/remotes/origin/main'], old), newer, 'P5: the tracking ref stays at the push');
    });
    await t.test('P3: a tracking ref that keeps moving refuses the start', tmux, () => {
      ticket('ch-72-c');
      const main = git(['rev-parse', 'origin/main'], old);
      git(['push', '-q', 'origin', `${main}:refs/heads/ticket/ch-72-c`], old);
      const b = before('git-keeps-moving', `*' ls-remote '*'ticket/ch-72-c'*`, (g) => `'${g}' update-ref refs/remotes/origin/ticket/ch-72-c "$('${g}' commit-tree ${main}^{tree} -p ${main} -m "$$")"; false`);
      const r = run(old, ['worker', 'ch-72-c'], b.env);
      assert.notEqual(r.status, 0, `P3: refused, not started: ${r.out}`);
      assert.match(r.err, /origin\/ticket\/ch-72-c here kept moving while it was read/, 'P3');
    });
    await t.test('R1: the launch\'s settings read doesn\'t write home\'s main through a symbolic tracking ref', tmux, () => {
      ticket('ch-84-o');
      git(['commit', '-q', '--allow-empty', '-m', 'main for R1'], old);
      git(['push', '-q', 'origin', 'main'], old);
      git(['branch', 'bystander-8', real], old);
      git(['symbolic-ref', 'refs/remotes/origin/main', 'refs/heads/bystander-8'], old);
      const r = run(old, ['worker', 'ch-84-o'], SUP);
      assert.equal(git(['rev-parse', 'refs/heads/bystander-8'], old), real, 'R1: the branch it names is unmoved');
      assert.equal(r.status, 0, `R1: started: ${r.err}`);
      assert.equal(git(['rev-parse', 'refs/remotes/origin/main'], old), git(['rev-parse', 'HEAD'], old), 'R1: the tracking ref is origin\'s');
    });
    await t.test('R2: home\'s main that keeps moving here while it is read refuses the start', tmux, () => {
      ticket('ch-85-p');
      const main = git(['rev-parse', 'origin/main'], old);
      const b = before('git-main-moves', `*' ls-remote --symref '*`, (g) => `'${g}' update-ref refs/remotes/origin/main "$('${g}' commit-tree ${main}^{tree} -p ${main} -m "$$")"; false`);
      const r = run(old, ['worker', 'ch-85-p'], b.env);
      assert.notEqual(r.status, 0, `R2: refused, not started: ${r.out}`);
      assert.match(r.err, /could not read main from origin \(origin\/main here kept moving while it was read\)/, 'R2');
      git(['update-ref', 'refs/remotes/origin/main', main], old);
    });
    await t.test('R3: a settings read whose main moved once reads origin again and starts', tmux, () => {
      ticket('ch-86-q');
      const main = git(['rev-parse', 'origin/main'], old);
      const b = before('git-main-moves-once', `*' ls-remote --symref '*`, (g) => `'${g}' update-ref refs/remotes/origin/main "$('${g}' commit-tree ${main}^{tree} -p ${main} -m once)"`);
      const r = run(old, ['worker', 'ch-86-q'], b.env);
      assert.ok(fs.existsSync(b.said), 'R3: it moved');
      assert.equal(r.status, 0, `R3: started: ${r.err}`);
      assert.equal(git(['rev-parse', 'HEAD'], wt('ch-86-q')), main, 'R3: from origin\'s main');
    });
    await t.test('R5: a lock left on home\'s origin/main doesn\'t stop a settings read that finds it right', tmux, () => {
      ticket('ch-92-w');
      const lock = path.join(old, '.git/refs/remotes/origin/main.lock');
      write(lock, '');
      let r;
      try { r = run(old, ['worker', 'ch-92-w'], SUP); } finally { fs.rmSync(lock); }
      assert.doesNotMatch(r.err, /could not read main from origin/, 'R5');
    });
    await t.test('R4: a commit origin named for home\'s main that the settings read\'s fetch doesn\'t bring is refused', tmux, () => {
      ticket('ch-87-r');
      const main = git(['rev-parse', 'origin/main'], old);
      const url = git(['config', '--get', 'remote.origin.url'], old);
      const named = path.join(F.base, 'elsewhere-main');
      git(['clone', '-q', url, named], old);
      git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'only on origin'], named);
      const gone = git(['rev-parse', 'HEAD'], named);
      git(['push', '-q', 'origin', 'HEAD:main'], named);
      const b = before('git-origin-main-moves', `*' fetch '*'refs/heads/main'*`, (g) => `'${g}' --git-dir='${url}' update-ref refs/heads/main ${main}`);
      const r = run(old, ['worker', 'ch-87-r'], b.env);
      assert.ok(fs.existsSync(b.said), 'R4: origin moved');
      assert.notEqual(r.status, 0, `R4: refused, not started: ${r.out}`);
      assert.match(r.err, new RegExp(`${gone.slice(0, 8)} did not arrive`), 'R4');
      assert.equal(git(['rev-parse', 'refs/remotes/origin/main'], old), main, 'R4: the tracking ref is as it was');
    });
    await t.test('R6: a lock on home\'s origin/main that git would wait on refuses inside the deadline', tmux, () => {
      ticket('ch-98-c');
      const main = git(['rev-parse', 'origin/main'], old);
      git(['update-ref', 'refs/remotes/origin/main', git(['commit-tree', `${main}^{tree}`, '-p', main, '-m', 'R6'], old)], old);
      git(['config', 'core.filesRefLockTimeout', '-1'], old);
      const lock = path.join(old, '.git/refs/remotes/origin/main.lock');
      write(lock, '');
      const t0 = Date.now();
      let r;
      try { r = run(old, ['worker', 'ch-98-c'], { ...SUP, DEVTEAM_LAUNCH_ORIGIN_MS: '5000' }); } finally {
        fs.rmSync(lock);
        git(['config', '--unset', 'core.filesRefLockTimeout'], old);
        git(['update-ref', 'refs/remotes/origin/main', main], old);
      }
      const took = Date.now() - t0;
      assert.ok(took < 30000, `R6: refused inside the deadline, not after ${took} ms`);
      assert.match(r.err, /could not read main from origin \(it did not answer in time\)/, 'R6');
    });
    // a ticket whose worktree is gone and whose branch is behind origin's main, where marker.txt says tag
    const behind = (id, tag) => {
      ticket(id);
      closeWindow(F, ok(old, ['worker', id], SUP));
      ok(wt(id), ['phase', 'build'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: id });
      ok(old, ['worker', id, '--remove', '--force'], SUP);
      write(path.join(old, 'marker.txt'), `main for ${tag}\n`);
      git(['commit', '-qam', `main for ${tag}`], old);
      git(['push', '-q', 'origin', 'main'], old);
      return { at: git(['rev-parse', `refs/heads/ticket/${id}`], old), main: git(['rev-parse', 'HEAD'], old) };
    };
    // the command the words name, run as they give it
    const cleared = (err, tag) => {
      const cmd = / \((git -C .* worktree unlock .*)\), then start it again/.exec(err)?.[1];
      assert.ok(cmd, `${tag}: a command is named: ${err}`);
      execFileSync('sh', ['-c', cmd], { stdio: 'pipe' });
    };
    // what a retry over a worktree left behind must do: refuse, naming it; once it is gone, start whole
    const refusedThenWhole = (id, tag, main, commit) => {
      const r = run(old, ['worker', id, '--resume'], SUP);
      assert.notEqual(r.status, 0, `${tag}: the retry is refused: ${r.out}`);
      assert.match(r.err, new RegExp(`${id}'s start isn't finished, so nothing was started: the worktree ${wt(id)} is there, at ${commit.slice(0, 8)}`), `${tag}: the state named`);
      cleared(r.err, tag);
      ok(old, ['worker', id, '--resume'], SUP);
      assert.equal(git(['rev-parse', 'HEAD'], wt(id)), main, `${tag}: then at origin's main`);
      assert.equal(git(['status', '--porcelain'], wt(id)), '', `${tag}: then clean`);
    };
    await t.test('X1: a failing post-checkout hook on a branch behind origin: the worktree and its commit named, and no retry starts there', tmux, () => {
      const { at, main } = behind('ch-74-e', 'X1');
      const hook = path.join(old, '.git/hooks/post-checkout');
      write(hook, '#!/bin/sh\nexit 1\n');
      fs.chmodSync(hook, 0o755);
      let r;
      try { r = run(old, ['worker', 'ch-74-e', '--resume'], SUP); } finally { fs.rmSync(hook); }
      assert.notEqual(r.status, 0, `X1: refused: ${r.out}`);
      assert.ok(r.err.includes(`nothing was started, but the worktree ${wt('ch-74-e')} is there, at ${at.slice(0, 8)}`), `X1: named: ${r.err}`);
      assert.match(r.err, /a post-checkout hook may have failed: mend it first/, 'X1: the hook');
      refusedThenWhole('ch-74-e', 'X1', main, at);
    });
    await t.test('X2: an undo that can\'t remove the worktree names it, and leaves the branch on its files', tmux, () => {
      const { main } = behind('ch-75-f', 'X2');
      const r = run(old, ['worker', 'ch-75-f', '--resume'], before('git-no-undo', `*' read-tree '*|*' worktree remove '*`, (g) => `{ case " $* " in *' read-tree '*) '${g}' "$@" ;; esac; echo 'error: refused by the test' >&2; exit 4; }`).env);
      assert.notEqual(r.status, 0, `X2: refused: ${r.out}`);
      assert.equal(git(['status', '--porcelain'], wt('ch-75-f')), '', 'X2: no reversions staged');
      assert.ok(r.err.includes(`the undo couldn't remove it all, and ticket/ch-75-f stays at ${main.slice(0, 8)}: the worktree ${wt('ch-75-f')} is there, at ${main.slice(0, 8)}`), `X2: named: ${r.err}`);
      refusedThenWhole('ch-75-f', 'X2', main, main);
    });
    await t.test('X3: an empty folder an undo left: no retry starts there', tmux, () => {
      const { main } = behind('ch-76-g', 'X3');
      const r = run(old, ['worker', 'ch-76-g', '--resume'], before('git-half-undo', `*' read-tree '*|*' worktree remove '*`, (g) => `{ case " $* " in *' worktree remove '*) '${g}' "$@"; mkdir -p '${wt('ch-76-g')}' ;; esac; echo 'error: refused by the test' >&2; exit 4; }`).env);
      assert.notEqual(r.status, 0, `X3: refused: ${r.out}`);
      const again = run(old, ['worker', 'ch-76-g', '--resume'], SUP);
      assert.notEqual(again.status, 0, `X3: the retry is refused: ${again.out}`);
      assert.ok(again.err.includes(`${wt('ch-76-g')} is no worktree git knows`), `X3: named: ${again.err}`);
      assert.ok(r.err.includes(`and ticket/ch-76-g stays at ${main.slice(0, 8)}: ${wt('ch-76-g')} is no worktree`), `X3: the first words: ${r.err}`);
    });
    for (const [tag, id, words, moved] of [['X4', 'ch-77-h', `*' update-ref --no-deref refs/heads/ticket/ch-77-h '*`, false], ['X5', 'ch-78-i', `*' read-tree '*`, true]]) {
      await t.test(`${tag}: a launch killed ${moved ? 'between the move and the fill' : 'between the add and the move'} is found by the retry`, tmux, () => {
        const { at, main } = behind(id, tag);
        run(old, ['worker', id, '--resume'], before(`git-kills-${tag}`, words, () => '{ kill -9 $PPID; exit 9; }').env);
        assert.ok(fs.existsSync(wt(id)), `${tag}: its worktree is there`);
        refusedThenWhole(id, tag, main, moved ? main : at);
      });
    }
    await t.test('X6: a second launch while the first is filling its worktree is refused, and the first starts', tmux, () => {
      const { main } = behind('ch-79-j', 'X6');
      const other = path.join(F.base, 'other-X6.sh');
      const b = before('git-second-X6', `*' read-tree '*`, () => `sh '${other}'`);
      write(other, `cd '${old}' && PATH='${process.env.PATH}' '${process.execPath}' docs/devteam/scripts/devteam.mjs worker ch-79-j --resume >'${other}.out' 2>&1\necho "exit $?" >>'${other}.out'\n`);
      const r = run(old, ['worker', 'ch-79-j', '--resume'], b.env);
      const said = fs.readFileSync(`${other}.out`, 'utf8');
      assert.match(said, /ch-79-j's start isn't finished, so nothing was started/, `X6: ${said}`);
      assert.equal(r.status, 0, `X6: the first starts: ${r.err}`);
      assert.equal(git(['rev-parse', 'HEAD'], wt('ch-79-j')), main, 'X6: at origin\'s main');
    });
    await t.test('X7: a started worktree is unlocked; one locked with another reason still resumes', tmux, () => {
      ticket('ch-80-k');
      closeWindow(F, ok(old, ['worker', 'ch-80-k'], SUP));
      assert.ok(!fs.existsSync(path.join(old, '.git/worktrees/ch-80-k/locked')), 'X7: unlocked');
      git(['worktree', 'lock', '--reason', 'mine', wt('ch-80-k')], old);
      const r = run(old, ['worker', 'ch-80-k', '--resume'], SUP);
      assert.equal(r.status, 0, `X7: resumed: ${r.err}`);
    });
    await t.test('X8: a worktree that can\'t be unlocked is undone', tmux, () => {
      ticket('ch-81-l');
      const r = run(old, ['worker', 'ch-81-l'], refusing('git-no-unlock', `*' worktree unlock '*`));
      assert.notEqual(r.status, 0, `X8: refused: ${r.out}`);
      assert.ok(!fs.existsSync(wt('ch-81-l')), 'X8: no worktree');
    });
    await t.test('X9: an add that fails on a worktree another start has finished never says to remove it', tmux, () => {
      behind('ch-88-s', 'X9');
      const other = path.join(F.base, 'other-X9.sh');
      const b = before('git-second-X9', `*' worktree add '*`, () => `sh '${other}'`);
      write(other, `cd '${old}' && PATH='${process.env.PATH}' '${process.execPath}' docs/devteam/scripts/devteam.mjs worker ch-88-s --resume >/dev/null 2>&1\n`);
      const r = run(old, ['worker', 'ch-88-s', '--resume'], b.env);
      assert.notEqual(r.status, 0, `X9: refused: ${r.out}`);
      assert.doesNotMatch(r.err, /worktree (remove|unlock|prune)/, 'X9: nothing to remove');
      assert.ok(r.err.includes(`${wt('ch-88-s')} is there, made by another start`), `X9: named: ${r.err}`);
    });
    await t.test('X10: a killed start whose folder is gone is refused with a command that clears it', tmux, () => {
      const { main } = behind('ch-89-t', 'X10');
      run(old, ['worker', 'ch-89-t', '--resume'], before('git-kills-X10', `*' read-tree '*`, () => '{ kill -9 $PPID; exit 9; }').env);
      fs.rmSync(wt('ch-89-t'), { recursive: true });
      const r = run(old, ['worker', 'ch-89-t', '--resume'], SUP);
      assert.notEqual(r.status, 0, `X10: refused: ${r.out}`);
      assert.ok(r.err.includes(`git still holds a worktree for ${wt('ch-89-t')}, whose folder is gone`), `X10: named: ${r.err}`);
      cleared(r.err, 'X10');
      ok(old, ['worker', 'ch-89-t', '--resume'], SUP);
      assert.equal(git(['rev-parse', 'HEAD'], wt('ch-89-t')), main, 'X10: then at origin\'s main');
    });
    await t.test('X15: a worktree another start adds just after the look is not resumed', tmux, () => {
      behind('ch-95-z', 'X15');
      const b = before('git-adds-after-look', `*' worktree list --porcelain '*`, (g) => `{ '${g}' "$@"; '${g}' -C '${old}' worktree add --quiet --lock --reason 'devteam: a start of ch-95-z is making this worktree' '${wt('ch-95-z')}' ticket/ch-95-z >/dev/null 2>&1; echo done > "$0.added"; exit 0; }`);
      const r = run(old, ['worker', 'ch-95-z', '--resume'], b.env);
      assert.ok(fs.existsSync(path.join(F.base, 'git-adds-after-look/git.added')), 'X15: it was added');
      assert.notEqual(r.status, 0, `X15: refused: ${r.out}`);
      assert.match(r.err, /is there, at [0-9a-f]{8}: if no other start is making it/, 'X15: named');
    });
    await t.test('X16: a start whose worktree something unlocked meanwhile leaves it', tmux, () => {
      ticket('ch-96-a');
      const b = before('git-unlocks', `*' symbolic-ref HEAD '*`, (g) => `'${g}' -C '${old}' worktree unlock '${wt('ch-96-a')}'`);
      const r = run(old, ['worker', 'ch-96-a'], b.env);
      assert.ok(fs.existsSync(b.said), 'X16: it was unlocked');
      assert.notEqual(r.status, 0, `X16: refused: ${r.out}`);
      assert.ok(fs.existsSync(wt('ch-96-a')), 'X16: the worktree stays');
      assert.match(r.err, /something else unlocked .*ch-96-a while it was made, so the undo left it/, `X16: says so: ${r.err}`);
    });
    // a post-checkout hook in home for the length of fn, sh its body
    const withHook = (sh, fn) => {
      const hook = path.join(old, '.git/hooks/post-checkout');
      write(hook, `#!/bin/sh\n${sh}\n`);
      fs.chmodSync(hook, 0o755);
      try { return fn(); } finally { fs.rmSync(hook); }
    };
    // while start A fills id's worktree, sh runs (as another start, a person or a hook would), then A's fill fails
    const underTheFill = (id, tag, sh) => {
      const other = path.join(F.base, `other-${tag}.sh`);
      write(other, `cd '${old}' || exit 2\n${sh}\n`);
      return run(old, ['worker', id, '--resume'], before(`git-under-${tag}`, `*' read-tree '*`, () => `{ sh '${other}' >'${other}.out' 2>&1; echo 'error: refused by the test' >&2; exit 4; }`).env);
    };
    const otherStart = (id, tag) => `PATH='${process.env.PATH}' '${process.execPath}' docs/devteam/scripts/devteam.mjs worker ${id} --resume >'${F.base}/start-${tag}.out' 2>&1 || exit 3`;
    const kept = (id, tag, r) => {
      assert.notEqual(r.status, 0, `${tag}: A refused: ${r.out}`);
      assert.equal(fs.readFileSync(path.join(F.base, `other-${tag}.sh.out`), 'utf8'), '', `${tag}: the other ran`);
      assert.ok(fs.existsSync(path.join(wt(id), 'unsaved.txt')), `${tag}: the file stays`);
      assert.match(r.err, /while it was made, so the undo left it, and ticket\/.* at [0-9a-f]{8}: look in it before resuming it/, `${tag}: says so: ${r.err}`);
    };
    await t.test('X17: a worktree another start adds into a folder that was there, after the look, is not resumed', tmux, () => {
      behind('ch-63-h', 'X17');
      fs.mkdirSync(wt('ch-63-h'), { recursive: true });
      const b = before('git-adds-into-folder', `*' worktree list --porcelain '*`, (g) => `{ '${g}' "$@"; '${g}' -C '${old}' worktree add --quiet --lock --reason 'devteam: a start of ch-63-h is making this worktree' '${wt('ch-63-h')}' ticket/ch-63-h >/dev/null 2>&1; echo done > "$0.added"; exit 0; }`);
      const r = run(old, ['worker', 'ch-63-h', '--resume'], b.env);
      assert.ok(fs.existsSync(path.join(F.base, 'git-adds-into-folder/git.added')), 'X17: it was added');
      assert.notEqual(r.status, 0, `X17: refused: ${r.out}`);
      assert.match(r.err, /ch-63-h's start isn't finished, so nothing was started/, `X17: named: ${r.err}`);
    });
    await t.test('X25: a folder whose worktree git is making (its record locked by a start, no gitdir yet) is not resumed', tmux, () => {
      behind('ch-62-z', 'X25');
      fs.mkdirSync(wt('ch-62-z'), { recursive: true });
      const rec = path.join(old, '.git/worktrees/ch-62-z');
      write(path.join(rec, 'locked'), 'devteam: a start of ch-62-z is making this worktree (other)');
      let r;
      try { r = run(old, ['worker', 'ch-62-z', '--resume'], SUP); } finally { fs.rmSync(rec, { recursive: true }); }
      assert.notEqual(r.status, 0, `X25: refused: ${r.out}`);
      assert.ok(r.err.includes(`git is making a worktree for ${wt('ch-62-z')} (its record ${rec} has no gitdir yet)`), `X25: named: ${r.err}`);
    });
    await t.test('X26: the look again reads git\'s records before its list, so an add landing between them is seen', tmux, () => {
      behind('ch-61-y', 'X26');
      fs.mkdirSync(wt('ch-61-y'), { recursive: true });
      // the first look's list arms it; the next record read (the look again's) has the add land just before it
      const bin = path.join(F.base, 'git-adds-between');
      const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
      write(path.join(bin, 'git'), `#!/bin/sh\ncase " $* " in\n*' worktree list --porcelain '*) [ -e '${bin}/armed' ] || echo armed > '${bin}/armed' ;;\n*' --git-common-dir '*) if [ -e '${bin}/armed' ] && [ ! -e '${bin}/added' ]; then echo added > '${bin}/added'; '${realGit}' -C '${old}' worktree add --quiet --lock --reason 'devteam: a start of ch-61-y is making this worktree (other)' '${wt('ch-61-y')}' ticket/ch-61-y >/dev/null 2>&1; fi ;;\nesac\nexec '${realGit}' "$@"\n`);
      fs.chmodSync(path.join(bin, 'git'), 0o755);
      const r = run(old, ['worker', 'ch-61-y', '--resume'], { ...SUP, PATH: `${bin}${path.delimiter}${process.env.PATH}` });
      assert.ok(fs.existsSync(path.join(bin, 'added')), 'X26: it was added');
      assert.notEqual(r.status, 0, `X26: refused, not resumed: ${r.out}`);
      assert.match(r.err, /ch-61-y's start isn't finished, so nothing was started: the worktree .* is there, at [0-9a-f]{8}: if no other start is making it/, `X26: named: ${r.err}`);
    });
    await t.test('X27: a retry over a worktree whose branch was moved and whose files weren\'t (its lock replaced during the fill, which failed) is refused', tmux, () => {
      const { at, main } = behind('ch-60-x', 'X27');
      const r = underTheFill('ch-60-x', 'X27', `git worktree unlock '${wt('ch-60-x')}' && git worktree lock --reason person '${wt('ch-60-x')}'`);
      assert.notEqual(r.status, 0, `X27: A refused: ${r.out}`);
      assert.equal(git(['rev-parse', 'HEAD'], wt('ch-60-x')), main, 'X27: HEAD at the moved branch');
      assert.notEqual(git(['status', '--porcelain'], wt('ch-60-x')), '', 'X27: its files are the older commit\'s');
      const again = run(old, ['worker', 'ch-60-x', '--resume'], SUP);
      assert.notEqual(again.status, 0, `X27: the retry is refused, not resumed with reversions staged: ${again.out}`);
      assert.ok(again.err.includes(`the worktree ${wt('ch-60-x')} is at ${main.slice(0, 8)}, but a start moved its branch there from ${at.slice(0, 8)} and could not check out its files`), `X27: named: ${again.err}`);

      const mark = / and remove '([^']+)', then start it again/.exec(again.err)?.[1];
      assert.ok(mark && fs.existsSync(mark), `X27: the mark is named: ${again.err}`);
      git(['reset', '-q', '--hard'], wt('ch-60-x'));
      fs.rmSync(mark);
      const third = run(old, ['worker', 'ch-60-x', '--resume'], SUP);
      assert.equal(third.status, 0, `X27: then it resumes: ${third.err}`);
    });
    await t.test('X28: a start that moves its branch and fills its files leaves no mark, and resumes later', tmux, () => {
      const { main } = behind('ch-59-w', 'X28');
      closeWindow(F, ok(old, ['worker', 'ch-59-w', '--resume'], SUP));
      assert.equal(git(['rev-parse', 'HEAD'], wt('ch-59-w')), main, 'X28: at origin\'s main');
      assert.ok(!fs.existsSync(path.join(old, '.git/worktrees/ch-59-w/devteam-start-filling')), 'X28: no mark left');
      const r = run(old, ['worker', 'ch-59-w', '--resume'], SUP);
      assert.equal(r.status, 0, `X28: resumed: ${r.err}`);
    });
    await t.test('X29: a lock taken off before the mark is there, another start resuming meanwhile: the branch isn\'t moved under it', tmux, () => {
      const { at } = behind('ch-58-v', 'X29');
      // just before the start marks its worktree, something unlocks it and another start resumes there; then the fill would fail
      const bin = path.join(F.base, 'git-unlocks-before-mark');
      const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
      write(path.join(bin, 'git'), `#!/bin/sh\ncase " $* " in\n*' --absolute-git-dir '*) if [ ! -e '${bin}/said' ]; then echo done > '${bin}/said'; '${realGit}' -C '${old}' worktree unlock '${wt('ch-58-v')}' && (cd '${old}' && ${otherStart('ch-58-v', 'X29')}); fi ;;\n*' read-tree '*) echo 'error: refused by the test' >&2; exit 4 ;;\nesac\nexec '${realGit}' "$@"\n`);
      fs.chmodSync(path.join(bin, 'git'), 0o755);
      const r = run(old, ['worker', 'ch-58-v', '--resume'], { ...SUP, PATH: `${bin}${path.delimiter}${process.env.PATH}` });
      assert.ok(fs.existsSync(path.join(bin, 'said')), 'X29: it was unlocked');
      assert.match(fs.readFileSync(path.join(F.base, 'start-X29.out'), 'utf8'), /resumed worker ch-58-v/, 'X29: the other start resumed there');
      assert.notEqual(r.status, 0, `X29: the first refused: ${r.out}`);
      assert.equal(git(['diff', '--cached', '--name-only'], wt('ch-58-v')), '', 'X29: no reversions staged under the other start');
      assert.equal(git(['rev-parse', 'HEAD'], wt('ch-58-v')), at, 'X29: the branch where it was');
      assert.ok(!fs.existsSync(path.join(old, '.git/worktrees/ch-58-v/devteam-start-filling')), 'X29: no mark left');
    });
    await t.test('X18: a lock a post-checkout hook put on the worktree in place of the start\'s stays', tmux, () => {
      ticket('ch-64-i');
      const r = withHook('git worktree unlock "$(pwd)" && git worktree lock --reason mine "$(pwd)"', () => run(old, ['worker', 'ch-64-i'], SUP));
      assert.equal(r.status, 0, `X18: started: ${r.err}`);
      assert.equal(fs.readFileSync(path.join(old, '.git/worktrees/ch-64-i/locked'), 'utf8').trim(), 'mine', 'X18: the hook\'s lock stays');
    });
    await t.test('X19: a post-checkout hook that unlocks the worktree and fails: the words don\'t say to resume it', tmux, () => {
      const { at } = behind('ch-65-j', 'X19');
      const r = withHook('git worktree unlock "$(pwd)"; exit 1', () => run(old, ['worker', 'ch-65-j', '--resume'], SUP));
      assert.notEqual(r.status, 0, `X19: refused: ${r.out}`);
      assert.ok(r.err.includes(`${wt('ch-65-j')} is there, made by another start or left by this one (a post-checkout hook that unlocked it), at ${at.slice(0, 8)}: look at its commit before resuming it`), `X19: ${r.err}`);
    });
    await t.test('X20: a post-checkout hook that locks the worktree itself is named', tmux, () => {
      ticket('ch-66-k');
      const r = withHook('git worktree lock --reason hook "$(pwd)"', () => run(old, ['worker', 'ch-66-k'], SUP));
      assert.notEqual(r.status, 0, `X20: refused: ${r.out}`);
      assert.match(r.err, /a post-checkout hook may not lock the worktree while a start makes it/, `X20: ${r.err}`);
    });
    await t.test('X21: an undo leaves a worktree whose lock a hook replaced, with its files', tmux, () => {
      const { at } = behind('ch-67-l', 'X21');
      const r = withHook('git worktree unlock "$(pwd)" && git worktree lock --reason mine "$(pwd)" && echo keep > unsaved.txt', () => run(old, ['worker', 'ch-67-l', '--resume'], SUP));
      assert.notEqual(r.status, 0, `X21: refused: ${r.out}`);
      assert.ok(fs.existsSync(path.join(wt('ch-67-l'), 'unsaved.txt')), 'X21: the file stays');
      assert.match(r.err, /while it was made, so the undo left it, and ticket\/.* at [0-9a-f]{8}: look in it before resuming it/, `X21: says so: ${r.err}`);
      assert.equal(git(['rev-parse', 'HEAD'], wt('ch-67-l')), at, 'X21: the branch where it was');
      assert.equal(fs.readFileSync(path.join(old, '.git/worktrees/ch-67-l/locked'), 'utf8').trim(), 'mine', 'X21: the hook\'s lock stays');
      assert.ok(!fs.existsSync(path.join(old, '.git/worktrees/ch-67-l/devteam-start-filling')), 'X21: no mark left, the branch never moved');
      const again = run(old, ['worker', 'ch-67-l', '--resume'], SUP);
      assert.equal(again.status, 0, `X21: the retry resumes at the old commit: ${again.err}`);
    });
    await t.test('X22: an undo leaves a worktree another start made there after the first was cleared', tmux, () => {
      behind('ch-68-m', 'X22');
      const r = underTheFill('ch-68-m', 'X22', `git worktree unlock '${wt('ch-68-m')}' && git worktree remove --force '${wt('ch-68-m')}' && ${otherStart('ch-68-m', 'X22')}; echo keep > '${wt('ch-68-m')}/unsaved.txt'`);
      kept('ch-68-m', 'X22', r);
    });
    await t.test('X23: an undo leaves a worktree something unlocked while it was filled, and another start is refused there', tmux, () => {
      behind('ch-69-n', 'X23');
      const r = underTheFill('ch-69-n', 'X23', `git worktree unlock '${wt('ch-69-n')}' && echo keep > '${wt('ch-69-n')}/unsaved.txt' && ${otherStart('ch-69-n', 'X23')}`);
      kept('ch-69-n', 'X23', r);
      assert.match(fs.readFileSync(path.join(F.base, 'start-X23.out'), 'utf8'), /ch-69-n's start isn't finished, so nothing was started: the worktree .* could not check out its files/, 'X23: the other start is refused');
    });
    await t.test('X24: an undo leaves a worktree another start of the same name is making', tmux, () => {
      behind('ch-97-b', 'X24');
      const r = underTheFill('ch-97-b', 'X24', `git worktree unlock '${wt('ch-97-b')}' && git worktree remove --force '${wt('ch-97-b')}' && git worktree add --quiet --lock --reason 'devteam: a start of ch-97-b is making this worktree' '${wt('ch-97-b')}' ticket/ch-97-b && echo keep > '${wt('ch-97-b')}/unsaved.txt'`);
      kept('ch-97-b', 'X24', r);
    });
    await t.test('X13: when git can\'t list its worktrees, a killed start is still found', tmux, () => {
      behind('ch-93-x', 'X13');
      run(old, ['worker', 'ch-93-x', '--resume'], before('git-kills-X13', `*' read-tree '*`, () => '{ kill -9 $PPID; exit 9; }').env);
      const r = run(old, ['worker', 'ch-93-x', '--resume'], refusing('git-no-list', `*' worktree list '*`));
      assert.notEqual(r.status, 0, `X13: refused: ${r.out}`);
      assert.match(r.err, /ch-93-x's start isn't finished, so nothing was started/, `X13: the state named: ${r.err}`);
    });
    await t.test('X14: a file where the worktree goes is refused in words', tmux, () => {
      ticket('ch-94-y');
      write(wt('ch-94-y'), 'x');
      try {
        const r = run(old, ['worker', 'ch-94-y'], SUP);
        assert.match(r.err, /ch-94-y is a file, where the worktree goes/, 'X14');
      } finally { fs.rmSync(wt('ch-94-y')); }
    });
    await t.test('X11: a worktree whose .git git can\'t follow is refused with repair, not a delete', tmux, () => {
      ticket('ch-90-u');
      closeWindow(F, ok(old, ['worker', 'ch-90-u'], SUP));
      write(path.join(wt('ch-90-u'), '.git'), 'gitdir: /nowhere/at/all\n');
      const r = run(old, ['worker', 'ch-90-u', '--resume'], SUP);
      assert.notEqual(r.status, 0, `X11: refused: ${r.out}`);
      assert.match(r.err, /git can't read .* as a worktree .* worktree repair /, 'X11: names repair');
    });
    await t.test('X12: the command the words name leaves a worktree that was finished since', tmux, () => {
      const { main } = behind('ch-91-v', 'X12');
      const other = path.join(F.base, 'other-X12.sh');
      const b = before('git-second-X12', `*' read-tree '*`, () => `sh '${other}'`);
      write(other, `cd '${old}' && PATH='${process.env.PATH}' '${process.execPath}' docs/devteam/scripts/devteam.mjs worker ch-91-v --resume >/dev/null 2>'${other}.err'; true\n`);
      ok(old, ['worker', 'ch-91-v', '--resume'], b.env);
      assert.throws(() => cleared(fs.readFileSync(`${other}.err`, 'utf8'), 'X12'), /is not locked/, 'X12: refused');
      assert.equal(git(['rev-parse', 'HEAD'], wt('ch-91-v')), main, 'X12: still there');
    });
    await t.test('P4: a branch named refs/remotes/origin/<branch> isn\'t read as the tracking ref', tmux, () => {
      ticket('ch-73-d');
      git(['update-ref', 'refs/heads/refs/remotes/origin/ticket/ch-73-d', planted(old, git(['rev-parse', 'origin/main'], old))], old);
      try {
        const r = run(old, ['worker', 'ch-73-d'], SUP);
        assert.equal(r.status, 0, `P4: started: ${r.err}`);
      } finally { git(['update-ref', '-d', 'refs/heads/refs/remotes/origin/ticket/ch-73-d'], old); }
    });
    await t.test('K10: a stale tracking ref\'s commits stay held when the branch that held them is moved back before the checkout', tmux, () => {
      const head = ranWithWork('ch-82-m');
      git(['update-ref', 'refs/remotes/origin/ticket/ch-82-m', head], old);
      const b = before('git-moves-back', "*' worktree add '*", (g) => `'${g}' update-ref refs/heads/ticket/ch-82-m ${head}~1`);
      const r = run(old, ['worker', 'ch-82-m', '--resume'], b.env);
      assert.ok(fs.existsSync(b.said), 'K10: it moved back');
      assert.notEqual(git(['for-each-ref', '--format=%(refname)', '--contains', head], old), '', 'K10: a ref still holds the commits');
      assert.notEqual(r.status, 0, `K10: refused: ${r.out}`);
      assert.match(r.err, new RegExp(`kept at refs/devteam/kept/ticket/ch-82-m/${head}`), 'K10: the full sha');
    });
    await t.test('K11: a kept ref from an earlier launch is never dropped', tmux, () => {
      const head = ranWithWork('ch-83-n');
      git(['update-ref', 'refs/remotes/origin/ticket/ch-83-n', head], old);
      git(['update-ref', `refs/devteam/kept/ticket/ch-83-n/${head}`, head], old);
      ok(old, ['worker', 'ch-83-n', '--resume'], SUP);
      assert.ok(hasRef(old, `refs/devteam/kept/ticket/ch-83-n/${head}`), 'K11: still there');
    });
  } finally { F.done(); }
});

test('a linked repo: the worker\'s base is its origin\'s main whatever the checkout\'s remote config says', async (t) => {
  const F = multiFixture('start-from-origin-link');
  const { old, runIn, okIn, ticket } = F;
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
    await t.test('L3: the link\'s other reads of main (a measure) aren\'t left on a moved origin/trunk either', () => {
      git(['update-ref', 'refs/remotes/origin/trunk', moved], F.console);
      const G = okIn(old, ['goal', 'add', '--title', 'Real', '--outcome', 'real', '--measure', 'real markers', '--target', '1', '--unit', 'markers', '--direction', 'up', '--source', 'repo', '--link', 'console', '--check', 'grep -c real marker.txt || true', '--non-goals', 'none', '--preconditions', 'a'], SUP).trim();
      assert.match(okIn(old, ['goal', 'reading', G, '--run'], SUP), /^recorded 1 for /, 'L3: read on origin\'s trunk');
    });
    await t.test('S2: a symbolic origin/trunk is not written through', tmux, () => {
      ticket('console-03-c');
      git(['branch', 'bystander', moved], F.console);
      git(['symbolic-ref', 'refs/remotes/origin/trunk', 'refs/heads/bystander'], F.console);
      const r = runIn(old, ['worker', 'console-03-c'], SUP);
      assert.equal(r.status, 0, r.err);
      assert.equal(git(['rev-parse', 'refs/heads/bystander'], F.console), moved, 'S2: the branch it names is unmoved');
      assert.equal(git(['rev-parse', 'HEAD'], wt('console-03-c')), real, 'S2: origin\'s trunk');
    });
    await t.test('L5: a stale tracking ref\'s commits are kept in the link, and the upstream is its main', tmux, () => {
      ticket('console-05-e');
      const ref = 'refs/remotes/origin/ticket/console-05-e';
      const lost = planted(F.console, real, 'lost');
      git(['update-ref', ref, lost], F.console);
      const r = runIn(old, ['worker', 'console-05-e'], SUP);
      assert.equal(r.status, 0, r.err);
      assert.ok(hasRef(F.console, `refs/devteam/kept/ticket/console-05-e/${lost}`), 'L5: kept in the link');
      assert.ok(!hasRef(F.console, ref), 'L5: the tracking ref is gone');
      assert.equal(git(['config', '--get', 'branch.ticket/console-05-e.merge'], F.console), 'refs/heads/trunk', 'L5: the upstream');
    });
    await t.test('L4: two urls, the first another repo\'s', tmux, () => {
      ticket('console-04-d');
      const url = git(['config', '--get', 'remote.origin.url'], F.console);
      const other = path.join(F.base, 'other.git');
      git(['clone', '-q', '--bare', F.console, other], F.console);
      git(['update-ref', 'refs/heads/trunk', moved], other);
      git(['config', '--replace-all', 'remote.origin.url', other], F.console);
      git(['config', '--add', 'remote.origin.url', url], F.console);
      try {
        const r = runIn(old, ['worker', 'console-04-d'], SUP);
        assert.notEqual(r.status, 0, `L4: refused, not started: ${r.out}`);
        assert.match(r.err, /could not fetch origin trunk in console: its origin has 2 urls/, 'L4: says why');
        assert.ok(!fs.existsSync(wt('console-04-d')), 'L4: no worktree');
      } finally { git(['config', '--replace-all', 'remote.origin.url', url], F.console); }
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
