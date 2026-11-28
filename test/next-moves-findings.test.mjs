// The move findings of the next-move table (kit-290): move-owed, move-stalled and no-next-move,
// raised by collectMetrics from nextMoves() after every other finding, only on a move's own subject
// (never a quiet or a copied one), and never while a finding the move's covered_by names is raised;
// and the hub's cache, run/cache/next-moves.json, written by every metrics run and again as
// observe-metrics' last step. Fixture projects drive the real CLI; the cover rule is also run on its
// own, loaded from devteam.mjs under node:vm (as test/credentials.test.mjs loads parseArgs), so a
// finding no kit raises yet (goal-work-merged) can be passed in as raised.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fleetFixture, hasTmux, json, sessionOf, write } from './lib/kit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DT = path.join(here, '..', 'docs', 'devteam', 'scripts', 'devteam.mjs');
const SRC = fs.readFileSync(DT, 'utf8');

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const first = (s) => s.split('\n')[0].trim();
const MOVE_KINDS = ['move-owed', 'move-stalled', 'no-next-move'];
const projects = [];
after(() => { for (const p of projects) p.F.done(); });

// moveFindings(moves, raised, now), alone: the function's own text from devteam.mjs, run in an
// empty context, so it can use nothing but its arguments and the language's own globals
function loadMoveFindings() {
  const i = SRC.indexOf('\nfunction moveFindings(');
  assert.ok(i >= 0, 'devteam.mjs defines moveFindings');
  const j = SRC.indexOf('\n}\n', i);
  const fn = vm.runInContext(`${SRC.slice(i, j + 2)}\n;moveFindings`, vm.createContext({}));
  // its arrays are the context's own: plain JSON again, so deepEqual compares values
  return (...a) => JSON.parse(JSON.stringify(fn(...a)));
}
// a move as next-move@1 has it, for the function alone
const move = (o) => ({ subject: 'goal:g-1', move: 'ask-goal-met', words: 'Ask you whether it is met', holder: 'supervisor', ref: null, title: 'A goal', since: new Date(Date.now() - 2 * 3600000).toISOString(), command: 'ask --class goal-met --goal g-1 --recommendation yes', covered_by: [], quiet: null, via: null, flag: 'owed', rung: 1, ...o });

// A fixture project, with the settings given added to its settings block, and the steps the tests
// take on it through the CLI (as test/next-moves-ticket-rows.test.mjs has them).
function project(name, settings = {}) {
  const F = fleetFixture(`nmf-${name}`);
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
    gappy: (title) => first(sup(['goal', 'add', '--title', title])),
    defined: (title, { source = 'owner', check = 'cat gaps.txt', target = 0 } = {}) => {
      const measure = source === 'owner' ? ['--measure', 'the owner says it holds', '--target', '1', '--unit', 'attested', '--direction', 'up', '--source', 'owner', '--question', `Does ${title} hold?`]
        : source === 'none' ? ['--measure', 'gaps', '--target', '0', '--unit', 'gaps', '--direction', 'down']
          : ['--measure', 'gaps', '--target', String(target), '--unit', 'gaps', '--direction', 'down', '--source', source, '--check', check];
      const G = first(sup(['goal', 'add', '--title', title, '--outcome', `${title} holds`, ...measure, '--non-goals', 'none', '--preconditions', 'first part', 'second part', '--priority', String(++prio)]));
      if (source === 'repo') sup(['goal', 'reading', G, '--run']);
      return G;
    },
    ready: (title, opts = {}) => {
      const G = P.defined(title, opts);
      const ms = opts.source === 'repo' ? [{ title: 'all of it', target: opts.target ?? 0, preconditions: [1, 2], tickets: 2 }] : [{ title: 'all of it', target: 1, preconditions: [1, 2], tickets: 2 }];
      if (opts.source !== 'none') sup(['goal', 'set', G, '--milestones', JSON.stringify(ms)]);
      owner(['goal', 'decide', G, 'approve', '--force']);
      return G;
    },
    feature: (slug, G) => sup(['feature', 'add', slug, '--json', JSON.stringify({ title: `Feature ${slug}`, goals: [G], preconditions: [`${G}#1`, `${G}#2`], stories: [{ id: `${slug.toUpperCase()}-S1`, text: 'it works', release: 'v1.0.0' }] })]),
    ticket: (id, feature, extra = {}) => sup(['ticket', 'add', id, '--json', JSON.stringify({ title: `Ticket ${id}`, feature, component: 'ch', kind: 'build', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: [`${id}/**`], done_when: ['its check passes in CI'], ...extra })]),
    merge: (id) => {
      sleep(1005 - (Date.now() % 1000));
      g(['commit', '-q', '--allow-empty', '-m', `${id}: landed`], old);
      g(['push', '-q', 'origin', 'main'], old);
    },
    onMain: (file, text) => { write(path.join(old, file), text); g(['add', '-A'], old); g(['commit', '-qm', file], old); g(['push', '-q', 'origin', 'main'], old); },
    // a window for a session in the fixture's own tmux server (an agent stand-in: not a shell), so
    // the kit reads it as alive; false where there is no tmux
    window: (win) => {
      if (!hasTmux) return false;
      const s = sessionOf(old, `nmf-${name}`);
      const tmux = (args) => spawnSync('tmux', args, { env: F.env({}), encoding: 'utf8' });
      const r = tmux(['has-session', '-t', `=${s}`]).status === 0 ? tmux(['new-window', '-d', '-t', `=${s}:`, '-n', win, 'sleep 600']) : tmux(['new-session', '-d', '-s', s, '-n', win, 'sleep 600']);
      assert.equal(r.status, 0, r.stderr);
      return true;
    },
    planner: (f, G) => {
      g(['checkout', '-q', '-b', `plan/${f}`], old);
      write(path.join(old, `docs/devteam/project/log/plan-${f}.jsonl`), `${JSON.stringify({ v: 1, type: 'feature', op: 'new', id: f, title: `Feature ${f}`, goals: [G], stories: [{ id: 'PL-S1', text: 'it works', release: 'v1.0.0' }], at: new Date().toISOString(), by: `plan-${f}` })}\n`);
      g(['add', '-A', `docs/devteam/project/log/plan-${f}.jsonl`], old);
      g(['commit', '-qm', `plan ${f}`], old);
      g(['checkout', '-q', 'main'], old);
    },
    ask: (args) => first(sup(['ask', ...args])),
    phase: (id, to, extra = []) => ok(old, ['phase', to, ...extra], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: id }),
    moves: () => json(ok(old, ['moves', '--json'])).moves,
    move: (subject) => P.moves().find((m) => m.subject === subject) ?? assert.fail(`${subject} has a move`),
    metrics: () => json(ok(old, ['metrics', '--json'])),
    // the move findings metrics raises now, set aside ones included
    raised: () => { const m = P.metrics(); return [...m.findings, ...m.acknowledged].filter((x) => MOVE_KINDS.includes(x.kind)); },
    // the move findings raised on one move's subject
    on: (subject, all = P.raised()) => all.filter((x) => String(x.subject).startsWith(`${subject} `)),
  };
  projects.push(P);
  return P;
}

test('next-moves A8: quiet moves: holds, drains, the queue for a slot, never raise a finding', async (t) => {
  // owed and stalled at once: every move that isn't quiet raises one
  const P = project('a8', { next_move_owed_minutes: 0, next_move_stall_hours: 0, max_active_tickets: 1, max_active_planners: 1 });
  const parked = P.ready('Parked');
  P.owner(['goal', 'hold', parked, 'park', '--owner']);
  const letGo = P.ready('Let go');
  P.feature('letgo', letGo);
  P.ticket('ch-05-letgo', 'letgo');
  P.owner(['goal', 'decide', letGo, 'let-go']);
  const drained = P.ready('Drained');
  P.feature('drained', drained);
  P.ticket('ch-01-drained', 'drained');
  P.owner(['goal', 'hold', drained, 'drain', '--owner', '--reason', 'finishing up']);
  const running = P.ready('Running');
  P.feature('running', running);
  P.ticket('ch-02-building', 'running');
  P.phase('ch-02-building', 'build');
  P.ticket('ch-03-queued', 'running');
  const slotless = P.defined('Waits for a slot');
  P.planner('slottaker', P.defined('Takes the slot'));
  // a planner fills its slot only with its window open: a branch whose window is gone runs nothing
  const slotTaken = P.window('plan-slottaker');
  await t.test('each is quiet, with no flag: a park, a ticket under a let-go, a goal drain, the slot queue, the planner queue', () => {
    const want = { [`goal:${parked}`]: 'hold', 'ticket:ch-05-letgo': 'hold', [`goal:${drained}`]: 'drain', 'ticket:ch-01-drained': 'drain', 'ticket:ch-03-queued': 'queue', ...(slotTaken ? { [`goal:${slotless}`]: 'queue' } : {}) };
    for (const [s, q] of Object.entries(want)) {
      const m = P.move(s);
      assert.equal(m.quiet, q, `${s} is quiet (${q})`);
      assert.equal(m.flag, null, `${s} has no flag`);
    }
  });
  await t.test('none raises a move finding; a move that isn\'t quiet does', () => {
    const all = P.raised();
    for (const s of [`goal:${parked}`, 'ticket:ch-05-letgo', `goal:${drained}`, 'ticket:ch-01-drained', 'ticket:ch-03-queued', `goal:${slotless}`]) assert.deepEqual(P.on(s, all), [], `${s} raises nothing`);
    assert.equal(P.on('ticket:ch-02-building', all).length, 1, `the building ticket, not quiet, raises one: ${JSON.stringify(all)}`);
  });
  await t.test('a fleet drain: a goal with nothing running, a ticket not started and one parked are quiet and raise nothing', () => {
    P.ticket('ch-04-parked', 'running');
    P.phase('ch-04-parked', 'build');
    P.phase('ch-04-parked', 'parked', ['--note', 'parked']);
    P.sup(['act', '--class', 'drain', '--what', 'draining for a move']);
    const fresh = P.ready('Fresh in a drain');
    const all = P.raised();
    for (const [s, q] of [[`goal:${fresh}`, 'drain'], ['ticket:ch-03-queued', 'drain'], ['ticket:ch-04-parked', 'drain']]) {
      assert.equal(P.move(s).quiet, q, `${s} is quiet (${q})`);
      assert.deepEqual(P.on(s, all), [], `${s} raises nothing`);
    }
  });
  await t.test('the machine\'s memory full: a ready ticket and a defined draft wait in the queue, quiet, and raise nothing', () => {
    const Q = project('a8-memory', { next_move_owed_minutes: 0, next_move_stall_hours: 0 });
    const G = Q.ready('Memory');
    Q.feature('memory', G);
    Q.ticket('ch-06-memory', 'memory');
    const D = Q.defined('Waits for memory');
    // a 32 GiB container at 85%, over the default 80% ceiling (as test/memory-ceiling.test.mjs fakes it)
    const GB = 1024 ** 3;
    const cg = fs.mkdtempSync(path.join(Q.F.base, 'cgroup-'));
    fs.writeFileSync(path.join(cg, 'memory.max'), `${32 * GB}\n`);
    fs.writeFileSync(path.join(cg, 'memory.current'), `${Math.round(28.2 * GB)}\n`);
    fs.writeFileSync(path.join(cg, 'memory.stat'), `anon ${Math.round(27.2 * GB)}\nfile ${GB}\n`);
    const M = { DEVTEAM_CGROUP: cg, DEVTEAM_MEMINFO: path.join(Q.F.base, 'no-such-file') };
    const moves = json(Q.F.ok(Q.F.old, ['moves', '--json'], M)).moves;
    const m = json(Q.F.ok(Q.F.old, ['metrics', '--json'], M));
    assert.ok(m.findings.some((x) => x.kind === 'memory-full'), 'memory is full');
    const all = [...m.findings, ...m.acknowledged].filter((x) => MOVE_KINDS.includes(x.kind));
    for (const s of ['ticket:ch-06-memory', `goal:${D}`]) {
      const mv = moves.find((x) => x.subject === s) ?? assert.fail(`${s} has a move`);
      assert.equal(mv.quiet, 'queue', `${s} waits in the queue`);
      assert.deepEqual(Q.on(s, all), [], `${s} raises nothing`);
    }
  });
  await t.test('alone: a quiet move raises nothing, whatever its flag says', () => {
    const moveFindings = loadMoveFindings();
    for (const quiet of ['hold', 'drain', 'queue']) assert.deepEqual(moveFindings([move({ quiet })], []), [], `quiet ${quiet}`);
  });
});

test('next-moves A9: move-owed: a supervisor move past the hour, unless covered, never the owner\'s or a copied one', async (t) => {
  const P = project('a9', { next_move_owed_minutes: 0, max_active_tickets: 5 });
  let gappy;
  await t.test('a supervisor-held move past next_move_owed_minutes raises it, high, with the move\'s command', () => {
    const G = (gappy = P.gappy('Has gaps'));
    const m = P.move(`goal:${G}`);
    assert.equal(m.move, 'ask-definition');
    const f = P.on(`goal:${G}`);
    assert.equal(f.length, 1, JSON.stringify(f));
    assert.equal(f[0].kind, 'move-owed');
    assert.equal(f[0].severity, 'high');
    assert.equal(f[0].subject, `goal:${G} ask-definition:`);
    assert.equal(f[0].suggestion, m.command);
    assert.match(f[0].detail, /Ask you what's missing from its definition/);
  });
  await t.test('it is high, so wait returns on it, naming it', () => {
    const G = gappy;
    const out = P.sup(['wait', '--minutes', '1']);
    assert.match(out, /^high findings are open/m);
    assert.ok(out.split('\n').some((l) => l.includes(`move-owed goal:${G} ask-definition:`)), out);
  });
  await t.test('quiet while its covering finding is raised: goal-at-target on the goal id, and the flag stays owed', () => {
    P.onMain('gaps.txt', '0\n');
    const G = P.ready('At target', { source: 'repo' });
    const m = P.move(`goal:${G}`);
    assert.equal(m.move, 'ask-goal-met');
    assert.equal(m.flag, 'owed', 'a covered move keeps its flag');
    const all = P.metrics().findings;
    assert.ok(all.some((x) => x.kind === 'goal-at-target' && x.subject === G), 'goal-at-target is raised');
    assert.deepEqual(P.on(`goal:${G}`), [], 'no move-owed beside it');
  });
  await t.test('quiet while its covering finding is raised: idle-capacity on a count', () => {
    const G = P.ready('Has a ready ticket');
    P.feature('readyone', G);
    P.ticket('ch-11-ready', 'readyone');
    assert.equal(P.move('ticket:ch-11-ready').move, 'start-worker');
    assert.equal(P.move('ticket:ch-11-ready').flag, 'owed');
    assert.ok(P.metrics().findings.some((x) => x.kind === 'idle-capacity' && /ready/.test(x.subject)), 'idle-capacity is raised on a count');
    assert.deepEqual(P.on('ticket:ch-11-ready'), []);
    assert.deepEqual(P.on(`goal:${G}`), [], 'the goal copies the ticket\'s move (via), so it raises nothing either');
  });
  await t.test('quiet for an owner-held move: a goal-met question open (G4), and a measure change asked (G17b)', () => {
    const G = P.ready('Asked');
    const Q = P.ask(['--class', 'goal-met', '--goal', G, '--recommendation', 'yes']);
    assert.equal(P.move(`goal:${G}`).holder, 'owner');
    assert.deepEqual(P.on(`goal:${G}`), []);
    // read short of its target, so it isn't asked whether it is met (G12)
    const R = P.ready('Repo, change asked', { source: 'repo', check: 'echo 1' });
    P.feature('changed', R);
    P.ticket('ch-12-changed', 'changed');
    P.merge('ch-12-changed');
    P.sup(['goal', 'reading', R, '--run']);
    const C = P.ask(['--class', 'goal-change', '--goal', R, '--change', JSON.stringify({ measure: { description: 'gaps in the docs too' } }), '--question', 'Count the docs gaps too?', '--recommendation', 'Yes']);
    const m = P.move(`goal:${R}`);
    assert.equal(m.holder, 'owner');
    assert.deepEqual(m.ref, { kind: 'q', id: C });
    assert.deepEqual(P.on(`goal:${R}`), [], 'G17b is the owner\'s');
    assert.ok(Q);
  });
  await t.test('a copied move raises nothing of its own: the ticket owes it, the goal that copies it doesn\'t', () => {
    const G = P.ready('Lead owes');
    P.feature('leadowes', G);
    P.ticket('ch-13-done', 'leadowes');
    P.phase('ch-13-done', 'build');
    P.phase('ch-13-done', 'done');
    const gm = P.move(`goal:${G}`);
    assert.equal(gm.via, 'ticket:ch-13-done');
    assert.equal(gm.flag, 'owed', 'the goal carries the ticket\'s flag');
    const all = P.raised();
    assert.deepEqual(P.on(`goal:${G}`, all), []);
    assert.deepEqual(P.on('ticket:ch-13-done', all).map((x) => [x.kind, x.subject]), [['move-owed', 'ticket:ch-13-done merge-it:']]);
  });
  await t.test('the trigger case: an owner-read goal all merged raises move-owed alone, while no kit raises goal-work-merged', () => {
    const G = P.ready('Owner reads it');
    P.feature('ownerread', G);
    P.ticket('ch-14-one', 'ownerread');
    P.merge('ch-14-one');
    const m = P.move(`goal:${G}`);
    assert.equal(m.move, 'ask-goal-met');
    assert.deepEqual(m.covered_by, [{ kind: 'goal-work-merged', subject: G }]);
    // the trigger's findings: the move's own, and the one that would cover it; exactly one, and
    // while no kit raises goal-work-merged (S6), it is move-owed
    const about = P.metrics().findings.filter((x) => [...MOVE_KINDS, 'goal-work-merged'].includes(x.kind) && (String(x.subject) === G || String(x.subject).startsWith(`goal:${G} `)));
    assert.equal(about.length, 1, `one finding: ${JSON.stringify(about)}`);
    const own = about[0].kind === 'goal-work-merged' ? [['goal-work-merged', G]] : [['move-owed', `goal:${G} ask-goal-met:`]];
    assert.deepEqual(about.map((x) => [x.kind, x.subject]), own);
  });
  await t.test('alone: the trigger case with goal-work-merged raised on the goal id raises nothing; with none raised, move-owed alone', () => {
    const moveFindings = loadMoveFindings();
    const g = move({ covered_by: [{ kind: 'goal-work-merged', subject: 'g-1' }] });
    assert.deepEqual(moveFindings([g], [{ kind: 'goal-work-merged', subject: 'g-1' }]), []);
    assert.deepEqual(moveFindings([g], [{ kind: 'goal-work-merged', subject: 'g-2' }]).map((x) => x.kind), ['move-owed'], 'raised on another goal, it covers nothing');
    const out = moveFindings([g], []);
    assert.deepEqual(out.map((x) => [x.severity, x.kind, x.subject, x.suggestion]), [['high', 'move-owed', 'goal:g-1 ask-goal-met:', g.command]]);
  });
  await t.test('alone: unanswered-message on the m-id covers its move; on another message it doesn\'t', () => {
    const moveFindings = loadMoveFindings();
    const m = move({ subject: 'ticket:ch-1', move: 'answer-message', ref: { kind: 'm', id: 'm-1' }, covered_by: [{ kind: 'blocked', subject: 'ch-1' }, { kind: 'unanswered-message', subject: 'm-1' }] });
    assert.deepEqual(moveFindings([m], [{ kind: 'unanswered-message', subject: 'm-1' }]), []);
    assert.deepEqual(moveFindings([m], [{ kind: 'unanswered-message', subject: 'm-2' }]).map((x) => x.subject), ['ticket:ch-1 answer-message:m-1']);
    assert.deepEqual(moveFindings([move({ via: 'ticket:ch-1' })], []), [], 'a copied move, alone, raises nothing');
  });
});

test('next-moves A10: move-stalled: any move unchanged past next_move_stall_hours, through pings; an ack quiets it, a new ref brings it back', async (t) => {
  // nine seconds: well past what a subtest's own commands take on a loaded runner
  const P = project('a10', { next_move_stall_hours: 0.0025 });
  const G = P.ready('Building');
  P.feature('building', G);
  P.ticket('ch-21-build', 'building');
  P.phase('ch-21-build', 'build');
  await t.test('under the threshold: nothing', () => {
    assert.deepEqual(P.on('ticket:ch-21-build'), []);
  });
  await t.test('a worker whose phase run is past it raises it, high, though it pinged since', () => {
    sleep(9500);
    // a liveness ping: the same phase again, with a note, so it writes a line
    assert.doesNotMatch(P.phase('ch-21-build', 'build', ['--note', 'still building']), /unchanged/);
    const m = P.move('ticket:ch-21-build');
    assert.equal(m.flag, 'stalled');
    const f = P.on('ticket:ch-21-build');
    assert.deepEqual(f.map((x) => [x.severity, x.kind, x.subject]), [['high', 'move-stalled', 'ticket:ch-21-build build:']]);
    assert.match(f[0].suggestion, /pane/);
  });
  await t.test('ack with a reason quiets it', () => {
    P.sup(['ack', 'move-stalled', 'ticket:ch-21-build build:', '--reason', 'a long build, looked at']);
    const m = P.metrics();
    assert.ok(!m.findings.some((x) => x.kind === 'move-stalled' && x.subject === 'ticket:ch-21-build build:'), 'not in findings');
    assert.ok(m.acknowledged.some((x) => x.kind === 'move-stalled' && x.subject === 'ticket:ch-21-build build:'), 'set aside');
  });
  await t.test('the same move with a new ref is a new finding', () => {
    const ask = (text) => P.F.ok(P.F.old, ['send', 'supervisor', text, '--kind', 'design-change'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'ch-21-build' });
    const open = () => P.metrics().findings.filter((x) => x.kind === 'move-stalled' && String(x.subject).startsWith('ticket:ch-21-build answer-message:'));
    ask('which file?');
    sleep(9500);
    const m1 = P.move('ticket:ch-21-build');
    assert.equal(m1.move, 'answer-message');
    const [f1] = open();
    assert.ok(f1, 'its answer-message move is stalled');
    P.sup(['ack', 'move-stalled', f1.subject, '--reason', 'answering it']);
    assert.deepEqual(open(), [], 'set aside');
    P.sup(['send', 'ch-21-build', 'the README', '--kind', 'ruling', '--re', m1.ref.id]);
    ask('and which test?');
    sleep(9500);
    const m2 = P.move('ticket:ch-21-build');
    assert.equal(m2.move, 'answer-message');
    assert.notEqual(m2.ref.id, m1.ref.id, 'a new ref');
    assert.deepEqual(open().map((x) => x.subject), [`ticket:ch-21-build answer-message:${m2.ref.id}`], 'the new ref is raised again');
  });
});

test('next-moves A11: no-next-move: a state no row knows raises it, high', async (t) => {
  const P = project('a11');
  await t.test('a ready goal no row knows: no source, its work all merged (G20)', () => {
    const G = P.ready('Unread', { source: 'none' });
    P.feature('unread', G);
    P.ticket('ch-31-one', 'unread');
    P.merge('ch-31-one');
    assert.equal(P.move(`goal:${G}`).move, 'no-next-move');
    const f = P.on(`goal:${G}`);
    assert.deepEqual(f.map((x) => [x.severity, x.kind, x.subject]), [['high', 'no-next-move', `goal:${G} no-next-move:`]]);
    assert.match(f[0].suggestion, /knowledge add --kit/);
  });
  await t.test('a ticket in a phase no ticket row knows (T14)', () => {
    const G = P.ready('Odd phase');
    P.feature('odd', G);
    P.ticket('ch-32-odd', 'odd');
    P.phase('ch-32-odd', 'build');
    // a phase line the schema allows but no ticket row reads: the supervisor's own phase, on a ticket
    const live = path.join(P.F.old, 'docs/devteam/run/log');
    const file = fs.readdirSync(live).find((f) => fs.readFileSync(path.join(live, f), 'utf8').includes('"by":"ch-32-odd"'));
    const last = fs.readFileSync(path.join(live, file), 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l)).filter((l) => l.type === 'phase' && l.by === 'ch-32-odd').at(-1);
    sleep(5);
    const at = new Date().toISOString();
    fs.appendFileSync(path.join(live, file), `${JSON.stringify({ ...last, id: `${last.id.split('-')[0]}-${at.slice(0, 10).replace(/-/g, '')}-${at.slice(11, 23).replace(/[:.]/g, '')}-ch-32-odd`, at, from: 'build', to: 'supervisor' })}\n`);
    const m = P.move('ticket:ch-32-odd');
    assert.equal(m.move, 'no-next-move');
    assert.equal(m.holder, 'nobody');
    assert.deepEqual(P.on('ticket:ch-32-odd').map((x) => [x.severity, x.kind]), [['high', 'no-next-move']]);
  });
});

test('next-moves A12: output: moves, /api/data, goal views and status carry the table, and metrics writes the hub\'s cache', async (t) => {
  // owed at once, so the cache has a flag to carry (the draft's G6)
  const P = project('a12', { next_move_owed_minutes: 0 });
  const G = P.ready('Shown');
  P.feature('shown', G);
  P.ticket('ch-41-shown', 'shown');
  P.phase('ch-41-shown', 'build');
  P.ticket('ch-42-waits', 'shown', { depends_on: ['ch-41-shown'] });
  const D = P.gappy('A draft');
  P.planner('planned', P.defined('Being planned'));
  await t.test('moves --json: next_move 1, every running goal, active ticket and planner exactly once', () => {
    const out = json(P.F.ok(P.F.old, ['moves', '--json']));
    assert.equal(out.next_move, 1);
    const subjects = out.moves.map((m) => m.subject);
    assert.equal(new Set(subjects).size, subjects.length, `no subject twice: ${subjects.join(', ')}`);
    const goals = json(P.F.ok(P.F.old, ['goal', 'list', '--json'])).filter((g) => !['met', 'abandoned'].includes(g.status) && !/upkeep/i.test(g.title ?? '')).map((g) => `goal:${g.id}`);
    for (const s of [...goals, 'ticket:ch-41-shown', 'ticket:ch-42-waits', 'planner:planned']) assert.equal(subjects.filter((x) => x === s).length, 1, `${s} once in ${subjects.join(', ')}`);
    assert.ok(goals.includes(`goal:${D}`) && goals.includes(`goal:${G}`));
  });
  await t.test('/api/data next_moves and each goal view\'s next_move match it', () => {
    const moves = P.moves();
    const d = json(P.F.ok(P.F.old, ['dashboard-data']));
    const bySubject = (xs) => Object.fromEntries(xs.map((m) => [m.subject, { ...m, since: undefined }]));
    assert.deepEqual(bySubject(d.next_moves), bySubject(moves));
    for (const g of d.ooda.goals.filter((x) => moves.some((m) => m.subject === `goal:${x.id}`))) assert.deepEqual({ ...g.next_move, since: undefined }, { ...moves.find((m) => m.subject === `goal:${g.id}`), since: undefined }, g.id);
    assert.equal(json(P.F.ok(P.F.old, ['goal', 'show', G])).next_move.subject, `goal:${G}`);
  });
  await t.test('status prints each running goal\'s move', () => {
    const status = P.F.ok(P.F.old, ['status']).split('\n');
    for (const id of [G, D]) {
      const at = status.findIndex((l) => /^goal\s/.test(l) && l.includes(id));
      assert.ok(at >= 0, `${id} in status:\n${status.join('\n')}`);
      assert.match(status[at + 1], /^\s+next: \S+ {2}\S/);
    }
  });
  const cache = path.join(P.F.old, 'docs/devteam/run/cache/next-moves.json');
  await t.test('metrics writes run/cache/next-moves.json: next_move 1, its time, the goals\' moves', () => {
    fs.rmSync(cache, { force: true });
    const before = Date.now();
    P.metrics();
    const c = json(fs.readFileSync(cache, 'utf8'));
    assert.deepEqual(Object.keys(c).sort(), ['at', 'moves', 'next_move']);
    assert.equal(c.next_move, 1);
    assert.ok(Date.parse(c.at) >= before - 1000, c.at);
    const goalMoves = P.moves().filter((m) => m.subject.startsWith('goal:'));
    assert.deepEqual(c.moves.map((m) => m.subject).sort(), goalMoves.map((m) => m.subject).sort(), 'the goals\' moves, and only theirs');
    // each as the table has it, flag and all: the hub reads the flags from here
    const bySubject = (xs) => Object.fromEntries(xs.map((m) => [m.subject, m]));
    assert.deepEqual(bySubject(c.moves), bySubject(goalMoves), 'each move field by field');
    assert.equal(bySubject(c.moves)[`goal:${D}`]?.flag, 'owed', 'the draft\'s owed flag reaches the cache');
  });
  await t.test('observe-metrics writes it again as its last step: newer than every line the tick wrote', () => {
    fs.rmSync(cache, { force: true });
    P.sup(['observe-metrics']);
    const c = json(fs.readFileSync(cache, 'utf8'));
    const lines = json(P.F.ok(P.F.old, ['log', '--json']));
    const lastAt = lines.map((l) => l.created_at ?? l.at).filter(Boolean).sort().at(-1);
    assert.ok(c.at >= lastAt, `the cache (${c.at}) is newer than the last line (${lastAt})`);
    assert.ok(lines.some((l) => l.type === 'observation' && l.detector === 'metrics'), 'the tick wrote observations');
    // and nothing after it: its last statements are the fresh read and the write, after the
    // worktree tidy (which this fixture, with no finished worktree, writes nothing for)
    const i = SRC.indexOf('\nasync function cmdObserveMetrics(');
    const body = SRC.slice(i, SRC.indexOf('\n}\n', i));
    const tail = body.trimEnd().split('\n').filter((l) => !/^\s*\/\//.test(l)).slice(-3).map((l) => l.trim());
    assert.deepEqual(tail, ['tidyFinishedWorktrees();', 'logCache = null;', 'writeMovesCache();'], 'the cache is written last, after the tidy');
  });
  await t.test('the cache is no older than the newest line it read, though a line\'s time runs ahead of the clock', () => {
    // appendLog keeps each file's times increasing, so a busy file's next line can carry a time
    // past the clock; one a minute ahead stands in for it
    const live = path.join(P.F.old, 'docs/devteam/run/log');
    const file = fs.readdirSync(live).filter((f) => f.endsWith('.jsonl')).sort().at(-1);
    const obs = fs.readFileSync(path.join(live, file), 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l)).filter((l) => l.type === 'observation').at(-1) ?? assert.fail('an observation line to copy');
    const ahead = new Date(Date.now() + 60000).toISOString();
    fs.appendFileSync(path.join(live, file), `${JSON.stringify({ ...obs, id: `o-${ahead.slice(0, 10).replace(/-/g, '')}-${ahead.slice(11, 23).replace(/[:.]/g, '')}-${obs.by}`, at: ahead })}\n`);
    fs.rmSync(cache, { force: true });
    P.metrics();
    const c = json(fs.readFileSync(cache, 'utf8'));
    assert.ok(c.at >= ahead, `the cache (${c.at}) is no older than the line it read (${ahead})`);
  });
});

test('next-moves: idle-capacity reads the rows: a ticket its component\'s cap holds back isn\'t offered', () => {
  const P = project('capacity', { max_active_tickets: 5, max_active_per_component: 1 });
  const G = P.ready('Capped');
  P.feature('capped', G);
  P.ticket('ch-51-running', 'capped');
  P.phase('ch-51-running', 'build');
  P.ticket('ch-52-capped', 'capped');
  const m = P.move('ticket:ch-52-capped');
  assert.equal(m.move, 'waits-for-slot', 'its component is at its cap (T12)');
  const idle = P.metrics().findings.filter((x) => x.kind === 'idle-capacity');
  assert.deepEqual(idle.map((x) => x.subject), [], `idle-capacity offers nothing the rows hold back: ${JSON.stringify(idle)}`);
  P.ticket('ch-53-other', 'capped', { component: 'other' });
  assert.equal(P.move('ticket:ch-53-other').move, 'start-worker');
  assert.deepEqual(P.metrics().findings.filter((x) => x.kind === 'idle-capacity').map((x) => x.subject), ['1 ready'], 'a ticket the rows would start is offered');
});

test('next-moves: the tick reads the moves: supervisor.md §3 step 9 and planning.md\'s "Met is the owner\'s word"', () => {
  const doc = (p) => fs.readFileSync(path.join(here, '..', 'docs', 'devteam', 'process', p), 'utf8');
  const tick = doc('supervisor.md').split(/^## /m).find((s) => s.startsWith('3. The tick'));
  assert.ok(tick, 'supervisor.md has §3');
  const step9 = tick.split('\n').find((l) => /^9\. /.test(l));
  assert.ok(step9, '§3 has a step 9');
  assert.match(step9, /moves --holder supervisor/);
  const met = doc('planning.md').split('\n').find((l) => l.includes('Met is the owner\'s word'));
  assert.ok(met, 'planning.md has the paragraph');
  assert.match(met, /next-move table/);
});

test('next-moves: each check this file names is a real test of its own, and no fixture or comment names one', () => {
  const name = new RegExp(`next-moves ${'A'}\\d+:`);
  const own = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const named = own.split('\n').filter((l) => name.test(l));
  assert.deepEqual(named.map((l) => l.match(new RegExp(`next-moves ${'A'}(\\d+):`))[1]), ['8', '9', '10', '11', '12'], named.join('\n'));
  for (const l of named) assert.match(l, new RegExp(`^test\\('next-moves ${'A'}\\d+: .+', (async )?\\(t?\\) => \\{$`), `a check is named only as a test's own name, never skipped: ${l}`);
  const fix = path.join(here, 'fixtures', 'next-moves-findings');
  for (const f of fs.existsSync(fix) ? fs.readdirSync(fix, { recursive: true }) : []) {
    const p = path.join(fix, String(f));
    if (fs.statSync(p).isFile()) assert.doesNotMatch(fs.readFileSync(p, 'utf8'), name, `${f} names no check`);
  }
});
