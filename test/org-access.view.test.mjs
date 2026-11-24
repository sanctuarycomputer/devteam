// View only (cloud/gateway.mjs, kit-250): a View session reads and changes nothing. The gateway
// refuses it every method but GET and HEAD (sign-out and its own sign-in methods excepted), the
// terminal and its socket, signed and operator posts, publishing, uploads, preview sockets and push;
// it tells dashboards the level (x-devteam-level, /api/data's viewer, GET /api/viewer) and the hub
// (/box.json's level); the owner and admins move members Full↔View, which closes their sockets and
// drops their push subscriptions at once. Tests for the org-access goal's measure are named
// 'org-access A12: …' and 'org-access A14: …'. The helpers below are test/org-access.methods.test.mjs's
// (copied: no imports between test files); people and sessions are seeded by writing the state file.
// Run: node --test test/org-access.view.test.mjs (the Chrome tests need node 22 and a Chrome).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// the suite's shared env scrub and tmux shim, and this process's block of ports: DEVTEAM_PORT_BASE
// is PORTS + 1, so the gateway's instances are PORTS + 1 … PORTS + 25
import { PORTS } from './lib/kit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const HUB_PAGE = path.join(repo, 'docs', 'devteam', 'dashboard', 'hub.html');
delete process.env.DEVTEAM_CLAIM_TOKEN;
// imported after lib/kit.mjs has set the ports the gateway reads at load
const G = await import(pathToFileURL(path.join(repo, 'cloud', 'gateway.mjs')).href);
const INSTANCE = PORTS + 1;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-view-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

const sha = (b) => crypto.createHash('sha256').update(b).digest();
const u = (b) => Buffer.from(b).toString('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const rid = (prefix) => prefix + Array.from(crypto.randomBytes(12), (x) => B32[x & 31]).join('');
// people@1's stamp, written apart from the gateway's
const stampOf = (ids) => u(sha(`devteam-people-stamp-v1\n${[...ids].sort().join('\n')}`));

// The texts the spec names, verbatim.
const T = {
  claimPasskey: 'a box is claimed with a passkey',
  invite: 'This invite has expired or was used; ask for a new one.',
  noState: 'no sign-in state',
  otherBrowser: 'unknown or expired challenge: this was started in another browser, or too long ago; start again',
  startAgain: 'unknown or expired challenge: start again',
  otherSession: 'this challenge was issued to another session: finish it where you started it',
  ended: 'your session ended; sign in again',
  notFresh: 'sign in again to change your sign-in methods (reload this page)',
  changed: 'your account changed since; start again',
  nobody: 'no one on this box signs in with that',
  taken: 'that sign-in method is already registered',
  claimExpired: 'this claim link has expired: restart the box, or run devteam-reclaim in a shell on it, for a new one',
};
// people@1's documented keys
const ROW_KEYS = ['id', 'name', 'role', 'level', 'methods', 'pushSubs', 'added_at', 'last_seen', 'notices', 'rev'];
const METHOD_KEYS = ['id', 'type', 'key', 'label', 'added_at', 'last_used', 'data'];
const PEOPLE_SESSION_KEYS = ['hash', 'person', 'method', 'at', 'expires'];
const SESSION_KEYS = ['hash', 'method', 'at', 'expires'];
const PASSKEY_KEYS = ['id', 'userId', 'jwk', 'alg', 'signCount', 'name', 'rp', 'createdAt'];
const keysOf = (o) => Object.keys(o).sort();
const sorted = (a) => [...a].sort();

// --- the stub: a second method type, as a provider's would be ------------------------------------
// start sends { hello: 'stub' }; finish takes its key from the body (and waits body.delayMs first,
// a provider's token fetch), returning an `email` the gateway must ignore; finishByGet: a redirect type.
// `finishing`, when a test sets it, is called as a finish begins: a race test waits on it rather than
// on a fixed sleep, so the state is rewritten while the finish is really in flight.
let finishing = null;
const stub = {
  start: () => ({ send: { hello: 'stub' } }),
  finish: async ({ body }) => {
    finishing?.();
    if (body.delayMs) await sleep(Number(body.delayMs));
    if (!body.key) throw new Error('no key');
    return { key: body.key, data: { n: Number(body.n ?? 0) }, email: body.email };
  },
  describe: ({ key }) => `stub ${key}`,
  finishByGet: true,
};
// a stub method as people@1 holds it, for seeding
const stubMethod = (key) => ({ id: rid('m-'), type: 'stub', key, label: `stub ${key}`, added_at: new Date().toISOString(), last_used: null, data: { n: 0 } });

// --- a software authenticator, as test/org-access.people-state.test.mjs's ------------------------
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
    get(opts, origin, { flags = 0x05, counter } = {}) {
      const cd = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: opts.challenge, origin }));
      const c = Buffer.alloc(4); c.writeUInt32BE(counter ?? ++count);
      const ad = Buffer.concat([sha(opts.rpId), Buffer.from([flags]), c]);
      const sig = crypto.sign('sha256', Buffer.concat([ad, sha(cd)]), privateKey);
      return { rawId: u(id), clientDataJSON: u(cd), authenticatorData: u(ad), signature: u(sig), userHandle: this.userHandle ?? null };
    },
    // this passkey as a person's method (people@1), as if registered on box.localhost
    method(label = 'passkey 1') {
      this.userHandle ??= u(crypto.randomBytes(16));
      return { id: rid('m-'), type: 'passkey', key: u(id), label, added_at: new Date().toISOString(), last_used: null, data: { userId: this.userHandle, jwk, alg: -7, signCount: 0, rp: 'box.localhost' } };
    },
  };
}

// --- the fake: rows of people@1, appended to a state, as people-state's seedPeople ---------------
function seedPeople(state, people) {
  const held = new Set((state.passkeys ?? []).map((p) => `passkey\n${p.id}`));
  for (const p of state.people ?? []) for (const m of p.methods ?? []) held.add(`${m.type}\n${m.key}`);
  const rows = people.map(({ name, role = 'member', level = 'full', methods = [] }) => {
    for (const m of methods) {
      const k = `${m.type}\n${m.key}`;
      if (held.has(k)) throw new Error(`(${m.type}, ${m.key}) is already on the box`);
      held.add(k);
    }
    return { id: rid('p-'), name, role, level, methods, pushSubs: [], added_at: new Date().toISOString(), last_seen: null, notices: [], rev: 1 };
  });
  return { state: { ...state, people: [...(state.people ?? []), ...rows] }, rows };
}

// --- a gateway on a free port, and a browser's requests to it -------------------------------------
const freePort = () => new Promise((resolve, reject) => { const v = net.createServer(); v.on('error', reject); v.listen(0, '127.0.0.1', () => { const { port } = v.address(); v.close(() => resolve(port)); }); });
let made = 0;
// extra.https: a box served over HTTPS (publicUrl https://box.localhost, requests sent to the free
// port with Host: box.localhost, as test/gateway.test.mjs's https test). extra.dir: reopen a state.
async function gateway(name, extra = {}) {
  const { https = false, ...opts } = extra;
  const tag = `${name}-${++made}`;
  const port = await freePort();
  const publicUrl = https ? 'https://box.localhost' : `http://box.localhost:${port}`;
  const pub = new URL(publicUrl);
  const host = pub.host;
  const inst = (p) => `${pub.protocol}//${p}.${host}`;
  const ttydPage = path.join(tmp, `${tag}-ttyd.html`);
  fs.writeFileSync(ttydPage, 'the gateway\'s copy of ttyd');
  const uploadsDir = path.join(tmp, `${tag}-uploads`);
  fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o750 });
  const logs = [];
  const dir = opts.dir ?? path.join(tmp, tag);
  const g = G.createGateway({ publicUrl, dir, ttydPort: await freePort(), ttydPage, uploadsDir, hubPage: HUB_PAGE, log: (m) => logs.push(m), methodTypes: { stub }, ...opts });
  await new Promise((r) => g.server.listen(port, '127.0.0.1', r));
  const token = /claim#([\w-]+)/.exec(logs.join('\n'))?.[1];
  const file = path.join(dir, 'state.json');
  const state = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  // write-to-tmp-then-rename, so the store sees a replaced file and re-reads it
  const write = (s) => { const t = `${file}.test.tmp`; fs.writeFileSync(t, JSON.stringify(s, null, 2), { mode: 0o600 }); fs.renameSync(t, file); };
  const raw = (method, route, { body, cookie = '', headers = {} } = {}) => new Promise((resolve, reject) => {
    const h = { host, ...(method !== 'GET' ? { origin: publicUrl, 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers };
    const r = http.request({ host: '127.0.0.1', port, method, path: route, headers: h }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(b); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, cookies: res.headers['set-cookie'] ?? [], body: b, json: j });
      });
    });
    r.on('error', reject);
    r.end(body === undefined ? undefined : JSON.stringify(body));
  });
  return { g, port, publicUrl, host, inst, logs, token, dir, file, state, write, raw, close: () => new Promise((r) => g.server.close(r)) };
}

const FLOW_NAME = /^(__Host-)?devteam_flow=/;
const flowCookieOf = (r) => r.cookies.find((c) => FLOW_NAME.test(c)) ?? null;
const sessionCookieOf = (r) => r.cookies.find((c) => c.startsWith('devteam_session=')) ?? null;
// the stored hash of a `devteam_session=<token>` pair
const hashOf = (pair) => u(sha(Buffer.from(pair.slice(pair.indexOf('=') + 1), 'base64url')));
const pairsIn = (pair) => (pair ? pair.slice(pair.indexOf('=') + 1).split('~').filter(Boolean) : []);

// A browser: one jar, its session cookie and its flow cookie kept apart. Each request sends both
// unless told otherwise (session: / flow: a pair to send instead, or null for none); store: false
// keeps the jar as it was.
function browser(gw, { session = null } = {}) {
  const jar = { session, flow: null };
  const req = async (method, route, { body, headers, session: s = jar.session, flow: f = jar.flow, store = true } = {}) => {
    const r = await gw.raw(method, route, { body, headers, cookie: [s, f].filter(Boolean).join('; ') });
    if (store) {
      for (const c of r.cookies) {
        const pair = c.split(';')[0];
        const gone = /;\s*Max-Age=0\s*(;|$)/i.test(c);
        if (c.startsWith('devteam_session=')) jar.session = gone ? null : pair;
        else if (FLOW_NAME.test(c)) jar.flow = gone ? null : pair;
      }
    }
    return r;
  };
  const post = (route, body, o = {}) => req('POST', route, { body, ...o });
  return {
    jar, req, post,
    start: (type, body, o) => post(`/auth/method/${type}/start`, body, o),
    finish: (type, body, o) => post(`/auth/method/${type}/finish`, body, o),
  };
}

const refused = (r, status, error, what) => {
  assert.equal(r.status, status, `${what}: ${r.status} ${r.body}`);
  assert.deepEqual(r.json, { error }, what);
};
const ok = (r, what) => assert.equal(r.status, 200, `${what}: ${r.status} ${r.body}`);

// The owner claims the box through today's claim routes; the owner's browser keeps the session.
async function claim(gw) {
  const owner = browser(gw);
  const key = authenticator();
  const o = await owner.post('/auth/claim/options', { token: gw.token });
  ok(o, 'claim options');
  const v = await owner.post('/auth/claim/verify', { token: gw.token, ...key.create(o.json, gw.publicUrl) });
  ok(v, 'claim verify');
  assert.ok(owner.jar.session, 'the claim opened a session');
  return { owner, ownerKey: key };
}
const seed = (gw, people) => { const { state: s, rows } = seedPeople(gw.state(), people); gw.write(s); return rows; };
// An invite for a person, as kit-248 will write one: hash = b64u(sha256(token)), expires epoch ms.
function seedInvite(gw, personId, { expires = Date.now() + 864e5 } = {}) {
  const token = u(crypto.randomBytes(32));
  const s = gw.state();
  gw.write({ ...s, invites: [...(s.invites ?? []), { hash: u(sha(token)), person: personId, expires }] });
  return token;
}
// A session for a person other than the owner, minted as the gateway mints one; its cookie pair.
function mintSession(gw, personId, methodId, { at = Date.now() } = {}) {
  const tok = crypto.randomBytes(32);
  const s = gw.state();
  gw.write({ ...s, peopleSessions: [...(s.peopleSessions ?? []), { hash: u(sha(tok)), person: personId, method: methodId, at, expires: at + 3600e3 }] });
  return `devteam_session=${u(tok)}`;
}
// What `node cloud/gateway.mjs reclaim` writes (cloud/gateway.mjs:2815-2816), without the new claim.
function reclaim(gw) {
  const s = gw.state();
  const people = s.people?.map((p) => (p.role === 'owner' ? { ...p, methods: [], rev: p.rev + 1 } : p));
  gw.write({ ...s, passkeys: [], sessions: [], pushSubs: [], peopleSessions: [], invites: [], ...(people ? { people } : {}), peopleStamp: stampOf([]) });
}
const rowOf = (gw, id) => gw.state().people.find((p) => p.id === id);
// whose a session is, from the state: { top, entry }
const sessionIn = (gw, pair) => {
  const h = hashOf(pair);
  const s = gw.state();
  const top = s.sessions.find((x) => x.hash === h);
  if (top) return { top: true, entry: top };
  const entry = (s.peopleSessions ?? []).find((x) => x.hash === h);
  return entry ? { top: false, entry } : null;
};

// A claimed box with Ana on it (member, full, one passkey, plus whatever `methods` adds).
async function setup(name, { gwOpts = {}, methods = [] } = {}) {
  const gw = await gateway(name, gwOpts);
  try {
    const { owner, ownerKey } = await claim(gw);
    const anaKey = authenticator();
    const [ana] = seed(gw, [{ name: 'Ana', methods: [anaKey.method(), ...methods] }]);
    return { gw, owner, ownerKey, ana, anaKey };
  } catch (e) { await gw.close(); throw e; }
}
// Ana's own browser, signed in fresh with her passkey's method
const anaBrowser = (gw, ana) => browser(gw, { session: mintSession(gw, ana.id, ana.methods[0].id) });


// --- the checks ----------------------------------------------------------------------------------
const VIEW_CODE = 'view-only';
const VIEW_ANY = 'View only: you can look at everything here, but not change anything.';
const VIEW_TERM = 'View only: there is no terminal for view-only people.';
// A claimed box with Ana (member, View, two passkeys) and Jo (member, Full), each with a session.
async function viewSetup(name, extra) {
  const gw = await gateway(name, extra);
  const { owner } = await claim(gw);
  const anaKey = authenticator();
  const anaKey2 = authenticator();
  const joKey = authenticator();
  const [ana, jo] = seed(gw, [{ name: 'Ana', level: 'view', methods: [anaKey.method(), anaKey2.method('passkey 2')] }, { name: 'Jo', level: 'full', methods: [joKey.method()] }]);
  const view = browser(gw, { session: mintSession(gw, ana.id, ana.methods[0].id) });
  const full = browser(gw, { session: mintSession(gw, jo.id, jo.methods[0].id) });
  return { gw, owner, ana, jo, view, full };
}
// 403 view-only, as JSON ({ error, code }) or, for a navigation, the sentence as text
const isView = (r, what) => {
  assert.equal(r.status, 403, `${what}: ${r.status} ${r.body.slice(0, 120)}`);
  const code = r.json?.code ?? (/^View only/.test(r.body) ? VIEW_CODE : null);
  assert.equal(code, VIEW_CODE, `${what}: ${r.body.slice(0, 120)}`);
};
const notView = (r, what) => assert.ok(r.status !== 403 || (r.json?.code !== VIEW_CODE && !/^View only/.test(r.body)), `${what}: refused as view (${r.status} ${r.body.slice(0, 120)})`);
// A socket handshake: its status, or 101; `keep` holds the socket open and hands it back.
const upgrade = (gw, host, origin, cookie, route, { keep = false } = {}) => new Promise((resolve) => {
  const r = http.request({ host: '127.0.0.1', port: gw.port, path: route, headers: { host, origin, cookie, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' } });
  r.on('response', (res) => { res.resume(); resolve(keep ? { status: res.statusCode } : res.statusCode); });
  r.on('upgrade', (res, s) => { if (keep) resolve({ status: 101, socket: s }); else { s.destroy(); resolve(101); } });
  r.on('error', (e) => resolve(`error ${e.code ?? e.message}`));
  r.setTimeout(3000, () => { r.destroy(); resolve('timeout'); });
  r.end();
});
// A box with one instance (alpha, a fake dashboard that records what reaches it), one preview
// (cool-tiger, a fake app that records what reaches it and answers sockets 101), behind a fake hub
// on PORTS that answers every GET; and, on the gateway's ttydPort, a ttyd stand-in that answers 101.
async function boxWithInstance(name) {
  const held = new Set();
  const track = (srv) => { srv.on('connection', (c) => { held.add(c); c.on('close', () => held.delete(c)); }); return srv; };
  const seen = [];
  const inst = track(http.createServer((q, s) => { q.resume(); q.on('end', () => { seen.push({ method: q.method, url: q.url, h: q.headers }); s.writeHead(200, { 'content-type': 'application/json' }); s.end('{"ok":true}'); }); }));
  await new Promise((r) => inst.listen(INSTANCE, '127.0.0.1', r));
  const devSeen = [];
  const dev = track(http.createServer((q, s) => { q.resume(); devSeen.push({ method: q.method, url: q.url, h: q.headers }); s.writeHead(200, { 'content-type': 'text/plain' }); s.end('the app'); }));
  dev.on('upgrade', (q, sock) => { devSeen.push({ method: 'UPGRADE', url: q.url, h: q.headers }); sock.on('error', () => {}); sock.write('HTTP/1.1 101 Switching Protocols\r\nconnection: Upgrade\r\nupgrade: websocket\r\n\r\n'); });
  await new Promise((r) => dev.listen(0, '127.0.0.1', r));
  const ttyd = track(net.createServer((sock) => { sock.on('error', () => {}); sock.once('data', () => sock.write('HTTP/1.1 101 Switching Protocols\r\nconnection: Upgrade\r\nupgrade: websocket\r\n\r\n')); }));
  await new Promise((r) => ttyd.listen(0, '127.0.0.1', r));
  const list = [{ devteam: 1, root: '/srv/alpha', port: INSTANCE, name: 'alpha', previews: [{ name: 'cool-tiger', port: dev.address().port, project: 'alpha', session: 'api-01-x', label: 'admin', at: '2026-11-10', up: true, run: false }] }];
  const hub = track(http.createServer((q, s) => { q.resume(); s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify(q.url.startsWith('/operator/') ? { threads: [] } : { hub: 1, instances: list })); }));
  await new Promise((r) => hub.listen(PORTS, '127.0.0.1', r));
  const V = await viewSetup(name, { ttydPort: ttyd.address().port });
  track(V.gw.g.server);
  const close0 = V.gw.close;
  const close = async () => { for (const c of held) c.destroy(); V.gw.g.server.closeAllConnections?.(); await close0(); for (const x of [inst, dev, hub, ttyd]) { x.closeAllConnections?.(); await new Promise((r) => x.close(r)); } };
  const alpha = `alpha.${V.gw.host}`;
  const pv = `cool-tiger.${V.gw.host}`;
  const at = (b, h, method, route, o = {}) => b.req(method, route, { ...o, headers: { host: h, ...(method !== 'GET' && method !== 'HEAD' ? { origin: `http://${h}` } : {}), ...o.headers } });
  for (let i = 0; i < 100; i++) { const r = await at(V.full, alpha, 'GET', '/api/hello'); const p = await at(V.full, pv, 'GET', '/'); if (r.status === 200 && p.status === 200) break; await sleep(100); }
  seen.length = 0; devSeen.length = 0;
  return { ...V, seen, devSeen, alpha, pv, at, close };
}
const onBox = (name, f) => test(name, async () => { const B = await boxWithInstance(name.replace(/\W+/g, '-').slice(0, 24)); try { await f(B); } finally { await B.close(); } });
const PUSH = { endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } };

test('org-access A12: a view session is refused every operator post', async () => {
  const { gw, view } = await viewSetup('c1');
  try { for (const a of ['thread-new', 'thread-say', 'thread-close', 'thread-reopen', 'start']) isView(await view.post(`/operator/${a}`, { id: 't-1', text: 'hi' }), a); } finally { await gw.close(); }
});
test('org-access A12: a view session is refused the terminal name, GET and HEAD too', async () => {
  const { gw, view } = await viewSetup('c2');
  try {
    for (const r of ['/', '/token', '/build']) isView(await view.req('GET', r, { headers: { host: `term.${gw.host}` } }), `term ${r}`);
    const h = await view.req('HEAD', '/', { headers: { host: `term.${gw.host}` } });
    assert.equal(h.status, 403, `HEAD term /: ${h.status}`);
    const nav = await view.req('GET', '/', { headers: { host: `term.${gw.host}`, 'sec-fetch-mode': 'navigate' } });
    assert.equal(nav.body, VIEW_TERM, 'a navigation reads the terminal sentence');
  } finally { await gw.close(); }
});
test('org-access A12: a view session is refused the terminal socket', async () => {
  const { gw, view } = await viewSetup('c3');
  try { assert.equal(await upgrade(gw, `term.${gw.host}`, `http://term.${gw.host}`, view.jar.session, '/ws'), 403); } finally { await gw.close(); }
});
test('org-access A12: a view session is refused push subscribe and test; a full one is not refused as view', async () => {
  const { gw, view, full } = await viewSetup('c4');
  try {
    isView(await view.post('/push/subscribe', PUSH), 'subscribe');
    isView(await view.post('/push/test', { endpoint: PUSH.endpoint }), 'test');
    notView(await full.post('/push/subscribe', PUSH), 'a full subscribe');
  } finally { await gw.close(); }
});
test('org-access A12: a view session is refused the publish pages: text to a navigation, JSON to a fetch', async () => {
  const { gw, view } = await viewSetup('c5');
  try {
    for (const r of ['/public/', '/public/publish?project=alpha', '/public/unpublish?project=alpha']) isView(await view.req('GET', r, { headers: { 'sec-fetch-dest': 'document' } }), r);
    const nav = await view.req('GET', '/public/', { headers: { 'sec-fetch-mode': 'navigate' } });
    assert.equal(nav.status, 403);
    assert.match(nav.headers['content-type'], /^text\/plain/, 'a navigation gets text');
    assert.equal(nav.body, VIEW_ANY);
    const f = await view.req('GET', '/public/', { headers: { 'sec-fetch-mode': 'cors' } });
    assert.equal(f.status, 403);
    assert.match(f.headers['content-type'], /^application\/json/, 'a fetch gets JSON');
    assert.deepEqual(f.json, { error: VIEW_ANY, code: VIEW_CODE });
  } finally { await gw.close(); }
});
onBox('org-access A12: a view session\'s dashboard POST is refused and never reaches it', async ({ view, at, alpha, seen }) => {
  isView(await at(view, alpha, 'POST', '/api/answer', { body: {} }), 'POST /api/answer');
  assert.equal(seen.length, 0, `the dashboard saw ${seen.map((x) => `${x.method} ${x.url}`).join(', ')}`);
});
onBox('org-access A12: a view session\'s signed posts are refused', async ({ view, at, alpha, seen }) => {
  isView(await at(view, alpha, 'POST', '/api/pane-answer', { body: {} }), 'pane-answer');
  isView(await at(view, alpha, 'POST', '/api/owner-setting', { body: {} }), 'owner-setting');
  assert.equal(seen.length, 0, 'the dashboard saw none');
});
onBox('org-access A12: a view session\'s uploads are refused', async ({ view, at, alpha, gw }) => {
  isView(await at(view, alpha, 'POST', '/upload?name=a.txt', { body: {} }), 'upload on a dashboard');
  isView(await at(view, `term.${gw.host}`, 'POST', '/upload?name=a.txt', { body: {} }), 'upload on term');
});
onBox('org-access A12: a view session\'s preview POST and socket are refused', async ({ view, at, pv, devSeen, gw }) => {
  isView(await at(view, pv, 'POST', '/x', { body: {} }), 'POST preview');
  assert.equal(await upgrade(gw, pv, `http://${pv}`, view.jar.session, '/hmr'), 403, 'preview socket');
  assert.equal(devSeen.length, 0, `the app saw ${devSeen.map((x) => `${x.method} ${x.url}`).join(', ')}`);
});
onBox('org-access A12: a view session\'s PUT, PATCH and DELETE are refused everywhere; its HEAD passes', async ({ view, at, alpha, pv, seen, devSeen }) => {
  for (const m of ['PUT', 'PATCH', 'DELETE']) {
    isView(await at(view, alpha, m, '/api/answer', { body: {} }), `${m} dashboard`);
    isView(await at(view, pv, m, '/x', { body: {} }), `${m} preview`);
    isView(await view.req(m, '/box.json', { body: {} }), `${m} box`);
  }
  assert.equal(seen.length + devSeen.length, 0, 'nothing reached the dashboard or the app');
  assert.equal((await at(view, alpha, 'HEAD', '/')).status, 200, 'HEAD dashboard');
  assert.equal((await view.req('HEAD', '/box.json')).status, 200, 'HEAD box.json');
});
test('org-access A12: a view session signs out', async () => {
  const { gw, view } = await viewSetup('c10');
  try {
    const pair = view.jar.session;
    ok(await view.post('/auth/logout', {}), 'logout');
    assert.equal(sessionIn(gw, pair), null, 'its session is gone');
  } finally { await gw.close(); }
});
test('org-access A12: a view session manages its own sign-in methods', async () => {
  const { gw, view, ana } = await viewSetup('c11');
  try {
    // answered before the session gate (spec S2), so it shows only that View doesn't break it; the two below are the exemption's own
    ok(await view.start('passkey', { purpose: 'add' }), 'method passkey start (add)');
    ok(await view.post('/auth/passkeys/options', {}), 'passkeys options');
    ok(await view.post('/auth/method/remove', { id: ana.methods[1].id }), 'remove its own second method');
    assert.ok(!rowOf(gw, ana.id).methods.some((m) => m.id === ana.methods[1].id), 'and it is gone');
  } finally { await gw.close(); }
});
onBox('org-access A12: the sign-out and sign-in-method exemptions hold on the box\'s name only', async ({ view, ana, at, alpha, pv, seen, devSeen }) => {
  for (const h of [alpha, pv]) {
    isView(await at(view, h, 'POST', '/auth/logout', { body: {} }), `logout on ${h}`);
    isView(await at(view, h, 'POST', '/auth/method/remove', { body: { id: ana.methods[1].id } }), `method remove on ${h}`);
    isView(await at(view, h, 'POST', '/auth/passkeys/options', { body: {} }), `passkeys options on ${h}`);
  }
  assert.equal(seen.length + devSeen.length, 0, 'nothing reached the dashboard or the app');
});
test('org-access A12: another person\'s method id is refused and stays', async () => {
  const { gw, view, jo } = await viewSetup('c12');
  try {
    const r = await view.post('/auth/method/remove', { id: jo.methods[0].id });
    assert.equal(r.status, 404, `${r.status} ${r.body}`);
    assert.ok(rowOf(gw, jo.id).methods.some((m) => m.id === jo.methods[0].id));
  } finally { await gw.close(); }
});
onBox('org-access A12: a view session opens the hub, dashboards, artifacts and previews', async ({ view, at, alpha, pv, seen }) => {
  for (const r of ['/', '/box.json', '/instances.json', '/dev/', '/operator/threads']) ok(await view.req('GET', r), `hub ${r}`);
  for (const r of ['/', '/api/data']) ok(await at(view, alpha, 'GET', r), `dashboard ${r}`);
  const cap = await at(view, alpha, 'GET', '/artifact/main/note/', { headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' } });
  assert.ok([301, 302, 303, 307].includes(cap.status), `the artifact's capability link: ${cap.status}`);
  const link = new URL(cap.headers.location, `http://${alpha}`);
  ok(await at(view, link.host, 'GET', `${link.pathname}${link.search}`), 'the artifact by its capability link');
  assert.ok(seen.some((x) => x.url.startsWith('/artifact/main/note/')), 'it reached the dashboard');
  ok(await at(view, pv, 'GET', '/'), 'preview /');
});
onBox('org-access A14: a dashboard request carries the session\'s level, never the browser\'s', async ({ view, full, at, alpha, pv, seen, devSeen }) => {
  await at(view, alpha, 'GET', '/api/data', { headers: { 'x-devteam-level': 'full' } });
  await at(full, alpha, 'GET', '/api/data', { headers: { 'x-devteam-level': 'view' } });
  assert.deepEqual(seen.map((x) => x.h['x-devteam-level']), ['view', 'full']);
  assert.ok(seen.every((x) => typeof x.h['x-devteam-person'] === 'string'), 'the person travels with the level (presence@1 §4)');
  seen.length = 0;
  const cap = await at(view, alpha, 'GET', '/artifact/main/note/', { headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' } });
  const link = new URL(cap.headers.location, `http://${alpha}`);
  await at(view, link.host, 'GET', `${link.pathname}${link.search}`, { headers: { 'x-devteam-level': 'full' } });
  assert.equal(seen.length, 1, 'the capability link reached the dashboard');
  assert.equal(seen[0].h['x-devteam-level'], undefined, 'a capability-link request carries no level');
  await at(view, pv, 'GET', '/', { headers: { 'x-devteam-level': 'full' } });
  assert.equal(devSeen.at(-1)?.h['x-devteam-level'], undefined, 'a preview request carries no level');
});
onBox('org-access A12: a view session\'s /api/term/* on a dashboard is 403 {why:view}', async ({ view, at, alpha, seen }) => {
  for (const [m, r] of [['GET', '/api/term/token'], ['GET', '/api/term/supervisor/screen'], ['POST', '/api/term/shell/keys'], ['GET', '/api//term/token'], ['GET', '/api/%74erm/token'], ['GET', '/api/x/../term/token'], ['GET', '/api/%2e%2e/api/term/token'], ['GET', '/api/x%3F/..%2Fterm/token'], ['GET', '/api/x%23/..%2Fterm/token'], ['GET', '/api/term/x%2F../../token'], ['GET', '/api/term/x%2f../../supervisor/screen']]) {
    const x = await at(view, alpha, m, r, { body: m === 'POST' ? {} : undefined });
    assert.equal(x.status, 403, `${m} ${r}: ${x.status}`);
    assert.equal(x.body, '{"why":"view"}', `${m} ${r}`);
    assert.match(x.headers['content-type'], /^application\/json/, `${m} ${r}`);
  }
  assert.equal(seen.length, 0, 'the dashboard saw none');
});
onBox('org-access A12: rule 0 is a dashboard\'s, not a preview\'s', async ({ view, at, pv, devSeen }) => {
  const x = await at(view, pv, 'GET', '/api/term/x');
  assert.equal(x.status, 200, `preview /api/term/x: ${x.status} ${x.body}`);
  assert.equal(x.body, 'the app');
  assert.ok(devSeen.some((d) => d.url === '/api/term/x'), 'the app saw it');
});
test('org-access A14: /box.json says the session\'s level', async () => {
  const { gw, view, owner, full } = await viewSetup('c15');
  try {
    assert.equal((await view.req('GET', '/box.json')).json.level, 'view');
    assert.equal((await full.req('GET', '/box.json')).json.level, 'full');
    assert.equal((await owner.req('GET', '/box.json')).json.level, 'full');
  } finally { await gw.close(); }
});
test('org-access A14: the owner\'s stand-in is Full and refused nothing as view', async () => {
  const gw = await gateway('c15b');
  try {
    const { owner } = await claim(gw);
    // a file restored from before people, read while running: no owner row, so the stand-in (S9)
    const { people, peopleStamp, ...before } = gw.state();
    gw.write(before);
    assert.equal(gw.state().people, undefined, 'a claimed file with no people');
    assert.equal((await owner.req('GET', '/box.json')).json.level, 'full');
    notView(await owner.post('/push/subscribe', PUSH), 'the stand-in subscribes');
    notView(await owner.req('GET', '/public/', { headers: { 'sec-fetch-mode': 'cors' } }), 'the stand-in publishes');
  } finally { await gw.close(); }
});
test('org-access A14: a level change takes effect on the next request', async () => {
  const { gw, full, jo } = await viewSetup('c17');
  try {
    notView(await full.post('/push/subscribe', PUSH), 'full first');
    const s = gw.state();
    gw.write({ ...s, people: s.people.map((p) => (p.id === jo.id ? { ...p, level: 'view', rev: p.rev + 1 } : p)) });
    isView(await full.post('/push/subscribe', PUSH), 'after the move');
    assert.equal((await full.req('GET', '/box.json')).status, 200, 'still signed in');
  } finally { await gw.close(); }
});

import { canDrive, openChrome } from './lib/chrome.mjs';
const CHROME_OK = { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 120000 };

// --- People offers View: the level route, the list, the invite (T2) ------------------------------
// The owner, Kai (an admin), Jo (Full), Ana (View), Pam (invited, not joined), each signed in now.
async function peopleSetup(name, extra) {
  const V = await viewSetup(name, extra);
  const kaiKey = authenticator();
  const [kai, pam] = seed(V.gw, [{ name: 'Kai', role: 'admin', level: 'full', methods: [kaiKey.method()] }, { name: 'Pam', level: 'full', methods: [] }]);
  seedInvite(V.gw, pam.id);
  const admin = browser(V.gw, { session: mintSession(V.gw, kai.id, kai.methods[0].id) });
  const ownerRow = V.gw.state().people.find((p) => p.role === 'owner');
  return { ...V, kai, pam, admin, ownerRow };
}
const move = (gw, b, id, level, rev = rowOf(gw, id).rev) => b.post('/auth/people/level', { id, rev, level });
const refusedCode = (r, status, code, what) => {
  assert.equal(r.status, status, `${what}: ${r.status} ${r.body}`);
  assert.equal(r.json?.code, code, `${what}: ${r.body}`);
};
test('org-access A14: the owner and an admin move a member to View and back', async () => {
  const { gw, owner, admin, jo, ana, kai, pam, ownerRow } = await peopleSetup('c18');
  try {
    for (const [who, b] of [['the owner', owner], ['an admin', admin]]) {
      const r0 = rowOf(gw, jo.id).rev;
      const v = await move(gw, b, jo.id, 'view');
      ok(v, `${who}: Jo to View`);
      assert.deepEqual(v.json, { ok: true, rev: r0 + 1 }, `${who}: its rev`);
      assert.equal(rowOf(gw, jo.id).level, 'view');
      const f = await move(gw, b, jo.id, 'full');
      ok(f, `${who}: Jo back to Full`);
      assert.deepEqual(f.json, { ok: true, rev: r0 + 2 });
      assert.equal(rowOf(gw, jo.id).level, 'full');
      for (const level of ['view', 'full']) refusedCode(await move(gw, b, ownerRow.id, level), 403, 'not-allowed', `${who}: the owner's row at ${level}`);
      refusedCode(await move(gw, b, kai.id, 'view'), 403, 'not-allowed', `${who}: an admin's row at View`);
      for (const level of ['view', 'full']) refusedCode(await move(gw, b, pam.id, level), 403, 'not-allowed', `${who}: a pending row at ${level}`);
      const before = fs.readFileSync(gw.file, 'utf8');
      const same = await move(gw, b, ana.id, 'view');
      assert.deepEqual(same.json, { ok: true, rev: rowOf(gw, ana.id).rev }, `${who}: Ana is View already`);
      assert.equal(fs.readFileSync(gw.file, 'utf8'), before, `${who}: nothing written`);
      refusedCode(await move(gw, b, jo.id, 'view', rowOf(gw, jo.id).rev - 1), 409, 'stale', `${who}: a stale rev`);
      refusedCode(await move(gw, b, jo.id, 'admin'), 400, 'bad-request', `${who}: level admin`);
      refusedCode(await b.post('/auth/people/level', { id: jo.id, rev: rowOf(gw, jo.id).rev }), 400, 'bad-request', `${who}: no level`);
    }
    assert.equal(rowOf(gw, kai.id).level, 'full', 'Kai is still Full');
    assert.equal(rowOf(gw, pam.id).level, 'full', 'Pam is still her invite\'s level');
  } finally { await gw.close(); }
});
test('org-access A14: a move to View closes their terminal and preview sockets and drops their push subscriptions', { timeout: 20000 }, async () => {
  const B = await boxWithInstance('c19');
  try {
    const { gw, owner, full, jo, pv } = B;
    const s = gw.state();
    gw.write({ ...s, people: s.people.map((p) => (p.id === jo.id ? { ...p, pushSubs: [{ endpoint: 'https://push.example/jo', keys: { p256dh: 'a', auth: 'b' }, added_at: new Date().toISOString() }] } : p)) });
    const term = await upgrade(gw, `term.${gw.host}`, `http://term.${gw.host}`, full.jar.session, '/ws', { keep: true });
    const prev = await upgrade(gw, pv, `http://${pv}`, full.jar.session, '/hmr', { keep: true });
    assert.equal(term.status, 101, 'Jo\'s terminal socket opened');
    assert.equal(prev.status, 101, 'Jo\'s preview socket opened');
    const closed = (sock, what) => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${what} still open after 1 s`)), 1000);
      sock.once('close', () => { clearTimeout(t); resolve(); });
    });
    const both = Promise.all([closed(term.socket, 'the terminal socket'), closed(prev.socket, 'the preview socket')]);
    ok(await move(gw, owner, jo.id, 'view'), 'Jo to View');
    await both;
    assert.deepEqual(rowOf(gw, jo.id).pushSubs, [], 'their push subscriptions are gone');
  } finally { await B.close(); }
});
test('org-access A14: People lists the level action on every joined member, for the owner and an admin', async () => {
  const { gw, owner, admin, jo, ana, kai, pam, ownerRow } = await peopleSetup('c20');
  try {
    const has = (list, id) => list.json.people.find((x) => x.id === id)?.actions ?? null;
    const byOwner = await owner.req('GET', '/auth/people/list');
    ok(byOwner, 'the owner\'s list');
    for (const id of [jo.id, ana.id]) assert.ok(has(byOwner, id).includes('level'), `the owner: ${id}`);
    for (const id of [ownerRow.id, kai.id, pam.id]) assert.ok(!has(byOwner, id).includes('level'), `the owner: none on ${id}`);
    const byAdmin = await admin.req('GET', '/auth/people/list');
    ok(byAdmin, 'the admin\'s list');
    for (const id of [jo.id, ana.id]) assert.ok(has(byAdmin, id).includes('level'), `the admin: ${id}`);
    for (const id of [ownerRow.id, kai.id, pam.id]) assert.ok(!(has(byAdmin, id) ?? []).includes('level'), `the admin: none on ${id}`);
  } finally { await gw.close(); }
});
const tokenOf = (link) => decodeURIComponent(new URL(link).hash.slice(1));
test('org-access A14: an invite at View claims at View', async () => {
  const gw = await gateway('c21');
  try {
    const { owner } = await claim(gw);
    const r = await owner.post('/auth/people/invite', { name: 'Vi', level: 'view' });
    ok(r, 'an invite at View');
    assert.equal(rowOf(gw, r.json.person.id).level, 'view', 'its row is View');
    const peek = await gw.raw('POST', '/auth/claim/invite', { body: { token: tokenOf(r.json.link) } });
    assert.equal(peek.json.level, 'view', 'the invite page learns View');
    const key = authenticator();
    const b = browser(gw);
    const st = await b.post('/auth/method/passkey/start', { purpose: 'invite', token: tokenOf(r.json.link) });
    ok(st, 'invite start');
    ok(await b.post('/auth/method/passkey/finish', { purpose: 'invite', name: 'laptop', ...key.create(st.json, gw.publicUrl) }), 'invite finish');
    assert.equal((await b.req('GET', '/box.json')).json.level, 'view', 'they join at View');
    for (const level of ['admin', 'owner', 7, null]) refusedCode(await owner.post('/auth/people/invite', { name: 'Bea', level }), 400, 'bad-request', `level ${JSON.stringify(level)}`);
  } finally { await gw.close(); }
});
test('org-access A14: in Chrome, the invite page says view only for a View invite', CHROME_OK, async () => {
  const gw = await gateway('c21b');
  const chrome = await openChrome();
  try {
    const { owner } = await claim(gw);
    const p = await chrome.newPage();
    await p.send('Runtime.enable');
    const said = async (level, name) => {
      const r = await owner.post('/auth/people/invite', { name, level });
      ok(r, `an invite at ${level}`);
      // from about:blank: a link that differs only by its hash would not load the page again
      await p.send('Page.navigate', { url: 'about:blank' });
      for (let i = 0; i < 50 && (await p.ev('location.href').catch(() => '')) !== 'about:blank'; i++) await sleep(100);
      await p.send('Page.navigate', { url: `${gw.publicUrl}/auth/claim#${encodeURIComponent(tokenOf(r.json.link))}` });
      for (let i = 0; i < 100; i++) {
        const t = await p.ev(`document.getElementById('who')?.textContent ?? ''`).catch(() => '');
        if (t.includes(name)) return t;
        await sleep(100);
      }
      return '';
    };
    const view = await said('view', 'Vi');
    assert.equal(view, `You're invited to ${gw.host}, Vi, as view only: you can see the hub, dashboards, artifacts, boards and goals, and change nothing. One exception: opening a running preview can set off what that app does when a page opens.`);
    const full = await said('full', 'Fu');
    assert.equal(full, `You're invited to ${gw.host}, Fu, as Full: you can do everything on the box except manage people.`);
  } finally { await chrome.close(); await gw.close(); }
});

// --- the dashboard learns the level: /api/data's viewer and GET /api/viewer (T3) ------------------
import { bareProject, dashboardOnFreePort } from './lib/kit.mjs';
// A real dashboard on a bare project (its own HOME; kit.mjs points it at this file's hub port).
async function realDashboard(name) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `kit250-${name}-`));
  const root = bareProject(base, 'alpha');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEVTEAM_') || k === 'DEVTEAM_HUB_PORT' || k === 'DEVTEAM_PORT_BASE')), HOME: base };
  const { dash, port } = await dashboardOnFreePort(root, env);
  return { base, root, dash, port, close: async () => { await dash.stop(); fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } };
}
// a GET with these raw header lines (a header named twice is sent twice)
const getWith = (port, route, lines = []) => new Promise((resolve, reject) => {
  const headers = {};
  for (const [k, v] of lines) headers[k] = Object.hasOwn(headers, k) ? [].concat(headers[k], v) : v;
  const r = http.get({ host: '127.0.0.1', port, path: route, headers }, (res) => {
    let b = '';
    res.on('data', (c) => { b += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
  });
  r.on('error', reject);
});
test('org-access A14: /api/data\'s viewer echoes the gateway\'s level, and nothing else', { timeout: 120000 }, async () => {
  const R = await realDashboard('c16');
  try {
    const data = async (lines) => { const r = await getWith(R.port, '/api/data', lines); assert.equal(r.status, 200, r.body.slice(0, 200)); return JSON.parse(r.body); };
    const plain = await data([]);
    assert.equal(plain.viewer, undefined, 'no header, no viewer');
    const first = Object.keys(plain)[0];
    for (const [what, lines] of [['admin', [['x-devteam-level', 'admin']]], ['VIEW', [['x-devteam-level', 'VIEW']]], ['a list', [['x-devteam-level', 'view, full']]], ['sent twice', [['x-devteam-level', 'view'], ['x-devteam-level', 'view']]]]) {
      const d = await data(lines);
      assert.equal(d.viewer, undefined, `${what}: no viewer`);
      assert.equal(Object.keys(d)[0], first, `${what}: the body as it was`);
    }
    for (const level of ['full', 'view']) {
      const d = await data([['x-devteam-level', level]]);
      assert.deepEqual(d.viewer, { level }, level);
      assert.equal(Object.keys(d)[0], 'viewer', `${level}: its first key`);
      assert.deepEqual(Object.keys(d).slice(1), Object.keys(plain), `${level}: and the rest as it was`);
      const v = await getWith(R.port, '/api/viewer', [['x-devteam-level', level]]);
      assert.equal(v.status, 200);
      assert.equal(v.headers['cache-control'], 'no-store');
      assert.deepEqual(JSON.parse(v.body), { level }, `/api/viewer: ${level}`);
    }
    for (const lines of [[], [['x-devteam-level', 'admin']], [['x-devteam-level', 'view'], ['x-devteam-level', 'full']]]) {
      assert.deepEqual(JSON.parse((await getWith(R.port, '/api/viewer', lines)).body), { level: null }, `/api/viewer: ${JSON.stringify(lines)}`);
    }
  } finally { await R.close(); }
});
