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
  const claim = async (a, extraBody = {}) => {
    const o = await req('POST', '/auth/claim/options', { body: { token } });
    assert.equal(o.status, 200, o.body);
    return req('POST', '/auth/claim/verify', { body: { token, ...a.create(o.json, publicUrl), ...extraBody } });
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
    // T4: /auth/method/list with the old cookie lists the old passkeys
    const t = await gw.req('POST', '/push/test', { cookie: cookies[0], body: { endpoint: 'https://web.push.apple.com/phone' } });
    assert.equal(t.status, 200, t.body);
    assert.deepEqual(sent, ['https://web.push.apple.com/phone'], 'an old subscription is the owner\'s');
    // T5: a seeded person's /push/test for that endpoint is 404
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
