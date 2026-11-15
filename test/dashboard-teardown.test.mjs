// What a Chrome-driven dashboard test leaves behind when it fails: nothing. Each case runs a child test
// file of its own (written to a temp folder, importing the kit's test helpers by path) that starts
// what a dashboard test starts and then fails, and checks by pid, once the child has exited, that
// every process it started is gone and the file ended on its own (no cancelled tests, no hang).
// Ports: the children claim blocks of their own (lib/ports.mjs); this file binds none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canDrive, cleanup } from './lib/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = (f) => JSON.stringify(pathToFileURL(path.join(here, 'lib', f)).href);
const needsChrome = canDrive ? false : 'needs Chrome and a Node with WebSocket';

// A group or a process is gone once kill 0 finds nothing (ESRCH); its last members can take a moment
// to be reaped, so it is asked again until it is, for up to 5 s.
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
async function gone(pid, what) {
  for (let i = 0; i < 100 && alive(pid); i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(alive(pid), false, `${what} (${pid}) is still running`);
}

// Runs a child test file in a process group of its own, and returns its TAP, its exit status and the
// pids it printed (`PIDS {…}` lines, which TAP carries as comments). A child past 120 s has its group killed. Whatever it said it
// started is killed by the case's teardown too, after the checks, so a regression leaves nothing.
async function child(t, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-teardown-'));
  const later = cleanup(t);
  later(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const file = path.join(dir, 'child.test.mjs');
  fs.writeFileSync(file, body);
  const env = { ...process.env, HOME: dir };
  // a test file of its own, not a part of this one's run (node marks its test files' environment)
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') || k.startsWith('TMUX') || k === 'NODE_TEST_CONTEXT') delete env[k];
  const c = spawn(process.execPath, ['--test', '--test-reporter=tap', file], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const kill = (pid) => { try { process.kill(pid, 'SIGKILL'); } catch {} };
  let stdout = '', stderr = '', timedOut = false;
  c.stdout.on('data', (b) => { stdout += b; });
  c.stderr.on('data', (b) => { stderr += b; });
  const pidsOf = () => Object.assign({}, ...[...stdout.matchAll(/PIDS (\{.*\})$/gm)].map((m) => JSON.parse(m[1])));
  later(() => { kill(-c.pid); const p = pidsOf(); for (const k of ['dash', 'chrome']) if (p[k] > 0) kill(-p[k]); if (p.kid > 0) kill(p.kid); });
  const t0 = Date.now();
  const status = await new Promise((resolve) => {
    const timer = setTimeout(() => { timedOut = true; kill(-c.pid); }, 120000);
    c.on('close', (code) => { clearTimeout(timer); resolve(code); });
  });
  const count = (k) => Number((stdout.match(new RegExp(`^# ${k} (\\d+)$`, 'm')) || [])[1]);
  return { status, timedOut, secs: (Date.now() - t0) / 1000, stdout, pids: pidsOf(), pass: count('pass'), fail: count('fail'), cancelled: count('cancelled'), out: `${stdout}\n${stderr}`.slice(-3000) };
}

const HEAD = `import { test } from 'node:test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { openChrome, cleanup } from ${lib('chrome.mjs')};
const say = (o) => console.log('PIDS ' + JSON.stringify(o));
`;

test('cleanup(t): every step runs, last registered first, each on its own; the first error is thrown after', async () => {
  const ran = [];
  const hooks = [];
  const fake = { after: (f) => hooks.push(f) };
  const later = cleanup(fake);
  later(() => ran.push('removal'));
  later(() => { ran.push('server'); throw new Error('server would not stop'); });
  later(async () => { await null; ran.push('chrome'); });
  assert.equal(hooks.length, 1, 'one after hook for all of them');
  await assert.rejects(hooks[0](), /server would not stop/);
  assert.deepEqual(ran, ['chrome', 'server', 'removal']);
});

test('a test that throws mid-page leaves no Chrome: its group is gone once the file exits', { skip: needsChrome, timeout: 180000 }, async (t) => {
  const r = await child(t, `${HEAD}
test('throws mid-page', async (t) => {
  const later = cleanup(t);
  const chrome = await openChrome();
  later(() => chrome.close());
  say({ chrome: chrome.pid });
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.navigate', { url: 'data:text/html,<p id=x>here</p>' });
  throw new Error('thrown mid-page');
});
`);
  assert.equal(r.timedOut, false, `the file ended by itself: ${r.out}`);
  assert.ok(r.pids.chrome > 0, `the child said Chrome's pid: ${r.out}`);
  assert.deepEqual([r.status, r.pass, r.fail, r.cancelled], [1, 0, 1, 0], r.out);
  await gone(-r.pids.chrome, "Chrome's process group");
});

test('a Chrome slow to stop (stopped before the throw) is still gone, and the file goes on to its next test', { skip: needsChrome, timeout: 180000 }, async (t) => {
  // SIGSTOP holds off SIGTERM as a loaded runner's Chrome does past close()'s 3 s: the wait for its
  // exit must hold the child's event loop, or node cancels the rest of the file
  const r = await child(t, `${HEAD}
test('throws with Chrome stopped', async (t) => {
  const later = cleanup(t);
  const chrome = await openChrome();
  later(() => chrome.close());
  say({ chrome: chrome.pid });
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.navigate', { url: 'data:text/html,<p id=x>here</p>' });
  process.kill(chrome.pid, 'SIGSTOP');
  throw new Error('thrown with Chrome stopped');
});
test('the next test', () => {});
`);
  assert.equal(r.timedOut, false, `the file ended by itself: ${r.out}`);
  assert.deepEqual([r.status, r.pass, r.fail, r.cancelled], [1, 1, 1, 0], r.out);
  await gone(-r.pids.chrome, "Chrome's process group");
});

test('a Chrome whose exit is never reported: close() ends at its bound, and the file goes on', { skip: needsChrome, timeout: 180000 }, async (t) => {
  // stopped, and its exit kept from close(): only the 5 s bound after the SIGKILL can end the wait,
  // and the process must not hold the file's event loop after that
  const r = await child(t, `${HEAD}
test('close() with no exit to hear', async () => {
  const chrome = await openChrome();
  say({ chrome: chrome.pid });
  process.kill(chrome.pid, 'SIGSTOP');
  const t0 = Date.now();
  // close() listens for the exit as it starts; taken away at once, the exit never reaches it
  const closing = chrome.close();
  chrome.proc.removeAllListeners('exit');
  await closing;
  say({ closedMs: Date.now() - t0 });
});
test('the next test', () => {});
`);
  assert.equal(r.timedOut, false, `the file ended by itself: ${r.out}`);
  assert.deepEqual([r.status, r.pass, r.fail, r.cancelled], [0, 2, 0, 0], r.out);
  assert.ok(r.pids.closedMs >= 6000 && r.pids.closedMs < 10000, `close() took ${r.pids.closedMs} ms: its bound (about 8 s), not an exit (about 3 s), ended it`);
  assert.ok(r.secs < 60, `the file took ${r.secs} s`);
  await gone(-r.pids.chrome, "Chrome's process group");
});

test('a removal that throws first skips no stop: the dashboard, Chrome, a child and a server are gone (by pid)', { skip: needsChrome, timeout: 240000 }, async (t) => {
  const r = await child(t, `${HEAD}import { bareProject, dashboardOnFreePort } from ${lib('kit.mjs')};
test('a removal registered first throws', async (t) => {
  const later = cleanup(t);
  const base = fs.mkdtempSync(path.join(process.cwd(), 'work-'));
  // registered first, so it runs last; made to throw as a removal under a live dashboard does
  later(() => { fs.rmSync(base, { recursive: true, force: true }); say({ removal: 'threw' }); throw Object.assign(new Error("ENOTEMPTY: directory not empty, rmdir '" + base + "' (made to throw)"), { code: 'ENOTEMPTY' }); });
  const root = bareProject(base, 'teardown');
  const { dash } = await dashboardOnFreePort(root, process.env);
  later(() => dash.stop());
  const kid = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  later(() => kid.kill('SIGKILL'));
  const srv = http.createServer(() => {});
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  later(() => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); }));
  // and a stop in the middle that throws: the ones on either side of it still run
  later(() => { throw new Error('a stop that throws'); });
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.navigate', { url: 'data:text/html,<p id=x>here</p>' });
  say({ dash: dash.p.pid, kid: kid.pid, chrome: chrome.pid });
});
`);
  assert.equal(r.timedOut, false, `the file ended by itself, not at the 120 s limit: ${r.out}`);
  assert.deepEqual([r.status, r.pass, r.fail, r.cancelled], [1, 0, 1, 0], r.out);
  assert.match(r.stdout, /a stop that throws/, 'the first error, thrown once every step had run');
  assert.equal(r.pids.removal, 'threw', 'the removal ran, last, and threw');
  for (const k of ['dash', 'kid', 'chrome']) assert.ok(r.pids[k] > 0, `the child said ${k}'s pid: ${r.out}`);
  await gone(-r.pids.dash, "the dashboard's process group");
  await gone(r.pids.kid, 'the child process');
  await gone(-r.pids.chrome, "Chrome's process group");
});
