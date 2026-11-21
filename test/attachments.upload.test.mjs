// Dropped files: the upload rules, the laptop's and the box's upload and serve routes, and the sweeps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { expectedFolder, laptop, LAPTOP, newFolderName, P, R, request, rulesFromKit } from './lib/attachments-fixture.mjs';
import { until } from './lib/kit.mjs';

const G = await import('../cloud/gateway.mjs');

const NAMES = [
  '../../etc/passwd', '..\\..\\windows\\system.ini', '..', '.', '', '.bashrc', '/',
  'a\u0000b\n\r\u001b[31m.PNG', '$(rm -rf ~).txt', '`id`;x\'y".pdf', '--help.txt',
  'café ‮evil.JPG', '日本語.png', 'archive.tar.GZ', 'no-extension', 'dots....', 'x.has spaces in ext',
  '.part', 'a'.repeat(300) + '.png', 'b'.repeat(250), 'x.' + 'y'.repeat(20), '....png', 'Ünïcödé.WEBP', 'a/b\\c.txt', '%2e%2e.txt', ' ', '.jpeg', 'A B.png', 'file.PDF', 'tab\there.txt',
];
const PATHS = [['/u/a.png'], ['/u/a.png', '/u/b.pdf'], ["/u/it's.txt"], ['/u/a.JPEG', '/u/b.webp'], ['/u/a.gif', '/u/a.jpg', '/u/a.pngx'], ['/u/a b.txt', '/u/$x.txt', '/u/me@x.txt']];
const plain = (r) => ({ ...r, folder: { source: r.folder.source, flags: r.folder.flags } });
const ON_A_BOX = fs.existsSync('/opt/devteam/gateway.mjs');
const ourFolders = (dir) => { try { return fs.readdirSync(dir).filter((n) => R.folder.test(n)).sort(); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } };

// A body sent by hand, a chunk every `everyMs` for `chunks` chunks; or, with `hold`, one chunk and then
// nothing. Resolves with the answer, or how the connection ended.
function dripped(L, route, headers, { chunks = 1, everyMs = 100, hold = false }) {
  return new Promise((resolve) => {
    const size = hold ? 100 : chunks * 10;
    const r = http.request({ host: '127.0.0.1', port: L.port, path: route, method: 'POST', agent: false, headers: { host: `127.0.0.1:${L.port}`, origin: `http://127.0.0.1:${L.port}`, 'sec-fetch-site': 'same-origin', 'content-length': String(size), ...headers } });
    r.on('response', (res) => { const bufs = []; res.on('data', (b) => bufs.push(b)); res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(bufs).toString('utf8') })); res.on('error', (e) => resolve({ error: e.code ?? e.message })); });
    r.on('error', (e) => resolve({ error: e.code ?? e.message }));
    let sent = 0;
    const next = () => { if (r.destroyed) return; sent++; if (hold || sent < chunks) { r.write(Buffer.alloc(10, 0x61)); if (!hold) setTimeout(next, everyMs); } else r.end(Buffer.alloc(10, 0x61)); };
    next();
  });
}

// An upload whose body is sent by hand: the declared size and a first chunk now, the rest when the
// test says. Nothing is written while it's held, so nothing touches the .part's mtime.
function heldUpload(L, name, size) {
  let r;
  const answer = new Promise((resolve) => {
    r = http.request({ host: '127.0.0.1', port: L.port, path: `/upload?name=${encodeURIComponent(name)}`, method: 'POST', agent: false, headers: { host: `127.0.0.1:${L.port}`, origin: `http://127.0.0.1:${L.port}`, 'sec-fetch-site': 'same-origin', 'content-length': String(size) } });
    r.on('response', (res) => { const bufs = []; res.on('data', (b) => bufs.push(b)); res.on('end', () => { const text = Buffer.concat(bufs).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, text, json }); }); res.on('error', (e) => resolve({ error: e.code ?? e.message })); });
    r.on('error', (e) => resolve({ error: e.code ?? e.message }));
  });
  let status = null;
  answer.then((a) => { status = a.status ?? a.error; });
  r.write(Buffer.alloc(1, 0x61));
  return { answer, status: () => status, rest: () => r.end(Buffer.alloc(size - 1, 0x62)) };
}

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
// A port the OS gives now and that stays bound: the gateway listens on this very socket later
// (listen(handle)), so no other process can take the port in between.
const boundPort = () => new Promise((resolve, reject) => { const v = http.createServer(); v.on('error', reject); v.listen(0, '127.0.0.1', () => resolve({ port: v.address().port, held: v })); });
async function boxGateway(t, extra = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-attach-gw-'));
  const { port, held } = await boundPort();
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
  await new Promise((r, j) => { g.server.once('error', j); g.server.listen(held, r); });
  t.after(async () => { g.server.closeAllConnections?.(); await new Promise((r) => g.server.close(r)); fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const token = /claim#([A-Za-z0-9_-]+)/.exec(logs.join('\n'))?.[1];
  let jar = '';
  let flowJar = ''; // the flow cookie of a passkey ceremony, sent to the box's own name beside the session
  // on: 'term', 'public', 'box', or an instance's port (the default, P). Headers set to undefined are left out.
  const req = (method, route, { body, headers = {}, cookie = jar, flow, on = P } = {}) => new Promise((resolve, reject) => {
    const self = on === 'box' ? publicUrl : on === 'term' ? term : on === 'public' ? site : inst(on);
    const sent = [cookie, self === publicUrl ? (flow ?? flowJar) : ''].filter(Boolean).join('; ');
    const h = { host: new URL(self).host, ...(method !== 'GET' && method !== 'HEAD' ? { origin: self, 'content-type': 'application/json' } : {}), ...(sent ? { cookie: sent } : {}), ...headers };
    for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
    const r = http.request({ host: '127.0.0.1', port, method, path: route, headers: h, agent: false }, (res) => {
      const bufs = [];
      res.on('data', (c) => bufs.push(c));
      res.on('end', () => {
        const sc = res.headers['set-cookie']?.find((c) => c.startsWith('devteam_session='));
        if (sc) jar = sc.split(';')[0];
        if (flow !== '') for (const c of res.headers['set-cookie'] ?? []) if (/^(?:__Host-)?devteam_flow=/.test(c)) flowJar = /;\s*Max-Age=0\b/i.test(c) ? '' : c.split(';')[0];
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
  // a folder named as ours that is itself a link out of the root, to a plain file with a safe name:
  // only the realpath of the whole path sees it is outside (final review F1)
  const away = `${root}-away`;
  fs.mkdirSync(away);
  fs.writeFileSync(path.join(away, 'x.txt'), 'away');
  const linked = `${folder.slice(0, 11)}${crypto.randomBytes(12).toString('hex')}`;
  fs.symlinkSync(away, path.join(root, linked));
  return [
    `/upload/${linked}/x.txt`,
    '/upload/../x', '/upload/%2e%2e/%2e%2e/etc/passwd', `/upload/${folder}/..%2F..%2Fetc%2Fpasswd`, `/upload/${folder}%2Fa.txt`, '/upload/not-ours/a.txt', '/upload/2026-01-01-zzzzzzzzzzzzzzzzzzzzzzzz/a.txt',
    `/upload/${folder}/a.txt%2F`, `/upload/${folder}/.part`, `/upload/${folder}/sub/x.txt`, `/upload/${folder}/sub`, `/upload/${folder}/A%20B.png`, `/upload/${folder}/Upper.PNG`, `/upload/${folder}/-x.txt`, `/upload/${folder}`, `/upload/${folder}/`, '/upload/',
    `/upload/${folder}/hosts.txt`, `/upload/${folder}/x.txt`, `/upload/${folder}/other.txt`, `/upload/${folder}/same.txt`, `/upload/${folder}/missing.txt`, `/upload/./${folder}/a.txt`, `/upload//${folder}/a.txt`,
  ];
}

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

test('laptop upload: a body still moving past the five minutes every other route keeps is taken (final review F3, the test-only override)', LAPTOP, async (t) => {
  // those five minutes lowered to 300 ms; the stall timer (60 s) is as it is
  const L = await laptop(t, { DEVTEAM_UPLOAD_BODY_MS: '300' });
  const started = Date.now();
  const up = await dripped(L, '/upload?name=slow.bin', {}, { chunks: 15, everyMs: 100 });
  assert.ok(Date.now() - started > 900, 'the upload took longer than the body timer');
  assert.equal(up.status, 200, JSON.stringify(up));
  assert.equal(JSON.parse(up.text).size, 150);
  // any other body that is still coming at the timer is cut, as before
  const held = await Promise.race([dripped(L, '/api/answer', { 'content-type': 'application/json' }, { hold: true }), new Promise((w) => setTimeout(() => w({ timedOut: true }), 3000))]);
  assert.ok(!held.timedOut, 'another route\'s body still coming is cut within 3 s');
  assert.ok(held.error || held.status >= 400, JSON.stringify(held));
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
  // a folder named as ours that is a link out of the root, to a folder the sweep would take if it were ours:
  // the sweep removes neither the link nor anything it points at (final review F1)
  const away = `${root}-away`;
  fs.mkdirSync(away);
  for (const f of ['x.txt', R.part]) { fs.writeFileSync(path.join(away, f), 'away'); fs.utimesSync(path.join(away, f), now - R.keepMs / 1000 - 60, now - R.keepMs / 1000 - 60); }
  fs.utimesSync(away, now - R.keepMs / 1000 - 60, now - R.keepMs / 1000 - 60);
  const linked = newFolderName('2026-01-01');
  fs.symlinkSync(away, path.join(root, linked));
  const r = await L.post('next.txt', Buffer.from('next'));
  assert.equal(r.status, 200, r.text);
  const made = path.basename(path.dirname(r.json.path));
  assert.deepEqual(fs.readdirSync(root).sort(), [first, fresh, freshPart, freshEmpty, made, notOurs, linked].sort());
  assert.deepEqual(fs.readdirSync(away).sort(), [R.part, 'x.txt'].sort(), 'the sweep followed a linked folder');
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

test('laptop upload: uploads at once count each other against the total, and the sweep leaves a folder being received (Edge cases, B-1, T2-2)', LAPTOP, async (t) => {
  const SIZE = 1000, TOTAL = 3000, N = 4;
  const L = await laptop(t, { DEVTEAM_UPLOAD_TOTAL: String(TOTAL) });
  const root = L.folder();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  // fresh folders of ours, each with an empty file: they count 0 bytes and stay, but each costs the
  // sweep some reads, so uploads that start together are all in it at once
  const seeded = new Set();
  for (let i = 0; i < 300; i++) { const n = newFolderName(); fs.mkdirSync(path.join(root, n), { mode: 0o700 }); fs.writeFileSync(path.join(root, n, 'e.txt'), ''); seeded.add(n); }
  const receivingNow = () => ourFolders(root).filter((n) => !seeded.has(n) && fs.existsSync(path.join(root, n, R.part)));
  // all at once, each declaring its size and held after its first byte: together past the total
  const ups = Array.from({ length: N }, (_, i) => heldUpload(L, `u${i}.bin`, SIZE));
  await until(() => receivingNow().length + ups.filter((u) => u.status() !== null).length === N, 'each upload to be receiving or answered');
  const refused = ups.filter((u) => u.status() !== null);
  assert.ok(refused.length >= 1, `${N} uploads of ${SIZE} bytes at once were all taken under a total of ${TOTAL}`);
  for (const u of refused) assert.equal(u.status(), 507, JSON.stringify(await u.answer));
  assert.match((await refused[0].answer).json?.error ?? '', /already holds/);
  const taking = ups.filter((u) => u.status() === null);
  assert.ok(taking.length * SIZE <= TOTAL, `${taking.length} taken at once`);
  // the folders being received look cut off (a .part untouched for an hour), and an upload's sweep
  // runs over them: the live map keeps them
  const inFlight = receivingNow();
  const hourAgo = Date.now() / 1000 - 3600;
  for (const n of inFlight) { fs.utimesSync(path.join(root, n, R.part), hourAgo, hourAgo); fs.utimesSync(path.join(root, n), hourAgo, hourAgo); }
  const sweeper = await L.post('sweep.txt', Buffer.from('x'));
  assert.equal(sweeper.status, 507, sweeper.text);
  for (const n of inFlight) assert.ok(fs.existsSync(path.join(root, n, R.part)), `the sweep removed ${n}, a folder being received`);
  for (const u of taking) u.rest();
  for (const u of taking) { const a = await u.answer; assert.equal(a.status, 200, JSON.stringify(a)); assert.equal(a.json.size, SIZE); }
  // what's kept never passed the total
  let stored = 0;
  for (const n of ourFolders(root)) for (const f of fs.readdirSync(path.join(root, n))) stored += fs.statSync(path.join(root, n, f)).size;
  assert.ok(stored <= TOTAL, `${stored} bytes kept, over ${TOTAL}`);
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
  // a folder named as ours that is a link out of the root, to a folder the sweep would take if it were ours:
  // the sweep removes neither the link nor anything it points at (final review F1)
  const away = `${root}-away`;
  fs.mkdirSync(away);
  for (const f of ['x.txt', R.part]) { fs.writeFileSync(path.join(away, f), 'away'); fs.utimesSync(path.join(away, f), now - R.keepMs / 1000 - 60, now - R.keepMs / 1000 - 60); }
  fs.utimesSync(away, now - R.keepMs / 1000 - 60, now - R.keepMs / 1000 - 60);
  const linked = newFolderName('2026-01-01');
  fs.symlinkSync(away, path.join(root, linked));
  const r = await boxUpload(gw, 'next.txt', Buffer.from('next'));
  assert.equal(r.status, 200, r.text);
  const made = path.basename(path.dirname(r.json.path));
  // the one difference from the laptop (§3 step 6): only one gateway writes its root, so any .part or empty folder at its first scan was cut off
  assert.deepEqual(fs.readdirSync(root).sort(), [fresh, made, notOurs, linked].sort());
  assert.deepEqual(fs.readdirSync(away).sort(), [R.part, 'x.txt'].sort(), 'the sweep followed a linked folder');
  for (const gone of [old, stalePart, empty, freshEmpty, freshPart]) assert.ok(!fs.existsSync(path.join(root, gone)), gone);
});
