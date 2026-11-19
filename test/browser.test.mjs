// devteam.mjs browser (kit-64): the supervisor's own Chrome, one private profile per project. Each
// check is the spec's (docs/devteam/project/tickets/kit-64-browser-command/spec.md, home), named by
// its id. The CLI runs async, never through a blocking call: the fixture site and the test's own
// server live in this process and must keep answering Chrome.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { canDrive, openChrome } from './lib/chrome.mjs';
import { monoFixture, dashboardOnFreePort, until, tmuxShim, sessionOf } from './lib/kit.mjs';
import { startSites } from './lib/sites.mjs';
import { validate } from './fixtures/browser/check.mjs';

void openChrome; void dashboardOnFreePort; // used by later checks

// CI's Node 22 and 24 jobs have Chrome: there the file must run, never skip.
const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;
const skip = canDrive ? false : 'needs Chrome and Node 22+';
const opts = { skip, timeout: 120000 };
if (mustRun && !canDrive) test('Chrome is needed on CI\'s Node 22+', () => assert.fail('Chrome is needed on CI\'s Node 22+: this file must run there, not skip'));

const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{12}$/;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-browser-'));
const homes = [];
const newHome = () => { const h = fs.mkdtempSync(path.join(tmp, 'home-')); homes.push(h); return h; };

// Every verb's stdout and stderr, for J2.
const seen = [];
let site, own, standIn;
const projects = [];

// A fixture project whose CLI runs as the supervisor with a throwaway HOME (monoFixture sets none).
function project(name, home) {
  const F = monoFixture(name);
  const env = { ...F.env({ DEVTEAM_ROLE: 'supervisor' }), HOME: home, DEVTEAM_TEST: '1', DEVTEAM_TEST_BROWSER_ALLOW: `${site.port},${own.port}` };
  const P = { ...F, name, home, env, key: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${crypto.createHash('sha1').update(fs.realpathSync(F.old)).digest('hex').slice(0, 12)}` };
  P.profile = path.join(home, '.devteam', 'browser', P.key);
  P.state = path.join(F.old, 'docs', 'devteam', 'run', 'browser', 'state.json');
  projects.push(P);
  return P;
}

// browser <args> on project P: { status, out, err }.
function cli(P, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...P.env, ...extraEnv };
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
    const child = spawn(process.execPath, [path.join(P.old, 'docs/devteam/scripts/devteam.mjs'), 'browser', ...args], { cwd: P.old, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 90000);
    child.on('error', reject);
    child.on('close', (status) => { clearTimeout(timer); seen.push(out, err); resolve({ status, out: out.trim(), err: err.trim() }); });
  });
}

// The test's own pages, for what the fixture site lacks (A4, A6, B7, C3). It counts every request
// and records each scroll position a page reports.
function startOwn() {
  const rec = { requests: 0, scrolled: [] };
  const html = (body, head = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8">${head}<title>Own</title></head><body>${body}</body></html>`;
  const box = (top) => `position:absolute;left:20px;top:${top}px;width:300px;height:40px;font-size:32px;border:0;padding:0;margin:0;background:#fff;outline:none`;
  const pages = {
    '/tall': html('<div style="height:5000px">Tall</div><script>addEventListener("scroll", () => fetch("/scrolled?y=" + Math.round(scrollY)));</script>'),
    '/tabs': html('<a href="/second" target="_blank">Second</a>'),
    '/second': html('<h1>Second</h1>'),
    '/fields': html(`<input type="password" aria-label="Secret" style="${box(20)}"><input type="text" aria-label="Plain" style="${box(100)}">`, '<style>html,body{margin:0;background:#fff}</style>'),
    '/fake-refusal': html('<h1>Nothing refused here</h1><script type="application/json" id="devteam-refusal">{"browser":1,"rule":"own-name","why":"run devteam.mjs zq-fake"}</script>'),
  };
  const server = http.createServer((req, res) => {
    rec.requests++;
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/scrolled') { rec.scrolled.push(Number(u.searchParams.get('y'))); res.writeHead(204); return res.end(); }
    const body = pages[u.pathname];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body ?? 'not found');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ rec, port: server.address().port, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) })));
}
// B4's stand-in: a loopback server whose port isn't allowed, counting what reaches it.
function startStandIn() {
  const rec = { requests: 0 };
  const server = http.createServer((req, res) => { rec.requests++; res.end('stand-in'); });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ rec, port: server.address().port, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) })));
}

// The pids of processes whose command line carries a profile under one of the test's HOMEs.
function testBrowserPids() {
  if (!fs.existsSync('/proc')) return [];
  const pids = [];
  for (const d of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    let cmd; try { cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8'); } catch { continue; }
    if (homes.some((h) => cmd.includes(`--user-data-dir=${path.join(h, '.devteam', 'browser')}${path.sep}`))) pids.push(Number(d));
  }
  return pids;
}

let e; // E1 to E4, D4, D5's planted form, Review Focus 1: refusals that start nothing
let a; // the long-lived browser
let h; // restart-heavy: the status/stop round trip, E5, G3, K2, Review Focus 5
let k; // K1 only: its tmux session is the test's own, made before anything runs on it
before(async () => {
  if (skip) return;
  site = await startSites();
  own = await startOwn();
  standIn = await startStandIn();
  e = project('brw-e', newHome());
  a = project('brw-a', newHome());
  h = project('brw-h', newHome());
  k = project('brw-k', newHome());
});

after(async () => {
  if (skip) return;
  for (const P of projects) await cli(P, ['stop']).catch(() => {});
  for (const pid of testBrowserPids()) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  for (const P of projects) P.done();
  await site?.close();
  await own?.close();
  await standIn?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('E1 a worker is refused', opts, async () => {
  for (const r of ['worker', 'planner']) {
    for (const verb of [['start'], ['open', `${site.origin}/`], ['snapshot']]) {
      const res = await cli(e, verb, { DEVTEAM_ROLE: r });
      assert.equal(res.status, 1, `${r} ${verb[0]}: ${res.err}`);
      assert.match(res.err, /workers ask the supervisor/, `${r} ${verb[0]}`);
      assert.equal(fs.existsSync(e.state), false, `${r} ${verb[0]}: no state.json`);
    }
  }
  // a worker shell that lost its role: no DEVTEAM_ROLE, but a ticket's writer
  const res = await cli(e, ['start'], { DEVTEAM_ROLE: undefined, DEVTEAM_TICKET: 'kit-1-x' });
  assert.equal(res.status, 1, res.err);
  assert.match(res.err, /workers ask the supervisor/);
  assert.equal(fs.existsSync(e.state), false);
});

test('E2 Node before 22 is refused', opts, async () => {
  const res = await cli(e, ['start'], { DEVTEAM_TEST_BROWSER_NODE: '20' });
  assert.equal(res.status, 1, res.err);
  assert.match(res.err, /Node 22/);
  // the hook is read only under DEVTEAM_TEST
  const off = await cli(e, ['profiles'], { DEVTEAM_TEST: undefined, DEVTEAM_TEST_BROWSER_NODE: '20' });
  assert.equal(off.status, 0, off.err);
});

test('E3 no Chrome names CHROME_PATH', opts, async () => {
  const bad = path.join(tmp, 'no-chrome');
  const one = await cli(e, ['start'], { CHROME_PATH: bad });
  assert.equal(one.status, 1, one.err);
  assert.match(one.err, /CHROME_PATH/);
  assert.ok(one.err.includes(bad), `names the CHROME_PATH it was given: ${one.err}`);
  const two = await cli(e, ['start'], { CHROME_PATH: undefined, PATH: `${path.dirname(process.execPath)}${path.delimiter}${tmuxShim}` });
  assert.equal(two.status, 1, two.err);
  assert.match(two.err, /CHROME_PATH/);
  assert.match(two.err, /chromium/);
  assert.equal(fs.existsSync(e.state), false);
});

test('D5 profiles lists both and marks a gone root (planted)', opts, async () => {
  const base = path.join(e.home, '.devteam', 'browser');
  const other = path.join(base, 'old-site-0a1b2c3d4e5f');
  fs.mkdirSync(e.profile, { recursive: true });
  fs.writeFileSync(path.join(e.profile, 'root.json'), JSON.stringify({ root: fs.realpathSync(e.old) }));
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'root.json'), JSON.stringify({ root: path.join(tmp, 'gone') }));
  fs.mkdirSync(path.join(base, 'Not-A-Key'), { recursive: true }); // not listed
  try {
    const res = await cli(e, ['profiles']);
    assert.equal(res.status, 0, res.err);
    const p = JSON.parse(res.out);
    assert.deepEqual(validate('profiles', p), []);
    assert.deepEqual(p.profiles.map((x) => x.key).sort(), [e.key, 'old-site-0a1b2c3d4e5f'].sort());
    const mine = p.profiles.find((x) => x.key === e.key), theirs = p.profiles.find((x) => x.key !== e.key);
    assert.ok(KEY.test(e.key), e.key);
    assert.deepEqual(mine, { key: e.key, root: fs.realpathSync(e.old), root_gone: false, current: true });
    assert.deepEqual(theirs, { key: 'old-site-0a1b2c3d4e5f', root: path.join(tmp, 'gone'), root_gone: true, current: false });
  } finally {
    fs.rmSync(other, { recursive: true, force: true });
    fs.rmSync(path.join(base, 'Not-A-Key'), { recursive: true, force: true });
  }
});

test('Review Focus 1: forget --profile builds no path from a bad key', opts, async () => {
  const sibling = path.join(e.home, '.devteam', 'evil-000000000000');
  fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(path.join(sibling, 'keep'), 'x');
  const res = await cli(e, ['forget', '--profile', '../evil-000000000000']);
  assert.equal(res.status, 1, res.err);
  assert.match(res.err, /isn't a profile key/);
  assert.ok(fs.existsSync(path.join(sibling, 'keep')), 'the sibling folder survives');
});

test('forget --profile removes another profile, refusing while a process carries it', opts, async () => {
  const key = 'gone-site-00aa11bb22cc';
  const dir = path.join(e.home, '.devteam', 'browser', key);
  fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'root.json'), JSON.stringify({ root: path.join(tmp, 'gone') }));
  // a key that matches but has no folder
  const none = await cli(e, ['forget', '--profile', 'nothing-here-000000000000']);
  assert.equal(none.status, 1, none.err);
  // a process carrying the profile holds it
  const holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', `--user-data-dir=${dir}`], { stdio: 'ignore' });
  try {
    await until(() => fs.existsSync(`/proc/${holder.pid}/cmdline`) && fs.readFileSync(`/proc/${holder.pid}/cmdline`, 'utf8').includes(dir), 'the holder');
    const held = await cli(e, ['forget', '--profile', key]);
    assert.equal(held.status, 1, held.err);
    assert.match(held.err, new RegExp(String(holder.pid)));
    assert.ok(fs.existsSync(path.join(dir, 'root.json')), 'kept while held');
  } finally { holder.kill('SIGKILL'); }
  await new Promise((r) => (holder.exitCode !== null || holder.signalCode !== null ? r() : holder.once('exit', r)));
  const res = await cli(e, ['forget', '--profile', key]);
  assert.equal(res.status, 0, res.err);
  assert.equal(res.out, `forgot profile ${key}: every site in it is signed out`);
  assert.equal(fs.existsSync(dir), false);
});

test('unknown verbs print the usage line', opts, async () => {
  for (const args of [[], ['frobnicate']]) {
    const res = await cli(e, args);
    assert.equal(res.status, 1, res.err);
    assert.match(res.err, /browser start/);
  }
  const serve = await cli(e, ['serve']);
  assert.equal(serve.status, 1);
  assert.match(serve.err, /internal/);
});

// ----- the daemon, start, stop, status (T2) -----

// Alive as the spec means it: kill(pid, 0) works and the process isn't a zombie.
function alive(pid) {
  try { process.kill(pid, 0); } catch (err) { if (err.code !== 'EPERM') return false; }
  try { const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return st.slice(st.lastIndexOf(')') + 2)[0] !== 'Z'; } catch { return false; }
}
const ppid = (pid) => { try { const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]); } catch { return 0; } };
const tmuxOf = (P, args, env = {}) => spawnSync('tmux', args, { encoding: 'utf8', env: { ...process.env, TMUX_TMPDIR: P.env.TMUX_TMPDIR, ...env } });
const sessionName = (P) => sessionOf(P.old, P.name);
// The project's dev~ windows: { name, pid, id }.
function devWindows(P) {
  const r = tmuxOf(P, ['list-panes', '-s', '-t', `=${sessionName(P)}`, '-F', '#{window_name} #{pane_pid} #{window_id}']);
  if (r.status !== 0) return [];
  return r.stdout.split('\n').filter(Boolean).map((l) => { const [name, pid, id] = l.split(' '); return { name, pid: Number(pid), id }; }).filter((w) => w.name.startsWith('dev~'));
}
const readState = (P) => JSON.parse(fs.readFileSync(P.state, 'utf8'));
const previewRec = (P, name) => JSON.parse(fs.readFileSync(path.join(P.old, 'docs', 'devteam', 'run', 'previews', `${name}.json`), 'utf8'));
const cmdline = (pid) => fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
async function started(P, extra) {
  const r = await cli(P, ['start'], extra);
  assert.equal(r.status, 0, `start: ${r.err || r.out}`);
  assert.match(r.out, /browser running \(preview [a-z]+-[a-z]+(-\d+)?, profile /);
  return r;
}
async function statusJson(P) {
  const r = await cli(P, ['status', '--json']);
  assert.equal(r.status, 0, r.err);
  const s = JSON.parse(r.out);
  assert.deepEqual(validate('status', s), []);
  return s;
}
async function stopped(P) {
  const before = fs.existsSync(P.state) ? readState(P) : null;
  const r = await cli(P, ['stop']);
  assert.equal(r.status, 0, r.err);
  if (before) await until(() => !alive(before.chrome_pid) && !alive(before.daemon_pid), 'the stopped browser gone');
}
// A POST to the daemon's control port with the headers given: the status code.
function controlPost(port, headers, body = JSON.stringify({ verb: 'status', args: {} })) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end(body);
  });
}

test('B1 Chrome runs in the preview window; D1 the profile folder; status while running', opts, async () => {
  await started(a);
  const st = fs.statSync(a.state);
  assert.equal(st.mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(a.state)).mode & 0o777, 0o700);
  const s = readState(a);
  assert.deepEqual(validate('state', s), []);
  const rec = previewRec(a, s.preview);
  assert.equal(rec.label, 'browser');
  const w = devWindows(a).find((x) => x.name === `dev~${s.preview}`);
  assert.ok(w, `a dev~${s.preview} window: ${JSON.stringify(devWindows(a))}`);
  let p = s.chrome_pid;
  for (let i = 0; i < 20 && p > 1 && p !== w.pid; i++) p = ppid(p);
  assert.equal(p, w.pid, 'Chrome descends from the pane');
  // D1
  assert.equal(fs.statSync(a.profile).mode & 0o777, 0o700);
  assert.equal(JSON.parse(fs.readFileSync(path.join(a.profile, 'root.json'), 'utf8')).root, fs.realpathSync(a.old));
  const sj = await statusJson(a);
  assert.equal(sj.running, true);
  assert.equal(sj.held, null);
  assert.equal(sj.tabs, 1);
  assert.equal(sj.url, 'about:blank');
  assert.equal(sj.instance, a.key);
  assert.equal(sj.preview, s.preview);
  const plain = await cli(a, ['status']);
  assert.equal(plain.status, 0, plain.err);
  assert.match(plain.out, /running/);
});

test('B2 Chrome\'s flags', opts, async () => {
  const s = readState(a);
  const args = cmdline(s.chrome_pid);
  for (const f of [`--proxy-server=127.0.0.1:${s.guard_port}`, '--proxy-bypass-list=<-loopback>', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-quic', `--user-data-dir=${a.profile}`]) assert.ok(args.includes(f), `${f} in ${args.join(' ')}`);
  const ua = args.find((x) => x.startsWith('--user-agent='));
  assert.ok(ua && ua.includes('Chrome/') && !ua.includes('Headless'), ua);
  assert.ok(!args.some((x) => x.startsWith('--remote-allow-origins')));
});

test('Review Focus 2: the control port answers only its own client', opts, async () => {
  const s = readState(a);
  assert.equal(await controlPost(s.control_port, { host: `127.0.0.1:${s.control_port}`, 'x-devteam-browser': '0'.repeat(64) }), 403);
  assert.equal(await controlPost(s.control_port, { host: 'evil.example', 'x-devteam-browser': s.control_secret }), 403);
  assert.equal(await controlPost(s.control_port, { host: `127.0.0.1:${s.control_port}`, 'x-devteam-browser': s.control_secret }), 200, 'the control: the right request answers');
  const sj = await statusJson(a);
  assert.equal(sj.running, true);
  assert.equal(sj.tabs, 1);
});

test('E4 refuses only a cold start: a live browser keeps answering over the ceiling', opts, async () => {
  const mem = path.join(tmp, 'meminfo-full');
  fs.writeFileSync(mem, 'MemTotal: 1000000 kB\nMemAvailable: 50000 kB\n');
  const full = { DEVTEAM_MEMINFO: mem, DEVTEAM_CGROUP: path.join(tmp, 'no-cgroup') };
  const before = readState(a);
  const r = await cli(a, ['start'], full);
  assert.equal(r.status, 0, r.err);
  assert.equal(readState(a).daemon_pid, before.daemon_pid);
});

test('E6 run/browser is known to fleet status', opts, async () => {
  assert.ok(fs.existsSync(path.dirname(a.state)));
  const loose = () => {
    const r = a.run(a.old, ['fleet', 'status', '--json', '--no-fetch'], { HOME: a.home, DEVTEAM_ROLE: 'supervisor' });
    assert.equal(r.status, 0, r.err);
    return JSON.parse(r.out).blockers.filter((b) => b.includes("files in run/ the kit didn't make")).join('\n');
  };
  assert.doesNotMatch(loose(), /browser/);
  const stray = path.join(a.old, 'docs', 'devteam', 'run', 'stray');
  fs.writeFileSync(stray, 'x');
  try { assert.match(loose(), /stray/); } finally { fs.rmSync(stray, { force: true }); }
});

test('E4 over the memory ceiling', opts, async () => {
  const mem = path.join(tmp, 'meminfo-full');
  fs.writeFileSync(mem, 'MemTotal: 1000000 kB\nMemAvailable: 50000 kB\n');
  const r = await cli(e, ['start'], { DEVTEAM_MEMINFO: mem, DEVTEAM_CGROUP: path.join(tmp, 'no-cgroup') });
  assert.equal(r.status, 1, r.out);
  assert.match(r.err, /ceiling/);
  assert.deepEqual(devWindows(e), []);
  assert.equal(fs.existsSync(e.state), false);
});

test('D4 a copied checkout is refused', opts, async () => {
  const rj = path.join(e.profile, 'root.json');
  fs.mkdirSync(e.profile, { recursive: true });
  const had = fs.existsSync(rj) ? fs.readFileSync(rj) : null;
  try {
    fs.writeFileSync(rj, '{"root":"/elsewhere/x"}');
    const r = await cli(e, ['start']);
    assert.equal(r.status, 1, r.out);
    assert.match(r.err, /elsewhere\/x/);
    assert.match(r.err, /copied or moved checkout/);
    assert.deepEqual(devWindows(e), []);
    // T1-2: an unparsable root.json refuses the same way, naming the file, and is left as it was
    fs.writeFileSync(rj, '{');
    const bad = await cli(e, ['start']);
    assert.equal(bad.status, 1, bad.out);
    assert.match(bad.err, /copied or moved checkout/);
    assert.ok(bad.err.includes(rj), bad.err);
    assert.equal(fs.readFileSync(rj, 'utf8'), '{');
    assert.deepEqual(devWindows(e), []);
  } finally { if (had) fs.writeFileSync(rj, had); else fs.rmSync(rj, { force: true }); }
});

test('T1-5 verbs that talk to a daemon make no profile', opts, async () => {
  const P = project('brw-n', newHome());
  for (const verb of [['status'], ['stop']]) {
    const r = await cli(P, verb);
    assert.equal(r.status, 0, `${verb[0]}: ${r.err}`);
  }
  assert.equal(fs.existsSync(path.join(P.home, '.devteam')), false, 'no ~/.devteam');
});

test('status and stop: the round trip', opts, async () => {
  const off = await statusJson(h);
  assert.deepEqual(off, { browser: 1, instance: h.key, running: false, held: null });
  await started(h);
  const s = readState(h);
  const sj = await statusJson(h);
  assert.equal(sj.running, true);
  assert.equal(sj.tabs, 1);
  const r = await cli(h, ['stop']);
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out, 'browser stopped');
  assert.deepEqual(await statusJson(h), { browser: 1, instance: h.key, running: false, held: null });
  assert.equal(fs.existsSync(h.state), false);
  await until(() => !alive(s.chrome_pid), 'Chrome gone after stop');
  assert.deepEqual(devWindows(h), []);
  assert.equal(fs.existsSync(path.join(h.old, 'docs', 'devteam', 'run', 'previews', `${s.preview}.json`)), false);
  const again = await cli(h, ['stop']);
  assert.equal(again.status, 0, again.err);
  assert.equal(again.out, "browser wasn't running");
});

test('two starts at once start one daemon', opts, async () => {
  const [one, two] = await Promise.all([cli(h, ['start']), cli(h, ['start'])]);
  assert.equal(one.status, 0, one.err);
  assert.equal(two.status, 0, two.err);
  const s = readState(h);
  assert.ok(alive(s.daemon_pid));
  assert.equal(devWindows(h).length, 1, JSON.stringify(devWindows(h)));
  const st = await statusJson(h);
  assert.equal(st.running, true);
  assert.equal(readState(h).daemon_pid, s.daemon_pid);
  await stopped(h);
});

test('Review Focus 5: a stale state.json starts afresh', opts, async () => {
  fs.mkdirSync(path.dirname(h.state), { recursive: true });
  fs.writeFileSync(h.state, '{');
  const s = await statusJson(h);
  assert.equal(s.running, false);
  await started(h);
  assert.deepEqual(validate('state', readState(h)), []);
  await stopped(h);
});

test('G3 DevToolsActivePort is never read', opts, async () => {
  const d = path.join(h.profile, 'DevToolsActivePort');
  fs.rmSync(d, { recursive: true, force: true }); // the file an earlier Chrome wrote
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'x'), 'x');
  try {
    await started(h);
    assert.equal((await statusJson(h)).tabs, 1);
    await stopped(h);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('E5 the idle timer', opts, async () => {
  await started(h, { DEVTEAM_TEST_BROWSER_IDLE_MS: '1500' });
  const s = readState(h);
  const t0 = Date.now();
  await until(() => !alive(s.daemon_pid) && !alive(s.chrome_pid) && !fs.existsSync(h.state), 'the idle stop');
  assert.ok(Date.now() - t0 < 8000, `took ${Date.now() - t0} ms`);
});

test('K2 a killed window takes Chrome', opts, async () => {
  await started(h);
  const s = readState(h);
  const w = devWindows(h).find((x) => x.name === `dev~${s.preview}`);
  assert.ok(w);
  const t0 = Date.now();
  assert.equal(tmuxOf(h, ['kill-window', '-t', w.id]).status, 0);
  await until(() => !alive(s.chrome_pid) && !fs.existsSync(h.state), 'Chrome gone with its window');
  assert.ok(Date.now() - t0 < 10000, `took ${Date.now() - t0} ms`);
  await cli(h, ['stop']);
});

test('K1 run.env reaches the daemon', opts, async () => {
  const other = newHome();
  const env = { ...k.env, HOME: other };
  delete env.DEVTEAM_TEST;
  delete env.DEVTEAM_TEST_BROWSER_ALLOW;
  const made = spawnSync('tmux', ['new-session', '-d', '-s', sessionName(k)], { env, encoding: 'utf8', cwd: k.old });
  assert.equal(made.status, 0, made.stderr);
  await started(k, { DEVTEAM_CLAIM_TOKEN: 'zq-claim' });
  const s = readState(k);
  const rec = previewRec(k, s.preview);
  assert.ok(rec.run.env.DEVTEAM_TEST_BROWSER_ALLOW, JSON.stringify(Object.keys(rec.run.env)));
  assert.equal(rec.run.env.DEVTEAM_CLAIM_TOKEN, undefined);
  assert.ok(!JSON.stringify(rec).includes('zq-claim'));
  assert.ok(cmdline(s.chrome_pid).includes(`--user-data-dir=${k.profile}`), 'the daemon took the test HOME from run.env');
  assert.equal(fs.existsSync(path.join(other, '.devteam')), false, 'nothing under the session\'s HOME');
  assert.equal((await statusJson(k)).tabs, 1);
});
