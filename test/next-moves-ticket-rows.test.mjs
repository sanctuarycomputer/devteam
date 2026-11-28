// The ticket rows of the next-move table (kit-289): for every active, unmerged ticket one move, the
// first row that matches (T1 to T14, T2b after T3); a ticket waiting on a dependency copies its move
// (via); a ready goal with open tickets copies its lead ticket's (G16), flag and all. moves prints
// them grouped by holder, status under each running goal. Fixture projects drive the real CLI; every
// move is held to next-move@1's shape (the checker is kit-287's, as kit-288's goal-rows test copies it).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fleetFixture, hasTmux, json, write } from './lib/kit.mjs';

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

// A worker's phase line, as its session logs it.
const phase = (P, id, to, extra = []) => P.F.ok(P.F.old, ['phase', to, ...extra], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: id });
const ticketMove = (P, id) => P.move(`ticket:${id}`) ?? assert.fail(`ticket:${id} has a move`);
// a ready goal with one feature, and tickets on it (each depending on what deps says)
function readyGoal(P, title, slug) {
  const G = P.ready(title);
  P.feature(slug, G);
  return G;
}
const addTicket = (P, id, feature, extra = {}) => P.sup(['ticket', 'add', id, '--json', JSON.stringify({ title: `Ticket ${id}`, feature, component: 'ch', kind: 'build', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: [`${id}/**`], done_when: ['its check passes in CI'], ...extra })]);
// the supervisor's hold on a ticket, for a cause the kit can't follow, looked at again in a week
const hold = (P, id, reason) => P.sup(['ticket', 'hold', id, '--reason', reason, '--for', 'external:the-vendor', '--until', new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)]);
const lastAt = (P, id) => json(P.F.ok(P.F.old, ['log', '--by', id, '--json'])).filter((l) => l.type === 'phase').map((l) => l.created_at).sort().at(-1);

test('next-moves A13: ticket rows: waits, start, the owner, merge, resume, blocked on a dependency, can\'t start, and held', async (t) => {
  const P = project('a13', { max_active_tickets: 5, next_move_owed_minutes: 0 });
  readyGoal(P, 'Rows', 'rows');
  await t.test('waiting on an unmerged dependency: waits for it (T9), via its move, since the ticket line', () => {
    addTicket(P, 'ch-01-first', 'rows');
    addTicket(P, 'ch-02-after', 'rows', { depends_on: ['ch-01-first'] });
    const dep = ticketMove(P, 'ch-01-first');
    const m = ticketMove(P, 'ch-02-after');
    assert.equal(m.move, 'waits-for-ticket');
    assert.equal(m.words, 'Waits for ch-01-first to merge');
    assert.equal(m.via, 'ticket:ch-01-first');
    assert.deepEqual(m.ref, { kind: 'ticket', id: 'ch-01-first' });
    assert.equal(m.holder, dep.holder);
    assert.equal(m.title, 'Ticket ch-02-after');
    assert.equal(m.since, json(P.F.ok(P.F.old, ['ticket', 'show', 'ch-02-after'])).created_at);
  });
  await t.test('ready, with a free slot: start a worker (T13), covered by idle-capacity', () => {
    const m = ticketMove(P, 'ch-01-first');
    assert.equal(m.move, 'start-worker');
    assert.equal(m.holder, 'supervisor');
    assert.equal(m.words, 'Start a worker');
    assert.equal(m.command, 'worker ch-01-first');
    assert.deepEqual(m.covered_by, [{ kind: 'idle-capacity', subject: '*' }]);
  });
  await t.test('named in an open question\'s blocks: the owner\'s (T3)', () => {
    addTicket(P, 'ch-03-asked', 'rows');
    const Q = P.ask(['--blocks', 'ch-03-asked', '--question', 'Which way for ch-03?', '--recommendation', 'left']);
    const m = ticketMove(P, 'ch-03-asked');
    assert.equal(m.move, 'answer-question');
    assert.equal(m.holder, 'owner');
    assert.deepEqual(m.ref, { kind: 'q', id: Q });
    assert.deepEqual(m.covered_by, [{ kind: 'blocked-on-owner', subject: 'ch-03-asked' }, { kind: 'owner-question-waiting', subject: Q }]);
  });
  await t.test('held, no open question naming it: the supervisor\'s (T2b), never owed; with one open, the owner\'s (T3 first)', () => {
    addTicket(P, 'ch-04-held', 'rows');
    hold(P, 'ch-04-held', 'waits for the vendor');
    const m = P.raw('ticket:ch-04-held');
    assert.equal(m.move, 'held');
    assert.equal(m.holder, 'supervisor');
    assert.equal(m.words, 'Held: waits for the vendor. Release it, or ask');
    assert.equal(m.command, 'ticket release ch-04-held --reason "…"');
    assert.equal(m.flag, null, 'a hold is never owed, even past next_move_owed_minutes (0 here)');
    const Q = P.ask(['--blocks', 'ch-04-held', '--question', 'Still wanted?', '--recommendation', 'yes']);
    const o = ticketMove(P, 'ch-04-held');
    assert.equal(o.move, 'answer-question');
    assert.equal(o.holder, 'owner');
    assert.deepEqual(o.ref, { kind: 'q', id: Q });
  });
  await t.test('done and unmerged: merge it (T4)', () => {
    addTicket(P, 'ch-05-done', 'rows');
    phase(P, 'ch-05-done', 'done');
    const m = ticketMove(P, 'ch-05-done');
    assert.equal(m.move, 'merge-it');
    assert.equal(m.holder, 'supervisor');
    assert.equal(m.command, 'merge ch-05-done');
  });
  await t.test('parked under a running goal: resume it (T7), covered by parked-under-run', () => {
    addTicket(P, 'ch-06-parked', 'rows');
    phase(P, 'ch-06-parked', 'build');
    phase(P, 'ch-06-parked', 'parked', ['--note', 'parked']);
    const m = ticketMove(P, 'ch-06-parked');
    assert.equal(m.move, 'resume');
    assert.equal(m.holder, 'supervisor');
    assert.equal(m.command, 'worker ch-06-parked --resume');
    assert.deepEqual(m.covered_by, [{ kind: 'parked-under-run', subject: 'ch-06-parked' }]);
  });
  await t.test('parked under a draining goal: resume it too (T7), covered by parked-under-run', () => {
    const D = readyGoal(P, 'Draining', 'drained');
    addTicket(P, 'ch-16-drained', 'drained');
    phase(P, 'ch-16-drained', 'build');
    phase(P, 'ch-16-drained', 'parked', ['--note', 'parked']);
    P.owner(['goal', 'hold', D, 'drain', '--owner', '--reason', 'finishing up']);
    const m = ticketMove(P, 'ch-16-drained');
    assert.equal(m.move, 'resume');
    assert.equal(m.command, 'worker ch-16-drained --resume');
    assert.deepEqual(m.covered_by, [{ kind: 'parked-under-run', subject: 'ch-16-drained' }]);
  });
  await t.test('blocked with only an unmerged dependency and no message: waits for it (T9), not T6', () => {
    addTicket(P, 'ch-07-blocked', 'rows', { depends_on: ['ch-01-first'] });
    phase(P, 'ch-07-blocked', 'blocked');
    const m = ticketMove(P, 'ch-07-blocked');
    assert.equal(m.move, 'waits-for-ticket');
    assert.equal(m.via, 'ticket:ch-01-first');
  });
  await t.test('blocked with its message unanswered: answer its message (T6)', () => {
    P.F.ok(P.F.old, ['send', 'supervisor', 'which file?', '--kind', 'blocked'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'ch-07-blocked' });
    const m = ticketMove(P, 'ch-07-blocked');
    assert.equal(m.move, 'answer-message');
    assert.equal(m.holder, 'supervisor');
    assert.equal(m.ref.kind, 'm');
    assert.ok(m.covered_by.some((c) => c.kind === 'unanswered-message' && c.subject === m.ref.id));
  });
  await t.test('not schedulable (a final review on its branch): can\'t start (T10)', () => {
    addTicket(P, 'ch-08-review', 'rows');
    const { g, old } = P.F;
    g(['checkout', '-q', '-b', 'ticket/ch-08-review'], old);
    write(path.join(old, 'docs/devteam/project/tickets/ch-08-review/reviews/final-1.md'), '# final\n\n- Reviewer: r\n- Date: 2026-11-23\n\nVerdict: APPROVE 0000000000000000000000000000000000000000\n');
    g(['add', '-A', 'docs/devteam/project/tickets'], old);
    g(['commit', '-qm', 'ch-08-review: final'], old);
    g(['checkout', '-q', 'main'], old);
    const m = ticketMove(P, 'ch-08-review');
    assert.equal(m.move, 'cant-start');
    assert.equal(m.words, "Can't start: in review");
    assert.equal(m.holder, 'supervisor');
  });
});

test('next-moves A5: the lead ticket: a goal takes its move, via it, flag and all; awaiting the word beats building', async (t) => {
  const P = project('a5', { next_move_owed_minutes: 0, max_active_tickets: 5 });
  const G = readyGoal(P, 'Lead', 'lead');
  addTicket(P, 'ch-11-build', 'lead');
  addTicket(P, 'ch-12-word', 'lead');
  phase(P, 'ch-11-build', 'build');
  phase(P, 'ch-12-word', 'spec');
  await t.test('both in flight: the furthest along leads (build before spec)', () => {
    const m = goalMove(P, G);
    assert.equal(m.via, 'ticket:ch-11-build');
    assert.equal(m.move, 'build');
    assert.equal(m.holder, 'worker');
    assert.equal(m.title, 'Lead', 'the goal keeps its own title');
  });
  await t.test('one awaiting the word: it leads (the supervisor owes it), and the goal carries its flag', () => {
    phase(P, 'ch-12-word', 'awaiting-word');
    const tk = ticketMove(P, 'ch-12-word');
    const m = goalMove(P, G);
    assert.equal(m.via, 'ticket:ch-12-word');
    assert.equal(m.move, 'give-word');
    assert.equal(tk.flag, 'owed', 'owed past next_move_owed_minutes (0 here)');
    for (const k of ['holder', 'since', 'flag', 'rung', 'words']) assert.equal(m[k], tk[k], `the goal's move carries the ticket's ${k}`);
  });
  await t.test('an Upkeep chore ticket\'s T13 and T8 moves list recurring-stuck on its job; another ticket\'s don\'t', () => {
    P.sup(['ticket', 'add', 'ch-13-recurring-tidy', '--json', JSON.stringify({ title: 'Tidy', feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['tidy/**'], done_when: ['the tidy job runs clean'] })]);
    const stuck = { kind: 'recurring-stuck', subject: 'recurring:tidy' };
    const ready = ticketMove(P, 'ch-13-recurring-tidy');
    assert.equal(ready.move, 'start-worker');
    assert.deepEqual(ready.covered_by, [{ kind: 'idle-capacity', subject: '*' }, stuck]);
    phase(P, 'ch-13-recurring-tidy', 'build');
    const built = ticketMove(P, 'ch-13-recurring-tidy');
    assert.equal(built.move, 'build');
    assert.ok(built.covered_by.some((c) => c.kind === stuck.kind && c.subject === stuck.subject), JSON.stringify(built.covered_by));
    assert.ok(!ticketMove(P, 'ch-11-build').covered_by.some((c) => c.kind === 'recurring-stuck'), 'a ticket that runs no job lists none');
  });
});

// A worker that isn't alive holds nothing: with its tmux session up, a phase in flight whose window is
// gone or whose agent is back at a shell is the supervisor's resume-worker (T8b), since its last line;
// awaiting the word with its window gone, the word is still the supervisor's (T5), and says it must be
// resumed to receive it. A missing session is a reboot (every other fixture here): T8 as before.
test('next-moves: a dead worker\'s move is the supervisor\'s to resume it', { skip: !hasTmux && 'no tmux' }, async (t) => {
  const P = project('dead-worker', { tmux_session: 'nm-dead-worker', max_active_tickets: 5 });
  const tmux = (args) => spawnSync('tmux', args, { env: P.F.env() });
  tmux(['new-session', '-d', '-s', 'nm-dead-worker', '-n', 'main', 'sleep 600']);
  const window = (id, cmd) => tmux(['new-window', '-d', '-t', '=nm-dead-worker:', '-n', id, cmd]);
  const G = readyGoal(P, 'Dead workers', 'dead');
  const lastSeen = (id) => json(P.F.ok(P.F.old, ['log', '--by', id, '--json'])).map((l) => l.created_at).sort().at(-1);
  await t.test('building, its window gone: resume-worker, the supervisor\'s, uncovered', () => {
    addTicket(P, 'ch-71-gone', 'dead');
    phase(P, 'ch-71-gone', 'build');
    const m = ticketMove(P, 'ch-71-gone');
    assert.equal(m.move, 'resume-worker');
    assert.equal(m.holder, 'supervisor');
    assert.equal(m.command, 'worker ch-71-gone --resume');
    assert.match(m.words, /its window is gone/);
    assert.equal(m.since, lastSeen('ch-71-gone'));
    assert.deepEqual(m.covered_by, []);
    assert.equal(goalMove(P, G).via, 'ticket:ch-71-gone', 'the supervisor\'s move leads the goal');
  });
  await t.test('building, its agent back at a shell: resume-worker', () => {
    addTicket(P, 'ch-72-exited', 'dead');
    phase(P, 'ch-72-exited', 'build');
    window('ch-72-exited', 'bash');
    const m = ticketMove(P, 'ch-72-exited');
    assert.equal(m.move, 'resume-worker');
    assert.match(m.words, /its agent exited/);
  });
  await t.test('building in a live window: the worker\'s phase (T8)', () => {
    addTicket(P, 'ch-73-alive', 'dead');
    phase(P, 'ch-73-alive', 'build');
    window('ch-73-alive', 'sleep 600');
    const m = ticketMove(P, 'ch-73-alive');
    assert.equal(m.move, 'build');
    assert.equal(m.holder, 'worker');
  });
  await t.test('awaiting the word, its window gone: give the word (T5), resuming it first', () => {
    addTicket(P, 'ch-74-word', 'dead');
    phase(P, 'ch-74-word', 'awaiting-word');
    const m = ticketMove(P, 'ch-74-word');
    assert.equal(m.move, 'give-word');
    assert.equal(m.holder, 'supervisor');
    assert.match(m.words, /^Give the word, or merge; resume it first, its window is gone$/);
  });
});

test('next-moves: a held ticket turns stalled after next_move_stall_hours, never owed', () => {
  const P = project('held-stall', { next_move_owed_minutes: 0, next_move_stall_hours: 0 });
  readyGoal(P, 'Held long', 'heldlong');
  addTicket(P, 'ch-21-held', 'heldlong');
  hold(P, 'ch-21-held', 'waits');
  const m = ticketMove(P, 'ch-21-held');
  assert.equal(m.move, 'held');
  assert.equal(m.flag, 'stalled');
  assert.equal(m.rung, 2);
});

test('next-moves: every ticket and planner move carries its title', () => {
  const P = project('titles');
  const G = readyGoal(P, 'Titled', 'titled');
  addTicket(P, 'ch-31-titled', 'titled', { title: 'A ticket with a title' });
  P.planner('later', G);
  assert.equal(ticketMove(P, 'ch-31-titled').title, 'A ticket with a title');
  assert.equal(P.need('planner:later').title, 'Feature later');
});

test('next-moves: a phase\'s since is the first line of its run, through liveness pings', () => {
  const P = project('since');
  readyGoal(P, 'Since', 'since');
  addTicket(P, 'ch-41-since', 'since');
  phase(P, 'ch-41-since', 'spec');
  phase(P, 'ch-41-since', 'build');
  const first = lastAt(P, 'ch-41-since');
  sleep(20);
  phase(P, 'ch-41-since', 'build', ['--task', 'T2']);
  sleep(20);
  phase(P, 'ch-41-since', 'build');
  const m = ticketMove(P, 'ch-41-since');
  assert.equal(m.since, first, 'the pings after it keep the first line\'s time');
  const row = json(P.F.ok(P.F.old, ['dashboard-data'])).tickets.find((r) => r.id === 'ch-41-since');
  assert.ok(row, 'the ticket is on the board');
  phase(P, 'ch-41-since', 'verify');
  assert.equal(ticketMove(P, 'ch-41-since').since, lastAt(P, 'ch-41-since'), 'a new phase starts a new run');
});

test('next-moves: moves groups by holder, oldest first, and --holder lists only that holder\'s', () => {
  const P = project('text', { max_active_tickets: 5 });
  readyGoal(P, 'Text', 'text');
  addTicket(P, 'ch-51-older', 'text');
  sleep(1100);
  addTicket(P, 'ch-52-newer', 'text');
  addTicket(P, 'ch-53-work', 'text');
  phase(P, 'ch-53-work', 'build');
  const text = P.F.ok(P.F.old, ['moves']);
  const lines = text.split('\n');
  const head = (h) => lines.indexOf(`${h}:`);
  assert.ok(head('supervisor') >= 0 && head('worker') >= 0, text);
  const older = lines.findIndex((l) => l.includes('ticket:ch-51-older'));
  const newer = lines.findIndex((l) => l.includes('ticket:ch-52-newer'));
  assert.ok(head('supervisor') < older && older < newer, `oldest first under supervisor:\n${text}`);
  assert.ok(lines.findIndex((l) => l.includes('ticket:ch-53-work')) > head('worker'), text);
  const sup = P.F.ok(P.F.old, ['moves', '--holder', 'supervisor']);
  assert.ok(sup.includes('ticket:ch-51-older') && !sup.includes('ticket:ch-53-work') && !/^worker:/m.test(sup), sup);
  const js = json(P.F.ok(P.F.old, ['moves', '--holder', 'supervisor', '--json'])).moves;
  assert.ok(js.length > 0 && js.every((m) => m.holder === 'supervisor'));
});

test('next-moves: status prints each running goal\'s move under it, and /api/data and goal views carry the table\'s', () => {
  const P = project('places');
  const G = readyGoal(P, 'Shown', 'shown');
  addTicket(P, 'ch-61-shown', 'shown');
  phase(P, 'ch-61-shown', 'build');
  const H = readyGoal(P, 'Hidden', 'hidden');
  addTicket(P, 'ch-62-hidden', 'hidden');
  P.owner(['goal', 'hold', H, 'park', '--owner']);
  const status = P.F.ok(P.F.old, ['status']).split('\n');
  const at = status.findIndex((l) => /^goal\s/.test(l) && l.includes(G) && l.includes('Shown'));
  assert.ok(at >= 0, status.join('\n'));
  assert.match(status[at + 1], /^\s+next: worker {2}Building {2}\d+ min/);
  assert.ok(P.move(`goal:${H}`), 'the parked goal has a move');
  assert.ok(!status.some((l) => l.includes(H)), `a parked goal isn't running, so status leaves it out:\n${status.join('\n')}`);
  assert.match(P.F.ok(P.F.old, ['help']), /status \[--json\].*status also prints each running goal with its next move under it/, 'help says so');
  const moves = P.moves();
  const d = json(P.F.ok(P.F.old, ['dashboard-data']));
  const bySubject = (xs) => Object.fromEntries(xs.map((m) => [m.subject, { ...m, since: undefined }]));
  assert.deepEqual(bySubject(d.next_moves), bySubject(moves));
  const view = d.ooda.goals.find((g) => g.id === G);
  assert.ok(view.next_move, 'the dashboard goal view has a move');
  assert.equal(view.next_move.via, 'ticket:ch-61-shown');
  assert.ok(P.goal(G).next_move, 'the goal view has a move');
  assert.equal(P.goal(G).next_move.via, 'ticket:ch-61-shown');
});

test('next-moves: each check this file names is a real test of its own, and no fixture or comment names one', () => {
  const name = new RegExp(`next-moves ${'A'}\\d+:`);
  const own = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const named = own.split('\n').filter((l) => name.test(l));
  assert.equal(named.length, 2, named.join('\n'));
  for (const l of named) assert.match(l, new RegExp(`^test\\('next-moves ${'A'}\\d+: .+', (async )?\\(t?\\) => \\{$`), `a check is named only as a test's own name, never skipped: ${l}`);
  const fix = path.join(here, 'fixtures', 'next-moves-ticket-rows');
  for (const f of fs.existsSync(fix) ? fs.readdirSync(fix, { recursive: true }) : []) {
    const p = path.join(fix, String(f));
    if (fs.statSync(p).isFile()) assert.doesNotMatch(fs.readFileSync(p, 'utf8'), name, `${f} names no check`);
  }
});
