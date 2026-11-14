// The tick tidies finished worktrees (supervisor.md, after a merge): observe-metrics, at most every
// 30 minutes, removes each worktree under .worktrees/ whose work is finished (a merged ticket whose
// worker logged phase done, a chore in main, a planner's merged plan, a final review's an hour old or
// of a merged ticket) when nothing in it is uncommitted or unpushed and no pane or process is in it.
// The branch stays, each removal is a worker-slots act, and nothing outside .worktrees/ is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, json, write, hasTmux } from './lib/kit.mjs';
import { runNode } from './lib/cli.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const QUIET = { DEVTEAM_WORKTREE_QUIET_MS: '0' };

test('the tick removes finished ticket, chore, plan and review worktrees, and keeps the rest', () => {
  const F = fleetFixture('worktree-tidy');
  const { old, ok, g } = F;
  const DT = path.join(old, 'docs/devteam/scripts/devteam.mjs');
  const okIn = (cwd, args, role = {}) => { const r = runNode(DT, args, { cwd, env: F.env(role) }); assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr || r.stdout}`); return r.stdout.trim(); };
  const wtRoot = path.join(old, '.worktrees');
  const at = (name) => path.join(wtRoot, name);
  const stateFile = path.join(old, 'docs/devteam/run/worktree-tidy.json');
  // a tick, due now (the 30 minutes since the last one passed)
  const tick = (extra = QUIET) => { fs.rmSync(stateFile, { force: true }); return ok(old, ['observe-metrics'], { ...SUP, ...extra }); };
  const commit = (wt, file, msg) => { write(path.join(wt, file), `${msg}\n`); g(['add', '-A'], wt); g(['commit', '-qm', msg], wt); };
  const mergeIntoMain = (branch) => { g(['merge', '-q', '--no-ff', '-m', `Merge ${branch}`, branch], old); g(['push', '-q', 'origin', 'main'], old); };
  const ticket = (id) => ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['ch/**'], done_when: ['the tidy check passes in CI'] })], SUP);
  // each kind, finished: a merged ticket whose worker logged phase done; a merged chore; a merged
  // plan branch; a final review's checkout over an hour old
  const make = {
    ticket: (n, { done = true } = {}) => {
      const id = `ch-${n}-t`;
      ticket(id);
      const wt = at(id);
      g(['worktree', 'add', '-q', '-b', `ticket/${id}`, wt, 'origin/main'], old);
      const W = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: id };
      okIn(wt, ['phase', 'build'], W);
      commit(wt, `ch/${id}.txt`, `${id}: work`);
      g(['push', '-q', 'origin', `ticket/${id}`], wt);
      mergeIntoMain(`ticket/${id}`);
      if (done) okIn(wt, ['phase', 'done'], W);
      return wt;
    },
    chore: (n) => {
      const slug = `c${n}`;
      const wt = ok(old, ['chore', 'start', slug], SUP).split('\n').pop();
      commit(wt, `notes/${slug}.md`, `chore-${slug}: notes`);
      g(['push', '-q', 'origin', `chore-${slug}`], wt);
      mergeIntoMain(`chore-${slug}`);
      return wt;
    },
    plan: (n) => {
      const wt = at(`plan-f${n}`);
      g(['worktree', 'add', '-q', '-b', `plan/f${n}`, wt, 'origin/main'], old);
      commit(wt, `notes/plan-f${n}.md`, `plan f${n}`);
      g(['push', '-q', 'origin', `plan/f${n}`], wt);
      mergeIntoMain(`plan/f${n}`);
      return wt;
    },
    review: (n, { old: aged = true } = {}) => {
      const id = `ch-${n}5-r`; // its own number: a review is matched to its ticket by component and number
      ticket(id);
      const sha = g(['rev-parse', 'origin/main'], old);
      const wt = okIn(old, ['review-worktree', id, sha, '--name', `r${n}`]).split('\n').pop();
      if (aged) { const cd = path.join(g(['rev-parse', '--path-format=absolute', '--git-dir'], wt), 'commondir'); const t = new Date(Date.now() - 2 * 3600000); fs.utimesSync(cd, t, t); }
      return wt;
    },
  };
  let sleeper = null;
  try {
    const gone = {}, kept = {};
    // finished, nothing in them: removed
    gone.ticket = make.ticket(10);
    gone.chore = make.chore(10);
    gone.plan = make.plan(10);
    gone.review = make.review(10);
    // a review of a merged ticket goes however young it is
    const mergedReview = okIn(old, ['review-worktree', 'ch-10-t', g(['rev-parse', 'origin/ticket/ch-10-t'], old)]).split('\n').pop();
    // each kind finished but dirty, with a commit on no remote, or (with tmux) with a pane in it
    for (const [kind, n0] of [['ticket', 20], ['chore', 20], ['plan', 20], ['review', 20]]) {
      kept[`${kind} dirty`] = make[kind](n0);
      write(path.join(kept[`${kind} dirty`], 'scratch.txt'), 'work in progress\n');
      kept[`${kind} unpushed`] = make[kind](n0 + 1);
      commit(kept[`${kind} unpushed`], 'later.txt', 'a commit on no remote');
      if (hasTmux) {
        kept[`${kind} window`] = make[kind](n0 + 2);
        spawnSync('tmux', ['new-session', '-d', '-s', `tidy-${kind}`, '-c', kept[`${kind} window`]], { env: F.env({}) });
      }
    }
    // a tracked file changed (not only an untracked one)
    kept['ticket modified'] = make.ticket(30);
    write(path.join(kept['ticket modified'], 'ch/ch-30-t.txt'), 'changed\n');
    // a process (not a pane) working in it
    kept['chore process'] = make.chore(30);
    sleeper = spawn('sleep', ['300'], { cwd: kept['chore process'], stdio: 'ignore' });
    // not finished: a ticket whose worker hasn't logged phase done; a chore or plan pushed and unmerged;
    // a fresh planner's (main's tip); a young review of an unmerged ticket
    kept['ticket not done'] = make.ticket(40, { done: false });
    kept['chore unmerged'] = ok(old, ['chore', 'start', 'c40'], SUP).split('\n').pop();
    commit(kept['chore unmerged'], 'notes/c40.md', 'chore-c40: open');
    g(['push', '-q', 'origin', 'chore-c40'], kept['chore unmerged']);
    kept['plan unmerged'] = at('plan-f40');
    g(['worktree', 'add', '-q', '-b', 'plan/f40', kept['plan unmerged'], 'origin/main'], old);
    commit(kept['plan unmerged'], 'notes/plan-f40.md', 'plan f40');
    g(['push', '-q', 'origin', 'plan/f40'], kept['plan unmerged']);
    kept['plan fresh'] = at('plan-f41');
    g(['worktree', 'add', '-q', '-b', 'plan/f41', kept['plan fresh'], 'origin/main'], old);
    kept['review young'] = make.review(40, { old: false });
    // a chore just started, at main's tip with nothing of its own yet, is not finished either
    kept['chore fresh'] = ok(old, ['chore', 'start', 'c41'], SUP).split('\n').pop();
    // nor a file git was told to stop looking at
    kept['ticket skip-worktree'] = make.ticket(42);
    g(['update-index', '--skip-worktree', 'ch/ch-42-t.txt'], kept['ticket skip-worktree']);
    write(path.join(kept['ticket skip-worktree'], 'ch/ch-42-t.txt'), 'hidden from status\n');
    // outside .worktrees: a finished chore's worktree elsewhere, one reached through a symlink in
    // .worktrees, and a folder there that is no worktree at all
    const outside = path.join(F.base, 'outside');
    g(['worktree', 'add', '-q', '-b', 'chore-outside', outside, 'origin/main'], old);
    const linked = path.join(F.base, 'linked');
    g(['worktree', 'add', '-q', '-b', 'chore-linked', linked, 'origin/main'], old);
    fs.symlinkSync(linked, at('chore-linked'));
    write(at('stray/keep.txt'), 'not a worktree\n');

    const said = tick();
    const lines = said.split('\n').filter((l) => l.startsWith('tidied '));
    assert.equal(lines.length, 1, `one summary line: ${said}`);
    assert.match(lines[0], /^tidied 5 finished worktree\(s\): /);
    for (const [k, wt] of Object.entries({ ...gone, 'merged review': mergedReview })) assert.ok(!fs.existsSync(wt), `${k} removed`);
    for (const [k, wt] of Object.entries(kept)) assert.ok(fs.existsSync(wt), `${k} kept`);
    for (const p of [outside, linked, at('chore-linked'), at('stray/keep.txt'), path.join(old, 'docs/devteam/scripts/devteam.mjs')]) assert.ok(fs.existsSync(p), `${p} untouched`);
    // git forgets them; every branch stays
    const listed = g(['worktree', 'list', '--porcelain'], old);
    for (const wt of Object.values(gone)) assert.ok(!listed.split('\n').includes(`worktree ${path.join(fs.realpathSync(wtRoot), path.basename(wt))}`), `${wt} pruned`);
    for (const b of ['ticket/ch-10-t', 'chore-c10', 'plan/f10']) assert.equal(g(['rev-parse', '--verify', '-q', `refs/heads/${b}`], old).length, 40, `${b} stays`);
    // each removal is an act naming the worktree and why
    const acts = json(ok(old, ['log', '--type', 'act', '--json'])).filter((a) => a.class === 'worker-slots' && a.what.startsWith('removed worktree '));
    assert.deepEqual(acts.map((a) => a.what).sort(), [
      `removed worktree .worktrees/${path.basename(gone.chore)}: chore-c10 is merged into main`,
      `removed worktree .worktrees/${path.basename(gone.review)}: a final review's checkout over an hour old`,
      `removed worktree .worktrees/${path.basename(mergedReview)}: its ticket ch-10-t is merged`,
      'removed worktree .worktrees/ch-10-t: ticket ch-10-t is merged and its worker logged phase done',
      'removed worktree .worktrees/plan-f10: plan/f10 is merged into main',
    ].sort());
    assert.deepEqual(acts.find((a) => a.what.includes('ch-10-t: ticket')).refs, ['ch-10-t']);

    // the pane gone and the process ended: those go on the next tick, and the rest stay
    if (hasTmux) spawnSync('tmux', ['kill-server'], { env: F.env({}) });
    sleeper.kill();
    for (let i = 0; i < 100 && sleeper.exitCode === null && sleeper.signalCode === null; i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    tick();
    for (const [k, wt] of Object.entries(kept)) assert.equal(fs.existsSync(wt), !(k.endsWith(' window') || k === 'chore process'), `${k} after the pane and the process went`);

    // at most every 30 minutes: a finished one made right after a tick waits for the next
    const next = make.chore(50);
    ok(old, ['observe-metrics'], { ...SUP, ...QUIET });
    assert.ok(fs.existsSync(next), 'not due yet');
    // and one at work a moment ago (just made) waits until it has been quiet a while
    assert.doesNotMatch(tick({}), /^tidied /m);
    assert.ok(fs.existsSync(next), 'too recent');
    assert.match(tick(), /^tidied 1 finished worktree\(s\): chore-c50$/m);
    assert.ok(!fs.existsSync(next));
  } finally {
    if (sleeper && sleeper.exitCode === null) sleeper.kill();
    F.done();
  }
});
