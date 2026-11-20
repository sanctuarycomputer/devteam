// kit.test.mjs's threads test, parts 3 and 4 (kit-219; 1 and 2 are in kit.threads.test.mjs). The tick needs a supervisor reply in the log before it, so it stays after answer --from-turn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { threadsFixture, hasTmux, until } from './lib/kit.mjs';

test('threads: delivery, thread ask and ready', async (t) => {
  const F = threadsFixture();
  t.after(() => F.done());
  const show = (id) => JSON.parse(F.owner(['thread', 'show', id, '--json']));
  // a subject with an open thread takes no second one (kit-97): an earlier case's thread on it resolved first
  const freeOn = (ref) => { for (const x of JSON.parse(F.owner(['thread', 'list', '--json']))) if (x.status === 'open' && x.subject?.ref === ref) F.owner(['thread', 'resolve', x.id]); };
  await t.test("an owner turn is typed into the supervisor's pane as one line: its kind and id, never its title or capture", { skip: hasTmux ? false : 'no tmux' }, async () => {
    const pane = F.standIn();
    const P = { DEVTEAM_SUPERVISOR: pane.target };
    freeOn(`goal:${F.goal}`);
    const [T, said] = F.owner(['thread', 'new', 'Narrow this\nto the   EU\u001b[2J launch', '--title', 'TITLE-NOT-TYPED', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${F.goal}`, quote: 'CAPTURE-NOT-TYPED' })], P).split('\n');
    assert.equal(said, "sent to the supervisor's pane");
    const typed = await until(() => pane.typed().includes(T) && pane.typed(), 'the line in the pane');
    assert.ok(typed.includes(`[devteam thread ${T} from owner on goal ${F.goal}] Narrow this to the EU [2J launch — devteam.mjs thread show ${T}`), typed);
    assert.doesNotMatch(typed, /TITLE-NOT-TYPED|CAPTURE-NOT-TYPED|\u001b/);
    F.owner(['thread', 'say', T, 'w'.repeat(400)], P);
    await until(() => pane.typed().includes(`${'w'.repeat(300)}… — devteam.mjs thread show ${T}`), 'the first 300 bytes, then …');
    const [P2] = F.owner(['thread', 'new', 'This bit', '--title', 'the dashboard · Loop', '--subject', JSON.stringify({ kind: 'page', view: '#loop/observe', at: { x: 0.2, y: 0.4 }, quote: 'Loop' })], P).split('\n');
    await until(() => pane.typed().includes(`[devteam thread ${P2} from owner on the dashboard] This bit`), 'a page subject: on the dashboard');
    // a preview: its name, never its route, anchor or errors, which the previewed page wrote
    const [V] = F.owner(['thread', 'new', 'Look here', '--title', 'TITLE-NOT-TYPED', '--subject', JSON.stringify({ kind: 'preview', name: 'cool-tiger', route: '/ROUTE-NOT-TYPED?x="y"', viewport: { w: 1280, h: 800 }, anchor: { text: 'ANCHOR-NOT-TYPED', selector: 'main' }, errors: ['ERROR-NOT-TYPED'] })], P).split('\n');
    const typedV = await until(() => pane.typed().includes(`thread show ${V}`) && pane.typed(), 'a preview subject');
    const lineV = typedV.split(/[\r\n]+/).find((l) => l.includes(V));
    assert.equal(lineV, `[devteam thread ${V} from owner on preview cool-tiger] Look here — devteam.mjs thread show ${V}`);
    assert.doesNotMatch(typedV, /ROUTE-NOT-TYPED|ANCHOR-NOT-TYPED|ERROR-NOT-TYPED|TITLE-NOT-TYPED|1280x|w: 1280/);
    assert.match(F.owner(['thread', 'say', T, 'hello'], { DEVTEAM_SUPERVISOR: 'no-such-session:0' }).split('\n')[1], /^not delivered: no supervisor terminal took it/);
  });

  await t.test('a turn wakes wait, which says to read the threads waiting on the supervisor', async () => {
    const T = F.owner(['thread', 'new', 'Wake up']).split('\n')[0];
    // since after the thread and its first turn, so only the turn below is new to wait
    await new Promise((r) => setTimeout(r, 50));
    fs.writeFileSync(path.join(F.old, 'docs/devteam/run/wait-since'), `${Date.now()}\n`);
    await new Promise((r) => setTimeout(r, 50));
    const w = spawn(process.execPath, [path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), 'wait', '--minutes', '1'], { cwd: F.old, env: F.env(F.SUP), stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '';
    w.stdout.on('data', (b) => { o += b; });
    const U = F.owner(['thread', 'say', T, 'Are you there?']).split('\n')[0];
    await new Promise((r) => w.on('close', r));
    assert.match(o, /something needs you:/);
    assert.ok(o.includes(`new line(s) from the owner: ${U} (questions --all, history --tail 20; a thread: thread list --waiting)`), `the turn woke it, with the pointer: ${o}`);
    assert.ok(!o.includes(T), 'the thread from before is not new');
  });

  await t.test("thread ask asks an Inbox question exactly as ask does, plus its thread, and a turn naming it", () => {
    const T = F.owner(['thread', 'new', 'Should we narrow this?', '--title', 'Launch checkout', '--subject', JSON.stringify({ kind: 'item', ref: 'ticket:thread-ask' })]).split('\n')[0];
    const ask = ['--question', 'Narrow the goal to EU orders?', '--choices', JSON.stringify([{ label: 'Yes' }, { label: 'Not yet' }]), '--recommendation', 'Yes', '--goal', F.goal, '--stake', '2', '--urgency', '1'];
    const Q1 = F.sup(['thread', 'ask', T, ...ask]);
    const Q2 = F.sup(['ask', ...ask]);
    assert.match(Q1, /^q-\d{8}-\d{9}-supervisor$/, 'the question id alone, as ask prints it');
    const raw = (id) => { const { id: _, created_at, updates, ...o } = JSON.parse(F.owner(['log', '--id', id, '--json']))[0]; return o; };
    assert.deepEqual(raw(Q1), { ...raw(Q2), thread: T }, "nothing about the question differs from ask's but its thread");
    const v = show(T);
    const last = v.turns[v.turns.length - 1];
    assert.deepEqual([last.by, last.question, last.text, v.questions.map((q) => [q.id, q.status])], ['supervisor', Q1, 'Narrow the goal to EU orders?', [[Q1, 'open']]]);
    const inbox = JSON.parse(F.owner(['dashboard-data'])).questions.find((q) => q.id === Q1);
    assert.deepEqual([inbox.thread, inbox.thread_title], [T, 'Launch checkout'], 'the Inbox says which thread asked it');
    assert.equal(JSON.parse(F.owner(['dashboard-data'])).questions.find((q) => q.id === Q2).thread, null);
    // ask's refusals are thread ask's, and a refused question leaves no turn
    const turns = v.turns.length;
    assert.match(F.fails(['thread', 'ask', T, '--choices', '[]'], F.SUP), /ask needs --question/);
    // a question whose turn the log could not hold is refused before the question is written
    const qs = () => JSON.parse(F.owner(['questions', '--all', '--json'])).length;
    const nq = qs();
    assert.match(F.fails(['thread', 'ask', T, ...ask.slice(2), '--question', `${'\\'.repeat(1950)}?`], F.SUP), /too many quotation marks, backslashes or control characters/);
    assert.deepEqual([qs(), show(T).turns.length], [nq, turns], 'no question and no turn');
    assert.match(F.fails(['thread', 'ask', T, ...ask], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'demo-01-x' }), /the supervisor does this/);
    assert.equal(show(T).turns.length, turns);
    assert.match(F.fails(['thread', 'ask', 't-20990101-000000000-owner', ...ask], F.SUP), /no thread/);
    F.sup(['withdraw', Q2, '--reason', 'asked twice in a test']);
  });

  await t.test('ready, Not yet, ready again, accept: the supervisor proposes, only the owner closes, and the loop gets an observation', () => {
    freeOn(`goal:${F.goal}`);
    const T = F.owner(['thread', 'new', 'Narrow this to the EU launch', '--title', 'Launch checkout', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${F.goal}` })]).split('\n')[0];
    F.sup(['thread', 'reply', T, 'Done: the goal says EU orders now.', '--refs', `goal:${F.goal}`]);
    assert.match(F.sup(['thread', 'ready', T, '--outcome', 'Goal narrowed to EU orders']), /proposed resolving/);
    assert.equal(show(T).ready.outcome, 'Goal narrowed to EU orders');
    const firstAt = show(T).ready.at;
    F.sup(['thread', 'ready', T, '--outcome', 'Goal narrowed to EU orders, the US later']);
    assert.equal(show(T).ready.outcome, 'Goal narrowed to EU orders, the US later', 'a new proposal replaces the standing one');
    assert.match(F.fails(['thread', 'ready', T, '--outcome', 'x'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'demo-01-x' }), /the supervisor does this/);
    assert.match(F.fails(['thread', 'ready', T], F.SUP), /needs --outcome/);
    // with no role, in the main checkout, a supervisor command is the supervisor's (as ask is)
    const R = F.owner(['thread', 'new', 'A quick one']).split('\n')[0];
    F.owner(['thread', 'ready', R, '--outcome', 'done']);
    assert.deepEqual([show(R).ready.outcome, JSON.parse(F.owner(['log', '--id', R, '--json']))[0].updates.pop().by], ['done', 'supervisor']);
    F.owner(['thread', 'resolve', R, '--accept']);
    assert.match(F.fails(['thread', 'resolve', T], F.SUP), /owner commands don't run in an agent session/);
    F.owner(['thread', 'say', T, 'Not yet']);
    assert.equal(show(T).ready, null, "the owner's newer turn clears it");
    F.sup(['thread', 'ready', T, '--outcome', 'EU only, US next quarter']);
    const Q = F.sup(['thread', 'ask', T, '--question', 'Tell the US team?', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
    // accepting the proposal the owner saw: an older one is refused, the one standing is taken
    assert.notEqual(show(T).ready.at, firstAt);
    assert.match(F.fails(['thread', 'resolve', T, '--accept', '--at', firstAt]), /The supervisor changed its proposal; read it again\./);
    assert.equal(show(T).status, 'open', 'not resolved');
    const said = F.owner(['thread', 'resolve', T, '--accept', '--at', show(T).ready.at]);
    assert.match(said, new RegExp(`^resolved ${T}: EU only, US next quarter`));
    assert.match(said, new RegExp(`1 question asked in it is still open in the Inbox: ${Q}`));
    let v = show(T);
    assert.deepEqual([v.status, v.outcome, v.ready], ['resolved', 'EU only, US next quarter', null]);
    const obs = () => JSON.parse(F.owner(['log', '--type', 'observation', '--json'])).filter((o) => o.kind === 'thread-resolved' && o.subject === `thread:${T}`);
    assert.deepEqual(obs().map((o) => [o.created_by, o.source, o.detail, o.refs]), [['owner', 'owner', 'EU only, US next quarter', [T, F.goal]]]);
    assert.equal(JSON.parse(F.owner(['questions', '--id', Q, '--json']))[0].status, 'open', 'its question stays in the Inbox');
    // a resolved thread takes no turns: the owner reopens it first
    assert.match(F.fails(['thread', 'reply', T, 'x'], F.SUP), /resolved: the owner closed it/);
    assert.match(F.fails(['thread', 'say', T, 'x']), /reopen it first/);
    assert.match(F.fails(['thread', 'ready', T, '--outcome', 'x'], F.SUP), /resolved/);
    assert.match(F.fails(['thread', 'resolve', T]), /resolved; reopen it first/);
    // reopened with words, then resolved with none: no outcome carried over from the first time
    F.owner(['thread', 'reopen', T, 'One more thing']);
    v = show(T);
    assert.deepEqual([v.status, v.outcome, v.turns[v.turns.length - 1].text], ['open', null, 'One more thing']);
    F.owner(['thread', 'resolve', T]);
    assert.deepEqual([show(T).status, show(T).outcome], ['resolved', null]);
    assert.deepEqual(obs().map((o) => o.detail), ['EU only, US next quarter', 'resolved']);
    F.owner(['thread', 'reopen', T]);
    assert.equal(show(T).status, 'open');
    assert.match(F.fails(['thread', 'reopen', T]), /is open/);
    assert.match(F.fails(['thread', 'resolve', T, '--accept']), /no proposal from the supervisor to accept/);
    F.owner(['thread', 'resolve', T, '--outcome', 'done for now']);
    assert.match(F.fails(['thread', 'resolve', 't-20990101-000000000-owner']), /no thread/);
    // a resolved thread takes no question either
    const R2 = F.owner(['thread', 'new', 'Another']).split('\n')[0];
    F.owner(['thread', 'resolve', R2]);
    assert.match(F.fails(['thread', 'ask', R2, '--question', 'Still there?', '--goal', F.goal, '--stake', '1', '--urgency', '1'], F.SUP), /resolved: the owner closed it/);
    F.sup(['withdraw', Q, '--reason', 'test']);
  });
});

test('threads: answers from a turn, the tick and thread show', async (t) => {
  const F = threadsFixture();
  t.after(() => F.done());
  const show = (id) => JSON.parse(F.owner(['thread', 'show', id, '--json']));
  // a subject with an open thread takes no second one (kit-97): an earlier case's thread on it resolved first
  const freeOn = (ref) => { for (const x of JSON.parse(F.owner(['thread', 'list', '--json']))) if (x.status === 'open' && x.subject?.ref === ref) F.owner(['thread', 'resolve', x.id]); };
  await t.test("answer --from-turn: the owner's words from their turn, channel thread, one turn for one question bound to it", () => {
    const T = F.owner(['thread', 'new', 'Narrow this?', '--title', 'Launch checkout', '--subject', JSON.stringify({ kind: 'item', ref: 'ticket:from-turn' })]).split('\n')[0];
    const T2 = F.owner(['thread', 'new', 'Something else']).split('\n')[0];
    const before = show(T).turns[0].id;
    const Q = F.sup(['thread', 'ask', T, '--question', 'Narrow the goal to EU orders?', '--recommendation', 'Yes', '--goal', F.goal, '--stake', '2', '--urgency', '1']);
    const U = F.owner(['thread', 'say', T, 'yes, go ahead']).split('\n')[0];
    const S = F.sup(['thread', 'reply', T, 'On it.']);
    const SR = F.owner(['thread', 'reply', T, 'Still on it.']);
    const elsewhere = F.owner(['thread', 'say', T2, 'yes']).split('\n')[0];
    assert.match(F.fails(['answer', Q, 'Yes', '--from-turn', U]), /the supervisor records what the owner said in a thread/);
    assert.match(F.fails(['answer', Q, 'Yes', '--from-turn', U], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'demo-01-x' }), /the supervisor records/);
    assert.match(F.fails(['answer', Q, 'Yes', '--from-turn', S], F.SUP), /that turn is the supervisor's/);
    assert.match(F.fails(['answer', Q, 'Yes', '--from-turn', SR], F.SUP), /that turn is the supervisor's/, 'a reply with no role set is the supervisor\'s too');
    assert.match(F.fails(['answer', Q, 'Yes', '--from-turn', before], F.SUP), /older than/);
    assert.match(F.fails(['answer', Q, 'Yes', '--from-turn', elsewhere], F.SUP), new RegExp(`was asked in ${T}, and that turn is in ${T2}`));
    assert.match(F.fails(['answer', Q, 'Yes', '--from-turn', 'u-20990101-000000000-owner'], F.SUP), /no such turn/);
    assert.match(F.fails(['answer', Q, 'Yes', '--from-turn', U, '--from-chat', '--said', 'x'], F.SUP), /not both/);
    assert.match(F.sup(['answer', Q, 'Yes', '--from-turn', U]), new RegExp(`answered ${Q} \\(from ${U}; listed on the dashboard for the owner to check\\)`));
    const q = JSON.parse(F.owner(['questions', '--id', Q, '--json']))[0];
    assert.deepEqual([q.status, q.answered_by, q.channel, q.said, q.turn, q.matched], ['answered', 'owner', 'thread', 'yes, go ahead', U, true]);
    assert.equal(show(T).questions[0].status, 'answered');
    // one turn settles one question
    const Q3 = F.sup(['thread', 'ask', T, '--question', 'And tell the US team?', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
    const later = F.owner(['thread', 'say', T, 'yes to that too']).split('\n')[0];
    assert.match(F.fails(['answer', Q3, 'yes', '--from-turn', U], F.SUP), new RegExp(`already settled ${Q}`));
    F.sup(['answer', Q3, 'yes', '--from-turn', later]);
    // a decision raised in the Inbox, settled in a thread: the turn must be newer than the question
    const UO = F.owner(['thread', 'say', T2, 'said before the question']).split('\n')[0];
    const QI = F.sup(['ask', '--question', 'Ship the EU banner?', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
    assert.match(F.fails(['answer', QI, 'yes', '--from-turn', UO], F.SUP), /older than/);
    // and the supervisor named it in that thread first, so the owner's words were said to it: a yes
    // in a thread that never heard of the question (it may have said yes to another) settles nothing
    const U1 = F.owner(['thread', 'say', T2, 'yes']).split('\n')[0];
    assert.match(F.fails(['answer', QI, 'yes', '--from-turn', U1], F.SUP), new RegExp(`${QI} was asked in the Inbox, and no reply of yours in ${T2} named it before that turn`));
    F.sup(['thread', 'reply', T2, 'One from the Inbox: ship the EU banner?', '--refs', `question:${QI}`]);
    assert.match(F.fails(['answer', QI, 'yes', '--from-turn', U1], F.SUP), /no reply of yours .* named it before that turn/, 'named after the owner spoke: still not bound');
    const U2 = F.owner(['thread', 'say', T2, 'ship the banner']).split('\n')[0];
    F.sup(['answer', QI, 'yes', '--from-turn', U2, '--rule', 'Ship banners without asking']);
    const rule = JSON.parse(F.owner(['log', '--type', 'knowledge', '--json'])).find((k) => k.statement === 'Ship banners without asking');
    assert.deepEqual([rule.channel, rule.evidence], ['thread', [QI]], 'the rule names the question, which names the turn');
    const listed = JSON.parse(F.owner(['dashboard-data'])).ooda.answered.find((x) => x.id === QI);
    assert.deepEqual([listed.channel, listed.said], ['thread', 'ship the banner'], 'listed for the owner to check, as chat answers are');
    // a goal verdict, from a turn
    const A = F.approval();
    F.sup(['thread', 'reply', T2, 'Approve the checkout goal as designed?', '--refs', `question:${A.question}`]);
    const UA = F.owner(['thread', 'say', T2, 'approve it']).split('\n')[0];
    assert.match(F.fails(['answer', A.question, 'Approve', '--from-turn', UA], F.SUP), /goal decide .* --from-turn/);
    // the read side: a real --from-turn answer raises nothing; a hand-written line breaking a binding rule does
    const unbound = () => JSON.parse(F.owner(['metrics', '--json'])).findings.filter((f) => f.kind === 'thread-answer-unbound');
    assert.deepEqual(unbound(), []);
    const set = (id, o) => ['owner', { type: 'question', op: 'set', id, answer: 'yes', channel: 'thread', ...o }];
    const Q4 = F.sup(['thread', 'ask', T, '--question', 'Tell the UK team?', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
    const U4 = F.owner(['thread', 'say', T, 'tell them']).split('\n')[0];
    const Q5 = F.sup(['thread', 'ask', T, '--question', 'And the AU team?', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
    const U5 = F.owner(['thread', 'say', T, 'them too']).split('\n')[0];
    F.sup(['answer', Q5, 'yes', '--from-turn', U5]);
    const cases = [
      [/names no turn/, { turn: 'u-20990101-000000000-owner', said: 'x' }],
      [/supervisor's/, { turn: S, said: 'On it.' }],
      [/aren't what the turn says/, { turn: U4, said: 'something else' }],
      [/another thread/, { turn: elsewhere, said: 'yes' }],
      [/before the question/, { turn: before, said: show(T).turns[0].text }],
      [/already settled/, { turn: U5, said: 'them too' }],
    ];
    for (const [why, o] of cases) {
      const snap = F.snapLog();
      try {
        F.hand(...set(Q4, o), 0);
        const found = unbound();
        assert.deepEqual(found.map((f) => f.subject), [Q4], String(why));
        assert.match(found[0].detail, why);
        assert.equal(found[0].severity, 'medium');
      } finally { F.restoreLog(snap); }
    }
    // an Inbox question settled by a turn its thread never named it before
    {
      const snap = F.snapLog();
      try {
        const QN = F.sup(['ask', '--question', 'Pause the UK launch?', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
        const UN = F.owner(['thread', 'say', T2, 'yes, do it']).split('\n')[0];
        F.hand(...set(QN, { turn: UN, said: 'yes, do it' }), 0);
        const found = unbound();
        assert.deepEqual(found.map((f) => f.subject), [QN]);
        assert.match(found[0].detail, /cites a turn in a thread where the supervisor hadn't named the question before it/);
      } finally { F.restoreLog(snap); }
    }
    // a review takes no turn; a missing or malformed id is refused
    const snapRV = F.snapLog();
    try {
      const RV = F.hand('supervisor', { type: 'question', kind: 'review', question: 'Does it look right?', stake: 1, urgency: 1 }, 500);
      assert.match(F.fails(['answer', RV, 'x', '--from-turn', U4], F.SUP), /is a review/);
    } finally { F.restoreLog(snapRV); }
    assert.match(F.fails(['answer', Q4, 'yes', '--from-turn', 'nonsense'], F.SUP), /--from-turn <u-id>/);
    assert.match(F.fails(['answer', Q4, 'yes', '--from-turn'], F.SUP), /--from-turn <u-id>/);
    // goal decide takes the same refusals: the owner's turn only, one turn for one question, newer than it
    assert.match(F.fails(['goal', 'decide', A.goal, 'approve', '--from-turn', U], F.SUP), /already settled/);
    assert.match(F.fails(['goal', 'decide', A.goal, 'approve', '--from-turn', S], F.SUP), /that turn is the supervisor's/);
    assert.match(F.fails(['goal', 'decide', A.goal, 'approve', '--from-turn', UA]), /the supervisor records/);
    assert.match(F.fails(['goal', 'decide', A.goal, 'approve', '--from-turn', before], F.SUP), /older than/);
    F.sup(['goal', 'decide', A.goal, 'approve', '--from-turn', UA]);
    assert.equal(JSON.parse(F.owner(['goal', 'show', A.goal, '--json'])).status, 'ready');
    const qa = JSON.parse(F.owner(['questions', '--id', A.question, '--json']))[0];
    assert.deepEqual([qa.status, qa.channel, qa.said, qa.turn], ['answered', 'thread', 'approve it', UA]);
    assert.match(F.fails(['goal', 'decide', A.goal, 'restore', '--from-turn', UA], F.SUP), /doesn't come from a thread/);
  });

  await t.test('the tick: thread-waiting after 10 minutes, and metrics counts open threads, those waiting and the first reply', () => {
    const snap = F.snapLog();
    try {
      const old = F.hand('owner', { type: 'thread', title: 'An old one' }, 16 * 60000);
      F.hand('owner', { type: 'turn', thread: old, text: 'Anyone?' }, 15 * 60000);
      const fresh = F.hand('owner', { type: 'thread', title: 'A new one' }, 6 * 60000);
      F.hand('owner', { type: 'turn', thread: fresh, text: 'Hello' }, 5 * 60000);
      const m = JSON.parse(F.owner(['metrics', '--json']));
      // (threads from the subtests before may be waiting too, on a slow machine: only these two count here)
      const waiting = m.findings.filter((f) => f.kind === 'thread-waiting' && [old, fresh].includes(f.subject));
      assert.deepEqual(waiting.map((f) => [f.severity, f.subject]), [['medium', old]], 'only the one past 10 minutes');
      assert.match(waiting[0].detail, /^the owner wrote in this thread \d+ min ago and has no reply$/, 'by id only: no title');
      assert.match(waiting[0].suggestion, /thread list --waiting/);
      const open = JSON.parse(F.owner(['thread', 'list', '--json']));
      assert.deepEqual([m.threads.open, m.threads.waiting_on_supervisor], [open.length, open.filter((x) => x.waiting === 'supervisor').length]);
      assert.equal(typeof m.threads.median_first_reply_minutes, 'number');
      F.sup(['observe-metrics']);
      assert.ok(JSON.parse(F.owner(['log', '--type', 'observation', '--json'])).some((o) => o.kind === 'thread-waiting' && o.subject === old));
      F.sup(['thread', 'reply', old, 'Sorry, here now.']);
      assert.ok(!JSON.parse(F.owner(['metrics', '--json'])).findings.some((f) => f.kind === 'thread-waiting' && f.subject === old), 'a reply settles it');
    } finally { F.restoreLog(snap); }
  });
  await t.test("thread show prints a turn's lines as written, without a control character a terminal would act on", () => {
    const T = F.owner(['thread', 'new', 'Show me']).split('\n')[0];
    // as a line written by hand could hold them: an escape, a bidi override, a CR, a bell. A few ms
    // ahead, so its id never lands on the same millisecond as the thread's first turn (a duplicate id is ignored)
    F.hand('owner', { type: 'turn', thread: T, text: 'first line\u001b[2J\nsecond\u202eline\r\nthird\u0007' }, -5);
    const shown = F.sup(['thread', 'show', T]);
    assert.match(shown, /^ {2}first line\[2J\n {2}secondline\n {2}third$/m, 'its own line breaks kept, each line indented');
    assert.doesNotMatch(shown, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/, 'nothing else a terminal acts on');
    // a tab is a space between words, not nothing
    F.hand('owner', { type: 'turn', thread: T, text: 'tabbed\twords\there' }, -10);
    assert.match(F.sup(['thread', 'show', T]), /^ {2}tabbed words here$/m);
  });
});
