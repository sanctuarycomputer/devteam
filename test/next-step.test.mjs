// Next best step: the supervisor rates (each goal's impact against the strategy, each question's
// stake and urgency, what an answer would settle), the kit counts and orders. The order is computed
// on every read; nothing here stores it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, kit, write, json, line, startDashboard, until, freePort, PORTS } from './lib/kit.mjs';
import { canDrive, openChrome } from './lib/chrome.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };

// A fixture with helpers: ready goals, features, tickets, questions and their ranks.
function fixture(name) {
  const F = fleetFixture(name);
  const { old, ok, run, g } = F;
  let n = 0;
  const ownerLine = (o) => fs.appendFileSync(path.join(old, 'docs/devteam/run/log', `owner-${new Date().toISOString().slice(0, 7)}.jsonl`), line({ at: new Date().toISOString(), by: 'owner', channel: 'cli', ...o }));
  const goal = (title, priority) => { const id = ok(old, ['goal', 'add', '--title', title, '--outcome', 'it works', '--priority', String(priority)], SUP); ownerLine({ id, type: 'goal', op: 'set', status: 'ready' }); return id; };
  const feature = (id, goalId) => ok(old, ['feature', 'add', id, '--json', JSON.stringify({ title: id, goals: [goalId], stories: [{ id: `${id.toUpperCase()}-S1`, text: 'it works', release: 'v1.0.0' }] })], SUP);
  const ticket = (id, feat, deps = []) => ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: feat, component: 'app', kind: 'build', size: 'S', risk: 'normal', serves: [`${feat.toUpperCase()}-S1`], depends_on: deps, touches: [`src/${id}/**`], done_when: ['its test passes in CI'] })], SUP);
  const ask = (question, ...opts) => ok(old, ['ask', '--question', question, ...opts], SUP);
  const impact = (goalId, level, why = 'the strategy puts this first') => ok(old, ['goal', 'impact', goalId, String(level), '--rationale', why], SUP);
  const inbox = () => json(ok(old, ['questions', '--json']));
  const rank = (id) => inbox().find((q) => q.id === id).rank;
  const findings = (kind) => json(ok(old, ['metrics', '--json'])).findings.filter((f) => f.kind === kind);
  // a ticket merged: a commit on main named for it, as the merge word leaves one
  const merged = (id) => { write(path.join(old, `src/${id}.txt`), `${++n}\n`); g(['add', '-A'], old); g(['commit', '-qm', `${id}: done`], old); g(['push', '-q', 'origin', 'main'], old); };
  return { ...F, ownerLine, goal, feature, ticket, ask, impact, inbox, rank, findings, merged };
}
const yesNo = ['--choices', JSON.stringify([{ label: 'Build it' }, { label: "Don't build it" }]), '--recommendation', 'Build it'];

test('the formula: impact × stake × urgency, plus the tickets held up; the reason says why', () => {
  const F = fixture('nbs-formula');
  const { old, ok, goal, feature, ticket, ask, impact, inbox } = F;
  try {
    const G = goal('Team billing', 1);
    feature('bill', G);
    // a chain of three (the critical path) and one ticket off it
    ticket('bill-01-a', 'bill');
    ticket('bill-02-b', 'bill', ['bill-01-a']);
    ticket('bill-03-c', 'bill', ['bill-02-b']);
    ticket('bill-04-d', 'bill');
    impact(G, 3);
    const detail = ask('Round to cents?', '--goal', G, '--stake', '1', '--urgency', '2');
    const design = ask('Invoices by mail or in the app?', '--goal', G, '--stake', '2', '--urgency', '2');
    const blocker = ask('Which tax table?', '--stake', '1', '--urgency', '3', '--blocks', 'bill-01-a');
    const off = ask('Which font on the receipt?', '--stake', '1', '--urgency', '3', '--blocks', 'bill-04-d');
    const order = inbox();
    assert.deepEqual(order.map((q) => q.id), [blocker, design, off, detail], 'by score, highest first');
    const [b, d, o, e] = order.map((q) => q.rank);
    // 3 × 1 × 3, + 2 for a critical-path ticket + 2 behind it
    assert.deepEqual([b.score, b.own, b.position, b.top], [13, 13, 1, true]);
    assert.equal(b.reason, 'holds up 1 ticket, 1 on the critical path, 2 more behind it; for Team billing: moves a number the project watches; a detail; work is stopped on it now');
    assert.equal(b.sum, 'score 13: impact 3 (moves a number the project watches) × stake 1 (a detail) × urgency 3 (work is stopped on it now) + 4 for the tickets it holds up');
    assert.deepEqual([d.score, d.reason], [12, 'for Team billing: moves a number the project watches']);
    assert.deepEqual([o.score, o.parts.held_up, o.parts.on_path, o.parts.behind], [10, 1, 0, 0], '3 × 1 × 3 + 1 off the path');
    assert.deepEqual([e.score, e.reason], [6, 'for Team billing: moves a number the project watches; a detail']);
    // the text view: the same order, and a rank line on each rated question
    const text = ok(old, ['questions']);
    assert.ok(text.indexOf(blocker) < text.indexOf(design) && text.indexOf(design) < text.indexOf(off));
    assert.match(text, /\n {2}rank: 13 \(holds up 1 ticket, 1 on the critical path, 2 more behind it; /);
    // the unblock is capped: it lifts a question a few places, never a detail over a turning point
    for (let i = 5; i < 20; i++) ticket(`bill-${String(i).padStart(2, '0')}-x`, 'bill', ['bill-03-c']);
    assert.equal(F.rank(blocker).parts.unblock, 12, 'capped at 12');
    assert.equal(F.rank(blocker).score, 21);
  } finally { F.done(); }
});

test('a question that settles others ranks above them: stake 3, same goal or feature, and only open ones count', () => {
  const F = fixture('nbs-settles');
  const { old, ok, run, goal, feature, ticket, ask, impact, inbox, rank } = F;
  try {
    const G = goal('Team billing', 1);
    const Other = goal('Onboarding', 2);
    feature('bill', G);
    ticket('bill-01-a', 'bill');
    impact(G, 3);
    const details = [1, 2, 3].map((i) => ask(`Detail ${i}?`, '--goal', G, '--stake', '1', '--urgency', '2'));
    const onTicket = ask('Detail on the ticket?', '--stake', '1', '--urgency', '3', '--blocks', 'bill-01-a');
    const elsewhere = ask('An onboarding detail?', '--goal', Other, '--stake', '1', '--urgency', '1');
    const settle = ['--settles', ...details, onTicket, '--settles-if', "Don't build it"];
    // the checks, before anything is written
    const refused = (opts, re, why) => { const r = run(old, ['ask', '--question', 'Should we build team billing at all?', '--goal', G, ...opts], SUP); assert.notEqual(r.status, 0, why); assert.match(r.err, re, why); };
    refused([...yesNo, '--stake', '1', '--urgency', '1', ...settle], /a question that settles others is one the work turns on: --stake 3/, 'a low-stake question cannot take the top by listing others');
    refused([...yesNo, '--urgency', '1', ...settle], /--stake 3/, 'nor an unrated one');
    refused([...yesNo, '--stake', '3', '--settles', ...details], /--settles needs --settles-if/, 'which answer settles them');
    refused([...yesNo, '--stake', '3', '--settles-if', "Don't build it"], /--settles-if needs --settles/);
    refused([...yesNo, '--stake', '3', '--settles', details[0], '--settles-if', 'Maybe'], /--settles-if "Maybe" is none of the choices/);
    refused([...yesNo, '--stake', '3', '--settles', 'q-20260101-000000000-supervisor', '--settles-if', "Don't build it"], /no such question/);
    refused([...yesNo, '--stake', '3', '--settles', elsewhere, '--settles-if', "Don't build it"], /it is about another goal or feature/, 'only questions about its own goal or feature');
    refused(['--kind', 'owner-action', '--stake', '3', '--settles', details[0], '--settles-if', 'done'], /a owner-action question settles no others/);
    assert.match(run(old, ['ask', '--question', 'x', '--goal', G, '--stake', '4'], SUP).err, /--stake is 1, 2 or 3/);
    const withdrawn = ask('A detail asked and dropped?', '--goal', G, '--stake', '1', '--urgency', '1');
    ok(old, ['withdraw', withdrawn, '--reason', 'not needed'], SUP);
    refused([...yesNo, '--stake', '3', '--settles', withdrawn, '--settles-if', "Don't build it"], /it is already withdrawn/);

    // the gate: nothing waits on it (urgency 1), yet it is first, by its own score plus theirs
    const gate = ask('Should we build team billing at all?', '--goal', G, ...yesNo, '--stake', '3', '--urgency', '1', ...settle);
    const order = inbox();
    assert.equal(order[0].id, gate);
    // own 3 × 3 × 1 = 9; the details 6 + 6 + 6, and 3 × 1 × 3 + 2 = 11 for the one holding the only ticket
    assert.deepEqual([order[0].rank.own, order[0].rank.score], [9, 38]);
    assert.match(order[0].rank.reason, /^would settle 4 other questions; for Team billing: moves a number the project watches; decides whether the work goes ahead$/);
    assert.match(order[0].rank.sum, /\+ 29 from the 4 questions it would settle$/);
    assert.deepEqual(rank(details[0]).parts.settled_by, [gate]);
    assert.match(rank(details[0]).reason, new RegExp(`may be settled by ${gate}$`));
    assert.match(ok(old, ['questions', '--id', gate]), /settles, if answered "Don't build it": q-/);

    // a question asked later joins the list: rate --settles adds; --unsettles removes one; none clears
    const late = ask('Detail 4?', '--goal', G, '--stake', '1', '--urgency', '2');
    assert.match(ok(old, ['rate', gate, '--settles', late], SUP), /^rated q-\S+: 1 of 7 in the Inbox, score 44 \(would settle 5 other questions/);
    assert.equal(rank(gate).parts.settles.length, 5, 'added, the other four kept');
    ok(old, ['rate', gate, '--unsettles', late], SUP);
    assert.deepEqual(rank(gate).parts.settles.slice().sort(), [...details, onTicket].sort());
    assert.match(run(old, ['rate', gate, '--unsettles', late], SUP).err, /doesn't settle/);
    assert.match(run(old, ['rate', gate, '--settles', gate], SUP).err, /can't settle itself/);
    assert.match(run(old, ['rate', gate, '--stake', '2'], SUP).err, /--stake 3/, 'a question that settles others stays stake 3');
    // a cycle is refused
    assert.match(run(old, ['rate', details[0], '--stake', '3', '--settles', gate, '--settles-if', 'yes'], SUP).err, /already settles .*two questions can't settle each other/);
    // a chain: a question that settles the gate carries the gate's and theirs
    const outer = ask('Is billing in this product at all?', '--goal', G, '--choices', JSON.stringify([{ label: 'Yes' }, { label: 'No' }]), '--stake', '3', '--urgency', '1', '--settles', gate, '--settles-if', 'No');
    assert.deepEqual(inbox().slice(0, 2).map((q) => q.id), [outer, gate]);
    assert.equal(rank(outer).score, 9 + 9 + 29, 'its own, the gate, and what the gate settles');
    assert.equal(rank(outer).parts.settles.length, 5);

    // computed: a settled question that closes leaves the sum, with no line written on the gate
    ok(old, ['withdraw', details[2], '--reason', 'asked twice'], SUP);
    assert.equal(rank(gate).score, 32);
    ok(old, ['rate', gate, '--settles', 'none'], SUP);
    assert.deepEqual([rank(gate).score, rank(gate).parts.settles.length], [9, 0]);
    assert.equal(rank(outer).score, 18);
  } finally { F.done(); }
});

test('the owner gives the settling answer: a finding until the supervisor withdraws each, its own act', () => {
  const F = fixture('nbs-settled');
  const { old, ok, goal, ask, findings } = F;
  try {
    const G = goal('Team billing', 1);
    const a = ask('Detail 1?', '--goal', G, '--stake', '1', '--urgency', '1');
    const b = ask('Detail 2?', '--goal', G, '--stake', '1', '--urgency', '1');
    const gate = ask('Should we build it at all?', '--goal', G, ...yesNo, '--stake', '3', '--urgency', '1', '--settles', a, b, '--settles-if', "Don't build it");
    const other = ask('Build the export at all?', '--goal', G, ...yesNo, '--stake', '3', '--urgency', '1', '--settles', a, '--settles-if', "Don't build it");
    ok(old, ['answer', other, 'Build it']);
    assert.deepEqual(findings('settled-not-withdrawn'), [], 'another answer settles nothing');
    ok(old, ['answer', gate, "Don't build it — not this year"]);
    const [f] = findings('settled-not-withdrawn');
    assert.equal(f.subject, gate);
    assert.ok(f.detail.includes(a) && f.detail.includes(b));
    assert.match(F.run(old, ['withdraw', '--settled-by', gate], SUP).err, /usage: withdraw <qid>/, 'no bulk withdrawal on the owner\'s behalf');
    ok(old, ['withdraw', a, '--reason', `settled by the owner's answer to ${gate}`], SUP);
    assert.ok(findings('settled-not-withdrawn')[0].detail.includes(b) && !findings('settled-not-withdrawn')[0].detail.includes(a));
    ok(old, ['withdraw', b, '--reason', `settled by the owner's answer to ${gate}`], SUP);
    assert.deepEqual(findings('settled-not-withdrawn'), []);
  } finally { F.done(); }
});

test('a new rating never reopens an answered question, and the hash the owner saw still answers', () => {
  const F = fixture('nbs-hash');
  const { old, ok, goal, ask } = F;
  try {
    const G = goal('Team billing', 1);
    const q1 = ask('Round to cents?', '--goal', G, '--recommendation', 'yes', '--stake', '1', '--urgency', '1');
    const seen = json(ok(old, ['questions', '--id', q1, '--json']))[0].hash;
    ok(old, ['rate', q1, '--stake', '2', '--urgency', '3'], SUP);
    const after = json(ok(old, ['questions', '--id', q1, '--json']))[0];
    assert.deepEqual([after.stake, after.urgency, after.hash], [2, 3, seen], 'rated again, the same question to the owner');
    ok(old, ['answer', q1, 'yes', '--seen', seen]);
    // a rating line written after the answer (by hand: rate takes only open questions)
    assert.match(F.run(old, ['rate', q1, '--stake', '1'], SUP).err, /already answered/);
    fs.appendFileSync(path.join(old, 'docs/devteam/run/log', `supervisor-${new Date().toISOString().slice(0, 7)}.jsonl`), line({ id: q1, type: 'question', op: 'set', at: new Date().toISOString(), by: 'supervisor', stake: 3, settles: [], settles_if: 'yes' }));
    const v = json(ok(old, ['questions', '--id', q1, '--json']))[0];
    assert.deepEqual([v.status, v.rewritten, v.stake], ['answered', false, 3]);
    assert.equal(F.run(old, ['log-check']).status, 0, 'the rating fields are the supervisor\'s to set');
    // the schema: the four rating fields are the supervisor's to set on a question, and nobody else's
    const S = json(fs.readFileSync(path.join(kit, 'schema/log.schema.json'), 'utf8'));
    assert.deepEqual(S['x-authority'].set.question.supervisor, ['status', 'reason', 'stake', 'urgency', 'settles', 'settles_if']);
    for (const k of ['stake', 'urgency', 'settles', 'settles_if']) assert.ok(S.$defs.types.question.properties[k].description && !S['x-authority'].set.question.owner.includes(k), k);
    assert.deepEqual(Object.keys(S.$defs.types.decision.properties.corrected.properties), ['reason', 'severity', 'impact']);
    const L = json(/`{3}json devteam\s*\n([\s\S]*?)\n`{3}/.exec(fs.readFileSync(path.join(kit, 'governance/constitution.md'), 'utf8'))[1]);
    assert.ok(L.constitutional.includes('goal-impact') && !L.classes['goal-impact'], 'goal-impact is constitutional, never a ladder class');
    assert.ok(L.owner_only.includes('strategy-change'));
    // a worker may not rate: the command refuses, and a line written by hand counts for nothing
    assert.notEqual(F.run(old, ['rate', q1, '--stake', '1'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'x-01-y' }).status, 0);
    const q2 = ask('Still open?', '--goal', G, '--stake', '1', '--urgency', '1');
    fs.appendFileSync(path.join(old, 'docs/devteam/run/log', 'x-01-y.jsonl'), line({ id: q2, type: 'question', op: 'set', at: new Date().toISOString(), by: 'x-01-y', stake: 3 }));
    assert.equal(json(ok(old, ['questions', '--id', q2, '--json']))[0].stake, 1, 'a worker\'s line sets no rating');
  } finally { F.done(); }
});

test('the order is computed: a goal judged again, a ticket merged, a goal parked, a default; urgency 3 needs something behind it', () => {
  const F = fixture('nbs-computed');
  const { old, ok, run, goal, feature, ticket, ask, impact, rank, inbox, merged } = F;
  try {
    const G = goal('Team billing', 1);
    const H = goal('Onboarding', 2);
    feature('bill', G);
    ticket('bill-01-a', 'bill');
    ticket('bill-02-b', 'bill', ['bill-01-a']);
    const unjudged = ask('Which tax table?', '--stake', '2', '--urgency', '3', '--blocks', 'bill-01-a');
    assert.deepEqual([rank(unjudged).parts.goal_impact, rank(unjudged).parts.judged, rank(unjudged).score], [2, false, 15], 'unjudged counts as 2: 2 × 2 × 3 + 3');
    assert.match(rank(unjudged).reason, /for Team billing: its impact is not judged yet/);
    const onb = ask('Which welcome mail?', '--goal', H, '--stake', '2', '--urgency', '2');
    impact(H, 4);
    assert.deepEqual(inbox().map((q) => q.id), [onb, unjudged], '4 × 2 × 2 = 16 over 15');
    const lines = () => fs.readdirSync(path.join(old, 'docs/devteam/run/log')).map((f) => fs.readFileSync(path.join(old, 'docs/devteam/run/log', f), 'utf8')).join('').split('\n').filter((l) => l.includes('"type":"question"')).length;
    const before = lines();
    impact(G, 4);
    assert.deepEqual([rank(unjudged).score, inbox()[0].id], [27, unjudged], 'judged at 4: 4 × 2 × 3 + 3, first, with no question line written');
    assert.equal(lines(), before);

    // urgency 3 counts as 3 only while it holds up a waiting ticket, or has a default
    const claimed = ask('Urgent, it says?', '--goal', G, '--stake', '1', '--urgency', '3');
    assert.deepEqual([rank(claimed).parts.urgency, rank(claimed).parts.urgency_given, rank(claimed).score], [2, 3, 8]);
    assert.match(rank(claimed).sum, /urgency 2 \(rated 3, counted as 2: it holds up no waiting ticket or open incident and has no default\)/);
    assert.match(run(old, ['ask', '--question', 'x?', '--goal', G, '--stake', '1', '--urgency', '3'], SUP).err, /urgency 3 says work is stopped on it now: it counts as 3 only while --blocks names a ticket that is waiting/);
    // a default: the fleet goes on at the deadline, so half; and the chip says so before the goal's
    const defaulted = ask('Ship behind a flag?', '--goal', G, '--recommendation', 'yes', '--default', 'yes', '--stake', '2', '--urgency', '3');
    const d = rank(defaulted);
    assert.deepEqual([d.parts.urgency, d.own, d.parts.default], [3, 12, true], '4 × 2 × 3 = 24, halved');
    assert.match(d.chips[0], /^goes ahead with the default at \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
    assert.match(d.chips[1], /^for Team billing/);
    // no discount for a class the owner keeps agreeing in: only a default halves
    for (let i = 0; i < 10; i++) { const q = ask(`Move story ${i}?`, '--class', 'release-scope', '--reasons', 'below-rung', '--recommendation', 'yes', '--stake', '1', '--urgency', '1'); ok(old, ['answer', q, 'yes']); }
    assert.equal(json(ok(old, ['trust', '--json'])).find((r) => r.class === 'release-scope').meets_agreement, true);
    const agreed = ask('Move story 11?', '--goal', G, '--class', 'release-scope', '--reasons', 'below-rung', '--recommendation', 'yes', '--stake', '2', '--urgency', '2');
    assert.deepEqual([rank(agreed).own, rank(agreed).parts.default], [16, false]);

    // the ticket merges: it is held up no more, so the unblock and the 3 go
    merged('bill-01-a');
    const m = rank(unjudged);
    assert.deepEqual([m.parts.held_up, m.parts.unblock, m.parts.urgency, m.score], [0, 0, 2, 16]);
    // its goal parked: urgency 1, no unblock, and it says so
    ok(old, ['goal', 'hold', G, 'park', '--owner', '--reason', 'later']);
    const p = rank(unjudged);
    assert.deepEqual([p.parts.parked, p.parts.urgency, p.score], [true, 1, 8]);
    assert.ok(p.chips.includes('its goal is parked'));
    assert.equal(inbox()[0].id, onb, 'the running goal\'s question is first again');
  } finally { F.done(); }
});

test('owner-actions: stake is what cannot go ahead without it, so the ones that stop workers come first (scenario B)', () => {
  const F = fixture('nbs-actions');
  const { goal, feature, ticket, ask, impact, inbox } = F;
  try {
    const Onb = goal('Onboarding', 1);
    const Bill = goal('Team billing', 2);
    feature('onb', Onb);
    // one chain of six (the critical path), and four tickets off it
    ticket('onb-01-a', 'onb');
    for (let i = 2; i <= 6; i++) ticket(`onb-0${i}-x`, 'onb', [i === 2 ? 'onb-01-a' : `onb-0${i - 1}-x`]);
    for (let i = 7; i <= 10; i++) ticket(`onb-${String(i).padStart(2, '0')}-y`, 'onb');
    impact(Onb, 4);
    impact(Bill, 3);
    // A1: a key the whole feature waits on. A2 to A5: each stops one ticket.
    const A1 = ask('Post the mail key', '--kind', 'owner-action', '--stake', '2', '--urgency', '3', '--blocks', 'onb-01-a');
    const As = [7, 8, 9, 10].map((i) => ask(`Add DNS record ${i}`, '--kind', 'owner-action', '--stake', '1', '--urgency', '3', '--blocks', `onb-${String(i).padStart(2, '0')}-y`));
    // design choices nothing waits on yet
    const D1 = ask('Welcome tour or checklist?', '--goal', Onb, '--stake', '2', '--urgency', '1');
    const D2 = ask('Monthly or yearly first?', '--goal', Bill, '--stake', '2', '--urgency', '1');
    const order = inbox();
    assert.deepEqual(order.map((q) => q.id), [A1, ...As, D1, D2]);
    // A1: 4 × 2 × 3 + 2 (on the path) + 5 behind; A2..A5: 4 × 1 × 3 + 1; D1: 4 × 2 × 1; D2: 3 × 2 × 1
    assert.deepEqual(order.map((q) => q.rank.score), [31, 13, 13, 13, 13, 8, 6]);
    assert.match(order[0].rank.reason, /^holds up 1 ticket, 1 on the critical path, 5 more behind it; for Onboarding: the project depends on it; a feature waits on it; work is stopped on it now$/);
    assert.match(order[1].rank.sum, /× stake 1 \(one ticket waits on it\)/);
  } finally { F.done(); }
});

test('goal impact: the supervisor judges, the owner corrects with a value, and that value stands', () => {
  const F = fixture('nbs-impact');
  const { old, ok, run, goal, ask, impact, rank, findings } = F;
  try {
    const G = goal('Team billing', 1);
    const draft = ok(old, ['goal', 'add', '--title', 'Someday', '--outcome', 'x'], SUP);
    const q = ask('Round to cents?', '--goal', G, '--stake', '2', '--urgency', '2');
    assert.deepEqual(findings('goal-unjudged').map((f) => f.subject), [G], 'a running goal with no impact; a draft with no question is left alone');
    assert.match(run(old, ['goal', 'impact', G, '5', '--rationale', 'x'], SUP).err, /usage: goal impact/);
    assert.match(run(old, ['goal', 'impact', G, '3'], SUP).err, /needs --rationale/);
    assert.notEqual(run(old, ['goal', 'impact', G, '3', '--rationale', 'x'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'x-01-y' }).status, 0, 'the supervisor judges, no one else');
    const r = run(old, ['goal', 'impact', G, '2', '--rationale', 'Paid plans are the second way it wins (W2).'], SUP);
    assert.equal(r.status, 0, r.err);
    assert.match(r.err, /strategy\.md is still the template/, 'a judgment with no strategy behind it says so');
    const D = r.out;
    const dec = json(ok(old, ['log', '--id', D, '--json']));
    const d0 = Array.isArray(dec) ? dec[0] : dec;
    assert.deepEqual([d0.class, d0.impact, d0.authority, d0.refs, d0.what], ['goal-impact', 2, 'constitution', [G], 'Team billing: worth having (impact 2 of 4)']);
    assert.deepEqual(json(ok(old, ['goal', 'show', G])).impact, { level: 2, words: 'worth having', by: 'supervisor', rationale: 'Paid plans are the second way it wins (W2).', decision: D, at: d0.at ?? d0.created_at, rejudge: false });
    assert.match(ok(old, ['goal', 'list']), /\[ready, p1, impact 2\] Team billing/);
    assert.deepEqual(findings('goal-unjudged'), []);
    assert.equal(json(ok(old, ['goal', 'show', draft])).impact, null);
    assert.equal(rank(q).score, 8);

    // the owner corrects it with their value: the goal takes it at once, never the unjudged 2
    assert.match(run(old, ['correct', D, '--reason', 'x', '--impact', '4', '--retro'], SUP).err, /--impact is the owner's/);
    assert.match(run(old, ['correct', D, '--reason', 'x', '--impact', '7']).err, /--impact is 1 \(housekeeping\)/);
    const out = ok(old, ['correct', D, '--reason', 'This is the launch blocker.', '--impact', '4']);
    assert.match(out, /Team billing: impact 4 \(the project depends on it\), set by the owner/);
    assert.doesNotMatch(out, /drops to rung/, 'constitutional: no trust drops');
    assert.equal(json(ok(old, ['trust', '--json'])).some((t) => t.class === 'goal-impact'), false, 'no ladder class');
    const now = json(ok(old, ['goal', 'show', G])).impact;
    assert.deepEqual([now.level, now.by, now.rationale, now.decision], [4, 'owner', 'This is the launch blocker.', D]);
    assert.equal(rank(q).score, 16, 'its questions rise with it');
    assert.deepEqual(findings('goal-unjudged'), [], 'nothing to judge again: the owner said');
    // the supervisor cannot lower what the owner set, or judge over it at all
    const again = run(old, ['goal', 'impact', G, '1', '--rationale', 'on reflection'], SUP);
    assert.notEqual(again.status, 0);
    assert.match(again.err, /the owner set .* impact to 4 .* and that stands/);
    // a decision line written by hand after it changes nothing either
    fs.appendFileSync(path.join(old, 'docs/devteam/run/log', `supervisor-${new Date().toISOString().slice(0, 7)}.jsonl`), line({ id: `d-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 8)}-999999999-supervisor`, type: 'decision', op: 'new', at: new Date().toISOString(), by: 'supervisor', class: 'goal-impact', what: 'x', authority: 'constitution', refs: [G], impact: 1 }));
    assert.equal(json(ok(old, ['goal', 'show', G])).impact.level, 4);
    // the owner changes their mind: a new value on the same decision
    ok(old, ['correct', D, '--reason', 'Launch moved to next year.', '--impact', '3']);
    assert.deepEqual([json(ok(old, ['goal', 'show', G])).impact.level, rank(q).score], [3, 12]);
    // --impact belongs to a goal-impact decision
    const other = ok(old, ['decide', '--class', 'contract-ruling', '--refs', G, '--', 'a ruling'], SUP);
    assert.match(run(old, ['correct', other, '--reason', 'x', '--impact', '2']).err, /--impact goes with the correction of a goal-impact decision/);

    // a correction with no value (a retro's): the level holds until the supervisor judges again
    const H = goal('Onboarding', 2);
    const D2 = impact(H, 3);
    const hq = ask('Tour or checklist?', '--goal', H, '--stake', '1', '--urgency', '1');
    ok(old, ['correct', D2, '--reason', 'judged on effort, not on the strategy', '--retro'], SUP);
    const held = json(ok(old, ['goal', 'show', H])).impact;
    assert.deepEqual([held.level, held.rejudge, held.correction], [3, true, 'judged on effort, not on the strategy']);
    assert.equal(rank(hq).parts.goal_impact, 3, 'never back to 2');
    assert.match(findings('goal-unjudged').find((f) => f.subject === H).detail, /was corrected/);
    impact(H, 2, 'W2 only, and nothing dated: worth having.');
    assert.deepEqual([json(ok(old, ['goal', 'show', H])).impact.level, findings('goal-unjudged').length], [2, 0]);
    // a met goal's impact orders nothing
    F.ownerLine({ id: H, type: 'goal', op: 'set', status: 'met' });
    assert.match(run(old, ['goal', 'impact', H, '1', '--rationale', 'x'], SUP).err, /is met; its impact orders nothing now/);
  } finally { F.done(); }
});

test('findings: no strategy, an unrated question once rating has begun, ratings that are all 3', () => {
  const F = fixture('nbs-findings');
  const { old, ok, g, goal, ask, findings } = F;
  try {
    assert.deepEqual(findings('strategy-unwritten'), [], 'no running goal: nothing yet');
    const G = goal('Team billing', 1);
    assert.match(findings('strategy-unwritten')[0].detail, /still the template/);
    const first = ask('An old question?', '--goal', G);
    assert.deepEqual(findings('question-unrated'), [], 'a project that has not begun rating sees nothing');
    ask('Rated?', '--goal', G, '--stake', '1', '--urgency', '1');
    assert.deepEqual(findings('question-unrated'), [], 'nor for questions from before the first rating');
    const late = ask('Forgot to rate?', '--goal', G);
    const half = ask('Half rated?', '--goal', G, '--stake', '2');
    assert.deepEqual(findings('question-unrated').map((f) => f.subject).sort(), [late, half].sort());
    ok(old, ['rate', late, '--stake', '1', '--urgency', '1'], SUP);
    ok(old, ['rate', half, '--urgency', '1'], SUP);
    assert.deepEqual(findings('question-unrated'), []);
    assert.equal(json(ok(old, ['questions', '--id', first, '--json']))[0].rank.parts.rated, false);
    assert.deepEqual(findings('rating-inflated'), []);
    for (let i = 0; i < 4; i++) ask(`Everything is a turning point ${i}?`, '--goal', G, '--stake', '3', '--urgency', '1');
    assert.deepEqual(findings('rating-inflated').map((f) => [f.subject, f.detail]), [['stake', '4 of 7 open questions are stake 3']]);
    // the strategy written and on main: the finding goes
    write(path.join(old, 'docs/devteam/project/strategy.md'), '# Strategy\n\n## Why it exists\nTeams split bills by hand.\n\n## How it wins, in order\n- **W1** Teams adopt it without help\n');
    g(['add', '-A'], old);
    g(['commit', '-qm', 'the strategy'], old);
    g(['push', '-q', 'origin', 'main'], old);
    assert.deepEqual(findings('strategy-unwritten'), []);
    assert.doesNotMatch(F.run(old, ['goal', 'impact', G, '3', '--rationale', 'W1'], SUP).err, /strategy/);
  } finally { F.done(); }
});

test('the strategy is the owner\'s: no PR changes project/strategy.md without an answered strategy-change question', () => {
  const F = fixture('nbs-strategy');
  const { old, ok, run, g } = F;
  const REL = 'docs/devteam/project/strategy.md';
  const template = fs.readFileSync(path.join(old, REL), 'utf8');
  const choreOf = (slug, change) => {
    const w = path.join(old, '.worktrees', `chore-${slug}`);
    g(['worktree', 'add', '-q', '-b', `chore-${slug}`, w, 'origin/main'], old);
    change(w);
    g(['add', '-A'], w);
    g(['commit', '-qm', slug], w);
    g(['push', '-q', 'origin', `chore-${slug}`], w);
    write(path.join(old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: x\n\n## One-way doors\n\nNone.\n`);
    return (...extra) => { const r = run(old, ['merge', '--chore', slug, '--dry-run', ...extra], SUP); return { status: r.status, text: r.out + r.err }; };
  };
  const answered = (cls, answer = 'yes') => { const q = ok(old, ['ask', '--question', 'Approve this?', '--recommendation', 'yes', '--stake', '3', '--urgency', '2', ...(cls ? ['--class', cls, '--reasons', cls === 'release-scope' ? 'below-rung' : 'owner-only'] : [])], SUP); ok(old, ['answer', q, answer]); return q; };
  try {
    assert.match(template, /^# Strategy\n/, 'init wrote the template');
    assert.match(template, /## How it wins, in order\n[\s\S]*## Values\n[\s\S]*## Refusals\n[\s\S]*## Not known yet\n/);
    assert.ok(json(ok(old, ['decisions', '--json'])) && !run(old, ['ask', '--question', 'x', '--class', 'strategy-change', '--reasons', 'owner-only'], SUP).err.includes('not in constitution'), 'strategy-change is a class the constitution knows');
    // a draft of the strategy, in a chore of any name
    const draft = choreOf('strategy-first', (w) => write(path.join(w, REL), '# Strategy\n\n## Why it exists\nTeams split bills by hand.\n'));
    const r0 = draft();
    assert.notEqual(r0.status, 0);
    assert.match(r0.text, /changes docs\/devteam\/project\/strategy\.md: the strategy is the owner's, so the owner's answer is needed: ask --class strategy-change/);
    assert.match(draft('--approved', answered('release-scope')).text, /is a release-scope question; changing docs\/devteam\/project\/strategy\.md needs an answered strategy-change question/);
    assert.match(draft('--approved', answered(null)).text, /is a classless question/);
    assert.notEqual(draft('--approved', answered('strategy-change', 'no, W1 is wrong')).status, 0, 'an answer that is not the yes approves nothing');
    const yes = answered('strategy-change');
    assert.equal(draft('--approved', yes).status, 0, 'the owner\'s yes lands it');
    // the same change hidden among other project files, under another name: the same rule
    const mixed = choreOf('notes', (w) => { write(path.join(w, 'docs/devteam/project/designs/notes.md'), 'n\n'); fs.appendFileSync(path.join(w, REL), '\n- **W9** Whatever pays\n'); });
    assert.match(mixed().text, /the strategy is the owner's/);
    // project/ files beside it still need no question
    assert.equal(choreOf('only-notes', (w) => write(path.join(w, 'docs/devteam/project/designs/notes.md'), 'n\n'))().status, 0);

    // the owner's strategy on main; then a chore that resets it to the template, empties it or deletes it
    write(path.join(old, REL), '# Strategy\n\n## Why it exists\nTeams split bills by hand.\n');
    g(['add', '-A'], old);
    g(['commit', '-qm', 'the strategy, approved'], old);
    g(['push', '-q', 'origin', 'main'], old);
    for (const [slug, change] of [['reset', (w) => write(path.join(w, REL), template)], ['empty', (w) => write(path.join(w, REL), '')], ['delete', (w) => fs.rmSync(path.join(w, REL))]]) {
      const r = choreOf(`strategy-${slug}`, change)();
      assert.notEqual(r.status, 0, `${slug}: refused`);
      assert.match(r.text, /the strategy is the owner's/, slug);
    }
    // no strategy file on main at all (a project from before): init's untouched template may arrive, and nothing else
    g(['rm', '-q', REL], old);
    g(['commit', '-qm', 'as an older project: no strategy file'], old);
    g(['push', '-q', 'origin', 'main'], old);
    assert.equal(choreOf('template', (w) => write(path.join(w, REL), template))().status, 0, 'the empty template, where there was no file');
    assert.match(choreOf('first-words', (w) => write(path.join(w, REL), `${template}\nW1 is revenue.\n`))().text, /the strategy is the owner's/, 'a first strategy is the owner\'s to approve too');
  } finally { F.done(); }
});

test('next prints the top of the Inbox and why; an unrated project prints as it always did', () => {
  const F = fixture('nbs-next');
  const { old, ok, goal, ask, impact } = F;
  try {
    assert.deepEqual(json(ok(old, ['next', '--json'])), { owner: null });
    assert.equal(ok(old, ['next']), 'you    nothing: the Inbox is empty');
    // unrated questions, with and without a goal: a steady order, no rank line, no goal chip without a goal
    const a = ask('First?');
    const G = goal('Team billing', 1);
    const b = ask('Second?', '--goal', G);
    const c = ask('Third?');
    const qs = json(ok(old, ['questions', '--json']));
    assert.deepEqual(qs.map((q) => q.id), [a, b, c], 'all the same score (2 × 2 × 1), so by age');
    assert.deepEqual(qs.map((q) => [q.rank.parts.rated, q.rank.score]), [[false, 4], [false, 4], [false, 4]]);
    assert.deepEqual([qs[0].rank.reason, qs[0].rank.chips], ['', []], 'no goal: no chip');
    assert.equal(qs[1].rank.reason, 'for Team billing: its impact is not judged yet');
    assert.doesNotMatch(ok(old, ['questions']), /rank:/);
    impact(G, 4);
    const top = ask('Should we build it at all?', '--goal', G, '--stake', '3', '--urgency', '2');
    const n = json(ok(old, ['next', '--json'])).owner;
    assert.deepEqual([n.id, n.question, n.rank.score, n.rank.top], [top, 'Should we build it at all?', 24, true]);
    assert.deepEqual(n.then.map((x) => x.id), [b, a, c], 'the judged goal\'s question (4 × 2 × 1), then the rest by age');
    const text = ok(old, ['next']);
    assert.match(text, new RegExp(`^you {4}${top} {2}Should we build it at all\\?\\n {7}for Team billing: the project depends on it; decides whether the work goes ahead\\n {7}score 24: impact 4 `));
    assert.match(text, /\n {7}then: q-\S+ \(score 8\), q-\S+ \(score 4\), q-\S+ \(score 4\)$/);
    // the operator may read it; a closed question has no rank
    assert.equal(F.run(old, ['next'], { DEVTEAM_ROLE: 'operator' }).status, 0);
    ok(old, ['withdraw', a, '--reason', 'x'], SUP);
    assert.equal(json(ok(old, ['questions', '--id', a, '--json']))[0].rank, null);
    const all = json(ok(old, ['questions', '--all', '--json']));
    assert.equal(all[all.length - 1].id, a, 'closed questions follow the Inbox');
  } finally { F.done(); }
});

test('the Inbox shows the order: the next best step on top with its reason, what an answer closes, and the owner\'s own value for a goal', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async () => {
  const F = fixture('nbs-page');
  const { old, ok, goal, ask, impact } = F;
  const G = goal('Team billing', 1);
  const D = impact(G, 3, 'W2 is revenue.');
  const detail = ask('Round to cents?', '--goal', G, '--stake', '1', '--urgency', '2');
  const unrated = ask('Unrated one?');
  const gate = ask('Should we build it at all?', '--goal', G, ...yesNo, '--stake', '3', '--urgency', '1', '--settles', detail, '--settles-if', "Don't build it");
  ok(old, ['knowledge', 'add', '--kind', 'lesson', '--statement', 'a lesson to keep', '--scope', 'project', '--evidence', detail], SUP);
  const port = await freePort();
  const dash = startDashboard(old, F.env({ DEVTEAM_HUB_PORT: String(PORTS + 10), DEVTEAM_PORT_BASE: String(PORTS + 11) }), ['--port', String(port)]);
  const chrome = await openChrome();
  const p = await chrome.newPage();
  try {
    await until(() => /dashboard on http/.test(dash.out()), 'the dashboard');
    await p.send('Page.enable');
    await p.send('Runtime.enable');
    await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#questions` });
    const soon = (expr, what) => until(() => p.ev(expr), what);
    await soon(`!!document.querySelector('[id="q-${gate}"]')`, 'the question cards');
    const cards = await p.ev(`[...document.querySelectorAll('#questions > .card')].map((c) => ({ id: c.id.slice(2), top: c.classList.contains('top'), lead: c.querySelector('.top-why')?.textContent ?? null, why: [...c.querySelectorAll('.why span')].map((s) => s.textContent), closes: c.querySelector('.closes')?.textContent ?? null, lesson: /Lesson to keep/.test(c.textContent) }))`);
    assert.deepEqual(cards.map((c) => c.id), [gate, detail, unrated, ''], 'the kit\'s order, and the lesson to keep after the questions');
    assert.deepEqual(cards.map((c) => c.top), [true, false, false, false]);
    assert.equal(cards[0].lead, 'Next best step. Would settle 1 other question; for Team billing: moves a number the project watches; decides whether the work goes ahead.');
    assert.equal(cards[0].closes, 'Closes 1 other question: Round to cents?', 'on the choice that settles it');
    assert.deepEqual(cards[1].why, ['for Team billing: moves a number the project watches', 'a detail', 'may be settled by Should we build it at all?']);
    assert.deepEqual(cards[2].why, ['not rated']);
    assert.ok(cards[3].lesson);
    assert.match(await p.ev(`document.querySelector('[id="q-${detail}"] .kv').textContent`), /Order2 of 3\. Score 6: impact 3 \(moves a number the project watches\) × stake 1 \(a detail\) × urgency 2 /);
    assert.equal(await p.ev(`document.querySelector('#inbox h2 .sub').textContent`), 'decisions only you can make, the most valuable first');
    assert.match(await p.ev(`document.querySelector('#strategy-link').getAttribute('href')`), /^#file\?path=docs%2Fdevteam%2Fproject%2Fstrategy\.md/);
    // the goal: its impact beside its priority, why, and Wrong? sends the owner's own value
    assert.match(await p.ev(`document.querySelector('#goals-list a.title-link[href="#goal/${G}"]').closest('.card').querySelector('.card-head').textContent`), /priority 1 · moves a number the project watches/);
    await p.ev(`void (location.hash = '#goal/${G}')`);
    const key = `imp:${D}`;
    await soon(`!!document.querySelector('[data-correct="${key}"]')`, 'the goal drawer');
    assert.match(await p.ev(`document.querySelector('[data-correct="${key}"]').parentElement.textContent`), /Moves a number the project watches \(3 of 4\)W2 is revenue\.\s+Judged by the supervisor [\s\S]* · the decision · the strategy\s+Wrong\?/);
    await p.click(`[data-correct="${key}"]`);
    await p.ev(`(() => { document.querySelector('select[data-impact="${key}"]').value = '4'; document.querySelector('input[data-reason="${key}"]').value = 'the launch blocker'; })()`);
    await p.click(`[data-correct-send="${key}"]`);
    await until(() => json(ok(old, ['goal', 'show', G])).impact.level === 4, 'the owner\'s value');
    assert.deepEqual([json(ok(old, ['goal', 'show', G])).impact.by, json(ok(old, ['goal', 'show', G])).impact.rationale], ['owner', 'the launch blocker']);
  } finally {
    p.close();
    await chrome.close();
    await dash.stop();
    F.done();
  }
});
