// The responder's drafts (kit-105): `responder draft <slug>` opens, or reuses, the chore worktree
// .worktrees/chore-artifact-<slug> for an artifact landed on main, so the responder can edit it while
// the supervisor works; it refuses, naming the session to relay to, when a ticket's or planner's
// worktree has changed the same artifact since it left main; --new starts a fresh artifact there; the
// supervisor lands the draft with the chore commands it already has; and nobody but the responder
// runs it, or gets past choreWorktree's main-checkout check.
// Run: env -u TMUX node --test test/responder-draft.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fleetFixture, kit } from './lib/kit.mjs';
import { runNode } from './lib/cli.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const RESPONDER = { DEVTEAM_ROLE: 'responder' };
const ARTS = 'docs/devteam/project/artifacts';

// A project with one artifact, demo, landed on main, and the responder's worktree at main. Every kit
// call runs without TMUX, so nothing it does can reach a tmux server outside the fixture's own.
function fixture(name) {
  const F = fleetFixture(name);
  const env = (role) => { const e = F.env(role); delete e.TMUX; delete e.TMUX_PANE; delete e.DEVTEAM_SUPERVISOR; for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_CHANNEL']) if (!(k in role)) delete e[k]; return e; };
  const run = (cwd, args, role = {}) => { const r = runNode(path.join(cwd, 'docs/devteam/scripts/devteam.mjs'), args, { cwd, env: env(role) }); return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
  const ok = (cwd, args, role = {}) => { const r = run(cwd, args, role); assert.equal(r.status, 0, `${args.join(' ')}: ${r.err || r.out}`); return r.out; };
  const fails = (cwd, args, role = {}) => { const r = run(cwd, args, role); assert.notEqual(r.status, 0, `${args.join(' ')} should fail: ${r.out}`); return `${r.err}\n${r.out}`; };
  const { g, old } = F;
  // demo lands on main as a chore would land it
  const seed = path.join(old, '.worktrees', 'chore-seed');
  g(['worktree', 'add', '-q', '-b', 'chore-seed', seed, 'main'], old);
  ok(seed, ['artifact', 'new', 'demo', '--title', 'Demo', '--summary', 'a page to edit'], SUP);
  g(['add', '-A'], seed);
  g(['commit', '-qm', 'demo'], seed);
  g(['push', '-q', 'origin', 'HEAD:main'], seed);
  g(['worktree', 'remove', '--force', seed], old);
  g(['branch', '-D', 'chore-seed'], old);
  g(['pull', '-q', '--ff-only', 'origin', 'main'], old);
  const rw = path.join(old, '.worktrees', 'responder');
  g(['worktree', 'add', '-q', '--detach', rw, 'origin/main'], old);
  const draftOf = (slug) => path.join(old, '.worktrees', `chore-artifact-${slug}`);
  // another machine lands a commit on origin's main; this checkout hasn't fetched it
  let pushes = 0;
  const landElsewhere = (rel, text) => {
    const c = path.join(F.base, `elsewhere-${++pushes}`);
    g(['clone', '-q', F.org, c], F.base);
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) g(['config', k, v], c);
    fs.appendFileSync(path.join(c, rel), text);
    g(['commit', '-qam', `elsewhere ${pushes}`], c);
    g(['push', '-q', 'origin', 'HEAD:main'], c);
    return g(['rev-parse', 'HEAD'], c);
  };
  // what a second run must leave as it was: worktrees, branches, the remote-tracking main (no
  // fetch), the draft's commit and its files
  const state = (slug) => ({
    worktrees: g(['worktree', 'list', '--porcelain'], old),
    branches: g(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/'], old),
    remote: g(['rev-parse', 'refs/remotes/origin/main'], old),
    head: fs.existsSync(draftOf(slug)) ? g(['rev-parse', 'HEAD'], draftOf(slug)) : null,
    status: fs.existsSync(draftOf(slug)) ? g(['status', '--porcelain'], draftOf(slug)) : null,
  });
  // a ticket the log knows, so its worktree is a session the responder can send to
  const ticket = (id) => ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component: 'web', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['web/**'], done_when: ['its suite passes in CI'], notes: 'n' })], SUP);
  // the supervisor lands a draft, as it does any chore
  const land = (slug) => { ok(old, ['chore', 'pr', `artifact-${slug}`, '--title', `${slug}: the owner's change`], SUP); ok(old, ['merge', '--chore', `artifact-${slug}`], SUP); g(['fetch', '-q', 'origin', 'main'], old); };
  return { ...F, env, run, ok, fails, rw, draftOf, state, landElsewhere, ticket, land };
}

test('D1: responder draft <slug> opens a chore worktree from origin/main for a landed artifact, and a second run changes nothing', () => {
  const F = fixture('responder-draft-open');
  const { old, g, rw, draftOf } = F;
  try {
    const main = g(['rev-parse', 'origin/main'], old);
    const at = F.ok(rw, ['responder', 'draft', 'demo'], RESPONDER);
    assert.equal(at, fs.realpathSync(draftOf('demo')), 'it prints the draft\'s path');
    assert.equal(g(['rev-parse', '--abbrev-ref', 'HEAD'], at), 'chore-artifact-demo', 'on chore-artifact-demo');
    assert.equal(g(['rev-parse', 'HEAD'], at), main, 'from origin/main');
    assert.ok(fs.existsSync(path.join(at, ARTS, 'demo', 'index.html')), 'the artifact is there to edit');
    // the responder edits it, and main moves on elsewhere; a second run prints the same path and
    // leaves everything as it was: it fetches nothing, resets nothing, keeps the edit
    fs.appendFileSync(path.join(at, ARTS, 'demo', 'index.html'), '<!-- the owner asked for this -->\n');
    F.landElsewhere('.gitignore', '# elsewhere\n');
    const before = F.state('demo');
    assert.equal(F.ok(rw, ['responder', 'draft', 'demo'], RESPONDER), at, 'the same path again');
    assert.deepEqual(F.state('demo'), before, 'a second run changes no worktree, branch, remote ref, commit or file');
    // one with nothing landed under that slug, and no --new, is refused and makes nothing
    assert.match(F.fails(rw, ['responder', 'draft', 'nothing-here'], RESPONDER), /no artifact nothing-here on main.*--new/s);
    assert.ok(!fs.existsSync(draftOf('nothing-here')), 'no worktree for a slug that is not landed');
    assert.equal(g(['branch', '--list', 'chore-artifact-nothing-here'], old), '', 'and no branch');
  } finally { F.done(); }
});

test('D2: a ticket\'s or planner\'s worktree that changed the artifact is named, with send <session>, and nothing is made', () => {
  const F = fixture('responder-draft-relay');
  const { old, g, rw, draftOf } = F;
  try {
    for (const id of ['web-01-a', 'web-02-b', 'web-03-c', 'web-07-g', 'web-09-z']) F.ticket(id);
    // a ticket cut before an edit to demo landed: its copy differs from main's, but it changed nothing
    const stale = path.join(old, '.worktrees', 'web-09-z');
    g(['worktree', 'add', '-q', '-b', 'ticket/web-09-z', stale, 'origin/main'], old);
    F.landElsewhere(`${ARTS}/demo/index.html`, '<!-- landed after web-09-z was cut -->\n');
    g(['fetch', '-q', 'origin'], old);
    // a worker's records checkout in home names its ticket: send <id>
    for (const [name, branch, to] of [['web-01-a', 'ticket/web-01-a', 'web-01-a'], ['plan-checkout', 'plan/checkout', 'plan-checkout'], ['records-web-03-c', 'ticket/web-03-c', 'web-03-c']]) {
      const w = path.join(old, '.worktrees', name);
      g(['worktree', 'add', '-q', '-b', branch, w, 'origin/main'], old);
      fs.appendFileSync(path.join(w, ARTS, 'demo', 'index.html'), `<!-- ${name} is changing this -->\n`);
      const before = F.state('demo');
      const said = F.fails(rw, ['responder', 'draft', 'demo'], RESPONDER);
      assert.match(said, new RegExp(`${name}.*send ${to}`, 's'), `names ${name} and how to relay to it`);
      assert.ok(!fs.existsSync(draftOf('demo')), 'no draft worktree is made');
      assert.deepEqual(F.state('demo'), before, 'no branch either');
      g(['worktree', 'remove', '--force', w], old);
    }
    // a commit of its own counts as much as an uncommitted edit
    const w = path.join(old, '.worktrees', 'web-02-b');
    g(['worktree', 'add', '-q', '-b', 'ticket/web-02-b', w, 'origin/main'], old);
    fs.appendFileSync(path.join(w, ARTS, 'demo', 'index.html'), '<!-- committed -->\n');
    g(['commit', '-qam', 'web-02-b changes demo'], w);
    assert.match(F.fails(rw, ['responder', 'draft', 'demo'], RESPONDER), /web-02-b.*send web-02-b/s, 'a committed change');
    // and a new artifact a ticket is drawing (untracked files) is the ticket's too
    F.ok(w, ['artifact', 'new', 'fresh', '--title', 'Fresh', '--summary', 's'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'web-02-b' });
    assert.match(F.fails(rw, ['responder', 'draft', 'fresh', '--new', '--title', 't', '--summary', 's'], RESPONDER), /web-02-b.*send web-02-b/s);
    assert.ok(!fs.existsSync(draftOf('fresh')), 'no draft worktree for it');
    g(['worktree', 'remove', '--force', w], old);
    // a folder that is no session (a hand-made worktree, another chore): the supervisor's to relay
    for (const [name, branch] of [['scratch-copy', 'scratch-copy'], ['chore-other', 'chore-other']]) {
      const x = path.join(old, '.worktrees', name);
      g(['worktree', 'add', '-q', '-b', branch, x, 'origin/main'], old);
      fs.appendFileSync(path.join(x, ARTS, 'demo', 'index.html'), `<!-- ${name} -->\n`);
      const said = F.fails(rw, ['responder', 'draft', 'demo'], RESPONDER);
      assert.match(said, new RegExp(`${name}.*send supervisor .*--kind handoff`, 's'), `${name}: handed to the supervisor`);
      assert.doesNotMatch(said, new RegExp(`send ${name}\\b`), `${name}: never send ${name}`);
      g(['worktree', 'remove', '--force', x], old);
    }
    // another machine's ticket branch that changed demo, fetched as the dashboard fetches one; the
    // stale web-09-z, whose copy differs from main's, must not hide it
    const c = path.join(F.base, 'other-machine');
    g(['clone', '-q', F.org, c], F.base);
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) g(['config', k, v], c);
    g(['checkout', '-q', '-b', 'ticket/web-07-g'], c);
    fs.appendFileSync(path.join(c, ARTS, 'demo', 'index.html'), '<!-- web-07-g, elsewhere -->\n');
    g(['commit', '-qam', 'web-07-g changes demo'], c);
    g(['push', '-q', 'origin', 'ticket/web-07-g'], c);
    g(['fetch', '-q', 'origin', '+refs/heads/ticket/web-07-g:refs/devteam-remote/ticket/web-07-g'], old);
    assert.match(F.fails(rw, ['responder', 'draft', 'demo'], RESPONDER), /web-07-g.*send web-07-g/s, 'another machine\'s branch, behind a stale local copy');
    assert.ok(!fs.existsSync(draftOf('demo')), 'no draft worktree for it');
    g(['update-ref', '-d', 'refs/devteam-remote/ticket/web-07-g'], old);
    // a plain folder under .worktrees/ (no worktree of its own) holding a copy of demo can't be read:
    // handed over; one that holds no demo can't be drawing it, and never blocks (final-1 F2)
    const plain = path.join(old, '.worktrees', 'kit-notes');
    fs.mkdirSync(path.join(plain, ARTS, 'demo'), { recursive: true });
    fs.writeFileSync(path.join(plain, ARTS, 'demo', 'index.html'), '<!-- a copy -->\n');
    assert.match(F.fails(rw, ['responder', 'draft', 'demo'], RESPONDER), /kit-notes.*can't be read.*send supervisor .*--kind handoff/s, 'a plain folder with a copy: handed over');
    fs.rmSync(path.join(plain, ARTS), { recursive: true });
    fs.writeFileSync(path.join(plain, 'notes.txt'), 'notes\n');
    // what's left is web-09-z, whose copy is older than main's but unchanged by it, and a plain
    // folder with no copy of demo: no draft is blocked
    assert.equal(F.ok(rw, ['responder', 'draft', 'demo'], RESPONDER), fs.realpathSync(draftOf('demo')), 'a worktree that changed nothing never blocks a draft');
  } finally { F.done(); }
});

test('D3: responder draft <slug> --new makes a fresh chore worktree with artifact new\'s files, by the responder, that artifact check passes', () => {
  const F = fixture('responder-draft-new');
  const { old, g, rw, draftOf } = F;
  try {
    const at = F.ok(rw, ['responder', 'draft', 'fresh', '--new', '--title', 'Fresh page', '--summary', 'what the owner asked for'], RESPONDER);
    assert.equal(at, fs.realpathSync(draftOf('fresh')));
    assert.equal(g(['rev-parse', '--abbrev-ref', 'HEAD'], at), 'chore-artifact-fresh');
    assert.equal(g(['rev-parse', 'HEAD'], at), g(['rev-parse', 'origin/main'], old), 'from origin/main');
    const m = JSON.parse(fs.readFileSync(path.join(at, ARTS, 'fresh', 'artifact.json'), 'utf8'));
    assert.equal(m.by, 'responder', 'the manifest says by responder');
    assert.equal(m.title, 'Fresh page');
    assert.ok(fs.existsSync(path.join(at, ARTS, 'fresh', 'index.html')), 'artifact new\'s page');
    assert.match(F.ok(at, ['artifact', 'check', 'fresh'], RESPONDER), /1 artifact pass/);
    // once made, --new again names the draft rather than make another
    assert.match(F.fails(rw, ['responder', 'draft', 'fresh', '--new', '--title', 't', '--summary', 's'], RESPONDER), /chore-artifact-fresh.*responder draft fresh/s);
    assert.equal(F.ok(rw, ['responder', 'draft', 'fresh'], RESPONDER), at, 'and without --new it is the draft\'s path');
  } finally { F.done(); }
});

test('D3r: --new refuses, leaving worktrees and branches as they were, when a flag is missing, the slug is on main, or artifact new refuses', () => {
  const F = fixture('responder-draft-new-refused');
  const { old, g, rw } = F;
  try {
    // a branch of that name left from before: a failed --new puts it back where it was
    g(['branch', 'chore-artifact-fresh', g(['rev-list', '--max-parents=0', 'HEAD'], old)], old);
    for (const [args, re] of [
      [['fresh', '--new', '--summary', 's'], /--new needs --title and --summary/],
      [['demo', '--new', '--title', 't', '--summary', 's'], /demo is on main.*responder draft demo/s],
      // artifact new refuses after the worktree is made: the worktree goes, the branch is put back
      [['fresh', '--new', '--title', 't', '--summary', 's', '--kind', 'poster'], /kind is mock, diagram or docs/],
    ]) {
      const before = F.state(args[0]);
      assert.match(F.fails(rw, ['responder', 'draft', ...args], RESPONDER), re, args.join(' '));
      assert.deepEqual(F.state(args[0]), before, `${args.join(' ')}: worktrees and branches as they were`);
    }
  } finally { F.done(); }
});

test('D4: the supervisor lands a draft with chore pr artifact-<slug> and merge --chore artifact-<slug>; a landed draft starts again from main', () => {
  const F = fixture('responder-draft-land');
  const { old, g, rw } = F;
  try {
    const edited = F.ok(rw, ['responder', 'draft', 'demo'], RESPONDER);
    fs.appendFileSync(path.join(edited, ARTS, 'demo', 'index.html'), '<!-- edited by the responder -->\n');
    F.ok(rw, ['responder', 'draft', 'fresh', '--new', '--title', 'Fresh', '--summary', 's'], RESPONDER);
    for (const [slug, file, want] of [['demo', 'index.html', /edited by the responder/], ['fresh', 'artifact.json', /"by": "responder"/]]) {
      F.ok(old, ['chore', 'pr', `artifact-${slug}`, '--title', `${slug}: the owner's change`], SUP);
      if (slug === 'demo') {
        // pushed, not yet merged: a draft run keeps the chore's commit
        const pushed = g(['rev-parse', 'HEAD'], edited);
        assert.equal(F.ok(rw, ['responder', 'draft', 'demo'], RESPONDER), edited);
        assert.equal(g(['rev-parse', 'HEAD'], edited), pushed, 'an unmerged draft keeps its commit');
      }
      F.ok(old, ['merge', '--chore', `artifact-${slug}`], SUP);
      g(['fetch', '-q', 'origin', 'main'], old);
      assert.match(g(['show', `origin/main:${ARTS}/${slug}/${file}`], old), want, `${slug} is on main`);
    }
    // landed and clean: the next draft of demo starts from main as it is now, in the same folder
    const now = F.landElsewhere('.gitignore', '# after the landing\n');
    assert.equal(F.ok(rw, ['responder', 'draft', 'demo'], RESPONDER), edited, 'the same folder');
    assert.equal(g(['rev-parse', 'HEAD'], edited), now, 'at origin\'s main');
    assert.equal(g(['rev-parse', '--abbrev-ref', 'HEAD'], edited), 'chore-artifact-demo');
  } finally { F.done(); }
});

test('D4s: a draft landed by squash (merge recorded at its head, its commit not on main) starts again from main', () => {
  const F = fixture('responder-draft-squash');
  const { old, g, rw } = F;
  try {
    const at = F.ok(rw, ['responder', 'draft', 'demo'], RESPONDER);
    fs.appendFileSync(path.join(at, ARTS, 'demo', 'index.html'), '<!-- squashed -->\n');
    F.land('demo');
    const head = g(['rev-parse', 'HEAD'], at);
    // origin's main as a squash or rebase merge leaves it: the change, in a commit of its own, and
    // the draft's commit on no branch of main; merge's act still names the draft's head
    const c = path.join(F.base, 'squasher');
    g(['clone', '-q', F.org, c], F.base);
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) g(['config', k, v], c);
    g(['reset', '-q', '--hard', 'HEAD^1'], c);
    g(['merge', '-q', '--squash', head], c);
    g(['commit', '-qm', 'chore-artifact-demo (squashed)'], c);
    g(['push', '-q', '--force', 'origin', 'HEAD:main'], c);
    const squashed = g(['rev-parse', 'HEAD'], c);
    assert.equal(F.ok(rw, ['responder', 'draft', 'demo'], RESPONDER), at, 'the same folder');
    assert.equal(g(['rev-parse', 'HEAD'], at), squashed, 'at origin\'s main, past the squashed draft');
  } finally { F.done(); }
});

test('D5: anyone but the responder is refused, and nothing is made', () => {
  const F = fixture('responder-draft-who');
  const { old, g, rw, draftOf } = F;
  try {
    const w = path.join(old, '.worktrees', 'web-01-a');
    g(['worktree', 'add', '-q', '-b', 'ticket/web-01-a', w, 'origin/main'], old);
    for (const [who, cwd, role, extra] of [
      ['the supervisor', old, SUP, []],
      ['the owner', old, {}, []],
      ['the owner, --owner', old, {}, ['--owner']],
      ['a worker', w, { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'web-01-a' }, []],
      ['a planner', w, { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'checkout' }, []],
      ['the dashboard', old, { DEVTEAM_CHANNEL: 'dashboard' }, []],
      // in the responder's folder, another role is still another role
      ['a worker in the responder\'s folder', rw, { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'web-01-a' }, []],
      ['the supervisor in the responder\'s folder', rw, SUP, []],
      ['the responder with --owner', rw, RESPONDER, ['--owner']],
      // a worker's or planner's session with no role set is still that session (final-1 F3)
      ['a ticket\'s env, no role, in the responder\'s folder', rw, { DEVTEAM_TICKET: 'web-01-a' }, []],
      ['a planner\'s env, no role, in the responder\'s folder', rw, { DEVTEAM_FEATURE: 'checkout' }, []],
    ]) {
      const before = F.state('demo');
      assert.match(F.fails(cwd, ['responder', 'draft', 'demo', ...extra], role), /responder draft: the responder's/, who);
      assert.ok(!fs.existsSync(draftOf('demo')), `${who}: no draft worktree`);
      assert.deepEqual(F.state('demo'), before, `${who}: nothing changed`);
    }
    // a link planted at the draft's path, to a ticket's worktree, is never taken as the draft: the
    // ticket's worktree stays on its branch at its commit (final-1 F1)
    const head = (at) => [g(['rev-parse', '--abbrev-ref', 'HEAD'], at), g(['rev-parse', 'HEAD'], at)];
    const was = head(w);
    fs.symlinkSync(w, draftOf('demo'));
    for (const args of [['demo'], ['demo', '--new', '--title', 't', '--summary', 's']]) {
      assert.match(F.fails(rw, ['responder', 'draft', ...args], RESPONDER), /chore-artifact-demo is not .*move it aside/s, `a link at the draft's path: ${args.join(' ')}`);
      assert.deepEqual(head(w), was, 'the ticket\'s worktree stays on its branch at its commit');
    }
    fs.unlinkSync(draftOf('demo'));
  } finally { F.done(); }
});

// choreWorktree's own check, loaded by itself (ruling a-20261123-044140027): outside the main
// checkout it lets through only the responder's process asking with { responder: true }; the flag
// alone, or the responder without it, or another role in the responder's place, stays refused.
test('D7: choreWorktree refuses every caller outside the main checkout but the responder asking as the responder', () => {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const i = src.indexOf('\nfunction choreWorktree(');
  const j = src.indexOf('\nfunction ', i + 1);
  assert.ok(i >= 0 && j > i, 'choreWorktree in devteam.mjs');
  const PASSED = 'past the main-checkout check';
  const call = ({ writer, role, opts, here = '/r/.worktrees/responder' }) => {
    const ctx = vm.createContext({
      choreSlug: (s) => s, commonDir: '/r/.git', projectInRepo: true, repoRoot: here, mainRoot: '/r',
      logWriter: () => writer, process: { env: role === undefined ? {} : { DEVTEAM_ROLE: role } },
      die: (m) => { throw new Error(`died: ${m}`); }, path,
      loadSettings: () => { throw new Error(PASSED); },
    });
    try { vm.runInContext(`${src.slice(i, j)}\nchoreWorktree('artifact-demo', ${JSON.stringify(opts)})`, ctx); } catch (e) { return e.message; }
    return 'returned';
  };
  const refused = (c) => assert.match(call(c), /died: run this from the main checkout/, JSON.stringify(c));
  for (const writer of ['supervisor', 'web-01-a', 'plan-checkout']) {
    for (const role of [undefined, 'supervisor', 'worker', 'planner', 'responder']) {
      refused({ writer, role, opts: { responder: true } });
      refused({ writer, role, opts: {} });
    }
  }
  for (const role of ['supervisor', 'worker', 'planner', 'operator']) refused({ writer: 'responder', role, opts: { responder: true } });
  for (const role of [undefined, 'responder']) refused({ writer: 'responder', role, opts: {} });
  // the responder asking as the responder gets past; the main checkout always did
  for (const role of [undefined, 'responder']) assert.equal(call({ writer: 'responder', role, opts: { responder: true } }), PASSED, `the responder (DEVTEAM_ROLE ${role ?? 'unset'})`);
  assert.equal(call({ writer: 'supervisor', role: 'supervisor', opts: {}, here: '/r' }), PASSED, 'the main checkout');
});

test('D6h: help lists responder draft', () => {
  const F = fixture('responder-draft-help');
  try {
    assert.match(F.ok(F.old, ['help']), /responder draft <slug> \[--new --title t --summary s\]/);
  } finally { F.done(); }
});

test('D6: the responder\'s section of supervisor.md says how to edit a draft, and how the supervisor lands it', () => {
  const doc = fs.readFileSync(path.join(kit, 'process', 'supervisor.md'), 'utf8');
  const at = doc.indexOf('\n## 13. The responder');
  assert.ok(at >= 0, 'supervisor.md has its section 13');
  const next = doc.indexOf('\n## ', at + 1);
  const s = doc.slice(at, next < 0 ? undefined : next);
  const own = s.indexOf("What follows is the responder's own part");
  assert.ok(own > 0, 'the section has the responder\'s own part');
  assert.match(s.slice(0, own), /chore pr artifact-<slug>[^.]*merge --chore artifact-<slug>/, 'the supervisor\'s part: how a draft lands');
  for (const [what, re] of [
    ['edit a landed artifact', /responder draft <slug>/],
    ['start a new one', /responder draft <slug> --new --title "…" --summary "…"/],
    ['relay to the session drawing it', /send <session> "[^"]*\(thread <t-id>\)"/],
    ['hand the landing over', /send supervisor "[^"]*chore-artifact-<slug>[^"]*" --kind handoff --thread <t-id>/],
  ]) assert.match(s.slice(own), re, what);
});
