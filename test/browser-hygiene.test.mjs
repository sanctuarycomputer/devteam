// devteam.mjs browser (kit-64): the restart-heavy checks, profile hygiene on every start and stop
// (spec F, G, H and I) and the daemon's own start and stop round trips (E5, K2, Review Focus 5;
// docs/devteam/project/tickets/kit-64-browser-command/spec.md, home), split
// from test/browser.test.mjs so each file stays inside CI's per-file watchdog. The CLI runs async,
// never through a blocking call: the fixture site lives in this process and must keep answering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { canDrive, openChrome } from './lib/chrome.mjs';
import { until, sessionOf } from './lib/kit.mjs';
import { validate } from './fixtures/browser/check.mjs';
import { tmp, site, own, cli, alive, readState, started, statusJson, stopped, h, opened, hygieneFile, noSecretPrinted } from './lib/browser-fixture.mjs';

// CI's Node 22 and 24 jobs have Chrome: there the file must run, never skip.
const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;
const skip = canDrive ? false : 'needs Chrome and Node 22+';
if (mustRun && !canDrive) test('Chrome is needed on CI\'s Node 22+', () => assert.fail('Chrome is needed on CI\'s Node 22+: this file must run there, not skip'));
hygieneFile();

// The distinct colours of a PNG in x 24 to 316 and each y range, read in the test's own Chrome.
async function colours(file, ranges) {
  const ch = await openChrome();
  try {
    const pg = await ch.newPage();
    return await pg.ev(`new Promise((res, rej) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); res(${JSON.stringify(ranges)}.map(([y0, y1]) => { const d = x.getImageData(24, y0, 292, y1 - y0).data; const s = new Set(); for (let k = 0; k < d.length; k += 4) s.add(d[k] + ',' + d[k + 1] + ',' + d[k + 2] + ',' + d[k + 3]); return s.size; })); }; i.onerror = () => rej(new Error('not a PNG')); i.src = 'data:image/png;base64,${fs.readFileSync(file).toString('base64')}'; })`);
  } finally { await ch.close(); }
}


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
  // Chrome's own temp folders go in one short folder of this profile's, never loose in the temp folder
  let chromeTmp = null;
  if (process.platform === 'linux') {
    chromeTmp = tmpdirOf(s.chrome_pid);
    assert.match(path.basename(chromeTmp ?? ''), /^dc[0-9a-f]{6}$/);
    assert.ok(fs.statSync(chromeTmp).isDirectory(), 'the folder is there');
  }
  const sj = await statusJson(h);
  assert.equal(sj.running, true);
  assert.equal(sj.tabs, 1);
  const r = await cli(h, ['stop']);
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out, 'browser stopped');
  assert.deepEqual(await statusJson(h), { browser: 1, instance: h.key, running: false, held: null });
  assert.equal(fs.existsSync(h.state), false);
  await until(() => !alive(s.chrome_pid), 'Chrome gone after stop');
  // kit-777 F2: the daemon removes that folder at stop, so a run leaves no dc… behind
  if (chromeTmp) {
    await until(() => !alive(s.daemon_pid), 'the daemon gone after stop');
    assert.equal(fs.existsSync(chromeTmp), false, "Chrome's temp folder is removed at stop");
  }
  assert.deepEqual(devWindows(h), []);
  assert.equal(fs.existsSync(path.join(h.old, 'docs', 'devteam', 'run', 'previews', `${s.preview}.json`)), false);
  const again = await cli(h, ['stop']);
  assert.equal(again.status, 0, again.err);
  assert.equal(again.out, "browser wasn't running");
});

// kit-777: the daemon runs under env -i, so its temp folder is /tmp whatever this process's is.
const daemonDc = (P) => dcIn('/tmp', P.profile);

test("kit-777 F3: browser start refuses when a folder open to others is at its Chrome folder's name, and leaves it", { skip, timeout: 120000 }, async () => {
  const dc = daemonDc(h);
  fs.mkdirSync(dc);
  try {
    fs.chmodSync(dc, 0o755);
    const before = fs.lstatSync(dc);
    const r = await cli(h, ['start']);
    assert.equal(r.status, 1, `start refused: ${r.out}`);
    assert.match(r.err, /Chrome's temp folder \/tmp\/dc[0-9a-f]{6} is already there and isn't this user's own \(a folder, owner \d+, mode 755\)/);
    const after = fs.lstatSync(dc);
    assert.deepEqual([after.ino, after.mode], [before.ino, before.mode], 'left as it was');
  } finally { await cli(h, ['stop']); fs.rmSync(dc, { recursive: true, force: true }); }
});

test("kit-777 F2: a Chrome that fails to launch leaves no folder of its own", { skip, timeout: 120000 }, async () => {
  const fake = path.join(tmp, 'chrome-that-fails');
  fs.writeFileSync(fake, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  try {
    const r = await cli(h, ['start'], { CHROME_PATH: fake });
    assert.equal(r.status, 1, `start failed: ${r.out}`);
    assert.match(r.err, /Chrome exited before its DevTools pipe opened/);
    assert.equal(fs.existsSync(daemonDc(h)), false, "the failed launch's folder is removed");
  } finally { await cli(h, ['stop']); }
});

// ----- kit-777: the daemon's Chrome temp folder. browserChromeTmp is cut out of devteam.mjs and run
// under node:vm with only what it uses in scope, on a base folder and uid the test gives (the daemon's
// own base is /tmp, as it runs under env -i, so a long one can't be reached through a start) -----

const kitSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'devteam', 'scripts', 'devteam.mjs'), 'utf8');
// browserChromeTmp with chromeTmpFor beside it, fs as given (a stand-in can race the mkdir).
function chromeTmpFn(fsIn = fs) {
  const i = kitSrc.indexOf('const chromeTmpFor = '), j = kitSrc.indexOf('async function browserLaunchChrome(');
  assert.ok(i >= 0 && j > i, 'chromeTmpFor … browserLaunchChrome in devteam.mjs');
  return vm.runInContext(`${kitSrc.slice(i, j)}\n;browserChromeTmp`, vm.createContext({ fs: fsIn, path, os, crypto, Buffer, process }));
}
// What Chrome put in its TMPDIR, from its environment (Linux: /proc).
const tmpdirOf = (pid) => fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').find((v) => v.startsWith('TMPDIR='))?.slice(7);
const dcIn = (base, profile) => path.join(base, `dc${crypto.createHash('sha1').update(profile).digest('hex').slice(0, 6)}`);
// A new folder whose path is exactly n bytes, in a folder of its own under the temp folder (this
// file's tmp can be too long), removed after the test.
function dirOfLength(t, n) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'k7n'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pad = n - root.length - 1;
  assert.ok(pad >= 1, `this file's temp folder (${root}) is too long to make a ${n}-byte path in`);
  const d = path.join(root, 'x'.repeat(pad));
  fs.mkdirSync(d);
  return d;
}
// A short base of its own, so the dc… folder fits (its path plus 54 bytes under 108).
function shortBase(t) {
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'k7b'));
  t.after(() => fs.rmSync(b, { recursive: true, force: true }));
  assert.ok(Buffer.byteLength(b) + 54 <= 107, `this file's temp folder (${b}) is too long for a dc… folder`);
  return b;
}
const uid = process.getuid?.();

// Chrome's singleton socket is <TMPDIR>/org.chromium.Chromium.XXXXXX/SingletonSocket, 45 bytes after
// TMPDIR, and Linux refuses a socket path of 108 bytes or more (macOS: 104). 58: the plain folder
// fits (103), a dc… folder in it doesn't (112). 70: neither fits (115).
test("kit-777 F1: a temp folder too long for a dc… folder: Chrome's TMPDIR is that folder as it is, and a note says so", (t) => {
  for (const platform of ['linux', 'darwin']) {
    const base = dirOfLength(t, 58);
    const r = chromeTmpFn()('/p/profile', { base, uid, platform });
    assert.deepEqual([r.tmpdir, r.own], [base, null], `${platform}: the plain folder, nothing of its own`);
    assert.match(r.note, /^Chrome's temp folders are loose in /);
    assert.deepEqual(fs.readdirSync(base), [], `${platform}: nothing made there`);
  }
});

test("kit-777 F1: a temp folder too long for Chrome's socket: refused, naming the length", (t) => {
  const base = dirOfLength(t, 70);
  assert.throws(() => chromeTmpFn()('/p/profile', { base, uid, platform: 'linux' }), /^Error: browser: Chrome's socket path would be 115 bytes in .* \(107 at most here\)/);
  assert.throws(() => chromeTmpFn()('/p/profile', { base, uid, platform: 'darwin' }), /would be 115 bytes in .* \(103 at most here\)/);
  assert.deepEqual(fs.readdirSync(base), [], 'nothing made there');
});

test('kit-777 F1: the longest base that fits a dc… folder gets one (Linux 53 bytes, macOS 49)', (t) => {
  for (const [platform, n] of [['linux', 53], ['darwin', 49]]) {
    const base = dirOfLength(t, n);
    const r = chromeTmpFn()('/p/profile', { base, uid, platform });
    assert.equal(r.own, dcIn(base, '/p/profile'), `${platform}: a dc… folder at ${n} bytes`);
    assert.equal(chromeTmpFn()('/p/profile', { base: dirOfLength(t, n + 1), uid, platform }).own, null, `${platform}: none at ${n + 1}`);
  }
});

// The folder's name can be guessed, so one already there is used only when it is this user's own
// folder, closed to others (a killed daemon's); anything else is refused and left as it is.
for (const [what, plant, as] of [
  ['a folder open to others', (dc) => { fs.mkdirSync(dc); fs.chmodSync(dc, 0o755); }, uid],
  ['a symlink to a folder', (dc) => fs.symlinkSync(fs.mkdtempSync(path.join(tmp, 'aim-')), dc), uid],
  ['a file', (dc) => fs.writeFileSync(dc, '', { mode: 0o600 }), uid],
  ["another user's folder", (dc) => fs.mkdirSync(dc, { mode: 0o700 }), uid + 1],
]) {
  test(`kit-777 F3: ${what} already at the folder's name: refused and left as it is`, (t) => {
    const base = shortBase(t), dc = dcIn(base, '/p/profile');
    plant(dc);
    const before = fs.lstatSync(dc);
    assert.throws(() => chromeTmpFn()('/p/profile', { base, uid: as, platform: 'linux' }), /^Error: browser: Chrome's temp folder .* is already there and isn't this user's own/);
    const after = fs.lstatSync(dc);
    assert.deepEqual([after.ino, after.mode], [before.ino, before.mode], 'left as it was');
  });
}

test("kit-777 F3: a killed daemon's folder (this user's, closed to others) is emptied and made again", (t) => {
  const base = shortBase(t), dc = dcIn(base, '/p/profile');
  fs.mkdirSync(dc, { mode: 0o700 });
  fs.writeFileSync(path.join(dc, 'stale'), '');
  const r = chromeTmpFn()('/p/profile', { base, uid, platform: 'linux' });
  assert.deepEqual([r.tmpdir, r.own, r.note], [dc, dc, null]);
  assert.deepEqual(fs.readdirSync(dc), [], 'emptied');
  assert.equal(fs.statSync(dc).mode & 0o777, 0o700);
});

test('kit-777 F3: a folder made by another process between the removal and the mkdir: refused', (t) => {
  const base = shortBase(t), dc = dcIn(base, '/p/profile');
  fs.mkdirSync(dc, { mode: 0o700 });
  // the removal, then someone else's mkdir at once: the folder is there again when ours runs
  const racing = { ...fs, rmSync: (p, o) => { fs.rmSync(p, o); fs.mkdirSync(p, { mode: 0o700 }); fs.writeFileSync(path.join(p, 'theirs'), ''); } };
  assert.throws(() => chromeTmpFn(racing)('/p/profile', { base, uid, platform: 'linux' }), /^Error: browser: Chrome's temp folder .* was made by another process as this one made it/);
  assert.deepEqual(fs.readdirSync(dc), ['theirs'], 'theirs left as it is');
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
  assert.equal((await fetch(`http://127.0.0.1:${s.view_port}/`)).status, 200, 'the daemon listens on the view port');
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
  const tc = Date.now();
  assert.equal((await cli(h, ['click', ref])).status, 0);
  assert.ok(Date.now() - tc < 10000, `click took ${Date.now() - tc} ms`);
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


// Last in the file (T5-6, the spec's J2 for this file): everything every verb printed here.
test('J2 nothing secret printed (hygiene)', { skip, timeout: 120000 }, async () => {
  noSecretPrinted();
});
