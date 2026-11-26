// Archived artifacts (kit-934, DCL-S15): archived is a plain attribute of a landed artifact, kept in
// the log as an object of type artifact (id artifact:<slug>) that the supervisor or the owner writes
// with 'artifact archive|restore <slug> [--reason] [--owner]'; never in artifact.json, never an act.
// allArtifacts() (so 'artifacts' and /api/data's library.artifacts) carries archived: {at, by, goal}
// on a landed entry that is archived. archivableArtifacts(g, at) ('artifact archivable <g> [--at]')
// is the one rule of which artifacts a met goal's items are (kit-935, kit-936).
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
const rows = (F) => JSON.parse(F.sup(['artifacts', '--json']));
const bySlug = (list) => Object.fromEntries(list.filter((a) => a.at === 'main').map((a) => [a.slug, a]));
const libRows = (F) => JSON.parse(F.sup(['dashboard-data'])).library.artifacts;
const logBytes = (F) => fs.readdirSync(F.logDir).sort().map((f) => `${f}:${fs.readFileSync(path.join(F.logDir, f), 'utf8')}`).join('\n');
const treeOf = (root) => execFileSync('git', ['-C', root, 'ls-files', '-s', '-o', '--exclude-standard', ARTIFACTS_REL], { encoding: 'utf8' })
  + fs.readdirSync(path.join(root, ARTIFACTS_REL), { recursive: true }).sort().map((f) => { const p = path.join(root, ARTIFACTS_REL, f); return fs.statSync(p).isFile() ? `${f}:${fs.readFileSync(p, 'utf8')}` : f; }).join('\n');
const logLines = (F) => fs.readdirSync(F.logDir).flatMap((f) => fs.readFileSync(path.join(F.logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const artLines = (F) => logLines(F).filter((o) => o.type === 'artifact');
const OWN = ['--owner'];

// One fixture for the attribute: three landed artifacts for the goal and a worktree with two drafts.
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

test('C1: artifact archive (the supervisor) writes one artifact line; allArtifacts, artifacts and /api/data carry archived {at, by, goal} on that landed entry only', (t) => {
  const { F } = foldFixture(t, 'archive-attr');
  const out = F.sup(['artifact', 'archive', 'a-one', '--reason', 'its goal is met']);
  assert.match(out, /archived a-one/);
  const l = artLines(F);
  assert.equal(l.length, 1, 'one artifact line');
  assert.deepEqual({ id: l[0].id, op: l[0].op, by: l[0].by, archived: l[0].archived, goal: l[0].goal, reason: l[0].reason }, { id: 'artifact:a-one', op: 'new', by: 'supervisor', archived: true, goal: null, reason: 'its goal is met' });
  assert.equal(logLines(F).filter((o) => o.type === 'act' && /artifact-(archive|restore)/.test(o.class ?? '')).length, 0, 'no act is written');
  const want = { at: l[0].at, by: 'supervisor', goal: null };
  const cli = rows(F);
  assert.deepEqual(bySlug(cli)['a-one'].archived, want);
  for (const s of ['a-two', 'a-three']) assert.equal('archived' in bySlug(cli)[s], false, `${s} has no archived key`);
  for (const d of cli.filter((a) => a.at !== 'main')) assert.equal('archived' in d, false, `the draft ${d.slug} in ${d.at} has no archived key`);
  const lib = libRows(F);
  assert.deepEqual(bySlug(lib)['a-one'].archived, want, '/api/data library.artifacts carries it');
  assert.equal('archived' in bySlug(lib)['a-two'], false);
  for (const d of lib.filter((a) => a.at !== 'main')) assert.equal('archived' in d, false, `/api/data: the draft ${d.slug} has no archived key`);
  const text = F.sup(['artifacts']).split('\n');
  assert.ok(text.some((x) => x.startsWith('a-one [landed] [archived] ')), text.join('\n'));
  assert.equal(text.filter((x) => x.includes('[archived]')).length, 1, text.join('\n'));
  // a line with a goal (as kit-935 writes it): goal shows
  F.hand('supervisor', { type: 'artifact', id: 'artifact:a-two', archived: true, goal: F.goal }, 1000);
  assert.equal(bySlug(rows(F))['a-two'].archived.goal, F.goal);
});

test('C2: artifact restore sets archived false with a set line, and the entry loses archived; archive again; the owner\'s --owner lines too; no artifact file changes', (t) => {
  const { F, wt } = foldFixture(t, 'archive-attr-restore');
  const before = { main: treeOf(F.old), wt: treeOf(wt) };
  F.sup(['artifact', 'archive', 'a-one']);
  assert.match(F.sup(['artifact', 'restore', 'a-one', '--reason', 'still in use']), /restored a-one/);
  let l = artLines(F);
  assert.deepEqual(l.map((x) => [x.op, x.archived]), [['new', true], ['set', false]], 'new, then set');
  assert.equal(l[1].reason, 'still in use');
  assert.equal('archived' in bySlug(rows(F))['a-one'], false, 'a-one is back');
  F.sup(['artifact', 'archive', 'a-one']);
  assert.deepEqual(bySlug(rows(F))['a-one'].archived, { at: artLines(F).pop().at, by: 'supervisor', goal: null }, 'archived again: newest set wins, with its time');
  // the owner, outside any session, with --owner
  F.owner(['artifact', 'archive', 'a-two', ...OWN]);
  l = artLines(F).filter((x) => x.id === 'artifact:a-two');
  assert.deepEqual(l.map((x) => [x.op, x.by, x.archived]), [['new', 'owner', true]]);
  assert.equal(l[0].channel, 'cli', 'an owner line carries its channel');
  assert.equal(bySlug(rows(F))['a-two'].archived.by, 'owner');
  F.owner(['artifact', 'restore', 'a-two', ...OWN]);
  assert.equal('archived' in bySlug(rows(F))['a-two'], false, 'the owner restores it');
  const lc = F.run(F.old, ['log-check']);
  assert.equal(lc.status, 0, `log-check passes with these lines: ${lc.out}\n${lc.err}`);
  assert.match(F.sup(['history']), /^\S+ +artifact +owner\b/m, 'history lists the lines');
  assert.equal(treeOf(F.old), before.main, 'nothing under project/artifacts/ on main\'s checkout changed');
  assert.equal(treeOf(wt), before.wt, 'nor in the draft\'s worktree');
});

test('C3: archive and restore refuse a no-op, a draft, an unknown or malformed slug and a long reason, writing nothing', (t) => {
  const { F } = foldFixture(t, 'archive-attr-refusals');
  F.sup(['artifact', 'archive', 'a-one']);
  const before = logBytes(F);
  const cases = [
    [['archive', 'a-one'], /a-one is already archived/],
    [['restore', 'a-three'], /a-three is not archived/],
    [['archive', 'd-new'], /d-new is a draft/],
    [['restore', 'd-new'], /d-new is a draft/],
    [['archive', 'no-such'], /no-such: no artifact/],
    [['archive', 'Bad_Slug'], /usage: artifact archive <slug>/],
    [['restore'], /usage: artifact restore <slug>/],
    [['archive', 'a-two', '--reason', 'x'.repeat(501)], /--reason is at most 500 bytes; this one is 501/],
  ];
  for (const [args, re] of cases) {
    const said = F.fails(['artifact', ...args], SUP);
    assert.match(said, re, `${args.join(' ')}: ${said}`);
  }
  assert.equal(logBytes(F), before, 'no refusal wrote a line');
  // control characters and runs of space collapse to one space; a blank reason is none
  F.sup(['artifact', 'restore', 'a-one', '--reason', `two\u0007words\n\n  here ${'y'.repeat(470)}`]);
  assert.equal(artLines(F).pop().reason, `two words here ${'y'.repeat(470)}`);
  F.sup(['artifact', 'archive', 'a-one', '--reason', '   ']);
  assert.equal(artLines(F).pop().reason, null);
});

test('C4: a worker, a planner and the responder may not archive or restore, with or without --owner; the supervisor\'s session may not use --owner', (t) => {
  const { F } = foldFixture(t, 'archive-attr-sessions');
  F.sup(['artifact', 'archive', 'a-one']);
  const before = logBytes(F);
  for (const role of [{ DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'arch-01-x' }, { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'arch' }, { DEVTEAM_ROLE: 'responder' }, SUP]) {
    for (const [sub, slug] of [['restore', 'a-one'], ['archive', 'a-two']]) {
      if (role !== SUP) assert.match(F.fails(['artifact', sub, slug], role), /the supervisor does this/, `${role.DEVTEAM_ROLE} ${sub}`);
      assert.match(F.fails(['artifact', sub, slug, ...OWN], role), /owner commands don't run in an agent session/, `${role.DEVTEAM_ROLE} ${sub} --owner`);
    }
  }
  assert.equal(logBytes(F), before, 'nothing written');
  assert.ok(bySlug(rows(F))['a-one'].archived, 'a-one stays archived');
});

test('C5: once the owner has set archived, the supervisor\'s command is refused, and a supervisor\'s hand-written set under it changes nothing', (t) => {
  const { F } = foldFixture(t, 'archive-attr-rank');
  F.sup(['artifact', 'archive', 'a-one']);
  F.owner(['artifact', 'restore', 'a-one', ...OWN]);
  const before = logBytes(F);
  assert.match(F.fails(['artifact', 'archive', 'a-one'], SUP), /a-one: the owner restored it .*so only the owner changes it now/);
  assert.equal(logBytes(F), before, 'the refusal wrote nothing');
  F.hand('supervisor', { type: 'artifact', op: 'set', id: 'artifact:a-one', archived: true, goal: F.goal }, 0);
  assert.equal('archived' in bySlug(rows(F))['a-one'], false, 'the owner\'s word stands');
  // the owner may still change it
  F.owner(['artifact', 'archive', 'a-one', ...OWN]);
  assert.equal(bySlug(rows(F))['a-one'].archived.by, 'owner');
  // the owner creates the object (no line of the supervisor's before it): the supervisor is refused too
  F.owner(['artifact', 'archive', 'a-two', ...OWN]);
  const mid = logBytes(F);
  assert.match(F.fails(['artifact', 'restore', 'a-two'], SUP), /a-two: the owner archived it .*so only the owner changes it now/);
  assert.equal(logBytes(F), mid, 'the refusal wrote nothing');
  assert.ok(bySlug(rows(F))['a-two'].archived, 'a-two stays archived');
});

test('C6: the log schema: the artifact type, its keyed id, and who may write it; a ticket\'s or a planner\'s artifact line is refused, and a ticket\'s is read as nothing', (t) => {
  const { F } = foldFixture(t, 'archive-attr-schema');
  const schema = JSON.parse(fs.readFileSync(path.join(kit, 'schema/log.schema.json'), 'utf8'));
  assert.deepEqual(Object.keys(schema.$defs.types.artifact.properties), ['archived', 'goal', 'reason']);
  assert.deepEqual(schema.$defs.types.artifact['x-required-new'], ['archived']);
  assert.equal(schema['x-id'].keyed.artifact, '^artifact:[a-z][a-z0-9]*(-[a-z0-9]+)*$');
  const a = schema['x-authority'];
  for (const w of ['owner', 'supervisor']) {
    assert.ok(a.new[w].includes('artifact'), `${w} may create`);
    assert.deepEqual(a.set.artifact[w], ['archived', 'goal', 'reason'], `${w} may set`);
  }
  for (const w of ['planner', 'ticket', 'responder']) {
    assert.ok(!a.new[w].includes('artifact'), `${w} may not create`);
    assert.equal(a.set.artifact[w], undefined, `${w} may not set`);
  }
  const lines = [
    ['arch-01-x', { type: 'artifact', id: 'artifact:a-one', archived: true }, 'arch-01-x.jsonl', /ticket may not create artifact lines/],
    ['plan-arch', { type: 'artifact', id: 'artifact:a-one', archived: true }, `plan-arch-${new Date().toISOString().slice(0, 7)}.jsonl`, /planner may not create artifact lines/],
    ['supervisor', { type: 'artifact', id: 'a-one', archived: true }, null, /artifact id must match/],
    ['supervisor', { type: 'artifact', id: 'artifact:a-one' }, null, /artifact\.archived is required/],
    ['supervisor', { type: 'artifact', id: 'artifact:a-one', archived: 'yes' }, null, /artifact\.archived must be boolean/],
  ];
  for (const [by, o, file, re] of lines) {
    const r = F.checkWith([by, o, file]);
    assert.notEqual(r.status, 0, `log-check refuses ${JSON.stringify(o)} by ${by}`);
    assert.match(r.said, re, r.said);
  }
  // read, not only checked: a ticket's line archives nothing
  F.hand('arch-01-x', { type: 'artifact', id: 'artifact:a-two', archived: true }, 1000, 'arch-01-x.jsonl');
  assert.equal('archived' in bySlug(rows(F))['a-two'], false, 'a ticket\'s line archives nothing');
  // nothing about it is a class: the plain-words list has no artifact-archive or artifact-restore
  const words = JSON.parse(F.sup(['dashboard-data'])).class_words;
  for (const c of ['artifact-archive', 'artifact-restore']) assert.equal(words[c], undefined, `${c} is no class`);
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

test('C12: help lists artifact archivable, archive and restore', (t) => {
  const { F } = foldFixture(t, 'archive-help');
  const help = F.sup(['help']);
  for (const s of ['artifact archivable <goal-id> [--at <time>] [--json]', 'artifact archive|restore <slug> [--reason "<why>"] [--owner]']) assert.ok(help.includes(s), `help lists ${s}`);
});
