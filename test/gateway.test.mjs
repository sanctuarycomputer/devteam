// The cloud gateway (cloud/gateway.mjs): claiming a box with a passkey, signing in, and passing the
// owner through to a real hub and dashboard as if from a local browser. A software authenticator
// stands in for the owner's password manager. Run: node --test
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
// the suite's shared env scrub, tmux shim and stand-ins (it also claims a port block, unused here)
import { PORTS as KIT_PORTS, fleetFixture, startDashboard, write } from './lib/kit.mjs';
import { canDrive, openChrome } from './lib/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const kit = path.resolve(here, '..', 'docs', 'devteam');
// ports of its own, apart from the blocks lib/kit.mjs hands out (20000 and up); set after its import, so these win.
// The gateway reads the hub's port and the instance block once, at import, so the whole file shares
// one range: the hub's port and the 25 after it, every one seen free here, never a range something on
// the box already holds. It starts at a slot of its own process id, below the ephemeral ports.
const bindable = (port) => new Promise((ok) => { const v = net.createServer(); v.once('error', () => ok(false)); v.listen(port, '127.0.0.1', () => v.close(() => ok(true))); });
async function freeRange() {
  for (let i = 0; i < 90; i++) {
    const base = 10000 + ((process.pid + i) % 90) * 100;
    let all = true;
    for (let p = base; p <= base + 25 && all; p++) all = await bindable(p);
    if (all) return base;
  }
  throw new Error('no free range of 26 ports between 10000 and 19000');
}
const PORTS = await freeRange();
const HUB = PORTS;
const P = PORTS + 1;
process.env.DEVTEAM_HUB_PORT = String(HUB);
process.env.DEVTEAM_PORT_BASE = String(P);
process.env.DEVTEAM_HUB_RETRY_MS = '500';
delete process.env.DEVTEAM_CLAIM_TOKEN;
const G = await import('../cloud/gateway.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-gw-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

// --- a software authenticator ------------------------------------------------------------------
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
function authenticator(kind = 'es256') {
  const { publicKey, privateKey } = kind === 'ed25519' ? crypto.generateKeyPairSync('ed25519') : crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = kind === 'ed25519' ? new Map([[1, 1], [3, -8], [-1, 6], [-2, Buffer.from(jwk.x, 'base64url')]]) : new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
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
      const sig = crypto.sign(kind === 'ed25519' ? null : 'sha256', Buffer.concat([ad, sha(cd)]), key);
      return { rawId: u(id), clientDataJSON: u(cd), authenticatorData: u(ad), signature: u(sig), userHandle: userHandle ?? this.userHandle ?? null };
    },
  };
}

// --- a gateway on a localhost URL, and requests with the headers a browser would send ----------
const freePort = () => new Promise((resolve, reject) => { const v = net.createServer(); v.on('error', reject); v.listen(0, '127.0.0.1', () => { const { port } = v.address(); v.close(() => resolve(port)); }); });
// The box's ENV reaches every process on it, these tests included: a gateway or child that reads
// the image's variables gets them only where a test means it to.
const BOX_VARS = ['DEVTEAM_IMAGE_HUB', 'DEVTEAM_KIT_RELEASE', 'DEVTEAM_BOX_TOOLS'];
const cleared = (extra = {}) => { const e = { ...process.env }; for (const k of BOX_VARS) delete e[k]; return Object.assign(e, extra); };
async function gateway(name, extra = {}) {
  const port = await freePort();
  const publicUrl = `http://box.localhost:${port}`;
  const inst = (p) => `http://${p}.box.localhost:${port}`;
  const auth = publicUrl;
  const term = `http://term.box.localhost:${port}`;
  const site = `http://public.box.localhost:${port}`;
  const ttydPage = path.join(tmp, `${name}-ttyd.html`);
  fs.writeFileSync(ttydPage, 'the gateway\'s copy of ttyd');
  const logs = [];
  const dir = path.join(tmp, name);
  const ttydPort = await freePort();
  const uploadsDir = path.join(tmp, `${name}-uploads`);
  fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o750 });
  const g = G.createGateway({ publicUrl, dir, ttydPort, ttydPage, uploadsDir, log: (m) => logs.push(m), ...extra });
  await new Promise((r) => g.server.listen(port, '127.0.0.1', r));
  const token = /claim#([A-Za-z0-9_-]+)/.exec(logs.join('\n'))?.[1];
  let jar = '';
  let flowJar = ''; // the flow cookie of a passkey ceremony, sent to the box's own name beside the session
  // on: an instance's port, for its subdomain; else the box's own name. flow: '' sends and stores no flow cookie
  const req = (method, route, { body, headers = {}, cookie = jar, flow, on = route.startsWith('/auth/') ? 'auth' : undefined } = {}) => new Promise((resolve, reject) => {
    const self = on === 'auth' ? auth : on === 'term' ? term : on === 'public' ? site : on ? inst(on) : publicUrl;
    const sent = [cookie, self === publicUrl ? (flow ?? flowJar) : ''].filter(Boolean).join('; ');
    const h = { host: new URL(self).host, ...(method !== 'GET' ? { origin: self, 'content-type': 'application/json' } : {}), ...(sent ? { cookie: sent } : {}), ...headers };
    for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
    const r = http.request({ host: '127.0.0.1', port, method, path: route, headers: h }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        const sc = res.headers['set-cookie']?.find((c) => c.startsWith('devteam_session='));
        if (sc) jar = sc.split(';')[0];
        if (flow !== '') for (const c of res.headers['set-cookie'] ?? []) { const m = /^(?:__Host-)?devteam_flow=([^;]*)/.exec(c); if (m) flowJar = /;\s*Max-Age=0\b/i.test(c) ? '' : c.split(';')[0]; }
        let j = null;
        try { j = JSON.parse(b); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: b, json: j });
      });
    });
    r.on('error', reject);
    r.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const claim = async (a, extraBody = {}) => {
    const o = await req('POST', '/auth/claim/options', { on: 'auth', body: { token } });
    assert.equal(o.status, 200, o.body);
    return req('POST', '/auth/claim/verify', { on: 'auth', body: { token, ...a.create(o.json, auth), ...extraBody } });
  };
  const login = async (a, how) => {
    const o = await req('POST', '/auth/login/options', { on: 'auth', body: {}, cookie: '' });
    return req('POST', '/auth/login/verify', { on: 'auth', body: a.get(o.json, auth, how), cookie: '' });
  };
  return { g, port, publicUrl, inst, auth, term, site, ttydPort, logs, token, req, claim, login, jar: () => jar, setJar: (v) => { jar = v; }, dir, uploadsDir, close: () => new Promise((r) => g.server.close(r)) };
}

// Where the signed-out page of a project's host sends a browser that is at href: it runs the page's own script.
const signedOutTo = (r, href) => {
  const code = [...r.body.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1] ?? '';
  const { origin, pathname } = new URL(href);
  let to = null;
  vm.runInNewContext(code, { location: { href, pathname, origin, replace: (x) => { to = x; } }, encodeURIComponent });
  return to;
};

test('cbor and cose: what WebAuthn needs, nothing more', () => {
  const m = new Map([[1, 2], ['a', Buffer.from([1, 2])], [-3, [true, false, null, 'x']]]);
  assert.deepEqual(G.cborDecode(cbor(m)).value, m);
  assert.equal(G.cborDecode(Buffer.from([0x19, 0x01, 0x00])).value, 256);
  assert.throws(() => G.cborDecode(Buffer.from([0x5f])), /indefinite/, 'indefinite lengths are refused');
  assert.throws(() => G.cborDecode(Buffer.from([0x45, 1, 2])), /truncated/);
  assert.throws(() => G.cborDecode(Buffer.from([0xc1, 0])), /unsupported/, 'tags are refused');
  let deep = Buffer.from([0]);
  for (let i = 0; i < 20; i++) deep = Buffer.concat([Buffer.from([0x81]), deep]);
  assert.throws(() => G.cborDecode(deep), /too deep/);
  assert.throws(() => G.coseToJwk(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.alloc(32)], [-3, Buffer.alloc(32)]])), 'a point not on the curve is refused');
  assert.throws(() => G.coseToJwk(new Map([[1, 2], [3, -35], [-1, 2]])), /unsupported/, 'only ES256, EdDSA and RS256');
  const weak = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 3 }).publicKey.export({ format: 'jwk' });
  assert.throws(() => G.coseToJwk(new Map([[1, 3], [3, -257], [-1, Buffer.from(weak.n, 'base64url')], [-2, Buffer.from(weak.e, 'base64url')]])), /exponent/);
});

test('claim: only with the token, once; then only the passkey gets in', async () => {
  const gw = await gateway('claim');
  try {
    assert.ok(gw.token, `the claim link is printed: ${gw.logs.join(' | ')}`);
    assert.equal((await gw.req('GET', '/', { headers: { 'sec-fetch-mode': 'navigate' } })).headers.location, `${gw.auth}/auth/login`, 'unclaimed: every page sends you to sign in, on the box\'s own name');
    assert.ok(gw.logs.join('\n').includes(`${gw.auth}/auth/claim#`), 'the claim link is on the box\'s own name');
    assert.equal((await gw.req('GET', '/auth')).headers.location, '/auth/login', '/auth is the sign-in');
    assert.equal((await gw.req('GET', '/auth/login', { headers: { host: `auth.box.localhost:${gw.port}` } })).status, 403, 'and there is no auth name any more: sign-in is the box\'s alone');
    assert.match((await gw.req('GET', '/auth/login')).body, /unclaimed/);
    assert.equal((await gw.req('GET', '/box.json')).status, 403, 'nothing behind the gateway answers an unclaimed box');
    const a = authenticator();
    // the claim token: a wrong one is refused
    assert.equal((await gw.req('POST', '/auth/claim/options', { body: { token: 'nope' } })).status, 403);
    // a create() for the wrong site or ceremony is refused, and spends its challenge
    let o = await gw.req('POST', '/auth/claim/options', { body: { token: gw.token } });
    let bad = await gw.req('POST', '/auth/claim/verify', { body: { token: gw.token, ...a.create(o.json, 'https://evil.example') } });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /origin/);
    o = await gw.req('POST', '/auth/claim/options', { body: { token: gw.token } });
    bad = await gw.req('POST', '/auth/claim/verify', { body: { token: gw.token, ...a.create(o.json, gw.inst('alpha')) } });
    assert.match(bad.json.error, /origin/, 'a passkey made on the box\'s own name (the hub, the terminal: bytes an agent can change) is refused');
    o = await gw.req('POST', '/auth/claim/options', { body: { token: gw.token } });
    bad = await gw.req('POST', '/auth/claim/verify', { body: { token: gw.token, ...a.create(o.json, gw.auth, { flags: 0x41 }) } });
    assert.match(bad.json.error, /verification/, 'a passkey that skipped user verification is refused');
    o = await gw.req('POST', '/auth/claim/options', { body: { token: gw.token } });
    bad = await gw.req('POST', '/auth/claim/verify', { body: { token: gw.token, ...a.create(o.json, gw.auth, { rpId: 'evil.example' }) } });
    assert.match(bad.json.error, /relying party/);
    const reused = await gw.req('POST', '/auth/claim/verify', { body: { token: gw.token, ...a.create(o.json, gw.auth) } });
    assert.match(reused.json.error, /challenge/, 'a challenge is good once');
    const ok = await gw.claim(a, { name: '1Password' });
    assert.equal(ok.status, 200, ok.body);
    assert.match(ok.headers['set-cookie'][0], /^devteam_session=[\w-]+; Domain=box\.localhost; Path=\/; HttpOnly; Max-Age=1209600; SameSite=Lax$/, 'one cookie for the box and its instances (SameSite=None; Secure on https)');
    assert.equal((await gw.req('GET', '/box.json')).json.terminal, `${gw.term}/`, 'claiming signs you in');
    assert.equal((await gw.req('POST', '/auth/claim/options', { body: { token: gw.token } })).status, 409, 'a claimed box takes no claim, the old token included');
    const state = JSON.parse(fs.readFileSync(path.join(gw.dir, 'state.json'), 'utf8'));
    assert.equal(state.claimHash, null, 'the token is gone');
    assert.equal(state.passkeys[0].name, '1Password');
    assert.ok(!JSON.stringify(state).includes(gw.jar().split('=')[1]), 'the session is stored only as a hash');
    assert.equal((fs.statSync(path.join(gw.dir, 'state.json')).mode & 0o777), 0o600);

    // signing in: the passkey, verified; nothing else
    gw.setJar('');
    assert.equal((await gw.req('GET', '/box.json')).status, 401);
    const signedOut = await gw.req('GET', '/x?y=1', { on: 'alpha', headers: { 'sec-fetch-mode': 'navigate' } });
    assert.equal(signedOut.status, 401);
    assert.equal(signedOutTo(signedOut, `${gw.inst('alpha')}/x?y=1`), `${gw.auth}/auth/login?next=${encodeURIComponent(`${gw.inst('alpha')}/x?y=1`)}`, 'a project sends you to sign in, and back');
    assert.equal((await gw.req('GET', '/x', { on: 'alpha' })).status, 401, 'a fetch gets a 401');
    // where signing in returns to: the box or an instance, never another site
    const nextOf = async (n) => /const next = ("[^"]*")/.exec((await gw.req('GET', `/auth/login?next=${encodeURIComponent(n)}`)).body)?.[1];
    assert.equal(await nextOf(`${gw.inst('alpha')}/a`), JSON.stringify(`${gw.inst('alpha')}/a`));
    assert.equal(await nextOf(`${gw.term}/`), JSON.stringify(`${gw.term}/`));
    for (const n of ['/\\evil.example', '//evil.example/', 'https://evil.example/', `http://${P}.box.localhost:${gw.port}/`, `http://${P + 25}.box.localhost:${gw.port}/`, `http://public.box.localhost:${gw.port}/`, 'javascript:alert(1)']) assert.equal(await nextOf(n), JSON.stringify(`${gw.publicUrl}/`), n);
    assert.equal((await gw.login(a)).status, 200);
    assert.equal((await gw.req('GET', '/box.json')).status, 200);
    const other = authenticator();
    assert.match((await gw.login(other)).json.error, /unknown passkey/);
    const forged = await (async () => { const o2 = await gw.req('POST', '/auth/login/options', { body: {}, cookie: '' }); const x = a.get(o2.json, gw.auth, { key: crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey }); return gw.req('POST', '/auth/login/verify', { body: x, cookie: '' }); })();
    assert.match(forged.json.error, /signature/, 'a signature from another key is refused');
    assert.match((await gw.login(a, { flags: 0x01 })).json.error, /verification/);
    assert.match((await gw.login(a, { type: 'webauthn.create' })).json.error, /ceremony/);
    assert.equal((await gw.login(a, { counter: 7 })).status, 200);
    assert.match((await gw.login(a, { counter: 7 })).json.error, /counter/, 'a counter that stops going up means a cloned key');
    assert.match((await gw.login(a, { counter: 9, userHandle: u(crypto.randomBytes(16)) })).json.error, /another account/);
    // passkeys belong to the box's name, and a login challenge can't be flooded away or used twice
    const flood = await gw.req('POST', '/auth/login/options', { body: {}, cookie: '' });
    assert.equal(flood.json.rpId, 'box.localhost');
    for (let i = 0; i < 300; i++) await gw.req('POST', '/auth/login/options', { body: {}, cookie: '', flow: '' });
    assert.match((await gw.req('POST', '/auth/login/verify', { body: a.get(flood.json, gw.inst('alpha'), { counter: 19 }), cookie: '' })).json.error, /origin/, 'a dashboard\'s page may ask for the passkey, but its answer is no sign-in');
    const once = a.get(flood.json, gw.auth, { counter: 20 });
    assert.equal((await gw.req('POST', '/auth/login/verify', { body: once, cookie: '' })).status, 200, 'a pending sign-in survives anyone asking for challenges');
    assert.match((await gw.req('POST', '/auth/login/verify', { body: once, cookie: '' })).json.error, /challenge/, 'and is good once');
    const forgedChallenge = { ...flood.json, challenge: u(crypto.randomBytes(40)) };
    assert.match((await gw.req('POST', '/auth/login/verify', { body: a.get(forgedChallenge, gw.auth, { counter: 21 }), cookie: '' })).json.error, /challenge/, 'a challenge the gateway didn\'t issue is refused');

    // a second passkey, and the last one can't be removed
    const b = authenticator('ed25519');
    // a challenge for adding one is good only in the session it was issued to
    const elsewhere = await gw.req('POST', '/auth/passkeys/options', { body: {} });
    const sess2 = (await gw.login(a, { counter: 30 })).headers['set-cookie'][0].split(';')[0];
    assert.match((await gw.req('POST', '/auth/passkeys/verify', { body: b.create(elsewhere.json, gw.auth), cookie: sess2 })).json.error, /challenge/);
    // and only in a session signed in the last five minutes
    const st = JSON.parse(fs.readFileSync(path.join(gw.dir, 'state.json'), 'utf8'));
    const mine = st.sessions.find((x) => x.hash === u(sha(Buffer.from(gw.jar().split('=')[1], 'base64url'))));
    const at = mine.at;
    mine.at = Date.now() - 600000;
    fs.writeFileSync(path.join(gw.dir, 'state.json'), JSON.stringify(st));
    assert.match((await gw.req('POST', '/auth/passkeys/options', { body: {} })).json.error, /sign in again/);
    assert.match((await gw.req('GET', '/auth/passkeys')).headers.location, /\/auth\/login\?next=/);
    assert.match((await gw.req('POST', '/auth/passkeys/remove', { body: { id: u(a.id) } })).json.error, /sign in again/, 'nor removed without one');
    mine.at = at;
    fs.writeFileSync(path.join(gw.dir, 'state.json'), JSON.stringify(st));
    const ao = await gw.req('POST', '/auth/passkeys/options', { body: {} });
    assert.deepEqual(ao.json.excludeCredentials.map((c) => c.id), [u(a.id)], 'the browser is told which passkeys are already here');
    assert.equal((await gw.req('POST', '/auth/passkeys/verify', { body: { ...b.create(ao.json, gw.auth), name: 'phone' } })).status, 200);
    assert.equal((await gw.login(b)).status, 200, 'an Ed25519 passkey signs in too');
    assert.equal((await gw.req('POST', '/auth/passkeys/remove', { body: { id: u(a.id) } })).status, 200);
    assert.equal((await gw.req('GET', '/box.json', { cookie: sess2 })).status, 401, 'removing a passkey ends every other session');
    assert.equal((await gw.req('GET', '/box.json')).status, 200, 'but not the one that removed it');
    assert.equal((await gw.req('POST', '/auth/passkeys/remove', { body: { id: u(b.id) } })).status, 400, 'never the last');
    assert.match((await gw.login(a)).json.error, /unknown passkey/, 'a removed passkey no longer opens the box');

    // sign out ends that session only
    const before = gw.jar();
    assert.equal((await gw.req('POST', '/auth/logout', { body: {} })).status, 200);
    assert.equal((await gw.req('GET', '/box.json', { cookie: before })).status, 401);
  } finally { await gw.close(); }
});

test('reclaim, and the gateway\'s own names and origins', async () => {
  const gw = await gateway('names');
  try {
    assert.equal((await gw.req('GET', '/', { headers: { host: 'evil.example' } })).status, 421, 'another Host gets nothing');
    for (const h of [`${P}.box.localhost:${gw.port}`, `public.box.localhost:${gw.port}`, `${P + 25}.box.localhost:${gw.port}`, `0${P}.box.localhost:${gw.port}`, `${P}.box.localhost`, `${P}.x.box.localhost:${gw.port}`]) assert.equal((await gw.req('GET', '/', { headers: { host: h } })).status, 421, h);
    assert.equal((await gw.req('GET', '/healthz', { headers: { host: 'internal' } })).status, 200, 'but the health check answers anyone');
    assert.equal((await gw.req('POST', '/auth/login/options', { body: {}, headers: { origin: 'https://evil.example' } })).status, 403, 'a POST from another site is refused before anything else');
    assert.equal((await gw.req('POST', '/auth/login/options', { body: {}, headers: { origin: undefined } })).status, 403, 'and so is one with no Origin');
    assert.equal((await gw.req('POST', '/auth/login/options', { body: {}, headers: { origin: gw.inst('alpha') } })).status, 403, 'and one from an instance\'s page: a dashboard can\'t act on the box');
    assert.equal((await gw.req('POST', '/api/fleet', { on: 'alpha', body: {}, headers: { origin: gw.publicUrl } })).status, 403, 'nor the box on an instance');
    assert.equal((await gw.req('POST', '/auth/login/options', { body: {}, headers: { origin: gw.term } })).status, 403, 'nor the terminal\'s');
    assert.equal((await gw.req('GET', 'http://evil.example/', { headers: { host: `box.localhost:${gw.port}` } })).status, 400, 'a request line with a full URL is refused');
  } finally { await gw.close(); }
  // reclaim: from a console on the box, every passkey and session forgotten, a new link printed
  const gw2 = await gateway('reclaim');
  const a = authenticator();
  try {
    assert.equal((await gw2.claim(a)).status, 200);
    const r = spawnSync(process.execPath, [path.join(here, '..', 'cloud', 'gateway.mjs'), 'reclaim'], { env: { ...process.env, DEVTEAM_PUBLIC_URL: gw2.publicUrl, DEVTEAM_GATEWAY_DIR: gw2.dir }, encoding: 'utf8' });
    assert.ok(r.stdout.includes(`${gw2.auth}/auth/claim#`), r.stdout);
    assert.equal(r.status, 0, r.stderr);
    const token = /claim#([A-Za-z0-9_-]+)/.exec(r.stdout)?.[1];
    assert.ok(token, r.stdout);
    assert.equal((await gw2.req('GET', '/box.json')).status, 403, 'the running gateway sees it at once: unclaimed, the old session gone');
    const o = await gw2.req('POST', '/auth/claim/options', { body: { token } });
    assert.equal(o.status, 200, 'the new link claims it');
    // a restart keeps that link, even with a claim token in the environment
    process.env.DEVTEAM_CLAIM_TOKEN = 'x'.repeat(40);
    const logs = [];
    G.createGateway({ publicUrl: gw2.publicUrl, dir: gw2.dir, log: (m) => logs.push(m) });
    assert.match(logs.join(' '), /printed earlier/);
    assert.equal((await gw2.req('POST', '/auth/claim/options', { body: { token } })).status, 200);
    assert.equal((await gw2.req('POST', '/auth/claim/options', { body: { token: 'x'.repeat(40) } })).status, 403);
  } finally { delete process.env.DEVTEAM_CLAIM_TOKEN; await gw2.close(); }
  // state it can't read is never taken for a new box
  const broken = path.join(tmp, 'broken');
  fs.mkdirSync(broken);
  fs.writeFileSync(path.join(broken, 'state.json'), '{ not json');
  const gw3 = await gateway('broken2', { dir: broken });
  try {
    assert.match(gw3.logs.join(' '), /can't be read/);
    assert.equal(gw3.token, undefined, 'no claim link for a box whose state is unreadable');
    assert.equal((await gw3.req('GET', '/')).status, 503);
    assert.equal((await gw3.req('GET', '/auth/login')).status, 503);
    assert.equal(fs.readFileSync(path.join(broken, 'state.json'), 'utf8'), '{ not json', 'and the file is left alone');
  } finally { await gw3.close(); }
  // a claim link lasts a day
  const gw4 = await gateway('expiry');
  try {
    const f = path.join(gw4.dir, 'state.json');
    fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), claimExpires: Date.now() - 1 }));
    assert.match((await gw4.req('POST', '/auth/claim/options', { body: { token: gw4.token } })).json.error, /expired/);
    const logs = [];
    G.createGateway({ publicUrl: gw4.publicUrl, dir: gw4.dir, log: (m) => logs.push(m) });
    assert.match(logs.join(' '), /claim#[\w-]+ within a day/, 'a restart prints a new one');
  } finally { await gw4.close(); }
});

function bareProject(base, name) {
  const r = path.join(base, name);
  fs.mkdirSync(r);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: r });
  fs.cpSync(kit, path.join(r, 'docs', 'devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
  const i = spawnSync(process.execPath, [path.join(r, 'docs/devteam/scripts/devteam.mjs'), 'init', '--name', name], { cwd: r, encoding: 'utf8' });
  assert.equal(i.status, 0, i.stderr);
  return r;
}
async function until(f, what) {
  for (let i = 0; i < 300; i++) { const v = await f(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); }
  assert.fail(`timed out waiting for ${what}`);
}

test('behind the gateway the kit runs as on a laptop: hub, dashboard, owner actions, policies, the terminal', async () => {
  const gw = await gateway('proxy', { env: cleared() });
  const base = fs.mkdtempSync(path.join(tmp, 'repos-'));
  const A = bareProject(base, 'alpha');
  const env = { ...process.env };
  delete env.DEVTEAM_ROLE;
  // on P: with the echo below answering a hello, a dashboard left to choose would take the port after it
  const d = spawn(process.execPath, [path.join(A, 'docs/devteam/scripts/devteam.mjs'), 'dashboard', '--port', String(P)], { cwd: A, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  d.stdout.on('data', (b) => { out += b; });
  d.stderr.on('data', (b) => { out += b; });
  // a stand-in upstream on another block port that shows what the kit would receive
  const seen = [];
  const seenUrls = [];
  // It says hello as an instance named echo, so the hub lists it and echo.<box> reaches it; a hello is
  // the hub's probe, never what the test sent, so it isn't counted.
  const echo = http.createServer((req, res) => { if (req.url === '/api/hello') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ devteam: 1, name: 'echo', root: '/srv/echo', port: P + 5 })); } seen.push(req.headers); res.writeHead(200, { 'content-security-policy': `frame-ancestors http://127.0.0.1:${HUB}; img-src http://127.0.0.1:${P + 5}/api/file`, location: `http://127.0.0.1:${P + 5}/x`, 'clear-site-data': '"cookies"', 'set-cookie': ['devteam_session=x; Path=/auth', 'devteam_session =y', 'a=1; Domain=box.localhost', 'b=1; domain = box.localhost', 'theme=light'] }); seenUrls.push(req.url); res.end('ok'); }).listen(P + 5, '127.0.0.1');
  // a stand-in ttyd on the gateway's port: answers the upgrade, then echoes
  const upgrades = [];
  const ttyd = net.createServer((s) => {
    let buf = '';
    s.on('data', function first(c) {
      buf += c;
      if (!buf.includes('\r\n\r\n')) return;
      s.off('data', first);
      upgrades.push(buf.split('\r\n\r\n')[0]);
      s.write('HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n');
      s.on('data', (x) => s.write(x));
    });
  }).listen(gw.ttydPort, '127.0.0.1');
  try {
    const a = authenticator();
    assert.equal((await gw.claim(a)).status, 200);
    await until(() => out.includes(`127.0.0.1:${P}`), `the dashboard (${out})`);
    await until(async () => { const l = (await gw.req('GET', '/instances.json')).json?.instances ?? []; return l.find((x) => x.name === 'alpha')?.inbox !== undefined && l.some((x) => x.name === 'echo'); }, 'the hub, through the gateway');

    // the hub, on the box's name: it frames each project on its own host, and the terminal
    const hub = await gw.req('GET', '/');
    assert.equal(hub.status, 200);
    const hcsp = hub.headers['content-security-policy'];
    const list = (await gw.req('GET', '/instances.json', { headers: { 'sec-fetch-site': 'same-origin' } })).json.instances;
    assert.ok(hcsp.split('; ').includes(`frame-src ${gw.term} ${list.map((x) => gw.inst(x.name)).join(' ')}`), hcsp);
    assert.ok(hcsp.split('; ').includes("frame-ancestors 'none'"), hcsp);
    assert.equal(hub.body, fs.readFileSync(path.join(kit, 'dashboard', 'hub.html'), 'utf8'), 'the gateway\'s own copy of the page');
    assert.ok(!hcsp.includes('127.0.0.1'), hcsp);
    assert.deepEqual(list.map((x) => [x.name, x.port]).sort(), [['alpha', P], ['echo', P + 5]]);
    const boxJson = (await gw.req('GET', '/box.json')).json;
    assert.deepEqual(boxJson, { box: 2, terminal: `${gw.term}/`, project: `http://{project}.box.localhost:${gw.port}/`, passkeys: `${gw.auth}/auth/passkeys`, previews: `${gw.auth}/dev/`, push: boxJson.push, image: null, role: 'owner', level: 'full', people: `${gw.auth}/auth/people/list` }, 'the hub learns where projects are, who it is, its level, and where People are');
    assert.equal(Buffer.from(boxJson.push, 'base64url').length, 65, 'and the key that signs its notifications');

    // a dashboard on its own subdomain, exactly as the kit serves it, its policy pointed at the box
    const dash = await gw.req('GET', '/', { on: 'alpha' });
    assert.equal(dash.status, 200);
    assert.equal(dash.headers['content-security-policy'], `frame-src 'self'; frame-ancestors 'self' ${gw.publicUrl}`);
    assert.equal((await gw.req('GET', '/api/hello', { on: 'alpha' })).json.port, P);
    assert.equal((await gw.req('GET', '/api/file?path=README.md', { on: 'alpha' })).status === 403, false, 'a committed file is served by path, as a review page asks for it');
    // an owner action passes the kit's own same-origin check, as from the page
    const act = await gw.req('POST', '/api/fleet', { on: 'alpha', body: { op: 'drain', reason: 'through the gateway' }, headers: { 'sec-fetch-site': 'same-origin' } });
    assert.notEqual(act.status, 403, act.body);
    assert.ok(act.json?.ok || !/owner actions only/.test(act.json?.error ?? ''), act.body);
    // a sandboxed page's request (Origin: null) is refused, as the kit would
    assert.equal((await gw.req('POST', '/api/fleet', { on: 'alpha', body: { op: 'drain' }, headers: { origin: 'null' } })).status, 403);
    const rv = await gw.req('GET', '/review/preview/?path=README.md', { on: 'alpha', headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' } });
    assert.notEqual(rv.status, 403, rv.body);

    // what the kit receives: its own Host and origin, no session cookie, no proxy headers
    const r = await gw.req('POST', '/y?q=1', { on: 'echo', body: {}, headers: { cookie: `${gw.jar()}; theme=dark`, 'x-forwarded-for': '1.2.3.4', referer: `${gw.inst('echo')}/` } });
    assert.equal(r.status, 200);
    const h = seen.at(-1);
    assert.equal(h.host, `127.0.0.1:${P + 5}`);
    assert.equal(h.origin, `http://127.0.0.1:${P + 5}`);
    assert.equal(h.cookie, 'theme=dark');
    assert.equal(h['x-forwarded-for'], undefined);
    assert.equal(h.referer, undefined);
    assert.equal(r.headers['content-security-policy'], `frame-ancestors ${gw.publicUrl}; img-src ${gw.inst('echo')}/api/file`);
    assert.equal(r.headers.location, `${gw.inst('echo')}/x`);
    assert.deepEqual(r.headers['set-cookie'], ['theme=light'], 'nothing behind the gateway sets a cookie for the box\'s names');
    assert.equal(r.headers['clear-site-data'], undefined, 'or clears the owner\'s');
    // the owner's answer to what a supervisor's terminal asks is the one dashboard request the
    // gateway signs: for that instance's port and that body, whatever signature the browser sent
    const press = { digest: 'a'.repeat(40), option: 1, token: 't' };
    const pa = await gw.req('POST', '/api/pane-answer', { on: 'echo', body: press, headers: { 'x-devteam-gateway-sig': 'forged', 'x-devteam-gateway-nonce': 'forged' } });
    assert.equal(pa.status, 200);
    const ph = seen.at(-1);
    assert.match(ph['x-devteam-gateway-ts'], /^\d{13}$/);
    assert.notEqual(ph['x-devteam-gateway-sig'], 'forged');
    const signedBytes = (port) => Buffer.from(`devteam-pane-answer-v1\n${port}\n${ph['x-devteam-gateway-ts']}\n${ph['x-devteam-gateway-nonce']}\n${crypto.createHash('sha256').update(JSON.stringify(press)).digest('hex')}`);
    const pub = crypto.createPublicKey(gw.g.threadPublicKey());
    assert.equal(crypto.verify(null, signedBytes(P + 5), pub, Buffer.from(ph['x-devteam-gateway-sig'], 'base64url')), true, 'signed for this port and this body');
    assert.equal(crypto.verify(null, signedBytes(P), pub, Buffer.from(ph['x-devteam-gateway-sig'], 'base64url')), false, 'and for no other instance');
    assert.equal((await gw.req('POST', '/api/pane-answer', { on: 'echo', body: press, cookie: '' })).status, 401, 'never without the session');
    // the owner's Save on the Settings page is the other: signed under a name of its own, so a
    // signature made for one route is never good for the other (kit-85)
    const save = { key: 'max_active_tickets', value: 7 };
    const os_ = await gw.req('POST', '/api/owner-setting', { on: 'echo', body: save, headers: { 'x-devteam-gateway-sig': 'forged', 'x-devteam-gateway-nonce': 'forged', 'x-devteam-gateway-ts': '1' } });
    assert.equal(os_.status, 200);
    const oh = seen.at(-1);
    assert.match(oh['x-devteam-gateway-ts'], /^\d{13}$/);
    assert.notEqual(oh['x-devteam-gateway-sig'], 'forged');
    assert.notEqual(oh['x-devteam-gateway-nonce'], 'forged');
    const savedBytes = (domain, port, hd) => Buffer.from(`${domain}\n${port}\n${hd['x-devteam-gateway-ts']}\n${hd['x-devteam-gateway-nonce']}\n${crypto.createHash('sha256').update(JSON.stringify(domain === 'devteam-pane-answer-v1' && hd === ph ? press : save)).digest('hex')}`);
    const verifies = (bytes, hd) => crypto.verify(null, bytes, pub, Buffer.from(hd['x-devteam-gateway-sig'], 'base64url'));
    assert.equal(verifies(savedBytes('devteam-owner-setting-v1', P + 5, oh), oh), true, 'signed for this port and this body');
    assert.equal(verifies(savedBytes('devteam-owner-setting-v1', P, oh), oh), false, 'and for no other instance');
    assert.equal(verifies(savedBytes('devteam-pane-answer-v1', P + 5, oh), oh), false, 'an owner-setting signature is no pane-answer one');
    assert.equal(verifies(Buffer.from(`devteam-owner-setting-v1\n${P + 5}\n${ph['x-devteam-gateway-ts']}\n${ph['x-devteam-gateway-nonce']}\n${crypto.createHash('sha256').update(JSON.stringify(press)).digest('hex')}`), ph), false, 'nor the reverse');
    assert.equal((await gw.req('POST', '/api/owner-setting', { on: 'echo', body: save, cookie: '' })).status, 401, 'never without the session');
    assert.equal(seen.filter((x) => x !== ph && x !== oh).every((x) => x['x-devteam-gateway-sig'] === undefined), true, 'nothing else an instance gets is signed: only the pane answer and the owner\'s Save');

    // another site's page can't use the cookie for a read; a sandboxed review page's loads can
    const xs = (route, dest) => gw.req('GET', route, { on: 'alpha', headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': dest } });
    assert.equal((await xs('/api/fleet?fetch=1', 'image')).status, 403);
    assert.equal((await xs('/api/data', 'script')).status, 403);
    assert.equal((await xs('/api/file?path=README.md', 'script')).status, 403);
    assert.equal((await xs('/api/file?path=README.md', 'image')).status, 403, 'only an image file, as an image');
    assert.notEqual((await xs('/api/file?path=a/b.png', 'image')).status, 403);
    assert.equal((await gw.req('GET', '/api/data', { on: 'alpha', headers: { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' } })).status, 403, 'another name of the box is no different');
    assert.equal((await gw.req('GET', '/api/fleet?fetch=1', { on: 'alpha', headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' } })).status, 403, 'nor can a frame or a link reach the API');
    assert.equal((await xs('/artifact/main/x/a.js', 'script')).status, 403, 'an artifact\'s files, without its capability');
    // an artifact: its frame's first load goes under a capability, and its files need no cookie
    const af = await gw.req('GET', '/artifact/main/x/?v=1', { on: 'echo', headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' } });
    assert.equal(af.status, 302);
    const cap = /^(\/c\/[^/]+)\/artifact\/main\/x\/\?v=1$/.exec(af.headers.location)?.[1];
    assert.ok(cap, af.headers.location);
    const opaque = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' };
    const capped = await gw.req('GET', `${cap}/artifact/main/x/a.js?q=1`, { on: 'echo', cookie: '', headers: opaque });
    assert.equal(capped.status, 200, capped.body);
    assert.equal(seenUrls.at(-1), '/artifact/main/x/a.js?q=1', 'the kit sees the plain path');
    assert.equal(seen.at(-1).cookie, undefined);
    assert.equal((await gw.req('GET', `${cap}/artifact/main/other/a.js`, { on: 'echo', cookie: '', headers: opaque })).status, 403, 'that folder only');
    assert.equal((await gw.req('GET', `${cap}/artifact/main/x/../../../api/data`, { on: 'echo', cookie: '', headers: opaque })).status, 403, 'and no way out of it');
    assert.equal((await gw.req('GET', `${cap}/artifact/main/x/a.js`, { on: 'alpha', cookie: '', headers: opaque })).status, 403, 'on that instance only');
    assert.equal((await gw.req('POST', `${cap}/artifact/main/x/a.js`, { on: 'echo', cookie: '', body: {} })).status, 403, 'reads only');
    // a draft fetched from another machine (kit-750): its branch encoded into one segment, under a
    // capability of its own, so every file of a page with several loads in its sandboxed frame
    const ao = await gw.req('GET', '/artifact/origin/ticket%2Ffar-01/x/?v=1', { on: 'echo', headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' } });
    assert.equal(ao.status, 302, 'a remote draft\'s frame goes under a capability');
    const capO = /^(\/c\/[^/]+)\/artifact\/origin\/ticket%2Ffar-01\/x\/\?v=1$/.exec(ao.headers.location)?.[1];
    assert.ok(capO, ao.headers.location);
    for (const [f, dest] of [['style.css', 'style'], ['a.js', 'script'], ['img/p.png', 'image']]) {
      const r = await gw.req('GET', `${capO}/artifact/origin/ticket%2Ffar-01/x/${f}`, { on: 'echo', cookie: '', headers: { ...opaque, 'sec-fetch-dest': dest } });
      assert.equal(r.status, 200, `the remote draft's ${f}: ${r.body}`);
      assert.equal(seenUrls.at(-1), `/artifact/origin/ticket%2Ffar-01/x/${f}`, 'the kit sees the plain path');
    }
    for (const other of ['/artifact/origin/ticket%2Fother/x/a.js', '/artifact/main/x/a.js', '/artifact/origin/ticket%2Ffar-01/y/a.js', '/artifact/origin/ticket%2Ffar-01/x/../../main/x/a.js'])
      assert.equal((await gw.req('GET', `${capO}${other}`, { on: 'echo', cookie: '', headers: opaque })).status, 403, `that branch's folder only: ${other}`);
    assert.equal((await xs('/artifact/origin/ticket%2Ffar-01/x/a.js', 'script')).status, 403, 'a remote draft\'s files, without its capability');
    assert.notEqual((await xs('/review/preview/devteam-ui.js', 'script')).status, 403);
    assert.equal((await gw.req('GET', '/', { on: 'alpha', headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } })).status, 200, 'a link from anywhere still opens it');

    // the terminal, on its own name: the gateway's copy of the page, framed only by the hub
    const tp = await gw.req('GET', '/', { on: 'term' });
    assert.ok(tp.body.startsWith('the gateway\'s copy of ttyd'), tp.body.slice(0, 80));
    assert.match(tp.body, /registerOscHandler\(52,/, 'and copying in tmux reaches the browser\'s clipboard');
    assert.match(tp.body, /b64 !== '\?' && Date\.now\(\) - at < 3000/, 'write only, and only just after the owner clicked or typed');
    assert.ok(tp.headers['content-security-policy'].split('; ').includes(`frame-ancestors ${gw.publicUrl}`), tp.headers['content-security-policy']);
    assert.deepEqual((await gw.req('GET', '/token', { on: 'term' })).json, { token: '' });
    assert.equal((await gw.req('GET', '/term/')).status, 404, 'the box\'s name has no terminal');
    assert.equal((await gw.req('GET', '/ws', { on: 'term' })).status, 404);
    // its WebSocket: the session and the terminal's Origin, to ttyd with no cookie
    const ws = (headers, route = '/ws', host = `term.box.localhost:${gw.port}`) => new Promise((resolve) => {
      const s = net.connect(gw.port, '127.0.0.1', () => s.write(`GET ${route} HTTP/1.1\r\n${Object.entries({ host, upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-key': 'x', 'sec-websocket-version': '13', 'sec-websocket-protocol': 'tty', ...headers }).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`));
      let b = '';
      s.on('data', (c) => { b += c; if (b.includes('\r\n\r\n')) { if (b.startsWith('HTTP/1.1 101')) { s.write('ping'); s.once('data', (e) => { resolve([101, String(e)]); s.destroy(); }); } else { resolve([Number(b.split(' ')[1]), '']); s.destroy(); } } });
    });
    assert.deepEqual(await ws({ origin: gw.term, cookie: gw.jar() }), [101, 'ping']);
    assert.match(upgrades.at(-1), /^GET \/ws /);
    assert.match(upgrades.at(-1), /\r\nsec-websocket-protocol: tty(\r\n|$)/);
    assert.doesNotMatch(upgrades.at(-1), /cookie|origin/i);
    assert.equal((await ws({ origin: gw.publicUrl, cookie: gw.jar() }))[0], 403, 'a page on the box\'s own name can\'t open it');
    assert.equal((await ws({ origin: 'https://evil.example', cookie: gw.jar() }))[0], 403, 'nor another site, even with the cookie');
    assert.equal((await ws({ origin: gw.inst('alpha'), cookie: gw.jar() }))[0], 403, 'nor a dashboard\'s page');
    assert.equal((await ws({ origin: gw.term }))[0], 401, 'nor anyone without a session');
    assert.equal((await ws({ origin: gw.term, cookie: gw.jar() }, '/x'))[0], 404, 'and it is the only upgrade');
    assert.equal((await ws({ origin: gw.publicUrl, cookie: gw.jar() }, '/ws', `box.localhost:${gw.port}`))[0], 421, 'on the terminal\'s name only');
    // a jar stuffed with cookies clears itself rather than locking the owner out of every name
    const flooded = await new Promise((resolve) => { const c = net.connect(gw.port, '127.0.0.1', () => c.write(`GET / HTTP/1.1\r\nhost: box.localhost:${gw.port}\r\ncookie: x=${'a'.repeat(70000)}\r\n\r\n`)); let b = ''; c.on('data', (d) => { b += d; }); c.on('close', () => resolve(b)); });
    assert.match(flooded, /^HTTP\/1\.1 431/);
    assert.match(flooded, /clear-site-data: "cookies"/);
    // signing out ends that session's artifact capabilities
    assert.equal((await gw.req('POST', '/auth/logout', { body: {} })).status, 200);
    assert.equal((await gw.req('GET', `${cap}/artifact/main/x/a.js`, { on: 'echo', cookie: '', headers: opaque })).status, 403, 'a capability ends with its session');
  } finally {
    await new Promise((r) => { d.on('close', r); d.kill(); });
    echo.close();
    ttyd.close();
    await gw.close();
  }
});

test('whatever an agent binds to the hub\'s port, the box\'s name serves only the gateway\'s page, and only JSON from there', async () => {
  const gw = await gateway('squat');
  let huge = false;
  const evil = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'a=1', 'content-security-policy': "frame-ancestors *" }); res.end(huge ? 'x'.repeat(2 * 1024 * 1024) : req.url === '/instances.json' ? '{"hub":1,"instances":[{"name":"x"}]}' : '<script>evil()</script>'); });
  await until(() => new Promise((r) => { evil.once('error', () => r(false)); evil.listen(HUB, '127.0.0.1', () => r(true)); }), 'the hub port');
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    const page = await gw.req('GET', '/');
    assert.doesNotMatch(page.body, /evil\(\)/);
    assert.equal(page.headers['set-cookie']?.length ?? 0, 0);
    const list = await gw.req('GET', '/instances.json');
    assert.equal(list.headers['content-type'], 'application/json');
    assert.equal(list.headers['x-content-type-options'], 'nosniff');
    assert.equal(list.headers['content-security-policy'], undefined);
    assert.equal(list.body, '{"hub":1,"instances":[{"name":"x"}]}');
    huge = true;
    assert.equal((await gw.req('GET', '/instances.json')).body, '{"hub":1,"instances":[],"down":true}', 'and no more of it than a list could be');
    assert.equal((await gw.req('GET', '/anything')).status, 404);
  } finally { evil.close(); await gw.close(); }
  const gw2 = await gateway('nohub');
  try {
    assert.equal((await gw2.claim(authenticator())).status, 200);
    await until(async () => (await gw2.req('GET', '/instances.json')).body === '{"hub":1,"instances":[],"down":true}', 'an empty list when nothing holds the port');
    assert.equal((await gw2.req('GET', '/')).status, 200, 'and the page, with its Terminal tab, on first boot');
  } finally { await gw2.close(); }
});

test('what an agent serves on an instance\'s name doesn\'t outlive its server: no service worker, nothing cached', async () => {
  const gw = await gateway('nokeep');
  const seen = [];
  const evil = http.createServer((req, res) => { seen.push(req.url); res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'max-age=31536000, immutable' }); res.end('//'); });
  await new Promise((r) => evil.listen(P, '127.0.0.1', r));
  const hub = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ hub: 1, instances: [{ devteam: 1, name: 'alpha', root: '/srv/alpha', port: P }] })); });
  await new Promise((r) => hub.listen(HUB, '127.0.0.1', r));
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    const page = await gw.req('GET', '/page.js', { on: 'alpha' });
    assert.equal(page.status, 200);
    assert.equal(page.headers['cache-control'], 'no-store', 'its own cache-control is replaced');
    assert.equal((await gw.req('GET', '/sw.js', { on: 'alpha', headers: { 'service-worker': 'script' } })).status, 403);
    assert.equal((await gw.req('GET', '/sw.js', { on: 'alpha', headers: { 'sec-fetch-dest': 'serviceworker' } })).status, 403);
    assert.deepEqual(seen, ['/page.js'], 'and the registration never reaches it');
  } finally { evil.close(); hub.closeAllConnections(); hub.close(); await gw.close(); }
});

test('the hub on a laptop is unchanged: no box.json, instances on their own loopback ports', () => {
  const hub = fs.readFileSync(path.join(kit, 'dashboard', 'hub.html'), 'utf8');
  assert.match(hub, /const urlOf = Object\.assign\(\(x\) => \(!box \? `http:\/\/127\.0\.0\.1:\$\{Number\(x\.port\)\}\/` : box\.v === 1 \? box\.instance\.replace\('\{port\}', String\(Number\(x\.port\)\)\) : /);
});

test('on https: the cookie is Secure and SameSite=None for every name, and HSTS is sent', async () => {
  // the gateway trusts its public URL's scheme (the platform terminates TLS), so plain http here
  const port = await freePort();
  const dir = path.join(tmp, 'https');
  const logs = [];
  const g = G.createGateway({ publicUrl: 'https://box.localhost', dir, ttydPort: await freePort(), log: (m) => logs.push(m) });
  await new Promise((r) => g.server.listen(port, '127.0.0.1', r));
  const token = /claim#([\w-]+)/.exec(logs.join(' '))[1];
  let flowJar = '';
  const call = (host, method, route, body, headers = {}) => new Promise((resolve, reject) => {
    const sent = [headers.cookie, flowJar].filter(Boolean).join('; ');
    const r = http.request({ host: '127.0.0.1', port, method, path: route, headers: { host, ...(method === 'POST' ? { origin: `https://${host}`, 'content-type': 'application/json' } : {}), ...headers, ...(sent ? { cookie: sent } : {}) } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { for (const c of res.headers['set-cookie'] ?? []) if (/^(?:__Host-)?devteam_flow=/.test(c)) flowJar = /;\s*Max-Age=0\b/i.test(c) ? '' : c.split(';')[0]; resolve({ status: res.statusCode, headers: res.headers, json: (() => { try { return JSON.parse(b); } catch { return null; } })() }); }); });
    r.on('error', reject);
    r.end(body ? JSON.stringify(body) : undefined);
  });
  try {
    const a = authenticator();
    const o = await call('box.localhost', 'POST', '/auth/claim/options', { token });
    const ok = await call('box.localhost', 'POST', '/auth/claim/verify', { token, ...a.create(o.json, 'https://box.localhost') });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.match(ok.headers['set-cookie'][0], /^devteam_session=[\w-]+; Domain=box\.localhost; Path=\/; HttpOnly; Max-Age=1209600; Secure; SameSite=None$/);
    assert.equal(ok.headers['strict-transport-security'], 'max-age=31536000');
    const cookie = ok.headers['set-cookie'][0].split(';')[0];
    assert.equal((await call('box.localhost', 'GET', '/box.json', null, { cookie })).json.terminal, 'https://term.box.localhost/');
  } finally { await new Promise((r) => g.server.close(r)); }
});

// --- notifications -------------------------------------------------------------------------------
function browserKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, keys: { p256dh: u(ecdh.getPublicKey()), auth: u(auth) } };
}
// What a browser does with a push (RFC 8291), written apart from the gateway's half.
function openPush(body, { ecdh, auth }) {
  const b = Buffer.from(body);
  const idlen = b[20];
  const salt = b.subarray(0, 16);
  const as = b.subarray(21, 21 + idlen);
  const hk = (i, sl, info, n) => Buffer.from(crypto.hkdfSync('sha256', i, sl, info, n));
  const ikm = hk(ecdh.computeSecret(as), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), as]), 32);
  const text = b.subarray(21 + idlen);
  const d = crypto.createDecipheriv('aes-128-gcm', hk(ikm, salt, 'Content-Encoding: aes128gcm\0', 16), hk(ikm, salt, 'Content-Encoding: nonce\0', 12));
  d.setAuthTag(text.subarray(-16));
  const plain = Buffer.concat([d.update(text.subarray(0, -16)), d.final()]);
  assert.equal(plain.at(-1), 2, 'the last record says so');
  return JSON.parse(plain.subarray(0, -1).toString('utf8'));
}

test('a push is encrypted as RFC 8291 says, and signed so a push service believes it', () => {
  // RFC 8291, appendix A
  const sender = crypto.createECDH('prime256v1');
  sender.setPrivateKey(Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url'));
  const out = G.encryptPush({ p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' }, Buffer.from('When I grow up, I want to be a watermelon'), sender, Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'));
  assert.equal(u(out), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const now = 1_800_000_000_000;
  const [head, claims, sig] = G.vapidToken(privateKey.export({ format: 'jwk' }), 'https://web.push.apple.com', 'https://box.example.com', now).split('.');
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  const c = JSON.parse(Buffer.from(claims, 'base64url'));
  assert.deepEqual([c.aud, c.sub], ['https://web.push.apple.com', 'https://box.example.com']);
  assert.ok(c.exp > now / 1000 && c.exp <= now / 1000 + 3600, 'under an hour, as Apple requires');
  assert.ok(crypto.verify('sha256', Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
});

test("the box's own alert is one push named for the box, and left out of each project's", () => {
  const ports = [P, P + 1];
  const r = (root, name, port, extra = {}) => ({ root, name, port, ...extra });
  const box = G.alertNews({}, [r('/a', 'a', P, { box_alert: 'memory at the limit' }), r('/b', 'b', P + 1, { box_alert: 'memory at the limit' })], ports);
  assert.equal(box.messages.length, 1, 'one push for the box, not one per project');
  assert.equal(box.messages[0].title, 'Box alert');
  assert.equal(box.messages[0].body, 'memory at the limit');
  assert.deepEqual(G.alertNews(box.seen, [r('/a', 'a', P, { box_alert: 'memory at the limit' })], ports).messages, [], 'not news twice');
  // an older kit folds the box's alert into its own: only the project's part is its own news
  const mixed = G.alertNews({}, [r('/a', 'a', P, { box_alert: 'memory at the limit' }), r('/b', 'b', P + 1, { alert: 'at a usage limit · memory at the limit' })], ports);
  assert.deepEqual(mixed.messages.map((m) => [m.title, m.body]).sort(), [['Alert (b)', 'at a usage limit'], ['Box alert', 'memory at the limit']]);
  const onlyBox = G.alertNews({}, [r('/a', 'a', P, { box_alert: 'memory at the limit' }), r('/b', 'b', P + 1, { alert: 'memory at the limit' })], ports);
  assert.deepEqual(onlyBox.messages.map((m) => m.title), ['Box alert'], "an older kit's copy of the box's alert is not a project's own");
  // this kit folds it in too, for older readers: still one push, and a box alert holding " · " comes off whole
  const folded = G.alertNews({}, [r('/a', 'a', P, { box_alert: 'disk · full', alert: 'disk · full' }), r('/b', 'b', P + 1, { box_alert: 'disk · full', alert: 'at a usage limit · disk · full' })], ports);
  assert.deepEqual(folded.messages.map((m) => [m.title, m.body]).sort(), [['Alert (b)', 'at a usage limit'], ['Box alert', 'disk · full']]);
  const olderKit = G.alertNews({}, [r('/a', 'a', P, { box_alert: 'disk · full' }), r('/b', 'b', P + 1, { alert: 'at a usage limit · disk · full' })], ports);
  assert.deepEqual(olderKit.messages.map((m) => [m.title, m.body]).sort(), [['Alert (b)', 'at a usage limit'], ['Box alert', 'disk · full']], 'an older kit without box_alert: matched against the box text another project carries');
  const notSuffix = G.alertNews({}, [r('/a', 'a', P, { box_alert: 'disk', alert: 'disk is fine · own' })], ports);
  assert.deepEqual(notSuffix.messages.map((m) => m.body).sort(), ['disk', 'disk is fine · own'], 'only a trailing copy comes off');
});

test("a box alert that clears or changes is not pushed again from an older kit's lagging copy", () => {
  const ports = [P, P + 1];
  const r = (root, name, port, extra = {}) => ({ root, name, port, ...extra });
  const X = 'Every Claude account is at its usage limit.';
  const pushed = (s) => s.messages.map((m) => [m.title, m.body]);
  // steady: a (this kit) carries box_alert and folds it; b (an older kit) folds it only
  const up = G.alertNews({}, [r('/a', 'a', P, { alert: X, box_alert: X }), r('/b', 'b', P + 1, { alert: X })], ports);
  assert.deepEqual(pushed(up), [['Box alert', X]]);
  // cleared: a drops it a refresh before b does; b's copy is the box text the gateway last knew
  const lag = G.alertNews(up.seen, [r('/a', 'a', P), r('/b', 'b', P + 1, { alert: X })], ports);
  assert.deepEqual(pushed(lag), [], 'the alert just cleared is not pushed as b\'s own');
  const lag2 = G.alertNews(lag.seen, [r('/a', 'a', P), r('/b', 'b', P + 1, { alert: X })], ports);
  assert.deepEqual(pushed(lag2), [], 'nor on the next poll, while b still lags');
  const gone = G.alertNews(lag2.seen, [r('/a', 'a', P), r('/b', 'b', P + 1)], ports);
  assert.deepEqual([pushed(gone), gone.seen], [[], {}], 'once b drops it too, it is forgotten');
  assert.deepEqual(pushed(G.alertNews(gone.seen, [r('/a', 'a', P, { alert: X, box_alert: X }), r('/b', 'b', P + 1, { alert: X })], ports)), [['Box alert', X]], 'and raised again, it is news again');
  // changed: a carries the new text, b still folds the old one
  const moved = G.alertNews(up.seen, [r('/a', 'a', P, { alert: 'disk full', box_alert: 'disk full' }), r('/b', 'b', P + 1, { alert: X })], ports);
  assert.deepEqual(pushed(moved), [['Box alert', 'disk full']]);
  assert.deepEqual(pushed(G.alertNews(moved.seen, [r('/a', 'a', P, { alert: 'disk full', box_alert: 'disk full' }), r('/b', 'b', P + 1, { alert: X })], ports)), [], 'the old text still lagging on b');
  // b's own part stays its own while the box's lags on it
  const own = G.alertNews({}, [r('/a', 'a', P, { alert: X, box_alert: X }), r('/b', 'b', P + 1, { alert: `at a usage limit · ${X}` })], ports);
  const ownLag = G.alertNews(own.seen, [r('/a', 'a', P), r('/b', 'b', P + 1, { alert: `at a usage limit · ${X}` })], ports);
  assert.deepEqual([pushed(ownLag), ownLag.seen['/b']], [[], 'at a usage limit']);
});

test('a gateway upgraded while a box alert is up does not push it again', () => {
  const ports = [P, P + 1];
  const r = (root, name, port, extra = {}) => ({ root, name, port, ...extra });
  // what a gateway from before box_alert stored: each project's whole alert, the box's folded in
  const before = { '/a': 'disk full', '/b': 'at a usage limit · disk full' };
  const after = G.alertNews(before, [r('/a', 'a', P, { alert: 'disk full', box_alert: 'disk full' }), r('/b', 'b', P + 1, { alert: 'at a usage limit · disk full' })], ports);
  assert.deepEqual(after.messages, [], 'the box alert and b\'s own were both pushed already');
  assert.deepEqual(after.seen, { '\u0000box': 'disk full', '/b': 'at a usage limit' });
  assert.deepEqual(G.alertNews({ '/a': 'something else' }, [r('/a', 'a', P, { alert: 'disk full', box_alert: 'disk full' })], ports).messages.map((m) => m.title), ['Box alert'], 'a box alert not seen before is still news');
});

test('an alert on the hub is pushed once, when it turns up or changes', () => {
  const ports = [P, P + 1];
  const r = (root, name, port, alert) => ({ root, name, port, ...(alert === undefined ? {} : { alert }) });
  assert.deepEqual(G.alertNews({}, [r('/a', 'a', P)], ports).messages, [], 'no alert, no news');
  const one = G.alertNews({}, [r('/a', 'a', P, 'disk is full')], ports);
  assert.equal(one.messages.length, 1);
  assert.equal(one.messages[0].title, 'Alert (a)');
  assert.equal(one.messages[0].body, 'disk is full');
  assert.deepEqual(one.seen, { '/a': 'disk is full' });
  assert.deepEqual(G.alertNews(one.seen, [r('/a', 'a', P, 'disk is full')], ports).messages, [], 'the same alert is not news twice');
  assert.equal(G.alertNews(one.seen, [r('/a', 'a', P)], ports).seen['/a'], undefined, 'gone, it is forgotten and can come back');
  assert.equal(G.alertNews({}, [r('/a', 'a', P, 'x')], [P + 5]).messages.length, 0, 'a port outside the block is ignored');
  // one box-wide alert across every repo's tab is one push, however many tabs carry it
  const both = G.alertNews({}, [r('/a', 'a', P, 'same'), r('/b', 'b', P + 1, 'same')], ports);
  assert.equal(both.messages.length, 1);
  assert.equal(both.messages[0].title, 'Alert (a, b)');
  assert.deepEqual(both.keys, ['alert:same'], 'resting is by text');
  assert.equal(G.alertNews({}, [r('/a', 'a', P, 'same')], ports, new Set(['alert:same'])).messages.length, 0, 'at rest it waits');
  const long = G.alertNews({}, [r('/a', 'a', P, 'x'.repeat(500))], ports);
  assert.equal(long.messages[0].body.length, 200);
  assert.equal(G.alertNews({}, [r('/a', 'a', P, 42)], ports).messages.length, 0, 'whatever holds the hub\'s port wrote the list: only a string counts');
  const many = G.alertNews({}, [r('/1', 'a', P, 'one'), r('/2', 'b', P + 1, 'two')], ports);
  assert.equal(many.messages.length, 2, 'distinct alerts each get a push');
});

test('what counts as news is what the hub page notifies about', () => {
  const ports = [P, P + 1];
  const at = (inbox, extra = {}) => ({ root: '/r/a', name: 'a', port: P, inbox, ...extra });
  assert.deepEqual(G.inboxNews({ '/r/a': 2 }, [at(2)], ports).messages, [], 'the same count is nothing');
  assert.deepEqual(G.inboxNews({ '/r/a': 2 }, [at(1)], ports).messages, [], 'nor one that fell');
  assert.deepEqual(G.inboxNews({ '/r/a': 2 }, [at(1)], ports).seen, { '/r/a': 1 }, 'but it is remembered');
  assert.deepEqual(G.inboxNews({ '/r/a': 2 }, [at(5)], ports).messages, [{ title: 'a: 3 new in the Inbox', body: '/r/a', tag: 'devteam-/r/a', url: '/#a' }]);
  assert.equal(G.inboxNews({}, [at(1)], ports).messages[0].title, 'a: 1 new in the Inbox', 'an instance that turns up with items counts them as new');
  assert.deepEqual(G.inboxNews({ '/r/a': 2 }, [at(null)], ports), { seen: { '/r/a': 2 }, messages: [], roots: [] }, 'one still starting says nothing');
  assert.deepEqual(G.inboxNews({}, [at(9, { port: 80 })], ports).messages, [], 'a port outside the block is no instance');
  assert.deepEqual(G.inboxNews({ constructor: 1 }, [at(1, { root: 'constructor' })], ports).messages, [], 'a root named like a property is still only a root');
  assert.deepEqual(G.inboxNews({ '/r/a': 2 }, [at(5)], ports, new Set(['/r/a'])), { seen: { '/r/a': 2 }, messages: [], roots: [] }, 'a root that just notified rests, and its count waits');
  const four = G.inboxNews({}, [0, 1, 2, 3].map((i) => ({ root: `/r/${i}`, name: `n${i}`, port: P + i, inbox: 1 })), [P, P + 1, P + 2, P + 3]);
  assert.deepEqual(four.messages, [{ title: '4 instances have new Inbox items', body: 'n0, n1, n2, n3', tag: 'devteam-inbox', url: '/' }], 'a burst is one notification');
  assert.equal(G.inboxNews({}, [at(1, { name: undefined })], ports).messages[0].url, '/#undefined', 'the tab the hub page calls it');
  const twins = G.inboxNews({}, [at(1), at(1, { root: '/r/b', port: P + 1 })], ports).messages;
  const hex = crypto.createHash('sha1').update('/r/b').digest('hex').slice(0, 6);
  assert.equal(twins[1].url, `/#a-${hex}`, 'two of one name are told apart as the hub tells them');
  const many = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`/old/${i}`, 1]));
  assert.equal(Object.keys(G.inboxNews(many, [at(1)], ports).seen).length, 200, 'and the record stays small, whatever claims to be an instance');
});

test('a subscription must name a browser\'s push service and real keys', () => {
  const { keys } = browserKeys();
  assert.ok(G.pushSubscription({ endpoint: 'https://web.push.apple.com/abc', keys }));
  assert.ok(G.pushSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys }));
  assert.equal(G.pushSubscription({ endpoint: 'https://accounts.google.com/x', keys }), null, 'only the push services themselves');
  for (const endpoint of ['http://web.push.apple.com/a', 'https://127.0.0.1/a', 'https://web.push.apple.com:444/a', 'https://evil.example/a', 'https://push.apple.com.evil.example/a', 'nope']) assert.equal(G.pushSubscription({ endpoint, keys }), null, endpoint);
  assert.equal(G.pushSubscription({ endpoint: 'https://web.push.apple.com/a', keys: { ...keys, auth: 'AAAA' } }), null);
  assert.equal(G.pushSubscription({ endpoint: 'https://web.push.apple.com/a', keys: { ...keys, p256dh: u(Buffer.alloc(65, 4)) } }), null, 'a point off the curve');
  assert.equal(G.pushSubscription(null), null);
});

test('installing the hub needs no sign-in, and the page may use what it installs', async () => {
  const gw = await gateway('install');
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    const out = { cookie: '' };
    const m = await gw.req('GET', '/manifest.webmanifest', out);
    assert.equal(m.status, 200);
    assert.deepEqual([m.json.display, m.json.scope, m.json.start_url], ['standalone', '/', '/']);
    const sw = await gw.req('GET', '/sw.js', out);
    assert.match(sw.headers['content-type'], /javascript/);
    assert.match(sw.body, /showNotification/);
    assert.doesNotMatch(sw.body, /'fetch'/, 'the worker stands between no page and the box');
    assert.doesNotThrow(() => new Function(sw.body));
    for (const icon of m.json.icons) {
      const r = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: gw.port, path: icon.src, headers: { host: `box.localhost:${gw.port}` } }, (res) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve({ res, b: Buffer.concat(c) })); }));
      assert.equal(r.res.statusCode, 200);
      assert.equal(r.b.subarray(1, 4).toString(), 'PNG');
      assert.equal(r.b.readUInt32BE(16), Number(icon.sizes.split('x')[0]));
    }
    const hub = await gw.req('GET', '/');
    for (const d of ["worker-src 'self'", "manifest-src 'self'"]) assert.ok(hub.headers['content-security-policy'].split('; ').includes(d));
    assert.match(hub.body, /<link rel="manifest" href="manifest\.webmanifest">/);
    assert.doesNotMatch((await gw.req('GET', '/sw.js', { on: 'alpha' })).body, /showNotification/, 'only the box\'s name serves it');
    assert.equal((await gw.req('GET', '/sw.js', { on: 'alpha', headers: { 'sec-fetch-dest': 'serviceworker' } })).status, 403, 'and an instance still has no worker');
  } finally { await gw.close(); }
});

// The Overview's threads with the operator: the hub keeps them, so the box's name passes a read and
// the owner's few presses to it, behind the passkey and the Origin rule, as the hub's own page would
// send them on the machine. Whatever holds the port answers as data.
test('the owner\'s threads with the operator reach the hub through the box\'s name, and only the owner\'s', async () => {
  const gw = await gateway('operator-threads');
  const seen = [];
  let answer = (req) => (req.method === 'GET' ? [200, { operator: { state: 'ready' }, threads: [{ id: 'ot-1', title: '<b>x</b>' }] }] : [200, { ok: true, out: 'ot-1\nsent to the operator\'s pane' }]);
  const hub = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      const [code, body] = answer(req);
      res.writeHead(code, { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json', 'set-cookie': 'a=1' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
  });
  await until(() => new Promise((r) => { hub.once('error', () => r(false)); hub.listen(HUB, '127.0.0.1', () => r(true)); }), 'the hub port');
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    assert.equal((await gw.req('GET', '/operator/threads', { cookie: '' })).status, 401, 'a read is the owner\'s');
    const read = await gw.req('GET', '/operator/threads');
    assert.equal(read.status, 200);
    assert.equal(read.json.threads[0].title, '<b>x</b>', 'as data: the page shows it as text');
    assert.equal(read.headers['set-cookie'], undefined, 'nothing of the answer but its JSON');
    assert.deepEqual([seen.at(-1).method, seen.at(-1).url, seen.at(-1).headers.host, seen.at(-1).headers['sec-fetch-site']], ['GET', '/operator/threads', `127.0.0.1:${HUB}`, 'same-origin']);
    assert.equal(seen.at(-1).headers.cookie, undefined, 'the owner\'s session never goes behind the gateway');

    const say = { body: { id: 'ot-20261114-101500123-abcdef', text: 'hello; there' } };
    const n = seen.length;
    assert.equal((await gw.req('POST', '/operator/thread-say', { ...say, cookie: '' })).status, 401);
    assert.equal((await gw.req('POST', '/operator/thread-say', { ...say, headers: { origin: gw.inst(P) } })).status, 403, 'not from a dashboard\'s page');
    assert.equal((await gw.req('POST', '/operator/thread-say', { ...say, headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal(seen.length, n, 'none of those reached the hub');
    const ok = await gw.req('POST', '/operator/thread-say', say);
    assert.deepEqual([ok.status, ok.json], [200, { ok: true, out: 'ot-1\nsent to the operator\'s pane' }]);
    const sent = seen.at(-1);
    assert.deepEqual([sent.method, sent.url, sent.headers.origin, sent.headers['sec-fetch-site'], sent.headers['content-type']], ['POST', '/operator/thread-say', `http://127.0.0.1:${HUB}`, 'same-origin', 'application/json'], 'as the hub\'s own page would send it');
    assert.deepEqual(JSON.parse(sent.body), say.body);
    // signed, with the key kept with the passkeys: every agent is the hub's user and can send the
    // page's headers, so on a box the hub takes a press only with this
    const pub = crypto.createPublicKey(gw.g.threadPublicKey());
    const signedAs = (x) => Buffer.from(`devteam-operator-post-v1\n${x.url}\n${x.headers['x-devteam-gateway-ts']}\n${x.headers['x-devteam-gateway-nonce']}\n${crypto.createHash('sha256').update(x.body).digest('hex')}`);
    assert.ok(crypto.verify(null, signedAs(sent), pub, Buffer.from(sent.headers['x-devteam-gateway-sig'], 'base64url')), 'the hub can check it with the public half');
    assert.ok(Math.abs(Date.now() - Number(sent.headers['x-devteam-gateway-ts'])) < 60000);
    assert.equal(fs.readFileSync(path.join(gw.dir, 'state.json'), 'utf8').includes('PRIVATE KEY'), true, 'the private half stays in the gateway\'s own folder');
    assert.equal(seen.filter((x) => x.method === 'GET').every((x) => x.headers['x-devteam-gateway-sig'] === undefined), true, 'a read is not signed');
    // and the kit's own check, as a box's hub hands it to the owner's command, takes what the gateway signed
    const box = fs.mkdtempSync(path.join(tmp, 'kit-box-'));
    fs.writeFileSync(path.join(box, 'thread-key.pub'), gw.g.threadPublicKey());
    const newer = await gw.req('POST', '/operator/thread-new', { body: { text: 'hello from the gateway' } });
    assert.equal(newer.status, 200);
    const x = seen.at(-1);
    const proof = { path: x.url, ts: x.headers['x-devteam-gateway-ts'], nonce: x.headers['x-devteam-gateway-nonce'], sig: x.headers['x-devteam-gateway-sig'], body: Buffer.from(x.body).toString('base64') };
    const kitEnv = { ...process.env, HOME: box, DEVTEAM_PUBLIC_URL: 'https://box.example.com', DEVTEAM_GATEWAY_THREAD_KEY: path.join(box, 'thread-key.pub'), DEVTEAM_OPERATOR_COMMAND: '', DEVTEAM_THREAD_PROOF: 'stdin' };
    const kitRun = (input) => spawnSync(process.execPath, [path.join(kit, 'scripts', 'devteam.mjs'), 'operator-thread', 'new', '--', 'hello from the gateway'], { cwd: box, encoding: 'utf8', env: kitEnv, input });
    const took = kitRun(JSON.stringify(proof));
    assert.equal(took.status, 0, took.stderr);
    assert.match(took.stdout, /^ot-/);
    assert.equal(kitRun('').status, 1, 'without it, refused');
    for (const a of ['thread-new', 'thread-close', 'thread-reopen', 'start']) assert.equal((await gw.req('POST', `/operator/${a}`, { body: {} })).status, 200, a);
    assert.equal((await gw.req('POST', '/operator/thread-say', { body: [1] })).status, 400, 'a body is an object');
    assert.equal((await gw.req('POST', '/operator/instances.json', { body: {} })).status, 404, 'only the thread actions');
    assert.equal((await gw.req('POST', '/operator/../instances.json', { body: {} })).status, 404);

    // a refusal with its reason comes back as it is; anything else on the port is a 502, never its bytes
    answer = () => [400, { error: 'ot-1 is closed; reopen it first' }];
    const no = await gw.req('POST', '/operator/thread-say', say);
    assert.deepEqual([no.status, no.json.error], [400, 'ot-1 is closed; reopen it first']);
    answer = () => [404, 'not found'];
    const old = await gw.req('GET', '/operator/threads');
    assert.equal(old.status, 502);
    assert.match(old.json.error, /a kit from before threads with the operator/);
    answer = () => [200, '<script>alert(1)</script>'];
    assert.equal((await gw.req('GET', '/operator/threads')).status, 502);
    await new Promise((r) => hub.close(r));
    assert.match((await gw.req('GET', '/operator/threads')).json.error, /not answering/);
  } finally { hub.close(); await gw.close(); }
});

// The same, with nothing standing in for the hub: a box's real hub behind the gateway. What the hub
// refuses comes back as its own refusal, with its reason, never as "an older kit".
test('the gateway to a real hub on a box: a signed press is kept as the owner\'s, and the hub\'s own refusals come back as they are', { timeout: 240000 }, async () => {
  const gw = await gateway('operator-real');
  const base = fs.mkdtempSync(path.join(tmp, 'real-hub-'));
  const A = bareProject(base, 'alpha');
  const home = path.join(base, 'home');
  const noTmux = path.join(base, 'tmux');
  fs.mkdirSync(home);
  fs.mkdirSync(noTmux);
  const keyFile = path.join(base, 'thread-key.pub');
  fs.writeFileSync(keyFile, gw.g.threadPublicKey());
  // a box as its hub sees one: the public URL, the gateway's public key, and a tmux with no server
  // (so nothing on this machine is ever typed into)
  const env = { ...process.env, HOME: home, TMUX_TMPDIR: noTmux, DEVTEAM_PUBLIC_URL: 'https://box.example.com', DEVTEAM_GATEWAY_THREAD_KEY: keyFile };
  const d = spawn(process.execPath, [path.join(A, 'docs/devteam/scripts/devteam.mjs'), 'dashboard'], { cwd: A, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  d.stdout.on('data', (b) => { out += b; });
  d.stderr.on('data', (b) => { out += b; });
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    await until(() => out.includes(`127.0.0.1:${P}`), `the dashboard (${out})`);
    await until(async () => (await gw.req('GET', '/operator/threads')).status === 200, 'the hub\'s threads, through the gateway');
    const empty = await gw.req('GET', '/operator/threads');
    assert.deepEqual([empty.json.threads, empty.json.operator.box, empty.json.operator.can_start], [[], true, false]);

    // the owner's press, signed by the gateway and checked by the hub and by the owner's command
    const made = await gw.req('POST', '/operator/thread-new', { body: { title: 'the box', text: 'is anyone there?' } });
    assert.equal(made.status, 200, made.body);
    const id = made.json.out.split('\n')[0];
    assert.match(id, /^ot-/);
    const [t] = (await gw.req('GET', '/operator/threads')).json.threads;
    assert.deepEqual([t.id, t.title, t.signed, t.turns.map((u) => [u.by, u.text, u.signed])], [id, 'the box', true, [['owner', 'is anyone there?', true]]]);

    // what the press asked for and can't have: the hub's 400, with its reason
    const closed = await gw.req('POST', '/operator/thread-say', { body: { id: 'ot-20260101-000000000-abcdef', text: 'x' } });
    assert.equal(closed.status, 400);
    assert.match(closed.json.error, /no operator thread ot-20260101-000000000-abcdef/);
    // a press the hub won't take (the key the box holds is not this gateway's): its 403 and why,
    // not a 502 that blames the kit
    fs.writeFileSync(keyFile, crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }));
    const refused = await gw.req('POST', '/operator/thread-say', { body: { id, text: 'still there?' } });
    assert.equal(refused.status, 403, refused.body);
    assert.match(refused.json.error, /only through the box's gateway \(its signature is not the gateway's\)/);
    assert.deepEqual(Object.keys(refused.json), ['error'], 'the reason and nothing else of the hub\'s answer');
    fs.rmSync(keyFile);
    const off = await gw.req('POST', '/operator/thread-say', { body: { id, text: 'still there?' } });
    assert.equal(off.status, 403);
    assert.match(off.json.error, /no gateway key/);
    // and with the key back, the same thread takes the next turn
    fs.writeFileSync(keyFile, gw.g.threadPublicKey());
    assert.equal((await gw.req('POST', '/operator/thread-say', { body: { id, text: 'still there?' } })).status, 200);
    const [again] = (await gw.req('GET', '/operator/threads')).json.threads;
    assert.deepEqual(again.turns.map((u) => [u.text, u.signed]), [['is anyone there?', true], ['still there?', true]]);
  } finally { d.kill(); await new Promise((r) => { if (d.exitCode !== null || d.signalCode !== null) return r(); d.once('exit', r); }); await gw.close(); }
});

test('the gateway tells every subscribed browser when an Inbox goes up, with no page open', async () => {
  const sent = [];
  let status = 201;
  const pushFetch = async (endpoint, init) => { sent.push({ endpoint, init }); return { status }; };
  const gw = await gateway('push', { pushFetch });
  let list = [{ devteam: 1, root: '/r/stacks', name: 'stacks', port: P, inbox: 3 }];
  const hub = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ hub: 1, instances: list })); });
  await until(() => new Promise((r) => { hub.once('error', () => r(false)); hub.listen(HUB, '127.0.0.1', () => r(true)); }), 'the hub port');
  try {
    const a = authenticator();
    assert.equal((await gw.claim(a)).status, 200);
    const phone = browserKeys();
    const desktop = browserKeys();
    const sub = (b, endpoint) => ({ body: { endpoint, keys: b.keys } });
    assert.equal((await gw.req('POST', '/push/subscribe', { ...sub(phone, 'https://web.push.apple.com/phone'), cookie: '' })).status, 401, 'only the owner subscribes');
    assert.equal((await gw.req('POST', '/push/subscribe', { ...sub(phone, 'https://web.push.apple.com/phone'), headers: { origin: gw.inst(P) } })).status, 403, 'and not from a dashboard\'s page');
    assert.equal((await gw.req('POST', '/push/subscribe', sub(phone, 'https://evil.example/x'))).status, 400);

    await gw.g.pollPush();
    assert.equal(sent.length, 0, 'nobody to tell yet, and the backlog is recorded');
    assert.equal((await gw.req('POST', '/push/subscribe', sub(phone, 'https://web.push.apple.com/phone'))).status, 200);
    assert.equal((await gw.req('POST', '/push/subscribe', sub(desktop, 'https://fcm.googleapis.com/fcm/send/desk'))).status, 200);
    assert.equal((await gw.req('POST', '/push/subscribe', sub(desktop, 'https://fcm.googleapis.com/fcm/send/desk'))).status, 200, 'saying so twice is one device');

    await gw.g.pollPush();
    assert.equal(sent.length, 0, 'what was already there is not news to a new subscriber');
    list = [{ ...list[0], inbox: 5 }];
    await gw.g.pollPush();
    assert.deepEqual(sent.map((x) => x.endpoint).sort(), ['https://fcm.googleapis.com/fcm/send/desk', 'https://web.push.apple.com/phone']);
    const toPhone = sent.find((x) => x.endpoint.includes('apple'));
    assert.deepEqual(openPush(toPhone.init.body, phone), { title: 'stacks: 2 new in the Inbox', body: '/r/stacks', tag: 'devteam-/r/stacks', url: '/#stacks' });
    assert.equal(toPhone.init.headers['content-encoding'], 'aes128gcm');
    assert.equal(toPhone.init.redirect, 'error');
    const key = (await gw.req('GET', '/box.json')).json.push;
    assert.ok(toPhone.init.headers.authorization.endsWith(`, k=${key}`));
    const aud = JSON.parse(Buffer.from(toPhone.init.headers.authorization.split(' ')[1].slice(2).split('.')[1], 'base64url')).aud;
    assert.equal(aud, 'https://web.push.apple.com');

    // the hub's test: one push, to the device that asked, and only the owner may ask
    sent.length = 0;
    const phoneOnly = { body: { endpoint: 'https://web.push.apple.com/phone' } };
    assert.equal((await gw.req('POST', '/push/test', phoneOnly)).status, 200);
    assert.deepEqual(sent.map((x) => x.endpoint), ['https://web.push.apple.com/phone']);
    assert.equal(openPush(sent[0].init.body, phone).title, 'devteam: test notification');
    assert.equal((await gw.req('POST', '/push/test', { ...phoneOnly, cookie: '' })).status, 401);
    assert.equal((await gw.req('POST', '/push/test', { ...phoneOnly, headers: { origin: gw.inst(P) } })).status, 403);
    assert.equal((await gw.req('POST', '/push/test', { body: { endpoint: 'https://web.push.apple.com/nobody' } })).status, 404);
    status = 403;
    assert.match((await gw.req('POST', '/push/test', phoneOnly)).json.error, /403/, 'and a refusal is reported, not hidden');
    status = 201;

    // a restart: the same disk, and a dashboard coming back with its Inbox as it was
    sent.length = 0;
    const again = G.createGateway({ publicUrl: gw.publicUrl, dir: gw.dir, log: () => {}, pushFetch });
    await again.pollPush();
    assert.equal(sent.length, 0, 'a restart is not news');
    list = [{ ...list[0], inbox: 6 }];
    await again.pollPush();
    assert.equal(sent.length, 2, 'and what arrives after it is');

    // a browser that has dropped the subscription is forgotten, and a hub that's down changes nothing
    sent.length = 0;
    status = 410;
    list = [{ ...list[0], inbox: 7 }];
    await again.pollPush();
    assert.equal(sent.length, 0, 'a root that just notified rests a minute');
    const third = G.createGateway({ publicUrl: gw.publicUrl, dir: gw.dir, log: () => {}, pushFetch });
    await third.pollPush();
    assert.equal(sent.length, 2);
    const state = () => JSON.parse(fs.readFileSync(path.join(gw.dir, 'state.json'), 'utf8'));
    assert.deepEqual(state().pushSubs, []);
    assert.equal(state().pushSeen['/r/stacks'], 7);
    await new Promise((r) => hub.close(r));
    await third.pollPush();
    assert.equal(state().pushSeen['/r/stacks'], 7);
  } finally { hub.close(); await gw.close(); }
});

test('removing a passkey ends every device\'s notifications', async () => {
  const gw = await gateway('pushrevoke');
  try {
    const a = authenticator();
    const b = authenticator();
    assert.equal((await gw.claim(a)).status, 200);
    const ao = await gw.req('POST', '/auth/passkeys/options', { body: {} });
    assert.equal((await gw.req('POST', '/auth/passkeys/verify', { body: b.create(ao.json, gw.auth) })).status, 200);
    assert.equal((await gw.req('POST', '/push/subscribe', { body: { endpoint: 'https://web.push.apple.com/phone', keys: browserKeys().keys } })).status, 200);
    assert.equal((await gw.req('POST', '/auth/passkeys/remove', { body: { id: u(b.id) } })).status, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(gw.dir, 'state.json'), 'utf8')).pushSubs, []);
  } finally { await gw.close(); }
});

test('the hub sends nothing itself on a box, and a dashboard notifies no one', () => {
  const hub = fs.readFileSync(path.join(kit, 'dashboard', 'hub.html'), 'utf8');
  assert.match(hub, /if \(box \|\| !NOTIFY_OK/);
  const dash = fs.readFileSync(path.join(kit, 'dashboard', 'index.html'), 'utf8');
  assert.doesNotMatch(dash, /new Notification|requestPermission/);
  assert.match(dash, /function inboxTitle/, 'the tab title keeps its count');
});

test('a list sent a byte at a time can\'t hold the poller', async () => {
  const gw = await gateway('slowhub', { hubDeadlineMs: 300 });
  const hub = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); const t = setInterval(() => res.write(' '), 50); res.on('close', () => clearInterval(t)); });
  await until(() => new Promise((r) => { hub.once('error', () => r(false)); hub.listen(HUB, '127.0.0.1', () => r(true)); }), 'the hub port');
  try {
    const t0 = Date.now();
    await gw.g.pollPush();
    assert.ok(Date.now() - t0 < 3000, 'it gives up');
    await gw.g.pollPush();
  } finally { hub.closeAllConnections?.(); hub.close(); await gw.close(); }
});

test('one malformed entry costs only itself, and what a tap opens is the hub\'s tab', () => {
  const ports = Array.from({ length: 25 }, (_, i) => P + i);
  const good = { root: '/r/real', name: 'real', port: P, inbox: 2 };
  const lone = G.inboxNews({}, [{ root: '/r/lone', name: '\ud800', port: P + 1, inbox: 1 }, good], ports).messages;
  assert.deepEqual(lone.map((m) => m.title), ['�: 1 new in the Inbox', 'real: 2 new in the Inbox']);
  assert.equal(lone[0].url, '/#%EF%BF%BD');
  assert.equal(G.inboxNews({}, [{ root: '/r/\udc00', name: 'x', port: P, inbox: 1 }], ports).messages[0].body, '/r/�', 'a root is text too');
  const emoji = `${'a'.repeat(79)}\u{1F600}`;
  const split = G.inboxNews({}, [{ root: '/r/e', name: emoji, port: P, inbox: 1 }], ports).messages[0];
  assert.equal(split.title, `${'a'.repeat(79)}�: 1 new in the Inbox`, 'a cut through an emoji is well-formed too');
  assert.equal(split.url, `/#${encodeURIComponent(emoji)}`, 'and the address is the whole name, as the hub\'s keyOf has it');
  assert.equal(G.inboxNews({}, [{ root: '/r/l', name: 'n'.repeat(5000), port: P, inbox: 1 }], ports).messages[0].url, '/', 'one too long to send opens the hub');
  let deep = [];
  for (let i = 0; i < 200000; i++) deep = [deep];
  const hostile = [{ root: '/r/deep', name: deep, port: P + 1, inbox: 1 }, { root: '/r/port', port: deep, inbox: 1 }, 7, null, good];
  assert.deepEqual(G.inboxNews({}, hostile, ports).messages.map((m) => m.title), ['real: 2 new in the Inbox'], 'one String() can\'t even turn into text');
  const proto = { root: '__proto__', name: 'p', port: P, inbox: 3 };
  assert.deepEqual(G.inboxNews({}, [proto], ports).messages, [], 'a root that can\'t be remembered would be news every poll');
});

test('a poll is bounded, whatever the list claims', () => {
  const ports = Array.from({ length: 25 }, (_, i) => P + i);
  const list = Array.from({ length: 20000 }, (_, i) => ({ root: `/${i}`, name: 'n', port: P + (i % 25), inbox: 1 }));
  const t0 = Date.now();
  const first = G.inboxNews({}, list, ports);
  assert.ok(Date.now() - t0 < 2000, 'a large list is one pass (it was 6.4 s)');
  assert.equal(first.roots.length, 25, 'one entry a port');
  assert.equal(first.messages.length, 1, 'and one notification');
  assert.equal(Object.keys(first.seen).length, 25);
  assert.deepEqual(G.inboxNews(first.seen, list, ports).messages, [], 'the same list is no news the next time');
  const old = Object.fromEntries([['/r/live', 2], ...Array.from({ length: 199 }, (_, i) => [`/old/${i}`, 1])]);
  const at = (root, port, inbox) => ({ root, name: root, port, inbox });
  const live = [at('/r/live', P, 2), at('/r/new', P + 1, 1)];
  const once = G.inboxNews(old, live, ports);
  assert.equal(Object.keys(once.seen).length, 200, 'the record stays at its size');
  assert.equal(once.seen['/r/live'], 2, 'by forgetting what isn\'t listed, however old a live root\'s entry is');
  assert.deepEqual(G.inboxNews(once.seen, live, ports).messages, [], 'so a live root isn\'t reported again and again');
});

test('a bad name doesn\'t stop notifications, and a poll sends only so many at once', async () => {
  const sent = [];
  let flying = 0;
  let most = 0;
  const pushFetch = async (endpoint, init) => { sent.push({ endpoint, init }); most = Math.max(most, ++flying); await new Promise((r) => setTimeout(r, 5)); flying--; return { status: 201 }; };
  const gw = await gateway('badname', { pushFetch });
  let body = '';
  const hub = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(body); });
  const say = (instances) => { body = JSON.stringify({ hub: 1, instances }); };
  await until(() => new Promise((r) => { hub.once('error', () => r(false)); hub.listen(HUB, '127.0.0.1', () => r(true)); }), 'the hub port');
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    const phone = browserKeys();
    assert.equal((await gw.req('POST', '/push/subscribe', { body: { endpoint: 'https://web.push.apple.com/phone', keys: phone.keys } })).status, 200);
    const real = { root: '/r/real', name: 'real', port: P, inbox: 0 };
    const bad = { root: '/r/bad', name: '\ud800', port: P + 1, inbox: 0 };
    say([real, bad]);
    await gw.g.pollPush();
    assert.equal(sent.length, 0);
    say([{ ...real, inbox: 2 }, { ...bad, inbox: 1 }]);
    await gw.g.pollPush();
    assert.deepEqual(sent.map((x) => openPush(x.init.body, phone).title).sort(), ['real: 2 new in the Inbox', '�: 1 new in the Inbox'].sort());

    // the review's other shape, through the real poller: 20k roots, under the 1 MB the hub's answer may be
    for (let i = 0; i < 19; i++) await gw.req('POST', '/push/subscribe', { body: { endpoint: `https://web.push.apple.com/d${i}`, keys: browserKeys().keys } });
    sent.length = 0;
    say(Array.from({ length: 20000 }, (_, i) => ({ root: `/${i}`, name: 'n', port: P + (i % 25), inbox: 1 })));
    assert.ok(body.length < 1024 * 1024, 'the list fits what the hub may answer');
    const t0 = Date.now();
    await gw.g.pollPush();
    assert.ok(Date.now() - t0 < 5000, 'it isn\'t held up');
    assert.equal(sent.length, 20, 'one notification, to each device');
    assert.equal(openPush(sent[0].init.body, phone).title.endsWith('have new Inbox items'), true);
    assert.ok(most > 1 && most <= 6, `at most 6 at a time (saw ${most})`);
    const before = sent.length;
    await gw.g.pollPush();
    assert.equal(sent.length, before, 'and not the same news again');
  } finally { hub.closeAllConnections?.(); hub.close(); await gw.close(); }
});

test('a passkey made for another name says how to get back in', async () => {
  const dir = path.join(tmp, 'oldrp');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ passkeys: [{ id: 'x', name: 'old', createdAt: '2026-01-01' }], sessions: [] }));
  const logs = [];
  G.createGateway({ publicUrl: 'http://box.localhost:1', dir, log: (m) => logs.push(m) });
  assert.match(logs.join('\n'), /devteam-reclaim/);
});

// ===== public artifacts: what the owner published, to anyone, from the gateway's own copy =====

// A published artifact as the gateway keeps it: its blobs, and its entry in state.json.
function seedPublic(dir, project, slug, files, { root = '/srv/x', port = P } = {}) {
  const blobs = path.join(dir, 'public', 'blobs');
  fs.mkdirSync(blobs, { recursive: true });
  const f = path.join(dir, 'state.json');
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  const entry = {};
  for (const [rel, text] of Object.entries(files)) {
    const b = Buffer.from(text);
    const h = crypto.createHash('sha256').update(b).digest('hex');
    fs.writeFileSync(path.join(blobs, h), b);
    entry[rel] = { sha256: h, size: b.length };
  }
  const pub = s.public ?? {};
  pub[project] = { root, port, artifacts: { ...(pub[project]?.artifacts ?? {}), [slug]: { tree: 'a'.repeat(40), title: slug, at: new Date().toISOString(), files: entry } } };
  fs.writeFileSync(f, JSON.stringify({ ...s, public: pub }));
}

test('<project>.<box>: anyone reads a published artifact, from the gateway\'s own copy, under its own headers', async () => {
  const gw = await gateway('public-serve');
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    const page = '<!doctype html><p>hi';
    seedPublic(gw.dir, 'alpha', 'hello', { 'index.html': page, 'app.js': 'x()', 'img/a.png': 'png', 'data.weird': 'w' });
    const get = (route, headers = {}, method = 'GET') => gw.req(method, route, { on: 'alpha', cookie: '', headers });
    let r = await get('/hello/');
    assert.equal(r.status, 200);
    assert.equal(r.body, page);
    const etag = `"${crypto.createHash('sha256').update(page).digest('hex')}"`;
    assert.deepEqual([r.headers['content-type'], r.headers['content-length'], r.headers.etag, r.headers['cache-control'], r.headers['x-content-type-options'], r.headers['referrer-policy']], ['text/html; charset=utf-8', String(Buffer.byteLength(page)), etag, 'public, max-age=60', 'nosniff', 'no-referrer']);
    assert.equal(r.headers['set-cookie'], undefined);
    const self = `${gw.inst('alpha')}/hello/`;
    const csp = r.headers['content-security-policy'].split('; ');
    for (const d of ["default-src 'none'", `script-src 'unsafe-inline' 'unsafe-eval' ${self} https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com`, `connect-src ${self} https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com`, `img-src ${self} data: blob:`, "form-action 'none'", "frame-ancestors 'none'", 'sandbox allow-scripts allow-forms allow-modals allow-pointer-lock']) assert.ok(csp.includes(d), `the policy has ${d}: ${csp.join('; ')}`);
    // Pinned: a published page frames nothing and has no origin of its own. It is served on its
    // project's host, whose dashboard pages accept 'self' as a frame ancestor, and frame-ancestors
    // matches by URL, so a page on that name that could frame would satisfy it.
    assert.ok(csp.includes("frame-src 'none'"), csp.join('; '));
    assert.equal(csp.filter((d) => /^(frame-src|child-src|sandbox)\b/.test(d)).join('; '), "frame-src 'none'; sandbox allow-scripts allow-forms allow-modals allow-pointer-lock", 'no child-src, one frame-src, one sandbox');
    assert.doesNotMatch(r.headers['content-security-policy'], /allow-same-origin|127\.0\.0\.1/);
    assert.equal((await get('/hello/app.js')).headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal((await get('/hello/img/a.png')).headers['content-type'], 'image/png');
    assert.equal((await get('/hello/data.weird')).headers['content-type'], 'application/octet-stream');
    // HEAD: the headers and no body; a strong tag that matches, or *, is a 304
    r = await get('/hello/', {}, 'HEAD');
    assert.deepEqual([r.status, r.body, r.headers['content-length'], r.headers.etag], [200, '', String(Buffer.byteLength(page)), etag]);
    assert.equal((await get('/hello/', { 'if-none-match': `"x", ${etag}` })).status, 304);
    assert.equal((await get('/hello/', { 'if-none-match': '*' })).status, 304);
    assert.equal((await get('/hello/', { 'if-none-match': `W/${etag}` })).status, 200, 'a weak tag is no match');
    // a lost blob: HEAD and GET agree
    const lost = path.join(gw.dir, 'public', 'blobs', crypto.createHash('sha256').update('w').digest('hex'));
    fs.renameSync(lost, `${lost}.away`);
    assert.deepEqual([(await get('/hello/data.weird', {}, 'HEAD')).status, (await get('/hello/data.weird')).status], [500, 500]);
    fs.renameSync(`${lost}.away`, lost);
    // reads only, and no service workers
    r = await gw.req('POST', '/hello/', { on: 'alpha', cookie: '', body: {} });
    assert.deepEqual([r.status, r.headers.allow], [405, 'GET, HEAD']);
    assert.equal((await get('/hello/app.js', { 'service-worker': 'script' })).status, 403);
    assert.equal((await get('/hello/app.js', { 'sec-fetch-dest': 'serviceworker' })).status, 403);
    // signed in or not, without fetch metadata the same answer: the cookie only ever chooses the
    // owner's wrapper (a top-level visit), and none is set
    r = await gw.req('GET', '/hello/', { on: 'alpha' });
    assert.deepEqual([r.status, r.body, r.headers['set-cookie']], [200, page, undefined]);
    // inside a published page, nothing unpublished is there, and the raw path is matched before decoding
    for (const bad of ['/hello/nope.js', '/hello/.env', '/hello/%2e%2e/x', '/hello/../hello/app.js', '/hello//app.js'])
      assert.equal((await get(bad)).status, 404, bad);
    // any other path is the dashboard's, behind the session: signed out, never a stored page
    for (const other of ['/', '/nope/', '/Hello/', '/box.json', '/auth/login', '/alpha/hello/'])
      assert.deepEqual([(r = await get(other)).status, r.body === page], [401, false], other);
    assert.equal((await gw.req('GET', '/hello/', { cookie: '', headers: { host: `beta.box.localhost:${gw.port}` } })).status, 401, 'another name has no such page');
    r = await get('/hello');
    assert.deepEqual([r.status, r.headers.location, r.headers['cache-control']], [302, '/hello/', 'no-store'], 'to the trailing slash, when published');
    r = await get('/nope');
    assert.deepEqual([r.status, r.headers.location], [401, undefined], 'only a published slug is sent to its trailing slash: any other is the dashboard\'s, behind the session');
    assert.equal((await gw.req('GET', '/alpha/hello/', { headers: { host: `public.box.localhost:${gw.port}` } })).status, 421, 'the old public name answers nothing');
    assert.equal((await gw.req('GET', '/', { headers: { host: `pub.box.evil.test:${gw.port}` } })).status, 421, 'the box still answers only on its own names');
  } finally { await gw.close(); }
});

test('public.<box> serves artifacts with the kit\'s own type map, CDN list and policy, kept in the gateway', () => {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const one = (name) => { const m = new RegExp(`^const ${name} = (.+);$`, 'm').exec(src); assert.ok(m, `the kit defines ${name} on one line`); return m[1]; };
  const at = src.indexOf('const artifactCsp = ');
  assert.ok(at > 0, 'the kit defines artifactCsp');
  const cspSrc = src.slice(at, src.indexOf('\n};\n', at) + 3);
  const ctx = vm.createContext({ HUB_PORT: 4320 });
  vm.runInContext(`ARTIFACT_TYPES = ${one('ARTIFACT_TYPES')}; ARTIFACT_CDNS = ${one('ARTIFACT_CDNS')};\n${cspSrc}\nglobalThis.artifactCsp = artifactCsp;`, ctx);
  assert.deepEqual({ ...G.PUBLIC_TYPES }, { ...ctx.ARTIFACT_TYPES }, 'the type map');
  assert.deepEqual([...G.PUBLIC_CDNS], [...ctx.ARTIFACT_CDNS], 'the CDN list');
  const self = 'https://public.box.example.com/alpha/hello/';
  const kitCsp = ctx.artifactCsp('http://127.0.0.1:4321', self).split('; ');
  const gwCsp = G.publicCsp(self).split('; ');
  assert.deepEqual(gwCsp.filter((d) => !d.startsWith('frame-ancestors ')), kitCsp.filter((d) => !d.startsWith('frame-ancestors ')), 'the same policy');
  assert.ok(gwCsp.includes("frame-ancestors 'none'"), 'framed by nothing');
  // the names and limits a manifest is checked against
  const kitOf = (name) => vm.runInContext(`(${one(name)})`, vm.createContext({}));
  for (const [gw, name] of [['LINK_ID', 'LINK_ID'], ['TREE', 'TREE_ID'], ['PROJECT', 'PUBLIC_PROJECT']]) assert.equal(String(G[gw]), String(kitOf(name)), name);
  assert.equal(G.FILE_MAX, kitOf('ARTIFACT_FILE_MAX'), 'the size of a file');
  assert.equal(G.ARTIFACT_MAX, kitOf('ARTIFACT_MAX'), 'the size of an artifact');
  const pathOk = /^const artifactPathOk = (.+);$/m.exec(src)[1];
  const kitOk = vm.runInContext(`(${pathOk})`, vm.createContext({}));
  for (const p of ['index.html', 'a/b.js', '.env', 'a/.git/x', 'a//b', 'a/../b', 'a%2eb', 'é.png', '__proto__']) assert.equal(G.publicPathOk(p), kitOk(p), p);
});

test("the kit's preview lens and framing rules are the gateway's own: the laptop's relay serves the same bytes", () => {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const kitLens = /^const PREVIEW_LENS = String\.raw`([^`]*)`;$/m.exec(src)?.[1];
  assert.ok(kitLens, 'the kit holds the lens as one String.raw');
  assert.equal(kitLens, G.PREVIEW_LENS, 'byte for byte');
  const gw = fs.readFileSync(path.join(here, '..', 'cloud', 'gateway.mjs'), 'utf8');
  for (const name of ['FRAME_ANCESTORS', 'replaceFrameAncestors']) {
    const one = (text) => new RegExp(`^(?:export )?const ${name} = (.*)$`, 'm').exec(text)?.[1];
    assert.ok(one(src), `the kit has ${name}`);
    assert.equal(one(src), one(gw), name);
  }
  const kitCsp = vm.runInNewContext(`${/^const previewLensPart = .*$/m.exec(src)[0]}\n${/^const previewLensHash = .*$/m.exec(src)[0]}\n${/^const previewLensCsp = .*$/m.exec(src)[0]}\npreviewLensCsp('http://a http://b')`, { PREVIEW_LENS: kitLens, crypto });
  assert.equal(kitCsp, G.previewLensCsp('http://a http://b'), 'the same policy for the same ancestors');
});

test('the gateway computes git\'s blob and tree ids from bytes, sha1 and sha256', () => {
  const files = { 'index.html': '<!doctype html>', 'a/b.js': 'b', 'a/c/d.css': 'd', 'a-b.txt': 'x', 'a.txt': 'y', 'run.sh': 'echo' };
  for (const fmt of ['sha1', 'sha256']) {
    const d = fs.mkdtempSync(path.join(tmp, `tree-${fmt}-`));
    if (spawnSync('git', ['init', '-q', `--object-format=${fmt}`, d]).status !== 0) { assert.equal(fmt, 'sha256', 'every git makes a sha1 repo'); continue; }
    for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), text); }
    fs.chmodSync(path.join(d, 'run.sh'), 0o755);
    execFileSync('git', ['-c', 'core.fileMode=true', 'add', '-A'], { cwd: d });
    const want = execFileSync('git', ['write-tree'], { cwd: d, encoding: 'utf8' }).trim();
    const ids = Object.fromEntries(Object.entries(files).map(([rel, text]) => [rel, { oid: G.gitBlobId(Buffer.from(text), fmt), mode: rel === 'run.sh' ? '100755' : '100644' }]));
    assert.equal(ids['a/b.js'].oid, execFileSync('git', ['hash-object', 'a/b.js'], { cwd: d, encoding: 'utf8' }).trim(), `${fmt} blob`);
    assert.equal(G.gitTreeId(ids, fmt), want, `${fmt} tree, sorted as git sorts (a-b.txt, a.txt, a/)`);
  }
  assert.throws(() => G.gitTreeId({ a: { oid: 'a'.repeat(40), mode: '100644' }, 'a/b': { oid: 'a'.repeat(40), mode: '100644' } }), /a is both a file and a folder/);
});

test('a manifest from an instance is checked before anything of it is shown or fetched', () => {
  const entry = { sha256: 'b'.repeat(64), size: 3, mode: '100644' };
  const good = { public: 1, project: 'alpha', slug: 'hello', title: 'Hi', summary: 's', root: '/srv/alpha', tree: 'a'.repeat(40), files: { 'index.html': entry } };
  assert.equal(G.manifestProblem(good, 'hello'), null);
  assert.equal(G.manifestProblem({ ...good, tree: 'a'.repeat(64) }, 'hello'), null, 'a sha256 repo');
  const bad = (over, re, slug = 'hello') => assert.match(String(G.manifestProblem({ ...good, ...over }, slug)), re, JSON.stringify(over).slice(0, 80));
  bad({ public: 2 }, /not a manifest/);
  bad({ project: 'Alpha' }, /project/);
  bad({ project: `a${'b'.repeat(63)}` }, /project/);
  bad({ root: 'srv/alpha' }, /root is not an absolute path/);
  bad({ root: '/srv/\nalpha' }, /root is not an absolute path/);
  bad({}, /the manifest is for hello, not other/, 'other');
  bad({ tree: 'a'.repeat(41) }, /tree/);
  bad({ title: 'x'.repeat(121) }, /title/);
  bad({ extra: 1 }, /unknown key "extra"/);
  bad({ files: {} }, /1 to 2000 files/);
  bad({ files: Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [i ? `f${i}.txt` : 'index.html', entry])) }, /1 to 2000 files/);
  bad({ files: { 'index.html': entry, '.env': entry } }, /\.env: not a path the kit serves/);
  bad({ files: { 'index.html': entry, 'a/../b': entry } }, /not a path the kit serves/);
  bad({ files: { 'index.html': { ...entry, sha256: 'B'.repeat(64) } } }, /index\.html: a bad entry/);
  bad({ files: { 'index.html': { ...entry, size: 8 * 1024 * 1024 + 1 } } }, /a bad entry/);
  bad({ files: { 'index.html': { ...entry, mode: '120000' } } }, /a bad entry/);
  bad({ files: { 'a.js': entry } }, /no index\.html/);
  bad({ files: Object.fromEntries(Array.from({ length: 4 }, (_, i) => [i ? `f${i}.bin` : 'index.html', { ...entry, size: 7 * 1024 * 1024 }])) }, /over 25 MB/);
  assert.equal(G.canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
});

test('the public store: content-addressed blobs, one change at a time, swept to what state.json names', async () => {
  const S = G.publicStore(fs.mkdtempSync(path.join(tmp, 'pstore-')));
  const h = (t) => crypto.createHash('sha256').update(t).digest('hex');
  assert.equal(S.write(h('a'), Buffer.from('a')), true);
  assert.equal(S.write(h('a'), Buffer.from('a')), false, 'a blob is written once');
  S.write(h('b'), Buffer.from('b'));
  fs.writeFileSync(path.join(S.blobs, `${h('c')}.1.abc.tmp`), 'c');
  const pub = { alpha: { root: '/r', port: 1, artifacts: { x: { tree: 't', files: { 'index.html': { sha256: h('a'), size: 1 }, 'copy.html': { sha256: h('a'), size: 1 } } } } } };
  assert.deepEqual([...S.referenced(pub)], [[h('a'), 1]], 'each blob counts once');
  S.sweep(pub);
  assert.deepEqual(fs.readdirSync(S.blobs), [h('a')], 'unreferenced blobs and stray temp files go');
  assert.equal(fs.readFileSync(S.blobPath(h('a')), 'utf8'), 'a');
  const order = [];
  const slow = S.serial(async () => { await new Promise((r) => setTimeout(r, 50)); order.push(1); });
  const failing = S.serial(async () => { order.push(2); throw new Error('no'); });
  const after = S.serial(() => { order.push(3); return 'ok'; });
  await slow;
  await assert.rejects(failing, /no/);
  assert.equal(await after, 'ok', 'a failed change doesn\'t stop the next');
  assert.deepEqual(order, [1, 2, 3]);
});

// A stand-in instance on a block port: the manifest and files it is given, and what the gateway
// asked it to record. lie serves other bytes for a file than its manifest names; tree and title
// override what the manifest says; trickle sends a file a byte every that many ms; asked lists
// every request; reset puts back what it was made with.
function standIn(port, arts, { project = 'beta', root = '/srv/beta' } = {}) {
  const made = JSON.stringify({ arts, project, root });
  const S = { recorded: [] };
  S.reset = () => Object.assign(S, JSON.parse(made), { lie: {}, tree: {}, title: {}, trickle: {}, asked: [], getOrigins: [] });
  S.reset();
  const hex = (t) => crypto.createHash('sha256').update(t).digest('hex');
  S.manifest = (slug) => {
    const files = Object.fromEntries(Object.entries(S.arts[slug]).map(([rel, t]) => [rel, { sha256: hex(Buffer.from(t)), size: Buffer.byteLength(t), mode: '100644' }]));
    const tree = G.gitTreeId(Object.fromEntries(Object.entries(S.arts[slug]).map(([rel, t]) => [rel, { oid: G.gitBlobId(Buffer.from(t)), mode: '100644' }])));
    return { public: 1, project: S.project, slug, title: S.title[slug] ?? `The ${slug}`, summary: 's', root: S.root, tree: S.tree[slug] ?? tree, files };
  };
  const srv = http.createServer((req, res) => {
    const reply = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(body); };
    let m;
    S.asked.push(req.url);
    if (req.method === 'GET') S.getOrigins.push(req.headers.origin ?? null);
    if (req.method === 'GET' && (m = /^\/public-manifest\/([a-z0-9-]+)$/.exec(req.url))) return Object.hasOwn(S.arts, m[1]) ? reply(200, JSON.stringify(S.manifest(m[1]))) : reply(404, '{"error":"not an artifact landed on main"}');
    if (req.method === 'GET' && (m = /^\/artifact\/main\/([a-z0-9-]+)\/(.+)$/.exec(req.url)) && Object.hasOwn(S.arts, m[1]) && Object.hasOwn(S.arts[m[1]], m[2])) {
      const text = S.lie[`${m[1]}/${m[2]}`] ?? S.arts[m[1]][m[2]];
      const every = S.trickle[`${m[1]}/${m[2]}`];
      if (!every) return reply(200, text, 'text/plain');
      res.writeHead(200, { 'content-type': 'text/plain' });
      let i = 0;
      const t = setInterval(() => { if (res.destroyed || i >= text.length) { clearInterval(t); return res.end(); } res.write(text[i++]); }, every);
      return;
    }
    if (req.method === 'GET' && req.url === '/api/hello') return reply(200, JSON.stringify({ devteam: 1, name: S.project, root: S.root, port }));
    if (req.method === 'POST' && req.url === '/api/artifact-publish') {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => { S.recorded.push({ ...JSON.parse(b), headers: req.headers }); reply(200, '{"ok":true}'); });
      return;
    }
    reply(404, '{"error":"not found"}');
  }).listen(port, '127.0.0.1');
  S.close = () => new Promise((r) => { standIns.delete(port); srv.close(r); });
  standIns.set(port, S);
  return S;
}
const standIns = new Map();
// A stand-in hub on the gateway's hub port, so Publish has the fresh list it needs to prove a name
// is one project's (m-20261122-034142665). It lists what the test says, or, as confirmAndPublish
// sets it, the one instance a publish is from (other checkouts of the name aren't running).
async function listHub(list = []) {
  const H = { list, names: new Map() };
  const srv = http.createServer((req, res) => { req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ hub: 1, instances: H.list })); });
  await new Promise((ok, no) => { srv.once('error', no); srv.listen(HUB, '127.0.0.1', ok); });
  // the instance at port: a stand-in's own project and root, or one the test named
  H.only = (port) => { const S = standIns.get(port); H.list = [{ devteam: 1, port, ...(S ? { name: S.project, root: S.root } : H.names.get(port)) }]; };
  H.close = () => new Promise((r) => { srv.closeAllConnections(); srv.close(r); });
  return H;
}
// The owner's two steps: the gateway's confirm page, then its POST of what the page showed.
async function confirmAndPublish(gw, port, slugs, { move = false, before = async () => {} } = {}) {
  gw.hub.only(port);
  const page = await gw.req('GET', `/public/publish?port=${port}&${slugs.map((s) => `slug=${s}`).join('&')}`);
  assert.equal(page.status, 200, page.body);
  // "move it" carries the root the page showed, as the page's own script posts it
  const from = Object.fromEntries([...page.body.matchAll(/data-move="([^"]+)" data-moved-from="([^"]*)"/g)].map(([, s, r]) => [s, r.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))]));
  const items = [...page.body.matchAll(/data-slug="([^"]+)" data-manifest="([0-9a-f]{64})"/g)].map(([, slug, manifest]) => ({ slug, manifest, move, ...(move && Object.hasOwn(from, slug) ? { movedFrom: from[slug] } : {}) }));
  await before();
  const r = await gw.req('POST', '/public/publish', { body: { port, items } });
  assert.equal(r.status, 200, r.body);
  return { page, results: r.json.results };
}
const esc = (x) => String(x).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const blobsOf = (gw) => { try { return fs.readdirSync(path.join(gw.dir, 'public', 'blobs')).sort(); } catch { return []; } };
// A project with artifacts landed on its main, as merge would leave them, and its dashboard.
function landedProject(base, name, artifacts) {
  const r = bareProject(base, name);
  for (const [slug, files] of Object.entries(artifacts)) for (const [rel, text] of Object.entries(files)) {
    const f = path.join(r, 'docs/devteam/project/artifacts', slug, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  execFileSync('git', ['add', '-A'], { cwd: r });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'land'], { cwd: r });
  return r;
}
function startKit(root, port) {
  const env = { ...process.env };
  delete env.DEVTEAM_ROLE;
  const d = spawn(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), 'dashboard', '--port', String(port)], { cwd: root, env, stdio: 'ignore' });
  return { d, stop: () => new Promise((r) => { if (d.exitCode !== null) return r(); d.on('close', r); d.kill(); }) };
}
const kitUp = (port) => until(async () => { try { return (await fetch(`http://127.0.0.1:${port}/api/hello`)).ok; } catch { return false; } }, `the dashboard on ${port}`);
const HELLO = { 'index.html': '<!doctype html><link rel="stylesheet" href="s.css"><p>hello', 's.css': 'p { color: red }', 'artifact.json': JSON.stringify({ v: 1, title: 'A <b>mock</b> & more', summary: 'For anyone', by: 'supervisor' }) };

test('public artifacts: the owner confirms on the box\'s own page, and anyone reads the gateway\'s copy', async () => {
  const gw = await gateway('public-kit');
  gw.hub = await listHub();
  const A = landedProject(fs.mkdtempSync(path.join(tmp, 'pub-')), 'alpha', { hello: HELLO });
  gw.hub.names.set(P + 1, { name: 'alpha', root: A });
  const kitA = startKit(A, P + 1);
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    await kitUp(P + 1);
    const at = `/public/publish?port=${P + 1}&slug=hello`;
    // the confirm page is the gateway's, for the signed-in owner, on the box's own name
    assert.equal((await gw.req('GET', at, { cookie: '' })).status, 401);
    assert.equal((await gw.req('GET', `/public/publish?port=${P + 99}&slug=hello`)).status, 400, 'an instance of this box');
    assert.equal((await gw.req('GET', `/public/publish?port=${P + 1}&slug=Hello`)).status, 400, 'a slug');
    const conf = await gw.req('GET', at);
    assert.equal(conf.status, 200, conf.body);
    assert.ok(conf.headers['content-security-policy'].split('; ').includes("form-action 'none'"));
    assert.match(conf.body, /alpha · hello · 3 files/);
    assert.ok(conf.body.includes('A &#60;b&#62;mock&#60;/b&#62; &#38; more'), 'the title, escaped');
    assert.ok(!conf.body.includes('<b>mock</b>'));
    assert.ok(conf.body.includes(`${gw.inst('alpha')}/hello/`), 'the link it will have');
    assert.match(conf.body, /not on this box/);
    assert.match(conf.body, /Not ticked, because this box holds no copy of it\. This instance's log records no publish of it/);
    assert.doesNotMatch(conf.body, /data-manifest="[0-9a-f]{64}" checked/, 'what the box has no copy of starts unticked');
    assert.ok(conf.body.includes(`from the checkout ${esc(fs.realpathSync(A))}, as this instance reports it`), 'the root, as reported');
    for (const f of ['index.html', 's.css', 'artifact.json']) assert.match(conf.body, new RegExp(`<div>${f.replace('.', '\\.')} <small>`), `${f} is named`);
    assert.doesNotMatch(conf.body, /autofocus/, 'the Publish button never has focus waiting');
    const items = [...conf.body.matchAll(/data-slug="([^"]+)" data-manifest="([0-9a-f]{64})"/g)].map(([, slug, manifest]) => ({ slug, manifest }));
    assert.equal(items.length, 1);
    // only from the box's own page, and only signed in
    assert.equal((await gw.req('POST', '/public/publish', { body: { port: P + 1, items }, headers: { origin: gw.inst('alpha') } })).status, 403, 'not from an instance\'s name');
    assert.equal((await gw.req('POST', '/public/publish', { body: { port: P + 1, items }, cookie: '' })).status, 401);
    assert.equal((await gw.req('POST', '/public/publish', { body: { port: P + 1, items: [{ slug: 'hello', manifest: 'x' }] } })).status, 400);
    const r = await gw.req('POST', '/public/publish', { body: { port: P + 1, items } });
    assert.equal(r.status, 200, r.body);
    assert.deepEqual(r.json.results, [{ slug: 'hello', ok: true, url: `${gw.inst('alpha')}/hello/`, update: false }]);
    // anyone reads it, under the gateway's own headers
    const pubGet = (route, opts = {}) => gw.req('GET', route, { on: 'alpha', cookie: '', ...opts });
    let p = await pubGet('/hello/');
    assert.deepEqual([p.status, p.body, p.headers['set-cookie']], [200, HELLO['index.html'], undefined]);
    assert.ok(p.headers['content-security-policy'].includes(`script-src 'unsafe-inline' 'unsafe-eval' ${gw.inst('alpha')}/hello/ `));
    assert.equal(p.headers.etag, `"${crypto.createHash('sha256').update(HELLO['index.html']).digest('hex')}"`);
    assert.equal((await pubGet('/hello/s.css')).body, HELLO['s.css']);
    assert.equal((await pubGet('/hello/', { headers: { 'if-none-match': p.headers.etag } })).status, 304);
    assert.equal((await gw.req('HEAD', '/hello/', { on: 'alpha', cookie: '' })).body, '');
    assert.equal((await gw.req('POST', '/hello/', { on: 'alpha', body: {} })).status, 405);
    // the kit has the owner's act for it, from the dashboard, naming main's tree
    const env = { ...process.env };
    delete env.DEVTEAM_ROLE;
    const acts = JSON.parse(execFileSync(process.execPath, [path.join(A, 'docs/devteam/scripts/devteam.mjs'), 'log', '--type', 'act', '--by', 'owner', '--json'], { cwd: A, env, encoding: 'utf8' }));
    const T = execFileSync('git', ['rev-parse', 'main:docs/devteam/project/artifacts/hello'], { cwd: A, encoding: 'utf8' }).trim();
    assert.deepEqual(acts.map((a) => [a.class, a.what, a.artifact, a.tree, a.channel]), [['artifact-publish', 'publish', 'hello', T, 'dashboard']]);
    // after a publish nothing on the box is trusted again: the kit gone, an impostor on its port
    await kitA.stop();
    const impostor = http.createServer((q, s) => s.end('evil')).listen(P + 1, '127.0.0.1');
    try {
      p = await pubGet('/hello/');
      assert.deepEqual([p.status, p.body], [200, HELLO['index.html']]);
    } finally { await new Promise((res) => impostor.close(res)); }
    assert.match(gw.logs.join('\n'), /public: hello published from instance/);
  } finally { await kitA.stop(); await gw.hub.close(); await gw.close(); }
});

test('public artifacts: a publish is refused unless every byte, the tree and the manifest are what the owner confirmed', async () => {
  const gw = await gateway('public-refuse');
  gw.hub = await listHub();
  const S = standIn(P + 10, { a: { 'index.html': '<p>a', 'x/y.js': 'y()' }, b: { 'index.html': '<p>b' } });
  const pubGet = (route) => gw.req('GET', route, { on: 'beta', cookie: '' });
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    // an instance that serves other bytes than its manifest names
    S.lie['a/x/y.js'] = 'z()'; // as long as the real one, so only its hash tells
    let { results } = await confirmAndPublish(gw, P + 10, ['a']);
    assert.match(results[0].error, /x\/y\.js is not the file the manifest names/);
    assert.deepEqual(blobsOf(gw), [], 'nothing of it is kept');
    assert.equal((await pubGet('/a/')).status, 401, 'not public: on its project\'s host, the signed-out page');
    S.reset();
    // a manifest whose tree the bytes don't make
    S.tree.a = 'c'.repeat(40);
    ({ results } = await confirmAndPublish(gw, P + 10, ['a']));
    assert.match(results[0].error, /the files don't make the tree cccccccccccc/);
    S.reset();
    // a manifest that changed between the page and the POST: its title, its project, a file
    for (const change of [() => { S.title.a = 'Another title'; }, () => { S.project = 'gamma'; }, () => { S.arts.a['index.html'] = '<p>a2'; }]) {
      ({ results } = await confirmAndPublish(gw, P + 10, ['a'], { before: async () => change() }));
      assert.match(results[0].error, /this changed since you looked; reload the page/);
      S.reset();
    }
    assert.deepEqual(blobsOf(gw), []);
    assert.equal(S.recorded.length, 0, 'the kit was never asked to record any of them');
    // a manifest that breaks the rules is never offered
    S.arts.a['.env'] = 'secret';
    const bad = await gw.req('GET', `/public/publish?port=${P + 10}&slug=a`);
    assert.match(bad.body, /\.env: not a path the kit serves/);
    assert.doesNotMatch(bad.body, /data-manifest=/);
    S.reset();
    // two publishes at once, of different slugs: both end up served
    const [x, y] = await Promise.all([confirmAndPublish(gw, P + 10, ['a']), confirmAndPublish(gw, P + 10, ['b'])]);
    assert.ok(x.results[0].ok && y.results[0].ok, JSON.stringify([x.results, y.results]));
    assert.equal((await pubGet('/a/x/y.js')).body, 'y()');
    assert.equal((await pubGet('/b/')).body, '<p>b');
    assert.deepEqual(S.recorded.map((r) => [r.op, r.slug, r.tree.length, r.headers.origin, r.headers['sec-fetch-site'], r.headers.cookie]).sort(), [['publish', 'a', 40, `http://127.0.0.1:${P + 10}`, undefined, undefined], ['publish', 'b', 40, `http://127.0.0.1:${P + 10}`, undefined, undefined]], 'recorded through a loopback request, which says the instance\'s own Origin (kit-324), never the box\'s');
    assert.ok(S.getOrigins.length > 0 && S.getOrigins.every((o) => o === null), `the gateway's GETs (manifest, files) say no Origin: ${JSON.stringify(S.getOrigins)}`);
    assert.equal(blobsOf(gw).length, 3);
    // the same tree again is no change; another tree is an update
    let again = await confirmAndPublish(gw, P + 10, ['b']);
    assert.match(again.page.body, /already public at this version/);
    S.arts.b['index.html'] = '<p>b2';
    again = await confirmAndPublish(gw, P + 10, ['b']);
    assert.match(again.page.body, /an update/);
    assert.match(again.page.body, /data-manifest="[0-9a-f]{64}" checked/, 'the box holds what the owner approved');
    assert.match(again.page.body, /1 changed, 0 new, 0 removed/);
    assert.match(again.page.body, /<b>changed<\/b> index\.html/);
    assert.equal(again.results[0].update, true);
    assert.equal((await pubGet('/b/')).body, '<p>b2');
    assert.equal(blobsOf(gw).length, 3, 'the old version\'s blob is swept');
  } finally { await S.close(); await gw.hub.close(); await gw.close(); }
});

test('public artifacts: a project stays with its checkout unless the owner moves it; a new port is no move', async () => {
  const gw = await gateway('public-bind');
  gw.hub = await listHub();
  const one = standIn(P + 11, { a: { 'index.html': '<p>one' } }, { root: '/srv/one' });
  const two = standIn(P + 12, { a: { 'index.html': '<p>two' } }, { root: '/srv/two' });
  const twoAgain = standIn(P + 13, { a: { 'index.html': '<p>two' } }, { root: '/srv/two' });
  const served = async () => (await gw.req('GET', '/a/', { on: 'beta', cookie: '' })).body;
  const bound = () => JSON.parse(fs.readFileSync(path.join(gw.dir, 'state.json'), 'utf8')).public.beta;
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    assert.ok((await confirmAndPublish(gw, P + 11, ['a'])).results[0].ok);
    const moved = await confirmAndPublish(gw, P + 12, ['a']);
    assert.ok(moved.page.body.includes('beta is published from /srv/one; this instance is /srv/two'), moved.page.body);
    assert.match(moved.page.body, /<input type="checkbox" data-move="a" data-moved-from="\/srv\/one"> move it</, '"move it" is unchecked, and nothing else comes down');
    assert.match(moved.results[0].error, /beta is published from \/srv\/one; this instance is \/srv\/two: tick "move it"/);
    assert.equal(await served(), '<p>one');
    assert.equal(two.recorded.length, 0);
    assert.ok((await confirmAndPublish(gw, P + 12, ['a'], { move: true })).results[0].ok);
    assert.equal(await served(), '<p>two');
    assert.deepEqual([bound().root, bound().port], ['/srv/two', P + 12]);
    const port = await confirmAndPublish(gw, P + 13, ['a']);
    assert.doesNotMatch(port.page.body, /data-move="/, 'the same checkout on another port');
    assert.ok(port.results[0].ok);
    assert.deepEqual([bound().root, bound().port], ['/srv/two', P + 13]);
  } finally { await one.close(); await two.close(); await twoAgain.close(); await gw.hub.close(); await gw.close(); }
});

test('public artifacts: the box holds at most DEVTEAM_PUBLIC_MAX bytes for the public', async () => {
  const gw = await gateway('public-cap', { publicMax: 10 });
  gw.hub = await listHub();
  const S = standIn(P + 14, { small: { 'index.html': '<p>12345' }, big: { 'index.html': '<p>more than ten bytes' } });
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    assert.ok((await confirmAndPublish(gw, P + 14, ['small'])).results[0].ok);
    const { results } = await confirmAndPublish(gw, P + 14, ['big']);
    assert.match(results[0].error, /over the box's public cap of 10 bytes \(DEVTEAM_PUBLIC_MAX\)/);
    assert.equal(blobsOf(gw).length, 1, 'refused before anything is written');
    assert.deepEqual(S.recorded.map((r) => r.slug), ['small']);
  } finally { await S.close(); await gw.hub.close(); await gw.close(); }
});

test('public artifacts: a move keeps only the slug moved; the old checkout\'s others are no longer public', async () => {
  const gw = await gateway('public-move');
  gw.hub = await listHub();
  const one = standIn(P + 15, { a: { 'index.html': '<p>one a' }, b: { 'index.html': '<p>one b' } }, { root: '/srv/one' });
  const two = standIn(P + 16, { a: { 'index.html': '<p>two a' } }, { root: '/srv/two' });
  const pubGet = (route) => gw.req('GET', route, { on: 'beta', cookie: '' });
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    assert.ok((await confirmAndPublish(gw, P + 15, ['a', 'b'])).results.every((r) => r.ok));
    assert.equal(blobsOf(gw).length, 2);
    const mv = await confirmAndPublish(gw, P + 16, ['a'], { move: true });
    assert.ok(mv.page.body.includes('move it (its 1 other page from /srv/one comes down: b)'), mv.page.body);
    assert.deepEqual([mv.results[0].ok, mv.results[0].update], [true, false], 'a move is a new binding, not an update');
    assert.equal((await pubGet('/a/')).body, '<p>two a');
    assert.equal((await pubGet('/b/')).status, 401, 'the old root\'s other slug is dropped: on its project\'s host, the signed-out page');
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(gw.dir, 'state.json'), 'utf8')).public.beta.artifacts), ['a']);
    assert.deepEqual(blobsOf(gw), [crypto.createHash('sha256').update('<p>two a').digest('hex')], 'and its blobs swept');
  } finally { await one.close(); await two.close(); await gw.hub.close(); await gw.close(); }
});

// The review's repro: the owner publishes hello at T1, main moves on, and something on the box has
// the kit write a publish line for an artifact the owner never published. The route can't tell who
// is asking (a dashboard's owner actions never could), so the line lands; what matters is what it
// leads to on a new box, where the gateway holds no copy of anything.
test('public artifacts: on a new box a forged record leads to an unticked, explained item, never a silent publish', async () => {
  const WEEKLY = { 'index.html': '<p>weekly', 'raw-export.json': '{"secret":1}', 'artifact.json': JSON.stringify({ v: 1, title: 'Weekly', summary: 'Numbers', by: 'supervisor' }) };
  const A = landedProject(fs.mkdtempSync(path.join(tmp, 'pub-')), 'alpha', { hello: HELLO, weekly: WEEKLY });
  const treeOf = (slug) => execFileSync('git', ['rev-parse', `main:docs/devteam/project/artifacts/${slug}`], { cwd: A, encoding: 'utf8' }).trim();
  const hub = await listHub();
  hub.names.set(P + 24, { name: 'alpha', root: A });
  const kitA = startKit(A, P + 24);
  const first = await gateway('public-repro-first');
  first.hub = hub;
  let box = null;
  try {
    await kitUp(P + 24);
    assert.equal((await first.claim(authenticator())).status, 200);
    const T1 = treeOf('hello');
    assert.ok((await confirmAndPublish(first, P + 24, ['hello'])).results[0].ok);
    // main moves on: the box that holds T1 can say what changed, and ticks it
    fs.writeFileSync(path.join(A, 'docs/devteam/project/artifacts/hello/index.html'), '<p>changed');
    fs.writeFileSync(path.join(A, 'docs/devteam/project/artifacts/hello/extra.txt'), 'more');
    execFileSync('git', ['add', '-A'], { cwd: A });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'main moves on'], { cwd: A });
    const T2 = treeOf('hello');
    assert.notEqual(T2, T1);
    hub.only(P + 24);
    const held = await first.req('GET', `/public/publish?port=${P + 24}&slug=hello`);
    assert.match(held.body, /an update/);
    assert.match(held.body, /data-slug="hello" data-manifest="[0-9a-f]{64}" checked/);
    assert.match(held.body, /1 changed, 1 new, 0 removed/);
    assert.match(held.body, /<b>changed<\/b> index\.html/);
    assert.match(held.body, /<b>new<\/b> extra\.txt/);
    await first.close();
    // a local process, as a worker could be: with no browser header it is refused (kit-324)
    const bare = await fetch(`http://127.0.0.1:${P + 24}/api/artifact-publish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'publish', slug: 'weekly', tree: treeOf('weekly') }) });
    assert.equal(bare.status, 403, 'a bare client is refused: it says no Origin and no Sec-Fetch-Site');
    // but one that forges the instance's Origin, as the gateway's own call says it, is what the route can't refuse
    const forged = await fetch(`http://127.0.0.1:${P + 24}/api/artifact-publish`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${P + 24}` }, body: JSON.stringify({ op: 'publish', slug: 'weekly', tree: treeOf('weekly') }) });
    assert.equal(forged.status, 200, 'what the route can\'t refuse');
    // a new box: the log moved, the gateway's copy didn't
    box = await gateway('public-repro-new');
    box.hub = hub;
    hub.only(P + 24);
    assert.equal((await box.claim(authenticator())).status, 200);
    const page = await box.req('GET', `/public/publish?port=${P + 24}&slug=hello&slug=weekly`);
    assert.equal(page.status, 200, page.body);
    assert.equal([...page.body.matchAll(/data-slug="[^"]+" data-manifest="[0-9a-f]{64}"/g)].length, 2);
    assert.doesNotMatch(page.body, /data-manifest="[0-9a-f]{64}" checked/, 'nothing goes up without a tick');
    assert.doesNotMatch(page.body, /restore/i, 'what goes up is main\'s version, so it is not a restore');
    assert.ok(page.body.includes(`at tree ${T1.slice(0, 12)}. This is tree ${T2.slice(0, 12)}, what main holds now, so it is not that version`), 'hello says it is not what was published');
    assert.match(page.body, /published on \d{4}-\d{2}-\d{2} at this same version; a log can be forged/, 'a record that matches isn\'t taken as proof');
    assert.match(page.body, /<div>raw-export\.json <small>/, 'the file nobody meant to publish is named');
    assert.ok(page.body.includes(`from the checkout ${esc(fs.realpathSync(A))}, as this instance reports it`));
    for (const s of ['hello', 'weekly']) assert.equal((await box.req('GET', `/${s}/`, { on: 'alpha', cookie: '' })).status, 401, `${s} isn't public until the owner ticks it: on its project's host, the signed-out page`);
    // the Library has the two trees to compare
    const env = { ...process.env };
    delete env.DEVTEAM_ROLE;
    const lib = JSON.parse(execFileSync(process.execPath, [path.join(A, 'docs/devteam/scripts/devteam.mjs'), 'dashboard-data'], { cwd: A, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).library;
    const row = lib.artifacts.find((a) => a.slug === 'hello' && a.at === 'main');
    assert.deepEqual([row.published.tree, row.tree], [T1, T2]);
  } finally { await kitA.stop(); await first.close().catch(() => {}); await box?.close(); await hub.close(); }
});

test('public artifacts: unpublish takes a page down, and records it only where that project is', async () => {
  const gw = await gateway('public-down');
  gw.hub = await listHub();
  const S = standIn(P + 15, { a: { 'index.html': '<p>a' }, b: { 'index.html': '<p>b' }, d: { 'index.html': '<p>d' } });
  const other = standIn(P + 16, {}, { root: '/srv/elsewhere' });
  const pubStatus = async (route) => (await gw.req('GET', route, { on: 'beta', cookie: '' })).status;
  const down = (body, opts = {}) => gw.req('POST', '/public/unpublish', { body, ...opts });
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    for (const s of ['a', 'b']) assert.ok((await confirmAndPublish(gw, P + 15, [s])).results[0].ok);
    // the confirm page names it from the gateway's own state
    const pg = await gw.req('GET', `/public/unpublish?port=${P + 15}&project=beta&slug=a`);
    assert.equal(pg.status, 200);
    assert.match(pg.body, /The a/);
    assert.ok(pg.body.includes(`${gw.inst('beta')}/a/`));
    assert.equal((await gw.req('GET', `/public/unpublish?port=${P + 15}&slug=a`)).status, 200, 'the project from the port it was last seen on');
    assert.equal((await gw.req('GET', '/public/unpublish?project=beta&slug=zzz')).status, 404);
    assert.equal((await gw.req('GET', `/public/unpublish?project=beta&slug=a`, { cookie: '' })).status, 401);
    assert.equal((await down({ project: 'beta', slug: 'a', port: P + 15 }, { headers: { origin: gw.inst('beta') } })).status, 403, 'not from an instance\'s name');
    assert.equal((await down({ project: 'beta', slug: 'a' }, { cookie: '' })).status, 401);
    let r = await down({ project: 'beta', slug: 'a', port: P + 15 });
    assert.deepEqual([r.status, r.json.recorded], [200, true], r.body);
    assert.deepEqual([S.recorded.at(-1).op, S.recorded.at(-1).slug, S.recorded.at(-1).headers.origin], ['unpublish', 'a', `http://127.0.0.1:${P + 15}`]);
    assert.equal(await pubStatus('/a/'), 401, 'down: on its project\'s host, the signed-out page');
    assert.equal(await pubStatus('/a'), 401, 'no redirect once it is down');
    assert.equal((await down({ project: 'beta', slug: 'a', port: P + 15 })).status, 404, 'once');
    const pubState = () => JSON.parse(fs.readFileSync(path.join(gw.dir, 'state.json'), 'utf8')).public;
    assert.deepEqual(blobsOf(gw), [...new Set(Object.values(pubState().beta.artifacts).flatMap((x) => Object.values(x.files).map((f) => f.sha256)))].sort(), 'its blobs are gone');
    // an instance that isn't beta at /srv/beta: the page comes down, the record isn't written there
    r = await down({ project: 'beta', slug: 'b', port: P + 16 });
    assert.deepEqual([r.status, r.json.recorded], [200, false]);
    assert.match(r.json.note, /instance \d+ is not beta at \/srv\/beta, so the record wasn't written there; the Library's Forget clears it/);
    assert.equal(other.recorded.length, 0);
    assert.equal(await pubStatus('/b/'), 401);
    assert.equal(pubState().beta.root, '/srv/beta', 'the project stays bound to its checkout');
    // the gateway's list
    assert.ok((await confirmAndPublish(gw, P + 15, ['d'])).results[0].ok);
    const list = await gw.req('GET', '/public/');
    assert.equal(list.status, 200);
    assert.ok(list.body.includes(`${gw.inst('beta')}/d/`));
    assert.ok(list.body.includes('/public/unpublish?project=beta&#38;slug=d'));
    assert.ok(!list.body.includes(`${gw.inst('beta')}/a/`));
    r = await down({ project: 'beta', slug: 'd' });
    assert.deepEqual([r.json.recorded, r.json.note], [false, 'no instance was named, so the record wasn\'t written; the Library\'s Forget clears it']);
    // an unpublish racing a publish leaves no dangling blob and no missing one
    assert.ok((await confirmAndPublish(gw, P + 15, ['d'])).results[0].ok);
    await Promise.all([confirmAndPublish(gw, P + 15, ['a']), down({ project: 'beta', slug: 'd' })]);
    const want = [...new Set(Object.values(pubState().beta.artifacts).flatMap((x) => Object.values(x.files).map((f) => f.sha256)))].sort();
    assert.deepEqual(blobsOf(gw), want);
    assert.deepEqual([await pubStatus('/a/'), await pubStatus('/d/')], [200, 401]);
  } finally { await S.close(); await other.close(); await gw.hub.close(); await gw.close(); }
});

test('public artifacts: a slow instance holds up no other change, and its item runs out of time', async () => {
  const gw = await gateway('public-slow', { publicItemMs: 1500, publicDeadlineMs: 10000 });
  gw.hub = await listHub();
  const S = standIn(P + 22, { a: { 'index.html': 'x'.repeat(20) } });
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    seedPublic(gw.dir, 'alpha', 'other', { 'index.html': 'o' });
    S.trickle['a/index.html'] = 200; // 4 s in all, each byte well inside the per-request deadline
    gw.hub.only(P + 22);
    const page = await gw.req('GET', `/public/publish?port=${P + 22}&slug=a`);
    const items = [...page.body.matchAll(/data-slug="([^"]+)" data-manifest="([0-9a-f]{64})"/g)].map(([, slug, manifest]) => ({ slug, manifest }));
    const publishing = gw.req('POST', '/public/publish', { body: { port: P + 22, items } });
    await until(() => S.asked.includes('/artifact/main/a/index.html'), 'the slow file asked for');
    const t0 = Date.now();
    const r = await gw.req('POST', '/public/unpublish', { body: { project: 'alpha', slug: 'other' } });
    const took = Date.now() - t0;
    assert.equal(r.status, 200, r.body);
    assert.ok(took < 800, `the unpublish waited ${took} ms on another instance's publish`);
    assert.equal((await gw.req('GET', '/other/', { on: 'alpha', cookie: '' })).status, 401, 'down: on its project\'s host, the signed-out page');
    const done = await publishing;
    assert.match(done.json.results[0].error, /took over 1\.5 s for this item; nothing was published/);
    assert.ok(Date.now() - t0 < 3000, 'refused by the item\'s budget, not after the whole trickle');
    assert.equal(S.recorded.length, 0);
    assert.deepEqual(blobsOf(gw), []);
  } finally { await S.close(); await gw.hub.close(); await gw.close(); }
});

test('DEVTEAM_PUBLIC_MAX: anything but a positive number of bytes stops the gateway at startup', async () => {
  const make = (extra) => G.createGateway({ publicUrl: 'http://box.localhost:1', dir: fs.mkdtempSync(path.join(tmp, 'pmax-')), log: () => {}, ...extra });
  for (const v of ['abc', '0', '-5', 'Infinity', '', 'NaN']) assert.throws(() => make({ publicMax: v }), /DEVTEAM_PUBLIC_MAX must be a positive number of bytes/, JSON.stringify(v));
  process.env.DEVTEAM_PUBLIC_MAX = 'lots';
  try { assert.throws(() => make({}), /DEVTEAM_PUBLIC_MAX must be a positive number of bytes/, 'from the environment too'); } finally { delete process.env.DEVTEAM_PUBLIC_MAX; }
  make({});
  const gw = await gateway('public-max1', { publicMax: '1' });
  gw.hub = await listHub();
  const S = standIn(P + 23, { a: { 'index.html': '<p>a' } });
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    const { results } = await confirmAndPublish(gw, P + 23, ['a']);
    assert.match(results[0].error, /over the box's public cap of 1 bytes/);
    assert.deepEqual(blobsOf(gw), []);
  } finally { await S.close(); await gw.hub.close(); await gw.close(); }
});

test('public artifacts: "move it" moves from the root the page showed, and says what comes down', async () => {
  const gw = await gateway('public-rebind');
  gw.hub = await listHub();
  const one = standIn(P + 18, { a: { 'index.html': '<p>one' }, m2: { 'index.html': '<p>m2' } }, { root: '/srv/one' });
  const two = standIn(P + 19, { a: { 'index.html': '<p>two' } }, { root: '/srv/two' });
  const three = standIn(P + 21, { a: { 'index.html': '<p>three' } }, { root: '/srv/three' });
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    assert.ok((await confirmAndPublish(gw, P + 18, ['a', 'm2'])).results.every((x) => x.ok));
    // two's page shows a move from /srv/one; before its POST, three moves the project
    const r = await confirmAndPublish(gw, P + 19, ['a'], { move: true, before: async () => { assert.ok((await confirmAndPublish(gw, P + 21, ['a'], { move: true })).results[0].ok); } });
    assert.ok(r.page.body.includes('data-moved-from="/srv/one"'), r.page.body);
    assert.ok(r.page.body.includes('move it (its 1 other page from /srv/one comes down: m2)'), r.page.body);
    assert.match(r.results[0].error, /this project moved since you looked; reload/);
    assert.equal((await gw.req('GET', '/a/', { on: 'beta', cookie: '' })).body, '<p>three');
    assert.equal(two.recorded.length, 0);
  } finally { await one.close(); await two.close(); await three.close(); await gw.hub.close(); await gw.close(); }
});

test('public artifacts: a sweep that fails after an unpublish still takes the page down', async () => {
  const gw = await gateway('public-sweepfail');
  gw.hub = await listHub();
  const S = standIn(P + 15, { a: { 'index.html': '<p>a' } });
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    assert.ok((await confirmAndPublish(gw, P + 15, ['a'])).results[0].ok);
    // a name in the blob folder the sweep can't remove
    fs.mkdirSync(path.join(gw.dir, 'public', 'blobs', 'stuck'));
    const r = await gw.req('POST', '/public/unpublish', { body: { project: 'beta', slug: 'a', port: P + 15 } });
    assert.deepEqual([r.status, r.json?.ok, r.json?.recorded], [200, true, true], r.body);
    assert.equal(S.recorded.at(-1).op, 'unpublish');
    assert.equal((await gw.req('GET', '/a/', { on: 'beta', cookie: '' })).status, 401, 'down: on its project\'s host, the signed-out page');
  } finally { await S.close(); await gw.hub.close(); await gw.close(); }
});

test('public artifacts: the gateway\'s /public pages load only as a document, never in another site\'s frame', async () => {
  const gw = await gateway('public-frame');
  gw.hub = await listHub();
  const S = standIn(P + 15, { a: { 'index.html': '<p>a' } });
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    assert.ok((await confirmAndPublish(gw, P + 15, ['a'])).results[0].ok);
    S.asked.length = 0;
    const framed = { 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site' };
    for (const at of [`/public/publish?port=${P + 15}&slug=a`, '/public/unpublish?project=beta&slug=a', '/public/', '/public']) {
      assert.equal((await gw.req('GET', at, { headers: framed })).status, 403, at);
      assert.equal((await gw.req('GET', at, { headers: { ...framed, 'sec-fetch-dest': 'document' } })).status, 200, `${at} as a page`);
    }
    assert.equal(S.asked.filter((u) => u.startsWith('/public-manifest/')).length, 1, 'a frame made the gateway ask the instance nothing');
  } finally { await S.close(); await gw.hub.close(); await gw.close(); }
});

test('x-devteam-public: a dashboard learns what the box serves, from the gateway alone', async () => {
  const gw = await gateway('public-header');
  gw.hub = await listHub([{ devteam: 1, name: 'alpha', root: '/srv/alpha', port: P + 17 }]);
  const up = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'x-devteam-public': '{"forged":1}' }); res.end('{}'); }).listen(P + 17, '127.0.0.1');
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    seedPublic(gw.dir, 'alpha', 'hello', { 'index.html': 'x' }, { root: '/srv/alpha', port: P + 17 });
    seedPublic(gw.dir, 'zeta', 'z', { 'index.html': 'z' }, { root: '/srv/zéta', port: P + 3 });
    let r = await gw.req('GET', '/api/data', { on: 'alpha' });
    assert.equal(r.status, 200);
    assert.match(r.headers['x-devteam-public'], /^[\x20-\x7e]+$/, 'ASCII, whatever a root holds');
    assert.deepEqual(JSON.parse(r.headers['x-devteam-public']), { alpha: { port: P + 17, root: '/srv/alpha', artifacts: { hello: 'a'.repeat(40) } }, zeta: { port: P + 3, root: '/srv/zéta', artifacts: { z: 'a'.repeat(40) } } });
    assert.equal((await gw.req('GET', '/api/fleet', { on: 'alpha' })).headers['x-devteam-public'], undefined, 'an upstream\'s own copy is dropped');
    assert.equal((await gw.req('GET', '/api/data', { on: 'alpha', cookie: '' })).status, 401, 'signed in only');
    // past 32 KB, only the asking instance's own projects
    for (let i = 0; i < 200; i++) seedPublic(gw.dir, `p${i}`, 'x', { 'index.html': `${i}` }, { root: `/srv/${'r'.repeat(200)}${i}`, port: P + 20 });
    r = await gw.req('GET', '/api/data', { on: 'alpha' });
    assert.deepEqual(Object.keys(JSON.parse(r.headers['x-devteam-public'])), ['alpha']);
  } finally { await new Promise((res) => up.close(res)); await gw.hub.close(); await gw.close(); }
});

// --- files dropped on the terminal --------------------------------------------------------------
// As the terminal's page sends one: chunks given are sent chunked, with no length declared.
const upload = (gw, name, body, { origin = gw.term, cookie = gw.jar(), chunks = null } = {}) => new Promise((resolve, reject) => {
  const headers = { host: new URL(gw.term).host, 'content-type': 'application/octet-stream', ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}), ...(chunks ? {} : { 'content-length': body.length }) };
  const r = http.request({ host: '127.0.0.1', port: gw.port, method: 'POST', path: `/upload?name=${encodeURIComponent(name)}`, headers }, (res) => {
    let b = '';
    res.on('data', (c) => { b += c; });
    res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch {} resolve({ status: res.statusCode, headers: res.headers, body: b, json }); });
  });
  r.on('error', reject);
  if (chunks) { for (const c of chunks) r.write(c); r.end(); } else r.end(body);
});
const signedIn = async (name, extra) => { const gw = await gateway(name, extra); await gw.claim(authenticator()); return gw; };
const folders = (gw) => fs.readdirSync(gw.uploadsDir);

test('a dropped file: stored with a session and the terminal\'s Origin, readable, and named plainly', async () => {
  const gw = await signedIn('up-ok');
  try {
    const bytes = crypto.randomBytes(70000);
    const r = await upload(gw, 'Holiday Photo (1).PNG', bytes);
    assert.equal(r.status, 200, r.body);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(r.json.path, /\/\d{4}-\d{2}-\d{2}-[0-9a-f]{24}\/Holiday-Photo-1\.png$/);
    assert.equal(path.dirname(path.dirname(r.json.path)), gw.uploadsDir);
    assert.equal(r.json.size, bytes.length);
    assert.deepEqual(fs.readFileSync(r.json.path), bytes);
    assert.equal(fs.statSync(r.json.path).mode & 0o777, 0o640, 'readable by the group, written by nobody else');
    assert.equal(fs.statSync(path.dirname(r.json.path)).mode & 0o777, 0o750);
    assert.deepEqual(fs.readdirSync(path.dirname(r.json.path)), ['Holiday-Photo-1.png'], 'no temporary name left');
    assert.equal(G.dropPaste([r.json.path]), r.json.path, 'its path needs no quoting');
    const empty = await upload(gw, 'empty.txt', Buffer.alloc(0));
    assert.equal(empty.status, 200, empty.body);
    assert.equal(fs.statSync(empty.json.path).size, 0);
  } finally { await gw.close(); }
});

test('a dropped file: refused without a session, and from any page but the terminal\'s', async () => {
  const gw = await signedIn('up-auth');
  try {
    const bytes = Buffer.from('nope');
    assert.equal((await upload(gw, 'a.txt', bytes, { cookie: '' })).status, 401, 'no session');
    assert.equal((await upload(gw, 'a.txt', bytes, { cookie: 'devteam_session=AAAA' })).status, 401, 'a made-up session');
    assert.equal((await upload(gw, 'a.txt', bytes, { origin: gw.inst(P) })).status, 403, 'an agent\'s page on an instance name, with the owner\'s cookie');
    assert.equal((await upload(gw, 'a.txt', bytes, { origin: gw.publicUrl })).status, 403, 'the box\'s own name is not the terminal');
    assert.equal((await upload(gw, 'a.txt', bytes, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await upload(gw, 'a.txt', bytes, { origin: null })).status, 403, 'no Origin at all');
    assert.deepEqual(folders(gw), [], 'nothing was stored');
    const get = await gw.req('GET', '/upload', { on: 'term' });
    assert.equal(get.status, 404, 'and nothing reads one back');
  } finally { await gw.close(); }
});

test('a dropped file: a hostile name stays in its folder and comes out plain', async () => {
  const cases = {
    '../../etc/passwd': 'passwd', '..\\..\\windows\\system.ini': 'system.ini', '..': 'file', '.': 'file', '': 'file', '.bashrc': 'bashrc', '/': 'file',
    'a\u0000b\n\r\u001b[31m.PNG': 'ab-31m.png', '$(rm -rf ~).txt': 'rm--rf.txt', '`id`;x\'y".pdf': 'id-x-y.pdf', '--help.txt': 'help.txt',
    'café ‮evil.JPG': 'cafe-evil.jpg', '日本語.png': 'file.png', 'archive.tar.GZ': 'archive.tar.gz', 'no-extension': 'no-extension', 'dots....': 'dots', 'x.has spaces in ext': 'x.has-spaces-in-ext',
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(G.safeUploadName(raw), want, JSON.stringify(raw));
  const long = G.safeUploadName(`${'a'.repeat(5000)}.png`);
  assert.ok(long.length <= 204 && long.endsWith('.png'), long);
  for (const raw of [...Object.keys(cases), '\ud800.png']) assert.match(G.safeUploadName(raw), /^[A-Za-z0-9][A-Za-z0-9._-]*$/, JSON.stringify(raw));
  const gw = await signedIn('up-name');
  try {
    for (const raw of ['../../../../tmp/owned', '..%2f..%2fowned', '/etc/cron.d/x']) {
      const r = await upload(gw, raw, Buffer.from('x'));
      assert.equal(r.status, 200, r.body);
      assert.equal(path.dirname(path.dirname(r.json.path)), gw.uploadsDir, r.json.path);
      assert.equal(path.resolve(r.json.path), r.json.path);
    }
    assert.ok(folders(gw).every((f) => /^\d{4}-\d{2}-\d{2}-[0-9a-f]{24}$/.test(f)), folders(gw).join());
  } finally { await gw.close(); }
});

test('a dropped file: over a limit is refused, with nothing left behind', async () => {
  const gw = await signedIn('up-cap', { uploadMax: 1024 });
  try {
    const declared = await upload(gw, 'big.bin', Buffer.alloc(2048));
    assert.equal(declared.status, 413, 'a declared length over the limit');
    assert.deepEqual(folders(gw), []);
    const streamed = await upload(gw, 'big.bin', null, { chunks: [Buffer.alloc(800), Buffer.alloc(800)] });
    assert.equal(streamed.status, 413, 'a body that goes over it with no length declared');
    assert.equal(streamed.headers.connection, 'close');
    assert.deepEqual(folders(gw), [], 'the partial file is gone');
    const atLimit = await upload(gw, 'ok.bin', Buffer.alloc(1024));
    assert.equal(atLimit.status, 200, atLimit.body);
  } finally { await gw.close(); }
  const full = await signedIn('up-total', { uploadTotal: 100 });
  try {
    assert.equal((await upload(full, 'a.bin', Buffer.alloc(80))).status, 200);
    assert.equal((await upload(full, 'b.bin', Buffer.alloc(30))).status, 507, 'over the total kept');
    assert.equal(folders(full).length, 1);
  } finally { await full.close(); }
  const disk = await signedIn('up-disk', { uploadFree: Number.MAX_SAFE_INTEGER });
  try {
    assert.equal((await upload(disk, 'a.bin', Buffer.alloc(10))).status, 507, 'not enough free disk');
    assert.deepEqual(folders(disk), []);
  } finally { await disk.close(); }
});

test('a dropped file: one cut off midway leaves nothing, and a stalled one is cut off', async () => {
  const gone = async (gw) => { for (let i = 0; i < 100 && folders(gw).length; i++) await new Promise((r) => setTimeout(r, 20)); assert.deepEqual(folders(gw), []); };
  const start = (gw) => new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: gw.port, method: 'POST', path: '/upload?name=a.bin', headers: { host: new URL(gw.term).host, origin: gw.term, cookie: gw.jar(), 'content-length': 1000 } });
    r.on('error', () => {});
    r.on('close', () => resolve({ closed: true }));
    r.write(Buffer.alloc(100));
    // it has begun when its folder shows, so what's checked after is the clean-up
    const seen = setInterval(() => { if (folders(gw).length) { clearInterval(seen); resolve({ r }); } }, 5);
  });
  const cut = await signedIn('up-abort');
  try {
    const { r } = await start(cut);
    r.destroy();
    await gone(cut);
  } finally { await cut.close(); }
  const stalled = await signedIn('up-stall', { uploadStallMs: 50 });
  try {
    await start(stalled);
    await gone(stalled);
  } finally { await stalled.close(); }
});

test('dropped files: the root must be the gateway\'s own; old ones go, and only ours', async () => {
  const real = path.join(tmp, 'up-real');
  fs.mkdirSync(real);
  const link = path.join(tmp, 'up-link');
  fs.symlinkSync(real, link);
  const linked = await signedIn('up-symlink', { uploadsDir: link });
  try {
    assert.equal((await upload(linked, 'a.txt', Buffer.from('x'))).status, 503, 'a symlink in the root\'s place is not followed');
    assert.deepEqual(fs.readdirSync(real), []);
  } finally { await linked.close(); }
  const open = path.join(tmp, 'up-open');
  fs.mkdirSync(open);
  fs.chmodSync(open, 0o777);
  const loose = await signedIn('up-loose', { uploadsDir: open });
  try { assert.equal((await upload(loose, 'a.txt', Buffer.from('x'))).status, 503, 'nor a root others can write'); } finally { await loose.close(); }

  const gw = await signedIn('up-sweep');
  try {
    // what a restart cut off, an empty one, and things that aren't ours to remove
    const dead = path.join(gw.uploadsDir, '2020-01-01-aaaaaaaaaaaaaaaaaaaaaaaa');
    fs.mkdirSync(dead);
    fs.writeFileSync(path.join(dead, '.part'), 'half');
    const empty = path.join(gw.uploadsDir, '2020-01-02-bbbbbbbbbbbbbbbbbbbbbbbb');
    fs.mkdirSync(empty);
    const victim = path.join(tmp, 'up-victim');
    fs.mkdirSync(victim);
    fs.writeFileSync(path.join(victim, 'keep'), 'keep');
    fs.symlinkSync(victim, path.join(gw.uploadsDir, '2020-01-03-cccccccccccccccccccccccc'));
    fs.mkdirSync(path.join(gw.uploadsDir, 'lost+found'));
    const r = await upload(gw, 'a.txt', Buffer.from('x'));
    assert.equal(r.status, 200, r.body);
    assert.ok(!fs.existsSync(dead) && !fs.existsSync(empty), 'what a restart cut off is cleared');
    await gw.g.sweepUploads();
    assert.ok(fs.existsSync(r.json.path), 'a recent one stays');
    await gw.g.sweepUploads(Date.now() + 8 * 24 * 3600 * 1000);
    assert.ok(!fs.existsSync(r.json.path), 'an old one goes');
    assert.deepEqual(folders(gw).sort(), ['2020-01-03-cccccccccccccccccccccccc', 'lost+found'], 'and nothing that isn\'t one of ours');
    assert.ok(fs.existsSync(path.join(victim, 'keep')));
    assert.equal((await upload(gw, 'b.txt', Buffer.from('y'))).status, 200, 'what it freed counts');
  } finally { await gw.close(); }
});

// ⌘⌥←/→ (Ctrl+Alt+←/→ off a Mac) in the terminal type Ctrl+Alt+Shift+←/→, which the box's tmux binds to
// the previous and next window; any other chord passes through untouched.
test('the terminal\'s page sends ⌘⌥←/→ to tmux as previous and next window', async () => {
  const gw = await signedIn('keys-page');
  try {
    const tp = await gw.req('GET', '/', { on: 'term' });
    assert.equal(tp.status, 200);
    const keys = [...tp.body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((x) => x.includes("addEventListener('keydown'") && x.includes('1;8D'));
    assert.ok(keys, 'the page carries the key handler');
    const run = (platform) => {
      let on = null;
      const typed = [];
      const win = { term: { input: (d) => typed.push(d) } };
      new Function('addEventListener', 'navigator', 'window', keys)((ev, f) => { if (ev === 'keydown') on = f; }, { platform }, win);
      // caught means both: preventDefault for the browser, and stopPropagation for xterm, whose own
      // keydown listener on its textarea never reads defaultPrevented and would type the chord too
      const press = (key, mods) => {
        let prevented = false, stopped = false;
        on({ key, altKey: false, shiftKey: false, metaKey: false, ctrlKey: false, ...mods, preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
        assert.equal(prevented, stopped, `${key} ${JSON.stringify(mods)}: caught means both preventDefault and stopPropagation`);
        return prevented;
      };
      return { typed, press };
    };
    const mac = run('MacIntel');
    assert.ok(mac.press('ArrowLeft', { metaKey: true, altKey: true }));
    assert.ok(mac.press('ArrowRight', { metaKey: true, altKey: true }));
    assert.deepEqual(mac.typed, ['\x1b[1;8D', '\x1b[1;8C'], 'previous, then next window');
    assert.ok(!mac.press('ArrowLeft', { altKey: true }), '⌥← alone is word movement, left to the shell');
    assert.ok(!mac.press('ArrowLeft', { metaKey: true }), '⌘← alone passes through');
    assert.ok(!mac.press('ArrowLeft', { metaKey: true, altKey: true, shiftKey: true }), 'with Shift too, not ours');
    assert.ok(!mac.press('ArrowLeft', { ctrlKey: true, metaKey: true, altKey: true }), '⌃⌘⌥← on a Mac is not ours');
    assert.ok(!mac.press('ArrowLeft', { ctrlKey: true, altKey: true }), 'Ctrl+Alt on a Mac is not ours');
    assert.equal(mac.typed.length, 2);
    const pc = run('Linux x86_64');
    assert.ok(pc.press('ArrowRight', { ctrlKey: true, altKey: true }));
    assert.ok(!pc.press('ArrowRight', { metaKey: true, altKey: true }));
    assert.ok(!pc.press('ArrowRight', { ctrlKey: true, metaKey: true, altKey: true }), 'Ctrl with ⌘ off a Mac is not ours');
    assert.ok(!pc.press('ArrowRight', { ctrlKey: true }), 'Ctrl+→ alone is word movement');
    assert.deepEqual(pc.typed, ['\x1b[1;8C']);
  } finally { await gw.close(); }
});

// the tmux half: the box's .tmux.conf seeding binds both chords, each line on its own guard, so a
// conf that has one of them gets the other and neither twice
test('the box seeds tmux with Ctrl+Alt+Shift+←/→ as previous and next window', () => {
  const lines = fs.readFileSync(path.join(here, '..', 'cloud', 'Dockerfile'), 'utf8').split('\n').filter((l) => /^grep -q 'C-M-S-(Left|Right)' \.tmux\.conf \|\| /.test(l));
  assert.equal(lines.length, 2, 'one seeding line per chord');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmux-keys-'));
  try {
    const conf = path.join(dir, '.tmux.conf');
    const seed = () => execFileSync('sh', ['-c', lines.join('\n')], { cwd: dir, timeout: 10000 });
    fs.writeFileSync(conf, '');
    seed();
    assert.equal(fs.readFileSync(conf, 'utf8'), 'bind -n C-M-S-Left previous-window\nbind -n C-M-S-Right next-window\n');
    seed();
    assert.equal(fs.readFileSync(conf, 'utf8').split('\n').filter(Boolean).length, 2, 'seeding again adds nothing');
    fs.writeFileSync(conf, 'bind -n C-M-S-Left previous-window\n');
    seed();
    assert.equal(fs.readFileSync(conf, 'utf8'), 'bind -n C-M-S-Left previous-window\nbind -n C-M-S-Right next-window\n', 'a conf with only Left still gets Right');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A phone has no wheel: the terminal's page turns a one-finger swipe into the wheel events xterm
// passes to tmux, which scrolls; a two-finger touch is left alone.
test('the terminal\'s page turns a swipe into wheel events on the terminal', async () => {
  const gw = await signedIn('touch-page');
  try {
    const tp = await gw.req('GET', '/', { on: 'term' });
    assert.equal(tp.status, 200);
    const all = [...tp.body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const touch = all.find((x) => x.includes("addEventListener('touchmove'"));
    assert.ok(touch, 'the page carries the swipe handler');
    const on = {};
    const wheels = [];
    const screen = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 600, bottom: 600 }), dispatchEvent: (e) => wheels.push(e) };
    class WheelEvent { constructor(type, o) { Object.assign(this, o, { type }); } }
    new Function('addEventListener', 'document', 'WheelEvent', touch)((ev, f) => { on[ev] = f; }, { querySelector: (q) => (q === '.xterm-screen' ? screen : null) }, WheelEvent);
    let prevented = 0;
    const touches = (...ys) => ({ touches: ys.map((clientY) => ({ clientY })), preventDefault: () => { prevented++; } });
    on.touchstart(touches(400));
    on.touchmove(touches(300));
    assert.ok(wheels.length >= 5, `a 100px swipe up is several wheel steps (${wheels.length})`);
    assert.ok(wheels.every((w) => w.type === 'wheel' && w.deltaY > 0), 'a finger moving up is wheel-down: toward newer output');
    assert.ok(prevented > 0, 'the page itself does not scroll');
    on.touchend();
    // a finger moving down is wheel-up (older output), and a swipe ending on the bottom row, tmux's
    // status bar, still scrolls where it touched down, never on the bar (a wheel there switches windows)
    wheels.length = 0;
    on.touchstart(touches(300));
    on.touchmove(touches(599));
    on.touchend();
    assert.ok(wheels.length >= 5 && wheels.every((w) => w.deltaY < 0), 'a finger moving down scrolls back');
    assert.ok(wheels.every((w) => w.clientY === 300), 'every step where the finger touched down');
    wheels.length = 0;
    on.touchstart(touches(599));
    on.touchmove(touches(450));
    assert.ok(wheels.length && wheels.every((w) => w.clientY <= 600 - 40), 'a swipe starting on the bar is kept off its rows');
    on.touchend();
    const before = wheels.length;
    on.touchstart(touches(100, 200));
    on.touchmove(touches(300, 400));
    assert.equal(wheels.length, before, 'two fingers are left alone (pinch, select)');
  } finally { await gw.close(); }
});

test('the terminal\'s page takes a drop, and pastes what a shell reads back unchanged', async () => {
  const hostile = ['/data/uploads/d/plain-name_1.png', '/a b/c', 'it\'s', '$(id)', '`id`', 'a"b', 'back\\slash', '-x', 'é'];
  for (const s of hostile) assert.equal(execFileSync('sh', ['-c', `printf %s ${G.shellQuote(s)}`], { encoding: 'utf8' }), s);
  assert.equal(G.shellQuote('/data/uploads/2026-11-09-abc/report.pdf'), '/data/uploads/2026-11-09-abc/report.pdf', 'a stored path is left as it is');
  assert.equal(G.dropPaste(['/x/a.png', '/x/b.pdf']), '/x/a.png /x/b.pdf');
  assert.equal(G.dropSpace(['/x/a.png', '/x/b.JPEG']), false, 'images alone become attachments: nothing to separate');
  assert.equal(G.dropSpace(['/x/a.png', '/x/b.pdf']), true);
  const gw = await signedIn('up-page');
  try {
    const tp = await gw.req('GET', '/', { on: 'term' });
    assert.equal(tp.status, 200);
    for (const piece of ["addEventListener('dragover'", "addEventListener('drop'", 'devteam-drop-veil', 'upload.onprogress', "x.open('POST', '/upload?name='", 'window.term.paste(dropPaste(paths))', 'readyState === 1', 'terminal not connected: stored at ', 'createImageBitmap', G.shellQuote.toString(), G.dropPaste.toString(), G.dropSpace.toString(), G.isDropImage.toString(), G.dropNote.toString()]) assert.ok(tp.body.includes(piece), piece);
    assert.ok(!/\.send\(.*(?:\\r|Enter)/.test(tp.body), 'it never presses Enter');
    const script = tp.body.slice(tp.body.lastIndexOf('<script>') + 8, tp.body.lastIndexOf('</script>'));
    assert.doesNotThrow(() => new Function(script), 'and what it serves parses');
    assert.ok(!tp.body.includes('devteamTermSocket = live'), 'a page with no <head> is left as it is');
    // ttyd's own page opens its socket from its bundle: the watcher has to be there first
    fs.writeFileSync(path.join(tmp, 'up-page-ttyd.html'), '<!DOCTYPE html><html><head><title>t</title></head><body><script>BUNDLE</script></body></html>');
    const real = (await gw.req('GET', '/', { on: 'term' })).body;
    assert.ok(real.startsWith('<!DOCTYPE html><html><head><script>'), real.slice(0, 60));
    assert.ok(real.indexOf('devteamTermSocket = live') < real.indexOf('BUNDLE'));
    const made = [];
    class Fake { constructor(url) { this.url = url; this.readyState = 0; made.push(this); } addEventListener(ev, f) { this[`on${ev}`] = f; } }
    const win = { WebSocket: Fake };
    new Function('window', 'addEventListener', real.slice(real.indexOf('<script>') + 8, real.indexOf('</script>')))(win, () => {});
    const sock = new win.WebSocket('ws://x');
    assert.ok(sock instanceof Fake, 'ttyd still gets a real socket');
    assert.equal(win.devteamTermSocket.socket, sock);
    assert.equal(win.devteamTermSocket.at, 0, 'not live until it opens');
    sock.onopen();
    assert.ok(win.devteamTermSocket.at > 0);
  } finally { await gw.close(); }
});

test('an open terminal tab takes the new page after a deploy, and the page is never cached', async () => {
  const gw = await signedIn('up-build');
  try {
    const ttyd = path.join(tmp, 'up-build-ttyd.html');
    fs.writeFileSync(ttyd, '<!DOCTYPE html><html><head><title>t</title></head><body>one</body></html>');
    const page = await gw.req('GET', '/', { on: 'term' });
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.ok(!page.body.includes('@@BUILD@@'));
    const first = (await gw.req('GET', '/build', { on: 'term' })).json.build;
    assert.ok(page.body.includes(`const BUILD = '${first}'`), 'the page knows which it is');
    assert.equal((await gw.req('GET', '/build', { on: 'term' })).json.build, first, 'the same page is the same build');
    assert.equal((await gw.req('GET', '/build', { on: 'term', cookie: '' })).status, 401, 'and asking takes a session');
    fs.writeFileSync(ttyd, '<!DOCTYPE html><html><head><title>t</title></head><body>two</body></html>');
    assert.notEqual((await gw.req('GET', '/build', { on: 'term' })).json.build, first, 'a new page is a new build');
    const body = page.body;
    const source = body.slice(body.indexOf('<script>') + 8, body.indexOf('</script>'));
    const tick = () => new Promise((r) => setImmediate(r));
    const tab = (answer) => {
      class Sock { addEventListener(ev, f) { this[`on${ev}`] = f; } }
      const store = new Map();
      const unload = [];
      const t = { asked: 0, reloads: 0, answer, unload, win: { WebSocket: Sock } };
      const fetchBuild = async () => { t.asked++; return t.answer(); };
      const later = (f) => { t.retry = f; };
      new Function('window', 'addEventListener', 'fetch', 'sessionStorage', 'location', 'setTimeout', source)(t.win, (ev, f) => { if (ev === 'beforeunload') unload.push(f); }, fetchBuild, { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, { reload: () => { t.reloads++; } }, later);
      t.sock = new t.win.WebSocket('ws://x');
      return t;
    };
    const says = (build) => () => ({ ok: true, status: 200, json: async () => ({ build }) });
    const fresh = tab(says('other'));
    fresh.sock.onopen();
    await tick();
    assert.equal(fresh.asked, 0, 'a page just loaded has nothing to check');
    fresh.sock.onopen();
    await tick();
    assert.equal(fresh.reloads, 1, 'a reconnect to a new build loads it');
    const stopped = { stopped: 0, stopImmediatePropagation() { this.stopped++; } };
    fresh.unload[0](stopped);
    assert.equal(stopped.stopped, 1, 'without ttyd\'s leave-site prompt');
    fresh.sock.onopen();
    await tick();
    assert.equal(fresh.reloads, 1, 'and only once for a build: one that comes back old can\'t loop');
    const same = tab(says(first));
    same.sock.onopen(); same.sock.onopen();
    await tick();
    assert.equal(same.asked, 1);
    assert.equal(same.reloads, 0, 'the same build stays as it is');
    const leaving = { stopped: 0, stopImmediatePropagation() { this.stopped++; } };
    same.unload[0](leaving);
    assert.equal(leaving.stopped, 0, 'and the owner leaving is still asked');
    const out = tab(() => ({ ok: false, status: 401 }));
    out.sock.onclose();
    await tick();
    assert.equal(out.reloads, 0, 'signed out: nothing to load');
    let up = false;
    const away = tab(() => { if (!up) throw new Error('refused'); return says('other')(); });
    away.sock.onclose();
    await tick();
    assert.equal(away.reloads, 0, 'the box away: the socket closed and nothing answers');
    up = true;
    away.retry();
    await tick(); await tick();
    assert.equal(away.reloads, 1, 'it keeps asking, as ttyd stops at "press Enter"');
    const busy = tab(says('other'));
    let held = true;
    busy.win.devteamDropBusy = () => held;
    busy.sock.onclose();
    await tick();
    assert.equal(busy.reloads, 0, 'a file on its way or waiting to paste holds it back');
    held = false;
    busy.retry();
    assert.equal(busy.reloads, 1);
  } finally { await gw.close(); }
});

test('the hub refuses a drop on itself, keeps the terminal\'s sandbox, and says where to drop', () => {
  const hub = fs.readFileSync(path.join(kit, 'dashboard', 'hub.html'), 'utf8');
  for (const piece of ["window.addEventListener('dragover'", "window.addEventListener('drop'", "dropEffect = 'none'", 'Drop onto the Terminal tab']) assert.ok(hub.includes(piece), piece);
  const guard = hub.slice(hub.indexOf("window.addEventListener('dragover'"), hub.indexOf('// The hub on a laptop'));
  assert.equal((guard.match(/e\.preventDefault\(\)/g) ?? []).length, 2, 'both events, or the browser opens the file');
  assert.ok(hub.includes(`term.frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-pointer-lock');`), 'the terminal\'s frame is as tight as it was');
});

test('the note after a drop says how each kind arrives, and always names the paths', () => {
  const png = '/data/uploads/d/a.png';
  const pdf = '/data/uploads/d/b.pdf';
  assert.match(G.dropNote([png]), /images arrive as attachments\.\n\/data\/uploads\/d\/a\.png$/);
  assert.match(G.dropNote([pdf]), /PDFs and other files arrive as a path\.\n\/data\/uploads\/d\/b\.pdf$/);
  const both = G.dropNote([png, pdf]);
  assert.match(both, /images arrive as attachments, PDFs and other files as a path/);
  assert.ok(both.includes(png) && both.includes(pdf));
  assert.equal(G.isDropImage('/x/a.heic'), false, 'a HEIC that stayed one arrives as a path');
});

test('dropped files: a folder the scan can\'t handle costs only itself, and a sweep can\'t refuse a drop', async (t) => {
  const gw = await signedIn('up-scan');
  const f = (n) => path.join(gw.uploadsDir, `2020-02-0${n}-${String(n).repeat(24)}`);
  try {
    // not this user's, and left half-written: it must neither be removed nor stop the drop
    fs.mkdirSync(f(1));
    fs.writeFileSync(path.join(f(1), '.part'), 'theirs');
    // one that can't be read
    fs.mkdirSync(f(2));
    fs.writeFileSync(path.join(f(2), 'x'), 'x');
    fs.chmodSync(f(2), 0);
    // one that can't be removed
    fs.mkdirSync(f(3));
    fs.writeFileSync(path.join(f(3), '.part'), 'stuck');
    const lstat = fs.promises.lstat;
    const rm = fs.promises.rm;
    t.mock.method(fs.promises, 'lstat', async (p, ...a) => {
      const st = await lstat(p, ...a);
      if (p === f(1)) st.uid += 1;
      return st;
    });
    t.mock.method(fs.promises, 'rm', async (p, ...a) => {
      if (p === f(3)) throw Object.assign(new Error('EACCES: stuck'), { code: 'EACCES' });
      return rm(p, ...a);
    });
    const r = await upload(gw, 'a.txt', Buffer.from('x'));
    assert.equal(r.status, 200, r.body);
    assert.ok(fs.existsSync(path.join(f(1), '.part')), 'another user\'s folder is left alone');
    assert.ok(fs.existsSync(f(3)));
    assert.ok(gw.logs.some((m) => m.includes('skipping')), gw.logs.join('|'));
    // and a sweep that fails outright is housekeeping, not a refusal
    t.mock.method(fs.promises, 'readdir', async () => { throw new Error('EIO'); });
    const gw2 = await signedIn('up-scan2');
    try {
      const r2 = await upload(gw2, 'b.txt', Buffer.from('y'));
      assert.equal(r2.status, 200, r2.body);
      assert.ok(gw2.logs.some((m) => m.includes('EIO')), gw2.logs.join('|'));
    } finally { await gw2.close(); }
  } finally { t.mock.restoreAll(); fs.chmodSync(f(2), 0o750); await gw.close(); }
});

test('a body is bounded to its five minutes unless it is an upload that has passed its checks', async () => {
  const gw = await signedIn('up-body', { bodyMs: 60 });
  // sends the head and part of a body, then nothing: what happens to the connection?
  const hang = (route, headers, on = gw.term) => new Promise((resolve) => {
    let status = 0;
    const r = http.request({ host: '127.0.0.1', port: gw.port, method: 'POST', path: route, headers: { host: new URL(on).host, origin: on, 'content-length': 1000, ...headers } }, (res) => { status = res.statusCode; res.resume(); });
    const started = Date.now();
    r.on('error', () => {});
    r.on('close', () => resolve({ status, ms: Date.now() - started }));
    r.write('x');
  });
  try {
    // answered without reading the body, and read in full: both cut off
    const answered = await hang('/auth/login/options', {}, gw.auth);
    assert.ok(answered.ms < 3000, `${answered.ms} ms`);
    const reading = await hang('/auth/claim/options', {}, gw.auth);
    assert.ok(reading.ms < 3000, `${reading.ms} ms`);
    const noSession = await hang('/upload?name=a.txt', {});
    assert.equal(noSession.status, 401);
    assert.ok(noSession.ms < 3000, 'no session, no long limit');
    // the owner's slow upload outlasts the bound, and arrives
    const slow = await new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: gw.port, method: 'POST', path: '/upload?name=slow.txt', headers: { host: new URL(gw.term).host, origin: gw.term, cookie: gw.jar(), 'content-length': 2 } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
      r.on('error', reject);
      r.write('a');
      setTimeout(() => r.end('b'), 300);
    });
    assert.equal(slow.status, 200, slow.body);
    assert.equal(fs.readFileSync(JSON.parse(slow.body).path, 'utf8'), 'ab');
  } finally { await gw.close(); }
});

// --- dev links: a preview on a name of its own ---------------------------------------------------
test('previewLinks: names from the hub\'s list, checked, ambiguous when two instances claim one', () => {
  const inst = (root, port, previews) => ({ devteam: 1, root, port, name: root.split('/').pop(), previews });
  const row = (name, port, over = {}) => ({ name, port, project: 'p', session: 's', label: 'l', at: 'now', up: true, run: false, ...over });
  const ports = [P, P + 1];
  const own = 30003;
  const list = [
    inst('/a', P, [
      row('cool-tiger', 30001),
      row('cool-tiger-2', 30002),
      row('NOT-valid', 30002),
      row('blocked-port', P + 1), // the block
      row('hub-port', HUB),
      row('term-port', 7681),
      row('own-port', own),
      row('string-port', '30002'),
      row('label-long', 30002, { label: 'x'.repeat(41) }),
      row('low-port', 80),
    ]),
    inst('/b', P + 1, [row('both-have', 30004, { project: 'b', label: '' }), row('other-only', 30005, { project: 'b'.repeat(100), session: 's'.repeat(100) })]),
  ];
  // a 21st entry is dropped: 20 are kept per instance
  list[0].previews.push(row('both-have', 30006, { project: 'a' }));
  const many = [inst('/many', P, Array.from({ length: 25 }, (_, i) => row(`many-${String.fromCharCode(97 + i)}${String.fromCharCode(97 + i)}x`, 31000 + i)))];
  const m = G.previewLinks(list, ports, own);
  assert.deepEqual({ ...m.get('cool-tiger') }, { port: 30001, instance: P, root: '/a', project: 'p', session: 's', label: 'l', run: false }, 'with the port of the instance that lists it: only its dashboard may hold the lens (spec §7)');
  assert.equal(m.get('other-only').instance, P + 1);
  assert.equal(G.previewLinks([{ ...inst('/a', String(P), [row('str-port', 30001)]) }], ports, own).get('str-port').instance, P, 'a number, whatever the list wrote');
  assert.equal(m.get('cool-tiger-2').port, 30002, 'name and name-2 are two names');
  for (const bad of ['NOT-valid', 'blocked-port', 'hub-port', 'term-port', 'own-port', 'string-port', 'label-long', 'low-port']) assert.equal(m.has(bad), false, `${bad} is dropped`);
  assert.deepEqual(m.get('both-have').ambiguous.map((c) => ({ ...c })), [{ root: '/a', project: 'a', port: 30006 }, { root: '/b', project: 'b', port: 30004 }]);
  const swapped = G.previewLinks([list[1], list[0]], ports, own);
  assert.deepEqual(swapped.get('both-have').ambiguous.map((c) => c.root), ['/a', '/b'], 'whatever the roots\' order');
  // the list is agent-written: an instance that lists another's dev port under a name of its own
  // would own that name, and hold its app. A port two instances list is no one's, under every name.
  const stolen = G.previewLinks([inst('/a', P, [row('real-name', 30010), row('also-mine', 30010)]), inst('/b', P + 1, [row('evil-name', 30010)])], ports, own);
  for (const n of ['real-name', 'also-mine', 'evil-name']) assert.deepEqual(stolen.get(n).ambiguous?.map((c) => [c.root, c.port]), [['/a', 30010], ['/b', 30010]], `${n}: ambiguous`);
  const mine = G.previewLinks([inst('/a', P, [row('real-name', 30010), row('also-mine', 30010)])], ports, own);
  assert.deepEqual([mine.get('real-name').port, mine.get('also-mine').port], [30010, 30010], 'two names one instance lists for one port are both its');
  assert.equal(m.get('other-only').project.length, 63, 'strings are capped');
  assert.equal(m.get('other-only').session.length, 80);
  assert.equal(G.previewLinks(many, ports, own).size, 20, 'at most 20 per instance');
  assert.equal(G.previewLinks('nope', ports, own).size, 0, 'a list that isn\'t an array is empty');
  assert.equal(G.previewLinks([inst('/x', 99, [row('xx-yyy', 30007)])], ports, own).size, 0, 'only instances on the block');
  // a root is agent-written: two ports claiming one root don't collapse into one, and the lower can't repoint the link
  const hijack = G.previewLinks([inst('/data/home/code/acme', P + 1, [row('cool-tiger', 30008, { project: 'acme' })]), inst('/data/home/code/acme', P, [row('cool-tiger', 6666 + 30000, { project: 'evil' })])], ports, own).get('cool-tiger');
  assert.equal(hijack.port, undefined, 'never served');
  assert.deepEqual(hijack.ambiguous.map((c) => c.port).sort(), [30008, 36666], 'two ports listing one name are ambiguous, whatever root they claim');
  assert.equal(G.previewLinks([inst('/a', P, [row('one-name', 30008)]), { ...inst('/a', P, [row('one-name', 30009)]) }], ports, own).get('one-name').port, 30008, 'one port counts once: its first answer');
  // the terminal's real port, whatever it is here
  const ttydList = [inst('/a', P, [row('term-real', 7700), row('term-default', 7681)])];
  assert.equal(G.previewLinks(ttydList, ports, own, 7700).has('term-real'), false);
  assert.equal(G.previewLinks(ttydList, ports, own, 7700).has('term-default'), true, '7681 is nobody\'s when the terminal is elsewhere');
  assert.equal(G.previewLinks(ttydList, ports, own).has('term-default'), false, 'by default it is');
});

test('preview names: only the box\'s, one label, and safeNext sends sign-in back to one', async () => {
  const gw = await gateway('preview-names');
  try {
    const box = `box.localhost:${gw.port}`;
    assert.equal(gw.g.previewOf(`cool-tiger.${box}`), 'cool-tiger');
    assert.equal(gw.g.previewOf(`cool-tiger-2.${box}`), 'cool-tiger-2');
    for (const h of [`term.${box}`, `public.${box}`, `${P}.${box}`, `cooltiger.${box}`, `a-b.${box}`, `cool-tiger.other.example`, `sub.cool-tiger.${box}`, box]) assert.equal(gw.g.previewOf(h), null, h);
    assert.equal(gw.g.safeNext(`http://cool-tiger.${box}/x`), `http://cool-tiger.${box}/x`);
    assert.equal(gw.g.safeNext('https://cool-tiger.evil.example/x'), `${gw.publicUrl}/`);
    assert.equal(gw.g.safeNext(`https://${'a'.repeat(8)}-tiger.${box}/x`), `${gw.publicUrl}/`, 'not on another scheme than the box\'s');
    assert.equal(gw.g.safeNext(`http://a_b.${box}/x`), `${gw.publicUrl}/`, 'not this shape');
  } finally { await gw.close(); }
});

// A fake hub listing what the test sets, and counting its reads; a gateway claimed by an owner.
async function previewSetup(name, { hubDelay = 0 } = {}) {
  const hub = { list: [], hits: 0 };
  hub.srv = http.createServer((req, res) => { hub.hits++; setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ hub: 1, instances: hub.list })); }, hubDelay); });
  await new Promise((r) => hub.srv.listen(HUB, '127.0.0.1', r));
  const gw = await gateway(name);
  assert.equal((await gw.claim(authenticator())).status, 200);
  const instance = (root, port, previews) => ({ devteam: 1, root, port, name: root.split('/').pop(), previews });
  const box = `box.localhost:${gw.port}`;
  const on = (preview) => `${preview}.${box}`;
  const origin = (preview) => `http://${on(preview)}`;
  const req = (preview, method, route, o = {}) => gw.req(method, route, { ...o, headers: { host: on(preview), ...o.headers } });
  const close = async () => { await gw.close(); await new Promise((r) => hub.srv.close(r)); };
  return { gw, hub, instance, box, on, origin, req, close };
}
const NAV = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none', accept: 'text/html' };
const previewRow = (name, port, over = {}) => ({ name, port, project: 'alpha', session: 'api-01-x', label: 'admin', at: '2026-11-10', up: true, run: false, ...over });
// A dev server on the port the OS gives it at listen, its own ready signal: a port probed, closed and
// bound later (freePort) is anyone's in between, on a runner busy with other suites. Never a port the
// gateway refuses a preview by design (its terminal's, the hub's, the instance block).
async function devServer(srv, S, host = '127.0.0.1') {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(0, host, () => { srv.off('error', reject); resolve(); }); });
    const { port } = srv.address();
    if (port !== S.gw.ttydPort && port !== HUB && !(port >= P && port < P + 25)) return port;
    await new Promise((r) => srv.close(r));
  }
  return assert.fail(`no dev port apart from the gateway's own (terminal ${S.gw.ttydPort}, hub ${HUB}, instances ${P}..${P + 24})`);
}
// What the ports were, and what the gateway's own page of previews says, for a failure's message.
async function previewState(S, devPort) {
  const dev = await S.gw.req('GET', '/dev/');
  return `dev port ${devPort}, terminal ${S.gw.ttydPort}, hub ${HUB}, instances ${P}..${P + 24}; /dev/ ${dev.status}: ${dev.body.replace(/<(style|script)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 1500)}`;
}
// One request through the relay, after the poll, before anything is asserted: the app's own answer,
// first time, with no second read of the hub (the map is the poll's). Never retried: a 503 here is the
// failure under test, reported with the ports and the gateway's view instead of a bare status.
async function previewReady(S, name, devPort, body) {
  const hits = S.hub.hits;
  const r = await S.req(name, 'GET', '/', { headers: { 'sec-fetch-mode': 'cors', accept: '*/*' } });
  if (r.status === 200 && r.body === body && S.hub.hits === hits) return;
  assert.fail(`${name}: ${r.status} ${JSON.stringify(r.body.slice(0, 200))} (hub read ${S.hub.hits - hits} more times); ${await previewState(S, devPort)}`);
}

test('a preview: the owner reaches the dev server on its own name, with localhost headers and nothing of the owner\'s', async () => {
  const S = await previewSetup('preview-proxy');
  const { gw, hub, instance, req, origin } = S;
  const seen = [];
  let devPort = 0;
  const dev = http.createServer((q, s) => {
    seen.push({ url: q.url, method: q.method, h: q.headers });
    const headers = { 'content-type': 'text/plain', 'x-frame-options': 'DENY', 'content-security-policy': `default-src http://127.0.0.1:${devPort}; connect-src ws://localhost:${devPort}`, 'set-cookie': ['a=1; Domain=box.localhost', 'b=2', `devteam_session=evil`] };
    if (q.url === '/go') headers.location = `http://localhost:${devPort}/next`;
    if (q.url === '/healthz') return s.end('app ok');
    s.writeHead(q.url === '/go' ? 302 : 200, headers);
    s.end('hello from the app');
  });
  devPort = await devServer(dev, S);
  // an upstream instance, for the header on /api/data
  const inst = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'application/json' }); s.end('{}'); });
  await new Promise((r) => inst.listen(P + 2, '127.0.0.1', r));
  const site = origin('cool-tiger');
  try {
    hub.list = [instance('/srv/alpha', P, [previewRow('cool-tiger', devPort)])];
    // no cookie: sign-in, back to the link; and the hub was not asked for an unknown name
    const before = hub.hits;
    let r = await req('cool-tiger', 'GET', '/x?y=1', { cookie: '', headers: NAV });
    assert.equal(r.status, 401);
    assert.equal(signedOutTo(r, `${site}/x?y=1`), `/auth/login?next=${encodeURIComponent(`${site}/x?y=1`)}`.replace('/auth', `${gw.auth}/auth`), 'sign-in comes back to the preview');
    assert.equal((await req('never-heard', 'GET', '/', { cookie: '', headers: NAV })).status, 401);
    assert.equal((await req('never-heard', 'GET', '/x.js', { cookie: '', headers: { 'sec-fetch-mode': 'cors' } })).status, 401);
    assert.equal(hub.hits, before, 'no anonymous request makes the gateway poll the hub');
    // with the session, once the poll has the name
    await gw.g.pollPush();
    await previewReady(S, 'cool-tiger', devPort, 'hello from the app');
    r = await req('cool-tiger', 'GET', '/page', { headers: { ...NAV, referer: `${site}/old`, 'x-forwarded-host': 'evil' }, cookie: `${gw.jar()}; app=1` });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.body, 'hello from the app');
    const up = seen.at(-1).h;
    assert.equal(up.host, `localhost:${devPort}`);
    assert.equal(up.cookie, 'app=1', 'the session cookie is stripped, the app\'s own passes');
    assert.equal(up.referer, undefined);
    assert.equal(up['x-forwarded-host'], undefined);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.deepEqual(r.headers['set-cookie'], ['b=2'], 'a Domain= cookie and the session\'s own name are dropped');
    assert.equal(r.headers['x-frame-options'], 'DENY', 'the app\'s framing headers pass through');
    assert.match(r.headers['content-security-policy'], new RegExp(`default-src ${site}; connect-src ws://${S.on('cool-tiger')}`.replace(/\./g, '\\.')));
    // Origin: mapped only when it is the link's own
    await req('cool-tiger', 'GET', '/o', { headers: { origin: site } });
    assert.equal(seen.at(-1).h.origin, `http://localhost:${devPort}`);
    await req('cool-tiger', 'GET', '/o2', { headers: { origin: 'https://other.example' } });
    assert.equal(seen.at(-1).h.origin, 'https://other.example', 'another origin passes as is');
    r = await req('cool-tiger', 'GET', '/go');
    assert.equal(r.headers.location, `${site}/next`, 'a redirect to itself lands on the link');
    assert.equal((await req('cool-tiger', 'GET', '/healthz')).body, 'app ok', 'the app\'s own /healthz');
    // the framing rule and the other refusals
    for (const dest of ['iframe', 'frame', 'object', 'embed', 'fencedframe']) {
      assert.equal((await req('cool-tiger', 'GET', '/f', { headers: { 'sec-fetch-dest': dest, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' } })).status, 403, `${dest} from another site`);
      assert.equal((await req('cool-tiger', 'GET', '/f', { headers: { 'sec-fetch-dest': dest, 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate' } })).status, 200, `${dest} from this box`);
    }
    assert.equal((await req('cool-tiger', 'POST', '/s', { headers: { origin: 'https://other.example' }, body: {} })).status, 403);
    assert.equal((await req('cool-tiger', 'POST', '/s', { headers: { origin: site }, body: {} })).status, 200, 'the app\'s own POST');
    assert.equal(seen.at(-1).h.origin, `http://localhost:${devPort}`);
    assert.equal((await req('cool-tiger', 'GET', '/sw.js', { headers: { 'service-worker': 'script' } })).status, 403);
    // a server bound to ::1 alone answers too, a body surviving the retry
    const v6 = http.createServer((q, s) => { let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => s.end(`v6:${b}`)); });
    const v6Port = await freePort();
    const onV6 = await new Promise((resolve) => { v6.once('error', () => resolve(false)); v6.listen(v6Port, '::1', () => resolve(true)); });
    if (onV6) {
      hub.list = [instance('/srv/alpha', P, [previewRow('cool-tiger', devPort), previewRow('cool-owl', v6Port)])];
      await gw.g.pollPush();
      await previewReady(S, 'cool-owl', v6Port, 'v6:');
      assert.equal((await req('cool-owl', 'POST', '/s', { headers: { origin: origin('cool-owl') }, body: { a: 1 } })).body, 'v6:{"a":1}', `the body survives the retry on ::1 (port ${v6Port})`);
      v6.close();
      hub.list = [instance('/srv/alpha', P, [previewRow('cool-tiger', devPort)])];
      await gw.g.pollPush();
    }
    // the box's own names are unchanged
    hub.list = [...hub.list, instance('/srv/gamma', P + 2, [])];
    r = await gw.req('GET', '/api/data', { on: 'gamma' });
    assert.equal(r.headers['x-devteam-previews'], '1', 'a dashboard learns the box serves previews');
    assert.equal((await gw.req('GET', '/x', { headers: { host: `x_y.${S.box}` } })).status, 421, 'a name that is no label is still another name');
    assert.equal((await gw.req('GET', '/box.json')).headers['x-devteam-previews'], undefined);
    assert.equal((await gw.req('GET', '/healthz', { headers: { host: S.box } })).body, 'ok', 'the platform\'s check comes in on the service\'s name');
  } finally { await S.close(); dev.close(); inst.close(); }
});

test('a preview that is down, ambiguous or unknown answers 503, a page only to a navigation, and only to the owner', async () => {
  const S = await previewSetup('preview-503', { hubDelay: 80 });
  const { gw, hub, instance, req } = S;
  const seen = [];
  const devPort = await freePort();
  const dev = http.createServer((q, s) => { seen.push(q.url); s.end('app'); });
  await new Promise((r) => dev.listen(devPort, '127.0.0.1', r));
  try {
    hub.list = [instance('/srv/alpha', P, [previewRow('cool-tiger', devPort, { project: 'al<pha', label: '<b>x</b>' })])];
    assert.equal((await req('cool-tiger', 'GET', '/', { headers: NAV })).status, 200);
    // ten concurrent misses, one hub read
    const before = hub.hits;
    const replies = await Promise.all(Array.from({ length: 10 }, () => req('never-heard', 'GET', '/x.js', { headers: { 'sec-fetch-mode': 'cors', accept: '*/*' } })));
    assert.ok(replies.every((r) => r.status === 503));
    assert.equal(hub.hits, before + 1, 'ten misses share one read');
    let r = replies[0];
    assert.match(r.headers['content-type'], /text\/plain/);
    assert.equal(r.headers['retry-after'], '5');
    assert.doesNotMatch(r.body, /<html/i, 'never a page to a fetch');
    r = await req('never-heard', 'GET', '/', { headers: NAV });
    assert.equal(r.status, 503);
    assert.match(r.body, /Nothing is named never-heard/);
    assert.match(r.body, /cool-tiger/, 'the current names');
    assert.match(r.body, /location\.reload/, 'it retries');
    assert.doesNotMatch(r.body, /<noscript>/, 'for a few minutes, never forever');
    await new Promise((res) => dev.close(res));
    r = await req('cool-tiger', 'GET', '/', { headers: NAV });
    assert.equal(r.status, 503);
    assert.match(r.body, /content="5"/, 'retries every 5 s');
    assert.ok(r.body.includes(String(devPort)), 'names the port');
    assert.match(r.body, /api-01-x/, 'and the session');
    assert.match(r.body, /&#60;b&#62;x/, 'a label is escaped');
    assert.doesNotMatch(r.body, /<b>x/);
    assert.match(r.headers['content-security-policy'], /default-src 'none'/, 'the gateway\'s own page');
    r = await req('cool-tiger', 'GET', '/api/x', { headers: { 'sec-fetch-mode': 'cors', accept: '*/*' } });
    assert.equal(r.status, 503);
    assert.match(r.headers['content-type'], /text\/plain/);
    await new Promise((res) => dev.listen(devPort, '127.0.0.1', res));
    // two instances claim it: neither is served, and the page names both
    hub.list = [instance('/srv/alpha', P, [previewRow('cool-tiger', devPort)]), instance('/srv/beta', P + 1, [previewRow('cool-tiger', devPort, { project: 'beta' })])];
    await gw.g.pollPush();
    const count = seen.length;
    r = await req('cool-tiger', 'GET', '/', { headers: NAV });
    assert.equal(r.status, 503);
    assert.match(r.body, /Two instances offer/);
    assert.ok(r.body.includes('/srv/alpha') && r.body.includes('/srv/beta'), 'names both roots');
    assert.equal(seen.length, count, 'the dev server sees no request');
    assert.equal((await req('cool-tiger', 'GET', '/x', { headers: { 'sec-fetch-mode': 'cors' } })).status, 503);
    // one stops listing it: the other is served again after the next poll
    hub.list = [instance('/srv/alpha', P, [previewRow('cool-tiger', devPort)])];
    await gw.g.pollPush();
    assert.equal((await req('cool-tiger', 'GET', '/', { headers: NAV })).status, 200);
    // a name the next list drops is gone
    hub.list = [];
    await gw.g.pollPush();
    r = await req('cool-tiger', 'GET', '/', { headers: NAV });
    assert.equal(r.status, 503);
    assert.match(r.body, /Nothing is named cool-tiger/);
    // a hub that doesn't answer lists nothing: a stale name can't keep a port
    hub.list = [instance('/srv/alpha', P, [previewRow('cool-tiger', devPort)])];
    await gw.g.pollPush();
    assert.equal((await req('cool-tiger', 'GET', '/', { headers: NAV })).status, 200);
    hub.srv.close();
    await gw.g.pollPush();
    r = await req('cool-tiger', 'GET', '/', { headers: NAV });
    assert.equal(r.status, 503, 'the map is what the list said last; no list, no names');
    await new Promise((res) => hub.srv.listen(HUB, '127.0.0.1', res));
  } finally { await gw.close(); await new Promise((res) => hub.srv.close(res)); dev.close(); }
});

// A WebSocket by hand: the handshake with the headers a browser sends, then masked text frames.
function wsClient(gwPort, host, { origin, cookie, path: route = '/hmr?token=abc', key = 'dGhlIHNhbXBsZSBub25jZQ==', headers = {} } = {}) {
  return new Promise((resolve) => {
    const sock = net.connect(gwPort, '127.0.0.1');
    let buf = Buffer.alloc(0);
    let handshaken = false;
    const frames = [];
    const waiters = [];
    sock.on('connect', () => sock.write(`GET ${route} HTTP/1.1\r\nhost: ${host}\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-version: 13\r\nsec-websocket-key: ${key}\r\n${origin ? `origin: ${origin}\r\n` : ''}${cookie ? `cookie: ${cookie}\r\n` : ''}${Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n`));
    const parse = () => {
      while (buf.length >= 2) {
        const len = buf[1] & 127;
        if (buf.length < 2 + len) return;
        frames.push(buf.subarray(2, 2 + len).toString());
        buf = buf.subarray(2 + len);
        for (const w of waiters.splice(0)) w();
      }
    };
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!handshaken) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        const head = buf.subarray(0, i).toString();
        buf = buf.subarray(i + 4);
        handshaken = true;
        resolve({ status: Number(/HTTP\/1\.1 (\d+)/.exec(head)[1]), head, sock, frames, send, next, close: () => sock.destroy() });
      }
      parse();
    });
    const send = (text) => { const mask = Buffer.from([1, 2, 3, 4]); const body = Buffer.from(text).map((b, i) => b ^ mask[i % 4]); sock.write(Buffer.concat([Buffer.from([0x81, 0x80 | body.length]), mask, body])); };
    // a frame, or a failure after 5 s: a relay that drops frames fails here rather than hanging the file
    const next = () => new Promise((r, reject) => {
      if (frames.length) return r(frames.shift());
      const t = setTimeout(() => reject(new Error('no frame came back within 5 s')), 5000);
      waiters.push(() => { clearTimeout(t); r(frames.shift()); });
    });
    sock.on('error', () => {});
    sock.on('close', () => { if (!handshaken) resolve({ status: 0 }); });
  });
}

test('a preview\'s WebSocket is relayed, with the link\'s Origin mapped, and capped', async () => {
  const S = await previewSetup('preview-ws');
  const { gw, hub, instance, origin, on } = S;
  const seen = [];
  let upstreamClosed = 0;
  const dev = http.createServer((q, s) => s.end('page'));
  dev.on('upgrade', (q, sock) => {
    seen.push({ url: q.url, h: q.headers });
    const accept = crypto.createHash('sha1').update(`${q.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSet-Cookie: bad=1; Domain=box.localhost\r\nSet-Cookie: devteam_session=shadow\r\nSet-Cookie: ok=1\r\nStrict-Transport-Security: max-age=9\r\nX-Other: kept\r\n\r\n`);
    sock.on('error', () => {});
    sock.on('end', () => sock.end()); // an http server's socket is half-open until told
    sock.on('close', () => { upstreamClosed++; });
    sock.on('data', (d) => {
      // a masked client frame back unmasked
      const len = d[1] & 127;
      const mask = d.subarray(2, 6);
      const body = Buffer.from(d.subarray(6, 6 + len)).map((b, i) => b ^ mask[i % 4]);
      sock.write(Buffer.concat([Buffer.from([0x81, len]), body]));
    });
  });
  const devPort = await devServer(dev, S);
  const site = origin('cool-tiger');
  const sockets = [];
  let c = null;
  try {
    hub.list = [instance('/srv/alpha', P, [previewRow('cool-tiger', devPort)])];
    await gw.g.pollPush();
    await previewReady(S, 'cool-tiger', devPort, 'page');
    c = await wsClient(gw.port, on('cool-tiger'), { origin: site, cookie: gw.jar() });
    if (c.status !== 101) assert.fail(`the first socket: ${c.status}; ${await previewState(S, devPort)}`);
    assert.doesNotMatch(c.head, /bad=1|devteam_session/i, 'the handshake\'s cookies get the same rule as any response');
    assert.match(c.head, /set-cookie: ok=1/i, 'a host-only cookie still passes');
    assert.doesNotMatch(c.head, /max-age=9/, 'and so do the other headers');
    assert.match(c.head, /sec-websocket-accept: /i);
    assert.match(c.head, /x-other: kept/i);
    assert.equal(seen.at(-1).url, '/hmr?token=abc', 'the query passes untouched');
    assert.equal(seen.at(-1).h.host, `localhost:${devPort}`);
    assert.equal(seen.at(-1).h.origin, `http://localhost:${devPort}`);
    assert.doesNotMatch(String(seen.at(-1).h.cookie ?? ''), /devteam_session/);
    c.send('hello socket');
    assert.equal(await c.next(), 'hello socket', 'a frame comes back through the relay');
    const count = upstreamClosed;
    c.close();
    await until(() => upstreamClosed > count, 'the upstream socket to close when the client goes');
    assert.equal((await wsClient(gw.port, on('cool-tiger'), { origin: site })).status, 401, 'no session');
    assert.equal((await wsClient(gw.port, on('cool-tiger'), { origin: 'https://other.example', cookie: gw.jar() })).status, 403, 'another Origin');
    assert.equal((await wsClient(gw.port, on('never-heard'), { origin: origin('never-heard'), cookie: gw.jar() })).status, 503, 'no refresh on an upgrade: unknown is unknown');
    // the cap: 32 open, the 33rd refused, and none of the others closed
    for (let i = 0; i < 32; i++) { const w = await wsClient(gw.port, on('cool-tiger'), { origin: site, cookie: gw.jar() }); assert.equal(w.status, 101, `socket ${i}`); sockets.push(w); }
    assert.equal((await wsClient(gw.port, on('cool-tiger'), { origin: site, cookie: gw.jar() })).status, 429, 'the 33rd is refused');
    sockets[0].send('still here');
    assert.equal(await sockets[0].next(), 'still here');
    // two instances claim it: neither is relayed
    hub.list = [instance('/srv/alpha', P, [previewRow('cool-tiger', devPort)]), instance('/srv/beta', P + 1, [previewRow('cool-tiger', devPort)])];
    await gw.g.pollPush();
    assert.equal((await wsClient(gw.port, on('cool-tiger'), { origin: site, cookie: gw.jar() })).status, 503, 'ambiguous');
    // the terminal's socket is unchanged
    assert.equal((await wsClient(gw.port, `term.${S.box}`, { origin: gw.term, path: '/nope', cookie: gw.jar() })).status, 404);
  } finally { c?.close?.(); for (const w of sockets) w.close?.(); await S.close(); dev.closeAllConnections?.(); dev.close(); }
});

test('/dev/ lists every preview on the box with its state, for the owner only, as a document', async () => {
  const S = await previewSetup('preview-list');
  const { gw, hub, instance } = S;
  const devPort = await freePort();
  const dev = http.createServer((q, s) => s.end('app'));
  await new Promise((r) => dev.listen(devPort, '127.0.0.1', r));
  const down = await freePort();
  // its own port: a dev port two instances list makes every name on it ambiguous, cool-tiger's too
  const shared = await freePort();
  try {
    assert.match((await gw.req('GET', '/box.json')).json.previews, /\/dev\/$/, 'box.json names the page');
    hub.list = [
      instance('/srv/alpha', P, [previewRow('cool-tiger', devPort, { label: '<b>evil</b>', project: 'alpha', session: 'api-01-x' }), previewRow('calm-otter', down, { project: 'alpha', session: 'api-02-y', label: '' }), previewRow('shared-name', shared, { project: 'alpha' })]),
      instance('/srv/beta', P + 1, [previewRow('shared-name', shared, { project: 'beta' })]),
    ];
    assert.match((await gw.req('GET', '/dev/', { cookie: '', headers: NAV })).headers.location, /\/auth\/login\?next=/, 'no session, sign-in');
    assert.equal((await gw.req('GET', '/dev/', { cookie: '', headers: { 'sec-fetch-mode': 'cors' } })).status, 401);
    const r = await gw.req('GET', '/dev/', { headers: NAV });
    assert.equal(r.status, 200);
    assert.match(r.headers['content-security-policy'], /default-src 'none'/);
    const body = r.body;
    for (const t of ['/srv/alpha', '/srv/beta', 'cool-tiger', 'calm-otter', 'api-01-x', 'api-02-y']) assert.ok(body.includes(t), t);
    assert.match(body, /&#60;b&#62;evil/, 'a label is escaped');
    assert.doesNotMatch(body, /<b>evil/);
    assert.ok(body.includes(`href="${S.origin('cool-tiger')}/"`), 'Open goes to the preview\'s own name');
    assert.match(body, /answers/);
    assert.match(body, /not answering/);
    assert.match(body, /ambiguous \(two instances\)/);
    assert.doesNotMatch(body, new RegExp(`href="${S.origin('shared-name')}`.replace(/\./g, '\\.')), 'nothing to open for an ambiguous name');
    assert.equal((await gw.req('GET', '/dev/', { headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate' } })).status, 403, 'never in a frame');
    assert.equal((await gw.req('GET', '/dev', { headers: NAV })).status, 200);
    hub.list = [];
    await gw.g.pollPush();
    assert.match((await gw.req('GET', '/dev/', { headers: NAV })).body, /Nothing/);
  } finally { await S.close(); dev.close(); }
});

test('the hub links the box\'s previews beside Passkeys', () => {
  const hub = fs.readFileSync(path.join(kit, 'dashboard', 'hub.html'), 'utf8');
  assert.match(hub, /typeof b\.previews === 'string' && secure\(b\.previews\)/, 'only a URL the page would trust');
  assert.match(hub, /a\.textContent = 'Previews'/);
});

// A stand-in for a kit on an instance's port, for what the gateway does with its answers. It has a
// hello (K.hello: an object; null cuts the socket; 'slow' never answers), a viewer page and an
// artifact's files under the kit's own kinds of policy in its loopback origin, and a dashboard for
// anything else. Every request it sees is kept.
function fakeKit(port) {
  const self = `http://127.0.0.1:${port}`;
  const K = { hello: { devteam: 1, name: 'alpha', root: '/srv/alpha', port, viewer: 1 }, seen: [] };
  K.srv = http.createServer((q, s) => {
    K.seen.push({ url: q.url, h: q.headers });
    const reply = (type, csp, body) => { s.writeHead(200, { 'content-type': type, 'content-security-policy': csp, 'content-security-policy-report-only': "frame-ancestors 'self'" }); s.end(body); };
    if (q.url === '/api/hello') {
      if (K.hello === 'slow') return undefined;
      if (K.hello === null) return q.socket.destroy();
      return reply('application/json', "default-src 'none'", JSON.stringify(K.hello));
    }
    const art = /^\/artifact\/((?:main|wt\/[^/]+|tree\/[0-9a-f]+)\/[^/]+)\//.exec(q.url);
    if (art) return reply('text/html; charset=utf-8', `default-src 'none'; script-src 'unsafe-inline' ${self}/artifact/${art[1]}/; frame-ancestors ${self} http://127.0.0.1:${HUB}; sandbox allow-scripts`, '<p>an artifact');
    if (q.url.startsWith('/view/')) return reply('text/html; charset=utf-8', `default-src 'none'; frame-src 'self'; frame-ancestors 'self' http://127.0.0.1:${HUB}`, '<p>a viewer');
    return reply('text/html; charset=utf-8', `default-src 'self'; frame-ancestors 'self' http://127.0.0.1:${HUB}`, 'the dashboard');
  });
  K.up = () => new Promise((r) => K.srv.listen(port, '127.0.0.1', r));
  K.close = () => new Promise((r) => { K.srv.closeAllConnections(); K.srv.close(r); });
  return K;
}

test('an artifact at a published tree goes under a capability, as main and a worktree do', async () => {
  const S = await previewSetup('artifact-tree');
  const { gw, hub } = S;
  const K = fakeKit(P + 20);
  await K.up();
  const T = 'b'.repeat(40);
  const framed = { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' };
  const opaque = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' };
  try {
    // the instance on P + 20 is the project alpha, at alpha.<box>
    hub.list = [{ devteam: 1, name: 'alpha', root: '/srv/alpha', port: P + 20, viewer: 1 }];
    await gw.g.pollPush();
    let r = await gw.req('GET', `/artifact/tree/${T}/mock/?v=1`, { on: 'alpha', headers: framed });
    assert.equal(r.status, 302, r.body);
    const cap = new RegExp(`^(/c/[^/]+)/artifact/tree/${T}/mock/\\?v=1$`).exec(r.headers.location)?.[1];
    assert.ok(cap, r.headers.location);
    // its files need no cookie, under its own policy pointed at the capability, on the project's host (mapLoop)
    r = await gw.req('GET', `${cap}/artifact/tree/${T}/mock/app.js`, { on: 'alpha', cookie: '', headers: opaque });
    assert.equal(r.status, 200, r.body);
    assert.equal(K.seen.at(-1).url, `/artifact/tree/${T}/mock/app.js`, 'the kit sees the plain path');
    assert.equal(K.seen.at(-1).h.cookie, undefined);
    assert.ok(r.headers['content-security-policy'].includes(`script-src 'unsafe-inline' ${gw.inst('alpha')}${cap}/artifact/tree/${T}/mock/`), r.headers['content-security-policy']);
    assert.doesNotMatch(r.headers['content-security-policy'], /127\.0\.0\.1/, 'no loopback origin is left');
    // that tree's folder only
    for (const other of [`/artifact/tree/${'c'.repeat(40)}/mock/app.js`, '/artifact/main/mock/app.js', `/artifact/tree/${T}/other/app.js`, `/artifact/tree/${T}/mock/../../main/mock/app.js`])
      assert.equal((await gw.req('GET', `${cap}${other}`, { on: 'alpha', cookie: '', headers: opaque })).status, 403, other);
    // a sha256 tree, and a top-level open, as main's
    assert.equal((await gw.req('GET', `/artifact/tree/${'d'.repeat(64)}/mock/`, { on: 'alpha', headers: framed })).status, 302);
    assert.equal((await gw.req('GET', `/artifact/tree/${T}/mock/`, { on: 'alpha', headers: { ...framed, 'sec-fetch-dest': 'document' } })).status, 302);
    // not a tree id: no capability; the request goes to the kit as it came
    for (const bad of [`/artifact/tree/${'b'.repeat(39)}/mock/`, `/artifact/tree/${'B'.repeat(40)}/mock/`, `/artifact/tree/${T}x/mock/`, `/artifact/tree/${'b'.repeat(41)}/mock/`]) {
      r = await gw.req('GET', bad, { on: 'alpha', headers: framed });
      assert.deepEqual([r.status, r.headers.location], [200, undefined], bad);
    }
  } finally { await K.close(); await S.close(); }
});

test('frame-ancestors on a project\'s viewer names the box only under the wrapper\'s grant; its published trees name its own host and the box, grant or not', async () => {
  const S = await previewSetup('public-ancestor');
  const { gw, hub } = S;
  const K = fakeKit(P + 20);
  await K.up();
  const T = 'b'.repeat(40);
  const fa = (r) => r.headers['content-security-policy'].split(/;\s*/).find((d) => d.startsWith('frame-ancestors'));
  // the owner's wrapper is on the box's own name (/w/), one site with the project's host
  const fromWrapper = { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate' };
  const framed = { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' };
  const opaque = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'style' };
  const inst = gw.inst('alpha');
  // the viewer and the dashboard: 'self' and the hub, as the kit says, the hub's port mapped to the box
  const own = `frame-ancestors 'self' ${gw.publicUrl}`;
  // the viewer with no valid grant: the box taken out
  const alone = "frame-ancestors 'self'";
  // an artifact: the kit's own loopback origin, mapped to the project's host, and the box
  const tree = `frame-ancestors ${inst} ${gw.publicUrl}`;
  try {
    hub.list = [{ devteam: 1, name: 'alpha', root: '/srv/alpha', port: P + 20, viewer: 1 }];
    await gw.g.pollPush();
    // published from this instance: mock at tree T, and big at a 64-hex tree
    seedPublic(gw.dir, 'alpha', 'mock', { 'index.html': 'x' }, { root: '/srv/alpha', port: P + 20 });
    seedPublic(gw.dir, 'beta', 'big', { 'index.html': 'x' }, { root: '/srv/beta', port: P + 20 });
    const st = JSON.parse(fs.readFileSync(path.join(gw.dir, 'state.json'), 'utf8'));
    st.public.alpha.artifacts.mock.tree = T;
    st.public.beta.artifacts.big.tree = 'd'.repeat(64);
    fs.writeFileSync(path.join(gw.dir, 'state.json'), JSON.stringify(st));
    // the viewer: the box under the wrapper's grant (this project, page and tree), and under nothing else; no other name is added
    const at = `tree:${T}`;
    const viewer = (w, extra = '') => `/view/artifact/mock?at=${at}${w === null ? '' : `&w=${w}`}${extra}`;
    const good = gw.g.wrapGrant('alpha', 'mock', at);
    assert.match(good, /^\d+\.[\w-]{22}$/);
    assert.equal(fa(await gw.req('GET', viewer(good), { on: 'alpha', headers: fromWrapper })), own, 'a valid grant');
    assert.equal((await gw.req('GET', viewer(good), { on: 'alpha', headers: fromWrapper })).headers['content-security-policy-report-only'], "frame-ancestors 'self'", 'a report-only policy is left as it is');
    const [exp, sig] = good.split('.');
    const flip = (c) => (c === 'A' ? 'B' : 'A');
    const others = {
      'no grant': viewer(null),
      'an empty grant': viewer(''),
      'a forged mac': viewer(`${exp}.${sig.slice(0, -1)}${flip(sig.at(-1))}`),
      'a moved expiry': viewer(`${Number(exp) + 60000}.${sig}`),
      'an expired grant': viewer(gw.g.wrapGrant('alpha', 'mock', at, Date.now() - 1)),
      'a grant good for a day': viewer(gw.g.wrapGrant('alpha', 'mock', at, Date.now() + 86400000)),
      'another project\'s grant': viewer(gw.g.wrapGrant('beta', 'mock', at)),
      'another page\'s grant': viewer(gw.g.wrapGrant('alpha', 'other', at)),
      'another version\'s grant': viewer(gw.g.wrapGrant('alpha', 'mock', 'main')),
      'a second at': viewer(good, '&at=main'),
      'a second grant': viewer(good, `&w=${good}`),
    };
    for (const [why, v] of Object.entries(others)) assert.equal(fa(await gw.req('GET', v, { on: 'alpha', headers: fromWrapper })), alone, why);
    // not the artifact viewer: today's ancestors, grant or not
    for (const [why, v] of Object.entries({ 'a grant on another viewer': `/view/preview/cool-tiger?at=${at}&w=${good}`, 'a grant under a longer path': `/view/artifact/mock/x?at=${at}&w=${good}` }))
      assert.equal(fa(await gw.req('GET', v, { on: 'alpha', headers: fromWrapper })), own, why);
    // a tree, published or not, under its capability or without: the project's host and the box
    assert.equal(fa(await gw.req('GET', `/artifact/tree/${'d'.repeat(64)}/big/s.css`, { on: 'alpha' })), tree, 'sha256 tree');
    const cap = /^(\/c\/[^/]+)\//.exec((await gw.req('GET', `/artifact/tree/${T}/mock/`, { on: 'alpha', headers: framed })).headers.location)[1];
    assert.equal(fa(await gw.req('GET', `${cap}/artifact/tree/${T}/mock/s.css`, { on: 'alpha', cookie: '', headers: opaque })), tree);
    assert.equal(fa(await gw.req('GET', `/artifact/tree/${T}/mock/s.css`, { on: 'alpha' })), tree);
    for (const [why, t] of [['a tree published by no one', `/artifact/tree/${'e'.repeat(40)}/mock/s.css`], ['a published tree under another page', `/artifact/tree/${T}/big/s.css`], ['another page\'s tree', `/artifact/tree/${'d'.repeat(64)}/mock/s.css`]])
      assert.equal(fa(await gw.req('GET', t, { on: 'alpha' })), tree, why);
    const mainCap = /^(\/c\/[^/]+)\//.exec((await gw.req('GET', '/artifact/main/mock/', { on: 'alpha', headers: framed })).headers.location)[1];
    assert.equal(fa(await gw.req('GET', `${mainCap}/artifact/main/mock/s.css`, { on: 'alpha', cookie: '', headers: opaque })), tree, 'main\'s artifacts');
    for (const other of ['/', '/api/data', '/viewer/x', '/view', '/view/../api/data', '/view/%2e%2e/api/data', '/x/view/a', '/artifact/tree/notasha/mock/', '/view/%2E%2E/api/data', '/view/%5c..%5capi/data', '/view/..\\api'])
      assert.equal(fa(await gw.req('GET', other, { on: 'alpha' })), own, other);
    for (const bad of [`/artifact/tree/${T}/mock/../../main/mock/s.css`, `/artifact/tree/${T}/mock/%2E%2E/s.css`, `/artifact/tree/${T}/mock/%5c..`, `/artifact/tree/${T}/mock/a\\b`])
      assert.equal(fa(await gw.req('GET', bad, { on: 'alpha' })), tree, bad);
  } finally { await K.close(); await S.close(); }
});

test('a preview framed from its own name (its lens) gets past the app\'s framing headers, and nothing else does', async () => {
  assert.equal(G.replaceFrameAncestors("default-src 'self'; frame-ancestors 'none'", "'self' https://a"), "default-src 'self'; frame-ancestors 'self' https://a");
  assert.equal(G.replaceFrameAncestors("frame-ancestors 'none', frame-ancestors https://x; img-src y", 'https://a'), 'frame-ancestors https://a, frame-ancestors https://a; img-src y');
  assert.equal(G.replaceFrameAncestors("default-src 'self'", 'https://a'), "default-src 'self'", 'none is added');
  assert.equal(G.replaceFrameAncestors("frame-ancestors 'none' ; img-src y", 'https://a'), 'frame-ancestors https://a ; img-src y', 'the space before the next directive is kept');
  const S = await previewSetup('preview-framing');
  const { gw, hub, instance, req, origin } = S;
  const devPort = await freePort();
  const dev = http.createServer((q, s) => {
    if (q.url === '/nocsp') s.writeHead(200, { 'x-frame-options': 'SAMEORIGIN' });
    else if (q.url === '/nofa') s.writeHead(200, { 'x-frame-options': 'DENY', 'content-security-policy': "img-src 'self'" });
    else if (q.url === '/open') s.writeHead(200, {});
    else if (q.url === '/two') s.writeHead(200, { 'content-security-policy': ["frame-ancestors 'none'", "script-src 'self'; frame-ancestors http://elsewhere.example"] });
    else s.writeHead(200, { 'x-frame-options': 'DENY', 'content-security-policy': `default-src 'self' http://127.0.0.1:${devPort}; frame-ancestors 'none'`, 'content-security-policy-report-only': "frame-ancestors 'none'" });
    s.end('app');
  });
  // a WebSocket's answer carries a policy too: a socket is no frame, so it stays as sent
  const sockets = [];
  dev.on('upgrade', (q, sock) => {
    sockets.push(sock);
    const accept = crypto.createHash('sha1').update(`${q.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    sock.on('error', () => {});
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nContent-Security-Policy: frame-ancestors 'none'\r\nX-Frame-Options: DENY\r\n\r\n`);
  });
  await new Promise((r) => dev.listen(devPort, '127.0.0.1', r));
  // an instance's page that refuses frames: the relaxation is a preview's alone
  const inst = http.createServer((q, s) => { s.writeHead(200, { 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" }); s.end('dashboard'); });
  await new Promise((r) => inst.listen(P + 21, '127.0.0.1', r));
  const site = origin('cool-tiger');
  // the lens, the hub and the project host of the one instance that lists the preview: no other
  // instance's page may hold the app
  const lens = `'self' ${gw.publicUrl} ${origin('alpha')}`;
  const as = (dest, from) => ({ 'sec-fetch-dest': dest, 'sec-fetch-site': from, 'sec-fetch-mode': 'navigate' });
  try {
    hub.list = [instance('/srv/alpha', P, [previewRow('cool-tiger', devPort)]), instance('/srv/beta', P + 1, [])];
    let r = await req('cool-tiger', 'GET', '/', { headers: as('iframe', 'same-origin') });
    assert.equal(r.status, 200, r.body);
    assert.ok(!r.headers['content-security-policy'].includes(origin('beta')), 'another instance on the box is not named');
    assert.equal(r.headers['x-frame-options'], undefined, 'X-Frame-Options goes');
    assert.equal(r.headers['content-security-policy'], `default-src 'self' ${site}; frame-ancestors ${lens}`, 'frame-ancestors names the lens, the hub and the owning instance; the rest is kept');
    assert.equal(r.headers['content-security-policy-report-only'], "frame-ancestors 'none'", 'a report-only policy blocks nothing, and is left');
    for (const [dest, from] of [['document', 'none'], ['iframe', 'same-site'], ['frame', 'same-origin'], ['object', 'same-origin'], ['embed', 'same-origin']]) {
      r = await req('cool-tiger', 'GET', '/', { headers: as(dest, from) });
      assert.deepEqual([r.status, r.headers['x-frame-options'], r.headers['content-security-policy']], [200, 'DENY', `default-src 'self' ${site}; frame-ancestors 'none'`], `${dest} from ${from}: the app's own headers`);
    }
    assert.equal((await req('cool-tiger', 'GET', '/', { headers: as('iframe', 'cross-site') })).status, 403, 'another site\'s frame is still refused');
    r = await req('cool-tiger', 'GET', '/nocsp', { headers: as('iframe', 'same-origin') });
    assert.deepEqual([r.headers['x-frame-options'], r.headers['content-security-policy']], [undefined, `frame-ancestors ${lens}`], 'X-Frame-Options alone: a policy takes its place, so no other page may frame it');
    r = await req('cool-tiger', 'GET', '/nofa', { headers: as('iframe', 'same-origin') });
    assert.deepEqual([r.headers['x-frame-options'], r.headers['content-security-policy']], [undefined, `img-src 'self', frame-ancestors ${lens}`], 'a policy that doesn\'t say who may frame: one more policy says it');
    r = await req('cool-tiger', 'GET', '/open', { headers: as('iframe', 'same-origin') });
    assert.deepEqual([r.headers['x-frame-options'], r.headers['content-security-policy']], [undefined, `frame-ancestors ${lens}`], 'an app that refused no frames (a dev server\'s default): its lens\'s load gets a policy, so no other instance\'s page may hold it');
    for (const [dest, from] of [['document', 'none'], ['iframe', 'same-site'], ['frame', 'same-origin']]) {
      r = await req('cool-tiger', 'GET', '/open', { headers: as(dest, from) });
      assert.deepEqual([r.status, r.headers['content-security-policy']], [200, undefined], `${dest} from ${from}: as the app sent it`);
    }
    r = await req('cool-tiger', 'GET', '/two', { headers: as('iframe', 'same-origin') });
    assert.equal(r.headers['content-security-policy'], `frame-ancestors ${lens}, script-src 'self'; frame-ancestors ${lens}`, 'every policy in the header');
    // a name two instances list is never served, so it can't reach the relaxation: the owner sees which is which
    hub.list = [instance('/srv/alpha', P, [previewRow('cool-tiger', devPort)]), instance('/srv/beta', P + 1, [previewRow('cool-tiger', devPort)])];
    await gw.g.pollPush();
    r = await req('cool-tiger', 'GET', '/', { headers: as('iframe', 'same-origin') });
    assert.deepEqual([r.status, r.headers['x-frame-options']], [503, 'DENY'], 'ambiguous: the gateway\'s own page, framed by no one');
    assert.ok(r.headers['content-security-policy'].includes("frame-ancestors 'none'"));
    // and a name the hub doesn't list
    r = await req('lost-name', 'GET', '/', { headers: as('iframe', 'same-origin') });
    assert.deepEqual([r.status, r.headers['x-frame-options']], [503, 'DENY'], 'unknown: the same');
    assert.ok(r.headers['content-security-policy'].includes("frame-ancestors 'none'"));
    hub.list = [instance('/srv/alpha', P, [previewRow('cool-tiger', devPort)]), instance('/srv/gamma', P + 21, [])];
    await gw.g.pollPush();
    // confined to previews: an instance's page framed from its own name keeps its headers
    r = await gw.req('GET', '/x', { on: 'gamma', headers: as('iframe', 'same-origin') });
    assert.deepEqual([r.status, r.headers['x-frame-options'], r.headers['content-security-policy']], [200, 'DENY', "default-src 'self'; frame-ancestors 'none'"], 'an instance\'s page');
    // and a socket's handshake is passed on as sent
    await gw.g.pollPush();
    const c = await wsClient(gw.port, S.on('cool-tiger'), { origin: site, cookie: gw.jar(), headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' } });
    assert.equal(c.status, 101);
    assert.match(c.head, /content-security-policy: frame-ancestors 'none'/i, 'a WebSocket\'s policy is unchanged');
    assert.match(c.head, /x-frame-options: DENY/i);
    c.close();
  } finally { for (const s of sockets) s.destroy(); await S.close(); dev.close(); inst.close(); }
});

// The lens's script on its own, with a stand-in for its page and its parent: what it hears, and what
// it says back. Nothing is loaded in its frame (contentWindow is null), as before the app answers.
// Its timers are stubs: the rect pushes (animation frames, the 100 ms debounce, the 1 s backstop)
// are checked only in Chrome (test/browser/dev-links.mjs).
function lensRun({ search = '', ancestor = 'http://4321.box.example' } = {}) {
  const script = /<script>([\s\S]*?)<\/script>/.exec(G.PREVIEW_LENS)[1];
  const listeners = {};
  const posted = [];
  const frame = { src: '', contentWindow: null, addEventListener() {} };
  const parent = { postMessage: (m, o) => posted.push({ m: JSON.parse(JSON.stringify(m)), o }) };
  const win = {
    document: { getElementById: (id) => (id === 'app' ? frame : null) },
    location: { search, origin: 'http://cool-tiger.box.example', ancestorOrigins: ancestor ? [ancestor] : undefined },
    parent, addEventListener: (t, f) => { (listeners[t] ??= []).push(f); },
    setInterval: () => 0, setTimeout: () => 0, clearTimeout: () => {}, requestAnimationFrame: () => 0,
    TextEncoder, URL, URLSearchParams, CSS: { escape: (s) => s },
  };
  win.window = win;
  vm.runInNewContext(script, win);
  const hear = (data, { origin = ancestor ?? 'http://4321.box.example', source = parent, isTrusted = true } = {}) => { for (const f of listeners.message ?? []) f({ data, origin, source, isTrusted }); };
  return { frame, posted, hear, win };
}

test('the preview lens: one script and one style, a policy of their hashes, and the kit\'s caps', () => {
  const L = G.PREVIEW_LENS;
  const script = /<script>([\s\S]*?)<\/script>/.exec(L)[1];
  const style = /<style>([\s\S]*?)<\/style>/.exec(L)[1];
  assert.deepEqual([L.match(/<script\b/g).length, L.match(/<style\b/g).length], [1, 1]);
  assert.doesNotMatch(L.replace(script, '').replace(style, ''), /\son[a-z]+\s*=|\sstyle\s*=|\ssrc\s*=|\shref\s*=/i, 'no handler, style, src or link in the markup: the policy admits the two hashes and nothing else');
  assert.doesNotMatch(L, /[^\x20-\x7e\n]/, 'plain ASCII, so the kit\'s copy compares byte for byte');
  assert.doesNotMatch(L, /`|\$\{/, 'no backtick and no ${ in it: it is a String.raw template in both files');
  assert.ok(L.includes('<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">'), 'the viewport every gateway page has (iOS: a tap does not zoom)');
  assert.ok(style.startsWith('html{touch-action:manipulation}'), style);
  assert.doesNotThrow(() => new vm.Script(script), 'the script parses');
  const h = (t) => `'sha256-${crypto.createHash('sha256').update(t).digest('base64')}'`;
  assert.equal(G.previewLensCsp('http://a http://b'), `default-src 'none'; script-src ${h(script)}; style-src ${h(style)}; frame-src 'self'; frame-ancestors http://a http://b; base-uri 'none'; form-action 'none'`);
  // spec §5's caps, as the kit records an anchor and a preview subject
  const caps = vm.runInNewContext(`(${/const CAPS = (\{[^}]*\});/.exec(script)[1]})`);
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const kitCaps = (name) => vm.runInNewContext(`(${new RegExp(`^const ${name} = (\\{.*\\});$`, 'm').exec(src)[1]})`);
  for (const [k, v] of Object.entries(kitCaps('ANCHOR_CAPS'))) assert.equal(caps[k], v, `anchor.${k}`);
  assert.equal(caps.route, kitCaps('SUBJECT_CAPS').route);
  assert.deepEqual([caps.errors, caps.error], [3, 200], 'three errors of 200 bytes');
});

test('the preview lens answers only the page that frames it, and takes the app only to its own paths', () => {
  let L = lensRun();
  assert.equal(L.frame.src, '/', 'the app, at its root');
  L.hear({ lens: 1, type: 'hello' });
  assert.deepEqual(L.posted, [{ m: { lens: 1, type: 'ready', route: null, title: '', viewport: null }, o: 'http://4321.box.example' }], 'hello: what is framed now, to that origin alone');
  L.hear({ lens: 1, type: 'hit', id: 'h1', x: 10, y: 20 });
  assert.deepEqual(L.posted.at(-1).m, { lens: 1, type: 'hit-reply', id: 'h1', anchor: null, rect: null, route: null }, 'nothing loaded: nothing under the point');
  const n = L.posted.length;
  L.hear({ lens: 1, type: 'hello' }, { source: {} });
  L.hear({ lens: 1, type: 'hello' }, { origin: 'http://cool-tiger.box.example' });
  L.hear({ lens: 1, type: 'hello' }, { origin: 'null' });
  L.hear({ lens: 1, type: 'hello' }, { origin: 'http://4322.box.example' });
  L.hear({ type: 'hello' });
  L.hear({ lens: 1, type: 'toString' });
  L.hear({ lens: 1, type: 'hit', id: { no: 1 }, x: 1, y: 1 });
  L.hear({ lens: 1, type: 'hit', id: 'h2', x: 'a', y: 1 });
  L.hear('hello');
  L.hear({ lens: 1, type: 'hello' }, { isTrusted: false });
  assert.equal(L.posted.length, n, 'not its parent, the app\'s own origin, an opaque one, not the parent the browser names, not a lens message, not an order, a bad id or point, not an event a script made: each ignored');
  // a first message from an origin the browser doesn't name as the parent binds nothing and gets nothing
  L = lensRun();
  L.hear({ lens: 1, type: 'hello' }, { origin: 'http://4322.box.example' });
  L.hear({ lens: 1, type: 'hit', id: 'h1', x: 1, y: 1 }, { origin: 'http://4322.box.example' });
  assert.deepEqual(L.posted, [], 'nothing to a page that is not the parent');
  L.hear({ lens: 1, type: 'hello' });
  assert.deepEqual(L.posted.map((x) => x.o), ['http://4321.box.example'], 'and the real parent is still answered');
  // where the browser doesn't name the parent's origin, the first one heard is the only one
  L = lensRun({ ancestor: null });
  L.hear({ lens: 1, type: 'hello' }, { origin: 'http://4321.box.example' });
  L.hear({ lens: 1, type: 'hello' }, { origin: 'http://4322.box.example' });
  assert.deepEqual(L.posted.map((x) => x.o), ['http://4321.box.example']);
  // go, and the first route: this origin's paths only, never the lens's own
  L.hear({ lens: 1, type: 'go', route: '/checkout?step=2#pay' }, { origin: 'http://4321.box.example' });
  assert.equal(L.frame.src, '/checkout?step=2#pay');
  for (const bad of ['//evil.example/x', 'https://evil.example/', 'checkout', '/\\evil.example', '/.devteam/lens', '', 5]) {
    L.hear({ lens: 1, type: 'go', route: bad }, { origin: 'http://4321.box.example' });
    assert.equal(L.frame.src, '/checkout?step=2#pay', `go ${bad}`);
  }
  assert.equal(lensRun({ search: '?route=%2Fadmin%3Fx%3D1' }).frame.src, '/admin?x=1');
  for (const bad of ['?route=%2F%2Fevil.example', '?route=https%3A%2F%2Fevil.example', '?route=%2F.devteam%2Flens']) assert.equal(lensRun({ search: bad }).frame.src, '/', bad);
});

test('the preview lens names an element by an attribute only if the whole selector fits the cap', () => {
  const L = lensRun();
  const el = (tag, attrs) => ({ localName: tag, id: '', nodeType: 1, classList: [], parentElement: null, previousElementSibling: null, textContent: '', labels: [], getAttribute: (n) => attrs[n] ?? null, hasAttribute: (n) => n in attrs, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }), cloneNode() { return { appendChild() {}, outerHTML: `<${tag}>` }; }, childNodes: [] });
  let target;
  const doc = { documentElement: {}, body: {}, elementFromPoint: () => target, querySelectorAll: () => [1], getElementById: () => null };
  L.frame.contentWindow = { document: doc, location: { href: 'http://cool-tiger.box.example/', origin: 'http://cool-tiger.box.example', pathname: '/', search: '', hash: '' } };
  const pick = (tag, value) => { target = el(tag, { 'data-testid': value }); L.hear({ lens: 1, type: 'hit', id: 'h', x: 1, y: 1 }); return L.posted.at(-1).m.anchor.selector; };
  assert.equal(pick('button', 'x'.repeat(100)), `button[data-testid="${'x'.repeat(100)}"]`, 'a short tag and a 100-byte value fit');
  const long = 'x-' + 'a'.repeat(100);
  const sel = pick(long, 'x'.repeat(100));
  assert.doesNotMatch(sel, /data-testid/, 'a long custom tag with a 100-byte value is over the cap: the path, not the attribute');
  assert.ok(Buffer.byteLength(sel) <= 200);
});

test('/.devteam/lens on a preview\'s name: the gateway\'s own page, for the owner only, never the app\'s', async () => {
  const S = await previewSetup('preview-lens');
  const { gw, hub, instance, req } = S;
  const seen = [];
  const devPort = await freePort();
  const dev = http.createServer((q, s) => { seen.push(`${q.method} ${q.url}`); s.end('app'); });
  await new Promise((r) => dev.listen(devPort, '127.0.0.1', r));
  // who may hold the lens: the hub, and the project host of the instance that lists that preview
  const ancestors = `${gw.publicUrl} ${S.origin('alpha')}`;
  const framed = { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate' };
  try {
    hub.list = [instance('/srv/alpha', P, [previewRow('cool-tiger', devPort)]), instance('/srv/beta', P + 1, [previewRow('calm-otter', await freePort())])];
    await gw.g.pollPush();
    let r = await req('cool-tiger', 'GET', '/.devteam/lens', { cookie: '', headers: NAV });
    assert.equal(r.status, 401, 'no session: the signed-out page, the same on every name');
    assert.equal(signedOutTo(r, `${S.origin('cool-tiger')}/.devteam/lens`), `${gw.auth}/auth/login?next=${encodeURIComponent(`${S.origin('cool-tiger')}/`)}`, 'which sends to sign-in, then back to the preview itself, not to a lens on its own');
    assert.equal((await req('cool-tiger', 'GET', '/.devteam/lens', { cookie: '', headers: { 'sec-fetch-mode': 'cors' } })).status, 401);
    r = await req('cool-tiger', 'GET', '/.devteam/lens?route=%2Fcheckout', { headers: framed });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.body, G.PREVIEW_LENS);
    assert.deepEqual([r.headers['content-type'], r.headers['content-security-policy'], r.headers['cache-control'], r.headers['referrer-policy'], r.headers['x-frame-options']], ['text/html; charset=utf-8', G.previewLensCsp(ancestors), 'no-store', 'no-referrer', undefined]);
    assert.equal((await req('cool-tiger', 'GET', '/.devteam/lens', { headers: { ...framed, 'sec-fetch-site': 'cross-site' } })).status, 403, 'another site\'s frame is refused, as the app\'s would be');
    const hits = hub.hits;
    r = await req('calm-otter', 'GET', '/.devteam/lens', { headers: framed });
    assert.equal(r.body, G.PREVIEW_LENS, 'the same page on another preview\'s name');
    assert.equal(r.headers['content-security-policy'], G.previewLensCsp(`${gw.publicUrl} ${S.origin('beta')}`), 'held by its own instance\'s project host, not alpha\'s');
    assert.equal(hub.hits, hits, 'and serving it asks the hub nothing');
    assert.deepEqual(seen, [], 'the app saw none of it');
    // anything else at that path is the app's, as before
    await req('cool-tiger', 'POST', '/.devteam/lens', { headers: { origin: S.origin('cool-tiger') }, body: {} });
    await req('cool-tiger', 'GET', '/.devteam/lens/x');
    await req('cool-tiger', 'GET', '/.devteam/lensx');
    await req('cool-tiger', 'HEAD', '/.devteam/lens');
    assert.deepEqual(seen, ['POST /.devteam/lens', 'GET /.devteam/lens/x', 'GET /.devteam/lensx', 'HEAD /.devteam/lens']);
  } finally { await S.close(); dev.close(); }
});

test('<project>.<box>: the signed-in owner\'s own visit gets the viewer at the published version; anyone else, and any doubt, the plain bytes', async () => {
  // The choice is a lookup in the hub's list as last polled, the same for every visit: nothing is
  // asked on the request path, so how long it takes says nothing of who is visiting (spec §11).
  const hub = { list: [], hits: 0 };
  hub.srv = http.createServer((q, res) => { hub.hits++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ hub: 1, instances: hub.list })); });
  await new Promise((r) => hub.srv.listen(HUB, '127.0.0.1', r));
  const listing = (over = {}) => ({ devteam: 1, name: 'alpha', root: '/srv/alpha', port: P + 20, viewer: 1, ...over });
  const gw = await gateway('public-wrap');
  const K = fakeKit(P + 20);
  await K.up();
  const page = '<!doctype html><p>hi';
  const tree = 'a'.repeat(40);
  const state = path.join(gw.dir, 'state.json');
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    seedPublic(gw.dir, 'alpha', 'hello', { 'index.html': page, 'app.js': 'x()' }, { root: '/srv/alpha', port: P + 20 });
    const s = JSON.parse(fs.readFileSync(state, 'utf8'));
    s.public.alpha.artifacts.hello.title = 'A <b>mock</b>';
    fs.writeFileSync(state, JSON.stringify(s));
    const get = (route, headers = NAV, cookie = gw.jar()) => gw.req('GET', route, { on: 'alpha', cookie, headers });
    const plain = (r, why) => {
      assert.deepEqual([r.status, r.body, r.headers['cache-control'], r.headers.vary, r.headers['cross-origin-opener-policy']], [200, page, 'public, max-age=60', 'cookie, sec-fetch-dest', 'same-origin'], why);
      assert.match(r.headers['content-security-policy'], /; sandbox allow-scripts allow-forms allow-modals allow-pointer-lock$/, why);
      assert.doesNotMatch(r.headers['content-security-policy'], /allow-same-origin/, why);
    };
    hub.list = [listing()];
    plain(await get('/hello/'), 'before the hub\'s list is first read');
    await gw.g.pollPush();
    // the owner's visit is sent to the wrapper on the box's own name, off the dashboard's origin
    const inst = gw.inst('alpha');
    const owner = (x, why) => assert.deepEqual([x.status, x.headers.location], [302, `${gw.publicUrl}/w/alpha/hello/`], why);
    let r = await get('/hello/');
    owner(r, 'the wrapper, not the bytes');
    assert.deepEqual([r.headers['cache-control'], r.headers.vary, r.headers['x-frame-options'], r.headers['referrer-policy'], r.headers['set-cookie'], r.headers['cross-origin-opener-policy']], ['no-store, private', 'cookie, sec-fetch-dest', 'DENY', 'no-referrer', undefined, 'same-origin'], 'the opener policy on the redirect and the plain index alike: a popup\'s window says nothing of who is visiting');
    r = await gw.req('GET', '/w/alpha/hello/', { headers: NAV });
    assert.equal(r.status, 200);
    assert.notEqual(r.body, page, 'the wrapper, not the bytes');
    assert.deepEqual([r.headers['cache-control'], r.headers.vary, r.headers['x-frame-options'], r.headers['referrer-policy'], r.headers['set-cookie'], r.headers['cross-origin-opener-policy']], ['no-store, private', 'cookie, sec-fetch-dest', 'DENY', 'no-referrer', undefined, 'same-origin'], 'the wrapper\'s own headers');
    assert.equal(r.headers['content-security-policy'], `default-src 'none'; style-src 'unsafe-inline'; frame-src ${inst}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, 'a policy of its own: no script, nothing to connect to, and it frames only the project\'s host');
    assert.match(r.body, /sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"/);
    assert.match(r.body, /<iframe [^>]*\bautofocus\b/, 'the viewer has the keyboard from the start, so Shift reaches it');
    assert.doesNotMatch(r.body, /allow-popups-to-escape-sandbox|allow-top-navigation/, 'its frame can neither navigate this tab nor open a window outside its sandbox');
    const src = /<iframe src="([^"]+)"/.exec(r.body)[1].replace(/&#38;|&amp;/g, '&');
    assert.match(src, new RegExp(`^${inst}/view/artifact/hello\\?at=tree:${tree}&w=\\d+\\.[\\w-]{22}$`), src);
    // the viewer, on the project's host: the box is an ancestor under the wrapper's grant, and only then
    const fa = (x) => x.headers['content-security-policy'].split(/;\s*/).find((d) => d.startsWith('frame-ancestors'));
    const fromWrapper = { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate' };
    const rel = src.slice(inst.length);
    assert.equal(fa(await gw.req('GET', rel, { on: 'alpha', headers: fromWrapper })), `frame-ancestors 'self' ${gw.publicUrl}`, 'with the wrapper\'s grant');
    assert.equal(fa(await gw.req('GET', rel.replace(/&w=.*/, ''), { on: 'alpha', headers: fromWrapper })), "frame-ancestors 'self'", 'and without it, not the box');
    assert.ok(r.body.includes(`<a href="${inst}/hello/?plain">Open it as the public sees it</a>`), r.body);
    assert.match(r.body, /Public · alpha\/hello/);
    assert.ok(r.body.includes('A &#60;b&#62;mock') && !r.body.includes('<b>mock'), 'the title is escaped');
    assert.doesNotMatch(r.body, /<script/i, 'no script of its own');
    // iOS: the same viewport as every page of the gateway's, so a tap in the bar or the frame doesn't zoom it
    const meta = (html) => /<meta name="viewport" content="([^"]*)">/.exec(html)?.[1];
    const login = await gw.req('GET', '/auth/login', { cookie: '', headers: NAV });
    assert.ok(meta(login.body), login.body);
    assert.equal(meta(r.body), meta(login.body), 'the viewport doc() gives');
    assert.match(r.body, /html\{touch-action:manipulation\}/, 'and its touch-action');
    const hellos = () => K.seen.filter((x) => x.url === '/api/hello').length;
    const hits = hub.hits;
    assert.equal(hellos(), 0, 'the instance is never asked on the request path');
    owner(await get('/hello/index.html'), 'its index by name too');
    // the plain bytes, with vary: cookie on the document
    plain(await get('/hello/?plain'), '?plain');
    plain(await get('/hello/', { ...NAV, 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' }), 'a frame load');
    plain(await get('/hello/', { accept: 'text/html' }), 'no fetch metadata: an old browser');
    plain(await get('/hello/', NAV, ''), 'no cookie');
    plain(await get('/hello/', NAV, `devteam_session=${'A'.repeat(43)}`), 'a cookie that is no session');
    // a signed-in owner arriving from a link elsewhere gets it too: nothing in it is readable to
    // that site, its frame is sandboxed, and the frame's URL comes from the binding, not the query
    owner(await get('/hello/?at=main&slug=other', { ...NAV, 'sec-fetch-site': 'cross-site' }), 'a cross-site visit: the wrapper, whatever the query says');
    assert.ok((await gw.req('GET', '/w/alpha/hello/?at=main&slug=other', { headers: NAV })).body.includes(`<iframe src="${inst}/view/artifact/hello?at=tree:${tree}&#38;w=`), 'and the wrapper frames the published tree whatever its own query says');
    r = await gw.req('HEAD', '/hello/', { on: 'alpha', headers: NAV });
    assert.deepEqual([r.status, r.body, r.headers.vary, r.headers['cache-control']], [200, '', 'cookie, sec-fetch-dest', 'public, max-age=60'], 'HEAD');
    r = await get('/hello/app.js');
    assert.deepEqual([r.body, r.headers.vary, r.headers['cross-origin-opener-policy']], ['x()', undefined, undefined], 'a file is never wrapped, and its headers are as they were');
    assert.equal((await get('/hello/nope.js')).status, 404, 'nothing published there: still 404');
    // a revalidation by the signed-in owner, the instance answering: the wrapper wins, never a 304 of the plain bytes
    const etag = `"${crypto.createHash('sha256').update(page).digest('hex')}"`;
    r = await get('/hello/', { ...NAV, 'if-none-match': etag });
    assert.deepEqual([r.status, r.headers['cache-control'], r.headers.location], [302, 'no-store, private', `${gw.publicUrl}/w/alpha/hello/`], 'If-None-Match: the wrapper');
    assert.deepEqual([hellos(), hub.hits], [0, hits], 'no visit, with a session or without, asks the instance or the hub anything');
    // the list says whether threads can be had: a kit with viewers, at the bound checkout, as last polled
    const as = async (list, why) => { hub.list = list; await gw.g.pollPush(); plain(await get('/hello/'), why); };
    await as([listing({ viewer: undefined })], 'a kit without viewers');
    await as([listing({ viewer: true })], 'viewer is 1, nothing else');
    await as([listing({ root: '/srv/other' })], 'another checkout of that name');
    await as([listing(), listing({ port: P + 21, root: '/srv/alpha2' })], 'a name two listed projects share');
    await as([], 'not listed');
    // by name and root, not by port: the project's port moved, and the owner still gets the wrapper
    hub.list = [listing({ port: P + 21 })];
    await gw.g.pollPush();
    owner(await get('/hello/'), 'listed on another port');
    assert.ok((await gw.req('GET', '/w/alpha/hello/', { headers: NAV })).body.includes(`<iframe src="${inst}/view/artifact/hello?at=tree:${tree}&#38;w=`), 'and its wrapper');
    // a binding without a root matches no listing (the list's roots are always strings)
    hub.list = [listing()];
    await gw.g.pollPush();
    const rooted = fs.readFileSync(state);
    const nr = JSON.parse(rooted);
    delete nr.public.alpha.root;
    fs.writeFileSync(state, JSON.stringify(nr));
    plain(await get('/hello/'), 'no root in the binding');
    fs.writeFileSync(state, rooted);
    // as last polled, and only then: a change waits for the next poll, and a visit never asks sooner
    owner(await get('/hello/'), 'listed again');
    hub.list = [];
    const before = hub.hits;
    owner(await get('/hello/'), 'still the list as last polled (up to 10 s stale)');
    assert.equal(hub.hits, before, 'a visit never refreshes the list');
    await gw.g.pollPush();
    plain(await get('/hello/'), 'gone at the next poll');
    // the plain path: a revalidation gets a 304, and it varies on the cookie
    r = await get('/hello/', { ...NAV, 'if-none-match': etag });
    assert.deepEqual([r.status, r.headers.vary, r.headers['cross-origin-opener-policy']], [304, 'cookie, sec-fetch-dest', 'same-origin'], 'a 304 for the document has the index\'s headers too');
    seedPublic(gw.dir, 'beta', 'x', { 'index.html': page }, { root: '/srv/alpha', port: P + 20 });
    plain(await gw.req('GET', '/x/', { on: 'beta', headers: NAV }), 'another name, which no project lists: its page plain, whatever port its record names');
    // a state file that can't be read: the owner gets what anyone gets
    const kept = fs.readFileSync(state);
    fs.writeFileSync(state, '{');
    assert.deepEqual([(await get('/hello/')).status, (await get('/hello/', NAV, '')).status], [503, 503]);
    fs.writeFileSync(state, kept);
  } finally { await K.close().catch(() => {}); await gw.close(); await new Promise((res) => hub.srv.close(res)); }
});

// ----- what the box's image is: its release and its tools' pins, from its ENV (boxImage) ------------
test('boxImage reads the image ENV: release and tools in order, or null', () => {
  assert.equal(G.boxImage({}), null, 'a laptop, an older image');
  assert.equal(G.boxImage({ DEVTEAM_KIT_RELEASE: '  ', DEVTEAM_BOX_TOOLS: '' }), null, 'spaces only are unset');
  assert.deepEqual(G.boxImage({ DEVTEAM_KIT_RELEASE: 'v0.52.0' }), { release: 'v0.52.0', tools: {} });
  assert.deepEqual(G.boxImage({ DEVTEAM_BOX_TOOLS: 'gh=2.83.0' }), { release: null, tools: { gh: '2.83.0' } });
  const full = G.boxImage({ DEVTEAM_KIT_RELEASE: ' v0.52.0 ', DEVTEAM_BOX_TOOLS: ' claude-code=2.1.310\tgh=v2.83.0  uv=0.9.9 gh=9 bad=\u001b[31m x=y=z =1 n= \u001b[31m=1 <b>=2 a\u202eb=3 ' });
  assert.deepEqual(full, { release: 'v0.52.0', tools: { 'claude-code': '2.1.310', gh: 'v2.83.0', uv: '0.9.9' } }, 'bad pairs dropped, the first of a name kept');
  assert.deepEqual(Object.keys(full.tools), ['claude-code', 'gh', 'uv'], 'in the ENV\'s order');
  const proto = G.boxImage({ DEVTEAM_BOX_TOOLS: '__proto__=1 gh=2' }).tools;
  assert.deepEqual(Object.keys(proto), ['__proto__', 'gh'], 'a name is a key, whatever it is');
  assert.equal(Object.getPrototypeOf(proto), Object.prototype);
  for (const bad of ['\u001b[31mv1', 'v'.repeat(65), 'v 1', '<b>']) assert.equal(G.boxImage({ DEVTEAM_KIT_RELEASE: bad, DEVTEAM_BOX_TOOLS: 'gh=2' }).release, null, JSON.stringify(bad));
});

test('/box.json names the image: release and tools from the env the gateway is given', async () => {
  const gw = await gateway('boximage', { env: cleared({ DEVTEAM_KIT_RELEASE: 'v9.9.9', DEVTEAM_BOX_TOOLS: 'claude-code=2.1.310 gh=2.83.0' }) });
  try {
    assert.equal((await gw.req('GET', '/box.json')).status, 403, 'unclaimed: no image either');
    assert.equal((await gw.claim(authenticator())).status, 200);
    const b = (await gw.req('GET', '/box.json')).json;
    assert.deepEqual(b.image, { release: 'v9.9.9', tools: { 'claude-code': '2.1.310', gh: '2.83.0' } });
    assert.deepEqual(Object.keys(b), ['box', 'terminal', 'project', 'passkeys', 'previews', 'push', 'image', 'role', 'level', 'people'], 'every field box: 2 has, image, and the owner\'s role, level and People');
    assert.equal(b.box, 2);
    assert.equal((await gw.req('GET', '/box.json', { cookie: '' })).status, 401, 'signed out: nothing');
  } finally { await gw.close(); }
});

test('serve writes image: <release> at start, or image: none', { timeout: 60000 }, async () => {
  const run = async (name, vars) => {
    const home = fs.mkdtempSync(path.join(tmp, `serve-${name}-`));
    const uploads = path.join(home, 'uploads');
    fs.mkdirSync(uploads, { mode: 0o750 });
    const port = await freePort();
    const env = cleared({ HOME: home, DEVTEAM_GATEWAY_DIR: path.join(home, 'gw'), DEVTEAM_UPLOADS_DIR: uploads, DEVTEAM_PUBLIC_URL: `http://box.localhost:${port}`, PORT: String(port), DEVTEAM_TTYD_PORT: String(await freePort()), ...vars });
    const c = spawn(process.execPath, [path.join(here, '..', 'cloud', 'gateway.mjs'), 'serve'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (b) => { out += b; });
    c.stderr.on('data', (b) => { out += b; });
    try {
      const started = Date.now();
      while (!/^image: /m.test(out) && c.exitCode === null && Date.now() - started < 10000) await new Promise((r) => setTimeout(r, 50));
      // written before it listens (the code's order): it comes ahead of the listen line
      while (!/^gateway: .* on :/m.test(out) && c.exitCode === null && Date.now() - started < 10000) await new Promise((r) => setTimeout(r, 50));
      assert.ok(out.indexOf('image: ') < out.search(/^gateway: .* on :/m), `the image line comes before the listen line: ${out}`);
      return /^image: .*$/m.exec(out)?.[0] ?? `(no image line: ${out})`;
    } finally {
      if (c.exitCode === null && c.signalCode === null) await new Promise((r) => { c.once('exit', r); c.kill('SIGTERM'); });
    }
  };
  assert.equal(await run('set', { DEVTEAM_KIT_RELEASE: 'v9.9.9', DEVTEAM_BOX_TOOLS: 'gh=2.83.0' }), 'image: v9.9.9');
  assert.equal(await run('unset', {}), 'image: none');
  assert.equal(await run('tools', { DEVTEAM_BOX_TOOLS: 'gh=2.83.0' }), 'image: none', 'no release is none, never null');
});

test('only boxImage reads DEVTEAM_KIT_RELEASE and DEVTEAM_BOX_TOOLS in gateway.mjs', () => {
  const src = fs.readFileSync(path.join(here, '..', 'cloud', 'gateway.mjs'), 'utf8');
  const fn = G.boxImage.toString();
  const count = (s, w) => s.split(w).length - 1;
  for (const w of ['DEVTEAM_KIT_RELEASE', 'DEVTEAM_BOX_TOOLS']) {
    assert.ok(count(fn, w) >= 1, `boxImage reads ${w}`);
    assert.equal(count(src, w), count(fn, w), `${w} appears nowhere else`);
  }
  assert.match(src, /const BOX_IMAGE = boxImage\(opts\.env \?\? env\);/, 'createGateway computes it once, from the env it is given');
  assert.match(src.split('\n').find((l) => l.includes("p === '/box.json'")), /image: BOX_IMAGE/, '/box.json serves it');
  const serve = src.slice(src.indexOf("if (cmd === 'serve')"), src.indexOf("else if (cmd === 'reclaim')"));
  assert.match(serve, /image: \$\{boxImage\(env\)\?\.release \?\? 'none'\}/, 'the start line goes through it too');
});

// kit-287: on a box the owner's goal approval reaches the dashboard through the gateway's plain proxy
// (it is no signed post), body and all: the press is recorded once, a body the server can't take
// comes back as the server said it, and pressing again after it's recorded records nothing more.
test("a goal's approval pressed through the gateway is recorded once", { timeout: 240000 }, async () => {
  const gw = await gateway('goal-approve', { env: cleared() });
  let d = null;
  let out = '';
  try {
    const base = fs.mkdtempSync(path.join(tmp, 'goal-approve-'));
    const A = bareProject(base, 'alpha');
    const home = path.join(base, 'home');
    const noTmux = path.join(base, 'tmux');
    fs.mkdirSync(home);
    fs.mkdirSync(noTmux);
    const keyFile = path.join(base, 'thread-key.pub');
    fs.writeFileSync(keyFile, gw.g.threadPublicKey());
    // a box as its dashboard sees one, its own HOME, and a tmux with no server
    const env = { ...cleared(), HOME: home, TMUX_TMPDIR: noTmux, DEVTEAM_PUBLIC_URL: 'https://box.example.com', DEVTEAM_GATEWAY_THREAD_KEY: keyFile };
    for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'TMUX', 'TMUX_PANE']) delete env[k];
    const dt = (args) => { const r = spawnSync(process.execPath, [path.join(A, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: A, env: { ...env, DEVTEAM_ROLE: 'supervisor' }, encoding: 'utf8' }); assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
    const G1 = dt(['goal', 'add', '--title', 'Admins pay alone', '--outcome', 'admins pay alone', '--measure', 'self-serve share', '--target', '80', '--unit', '%', '--direction', 'up', '--source', 'prod', '--check', 'echo 5', '--horizon', '2027-03-31', '--non-goals', 'enterprise invoicing', '--preconditions', 'cards work', '--priority', '1']).split('\n')[0].trim();
    dt(['goal', 'reading', G1, '--run']);
    dt(['goal', 'set', G1, '--milestones', JSON.stringify([{ title: 'Most admins pay alone', target: 80, preconditions: [1], tickets: 2 }])]);
    const Q = dt(['ask', '--kind', 'goal-approval', '--goal', G1, '--question', 'Approve the design?', '--recommendation', 'Yes', '--links', JSON.stringify([{ title: 'The design', path: 'docs/devteam/project/designs/x.md' }])]).split('\n')[0].trim();
    const asked = () => JSON.parse(dt(['questions', '--all', '--json'])).find((x) => x.id === Q);
    d = spawn(process.execPath, [path.join(A, 'docs/devteam/scripts/devteam.mjs'), 'dashboard'], { cwd: A, env, stdio: ['ignore', 'pipe', 'pipe'] });
    d.stdout.on('data', (b) => { out += b; });
    d.stderr.on('data', (b) => { out += b; });
    assert.equal((await gw.claim(authenticator())).status, 200);
    // the port the dashboard took, as it says it, never assumed
    const on = Number(await until(() => /dashboard on http:\/\/127\.0\.0\.1:(\d+)/.exec(out)?.[1], `the dashboard (${out})`));
    await until(async () => (await gw.req('GET', '/api/data', { on: 'alpha' })).status === 200, `the hub to list the dashboard on ${on}`);
    const goalDecide = (body) => gw.req('POST', '/api/goal-decide', { on: 'alpha', body, headers: { 'sec-fetch-site': 'same-origin' } });
    // a verdict the server doesn't take: its refusal, as it said it, and nothing recorded
    const bad = await goalDecide({ id: G1, verdict: 'yes' });
    assert.equal(bad.status, 400, bad.body);
    assert.equal(bad.json.error, 'missing or invalid fields');
    assert.equal(asked().status, 'open');
    // the page's own press: recorded, the question answered Approve and the goal ready
    const ok = await goalDecide({ id: G1, verdict: 'approve' });
    assert.equal(ok.status, 200, ok.body);
    assert.equal(ok.json.ok, true, ok.body);
    assert.deepEqual([asked().status, asked().answer], ['answered', 'Approve']);
    const goal = JSON.parse(dt(['goal', 'list', '--json'])).find((g) => g.id === G1);
    assert.equal(goal.status, 'ready');
    // pressed again: refused (nothing is up for approval), and still one decision and one answer
    const again = await goalDecide({ id: G1, verdict: 'approve' });
    assert.equal(again.status, 400, again.body);
    const lines = fs.readdirSync(path.join(A, 'docs/devteam/run/log')).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(A, 'docs/devteam/run/log', f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
    assert.equal(lines.filter((l) => l.type === 'goal' && l.op === 'set' && l.id === G1 && l.decision?.verdict === 'approve').length, 1, 'one decision');
    assert.equal(lines.filter((l) => l.type === 'question' && l.op === 'set' && l.id === Q && l.answer !== undefined).length, 1, 'one answer');
  } finally { if (d) { d.kill(); await new Promise((r) => { if (d.exitCode !== null || d.signalCode !== null) return r(); d.once('exit', r); }); } await gw.close(); }
});

// --- project hosts (project-hosts@1): each project at <project>.<box> ----------------------------
// A box: a signed-in owner, stand-in instances, a hub that lists what the test says. The hub's port
// and the instance block are the gateway's, read when it is imported (HUB and P above); every other
// port, the dev servers' included, is the one the OS gave at listen.
const TOK = crypto.randomBytes(32);
const COOKIE = `devteam_session=${u(TOK)}`;
const PAGE = '<!doctype html><p>published';
const TREE = 'a'.repeat(40);
const art = (title = 't') => ({ tree: TREE, title, at: '2026-11-01T00:00:00.000Z', files: { 'index.html': { sha256: sha(PAGE).toString('hex'), size: Buffer.byteLength(PAGE) } } });
const row = (name, port, over = {}) => ({ devteam: 1, name, root: `/srv/${name}`, port, viewer: 1, ...over });
let manifestProject = 'alpha';
const realTree = () => G.gitTreeId({ 'index.html': { oid: G.gitBlobId(Buffer.from(PAGE)), mode: '100644' } });
const manifest = (slug) => ({ public: 1, project: manifestProject, slug, title: 't', summary: '', root: `/srv/${manifestProject}`, tree: realTree(), files: { 'index.html': { sha256: sha(PAGE).toString('hex'), size: Buffer.byteLength(PAGE), mode: '100644' } } });
const hubAnswer = (r, l) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ hub: 1, instances: l })); };
let boxes = 0;
// given: the box's options, or a function of its dev ports ({ DEV, DEV2 }) that returns them
async function box(given) {
  const dir = path.join(tmp, `project-hosts-${++boxes}`);
  fs.mkdirSync(path.join(dir, 'public', 'blobs'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'public', 'blobs', sha(PAGE).toString('hex')), PAGE);
  const seen = new Map();
  const cookies = []; // the Cookie header of each request a stand-in received
  const pages = new Map(); // a URL, or a path with any query, to what a stand-in answers there
  const stubs = [];
  const hub = { list: [], hits: 0, stall: false, held: [], release() { hub.stall = false; for (const x of hub.held.splice(0)) hubAnswer(x.r, x.list); } };
  // fixed: a port of the instance block; none: the OS's, never the hub's or one in the block
  const stub = async (fixed) => {
    for (let i = 0; i < 5; i++) {
      let port = fixed ?? 0;
      const s = http.createServer((q, r) => {
        seen.get(port).push(q.url);
        cookies.push(q.headers.cookie);
        // a page by its exact URL, or by its path whatever the query; a string, or { body, headers }
        const pg = pages.get(q.url) ?? pages.get(q.url.split('?')[0]);
        if (pg !== undefined) { r.writeHead(200, { 'content-type': 'text/html', ...(pg.headers ?? {}) }); return r.end(typeof pg === 'string' ? pg : pg.body); }
        const slug = /^\/public-manifest\/([^/?]+)$/.exec(q.url)?.[1];
        if (slug) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end(JSON.stringify(manifest(slug))); }
        if (q.url === '/api/artifact-publish') { q.resume(); r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"ok":true}'); }
        if (q.url.startsWith('/artifact/main/') && q.url.endsWith('/index.html') && !q.headers.cookie && !q.headers['sec-fetch-dest']) { hub.onFile?.(q.url); r.writeHead(200); return r.end(PAGE); }
        r.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': `default-src 'self'; frame-src http://127.0.0.1:${P}; frame-ancestors 'self' http://127.0.0.1:${HUB}` });
        return r.end(`port ${port}`);
      });
      await new Promise((ok, no) => { s.once('error', no); s.listen(port, '127.0.0.1', () => { s.off('error', no); ok(); }); });
      port = s.address().port;
      if (fixed === undefined && (port === HUB || (port >= P && port < P + 25))) { await new Promise((ok) => s.close(ok)); continue; }
      seen.set(port, []);
      stubs.push(s);
      return port;
    }
    return assert.fail('no dev port apart from the hub and the instance block');
  };
  await stub(P);
  await stub(P + 1);
  const DEV = await stub();
  const DEV2 = await stub();
  const { list = [row('alpha', P), row('beta-app', P + 1)], published, hubUp = true, poll = true, stall = false } = (typeof given === 'function' ? given({ DEV, DEV2 }) : given) ?? {};
  hub.list = list;
  const now = Date.now();
  const pub = published ?? { alpha: { root: '/srv/alpha', port: P, artifacts: { 'launch-notes': art(), view: art(), review: art() } }, 'beta-app': { root: '/srv/beta-app', port: P + 1, artifacts: { 'beta-notes': art() } } };
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ passkeys: [{ id: 'k1', name: 'k', rp: 'box.localhost', createdAt: new Date(now).toISOString() }], sessions: [{ hash: u(sha(TOK)), method: 'k1', at: now, expires: now + 3600e3 }], pushSubs: [], public: pub }), { mode: 0o600 });
  let hubSrv = null;
  if (hubUp) {
    hubSrv = http.createServer((q, r) => { hub.hits++; if (stall) return; if (hub.stall) { hub.held.push({ r, list: hub.list }); return; } hubAnswer(r, hub.list); });
    await new Promise((ok) => hubSrv.listen(HUB, '127.0.0.1', ok));
  }
  const port = await freePort();
  const ttyd = path.join(dir, 'ttyd.html');
  fs.writeFileSync(ttyd, 'ttyd');
  const uploadsDir = path.join(dir, 'uploads');
  fs.mkdirSync(uploadsDir, { mode: 0o750 });
  const g = G.createGateway({ publicUrl: `http://box.localhost:${port}`, dir, ttydPort: await freePort(), ttydPage: ttyd, uploadsDir, log: () => {} });
  await new Promise((ok) => g.server.listen(port, '127.0.0.1', ok));
  if (hubUp && poll && !stall) await g.pollPush().catch(() => {});
  hub.hits = 0;
  const host = (l) => (l ? `${l}.box.localhost:${port}` : `box.localhost:${port}`);
  const get = (label, route, { cookie = '', headers = {}, method = 'GET', body } = {}) => new Promise((ok, no) => {
    const h = { host: host(label), ...(cookie ? { cookie } : {}), ...headers };
    const r = http.request({ host: '127.0.0.1', port, method, path: route, headers: h, agent: false }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: b })); });
    r.on('error', no);
    r.end(body);
  });
  const close = async () => {
    g.server.closeAllConnections?.();
    await new Promise((ok) => g.server.close(ok));
    for (const s of stubs) { s.closeAllConnections?.(); await new Promise((ok) => s.close(ok)); }
    if (hubSrv) { hubSrv.closeAllConnections?.(); await new Promise((ok) => hubSrv.close(ok)); }
  };
  return { g, port, dir, seen, cookies, pages, hub, host, get, close, DEV, DEV2, origin: (l) => `http://${host(l)}` };
}
const on = (name, opts, fn) => test(name, { timeout: 20000 }, async () => { const b = await box(opts); try { await fn(b); } finally { await b.close(); } });
const shape = (r) => { const headers = { ...r.headers }; delete headers.date; return JSON.stringify({ status: r.status, headers, body: r.body }); };
const handshake = (b, label) => new Promise((ok, no) => {
  const c = net.connect(b.port, '127.0.0.1');
  let got = '';
  c.on('data', (d) => { got += d; });
  c.on('error', no);
  c.on('close', () => ok(got));
  c.write(['GET /hmr HTTP/1.1', `Host: ${b.host(label)}`, `Origin: ${b.origin(label)}`, 'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', '', ''].join('\r\n'));
});
const FX = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'project-hosts.json'), 'utf8'));
const previewOn = (name, port) => ({ name, port, project: 'other', session: 's', label: 'l' });

on('C1 signed in, a project host reaches that port and no other', undefined, async (b) => {
  const r = await b.get('alpha', '/api/data', { cookie: COOKIE });
  assert.equal(r.status, 200, 'alpha host answers signed in');
  assert.deepEqual([b.seen.get(P), b.seen.get(P + 1)], [['/api/data'], []], 'only alpha\'s port was asked');
});
on('C1b signed in, / reaches that project\'s port and no other', undefined, async (b) => {
  const r = await b.get('beta-app', '/', { cookie: COOKIE });
  assert.deepEqual([r.status, b.seen.get(P), b.seen.get(P + 1)], [200, [], ['/']]);
});
on('C2 signed out, a page gets the page that carries location.href to sign-in', undefined, async (b) => {
  const r = await b.get('alpha', '/x?y=1', { headers: NAV });
  const code = [...r.body.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1] ?? '';
  const href = `${b.origin('alpha')}/x?y=1#board?goal=g-1`;
  let to = null;
  vm.runInNewContext(code, { location: { href, pathname: '/x', origin: b.origin('alpha'), replace: (x) => { to = x; } }, encodeURIComponent });
  assert.equal(to, `${b.origin()}/auth/login?next=${encodeURIComponent(href)}`, 'the signed-out page sends the whole address, hash included, to the box\'s sign-in');
});
on('C3 safeNext accepts a project host', undefined, async (b) => {
  const to = `${b.origin('alpha')}/#board`;
  assert.equal(b.g.safeNext(to), to);
});
on('C3b safeNext refuses a look-alike of a project host', undefined, async (b) => {
  const evil = `http://alpha.box.localhost.evil.test:${b.port}/`;
  assert.equal(b.g.safeNext(evil), `${b.origin()}/`);
});
for (const [id, what, route, headers] of [
  ['C4a', 'a page', '/', NAV],
  ['C4b', 'a bad /c/ link', '/c/1.aaaa.bbbb/artifact/main/x/', {}],
  ['C4c', 'a Service-Worker request', '/sw.js', { 'service-worker': 'script', 'sec-fetch-dest': 'serviceworker' }],
  ['C4d', 'a request framed from another site', '/', { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'cross-site' }],
  ['C4e', 'the lens path', '/.devteam/lens', {}],
]) on(`${id} signed out, a listed name and a made-up one answer ${what} alike, and nothing asks the hub`, { list: [row('alpha', P), row('devteam-dev', P + 1)] }, async (b) => {
  const [real, made, realShaped, madeShaped] = [await b.get('alpha', route, { headers }), await b.get('nobody', route, { headers }), await b.get('devteam-dev', route, { headers }), await b.get('madeup-name', route, { headers })];
  assert.notEqual(real.status, 421, 'a well-formed label is not refused as a name');
  assert.equal(shape(real), shape(made));
  assert.equal(shape(realShaped), shape(madeShaped), 'a name of a preview\'s shape too');
  assert.equal(shape(real), shape(realShaped));
  assert.equal(b.hub.hits, 0, 'no read of the hub\'s list');
});
on('C4f a Service-Worker request is refused on a preview\'s host, signed in', ({ DEV }) => ({ list: [row('other', P + 1, { previews: [previewOn('cool-tiger', DEV)] })] }), async (b) => {
  const r = await b.get('cool-tiger', '/sw.js', { cookie: COOKIE, headers: { 'service-worker': 'script', 'sec-fetch-dest': 'serviceworker' } });
  assert.equal(r.status, 403);
  assert.deepEqual(b.seen.get(b.DEV), [], 'and the dev server is not asked');
});
on('C4g a signed-out WebSocket answers a listed and a made-up name alike', { list: [row('alpha', P), row('devteam-dev', P + 1)] }, async (b) => {
  assert.equal(await handshake(b, 'devteam-dev'), await handshake(b, 'madeup-name'), 'on a preview\'s shape');
  assert.equal(await handshake(b, 'alpha'), await handshake(b, 'nobody'), 'on any other label');
  assert.equal(b.hub.hits, 0);
});
test('C4h a bad /c/ link does the same MAC work on an unlisted name', () => {
  const src = fs.readFileSync(path.join(here, '..', 'cloud', 'gateway.mjs'), 'utf8');
  assert.match(src, /const capGood = capOk\(capPort \?\? 0, cm\[4\]/, 'capOk runs before the name is judged');
  assert.doesNotMatch(src, /capPort === null \|\| !capOk/, 'an unlisted name must not skip it');
});
on('C5 a valid /c/ link works on the project host with no cookie', undefined, async (b) => {
  const first = await b.get('alpha', '/artifact/main/mock/index.html', { cookie: COOKIE, headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' } });
  assert.equal(first.status, 302, 'the frame\'s first load is sent under a capability');
  const r = await b.get('alpha', first.headers.location);
  assert.equal(r.status, 200);
  assert.deepEqual(b.seen.get(P), ['/artifact/main/mock/index.html']);
});
// A sandboxed artifact's nested frame: the browser calls it cross-site, and its capability is its only credential.
const CROSS_FRAME = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'cross-site' };
// Every request to this box then carries this cookie, and onSession runs each time sessionOf reads it.
const trapCookie = (b, cookie, onSession) => b.g.server.prependListener('request', (req) => Object.defineProperty(req.headers, 'cookie', { enumerable: true, configurable: true, get() {
  if (new Error().stack.includes('sessionOf')) onSession();
  return cookie;
} }));
const capLink = async (b) => (await b.get('alpha', '/artifact/main/mock/index.html', { cookie: COOKIE, headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' } })).headers.location;
on('C5b a valid capability loads as a cross-site frame, signed out or with a cookie, and the port gets no cookie', undefined, async (b) => {
  const link = await capLink(b);
  const out = await b.get('alpha', link, { headers: CROSS_FRAME });
  const signedIn = await b.get('alpha', link, { cookie: COOKIE, headers: CROSS_FRAME });
  assert.deepEqual([out.status, signedIn.status], [200, 200]);
  assert.deepEqual(b.seen.get(P), ['/artifact/main/mock/index.html', '/artifact/main/mock/index.html']);
  assert.deepEqual(b.cookies, [undefined, undefined], 'the port receives no cookie');
});
on('C5c an expired capability and a bad MAC, as a cross-site frame, answer a listed and a made-up name alike', undefined, async (b) => {
  const [, exp, sid, mac, inner] = /^\/c\/(\d+)\.([\w-]+)\.([\w-]+)(\/.*)$/.exec(await capLink(b));
  for (const bad of [`/c/1.${sid}.${mac}${inner}`, `/c/${exp}.${sid}.${mac[0] === 'A' ? 'B' : 'A'}${mac.slice(1)}${inner}`]) {
    const [real, made] = [await b.get('alpha', bad, { headers: CROSS_FRAME }), await b.get('nobody', bad, { headers: CROSS_FRAME })];
    assert.equal(real.status, 403, bad);
    assert.match(real.body, /artifact link has expired/, 'the capability\'s own refusal');
    assert.equal(shape(real), shape(made), bad);
  }
  assert.deepEqual([b.seen.get(P), b.seen.get(P + 1)], [[], []], 'no port is asked');
});
on('C5d any other /c/ form, as a cross-site frame, keeps the frame refusal and reaches no port', undefined, async (b) => {
  const cap = /^\/c\/[^/]+/.exec(await capLink(b))[0];
  const notRefused = [];
  for (const form of [
    `${cap}/artifact/main/mock%2findex.html`, `${cap}/artifact/main/mock%2Findex.html`,
    `${cap}/artifact/main/mock%5cindex.html`, `${cap}/artifact/main/mock%5Cindex.html`, `${cap}/artifact/main/mock\\index.html`,
    `${cap}/artifact/main/./mock/index.html`, `${cap}/artifact/main/../mock/index.html`, `${cap}/artifact/main/mock/..`,
    `${cap}/artifact/main/%2e/mock/index.html`, `${cap}/artifact/main/%2E/mock/index.html`, `${cap}/artifact/main/%2e%2e/mock/index.html`, `${cap}/artifact/main/.%2E/mock/index.html`,
    `${cap}/artifact/main/mock%252findex.html`, `${cap}/artifact/main/mock%252Findex.html`, `${cap}/artifact/main/mock%255cindex.html`, `${cap}/artifact/main/mock%255Cindex.html`,
    `${cap}/artifact/main/%252e%252e/mock/index.html`, `${cap}/artifact/main/%252E%252E/mock/index.html`, `${cap}/artifact/main/mock%25252findex.html`,
    `${cap}//artifact/main/mock/index.html`, `${cap}/artifact//main/mock/index.html`, `${cap}/artifact/main/mock//index.html`,
    '/c/', '/c/x/artifact/main/mock/index.html', '/c/1.a/artifact/main/mock/index.html', `${cap}/other/x`, cap,
  ]) {
    const asked = b.cookies.length;
    const r = await b.get('alpha', form, { headers: CROSS_FRAME });
    if (r.status !== 403 || r.body !== 'not in another site\'s frame' || b.cookies.length !== asked) notRefused.push(form.replace(cap, '<cap>'));
  }
  // every form that got through, in one run
  assert.deepEqual(notRefused, [], `not refused: ${JSON.stringify(notRefused)}`);
  assert.deepEqual([b.seen.get(P), b.seen.get(P + 1)], [[], []], 'no port is asked');
});
on('C5e the capability route never consults the session, even with a cookie that makes sessionOf throw', undefined, async (b) => {
  const link = await capLink(b);
  let sessionReads = 0;
  trapCookie(b, COOKIE, () => { sessionReads++; throw new Error('sessionOf read the cookie'); });
  const r = await b.get('alpha', link, { headers: CROSS_FRAME });
  assert.equal(r.status, 200);
  assert.equal(sessionReads, 0, 'no sessionOf on the capability route');
  assert.deepEqual(b.cookies, [undefined], 'and the cookie does not reach the port');
  await b.get('alpha', '/api/data');
  assert.ok(sessionReads > 0, 'the trap does fire on a route that reads the session');
});
on('C5f a request served through a valid capability reaches the port with no cookie header, framed or not', undefined, async (b) => {
  const link = await capLink(b);
  const framed = await b.get('alpha', link, { cookie: `app=1; ${COOKIE}`, headers: CROSS_FRAME });
  const plain = await b.get('alpha', link, { cookie: `app=1; ${COOKIE}` });
  assert.deepEqual([framed.status, plain.status], [200, 200]);
  assert.deepEqual(b.cookies, [undefined, undefined], 'no cookie of any name reaches the port');
});
// A draft from another machine: the kit's link encodes the branch into one segment.
const SAME_FRAME = { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' };
const draftAt = (branch, rest = 'mock/nested.html') => `/artifact/origin/${branch}/${rest}`;
on('C5g a cross-site frame keeps the refusal for every encoded form but one branch segment, and reaches no port', undefined, async (b) => {
  const cap = /^\/c\/[^/]+/.exec(await capLink(b))[0];
  const notRefused = [];
  for (const inner of [
    draftAt('ticket%252Fkit-1'), draftAt('ticket%252fkit-1'),
    draftAt('ticket%2Fkit%2e1'), draftAt('ticket%2Fkit%2E1'), draftAt('ticket%2e%2Fkit-1'),
    draftAt('ticket%5ckit-1'), draftAt('ticket%2Fkit%5C1'),
    draftAt('ticket%2F..%2Fkit-1'), draftAt('..%2Fkit-1'), draftAt('ticket%2F%2e%2e%2Fkit-1'), draftAt('ticket%2F..'),
    draftAt('a%2F%2Fb'), draftAt('a%2f%2fb'), draftAt('%2Fa'), draftAt('a%2F'),
    draftAt('ticket%2F.hidden'), draftAt('ticket%2Fkit.lock'), draftAt('ticket%2Fkit%2D1'), draftAt('ticket%2Fkit 1'.replace(' ', '%20')),
    draftAt('ticket%2Fkit-1', 'mo%2Fck/nested.html'), draftAt('ticket%2Fkit-1', 'mo%2fck/nested.html'), draftAt('ticket%2Fkit-1', 'mock/a%2Fb.html'), draftAt('ticket%2Fkit-1', 'mock/a%41.html'),
    draftAt('main', 'mo%2Fck/nested.html'),
    draftAt('ticket%25%32%46kit-1'), draftAt('ticket%252%46kit-1'), draftAt('ticket%25%32Fkit-1'), draftAt('ticket%25%35%43kit-1'), draftAt('pl%61in-1'),
    draftAt('main', 'mo%63k/nested.html'), draftAt('main', 'mock/%25%32%46.html'), '/artifact/main/mo%63k/nested.html', '/artifact/main/mo%25%32%46ck/nested.html',
    draftAt('a..b'), draftAt('plain.lock'),
    draftAt('ticket%2Fkit-1', 'mock/../x.html'), draftAt('ticket%2Fkit-1', 'mock/./x.html'), draftAt('ticket%2Fkit-1', 'mock//x.html'), draftAt('ticket%2Fkit-1', 'mock/a\\b.html'),
    '/artifact/main/mo%2Fck/nested.html', '/artifact/wt/a%2Fb/mock/nested.html', `/artifact/tree/${TREE}/mo%2Fck/nested.html`, '/artifact/other%2Fx/mock/nested.html', '/artifact/origin%2Fx/mock/nested.html',
  ]) {
    // under a link minted for this very path where the gateway mints one, so only the frame rule can refuse it
    const minted = (await b.get('alpha', inner, { cookie: COOKIE, headers: SAME_FRAME })).headers.location;
    const asked = b.cookies.length;
    const r = await b.get('alpha', minted?.startsWith('/c/') ? minted : `${cap}${inner}`, { headers: CROSS_FRAME });
    if (r.status !== 403 || r.body !== 'not in another site\'s frame' || b.cookies.length !== asked) notRefused.push(inner);
  }
  assert.deepEqual(notRefused, [], `not refused: ${JSON.stringify(notRefused)}`);
});
on('C5h a ticket/<id> draft\'s capability loads as a cross-site frame, and the port gets exactly the path approved', undefined, async (b) => {
  for (const branch of ['ticket%2Fkit-1', 'ticket%2fkit-1']) {
    const inner = draftAt(branch);
    const link = (await b.get('alpha', inner, { cookie: COOKIE, headers: SAME_FRAME })).headers.location;
    assert.ok(link?.endsWith(inner), 'the link carries the raw path');
    const r = await b.get('alpha', link, { headers: CROSS_FRAME });
    assert.equal(r.status, 200, branch);
    assert.equal(b.seen.get(P).at(-1), inner, 'the same bytes, so the kit decodes the same segment to the same branch');
    assert.equal(b.cookies.at(-1), undefined);
  }
});
test('C5i the gateway\'s BRANCH_AT is the kit\'s, character for character', () => {
  const of = (file) => /^const BRANCH_AT = (.+);$/m.exec(fs.readFileSync(path.join(here, '..', file), 'utf8'))?.[1];
  const kit = of('docs/devteam/scripts/devteam.mjs');
  assert.ok(kit, 'the kit defines it');
  assert.equal(of('cloud/gateway.mjs'), kit);
});
// A stand-in page, checking the gateway's half only: the stand-in instance sends no kit policy, so its
// frame loads where a real artifact's nested frame would be blocked by the kit's CSP. A real
// ticket/<id> draft's link click, location.href and reload, and that check of the kit's CSP, are C5l
// and C5m, through mapLoop.
test('C5j in Chrome, a stand-in page under a ticket/<id> draft\'s capability: the gateway lets its cross-site frame request through', { skip: !canDrive, timeout: 90000 }, async () => {
  const b = await box();
  const chrome = await openChrome();
  try {
    const index = draftAt('ticket%2Fkit-1', 'mock/index.html');
    const nested = draftAt('ticket%2Fkit-1', 'mock/nested.html');
    b.pages.set('/draft-host', `<!doctype html><iframe sandbox="allow-scripts" src="${index}"></iframe>`);
    b.pages.set(index, '<!doctype html><iframe src="nested.html"></iframe>');
    b.pages.set(nested, '<!doctype html><p>nested</p>');
    const page = await chrome.newPage();
    await page.send('Network.enable');
    await page.send('Network.setCookie', { name: 'devteam_session', value: u(TOK), url: `${b.origin('alpha')}/` });
    await page.send('Page.navigate', { url: `${b.origin('alpha')}/draft-host` });
    for (let i = 0; i < 100 && !b.seen.get(P).includes(nested); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(b.seen.get(P).includes(index), `the draft itself loads: ${JSON.stringify(b.seen.get(P))}`);
    assert.ok(b.seen.get(P).includes(nested), `its nested frame is requested: ${JSON.stringify(b.seen.get(P))}`);
    assert.equal(b.cookies[b.seen.get(P).indexOf(nested)], undefined, 'with no cookie');
  } finally { await chrome.close(); await b.close(); }
});
on('C5k a frame on another site can\'t load a signed link for a page it wasn\'t given', undefined, async (b) => {
  const mint = async (inner) => (await b.get('alpha', inner, { cookie: COOKIE, headers: SAME_FRAME })).headers.location;
  const slugA = await mint('/artifact/main/mock/index.html');
  const branchA = await mint(draftAt('ticket%2Fkit-1', 'mock/index.html'));
  const [, exp, sid] = /^\/c\/(\d+)\.([\w-]+)\./.exec(slugA);
  const tries = {
    'another slug, slug A\'s token': slugA.replace('/main/mock/', '/main/other/'),
    'another branch, branch A\'s token': branchA.replace('ticket%2Fkit-1', 'ticket%2Fkit-2'),
    'a made-up MAC': `/c/${exp}.${sid}.${'A'.repeat(22)}/artifact/main/mock/index.html`,
  };
  const sigs = [];
  const notRefused = [];
  for (const [what, link] of Object.entries(tries)) {
    const asked = b.cookies.length;
    const r = await b.get('alpha', link, { headers: CROSS_FRAME });
    if (r.status !== 403 || b.cookies.length !== asked) notRefused.push(what);
    else sigs.push(shape(r));
  }
  const asked = b.cookies.length;
  const bare = await b.get('alpha', '/artifact/main/mock/index.html', { headers: CROSS_FRAME });
  if (bare.status !== 403 || bare.body !== 'not in another site\'s frame' || b.cookies.length !== asked) notRefused.push('no capability at all');
  // every case that got through, in one run
  assert.deepEqual(notRefused, [], `not refused: ${JSON.stringify(notRefused)}`);
  assert.equal(new Set(sigs).size, 1, 'the signed links get one and the same refusal');
  assert.deepEqual([b.seen.get(P), b.seen.get(P + 1)], [[], []], 'no port is asked');
});
on('C6 /healthz is the gateway\'s ok on a project label of a preview\'s shape', { list: [row('devteam-dev', P)] }, async (b) => {
  const r = await b.get('devteam-dev', '/healthz');
  assert.deepEqual([r.status, r.body], [200, 'ok']);
  assert.deepEqual(b.seen.get(P), [], 'never the port');
});
on('C6b /healthz is the gateway\'s ok on a made-up label and on 127.0.0.1:<port>', undefined, async (b) => {
  const made = await b.get('nobody', '/healthz');
  assert.deepEqual([made.status, made.body], [200, 'ok'], 'a made-up label');
  const boot = await b.get(null, '/healthz', { headers: { host: `127.0.0.1:${b.port}` } });
  assert.deepEqual([boot.status, boot.body], [200, 'ok'], 'the boot check');
});
on('C6c a signed-out /healthz reads the cookie through sessionOf alike on a live preview, a project and a made-up name', ({ DEV }) => ({ list: [row('alpha', P), row('other', P + 1, { previews: [previewOn('cool-tiger', DEV)] })] }), async (b) => {
  let reads = 0;
  trapCookie(b, `devteam_session=${u(crypto.randomBytes(32))}`, () => { reads++; });
  const counts = {};
  for (const name of ['cool-tiger', 'alpha', 'nobody']) {
    reads = 0;
    const r = await b.get(name, '/healthz');
    assert.deepEqual([r.status, r.body], [200, 'ok'], name);
    counts[name] = reads;
  }
  assert.ok(counts.nobody > 0, 'the session work is done');
  assert.deepEqual(counts, { 'cool-tiger': counts.nobody, alpha: counts.nobody, nobody: counts.nobody }, 'the same work on every name');
  assert.deepEqual(b.seen.get(b.DEV), [], 'and the dev server is not asked');
});
on('C7 a published page answers signed out under the public policy, never from the port', undefined, async (b) => {
  const r = await b.get('alpha', '/launch-notes/', { headers: NAV });
  assert.deepEqual([r.status, r.body], [200, PAGE], 'the published bytes');
  const csp = r.headers['content-security-policy'];
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /sandbox allow-scripts/);
  assert.doesNotMatch(csp, /allow-same-origin/);
  assert.ok(csp.includes(`img-src ${b.origin('alpha')}/launch-notes/ `), 'self is this page\'s folder, not the host (the dashboard\'s paths stay out)');
  assert.equal(r.headers['cross-origin-opener-policy'], 'same-origin');
  assert.match(r.headers.vary, /cookie/);
  assert.deepEqual(b.seen.get(P), []);
});
on('C8 signed in, the /w/ page on the box frames the viewer on the project\'s host', undefined, async (b) => {
  const r = await b.get(null, '/w/alpha/launch-notes/', { cookie: COOKIE, headers: NAV });
  assert.match(r.body, new RegExp(`<iframe src="${b.origin('alpha')}/view/artifact/launch-notes\\?at=tree:${TREE}&#38;w=\\d+\\.`), 'frames the viewer on alpha\'s host');
  assert.match(r.headers['content-security-policy'], new RegExp(`frame-src ${b.origin('alpha')};`));
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.deepEqual(b.seen.get(P), [], 'the wrapper asks the port nothing');
});
on('C9 ?plain gets the public bytes, signed in', undefined, async (b) => {
  const r = await b.get('alpha', '/launch-notes/?plain', { cookie: COOKIE, headers: NAV });
  assert.deepEqual([r.status, r.body], [200, PAGE]);
});
on('C10 a page stored under a reserved segment is not served; the dashboard answers behind the session', undefined, async (b) => {
  const out = await b.get('alpha', '/view/', { headers: { accept: 'text/html' } });
  assert.notEqual(out.body, PAGE, 'not the stored page, signed out');
  assert.notEqual(out.status, 421, 'the host answers');
  const r = await b.get('alpha', '/view/', { cookie: COOKIE });
  assert.deepEqual([r.status, b.seen.get(P)], [200, ['/view/']], 'reaches the dashboard');
});
on('C10b a page stored under review is not served either', undefined, async (b) => {
  const out = await b.get('alpha', '/review/', { headers: { accept: 'text/html' } });
  assert.notEqual(out.body, PAGE, 'not the stored page, signed out');
  const r = await b.get('alpha', '/review/', { cookie: COOKIE });
  assert.deepEqual([r.status, b.seen.get(P)], [200, ['/review/']], 'reaches the dashboard');
});
on('C11 another project\'s slug answers 404 signed in', undefined, async (b) => {
  // signed out it says nothing of which slugs other projects published: the same bytes as any unpublished path
  for (const headers of [{}, NAV]) assert.equal(shape(await b.get('alpha', '/beta-notes/', { headers })), shape(await b.get('alpha', '/nope/', { headers })), `signed out, ${headers === NAV ? 'a navigation' : 'a fetch'}: as an unpublished path`);
  const r = await b.get('alpha', '/beta-notes/', { cookie: COOKIE });
  assert.equal(r.status, 404);
  assert.deepEqual(b.seen.get(P), [], 'and the port is not asked');
  const bare = await b.get('alpha', '/beta-notes', { cookie: COOKIE });
  assert.deepEqual([bare.status, b.seen.get(P)], [200, ['/beta-notes']], 'with no trailing slash it is the dashboard\'s path');
});
// kit-276 F1: a page another project stored under upload before it was reserved does not take /upload/.
on('C11b /upload stays the gateway\'s on a project host, whatever another project stored as upload', { published: { alpha: { root: '/srv/alpha', port: P, artifacts: { 'launch-notes': art() } }, 'beta-app': { root: '/srv/beta-app', port: P + 1, artifacts: { upload: art() } } } }, async (b) => {
  const put = await b.get('alpha', '/upload?name=a.txt', { method: 'POST', cookie: COOKIE, headers: { origin: b.origin('alpha'), 'content-type': 'application/octet-stream', 'content-length': 2 }, body: 'hi' });
  assert.equal(put.status, 200, put.body);
  const stored = JSON.parse(put.body).path;
  const back = await b.get('alpha', `/upload/${path.basename(path.dirname(stored))}/a.txt`, { cookie: COOKIE });
  assert.deepEqual([back.status, back.body], [200, 'hi'], 'served back by the gateway');
  assert.deepEqual(b.seen.get(P), [], 'never the port');
});
on('C13 after the project\'s port moves, the owner still gets the /w/ page', { list: [row('alpha', P + 1)] }, async (b) => {
  const r = await b.get(null, '/w/alpha/launch-notes/', { cookie: COOKIE, headers: NAV });
  assert.match(r.body, /\/view\/artifact\/launch-notes\?at=tree:/, 'the wrapper, by name and root');
  assert.equal((await b.get('alpha', '/launch-notes/', { cookie: COOKIE, headers: NAV })).status, 302, 'and the visit is sent there');
});
// CI run 45001674968: Node 19+ keeps the global agent's sockets alive, so a list read reused the
// socket of the read before it, which the hub (here a restarted one) had closed: the read failed, the
// list was taken as empty, and the /w/ page, which asks nothing on the request path, answered 404
// until the next poll. A hub that closes a connection after one answer stands in for that.
on('C13b each read of the hub\'s list is a connection of its own: a socket the hub closed is never reused', { hubUp: false }, async (b) => {
  const sockets = new Set();
  const hubSrv = http.createServer((q, r) => {
    if (sockets.has(q.socket)) return q.socket.destroy();
    sockets.add(q.socket);
    hubAnswer(r, [row('alpha', P)]);
  });
  await new Promise((ok) => hubSrv.listen(HUB, '127.0.0.1', ok));
  try {
    for (let i = 1; i <= 3; i++) {
      await b.g.pollPush();
      const r = await b.get(null, '/w/alpha/launch-notes/', { cookie: COOKIE, headers: NAV });
      assert.equal(r.status, 200, `read ${i}: the list holds alpha`);
    }
    assert.equal(sockets.size, 3, 'three reads, three connections');
  } finally { hubSrv.closeAllConnections(); await new Promise((ok) => hubSrv.close(ok)); }
});
// The owner's wrapper on the hub origin (ruling a-20261122-073738459): the dashboard stops itself
// when framed by its own origin, so the wrapper lives on the box's name and frames the project's host.
const WRAP_AT = `tree:${TREE}`;
const faOf = (r) => String(r.headers['content-security-policy']).split(/;\s*/).find((d) => d.startsWith('frame-ancestors'));
// the viewer's frame load from the /w/ page: the box and the project's host are one site
const FROM_W = { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate' };
on('C41 a signed-in owner\'s document visit is a 302 to <box>/w/<project>/<slug>/; signed out or ?plain keeps the public bytes', undefined, async (b) => {
  for (const route of ['/launch-notes/', '/launch-notes/index.html']) {
    const r = await b.get('alpha', route, { cookie: COOKIE, headers: NAV });
    assert.deepEqual([r.status, r.headers.location, r.body], [302, `${b.origin()}/w/alpha/launch-notes/`, ''], route);
    assert.equal(r.headers['cache-control'], 'no-store, private', `${route}: never kept`);
    assert.equal(r.headers.vary, 'cookie, sec-fetch-dest', `${route}: it varies on the cookie`);
  }
  const out = await b.get('alpha', '/launch-notes/', { headers: NAV });
  assert.deepEqual([out.status, out.body], [200, PAGE], 'signed out: the public bytes');
  const plain = await b.get('alpha', '/launch-notes/?plain', { cookie: COOKIE, headers: NAV });
  assert.deepEqual([plain.status, plain.body], [200, PAGE], '?plain: the public bytes');
  const framed = await b.get('alpha', '/launch-notes/', { cookie: COOKIE, headers: { ...NAV, 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' } });
  assert.deepEqual([framed.status, framed.body], [200, PAGE], 'a frame load: the public bytes');
  assert.deepEqual(b.seen.get(P), [], 'the port is never asked');
});
on('C42 the /w/ page: signed in only, no artifact bytes, x-frame-options DENY, frame-src exactly the project\'s origin, framing the viewer with its grant', undefined, async (b) => {
  const r = await b.get(null, '/w/alpha/launch-notes/', { cookie: COOKIE, headers: NAV });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-security-policy'], `default-src 'none'; style-src 'unsafe-inline'; frame-src ${b.origin('alpha')}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
  assert.deepEqual([r.headers['x-frame-options'], r.headers['cache-control'], r.headers['referrer-policy'], r.headers['cross-origin-opener-policy']], ['DENY', 'no-store, private', 'no-referrer', 'same-origin']);
  assert.ok(!r.body.includes('<p>published'), 'no artifact bytes of its own');
  assert.doesNotMatch(r.body, /<script/i, 'no script');
  const src = /<iframe src="([^"]+)"/.exec(r.body)[1].replace(/&#38;|&amp;/g, '&');
  const w = new URL(src).searchParams.get('w');
  assert.equal(src, `${b.origin('alpha')}/view/artifact/launch-notes?at=${WRAP_AT}&w=${w}`, 'the viewer at the published tree, on the project\'s host');
  assert.match(w, /^\d+\.[\w-]{22}$/);
  assert.ok(r.body.includes(`<a href="${b.origin('alpha')}/launch-notes/?plain">Open it as the public sees it</a>`), 'the plain link goes to the project\'s host');
  // signed out: no page, and nothing of it
  const out = await b.get(null, '/w/alpha/launch-notes/', { headers: NAV });
  assert.equal(out.status, 302, 'signed out: to sign-in');
  assert.ok(!out.body.includes('<iframe'), 'no wrapper');
  assert.deepEqual(b.seen.get(P), [], 'the port is never asked');
});
on('C43 under a valid grant the viewer\'s frame-ancestors gains exactly the hub origin', undefined, async (b) => {
  const page = await b.get(null, '/w/alpha/launch-notes/', { cookie: COOKIE, headers: NAV });
  const src = /<iframe src="([^"]+)"/.exec(page.body)[1].replace(/&#38;|&amp;/g, '&');
  const r = await b.get('alpha', new URL(src).pathname + new URL(src).search, { cookie: COOKIE, headers: FROM_W });
  assert.equal(r.status, 200);
  assert.equal(faOf(r), `frame-ancestors 'self' ${b.origin()}`, 'the hub origin, no wildcard, no other project');
  assert.doesNotMatch(String(r.headers['content-security-policy']), /\*|beta-app/);
});
on('C44 a missing, bad-mac, expired, other-slug, other-project or other-tree grant adds no ancestor', undefined, async (b) => {
  const good = b.g.wrapGrant('alpha', 'launch-notes', WRAP_AT);
  const viewer = (w, { at = WRAP_AT, slug = 'launch-notes', extra = '' } = {}) => `/view/artifact/${slug}?at=${at}${w === null ? '' : `&w=${w}`}${extra}`;
  const [exp, sig] = good.split('.');
  const flip = (c) => (c === 'A' ? 'B' : 'A');
  const other = `tree:${'b'.repeat(40)}`;
  const bad = {
    'no grant': viewer(null),
    'an empty grant': viewer(''),
    'a bad mac': viewer(`${exp}.${sig.slice(0, -1)}${flip(sig.at(-1))}`),
    'a moved expiry': viewer(`${Number(exp) + 60000}.${sig}`),
    'an expired grant': viewer(b.g.wrapGrant('alpha', 'launch-notes', WRAP_AT, Date.now() - 1)),
    'a grant good for a day': viewer(b.g.wrapGrant('alpha', 'launch-notes', WRAP_AT, Date.now() + 86400000)),
    'another slug\'s grant': viewer(b.g.wrapGrant('alpha', 'other-notes', WRAP_AT)),
    'another project\'s grant': viewer(b.g.wrapGrant('beta-app', 'launch-notes', WRAP_AT)),
    'another tree\'s grant': viewer(b.g.wrapGrant('alpha', 'launch-notes', other)),
    'a grant at main': viewer(b.g.wrapGrant('alpha', 'launch-notes', 'main'), { at: 'main' }),
    'a second at': viewer(good, { extra: `&at=${other}` }),
    'a second grant': viewer(good, { extra: `&w=${good}` }),
    'a dot segment the kit resolves to the viewer': `/view/x/../artifact/launch-notes?at=${WRAP_AT}&w=${good}`,
  };
  // every case that admits the box, in one run
  const admitted = [];
  for (const [why, v] of Object.entries(bad)) if (faOf(await b.get('alpha', v, { cookie: COOKIE, headers: FROM_W })) !== "frame-ancestors 'self'") admitted.push(why);
  // alpha's own grant on another project's host: beta-app's viewer
  if (faOf(await b.get('beta-app', `/view/artifact/launch-notes?at=${WRAP_AT}&w=${good}`, { cookie: COOKIE, headers: FROM_W })) !== "frame-ancestors 'self'") admitted.push('alpha\'s grant on beta-app\'s host');
  assert.deepEqual(admitted, [], `the box admitted under: ${JSON.stringify(admitted)}`);
  assert.equal(faOf(await b.get('alpha', viewer(good), { cookie: COOKIE, headers: FROM_W })), `frame-ancestors 'self' ${b.origin()}`, 'and the good grant still admits it');
  // and every other path of the dashboard keeps today's ancestors: the hub frames the dashboard
  assert.equal(faOf(await b.get('alpha', '/', { cookie: COOKIE })), `frame-ancestors 'self' ${b.origin()}`, 'the dashboard itself');
  assert.equal(faOf(await b.get('alpha', '/view/preview/cool-tiger', { cookie: COOKIE })), `frame-ancestors 'self' ${b.origin()}`, 'a preview\'s viewer');
});
on('C46 /w/ for an unknown project or an unpublished slug answers as any other unknown, and signed out tells nothing', { list: [row('alpha', P), row('beta-app', P + 1), row('twin', P), row('twin', P + 1, { root: '/srv/twin2' })], published: { alpha: { root: '/srv/alpha', port: P, artifacts: { 'launch-notes': art() } }, 'beta-app': { root: '/srv/beta-app', port: P + 1, artifacts: { 'beta-notes': art() } }, twin: { root: '/srv/twin', port: P, artifacts: { 'twin-notes': art() } } } }, async (b) => {
  const unknown = shape(await b.get(null, '/no-such-page', { cookie: COOKIE, headers: NAV }));
  const hits = b.hub.hits;
  for (const route of ['/w/nobody/launch-notes/', '/w/alpha/nope/', '/w/alpha/beta-notes/', '/w/beta-app/launch-notes/', '/w/twin/twin-notes/', '/w/Alpha/launch-notes/', '/w/alpha/launch-notes', '/w/alpha/launch-notes/x', '/w/alpha/', '/w/4321/launch-notes/'])
    assert.equal(shape(await b.get(null, route, { cookie: COOKIE, headers: NAV })), unknown, `signed in: ${route}`);
  // signed out: a real page and a made-up one alike, sent to sign-in with their own address, as any hub path is
  const out = (route, headers) => b.get(null, route, { headers }).then((r) => shape({ ...r, headers: { ...r.headers, location: r.headers.location?.replace(encodeURIComponent(route), '<route>') } }));
  for (const headers of [NAV, {}]) {
    const want = await out('/no-such-page/a/b/', headers);
    for (const route of ['/w/alpha/launch-notes/', '/w/nobody/launch-notes/', '/w/alpha/nope/'])
      assert.equal(await out(route, headers), want, `signed out, ${headers === NAV ? 'a navigation' : 'a fetch'}: ${route}`);
  }
  assert.equal(b.hub.hits, hits, 'no hub read');
  assert.deepEqual([b.seen.get(P), b.seen.get(P + 1)], [[], []], 'no port is asked');
});
// C45 in Chrome: a stand-in viewer carrying the kit's own guard (index.html's first script, which stops
// a dashboard framed by its own origin) and the kit's policy, framing an artifact at the published tree.
const KIT_GUARD = /<script>\n\/\/ Framed by a page of its own origin[\s\S]*?<\/script>/.exec(fs.readFileSync(path.join(kit, 'dashboard', 'index.html'), 'utf8'))?.[0];
test('C45 in Chrome, the owner\'s visit lands on the hub\'s /w/ page, the viewer and the artifact render; a bad grant\'s frame is blocked', { skip: !canDrive, timeout: 90000 }, async () => {
  assert.ok(KIT_GUARD && KIT_GUARD.includes('window.frameElement'), 'the kit\'s own frame guard');
  const b = await box();
  const chrome = await openChrome();
  // What Chrome says it refused. Where a blocked frame's error page lives depends on the version (from
  // 158 it is a target of its own, out of the page's frame tree), so the frame tree can't show it.
  const reports = [];
  const reportSrv = http.createServer((q, r) => { let x = ''; q.on('data', (c) => { x += c; }); q.on('end', () => { reports.push(JSON.parse(x)['csp-report']); r.end(); }); });
  await new Promise((ok) => reportSrv.listen(0, '127.0.0.1', ok));
  try {
    const kitCsp = { 'content-security-policy': `default-src 'none'; script-src 'unsafe-inline'; frame-src 'self'; frame-ancestors 'self' http://127.0.0.1:${HUB}; report-uri http://127.0.0.1:${reportSrv.address().port}/r` };
    b.pages.set('/view/artifact/launch-notes', { headers: kitCsp, body: `<!doctype html><html><head>${KIT_GUARD}</head><body><p id="v">the viewer</p><iframe id="av-frame" sandbox="${AV_SANDBOX}" src="/artifact/tree/${TREE}/launch-notes/"></iframe></body></html>` });
    b.pages.set(`/artifact/tree/${TREE}/launch-notes/`, { headers: { 'content-security-policy': `default-src 'none'; img-src http://127.0.0.1:${P}/artifact/tree/${TREE}/launch-notes/; frame-ancestors http://127.0.0.1:${P} http://127.0.0.1:${HUB}; sandbox allow-scripts` }, body: '<!doctype html><p id="art">the artifact</p><img src="dot.png">' });
    const page = await chrome.newPage();
    await page.send('Network.enable');
    await page.send('Runtime.enable');
    for (const at of [b.origin(), b.origin('alpha')]) await page.send('Network.setCookie', { name: 'devteam_session', value: u(TOK), url: `${at}/` });
    await page.send('Page.navigate', { url: `${b.origin('alpha')}/launch-notes/` });
    const dot = `/artifact/tree/${TREE}/launch-notes/dot.png`;
    for (let i = 0; i < 100 && !b.seen.get(P).includes(dot); i++) await sleep(100);
    assert.equal(await page.ev('location.href'), `${b.origin()}/w/alpha/launch-notes/`, 'the owner lands on the hub\'s /w/ page');
    const shown = await page.evIn(b.origin('alpha'), 'document.body.textContent').catch((e) => String(e));
    assert.equal(shown.trim(), 'the viewer', 'the viewer renders: it is not framed by its own origin');
    assert.ok(b.seen.get(P).includes(dot), `the artifact renders, its image asked for: ${JSON.stringify(b.seen.get(P))}`);
    // a bad grant: the same frame, its grant's mac changed, is blocked by the viewer's ancestors
    const good = await page.ev('document.querySelector(\'iframe\').src');
    const badUrl = good.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    assert.deepEqual(reports, [], 'the good grant\'s frame was refused nothing');
    await page.ev(`(document.querySelector('iframe').src = ${JSON.stringify(badUrl)}, true)`);
    for (let i = 0; i < 100 && !reports.length; i++) await sleep(100);
    assert.deepEqual(reports.map((x) => [x['effective-directive'], x.disposition, x['blocked-uri']]), [['frame-ancestors', 'enforce', `${b.origin('alpha')}/`]], 'the bad grant\'s frame is blocked by the viewer\'s ancestors');
    assert.ok(b.seen.get(P).some((x) => badUrl.endsWith(x)), 'the viewer answered, and the browser refused to show it');
  } finally { await chrome.close(); reportSrv.closeAllConnections(); await new Promise((ok) => reportSrv.close(ok)); await b.close(); }
});
on('C15 a shared name gets no dashboard, and its stored page still answers signed out', { list: [row('twin', P), row('twin', P + 1, { root: '/srv/twin2' })], published: { twin: { root: '/srv/twin', port: P, artifacts: { 'twin-notes': art() } } } }, async (b) => {
  assert.deepEqual((await b.get('twin', '/twin-notes/', { headers: NAV })).body, PAGE);
  await b.get('twin', '/api/data', { cookie: COOKIE });
  assert.deepEqual([b.seen.get(P), b.seen.get(P + 1)], [[], []], 'neither port');
});
on('C20 hub down: a stored page answers; signed in, a private path says the hub or the project is not running', { hubUp: false }, async (b) => {
  assert.equal((await b.get('alpha', '/launch-notes/', { headers: NAV })).body, PAGE);
  const r = await b.get('alpha', '/', { cookie: COOKIE, headers: NAV });
  assert.match(r.body, /isn.t running/);
});
on('C20b the hub answers an empty list: a stored page answers, a private path says not running', { list: [] }, async (b) => {
  assert.equal((await b.get('alpha', '/launch-notes/', { headers: NAV })).body, PAGE);
  assert.match((await b.get('alpha', '/', { cookie: COOKIE, headers: NAV })).body, /alpha isn.t running/);
});
for (const l of ['4321', 'public', 'www', 'a_b', '-app', 'DevTeam']) on(`C14 ${l}.<box> answers 421`, undefined, async (b) => {
  assert.equal((await b.get(l, '/', { cookie: COOKIE })).status, 421);
});
on('C14b the block\'s own port as a label answers 421', undefined, async (b) => {
  assert.equal((await b.get(String(P), '/', { cookie: COOKIE })).status, 421);
});
test('C14c every label case in the fixture resolves as it says, a 421 with no hub read', { timeout: 60000 }, async () => {
  const cases = [...FX.labelCases, { name: 'cool-tiger', projects: ['cool-tiger', 'cool-tiger'], previews: ['cool-tiger'], expect: 'shared' }];
  for (const c of cases) {
    if (c.name === 'term') continue; // the terminal's own name
    const names = c.projects ?? (c.expect === 'refused' ? [] : [c.name]);
    const b = await box(({ DEV, DEV2 }) => {
      const previews = (c.previews ?? []).map((name, i) => ({ name, port: [DEV, DEV2][i], project: 'host', session: 's', label: 'l' }));
      const list = names.map((n, i) => row(n, P + i, { root: `/srv/${n}-${i}` }));
      if (previews.length) list.push(row('host', P + 2, { previews }));
      return { list };
    });
    try {
      const say = `case ${JSON.stringify(c)}`;
      const r = await b.get(null, '/', { cookie: COOKIE, headers: { host: `${c.name}.box.localhost:${b.port}`, ...NAV } });
      const hit = (port) => b.seen.get(port).length;
      if (c.expect === 'refused') { assert.equal(r.status, 421, say); assert.equal(b.hub.hits, 0, `${say}: at once`); }
      if (c.expect === 'project') assert.deepEqual([r.status, hit(P)], [200, 1], say);
      if (c.expect === 'shared') assert.deepEqual([r.status, hit(P), hit(P + 1), hit(b.DEV)], [503, 0, 0, 0], say);
      if (c.expect === 'preview') assert.deepEqual([r.status, hit(b.DEV)], [200, 1], say);
      if (c.expect === 'unknown') assert.deepEqual([r.status, hit(P), b.hub.hits], [503, 0, 1], say);
    } finally { await b.close(); }
  }
});
on('C16 a listed preview answers; a project of the same shape is the project', ({ DEV }) => ({ list: [row('devteam-dev', P), row('other', P + 1, { previews: [previewOn('cool-tiger', DEV)] })] }), async (b) => {
  const r = await b.get('devteam-dev', '/api/data', { cookie: COOKIE });
  assert.deepEqual([r.status, b.seen.get(P)], [200, ['/api/data']], 'the project wins over the shape');
});
on('C16b a listed preview reaches its own server', ({ DEV }) => ({ list: [row('other', P + 1, { previews: [previewOn('cool-tiger', DEV)] })] }), async (b) => {
  const r = await b.get('cool-tiger', '/x', { cookie: COOKIE });
  assert.deepEqual([r.status, b.seen.get(b.DEV)], [200, ['/x']]);
});
on('C17 a project listed since the poll is found after exactly one shared re-read', { list: [] }, async (b) => {
  b.hub.list = [row('alpha', P)];
  const rs = await Promise.all([b.get('alpha', '/a', { cookie: COOKIE }), b.get('alpha', '/b', { cookie: COOKIE }), b.get('alpha', '/c', { cookie: COOKIE })]);
  assert.deepEqual(rs.map((r) => r.status), [200, 200, 200]);
  assert.equal(b.hub.hits, 1, 'one read, shared');
});
on('C17b a preview listed since the poll is found after one re-read', { list: [] }, async (b) => {
  b.hub.list = [row('other', P + 1, { previews: [previewOn('cool-tiger', b.DEV)] })];
  const r = await b.get('cool-tiger', '/x', { cookie: COOKIE });
  assert.deepEqual([r.status, b.hub.hits], [200, 1]);
});
on('C18 an unknown name, signed in, re-reads once and lists what is live', undefined, async (b) => {
  const r = await b.get('nobody', '/', { cookie: COOKIE, headers: NAV });
  assert.equal(b.hub.hits, 1);
  assert.ok(r.body.includes(`${b.origin('alpha')}/`), 'the page links the live projects');
});
on('C18b the unknown-name page links a live preview too', ({ DEV }) => ({ list: [row('alpha', P, { previews: [{ ...previewOn('cool-tiger', DEV), project: 'alpha' }] })] }), async (b) => {
  const r = await b.get('nobody', '/', { cookie: COOKIE, headers: NAV });
  assert.ok(r.body.includes(`${b.origin('cool-tiger')}/`));
});
on('C18c a stalled hub with an empty list holds a dashboard request about a second', { stall: true }, async (b) => {
  const t0 = Date.now();
  const r = await b.get('alpha', '/', { cookie: COOKIE, headers: NAV });
  assert.ok(Date.now() - t0 < 2500, 'bounded');
  assert.equal(r.status, 503);
});
on('C19 /dev/ leaves out a preview named as a project', ({ DEV, DEV2 }) => ({ list: [row('cool-tiger', P), row('other', P + 1, { previews: [previewOn('cool-tiger', DEV), previewOn('warm-otter', DEV2)] })] }), async (b) => {
  const r = await b.get(null, '/dev/', { cookie: COOKIE, headers: { 'sec-fetch-dest': 'document' } });
  assert.match(r.body, /warm-otter/);
  assert.doesNotMatch(r.body, /cool-tiger/);
});
test('C33 the fixture still lists what this probe assumes', () => assert.deepEqual(FX.reservedLabels, ['term', 'public', 'www']));

// The policies follow the project list: mapLoop, the hub page's frame-src, the lens's ancestors.
on('C21 an instance\'s CSP naming its block port arrives naming its project host', undefined, async (b) => {
  const r = await b.get('alpha', '/', { cookie: COOKIE });
  assert.ok(String(r.headers['content-security-policy']).includes(`frame-src ${b.origin('alpha')}`), r.headers['content-security-policy']);
});
on('C22 HUB_CSP names each listed project host and no wildcard, read fresh', { list: [] }, async (b) => {
  b.hub.list = [row('alpha', P)];
  const csp = (await b.get(null, '/', { cookie: COOKIE })).headers['content-security-policy'];
  assert.ok(csp.includes(b.origin('alpha')), 'a host listed a moment ago');
  assert.doesNotMatch(csp, /\*/);
});
on('C23 a stalled hub delays the hub page at most a second', { stall: true }, async (b) => {
  const t = Date.now();
  const r = await b.get(null, '/', { cookie: COOKIE });
  assert.equal(r.status, 200);
  assert.ok(b.hub.hits >= 1, 'it did try the list');
  assert.ok(Date.now() - t < 1500, 'within a second');
});
on('C23b a failed refresh keeps the hub\'s copy of the project hosts', undefined, async (b) => {
  b.hub.list = 'not a list';
  const csp = (await b.get(null, '/', { cookie: COOKIE })).headers['content-security-policy'];
  assert.ok(b.hub.hits >= 1, 'it did try the list');
  assert.ok(csp.includes(b.origin('alpha')), 'the host it knew stays named');
});
on('C24 a preview framed from its own name gets its instance\'s project host as ancestor', ({ DEV }) => ({ list: [row('alpha', P, { previews: [{ ...previewOn('cool-tiger', DEV), project: 'alpha' }] })] }), async (b) => {
  const r = await b.get('cool-tiger', '/', { cookie: COOKIE, headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' } });
  assert.ok(String(r.headers['content-security-policy']).includes(`frame-ancestors 'self' ${b.origin()} ${b.origin('alpha')}`), r.headers['content-security-policy']);
});
on('C25 the viewer is no longer frameable from public.<box>', undefined, async (b) => {
  const at = `tree:${TREE}`;
  const r = await b.get('alpha', `/view/artifact/launch-notes?at=${at}&w=${b.g.wrapGrant('alpha', 'launch-notes', at)}`, { cookie: COOKIE });
  assert.equal(r.status, 200, 'the viewer answers on the project host');
  assert.doesNotMatch(String(r.headers['content-security-policy']), /public\.box/);
});

// C5l and C5m: a real ticket/<id> draft, fetched by a real kit the way the kit fetches one, on a port
// of the instance block behind the gateway (its real mapLoop and capability route), held in Chromium
// in the dashboard's own sandbox attributes (#av-frame). The two share one rig, built by the first
// that runs and stopped when the second is done, so the ports it holds (the hub's, P, P + 1 and
// P + 23) are free for every test after them.
const DRAFT_SEG = 'ticket%2Fe2e-1';
const AV_SANDBOX = /<iframe id="av-frame"[^>]*\bsandbox="([^"]+)"/.exec(fs.readFileSync(path.join(kit, 'dashboard', 'index.html'), 'utf8'))?.[1];
const draftPage = (body) => `<!doctype html><html><head><title>d</title><script>top.postMessage('draft:' + location.pathname.split('/').pop() + ':' + (window.name || ''), '*')</script></head><body>${body}</body></html>`;
const DRAFT_FILES = {
  'artifact.json': JSON.stringify({ v: 1, title: 'nav', summary: 'a draft that moves its own frame', by: 'supervisor', for: [] }),
  'index.html': draftPage('<p>index</p>'),
  'other.html': draftPage('<p>other</p>'),
  'c-click.html': draftPage('<a href="other.html" style="display:block;position:fixed;left:0;top:0;right:0;bottom:0;background:#eee">go</a>'),
  'c-href.html': draftPage("<script>setTimeout(() => { location.href = 'other.html'; }, 100)</script>"),
  'c-reload.html': draftPage("<script>if (!window.name) { window.name = '2'; setTimeout(() => location.reload(), 100); }</script>"),
  'c-nested.html': draftPage('<iframe src="nested.html"></iframe>'),
  'nested.html': draftPage('<p>nested</p>'),
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let draftRig = null;
const realDraft = () => (draftRig ??= (async () => {
  const F = fleetFixture('gw-draft');
  const d = { F, dash: null, b: null, chrome: null, fetching: true, reqs: [] };
  d.close = async () => {
    d.fetching = false;
    for (const f of [() => d.chrome?.close(), () => d.b?.close(), () => d.dash?.stop(), () => F.done()]) { try { await f(); } catch {} }
  };
  try {
    assert.ok(AV_SANDBOX, 'the dashboard\'s artifact frame names its sandbox');
    const other = path.join(F.base, 'other');
    F.g(['clone', '-q', F.org, other], F.base);
    for (const [k, v] of [['user.email', 'o@o'], ['user.name', 'o']]) F.g(['config', k, v], other);
    F.g(['checkout', '-q', '-B', 'ticket/e2e-1', 'origin/main'], other);
    for (const [rel, text] of Object.entries(DRAFT_FILES)) write(path.join(other, 'docs/devteam/project/artifacts/draft-mock', rel), text);
    F.g(['add', '-A', 'docs/devteam/project/artifacts'], other);
    F.g(['commit', '-qm', 'a draft on ticket/e2e-1'], other);
    F.g(['push', '-q', 'origin', 'HEAD:refs/heads/ticket/e2e-1'], other);
    // a port of the gateway's instance block, so mapLoop maps it; the kit's own hub port, never the gateway's stand-in
    const DP = P + 23;
    const env = { ...F.env({}), DEVTEAM_ARTIFACT_FETCH_MS: '1500', DEVTEAM_HUB_PORT: String(KIT_PORTS), DEVTEAM_PORT_BASE: String(KIT_PORTS + 1) };
    delete env.GIT_SSH_COMMAND;
    d.dash = startDashboard(F.old, env, ['--port', String(DP)]);
    for (let end = Date.now() + 120000; !/dashboard on http/.test(d.dash.out());) {
      if (d.dash.p.exitCode !== null || d.dash.p.signalCode !== null || Date.now() > end) assert.fail(`the kit's dashboard on ${DP}: ${d.dash.out().slice(-800)}`);
      await sleep(100);
    }
    // the kit fetches a draft as the dashboard asks it to
    const K = `http://127.0.0.1:${DP}`;
    (async () => { while (d.fetching) { try { await (await fetch(`${K}/api/artifact-remote`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: K }, body: '{}' })).text(); } catch {} await sleep(250); } })();
    for (let end = Date.now() + 90000; ;) {
      const r = await fetch(`${K}/artifact/origin/${DRAFT_SEG}/draft-mock/`);
      const text = await r.text();
      if (r.status === 200) break;
      if (Date.now() > end) assert.fail(`the kit never served the draft: ${r.status} ${text.slice(0, 200)}`);
      await sleep(250);
    }
    d.b = await box({ list: [row('alpha', DP, { root: F.old })] });
    // what reached the gateway for the draft, and how it was answered
    d.b.g.server.prependListener('request', (q, s) => {
      if (!q.url.includes('/draft-mock/')) return;
      const at = { file: q.url.split('?')[0].split('/').pop(), dest: q.headers['sec-fetch-dest'], site: q.headers['sec-fetch-site'], status: null };
      d.reqs.push(at);
      s.on('finish', () => { at.status = s.statusCode; });
    });
    d.chrome = await openChrome();
    const page = await d.chrome.newPage();
    d.page = page;
    await page.send('Network.enable');
    // every move asks the gateway: a page an earlier case loaded is never answered from the cache
    await page.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.send('Page.enable');
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "if (window === top) { window.__m = []; addEventListener('message', (e) => { if (typeof e.data === 'string' && e.data.startsWith('draft:')) window.__m.push(e.data); }); }" });
    await page.send('Network.setCookie', { name: 'devteam_session', value: u(TOK), url: `${d.b.origin('alpha')}/` });
    await page.send('Page.navigate', { url: `${d.b.origin('alpha')}/healthz` });
    for (let i = 0; ; i++) {
      if (await page.ev(`location.origin === ${JSON.stringify(d.b.origin('alpha'))} && document.readyState === 'complete' && Array.isArray(window.__m)`).catch(() => false)) break;
      if (i > 100) assert.fail('the page on the project host never loaded');
      await sleep(100);
    }
    // the draft's start page in a fresh frame, as the dashboard's viewer holds one
    d.frame = async (start) => {
      d.reqs.length = 0;
      await page.ev(`(() => { window.__m = []; document.querySelectorAll('iframe').forEach((x) => x.remove()); const f = document.createElement('iframe'); f.setAttribute('sandbox', ${JSON.stringify(AV_SANDBOX)}); f.setAttribute('allow', 'fullscreen'); f.setAttribute('referrerpolicy', 'no-referrer'); f.style.cssText = 'position:fixed;left:0;top:0;width:600px;height:400px;border:0'; f.src = ${JSON.stringify(`/artifact/origin/${DRAFT_SEG}/draft-mock/${start}`)}; document.body.appendChild(f); return 1; })()`);
    };
    d.heard = async (prefix, ms) => {
      for (const end = Date.now() + ms; Date.now() < end; await sleep(60)) if ((await page.ev('window.__m.slice()')).some((m) => m.startsWith(prefix))) return true;
      return false;
    };
    return d;
  } catch (e) { await d.close(); throw e; }
})());
describe('C5l and C5m: a real ticket/<id> draft in Chrome', () => {
  after(async () => { const d = await draftRig?.catch(() => null); draftRig = null; await d?.close(); });
  test('C5l in Chrome, a real ticket/<id> draft moves its own frame through mapLoop: a link click, location.href and a reload each render the other page', { skip: !canDrive, timeout: 300000 }, async () => {
    const d = await realDraft();
    const got = {};
    for (const [name, start, target, click] of [['a link click', 'c-click.html', 'other.html', true], ['location.href', 'c-href.html', 'other.html', false], ['a reload', 'c-reload.html', 'c-reload.html', false]]) {
      await d.frame(start);
      const first = await d.heard(`draft:${start}:`, 8000);
      // the move counts from the start page's own answer: a move 100 ms after it loads can reach the
      // gateway before the page's message is heard here
      const loaded = d.reqs.findIndex((x) => x.file === start && x.status === 200);
      const mark = loaded < 0 ? d.reqs.length : loaded + 1;
      if (click) { await sleep(150); await d.page.clickAt(300, 200); }
      const rendered = await d.heard(target === start ? `draft:${target}:2` : `draft:${target}:`, 4000);
      await sleep(300);
      got[name] = { first, rendered, requests: d.reqs.slice(mark).filter((x) => x.file === target).map((x) => `${x.dest}/${x.site} ${x.status}`) };
    }
    // each move is a cross-site iframe request, which only the step 5 exception lets through
    const moved = { first: true, rendered: true, requests: ['iframe/cross-site 200'] };
    assert.deepEqual(got, { 'a link click': moved, 'location.href': moved, 'a reload': moved });
  });
  test('C5m in Chrome, the same draft\'s nested frame is blocked by the kit\'s own policy and never requested', { skip: !canDrive, timeout: 300000 }, async () => {
    const d = await realDraft();
    await d.frame('c-nested.html');
    assert.ok(await d.heard('draft:c-nested.html:', 8000), 'the draft itself renders');
    const rendered = await d.heard('draft:nested.html:', 2000);
    await sleep(300);
    assert.deepEqual({ requested: d.reqs.filter((x) => x.file === 'nested.html').map((x) => `${x.dest}/${x.site} ${x.status}`), rendered }, { requested: [], rendered: false });
  });
});
test('C5l and C5m let go of their ports: a test after them can bind the hub\'s, P, P + 1 and P + 23', async () => {
  const held = [];
  for (const [name, port] of [['the hub\'s', HUB], ['P', P], ['P + 1', P + 1], ['P + 23', P + 23]]) if (!(await bindable(port))) held.push(name);
  assert.deepEqual(held, []);
});

// --- project hosts: Publish, Unpublish and box.json by project name (task 4) -------------------------
// A publish needs a list read that began after it was asked for: a stalled hub's last good list
// proves nothing (m-20261122-034142665). A name two listed projects share is never published, and
// its page can still be taken down, from the gateway's store alone (a-20261122-032256363).
const DOC = { 'sec-fetch-dest': 'document' };
const hashOf = (slug) => crypto.createHash('sha256').update(G.canonicalJson(manifest(slug))).digest('hex');
const publishPost = (b, items, port = P) => b.get(null, '/public/publish', { method: 'POST', cookie: COOKIE, headers: { origin: b.origin(), 'content-type': 'application/json' }, body: JSON.stringify({ port, items }) });
const publishOne = async (b, slug) => JSON.parse((await publishPost(b, [{ slug, manifest: hashOf(slug) }])).body).results[0];
const unpublishPost = (b, body) => b.get(null, '/public/unpublish', { method: 'POST', cookie: COOKIE, headers: { origin: b.origin(), 'content-type': 'application/json' }, body: JSON.stringify(body) });
const stored = (b) => JSON.parse(fs.readFileSync(path.join(b.dir, 'state.json'), 'utf8')).public;
const waitFor = async (f, what) => { for (let i = 0; i < 300 && !f(); i++) await sleep(10); assert.ok(f(), what); };
const TWINS = [row('twin', P), row('twin', P + 1, { root: '/srv/twin2' })];

on('C26 box.json is box: 2 with project and no instance', undefined, async (b) => {
  const j = JSON.parse((await b.get(null, '/box.json', { cookie: COOKIE })).body);
  assert.equal(j.box, 2);
  assert.equal(j.project, `http://{project}.box.localhost:${b.port}/`);
  assert.ok(!('instance' in j));
});
on('C27 /public/publish opens by ?project=', undefined, async (b) => {
  const r = await b.get(null, '/public/publish?project=alpha&slug=launch-notes', { cookie: COOKIE, headers: DOC });
  assert.equal(r.status, 200);
  assert.ok(r.body.includes(`const PORT = ${P};`), 'the page posts to that project\'s port, as by ?port=');
  assert.ok(r.body.includes(`${b.origin('alpha')}/launch-notes/`), 'and prints the project-host address');
});
on('C27b the Publish page prints no public.<box> address', undefined, async (b) => {
  const r = await b.get(null, '/public/publish?project=alpha&slug=launch-notes', { cookie: COOKIE, headers: DOC });
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.body, /public\.box/);
});
on('C12 Publish refuses a reserved slug', undefined, async (b) => {
  const out = await publishOne(b, 'view');
  assert.equal(out.ok, false);
  assert.match(out.error, /path of the dashboard/);
});
on('C12b Publish refuses a project name that cannot be a host', undefined, async (b) => {
  manifestProject = 'my.app';
  try {
    const out = await publishOne(b, 'notes');
    assert.equal(out.ok, false);
    assert.match(out.error, /can't be a host/);
  } finally { manifestProject = 'alpha'; }
});
on('C28 a name two listed projects share is refused by Publish, with why', { list: TWINS }, async (b) => {
  const r = await b.get(null, '/public/publish?project=twin&slug=x', { cookie: COOKIE, headers: DOC });
  assert.equal(r.status, 409);
  assert.match(r.body, /two|share/i);
});
on('C28b a shared name is refused by ?port= too, on the page and the POST', { list: [row('alpha', P), row('alpha', P + 1, { root: '/srv/alpha2' })] }, async (b) => {
  const page = await b.get(null, `/public/publish?port=${P}&slug=notes`, { cookie: COOKIE, headers: DOC });
  assert.match(page.body, /two listed projects share/, 'the page');
  const out = await publishOne(b, 'notes');
  assert.equal(out.ok, false, 'the POST');
  assert.match(out.error, /two listed projects share/);
});
on('C28c an unreadable list refuses Publish, on the page and the POST', { list: [row('alpha', P)], published: {} }, async (b) => {
  b.hub.list = 'not a list';
  const page = await b.get(null, `/public/publish?port=${P}&slug=notes`, { cookie: COOKIE, headers: DOC });
  assert.match(page.body, /can.{1,6}t check that only one project/, 'the page');
  const out = await publishOne(b, 'notes');
  assert.equal(out.ok, false, 'the POST');
  assert.match(out.error, /can.t check that only one project/);
  assert.ok(!b.seen.get(P).includes('/api/artifact-publish'), 'no instance is told');
});
on('C28d a hub that accepts and never answers: a stale good list does not let Publish through', { list: [row('alpha', P)], published: {} }, async (b) => {
  b.hub.stall = true;
  const t0 = Date.now();
  const out = await publishOne(b, 'notes');
  assert.ok(Date.now() - t0 < 2500, 'it answers, bounded');
  assert.equal(out.ok, false, 'the POST');
  assert.match(out.error, /can.t check that only one project/);
  assert.ok(!b.seen.get(P).includes('/api/artifact-publish'), 'no instance is told');
  const byPort = await b.get(null, `/public/publish?port=${P}&slug=notes`, { cookie: COOKIE, headers: DOC });
  assert.match(byPort.body, /can.{1,6}t check that only one project/, 'the page by port');
  const byName = await b.get(null, '/public/publish?project=alpha&slug=notes', { cookie: COOKIE, headers: DOC });
  assert.equal(byName.status, 503, 'the page by name');
  assert.match(byName.body, /can.t check that only one project/);
  b.hub.release();
  await waitFor(() => b.hub.held.length === 0, 'the hub answered');
  assert.equal((await publishOne(b, 'notes')).ok, true, 'a hub that answers again lets it publish');
});
on('C28e a read begun before the request is not proof', { list: [row('alpha', P)], published: {} }, async (b) => {
  b.hub.stall = true;
  const first = b.get(null, '/', { cookie: COOKIE, headers: DOC });
  await waitFor(() => b.hub.held.length === 1, 'the hub page\'s read is held');
  b.hub.stall = false;
  b.hub.list = [row('alpha', P), row('alpha', P + 1, { root: '/srv/alpha2' })];
  const post = publishOne(b, 'notes');
  await sleep(100);
  b.hub.release();
  const out = await post;
  await first;
  assert.equal(out.ok, false, 'the older answer said one project');
  assert.match(out.error, /two listed projects share/);
});
on('C28f an older answer of the list never replaces a newer one', { list: [row('alpha', P)], published: {} }, async (b) => {
  b.hub.stall = true;
  const poll = b.g.pollPush();
  await waitFor(() => b.hub.held.length === 1, 'the poll\'s read is held');
  b.hub.stall = false;
  b.hub.list = [row('alpha', P), row('alpha', P + 1, { root: '/srv/alpha2' })];
  await b.get(null, '/', { cookie: COOKIE, headers: DOC });
  b.hub.release();
  await poll;
  const before = b.seen.get(P).length;
  const r = await b.get('alpha', '/', { cookie: COOKIE, headers: NAV });
  assert.deepEqual([r.status, b.seen.get(P).length], [503, before], 'still shared, so no dashboard');
});
on('C28g each item of a Publish takes its own proof, and a failed proof stops the rest', { list: [row('alpha', P)], published: {} }, async (b) => {
  b.hub.onFile = (url) => { if (url.includes('/second/')) b.hub.stall = true; };
  const r = await publishPost(b, ['first', 'second', 'third'].map((slug) => ({ slug, manifest: hashOf(slug) })));
  const out = JSON.parse(r.body).results;
  assert.deepEqual(out.map((x) => x.ok), [true, false, false], 'only the item proved before the hub stalled');
  assert.match(out[1].error, /can.t check that only one project/);
  assert.equal(out[2].error, out[1].error);
  assert.ok(!b.seen.get(P).some((x) => x.includes('/third')), 'the rest are not asked for');
  b.hub.release();
});
on('C29 the /public/ list prints project-host addresses and no public.<box>', undefined, async (b) => {
  const r = await b.get(null, '/public/', { cookie: COOKIE, headers: DOC });
  assert.ok(r.body.includes(`${b.origin('alpha')}/launch-notes/`));
  assert.doesNotMatch(r.body, /public\.box/);
});
on('C40 /public/ keeps a stored page of a name that cannot be a host, with Unpublish and no link', { published: { 'my.app': { root: '/srv/my', port: P, artifacts: { notes: art() } } } }, async (b) => {
  const r = await b.get(null, '/public/', { cookie: COOKIE, headers: DOC });
  assert.match(r.body, /public\/unpublish\?project=my\.app&#38;slug=notes/, 'its Unpublish row');
  assert.doesNotMatch(r.body, /my\.app\.box/, 'and no address on a host that cannot exist');
});
on('C30 the box\'s own name still serves the hub, never in a frame', undefined, async (b) => {
  const r = await b.get(null, '/', { cookie: COOKIE });
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-frame-options'], 'DENY');
});
on('C30b the box\'s own name keeps sign-in, /dev/ and pushes', undefined, async (b) => {
  assert.equal((await b.get(null, '/auth/login')).status, 200, 'sign-in');
  assert.equal((await b.get(null, '/dev/', { cookie: COOKIE, headers: DOC })).status, 200, '/dev/');
  const r = await b.get(null, '/push/subscribe', { method: 'POST', cookie: COOKIE, headers: { origin: b.origin(), 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 400, 'pushes: the route answers, and refuses a bad subscription');
  assert.match(r.body, /push subscription/);
});
on('C34 /public/unpublish?project= opens the page naming that project\'s port', undefined, async (b) => {
  const r = await b.get(null, '/public/unpublish?project=alpha&slug=launch-notes', { cookie: COOKIE, headers: DOC });
  assert.equal(r.status, 200);
  assert.ok(r.body.includes(`"port":${P}`), 'so the instance is told');
  assert.ok(r.body.includes(`${b.origin('alpha')}/launch-notes/`), 'and it prints the project-host address');
});
on('C34b the Unpublish page prints no public.<box> address', undefined, async (b) => {
  const r = await b.get(null, '/public/unpublish?project=alpha&slug=launch-notes', { cookie: COOKIE, headers: DOC });
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.body, /public\.box/);
});
on('C35 Unpublish of a shared name takes down only that page, from the store, and says so', { list: TWINS, published: { twin: { root: '/srv/twin', port: P, artifacts: { 'twin-notes': art(), 'twin-other': art() } }, alpha: { root: '/srv/alpha', port: P + 2, artifacts: { keep: art() } } } }, async (b) => {
  const out = await b.get(null, '/public/unpublish?project=twin&slug=twin-notes', { headers: DOC });
  assert.notEqual(out.status, 200, 'today\'s auth: signed out does not open it');
  for (const ask of ['project=twin&slug=twin-notes', `port=${P}&project=twin&slug=twin-notes`]) {
    const page = await b.get(null, `/public/unpublish?${ask}`, { cookie: COOKIE, headers: DOC });
    assert.equal(page.status, 200, ask);
    assert.match(page.body, /twin · twin-notes/, 'it names the page');
    assert.match(page.body, /share the name twin, so this page may be the other project/, 'it says the name is shared');
    assert.match(page.body, /no instance.{1,6}s record is written/, 'and that the record is not written');
    assert.doesNotMatch(page.body, /const ITEM = [^\n]*"port"/, 'the page sends no port');
  }
  const before = stored(b);
  const seenBefore = [b.seen.get(P).length, b.seen.get(P + 1).length];
  const post = () => unpublishPost(b, { project: 'twin', slug: 'twin-notes', port: P });
  const r = await post();
  const said = JSON.parse(r.body);
  assert.deepEqual([r.status, said.ok, said.recorded], [200, true, false]);
  assert.match(said.note, /twin\/twin-notes is down.*share that name.*other project.*No instance.s record was written/);
  assert.deepEqual([b.seen.get(P).length, b.seen.get(P + 1).length], seenBefore, 'neither instance is told, even with a port sent');
  const after = stored(b);
  assert.deepEqual(Object.keys(after.twin.artifacts), ['twin-other'], 'only that page');
  assert.deepEqual(after.alpha, before.alpha, 'the other project is untouched');
  assert.equal((await b.get('twin', '/twin-other/', { headers: NAV })).body, PAGE, 'the name\'s other page still answers');
  assert.equal((await b.get('alpha', '/keep/', { headers: NAV })).body, PAGE, 'another project\'s page still answers');
  assert.notEqual((await b.get('twin', '/twin-notes/', { headers: NAV })).body, PAGE, 'that page is down');
  const again = await post();
  assert.equal(again.status, 404, 'a repeat changes nothing');
  assert.deepEqual(stored(b), after, 'the store is as it was');
});
on('C35b with the list unreadable, Unpublish takes the page down and tells no instance', { published: { alpha: { root: '/srv/alpha', port: P, artifacts: { gone: art(), kept: art() } } } }, async (b) => {
  b.hub.list = 'not a list';
  const page = await b.get(null, `/public/unpublish?port=${P}&project=alpha&slug=gone`, { cookie: COOKIE, headers: DOC });
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.body, /const ITEM = [^\n]*"port"/, 'the page sends no port');
  const r = await unpublishPost(b, { project: 'alpha', slug: 'gone', port: P });
  const said = JSON.parse(r.body);
  assert.deepEqual([r.status, said.ok, said.recorded], [200, true, false]);
  assert.match(said.note, /list can.t be read, so no instance.s record was written/);
  assert.deepEqual(b.seen.get(P), [], 'no instance is told');
  assert.deepEqual(Object.keys(stored(b).alpha.artifacts), ['kept']);
});
on('C35c a hub that accepts and never answers: Unpublish still takes the page down and tells no instance', { list: [row('alpha', P)], published: { alpha: { root: '/srv/alpha', port: P, artifacts: { gone: art(), kept: art() } } } }, async (b) => {
  b.hub.stall = true;
  const t0 = Date.now();
  const page = await b.get(null, '/public/unpublish?project=alpha&slug=gone', { cookie: COOKIE, headers: DOC });
  assert.equal(page.status, 200, 'the page opens');
  assert.ok(Date.now() - t0 < 3000, 'bounded');
  assert.doesNotMatch(page.body, /const ITEM = [^\n]*"port"/, 'the page sends no port');
  const r = await unpublishPost(b, { project: 'alpha', slug: 'gone', port: P });
  const said = JSON.parse(r.body);
  assert.deepEqual([r.status, said.ok, said.recorded], [200, true, false]);
  assert.deepEqual(b.seen.get(P), [], 'no instance is told');
  assert.deepEqual(Object.keys(stored(b).alpha.artifacts), ['kept']);
  b.hub.release();
});
on('C35d Unpublish of a shared name that can\'t be a host: an older page under my.app, listed by two instances', { list: [row('my.app', P), row('my.app', P + 1, { root: '/srv/my.app2' })], published: { 'my.app': { root: '/srv/my.app', port: P, artifacts: { notes: art(), other: art() } } } }, async (b) => {
  for (const ask of ['project=my.app&slug=notes', `port=${P}&project=my.app&slug=notes`]) {
    const page = await b.get(null, `/public/unpublish?${ask}`, { cookie: COOKIE, headers: DOC });
    assert.equal(page.status, 200, ask);
    assert.match(page.body, /share the name my\.app, so this page may be the other project/, `${ask}: it says the name is shared`);
    assert.doesNotMatch(page.body, /const ITEM = [^\n]*"port"/, `${ask}: the page sends no port`);
  }
  const seenBefore = [b.seen.get(P).length, b.seen.get(P + 1).length];
  const r = await unpublishPost(b, { project: 'my.app', slug: 'notes', port: P });
  const said = JSON.parse(r.body);
  assert.deepEqual([r.status, said.ok, said.recorded, said.shared], [200, true, false, true]);
  assert.match(said.note, /my\.app\/notes is down.*share that name/);
  assert.deepEqual([b.seen.get(P).length, b.seen.get(P + 1).length], seenBefore, 'neither instance is asked anything, even with a port sent');
  assert.deepEqual(Object.keys(stored(b)['my.app'].artifacts), ['other'], 'only that page');
});
on('C36 a publish from the page by ?project= writes the record and tells the instance', { published: {} }, async (b) => {
  const page = await b.get(null, '/public/publish?project=alpha&slug=fresh', { cookie: COOKIE, headers: DOC });
  const port = Number(/const PORT = (\d+);/.exec(page.body)?.[1]);
  const hash = /data-manifest="([0-9a-f]{64})"/.exec(page.body)?.[1];
  assert.deepEqual([port, Boolean(hash)], [P, true], 'the page names the port and the manifest');
  const out = JSON.parse((await publishPost(b, [{ slug: 'fresh', manifest: hash }], port)).body).results[0];
  assert.equal(out.ok, true, out.error);
  assert.equal(out.url, `${b.origin('alpha')}/fresh/`);
  assert.ok(b.seen.get(P).includes('/api/artifact-publish'), 'the instance is told');
  const saved = stored(b).alpha;
  assert.deepEqual([saved.root, saved.port, Object.keys(saved.artifacts)], ['/srv/alpha', P, ['fresh']], 'the same record as by port');
});

// --- project hosts: the image turns them on (task 6) ---------------------------------------------
test('C31 cloud/Dockerfile sets ENV DEVTEAM_PROJECT_HOSTS=1', () => {
  assert.match(fs.readFileSync(path.join(here, '..', 'cloud', 'Dockerfile'), 'utf8'), /^ENV .*\bDEVTEAM_PROJECT_HOSTS=1\b/m);
});
test('C32 the kit-301 caveat is gone from the README section and the Dockerfile', () => {
  const root = path.join(here, '..');
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /Until the gateway change \(kit-277\)/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'cloud', 'Dockerfile'), 'utf8'), /Until the gateway change \(kit-277\)/);
});
