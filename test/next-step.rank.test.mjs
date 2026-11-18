// Next best step: how a question ranks (the formula, what an answer settles, ratings that stand).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { json, kit, line } from './lib/kit.mjs';
import { fixture, SUP, yesNo } from './lib/next-step-fixture.mjs';

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
    assert.deepEqual(order.map((q) => q.id), [blocker, off, design, detail], 'by score within each band: what holds up a waiting ticket comes first');
    const [b, o, d, e] = order.map((q) => q.rank);
    // 3 × 1 × 3, + 2 for a critical-path ticket + 2 behind it
    assert.deepEqual([b.score, b.own, b.position, b.top], [13, 13, 1, true]);
    assert.equal(b.reason, 'holds up 1 ticket, 1 on the critical path, 2 more behind it; for Team billing (the supervisor\'s rating): moves a number the project watches; the supervisor\'s rating: a detail; work is stopped on it now');
    assert.equal(b.sum, 'score 13: impact 3 (moves a number the project watches) × stake 1 (a detail) × urgency 3 (work is stopped on it now) + 4 for the tickets it holds up');
    assert.deepEqual([d.score, d.reason], [12, 'for Team billing (the supervisor\'s rating): moves a number the project watches']);
    assert.deepEqual([o.score, o.parts.held_up, o.parts.on_path, o.parts.behind], [10, 1, 0, 0], '3 × 1 × 3 + 1 off the path');
    assert.deepEqual([e.score, e.reason], [6, 'for Team billing (the supervisor\'s rating): moves a number the project watches; the supervisor\'s rating: a detail']);
    // the text view: the same order, and a rank line on each rated question
    const text = ok(old, ['questions']);
    assert.ok(text.indexOf(blocker) < text.indexOf(off) && text.indexOf(off) < text.indexOf(design));
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
    assert.match(order[0].rank.reason, /^would settle 4 other questions; for Team billing \(the supervisor's rating\): moves a number the project watches; the supervisor's rating: decides whether the work goes ahead$/);
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
    assert.deepEqual(Object.keys(S.$defs.types.decision.properties.corrected.properties), ['reason', 'severity', 'impact', 'said', 'said_at', 'turn']);
    const L = json(/`{3}json devteam\s*\n([\s\S]*?)\n`{3}/.exec(fs.readFileSync(path.join(kit, 'governance/constitution.md'), 'utf8'))[1]);
    assert.ok(L.constitutional.includes('goal-impact') && !L.classes['goal-impact'], 'goal-impact is constitutional, never a ladder class');
    assert.ok(L.owner_only.includes('strategy-change'));
    // a worker may not rate: the command refuses, and a line written by hand counts for nothing
    assert.notEqual(F.run(old, ['rate', q1, '--stake', '1'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'x-01-y' }).status, 0);
    const q2 = ask('Still open?', '--goal', G, '--stake', '1', '--urgency', '1');
    fs.appendFileSync(path.join(old, 'docs/devteam/run/log', 'x-01-y.jsonl'), line({ id: q2, type: 'question', op: 'set', at: new Date().toISOString(), by: 'x-01-y', stake: 3 }));
    assert.equal(json(ok(old, ['questions', '--id', q2, '--json']))[0].stake, 1, 'a worker\'s line sets no rating');
    // a rating outside 1 to 3, or a settles that is no list (written by hand; log-check refuses it), is no
    // rating: the order never multiplies it, and the Inbox still reads
    fs.appendFileSync(path.join(old, 'docs/devteam/run/log', `supervisor-${new Date().toISOString().slice(0, 7)}.jsonl`), line({ id: q2, type: 'question', op: 'set', at: new Date().toISOString(), by: 'supervisor', stake: 99, urgency: 99, settles: 5 }));
    assert.notEqual(F.run(old, ['log-check']).status, 0);
    const wild = json(ok(old, ['questions', '--json'])).find((q) => q.id === q2);
    assert.deepEqual([wild.stake, wild.urgency, wild.settles, wild.rank.parts.rated, wild.rank.score], [null, null, [], false, 4], 'counted as not rated: 2 × 2 × 1');
  } finally { F.done(); }
});

test('settles-if names a choice however it is cased, as an answer does', () => {
  const F = fixture('nbs-settles-if');
  const { goal, ask, inbox } = F;
  try {
    const G = goal('Team billing', 1);
    const detail = ask('Round to cents?', '--goal', G, '--stake', '1', '--urgency', '2');
    const gate = ask('Build it?', '--goal', G, ...yesNo, '--stake', '3', '--urgency', '1', '--settles', detail, '--settles-if', "don't BUILD it");
    assert.equal(inbox().find((q) => q.id === gate).settles_label, "Don't build it");
  } finally { F.done(); }
});
