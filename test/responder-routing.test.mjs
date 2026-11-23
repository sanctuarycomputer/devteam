// Responder routing (kit-104; fast-threads.md §Routing, the spine's Routing): an owner's turn is
// routed once, when it is written, and routed_to is stored on the turn. The supervisor takes its own
// questions' threads and threads on an open question or an uncorrected decision or act; it takes
// every turn while the responder is off, gone, at a shell, stuck or overdue; the responder takes
// the rest. A turn routed to the responder is typed into its pane only when it is idle, else queued.
// wait, thread list --waiting, threadView.waiting, the findings and the accounts tick's nudge all
// read routed_to; nothing recomputes it.
// Run: node --test test/responder-routing.test.mjs (tmux, on a private TMUX_TMPDIR). wait's cases are
// test/responder-routing.wait.test.mjs; the fixture both use is test/lib/responder-routing.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { MIN, SUP, RESPONDER, NO_TMUX, sleep, NUDGE, fixture, helpers } from './lib/responder-routing.mjs';

test('responder routing (kit-104)', { skip: NO_TMUX, timeout: 280000 }, async (t) => {
  const F = fixture('responder-routing');
  t.after(() => F.done());
  F.up();
  const { only, it, setResponder, call, ask, inboxAsk, routed, queue, oldThread, after } = helpers(F, t);
  // ---- done-when 1, 2, 3, 10, 11: routed_to on the owner's turn, and where it is typed ----
  await it('R1 a plain thread: routed_to responder, delivered typed', () => {
    const { U } = F.thread('Plain');
    assert.deepEqual([routed(U), F.turn(U).delivered], ['responder', 'typed'], 'thread new routes its first turn');
  });
  await it('R1w it prints "sent to the responder"', () => {
    assert.equal(F.thread('Plain, words').said, 'sent to the responder');
  });
  await it('R1t it is typed into the responder\'s pane', () => {
    const { T } = F.thread('Plain, typed');
    assert.ok(F.reaches(F.typed, new RegExp(`\\[devteam thread ${T} from owner\\]`)), 'typed into the responder');
  });
  await it('R1b a turn routed to the responder is never typed into the supervisor', () => {
    const { T } = F.thread('Not the supervisor\'s');
    assert.ok(F.stays(F.P.typed, new RegExp(T)), 'not into the supervisor');
    assert.ok(F.reaches(F.typed, new RegExp(T)), 'it reached the responder');
  });
  await it('R2a the supervisor\'s open thread ask question: routed_to supervisor, no delivered, typed into its pane', () => {
    const { T } = F.thread('Asked');
    ask(T);
    const a = F.say(T, 'Blue, please');
    assert.equal(a.line.routed_to, 'supervisor', 'an open question asked in the thread');
    assert.equal(a.line.delivered, undefined, 'delivered goes only with the responder');
    assert.equal(a.said, "sent to the supervisor's pane");
    assert.ok(F.reaches(F.P.typed, /Blue, please/), 'typed into the supervisor');
  });
  await it('R2b a turn routed to the supervisor is typed into its pane only', () => {
    const { T } = F.thread('Asked, only');
    ask(T);
    F.say(T, 'Green, please');
    assert.ok(F.reaches(F.P.typed, /Green, please/), 'it reached the supervisor');
    assert.ok(F.stays(F.typed, /Green, please/), 'not into the responder');
  });
  await it('R2c routed_to never changes: the question closed and the responder restarted, thread list --waiting still names the supervisor', () => {
    const { T } = F.thread('Asked, then answered');
    const Q = ask(T);
    const a = F.say(T, 'Red');
    F.sup(['answer', Q, 'red', '--from-turn', a.U]);
    F.up();
    assert.equal(routed(a.U), 'supervisor', 'routed_to never changes');
    assert.match(F.sup(['thread', 'list', '--waiting']), new RegExp(`^${T} \\[open, waiting on the supervisor\\]`, 'm'), 'still the supervisor\'s to answer');
  });
  await it('R3a a thread whose subject is an open question: supervisor', () => {
    const { U } = F.thread('On a question', `question:${inboxAsk()}`);
    assert.equal(routed(U), 'supervisor');
  });
  await it('R3b a thread whose subject is an answered question: responder', () => {
    const Q = inboxAsk();
    F.owner(['answer', Q, 'yes']);
    const { U } = F.thread('On an answered question', `question:${Q}`);
    assert.equal(routed(U), 'responder');
  });
  await it('R4a a decision the owner hasn\'t corrected: supervisor', () => {
    const { U } = F.thread('On a decision', `decision:${call('decision')}`);
    assert.equal(routed(U), 'supervisor');
  });
  await it('R4b a decision only the supervisor corrected (a retro): still the supervisor', () => {
    const D = call('decision');
    F.sup(['correct', D, '--retro', '--reason', 'my own call was wrong']);
    const { U } = F.thread('On a retro-corrected decision', `decision:${D}`);
    assert.equal(routed(U), 'supervisor', 'a retro correction is not the owner\'s');
  });
  await it('R4c a decision the owner corrected: by the ordinary rules', () => {
    const D = call('decision');
    const { T } = F.thread('On a decision, corrected', `decision:${D}`);
    F.owner(['correct', D, '--reason', 'that was the wrong call']);
    assert.equal(F.say(T, 'Thanks').line.routed_to, 'responder');
  });
  await it('R4d an act the owner hasn\'t corrected: supervisor', () => {
    const { U } = F.thread('On an act', `act:${call('act')}`);
    assert.equal(routed(U), 'supervisor');
  });
  await it('R4e an act the owner corrected: by the ordinary rules', () => {
    const A = call('act');
    const { T } = F.thread('On an act, corrected', `act:${A}`);
    F.owner(['correct', A, '--reason', 'undo it']);
    assert.equal(F.say(T, 'Done?').line.routed_to, 'responder');
  });
  await it('R4f a thread on one of the owner\'s own acts (never corrected): by the ordinary rules', () => {
    const A = 'a-20261118-000000199-owner';
    F.hand('owner', { id: A, type: 'act', class: 'artifact-publish', what: 'unpublish', artifact: 'a-page', refs: ['artifact:a-page'] }, 3500000);
    const { U } = F.thread('On the owner\'s act', `act:${A}`);
    assert.equal(routed(U), 'responder');
  });
  await it('R5a an act that carried out a decision: supervisor while the decision is uncorrected (F8-4)', () => {
    const { U } = F.thread('On an act under a decision', `act:${call('act', { decision: call('decision') })}`);
    assert.equal(routed(U), 'supervisor');
  });
  await it('R5b an act that carried out a decision: by the ordinary rules once the decision is corrected (F8-4)', () => {
    const D = call('decision');
    const { T } = F.thread('On an act, its decision corrected', `act:${call('act', { decision: D })}`);
    F.owner(['correct', D, '--reason', 'the call behind it was wrong']);
    assert.equal(F.say(T, 'And now?').line.routed_to, 'responder');
  });
  await it('R6a settings.responder off: supervisor', () => {
    try {
      setResponder(false);
      const { U } = F.thread('Responder off');
      assert.equal(routed(U), 'supervisor');
    } finally { setResponder(true); }
  });
  await it('R6b its window missing: supervisor', () => {
    try {
      F.down();
      const { U } = F.thread('Responder gone');
      assert.equal(routed(U), 'supervisor');
    } finally { F.up(); }
  });
  await it('R6c its pane runs only a shell: supervisor', () => {
    try {
      F.shell();
      const { U } = F.thread('Responder at a shell');
      assert.equal(routed(U), 'supervisor');
    } finally { F.up(); }
  });
  await it('R6d its pane shows a blocked-prompt pattern (stuck): supervisor, typed into the supervisor\'s pane and never the responder\'s', () => {
    try {
      F.up({ banner: 'Do you want to proceed?' });
      const { T } = F.thread('Stuck');
      const s = F.say(T, 'stuck words');
      assert.equal(s.line.routed_to, 'supervisor', 'stuck');
      assert.equal(s.said, "sent to the supervisor's pane");
      assert.ok(F.reaches(F.P.typed, /stuck words/), 'typed into the supervisor');
      assert.ok(F.stays(F.typed, /stuck words/), 'never into the stuck responder');
    } finally { F.up(); }
  });
  await it('R6e its pane shows a dialog the kit reads (a hold, not a blocked-prompt line): supervisor, never held in the responder\'s pane', () => {
    try {
      F.up({ banner: 'Enter to confirm · Esc to cancel' });
      const { T } = F.thread('A dialog up');
      const s = F.say(T, 'dialog words');
      assert.equal(s.line.routed_to, 'supervisor');
      assert.ok(F.stays(F.typed, /dialog words/), 'not typed into the responder');
    } finally { F.up(); }
  });
  await it('R7d an open responder-overdue (its pending turn with nothing after it for 10 minutes): supervisor', () => {
    const T = oldThread(30 * MIN);
    F.ownerTurn(T, 20 * MIN);
    F.writerTurn('responder', T, 11 * MIN, { pending: true });
    const { U } = F.thread('After a stalled pending');
    assert.equal(routed(U), 'supervisor');
  });
  await it('R7a an open responder-overdue (a responder turn owed past 3 minutes): supervisor', () => {
    const { T } = F.thread('Overdue');
    F.ownerTurn(T, 4 * MIN);
    const { U } = F.thread('After an overdue');
    assert.equal(routed(U), 'supervisor');
  });
  await it('R7b a turn the supervisor answered never keeps it open: responder', () => {
    const { T } = F.thread('Overdue, then answered');
    F.ownerTurn(T, 4 * MIN);
    F.sup(['thread', 'reply', T, '--', 'I have it']);
    const { U } = F.thread('After the supervisor answered');
    assert.equal(routed(U), 'responder');
  });
  await it('R7c a turn in a thread resolved after it never keeps it open, even after a reopen: responder', () => {
    const { T } = F.thread('Resolved after');
    F.ownerTurn(T, 4 * MIN);
    F.owner(['thread', 'resolve', T]);
    F.owner(['thread', 'reopen', T]);
    const { U } = F.thread('After the resolve and reopen');
    assert.equal(routed(U), 'responder');
  });

  await it('D1a busy (a typed turn still owed): delivered queued, "the responder is busy; it takes this next"', () => {
    const { T } = F.thread('Busy');
    F.ownerTurn(T, 20000, 'responder', 'typed');
    const q = F.say(T, 'queued words');
    assert.deepEqual([q.line.routed_to, q.line.delivered], ['responder', 'queued']);
  });
  await it('D1w a queued turn prints "the responder is busy; it takes this next"', () => {
    const { T } = F.thread('Busy, words');
    assert.equal(F.say(T, 'queued, its words').said, 'the responder is busy; it takes this next');
  });
  await it('D1b a queued turn is typed into neither pane', () => {
    const { T } = F.thread('Busy, untyped');
    F.ownerTurn(T, 20000, 'responder', 'typed');
    F.say(T, 'queued, untyped');
    assert.ok(F.stays(F.typed, /queued, untyped/), 'not into the responder');
    assert.ok(!/queued, untyped/.test(F.P.typed()), 'nor into the supervisor');
  });
  await it('D1c a queued turn is listed by thread list --waiting --responder', () => {
    const { T } = F.thread('Busy, listed');
    F.ownerTurn(T, 20000, 'responder', 'typed');
    const q = F.say(T, 'queued, listed');
    assert.match(queue(), new RegExp(`^${q.U} in ${T} `, 'm'));
  });
  await it('D2a busy (its own newest turn pending, 2 minutes old): queued', () => {
    const T = oldThread(30 * MIN);
    F.ownerTurn(T, 20 * MIN);
    F.writerTurn('responder', T, 2 * MIN, { pending: true });
    assert.equal(F.say(T, 'while pending').line.delivered, 'queued');
  });
  await it('D2b queued turns never make it busy: typed', () => {
    const T = oldThread(30 * MIN);
    F.writerTurn('responder', T, 20 * MIN);
    F.ownerTurn(T, 30000, 'responder', 'queued');
    const s = F.say(T, 'idle again');
    assert.deepEqual([s.line.routed_to, s.line.delivered, s.said], ['responder', 'typed', 'sent to the responder']);
  });

  // ---- done-when 3, 12, 13: thread list --waiting, threadView.waiting, thread-waiting ----
  await it('W1a thread list --waiting lists owed turns routed to the supervisor and open handoffs', () => {
    const { T: TS } = F.thread('The supervisor has this');
    F.ownerTurn(TS, 1000, 'supervisor');
    const { T: TH } = F.thread('Handed over');
    after(() => F.writerTurn('responder', TH, 0));
    F.run(['send', 'supervisor', 'needs a ticket', '--kind', 'handoff', '--thread', TH], RESPONDER);
    const w = F.sup(['thread', 'list', '--waiting']);
    assert.match(w, new RegExp(`^${TS} \\[open, waiting on the supervisor\\]`, 'm'));
    assert.match(w, new RegExp(`^${TH} \\[open, waiting on the supervisor`, 'm'), 'an open handoff names it');
  });
  await it('W1b thread list --waiting marks the threads the responder has "the responder has it"', () => {
    const { T } = F.thread('The responder has this');
    assert.match(F.sup(['thread', 'list', '--waiting']), new RegExp(`^${T} \\[open, the responder has it\\]`, 'm'));
  });
  await it('W1c the supervisor\'s rows and --json leave out a thread the responder has, and one whose turn the responder answered', () => {
    const { T } = F.thread('The responder has this, alone');
    const { T: TA } = F.thread('The responder answered this');
    after(() => F.writerTurn('responder', TA, 0));
    const rows = F.sup(['thread', 'list', '--waiting']).split('\n');
    assert.ok(!rows.some((l) => l.startsWith(T) && /waiting on the supervisor/.test(l)), 'not as the supervisor\'s');
    assert.ok(!rows.some((l) => l.startsWith(TA)), 'answered: not listed at all');
    const ids = JSON.parse(F.sup(['thread', 'list', '--waiting', '--json'])).map((x) => x.id);
    assert.ok(!ids.includes(T) && !ids.includes(TA), '--json: the supervisor\'s only');
  });
  await it('W2a threadView.waiting follows routed_to: a responder turn does not answer a turn routed to the supervisor', () => {
    const T = oldThread(30 * MIN);
    F.ownerTurn(T, 2 * MIN, 'supervisor');
    F.writerTurn('responder', T, MIN);
    assert.equal(F.show(T).waiting, 'supervisor');
  });
  await it('W2b threadView.waiting: an owed turn routed to the responder waits on it, and its answer gives the owner the move', () => {
    const { T } = F.thread('Responder owed');
    assert.equal(F.show(T).waiting, 'responder');
    after(() => F.writerTurn('responder', T, 0));
    assert.equal(F.show(T).waiting, 'owner');
  });
  await it('W2c thread-waiting fires for an owed turn routed to the supervisor (10 min)', () => {
    const TS = oldThread(30 * MIN);
    F.ownerTurn(TS, 11 * MIN, 'supervisor');
    F.writerTurn('responder', TS, 2 * MIN);
    const TR = oldThread(30 * MIN);
    F.writerTurn('responder', TR, 20 * MIN);
    F.ownerTurn(TR, 11 * MIN, 'responder');
    assert.ok(F.metrics().some((f) => f.kind === 'thread-waiting' && f.subject === TS), 'the supervisor\'s owed turn');
    void TR;
  });
  const unrouted = (T, agoMs) => F.hand('owner', { type: 'turn', thread: T, text: `an unrouted turn (${agoMs / MIN} min)` }, agoMs);
  await it('U1 an owed turn with no route (an older kit\'s) is listed as waiting on the supervisor', () => {
    const T = oldThread(30 * MIN);
    unrouted(T, 11 * MIN);
    assert.match(F.sup(['thread', 'list', '--waiting']), new RegExp(`^${T} \\[open, waiting on the supervisor\\]`, 'm'));
  });
  await it('U2 an owed turn with no route raises thread-waiting at 10 minutes', () => {
    const T = oldThread(30 * MIN);
    unrouted(T, 11 * MIN);
    assert.ok(F.metrics().some((f) => f.kind === 'thread-waiting' && f.subject === T));
  });
  await it('W1d an overdue thread the responder has is marked "· overdue" in the supervisor\'s list', () => {
    const T = oldThread(30 * MIN);
    F.ownerTurn(T, 4 * MIN);
    assert.match(F.sup(['thread', 'list', '--waiting']), new RegExp(`^${T} \\[open, the responder has it · overdue\\]`, 'm'));
  });
  await it('W2d thread-waiting never fires for an owed turn routed to the responder', () => {
    const TR = oldThread(30 * MIN);
    F.writerTurn('responder', TR, 20 * MIN);
    F.ownerTurn(TR, 11 * MIN, 'responder');
    assert.ok(!F.metrics().some((f) => f.kind === 'thread-waiting' && f.subject === TR));
  });

  // ---- done-when 5: the findings ----
  const overdueIn = (T) => F.metrics().find((f) => f.kind === 'responder-overdue' && f.subject === T);
  const owedLong = () => { const T = oldThread(30 * MIN); F.ownerTurn(T, 4 * MIN); return T; };
  await it('M1a responder-overdue (high): a turn routed to the responder owed past 3 minutes', () => {
    assert.equal(overdueIn(owedLong())?.severity, 'high');
  });
  await it('M1b responder-overdue clears once the responder answers', () => {
    const T = owedLong();
    after(() => F.writerTurn('responder', T, 0));
    assert.equal(overdueIn(T), undefined);
  });
  await it('M1c responder-overdue clears once the supervisor answers', () => {
    const T = owedLong();
    F.sup(['thread', 'reply', T, '--', 'on it']);
    assert.equal(overdueIn(T), undefined);
  });
  await it('M1d responder-overdue clears once its thread is resolved', () => {
    const T = owedLong();
    F.owner(['thread', 'resolve', T]);
    assert.equal(overdueIn(T), undefined);
  });
  await it('M1e responder-overdue (high): a pending responder turn in an open thread with nothing after it for 10 minutes', () => {
    const T = oldThread(30 * MIN);
    F.ownerTurn(T, 20 * MIN);
    F.writerTurn('responder', T, 11 * MIN, { pending: true });
    assert.equal(overdueIn(T)?.severity, 'high');
  });
  await it('M1f a pending turn with something after it raises none', () => {
    const T = oldThread(30 * MIN);
    F.ownerTurn(T, 20 * MIN);
    F.writerTurn('responder', T, 11 * MIN, { pending: true });
    F.writerTurn('responder', T, 1000);
    assert.equal(overdueIn(T), undefined);
  });
  await it('M2a responder-down (medium): settings.responder on and its window missing', () => {
    try { F.down(); assert.equal(F.finding('responder-down')?.severity, 'medium'); } finally { F.up(); }
  });
  await it('M2b responder-down (medium): its pane runs only a shell', () => {
    try { F.shell(); assert.equal(F.finding('responder-down')?.severity, 'medium'); } finally { F.up(); }
  });
  await it('M2c no responder-down while settings.responder is off', () => {
    try { setResponder(false); F.down(); assert.equal(F.finding('responder-down'), undefined); } finally { setResponder(true); F.up(); }
  });
  await it('M2d responder-stuck (medium) names the line; no responder-down then', () => {
    try {
      F.up({ banner: 'Do you want to proceed?' });
      const s = F.finding('responder-stuck');
      assert.equal(s?.severity, 'medium');
      assert.match(s.detail, /Do you want to proceed\?/, 'names the line');
      assert.equal(F.finding('responder-down'), undefined);
    } finally { F.up(); }
  });

  await it('M2e responder-stuck (medium) for a dialog the kit reads that PANE_WAITS doesn\'t, naming its line', () => {
    try {
      F.up({ banner: 'Enter to confirm · Esc to cancel' });
      const s = F.finding('responder-stuck');
      assert.equal(s?.severity, 'medium');
      assert.match(s.detail, /Enter to confirm/);
    } finally { F.up(); }
  });

  // ---- done-when 6, 7: the queue after an overdue answer, and the idle nudge ----
  const nudgeFile = path.join(F.old, 'docs/devteam/run/responder-nudge.json');
  const tick = () => F.run(['accounts-tick'], { ...SUP, DEVTEAM_CSWAP: 'off' });
  const nudges = () => (F.typed().match(new RegExp(NUDGE.source, 'g')) ?? []).length;
  const idleWithQueue = () => { const T = oldThread(30 * MIN); F.writerTurn('responder', T, 10 * MIN); F.ownerTurn(T, MIN, 'responder', 'queued'); return T; };
  await it('N1a the supervisor answers an overdue turn: the responder\'s queue leaves it out', () => {
    const T = oldThread(30 * MIN);
    const U = F.ownerTurn(T, 4 * MIN, 'responder', 'queued');
    assert.match(queue(), new RegExp(U));
    F.sup(['thread', 'reply', T, '--', 'Answered by the supervisor']);
    assert.equal(queue(), 'no turn is waiting on the responder');
  });
  await it('N1b after that, the stub made idle and nudged writes no second reply', () => {
    const T = oldThread(30 * MIN);
    F.ownerTurn(T, 4 * MIN, 'responder', 'queued');
    F.sup(['thread', 'reply', T, '--', 'Answered by the supervisor']);
    try {
      F.up({ mode: 'reply' });
      F.tmux(['send-keys', '-t', F.target, '-l', '[devteam responder] a turn is waiting — devteam.mjs thread list --waiting --responder']);
      F.tmux(['send-keys', '-t', F.target, 'Enter']);
      assert.ok(F.reaches(F.typed, /\[stub took \d+\]/), 'the stub took its queue');
      assert.ok(!F.show(T).turns.some((u) => u.writer === 'responder' && u.text.startsWith('stub reply')), 'no second reply');
    } finally { F.up(); }
  });
  await it('N2a the accounts tick types the nudge into an idle responder whose queue is not empty', () => {
    fs.rmSync(nudgeFile, { force: true });
    idleWithQueue();
    F.up();
    tick();
    assert.ok(F.reaches(F.typed, NUDGE));
  });
  await it('N2b at most once a minute', () => {
    idleWithQueue();
    F.up();
    fs.writeFileSync(nudgeFile, JSON.stringify({ at: new Date(Date.now() - 30000).toISOString() }));
    tick();
    assert.ok(F.stays(F.typed, NUDGE), 'nudged 30 s ago: not again');
    fs.writeFileSync(nudgeFile, JSON.stringify({ at: new Date(Date.now() - 61000).toISOString() }));
    tick();
    assert.ok(F.reaches(F.typed, NUDGE), 'a minute on: again');
  });
  await it('N2c never into a busy responder', () => {
    idleWithQueue();
    // busy: its own newest turn is a pending one, in another thread
    const T2 = oldThread(30 * MIN);
    F.ownerTurn(T2, 20 * MIN);
    F.writerTurn('responder', T2, 0, { pending: true });
    F.up();
    fs.rmSync(nudgeFile, { force: true });
    tick();
    assert.ok(F.stays(F.typed, NUDGE));
  });
  await it('N2d no nudge with an empty queue', () => {
    F.up();
    fs.rmSync(nudgeFile, { force: true });
    tick();
    assert.ok(F.stays(F.typed, NUDGE));
    assert.equal(nudges(), 0);
  });

  // ---- done-when 2, on the owner's card (ruling a-20261123-045530036-supervisor) ----
  const html = fs.readFileSync(path.join(F.old, 'docs/devteam/dashboard/index.html'), 'utf8');
  const card = () => {
    const src = html.slice(html.indexOf('/* threads-core start */'), html.indexOf('/* threads-core end */'));
    const c = vm.createContext({ TextEncoder, URL });
    vm.runInContext(`${src}\n;globalThis.api = { tCardState };`, c);
    return c.api.tCardState;
  };
  const turnAt = (minAgo, more = {}) => ({ id: 'u-20261123-000000000-owner', by: 'owner', at: new Date(Date.now() - minAgo * MIN).toISOString(), text: 'hi', ...more });
  await it('C1 the card, before the turn lands: the send said "sent to the responder" or "busy", never "Not delivered"', () => {
    const tCardState = card();
    const pend = { turns: [turnAt(0, { id: undefined })] };
    assert.equal(tCardState(pend, Date.now(), 'responder', false, null), 'Sent to the responder.');
    assert.equal(tCardState(pend, Date.now(), 'queued', false, null), 'The responder is busy; it takes this next.');
  });
  await it('C4 the card for the responder\'s hold or a failed typing: "The responder hasn\'t taken it yet…", never "Not delivered" or the supervisor\'s hold', () => {
    const tCardState = card();
    const pend = { turns: [turnAt(0, { id: undefined })] };
    assert.equal(tCardState(pend, Date.now(), 'responder-late', true, null), "The responder hasn't taken it yet; the supervisor takes it if it waits 3 minutes.");
  });
  await it('C2 the card, once landed: a turn routed to the responder says so (typed, queued, and after 10 minutes)', () => {
    const tCardState = card();
    const sup = { checked: null, undelivered: [] };
    assert.equal(tCardState({ turns: [turnAt(1, { routed_to: 'responder', delivered: 'typed' })] }, Date.now(), undefined, true, sup), 'Sent to the responder.');
    assert.equal(tCardState({ turns: [turnAt(1, { routed_to: 'responder', delivered: 'queued' })] }, Date.now(), undefined, true, sup), 'The responder is busy; it takes this next.');
    assert.equal(tCardState({ turns: [turnAt(11, { routed_to: 'responder', delivered: 'typed' })] }, Date.now(), undefined, true, sup), "The responder hasn't replied yet.");
  });
  await it('C3 tlSend maps the send\'s words: responder, queued, responder-late (its hold or failed typing), and today\'s values', () => {
    const fn = html.slice(html.indexOf('function tlSend('), html.indexOf('\n}\n', html.indexOf('function tlSend(')));
    const at = fn.indexOf('TL.typed[p.real] =');
    assert.ok(at >= 0, 'tlSend sets TL.typed[p.real]');
    const rhs = fn.slice(at + 'TL.typed[p.real] ='.length, fn.indexOf(';\n', at));
    const typed = (said) => vm.runInNewContext(`(${rhs})`, { out: { out: `t-x\n${said}\n` } });
    assert.deepEqual([
      typed('sent to the responder'), typed('the responder is busy; it takes this next'),
      typed('recorded and held: the responder\'s terminal has a dialog up that only the terminal can answer'), typed('not delivered to the responder: no pane; it stays owed'),
      typed("sent to the supervisor's pane"), typed("recorded and held: the supervisor's terminal is asking a question"),
    ], ['responder', 'queued', 'responder-late', 'responder-late', true, 'held']);
  });

  // ---- done-when 3, 6: a reply's answering line names only the turns its writer answers (task-1 review F2) ----
  await it('Y1 thread reply prints answering only for the turns its writer answers: the responder\'s never names a turn routed to the supervisor', () => {
    const T = oldThread(30 * MIN);
    const U = F.ownerTurn(T, MIN, 'supervisor');
    const r = F.run(['thread', 'reply', T, '--', 'the responder adds a note'], RESPONDER);
    assert.equal(r.status, 0, r.err);
    assert.ok(!r.err.includes(`answering ${U}`), `the responder's reply: ${r.err}`);
    const s = after(() => F.run(['thread', 'reply', T, '--', 'the supervisor answers'], SUP));
    assert.equal(s.status, 0, s.err);
    assert.match(s.err, new RegExp(`answering ${U}`), 'the supervisor\'s reply answers it');
  });

  // ---- done-when 14: kit-314's handoff case ----
  await it('H1 the supervisor runs thread working on a turn the responder holds: the supervisor responding, the responder\'s stage gone', () => {
    const { T } = F.thread('Held by the responder');
    const rec = () => JSON.parse(fs.readFileSync(path.join(F.old, 'docs/devteam/run/thread-working.json'), 'utf8'))[T];
    F.run(['thread', 'working', T], RESPONDER);
    assert.equal(rec()?.by, 'responder');
    F.sup(['thread', 'working', T]);
    assert.equal(rec()?.by, 'supervisor');
  });

  // S checks need no wait; they run here
  // ---- done-when 8: supervisor.md ----
  const doc = fs.readFileSync(path.join(F.old, 'docs/devteam/process/supervisor.md'), 'utf8');
  await it('S1a supervisor.md §1 step 2 starts the responder', () => {
    const step2 = /^2\. .*$/m.exec(doc.slice(doc.indexOf('## 1. Starting up')))[0];
    assert.match(step2, /devteam\.mjs responder/);
  });
  await it('S1b supervisor.md §6 Threads: the responder takes turns first', () => {
    const threads = doc.slice(doc.indexOf('**Threads.**'), doc.indexOf('### Self and exterior changes'));
    assert.match(threads, /responder takes (the owner's )?turns first/i);
  });
  await it('S1c supervisor.md §6 Threads: the supervisor takes the threads of its own questions (thread ask)', () => {
    const bullet = doc.slice(doc.indexOf('**Threads.**'), doc.indexOf('### Self and exterior changes')).split('\n').find((l) => /responder takes/i.test(l)) ?? '';
    assert.match(bullet, /own (open )?questions?/);
  });
  await it('S1e supervisor.md §6 Threads, that bullet: a turn the responder answered is read and acked, never answered again', () => {
    const bullet = doc.slice(doc.indexOf('**Threads.**'), doc.indexOf('### Self and exterior changes')).split('\n').find((l) => /responder takes/i.test(l)) ?? '';
    assert.match(bullet, /unread ack/);
    assert.match(bullet, /never answer(ed)? (it )?again/);
  });
  await it('S1f supervisor.md §13: the responder leaves turns routed to the supervisor to it', () => {
    const s13 = doc.slice(doc.indexOf('## 13. The responder'));
    assert.match(s13, /routed to the supervisor/);
  });
  await it('S1d supervisor.md §6 Threads: the supervisor takes handoffs and responder-overdue', () => {
    const bullet = doc.slice(doc.indexOf('**Threads.**'), doc.indexOf('### Self and exterior changes')).split('\n').find((l) => /responder takes/i.test(l)) ?? '';
    assert.match(bullet, /handoff/);
    assert.match(bullet, /responder-overdue/);
  });
});
