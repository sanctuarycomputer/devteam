// kit-108: the supervisor starts its own thread about a question or goal (thread new --subject, run as
// the supervisor), with its own cap of 20 open; and a supervisor's or responder's turn nothing asked for
// (no owed owner turn, no open handoff, no --re to its own pending turn) names what it is about, on the
// thread's subject, or is refused. The dashboard labels such a thread as from the supervisor.
// Ports: none of its own (lib/kit.mjs's +0 hub, +1..25)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dashboardOnFreePort, until, threadsFixture } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { soonIn, POLL_FAST } from './lib/dashboard-page.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INCIDENT = path.join(HERE, 'fixtures/supervisor-thread/incident.jsonl');
const RESPONDER = { DEVTEAM_ROLE: 'responder' };
const WORKER = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'demo-01-x' };
const PLANNER = { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'demo' };
const T_ID = /^t-\d{8}-\d{9}-supervisor$/;
const REMEDIES = [/--refs/, /--re /, /thread new --subject/, /--off-subject/];

// every line of the live log, parsed
const logLines = (F) => fs.readdirSync(F.logDir).flatMap((f) => fs.readFileSync(path.join(F.logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const lineOf = (F, id) => logLines(F).find((o) => o.id === id && o.op === 'new');
const subjectOf = (ref) => JSON.stringify({ kind: 'item', ref });
const view = (F, t) => JSON.parse(F.owner(['thread', 'show', t, '--json']));
// a question asked by the supervisor, outside any thread
const askQ = (F, words) => F.sup(['ask', '--question', words, '--goal', F.goal, '--stake', '1', '--urgency', '1']);
// a supervisor-started thread about a question, its id
const supThread = (F, q, words = 'I recorded your answer; nothing more is needed.') => F.sup(['thread', 'new', '--subject', subjectOf(`question:${q}`), '--title', 'Your answer', '--', words]).split('\n')[0];
// an owner's thread about the goal, answered once by the supervisor, so nothing in it waits on the supervisor
function quietThread(F, title = 'Launch checkout') {
  const T = F.owner(['thread', 'new', 'Narrow this to the EU', '--title', title]).split('\n')[0];
  F.sup(['thread', 'reply', T, 'Noted.']);
  return T;
}

test('kit-108 A1: the supervisor starts a thread about a question: a thread line and a first turn by supervisor, its subject as the ref, nothing typed, the id printed', () => {
  const F = threadsFixture('sup-thread-a1');
  try {
    const Q = askQ(F, 'Keep daily sales totals?');
    const pane = F.standIn();
    const out = F.sup(['thread', 'new', '--subject', subjectOf(`question:${Q}`), '--title', 't', '--', 'I recorded your answer on sales.'], { DEVTEAM_SUPERVISOR: pane.target });
    const T = out.split('\n')[0];
    assert.match(T, T_ID, `the id first: ${out}`);
    const th = lineOf(F, T);
    assert.equal(th.type, 'thread');
    assert.equal(th.by, 'supervisor');
    assert.deepEqual(th.subject, { kind: 'item', ref: `question:${Q}` });
    const turns = logLines(F).filter((o) => o.type === 'turn' && o.thread === T);
    assert.equal(turns.length, 1, 'one first turn');
    assert.equal(turns[0].by, 'supervisor');
    assert.deepEqual(turns[0].refs, [`question:${Q}`], 'the subject as its ref');
    assert.equal(pane.typed(), '', 'nothing typed into any pane');
    const v = view(F, T);
    assert.equal(v.started_by, 'supervisor');
    assert.equal(v.waiting, 'owner');
    const show = F.owner(['thread', 'show', T]);
    assert.match(show, /The supervisor started this thread about/);
    assert.doesNotMatch(show, /what the owner pointed at/);
    // an owner's thread is still the owner's
    const O = F.owner(['thread', 'new', 'Hello', '--title', 'Mine']).split('\n')[0];
    assert.equal(view(F, O).started_by, 'owner');
    assert.match(F.owner(['thread', 'show', O]), /what the owner pointed at/);
  } finally { F.done(); }
});

test('kit-108 A2: the supervisor\'s thread new refuses with no subject, a subject that is not a question or goal item, or one not in the log', () => {
  const F = threadsFixture('sup-thread-a2');
  try {
    const go = (subject) => F.fails(['thread', 'new', ...(subject === undefined ? [] : ['--subject', subject]), '--title', 't', '--', 'words'], F.SUP);
    assert.match(go(undefined), /needs --subject/);
    assert.match(go(JSON.stringify({ kind: 'page', view: '#goals', at: { x: 0.5, y: 0.5 } })), /about a question or a goal/);
    assert.match(go(subjectOf('ticket:demo-01-x')), /about a question or a goal/);
    assert.match(go(subjectOf('question:q-20260101-000000000-supervisor')), /no question q-20260101-000000000-supervisor/);
    assert.match(go(subjectOf('goal:g-20260101-000000000-supervisor')), /no goal g-20260101-000000000-supervisor/);
    assert.match(F.fails(['thread', 'new', '--subject', subjectOf(`goal:${F.goal}`), '--title', 't', '--files', '[]', '--', 'words'], F.SUP), /--files go with the owner's own turn/);
    assert.equal(logLines(F).filter((o) => o.type === 'thread').length, 0, 'no thread written');
    // the owner's new and reopen take no --re or --off-subject
    assert.match(F.fails(['thread', 'new', 'Mine', '--off-subject', 'x']), /--re goes with a reply/);
    assert.match(F.fails(['thread', 'new', 'Mine', '--re', 'u-20260101-000000000-supervisor']), /--re goes with a reply/);
    const R = F.owner(['thread', 'new', 'Resolved one', '--title', 'R']).split('\n')[0];
    F.owner(['thread', 'resolve', R]);
    assert.match(F.fails(['thread', 'reopen', R, '--re', 'u-20260101-000000000-supervisor']), /--re goes with a reply/);
    assert.match(F.fails(['thread', 'reopen', R, '--off-subject', 'x']), /--re goes with a reply/);
    // a goal that exists is a subject too
    assert.match(F.sup(['thread', 'new', '--subject', subjectOf(`goal:${F.goal}`), '--title', 'g', '--', 'About the goal.']).split('\n')[0], T_ID);
  } finally { F.done(); }
});

test('kit-108 A3: 20 open supervisor-started threads cap its thread new, naming the oldest; the owner\'s count ignores them; the owner reopens one past the cap', () => {
  const F = threadsFixture('sup-thread-a3');
  try {
    const Q = askQ(F, 'Which region?');
    // 20 open threads the supervisor started, hand-written oldest first
    const ids = [];
    for (let i = 0; i < 20; i++) {
      const t = F.hand('supervisor', { type: 'thread', title: `mine ${i}`, subject: { kind: 'item', ref: `question:${Q}` } }, 3600000 - i * 1000);
      F.hand('supervisor', { type: 'turn', thread: t, text: `note ${i}`, refs: [`question:${Q}`] }, 3600000 - i * 1000 - 1);
      ids.push(t);
    }
    const Q2 = askQ(F, 'Which currency?');
    const said = F.fails(['thread', 'new', '--subject', subjectOf(`question:${Q2}`), '--title', 't', '--', 'words'], F.SUP);
    assert.match(said, /20 threads you started are open/);
    assert.ok(said.includes(ids[0]), `names the oldest: ${said}`);
    // the owner's thread new is not crowded
    const O = F.owner(['thread', 'new', 'Mine', '--title', 'Mine']).split('\n')[0];
    assert.match(O, /^t-.*-owner$/);
    // the owner resolves one of the supervisor's, the supervisor starts one (19 + 1), then the owner reopens the first past the cap
    F.owner(['thread', 'resolve', ids[0]]);
    supThread(F, Q2);
    assert.match(F.owner(['thread', 'reopen', ids[0], 'Back to this']), /reopened/);
    assert.equal(view(F, ids[0]).status, 'open');
  } finally { F.done(); }
});

test('kit-108 A3b: THREAD_OPEN_MAX counts only the owner\'s threads: 200 open supervisor threads leave the owner\'s thread new and reopen alone', () => {
  const F = threadsFixture('sup-thread-a3b');
  try {
    const Q = askQ(F, 'Which region?');
    for (let i = 0; i < 200; i++) F.hand('supervisor', { type: 'thread', title: `mine ${i}`, subject: { kind: 'item', ref: `question:${Q}` } }, 3600000 - i * 1000);
    const O = F.owner(['thread', 'new', 'Mine', '--title', 'Mine']).split('\n')[0];
    assert.match(O, /^t-.*-owner$/);
    F.owner(['thread', 'resolve', O]);
    assert.match(F.owner(['thread', 'reopen', O]), /reopened/);
  } finally { F.done(); }
});

test('kit-108 A4: the responder, a worker and a planner can\'t start a thread', () => {
  const F = threadsFixture('sup-thread-a4');
  try {
    const Q = askQ(F, 'Which region?');
    for (const role of [RESPONDER, WORKER, PLANNER]) {
      const said = F.fails(['thread', 'new', '--subject', subjectOf(`question:${Q}`), '--title', 't', '--', 'words'], role);
      assert.match(said, /only the owner and the supervisor start threads/, `${role.DEVTEAM_ROLE}: ${said}`);
    }
    assert.equal(logLines(F).filter((o) => o.type === 'thread').length, 0);
  } finally { F.done(); }
});

test('kit-108 A6: log-check takes a supervisor thread line with a question or goal item subject, and refuses any other subject, none, or the supervisor setting status or outcome', () => {
  const F = threadsFixture('sup-thread-a6');
  try {
    const Q = askQ(F, 'Which region?');
    const ok = F.checkWith(['supervisor', { type: 'thread', title: 'mine', subject: { kind: 'item', ref: `question:${Q}` } }]);
    assert.equal(ok.status, 0, ok.said);
    for (const subject of [{ kind: 'page', view: '#goals' }, { kind: 'item', ref: 'ticket:demo-01-x' }, undefined]) {
      const r = F.checkWith(['supervisor', { type: 'thread', title: 'mine', ...(subject ? { subject } : {}) }]);
      assert.notEqual(r.status, 0, `refused: ${JSON.stringify(subject)}`);
      assert.match(r.said, /supervisor may not create thread lines except about a question or a goal/);
    }
    const T = F.hand('supervisor', { type: 'thread', title: 'mine', subject: { kind: 'item', ref: `question:${Q}` } }, 60000);
    for (const field of [{ status: 'resolved' }, { outcome: 'done' }]) {
      const r = F.checkWith(['supervisor', { type: 'thread', op: 'set', id: T, ...field }]);
      assert.notEqual(r.status, 0);
      assert.match(r.said, /supervisor may not set thread\./);
    }
    // re and off_subject are a reply's, never the owner's turn; off_subject is one line of at most 300 bytes (task-1 F2)
    const U = F.hand('supervisor', { type: 'turn', thread: T, text: 'Looking', pending: true }, 50000);
    const good = F.checkWith(['supervisor', { type: 'turn', thread: T, text: 'Done', re: U, off_subject: 'x'.repeat(300) }]);
    assert.equal(good.status, 0, good.said);
    for (const [by, more, words] of [['owner', { re: U }, /re and off_subject are on a reply/], ['owner', { off_subject: 'why' }, /re and off_subject are on a reply/], ['supervisor', { off_subject: 'two\nlines' }, /off_subject is one line/], ['supervisor', { off_subject: 'x'.repeat(301) }, /off_subject/]]) {
      const r = F.checkWith([by, { type: 'turn', thread: T, text: 'Done', ...more }]);
      assert.notEqual(r.status, 0, `refused: ${by} ${JSON.stringify(more).slice(0, 60)}`);
      assert.match(r.said, words);
    }
  } finally { F.done(); }
});

test('kit-108 A7: a hand-written supervisor thread line that is born resolved (or with an outcome or proposal) folds open, with none of them', () => {
  const F = threadsFixture('sup-thread-a7');
  try {
    const Q = askQ(F, 'Which region?');
    const T = F.hand('supervisor', { type: 'thread', title: 'mine', subject: { kind: 'item', ref: `question:${Q}` }, status: 'resolved', outcome: 'settled by me', ready: { outcome: 'x', at: new Date().toISOString() } }, 60000);
    const v = view(F, T);
    assert.equal(v.status, 'open', 'the supervisor never resolves its own thread');
    assert.equal(v.outcome, null);
    assert.equal(v.ready, null);
    // one not about a question or a goal is dropped by every reader, not only refused by log-check
    const P = F.hand('supervisor', { type: 'thread', title: 'page', subject: { kind: 'page', view: '#goals' } }, 50000);
    const N = F.hand('supervisor', { type: 'thread', title: 'none' }, 40000);
    const A = F.hand('supervisor', { type: 'thread', title: 'array', subject: { kind: 'item', ref: [`question:${Q}`] } }, 30000);
    const all = JSON.parse(F.owner(['thread', 'list', '--all', '--json'])).map((x) => x.id);
    assert.ok(all.includes(T) && !all.includes(P) && !all.includes(N) && !all.includes(A), `dropped: ${all.join(', ')}`);
    // and thread list says which are the supervisor's, in the third person as the rest of its line
    assert.match(F.owner(['thread', 'list']), new RegExp(`${T} \\[open, the owner's move, from the supervisor\\]`));
  } finally { F.done(); }
});

test('kit-108 A8: a reply to an owed owner turn is never refused, whatever it names', () => {
  const F = threadsFixture('sup-thread-a8');
  try {
    const other = F.sup(['goal', 'add', '--title', 'Other', '--outcome', 'o', '--measure', 'm', '--target', '1', '--unit', '%', '--direction', 'up', '--source', 'prod', '--check', 'echo 1', '--horizon', '2027-03-31', '--non-goals', 'n', '--preconditions', 'p', '--priority', '2']);
    const T = F.owner(['thread', 'new', 'What about the EU?', '--title', 'EU']).split('\n')[0];
    const u = F.sup(['thread', 'reply', T, 'That is on the other goal.', '--refs', `goal:${other}`]).split('\n')[0];
    assert.match(u, /^u-.*-supervisor$/);
  } finally { F.done(); }
});

test('kit-108 A9: --re follows up the writer\'s own pending turn once; a second --re, or one naming anything else, is refused', () => {
  const F = threadsFixture('sup-thread-a9');
  try {
    const T = F.owner(['thread', 'new', 'Open a ticket for it', '--title', 'Ticket']).split('\n')[0];
    const P = F.sup(['thread', 'reply', T, 'On it: opening a ticket', '--pending']).split('\n')[0];
    const D = F.sup(['thread', 'reply', T, 'Done: the ticket is open.', '--re', P]).split('\n')[0];
    assert.equal(lineOf(F, D).re, P, 're kept on the turn');
    assert.match(F.sup(['thread', 'show', T]), new RegExp(`\\(${D}\\) \\(following up ${P}\\)`), 'show says what it follows up (task-3 F4)');
    assert.match(F.fails(['thread', 'reply', T, 'Done again.', '--re', P], F.SUP), /already followed up/);
    // not pending, not the writer's, not this thread's
    const N = F.sup(['thread', 'reply', T, 'A plain note.', '--refs', `ticket:demo-01-x`]).split('\n')[0];
    assert.match(F.fails(['thread', 'reply', T, 'More.', '--re', N], F.SUP), /not your pending turn in this thread/);
    const O = view(F, T).turns[0].id;
    assert.match(F.fails(['thread', 'reply', T, 'More.', '--re', O], F.SUP), /not your pending turn in this thread/);
    const T2 = F.owner(['thread', 'new', 'Another', '--title', 'Another']).split('\n')[0];
    const P2 = F.sup(['thread', 'reply', T2, 'On it', '--pending']).split('\n')[0];
    assert.match(F.fails(['thread', 'reply', T, 'More.', '--re', P2], F.SUP), /not your pending turn in this thread/);
    // a follow-up's question:/goal: refs stay on subject, so a --re --pending chain carries no other subject unmarked
    F.owner(['thread', 'say', T, 'And the second one?']);
    const P3 = F.sup(['thread', 'reply', T, 'On it again', '--pending']).split('\n')[0];
    assert.match(F.fails(['thread', 'reply', T, 'Also this.', '--re', P3, '--pending', '--refs', `goal:${F.goal}`], F.SUP), /off this thread's subject: a follow-up \(--re\)/);
    assert.match(F.sup(['thread', 'reply', T, 'Also this.', '--re', P3, '--refs', `goal:${F.goal}`, '--off-subject', 'the goal it serves']).split('\n')[0], /^u-/);
    // the owner's own turn takes no --re
    assert.match(F.fails(['thread', 'say', T, 'ok', '--re', P]), /--re goes with a reply/);
  } finally { F.done(); }
});

test('kit-108 A10: an unsolicited supervisor turn with no refs is refused, listing the remedies', () => {
  const F = threadsFixture('sup-thread-a10');
  try {
    const T = quietThread(F);
    const said = F.fails(['thread', 'reply', T, 'An unrelated note.'], F.SUP);
    assert.match(said, /nothing in t-\S+ is waiting on you/);
    for (const r of REMEDIES) assert.match(said, r);
    // the remedies in order
    const at = REMEDIES.map((r) => said.search(r));
    assert.deepEqual([...at].sort((a, b) => a - b), at, `in order: ${said}`);
  } finally { F.done(); }
});

test('kit-108 A11: an unsolicited turn naming a question or goal off the thread\'s subject is refused; --off-subject lets it through and keeps the reason', () => {
  const F = threadsFixture('sup-thread-a11');
  try {
    const Q = askQ(F, 'Which region?');
    const Qx = askQ(F, 'Keep daily sales totals?');
    const T = supThread(F, Q);
    const said = F.fails(['thread', 'reply', T, 'About sales.', '--refs', `question:${Qx}`], F.SUP);
    assert.match(said, new RegExp(`question:${Qx} is off this thread's subject`));
    for (const r of REMEDIES) assert.match(said, r);
    const other = F.sup(['goal', 'add', '--title', 'Other', '--outcome', 'o', '--measure', 'm', '--target', '1', '--unit', '%', '--direction', 'up', '--source', 'prod', '--check', 'echo 1', '--horizon', '2027-03-31', '--non-goals', 'n', '--preconditions', 'p', '--priority', '2']);
    assert.match(F.fails(['thread', 'reply', T, 'About the other goal.', '--refs', `goal:${other}`], F.SUP), new RegExp(`goal:${other} is off this thread's subject`));
    const u = F.sup(['thread', 'reply', T, 'About the other goal.', '--refs', `goal:${other}`, '--off-subject', 'at my cap; nearest thread']).split('\n')[0];
    assert.equal(lineOf(F, u).off_subject, 'at my cap; nearest thread');
    assert.match(F.sup(['thread', 'show', T]), new RegExp(`\\(${u}\\)[^\\n]*, off subject: "at my cap; nearest thread"`), 'show gives the reason (task-3 F4)');
    // a thread ask whose --goal is off subject: refused, then let through
    const T2 = quietThread(F, 'EU');
    F.sup(['thread', 'reply', T2, 'Keeping to the launch goal.', '--refs', `goal:${F.goal}`, '--off-subject', 'naming the goal']);
    assert.match(F.fails(['thread', 'ask', T2, '--question', 'Which region for the other?', '--goal', other, '--stake', '1', '--urgency', '1'], F.SUP), new RegExp(`goal:${other} is off this thread's subject`));
    const q = F.sup(['thread', 'ask', T2, '--question', 'Which region for the other?', '--goal', other, '--stake', '1', '--urgency', '1', '--off-subject', 'the owner asked about it elsewhere']).split('\n')[0];
    const turn = logLines(F).find((o) => o.type === 'turn' && o.question === q);
    assert.equal(turn.off_subject, 'the owner asked about it elsewhere');
  } finally { F.done(); }
});

test('kit-108 A12: an unsolicited turn whose question and goal refs are all on subject (the subject, its goal, or already named) is written', () => {
  const F = threadsFixture('sup-thread-a12');
  try {
    const Q = askQ(F, 'Which region?');
    const T = supThread(F, Q);
    // the subject itself, a ticket ref (not checked), and the subject question's own goal-approval goal
    assert.match(F.sup(['thread', 'reply', T, 'Still on it.', '--refs', `question:${Q}`, 'ticket:demo-01-x']).split('\n')[0], /^u-/);
    const ap = F.approval();
    const TA = supThread(F, ap.question, 'About the goal approval.');
    assert.match(F.sup(['thread', 'reply', TA, 'The goal it approves.', '--refs', `goal:${ap.goal}`]).split('\n')[0], /^u-/);
    // already named: an earlier turn's ref, then named again
    const Qn = askQ(F, 'Which currency?');
    F.sup(['thread', 'reply', T, 'This too.', '--refs', `question:${Qn}`, '--off-subject', 'the owner linked them']);
    assert.match(F.sup(['thread', 'reply', T, 'And again.', '--refs', `question:${Qn}`]).split('\n')[0], /^u-/);
    // a question asked in the thread is named
    const Ta = quietThread(F, 'Asked');
    const Qa = F.sup(['thread', 'ask', Ta, '--question', 'Which day?', '--stake', '1', '--urgency', '1']).split('\n')[0];
    assert.match(F.sup(['thread', 'reply', Ta, 'About that.', '--refs', `question:${Qa}`]).split('\n')[0], /^u-/);
    // a ticket subject's feature's goals
    const G2 = F.sup(['goal', 'add', '--title', 'Second', '--outcome', 'o', '--measure', 'm', '--target', '1', '--unit', '%', '--direction', 'up', '--source', 'prod', '--check', 'echo 1', '--horizon', '2027-03-31', '--non-goals', 'n', '--preconditions', 'p', '--priority', '3']);
    F.hand('supervisor', { type: 'feature', id: 'demo', title: 'Demo', goals: [G2] }, 70000);
    F.hand('supervisor', { type: 'ticket', id: 'demo-01-x', title: 'Demo one', feature: 'demo' }, 69000);
    const Tt = F.owner(['thread', 'new', 'About this ticket', '--title', 'Demo one', '--subject', subjectOf('ticket:demo-01-x')]).split('\n')[0];
    F.sup(['thread', 'reply', Tt, 'Looking.']);
    assert.match(F.sup(['thread', 'reply', Tt, 'Its goal.', '--refs', `goal:${G2}`]).split('\n')[0], /^u-/);
    // and a goal subject: its goal named
    const TG = F.sup(['thread', 'new', '--subject', subjectOf(`goal:${F.goal}`), '--title', 'g', '--', 'About the goal.']).split('\n')[0];
    assert.match(F.sup(['thread', 'reply', TG, 'More on it.', '--refs', `goal:${F.goal}`]).split('\n')[0], /^u-/);
  } finally { F.done(); }
});

test('kit-108 A13: an open handoff for the thread makes the supervisor\'s turn solicited', () => {
  const F = threadsFixture('sup-thread-a13');
  try {
    // a quiet thread, owed nothing, so the handoff is the only thing that asks (task-3 F3)
    const T = quietThread(F, 'Merge');
    assert.match(F.fails(['thread', 'reply', T, 'Merged.'], F.SUP), /is waiting on you/, 'nothing asks before the handoff');
    const h0 = F.run(F.old, ['send', 'supervisor', 'needs a merge', '--kind', 'handoff', '--thread', T], RESPONDER);
    assert.equal(h0.status, 0, h0.err);
    assert.match(F.sup(['thread', 'reply', T, 'Merged.']).split('\n')[0], /^u-/);
    // settled now: the next one is unsolicited
    assert.match(F.fails(['thread', 'reply', T, 'Another note.'], F.SUP), /is waiting on you/);
    // a handoff the supervisor answered with a reply naming it is settled too
    const r = F.run(F.old, ['send', 'supervisor', 'one more', '--kind', 'handoff', '--thread', T], RESPONDER);
    assert.equal(r.status, 0, r.err);
    const H = logLines(F).filter((o) => o.type === 'message' && o.kind === 'handoff').pop().id;
    F.sup(['send', 'responder', 'done', '--kind', 'info', '--re', H]);
    assert.match(F.fails(['thread', 'reply', T, 'And another.'], F.SUP), /is waiting on you/);
    // and one a question answered, naming it with --re, as kit-104's openHandoffs reads it (task-3 F2)
    const r2 = F.run(F.old, ['send', 'supervisor', 'and this', '--kind', 'handoff', '--thread', T], RESPONDER);
    assert.equal(r2.status, 0, r2.err);
    const H2 = logLines(F).filter((o) => o.type === 'message' && o.kind === 'handoff').pop().id;
    F.sup(['ask', '--question', 'Merge the other one too?', '--goal', F.goal, '--stake', '1', '--urgency', '1', '--re', H2]);
    assert.match(F.fails(['thread', 'reply', T, 'And more.'], F.SUP), /is waiting on you/);
    // any open handoff solicits, whoever wrote it (cmdSend says who may send one; kit-109 widens it)
    const d = new Date(Date.now() + 2000);
    const mid = `m-${d.toISOString().replace(/[-:TZ.]/g, '').replace(/^(\d{8})(\d{9})$/, '$1-$2')}-demo-01-x`;
    F.hand('demo-01-x', { id: mid, type: 'message', to: 'supervisor', kind: 'handoff', thread: T, text: 'x' }, -2000, 'demo-01-x.jsonl');
    assert.ok(JSON.parse(F.owner(['log', '--json'])).some((o) => o.id === mid), 'the hand-written handoff is read');
    assert.match(F.sup(['thread', 'reply', T, 'Still another.']).split('\n')[0], /^u-/);
    // but a handoff is to the supervisor, never from it: one it wrote itself solicits nothing
    const d2 = new Date(Date.now() + 2000);
    const sid = `m-${d2.toISOString().replace(/[-:TZ.]/g, '').replace(/^(\d{8})(\d{9})$/, '$1-$2')}-supervisor`;
    const Ts = quietThread(F, 'Self');
    F.hand('supervisor', { id: sid, type: 'message', to: 'supervisor', kind: 'handoff', thread: Ts, text: 'x' }, -2000);
    assert.ok(JSON.parse(F.owner(['log', '--json'])).some((o) => o.id === sid), 'the supervisor\'s own handoff line is read');
    assert.match(F.fails(['thread', 'reply', Ts, 'Yet another.'], F.SUP), /is waiting on you/);
  } finally { F.done(); }
});

test('kit-108 A14: the incident\'s shape: a turn right after the supervisor\'s pending turn, with no --re and no refs, is refused (u-20261114-205805044-supervisor)', () => {
  const F = threadsFixture('sup-thread-a14');
  try {
    const rows = fs.readFileSync(INCIDENT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    // the thread, the owner's turn and the pending reply, as they were; the fourth is the incident's turn
    rows.slice(0, 3).forEach((r, i) => F.hand(r.by, r.line, 600000 - i * 60000));
    const incident = rows[3].line;
    assert.equal(incident.id, 'u-20261114-205805044-supervisor');
    const said = F.fails(['thread', 'reply', incident.thread, incident.text], F.SUP);
    assert.match(said, /is waiting on you/);
    assert.ok(!logLines(F).some((o) => o.type === 'turn' && o.text === incident.text), 'not written');
    // its follow-up, named, passes
    assert.match(F.sup(['thread', 'reply', incident.thread, 'The planner has started.', '--re', rows[2].line.id]).split('\n')[0], /^u-/);
  } finally { F.done(); }
});

test('kit-108 A15: the responder\'s turns keep the same rules: its --re follow-up passes, its unsolicited turn with no refs is refused', () => {
  const F = threadsFixture('sup-thread-a15');
  try {
    // the thread's first turn goes to the supervisor (no responder runs here), which answers it; the
    // owner's next turn is hand-written routed to the responder (kit-104), so the responder is asked
    const T = F.owner(['thread', 'new', 'What is open?', '--title', 'Open']).split('\n')[0];
    F.sup(['thread', 'reply', T, 'Asking the responder.']);
    F.hand('owner', { type: 'turn', thread: T, text: 'And the tickets?', routed_to: 'responder', delivered: 'typed' }, 0);
    const r1 = F.run(F.old, ['thread', 'reply', T, 'Looking now', '--pending'], RESPONDER);
    assert.equal(r1.status, 0, r1.err);
    const P = r1.out.split('\n')[0];
    // the promise asks for its follow-up, held to the thread's subject as a --re one is (task-3 F1)
    for (const extra of [[], ['--re', P]]) {
      const off = F.run(F.old, ['thread', 'reply', T, 'About the goal.', '--refs', `goal:${F.goal}`, ...extra], RESPONDER);
      assert.notEqual(off.status, 0, `refused: ${extra.join(' ') || 'no --re'}`);
      assert.match(off.err, /off this thread's subject: a follow-up/);
    }
    const r2 = F.run(F.old, ['thread', 'reply', T, 'Two tickets are open.', '--re', P], RESPONDER);
    assert.equal(r2.status, 0, r2.err);
    const r3 = F.run(F.old, ['thread', 'reply', T, 'Something else.'], RESPONDER);
    assert.notEqual(r3.status, 0);
    assert.match(r3.err, /is waiting on you/);
  } finally { F.done(); }
});

test('kit-108 A15b: the responder\'s open promise asks for the supervisor\'s turn: its take-over is written and says so, and the next one is refused', () => {
  const F = threadsFixture('sup-thread-a15b');
  try {
    // ruling a-20261123-141139876: kit-104's open promise (pendingOpen) is the supervisor's to take over
    const T = F.owner(['thread', 'new', 'What is open?', '--title', 'Open']).split('\n')[0];
    F.sup(['thread', 'reply', T, 'Asking the responder.']);
    F.hand('owner', { type: 'turn', thread: T, text: 'And the tickets?', routed_to: 'responder', delivered: 'typed' }, 0);
    const r1 = F.run(F.old, ['thread', 'reply', T, 'Looking now', '--pending'], RESPONDER);
    assert.equal(r1.status, 0, r1.err);
    const P = r1.out.split('\n')[0];
    const SUPER = { DEVTEAM_ROLE: 'supervisor' };
    const s1 = F.run(F.old, ['thread', 'reply', T, 'I have it from here.'], SUPER);
    assert.equal(s1.status, 0, `the take-over is asked for: ${s1.err}`);
    assert.match(s1.err, new RegExp(`^taking over ${P}`, 'm'), s1.err);
    const s2 = F.run(F.old, ['thread', 'reply', T, 'And one more thing.'], SUPER);
    assert.notEqual(s2.status, 0, 'the promise is settled: nothing asks for a second');
    assert.match(s2.err, /is waiting on you/);
  } finally { F.done(); }
});

test('kit-108 A16: supervisor.md says how to start a thread, follow up a pending reply, and propose resolving its own (§6), and the responder\'s follow-up (§13)', () => {
  const md = fs.readFileSync(path.join(HERE, '../docs/devteam/process/supervisor.md'), 'utf8');
  const section = (h) => { const i = md.indexOf(h); assert.ok(i >= 0, h); const j = md.indexOf('\n## ', i + 1); return md.slice(i, j < 0 ? undefined : j); };
  const s6 = section('## 6. Questions to the owner');
  assert.match(s6, /belongs to no open thread[^\n]*`DEVTEAM_ROLE=supervisor devteam\.mjs thread new --subject/);
  assert.match(s6, /never post it into an unrelated thread/i);
  assert.match(s6, /`--pending`[^\n]*`--re <that turn>`/);
  assert.match(s6, /propose resolving[^\n]*own thread/i);
  const s13 = section('## 13. The responder');
  assert.match(s13, /follow-up[^\n]*`--re <that turn>`/);
  // the responder's own prompt says it too
  const F = threadsFixture('sup-thread-a16');
  try { assert.match(F.owner(['prompt', 'responder']), /reply again when it is done, with --re </); } finally { F.done(); }
});

test('kit-108 A17: in Chrome, a supervisor-started thread is labelled from the supervisor in the list and the card, and the owner replies, resolves and reopens it', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 300000 }, async (t) => {
  const later = cleanup(t);
  const F = threadsFixture('sup-thread-chrome');
  later(() => F.done());
  const Q = askQ(F, 'Keep daily sales totals?');
  const T = supThread(F, Q, 'I recorded your answer on sales.');
  const O = F.owner(['thread', 'new', 'Mine', '--title', 'Mine']).split('\n')[0];
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: POLL_FAST });
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#goals` });
  const soon = soonIn(p);
  const still = async (f) => { await p.ev('window.__still()'); try { return await f(); } finally { await p.ev('window.__stir()'); } };
  const released = () => soon('!TL.pressed && PRESSED === 0', 'the release handled');
  const click = (sel) => still(async () => { await p.click(sel); await released(); });
  const threads = () => JSON.parse(F.owner(['thread', 'list', '--all', '--json']));
  const onThreads = async () => {
    if (!await p.ev(`document.body.classList.contains('threads-open')`)) await click('.pagebar .tt');
    await soon(`document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none'`, 'the panel open, at rest');
    const tab = '#th-tabs [role="tab"][data-tab="threads"]';
    if (await p.ev(`document.querySelector('${tab}')?.getAttribute('aria-selected') !== 'true'`)) await click(tab);
    await soon(`document.querySelector('${tab}')?.getAttribute('aria-selected') === 'true' && !!document.getElementById('th-inbox').hidden`, 'the panel on Threads');
  };
  await soon(`TL.threads.some((x) => x.id === '${T}')`, 'the page has the thread');
  await onThreads();
  const row = (id) => `#tl-list [data-tl-open="${id}"]`;
  await soon(`!!document.querySelector('${row(T)}')`, 'listed');
  assert.match(await p.ev(`document.querySelector('${row(T)}').textContent`), /From the supervisor/, 'the list labels it');
  assert.doesNotMatch(await p.ev(`document.querySelector('${row(O)}').textContent`), /From the supervisor/, "the owner's is not");
  // and the owner's own card says nothing of the supervisor (task-4 F1)
  await click(row(O));
  await soon(`TL.open === '${O}' && /Mine/.test(document.getElementById('tl-c-ctx')?.textContent ?? '')`, "the owner's card open");
  assert.doesNotMatch(await p.ev(`document.getElementById('tl-c-ctx').textContent`), /from the supervisor/i, "the owner's card is not labelled");
  await p.ev("location.hash = '#goals?th=open'");
  await soon(`!TL.open`, 'the card closed');
  await onThreads();
  await soon(`!!document.querySelector('${row(T)}')`, 'listed again');
  await click(row(T));
  await soon(`!!document.querySelector('#tl-c-ctx') && /from the supervisor/i.test(document.getElementById('tl-c-ctx').textContent)`, 'the card labels it');
  // reply
  await p.ev(`(() => { const ta = document.getElementById('tl-c-text'); ta.value = 'Thanks, that is right.'; ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click('[data-tl-send]');
  await until(() => threads().find((x) => x.id === T).turns.some((u) => u.by === 'owner' && u.text === 'Thanks, that is right.'), 'the owner replied');
  // resolve
  await soon(`!!document.querySelector('[data-tl-resolve]')`, 'Resolve in its header');
  await click('[data-tl-resolve]');
  await soon(`!!document.getElementById('tl-outcome')`, 'the form');
  await p.ev(`document.getElementById('tl-outcome').value = 'Read it'`);
  await click('[data-tl-resolve-go]');
  await until(() => threads().find((x) => x.id === T).status === 'resolved', 'resolved');
  // reopen, from the Resolved list
  await onThreads();
  await click('#th-pane [data-thf="resolved"]');
  await soon(`!!document.querySelector('${row(T)}')`, 'listed under Resolved');
  await click(row(T));
  await soon(`!!document.querySelector('[data-tl-reopen]')`, 'Reopen in its header');
  await click('[data-tl-reopen]');
  await until(() => threads().find((x) => x.id === T).status === 'open', 'reopened');
  t.diagnostic('kit-108 A17 ran in Chrome');
});

test('kit-108 A20: owner-thread provenance needs the owner\'s thread: the supervisor\'s own is refused as the owner\'s words, the owner\'s is accepted', () => {
  const F = threadsFixture('sup-thread-a20');
  try {
    const Q = askQ(F, 'Keep daily sales totals?');
    const S = supThread(F, Q, 'I decided we keep them.');
    const obs = (ref) => ['observe', '--subject', 'sales', '--kind', 'note', '--detail', 'keep the totals', '--source', 'owner-thread', '--ref', ref];
    assert.match(F.fails(obs(S), F.SUP), /observe --source owner-thread needs --ref <id> naming where the owner said it/);
    const O = F.owner(['thread', 'new', 'Keep the totals', '--title', 'Totals']).split('\n')[0];
    assert.match(F.sup(obs(O)), /^o-/);
    // the supervisor's thread with the owner's turn in it: the turn is where they said it
    const u = F.owner(['thread', 'say', S, 'Yes, keep them']).split('\n')[0];
    assert.match(F.sup(obs(u)), /^o-/);
  } finally { F.done(); }
});
