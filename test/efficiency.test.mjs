// The efficiency findings (supervisor.md §9) from records made to cross each threshold, and to stay
// under it: waiting-heavy (over half of ticket hours waiting), review-churn (over 60% of a stage's
// first passes rejected), mis-rated (an S ticket with 3 final passes), and top_blocking_rules by value.
// None of them needs measured spend: a fleet with no harness logs gets them too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { threadsFixture } from './lib/kit.mjs';

const H = 3600000;
const FLOORS = { DEVTEAM_EFFICIENCY_MIN_MERGED: '1', DEVTEAM_CHURN_MIN_PASSES: '1' };
const rec = (verdict, rows = []) => `- Reviewer: r\n\n| Id | Severity | Rule | Where | Finding | Disposition |\n|---|---|---|---|---|---|\n${rows.map((r, i) => `| R${i + 1} | ${r[0]} | ${r[1]} | a.js:1 | ${r[2]} | |\n`).join('')}\nVerdict: ${verdict} 0000000\n`;

test('efficiency findings fire over their thresholds and stay quiet under them, with no measured spend', () => {
  const F = threadsFixture('efficiency');
  try {
    const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
    const phaseLine = (id, from, to, agoMs) => F.hand(id, { id: `h-${stamp(new Date(Date.now() - agoMs))}-${id}`, type: 'phase', from, to }, agoMs, `${id}.jsonl`);
    F.sup(['feature', 'add', 'eff', '--json', JSON.stringify({ title: 'Eff', goals: [F.goal], stories: [{ id: 'EF-S1', text: 'efficiency reads right', release: 'v1.0.0' }] })]);
    const ids = ['e-01-churn', 'e-02-calm'];
    for (const id of ids) F.sup(['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'eff', component: 'web', kind: 'build', size: 'S', risk: 'normal', serves: ['EF-S1'], depends_on: [], touches: [`src/${id}/**`], done_when: ['its test passes in CI'] })]);
    // each waited 2.5 of its 3 hours (starting, then awaiting-word), then built for half an hour
    for (const id of ids) { phaseLine(id, null, 'starting', 3 * H); phaseLine(id, 'starting', 'awaiting-word', 2.9 * H); phaseLine(id, 'awaiting-word', 'build', 0.5 * H); }
    // reviews: both spec first passes rejected (100%, over 60%), one of two plan first passes (50%, under)
    const dir = (id) => path.join(F.old, 'docs/devteam/project/tickets', id, 'reviews');
    const put = (id, file, text) => { fs.mkdirSync(dir(id), { recursive: true }); fs.writeFileSync(path.join(dir(id), file), text); };
    put('e-01-churn', 'spec-1.md', rec('CHANGES', [['Important', 'L-LOGIC-3 (states the logic)', 'no edge case'], ['Minor', 'style', 'a nit']]));
    put('e-02-calm', 'spec-1.md', rec('CHANGES', [['Critical', 'L-LOGIC-3', 'wrong rule'], ['Important', 'a long rule in prose that goes on well past forty characters', 'missing']]));
    put('e-01-churn', 'plan-1.md', rec('CHANGES', [['Important', 'L-TEST-1', 'no test']]));
    put('e-02-calm', 'plan-1.md', rec('APPROVE'));
    // e-01 took three final passes: an S ticket rated low that wasn't
    for (const n of [1, 2]) put('e-01-churn', `final-${n}.md`, rec('CHANGES', [['Important', 'L-TEST-1', 'still']]));
    put('e-01-churn', 'final-3.md', rec('APPROVE'));
    put('e-02-calm', 'final-1.md', rec('APPROVE'));
    // both merge: a commit on main named for each ticket
    for (const id of ids) { F.g(['add', '-A'], F.old); F.g(['commit', '-qm', `${id}: done`, '--allow-empty'], F.old); }
    F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);

    const m = JSON.parse(F.sup(['metrics', '--json'], FLOORS));
    assert.notEqual(m.cost.source, 'measured', 'no harness logs here');
    const has = (kind, subject) => m.findings.some((f) => f.kind === kind && (subject === undefined || f.subject === subject));
    assert.ok(m.efficiency.wait_hours_pct > 50, `waiting share ${m.efficiency.wait_hours_pct}`);
    assert.ok(has('waiting-heavy'), 'waiting-heavy fires over half');
    assert.equal(m.reviews.by_stage.spec.rejection_rate, 1);
    assert.ok(has('review-churn', 'spec review'), 'review-churn fires at spec (2 of 2)');
    assert.equal(m.reviews.by_stage.plan.rejection_rate, 0.5);
    assert.ok(!has('review-churn', 'plan review'), 'and not at plan (1 of 2)');
    // top_blocking_rules by value: an id is kept from its prose, prose is cut at 40, Minor never counts
    assert.deepEqual(m.reviews.by_stage.spec.top_blocking_rules, [{ rule: 'L-LOGIC-3', count: 2 }, { rule: 'a long rule in prose that goes on well p', count: 1 }]);
    assert.deepEqual(m.reviews.by_stage.plan.top_blocking_rules, [{ rule: 'L-TEST-1', count: 1 }]);
    const mr = m.mis_rated.find((x) => x.id === 'e-01-churn');
    assert.ok(mr && mr.why.includes('3 final-review passes'), JSON.stringify(m.mis_rated));
    assert.ok(!m.mis_rated.some((x) => x.id === 'e-02-calm'));
    assert.ok(has('mis-rated', 'e-01-churn'));
    // an escaped defect traced to the calm ticket makes it mis-rated too
    F.hand('supervisor', { type: 'observation', source: 'supervisor', subject: 'e-02-calm', kind: 'escaped-defect', detail: 'found after merge', severity: 3, valence: -1 }, 60000);
    const md = JSON.parse(F.sup(['metrics', '--json'], FLOORS));
    assert.ok(md.mis_rated.find((x) => x.id === 'e-02-calm')?.why.includes('an escaped defect traced to it'), JSON.stringify(md.mis_rated));
    // three more tickets that built for ten hours with no wait: the waiting share falls under half, and waiting-heavy goes quiet
    for (const id of ['e-03-busy', 'e-04-busy', 'e-05-busy']) {
      F.sup(['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'eff', component: 'web', kind: 'build', size: 'S', risk: 'normal', serves: ['EF-S1'], depends_on: [], touches: [`src/${id}/**`], done_when: ['its test passes in CI'] })]);
      phaseLine(id, null, 'build', 10 * H);
      F.g(['commit', '-qm', `${id}: done`, '--allow-empty'], F.old);
    }
    F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
    const mq = JSON.parse(F.sup(['metrics', '--json'], FLOORS));
    assert.ok(mq.efficiency.wait_hours_pct < 50, `waiting share ${mq.efficiency.wait_hours_pct}`);
    assert.ok(!mq.findings.some((f) => f.kind === 'waiting-heavy'), 'under half waiting, waiting-heavy is quiet');
    // under the default floors (5 merged tickets, 10 first passes) the two rate findings stay quiet
    const q = JSON.parse(F.sup(['metrics', '--json']));
    assert.ok(!q.findings.some((f) => ['waiting-heavy', 'review-churn'].includes(f.kind)), 'too little evidence to speak');
  } finally { F.done(); }
});

// A ticket in flight with 3 final passes is medium review-churn; at 5 it is high, so wait wakes and
// the loop ends in a re-plan, a split or a question (S28): each pass restarts the phase, so nothing
// else ever calls it stale. Once its last pass approved it is medium again: it only waits to merge.
test('review-churn on an unmerged ticket: medium at 3 final passes, high at 5, medium once the last approved', () => {
  const F = threadsFixture('churn-cap');
  try {
    F.sup(['feature', 'add', 'eff', '--json', JSON.stringify({ title: 'Eff', goals: [F.goal], stories: [{ id: 'EF-S1', text: 'efficiency reads right', release: 'v1.0.0' }] })]);
    const id = 'e-01-loop';
    F.sup(['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'eff', component: 'web', kind: 'build', size: 'S', risk: 'normal', serves: ['EF-S1'], depends_on: [], touches: [`src/${id}/**`], done_when: ['its test passes in CI'] })]);
    const dir = path.join(F.old, 'docs/devteam/project/tickets', id, 'reviews');
    fs.mkdirSync(dir, { recursive: true });
    const churn = () => JSON.parse(F.sup(['metrics', '--json'])).findings.filter((f) => f.kind === 'review-churn' && f.subject === id);
    for (const n of [1, 2, 3]) fs.writeFileSync(path.join(dir, `final-${n}.md`), rec('CHANGES', [['Important', 'L-TEST-1', 'still']]));
    assert.deepEqual(churn().map((f) => [f.severity, f.detail]), [['medium', '3 final review passes']]);
    for (const n of [4, 5]) fs.writeFileSync(path.join(dir, `final-${n}.md`), rec('CHANGES', [['Important', 'L-TEST-1', 'still']]));
    const [f, ...rest] = churn();
    assert.deepEqual(rest, []);
    assert.deepEqual([f.severity, f.detail], ['high', '5 final review passes']);
    assert.match(f.suggestion, /re-plan it, split it, or ask the owner/);
    // a 6th pass that approves ends the loop: it only waits to merge, so medium again, not high
    fs.writeFileSync(path.join(dir, 'final-6.md'), rec('APPROVE'));
    assert.deepEqual(churn().map((x) => [x.severity, x.detail]), [['medium', '6 final review passes']]);
  } finally { F.done(); }
});
