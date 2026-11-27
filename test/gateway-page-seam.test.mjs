// page-seam@1 in the gateway (kit-985; project design kit-package-apps, "Contract page-seam@1"): the
// box's hub page goes through three top-level names of cloud/gateway.mjs that the generated tree
// overrides to serve the built hub app. gatewayHubPage(opts) resolves today's hub page sources, once;
// serveGatewayHub(req, res, hub, policy) sends it at the hub route only, under hubCsp with
// x-frame-options and referrer-policy; serveGatewayAsset(req, res, hub, policy) is asked for a GET on the
// box's name that no route took, just before the 404, with the hub route's policy (ruling
// a-20261127-155643900), and at main answers nothing (false). Behaviour at main
// is unchanged: every response below is compared, byte for byte but the Date header, with BASE, which
// was recorded from main's gateway before the change (GATEWAY_SEAM_RECORD=<file> re-records it there).
// A scratch HOME and DEVTEAM_GATEWAY_DIR, ports away from 4320, every other DEVTEAM_* variable unset.
// Ports: +2 the stand-in hub, +50 the stand-in project dashboard (its scan block +50..+74).
// Run: node --test test/gateway-page-seam.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTS, freePort } from './lib/kit.mjs';

// lib/kit.mjs has dropped every DEVTEAM_* of the shell; this file sets only the hub's port, the
// instance block and the gateway's state folder, before the import.
// GATEWAY_SEAM_RECORD=<file prefix> records BASE instead of comparing, only on main's code before a
// change (the ticket's probe/record.sh); it is refused under CI, where S1 must compare.
const RECORD = process.env.GATEWAY_SEAM_RECORD;
if (RECORD && process.env.CI) throw new Error('GATEWAY_SEAM_RECORD records BASE; it is never set in CI');
const HUB = PORTS + 2;
const BASE_PORT = PORTS + 50;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-gwseam-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
process.env.HOME = path.join(scratch, 'home');
fs.mkdirSync(process.env.HOME);
process.env.DEVTEAM_HUB_PORT = String(HUB);
process.env.DEVTEAM_PORT_BASE = String(BASE_PORT);
process.env.DEVTEAM_GATEWAY_DIR = path.join(scratch, 'gateway');
for (const k of ['DEVTEAM_HUB_PAGE', 'DEVTEAM_ALPHA', 'DEVTEAM_ALPHA_DIR', 'DEVTEAM_KIT_RELEASE', 'DEVTEAM_BOX_TOOLS', 'DEVTEAM_PUBLIC_URL']) delete process.env[k];
const G = await import('../cloud/gateway.mjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const SRC = fs.readFileSync(path.join(root, 'cloud', 'gateway.mjs'), 'utf8');
const KIT_HUB = path.join(root, 'docs', 'devteam', 'dashboard', 'hub.html');
// The hub page each gateway here is given: bytes no other file has, non-ASCII and a CRLF among them.
const HUB_BYTES = Buffer.from('<!doctype html><title>the seam\'s hub fixture</title><p>café ✓</p>\r\n<script>/* hub */</script>', 'utf8');
const hubFile = (name) => { const f = path.join(scratch, `${name}.html`); fs.writeFileSync(f, HUB_BYTES); return f; };

// --- a software authenticator (as test/gateway-alpha.test.mjs has it: a claim needs one) ----------
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

// --- the stand-in hub (one listed project, proj, on BASE_PORT) and that project's dashboard ---------
const hub = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ hub: 1, instances: [{ devteam: 1, root: '/srv/proj', port: BASE_PORT, name: 'proj' }] })); });
await new Promise((r) => hub.listen(HUB, '127.0.0.1', r));
const dash = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`the project's dashboard: ${req.url}`); });
await new Promise((r) => dash.listen(BASE_PORT, '127.0.0.1', r));
after(() => Promise.all([hub, dash].map((s) => new Promise((r) => { s.closeAllConnections?.(); s.close(r); }))));

// --- a claimed gateway on a localhost URL (http, or https as the box's name is: HSTS, __Host- cookies) --
let n = 0;
async function gateway(t, { scheme = 'http', hubPage } = {}) {
  const port = await freePort();
  const publicUrl = `${scheme}://box.localhost:${port}`;
  const name = `gw-${++n}`;
  const ttydPage = path.join(scratch, `${name}-ttyd.html`);
  fs.writeFileSync(ttydPage, 'the gateway\'s copy of ttyd');
  const uploadsDir = path.join(scratch, `${name}-uploads`);
  fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o750 });
  const logs = [];
  const g = G.createGateway({ publicUrl, dir: path.join(process.env.DEVTEAM_GATEWAY_DIR, name), ttydPort: await freePort(), ttydPage, uploadsDir, log: (m) => logs.push(m), ...(hubPage ? { hubPage } : {}) });
  await new Promise((r) => g.server.listen(port, '127.0.0.1', r));
  t.after(() => new Promise((r) => { g.server.closeAllConnections?.(); g.server.close(r); }));
  const token = /claim#([A-Za-z0-9_-]+)/.exec(logs.join('\n'))?.[1];
  const box = new URL(publicUrl).host;
  let jar = '';
  let flowJar = '';
  // The request line exactly as given: http.request sends the path unparsed.
  const req = (method, route, { body, headers = {}, signedIn = true } = {}) => new Promise((resolve, reject) => {
    const h = { host: box, ...(method !== 'GET' && method !== 'HEAD' ? { origin: publicUrl, 'content-type': 'application/json' } : {}), ...headers };
    const sent = [signedIn ? jar : '', route.startsWith('/auth/') ? flowJar : ''].filter(Boolean).join('; ');
    if (sent) h.cookie = sent;
    const r = http.request({ host: '127.0.0.1', port, method, path: route, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const sc = res.headers['set-cookie']?.find((c) => /^(?:__Host-)?devteam_session=/.test(c));
        if (sc) jar = sc.split(';')[0];
        for (const c of res.headers['set-cookie'] ?? []) { const m = /^(?:__Host-)?devteam_flow=([^;]*)/.exec(c); if (m) flowJar = /;\s*Max-Age=0\b/i.test(c) ? '' : c.split(';')[0]; }
        let json = null;
        try { json = JSON.parse(raw.toString('utf8')); } catch {}
        resolve({ status: res.statusCode, rawHeaders: res.rawHeaders, headers: res.headers, raw, body: raw.toString('utf8'), json });
      });
    });
    r.on('error', reject);
    r.setTimeout(10000, () => r.destroy(new Error(`${method} ${route.slice(0, 60)}: no answer in 10 s`)));
    r.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const o = await req('POST', '/auth/claim/options', { body: { token } });
  assert.equal(o.status, 200, o.body);
  const v = await req('POST', '/auth/claim/verify', { body: { token, ...authenticator().create(o.json, publicUrl) } });
  assert.equal(v.status, 200, v.body);
  assert.ok(jar, 'a session cookie');
  return { port, publicUrl, box, req };
}

// --- what main answered (BASE) ------------------------------------------------------------------
const NAV = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none', accept: 'text/html' };
const FETCH = { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', 'sec-fetch-site': 'same-origin', accept: '*/*' };
// Every request whose answer the seam could change: the hub route's paths, methods and queries, the
// paths a static app would own (which reach the 404 the asset hook sits before), and signed out.
const CASES = [
  ['GET', '/', NAV], ['GET', '/index.html', NAV], ['GET', '/?x=1', NAV], ['GET', '/index.html?x=1', FETCH], ['GET', '/', FETCH], ['GET', '/./index.html', FETCH],
  ['HEAD', '/', NAV], ['HEAD', '/index.html', FETCH], ['POST', '/', FETCH], ['PUT', '/index.html', FETCH], ['DELETE', '/', FETCH],
  ['GET', '/nope', FETCH], ['GET', '/_next/static/chunks/app.js', FETCH], ['GET', '/hub.html', FETCH], ['GET', '/index.htm', FETCH], ['GET', '/%69ndex.html', FETCH],
  ['GET', '/a/b/', NAV], ['GET', '/threads/one/', NAV], ['GET', '/assets/app.css', FETCH], ['GET', '/favicon.ico', FETCH], ['GET', '/robots.txt', FETCH],
  ['HEAD', '/nope', FETCH], ['HEAD', '/_next/static/chunks/app.js', FETCH], ['POST', '/nope', FETCH], ['POST', '/_next/static/chunks/app.js', FETCH],
  ['GET', '/', NAV, false], ['GET', '/index.html', FETCH, false], ['GET', '/nope', FETCH, false], ['GET', '/_next/static/chunks/app.js', NAV, false],
];
// A response as the wire carried it, its ports and names made the same for any run: status, every
// header in order but Date, and the body. Each request is on a connection of its own (agent: false), so
// Node's connection headers read the same on every major (18's global agent closes, 20's keeps alive).
function shape(gw, r) {
  const norm = (s) => s.split(gw.box).join('BOX').split(encodeURIComponent(gw.box)).join('BOX').replace(/:\d{2,5}\b/g, ':PORT');
  const headers = [];
  for (let i = 0; i < r.rawHeaders.length; i += 2) if (r.rawHeaders[i].toLowerCase() !== 'date') headers.push([r.rawHeaders[i], norm(r.rawHeaders[i + 1])]);
  return { status: r.status, headers, body: norm(r.body) };
}
async function answers(gw) {
  const out = {};
  for (const [method, route, headers, signedIn = true] of CASES) out[`${signedIn ? '' : 'signed out '}${method} ${route} (${headers === NAV ? 'page' : 'fetch'})`] = shape(gw, await gw.req(method, route, { headers, signedIn }));
  return out;
}
// BASE is at the end of this file (baseAnswers, hoisted), as main answered before the change.
const BASE = RECORD ? null : baseAnswers();

for (const scheme of ['http', 'https']) {
  test(`S1 (${scheme}): every answer of the box's name the seam could change is main's, byte for byte (BASE)`, async (t) => {
    const gw = await gateway(t, { scheme, hubPage: hubFile(`hub-${scheme}`) });
    await gw.req('GET', '/'); // the list read once, as the hub page does
    const got = await answers(gw);
    if (RECORD) {
      const f = `${RECORD}.${scheme}.json`;
      fs.writeFileSync(f, `${JSON.stringify(got, null, 1)}\n`);
      t.diagnostic(`recorded ${Object.keys(got).length} answers to ${f}`);
      return;
    }
    assert.deepEqual(Object.keys(got), Object.keys(BASE[scheme]), 'the same cases as BASE');
    for (const [k, want] of Object.entries(BASE[scheme])) assert.deepEqual(got[k], want, `${scheme} ${k}: as main sent it`);
  });
}

test('S2: the hub route sends the given page\'s bytes, read once when the gateway is made', async (t) => {
  const f = hubFile('hub-once');
  const gw = await gateway(t, { hubPage: f });
  for (const route of ['/', '/index.html', '/?x=1']) {
    const r = await gw.req('GET', route, { headers: NAV });
    assert.equal(r.status, 200, `${route}: ${r.body.slice(0, 80)}`);
    assert.ok(r.raw.equals(HUB_BYTES), `${route}: the hub page's bytes`);
  }
  fs.writeFileSync(f, 'changed after the gateway was made');
  const again = await gw.req('GET', '/', { headers: NAV });
  assert.ok(again.raw.equals(HUB_BYTES), 'S2 the page is the one read when the gateway was made, not the file as it is now');
  const head = await gw.req('HEAD', '/', { headers: NAV });
  assert.notEqual(head.status, 200, 'HEAD / is not the hub route (GET only, as at main)');
});

// hub.html beside the gateway (the image's) is never there in a checkout, and a test writes nothing into
// cloud/, so its place between DEVTEAM_HUB_PAGE and the kit's page isn't tested here: gatewayHubPage's read is
// main's line as it was (task-1 F1).
test('S3: gatewayHubPage(opts) resolves today\'s sources in today\'s order, as a checkout has them: opts.hubPage, DEVTEAM_HUB_PAGE, the kit\'s dashboard/hub.html', () => {
  assert.equal(typeof G.gatewayHubPage, 'function', 'cloud/gateway.mjs exports gatewayHubPage');
  assert.ok(!fs.existsSync(path.join(root, 'cloud', 'hub.html')), 'a checkout has no hub.html beside the gateway (the image copies one there)');
  const mine = hubFile('hub-opts');
  const other = path.join(scratch, 'hub-env.html');
  fs.writeFileSync(other, 'the environment\'s hub page');
  const missing = path.join(scratch, 'not-there.html');
  try {
    delete process.env.DEVTEAM_HUB_PAGE;
    const kit = G.gatewayHubPage({});
    assert.ok(Buffer.isBuffer(kit), 'S3 the page is a Buffer, as fs.readFileSync gives');
    assert.ok(kit.equals(fs.readFileSync(KIT_HUB)), 'S3 with nothing named, the kit\'s docs/devteam/dashboard/hub.html');
    assert.ok(G.gatewayHubPage({ hubPage: mine }).equals(HUB_BYTES), 'S3 opts.hubPage');
    assert.ok(G.gatewayHubPage({ hubPage: missing }).equals(fs.readFileSync(KIT_HUB)), 'S3 an opts.hubPage that is not there is passed over');
    process.env.DEVTEAM_HUB_PAGE = other;
    assert.equal(G.gatewayHubPage({}).toString('utf8'), 'the environment\'s hub page', 'S3 DEVTEAM_HUB_PAGE before the kit\'s');
    assert.ok(G.gatewayHubPage({ hubPage: mine }).equals(HUB_BYTES), 'S3 opts.hubPage before DEVTEAM_HUB_PAGE');
    assert.equal(G.gatewayHubPage({ hubPage: missing }).toString('utf8'), 'the environment\'s hub page', 'S3 a missing opts.hubPage falls to DEVTEAM_HUB_PAGE');
  } finally { delete process.env.DEVTEAM_HUB_PAGE; }
});

// A response object that records what is done to it.
function fakeRes() {
  const calls = [];
  const res = { headersSent: false };
  for (const m of ['writeHead', 'setHeader', 'write', 'end', 'flushHeaders', 'destroy']) res[m] = (...a) => { calls.push([m, ...a]); return res; };
  return { res, calls };
}

test('S4: serveGatewayHub(req, res, hub, policy) writes 200, the gateway\'s own headers, policy.hsts, then policy.csp, x-frame-options and referrer-policy, and the hub', () => {
  assert.equal(typeof G.serveGatewayHub, 'function', 'cloud/gateway.mjs exports serveGatewayHub');
  const req = { method: 'GET', url: '/', headers: {} };
  for (const hsts of [{}, { 'strict-transport-security': 'max-age=31536000' }]) {
    const { res, calls } = fakeRes();
    G.serveGatewayHub(req, res, HUB_BYTES, { csp: "default-src 'none'; the policy as given", hsts });
    assert.deepEqual(calls.map((c) => c[0]), ['writeHead', 'end'], 'S4 one writeHead, one end');
    assert.equal(calls[0][1], 200, 'S4 status 200');
    assert.deepEqual(Object.entries(calls[0][2]), [['content-type', 'text/html; charset=utf-8'], ['cache-control', 'no-store'], ['x-content-type-options', 'nosniff'], ...Object.entries(hsts), ['content-security-policy', "default-src 'none'; the policy as given"], ['x-frame-options', 'DENY'], ['referrer-policy', 'no-referrer']], `S4 the headers, in order (hsts ${JSON.stringify(hsts)})`);
    assert.equal(calls[1][1], HUB_BYTES, 'S4 the hub it was given, as given');
  }
});

test('S5: serveGatewayAsset(req, res, hub, policy) answers nothing at main: false for every method and path, and nothing written', () => {
  assert.equal(typeof G.serveGatewayAsset, 'function', 'cloud/gateway.mjs exports serveGatewayAsset');
  for (const method of ['GET', 'HEAD', 'POST']) {
    for (const url of ['/', '/index.html', '/nope', '/_next/static/chunks/app.js', '/hub.html', '/threads/one/', '/favicon.ico', '/../etc/passwd', `/${'a'.repeat(3000)}`]) {
      for (const h of [HUB_BYTES, undefined]) {
        const { res, calls } = fakeRes();
        assert.equal(G.serveGatewayAsset({ method, url, headers: {} }, res, h, { csp: "default-src 'none'", hsts: {} }), false, `S5 ${method} ${url.slice(0, 40)}: false`);
        assert.deepEqual(calls, [], `S5 ${method} ${url.slice(0, 40)}: nothing written`);
      }
    }
  }
});

// createGateway's own text, from its line to the closing brace at column 0.
const gatewayFn = (() => { const i = SRC.indexOf('\nexport function createGateway('); const j = SRC.indexOf('\n}\n', i); return i < 0 || j < 0 ? '' : SRC.slice(i, j + 3); })();
const count = (s, x) => s.split(x).length - 1;

test('S6: the three are top-level declarations, and createGateway calls each where page-seam@1 says, and sends no hub page of its own', () => {
  for (const decl of ['export function gatewayHubPage(opts = {}) {', 'export function serveGatewayHub(req, res, hub, policy) {', 'export function serveGatewayAsset(req, res, hub, policy) {']) {
    assert.equal(count(SRC, `\n${decl}\n`), 1, `S6 cloud/gateway.mjs declares, at column 0: ${decl}`);
  }
  assert.ok(gatewayFn, 'S6 createGateway is found');
  assert.equal(count(gatewayFn, 'gatewayHubPage('), 1, 'S6 createGateway resolves the hub page once, through gatewayHubPage');
  assert.match(gatewayFn, /\n {2}const hubPage = gatewayHubPage\(opts\);\n/, 'S6 at its creation, from its own opts');
  assert.doesNotMatch(gatewayFn, /DEVTEAM_HUB_PAGE|'hub\.html'|readFileSync\([^)]*hubPage/, 'S6 createGateway reads no hub page of its own');
  assert.equal(count(gatewayFn, 'serveGatewayHub('), 1, 'S6 serveGatewayHub is called once');
  assert.match(gatewayFn, /if \(req\.method === 'GET' && \(p === '\/' \|\| p === '\/index\.html'\)\) \{\n(?:[^\n]*\n){1,4}? {8}return serveGatewayHub\(req, res, hubPage, \{ csp: hubCsp\(\), hsts \}\);\n {6}\}\n/, 'S6 at the hub route only, with hubCsp() and the box\'s hsts');
  assert.doesNotMatch(gatewayFn, /send\([^\n]*\bhubPage\b/, 'S6 no send() of the hub page');
  assert.equal(count(gatewayFn, 'serveGatewayAsset('), 1, 'S6 serveGatewayAsset is called once');
  assert.match(gatewayFn, /\n {6}if \(req\.method === 'GET' && serveGatewayAsset\(req, res, hubPage, \{ csp: hubCsp\(\), hsts \}\)\) return;\n {6}return send\(res, 404, 'text\/plain', 'not found'\);\n {4}\} catch \(e\) \{\n/, 'S6 for a GET on the box\'s name, with the hub route\'s policy, just before its last 404');
});

// --- BASE: main's answers before the change (recorded at the base with GATEWAY_SEAM_RECORD) ---
function baseAnswers() {
  return {
    http: {
      "GET / (page)": {"status":200,"headers":[["content-type","text/html; charset=utf-8"],["cache-control","no-store"],["x-content-type-options","nosniff"],["content-security-policy","default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; img-src 'self'; frame-src http://term.BOX http://proj.BOX; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"],["x-frame-options","DENY"],["referrer-policy","no-referrer"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"<!doctype html><title>the seam's hub fixture</title><p>café ✓</p>\r\n<script>/* hub */</script>"},
      "GET /index.html (page)": {"status":200,"headers":[["content-type","text/html; charset=utf-8"],["cache-control","no-store"],["x-content-type-options","nosniff"],["content-security-policy","default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; img-src 'self'; frame-src http://term.BOX http://proj.BOX; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"],["x-frame-options","DENY"],["referrer-policy","no-referrer"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"<!doctype html><title>the seam's hub fixture</title><p>café ✓</p>\r\n<script>/* hub */</script>"},
      "GET /?x=1 (page)": {"status":200,"headers":[["content-type","text/html; charset=utf-8"],["cache-control","no-store"],["x-content-type-options","nosniff"],["content-security-policy","default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; img-src 'self'; frame-src http://term.BOX http://proj.BOX; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"],["x-frame-options","DENY"],["referrer-policy","no-referrer"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"<!doctype html><title>the seam's hub fixture</title><p>café ✓</p>\r\n<script>/* hub */</script>"},
      "GET /index.html?x=1 (fetch)": {"status":200,"headers":[["content-type","text/html; charset=utf-8"],["cache-control","no-store"],["x-content-type-options","nosniff"],["content-security-policy","default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; img-src 'self'; frame-src http://term.BOX http://proj.BOX; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"],["x-frame-options","DENY"],["referrer-policy","no-referrer"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"<!doctype html><title>the seam's hub fixture</title><p>café ✓</p>\r\n<script>/* hub */</script>"},
      "GET / (fetch)": {"status":200,"headers":[["content-type","text/html; charset=utf-8"],["cache-control","no-store"],["x-content-type-options","nosniff"],["content-security-policy","default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; img-src 'self'; frame-src http://term.BOX http://proj.BOX; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"],["x-frame-options","DENY"],["referrer-policy","no-referrer"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"<!doctype html><title>the seam's hub fixture</title><p>café ✓</p>\r\n<script>/* hub */</script>"},
      "GET /./index.html (fetch)": {"status":200,"headers":[["content-type","text/html; charset=utf-8"],["cache-control","no-store"],["x-content-type-options","nosniff"],["content-security-policy","default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; img-src 'self'; frame-src http://term.BOX http://proj.BOX; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"],["x-frame-options","DENY"],["referrer-policy","no-referrer"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"<!doctype html><title>the seam's hub fixture</title><p>café ✓</p>\r\n<script>/* hub */</script>"},
      "HEAD / (page)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["Connection","close"]],"body":""},
      "HEAD /index.html (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["Connection","close"]],"body":""},
      "POST / (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "PUT /index.html (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "DELETE / (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "GET /nope (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "GET /_next/static/chunks/app.js (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "GET /hub.html (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "GET /index.htm (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "GET /%69ndex.html (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "GET /a/b/ (page)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "GET /threads/one/ (page)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "GET /assets/app.css (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "GET /favicon.ico (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "GET /robots.txt (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "HEAD /nope (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["Connection","close"]],"body":""},
      "HEAD /_next/static/chunks/app.js (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["Connection","close"]],"body":""},
      "POST /nope (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "POST /_next/static/chunks/app.js (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "signed out GET / (page)": {"status":302,"headers":[["location","http://BOX/auth/login?next=http%3A%2F%2FBOX%2F"],["cache-control","no-store"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":""},
      "signed out GET /index.html (fetch)": {"status":401,"headers":[["content-type","text/plain; charset=utf-8"],["cache-control","no-store"],["x-content-type-options","nosniff"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"sign in with your passkey"},
      "signed out GET /nope (fetch)": {"status":401,"headers":[["content-type","text/plain; charset=utf-8"],["cache-control","no-store"],["x-content-type-options","nosniff"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"sign in with your passkey"},
      "signed out GET /_next/static/chunks/app.js (page)": {"status":302,"headers":[["location","http://BOX/auth/login?next=http%3A%2F%2FBOX%2F_next%2Fstatic%2Fchunks%2Fapp.js"],["cache-control","no-store"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":""},
    },
    https: {
      "GET / (page)": {"status":200,"headers":[["content-type","text/html; charset=utf-8"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["content-security-policy","default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; img-src 'self'; frame-src https://term.BOX https://proj.BOX; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"],["x-frame-options","DENY"],["referrer-policy","no-referrer"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"<!doctype html><title>the seam's hub fixture</title><p>café ✓</p>\r\n<script>/* hub */</script>"},
      "GET /index.html (page)": {"status":200,"headers":[["content-type","text/html; charset=utf-8"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["content-security-policy","default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; img-src 'self'; frame-src https://term.BOX https://proj.BOX; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"],["x-frame-options","DENY"],["referrer-policy","no-referrer"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"<!doctype html><title>the seam's hub fixture</title><p>café ✓</p>\r\n<script>/* hub */</script>"},
      "GET /?x=1 (page)": {"status":200,"headers":[["content-type","text/html; charset=utf-8"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["content-security-policy","default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; img-src 'self'; frame-src https://term.BOX https://proj.BOX; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"],["x-frame-options","DENY"],["referrer-policy","no-referrer"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"<!doctype html><title>the seam's hub fixture</title><p>café ✓</p>\r\n<script>/* hub */</script>"},
      "GET /index.html?x=1 (fetch)": {"status":200,"headers":[["content-type","text/html; charset=utf-8"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["content-security-policy","default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; img-src 'self'; frame-src https://term.BOX https://proj.BOX; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"],["x-frame-options","DENY"],["referrer-policy","no-referrer"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"<!doctype html><title>the seam's hub fixture</title><p>café ✓</p>\r\n<script>/* hub */</script>"},
      "GET / (fetch)": {"status":200,"headers":[["content-type","text/html; charset=utf-8"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["content-security-policy","default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; img-src 'self'; frame-src https://term.BOX https://proj.BOX; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"],["x-frame-options","DENY"],["referrer-policy","no-referrer"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"<!doctype html><title>the seam's hub fixture</title><p>café ✓</p>\r\n<script>/* hub */</script>"},
      "GET /./index.html (fetch)": {"status":200,"headers":[["content-type","text/html; charset=utf-8"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["content-security-policy","default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; img-src 'self'; frame-src https://term.BOX https://proj.BOX; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"],["x-frame-options","DENY"],["referrer-policy","no-referrer"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"<!doctype html><title>the seam's hub fixture</title><p>café ✓</p>\r\n<script>/* hub */</script>"},
      "HEAD / (page)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["Connection","close"]],"body":""},
      "HEAD /index.html (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["Connection","close"]],"body":""},
      "POST / (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "PUT /index.html (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "DELETE / (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "GET /nope (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "GET /_next/static/chunks/app.js (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "GET /hub.html (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "GET /index.htm (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "GET /%69ndex.html (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "GET /a/b/ (page)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "GET /threads/one/ (page)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "GET /assets/app.css (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "GET /favicon.ico (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "GET /robots.txt (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "HEAD /nope (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["Connection","close"]],"body":""},
      "HEAD /_next/static/chunks/app.js (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["Connection","close"]],"body":""},
      "POST /nope (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "POST /_next/static/chunks/app.js (fetch)": {"status":404,"headers":[["content-type","text/plain"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"not found"},
      "signed out GET / (page)": {"status":302,"headers":[["location","https://BOX/auth/login?next=https%3A%2F%2FBOX%2F"],["cache-control","no-store"],["strict-transport-security","max-age=31536000"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":""},
      "signed out GET /index.html (fetch)": {"status":401,"headers":[["content-type","text/plain; charset=utf-8"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"sign in with your passkey"},
      "signed out GET /nope (fetch)": {"status":401,"headers":[["content-type","text/plain; charset=utf-8"],["cache-control","no-store"],["x-content-type-options","nosniff"],["strict-transport-security","max-age=31536000"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":"sign in with your passkey"},
      "signed out GET /_next/static/chunks/app.js (page)": {"status":302,"headers":[["location","https://BOX/auth/login?next=https%3A%2F%2FBOX%2F_next%2Fstatic%2Fchunks%2Fapp.js"],["cache-control","no-store"],["strict-transport-security","max-age=31536000"],["Connection","close"],["Transfer-Encoding","chunked"]],"body":""},
    },
  };
}
