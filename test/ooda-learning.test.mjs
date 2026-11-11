// The weekly learning record and the chart (the OODA spec, PR 5): observe-metrics writes one
// observation per ended ISO week with the week's figures, back-filled from the log as it stood at
// each week's end; the dashboard reads them and never writes one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, json, line } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const DAY = 86400000;
const HOUR = 3600000;
const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
// Monday 00:00 UTC of the week ms falls in, and that week's ISO name.
const mondayOf = (ms) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY; };
const isoWeek = (ms) => {
  const m = mondayOf(ms);
  const y = new Date(m + 3 * DAY).getUTCFullYear();
  const w1 = mondayOf(Date.UTC(y, 0, 4));
  return `${y}-W${String(1 + Math.round((m - w1) / (7 * DAY))).padStart(2, '0')}`;
};
// A line as the kit would have written it at ms, in its writer's file. Lines go in time order.
function handFor(F) {
  const logDir = path.join(F.old, 'docs/devteam/run/log');
  return (by, o, ms) => {
    const d = new Date(ms);
    const id = o.id ?? `${{ observation: 'o', problem: 'p', decision: 'd', act: 'a', knowledge: 'k', question: 'q' }[o.type]}-${stamp(d)}-${by}`;
    const file = ['owner', 'supervisor'].includes(by) ? `${by}-${d.toISOString().slice(0, 7)}.jsonl` : `${by}.jsonl`;
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, file), line({ op: 'new', ...(by === 'owner' ? { channel: 'cli' } : {}), ...o, id, at: d.toISOString(), by }));
    return id;
  };
}
const learnings = (F) => json(F.ok(F.old, ['log', '--type', 'observation', '--json'])).filter((o) => o.kind === 'learning').sort((a, b) => a.week.localeCompare(b.week));

// Three past weeks, A, B and C, with something to count in each; the current week is never counted.
function threeWeeks(F) {
  const hand = handFor(F);
  const A = mondayOf(Date.now()) - 21 * DAY, B = A + 7 * DAY, C = B + 7 * DAY;
  const o1 = hand('supervisor', { type: 'observation', source: 'repo', subject: 'app', kind: 'note', detail: 'the build was slow' }, A + HOUR);
  const o2 = hand('supervisor', { type: 'observation', source: 'repo', subject: 'app', kind: 'note', detail: 'the build was slow again' }, A + DAY + HOUR);
  const o3 = hand('supervisor', { type: 'observation', source: 'repo', subject: 'app', kind: 'note', detail: 'the build was slow a third time' }, A + 2 * DAY);
  const k1 = hand('owner', { type: 'knowledge', kind: 'lesson', statement: 'Cache the build', scope: 'project', status: 'accepted', evidence: [o1] }, A + 2 * DAY + HOUR);
  const d1 = hand('supervisor', { type: 'decision', class: 'priority-change', what: 'raised the build fix', authority: 'rung', rung: 3 }, A + 3 * DAY);
  const d2 = hand('supervisor', { type: 'decision', class: 'priority-change', what: 'lowered the docs', authority: 'default' }, A + 3 * DAY + HOUR);
  const a1 = hand('supervisor', { type: 'act', class: 'worker-slots', what: 'made worker ab-01-a in .worktrees/ab-01-a', refs: ['ab-01-a'], knowledge: [k1] }, A + 4 * DAY);
  const q1 = hand('supervisor', { type: 'question', kind: 'owner-decision', class: 'priority-change', question: 'Ship the cache?', recommendation: 'Yes', options: ['Yes', 'No'] }, B + HOUR);
  const q2 = hand('supervisor', { type: 'question', kind: 'owner-action', question: 'Log in to the registry?' }, B + 2 * HOUR);
  hand('owner', { type: 'question', op: 'set', id: q1, answer: 'Yes' }, B + 3 * HOUR);
  hand('owner', { type: 'decision', op: 'set', id: d1, corrected: { reason: 'not that one' } }, B + DAY);
  const a2 = hand('supervisor', { type: 'act', class: 'worker-slots', what: 'made worker ab-02-b in .worktrees/ab-02-b', refs: ['ab-02-b'] }, B + 2 * DAY);
  const a3 = hand('supervisor', { type: 'act', class: 'worker-slots', what: 'resumed worker ab-01-a in .worktrees/ab-01-a', refs: ['ab-01-a'] }, B + 2 * DAY + HOUR);
  const o4 = hand('supervisor', { type: 'observation', source: 'repo', subject: 'app', kind: 'note', detail: 'the build was slow once more' }, B + 3 * DAY);
  hand('owner', { type: 'knowledge', op: 'set', id: k1, status: 'retired' }, C + HOUR);
  const d3 = hand('supervisor', { type: 'decision', class: 'priority-change', what: 'raised the tests', authority: 'standing-rule' }, C + 2 * HOUR);
  return { A, B, C, o1, o2, o3, o4, k1, d1, d2, d3, a1, a2, a3, q1, q2, weeks: [isoWeek(A), isoWeek(B), isoWeek(C)] };
}

test('observe-metrics back-fills one learning record per ended week, idempotently; the dashboard never writes one', () => {
  const F = fleetFixture('ooda-learning');
  const { old, ok } = F;
  try {
    const X = threeWeeks(F);
    // reading the dashboard writes nothing
    const before = json(ok(old, ['dashboard-data']));
    assert.deepEqual(before.ooda.learning, []);
    assert.equal(learnings(F).length, 0, 'dashboard-data wrote a learning record');

    const t0 = new Date().toISOString();
    ok(old, ['observe-metrics'], SUP);
    const rs = learnings(F);
    assert.deepEqual(rs.map((r) => r.week), X.weeks, 'one per ended week since the log began, none for this week');
    for (const r of rs) {
      assert.equal(r.source_key, `learning:${r.week}`);
      assert.equal(r.source, 'metrics');
      assert.equal(r.detector, 'metrics');
      assert.equal(r.subject, 'project');
      assert.ok(r.created_at >= t0, `stamped now, not back-dated: ${r.created_at}`);
      assert.ok(r.detail.length <= 300 && r.detail.length > 0);
      assert.ok(r.refs.length <= 60);
    }
    const [a, b, c] = rs;
    assert.deepEqual(a.figures, {
      informed: { knowledge: 1, signals_explained: 1, signals_formed: 1, starts_given: 1, starts: 1 },
      autonomous: { trusted_calls: 1, ladder_calls: 2, questions: 0, merged: 0 },
      trusted: { agreed: 0, answered: 0, corrections: 0, calls: 3 },
    });
    assert.deepEqual(b.figures, {
      informed: { knowledge: 1, signals_explained: 1, signals_formed: 1, starts_given: 0, starts: 1 },
      autonomous: { trusted_calls: 0, ladder_calls: 0, questions: 1, merged: 0 },
      trusted: { agreed: 1, answered: 1, corrections: 1, calls: 2 },
    });
    assert.deepEqual(c.figures, {
      informed: { knowledge: 0, signals_explained: 1, signals_formed: 1, starts_given: 0, starts: 0 },
      autonomous: { trusted_calls: 1, ladder_calls: 1, questions: 0, merged: 0 },
      trusted: { agreed: 0, answered: 0, corrections: 0, calls: 1 },
    });
    // refs: the corrections, accepted knowledge and explained signals counted
    assert.ok(a.refs.includes(X.k1) && a.refs.includes(X.o1), JSON.stringify(a.refs));
    assert.ok(b.refs.includes(X.d1), 'the correction counted');
    assert.ok(!c.refs.includes(X.k1), 'retired by then');

    // a second pass writes none
    ok(old, ['observe-metrics'], SUP);
    assert.equal(learnings(F).length, 3);

    // the dashboard reads them, oldest first
    const D = json(ok(old, ['dashboard-data']));
    assert.deepEqual(D.ooda.learning.map((r) => r.week), X.weeks);
    assert.deepEqual(D.ooda.learning[1].figures, b.figures);
    assert.ok(D.ooda.learning.every((r) => r.id && r.at && r.detail));
    assert.equal(learnings(F).length, 3);
  } finally { F.done(); }
});
