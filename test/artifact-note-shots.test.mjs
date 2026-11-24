// The kit's own picture of an artifact note's spot (kit-147): what thread ready takes and records, who
// may withdraw a mark, the page's frame, the /shot/ route, and which copy of the artifact is pictured.
// Each test is named by its check in the ticket's spec. Real Chrome, over the kit's DevTools pipe: this
// file never skips, and fails its first test when the machine has none.
// Run: node --test test/artifact-note-shots.test.mjs
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { chromePath } from './lib/chrome.mjs';
import { dashboardOnFreePort, kit, testDir, threadsFixture, write } from './lib/kit.mjs';

const SRC = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
const LENS = /const ARTIFACT_LENS = String\.raw`([^`]*)`;/.exec(SRC)[1];
const FIXTURES = path.join(testDir, 'fixtures', 'artifact-shots');
const MARKERS = ['// helpers: the shooter injects from here', '// helpers: to here', '// finder: the shooter injects from here', '// finder: to here'];
const count = (text, part) => text.split(part).length - 1;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// --- the fixture: one project for the file, its artifact pricing on main ------------------------------
// Chrome's singleton socket path is capped, so its TMPDIR is short and this file's own.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ks'));
let made = null;
after(() => { made?.F.done(); fs.rmSync(TMP, { recursive: true, force: true }); });
function shotKit() {
  if (made) return made;
  const F = threadsFixture('shots');
  const arts = path.join(F.old, 'docs/devteam/project/artifacts');
  fs.cpSync(FIXTURES, path.join(arts, 'pricing'), { recursive: true, filter: (f) => !f.endsWith('.sh') });
  F.g(['add', '-A'], F.old);
  F.g(['commit', '-qm', 'pricing'], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
  const DT = path.join(F.old, 'docs/devteam/scripts/devteam.mjs');
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const childEnv = (extra = {}) => { const e = { ...F.env({}), HOME: F.home, TMPDIR: TMP, DEVTEAM_TEST: '1', DEVTEAM_CHROME_NO_SANDBOX: '1', CHROME_PATH: chromePath ?? '', ...extra }; for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k]; return e; };
  // async, so a server this test holds answers while the command runs
  const run = (args, extra = {}) => new Promise((resolve) => {
    const p = spawn(process.execPath, [DT, ...args], { cwd: F.old, env: childEnv(extra), stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '', e = '';
    p.stdout.on('data', (b) => { o += b; });
    p.stderr.on('data', (b) => { e += b; });
    p.on('close', (status) => resolve({ status, stdout: o, stderr: e, out: `${o}${e}`.trim() }));
  });
  const lines = () => fs.readdirSync(F.logDir).filter((f) => f.endsWith('.jsonl')).sort().flatMap((f) => fs.readFileSync(path.join(F.logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  const last = (pred) => lines().filter(pred).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).pop();
  const logBytes = () => fs.readdirSync(F.logDir).sort().map((f) => `${f}:${fs.statSync(path.join(F.logDir, f)).size}`).join(' ');
  const shots = path.join(F.old, 'docs/devteam/run/shots');
  const files = (id) => (fs.existsSync(path.join(shots, id)) ? fs.readdirSync(path.join(shots, id)).sort() : []);
  const tree = () => { const all = []; const walk = (d) => { if (fs.existsSync(d)) for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); all.push(f); if (e.isDirectory()) walk(f); } }; walk(shots); return all.sort().join('\n'); };
  // a subject of its own each time (one open thread per subject): the selector gains a :not() that
  // matches everything
  let n = 0;
  const subject = (o = {}, anchor = {}) => ({ kind: 'artifact', slug: 'pricing', at: 'main', path: 'found.html', anchor: { selector: `#buy:not(.n${++n})`, tag: 'button', text: 'Start trial', rect: { x: 600, y: 400, w: 100, h: 60 }, ...anchor }, point: { x: 620, y: 420 }, ...o });
  const pointNote = (o = {}) => ({ kind: 'artifact', slug: 'pricing', at: 'main', path: 'found.html', point: { x: 40 + ++n / 1000, y: 20 }, ...o });
  const note = async (s, { frame } = {}) => {
    const r = await run(['thread', 'new', '--title', 'A note', ...(s ? [`--subject=${JSON.stringify(s)}`] : []), ...(frame ? [`--frame=${JSON.stringify(frame)}`] : []), '--', 'Make it say Annual']);
    assert.equal(r.status, 0, r.out);
    return /t-\d{8}-\d{9}-[a-z0-9-]+/.exec(r.stdout)[0];
  };
  const ready = async (id, extra = {}) => {
    const r = await run(['thread', 'ready', id, '--outcome', 'The button now says Annual'], { ...SUP, ...extra });
    return { ...r, id, line: last((o) => o.type === 'thread' && o.op === 'set' && o.id === id && o.ready) };
  };
  const readyOn = async (s, { frame, ...extra } = {}) => ready(await note(s, { frame }), extra);
  const light = (r) => png(fs.readFileSync(path.join(shots, r.id, `${r.line.shot.stamp}-light.png`)));
  const show = async (id) => JSON.parse((await run(['thread', 'show', id, '--json'], SUP)).stdout);
  const seen = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);
  return (made = { F, DT, SUP, arts, shots, run, lines, last, logBytes, files, tree, subject, pointNote, note, ready, readyOn, light, show, seen, childEnv });
}

// --- a PNG's pixels: every row filter undone (Chrome uses them all) ------------------------------------
function png(buf) {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), bpp = { 2: 3, 6: 4 }[buf[25]];
  assert.ok(bpp && buf[24] === 8 && buf[28] === 0, 'an 8-bit RGB or RGBA PNG, not interlaced');
  const idat = [];
  for (let at = 8; at < buf.length;) { const len = buf.readUInt32BE(at); if (buf.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(buf.subarray(at + 8, at + 8 + len)); at += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, data = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? data[y * stride + i - bpp] : 0, b = y ? data[(y - 1) * stride + i] : 0, c = i >= bpp && y ? data[(y - 1) * stride + i - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const add = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      data[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + add) & 255;
    }
  }
  return { w, h, px: (x, y) => { const at = y * stride + x * bpp; return [data[at], data[at + 1], data[at + 2], bpp === 4 ? data[at + 3] : 255]; } };
}
const near = (px, rgb) => rgb.every((v, i) => Math.abs(px[i] - v) <= 8);
const RING = [0xff, 0x1f, 0x8f];
// the ring's four lines 2 px outside box (in the picture's own pixels), and none 20 px inside it
function ringAt(p, { x, y, w, h }) {
  const cx = Math.round(x + w / 2), cy = Math.round(y + h / 2);
  const on = [[x - 3, cy], [x + w + 2, cy], [cx, y - 3], [cx, y + h + 2]].every(([a, b]) => near(p.px(a, b), RING));
  return on && !near(p.px(x + Math.min(20, Math.floor(w / 2)), y + Math.min(20, Math.floor(h / 2))), RING);
}

// a stand-in Chrome from the fixtures, and the arguments of each launch of it
let fakes = 0;
function fake(name, as = name) {
  const file = path.join(TMP, `f${++fakes}`, as);
  fs.mkdirSync(path.dirname(file));
  fs.copyFileSync(path.join(FIXTURES, name), file);
  fs.chmodSync(file, 0o755);
  return { file, dir: path.dirname(file), launches: () => (fs.existsSync(`${file}.log`) ? fs.readFileSync(`${file}.log`, 'utf8').trim().split('\n').map((l) => l.split(' ')) : []) };
}
const seenFile = () => path.join(TMP, `seen${++fakes}.log`);
// the body of a top-level function or const in the kit, for a string check
const body = (name) => new RegExp(`\\n(?:async )?(?:function|const) ${name}\\b[\\s\\S]*?\\n\\}`).exec(SRC)?.[0] ?? '';
const region = () => /\/\* note-shots start \*\/([\s\S]*?)\/\* note-shots end \*\//.exec(SRC)?.[1] ?? '';

test('C1c every test runs, and the file fails with no Chrome', () => {
  assert.ok(chromePath, 'no Chrome: install Chrome or Chromium, or set CHROME_PATH');
  const own = fs.readFileSync(path.join(testDir, 'artifact-note-shots.test.mjs'), 'utf8').split('\n');
  const said = own.filter((l) => /skip|todo/i.test(l) && !/^\/\//.test(l)); // no-skip-check
  assert.deepEqual(said.filter((l) => !l.endsWith('// no-skip-check')), []); // no-skip-check
  assert.equal(own.filter((l) => l.endsWith('// no-skip-check')).length, 3); // no-skip-check
  const list = spawnSync(process.execPath, [path.join(testDir, 'run.mjs'), '--list'], { cwd: path.join(testDir, '..'), encoding: 'utf8' }).stdout;
  assert.match(list, /artifact-note-shots\.test\.mjs\s+chrome\b/);
});

test('C2b no websocket in the kit', () => {
  assert.equal(count(SRC, 'new WebSocket('), 0);
});

test('C14a one finder, the lens\'s own', () => {
  for (const m of MARKERS) assert.equal(count(LENS, m), 1, `marker missing: ${m}`);
  const at = MARKERS.map((m) => LENS.indexOf(m));
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'the markers in order');
  for (const d of ['const find = (a) =>', 'const hiddenEl =', 'const textOf =']) assert.equal(count(LENS, d), 1, d);
  for (const d of ['const find = (a) =>', 'const hiddenEl =']) assert.equal(count(SRC, d), 1, `${d} once in the kit`);
  const finder = LENS.slice(at[2], at[3]);
  for (const d of ['const find = (a) =>', 'const hiddenEl =', 'const textOf =', 'const rectOf =']) assert.ok(finder.includes(d), `${d} in the finder's slice`);
  for (const d of ['const CAPS =', 'const cap =', 'const oneLine =', 'const num =', 'const unCap =']) assert.ok(LENS.slice(at[0], at[1]).includes(d), `${d} in the helpers' slice`);
  assert.ok(region(), 'the note-shots region');
  for (const d of ['find', 'hiddenEl', 'textOf']) assert.ok(!new RegExp(`(?:const|let|var|function) ${d}\\b`).test(region()), `the shooter has no ${d} of its own`);
});

test('C2a a pipe, no port, and a profile of its own that goes', async () => {
  const k = shotKit();
  const dies = fake('fake-chrome.sh');
  await k.readyOn(k.subject(), { CHROME_PATH: dies.file });
  assert.ok(dies.launches().length >= 1, 'the fake Chrome was launched');
  for (const a of dies.launches()) {
    for (const f of ['--headless=new', '--remote-debugging-pipe', '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp']) assert.ok(a.includes(f), f);
    assert.ok(!a.some((x) => x.startsWith('--remote-debugging-port')), 'no port');
    assert.ok(a.find((x) => x.startsWith('--user-data-dir=')).slice(16).startsWith(`${TMP}${path.sep}`), 'a profile under the temp folder');
  }
  const profiles = [];
  for (let i = 0; i < 2; i++) {
    const wrap = fake('wrap-chrome.sh');
    const hook = seenFile();
    await k.readyOn(k.subject(), { CHROME_PATH: wrap.file, REAL_CHROME: chromePath, DEVTEAM_TEST_SHOT_SEEN: hook });
    const mine = k.seen(hook).filter((l) => l.startsWith('launch ')).map((l) => / profile=(.*)$/.exec(l)[1]);
    assert.ok(mine.length >= 1 && wrap.launches().length === mine.length, 'a launch line each launch');
    for (const p of mine) assert.ok(!fs.existsSync(p), `${p} is gone`);
    profiles.push(...mine);
  }
  assert.equal(new Set(profiles).size, profiles.length, 'no shared profile');
  assert.deepEqual(fs.readdirSync(TMP).filter((f) => /^dc|^devteam-shot-/.test(f)), [], 'no profile or temp folder is left');
});

test('C2c one list of Chrome\'s names', async () => {
  const k = shotKit();
  const named = fake('fake-chrome.sh', 'google-chrome');
  await k.readyOn(k.subject(), { CHROME_PATH: undefined, PATH: `${named.dir}${path.delimiter}${process.env.PATH}` });
  assert.ok(named.launches().length >= 1, 'the google-chrome first on PATH was launched');
  assert.equal(count(SRC, 'const BROWSER_CHROME_NAMES ='), 1);
  assert.equal(count(SRC, "'google-chrome-stable'"), 1);
  assert.ok(region().includes('browserChrome('), 'the shooter finds Chrome as the browser does');
});

test('C8a no sandbox only when the operator says so, and only second', async () => {
  const k = shotKit();
  const dies = fake('fake-chrome.sh');
  const r = await k.readyOn(k.subject(), { CHROME_PATH: dies.file });
  assert.equal(r.status, 1);
  assert.equal(r.line, undefined);
  assert.deepEqual(dies.launches().map((a) => a.includes('--no-sandbox')), [false, true]);
  assert.match(r.out, /Chrome's sandbox didn't start here; took the picture without it \(DEVTEAM_CHROME_NO_SANDBOX=1\)/);
  const again = fake('fake-chrome.sh');
  const r2 = await k.readyOn(k.subject(), { CHROME_PATH: again.file, DEVTEAM_CHROME_NO_SANDBOX: undefined });
  assert.equal(r2.status, 1);
  assert.deepEqual(again.launches().map((a) => a.includes('--no-sandbox')), [false]);
  assert.match(r2.out, /Chrome didn't start \(its sandbox may not be available here\); set DEVTEAM_CHROME_NO_SANDBOX=1 to allow one try without it/);
});

test('C8b a crash after the page opened is never tried again', async () => {
  const k = shotKit();
  const wrap = fake('wrap-chrome.sh');
  const hook = seenFile();
  const r = await k.readyOn(k.subject(), { CHROME_PATH: wrap.file, REAL_CHROME: chromePath, DEVTEAM_TEST_SHOT_SEEN: hook, DEVTEAM_TEST_SHOT_CRASH: '1' });
  assert.equal(r.status, 1, r.out);
  assert.equal(r.line, undefined);
  assert.match(r.out, /the page crashed; no mark written/);
  const said = k.seen(hook);
  const page = said.indexOf('page');
  assert.ok(page > 0, 'the page opened');
  assert.deepEqual(said.slice(page).filter((l) => l.startsWith('launch ')), []);
});

test('C8c no Chrome: refused, nothing written', async () => {
  const k = shotKit();
  const id = await k.note(k.subject());
  const was = [k.logBytes(), k.tree()];
  const r = await k.ready(id, { CHROME_PATH: path.join(TMP, 'no-such-chrome') });
  assert.equal(r.status, 1);
  assert.match(r.out, /thread ready on an artifact note needs Chrome to take its picture: install Chrome or Chromium, or set CHROME_PATH/);
  assert.deepEqual([k.logBytes(), k.tree()], was);
});

test('C9 other threads: as before, no Chrome', async () => {
  const k = shotKit();
  for (const s of [null, { kind: 'item', ref: `goal:${k.F.goal}` }, { kind: 'preview', name: 'cool-tiger', route: '/', point: { x: 1, y: 1 } }, { kind: 'page', view: 'overview', at: { x: 0.5, y: 0.5 } }]) {
    const r = await k.readyOn(s, { CHROME_PATH: path.join(TMP, 'no-such-chrome') });
    assert.equal(r.status, 0, `${s?.kind ?? 'no subject'}: ${r.out}`);
    assert.ok(r.line && !('shot' in r.line), `${s?.kind ?? 'no subject'}: a ready line, no shot`);
  }
});
