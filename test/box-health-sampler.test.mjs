// The hub's box-health sampler (kit-836): the sampler region over a fake cgroup and /proc, its parts'
// places, its two clocks, and the route on a standalone hub. The region runs here with the outside
// names it reads given to it (a name it isn't given throws), or in a hub from a copy of the kit in no
// repo, as the box image's is. No test reads this machine's cgroup, /proc or projects, and where the
// sampler is on the parts are stubs or fakes, never the kit's own: those have their own test files.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PORTS, kit, until } from './lib/kit.mjs';
import { checks, regionOf } from './fixtures/box-health/contract/check.mjs';
import { CPU, CGROUP_BYTES, fakeBox } from './fixtures/box-health/sampler/fake-box.mjs';

const { boxHealthProblem } = checks();
const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
const PARTS = ['processes', 'disk', 'state', 'pool', 'claude', 'park', 'room'];
const REGIONS = PARTS.map((n) => `box-health-${n}`);
const constOf = (n) => `boxHealth${n[0].toUpperCase()}${n.slice(1)}`;
const stub = (n, f = '{ start(ctx) {}, part(ctx, parts) {}, stop() {} }') => `/* box-health-${n} start */\nconst ${constOf(n)} = ${f};\n/* box-health-${n} end */`;
const bodyOf = (name) => regionOf(name, src).replace(/^\s*\/\/.*$/gm, '');
const words = (name) => regionOf(name, src).split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join(' ').replace(/\s+/g, ' ');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `${a} … ${b}`); return src.slice(i, j); };

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-boxhealth-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
const NOWHERE = path.join(scratch, 'no-such-machine');
let dirs = 0;
const newDir = () => { const d = path.join(scratch, `d${++dirs}`); fs.mkdirSync(d); return d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN = 60000, HOUR = 3600000;
const T0 = Date.parse('2026-11-24T18:00:00.000Z');

// The sampler in this process: { health, clock, logs, timers, os, roots }. clock.t is the machine's
// time; timers are counted and never fire, so a test forces its ticks.
function load({ env = {}, port = 4320, cores = 8, roots = [], parts, realTimers = false, real, settings } = {}) {
  const logs = [], clock = { t: T0 }, timers = { set: 0, clear: 0, live: new Set(), list: [] };
  const fake = { busy: 0, all: 0 };
  const fos = {
    cpus: () => Array.from({ length: cores }, () => ({ times: { user: fake.busy, nice: 0, sys: 0, irq: 0, idle: fake.all - fake.busy } })),
    loadavg: () => [1.5, 2.5, 3.5], totalmem: () => 16e9, freemem: () => 4e9, homedir: () => NOWHERE,
  };
  const set = (kind) => (fn, ms) => { if (realTimers) { const h = (kind === 'every' ? setInterval : setTimeout)(fn, ms); timers.live.add(h); timers.set++; return h; } const h = { kind, ms, fn, unref() {} }; timers.set++; timers.live.add(h); timers.list.push(h); return h; };
  const clear = (h) => { timers.clear++; timers.live.delete(h); if (realTimers) { clearTimeout(h); clearInterval(h); } };
  const disk = { stat: async (p) => fs.promises.stat(p), statfs: async (p) => fs.promises.statfs(p) };
  const ffs = new Proxy(fs, { get: (o, k) => (k === 'promises' ? new Proxy(fs.promises, { get: (q, n) => (n === 'stat' ? (p) => disk.stat(p) : n === 'statfs' ? (p) => disk.statfs(p) : q[n]) }) : o[k]) });
  const names = {
    fs: ffs, path, os: fos, Buffer, URL, process: { env }, HUB_PORT: port, setTimeout: set('once'), clearTimeout: clear, setInterval: set('every'), clearInterval: clear, setImmediate,
    machineRepos: () => roots,
  };
  const helpers = ['readText', 'readNum'].map((n) => cut(`const ${n} = `, '\n')).join('\n');
  const memory = cut('const memoryCountsCache', 'const GiB');
  const code = `'use strict';\n${helpers}\n${memory}\n${['box-memory', 'box-health-contract', 'box-health-sampler'].map((n) => regionOf(n, src)).join('\n')}\n${PARTS.map((n) => stub(n)).join('\n')}\nreturn { boxHealth, boxHealthParts, machineMemory };`;
  const got = new Function(...Object.keys(names), code)(...Object.values(names));
  const opts = { real: real ?? (() => clock.t) };
  if (parts) opts.parts = parts;
  const health = got.boxHealth((m) => logs.push(m), settings?.scan ?? (async () => []), opts);
  return { ...got, health, clock, logs, timers, os: fos, fake, disk };
}
const answer = (health, url = '/box-health.json') => { let out; health.serve({ url }, (status, type, body) => { out = { status, type, body, json: JSON.parse(body) }; }); return out; };
// One tick, ms later by the machine's clock.
const step = async (s, ms = 5000) => { s.clock.t += ms; await s.health.tick(); };
const boxEnv = (b, more = {}) => ({ DEVTEAM_CGROUP: b.cgroup, DEVTEAM_PROC: b.proc, DEVTEAM_MEMINFO: path.join(b.proc, 'meminfo'), ...more });
const nowhere = (more = {}) => ({ DEVTEAM_CGROUP: NOWHERE, DEVTEAM_PROC: NOWHERE, DEVTEAM_MEMINFO: NOWHERE, ...more });
const ok = (a) => assert.equal(boxHealthProblem(a.body), null, a.body.slice(0, 300));

// ===== 1: the reading =====

test('S1: over a fake cgroup a forced tick gives a now and a sample the contract takes: memory, CPU, throttled and pressure', async () => {
  const b = fakeBox(newDir());
  const s = load({ env: boxEnv(b), roots: [scratch] });
  await s.health.start();
  b.cpu({ usage: CPU.usage + 30e6, periods: CPU.periods + 50, throttled: CPU.throttled + 10 });
  s.fake.all += 1000; s.fake.busy += 250;
  await step(s);
  const a = answer(s.health);
  ok(a);
  const { cpu, memory, io, disks } = a.json.now;
  assert.equal(cpu.used, 6, '30 s of CPU in 5 s');
  assert.equal(cpu.limit, 4, 'cpu.max');
  assert.equal(cpu.throttled, 0.2, '10 of 50 periods');
  assert.equal(cpu.some60, 4.5);
  assert.deepEqual(cpu.load, [1.5, 2.5, 3.5]);
  assert.equal(memory.used, s.machineMemory().inUse, 'as machineMemory() counts it');
  assert.equal(memory.used, CGROUP_BYTES.inUse);
  assert.deepEqual([memory.max, memory.available, memory.swap_used, memory.swap_max, memory.some60], [CGROUP_BYTES.max, CGROUP_BYTES.max - CGROUP_BYTES.inUse, 1048576, 2097152, 1.25]);
  assert.equal(memory.ceiling, 0.8);
  assert.deepEqual(io, { some10: 2.4, some60: 3.7, full60: 0.5 });
  assert.equal(disks.length, 1);
  const last = a.json.samples.at(-1);
  assert.equal(a.json.samples.length, 2);
  assert.deepEqual(last, { at: new Date(s.clock.t).toISOString(), cpu: 6, cpu_some: 4.5, throttled: 0.2, load: 1.5, mem: memory.used, mem_some: 1.25, swap: 1048576, disk: disks[0].free, inodes: disks[0].inodes_free, io: 3.7 });
  assert.deepEqual(s.logs, []);
});

test('S2: per-core bars and load are the host\'s (shared, load_scope) only when cpu.max is below its cores', async () => {
  const read = async (max, cores) => {
    const b = fakeBox(newDir());
    b.write('cpu.max', max);
    const s = load({ env: boxEnv(b), cores });
    await s.health.start();
    s.fake.all += 1000; s.fake.busy += 250;
    await step(s);
    ok(answer(s.health));
    return answer(s.health).json.now.cpu;
  };
  const below = await read('400000 100000', 8);
  assert.equal(below.shared, true);
  assert.equal(below.load_scope, 'host');
  assert.deepEqual(below.host_cores, Array(8).fill(0.25));
  for (const [max, cores, limit] of [['800000 100000', 8, 8], ['1600000 100000', 8, 8], ['max 100000', 8, 8]]) {
    const c = await read(max, cores);
    assert.equal(c.shared, undefined, max);
    assert.equal(c.load_scope, undefined, max);
    assert.equal(c.limit, limit, max);
    assert.deepEqual(c.host_cores, Array(8).fill(0.25), max);
  }
});

test('S3: with no cgroup and no /proc (macOS) it gives CPU, memory, disk and load only', async () => {
  const s = load({ env: nowhere(), roots: [scratch], cores: 4 });
  await s.health.start();
  s.fake.all += 1000; s.fake.busy += 500;
  await step(s);
  const a = answer(s.health);
  ok(a);
  assert.deepEqual(Object.keys(a.json.now).sort(), ['cpu', 'disks', 'memory']);
  assert.deepEqual(a.json.now.cpu, { limit: 4, used: 2, host_cores: [0.5, 0.5, 0.5, 0.5], load: [1.5, 2.5, 3.5] });
  assert.deepEqual(a.json.now.memory, { used: 12e9, max: 16e9, available: 4e9, ceiling: 0.8 });
  assert.deepEqual(Object.keys(a.json.samples.at(-1)).sort(), ['at', 'cpu', 'disk', 'inodes', 'load', 'mem']);
});

test('S4: a box\'s pressure and CPU are its cgroup\'s or absent, never the host\'s; a machine with no cgroup cap reads /proc/pressure', async () => {
  const b = fakeBox(newDir());
  for (const f of ['cpu.pressure', 'memory.pressure', 'io.pressure', 'cpu.stat', 'memory.swap.current', 'memory.swap.max']) fs.rmSync(path.join(b.cgroup, f));
  const s = load({ env: boxEnv(b) });
  await s.health.start();
  s.fake.all += 1000; s.fake.busy += 500;
  await step(s);
  const n = answer(s.health).json.now;
  assert.deepEqual([n.cpu.some60, n.memory.some60, n.io, n.cpu.used, n.cpu.throttled, n.memory.swap_used, n.memory.swap_max], Array(7).fill(undefined));
  const h = fakeBox(newDir());
  for (const f of fs.readdirSync(h.cgroup)) if (f !== 'cpu.stat') fs.rmSync(path.join(h.cgroup, f));
  const l = load({ env: boxEnv(h), cores: 4 });
  await l.health.start();
  l.fake.all += 1000; l.fake.busy += 500;
  await step(l);
  const m = answer(l.health);
  ok(m);
  assert.deepEqual([m.json.now.cpu.some60, m.json.now.memory.some60, m.json.now.io, m.json.now.cpu.used], [71, 72, { some10: 60, some60: 73, full60: 74 }, 2]);
  assert.deepEqual([m.json.now.memory.swap_used, m.json.now.memory.swap_max], [1024 * 1024, 4096 * 1024]);
});

test('S5: the first tick has no rate, and a counter that fell or a clock set back gives none, never a negative one', async () => {
  const b = fakeBox(newDir());
  const s = load({ env: boxEnv(b) });
  await s.health.start();
  const cpu = () => answer(s.health).json.now.cpu;
  assert.deepEqual([cpu().used, cpu().throttled, cpu().host_cores], [undefined, undefined, undefined]);
  assert.equal(cpu().limit, 4);
  b.cpu({ usage: 1, periods: 1, throttled: 0 });
  await step(s);
  assert.deepEqual([cpu().used, cpu().throttled], [undefined, undefined]);
  b.cpu({ usage: 5e6, periods: 1, throttled: 0 });
  await step(s);
  assert.equal(cpu().throttled, 0, 'no period in between, none held');
  b.cpu({ usage: 9e6, periods: 2, throttled: 1 });
  await step(s, 0);
  assert.deepEqual([cpu().used, cpu().throttled], [undefined, undefined], 'a clock that did not move');
  await step(s, -20000);
  assert.deepEqual([cpu().used, cpu().throttled, cpu().host_cores], [undefined, undefined, undefined], 'a clock set back');
  ok(answer(s.health));
  const at = answer(s.health).json.samples.map((x) => x.at);
  assert.deepEqual(at, [...at].sort(), 'oldest first');
  assert.equal(at.at(-1), new Date(s.clock.t).toISOString());
});

// ===== 2: the route, the ring =====

test('S6: the ring keeps an hour and at most 720 samples', async () => {
  let seen;
  const s = load({ env: nowhere(), parts: [['state', { start() {}, part: (c, p) => { seen = p.samples; }, stop() {} }]] });
  await s.health.start();
  // closer than 5 s, so the bound is met before the hour is
  for (let i = 0; i < 730; i++) await step(s, 4000);
  const all = answer(s.health).json.samples;
  assert.equal(all.length, 720);
  assert.equal(Date.parse(all.at(-1).at), s.clock.t);
  ok(answer(s.health));
  for (let i = 0; i < 5; i++) await step(s, 20 * MIN);
  assert.deepEqual(seen.map((x) => s.clock.t - Date.parse(x.at)), [40 * MIN, 20 * MIN, 0], 'nor given to a part');
  const few = answer(s.health).json.samples.map((x) => s.clock.t - Date.parse(x.at));
  assert.deepEqual(few, [40 * MIN, 20 * MIN, 0], 'nothing an hour old');
  s.clock.t += 2 * HOUR;
  assert.deepEqual(answer(s.health).json.samples, [], 'nor when no tick has run since');
});

test('S7: after= gives only newer samples and claude points; a bad time, a repeated or an unknown parameter is 400', async () => {
  const points = [0, 1, 2].map((i) => ({ at: new Date(T0 + i * MIN).toISOString(), room: i }));
  const s = load({ env: nowhere(), parts: [['claude', { start() {}, part: () => ({ answer: { claude: { accounts: [], points } } }), stop() {} }]] });
  await s.health.start();
  await step(s, MIN);
  await step(s, MIN);
  const at = points[1].at;
  const got = answer(s.health, `/box-health.json?after=${encodeURIComponent(at)}`);
  ok(got);
  assert.deepEqual(got.json.samples.map((x) => x.at), [points[2].at]);
  assert.deepEqual(got.json.claude.points, [points[2]]);
  assert.equal(answer(s.health).json.samples.length, 3);
  assert.deepEqual(answer(s.health).json.claude.points, points);
  for (const q of ['after=', 'after=yesterday', 'after=2026-02-30T00:00:00Z', 'after=1764000000000', 'since=1h', `since=${at}`, `after=${at}&x=1`, `after=${at}&after=${at}`]) assert.equal(answer(s.health, `/box-health.json?${q}`).status, 400, q);
});

test('S8: a sampler error is said once and leaves a gap, and the next tick samples again', async () => {
  const s = load({ env: nowhere() });
  await s.health.start();
  await step(s);
  const load1 = s.os.loadavg;
  s.os.loadavg = () => { throw new Error('no load today'); };
  await step(s);
  await step(s);
  assert.equal(s.logs.length, 1);
  assert.match(s.logs[0], /^hub: box health: sampler: a tick failed: Error\b/);
  assert.doesNotMatch(s.logs[0], /no load today/, 'the kind of error, never its message');
  assert.deepEqual(answer(s.health).json.now, {}, 'the last reading is not passed off as now');
  ok(answer(s.health));
  s.os.loadavg = load1;
  await step(s);
  assert.ok(answer(s.health).json.now.cpu);
  assert.deepEqual(answer(s.health).json.samples.map((x) => (Date.parse(x.at) - T0) / 1000), [0, 5, 20]);
  assert.equal(s.logs.length, 1);
  // ticks that stopped for a while: the reading is no longer now
  s.clock.t += 14000;
  assert.ok(answer(s.health).json.now.cpu);
  s.clock.t += 2000;
  assert.deepEqual(answer(s.health).json.now, {});
});

// ===== 3: the switch =====

test('S9: it samples with DEVTEAM_BOX_HEALTH=on, or unset on port 4320; off starts no timer and calls no part', async () => {
  for (const [v, port, want] of [['on', 4320, true], ['on', 20002, true], [undefined, 4320, true], ['', 4320, true], [undefined, 20002, false], ['off', 4320, false], ['off', 20002, false], ['1', 4320, false], ['ON', 20002, false]]) {
    const called = [];
    const env = nowhere(v === undefined ? {} : { DEVTEAM_BOX_HEALTH: v });
    const part = { start: () => called.push('start'), part: () => { called.push('part'); }, stop: () => called.push('stop') };
    const s = load({ env, port, parts: [['state', part]] });
    await s.health.start();
    assert.equal(s.health.on, want, `${v} on ${port}`);
    assert.equal(s.timers.list.filter((x) => x.kind === 'every').length > 0, want, `${v} on ${port}: timers`);
    if (!want) assert.equal(s.timers.set, 0, `${v} on ${port}`);
    s.health.stop();
    assert.deepEqual(called, want ? ['start', 'part', 'stop'] : [], `${v} on ${port}`);
  }
  // the sampler's own words on the switch
  assert.match(words('box-health-sampler'), /The switch is the port, as findCswap's is\. .* no test helper has to turn it off\. A hub run by hand on another port needs DEVTEAM_BOX_HEALTH=on\./);
});

test('S10: stopped, it clears every timer and samples no more; startHub starts it as it listens and stops it at close', async (t) => {
  let ctx;
  const s = load({ env: nowhere(), realTimers: true, real: () => Date.now(), parts: [['state', { start: (c) => { ctx = c; }, part() {}, stop() {} }]] });
  t.after(() => s.health.stop());
  await s.health.start();
  assert.ok(s.timers.live.size > 0);
  s.health.stop();
  assert.equal(s.timers.live.size, 0);
  const n = answer(s.health).json.samples.length;
  await s.health.tick();
  await s.health.start();
  assert.equal(answer(s.health).json.samples.length, n);
  assert.equal(s.timers.live.size, 0);
  // a part that asks for a timer once stopped gets none
  ctx.every(5, () => {});
  ctx.after(5, () => {});
  ctx.timeout(5, () => {});
  assert.deepEqual([s.timers.live.size, s.timers.set > 0], [0, true], 'no timer set once stopped');
  // only a dashboard's kit hand-over closes a hub, and its process ends after: what can be pinned here
  // is that the hub's close() stops it
  const hub = cut('\nfunction startHub(', '\n// ===== account rotation');
  assert.match(hub, /const handle = \{ close\(\) \{[^\n]*\bhealth\.stop\(\);[^\n]*\} \};/);
  assert.match(hub, /recorder\.start\(\); health\.start\(\); \}\);/);
});

test('S11: a tick under way when it stops adds no sample and calls no part', async () => {
  const called = [];
  const s = load({ env: nowhere(), roots: [scratch], parts: [['state', { start() {}, part: () => { called.push('part'); }, stop() {} }]] });
  await s.health.start();
  let go;
  s.disk.statfs = () => new Promise((r) => { go = () => r(fs.promises.statfs(scratch)); });
  s.clock.t += 5000;
  const t = s.health.tick();
  await until(() => go, 'the tick waits on the disk');
  s.health.stop();
  go();
  await t;
  assert.equal(answer(s.health).json.samples.length, 1);
  assert.deepEqual(called, ['part']);
});

// ===== 4: the parts =====

test('S12: each region holds one stub, and boxHealthParts names them in order', () => {
  const s = load({ env: nowhere() });
  const list = s.boxHealthParts();
  assert.deepEqual(list.map(([n]) => n), PARTS);
  for (const [n] of list) {
    const body = bodyOf(`box-health-${n}`);
    assert.equal(body.split(`const ${constOf(n)} = `).length, 2, n);
    for (const m of ['start', 'part', 'stop']) assert.match(body, new RegExp(`\\b${m}\\b`), `${n}: ${m}`);
    // each is the one its name says: the list reads the region's own object
    assert.match(bodyOf('box-health-sampler'), new RegExp(`\\['${n}', ${constOf(n)}\\]`));
  }
  const order = ['box-health-contract', 'box-health-sampler', ...REGIONS].map((n) => src.indexOf(`/* ${n} start */`));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  const w = words('box-health-sampler');
  for (const x of ['start(ctx)', 'part(ctx, parts)', 'stop()', 'now()', 'real()', 'every(ms, fn)', 'after(ms, fn)', 'timeout(ms, fn)', 'turn()', 'stopped()', 'roots()', 'ceiling()', 'scan()', 'say(words)']) assert.ok(w.includes(x), `the comment says ${x}`);
});

test('S13: part is called in order once a tick and never for a request, each with what the parts before it gave', async () => {
  const calls = [];
  const acct = { accounts: [{ n: 1, label: 'Account 1' }], points: [] };
  const give = {
    processes: { by: 'processes' }, disk: undefined, state: { answer: { box: { oom_kills: 2 } } },
    pool: { answer: { pool: { projects: [], allocated: [], recent: [] } } },
    claude: { answer: { claude: acct }, extra: 7 }, park: { answer: { claude: { park: [] } } },
    room: { answer: { headroom: { room: 3 }, pool: { what_if: { now: 1 } } }, sample: { room: 3 } },
  };
  const parts = PARTS.map((n) => [n, { start: () => calls.push(`start ${n}`), part: (ctx, p) => { calls.push({ n, seen: Object.keys(p).filter((k) => PARTS.includes(k)), p }); return give[n]; }, stop: () => calls.push(`stop ${n}`) }]);
  const s = load({ env: nowhere(), parts });
  await s.health.start();
  assert.deepEqual(calls.splice(0, 7), PARTS.map((n) => `start ${n}`));
  const tick1 = calls.splice(0);
  assert.deepEqual(tick1.map((c) => c.n), PARTS);
  assert.deepEqual(tick1.map((c) => c.seen), [[], ['processes'], ['processes'], ['processes', 'state'], ['processes', 'state', 'pool'], ['processes', 'state', 'pool', 'claude'], ['processes', 'state', 'pool', 'claude', 'park']], 'disk gave nothing');
  assert.equal(tick1[5].p.claude.extra, 7);
  assert.equal(tick1[0].p.sample.at, new Date(T0).toISOString());
  assert.deepEqual(tick1[0].p.now.cpu.load, [1.5, 2.5, 3.5]);
  assert.equal(tick1[0].p.samples.at(-1).at, tick1[0].p.sample.at);
  for (let i = 0; i < 3; i++) answer(s.health);
  assert.equal(calls.length, 0, 'no part runs for a request');
  await step(s);
  assert.equal(calls.length, 7);
  const a = answer(s.health);
  ok(a);
  assert.deepEqual(a.json.pool, { projects: [], allocated: [], recent: [], what_if: { now: 1 } });
  assert.deepEqual(a.json.claude, { ...acct, park: [] });
  assert.deepEqual(a.json.headroom, { room: 3 });
  assert.deepEqual(a.json.box, { oom_kills: 2 });
  assert.equal(a.json.samples.at(-1).room, 3);
  s.health.stop();
  s.health.stop();
  assert.deepEqual(calls.slice(7), PARTS.map((n) => `stop ${n}`));
});

test('S14: an absent part is left out; a section with no base is too; one that throws costs only its own', async () => {
  const boom = { start() {}, part: () => { throw new Error('boom'); }, stop: () => { throw new Error('stop boom'); } };
  const room = { start() {}, part: (c, p) => { p.sample.load = -1; p.samples.at(-1).mem = -1; try { if (p.samples.length > 1) p.samples[0].mem = -1; } catch {} p.now.cpu.load = 'gone'; return { answer: { headroom: { room: 1 }, pool: { what_if: { now: 1 } } }, sample: { room: 1, at: '2020-01-01T00:00:00Z', load: 99 } }; }, stop() {} };
  let stops = 0;
  const bad = { start: () => { throw new Error('start boom'); }, part: () => ({ answer: { box: {} } }), stop: () => { stops++; } };
  // what a part gives may throw as it is read: a getter, a Proxy; that costs its part, never the tick,
  // and nothing it gave before the throw is kept
  const odd = { start() {}, part: () => new Proxy({}, { get() { throw new Error('trap'); } }), stop() {} };
  const late = { start() {}, part: () => ({ answer: { box: { kit: 'v9' } }, get sample() { throw new TypeError('late'); } }), stop() {} };
  // and what it throws may throw as it is read: said as an error, costing only its part (final-2 F1)
  const sly = { start() {}, part: () => { throw Object.defineProperty(new Error('m'), 'name', { get() { throw new Error('read'); } }); }, stop() {} };
  const s = load({ env: nowhere(), parts: [['processes', sly], ['disk', odd], ['state', bad], ['pool', boom], ['claude', { start() {}, part() {}, stop: () => { stops++; } }], ['park', late], ['room', room]] });
  await s.health.start();
  await step(s);
  const a = answer(s.health);
  ok(a);
  assert.deepEqual(Object.keys(a.json).sort(), ['at', 'headroom', 'now', 'samples', 'v', 'window_s'], 'no box from the part that threw after giving it');
  assert.equal(a.json.samples.length, 2, 'every tick sampled');
  assert.deepEqual([a.json.samples.at(-1).room, a.json.samples.at(-1).at], [1, new Date(s.clock.t).toISOString()], "the sample's time is the tick's");
  assert.equal(a.json.samples.at(-1).load, 1.5, "a part's sample never overwrites the sampler's own");
  s.health.stop();
  assert.equal(stops, 1, 'the claude part stopped; the one whose start threw was not');
  assert.deepEqual(s.logs.map((l) => l.replace(/ at line \d+$/, '')), ['hub: box health: state: start failed: Error', 'hub: box health: processes: part failed: an error', 'hub: box health: disk: part failed: Error', 'hub: box health: pool: part failed: Error', 'hub: box health: park: part failed: TypeError', 'hub: box health: pool: stop failed: Error']);
});

test('S15: fields box-health@1 refuses are left out and said, with nothing of what they held; the same object is checked once', async () => {
  const label = 'someone@example.com';
  let pool = 0;
  const claude = { accounts: [{ n: 1, label }] };
  const kept = { accounts: [], park: [] };
  const counted = { projects: new Proxy([], { get: (o, k) => { pool++; return Reflect.get(o, k); } }), allocated: [], recent: [] };
  const parts = [
    ['state', { start() {}, part: () => ({ answer: { box: { oom_kills: -1 }, nonsense: {} } }), stop() {} }],
    ['pool', { start() {}, part: () => ({ answer: { pool: counted } }), stop() {} }],
    ['claude', { start() {}, part: () => ({ answer: { claude } }), stop() {} }],
    ['park', { start() {}, part: () => ({ answer: { claude: kept } }), stop() {} }],
    ['room', { start() {}, part: () => ({ answer: { headroom: shared, box: shared }, sample: { room: 1.5 } }), stop() {} }],
  ];
  const shared = { kit: 'v1' };
  const s = load({ env: nowhere(), parts });
  await s.health.start();
  const first = pool;
  // changed after it was returned: what was checked is what is sent
  claude.accounts[0].label = label;
  kept.park.push({ fleet: label });
  await step(s);
  assert.ok(first > 0, 'the first tick checked it');
  assert.equal(pool, first, 'the second did not');
  const a = answer(s.health);
  ok(a);
  assert.deepEqual([a.json.claude, a.json.headroom, a.json.box, a.json.samples.at(-1).room], [{ accounts: [], park: [] }, undefined, { kit: 'v1' }, undefined], 'one object in two places is checked for each');
  assert.ok(a.json.pool);
  assert.equal(s.logs.length, 5, s.logs.join('\n'));
  assert.ok(s.logs.every((l) => !l.includes(label)), 'no address in the log');
});

test('S22: a native promise whose own then was replaced, rejected from start, part or stop, is said and costs only its part (kit-888)', async () => {
  const none = [];
  const onNone = (e) => none.push(e);
  process.on('unhandledRejection', onNone);
  try {
    // its own then: one that attaches nothing (final-3 probe Y4), one that throws, a value that is no function
    const odd = (then) => () => { const q = Promise.reject(new Error('odd')); q.then = then; return q; };
    const nothing = odd(function () { return this; }), throws = odd(() => { throw new Error('then'); }), none1 = odd(1);
    let ctx;
    // a part whose start failed is left out for good: what its part would give is never seen
    const boxed = () => ({ answer: { box: { oom_kills: 1 } } });
    const parts = [['processes', { start: throws, part: boxed, stop() {} }], ['disk', { start: nothing, part: boxed, stop() {} }],
      ['state', { start() {}, part: nothing, stop: nothing }], ['pool', { start() {}, part: throws, stop: throws }],
      ['claude', { start() {}, part: none1, stop: none1 }], ['park', { start: none1, part: boxed, stop() {} }],
      ['room', { start: (c) => { ctx = c; }, part: () => ({ answer: { headroom: { room: 1 } } }), stop() {} }]];
    const s = load({ env: nowhere(), parts });
    await s.health.start();
    // a timer's own promise is awaited, so it is caught already; it stays so
    ctx.after(1, nothing);
    s.timers.list.find((h) => h.kind === 'once' && h.ms === 1).fn();
    await step(s);
    s.health.stop();
    await sleep(20);
    assert.deepEqual(none, [], 'no rejection is left unhandled');
    const a = answer(s.health);
    ok(a);
    assert.equal(a.json.samples.length, 2, 'every tick sampled');
    assert.deepEqual(a.json.headroom, { room: 1 }, 'a later part is kept');
    assert.equal(a.json.box, undefined, 'a part whose start failed is left out');
    const said = s.logs.map((l) => l.replace(/ at line \d+$/, '')).sort();
    assert.deepEqual(said, ['claude: part failed: Error', 'claude: part gave something other than an object, left out', 'claude: stop failed: Error',
      'disk: start failed: Error', 'park: start failed: Error', 'pool: part failed: Error', 'pool: part gave something other than an object, left out', 'pool: stop failed: Error',
      'processes: start failed: Error', 'room: a timer failed: Error', 'state: part failed: Error', 'state: part gave something other than an object, left out', 'state: stop failed: Error'].map((l) => `hub: box health: ${l}`));
  } finally { process.off('unhandledRejection', onNone); }
});

// ===== 5: the clocks =====

test('S15b: a value that changes is said once, and an error\'s own text never', async (t) => {
  const label = 'someone@example.com';
  let n = 0, ctx;
  const say = ['claude', { start: (c) => { ctx = c; }, part: (c) => { c.say('one line'); JSON.parse(label); }, stop() {} }];
  const parts = [['state', { start() {}, part: () => ({ answer: { box: { oom_kills: --n } } }), stop() {} }], say,
    ['park', { start: () => { throw Object.assign(new Error(label), { name: label, code: 'ENOENT' }); }, part() {}, stop() {} }],
    ['room', { start() {}, part() {}, stop: () => { throw Object.assign(new Error('x'), { code: label }); } }],
    ['pool', { start() {}, part: () => { let n = 0; throw Object.defineProperty(new Error('x'), 'code', { get: () => (n++ ? label : 'ENOENT') }); }, stop() {} }]];
  const s = load({ env: nowhere(), parts, realTimers: true, real: () => Date.now() });
  t.after(() => s.health.stop());
  await s.health.start();
  ctx.every(5, () => { JSON.parse(`${label}${n}`); });
  for (let i = 0; i < 4; i++) { await s.health.tick(); await sleep(20); }
  for (let i = 0; i < 30; i++) ctx.say(`line ${i}`);
  s.health.stop();
  assert.ok(s.logs.every((l) => !l.includes('someone')), s.logs.join('\n'));
  assert.equal(s.logs.filter((l) => l.includes('oom_kills')).length, 1);
  assert.equal(s.logs.filter((l) => l.includes('claude: a timer failed: SyntaxError')).length, 1);
  assert.equal(s.logs.filter((l) => l.includes('claude: part failed: SyntaxError')).length, 1);
  assert.equal(s.logs.filter((l) => l.includes('park: start failed: an error ENOENT')).length, 1);
  assert.equal(s.logs.filter((l) => /room: stop failed: Error( at line \d+)?$/.test(l)).length, 1, 'a code that is not a word is not said');
  assert.equal(s.logs.filter((l) => /pool: part failed: Error ENOENT( at line \d+)?$/.test(l)).length, 1, 'the code checked is the code said');
  assert.equal(s.logs.filter((l) => /claude: (one line|line \d+)$/.test(l)).length, 20);
});

test('S15c: a promise that rejects, from start, part or stop, is said and costs only its part', async () => {
  const none = [];
  const onNone = (e) => none.push(e);
  process.on('unhandledRejection', onNone);
  try {
    const late = async () => { throw new Error('late'); };
    // a reason that throws as it is read: a getter, a Proxy (final-2 F1)
    const sly = () => Object.defineProperty(new Error('m'), 'name', { get() { throw new Error('read'); } });
    const trap = new Proxy({}, { get() { throw new Error('trap'); } });
    let ctx;
    const parts = [['disk', { start: (c) => { ctx = c; }, part() {}, stop() {} }], ['state', { start: late, part: () => ({ answer: { box: { oom_kills: 1 } } }), stop() {} }], ['pool', { start() {}, part: late, stop: late }],
      ['claude', { start() {}, part: async () => { throw sly(); }, stop() {} }], ['room', { start() {}, part: () => ({ answer: { headroom: { room: 1 } } }), stop() {} }]];
    const s = load({ env: nowhere(), parts });
    await s.health.start();
    ctx.after(1, async () => { throw trap; });
    s.timers.list.find((h) => h.kind === 'once' && h.ms === 1).fn();
    await step(s);
    assert.equal(answer(s.health).json.samples.length, 2, 'every tick sampled');
    const a = answer(s.health);
    ok(a);
    assert.deepEqual([a.json.box, a.json.headroom], [undefined, { room: 1 }]);
    s.health.stop();
    await sleep(20);
    assert.deepEqual(s.logs.map((l) => l.replace(/ at line \d+$/, '')).sort(), ['hub: box health: claude: part failed: an error', 'hub: box health: claude: part gave something other than an object, left out', 'hub: box health: disk: a timer failed: an error', 'hub: box health: pool: part failed: Error', 'hub: box health: pool: part gave something other than an object, left out', 'hub: box health: pool: stop failed: Error', 'hub: box health: state: start failed: Error']);
    assert.deepEqual(none, []);
  } finally { process.off('unhandledRejection', onNone); }
});

test('S15d: a tick never overlaps itself, a second listen starts nothing more, and an answer over 1 MB is a 500, said once', async () => {
  let starts = 0, calls = 0, fat = false;
  const goal = { id: 'g', title: 't' };
  const big = { accounts: [], park: Array.from({ length: 300 }, () => ({ fleet: 'f', goals: Array.from({ length: 100 }, () => goal), share: 0.1, enough: true })) };
  const s = load({ env: nowhere(), roots: [scratch], parts: [['claude', { start: () => { starts++; }, part: () => { calls++; return fat ? { answer: { claude: big } } : undefined; }, stop() {} }], ['park', { start() {}, part: () => (fat ? { answer: { headroom: { ready_unknown: Array(60000).fill('a-project') } } } : undefined), stop() {} }]] });
  await s.health.start();
  const set = s.timers.list.filter((h) => h.kind === 'every').length;
  await s.health.start();
  assert.deepEqual([starts, s.timers.list.filter((h) => h.kind === 'every').length], [1, set]);
  s.clock.t += 5000;
  const n = calls;
  await Promise.all([s.health.tick(), s.health.tick()]);
  assert.equal(calls, n + 1);
  fat = true;
  await step(s);
  assert.deepEqual([answer(s.health).status, answer(s.health).status], [500, 500]);
  assert.deepEqual(s.logs, ['hub: box health: the answer is over 1 MB, so none was given']);
  const hub = cut('\nfunction startHub(', '\n// ===== account rotation');
  assert.match(hub, /try \{ return health\.serve\(req, send\); \} catch \(e\) \{ health\.fail\('sampler', '\/box-health\.json', e\); return send\(500,/);
});

test('S16: with DEVTEAM_BOX_HEALTH_FAST now and its intervals run n times as fast; real and timeout do not', async () => {
  let ctx;
  const parts = [['state', { start: (c) => { ctx = c; c.every(60000, () => {}); c.after(60000, () => {}); c.timeout(2000, () => {}); }, part() {}, stop() {} }]];
  const s = load({ env: nowhere({ DEVTEAM_BOX_HEALTH: 'on', DEVTEAM_BOX_HEALTH_FAST: '720' }), port: 20002, parts });
  await s.health.start();
  assert.deepEqual(s.timers.list.slice(0, 4).map((h) => [h.kind, h.ms]), [['every', 60000 / 720], ['once', 60000 / 720], ['once', 2000], ['every', 5000 / 720]]);
  assert.ok(s.timers.list.some((h) => h.kind === 'every' && h.ms === 60000), 'the roots are read by the machine\'s minute');
  // an hour of samples in five seconds of the machine's
  const n0 = ctx.now();
  for (let i = 0; i < 720; i++) { s.clock.t += 5000 / 720; await s.health.tick(); }
  assert.ok(Math.abs(ctx.now() - n0 - HOUR) < 1000, `an hour by now (${ctx.now() - n0})`);
  assert.equal(Math.round(ctx.real() - T0), 5000);
  assert.ok(answer(s.health).json.samples.length >= 719);
  ok(answer(s.health));
  // now is stale by the real clock: 14 s with no tick is still now, 16 s is not, though by now that is hours
  const at = s.clock.t;
  s.clock.t = at + 14000;
  assert.ok(answer(s.health).json.now.cpu, '14 s by the real clock is still now');
  s.clock.t = at + 16000;
  assert.deepEqual(answer(s.health).json.now, {}, '16 s by the real clock is not now');
  s.clock.t = at;
  // records stamped with the machine's time as the hub began are still fresh by real (a pool.json for
  // 15 minutes, an accounts.json for 5), and would not be by now
  assert.ok(ctx.real() - T0 < 5 * MIN && ctx.now() - T0 > 15 * MIN);
  for (const env of [{ DEVTEAM_BOX_HEALTH_FAST: '720' }, { DEVTEAM_BOX_HEALTH: 'on', DEVTEAM_BOX_HEALTH_FAST: '0' }, { DEVTEAM_BOX_HEALTH: 'on', DEVTEAM_BOX_HEALTH_FAST: 'x' }, { DEVTEAM_BOX_HEALTH: 'on', DEVTEAM_BOX_HEALTH_FAST: '1e9' }, { DEVTEAM_BOX_HEALTH: 'on' }]) {
    const plain = load({ env: nowhere(env) });
    await plain.health.start();
    assert.ok(plain.timers.list.some((h) => h.kind === 'every' && h.ms === 5000), JSON.stringify(env));
  }
});

test('S17: ctx: every never overlaps itself and says an error once, after runs once, each ends, roots and scan are the hub\'s', async (t) => {
  let ctx;
  const hello = [{ root: path.join(scratch, 'r'), name: 'seen', port: 4321 }];
  const scan = async () => hello;
  const s = load({ env: nowhere(), realTimers: true, real: () => Date.now(), roots: [scratch], settings: { scan }, parts: [['state', { start: (c) => { ctx = c; }, part() {}, stop() {} }]] });
  t.after(() => s.health.stop());
  await s.health.start();
  assert.equal(ctx.scan, scan);
  assert.deepEqual(ctx.roots().map((r) => r.root).sort(), [scratch, hello[0].root].sort());
  assert.equal(ctx.ceiling(), 0.8);
  assert.deepEqual([ctx.proc, ctx.cgroup], [NOWHERE, NOWHERE]);
  let now = 0, most = 0, runs = 0, once = 0, throws = 0;
  ctx.every(5, async () => { now++; runs++; most = Math.max(most, now); await sleep(40); now--; });
  const end = ctx.every(5, () => { throws++; throw new Error('again'); });
  ctx.after(5, () => { once++; });
  let cancelled = 0;
  ctx.after(30, () => { cancelled++; })();
  await ctx.turn();
  await until(() => runs >= 3 && throws >= 3, 'three runs of each');
  end();
  const n = throws;
  await sleep(60);
  assert.deepEqual([most, once, cancelled, throws], [1, 1, 0, n]);
  assert.equal(s.logs.length, 1);
  assert.match(s.logs[0], /^hub: box health: state: a timer failed: Error\b/);
  assert.equal(ctx.stopped(), false);
  s.health.stop();
  assert.equal(ctx.stopped(), true);
  const r = runs;
  await sleep(60);
  assert.equal(runs, r, 'nothing after stop');
  assert.equal(s.timers.live.size, 0);
});

test('S18: no part reads the clock or sets a timer itself, and the sampler does only in ctx', () => {
  const forbidden = /\bDate\.now\b|\bnew Date\(\s*\)|\bnew Date\b(?!\s*\()|(?<!new )\bDate\(|\bperformance\b|\bhrtime\b|\bset(?:Timeout|Interval|Immediate)\b|\bAbortSignal\b|\btimers\/promises\b|\btimeout\s*:/;
  for (const n of REGIONS) assert.doesNotMatch(bodyOf(n), forbidden, n);
  const body = bodyOf('box-health-sampler');
  const count = (re) => (body.match(re) ?? []).length;
  assert.deepEqual([count(/\bDate\.now\b/g), count(/\bsetTimeout\b/g), count(/\bsetInterval\b/g), count(/\bsetImmediate\b/g)], [1, 1, 1, 1]);
  assert.doesNotMatch(body, /\bnew Date\(\s*\)|\bperformance\b|\bhrtime\b/);
  for (const bad of ['Date.now()', 'new Date()', 'setTimeout(f, 1)', 'new Date', 'Date()', 'performance.now()', 'AbortSignal.timeout(5)', 'execFile(a, b, { timeout: 5 })']) assert.match(bad, forbidden);
  for (const good of ['new Date(ctx.now()).toISOString()', 'Date.parse(at)', 'ctx.timeout(2000, f)']) assert.doesNotMatch(good, forbidden);
});

// ===== 6: disks =====

test('S19: disks has one entry a distinct volume holding a known root, with bytes_per_hour over the hour after 10 minutes', async () => {
  const [a, b, c] = [newDir(), newDir(), newDir()];
  const s = load({ env: nowhere(), roots: [a, b, c, path.join(scratch, 'gone')] });
  const dev = { [a]: 1, [b]: 1, [c]: 2 };
  const free = { 1: 1000, 2: 500 };
  s.disk.stat = async (p) => { if (!(p in dev)) throw new Error('ENOENT'); return { dev: dev[p] }; };
  s.disk.statfs = async (p) => ({ bavail: free[dev[p]], bsize: 4096, blocks: 2000, files: dev[p] === 1 ? 100 : 0, ffree: 40 });
  await s.health.start();
  const disks = () => answer(s.health).json.now.disks;
  assert.deepEqual(disks(), [{ free: 1000 * 4096, total: 2000 * 4096, inodes_free: 40, inodes: 100 }, { free: 500 * 4096, total: 2000 * 4096 }], 'a volume with no inode count says none');
  const last = () => answer(s.health).json.samples.at(-1);
  assert.deepEqual([last().disk, last().inodes], [1000 * 4096, 40]);
  for (let i = 0; i < 119; i++) await step(s);
  assert.ok(disks().every((d) => d.bytes_per_hour === undefined), 'under 10 minutes');
  free[1] = 900;
  await step(s);
  assert.deepEqual(disks().map((d) => d.bytes_per_hour), [-100 * 4096 * 6, 0], 'ten minutes');
  // over the hour only: what went before it doesn't count
  for (let i = 0; i < 720; i++) await step(s);
  assert.deepEqual(disks().map((d) => d.bytes_per_hour), [0, 0]);
  ok(answer(s.health));
  // over the hour only, across a gap too
  free[1] = 700;
  await step(s, 2 * HOUR);
  assert.ok(disks().every((d) => d.bytes_per_hour === undefined), 'nothing from before the gap');
  free[1] = 900;
  // the first volume stays first when its first root goes
  delete dev[a];
  await step(s);
  assert.equal(disks()[0].free, 900 * 4096);
  assert.equal(last().disk, 900 * 4096);
});

// A tick that meets a volume that hangs: once every read that will run has, its 2 s limit fires.
const hung = async (s, f, ready) => {
  const tick = f();
  await until(ready, 'the reads');
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  for (const h of [...s.timers.live]) if (h.kind === 'once') { assert.equal(h.ms, 2000); h.fn(); }
  await tick;
};

test('S20: a volume that does not answer is waited for 2 s, left out, and not asked again until it does', async () => {
  const [a, b, c, d] = [newDir(), newDir(), newDir(), newDir()];
  const s = load({ env: nowhere(), roots: [a, c, d, b] });
  let asked = 0, read = 0, hang = false, go;
  s.disk.stat = async (p) => ({ dev: p === b ? 2 : 1 });
  s.disk.statfs = async (p) => {
    if (hang && p !== b) { asked++; await new Promise((r) => { go = r; }); }
    if (p === b) read++;
    const u = p === b ? 7 : 1;
    return { bavail: u, bsize: 1, blocks: 2 * u, files: 2, ffree: 1 };
  };
  const disk = () => answer(s.health).json.samples.map((x) => x.disk);
  await s.health.start();
  hang = true;
  read = 0;
  await hung(s, () => step(s), () => asked >= 1);
  assert.deepEqual(answer(s.health).json.now.disks, [{ free: 7, total: 14, inodes_free: 1, inodes: 2 }]);
  await step(s);
  assert.deepEqual(disk(), [1, undefined, undefined], "a gap in its line, never the other volume's");
  assert.equal(asked, 1, 'one read of a volume that hangs, whichever of its roots');
  hang = false;
  go();
  await sleep(5);
  await step(s);
  assert.deepEqual(disk(), [1, undefined, undefined, 1], 'and its line again when it answers');
  assert.deepEqual(answer(s.health).json.now.disks.map((x) => x.free), [1, 7]);
  assert.deepEqual(s.logs, ['hub: box health: sampler: a volume did not answer within 2 s']);
  // never seen before, two of its roots ahead of a volume that answers
  const n = load({ env: nowhere(), roots: [a, c, b] });
  n.disk.stat = s.disk.stat;
  n.disk.statfs = s.disk.statfs;
  hang = true;
  asked = read = 0;
  await hung(n, () => n.health.start(), () => asked >= 1);
  assert.equal(asked, 1);
  assert.deepEqual(answer(n.health).json.now.disks?.map((x) => x.free), [7]);
  // accepted (final-2 F3): at the start no root's volume is known, and telling two roots of one apart
  // needs the stat that hangs, so two of a volume whose stat hangs hold both places, and a volume that
  // answers is not read until one of them does; a third place would let it hold more of the threads
  const h = load({ env: nowhere(), roots: [a, c, b] });
  const stats = [];
  h.disk.stat = (q) => { stats.push(q); return q === b ? Promise.resolve({ dev: 2 }) : new Promise(() => {}); };
  h.disk.statfs = s.disk.statfs;
  await hung(h, () => h.health.start(), () => stats.length >= 2);
  for (let i = 0; i < 2; i++) await hung(h, () => step(h), () => true);
  assert.deepEqual([stats, answer(h.health).json.now.disks], [[a, c], undefined], 'both places held by one hung volume, until it answers');
});

test('S21: at most two reads are out, a root still out is not asked again, and a tick that ended asks no more', async () => {
  const roots = [newDir(), newDir(), newDir(), newDir(), newDir()];
  const s = load({ env: nowhere(), roots });
  const asked = [], go = [];
  s.disk.stat = (p) => { asked.push(p); return new Promise((r) => go.push(() => r({ dev: asked.indexOf(p) }))); };
  s.disk.statfs = async () => ({ bavail: 1, bsize: 1, blocks: 2, files: 2, ffree: 1 });
  await hung(s, () => s.health.start(), () => asked.length >= 2);
  assert.deepEqual(asked, roots.slice(0, 2), 'two, though none answers');
  await hung(s, () => step(s), () => true);
  assert.equal(asked.length, 2, 'no more while both are out');
  go[1]();
  await sleep(5);
  assert.equal(asked.length, 2, 'an answer after its tick starts nothing');
  await hung(s, () => step(s), () => asked.length >= 3);
  assert.deepEqual(asked, [roots[0], roots[1], roots[1]], 'one place is free, and the root still out is passed over');
});

// ===== the hub itself =====

const HUB_WATCH = `const g = Number(process.argv[1]); const end = () => { try { process.kill(-g, 'SIGKILL'); } catch {} process.exit(0); };
process.stdin.on('end', end); process.stdin.on('close', end); process.stdin.on('error', end); process.stdin.resume();`;
function get(port, route, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.get({ host: '127.0.0.1', port, path: route, headers: { host: `127.0.0.1:${port}`, ...headers }, timeout: 20000 }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, body: b, json: j }); });
    });
    r.on('timeout', () => r.destroy(new Error(`${route} timed out`)));
    r.on('error', reject);
  });
}
// A copy of the kit in no repo, with fakes (a part's name to its source) in the regions' places, and a
// stub in each other's; as it is with null.
function kitCopy(fakes) {
  const d = path.join(newDir(), 'kit');
  fs.cpSync(kit, d, { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
  const f = path.join(d, 'scripts', 'devteam.mjs');
  let text = fs.readFileSync(f, 'utf8');
  for (const n of fakes ? PARTS : []) {
    const end = `/* box-health-${n} end */`, from = text.indexOf(`/* box-health-${n} start */`), to = text.indexOf(end);
    assert.ok(from > 0 && to > from, n);
    text = `${text.slice(0, from)}${stub(n, fakes[n])}${text.slice(to + end.length)}`;
  }
  fs.writeFileSync(f, text);
  return f;
}
let plain;
const plainKit = () => (plain ??= kitCopy({}));
let ports = 0;
// Each hub its own port in this file's block (+2..+29); its scan block (+50..+74) has nothing on it.
async function startHub(t, { env = {}, script = plainKit(), roots = [] } = {}) {
  const home = newDir(), port = PORTS + 2 + (ports++ % 28);
  const reg = path.join(home, '.devteam', `repos-${port}`);
  fs.mkdirSync(reg, { recursive: true });
  roots.forEach((r, i) => fs.writeFileSync(path.join(reg, `r${i}.json`), JSON.stringify({ root: r, at: new Date().toISOString() })));
  const e = { ...process.env, HOME: home, DEVTEAM_HUB_PORT: String(port), DEVTEAM_PORT_BASE: String(PORTS + 50), ...nowhere(), DEVTEAM_MEMORY_RECORD: 'off', ...env };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_HOME', 'DEVTEAM_IMAGE_HUB', 'TMUX', 'TMUX_PANE']) delete e[k];
  for (const [k, v] of Object.entries(e)) if (v === undefined) delete e[k];
  const p = spawn(process.execPath, [script, 'hub'], { cwd: home, env: e, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const w = spawn(process.execPath, ['-e', HUB_WATCH, String(p.pid)], { detached: true, stdio: ['pipe', 'ignore', 'ignore'] });
  w.on('error', () => {});
  w.stdin.on('error', () => {});
  w.unref();
  w.stdin.unref();
  let out = '';
  p.stdout.on('data', (b) => { out += b; });
  p.stderr.on('data', (b) => { out += b; });
  t.after(() => { try { w.kill('SIGKILL'); } catch {} return p.exitCode !== null || p.signalCode !== null ? undefined : new Promise((r) => { p.once('exit', r); try { process.kill(-p.pid, 'SIGKILL'); } catch { r(); } }); });
  await until(async () => { try { return (await get(port, '/instances.json')).status === 200; } catch { return p.exitCode !== null; } }, `the hub on ${port}`);
  assert.equal(p.exitCode, null, `the hub runs (${out})`);
  return { port, out: () => out, gone: () => p.exitCode !== null || p.signalCode !== null };
}
const ON = { DEVTEAM_BOX_HEALTH: 'on' };
const sampled = (h, n) => until(async () => (await get(h.port, '/box-health.json')).json?.samples?.length >= n, `${n} samples`);

test('H1: a standalone hub answers /box-health.json and ?after=, and refuses another site\'s page as /memory.json does', async (t) => {
  const b = fakeBox(newDir());
  const h = await startHub(t, { env: { ...boxEnv(b), ...ON, DEVTEAM_BOX_HEALTH_FAST: '50' }, roots: [scratch] });
  assert.equal((await get(h.port, '/box-health.json')).status, 200, 'the route, before any sample');
  await sampled(h, 4);
  const a = await get(h.port, '/box-health.json');
  assert.equal(boxHealthProblem(a.body), null, a.body.slice(0, 300));
  assert.equal(a.json.now.memory.used, CGROUP_BYTES.inUse);
  assert.equal(a.json.now.disks.length, 1);
  const mid = a.json.samples[1].at;
  const later = await get(h.port, `/box-health.json?after=${mid}`);
  assert.equal(later.status, 200);
  assert.ok(later.json.samples.length >= 2 && later.json.samples.every((s) => s.at > mid));
  for (const q of ['?after=x', '?since=24h', '?after=']) assert.equal((await get(h.port, `/box-health.json${q}`)).status, 400, q);
  assert.equal((await get(h.port, '/box-health.jsonx')).status, 404);
  for (const site of ['cross-site', 'same-site', 'same-origin', 'none']) {
    const [x, m] = [await get(h.port, '/box-health.json', { 'sec-fetch-site': site }), await get(h.port, '/memory.json', { 'sec-fetch-site': site })];
    assert.equal(x.status, m.status, site);
    if (m.status === 403) assert.equal(x.body, m.body, site);
  }
});

test('H2: on a fixture port with no switch, or off, the route is the hub\'s 404 and nothing is sampled, also with DEVTEAM_MEMORY_RECORD deleted', async (t) => {
  const b = fakeBox(newDir());
  const script = kitCopy(null);
  for (const env of [{}, { DEVTEAM_BOX_HEALTH: 'off' }, { DEVTEAM_MEMORY_RECORD: undefined }, { DEVTEAM_BOX_HEALTH_FAST: '700' }]) {
    const h = await startHub(t, { env: { ...boxEnv(b), DEVTEAM_BOX_HEALTH: undefined, ...env }, script });
    const a = await get(h.port, '/box-health.json');
    assert.deepEqual([a.status, a.body], [404, 'not found'], JSON.stringify(env));
    assert.doesNotMatch(h.out(), /box health/);
  }
});

test('H3: a sampler error in a hub is said once in its log and leaves a gap', async (t) => {
  const pre = path.join(newDir(), 'pre.cjs');
  fs.writeFileSync(pre, `const os = require('os'); const l = os.loadavg; let n = 0; os.loadavg = () => { n++; if (n > 2 && n < 6) throw new Error('no load today'); return l(); };`);
  const h = await startHub(t, { env: { ...ON, DEVTEAM_BOX_HEALTH_FAST: '50', NODE_OPTIONS: `--require ${pre}` } });
  await sampled(h, 4);
  assert.equal(h.out().split('hub: box health: sampler: a tick failed: Error').length - 1, 1, h.out());
  assert.doesNotMatch(h.out(), /no load today/);
});

test('H4: fakes in the regions\' places run in the hub: they add to claude, pool and samples, after= filters, and an hour of fast samples keeps the machine\'s time for records and walks', async (t) => {
  const log = path.join(newDir(), 'calls');
  const rec = path.join(newDir(), 'pool.json');
  fs.writeFileSync(rec, JSON.stringify({ at: new Date().toISOString() }));
  const fakes = {
    state: `{ start(ctx) { ctx.every(60000, async () => { const l = await ctx.scan(); boxHealthState.said = { answer: { box: { kit: JSON.stringify([l.map((x) => [x.name, x.port]), ctx.roots().map((r) => r.name)]) } } }; }); }, part() { return boxHealthState.said; }, async stop() {} }`,
    park: `{ start(ctx) {}, async part() { throw new Error('late'); }, stop() {} }`,
    processes: `{ start(ctx) { const a = ctx.real(); ctx.timeout(2000, () => { boxHealthProcesses.took = ctx.real() - a; }); }, part(ctx) { return { began: boxHealthProcesses.took }; }, stop() {} }`,
    pool: `{ start(ctx) {}, part(ctx, parts) { const age = ctx.real() - Date.parse(JSON.parse(fs.readFileSync(${JSON.stringify(rec)}, 'utf8')).at); return { answer: { pool: { projects: [{ name: 'took ' + parts.processes.began + ' age ' + age }], allocated: [], recent: [] } } }; }, stop() {} }`,
    claude: `{ start(ctx) { boxHealthClaude.points = []; ctx.every(60000, () => { boxHealthClaude.points = [...boxHealthClaude.points, { at: new Date(ctx.now()).toISOString(), room: 1 }]; }); }, part(ctx) { return { answer: { claude: { accounts: [], points: boxHealthClaude.points } } }; }, stop() {} }`,
    room: `{ start(ctx) {}, part(ctx, parts) { fs.appendFileSync(${JSON.stringify(log)}, 'x'); return { answer: { pool: { what_if: { now: 5 } } }, sample: { room: 5 } }; }, stop() {} }`,
  };
  const root = newDir();
  const dash = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ devteam: 1, root, name: 'from-hello', port: PORTS + 50 })); });
  await new Promise((r) => dash.listen(PORTS + 50, '127.0.0.1', r));
  t.after(() => new Promise((r) => dash.close(r)));
  const script = kitCopy(fakes);
  const h = await startHub(t, { env: { ...ON, DEVTEAM_BOX_HEALTH_FAST: '720' }, script });
  let a;
  await until(async () => { a = (await get(h.port, '/box-health.json')).json; return a?.samples?.length && Date.parse(a.samples.at(-1).at) - Date.parse(a.samples[0].at) > 50 * MIN; }, 'most of an hour of samples');
  await until(async () => /took \d/.test((await get(h.port, '/box-health.json')).json?.pool?.projects?.[0]?.name ?? ''), 'the 2 s timeout');
  const r = await get(h.port, '/box-health.json');
  assert.equal(boxHealthProblem(r.body), null);
  const [, took, age] = /took (\d+) age (\d+)/.exec(r.json.pool.projects[0].name).map(Number);
  assert.ok(took >= 1990, `a walk has its 2 s (${took} ms)`);
  assert.ok(age < 5 * MIN, `the record is ${age} ms old`);
  assert.equal(r.json.box.kit, JSON.stringify([[['from-hello', PORTS + 50]], ['from-hello']]), "the hub's own scan and roots");
  assert.match(h.out(), /park: part failed: Error/);
  assert.deepEqual(r.json.pool.what_if, { now: 5 });
  assert.equal(r.json.samples.at(-1).room, 5);
  assert.ok(r.json.claude.points.length >= 10);
  const mid = r.json.claude.points[5].at;
  const later = (await get(h.port, `/box-health.json?after=${mid}`)).json;
  assert.ok(later.claude.points.length >= 4 && later.claude.points.every((p) => p.at > mid) && later.samples.every((s) => s.at > mid));
});

test('H5: a hub lives through a part\'s native promise whose own then was replaced, rejected each tick, and says it once (kit-888)', async (t) => {
  // from its 10th tick on, once the hub is up and answering
  const odd = 'boxHealthState.n = (boxHealthState.n ?? 0) + 1; if (boxHealthState.n < 10) return; const q = Promise.reject(new Error(\'odd\')); q.then = function () { return this; }; return q;';
  const script = kitCopy({ state: `{ start(ctx) {}, part() { ${odd} }, stop() {} }` });
  const h = await startHub(t, { env: { ...ON, DEVTEAM_BOX_HEALTH_FAST: '50' }, script });
  await until(async () => { if (h.gone()) return true; try { return (await get(h.port, '/box-health.json')).json?.samples?.length >= 15; } catch { return false; } }, '15 samples, or the hub gone');
  assert.equal(h.gone(), false, `the hub lives (${h.out()})`);
  assert.equal(h.out().split('hub: box health: state: part failed: Error').length - 1, 1, h.out());
});

// ===== 7: the image =====

test('I1: IMAGE_RUNS lists the contract, the sampler and every part, and startHub', () => {
  const at = src.indexOf('\nconst IMAGE_RUNS = {');
  const listed = new Function(`return ${src.slice(at + '\nconst IMAGE_RUNS = '.length, src.indexOf('\n};\n', at) + 2)}`)().parts;
  for (const n of ['box-health-contract', 'box-health-sampler', ...REGIONS, 'startHub']) assert.equal(listed.filter((x) => x === n).length, 1, n);
});
