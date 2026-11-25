// The hub's claude part (kit-840): the burn rate measured from accounts-tick's records
// (accounts.json's capacity.list, kit-839's rows) over six hours, and the projection of whether the
// accounts last to their resets, spent as cswap's best strategy does. The region runs here with only
// the names it reads given to it, beside the box-memory, contract and sampler regions it builds on; a
// fake ctx drives its reads, so no timer fires by itself and nothing asks this machine's hub. Every
// account, label and address here is made up.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checks, regionOf } from './fixtures/box-health/contract/check.mjs';
import { T0, MIN, HOUR, DAY, iso, projectRoot, accountsFile, row, record, write, JITTER, JITTER_MINUTE, projectionCase } from './fixtures/box-health/claude/readings.mjs';
import { kit } from './lib/kit.mjs';

const { boxHealthProblem } = checks();
const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-boxclaude-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
let dirs = 0;
const newRoot = () => { const d = path.join(scratch, `d${++dirs}`); fs.mkdirSync(d); return projectRoot(d); };
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg ?? ''}: ${a} is not ${b}`);

function load() {
  const proc = { env: {}, pid: 4242, memoryUsage: { rss: () => 1 } };
  const hang = new Set(), held = [];
  let opened = 0;
  const promises = new Proxy(fs.promises, { get: (o, k) => (k !== 'open' ? o[k] : (p, ...a) => { opened++; return [...hang].some((h) => String(p).includes(h)) ? new Promise((res) => held.push(res)).then(() => o.open(p, ...a)) : o.open(p, ...a); }) });
  const ffs = new Proxy(fs, { get: (o, k) => (k === 'promises' ? promises : o[k]) });
  const names = { fs: ffs, path, Buffer, process: proc };
  const code = `'use strict';\n${['box-memory', 'box-health-contract', 'box-health-sampler', 'box-health-claude'].map((n) => regionOf(n, src)).join('\n')}\nconst named = (f) => (typeof f === "function" ? f : undefined);\nreturn { boxHealthClaude, projectClaude: named(typeof projectClaude === "undefined" ? undefined : projectClaude), claudeSafeRate: named(typeof claudeSafeRate === "undefined" ? undefined : claudeSafeRate), claudeThin: named(typeof claudeThin === "undefined" ? undefined : claudeThin) };`;
  return { ...new Function(...Object.keys(names), code)(...Object.values(names)), hang, pending: () => held.length, opened: () => opened, release: () => { hang.clear(); held.splice(0).forEach((res) => res()); } };
}
// The part started with a fake ctx: read() runs the 15 s interval as it fires; real() may run apart
// from now(), as it does with DEVTEAM_BOX_HEALTH_FAST.
function started(roots, s = load()) {
  const clock = { now: T0, real: T0 }, timers = [], said = [];
  let list = roots.map((root, i) => ({ root, name: `p${i}` }));
  const ctx = {
    now: () => clock.now, real: () => clock.real,
    every: (ms, fn) => { const t = { kind: 'every', ms, fn }; timers.push(t); return () => { t.ended = true; }; },
    after: (ms, fn) => { const t = { kind: 'after', ms, fn }; timers.push(t); return () => { t.ended = true; }; },
    timeout: (ms, fn) => { const t = { kind: 'timeout', ms, fn }; timers.push(t); return () => { t.ended = true; }; },
    turn: async () => {},
    roots: () => list, ceiling: () => 0.8, scan: async () => [],
    proc: '/nowhere', cgroup: '/nowhere', stopped: () => false, say: (w) => said.push(String(w)),
  };
  s.boxHealthClaude.start(ctx);
  assert.deepEqual(timers.map((t) => [t.kind, t.ms]), [['every', 15000]], 'start sets one 15 s interval and reads nothing');
  const every = timers[0];
  return {
    s, ctx, clock, said, timers, stop: () => s.boxHealthClaude.stop(), setRoots: (rs) => { list = rs.map((root, i) => ({ root, name: `p${i}` })); },
    read: () => every.fn(),
    pass: (ms) => { clock.now += ms; clock.real += ms; },
    part: () => s.boxHealthClaude.part(ctx, {}),
  };
}
const whole = (got) => ({ v: 1, at: iso(T0), window_s: 3600, now: {}, samples: [], claude: got.answer.claude });
// readings of one root, a minute apart: each step writes the record stamped by real() and reads it
async function readings(p, root, lists) {
  for (const list of lists) {
    write(root, p.clock.real, list);
    await p.read();
    p.pass(MIN);
  }
  p.pass(-MIN);
}
const weekly = (pairs, o = {}) => pairs.map(([pct, resets]) => [row(1, { active: true, week_pct: pct, ...(resets === undefined ? {} : { week_resets_at: resets }), ...o })]);
// n readings at the same figure, a minute apart, so the rate covers 30 minutes and more
const hold = (pct, resets, n) => Array.from({ length: n }, () => [pct, resets]);

// ===== done-when 1: the burn rate =====

test('B1: burn is the sum of rises over the window\'s highest reading, in points of an account-week an hour', async () => {
  const A = newRoot();
  const p = started([A]);
  await readings(p, A, weekly([[10, JITTER[0]], [12, JITTER[0]], [11, JITTER[0]], [13, JITTER[0]], ...hold(13, JITTER[0], 37)]));
  const got = p.part();
  assert.equal(boxHealthProblem(whole(got)), null);
  assert.equal(got.answer.claude.rate_hours, 0.67, '40 minutes of readings');
  near(got.answer.claude.rate, 4.5, '2 + 1 over 40 minutes: 11 to 13 rises only 1 over the highest, 12', 0.01);
});

test('B2: reset times jittered across a minute and an hour start no new window', async () => {
  const A = newRoot();
  const p = started([A]);
  const pairs = [[50, JITTER[0]], [51, JITTER[1]], [52, JITTER[2]], [53, JITTER[3]], [54, JITTER_MINUTE[0]], [55, JITTER_MINUTE[1]]];
  await readings(p, A, weekly([...pairs, ...hold(55, JITTER[3], 25)]));
  const got = p.part();
  assert.equal(got.answer.claude.rate_hours, 0.5);
  near(got.answer.claude.rate, 10, 'each rise counts: 5 points in half an hour', 0.01);
});

test('B3: a reset time that moves forward by over an hour is a new window: its first reading adds nothing', async () => {
  const A = newRoot();
  const p = started([A]);
  const next = iso(Date.parse(JITTER[0]) + 7 * DAY), near59 = iso(Date.parse(JITTER[0]) + 59 * MIN);
  // 90 to 95 (5), a new window: 2 adds nothing, then 2 to 5 (3); a move of 59 minutes is the same window
  await readings(p, A, weekly([[90, JITTER[0]], [95, JITTER[0]], [2, next], [5, next], ...hold(5, next, 27)]));
  near(p.part().answer.claude.rate, 16, '8 points in half an hour', 0.01);
  const B = newRoot();
  const q = started([B]);
  await readings(q, B, weekly([[40, JITTER[0]], [42, near59], [43, near59], ...hold(43, near59, 28)]));
  near(q.part().answer.claude.rate, 6, 'a move under an hour keeps the window: 3 points in half an hour', 0.01);
});

test('B4: a drop inside a window adds nothing, and the rises after it count only over the highest', async () => {
  const A = newRoot();
  const p = started([A]);
  await readings(p, A, weekly([[30, JITTER[0]], [25, JITTER[0]], [28, JITTER[0]], [31, JITTER[0]], ...hold(31, JITTER[0], 27)]));
  near(p.part().answer.claude.rate, 2, 'only 30 to 31: 1 point in half an hour', 0.01);
});

test('B5: an absent reset keeps the last one seen; with none ever seen every rise counts', async () => {
  const A = newRoot();
  const p = started([A]);
  const next = iso(Date.parse(JITTER[0]) + 7 * DAY);
  // 40 to 45 (5) under JITTER[0], then a reading with no reset time, then a new window: 2 to 4 (2)
  await readings(p, A, weekly([[40, JITTER[0]], [45, undefined], [2, next], [4, next], ...hold(4, next, 27)]));
  near(p.part().answer.claude.rate, 14, '7 points in half an hour', 0.01);
  const B = newRoot();
  const q = started([B]);
  await readings(q, B, weekly([[10, undefined], [12, undefined], [9, undefined], [13, undefined], ...hold(13, undefined, 27)]));
  near(q.part().answer.claude.rate, 6, 'no reset ever seen: 10 to 12 and 12 to 13, 3 points in half an hour', 0.01);
});

test('B6: under 30 minutes of readings it is measuring: no rate and no projection, then both', async () => {
  const A = newRoot();
  const p = started([A]);
  await readings(p, A, weekly(hold(20, JITTER[0], 30)));
  let got = p.part();
  assert.equal(got.measuring, true);
  assert.equal(got.answer.claude.rate_hours, 0.48, '29 minutes');
  assert.equal(got.answer.claude.rate, undefined);
  assert.equal(got.answer.claude.projection, undefined);
  assert.equal(boxHealthProblem(whole(got)), null);
  p.pass(MIN);
  await readings(p, A, weekly(hold(20, JITTER[0], 1)));
  got = p.part();
  assert.equal(got.measuring, false);
  assert.equal(got.answer.claude.rate, 0);
  assert.equal(got.answer.claude.projection.lasts, true);
});

test('B7: points and rate_hours cover the readings held, at most six hours; a rise before them is gone', async () => {
  const A = newRoot();
  const p = started([A]);
  // a rise of 30 in the first hour, then six hours flat
  const first = Array.from({ length: 31 }, (_, i) => [20 + i, JITTER[0]]);
  await readings(p, A, weekly([...first, ...hold(50, JITTER[0], 6 * 60 + 29)]));
  let got = p.part();
  assert.equal(got.answer.claude.rate_hours, 6);
  assert.equal(got.answer.claude.points.length, 361, 'one a reading, six hours of them');
  assert.equal(got.answer.claude.points[0].at, iso(p.clock.now - 6 * HOUR));
  assert.equal(got.answer.claude.rate, 0, 'the rise is over six hours old');
  assert.equal(boxHealthProblem(whole(got)), null);
  assert.deepEqual(got.answer.claude.points.at(-1), { at: iso(p.clock.now), room: 0.5 }, 'room in accounts\' worth: half an account-week left');
});

test('B8: all time comes from ctx: readings at now(), a record\'s age by real(), and no clock or timer in the region', async () => {
  const A = newRoot();
  const p = started([A]);
  p.clock.real = T0 + 5 * DAY;
  write(A, p.clock.real - 4 * MIN, [row(1, { active: true, week_pct: 10, week_resets_at: iso(T0 + 2 * DAY) })]);
  await p.read();
  const got = p.part();
  assert.ok(got, 'a record 4 minutes old by real() is fresh, whatever now() says');
  assert.deepEqual(got.answer.claude.points, [{ at: iso(T0), room: 0.9 }], 'the reading is stamped by now()');
  const r = load().projectClaude([row(1, { active: true, week_pct: 10, week_resets_at: iso(T0 + HOUR) })], 1, T0);
  assert.equal(r.points[0].at, iso(T0), 'the projection starts at the now it is given');
  const forbidden = /\bDate\.now\b|\bnew Date\(\s*\)|\bnew Date\b(?!\s*\()|(?<!new )\bDate\(|\bperformance\b|\bhrtime\b|\bset(?:Timeout|Interval|Immediate)\b|\bAbortSignal\b|\btimers\/promises\b|\btimeout\s*:/;
  assert.doesNotMatch(regionOf('box-health-claude', src), forbidden);
});

// ===== done-when 2: the projection =====

const project = (name, s = load(), o = {}) => {
  const c = projectionCase(name);
  return s.projectClaude(o.list ?? c.list, o.rate ?? c.rate, Date.parse(c.now));
};
const at = (ms) => iso(T0 + ms);

test('P1: it steps 15 minutes, spending as cswap\'s best does: the active one to 90, the most room next, the last tenth only when none is under 90', () => {
  const r = project('best-order');
  const gaps = new Set(r.points.slice(1).map((x, i) => Date.parse(x.at) - Date.parse(r.points[i].at)));
  assert.ok([...gaps].every((g) => g % (15 * MIN) === 0), 'every point is on a 15-minute step');
  assert.deepEqual(r.switches, [
    { at: at(0), n: 1 }, { at: at(75 * MIN), n: 2 }, { at: at(13 * HOUR + 45 * MIN), n: 3 }, { at: at(23 * HOUR + 45 * MIN), n: 1 }, { at: at(26 * HOUR + 15 * MIN), n: 2 },
  ], '1 to 90, 2 (most room) to 90, 3 to 90 and its last tenth, then 1 and 2 to 100');
  assert.equal(r.lasts, false);
  assert.equal(r.runs_out_at, at(28 * HOUR + 45 * MIN));
  assert.equal(r.next_reset_at, at(3 * DAY));
  assert.equal(r.paused_until, at(3 * DAY));
});

test('P1b: an exact tie of room goes to the sooner reset of the binding window, then the earliest slot', () => {
  const s = load();
  const list = [row(1, { active: true, week_pct: 100, week_resets_at: at(3 * DAY) }), row(2, { week_pct: 95, week_resets_at: at(2 * DAY) }), row(3, { week_pct: 95, week_resets_at: at(DAY) })];
  assert.deepEqual(s.projectClaude(list, 1, T0).switches[0], { at: at(0), n: 3 }, '3 resets sooner than 2');
  const same = list.map((a) => (a.n === 3 ? { ...a, week_resets_at: at(2 * DAY) } : a));
  assert.deepEqual(s.projectClaude(same, 1, T0).switches[0], { at: at(0), n: 2 }, 'the same reset: the earliest slot');
});

test('P2: a full per-model window has no room until it resets', () => {
  const r = project('model-full');
  assert.deepEqual(r.switches.slice(0, 3), [{ at: at(0), n: 1 }, { at: at(15 * MIN), n: 3 }, { at: at(10 * HOUR + 15 * MIN), n: 2 }], '2 has the most room, but not until +2 h; 3 is then active and under 90');
  assert.equal(r.points[0].room, 0.61, '2 has no room now');
});

test('P3: a full five-hour window has no room until it resets', () => {
  const r = project('five-full');
  assert.deepEqual(r.switches.slice(0, 3), [{ at: at(0), n: 1 }, { at: at(15 * MIN), n: 3 }, { at: at(10 * HOUR + 15 * MIN), n: 2 }]);
  assert.equal(r.points[0].room, 0.61);
  const never = project('five-full', load(), { list: projectionCase('five-full').list.map((a) => (a.n === 2 ? { ...a, five_resets_at: undefined } : a)) });
  assert.ok(never.switches.every((s) => s.n !== 2), 'a full five-hour window with no reset time never has room');
});

test('P4: an account is restored at its reset', () => {
  const r = project('reset');
  assert.equal(r.points[0].room, 0);
  const two = r.points.find((x) => x.at === at(2 * HOUR));
  assert.ok(two, 'the reset is a point');
  assert.ok(two.room > 0.99, `room comes back at +2 h (${two.room})`);
  assert.equal(r.paused_until, at(2 * HOUR));
  assert.equal(r.next_reset_at, at(2 * HOUR));
});

test('P5: a stall: zero room anywhere, so it does not last; runs_out_at is when', () => {
  const r = project('stall');
  assert.equal(r.lasts, false);
  assert.equal(r.runs_out_at, at(12 * HOUR + 30 * MIN), '1 to 100 (10 hours), then 2\'s last 5 points (2.5 hours)');
  assert.equal(r.paused_until, at(2 * DAY));
  const stalled = r.points.filter((x) => Date.parse(x.at) > T0 + 12 * HOUR + 30 * MIN && Date.parse(x.at) < T0 + 2 * DAY);
  assert.ok(stalled.length && stalled.every((x) => x.room === 0), 'no room until the resets');
  const slow = project('stall', load(), { rate: 0.1 });
  assert.equal(slow.lasts, true);
  assert.equal(slow.runs_out_at, undefined);
});

test('P6: an account that can\'t be read is left out, and the projection says "at least"', () => {
  const r = project('unreadable');
  assert.equal(r.at_least, true);
  assert.ok(r.switches.every((s) => s.n === 1), 'only account 1 is spent');
  const alone = project('unreadable', load(), { list: projectionCase('unreadable').list.slice(0, 1) });
  assert.equal(alone.at_least, false);
  assert.deepEqual({ ...r, at_least: false }, alone, 'the same as with account 1 alone');
});

test('P7: tier multipliers weigh accounts when every one names one, else they weigh equally', () => {
  const r = project('tiers');
  assert.equal(r.lasts, false, '1.6 × 50 + 0.4 × 100 = 120 points at 4 an hour: 30 hours, under 35');
  assert.equal(r.runs_out_at, at(30 * HOUR));
  near(r.points[0].room, 1.2, 'room in average accounts');
  const list = projectionCase('tiers').list.map((a) => (a.n === 2 ? { ...a, tier: undefined } : a));
  const equal = project('tiers', load(), { list });
  assert.equal(equal.lasts, true, 'weighed equally: 150 points, 37.5 hours');
});

test('P8: at most 400 points: the first, the last and every change of direction, then evenly', () => {
  const r = project('long');
  assert.ok(r.points.length <= 400 && r.points.length >= 399, `${r.points.length} points`);
  assert.equal(r.points[0].at, at(0));
  assert.equal(r.points.at(-1).at, at(7 * DAY - HOUR));
  for (const t of [DAY, 3 * DAY]) assert.ok(r.points.some((x) => x.at === at(t)), `the reset at ${at(t)} is a point`);
  assert.ok(r.points.every((x, i) => i === 0 || Date.parse(x.at) > Date.parse(r.points[i - 1].at)), 'in time order');
});

test('P8b: at any rate every point is whole and the resets are kept, low rates too', () => {
  const s = load();
  // 600 points that turn at each of the first k, so 390 to 402 are kept before the even fill: at 399
  // one is left to pick
  for (let k = 388; k <= 400; k++) {
    const pts = Array.from({ length: 600 }, (_, i) => ({ at: at(i * 15 * MIN), room: i <= k ? i % 2 : k % 2 }));
    let thin;
    assert.doesNotThrow(() => { thin = s.claudeThin(pts); }, `thinning ${k} turns`);
    assert.ok(thin.length <= 400 && thin.every((x) => x && typeof x.at === 'string'), `a point that is not one with ${k} turns`);
  }
  const c = projectionCase('long');
  for (let i = 0; i <= 40; i++) {
    const rate = Number((0.1 + i * 0.0097).toFixed(4));
    const r = s.projectClaude(c.list, rate, T0);
    assert.ok(r.points.length <= 400, `${r.points.length} points at ${rate}`);
    assert.ok(r.points.every((x) => x && typeof x.at === 'string' && Number.isFinite(x.room)), `a point that is not one at ${rate}`);
    for (const t of [DAY, 3 * DAY]) assert.ok(r.points.some((x) => x.at === at(t)), `the reset at ${at(t)} is a point at ${rate}`);
  }
  const r = s.projectClaude(c.list, 0.1186, T0);
  assert.ok(r.points.every((x) => x && typeof x.at === 'string'), 'the rate spec-1 found');
});

test('P9: safe_rate is the highest rate that lasts, to 0.1; absent when not even 0.1 does', () => {
  const s = load();
  const c = projectionCase('best-order');
  const safe = s.claudeSafeRate(c.list, Date.parse(c.now));
  assert.ok(Number.isInteger(Math.round(safe * 10)) && Math.abs(safe * 10 - Math.round(safe * 10)) < 1e-9, `${safe} is to 0.1`);
  assert.equal(s.projectClaude(c.list, safe, Date.parse(c.now)).lasts, true);
  assert.equal(s.projectClaude(c.list, Math.round(safe * 10 + 1) / 10, Date.parse(c.now)).lasts, false);
  const full = projectionCase('reset');
  assert.equal(s.claudeSafeRate(full.list, Date.parse(full.now)), undefined, 'every account full now');
});

test('P10: the part sends the projection with safe_rate, its points at most 400, and boxHealthProblem accepts it', async () => {
  const A = newRoot();
  const p = started([A]);
  const c = projectionCase('long');
  await readings(p, A, Array.from({ length: 31 }, (_, i) => c.list.map((a) => (a.n === 1 ? { ...a, week_pct: 50 + i * 0.1 } : a))));
  const got = p.part();
  const pr = got.answer.claude.projection;
  assert.ok(pr.points.length <= 400, `${pr.points.length} points sent`);
  assert.equal(typeof pr.safe_rate, 'number');
  assert.equal(pr.lasts, got.projection.lasts);
  assert.equal(got.safe_rate, pr.safe_rate, 'safe_rate is handed on to the parts after it');
  assert.equal(boxHealthProblem(whole(got)), null);
});

test('P11: a reset already past restores the account now; rate 0 lasts with every account full; has_room says none', async () => {
  const s = load();
  const past = projectionCase('stall').list.map((a) => ({ ...a, week_resets_at: at(-HOUR) }));
  const r = s.projectClaude(past, 2, T0);
  assert.ok(r, 'a record whose resets are past still projects: they were restored now, the next a week on');
  assert.equal(r.points[0].room, 2, 'both restored at now');
  const full = projectionCase('reset');
  const z = s.projectClaude(full.list, 0, T0);
  assert.deepEqual([z.lasts, z.runs_out_at], [true, undefined]);
  const A = newRoot();
  const p = started([A], s);
  write(A, T0, full.list);
  await p.read();
  assert.equal(p.part().has_room, false);
});

// ===== done-when 3: the record =====

test('R1: the freshest record with a list wins', async () => {
  const [A, B, C] = [newRoot(), newRoot(), newRoot()];
  const p = started([A, B, C]);
  write(A, T0 - 2 * MIN, [row(1, { label: 'older', week_pct: 10 })]);
  write(B, T0 - 1 * MIN, [row(1, { label: 'freshest with a list', week_pct: 20 })]);
  write(C, T0 - 30000, undefined);
  await p.read();
  assert.equal(p.part().answer.claude.accounts[0]?.label, 'freshest with a list', 'an older kit\'s record, fresher, has no list and doesn\'t win');
});

test('R2: one over 5 minutes old is dropped', async () => {
  const [A, B] = [newRoot(), newRoot()];
  const p = started([A, B]);
  write(A, T0 - 6 * MIN, [row(1, { week_pct: 10 })]);
  await p.read();
  assert.equal(p.part(), undefined, 'claude is absent');
  p.pass(MIN);
  write(B, p.clock.real - 4 * MIN, [row(1, { label: 'fresh', week_pct: 10 })]);
  await p.read();
  assert.equal(p.part().answer.claude.accounts[0].label, 'fresh');
  const [C, D] = [newRoot(), newRoot()];
  const q = started([C, D]);
  write(C, T0 + 6 * MIN, [row(1, { label: 'ahead', week_pct: 10 })]);
  write(D, T0 - MIN, [row(1, { label: 'fresh too', week_pct: 10 })]);
  await q.read();
  assert.equal(q.part()?.answer.claude.accounts[0].label, 'fresh too', 'one 6 minutes ahead is dropped and hides nothing');
  const E = newRoot();
  const e = started([E]);
  write(E, T0 + 6 * MIN, [row(1, { week_pct: 10 })]);
  await e.read();
  assert.equal(e.part(), undefined, 'alone, one ahead leaves claude absent');
});

test('R7: with the roots gone after a read, claude is absent at the next read', async () => {
  const A = newRoot();
  const p = started([A]);
  write(A, T0, [row(1, { week_pct: 10 })]);
  await p.read();
  assert.ok(p.part());
  p.setRoots([]);
  p.pass(MIN);
  await p.read();
  assert.equal(p.part(), undefined);
});

test('R3: with no cswap claude is absent', async () => {
  const A = newRoot();
  const p = started([A]);
  fs.writeFileSync(accountsFile(A), JSON.stringify({ at: iso(T0), cswap: false }));
  await p.read();
  assert.equal(p.part(), undefined);
  const B = newRoot();
  const q = started([B]);
  await q.read();
  assert.equal(q.part(), undefined, 'no record at all');
});

test('R4: no email appears in the answer: a label that is an address is "Account n", and no other field is copied', async () => {
  const A = newRoot();
  const p = started([A]);
  const list = [
    { ...row(1, { week_pct: 10, label: 'someone@example.com' }), email: 'someone@example.com', token: 'sk-ant-made-up' },
    row(2, { week_pct: 20, label: 'wide＠example.com' }),
    row(3, { week_pct: 30, label: 'Spare' }),
  ];
  write(A, T0, list, { email: 'someone@example.com' });
  await p.read();
  const got = p.part();
  const text = JSON.stringify(got);
  assert.doesNotMatch(text, /[@＠]|example|sk-ant/);
  assert.deepEqual(got.answer.claude.accounts.map((a) => a.label), ['Account 1', 'Account 2', 'Spare']);
  assert.equal(boxHealthProblem(whole(got)), null);
});

test('R5: at most two reads are out at once; a read that can\'t start keeps the last value', async () => {
  const roots = [newRoot(), newRoot(), newRoot()];
  const s = load();
  const p = started(roots, s);
  roots.forEach((r, i) => write(r, T0, [row(1, { label: `L${i}`, week_pct: 10 })]));
  await p.read();
  assert.equal(p.part().answer.claude.accounts[0].label, 'L0');
  for (const r of roots) s.hang.add(r);
  p.pass(MIN);
  roots.forEach((r, i) => write(r, p.clock.real, [row(1, { label: `M${i}`, week_pct: 10 })]));
  const before = s.opened();
  // the 2 s race: each timeout fires as it is set, so a hung read is late at once
  const timeouts = () => p.timers.filter((t) => t.kind === 'timeout' && !t.ended && !t.fired);
  const reading = p.read();
  for (let i = 0; i < 20; i++) { await new Promise((r) => setImmediate(r)); for (const t of timeouts()) { t.fired = true; t.fn(); } }
  await reading;
  assert.equal(s.opened() - before, 2, 'two reads started; the third could not');
  assert.equal(s.pending(), 2);
  assert.ok(p.said.some((w) => /two file reads are out/.test(w)));
  assert.equal(p.part().answer.claude.accounts[0].label, 'L0', 'the last values stand');
  s.release();
});

test('R6: the answer\'s accounts: enabled ones, at most 40, left as 100 less used', async () => {
  const A = newRoot();
  const p = started([A]);
  const list = Array.from({ length: 45 }, (_, i) => row(i + 1, { week_pct: 30, five_pct: 20, week_resets_at: iso(T0 + DAY), five_resets_at: iso(T0 + HOUR) }));
  list[0].disabled = true;
  write(A, T0, list);
  await p.read();
  const acc = p.part().answer.claude.accounts;
  assert.equal(acc.length, 40);
  assert.equal(acc[0].n, 2, 'a disabled account is left out');
  const B = newRoot();
  const q = started([B]);
  write(B, T0, [row(1, { week_pct: 10 }), row(1, { label: 'again', week_pct: 90 }), row(0, { week_pct: 5 }), row(2, { week_pct: 20 })]);
  await q.read();
  assert.deepEqual(q.part().rows.map((a) => [a.n, a.week_pct]), [[1, 10], [2, 20]], 'the first of a repeated n, and no n of 0');
  assert.deepEqual(acc[0], { n: 2, label: 'Account 2', active: false, week_left: 70, five_left: 80, week_resets_at: iso(T0 + DAY), five_resets_at: iso(T0 + HOUR), status: 'ok' });
});
