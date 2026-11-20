// Review records carry a "- Date:" line (quality.md §3), so metrics can tell recent first passes from
// all time: each stage's last_7d, `metrics --since` counting only dated passes on or after the date,
// and review-churn judged on the last 7 days once they hold enough passes, so a stage whose specs
// got better goes quiet instead of carrying its history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { threadsFixture } from './lib/kit.mjs';

const DAY = 86400000;
const FLOORS = { DEVTEAM_EFFICIENCY_MIN_MERGED: '1', DEVTEAM_CHURN_MIN_PASSES: '2' };
const iso = (agoMs) => new Date(Date.now() - agoMs).toISOString().slice(0, 16) + 'Z';
const rec = (verdict, date) => `- Reviewer: r\n${date ? `- Date: ${date}\n` : ''}\n| Id | Severity | Rule | Where | Finding | Disposition |\n|---|---|---|---|---|---|\n${verdict === 'CHANGES' ? '| R1 | Important | L-TEST-1 | a.js:1 | weak-check: no test | |\n' : ''}\nVerdict: ${verdict} 0000000\n`;

test('dated first passes: last_7d apart from all time, --since filters, review-churn follows the recent rate', () => {
  const F = threadsFixture('review-dates');
  try {
    F.sup(['feature', 'add', 'rdates', '--json', JSON.stringify({ title: 'Rd', goals: [F.goal], stories: [{ id: 'RD-S1', text: 'dates read right', release: 'v1.0.0' }] })]);
    // four old specs rejected 20 days ago, one undated rejected, and two recent ones approved
    const plan = [['rd-01-spec', 'CHANGES', iso(20 * DAY)], ['rd-02-spec', 'CHANGES', iso(20 * DAY)], ['rd-03-spec', 'CHANGES', iso(20 * DAY)], ['rd-04-spec', 'CHANGES', iso(20 * DAY)], ['rd-05-spec', 'CHANGES', null], ['rd-06-spec', 'APPROVE', iso(DAY)], ['rd-07-spec', 'APPROVE', iso(2 * DAY)]];
    for (const [id, verdict, date] of plan) {
      F.sup(['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'rdates', component: 'web', kind: 'build', size: 'S', risk: 'normal', serves: ['RD-S1'], depends_on: [], touches: [`src/${id}/**`], done_when: ['its test passes in CI'] })]);
      const dir = path.join(F.old, 'docs/devteam/project/tickets', id, 'reviews');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'spec-1.md'), rec(verdict, date));
    }
    F.g(['add', '-A'], F.old); F.g(['commit', '-qm', 'reviews'], F.old); F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);

    const m = JSON.parse(F.sup(['metrics', '--json'], FLOORS));
    const spec = m.reviews.by_stage.spec;
    assert.equal(spec.first_passes, 7, 'all time counts every first pass, dated or not');
    assert.equal(spec.rejected, 5);
    assert.equal(spec.undated, 1);
    assert.deepEqual(spec.last_7d, { first_passes: 2, rejected: 0, rejection_rate: 0 }, 'the last 7 days hold the two recent approvals');
    // 5 of 7 all time is over 60%, but the last 7 days have enough passes and none rejected: quiet
    assert.ok(!m.findings.some((f) => f.kind === 'review-churn' && f.subject === 'spec review'), JSON.stringify(m.findings.filter((f) => f.kind === 'review-churn')));

    // --since a date between: only the dated passes on or after it, the undated one left out
    const s = JSON.parse(F.sup(['metrics', '--since', new Date(Date.now() - 10 * DAY).toISOString().slice(0, 10), '--json'], FLOORS));
    assert.equal(s.reviews.by_stage.spec.first_passes, 2);
    assert.equal(s.reviews.by_stage.spec.rejected, 0);

    // with no recent passes past the floor, churn is judged on all time as before
    const q = JSON.parse(F.sup(['metrics', '--json'], { ...FLOORS, DEVTEAM_CHURN_MIN_PASSES: '3' }));
    const churn = q.findings.find((f) => f.kind === 'review-churn' && f.subject === 'spec review');
    assert.ok(churn && !/last 7 days/.test(churn.detail ?? churn.summary ?? JSON.stringify(churn)), JSON.stringify(churn));
  } finally { F.done(); }
});
