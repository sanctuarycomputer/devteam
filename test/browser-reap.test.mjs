// The browser reaper and the close's deadline (kit-877, tested by kit-917), with no Chrome and no tmux.
// `browser reap` (internal) runs directly, as the daemon's sh line runs it, on a fixture checkout under a
// private HOME, against stand-in processes: node sleepers whose command lines carry the profile, the
// way Chrome's do. The close's deadline is checked by cutting browserCloseRestart and browserRelaunch
// out of devteam.mjs and running them under node:vm on a stand-in Chrome that never answers its close.
// Each check is the spec's (docs/devteam/project/tickets/kit-917-browser-reap-tests/spec.md, home),
// named by its id. Only processes this file started are ever killed: a kill checks the pid's command
// line still carries this file's stand-in code (killMine), so a pid reused by another process is never hit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { monoFixture } from './lib/kit.mjs';

const kitFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'devteam', 'scripts', 'devteam.mjs');
const started = [];
const STANDIN = 'setTimeout(() => process.exit(0), 120000); setInterval(() => {}, 1000)';
// SIGKILL to pid only while it is alive and its command line still carries STANDIN (one of ours).
function killMine(pid) {
  let cmd = '';
  try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { return; }
  if (cmd.split('\0').includes(STANDIN)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Alive and not a zombie.
function alive(pid) {
  try { process.kill(pid, 0); } catch { return false; }
  try { const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return st.slice(st.lastIndexOf(')') + 2)[0] !== 'Z'; } catch { return false; }
}
const linux = fs.existsSync('/proc/self/stat');
// browser refuses below Node 22 (browserGates), so `browser reap` checks run on CI's Node 22 and 24 jobs
const node22 = Number(process.versions.node.split('.')[0]) >= 22 && typeof WebSocket === 'function';
const skip = !linux ? 'reads /proc (the reaper\'s Linux path)' : !node22 ? 'browser needs Node 22+' : false;
const skipVm = linux ? false : 'reads /proc (the reaper\'s Linux path)';

let F, P;
before(() => {
  if (skip) return;
  F = monoFixture('reap');
  const home = path.join(F.base, 'reap-home');
  fs.mkdirSync(home);
  const env = { ...F.env({ DEVTEAM_ROLE: 'supervisor' }), HOME: home, DEVTEAM_TEST: '1', DEVTEAM_BROWSER_SERVE: '1' };
  const st = spawnSync(process.execPath, [path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), 'browser', 'status'], { cwd: F.old, env, encoding: 'utf8', timeout: 60000 });
  const key = /profile (\S+)\)/.exec(st.stdout)?.[1];
  assert.ok(key, `the profile key from browser status: ${st.stdout} ${st.stderr}`);
  const run = path.join(F.old, 'docs', 'devteam', 'run', 'browser');
  P = { env, home, key, profile: path.join(home, '.devteam', 'browser', key), run, lastError: path.join(run, 'last-error') };
});
after(() => {
  for (const p of started) killMine(p);
  F?.done();
});

// A stand-in process: node sleeping, with args on its command line; its own group when detached. It
// ends itself after 120 s (STANDIN), so a run killed before its after (a timeout, CI's watchdog) leaves
// nothing running on a shared machine for long.
function sleeper(args, { detached = true } = {}) {
  const c = spawn(process.execPath, ['-e', STANDIN, '--', ...args], { detached, stdio: 'ignore' });
  c.unref();
  started.push(c.pid);
  return c.pid;
}
// A dead Chrome's group: a leader (its own group) that starts a helper on the profile in its group and
// then exits. { leader, helper }; the leader is gone when this returns.
async function deadLeaderWithHelper() {
  const pidFile = path.join(P.home, `helper-${Date.now()}`);
  const code = `const c = require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(STANDIN)}, '--', ${JSON.stringify(`--user-data-dir=${P.profile}`)}], { stdio: 'ignore' }); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); process.exit(0);`;
  const c = spawn(process.execPath, ['-e', code, '--', `--user-data-dir=${P.profile}`], { detached: true, stdio: 'ignore' });
  started.push(c.pid);
  await new Promise((r) => c.on('exit', r));
  const helper = Number(fs.readFileSync(pidFile, 'utf8'));
  started.push(helper);
  assert.ok(alive(helper), 'the helper outlives its leader');
  return { leader: c.pid, helper };
}
// The session files Chrome would bring tabs back from, planted; planted() while any is there.
const SESSION = () => [path.join(P.profile, 'Default', 'Sessions', 'Session_1'), path.join(P.profile, 'Default', 'Current Session')];
function plant() {
  fs.mkdirSync(path.join(P.profile, 'Default', 'Sessions'), { recursive: true });
  for (const f of SESSION()) fs.writeFileSync(f, 'typed text');
}
const planted = () => SESSION().some((f) => fs.existsSync(f));
// A fresh start for each check: no run/browser, a profile folder with no session files.
function reset() {
  fs.rmSync(P.run, { recursive: true, force: true });
  fs.rmSync(P.profile, { recursive: true, force: true });
  fs.mkdirSync(path.join(P.profile, 'Default'), { recursive: true });
}
const runDir = () => fs.mkdirSync(P.run, { recursive: true });
const state = (o) => { runDir(); fs.writeFileSync(path.join(P.run, 'state.json'), JSON.stringify({ browser: 1, ...o })); };
const lockOwner = (pid) => { fs.mkdirSync(path.join(P.run, 'start.lock'), { recursive: true }); fs.writeFileSync(path.join(P.run, 'start.lock', 'owner'), `${pid}-0123456789abcdef`); };
const readErr = () => { try { return fs.readFileSync(P.lastError, 'utf8').trim(); } catch { return null; } };
const writeErr = (text) => { runDir(); fs.writeFileSync(P.lastError, `2026-11-25T00:00:00.000Z ${text}\n`); };
const errText = () => readErr()?.replace(/^\S+ /, '') ?? null;
// browser reap on the fixture: { code, ms, err }.
function reap(extra = {}) {
  return new Promise((resolve, reject) => {
    const t = Date.now();
    const c = spawn(process.execPath, [path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), 'browser', 'reap'], { cwd: F.old, env: { ...P.env, ...extra }, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    c.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => c.kill('SIGKILL'), 30000);
    c.on('error', reject);
    c.on('close', (code) => { clearTimeout(timer); resolve({ code, ms: Date.now() - t, err: err.trim() }); });
  });
}
const STAY = /session files stay/;
const why = (r) => `${JSON.stringify(r)} last-error: ${readErr()}`;

// ----- done-when 1: the reaper's stand-downs and its kill, and the no-repeat rule

test('RP1 a state.json daemon_pid that is alive but no browser serve (a reused pid) doesn\'t stand the reaper down', { skip }, async () => {
  reset(); plant();
  state({ daemon_pid: sleeper(['something-else']), chrome_pid: 0 });
  const r = await reap();
  assert.equal(planted(), false, `RP1: the session files stay: ${why(r)}`);
  assert.equal(r.code, 0, why(r));
});

test('RP1b a state.json daemon_pid that is a live browser serve stands the reaper down', { skip }, async () => {
  reset(); plant();
  state({ daemon_pid: sleeper(['browser', 'serve']), chrome_pid: 0 });
  const r = await reap();
  assert.equal(planted(), true, `RP1b: a live daemon's session files deleted: ${why(r)}`);
  assert.equal(r.code, 0, why(r));
});

test('RP2 a start lock with a live owner stands the reaper down; a dead owner doesn\'t', { skip }, async () => {
  reset(); plant(); runDir();
  lockOwner(process.pid);
  let r = await reap();
  assert.equal(planted(), true, `RP2: deleted under a live start lock: ${why(r)}`);
  assert.equal(r.code, 0, why(r));
  lockOwner(Number(fs.readFileSync('/proc/sys/kernel/pid_max', 'utf8')) + 1); // a pid no process can have
  r = await reap();
  assert.equal(planted(), false, `RP2: kept under a dead owner's lock: ${why(r)}`);
});

test('RP3 a helper left in the dead Chrome\'s group, on the profile, is killed and the files deleted', { skip }, async () => {
  reset(); plant();
  const { leader, helper } = await deadLeaderWithHelper();
  state({ daemon_pid: 0, chrome_pid: leader });
  const r = await reap();
  assert.equal(alive(helper), false, `RP3: the helper in the dead Chrome's group lives: ${why(r)}`);
  assert.equal(planted(), false, `RP3: the session files stay: ${why(r)}`);
  assert.deepEqual([r.code, readErr()], [0, null], why(r));
});

test('RP3b a process on the profile outside the dead Chrome\'s group is never killed: the files stay and that is said', { skip, timeout: 30000 }, async () => {
  reset(); plant();
  const { leader, helper } = await deadLeaderWithHelper();
  const other = sleeper([`--user-data-dir=${P.profile}`]); // its own group: never the reaper's to kill
  try {
    state({ daemon_pid: 0, chrome_pid: leader });
    const r = await reap();
    assert.equal(alive(other), true, `RP3b: the reaper killed a process outside the dead Chrome's group: ${why(r)}`);
    assert.equal(alive(helper), false, `RP3b: the helper in the group lives: ${why(r)}`);
    assert.equal(planted(), true, why(r));
    assert.match(errText() ?? '', /still had the profile 5 s later; its session files stay/, why(r));
    assert.equal(r.code, 1, why(r));
  } finally { killMine(other); }
});

test('RP4 a failed delete whose line already says the delete failed isn\'t said again', { skip }, async () => {
  reset(); plant(); runDir();
  let r = await reap({ DEVTEAM_TEST_BROWSER_DELETE_FAILS: '1' });
  const first = errText();
  assert.match(first ?? '', /^browser: couldn't delete .*\(EACCES\): Chrome would bring its tabs back$/, why(r));
  r = await reap({ DEVTEAM_TEST_BROWSER_DELETE_FAILS: '1' });
  assert.equal(errText(), first, `RP4: the line changed on a second failed delete: ${why(r)}`);
  assert.equal(r.code, 1, why(r));
});

// ----- done-when 3: last-error never says the session files stay when they are gone

test('LE1 a clean stop whose processes couldn\'t be listed, files already gone: no line says they stay', { skip }, async () => {
  reset(); runDir();
  const r = await reap({ DEVTEAM_TEST_BROWSER_PROCS_UNLISTED: '1' });
  assert.equal(readErr(), null, `LE1: ${why(r)}`);
  assert.equal(r.code, 0, why(r));
});

test('LE1b the same with a shutdown\'s reason on file: the reason stays as it was', { skip }, async () => {
  reset();
  writeErr("browser: couldn't read the log during a handover, so the session was ended");
  const r = await reap({ DEVTEAM_TEST_BROWSER_PROCS_UNLISTED: '1' });
  assert.equal(errText(), "browser: couldn't read the log during a handover, so the session was ended", `LE1b: ${why(r)}`);
});

test('LE2 a clean stop with a process still on the profile 5 s later, files already gone: no line says they stay', { skip, timeout: 30000 }, async () => {
  reset(); runDir();
  const stray = sleeper([`--user-data-dir=${P.profile}`]); // its own group: never the reaper's to kill
  try {
    const r = await reap();
    assert.ok(!STAY.test(readErr() ?? ''), `LE2: ${why(r)}`);
    assert.equal(r.code, 0, why(r));
  } finally { killMine(stray); }
});

test('LE3 a shutdown\'s failed delete the reaper finishes: the line keeps the reason and says the files are gone', { skip }, async () => {
  reset(); plant();
  writeErr(`browser: couldn't read the log during a handover, so the session was ended; the session files stay: browser: couldn't delete ${SESSION()[0]} (EACCES): Chrome would bring its tabs back`);
  const r = await reap();
  assert.equal(planted(), false, why(r));
  assert.equal(errText(), "browser: couldn't read the log during a handover, so the session was ended; the session files were deleted after the daemon ended", `LE3: ${why(r)}`);
  assert.equal(r.code, 0, why(r));
});

test('LE3b a failed delete alone, which the reaper finishes: its words kept, ending that the files are gone', { skip }, async () => {
  reset(); plant();
  const failed = `browser: couldn't delete ${SESSION()[0]} (EACCES): Chrome would bring its tabs back`;
  writeErr(failed);
  const r = await reap();
  assert.equal(planted(), false, why(r));
  assert.equal(errText(), `${failed}; the session files were deleted after the daemon ended`, `LE3b: ${why(r)}`);
  assert.equal(r.code, 0, why(r));
});

test('LE3c a reason too long for the ending is cut so the ending is whole', { skip }, async () => {
  reset(); plant();
  const reason = `browser: ${'x'.repeat(261)}`; // 270 characters (its join still within last-error's read): with the 55-character ending, over 300
  writeErr(`${reason}; the session files stay: browser: couldn't delete a (EACCES): Chrome would bring its tabs back`);
  const r = await reap();
  assert.equal(planted(), false, why(r));
  assert.equal(errText(), `${reason.slice(0, 245)}; the session files were deleted after the daemon ended`, `LE3c: ${why(r)}`);
});

test('LE4 an earlier reaper\'s own "files stay" report, with the files now gone: the line is removed', { skip }, async () => {
  reset();
  writeErr("browser: couldn't list this machine's processes after the daemon ended, so the session files stay");
  const r = await reap({ DEVTEAM_TEST_BROWSER_PROCS_UNLISTED: '1' });
  assert.equal(readErr(), null, `LE4: ${why(r)}`);
  assert.equal(r.code, 0, why(r));
});

test('X1 a session file the reaper can\'t even look at (its folder unsearchable) counts as left: the failed delete is said', { skip: skip || (process.getuid?.() === 0 ? 'root searches any folder' : false) }, async () => {
  reset(); plant(); runDir();
  const dflt = path.join(P.profile, 'Default');
  fs.chmodSync(dflt, 0o600);
  let r;
  try { r = await reap(); } finally { fs.chmodSync(dflt, 0o700); }
  assert.match(errText() ?? '', /^browser: couldn't delete .*: Chrome would bring its tabs back$/, `X1: the failed delete wasn't said: ${why(r)}`);
  assert.equal(planted(), true, why(r));
  assert.equal(r.code, 1, why(r));
});

// ----- done-when 2: the close's deadline is counted from Done. browserCloseRestart and browserRelaunch
// run under node:vm on a stand-in Chrome (a sleeper) whose Browser.close is never answered, so it ends
// only when the close kills it; the kill is timed from the close's start.

const kitSrc = fs.readFileSync(kitFile, 'utf8');
const cut = (from, to) => {
  const i = kitSrc.indexOf(from), j = kitSrc.indexOf(to, i);
  assert.ok(i >= 0 && j > i, `${from} … ${to} in devteam.mjs`);
  return kitSrc.slice(i, j);
};
// The close of one done answered `doneAgo` ms ago, held `hold` ms (the test hook): ms from the close's
// start to Chrome's kill.
async function closeTimed({ doneAgo, hold = 0 }) {
  const chrome = sleeper(['stand-in-chrome']);
  let killedAt = null;
  const src = [
    cut('function browserAlive(', '// run/browser (0700)'),
    cut('async function browserRelaunch(', '// Sign out of everything'),
    cut('async function browserCloseRestart(', '// The pages a done reopens'),
  ].join('\n');
  const env = { DEVTEAM_TEST_BROWSER_CLOSE_DELAY_MS: String(hold) };
  const ctx = { chrome: { pid: chrome }, cdp: { send: () => new Promise(() => {}), close() {} }, viewer: null, stopping: false };
  const sandbox = vm.createContext({
    fs, path, spawnSync, process, Promise, setTimeout, Date, Math, Number,
    BROWSER_BACK: '', browserTestEnv: (k) => env[k],
    browserOwnerDialogsEnd() {}, browserViewClose() {}, browserNotePages: () => [], browserReopen: async () => [], browserRecordCloses() {},
    browserShutdown: (c) => { c.stopping = true; },
    browserCookieJar: async () => [],
    browserKillProfile: async (c, cdp, pid) => { killedAt = Date.now(); killMine(pid); c.stopping = true; },
  });
  const closeRestart = vm.runInContext(`${src}\n;browserCloseRestart`, sandbox);
  const t0 = Date.now();
  await closeRestart(ctx, [{ qid: 'q-1', outcome: 'done', closeAt: new Date(t0 - doneAgo).toISOString() }]);
  killMine(chrome);
  assert.ok(killedAt, 'the close killed the stand-in Chrome');
  return killedAt - t0;
}

test('DL1 a close that starts 2 s after Done gives Chrome no further grace', { skip: skipVm }, async () => {
  const ms = await closeTimed({ doneAgo: 2000 });
  assert.ok(ms < 500, `DL1: Chrome killed ${ms} ms after the close started, Done 2 s before it: the deadline was counted from the close's start`);
});

test('DL2 a close held 1.5 s past Done (KD7\'s hold) kills Chrome right after the hold, with no second grace', { skip: skipVm }, async () => {
  const ms = await closeTimed({ doneAgo: 0, hold: 1500 });
  assert.ok(ms >= 1500 && ms < 2000, `DL2: Chrome killed ${ms} ms after the close started, held 1.5 s: the deadline was fixed after the hold`);
});

test('DL3 a close at Done still gives Chrome its 1 s', { skip: skipVm }, async () => {
  const ms = await closeTimed({ doneAgo: 0 });
  assert.ok(ms >= 900 && ms < 1500, `DL3: Chrome killed ${ms} ms after a close at Done`);
});

// ----- kit-923 final-1 M1: a start refused with no free view port left takes its last try's preview
// record with it. browserRetryPort runs under node:vm with every port of a two-port range taken.

test('RT1 a start refused for no free view port removes its preview record before it exits', { skip: skipVm }, async () => {
  const removed = [];
  const sandbox = vm.createContext({
    crypto: await import('node:crypto'), PREVIEW_PICK: [4400, 4401], readPreviews: () => [], browserTestEnv: () => undefined,
    previewPortOk: () => true, portFree: async () => false, removePreview: (n) => removed.push(n), die: (m) => { throw new Error(m); },
  });
  const retryPort = vm.runInContext(`${cut('async function browserRetryPort(', '// A live daemon, or one started')}\n;browserRetryPort`, sandbox);
  await assert.rejects(retryPort('browser-1', new Set([4402])), /no free view port left in 4400-4401 to retry on: this start lost 4402/);
  assert.deepEqual(removed, ['browser-1'], 'RT1: the refused start left its preview record');
});
