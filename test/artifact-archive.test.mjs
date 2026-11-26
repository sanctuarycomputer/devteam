// Archived artifacts (kit-934, DCL-S15): the archive state is the log's, folded from the supervisor's
// acts of class artifact-archive and artifact-restore, newest per slug, and never stored in
// artifact.json. allArtifacts() (so 'artifacts' and /api/data's library.artifacts) carries
// archived: {at, goal, question} on a landed entry that is archived. 'artifact restore <slug>
// --reason' is the supervisor's. archivableArtifacts(g, at) ('artifact archivable <g> [--at]') is the
// one rule of what a met goal's question may archive (kit-935, kit-936).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { kit, threadsFixture, write } from './lib/kit.mjs';
import { cleanup } from './lib/chrome.mjs';

const ARTIFACTS_REL = 'docs/devteam/project/artifacts';
const SUP = { DEVTEAM_ROLE: 'supervisor' };
const page = '<!doctype html><html><body><p>a page</p></body></html>';
const drawn = (root, slug, forList, extra = {}) => {
  write(path.join(root, ARTIFACTS_REL, slug, 'artifact.json'), JSON.stringify({ v: 1, title: `Title ${slug}`, summary: 'A page to point at', by: 'supervisor', for: forList, ...extra }));
  write(path.join(root, ARTIFACTS_REL, slug, 'index.html'), page);
};
// commit what is drawn on main, dated (committer and author) at `when`, and push it, as a merge lands it
const landAt = (F, when, msg = 'artifacts') => {
  const env = { ...process.env, GIT_COMMITTER_DATE: when, GIT_AUTHOR_DATE: when };
  execFileSync('git', ['add', '-A', ARTIFACTS_REL], { cwd: F.old, env });
  execFileSync('git', ['commit', '-qm', msg], { cwd: F.old, env });
  execFileSync('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: F.old, env });
};
const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
// an act written by hand, as the kit would have written it agoMs ago, in by's live file
const handAct = (F, by, o, agoMs, file = null) => {
  const d = new Date(Date.now() - agoMs);
  return F.hand(by, { type: 'act', id: `a-${stamp(d)}-${by}`, reversible: true, ...o }, agoMs, file);
};
const rows = (F) => JSON.parse(F.sup(['artifacts', '--json']));
const bySlug = (list) => Object.fromEntries(list.filter((a) => a.at === 'main').map((a) => [a.slug, a]));
const libRows = (F) => JSON.parse(F.sup(['dashboard-data'])).library.artifacts;
const logBytes = (F) => fs.readdirSync(F.logDir).sort().map((f) => `${f}:${fs.readFileSync(path.join(F.logDir, f), 'utf8')}`).join('\n');
const treeOf = (root) => execFileSync('git', ['-C', root, 'ls-files', '-s', '-o', '--exclude-standard', ARTIFACTS_REL], { encoding: 'utf8' })
  + fs.readdirSync(path.join(root, ARTIFACTS_REL), { recursive: true }).sort().map((f) => { const p = path.join(root, ARTIFACTS_REL, f); return fs.statSync(p).isFile() ? `${f}:${fs.readFileSync(p, 'utf8')}` : f; }).join('\n');
const acts = (F, cls) => fs.readdirSync(F.logDir).flatMap((f) => fs.readFileSync(path.join(F.logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).filter((o) => o.type === 'act' && o.class === cls);

// One fixture for the fold: three landed artifacts for the goal and a worktree with two drafts.
function foldFixture(t, name) {
  const F = threadsFixture(name);
  cleanup(t)(() => F.done());
  for (const s of ['a-one', 'a-two', 'a-three']) drawn(F.old, s, [`goal:${F.goal}`]);
  landAt(F, '2026-01-01T00:00:00Z');
  const wt = path.join(F.old, '.worktrees', 'arch-draft');
  F.g(['worktree', 'add', '-q', '--detach', wt], F.old);
  drawn(wt, 'a-one', [`goal:${F.goal}`], { title: 'A changed draft of a-one' });
  drawn(wt, 'd-new', [`goal:${F.goal}`]);
  return { F, wt };
}
const Q = 'q-20260102-000000000-supervisor';

test('C1: the supervisor\'s artifact-archive act archives each slug it names; allArtifacts, artifacts and /api/data carry archived {at, goal, question} on landed entries only', (t) => {
  const { F } = foldFixture(t, 'archive-fold');
  const id = handAct(F, 'supervisor', { class: 'artifact-archive', what: 'archive', refs: [F.goal, 'artifact:a-one', 'artifact:a-two'], approved_by: Q }, 60000);
  const at = acts(F, 'artifact-archive').find((a) => a.id === id).at;
  const want = { at, goal: F.goal, question: Q };
  const cli = rows(F);
  const m = bySlug(cli);
  assert.deepEqual(m['a-one'].archived, want, 'a-one is archived, with the act\'s time, goal and question');
  assert.deepEqual(m['a-two'].archived, want, 'a-two too');
  assert.equal('archived' in m['a-three'], false, 'a-three, not named, has no archived key');
  for (const d of cli.filter((a) => a.at !== 'main')) assert.equal('archived' in d, false, `the draft ${d.slug} in ${d.at} has no archived key`);
  const lib = libRows(F);
  assert.deepEqual(bySlug(lib)['a-one'].archived, want, '/api/data library.artifacts carries it');
  assert.equal('archived' in bySlug(lib)['a-three'], false);
  for (const d of lib.filter((a) => a.at !== 'main')) assert.equal('archived' in d, false, `/api/data: the draft ${d.slug} has no archived key`);
  // the text list: [archived] after an archived slug's state, and on no other line
  const text = F.sup(['artifacts']).split('\n');
  assert.ok(text.some((l) => l.startsWith('a-one [landed] [archived] ')), text.join('\n'));
  assert.ok(text.some((l) => l.startsWith('a-two [landed] [archived] ')), text.join('\n'));
  assert.equal(text.filter((l) => l.includes('[archived]')).length, 2, text.join('\n'));
  // an act with no goal ref and no approved_by: goal and question are null, never missing
  handAct(F, 'supervisor', { class: 'artifact-archive', what: 'archive', refs: ['artifact:a-three'] }, 30000);
  assert.deepEqual(bySlug(rows(F))['a-three'].archived, { at: acts(F, 'artifact-archive').find((a) => a.refs.length === 1).at, goal: null, question: null }, 'no goal ref and no question: both null');
});

test('C2: artifact restore (the supervisor) appends one artifact-restore act and the slug is unarchived; the newest act per slug wins; no artifact file changes', (t) => {
  const { F, wt } = foldFixture(t, 'archive-restore');
  handAct(F, 'supervisor', { class: 'artifact-archive', what: 'archive', refs: [F.goal, 'artifact:a-one', 'artifact:a-two'], approved_by: Q }, 60000);
  const before = { main: treeOf(F.old), wt: treeOf(wt) };
  const n = acts(F, 'artifact-restore').length;
  F.sup(['artifact', 'restore', 'a-one', '--reason', 'its goal was reopened']);
  const r = acts(F, 'artifact-restore');
  assert.equal(r.length, n + 1, 'one artifact-restore act');
  const a = r[r.length - 1];
  assert.equal(a.by, 'supervisor');
  assert.deepEqual(a.refs, ['artifact:a-one']);
  assert.match(a.what, /^restore\b/);
  assert.match(a.what, /its goal was reopened/, 'the reason is in what');
  assert.equal(a.rung, undefined, 'a constitutional act carries no rung');
  let m = bySlug(rows(F));
  assert.equal('archived' in m['a-one'], false, 'a-one is back');
  assert.ok(m['a-two'].archived, 'a-two stays archived');
  // a newer archive act wins over the restore
  const id = handAct(F, 'supervisor', { class: 'artifact-archive', what: 'archive', refs: [F.goal, 'artifact:a-one'], approved_by: Q }, 0);
  m = bySlug(rows(F));
  assert.equal(m['a-one'].archived?.at, acts(F, 'artifact-archive').find((x) => x.id === id).at, 'the newest act per slug wins');
  assert.equal(treeOf(F.old), before.main, 'nothing under project/artifacts/ on main\'s checkout changed');
  assert.equal(treeOf(wt), before.wt, 'nor in the draft\'s worktree');
});

test('C3: restore refuses a slug that isn\'t archived, a draft, an unknown or malformed slug and a missing reason, writing nothing', (t) => {
  const { F } = foldFixture(t, 'archive-restore-refusals');
  handAct(F, 'supervisor', { class: 'artifact-archive', what: 'archive', refs: [F.goal, 'artifact:a-one'], approved_by: Q }, 60000);
  const before = logBytes(F);
  const cases = [
    [['a-three', '--reason', 'a reason'], /a-three is not archived/],
    [['d-new', '--reason', 'a reason'], /d-new is a draft/],
    [['no-such', '--reason', 'a reason'], /no-such: no artifact/],
    [['Bad_Slug', '--reason', 'a reason'], /usage: artifact restore <slug> --reason/],
    [['a-one'], /--reason/],
    [['a-one', '--reason', '  '], /--reason/],
    [['a-one', '--reason', 'x'.repeat(501)], /--reason is at most 500 bytes; this one is 501/],
  ];
  for (const [args, re] of cases) {
    const said = F.fails(['artifact', 'restore', ...args], SUP);
    assert.match(said, re, `${args.join(' ')}: ${said}`);
  }
  assert.equal(logBytes(F), before, 'no refusal wrote a line');
  // a long reason (485 bytes) is taken, and control characters and runs of space collapse to one space
  F.sup(['artifact', 'restore', 'a-one', '--reason', `two\u0007words\n\n  here ${'y'.repeat(470)}`]);
  assert.equal(acts(F, 'artifact-restore').pop().what, `restore: two words here ${'y'.repeat(470)}`);
});

test('C4: a worker or a planner may not restore', (t) => {
  const { F } = foldFixture(t, 'archive-restore-sessions');
  handAct(F, 'supervisor', { class: 'artifact-archive', what: 'archive', refs: [F.goal, 'artifact:a-one'], approved_by: Q }, 60000);
  const before = logBytes(F);
  for (const role of [{ DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'arch-01-x' }, { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'arch' }]) {
    const said = F.fails(['artifact', 'restore', 'a-one', '--reason', 'a reason'], role);
    assert.match(said, /the supervisor does this/, said);
  }
  assert.equal(logBytes(F), before, 'nothing written');
  assert.ok(bySlug(rows(F))['a-one'].archived, 'a-one stays archived');
});

test('C5a: an owner line of artifact-archive or artifact-restore is refused by the log\'s integrity check', (t) => {
  const { F } = foldFixture(t, 'archive-integrity');
  for (const [cls, what] of [['artifact-archive', 'archive'], ['artifact-restore', 'restore']]) {
    const d = new Date(Date.now() - 30000);
    const r = F.checkWith(['owner', { type: 'act', id: `a-${stamp(d)}-owner`, class: cls, what, refs: [F.goal, 'artifact:a-one'] }]);
    assert.notEqual(r.status, 0, `log-check refuses the owner's ${cls}: ${r.said}`);
    assert.match(r.said, /the owner's acts are artifact-publish, pane-answer, goal-order, owner-setting only/, r.said);
  }
});

test('C5b: read, not only checked: an owner\'s or a ticket\'s line of either class archives or restores nothing', (t) => {
  const { F } = foldFixture(t, 'archive-integrity-read');
  handAct(F, 'owner', { class: 'artifact-archive', what: 'archive', refs: [F.goal, 'artifact:a-one'], channel: 'cli' }, 50000, `owner-${new Date().toISOString().slice(0, 7)}.jsonl`);
  handAct(F, 'arch-01-x', { class: 'artifact-archive', what: 'archive', refs: [F.goal, 'artifact:a-two'] }, 40000, 'arch-01-x.jsonl');
  const m = bySlug(rows(F));
  assert.equal('archived' in m['a-one'], false, 'the owner\'s line archives nothing');
  assert.equal('archived' in m['a-two'], false, 'a ticket\'s line archives nothing');
  // a supervisor's archive then an owner's restore: the owner's line restores nothing
  handAct(F, 'supervisor', { class: 'artifact-archive', what: 'archive', refs: [F.goal, 'artifact:a-three'], approved_by: Q }, 30000);
  handAct(F, 'owner', { class: 'artifact-restore', what: 'restore', refs: ['artifact:a-three'], channel: 'cli' }, 20000, `owner-${new Date().toISOString().slice(0, 7)}.jsonl`);
  assert.ok(bySlug(rows(F))['a-three'].archived, 'the owner\'s restore line restores nothing');
});

test('C6: no schema field is added; the restore line carries only fields the act schema has; constitution.md lists artifact-restore as constitutional; it has plain words', (t) => {
  const { F } = foldFixture(t, 'archive-schema');
  const schema = JSON.parse(fs.readFileSync(path.join(kit, 'schema/log.schema.json'), 'utf8'));
  const props = Object.keys(schema.$defs.types.act.properties);
  assert.deepEqual(props, ['person', 'class', 'scope', 'what', 'rung', 'refs', 'reversible', 'approved_by', 'decision', 'knowledge', 'corrected', 'repaired', 'id_block', 'entry_hash', 'prior_hash', 'repo', 'artifact', 'proof', 'key', 'value', 'for', 'tree'], 'the act schema\'s fields are as before');
  handAct(F, 'supervisor', { class: 'artifact-archive', what: 'archive', refs: [F.goal, 'artifact:a-one'], approved_by: Q }, 60000);
  F.sup(['artifact', 'restore', 'a-one', '--reason', 'a reason']);
  const a = acts(F, 'artifact-restore').pop();
  const ENVELOPE = ['v', 'id', 'type', 'op', 'at', 'by', 'channel'];
  for (const k of Object.keys(a)) assert.ok(ENVELOPE.includes(k) || props.includes(k), `the restore line's ${k} is an act field`);
  const lc = F.run(F.old, ['log-check']);
  assert.equal(lc.status, 0, `log-check passes with the restore line: ${lc.out}\n${lc.err}`);
  const block = JSON.parse(fs.readFileSync(path.join(kit, 'governance/constitution.md'), 'utf8').match(/```json devteam\s*\n([\s\S]*?)\n```/)[1]);
  assert.ok(block.constitutional.includes('artifact-restore'), 'artifact-restore is constitutional');
  const words = JSON.parse(F.sup(['dashboard-data'])).class_words;
  assert.equal(typeof words['artifact-restore'], 'string', 'artifact-restore has plain words');
});

// The archivable rule. Goals: G (met), H (met), R (running). Features: fg serves G, fgh serves G and
// H, fgr serves G and R. Tickets: tg of fg, tr of fgr.
function ruleFixture(t, name) {
  const F = threadsFixture(name);
  cleanup(t)(() => F.done());
  const G = F.goal;
  const goalArgs = (title, p) => ['goal', 'add', '--title', title, '--outcome', 'admins pay alone', '--measure', 'self-serve share', '--target', '80', '--unit', '%', '--direction', 'up', '--source', 'prod', '--check', 'echo 5', '--horizon', '2027-03-31', '--non-goals', 'enterprise invoicing', '--preconditions', 'cards work', '--priority', String(p)];
  const H = F.sup(goalArgs('Second goal', 2)).split('\n')[0].trim();
  const R = F.sup(goalArgs('Running goal', 3)).split('\n')[0].trim();
  F.owner(['goal', 'status', G, 'met', '--force']);
  F.owner(['goal', 'status', H, 'met', '--force']);
  const feat = (id, goals) => F.sup(['feature', 'add', id, '--json', JSON.stringify({ title: id, goals, stories: [{ id: `${id.toUpperCase().replace(/-/g, '')}-S1`, text: 'it works', release: 'v1.0.0' }] })]);
  feat('feat-g', [G]);
  feat('feat-gh', [G, H]);
  feat('feat-gr', [G, R]);
  const tk = (id, feature) => F.sup(['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature, component: 'arch', kind: 'build', size: 'S', risk: 'normal', serves: [`${feature.toUpperCase().replace(/-/g, '')}-S1`], depends_on: [], touches: ['src/**'], done_when: ['the src test passes in CI'] })]);
  tk('tg-01-a', 'feat-g');
  tk('tr-01-a', 'feat-gr');
  const cases = {
    'y-goal': [`goal:${G}`],
    'y-feature': ['feature:feat-g'],
    'y-ticket': ['ticket:tg-01-a'],
    'y-two-met': [`goal:${G}`, `goal:${H}`],
    'y-feature-both-met': ['feature:feat-gh'],
    'n-other-goal': [`goal:${H}`],
    'n-running': [`goal:${G}`, `goal:${R}`],
    'n-feature-running': ['feature:feat-gr'],
    'n-ticket-running': ['ticket:tr-01-a'],
    'n-all': [`goal:${G}`, 'all'],
    'n-project': [`goal:${G}`, 'project'],
    'n-component': [`goal:${G}`, 'component:arch'],
    'n-link': [`goal:${G}`, 'link:devteam-kit'],
    'n-unknown-feature': [`goal:${G}`, 'feature:nope'],
    'n-unknown-goal': [`goal:${G}`, 'goal:g-20200101-000000000-supervisor'],
    'n-no-for': [],
  };
  for (const [s, f] of Object.entries(cases)) drawn(F.old, s, f);
  landAt(F, '2026-01-01T00:00:00Z', 'early artifacts');
  drawn(F.old, 'y-late', [`goal:${G}`]);
  landAt(F, '2026-03-01T00:00:00Z', 'a later artifact');
  const wt = path.join(F.old, '.worktrees', 'rule-draft');
  F.g(['worktree', 'add', '-q', '--detach', wt], F.old);
  drawn(wt, 'n-draft-only', [`goal:${G}`]);
  return { F, G, H, R };
}
const archivable = (F, g, extra = []) => JSON.parse(F.sup(['artifact', 'archivable', g, '--json', ...extra])).map((a) => a.slug);

test('C7: archivableArtifacts(g) is exactly the landed artifacts whose every for-scope resolves to met goals, at least one being g', (t) => {
  const { F, G, H, R } = ruleFixture(t, 'archive-rule');
  assert.deepEqual(archivable(F, G), ['y-feature', 'y-feature-both-met', 'y-goal', 'y-late', 'y-ticket', 'y-two-met']);
  assert.deepEqual(archivable(F, H), ['n-other-goal', 'y-feature-both-met', 'y-two-met'], 'for H: its own, and those for G and H');
  assert.deepEqual(archivable(F, R), [], 'a running goal has nothing archivable');
  // the rows are the landed entries, as artifacts --json lists them
  const one = JSON.parse(F.sup(['artifact', 'archivable', G, '--json']))[0];
  assert.equal(one.at, 'main');
  assert.equal(one.title, 'Title y-feature');
  const text = F.sup(['artifact', 'archivable', G]);
  assert.match(text, /^y-feature /m, text);
});

test('C8: archivableArtifacts(g, at) leaves out what landed after at', (t) => {
  const { F, G } = ruleFixture(t, 'archive-rule-at');
  assert.deepEqual(archivable(F, G, ['--at', '2026-02-01T00:00:00Z']), ['y-feature', 'y-feature-both-met', 'y-goal', 'y-ticket', 'y-two-met']);
  assert.deepEqual(archivable(F, G, ['--at', '2025-12-01T00:00:00Z']), [], 'nothing had landed then');
  assert.ok(archivable(F, G, ['--at', '2026-03-02T00:00:00Z']).includes('y-late'), 'after it landed, it is in');
});

test('C9: artifact archivable refuses an unknown goal and a bad --at', (t) => {
  const { F, G } = ruleFixture(t, 'archive-rule-refusals');
  assert.match(F.fails(['artifact', 'archivable', 'g-20200101-000000000-supervisor'], SUP), /no goal g-20200101-000000000-supervisor/);
  assert.match(F.fails(['artifact', 'archivable'], SUP), /usage: artifact archivable <goal-id>/);
  assert.match(F.fails(['artifact', 'archivable', G, '--at', 'yesterday'], SUP), /--at is a time/);
});

test('C12: help lists artifact archivable and artifact restore', (t) => {
  const { F } = foldFixture(t, 'archive-help');
  const help = F.sup(['help']);
  for (const s of ['artifact archivable <goal-id> [--at <time>] [--json]', 'artifact restore <slug> --reason "<why>"']) assert.ok(help.includes(s), `help lists ${s}`);
});
