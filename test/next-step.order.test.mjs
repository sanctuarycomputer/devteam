// Next best step: the order as things change, owner actions, goal impact, defaults, and the floor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { json, line } from './lib/kit.mjs';
import { fixture, raw, SUP } from './lib/next-step-fixture.mjs';

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
    assert.deepEqual(inbox().map((q) => q.rank.score), [15, 16], 'it holds up a ticket, so it stays above a higher score nothing waits on');
    assert.deepEqual(inbox().map((q) => q.id), [unjudged, onb]);
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
    assert.match(order[0].rank.reason, /^holds up 1 ticket, 1 on the critical path, 5 more behind it; for Onboarding \(the supervisor's rating\): the project depends on it; the supervisor's rating: a feature waits on it; work is stopped on it now$/);
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

test('the floor: 170 unrated questions bury no one-way door, owner action or blocking question, and an unrated top is no "next best step"', () => {
  const F = fixture('nbs-floor');
  const { goal, feature, ticket, inbox } = F;
  try {
    const G = goal('Team billing', 1);
    feature('bill', G);
    ticket('bill-01-a', 'bill');
    const R = raw(F);
    // the review's fixture: 170 unrated, old proposals first, the ones that matter asked last
    const ordinary = Array.from({ length: 166 }, () => R.add({}));
    const approval = R.add({ kind: 'goal-approval', goal: G }, 300);
    const blocking = R.add({ blocks: ['bill-01-a'] }, 400);
    const door = R.add({ kind: 'one-way-door' }, 500);
    const secret = R.add({ kind: 'owner-action', secrets: [{ name: 'KEY', sink: 'file:.env.test' }] }, 600);
    R.flush();
    const qs = inbox();
    assert.equal(qs.length, 170);
    assert.deepEqual(qs.slice(0, 4).map((q) => q.id).sort(), [approval, blocking, door, secret].sort(), 'all four above every ordinary question');
    assert.equal(qs[0].id, blocking, 'the highest score leads the band');
    assert.deepEqual(qs.slice(4).map((q) => q.id), ordinary, 'the ordinary ones in their existing order: by score, then age');
    assert.ok(qs.every((q) => q.rank.top === false), 'nothing is "the next best step" when nothing is rated');
    assert.equal(qs.find((q) => q.id === door).rank.floor, 'a one-way door');
    // the ordinary ones rated high: the floor holds whatever the score
    const rated = raw(F);
    const high = Array.from({ length: 40 }, () => rated.add({ stake: 3, urgency: 2 }, 700));
    const lowDoor = rated.add({ kind: 'one-way-door', stake: 1, urgency: 1 }, 800);
    const lowBlock = rated.add({ stake: 1, urgency: 1, blocks: ['bill-01-a'] }, 801);
    rated.flush();
    const after = inbox();
    const at = (id) => after.findIndex((q) => q.id === id);
    assert.ok(at(lowDoor) < at(high[0]) && at(lowBlock) < at(high[0]) && at(secret) < at(high[0]), 'a low score does not bury them');
  } finally { F.done(); }
});

test('a default about to fire keeps its place: not halved, above the ordinary questions, and it says so', () => {
  const F = fixture('nbs-default-soon');
  const { goal, inbox, rank } = F;
  try {
    const G = goal('Team billing', 1);
    const R = raw(F);
    const ordinary = Array.from({ length: 44 }, () => R.add({ goal: G, stake: 3, urgency: 2 }));
    const soon = R.add({ goal: G, stake: 2, urgency: 3, default: 'yes', recommendation: 'yes', deadline: new Date(Date.now() + 5 * 60000).toISOString() });
    const later = R.add({ goal: G, stake: 2, urgency: 3, default: 'yes', recommendation: 'yes', deadline: new Date(Date.now() + 48 * 3600000).toISOString() });
    R.flush();
    const qs = inbox();
    assert.equal(qs[0].id, soon, `first of 46 (it came ${qs.findIndex((q) => q.id === soon) + 1})`);
    assert.deepEqual([rank(soon).own, rank(soon).floor], [12, 'its default is about to fire'], '2 × 2 × 3, not halved');
    assert.doesNotMatch(rank(soon).sum, /halved/);
    assert.equal(rank(later).own, 6, 'a default a long way off is still halved');
    assert.match(rank(later).sum, /halved for its default/);
    assert.ok(qs.findIndex((q) => q.id === later) > ordinary.length - 1, 'and stays with the ordinary questions');
    assert.ok(!rank(soon).reason.includes('work is stopped'), 'a default holds up no work');
    assert.match(rank(soon).sum, /urgency 3 \(rated 3, backed by its default\)/);
  } finally { F.done(); }
});
