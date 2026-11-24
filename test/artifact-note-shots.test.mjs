// The kit's own picture of an artifact note's spot (kit-147): what thread ready takes and records, who
// may withdraw a mark, the page's frame, the /shot/ route, and which copy of the artifact is pictured.
// Each test is named by its check in the ticket's spec. Real Chrome, over the kit's DevTools pipe: this
// file never skips, and fails its first test when the machine has none.
// Run: node --test test/artifact-note-shots.test.mjs
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { chromePath } from './lib/chrome.mjs';
import { dashboardOnFreePort, kit, testDir, threadsFixture, until, write } from './lib/kit.mjs';

const SRC = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
const LENS = /const ARTIFACT_LENS = String\.raw`([^`]*)`;/.exec(SRC)[1];
const FIXTURES = path.join(testDir, 'fixtures', 'artifact-shots');
const MARKERS = ['// helpers: the shooter injects from here', '// helpers: to here', '// finder: the shooter injects from here', '// finder: to here'];
const count = (text, part) => text.split(part).length - 1;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// --- the fixture: one project for the file, its artifact pricing on main ------------------------------
// Chrome's singleton socket path is capped, so its TMPDIR is short and this file's own.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ks'));
// Another server on this machine, which a page under a capture must never reach; the fixtures name it
// as __OTHER__.
const reached = [];
// (anything else on the machine that looks at a new port asks for /)
const other = http.createServer((q, s) => { if (q.url !== '/') reached.push(q.url); s.end('x'); });
other.on('upgrade', (q, sock) => { reached.push(`upgrade ${q.url}`); sock.destroy(); });
await new Promise((r) => other.listen(0, '127.0.0.1', r));
const OTHER = `http://127.0.0.1:${other.address().port}`;
const udp = dgram.createSocket('udp4');
udp.on('message', () => { reached.push('udp'); });
await new Promise((r) => udp.bind(0, '127.0.0.1', r));
let made = null;
after(() => { udp.close(); other.closeAllConnections?.(); other.close(); made?.F.done(); fs.rmSync(TMP, { recursive: true, force: true }); });
function shotKit() {
  if (made) return made;
  const F = threadsFixture('shots');
  const arts = path.join(F.old, 'docs/devteam/project/artifacts');
  fs.cpSync(FIXTURES, path.join(arts, 'pricing'), { recursive: true, filter: (f) => !f.endsWith('.sh') });
  for (const f of fs.readdirSync(path.join(arts, 'pricing')).filter((x) => /\.(html|js)$/.test(x))) { const at = path.join(arts, 'pricing', f); fs.writeFileSync(at, fs.readFileSync(at, 'utf8').replaceAll('__OTHER__', OTHER).replaceAll('__UDP__', String(udp.address().port))); }
  fs.symlinkSync('app.js', path.join(arts, 'pricing', 'link.js'));
  write(path.join(arts, 'pricing', '.secret.js'), '// never served\n');
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
  assert.ok(/ARTIFACT_LENS\b/.test(body('shotSlice')) && body('shotScript').includes('shotSlice('), 'the shooter\'s script is cut from the lens');
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
  for (const v of [undefined, '0']) {
    const again = fake('fake-chrome.sh');
    const r2 = await k.readyOn(k.subject(), { CHROME_PATH: again.file, DEVTEAM_CHROME_NO_SANDBOX: v });
    assert.equal(r2.status, 1);
    assert.deepEqual(again.launches().map((a) => a.includes('--no-sandbox')), [false], String(v));
    assert.match(r2.out, /Chrome didn't start \(its sandbox may not be available here\); set DEVTEAM_CHROME_NO_SANDBOX=1 to allow one try without it/);
  }
});

test('C8a a Chrome that says nothing is killed with its children after 8 s', async () => {
  const k = shotKit();
  const hang = fake('hang-chrome.sh');
  const started = Date.now();
  const r = await k.readyOn(k.subject(), { CHROME_PATH: hang.file, DEVTEAM_CHROME_NO_SANDBOX: undefined });
  const took = Date.now() - started;
  assert.equal(r.status, 1);
  assert.match(r.out, /Chrome didn't start/);
  assert.ok(took >= 8000 && took < 16000, `${took} ms`);
  await until(() => !spawnSync('ps', ['-eo', 'args'], { encoding: 'utf8' }).stdout.split('\n').includes('sleep 97531'), 'its child to be gone');
});

test('C8a a Chrome that dies once its page exists is not tried again', async () => {
  const k = shotKit();
  const wrap = fake('fake-pipe.sh');
  const r = await k.readyOn(k.subject(), { CHROME_PATH: wrap.file, FAKE_NODE: process.execPath });
  assert.equal(r.status, 1);
  assert.deepEqual(wrap.launches().map((a) => a.includes('--no-sandbox')), [false]);
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

const HOSTS = [.../const ARTIFACT_CDNS = (\[.*?\]);/.exec(SRC)[1].matchAll(/'https:\/\/([^']+)'/g), .../const ARTIFACT_FONT_HOSTS = (\[.*?\]);/.exec(SRC)[1].matchAll(/'https:\/\/([^']+)'/g)].map((m) => m[1]);

test('C7a C7b C7c requests go to the capture and the allowed hosts alone', async () => {
  const k = shotKit();
  const hook = seenFile();
  reached.length = 0;
  await k.readyOn(k.subject({ path: 'requests.html' }), { DEVTEAM_TEST_SHOT_SEEN: hook, DEVTEAM_TEST_SHOT_NO_CSP: '1' });
  assert.deepEqual(reached, [], 'the other server saw nothing');
  const said = k.seen(hook);
  for (const u of [`${OTHER}/fetch`, `${OTHER}/img`, 'https://example.invalid/x', 'https://cdn.jsdelivr.net.evil.example/x']) assert.ok(said.includes(`fail ${u}`), `fail ${u}: ${said.join(' | ')}`);
  for (const u of ['https://cdn.jsdelivr.net/x', 'https://fonts.gstatic.com/x']) assert.ok(said.includes(`continue ${u}`), `continue ${u}`);
  assert.ok(said.some((l) => /^serve \/requests\.html csp=no$/.test(l)), 'the CSP is off, so the wall stands alone');
});

test('C7d one list of hosts, one set of headers', () => {
  const csp = /const artifactCsp = [\s\S]*?\n};/.exec(SRC)[0];
  assert.ok(csp.includes('ARTIFACT_FONT_HOSTS') && !csp.includes('https://fonts.'));
  for (const h of ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']) assert.equal(count(SRC.slice(SRC.indexOf('const ARTIFACT_CDNS')), `'${h}'`) , 1, `${h} written once`);
  const allowed = body('shotRequestAllowed');
  assert.ok(allowed.includes('ARTIFACT_CDNS') && allowed.includes('ARTIFACT_FONT_HOSTS'));
  assert.ok(body('shotServe').includes('artifactHeaders('), 'the capture server');
  const route = SRC.slice(SRC.indexOf("rawPath.startsWith('/artifact/')"));
  assert.ok(route.slice(0, route.indexOf('return DASH_NEXT')).includes('artifactHeaders('), 'the dashboard');
});

test('C7e the proxy flags: dead but for the capture and the allowed hosts', async () => {
  const k = shotKit();
  const dies = fake('fake-chrome.sh');
  await k.readyOn(k.subject(), { CHROME_PATH: dies.file });
  assert.ok(dies.launches().length >= 1);
  for (const a of dies.launches()) {
    assert.ok(a.some((x) => /^--proxy-server=http:\/\/127\.0\.0\.1:\d+$/.test(x)), a.join(' '));
    const bypass = a.find((x) => x.startsWith('--proxy-bypass-list=')).slice(20).split(';');
    assert.equal(bypass[0], '<-loopback>');
    assert.match(bypass[1], /^127\.0\.0\.1:\d+$/);
    assert.deepEqual(bypass.slice(2), HOSTS);
    for (const f of ['--webrtc-ip-handling-policy=disable_non_proxied_udp', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp']) assert.ok(a.includes(f), f);
    assert.deepEqual(a.join(' ').match(/--host-resolver-rules=(.*?) (?:--|about:)/)?.[1].split(',').map((x) => x.trim()), ['MAP * ~NOTFOUND', 'EXCLUDE 127.0.0.1', ...HOSTS.map((h) => `EXCLUDE ${h}`)], 'no name resolved but the allowed hosts\'');
    assert.ok(!a.some((x) => x === `--proxy-server=http://${bypass[1]}`), 'the dead proxy is not the capture server');
  }
});

test('C7f no route to another server', async () => {
  const k = shotKit();
  const hook = seenFile();
  reached.length = 0;
  await k.readyOn(k.subject({ path: 'routes.html' }), { DEVTEAM_TEST_SHOT_SEEN: hook, DEVTEAM_TEST_SHOT_NO_CSP: '1' });
  const said = k.seen(hook);
  assert.deepEqual(reached, []);
  assert.ok(said.includes('serve /sw.js csp=no'), `the service worker was asked for: ${said.join(' | ')}`);
  for (const t of ['ws', 'sw', 'rtc']) assert.ok(said.includes(`serve /tried-${t} csp=no`), `${t} was tried: ${said.join(' | ')}`);
  assert.ok(said.includes(`fail ${OTHER}/worker`), 'the worker fetched');
  assert.ok(said.includes(`fail ${OTHER}/moved`), 'the page tried to move');
});

test('C7f the page stays, and leaves no file', async () => {
  const k = shotKit();
  const hook = seenFile();
  await k.readyOn(k.subject({ path: 'leave.html' }), { DEVTEAM_TEST_SHOT_SEEN: hook, DEVTEAM_TEST_SHOT_NO_CSP: '1' });
  assert.ok(k.seen(hook).includes('fail https://unpkg.com/x.html'), k.seen(hook).join(' | '));
  const left = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith('left-behind')) left.push(path.join(d, e.name)); if (e.isDirectory()) walk(path.join(d, e.name)); } };
  for (const d of [k.F.home, TMP, k.F.old].filter((x) => fs.existsSync(x))) walk(d);
  assert.deepEqual(left, []);
});

test('the capture serves the artifact\'s plain files and nothing else', async () => {
  const k = shotKit();
  const hook = seenFile();
  await k.readyOn(k.subject({ path: 'paths.html' }), { DEVTEAM_TEST_SHOT_SEEN: hook, DEVTEAM_TEST_SHOT_NO_CSP: '1' });
  assert.deepEqual(k.seen(hook).filter((l) => l.startsWith('serve /got-')), ['serve /got-plain csp=no']);
});

test('C7g every file under the policy, and no hook outside tests', async () => {
  const k = shotKit();
  const hook = seenFile();
  await k.readyOn(k.subject({ path: 'assets.html' }), { DEVTEAM_TEST_SHOT_SEEN: hook });
  const served = k.seen(hook).filter((l) => l.startsWith('serve '));
  for (const f of ['/assets.html', '/app.js', '/app.css']) assert.ok(served.includes(`serve ${f} csp=yes`), `${f}: ${served.join(' | ')}`);
  assert.deepEqual(served.filter((l) => !l.endsWith(' csp=yes')), []);
  const off = seenFile();
  await k.readyOn(k.subject({ path: 'assets.html' }), { DEVTEAM_TEST: undefined, DEVTEAM_TEST_SHOT_SEEN: off, DEVTEAM_TEST_SHOT_NO_CSP: '1' });
  assert.ok(!fs.existsSync(off), 'no hook file');
  assert.ok(!/process\.env\.DEVTEAM_TEST/.test(region()), 'each hook read through browserTestEnv');
});

test('C8c a page that loops, and nothing to picture: refused, nothing written', async () => {
  const k = shotKit();
  const hook = seenFile();
  const id = await k.note(k.subject({ path: 'loop.html' }));
  const nowhere = await k.note(k.subject({ slug: 'nowhere' }));
  const was = [k.logBytes(), k.tree()];
  const started = Date.now();
  const r = await k.ready(id, { DEVTEAM_TEST_SHOT_SEEN: hook });
  assert.equal(r.status, 1);
  assert.match(r.out, /the picture took longer than 20 s \(a page that never settles, or a script that loops\); no mark written/);
  assert.ok(Date.now() - started < 28000, 'it ended soon after 20 s');
  const ps = spawnSync('ps', ['-eo', 'args'], { encoding: 'utf8' }).stdout;
  const profiles = k.seen(hook).filter((l) => l.startsWith('launch ')).map((l) => / profile=(.*)$/.exec(l)[1]);
  assert.ok(profiles.length);
  for (const p of profiles) assert.ok(!ps.includes(p) && !fs.existsSync(p), `nothing of ${p} is left`);
  const r2 = await k.ready(nowhere);
  assert.equal(r2.status, 1);
  assert.match(r2.out, /nothing to picture: nowhere isn't on main or in a draft/);
  assert.deepEqual([k.logBytes(), k.tree()], was);
});

test('C10a C10c thread new --frame: recorded, and every bound held', async () => {
  const k = shotKit();
  const frame = { w: 900, h: 700, hash: '#tab2' };
  const id = await k.note(k.subject(), { frame });
  const started = k.last((o) => o.type === 'thread' && o.op === 'new' && o.id === id);
  assert.deepEqual(started.frame, frame);
  assert.equal(started.by, 'owner');
  const was = k.logBytes();
  const bad = async (what, text, subject, want) => {
    const r = await k.run(['thread', 'new', '--title', 'A bad frame', `--subject=${JSON.stringify(subject)}`, `--frame=${text}`, '--', 'Words']);
    assert.equal(r.status, 1, what);
    assert.match(r.out, want, what);
    assert.equal(k.logBytes(), was, `${what}: no line`);
  };
  for (const [what, f] of [['w 319', { w: 319, h: 700, hash: '' }], ['w 3841', { w: 3841, h: 700, hash: '' }], ['w 900.5', { w: 900.5, h: 700, hash: '' }], ['w text', { w: '900', h: 700, hash: '' }], ['h 239', { w: 900, h: 239, hash: '' }], ['h 2161', { w: 900, h: 2161, hash: '' }], ['hash tab2', { w: 900, h: 700, hash: 'tab2' }], ['hash 201 bytes', { w: 900, h: 700, hash: `#${'x'.repeat(200)}` }], ['hash newline', { w: 900, h: 700, hash: '#a\nb' }], ['no hash', { w: 900, h: 700 }], ['an extra key', { w: 900, h: 700, hash: '', x: 1 }], ['a list', [900, 700, '']], ['null', null]]) await bad(what, JSON.stringify(f), k.subject(), /--frame/);
  await bad('not JSON', '{w:900}', k.subject(), /--frame/);
  await bad('an item subject', JSON.stringify(frame), { kind: 'item', ref: `goal:${k.F.goal}` }, /--frame goes with an artifact subject/);
  for (const f of [{ w: 320, h: 240, hash: '' }, { w: 3840, h: 2160, hash: `#${'x'.repeat(199)}` }]) { const at = await k.note(k.subject(), { frame: f }); assert.deepEqual(k.last((o) => o.type === 'thread' && o.op === 'new' && o.id === at).frame, f); }
});

test('C5i a capability in frame.hash is cut', async () => {
  const k = shotKit();
  const cap = '/c/1763164800000.abcdefghijklmnop.abcdefghijklmnopqrstuv';
  const id = await k.note(k.subject(), { frame: { w: 900, h: 700, hash: `#${cap}` } });
  const { hash } = k.last((o) => o.type === 'thread' && o.op === 'new' && o.id === id).frame;
  assert.ok(hash.includes('[link removed]') && !hash.includes('abcdefghijklmnop'), hash);
});

test('C10b the thread-new POST carries the frame, and refuses a bad one', async () => {
  const k = shotKit();
  const { dash, port } = await dashboardOnFreePort(k.F.old, k.childEnv());
  try {
    const post = (b) => fetch(`http://127.0.0.1:${port}/api/thread-new`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(b) });
    const named = (title) => k.last((o) => o.type === 'thread' && o.op === 'new' && o.title === title);
    const frame = { w: 900, h: 700, hash: '' };
    const good = await post({ title: 'A framed note', text: 'Words', subject: k.subject(), frame });
    assert.equal(good.status, 200, await good.text());
    assert.deepEqual(named('A framed note').frame, frame);
    const bad = await post({ title: 'A badly framed note', text: 'Words', subject: k.subject(), frame: { w: 100 } });
    assert.equal(bad.status, 400);
    assert.equal(named('A badly framed note'), undefined);
    const none = await post({ title: 'A note with no frame', text: 'Words', subject: k.subject() });
    assert.equal(none.status, 200);
    assert.ok(!('frame' in named('A note with no frame')));
  } finally { await dash.stop(); }
});

// a capture is mostly waiting: three at a time
async function each(list, fn) { const at = [...list]; await Promise.all([0, 1, 2].map(async () => { while (at.length) await fn(at.shift()); })); }
const NINE = { w: 900, h: 700, hash: '' };
// where found.html's button is in its 320x200 picture
const MIDDLE = { x: 110, y: 70, w: 100, h: 60 };
const lit = (k, r) => fs.readFileSync(path.join(k.shots, r.id, `${r.line.shot.stamp}-light.png`));
const said = (r) => `${r.status}: ${r.out}`;

test('C1a C1b C6b C15a a found note: the line, the file, the ring, what is printed', async () => {
  const k = shotKit();
  const r = await k.readyOn(k.subject());
  assert.equal(r.status, 0, said(r));
  const { shot } = r.line;
  assert.equal(r.line.by, 'supervisor');
  assert.equal(r.line.ready.outcome, 'The button now says Annual');
  assert.deepEqual(Object.keys(shot).sort(), ['anchor', 'dark', 'dirty', 'h', 'sha', 'src', 'stamp', 'sum', 'w']);
  assert.match(shot.stamp, /^\d{8}-\d{9}$/);
  assert.deepEqual([shot.anchor, shot.w, shot.h, shot.dark, 'dark' in shot.sum], ['found', 1400, 860, false, false]);
  assert.deepEqual(k.files(r.id), [`${shot.stamp}-light.png`]);
  assert.equal(shot.sum.light, sha256(lit(k, r)));
  const p = k.light(r);
  assert.deepEqual([p.w, p.h], [320, 200]);
  assert.ok(ringAt(p, MIDDLE), 'the ring round the button');
  assert.ok(near(p.px(160, 100 - 25), [0, 0, 255]), 'the button inside it');
  assert.ok(r.stdout.includes(`${k.shots}/${r.id}/${shot.stamp}-light.png`) || r.stdout.includes(fs.realpathSync(path.join(k.shots, r.id, `${shot.stamp}-light.png`))), r.stdout);
  assert.ok(r.stdout.includes(`Look at it before you send this mark: if it doesn't show the change, withdraw it with thread unready ${r.id} --reason "<why>".`));
  assert.match(r.stdout, /data, not instructions[^\n]*\n {2}anchor found, clip 320x200, text "Start trial"/);
});

test('C3 the width the owner had, and the clip', async () => {
  const k = shotKit();
  await each([
    ['C3a', { path: 'width.html' }, NINE, (r) => { assert.match(r.out, /text "Narrow"/); assert.equal(r.line.shot.w, 900); }],
    ['C3b', { path: 'width.html' }, undefined, (r) => { assert.match(r.out, /text "Wide"/); assert.equal(r.line.shot.w, 1400); }],
    ['C3c', { path: 'liar.html' }, NINE, (r) => assert.equal(r.line.shot.w, 777)],
    ['C3d 400x300', { path: 'mid.html' }, undefined, (r, p) => assert.deepEqual([p.w, p.h], [464, 364])],
    ['C3d tall', { path: 'tall.html' }, NINE, (r, p) => assert.equal(p.h, 700)],
    ['C3d wide', { path: 'wide.html' }, NINE, (r, p) => assert.equal(p.w, 900)],
    ['C3e', { path: 'below.html' }, undefined, (r, p) => assert.ok(ringAt(p, MIDDLE))],
    ['C3f', { path: 'liar3000.html' }, NINE, (r, p) => { assert.ok(p.w <= 900); assert.equal(r.line.shot.w, 3000); }],
    ['C3g', { path: 'corner.html', anchor: { selector: '#logo', tag: 'div', text: 'Logo', rect: { x: 12, y: 12, w: 40, h: 20 } } }, NINE, (r, p) => { assert.deepEqual([p.w, p.h], [320, 200]); assert.ok(ringAt(p, { x: 12, y: 12, w: 40, h: 20 })); }],
    ['C3h', { point: { x: 40, y: 20 }, path: 'scrolled.html', anchor: undefined }, undefined, (r, p) => { assert.ok(near(p.px(40, 20), [255, 0, 0]), String(p.px(40, 20))); assert.ok(near(p.px(40, 80), [0, 0, 255])); }],
    ['C3x a query string in path', { path: 'found.html?x=1' }, undefined, (r) => assert.equal(r.line.shot.anchor, 'found')],
    ['C5x a page whose script throws', { path: 'throws.html' }, undefined, (r) => assert.equal(r.line.shot.anchor, 'found')],
    ['C8d a page that alerts', { path: 'alert.html' }, undefined, (r) => assert.equal(r.line.shot.anchor, 'found')],
  ], async ([what, o, frame, check]) => {
    const r = await k.readyOn(k.subject(o), { frame });
    assert.equal(r.status, 0, `${what}: ${said(r)}`);
    try { check(r, k.light(r)); } catch (e) { e.message = `${what}: ${e.message}`; throw e; }
  });
});

test('C5 the state of the spot, and the view it is on', async () => {
  const k = shotKit();
  const tab = { w: 1400, h: 860, hash: '#tab2' };
  const green = (r, p) => assert.ok(near(p.px(40, 20), [0, 170, 0]), String(p.px(40, 20)));
  await each([
    ['C5b', k.subject({ path: 'changed.html' }), undefined, 'changed', (r) => assert.match(r.out, /text "Start free trial"/)],
    ['C5c', k.subject({ path: 'details.html' }), undefined, 'found', (r, p) => assert.deepEqual([p.w, p.h], [320, 200])],
    ['C5d', k.subject({ path: 'tabs-js.html' }), undefined, 'hidden', (r, p) => assert.ok(ringAt(p, MIDDLE))],
    ['C5e', k.subject({ path: 'gone.html' }), undefined, 'gone', (r, p) => assert.ok(ringAt(p, MIDDLE))],
    ['C5f', k.pointNote(), undefined, 'point', (r, p) => assert.deepEqual([p.w, p.h], [480, 320])],
    ['C5g #tab2', k.subject({ path: 'tabs.html' }), tab, 'found', () => {}],
    ['C5g none', k.subject({ path: 'tabs.html' }), { ...tab, hash: '' }, 'hidden', () => {}],
    ['C5h no frame', k.pointNote({ path: 'tabs.html#tab2' }), undefined, 'point', green],
    ['C5h a frame with no hash', k.pointNote({ path: 'tabs.html#tab2' }), { ...tab, hash: '' }, 'point', green],
  ], async ([what, s, frame, state, check]) => {
    const r = await k.readyOn(s, { frame });
    assert.equal(r.status, 0, `${what}: ${said(r)}`);
    assert.equal(r.line.shot.anchor, state, what);
    try { check(r, k.light(r)); } catch (e) { e.message = `${what}: ${e.message}`; throw e; }
  });
});

test('C6a a page with dark styles has a dark picture', async () => {
  const k = shotKit();
  const r = await k.readyOn(k.subject({ path: 'dark.html' }));
  assert.equal(r.status, 0, said(r));
  const { shot } = r.line;
  assert.equal(shot.dark, true);
  const dark = fs.readFileSync(path.join(k.shots, r.id, `${shot.stamp}-dark.png`));
  assert.equal(shot.sum.dark, sha256(dark));
  assert.ok(near(png(dark).px(20, 20), [0x11, 0x11, 0x11]));
  assert.ok(near(k.light(r).px(20, 20), [255, 255, 255]));
  assert.ok(ringAt(png(dark), MIDDLE));
  assert.match(r.stdout, /-light\.png \(and -dark\.png\)/);
});

test('C15b the page is not trusted with what is printed or recorded', async () => {
  const k = shotKit();
  const r = await k.readyOn(k.subject({ path: 'hostile.html' }));
  assert.equal(r.status, 0, said(r));
  const text = JSON.parse(/text (".*")$/m.exec(r.stdout)[1]);
  assert.ok([...text].length <= 80 && text.includes('[link removed]'), text);
  assert.ok(!r.stdout.includes('\u202e') && !r.stdout.includes('abcdefghijklmnop'));
  const bad = await k.readyOn(k.subject({ path: 'badstate.html' }));
  assert.equal(bad.status, 1);
  assert.match(bad.out, /the page answered the picture with something else/);
  assert.equal(bad.line, undefined);
  assert.deepEqual(k.files(bad.id), []);
});

test('the pictures go only in their own folder: a symlinked one is refused', async () => {
  const k = shotKit();
  const id = await k.note(k.subject());
  const away = fs.mkdtempSync(path.join(TMP, 'away'));
  fs.mkdirSync(k.shots, { recursive: true });
  fs.symlinkSync(away, path.join(k.shots, id));
  const r = await k.ready(id);
  assert.equal(r.status, 1, said(r));
  assert.equal(r.line, undefined);
  assert.deepEqual(fs.readdirSync(away), []);
  fs.unlinkSync(path.join(k.shots, id));
});

test('C5y two captures at once', async () => {
  const k = shotKit();
  const ids = [await k.note(k.subject()), await k.note(k.subject())];
  const hooks = [seenFile(), seenFile()];
  const rs = await Promise.all(ids.map((id, i) => k.ready(id, { DEVTEAM_TEST_SHOT_SEEN: hooks[i] })));
  for (const r of rs) assert.equal(r.status, 0, said(r));
  const of = (i, re) => k.seen(hooks[i]).map((l) => re.exec(l)?.[1]).filter(Boolean);
  for (const re of [/ profile=(.*)$/, /^continue (http:\/\/127\.0\.0\.1:\d+)/]) assert.equal(of(0, re).filter((x) => of(1, re).includes(x)).length, 0, String(re));
  for (const r of rs) { assert.deepEqual(k.files(r.id), [`${r.line.shot.stamp}-light.png`]); assert.equal(r.line.shot.sum.light, sha256(lit(k, r))); }
});

test('a thread resolved while its picture is taken gets no proposal', async () => {
  const k = shotKit();
  const id = await k.note(k.subject({ path: 'slow.html' }));
  const going = k.ready(id);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal((await k.run(['thread', 'resolve', id])).status, 0);
  const r = await going;
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /is resolved/);
  assert.equal(r.line, undefined);
  assert.deepEqual(k.files(id), []);
});

// --- which copy is pictured ---------------------------------------------------------------------------
// a session's worktree with its own copy of an artifact, committed
function worktree(k, name, slug, label) {
  const root = path.join(k.F.old, '.worktrees', name);
  if (!fs.existsSync(root)) k.F.g(['worktree', 'add', '-q', '-b', name, root], k.F.old);
  const dir = path.join(root, 'docs/devteam/project/artifacts', slug);
  write(path.join(dir, 'artifact.json'), '{"v":1,"title":"A page","summary":"A page","by":"supervisor"}\n');
  write(path.join(dir, 'index.html'), `<!doctype html><button id="buy">${label}</button>\n`);
  k.F.g(['add', '-A'], root);
  k.F.g(['commit', '-qm', `${slug}: ${label}`], root);
  return { root, dir, head: () => k.F.g(['rev-parse', 'HEAD'], root), remove: () => { k.F.g(['worktree', 'remove', '--force', root], k.F.old); k.F.g(['branch', '-D', name], k.F.old); } };
}
const pageNote = (k, o = {}) => k.subject({ path: 'index.html', ...o });
// a note the owner handed over and a session marked addressed, as kit-144 will write it
let marks = 0;
async function addressed(k, s, by, extra = {}) {
  const id = await k.note(s);
  // after the note's own turn, which the hand-over must follow
  await new Promise((r) => setTimeout(r, 100));
  k.F.hand('owner', { type: 'thread', op: 'set', id, handed: { to: by, at: new Date(Date.now() - 20).toISOString() } }, 20);
  const m = `m-20261123-${String(++marks).padStart(9, '0')}-${by}`;
  k.F.hand(by, { id: m, type: 'message', to: 'owner', kind: 'addressed', thread: id, text: 'The button now says Annual', ...extra }, 0);
  return id;
}

test('C4a C4e main first, never a stale checkout', async () => {
  const k = shotKit();
  const old = worktree(k, 'kit-1-old', 'pricing', 'Old');
  const chore = worktree(k, 'chore-artifact-pricing', 'pricing', 'Chore');
  try {
    for (const [what, s] of [['C4a', pageNote(k)], ['C4e', pageNote(k, { at: 'chore-artifact-pricing' })]]) {
      const r = await k.readyOn(s);
      assert.equal(r.status, 0, said(r));
      assert.match(r.out, /text "Main"/, what);
      const { src, sha, dirty } = r.line.shot;
      assert.deepEqual({ src, sha, dirty }, { src: 'main', sha: k.F.g(['rev-parse', 'origin/main'], k.F.old), dirty: false }, what);
      assert.deepEqual((await k.show(r.id)).source, { at: 'main', slug: 'pricing' }, what);
    }
  } finally { old.remove(); chore.remove(); }
});

test('C4b C4d a draft alone: pictured from it, then main once it is gone', async () => {
  const k = shotKit();
  const wt = worktree(k, 'chore-artifact-drafty', 'drafty', 'Chore');
  const s = () => pageNote(k, { slug: 'drafty', at: 'chore-artifact-drafty' });
  const r = await k.readyOn(s());
  assert.equal(r.status, 0, said(r));
  assert.match(r.out, /text "Chore"/);
  const { src, sha, dirty } = r.line.shot;
  assert.deepEqual({ src, sha, dirty }, { src: 'chore-artifact-drafty', sha: wt.head(), dirty: false });
  assert.deepEqual((await k.show(r.id)).source, { at: 'chore-artifact-drafty', slug: 'drafty' });
  fs.writeFileSync(path.join(wt.dir, 'index.html'), '<!doctype html><button id="buy">Chore edited</button>\n');
  const d = await k.readyOn(s());
  assert.match(d.out, /text "Chore edited"/);
  assert.equal(d.line.shot.dirty, true);
  fs.cpSync(wt.dir, path.join(k.arts, 'drafty'), { recursive: true });
  k.F.g(['add', '-A'], k.F.old);
  k.F.g(['commit', '-qm', 'drafty lands'], k.F.old);
  k.F.g(['push', '-q', 'origin', 'main'], k.F.old);
  assert.equal((await k.show(r.id)).source.at, 'chore-artifact-drafty', 'landed, the worktree kept');
  wt.remove();
  assert.deepEqual((await k.show(r.id)).source, { at: 'main', slug: 'drafty' });
});

test('C4c C4f an addressed mark\'s draft is what Show me opens, and what a ready over it pictures', async () => {
  const k = shotKit();
  const chore = worktree(k, 'chore-artifact-pricing', 'pricing', 'Chore');
  const id = await addressed(k, pageNote(k), 'supervisor', { draft: 'chore-artifact-pricing' });
  assert.equal((await k.show(id)).check, 'addressed');
  assert.deepEqual((await k.show(id)).source, { at: 'chore-artifact-pricing', slug: 'pricing' });
  const r = await k.ready(id);
  assert.equal(r.status, 0, said(r));
  assert.equal(r.line.shot.src, 'chore-artifact-pricing');
  assert.match(r.out, /text "Chore"/);
  chore.remove();
  assert.deepEqual((await k.show(id)).source, { at: 'main', slug: 'pricing' });
  const plain = await k.show(await k.note(pageNote(k)));
  assert.equal(plain.source, null, 'nothing to check, no source');
});

// --- withdrawing a mark -------------------------------------------------------------------------------
const REASON = 'The picture shows the old button';
const unready = (k, id, reason = REASON, extra = { DEVTEAM_ROLE: 'supervisor' }) => k.run(['thread', 'unready', id, '--reason', reason], extra);
const toldOf = (k, id) => k.lines().filter((o) => o.type === 'message' && o.kind === 'info' && o.thread !== undefined && String(o.text).includes(id));

test('C11a C11d thread unready over a proposal, once', async () => {
  const k = shotKit();
  const { id, line } = await k.readyOn(k.subject());
  assert.ok(line);
  const r = await unready(k, id);
  assert.equal(r.status, 0, said(r));
  const w = k.last((o) => o.type === 'thread' && o.op === 'set' && o.id === id);
  assert.equal(w.by, 'supervisor');
  assert.equal(w.ready, null);
  assert.deepEqual(Object.keys(w.unready).sort(), ['at', 'reason']);
  assert.equal(w.unready.reason, REASON);
  const v = await k.show(id);
  assert.deepEqual([v.check, v.ready, v.source, v.unready.reason], [null, null, null, REASON]);
  const was = k.logBytes();
  const again = await unready(k, id);
  assert.equal(again.status, 1);
  assert.ok(again.out.includes(`${id} has nothing to check: no proposal or addressed mark stands`), said(again));
  assert.equal(k.logBytes(), was);
});

test('C11b the session whose mark is withdrawn is told; the supervisor is not', async () => {
  const k = shotKit();
  const theirs = await addressed(k, k.subject(), 'plan-pricing');
  const r = await unready(k, theirs);
  assert.equal(r.status, 0, said(r));
  const told = toldOf(k, theirs);
  assert.equal(told.length, 1);
  assert.deepEqual([told[0].by, told[0].to], ['supervisor', 'plan-pricing']);
  assert.equal(told[0].text, `Your mark on ${theirs} was withdrawn: ${REASON}. Fix it and mark it again: devteam.mjs artifact notes pricing.`);
  assert.match(r.stdout, /plan-pricing/);
  assert.equal((await k.show(theirs)).check, null);
  const own = await addressed(k, k.subject(), 'supervisor');
  const r2 = await unready(k, own);
  assert.equal(r2.status, 0, said(r2));
  assert.ok(r2.stdout.includes(`withdrew your own mark on ${own}`), said(r2));
  assert.deepEqual(toldOf(k, own), []);
});

test('C11c each refusal of thread unready, and no line', async () => {
  const k = shotKit();
  const fresh = await k.note(k.subject());
  const { id } = await k.readyOn(k.subject());
  const was = k.logBytes();
  for (const [what, at, reason, env, want] of [
    ['nothing to check', fresh, REASON, undefined, /has nothing to check: no proposal or addressed mark stands/],
    ['11 bytes', id, 'Too short!!', undefined, /--reason is 12 to 300 bytes/],
    ['301 bytes', id, 'x'.repeat(301), undefined, /--reason is 12 to 300 bytes/],
    ['a newline', id, 'The picture\nshows the old one', undefined, /--reason is one line/],
    ['none', id, '', undefined, /--reason is 12 to 300 bytes/],
    ['a worker', id, REASON, { DEVTEAM_ROLE: 'worker' }, /thread unready: the supervisor does this/],
    ['a planner', id, REASON, { DEVTEAM_FEATURE: 'pricing' }, /thread unready: the supervisor does this/],
    ['no thread', 't-20990101-000000000-owner', REASON, undefined, /no thread/],
  ]) {
    const r = await unready(k, at, reason, env);
    assert.equal(r.status, 1, what);
    assert.match(r.out, want, what);
    assert.ok(!/usage:/.test(r.out), what);
    assert.equal(k.logBytes(), was, what);
  }
});

// --- the dashboard ------------------------------------------------------------------------------------
test('C12 the picture, the source and their freshness on the dashboard', async () => {
  const k = shotKit();
  const r = await k.readyOn(k.subject());
  const wt = worktree(k, 'chore-artifact-gone', 'gone', 'Chore');
  const landing = worktree(k, 'chore-artifact-landing', 'landing', 'Chore');
  const gone = await k.readyOn(pageNote(k, { slug: 'gone', at: 'chore-artifact-gone' }));
  const lands = await k.readyOn(pageNote(k, { slug: 'landing', at: 'chore-artifact-landing' }));
  for (const x of [r, gone, lands]) assert.equal(x.status, 0, said(x));
  const name = `${r.line.shot.stamp}-light.png`;
  const { dash, port } = await dashboardOnFreePort(k.F.old, k.childEnv());
  try {
    const at = `http://127.0.0.1:${port}`;
    const read = async (headers = {}) => { const a = await fetch(`${at}/api/threads`, { headers }); const b = a.status === 200 ? (await a.json()).threads : null; return { status: a.status, tag: a.headers.get('etag'), of: (id) => b.find((x) => x.id === id) }; };
    // C12a
    const first = await read();
    assert.deepEqual(first.of(r.id).source, { at: 'main', slug: 'pricing' });
    assert.deepEqual(first.of(r.id).shot, r.line.shot);
    assert.deepEqual(first.of(gone.id).source, { at: 'chore-artifact-gone', slug: 'gone' });
    // C12b
    const shot = (p, headers = {}) => new Promise((resolve, reject) => { const q = http.request({ host: '127.0.0.1', port, path: p, headers }, (res) => { const got = []; res.on('data', (b) => got.push(b)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(got) })); }); q.on('error', reject); q.end(); });
    const ok = await shot(`/shot/${r.id}/${name}`);
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.headers['content-type'], ok.headers['cache-control'], ok.headers['x-content-type-options'], ok.headers['cross-origin-resource-policy']], ['image/png', 'no-store', 'nosniff', 'same-origin']);
    assert.equal(sha256(ok.body), r.line.shot.sum.light);
    // C12c
    for (const [site, want] of [['cross-site', 403], ['same-site', 403], ['none', 403], ['same-origin', 200]]) assert.equal((await shot(`/shot/${r.id}/${name}`, { 'sec-fetch-site': site })).status, want, site);
    // C12d
    const dir = path.join(k.shots, r.id);
    fs.symlinkSync(name, path.join(dir, '20990101-000000000-light.png'));
    const linked = await k.note(k.subject());
    fs.symlinkSync(dir, path.join(k.shots, linked));
    write(path.join(k.shots, 'x-1', name), 'x');
    write(path.join(dir, `${r.line.shot.stamp}-light.jpg`), 'x');
    for (const p of [`/shot/${r.id}/../x/${name}`, `/shot/${r.id}%2F${name}`, `/shot/${r.id}/..%2F${r.id}%2F${name}`, `/shot/${r.id}/${r.line.shot.stamp}-light.jpg`, `/shot/x-1/${name}`, `/shot/${r.id}/20990101-000000000-light.png`, `/shot/${linked}/${name}`, `/shot/${r.id}/${r.line.shot.stamp}-dark.png`, `/shot/${r.id}/`]) assert.equal((await shot(p)).status, 404, p);
    for (const f of [path.join(dir, '20990101-000000000-light.png'), path.join(k.shots, linked), path.join(dir, `${r.line.shot.stamp}-light.jpg`)]) fs.unlinkSync(f);
    // C12e: no log line is written from here on
    const was = k.logBytes();
    const held = await read();
    assert.equal((await read({ 'if-none-match': held.tag })).status, 304, 'nothing changed');
    wt.remove();
    const after = await read({ 'if-none-match': held.tag });
    assert.equal(after.status, 200, 'a removed worktree is seen');
    assert.equal(after.of(gone.id).source, null);
    fs.cpSync(landing.dir, path.join(k.arts, 'landing'), { recursive: true });
    k.F.g(['add', '-A'], k.F.old);
    k.F.g(['commit', '-qm', 'landing lands'], k.F.old);
    k.F.g(['push', '-q', 'origin', 'main'], k.F.old);
    assert.equal((await read()).of(lands.id).source.at, 'chore-artifact-landing');
    landing.remove();
    assert.deepEqual((await read({ 'if-none-match': after.tag })).of(lands.id).source, { at: 'main', slug: 'landing' });
    assert.equal(k.logBytes(), was);
  } finally { await dash.stop(); }
});
