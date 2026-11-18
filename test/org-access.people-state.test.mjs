// The gateway knows people (cloud/gateway.mjs, people@1): the owner's row, each person's own
// passkeys, sessions and push subscriptions, and a rollback to an older gateway that lets in only
// the owner. Tests for the org-access goal's measure are named 'org-access A<n>: …'. People other
// than the owner are seeded by writing the state file (nothing makes one until invites land).
// Run: node --test test/org-access.people-state.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// the suite's shared env scrub and tmux shim
import './lib/kit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const NEW = path.join(repo, 'cloud', 'gateway.mjs');
const HUB_PAGE = path.join(repo, 'docs', 'devteam', 'dashboard', 'hub.html');
// ports of its own, apart from test/gateway.test.mjs's (10000 + …) and lib/kit.mjs's blocks (20000 and up)
const HUB = 15000 + (process.pid % 90) * 50;
const P = HUB + 1;
process.env.DEVTEAM_HUB_PORT = String(HUB);
process.env.DEVTEAM_PORT_BASE = String(P);
process.env.DEVTEAM_HUB_RETRY_MS = '500';
delete process.env.DEVTEAM_CLAIM_TOKEN;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-people-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

const sha = (b) => crypto.createHash('sha256').update(b).digest();
const u = (b) => Buffer.from(b).toString('base64url');
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const rid = (prefix) => prefix + Array.from(crypto.randomBytes(12), (x) => B32[x & 31]).join('');
// people@1's stamp, written apart from the gateway's
const stampOf = (ids) => u(sha(`devteam-people-stamp-v1\n${[...ids].sort().join('\n')}`));
const cookieOf = (res) => res.headers['set-cookie']?.find((c) => c.startsWith('devteam_session='))?.split(';')[0] ?? null;

// --- a software authenticator, as test/gateway.test.mjs's, that can also be seeded as a method ---
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

// --- the fake: rows of people@1, appended to a state ---------------------------------------------
// Each { name, role, level, methods } is filled out as the gateway writes a row. Throws when a
// (type, key) would repeat on the box, the owner's top-level passkeys counted as ('passkey', id).
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

// --- a gateway on a localhost URL, new or older (extra.module), and a browser's requests ---------
const freePort = () => new Promise((resolve, reject) => { const v = net.createServer(); v.on('error', reject); v.listen(0, '127.0.0.1', () => { const { port } = v.address(); v.close(() => resolve(port)); }); });
const modules = new Map();
const load = async (file) => { if (!modules.has(file)) modules.set(file, await import(pathToFileURL(file).href)); return modules.get(file); };
async function gateway(name, extra = {}) {
  const { module = NEW, token: given, port: fixed, ...opts } = extra;
  const G = await load(module);
  const port = fixed ?? await freePort();
  const publicUrl = `http://box.localhost:${port}`;
  const inst = (p) => `http://${p}.box.localhost:${port}`;
  const term = `http://term.box.localhost:${port}`;
  const ttydPage = path.join(tmp, `${name}-ttyd.html`);
  fs.writeFileSync(ttydPage, 'the gateway\'s copy of ttyd');
  const uploadsDir = path.join(tmp, `${name}-uploads`);
  fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o750 });
  const logs = [];
  const dir = opts.dir ?? path.join(tmp, name);
  const g = G.createGateway({ publicUrl, dir, ttydPort: await freePort(), ttydPage, uploadsDir, hubPage: HUB_PAGE, log: (m) => logs.push(m), ...opts });
  await new Promise((r) => g.server.listen(port, '127.0.0.1', r));
  const token = given ?? /claim#([A-Za-z0-9_-]+)/.exec(logs.join('\n'))?.[1];
  const file = path.join(dir, 'state.json');
  let jar = '';
  const req = (method, route, { body, headers = {}, cookie = jar, on } = {}) => new Promise((resolve, reject) => {
    const self = on === 'term' ? term : on ? inst(on) : publicUrl;
    const h = { host: new URL(self).host, ...(method !== 'GET' ? { origin: self, 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers };
    for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
    const r = http.request({ host: '127.0.0.1', port, method, path: route, headers: h }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        const sc = cookieOf(res);
        if (sc) jar = sc;
        let j = null;
        try { j = JSON.parse(b); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: b, json: j });
      });
    });
    r.on('error', reject);
    r.end(body === undefined ? undefined : JSON.stringify(body));
  });
  // extraBody.token: another claim link's (after a reclaim)
  const claim = async (a, extraBody = {}) => {
    const t = extraBody.token ?? token;
    const o = await req('POST', '/auth/claim/options', { body: { token: t } });
    assert.equal(o.status, 200, o.body);
    return req('POST', '/auth/claim/verify', { body: { token: t, ...a.create(o.json, publicUrl), ...extraBody } });
  };
  const login = async (a, how) => {
    const o = await req('POST', '/auth/login/options', { body: {}, cookie: '' });
    return req('POST', '/auth/login/verify', { body: a.get(o.json, publicUrl, how), cookie: '' });
  };
  const state = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const write = (s) => { const t = `${file}.test.tmp`; fs.writeFileSync(t, JSON.stringify(s, null, 2), { mode: 0o600 }); fs.renameSync(t, file); };
  const seed = (people) => { const { state: s, rows } = seedPeople(state(), people); write(s); return rows; };
  return { g, port, publicUrl, inst, term, logs, token, dir, file, req, claim, login, state, write, seed, jar: () => jar, setJar: (v) => { jar = v; }, close: () => new Promise((r) => g.server.close(r)) };
}

test('people@1: seedPeople writes rows of the documented shape, unique by (type, key)', () => {
  const owner = authenticator();
  const ana = authenticator();
  const vic = authenticator();
  const base = { passkeys: [{ id: u(owner.id), name: 'laptop', createdAt: new Date().toISOString() }], sessions: [], claimHash: null };
  const { state, rows } = seedPeople(base, [{ name: 'Ana', methods: [ana.method()] }, { name: 'Vic', level: 'view', methods: [vic.method()] }]);
  assert.equal(state.people.length, 2);
  for (const r of rows) {
    assert.match(r.id, /^p-[a-z2-7]{12}$/);
    assert.deepEqual(Object.keys(r), ['id', 'name', 'role', 'level', 'methods', 'pushSubs', 'added_at', 'last_seen', 'notices', 'rev']);
    for (const m of r.methods) {
      assert.match(m.id, /^m-[a-z2-7]{12}$/);
      assert.deepEqual(Object.keys(m), ['id', 'type', 'key', 'label', 'added_at', 'last_used', 'data']);
    }
  }
  assert.deepEqual(rows.map((r) => [r.role, r.level]), [['member', 'full'], ['member', 'view']]);
  assert.deepEqual(state.passkeys, base.passkeys, 'the owner\'s passkeys stay top-level, untouched');
  assert.throws(() => seedPeople(state, [{ name: 'Ann', methods: [{ ...ana.method(), id: rid('m-') }] }]), /already on the box/, 'one of Ana\'s credentials, again');
  const stolen = { id: rid('m-'), type: 'passkey', key: u(owner.id), label: 'x', added_at: '', last_used: null, data: {} };
  assert.throws(() => seedPeople(state, [{ name: 'Eve', methods: [stolen] }]), /already on the box/, 'the owner\'s top-level credential');
  assert.equal(stampOf(['b', 'a']), stampOf(['a', 'b']), 'the stamp is of the sorted ids');
});


// --- A1: the owner's row, on a claim and on the upgrade of a box claimed before people ----------
const OWNER_ROW = ['id', 'name', 'role', 'level', 'methods', 'pushSubs', 'added_at', 'last_seen', 'notices', 'rev'];
const ownerOf = (s) => s.people.filter((p) => p.role === 'owner');
// a session minted as today's gateway mints one, with its cookie
const mintSession = (extra = {}) => { const tok = crypto.randomBytes(32); return { row: { hash: u(sha(tok)), at: Date.now(), expires: Date.now() + 3600e3, ...extra }, cookie: `devteam_session=${u(tok)}` }; };
// a browser's push subscription, as the gateway stores it
const pushSub = (endpoint) => ({ endpoint, p256dh: u(crypto.createECDH('prime256v1').generateKeys()), auth: u(crypto.randomBytes(16)), at: new Date().toISOString() });
// what a browser sends /push/subscribe, as test/gateway.test.mjs's browserKeys
const subscribing = (endpoint) => { const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys(); return { endpoint, keys: { p256dh: u(ecdh.getPublicKey()), auth: u(crypto.randomBytes(16)) } }; };
// a hub on HUB whose list is whatever `list()` says now, for the gateway's poller
const fakeHub = async (list) => {
  const hub = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ hub: 1, instances: list() })); });
  for (let i = 0; ; i++) {
    if (await new Promise((r) => { hub.once('error', () => r(false)); hub.listen(HUB, '127.0.0.1', () => r(true)); })) return hub;
    if (i > 50) throw new Error('the hub port stays taken');
    await new Promise((r) => setTimeout(r, 100));
  }
};
// a passkey in today's top-level shape, registered on box.localhost unless `rp` says otherwise
const topPasskey = (a, name, extra = {}) => {
  const m = a.method(name);
  return { id: m.key, userId: m.data.userId, jwk: m.data.jwk, alg: -7, signCount: 0, name, rp: 'box.localhost', createdAt: new Date().toISOString(), ...extra };
};
// a state of today's shape, written in the order today's gateway saves it (load puts these three first)
function oldState() {
  const a = authenticator();
  const b = authenticator();
  const { rp, ...noRp } = topPasskey(b, 'old laptop');
  const s1 = mintSession();
  const s2 = mintSession();
  const pair = crypto.generateKeyPairSync('ed25519');
  const state = {
    passkeys: [topPasskey(a, 'phone', { usedAt: new Date().toISOString() }), noRp],
    sessions: [s1.row, s2.row],
    claimHash: null,
    claimExpires: null,
    pushSubs: [pushSub('https://web.push.apple.com/phone'), pushSub('https://fcm.googleapis.com/fcm/send/desk')],
    threadKey: { privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }) },
    public: { alpha: { root: '/srv/alpha', port: P, artifacts: {} } },
  };
  return { state, a, b, cookies: [s1.cookie, s2.cookie] };
}
const writeState = (dir, s) => { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(s, null, 2), { mode: 0o600 }); };

test('org-access A1: the first passkey claimed is the owner\'s', async () => {
  const gw = await gateway('a1-claim');
  try {
    const a = authenticator();
    const r = await gw.claim(a);
    assert.equal(r.status, 200, r.body);
    const s = gw.state();
    assert.equal(s.people.length, 1);
    const [row] = s.people;
    assert.deepEqual(Object.keys(row), OWNER_ROW);
    assert.match(row.id, /^p-[a-z2-7]{12}$/);
    assert.deepEqual({ name: row.name, role: row.role, level: row.level, methods: row.methods, pushSubs: row.pushSubs, notices: row.notices, rev: row.rev, last_seen: row.last_seen }, { name: 'Owner', role: 'owner', level: 'full', methods: [], pushSubs: [], notices: [], rev: 1, last_seen: null });
    assert.deepEqual(s.passkeys.map((p) => p.id), [u(a.id)], 'the passkey is top-level, as today');
    assert.equal(s.sessions.length, 1);
    assert.equal(s.sessions[0].method, u(a.id), 'the claim\'s session names its passkey');
    assert.deepEqual(s.peopleSessions, []);
    assert.equal(s.peopleStamp, stampOf([u(a.id)]));
  } finally { await gw.close(); }
});

test('org-access A1: an existing box\'s passkeys, sessions and push subscriptions are the owner\'s, and its old fields are unchanged', async () => {
  const dir = path.join(tmp, 'a1-upgrade');
  const { state: before, cookies } = oldState();
  writeState(dir, before);
  const sent = [];
  const pushFetch = async (endpoint) => { sent.push(endpoint); return { status: 201 }; };
  const gw = await gateway('a1-upgrade', { dir, pushFetch });
  try {
    const after = gw.state();
    for (const k of Object.keys(before)) assert.equal(JSON.stringify(after[k]), JSON.stringify(before[k]), `${k} is byte-identical`);
    assert.deepEqual(Object.keys(after).slice(0, Object.keys(before).length), Object.keys(before), 'the old keys keep their order, first');
    assert.equal(ownerOf(after).length, 1, 'one owner row');
    assert.deepEqual(Object.keys(after.people[0]), OWNER_ROW);
    assert.deepEqual({ name: after.people[0].name, methods: after.people[0].methods, pushSubs: after.people[0].pushSubs }, { name: 'Owner', methods: [], pushSubs: [] });
    assert.equal(after.peopleStamp, stampOf(before.passkeys.map((p) => p.id)));
    for (const cookie of cookies) assert.equal((await gw.req('GET', '/box.json', { cookie })).status, 200, 'the owner\'s old sessions still open the box');
    const list = await gw.req('GET', '/auth/method/list', { cookie: cookies[0] });
    assert.equal(list.status, 200, list.body);
    assert.deepEqual(list.json.methods, before.passkeys.map((p) => ({ id: p.id, type: 'passkey', label: p.name, added_at: p.createdAt, last_used: p.usedAt ?? null })), 'the old passkeys are the owner\'s methods');
    const t = await gw.req('POST', '/push/test', { cookie: cookies[0], body: { endpoint: 'https://web.push.apple.com/phone' } });
    assert.equal(t.status, 200, t.body);
    assert.deepEqual(sent, ['https://web.push.apple.com/phone'], 'an old subscription is the owner\'s');
    const ana = authenticator();
    gw.seed([{ name: 'Ana', methods: [ana.method()] }]);
    const ac = await signIn(gw, ana);
    sent.length = 0;
    const theirs = await gw.req('POST', '/push/test', { cookie: ac, body: { endpoint: 'https://web.push.apple.com/phone' } });
    assert.equal(theirs.status, 404, 'the owner\'s device is not a seeded person\'s');
    assert.deepEqual(sent, []);
  } finally { await gw.close(); }
});

test('org-access A1: a second start of an upgraded state writes nothing', async () => {
  const dir = path.join(tmp, 'a1-restart');
  writeState(dir, oldState().state);
  const first = await gateway('a1-restart-1', { dir });
  await first.close();
  assert.ok(first.state().people, 'the first start upgraded it');
  const st = fs.statSync(first.file);
  const bytes = fs.readFileSync(first.file);
  const second = await gateway('a1-restart-2', { dir });
  try {
    const now = fs.statSync(first.file);
    assert.ok(fs.readFileSync(first.file).equals(bytes), 'the same bytes');
    assert.deepEqual([now.ino, now.mtimeMs], [st.ino, st.mtimeMs], 'and the file was not rewritten');
  } finally { await second.close(); }
  // and a box claimed by this gateway, restarted
  const claimed = await gateway('a1-restart-3');
  assert.equal((await claimed.claim(authenticator())).status, 200);
  await claimed.close();
  const st2 = fs.statSync(claimed.file);
  const bytes2 = fs.readFileSync(claimed.file);
  const again = await gateway('a1-restart-4', { dir: claimed.dir });
  try {
    const now = fs.statSync(claimed.file);
    assert.ok(fs.readFileSync(claimed.file).equals(bytes2), 'the same bytes');
    assert.deepEqual([now.ino, now.mtimeMs], [st2.ino, st2.mtimeMs]);
  } finally { await again.close(); }
});

// --- A9: who a session is ------------------------------------------------------------------------
// today's `reclaim` command, as a shell on the box runs it
const reclaim = (gw) => spawnSync(process.execPath, [NEW, 'reclaim'], { env: { ...process.env, DEVTEAM_PUBLIC_URL: gw.publicUrl, DEVTEAM_GATEWAY_DIR: gw.dir }, encoding: 'utf8', timeout: 30e3 });
// the hash a cookie's session is stored under
const hashOf = (cookie) => u(sha(Buffer.from(cookie.split('=')[1], 'base64url')));
// The owner claims; Ana (full) and Vic (view) are seeded with a passkey each.
async function people(name, extra) {
  const gw = await gateway(name, extra);
  const owner = authenticator();
  const ana = authenticator();
  const vic = authenticator();
  const c = await gw.claim(owner);
  assert.equal(c.status, 200, c.body);
  const ownerCookie = cookieOf(c);
  const [anaRow, vicRow] = gw.seed([{ name: 'Ana', methods: [ana.method()] }, { name: 'Vic', level: 'view', methods: [vic.method()] }]);
  return { gw, owner, ana, vic, ownerCookie, anaRow, vicRow };
}
const signIn = async (gw, a) => { const r = await gw.login(a); assert.equal(r.status, 200, r.body); return cookieOf(r); };
// a raw WebSocket upgrade: the status line's code, or 0 when the socket closes without an answer
const upgrade = (gw, host, headers, route = '/ws') => new Promise((resolve) => {
  const s = net.connect(gw.port, '127.0.0.1', () => s.write(`GET ${route} HTTP/1.1\r\n${Object.entries({ host, upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-key': 'x', 'sec-websocket-version': '13', ...headers }).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`));
  let b = '';
  const done = (code) => { resolve(code); s.destroy(); };
  s.setTimeout(10e3, () => done(-1));
  s.on('data', (c) => { b += c; if (b.includes('\r\n')) done(Number(b.split(' ')[1])); });
  s.on('error', () => done(0));
  s.on('close', () => done(b ? Number(b.split(' ')[1]) : 0));
});
const PV = 'brave-otter';
const termWs = (gw, cookie) => upgrade(gw, `term.box.localhost:${gw.port}`, { origin: gw.term, cookie });
const previewWs = (gw, cookie) => upgrade(gw, `${PV}.box.localhost:${gw.port}`, { origin: `http://${PV}.box.localhost:${gw.port}`, cookie }, '/');
// an artifact opened as a document on an instance's name: its 302 to a capability link
const artifactLink = async (gw, cookie) => {
  const r = await gw.req('GET', '/artifact/main/x/index.html', { on: P, cookie, headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' } });
  assert.equal(r.status, 302, r.body);
  assert.match(r.headers.location, /^\/c\/\d+\.[\w-]+\.[\w-]+\/artifact\/main\/x\/index\.html$/);
  return r.headers.location;
};

test('org-access A1: a claim after a reclaim keeps the owner\'s row', async () => {
  const gw = await gateway('a1-reclaim-claim');
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    const before = ownerOf(gw.state());
    assert.equal(before.length, 1);
    const r = reclaim(gw);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual([gw.state().passkeys, gw.state().sessions], [[], []], 'unclaimed, the owner\'s row still there');
    const token = /claim#([A-Za-z0-9_-]+)/.exec(r.stdout)?.[1];
    const a = authenticator();
    const c = await gw.claim(a, { token });
    assert.equal(c.status, 200, c.body);
    const after = gw.state();
    assert.equal(ownerOf(after).length, 1, 'exactly one owner row');
    assert.equal(ownerOf(after)[0].id, before[0].id, 'the same row');
    assert.deepEqual(after.passkeys.map((p) => p.id), [u(a.id)]);
    assert.equal(after.peopleStamp, stampOf([u(a.id)]));
  } finally { await gw.close(); }
});

test('org-access A9: a person signs in with their passkey into a session of their own', async () => {
  const { gw, owner, ana, ownerCookie, anaRow } = await people('a9-signin');
  try {
    const before = gw.state();
    const cookie = await signIn(gw, ana);
    const s = gw.state();
    const h = hashOf(cookie);
    assert.deepEqual(s.peopleSessions.map((x) => [x.hash, x.person, x.method]), [[h, anaRow.id, anaRow.methods[0].id]], 'in peopleSessions, Ana\'s, opened with her method');
    assert.ok(!s.sessions.some((x) => x.hash === h), 'not in the owner\'s sessions');
    assert.equal(JSON.stringify(s.passkeys.map(({ signCount, usedAt, ...p }) => p)), JSON.stringify(before.passkeys.map(({ signCount, usedAt, ...p }) => p)), 'the owner\'s passkeys untouched');
    const row = s.people.find((p) => p.id === anaRow.id);
    assert.ok(row.last_seen, 'last_seen is set');
    assert.equal(row.rev, 1, 'and does not bump rev');
    assert.ok(row.methods[0].last_used, 'the method\'s last use');
    assert.equal(row.methods[0].data.signCount, 1, 'its counter, where it lives');
    assert.equal((await gw.req('GET', '/box.json', { cookie })).status, 200);
    const inst = await gw.req('GET', '/', { on: P, cookie });
    assert.notEqual(inst.status, 401, 'an instance\'s name lets her past the session check');
    assert.notEqual(inst.status, 302);
    assert.equal((await gw.req('GET', '/', { on: P, cookie: '' })).status, 401);
    // her counter is checked where it lives: a replay of an old count is refused
    assert.equal((await gw.login(ana, { counter: 1 })).status, 400);
    // the owner's sign-in stays top-level, and names its passkey
    const oc = await signIn(gw, owner);
    const top = gw.state().sessions.find((x) => x.hash === hashOf(oc));
    assert.equal(top?.method, u(owner.id), 'the owner\'s session names the passkey');
    assert.equal(gw.state().peopleSessions.length, 1);
    assert.equal((await gw.req('GET', '/box.json', { cookie: ownerCookie })).status, 200);
  } finally { await gw.close(); }
});

test('org-access A9: expired peopleSessions entries are dropped on save', async () => {
  const { gw, ana, anaRow, vicRow } = await people('a9-expired');
  try {
    const old = mintSession({ person: vicRow.id, method: vicRow.methods[0].id, expires: Date.now() - 1000 });
    const live = mintSession({ person: vicRow.id, method: vicRow.methods[0].id });
    gw.write({ ...gw.state(), peopleSessions: [old.row, live.row] });
    assert.equal((await gw.req('GET', '/box.json', { cookie: old.cookie })).status, 401, 'an expired entry opens nothing');
    await signIn(gw, ana);
    const hashes = gw.state().peopleSessions.map((x) => x.hash);
    assert.ok(!hashes.includes(old.row.hash), 'the expired one went with the write');
    assert.ok(hashes.includes(live.row.hash), 'the live one stayed');
    assert.equal(gw.state().peopleSessions.find((x) => x.hash !== live.row.hash).person, anaRow.id);
  } finally { await gw.close(); }
});

test('org-access A9: sign-out ends only the signed-in person\'s session', async () => {
  const { gw, ana, vic, ownerCookie } = await people('a9-logout');
  try {
    const ac = await signIn(gw, ana);
    const vc = await signIn(gw, vic);
    const before = gw.state();
    const r = await gw.req('POST', '/auth/logout', { cookie: ac, body: {} });
    assert.equal(r.status, 200, r.body);
    const s = gw.state();
    assert.deepEqual(s.peopleSessions.map((x) => x.hash), [hashOf(vc)], 'Ana\'s entry is gone, Vic\'s stays');
    assert.deepEqual(s.sessions, before.sessions, 'the owner\'s untouched');
    assert.equal((await gw.req('GET', '/box.json', { cookie: ac })).status, 401);
    assert.equal((await gw.req('GET', '/box.json', { cookie: ownerCookie })).status, 200);
    assert.equal((await gw.req('GET', '/box.json', { cookie: vc })).status, 200);
  } finally { await gw.close(); }
});

test('org-access A9: a person\'s session opens artifact links, the terminal\'s socket and a preview\'s', async () => {
  const { gw, ana } = await people('a9-paths');
  try {
    const cookie = await signIn(gw, ana);
    const link = await artifactLink(gw, cookie);
    assert.notEqual((await gw.req('GET', link, { on: P, cookie: '' })).status, 403, 'capOk accepts a person\'s session');
    assert.notEqual(await termWs(gw, cookie), 401, 'the terminal\'s upgrade passes the session check');
    assert.equal(await termWs(gw, undefined), 401, 'and without a session it is refused');
    assert.equal(await previewWs(gw, cookie), 503, 'a preview\'s upgrade gets past the session check to "no such preview"');
    assert.equal(await previewWs(gw, undefined), 401);
    // an unclaimed box honours no link, as no other path, even with Ana's entry live (as an older
    // gateway's reclaim leaves it, until the next start's stamp check)
    gw.write({ ...gw.state(), passkeys: [], sessions: [] });
    assert.ok(gw.state().peopleSessions.length, 'Ana\'s entry is live');
    assert.equal((await gw.req('GET', link, { on: P, cookie: '' })).status, 403, 'capOk needs the box claimed');
  } finally { await gw.close(); }
});

test('org-access A9: a person whose row is deleted has every session and link refused at once', async () => {
  const { gw, ana, anaRow, ownerCookie } = await people('a9-removed');
  try {
    const cookie = await signIn(gw, ana);
    const link = await artifactLink(gw, cookie);
    assert.equal((await gw.req('GET', '/box.json', { cookie })).status, 200);
    const s = gw.state();
    gw.write({ ...s, people: s.people.filter((p) => p.id !== anaRow.id) });
    assert.equal((await gw.req('GET', '/box.json', { cookie })).status, 401);
    assert.equal((await gw.req('GET', '/', { on: P, cookie })).status, 401, 'an instance\'s name');
    assert.equal((await gw.req('GET', link, { on: P, cookie: '' })).status, 403, 'the /c/ link issued before');
    assert.equal(await termWs(gw, cookie), 401);
    assert.equal(await previewWs(gw, cookie), 401);
    assert.equal((await gw.req('GET', '/box.json', { cookie: ownerCookie })).status, 200, 'the owner is still in');
    // an entry naming nobody (a hand-edited file) is nobody's, never the owner's
    const ghost = mintSession({ person: 'p-aaaaaaaaaaaa', method: rid('m-') });
    gw.write({ ...gw.state(), peopleSessions: [ghost.row] });
    assert.equal((await gw.req('GET', '/box.json', { cookie: ghost.cookie })).status, 401);
    assert.equal(await termWs(gw, ghost.cookie), 401);
  } finally { await gw.close(); }
});

test('org-access A9: a sign-in on a box unclaimed since its challenge is refused', async () => {
  const { gw, ana } = await people('a9-unclaimed');
  try {
    await signIn(gw, ana);
    const o = await gw.req('POST', '/auth/login/options', { body: {}, cookie: '' });
    assert.equal(o.status, 200, o.body);
    const r = reclaim(gw);
    assert.equal(r.status, 0, r.stderr);
    const before = gw.state().peopleSessions;
    const v = await gw.req('POST', '/auth/login/verify', { body: ana.get(o.json, gw.publicUrl), cookie: '' });
    assert.equal(v.status, 409, v.body);
    assert.equal(v.json?.error, 'this box is not claimed yet');
    assert.equal(cookieOf(v), null);
    assert.deepEqual(gw.state().peopleSessions, before, 'no session written');
  } finally { await gw.close(); }
});

// --- A9: each person's own methods -----------------------------------------------------------------
const METHOD_VIEW = ['id', 'type', 'label', 'added_at', 'last_used'];
const view = (m) => ({ id: m.id, type: m.type, label: m.label, added_at: m.added_at, last_used: m.last_used });
const rowOf = (s, id) => s.people.find((p) => p.id === id);
const raw = (gw) => fs.readFileSync(gw.file, 'utf8');
// a non-passkey method in the owner's row (none can be made yet), and a top-level session opened with it
const ownerStub = (gw) => {
  const stub = { id: rid('m-'), type: 'stub', key: 'stub:1', label: 'stub', added_at: new Date().toISOString(), last_used: null, data: {} };
  const sess = mintSession({ method: stub.id });
  const s = gw.state();
  gw.write({ ...s, people: s.people.map((p) => (p.role === 'owner' ? { ...p, methods: [...p.methods, stub] } : p)), sessions: [...s.sessions, sess.row] });
  return { stub, cookie: sess.cookie, hash: sess.row.hash };
};
// today's add: options, then the authenticator's new credential to verify
const addPasskey = async (gw, a, cookie, extra = {}) => {
  const o = await gw.req('POST', '/auth/passkeys/options', { cookie, body: {} });
  assert.equal(o.status, 200, o.body);
  return { options: o.json, verify: await gw.req('POST', '/auth/passkeys/verify', { cookie, body: { ...a.create(o.json, gw.publicUrl), ...extra } }) };
};
const methodList = async (gw, cookie) => { const r = await gw.req('GET', '/auth/method/list', { cookie }); assert.equal(r.status, 200, r.body); return r.json.methods; };

test('org-access A9: each person lists only their own methods, with no key material', async () => {
  const { gw, owner, ana, vic, ownerCookie, anaRow, vicRow } = await people('a9-list');
  try {
    const { stub } = ownerStub(gw);
    const ac = await signIn(gw, ana);
    const vc = await signIn(gw, vic);
    const s = gw.state();
    assert.deepEqual(await methodList(gw, ac), rowOf(s, anaRow.id).methods.map(view), 'Ana\'s, exactly');
    assert.deepEqual(await methodList(gw, vc), rowOf(s, vicRow.id).methods.map(view), 'Vic\'s, exactly');
    const [pk] = s.passkeys;
    assert.deepEqual(await methodList(gw, ownerCookie), [{ id: u(owner.id), type: 'passkey', label: pk.name, added_at: pk.createdAt, last_used: pk.usedAt ?? null }, view(stub)], 'the owner\'s passkeys, then their row\'s methods');
    for (const c of [ac, vc, ownerCookie]) for (const m of await methodList(gw, c)) assert.deepEqual(Object.keys(m), METHOD_VIEW, 'no key, no data');
    assert.equal((await gw.req('GET', '/auth/method/list', { cookie: '' })).status, 401);
  } finally { await gw.close(); }
});

test('org-access A9: a person adds a passkey to their own methods, never the owner\'s', async () => {
  const { gw, owner, ana, vic, anaRow } = await people('a9-add');
  try {
    const ac = await signIn(gw, ana);
    const before = gw.state();
    const a2 = authenticator();
    const { options, verify } = await addPasskey(gw, a2, ac, { name: 'tablet' });
    assert.deepEqual(options.excludeCredentials.map((c) => c.id).sort(), [u(owner.id), u(ana.id), u(vic.id)].sort(), 'every credential on the box');
    assert.deepEqual([options.user.name, options.user.displayName], ['Ana@box.localhost', 'Ana (box.localhost)'], 'named for her');
    assert.equal(verify.status, 200, verify.body);
    const s = gw.state();
    assert.equal(JSON.stringify(s.passkeys), JSON.stringify(before.passkeys), 'top-level passkeys byte-identical');
    assert.equal(s.peopleStamp, before.peopleStamp);
    const row = rowOf(s, anaRow.id);
    assert.equal(row.rev, rowOf(before, anaRow.id).rev + 1, 'her rev went up');
    assert.equal(row.methods.length, 2);
    const m = row.methods[1];
    assert.deepEqual(Object.keys(m), ['id', 'type', 'key', 'label', 'added_at', 'last_used', 'data']);
    assert.match(m.id, /^m-[a-z2-7]{12}$/);
    assert.notEqual(m.id, row.methods[0].id);
    assert.deepEqual({ type: m.type, key: m.key, label: m.label, last_used: m.last_used }, { type: 'passkey', key: u(a2.id), label: 'tablet', last_used: null });
    assert.deepEqual(Object.keys(m.data), ['userId', 'jwk', 'alg', 'signCount', 'rp']);
    assert.deepEqual([m.data.userId, m.data.rp], [options.user.id, 'box.localhost']);
    for (const p of s.people.filter((x) => x.id !== anaRow.id)) assert.deepEqual(p, rowOf(before, p.id), `${p.name}'s row unchanged`);
    const c2 = await signIn(gw, a2);
    assert.deepEqual(gw.state().peopleSessions.filter((x) => x.hash === hashOf(c2)).map((x) => [x.person, x.method]), [[anaRow.id, m.id]], 'it signs her into her own session');
    // the default label counts her own passkeys
    assert.equal((await addPasskey(gw, authenticator(), c2)).verify.status, 200);
    assert.equal(rowOf(gw.state(), anaRow.id).methods[2].label, 'passkey 3');
    // and the owner's add stays top-level, stamped
    const oc = await signIn(gw, owner);
    const o2 = authenticator();
    const own = await addPasskey(gw, o2, oc);
    assert.equal(own.verify.status, 200, own.verify.body);
    assert.equal(own.options.user.name, 'owner@box.localhost');
    const t = gw.state();
    assert.deepEqual(t.passkeys.map((p) => [p.id, p.name]), [[u(owner.id), t.passkeys[0].name], [u(o2.id), 'passkey 2']]);
    assert.equal(t.peopleStamp, stampOf([u(owner.id), u(o2.id)]));
    assert.deepEqual(ownerOf(t)[0].methods, []);
    // today's passkeys page lists the signed-in person's own: Ana's for her, the owner's for them
    const anaPage = (await gw.req('GET', '/auth/passkeys', { cookie: c2 })).body;
    for (const x of rowOf(t, anaRow.id).methods) assert.ok(anaPage.includes(`data-id="${x.id}"`), `her ${x.label}`);
    for (const p of t.passkeys) assert.ok(!anaPage.includes(p.id), 'none of the owner\'s');
    const ownerPage = (await gw.req('GET', '/auth/passkeys', { cookie: oc })).body;
    for (const p of t.passkeys) assert.ok(ownerPage.includes(`data-id="${p.id}"`));
    for (const x of rowOf(t, anaRow.id).methods) assert.ok(!ownerPage.includes(x.id) && !ownerPage.includes(x.key), 'none of Ana\'s');
    // and the owner's remove restamps in the same write
    assert.equal((await gw.req('POST', '/auth/method/remove', { cookie: oc, body: { id: u(o2.id) } })).status, 200);
    assert.equal(gw.state().peopleStamp, stampOf([u(owner.id)]), 'the stamp of what is left');
  } finally { await gw.close(); }
});

test('org-access A9: a credential already on the box is refused, whoever holds it', async () => {
  const { gw, owner, ana, vic, ownerCookie } = await people('a9-dup');
  try {
    const ac = await signIn(gw, ana);
    const refused = async (a, cookie, why) => {
      const before = raw(gw);
      const { verify } = await addPasskey(gw, a, cookie);
      assert.equal(verify.status, 400, `${why}: ${verify.body}`);
      assert.equal(verify.json?.error, 'that passkey is already registered', why);
      assert.equal(raw(gw), before, `${why}: nothing written`);
    };
    await refused(owner, ac, 'Ana, the owner\'s');
    await refused(vic, ac, 'Ana, Vic\'s');
    await refused(ana, ownerCookie, 'the owner, Ana\'s');
    const r = reclaim(gw);
    assert.equal(r.status, 0, r.stderr);
    const token = /claim#([A-Za-z0-9_-]+)/.exec(r.stdout)?.[1];
    const before = raw(gw);
    const c = await gw.claim(ana, { token });
    assert.equal(c.status, 400, c.body);
    assert.equal(c.json?.error, 'that passkey is already registered');
    assert.equal(raw(gw), before, 'the claim wrote nothing');
  } finally { await gw.close(); }
});

test('org-access A9: an add whose person changed since its options is refused', async () => {
  const { gw, ana, anaRow } = await people('a9-add-changed');
  try {
    const ac = await signIn(gw, ana);
    const a2 = authenticator();
    const verifyAfter = async (change) => {
      const o = await gw.req('POST', '/auth/passkeys/options', { cookie: ac, body: {} });
      assert.equal(o.status, 200, o.body);
      const s = gw.state();
      gw.write(change(s));
      const before = raw(gw);
      const v = await gw.req('POST', '/auth/passkeys/verify', { cookie: ac, body: a2.create(o.json, gw.publicUrl) });
      const wrote = raw(gw) !== before;
      gw.write(s);
      return { v, wrote };
    };
    const gone = await verifyAfter((s) => ({ ...s, people: s.people.filter((p) => p.id !== anaRow.id) }));
    assert.ok(gone.v.status >= 400, `her row deleted: ${gone.v.status} ${gone.v.body}`);
    assert.ok(!gone.wrote, 'her row deleted: nothing written');
    const promoted = await verifyAfter((s) => ({ ...s, people: s.people.map((p) => (p.id === anaRow.id ? { ...p, role: 'admin' } : p)) }));
    assert.equal(promoted.v.status, 409, promoted.v.body);
    assert.equal(promoted.v.json?.error, 'your account changed since; start again');
    assert.ok(!promoted.wrote, 'her role changed: nothing written');
    // unchanged, the same add lands
    const ok = await verifyAfter((s) => s);
    assert.equal(ok.v.status, 200, ok.v.body);
  } finally { await gw.close(); }
});

test('org-access A9: nobody removes a method that isn\'t theirs, and "yours" is checked before "last"', async () => {
  const { gw, owner, ana, ownerCookie } = await people('a9-not-yours');
  try {
    const { stub } = ownerStub(gw);
    const o2 = authenticator();
    assert.equal((await addPasskey(gw, o2, ownerCookie)).verify.status, 200, 'the owner holds two passkeys, so either could go');
    const ac = await signIn(gw, ana);
    const before = raw(gw);
    for (const route of ['/auth/method/remove', '/auth/passkeys/remove']) {
      for (const id of [u(owner.id), u(o2.id), stub.id]) {
        const r = await gw.req('POST', route, { cookie: ac, body: { id } });
        assert.equal(r.status, 404, `${route} ${id}: ${r.body}`);
        assert.equal(raw(gw), before, `${route} ${id}: nothing changed`);
      }
    }
  } finally { await gw.close(); }
});

test('org-access A9: removing a method ends its sessions and the person\'s others, and nobody else\'s', async () => {
  const { gw, ana, vic, ownerCookie, anaRow, vicRow } = await people('a9-remove');
  try {
    const a2 = authenticator();
    const m2 = a2.method('passkey 2');
    const s0 = gw.state();
    gw.write({ ...s0, pushSubs: [pushSub('https://push.example/owner-1'), pushSub('https://push.example/owner-2')], people: s0.people.map((p) => (p.id === anaRow.id ? { ...p, methods: [...p.methods, m2], pushSubs: [pushSub('https://push.example/ana-1'), pushSub('https://push.example/ana-2')] } : p.id === vicRow.id ? { ...p, pushSubs: [pushSub('https://push.example/vic')] } : p)) });
    const s1 = await signIn(gw, ana);
    const s2 = await signIn(gw, a2);
    const s3 = await signIn(gw, a2);
    const vc = await signIn(gw, vic);
    const before = gw.state();
    const first = anaRow.methods[0].id;
    const r = await gw.req('POST', '/auth/method/remove', { cookie: s3, body: { id: first } });
    assert.equal(r.status, 200, r.body);
    const after = gw.state();
    const row = rowOf(after, anaRow.id);
    assert.deepEqual(row.methods.map((m) => m.id), [m2.id]);
    assert.equal(row.rev, rowOf(before, anaRow.id).rev + 1);
    assert.deepEqual(row.pushSubs, [], 'her devices go');
    assert.deepEqual(after.peopleSessions.filter((x) => x.person === anaRow.id).map((x) => x.hash), [hashOf(s3)], 'only the requesting session stays');
    assert.deepEqual(after.sessions, before.sessions, 'the owner\'s sessions unchanged');
    assert.equal(JSON.stringify(after.pushSubs), JSON.stringify(before.pushSubs), 'the owner\'s devices unchanged');
    assert.equal(JSON.stringify(after.passkeys), JSON.stringify(before.passkeys));
    assert.deepEqual(after.peopleSessions.filter((x) => x.person === vicRow.id), before.peopleSessions.filter((x) => x.person === vicRow.id), 'Vic\'s session unchanged');
    assert.deepEqual(rowOf(after, vicRow.id), rowOf(before, vicRow.id), 'Vic\'s row and device unchanged');
    for (const c of [s1, s2]) assert.equal((await gw.req('GET', '/box.json', { cookie: c })).status, 401);
    for (const c of [s3, vc, ownerCookie]) assert.equal((await gw.req('GET', '/box.json', { cookie: c })).status, 200);
    // two again, a session with each; the one the request came from goes
    const a3 = authenticator();
    assert.equal((await addPasskey(gw, a3, s3)).verify.status, 200);
    const s4 = await signIn(gw, a3);
    const r2 = await gw.req('POST', '/auth/passkeys/remove', { cookie: s3, body: { id: m2.id } });
    assert.equal(r2.status, 200, r2.body);
    assert.equal((await gw.req('GET', '/box.json', { cookie: s3 })).status, 401, 'a session ends with its own method');
    // the other passkey stays; its session, another of hers, ends by the rule (spec §Each person's own methods)
    assert.equal((await gw.req('GET', '/box.json', { cookie: s4 })).status, 401);
    assert.deepEqual(rowOf(gw.state(), anaRow.id).methods.map((m) => m.key), [u(a3.id)], 'the other passkey stays');
    const s5 = await signIn(gw, a3);
    const [last] = rowOf(gw.state(), anaRow.id).methods;
    const was = raw(gw);
    const r3 = await gw.req('POST', '/auth/method/remove', { cookie: s5, body: { id: last.id } });
    assert.equal(r3.status, 400, r3.body);
    assert.equal(raw(gw), was);
  } finally { await gw.close(); }
});

test('org-access A9: changing methods takes a fresh sign-in, listing them does not', async () => {
  const { gw, ana, anaRow } = await people('a9-fresh');
  try {
    const ac = await signIn(gw, ana);
    const s = gw.state();
    gw.write({ ...s, peopleSessions: s.peopleSessions.map((x) => (x.hash === hashOf(ac) ? { ...x, at: x.at - 600e3 } : x)) });
    const before = raw(gw);
    for (const route of ['/auth/method/remove', '/auth/passkeys/remove', '/auth/passkeys/options']) {
      const r = await gw.req('POST', route, { cookie: ac, body: { id: anaRow.methods[0].id } });
      assert.equal(r.status, 403, `${route}: ${r.body}`);
      assert.match(r.json?.error ?? '', /sign in again/);
    }
    assert.equal(raw(gw), before);
    assert.equal((await methodList(gw, ac)).length, 1, 'the list needs only a session');
  } finally { await gw.close(); }
});

test('org-access A9: the owner\'s last passkey stays, and their other methods go with their sessions', async () => {
  const { gw, owner, ana, ownerCookie } = await people('a9-owner');
  try {
    let { stub, cookie: stubC } = ownerStub(gw);
    const before = raw(gw);
    for (const cookie of [ownerCookie, stubC]) {
      const r = await gw.req('POST', '/auth/method/remove', { cookie, body: { id: u(owner.id) } });
      assert.equal(r.status, 400, r.body);
      assert.equal(raw(gw), before, 'passkeys unchanged');
    }
    const ac = await signIn(gw, ana);
    const anaBefore = gw.state().peopleSessions;
    const pre = gw.state();
    // from a session opened with it: that session ends too
    let r = await gw.req('POST', '/auth/method/remove', { cookie: stubC, body: { id: stub.id } });
    assert.equal(r.status, 200, r.body);
    let s = gw.state();
    assert.deepEqual(ownerOf(s)[0].methods, []);
    assert.equal(ownerOf(s)[0].rev, ownerOf(pre)[0].rev + 1);
    assert.deepEqual(s.sessions, [], 'the requester\'s, opened with it, and the owner\'s other');
    assert.equal(JSON.stringify(s.passkeys), JSON.stringify(pre.passkeys));
    assert.equal(s.peopleStamp, pre.peopleStamp);
    assert.deepEqual(s.peopleSessions, anaBefore, 'Ana\'s untouched');
    for (const c of [stubC, ownerCookie]) assert.equal((await gw.req('GET', '/box.json', { cookie: c })).status, 401);
    assert.equal((await gw.req('GET', '/box.json', { cookie: ac })).status, 200);
    // from a session opened with a passkey: the stub's sessions end, the requester stays
    const oc = await signIn(gw, owner);
    ({ stub, cookie: stubC } = ownerStub(gw));
    r = await gw.req('POST', '/auth/method/remove', { cookie: oc, body: { id: stub.id } });
    assert.equal(r.status, 200, r.body);
    s = gw.state();
    assert.deepEqual(s.sessions.map((x) => x.hash), [hashOf(oc)]);
    assert.equal((await gw.req('GET', '/box.json', { cookie: stubC })).status, 401);
    assert.equal((await gw.req('GET', '/box.json', { cookie: oc })).status, 200);
  } finally { await gw.close(); }
});

// --- A9.10: push per person -----------------------------------------------------------------------
test('org-access A9: push subscriptions are each person\'s own', async () => {
  const sent = [];
  let gone = null;
  const pushFetch = async (endpoint) => { sent.push(endpoint); return { status: endpoint === gone ? 410 : 201 }; };
  const { gw, ana, ownerCookie, anaRow, vicRow } = await people('a9-push', { pushFetch });
  let list = [{ devteam: 1, root: '/r/one', name: 'one', port: P, inbox: 1 }, { devteam: 1, root: '/r/two', name: 'two', port: P + 1, inbox: 1 }];
  const hub = await fakeHub(() => list);
  const bump = (root) => { list = list.map((x) => (x.root === root ? { ...x, inbox: x.inbox + 1 } : x)); };
  const ends = (subs) => subs.map((x) => x.endpoint);
  const A = (i) => `https://web.push.apple.com/ana-${i}`;
  try {
    const ac = await signIn(gw, ana);
    await gw.g.pollPush();
    assert.deepEqual(sent, [], 'the backlog is recorded');
    // Ana's 21 devices: her row keeps the newest 20, and the owner's list is untouched
    for (let i = 0; i < 21; i++) assert.equal((await gw.req('POST', '/push/subscribe', { cookie: ac, body: subscribing(A(i)) })).status, 200);
    let s = gw.state();
    assert.deepEqual(ends(rowOf(s, anaRow.id).pushSubs), Array.from({ length: 20 }, (_, i) => A(i + 1)));
    assert.deepEqual(s.pushSubs ?? [], [], 'the owner\'s devices are not pushed off');
    assert.deepEqual(rowOf(s, vicRow.id).pushSubs, []);
    assert.deepEqual(ownerOf(s)[0].pushSubs, [], 'the owner\'s stay top-level');
    // the poller reaches her devices; with the owner holding none, the root still rests
    bump('/r/one');
    await gw.g.pollPush();
    assert.deepEqual([...sent].sort(), Array.from({ length: 20 }, (_, i) => A(i + 1)).sort(), 'one push to each of Ana\'s devices');
    sent.length = 0;
    bump('/r/one');
    await gw.g.pollPush();
    assert.deepEqual(sent, [], 'a root that just notified Ana rests');
    // her test finds her own device, and not one of nobody's
    assert.equal((await gw.req('POST', '/push/test', { cookie: ac, body: { endpoint: A(20) } })).status, 200);
    assert.equal((await gw.req('POST', '/push/test', { cookie: ac, body: { endpoint: A(0) } })).status, 404);
    // the owner subscribing one of Ana's endpoints takes it: one device, one person
    assert.equal((await gw.req('POST', '/push/subscribe', { cookie: ownerCookie, body: subscribing(A(20)) })).status, 200);
    s = gw.state();
    assert.deepEqual(ends(s.pushSubs), [A(20)]);
    assert.deepEqual(ends(rowOf(s, anaRow.id).pushSubs), Array.from({ length: 19 }, (_, i) => A(i + 1)));
    assert.equal((await gw.req('POST', '/push/test', { cookie: ac, body: { endpoint: A(20) } })).status, 404, 'no longer hers');
    sent.length = 0;
    assert.equal((await gw.req('POST', '/push/test', { cookie: ownerCookie, body: { endpoint: A(20) } })).status, 200);
    assert.equal((await gw.req('POST', '/push/test', { cookie: ownerCookie, body: { endpoint: A(1) } })).status, 404, 'nor is Ana\'s the owner\'s');
    assert.deepEqual(sent, [A(20)]);
    // one push per device, everyone's; a dead one of Ana's goes from her list alone
    sent.length = 0;
    gone = A(5);
    bump('/r/two');
    await gw.g.pollPush();
    assert.deepEqual([...sent].sort(), [...Array.from({ length: 19 }, (_, i) => A(i + 1)), A(20)].sort(), 'each device once, the moved one included');
    s = gw.state();
    assert.deepEqual(ends(rowOf(s, anaRow.id).pushSubs), Array.from({ length: 19 }, (_, i) => A(i + 1)).filter((e) => e !== A(5)));
    assert.deepEqual(ends(s.pushSubs), [A(20)]);
    assert.equal(rowOf(s, anaRow.id).rev, anaRow.rev, 'push does not bump rev');
  } finally { await new Promise((r) => hub.close(r)); await gw.close(); }
});

// --- A11: the rollback, against the gateway before people (OLD) ---------------------------------
const OLD_SHA = '7eebabfde62c642427c0c507f41fdb9db62bedc6';
let oldFile = null;
// OLD's cloud/gateway.mjs from git history, fetched when the checkout lacks it (CI's depth-1 clone).
// Throws when it can't be had: the test fails, never skips.
const oldGateway = () => {
  if (oldFile) return oldFile;
  const git = (args, opts = {}) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  try { git(['cat-file', '-e', `${OLD_SHA}^{commit}`]); } catch { git(['fetch', '--depth=1', '--no-tags', 'origin', OLD_SHA], { timeout: 120e3 }); }
  const file = path.join(tmp, 'old', 'gateway.mjs');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, git(['show', `${OLD_SHA}:cloud/gateway.mjs`], { maxBuffer: 64 << 20 }));
  oldFile = file;
  return file;
};
// a gateway's `reclaim` command (OLD's or this one's) on a folder, as a shell on the box runs it
const reclaimWith = (file, dir, pub) => {
  const r = spawnSync(process.execPath, [file, 'reclaim'], { env: { ...process.env, DEVTEAM_PUBLIC_URL: pub, DEVTEAM_GATEWAY_DIR: dir }, encoding: 'utf8', timeout: 60e3 });
  assert.equal(r.status, 0, r.stderr);
  return r;
};
const tokenOf = (out) => { const t = /claim#([\w-]+)/.exec(out)?.[1]; assert.ok(t, out); return t; };
// Ana signed in, an invite for her, and a stub method in the owner's row with a session opened with it
const rollbackSetup = async (name) => {
  const p = await people(name);
  const ac = await signIn(p.gw, p.ana);
  const s = p.gw.state();
  p.gw.write({ ...s, invites: [{ hash: u(crypto.randomBytes(32)), person: p.anaRow.id, expires: Date.now() + 86400e3 }] });
  const stub = ownerStub(p.gw);
  return { ...p, ac, stub };
};
const RESET_LINE = 'the owner\'s passkeys changed under an older gateway: every other person\'s session and every invite ended; they sign in again';
// what a start after an older gateway's reset leaves
const assertReset = (gw, before, counts) => {
  const s = gw.state();
  assert.deepEqual(s.peopleSessions, []);
  assert.deepEqual(s.invites, []);
  const [owner] = ownerOf(s);
  assert.deepEqual(owner.methods, []);
  assert.equal(owner.rev, ownerOf(before)[0].rev + 1);
  assert.ok(!s.sessions.some((x) => x.method === ownerOf(before)[0].methods[0].id), 'no session opened with the stub');
  for (const p of before.people.filter((x) => x.role !== 'owner')) assert.deepEqual(rowOf(s, p.id).methods, p.methods, `${p.name}'s methods stay`);
  assert.equal(s.peopleStamp, stampOf(s.passkeys.map((p) => p.id)));
  const notes = owner.notices.filter((n) => n.kind === 'people-reset');
  assert.equal(notes.length, 1);
  assert.deepEqual({ ...notes[0], at: undefined }, { kind: 'people-reset', at: undefined, ...counts });
  assert.ok(gw.logs.includes(RESET_LINE), gw.logs.join('\n'));
};

test('org-access A11: an older gateway reading the new state admits only the owner', async () => {
  const { gw, owner, ana, ownerCookie } = await people('a11-old-reads');
  const ac = await signIn(gw, ana);
  await gw.close();
  const old = await gateway('a11-old-reads-old', { module: oldGateway(), dir: gw.dir });
  try {
    assert.equal((await old.req('GET', '/box.json', { cookie: ownerCookie })).status, 200, 'the owner\'s session');
    assert.equal((await old.login(owner)).status, 200, 'the owner\'s passkey');
    const r = await old.login(ana);
    assert.notEqual(r.status, 200);
    assert.match(r.body, /unknown passkey/);
    assert.equal((await old.req('GET', '/box.json', { cookie: ac })).status, 401, 'Ana\'s live session');
  } finally { await old.close(); }
});

test('org-access A11: a start after an older gateway\'s reclaim ends everyone else\'s sessions, the invites and the owner\'s other methods', async () => {
  const { gw, ana } = await rollbackSetup('a11-old-reclaim');
  await gw.close();
  reclaimWith(oldGateway(), gw.dir, gw.publicUrl);
  // OLD's link has expired, and the environment names a token: the start saves that claim too,
  // and must save it over the reset state, not the state it read
  const before = JSON.parse(fs.readFileSync(gw.file, 'utf8'));
  fs.writeFileSync(gw.file, JSON.stringify({ ...before, claimExpires: Date.now() - 1 }, null, 2));
  const given = 'x'.repeat(40);
  process.env.DEVTEAM_CLAIM_TOKEN = given;
  let again;
  try { again = await gateway('a11-old-reclaim-new', { dir: gw.dir, token: given }); } finally { delete process.env.DEVTEAM_CLAIM_TOKEN; }
  try {
    assertReset(again, before, { sessions_ended: 1, invites_deleted: 1, methods_deleted: 1 });
    assert.equal(again.state().claimHash, u(sha(given)), 'the environment\'s claim, saved after the reset');
    assert.deepEqual(again.state().passkeys, [], 'still unclaimed');
    const c = await again.claim(authenticator());
    assert.equal(c.status, 200, c.body);
    await signIn(again, ana);
  } finally { await again.close(); }
});

test('org-access A11: a start after an older gateway removed or added an owner passkey resets the same', async () => {
  // removed: OLD's remove keeps only the requester's session, the stub's among those it ends
  {
    const { gw, owner, ana, ownerCookie } = await rollbackSetup('a11-old-remove');
    const second = authenticator();
    assert.equal((await addPasskey(gw, second, ownerCookie)).verify.status, 200);
    await gw.close();
    const old = await gateway('a11-old-remove-old', { module: oldGateway(), dir: gw.dir });
    try {
      const r = await old.req('POST', '/auth/passkeys/remove', { cookie: ownerCookie, body: { id: u(second.id) } });
      assert.equal(r.status, 200, r.body);
    } finally { await old.close(); }
    const before = JSON.parse(fs.readFileSync(gw.file, 'utf8'));
    const again = await gateway('a11-old-remove-new', { dir: gw.dir });
    try {
      assertReset(again, before, { sessions_ended: 1, invites_deleted: 1, methods_deleted: 1 });
      assert.deepEqual(again.state().passkeys.map((p) => p.id), [u(owner.id)], 'still claimed');
      assert.equal((await again.req('GET', '/box.json', { cookie: ownerCookie })).status, 200);
      await signIn(again, ana);
    } finally { await again.close(); }
  }
  // added: OLD leaves every session, the stub's too; only the start's reset ends that one
  {
    const { gw, owner, ana, ownerCookie, stub } = await rollbackSetup('a11-old-add');
    await gw.close();
    const second = authenticator();
    const old = await gateway('a11-old-add-old', { module: oldGateway(), dir: gw.dir });
    try {
      assert.equal((await addPasskey(old, second, ownerCookie)).verify.status, 200);
      assert.equal((await old.req('GET', '/box.json', { cookie: stub.cookie })).status, 200, 'OLD keeps the stub\'s session');
    } finally { await old.close(); }
    const before = JSON.parse(fs.readFileSync(gw.file, 'utf8'));
    assert.ok(before.sessions.some((x) => x.hash === stub.hash));
    const again = await gateway('a11-old-add-new', { dir: gw.dir });
    try {
      assertReset(again, before, { sessions_ended: 2, invites_deleted: 1, methods_deleted: 1 });
      assert.deepEqual(again.state().passkeys.map((p) => p.id).sort(), [u(owner.id), u(second.id)].sort());
      assert.equal((await again.req('GET', '/box.json', { cookie: stub.cookie })).status, 401, 'the stub\'s session ended');
      assert.equal((await again.req('GET', '/box.json', { cookie: ownerCookie })).status, 200, 'the passkey\'s stays');
      await signIn(again, ana);
    } finally { await again.close(); }
  }
});

test('org-access A11: an owner\'s sign-in under an older gateway trips nothing', async () => {
  const { gw, owner, ac, stub } = await rollbackSetup('a11-old-signin');
  await gw.close();
  const old = await gateway('a11-old-signin-old', { module: oldGateway(), dir: gw.dir });
  try { assert.equal((await old.login(owner)).status, 200); } finally { await old.close(); }
  const before = JSON.parse(fs.readFileSync(gw.file, 'utf8'));
  const again = await gateway('a11-old-signin-new', { dir: gw.dir });
  try {
    const s = again.state();
    for (const k of ['peopleSessions', 'invites', 'people', 'peopleStamp', 'sessions']) assert.equal(JSON.stringify(s[k]), JSON.stringify(before[k]), `${k} as it was`);
    assert.ok(!again.logs.includes(RESET_LINE));
    assert.equal((await again.req('GET', '/box.json', { cookie: ac })).status, 200, 'Ana\'s session');
    assert.equal((await again.req('GET', '/box.json', { cookie: stub.cookie })).status, 200, 'the stub\'s session');
  } finally { await again.close(); }
});

test('org-access A11: the new reclaim ends every session, invite and owner method, and keeps other people\'s methods', async () => {
  const { gw, anaRow, vicRow } = await rollbackSetup('a11-new-reclaim');
  let s = gw.state();
  gw.write({ ...s, invites: [...s.invites, { hash: u(crypto.randomBytes(32)), person: anaRow.id, expires: Date.now() + 86400e3 }], pushSubs: [pushSub('https://web.push.apple.com/owner')] });
  gw.seed([{ name: 'Noa', methods: [] }]); // invited, never joined: she can't sign in, so isn't counted
  const before = gw.state();
  await gw.close();
  const r = reclaimWith(NEW, gw.dir, gw.publicUrl);
  assert.match(r.stdout, /every passkey and session is forgotten\. Claim the box again: .*\/auth\/claim#/);
  assert.match(r.stdout, /^2 other people can still sign in: check who they are in the hub's Settings › People after claiming$/m);
  s = JSON.parse(fs.readFileSync(gw.file, 'utf8'));
  assert.deepEqual([s.passkeys, s.sessions, s.pushSubs, s.peopleSessions, s.invites], [[], [], [], [], []]);
  assert.deepEqual(ownerOf(s)[0].methods, []);
  assert.equal(ownerOf(s)[0].rev, ownerOf(before)[0].rev + 1);
  for (const id of [anaRow.id, vicRow.id]) assert.deepEqual(rowOf(s, id).methods, rowOf(before, id).methods);
  assert.equal(s.peopleStamp, stampOf([]));
  const again = await gateway('a11-new-reclaim-new', { dir: gw.dir, token: tokenOf(r.stdout) });
  try {
    assert.equal(JSON.stringify(again.state()), JSON.stringify(s), 'the start writes nothing: no reset');
    assert.ok(!again.logs.includes(RESET_LINE));
  } finally { await again.close(); }
  // nobody else on the box: no such line
  const alone = await gateway('a11-new-reclaim-alone');
  try {
    assert.equal((await alone.claim(authenticator())).status, 200);
  } finally { await alone.close(); }
  const r2 = reclaimWith(NEW, alone.dir, alone.publicUrl);
  assert.doesNotMatch(r2.stdout, /other (people|person)/);
});

// A POST whose body arrives later: the headers and the first byte now, the rest on finish().
const slowPost = (gw, route, cookie, body) => {
  const text = JSON.stringify(body);
  let done;
  const answer = new Promise((resolve, reject) => { done = { resolve, reject }; });
  const r = http.request({ host: '127.0.0.1', port: gw.port, method: 'POST', path: route, headers: { host: new URL(gw.publicUrl).host, origin: gw.publicUrl, 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), cookie } }, (res) => {
    let b = '';
    res.on('data', (c) => { b += c; });
    res.on('end', () => done.resolve({ status: res.statusCode, body: b }));
  });
  r.on('error', (e) => done.reject(e));
  r.write(text.slice(0, 1));
  return { finish: () => { r.end(text.slice(1)); return answer; } };
};

test('org-access A9: a request in flight when the box is reclaimed lands nothing', async () => {
  const { gw, ana, ownerCookie, anaRow } = await people('a9-inflight');
  try {
    const ac = await signIn(gw, ana);
    // the owner's session, fresh, starts adding a passkey and subscribing a device; Ana subscribes one
    const thief = authenticator();
    const o = await gw.req('POST', '/auth/passkeys/options', { cookie: ownerCookie, body: {} });
    assert.equal(o.status, 200, o.body);
    const add = slowPost(gw, '/auth/passkeys/verify', ownerCookie, thief.create(o.json, gw.publicUrl));
    const sub = slowPost(gw, '/push/subscribe', ownerCookie, subscribing('https://web.push.apple.com/thief'));
    const hers = slowPost(gw, '/push/subscribe', ac, subscribing('https://web.push.apple.com/ana'));
    // without the re-check these would answer 400 (her last method) and 404 (no such device)
    const remove = slowPost(gw, '/auth/method/remove', ac, { id: anaRow.methods[0].id });
    const ping = slowPost(gw, '/push/test', ac, { endpoint: 'https://web.push.apple.com/ana' });
    await new Promise((r) => setTimeout(r, 200));
    const rc = reclaim(gw);
    assert.equal(rc.status, 0, rc.stderr);
    for (const [what, x] of [['the add', add], ['the owner\'s subscribe', sub], ['Ana\'s subscribe', hers], ['Ana\'s remove', remove], ['Ana\'s push test', ping]]) {
      const r = await x.finish();
      assert.equal(r.status, 401, `${what}: ${r.body}`);
    }
    const s = gw.state();
    assert.deepEqual(s.passkeys, [], 'no passkey: the box stays unclaimed');
    assert.deepEqual(s.pushSubs, [], 'no device of the owner\'s');
    assert.deepEqual(rowOf(s, anaRow.id).pushSubs, [], 'nor of Ana\'s');
  } finally { await gw.close(); }
});
