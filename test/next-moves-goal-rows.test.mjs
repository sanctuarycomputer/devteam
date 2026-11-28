// The goal rows and the planner rows of the next-move table (kit-288): for every running goal one
// move, the first row that matches (G1 to G20), and for every planner its own (P1 to P4); a goal
// whose planner holds its move copies it (via), and so does a goal waiting on another's design. Each
// move's flag comes from its holder and age alone (next_move_owed_minutes, next_move_stall_hours).
// Fixture projects drive the real CLI; every move they print is held to next-move@1's shape (the
// checker is kit-287's, copied from test/next-moves.test.mjs, which exports nothing).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fleetFixture, json, write } from './lib/kit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DT = path.join(here, '..', 'docs', 'devteam', 'scripts', 'devteam.mjs');
const SRC = fs.readFileSync(DT, 'utf8');

/* the next-move@1 checker, as test/next-moves.test.mjs has it */
const FIELDS = ['subject', 'move', 'words', 'holder', 'ref', 'title', 'since', 'command', 'covered_by', 'quiet', 'via', 'flag', 'rung', 'chore', 'wait'];
const HOLDERS = ['owner', 'supervisor', 'planner', 'worker', 'nobody'];
const REF_KINDS = ['q', 'm', 'ticket', 'goal', 'chore', 'pr', 'o', 't', 'a'];
const QUIET = [null, 'hold', 'drain', 'queue'];
const VIA_KINDS = [null, 'ticket:', 'planner:', 'goal:', 'chore:'];
const FLAGS = [null, 'owed', 'stalled', 'none'];
const RUNGS = [0, 1, 2];
const ALWAYS = FIELDS.filter((f) => f !== 'chore' && f !== 'wait');
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const isIso = (s) => typeof s === 'string' && ISO.test(s) && !Number.isNaN(Date.parse(s));
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const kindOf = (s) => (typeof s === 'string' ? (s.match(/^(goal|ticket|planner|chore|follow-up|thread|answer|duty|record):\S+$/)?.[1] ?? null) : null);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';
function moveErrors(m) {
  const e = [];
  const no = (rule, detail) => e.push(`${rule}: ${detail}`);
  if (!isObj(m)) return ['field-missing: not an object'];
  for (const f of ALWAYS) if (!(f in m)) no('field-missing', f);
  for (const f of Object.keys(m)) if (!FIELDS.includes(f)) no('field-unknown', f);
  const kind = kindOf(m.subject);
  if ('subject' in m && !kind) no('subject', String(m.subject));
  if ('move' in m && !(typeof m.move === 'string' && KEBAB.test(m.move))) no('move', String(m.move));
  if ('words' in m && !nonEmpty(m.words)) no('words', 'empty');
  if ('holder' in m && !HOLDERS.includes(m.holder)) no('holder', String(m.holder));
  if ('ref' in m && m.ref !== null) {
    if (!isObj(m.ref)) no('ref', 'not an object or null');
    else {
      if (!REF_KINDS.includes(m.ref.kind)) no('ref-kind', String(m.ref.kind));
      if (m.ref.kind === 'pr') {
        if (!(Number.isInteger(m.ref.id) && m.ref.id > 0)) no('ref-id', `a pr ref's id is the PR number: ${JSON.stringify(m.ref.id)}`);
        if (!nonEmpty(m.ref.url)) no('ref-url', 'a pr ref has no url');
      } else {
        if (!nonEmpty(m.ref.id)) no('ref-id', JSON.stringify(m.ref.id));
        if ('url' in m.ref) no('ref-url', `a ${m.ref.kind} ref has a url`);
      }
      for (const k of Object.keys(m.ref)) if (!['kind', 'id', 'url'].includes(k)) no('ref', `unknown key ${k}`);
    }
  }
  if ('title' in m && !nonEmpty(m.title)) no('title', 'empty');
  if ('since' in m && !isIso(m.since)) no('since', String(m.since));
  if ('command' in m && !(m.command === null || nonEmpty(m.command))) no('command', JSON.stringify(m.command));
  if ('covered_by' in m) {
    if (!Array.isArray(m.covered_by)) no('covered-by', 'not an array');
    else for (const c of m.covered_by) if (!isObj(c) || !nonEmpty(c.kind) || !nonEmpty(c.subject) || Object.keys(c).length !== 2) no('covered-by', JSON.stringify(c));
  }
  if ('quiet' in m && !QUIET.includes(m.quiet)) no('quiet', String(m.quiet));
  if ('via' in m && m.via !== null && !VIA_KINDS.includes(`${kindOf(m.via)}:`)) no('via', String(m.via));
  if ('flag' in m && !FLAGS.includes(m.flag)) no('flag', String(m.flag));
  if ('rung' in m && !RUNGS.includes(m.rung)) no('rung', JSON.stringify(m.rung));
  if (m.quiet && m.flag !== null) no('quiet-flag', `a quiet move is never flagged (${m.flag})`);
  if (m.quiet && m.rung !== 0) no('quiet-rung', `a quiet move stays at rung 0 (${m.rung})`);
  if (m.flag === 'owed' && m.holder !== 'supervisor') no('owed-holder', `owed is the supervisor's (${m.holder})`);
  if (m.flag === 'owed' && ![1, 2].includes(m.rung)) no('owed-rung', `an owed move is at rung 1 or 2 (${m.rung})`);
  if (m.flag === 'stalled' && m.rung !== 2) no('stalled-rung', `a stalled move is at rung 2 (${m.rung})`);
  if (m.flag === 'none' && m.holder !== 'nobody') no('none-holder', `no next move is nobody's (${m.holder})`);
  if (kind && kind !== 'chore' && 'chore' in m) no('chore-extra', `a ${kind} move carries no chore`);
  if ('wait' in m && kind !== 'ticket') no('wait-extra', `a ${kind} move carries no wait`);
  return e;
}
/* end of the checker */

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const planner = (f) => ({ DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: f });
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const first = (s) => s.split('\n')[0].trim();
const projects = [];
after(() => { for (const p of projects) p.F.done(); });

// A fixture project, with the settings given added to its settings block, and the steps the tests
// take on it through the CLI.
function project(name, settings = {}) {
  const F = fleetFixture(`nm-${name}`);
  const { old, ok, g } = F;
  if (Object.keys(settings).length) {
    const sf = path.join(old, 'docs/devteam/project/settings.md');
    fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"forge": "git"', `"forge": "git", ${Object.entries(settings).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')}`));
    g(['add', '-A'], old); g(['commit', '-qm', 'settings'], old); g(['push', '-q', 'origin', 'main'], old);
  }
  const sup = (args) => ok(old, args, SUP);
  const owner = (args) => ok(old, args);
  let prio = 0;
  const P = {
    F, sup, owner,
    // a draft goal with definition gaps
    gappy: (title) => first(sup(['goal', 'add', '--title', title])),
    // a fully defined draft goal: owner-read by default, or repo with its check and a baseline reading
    defined: (title, { source = 'owner', check = 'cat gaps.txt', target = 0 } = {}) => {
      const measure = source === 'owner' ? ['--measure', 'the owner says it holds', '--target', '1', '--unit', 'attested', '--direction', 'up', '--source', 'owner', '--question', `Does ${title} hold?`]
        : source === 'none' ? ['--measure', 'gaps', '--target', '0', '--unit', 'gaps', '--direction', 'down']
          : ['--measure', 'gaps', '--target', String(target), '--unit', 'gaps', '--direction', 'down', '--source', source, '--check', check];
      const G = first(sup(['goal', 'add', '--title', title, '--outcome', `${title} holds`, ...measure, '--non-goals', 'none', '--preconditions', 'first part', 'second part', '--priority', String(++prio)]));
      if (source === 'repo') sup(['goal', 'reading', G, '--run']);
      return G;
    },
    // approved by the owner, with its milestones
    ready: (title, opts = {}) => {
      const G = P.defined(title, opts);
      const ms = opts.milestones ?? (opts.source === 'repo' ? [{ title: 'all of it', target: opts.target ?? 0, preconditions: [1, 2], tickets: 2 }] : [{ title: 'all of it', target: 1, preconditions: [1, 2], tickets: 2 }]);
      if (opts.source !== 'none') sup(['goal', 'set', G, '--milestones', JSON.stringify(ms)]);
      owner(['goal', 'decide', G, 'approve', '--force']);
      return G;
    },
    feature: (slug, G, pre = [1, 2]) => sup(['feature', 'add', slug, '--json', JSON.stringify({ title: `Feature ${slug}`, goals: [G], preconditions: pre.map((n) => `${G}#${n}`), stories: [{ id: `${slug.toUpperCase()}-S1`, text: 'it works', release: 'v1.0.0' }] })]),
    ticket: (id, feature) => sup(['ticket', 'add', id, '--json', JSON.stringify({ title: `Ticket ${id}`, feature, component: 'ch', kind: 'build', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: [`${id}/**`], done_when: ['its check passes in CI'] })]),
    // a ticket's merge on main: a commit "<id>: …" (merge's own subject), made in the next second so
    // its commit time (whole seconds) is after every line written before it; a line written after it
    // in that same second still reads as later
    merge: (id) => {
      sleep(1005 - (Date.now() % 1000));
      g(['commit', '-q', '--allow-empty', '-m', `${id}: landed`], old);
      g(['push', '-q', 'origin', 'main'], old);
      return new Date(g(['log', '-1', '--format=%cI'], old)).toISOString();
    },
    onMain: (file, text) => { write(path.join(old, file), text); g(['add', '-A'], old); g(['commit', '-qm', file], old); g(['push', '-q', 'origin', 'main'], old); },
    // a planner in flight: its plan branch, off main, with its feature line naming the goal
    planner: (f, G) => {
      g(['checkout', '-q', '-b', `plan/${f}`], old);
      write(path.join(old, `docs/devteam/project/log/plan-${f}.jsonl`), `${JSON.stringify({ v: 1, type: 'feature', op: 'new', id: f, title: `Feature ${f}`, goals: [G], stories: [{ id: 'PL-S1', text: 'it works', release: 'v1.0.0' }], at: new Date().toISOString(), by: `plan-${f}` })}\n`);
      g(['add', '-A', `docs/devteam/project/log/plan-${f}.jsonl`], old);
      g(['commit', '-qm', `plan ${f}`], old);
      g(['checkout', '-q', 'main'], old);
    },
    ask: (args) => first(sup(['ask', ...args])),
    goal: (G) => json(ok(old, ['goal', 'show', G])),
    question: (Q) => json(ok(old, ['questions', '--id', Q, '--json']))[0],
    lastChange: (G) => { const x = P.goal(G); return (x.updates ?? []).at(-1)?.at ?? x.created_at; },
    moves: () => {
      const out = json(ok(old, ['moves', '--json']));
      for (const m of out.moves) assert.deepEqual(moveErrors(m), [], `${m.subject} fits next-move@1: ${JSON.stringify(m)}`);
      return out.moves;
    },
    move: (subject) => P.moves().find((m) => m.subject === subject),
    // a move as moves --json prints it, before the shape check, so a flag test's own assertion speaks first
    raw: (subject) => json(ok(old, ['moves', '--json'])).moves.find((m) => m.subject === subject) ?? assert.fail(`${subject} has a move`),
    need: (subject) => P.move(subject) ?? assert.fail(`${subject} has a move`),
  };
  projects.push(P);
  return P;
}
// One goal's move, with its row's key, holder and the rest checked by the caller.
const goalMove = (P, G) => P.move(`goal:${G}`) ?? assert.fail(`goal:${G} has a move`);

test('next-moves A1: definition: a draft goal with gaps is the supervisor\'s to ask, then the owner\'s to answer', async (t) => {
  const P = project('a1');
  const G = P.gappy('Define me');
  await t.test('gaps and no question: the supervisor asks (G6), since the goal\'s last change', () => {
    const m = goalMove(P, G);
    assert.equal(m.move, 'ask-definition');
    assert.equal(m.holder, 'supervisor');
    assert.equal(m.since, P.lastChange(G));
    assert.equal(m.title, 'Define me');
    assert.match(m.command, new RegExp(`ask --kind goal-definition --goal ${G}`));
  });
  await t.test('a goal-definition question open: the owner answers it (G5), since it was asked', () => {
    const Q = P.ask(['--kind', 'goal-definition', '--goal', G, '--question', 'What is Define me for?']);
    const m = goalMove(P, G);
    assert.equal(m.move, 'answer-question');
    assert.equal(m.holder, 'owner');
    assert.deepEqual(m.ref, { kind: 'q', id: Q });
    assert.equal(m.since, P.question(Q).asked_at);
    assert.deepEqual(m.covered_by, [{ kind: 'owner-question-waiting', subject: Q }]);
    assert.match(m.words, /^Answer: What is Define me for\?/);
  });
});

test('next-moves A2: planning: start a planner, the planner\'s own move, the planner waiting, plan_after and refine', async (t) => {
  const P = project('a2', { next_move_owed_minutes: 0 });
  await t.test('a defined draft with no planner: the supervisor starts one (G11), covered while idle-planning is raised', () => {
    const G = P.defined('Plan me');
    const m = goalMove(P, G);
    assert.equal(m.move, 'start-planner');
    assert.equal(m.holder, 'supervisor');
    assert.equal(m.quiet, null);
    assert.deepEqual(m.covered_by, [{ kind: 'idle-planning', subject: '*' }, { kind: 'memory-full', subject: '*' }]);
    const kinds = json(P.F.ok(P.F.old, ['metrics', '--json'])).findings.map((f) => f.kind);
    assert.ok(kinds.includes('idle-planning'), `idle-planning is raised: ${kinds.join(' ')}`);
  });
  await t.test('a planner in flight: the goal takes its move (G9), via the planner', () => {
    const G = P.defined('Being planned');
    P.planner('beingplanned', G);
    const m = goalMove(P, G);
    const p = P.need('planner:beingplanned');
    assert.equal(p.move, 'planning');
    assert.equal(p.holder, 'planner');
    assert.equal(p.title, 'Feature beingplanned');
    assert.equal(m.via, 'planner:beingplanned');
    assert.equal(m.move, 'planning');
    assert.equal(m.holder, 'planner');
    assert.equal(m.since, p.since);
    assert.equal(m.title, 'Being planned');
  });
  await t.test('its review request unanswered: the supervisor answers the planner (G8), via the planner', () => {
    const G = P.defined('Design waiting');
    P.planner('designwaiting', G);
    P.F.ok(P.F.old, ['send', 'supervisor', 'design ready for review', '--kind', 'review-request'], planner('designwaiting'));
    const msgs = json(P.F.ok(P.F.old, ['dashboard-data'])).planners.find((x) => x.feature === 'designwaiting').waiting_on_supervisor;
    const m = goalMove(P, G);
    assert.equal(m.move, 'answer-planner');
    assert.equal(m.holder, 'supervisor');
    assert.equal(m.via, 'planner:designwaiting');
    assert.deepEqual(m.ref, { kind: 'm', id: msgs[0].id });
    assert.match(m.words, /^Answer the planner: review-request$/);
  });
  await t.test('plan_after a draft goal: that goal\'s move, via it, with its flag (G10)', () => {
    const A = P.gappy('Ahead of it');
    const B = P.defined('Behind it');
    P.sup(['goal', 'set', B, '--plan-after', A, '--reason', 'its design builds on the other']);
    const a = goalMove(P, A);
    const b = goalMove(P, B);
    assert.equal(a.flag, 'owed', 'the goal ahead owes a move past next_move_owed_minutes (0 here)');
    assert.equal(b.move, 'waits-for-goal');
    assert.equal(b.via, `goal:${A}`);
    assert.deepEqual(b.ref, { kind: 'goal', id: A });
    assert.equal(b.words, "Waits for Ahead of it's design");
    for (const k of ['holder', 'since', 'flag', 'rung']) assert.equal(b[k], a[k], `the copy carries its source's ${k}`);
  });
  await t.test('a plan_after loop: the supervisor breaks it', () => {
    const A = P.defined('Loop one');
    const B = P.defined('Loop two');
    P.sup(['goal', 'set', A, '--plan-after', B, '--reason', 'one waits on two']);
    P.sup(['goal', 'set', B, '--plan-after', A, '--reason', 'two waits on one']);
    for (const G of [A, B]) {
      const m = goalMove(P, G);
      assert.equal(m.move, 'break-plan-after-loop');
      assert.equal(m.holder, 'supervisor');
      assert.equal(m.via, null);
    }
  });
  await t.test('a refine verdict and no planner: the supervisor reworks the design (G7), since the verdict', () => {
    const G = P.defined('Refine me');
    P.owner(['goal', 'decide', G, 'refine', '--notes', 'a tighter measure']);
    const m = goalMove(P, G);
    assert.equal(m.move, 'rework-design');
    assert.equal(m.holder, 'supervisor');
    assert.equal(m.since, P.lastChange(G));
  });
});

test('next-moves A3: approval: the owner\'s open approval question, else the planner\'s unanswered request', async (t) => {
  const P = project('a3');
  const G = P.defined('Approve me');
  P.planner('approveme', G);
  await t.test('no goal-approval question asked, the planner\'s review request unanswered: the supervisor (G8)', () => {
    P.F.ok(P.F.old, ['send', 'supervisor', 'design ready: please ask the owner', '--kind', 'review-request'], planner('approveme'));
    const m = goalMove(P, G);
    assert.equal(m.move, 'answer-planner');
    assert.equal(m.holder, 'supervisor');
    assert.equal(m.via, 'planner:approveme');
  });
  await t.test('an open goal-approval question: the owner (G5)', () => {
    P.onMain('docs/devteam/project/designs/approve-me.md', '# Approve me\n');
    P.sup(['goal', 'set', G, '--milestones', JSON.stringify([{ title: 'all of it', target: 1, preconditions: [1, 2], tickets: 2 }])]);
    const Q = P.ask(['--kind', 'goal-approval', '--goal', G, '--question', 'Approve the design for Approve me?', '--recommendation', 'Approve', '--links', JSON.stringify([{ title: 'the design', path: 'docs/devteam/project/designs/approve-me.md' }])]);
    const m = goalMove(P, G);
    assert.equal(m.move, 'answer-question');
    assert.equal(m.holder, 'owner');
    assert.deepEqual(m.ref, { kind: 'q', id: Q });
    assert.equal(m.via, null);
  });
});

test('next-moves A4: next features: unplanned preconditions and featureless tickets come before the lead ticket', async (t) => {
  const P = project('a4');
  const G = P.ready('Grow it', { milestones: [{ title: 'first', target: 0.5, preconditions: [1], tickets: 1 }, { title: 'then', target: 1, preconditions: [2], tickets: 1 }] });
  // its current milestone (the first) needs precondition 1; the later one's precondition 2 is planned already
  P.feature('later', G, [2]);
  P.ticket('ch-41-later', 'later');
  await t.test('a precondition of the current milestone no feature covers: plan the next features (G14), while a ticket is in flight', () => {
    const m = goalMove(P, G);
    assert.equal(m.move, 'plan-next-features');
    assert.equal(m.holder, 'supervisor');
    assert.equal(m.words, 'Plan the next features');
    assert.equal(m.since, P.goal(G).updates.filter((u) => u.decision?.verdict === 'approve').at(-1).at, 'since the approval');
    assert.deepEqual(m.covered_by, [{ kind: 'idle-planning', subject: '*' }, { kind: 'memory-full', subject: '*' }]);
    const kinds = json(P.F.ok(P.F.old, ['metrics', '--json'])).findings.map((f) => f.kind);
    assert.ok(kinds.includes('idle-planning'), `idle-planning is raised for it: ${kinds.join(' ')}`);
  });
  await t.test('a feature of it with no tickets: plan its tickets (G15), while a ticket is in flight', () => {
    P.feature('first', G, [1]);
    const m = goalMove(P, G);
    assert.equal(m.move, 'plan-tickets');
    assert.equal(m.holder, 'supervisor');
    assert.equal(m.words, 'Plan the tickets for Feature first');
  });
  await t.test('once every feature has tickets: the lead ticket\'s move (G16)', () => {
    P.ticket('ch-42-first', 'first');
    const m = goalMove(P, G);
    assert.equal(m.via, 'ticket:ch-41-later');
    assert.equal(m.move, 'start-worker');
  });
});

test('next-moves A6: the trigger case: an owner-read goal all merged is asked whether it is met, and a No is re-planned', async (t) => {
  const P = project('a6');
  const G = P.ready('Owner reads it');
  P.feature('ownerread', G);
  P.ticket('ch-61-one', 'ownerread');
  const merged = P.merge('ch-61-one');
  let Q;
  await t.test('all merged, no goal-met question: the supervisor asks (G13), since the last merge', () => {
    const m = goalMove(P, G);
    assert.equal(m.move, 'ask-goal-met');
    assert.equal(m.holder, 'supervisor');
    assert.equal(m.words, 'Ask you whether it is met');
    assert.equal(m.since, merged);
    assert.equal(m.command, `ask --class goal-met --goal ${G} --recommendation yes`);
    assert.deepEqual(m.covered_by, [{ kind: 'goal-work-merged', subject: G }]);
  });
  await t.test('a goal-met question withdrawn since the merge asked nothing: asked again (G13)', () => {
    const W = P.ask(['--class', 'goal-met', '--goal', G, '--recommendation', 'yes']);
    P.sup(['withdraw', W, '--reason', 'asked too soon']);
    assert.equal(goalMove(P, G).move, 'ask-goal-met');
  });
  await t.test('once asked: the owner (G4)', () => {
    Q = P.ask(['--class', 'goal-met', '--goal', G, '--recommendation', 'yes']);
    const m = goalMove(P, G);
    assert.equal(m.move, 'answer-goal-met');
    assert.equal(m.holder, 'owner');
    assert.deepEqual(m.ref, { kind: 'q', id: Q });
    assert.equal(m.since, P.question(Q).asked_at);
    assert.deepEqual(m.covered_by, [{ kind: 'owner-question-waiting', subject: Q }]);
  });
  await t.test('after a No with the work all merged: the supervisor re-plans (G18), never G20', () => {
    P.owner(['answer', Q, 'No — not on phones yet']);
    const m = goalMove(P, G);
    assert.equal(m.move, 're-plan-after-no');
    assert.equal(m.holder, 'supervisor');
    assert.equal(m.words, "Re-plan: you said it isn't met yet (not on phones yet)");
    assert.equal(m.since, P.question(Q).answered_at);
  });
  await t.test('another open question tagged with the goal, a priority-only goal-change, leaves the re-plan in place', () => {
    const C = P.ask(['--class', 'goal-change', '--goal', G, '--change', '{"priority": 9}', '--question', 'Lower its priority?', '--recommendation', 'Yes']);
    assert.equal(goalMove(P, G).move, 're-plan-after-no');
    P.sup(['withdraw', C, '--reason', 'not needed']);
  });
  await t.test('once a ticket is added for the re-plan: the lead ticket\'s move (G16)', () => {
    P.ticket('ch-62-replan', 'ownerread');
    const m = goalMove(P, G);
    assert.equal(m.via, 'ticket:ch-62-replan');
  });
  await t.test('once that merges: asked again (G13), since the new merge', () => {
    const again = P.merge('ch-62-replan');
    const m = goalMove(P, G);
    assert.equal(m.move, 'ask-goal-met');
    assert.equal(m.since, again);
  });
  await t.test('a No answered while tickets are in flight: the lead ticket\'s move (G16), not the re-plan', () => {
    const H = P.ready('Mid build');
    P.feature('midbuild', H);
    P.ticket('ch-63-done', 'midbuild');
    P.merge('ch-63-done');
    P.ticket('ch-64-open', 'midbuild');
    const N = P.ask(['--class', 'goal-met', '--goal', H, '--recommendation', 'yes']);
    P.owner(['answer', N, 'No — wait for the rest']);
    const m = goalMove(P, H);
    assert.equal(m.via, 'ticket:ch-64-open');
  });
  await t.test('the last ticket merging while the goal-met question is open, then a No: the re-plan (G18), not asked again', () => {
    const J = P.ready('Merged while asked');
    P.feature('mergedasked', J);
    P.ticket('ch-65-last', 'mergedasked');
    const N = P.ask(['--class', 'goal-met', '--goal', J, '--recommendation', 'yes']);
    P.merge('ch-65-last');
    assert.equal(goalMove(P, J).move, 'answer-goal-met', 'open: the owner (G4)');
    P.owner(['answer', N, 'No — needs more']);
    const m = goalMove(P, J);
    assert.notEqual(m.move, 'ask-goal-met', 'the owner judged the merged work: not asked again');
    assert.equal(m.move, 're-plan-after-no');
    assert.equal(m.since, P.question(N).answered_at);
  });
  await t.test('a goal with no tickets at all is not asked (not G13)', () => {
    const E = P.ready('No tickets');
    P.feature('notickets', E);
    const m = goalMove(P, E);
    assert.notEqual(m.move, 'ask-goal-met');
    assert.equal(m.move, 'plan-tickets');
  });
});

test('next-moves A6: the trigger case on a repo goal: a No that stands, a measure change asked, and readings first', async (t) => {
  const P = project('a6-repo');
  P.onMain('gaps.txt', '0\n');
  const G = P.ready('Repo reads it', { source: 'repo' });
  P.feature('reporeads', G);
  P.ticket('ch-65-one', 'reporeads');
  P.merge('ch-65-one');
  P.sup(['goal', 'reading', G, '--run']);
  const Q = P.ask(['--class', 'goal-met', '--goal', G, '--recommendation', 'yes']);
  P.owner(['answer', Q, 'No — the docs still lag']);
  await t.test('at target, with its No and no work since: the re-plan (G18)', () => {
    assert.equal(goalMove(P, G).move, 're-plan-after-no');
  });
  await t.test('its re-plan merged and no reading since: take a reading (G17), not G18b', () => {
    P.ticket('ch-66-replan', 'reporeads');
    const merged = P.merge('ch-66-replan');
    const m = goalMove(P, G);
    assert.equal(m.move, 'take-reading');
    assert.equal(m.holder, 'supervisor');
    assert.equal(m.since, merged);
    assert.equal(m.command, `goal reading ${G} --run`);
  });
  await t.test('work merged since its No and a new reading at the same value: re-plan or change the measure (G18b), never G20', () => {
    P.sup(['goal', 'reading', G, '--run']);
    const m = goalMove(P, G);
    assert.notEqual(m.move, 'ask-goal-met', 'a reading taken after its No, at the same value and basis: not asked again (not G12)');
    assert.equal(m.move, 're-plan-or-change-measure');
    assert.equal(m.holder, 'supervisor');
    assert.equal(m.words, "Work merged since your No and the measure hasn't moved: re-plan, or propose a change to the measure");
  });
  let C;
  await t.test('once a goal-change to its measure is asked: the owner (G17b)', () => {
    C = P.ask(['--class', 'goal-change', '--goal', G, '--change', JSON.stringify({ measure: { description: 'gaps in the docs too' } }), '--question', 'Count the docs gaps too?', '--recommendation', 'Yes']);
    const m = goalMove(P, G);
    assert.equal(m.move, 'answer-question');
    assert.equal(m.holder, 'owner');
    assert.deepEqual(m.ref, { kind: 'q', id: C });
  });
  await t.test('re-plan tickets merging while that question is open: take a reading (G17) first, then G17b', () => {
    P.ticket('ch-67-more', 'reporeads');
    P.merge('ch-67-more');
    assert.equal(goalMove(P, G).move, 'take-reading');
    P.sup(['goal', 'reading', G, '--run']);
    const m = goalMove(P, G);
    assert.equal(m.move, 'answer-question');
    assert.deepEqual(m.ref, { kind: 'q', id: C });
  });
});

test('next-moves A7: readings: a repo goal all merged is read, then re-planned when the measure fell short', async (t) => {
  const P = project('a7');
  P.onMain('gaps.txt', '3\n');
  const G = P.ready('Read me', { source: 'repo', milestones: [{ title: 'half', target: 1, preconditions: [1], tickets: 1 }, { title: 'all', target: 0, preconditions: [2], tickets: 1 }] });
  P.feature('readme', G);
  P.ticket('ch-71-one', 'readme');
  const merged = P.merge('ch-71-one');
  await t.test('no reading since the last merge: take a reading (G17), since the merge', () => {
    const m = goalMove(P, G);
    assert.equal(m.move, 'take-reading');
    assert.equal(m.since, merged);
  });
  await t.test('a reading short of the current milestone\'s target: re-plan (G19), since the reading', () => {
    P.sup(['goal', 'reading', G, '--run']);
    const r = P.goal(G).readings.at(-1);
    const m = goalMove(P, G);
    assert.equal(m.move, 're-plan-measure-short');
    assert.equal(m.holder, 'supervisor');
    assert.equal(m.words, "Re-plan: the work merged but the measure didn't move enough");
    assert.equal(m.since, r.at);
  });
  await t.test('after a No, its re-plan merged with no reading since: take a reading (G17), not G18b', () => {
    P.onMain('gaps2.txt', '0\n');
    const H = P.ready('Read after a No', { source: 'repo', check: 'cat gaps2.txt' });
    P.feature('readafter', H);
    P.ticket('ch-72-one', 'readafter');
    P.merge('ch-72-one');
    P.sup(['goal', 'reading', H, '--run']);
    const N = P.ask(['--class', 'goal-met', '--goal', H, '--recommendation', 'yes']);
    P.owner(['answer', N, 'No — not yet']);
    P.ticket('ch-73-replan', 'readafter');
    const merged = P.merge('ch-73-replan');
    const m = goalMove(P, H);
    assert.notEqual(m.move, 're-plan-or-change-measure');
    assert.equal(m.move, 'take-reading');
    assert.equal(m.since, merged);
  });
});

test('next-moves: holds, the queue for a planner slot, and a state no row knows', async (t) => {
  const P = project('holds', { max_active_planners: 1 });
  await t.test('parked by the owner: quiet, never flagged (G2)', () => {
    const G = P.defined('Parked one');
    P.owner(['goal', 'hold', G, 'park', '--owner']);
    const m = goalMove(P, G);
    assert.equal(m.move, 'parked');
    assert.equal(m.words, 'Parked by you');
    assert.equal(m.holder, 'owner');
    assert.equal(m.quiet, 'hold');
    assert.equal(m.flag, null);
  });
  await t.test('draining with nothing of it running: quiet (G3)', () => {
    const G = P.defined('Drained one');
    P.owner(['goal', 'hold', G, 'drain', '--owner', '--reason', 'finishing up']);
    const m = goalMove(P, G);
    assert.equal(m.move, 'draining');
    assert.equal(m.quiet, 'drain');
    assert.equal(m.holder, 'owner', 'whoever set it');
  });
  await t.test('drained for a ticket that then merges: release, the supervisor\'s, owed at once (G3)', () => {
    const O = P.ready('Other work');
    P.feature('otherwork', O);
    P.ticket('ch-81-other', 'otherwork');
    const G = P.defined('Drained for a ticket');
    P.sup(['goal', 'hold', G, 'drain', '--reason', 'waits on the other work', '--for', 'ch-81-other']);
    const before = P.raw(`goal:${G}`);
    assert.equal(before.move, 'draining', 'its cause is open: quiet');
    assert.equal(before.quiet, 'drain');
    P.merge('ch-81-other');
    const m = P.raw(`goal:${G}`);
    assert.equal(m.move, 'release');
    assert.equal(m.holder, 'supervisor');
    assert.equal(m.words, 'Release it: what it waited on is done (ch-81-other merged)');
    assert.equal(m.command, `goal hold ${G} run --reason "…"`);
    assert.equal(m.quiet, null);
    assert.equal(m.flag, 'owed', 'owed at once, before next_move_owed_minutes');
    assert.deepEqual(moveErrors(m), []);
  });
  await t.test('draining with its planner still running: not quiet, the planner\'s move (G9)', () => {
    const G = P.defined('Draining, planned');
    P.planner('drainplanned', G);
    P.owner(['goal', 'hold', G, 'drain', '--owner', '--reason', 'finishing up']);
    const m = goalMove(P, G);
    assert.notEqual(m.move, 'draining');
    assert.equal(m.via, 'planner:drainplanned');
  });
  await t.test('met and let go: no move (G1)', () => {
    const G = P.gappy('Let go');
    P.owner(['goal', 'decide', G, 'let-go']);
    assert.equal(P.move(`goal:${G}`), undefined, 'let go');
    const M = P.ready('Met');
    P.feature('metgoal', M);
    P.ticket('ch-82-met', 'metgoal');
    P.merge('ch-82-met');
    const Q = P.ask(['--class', 'goal-met', '--goal', M, '--recommendation', 'yes']);
    P.owner(['answer', Q, 'Yes']);
    assert.equal(P.goal(M).status, 'met');
    assert.equal(P.move(`goal:${M}`), undefined, 'met');
  });
  await t.test('a defined draft while the planner slots are full: quiet, the queue (G11)', () => {
    const G = P.defined('Waits for a slot');
    P.planner('slottaker', P.defined('Takes the slot'));
    const m = goalMove(P, G);
    assert.equal(m.move, 'start-planner');
    assert.equal(m.quiet, 'queue');
    assert.equal(m.flag, null);
  });
  await t.test('a state no row knows: no next move (G20), held by nobody, flag none', () => {
    // a ready goal with no source, its work all merged: nothing reads it, and nobody is asked
    const G = P.ready('Unread', { source: 'none' });
    P.feature('unread', G);
    P.ticket('ch-81-one', 'unread');
    P.merge('ch-81-one');
    const m = goalMove(P, G);
    assert.equal(m.move, 'no-next-move');
    assert.equal(m.words, 'No next move');
    assert.equal(m.holder, 'nobody');
    assert.equal(m.flag, 'none');
    assert.equal(m.since, P.lastChange(G));
  });
});

test('next-moves: planner rows: the owner\'s question, the supervisor\'s answer, parked, and planning', async (t) => {
  const P = project('planners');
  await t.test('planning, since its last sign of life (P4)', () => {
    P.planner('pfour', P.defined('Four'));
    const p = P.need('planner:pfour');
    const seen = json(P.F.ok(P.F.old, ['dashboard-data'])).planners.find((x) => x.feature === 'pfour').last_seen;
    assert.equal(p.move, 'planning');
    assert.equal(p.holder, 'planner');
    assert.equal(p.since, seen);
    assert.deepEqual(p.covered_by.map((c) => c.kind), ['stale-planner', 'planner-gone', 'agent-exited', 'blocked-prompt']);
    assert.ok(p.covered_by.every((c) => c.subject === 'plan-pfour'));
  });
  await t.test('a message to the supervisor unanswered: the supervisor answers (P2)', () => {
    P.planner('ptwo', P.defined('Two'));
    P.F.ok(P.F.old, ['send', 'supervisor', 'design ready for review', '--kind', 'review-request'], planner('ptwo'));
    const p = P.need('planner:ptwo');
    assert.equal(p.move, 'answer-planner');
    assert.equal(p.holder, 'supervisor');
    assert.equal(p.ref.kind, 'm');
    assert.equal(p.command, 'send plan-ptwo "…" --kind ruling');
  });
  await t.test('waiting on an owner question: the owner (P1)', () => {
    const G = P.defined('One');
    P.planner('pone', G);
    const Q = P.ask(['--kind', 'goal-definition', '--goal', G, '--question', 'Which users first?']);
    const p = P.need('planner:pone');
    assert.equal(p.move, 'answer-question');
    assert.equal(p.holder, 'owner');
    assert.deepEqual(p.ref, { kind: 'q', id: Q });
  });
  await t.test('parked: quiet (P3)', () => {
    P.planner('pthree', P.defined('Three'));
    P.F.ok(P.F.old, ['phase', 'parked', '--note', 'parked'], planner('pthree'));
    const p = P.need('planner:pthree');
    assert.equal(p.move, 'parked');
    assert.equal(p.quiet, 'hold');
    assert.equal(p.flag, null);
  });
});

test('next-moves: flags come from holder and age alone, with the two settings', async (t) => {
  await t.test('the settings: defaults 60 and 24, on the Settings page', () => {
    const P = project('flag-defaults');
    const rows = json(P.F.ok(P.F.old, ['dashboard-data'])).settings_all;
    for (const [key, value] of [['next_move_owed_minutes', 60], ['next_move_stall_hours', 24]]) {
      const r = rows.find((x) => x.key === key) ?? assert.fail(`${key} is on the Settings page`);
      assert.equal(r.value, value);
      assert.equal(r.default, value);
      assert.equal(r.group, 'Questions and findings');
      assert.equal(r.shown, 'value');
    }
    const G = P.gappy('Fresh');
    const m = goalMove(P, G);
    assert.equal(m.flag, null, 'a fresh supervisor move is not owed yet');
    assert.equal(m.rung, 0);
  });
  await t.test('past next_move_owed_minutes: a supervisor move is owed, an owner\'s and a quiet one are not', () => {
    const P = project('flag-owed', { next_move_owed_minutes: 0 });
    const S = P.gappy('Owed');
    const O = P.gappy('Asked');
    P.ask(['--kind', 'goal-definition', '--goal', O, '--question', 'What is Asked for?']);
    const H = P.defined('Held');
    P.owner(['goal', 'hold', H, 'park', '--owner']);
    const s = P.raw(`goal:${S}`);
    assert.equal(s.flag, 'owed');
    assert.equal(s.rung, 1);
    assert.equal(P.raw(`goal:${O}`).flag, null, 'the owner never owes');
    assert.equal(P.raw(`goal:${H}`).flag, null, 'quiet');
    P.moves();
  });
  await t.test('past next_move_stall_hours: any holder\'s move is stalled, a quiet one never', () => {
    const P = project('flag-stalled', { next_move_stall_hours: 0 });
    const O = P.gappy('Asked long ago');
    P.ask(['--kind', 'goal-definition', '--goal', O, '--question', 'What is it for?']);
    const H = P.defined('Held long');
    P.owner(['goal', 'hold', H, 'park', '--owner']);
    const o = P.raw(`goal:${O}`);
    assert.equal(o.holder, 'owner');
    assert.equal(o.flag, 'stalled');
    assert.equal(o.rung, 2);
    assert.equal(P.raw(`goal:${H}`).flag, null, 'quiet');
    P.moves();
  });
  await t.test('past both: a supervisor move is stalled at rung 2, not owed', () => {
    const P = project('flag-both', { next_move_owed_minutes: 0, next_move_stall_hours: 0 });
    const S = P.gappy('Owed and stalled');
    const s = P.raw(`goal:${S}`);
    assert.equal(s.holder, 'supervisor');
    assert.equal(s.flag, 'stalled');
    assert.equal(s.rung, 2);
    P.moves();
  });
  await t.test('a fleet drain with nothing of the goal running: quiet (G3)', () => {
    const P = project('fleet-drain');
    P.sup(['act', '--class', 'drain', '--what', 'draining for a move']);
    const G = P.defined('Under a fleet drain');
    const m = goalMove(P, G);
    assert.equal(m.move, 'draining');
    assert.equal(m.quiet, 'drain');
    assert.equal(m.flag, null);
  });
});

test('next-moves: the rows and collectMetrics share the predicates', () => {
  const body = (name) => {
    const at = SRC.indexOf(`\nfunction ${name}(`);
    assert.ok(at >= 0, `function ${name} is in devteam.mjs`);
    return SRC.slice(at, SRC.indexOf('\n}\n', at));
  };
  const region = SRC.slice(SRC.indexOf('/* next-moves start */'), SRC.indexOf('/* next-moves end */'));
  const metrics = body('collectMetrics');
  // goal-at-target's quiet rule, and idle planning (which asks needsFeatures of a ready goal)
  for (const [helper, caller] of [['goalAtTargetQuiet', metrics], ['idlePlanningGoals', metrics], ['needsFeatures', body('idlePlanningGoals')]]) {
    assert.ok(region.includes(`function ${helper}(`), `${helper} is defined with the rows`);
    assert.ok(caller.includes(`${helper}(`), `the finding's code calls ${helper}`);
    assert.ok(body('goalMovesNow').includes(`${helper}(`), `the goal rows call ${helper}`);
  }
});

test('next-moves: each check this file names is a real test of its own, and no fixture or comment names one', () => {
  const name = new RegExp(`next-moves ${'A'}\\d+:`);
  const own = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const lines = own.split('\n');
  const named = lines.filter((l) => name.test(l));
  assert.ok(named.length >= 6, `${named.length} lines name a check`);
  for (const l of named) assert.match(l, new RegExp(`^test\\('next-moves ${'A'}\\d+: .+', (async )?\\(t?\\) => \\{$`), `a check is named only as a test's own name, never skipped: ${l}`);
  const fix = path.join(here, 'fixtures', 'next-moves-goal-rows');
  for (const f of fs.existsSync(fix) ? fs.readdirSync(fix, { recursive: true }) : []) {
    const p = path.join(fix, String(f));
    if (fs.statSync(p).isFile()) assert.doesNotMatch(fs.readFileSync(p, 'utf8'), name, `${f} names no check`);
  }
});
