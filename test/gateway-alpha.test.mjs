// The box's gateway serves the alpha hub at <box>/next/ (kit-962; alpha@1 step 4, alpha-build@1's
// serving table, kit-install@1's verified record). The gateway's alpha folder is the image's own
// install (DEVTEAM_ALPHA_DIR, /opt/devteam/alpha on the box): verified.json, the pin pair and
// node_modules/<name>/, whose docs/devteam/alpha/hub/ is what /next/ serves, only when the record says
// both checks passed and agrees with the pair. Anything else, or DEVTEAM_ALPHA=0, is the why-page.
// Here the folder is a copy of test/fixtures/kit-install's verified tree holding test/fixtures/
// alpha-build's hub export, in a scratch dir, with a scratch HOME and DEVTEAM_GATEWAY_DIR, ports
// away from 4320 and every other DEVTEAM_* variable unset.
// Ports: +2 the stand-in hub, +50 the stand-in project dashboard (its scan block +50..+74).
// Run: node --test test/gateway-alpha.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTS, freePort } from './lib/kit.mjs';

// lib/kit.mjs has dropped every DEVTEAM_* of the shell (its HARNESS_ENV switches aside); this file
// sets only the hub's port, the instance block and the gateway's state folder, before the import.
const HUB = PORTS + 2;
const BASE = PORTS + 50;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-gwalpha-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
process.env.HOME = path.join(scratch, 'home');
fs.mkdirSync(process.env.HOME);
process.env.DEVTEAM_HUB_PORT = String(HUB);
process.env.DEVTEAM_PORT_BASE = String(BASE);
process.env.DEVTEAM_GATEWAY_DIR = path.join(scratch, 'gateway');
for (const k of ['DEVTEAM_ALPHA', 'DEVTEAM_ALPHA_DIR', 'DEVTEAM_KIT_RELEASE', 'DEVTEAM_BOX_TOOLS', 'DEVTEAM_PUBLIC_URL']) delete process.env[k];
const G = await import('../cloud/gateway.mjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(here, 'fixtures');
const TABLE = JSON.parse(fs.readFileSync(path.join(FX, 'alpha-serving.json'), 'utf8'));
const HASHES = JSON.parse(fs.readFileSync(path.join(FX, 'alpha-build', 'hub', 'out', 'csp-hashes.json'), 'utf8')).pages;
const NAME = '@sanctuarycomputer/devteam';
const TREES = path.join(FX, 'kit-install', 'kit-link');

// --- the alpha folders ----------------------------------------------------------------------------
// One of kit-install's trees, copied whole, with the hub export at node_modules/<name>/docs/devteam/
// alpha/hub/, the table's outside file beside that folder and its symlink case inside it.
function alphaFolder(name, tree, { pages = true, edit } = {}) {
  const dir = path.join(scratch, 'alpha', name);
  fs.cpSync(path.join(TREES, tree), dir, { recursive: true });
  const hub = path.join(dir, 'node_modules', NAME, 'docs', 'devteam', 'alpha', 'hub');
  if (pages) {
    fs.cpSync(path.join(FX, 'alpha-build', 'hub', 'out'), hub, { recursive: true });
    fs.writeFileSync(path.resolve(hub, TABLE.outside.at), TABLE.outside.text);
    for (const c of TABLE.cases) if (c.symlink) fs.symlinkSync(c.symlink.to, path.join(hub, c.symlink.at));
  }
  if (edit) edit(dir);
  return { dir, hub };
}
const GOOD = alphaFolder('good', '0.101.0-63959e27d616');
const UNVERIFIED = alphaFolder('unverified', '0.100.0-2adfe5123521');
const NO_PROVENANCE = alphaFolder('no-provenance', '0.99.0-d12588c848a5');
const NO_PAGES = alphaFolder('no-pages', '0.101.0-63959e27d616', { pages: false });
const PAIR_DIFFERS = alphaFolder('pair-differs', '0.101.0-63959e27d616', {
  edit: (dir) => {
    const f = path.join(dir, 'package-lock.json');
    const lock = JSON.parse(fs.readFileSync(f, 'utf8'));
    lock.packages[`node_modules/${NAME}`].integrity = `sha512-${Buffer.alloc(64, 7).toString('base64')}`;
    fs.writeFileSync(f, `${JSON.stringify(lock, null, 2)}\n`);
  },
});
const NONE = path.join(scratch, 'alpha', 'not-there');
const EMPTY = path.join(scratch, 'alpha', 'empty');
fs.mkdirSync(EMPTY, { recursive: true });
const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const put = (f, o) => fs.writeFileSync(f, `${JSON.stringify(o, null, 2)}\n`);
const PKG = (dir) => path.join(dir, 'node_modules', NAME);
// The record's other rules (kit-install@1's reader), one broken in each copy of the good tree.
const RECORD_LINK = alphaFolder('record-link', '0.101.0-63959e27d616', {
  edit: (dir) => {
    const elsewhere = path.join(scratch, 'alpha', 'record-elsewhere.json');
    fs.renameSync(path.join(dir, 'verified.json'), elsewhere);
    fs.symlinkSync(elsewhere, path.join(dir, 'verified.json'));
  },
});
const RECORD_BIG = alphaFolder('record-big', '0.101.0-63959e27d616', {
  edit: (dir) => fs.writeFileSync(path.join(dir, 'verified.json'), `${fs.readFileSync(path.join(dir, 'verified.json'), 'utf8')}${' '.repeat(4096)}`),
});
const RECORD_TYPE = alphaFolder('record-type', '0.101.0-63959e27d616', {
  edit: (dir) => { const f = path.join(dir, 'verified.json'); put(f, { ...json(f), integrity_ok: 'true' }); },
});
const PKG_OUTSIDE = alphaFolder('package-outside', '0.101.0-63959e27d616', {
  edit: (dir) => {
    const elsewhere = path.join(scratch, 'alpha', 'package-elsewhere');
    fs.renameSync(PKG(dir), elsewhere);
    fs.symlinkSync(elsewhere, PKG(dir));
  },
});
const LAYOUT_DIFFERS = alphaFolder('layout-differs', '0.101.0-63959e27d616', {
  edit: (dir) => { const f = path.join(dir, 'package.json'); const o = json(f); o.devteam.layout = 2; put(f, o); },
});
const INNER_DIFFERS = alphaFolder('inner-differs', '0.101.0-63959e27d616', {
  edit: (dir) => { const f = path.join(PKG(dir), 'package.json'); put(f, { ...json(f), version: '0.101.1' }); },
});
// The export's hash manifest: missing, holding a source that isn't a sha256 hash, or not listing a route.
const manifestOf = (hub) => path.join(hub, 'csp-hashes.json');
const NO_MANIFEST = alphaFolder('no-manifest', '0.101.0-63959e27d616');
fs.rmSync(manifestOf(NO_MANIFEST.hub));
const BAD_HASH = alphaFolder('bad-hash', '0.101.0-63959e27d616');
put(manifestOf(BAD_HASH.hub), { v: 1, pages: { ...HASHES, '/': [...HASHES['/'], "unsafe-inline' 'unsafe-eval"] } });
const UNLISTED = alphaFolder('unlisted', '0.101.0-63959e27d616');
put(manifestOf(UNLISTED.hub), { v: 1, pages: { '/': HASHES['/'] } });

// --- a software authenticator (as test/gateway.test.mjs has it: a claim needs one) --------------
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
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
  const id = crypto.randomBytes(16);
  return {
    create(opts, origin) {
      const cd = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: opts.challenge, origin }));
      const len = Buffer.alloc(2); len.writeUInt16BE(id.length);
      const ad = Buffer.concat([sha(opts.rp.id), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, id, cbor(cose)]);
      return { rawId: u(id), clientDataJSON: u(cd), attestationObject: u(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]))) };
    },
  };
}

// --- the stand-in hub (one listed project, proj, on BASE) and that project's dashboard -----------
const hub = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ hub: 1, instances: [{ devteam: 1, root: '/srv/proj', port: BASE, name: 'proj' }] })); });
await new Promise((r) => hub.listen(HUB, '127.0.0.1', r));
const dashSeen = [];
const dash = http.createServer((req, res) => { dashSeen.push(req.url); res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`the project's dashboard: ${req.url}`); });
await new Promise((r) => dash.listen(BASE, '127.0.0.1', r));
after(() => Promise.all([hub, dash].map((s) => new Promise((r) => { s.closeAllConnections?.(); s.close(r); }))));

// --- a gateway on a localhost URL, its alpha folder and setting through its environment ----------
let n = 0;
async function gateway(t, env) {
  const port = await freePort();
  const publicUrl = `http://box.localhost:${port}`;
  const name = `gw-${++n}`;
  const ttydPage = path.join(scratch, `${name}-ttyd.html`);
  fs.writeFileSync(ttydPage, 'the gateway\'s copy of ttyd');
  const uploadsDir = path.join(scratch, `${name}-uploads`);
  fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o750 });
  const logs = [];
  const g = G.createGateway({ publicUrl, dir: path.join(process.env.DEVTEAM_GATEWAY_DIR, name), ttydPort: await freePort(), ttydPage, uploadsDir, log: (m) => logs.push(m), env });
  await new Promise((r) => g.server.listen(port, '127.0.0.1', r));
  t.after(() => new Promise((r) => { g.server.closeAllConnections?.(); g.server.close(r); }));
  const token = /claim#([A-Za-z0-9_-]+)/.exec(logs.join('\n'))?.[1];
  const box = new URL(publicUrl).host;
  let jar = '';
  let flowJar = ''; // a passkey ceremony's flow cookie, sent beside the session on /auth/
  // The request line exactly as given: http.request sends the path unparsed, .. and %2e%2e included.
  const req = (method, route, { body, headers = {}, signedIn = true, host = box } = {}) => new Promise((resolve, reject) => {
    const h = { host, ...(method !== 'GET' && method !== 'HEAD' ? { origin: `http://${host}`, 'content-type': 'application/json' } : {}), ...headers };
    const sent = [signedIn ? jar : '', route.startsWith('/auth/') ? flowJar : ''].filter(Boolean).join('; ');
    if (sent) h.cookie = sent;
    const r = http.request({ host: '127.0.0.1', port, method, path: route, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const sc = res.headers['set-cookie']?.find((c) => c.startsWith('devteam_session='));
        if (sc) jar = sc.split(';')[0];
        for (const c of res.headers['set-cookie'] ?? []) { const m = /^(?:__Host-)?devteam_flow=([^;]*)/.exec(c); if (m) flowJar = /;\s*Max-Age=0\b/i.test(c) ? '' : c.split(';')[0]; }
        let json = null;
        try { json = JSON.parse(raw.toString('utf8')); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, raw, body: raw.toString('utf8'), json });
      });
    });
    r.on('error', reject);
    // A route that takes a request and never answers fails here, on its own line, not at the file's timeout.
    r.setTimeout(10000, () => r.destroy(new Error(`${method} ${route.slice(0, 60)}: no answer in 10 s`)));
    r.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const o = await req('POST', '/auth/claim/options', { body: { token } });
  assert.equal(o.status, 200, o.body);
  const v = await req('POST', '/auth/claim/verify', { body: { token, ...authenticator().create(o.json, publicUrl) } });
  assert.equal(v.status, 200, v.body);
  assert.ok(jar, 'a session cookie');
  return { port, publicUrl, box, term: `term.${box}`, req };
}
const alphaEnv = (dir, more = {}) => ({ DEVTEAM_ALPHA_DIR: dir, ...more });

// --- the policies, as exact strings -----------------------------------------------------------------
// The hub page's own policy (hubCsp) as it is before this ticket, with no project framed but the one
// the stand-in hub lists, and the gateway's other pages' policies, as they are before it.
const hubPolicy = (gw) => `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; img-src 'self'; frame-src http://${gw.term} http://proj.${gw.box}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
// /next/'s: hubCsp with script-src 'self' and the page's hashes (no 'unsafe-inline'), style-src
// 'self' 'unsafe-inline' (no hash), and font-src 'self' added after img-src (the export's own fonts;
// ruling a-20261127-062049575-supervisor); every other directive as the hub page has it.
const alphaPolicy = (gw, route) => `default-src 'none'; script-src 'self'${(HASHES[route] ?? []).map((h) => ` '${h}'`).join('')}; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; img-src 'self'; font-src 'self'; frame-src http://${gw.term} http://proj.${gw.box}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
const PAGE_POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const termPolicy = (gw) => `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'self' ws://${gw.term}; frame-ancestors ${gw.publicUrl}; base-uri 'none'; form-action 'none'`;
const WHY_POLICY = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const NAV = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none', accept: 'text/html' };
const FETCH = { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', 'sec-fetch-site': 'same-origin', accept: '*/*' };

test('A1: signed in, <box>/next/ serves every case of alpha-serving.json from the verified install\'s hub export', async (t) => {
  const gw = await gateway(t, alphaEnv(GOOD.dir));
  await gw.req('GET', '/'); // the list read once, as the hub page does
  for (const c of TABLE.cases) {
    const r = await gw.req('GET', c.path, { headers: FETCH });
    const what = `${c.name} (${c.path.slice(0, 60)})`;
    assert.equal(r.status, c.status, `${what}: status; ${r.body.slice(0, 120)}`);
    assert.equal(r.headers['content-type'] ?? null, c.type, `${what}: type`);
    if (c.file) assert.ok(r.raw.equals(fs.readFileSync(path.join(GOOD.hub, c.file))), `${what}: the file's bytes`);
    if (c.location) assert.equal(r.headers.location, c.location, `${what}: location`);
    assert.deepEqual([r.headers['x-frame-options'], r.headers['referrer-policy']], ['DENY', 'no-referrer'], `${what}: the hub page's framing and referrer headers`);
    if (c.status === 200) assert.deepEqual([r.headers['x-content-type-options'], r.headers['cache-control']], ['nosniff', 'no-store'], `${what}: nosniff and no-store`);
    if (c.status === 404) assert.doesNotMatch(r.body, new RegExp(TABLE.outside.text.trim()), `${what}: nothing of the outside file`);
  }
  const plain = await gw.req('GET', '/nothing-serves-this', { headers: FETCH });
  for (const p of ['/nextfoo', '/next.html', '/nextx/']) {
    const r = await gw.req('GET', p, { headers: FETCH });
    assert.deepEqual([r.status, r.body], [plain.status, plain.body], `${p}: not the alpha's, the box's plain answer`);
  }
  const postPlain = await gw.req('POST', '/nothing-serves-this', { headers: FETCH });
  for (const m of ['POST', 'PUT', 'DELETE']) {
    const r = await gw.req(m, '/next/', { headers: FETCH });
    assert.deepEqual([r.status, r.body], [postPlain.status, postPlain.body], `${m} /next/: not the alpha's, today's answer`);
    assert.doesNotMatch(r.body, /alpha fixture|__next_f/, `${m} /next/: nothing of the install`);
  }
  const head = await gw.req('HEAD', '/next/', { headers: FETCH });
  assert.equal(head.status, 200, 'HEAD /next/');
  assert.equal(head.raw.length, 0, 'no body to a HEAD');
  assert.equal(head.headers['content-type'], 'text/html; charset=utf-8');
});

test('A2: signed out, every /next/ path and /alpha.json answer as the hub page and /box.json do', async (t) => {
  const gw = await gateway(t, alphaEnv(GOOD.dir));
  const hubNav = await gw.req('GET', '/', { signedIn: false, headers: NAV });
  assert.equal(hubNav.status, 302, 'the hub page, signed out, navigating');
  const login = (p) => `${gw.publicUrl}/auth/login?next=${encodeURIComponent(`${gw.publicUrl}${p}`)}`;
  assert.equal(hubNav.headers.location, login('/'));
  const hubFetch = await gw.req('GET', '/', { signedIn: false, headers: FETCH });
  assert.deepEqual([hubFetch.status, hubFetch.body], [401, 'sign in with your passkey']);
  for (const c of [...TABLE.cases, { path: '/next/' }]) {
    const nav = await gw.req('GET', c.path, { signedIn: false, headers: NAV });
    assert.deepEqual([nav.status, nav.headers.location], [302, login(c.path)], `${c.path.slice(0, 60)}: navigating`);
    const f = await gw.req('GET', c.path, { signedIn: false, headers: FETCH });
    assert.deepEqual([f.status, f.body], [hubFetch.status, hubFetch.body], `${c.path.slice(0, 60)}: a fetch`);
  }
  const boxJson = await gw.req('GET', '/box.json', { signedIn: false, headers: FETCH });
  const alphaJson = await gw.req('GET', '/alpha.json', { signedIn: false, headers: FETCH });
  assert.deepEqual([alphaJson.status, alphaJson.body], [boxJson.status, boxJson.body], '/alpha.json as /box.json');
});

test('A3: /next/ pages carry hubCsp with only script-src (\'self\' and the page\'s hashes) and style-src (\'self\' added) changed, and font-src \'self\' added', async (t) => {
  // a fresh gateway, nothing read before: a page load reads the list first, as the hub page does
  const gw = await gateway(t, alphaEnv(GOOD.dir));
  for (const [p, route] of [['/next/', '/'], ['/next/threads/one/', '/threads/one/'], ['/next/threads/one/index.html', '/threads/one/'], ['/next/?_rsc=a1b2c', '/']]) {
    const r = await gw.req('GET', p, { headers: NAV });
    assert.equal(r.status, 200, p);
    assert.equal(r.headers['content-security-policy'], alphaPolicy(gw, route), `${p}: the exact policy`);
    assert.deepEqual([r.headers['x-frame-options'], r.headers['referrer-policy']], ['DENY', 'no-referrer'], `${p}: framing and referrer`);
    assert.ok(HASHES[route].length > 0, 'the page has hashes');
    assert.doesNotMatch(r.headers['content-security-policy'].split('; ').find((d) => d.startsWith('script-src ')), /unsafe-inline/, 'no unsafe-inline in script-src');
  }
});

test('A4: the hub page\'s and every other route\'s policy is byte-identical to before', async (t) => {
  const gw = await gateway(t, alphaEnv(GOOD.dir));
  const r = (p, o = {}) => gw.req('GET', p, { headers: NAV, ...o });
  assert.equal((await r('/')).headers['content-security-policy'], hubPolicy(gw), 'the hub page');
  assert.equal((await r('/index.html')).headers['content-security-policy'], hubPolicy(gw), 'the hub page by name');
  assert.equal((await r('/auth/login', { signedIn: false })).headers['content-security-policy'], PAGE_POLICY, 'sign-in');
  assert.equal((await r('/', { host: gw.term })).headers['content-security-policy'], termPolicy(gw), 'the terminal');
  assert.equal((await r('/next/', { host: `proj.${gw.box}`, signedIn: false })).headers['content-security-policy'], PAGE_POLICY, 'a project\'s signed-out page');
  assert.equal((await r('/nothing-here')).headers['content-security-policy'], undefined, 'a box path the gateway has no route for');
});

const WHY = [
  ['an unverified install (no verified.json)', alphaEnv(UNVERIFIED.dir), /didn.t pass its checks/, { on: true, verified: false, release: null, why: 'unverified' }],
  ['an install whose provenance_ok is false', alphaEnv(NO_PROVENANCE.dir), /didn.t pass its checks/, { on: true, verified: false, release: null, why: 'unverified' }],
  ['a record that disagrees with the pair', alphaEnv(PAIR_DIFFERS.dir), /didn.t pass its checks/, { on: true, verified: false, release: null, why: 'unverified' }],
  ['a release other than the image\'s stamp', alphaEnv(GOOD.dir, { DEVTEAM_KIT_RELEASE: 'v0.102.0' }), /didn.t pass its checks/, { on: true, verified: false, release: null, why: 'unverified' }],
  ['a verified.json that is a symlink', alphaEnv(RECORD_LINK.dir), /didn.t pass its checks/, { on: true, verified: false, release: null, why: 'unverified' }],
  ['a verified.json over 4 KiB', alphaEnv(RECORD_BIG.dir), /didn.t pass its checks/, { on: true, verified: false, release: null, why: 'unverified' }],
  ['a record field of another type', alphaEnv(RECORD_TYPE.dir), /didn.t pass its checks/, { on: true, verified: false, release: null, why: 'unverified' }],
  ['node_modules/<name> resolving outside the folder', alphaEnv(PKG_OUTSIDE.dir), /didn.t pass its checks/, { on: true, verified: false, release: null, why: 'unverified' }],
  ['a layout that package.json doesn\'t name', alphaEnv(LAYOUT_DIFFERS.dir), /didn.t pass its checks/, { on: true, verified: false, release: null, why: 'unverified' }],
  ['a package whose own package.json names another version', alphaEnv(INNER_DIFFERS.dir), /didn.t pass its checks/, { on: true, verified: false, release: null, why: 'unverified' }],
  ['no install', alphaEnv(NONE), /no install of the alpha/, { on: true, verified: false, release: null, why: 'no-install' }],
  ['an empty alpha folder', alphaEnv(EMPTY), /no install of the alpha/, { on: true, verified: false, release: null, why: 'no-install' }],
  ['DEVTEAM_ALPHA=0', alphaEnv(GOOD.dir, { DEVTEAM_ALPHA: '0' }), /turned off/, { on: false, verified: true, release: '0.101.0', why: 'off' }],
  ['DEVTEAM_ALPHA=" 0 " (trimmed)', alphaEnv(GOOD.dir, { DEVTEAM_ALPHA: ' 0 ' }), /turned off/, { on: false, verified: true, release: '0.101.0', why: 'off' }],
  ['a verified install with no hub pages', alphaEnv(NO_PAGES.dir), /no pages yet/, { on: true, verified: true, release: '0.101.0', why: 'no-pages' }],
];

test('A5: an unverified install, no install and DEVTEAM_ALPHA=0 each serve the why-page, never a file of the install', async (t) => {
  for (const [what, env, words] of WHY) {
    const gw = await gateway(t, env);
    for (const p of ['/next/', '/next/threads/one/', '/next/_next/static/chunks/app.js', '/next']) {
      const r = await gw.req('GET', p, { headers: NAV });
      assert.equal(r.status, 200, `${what}, ${p}: status`);
      assert.equal(r.headers['content-type'], 'text/html; charset=utf-8', `${what}, ${p}: type`);
      assert.equal(r.headers['content-security-policy'], WHY_POLICY, `${what}, ${p}: the why-page's policy`);
      assert.deepEqual([r.headers['x-frame-options'], r.headers['referrer-policy']], ['DENY', 'no-referrer'], `${what}, ${p}: framing and referrer`);
      assert.match(r.body, words, `${what}, ${p}: the reason in plain words`);
      assert.match(r.body, /<a href="\/">/, `${what}, ${p}: a link back to the hub`);
      assert.doesNotMatch(r.body, /alpha fixture|__next_f|<script/, `${what}, ${p}: nothing of the install`);
    }
  }
});

test('A6: GET <box>/alpha.json answers { on, verified, release, why }', async (t) => {
  const good = await gateway(t, alphaEnv(GOOD.dir));
  const r = await good.req('GET', '/alpha.json', { headers: FETCH });
  assert.equal(r.status, 200, r.body);
  assert.equal(r.headers['content-type'], 'application/json');
  assert.deepEqual(r.json, { on: true, verified: true, release: '0.101.0', why: null });
  // Every real box names its release (the image's stamp, vX.Y.Z): the matching one serves.
  const SERVES = [
    ['the image\'s release matching the install', alphaEnv(GOOD.dir, { DEVTEAM_KIT_RELEASE: 'v0.101.0' })],
    ['DEVTEAM_ALPHA=1', alphaEnv(GOOD.dir, { DEVTEAM_ALPHA: '1' })],
    ['DEVTEAM_ALPHA=off (only 0 turns it off)', alphaEnv(GOOD.dir, { DEVTEAM_ALPHA: 'off' })],
    ['DEVTEAM_ALPHA empty', alphaEnv(GOOD.dir, { DEVTEAM_ALPHA: '' })],
  ];
  for (const [what, env] of SERVES) {
    const gw = await gateway(t, env);
    assert.deepEqual((await gw.req('GET', '/alpha.json', { headers: FETCH })).json, { on: true, verified: true, release: '0.101.0', why: null }, what);
    const page = await gw.req('GET', '/next/', { headers: FETCH });
    assert.equal(page.status, 200, `${what}: /next/ serves`);
    assert.equal(page.headers['content-security-policy'], alphaPolicy(gw, '/'), `${what}: /next/ under the alpha's policy`);
  }
  for (const [what, env, , want] of WHY) {
    const gw = await gateway(t, env);
    assert.deepEqual((await gw.req('GET', '/alpha.json', { headers: FETCH })).json, want, what);
  }
});

test('A7: <project>.<box>/next/ still reaches the project\'s dashboard behind the session', async (t) => {
  const gw = await gateway(t, alphaEnv(GOOD.dir));
  const host = `proj.${gw.box}`;
  for (const p of ['/next/', '/next/threads/one/', '/next/_next/static/chunks/app.js']) {
    const r = await gw.req('GET', p, { host, headers: FETCH });
    assert.deepEqual([r.status, r.body], [200, `the project's dashboard: ${p}`], `${p} signed in`);
  }
  const seen = dashSeen.length;
  const out = await gw.req('GET', '/next/', { host, signedIn: false, headers: NAV });
  const root = await gw.req('GET', '/', { host, signedIn: false, headers: NAV });
  assert.deepEqual([out.status, out.body], [root.status, root.body], 'signed out: the project host\'s signed-out page, as for /');
  assert.equal(out.status, 401);
  assert.equal(dashSeen.length, seen, 'nothing reached the dashboard signed out');
});

test('A8: the export\'s hash manifest: missing or holding a source that isn\'t a sha256 hash, every page is a 500 and no policy is loosened; a route it doesn\'t list gets script-src \'self\' alone', async (t) => {
  for (const [what, folder] of [['no csp-hashes.json', NO_MANIFEST], ['a source that isn\'t a sha256 hash', BAD_HASH]]) {
    const gw = await gateway(t, alphaEnv(folder.dir));
    for (const p of ['/next/', '/next/threads/one/']) {
      const r = await gw.req('GET', p, { headers: NAV });
      assert.deepEqual([r.status, r.headers['content-type'], r.body], [500, 'text/plain; charset=utf-8', 'no policy for this page\n'], `${what}, ${p}`);
      assert.equal(r.headers['content-security-policy'], undefined, `${what}, ${p}: no policy at all`);
    }
    const js = await gw.req('GET', '/next/_next/static/chunks/app.js', { headers: FETCH });
    assert.equal(js.status, 200, `${what}: a file that is no page is still served`);
  }
  const gw = await gateway(t, alphaEnv(UNLISTED.dir));
  const page = await gw.req('GET', '/next/threads/one/', { headers: NAV });
  assert.equal(page.status, 200);
  assert.equal(page.headers['content-security-policy'], alphaPolicy(gw, '/no-such-route/'), 'an unlisted route: script-src \'self\' and no hash');
  assert.equal((await gw.req('GET', '/next/', { headers: NAV })).headers['content-security-policy'], alphaPolicy(gw, '/'), 'a listed route keeps its hashes');
});
