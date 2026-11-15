// The Efficiency Score's data (kit-173): /api/data's `efficiency`, derived on read from the log,
// the review records and the git facts, over kit-98's 12 calendar weeks (Monday 00:00 UTC), oldest
// first, ending with this week. Fixtures write phase, spend and observation lines by hand at chosen
// times and date each ticket's merge commit into the week a case needs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
