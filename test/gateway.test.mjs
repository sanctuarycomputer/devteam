// The cloud gateway (cloud/gateway.mjs): claiming a box with a passkey, signing in, and passing the
// owner through to a real hub and dashboard as if from a local browser. A software authenticator
// stands in for the owner's password manager. Run: node --test
import { test } from 'node:test';
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

const here = path.dirname(fileURLToPath(import.meta.url));
const kit = path.resolve(here, '..', 'docs', 'devteam');
// a block of its own, apart from kit.test.mjs's (20000 and up)
const PORTS = 10000 + (process.pid % 90) * 100;
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
  // on: an instance's port, for its subdomain; else the box's own name
  const req = (method, route, { body, headers = {}, cookie = jar, on = route.startsWith('/auth/') ? 'auth' : undefined } = {}) => new Promise((resolve, reject) => {
    const self = on === 'auth' ? auth : on === 'term' ? term : on === 'public' ? site : on ? inst(on) : publicUrl;
    const h = { host: new URL(self).host, ...(method !== 'GET' ? { origin: self, 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers };
    for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
    const r = http.request({ host: '127.0.0.1', port, method, path: route, headers: h }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        const sc = res.headers['set-cookie']?.find((c) => c.startsWith('devteam_session='));
        if (sc) jar = sc.split(';')[0];
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
    assert.equal((await gw.req('GET', '/', { headers: { host: `auth.box.localhost:${gw.port}` } })).status, 421, 'and there is no auth name any more');
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
    bad = await gw.req('POST', '/auth/claim/verify', { body: { token: gw.token, ...a.create(o.json, gw.inst(P)) } });
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
    assert.equal((await gw.req('GET', '/x?y=1', { on: P, headers: { 'sec-fetch-mode': 'navigate' } })).headers.location, `${gw.auth}/auth/login?next=${encodeURIComponent(`${gw.inst(P)}/x?y=1`)}`, 'an instance sends you to sign in, and back');
    assert.equal((await gw.req('GET', '/x', { on: P })).status, 401, 'a fetch gets a 401');
    // where signing in returns to: the box or an instance, never another site
    const nextOf = async (n) => /const next = ("[^"]*")/.exec((await gw.req('GET', `/auth/login?next=${encodeURIComponent(n)}`)).body)?.[1];
    assert.equal(await nextOf(`${gw.inst(P)}/a`), JSON.stringify(`${gw.inst(P)}/a`));
    assert.equal(await nextOf(`${gw.term}/`), JSON.stringify(`${gw.term}/`));
    for (const n of ['/\\evil.example', '//evil.example/', 'https://evil.example/', `http://${P + 25}.box.localhost:${gw.port}/`, 'javascript:alert(1)']) assert.equal(await nextOf(n), JSON.stringify(`${gw.publicUrl}/`), n);
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
    for (let i = 0; i < 300; i++) await gw.req('POST', '/auth/login/options', { body: {}, cookie: '' });
    assert.match((await gw.req('POST', '/auth/login/verify', { body: a.get(flood.json, gw.inst(P), { counter: 19 }), cookie: '' })).json.error, /origin/, 'a dashboard\'s page may ask for the passkey, but its answer is no sign-in');
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
    for (const h of [`${P + 25}.box.localhost:${gw.port}`, `0${P}.box.localhost:${gw.port}`, `${P}.box.localhost`, `${P}.x.box.localhost:${gw.port}`]) assert.equal((await gw.req('GET', '/', { headers: { host: h } })).status, 421, h);
    assert.equal((await gw.req('GET', '/healthz', { headers: { host: 'internal' } })).status, 200, 'but the health check answers anyone');
    assert.equal((await gw.req('POST', '/auth/login/options', { body: {}, headers: { origin: 'https://evil.example' } })).status, 403, 'a POST from another site is refused before anything else');
    assert.equal((await gw.req('POST', '/auth/login/options', { body: {}, headers: { origin: undefined } })).status, 403, 'and so is one with no Origin');
    assert.equal((await gw.req('POST', '/auth/login/options', { body: {}, headers: { origin: gw.inst(P) } })).status, 403, 'and one from an instance\'s page: a dashboard can\'t act on the box');
    assert.equal((await gw.req('POST', '/api/fleet', { on: P, body: {}, headers: { origin: gw.publicUrl } })).status, 403, 'nor the box on an instance');
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
  const gw = await gateway('proxy');
  const base = fs.mkdtempSync(path.join(tmp, 'repos-'));
  const A = bareProject(base, 'alpha');
  const env = { ...process.env };
  delete env.DEVTEAM_ROLE;
  const d = spawn(process.execPath, [path.join(A, 'docs/devteam/scripts/devteam.mjs'), 'dashboard'], { cwd: A, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  d.stdout.on('data', (b) => { out += b; });
  d.stderr.on('data', (b) => { out += b; });
  // a stand-in upstream on another block port that shows what the kit would receive
  const seen = [];
  const seenUrls = [];
  const echo = http.createServer((req, res) => { seen.push(req.headers); res.writeHead(200, { 'content-security-policy': `frame-ancestors http://127.0.0.1:${HUB}; img-src http://127.0.0.1:${P + 5}/api/file`, location: `http://127.0.0.1:${P + 5}/x`, 'clear-site-data': '"cookies"', 'set-cookie': ['devteam_session=x; Path=/auth', 'devteam_session =y', 'a=1; Domain=box.localhost', 'b=1; domain = box.localhost', 'theme=light'] }); seenUrls.push(req.url); res.end('ok'); }).listen(P + 5, '127.0.0.1');
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
    await until(async () => (await gw.req('GET', '/instances.json')).json?.instances?.[0]?.inbox !== undefined, 'the hub, through the gateway');

    // the hub, on the box's name: it frames each instance on its subdomain, and the terminal
    const hub = await gw.req('GET', '/');
    assert.equal(hub.status, 200);
    const hcsp = hub.headers['content-security-policy'];
    assert.ok(hcsp.split('; ').includes(`frame-src ${gw.term} ${Array.from({ length: 25 }, (_, i) => gw.inst(P + i)).join(' ')}`), hcsp);
    assert.ok(hcsp.split('; ').includes("frame-ancestors 'none'"), hcsp);
    assert.equal(hub.body, fs.readFileSync(path.join(kit, 'dashboard', 'hub.html'), 'utf8'), 'the gateway\'s own copy of the page');
    assert.ok(!hcsp.includes('127.0.0.1'), hcsp);
    const list = (await gw.req('GET', '/instances.json', { headers: { 'sec-fetch-site': 'same-origin' } })).json.instances;
    assert.deepEqual(list.map((x) => [x.name, x.port]), [['alpha', P]]);
    const boxJson = (await gw.req('GET', '/box.json')).json;
    assert.deepEqual(boxJson, { box: 1, terminal: `${gw.term}/`, instance: `http://{port}.box.localhost:${gw.port}/`, passkeys: `${gw.auth}/auth/passkeys`, push: boxJson.push }, 'the hub learns where instances are');
    assert.equal(Buffer.from(boxJson.push, 'base64url').length, 65, 'and the key that signs its notifications');

    // a dashboard on its own subdomain, exactly as the kit serves it, its policy pointed at the box
    const dash = await gw.req('GET', '/', { on: P });
    assert.equal(dash.status, 200);
    assert.equal(dash.headers['content-security-policy'], `frame-src 'self'; frame-ancestors 'self' ${gw.publicUrl}`);
    assert.equal((await gw.req('GET', '/api/hello', { on: P })).json.port, P);
    assert.equal((await gw.req('GET', '/api/file?path=README.md', { on: P })).status === 403, false, 'a committed file is served by path, as a review page asks for it');
    // an owner action passes the kit's own same-origin check, as from the page
    const act = await gw.req('POST', '/api/fleet', { on: P, body: { op: 'drain', reason: 'through the gateway' }, headers: { 'sec-fetch-site': 'same-origin' } });
    assert.notEqual(act.status, 403, act.body);
    assert.ok(act.json?.ok || !/owner actions only/.test(act.json?.error ?? ''), act.body);
    // a sandboxed page's request (Origin: null) is refused, as the kit would
    assert.equal((await gw.req('POST', '/api/fleet', { on: P, body: { op: 'drain' }, headers: { origin: 'null' } })).status, 403);
    const rv = await gw.req('GET', '/review/preview/?path=README.md', { on: P, headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' } });
    assert.notEqual(rv.status, 403, rv.body);

    // what the kit receives: its own Host and origin, no session cookie, no proxy headers
    const r = await gw.req('POST', '/y?q=1', { on: P + 5, body: {}, headers: { cookie: `${gw.jar()}; theme=dark`, 'x-forwarded-for': '1.2.3.4', referer: `${gw.inst(P + 5)}/` } });
    assert.equal(r.status, 200);
    const h = seen.at(-1);
    assert.equal(h.host, `127.0.0.1:${P + 5}`);
    assert.equal(h.origin, `http://127.0.0.1:${P + 5}`);
    assert.equal(h.cookie, 'theme=dark');
    assert.equal(h['x-forwarded-for'], undefined);
    assert.equal(h.referer, undefined);
    assert.equal(r.headers['content-security-policy'], `frame-ancestors ${gw.publicUrl}; img-src ${gw.inst(P + 5)}/api/file`);
    assert.equal(r.headers.location, `${gw.inst(P + 5)}/x`);
    assert.deepEqual(r.headers['set-cookie'], ['theme=light'], 'nothing behind the gateway sets a cookie for the box\'s names');
    assert.equal(r.headers['clear-site-data'], undefined, 'or clears the owner\'s');

    // another site's page can't use the cookie for a read; a sandboxed review page's loads can
    const xs = (route, dest) => gw.req('GET', route, { on: P, headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': dest } });
    assert.equal((await xs('/api/fleet?fetch=1', 'image')).status, 403);
    assert.equal((await xs('/api/data', 'script')).status, 403);
    assert.equal((await xs('/api/file?path=README.md', 'script')).status, 403);
    assert.equal((await xs('/api/file?path=README.md', 'image')).status, 403, 'only an image file, as an image');
    assert.notEqual((await xs('/api/file?path=a/b.png', 'image')).status, 403);
    assert.equal((await gw.req('GET', '/api/data', { on: P, headers: { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' } })).status, 403, 'another name of the box is no different');
    assert.equal((await gw.req('GET', '/api/fleet?fetch=1', { on: P, headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' } })).status, 403, 'nor can a frame or a link reach the API');
    assert.equal((await xs('/artifact/main/x/a.js', 'script')).status, 403, 'an artifact\'s files, without its capability');
    // an artifact: its frame's first load goes under a capability, and its files need no cookie
    const af = await gw.req('GET', '/artifact/main/x/?v=1', { on: P + 5, headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' } });
    assert.equal(af.status, 302);
    const cap = /^(\/c\/[^/]+)\/artifact\/main\/x\/\?v=1$/.exec(af.headers.location)?.[1];
    assert.ok(cap, af.headers.location);
    const opaque = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' };
    const capped = await gw.req('GET', `${cap}/artifact/main/x/a.js?q=1`, { on: P + 5, cookie: '', headers: opaque });
    assert.equal(capped.status, 200, capped.body);
    assert.equal(seenUrls.at(-1), '/artifact/main/x/a.js?q=1', 'the kit sees the plain path');
    assert.equal(seen.at(-1).cookie, undefined);
    assert.equal((await gw.req('GET', `${cap}/artifact/main/other/a.js`, { on: P + 5, cookie: '', headers: opaque })).status, 403, 'that folder only');
    assert.equal((await gw.req('GET', `${cap}/artifact/main/x/../../../api/data`, { on: P + 5, cookie: '', headers: opaque })).status, 403, 'and no way out of it');
    assert.equal((await gw.req('GET', `${cap}/artifact/main/x/a.js`, { on: P + 6, cookie: '', headers: opaque })).status, 403, 'on that instance only');
    assert.equal((await gw.req('POST', `${cap}/artifact/main/x/a.js`, { on: P + 5, cookie: '', body: {} })).status, 403, 'reads only');
    assert.notEqual((await xs('/review/preview/devteam-ui.js', 'script')).status, 403);
    assert.equal((await gw.req('GET', '/', { on: P, headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } })).status, 200, 'a link from anywhere still opens it');

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
    assert.equal((await ws({ origin: gw.inst(P), cookie: gw.jar() }))[0], 403, 'nor a dashboard\'s page');
    assert.equal((await ws({ origin: gw.term }))[0], 401, 'nor anyone without a session');
    assert.equal((await ws({ origin: gw.term, cookie: gw.jar() }, '/x'))[0], 404, 'and it is the only upgrade');
    assert.equal((await ws({ origin: gw.publicUrl, cookie: gw.jar() }, '/ws', `box.localhost:${gw.port}`))[0], 421, 'on the terminal\'s name only');
    // a jar stuffed with cookies clears itself rather than locking the owner out of every name
    const flooded = await new Promise((resolve) => { const c = net.connect(gw.port, '127.0.0.1', () => c.write(`GET / HTTP/1.1\r\nhost: box.localhost:${gw.port}\r\ncookie: x=${'a'.repeat(70000)}\r\n\r\n`)); let b = ''; c.on('data', (d) => { b += d; }); c.on('close', () => resolve(b)); });
    assert.match(flooded, /^HTTP\/1\.1 431/);
    assert.match(flooded, /clear-site-data: "cookies"/);
    // signing out ends that session's artifact capabilities
    assert.equal((await gw.req('POST', '/auth/logout', { body: {} })).status, 200);
    assert.equal((await gw.req('GET', `${cap}/artifact/main/x/a.js`, { on: P + 5, cookie: '', headers: opaque })).status, 403, 'a capability ends with its session');
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
    assert.equal((await gw.req('GET', '/instances.json')).body, '{"hub":1,"instances":[]}', 'and no more of it than a list could be');
    assert.equal((await gw.req('GET', '/anything')).status, 404);
  } finally { evil.close(); await gw.close(); }
  const gw2 = await gateway('nohub');
  try {
    assert.equal((await gw2.claim(authenticator())).status, 200);
    await until(async () => (await gw2.req('GET', '/instances.json')).body === '{"hub":1,"instances":[]}', 'an empty list when nothing holds the port');
    assert.equal((await gw2.req('GET', '/')).status, 200, 'and the page, with its Terminal tab, on first boot');
  } finally { await gw2.close(); }
});

test('what an agent serves on an instance\'s name doesn\'t outlive its server: no service worker, nothing cached', async () => {
  const gw = await gateway('nokeep');
  const seen = [];
  const evil = http.createServer((req, res) => { seen.push(req.url); res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'max-age=31536000, immutable' }); res.end('//'); });
  await new Promise((r) => evil.listen(P, '127.0.0.1', r));
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    const page = await gw.req('GET', '/page.js', { on: P });
    assert.equal(page.status, 200);
    assert.equal(page.headers['cache-control'], 'no-store', 'its own cache-control is replaced');
    assert.equal((await gw.req('GET', '/sw.js', { on: P, headers: { 'service-worker': 'script' } })).status, 403);
    assert.equal((await gw.req('GET', '/sw.js', { on: P, headers: { 'sec-fetch-dest': 'serviceworker' } })).status, 403);
    assert.deepEqual(seen, ['/page.js'], 'and the registration never reaches it');
  } finally { evil.close(); await gw.close(); }
});

test('the hub on a laptop is unchanged: no box.json, instances on their own loopback ports', () => {
  const hub = fs.readFileSync(path.join(kit, 'dashboard', 'hub.html'), 'utf8');
  assert.match(hub, /const urlOf = \(x\) => \(box \? box\.instance\.replace\('\{port\}', String\(Number\(x\.port\)\)\) : `http:\/\/127\.0\.0\.1:\$\{Number\(x\.port\)\}\/`\);/);
});

test('on https: the cookie is Secure and SameSite=None for every name, and HSTS is sent', async () => {
  // the gateway trusts its public URL's scheme (the platform terminates TLS), so plain http here
  const port = await freePort();
  const dir = path.join(tmp, 'https');
  const logs = [];
  const g = G.createGateway({ publicUrl: 'https://box.localhost', dir, ttydPort: await freePort(), log: (m) => logs.push(m) });
  await new Promise((r) => g.server.listen(port, '127.0.0.1', r));
  const token = /claim#([\w-]+)/.exec(logs.join(' '))[1];
  const call = (host, method, route, body, headers = {}) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: route, headers: { host, ...(method === 'POST' ? { origin: `https://${host}`, 'content-type': 'application/json' } : {}), ...headers } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: (() => { try { return JSON.parse(b); } catch { return null; } })() })); });
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

test('an alert on the hub is pushed once, when it turns up or changes', () => {
  const ports = [P, P + 1];
  const r = (root, name, port, alert) => ({ root, name, port, ...(alert === undefined ? {} : { alert }) });
  assert.deepEqual(G.alertNews({}, [r('/a', 'a', P)], ports).messages, [], 'no alert, no news');
  const one = G.alertNews({}, [r('/a', 'a', P, 'disk is full')], ports);
  assert.equal(one.messages.length, 1);
  assert.equal(one.messages[0].title, 'Box alert (a)');
  assert.equal(one.messages[0].body, 'disk is full');
  assert.deepEqual(one.seen, { '/a': 'disk is full' });
  assert.deepEqual(G.alertNews(one.seen, [r('/a', 'a', P, 'disk is full')], ports).messages, [], 'the same alert is not news twice');
  assert.equal(G.alertNews(one.seen, [r('/a', 'a', P)], ports).seen['/a'], undefined, 'gone, it is forgotten and can come back');
  assert.equal(G.alertNews({}, [r('/a', 'a', P, 'x')], [P + 5]).messages.length, 0, 'a port outside the block is ignored');
  // one box-wide alert across every repo's tab is one push, however many tabs carry it
  const both = G.alertNews({}, [r('/a', 'a', P, 'same'), r('/b', 'b', P + 1, 'same')], ports);
  assert.equal(both.messages.length, 1);
  assert.equal(both.messages[0].title, 'Box alert (a, b)');
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
    assert.doesNotMatch((await gw.req('GET', '/sw.js', { on: P })).body, /showNotification/, 'only the box\'s name serves it');
    assert.equal((await gw.req('GET', '/sw.js', { on: P, headers: { 'sec-fetch-dest': 'serviceworker' } })).status, 403, 'and an instance still has no worker');
  } finally { await gw.close(); }
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

test('public.<box>: anyone reads a published artifact, from the gateway\'s own copy, under its own headers', async () => {
  const gw = await gateway('public-serve');
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    const page = '<!doctype html><p>hi';
    seedPublic(gw.dir, 'alpha', 'hello', { 'index.html': page, 'app.js': 'x()', 'img/a.png': 'png', 'data.weird': 'w' });
    const get = (route, headers = {}, method = 'GET') => gw.req(method, route, { on: 'public', cookie: '', headers });
    let r = await get('/alpha/hello/');
    assert.equal(r.status, 200);
    assert.equal(r.body, page);
    const etag = `"${crypto.createHash('sha256').update(page).digest('hex')}"`;
    assert.deepEqual([r.headers['content-type'], r.headers['content-length'], r.headers.etag, r.headers['cache-control'], r.headers['x-content-type-options'], r.headers['referrer-policy']], ['text/html; charset=utf-8', String(Buffer.byteLength(page)), etag, 'public, max-age=60', 'nosniff', 'no-referrer']);
    assert.equal(r.headers['set-cookie'], undefined);
    const self = `${gw.site}/alpha/hello/`;
    const csp = r.headers['content-security-policy'].split('; ');
    for (const d of ["default-src 'none'", `script-src 'unsafe-inline' 'unsafe-eval' ${self} https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com`, `connect-src ${self} https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com`, `img-src ${self} data: blob:`, "form-action 'none'", "frame-ancestors 'none'", 'sandbox allow-scripts allow-forms allow-modals allow-pointer-lock']) assert.ok(csp.includes(d), `the policy has ${d}: ${csp.join('; ')}`);
    assert.doesNotMatch(r.headers['content-security-policy'], /allow-same-origin|127\.0\.0\.1/);
    assert.equal((await get('/alpha/hello/app.js')).headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal((await get('/alpha/hello/img/a.png')).headers['content-type'], 'image/png');
    assert.equal((await get('/alpha/hello/data.weird')).headers['content-type'], 'application/octet-stream');
    // HEAD: the headers and no body; a strong tag that matches, or *, is a 304
    r = await get('/alpha/hello/', {}, 'HEAD');
    assert.deepEqual([r.status, r.body, r.headers['content-length'], r.headers.etag], [200, '', String(Buffer.byteLength(page)), etag]);
    assert.equal((await get('/alpha/hello/', { 'if-none-match': `"x", ${etag}` })).status, 304);
    assert.equal((await get('/alpha/hello/', { 'if-none-match': '*' })).status, 304);
    assert.equal((await get('/alpha/hello/', { 'if-none-match': `W/${etag}` })).status, 200, 'a weak tag is no match');
    // a lost blob: HEAD and GET agree
    const lost = path.join(gw.dir, 'public', 'blobs', crypto.createHash('sha256').update('w').digest('hex'));
    fs.renameSync(lost, `${lost}.away`);
    assert.deepEqual([(await get('/alpha/hello/data.weird', {}, 'HEAD')).status, (await get('/alpha/hello/data.weird')).status], [500, 500]);
    fs.renameSync(`${lost}.away`, lost);
    // reads only, and no service workers
    r = await gw.req('POST', '/alpha/hello/', { on: 'public', cookie: '', body: {} });
    assert.deepEqual([r.status, r.headers.allow], [405, 'GET, HEAD']);
    assert.equal((await get('/alpha/hello/app.js', { 'service-worker': 'script' })).status, 403);
    assert.equal((await get('/alpha/hello/app.js', { 'sec-fetch-dest': 'serviceworker' })).status, 403);
    // signed in or not, the same answer: the cookie is never read on this name, and none is set
    r = await gw.req('GET', '/alpha/hello/', { on: 'public' });
    assert.deepEqual([r.status, r.body, r.headers['set-cookie']], [200, page, undefined]);
    // nothing is listed, nothing unpublished is there, and the raw path is matched before decoding
    for (const bad of ['/', '/alpha/', '/alpha/nope/', '/beta/hello/', '/alpha/hello/nope.js', '/alpha/hello/.env', '/alpha/hello/%2e%2e/x', '/alpha/hello/../hello/app.js', '/Alpha/hello/', '/alpha/hello//app.js', '/box.json', '/auth/login'])
      assert.equal((await get(bad)).status, 404, bad);
    r = await get('/alpha/hello');
    assert.deepEqual([r.status, r.headers.location, r.headers['cache-control']], [302, '/alpha/hello/', 'no-store'], 'to the trailing slash, when published');
    assert.equal((await get('/alpha/nope')).status, 404, 'and only then');
    assert.equal((await gw.req('GET', '/', { headers: { host: `pub.box.localhost:${gw.port}` } })).status, 421, 'the box still answers only on its own names');
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
  S.reset = () => Object.assign(S, JSON.parse(made), { lie: {}, tree: {}, title: {}, trickle: {}, asked: [] });
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
  S.close = () => new Promise((r) => srv.close(r));
  return S;
}
// The owner's two steps: the gateway's confirm page, then its POST of what the page showed.
async function confirmAndPublish(gw, port, slugs, { move = false, before = async () => {} } = {}) {
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
  const A = landedProject(fs.mkdtempSync(path.join(tmp, 'pub-')), 'alpha', { hello: HELLO });
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
    assert.ok(conf.body.includes(`${gw.site}/alpha/hello/`), 'the link it will have');
    assert.match(conf.body, /not on this box/);
    assert.match(conf.body, /Not ticked, because this box holds no copy of it\. This instance's log records no publish of it/);
    assert.doesNotMatch(conf.body, /data-manifest="[0-9a-f]{64}" checked/, 'what the box has no copy of starts unticked');
    assert.ok(conf.body.includes(`from the checkout ${esc(fs.realpathSync(A))}, as this instance reports it`), 'the root, as reported');
    for (const f of ['index.html', 's.css', 'artifact.json']) assert.match(conf.body, new RegExp(`<div>${f.replace('.', '\\.')} <small>`), `${f} is named`);
    assert.doesNotMatch(conf.body, /autofocus/, 'the Publish button never has focus waiting');
    const items = [...conf.body.matchAll(/data-slug="([^"]+)" data-manifest="([0-9a-f]{64})"/g)].map(([, slug, manifest]) => ({ slug, manifest }));
    assert.equal(items.length, 1);
    // only from the box's own page, and only signed in
    assert.equal((await gw.req('POST', '/public/publish', { body: { port: P + 1, items }, headers: { origin: gw.inst(P + 1) } })).status, 403, 'not from an instance\'s name');
    assert.equal((await gw.req('POST', '/public/publish', { body: { port: P + 1, items }, cookie: '' })).status, 401);
    assert.equal((await gw.req('POST', '/public/publish', { body: { port: P + 1, items: [{ slug: 'hello', manifest: 'x' }] } })).status, 400);
    const r = await gw.req('POST', '/public/publish', { body: { port: P + 1, items } });
    assert.equal(r.status, 200, r.body);
    assert.deepEqual(r.json.results, [{ slug: 'hello', ok: true, url: `${gw.site}/alpha/hello/`, update: false }]);
    // anyone reads it, under the gateway's own headers
    const pubGet = (route, opts = {}) => gw.req('GET', route, { on: 'public', cookie: '', ...opts });
    let p = await pubGet('/alpha/hello/');
    assert.deepEqual([p.status, p.body, p.headers['set-cookie']], [200, HELLO['index.html'], undefined]);
    assert.ok(p.headers['content-security-policy'].includes(`script-src 'unsafe-inline' 'unsafe-eval' ${gw.site}/alpha/hello/ `));
    assert.equal(p.headers.etag, `"${crypto.createHash('sha256').update(HELLO['index.html']).digest('hex')}"`);
    assert.equal((await pubGet('/alpha/hello/s.css')).body, HELLO['s.css']);
    assert.equal((await pubGet('/alpha/hello/', { headers: { 'if-none-match': p.headers.etag } })).status, 304);
    assert.equal((await gw.req('HEAD', '/alpha/hello/', { on: 'public', cookie: '' })).body, '');
    assert.equal((await gw.req('POST', '/alpha/hello/', { on: 'public', body: {} })).status, 405);
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
      p = await pubGet('/alpha/hello/');
      assert.deepEqual([p.status, p.body], [200, HELLO['index.html']]);
    } finally { await new Promise((res) => impostor.close(res)); }
    assert.match(gw.logs.join('\n'), /public: hello published from instance/);
  } finally { await kitA.stop(); await gw.close(); }
});

test('public artifacts: a publish is refused unless every byte, the tree and the manifest are what the owner confirmed', async () => {
  const gw = await gateway('public-refuse');
  const S = standIn(P + 10, { a: { 'index.html': '<p>a', 'x/y.js': 'y()' }, b: { 'index.html': '<p>b' } });
  const pubGet = (route) => gw.req('GET', route, { on: 'public', cookie: '' });
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    // an instance that serves other bytes than its manifest names
    S.lie['a/x/y.js'] = 'z()'; // as long as the real one, so only its hash tells
    let { results } = await confirmAndPublish(gw, P + 10, ['a']);
    assert.match(results[0].error, /x\/y\.js is not the file the manifest names/);
    assert.deepEqual(blobsOf(gw), [], 'nothing of it is kept');
    assert.equal((await pubGet('/beta/a/')).status, 404);
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
    assert.equal((await pubGet('/beta/a/x/y.js')).body, 'y()');
    assert.equal((await pubGet('/beta/b/')).body, '<p>b');
    assert.deepEqual(S.recorded.map((r) => [r.op, r.slug, r.tree.length, r.headers.origin, r.headers['sec-fetch-site'], r.headers.cookie]).sort(), [['publish', 'a', 40, undefined, undefined, undefined], ['publish', 'b', 40, undefined, undefined, undefined]], 'recorded through a loopback request');
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
    assert.equal((await pubGet('/beta/b/')).body, '<p>b2');
    assert.equal(blobsOf(gw).length, 3, 'the old version\'s blob is swept');
  } finally { await S.close(); await gw.close(); }
});

test('public artifacts: a project stays with its checkout unless the owner moves it; a new port is no move', async () => {
  const gw = await gateway('public-bind');
  const one = standIn(P + 11, { a: { 'index.html': '<p>one' } }, { root: '/srv/one' });
  const two = standIn(P + 12, { a: { 'index.html': '<p>two' } }, { root: '/srv/two' });
  const twoAgain = standIn(P + 13, { a: { 'index.html': '<p>two' } }, { root: '/srv/two' });
  const served = async () => (await gw.req('GET', '/beta/a/', { on: 'public', cookie: '' })).body;
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
  } finally { await one.close(); await two.close(); await twoAgain.close(); await gw.close(); }
});

test('public artifacts: the box holds at most DEVTEAM_PUBLIC_MAX bytes for the public', async () => {
  const gw = await gateway('public-cap', { publicMax: 10 });
  const S = standIn(P + 14, { small: { 'index.html': '<p>12345' }, big: { 'index.html': '<p>more than ten bytes' } });
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    assert.ok((await confirmAndPublish(gw, P + 14, ['small'])).results[0].ok);
    const { results } = await confirmAndPublish(gw, P + 14, ['big']);
    assert.match(results[0].error, /over the box's public cap of 10 bytes \(DEVTEAM_PUBLIC_MAX\)/);
    assert.equal(blobsOf(gw).length, 1, 'refused before anything is written');
    assert.deepEqual(S.recorded.map((r) => r.slug), ['small']);
  } finally { await S.close(); await gw.close(); }
});

test('public artifacts: a move keeps only the slug moved; the old checkout\'s others are no longer public', async () => {
  const gw = await gateway('public-move');
  const one = standIn(P + 15, { a: { 'index.html': '<p>one a' }, b: { 'index.html': '<p>one b' } }, { root: '/srv/one' });
  const two = standIn(P + 16, { a: { 'index.html': '<p>two a' } }, { root: '/srv/two' });
  const pubGet = (route) => gw.req('GET', route, { on: 'public', cookie: '' });
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    assert.ok((await confirmAndPublish(gw, P + 15, ['a', 'b'])).results.every((r) => r.ok));
    assert.equal(blobsOf(gw).length, 2);
    const mv = await confirmAndPublish(gw, P + 16, ['a'], { move: true });
    assert.ok(mv.page.body.includes('move it (its 1 other page from /srv/one comes down: b)'), mv.page.body);
    assert.deepEqual([mv.results[0].ok, mv.results[0].update], [true, false], 'a move is a new binding, not an update');
    assert.equal((await pubGet('/beta/a/')).body, '<p>two a');
    assert.equal((await pubGet('/beta/b/')).status, 404, 'the old root\'s other slug is dropped');
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(gw.dir, 'state.json'), 'utf8')).public.beta.artifacts), ['a']);
    assert.deepEqual(blobsOf(gw), [crypto.createHash('sha256').update('<p>two a').digest('hex')], 'and its blobs swept');
  } finally { await one.close(); await two.close(); await gw.close(); }
});

// The review's repro: the owner publishes hello at T1, main moves on, and something on the box has
// the kit write a publish line for an artifact the owner never published. The route can't tell who
// is asking (a dashboard's owner actions never could), so the line lands; what matters is what it
// leads to on a new box, where the gateway holds no copy of anything.
test('public artifacts: on a new box a forged record leads to an unticked, explained item, never a silent publish', async () => {
  const WEEKLY = { 'index.html': '<p>weekly', 'raw-export.json': '{"secret":1}', 'artifact.json': JSON.stringify({ v: 1, title: 'Weekly', summary: 'Numbers', by: 'supervisor' }) };
  const A = landedProject(fs.mkdtempSync(path.join(tmp, 'pub-')), 'alpha', { hello: HELLO, weekly: WEEKLY });
  const treeOf = (slug) => execFileSync('git', ['rev-parse', `main:docs/devteam/project/artifacts/${slug}`], { cwd: A, encoding: 'utf8' }).trim();
  const kitA = startKit(A, P + 24);
  const first = await gateway('public-repro-first');
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
    const held = await first.req('GET', `/public/publish?port=${P + 24}&slug=hello`);
    assert.match(held.body, /an update/);
    assert.match(held.body, /data-slug="hello" data-manifest="[0-9a-f]{64}" checked/);
    assert.match(held.body, /1 changed, 1 new, 0 removed/);
    assert.match(held.body, /<b>changed<\/b> index\.html/);
    assert.match(held.body, /<b>new<\/b> extra\.txt/);
    await first.close();
    // a local process, as a worker could be: no Origin, no sec-fetch-*, the same as the gateway's own call
    const forged = await fetch(`http://127.0.0.1:${P + 24}/api/artifact-publish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'publish', slug: 'weekly', tree: treeOf('weekly') }) });
    assert.equal(forged.status, 200, 'what the route can\'t refuse');
    // a new box: the log moved, the gateway's copy didn't
    box = await gateway('public-repro-new');
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
    for (const s of ['hello', 'weekly']) assert.equal((await box.req('GET', `/alpha/${s}/`, { on: 'public', cookie: '' })).status, 404, `${s} isn't public until the owner ticks it`);
    // the Library has the two trees to compare
    const env = { ...process.env };
    delete env.DEVTEAM_ROLE;
    const lib = JSON.parse(execFileSync(process.execPath, [path.join(A, 'docs/devteam/scripts/devteam.mjs'), 'dashboard-data'], { cwd: A, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).library;
    const row = lib.artifacts.find((a) => a.slug === 'hello' && a.at === 'main');
    assert.deepEqual([row.published.tree, row.tree], [T1, T2]);
  } finally { await kitA.stop(); await first.close().catch(() => {}); await box?.close(); }
});

test('public artifacts: unpublish takes a page down, and records it only where that project is', async () => {
  const gw = await gateway('public-down');
  const S = standIn(P + 15, { a: { 'index.html': '<p>a' }, b: { 'index.html': '<p>b' }, c: { 'index.html': '<p>c' } });
  const other = standIn(P + 16, {}, { root: '/srv/elsewhere' });
  const pubStatus = async (route) => (await gw.req('GET', route, { on: 'public', cookie: '' })).status;
  const down = (body, opts = {}) => gw.req('POST', '/public/unpublish', { body, ...opts });
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    for (const s of ['a', 'b']) assert.ok((await confirmAndPublish(gw, P + 15, [s])).results[0].ok);
    // the confirm page names it from the gateway's own state
    const pg = await gw.req('GET', `/public/unpublish?port=${P + 15}&project=beta&slug=a`);
    assert.equal(pg.status, 200);
    assert.match(pg.body, /The a/);
    assert.ok(pg.body.includes(`${gw.site}/beta/a/`));
    assert.equal((await gw.req('GET', `/public/unpublish?port=${P + 15}&slug=a`)).status, 200, 'the project from the port it was last seen on');
    assert.equal((await gw.req('GET', '/public/unpublish?project=beta&slug=zzz')).status, 404);
    assert.equal((await gw.req('GET', `/public/unpublish?project=beta&slug=a`, { cookie: '' })).status, 401);
    assert.equal((await down({ project: 'beta', slug: 'a', port: P + 15 }, { headers: { origin: gw.inst(P + 15) } })).status, 403, 'not from an instance\'s name');
    assert.equal((await down({ project: 'beta', slug: 'a' }, { cookie: '' })).status, 401);
    let r = await down({ project: 'beta', slug: 'a', port: P + 15 });
    assert.deepEqual([r.status, r.json.recorded], [200, true], r.body);
    assert.deepEqual([S.recorded.at(-1).op, S.recorded.at(-1).slug, S.recorded.at(-1).headers.origin], ['unpublish', 'a', undefined]);
    assert.equal(await pubStatus('/beta/a/'), 404);
    assert.equal(await pubStatus('/beta/a'), 404, 'no redirect once it is down');
    assert.equal((await down({ project: 'beta', slug: 'a', port: P + 15 })).status, 404, 'once');
    const pubState = () => JSON.parse(fs.readFileSync(path.join(gw.dir, 'state.json'), 'utf8')).public;
    assert.deepEqual(blobsOf(gw), [...new Set(Object.values(pubState().beta.artifacts).flatMap((x) => Object.values(x.files).map((f) => f.sha256)))].sort(), 'its blobs are gone');
    // an instance that isn't beta at /srv/beta: the page comes down, the record isn't written there
    r = await down({ project: 'beta', slug: 'b', port: P + 16 });
    assert.deepEqual([r.status, r.json.recorded], [200, false]);
    assert.match(r.json.note, /instance \d+ is not beta at \/srv\/beta, so the record wasn't written there; the Library's Forget clears it/);
    assert.equal(other.recorded.length, 0);
    assert.equal(await pubStatus('/beta/b/'), 404);
    assert.equal(pubState().beta.root, '/srv/beta', 'the project stays bound to its checkout');
    // the gateway's list
    assert.ok((await confirmAndPublish(gw, P + 15, ['c'])).results[0].ok);
    const list = await gw.req('GET', '/public/');
    assert.equal(list.status, 200);
    assert.ok(list.body.includes(`${gw.site}/beta/c/`));
    assert.ok(list.body.includes('/public/unpublish?project=beta&#38;slug=c'));
    assert.ok(!list.body.includes('/beta/a/'));
    r = await down({ project: 'beta', slug: 'c' });
    assert.deepEqual([r.json.recorded, r.json.note], [false, 'no instance was named, so the record wasn\'t written; the Library\'s Forget clears it']);
    // an unpublish racing a publish leaves no dangling blob and no missing one
    assert.ok((await confirmAndPublish(gw, P + 15, ['c'])).results[0].ok);
    await Promise.all([confirmAndPublish(gw, P + 15, ['a']), down({ project: 'beta', slug: 'c' })]);
    const want = [...new Set(Object.values(pubState().beta.artifacts).flatMap((x) => Object.values(x.files).map((f) => f.sha256)))].sort();
    assert.deepEqual(blobsOf(gw), want);
    assert.deepEqual([await pubStatus('/beta/a/'), await pubStatus('/beta/c/')], [200, 404]);
  } finally { await S.close(); await other.close(); await gw.close(); }
});

test('public artifacts: a slow instance holds up no other change, and its item runs out of time', async () => {
  const gw = await gateway('public-slow', { publicItemMs: 1500, publicDeadlineMs: 10000 });
  const S = standIn(P + 22, { a: { 'index.html': 'x'.repeat(20) } });
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    seedPublic(gw.dir, 'alpha', 'other', { 'index.html': 'o' });
    S.trickle['a/index.html'] = 200; // 4 s in all, each byte well inside the per-request deadline
    const page = await gw.req('GET', `/public/publish?port=${P + 22}&slug=a`);
    const items = [...page.body.matchAll(/data-slug="([^"]+)" data-manifest="([0-9a-f]{64})"/g)].map(([, slug, manifest]) => ({ slug, manifest }));
    const publishing = gw.req('POST', '/public/publish', { body: { port: P + 22, items } });
    await until(() => S.asked.includes('/artifact/main/a/index.html'), 'the slow file asked for');
    const t0 = Date.now();
    const r = await gw.req('POST', '/public/unpublish', { body: { project: 'alpha', slug: 'other' } });
    const took = Date.now() - t0;
    assert.equal(r.status, 200, r.body);
    assert.ok(took < 800, `the unpublish waited ${took} ms on another instance's publish`);
    assert.equal((await gw.req('GET', '/alpha/other/', { on: 'public', cookie: '' })).status, 404);
    const done = await publishing;
    assert.match(done.json.results[0].error, /took over 1\.5 s for this item; nothing was published/);
    assert.ok(Date.now() - t0 < 3000, 'refused by the item\'s budget, not after the whole trickle');
    assert.equal(S.recorded.length, 0);
    assert.deepEqual(blobsOf(gw), []);
  } finally { await S.close(); await gw.close(); }
});

test('DEVTEAM_PUBLIC_MAX: anything but a positive number of bytes stops the gateway at startup', async () => {
  const make = (extra) => G.createGateway({ publicUrl: 'http://box.localhost:1', dir: fs.mkdtempSync(path.join(tmp, 'pmax-')), log: () => {}, ...extra });
  for (const v of ['abc', '0', '-5', 'Infinity', '', 'NaN']) assert.throws(() => make({ publicMax: v }), /DEVTEAM_PUBLIC_MAX must be a positive number of bytes/, JSON.stringify(v));
  process.env.DEVTEAM_PUBLIC_MAX = 'lots';
  try { assert.throws(() => make({}), /DEVTEAM_PUBLIC_MAX must be a positive number of bytes/, 'from the environment too'); } finally { delete process.env.DEVTEAM_PUBLIC_MAX; }
  make({});
  const gw = await gateway('public-max1', { publicMax: '1' });
  const S = standIn(P + 23, { a: { 'index.html': '<p>a' } });
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    const { results } = await confirmAndPublish(gw, P + 23, ['a']);
    assert.match(results[0].error, /over the box's public cap of 1 bytes/);
    assert.deepEqual(blobsOf(gw), []);
  } finally { await S.close(); await gw.close(); }
});

test('public artifacts: "move it" moves from the root the page showed, and says what comes down', async () => {
  const gw = await gateway('public-rebind');
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
    assert.equal((await gw.req('GET', '/beta/a/', { on: 'public', cookie: '' })).body, '<p>three');
    assert.equal(two.recorded.length, 0);
  } finally { await one.close(); await two.close(); await three.close(); await gw.close(); }
});

test('public artifacts: a sweep that fails after an unpublish still takes the page down', async () => {
  const gw = await gateway('public-sweepfail');
  const S = standIn(P + 15, { a: { 'index.html': '<p>a' } });
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    assert.ok((await confirmAndPublish(gw, P + 15, ['a'])).results[0].ok);
    // a name in the blob folder the sweep can't remove
    fs.mkdirSync(path.join(gw.dir, 'public', 'blobs', 'stuck'));
    const r = await gw.req('POST', '/public/unpublish', { body: { project: 'beta', slug: 'a', port: P + 15 } });
    assert.deepEqual([r.status, r.json?.ok, r.json?.recorded], [200, true, true], r.body);
    assert.equal(S.recorded.at(-1).op, 'unpublish');
    assert.equal((await gw.req('GET', '/beta/a/', { on: 'public', cookie: '' })).status, 404);
  } finally { await S.close(); await gw.close(); }
});

test('public artifacts: the gateway\'s /public pages load only as a document, never in another site\'s frame', async () => {
  const gw = await gateway('public-frame');
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
  } finally { await S.close(); await gw.close(); }
});

test('x-devteam-public: a dashboard learns what the box serves, from the gateway alone', async () => {
  const gw = await gateway('public-header');
  const up = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'x-devteam-public': '{"forged":1}' }); res.end('{}'); }).listen(P + 17, '127.0.0.1');
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    seedPublic(gw.dir, 'alpha', 'hello', { 'index.html': 'x' }, { root: '/srv/alpha', port: P + 17 });
    seedPublic(gw.dir, 'zeta', 'z', { 'index.html': 'z' }, { root: '/srv/zéta', port: P + 3 });
    let r = await gw.req('GET', '/api/data', { on: P + 17 });
    assert.equal(r.status, 200);
    assert.match(r.headers['x-devteam-public'], /^[\x20-\x7e]+$/, 'ASCII, whatever a root holds');
    assert.deepEqual(JSON.parse(r.headers['x-devteam-public']), { alpha: { port: P + 17, root: '/srv/alpha', artifacts: { hello: 'a'.repeat(40) } }, zeta: { port: P + 3, root: '/srv/zéta', artifacts: { z: 'a'.repeat(40) } } });
    assert.equal((await gw.req('GET', '/api/fleet', { on: P + 17 })).headers['x-devteam-public'], undefined, 'an upstream\'s own copy is dropped');
    assert.equal((await gw.req('GET', '/api/data', { on: P + 17, cookie: '' })).status, 401, 'signed in only');
    // past 32 KB, only the asking instance's own projects
    for (let i = 0; i < 200; i++) seedPublic(gw.dir, `p${i}`, 'x', { 'index.html': `${i}` }, { root: `/srv/${'r'.repeat(200)}${i}`, port: P + 20 });
    r = await gw.req('GET', '/api/data', { on: P + 17 });
    assert.deepEqual(Object.keys(JSON.parse(r.headers['x-devteam-public'])), ['alpha']);
  } finally { await new Promise((res) => up.close(res)); await gw.close(); }
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
