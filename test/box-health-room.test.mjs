// The hub's room part (kit-844): how many more workers the box could hold and what limits it, and the
// what-if for every worker count up to 20 more. The region runs here alone, beside the box-memory,
// contract, sampler and claude regions it builds on, fed made-up parts as the sampler and the parts
// before it give them; nothing is read from disk and nothing asks this machine's hub. Every project,
// account and figure is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SCRIPT, checks, regionOf } from './fixtures/box-health/contract/check.mjs';

const src = fs.readFileSync(SCRIPT, 'utf8');
const { boxHealthProblem, poolProblem } = checks(src);
// a time far from the machine's clock: every time in the answer is ctx.now()'s
const T0 = Date.parse('2031-03-04T05:00:00.000Z');
const MIN = 60000, HOUR = 3600000;
const iso = (ms) => new Date(ms).toISOString();

// Every use of fs, path, Buffer or process by the regions after they load is counted: the part reads,
// writes and sends nothing.
function load() {
  const touched = [];
  const trap = (name, real) => new Proxy(real, { get: (o, k) => { if (trapOn) touched.push(`${name}.${String(k)}`); return o[k]; } });
  let trapOn = false;
  const names = { fs: trap('fs', fs), path: trap('path', { join: (...a) => a.join('/') }), Buffer: trap('Buffer', Buffer), process: trap('process', { env: {}, pid: 1, memoryUsage: { rss: () => 1 } }) };
  // projectClaude is the claude region's; each call the room part makes to it is counted
  const code = `'use strict';\n${['box-memory', 'box-health-contract', 'box-health-sampler', 'box-health-claude', 'box-health-room'].map((n) => regionOf(n, src)).join('\n')}\nconst real = projectClaude; let calls = 0;\nprojectClaude = (...a) => { calls++; return real(...a); };\nreturn { boxHealthRoom, projectClaude: real, calls: () => calls };`;
  const got = new Function(...Object.keys(names), code)(...Object.values(names));
  trapOn = true;
  return { ...got, touched };
}

// One account: 50 points of its week used, the week resetting in 10 hours, no five-hour use. It spends
// to 90, then its last tenth: 50 points in 10 hours, so a rate of 5 or less lasts.
const rows = (o = {}) => [{ n: 1, label: 'Account 1', active: true, disabled: false, status: 'ok', week_pct: 50, week_resets_at: iso(T0 + 10 * HOUR), five_pct: 0, models_full: [], ...o }];
// parts.claude as the claude part gives it
const claude = (rate, o = {}) => ({ rows: rows(), rate, measuring: false, projection: { lasts: rate <= 5, ...(rate <= 5 ? {} : { runs_out_at: iso(T0 + HOUR) }), points: [] }, has_room: true, ...o });
// a worker of a pool.json: measured with its Claude hour in new tokens (dollars = new / 1e5), or not
const tok = (nw, o = {}) => ({ state: 'measured', new: 1000, cached: 0, points: [], usd_hour: nw / 1e5, new_hour: nw, ...o });
const unmeasured = (o = {}) => ({ state: 'not-measured', reason: 'no-reader', ...o });
const reviews = (nw) => ({ reviews_usd_hour: nw / 1e5, reviews_new_hour: nw });
const worker = (name, tokens) => ({ name, phase: 'build', since: iso(T0), tokens });
function file(workers, other, o = {}) {
  const f = { v: 1, at: iso(T0), hour_end: iso(T0), ready: 0, planners: 0, goals: [], workers, recent: [], other: { usd_hour: other / 1e5, new_hour: other }, ...o };
  assert.equal(poolProblem(f), null, 'the fixture is a pool@1 file');
  return f;
}
// parts.pool as the pool part gives it: projects with their files, ready, ready_unknown
const pool = (files, o = {}) => ({
  answer: {}, projects: files.map((f, i) => ({ root: `/r/p${i}`, name: `p${i}`, port: 4321 + i, dashboard: 'up', mode: 'run', fresh: true, ready: f.ready, pool: f })),
  ready: files.reduce((s, f) => s + f.ready, 0), ready_unknown: [], ...o,
});
// one walk of the processes part: sessions (worktree places with an agent), and more places
const GB = 2 ** 30;
const walk = (at, sessions, o = {}) => ({
  at, over_s: 15,
  places: [
    ...sessions.map((s, i) => ({ root: '/r/p0', project: 'p0', worktree: s.worktree ?? `kit-${i}`, n: 3, agents: s.agents ?? 1, cpu: s.cpu, rss: s.rss, tests: { n: 0, cpu: 0, rss: 0 }, own: { n: 0, cpu: 0, rss: 0 } })),
    ...(o.places ?? []),
  ],
  outside: { n: 1, agents: 0, cpu: o.outside ?? 0, rss: 0 },
  ...(o.unattributed === undefined ? {} : { unattributed: { cpu: o.unattributed } }),
  strays: [],
});
// the sampler's reading and samples
const reading = (o = {}) => ({ cpu: { limit: 12, used: 2, some60: 1, ...o.cpu }, memory: { used: 20 * GB, max: 64 * GB, available: 44 * GB, ceiling: 0.8, ...o.memory } });
const samples = (t, cpus) => cpus.map(([ago, cpu]) => ({ at: iso(t - ago), cpu }));

// A started part with a clock; tick(parts) calls part() at the clock's time.
function started() {
  const s = load();
  const clock = { t: T0 };
  const ctx = { now: () => clock.t, real: () => { throw new Error('real() is not the forecast\'s clock'); } };
  s.boxHealthRoom.start(ctx);
  return { s, ctx, clock, tick: (parts) => s.boxHealthRoom.part(ctx, parts) };
}
// the part after five minutes of walks, every 15 s, each the same sessions; then one tick with parts
function measured(sessions, parts = {}, o = {}) {
  const p = started();
  let procs;
  for (let t = T0 - 5 * MIN; t <= T0; t += 15000) {
    p.clock.t = t;
    procs = walk(t, sessions, o);
    p.tick({ processes: procs, now: reading(), samples: [] });
  }
  p.clock.t = T0;
  return { ...p, got: p.tick({ processes: procs, now: reading(), samples: samples(T0, [[0, 2]]), ...parts }) };
}
// the answer it joins, checked against box-health@1 (with the sections it needs)
function accepted(got) {
  const a = got.answer;
  const whole = { v: 1, at: iso(T0), window_s: 3600, now: {}, samples: got.sample ? [{ at: iso(T0), ...got.sample }] : [], headroom: a.headroom };
  if (a.pool) whole.pool = { projects: [], allocated: [], recent: [], ...a.pool };
  assert.equal(boxHealthProblem(whole), null, 'box-health@1 accepts it');
}
const head = (got) => got.answer.headroom;
const whatIf = (got) => got.answer.pool?.what_if;
const tokenFields = (steps) => steps.filter((s) => Object.keys(s).some((k) => k !== 'workers')).length;

// ===== done-when 1: memory, CPU and Claude room; starts and binds =====

test('R1 memory: (ceiling × max − in use) ÷ the 75th percentile of a session\'s memory; only worktrees with an agent are sessions', () => {
  // sessions of 1, 2, 3 and 4 GB: the 75th percentile (nearest rank) is 3 GB; (0.8 × 64 − 20) ÷ 3 = 10.4
  const extra = [
    { root: '/r/p0', project: 'p0', n: 9, agents: 1, cpu: 0, rss: 40 * GB, tests: { n: 0, cpu: 0, rss: 0 }, own: { n: 0, cpu: 0, rss: 0 } },
    { root: '/r/p0', project: 'p0', worktree: 'idle', n: 1, agents: 0, cpu: 0, rss: 40 * GB, tests: { n: 0, cpu: 0, rss: 0 }, own: { n: 0, cpu: 0, rss: 0 } },
  ];
  const { got } = measured([1, 2, 3, 4].map((g) => ({ rss: g * GB, cpu: 0.5 })), {}, { places: extra });
  accepted(got);
  assert.equal(head(got).memory, 10, 'a supervisor (no worktree) and a worktree with no agent are no session');
  const planner = measured([{ rss: GB, cpu: 0.5 }, { rss: 4 * GB, cpu: 0.5, worktree: 'plan-x' }]).got;
  assert.equal(head(planner).memory, 7, "a planner's worktree is a session: the 75th percentile of 1 and 4 GB is 4, 31.2 ÷ 4");
});

test('R2 CPU: (90% of the limit − the last minute\'s mean) ÷ a session\'s mean CPU, scaled by total over attributed; 0 at 40% pressure', () => {
  // sessions of 0.5 and 1.5 cores: mean 1; attributed 2 + outside 1 = 3, unattributed 1.5: × 1.5, so 1.5 a session
  const s = [{ rss: GB, cpu: 0.5 }, { rss: GB, cpu: 1.5 }];
  const p = measured(s, {}, { outside: 1, unattributed: 1.5 });
  // samples of the last minute: 2 and 4 (mean 3); one 2 minutes ago of 11 is left out. (10.8 − 3) ÷ 1.5 = 5.2
  const got = p.tick({ processes: walk(T0, s, { outside: 1, unattributed: 1.5 }), now: reading(), samples: samples(T0, [[2 * MIN, 11], [30000, 2], [0, 4]]) });
  accepted(got);
  assert.equal(head(got).cpu, 5, 'scaled for unattributed work, over the last minute');
  const unscaled = measured(s).tick({ processes: walk(T0, s), now: reading(), samples: samples(T0, [[30000, 2], [0, 4]]) });
  assert.equal(head(unscaled).cpu, 7, 'with no unattributed work: (10.8 − 3) ÷ 1 = 7.8');
  const pressed = p.tick({ processes: walk(T0, s, { outside: 1, unattributed: 1.5 }), now: reading({ cpu: { some60: 40 } }), samples: samples(T0, [[0, 0]]) });
  assert.equal(head(pressed).cpu, 0, 'zero when tasks waited for CPU 40% of the last minute');
  const under = p.tick({ processes: walk(T0, s, { outside: 1, unattributed: 1.5 }), now: reading({ cpu: { some60: 39.9 } }), samples: samples(T0, [[0, 0]]) });
  assert.equal(head(under).cpu, 7, 'under 40% it is measured: 10.8 ÷ 1.5 = 7.2');
});

test('R3 five minutes of walks: memory, CPU and the what-if wait for them, and a walk over five minutes old is dropped', () => {
  const p = started();
  const P = pool([file([worker('a', tok(1000))], 1000, { ready: 3 })]);
  let got;
  for (let t = T0 - 5 * MIN + 15000; t <= T0; t += 15000) {
    p.clock.t = t;
    got = p.tick({ processes: walk(t, [{ rss: GB, cpu: 1 }]), now: reading(), samples: samples(t, [[0, 2]]), pool: P });
  }
  assert.deepEqual([head(got).memory, head(got).cpu, whatIf(got)], [undefined, undefined, undefined], '4 min 45 s of walks: nothing yet');
  p.clock.t = T0 + 15000;
  got = p.tick({ processes: walk(T0 + 15000, [{ rss: GB, cpu: 1 }]), now: reading(), samples: samples(T0 + 15000, [[0, 2]]), pool: P });
  assert.equal(head(got).memory, 31, 'five minutes: (51.2 − 20) ÷ 1 GB');
  assert.equal(whatIf(got).now, 1, 'and the what-if');
  // a big session in the first walks only: once those are over five minutes old it no longer counts
  const q = started();
  for (let t = T0 - 10 * MIN; t <= T0; t += 15000) {
    q.clock.t = t;
    got = q.tick({ processes: walk(t, [{ rss: (t < T0 - 6 * MIN ? 30 : 1) * GB, cpu: 1 }]), now: reading(), samples: samples(t, [[0, 2]]) });
  }
  assert.equal(head(got).memory, 31, 'the 30 GB walks are over five minutes old');
});

test('R4 no session: memory and CPU are absent (nothing to measure from), and so are the what-if\'s full counts; with no /proc no what-if', () => {
  const P = pool([file([], 1000, { ready: 2 })]);
  const { got } = measured([], { pool: P, claude: claude(4) });
  accepted(got);
  assert.deepEqual([head(got).memory, head(got).cpu], [undefined, undefined], 'nothing to measure from');
  assert.deepEqual([whatIf(got).memory_full_at, whatIf(got).cpu_full_at], [undefined, undefined]);
  // Claude doesn't limit it either (it lasts): no room, so nothing to compare ready to (spec-1 F1-3)
  assert.deepEqual([head(got).claude_why, 'room' in head(got), 'starts' in head(got), 'binds' in head(got), got.sample], ['lasts', false, false, false, undefined], 'no room: no starts, no binds, no sample room');
  const p = started();
  let none;
  for (let t = T0 - 6 * MIN; t <= T0; t += 15000) { p.clock.t = t; none = p.tick({ now: reading(), samples: samples(t, [[0, 2]]), pool: P, claude: claude(4) }); }
  assert.deepEqual([head(none).memory, head(none).cpu, whatIf(none)], [undefined, undefined, undefined], 'no walks: no memory, CPU or what-if');
});

test('R5 room is the least; binds names it, or ready when every fleet is known and ready is under room; starts only with every fleet known', () => {
  // memory 31 (1 GB sessions), CPU (10.8 − 2) ÷ 1 = 8, Claude absent (no cswap)
  const s = [{ rss: GB, cpu: 1 }];
  let got = measured(s, { pool: pool([file([], 0, { ready: 20 })]) }).got;
  accepted(got);
  assert.deepEqual([head(got).room, head(got).binds, head(got).starts, got.sample], [8, 'cpu', 8, { room: 8 }], 'CPU sets room; ready 20 is not under it');
  got = measured(s, { pool: pool([file([], 0, { ready: 3 })]) }).got;
  assert.deepEqual([head(got).room, head(got).binds, head(got).starts], [8, 'ready', 3], 'ready under room binds');
  got = measured(s, { pool: pool([file([], 0, { ready: 3 })], { ready_unknown: ['gone'] }) }).got;
  accepted(got);
  assert.deepEqual([head(got).room, head(got).binds, 'starts' in head(got)], [8, 'cpu', false], 'an unknown fleet: no starts, and binds is what set room');
  const big = [{ rss: 10 * GB, cpu: 0.1 }];
  got = measured(big, { pool: pool([file([], 0, { ready: 9 })]) }).got;
  assert.deepEqual([head(got).memory, head(got).room, head(got).binds], [3, 3, 'memory'], 'memory sets it: 31.2 ÷ 10');
  // o 1000, m 1000, now 1, rate 2: burn 1 + W lasts to 4 workers, 3 more
  got = measured(s, { pool: pool([file([worker('a', tok(1000))], 1000, { ready: 9 })]), claude: claude(2) }).got;
  assert.deepEqual([head(got).claude, head(got).room, head(got).binds], [3, 3, 'claude'], 'Claude sets it: 4 last, now 1');
});

// ===== done-when 2 and 3: one rule for the what-if and the Claude limit =====

// o 1000, one worker of 1000 at now 3 (m 1000): burn(W) = 4 × (1 + W) ÷ 4 = 1 + W; it lasts to W 4
const three = () => pool([file([worker('a', tok(1000)), worker('b', tok(500, reviews(500))), worker('c', tok(1000))], 1000, { ready: 9 })]);

test('C1 with a forecast: the limit is most_that_lasts − now; none when the top step lasts; 0 when no step does; 0 with no account with room', () => {
  const s = [{ rss: GB, cpu: 0.1 }];
  let got = measured(s, { pool: three(), claude: claude(4) }).got;
  accepted(got);
  assert.equal(whatIf(got).most_that_lasts, 4, 'burn 1 + W lasts to 4 workers');
  assert.equal(head(got).claude, 1, '4 − 3');
  assert.equal(tokenFields(whatIf(got).steps), 24, 'every step has its forecast');
  // a rate of 0.2: 0.05 × (1 + W), the top step (23) burns 1.2: it lasts
  got = measured(s, { pool: three(), claude: claude(0.2) }).got;
  accepted(got);
  assert.deepEqual([head(got).claude, head(got).claude_why, whatIf(got).most_that_lasts], [undefined, 'lasts', 23], 'the top step lasts: no Claude limit');
  // a rate of 24: 6 × (1 + W); even 0 workers burn 6
  got = measured(s, { pool: three(), claude: claude(24) }).got;
  accepted(got);
  assert.deepEqual([head(got).claude, 'most_that_lasts' in whatIf(got)], [0, false], 'no step lasts: 0');
  // a rate of 8 with 3 workers: 2 × (1 + W), lasts to W 1, under now: 0, not below
  got = measured(s, { pool: three(), claude: claude(8) }).got;
  assert.deepEqual([head(got).claude, whatIf(got).most_that_lasts], [0, 1], 'never below 0');
  got = measured(s, { pool: three(), claude: claude(0.2, { has_room: false }) }).got;
  accepted(got);
  assert.equal(head(got).claude, 0, 'no account with room: 0, whatever the forecast');
});

test('C2 with no forecast: the why, the steps with no token fields, and the limit by the projection', () => {
  const s = [{ rss: GB, cpu: 0.1 }];
  const cases = [
    ['no cswap', {}, 'no-cswap', undefined, 'no-cswap'],
    ['measuring', { claude: claude(undefined, { measuring: true, projection: undefined }) }, 'measuring', undefined, 'measuring'],
    ['no projection', { claude: claude(4, { projection: undefined }) }, 'no-projection', undefined, 'no-projection'],
    // a step with no projection while the claude part has one: the limit follows that projection (spec-1 F1-5)
    ['no reset ahead for a step, it lasts', { claude: claude(4, { rows: rows({ week_resets_at: undefined }) }) }, 'no-projection', undefined, 'lasts'],
    ['no reset ahead for a step, it runs out', { claude: claude(6, { rows: rows({ week_resets_at: undefined }) }) }, 'no-projection', 0, undefined],
  ];
  for (const [name, parts, why, n, cwhy] of cases) {
    const got = measured(s, { pool: three(), ...parts }).got;
    accepted(got);
    assert.deepEqual([whatIf(got).why, whatIf(got).steps.length, tokenFields(whatIf(got).steps), head(got).claude, head(got).claude_why], [why, 24, 0, n, cwhy], name);
  }
  // 61 workers: no steps at all; the limit by the projection
  const many = pool([file(Array.from({ length: 60 }, (_, i) => worker(`w${i}`, tok(1000))), 1000, { ready: 0 }), file([worker('x', tok(1000))], 0, { ready: 0 })]);
  let got = measured(s, { pool: many, claude: claude(6) }).got;
  assert.deepEqual([whatIf(got).now, whatIf(got).why, 'steps' in whatIf(got), head(got).claude], [61, 'too-many', false, 0], 'too many: it runs out, so 0');
  accepted(got);
  got = measured(s, { pool: many, claude: claude(4) }).got;
  assert.deepEqual([head(got).claude, head(got).claude_why], [undefined, 'lasts'], 'too many: it lasts, so no limit');
  // too many, and the limit still says no Claude use, or none by workers (spec-1 F1-2)
  const codex = pool([file(Array.from({ length: 60 }, (_, i) => worker(`w${i}`, tok(0))), 1000, { ready: 0 }), file([worker('x', tok(0))], 0, { ready: 0 })]);
  got = measured(s, { pool: codex, claude: claude(6) }).got;
  assert.deepEqual([whatIf(got).why, head(got).claude, head(got).claude_why], ['too-many', undefined, 'none-by-workers'], '61 Codex workers: absent');
  const quiet = pool([file(Array.from({ length: 60 }, (_, i) => worker(`w${i}`, tok(0))), 0, { ready: 0 }), file([worker('x', unmeasured())], 0, { ready: 0 })]);
  got = measured(s, { pool: quiet, claude: claude(6) }).got;
  assert.deepEqual([whatIf(got).why, head(got).claude, head(got).claude_why], ['too-many', undefined, 'no-claude-use'], '61 workers and no Claude use: absent');
  accepted(got);
});

test('F1 design review F7-2: three pools with room and a projection that runs out, none with token fields in its steps, each saying why', () => {
  const s = [{ rss: GB, cpu: 0.1 }];
  // a Codex-only pool beside a Claude supervisor: workers measured at 0 Claude use
  const codex = pool([file([worker('a', tok(0)), worker('b', tok(0))], 2000, { ready: 1 })]);
  let got = measured(s, { pool: codex, claude: claude(6) }).got;
  accepted(got);
  assert.deepEqual([whatIf(got).why, tokenFields(whatIf(got).steps), head(got).claude, head(got).claude_why], ['none-by-workers', 0, undefined, 'none-by-workers'], 'Codex-only: absent');
  // an hour with no Claude use at all
  const quiet = pool([file([worker('a', tok(0)), worker('b', unmeasured())], 0, { ready: 1 })]);
  got = measured(s, { pool: quiet, claude: claude(6) }).got;
  accepted(got);
  assert.deepEqual([whatIf(got).why, tokenFields(whatIf(got).steps), head(got).claude, head(got).claude_why], ['no-claude-use', 0, undefined, 'no-claude-use'], 'no Claude use: absent');
  // unmeasured workers beside a Claude supervisor
  const blind = pool([file([worker('a', unmeasured()), worker('b', unmeasured())], 2000, { ready: 1 })]);
  got = measured(s, { pool: blind, claude: claude(6) }).got;
  accepted(got);
  assert.deepEqual([whatIf(got).why, tokenFields(whatIf(got).steps), head(got).claude, 'claude_why' in head(got)], ['none-measured', 0, 0, false], 'unmeasured: 0');
  // the same with a projection that lasts: absent, for it lasts
  got = measured(s, { pool: blind, claude: claude(4) }).got;
  assert.deepEqual([head(got).claude, head(got).claude_why], [undefined, 'lasts'], 'unmeasured, and it lasts: absent');
});

// ===== done-when 4: burn at W, the steps, the full counts =====

// every step is the projection at R × (o + m·W) ÷ (o + m·now): its runs_out_at says the rate it was given
function stepsAre(p, got, R, o, m, now, msg) {
  const steps = whatIf(got).steps;
  assert.deepEqual(steps.map((x) => x.workers), Array.from({ length: now + 21 }, (_, i) => i), `${msg}: 0 to now + 20`);
  for (const x of steps) {
    const want = p.s.projectClaude(rows(), x.workers === now ? R : (R * (o + m * x.workers)) / (o + m * now), T0);
    assert.deepEqual(x, { workers: x.workers, lasts: want.lasts, ...(want.runs_out_at ? { runs_out_at: want.runs_out_at } : {}), ...(want.paused_until ? { paused_until: want.paused_until } : {}) }, `${msg}: step ${x.workers}`);
  }
  const atNow = p.s.projectClaude(rows(), R, T0);
  assert.equal(steps[now].runs_out_at, atNow.runs_out_at, `${msg}: burn at now is R`);
}

test('B1 burn at W is R × (o + m·W) ÷ (o + m·now), and R at now: plain, with an unmeasured worker, a reviewer and a mixed pool', () => {
  const s = [{ rss: GB, cpu: 0.1 }];
  // rate 20: every step runs out, each at its own time
  let p = measured(s, { pool: pool([file([worker('a', tok(3000)), worker('b', tok(1000))], 2000, { ready: 1 })]), claude: claude(20) });
  accepted(p.got);
  stepsAre(p, p.got, 20, 2000, 2000, 2, 'plain');
  // an unmeasured worker is taken as average; its reviewers count in neither
  p = measured(s, { pool: pool([file([worker('a', tok(2000)), worker('b', unmeasured(reviews(9000)))], 2000, { ready: 1 })]), claude: claude(20) });
  stepsAre(p, p.got, 20, 2000, 2000, 2, 'an unmeasured worker');
  assert.deepEqual([whatIf(p.got).measured, whatIf(p.got).now], [1, 2], 'from 1 of 2 workers');
  // a worker's reviewers are its own
  p = measured(s, { pool: pool([file([worker('a', tok(1000, reviews(2000))), worker('b', tok(1000))], 2000, { ready: 1 })]), claude: claude(20) });
  stepsAre(p, p.got, 20, 2000, 2000, 2, 'a reviewer running');
  // a Codex worker is measured at 0 and counts in m
  p = measured(s, { pool: pool([file([worker('a', tok(4000)), worker('b', tok(0))], 2000, { ready: 1 })]), claude: claude(20) });
  stepsAre(p, p.got, 20, 2000, 2000, 2, 'a mixed pool');
  // prices: by dollars when every one has a price, else new tokens (a null price makes it new_hour)
  p = measured(s, { pool: pool([file([worker('a', tok(1000, { usd_hour: null })), worker('b', tok(3000))], 2000, { ready: 1 })]), claude: claude(20) });
  stepsAre(p, p.got, 20, 2000, 2000, 2, 'one with no price: new tokens');
});

test('B2 steps run 0 to now + 20, 81 at most, and over 60 workers none; memory_full_at and cpu_full_at are now + room + 1; no cswap, no token fields', () => {
  const s = [{ rss: GB, cpu: 1 }];
  const sixty = pool([file(Array.from({ length: 60 }, (_, i) => worker(`w${i}`, tok(1000))), 1000, { ready: 0 })]);
  let got = measured(s, { pool: sixty, claude: claude(0.1) }).got;
  accepted(got);
  assert.deepEqual([whatIf(got).now, whatIf(got).steps.length, whatIf(got).steps.at(-1).workers], [60, 81, 80], '60 workers: 81 steps');
  got = measured(s, { pool: pool([file([worker('a', tok(1000)), worker('b', tok(1000))], 1000, { ready: 0 })]) }).got;
  // memory 31, CPU (10.8 − 2) ÷ 1 = 8, now 2
  assert.deepEqual([whatIf(got).memory_full_at, whatIf(got).cpu_full_at], [34, 11], 'now + room + 1');
  assert.deepEqual([whatIf(got).steps.length, tokenFields(whatIf(got).steps), whatIf(got).why], [23, 0, 'no-cswap'], 'no cswap: steps with no token fields');
  accepted(got);
});

// ===== done-when 5: nothing written, stored or sent; time from ctx =====

test('N1 nothing is read, written or sent; every time is ctx.now()\'s; the same object while nothing changed', () => {
  const region = regionOf('box-health-room', src);
  assert.doesNotMatch(region, /\bfs\.|\bnet\.|\bhttp|\bfetch\(|child_process|\bspawn|\bexec(File)?(Sync)?\(|process\.|\bwriteFile|localStorage/, 'the region names no file, socket, child or environment');
  assert.doesNotMatch(region, /\bDate\.now\b|\bnew Date\b|(?<!new )\bDate\(|\bperformance\b|\bhrtime\b|\bset(?:Timeout|Interval|Immediate)\b|\bctx\.(real|every|after|timeout)\b/, 'no clock but ctx.now(), no timer');
  const p = measured([{ rss: GB, cpu: 0.1 }], { pool: three(), claude: claude(20) });
  assert.deepEqual(p.s.touched, [], 'nothing of fs, path, Buffer or process is touched while it runs');
  const step = whatIf(p.got).steps[3];
  assert.equal(step.runs_out_at, p.s.projectClaude(rows(), 20, T0).runs_out_at, 'its times are from ctx.now() (2031), not the machine\'s clock');
  const parts = { processes: walk(T0, [{ rss: GB, cpu: 0.1 }]), now: reading(), samples: samples(T0, [[0, 2]]), pool: three(), claude: claude(20) };
  const a = p.tick(parts), b = p.tick({ ...parts, now: reading(), samples: samples(T0, [[0, 2]]) });
  assert.equal(a, b, 'the same object while nothing in it changed');
  const c = p.tick({ ...parts, now: reading({ memory: { used: 30 * GB } }) });
  assert.notEqual(c, a, 'a new one when something did');
  p.s.boxHealthRoom.stop();
  assert.equal(p.tick(parts), undefined, 'stopped: nothing');
});

test('N2 the forecast is worked out again only for a new parts.claude or new hours, never for a new pool object alone (spec-1 F1-1)', () => {
  const p = measured([{ rss: GB, cpu: 0.1 }], { pool: three(), claude: claude(20) });
  const base = { processes: walk(T0, [{ rss: GB, cpu: 0.1 }]), now: reading(), samples: samples(T0, [[0, 2]]) };
  const c = claude(20);
  p.tick({ ...base, pool: three(), claude: c });
  const n = p.s.calls();
  // the pool part gives a new object each walk: the same hours are no change
  for (let i = 0; i < 4; i++) p.tick({ ...base, pool: three(), claude: c });
  assert.equal(p.s.calls(), n, 'four new pool objects with the same hours: no projection');
  const more = pool([file([worker('a', tok(1000)), worker('b', tok(500, reviews(500))), worker('c', tok(2000))], 1000, { ready: 9 })]);
  const got = p.tick({ ...base, pool: more, claude: c });
  assert.equal(p.s.calls(), n + 24, 'new hours: 24 steps again');
  assert.notEqual(whatIf(got).most_that_lasts, undefined);
  p.tick({ ...base, pool: more, claude: claude(20) });
  assert.equal(p.s.calls(), n + 48, 'a new parts.claude: again');
});
