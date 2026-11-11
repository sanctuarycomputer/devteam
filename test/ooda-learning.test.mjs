// The weekly learning record and the chart (the OODA spec, PR 5): observe-metrics writes one
// observation per ended ISO week with the week's figures, back-filled from the log as it stood at
// each week's end; the dashboard reads them and never writes one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fleetFixture, json, line, kit } from './lib/kit.mjs';

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

test("a learning record's peek lists what it counted and what each lesson given did; the Loop gets totals and marks", () => {
  const F = fleetFixture('ooda-learning-peek');
  const { old, ok } = F;
  try {
    const X = threeWeeks(F);
    // a young instance: no records yet, so the Loop shows totals since the log began
    let D = json(ok(old, ['dashboard-data']));
    assert.deepEqual(D.ooda.learning, []);
    assert.equal(D.ooda.learning_totals.since, new Date(X.A + HOUR).toISOString(), 'since the earliest line');
    assert.equal(D.ooda.learning_totals.lessons, 0, 'the one lesson was retired');
    assert.equal(D.ooda.learning_totals.corrections, 1);
    assert.ok(D.ooda.learning_totals.calls >= 6, JSON.stringify(D.ooda.learning_totals));
    // the correction moved priority-change's rung: a mark, linking the corrected call
    assert.ok(D.ooda.learning_marks.some((m) => m.kind === 'rung' && m.label === 'priority-change to rung 1' && m.href === `#decision/${encodeURIComponent(X.d1)}`), JSON.stringify(D.ooda.learning_marks));

    ok(old, ['observe-metrics'], SUP);
    D = json(ok(old, ['dashboard-data']));
    const [a, b] = D.ooda.learning;
    const pa = json(ok(old, ['peek', 'learning', a.id, '--json']));
    const pb = json(ok(old, ['peek', 'learning', b.id, '--json']));
    assert.equal(pb.learning.week, X.weeks[1]);
    assert.deepEqual(pb.learning.figures, b.figures, 'the peek recomputes what the record stored');
    assert.deepEqual(pb.learning.lists.corrections, [X.d1]);
    assert.deepEqual(pb.learning.lists.questions, [X.q1], 'an owner-action is not a decision put to the owner');
    assert.deepEqual(pb.learning.lists.answered, [{ id: X.q1, matched: true }]);
    assert.deepEqual(pb.learning.lists.starts, [{ id: X.a2, given: [] }], 'a resume is not a start');
    assert.deepEqual(pb.learning.lists.calls, [X.a2, X.a3]);
    assert.deepEqual(pa.learning.lists.ladder_calls.map((c) => [c.id, c.authority]), [[X.d1, 'rung'], [X.d2, 'default']]);
    assert.deepEqual(pa.learning.lists.signals.map((s) => [s.key, s.explained, s.by]), [['note:app', true, [X.o1]]]);
    // efficacy: the lesson given in week A, against the observations on its evidence's key
    const ea = pa.learning.efficacy.find((e) => e.id === X.k1);
    assert.deepEqual([ea.keys, ea.before, ea.since], [['note:app'], { count: 3, ids: [X.o1, X.o2, X.o3] }, { count: 0, ids: [] }]);
    const eb = pb.learning.efficacy.find((e) => e.id === X.k1);
    assert.equal(eb.first_given, new Date(X.A + 4 * DAY).toISOString());
    assert.deepEqual(eb.since, { count: 1, ids: [X.o4] }, 'it recurred once after the lesson was given');
    // the learning records stay off the Observe feed and out of Orient's signals
    assert.ok(!D.ooda.observations.some((o) => o.kind === 'learning'));
    assert.ok(!D.ooda.clusters.some((c) => c.key.startsWith('learning:')));
  } finally { F.done(); }
});

// The chart's own code, loaded by itself (CI has no Chrome): under three records, tiles; then six
// small charts, a hollow point where its denominator is under five, every point opening its week.
test('the Loop draws tiles for a young instance, then six charts with hollow points and marks', () => {
  const html = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');
  const src = html.slice(html.indexOf('/* learning start */'), html.indexOf('/* learning end */'));
  assert.ok(src.length > 1000, 'the learning block is marked in index.html');
  const ctx = vm.createContext({});
  vm.runInContext(`const DAY = 864e5; const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); const fmtDate = (ms) => new Date(ms).toISOString().slice(0, 10);\n${src}\n;globalThis.api = { learningSection, lineChart };`, ctx);
  const { learningSection, lineChart } = ctx.api;
  const figs = (n) => ({ informed: { knowledge: 2, signals_explained: 1, signals_formed: n, starts_given: 3, starts: 6 }, autonomous: { trusted_calls: 4, ladder_calls: 8, questions: 6, merged: 4 }, trusted: { agreed: 9, answered: 10, corrections: 1, calls: 50 } });
  const rec = (i, n) => ({ id: `o-2026110${i}-000000000-supervisor`, week: `2026-W4${i}`, from: new Date(Date.UTC(2026, 9, 5 + 7 * i)).toISOString(), at: '2026-11-11T00:00:00.000Z', figures: figs(n), detail: 'x' });
  const totals = { since: '2026-10-20T01:00:00.000Z', calls: 7, lessons: 1, corrections: 2 };

  for (const learning of [[], [rec(1, 6)], [rec(1, 6), rec(2, 6)]]) {
    const h = learningSection({ learning, learning_totals: totals, learning_marks: [] });
    assert.match(h, /data-learn="young"/);
    assert.match(h, /Since 2026-10-20: 7 calls, 1 lesson kept, 2 corrections\. The loop needs a few weeks of calls, answers and lessons before trends mean anything\./);
    assert.doesNotMatch(h, /<svg/);
  }
  const recs = [rec(1, 6), rec(2, 2), rec(3, 6)];
  const h = learningSection({ learning: recs, learning_totals: totals, learning_marks: [{ at: recs[1].from, label: 'priority-change to rung 1', href: '#decision/d-x' }, { at: '2020-01-01T00:00:00.000Z', label: 'long ago', href: '#retro/o-y' }] });
  assert.match(h, /data-learn="charts"/);
  assert.equal((h.match(/<svg/g) || []).length, 6, 'six small charts');
  for (const col of ['Informed', 'Autonomous', 'Trusted']) assert.match(h, new RegExp(`<h3>${col}</h3>`));
  // one hollow point: week 2's signals explained, formed only twice
  assert.equal((h.match(/data-hollow/g) || []).length, 1);
  assert.match(h, /signals explained, week 2026-W42: too few to say \(n = 2\)/);
  for (const r of recs) assert.ok(h.includes(`href="#learning/${encodeURIComponent(r.id)}"`), 'each point opens its week');
  // the rung change marks every chart; one outside the span marks none
  assert.equal((h.match(/href="#decision\/d-x"/g) || []).length, 6);
  assert.doesNotMatch(h, /#retro\/o-y/);
  // lineChart's old callers are unchanged: a plain [ts, v] point is a filled dot with its own title
  const plain = lineChart([{ name: 'p50', points: [[Date.UTC(2026, 0, 1), 3], [Date.UTC(2026, 0, 3), 4]] }], { unit: 'ms' });
  assert.match(plain, /<circle [^>]*fill="var\(--series-1, var\(--blue\)\)"><title>p50: 3ms/);
  assert.doesNotMatch(plain, /<a |data-hollow|xmark/);
});
