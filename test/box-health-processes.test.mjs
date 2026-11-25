// The hub's processes part (kit-837): CPU and memory by worktree, test runs apart, and strays, over
// a fake /proc and cgroup (test/fixtures/box-health/processes). The region runs here with only the
// names it reads given to it, beside the box-memory, contract and sampler regions it builds on; a
// fake ctx drives its walks, so no timer fires and no test reads this machine's /proc.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checks, regionOf } from './fixtures/box-health/contract/check.mjs';
import { fakeProc, HZ, SECRET, ENV_SECRET } from './fixtures/box-health/processes/fake-proc.mjs';
import { kit } from './lib/kit.mjs';

const { boxHealthProblem } = checks();
const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
const region = regionOf('box-health-processes', src);
const body = region.replace(/^\s*\/\/.*$/gm, '');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-boxproc-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
let dirs = 0;
const newDir = () => { const d = path.join(scratch, `d${++dirs}`); fs.mkdirSync(d); return d; };
const T0 = Date.parse('2026-11-25T12:00:00.000Z');
const MIN = 60000;
const PAGE = 4096;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''}: ${a} is not ${b}`);

// The region with what it reads: fs counted (stat, cmdline, cwd and environ reads by kind, and each
// async read by its folder's name). An async read in a folder named in hang (a pid, or a run/ folder)
// doesn't settle until release(), as a /proc read doesn't while that process's memory is locked.
function load() {
  const reads = { stat: 0, cmdline: 0, cwd: 0, environ: 0, other: 0 };
  const hang = new Set(), held = [], by = new Map(), out = { now: 0, most: 0 };
  const kindOf = (p) => { const b = path.basename(String(p)); return b in reads ? b : 'other'; };
  const held1 = (p, go) => {
    const dir = path.basename(path.dirname(String(p)));
    by.set(dir, (by.get(dir) ?? 0) + 1);
    out.now++; out.most = Math.max(out.most, out.now);
    const done = (v) => { out.now--; return v; };
    const fail = (e) => { out.now--; throw e; };
    if (!hang.has(dir)) return go().then(done, fail);
    return new Promise((res) => held.push(res)).then(() => go()).then(done, fail);
  };
  const release = () => { hang.clear(); held.splice(0).forEach((res) => res()); };
  const promises = new Proxy(fs.promises, { get: (o, k) => {
    if (k === 'open') return (p, ...a) => { reads[kindOf(p)]++; return held1(p, () => o.open(p, ...a)); };
    if (k === 'readlink') return (p, ...a) => { reads[kindOf(p)]++; return held1(p, () => o.readlink(p, ...a)); };
    if (k === 'readFile') return (p, ...a) => { reads[kindOf(p)]++; return o.readFile(p, ...a); };
    return o[k];
  } });
  const ffs = new Proxy(fs, { get: (o, k) => {
    if (k === 'promises') return promises;
    if (k === 'readFileSync') return (p, ...a) => { reads[kindOf(p)]++; return o.readFileSync(p, ...a); };
    return o[k];
  } });
  const proc = { env: {}, pid: 4242, memoryUsage: { rss: () => 50 * 1024 * 1024 } };
  const names = { fs: ffs, path, Buffer, process: proc };
  const code = `'use strict';\n${['box-memory', 'box-health-contract', 'box-health-sampler', 'box-health-processes'].map((n) => regionOf(n, src)).join('\n')}\nreturn { boxHealthProcesses, procClassify, procStat };`;
  return { ...new Function(...Object.keys(names), code)(...Object.values(names)), reads, hang, release, by, out };
}
// A fake ctx: its clocks are set by the test, its timers are kept and never fire by themselves.
function ctxOf(box, list) {
  const clock = { now: T0, real: T0 }, said = [], timers = [], roots = { list };
  const turn = { each: () => {} };
  const ctx = {
    now: () => clock.now, real: () => clock.real,
    every: (ms, fn) => { const t = { kind: 'every', ms, fn }; timers.push(t); return () => { t.ended = true; }; },
    after: (ms, fn) => { const t = { kind: 'after', ms, fn }; timers.push(t); return () => { t.ended = true; }; },
    // with turn.late, a timeout fires 100 ms of real time on, unless ended: what is out by then is late
    timeout: (ms, fn) => { const t = { kind: 'timeout', ms, fn }; timers.push(t); if (turn.late) setTimeout(() => { if (!t.ended) fn(); }, 100); return () => { t.ended = true; }; },
    turn: async () => { turn.each(); },
    roots: () => roots.list, ceiling: () => 0.8, scan: async () => [],
    proc: box.proc, cgroup: box.cgroup, stopped: () => false, say: (w) => said.push(String(w)),
  };
  return { ctx, clock, said, timers, turn, roots };
}
// The part started on a fake box: walk() runs one walk, as the 15 s interval would, ms later.
async function started(box, roots, s = load()) {
  const c = ctxOf(box, roots);
  s.boxHealthProcesses.start(c.ctx);
  const every = (ms) => c.timers.find((t) => t.kind === 'every' && t.ms === ms);
  assert.ok(every(15000), 'a walk every 15 s');
  // the sampler reads the roots before its first tick, and start before that: the first walk waits
  // for the interval, so it never runs on an empty list (spec-1 F1)
  assert.deepEqual(c.timers.map((t) => [t.kind, t.ms]), [['every', 15000]], 'start sets one interval and nothing else');
  const walk = async (ms = 15000) => { c.clock.real += ms; c.clock.now += ms; await every(15000).fn(); };
  return { ...s, ...c, walk, first: () => every(15000).fn(), part: () => s.boxHealthProcesses.part(c.ctx, {}) };
}
const place = (r, project, worktree) => r.places.find((p) => p.project === project && p.worktree === worktree);

// ===== 1: where a process counts, its CPU, its test runs, unattributed =====

test('P1: a process counts for the longest known root holding its cwd, then its worktree; else outside', async () => {
  const b = fakeProc(newDir());
  const roots = [{ root: '/w/a', name: 'alpha' }, { root: '/w/a/inner', name: 'inner' }, { root: '/w/b', name: 'beta' }];
  b.add({ pid: 10, argv: ['claude'], cwd: '/w/a/.worktrees/kit-1/src', pages: 10 });
  b.add({ pid: 11, argv: ['node', 'x.mjs'], cwd: '/w/a/.worktrees/kit-1', pages: 20 });
  b.add({ pid: 12, argv: ['bash'], cwd: '/w/a/inner/.worktrees/kit-1', pages: 30 });
  b.add({ pid: 13, argv: ['claude'], cwd: '/w/a', pages: 40 });
  b.add({ pid: 14, argv: ['vim'], cwd: '/w/b/.worktrees/kit-2 (deleted)', pages: 50 });
  b.add({ pid: 15, argv: ['bash'], cwd: '/w/ab', pages: 60 });
  b.add({ pid: 16, argv: ['bash'], pages: 70 });
  b.add({ pid: 17, argv: [], cwd: '/', pages: 80 });
  b.add({ pid: 18, argv: ['node', '/k/devteam.mjs', 'dashboard'], cwd: '/w/a', pages: 3 });
  b.add({ pid: 19, argv: ['bash'], comm: 'a) b (c', cwd: '/w/a/.worktrees/kit-1', pages: 5 }); // comm with ")" and spaces
  const s = await started(b, roots);
  await s.first();
  const r = s.part();
  assert.deepEqual(place(r, 'alpha', 'kit-1'), { root: '/w/a', project: 'alpha', worktree: 'kit-1', n: 3, agents: 1, rss: 35 * PAGE, tests: { n: 0, rss: 0 }, own: { n: 0, rss: 0 } }, 'a comm holding ")" and spaces is read from its last ")"');
  assert.deepEqual(place(r, 'inner', 'kit-1'), { root: '/w/a/inner', project: 'inner', worktree: 'kit-1', n: 1, agents: 0, rss: 30 * PAGE, tests: { n: 0, rss: 0 }, own: { n: 0, rss: 0 } }, 'the longest root');
  assert.deepEqual(place(r, 'alpha', undefined), { root: '/w/a', project: 'alpha', n: 2, agents: 1, rss: 43 * PAGE, tests: { n: 0, rss: 0 }, own: { n: 1, rss: 3 * PAGE } }, 'the root itself, devteam\'s own apart');
  assert.equal(place(r, 'beta', 'kit-2').rss, 50 * PAGE, 'a deleted cwd counts where it was');
  assert.deepEqual(r.outside, { n: 3, agents: 0, rss: 210 * PAGE }, '/w/ab is in no root; an unreadable cwd and a kernel thread are outside');
  assert.equal(r.places.length, 4);
  assert.equal(r.over_s, undefined, 'no CPU from one walk');
  assert.equal(r.unattributed, undefined);
  assert.equal(r.at, T0);
});

test('P2: CPU between two whole walks is each process\'s own change in cores; unattributed is the cgroup\'s total less it', async () => {
  const b = fakeProc(newDir());
  const roots = [{ root: '/w/a', name: 'alpha' }];
  b.add({ pid: 10, argv: ['node', 'a.mjs'], cwd: '/w/a/.worktrees/kit-1', cpu: 1000 });
  b.add({ pid: 11, argv: ['node', 'b.mjs'], cwd: '/w/a', cpu: 500 });
  b.add({ pid: 12, argv: ['bash'], cwd: '/tmp', cpu: 0 });
  b.usage(1e9);
  const s = await started(b, roots);
  await s.first();
  b.set(10, { cpu: 1000 + 15 * HZ * 0.5 });
  b.set(11, { cpu: 500 + 15 * HZ * 0.25 });
  b.set(12, { cpu: 15 * HZ * 0.1 });
  b.usage(1e9 + 15 * 1e6 * 1.5);
  await s.walk();
  const r = s.part();
  assert.equal(r.over_s, 15);
  near(place(r, 'alpha', 'kit-1').cpu, 0.5, 'worktree');
  near(place(r, 'alpha', undefined).cpu, 0.25, 'root');
  near(r.outside.cpu, 0.1, 'outside');
  near(r.unattributed.cpu, 1.5 - 0.85, 'unattributed');
  assert.equal(r.at, T0 + 15000);
  b.usage(1e9);
  await s.walk();
  assert.equal(s.part().unattributed, undefined, 'a cgroup counter that fell gives none');
  b.usage(5e9);
  await s.walk();
  assert.equal(s.part().unattributed.cpu, (4e9 / 1e6 / 15) - s.part().places.reduce((a, p) => a + p.cpu, 0) - s.part().outside.cpu);
  fs.rmSync(path.join(b.cgroup, 'cpu.stat'));
  await s.walk();
  assert.equal(s.part().unattributed, undefined, 'no cpu.stat, no unattributed');
  assert.equal(s.part().outside.cpu, 0, 'a process that used none is 0 once there is CPU');
});

test('P3: a test run is given apart, within its place\'s CPU and memory, its tree once', async () => {
  const b = fakeProc(newDir());
  const roots = [{ root: '/w/a', name: 'alpha' }];
  const wt = '/w/a/.worktrees/kit-1';
  b.add({ pid: 20, ppid: 2, argv: ['bash'], cwd: wt, pages: 1 });
  b.add({ pid: 21, ppid: 20, argv: ['node', '/k/devteam.mjs', 'gate', 'test', '--', 'node', '--test'], cwd: wt, pages: 2 });
  b.add({ pid: 22, ppid: 21, argv: ['node', '--test', '--test-concurrency=2', 'test/x.test.mjs'], cwd: wt, pages: 4 });
  b.add({ pid: 23, ppid: 22, argv: ['node', 'test/x.test.mjs'], cwd: wt, pages: 8 });
  b.add({ pid: 24, ppid: 20, argv: ['node', '--test-concurrency=2', 'y.mjs'], cwd: wt, pages: 16 });
  b.add({ pid: 25, ppid: 20, argv: ['go', 'test', './...'], cwd: wt, pages: 32 });
  const s = await started(b, roots);
  await s.first();
  const p = place(s.part(), 'alpha', 'kit-1');
  assert.deepEqual(p.tests, { n: 2, rss: 46 * PAGE }, 'the gate tree is one run (21, 22, 23) and go test another; --test-concurrency alone is none');
  assert.equal(p.rss, 63 * PAGE, 'tests are within the place');
  b.set(23, { cpu: 15 * HZ });
  b.set(24, { cpu: 15 * HZ * 0.5 });
  await s.walk();
  near(place(s.part(), 'alpha', 'kit-1').tests.cpu, 1);
  near(place(s.part(), 'alpha', 'kit-1').cpu, 1.5);
});

test('P4: what makes a test run, and what devteam\'s own commands are', () => {
  const { procClassify } = load();
  const testRun = [
    ['node', '/k/docs/devteam/scripts/devteam.mjs', 'gate', 'ci', '--', 'gh'], ['node', '--test', 'a.mjs'], ['node', '--test'],
    ['vitest', 'run'], ['/usr/bin/jest'], ['mocha'], ['rspec'], ['pytest', '-x'], ['playwright', 'test'], ['go', 'test', './...'], ['cargo', 'test'],
    ['node', '/r/node_modules/vitest/vitest.mjs', 'run'], ['node', '/r/node_modules/jest/bin/jest.js'], ['node', '/r/node_modules/mocha/bin/mocha.js'],
    ['node', '/r/node_modules/@playwright/test/cli.js', 'test'], ['node', '/r/node_modules/playwright/cli.js', 'test'],
    ['python3', '-m', 'pytest'], ['python3', '/v/bin/pytest'], ['ruby', '/g/bin/rspec'],
  ];
  for (const w of testRun) assert.equal(procClassify(w).test, true, w.join(' '));
  const none = [
    ['node', '/k/devteam.mjs', 'hub'], ['node', '--test-concurrency=2', 'a.mjs'], ['node', 'a.mjs', '--test'], ['go', 'build'], ['cargo', 'build'],
    ['python3', 'pytest.txt'], ['npm', 'test'], ['bash', '-c', 'vitest'], [],
  ];
  for (const w of none) assert.equal(procClassify(w).test, false, w.join(' '));
  assert.deepEqual(['claude', 'codex', 'opencode', 'chrome', 'chromium', 'headless_shell', 'chrome-headless-shell', 'chromium-browser', 'node', 'bash'].map((x) => procClassify([`/bin/${x}`, 'a']).kind),
    ['agent', 'agent', 'agent', 'browser', 'browser', 'browser', 'browser', 'browser', 'node', null]);
  assert.equal(procClassify(['node', '/k/devteam.mjs', 'gate']).kind, null, 'devteam is not node');
  for (const w of [['node', '/k/devteam.mjs', 'hub'], ['node', '/k/devteam.mjs', 'dashboard'], ['node', '/opt/devteam/gateway.mjs'], ['tmux', 'new-session'], ['/usr/bin/tmux']]) assert.equal(procClassify(w).own, true, w.join(' '));
  for (const w of [['node', 'a.mjs'], ['claude'], ['chrome']]) assert.equal(procClassify(w).own, false, w.join(' '));
});

// ===== 2: short-lived processes =====

test('P5: children living less than one walk count for their parent\'s worktree', async () => {
  const b = fakeProc(newDir());
  const roots = [{ root: '/w/a', name: 'alpha' }];
  b.add({ pid: 30, ppid: 2, argv: ['bash'], cwd: '/w/a/.worktrees/kit-1', cpu: 100, reaped: 900 });
  const s = await started(b, roots);
  await s.first();
  b.set(30, { cpu: 100 + 30, reaped: 900 + 15 * HZ * 2 });
  await s.walk();
  near(place(s.part(), 'alpha', 'kit-1').cpu, 2 + 0.3 / 15 * 1, 'own and reaped');
});

test('P6: a vanished child that had itself reaped, and its vanished descendants, are not counted twice', async () => {
  const b = fakeProc(newDir());
  const roots = [{ root: '/w/a', name: 'alpha' }];
  const wt = '/w/a/.worktrees/kit-1';
  b.add({ pid: 40, ppid: 2, argv: ['bash'], cwd: wt, cpu: 0, reaped: 0 });
  b.add({ pid: 41, ppid: 40, argv: ['node', 'c.mjs'], cwd: wt, cpu: 300, reaped: 200 });
  b.add({ pid: 42, ppid: 41, argv: ['node', 'g.mjs'], cwd: wt, cpu: 100, reaped: 0 });
  const s = await started(b, roots);
  await s.first();
  // between walks: 42 runs 50 more and is reaped by 41; 41 runs 60 more and is reaped by 40
  b.gone(42); b.gone(41);
  b.set(40, { reaped: (300 + 60) + (200 + 100 + 50) });
  await s.walk();
  near(place(s.part(), 'alpha', 'kit-1').cpu, (60 + 50) / HZ / 15, 'only what the gone ones ran since the walk');
  near(s.part().unattributed.cpu, 0);
});

test('P7: no change is below zero: a counter that fell, and gone children whose time was not reaped here', async () => {
  const b = fakeProc(newDir());
  const roots = [{ root: '/w/a', name: 'alpha' }];
  const wt = '/w/a/.worktrees/kit-1';
  b.add({ pid: 50, ppid: 2, argv: ['bash'], cwd: wt, cpu: 1000, reaped: 0 });
  b.add({ pid: 51, ppid: 50, argv: ['node', 'c.mjs'], cwd: wt, cpu: 800 });
  b.add({ pid: 52, ppid: 2, argv: ['bash'], cwd: '/w/a', cpu: 500, reaped: 500 });
  const s = await started(b, roots);
  await s.first();
  b.gone(51);
  b.set(50, { cpu: 900, reaped: 100 });
  b.set(52, { cpu: 400, reaped: 400 });
  await s.walk();
  assert.equal(place(s.part(), 'alpha', 'kit-1').cpu, 0);
  assert.equal(place(s.part(), 'alpha', undefined).cpu, 0);
});

test("P8: pid 1's, systemd's, init's and tini's reaped time is left out; their own time is not", async () => {
  const b = fakeProc(newDir());
  const roots = [{ root: '/w/a', name: 'alpha' }];
  b.add({ pid: 1, ppid: 0, argv: ['/sbin/docker-init'], comm: 'docker-init', cwd: '/w/a', cpu: 0, reaped: 0 });
  b.add({ pid: 60, argv: ['/lib/systemd/systemd', '--user'], comm: 'systemd', cwd: '/w/a', cpu: 0, reaped: 0 });
  b.add({ pid: 61, argv: ['init'], comm: 'init', cwd: '/w/a', reaped: 0 });
  b.add({ pid: 62, argv: ['tini', '--'], comm: 'tini', cwd: '/w/a', reaped: 0 });
  b.add({ pid: 63, argv: ['tinier'], comm: 'tinier', cwd: '/w/a/.worktrees/kit-1', reaped: 0 });
  const s = await started(b, roots);
  await s.first();
  for (const pid of [1, 60, 61, 62]) b.set(pid, { reaped: 15 * HZ });
  b.set(60, { cpu: 15 * HZ * 0.5 });
  b.set(63, { reaped: 15 * HZ });
  await s.walk();
  near(place(s.part(), 'alpha', undefined).cpu, 0.5, "systemd's own time counts, no reaper's reaped");
  near(place(s.part(), 'alpha', 'kit-1').cpu, 1, 'tinier is no reaper');
});

test('P9: after a walk cut off at 2 s no change is worked out until two whole walks have run', async () => {
  const b = fakeProc(newDir());
  const roots = [{ root: '/w/a', name: 'alpha' }];
  for (let i = 0; i < 250; i++) b.add({ pid: 1000 + i, ppid: 2, argv: ['node', 'x.mjs'], cwd: '/w/a', cpu: 0 });
  const s = await started(b, roots);
  await s.first();
  for (let i = 0; i < 250; i++) b.set(1000 + i, { cpu: (i + 1) * 15 });
  s.turn.each = () => { s.clock.real += 1100; };
  await s.walk();
  assert.equal(s.part(), undefined, 'a cut walk gives nothing');
  assert.equal(s.said.filter((w) => /cut off at 2 s/.test(w)).length, 1);
  s.turn.each = () => {};
  await s.walk();
  const one = s.part();
  assert.equal(one.over_s, undefined, 'the first whole walk after it has no CPU');
  assert.equal(place(one, 'alpha', undefined).cpu, undefined);
  assert.equal(place(one, 'alpha', undefined).n, 250);
  for (let i = 0; i < 250; i++) b.set(1000 + i, { cpu: (i + 1) * 15 + 15 * HZ });
  await s.walk();
  assert.equal(s.part().over_s, 15);
  near(place(s.part(), 'alpha', undefined).cpu, 250);
  // a read of cmdline and cwd that never settles ends the reading, not the walk (final-1 F1)
  b.add({ pid: 3000, ppid: 2, argv: ['node', 'y.mjs'], cwd: '/w/a' });
  s.hang.add('3000');
  s.turn.late = true;
  await s.walk();
  assert.ok(s.timers.some((t) => t.kind === 'timeout' && t.ms > 0 && t.ms <= 2000), "the reads race what is left of the walk's 2 s");
  assert.equal(s.part().over_s, 15, 'the walk is whole');
  assert.equal(s.part().outside.n, 1, 'the process not read yet counts outside');
  s.release();
});

test('P19: a cmdline or cwd read that never settles is started once across walks, at most two reads are out, and the walks go on', async () => {
  const b = fakeProc(newDir());
  const roots = [{ root: '/w/a', name: 'alpha' }];
  b.add({ pid: 10, ppid: 2, argv: ['node', 'a.mjs'], cwd: '/w/a', cpu: 0 });
  const s = await started(b, roots);
  s.turn.late = true;
  await s.first();
  for (const pid of [3000, 3001]) { b.add({ pid, ppid: 2, argv: ['node', 'y.mjs'], cwd: '/w/a' }); s.hang.add(String(pid)); }
  b.add({ pid: 3002, ppid: 2, argv: ['node', 'z.mjs'], cwd: '/w/a' });
  for (let i = 1; i <= 6; i++) {
    b.set(10, { cpu: i * 15 * HZ });
    await s.walk();
    const r = s.part();
    assert.ok(r, `walk ${i} gives a result`);
    near(place(r, 'alpha', undefined).cpu, 1, `walk ${i}: CPU goes on`);
    assert.equal(r.outside.n, 3, `walk ${i}: the processes not read yet count outside`);
    assert.ok(s.out.most <= 2, `walk ${i}: at most two reads out (${s.out.most})`);
  }
  assert.deepEqual([s.by.get('3000'), s.by.get('3001'), s.by.get('3002') ?? 0], [1, 1, 0], 'each hung read started once in 6 walks; a third waits for a slot');
  assert.equal(s.said.filter((w) => /did not answer within 2 s/.test(w)).length, 1, 'said once');
  s.release();
  await new Promise((res) => setTimeout(res, 20));
  await s.walk();
  await s.walk();
  const r = s.part();
  assert.equal(r.outside.n, 0, 'once they answer, they are read and placed');
  assert.equal(place(r, 'alpha', undefined).n, 4);
});

test('P20: a run/ file that never answers is waited for 2 s, once; the walks go on with the last pids', async () => {
  const { s, A } = await strayBox();
  const has = () => s.part().strays.some((g) => g.kind === 'browser' && g.why === 'parent-gone' && g.n === 2);
  assert.equal(has(), false, 'the recorded chrome is no stray');
  fs.writeFileSync(path.join(A, 'docs', 'devteam', 'run', 'browser', 'state.json'), JSON.stringify({ browser: 1 }));
  s.hang.add('browser');
  s.turn.late = true;
  const was = s.by.get('browser');
  for (let i = 1; i <= 5; i++) {
    s.roots.list = [...s.roots.list];
    await s.walk();
    assert.ok(s.part().over_s, `walk ${i} gives a result with CPU`);
    assert.equal(has(), false, `walk ${i}: the last pids are kept`);
  }
  assert.equal(s.by.get('browser') - was, 1, 'one read of state.json started in 5 walks');
  assert.equal(s.said.filter((w) => /run\/ files did not answer/.test(w)).length, 1, 'said when it was late');
  s.release();
  await new Promise((res) => setTimeout(res, 20));
  s.roots.list = [...s.roots.list];
  await s.walk();
  assert.equal(has(), true, 'once it answers, the new pids hold');
});

// ===== 3: strays =====

// A fake box with every case: { s, b } after one walk, uptime 100000 s.
async function strayBox() {
  const b = fakeProc(newDir());
  const d = newDir();
  const roots = [{ root: path.join(d, 'a'), name: 'alpha' }, { root: path.join(d, 'b'), name: 'beta' }];
  const [A, B] = roots.map((r) => r.root);
  const run = path.join(A, 'docs', 'devteam', 'run');
  fs.mkdirSync(path.join(run, 'browser'), { recursive: true });
  fs.mkdirSync(path.join(run, 'sensors', 'hub'), { recursive: true });
  fs.writeFileSync(path.join(run, 'browser', 'state.json'), JSON.stringify({ browser: 1, daemon_pid: 120, chrome_pid: 121 }));
  fs.writeFileSync(path.join(run, 'supervisor-up.json'), JSON.stringify({ up: true, kind: 'foreground', pid: 122 }));
  fs.writeFileSync(path.join(run, 'sensors', 'hub', 'stream.pid'), '123\n');
  const old = (100000 - 3600) * HZ, young = (100000 - 300) * HZ, ancient = (100000 - 7200) * HZ;
  const wt = `${A}/.worktrees/kit-1`;
  b.add({ pid: 2, ppid: 1, argv: ['tini', '--'], comm: 'tini', cwd: '/', start: 0 });
  b.add({ pid: 3, ppid: 1, argv: ['bash'], cwd: wt, start: 0 });
  // folder-gone, any of the four kinds, whatever its parent
  b.add({ pid: 100, ppid: 3, argv: ['claude'], cwd: `${A}/.worktrees/kit-9 (deleted)`, start: old, pages: 5 });
  b.add({ pid: 101, ppid: 3, argv: ['node', 'dev.mjs'], cwd: `${A}/.worktrees/kit-9 (deleted)`, start: old, pages: 7 });
  // parent-gone: browser, node, test, with pid 1 or a tini as parent
  b.add({ pid: 102, ppid: 1, argv: ['/opt/chrome/chrome-headless-shell', '--x'], cwd: wt, start: old, pages: 11 });
  b.add({ pid: 103, ppid: 1, argv: ['node', 'server.mjs'], cwd: wt, start: old, pages: 13 });
  b.add({ pid: 104, ppid: 2, argv: ['node', 'other.mjs'], cwd: wt, start: ancient, pages: 17 });
  b.add({ pid: 105, ppid: 1, argv: ['node', '--test', 'x.mjs'], cwd: `${B}/.worktrees/kit-5`, start: old, pages: 19 });
  b.add({ pid: 106, ppid: 1, argv: ['node', 'x.mjs'], cwd: '/srv/elsewhere', start: old, pages: 23 });
  // long-test: its run's top over an hour old, its parent alive
  b.add({ pid: 107, ppid: 3, argv: ['vitest', 'run'], cwd: wt, start: ancient, pages: 29 });
  b.add({ pid: 108, ppid: 107, argv: ['node', 'worker.mjs'], cwd: wt, start: old, pages: 31 });
  // not strays
  b.add({ pid: 110, ppid: 1, argv: ['claude'], cwd: wt, start: old }); // an agent is never parent-gone
  b.add({ pid: 111, ppid: 1, argv: ['node', 'young.mjs'], cwd: wt, start: young }); // under 10 minutes
  b.add({ pid: 112, ppid: 3, argv: ['node', 'kept.mjs'], cwd: wt, start: old }); // its parent is alive
  b.add({ pid: 113, ppid: 3, argv: ['vitest'], cwd: wt, start: old }); // a test under an hour
  b.add({ pid: 114, ppid: 1, argv: ['bash'], cwd: wt, start: old }); // not one of the four kinds
  b.add({ pid: 115, ppid: 1, argv: ['node', '/k/docs/devteam/scripts/devteam.mjs', 'hub'], cwd: '/', start: old }); // devteam's own
  b.add({ pid: 116, ppid: 1, argv: ['node', '/opt/devteam/gateway.mjs'], cwd: '/', start: old });
  b.add({ pid: 117, ppid: 1, argv: ['tmux', 'new-session', '-d'], cwd: '/', start: old });
  b.add({ pid: 118, ppid: 117, argv: ['tini', '--'], comm: 'tini', cwd: wt, start: old });
  b.add({ pid: 119, ppid: 118, argv: ['node', 'under-tmux.mjs'], cwd: wt, start: old }); // a tini's child, under tmux
  b.add({ pid: 125, ppid: 115, argv: ['tini', '--'], comm: 'tini', cwd: wt, start: old });
  b.add({ pid: 126, ppid: 125, argv: ['node', 'under-hub.mjs'], cwd: wt, start: old }); // a tini's child, under the hub
  for (const pid of [120, 121, 122, 123]) b.add({ pid, ppid: 1, argv: pid === 121 ? ['chrome', '--x'] : ['node', `r${pid}.mjs`], cwd: wt, start: old }); // recorded in run/
  b.add({ pid: 124, ppid: 121, argv: ['chrome', '--type=renderer'], cwd: wt, start: old }); // under a recorded pid
  const s = await started(b, roots);
  await s.first();
  return { s, b, roots, A, B };
}

test('P10: strays are folder-gone, parent-gone and long-test by the design\'s rules, each left-out case left out', async () => {
  const { s } = await strayBox();
  const got = s.part().strays;
  assert.deepEqual(got, [
    { project: 'alpha', kind: 'node', why: 'parent-gone', n: 2, oldest_s: 7200, rss: 30 * PAGE },
    { project: 'alpha', kind: 'test', why: 'long-test', n: 2, oldest_s: 7200, rss: 60 * PAGE },
    { kind: 'node', why: 'parent-gone', n: 1, oldest_s: 3600, rss: 23 * PAGE },
    { project: 'beta', kind: 'test', why: 'parent-gone', n: 1, oldest_s: 3600, rss: 19 * PAGE },
    { project: 'alpha', kind: 'browser', why: 'parent-gone', n: 1, oldest_s: 3600, rss: 11 * PAGE },
    { project: 'alpha', kind: 'node', why: 'folder-gone', n: 1, oldest_s: 3600, rss: 7 * PAGE },
    { project: 'alpha', kind: 'agent', why: 'folder-gone', n: 1, oldest_s: 3600, rss: 5 * PAGE },
  ].sort((a, b) => b.rss - a.rss || b.n - a.n));
  const pool = { projects: [], allocated: [], recent: [], strays: got };
  assert.equal(boxHealthProblem({ v: 1, at: '2026-11-25T12:00:00Z', window_s: 3600, now: {}, samples: [], pool }), null, 'box-health@1 takes them');
});

test('P11: strays group by project, kind and why, at most 40, most memory first, with CPU once there is CPU', async () => {
  const b = fakeProc(newDir());
  const roots = Array.from({ length: 45 }, (_, i) => ({ root: `/w/p${i}`, name: `p${i}` }));
  for (let i = 0; i < 45; i++) b.add({ pid: 200 + i, ppid: 1, argv: ['node', 's.mjs'], cwd: `/w/p${i}`, start: 0, pages: 100 + i });
  const s = await started(b, roots);
  await s.first();
  const got = s.part().strays;
  assert.equal(got.length, 40);
  assert.deepEqual(got.map((g) => g.project), Array.from({ length: 40 }, (_, i) => `p${44 - i}`));
  b.set(244, { cpu: 15 * HZ });
  await s.walk();
  near(s.part().strays[0].cpu, 1);
});

test('P12: the pids a root\'s run/ records are read again each minute', async () => {
  const { s, b, A } = await strayBox();
  const run = path.join(A, 'docs', 'devteam', 'run');
  const has = () => s.part().strays.some((g) => g.kind === 'browser' && g.why === 'parent-gone' && g.n === 2);
  fs.writeFileSync(path.join(run, 'browser', 'state.json'), JSON.stringify({ browser: 1, daemon_pid: 120 }));
  const reads = s.reads.other;
  await s.walk();
  assert.equal(has(), false, 'not read again while the roots list is the same');
  assert.equal(s.reads.other, reads + 2, 'uptime and cpu.stat, and no run/ file');
  s.roots.list = [...s.roots.list];
  await s.walk();
  assert.equal(has(), true, 'a chrome no longer recorded is a stray, once the sampler reads the roots again');
  b.gone(102);
});

// ===== 4: the budget and what leaves the region =====

test('P13: one stat a process a walk; cmdline and cwd only for a new (pid, start time) or after 5 minutes; environ never', async () => {
  const b = fakeProc(newDir());
  for (let i = 0; i < 30; i++) b.add({ pid: 500 + i, argv: ['node', 'x.mjs'], cwd: '/w' });
  const s = await started(b, [{ root: '/w', name: 'w' }]);
  const was = () => ({ ...s.reads });
  await s.first();
  const r1 = was();
  assert.equal(r1.stat, 30);
  assert.equal(r1.cmdline, 30);
  assert.equal(r1.cwd, 30);
  await s.walk();
  const r2 = was();
  assert.deepEqual([r2.stat - r1.stat, r2.cmdline - r1.cmdline, r2.cwd - r1.cwd], [30, 0, 0], 'known processes');
  b.add({ pid: 531, argv: ['node', 'y.mjs'], cwd: '/w' });
  fs.rmSync(path.join(b.proc, '531', 'cmdline'));
  await s.walk();
  const r2b = was();
  assert.deepEqual([r2b.stat - r2.stat, r2b.cmdline - r2.cmdline, r2b.cwd - r2.cwd], [31, 1, 0], 'a new process whose cmdline cannot be read');
  await s.walk();
  const r2c = was();
  assert.deepEqual([r2c.stat - r2b.stat, r2c.cmdline - r2b.cmdline, r2c.cwd - r2b.cwd], [31, 0, 0], 'is known as nothing, not read again');
  assert.equal(s.part().outside.n, 1, 'and counts outside');
  b.gone(531);
  b.gone(500);
  b.add({ pid: 500, argv: ['node', 'x.mjs'], cwd: '/w', start: 99999 });
  await s.walk(3 * MIN + 15000);
  const r3 = was();
  assert.deepEqual([r3.stat - r2c.stat, r3.cmdline - r2c.cmdline, r3.cwd - r2c.cwd], [30, 1, 1], 'a pid with a new start time is new');
  await s.walk(MIN);
  const r4 = was();
  assert.deepEqual([r4.stat - r3.stat, r4.cmdline - r3.cmdline, r4.cwd - r3.cwd], [30, 29, 29], 'read again at 5 minutes');
  assert.equal(r4.environ, 0, 'environ is never read');
});

test('P14: walks never overlap', async () => {
  const b = fakeProc(newDir());
  for (let i = 0; i < 250; i++) b.add({ pid: 600 + i, argv: ['node', 'x.mjs'], cwd: '/w' });
  const s = await started(b, [{ root: '/w', name: 'w' }]);
  const every = s.timers.find((t) => t.kind === 'every' && t.ms === 15000);
  await Promise.all([every.fn(), every.fn(), every.fn()]);
  assert.equal(s.reads.stat, 250, 'one walk ran');
  await every.fn();
  assert.equal(s.reads.stat, 500, 'the next one runs once it ended');
});

test('P15: nothing is killed or started, and no argument or environment value leaves the region', async () => {
  // (a RegExp's .exec is a read, not a child)
  for (const bad of [/\bkill\b/, /\bspawn/, /(?<!\.)\bexec/, /\bfork\b/, /environ/, /child_process/]) assert.doesNotMatch(body, bad);
  for (const bad of ['process.kill(1)', 'spawnSync(a)', 'execFile(a)', 'fork(a)', "readFile('environ')"]) assert.ok([/\bkill\b/, /\bspawn/, /(?<!\.)\bexec/, /\bfork\b/, /environ/].some((re) => re.test(bad)), bad);
  assert.doesNotMatch('re.exec(s)', /(?<!\.)\bexec/);
  const { s } = await strayBox();
  await s.walk();
  const out = JSON.stringify(s.part()) + JSON.stringify(s.said);
  for (const x of [SECRET, ENV_SECRET, '--marker', 'dev.mjs', 'server.mjs', '--type', 'new-session']) assert.ok(!out.includes(x), x);
});

test('P18: start sets one interval and reads nothing, so the first walk comes after the sampler has read the roots', async () => {
  const b = fakeProc(newDir());
  b.add({ pid: 900, argv: ['node', 'x.mjs'], cwd: '/w' });
  const s = await started(b, [{ root: '/w', name: 'w' }]);
  assert.deepEqual(s.reads, { stat: 0, cmdline: 0, cwd: 0, environ: 0, other: 0 });
  assert.equal(s.part(), undefined);
});

test('P16: with no /proc it gives nothing, said once; stop forgets the run', async () => {
  const b = fakeProc(newDir());
  b.add({ pid: 700, argv: ['node', 'x.mjs'], cwd: '/w' });
  const s = await started(b, [{ root: '/w', name: 'w' }]);
  await s.first();
  assert.ok(s.part());
  fs.rmSync(b.proc, { recursive: true });
  await s.walk();
  await s.walk();
  assert.equal(s.part(), undefined);
  assert.equal(s.said.filter((w) => /can't be listed/.test(w)).length, 2, "the fake ctx keeps each line; the sampler's say keeps one");
  s.boxHealthProcesses.stop();
  assert.equal(s.part(), undefined);
});

// ===== 5: in the sampler =====

test("P17: in the kit's sampler its walks run on ctx's timers, and the part after it gets the result", async () => {
  const b = fakeProc(newDir());
  b.add({ pid: 800, ppid: 2, argv: ['claude'], cwd: '/w/alpha/.worktrees/kit-1', cpu: 0 });
  const clock = { t: T0 }, timers = [], logs = [];
  const set = (kind) => (fn, ms) => { const h = { kind, ms, fn, unref() {} }; timers.push(h); return h; };
  const fos = { cpus: () => [{ times: { user: 0, nice: 0, sys: 0, irq: 0, idle: 0 } }], loadavg: () => [0, 0, 0], totalmem: () => 16e9, freemem: () => 8e9, homedir: () => scratch };
  const names = {
    fs, path, os: fos, Buffer, URL, structuredClone, HUB_PORT: 20001, setImmediate,
    process: { env: { DEVTEAM_BOX_HEALTH: 'on', DEVTEAM_PROC: b.proc, DEVTEAM_CGROUP: b.cgroup }, pid: 4242, memoryUsage: { rss: () => 1 } },
    setTimeout: set('once'), clearTimeout: () => {}, setInterval: set('every'), clearInterval: () => {},
    machineRepos: () => ['/w/alpha'], machineMemory: () => null,
  };
  const code = `'use strict';\n${['box-memory', 'box-health-contract', 'box-health-sampler', 'box-health-processes'].map((n) => regionOf(n, src)).join('\n')}\nreturn { boxHealth, boxHealthProcesses };`;
  const { boxHealth, boxHealthProcesses } = new Function(...Object.keys(names), code)(...Object.values(names));
  const seen = [];
  const probe = { start() {}, part(ctx, parts) { seen.push(parts.processes); }, stop() {} };
  const health = boxHealth((m) => logs.push(m), async () => [], { parts: [['processes', boxHealthProcesses], ['probe', probe]], real: () => clock.t });
  await health.start();
  assert.equal(seen.at(-1), undefined, 'nothing before a walk');
  await timers.find((h) => h.kind === 'every' && h.ms === 15000).fn();
  await health.tick();
  assert.deepEqual(seen.at(-1).places.map((p) => [p.project, p.worktree, p.agents]), [['alpha', 'kit-1', 1]]);
  clock.t += 15000;
  b.set(800, { cpu: 15 * HZ });
  await timers.find((h) => h.kind === 'every' && h.ms === 15000).fn();
  await health.tick();
  near(seen.at(-1).places[0].cpu, 1);
  assert.deepEqual(logs, []);
  health.stop();
});
