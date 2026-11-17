// The kit's upload routes (devteam.mjs) and the naming rules they share with the cloud gateway.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
// the suite's shared env scrub, tmux shim and stand-ins (before anything that reads the environment)
import { bareProject, dashboardOnFreePort, hasTmux, threadsFixture, until } from './lib/kit.mjs';

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
function request(port, route, { method = 'POST', headers = {}, body = null, chunks = null, gapMs = 50, hold = false, within = 20000 } = {}) {
  return new Promise((resolve) => {
    const h = {};
    for (const [k, v] of Object.entries(headers)) if (v !== null && v !== undefined) h[k] = v;
    if (body !== null) h['content-length'] = String(Buffer.byteLength(body));
    const t0 = Date.now();
    const r = http.request({ host: '127.0.0.1', port, path: route, method, headers: h, agent: false });
    let done = false;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); r.destroy(); resolve({ ms: Date.now() - t0, ...v }); };
    const timer = setTimeout(() => finish({ timedOut: true }), within);
    r.on('response', (res) => {
      const bufs = [];
      res.on('data', (b) => bufs.push(b));
      res.on('end', () => { const bytes = Buffer.concat(bufs); const text = bytes.toString('utf8'); let json = null; try { json = JSON.parse(text); } catch {} finish({ status: res.statusCode, headers: res.headers, text, body: text, bytes, json }); });
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
  // a GET as the dashboard's own page sends one: same-origin, and no Origin
  const get = (route, headers = {}, method = 'GET') => request(port, route, { method, headers: { host: own.host, 'sec-fetch-site': 'same-origin', ...headers } });
  // a command in the project, as the owner (no DEVTEAM_ROLE) unless the env says otherwise
  const dt = (args, more = {}) => spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: root, env: { ...env, ...more }, encoding: 'utf8', timeout: 120000 });
  // an owner action, as the dashboard's own page posts it
  const api = (name, body) => request(port, `/api/${name}`, { headers: { host: own.host, origin: own.origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { base, root, port, home, env, folder, post, get, dt, api, stop: () => dash.stop(), out: () => dash.out() };
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
  // every check runs before the root is made: not even the project's folder exists
  assert.ok(!fs.existsSync(L.folder()), 'the root was made before the checks');
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
  // an empty folder goes once it has been empty for UPLOAD_STALL_MS; a fresh one may be another dashboard's, about to take its .part
  const empty = seed(newFolderName(), [], R.stallMs / 1000 + 1);
  const freshEmpty = seed(newFolderName(), [], 0);
  const fresh = seed(newFolderName(), ['y.txt'], 60);
  const freshPart = seed(newFolderName(), [R.part], 0);
  const notOurs = seed('not-ours', ['z.txt'], R.keepMs / 1000 + 60);
  const r = await L.post('next.txt', Buffer.from('next'));
  assert.equal(r.status, 200, r.text);
  const made = path.basename(path.dirname(r.json.path));
  assert.deepEqual(fs.readdirSync(root).sort(), [first, fresh, freshPart, freshEmpty, made, notOurs].sort());
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

test('laptop upload: a failure after the body is read is still answered, 500, and stores nothing (A7, step 8)', LAPTOP, async (t) => {
  const L = await laptop(t);
  assert.equal((await L.post('first.txt', Buffer.from('x'))).status, 200);
  const before = ourFolders(L.folder());
  // A real failure after the read: while the body streams, the new folder is made read-only, so the
  // .part (already open) takes the bytes but the rename into the stored name is refused (EACCES).
  const p = L.post('a.txt', null, {}, { chunks: [Buffer.from('first half '), Buffer.from('second half')], gapMs: 800, within: 10000 });
  let made = null;
  for (let i = 0; i < 100 && !made; i++) { made = ourFolders(L.folder()).find((n) => !before.includes(n)) ?? null; if (!made) await new Promise((w) => setTimeout(w, 10)); }
  assert.ok(made, 'the upload\'s folder appeared');
  const dir = path.join(L.folder(), made);
  // wait for the .part, then lock the folder before the second chunk and the end
  for (let i = 0; i < 100 && !fs.existsSync(path.join(dir, R.part)); i++) await new Promise((w) => setTimeout(w, 10));
  fs.chmodSync(dir, 0o500);
  // given back here, not in an after hook: the fixture's own hook (first) removes the base
  let r;
  try { r = await p; } finally { fs.chmodSync(dir, 0o700); }
  assert.ok(!r.timedOut, 'no answer: a failure after the read went unanswered');
  assert.equal(r.status, 500, JSON.stringify(r));
  assert.match(r.json?.error ?? '', /could not store this file/);
  // the stored name never appeared
  assert.ok(!fs.existsSync(path.join(dir, 'a.txt')));
});

// --- the box: the gateway's routes on an instance's name ---------------------------------------
// A software authenticator, as the gateway's own tests have it (copied: a test file imports no other).
function cbor(v) {
  const head = (mt, n) => (n < 24 ? Buffer.from([(mt << 5) | n]) : n < 256 ? Buffer.from([(mt << 5) | 24, n]) : n < 65536 ? Buffer.from([(mt << 5) | 25, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(5); b[0] = (mt << 5) | 26; b.writeUInt32BE(n, 1); return b; })());
  if (v === false || v === true || v === null) return Buffer.from([v === false ? 0xf4 : v === true ? 0xf5 : 0xf6]);
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error(`cbor: ${typeof v}`);
}
const sha = (b) => crypto.createHash('sha256').update(b).digest();
const u = (b) => Buffer.from(b).toString('base64url');
function authenticator() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
  const id = crypto.randomBytes(16);
  let count = 0;
  return {
    id,
    create(opts, origin, { flags = 0x45, rpId = opts.rp.id } = {}) {
      this.userHandle = opts.user.id;
      const cd = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: opts.challenge, origin }));
      const len = Buffer.alloc(2); len.writeUInt16BE(id.length);
      const ad = Buffer.concat([sha(rpId), Buffer.from([flags]), Buffer.alloc(4), Buffer.alloc(16), len, id, cbor(cose)]);
      return { rawId: u(id), clientDataJSON: u(cd), attestationObject: u(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]))) };
    },
    get(opts, origin, { flags = 0x05, counter = 0, type = 'webauthn.get', key = privateKey, userHandle } = {}) {
      const cd = Buffer.from(JSON.stringify({ type, challenge: opts.challenge, origin }));
      const c = Buffer.alloc(4); c.writeUInt32BE(counter ?? ++count);
      const ad = Buffer.concat([sha(opts.rpId), Buffer.from([flags]), c]);
      const sig = crypto.sign('sha256', Buffer.concat([ad, sha(cd)]), key);
      return { rawId: u(id), clientDataJSON: u(cd), authenticatorData: u(ad), signature: u(sig), userHandle: userHandle ?? this.userHandle ?? null };
    },
  };
}

// A gateway on a localhost URL (the gateway test's fixture), claimed with a passkey, so its jar holds
// the owner's session. Its instance P (DEVTEAM_PORT_BASE, the first of its block) has nothing
// listening: a request the gateway proxies there gets 502. Its uploads root is <base>/uploads, 0750.
const freePort = () => new Promise((resolve, reject) => { const v = http.createServer(); v.on('error', reject); v.listen(0, '127.0.0.1', () => { const { port } = v.address(); v.close(() => resolve(port)); }); });
async function boxGateway(t, extra = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-attach-gw-'));
  const port = await freePort();
  const publicUrl = `http://box.localhost:${port}`;
  const inst = (p) => `http://${p}.box.localhost:${port}`;
  const term = `http://term.box.localhost:${port}`;
  const site = `http://public.box.localhost:${port}`;
  const ttydPage = path.join(base, 'ttyd.html');
  fs.writeFileSync(ttydPage, 'the gateway\'s copy of ttyd');
  const logs = [];
  const uploadsDir = path.join(base, 'uploads');
  fs.mkdirSync(uploadsDir, { mode: 0o750 });
  const g = G.createGateway({ publicUrl, dir: path.join(base, 'gw'), ttydPort: await freePort(), ttydPage, uploadsDir, log: (m) => logs.push(m), ...extra });
  await new Promise((r) => g.server.listen(port, '127.0.0.1', r));
  t.after(async () => { g.server.closeAllConnections?.(); await new Promise((r) => g.server.close(r)); fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const token = /claim#([A-Za-z0-9_-]+)/.exec(logs.join('\n'))?.[1];
  let jar = '';
  // on: 'term', 'public', 'box', or an instance's port (the default, P). Headers set to undefined are left out.
  const req = (method, route, { body, headers = {}, cookie = jar, on = P } = {}) => new Promise((resolve, reject) => {
    const self = on === 'box' ? publicUrl : on === 'term' ? term : on === 'public' ? site : inst(on);
    const h = { host: new URL(self).host, ...(method !== 'GET' && method !== 'HEAD' ? { origin: self, 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers };
    for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
    const r = http.request({ host: '127.0.0.1', port, method, path: route, headers: h, agent: false }, (res) => {
      const bufs = [];
      res.on('data', (c) => bufs.push(c));
      res.on('end', () => {
        const sc = res.headers['set-cookie']?.find((c) => c.startsWith('devteam_session='));
        if (sc) jar = sc.split(';')[0];
        const bytes = Buffer.concat(bufs);
        let j = null;
        try { j = JSON.parse(bytes.toString('utf8')); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, bytes, body: bytes.toString('utf8'), json: j });
      });
    });
    r.on('error', reject);
    r.end(body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body));
  });
  const o = await req('POST', '/auth/claim/options', { on: 'box', body: { token } });
  assert.equal(o.status, 200, o.body);
  const claimed = await req('POST', '/auth/claim/verify', { on: 'box', body: { token, ...authenticator().create(o.json, publicUrl) } });
  assert.equal(claimed.status, 200, claimed.body);
  return { g, port, base, publicUrl, inst, term, site, logs, req, uploadsDir, jar: () => jar };
}
// A dropped file sent as a page sends one, to an instance's name (P) unless `host` says otherwise.
// `origin` and `cookie` default to that name's own and the session; null leaves one out.
function boxUpload(gw, name, body, { host = gw.inst(P), origin = host, cookie = gw.jar(), chunks = null, gapMs = 50, within = 20000 } = {}) {
  return request(gw.port, `/upload?name=${encodeURIComponent(name)}`, { headers: { host: new URL(host).host, origin, cookie: cookie || null, 'content-type': 'application/octet-stream' }, body: chunks ? null : body, chunks, gapMs, within });
}
// The last two segments of a stored path: what GET /upload/<folder>/<name> takes.
const servedAt = (stored) => `/upload/${path.basename(path.dirname(stored))}/${path.basename(stored)}`;

test('box upload: an instance\'s name takes a dropped file, with the session and its own Origin (A1)', async (t) => {
  const gw = await boxGateway(t);
  const bytes = crypto.randomBytes(70000);
  const r = await boxUpload(gw, 'Shot 1.PNG', bytes);
  assert.equal(r.status, 200, r.text);
  assert.equal(path.dirname(path.dirname(r.json.path)), gw.uploadsDir);
  assert.match(r.json.path, /\/\d{4}-\d{2}-\d{2}-[0-9a-f]{24}\/Shot-1\.png$/);
  assert.equal(r.json.size, bytes.length);
  assert.deepEqual(fs.readFileSync(r.json.path), bytes);
});

test('box upload: no session is 401, any Origin but the instance\'s own is 403, each with its reason (A2)', async (t) => {
  const gw = await boxGateway(t);
  const bytes = Buffer.from('nope');
  const cases = [['no cookie', { cookie: null }, 401], ['no Origin', { origin: null }, 403], ['the terminal\'s Origin', { origin: gw.term }, 403], ['another instance\'s Origin', { origin: gw.inst(P + 1) }, 403], ['another site', { origin: 'https://evil.example' }, 403]];
  for (const [what, how, code] of cases) {
    const r = await boxUpload(gw, 'a.txt', bytes, how);
    assert.equal(r.status, code, `${what}: ${r.text}`);
    assert.ok(r.text.trim().length > 0, `${what}: a reason`);
    assert.deepEqual(fs.readdirSync(gw.uploadsDir), [], `${what}: no folder`);
  }
});

test('box upload: the box\'s own name and public. still take nothing; term. still does (A3)', async (t) => {
  const gw = await boxGateway(t);
  for (const host of [gw.publicUrl, gw.site]) {
    const r = await boxUpload(gw, 'a.txt', Buffer.from('x'), { host });
    assert.notEqual(r.status, 200, `${host}: ${r.text}`);
    assert.deepEqual(fs.readdirSync(gw.uploadsDir), [], `${host}: no folder`);
  }
  const r = await boxUpload(gw, 'a.txt', Buffer.from('x'), { host: gw.term });
  assert.equal(r.status, 200, r.text);
});

test('box upload: a failure after the body is read is still answered, 500, and stores nothing (step 8, task review T2-1)', async (t) => {
  const gw = await boxGateway(t);
  // as the laptop's case: the folder is made read-only while the body streams, so the rename is refused
  const p = boxUpload(gw, 'a.txt', null, { chunks: [Buffer.from('first half '), Buffer.from('second half')], gapMs: 800, within: 10000 });
  let made = null;
  for (let i = 0; i < 100 && !made; i++) { made = ourFolders(gw.uploadsDir)[0] ?? null; if (!made) await new Promise((w) => setTimeout(w, 10)); }
  assert.ok(made, 'the upload\'s folder appeared');
  const dir = path.join(gw.uploadsDir, made);
  for (let i = 0; i < 100 && !fs.existsSync(path.join(dir, R.part)); i++) await new Promise((w) => setTimeout(w, 10));
  fs.chmodSync(dir, 0o500);
  let r;
  try { r = await p; } finally { fs.chmodSync(dir, 0o750); }
  assert.ok(!r.timedOut, 'no answer: a failure after the read went unanswered');
  assert.equal(r.status, 500, JSON.stringify(r));
  assert.match(r.json?.error ?? '', /could not store this file/);
  assert.ok(!fs.existsSync(path.join(dir, 'a.txt')));
});

// What a served file must carry, whatever it is (spec §5).
function assertServed(r, want, bytes, what) {
  assert.equal(r.status, 200, `${what}: ${r.body}`);
  assert.equal(r.headers['content-type'], want.type, what);
  if (want.attachment) assert.equal(r.headers['content-disposition'], `attachment; filename="${want.name}"`, what);
  else assert.equal(r.headers['content-disposition'], undefined, `${what}: an image is shown, not saved`);
  assert.equal(r.headers['x-content-type-options'], 'nosniff', what);
  assert.equal(r.headers['content-security-policy'], 'sandbox', what);
  assert.equal(r.headers['cache-control'], 'no-store', what);
  assert.equal(r.headers['referrer-policy'], 'no-referrer', what);
  if (bytes) assert.deepEqual(r.bytes, bytes, `${what}: the bytes`);
}
const SERVED = [['a.png', 'image/png'], ['a.jpg', 'image/jpeg'], ['a.gif', 'image/gif'], ['a.webp', 'image/webp'], ['a.html'], ['a.svg'], ['a.pdf'], ['a.txt'], ['a.jpeg']].map(([name, type]) => ({ name, type: type ?? 'application/octet-stream', attachment: !type }));

test('box serve: a stored file comes back on an instance\'s name with its type, and never renders (C1)', async (t) => {
  const gw = await boxGateway(t);
  for (const want of SERVED) {
    const bytes = want.name === 'a.html' ? Buffer.from('<script>alert(1)</script>') : want.name === 'a.svg' ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>') : crypto.randomBytes(5000);
    const up = await boxUpload(gw, want.name, bytes);
    assert.equal(up.status, 200, up.text);
    assert.equal(path.basename(up.json.path), want.name);
    assertServed(await gw.req('GET', servedAt(up.json.path)), want, bytes, want.name);
    if (want.name === 'a.png') {
      const head = await gw.req('HEAD', servedAt(up.json.path));
      assertServed(head, want, null, 'HEAD');
      assert.equal(head.bytes.length, 0, 'HEAD: no body');
      assert.equal(head.headers['content-length'], String(bytes.length), 'HEAD: the size');
    }
  }
});

test('box serve: no session is 401 (a navigation goes to sign-in), and another site\'s image is 403 (C2)', async (t) => {
  const gw = await boxGateway(t);
  const up = await boxUpload(gw, 'a.png', Buffer.from('png'));
  assert.equal(up.status, 200, up.text);
  const at = servedAt(up.json.path);
  const none = await gw.req('GET', at, { cookie: '' });
  assert.equal(none.status, 401, none.body);
  assert.ok(none.body.trim().length > 0, 'a reason');
  assert.equal((await gw.req('HEAD', at, { cookie: '' })).status, 401, 'HEAD too');
  const nav = await gw.req('GET', at, { cookie: '', headers: { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' } });
  assert.equal(nav.status, 302);
  assert.match(nav.headers.location, /\/auth\/login/);
  const img = await gw.req('GET', at, { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'image', 'sec-fetch-mode': 'no-cors' } });
  assert.equal(img.status, 403, img.body);
  // and the same request from the instance's own page is served
  assert.equal((await gw.req('GET', at, { headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'image', 'sec-fetch-mode': 'no-cors' } })).status, 200);
});

// C4's cases, the same on both servers: beside a stored file (`stored`), files put there by hand that
// no stored name could be, and links from its folder out of the root, to a sibling whose path starts
// with the root's own, and to stored files under the root itself (`other`, in another folder, and
// `stored` in its own): a file is served only at exactly <root>/<folder>/<name> (task review T3-1).
// Returns the paths that must be 404.
function unservedCases(root, stored, other) {
  const dir = path.dirname(stored);
  const folder = path.basename(dir);
  fs.writeFileSync(path.join(dir, '.part'), 'half');
  fs.writeFileSync(path.join(dir, 'A B.png'), 'odd');
  // names the raw path spells exactly (it is never decoded), so only the name rule stops them
  fs.writeFileSync(path.join(dir, 'A%20B.png'), 'odd');
  fs.writeFileSync(path.join(dir, 'Upper.PNG'), 'odd');
  fs.writeFileSync(path.join(dir, '-x.txt'), 'odd');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'x.txt'), 'nested');
  fs.mkdirSync(path.join(root, 'not-ours'));
  fs.writeFileSync(path.join(root, 'not-ours', 'a.txt'), 'not ours');
  fs.symlinkSync('/etc/hosts', path.join(dir, 'hosts.txt'));
  const evil = path.join(`${root}-evil`, folder);
  fs.mkdirSync(evil, { recursive: true });
  fs.writeFileSync(path.join(evil, 'x.txt'), 'evil');
  fs.symlinkSync(path.join(evil, 'x.txt'), path.join(dir, 'x.txt'));
  fs.symlinkSync(other, path.join(dir, 'other.txt'));
  fs.symlinkSync(stored, path.join(dir, 'same.txt'));
  return [
    '/upload/../x', '/upload/%2e%2e/%2e%2e/etc/passwd', `/upload/${folder}/..%2F..%2Fetc%2Fpasswd`, `/upload/${folder}%2Fa.txt`, '/upload/not-ours/a.txt', '/upload/2026-01-01-zzzzzzzzzzzzzzzzzzzzzzzz/a.txt',
    `/upload/${folder}/a.txt%2F`, `/upload/${folder}/.part`, `/upload/${folder}/sub/x.txt`, `/upload/${folder}/sub`, `/upload/${folder}/A%20B.png`, `/upload/${folder}/Upper.PNG`, `/upload/${folder}/-x.txt`, `/upload/${folder}`, `/upload/${folder}/`, '/upload/',
    `/upload/${folder}/hosts.txt`, `/upload/${folder}/x.txt`, `/upload/${folder}/other.txt`, `/upload/${folder}/same.txt`, `/upload/${folder}/missing.txt`, `/upload/./${folder}/a.txt`, `/upload//${folder}/a.txt`,
  ];
}

test('box serve: a path that isn\'t a stored file in a folder of ours is 404, whatever it\'s dressed as (C4)', async (t) => {
  const gw = await boxGateway(t);
  const up = await boxUpload(gw, 'a.txt', Buffer.from('a'));
  assert.equal(up.status, 200, up.text);
  const other = await boxUpload(gw, 'b.txt', Buffer.from('b'));
  assert.equal(other.status, 200, other.text);
  assert.equal((await gw.req('GET', servedAt(up.json.path))).status, 200, 'the real one is served');
  for (const p of unservedCases(gw.uploadsDir, up.json.path, other.json.path)) {
    const r = await gw.req('GET', p);
    assert.equal(r.status, 404, `${p}: ${r.status} ${r.body.slice(0, 80)}`);
    assert.equal((await gw.req('HEAD', p)).status, 404, `HEAD ${p}`);
  }
});

test('laptop serve: a stored file comes back to the dashboard\'s own page with its type, and never renders (C1, the laptop half)', LAPTOP, async (t) => {
  const L = await laptop(t);
  for (const want of SERVED) {
    const bytes = want.name === 'a.html' ? Buffer.from('<script>alert(1)</script>') : want.name === 'a.svg' ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>') : crypto.randomBytes(5000);
    const up = await L.post(want.name, bytes);
    assert.equal(up.status, 200, up.text);
    assert.equal(path.basename(up.json.path), want.name);
    assertServed(await L.get(servedAt(up.json.path)), want, bytes, want.name);
    if (want.name === 'a.png') {
      // a query (a page's cache-buster) names the same file (task review T4-1)
      assertServed(await L.get(`${servedAt(up.json.path)}?v=1`), want, bytes, 'with ?v=1');
      const head = await L.get(servedAt(up.json.path), {}, 'HEAD');
      assertServed(head, want, null, 'HEAD');
      assert.equal(head.bytes.length, 0, 'HEAD: no body');
      assert.equal(head.headers['content-length'], String(bytes.length), 'HEAD: the size');
    }
  }
});

test('laptop serve: another site is 403, the owner\'s own tools are served, and on a box the route is off (C3)', LAPTOP, async (t) => {
  const L = await laptop(t);
  const up = await L.post('a.png', Buffer.from('png'));
  assert.equal(up.status, 200, up.text);
  const at = servedAt(up.json.path);
  for (const site of ['cross-site', 'same-site']) {
    const r = await L.get(at, { 'sec-fetch-site': site });
    assert.equal(r.status, 403, `${site}: ${r.text}`);
    assert.ok(r.text.trim().length > 0, `${site}: a reason`);
    assert.equal((await L.get(at, { 'sec-fetch-site': site }, 'HEAD')).status, 403, `HEAD ${site}`);
  }
  // curl, or the owner's own tools: neither header
  const bare = await L.get(at, { 'sec-fetch-site': null });
  assert.equal(bare.status, 200, bare.text);
  assert.equal(bare.text, 'png');
  const evil = await L.get(at, { host: `evil.example:${L.port}` });
  assert.equal(evil.status, 403, evil.text);
  // on a box: a file in the box's folder, which the dashboard must not serve (the gateway does)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-attach-box-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const folder = newFolderName();
  fs.mkdirSync(path.join(dir, folder));
  fs.writeFileSync(path.join(dir, folder, 'a.png'), 'png');
  const B = await laptop(t, { DEVTEAM_GATEWAY: '1', DEVTEAM_UPLOADS_DIR: dir });
  const off = await B.get(`/upload/${folder}/a.png`);
  assert.equal(off.status, 404, off.text);
  assert.equal((await B.get(`/upload/${folder}/a.png`, {}, 'HEAD')).status, 404, 'HEAD on a box');
});

test('laptop serve: a path that isn\'t a stored file in a folder of ours is 404, whatever it\'s dressed as (C4, the laptop half)', LAPTOP, async (t) => {
  const L = await laptop(t);
  const up = await L.post('a.txt', Buffer.from('a'));
  assert.equal(up.status, 200, up.text);
  const other = await L.post('b.txt', Buffer.from('b'));
  assert.equal(other.status, 200, other.text);
  assert.equal((await L.get(servedAt(up.json.path))).status, 200, 'the real one is served');
  for (const p of unservedCases(L.folder(), up.json.path, other.json.path)) {
    const r = await L.get(p);
    assert.equal(r.status, 404, `${p}: ${r.status} ${r.text.slice(0, 80)}`);
    assert.equal((await L.get(p, {}, 'HEAD')).status, 404, `HEAD ${p}`);
  }
});

test('box upload: the gateway\'s first sweep removes old, empty and cut-off folders of ours, and keeps the rest (A9, the gateway half)', async (t) => {
  const gw = await boxGateway(t);
  const root = gw.uploadsDir;
  const now = Date.now() / 1000;
  const seed = (name, files, ageS) => {
    const d = path.join(root, name);
    fs.mkdirSync(d, { mode: 0o750 });
    for (const f of files) { fs.writeFileSync(path.join(d, f), 'seeded'); if (ageS) fs.utimesSync(path.join(d, f), now - ageS, now - ageS); }
    if (ageS) fs.utimesSync(d, now - ageS, now - ageS);
    return name;
  };
  // the laptop's case's folders, seeded before the gateway's first upload (so before its first scan)
  const old = seed(newFolderName('2026-01-01'), ['x.txt'], R.keepMs / 1000 + 60);
  const stalePart = seed(newFolderName(), [R.part], R.stallMs / 1000 + 1);
  const empty = seed(newFolderName(), [], R.stallMs / 1000 + 1);
  const freshEmpty = seed(newFolderName(), [], 0);
  const fresh = seed(newFolderName(), ['y.txt'], 60);
  const freshPart = seed(newFolderName(), [R.part], 0);
  const notOurs = seed('not-ours', ['z.txt'], R.keepMs / 1000 + 60);
  const r = await boxUpload(gw, 'next.txt', Buffer.from('next'));
  assert.equal(r.status, 200, r.text);
  const made = path.basename(path.dirname(r.json.path));
  // the one difference from the laptop (§3 step 6): only one gateway writes its root, so any .part or empty folder at its first scan was cut off
  assert.deepEqual(fs.readdirSync(root).sort(), [fresh, made, notOurs].sort());
  for (const gone of [old, stalePart, empty, freshEmpty, freshPart]) assert.ok(!fs.existsSync(path.join(root, gone)), gone);
});

// --- files on answers and turns (spec §6) --------------------------------------------------------
const SUP = { DEVTEAM_ROLE: 'supervisor' };
const TOO_LONG = /That is too long with its files; shorten it or attach fewer\./;
// Every log line the project holds, live and durable: a refusal leaves the count where it was.
function logLineCount(L) {
  let n = 0;
  for (const d of ['run/log', 'project/log']) {
    const dir = path.join(L.root, 'docs/devteam', d);
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) n += fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).length;
  }
  return n;
}
const ownerLogFile = (L) => path.join(L.root, 'docs/devteam/run/log', `owner-${new Date().toISOString().slice(0, 7)}.jsonl`);
// A question the supervisor asks, and a thread the owner starts: what the answers and turns go on.
function askQuestion(L, q = 'Which one?') {
  const r = L.dt(['ask', '--kind', 'owner-decision', '--question', q], SUP);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split('\n')[0];
}
function newThread(L) {
  const r = L.dt(['thread', 'new', '--title', 'About the shots', '--', 'first words']);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split('\n')[0];
}
const questionOf = (L, id) => JSON.parse(L.dt(['log', '--type', 'question', '--json']).stdout).find((q) => q.id === id);
const turnsOf = (L, tid) => fs.readFileSync(ownerLogFile(L), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((o) => o.type === 'turn' && o.thread === tid);
const openThreads = (L) => JSON.parse(L.dt(['thread', 'list', '--open', '--json']).stdout).length;
async function upload(L, name, bytes) {
  const r = await L.post(name, bytes);
  assert.equal(r.status, 200, r.text);
  return r.json.path;
}

test('files: an answer and both thread actions carry the dropped files, real paths and real sizes; the schema refuses a loose one (B1, B2, B6)', LAPTOP, async (t) => {
  const L = await laptop(t);
  const png = await upload(L, 'Shot 1.png', crypto.randomBytes(2000));
  const pdf = await upload(L, 'notes.pdf', crypto.randomBytes(3000));
  // the page's sizes are wrong on purpose: the log says the real ones
  const given = [{ name: 'Shot 1.png', path: png, bytes: 1 }, { name: 'notes.pdf', path: pdf, bytes: 1 }];
  const want = [{ name: 'Shot 1.png', path: fs.realpathSync(png), bytes: 2000 }, { name: 'notes.pdf', path: fs.realpathSync(pdf), bytes: 3000 }];
  // B1
  const qid = askQuestion(L);
  const a = await L.api('answer', { id: qid, answer: 'This one', files: given });
  assert.equal(a.status, 200, a.text);
  const set = questionOf(L, qid).updates.find((u) => u.answer !== undefined);
  assert.deepEqual(set.files, want, 'the answer line has both files');
  // B2
  const n = await L.api('thread-new', { title: 'Look at these', text: 'see the shots', files: given });
  assert.equal(n.status, 200, n.text);
  const tid = n.json.out.split('\n')[0];
  assert.deepEqual(turnsOf(L, tid).map((u) => u.files), [want], 'the first turn has the files');
  const s = await L.api('thread-say', { id: tid, text: 'and again', files: [given[1]] });
  assert.equal(s.status, 200, s.text);
  assert.deepEqual(turnsOf(L, tid).map((u) => u.files), [want, [want[1]]], 'the said turn has its file');
  // with no files, a turn is as before
  assert.equal((await L.api('thread-say', { id: tid, text: 'no files', files: [] })).status, 200);
  assert.equal(turnsOf(L, tid).pop().files, undefined, 'files: [] is no files');
  // B6: log-check holds every line to the schema
  const ok = L.dt(['log-check']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const file = ownerLogFile(L);
  const kept = fs.readFileSync(file, 'utf8');
  const said = JSON.parse(kept.split('\n').filter(Boolean).find((l) => { const o = JSON.parse(l); return o.type === 'turn' && o.text === 'and again'; }));
  const at = new Date(Date.now() + 5000).toISOString();
  const forged = (files) => `${JSON.stringify({ ...said, id: `u-${at.slice(0, 10).replace(/-/g, '')}-${at.slice(11, 23).replace(/[:.]/g, '')}-owner`, at, files })}\n`;
  for (const [what, files] of [['an extra key', [{ ...want[0], extra: 1 }]], ['11 files', Array.from({ length: 11 }, () => want[0])]]) {
    fs.appendFileSync(file, forged(files));
    const r = L.dt(['log-check']);
    assert.notEqual(r.status, 0, `${what}: log-check passed`);
    assert.match(r.stdout + r.stderr, /files/, `${what}: names files`);
    fs.writeFileSync(file, kept);
  }
  assert.equal(L.dt(['log-check']).status, 0, 'restored');
});

test('files: a path that isn\'t a dropped file in this machine\'s folder is refused, naming it, with nothing written (B3)', LAPTOP, async (t) => {
  const L = await laptop(t);
  const stored = await upload(L, 'a.txt', Buffer.from('a'));
  const root = L.folder();
  const folder = path.dirname(stored);
  const mk = (p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); return p; };
  const outside = mk(path.join(L.base, 'outside.txt'));
  const link = path.join(folder, 'link.txt');
  fs.symlinkSync(outside, link);
  const ours = path.join(root, newFolderName());
  const cases = [
    `${folder}${'/..'.repeat(folder.split('/').length - 1)}/etc/passwd`,
    '/etc/hosts',
    link,
    'a.txt',
    folder,
    path.join(folder, 'missing.txt'),
    mk(path.join(root, 'top.txt')),
    mk(path.join(folder, 'sub', 'x.txt')),
    mk(path.join(ours, R.part)),
    mk(path.join(ours, 'A B.txt')),
    mk(path.join(root, 'not-ours', 'x.txt')),
    // a sibling named with the root's name as a prefix: a startsWith without the separator would pass it
    mk(path.join(`${root}-evil`, path.basename(folder), 'x.txt')),
  ];
  const qid = askQuestion(L);
  const tid = newThread(L);
  const before = logLineCount(L);
  for (const p of cases) {
    const files = [{ name: 'x.txt', path: p, bytes: 1 }];
    for (const [name, body] of [['answer', { id: qid, answer: 'Yes', files }], ['thread-say', { id: tid, text: 'look', files }]]) {
      const r = await L.api(name, body);
      assert.equal(r.status, 400, `${name} ${p}: ${r.text}`);
      assert.ok(r.json?.error?.includes(p), `${name} ${p}: the error names it: ${r.text}`);
      assert.match(r.json.error, p === 'a.txt' ? /is not an absolute path/ : /is not a dropped file in this machine's folder/, `${name} ${p}`);
    }
    assert.equal(logLineCount(L), before, `${p}: nothing written`);
  }
  // a missing root names it
  fs.rmSync(root, { recursive: true, force: true });
  const gone = L.dt(['answer', qid, 'Yes', '--files', JSON.stringify([{ name: 'a.txt', path: stored, bytes: 1 }])]);
  assert.notEqual(gone.status, 0);
  assert.match(gone.stderr, /refused: this machine has no dropped-files folder \(/);
  assert.equal(logLineCount(L), before);
});

test('files: the shape is checked, by the action and by the command, with nothing written (B4, the refused modes)', LAPTOP, async (t) => {
  const L = await laptop(t);
  const stored = await upload(L, 'a.png', Buffer.from('png'));
  const one = { name: 'a.png', path: stored, bytes: 3 };
  const qid = askQuestion(L);
  const tid = newThread(L);
  const before = logLineCount(L);
  const shapes = [
    ['11 files', Array.from({ length: 11 }, () => one)],
    ['an extra key', [{ ...one, extra: 1 }]],
    ['a key missing', [{ name: 'a.png', path: stored }]],
    ['a name with a newline', [{ ...one, name: 'a\n.png' }]],
    // a bidi override would have the owner's card read the name reversed (task review T5-2)
    ['a name with a bidi override', [{ ...one, name: 'a\u202egnp.txt' }]],
    ['a name with a zero-width mark', [{ ...one, name: 'a\u200e.png' }]],
    ['an empty name', [{ ...one, name: '' }]],
    ['a name of 201 characters', [{ ...one, name: 'n'.repeat(201) }]],
    ['bytes -1', [{ ...one, bytes: -1 }]],
    ['bytes 1.5', [{ ...one, bytes: 1.5 }]],
    ['bytes as text', [{ ...one, bytes: '3' }]],
    ['a path over 1024 bytes', [{ ...one, path: `/${'p'.repeat(1024)}` }]],
    ['not an array', 'a.png'],
    ['an object', one],
    ['null in the list', [null]],
  ];
  for (const [what, files] of shapes) {
    for (const [name, body] of [['answer', { id: qid, answer: 'Yes', files }], ['thread-say', { id: tid, text: 'look', files }], ['thread-new', { title: 'T', text: 'look', files }]]) {
      const r = await L.api(name, body);
      assert.equal(r.status, 400, `${name} ${what}: ${r.text}`);
      assert.ok(r.json?.error, `${name} ${what}: a reason`);
    }
    assert.equal(logLineCount(L), before, `${what}: nothing written`);
  }
  // the command's own refusals: a bare --files, JSON that isn't, and the modes that carry none
  const json = JSON.stringify([one]);
  for (const [what, args, env] of [
    ['a bare --files', ['answer', qid, 'Yes', '--files']],
    ['not JSON', ['answer', qid, 'Yes', '--files', '[nope']],
    ['an empty list', ['answer', qid, 'Yes', '--files', '[]']],
    ['a bare --files on a turn', ['thread', 'say', tid, '--files', '--', 'look']],
  ]) {
    const r = L.dt(args, env);
    assert.notEqual(r.status, 0, what);
    assert.match(r.stderr, /--files is a JSON array of 1 to 10 dropped files/, `${what}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /SyntaxError|at JSON\.parse/, `${what}: no stack`);
  }
  for (const [what, args, env] of [
    ['--defaulted', ['answer', qid, '--defaulted', '--files', json], SUP],
    ['--from-chat', ['answer', qid, 'Yes', '--from-chat', '--said', 'yes', '--files', json], SUP],
    ['--from-turn', ['answer', qid, 'Yes', '--from-turn', 'u-20261117-000000000-owner', '--files', json], SUP],
    ['--decline', ['answer', qid, 'why', '--decline', '--files', json]],
    ['--review-result', ['answer', qid, '--review-result', '-', '--files', json]],
  ]) {
    const r = L.dt(args, env);
    assert.notEqual(r.status, 0, what);
    assert.match(r.stderr, /--files go with the owner's own answer/, `${what}: ${r.stderr}`);
  }
  // the supervisor's reply carries none
  const reply = L.dt(['thread', 'reply', tid, '--files', json, '--', 'ok'], SUP);
  assert.notEqual(reply.status, 0);
  assert.match(reply.stderr, /--files go with the owner's own turn/);
  // refused before its value is read: a bare --files on a reply names the owner's turn, not the shape (task review T5-3)
  const bareReply = L.dt(['thread', 'reply', tid, '--files', '--', 'ok'], SUP);
  assert.notEqual(bareReply.status, 0);
  assert.match(bareReply.stderr, /--files go with the owner's own turn/);
  assert.equal(logLineCount(L), before, 'nothing written');
  // reopen carries none, and says so rather than dropping them (task review T5-4)
  assert.equal(L.dt(['thread', 'resolve', tid, '--outcome', 'done']).status, 0);
  const resolved = logLineCount(L);
  const reopen = L.dt(['thread', 'reopen', tid, '--files', json, '--', 'again']);
  assert.notEqual(reopen.status, 0, 'reopen took --files');
  assert.match(reopen.stderr, /--files go with the owner's own turn/);
  assert.equal(logLineCount(L), resolved, 'reopen wrote nothing');
});

test('files: on a box the dropped files are the gateway\'s folder, never the laptop\'s (B5)', LAPTOP, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-attach-gwroot-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const folder = newFolderName();
  fs.mkdirSync(path.join(dir, folder));
  fs.writeFileSync(path.join(dir, folder, 'x.png'), 'png!');
  const L = await laptop(t, { DEVTEAM_GATEWAY: '1', DEVTEAM_UPLOADS_DIR: dir });
  const mine = path.join(L.folder(), newFolderName(), 'y.png');
  fs.mkdirSync(path.dirname(mine), { recursive: true });
  fs.writeFileSync(mine, 'png');
  const q1 = askQuestion(L, 'First?');
  const q2 = askQuestion(L, 'Second?');
  const before = logLineCount(L);
  const no = await L.api('answer', { id: q2, answer: 'Yes', files: [{ name: 'y.png', path: mine, bytes: 3 }] });
  assert.equal(no.status, 400, no.text);
  assert.ok(no.json.error.includes(mine), no.text);
  assert.ok(no.json.error.includes(`(${dir})`), `names the box's folder: ${no.text}`);
  assert.equal(logLineCount(L), before);
  const yes = await L.api('answer', { id: q1, answer: 'Yes', files: [{ name: 'x.png', path: path.join(dir, folder, 'x.png'), bytes: 1 }] });
  assert.equal(yes.status, 200, yes.text);
  assert.deepEqual(questionOf(L, q1).updates.find((u) => u.answer !== undefined).files, [{ name: 'x.png', path: fs.realpathSync(path.join(dir, folder, 'x.png')), bytes: 4 }]);
});

test('files: a line its files make too long is refused before anything is written; one exactly at the limit is kept (B7)', LAPTOP, async (t) => {
  const L = await laptop(t);
  const long = `${'n'.repeat(196)}.png`;
  assert.equal(long.length, R.name);
  const paths = [];
  for (let i = 0; i < 10; i++) paths.push(await upload(L, long, Buffer.from(`file ${i}`)));
  const ten = JSON.stringify(paths.map((p) => ({ name: long, path: p, bytes: 1 })));
  const words = 'w'.repeat(1900);
  const qid = askQuestion(L);
  const tid = newThread(L);
  const before = logLineCount(L);
  const threads = openThreads(L);
  for (const [what, args] of [
    ['thread say', ['thread', 'say', tid, '--files', ten, '--', words]],
    ['thread new', ['thread', 'new', '--title', 'Long', '--files', ten, '--', words]],
    ['answer', ['answer', qid, words, '--files', ten]],
  ]) {
    const r = L.dt(args);
    assert.notEqual(r.status, 0, `${what}: accepted`);
    assert.match(r.stderr, TOO_LONG, `${what}: ${r.stderr}`);
    assert.equal(logLineCount(L), before, `${what}: nothing written`);
    assert.equal(openThreads(L), threads, `${what}: no new thread`);
    assert.equal(questionOf(L, qid).updates.length, 0, `${what}: the question is still open`);
  }
  // one file of the longest name goes
  const ok = L.dt(['answer', qid, 'Yes', '--files', JSON.stringify([{ name: long, path: paths[0], bytes: 1 }])]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(questionOf(L, qid).updates.find((u) => u.answer !== undefined).files[0].name, long);
  // the size check builds the very line appendLog writes: exactly LINE_MAX goes, a byte more is refused with the files' words
  const q2 = askQuestion(L, 'Exactly?');
  const files = [{ name: long, path: fs.realpathSync(paths[1]), bytes: 6 }];
  const lineBytes = (answer) => Buffer.byteLength(`${JSON.stringify({ v: 1, id: q2, type: 'question', op: 'set', at: new Date().toISOString(), by: 'owner', channel: 'cli', answer, files, question_hash: '0'.repeat(16) })}\n`);
  const exact = 'a'.repeat(4096 - lineBytes(''));
  assert.equal(lineBytes(exact), 4096);
  const given = JSON.stringify([{ name: long, path: paths[1], bytes: 1 }]);
  const over = L.dt(['answer', q2, `${exact}a`, '--files', given]);
  assert.notEqual(over.status, 0, 'a byte over: accepted');
  assert.match(over.stderr, TOO_LONG, over.stderr);
  const at = L.dt(['answer', q2, exact, '--files', given]);
  assert.equal(at.status, 0, at.stderr);
  const last = fs.readFileSync(ownerLogFile(L), 'utf8').split('\n').filter(Boolean).pop();
  assert.equal(Buffer.byteLength(`${last}\n`), 4096, 'the line written is exactly LINE_MAX');
  assert.equal(JSON.parse(last).id, q2);
});

// --- the supervisor's pane gets the files as a pane drop does (spec §7) ------------------------------
// A stand-in for the supervisor's agent: in raw mode, with bracketed paste asked for (as Claude Code
// asks), so tmux wraps a paste in ESC[200~ … ESC[201~; every byte it gets is written down. It draws
// an input box, or first (menu) a numbered menu until it gets a 1, as Claude Code draws them.
const DROP_AGENT = `import fs from 'node:fs';
const [keys, first] = process.argv.slice(2);
const RULE = '─'.repeat(100);
let menu = first === 'menu', draft = '';
const shown = (s) => s.replace(/\\x1b\\[20[01]~/g, '').replace(/[\\x00-\\x1f\\x7f]/g, '');
const draw = () => process.stdout.write('\\x1b[2J\\x1b[H' + ['stand-in supervisor', ...(menu ? [RULE, ' Bash command', '', '   rm -rf  build', '', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No', '', ' Esc to cancel'] : [RULE, '❯ ' + shown(draft), RULE, '  ? for shortcuts'])].join('\\n') + '\\n');
process.stdin.setRawMode(true);
process.stdout.write('\\x1b[?2004h');
process.stdin.on('data', (d) => {
  fs.appendFileSync(keys, d);
  const s = String(d);
  if (menu) { if (s.includes('1')) menu = false; } else draft = (draft + s).split('\\r').pop();
  draw();
});
draw();
`;
const napMs = (ms) => new Promise((r) => setTimeout(r, ms));
function dropPane(F, first = 'input') {
  const dir = fs.mkdtempSync(path.join(F.base, 'drop-'));
  const keys = path.join(dir, 'keys.txt');
  fs.writeFileSync(path.join(dir, 'agent.mjs'), DROP_AGENT);
  const s = `drop-${path.basename(dir).slice(5)}`;
  // the fixture's own tmux (its TMUX_TMPDIR), never the session running the tests
  const e = F.env();
  delete e.TMUX;
  delete e.TMUX_PANE;
  spawnSync('tmux', ['new-session', '-d', '-x', '200', '-y', '40', '-s', s, '-n', 'main', '-c', F.old, `${process.execPath} ${path.join(dir, 'agent.mjs')} ${keys} ${first}`], { env: e });
  const shows = () => spawnSync('tmux', ['-u', 'capture-pane', '-p', '-t', `=${s}:main`], { env: e, encoding: 'utf8' }).stdout ?? '';
  return {
    target: `${s}:main`,
    key: `${s}:main`,
    shows,
    ready: () => until(() => (first === 'menu' ? /Esc to cancel/ : /\? for shortcuts/).test(shows()), 'the stand-in'),
    typed: () => (fs.existsSync(keys) ? fs.readFileSync(keys, 'utf8') : ''),
    press: (k) => spawnSync('tmux', ['send-keys', '-t', `=${s}:main`, k], { env: e }),
  };
}
// The box's folder, seeded by hand as the gateway would fill it: under the fixture, never the real
// HOME or /data/uploads.
function dropFixture(name) {
  const F = threadsFixture(name);
  const root = path.join(F.base, 'uploads');
  const folder = path.join(root, newFolderName());
  fs.mkdirSync(folder, { recursive: true });
  for (const n of ['shot.png', 'notes.pdf']) fs.writeFileSync(path.join(folder, n), `${n} bytes`);
  const file = (n) => ({ name: n, path: fs.realpathSync(path.join(folder, n)), bytes: `${n} bytes`.length });
  return { F, BOX: { DEVTEAM_GATEWAY: '1', DEVTEAM_UPLOADS_DIR: root }, png: file('shot.png'), pdf: file('notes.pdf') };
}
// What the pane got since `from` bytes, once `enters` more Enters have come and nothing more follows.
async function newBytes(pane, from, enters) {
  await until(() => (pane.typed().slice(from).match(/\r/g) ?? []).length >= enters, `${enters} Enter(s) in the pane`);
  await napMs(300);
  return pane.typed().slice(from);
}
const PANE = { skip: hasTmux ? false : 'no tmux', timeout: 240000 };

test('the supervisor\'s pane gets a turn\'s or an answer\'s files as a bracketed paste, and a line with none as today (B8)', PANE, async (t) => {
  const { F, BOX, png, pdf } = dropFixture('drop-pane');
  t.after(() => F.done());
  const pane = dropPane(F);
  await pane.ready();
  const S = { ...BOX, DEVTEAM_SUPERVISOR: pane.target };
  // a turn with no files: exactly the line and Enter
  const tid = F.owner(['thread', 'new', '--title', 'Shots', '--', 'first words'], S).split('\n')[0];
  const turnLine = (words) => `[devteam thread ${tid} from owner] ${words} — devteam.mjs thread show ${tid}`;
  let at = 0;
  let got = await newBytes(pane, at, 1);
  assert.equal(got, `${turnLine('first words')}\r`, 'no files: no space, no paste');
  at += got.length;
  // a .png and a .pdf: the line, a space, the paste, a space (a non-image is there), Enter
  assert.match(F.owner(['thread', 'say', tid, '--files', JSON.stringify([png, pdf]), '--', 'look at these'], S), /sent to the supervisor's pane/);
  got = await newBytes(pane, at, 1);
  assert.equal(got, `${turnLine('look at these')} (2 files dropped) \x1b[200~${png.path} ${pdf.path}\x1b[201~ \r`);
  at += got.length;
  // only the .png: no space after the paste
  F.owner(['thread', 'say', tid, '--files', JSON.stringify([png]), '--', 'just this'], S);
  got = await newBytes(pane, at, 1);
  assert.equal(got, `${turnLine('just this')} (1 file dropped) \x1b[200~${png.path}\x1b[201~\r`);
  at += got.length;
  // an answer: its nudge line, then the same paste
  const qid = F.sup(['ask', '--kind', 'owner-decision', '--question', 'Which one?']).split('\n')[0];
  F.owner(['answer', qid, 'This one', '--files', JSON.stringify([png, pdf])], S);
  got = await newBytes(pane, at, 1);
  assert.equal(got, `[devteam answer ${qid} from owner] read it with: devteam.mjs questions --id ${qid} (2 files dropped) \x1b[200~${png.path} ${pdf.path}\x1b[201~ \r`);
  // the tmux buffer went with the paste: nothing is left on the server
  const e = F.env();
  delete e.TMUX;
  assert.equal(spawnSync('tmux', ['list-buffers', '-F', '#{buffer_name}'], { env: e, encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith('devteam-drop-')).length, 0, 'no devteam-drop buffer left');
});

test('a turn with files held while the pane shows a menu keeps its paste, and is typed with it once the menu is answered (B9)', PANE, async (t) => {
  const { F, BOX, png, pdf } = dropFixture('drop-held');
  t.after(() => F.done());
  const pane = dropPane(F, 'menu');
  await pane.ready();
  const S = { ...BOX, DEVTEAM_SUPERVISOR: pane.target };
  // the thread, started with no pane named: recorded, typed nowhere
  const tid = F.owner(['thread', 'new', '--title', 'Shots', '--', 'first words'], BOX).split('\n')[0];
  assert.match(F.owner(['thread', 'say', tid, '--files', JSON.stringify([png, pdf]), '--', 'look at these'], S), /recorded and held/);
  await napMs(300);
  assert.equal(pane.typed(), '', 'not a byte reached the menu');
  const dir = path.join(F.old, 'docs/devteam/run/held', encodeURIComponent(pane.key));
  const held = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  assert.equal(held.length, 1);
  const rec = JSON.parse(fs.readFileSync(path.join(dir, held[0]), 'utf8'));
  assert.deepEqual(rec.paste, [png.path, pdf.path], 'the held record has the paste');
  // answered at the terminal; the next line flushes the held one first, with its paste
  pane.press('1');
  await until(() => /\? for shortcuts/.test(pane.shows()), 'the input box');
  F.owner(['thread', 'say', tid, '--', 'and this'], S);
  const got = await newBytes(pane, 0, 2);
  const turnLine = (words) => `[devteam thread ${tid} from owner] ${words} — devteam.mjs thread show ${tid}`;
  assert.equal(got, `1${turnLine('look at these')} (2 files dropped) \x1b[200~${png.path} ${pdf.path}\x1b[201~ \r${turnLine('and this')}\r`);
});

test('log-check: files are on the owner\'s own turn and answer, never a supervisor\'s turn or an answer recorded from chat or a thread (task review T5-1)', { timeout: 240000 }, (t) => {
  const { F, png } = dropFixture('drop-log');
  t.after(() => F.done());
  const tid = F.owner(['thread', 'new', '--title', 'Shots', '--', 'first words']).split('\n')[0];
  const qid = F.sup(['ask', '--kind', 'owner-decision', '--question', 'Which one?']).split('\n')[0];
  const files = [png];
  // each line as it may be, then with files: only the files are refused
  for (const [what, by, o] of [
    ['a supervisor turn', 'supervisor', { type: 'turn', thread: tid, text: 'here' }],
    ['an answer from chat', 'owner', { type: 'question', op: 'set', id: qid, answer: 'Yes', channel: 'chat', said: 'yes' }],
  ]) {
    const plain = F.checkWith([by, o]);
    assert.equal(plain.status, 0, `${what} without files: ${plain.said}`);
    const r = F.checkWith([by, { ...o, files }]);
    assert.notEqual(r.status, 0, `${what} with files: log-check passed`);
    assert.match(r.said, /files/, `${what}: names files`);
  }
  // the owner's own turn with files passes
  const own = F.checkWith(['owner', { type: 'turn', thread: tid, text: 'mine', files }]);
  assert.equal(own.status, 0, own.said);
});
