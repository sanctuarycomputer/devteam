// devteam.mjs browser (kit-64): profile hygiene on every start and stop (spec F, G, H and I;
// docs/devteam/project/tickets/kit-64-browser-command/spec.md, home), split from
// test/browser-hygiene.test.mjs (kit-223) so each file stays inside CI's per-file watchdog. The fixture
// (test/lib/browser-fixture.mjs) runs J2's never-print sweep over this file's verbs after its tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canDrive, chromePath } from './lib/chrome.mjs';
import { until } from './lib/kit.mjs';
import { validate } from './fixtures/browser/check.mjs';
import { tmp, site, cli, testBrowserPids, alive, readState, startCli, started, statusJson, stopped, h, g, ownGroups, opened, hygieneFile } from './lib/browser-fixture.mjs';

// CI's Node 22 and 24 jobs have Chrome: there the file must run, never skip.
const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;
const skip = canDrive ? false : 'needs Chrome and Node 22+';
if (mustRun && !canDrive) test('Chrome is needed on CI\'s Node 22+', () => assert.fail('Chrome is needed on CI\'s Node 22+: this file must run there, not skip'));
hygieneFile({ sweep: true });

const cmdline = (pid) => fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
const hygiene = [];
const PREFS = (P) => path.join(P.profile, 'Default', 'Preferences');
const SESSION_NAMES = ['Current Session', 'Current Tabs', 'Last Session', 'Last Tabs'];
const sessionLeft = (P) => { const d = path.join(P.profile, 'Default'); return [...fs.readdirSync(d).filter((n) => n.startsWith('Sessions')), ...SESSION_NAMES.filter((n) => fs.existsSync(path.join(d, n)))]; };
// Whether Chrome has written a session file for the open page: Default/Sessions/ holds one.
const sessionsWritten = (P) => { try { return fs.readdirSync(path.join(P.profile, 'Default', 'Sessions')).length > 0; } catch { return false; } };
// A pid that is certainly dead: a process that ran and was reaped.
const deadPid = () => spawnSync('true').pid;
// A schema-valid state.json of a dead daemon, naming chrome_pid, in the pipe form (no cdp_port; kit-316).
function plantState(P, chromePid) {
  const s = { browser: 1, daemon_pid: deadPid(), chrome_pid: chromePid, control_port: 1, control_secret: '0'.repeat(64), guard_port: 1, view_port: 1, preview: 'gone-preview' };
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
// H2's stand-in: carries the profile, ignores SIGTERM (stamping Date.now() into termFile first), leads its own group with a sleep in it.
async function standInOn(P, termFile = os.devNull) {
  const c = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{require('fs').writeFileSync(process.argv[1],String(Date.now()))});require('child_process').spawn('sleep',['600'],{stdio:'ignore'});setInterval(()=>{},1e3)", '--', termFile, `--user-data-dir=${P.profile}`], { detached: true, stdio: 'ignore' });
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

// kit-316 S2: Chrome's DevTools pipe closes with the daemon, so Chrome goes with it (P7).
hygiene.push(['G1 the daemon\'s death takes Chrome with it', async (h) => {
  await started(h);
  const old = await crash(h, { chrome: false });
  const t0 = Date.now();
  await until(() => !alive(old.chrome_pid), 'Chrome gone after its daemon');
  assert.ok(Date.now() - t0 < 15000, `took ${Date.now() - t0} ms`);
  await started(h);
  assert.equal((await statusJson(h)).tabs, 1);
  await stopped(h);
}]);

// What Chrome left loose in this test process's temp folder (its own: test/lib/private-tmp.mjs, or
// test/run.mjs's).
const looseChromeTemp = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('org.chromium.'));
const linkOf = (f) => { try { return fs.readlinkSync(f); } catch { return null; } };
// A leftover Chrome the test starts itself on P's profile, kept off the network, in its own group (the test's):
// { pid, own (its own folder), end }, once it is up and ownTemp() has passed (end() runs first if either
// fails). Its TMPDIR is own, a folder of its own in the temp folder, so its
// org.chromium.Chromium.* folders go there, never loose in the temp folder, where a killed Chrome leaves them
// (kit-1023). own is absolute, so the leftover's SingletonSocket link is too and still guards its profile from a
// second Chrome, as a real leftover's does: Chrome reads a relative link from its own working folder. Only if the
// socket's path would pass 107 bytes is TMPDIR own's name, relative to the temp folder, Chrome's working folder.
// ownTemp() waits for the leftover's own link (not one an earlier Chrome left) to name a live socket, and checks
// that socket is in own, and that the link is absolute when it can be. end() kills the group, removes own, and
// returns what of Chrome is newly loose in the temp folder.
async function leftoverOn(P) {
  const own = fs.mkdtempSync(path.join(os.tmpdir(), 'c'));
  // <own>/org.chromium.Chromium.XXXXXX/SingletonSocket
  const fits = Buffer.byteLength(own) + 46 <= 107;
  const link = path.join(P.profile, 'SingletonSocket');
  const was = linkOf(link);
  const loose = new Set(looseChromeTemp());
  const c = spawn(chromePath, ['--headless=new', `--user-data-dir=${P.profile}`, '--proxy-server=127.0.0.1:9', '--disable-background-networking', '--no-first-run', '--no-sandbox', 'about:blank'], { cwd: os.tmpdir(), detached: true, stdio: 'ignore', env: { ...process.env, TMPDIR: fits ? own : path.basename(own) } });
  ownGroups.add(c.pid);
  const ownTemp = async () => {
    const l = await until(() => { const v = linkOf(link); return v && v !== was && fs.existsSync(path.resolve(os.tmpdir(), v)) && v; }, 'the leftover links its SingletonSocket');
    const sock = path.resolve(os.tmpdir(), l);
    assert.ok(sock.startsWith(own + path.sep), `the leftover's temp folder is its own (${own}), not ${path.dirname(sock)}`);
    if (fits) assert.ok(path.isAbsolute(l), `the leftover's SingletonSocket link is absolute, so it guards its profile: ${l}`);
  };
  const end = async () => { await killGroup(c.pid); fs.rmSync(own, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); return looseChromeTemp().filter((n) => !loose.has(n)); };
  try {
    await until(() => carries(c.pid, P), 'the leftover Chrome up');
    await ownTemp();
  } catch (e) { await end(); throw e; }
  return { pid: c.pid, own, end };
}

hygiene.push(['G2 a leftover Chrome with state.json deleted: the SingletonLock names it', async (h) => {
  await stopped(h);
  fs.rmSync(h.state, { force: true });
  const { pid, own, end } = await leftoverOn(h);
  let left;
  try {
    await until(() => { try { return fs.readlinkSync(path.join(h.profile, 'SingletonLock')) === `${os.hostname()}-${pid}`; } catch { return false; } }, 'the SingletonLock names the leftover');
    await started(h);
    assert.equal(alive(pid), false, 'the leftover Chrome is gone');
    assert.equal((await statusJson(h)).restarted, true);
    await stopped(h);
  } finally { left = await end(); }
  assert.deepEqual(left, [], 'the killed leftover left nothing loose in the temp folder');
  assert.equal(fs.existsSync(own), false, "the leftover's own folder is removed with it");
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
  const termFile = path.join(tmp, `term-${process.pid}-${Date.now()}`);
  const si = await standInOn(h, termFile);
  try {
    plantState(h, si.pid);
    let goneAt = 0;
    const poll = setInterval(() => { if (!goneAt && !alive(si.pid)) goneAt = Date.now(); }, 25);
    try { await started(h); } finally { clearInterval(poll); }
    assert.ok(fs.existsSync(termFile), 'the stand-in saw SIGTERM');
    const took = goneAt - Number(fs.readFileSync(termFile, 'utf8'));
    assert.ok(goneAt > 0 && took < 5000, `SIGTERM to gone took ${took} ms`);
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



test('profile hygiene on every start and stop: F1 to F4, G1 to G3, H1 to H3, I1 to I3 (part 1 of 2: F1 to F4 and H1 to H3)', { skip, timeout: 280000, concurrency: 2 }, async (t) => {
  const chain = (P, ids) => t.test(`on ${P.name}`, { concurrency: 1 }, async (c) => {
    for (const [name, fn] of hygiene.filter(([x]) => ids.test(x))) await c.test(name, { timeout: 120000 }, () => fn(P));
  });
  await Promise.all([chain(h, /^F/), chain(g, /^H/)]);
});

test('profile hygiene on every start and stop: F1 to F4, G1 to G3, H1 to H3, I1 to I3 (part 2 of 2: G1 to G3 and I1 to I3)', { skip, timeout: 280000, concurrency: 2 }, async (t) => {
  const chain = (P, ids) => t.test(`on ${P.name}`, { concurrency: 1 }, async (c) => {
    for (const [name, fn] of hygiene.filter(([x]) => ids.test(x))) await c.test(name, { timeout: 120000 }, () => fn(P));
  });
  await Promise.all([chain(h, /^G/), chain(g, /^I/)]);
});
