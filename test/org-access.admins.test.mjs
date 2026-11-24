// Admins and handing the box over (cloud/gateway.mjs, design Component 3b): what an admin may do on
// People, and the owner's transfer. Tests for the org-access goal's measure are named 'org-access A<n>: …'.
// People are seeded by writing the state file, as test/org-access.people-state.test.mjs does.
// Its two Chrome tests are in test/org-access.admins.chrome.test.mjs (kit-798).
// Run: node --test test/org-access.admins.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-admins-'));
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
  let flowJar = ''; // the flow cookie of a passkey ceremony, sent to the box's own name beside the session
  const req = (method, route, { body, headers = {}, cookie = jar, flow, on } = {}) => new Promise((resolve, reject) => {
    const self = on === 'term' ? term : on ? inst(on) : publicUrl;
    const sent = [cookie, self === publicUrl ? (flow ?? flowJar) : ''].filter(Boolean).join('; ');
    const h = { host: new URL(self).host, ...(method !== 'GET' ? { origin: self, 'content-type': 'application/json' } : {}), ...(sent ? { cookie: sent } : {}), ...headers };
    for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
    const r = http.request({ host: '127.0.0.1', port, method, path: route, headers: h }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        const sc = cookieOf(res);
        if (sc) jar = sc;
        if (flow !== '') for (const c of res.headers['set-cookie'] ?? []) if (/^(?:__Host-)?devteam_flow=/.test(c)) flowJar = /;\s*Max-Age=0\b/i.test(c) ? '' : c.split(';')[0];
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
  return { g, port, publicUrl, inst, term, logs, token, dir, file, req, claim, login, state, write, seed, jar: () => jar, flow: () => flowJar, setJar: (v) => { jar = v; }, close: () => new Promise((r) => g.server.close(r)) };
}

// --- kit-253: admins and handing the box over ---------------------------------------------------
const GATEWAY_SRC = () => fs.readFileSync(NEW, 'utf8');
const OLD_SHA = '7eebabfde62c642427c0c507f41fdb9db62bedc6';
let oldFile = null;
// OLD's cloud/gateway.mjs from git history, as test/org-access.people-state.test.mjs fetches it:
// from origin into a private repo under tmp when the checkout lacks it, never skipped.
const oldGateway = () => {
  if (oldFile) return oldFile;
  const git = (cwd, args, o = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...o });
  let from = repo;
  try { git(repo, ['cat-file', '-e', `${OLD_SHA}^{commit}`]); } catch {
    from = path.join(tmp, 'old-repo');
    execFileSync('git', ['init', '-q', from], { stdio: 'ignore' });
    git(from, ['fetch', '--depth=1', '--no-tags', git(repo, ['remote', 'get-url', 'origin']).trim(), OLD_SHA], { timeout: 120e3 });
  }
  const file = path.join(tmp, 'old', 'gateway.mjs');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, git(from, ['show', `${OLD_SHA}:cloud/gateway.mjs`], { maxBuffer: 64 << 20 }));
  oldFile = file;
  return file;
};

const rowOf = (s, id) => s.people.find((p) => p.id === id);
const ownerOf = (s) => s.people.filter((p) => p.role === 'owner');
const hashOf = (cookie) => u(sha(Buffer.from(cookie.split('=')[1], 'base64url')));
// A session for a seeded row, signed in `ago` ms before now: the owner's top-level, anyone else's
// in peopleSessions, opened with their first method.
const mint = (gw, row, ago = 0) => {
  const tok = crypto.randomBytes(32);
  const hash = u(sha(tok));
  const s = gw.state();
  const at = Date.now() - ago;
  const expires = at + 14 * 86400e3;
  if (row.role === 'owner') gw.write({ ...s, sessions: [...s.sessions, { hash, method: s.passkeys[0].id, at, expires }] });
  else gw.write({ ...s, peopleSessions: [...(s.peopleSessions ?? []), { hash, person: row.id, method: row.methods[0]?.id ?? null, at, expires }] });
  return `devteam_session=${u(tok)}`;
};
const invite = (gw, person, expires = Date.now() + 86400e3) => {
  const s = gw.state();
  gw.write({ ...s, invites: [...(s.invites ?? []), { hash: u(sha(crypto.randomBytes(32))), person, expires }] });
};
// what a refusal must leave as it was
const durable = (s) => JSON.stringify([s.passkeys, s.sessions, s.pushSubs, s.people, s.peopleSessions, s.invites, s.peopleStamp]);
const post = (gw, cookie, action, body) => gw.req('POST', `/auth/people/${action}`, { cookie, body });
const sub = (n) => ({ endpoint: `https://push.example.com/${n}`, keys: { p256dh: u(crypto.randomBytes(65)), auth: u(crypto.randomBytes(16)) } });

// The owner (Robin's passkey, claimed), Sam and Kai admins, Ana a Full member, Vic a View member,
// Bea joined with a new link out, Lee invited and never joined. Each joined row holds a passkey.
async function box(name) {
  const gw = await gateway(name);
  const keys = { owner: authenticator(), sam: authenticator(), kai: authenticator(), ana: authenticator(), vic: authenticator(), bea: authenticator() };
  const c = await gw.claim(keys.owner);
  assert.equal(c.status, 200, c.body);
  const [sam, kai, ana, vic, bea, lee] = gw.seed([
    { name: 'Sam Rivera', role: 'admin', methods: [keys.sam.method()] },
    { name: 'Kai Moss', role: 'admin', methods: [keys.kai.method()] },
    { name: 'Ana Costa', methods: [keys.ana.method()] },
    { name: 'Vic Lund', level: 'view', methods: [keys.vic.method()] },
    { name: 'Bea Ford', methods: [keys.bea.method()] },
    { name: 'Lee Park', methods: [] },
  ]);
  invite(gw, bea.id);
  invite(gw, lee.id);
  const owner = ownerOf(gw.state())[0];
  const C = { owner: mint(gw, owner), sam: mint(gw, sam), kai: mint(gw, kai), ana: mint(gw, ana), vic: mint(gw, vic) };
  return { gw, keys, C, owner, sam, kai, ana, vic, bea, lee };
}
// refused with this status and code, and nothing durable written
const refuses = async (gw, cookie, action, body, status, code, what) => {
  const before = durable(gw.state());
  const r = await post(gw, cookie, action, body);
  assert.equal(r.status, status, `${what}: ${r.status} ${r.body}`);
  assert.equal(r.json?.code, code, `${what}: ${r.body}`);
  assert.equal(durable(gw.state()), before, `${what}: nothing written`);
};
const accepts = async (gw, cookie, action, body, what) => {
  const r = await post(gw, cookie, action, body);
  assert.equal(r.status, 200, `${what}: ${r.status} ${r.body}`);
  return r;
};
const rev = (gw, id) => rowOf(gw.state(), id).rev;
// Each stateStore.save renames a temp file onto state.json: one 'rename' of state.json per save.
const savesDuring = async (gw, fn) => {
  let n = 0;
  const w = fs.watch(gw.dir, (ev, name) => { if (ev === 'rename' && name === 'state.json') n++; });
  await new Promise((r) => setTimeout(r, 50));
  try { await fn(); await new Promise((r) => setTimeout(r, 200)); } finally { w.close(); }
  return n;
};
// A People post whose headers reach the gateway now and whose body waits for release(), on its own
// connection (as kit-249's held rename in test/org-access.people-page.test.mjs, not imported):
// ready resolves once the socket is connected and the gateway has had 100 ms to read the headers.
const heldPost = (gw, cookie, action, body) => {
  const data = JSON.stringify(body);
  const host = new URL(gw.publicUrl).host;
  let release;
  let connected;
  const ready = new Promise((r) => { connected = r; }).then(() => new Promise((r) => setTimeout(r, 100)));
  const sent = new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: gw.port, method: 'POST', path: `/auth/people/${action}`, agent: false,
      headers: { host, origin: gw.publicUrl, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), cookie } }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, headers: res.headers, body: b, json: j }); });
    });
    r.on('error', reject);
    r.on('socket', (s) => (s.connecting ? s.once('connect', connected) : connected()));
    r.flushHeaders();
    release = () => r.end(data);
  });
  return { ready, sent, release: () => release() };
};

// --- A15: what an admin may do ------------------------------------------------------------------
test('org-access A15: an admin renames a member, another admin and themselves', async () => {
  const { gw, C, sam, kai, ana } = await box('a15-rename');
  try {
    for (const [row, name, what] of [[ana, 'Ana C', 'a member'], [kai, 'Kai M', 'another admin'], [sam, 'Sam R', 'themselves']]) {
      const before = rev(gw, row.id);
      const r = await accepts(gw, C.sam, 'rename', { id: row.id, rev: before, name }, `Sam renames ${what}`);
      assert.equal(rowOf(gw.state(), row.id).name, name, `${what} renamed`);
      assert.equal(r.json.rev, before + 1, `${what}: rev moves on`);
    }
  } finally { await gw.close(); }
});

test('org-access A15: an admin removes a member and another admin, and their access ends', async () => {
  const { gw, C, sam, kai, ana } = await box('a15-remove');
  try {
    for (const [row, cookie, what] of [[ana, C.ana, 'a member'], [kai, C.kai, 'another admin']]) {
      const r = await accepts(gw, C.sam, 'remove', { id: row.id, rev: rev(gw, row.id) }, `Sam removes ${what}`);
      assert.ok(!(r.headers['set-cookie'] ?? []).some((c) => /^devteam_session=/.test(c)), `removing ${what} leaves Sam's cookie alone`);
      assert.equal((await gw.req('GET', '/box.json', { cookie: C.sam })).status, 200, 'and Sam stays signed in');
      const s = gw.state();
      assert.equal(rowOf(s, row.id), undefined, `${what}'s row is gone`);
      assert.ok(!(s.peopleSessions ?? []).some((x) => x.person === row.id), `${what}'s sessions are gone`);
      assert.equal((await gw.req('GET', '/box.json', { cookie })).status, 401, `${what}'s next request is refused`);
    }
  } finally { await gw.close(); }
});

test('org-access A15: an admin leaves the box: their row and sessions go, and their cookie is cleared', async () => {
  const { gw, C, sam } = await box('a15-leave');
  try {
    const r = await accepts(gw, C.sam, 'remove', { id: sam.id, rev: rev(gw, sam.id) }, 'Sam leaves');
    assert.ok((r.headers['set-cookie'] ?? []).some((c) => /^devteam_session=;/.test(c) && /Max-Age=0/.test(c)), `the cookie is cleared: ${r.headers['set-cookie']}`);
    assert.equal(rowOf(gw.state(), sam.id), undefined, 'Sam\'s row is gone');
    assert.equal((await gw.req('GET', '/box.json', { cookie: C.sam })).status, 401, 'Sam is out');
  } finally { await gw.close(); }
});

test('org-access A15: an admin raises a seeded View member to Full', async () => {
  const { gw, C, vic } = await box('a15-raise');
  try {
    const before = rev(gw, vic.id);
    const r = await accepts(gw, C.sam, 'level', { id: vic.id, rev: before, level: 'full' }, 'Sam makes Vic full');
    const row = rowOf(gw.state(), vic.id);
    assert.equal(row.level, 'full', 'Vic is Full');
    assert.equal(row.role, 'member', 'and still a member');
    assert.equal(r.json.rev, before + 1, 'rev moves on');
  } finally { await gw.close(); }
});

test('org-access A15: an admin is refused invite, a new link and revoke', async () => {
  const { gw, C, ana, bea, lee } = await box('a15-links');
  try {
    await refuses(gw, C.sam, 'invite', { name: 'Kim Lee', level: 'full' }, 403, 'not-allowed', 'Sam invites');
    await refuses(gw, C.sam, 'relink', { id: ana.id, rev: rev(gw, ana.id) }, 403, 'not-allowed', 'Sam sends Ana a new link');
    await refuses(gw, C.sam, 'revoke', { id: lee.id, rev: rev(gw, lee.id) }, 403, 'not-allowed', 'Sam revokes Lee\'s invite');
    await refuses(gw, C.sam, 'revoke', { id: bea.id, rev: rev(gw, bea.id) }, 403, 'not-allowed', 'Sam revokes Bea\'s new link');
  } finally { await gw.close(); }
});

test('org-access A15: an admin is refused making or unmaking an admin, changing an admin\'s level, and transfer', async () => {
  const { gw, C, kai, ana } = await box('a15-roles');
  try {
    await refuses(gw, C.sam, 'role', { id: ana.id, rev: rev(gw, ana.id), role: 'admin' }, 403, 'not-allowed', 'Sam makes Ana admin');
    await refuses(gw, C.sam, 'role', { id: kai.id, rev: rev(gw, kai.id), role: 'member' }, 403, 'not-allowed', 'Sam takes Admin from Kai');
    await refuses(gw, C.sam, 'level', { id: kai.id, rev: rev(gw, kai.id), level: 'full' }, 403, 'not-allowed', 'Sam changes Kai\'s level');
    await refuses(gw, C.sam, 'transfer', { id: ana.id, rev: rev(gw, ana.id) }, 403, 'not-allowed', 'Sam hands the box to Ana');
    await refuses(gw, C.sam, 'transfer', { id: kai.id, rev: rev(gw, kai.id) }, 403, 'not-allowed', 'Sam hands the box to Kai');
  } finally { await gw.close(); }
});

test('org-access A15: an admin is refused every change to the owner\'s row', async () => {
  const { gw, C, owner } = await box('a15-owner-row');
  try {
    const at = () => ({ id: owner.id, rev: rev(gw, owner.id) });
    for (const [action, extra] of [['rename', { name: 'Not Robin' }], ['remove', {}], ['level', { level: 'full' }], ['role', { role: 'member' }], ['transfer', {}], ['relink', {}], ['revoke', {}]]) {
      await refuses(gw, C.sam, action, { ...at(), ...extra }, 403, 'not-allowed', `Sam's ${action} of the owner's row`);
    }
  } finally { await gw.close(); }
});

test('org-access A15: an admin\'s People list offers what they may do, nothing on the owner\'s or a pending row', async () => {
  const { gw, C, owner, sam, kai, ana, vic, bea, lee } = await box('a15-list');
  try {
    const r = await gw.req('GET', '/auth/people/list', { cookie: C.sam });
    assert.equal(r.status, 200, r.body);
    const acts = Object.fromEntries(r.json.people.map((p) => [p.id, p.actions]));
    assert.deepEqual(acts[owner.id], [], 'the owner\'s row');
    assert.deepEqual(acts[lee.id], [], 'an invite not used yet');
    assert.deepEqual(acts[sam.id], ['rename', 'remove'], 'their own row: Rename, Leave');
    assert.deepEqual(acts[kai.id], ['rename', 'remove'], 'another admin');
    assert.deepEqual(acts[ana.id], ['rename', 'level', 'remove'], 'a Full member: Make view only (kit-250)');
    assert.deepEqual(acts[vic.id], ['rename', 'level', 'remove'], 'a View member: Make full');
    assert.deepEqual(acts[bea.id], ['rename', 'level', 'remove'], 'a member with a new link out');
  } finally { await gw.close(); }
});

test('kit-253: an admin changes nothing on an invite not used yet', async () => {
  const { gw, C, lee } = await box('k-pending');
  try {
    await refuses(gw, C.sam, 'rename', { id: lee.id, rev: rev(gw, lee.id), name: 'Lee P' }, 403, 'not-allowed', 'Sam renames Lee');
    await refuses(gw, C.sam, 'remove', { id: lee.id, rev: rev(gw, lee.id) }, 403, 'not-allowed', 'Sam removes Lee');
  } finally { await gw.close(); }
});

// the move to View itself, and its refusals, are kit-250's (test/org-access.view.test.mjs)
test('kit-253: a bad level or role is refused, for the owner and admins', async () => {
  const { gw, C, ana } = await box('k-view');
  try {
    await refuses(gw, C.sam, 'level', { id: ana.id, rev: rev(gw, ana.id), level: 'admin' }, 400, 'bad-request', 'Sam: a level that isn\'t one');
    await refuses(gw, C.owner, 'level', { id: ana.id, rev: rev(gw, ana.id), level: 'root' }, 400, 'bad-request', 'a level that isn\'t one');
    await refuses(gw, C.owner, 'level', { id: ana.id, rev: rev(gw, ana.id) }, 400, 'bad-request', 'no level');
    await refuses(gw, C.owner, 'role', { id: ana.id, rev: rev(gw, ana.id), role: 'owner' }, 400, 'bad-request', 'role owner (that is transfer)');
    await refuses(gw, C.owner, 'role', { id: ana.id, rev: rev(gw, ana.id) }, 400, 'bad-request', 'no role');
  } finally { await gw.close(); }
});

test('kit-253: the owner makes a joined member admin, a View one Full too, and takes Admin away', async () => {
  const { gw, C, ana, vic, kai } = await box('k-role');
  try {
    for (const [row, what] of [[ana, 'Ana'], [vic, 'Vic (View)']]) {
      const before = rev(gw, row.id);
      const r = await accepts(gw, C.owner, 'role', { id: row.id, rev: before, role: 'admin' }, `the owner makes ${what} admin`);
      const now = rowOf(gw.state(), row.id);
      assert.deepEqual([now.role, now.level, r.json.rev], ['admin', 'full', before + 1], what);
    }
    const before = rev(gw, kai.id);
    await accepts(gw, C.owner, 'role', { id: kai.id, rev: before, role: 'member' }, 'the owner takes Admin from Kai');
    const now = rowOf(gw.state(), kai.id);
    assert.deepEqual([now.role, now.level, now.rev], ['member', 'full', before + 1], 'Kai stays Full');
    const l = await gw.req('GET', '/auth/people/list', { cookie: C.kai });
    assert.equal(l.status, 403, 'Kai no longer sees People');
    const o = ownerOf(gw.state())[0];
    for (const role of ['member', 'admin']) await refuses(gw, C.owner, 'role', { id: o.id, rev: o.rev, role }, 403, 'not-allowed', `the owner makes themselves ${role}`);
    await refuses(gw, C.owner, 'level', { id: o.id, rev: o.rev, level: 'full' }, 403, 'not-allowed', 'the owner changes their own level');
    assert.equal(ownerOf(gw.state()).length, 1, 'the box still has its owner');
  } finally { await gw.close(); }
});

// Review focus 2 (and kit-249 final-2b F2): the role is judged again once the body is in.
test('kit-253: an admin\'s change whose body arrives after they lost Admin writes nothing', async () => {
  const { gw, C, sam, ana } = await box('k-held');
  const h = heldPost(gw, C.sam, 'rename', { id: ana.id, rev: rev(gw, ana.id), name: 'Ana Late' });
  h.sent.catch(() => {});
  try {
    await h.ready;
    await accepts(gw, C.owner, 'role', { id: sam.id, rev: rev(gw, sam.id), role: 'member' }, 'the owner takes Admin from Sam');
    const before = durable(gw.state());
    h.release();
    const r = await h.sent;
    assert.equal(r.status, 401, `Sam's rename, its body after he lost Admin: ${r.status} ${r.body}`);
    assert.equal(r.json?.error, 'your session ended; sign in again');
    assert.equal(durable(gw.state()), before, 'nothing written');
    assert.equal(rowOf(gw.state(), ana.id).name, 'Ana Costa', 'Ana keeps her name');
  } finally { h.release(); await h.sent.catch(() => {}); await gw.close(); }
});

// kit-249 final-2b F1: a rev is a number; "1" is not 1.
test('kit-253: a rev sent as a string is refused stale, for every People change', async () => {
  const { gw, C, ana, vic, kai } = await box('k-rev-string');
  try {
    const at = (row) => String(rev(gw, row.id));
    for (const [cookie, action, row, extra, what] of [
      [C.sam, 'rename', ana, { name: 'Ana S' }, 'an admin\'s rename'],
      [C.sam, 'level', vic, { level: 'full' }, 'an admin\'s Make full'],
      [C.owner, 'level', vic, { level: 'full' }, 'the owner\'s Make full'],
      [C.owner, 'role', ana, { role: 'admin' }, 'Make admin'],
      [C.owner, 'role', kai, { role: 'member' }, 'Take Admin away'],
      [C.sam, 'remove', ana, {}, 'an admin\'s remove'],
      [C.owner, 'transfer', ana, {}, 'Make owner'],
    ]) await refuses(gw, cookie, action, { id: row.id, rev: at(row), ...extra }, 409, 'stale', `${what}, rev "${at(row)}"`);
  } finally { await gw.close(); }
});

// --- A16: handing the box over -------------------------------------------------------------------
test('org-access A16: only the owner transfers, signed in in the last five minutes', async () => {
  const { gw, C, owner, ana, lee } = await box('a16-who');
  try {
    await refuses(gw, C.ana, 'transfer', { id: ana.id, rev: rev(gw, ana.id) }, 403, 'not-allowed', 'a member takes the box');
    await refuses(gw, C.sam, 'transfer', { id: ana.id, rev: rev(gw, ana.id) }, 403, 'not-allowed', 'an admin hands it over');
    const stale = mint(gw, owner, 10 * 60e3);
    await refuses(gw, stale, 'transfer', { id: ana.id, rev: rev(gw, ana.id) }, 403, 'fresh-sign-in', 'the owner, signed in ten minutes ago');
    await refuses(gw, C.owner, 'transfer', { id: owner.id, rev: rev(gw, owner.id) }, 403, 'not-allowed', 'the owner to themselves');
    // the stand-in owner (a claimed box with no owner row yet) restarts first
    const s = gw.state();
    gw.write({ ...s, people: s.people.filter((p) => p.role !== 'owner') });
    await refuses(gw, C.owner, 'transfer', { id: ana.id, rev: rev(gw, ana.id) }, 409, 'restart-first', 'the stand-in owner');
    await refuses(gw, C.owner, 'transfer', { id: lee.id, rev: rev(gw, lee.id) }, 409, 'restart-first', 'the stand-in, to someone never joined with a link out and no passkey: restart-first is asked first');
  } finally { await gw.close(); }
});

test('org-access A16: a transfer needs a joined person with no outstanding link who holds a passkey', async () => {
  const { gw, C, ana, bea, lee } = await box('a16-whom');
  try {
    await refuses(gw, C.owner, 'transfer', { id: lee.id, rev: rev(gw, lee.id) }, 409, 'not-joined', 'to someone who never joined');
    await refuses(gw, C.owner, 'transfer', { id: bea.id, rev: rev(gw, bea.id) }, 409, 'link-outstanding', 'to someone with a new link out');
    invite(gw, ana.id, Date.now() - 1);
    await refuses(gw, C.owner, 'transfer', { id: ana.id, rev: rev(gw, ana.id) }, 409, 'link-outstanding', 'to someone with an expired link not revoked');
    const [stubby] = gw.seed([{ name: 'Stu Bee', methods: [{ id: rid('m-'), type: 'stub', key: 'k1', label: 'stub', added_at: new Date().toISOString(), last_used: null, data: {} }] }]);
    await refuses(gw, C.owner, 'transfer', { id: stubby.id, rev: rev(gw, stubby.id) }, 409, 'no-passkey', 'to someone with no passkey');
  } finally { await gw.close(); }
});

test('org-access A16: Make admin is refused with an outstanding link, and for someone who never joined', async () => {
  const { gw, C, ana, bea, lee } = await box('a16-admin-link');
  try {
    await refuses(gw, C.owner, 'role', { id: bea.id, rev: rev(gw, bea.id), role: 'admin' }, 409, 'link-outstanding', 'Bea, a new link out');
    await refuses(gw, C.owner, 'role', { id: lee.id, rev: rev(gw, lee.id), role: 'admin' }, 409, 'not-joined', 'Lee, never joined');
    invite(gw, ana.id, Date.now() - 1);
    await refuses(gw, C.owner, 'role', { id: ana.id, rev: rev(gw, ana.id), role: 'admin' }, 409, 'link-outstanding', 'Ana, an expired link not revoked');
  } finally { await gw.close(); }
});

test('kit-253: a change to what a row already is answers its rev and writes nothing', async () => {
  const { gw, C, ana, kai } = await box('k-noop');
  try {
    for (const [cookie, action, row, extra, what] of [
      [C.owner, 'level', ana, { level: 'full' }, 'the owner makes Full Ana full'],
      [C.sam, 'level', ana, { level: 'full' }, 'an admin makes Full Ana full'],
      [C.owner, 'role', kai, { role: 'admin' }, 'the owner makes admin Kai admin'],
      [C.owner, 'role', ana, { role: 'member' }, 'the owner takes Admin from member Ana'],
    ]) {
      const before = durable(gw.state());
      let r;
      const n = await savesDuring(gw, async () => { r = await accepts(gw, cookie, action, { id: row.id, rev: rev(gw, row.id), ...extra }, what); });
      assert.deepEqual(r.json, { ok: true, rev: rev(gw, row.id) }, `${what}: the row's rev`);
      assert.equal(durable(gw.state()), before, `${what}: nothing written`);
      assert.equal(n, 0, `${what}: saves nothing`);
    }
  } finally { await gw.close(); }
});

test('kit-253: the owner\'s People list offers Make admin and Make owner only where they can land', async () => {
  const { gw, C, owner, sam, ana, vic, bea, lee } = await box('k-owner-list');
  try {
    const [stu] = gw.seed([{ name: 'Stu Bee', methods: [{ id: rid('m-'), type: 'stub', key: 'k2', label: 'stub', added_at: new Date().toISOString(), last_used: null, data: {} }] }]);
    const acts = async (cookie) => {
      const r = await gw.req('GET', '/auth/people/list', { cookie });
      assert.equal(r.status, 200, r.body);
      return Object.fromEntries(r.json.people.map((p) => [p.id, p.actions]));
    };
    const a = await acts(C.owner);
    assert.deepEqual(a[owner.id], ['rename'], 'their own row');
    assert.deepEqual(a[lee.id], ['revoke'], 'an invite not used yet');
    assert.deepEqual(a[ana.id], ['rename', 'level', 'role', 'transfer', 'relink', 'remove'], 'a Full member: Make view only (kit-250)');
    assert.deepEqual(a[vic.id], ['rename', 'level', 'role', 'transfer', 'relink', 'remove'], 'a View member: Make full');
    assert.deepEqual(a[sam.id], ['rename', 'role', 'transfer', 'relink', 'remove'], 'an admin');
    assert.deepEqual(a[bea.id], ['revoke', 'rename', 'level', 'remove'], 'a new link out: no Make admin, Make owner or second link');
    assert.deepEqual(a[stu.id], ['rename', 'level', 'role', 'relink', 'remove'], 'no passkey: no Make owner');
    invite(gw, ana.id, Date.now() - 1);
    assert.deepEqual((await acts(C.owner))[ana.id], ['revoke', 'rename', 'level', 'remove'], 'an expired link not revoked: Revoke, and no Make admin, Make owner or second link');
    gw.write({ ...gw.state(), invites: gw.state().invites.filter((x) => x.person !== ana.id) });
    // the stand-in owner: the owner's actions, without Make owner
    const s = gw.state();
    gw.write({ ...s, people: s.people.filter((p) => p.role !== 'owner') });
    const st = await acts(C.owner);
    assert.deepEqual(st[ana.id], ['rename', 'level', 'role', 'relink', 'remove'], 'the stand-in: no Make owner');
  } finally { await gw.close(); }
});

// The owner holds two passkeys and two devices; Vic (View) a passkey, a stub method and a device.
async function handover(name) {
  const b = await box(name);
  const { gw, owner, vic } = b;
  let s = gw.state();
  const second = authenticator();
  const m = second.method('owner phone');
  const top = { id: m.key, userId: m.data.userId, jwk: m.data.jwk, alg: -7, signCount: 7, name: 'owner phone', rp: 'box.localhost', createdAt: m.added_at, usedAt: '2026-11-21T09:00:00.000Z' };
  const stub = { id: rid('m-'), type: 'stub', key: 'vic-stub', label: 'stub', added_at: new Date().toISOString(), last_used: null, data: {} };
  const passkeys = [...s.passkeys, top];
  // two older top-level sessions: one from before sessions named a method, one naming a passkey gone since
  const legacy = [{ hash: u(sha(crypto.randomBytes(32))), at: Date.now(), expires: Date.now() + 86400e3 },
    { hash: u(sha(crypto.randomBytes(32))), method: u(crypto.randomBytes(16)), at: Date.now(), expires: Date.now() + 86400e3 }];
  gw.write({ ...s, passkeys, sessions: [...s.sessions, ...legacy], peopleStamp: stampOf(passkeys.map((p) => p.id)), pushSubs: [sub('o1'), sub('o2')],
    people: s.people.map((p) => (p.id === vic.id ? { ...p, methods: [{ ...p.methods[0], last_used: '2026-11-20T10:00:00.000Z' }, stub], pushSubs: [sub('v1')] } : p)) });
  invite(gw, owner.id); // only state can make one: relink refuses the owner's row
  s = gw.state();
  return { ...b, second, stub, before: s, vicRow: rowOf(s, vic.id) };
}

test('org-access A16: a transfer makes them a Full owner and the old owner a Full admin in one write, deleting invites naming either', async () => {
  const { gw, C, owner, vic, before, lee } = await handover('a16-write');
  try {
    const r = await accepts(gw, C.owner, 'transfer', { id: vic.id, rev: rev(gw, vic.id) }, 'the owner hands the box to Vic');
    assert.deepEqual(r.json, { ok: true });
    const s = gw.state();
    const nv = rowOf(s, vic.id), no = rowOf(s, owner.id);
    assert.deepEqual([nv.role, nv.level, nv.rev], ['owner', 'full', rowOf(before, vic.id).rev + 1], 'Vic is the Full owner');
    assert.deepEqual([no.role, no.level, no.rev], ['admin', 'full', rowOf(before, owner.id).rev + 1], 'the old owner a Full admin');
    assert.equal(ownerOf(s).length, 1, 'one owner');
    assert.ok(!s.invites.some((x) => x.person === owner.id || x.person === vic.id), 'no invite names either');
    assert.ok(s.invites.some((x) => x.person === lee.id), 'Lee\'s stays');
    assert.equal(s.peopleStamp, stampOf(s.passkeys.map((p) => p.id)), 'the stamp is the new owner\'s');
  } finally { await gw.close(); }
});

test('org-access A16: a transfer is one write', async () => {
  const { gw, C, vic } = await handover('a16-one-write');
  try {
    const n = await savesDuring(gw, () => accepts(gw, C.owner, 'transfer', { id: vic.id, rev: rev(gw, vic.id) }, 'to Vic'));
    assert.equal(n, 1, 'one save of the state file');
    assert.equal(ownerOf(gw.state())[0].id, vic.id);
  } finally { await gw.close(); }
});

test('kit-253: transferTo is pure: it saves nothing and awaits nothing (source)', () => {
  const src = GATEWAY_SRC();
  const at = src.indexOf('\n  const transferTo = (s, from, to) => {\n');
  assert.ok(at > 0, 'the gateway has transferTo, in createGateway\'s body');
  const end = src.indexOf('\n  };\n', at + 1);
  assert.ok(end > at, 'and it ends at its own indent');
  const body = src.slice(at, end);
  assert.equal(body.match(/store\.save\(/g)?.length ?? 0, 0, 'transferTo computes the state; the guard\'s one save writes it');
  assert.ok(!/\bawait\b/.test(body), 'and awaits nothing');
});

test('org-access A16: afterwards the top-level fields hold only the new owner\'s passkeys, sessions and devices, never empty', async () => {
  const { gw, C, owner, vic, before, vicRow, stub, keys } = await handover('a16-top');
  try {
    const vicC = C.vic;
    await accepts(gw, C.owner, 'transfer', { id: vic.id, rev: rev(gw, vic.id) }, 'to Vic');
    const s = gw.state();
    const vicKeys = vicRow.methods.filter((m) => m.type === 'passkey').map((m) => m.key);
    assert.deepEqual(s.passkeys.map((p) => p.id), vicKeys, 'top-level passkeys: Vic\'s alone');
    assert.equal(s.passkeys[0].usedAt, '2026-11-20T10:00:00.000Z', 'when it was last used, kept');
    assert.ok(s.passkeys.length > 0, 'never empty');
    assert.deepEqual(s.sessions.map((x) => x.hash), [hashOf(vicC)], 'top-level sessions: Vic\'s alone');
    assert.deepEqual(s.sessions[0].method, vicKeys[0], 'named by its passkey, as an owner\'s are');
    assert.deepEqual(s.pushSubs.map((x) => x.endpoint), ['https://push.example.com/v1'], 'top-level devices: Vic\'s alone');
    const nv = rowOf(s, vic.id), no = rowOf(s, owner.id);
    assert.deepEqual(nv.methods.map((m) => m.id), [stub.id], 'Vic\'s row keeps only the stub');
    assert.deepEqual(nv.pushSubs, [], 'and no devices');
    assert.deepEqual(no.methods.filter((m) => m.type === 'passkey').map((m) => m.key).sort(), before.passkeys.map((p) => p.id).sort(), 'the old owner\'s passkeys are in their row');
    const phone = no.methods.find((m) => m.key === before.passkeys[1].id);
    assert.deepEqual([phone.data.signCount, phone.last_used, phone.label, phone.data.userId], [7, '2026-11-21T09:00:00.000Z', 'owner phone', before.passkeys[1].userId], 'a moved passkey keeps its counter, its last use, its name and its user');
    assert.deepEqual(no.pushSubs.map((x) => x.endpoint), ['https://push.example.com/o1', 'https://push.example.com/o2'], 'and their devices');
    const mine = s.peopleSessions.filter((x) => x.person === owner.id).map((x) => x.hash).sort();
    assert.deepEqual(mine, before.sessions.map((x) => x.hash).sort(), 'and their sessions');
    for (const x of s.peopleSessions.filter((y) => y.person === owner.id)) assert.ok(x.method === null || no.methods.some((m) => m.id === x.method), `each named by a method of their row, or none: ${x.method}`);
    assert.equal(s.peopleSessions.filter((x) => x.person === owner.id && x.method === null).length, 2, 'the two older sessions name none');
    assert.equal((await gw.login(keys.vic)).status, 200, 'Vic signs in with her passkey');
    assert.equal((await gw.login(keys.owner)).status, 200, 'the old owner with theirs');
    await gw.close();
    const again = await gateway('a16-top-again', { dir: gw.dir });
    try { assert.ok(!again.logs.some((l) => /older gateway/.test(l)), 'a restart sees no reset'); } finally { await again.close(); }
  } finally { await gw.close().catch(() => {}); }
});

test('org-access A16: afterwards an older gateway admits only the new owner', async () => {
  const { gw, C, vic, keys } = await handover('a16-old');
  try { await accepts(gw, C.owner, 'transfer', { id: vic.id, rev: rev(gw, vic.id) }, 'to Vic'); } finally { await gw.close(); }
  const old = await gateway('a16-old-old', { module: oldGateway(), dir: gw.dir });
  try {
    assert.equal((await old.req('GET', '/box.json', { cookie: C.vic })).status, 200, 'Vic\'s session');
    assert.equal((await old.login(keys.vic)).status, 200, 'Vic\'s passkey');
    assert.equal((await old.req('GET', '/box.json', { cookie: C.owner })).status, 401, 'the old owner\'s session');
    assert.notEqual((await old.login(keys.owner)).status, 200, 'the old owner\'s passkey');
    assert.equal((await old.req('GET', '/box.json', { cookie: C.sam })).status, 401, 'an admin\'s session');
  } finally { await old.close(); }
});

// Review focus 3: the second tab's session is an admin's by the time its body lands.
test('kit-253: two owner tabs: the second transfer is refused', async () => {
  const { gw, C, owner, ana, vic } = await box('k-two-tabs');
  const tab2 = mint(gw, owner);
  const h = heldPost(gw, tab2, 'transfer', { id: vic.id, rev: rev(gw, vic.id) });
  h.sent.catch(() => {});
  try {
    await h.ready;
    await accepts(gw, C.owner, 'transfer', { id: ana.id, rev: rev(gw, ana.id) }, 'the first tab hands the box to Ana');
    const before = durable(gw.state());
    h.release();
    const r = await h.sent;
    assert.equal(r.status, 403, `the second tab's transfer to Vic: ${r.status} ${r.body}`);
    assert.equal(r.json?.code, 'not-allowed', r.body);
    assert.equal(durable(gw.state()), before, 'nothing written');
    assert.deepEqual(ownerOf(gw.state()).map((p) => p.id), [ana.id], 'Ana is the owner');
  } finally { h.release(); await h.sent.catch(() => {}); await gw.close(); }
});

// Review focus 4: a session the new owner opened with a method that isn't a passkey.
test('kit-253: a session the new owner opened with another method stays theirs, at top level', async () => {
  const { gw, C, owner, vic, stub } = await handover('k-stub-session');
  try {
    const tok = crypto.randomBytes(32);
    const hash = u(sha(tok));
    const s = gw.state();
    // and the old owner's: a top-level session opened with a method in their row that isn't a passkey
    const own = { id: rid('m-'), type: 'stub', key: 'owner-stub', label: 'stub', added_at: new Date().toISOString(), last_used: null, data: {} };
    const ownHash = u(sha(crypto.randomBytes(32)));
    gw.write({ ...s, people: s.people.map((p) => (p.id === owner.id ? { ...p, methods: [...(p.methods ?? []), own] } : p)), sessions: [...s.sessions, { hash: ownHash, method: own.id, at: Date.now(), expires: Date.now() + 86400e3 }],
      peopleSessions: [...s.peopleSessions, { hash, person: vic.id, method: stub.id, at: Date.now(), expires: Date.now() + 86400e3 }] });
    await accepts(gw, C.owner, 'transfer', { id: vic.id, rev: rev(gw, vic.id) }, 'to Vic');
    const t = gw.state();
    const top = t.sessions.find((x) => x.hash === hash);
    assert.ok(top, 'the stub session is at top level');
    assert.equal(top.method, stub.id, 'naming the stub\'s id, which stays in her row');
    assert.ok(!t.peopleSessions.some((x) => x.hash === hash), 'and not in peopleSessions');
    assert.equal(t.peopleSessions.find((x) => x.hash === ownHash)?.method, own.id, 'the old owner\'s session opened with their stub keeps naming it');
    const b = await gw.req('GET', '/box.json', { cookie: `devteam_session=${u(tok)}` });
    assert.deepEqual([b.status, b.json?.role], [200, 'owner'], 'it signs her in as the owner');
  } finally { await gw.close(); }
});

test('org-access A16: afterwards the old owner\'s open session works as an admin', async () => {
  const { gw, C, owner, vic, ana } = await handover('a16-old-owner');
  try {
    await accepts(gw, C.owner, 'transfer', { id: vic.id, rev: rev(gw, vic.id) }, 'to Vic');
    const b = await gw.req('GET', '/box.json', { cookie: C.owner });
    assert.equal(b.status, 200, 'still signed in');
    assert.equal(b.json.role, 'admin', 'as an admin');
    const l = await gw.req('GET', '/auth/people/list', { cookie: C.owner });
    assert.equal(l.json.viewer.role, 'admin');
    await accepts(gw, C.owner, 'rename', { id: ana.id, rev: rev(gw, ana.id), name: 'Ana R' }, 'renames a member, still fresh');
    await refuses(gw, C.owner, 'transfer', { id: owner.id, rev: rev(gw, owner.id) }, 403, 'not-allowed', 'takes the box back');
    await refuses(gw, C.owner, 'invite', { name: 'Kim Lee' }, 403, 'not-allowed', 'invites');
    const v = await gw.req('GET', '/auth/people/list', { cookie: C.vic });
    assert.equal(v.json.viewer.role, 'owner', 'Vic\'s session is the owner\'s');
    await accepts(gw, C.vic, 'role', { id: owner.id, rev: rev(gw, owner.id), role: 'member' }, 'Vic takes Admin from the old owner');
  } finally { await gw.close(); }
});
