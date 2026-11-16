// The Efficiency Score's data (kit-173): /api/data's `efficiency`, derived on read from the log,
// the review records and the git facts, over kit-98's 12 calendar weeks (Monday 00:00 UTC), oldest
// first, ending with this week. Fixtures write phase, spend and observation lines by hand at chosen
// times and date each ticket's merge commit into the week a case needs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { fleetFixture, dashboardOnFreePort, json, line, write } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const HOUR = 3600000, DAY = 24 * HOUR, WEEK = 7 * DAY;
const mondayOf = (ms) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY; };
const stamp = (ms) => { const s = new Date(ms).toISOString(); return `${s.slice(0, 10).replace(/-/g, '')}-${s.slice(11, 23).replace(/[:.]/g, '')}`; };

// A project with helpers that put each event at a time the case picks. Week k is 0 (oldest) to 11
// (this week); ticket i's merge in week k is mergeAt(k, i): a Thursday hour in an earlier week, and
// for this week a whole second between Monday 00:00 and now, so nothing lands in the future.
function effFixture(name) {
  const F = fleetFixture(name);
  const { old, ok, g } = F;
  const thisMonday = mondayOf(Date.now());
  const span = Date.now() - thisMonday;
  const weekStart = (k) => thisMonday - (11 - k) * WEEK;
  const mergeAt = (k, i) => (k < 11 ? weekStart(k) + 3 * DAY + i * HOUR : thisMonday + Math.floor((span * (0.5 + 0.01 * i)) / 1000) * 1000);
  const logDir = path.join(old, 'docs/devteam/run/log');
  let n = 0;
  const PREFIX = { phase: 'h', spend: 's', observation: 'o', act: 'a' };
  const hand = (by, o, atMs) => {
    const id = o.id ?? `${PREFIX[o.type]}-${stamp(atMs + n++)}-${by}`;
    const file = ['owner', 'supervisor'].includes(by) ? `${by}-${new Date(atMs).toISOString().slice(0, 7)}.jsonl` : `${by}.jsonl`;
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, file), line({ op: 'new', ...o, id, at: new Date(atMs).toISOString(), by }));
    return id;
  };
  const addTicket = (id, size = 'S', risk = 'normal') => ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'eff', component: 'eff', kind: 'build', size, risk, serves: ['EFF-S1'], depends_on: [], touches: ['src/**'], done_when: ['the src test passes in CI'] })], SUP);
  ok(old, ['feature', 'add', 'eff', '--json', JSON.stringify({ title: 'Eff', goals: ['g-20260101-000000000-supervisor'], stories: [{ id: 'EFF-S1', text: 'it works', release: 'v1.0.0' }] })], SUP);
  const phase = (id, to, atMs) => hand(id, { type: 'phase', from: null, to }, atMs);
  const spend = (id, { role = 'worker', phase: ph = 'build', usd, input = 0, output = 0, cache_read = 0, cache_write = 0, model = 'claude-opus-5-5', atMs }) =>
    hand('supervisor', { type: 'spend', who: id, role, phase: ph, through: new Date(atMs).toISOString(), usd, input_tokens: input, output_tokens: output, cache_read_tokens: cache_read, cache_write_tokens: cache_write, by_model: { [model]: { usd, output_tokens: output } } }, atMs);
  // a merge is a commit on main whose subject starts "<id>:", dated atMs (mergedAt reads its committer date)
  const merges = [];
  const merge = (id, atMs) => merges.push([id, atMs]);
  const reviewFile = (id, name, verdict) => write(path.join(old, 'docs/devteam/project/tickets', id, 'reviews', name), `- Reviewer: r\n\n| Id | Severity | Rule | Where | Finding | Disposition |\n|---|---|---|---|---|---|\n${verdict ? `\nVerdict: ${verdict} ${'a'.repeat(40)}\n` : ''}`);
  // one ticket, merged in week k as the i-th of the week, with its phase line `hours` before the merge
  // and its spend lines just before the merge (in the merge's week)
  const shipped = (id, k, i, { size = 'S', risk = 'normal', hours = 1, spends = [] } = {}) => {
    addTicket(id, size, risk);
    const m = mergeAt(k, i);
    phase(id, 'build', m - hours * HOUR);
    for (const s of spends) spend(id, { ...s, atMs: m - (k < 11 ? 60000 : Math.max(1000, Math.floor(span / 1000))) });
    merge(id, m);
    return m;
  };
  const land = () => {
    for (const [id, at] of merges.sort((a, b) => a[1] - b[1])) {
      const date = new Date(at).toISOString();
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', `${id}: work`], { cwd: old, env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } });
    }
    merges.length = 0;
    g(['push', '-q', 'origin', 'main'], old);
  };
  const data = (env = {}) => json(ok(old, ['dashboard-data'], env));
  return { ...F, thisMonday, span, weekStart, mergeAt, hand, addTicket, phase, spend, merge, reviewFile, shipped, land, data };
}
// the fixture's weeks still are the kit's: a run that crossed Monday 00:00 UTC since the fixture
// was built, or one built in the first minutes of a week, can't check this week's answers
const weekMoved = (E, eff) => eff.weeks[11].starts_at !== new Date(E.thisMonday).toISOString();
const tooEarly = (E) => E.span < 10 * 60000;

test('weeks: twelve calendar weeks, oldest first, ending this week', (t) => {
  const E = effFixture('eff-weeks');
  try {
    const eff = E.data().efficiency;
    if (weekMoved(E, eff)) return t.skip('the run crossed Monday 00:00 UTC');
    assert.equal(eff.weeks.length, 12);
    eff.weeks.forEach((w, i) => assert.equal(w.starts_at, new Date(E.weekStart(i)).toISOString(), `week ${i}`));
    for (const w of eff.weeks) assert.deepEqual([w.tickets, w.points, w.usd_per_point, w.hours_per_point, w.first_pass, w.cache_read_share, w.score], [0, 0, null, null, 1, null, null]);
  } finally { E.done(); }
});

test('per-week measures from known logs', (t) => {
  const E = effFixture('eff-measures');
  try {
    if (tooEarly(E)) return t.skip('fewer than 10 minutes into this week');
    // week 9: A S $3 10h, B M $8 20h, C S $1 2h; D merged that week with no spend; E in week 8
    E.shipped('eff-10-a', 9, 0, { hours: 10, spends: [{ phase: 'build', usd: 2, input: 100, output: 50, cache_read: 300, cache_write: 100 }, { role: 'reviewer', phase: 'final-review', usd: 1, input: 10, output: 5, cache_read: 0, cache_write: 90 }] });
    E.shipped('eff-10-b', 9, 1, { size: 'M', hours: 20, spends: [{ phase: 'build', usd: 8, input: 200, output: 80, cache_read: 1200, cache_write: 0 }] });
    E.shipped('eff-10-c', 9, 2, { hours: 2, spends: [{ phase: 'spec', usd: 1, input: 50, output: 20, cache_read: 0, cache_write: 50 }] });
    E.shipped('eff-10-d', 9, 3, { hours: 3 });
    E.shipped('eff-10-e', 8, 0, { hours: 4, spends: [{ phase: 'build', usd: 5, input: 10 }] });
    E.hand('supervisor', { type: 'observation', source: 'supervisor', subject: 'eff-10-a', kind: 'escaped-defect', detail: 'found after merge', severity: 3, valence: -1 }, E.mergeAt(9, 5));
    // this week F ($2); last week G ($10) just before Monday: the rolling 7 days hold both, this
    // calendar week only F
    E.shipped('eff-10-f', 11, 0, { hours: 1, spends: [{ phase: 'build', usd: 2 }] });
    E.addTicket('eff-10-g'); E.phase('eff-10-g', 'build', E.thisMonday - 3 * HOUR); E.spend('eff-10-g', { usd: 10, atMs: E.thisMonday - 2 * HOUR }); E.merge('eff-10-g', E.thisMonday - HOUR);
    E.land();
    const d = E.data();
    const eff = d.efficiency;
    if (weekMoved(E, eff)) return t.skip('the run crossed Monday 00:00 UTC');
    const w9 = eff.weeks[9];
    assert.deepEqual([w9.tickets, w9.points, w9.usd_per_point, w9.hours_per_point], [3, 4, 3, 8], 'week 9: D has no spend, so it is not counted');
    assert.deepEqual(w9.usd_by_phase, { build: 10, 'final-review': 1, spec: 1 });
    assert.deepEqual(w9.tokens_by_phase, { build: { input: 300, output: 130, cache_read: 1500, cache_write: 100 }, 'final-review': { input: 10, output: 5, cache_read: 0, cache_write: 90 }, spec: { input: 50, output: 20, cache_read: 0, cache_write: 50 } });
    assert.equal(w9.cache_read_share, +(1500 / (360 + 1500 + 240)).toFixed(2));
    assert.equal(w9.escaped_defects, 1);
    assert.deepEqual([eff.weeks[8].tickets, eff.weeks[8].usd_per_point, eff.weeks[8].hours_per_point, eff.weeks[8].escaped_defects], [1, 5, 4, 0]);
    assert.equal(eff.weeks[7].cache_read_share, null, 'no spend items that week');
    assert.equal(eff.weeks[11].usd_per_point, 2, 'this calendar week: F only');
    const rolling = d.metrics.cost.per_point_this_week;
    if (Date.now() - (E.thisMonday - HOUR) < 7 * DAY) assert.equal(rolling.usd_per_point, 6, 'the rolling 7 days: F and G');
  } finally { E.done(); }
});

test('first_pass: ticket stages only, first passes, verdicts only', (t) => {
  const E = effFixture('eff-firstpass');
  try {
    E.shipped('eff-10-h', 7, 0, { spends: [{ usd: 1 }] });
    for (const [f, v] of [['spec-1.md', 'APPROVE'], ['plan-1.md', 'CHANGES'], ['plan-2.md', 'APPROVE'], ['spec-1b.md', 'CHANGES'], ['task-1.md', 'APPROVE'], ['task-2.md', 'CHANGES'], ['task-2-2.md', 'APPROVE'], ['final-1.md', null], ['design-1.md', 'CHANGES'], ['contract-1.md', 'CHANGES']]) E.reviewFile('eff-10-h', f, v);
    // task first passes count each task review (ruling m-20261115-204118085-supervisor)
    E.shipped('eff-10-i', 6, 0, { spends: [{ usd: 1 }] });
    for (const [f, v] of [['task-1.md', 'APPROVE'], ['task-2.md', 'CHANGES'], ['task-2-2.md', 'APPROVE']]) E.reviewFile('eff-10-i', f, v);
    E.land();
    const eff = E.data().efficiency;
    if (weekMoved(E, eff)) return t.skip('the run crossed Monday 00:00 UTC');
    assert.deepEqual([eff.weeks[7].first_passes, eff.weeks[7].first_pass], [4, 0.5]);
    assert.deepEqual([eff.weeks[6].first_passes, eff.weeks[6].first_pass], [2, 0.5], 'task-1.md and task-2.md; task-2-2.md is a later pass');
    assert.equal(eff.weeks[5].first_pass, 1, 'none: 1');
  } finally { E.done(); }
});

test('review folders are read once per request', () => {
  const E = effFixture('eff-reads');
  try {
    for (const [id, k] of [['eff-10-r1', 3], ['eff-10-r2', 4]]) { E.shipped(id, k, 0, { spends: [{ usd: 1 }] }); E.reviewFile(id, 'spec-1.md', 'APPROVE'); }
    E.addTicket('eff-10-r3');
    E.land();
    const r = E.run(E.old, ['dashboard-data'], { DEVTEAM_TEST_REVIEW_READS: '1' });
    assert.equal(r.status, 0, r.err);
    assert.match(r.err, /^review reads: 3$/m, 'each of the three tickets once');
  } finally { E.done(); }
});

test('/api/data carries the same efficiency, read fresh on each request', async (t) => {
  const E = effFixture('eff-api');
  let dash;
  try {
    E.shipped('eff-10-p', 9, 0, { spends: [{ usd: 4 }] });
    E.land();
    const cli = E.data().efficiency;
    const started = await dashboardOnFreePort(E.old, E.env({}));
    dash = started.dash;
    const get = async () => (await (await fetch(`http://127.0.0.1:${started.port}/api/data`)).json()).efficiency;
    const first = await get();
    if (weekMoved(E, first)) return t.skip('the run crossed Monday 00:00 UTC');
    assert.deepEqual(first.weeks, cli.weeks);
    E.spend('eff-10-p', { phase: 'verify', usd: 3, atMs: E.mergeAt(9, 0) - 120000 });
    const second = await get();
    assert.deepEqual(second.weeks[9].usd_by_phase, { build: 4, verify: 3 });
  } finally { dash?.stop(); E.done(); }
});

// three S tickets merged in week k, each with `usd` of spend and a cycle of `hours`
const threeIn = (E, k, tag, { usd, hours, from = 0 }) => [0, 1, 2].map((j) => { const id = `eff-${String(k).padStart(2, '0')}-${tag}${j}`; E.shipped(id, k, from + j, { hours, spends: [{ usd }] }); return id; });
const defectIn = (E, k) => E.hand('supervisor', { type: 'observation', source: 'supervisor', subject: 'eff', kind: 'escaped-defect', detail: 'found after merge', severity: 3, valence: -1 }, E.mergeAt(k, 9));

test('score against hand-computed answers', (t) => {
  const E = effFixture('eff-score');
  try {
    if (tooEarly(E)) return t.skip('fewer than 10 minutes into this week');
    threeIn(E, 3, 'a', { usd: 4, hours: 10 });
    const [w5] = threeIn(E, 5, 'b', { usd: 2, hours: 20 });
    E.reviewFile(w5, 'spec-1.md', 'APPROVE'); E.reviewFile(w5, 'plan-1.md', 'CHANGES');
    const [w7] = threeIn(E, 7, 'c', { usd: 5, hours: 5 });
    for (const [f, v] of [['spec-1.md', 'APPROVE'], ['plan-1.md', 'APPROVE'], ['task-1.md', 'APPROVE'], ['task-2.md', 'CHANGES']]) E.reviewFile(w7, f, v);
    threeIn(E, 11, 'd', { usd: 2.5, hours: 8 });
    defectIn(E, 11);
    E.shipped('eff-09-e0', 9, 0, { spends: [{ usd: 1 }] }); E.shipped('eff-09-e1', 9, 1, { spends: [{ usd: 1 }] });
    E.land();
    const eff = E.data().efficiency;
    if (weekMoved(E, eff)) return t.skip('the run crossed Monday 00:00 UTC');
    const w = eff.weeks;
    assert.deepEqual([w[3].usd_per_point, w[3].hours_per_point, w[5].first_pass, w[7].first_pass, w[11].usd_per_point, w[11].escaped_defects], [4, 10, 0.5, 0.75, 2.5, 1]);
    assert.deepEqual(eff.best, { usd_per_point: 2, hours_per_point: 5 });
    assert.deepEqual([w[3].score, w[3].parts], [67, { spend: 0.5, time: 0.5, rework: 1 }]);
    assert.deepEqual([w[5].score, w[5].parts], [58, { spend: 1, time: 0.25, rework: 0.5 }]);
    assert.deepEqual([w[7].score, w[7].parts], [72, { spend: 0.4, time: 1, rework: 0.75 }]);
    assert.deepEqual([w[11].score, w[11].parts], [55, { spend: 0.4, time: 0.25, rework: 1 }], 'a defect week takes the lowest raw spend and time of the other scored weeks');
    assert.deepEqual([w[9].tickets, w[9].usd_per_point, w[9].score, w[9].parts], [2, 1, null, null], 'under 3 tickets: counts, no score');
    assert.deepEqual(eff.score, { this_week: 55, last_week: null });
    assert.deepEqual(eff.parts, { spend: 0.4, time: 0.25, rework: 1 });
  } finally { E.done(); }
});

test('a defect week with the lowest dollars still sets best', (t) => {
  const E = effFixture('eff-best');
  try {
    threeIn(E, 2, 'a', { usd: 1, hours: 1 });
    defectIn(E, 2);
    threeIn(E, 4, 'b', { usd: 2, hours: 1 });
    E.land();
    const eff = E.data().efficiency;
    if (weekMoved(E, eff)) return t.skip('the run crossed Monday 00:00 UTC');
    assert.equal(eff.best.usd_per_point, 1);
    assert.deepEqual(eff.weeks[4].parts, { spend: 0.5, time: 1, rework: 1 });
    assert.deepEqual(eff.weeks[2].parts, { spend: 0.5, time: 1, rework: 1 }, "w2 takes w4's spend");
    assert.deepEqual([eff.weeks[2].score, eff.weeks[4].score], [83, 83]);
  } finally { E.done(); }
});

test('one scored week with a defect scores rework only', (t) => {
  const E = effFixture('eff-one');
  try {
    const [a] = threeIn(E, 6, 'a', { usd: 3, hours: 2 });
    for (const [f, v] of [['spec-1.md', 'APPROVE'], ['plan-1.md', 'APPROVE'], ['task-1.md', 'APPROVE'], ['final-1.md', 'CHANGES']]) E.reviewFile(a, f, v);
    defectIn(E, 6);
    E.land();
    const eff = E.data().efficiency;
    if (weekMoved(E, eff)) return t.skip('the run crossed Monday 00:00 UTC');
    assert.deepEqual([eff.weeks[6].score, eff.weeks[6].parts], [25, { spend: 0, time: 0, rework: 0.75 }]);
  } finally { E.done(); }
});

test('usd_per_point 0 scores spend 1', (t) => {
  const E = effFixture('eff-zero');
  try {
    threeIn(E, 5, 'a', { usd: 0, hours: 2 });
    E.land();
    const eff = E.data().efficiency;
    if (weekMoved(E, eff)) return t.skip('the run crossed Monday 00:00 UTC');
    assert.equal(eff.weeks[5].usd_per_point, 0);
    assert.deepEqual([eff.weeks[5].score, eff.weeks[5].parts], [100, { spend: 1, time: 1, rework: 1 }]);
  } finally { E.done(); }
});

const obs = (E, o, atMs) => E.hand('supervisor', { type: 'observation', source: 'supervisor', severity: 2, valence: -1, ...o }, atMs);

test('observe is the window\'s metrics plus tokens_by_phase', () => {
  const E = effFixture('eff-observe');
  try {
    E.shipped('eff-10-a', 8, 0, { hours: 3, spends: [{ phase: 'build', usd: 2, input: 10, output: 20, cache_read: 30, cache_write: 40 }, { role: 'reviewer', phase: 'final-review', usd: 1, input: 1, output: 2, cache_read: 3, cache_write: 4 }] });
    E.shipped('eff-10-b', 9, 0, { hours: 2, spends: [{ phase: 'build', usd: 3, input: 100, output: 200, cache_read: 300, cache_write: 400, model: 'claude-sonnet-5-5' }] });
    E.land();
    const d = E.data();
    const o = d.efficiency.observe;
    assert.deepEqual(o.phase_hours, d.metrics.phase_hours);
    assert.deepEqual(o.phase_usd, d.metrics.phase_usd);
    assert.deepEqual(o.by_model, d.metrics.cost.by_model);
    assert.deepEqual(o.tokens, d.metrics.cost.tokens);
    assert.deepEqual(o.tokens_by_phase, { build: { input: 110, output: 220, cache_read: 330, cache_write: 440 }, 'final-review': { input: 1, output: 2, cache_read: 3, cache_write: 4 } });
  } finally { E.done(); }
});

// five merged S tickets at $1, and an open one (eff-20-k) at $20 whose recent spend mostly missed the
// cache: metrics raises costly-ticket and low-cache-hit; an escaped defect raises a finding that
// isn't about spend. eff-20-n ($6) merged 11+ days ago, too old for costly-ticket on any weekday.
function spendFindings(name) {
  const E = effFixture(name);
  for (const i of [0, 1, 2, 3, 4]) E.shipped(`eff-20-m${i}`, 9, i, { spends: [{ usd: 1 }] });
  E.addTicket('eff-20-k'); E.phase('eff-20-k', 'build', Date.now() - 3 * HOUR);
  E.spend('eff-20-k', { usd: 20, input: 4e6, cache_read: 2e6, atMs: Date.now() - HOUR });
  E.shipped('eff-20-n', 9, 13, { spends: [{ usd: 6 }] }); // after the trials' since, and over 7 days old any weekday, so not costly
  obs(E, { subject: 'eff', kind: 'escaped-defect', detail: 'found after merge', severity: 3 }, E.mergeAt(10, 5));
  E.land();
  return E;
}

test('waste is the open spend findings', () => {
  const E = spendFindings('eff-waste');
  try {
    let d = E.data();
    const kinds = (fs2) => fs2.map((f) => f.kind).sort();
    assert.ok(kinds(d.metrics.findings).includes('escaped-defects'), 'a finding that is not about spend is open');
    assert.deepEqual(kinds(d.efficiency.waste), ['costly-ticket', 'low-cache-hit']);
    const want = (m, ids = {}) => m.metrics.findings.filter((f) => ['costly-ticket', 'low-cache-hit'].includes(f.kind)).map((f) => ({ id: ids[f.kind] ?? null, kind: f.kind, subject: f.subject, detail: f.detail }));
    assert.deepEqual(d.efficiency.waste, want(d));
    // once observed, each carries its newest observation's id
    obs(E, { subject: 'eff-20-k', kind: 'costly-ticket', detector: 'metrics', source: 'metrics', detail: 'older', source_key: 'metrics:costly-ticket:eff-20-k' }, Date.now() - 2 * HOUR);
    const newer = obs(E, { subject: 'eff-20-k', kind: 'costly-ticket', detector: 'metrics', source: 'metrics', detail: 'newer', source_key: 'metrics:costly-ticket:eff-20-k' }, Date.now() - 1000);
    const cache = obs(E, { subject: 'prompt cache', kind: 'low-cache-hit', detector: 'metrics', source: 'metrics', detail: 'x', source_key: 'metrics:low-cache-hit:prompt cache' }, Date.now() - 900);
    d = E.data();
    assert.deepEqual(d.efficiency.waste, want(d, { 'costly-ticket': newer, 'low-cache-hit': cache }));
    // set aside, it is no longer open
    obs(E, { subject: 'low-cache-hit prompt cache', kind: 'finding-ack', detail: 'seen' }, Date.now() - 500);
    assert.deepEqual(kinds(E.data().efficiency.waste), ['costly-ticket']);
  } finally { E.done(); }
});

test('trials: spend trials and their state', () => {
  const E = spendFindings('eff-trials');
  try {
    const since = E.weekStart(9) + 3 * DAY + 12 * HOUR;
    const finding = obs(E, { subject: 'eff-20-k', kind: 'costly-ticket', detector: 'metrics', source: 'metrics', detail: 'x', source_key: 'metrics:costly-ticket:eff-20-k' }, since - HOUR);
    const act = (what, refs, at, cls = 'improvement-trial') => E.hand('supervisor', { type: 'act', class: cls, what, refs, reversible: true }, at);
    const t1 = act('Trial: resume sessions instead of relaunching them', [finding], since);
    const t2 = act('Trial: cut cost per merged point with smaller specs', [], since + HOUR);
    const t3 = act('Trial: lower the cost-per-point of reviews', [], since + 2 * HOUR);
    act('Trial: faster gates', [], since + 3 * HOUR);
    act('changed the plan to cut cost per point', [], since + 4 * HOUR, 'replan-within-feature');
    obs(E, { subject: 'eff', kind: 'outcome', detail: 'kept', valence: 1, refs: [t2] }, since + 5 * HOUR);
    obs(E, { subject: 'eff', kind: 'outcome', detail: 'looked good', valence: 1, refs: [t3] }, since + 6 * HOUR);
    obs(E, { subject: 'eff', kind: 'outcome', detail: 'it did not hold', valence: -1, refs: [t3] }, since + 7 * HOUR);
    const tr = E.data().efficiency.trials;
    assert.deepEqual(tr.map((x) => [x.id, x.state]), [[t3, 'dropped'], [t2, 'kept'], [t1, 'running']], 'newest first; the newest outcome wins');
    const one = tr.find((x) => x.id === t1);
    assert.deepEqual(one, { id: t1, what: 'Trial: resume sessions instead of relaunching them', since: new Date(since).toISOString(), usd_per_point_start: 1, usd_per_point_now: 6, escaped_defects_since: 1, state: 'running' });
  } finally { E.done(); }
});

// ---- suggestions (Decide) ----
const ID_PART = /^[a-z0-9][a-z0-9-]{0,110}$/; // SUBJECT_REF's id part: suggestion:<id> once kit-99 adds the type
const CODE_WORDS = /\b(review-depth|smaller-model|costly-ticket|tighter-specs|low-cache-hit|cost-hotspot|final-review)\b|claude-/;
const plainWords = (sugg) => { for (const s of sugg) for (const k of ['what', 'evidence', 'effect']) { assert.equal(typeof s[k], 'string', `${s.id} ${k}`); assert.doesNotMatch(s[k], CODE_WORDS, `${s.id} ${k}: ${s[k]}`); } };
const byId = (sugg) => Object.fromEntries(sugg.map((s) => [s.id, s]));
// model_prices is the owner's: it applies as origin/main has it, so the change lands there
const setPrices = (E, prices) => {
  const f = path.join(E.old, 'docs/devteam/project/settings.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/("model_prices": \{[^]*?\},\s*)?"gates": \{\}/, `"model_prices": ${JSON.stringify(prices)}, "gates": {}`));
  E.g(['commit', '-qam', 'settings: model_prices'], E.old);
  E.g(['push', '-q', 'origin', 'main'], E.old);
};
// a moment this week, after Monday 00:00 and before now
const thisWeekAt = (E, f) => E.thisMonday + Math.floor(E.span * f);

// The family table, loaded from the script by itself (as coverageFns loads its block).
function modelFns() {
  const src = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'docs/devteam/scripts/devteam.mjs'), 'utf8');
  const i = src.indexOf('/* model families start */'), j = src.indexOf('/* model families end */');
  assert.ok(i >= 0 && j > i, 'the model families block in devteam.mjs');
  return vm.runInContext(`${src.slice(i, j)}\n;({ smallerModel, modelWords })`, vm.createContext({}));
}

test('smaller model: same version one family down', () => {
  const { smallerModel, modelWords } = modelFns();
  const priced = ['claude-fable-5-1', 'claude-mythos-5-1', 'claude-fable-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-5-5', 'claude-haiku-4-5'];
  assert.equal(smallerModel('claude-opus-5-5', priced), 'claude-sonnet-5-5');
  assert.equal(smallerModel('claude-fable-5-1', priced), 'claude-opus-5-5', 'opus-5-1 is not priced: the newest priced opus');
  assert.equal(smallerModel('claude-haiku-5-5', priced), null, 'nothing below haiku');
  assert.equal(smallerModel('claude-sonnet-4-6', priced), 'claude-haiku-5-5', 'haiku-4-6 is not priced: the newest priced haiku');
  assert.equal(smallerModel('claude-gpt-9', priced), null, 'an unknown family');
  assert.equal(smallerModel('claude-opus-9-9', [...priced, 'claude-sonnet-9-9']), 'claude-sonnet-9-9');
  assert.equal(modelWords('claude-sonnet-5-5'), 'Sonnet 5.5');
});

test('smaller-model condition and effect', (t) => {
  const E = effFixture('eff-smaller');
  try {
    if (tooEarly(E)) return t.skip('fewer than 10 minutes into this week');
    const OPUS = 'us.anthropic.Claude-Opus-5-5-20261001';
    E.addTicket('eff-30-a'); E.phase('eff-30-a', 'build', thisWeekAt(E, 0.1));
    const s = (usd, phase, model = OPUS) => E.spend('eff-30-a', { usd, phase, model, atMs: thisWeekAt(E, 0.2) });
    s(20, 'build'); s(17, 'final-review'); s(5, 'spec'); s(3, 'build', 'claude-sonnet-5-5');
    assert.deepEqual(E.data().efficiency.suggestions, [], '$45 this week: not above $50');
    s(15, 'spec');
    const a = E.data().efficiency.suggestions;
    assert.equal(a.length, 1);
    assert.deepEqual([a[0].id, a[0].kind, a[0].usd, a[0].per], ['eff-smaller-model-claude-opus-5-5', 'smaller-model', 10, 'week'], 'opus is 57 of 60: $20 outside reviews, specs and planning, times 1 - 10/20');
    assert.match(a[0].what, /Sonnet 5\.5/);
    plainWords(a);
    assert.deepEqual(E.data().efficiency.suggestions.map((x) => x.id), [a[0].id], 'the same id on the next read');
    setPrices(E, { 'claude-sonnet-5-5': { input: 2, output: 25 } });
    assert.deepEqual(E.data().efficiency.suggestions, [], 'sonnet priced above opus in settings: no saving');
    setPrices(E, {});
    s(7, 'build', 'claude-sonnet-5-5');
    assert.deepEqual(E.data().efficiency.suggestions, [], 'opus 57 of 67 (85%): not above 90%');
  } finally { E.done(); }
});

test('suggestion ids are valid thread subjects, cut at 110 characters', (t) => {
  const E = effFixture('eff-ids');
  try {
    if (tooEarly(E)) return t.skip('fewer than 10 minutes into this week');
    const long = `claude-opus-${Array(60).fill('5').join('-')}`;
    setPrices(E, { [long]: { input: 4, output: 20 } });
    E.addTicket('eff-31-a'); E.phase('eff-31-a', 'build', thisWeekAt(E, 0.1));
    E.spend('eff-31-a', { usd: 60, model: long, atMs: thisWeekAt(E, 0.2) });
    const [s] = E.data().efficiency.suggestions;
    assert.equal(s.id, `eff-smaller-model-${long}`.slice(0, 110));
    assert.match(s.id, ID_PART);
  } finally { E.done(); }
});

test('review depth and tighter specs priced per pass', (t) => {
  const E = effFixture('eff-depth');
  try {
    if (tooEarly(E)) return t.skip('fewer than 10 minutes into this week');
    // per pass: X ($4 in final-review and $2 in review over 2 final records) 3, Y 4, Z 5: median 4
    const finals = [];
    for (const [id, k, usd, n] of [['eff-32-x', 6, [4, 2], 2], ['eff-32-y', 7, [4], 1], ['eff-32-z', 8, [10], 2]]) {
      E.shipped(id, k, 0, { spends: [{ usd: 1 }, ...usd.map((u, j) => ({ role: 'reviewer', phase: j ? 'review' : 'final-review', usd: u }))] });
      for (let p = 1; p <= n; p++) { E.reviewFile(id, `final-${p}.md`, 'APPROVE'); finals.push(path.join(E.old, 'docs/devteam/project/tickets', id, 'reviews', `final-${p}.md`)); }
    }
    // this week: one S/normal ticket with 3 spec and plan records; four M tickets with 3 of 4 first
    // plan reviews asking for changes, and 2 later plan passes
    E.shipped('eff-32-s', 11, 0, { spends: [{ usd: 1 }] });
    for (const f of ['spec-1.md', 'spec-2.md', 'plan-1.md']) E.reviewFile('eff-32-s', f, 'APPROVE');
    ['b', 'c', 'd', 'e'].forEach((x, j) => { const id = `eff-32-${x}`; E.shipped(id, 11, j + 1, { size: 'M', spends: [{ usd: 1 }] }); E.reviewFile(id, 'plan-1.md', j < 3 ? 'CHANGES' : 'APPROVE'); if (j < 2) E.reviewFile(id, 'plan-2.md', 'APPROVE'); });
    E.land();
    const eff = E.data().efficiency;
    if (weekMoved(E, eff)) return t.skip('the run crossed Monday 00:00 UTC');
    const s = byId(eff.suggestions);
    assert.deepEqual(Object.keys(s).sort(), ['eff-review-depth-s-normal', 'eff-tighter-specs-plan']);
    assert.deepEqual([s['eff-review-depth-s-normal'].usd, s['eff-review-depth-s-normal'].per], [12, 'week'], '3 passes at $4');
    assert.deepEqual([s['eff-tighter-specs-plan'].usd, s['eff-tighter-specs-plan'].per], [8, 'week'], '2 later plan passes at $4');
    assert.deepEqual(eff.suggestions.map((x) => x.id), ['eff-review-depth-s-normal', 'eff-tighter-specs-plan'], 'by dollars');
    plainWords(eff.suggestions);
    for (const f of finals) fs.rmSync(f);
    assert.deepEqual(E.data().efficiency.suggestions, [], 'no final records: no price per pass, so neither');
  } finally { E.done(); }
});

test('cache and costly tickets, the top five by dollars, and dropping out', (t) => {
  const E = effFixture('eff-cache');
  try {
    if (tooEarly(E)) return t.skip('fewer than 10 minutes into this week');
    for (const i of [0, 1, 2, 3, 4]) E.shipped(`eff-33-m${i}`, 9, i, { spends: [{ usd: 5 }] });
    E.addTicket('eff-33-k', 'M'); E.phase('eff-33-k', 'build', thisWeekAt(E, 0.1));
    E.spend('eff-33-k', { usd: 40, input: 6e6, cache_read: 4e6, atMs: thisWeekAt(E, 0.2) });
    E.land();
    let eff = E.data().efficiency;
    if (weekMoved(E, eff)) return t.skip('the run crossed Monday 00:00 UTC');
    let s = byId(eff.suggestions);
    assert.deepEqual(Object.keys(s).sort(), ['eff-cache-prompt-cache', 'eff-costly-ticket-eff-33-k']);
    assert.deepEqual([s['eff-costly-ticket-eff-33-k'].usd, s['eff-costly-ticket-eff-33-k'].per], [30, 'once'], '$40 less the median $5 a point times 2 points');
    assert.deepEqual([s['eff-cache-prompt-cache'].usd, s['eff-cache-prompt-cache'].per], [7.6, 'week'], '2M tokens short of 60% cache reads, at $4 - $0.20 a million');
    plainWords(eff.suggestions);
    // three more costly tickets: six conditions, five shown, by dollars
    for (const [x, usd] of [['k2', 30], ['k3', 24], ['k4', 22]]) { const id = `eff-33-${x}`; E.addTicket(id, 'M'); E.phase(id, 'build', thisWeekAt(E, 0.1)); E.spend(id, { usd, input: 1e6, atMs: thisWeekAt(E, 0.3) }); }
    eff = E.data().efficiency;
    assert.deepEqual(eff.suggestions.map((x) => [x.id, x.usd]), [['eff-smaller-model-claude-opus-5-5', 58], ['eff-costly-ticket-eff-33-k', 30], ['eff-costly-ticket-eff-33-k2', 20], ['eff-cache-prompt-cache', 14.44], ['eff-costly-ticket-eff-33-k3', 14]]);
    for (const x of eff.suggestions) assert.match(x.id, ID_PART);
    // its finding set aside, a condition no longer holds: that suggestion drops out, the rest keep their ids
    E.hand('supervisor', { type: 'observation', source: 'supervisor', subject: 'costly-ticket eff-33-k2', kind: 'finding-ack', detail: 'seen', severity: 1, valence: 0 }, Date.now() - 500);
    assert.deepEqual(E.data().efficiency.suggestions.map((x) => x.id), ['eff-smaller-model-claude-opus-5-5', 'eff-costly-ticket-eff-33-k', 'eff-cache-prompt-cache', 'eff-costly-ticket-eff-33-k3', 'eff-costly-ticket-eff-33-k4']);
  } finally { E.done(); }
});

test('no spend items: no price per review pass, so no review suggestions', (t) => {
  const E = effFixture('eff-reported');
  try {
    if (tooEarly(E)) return t.skip('fewer than 10 minutes into this week');
    // spend reported on phase lines only (no harness logs, no spend lines)
    const reported = (id, k, i, usd) => { E.addTicket(id); const m = E.mergeAt(k, i); E.hand(id, { type: 'phase', from: null, to: 'build' }, m - 2 * HOUR); E.hand(id, { type: 'phase', from: 'build', to: 'final-review', usd }, m - HOUR); E.merge(id, m); };
    reported('eff-34-x', 6, 0, 4);
    E.reviewFile('eff-34-x', 'final-1.md', 'APPROVE');
    reported('eff-34-s', 11, 0, 2);
    for (const f of ['spec-1.md', 'spec-2.md', 'plan-1.md']) E.reviewFile('eff-34-s', f, 'APPROVE');
    E.land();
    const eff = E.data().efficiency;
    if (weekMoved(E, eff)) return t.skip('the run crossed Monday 00:00 UTC');
    assert.equal(eff.weeks[11].tickets, 1, 'reported spend still counts the ticket');
    assert.deepEqual(eff.suggestions, []);
  } finally { E.done(); }
});
