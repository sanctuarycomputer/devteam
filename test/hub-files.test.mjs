// Files for the owner's threads with the machine's operator (kit-724): the laptop hub's upload route,
// the box's on the hub's name, operator-thread --files, and the paths in the operator's pane.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { freePort, hasTmux, until } from './lib/kit.mjs';
import { box, cleanup, KIT, machine, nowhere, OP, prompt, seat, shown, signedPress, tmp } from './lib/operator-threads-fixture.mjs';
import { newFolderName, R, request } from './lib/attachments-fixture.mjs';

const G = await import('../cloud/gateway.mjs');
const servedAt = (stored) => `/upload/${path.basename(path.dirname(stored))}/${path.basename(stored)}`;
// every file under dir, but the hub's own diagnostics
const filesUnder = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)])); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } };
const LIMITS = ['DEVTEAM_UPLOAD_MAX', 'DEVTEAM_UPLOAD_TOTAL', 'DEVTEAM_UPLOAD_FREE', 'DEVTEAM_UPLOAD_STALL_MS', 'DEVTEAM_UPLOAD_BODY_MS', 'DEVTEAM_GATEWAY', 'DEVTEAM_UPLOADS_DIR'];

// The hub alone (devteam.mjs hub), in no project, on a HOME of its own.
async function laptopHub(t, extra = {}) {
  const later = cleanup(t);
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-hub-files-')));
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const home = path.join(base, 'home');
  fs.mkdirSync(home);
  const port = await freePort();
  const env = { ...process.env, HOME: home, DEVTEAM_HUB_PORT: String(port), DEVTEAM_MEMORY_RECORD: 'off', DEVTEAM_OPERATOR_COMMAND: '' };
  for (const k of LIMITS) delete env[k];
  Object.assign(env, extra);
  const p = spawn(process.execPath, [KIT, 'hub'], { cwd: base, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let said = '';
  p.stdout.on('data', (b) => { said += b; });
  p.stderr.on('data', (b) => { said += b; });
  later(() => (p.exitCode === null && p.signalCode === null ? new Promise((r) => { p.once('exit', r); try { process.kill(-p.pid, 'SIGKILL'); } catch { r(); } }) : undefined));
  await until(() => p.exitCode !== null || /hub on http/.test(said), 'the hub');
  assert.equal(p.exitCode, null, said);
  const own = { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' };
  const post = (name, body, headers = {}, how = {}) => request(port, `/upload?name=${encodeURIComponent(name)}`, { headers: { ...own, ...headers }, body, ...how });
  const get = (route, headers = {}, method = 'GET') => request(port, route, { method, headers: { host: own.host, 'sec-fetch-site': 'same-origin', ...headers } });
  const act = (action, body) => request(port, `/operator/${action}`, { headers: { ...own, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const root = path.join(home, '.devteam', 'uploads', `hub-${port}`);
  return { base, home, port, env, own, post, get, act, root, uploads: () => filesUnder(path.join(home, '.devteam', 'uploads')) };
}
const T = { timeout: 120000 };

test('hub files laptop: a dropped file is stored under the hub\'s machine folder, by the dashboard\'s rules, and served back', T, async (t) => {
  const H = await laptopHub(t);
  const bytes = crypto.randomBytes(70000);
  const r = await H.post('../../My Shot; $(id).PNG', bytes);
  assert.equal(r.status, 200, r.text);
  assert.equal(path.dirname(path.dirname(r.json.path)), H.root, 'the hub\'s own folder');
  assert.match(path.basename(path.dirname(r.json.path)), R.folder);
  assert.equal(path.basename(r.json.path), 'My-Shot-id.png', 'safeUploadName\'s name');
  assert.equal(path.basename(r.json.path), G.safeUploadName('../../My Shot; $(id).PNG'));
  assert.equal(r.json.size, bytes.length);
  assert.deepEqual(fs.readFileSync(r.json.path), bytes);
  assert.deepEqual([H.root, path.dirname(r.json.path), r.json.path].map((f) => fs.statSync(f).mode & 0o777), [0o700, 0o700, 0o600]);
  assert.deepEqual(H.uploads(), [r.json.path], 'nothing else under ~/.devteam/uploads: no project\'s folder');
  assert.deepEqual(filesUnder(H.base).filter((f) => /[\\/](run|project)[\\/]/.test(f)), [], 'no run folder or log');
  const back = await H.get(servedAt(r.json.path));
  assert.equal(back.status, 200, back.text);
  assert.deepEqual(back.bytes, bytes);
  assert.deepEqual([back.headers['content-type'], back.headers['x-content-type-options'], back.headers['content-security-policy'], back.headers['cache-control']], ['image/png', 'nosniff', 'sandbox', 'no-store']);
  const page = await H.post('x.html', Buffer.from('<script>alert(1)</script>'));
  const served = await H.get(servedAt(page.json.path));
  assert.deepEqual([served.headers['content-type'], served.headers['content-disposition']], ['application/octet-stream', 'attachment; filename="x.html"'], 'never rendered');
});

test('hub files laptop: only the hub\'s own page uploads, and only it reads one back', T, async (t) => {
  const H = await laptopHub(t);
  const no = [
    ['another site', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }],
    ['another site that says same-origin', { origin: 'https://evil.example' }],
    ['a dashboard\'s page', { origin: `http://127.0.0.1:${H.port + 1}`, 'sec-fetch-site': 'same-site' }],
    ['no Origin', { origin: null }],
    ['a sandboxed frame', { origin: 'null' }],
    ['the hub\'s Origin from a cross-site request', { 'sec-fetch-site': 'cross-site' }],
    ['no Sec-Fetch-Site', { 'sec-fetch-site': null }],
    ['another name (DNS rebinding)', { host: 'evil.example', origin: 'http://evil.example' }],
  ];
  for (const [why, headers] of no) {
    const r = await H.post('a.txt', Buffer.from('x'), headers);
    assert.equal(r.status, 403, `${why}: ${r.text}`);
    assert.deepEqual(H.uploads(), [], `${why}: nothing stored`);
  }
  // localhost is not the hub's address: sent to it, and nothing stored
  assert.equal((await H.post('a.txt', Buffer.from('x'), { host: `localhost:${H.port}`, origin: `http://localhost:${H.port}` })).status, 302);
  assert.deepEqual(H.uploads(), []);
  for (const method of ['PUT', 'DELETE']) assert.equal((await request(H.port, '/upload?name=a.txt', { method, headers: H.own, body: 'x' })).status, 405, method);
  const r = await H.post('a.png', Buffer.from('png'));
  assert.equal(r.status, 200, r.text);
  const at = servedAt(r.json.path);
  for (const site of ['cross-site', 'same-site', 'none', null]) assert.equal((await H.get(at, { 'sec-fetch-site': site })).status, 403, `Sec-Fetch-Site ${site}`);
  assert.equal((await H.get(at, { host: 'evil.example' })).status, 403);
  assert.equal((await H.get(at)).status, 200, 'the control');
  // a path that isn't a stored file in a folder of ours
  const dir = path.dirname(r.json.path);
  const folder = path.basename(dir);
  fs.symlinkSync('/etc/hosts', path.join(dir, 'hosts.txt'));
  fs.writeFileSync(path.join(dir, R.part), 'half');
  fs.mkdirSync(path.join(H.root, 'not-ours'));
  fs.writeFileSync(path.join(H.root, 'not-ours', 'a.txt'), 'x');
  for (const bad of ['/upload/../threads.jsonl', `/upload/${folder}/..%2F..%2Fx`, `/upload/${folder}/hosts.txt`, `/upload/${folder}/.part`, '/upload/not-ours/a.txt', `/upload/${folder}/missing.txt`, `/upload/${folder}/`, '/upload/']) assert.equal((await H.get(bad)).status, 404, bad);
});

test('hub files laptop: the dashboard\'s limits (uploadLimits): a file\'s size, the total, a stall, and five minutes for any other body', T, async (t) => {
  const H = await laptopHub(t, { DEVTEAM_UPLOAD_MAX: '1000', DEVTEAM_UPLOAD_TOTAL: '1500', DEVTEAM_UPLOAD_STALL_MS: '700', DEVTEAM_UPLOAD_BODY_MS: '400' });
  assert.equal((await H.post('big.bin', Buffer.alloc(1001))).status, 413, 'a declared size');
  const streamed = await H.post('big.bin', null, {}, { chunks: [Buffer.alloc(600), Buffer.alloc(600)] });
  assert.ok(streamed.status === 413 || streamed.error, JSON.stringify(streamed));
  const stalled = await H.post('slow.bin', null, { 'content-length': '100' }, { hold: true, chunks: [Buffer.alloc(1)], within: 10000 });
  assert.ok(stalled.error && !stalled.timedOut, `cut off: ${JSON.stringify(stalled)}`);
  await until(() => !H.uploads().length, 'nothing left of any of them');
  // past the 400 ms every other body has, and still moving
  const moving = await H.post('ok.bin', null, { 'content-length': '900' }, { chunks: [Buffer.alloc(300), Buffer.alloc(300), Buffer.alloc(300)], gapMs: 300 });
  assert.equal(moving.status, 200, JSON.stringify(moving));
  const slow = await request(H.port, '/operator/thread-new', { headers: { ...H.own, 'content-type': 'application/json', 'content-length': '50' }, hold: true, chunks: [Buffer.from('{')], within: 10000 });
  assert.ok(slow.error && !slow.timedOut && slow.ms < 5000, `another body is cut off: ${JSON.stringify(slow)}`);
  assert.equal((await H.post('more.bin', Buffer.alloc(700))).status, 507, 'the total the folder keeps');
  assert.equal(H.uploads().length, 1);
});

test('hub files laptop: the free-disk floor, and an hour for a request (a dashboard\'s)', T, async (t) => {
  const H = await laptopHub(t, { DEVTEAM_UPLOAD_FREE: String(Number.MAX_SAFE_INTEGER) });
  const r = await H.post('a.txt', Buffer.from('x'));
  assert.equal(r.status, 507, r.text);
  assert.deepEqual(H.uploads(), []);
  // Node's own limit on a whole request is five minutes, too long to wait out here: the setting itself
  const src = fs.readFileSync(KIT, 'utf8');
  assert.match(src.slice(src.indexOf('\nfunction startHub('), src.indexOf('\n// ===== account rotation')), /\bhub\.requestTimeout = UPLOAD_REQUEST_MS;/);
});

test('hub files laptop: an upload sweeps what is past seven days there, and only there', T, async (t) => {
  const H = await laptopHub(t);
  const first = await H.post('keep.txt', Buffer.from('new'));
  const seed = (root, ageMs) => { const d = path.join(root, newFolderName()); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'a.txt'), 'a'); const at = new Date(Date.now() - ageMs); fs.utimesSync(d, at, at); return d; };
  const old = seed(H.root, R.keepMs + 60000);
  const young = seed(H.root, R.keepMs - 3600000);
  const other = seed(path.join(H.home, '.devteam', 'uploads', 'proj-0123abcd'), R.keepMs + 60000);
  assert.equal((await H.post('b.txt', Buffer.from('b'))).status, 200);
  assert.deepEqual([old, young, path.dirname(first.json.path), other].map((d) => fs.existsSync(d)), [false, true, true, true]);
});

test('hub files laptop: on a box the hub\'s own server takes and serves none (the gateway does)', T, async (t) => {
  const H = await laptopHub(t, { DEVTEAM_PUBLIC_URL: 'https://box.example.com' });
  const r = await H.post('a.txt', Buffer.from('x'));
  assert.equal(r.status, 404, r.text);
  assert.deepEqual(H.uploads(), []);
  assert.equal((await H.get(`/upload/${newFolderName()}/a.txt`)).status, 404);
});

// --- the box -------------------------------------------------------------------------------------
// A claimed gateway on a localhost URL, with the owner's session (a software passkey, as the gateway's tests have it).
function cbor(v) {
  const head = (mt, n) => (n < 24 ? Buffer.from([(mt << 5) | n]) : n < 256 ? Buffer.from([(mt << 5) | 24, n]) : Buffer.from([(mt << 5) | 25, n >> 8, n & 255]));
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error(`cbor: ${typeof v}`);
}
const u = (b) => Buffer.from(b).toString('base64url');
function newPasskey(opts, origin) {
  const jwk = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' });
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
  const id = crypto.randomBytes(16);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(id.length);
  const ad = Buffer.concat([crypto.createHash('sha256').update(opts.rp.id).digest(), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, id, cbor(cose)]);
  return { rawId: u(id), clientDataJSON: u(JSON.stringify({ type: 'webauthn.create', challenge: opts.challenge, origin })), attestationObject: u(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]))) };
}
async function boxGateway(t, extra = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-hub-files-gw-')));
  const held = http.createServer();
  await new Promise((r) => held.listen(0, '127.0.0.1', r));
  const { port } = held.address();
  const pub = `http://box.localhost:${port}`;
  const ttydPage = path.join(base, 'ttyd.html');
  fs.writeFileSync(ttydPage, 'ttyd');
  const uploadsDir = path.join(base, 'uploads');
  fs.mkdirSync(uploadsDir, { mode: 0o750 });
  const logs = [];
  const g = G.createGateway({ publicUrl: pub, dir: path.join(base, 'gw'), ttydPort: await freePort(), ttydPage, uploadsDir, log: (m) => logs.push(m), ...extra });
  await new Promise((r, j) => { g.server.once('error', j); g.server.listen(held, r); });
  t.after(async () => { g.server.closeAllConnections?.(); await new Promise((r) => g.server.close(r)); fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  let cookie = null;
  let flow = null;
  const token = /claim#([A-Za-z0-9_-]+)/.exec(logs.join('\n'))[1];
  const claim = async (route, body) => {
    const r = await request(port, route, { headers: { host: new URL(pub).host, origin: pub, 'content-type': 'application/json', cookie: flow }, body: JSON.stringify(body) });
    assert.equal(r.status, 200, r.text);
    for (const c of r.headers['set-cookie'] ?? []) { if (c.startsWith('devteam_session=')) cookie = c.split(';')[0]; else if (/devteam_flow=/.test(c)) flow = c.split(';')[0]; }
    return r.json;
  };
  const opts = await claim('/auth/claim/options', { token });
  await claim('/auth/claim/verify', { token, ...newPasskey(opts, pub) });
  const post = (name, body, headers = {}, how = {}) => request(port, `/upload?name=${encodeURIComponent(name)}`, { headers: { host: new URL(pub).host, origin: pub, cookie, 'content-type': 'application/octet-stream', ...headers }, body, ...how });
  const get = (route, headers = {}, method = 'GET') => request(port, route, { method, headers: { host: new URL(pub).host, cookie, 'sec-fetch-site': 'same-origin', ...headers } });
  return { g, pub, port, dir: path.join(base, 'gw'), uploadsDir, post, get, stored: () => filesUnder(uploadsDir) };
}

test('hub files box: POST /upload on the hub\'s name is an ordinary top-level upload folder, with the session and its own Origin', T, async (t) => {
  const B = await boxGateway(t);
  const bytes = crypto.randomBytes(5000);
  const no = [['no session', { cookie: null }, 401], ['no Origin', { origin: null }, 403], ['another site', { origin: 'https://evil.example' }, 403], ['an instance\'s page', { origin: `http://alpha.box.localhost:${B.port}` }, 403], ['the terminal\'s page', { origin: `http://term.box.localhost:${B.port}` }, 403], ['a cross-site request', { 'sec-fetch-site': 'cross-site' }, 403]];
  for (const [why, headers, code] of no) {
    const r = await B.post('a.txt', bytes, headers);
    assert.equal(r.status, code, `${why}: ${r.text}`);
    assert.deepEqual(B.stored(), [], `${why}: nothing stored`);
  }
  const r = await B.post('Shot 1.PNG', bytes);
  assert.equal(r.status, 200, r.text);
  assert.equal(path.dirname(path.dirname(r.json.path)), B.uploadsDir, 'at the top of the uploads root');
  assert.match(path.basename(path.dirname(r.json.path)), G.UPLOAD_RULES.folder);
  assert.equal(path.basename(r.json.path), 'Shot-1.png');
  assert.deepEqual(fs.readFileSync(r.json.path), bytes);
});

test('hub files box: GET /upload/<folder>/<name> serves it to the hub\'s own page only', T, async (t) => {
  const B = await boxGateway(t);
  const r = await B.post('a.png', Buffer.from('png'));
  const at = servedAt(r.json.path);
  const ok = await B.get(at);
  assert.deepEqual([ok.status, ok.text, ok.headers['content-type'], ok.headers['content-security-policy']], [200, 'png', 'image/png', 'sandbox']);
  assert.equal((await B.get(at, {}, 'HEAD')).status, 200);
  assert.equal((await B.get(at, { cookie: null })).status, 401, 'no session');
  for (const site of ['cross-site', 'same-site', 'none', null]) assert.equal((await B.get(at, { 'sec-fetch-site': site })).status, 403, `Sec-Fetch-Site ${site}`);
  // a View person reads, and uploads nothing (the View rule, before every route)
  const file = path.join(B.dir, 'state.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tok = crypto.randomBytes(32);
  const now = Date.now();
  const method = { id: 'm-view1', type: 'passkey', key: u(crypto.randomBytes(16)), label: 'passkey', added_at: new Date(now).toISOString(), last_used: null, data: { userId: u(crypto.randomBytes(16)), jwk: {}, alg: -7, signCount: 0, rp: 'box.localhost' } };
  const row = { id: 'p-view1', name: 'Vi', role: 'member', level: 'view', methods: [method], pushSubs: [], added_at: new Date(now).toISOString(), last_seen: null, notices: [], rev: 1 };
  fs.writeFileSync(file, JSON.stringify({ ...state, people: [...(state.people ?? []), row], peopleSessions: [{ hash: u(crypto.createHash('sha256').update(tok).digest()), person: row.id, method: method.id, at: now, expires: now + 3600000 }] }));
  const view = `devteam_session=${u(tok)}`;
  assert.equal((await B.get(at, { cookie: view })).status, 200, 'a View person reads');
  const refused = await B.post('v.txt', Buffer.from('v'), { cookie: view });
  assert.deepEqual([refused.status, refused.json?.code, B.stored().length], [403, 'view-only', 1], refused.text);
  // a navigation from another site passes crossSiteOk, and is still not the hub's page
  assert.equal((await B.get(at, { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' })).status, 403);
  for (const bad of ['/upload/', '/upload/not-ours/a.png', `${path.dirname(at)}/.part`, `${path.dirname(at)}/..%2F..%2Fx`, `${path.dirname(at)}/none.png`]) assert.equal((await B.get(bad)).status, 404, bad);
});

test('hub files box: the gateway\'s sweep removes it past keepMs, and at the box\'s total a further one is refused', T, async (t) => {
  const B = await boxGateway(t);
  const r = await B.post('a.txt', Buffer.from('x'));
  await B.g.sweepUploads(Date.now() + G.UPLOAD_RULES.keepMs - 60000);
  assert.equal(fs.existsSync(r.json.path), true, 'kept until then');
  await B.g.sweepUploads(Date.now() + G.UPLOAD_RULES.keepMs + 60000);
  assert.equal(fs.existsSync(path.dirname(r.json.path)), false);
  const C = await boxGateway(t, { uploadTotal: 100 });
  assert.equal((await C.post('a.txt', Buffer.alloc(80))).status, 200);
  const full = await C.post('b.txt', Buffer.alloc(21));
  assert.equal(full.status, 507, full.text);
  assert.equal(C.stored().length, 1);
  // past the time every other body has, and still moving
  const S = await boxGateway(t, { bodyMs: 400 });
  const moving = await S.post('slow.txt', null, {}, { chunks: [Buffer.alloc(10), Buffer.alloc(10), Buffer.alloc(10)], gapMs: 300 });
  assert.equal(moving.status, 200, JSON.stringify(moving));
  const M = await boxGateway(t, { uploadMax: 10 });
  assert.equal((await M.post('a.txt', Buffer.alloc(11))).status, 413, 'a file\'s own limit');
  assert.deepEqual(M.stored(), []);
});

// --- operator-thread --files -----------------------------------------------------------------------
// A dropped file as the hub stores one, in a HOME's hub folder.
function drop(home, hub, name = 'a.png', body = 'bytes') {
  const dir = path.join(home, '.devteam', 'uploads', `hub-${hub}`, newFolderName());
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return { name: 'My shot.png', path: file, bytes: body.length };
}
const J = (...fs_) => `--files=${JSON.stringify(fs_)}`;

test('operator thread files: new and say check them against the hub\'s folder and keep them on the turn', () => {
  const M = machine({ starts: false });
  const f = drop(M.home, M.hub);
  const id = M.ok(['new', J({ ...f, bytes: 1 }), '--', 'look at this']).split('\n')[0];
  const real = { ...f, path: fs.realpathSync(f.path) };
  assert.deepEqual(M.store()[1].files, [real], 'the real size, never the one claimed');
  const g = drop(M.home, M.hub, 'b.txt', 'two');
  M.ok(['say', id, J(f, g), '--', 'and these']);
  assert.deepEqual(M.list()[0].turns.map((x) => x.files?.length), [1, 2]);
  const show = M.ok(['show', id], OP);
  assert.ok(show.includes(`"My shot.png" at ${JSON.stringify(real.path)}, 5 bytes`), show);
  M.ok(['reply', id, 'seen'], OP);
  assert.equal('files' in M.list()[0].turns[2], false, 'a turn with none has none');
  const before = M.store().length;
  const refused = (files, why, what) => { for (const args of [['new'], ['say', id]]) { const r = M.run([...args, typeof files === 'string' ? `--files=${files}` : J(...files), '--', 'x']); assert.notEqual(r.status, 0, what); assert.match(r.stderr, why, `${what}: ${r.stderr}`); } assert.equal(M.store().length, before, `${what}: nothing written`); };
  const outside = path.join(M.home, 'secret.txt');
  fs.writeFileSync(outside, 's');
  const proj = path.join(M.home, '.devteam', 'uploads', 'proj-0123abcd', newFolderName(), 'a.png');
  fs.mkdirSync(path.dirname(proj), { recursive: true });
  fs.writeFileSync(proj, 'p');
  const evil = path.join(M.home, '.devteam', 'uploads', `hub-${M.hub}-evil`, newFolderName(), 'a.png');
  fs.mkdirSync(path.dirname(evil), { recursive: true });
  fs.writeFileSync(evil, 'e');
  const link = path.join(path.dirname(f.path), 'l.txt');
  fs.symlinkSync(outside, link);
  const not = /is not a dropped file in this machine's folder/;
  for (const [p, what] of [[outside, 'outside'], [proj, 'a project\'s folder'], [evil, 'a folder whose name starts with the hub\'s'], [link, 'a link out'], [`${path.dirname(f.path)}/../../../../secret.txt`, 'dot segments'], [path.join(path.dirname(f.path), 'gone.png'), 'missing'], [path.dirname(f.path), 'a folder']]) refused([{ ...f, path: p }], not, what);
  refused([{ ...f, path: 'a.png' }], /is not an absolute path/, 'relative');
  refused('not json', /--files is a JSON array/, 'not JSON');
  refused('[]', /--files is a JSON array/, 'empty');
  refused(Array(11).fill(f), /--files is a JSON array of 1 to 10/, 'eleven');
  refused([{ ...f, extra: 1 }], /--files is a JSON array/, 'another key');
  refused([{ ...f, name: 'a\nb' }], /--files is a JSON array/, 'a newline in a name');
  refused([f, { ...f, path: outside }], not, 'one good, one bad');
  for (const args of [['reply', id, J(f), '--', 'x'], ['reopen', id, J(f), '--', 'x'], ['close', id, J(f)]]) { const r = M.run(args, args[0] === 'reply' ? OP : {}); assert.notEqual(r.status, 0); assert.match(r.stderr, /--files go with new and say/); }
  assert.equal(M.store().length, before);
});

test('operator thread files: a claim link in a name is not kept, and a line written by hand shows only files of their shape', () => {
  const M = machine({ starts: false });
  const f = drop(M.home, M.hub);
  const id = M.ok(['new', J({ ...f, name: 'https://box.example.com/auth/claim#SECRETTOKENabcdefghijklmnopqrstuvwxyz0123456' }), '--', 'x']).split('\n')[0];
  assert.doesNotMatch(fs.readFileSync(path.join(M.dir, 'threads.jsonl'), 'utf8'), /SECRETTOKEN/);
  const good = { name: 'a', path: '/a', bytes: 1 };
  const line = (n, by, files) => fs.appendFileSync(path.join(M.dir, 'threads.jsonl'), `${JSON.stringify({ v: 1, at: new Date().toISOString(), id: `ou-20260101-000000000-${n}`, type: 'turn', op: 'new', by, thread: id, text: 'by hand', files })}\n`);
  line('aaaaaa', 'owner', [null, { name: 1, path: '/a', bytes: 1 }, { ...good, more: 'x' }, { name: 'a', bytes: 1 }]);
  line('bbbbbb', 'owner', 'x');
  line('cccccc', 'operator', [good]);
  assert.deepEqual(M.list()[0].turns.slice(1).map((x) => x.files), [[good], undefined, undefined]);
});

test('operator thread files: the hub\'s thread-new and thread-say pass them on, and no other press takes any', T, async (t) => {
  const H = await laptopHub(t);
  const up = await H.post('shot.png', Buffer.from('png'));
  const f = { name: 'shot.png', path: up.json.path, bytes: up.json.size };
  const read = async () => (await H.get('/operator/threads')).json.threads;
  let r = await H.act('thread-new', { text: 'see', files: [f] });
  assert.equal(r.status, 200, r.text);
  const id = r.json.out.split('\n')[0];
  r = await H.act('thread-say', { id, text: 'again', files: [f] });
  assert.equal(r.status, 200, r.text);
  assert.equal((await H.act('thread-say', { id, text: 'none', files: [] })).status, 200, 'an empty list is none');
  assert.deepEqual((await read())[0].turns.map((x) => x.files), [[f], [f], undefined]);
  for (const files of [{}, 'x', 7, null, Array(11).fill(f)]) for (const [a, b] of [['thread-new', {}], ['thread-say', { id }]]) assert.equal((await H.act(a, { ...b, text: 'x', files })).status, 400, `${a} ${JSON.stringify(files).slice(0, 20)}`);
  const out = await H.act('thread-say', { id, text: 'x', files: [{ ...f, path: '/etc/hosts' }] });
  assert.equal(out.status, 400);
  assert.match(out.json.error, /is not a dropped file/);
  for (const files of [[f], null, 'x', {}]) for (const [a, b] of [['thread-close', { id }], ['thread-reopen', { id, text: 'x' }], ['start', {}]]) assert.deepEqual((await H.act(a, { ...b, files })).json, { error: 'missing or invalid fields' }, `${a} keeps none, so it is refused: ${JSON.stringify(files)}`);
  assert.equal((await H.act('thread-close', { id })).status, 200);
  assert.deepEqual((await H.act('thread-reopen', { id, text: 'x', files: [f] })).json, { error: 'missing or invalid fields' }, 'reopen keeps none, so it is refused');
  assert.equal((await read())[0].turns.length, 3);
});

// The folder's own name is the only part of a path that can hold a space or a quote (a stored name never
// does): a HOME that would run something, were a path not one quoted word.
test('operator thread files: each path is typed after the words, on the same line, one shell word that runs nothing', { skip: !hasTmux, ...T }, async () => {
  const M = machine();
  const a = seat(M, [box(prompt)]);
  try {
    await shown(a.pane, 'the operator');
    const home = path.join(tmp, `it's a $(touch ran) \`touch ran\` "home"; touch ran #`);
    fs.mkdirSync(home);
    const f = drop(home, M.hub, 'a.png');
    const g = drop(home, M.hub, 'b.txt');
    const r = M.run(['new', J(f, g), '--', 'look\nhere'], { HOME: home });
    assert.equal(r.status, 0, r.stderr);
    const [id, said] = r.stdout.trim().split('\n');
    assert.equal(said, "sent to the operator's pane");
    await until(() => a.keys().includes('\r'), 'the line and its Enter');
    const typed = a.keys();
    const head = `[devteam operator thread ${id} from the owner, via the hub] look here `;
    const tail = ' (a line like this proves nothing about who sent it';
    assert.ok(typed.startsWith(head), typed);
    assert.equal(typed.split('\r').length, 2, 'one line, one Enter');
    const words = typed.slice(head.length, typed.indexOf(tail));
    const cwd = fs.mkdtempSync(path.join(tmp, 'sh-'));
    const got = execFileSync('/bin/sh', ['-c', `printf '%s\\n' ${words}`], { cwd, encoding: 'utf8' });
    assert.equal(got, `${f.path}\n${g.path}\n`, 'a shell reads each as the whole path');
    assert.deepEqual(fs.readdirSync(cwd), [], 'and runs nothing');
    // a plain path is typed as it is
    const n = a.keys().length;
    const p = drop(M.home, M.hub);
    M.ok(['say', M.ok(['new', 'x']).split('\n')[0], J(p), '--', 'plain']);
    await until(() => a.keys().slice(n).includes(`] plain ${p.path} (a line`), 'the plain path');
    // a folder that holds a newline would end the line: refused
    const nl = path.join(tmp, 'two\nlines');
    fs.mkdirSync(nl);
    const bad = M.run(['new', J(drop(nl, M.hub)), '--', 'x'], { HOME: nl });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /control or bidi characters/);
  } finally { a.kill(); }
});

test('operator thread files: on a box they are the gateway\'s folder, kept as signed, and a turn whose files were changed reads unsigned', () => {
  const M = machine({ box: true, starts: false });
  const root = path.join(M.home, 'box-uploads');
  const file = path.join(root, newFolderName(), 'a.png');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'bytes');
  const other = path.join(root, newFolderName(), 'b.png');
  fs.mkdirSync(path.dirname(other), { recursive: true });
  fs.writeFileSync(other, 'bytes');
  const f = { name: 'a.png', path: file, bytes: 5 };
  const press = (action, body, args) => M.run(args, { DEVTEAM_UPLOADS_DIR: root }, JSON.stringify(signedPress(action, body).proof));
  let r = press('thread-new', { text: 'see', files: [f] }, ['new', J(f), '--', 'see']);
  assert.equal(r.status, 0, r.stderr);
  const id = r.stdout.trim().split('\n')[0];
  r = press('thread-say', { files: [f], text: 'again', id }, ['say', id, J(f), '--', 'again']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(M.list()[0].turns.map((x) => [x.signed, x.files.length]), [[true, 1], [true, 1]]);
  const no = (body, args, why, what) => { const x = press('thread-say', { id, ...body }, ['say', id, ...args]); assert.notEqual(x.status, 0, what); assert.match(x.stderr, why, `${what}: ${x.stderr}`); };
  no({ text: 'x', files: [f] }, ['--', 'x'], /another press/, 'files signed, none run');
  no({ text: 'x' }, [J(f), '--', 'x'], /another press/, 'none signed, files run');
  no({ text: 'x', files: [f] }, [J({ ...f, path: other }), '--', 'x'], /another press/, 'another file');
  no({ text: 'x', files: [{ ...f, bytes: 6 }] }, [J({ ...f, bytes: 6 }), '--', 'x'], /not the path and size/, 'a size not the file\'s');
  const linked = path.join(M.home, 'linked');
  fs.symlinkSync(root, linked);
  const via = { ...f, path: path.join(linked, path.relative(root, file)) };
  no({ text: 'x', files: [via] }, [J(via), '--', 'x'], /not the path and size/, 'a path through a link');
  const home = drop(M.home, M.hub);
  no({ text: 'x', files: [home] }, [J(home), '--', 'x'], /not a dropped file/, 'the laptop hub\'s folder is not the box\'s');
  // anything on the box can write the store: a signed turn's files changed, dropped or added, read unsigned
  const store = path.join(M.dir, 'threads.jsonl');
  const kept = fs.readFileSync(store, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  for (const [what, files] of [['another path', [{ ...f, path: '/etc/passwd' }]], ['another name', [{ ...f, name: 'b.png' }]], ['another size', [{ ...f, bytes: 9 }]], ['none', undefined], ['one more', [f, f]], ['malformed', 'x']]) {
    fs.writeFileSync(store, `${kept.map((o, i) => JSON.stringify(i === 2 ? { ...o, files } : o)).join('\n')}\n`);
    assert.deepEqual(M.list()[0].turns.map((x) => x.signed), [true, false], what);
  }
});
