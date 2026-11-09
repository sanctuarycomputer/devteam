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
  const auth = `http://auth.box.localhost:${port}`;
  const term = `http://term.box.localhost:${port}`;
  const ttydPage = path.join(tmp, `${name}-ttyd.html`);
  fs.writeFileSync(ttydPage, 'the gateway\'s copy of ttyd');
  const logs = [];
  const dir = path.join(tmp, name);
  const ttydPort = await freePort();
  const g = G.createGateway({ publicUrl, dir, ttydPort, ttydPage, log: (m) => logs.push(m), ...extra });
  await new Promise((r) => g.server.listen(port, '127.0.0.1', r));
  const token = /claim#([A-Za-z0-9_-]+)/.exec(logs.join('\n'))?.[1];
  let jar = '';
  // on: an instance's port, for its subdomain; else the box's own name
  const req = (method, route, { body, headers = {}, cookie = jar, on = route.startsWith('/auth/') ? 'auth' : undefined } = {}) => new Promise((resolve, reject) => {
    const self = on === 'auth' ? auth : on === 'term' ? term : on ? inst(on) : publicUrl;
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
  return { g, port, publicUrl, inst, auth, term, ttydPort, logs, token, req, claim, login, jar: () => jar, setJar: (v) => { jar = v; }, dir, close: () => new Promise((r) => g.server.close(r)) };
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
    assert.equal((await gw.req('GET', '/', { headers: { 'sec-fetch-mode': 'navigate' } })).headers.location, `${gw.auth}/auth/login`, 'unclaimed: every page sends you to sign in, on the auth name');
    assert.ok(gw.logs.join('\n').includes(`${gw.auth}/auth/claim#`), 'the claim link is on the auth name');
    assert.equal((await gw.req('GET', '/auth/claim?x=1', { on: null })).headers.location, `${gw.auth}/auth/claim?x=1`, 'the box sends its own /auth/ there (a link\'s #token goes along)');
    assert.equal((await gw.req('GET', '/', { on: 'auth' })).headers.location, `${gw.publicUrl}/`, 'and the auth name serves nothing else');
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
    bad = await gw.req('POST', '/auth/claim/verify', { body: { token: gw.token, ...a.create(o.json, gw.publicUrl) } });
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
    // passkeys belong to the auth name, and a login challenge can't be flooded away or used twice
    const flood = await gw.req('POST', '/auth/login/options', { body: {}, cookie: '' });
    assert.equal(flood.json.rpId, 'auth.box.localhost');
    for (let i = 0; i < 300; i++) await gw.req('POST', '/auth/login/options', { body: {}, cookie: '' });
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
    assert.equal((await gw.req('POST', '/auth/login/options', { body: {}, headers: { origin: gw.publicUrl } })).status, 403, 'nor the box\'s own pages on the auth name');
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
    assert.deepEqual((await gw.req('GET', '/box.json')).json, { box: 1, terminal: `${gw.term}/`, instance: `http://{port}.box.localhost:${gw.port}/`, passkeys: `${gw.auth}/auth/passkeys` }, 'the hub learns where instances are');

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
    assert.equal(tp.body, 'the gateway\'s copy of ttyd');
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
  const evil = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'a=1', 'content-security-policy': "frame-ancestors *" }); res.end(req.url === '/instances.json' ? '{"hub":1,"instances":[]}' : '<script>evil()</script>'); });
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
    assert.equal((await gw.req('GET', '/anything')).status, 404);
  } finally { evil.close(); await gw.close(); }
  const gw2 = await gateway('nohub');
  try {
    assert.equal((await gw2.claim(authenticator())).status, 200);
    await until(async () => (await gw2.req('GET', '/instances.json')).body === '{"hub":1,"instances":[]}', 'an empty list when nothing holds the port');
    assert.equal((await gw2.req('GET', '/')).status, 200, 'and the page, with its Terminal tab, on first boot');
  } finally { await gw2.close(); }
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
    const o = await call('auth.box.localhost', 'POST', '/auth/claim/options', { token });
    const ok = await call('auth.box.localhost', 'POST', '/auth/claim/verify', { token, ...a.create(o.json, 'https://auth.box.localhost') });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.match(ok.headers['set-cookie'][0], /^devteam_session=[\w-]+; Domain=box\.localhost; Path=\/; HttpOnly; Max-Age=1209600; Secure; SameSite=None$/);
    assert.equal(ok.headers['strict-transport-security'], 'max-age=31536000');
    const cookie = ok.headers['set-cookie'][0].split(';')[0];
    assert.equal((await call('box.localhost', 'GET', '/box.json', null, { cookie })).json.terminal, 'https://term.box.localhost/');
  } finally { await new Promise((r) => g.server.close(r)); }
});
