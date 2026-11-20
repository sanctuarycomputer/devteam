// The memory recorder (kit-591): the machine's hub reads memory once a minute into
// ~/.devteam/machine-<hub port>/memory.jsonl (machine-memory@1, kit-590's contract) and serves a
// window of it at /memory.json. A standalone hub runs from a copy of the kit with no repo (as the box
// image's), over kit-590's fake /proc and cgroup (test/fixtures/box-memory/, read, never changed) or
// a scratch /proc made here; the pure parts of the box-memory region run under node:vm with nothing
// in scope.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { PORTS, bareProject, json, kit, startDashboard, testDir, until } from './lib/kit.mjs';

const FIX = path.join(testDir, 'fixtures', 'box-memory');
const PROC = path.join(FIX, 'proc');
const CGROUP = path.join(PROC, 'cgroup');
const EXPECTED = json(fs.readFileSync(path.join(FIX, 'proc-expected.json'), 'utf8'));
const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b); assert.ok(i >= 0 && j > i, `${a} … ${b} marks a block in devteam.mjs`); return src.slice(i, j); };
const region = () => cut('/* box-memory start */', '/* box-memory end */');
// the region's names, evaluated with nothing in scope: a part that reaches outside throws when called
const fns = (names) => vm.runInContext(`${region()}\n;({ ${names.join(', ')} })`, vm.createContext({}));
const { memoryReadingProblem } = fns(['memoryReadingProblem']);

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-memrec-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
const NOWHERE = path.join(scratch, 'no-such-machine');
// The kit as the box image has it: a copy in no repo, so it runs as itself wherever the test is.
const imageKit = path.join(scratch, 'kit');
fs.cpSync(kit, imageKit, { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
const SCRIPT = path.join(imageKit, 'scripts', 'devteam.mjs');

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
let homes = 0;
const newHome = () => { const h = path.join(scratch, `home-${++homes}`); fs.mkdirSync(h); return h; };
let ports = 0;
// Each hub its own port in this file's block (+2..+29); its scan block (+50..+74) has nothing on it.
const nextPort = () => PORTS + 2 + (ports++ % 28);
const memFile = (home, port) => path.join(home, '.devteam', `machine-${port}`, 'memory.jsonl');
const linesOf = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean); } catch { return []; } };

function get(port, route, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.get({ host: '127.0.0.1', port, path: route, headers: { host: `127.0.0.1:${port}`, ...headers }, timeout: 20000 }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, body: b, json: j, headers: res.headers }); });
    });
    r.on('timeout', () => r.destroy(new Error(`${route} timed out`)));
    r.on('error', reject);
  });
}

// A standalone hub: { home, port, file, out, stop }. roots: [[root, name?]] written to the machine
// registry; file: lines to seed memory.jsonl with; env: more variables (undefined deletes one).
async function startHub(t, { proc = PROC, cgroup = CGROUP, roots = [], file = null, env = {}, record = true } = {}) {
  const home = newHome();
  const port = nextPort();
  const reg = path.join(home, '.devteam', `repos-${port}`);
  fs.mkdirSync(reg, { recursive: true });
  roots.forEach((r, i) => fs.writeFileSync(path.join(reg, `r${i}.json`), JSON.stringify({ root: r, at: iso(Date.now()) })));
  const f = memFile(home, port);
  if (file) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, file); }
  const e = { ...process.env, HOME: home, DEVTEAM_HUB_PORT: String(port), DEVTEAM_PORT_BASE: String(PORTS + 50), DEVTEAM_PROC: proc, DEVTEAM_CGROUP: cgroup, DEVTEAM_MEMINFO: NOWHERE, ...env };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_HOME', 'DEVTEAM_IMAGE_HUB', 'TMUX', 'TMUX_PANE']) delete e[k];
  if (record) delete e.DEVTEAM_MEMORY_RECORD;
  for (const [k, v] of Object.entries(e)) if (v === undefined) delete e[k];
  const p = spawn(process.execPath, [SCRIPT, 'hub'], { cwd: home, env: e, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = '';
  p.stdout.on('data', (b) => { out += b; });
  p.stderr.on('data', (b) => { out += b; });
  const stop = () => (p.exitCode !== null || p.signalCode !== null ? Promise.resolve() : new Promise((r) => { p.once('exit', r); try { process.kill(-p.pid, 'SIGKILL'); } catch { r(); } }));
  t.after(stop);
  await until(async () => { try { return (await get(port, '/instances.json')).status === 200; } catch { return p.exitCode !== null; } }, `the hub on ${port}`);
  assert.equal(p.exitCode, null, `the hub runs (${out})`);
  return { home, port, file: f, out: () => out, stop };
}
const firstLine = async (h, n = 1) => { await until(() => linesOf(h.file).length >= n, `${n} line(s) in ${h.file}`); return linesOf(h.file); };
const FIXTURE_ROOTS = Object.values(EXPECTED.roots);

// ===== D1: the reading =====

test('C1a: over kit-590\'s fake /proc the hub writes one reading equal to proc-expected.json\'s, which the check accepts', async (t) => {
  const h = await startHub(t, { roots: FIXTURE_ROOTS, env: { DEVTEAM_MEMORY_COUNTS_CACHE: '1' } });
  const [l, ...rest] = await firstLine(h);
  assert.deepEqual(rest, [], 'one line on the first tick');
  assert.equal(memoryReadingProblem(l), null, l);
  const r = JSON.parse(l);
  const want = EXPECTED.reading;
  for (const k of ['v', 'working_set', 'max', 'source', 'sessions', 'kinds', 'devteam', 'projects']) assert.deepEqual(r[k], want[k], k);
  assert.equal(r.partial, undefined, 'a whole tick');
  assert.ok(Math.abs(Date.parse(r.at) - Date.now()) < 5 * MIN, `at is now (${r.at})`);
  assert.equal(r.ceiling, 0.8, 'the default ceiling: neither fixture root has settings');
});

test('C1b: without the box image\'s cache switch, working_set is what machineMemory() counts then', async (t) => {
  const h = await startHub(t, { roots: FIXTURE_ROOTS });
  const r = JSON.parse((await firstLine(h))[0]);
  // memory.current - (file - shmem): devteam.mjs machineMemory, no DEVTEAM_MEMORY_COUNTS_CACHE
  assert.equal(r.working_set, 23622320128 - (8053063680 - 536870912));
  assert.equal(r.source, 'cgroup');
});

test('C1c: the ceiling is the lowest valid machine_memory_ceiling among the known roots', async (t) => {
  const settings = (root, name, ceiling) => {
    const d = path.join(root, 'docs', 'devteam', 'project');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'settings.md'), `# Settings\n\n\`\`\`json devteam\n${JSON.stringify({ project: name, machine_memory_ceiling: ceiling })}\n\`\`\`\n`);
    return root;
  };
  const low = settings(path.join(scratch, 'ceil-low'), 'ceil-low', 0.7);
  const bad = settings(path.join(scratch, 'ceil-bad'), 'ceil-bad', 0.3);
  const h = await startHub(t, { roots: [...FIXTURE_ROOTS, low, bad] });
  const r = JSON.parse((await firstLine(h))[0]);
  assert.equal(r.ceiling, 0.7);
  assert.deepEqual(Object.keys(r.projects).sort(), ['devteam-dev', 'mothership'], 'a root with no process is in no project');
});

test('C1d: the classifier skips node\'s options, keeps only command names, and needs an install subcommand', () => {
  const { memoryWords, memoryClassify } = fns(['memoryWords', 'memoryClassify']);
  const commands = new Set(['wait', 'gate', 'dashboard', 'hello']);
  const c = (cmdline) => memoryClassify(memoryWords(cmdline), commands);
  const DT = '/r/docs/devteam/scripts/devteam.mjs';
  assert.deepEqual(c(`node\0--max-old-space-size=4096\0${DT}\0wait\0`), { kind: 'devteam', subcommand: 'wait' });
  assert.deepEqual(c(`node\0${DT}\0no-such-command\0`), { kind: 'devteam' });
  assert.deepEqual(c('/usr/bin/yarn.js\0'), { kind: 'other' });
  assert.deepEqual(c('npm ci\0'), { kind: 'install' });
  assert.deepEqual(c('npm\0ci\0'), { kind: 'install' });
  assert.deepEqual(c('npm test\0'), { kind: 'other' });
  assert.deepEqual(c('node\0/usr/lib/node_modules/npm/bin/npm-cli.js\0test\0'), { kind: 'node' });
  assert.deepEqual(c('/usr/lib/chromium/chromium --type=renderer\0'), { kind: 'browser' });
  assert.deepEqual(c(''), { kind: 'other' });
});

// ===== D2: nothing of a command line, the environment or a path is kept =====

test('C2: the line holds only field names, kinds, command names, project names, the source and the time', async (t) => {
  const h = await startHub(t, { roots: FIXTURE_ROOTS, env: { DEVTEAM_MEMORY_COUNTS_CACHE: '1' } });
  const l = (await firstLine(h))[0];
  const r = JSON.parse(l);
  const allowed = new Set(['v', 'at', 'working_set', 'max', 'ceiling', 'source', 'partial', 'sessions', 'kinds', 'devteam', 'projects', 'n', 'rss',
    'agent', 'browser', 'install', 'node', 'other', 'dashboard', 'wait', 'hello', 'gate', 'devteam-dev', 'mothership', 'cgroup', r.at]);
  const walk = (v, where) => {
    if (typeof v === 'string') assert.ok(allowed.has(v), `${where}: ${JSON.stringify(v)} is kept`);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { assert.ok(allowed.has(k), `${where}: key ${JSON.stringify(k)} is kept`); walk(x, `${where}.${k}`); }
  };
  walk(r, 'reading');
  for (const s of ['FIXTURE-SECRET', '--', '/fixture', 'fixture', 'kit-1', 'm-2', 'npm test', 'server.js']) assert.ok(!l.includes(s), `the line holds ${s}`);
});

// ===== D3: refusals, edges and the file =====

// A scratch /proc: kit-590's, plus more pids. extra: [[pid, { cmdline?, statm?, cwd?, cwdFile? }]].
function procWith(name, extra, { base = true } = {}) {
  const d = path.join(scratch, name);
  if (base) fs.cpSync(PROC, d, { recursive: true, verbatimSymlinks: true });
  else fs.mkdirSync(d, { recursive: true });
  for (const [pid, f] of extra) {
    const p = path.join(d, String(pid));
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, 'comm'), 'x\n');
    if (f.cmdline !== undefined) fs.writeFileSync(path.join(p, 'cmdline'), f.cmdline);
    if (f.statm !== undefined) fs.writeFileSync(path.join(p, 'statm'), f.statm);
    if (f.cwd !== undefined) fs.symlinkSync(f.cwd, path.join(p, 'cwd'));
    if (f.cwdFile) fs.writeFileSync(path.join(p, 'cwd'), 'not a link');
  }
  return d;
}
const statm = (res) => `${res * 4} ${res} 10 10 0 ${res} 0\n`;

test('C3a: a process gone between the listing and the reads is skipped; an unreadable cwd only loses its project', async (t) => {
  const proc = procWith('proc-vanish', [
    [4242, {}],
    [4243, { cmdline: 'claude\0' }],
    [4244, { cmdline: 'claude\0', statm: statm(1000), cwdFile: true }],
  ]);
  const h = await startHub(t, { proc, roots: FIXTURE_ROOTS, env: { DEVTEAM_MEMORY_COUNTS_CACHE: '1' } });
  const r = JSON.parse((await firstLine(h))[0]);
  const want = structuredClone(EXPECTED.reading);
  want.kinds.agent.n += 1;
  want.kinds.agent.rss += 1000 * 4096;
  assert.deepEqual(r.kinds, want.kinds);
  assert.equal(r.sessions, want.sessions);
  assert.deepEqual(r.projects, want.projects);
});

test('C3b: with /proc unreadable the line has no sessions, kinds or projects', async (t) => {
  const h = await startHub(t, { proc: NOWHERE, roots: FIXTURE_ROOTS });
  const l = (await firstLine(h))[0];
  assert.equal(memoryReadingProblem(l), null, l);
  const r = JSON.parse(l);
  assert.equal(r.source, 'cgroup');
  assert.equal(r.max, 51539607552);
  assert.equal(r.ceiling, 0.8);
  for (const k of ['sessions', 'kinds', 'devteam', 'projects']) assert.equal(r[k], undefined, k);
});

test('C3c: with no /proc and no cgroup (macOS) the line is the host\'s in use and total, source os', async (t) => {
  const h = await startHub(t, { proc: NOWHERE, cgroup: NOWHERE });
  const l = (await firstLine(h))[0];
  const used = os.totalmem() - os.freemem();
  assert.equal(memoryReadingProblem(l), null, l);
  const r = JSON.parse(l);
  assert.equal(r.source, 'os');
  assert.equal(r.max, os.totalmem());
  assert.ok(Math.abs(r.working_set - used) <= 0.25 * os.totalmem(), `${r.working_set} near ${used}`);
  for (const k of ['sessions', 'kinds', 'devteam', 'projects']) assert.equal(r[k], undefined, k);
});

const many = (name) => procWith(name, Array.from({ length: 120 }, (_, i) => [3000 + i, { cmdline: 'sleep\x00600\x00', statm: statm(100), cwd: '/tmp' }]), { base: false });

test('C3d: a tick past its 2 s budget writes what it has, partial', async (t) => {
  const proc = many('proc-many');
  const slow = await startHub(t, { proc, cgroup: CGROUP, env: { DEVTEAM_MEMORY_SLOW_MS: '1200' } });
  const r = JSON.parse((await firstLine(slow))[0]);
  assert.equal(r.partial, true);
  assert.deepEqual(r.kinds, { other: { n: 100, rss: 100 * 100 * 4096 } }, 'two batches of 50, then the budget');
  await slow.stop();
  const fast = await startHub(t, { proc, cgroup: CGROUP });
  const w = JSON.parse((await firstLine(fast))[0]);
  assert.equal(w.partial, undefined);
  assert.deepEqual(w.kinds, { other: { n: 120, rss: 120 * 100 * 4096 } });
});

test('C3e: the walk is async: the hub answers /instances.json while a slowed tick walks', async (t) => {
  const proc = many('proc-many-async');
  const h = await startHub(t, { proc, cgroup: CGROUP, env: { DEVTEAM_MEMORY_SLOW_MS: '1500' } });
  const t0 = Date.now();
  const res = await get(h.port, '/instances.json');
  const took = Date.now() - t0;
  assert.equal(linesOf(h.file).length, 0, 'the tick is still walking');
  assert.equal(res.status, 200);
  assert.ok(took < 1000, `answered in ${took} ms`);
  const r = JSON.parse((await firstLine(h))[0]);
  assert.equal(r.partial, true);
});

test('C3f: at start the file loses readings older than 8 days and torn lines; a torn tail never spoils the next line', async (t) => {
  const now = Date.now();
  const old = JSON.stringify({ v: 1, at: iso(now - 9 * DAY), working_set: 1 });
  const week = JSON.stringify({ v: 1, at: iso(now - 7 * DAY), working_set: 2 });
  const h = await startHub(t, { proc: NOWHERE, file: `${old}\n${week}\n{"v":1,"at":"20`, env: { DEVTEAM_MEMORY_EVERY_MS: '300' } });
  const ls = await firstLine(h, 2);
  assert.equal(ls[0], week, 'the 7-day reading stays, first');
  assert.ok(!ls.includes(old), 'the 9-day reading is gone');
  for (const l of ls) assert.equal(memoryReadingProblem(l), null, l);
  // a hub killed mid-append leaves a torn tail: the next line starts on a line of its own
  const n = linesOf(h.file).length;
  fs.appendFileSync(h.file, '{"v":1,"at":"2026');
  const after = await firstLine(h, n + 2);
  assert.ok(after.includes('{"v":1,"at":"2026'), 'the torn line on its own');
  assert.equal(memoryReadingProblem(after.at(-1)), null, after.at(-1));
});

test('C3g: the trim runs again each day while the hub runs', async (t) => {
  const h = await startHub(t, { proc: NOWHERE, env: { DEVTEAM_MEMORY_TRIM_MS: '500' } });
  await firstLine(h);
  const old = JSON.stringify({ v: 1, at: iso(Date.now() - 9 * DAY), working_set: 1 });
  fs.appendFileSync(h.file, `${old}\n`);
  await until(() => !linesOf(h.file).includes(old), 'the 9-day reading trimmed');
  assert.ok(linesOf(h.file).length >= 1, 'the new reading stays');
});

// Readings one a minute from `from` to `to` (ms), working_set from a fixed sequence; extra fields per line.
function readings(from, to, extra = () => ({})) {
  const out = [];
  let i = 0;
  for (let at = Math.ceil(from / MIN) * MIN; at <= to; at += MIN, i++) out.push({ v: 1, at: iso(at), working_set: 1e9 + ((i * 7919) % 1000) * 1e6, ...extra(i) });
  return out;
}
const fileOf = (rs) => rs.map((r) => `${JSON.stringify(r)}\n`).join('');

test('C3h: a 24-hour window over a file of long lines (over 2 MB a day) starts at its first reading inside the window', async (t) => {
  const now = Date.now();
  const projects = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`project-${String(i).padStart(2, '0')}`, { rss: 123456789 + i, sessions: i, devteam: { dashboard: 110000000, hello: 140000000, wait: 60000000 } }]));
  const rs = readings(now - 30 * HOUR, now - MIN, () => ({ projects }));
  const text = fileOf(rs);
  assert.ok(Buffer.byteLength(text) / 30 * 24 > 2 * 1024 * 1024, 'over 2 MB a day');
  for (const r of rs.slice(0, 3)) assert.equal(memoryReadingProblem(r), null);
  const h = await startHub(t, { file: text, record: false });
  const t0 = Date.now();
  const res = await get(h.port, '/memory.json?since=24h&thin=0');
  const t1 = Date.now();
  assert.equal(res.status, 200, res.body.slice(0, 300));
  const got = res.json.readings;
  const first = Date.parse(got[0].at);
  assert.ok(first >= t0 - DAY && first < t1 - DAY + 61000, `the first reading ${got[0].at} is the window's first`);
  assert.ok(got.length >= 1439 && got.length <= 1441, `${got.length} readings`);
  for (let i = 1; i < got.length; i++) assert.ok(got[i].at > got[i - 1].at, 'oldest first');
});

// ===== D4: /memory.json =====

const NINE = (() => { const now = Date.now(); return { now, rs: readings(now - 9 * DAY, now - MIN) }; })();
let routeHub = null;
const route = async (t) => (routeHub ??= await startHub({ after: () => {} }, { file: fileOf(NINE.rs), record: false }));
after(() => routeHub?.stop());
// the file's readings in [from, to)
const inFile = (from, to = Infinity) => NINE.rs.filter((r) => Date.parse(r.at) >= from && Date.parse(r.at) < to);
// each bucket of `size` ms in [from, to) keeps exactly the highest working_set of the file's readings there
function assertThinned(got, from, to, size) {
  const byBucket = new Map();
  for (const r of got.filter((x) => Date.parse(x.at) >= from && Date.parse(x.at) < to)) {
    const b = Math.floor(Date.parse(r.at) / size);
    assert.ok(!byBucket.has(b), `one reading in the ${size / MIN}-minute bucket of ${r.at}`);
    byBucket.set(b, r);
  }
  const first = Math.ceil(from / size), last = Math.floor(to / size) - 1;
  for (let b = first; b <= last; b++) {
    const all = inFile(b * size, (b + 1) * size);
    if (!all.length) continue;
    const top = all.reduce((m, r) => (r.working_set > m.working_set ? r : m));
    assert.deepEqual(byBucket.get(b), top, `bucket ${new Date(b * size).toISOString()} keeps its peak`);
  }
}

test('C4a: ?since=24h (and no since) thins past 6 hours to one a 5-minute bucket, its peak', async (t) => {
  const h = await route(t);
  for (const q of ['/memory.json?since=24h', '/memory.json']) {
    const t0 = Date.now();
    const res = await get(h.port, q);
    assert.equal(res.status, 200, res.body);
    assert.equal(res.json.v, 1);
    const got = res.json.readings;
    assert.ok(got.every((r) => Date.parse(r.at) >= t0 - DAY - MIN), 'nothing older than the day');
    // the last 6 hours whole (a minute's margin at the edge)
    assert.deepEqual(got.filter((r) => Date.parse(r.at) >= t0 - 6 * HOUR + MIN), inFile(t0 - 6 * HOUR + MIN), `${q}: the last 6 hours unthinned`);
    // whole buckets between the day's edge and 6 hours back
    assertThinned(got, Math.ceil((t0 - DAY + MIN) / (5 * MIN)) * 5 * MIN, Math.floor((t0 - 6 * HOUR - MIN) / (5 * MIN)) * 5 * MIN, 5 * MIN);
  }
});

test('C4b: ?since=8d thins past 3 days to one a 30-minute bucket; the window is at most 8 days and well formed', async (t) => {
  const h = await route(t);
  const t0 = Date.now();
  const res = await get(h.port, '/memory.json?since=8d');
  assert.equal(res.status, 200, res.body);
  const got = res.json.readings;
  assert.ok(got.every((r) => Date.parse(r.at) >= t0 - 8 * DAY - MIN), 'nothing older than 8 days');
  assertThinned(got, Math.ceil((t0 - 8 * DAY + MIN) / (30 * MIN)) * 30 * MIN, Math.floor((t0 - 3 * DAY - MIN) / (30 * MIN)) * 30 * MIN, 30 * MIN);
  assertThinned(got, Math.ceil((t0 - 3 * DAY + MIN) / (5 * MIN)) * 5 * MIN, Math.floor((t0 - 6 * HOUR - MIN) / (5 * MIN)) * 5 * MIN, 5 * MIN);
  for (const q of ['since=9d', 'since=24', 'since=1w', 'since=1000h', 'since=0h', 'since=', 'since=24h&since=1h']) assert.equal((await get(h.port, `/memory.json?${q}`)).status, 400, q);
});

test('C4c: ?after=<at> answers the newer readings unthinned, up to 6 hours back; older or malformed is 400', async (t) => {
  const h = await route(t);
  const at = NINE.rs.at(-120).at;
  const res = await get(h.port, `/memory.json?after=${encodeURIComponent(at)}`);
  assert.equal(res.status, 200, res.body);
  assert.deepEqual(res.json.readings, NINE.rs.slice(-119));
  for (const q of [`after=${encodeURIComponent(iso(Date.now() - 7 * HOUR))}`, 'after=yesterday', 'after=2026-02-30T00:00:00Z']) assert.equal((await get(h.port, `/memory.json?${q}`)).status, 400, q);
});

test('C4d: ?thin=0 is unthinned for a loopback window of 24 hours or less, and refused otherwise', async (t) => {
  const h = await route(t);
  const t0 = Date.now();
  const res = await get(h.port, '/memory.json?thin=0&since=24h');
  assert.equal(res.status, 200, res.body);
  assert.deepEqual(res.json.readings.filter((r) => Date.parse(r.at) >= t0 - DAY + MIN), inFile(t0 - DAY + MIN));
  for (const q of ['thin=0&since=48h', 'thin=0&since=2d', 'thin=1', 'thin=', 'foo=1']) assert.equal((await get(h.port, `/memory.json?${q}`)).status, 400, q);
  const { memoryQuery } = fns(['memoryQuery']);
  const now = Date.now();
  assert.ok(memoryQuery({ thin: '0', since: '24h' }, { now, loopback: true }).error === undefined, 'loopback, a day: unthinned');
  assert.equal(typeof memoryQuery({ thin: '0', since: '24h' }, { now, loopback: false }).error, 'string', 'not loopback: refused');
});

test('C4e: another site\'s page is refused as for /instances.json', async (t) => {
  const h = await route(t);
  for (const s of ['cross-site', 'same-site']) {
    assert.equal((await get(h.port, '/memory.json', { 'sec-fetch-site': s })).status, 403, s);
    assert.equal((await get(h.port, '/instances.json', { 'sec-fetch-site': s })).status, 403, `${s} (instances)`);
  }
  for (const s of ['same-origin', 'none']) assert.equal((await get(h.port, '/memory.json', { 'sec-fetch-site': s })).status, 200, s);
});

test('C4f: with no file the readings are empty; lines the check refuses are never served', async (t) => {
  const empty = await startHub(t, { record: false });
  const e = await get(empty.port, '/memory.json');
  assert.equal(e.status, 200);
  assert.deepEqual(e.json, { v: 1, readings: [] });
  const now = Date.now();
  const good = readings(now - 10 * MIN, now - MIN);
  const text = `${JSON.stringify({ v: 2, at: iso(now - 9 * MIN), working_set: 1 })}\n${fileOf(good.slice(0, 4))}{"v":1,"at":"20\n${fileOf(good.slice(4))}`;
  const h = await startHub(t, { file: text, record: false });
  const res = await get(h.port, '/memory.json');
  assert.deepEqual(res.json.readings, good);
});

// ===== D5: tests never read the machine =====

test('C5b: a process that loads only test/lib/cli.mjs has the recorder off', () => {
  const env = { ...process.env };
  delete env.DEVTEAM_MEMORY_RECORD;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('./lib/cli.mjs', import.meta.url).href)}); console.log(process.env.DEVTEAM_MEMORY_RECORD ?? 'unset')`], { cwd: scratch, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim().split('\n').at(-1), 'off');
});

test('C5c: a dashboard started through the helpers records nothing', { timeout: 300000 }, async (t) => {
  assert.equal(process.env.DEVTEAM_MEMORY_RECORD, 'off', 'the helpers set it on load');
  const base = path.join(scratch, 'dash');
  fs.mkdirSync(base);
  const HUB = nextPort();
  // the helpers' own environment, with the scratch HOME every dashboard test gives (so a broken
  // build's line lands there, not in this machine's ~/.devteam) and a fast tick
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(HUB), DEVTEAM_PORT_BASE: String(PORTS + 50), DEVTEAM_MEMORY_EVERY_MS: '200', DEVTEAM_PROC: PROC, DEVTEAM_CGROUP: CGROUP };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_HOME', 'TMUX', 'TMUX_PANE']) delete env[k];
  const root = bareProject(base, 'recorder-off');
  const dash = startDashboard(root, env);
  t.after(() => dash.stop());
  await until(() => /hub on http/.test(dash.out()) || dash.p.exitCode !== null, 'the dashboard\'s hub');
  assert.match(dash.out(), /hub on http/);
  await new Promise((r) => setTimeout(r, 2000));
  assert.ok(!fs.existsSync(path.join(base, '.devteam', `machine-${HUB}`)), 'no machine-<port> folder');
});
