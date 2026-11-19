// devteam.mjs browser (kit-316 F3): the restart-heavy checks split from test/browser.test.mjs so each
// browser test file stays well inside CI's 300 s per-file watchdog: the credential chain on project p
// (C1 to D5, which stop and start the browser) and K1's run.env round trip. The CLI runs async, never
// through a blocking call: the fixture site lives in this process and must keep answering Chrome.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { monoFixture, until, sessionOf } from './lib/kit.mjs';
import { startSites } from './lib/sites.mjs';
import { canDrive, chromePath } from './lib/chrome.mjs';
import { validate } from './fixtures/browser/check.mjs';

// CI's Node 22 and 24 jobs have Chrome: there the file must run, never skip.
const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;
const skip = canDrive ? false : 'needs Chrome and Node 22+';
const opts = { skip, timeout: 120000 };
if (mustRun && !canDrive) test('Chrome is needed on CI\'s Node 22+', () => assert.fail('Chrome is needed on CI\'s Node 22+: this file must run there, not skip'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-browser-pr-'));
const homes = [];
const newHome = () => { const h = fs.mkdtempSync(path.join(tmp, 'home-')); homes.push(h); return h; };

// Every verb's stdout and stderr, for J2.
const seen = [];
let site;
const projects = [];

// A fixture project whose CLI runs as the supervisor with a throwaway HOME (monoFixture sets none).
// There is no own server here, so the allow-list is the fixture site's port alone.
function project(name, home) {
  const F = monoFixture(name);
  const env = { ...F.env({ DEVTEAM_ROLE: 'supervisor' }), HOME: home, DEVTEAM_TEST: '1', DEVTEAM_TEST_BROWSER_ALLOW: String(site.port) };
  const P = { ...F, name, home, env, key: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${crypto.createHash('sha1').update(fs.realpathSync(F.old)).digest('hex').slice(0, 12)}` };
  P.profile = path.join(home, '.devteam', 'browser', P.key);
  P.state = path.join(F.old, 'docs', 'devteam', 'run', 'browser', 'state.json');
  projects.push(P);
  return P;
}

// browser <args> on project P: { status, out, err }. cwd defaults to the project's checkout.
function cli(P, args, extraEnv = {}, cwd = P.old) {
  return new Promise((resolve, reject) => {
    const env = { ...P.env, ...extraEnv };
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
    const child = spawn(process.execPath, [path.join(P.old, 'docs/devteam/scripts/devteam.mjs'), 'browser', ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 90000);
    child.on('error', reject);
    child.on('close', (status) => { clearTimeout(timer); seen.push(out, err); resolve({ status, out: out.trim(), err: err.trim() }); });
  });
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

let p; // C1 to D5: the credential chain
let k; // K1 only: its tmux session is the test's own, made before anything runs on it
let q; // the restart checks (G1b, R1, L1, L2, I4): each opens with stopped(q) and ends with q stopped
// after waits for it: with every test filtered out (--test-name-pattern), node runs after while
// before is still starting the site, which would then keep the process alive.
let setup = Promise.resolve();
before(() => {
  if (skip) return;
  setup = (async () => {
    site = await startSites();
    p = project('brw-p', newHome());
    k = project('brw-k', newHome());
    q = project('brw-q', newHome());
  })();
  return setup;
});

// Groups the test made (G1b's leftover Chrome); each test kills its own, and this catches the rest. Only
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
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Alive as the spec means it: kill(pid, 0) works and the process isn't a zombie.
function alive(pid) {
  try { process.kill(pid, 0); } catch (err) { if (err.code !== 'EPERM') return false; }
  try { const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return st.slice(st.lastIndexOf(')') + 2)[0] !== 'Z'; } catch { return false; }
}
const sessionName = (P) => sessionOf(P.old, P.name);
// Every control secret a test reads, for J2.
const secrets = new Set();
const readState = (P) => { const s = JSON.parse(fs.readFileSync(P.state, 'utf8')); if (s.control_secret) secrets.add(s.control_secret); return s; };
const previewRec = (P, name) => JSON.parse(fs.readFileSync(path.join(P.old, 'docs', 'devteam', 'run', 'previews', `${name}.json`), 'utf8'));
const cmdline = (pid) => fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
// Starts run one at a time across the file, so two projects' daemons never start together and pick
// the same free view port before either binds it. ms is the start's own.
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

// A failure names the field, never the value.
const valid = (shape, v) => { const errs = validate(shape, v); assert.equal(errs.length, 0, `${shape} fails the contract at ${errs.map((x) => x.split(' ')[0]).join(', ')}`); };
const lines = (s) => s.split('\n');
async function ok(P, args) {
  const r = await cli(P, args);
  assert.equal(r.status, 0, `${args[0]} exited ${r.status}`);
  return r;
}
const snap = async (P) => (await ok(P, ['snapshot'])).out;
// The ref of a plain snapshot's `e<n> <role> "<name>"` line. A failure names what was looked for,
// never the snapshot.
function refOf(text, role, name) {
  const m = lines(text).map((l) => /^(e\d+) (\S+) (".*?")(?: |$)/.exec(l)).find((x) => x && x[2] === role && JSON.parse(x[3]) === name);
  assert.ok(m, `no ${role} ${JSON.stringify(name)} in the snapshot`);
  return m[1];
}
const has = (text, line) => lines(text).includes(line);

// ----- restarts on q (kit-316): each opens with stopped(q) and ends with q stopped -----

// A pid that is certainly dead: a process that ran and was reaped.
const deadPid = () => spawnSync('true').pid;
// A schema-valid state.json of a dead daemon, naming chrome_pid, in the pipe form (no cdp_port).
function plantState(P, chromePid) {
  const s = { browser: 1, daemon_pid: deadPid(), chrome_pid: chromePid, control_port: 1, control_secret: '0'.repeat(64), guard_port: 1, view_port: 1, preview: 'gone-preview' };
  assert.deepEqual(validate('state', s), []);
  fs.mkdirSync(path.dirname(P.state), { recursive: true });
  fs.writeFileSync(P.state, JSON.stringify(s));
}
const carries = (pid, P) => { try { return cmdline(pid).includes(`--user-data-dir=${P.profile}`); } catch { return false; } };
const killGroup = async (G) => { try { process.kill(-G, 'SIGKILL'); } catch {} ownGroups.delete(G); await until(() => !alive(G), 'the group gone'); };

test('G1b a leftover Chrome is killed by the next start', opts, async () => {
  await stopped(q);
  fs.rmSync(q.state, { force: true });
  // the test's own Chrome on q's profile, kept off the network
  const c = spawn(chromePath, ['--headless=new', `--user-data-dir=${q.profile}`, '--proxy-server=127.0.0.1:9', '--disable-background-networking', '--no-first-run', '--no-sandbox', 'about:blank'], { detached: true, stdio: 'ignore' });
  ownGroups.add(c.pid);
  try {
    await until(() => carries(c.pid, q), 'the leftover Chrome up');
    // only the planted chrome_pid can find it: no SingletonLock names it (T3-3). Chrome writes its lock
    // a moment after it starts, so wait for it first, or the removal races the write.
    const lock = path.join(q.profile, 'SingletonLock');
    await until(() => { try { return fs.readlinkSync(lock) === `${os.hostname()}-${c.pid}`; } catch { return false; } }, 'the leftover holds its SingletonLock');
    fs.rmSync(lock, { force: true });
    plantState(q, c.pid);
    await started(q);
    assert.equal(alive(c.pid), false, 'the leftover Chrome is gone');
    assert.equal((await statusJson(q)).restarted, true);
    await stopped(q);
  } finally { await killGroup(c.pid); }
});

// The supervisor's ruling (m-20261119-112945313): an older devteam.mjs reads a new state.json as one
// missing a field it requires. A state.json without control_port stands in for that here.
test('R1 a state.json the reader can\'t use restarts, never crashes', opts, async () => {
  await stopped(q);
  await started(q);
  const s1 = readState(q);
  // the old form, with cdp_port, reaches the same daemon: status sees it running, and a verb that
  // needs the daemon starts none (T3-1)
  fs.writeFileSync(q.state, JSON.stringify({ ...s1, cdp_port: 1 }));
  assert.equal((await statusJson(q)).running, true, 'status reads the old form as running');
  await ok(q, ['open', `${site.origin}/`]);
  assert.equal(readState(q).daemon_pid, s1.daemon_pid, 'the old form is accepted with no restart');
  // a state.json the reader can't use: a fresh daemon, no crash
  const unusable = { ...s1 };
  delete unusable.control_port;
  fs.writeFileSync(q.state, JSON.stringify(unusable));
  const r = await cli(q, ['open', `${site.origin}/`]);
  assert.equal(r.status, 0, `open exited ${r.status}`);
  assert.ok(!(r.out + r.err).includes('    at '), 'no stack line');
  assert.ok(!(r.out + r.err).includes('TypeError'), 'no TypeError');
  const s2 = readState(q);
  assert.notEqual(s2.daemon_pid, s1.daemon_pid, 'a fresh daemon');
  assert.deepEqual(validate('state', s2), []);
  assert.equal('cdp_port' in s2, false, 'no cdp_port');
  await until(() => !alive(s1.daemon_pid) && !alive(s1.chrome_pid), 'the old daemon and its Chrome gone');
  assert.equal((await statusJson(q)).tabs, 1);
  // a cdp_port that is present must be a port: 0 is unusable, so a fresh daemon, no crash (T3-2)
  fs.writeFileSync(q.state, JSON.stringify({ ...s2, cdp_port: 0 }));
  const z = await cli(q, ['open', `${site.origin}/`]);
  assert.equal(z.status, 0, `open exited ${z.status}`);
  assert.ok(!(z.out + z.err).includes('    at '), 'no stack line');
  assert.ok(!(z.out + z.err).includes('TypeError'), 'no TypeError');
  const s3 = readState(q);
  assert.notEqual(s3.daemon_pid, s2.daemon_pid, 'cdp_port 0: a fresh daemon');
  assert.deepEqual(validate('state', s3), []);
  await until(() => !alive(s2.daemon_pid) && !alive(s2.chrome_pid), 'the cdp_port 0 daemon and its Chrome gone');
  assert.equal((await statusJson(q)).tabs, 1);
  await stopped(q);
});

// The start lock, as browserStartLock makes it: run/browser/start.lock/owner holding a token.
const startLock = (P) => path.join(path.dirname(P.state), 'start.lock');
function plantStartLock(P, token) {
  fs.mkdirSync(startLock(P), { recursive: true });
  fs.writeFileSync(path.join(startLock(P), 'owner'), token);
}
// SingletonLock as Chrome makes it: a symlink to <host>-<pid>.
function plantLock(P, target) {
  const f = path.join(P.profile, 'SingletonLock');
  fs.mkdirSync(P.profile, { recursive: true });
  fs.rmSync(f, { force: true });
  fs.symlinkSync(target, f);
}

test('L1 a dead owner\'s start lock is taken at once', opts, async () => {
  await stopped(q);
  plantStartLock(q, `${deadPid()}-0123456789abcdef`);
  try {
    const r = await startCli(q);
    assert.equal(r.status, 0, `start: ${r.err || r.out}`);
    assert.ok(r.ms < 30000, `start took ${r.ms} ms`);
    assert.equal(fs.existsSync(startLock(q)), false, 'the start lock is gone');
  } finally { fs.rmSync(startLock(q), { recursive: true, force: true }); }
  await stopped(q);
});

test('L2 a live owner\'s lock, or a garbage token, is not taken', opts, async () => {
  await stopped(q);
  const sleep = spawn('sleep', ['600'], { detached: true, stdio: 'ignore' });
  try {
    // a live owner, a garbage token, and pid 0 (not a positive integer, so not a dead owner: T5-1)
    for (const token of [`${sleep.pid}-0123456789abcdef`, 'abc', '0-0123456789abcdef']) {
      plantStartLock(q, token);
      const r = await startCli(q, { DEVTEAM_TEST_BROWSER_LOCK_WAIT_MS: '2000' });
      assert.equal(r.status, 1, `start with owner ${token} exited ${r.status}`);
      assert.match(r.err, /timed out waiting/);
      assert.equal(fs.readFileSync(path.join(startLock(q), 'owner'), 'utf8'), token, 'the planted token is still in place');
      fs.rmSync(startLock(q), { recursive: true, force: true });
    }
  } finally {
    try { sleep.kill('SIGKILL'); } catch {}
    fs.rmSync(startLock(q), { recursive: true, force: true });
  }
  await stopped(q);
});

// The start locks and their asides under run/browser, made writable and removed.
function clearStartLocks(P) {
  const dir = path.dirname(P.state);
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n === 'start.lock' || n.startsWith('start.lock.')); } catch {}
  for (const n of names) {
    try { fs.chmodSync(path.join(dir, n), 0o700); } catch {}
    fs.rmSync(path.join(dir, n), { recursive: true, force: true });
  }
}

test('L3 a dead owner\'s lock that can\'t be taken still times out; one that can\'t be removed is no crash', opts, async () => {
  await stopped(q);
  const token = `${deadPid()}-0123456789abcdef`;
  try {
    // the take fails (the hook refuses the rename): the wait still ends, never spins (T5-2)
    plantStartLock(q, token);
    const r = await startCli(q, { DEVTEAM_TEST_BROWSER_LOCK_WAIT_MS: '2000', DEVTEAM_TEST_BROWSER_LOCK_TAKE_FAIL: '1' });
    assert.equal(r.status, 1, `start exited ${r.status}`);
    assert.match(r.err, /timed out waiting/);
    assert.ok(r.ms < 20000, `the refusal took ${r.ms} ms`);
    assert.equal(fs.readFileSync(path.join(startLock(q), 'owner'), 'utf8'), token, 'the planted token is still in place');
    clearStartLocks(q);
    // a read-only lock folder: the rename takes it off its path, the removal fails, and the start goes
    // on rather than throwing (as root the removal works, and this half proves only the start)
    plantStartLock(q, token);
    fs.chmodSync(startLock(q), 0o555);
    const s = await startCli(q);
    assert.equal(s.status, 0, `start: ${s.err || s.out}`);
  } finally { clearStartLocks(q); }
  await stopped(q);
});

// Both refusals that name a foreign lock's host print it cleaned and cut (T5-4): one with a same-uid
// process holding the profile, one where the processes can't be listed (the hook).
test('I5 a refused start names the lock\'s host cleaned and cut', opts, async () => {
  await stopped(q);
  fs.rmSync(q.state, { force: true });
  const words = `evil?host${'h'.repeat(91)}…`;
  const holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', `--user-data-dir=${q.profile}`], { stdio: 'ignore' });
  try {
    await until(() => carries(holder.pid, q), 'the holder');
    plantLock(q, `evil\nhost${'h'.repeat(400)}-1234`);
    const held = await startCli(q);
    assert.equal(held.status, 1, held.out);
    assert.ok(held.err.includes(`locked by host ${words} and a process here (pid ${holder.pid})`), 'the held refusal names the host cleaned and cut');
    assert.ok(!held.err.includes('evil\nhost'), 'no raw newline from the host');
  } finally { holder.kill('SIGKILL'); }
  await new Promise((r) => (holder.exitCode !== null || holder.signalCode !== null ? r() : holder.once('exit', r)));
  try {
    plantLock(q, `evil\nhost${'h'.repeat(400)}-1234`);
    const unlisted = await startCli(q, { DEVTEAM_TEST_BROWSER_PROCS_UNLISTED: '1' });
    assert.equal(unlisted.status, 1, unlisted.out);
    assert.ok(unlisted.err.includes(`locked by host ${words}, and this machine's processes couldn't be listed`), 'the unlisted refusal names the host cleaned and cut');
    assert.ok(!unlisted.err.includes('evil\nhost'), 'no raw newline from the host');
  } finally { fs.rmSync(path.join(q.profile, 'SingletonLock'), { force: true }); }
  await stopped(q);
});

test('I4 a lock\'s host is cleaned and cut in what is printed', opts, async () => {
  await stopped(q);
  fs.rmSync(q.state, { force: true });
  const NOTE = 'Cleared a stale SingletonLock left by host ';
  plantLock(q, `evil\nhost${'h'.repeat(400)}-1234`);
  await started(q);
  const note = (await statusJson(q)).notes.find((n) => n.startsWith(NOTE));
  assert.ok(note, 'the stale-lock note is there');
  assert.ok(note.length <= 300, `the note is ${note.length} characters`);
  assert.doesNotMatch(note, /[\x00-\x1f\x7f]/, 'no control character');
  const cut = `evil?host${'h'.repeat(91)}`;
  assert.equal(cut.length, 100);
  assert.ok(note.includes(`${cut}…`), 'the host is cleaned and cut to 100 characters, then …');
  await stopped(q);
  plantLock(q, `${'a'.repeat(100)}-1234`);
  await started(q);
  const whole = (await statusJson(q)).notes.find((n) => n.startsWith(NOTE));
  assert.ok(whole?.includes(`left by host ${'a'.repeat(100)}.`), 'a 100-character host is printed whole');
  await stopped(q);
});

test('K1 run.env reaches the daemon', opts, async () => {
  const other = newHome();
  const env = { ...k.env, HOME: other };
  delete env.DEVTEAM_TEST;
  delete env.DEVTEAM_TEST_BROWSER_ALLOW;
  env.DEVTEAM_CLAIM_TOKEN = 'zq-claim'; // T2-4: in the tmux server's own environment, so every window inherits it
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
  // T2-4: the daemon keeps only the allow-list, so neither it nor Chrome holds the token. Names only:
  // the environment's values are never printed.
  const names = (pid) => fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean).map((x) => x.slice(0, x.indexOf('=')));
  for (const [who, pid] of [['the daemon', s.daemon_pid], ['Chrome', s.chrome_pid]]) {
    const n = names(pid);
    assert.ok(n.includes('DEVTEAM_TEST_BROWSER_ALLOW'), `${who} has the allow-list's names`);
    assert.ok(!n.includes('DEVTEAM_CLAIM_TOKEN'), `${who} holds no DEVTEAM_CLAIM_TOKEN`);
  }
  // K1's second half: the guard lets the fixture port through, which the daemon knows only from run.env
  const o = await cli(k, ['open', `${site.origin}/`]);
  assert.equal(o.status, 0, o.err || o.out);
});

// Signs in on the fixture site: /login (username, password, remember if asked, Enter), then the code
// on /2fa and Enter. C1's checks run on the way when asked.
async function signIn(P, { remember = false, c1 = false } = {}) {
  await ok(P, ['open', `${site.origin}/login`]);
  let s = await snap(P);
  const pw = refOf(s, 'textbox', 'Password'), user = refOf(s, 'textbox', 'Username');
  await ok(P, ['type', pw, site.password]);
  if (c1) {
    assert.ok(has(await snap(P), `${pw} textbox "Password" = "•••"`), 'the password field reads •••');
    const j = JSON.parse((await ok(P, ['snapshot', '--json'])).out);
    assert.equal(j.nodes.find((n) => n.ref === pw)?.value, '•••');
  }
  if (remember) await ok(P, ['click', refOf(s, 'checkbox', 'Remember me')]);
  await ok(P, ['type', user, site.username]);
  await ok(P, ['press', 'Enter']);
  s = await snap(P);
  assert.ok(has(s, 'heading "Enter your code" (level 1)'), 'on the 2FA page');
  const code = refOf(s, 'textbox', 'Code');
  await ok(P, ['type', code, site.code]);
  if (c1) assert.ok(lines(await snap(P)).some((l) => l.startsWith(`${code} textbox "Code"`) && l.endsWith('= "•••"')), 'the code field reads •••');
  await ok(P, ['press', 'Enter']);
  assert.ok(has(await snap(P), 'heading "Signed in as owner" (level 1)'), 'signed in');
}
const signedIn = async (P) => { await ok(P, ['open', `${site.origin}/account`]); return has(await snap(P), 'heading "Signed in as owner" (level 1)'); };
const notSignedIn = async (P) => { await ok(P, ['open', `${site.origin}/account`]); return has(await snap(P), 'heading "Not signed in" (level 1)'); };

test('C1 credential values are masked', opts, async () => {
  await started(p);
  const from = seen.length;
  await signIn(p, { c1: true });
  for (const [what, v] of [['password', site.password], ['code', site.code]]) assert.ok(!seen.slice(from).some((x) => x.includes(v)), `no output holds the ${what}`);
});

test('D2 cookies survive stop and start; A5 a fresh tab', opts, async () => {
  // signed in by C1, without remember me: a session cookie
  for (const remember of [false, true]) {
    if (remember) await signIn(p, { remember });
    await stopped(p);
    await started(p);
    const st = await statusJson(p);
    assert.equal(st.tabs, 1);
    assert.equal(st.url, 'about:blank');
    if (!remember) {
      const back = await cli(p, ['back']);
      assert.equal(back.status, 1);
      assert.match(back.err, /nothing to go back to/);
    }
    assert.ok(await signedIn(p), `signed in after stop and start (remember ${remember})`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(p.profile, 'Default', 'Preferences'), 'utf8')).session.restore_on_startup, 1);
  }
});

// D3's sign-in half: project p is signed in (C1, D2)
test('D3 another project, another profile', opts, async () => {
  const b = project('brw-b', p.home);
  await started(b);
  const o = await cli(b, ['open', `${site.origin}/account`]);
  assert.equal(o.status, 0, o.err || o.out);
  const s = await ok(b, ['snapshot']);
  assert.ok(lines(s.out).includes('heading "Not signed in" (level 1)'), s.out);
  assert.notEqual(b.key, p.key);
  assert.equal((await statusJson(b)).instance, b.key);
  assert.ok(fs.existsSync(path.join(b.profile, 'root.json')));
  await stopped(b);
});

test('F5 nothing kept in Login Data or Web Data', opts, async (t) => {
  // signed in by D2; a stop lets Chrome write its databases
  await stopped(p);
  const d = path.join(p.profile, 'Default');
  const three = [site.username, site.password, site.code];
  let sqlite = null;
  try { sqlite = await import('node:sqlite'); } catch {}
  for (const name of ['Login Data', 'Web Data']) {
    const f = path.join(d, name);
    if (!fs.existsSync(f)) { t.diagnostic(`Default/${name} doesn't exist: it counts as holding nothing`); continue; }
    let db = null;
    try { db = sqlite && new sqlite.DatabaseSync(f, { readOnly: true }); } catch { db = null; }
    if (db) {
      try {
        if (name === 'Login Data') assert.equal(db.prepare('SELECT count(*) AS n FROM logins').get().n, 0, 'Login Data keeps no login');
        else assert.equal(db.prepare('SELECT value FROM autofill').all().filter((r) => three.includes(String(r.value))).length, 0, 'Web Data keeps none of the three in autofill');
      } finally { db.close(); }
      continue;
    }
    t.diagnostic(`Default/${name}: read as bytes (no node:sqlite, or it wouldn't open)`);
    for (const g of [f, `${f}-journal`, `${f}-wal`].filter((x) => fs.existsSync(x))) {
      const b = fs.readFileSync(g);
      three.forEach((v, i) => assert.equal(b.includes(Buffer.from(v)), false, `${path.basename(g)} holds value ${i} of three`));
    }
  }
  await started(p);
});

test('J1 forget signs out', opts, async () => {
  assert.ok(await signedIn(p), 'signed in (remember me) before forget');
  const r = await ok(p, ['forget']);
  assert.match(r.out, /forgot profile .*: every site in it is signed out/);
  assert.equal(fs.existsSync(p.profile), false, 'the profile folder is gone');
  await started(p);
  assert.ok(await notSignedIn(p), 'not signed in after forget');
});

test('D5 profiles lists both and marks a gone root (a real start)', opts, async () => {
  const d = project('brw-d', p.home);
  await started(d);
  await stopped(d);
  fs.rmSync(d.old, { recursive: true, force: true });
  const r = await ok(p, ['profiles']);
  const list = JSON.parse(r.out);
  valid('profiles', list);
  const by = Object.fromEntries(list.profiles.map((x) => [x.key, x]));
  assert.ok(by[p.key] && by[d.key], Object.keys(by).join(' '));
  assert.deepEqual(by[p.key], { key: p.key, root: fs.realpathSync(p.old), root_gone: false, current: true });
  assert.equal(by[d.key].root_gone, true);
  assert.equal(by[d.key].current, false);
  assert.deepEqual(list.profiles.filter((x) => x.root_gone).map((x) => x.key), [d.key]);
});

// Last in the file: everything every verb printed.
test('J2 nothing secret printed (profiles)', opts, async () => {
  const all = seen.join('\n');
  assert.ok(site.sessions().length >= 2, 'sessions were issued');
  site.sessions().forEach((v, i) => assert.ok(!all.includes(v), `session ${i} printed`));
  assert.ok(secrets.size >= 2, 'control secrets were read');
  [...secrets].forEach((v, i) => assert.ok(!all.includes(v), `control secret ${i} printed`));
  for (const [what, v] of [['password', site.password], ['code', site.code]]) assert.ok(!all.includes(v), `the ${what} printed`);
});
