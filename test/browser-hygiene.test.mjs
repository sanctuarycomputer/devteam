// devteam.mjs browser (kit-64): the restart-heavy checks, profile hygiene on every start and stop
// (spec F, G, H and I) and the daemon's own start and stop round trips (E5, K2, Review Focus 5;
// docs/devteam/project/tickets/kit-64-browser-command/spec.md, home), split
// from test/browser.test.mjs so each file stays inside CI's per-file watchdog. The CLI runs async,
// never through a blocking call: the fixture site lives in this process and must keep answering.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { canDrive, openChrome } from './lib/chrome.mjs';
import { monoFixture, until, sessionOf } from './lib/kit.mjs';
import { startSites } from './lib/sites.mjs';
import { validate } from './fixtures/browser/check.mjs';

// CI's Node 22 and 24 jobs have Chrome: there the file must run, never skip.
const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;
const skip = canDrive ? false : 'needs Chrome and Node 22+';
if (mustRun && !canDrive) test('Chrome is needed on CI\'s Node 22+', () => assert.fail('Chrome is needed on CI\'s Node 22+: this file must run there, not skip'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-browser-hy-'));
const homes = [];
const newHome = () => { const h = fs.mkdtempSync(path.join(tmp, 'home-')); homes.push(h); return h; };
let site, own;
const projects = [];
// Every verb's stdout and stderr, and every control secret read, for the never-print sweep (T5-6).
const seen = [];
const secrets = new Set();

// A fixture project whose CLI runs as the supervisor with a throwaway HOME (monoFixture sets none).
function project(name, home) {
  const F = monoFixture(name);
  const env = { ...F.env({ DEVTEAM_ROLE: 'supervisor' }), HOME: home, DEVTEAM_TEST: '1', DEVTEAM_TEST_BROWSER_ALLOW: `${site.port},${own.port}` };
  const P = { ...F, name, home, env, key: `${name}-${crypto.createHash('sha1').update(fs.realpathSync(F.old)).digest('hex').slice(0, 12)}` };
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
// The test's own pages for the screenshot's fail-closed checks (T5-1) and the review's minors: a page
// whose CSP blocks any injected <style> (its own sheet is a file), a field in a closed shadow root, a
// frame from another site (localhost against 127.0.0.1: another process), an image whose title is its
// file name, and a fragment link.
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const BOX = 'position:absolute;left:20px;width:300px;height:40px;font-size:32px;border:0;padding:0;margin:0;background:#fff;outline:none';
function startOwn() {
  const html = (body, head = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8">${head}<title>Own</title></head><body>${body}</body></html>`;
  let port;
  const pages = {
    '/strict': [html('<input id="pw" type="password" value="zqpwzqpw"><input id="code" type="text" autocomplete="one-time-code" value="ZQCODEZQ"><input id="plain" type="text" value="zqzqzq">', '<link rel="stylesheet" href="/strict.css">'), { 'content-security-policy': "default-src 'self'; style-src 'self'" }],
    '/strict.css': [`html,body{margin:0;background:#fff} input{${BOX}} #pw{top:20px;background:linear-gradient(#000,#000);-webkit-background-clip:text;background-clip:text} #code{top:100px;-webkit-text-stroke:2px #000} #plain{top:180px}`, { 'content-type': 'text/css' }],
    '/shadow': [html(`<div><template shadowrootmode="closed"><style>input{${BOX};top:20px}</style><input type="password" value="zqpwzqpw"></template></div><input type="text" value="zqzqzq" style="${BOX};top:100px">`, '<style>html,body{margin:0;background:#fff}</style>')],
    '/framed': [null],
    // T5b-1: once the hide has edited the first field's style, the page adds a second password field
    '/late': [html(`<input id="a" type="password" value="zqpwzqpw" style="${BOX};top:20px"><script>const a = document.getElementById('a'); let done = false; new MutationObserver(() => { if (done || !/transparent/.test(a.getAttribute('style') ?? '')) return; done = true; const b = document.createElement('input'); b.type = 'password'; b.value = 'zqlatezq'; b.style.cssText = ${JSON.stringify(`${BOX};top:100px`)}; document.body.appendChild(b); }).observe(a, { attributes: true });</script>`)],
    '/object': [null],
    '/inner': [html('<input type="password" value="zqpwzqpw">')],
    '/hash': [html('<h1>Hash</h1><p><a href="#part">Part</a></p><p id="part">Part</p>')],
    '/img/zqimagetokenzqimagetoken.png': [PNG1, { 'content-type': 'image/png' }],
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const [body, headers] = u.pathname === '/framed' ? [html(`<iframe src="http://localhost:${port}/inner"></iframe>`)] : u.pathname === '/object' ? [html(`<object data="http://localhost:${port}/inner" type="text/html"></object>`)] : pages[u.pathname] ?? ['not found'];
    res.writeHead(pages[u.pathname] ? 200 : 404, { 'content-type': 'text/html; charset=utf-8', ...headers });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve({ port, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) }); }));
}
// The distinct colours of a PNG in x 24 to 316 and each y range, read in the test's own Chrome.
async function colours(file, ranges) {
  const ch = await openChrome();
  try {
    const pg = await ch.newPage();
    return await pg.ev(`new Promise((res, rej) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); res(${JSON.stringify(ranges)}.map(([y0, y1]) => { const d = x.getImageData(24, y0, 292, y1 - y0).data; const s = new Set(); for (let k = 0; k < d.length; k += 4) s.add(d[k] + ',' + d[k + 1] + ',' + d[k + 2] + ',' + d[k + 3]); return s.size; })); }; i.onerror = () => rej(new Error('not a PNG')); i.src = 'data:image/png;base64,${fs.readFileSync(file).toString('base64')}'; })`);
  } finally { await ch.close(); }
}

// The pids of processes whose command line carries a profile under one of this file's HOMEs.
function testBrowserPids() {
  if (!fs.existsSync('/proc')) return [];
  const pids = [];
  for (const d of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    let cmd; try { cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8'); } catch { continue; }
    if (homes.some((h) => cmd.includes(`--user-data-dir=${path.join(h, '.devteam', 'browser')}${path.sep}`))) pids.push(Number(d));
  }
  return pids;
}
// Alive as the spec means it: kill(pid, 0) works and the process isn't a zombie.
function alive(pid) {
  try { process.kill(pid, 0); } catch (err) { if (err.code !== 'EPERM') return false; }
  try { const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return st.slice(st.lastIndexOf(')') + 2)[0] !== 'Z'; } catch { return false; }
}
const readState = (P) => { const s = JSON.parse(fs.readFileSync(P.state, 'utf8')); if (/[1-9a-f]/.test(s.control_secret ?? '')) secrets.add(s.control_secret); return s; };
const cmdline = (pid) => fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
// Starts run one at a time across the file: the two chains run at once, and two projects' daemons
// starting together can pick the same free view port before either binds it. ms is the start's own.
let starting = Promise.resolve();
function startCli(P, extra) {
  const run = starting.then(async () => { const t0 = Date.now(); const r = await cli(P, ['start'], extra); return { ...r, ms: Date.now() - t0 }; });
  starting = run.catch(() => {});
  return run;
}
async function started(P, extra) {
  const r = await startCli(P, extra);
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

let h; // the start/stop round trip, two starts, E5, K2, Review Focus 5; then F, G
let g; // H, I, beside h's chain
// after waits for it: with every test filtered out (--test-name-pattern), node runs after while
// before is still starting the site, which would then keep the process alive.
let setup = Promise.resolve();
before(() => {
  if (skip) return;
  setup = (async () => {
    site = await startSites();
    own = await startOwn();
    h = project('brw-h', newHome());
    g = project('brw-g', newHome());
  })();
  return setup;
});

// Groups and pids the test made for H and I; each test kills its own, and this catches the rest. Only
// these are ever signalled as a group: never one the test didn't create.
const ownGroups = new Set();
after(async () => {
  if (skip) return;
  await setup.catch(() => {});
  for (const G of ownGroups) { try { process.kill(-G, 'SIGKILL'); } catch {} }
  for (const P of projects) await cli(P, ['stop']).catch(() => {});
  for (const pid of testBrowserPids()) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  for (const P of projects) P.done();
  await site?.close();
  await own?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const hygiene = [];
const PREFS = (P) => path.join(P.profile, 'Default', 'Preferences');
const SESSION_NAMES = ['Current Session', 'Current Tabs', 'Last Session', 'Last Tabs'];
const sessionLeft = (P) => { const d = path.join(P.profile, 'Default'); return [...fs.readdirSync(d).filter((n) => n.startsWith('Sessions')), ...SESSION_NAMES.filter((n) => fs.existsSync(path.join(d, n)))]; };
// Whether Chrome has written a session file for the open page: Default/Sessions/ holds one.
const sessionsWritten = (P) => { try { return fs.readdirSync(path.join(P.profile, 'Default', 'Sessions')).length > 0; } catch { return false; } };
// A pid that is certainly dead: a process that ran and was reaped.
const deadPid = () => spawnSync('true').pid;
// A schema-valid state.json of a dead daemon, naming chrome_pid.
function plantState(P, chromePid) {
  const s = { browser: 1, daemon_pid: deadPid(), chrome_pid: chromePid, control_port: 1, control_secret: '0'.repeat(64), cdp_port: 1, guard_port: 1, view_port: 1, preview: 'gone-preview' };
  assert.deepEqual(validate('state', s), []);
  fs.mkdirSync(path.dirname(P.state), { recursive: true });
  fs.writeFileSync(P.state, JSON.stringify(s));
}
// SingletonLock as Chrome makes it: a symlink to <host>-<pid>.
function plantLock(P, target) {
  const f = path.join(P.profile, 'SingletonLock');
  fs.mkdirSync(P.profile, { recursive: true });
  fs.rmSync(f, { force: true });
  fs.symlinkSync(target, f);
}
const carries = (pid, P) => { try { return cmdline(pid).includes(`--user-data-dir=${P.profile}`); } catch { return false; } };
// H2's stand-in: carries the profile, ignores SIGTERM, leads its own group with a sleep in it.
async function standInOn(P) {
  const c = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});require('child_process').spawn('sleep',['600'],{stdio:'ignore'});setInterval(()=>{},1e3)", '--', `--user-data-dir=${P.profile}`], { detached: true, stdio: 'ignore' });
  ownGroups.add(c.pid);
  await until(() => carries(c.pid, P), 'the stand-in up');
  const child = await until(() => Number(spawnSync('pgrep', ['-g', String(c.pid), 'sleep'], { encoding: 'utf8' }).stdout.trim().split('\n')[0]) || 0, "the stand-in's child");
  return { pid: c.pid, child };
}
const killGroup = async (G) => { try { process.kill(-G, 'SIGKILL'); } catch {} ownGroups.delete(G); await until(() => !alive(G), 'the group gone'); };
// SIGKILL the daemon (and Chrome, if asked) so nothing of the stop path runs.
async function crash(P, { chrome }) {
  const s = readState(P);
  process.kill(s.daemon_pid, 'SIGKILL');
  if (chrome) process.kill(s.chrome_pid, 'SIGKILL');
  await until(() => !alive(s.daemon_pid) && (!chrome || !alive(s.chrome_pid)), 'the crash');
  return s;
}
async function opened(P, url) {
  const r = await cli(P, ['open', url]);
  assert.equal(r.status, 0, `open: ${r.err || r.out}`);
  return r;
}

hygiene.push(['F1 the prefs are rewritten', async (h) => {
  fs.mkdirSync(path.dirname(PREFS(h)), { recursive: true });
  fs.writeFileSync(PREFS(h), JSON.stringify({ credentials_enable_service: true, profile: { password_manager_enabled: true, name: 'kept' }, autofill: { profile_enabled: true, credit_card_enabled: true }, session: { restore_on_startup: 4 } }));
  const check = (when) => {
    const p = JSON.parse(fs.readFileSync(PREFS(h), 'utf8'));
    assert.deepEqual([p.credentials_enable_service, p.profile.password_manager_enabled, p.autofill.profile_enabled, p.autofill.credit_card_enabled, p.session.restore_on_startup], [false, false, false, false, 1], when);
  };
  await started(h);
  check('right after start');
  assert.equal(JSON.parse(fs.readFileSync(PREFS(h), 'utf8')).profile.name, 'kept', 'every other key kept');
  await stopped(h);
  check('after stop');
}]);

hygiene.push(['F2 the session files go', async (h) => {
  await started(h);
  await opened(h, `${site.origin}/record`);
  // the spec's real form: a marker typed into the page's field, so the session holds a form state
  const snap = await cli(h, ['snapshot']);
  const ref = /^(e\d+) textbox ""/m.exec(snap.out)?.[1];
  assert.ok(ref, "/record's field has a ref");
  const typed = await cli(h, ['type', ref, 'zq-marker']);
  assert.equal(typed.status, 0, typed.err);
  await until(() => sessionsWritten(h), 'Chrome writes a session file');
  await crash(h, { chrome: true });
  const d = path.join(h.profile, 'Default');
  assert.ok(sessionsWritten(h), "the crashed Chrome's session file stays");
  // T3-1: Chromium removes a stray Session_* in Sessions/ itself as it starts, so the planted entries
  // include ones it leaves alone: a file of another name, and a folder, in each Sessions* folder.
  const planted = ['Sessions/Session_1', 'Sessions/keep-me', 'Sessions/sub/x', 'Sessions_Encrypted/Session_1', 'Sessions_Encrypted/keep-me', 'Sessions_Encrypted/sub/x', 'Sessions_Other/x', ...SESSION_NAMES];
  for (const f of planted) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), 'x'); }
  await started(h);
  // Chromium 156 makes Sessions/ and Sessions_Encrypted/ afresh as it starts: what is checked is that
  // nothing planted is left, and none of the four files.
  assert.deepEqual(planted.filter((f) => fs.existsSync(path.join(d, f))), [], 'nothing planted is left');
  assert.deepEqual(sessionLeft(h).filter((n) => !['Sessions', 'Sessions_Encrypted'].includes(n)), []);
  const s = await statusJson(h);
  assert.equal(s.tabs, 1);
  assert.equal(s.url, 'about:blank');
  await stopped(h);
}]);

hygiene.push(['F3 a failed delete refuses', async (h) => {
  const f = path.join(h.profile, 'Default', 'Sessions', 'x');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, 'x');
  try {
    const r = await startCli(h, { DEVTEAM_TEST_BROWSER_DELETE_FAILS: '1' });
    assert.equal(r.status, 1, r.out);
    assert.match(r.err, /couldn't delete/);
    assert.deepEqual(testBrowserPids().filter((p) => carries(p, h)), [], 'no Chrome on the profile');
  } finally { fs.rmSync(path.dirname(f), { recursive: true, force: true }); }
}]);

hygiene.push(['F4 stop deletes them', async (h) => {
  await started(h);
  await opened(h, `${site.origin}/record`);
  // the check bites: Chrome has written the page's session before stop
  await until(() => sessionsWritten(h), 'Chrome writes a session file');
  await stopped(h);
  assert.deepEqual(sessionLeft(h), [], 'no Sessions* entry and none of the four files after stop');
}]);

hygiene.push(['G1 the daemon\'s death leaves Chrome; the next start kills it', async (h) => {
  await started(h);
  const old = await crash(h, { chrome: false });
  await new Promise((r) => setTimeout(r, 1000));
  assert.ok(alive(old.chrome_pid), 'Chrome outlives a SIGKILLed daemon');
  await started(h);
  assert.equal(alive(old.chrome_pid), false, 'the old Chrome is gone');
  assert.notEqual(readState(h).chrome_pid, old.chrome_pid);
  const s = await statusJson(h);
  assert.equal(s.restarted, true);
  assert.equal(s.tabs, 1);
  await stopped(h);
}]);

hygiene.push(['G2 the same with state.json deleted: the SingletonLock names it', async (h) => {
  await started(h);
  const old = await crash(h, { chrome: false });
  fs.rmSync(h.state);
  assert.ok(alive(old.chrome_pid));
  await started(h);
  assert.equal(alive(old.chrome_pid), false, 'the old Chrome is gone');
  assert.equal((await statusJson(h)).restarted, true);
  await stopped(h);
}]);

hygiene.push(['G3 DevToolsActivePort is never read', async (h) => {
  const d = path.join(h.profile, 'DevToolsActivePort');
  fs.rmSync(d, { recursive: true, force: true }); // the file an earlier Chrome wrote
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'x'), 'x');
  try {
    await started(h);
    assert.equal((await statusJson(h)).tabs, 1);
    await stopped(h);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
}]);

hygiene.push(['H1 a sleep is left alone', async (h) => {
  const sleep = spawn('sleep', ['600'], { detached: true, stdio: 'ignore' });
  ownGroups.add(sleep.pid);
  try {
    plantState(h, sleep.pid);
    plantLock(h, `${os.hostname()}-${sleep.pid}`);
    await started(h);
    assert.ok(alive(sleep.pid), 'a pid without the profile flag is never signalled');
    assert.equal((await statusJson(h)).restarted, false);
    await stopped(h);
  } finally { await killGroup(sleep.pid); }
}]);

hygiene.push(['H2 a TERM-proof stand-in and its group go', async (h) => {
  const si = await standInOn(h);
  try {
    plantState(h, si.pid);
    const r = await started(h);
    assert.ok(r.ms < 10000, `took ${r.ms} ms`);
    assert.equal(alive(si.pid), false, 'the stand-in is gone');
    assert.equal(alive(si.child), false, 'its group\'s child is gone');
    await stopped(h);
  } finally { await killGroup(si.pid); }
}]);

hygiene.push(['H3 a non-leader is signalled alone', async (h) => {
  const c = spawn('sh', ['-c', `'${process.execPath}' -e "process.on('SIGTERM',()=>{});setInterval(()=>{},1e3)" -- --user-data-dir='${h.profile}' & echo $!; sleep 600 & echo $!; wait`], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  ownGroups.add(c.pid);
  try {
    let text = '';
    c.stdout.on('data', (d) => { text += d; });
    const [stand, sib] = await until(() => { const p = text.trim().split('\n').map(Number).filter(Boolean); return p.length === 2 && p; }, 'the two pids');
    await until(() => carries(stand, h), 'the stand-in up');
    plantState(h, stand);
    await started(h);
    assert.equal(alive(stand), false, 'the stand-in is gone');
    assert.ok(alive(sib), 'its sibling lives: the group was not signalled');
    assert.ok(alive(c.pid), 'sh lives');
    await stopped(h);
  } finally { await killGroup(c.pid); }
}]);

hygiene.push(['I1 a foreign stale lock is cleared and said', async (h) => {
  fs.rmSync(h.state, { force: true });
  plantLock(h, 'a-b-c-1234');
  const ino = {};
  for (const n of ['SingletonSocket', 'SingletonCookie']) { const f = path.join(h.profile, n); fs.rmSync(f, { force: true }); fs.writeFileSync(f, ''); ino[n] = fs.lstatSync(f).ino; }
  await started(h);
  const s = await statusJson(h);
  assert.ok(s.notes.includes('Cleared a stale SingletonLock left by host a-b-c.'), JSON.stringify(s.notes));
  let link = null; try { link = fs.readlinkSync(path.join(h.profile, 'SingletonLock')); } catch {}
  assert.notEqual(link, 'a-b-c-1234');
  // gone, or replaced: Chrome's own are symlinks, the planted ones plain files (an inode can be reused)
  for (const n of ['SingletonSocket', 'SingletonCookie']) { const st = fs.lstatSync(path.join(h.profile, n), { throwIfNoEntry: false }); assert.ok(!st || st.isSymbolicLink() || st.ino !== ino[n], `${n} gone or replaced`); }
  await stopped(h);
}]);

hygiene.push(['I2 a foreign lock with a local holder is refused', async (h) => {
  fs.rmSync(h.state, { force: true });
  const si = await standInOn(h);
  try {
    plantLock(h, 'a-b-c-1234');
    const r = await startCli(h);
    assert.equal(r.status, 1, r.out);
    assert.match(r.err, /host a-b-c/);
    assert.ok(alive(si.pid), 'the holder lives');
  } finally { await killGroup(si.pid); }
}]);

hygiene.push(['I3 the last hyphen splits', async (h) => {
  const hook = { DEVTEAM_TEST_BROWSER_HOSTNAME: 'x-y-z' };
  fs.rmSync(h.state, { force: true });
  const one = await standInOn(h);
  try {
    plantLock(h, `x-y-z-${one.pid}`);
    const r = await startCli(h, hook);
    assert.equal(r.status, 0, r.err);
    assert.equal(alive(one.pid), false, 'read as this host: the stand-in is killed');
    await stopped(h);
  } finally { await killGroup(one.pid); }
  fs.rmSync(h.state, { force: true });
  const two = await standInOn(h);
  try {
    plantLock(h, `x-y-${two.pid}`);
    const r = await startCli(h, hook);
    assert.equal(r.status, 1, r.out);
    assert.match(r.err, /host x-y\b/);
    assert.ok(alive(two.pid));
  } finally { await killGroup(two.pid); }
  fs.rmSync(path.join(h.profile, 'SingletonLock'), { force: true });
}]);

const tmuxOf = (P, args, env = {}) => spawnSync('tmux', args, { encoding: 'utf8', env: { ...process.env, TMUX_TMPDIR: P.env.TMUX_TMPDIR, ...env } });
// The project's dev~ windows: { name, pid, id }.
function devWindows(P) {
  const r = tmuxOf(P, ['list-panes', '-s', '-t', `=${sessionOf(P.old, P.name)}`, '-F', '#{window_name} #{pane_pid} #{window_id}']);
  if (r.status !== 0) return [];
  return r.stdout.split('\n').filter(Boolean).map((l) => { const [name, pid, id] = l.split(' '); return { name, pid: Number(pid), id }; }).filter((w) => w.name.startsWith('dev~'));
}

// ----- the daemon's own start and stop on h, restart-heavy (T2): before the chains -----

test('two starts at once start one daemon', { skip, timeout: 120000 }, async () => {
  // first on h, so both clients also race to write a fresh profile's root.json (T2-1)
  assert.equal(fs.existsSync(h.profile), false);
  // T2-3: every dev~ window and every daemon that wrote state.json while the two ran; without the
  // start lock each client launches its own window and daemon.
  const windows = new Set(), daemons = new Set();
  const watch = setInterval(() => {
    for (const w of devWindows(h)) windows.add(w.id);
    try { daemons.add(readState(h).daemon_pid); } catch {}
  }, 50);
  let one, two;
  try { [one, two] = await Promise.all([cli(h, ['start']), cli(h, ['start'])]); } finally { clearInterval(watch); }
  assert.equal(one.status, 0, one.err);
  assert.equal(two.status, 0, two.err);
  assert.equal(windows.size, 1, `one dev~ window ever: ${[...windows]}`);
  assert.equal(daemons.size, 1, `one daemon ever wrote state.json: ${daemons.size}`);
  const s = readState(h);
  assert.ok(alive(s.daemon_pid));
  assert.equal(devWindows(h).length, 1, JSON.stringify(devWindows(h)));
  const st = await statusJson(h);
  assert.equal(st.running, true);
  assert.equal(readState(h).daemon_pid, s.daemon_pid);
  await stopped(h);
});

test('status and stop: the round trip', { skip, timeout: 120000 }, async () => {
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

test('Review Focus 5: a stale state.json starts afresh', { skip, timeout: 120000 }, async () => {
  fs.mkdirSync(path.dirname(h.state), { recursive: true });
  fs.writeFileSync(h.state, '{');
  const s = await statusJson(h);
  assert.equal(s.running, false);
  await started(h);
  assert.deepEqual(validate('state', readState(h)), []);
  await stopped(h);
});

// T4-1: the hook names a file; the first daemon to find it missing makes it and fails its view-port
// bind with EADDRINUSE, as when another project's preview takes the port first. start retries.
test('T4-1 a view port taken before the daemon binds it: start retries', { skip, timeout: 120000 }, async () => {
  const marker = path.join(tmp, 'bind-failed');
  await started(h, { DEVTEAM_TEST_BROWSER_BIND_FAIL: marker });
  assert.ok(fs.existsSync(marker), 'the first daemon failed its bind');
  assert.equal(devWindows(h).length, 1, 'one dev~ window');
  const recs = fs.readdirSync(path.join(h.old, 'docs', 'devteam', 'run', 'previews')).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(fs.readFileSync(path.join(h.old, 'docs', 'devteam', 'run', 'previews', n), 'utf8'))).filter((r) => r.label === 'browser');
  assert.equal(recs.length, 1, 'one browser preview record');
  const s = readState(h);
  assert.equal(recs[0].port, s.view_port);
  assert.equal((await statusJson(h)).running, true, 'the daemon answers');
  assert.equal((await fetch(`http://127.0.0.1:${s.view_port}/`)).status, 503, 'the daemon listens on the view port');
  await stopped(h);
});

test('T5-1 the screenshot fails closed; T5-2 an image title; T5-4 type and --; T5-7 back within a page', { skip, timeout: 120000 }, async () => {
  // T5b-1: every capture waits 1 s after the check, so a page can change in between
  await started(h, { DEVTEAM_TEST_BROWSER_SHOT_DELAY_MS: '1000' });
  const shots = path.join(h.old, 'docs', 'devteam', 'run', 'browser', 'shots');
  const shot = async () => { const r = await cli(h, ['screenshot']); assert.equal(r.status, 0, `screenshot: ${r.err}`); return r.out; };
  const o = `http://127.0.0.1:${own.port}`;
  // a CSP that blocks an injected <style>: the password and the code field are still blank
  await opened(h, `${o}/strict`);
  const [pw, code, plain] = await colours(await shot(), [[24, 56], [104, 136], [184, 216]]);
  assert.equal(pw, 1, 'the password box is one colour under a strict CSP');
  assert.equal(code, 1, 'the code box is one colour under a strict CSP');
  assert.ok(plain > 1, 'the control: a plain field draws its glyphs');
  // a password field in a closed shadow root
  await opened(h, `${o}/shadow`);
  const [inShadow, outside] = await colours(await shot(), [[24, 56], [104, 136]]);
  assert.equal(inShadow, 1, 'the shadow-root password box is one colour');
  assert.ok(outside > 1, 'the control: the plain field draws its glyphs');
  // a frame from another site (an iframe, an object), out of reach: refused, and no file written
  const before = fs.readdirSync(shots).length, out = path.join(tmp, 'framed.png');
  for (const page of ['framed', 'object']) {
    await opened(h, `${o}/${page}`);
    for (const args of [['screenshot'], ['screenshot', '--out', out]]) {
      const r = await cli(h, args);
      assert.equal(r.status, 1, `${page}: ${r.out}`);
      assert.match(r.err, /refused: the page holds a frame from another site/, page);
    }
  }
  // T5b-1: a password field added between the check and the capture: refused after it, nothing written
  await opened(h, `${o}/late`);
  for (const args of [['screenshot'], ['screenshot', '--out', out]]) {
    const r = await cli(h, args);
    assert.equal(r.status, 1, `late: ${r.out}`);
    assert.match(r.err, /refused: the page changed its password or code fields while it was captured/);
    await opened(h, `${o}/late`); // afresh: the page adds its field once
  }
  assert.equal(fs.readdirSync(shots).length, before, 'no shot written');
  assert.equal(fs.existsSync(out), false, 'no --out file written');
  // T5-3: --out over a file that is 0644 replaces it, 0600
  const there = path.join(tmp, 'there.png');
  fs.writeFileSync(there, 'x', { mode: 0o644 });
  await opened(h, `${o}/hash`);
  const r3 = await cli(h, ['screenshot', '--out', there]);
  assert.equal(r3.status, 0, r3.err);
  assert.equal(fs.statSync(there).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(there).subarray(1, 4).toString(), 'PNG');
  // T5-7: back to an entry of the same page settles at once
  const ref = /^(e\d+) link "Part"/m.exec((await cli(h, ['snapshot'])).out)?.[1];
  assert.ok(ref, 'the Part link');
  assert.equal((await cli(h, ['click', ref])).status, 0);
  const t0 = Date.now();
  const back = await cli(h, ['back']);
  assert.equal(back.status, 0, back.err);
  assert.ok(Date.now() - t0 < 10000, `back took ${Date.now() - t0} ms`);
  // T5-2: an image's title is its file name: the masked URL instead
  const img = await opened(h, `${o}/img/zqimagetokenzqimagetoken.png`);
  const tabs = await cli(h, ['tabs']);
  for (const x of [img.out, tabs.out]) assert.ok(!x.includes('zqimagetoken'), 'no raw path segment printed');
  assert.equal(JSON.parse(tabs.out).tabs[0].title, `${o}/img/•••`);
  // T5-4: a word starting with -- is refused, never dropped; after a bare -- it is typed
  await opened(h, `${site.origin}/record`);
  const field = /^(e\d+) textbox ""/m.exec((await cli(h, ['snapshot'])).out)?.[1];
  assert.ok(field, "/record's field");
  const dropped = await cli(h, ['type', field, 'use', '--force', 'now']);
  assert.equal(dropped.status, 1, dropped.out);
  assert.match(dropped.err, /bare --/);
  assert.ok(!dropped.err.includes('force'), 'the word is not echoed');
  const typed = await cli(h, ['type', field, '--', '--force', 'now']);
  assert.equal(typed.status, 0, typed.err);
  await until(() => site.events().some((x) => x.kind === 'input' && x.value === '--force now'), 'the whole text typed');
  assert.ok(!site.events().some((x) => x.kind === 'input' && x.value === 'use'), 'nothing typed by the refused call');
  await stopped(h);
});

test('E5 the idle timer', { skip, timeout: 120000 }, async () => {
  await started(h, { DEVTEAM_TEST_BROWSER_IDLE_MS: '1500' });
  const s = readState(h);
  const t0 = Date.now();
  await until(() => !alive(s.daemon_pid) && !alive(s.chrome_pid) && !fs.existsSync(h.state), 'the idle stop');
  assert.ok(Date.now() - t0 < 8000, `took ${Date.now() - t0} ms`);
});

test('K2 a killed window takes Chrome', { skip, timeout: 120000 }, async () => {
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


test('profile hygiene on every start and stop: F1 to F4, G1 to G3, H1 to H3, I1 to I3', { skip, timeout: 280000, concurrency: 2 }, async (t) => {
  const chain = (P, ids) => t.test(`on ${P.name}`, { concurrency: 1 }, async (c) => {
    for (const [name, fn] of hygiene.filter(([x]) => ids.test(x))) await c.test(name, { timeout: 120000 }, () => fn(P));
  });
  await Promise.all([chain(h, /^[FG]/), chain(g, /^[HI]/)]);
});

// Last in the file (T5-6, the spec's J2 for this file): everything every verb printed here.
test('J2 nothing secret printed (hygiene)', { skip, timeout: 120000 }, async () => {
  const all = seen.join('\n');
  assert.ok(secrets.size >= 2, 'control secrets were read');
  [...secrets].forEach((v, i) => assert.ok(!all.includes(v), `control secret ${i} printed`));
  site.sessions().forEach((v, i) => assert.ok(!all.includes(v), `session ${i} printed`));
  for (const [what, v] of [['the typed marker', 'zq-marker'], ['the typed text', '--force now'], ['the password', site.password], ['the code', site.code], ['a fixture field value', 'zqpwzqpw'], ['a fixture code value', 'ZQCODEZQ'], ['the late field value', 'zqlatezq']]) assert.ok(!all.includes(v), `${what} printed`);
});
