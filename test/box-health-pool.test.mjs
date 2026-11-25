// The hub's pool part (kit-842): every project's run/cache/pool.json (pool@1) read and joined with
// each worker's CPU, memory and disk, over fixture pool files (test/fixtures/box-health/pool) and fake
// processes and disk parts. The region runs here with only the names it reads given to it, beside the
// box-memory, contract and sampler regions it builds on; a fake ctx drives its reads, so no timer
// fires by itself and nothing asks this machine's hub. A slow dashboard is a local server that takes
// connections and never answers; a gone one is a port nothing listens on.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { checks, regionOf } from './fixtures/box-health/contract/check.mjs';
import { projectRoot, place, processes, disk } from './fixtures/box-health/pool/fake-parts.mjs';
import { kit } from './lib/kit.mjs';

const { boxHealthProblem } = checks();
const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-boxpool-'));
const servers = [];
after(() => {
  for (const s of servers) s.close();
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
let dirs = 0;
const newDir = () => { const d = path.join(scratch, `d${++dirs}`); fs.mkdirSync(d); return d; };
const T0 = Date.parse('2026-11-25T12:00:00.000Z');
const MIN = 60000;
const iso = (ms) => new Date(ms).toISOString();
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''}: ${a} is not ${b}`);

function load() {
  const proc = { env: {}, pid: 4242, memoryUsage: { rss: () => 1 } };
  const hang = new Set(), held = [];
  const promises = new Proxy(fs.promises, { get: (o, k) => (k !== 'open' ? o[k] : (p, ...a) => ([...hang].some((h) => String(p).includes(h)) ? new Promise((res) => held.push(res)).then(() => o.open(p, ...a)) : o.open(p, ...a))) });
  const ffs = new Proxy(fs, { get: (o, k) => (k === 'promises' ? promises : o[k]) });
  const names = { fs: ffs, path, net, Buffer, process: proc };
  const code = `'use strict';\n${['box-memory', 'box-health-contract', 'box-health-sampler', 'box-health-pool'].map((n) => regionOf(n, src)).join('\n')}\nreturn { boxHealthPool };`;
  return { ...new Function(...Object.keys(names), code)(...Object.values(names)), hang, pending: () => held.length, release: () => { hang.clear(); held.splice(0).forEach((res) => res()); } };
}
// a port that takes connections and never answers (a slow dashboard), and one that refuses them
const slowPort = () => new Promise((res) => {
  const s = net.createServer((c) => { c.on('error', () => {}); });
  servers.push(s);
  s.listen(0, '127.0.0.1', () => res(s.address().port));
});
const closedPort = () => new Promise((res) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});
// The part started with a fake ctx: read() runs the 15 s interval as it fires, with the roots and the
// hellos the test gives; part(parts) is a tick's call.
function started(list, hellos = [], s = load(), late = null) {
  const clock = { now: T0, real: T0 }, timers = [], said = [], state = { list, hellos };
  const ctx = {
    now: () => clock.now, real: () => clock.real,
    every: (ms, fn) => { const t = { kind: 'every', ms, fn }; timers.push(t); return () => { t.ended = true; }; },
    after: (ms, fn) => { const t = { kind: 'after', ms, fn }; timers.push(t); return () => { t.ended = true; }; },
    timeout: (ms, fn) => {
      const t = { kind: 'timeout', ms, fn }; timers.push(t);
      // late 'knock': the 1 s a connection is given fires at once, before any connection settles;
      // late n: every timeout fires after n real ms
      if (late === 'knock' && ms === 1000) queueMicrotask(() => { if (!t.ended) fn(); });
      else if (typeof late === 'number') setTimeout(() => { if (!t.ended) fn(); }, late);
      return () => { t.ended = true; };
    },
    turn: async () => {},
    roots: () => state.list, ceiling: () => 0.8, scan: async () => state.hellos,
    proc: '/nowhere', cgroup: '/nowhere', stopped: () => false, say: (w) => said.push(String(w)),
  };
  s.boxHealthPool.start(ctx);
  assert.deepEqual(timers.map((t) => [t.kind, t.ms]), [['every', 15000]], 'start sets one 15 s interval and reads nothing');
  const every = timers[0];
  return {
    s, ctx, clock, said, state, stop: () => s.boxHealthPool.stop(),
    read: () => every.fn(),
    pass: (ms) => { clock.now += ms; clock.real += ms; },
    part: (parts = {}) => s.boxHealthPool.part(ctx, parts),
  };
}
const hello = (root, name, port, mode = 'run') => ({ devteam: 1, root, name, port, fleet: { mode } });
// the whole answer the sampler would send with this part's sections in it
const whole = (got) => ({ v: 1, at: iso(T0), window_s: 3600, now: {}, samples: [], pool: got.answer.pool, headroom: got.answer.headroom });
const row = (got, name, port) => got.answer.pool.allocated.find((a) => a.name === name && (port === undefined || a.port === port));
const proj = (got, name, port) => got.answer.pool.projects.find((p) => p.name === name && (port === undefined || p.port === port));

// ===== done-when 1: the answer's pool, joined =====

test('W1a: the pool is accepted by boxHealthProblem: projects (the whole project\'s cpu and rss), allocated, recent, others and strays', async () => {
  const A = projectRoot(newDir(), { file: 'shop' });
  const p = started([{ root: A, name: 'shop' }], [hello(A, 'shop', 4321)]);
  assert.equal(p.part(), undefined, 'nothing before the first read');
  await p.read();
  const strays = [{ project: 'shop', kind: 'browser', why: 'parent-gone', n: 2, oldest_s: 900, rss: 300, cpu: 0.1 }];
  const procs = processes([
    place(A, 'shop', undefined, { n: 3, agents: 1, cpu: 0.3, rss: 100 }),
    place(A, 'shop', 'shop-1-api', { n: 4, agents: 1, cpu: 0.5, rss: 200, tests: { n: 1, cpu: 0.2, rss: 50 } }),
    place(A, 'shop', 'plan-orders', { n: 1, agents: 1, cpu: 0.1, rss: 30 }),
    place(A, 'shop', 'shop-2-ui', { n: 1, agents: 1, cpu: 0.05, rss: 20 }),
    place(A, 'shop', 'shop-3-docs', { n: 1, agents: 0, cpu: 0.6, rss: 0 }),
    place('/elsewhere', 'other', 'x-1', { n: 1, agents: 1, cpu: 9, rss: 9000 }),
  ], { strays });
  const got = p.part({ processes: procs, disk: disk([[A, 'shop-1-api', 5000, '2026-11-25T11:50:00Z'], [A, 'shop-2-ui', undefined, '2026-11-25T11:51:00Z']]) });
  assert.equal(boxHealthProblem(whole(got)), null);
  const pr = got.answer.pool.projects;
  assert.equal(pr.length, 1);
  const { cpu, ...rest } = pr[0];
  assert.deepEqual(rest, { name: 'shop', port: 4321, at: '2026-11-25T11:59:00Z', workers: 3, planners: 1, cap: 4, ready: 2, rss: 350 }, 'rss is every place under its root');
  near(cpu, 1.55, 'cpu is every place under its root: worktrees, planner and supervisor');
  assert.deepEqual(got.answer.pool.allocated.map((a) => a.name), ['shop-3-docs', 'shop-1-api', 'shop-2-ui'], 'most CPU first, not the file\'s order');
  const api = row(got, 'shop-1-api');
  assert.deepEqual(api, {
    project: 'shop', port: 4321, name: 'shop-1-api', title: 'The API answers', phase: 'build', since: '2026-11-25T10:00:00Z',
    agent: true, cpu: 0.5, rss: 200, tests: { n: 1, cpu: 0.2, rss: 50 }, disk: 5000, disk_at: '2026-11-25T11:50:00Z',
    tokens: { state: 'measured', new: 900000, cached: 8000000, points: api.tokens.points, reviews_new: 120000, per_hour: 300000 },
    points: [{ at: iso(T0), cpu: 0.5, rss: 200, disk: 5000 }],
  }, 'joined by root and worktree; pool@1\'s new_hour is per_hour and its prices are left out');
  assert.equal(api.tokens.points.length, 12);
  assert.deepEqual(row(got, 'shop-2-ui').disk_at, '2026-11-25T11:51:00Z');
  assert.equal(row(got, 'shop-2-ui').disk, undefined, 'a du that stopped gives no disk');
  assert.deepEqual(row(got, 'shop-3-docs').tokens, { state: 'not-measured', reason: 'no-reader', reviews_new: 5000 });
  assert.deepEqual(got.answer.pool.recent, [{ project: 'shop', port: 4321, name: 'shop-0-old', title: 'The old page goes', left_at: '2026-11-25T11:00:00Z', why: 'merged', tokens: { state: 'measured', new: 400000, cached: 3000000, points: got.answer.pool.recent[0].tokens.points } }], 'one left over 24 hours ago is not recent; no last for a worker this hub never saw');
  const o = got.answer.pool.others;
  assert.ok(o, 'others are there with /proc');
  assert.deepEqual({ ...o, planners: { ...o.planners, cpu: 0 }, supervisors: { ...o.supervisors, cpu: 0 } }, { planners: { n: 1, cpu: 0, rss: 30 }, supervisors: { n: 1, cpu: 0, rss: 100 }, outside: { n: 2, cpu: 0.2, rss: 1000 }, unattributed: { cpu: 0.4 } });
  near(o.planners.cpu, 0.1, 'planners'); near(o.supervisors.cpu, 0.3, 'supervisors');
  assert.deepEqual(got.answer.pool.strays, strays, "the walk's strays, as they are");
  assert.deepEqual(got.answer.headroom, { ready: 2 });
  // read again only after a minute, or when the roots are a new list
  const file = path.join(A, 'docs/devteam/run/cache/pool.json');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"ready": 2', '"ready": 3'));
  p.pass(30000); await p.read();
  assert.equal(p.part({ processes: procs }).answer.headroom.ready, 2, 'not read again within a minute');
  p.state.list = [...p.state.list]; await p.read();
  assert.equal(p.part({ processes: procs }).answer.headroom.ready, 3, 'read again for a new list of roots');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"ready": 3', '"ready": 2'));
  assert.notEqual(p.part({ processes: procs }), got, "a changed part makes a new object");
});

test('W1b: recent has the last CPU, memory and disk this hub saw of the worker, and none after a restart', async () => {
  const A = projectRoot(newDir(), { file: 'shop' });
  const procs = processes([place(A, 'shop', 'shop-1-api', { agents: 1, cpu: 0.5, rss: 200 })]);
  const d = disk([[A, 'shop-1-api', 5000, '2026-11-25T11:50:00Z']]);
  const p = started([{ root: A, name: 'shop' }], [hello(A, 'shop', 4321)]);
  await p.read();
  p.part({ processes: procs, disk: d });
  // its agent exits while the file still lists it: the walk sees nothing there now
  p.pass(MIN);
  assert.equal(row(p.part({ processes: processes([]), disk: d }), 'shop-1-api').rss, 0);
  // the slot ends: the next file has it in recent
  const next = JSON.parse(fs.readFileSync(path.join(A, 'docs/devteam/run/cache/pool.json'), 'utf8'));
  const [api] = next.workers.splice(0, 1);
  next.at = '2026-11-25T12:00:30Z';
  next.recent.unshift({ name: api.name, title: api.title, left_at: '2026-11-25T12:00:20Z', why: 'done', tokens: { state: 'measured', new: 1, cached: 1, points: [] } });
  fs.writeFileSync(path.join(A, 'docs/devteam/run/cache/pool.json'), JSON.stringify(next));
  p.pass(MIN);
  await p.read();
  const got = p.part({ processes: processes([]), disk: disk([]) });
  assert.deepEqual(got.answer.pool.recent[0].last, { cpu: 0.5, rss: 200, disk: 5000 }, 'the use last seen while it ran, not the empty worktree after');
  assert.equal(got.answer.pool.recent[0].name, 'shop-1-api', 'newest first');
  assert.equal(boxHealthProblem(whole(got)), null);
  // a hub that stops and starts again (a hand-over that failed) keeps nothing of the stopped run
  p.stop();
  const q = started([{ root: A, name: 'shop' }], [hello(A, 'shop', 4321)], p.s);
  q.pass(MIN);
  await q.read();
  assert.equal(q.part({ processes: processes([]) }).answer.pool.recent[0].last, undefined);
});

test('W1c: across projects, allocated keeps the 60 with most CPU and recent the 20 newest, so the pool is still accepted', async () => {
  const big = (tag, minute) => {
    const o = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures/box-health/pool/shop.json'), 'utf8'));
    o.workers = Array.from({ length: 40 }, (_, i) => ({ name: `${tag}-w${i}`, phase: 'build', tokens: { state: 'none-yet' } }));
    o.recent = Array.from({ length: 15 }, (_, i) => ({ name: `${tag}-r${i}`, left_at: iso(T0 - (2 * i + minute) * MIN), why: 'merged', tokens: { state: 'not-measured' } }));
    return JSON.stringify(o);
  };
  const A = projectRoot(newDir(), { text: big('a', 1) });
  const B = projectRoot(newDir(), { text: big('b', 2) });
  const p = started([{ root: A, name: 'a' }, { root: B, name: 'b' }], [hello(A, 'a', 4321), hello(B, 'b', 4322)]);
  await p.read();
  // CPU rises with i: in each project, w39 most
  const places = [A, B].flatMap((root, j) => Array.from({ length: 40 }, (_, i) => place(root, 'x', `${'ab'[j]}-w${i}`, { agents: 1, cpu: i + j / 2, rss: 1 })));
  const got = p.part({ processes: processes(places) });
  assert.equal(boxHealthProblem(whole(got)), null);
  const al = got.answer.pool.allocated;
  assert.equal(al.length, 60, 'at most 60 allocated');
  assert.deepEqual([al[0].name, al.at(-1).name], ['b-w39', 'a-w10'], 'the 60 with most CPU');
  const rc = got.answer.pool.recent;
  assert.equal(rc.length, 20, 'at most 20 recent');
  assert.deepEqual(rc.slice(0, 4).map((x) => x.name), ['a-r0', 'b-r0', 'a-r1', 'b-r1'], 'newest first across projects');
  assert.equal(rc.at(-1).name, 'b-r9', 'the 20 newest');
});

// ===== done-when 2: stale, parked, drained, gone, slow, refused =====

test('W2a: a file over 15 minutes old keeps its rows, marked by at, and its ready counts for nothing and is in ready_unknown', async () => {
  const S = projectRoot(newDir(), { file: 'stale' });
  const A = projectRoot(newDir(), { file: 'shop' });
  const p = started([{ root: S, name: 'stale' }, { root: A, name: 'shop' }], [hello(S, 'stale', 4322), hello(A, 'shop', 4321)]);
  await p.read();
  let got = p.part();
  assert.equal(boxHealthProblem(whole(got)), null);
  assert.equal(proj(got, 'stale').at, '2026-11-25T11:40:00Z');
  assert.equal(proj(got, 'stale').ready, undefined, 'a stale file\'s ready counts for nothing');
  assert.ok(row(got, 'stale-1-job'), 'its rows stay');
  assert.deepEqual(got.answer.headroom, { ready: 2, ready_unknown: ['stale'] });
  assert.deepEqual([got.ready, got.ready_unknown], [2, ['stale']]);
  // a fresh file turns stale with time alone, between two points a minute apart too
  p.pass(13 * MIN + 30000);
  assert.deepEqual(p.part().answer.headroom, { ready: 2, ready_unknown: ['stale'] }, 'shop at 14.5 minutes is fresh');
  p.pass(45000);
  got = p.part();
  assert.deepEqual(got.answer.headroom, { ready: 0, ready_unknown: ['stale', 'shop'] });
});

test('W2b: a parked or drained project is ready 0, whatever its file\'s age', async () => {
  const P = projectRoot(newDir(), { file: 'stale' });
  const D = projectRoot(newDir(), { file: 'shop' });
  const p = started([{ root: P, name: 'parked' }, { root: D, name: 'drained' }], [hello(P, 'parked', 4322, 'park'), hello(D, 'drained', 4321, 'drain')]);
  await p.read();
  const got = p.part();
  assert.equal(proj(got, 'parked').ready, 0);
  assert.equal(proj(got, 'drained').ready, 0);
  assert.deepEqual(got.answer.headroom, { ready: 0 });
  assert.equal(boxHealthProblem(whole(got)), null);
  p.pass(MIN);
  assert.equal(p.part(), got, 'a minute with no point to add (no walk, no du): the same object');
});

test('W2c: a refused connection isn\'t counted and a timed-out dashboard is (F3-2)', async () => {
  const gone = await closedPort(), slow = await slowPort();
  const N = projectRoot(newDir(), { file: 'shop', port: gone });
  const W = projectRoot(newDir(), { file: 'shop', port: slow });
  const p = started([{ root: N, name: 'gone' }, { root: W, name: 'slow' }], []);
  await p.read();
  let got = p.part();
  assert.equal(boxHealthProblem(whole(got)), null);
  assert.equal(proj(got, 'gone').ready, undefined, 'no dashboard: not counted');
  assert.equal(proj(got, 'gone').port, undefined);
  assert.equal(proj(got, 'slow').ready, 2, 'a dashboard that takes the connection and doesn\'t answer is slow, and counted');
  assert.equal(proj(got, 'slow').port, slow);
  assert.deepEqual(got.answer.headroom, { ready: 2 }, 'the gone one is not unknown either');
  // one that answered before and is slow now keeps that hello's port and mode
  const L = projectRoot(newDir(), { file: 'shop' });
  const q = started([{ root: L, name: 'late' }], [hello(L, 'late', slow, 'drain')]);
  await q.read();
  q.state.hellos = [];
  q.pass(MIN);
  await q.read();
  got = q.part();
  assert.deepEqual([proj(got, 'late').port, proj(got, 'late').ready], [slow, 0]);
  const by = got.projects.find((x) => x.name === 'late');
  assert.deepEqual([by.dashboard, by.mode], ['slow', 'drain']);
  // its old port now another project's dashboard: it has none, and is not counted with the other's port
  const X = projectRoot(newDir(), { file: 'shop', port: slow });
  const Y = projectRoot(newDir(), { file: 'shop' });
  const u = started([{ root: X, name: 'moved' }, { root: Y, name: 'taker' }], [hello(Y, 'taker', slow)]);
  await u.read();
  got = u.part();
  assert.deepEqual([proj(got, 'moved').port, proj(got, 'moved').ready], [undefined, undefined], "a port another project's hello holds is not this project's");
  assert.deepEqual(got.answer.headroom, { ready: 2 });
  // no answer to the connection within 1 s is slow too, and counted
  const Z = projectRoot(newDir(), { file: 'shop', port: gone });
  const v = started([{ root: Z, name: 'unanswered' }], [], load(), 'knock');
  await v.read();
  assert.deepEqual([proj(v.part(), 'unanswered').port, proj(v.part(), 'unanswered').ready], [gone, 2], 'a connection with no answer in 1 s is a slow dashboard');
});

test('W2d: a file poolProblem refuses, or none, makes the project unknown, with no rows of its own', async () => {
  const B = projectRoot(newDir(), { file: 'bad' });
  const M = projectRoot(newDir());
  const p = started([{ root: B, name: 'bad' }, { root: M, name: 'missing' }], [hello(B, 'bad', 4321), hello(M, 'missing', 4322)]);
  await p.read();
  const got = p.part({ processes: processes([place(B, 'bad', 'bad-1-x', { agents: 1, cpu: 1, rss: 10 })]) });
  assert.equal(boxHealthProblem(whole(got)), null);
  assert.deepEqual(got.answer.pool.allocated, []);
  assert.deepEqual(proj(got, 'bad'), { name: 'bad', port: 4321, cpu: 1, rss: 10 });
  assert.deepEqual(got.answer.headroom, { ready: 0, ready_unknown: ['bad', 'missing'] });
  assert.equal(got.projects.find((x) => x.name === 'bad').pool, null);
});

test('W2e: a pool.json read that hangs costs only its project: the others are read, and it is not asked again until it settles', { timeout: 20000 }, async () => {
  const H = projectRoot(path.join(newDir(), 'hung'), { file: 'shop' });
  const A = projectRoot(newDir(), { file: 'shop' });
  const s = load();
  s.hang.add(`${path.sep}hung${path.sep}`);
  const p = started([{ root: H, name: 'hung' }, { root: A, name: 'shop' }], [hello(H, 'hung', 4322), hello(A, 'shop', 4321)], s, 30);
  await p.read();
  let got = p.part();
  assert.deepEqual(got.answer.headroom, { ready: 2, ready_unknown: ['hung'] }, 'the hung one is unknown, the other read');
  assert.ok(p.said.some((w) => /did not answer within 2 s/.test(w)));
  p.pass(MIN); await p.read();
  assert.deepEqual(p.part().answer.headroom, { ready: 2, ready_unknown: ['hung'] }, 'still out: the others still read');
  assert.equal(s.pending(), 1, 'one read of it out, not asked again');
  s.release();
  await new Promise((res) => setTimeout(res, 50));
  p.pass(MIN); await p.read();
  got = p.part();
  assert.deepEqual(got.answer.headroom, { ready: 4 }, 'read once it settled');
});

// ===== done-when 3: agent, points, no /proc =====

test('W3a: agent is false when the walk sees no agent in the worktree', async () => {
  const A = projectRoot(newDir(), { file: 'shop' });
  const p = started([{ root: A, name: 'shop' }], [hello(A, 'shop', 4321)]);
  await p.read();
  const got = p.part({ processes: processes([place(A, 'shop', 'shop-1-api', { agents: 1, cpu: 0.1, rss: 5 }), place(A, 'shop', 'shop-2-ui', { agents: 0, n: 3, cpu: 0.2, rss: 5 })]) });
  assert.deepEqual(['shop-1-api', 'shop-2-ui', 'shop-3-docs'].map((n) => row(got, n).agent), [true, false, false], 'no agent, and no process at all');
  assert.deepEqual([row(got, 'shop-3-docs').cpu, row(got, 'shop-3-docs').rss], [0, 0]);
});

test('W3b: each worker keeps 60 one-minute points, and the same object comes back while nothing changed', async () => {
  const A = projectRoot(newDir(), { file: 'shop' });
  const p = started([{ root: A, name: 'shop' }], [hello(A, 'shop', 4321)]);
  await p.read();
  let got;
  for (let i = 0; i <= 61; i++) {
    const procs = processes([place(A, 'shop', 'shop-1-api', { agents: 1, cpu: i / 100, rss: i })]);
    got = p.part({ processes: procs });
    assert.equal(p.part({ processes: procs }), got, 'nothing changed: the same object');
    p.pass(MIN);
  }
  const pts = row(got, 'shop-1-api').points;
  assert.equal(pts.length, 60);
  assert.deepEqual(pts.at(-1), { at: iso(T0 + 61 * MIN), cpu: 0.61, rss: 61 });
  assert.equal(pts[0].at, iso(T0 + 2 * MIN), 'an hour of them');
  // a worker that leaves the pool loses its points: back, it starts again
  const file = path.join(A, 'docs/devteam/run/cache/pool.json'), text = fs.readFileSync(file, 'utf8');
  const o = JSON.parse(text); o.workers = o.workers.slice(1); fs.writeFileSync(file, JSON.stringify(o));
  const back = processes([place(A, 'shop', 'shop-1-api', { agents: 1, cpu: 0.1, rss: 1 })]);
  await p.read(); p.part({ processes: back });
  fs.writeFileSync(file, text);
  p.pass(MIN); await p.read();
  assert.equal(row(p.part({ processes: back }), 'shop-1-api').points.length, 1, 'its points went when it left');
  assert.ok(pts.every((x, i) => i === 0 || Date.parse(x.at) - Date.parse(pts[i - 1].at) === MIN), 'one a minute');
  assert.equal(boxHealthProblem(whole(got)), null);
});

test('W3c: without /proc the pool has slots, phases, disk and tokens, and no CPU, memory, tests, strays, others or agent', async () => {
  const A = projectRoot(newDir(), { file: 'shop' });
  const p = started([{ root: A, name: 'shop' }], [hello(A, 'shop', 4321)]);
  await p.read();
  const got = p.part({ disk: disk([[A, 'shop-1-api', 5000, '2026-11-25T11:50:00Z']]) });
  assert.equal(boxHealthProblem(whole(got)), null);
  assert.deepEqual(got.answer.pool.projects, [{ name: 'shop', port: 4321, at: '2026-11-25T11:59:00Z', workers: 3, planners: 1, cap: 4, ready: 2 }]);
  const api = row(got, 'shop-1-api');
  assert.deepEqual(Object.keys(api).sort(), ['disk', 'disk_at', 'name', 'phase', 'points', 'port', 'project', 'since', 'title', 'tokens']);
  assert.deepEqual(api.points, [{ at: iso(T0), disk: 5000 }]);
  assert.equal(got.answer.pool.others, undefined);
  assert.equal(got.answer.pool.strays, undefined);
  for (const a of got.answer.pool.allocated) for (const k of ['cpu', 'rss', 'tests', 'agent']) assert.equal(a[k], undefined, `${a.name} ${k}`);
  // a first walk (no CPU yet) gives memory and no CPU; a disk_at that isn't a time is left out
  const first = p.part({ processes: processes([place(A, 'shop', 'shop-1-api', { agents: 1, rss: 7 })], { cpu: false }), disk: disk([[A, 'shop-1-api', 5000, 'yesterday']]) });
  assert.equal(boxHealthProblem(whole(first)), null);
  assert.deepEqual([row(first, 'shop-1-api').cpu, row(first, 'shop-1-api').rss, proj(first, 'shop').cpu, proj(first, 'shop').rss], [undefined, 7, undefined, 7], 'no CPU before two whole walks');
  assert.equal(row(first, 'shop-1-api').disk_at, undefined, 'a disk_at that is not a time');
});

// ===== done-when 4: ports, and two projects of one name =====

test('W4a: projects, allocated and recent rows carry the project\'s port, absent only when it has no dashboard', async () => {
  const gone = await closedPort();
  const A = projectRoot(newDir(), { file: 'shop' });
  const N = projectRoot(newDir(), { file: 'shop', port: gone });
  const p = started([{ root: A, name: 'up' }, { root: N, name: 'none' }], [hello(A, 'up', 4321)]);
  await p.read();
  const got = p.part();
  const of = (name) => [...got.answer.pool.projects, ...got.answer.pool.allocated, ...got.answer.pool.recent].filter((x) => (x.name === name && x.workers !== undefined) || x.project === name);
  assert.equal(of('up').length, 5);
  assert.ok(of('up').every((x) => x.port === 4321), 'every row of a project with a dashboard has its port');
  assert.equal(of('none').length, 5);
  assert.ok(of('none').every((x) => x.port === undefined), 'no row of a project with no dashboard has a port');
});

test('W4b: two projects of one name keep their own rows and ports', async () => {
  const A = projectRoot(newDir(), { file: 'shop' });
  const B = projectRoot(newDir(), { file: 'shop' });
  const p = started([{ root: A, name: 'shop' }, { root: B, name: 'shop' }], [hello(A, 'shop', 4321), hello(B, 'shop', 4322)]);
  await p.read();
  const got = p.part({ processes: processes([place(A, 'shop', 'shop-1-api', { agents: 1, cpu: 0.5, rss: 200 }), place(B, 'shop', 'shop-1-api', { agents: 1, cpu: 0.1, rss: 20 })]) });
  assert.equal(boxHealthProblem(whole(got)), null);
  assert.deepEqual(got.answer.pool.projects.map((x) => [x.name, x.port, x.rss]), [['shop', 4321, 200], ['shop', 4322, 20]]);
  assert.deepEqual([row(got, 'shop-1-api', 4321).cpu, row(got, 'shop-1-api', 4322).cpu], [0.5, 0.1]);
  assert.deepEqual(got.answer.pool.recent.map((x) => x.port), [4321, 4322]);
  assert.deepEqual(got.answer.headroom, { ready: 4 });
});
