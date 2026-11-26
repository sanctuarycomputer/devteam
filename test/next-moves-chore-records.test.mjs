// Chore records (kit-296): chore start --what --for, chore adopt and chore drop write the record the
// chore rows read (designs/every-goal-always-has-a-next-move.md, "Records (kit-296)"), and chore start
// on a branch that already exists keeps its commits unless the tip is merged; a dropped branch is
// refused, and --fresh starts it again from main only there. No command deletes a branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { monoFixture, line, kit } from './lib/kit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SUP = { DEVTEAM_ROLE: 'supervisor' };
const month = () => new Date().toISOString().slice(0, 7);
const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
const logLines = (F) => { const dir = path.join(F.old, 'docs/devteam/run/log'); return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))) : []; };
const ofClass = (F, type, cls) => logLines(F).filter((l) => l.type === type && l.class === cls);
// a line as the kit would have written it, in the supervisor's file
let handed = 0;
const hand = (F, o, agoMs = 1000) => {
  let d = new Date(Date.now() - agoMs - ++handed);
  const idAt = (x) => `${o.type === 'decision' ? 'd' : 'a'}-${stamp(x)}-supervisor`;
  // an id is its time to the millisecond, and a line whose id the log has is ignored: step back past any
  // the kit wrote in that millisecond (kit-855)
  const taken = new Set(logLines(F).map((l) => l.id));
  while (taken.has(idAt(d))) d = new Date(d.getTime() - 1);
  const id = idAt(d);
  const dir = path.join(F.old, 'docs/devteam/run/log');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `supervisor-${month()}.jsonl`), line({ op: 'new', ...o, id, at: d.toISOString(), by: 'supervisor' }));
  return id;
};
const wtOf = (F, slug) => path.join(F.old, '.worktrees', `chore-${slug}`);
const tipOf = (F, ref) => { try { return F.g(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], F.old); } catch { return null; } };
const originTip = (F, slug) => (F.g(['ls-remote', 'origin', `refs/heads/chore-${slug}`], F.old).split(/\s/)[0] || null);
// chore-<slug> with n commits of its own past main and no worktree, as a branch left after its
// worktree was removed; pushed to origin when asked
function branchWith(F, slug, n = 1, { push = false } = {}) {
  const dir = path.join(F.base, `make-${slug}`);
  F.g(['worktree', 'add', '-q', '-b', `chore-${slug}`, dir, 'main'], F.old);
  for (let i = 0; i < n; i++) { fs.writeFileSync(path.join(dir, `${slug}-${i}.md`), `${slug} ${i}\n`); F.g(['add', '-A'], dir); F.g(['commit', '-qm', `${slug} ${i}`], dir); }
  if (push) F.g(['push', '-q', 'origin', `chore-${slug}`], dir);
  F.g(['worktree', 'remove', '--force', dir], F.old);
  return tipOf(F, `chore-${slug}`);
}
// origin's main moves on by one commit, made elsewhere
function moveMain(F, name) {
  const dir = path.join(F.base, `main-${name}`);
  F.g(['worktree', 'add', '-q', '--detach', dir, 'origin/main'], F.old);
  fs.writeFileSync(path.join(dir, `${name}.md`), `${name}\n`);
  F.g(['add', '-A'], dir);
  F.g(['commit', '-qm', name], dir);
  F.g(['push', '-q', 'origin', 'HEAD:main'], dir);
  F.g(['worktree', 'remove', '--force', dir], F.old);
}
// one more commit on an existing ref: the local chore-<slug> (no worktree left), or origin's when
// asked (made elsewhere and pushed, so the local branch doesn't have it)
function commitOn(F, slug, name, { origin = false } = {}) {
  const dir = path.join(F.base, `more-${name}`);
  if (origin) F.g(['worktree', 'add', '-q', '--detach', dir, `origin/chore-${slug}`], F.old);
  else F.g(['worktree', 'add', '-q', dir, `chore-${slug}`], F.old);
  fs.writeFileSync(path.join(dir, `${name}.md`), `${name}\n`);
  F.g(['add', '-A'], dir);
  F.g(['commit', '-qm', name], dir);
  if (origin) F.g(['push', '-q', 'origin', `HEAD:chore-${slug}`], dir);
  const tip = F.g(['rev-parse', 'HEAD'], dir);
  F.g(['worktree', 'remove', '--force', dir], F.old);
  return tip;
}
const refused = (F, args, re) => { const r = F.run(F.old, args, SUP); assert.notEqual(r.status, 0, `${args.join(' ')} should be refused: ${r.out}`); assert.match(r.err, re); return r; };

test('next-moves A16: chore records: start --what --for, adopt, drop, and a start that keeps an open branch', async (t) => {
  const F = monoFixture('chore-records');
  const { old, ok, g } = F;
  try {
    F.lines(F.STD);
    const main = () => tipOf(F, 'origin/main');

    await t.test('chore start --what --for appends a chore-start act with those refs', () => {
      const wt = ok(old, ['chore', 'start', 'a1', '--what', 'Tidy the docs folder', '--for', 'goal:g-1,kit-1'], SUP).trim();
      assert.equal(fs.realpathSync(wt), fs.realpathSync(wtOf(F, 'a1')));
      const [a] = ofClass(F, 'act', 'chore-start');
      assert.ok(a, 'a chore-start act');
      assert.deepEqual([a.by, a.what, a.refs], ['supervisor', 'Tidy the docs folder', ['chore-a1', 'goal:g-1', 'kit-1']]);
    });

    await t.test('a bare chore start still works as every hint and recipe runs it, and appends its act', () => {
      const plain = ok(old, ['chore', 'start', 'a2'], SUP).trim();
      assert.equal(fs.realpathSync(plain), fs.realpathSync(wtOf(F, 'a2')), 'a bare chore start prints its worktree, as every hint and recipe expects');
      const b = ofClass(F, 'act', 'chore-start').find((x) => x.refs?.[0] === 'chore-a2');
      assert.ok(b, 'a bare chore start appends its act too');
      assert.deepEqual(b.refs, ['chore-a2']);
    });

    await t.test('chore adopt writes the same act for an existing branch and touches no worktree', () => {
      const tip = branchWith(F, 'b1');
      const before = g(['worktree', 'list', '--porcelain'], old);
      ok(old, ['chore', 'adopt', 'b1', '--what', 'Old settings work', '--for', 'goal:g-1'], SUP);
      const a = ofClass(F, 'act', 'chore-start').find((x) => x.refs?.[0] === 'chore-b1');
      assert.ok(a, 'chore adopt appends a chore-start act');
      assert.deepEqual([a.what, a.refs], ['Old settings work', ['chore-b1', 'goal:g-1']]);
      assert.equal(g(['worktree', 'list', '--porcelain'], old), before, 'no worktree made or changed');
      assert.equal(fs.existsSync(wtOf(F, 'b1')), false);
      assert.equal(tipOf(F, 'chore-b1'), tip, 'the branch is as it was');
      refused(F, ['chore', 'adopt', 'b-none'], /no branch chore-b-none/);
    });

    await t.test('chore drop appends a chore-drop decision with the tip and leaves the branch on every ref', () => {
      const tip = branchWith(F, 'c1', 1, { push: true });
      ok(old, ['chore', 'drop', 'c1', '--reason', 'the owner no longer wants it'], SUP);
      const [d] = ofClass(F, 'decision', 'chore-drop');
      assert.ok(d, 'a chore-drop decision');
      assert.deepEqual(d.refs, ['chore-c1']);
      assert.ok(d.what.includes(tip), `its what names the tip's full sha: ${d.what}`);
      assert.equal(tipOf(F, 'chore-c1'), tip, 'the local branch stays');
      assert.equal(originTip(F, 'c1'), tip, "origin's branch stays");
      refused(F, ['chore', 'drop', 'c1'], /--reason/);
      refused(F, ['chore', 'drop', 'c-none', '--reason', 'x'], /no branch chore-c-none/);
    });

    await t.test('chore start on a branch with commits of its own checks it out, and chore pr pushes them, not main', () => {
      const tip = branchWith(F, 'd1');
      const wt = ok(old, ['chore', 'start', 'd1'], SUP).trim();
      assert.equal(g(['rev-parse', 'HEAD'], wt), tip, 'the worktree starts at the branch, not main');
      assert.equal(tipOf(F, 'chore-d1'), tip, 'the branch is never reset to main');
      ok(old, ['chore', 'pr', 'd1', '--title', 'keep d1'], SUP);
      assert.equal(originTip(F, 'd1'), tip, 'origin keeps the commit');
    });

    await t.test('chore pr makes the worktree from the branch when it is gone', () => {
      const tip = branchWith(F, 'e1');
      ok(old, ['chore', 'pr', 'e1', '--title', 'e1 again'], SUP);
      assert.equal(g(['rev-parse', 'HEAD'], wtOf(F, 'e1')), tip);
      assert.equal(originTip(F, 'e1'), tip);
    });

    await t.test('chore start on a pushed branch with local commits past it keeps them, and chore pr pushes them', () => {
      const pushed = branchWith(F, 'o1', 1, { push: true });
      const tip = commitOn(F, 'o1', 'o1-local');
      assert.equal(originTip(F, 'o1'), pushed, 'origin is one commit behind');
      const wt = ok(old, ['chore', 'start', 'o1'], SUP).trim();
      assert.equal(g(['rev-parse', 'HEAD'], wt), tip, "the worktree starts at the local tip, not origin's");
      assert.equal(tipOf(F, 'chore-o1'), tip, 'the local branch is never reset to origin');
      ok(old, ['chore', 'pr', 'o1', '--title', 'o1 local'], SUP);
      assert.equal(originTip(F, 'o1'), tip, 'origin gets the local commit');
    });

    await t.test('a branch whose local and origin sides each carry work is refused by chore start and chore pr; chore drop keeps both', () => {
      branchWith(F, 'p1', 1, { push: true });
      const there = commitOn(F, 'p1', 'p1-origin', { origin: true });
      const here = commitOn(F, 'p1', 'p1-local');
      refused(F, ['chore', 'start', 'p1'], /chore-p1 differs here .*and on origin/);
      refused(F, ['chore', 'pr', 'p1', '--title', 'p1'], /chore-p1 differs here .*and on origin/);
      assert.equal(fs.existsSync(wtOf(F, 'p1')), false, 'no worktree made');
      assert.deepEqual([tipOf(F, 'chore-p1'), originTip(F, 'p1')], [here, there], 'both sides are as they were');
      ok(old, ['chore', 'drop', 'p1', '--reason', 'two sides of it'], SUP);
      assert.deepEqual([tipOf(F, 'chore-p1'), originTip(F, 'p1')], [here, there], 'chore drop moves neither side');
    });

    await t.test('chore start on a squash-merged chore (merge-chore act at its tip) starts from main', () => {
      const tip = branchWith(F, 'f1', 3, { push: true });
      const sq = path.join(F.base, 'squash-f1');
      g(['worktree', 'add', '-q', '--detach', sq, 'origin/main'], old);
      g(['merge', '-q', '--squash', 'chore-f1'], sq);
      g(['commit', '-qm', 'chore-f1: squashed'], sq);
      g(['push', '-q', 'origin', 'HEAD:main'], sq);
      g(['worktree', 'remove', '--force', sq], old);
      assert.match(g(['cherry', 'origin/main', tip], old), /^\+/m, 'git cherry alone still lists the squashed commits');
      hand(F, { type: 'act', class: 'merge-chore', what: `merged chore-f1 at ${tip}`, refs: ['chore-f1'], reversible: true });
      const wt = ok(old, ['chore', 'start', 'f1'], SUP).trim();
      assert.equal(g(['rev-parse', 'HEAD'], wt), main(), 'a merged tip starts again from main');
    });

    await t.test('chore start refuses a branch a drop holds, naming the drop and its sha; --fresh starts it from main and names the old tip', () => {
      const tip = branchWith(F, 'g1', 1, { push: true });
      const short = tip.slice(0, 10);
      const drop = hand(F, { type: 'decision', class: 'chore-drop', what: `dropped chore-g1 at ${short}: abandoned`, rationale: 'abandoned', refs: ['chore-g1'], reversible: true, authority: 'constitution' });
      const r = refused(F, ['chore', 'start', 'g1'], /chore drop/);
      assert.ok(r.err.includes(drop), `names the drop ${drop}: ${r.err}`);
      assert.match(r.err, new RegExp(`, at ${short}\\)`), `names the drop's own sha: ${r.err}`);
      assert.equal(fs.existsSync(wtOf(F, 'g1')), false, 'no worktree made');
      assert.equal(tipOf(F, 'chore-g1'), tip, 'the branch is unchanged');
      moveMain(F, 'past-g1'); // so the fresh branch and the dropped tip diverge (C8b)
      const wt = ok(old, ['chore', 'start', 'g1', '--fresh'], SUP).trim();
      assert.equal(g(['rev-parse', 'HEAD'], wt), main(), '--fresh starts from main');
      const a = ofClass(F, 'act', 'chore-start').filter((x) => x.refs?.[0] === 'chore-g1').pop();
      assert.ok(a, '--fresh appends a chore-start act');
      assert.ok(a.what.includes(`old tip ${tip}`), `its what names the old tip's full sha: ${a.what}`);
    });

    await t.test('after --fresh, with its worktree gone before chore pr, the dropped tip on origin is still refused and --fresh works again', () => {
      const old1 = originTip(F, 'g1');
      g(['worktree', 'remove', '--force', wtOf(F, 'g1')], old);
      refused(F, ['chore', 'start', 'g1'], /is dropped \(chore drop /);
      const wt = ok(old, ['chore', 'start', 'g1', '--fresh'], SUP).trim();
      assert.equal(g(['rev-parse', 'HEAD'], wt), main());
      assert.equal(originTip(F, 'g1'), old1, 'origin is untouched until chore pr');
    });

    await t.test('a drop holds with the worktree still there: chore start and a chore pr with nothing new refuse', () => {
      const wt = ok(old, ['chore', 'start', 'l1'], SUP).trim();
      fs.writeFileSync(path.join(wt, 'l1.md'), 'l1\n');
      g(['add', '-A'], wt);
      g(['commit', '-qm', 'l1'], wt);
      const tip = g(['rev-parse', 'HEAD'], wt);
      hand(F, { type: 'decision', class: 'chore-drop', what: `dropped chore-l1 at ${tip}: not wanted`, rationale: 'not wanted', refs: ['chore-l1'], reversible: true, authority: 'constitution' });
      refused(F, ['chore', 'start', 'l1'], /is dropped \(chore drop /);
      refused(F, ['chore', 'pr', 'l1', '--title', 'l1'], /is dropped \(chore drop /);
      assert.equal(originTip(F, 'l1'), null, 'nothing pushed');
    });

    await t.test('--fresh on a branch no drop holds refuses, and the branch is unchanged', () => {
      const tip = branchWith(F, 'h1');
      refused(F, ['chore', 'start', 'h1', '--fresh'], /no chore drop holds/);
      assert.equal(tipOf(F, 'chore-h1'), tip);
      assert.equal(fs.existsSync(wtOf(F, 'h1')), false);
    });

    await t.test('a drop with no sha holds on the tip it found; a commit after it opens the branch again', () => {
      branchWith(F, 'i1');
      hand(F, { type: 'decision', class: 'chore-drop', what: 'dropped chore-i1: paused', rationale: 'paused', refs: ['chore-i1'], reversible: true, authority: 'constitution' }, 0);
      refused(F, ['chore', 'start', 'i1'], /is dropped \(chore drop .*, at no sha\)/);
      const dir = path.join(F.base, 'more-i1');
      g(['worktree', 'add', '-q', dir, 'chore-i1'], old);
      fs.writeFileSync(path.join(dir, 'more.md'), 'more\n');
      g(['add', '-A'], dir);
      // a minute on: git's commit times are whole seconds, so the same second would read as before the drop
      const later = new Date(Date.now() + 60000).toISOString();
      execFileSync('git', ['commit', '-qm', 'more after the drop'], { cwd: dir, env: { ...process.env, GIT_COMMITTER_DATE: later, GIT_AUTHOR_DATE: later } });
      g(['worktree', 'remove', '--force', dir], old);
      const tip = tipOf(F, 'chore-i1');
      const wt = ok(old, ['chore', 'start', 'i1'], SUP).trim();
      assert.equal(g(['rev-parse', 'HEAD'], wt), tip);
    });

    await t.test('the drop rule: a full sha this clone lacks reads as no sha, so the time rule decides', () => {
      branchWith(F, 'n1');
      const absent = '0123456789abcdef0123456789abcdef01234567';
      hand(F, { type: 'decision', class: 'chore-drop', what: `dropped chore-n1 at ${absent}: made elsewhere`, rationale: 'elsewhere', refs: ['chore-n1'], reversible: true, authority: 'constitution' }, 0);
      refused(F, ['chore', 'start', 'n1'], new RegExp(`is dropped \\(chore drop .*, at ${absent}\\)`));
    });

    await t.test('the drop rule: a drop named only in what, with a short sha, holds', () => {
      const tip = branchWith(F, 'j1');
      hand(F, { type: 'decision', class: 'chore-drop', what: `Drop chore-j1 (${tip.slice(0, 10)}, an old mock): no PR.`, rationale: 'gone', refs: ['kit-9'], reversible: true, authority: 'constitution' });
      refused(F, ['chore', 'start', 'j1'], /is dropped \(chore drop /);
    });

    await t.test('the drop rule: a sentence-ending dot after the name still names it', () => {
      const tip = branchWith(F, 'm1');
      hand(F, { type: 'decision', class: 'chore-drop', what: `No PR for chore-m1. Its tip ${tip.slice(0, 12)} stays on origin.`, rationale: 'gone', refs: ['kit-9'], reversible: true, authority: 'constitution' });
      refused(F, ['chore', 'start', 'm1'], new RegExp(`is dropped \\(chore drop .*, at ${tip.slice(0, 12)}\\)`));
    });

    await t.test('the drop rule: a drop naming a longer branch is not a drop of this one', () => {
      const keep = branchWith(F, 'k1');
      hand(F, { type: 'decision', class: 'chore-drop', what: `Drop chore-k1-more (${keep.slice(0, 10)}): no PR`, rationale: 'gone', refs: ['kit-9'], reversible: true, authority: 'constitution' });
      hand(F, { type: 'decision', class: 'chore-drop', what: `Drop chore-k1.y (${keep.slice(0, 10)}): no PR`, rationale: 'gone', refs: ['kit-9'], reversible: true, authority: 'constitution' });
      const wt = ok(old, ['chore', 'start', 'k1'], SUP).trim();
      assert.equal(g(['rev-parse', 'HEAD'], wt), keep, 'a drop of chore-k1-more is not a drop of chore-k1');
    });

    await t.test('chore start on a branch only on origin checks out its tip, and chore pr leaves origin as it was', () => {
      const tip = branchWith(F, 'q1', 1, { push: true });
      g(['branch', '-q', '-D', 'chore-q1'], old);
      assert.equal(tipOf(F, 'chore-q1'), null, 'no local branch');
      const wt = ok(old, ['chore', 'start', 'q1'], SUP).trim();
      assert.equal(g(['rev-parse', 'HEAD'], wt), tip, "the worktree starts at origin's tip, not main");
      ok(old, ['chore', 'pr', 'q1', '--title', 'q1 from origin'], SUP);
      assert.equal(originTip(F, 'q1'), tip, "origin's commit stays");
    });

    await t.test("chore start on a branch origin has moved past checks out origin's tip, and chore pr keeps origin's commit", () => {
      branchWith(F, 'r1', 1, { push: true });
      const tip = commitOn(F, 'r1', 'r1-origin', { origin: true });
      const wt = ok(old, ['chore', 'start', 'r1'], SUP).trim();
      assert.equal(g(['rev-parse', 'HEAD'], wt), tip, "the worktree starts at origin's newer tip, not the older local one");
      ok(old, ['chore', 'pr', 'r1', '--title', 'r1 from origin'], SUP);
      assert.equal(originTip(F, 'r1'), tip, "origin keeps its newer commit");
    });

    await t.test("chore pr refuses to push over commits only origin has, when chore start couldn't reach origin", () => {
      const tip = branchWith(F, 's1', 1, { push: true });
      g(['branch', '-q', '-D', 'chore-s1'], old);
      g(['update-ref', '-d', 'refs/remotes/origin/chore-s1'], old);
      const url = g(['remote', 'get-url', 'origin'], old);
      g(['remote', 'set-url', 'origin', path.join(F.base, 'no-such-origin')], old);
      let wt;
      try { wt = ok(old, ['chore', 'start', 's1'], SUP).trim(); } finally { g(['remote', 'set-url', 'origin', url], old); }
      assert.equal(g(['rev-parse', 'HEAD'], wt), main(), 'with origin out of reach the branch reads as new, so it starts from main');
      fs.writeFileSync(path.join(wt, 's1-new.md'), 's1 new\n');
      refused(F, ['chore', 'pr', 's1', '--title', 's1 over origin'], new RegExp(`chore-s1 on origin is at ${tip}, with commits this head .* lacks`));
      assert.equal(originTip(F, 's1'), tip, "origin's commit stays");
      assert.equal(g(['rev-parse', 'HEAD'], wt), main(), "the refused run's commit is undone");
      assert.match(g(['status', '--porcelain'], wt), /s1-new\.md/, 'what was written stays in the worktree');
    });

    await t.test('chore pr from a worktree origin has moved past refuses, and origin keeps its commit', () => {
      branchWith(F, 's2', 1, { push: true });
      const wt = ok(old, ['chore', 'start', 's2'], SUP).trim();
      const tip = commitOn(F, 's2', 's2-origin', { origin: true });
      refused(F, ['chore', 'pr', 's2', '--title', 's2 behind'], /chore-s2 on origin is at .*bring them in first/);
      assert.equal(originTip(F, 's2'), tip, "origin's newer commit stays");
      g(['pull', '-q', '--rebase', 'origin', 'chore-s2'], wt);
      ok(old, ['chore', 'pr', 's2', '--title', 's2 caught up'], SUP);
      assert.equal(originTip(F, 's2'), tip, 'once brought in, chore pr pushes');
    });

    await t.test('chore start on a chore whose commit was cherry-picked onto main, with no merge-chore act, starts from main', () => {
      const tip = branchWith(F, 's3', 1, { push: true });
      const cp = path.join(F.base, 'pick-s3');
      g(['worktree', 'add', '-q', '--detach', cp, 'origin/main'], old);
      g(['cherry-pick', tip], cp);
      g(['push', '-q', 'origin', 'HEAD:main'], cp);
      g(['worktree', 'remove', '--force', cp], old);
      const wt = ok(old, ['chore', 'start', 's3'], SUP).trim();
      assert.equal(g(['rev-parse', 'HEAD'], wt), main(), 'git cherry finds its patch in main, so it starts from main');
    });

    await t.test("chore start on a branch origin no longer has reads the local tip, not origin's stale copy", () => {
      branchWith(F, 's4', 2, { push: true });
      const stale = tipOf(F, 'refs/remotes/origin/chore-s4');
      g(['branch', '-q', '-f', 'chore-s4', `${stale}~1`], old);
      const local = tipOf(F, 'chore-s4');
      g(['--git-dir', g(['remote', 'get-url', 'origin'], old), 'branch', '-q', '-D', 'chore-s4'], old);
      assert.equal(tipOf(F, 'refs/remotes/origin/chore-s4'), stale, 'the stale copy is still here');
      const wt = ok(old, ['chore', 'start', 's4'], SUP).trim();
      assert.equal(g(['rev-parse', 'HEAD'], wt), local, 'the local tip, since origin has no such branch');
    });

    await t.test('a dropped chore started again with --fresh lands with chore pr over its dropped tip on origin', () => {
      const old1 = branchWith(F, 'u1', 1, { push: true });
      ok(old, ['chore', 'drop', 'u1', '--reason', 'start it again'], SUP);
      const wt = ok(old, ['chore', 'start', 'u1', '--fresh'], SUP).trim();
      fs.writeFileSync(path.join(wt, 'u1-again.md'), 'u1 again\n');
      ok(old, ['chore', 'pr', 'u1', '--title', 'u1 again'], SUP);
      const head = g(['rev-parse', 'HEAD'], wt);
      assert.notEqual(head, old1);
      assert.equal(originTip(F, 'u1'), head, 'origin is at the fresh head, the dropped tip replaced');
    });

    await t.test('a chore slug used again after its squash merge lands with chore pr over its merged tip on origin', () => {
      const tip = branchWith(F, 'u2', 2, { push: true });
      const sq = path.join(F.base, 'squash-u2');
      g(['worktree', 'add', '-q', '--detach', sq, 'origin/main'], old);
      g(['merge', '-q', '--squash', 'chore-u2'], sq);
      g(['commit', '-qm', 'chore-u2: squashed'], sq);
      g(['push', '-q', 'origin', 'HEAD:main'], sq);
      g(['worktree', 'remove', '--force', sq], old);
      hand(F, { type: 'act', class: 'merge-chore', what: `merged chore-u2 at ${tip}`, refs: ['chore-u2'], reversible: true });
      const wt = ok(old, ['chore', 'start', 'u2'], SUP).trim();
      assert.equal(g(['rev-parse', 'HEAD'], wt), main(), 'a merged tip starts again from main');
      fs.writeFileSync(path.join(wt, 'u2-next.md'), 'u2 next\n');
      ok(old, ['chore', 'pr', 'u2', '--title', 'u2 next'], SUP);
      assert.equal(originTip(F, 'u2'), g(['rev-parse', 'HEAD'], wt), 'origin is at the new head, the merged tip replaced');
    });

    await t.test('CLASS_WORDS has chore-start and chore-drop', () => {
      const src = fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8');
      const words = src.match(/const CLASS_WORDS = Object\.freeze\(\{([\s\S]*?)\}\);/)[1];
      for (const c of ['chore-start', 'chore-drop']) assert.match(words, new RegExp(`'${c}':`), `CLASS_WORDS has ${c}`);
    });

    await t.test("chore pr's self.md hold names chore drop then chore start --fresh to start a chore again from main", () => {
      const src = fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8');
      const fn = src.slice(src.indexOf('function choreSelfHold('), src.indexOf('\n}\n', src.indexOf('function choreSelfHold(')));
      assert.match(fn, /start the chore again from main \(chore drop \$\{slug\} --reason "…", then chore start \$\{slug\} --fresh\)/);
    });

    await t.test("the exterior.md hold names chore drop before a pushed branch is rewritten", () => {
      const src = fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8');
      const carries = src.slice(src.indexOf('const exteriorCarries = '), src.indexOf('\n', src.indexOf('const exteriorCarries = ')));
      assert.ok(carries.includes('rewrite the branch (once pushed, chore drop <slug> --reason "…" first; then git reset --soft origin/main and chore pr again)'), carries);
      const lines = src.slice(src.indexOf('function exteriorChoreLines('), src.indexOf('\n}\n', src.indexOf('function exteriorChoreLines(')));
      assert.ok(lines.includes("carries a word: rewrite the branch (once pushed, chore drop ${path.basename(wt).replace(/^chore-/, '')} --reason \"…\" first; then git reset --soft origin/main and chore pr again)"), 'exteriorChoreLines names the drop');
    });

    await t.test('supervisor.md names chore start --what, chore adopt and chore drop', () => {
      const sup = fs.readFileSync(path.join(kit, 'process/supervisor.md'), 'utf8');
      const topo = sup.slice(sup.indexOf('## 2. Topology'), sup.indexOf('## 3. The tick'));
      assert.match(topo, /chore start <slug> --what/);
      assert.match(topo, /chore adopt/);
      assert.match(topo, /chore drop <slug> --reason/);
    });
  } finally { F.done(); }
});

test('next-moves: each check this file names is a real test of its own, and no fixture or comment names one', () => {
  const name = new RegExp(`next-moves ${'A'}\\d+:`);
  const own = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const named = own.split('\n').filter((l) => name.test(l));
  assert.equal(named.length, 1, named.join('\n'));
  for (const l of named) assert.match(l, new RegExp(`^test\\('next-moves ${'A'}\\d+: .+', (async )?\\(t?\\) => \\{$`), `a check is named only as a test's own name, never skipped: ${l}`);
  const fix = path.join(here, 'fixtures', 'next-moves-chore-records');
  for (const f of fs.existsSync(fix) ? fs.readdirSync(fix, { recursive: true }) : []) {
    const p = path.join(fix, String(f));
    if (fs.statSync(p).isFile()) assert.doesNotMatch(fs.readFileSync(p, 'utf8'), name, `${f} names no check`);
  }
});
