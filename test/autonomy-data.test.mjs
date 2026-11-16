// The Trust Score's data (kit-98): /api/data's autonomy, from hand-written fixture logs with known
// answers. decisions: each of the last 12 calendar weeks, its counts from the weekly learning record
// (stored, else computed) and the rest counted from the log on read; trust: the kinds it decides
// alone and this week's rung moves; senses: what it needs, has and sees working.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fleetFixture, json, line, dashboardOnFreePort } from './lib/kit.mjs';

const DAY = 86400000;
const HOUR = 3600000;
const WEEK = 7 * DAY;
const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
const mondayOf = (ms) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY; };
const isoWeek = (ms) => {
  const m = mondayOf(ms);
  const y = new Date(m + 3 * DAY).getUTCFullYear();
  return `${y}-W${String(1 + Math.round((m - mondayOf(Date.UTC(y, 0, 4))) / WEEK)).padStart(2, '0')}`;
};
// The fixture's clock: M is this Monday 00:00 UTC, week k of the 12 starts at W(k), and h(k, d, hh)
// is d days and hh hours into it. This week's lines sit at M + span × f, so they are in the past and
// inside this week however soon after Monday 00:00 the test runs; under 10 minutes in, the tests
// that need them skip.
const M = mondayOf(Date.now());
const span = () => Date.now() - M;
const W = (k) => M - (11 - k) * WEEK;
const h = (k, d, hh) => W(k) + d * DAY + hh * HOUR;
const TOO_SOON = 'within 10 minutes of Monday 00:00 UTC this week has no room for its lines';
const tooSoon = () => span() < 10 * 60000;

// A line as the kit would have written it at ms, in its writer's file; each id a millisecond apart.
function handFor(F) {
  const logDir = path.join(F.old, 'docs/devteam/run/log');
  let n = 0;
  return (by, o, ms) => {
    const d = new Date(ms + (n++ % 1000));
    const id = o.id ?? `${{ observation: 'o', decision: 'd', act: 'a', knowledge: 'k', question: 'q', goal: 'g', thread: 't', turn: 'u' }[o.type]}-${stamp(d)}-${by}`;
    const file = ['owner', 'supervisor'].includes(by) ? `${by}-${d.toISOString().slice(0, 7)}.jsonl` : `${by}.jsonl`;
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, file), line({ op: 'new', ...(by === 'owner' ? { channel: 'cli' } : {}), ...o, id, at: d.toISOString(), by }));
    return id;
  };
}
const autonomy = (F, env = {}) => json(F.ok(F.old, ['dashboard-data'], env)).autonomy;
// hours_waiting moves with the clock while a question is open
const timeless = (weeks) => weeks.map(({ hours_waiting, ...w }) => w);
const floor10 = (x) => Math.floor(x * 10) / 10;
const ceil10 = (x) => Math.ceil(x * 10) / 10;
const PRIO = 'Should we raise the importer rewrite above the billing export work';
const MAILER = 'Should the mailer retry failed sends every hour now';

// The main fixture: the log's first line is in week 6, a stored record for week 7, the owner's
// decisions of every kind in week 8, a correction in week 9, a question left open from week 10.
function decisionsFixture(F) {
  const hand = handFor(F);
  const rung = (what, ms) => hand('supervisor', { type: 'decision', class: 'priority-change', what, authority: 'rung', rung: 3 }, ms);
  const X = {};
  X.d6 = rung('raised the importer', h(6, 1, 9));
  X.goal = hand('supervisor', { type: 'goal', title: 'Faster imports', status: 'draft' }, h(6, 2, 9));
  // week 6 is 2 alone of 3 decisions: 66.7 reads 67
  X.d6b = rung('raised the importer again', h(6, 3, 9));
  X.pref6 = hand('owner', { type: 'knowledge', kind: 'preference', statement: 'Prefer importers that resume', scope: 'project', status: 'accepted' }, h(6, 3, 10));
  X.d7 = rung('raised the exporter', h(7, 1, 9));
  // week 8
  X.d1 = rung('lowered the docs', h(8, 1, 9));
  X.q1 = hand('supervisor', { type: 'question', kind: 'owner-decision', class: 'priority-change', question: 'Ship the cache now?', recommendation: 'Yes', options: ['Yes', 'No'] }, h(8, 1, 10));
  X.q2 = hand('supervisor', { type: 'question', kind: 'owner-decision', class: 'priority-change', question: 'Move the nightly job to Sunday?', options: ['Yes', 'No'], default: 'Yes' }, h(8, 1, 11));
  X.P = hand('supervisor', { type: 'question', kind: 'owner-decision', class: 'priority-change', question: PRIO, options: ['Yes', 'No'], links: [{ artifact: 'gone-page', at: 'main', sha256: 'ab'.repeat(32) }] }, h(8, 1, 12));
  hand('supervisor', { type: 'question', op: 'set', id: X.P, status: 'withdrawn' }, h(8, 1, 12.5));
  X.Q = hand('supervisor', { type: 'question', kind: 'owner-decision', class: 'priority-change', question: PRIO.replace('importer', 'uploader'), options: ['Yes', 'No'], new_because: 'the page it linked changed' }, h(8, 1, 13));
  hand('owner', { type: 'question', op: 'set', id: X.q1, answer: 'Yes' }, h(8, 1, 13));
  hand('supervisor', { type: 'question', op: 'set', id: X.Q, status: 'withdrawn' }, h(8, 1, 13.2));
  X.a1 = hand('supervisor', { type: 'act', class: 'priority-change', what: 'shipped the cache', approved_by: X.q1 }, h(8, 1, 13.5));
  X.q3 = hand('supervisor', { type: 'question', kind: 'owner-decision', class: 'other-class', question: 'Should the nightly backup move to the eastern region now', options: ['Yes', 'No'], new_because: 'the region went down again' }, h(8, 1, 14));
  hand('supervisor', { type: 'question', op: 'set', id: X.q3, status: 'withdrawn' }, h(8, 1, 14.2));
  hand('supervisor', { type: 'question', op: 'set', id: X.q2, status: 'defaulted' }, h(8, 1, 16));
  X.a2 = hand('supervisor', { type: 'act', class: 'priority-change', what: 'moved the nightly job', approved_by: X.q2 }, h(8, 1, 16.5));
  hand('owner', { type: 'goal', op: 'set', id: X.goal, hold: { mode: 'drain', reason: 'a pause' } }, h(8, 2, 0));
  hand('owner', { type: 'goal', op: 'set', id: X.goal, decision: { verdict: 'approve' } }, h(8, 2, 1));
  X.pref = hand('owner', { type: 'knowledge', kind: 'preference', statement: 'Prefer small PRs', scope: 'project', status: 'accepted' }, h(8, 2, 2));
  X.rule = hand('owner', { type: 'knowledge', kind: 'lesson', statement: 'Raise the importer first', scope: 'class:priority-change', status: 'accepted' }, h(8, 2, 3));
  X.fact = hand('owner', { type: 'knowledge', kind: 'fact', statement: 'The importer runs nightly', scope: 'project', status: 'accepted' }, h(8, 2, 4));
  // the supervisor's own goal hold and class rule are no owner decisions
  X.goal2 = hand('supervisor', { type: 'goal', title: 'Fewer retries', status: 'draft' }, h(8, 2, 4.5));
  hand('supervisor', { type: 'goal', op: 'set', id: X.goal2, hold: { mode: 'drain', reason: 'its own pause' } }, h(8, 2, 5));
  hand('supervisor', { type: 'knowledge', kind: 'lesson', statement: 'Raise the uploader with the importer', scope: 'class:priority-change', status: 'accepted' }, h(8, 2, 6));
  X.d2 = rung('raised the uploader', h(8, 3, 9));
  X.d3 = rung('raised the mailer', h(8, 3, 10));
  hand('owner', { type: 'decision', op: 'set', id: X.d3, corrected: { reason: 'not the mailer' } }, h(8, 3, 11));
  X.t = hand('owner', { type: 'thread', title: 'About imports', status: 'open' }, h(8, 4, 9));
  hand('owner', { type: 'turn', thread: X.t, text: 'How are imports going?' }, h(8, 4, 9.1));
  // week 7's stored record, written in week 8: its figures differ from what a recompute gives
  X.rec = hand('supervisor', { type: 'observation', source: 'metrics', detector: 'metrics', subject: 'project', kind: 'learning', week: isoWeek(W(7)), source_key: `learning:${isoWeek(W(7))}`, detail: 'week 7',
    figures: { informed: {}, autonomous: { merged: 4 }, trusted: { calls: 5, corrections: 1, agreed: 2, answered: 3 } } }, h(8, 5, 9));
  // week 9: d2 corrected; the class rule retired
  hand('owner', { type: 'decision', op: 'set', id: X.d2, corrected: { reason: 'not the uploader' } }, h(9, 1, 0));
  hand('owner', { type: 'knowledge', op: 'set', id: X.rule, status: 'retired' }, h(9, 1, 1));
  // the owner parks Upkeep: a hold on the built-in goal is a decision like any goal's
  X.upkeep = hand('owner', { type: 'goal', kind: 'upkeep', title: 'Upkeep' }, h(9, 2, 0));
  hand('owner', { type: 'goal', op: 'set', id: X.upkeep, hold: { mode: 'park', reason: 'a quiet week' } }, h(9, 2, 0.1));
  // two declared re-asks after a withdrawn question whose linked page moved, each failing one of
  // the exclusion's conditions, so both count: another class, and asked before it was withdrawn
  X.P9 = hand('supervisor', { type: 'question', kind: 'owner-decision', class: 'priority-change', question: MAILER, options: ['Yes', 'No'], links: [{ artifact: 'gone-page', at: 'main', sha256: 'cd'.repeat(32) }] }, h(9, 2, 10));
  X.Q9b = hand('supervisor', { type: 'question', kind: 'owner-decision', class: 'priority-change', question: MAILER.replace('hour', 'day'), options: ['Yes', 'No'], new_because: 'the page it linked changed' }, h(9, 2, 11));
  hand('supervisor', { type: 'question', op: 'set', id: X.Q9b, status: 'withdrawn' }, h(9, 2, 11.5));
  hand('supervisor', { type: 'question', op: 'set', id: X.P9, status: 'withdrawn' }, h(9, 2, 12));
  X.Q9a = hand('supervisor', { type: 'question', kind: 'owner-decision', class: 'other-class', question: MAILER.replace('hour', 'day'), options: ['Yes', 'No'], new_because: 'the page it linked changed' }, h(9, 2, 13));
  hand('supervisor', { type: 'question', op: 'set', id: X.Q9a, status: 'withdrawn' }, h(9, 2, 13.5));
  // week 10: q5 asked two hours before this Monday and left open
  X.q5 = hand('supervisor', { type: 'question', kind: 'owner-decision', class: 'priority-change', question: 'Archive the old exports?', options: ['Yes', 'No'] }, W(11) - 2 * HOUR);
  return { hand, rung, X };
}
const ZERO = { record: null, alone: 0, asked: 0, corrected: 0, decisions: 0, score: 0, lessons: [], merged: 0, answers: 0, merged_per_answer: 0, asked_again: 0, hours_waiting: 0, with_recommendation: { count: 0, of: 0, share: 0 } };

test('twelve weeks, oldest first, ending this Monday', () => {
  const F = fleetFixture('autonomy-weeks');
  try {
    decisionsFixture(F);
    const { weeks } = autonomy(F).decisions;
    assert.equal(weeks.length, 12);
    assert.equal(weeks[11].starts_at, new Date(M).toISOString());
    for (let i = 1; i < 12; i++) assert.equal(Date.parse(weeks[i].starts_at) - Date.parse(weeks[i - 1].starts_at), WEEK, `week ${i}`);
  } finally { F.done(); }
});

test("each week's decisions from the record and the log", (t) => {
  if (tooSoon()) return t.skip(TOO_SOON);
  const F = fleetFixture('autonomy-decisions');
  try {
    const { rung, X } = decisionsFixture(F);
    // this week, from what the fixture's own init wrote: the baseline d4 adds to
    const base = autonomy(F).decisions.weeks[11];
    X.d4 = rung('raised the billing export', M + span() * 0.5);
    const tBefore = Date.now();
    const A = autonomy(F);
    const tAfter = Date.now();
    const { weeks } = A.decisions;
    for (let k = 0; k <= 5; k++) assert.deepEqual({ ...weeks[k], starts_at: undefined }, { ...ZERO, starts_at: undefined }, `week ${k}`);
    const row = (k, want) => { for (const [f, v] of Object.entries(want)) assert.deepEqual(weeks[k][f], v, `week ${k} ${f}`); };
    row(6, { record: null, alone: 2, asked: 1, corrected: 0, decisions: 3, score: 67, answers: 0, asked_again: 0, hours_waiting: 0 });
    row(7, { record: X.rec, alone: 1, asked: 0, corrected: 1, decisions: 2, score: 50, merged: 4, answers: 0, merged_per_answer: 4, with_recommendation: { count: 2, of: 3, share: 0.67 }, lessons: [] });
    row(8, { record: null, alone: 2, asked: 6, corrected: 1, decisions: 9, score: 22, answers: 1, merged: 0, merged_per_answer: 0, with_recommendation: { count: 1, of: 1, share: 1 }, asked_again: 1, hours_waiting: 6, lessons: [] });
    row(9, { record: null, alone: 0, asked: 1, corrected: 1, decisions: 2, score: 0, asked_again: 2, hours_waiting: 2.5 });
    row(10, { record: null, alone: 0, asked: 0, corrected: 0, decisions: 0, score: 0, hours_waiting: 2 });
    row(11, { record: null, alone: base.alone + 1, asked: base.asked, corrected: base.corrected });
    assert.equal(weeks[11].score, Math.round((100 * weeks[11].alone) / weeks[11].decisions));
    const hw = weeks[11].hours_waiting;
    assert.ok(floor10((tBefore - M) / HOUR) <= hw && hw <= ceil10((tAfter - M) / HOUR), `this week's hours waiting ${hw}`);
    assert.ok(weeks[11].lessons.includes(X.pref) && weeks[11].lessons.includes(X.fact) && !weeks[11].lessons.includes(X.rule), JSON.stringify(weeks[11].lessons));
    assert.deepEqual(A.decisions.score, { this_week: weeks[11].score, last_week: 0 });
    assert.deepEqual(A.decisions.this_week, weeks[11]);
    assert.deepEqual(A.decisions.last_week, weeks[10]);
    if (base.decisions === 0) assert.equal(weeks[11].score, 100, 'd4 alone this week');
  } finally { F.done(); }
});

test('a stored record wins over a recompute; a week with no decisions reads 0', () => {
  const F = fleetFixture('autonomy-record');
  try {
    const { X } = decisionsFixture(F);
    const { weeks } = autonomy(F).decisions;
    // the log alone gives week 7 no corrections and no merges; the record says 1 and 4
    assert.equal(weeks[7].record, X.rec);
    assert.deepEqual([weeks[7].corrected, weeks[7].merged], [1, 4]);
    for (const k of [0, 1, 2, 3, 4, 5, 10]) {
      assert.equal(weeks[k].score, 0, `week ${k}`);
      for (const [f, v] of Object.entries({ ...weeks[k], ...Object.fromEntries(Object.entries(weeks[k].with_recommendation).map(([g, n]) => [`with_recommendation.${g}`, n])) })) if (!['starts_at', 'record', 'lessons', 'with_recommendation'].includes(f)) assert.equal(typeof v, 'number', `week ${k} ${f}`);
    }
    // a rule retired later still counts in the week it was made
    assert.equal(weeks[8].asked, 6);
  } finally { F.done(); }
});

test('a stored record missing a figure reads 0; a question open since before the 12 weeks counts from each week', () => {
  const F = fleetFixture('autonomy-missing');
  try {
    const hand = handFor(F);
    hand('supervisor', { type: 'question', kind: 'owner-decision', class: 'priority-change', question: 'Keep the old importer?', options: ['Yes', 'No'] }, W(0) - DAY);
    const rec = hand('supervisor', { type: 'observation', source: 'metrics', detector: 'metrics', subject: 'project', kind: 'learning', week: isoWeek(W(7)), source_key: `learning:${isoWeek(W(7))}`, detail: 'week 7',
      figures: { informed: {}, autonomous: {}, trusted: { answered: 2, corrections: 0 } } }, h(8, 0, 1));
    const { weeks } = autonomy(F).decisions;
    assert.equal(weeks[7].record, rec);
    assert.deepEqual(weeks[7].with_recommendation, { count: 0, of: 2, share: 0 });
    assert.equal(weeks[7].merged, 0);
    for (let k = 0; k <= 10; k++) assert.equal(weeks[k].hours_waiting, 168, `week ${k}`);
  } finally { F.done(); }
});

test("the operator's words count nowhere", () => {
  const F = fleetFixture('autonomy-operator');
  try {
    decisionsFixture(F);
    // HISTFILE: no shell the operator's commands start saves a history into the fixture's home as it goes
    const HOME = { HOME: F.home, HISTFILE: '' };
    fs.mkdirSync(F.home, { recursive: true });
    const lines = () => json(F.ok(F.old, ['log', '--tail', '100000', '--json'], HOME)).length;
    const n = lines();
    const before = autonomy(F, HOME).decisions.weeks;
    F.run(F.old, ['operator-thread', 'new', 'the importer looks slow tonight'], HOME);
    // no supervisor pane to type into: it writes no line and exits 1 or 3
    const env = { ...F.env(HOME) };
    delete env.DEVTEAM_ROLE;
    const told = spawnSync(process.execPath, [path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), 'machine', 'tell', '--in', F.base, '--', path.basename(F.old), 'raise the importer'], { cwd: F.old, env, encoding: 'utf8' });
    assert.ok([1, 3].includes(told.status), `machine tell: ${told.status} ${told.stderr}`);
    assert.equal(lines(), n, 'no line in the project log');
    assert.deepEqual(timeless(autonomy(F, HOME).decisions.weeks), timeless(before));
  } finally { F.done(); }
});

test('the server sees new lines', async (t) => {
  if (tooSoon()) return t.skip(TOO_SOON);
  const F = fleetFixture('autonomy-server');
  let dash = null;
  try {
    const { rung } = decisionsFixture(F);
    const D = await dashboardOnFreePort(F.old, F.env());
    dash = D.dash;
    const get = async () => (await (await fetch(`http://127.0.0.1:${D.port}/api/data`)).json()).autonomy;
    const first = await get();
    const cli = autonomy(F);
    assert.deepEqual(timeless(first.decisions.weeks), timeless(cli.decisions.weeks));
    rung('raised the payments retry', M + span() * 0.6);
    const second = await get();
    assert.equal(second.decisions.weeks[11].alone, first.decisions.weeks[11].alone + 1);
  } finally { await dash?.stop(); F.done(); }
});

test("trust: kinds on its own, and this week's moves", (t) => {
  if (tooSoon()) return t.skip(TOO_SOON);
  const F = fleetFixture('autonomy-trust');
  try {
    const hand = handFor(F);
    const rows = json(F.ok(F.old, ['trust', '--json']));
    const X = rows.find((r) => r.class !== 'incident-fix' && r.start < 3 && r.ceiling >= 3);
    const Y = rows.find((r) => r.class !== 'incident-fix' && r.class !== X?.class && r.start < 2 && r.ceiling >= 2);
    assert.ok(X && Y, `the ladder needs a class that can rise to 3 and another that can rise to 2: ${JSON.stringify(rows.map((r) => [r.class, r.start, r.ceiling]))}`);
    const trustAnswer = (cls, rung, ms) => {
      const q = hand('supervisor', { type: 'question', kind: 'trust', class: cls, question: `May I decide ${cls} at rung ${rung}?`, recommendation: 'Yes', options: ['Yes', 'No'] }, ms);
      hand('owner', { type: 'question', op: 'set', id: q, answer: 'Yes', autonomy: { class: cls, rung } }, ms + 60000);
      return q;
    };
    // an earlier week's move: not counted this week
    trustAnswer(Y.class, 2, h(9, 1, 9));
    // Y's drop comes before X's raise, against the ladder's order, so the changes are sorted by time
    const dY = hand('supervisor', { type: 'decision', class: Y.class, what: `went ahead on ${Y.class}`, authority: 'rung', rung: 2 }, M + span() * 0.2);
    hand('owner', { type: 'decision', op: 'set', id: dY, corrected: { reason: 'too soon' } }, M + span() * 0.25);
    const qX = trustAnswer(X.class, 3, M + span() * 0.3);
    // an answer that leaves Y's rung where it was is no move
    trustAnswer(Y.class, 1, M + span() * 0.4);
    const T = autonomy(F).trust;
    assert.equal(T.raised, 1);
    assert.equal(T.dropped, 1);
    assert.deepEqual(T.changes.map(({ at, ...c }) => c), [{ class: Y.class, from: 2, to: 1, id: dY }, { class: X.class, from: X.start, to: 3, id: qX }]);
    assert.ok(T.changes.every((c) => Date.parse(c.at) >= M), JSON.stringify(T.changes));
    assert.ok(T.changes[0].at < T.changes[1].at, 'oldest first');
    const now = json(F.ok(F.old, ['trust', '--json']));
    assert.equal(T.kinds, now.length);
    assert.equal(T.own, now.filter((r) => r.rung === 3).length);
    assert.ok(T.own >= 1, 'X is at 3 now');
  } finally { F.done(); }
});

test('trust: each step capped as rungFor caps it', (t) => {
  if (tooSoon()) return t.skip(TOO_SOON);
  const F = fleetFixture('autonomy-trust-caps');
  try {
    const hand = handFor(F);
    // merging releases (incident-fix waits on release-production), and new-feature's ceiling lowered
    // below its start
    const sf = path.join(F.old, 'docs/devteam/project/settings.md');
    const text = fs.readFileSync(sf, 'utf8');
    const m = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text);
    fs.writeFileSync(sf, text.replace(m[1], JSON.stringify({ ...JSON.parse(m[1]), release: 'merge', autonomy_ceilings: { 'new-feature': 1 } }, null, 2)));
    F.g(['add', '-A'], F.old);
    F.g(['commit', '-qm', 'release on merge; new-feature at most 1'], F.old);
    F.g(['push', '-q', 'origin', 'main'], F.old);
    const rows = Object.fromEntries(json(F.ok(F.old, ['trust', '--json'])).map((r) => [r.class, r]));
    assert.deepEqual([rows['incident-fix'].start, rows['release-production'].rung, rows['new-feature'].rung, rows['production-remediation'].ceiling], [2, 1, 1, 2], 'the constitution this test was written against');
    const trustAnswer = (cls, rung, ms) => {
      const q = hand('supervisor', { type: 'question', kind: 'trust', class: cls, question: `May I decide ${cls} at rung ${rung}?`, recommendation: 'Yes', options: ['Yes', 'No'] }, ms);
      hand('owner', { type: 'question', op: 'set', id: q, answer: 'Yes', autonomy: { class: cls, rung } }, ms + 60000);
      return q;
    };
    const qFix = trustAnswer('incident-fix', 3, M + span() * 0.2);
    trustAnswer('new-feature', 1, M + span() * 0.3);
    const qRem = trustAnswer('production-remediation', 3, M + span() * 0.4);
    let T = autonomy(F).trust;
    // incident-fix held at 2 while release-production is 1; new-feature starts at its ceiling, 1;
    // production-remediation's 3 is its ceiling, 2
    assert.deepEqual(T.changes.map(({ at, ...c }) => c), [{ class: 'production-remediation', from: 1, to: 2, id: qRem }]);
    // release-production to 3: incident-fix's answer now takes it to 3, the cap as it is now
    const qRel = trustAnswer('release-production', 3, M + span() * 0.5);
    T = autonomy(F).trust;
    assert.deepEqual(T.changes.map(({ at, ...c }) => c), [{ class: 'incident-fix', from: 2, to: 3, id: qFix }, { class: 'production-remediation', from: 1, to: 2, id: qRem }, { class: 'release-production', from: 1, to: 3, id: qRel }]);
    const now = json(F.ok(F.old, ['trust', '--json']));
    assert.equal(T.own, now.filter((r) => r.rung === 3).length);
  } finally { F.done(); }
});

// Sensors in place, committed and pushed (main's settings apply), with their state files.
function sensorsFixture(F, sensors, states) {
  const sf = path.join(F.old, 'docs/devteam/project/settings.md');
  const text = fs.readFileSync(sf, 'utf8');
  const m = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text);
  const j = JSON.parse(m[1]);
  j.sensors = sensors;
  fs.writeFileSync(sf, text.replace(m[1], JSON.stringify(j, null, 2)));
  for (const [name, state] of Object.entries(states)) {
    const dir = path.join(F.old, 'docs/devteam/run/sensors', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ state, fails: 0 }));
  }
}
const cacheFile = (F) => path.join(F.old, 'docs/devteam/run/sensor-discovery.json');

test('senses: needed, has, working and the missing named', () => {
  const F = fleetFixture('autonomy-senses');
  try {
    const hand = handFor(F);
    sensorsFixture(F, {
      web: { kind: 'http', url: 'https://app.example.test/up' },
      tok: { kind: 'probe', probe: 'project/sensors/tok.mjs', credentials: { TOK: 'file:tok' } },
      fake: { kind: 'probe', probe: 'project/sensors/fake.mjs', credentials: { FAKE: 'file:fake' } },
      post: { kind: 'probe', probe: 'project/sensors/post.mjs', credentials: { POST: 'file:post' } },
    }, { web: 'up', tok: 'ok', fake: 'failing', post: 'failing' });
    fs.writeFileSync(path.join(F.old, 'package.json'), JSON.stringify({ name: 'app', dependencies: { '@sentry/node': '1' } }));
    F.g(['add', '-A'], F.old);
    F.g(['commit', '-qm', 'sensors and a sentry dependency'], F.old);
    F.g(['push', '-q', 'origin', 'main'], F.old);
    // post's credential, posted by the owner through its question
    const q = hand('supervisor', { type: 'question', kind: 'owner-action', question: 'Post the token post reads?', sensor: 'post', secrets: [{ name: 'POST', sink: 'file:post' }] }, Date.now() - 2 * HOUR);
    hand('owner', { type: 'question', op: 'set', id: q, secrets_posted: [{ name: 'POST' }] }, Date.now() - HOUR);
    F.ok(F.old, ['sensor', 'discover', '--json']);
    const cache = json(fs.readFileSync(cacheFile(F), 'utf8'));
    assert.ok(cache.missing.includes('sentry') && cache.proposals.includes('sentry'), JSON.stringify(cache));
    assert.deepEqual(cache.outside, []);
    assert.deepEqual([...cache.sensors].sort(), ['fake', 'post', 'tok', 'web']);
    fs.writeFileSync(cacheFile(F), JSON.stringify({ ...cache, outside: ['page-views'] }));
    const S = autonomy(F).senses;
    assert.deepEqual(S.names, { needed: ['fake', 'page-views', 'post', 'sentry', 'tok', 'web'], has: ['post', 'tok', 'web'], working: ['tok', 'web'] });
    assert.deepEqual(S.missing, ['fake', 'page-views', 'sentry']);
    assert.deepEqual([S.needed, S.has, S.working], [6, 3, 2]);
    assert.ok(S.needed >= S.has);
    assert.equal(S.discovered_at, cache.at);
  } finally { F.done(); }
});

test('senses with no discovery, or a malformed one', () => {
  const F = fleetFixture('autonomy-senses-none');
  try {
    sensorsFixture(F, { web: { kind: 'http', url: 'https://app.example.test/up' }, tok: { kind: 'probe', probe: 'project/sensors/tok.mjs', credentials: { TOK: 'file:tok' } } }, { web: 'down', tok: 'ok' });
    F.g(['add', '-A'], F.old);
    F.g(['commit', '-qm', 'sensors'], F.old);
    F.g(['push', '-q', 'origin', 'main'], F.old);
    const want = { needed: 2, has: 2, working: 1, missing: [], names: { needed: ['tok', 'web'], has: ['tok', 'web'], working: ['tok'] }, discovered_at: null };
    assert.deepEqual(autonomy(F).senses, want);
    fs.mkdirSync(path.dirname(cacheFile(F)), { recursive: true });
    const good = { at: '2026-01-01T00:00:00.000Z', sensors: [], proposals: ['sentry'], missing: [], outside: [] };
    const { at, ...noAt } = good;
    const { sensors, ...noSensors } = good;
    for (const bad of ['not json', JSON.stringify([1, 2]), JSON.stringify({ ...good, proposals: 'sentry' }), JSON.stringify({ ...good, proposals: ['sentry', 7] }), JSON.stringify(noAt), JSON.stringify(noSensors)]) {
      fs.writeFileSync(cacheFile(F), bad);
      assert.deepEqual(autonomy(F).senses, want, bad);
    }
    // the well-formed one is read: the check above is of the shape, not of every cache
    fs.writeFileSync(cacheFile(F), JSON.stringify(good));
    assert.deepEqual(autonomy(F).senses.names.needed, ['sentry', 'tok', 'web']);
    // every discover writes it: text, and --record as the supervisor; a refused --record writes nothing
    const fresh = (when) => { const c = json(fs.readFileSync(cacheFile(F), 'utf8')); assert.ok(c.at > when, `${c.at} after ${when}`); assert.deepEqual([...c.sensors].sort(), ['tok', 'web']); };
    fs.rmSync(cacheFile(F));
    let t0 = new Date().toISOString();
    F.ok(F.old, ['sensor', 'discover']);
    fresh(t0);
    fs.rmSync(cacheFile(F));
    assert.notEqual(F.run(F.old, ['sensor', 'discover', '--record'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'kit-x' }).status, 0);
    assert.equal(fs.existsSync(cacheFile(F)), false, 'a refused --record writes no cache');
    t0 = new Date().toISOString();
    F.ok(F.old, ['sensor', 'discover', '--record'], { DEVTEAM_ROLE: 'supervisor' });
    fresh(t0);
    // a cache it can't write never fails discover
    fs.rmSync(cacheFile(F));
    fs.mkdirSync(cacheFile(F));
    F.ok(F.old, ['sensor', 'discover', '--json']);
    assert.ok(fs.statSync(cacheFile(F)).isDirectory());
  } finally { F.done(); }
});
