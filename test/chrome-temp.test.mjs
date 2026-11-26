// kit-980: a test Chrome's temp folders stay inside its own profile folder, and go with it however it
// ends: closed, killed on its own, or left behind by a test process killed outright (a timeout's SIGKILL
// or SIGTERM). Each case runs Chrome under a temp folder of its own (the "outer" one) and reads what is
// left there.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canDrive, cleanup } from './lib/chrome.mjs';

const lib = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib', 'chrome.mjs')).href;
// Chrome's own temp folders: Chromium's org.chromium.Chromium.*, Google Chrome's com.google.Chrome.*
const OWN = /^(org\.chromium\.|com\.google\.Chrome\.)/;
// what a Chrome leaves in a temp folder: its own temp folders, a test profile, kit-777's dc folder
const LEFT = new RegExp(`${OWN.source}|^devteam-chrome-|^dc[A-Za-z0-9]{6}$`);
const left = (outer) => fs.readdirSync(outer).filter((n) => LEFT.test(n));
const alive = (pgid) => { try { process.kill(-pgid, 0); return true; } catch { return false; } };
const until = async (ok, ms) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 100)); return ok(); };

// A temp folder of the case's own (its name short: Chrome's socket path is capped), removed after the
// case, with any Chrome a failed case left in it killed first.
const outerFor = (t, pgids) => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-'));
  const later = cleanup(t);
  later(() => fs.rmSync(outer, { recursive: true, force: true }));
  later(() => { for (const g of pgids) try { process.kill(-g, 'SIGKILL'); } catch {} });
  return outer;
};

// A node process that opens a Chrome and a page, with TMPDIR the outer folder, says Chrome's pid and waits.
const holder = (outer) => new Promise((ok, no) => {
  const code = `import { openChrome } from ${JSON.stringify(lib)}; const c = await openChrome(); await (await c.newPage()).ev('1'); console.log(JSON.stringify({ pid: c.pid, tmp: c.tmp })); setInterval(() => {}, 1000);`;
  const env = { ...process.env, TMPDIR: outer, HOME: path.join(outer, 'home') };
  fs.mkdirSync(env.HOME);
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  const cut = setTimeout(() => { child.kill('SIGKILL'); no(new Error(`no Chrome in 60 s: ${err.slice(0, 400)}`)); }, 60000);
  child.stderr.on('data', (b) => { err += b; });
  child.stdout.on('data', (b) => { out += b; const line = out.split('\n').find((l) => l.startsWith('{')); if (line) { clearTimeout(cut); ok({ child, ...JSON.parse(line) }); } });
  child.on('exit', (c, s) => { clearTimeout(cut); no(new Error(`the holder exited (${c ?? s}): ${err.split('\n').find((l) => l.startsWith('Error: ')) ?? err.slice(0, 400)}`)); });
});

test("C1: Chrome's own temp folders are inside its profile, none in the outer temp folder", { skip: canDrive ? false : 'no Chrome or no WebSocket here', timeout: 120000 }, async (t) => {
  const pgids = [];
  const outer = outerFor(t, pgids);
  const h = await holder(outer);
  pgids.push(h.pid);
  t.after(() => h.child.kill('SIGKILL'));
  const profiles = left(outer).filter((n) => n.startsWith('devteam-chrome-'));
  assert.equal(profiles.length, 1, `one profile in the outer folder: ${fs.readdirSync(outer).join(', ')}`);
  const own = path.join(outer, profiles[0], 't');
  assert.ok(await until(() => fs.existsSync(own) && fs.readdirSync(own).some((n) => OWN.test(n)), 10000), "Chrome's temp folder is t/ in its profile");
  assert.deepEqual(left(outer).filter((n) => !n.startsWith('devteam-chrome-')), [], 'nothing of Chrome loose in the outer temp folder');
});

for (const sig of ['SIGKILL', 'SIGTERM']) {
  test(`C2: a test process killed by ${sig} mid-run leaves no Chrome and nothing of it in the temp folder`, { skip: canDrive ? false : 'no Chrome or no WebSocket here', timeout: 120000 }, async (t) => {
    const pgids = [];
    const outer = outerFor(t, pgids);
    const h = await holder(outer);
    pgids.push(h.pid);
    assert.ok(alive(h.pid), 'Chrome running before the kill');
    h.child.kill(sig);
    const gone = await until(() => !alive(h.pid) && left(outer).length === 0, 15000);
    assert.ok(gone, `15 s after ${sig}: Chrome ${alive(h.pid) ? 'still running' : 'gone'}; left in the temp folder: ${left(outer).join(', ') || 'nothing'}`);
  });
}

test('C3: a Chrome that dies without close() takes its folder with it', { skip: canDrive ? false : 'no Chrome or no WebSocket here', timeout: 120000 }, async (t) => {
  const pgids = [];
  const outer = outerFor(t, pgids);
  const h = await holder(outer);
  pgids.push(h.pid);
  t.after(() => h.child.kill('SIGKILL'));
  process.kill(-h.pid, 'SIGKILL');
  const gone = await until(() => left(outer).length === 0, 15000);
  assert.ok(gone, `15 s after Chrome was killed, its test process still running: left ${left(outer).join(', ')}`);
});

test('C4: Chrome starts under a long temp folder (its socket path stays short)', { skip: canDrive ? false : 'no Chrome or no WebSocket here', timeout: 120000 }, async (t) => {
  const pgids = [];
  const short = outerFor(t, pgids);
  // 100 bytes or more: an absolute socket path under it passes the 107-byte cap
  const outer = path.join(short, 'x'.repeat(Math.max(1, 100 - short.length)));
  fs.mkdirSync(outer);
  const h = await holder(outer).catch((e) => assert.fail(e.message));
  pgids.push(h.pid);
  t.after(() => h.child.kill('SIGKILL'));
  assert.ok(outer.length >= 100 && alive(h.pid));
});

test('C8: a test process that never closes its Chrome still ends on its own, leaving nothing', { skip: canDrive ? false : 'no Chrome or no WebSocket here', timeout: 120000 }, async (t) => {
  const pgids = [];
  const outer = outerFor(t, pgids);
  const code = `import { openChrome } from ${JSON.stringify(lib)}; const c = await openChrome(); console.log(JSON.stringify({ pid: c.pid }));`;
  fs.mkdirSync(path.join(outer, 'home'));
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, TMPDIR: outer, HOME: path.join(outer, 'home') }, stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  child.stdout.on('data', (b) => { out += b; const line = out.split('\n').find((l) => l.startsWith('{')); if (line) pgids.push(JSON.parse(line).pid); });
  const ended = await new Promise((ok) => { const cut = setTimeout(() => ok(false), 30000); child.on('exit', () => { clearTimeout(cut); ok(true); }); });
  if (!ended) child.kill('SIGKILL');
  assert.ok(ended, `30 s after its Chrome started, the test process is still running (pid ${pgids[0] ?? 'unknown'})`);
  assert.ok(await until(() => left(outer).length === 0, 15000), `left in the temp folder: ${left(outer).join(', ')}`);
});
