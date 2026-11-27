// Archive on goal-met (kit-935, DCL-S15; decision d-20261126-041538308): when a goal turns met, by
// the owner's Yes to its goal-met question or by 'goal status <id> met', the kit itself writes, as
// the supervisor, one kit-934 artifact line {archived: true, goal, reason} for each item
// archivableArtifacts(goal, now) names. No question is asked and no class is added. An item the
// owner has set is left as the owner set it; one the log shows archived by a met turn (a line with
// archived true and a goal, any goal) is never archived again, so a rerun or a later met turn of
// any goal it is drawn for never archives a restored item again; an item archived by hand (goal
// null) gets the goal's line. Nothing under project/artifacts/ changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { threadsFixture, write } from './lib/kit.mjs';
import { cleanup } from './lib/chrome.mjs';

const ARTIFACTS_REL = 'docs/devteam/project/artifacts';
const page = '<!doctype html><html><body><p>a page</p></body></html>';
const drawn = (root, slug, forList) => {
  write(path.join(root, ARTIFACTS_REL, slug, 'artifact.json'), JSON.stringify({ v: 1, title: `Title ${slug}`, summary: 'A page to point at', by: 'supervisor', for: forList }));
  write(path.join(root, ARTIFACTS_REL, slug, 'index.html'), page);
};
// commit what is drawn on main and push it, as a merge lands it
const land = (F) => {
  execFileSync('git', ['add', '-A', ARTIFACTS_REL], { cwd: F.old });
  execFileSync('git', ['commit', '-qm', 'artifacts'], { cwd: F.old });
  execFileSync('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: F.old });
};
const logLines = (F) => fs.readdirSync(F.logDir).flatMap((f) => fs.readFileSync(path.join(F.logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const artLines = (F) => logLines(F).filter((o) => o.type === 'artifact');
const questionLines = (F) => logLines(F).filter((o) => o.type === 'question');
const archivable = (F, g) => JSON.parse(F.sup(['artifact', 'archivable', g, '--json'])).map((a) => a.slug);
const archivedNow = (F) => JSON.parse(F.sup(['artifacts', '--json'])).filter((a) => a.at === 'main' && a.archived).map((a) => a.slug).sort();
const treeOf = (root) => execFileSync('git', ['-C', root, 'ls-files', '-s', '-o', '--exclude-standard', ARTIFACTS_REL], { encoding: 'utf8' });
// a second goal the owner attests (source owner), approved, so a goal-met question can be asked and answered
const ownerGoal = (F, title) => {
  const g = F.sup(['goal', 'add', '--title', title, '--outcome', 'the case study is live', '--measure', 'attested', '--target', '1', '--unit', 'attested', '--direction', 'up', '--source', 'owner', '--question', 'Is the case study live?', '--non-goals', 'none', '--preconditions', 'a', 'b']);
  F.owner(['goal', 'decide', g, 'approve', '--force']);
  return g;
};

// Two goals: G (the fixture's, prod) and H (another, never met). Landed: two items for G, one for G
// and the whole project (never archivable), one for H, one for G's goal and H's (archivable only
// once both are met). One draft for G (never archivable).
function fixture(t, name) {
  const F = threadsFixture(name);
  cleanup(t)(() => F.done());
  const H = F.sup(['goal', 'add', '--title', 'Another goal', '--outcome', 'x', '--measure', 'm', '--target', '1', '--source', 'owner', '--question', 'Done?']);
  drawn(F.old, 'g-one', [`goal:${F.goal}`]);
  drawn(F.old, 'g-two', [`goal:${F.goal}`]);
  drawn(F.old, 'g-mixed', [`goal:${F.goal}`, 'all']);
  drawn(F.old, 'h-one', [`goal:${H}`]);
  drawn(F.old, 'gh-both', [`goal:${F.goal}`, `goal:${H}`]);
  land(F);
  const wt = path.join(F.old, '.worktrees', 'arch-draft');
  F.g(['worktree', 'add', '-q', '--detach', wt], F.old);
  drawn(wt, 'g-draft', [`goal:${F.goal}`]);
  return { F, H, wt };
}

test('A1: goal status <id> met archives, as the supervisor, exactly archivableArtifacts(goal, now), each line citing the status change', (t) => {
  const { F, wt } = fixture(t, 'aq-status');
  const before = { main: treeOf(F.old), wt: treeOf(wt) };
  assert.deepEqual(artLines(F), [], 'nothing archived before the goal is met');
  const out = F.owner(['goal', 'status', F.goal, 'met', '--force']);
  const want = archivable(F, F.goal);
  assert.deepEqual(want, ['g-one', 'g-two'], 'the rule names the two items for G alone');
  const l = artLines(F);
  assert.deepEqual(l.map((x) => x.id).sort(), want.map((s) => `artifact:${s}`), 'one artifact line per archivable item, no more');
  const met = logLines(F).filter((x) => x.type === 'goal' && x.id === F.goal && x.status === 'met').pop();
  for (const x of l) {
    assert.deepEqual({ op: x.op, by: x.by, archived: x.archived, goal: x.goal }, { op: 'new', by: 'supervisor', archived: true, goal: F.goal }, x.id);
    assert.match(x.reason, new RegExp(`${F.goal} is met \\(goal status met, ${met.at}\\)`), `${x.id} cites the status change`);
  }
  assert.match(out, /archived 2 Library items drawn for it: g-one, g-two \(artifact restore <slug> brings one back\)/);
  assert.deepEqual(archivedNow(F), ['g-one', 'g-two']);
  assert.deepEqual({ main: treeOf(F.old), wt: treeOf(wt) }, before, 'no artifact file changes');
  F.sup(['log-check']);
});

test('A2: the owner\'s Yes to a goal-met question archives the goal\'s items, citing the question; a No archives nothing', (t) => {
  const { F } = fixture(t, 'aq-answer');
  const O = ownerGoal(F, 'Case study');
  drawn(F.old, 'o-one', [`goal:${O}`]);
  land(F);
  const No = F.sup(['ask', '--class', 'goal-met', '--goal', O, '--recommendation', 'yes']);
  F.owner(['answer', No, 'No']);
  assert.deepEqual(artLines(F), [], 'a No archives nothing');
  const Yes = F.sup(['ask', '--class', 'goal-met', '--goal', O, '--recommendation', 'yes']);
  const out = F.owner(['answer', Yes, 'Yes']);
  assert.match(out, new RegExp(`${O} is met; archived 1 Library item drawn for it: o-one`));
  const l = artLines(F);
  assert.equal(l.length, 1);
  assert.deepEqual({ id: l[0].id, op: l[0].op, by: l[0].by, archived: l[0].archived, goal: l[0].goal }, { id: 'artifact:o-one', op: 'new', by: 'supervisor', archived: true, goal: O });
  assert.match(l[0].reason, new RegExp(`${O} is met \\(the owner's Yes to ${Yes}\\)`));
  assert.deepEqual(archivedNow(F), ['o-one']);
  F.sup(['log-check']);
});

test('A3: an item the owner set is left as the owner set it; one the supervisor archived by hand before gets the goal\'s line', (t) => {
  const { F, H } = fixture(t, 'aq-owner');
  drawn(F.old, 'g-three', [`goal:${F.goal}`]);
  drawn(F.old, 'g-four', [`goal:${F.goal}`]);
  land(F);
  F.owner(['artifact', 'archive', 'g-one', '--owner']);
  F.owner(['artifact', 'archive', 'g-two', '--owner']);
  F.owner(['artifact', 'restore', 'g-two', '--owner']);
  F.sup(['artifact', 'archive', 'g-three']);
  const was = artLines(F).length;
  F.owner(['goal', 'status', F.goal, 'met', '--force']);
  const l = artLines(F);
  assert.deepEqual(l.slice(was).map((x) => [x.id, x.op, x.goal]).sort(), [['artifact:g-four', 'new', F.goal], ['artifact:g-three', 'set', F.goal]], 'the owner\'s two are left alone; the supervisor\'s hand archive gets the goal\'s line');
  assert.deepEqual(archivedNow(F), ['g-four', 'g-one', 'g-three'], 'g-two stays restored, as the owner set it');
  assert.equal(JSON.parse(F.sup(['artifacts', '--json'])).find((a) => a.slug === 'g-one' && a.at === 'main').archived.goal, null, 'g-one keeps the owner\'s line');
  // H met too: gh-both now resolves to met goals only, and is archived for H; h-one with it
  F.owner(['goal', 'status', H, 'met', '--force']);
  assert.deepEqual(artLines(F).slice(was + 2).map((x) => [x.id, x.goal]).sort(), [['artifact:gh-both', H], ['artifact:h-one', H]]);
  F.sup(['log-check']);
});

test('A4: an item restored after the goal met is not archived again, by a rerun or by a later met turn; one restored before it was met is', (t) => {
  const { F } = fixture(t, 'aq-restore');
  drawn(F.old, 'g-early', [`goal:${F.goal}`]);
  land(F);
  F.sup(['artifact', 'archive', 'g-early']);
  F.sup(['artifact', 'restore', 'g-early']);
  F.owner(['goal', 'status', F.goal, 'met', '--force']);
  assert.deepEqual(archivedNow(F), ['g-early', 'g-one', 'g-two'], 'restored before the goal met: archived with the rest');
  F.sup(['artifact', 'restore', 'g-one']);
  const was = artLines(F).length;
  F.owner(['goal', 'status', F.goal, 'met', '--force']);
  assert.equal(artLines(F).length, was, 'a rerun writes nothing');
  F.owner(['goal', 'status', F.goal, 'draft']);
  F.owner(['goal', 'status', F.goal, 'met', '--force']);
  assert.equal(artLines(F).length, was, 'a later met turn writes nothing');
  assert.deepEqual(archivedNow(F), ['g-early', 'g-two'], 'g-one stays restored');
  F.sup(['log-check']);
});

test('A4b: an item drawn for two goals, archived by one\'s met turn and restored, is not archived again by the other\'s rerun, in either order', (t) => {
  const { F, H } = fixture(t, 'aq-cross');
  const K = F.sup(['goal', 'add', '--title', 'Third goal', '--outcome', 'x', '--measure', 'm', '--target', '1', '--source', 'owner', '--question', 'Done?']);
  drawn(F.old, 'gk-both', [`goal:${F.goal}`, `goal:${K}`]);
  land(F);
  // G met (gh-both waits on H), then H met: gh-both archived with goal H; restored; G again
  F.owner(['goal', 'status', F.goal, 'met', '--force']);
  F.owner(['goal', 'status', H, 'met', '--force']);
  assert.equal(artLines(F).filter((x) => x.id === 'artifact:gh-both').at(-1).goal, H);
  F.sup(['artifact', 'restore', 'gh-both']);
  let was = artLines(F).length;
  F.owner(['goal', 'status', F.goal, 'met', '--force']);
  assert.equal(artLines(F).length, was, "G's rerun writes nothing for gh-both, restored after H's archive");
  // K met after G: gk-both archived with goal K; restored; G again, then K again
  F.owner(['goal', 'status', K, 'met', '--force']);
  assert.equal(artLines(F).filter((x) => x.id === 'artifact:gk-both').at(-1).goal, K);
  F.sup(['artifact', 'restore', 'gk-both']);
  was = artLines(F).length;
  F.owner(['goal', 'status', F.goal, 'met', '--force']);
  F.owner(['goal', 'status', K, 'met', '--force']);
  assert.equal(artLines(F).length, was, 'neither rerun archives gk-both again');
  assert.equal(archivedNow(F).includes('gh-both') || archivedNow(F).includes('gk-both'), false);
  F.sup(['log-check']);
});

test('A5: a goal with nothing archivable writes nothing', (t) => {
  const { F, H } = fixture(t, 'aq-none');
  F.owner(['artifact', 'archive', 'h-one', '--owner']);
  const was = artLines(F).length;
  F.owner(['goal', 'status', H, 'met', '--force']);
  // h-one is the owner's and gh-both waits on G: nothing to write
  assert.equal(artLines(F).length, was);
  const K = F.sup(['goal', 'add', '--title', 'Bare goal', '--outcome', 'x', '--measure', 'm', '--target', '1', '--source', 'owner', '--question', 'Done?']);
  const out = F.owner(['goal', 'status', K, 'met', '--force']);
  assert.equal(artLines(F).length, was);
  assert.doesNotMatch(out, /archived/);
});

test('A6: no question is written and no class is added (d-20261126-041538308)', (t) => {
  const { F } = fixture(t, 'aq-noclass');
  const O = ownerGoal(F, 'Case study');
  drawn(F.old, 'o-one', [`goal:${O}`]);
  land(F);
  const asked = () => questionLines(F).filter((x) => (x.op ?? 'new') === 'new').length;
  const q0 = questionLines(F).length;
  F.owner(['goal', 'status', F.goal, 'met', '--force']);
  assert.equal(questionLines(F).length, q0, 'goal status met writes no question');
  const Yes = F.sup(['ask', '--class', 'goal-met', '--goal', O, '--recommendation', 'yes']);
  const q1 = asked();
  F.owner(['answer', Yes, 'Yes']);
  assert.equal(asked(), q1, 'the Yes writes no new question');
  assert.deepEqual(archivedNow(F), ['g-one', 'g-two', 'o-one'], 'both turns archived');
  // no class about archiving or the Library, by any name: in the plain words, or in the ladder
  // (constitution.md's json devteam block, which ladder() reads). That nothing else in either
  // changed is A7: git diff against main at the ticket's head, and check-ticket's touches.
  const about = /archiv|library|restor/i;
  const words = JSON.parse(F.sup(['dashboard-data'])).class_words;
  assert.deepEqual(Object.entries(words).filter(([k, v]) => about.test(k) || about.test(v)), [], 'no class word about archiving');
  const block = /```json devteam\s*\n([\s\S]*?)\n```/.exec(fs.readFileSync(path.join(F.old, 'docs/devteam/governance/constitution.md'), 'utf8'));
  assert.ok(block, 'the ladder block is there');
  assert.deepEqual(Object.keys(JSON.parse(block[1]).classes ?? {}).filter((k) => about.test(k)), [], 'no ladder class about archiving');
});
