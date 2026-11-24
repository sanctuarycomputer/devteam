// A checkout the kit makes holds the commit it names, whatever refs/replace/* says. Any session can
// write a replace ref into the repo every worktree shares, and plain git follows one when it checks
// a tree out: planted on main's commit, it would hand the next worker, planner, chore, reviewer,
// measure or recurring check another tree (its CLAUDE.md, its .claude files, what worktree_setup
// runs) under the real commit's id. So every checkout runs git with -c core.useReplaceRefs=false,
// which also beats a core.useReplaceRefs=true a session sets in the repo's config (where
// --no-replace-objects alone loses): each fixture sets it. Each path is its own subtest, so each
// one's red line is its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, hasTmux, write } from './lib/kit.mjs';
import { readyInHome, recordsFixture, SUP } from './lib/multirepo-home-fixture.mjs';
import { after, cg, changedKit, SCRIPT, smokeRun } from './lib/machine-fixture.mjs';

const git = (args, cwd, input) => execFileSync('git', args, { cwd, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
const hasRef = (cwd, ref) => { try { git(['rev-parse', '--verify', '--quiet', ref], cwd); return true; } catch { return false; } };
const marker = (dir) => fs.readFileSync(path.join(dir, 'marker.txt'), 'utf8');
const tmux = { skip: !hasTmux && 'no tmux' };

// marker.txt says "real" on main's commit, pushed to origin.
function markMain(cwd) {
  write(path.join(cwd, 'marker.txt'), 'real\n');
  git(['add', 'marker.txt'], cwd);
  git(['commit', '-qm', 'marker'], cwd);
  git(['push', '-q', 'origin', 'main'], cwd);
  return git(['rev-parse', 'HEAD'], cwd);
}
// A commit with parent's files and these top-level files set (from tree's files), never checked out.
function commitWith(cwd, tree, parent, files, message) {
  const set = Object.fromEntries(Object.entries(files).map(([f, text]) => [f, git(['hash-object', '-w', '--stdin'], cwd, text)]));
  const entries = git(['-c', 'core.useReplaceRefs=false', 'ls-tree', tree], cwd).split('\n').filter((l) => !(l.split('\t')[1] in set));
  for (const [f, blob] of Object.entries(set)) entries.push(`100644 blob ${blob}\t${f}`);
  return git(['commit-tree', git(['mktree'], cwd, `${entries.join('\n')}\n`), '-p', parent, '-m', message], cwd);
}
// A replace ref swapping commit sha for a twin (same parent, same files) whose marker.txt says
// "planted"; plain git then reads the planted tree under the real id.
function plant(cwd, sha) {
  const fake = commitWith(cwd, sha, `${sha}^`, { 'marker.txt': 'planted\n' }, 'planted');
  git(['replace', sha, fake], cwd);
  replaceOn(cwd);
  assert.equal(git(['show', `${sha}:marker.txt`], cwd), 'planted', 'the plant took');
  // with replace refs off, the commit's own marker.txt (or none)
  let own = null;
  try { own = git(['-c', 'core.useReplaceRefs=false', 'show', `${sha}:marker.txt`], cwd); } catch {}
  assert.notEqual(own, 'planted');
}
// what a session can set: replace refs on, which beats --no-replace-objects on older git (spec-1 F1)
function replaceOn(cwd) {
  git(['config', 'core.useReplaceRefs', 'true'], cwd);
  assert.equal(git(['--no-replace-objects', 'config', '--get', 'core.useReplaceRefs'], cwd), 'true');
}

test('home: every checkout of a planted main holds the real tree', async (t) => {
  const F = fleetFixture('no-replace-home');
  const { old, ok } = F;
  try {
    const real = markMain(old);
    plant(old, real);
    // whether --no-replace-objects alone loses to the config depends on git's version (it does on
    // 2.39, not on 2.56); the command line's -c core.useReplaceRefs=false wins on both, so it isn't asserted
    const ticket = (id) => ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: [`ch/${id}/**`], done_when: ['the tidy check passes in CI'] })], SUP);
    const wt = (name) => path.join(old, '.worktrees', name);
    for (const id of ['ch-01-a', 'ch-02-b', 'ch-03-c']) ticket(id);

    await t.test('A1: a new worker\'s branch, made from origin/main (makeSession)', tmux, () => {
      assert.ok(!hasRef(old, 'refs/heads/ticket/ch-01-a') && !hasRef(old, 'refs/remotes/origin/ticket/ch-01-a'));
      ok(old, ['worker', 'ch-01-a'], SUP);
      assert.equal(marker(wt('ch-01-a')), 'real\n', 'A1');
    });
    await t.test('A2: a worker whose local branch exists (makeSession)', tmux, () => {
      // at origin's commit: a ticket that hasn't run takes no local branch origin doesn't hold (kit-790)
      git(['push', '-q', 'origin', `${real}:refs/heads/ticket/ch-02-b`], old);
      git(['branch', 'ticket/ch-02-b', real], old);
      ok(old, ['worker', 'ch-02-b'], SUP);
      assert.equal(marker(wt('ch-02-b')), 'real\n', 'A2');
    });
    await t.test('A3: a worker whose branch is only on origin (makeSession)', tmux, () => {
      git(['push', '-q', 'origin', `${real}:refs/heads/ticket/ch-03-c`], old);
      assert.ok(!hasRef(old, 'refs/heads/ticket/ch-03-c'));
      ok(old, ['worker', 'ch-03-c'], SUP);
      assert.equal(marker(wt('ch-03-c')), 'real\n', 'A3');
    });
    await t.test('A4: a planner\'s new plan branch (makeSession)', tmux, () => {
      const G = ok(old, ['goal', 'add', '--title', 'Tidy', '--outcome', 'tidy', '--measure', 'untidy files', '--target', '0', '--unit', 'files', '--direction', 'down', '--source', 'prod', '--check', 'echo 0', '--non-goals', 'none', '--preconditions', 'a'], SUP).trim();
      ok(old, ['planner', 'beta', '--goal', G], SUP);
      assert.equal(marker(wt('plan-beta')), 'real\n', 'A4');
    });
    await t.test('C1: a new chore worktree (choreWorktree)', () => {
      ok(old, ['chore', 'start', 'tidy-up'], SUP);
      assert.equal(marker(wt('chore-tidy-up')), 'real\n', 'C1');
    });
    await t.test('C2: a chore worktree reset onto main (choreWorktree, log-sync)', () => {
      // an existing chore-log a commit behind (no marker.txt there yet): log-sync resets it onto origin/main
      git(['worktree', 'add', '-q', '-B', 'chore-log', wt('chore-log'), `${real}^`], old);
      assert.ok(!fs.existsSync(path.join(wt('chore-log'), 'marker.txt')));
      F.run(old, ['log-sync'], SUP);
      assert.equal(marker(wt('chore-log')), 'real\n', 'C2');
    });
    await t.test('D1: a detached worktree of main, a repo measure\'s reading (detachedWorktree)', () => {
      const G = ok(old, ['goal', 'add', '--title', 'Planted', '--outcome', 'none planted', '--measure', 'planted markers', '--target', '0', '--unit', 'markers', '--direction', 'down', '--source', 'repo', '--check', 'grep -c planted marker.txt || true', '--non-goals', 'none', '--preconditions', 'a'], SUP).trim();
      const said = ok(old, ['goal', 'reading', G, '--run'], SUP);
      // the check counts "planted" in the detached worktree's marker.txt: 0 on the real tree
      assert.match(said, /^recorded 0 for /, `D1: ${said}`);
    });
    await t.test('V1: a review worktree of a commit (cmdReviewWorktree)', () => {
      const rv = ok(old, ['review-worktree', 'ch-01-a', real]).split('\n')[0];
      assert.equal(marker(rv), 'real\n', 'V1');
    });
    await t.test('C3: log-sync extends an existing chore-log and merges main in (cmdLogSync)', () => {
      // origin's chore-log: a commit off main's parent with a log file, planted to add marker.txt
      const X = commitWith(old, `${real}^`, `${real}^`, { 'chore.txt': 'log\n' }, 'chore-log');
      git(['push', '-q', '-f', 'origin', `${X}:refs/heads/chore-log`], old);
      plant(old, X);
      const r = F.run(old, ['log-sync'], SUP);
      assert.doesNotMatch(r.err, /could not take in/, `C3: main merged into chore-log: ${r.err}`);
      assert.equal(marker(wt('chore-log')), 'real\n', 'C3');
      assert.ok(fs.existsSync(path.join(wt('chore-log'), 'chore.txt')), 'C3: on chore-log');
    });
    await t.test('C4: log-sync rebuilds a chore-log that conflicts with main (cmdLogSync)', () => {
      // origin's chore-log adds its own marker.txt: main's can't merge in, so it is rebuilt from main
      const Y = commitWith(old, `${real}^`, `${real}^`, { 'marker.txt': 'other\n' }, 'chore-log');
      git(['push', '-q', '-f', 'origin', `${Y}:refs/heads/chore-log`], old);
      const r = F.run(old, ['log-sync'], SUP);
      assert.match(r.err, /could not take in/, 'C4: the rebuild ran');
      assert.equal(marker(wt('chore-log')), 'real\n', 'C4');
    });
    await t.test('C5: log-sync rebuilds from a planted chore-log that conflicts with main (cmdLogSync)', () => {
      // as C4, but origin's chore-log is planted too: the merge's abort reads it, and the rebuild follows
      const Y = commitWith(old, `${real}^`, `${real}^`, { 'marker.txt': 'other\n' }, 'chore-log 2');
      git(['push', '-q', '-f', 'origin', `${Y}:refs/heads/chore-log`], old);
      plant(old, Y);
      const r = F.run(old, ['log-sync'], SUP);
      assert.match(r.err, /could not take in/, `C5: the rebuild ran: ${r.err}`);
      assert.equal(marker(wt('chore-log')), 'real\n', 'C5');
    });
    await t.test('S1: the responder\'s first start (RESPONDER_GIT)', tmux, () => {
      try {
        ok(old, ['responder'], SUP);
        assert.equal(marker(wt('responder')), 'real\n', 'S1');
      } finally { F.run(old, ['responder', '--stop'], SUP); }
    });
    await t.test('E1: a recurring check\'s checkout of main (recurringRunDue)', () => {
      // a draft runs the entry from this checkout's file, in a checkout of main's commit
      write(path.join(old, 'docs/devteam/project/recurring.json'), `${JSON.stringify({ nr: { kind: 'check', title: 'Marker', what: 'reads the marker', every: '1d', run: 'cat marker.txt' } }, null, 2)}\n`);
      const said = ok(old, ['recurring', 'run', 'nr', '--draft'], SUP);
      assert.match(said, /^excerpt: .*\breal\b/m, `E1: ${said}`);
      assert.doesNotMatch(said, /planted/, `E1: ${said}`);
    });
  } finally { F.done(); }
});

test('records in home: the records checkouts of a planted commit hold the real tree', async (t) => {
  const F = recordsFixture('no-replace-records');
  const { old, okIn, ticket } = F;
  try {
    const real = markMain(old);
    // V2's ticket, its records made before any plant (the fixture checks out with plain git)
    const r = readyInHome(F, 'console-14-d');
    plant(old, real);
    const rw = (id) => path.join(old, '.worktrees', `records-${id}`);

    await t.test('R1: a new records branch from home\'s origin/main (ensureRecordsWorktree)', tmux, () => {
      ticket('console-11-a');
      okIn(old, ['worker', 'console-11-a'], SUP);
      assert.equal(marker(rw('console-11-a')), 'real\n', 'R1');
    });
    await t.test('R2: a records branch that exists locally (ensureRecordsWorktree)', tmux, () => {
      ticket('console-12-b');
      git(['branch', 'ticket/console-12-b', real], old);
      okIn(old, ['worker', 'console-12-b'], SUP);
      assert.equal(marker(rw('console-12-b')), 'real\n', 'R2');
    });
    await t.test('R3: a records branch only on home\'s origin (ensureRecordsWorktree)', tmux, () => {
      ticket('console-13-c');
      git(['push', '-q', 'origin', `${real}:refs/heads/ticket/console-13-c`], old);
      assert.ok(!hasRef(old, 'refs/heads/ticket/console-13-c'));
      okIn(old, ['worker', 'console-13-c'], SUP);
      assert.equal(marker(rw('console-13-c')), 'real\n', 'R3');
    });
    await t.test('V2: review-worktree\'s records checkout (cmdReviewWorktree)', () => {
      plant(old, r.head);
      const out = okIn(old, ['review-worktree', 'console-14-d', r.code]).split('\n');
      const m = /^records: (\S+) \(([0-9a-f]{40})\)$/.exec(out[1] ?? '');
      assert.ok(m, out.join('\n'));
      assert.equal(m[2], r.head);
      assert.equal(marker(m[1]), 'real\n', 'V2');
    });
  } finally { F.done(); }
});

// box-pins changed --smoke checks the image out at --since (its readers) and builds each side's
// fixture kit from git archive: a twin of v9.1.0 whose machineStatus prints PLANTED-IMAGE (seen if
// the image's checkout is planted) and whose hello --json says kit PLANTED-FIXTURE (seen if a
// fixture's kit is).
test('box-pins changed --smoke: the image checkout and the fixtures\' kits are the real commit\'s', async (t) => {
  changedKit();
  const real = cg(['rev-parse', 'v9.1.0^{commit}']).trim();
  cg(['checkout', '-q', '-B', 'no-replace-src', 'v9.1.0']);
  const p = path.join(cg(['rev-parse', '--show-toplevel']).trim(), SCRIPT);
  let text = fs.readFileSync(p, 'utf8');
  text = after('async function machineStatus() {\n', "  out('PLANTED-IMAGE');\n")(text);
  text = after('function cmdHello() {\n', "  if (flags.json) return out(JSON.stringify({ kit: 'PLANTED-FIXTURE' }));\n")(text);
  fs.writeFileSync(p, text);
  cg(['commit', '-qam', 'planted']);
  const fake = cg(['commit-tree', cg(['rev-parse', 'HEAD^{tree}']).trim(), '-m', 'planted']).trim();
  cg(['checkout', '-q', '-B', 'no-replace', 'v9.1.0']);
  cg(['branch', '-q', '-D', 'no-replace-src']);
  cg(['replace', real, fake]);
  cg(['config', 'core.useReplaceRefs', 'true']);
  try {
    const top = cg(['rev-parse', '--show-toplevel']).trim();
    assert.match(git(['show', `${real}:${SCRIPT}`], top), /PLANTED-IMAGE/, 'the plant took');
    assert.doesNotMatch(git(['-c', 'core.useReplaceRefs=false', 'show', `${real}:${SCRIPT}`], top), /PLANTED-IMAGE/);
    const { r, trace } = smokeRun(['--since', 'v9.1.0', '--to', 'v9.1.0']);
    const status = trace.filter((x) => x.command === 'machine status');
    assert.equal(status.length, 2, `both fixtures read: ${r.stderr}${r.stdout}`);
    await t.test('X1: the image\'s checkout at --since (imageChanges)', () => {
      for (const x of trace) assert.doesNotMatch(x.stdout, /PLANTED-IMAGE/, `X1: ${x.fixture} ${x.command}`);
    });
    await t.test('X2: each fixture\'s kit from git archive (imageChanges)', () => {
      for (const x of status) {
        assert.match(x.stdout, /\bkit=\S+/, `${x.fixture}: ${x.stdout}`);
        assert.doesNotMatch(x.stdout, /kit=PLANTED-FIXTURE/, `X2: ${x.fixture}`);
      }
    });
  } finally {
    cg(['replace', '-d', real]);
    cg(['config', '--unset', 'core.useReplaceRefs']);
  }
});

// kit-764 final-1 F1, kit-790: a launch reads origin's main itself, and makeSession reads it again
// by sha for the new worktree's base, so a session that moved its local origin/main (no push)
// can't decide that base. When makeSession's own read of origin fails, nothing starts: a git on
// PATH refuses exactly that read ("ls-remote origin refs/heads/main …"); the launch's own
// ("ls-remote --symref origin HEAD") passes.
test('O1: a new worker whose makeSession read of origin fails is refused, and nothing starts', tmux, () => {
  const F = fleetFixture('no-replace-origin');
  const { old, ok, run } = F;
  try {
    markMain(old);
    // the session's move: origin/main at a local commit origin never had
    const moved = commitWith(old, 'HEAD', 'HEAD', { 'marker.txt': 'moved\n' }, 'moved');
    git(['update-ref', 'refs/remotes/origin/main', moved], old);
    const bin = path.join(F.base, 'git-refuses-read');
    const said = path.join(F.base, 'refused.txt');
    const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    write(path.join(bin, 'git'), `#!/bin/sh\ncase " $* " in *" ls-remote origin refs/heads/main "*) echo "$*" >> '${said}'; echo 'fatal: refused by the test' >&2; exit 128 ;; esac\nexec '${realGit}' "$@"\n`);
    fs.chmodSync(path.join(bin, 'git'), 0o755);
    ok(old, ['ticket', 'add', 'ch-09-o', '--json', JSON.stringify({ title: 'ch-09-o', feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['ch/ch-09-o/**'], done_when: ['the tidy check passes in CI'] })], SUP);
    const r = run(old, ['worker', 'ch-09-o'], { ...SUP, PATH: `${bin}${path.delimiter}${process.env.PATH}` });
    assert.notEqual(r.status, 0, `O1: refused, not started: ${r.out}`);
    assert.match(r.err, /could not fetch origin main in home: refused by the test; refusing to start a ticket on a stale main/, 'O1');
    assert.ok(!fs.existsSync(path.join(old, '.worktrees', 'ch-09-o')), 'O1: no worktree');
    assert.match(fs.readFileSync(said, 'utf8'), /ls-remote origin refs\/heads\/main/, 'makeSession\'s own read was the one refused');
  } finally { F.done(); }
});
