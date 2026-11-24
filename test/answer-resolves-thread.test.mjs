// Answering a question resolves its thread (kit-720, question-threads D2): the thread whose subject
// is the question ("Ask about this") ends with the answer, on every path where the answer is the
// owner's own; the supervisor's record of the owner's turn in that thread proposes it instead; chat,
// a default, a withdrawal and a review sent back leave it open; and a thread the log would refuse to
// resolve leaves the answer standing, with a warning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { firstId, RATE, SUP, TEXTS, YN } from './lib/answer-words-fixture.mjs';
import { freePort, pastDeadline, startDashboard, threadsFixture, until, write } from './lib/kit.mjs';

const OUTCOME_MAX = 300;

function fixture(t, name) {
  const F = threadsFixture(name);
  t.after(() => F.done());
  let n = 0;
  // a plain Inbox question, its words distinct (the kit refuses a re-ask)
  const ask = (extra = []) => firstId(F.sup(['ask', '--question', `${TEXTS[n++]} (${name} ${n})`, '--choices', YN, '--recommendation', 'Yes', ...RATE, ...extra]));
  // the owner's "Ask about this": a thread whose subject is the question
  const about = (q, words = 'Tell me more about this') => F.owner(['thread', 'new', words, '--subject', JSON.stringify({ kind: 'item', ref: `question:${q}` })]).split('\n')[0];
  const show = (id) => JSON.parse(F.owner(['thread', 'show', id, '--json']));
  const lines = () => fs.readdirSync(F.logDir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(F.logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).sort((a, b) => a.at.localeCompare(b.at));
  const answerLine = (q) => lines().filter((l) => l.id === q && l.op === 'set' && l.by === 'owner' && l.answer !== undefined).pop();
  const setsOn = (id) => lines().filter((l) => l.id === id && l.op === 'set');
  const resolvedObs = (id) => lines().filter((l) => l.type === 'observation' && l.kind === 'thread-resolved' && l.subject === `thread:${id}`);
  // resolved by the owner, after the answer line, with this outcome and its observation
  const resolvedBy = (T, q, outcome, channel = 'cli') => {
    const v = show(T);
    assert.deepEqual([v.status, v.outcome], ['resolved', outcome], `${T} resolved with the answer`);
    const set = setsOn(T).filter((l) => l.status !== undefined);
    assert.equal(set.length, 1, 'one status line');
    assert.deepEqual([set[0].by, set[0].channel, set[0].status, set[0].outcome], ['owner', channel, 'resolved', outcome], 'the owner\'s thread set');
    const a = answerLine(q);
    assert.ok(a, `${q} has the owner's answer`);
    assert.ok(set[0].at > a.at, 'the thread set is written after the answer line');
    const o = resolvedObs(T);
    assert.equal(o.length, 1, 'one thread-resolved observation');
    assert.deepEqual([o[0].by, o[0].source, o[0].detail, o[0].refs], ['owner', 'owner', outcome, [T, q]]);
  };
  const stillOpen = (T, why) => {
    const v = show(T);
    assert.deepEqual([v.status, v.ready], ['open', null], `${T} left open, with no proposal: ${why}`);
    assert.equal(setsOn(T).length, 0, `no thread line on ${T}: ${why}`);
    assert.equal(resolvedObs(T).length, 0, `no thread-resolved observation for ${T}: ${why}`);
  };
  return { F, ask, about, show, lines, answerLine, setsOn, resolvedObs, resolvedBy, stillOpen };
}

// A ready goal read from a repo check that meets its target (as answer-words.answer-line.test.mjs's).
function readyGoal(F) {
  write(path.join(F.old, 'gaps.txt'), '0\n');
  F.g(['add', '-A'], F.old);
  F.g(['commit', '-qm', 'gaps'], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
  const G = F.ok(F.old, ['goal', 'add', '--title', 'Floor repo', '--outcome', 'the floor holds', '--measure', 'floor gaps', '--target', '0', '--unit', 'gaps', '--direction', 'down', '--source', 'repo', '--check', 'cat gaps.txt', '--non-goals', 'none', '--preconditions', 'a', 'b'], SUP);
  F.ok(F.old, ['goal', 'decide', G, 'approve', '--force']);
  F.ok(F.old, ['goal', 'reading', G, '--run'], SUP);
  return G;
}

test('answer resolves its thread: the owner\'s answer on every path resolves the open thread about the question, with the answer as its outcome', async (t) => {
  const X = fixture(t, 'resolves');
  const { F } = X;

  // the CLI: one line, the answer's words flattened
  const Q = X.ask();
  const T = X.about(Q);
  const said = F.owner(['answer', Q, 'Yes,\tship it\n  now']);
  X.resolvedBy(T, Q, 'Answered: Yes, ship it now');
  assert.match(said, new RegExp(`resolved ${T}: Answered: Yes, ship it now`), 'the command says so');

  // a long answer is cut to OUTCOME_MAX bytes, with "…", never mid-character
  const Ql = X.ask();
  const Tl = X.about(Ql);
  F.owner(['answer', Ql, `Yes ${'é'.repeat(400)}`]);
  const cut = `Answered: Yes ${'é'.repeat(Math.floor((OUTCOME_MAX - 3 - Buffer.byteLength('Answered: Yes ')) / 2))}…`;
  assert.ok(Buffer.byteLength(cut) <= OUTCOME_MAX);
  X.resolvedBy(Tl, Ql, cut);

  // goal decide on a goal-approval
  const A = F.approval();
  const Ta = X.about(A.question);
  const Tag = F.owner(['thread', 'new', 'The design?', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${A.goal}` })]).split('\n')[0];
  F.owner(['goal', 'decide', A.goal, 'approve', '--notes', 'go\nahead']);
  X.resolvedBy(Ta, A.question, 'Answered: Approve — go ahead');
  X.stillOpen(Tag, 'the goal\'s own thread is another subject');

  // goal status met on a goal-met question
  const G = readyGoal(F);
  const Qm = F.ok(F.old, ['ask', '--class', 'goal-met', '--goal', G, '--recommendation', 'yes'], SUP).split('\n')[0];
  const Tm = X.about(Qm);
  F.owner(['goal', 'status', G, 'met']);
  X.resolvedBy(Tm, Qm, 'Answered: Yes');

  // secret post, once complete: a partial post leaves it open
  write(path.join(F.old, '.gitignore'), 'secrets/\n');
  F.g(['add', '-A'], F.old);
  F.g(['commit', '-qm', 'ignore secrets'], F.old);
  const Qs = firstId(F.sup(['ask', '--kind', 'owner-action', '--question', 'Post the two API keys', '--secrets', JSON.stringify([{ name: 'KEY', sink: 'file:secrets/key.txt' }, { name: 'KEY2', sink: 'file:secrets/key2.txt' }]), ...RATE]));
  const Ts = X.about(Qs);
  F.ok(F.old, ['secret', 'post', Qs, '--json'], {}, JSON.stringify({ KEY: 'one' }));
  X.stillOpen(Ts, 'one secret of two posted');
  F.ok(F.old, ['secret', 'post', Qs, '--json'], {}, JSON.stringify({ KEY2: 'two' }));
  X.resolvedBy(Ts, Qs, 'Answered: Posted 2 secrets');

  // the dashboard: POST /api/answer, and a review approved through POST /api/review-answer
  write(path.join(F.old, 'review/page.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Check it</title></head><body><p>Look.</p></body></html>\n');
  F.g(['add', '-A'], F.old);
  F.g(['commit', '-qm', 'review page'], F.old);
  const Qr = firstId(F.sup(['ask', '--kind', 'review', '--question', 'Does the page look right?', '--ref', 'main', '--page', 'review/page.html', ...RATE]));
  const Tr = X.about(Qr);
  const Qd = X.ask();
  const Td = X.about(Qd);
  const port = await freePort();
  const B = `http://127.0.0.1:${port}`;
  const d = startDashboard(F.old, F.env({}), ['--port', String(port)]);
  t.after(() => d.stop());
  await until(() => new RegExp(`dashboard on http://127\\.0\\.0\\.1:${port}\\b`).test(d.out()), 'the dashboard');
  const post = (name, body) => fetch(`${B}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) });
  let r = await post('answer', { id: Qd, answer: 'Yes from the page' });
  assert.equal(r.status, 200, await r.clone().text());
  X.resolvedBy(Td, Qd, 'Answered: Yes from the page', 'dashboard');
  const page = JSON.parse(F.owner(['questions', '--id', Qr, '--json']))[0].review.page.sha256;
  const result = { v: 1, question: Qr, review_sha256: page };
  const text = JSON.stringify(result);
  r = await post('review-answer', { id: Qr, result, sha256: crypto.createHash('sha256').update(text).digest('hex') });
  assert.equal(r.status, 200, await r.clone().text());
  // a review's answer line already says Answered: the outcome doesn't say it twice
  const ra = X.answerLine(Qr).answer;
  assert.match(ra, /^Answered: \d+ bytes, sha256 [0-9a-f]{12}$/);
  X.resolvedBy(Tr, Qr, ra, 'dashboard');
});

test('answer from the thread: the supervisor\'s record of the owner\'s turn in the question\'s thread proposes resolving it, in the owner\'s words, and the owner\'s Accept resolves it', (t) => {
  const X = fixture(t, 'from-turn');
  const { F } = X;
  const supLines = (T) => X.setsOn(T).filter((l) => l.by !== 'owner');
  const proposes = (T, q, owner) => {
    const v = X.show(T);
    const want = `Answered in thread: ${owner}`;
    assert.ok(!supLines(T).some((l) => l.status !== undefined), 'no line by the supervisor sets the thread\'s status');
    assert.ok(!String(v.ready?.outcome).includes('SUPWORDS'), 'none of the supervisor\'s own answer words');
    assert.deepEqual([v.status, v.ready?.outcome], ['open', want], `${T} open, with the supervisor's proposal in the owner's words`);
    assert.equal(X.resolvedObs(T).length, 0, 'not resolved, so no observation yet');
    assert.equal(X.answerLine(q).channel, 'thread', 'the answer is recorded from the turn');
    // the owner's Accept resolves it with that outcome
    F.owner(['thread', 'resolve', T, '--accept', '--at', v.ready.at]);
    assert.deepEqual([X.show(T).status, X.show(T).outcome], ['resolved', want]);
  };

  // answer --from-turn
  const Q = X.ask();
  const T = X.about(Q, 'Why this one?');
  F.sup(['thread', 'reply', T, 'Because it blocks the launch. Ship it?', '--refs', `question:${Q}`]);
  const U = F.owner(['thread', 'say', T, 'Yes,\n go ahead']).split('\n')[0];
  F.sup(['answer', Q, 'SUPWORDS Yes', '--from-turn', U]);
  proposes(T, Q, 'Yes, go ahead');

  // goal decide --from-turn
  const A = F.approval();
  const Ta = X.about(A.question, 'Is the design sound?');
  F.sup(['thread', 'reply', Ta, 'It is. Approve it?', '--refs', `question:${A.question}`]);
  const Ua = F.owner(['thread', 'say', Ta, 'Approve it, then']).split('\n')[0];
  F.sup(['goal', 'decide', A.goal, 'approve', '--from-turn', Ua]);
  proposes(Ta, A.question, 'Approve it, then');

  // a long turn is cut to OUTCOME_MAX bytes with "…"
  const Ql = X.ask();
  const Tl = X.about(Ql, 'Long one');
  F.sup(['thread', 'reply', Tl, 'Yes or no?', '--refs', `question:${Ql}`]);
  const Ul = F.owner(['thread', 'say', Tl, `Yes ${'x'.repeat(600)}`]).split('\n')[0];
  F.sup(['answer', Ql, 'Yes', '--from-turn', Ul]);
  const o = X.show(Tl).ready.outcome;
  assert.equal(o, `Answered in thread: Yes ${'x'.repeat(OUTCOME_MAX - 3 - Buffer.byteLength('Answered in thread: Yes '))}…`);
});

test('answer leaves threads: chat, a default, a turn in another thread, a withdrawal, a review sent back and an answer that isn\'t the owner\'s leave the thread open', (t) => {
  const X = fixture(t, 'leaves');
  const { F } = X;

  // a thread on another question, or on another subject, is untouched by an answer
  const Qx = X.ask();
  const Tx = X.about(Qx);
  const Qo = X.ask();
  const To = X.about(Qo);
  const Tg = F.owner(['thread', 'new', 'And the goal?', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${F.goal}` })]).split('\n')[0];
  F.owner(['answer', Qx, 'Yes']);
  assert.equal(X.show(Tx).status, 'resolved', 'the question\'s own thread resolves');
  X.stillOpen(Tg, 'a thread on another subject');
  X.stillOpen(To, 'a thread on another question');

  // a thread the owner already resolved by hand keeps the owner's outcome: only open threads are
  // resolved, so the answer resolves the second thread they opened on it and no other
  const Qh = X.ask();
  const Th = X.about(Qh, 'First go');
  F.owner(['thread', 'resolve', Th, '--outcome', 'settled it myself']);
  const Th2 = X.about(Qh, 'Second go');
  F.owner(['answer', Qh, 'Yes']);
  assert.deepEqual([X.setsOn(Th).filter((l) => l.status !== undefined).map((l) => l.outcome), X.resolvedObs(Th).length], [['settled it myself'], 1], 'the thread resolved by hand is untouched');
  assert.deepEqual([X.show(Th2).status, X.show(Th2).outcome], ['resolved', 'Answered: Yes']);

  // --defaulted
  const Qd = X.ask(['--default', 'No']);
  const Td = X.about(Qd);
  pastDeadline(F.old, Qd);
  F.sup(['answer', Qd, '--defaulted']);
  X.stillOpen(Td, '--defaulted');

  // answer --from-chat
  const Qc = X.ask();
  const Tc = X.about(Qc);
  F.sup(['answer', Qc, 'Yes', '--from-chat', '--said', 'yes do it']);
  assert.equal(X.answerLine(Qc).channel, 'chat');
  X.stillOpen(Tc, 'answer --from-chat');

  // goal decide --from-chat
  const A = F.approval();
  const Ta = X.about(A.question);
  F.sup(['goal', 'decide', A.goal, 'approve', '--from-chat', '--said', 'approve it']);
  assert.equal(X.answerLine(A.question).channel, 'chat');
  X.stillOpen(Ta, 'goal decide --from-chat');

  // --from-turn with the turn in another thread (where the supervisor named the question)
  const Qt = X.ask();
  const Tt = X.about(Qt);
  const Other = F.owner(['thread', 'new', 'Something else', '--subject', JSON.stringify({ kind: 'item', ref: 'ticket:elsewhere-1' })]).split('\n')[0];
  F.sup(['thread', 'reply', Other, 'While here: ship it?', '--refs', `question:${Qt}`]);
  const Ut = F.owner(['thread', 'say', Other, 'Yes']).split('\n')[0];
  F.sup(['answer', Qt, 'Yes', '--from-turn', Ut]);
  X.stillOpen(Tt, '--from-turn in another thread');
  X.stillOpen(Other, 'the other thread is another subject');

  // a withdrawn question
  const Qw = X.ask();
  const Tw = X.about(Qw);
  F.sup(['withdraw', Qw, '--reason', 'moot']);
  X.stillOpen(Tw, 'withdrawn');

  // a review sent back
  write(path.join(F.old, 'review/page.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Check it</title></head><body><p>Look.</p></body></html>\n');
  F.g(['add', '-A'], F.old);
  F.g(['commit', '-qm', 'review page'], F.old);
  const Qr = firstId(F.sup(['ask', '--kind', 'review', '--question', 'Does the page look right?', '--ref', 'main', '--page', 'review/page.html', ...RATE]));
  const Tr = X.about(Qr);
  F.owner(['answer', Qr, 'the header is wrong', '--decline']);
  X.stillOpen(Tr, 'a review sent back');

  // an answer by the supervisor or the responder: refused, and resolves nothing
  const Qs = X.ask();
  const Ts = X.about(Qs);
  F.fails(['answer', Qs, 'Yes'], SUP);
  F.fails(['answer', Qs, 'Yes'], { DEVTEAM_ROLE: 'responder' });
  X.stillOpen(Ts, 'an answer by the supervisor or the responder');
});

test('answer stands: a thread whose lines the log would refuse stays open with a warning, the answer recorded and the command exiting 0', (t) => {
  const X = fixture(t, 'stands');
  const { F } = X;
  const Q = X.ask();
  const good = X.about(Q);
  // a second open thread on the question, written by hand (thread new takes one per subject), whose
  // id is long enough that its thread-resolved observation (its id twice) is over the log's 4,096 bytes
  const bad = F.hand('owner', { type: 'thread', id: `t-20261101-000000000-${'a'.repeat(2000)}-owner`, title: 'By hand', subject: { kind: 'item', ref: `question:${Q}` } }, 60000);
  const r = F.run(F.old, ['answer', Q, 'Yes']);
  assert.equal(r.status, 0, r.err || r.out);
  assert.match(r.err, new RegExp(`warning: ${bad} stays open \\(`), 'a warning naming the thread');
  assert.equal(JSON.parse(F.owner(['questions', '--id', Q, '--json']))[0].status, 'answered', 'the answer is recorded');
  X.stillOpen(bad, 'its lines refused');
  X.resolvedBy(good, Q, 'Answered: Yes');

  // a thrown file error while writing (the supervisor's file read-only, so its proposal can't be
  // appended) is a warning too: the answer is recorded and the command exits 0
  const Q2 = X.ask();
  const T2 = X.about(Q2, 'Why?');
  F.sup(['thread', 'reply', T2, 'Because. Ship it?', '--refs', `question:${Q2}`]);
  const U2 = F.owner(['thread', 'say', T2, 'Yes']).split('\n')[0];
  const sup = fs.readdirSync(F.logDir).filter((f) => /^supervisor-\d{4}-\d{2}\.jsonl$/.test(f)).map((f) => path.join(F.logDir, f));
  for (const f of sup) fs.chmodSync(f, 0o444);
  let r2;
  try { r2 = F.run(F.old, ['answer', Q2, 'Yes', '--from-turn', U2], SUP); } finally { for (const f of sup) fs.chmodSync(f, 0o644); }
  assert.equal(r2.status, 0, r2.err || r2.out);
  assert.match(r2.err, new RegExp(`warning: ${T2}: its lines were not all written \\(EACCES\\)`), 'a warning naming the thread and the error');
  assert.equal(JSON.parse(F.owner(['questions', '--id', Q2, '--json']))[0].status, 'answered', 'the answer is recorded');
  assert.deepEqual([X.show(T2).status, X.show(T2).ready], ['open', null], 'no proposal written');

  // a claim link's token is redacted before the cut: cut inside the token, the log's own redaction
  // would make the outcome longer than it may be, and refuse it after the answer
  const Q3 = X.ask();
  const T3 = X.about(Q3);
  const lead = `${'x'.repeat(273)} /auth/claim#`;
  const r3 = F.run(F.old, ['answer', Q3, `${lead}tokentokentoken`]);
  assert.equal(r3.status, 0, r3.err || r3.out);
  X.resolvedBy(T3, Q3, `Answered: ${lead}…`);
  assert.doesNotMatch(r3.out, /token/, 'the link\'s token is not printed either');
});
