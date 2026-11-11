// A running goal at its target closes on the owner's word, asked in the Inbox (planning.md §1): the
// goal-at-target finding, one goal-met question for every source, the owner's yes that marks it met
// (a repo or prod check read again first), and what a hand-written line can't do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, write, json, line } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };

// A ready goal read from source, its check or question given; approved by the owner.
function readyGoal(F, { source, check, question, target = 0, direction = 'down', unit = 'gaps', milestones }) {
  const { old, ok } = F;
  const G = ok(old, ['goal', 'add', '--title', `Floor ${source}`, '--outcome', 'the floor holds', '--measure', 'floor gaps', '--target', String(target), '--unit', unit, '--direction', direction, '--source', source, ...(check ? ['--check', check] : []), ...(question ? ['--question', question] : []), '--non-goals', 'none', '--preconditions', 'a', 'b'], SUP);
  if (milestones) ok(old, ['goal', 'set', G, '--milestones', JSON.stringify(milestones)], SUP);
  ok(old, ['goal', 'decide', G, 'approve', '--force']);
  return G;
}
const onMain = (F, file, text) => { write(path.join(F.old, file), text); F.g(['add', '-A'], F.old); F.g(['commit', '-qm', file], F.old); F.g(['push', '-q', 'origin', 'main'], F.old); };
const findings = (F, kind = 'goal-at-target') => json(F.ok(F.old, ['metrics', '--json'])).findings.filter((f) => f.kind === kind);
const goal = (F, G) => json(F.ok(F.old, ['goal', 'show', G]));
const question = (F, Q) => json(F.ok(F.old, ['questions', '--id', Q, '--json']))[0];
const supLog = (F) => path.join(F.old, 'docs/devteam/run/log', `supervisor-${new Date().toISOString().slice(0, 7)}.jsonl`);

test('a repo goal at its target: the finding, the kit-worded question, and the yes that reads main again', () => {
  const F = fleetFixture('met-repo');
  const { old, ok, run } = F;
  try {
    onMain(F, 'gaps.txt', '3\n');
    const G = readyGoal(F, { source: 'repo', check: 'cat gaps.txt', milestones: [{ title: 'half', target: 1, preconditions: [1], tickets: 1 }, { title: 'all', target: 0, preconditions: [2], tickets: 1 }] });
    ok(old, ['goal', 'reading', G, '--run'], SUP);
    assert.deepEqual(findings(F), [], 'not at its target: no finding');
    assert.match(run(old, ['ask', '--class', 'goal-met', '--goal', G, '--recommendation', 'yes'], SUP).err, /latest reading is 3 gaps .*not at its target 0 on its last milestone: take one/);

    onMain(F, 'gaps.txt', '0\n');
    ok(old, ['goal', 'reading', G, '--run'], SUP);
    const [f] = findings(F);
    assert.equal(f?.severity, 'medium', 'medium: the tick reads it, wait does not loop on it');
    assert.equal(f.subject, G);
    assert.match(f.suggestion, /in the Inbox, never only in chat: ask --class goal-met --goal /);
    assert.equal(goal(F, G).at_target.value, 0, 'the card knows');

    // the refusals
    const refused = (extra, re) => assert.match(run(old, ['ask', '--class', 'goal-met', '--goal', G, ...extra], SUP).err, re, extra.join(' '));
    refused(['--recommendation', 'no'], /recommends yes/);
    refused(['--recommendation', 'yes', '--default', 'yes'], /no --default/);
    refused(['--recommendation', 'yes', '--choices', '[{"label":"Sure"}]'], /choices are the kit's/);
    refused(['--recommendation', 'yes', '--question', 'Can I take Friday off?'], /asks in the kit's words; leave out --question/);
    const Q = ok(old, ['ask', '--class', 'goal-met', '--goal', G, '--recommendation', 'yes'], SUP);
    refused(['--recommendation', 'yes'], /already open/);
    const q = question(F, Q);
    assert.equal(q.question, `Is "Floor repo" met? floor gaps reads 0 gaps, and its target is 0 gaps.`);
    assert.match(q.context, /The latest reading is 0 gaps, taken \d{4}-\d\d-\d\d at \d\d:\d\d UTC on main at [0-9a-f]{12}\. If you say yes, the kit reads it again on main/);
    assert.deepEqual(q.choices.map((c) => c.label), ['Yes', 'No']);
    assert.equal(q.recommendation, 'Yes');
    assert.equal(q.met.reading.value, 0);
    assert.deepEqual(findings(F), [], 'quiet while it is open');

    // a stale page can't answer it, and the hash covers met
    assert.match(run(old, ['answer', Q, 'Yes', '--seen', '0000000000000000']).err, /changed since you saw it/);
    assert.match(run(old, ['answer', Q, 'Yes please']).err, /is answered Yes or No/, 'a near-yes is neither');
    assert.equal(question(F, Q).status, 'open');
    const out = ok(old, ['answer', Q, 'Yes']);
    assert.match(out, new RegExp(`${G} is met \\(its check reads 0 gaps on main at [0-9a-f]{12}\\)`));
    const g = goal(F, G);
    assert.equal(g.status, 'met');
    assert.deepEqual(g.decision, { verdict: 'met', question: Q });
    assert.match(g.readings.at(-1).sha, /^[0-9a-f]{40}$/, 'the re-read is recorded');
    assert.deepEqual(findings(F), []);
    ok(old, ['log-check']);
  } finally { F.done(); }
});

test('a yes after main fell back below the target records the new reading and leaves the goal running', () => {
  const F = fleetFixture('met-fell');
  const { old, ok } = F;
  try {
    onMain(F, 'gaps.txt', '0\n');
    const G = readyGoal(F, { source: 'repo', check: 'cat gaps.txt' });
    ok(old, ['goal', 'reading', G, '--run'], SUP);
    const Q = ok(old, ['ask', '--class', 'goal-met', '--goal', G, '--recommendation', 'yes'], SUP);
    onMain(F, 'gaps.txt', '2\n');
    assert.match(ok(old, ['answer', Q, 'Yes']), new RegExp(`${G} keeps running: its check reads 2 gaps now`));
    const g = goal(F, G);
    assert.equal(g.status, 'ready');
    assert.equal(g.readings.at(-1).value, 2);
    assert.equal(question(F, Q).status, 'answered', "the owner's yes is on record");
    assert.deepEqual(findings(F), [], 'not at its target now');
    // a check that fails writes nothing, and the question stays open for another try
    onMain(F, 'gaps.txt', '0\n');
    ok(old, ['goal', 'reading', G, '--run'], SUP);
    const Q2 = ok(old, ['ask', '--class', 'goal-met', '--goal', G, '--recommendation', 'yes'], SUP);
    F.g(['rm', '-q', 'gaps.txt'], old); F.g(['commit', '-qm', 'rm'], old); F.g(['push', '-q', 'origin', 'main'], old);
    const r = F.run(old, ['answer', Q2, 'Yes']);
    assert.notEqual(r.status, 0);
    assert.match(r.err, /check failed/);
    assert.equal(question(F, Q2).status, 'open', 'nothing was answered');
    ok(old, ['log-check']);
  } finally { F.done(); }
});

test('a prod goal: the yes runs the production check again; goal status met does too', () => {
  const F = fleetFixture('met-prod');
  const { old, ok, run } = F;
  try {
    write(path.join(old, 'prod.txt'), '12\n');
    const G = readyGoal(F, { source: 'prod', check: 'cat prod.txt', target: 12, direction: 'up', unit: 'resources' });
    ok(old, ['goal', 'reading', G, '--run'], SUP);
    assert.equal(findings(F).length, 1);
    write(path.join(old, 'prod.txt'), '11\n');
    assert.match(run(old, ['goal', 'status', G, 'met']).err, /check reads 11 from production, not its target 12/, 'goal status reads prod again');
    write(path.join(old, 'prod.txt'), '12\n');
    const No = ok(old, ['ask', '--class', 'goal-met', '--goal', G, '--recommendation', 'yes'], SUP);
    assert.match(question(F, No).context, /from its production check/);
    ok(old, ['answer', No, 'No — not on every tenant']);
    ok(old, ['goal', 'reading', G, '--run'], SUP);
    assert.deepEqual(findings(F), [], 'a No about the same value stands while the value does');
    write(path.join(old, 'prod.txt'), '13\n');
    ok(old, ['goal', 'reading', G, '--run'], SUP);
    assert.equal(findings(F).length, 1, 'a new value asks again');
    const Q = ok(old, ['ask', '--class', 'goal-met', '--goal', G, '--recommendation', 'yes'], SUP);
    // Mark met (goal status met) while the question is open answers it Yes
    assert.match(ok(old, ['goal', 'status', G, 'met']), new RegExp(`${G} is met \\(and ${Q} is answered Yes\\)`));
    const q = question(F, Q);
    assert.deepEqual([q.status, q.answer], ['answered', 'Yes']);
    assert.deepEqual(goal(F, G).decision, { verdict: 'met', question: Q });
    assert.equal(goal(F, G).status, 'met');
    ok(old, ['log-check']);
  } finally { F.done(); }
});

test('an owner goal: the yes is the reading and marks it met; a no leaves it running; chat counts', () => {
  const F = fleetFixture('met-owner');
  const { old, ok, run } = F;
  try {
    const ask = 'Have you checked the case study tab?';
    const G = readyGoal(F, { source: 'owner', question: ask, target: 1, direction: 'up', unit: 'attested' });
    assert.match(run(old, ['ask', '--class', 'goal-met', '--goal', G, '--recommendation', 'yes', '--question', 'Something else?'], SUP).err, /kit's words/);
    const No = ok(old, ['ask', '--class', 'goal-met', '--goal', G, '--recommendation', 'yes', '--question', ask], SUP);
    assert.equal(question(F, No).question, ask);
    assert.match(question(F, No).context, /About "Floor owner"\. If you say yes, the goal is marked met/);
    ok(old, ['answer', No, 'No']);
    assert.equal(goal(F, G).status, 'ready', 'a no leaves it running');
    assert.deepEqual(goal(F, G).readings, []);
    const Yes = ok(old, ['ask', '--class', 'goal-met', '--goal', G, '--recommendation', 'yes'], SUP);
    assert.match(ok(old, ['answer', Yes, 'Yes', '--from-chat', '--said', 'yes, it lists the right projects'], SUP), new RegExp(`${G} is met`));
    const g = goal(F, G);
    assert.equal(g.status, 'met');
    assert.equal(g.readings.at(-1).approved, Yes);
    ok(old, ['log-check']);
  } finally { F.done(); }
});

test('an owner goal attested the old way is found at its target, and the new question says so', () => {
  const F = fleetFixture('met-legacy');
  const { old, ok } = F;
  try {
    const ask = 'Have you checked the case study tab?';
    const G = readyGoal(F, { source: 'owner', question: ask, target: 1, direction: 'up', unit: 'attested' });
    // a goal-met question as an older kit wrote it: no met, its own words
    const at = new Date(Date.now() - 60000).toISOString();
    const Old = `q-${at.slice(0, 10).replace(/-/g, '')}-${at.slice(11, 23).replace(/[:.]/g, '')}-supervisor`;
    fs.appendFileSync(supLog(F), line({ id: Old, type: 'question', op: 'new', at, by: 'supervisor', kind: 'owner-decision', class: 'goal-met', goal: G, question: ask, recommendation: 'yes', why_asked: { reasons: [] } }));
    assert.match(ok(old, ['answer', Old, 'yes']), /asked before goal-met questions carried the goal .* sets nothing/);
    assert.equal(goal(F, G).status, 'ready');
    ok(old, ['goal', 'reading', G, '--approved', Old], SUP);
    const [f] = findings(F);
    assert.equal(f?.subject, G, '1 -> 1 attested, still running: found');
    const Q = ok(old, ['ask', '--class', 'goal-met', '--goal', G, '--recommendation', 'yes'], SUP);
    assert.match(question(F, Q).context, new RegExp(`You said yes to ${Old} on \\d{4}-\\d\\d-\\d\\d, but the goal was never marked met; this marks it`));
    ok(old, ['answer', Q, 'Yes']);
    assert.equal(goal(F, G).status, 'met');
    ok(old, ['log-check']);
  } finally { F.done(); }
});

test("the owner's yes is bound to the goal as asked, and a hand-written line can't close a goal", () => {
  const F = fleetFixture('met-bound');
  const { old, ok, run } = F;
  try {
    write(path.join(old, 'prod.txt'), '0\n');
    const G = readyGoal(F, { source: 'prod', check: 'cat prod.txt' });
    // the supervisor writes status met by hand: the fold ignores it
    const at = new Date().toISOString();
    fs.appendFileSync(supLog(F), line({ id: G, type: 'goal', op: 'set', at, by: 'supervisor', status: 'met' }));
    assert.equal(goal(F, G).status, 'ready', 'a goal set with status from the supervisor counts for nothing');
    // a forged prod reading raises the finding, and that is all it does: the yes reads production
    write(path.join(old, 'prod.txt'), '5\n');
    const at2 = new Date(Date.now() - 1000).toISOString();
    fs.appendFileSync(supLog(F), line({ id: `o-${at2.slice(0, 10).replace(/-/g, '')}-${at2.slice(11, 23).replace(/[:.]/g, '')}-supervisor`, type: 'observation', op: 'new', at: at2, by: 'supervisor', source: 'prod', subject: G, kind: 'reading', detail: 'made up', measure: { value: 0, unit: 'gaps' }, refs: [G] }));
    assert.equal(findings(F).length, 1);
    const Q = ok(old, ['ask', '--class', 'goal-met', '--goal', G, '--recommendation', 'yes'], SUP);
    assert.match(ok(old, ['answer', Q, 'Yes']), /keeps running: its check reads 5 gaps now/);
    assert.equal(goal(F, G).status, 'ready');

    // a yes after the measure changed doesn't mark it met
    write(path.join(old, 'prod.txt'), '0\n');
    ok(old, ['goal', 'reading', G, '--run'], SUP);
    const Q2 = ok(old, ['ask', '--class', 'goal-met', '--goal', G, '--recommendation', 'yes'], SUP);
    ok(old, ['goal', 'set', G, '--target', '1', '--owner']);
    assert.match(ok(old, ['answer', Q2, 'Yes']), /changed after .* was asked, so this yes doesn't mark it met/);
    assert.equal(goal(F, G).status, 'ready');

    // a hand-written goal-met question in other words, or recommending no, sets nothing
    const forged = (extra, n) => {
      const t = new Date(Date.now() - 3000 + n).toISOString();
      const id = `q-${t.slice(0, 10).replace(/-/g, '')}-${t.slice(11, 23).replace(/[:.]/g, '')}-supervisor`;
      const real = question(F, ok(old, ['ask', '--class', 'goal-met', '--goal', G, '--recommendation', 'yes'], SUP));
      ok(old, ['withdraw', real.id], SUP);
      fs.appendFileSync(supLog(F), line({ id, type: 'question', op: 'new', at: t, by: 'supervisor', kind: 'owner-decision', class: 'goal-met', goal: G, question: real.question, choices: real.choices, recommendation: 'Yes', met: real.met, why_asked: { reasons: [] }, ...extra }));
      return id;
    };
    ok(old, ['goal', 'reading', G, '--run'], SUP);
    const words = forged({ question: 'Can I take Friday off?' }, 1);
    assert.match(ok(old, ['answer', words, 'Yes']), /is not the kit's goal-met question/);
    const no = forged({ recommendation: 'No', choices: [{ label: 'No' }] }, 2);
    assert.equal(ok(old, ['answer', no, 'No']), `answered ${no}`, 'a no, even one that is the recommendation, sets nothing');
    assert.equal(goal(F, G).status, 'ready');
    assert.match(run(old, ['log-check']).out + run(old, ['log-check']).err, /supervisor may not set goal\.status/, 'log-check names the hand-written status line');
  } finally { F.done(); }
});
