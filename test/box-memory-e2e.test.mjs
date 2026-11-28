// The box's memory end to end on a fixture box (kit-598, box-memory BOXMEM-S1 and S3): a standalone
// hub, run from a copy of the kit in no repo as the box image's, over a fake /proc with four agent
// sessions in two projects (test/fixtures/box-memory-e2e/box.mjs), records a reading on its first
// tick and serves it at /memory.json; the hub's own Overview, in headless Chrome, shows that reading's
// memory line and opens and closes "What holds it"; and the quiet helpers start only their named
// children: a wait cycle on an unchanged log key starts only metrics (its trace,
// DEVTEAM_TEST_WAIT_TRACE), and a dashboard with no page open starts, in a minute, no node child but
// hello and accounts-tick (the spawn-counting seam, test/fixtures/box-memory-e2e/spawn-probe.mjs).
// Ports: the hub +2 and its scan +50..+74; the dashboard's image hub +80 (nothing listens there) and
// base +81 (it runs pinned to a free port, so it scans none).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { PORTS, kit, testDir, until, line, threadsFixture, fleetFixture, dashboardOnFreePort } from './lib/kit.mjs';
import { canDrive, openChrome, cleanup } from './lib/chrome.mjs';
import { ROOTS, MAX, WORKING_SET, SESSIONS, PROJECT_SESSIONS, writeBox } from './fixtures/box-memory-e2e/box.mjs';

const GB = 2 ** 30;
// The file's own after hooks, registered here at the top (one registered inside a test would be that
// test's, and stop the hub when it ends), run in the order registered: the hub stops, then its
// scratch folder goes.
let stopHub = () => {};
after(() => stopHub());
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-box-e2e-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
const BOX = writeBox(path.join(scratch, 'proc'));
const NOWHERE = path.join(scratch, 'no-such-file');
// The kit as the box image has it: a copy in no repo.
const imageKit = path.join(scratch, 'kit');
fs.cpSync(kit, imageKit, { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });

function get(port, route) {
  return new Promise((resolve, reject) => {
    const r = http.get({ host: '127.0.0.1', port, path: route, headers: { host: `127.0.0.1:${port}` }, timeout: 20000 }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, body: b, json: j }); });
    });
    r.on('timeout', () => r.destroy(new Error(`${route} timed out`)));
    r.on('error', reject);
  });
}

// The fixture box's hub, started once for the file: { home, port, file, out }. Its registry names
// the two fixture roots; a watcher holding a pipe from this process ends the hub's group if this
// process dies first (as test/box-memory-recorder.test.mjs's startHub).
const HUB_WATCH = `const g = Number(process.argv[1]); const end = () => { try { process.kill(-g, 'SIGKILL'); } catch {} process.exit(0); };
process.stdin.on('end', end); process.stdin.on('close', end); process.stdin.on('error', end); process.stdin.resume();`;
let hub = null;
async function boxHub() {
  if (hub) return hub;
  const home = path.join(scratch, 'home');
  const port = PORTS + 2;
  const reg = path.join(home, '.devteam', `repos-${port}`);
  fs.mkdirSync(reg, { recursive: true });
  Object.values(ROOTS).forEach((root, i) => fs.writeFileSync(path.join(reg, `r${i}.json`), JSON.stringify({ root, at: new Date().toISOString() })));
  const env = { ...process.env, HOME: home, DEVTEAM_HUB_PORT: String(port), DEVTEAM_PORT_BASE: String(PORTS + 50), DEVTEAM_PROC: BOX.proc, DEVTEAM_CGROUP: BOX.cgroup, DEVTEAM_MEMINFO: NOWHERE, DEVTEAM_MEMORY_COUNTS_CACHE: '1', DEVTEAM_MEMORY_EVERY_MS: '3600000' };
  for (const k of ['DEVTEAM_MEMORY_RECORD', 'DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_HOME', 'DEVTEAM_IMAGE_HUB', 'TMUX', 'TMUX_PANE']) delete env[k];
  const startedAt = Date.now();
  const p = spawn(process.execPath, [path.join(imageKit, 'scripts', 'devteam.mjs'), 'hub'], { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const w = spawn(process.execPath, ['-e', HUB_WATCH, String(p.pid)], { detached: true, stdio: ['pipe', 'ignore', 'ignore'] });
  w.on('error', () => {});
  w.stdin.on('error', () => {});
  w.unref();
  w.stdin.unref();
  let out = '';
  p.stdout.on('data', (b) => { out += b; });
  p.stderr.on('data', (b) => { out += b; });
  stopHub = () => { try { w.kill('SIGKILL'); } catch {} if (p.exitCode === null && p.signalCode === null) return new Promise((r) => { p.once('exit', r); try { process.kill(-p.pid, 'SIGKILL'); } catch { r(); } }); };
  await until(async () => { try { return (await get(port, '/instances.json')).status === 200; } catch { return p.exitCode !== null; } }, `the hub on ${port}`);
  assert.equal(p.exitCode, null, `the hub runs (${out})`);
  hub = { startedAt, home, port, file: path.join(home, '.devteam', `machine-${port}`, 'memory.jsonl'), out: () => out };
  return hub;
}
const linesOf = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
// the reading the hub's first tick wrote (the tick a hub forces at its start)
async function firstReading() {
  const h = await boxHub();
  await until(() => linesOf(h.file).length >= 1, `a reading in ${h.file}`);
  return { h, text: linesOf(h.file)[0], r: JSON.parse(linesOf(h.file)[0]) };
}

test('E1: the fixture box\'s hub records a reading on its first tick, and GET /memory.json returns it', async () => {
  const { h, text, r } = await firstReading();
  // the tick the hub forces at its start: its timer's first is an hour away (DEVTEAM_MEMORY_EVERY_MS)
  assert.ok(Date.parse(r.at) - h.startedAt < 60000, `the reading at ${r.at}, within a minute of the hub's start (${new Date(h.startedAt).toISOString()})`);
  assert.equal(r.working_set, WORKING_SET, 'memory.current less inactive_file');
  assert.equal(r.max, MAX);
  assert.equal(r.source, 'cgroup');
  assert.equal(r.sessions, SESSIONS, 'four sessions');
  assert.deepEqual(Object.keys(r.projects).sort(), ['alpha', 'beta'], 'two projects, named by their folders');
  for (const [name, n] of Object.entries(PROJECT_SESSIONS)) assert.equal(r.projects[name].sessions, n, `${name}'s sessions`);
  assert.deepEqual(Object.keys(r.kinds), ['agent', 'browser', 'devteam', 'other']);
  assert.equal(r.kinds.agent.n, 5, 'five agents, one of them no session (in alpha\'s root)');
  for (const route of ['/memory.json', '/memory.json?since=24h']) {
    const got = await get(h.port, route);
    assert.equal(got.status, 200, `${route}: ${got.body}`);
    assert.equal(got.json.v, 1);
    assert.deepEqual(got.json.readings.slice(0, 1), [JSON.parse(text)], `${route} returns the reading`);
  }
});

// The page's own rules (hub.html's box-memory block, run alone), for the tables' rows
function memoryView(readings, now) {
  const html = fs.readFileSync(path.join(kit, 'dashboard', 'hub.html'), 'utf8');
  const src = html.slice(html.indexOf('/* box-memory start */'), html.indexOf('/* box-memory end */'));
  const ctx = vm.createContext({});
  vm.runInContext(`${src}\n;globalThis.api = { memoryView };`, ctx);
  return JSON.parse(JSON.stringify(ctx.api.memoryView(readings, now)));
}
const CHROME = { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 };

test('E3: the hub\'s Overview in headless Chrome shows the reading\'s memory line, and What holds it opens the two tables and closes again', CHROME, async (t) => {
  const { h, r } = await firstReading();
  // cleanup's steps run last added first: the page closes, then Chrome
  const defer = cleanup(t);
  const chrome = await openChrome();
  defer(() => chrome.close());
  const p = await chrome.newPage();
  defer(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__errs = []; addEventListener("error", (e) => __errs.push(String(e.message))); addEventListener("unhandledrejection", (e) => __errs.push(String(e.reason)));' });
  await p.send('Page.navigate', { url: `http://127.0.0.1:${h.port}/#overview` });
  const wait = (what, expr) => until(() => p.ev(expr).catch(() => false), what);
  await wait('the memory line', `!!document.querySelector('#ov-body > .mem .mem-words')`);
  // the words, from the reading's numbers: 10.0 of 32 GB, 10 GB over 4 sessions
  const words = `Memory ${(r.working_set / GB).toFixed(1)} of ${r.max / GB} GB · ${(r.working_set / GB / r.sessions).toFixed(2)} GB a session · ${r.sessions} sessions`;
  assert.equal(words, 'Memory 10.0 of 32 GB · 2.50 GB a session · 4 sessions');
  assert.ok((await p.ev(`document.querySelector('.mem-words').textContent`)).startsWith(words), await p.ev(`document.querySelector('.mem-words').textContent`));
  // What holds it: closed, then open with its two tables, then closed by its button
  assert.equal(await p.ev(`document.querySelector('.mem-open').textContent`), 'What holds it');
  assert.equal(await p.ev(`document.getElementById('mem-holds').hidden`), true);
  await p.click('.mem-open');
  await wait('open', `document.getElementById('mem-holds')?.hidden === false`);
  assert.deepEqual(await p.ev(`[...document.querySelectorAll('#mem-holds caption')].map((c) => c.textContent)`), ['By kind', 'By project']);
  const served = (await get(h.port, '/memory.json?since=24h')).json.readings;
  const v = memoryView(served, Date.now());
  assert.deepEqual(await p.ev(`[...document.querySelectorAll('#mem-holds table')[0].querySelectorAll('tr')].map((r) => [r.cells[0].textContent, r.cells[1].textContent])`), v.kinds.map((k) => [k.name, `${k.gb} GB`]));
  const projects = await p.ev(`[...document.querySelectorAll('#mem-holds table')[1].querySelectorAll('tr')].map((r) => [r.cells[0].textContent, r.cells[1].textContent])`);
  assert.deepEqual(projects.map(([n]) => n), ['alpha · 2 sessions', 'beta · 2 sessions'], 'both projects with their sessions, largest first');
  assert.deepEqual(projects, v.projects.map((k) => [k.name, `${k.gb} GB`]));
  assert.equal(projects[0][1], `${(r.projects.alpha.rss / GB).toFixed(1)} GB`, "alpha's row is the reading's rss");
  await p.click('.mem-open');
  await wait('closed', `document.getElementById('mem-holds').hidden === true`);
  assert.equal(await p.ev(`document.querySelector('.mem-open').textContent`), 'What holds it');
  assert.deepEqual(await p.ev('window.__errs'), [], 'no page error');
});

// ===== the quiet helpers =====

// A wait's project: one active ticket (a worker in build, written now), no high finding open (as
// test/box-memory-wait.test.mjs's fixture).
const TICKET = 'e2e-01-quiet';
const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
function waitProject(name) {
  const F = threadsFixture(name);
  F.sup(['feature', 'add', 'e2ewait', '--json', JSON.stringify({ title: 'E2E wait', goals: [F.goal], stories: [{ id: 'EW-S1', text: 'wait stays light', release: 'v1.0.0' }] })]);
  F.sup(['ticket', 'add', TICKET, '--json', JSON.stringify({ title: TICKET, feature: 'e2ewait', component: 'web', kind: 'build', size: 'S', risk: 'normal', serves: ['EW-S1'], depends_on: [], touches: [`src/${TICKET}/**`], done_when: ['its test passes in CI'] })]);
  const d = new Date();
  fs.mkdirSync(F.logDir, { recursive: true });
  fs.appendFileSync(path.join(F.logDir, `${TICKET}.jsonl`), line({ id: `h-${stamp(d)}-${TICKET}`, type: 'phase', op: 'new', at: d.toISOString(), by: TICKET, from: 'starting', to: 'build' }));
  const highs = () => JSON.parse(F.sup(['metrics', '--json'])).findings.filter((f) => f.severity === 'high');
  for (const f of highs()) F.sup(['ack', f.kind, f.subject, '--reason', 'test']);
  assert.deepEqual(highs().map((f) => `${f.kind} ${f.subject}`), [], 'no high finding open at the start');
  return F;
}

test('E4a: on an unchanged log key a wait cycle starts only its metrics child', async (t) => {
  const F = waitProject('e2e-wait');
  const trace = path.join(fs.mkdtempSync(path.join(F.base, 'trace-')), 'trace.jsonl');
  const env = { ...F.env({ DEVTEAM_ROLE: 'supervisor' }), DEVTEAM_TEST_WAIT_TRACE: trace, DEVTEAM_TEST_WAIT_CYCLE_MS: '200' };
  delete env.DEVTEAM_TICKET;
  const child = spawn(process.execPath, [path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), 'wait', '--minutes', '1'], { cwd: F.old, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (b) => { out += b; });
  child.stderr.on('data', (b) => { out += b; });
  // one step, in order (a test's after hooks run in the order registered): the wait killed and gone,
  // then its project removed, so nothing still writes into the folder being removed
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) await new Promise((r) => { child.once('close', r); try { child.kill('SIGKILL'); } catch { r(); } });
    F.done();
  });
  const lines = () => { try { return fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  await until(() => lines().length >= 4 || child.exitCode !== null, 'four snapshots');
  assert.equal(child.exitCode, null, `wait still waiting (${out})`);
  const L = lines();
  assert.equal(L[0].log_reads, 1, 'the first snapshot reads the log');
  for (const l of L.slice(1, 4)) {
    assert.equal(l.key, L[0].key, `cycle ${l.cycle}: the key unchanged`);
    assert.deepEqual(l.children, [['metrics', '--json']], `cycle ${l.cycle} starts only metrics`);
    assert.equal(l.log_reads, 0, `cycle ${l.cycle} folds no log`);
  }
});

// A dashboard on the fixture box (its image hub stands for the box's: the dashboard starts none),
// under the seam
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn, what, ms = 60000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out after ${ms} ms: ${what}`);
    await sleep(10);
  }
}
const readJsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test('E4b: in a minute with no page open a dashboard starts no node child but hello (at most twice) and accounts-tick (once)', { timeout: 300000 }, async (t) => {
  const F = fleetFixture('e2e-dash');
  const dir = path.join(F.base, 'probe');
  fs.mkdirSync(dir);
  const probe = pathToFileURL(path.join(testDir, 'fixtures', 'box-memory-e2e', 'spawn-probe.mjs')).href;
  const env = F.env({
    DEVTEAM_HUB_PORT: String(PORTS + 80), DEVTEAM_PORT_BASE: String(PORTS + 81), DEVTEAM_IMAGE_HUB: String(PORTS + 80),
    DEVTEAM_DATA_WAIT_MS: '600000',
    DEVTEAM_DATA_AT_ONCE: '0',
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import ${probe}`].filter(Boolean).join(' '),
    ZK_DIR: dir,
  });
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_HOME', 'DEVTEAM_PROJECT', 'DEVTEAM_DATA_REUSE_MS', 'DEVTEAM_ACCOUNTS_MS', 'DEVTEAM_PREVIEW_TICK_MS', 'DEVTEAM_KIT_WATCH_MS', 'TMUX', 'TMUX_PANE']) delete env[k];
  const { dash } = await dashboardOnFreePort(F.old, env);
  t.after(async () => { await dash.stop(); F.done(); });
  const ack = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'ack'), 'utf8')); } catch { return null; } };
  // the fake clock moved to ms, then settled: every child it started has ended, on three acks in a row
  const settle = (ms) => {
    fs.writeFileSync(path.join(dir, 'clock'), String(ms));
    let quiet = 0, last = 0;
    return poll(() => {
      const a = ack();
      if (!a || a.n === last) return false;
      last = a.n;
      quiet = a.fake === ms && a.live === 0 ? quiet + 1 : 0;
      return quiet >= 3 ? a : false;
    }, `the dashboard at fake ${ms} ms with no child running (last ack ${JSON.stringify(ack())}; ${dash.out().slice(-400)})`, 120000);
  };
  await settle(0);
  for (let ms = 1000; ms <= 120000; ms += 1000) await settle(ms);
  const node = readJsonl(path.join(dir, 'kids')).filter((k) => k.ev === 'start' && k.node).map((k) => ({ at: k.at, name: k.cmd.split(' ')[0] }));
  const minute = node.filter((k) => k.at > 60000 && k.at <= 120000).map((k) => k.name);
  assert.deepEqual(minute.filter((n) => n !== 'hello' && n !== 'accounts-tick'), [], `no node child but hello and accounts-tick (${minute.join(', ')})`);
  const hellos = minute.filter((n) => n === 'hello').length;
  assert.ok(hellos >= 1 && hellos <= 2, `hello at most twice, and at least once (${hellos})`);
  assert.equal(minute.filter((n) => n === 'accounts-tick').length, 1, 'accounts-tick once');
  assert.deepEqual(readJsonl(path.join(dir, 'errors')), [], 'no timer threw');
});
