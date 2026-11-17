// The kit's upload routes (devteam.mjs) and the naming rules they share with the cloud gateway.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
// the suite's shared env scrub, tmux shim and stand-ins (before anything that reads the environment)
import { bareProject, dashboardOnFreePort } from './lib/kit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const kit = path.resolve(here, '..', 'docs', 'devteam');
// ports of its own, apart from the blocks lib/kit.mjs hands out (20000 and up); set after its import, so these win
const PORTS = 10000 + (process.pid % 90) * 100;
const HUB = PORTS;
const P = PORTS + 1;
process.env.DEVTEAM_HUB_PORT = String(HUB);
process.env.DEVTEAM_PORT_BASE = String(P);
process.env.DEVTEAM_HUB_RETRY_MS = '500';
delete process.env.DEVTEAM_CLAIM_TOKEN;
const G = await import('../cloud/gateway.mjs');

// --- the shared upload rules ---------------------------------------------------------------------
// The kit's copy of the rules, loaded from the script by itself (as modelFns loads its block).
function rulesFromKit() {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const i = src.indexOf('/* upload rules start */'), j = src.indexOf('/* upload rules end */');
  assert.ok(i >= 0 && j > i, 'the markers are missing: the upload rules block in devteam.mjs');
  return vm.runInContext(`${src.slice(i, j)}\n;({ UPLOAD_RULES, safeUploadName, shellQuote, dropPaste, isDropImage, dropSpace })`, vm.createContext({}));
}

const NAMES = [
  '../../etc/passwd', '..\\..\\windows\\system.ini', '..', '.', '', '.bashrc', '/',
  'a\u0000b\n\r\u001b[31m.PNG', '$(rm -rf ~).txt', '`id`;x\'y".pdf', '--help.txt',
  'café ‮evil.JPG', '日本語.png', 'archive.tar.GZ', 'no-extension', 'dots....', 'x.has spaces in ext',
  '.part', 'a'.repeat(300) + '.png', 'b'.repeat(250), 'x.' + 'y'.repeat(20), '....png', 'Ünïcödé.WEBP', 'a/b\\c.txt', '%2e%2e.txt', ' ', '.jpeg', 'A B.png', 'file.PDF', 'tab\there.txt',
];
const PATHS = [['/u/a.png'], ['/u/a.png', '/u/b.pdf'], ["/u/it's.txt"], ['/u/a.JPEG', '/u/b.webp'], ['/u/a.gif', '/u/a.jpg', '/u/a.pngx'], ['/u/a b.txt', '/u/$x.txt', '/u/me@x.txt']];
const plain = (r) => ({ ...r, folder: { source: r.folder.source, flags: r.folder.flags } });

test('the upload rules: devteam.mjs\'s copy equals the gateway\'s (A8)', () => {
  const K = rulesFromKit();
  assert.deepEqual(plain(K.UPLOAD_RULES), plain(G.UPLOAD_RULES));
  for (const raw of NAMES) assert.equal(K.safeUploadName(raw), G.safeUploadName(raw), JSON.stringify(raw));
  for (const p of PATHS) {
    assert.equal(K.dropPaste(p), G.dropPaste(p), JSON.stringify(p));
    assert.equal(K.dropSpace(p), G.dropSpace(p), JSON.stringify(p));
    for (const x of p) { assert.equal(K.isDropImage(x), G.isDropImage(x), x); assert.equal(K.shellQuote(x), G.shellQuote(x), x); }
  }
});

// --- the laptop's upload route (the dashboard server) ------------------------------------------
const R = rulesFromKit().UPLOAD_RULES;
const ON_A_BOX = fs.existsSync('/opt/devteam/gateway.mjs');
// The folder a laptop keeps a project's dropped files in, worked out here as the spec says.
function expectedFolder(root) {
  const real = fs.realpathSync(root);
  return `${path.basename(real).replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 40)}-${crypto.createHash('sha256').update(real).digest('hex').slice(0, 8)}`;
}
const ourFolders = (dir) => { try { return fs.readdirSync(dir).filter((n) => R.folder.test(n)).sort(); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } };
const newFolderName = (day = new Date().toISOString().slice(0, 10)) => `${day}-${crypto.randomBytes(12).toString('hex')}`;

// One request, any shape: a body sent whole, in chunks (no Content-Length: chunked), or held back
// (`hold`: what's declared never comes). Resolves with the answer, or how the connection ended, or
// { timedOut } after `within` ms. Headers set to null are left out.
function request(port, route, { headers = {}, body = null, chunks = null, gapMs = 50, hold = false, within = 20000 } = {}) {
  return new Promise((resolve) => {
    const h = {};
    for (const [k, v] of Object.entries(headers)) if (v !== null && v !== undefined) h[k] = v;
    if (body !== null) h['content-length'] = String(Buffer.byteLength(body));
    const t0 = Date.now();
    const r = http.request({ host: '127.0.0.1', port, path: route, method: 'POST', headers: h, agent: false });
    let done = false;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); r.destroy(); resolve({ ms: Date.now() - t0, ...v }); };
    const timer = setTimeout(() => finish({ timedOut: true }), within);
    r.on('response', (res) => {
      const bufs = [];
      res.on('data', (b) => bufs.push(b));
      res.on('end', () => { const text = Buffer.concat(bufs).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch {} finish({ status: res.statusCode, headers: res.headers, text, json }); });
      res.on('error', (e) => finish({ error: e.code ?? e.message }));
    });
    r.on('error', (e) => finish({ error: e.code ?? e.message }));
    if (chunks) {
      (async () => {
        for (const c of chunks) { if (done) return; r.write(c); await new Promise((w) => setTimeout(w, gapMs)); }
        if (!hold && !done) r.end();
      })();
    } else if (hold) r.flushHeaders();
    else r.end(body ?? undefined);
  });
}

// A real dashboard on a throwaway HOME and a project of its own. extraEnv: a value of undefined unsets it.
async function laptop(t, extraEnv = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-attach-'));
  const home = path.join(base, 'home');
  fs.mkdirSync(home);
  const env = { ...process.env, HOME: home, DEVTEAM_BOX: 'off', DEVTEAM_HUB_PORT: String(PORTS + 60), DEVTEAM_PORT_BASE: String(PORTS + 61), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_HOME', 'DEVTEAM_GATEWAY', 'DEVTEAM_UPLOADS_DIR', 'DEVTEAM_UPLOAD_MAX', 'DEVTEAM_UPLOAD_TOTAL', 'DEVTEAM_UPLOAD_FREE', 'DEVTEAM_UPLOAD_STALL_MS', 'TMUX', 'TMUX_PANE']) delete env[k];
  for (const [k, v] of Object.entries(extraEnv)) { if (v === undefined) delete env[k]; else env[k] = v; }
  let dash = null;
  t.after(async () => { await dash?.stop(); fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const root = bareProject(base, 'attach');
  const started = await dashboardOnFreePort(root, env);
  dash = started.dash;
  const port = started.port;
  const folder = () => path.join(home, '.devteam', 'uploads', expectedFolder(root));
  const own = { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' };
  const post = (name, body, headers = {}, how = {}) => request(port, `/upload?name=${encodeURIComponent(name)}`, { headers: { ...own, ...headers }, body, ...how });
  return { base, root, port, home, folder, post, stop: () => dash.stop(), out: () => dash.out() };
}
const LAPTOP = { timeout: 240000 };

test('laptop upload: the dashboard stores a dropped file in the project\'s own folder, 0700/0700/0600 (A4)', LAPTOP, async (t) => {
  const L = await laptop(t);
  const bytes = crypto.randomBytes(3000);
  const a = await L.post('../../a b.txt', bytes);
  assert.equal(a.status, 200, a.text);
  const folders = ourFolders(L.folder());
  assert.equal(folders.length, 1, String(folders));
  assert.equal(a.json.path, path.join(L.home, '.devteam/uploads', expectedFolder(L.root), folders[0], 'a-b.txt'));
  assert.equal(a.json.size, bytes.length);
  assert.deepEqual(fs.readFileSync(a.json.path), bytes);
  assert.equal(fs.statSync(L.folder()).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.dirname(a.json.path)).mode & 0o777, 0o700);
  assert.equal(fs.statSync(a.json.path).mode & 0o777, 0o600);
  // on localhost, with its own Origin
  const b = await L.post('../../a b.txt', Buffer.from('second'), { host: `localhost:${L.port}`, origin: `http://localhost:${L.port}` });
  assert.equal(b.status, 200, b.text);
  assert.equal(fs.readFileSync(b.json.path, 'utf8'), 'second');
  // the same name twice: two folders, neither file overwritten
  assert.notEqual(path.dirname(b.json.path), path.dirname(a.json.path));
  assert.equal(ourFolders(L.folder()).length, 2);
  assert.deepEqual(fs.readFileSync(a.json.path), bytes);
});

test('laptop upload: each refusal comes before a byte of the body is read, with its reason (A5)', LAPTOP, async (t) => {
  const L = await laptop(t);
  const own = `127.0.0.1:${L.port}`;
  const cases = [
    ['Host evil.example', { host: `evil.example:${L.port}`, origin: `http://evil.example:${L.port}` }],
    ['Origin evil.example', { origin: 'http://evil.example' }],
    ['no Origin', { origin: null }],
    ['Sec-Fetch-Site cross-site', { 'sec-fetch-site': 'cross-site' }],
    ['Sec-Fetch-Site same-site', { 'sec-fetch-site': 'same-site' }],
    ['no Sec-Fetch-Site', { 'sec-fetch-site': null }],
    ['Origin localhost on Host 127.0.0.1', { host: own, origin: `http://localhost:${L.port}` }],
  ];
  for (const [what, headers] of cases) {
    const r = await L.post('a.txt', null, { ...headers, 'content-length': '1048576' }, { hold: true, within: 2000 });
    assert.ok(!r.timedOut, `${what}: no answer in 2 s (the body was waited for)`);
    assert.equal(r.status, 403, `${what}: ${r.status ?? r.error} ${r.text ?? ''}`);
    assert.ok(r.text.trim().length > 0, `${what}: a reason`);
    if (what !== 'Host evil.example') assert.match(r.json?.error ?? '', /dropped files only from this dashboard's own page/, what);
  }
  assert.deepEqual(ourFolders(L.folder()), []);
});

test('laptop upload: on a box (DEVTEAM_GATEWAY set) the route is off (A6)', LAPTOP, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-attach-box-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const L = await laptop(t, { DEVTEAM_GATEWAY: '1', DEVTEAM_UPLOADS_DIR: dir });
  const r = await L.post('a.txt', Buffer.from('hello'));
  assert.equal(r.status, 404, r.text);
  assert.match(r.json?.error ?? '', /gateway takes dropped files/);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.deepEqual(ourFolders(L.folder()), []);
});

test('laptop upload: a declared size over the limit is 413; a root that is a link or open to others is 503 (A7)', LAPTOP, async (t) => {
  const L = await laptop(t);
  const big = await L.post('a.bin', null, { 'content-length': String(R.max + 1) }, { hold: true, within: 2000 });
  assert.equal(big.status, 413, big.text ?? big.error);
  assert.match(big.json?.error ?? '', new RegExp(`${Math.floor(R.max / 1048576)} MB`));
  // a first upload makes the root; then it's made open to others, then replaced by a link
  assert.equal((await L.post('a.txt', Buffer.from('x'))).status, 200);
  const root = L.folder();
  fs.chmodSync(root, 0o777);
  const open = await L.post('a.txt', Buffer.from('x'));
  assert.equal(open.status, 503, open.text);
  assert.match(open.json?.error ?? '', /no folder for dropped files: ./);
  fs.chmodSync(root, 0o700);
  const elsewhere = path.join(L.base, 'elsewhere');
  fs.mkdirSync(elsewhere, { mode: 0o700 });
  fs.renameSync(root, `${root}-moved`);
  fs.symlinkSync(elsewhere, root);
  const link = await L.post('a.txt', Buffer.from('x'));
  assert.equal(link.status, 503, link.text);
  assert.match(link.json?.error ?? '', /no folder for dropped files: ./);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
});

test('laptop upload: the cap while streaming, and the stall timer (A7, the test-only override)', LAPTOP, async (t) => {
  const L = await laptop(t, { DEVTEAM_UPLOAD_MAX: '1024', DEVTEAM_UPLOAD_STALL_MS: '300' });
  const over = await L.post('a.bin', null, {}, { chunks: [crypto.randomBytes(800), crypto.randomBytes(800)] });
  assert.equal(over.status, 413, over.text ?? over.error);
  assert.deepEqual(ourFolders(L.folder()), []);
  // what was refused holds nothing back: the next upload goes in
  const small = await L.post('a.bin', crypto.randomBytes(10));
  assert.equal(small.status, 200, small.text);
  const exact = await L.post('b.bin', crypto.randomBytes(1024));
  assert.equal(exact.status, 200, exact.text);
  assert.equal(exact.json.size, 1024);
  const before = ourFolders(L.folder());
  const stalled = await L.post('c.bin', null, {}, { chunks: [crypto.randomBytes(10)], hold: true, within: 3000 });
  assert.ok(!stalled.timedOut, 'a stalled upload\'s connection is closed within 3 s');
  assert.ok(stalled.error || stalled.status >= 400, JSON.stringify(stalled));
  // its folder goes as the request does: wait a moment for the clean-up after the close
  for (let i = 0; i < 20 && ourFolders(L.folder()).length !== before.length; i++) await new Promise((w) => setTimeout(w, 50));
  assert.deepEqual(ourFolders(L.folder()), before);
});

test('laptop upload: the override is ignored without DEVTEAM_BOX=off (A7)', { ...LAPTOP, skip: ON_A_BOX && 'a box: without DEVTEAM_BOX=off the route is off; CI runs it' }, async (t) => {
  const L = await laptop(t, { DEVTEAM_BOX: undefined, DEVTEAM_UPLOAD_MAX: '1024' });
  const r = await L.post('a.bin', crypto.randomBytes(2048));
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.size, 2048);
});

test('laptop upload: an override never raises a limit (A7)', LAPTOP, async (t) => {
  const L = await laptop(t, { DEVTEAM_UPLOAD_MAX: String(R.max * 2) });
  const r = await L.post('a.bin', null, { 'content-length': String(R.max + 1) }, { hold: true, within: 2000 });
  assert.equal(r.status, 413, r.text ?? r.error);
});

test('laptop upload: the sweep removes old, empty and cut-off folders of ours, and keeps the rest (A9)', LAPTOP, async (t) => {
  const L = await laptop(t);
  // a first upload makes the root
  assert.equal((await L.post('first.txt', Buffer.from('x'))).status, 200);
  const root = L.folder();
  const first = ourFolders(root)[0];
  const now = Date.now() / 1000;
  const seed = (name, files, ageS) => {
    const d = path.join(root, name);
    fs.mkdirSync(d, { mode: 0o700 });
    for (const f of files) { fs.writeFileSync(path.join(d, f), 'seeded'); if (ageS) fs.utimesSync(path.join(d, f), now - ageS, now - ageS); }
    if (ageS) fs.utimesSync(d, now - ageS, now - ageS);
    return name;
  };
  const old = seed(newFolderName('2026-01-01'), ['x.txt'], R.keepMs / 1000 + 60);
  const stalePart = seed(newFolderName(), [R.part], R.stallMs / 1000 + 1);
  const empty = seed(newFolderName(), [], 0);
  const fresh = seed(newFolderName(), ['y.txt'], 60);
  const freshPart = seed(newFolderName(), [R.part], 0);
  const notOurs = seed('not-ours', ['z.txt'], R.keepMs / 1000 + 60);
  const r = await L.post('next.txt', Buffer.from('next'));
  assert.equal(r.status, 200, r.text);
  const made = path.basename(path.dirname(r.json.path));
  assert.deepEqual(fs.readdirSync(root).sort(), [first, fresh, freshPart, made, notOurs].sort());
  for (const gone of [old, stalePart, empty]) assert.ok(!fs.existsSync(path.join(root, gone)), gone);
});

test('laptop upload: past the total kept, the next upload is 507 (A10)', LAPTOP, async (t) => {
  const L = await laptop(t);
  assert.equal((await L.post('first.txt', Buffer.from('x'))).status, 200);
  const d = path.join(L.folder(), newFolderName());
  fs.mkdirSync(d, { mode: 0o700 });
  // its apparent size only: a sparse file uses no disk
  fs.writeFileSync(path.join(d, 'big.bin'), '');
  fs.truncateSync(path.join(d, 'big.bin'), R.total);
  const r = await L.post('a.txt', Buffer.from('x'));
  assert.equal(r.status, 507, r.text);
  assert.match(r.json?.error ?? '', /already holds/);
});
