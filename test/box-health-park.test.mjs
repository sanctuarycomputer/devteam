// The hub's park part (kit-843): when Claude would run out, each project's goals whose parking would
// make it last. The region runs here alone, beside the box-memory, contract and sampler regions it
// builds on, fed made-up parts.claude and parts.pool as the claude and pool parts give them; nothing
// is read from disk and nothing asks this machine's hub. Every project, goal and figure is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SCRIPT, checks, regionOf } from './fixtures/box-health/contract/check.mjs';

const src = fs.readFileSync(SCRIPT, 'utf8');
const { boxHealthProblem, poolProblem } = checks(src);
const AT = '2026-11-25T12:00:00.000Z';

function load() {
  const code = `'use strict';\n${['box-memory', 'box-health-contract', 'box-health-sampler', 'box-health-park'].map((n) => regionOf(n, src)).join('\n')}\nreturn { boxHealthPark };`;
  return new Function('fs', 'path', 'Buffer', 'process', code)(fs, null, Buffer, { env: {}, pid: 1, memoryUsage: { rss: () => 1 } }).boxHealthPark;
}
// the part, started, and one tick of it over the given parts
function park(claude, projects) {
  const p = load();
  p.start({});
  return p.part({}, { claude, pool: projects === undefined ? undefined : { projects } });
}
const parkOf = (got) => got?.answer?.claude?.park;

// parts.claude as the claude part gives it: a rate, a projection and a safe_rate
const claude = (rate, safe, o = {}) => ({ rows: [], rate, measuring: false, projection: { lasts: false, runs_out_at: AT, points: [] }, ...(safe === undefined ? {} : { safe_rate: safe }), has_room: true, ...o });
// a measured worker's tokens: its Claude hours, priced and in new tokens, and its reviewers'
const tok = (usd, nw = usd * 100000, o = {}) => ({ state: 'measured', new: 5000000, cached: 0, points: [], usd_hour: usd, new_hour: nw, ...o });
const worker = (name, goal, tokens) => ({ name, ...(goal === undefined ? {} : { goal }), phase: 'build', since: AT, tokens });
const goal = (id, priority, usd, nw = usd * 100000) => ({ id, title: `Goal ${id}`, ...(priority === undefined ? {} : { priority }), usd_hour: usd, new_hour: nw });
// a pool.json (pool@1), checked as the hub checks it
function file(goals, workers, other) {
  const f = { v: 1, at: AT, hour_end: AT, ready: 0, planners: 0, goals, workers, recent: [], other };
  assert.equal(poolProblem(f), null, 'the fixture is a pool@1 file');
  return f;
}
const other = (usd, nw = usd * 100000) => ({ usd_hour: usd, new_hour: nw });
// one of parts.pool.projects
const project = (name, port, f, fresh = true) => ({ root: `/r/${name}-${port ?? 'none'}`, name, ...(port === undefined ? {} : { port }), dashboard: port === undefined ? 'none' : 'up', mode: 'run', fresh, pool: f });
// the answer it joins, checked against box-health@1
const accepted = (got) => assert.equal(boxHealthProblem({ v: 1, at: AT, window_s: 3600, now: {}, samples: [], claude: { accounts: [{ n: 1, label: 'Account 1' }], ...got.answer.claude } }), null);
const ids = (row) => row.goals.map((g) => g.id);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} is not ${b}`);

// Rate 10 and safe_rate 7: parking a share of 0.3 or more is enough (10 × 0.7 = 7).

// ===== done-when 1: the four cases =====

test('K1 one enough: a row is enough alone; enough rows come first, fewest goals first; goals lowest priority first', () => {
  // name, share and goal-count orders all disagree: by name alpha, by share alpha, by fewest goals zulu (spec-1 F1)
  const A = file([goal('a-high', 1, 2.5), goal('a-low', 5, 2)], [worker('a1', 0, tok(2.5)), worker('a2', 1, tok(2))], other(0.5));
  const Z = file([goal('z-only', 2, 3.5)], [worker('z1', 0, tok(2.5, undefined, { reviews_usd_hour: 1, reviews_new_hour: 100000 }))], other(0.5));
  const N = file([goal('n-one', 3, 0.5)], [worker('n1', 0, tok(0.5))], other(0.5));
  const got = park(claude(10, 7), [project('alpha', 4321, A), project('nine', 4323, N), project('zulu', 4322, Z)]);
  accepted(got);
  const rows = parkOf(got);
  assert.deepEqual(rows.map((r) => [r.fleet, ids(r), r.share, r.enough]), [
    ['zulu', ['z-only'], 0.35, true],
    ['alpha', ['a-low', 'a-high'], 0.45, true],
    ['nine', ['n-one'], 0.05, false],
  ], 'total 10: zulu 3.5 enough alone; alpha parks a-low (priority 5, 2) then a-high (2.5); nine 0.5 never is');
  assert.deepEqual(rows[0].goals[0], { id: 'z-only', title: 'Goal z-only' }, 'a goal is its id and title');
});

test('K6 exactly at safe_rate is enough, whatever the float; a share over 1 is sent as 1', () => {
  // rate 9, safe_rate 6, a share of 1/3: 9 × (1 − 1/3) is 6.000000000000001 in floats
  const A = file([goal('a1', 1, 1)], [worker('a', 0, tok(1))], other(2));
  assert.deepEqual(parkOf(park(claude(9, 6), [project('alpha', 4321, A)])).map((r) => [r.share, r.enough]), [[0.3333, true]], 'at safe_rate is enough');
  // a file whose goal's hour is over the whole hour it is a view of
  const B = file([goal('b1', 1, 5)], [worker('b', 0, tok(2))], other(1));
  const got = park(claude(10, 7), [project('beta', 4321, B)]);
  accepted(got);
  assert.deepEqual(parkOf(got).map((r) => [r.share, r.enough]), [[1, true]], 'clamped to 1');
});

test('K2 together enough: no row is enough alone, and the rows come by share, larger first', () => {
  const Z = file([goal('z1', 1, 2.5)], [worker('z', 0, tok(2.5))], other(2.5));
  const A = file([goal('a1', 1, 1.5)], [worker('a', 0, tok(1.5))], other(3.5));
  const rows = parkOf(park(claude(10, 7), [project('alpha', 4321, A), project('zeta', 4322, Z)]));
  assert.deepEqual(rows.map((r) => [r.fleet, ids(r), r.share, r.enough]), [['zeta', ['z1'], 0.25, false], ['alpha', ['a1'], 0.15, false]]);
  assert.ok(10 * (1 - rows.reduce((s, r) => s + r.share, 0)) <= 7, 'all of them together are enough');
  // not enough with more goals and the larger share still comes first: by share, not fewest goals (final-1 F1)
  const A2 = file([goal('a1', 1, 1.5), goal('a2', 2, 1)], [worker('a', 0, tok(1.5)), worker('b', 1, tok(1))], other(2.5));
  const Z2 = file([goal('z1', 1, 1.5)], [worker('z', 0, tok(1.5))], other(3.5));
  const mixed = parkOf(park(claude(10, 7), [project('zeta', 4322, Z2), project('alpha', 4321, A2)]));
  assert.deepEqual(mixed.map((r) => [r.fleet, ids(r), r.share, r.enough]), [['alpha', ['a2', 'a1'], 0.25, false], ['zeta', ['z1'], 0.15, false]], 'alpha (2 goals, 0.25) before zeta (1 goal, 0.15)');
});

test('K3 not enough: every goal offered is in its row, and even all rows together are not enough', () => {
  const A = file([goal('a1', 1, 0.5), goal('a2', 2, 0.5)], [worker('a', 0, tok(0.5)), worker('b', 1, tok(0.5))], other(9));
  const rows = parkOf(park(claude(10, 7), [project('alpha', 4321, A)]));
  assert.deepEqual(rows.map((r) => [r.fleet, ids(r), r.share, r.enough]), [['alpha', ['a2', 'a1'], 0.1, false]]);
});

test('K4 no rate: with no safe_rate (none lasts) there is no park, nor while measuring or with no projection; one that lasts has nothing to park', () => {
  const A = file([goal('a1', 1, 5)], [worker('a', 0, tok(5))], other(1));
  const ps = [project('alpha', 4321, A)];
  assert.equal(park(claude(10, undefined), ps), undefined, 'no rate lasts: no park');
  assert.deepEqual(parkOf(park(claude(10, 7, { projection: { lasts: true, points: [] } }), ps)), [], 'it lasts: nothing to park');
  assert.equal(park(claude(10, 7, { projection: undefined }), ps), undefined, 'no projection');
  assert.equal(park(claude(undefined, undefined, { measuring: true, projection: undefined }), ps), undefined, 'measuring');
  assert.equal(park(undefined, ps), undefined, 'no cswap');
  assert.ok(parkOf(park(claude(10, 7), ps)).length === 1, 'the same pool with a rate has a row');
});

test('K5 within a project: one with no priority goes first, then the highest number; equal priority, larger share first', () => {
  const A = file([goal('p1', 1, 1), goal('none', undefined, 0.5), goal('p4-a-small', 4, 0.5), goal('p4-b-big', 4, 1)],
    [worker('a', 0, tok(1)), worker('b', 1, tok(0.5)), worker('c', 2, tok(0.5)), worker('d', 3, tok(1))], other(7));
  const rows = parkOf(park(claude(10, 9.99), [project('alpha', 4321, A)]));
  assert.deepEqual(ids(rows[0]), ['none'], 'the goal with no priority alone is enough at safe_rate 9.99');
  const all = parkOf(park(claude(10, 1), [project('alpha', 4321, A)]));
  assert.deepEqual(ids(all[0]), ['none', 'p4-b-big', 'p4-a-small', 'p1'], 'equal priority: the larger share first, whatever the id');
  // equal priority and share: by id, whatever the file's order (final-1 F4)
  const B = file([goal('g-b', 2, 1), goal('g-a', 2, 1)], [worker('b', 0, tok(1)), worker('a', 1, tok(1))], other(8));
  assert.deepEqual(ids(parkOf(park(claude(10, 1), [project('beta', 4321, B)]))[0]), ['g-a', 'g-b'], 'a tie on priority and share goes by id');
});

// ===== done-when 2: what a share counts =====

test('W1 Claude only: shares are the Claude hours, never a worker\'s tokens of every provider', () => {
  // b's worker ran another provider: millions of new tokens, no Claude hour
  const A = file([goal('a1', 1, 3), goal('b1', 2, 0)], [worker('a', 0, tok(3)), worker('b', 1, tok(0, 0, { new: 90000000 }))], other(7));
  const rows = parkOf(park(claude(10, 7), [project('alpha', 4321, A)]));
  assert.deepEqual(rows.map((r) => [ids(r), r.share]), [[['a1'], 0.3]], 'total 10: only a1\'s 3 Claude dollars count; b1 has no share and is not offered');
});

test('W2 usd_hour when every project has every price; new_hour across all of them when one has none', () => {
  // dollars and new tokens disagree: by dollars a1 is 3 of 10, by new tokens 1 of 10
  const A = () => file([goal('a1', 1, 3, 100000)], [worker('a', 0, tok(3, 100000))], other(7, 900000));
  const priced = parkOf(park(claude(10, 7), [project('alpha', 4321, A())]));
  assert.deepEqual(priced.map((r) => [r.share, r.enough]), [[0.3, true]], 'by usd_hour');
  for (const where of ['other', 'goal', 'worker', 'reviews']) {
    const B = file([goal('b1', 1, where === 'goal' ? null : 1, 100000)],
      [worker('b', 0, tok(where === 'worker' ? null : 1, 100000, where === 'reviews' ? { reviews_usd_hour: null, reviews_new_hour: 0 } : {}))],
      other(where === 'other' ? null : 1, 0));
    const rows = parkOf(park(claude(10, 7), [project('alpha', 4321, A()), project('beta', 4322, B)]));
    // by new_hour: alpha 100000 + 900000, beta 100000 + 0 → a1 1/11, b1 1/11
    assert.deepEqual(rows.map((r) => [r.fleet, r.share]), [['alpha', 0.0909], ['beta', 0.0909]], `a null usd_hour in ${where}: every share by new_hour`);
  }
  // the null price only in a stale file: still new_hour for all, and the stale project has no row (final-1 F3)
  const S = file([goal('s1', 1, 1, 100000)], [worker('s', 0, tok(1, 100000))], other(null, 0));
  const stale = parkOf(park(claude(10, 7), [project('alpha', 4321, A()), project('stale', 4322, S, false)]));
  assert.deepEqual(stale.map((r) => [r.fleet, r.share]), [['alpha', 0.0909]], 'a null usd_hour in a stale file: every share by new_hour');
});

test('W3 the total is the workers, their reviewers and other, once each; a goal\'s hour is not added to it', () => {
  const A = file([goal('a1', 1, 3)], [worker('a', 0, tok(2, undefined, { reviews_usd_hour: 1, reviews_new_hour: 100000 })), worker('x', undefined, tok(2))], other(3));
  // total = 2 + 1 (reviewers) + 2 (a worker of no goal) + 3 (other) = 8; a1 is 3 of 8
  const rows = parkOf(park(claude(10, 1), [project('alpha', 4321, A)]));
  assert.deepEqual(rows.map((r) => r.share), [0.375]);
  // an unmeasured worker adds nothing and is in no share
  const B = file([goal('a1', 1, 3)], [worker('a', 0, tok(3)), worker('u', 0, { state: 'not-measured', reason: 'no-reader' })], other(3));
  assert.deepEqual(parkOf(park(claude(10, 1), [project('alpha', 4321, B)])).map((r) => r.share), [0.5]);
  // a goal whose only worker isn't measured still runs: its hour (reviewers, planners) gives it a share (final-1 F4)
  const C = file([goal('u1', 1, 2)], [worker('u', 0, { state: 'not-measured', reason: 'no-reader', reviews_usd_hour: 2, reviews_new_hour: 200000 })], other(2));
  assert.deepEqual(parkOf(park(claude(10, 1), [project('gamma', 4321, C)])).map((r) => [ids(r), r.share]), [[['u1'], 0.5]], 'offered though its worker is not measured');
});

test('W4 a goal with nothing running has no row, nor a project with no fresh pool.json; a stale file\'s hour stays in the total', () => {
  // idle's hour (an ended session's) is in other; no worker names it
  const A = file([goal('busy', 1, 2), goal('idle', 9, 4)], [worker('a', 0, tok(2))], other(6));
  const S = file([goal('s1', 9, 50)], [worker('s', 0, tok(50))], other(0));
  const rows = parkOf(park(claude(10, 7), [project('alpha', 4321, A), project('stale', 4322, S, false), project('gone', 4323, null, false)]));
  assert.deepEqual(rows.map((r) => [r.fleet, ids(r), r.share]), [['alpha', ['busy'], 0.0345]], 'idle is not offered; stale and gone have no row; stale\'s 50 is in the total (58), gone has none');
  const B = file([goal('idle', 9, 4)], [worker('b', undefined, tok(2))], other(6));
  assert.deepEqual(parkOf(park(claude(10, 7), [project('beta', 4321, B)])), [], 'a project with no goal running has no row; it would run out, and nothing is offered');
  assert.deepEqual(parkOf(park(claude(10, 7), [])), [], 'no project at all');
  assert.deepEqual(parkOf(park(claude(10, 7), [project('alpha', 4321, file([goal('a', 1, 0)], [worker('a', 0, tok(0))], other(0)))])), [], 'no measured Claude use: no share');
});

test('W5 F3-3: a goal\'s share leaves out its project\'s supervisor time', () => {
  // the supervisor's 6 dollars are in other: in the total, in no goal's share
  const A = file([goal('a1', 1, 2)], [worker('a', 0, tok(2))], other(6));
  const rows = parkOf(park(claude(10, 1), [project('alpha', 4321, A)]));
  assert.deepEqual(rows.map((r) => [r.share, r.enough]), [[0.25, false]], '2 of 8, not 8 of 8');
});

// ===== done-when 3: ports =====

test('P1 each row carries its project\'s port; two projects of one name get a row each with their own', () => {
  const one = file([goal('g1', 1, 4)], [worker('a', 0, tok(4))], other(1));
  const two = file([goal('g1', 1, 3)], [worker('a', 0, tok(3))], other(1));
  const bare = file([goal('g2', 1, 1)], [worker('a', 0, tok(1))], other(0));
  // the larger share has the higher port: enough rows of one goal each go by share, not port (final-1 F2)
  const got = park(claude(10, 7), [project('app', 4321, two), project('app', 4325, one), project('bare', undefined, bare)]);
  accepted(got);
  assert.deepEqual(parkOf(got).map((r) => [r.fleet, r.port, ids(r), r.share]), [
    ['app', 4325, ['g1'], 0.4],
    ['app', 4321, ['g1'], 0.3],
    ['bare', undefined, ['g2'], 0.1],
  ], 'total 10; the port is the row\'s own; a project with no dashboard has none');
  assert.ok(!('port' in parkOf(got)[2]), 'no port key with no dashboard');
  // twins with the same share: a row each, the lower port first, in whatever order the pool gave them
  const same = () => file([goal('g1', 1, 2)], [worker('a', 0, tok(2))], other(3));
  const twins = parkOf(park(claude(10, 7), [project('app', 4325, same()), project('app', 4321, same())]));
  assert.deepEqual(twins.map((r) => [r.fleet, r.port, r.share]), [['app', 4321, 0.2], ['app', 4325, 0.2]], 'twins of one share keep their own ports, lower first');
});

// ===== the part =====

test('E1 the same object while parts.claude and parts.pool are the same; a new one when either changes', () => {
  const p = load();
  p.start({});
  const c = claude(10, 7), pool = { projects: [project('alpha', 4321, file([goal('a1', 1, 4)], [worker('a', 0, tok(4))], other(1)))] };
  const first = p.part({}, { claude: c, pool });
  assert.equal(p.part({}, { claude: c, pool }), first);
  const c2 = claude(10, 7);
  const second = p.part({}, { claude: c2, pool });
  assert.notEqual(second, first, 'a new parts.claude');
  const fewer = p.part({}, { claude: c2, pool: { projects: [] } });
  assert.notEqual(fewer, second, 'a new parts.pool (spec-1 F3)');
  assert.deepEqual(parkOf(fewer), [], 'built from the new pool');
  p.stop();
});
