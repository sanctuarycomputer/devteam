// One identity, many sign-in methods (cloud/gateway.mjs, kit-254): the gateway's table of method
// types, the generic routes /auth/method/<type>/start|finish for a claim, a sign-in, an add and an
// invite, and the flow cookie that binds each flow to the browser that started it. A second type,
// `stub`, is registered here only (createGateway's test option `methodTypes`), to show a new type
// needs no rework. Tests for the org-access goal's measure are named 'org-access A17: …'. People,
// invites and sessions are seeded by writing the state file (the store re-reads a replaced file),
// and a revoke, a removal, a reclaim and a transfer are simulated the same way.
// Run: node --test test/org-access.methods.test.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-methods-'));
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

test('org-access A17: an invite adds a stub method and signs in as the same identity', async () => {
  const { gw, ana, anaKey } = await setup('c1');
  try {
    const token = seedInvite(gw, ana.id);
    const b = browser(gw);
    const st = await b.start('stub', { purpose: 'invite', token });
    ok(st, 'invite start');
    assert.equal(typeof st.json.state, 'string');
    assert.equal(st.json.hello, 'stub', 'the type\'s object comes back with the state');
    const fin = await b.finish('stub', { purpose: 'invite', state: st.json.state, key: 'k1' });
    ok(fin, 'invite finish');
    assert.deepEqual(fin.json, { ok: true });
    const sc = sessionCookieOf(fin);
    assert.ok(sc, 'the invite opened a session');
    const s = gw.state();
    const row = s.people.find((p) => p.id === ana.id);
    const m = row.methods.find((x) => x.type === 'stub');
    assert.ok(m, 'Ana\'s row holds a stub method');
    assert.deepEqual(keysOf(m), sorted(METHOD_KEYS));
    assert.match(m.id, /^m-[a-z2-7]{12}$/);
    assert.equal(m.key, 'k1');
    assert.equal(m.label, 'stub k1');
    assert.deepEqual(m.data, { n: 0 });
    assert.equal(typeof m.last_used, 'string', 'an invite signs in, so the method was used');
    assert.equal(row.rev, ana.rev + 1);
    assert.equal(row.methods.length, 2);
    assert.deepEqual(s.invites, [], 'the invite is gone');
    const owner = s.people.find((p) => p.role === 'owner');
    assert.ok(!owner.methods.some((x) => x.type === 'stub'), 'nothing written to the owner');
    const who = sessionIn(gw, sc.split(';')[0]);
    assert.equal(who?.top, false, 'the session is in peopleSessions, not top-level');
    assert.equal(who.entry.person, ana.id);
    assert.equal(who.entry.method, m.id);
    const list = await b.req('GET', '/auth/method/list');
    ok(list, 'method list');
    assert.deepEqual(list.json.methods.map((x) => x.type).sort(), ['passkey', 'stub'], 'Ana\'s passkey and the stub');
    assert.equal(row.role, ana.role);
    assert.equal(row.level, ana.level);
    // signing in with the stub method is Ana again
    const c = browser(gw);
    const st2 = await c.start('stub', { purpose: 'sign-in' });
    ok(st2, 'stub sign-in start');
    const fin2 = await c.finish('stub', { purpose: 'sign-in', state: st2.json.state, key: 'k1' });
    ok(fin2, 'stub sign-in finish');
    const w2 = sessionIn(gw, sessionCookieOf(fin2).split(';')[0]);
    assert.equal(w2?.top, false);
    assert.equal(w2.entry.person, ana.id);
    assert.equal(w2.entry.method, m.id);
    // and so is signing in with her passkey
    const d = browser(gw);
    const lo = await d.post('/auth/login/options', {});
    ok(lo, 'login options');
    const lv = await d.post('/auth/login/verify', anaKey.get(lo.json, gw.publicUrl));
    ok(lv, 'login verify');
    const w3 = sessionIn(gw, sessionCookieOf(lv).split(';')[0]);
    assert.equal(w3?.top, false);
    assert.equal(w3.entry.person, ana.id);
    const after = rowOf(gw, ana.id);
    assert.equal(after.role, ana.role);
    assert.equal(after.level, ana.level);
  } finally { await gw.close(); }
});

test('org-access A17: an add from your own methods goes where you are, the owner\'s to their row', async () => {
  const { gw, owner, ana } = await setup('c2');
  try {
    const b = anaBrowser(gw, ana);
    const st = await b.start('stub', { purpose: 'add' });
    ok(st, 'Ana\'s add start');
    const fin = await b.finish('stub', { purpose: 'add', state: st.json.state, key: 'k2' });
    ok(fin, 'Ana\'s add finish');
    assert.deepEqual(fin.json, { ok: true });
    assert.equal(sessionCookieOf(fin), null, 'an add opens no session');
    const row = rowOf(gw, ana.id);
    const m = row.methods.find((x) => x.type === 'stub');
    assert.ok(m, 'the stub method is in Ana\'s row');
    assert.equal(m.key, 'k2');
    assert.equal(m.label, 'stub k2');
    assert.equal(m.last_used, null);
    assert.deepEqual(keysOf(m), sorted(METHOD_KEYS));
    assert.equal(row.rev, ana.rev + 1);
    const c = browser(gw);
    const si = await c.start('stub', { purpose: 'sign-in' });
    ok(si, 'sign-in start');
    const sf = await c.finish('stub', { purpose: 'sign-in', state: si.json.state, key: 'k2' });
    ok(sf, 'sign-in finish');
    const w = sessionIn(gw, sessionCookieOf(sf).split(';')[0]);
    assert.equal(w?.top, false);
    assert.equal(w.entry.person, ana.id);
    // the owner's stub goes to the owner's row; top-level passkeys and the stamp stay as they were
    const before = gw.state();
    const ost = await owner.start('stub', { purpose: 'add' });
    ok(ost, 'owner\'s add start');
    const ofin = await owner.finish('stub', { purpose: 'add', state: ost.json.state, key: 'ko' });
    ok(ofin, 'owner\'s add finish');
    const s = gw.state();
    const orow = s.people.find((p) => p.role === 'owner');
    const om = orow.methods.find((x) => x.type === 'stub' && x.key === 'ko');
    assert.ok(om, 'the owner\'s stub is in the owner\'s row');
    assert.equal(JSON.stringify(s.passkeys), JSON.stringify(before.passkeys), 'top-level passkeys byte-identical');
    assert.equal(s.peopleStamp, before.peopleStamp);
    assert.ok(!rowOf(gw, ana.id).methods.some((x) => x.key === 'ko'), 'not to Ana');
    const d = browser(gw);
    const osi = await d.start('stub', { purpose: 'sign-in' });
    ok(osi, 'owner stub sign-in start');
    const osf = await d.finish('stub', { purpose: 'sign-in', state: osi.json.state, key: 'ko' });
    ok(osf, 'owner stub sign-in finish');
    const ow = sessionIn(gw, sessionCookieOf(osf).split(';')[0]);
    assert.equal(ow?.top, true, 'the owner\'s session is top-level');
    assert.equal(ow.entry.method, om.id);
  } finally { await gw.close(); }
});

test('org-access A17: a (type, key) held by someone else is refused', async () => {
  const { gw, ana } = await setup('c3');
  try {
    seed(gw, [{ name: 'Vic', methods: [stubMethod('k1')] }]);
    const b = anaBrowser(gw, ana);
    const st = await b.start('stub', { purpose: 'add' });
    ok(st, 'add start');
    const before = gw.state();
    refused(await b.finish('stub', { purpose: 'add', state: st.json.state, key: 'k1' }), 400, T.taken, 'Ana adds Vic\'s k1');
    assert.deepEqual(gw.state(), before, 'nothing written');
    const token = seedInvite(gw, ana.id);
    const c = browser(gw);
    const ist = await c.start('stub', { purpose: 'invite', token });
    ok(ist, 'invite start');
    const before2 = gw.state();
    const r = await c.finish('stub', { purpose: 'invite', state: ist.json.state, key: 'k1' });
    refused(r, 400, T.taken, 'an invite finished with Vic\'s k1');
    assert.equal(sessionCookieOf(r), null);
    assert.deepEqual(gw.state(), before2, 'nothing written, the invite still there');
    assert.equal(gw.state().invites.length, 1);
  } finally { await gw.close(); }
});

test('org-access A17: the state value missing, expired, reused, or for another purpose or type is refused', async () => {
  const { gw, ana } = await setup('c4', { methods: [stubMethod('k4')] });
  let slow = null;
  try {
    const session = mintSession(gw, ana.id, ana.methods[0].id);
    const flows = {
      add: () => ({ b: browser(gw, { session }), body: { purpose: 'add' } }),
      invite: () => ({ b: browser(gw), body: { purpose: 'invite', token: seedInvite(gw, ana.id) } }),
      'sign-in': () => ({ b: browser(gw), body: { purpose: 'sign-in' } }),
    };
    // missing
    for (const [purpose, make] of Object.entries(flows)) {
      const { b, body } = make();
      ok(await b.start('stub', body), `${purpose} start`);
      const before = gw.state();
      refused(await b.finish('stub', { purpose, key: 'x-missing' }), 400, T.noState, `${purpose} with no state`);
      assert.deepEqual(gw.state(), before, `${purpose}: nothing written`);
    }
    // reused: a finished state, its cookie pair put back by hand
    const reuseKey = { add: 'r-add', invite: 'r-invite', 'sign-in': 'k4' };
    for (const [purpose, make] of Object.entries(flows)) {
      const { b, body } = make();
      const st = await b.start('stub', body);
      ok(st, `${purpose} start`);
      const pair = b.jar.flow;
      ok(await b.finish('stub', { purpose, state: st.json.state, key: reuseKey[purpose] }), `${purpose} first finish`);
      const before = gw.state();
      refused(await b.finish('stub', { purpose, state: st.json.state, key: reuseKey[purpose] }, { flow: pair, session: purpose === 'add' ? session : null }), 403, T.startAgain, `${purpose} finished twice`);
      assert.deepEqual(gw.state(), before, `${purpose} reused: nothing written`);
    }
    // reused while in flight: two finishes of one sign-in, both waiting on a provider's finish
    {
      const b = browser(gw);
      const st = await b.start('stub', { purpose: 'sign-in' });
      ok(st, 'sign-in start');
      const both = await Promise.all([0, 1].map(() => b.finish('stub', { purpose: 'sign-in', state: st.json.state, key: 'k4', delayMs: 300 }, { store: false })));
      assert.deepEqual(both.map((r) => r.status).sort(), [200, 403], 'one sign-in, once');
      assert.deepEqual(both.find((r) => r.status === 403).json, { error: T.startAgain });
    }
    // another purpose: an add's state finished as a sign-in, and a sign-in's as an add
    {
      const { b, body } = flows.add();
      const st = await b.start('stub', body);
      ok(st, 'add start');
      const before = gw.state();
      refused(await b.finish('stub', { purpose: 'sign-in', state: st.json.state, key: 'k4' }), 403, T.startAgain, 'an add\'s state as sign-in');
      assert.deepEqual(gw.state(), before, 'nothing written');
    }
    {
      const b = browser(gw, { session });
      const st = await b.start('stub', { purpose: 'sign-in' });
      ok(st, 'sign-in start');
      const before = gw.state();
      refused(await b.finish('stub', { purpose: 'add', state: st.json.state, key: 'x-cross' }), 403, T.startAgain, 'a sign-in\'s state as add');
      assert.deepEqual(gw.state(), before, 'nothing written');
    }
    // another type: a stub add's state inside a passkey's clientDataJSON, and a passkey add's challenge to the stub
    {
      const b = browser(gw, { session });
      const st = await b.start('stub', { purpose: 'add' });
      ok(st, 'stub add start');
      const clientDataJSON = u(JSON.stringify({ type: 'webauthn.create', challenge: st.json.state, origin: gw.publicUrl }));
      const before = gw.state();
      refused(await b.finish('passkey', { purpose: 'add', clientDataJSON }), 403, T.startAgain, 'a stub state at the passkey finish');
      assert.deepEqual(gw.state(), before, 'nothing written');
    }
    {
      const b = browser(gw, { session });
      const st = await b.start('passkey', { purpose: 'add' });
      ok(st, 'passkey add start');
      assert.equal(typeof st.json.challenge, 'string');
      const before = gw.state();
      refused(await b.finish('stub', { purpose: 'add', state: st.json.challenge, key: 'x-type' }), 403, T.startAgain, 'a passkey state at the stub finish');
      assert.deepEqual(gw.state(), before, 'nothing written');
    }
    // expired: the same box under a gateway whose records and sign-in states live 300 ms
    await gw.close();
    slow = await gateway('c4-slow', { dir: gw.dir, challengeMs: 300 });
    const later = {
      add: () => ({ b: browser(slow, { session }), body: { purpose: 'add' } }),
      invite: () => ({ b: browser(slow), body: { purpose: 'invite', token: seedInvite(slow, ana.id) } }),
      'sign-in': () => ({ b: browser(slow), body: { purpose: 'sign-in' } }),
    };
    for (const [purpose, make] of Object.entries(later)) {
      const { b, body } = make();
      const st = await b.start('stub', body);
      ok(st, `${purpose} start (300 ms)`);
      await sleep(400);
      const before = slow.state();
      refused(await b.finish('stub', { purpose, state: st.json.state, key: purpose === 'sign-in' ? 'k4' : 'x-expired' }), 403, T.startAgain, `${purpose} after its state expired`);
      assert.deepEqual(slow.state(), before, `${purpose} expired: nothing written`);
    }
  } finally { await gw.close(); if (slow) await slow.close(); }
});

test('org-access A17: what start rested on, gone by finish, is refused', async (t) => {
  await t.test('(a) an add, then a reclaim', async () => {
    const { gw, ana } = await setup('c5a');
    try {
      const b = anaBrowser(gw, ana);
      const st = await b.start('stub', { purpose: 'add' });
      ok(st, 'add start');
      reclaim(gw);
      const before = gw.state();
      refused(await b.finish('stub', { purpose: 'add', state: st.json.state, key: 'k5a' }), 401, T.ended, 'add after a reclaim');
      assert.deepEqual(gw.state(), before, 'nothing written');
    } finally { await gw.close(); }
  });
  await t.test('(b) an invite, then a revoke', async () => {
    const { gw, ana } = await setup('c5b');
    try {
      const token = seedInvite(gw, ana.id);
      const b = browser(gw);
      const st = await b.start('stub', { purpose: 'invite', token });
      ok(st, 'invite start');
      gw.write({ ...gw.state(), invites: [] });
      const before = gw.state();
      refused(await b.finish('stub', { purpose: 'invite', state: st.json.state, key: 'k5b' }), 403, T.invite, 'invite after a revoke');
      assert.deepEqual(gw.state(), before, 'Ana\'s methods unchanged');
    } finally { await gw.close(); }
  });
  await t.test('(c) an invite, then the person removed', async () => {
    const { gw, ana } = await setup('c5c');
    try {
      const token = seedInvite(gw, ana.id);
      const b = browser(gw);
      const st = await b.start('stub', { purpose: 'invite', token });
      ok(st, 'invite start');
      const s = gw.state();
      gw.write({ ...s, people: s.people.filter((p) => p.id !== ana.id) });
      const before = gw.state();
      refused(await b.finish('stub', { purpose: 'invite', state: st.json.state, key: 'k5c' }), 403, T.invite, 'invite after a removal');
      assert.deepEqual(gw.state(), before, 'nothing written');
    } finally { await gw.close(); }
  });
  await t.test('(d) an add, then the session goes stale', async () => {
    const { gw, ana } = await setup('c5d');
    try {
      const b = anaBrowser(gw, ana);
      const st = await b.start('stub', { purpose: 'add' });
      ok(st, 'add start');
      const s = gw.state();
      const h = hashOf(b.jar.session);
      gw.write({ ...s, peopleSessions: s.peopleSessions.map((x) => (x.hash === h ? { ...x, at: x.at - 10 * 60e3 } : x)) });
      const before = gw.state();
      refused(await b.finish('stub', { purpose: 'add', state: st.json.state, key: 'k5d' }), 403, T.notFresh, 'add on a stale session');
      assert.deepEqual(gw.state(), before, 'nothing written');
    } finally { await gw.close(); }
  });
  await t.test('(e) the race: a revoke and a reclaim during the type\'s finish', async () => {
    const { gw, ana } = await setup('c5e');
    try {
      const token = seedInvite(gw, ana.id);
      const b = browser(gw);
      const st = await b.start('stub', { purpose: 'invite', token });
      ok(st, 'invite start');
      let began = new Promise((r) => { finishing = r; });
      const pending = b.finish('stub', { purpose: 'invite', state: st.json.state, key: 'k5e', delayMs: 500 });
      await began;
      gw.write({ ...gw.state(), invites: [] });
      const before = gw.state();
      refused(await pending, 403, T.invite, 'an invite revoked during the finish');
      assert.deepEqual(gw.state(), before, 'nothing written');
      const c = anaBrowser(gw, ana);
      const ast = await c.start('stub', { purpose: 'add' });
      ok(ast, 'add start');
      began = new Promise((r) => { finishing = r; });
      const pending2 = c.finish('stub', { purpose: 'add', state: ast.json.state, key: 'k5e2', delayMs: 500 });
      await began;
      reclaim(gw);
      const before2 = gw.state();
      refused(await pending2, 401, T.ended, 'a box reclaimed during the finish');
      assert.deepEqual(gw.state(), before2, 'nothing written');
    } finally { finishing = null; await gw.close(); }
  });
});

test('org-access A17: a claim with the stub is refused at start', async () => {
  const gw = await gateway('c6');
  try {
    assert.ok(gw.token, 'the box printed a claim link');
    const b = browser(gw);
    refused(await b.start('stub', { purpose: 'claim', token: gw.token }), 400, T.claimPasskey, 'stub claim');
    assert.deepEqual(gw.state().passkeys, [], 'the box stays unclaimed');
    assert.equal(flowCookieOf(await b.start('stub', { purpose: 'claim', token: gw.token })), null, 'no flow cookie on a refusal');
  } finally { await gw.close(); }
});

test('org-access A17: a flow finishes only in the browser and session that started it', async () => {
  const { gw, ana } = await setup('c7');
  try {
    const token = seedInvite(gw, ana.id);
    const a = browser(gw);
    const st = await a.start('stub', { purpose: 'invite', token });
    ok(st, 'invite start in A');
    const other = browser(gw);
    const before = gw.state();
    refused(await other.finish('stub', { purpose: 'invite', state: st.json.state, key: 'k7' }), 403, T.otherBrowser, 'B finishes A\'s invite');
    assert.deepEqual(gw.state(), before, 'nothing written');
    // the right state with a nonce that isn't the one start set: not this browser either
    const forged = (jar) => `${jar.flow.split('=')[0]}=${jar.flow.split('=')[1].split('.')[0]}.${u(crypto.randomBytes(32))}`;
    refused(await a.finish('stub', { purpose: 'invite', state: st.json.state, key: 'k7' }, { flow: forged(a.jar), store: false }), 403, T.otherBrowser, 'a forged nonce for A\'s invite');
    assert.deepEqual(gw.state(), before, 'nothing written');
    ok(await a.finish('stub', { purpose: 'invite', state: st.json.state, key: 'k7' }), 'A finishes it: B\'s and the forged tries spent nothing');
    const c = browser(gw);
    const sst = await c.start('stub', { purpose: 'sign-in' });
    ok(sst, 'sign-in start in C');
    refused(await c.finish('stub', { purpose: 'sign-in', state: sst.json.state, key: 'k7' }, { flow: forged(c.jar), store: false }), 403, T.otherBrowser, 'a forged nonce for C\'s sign-in');
    ok(await c.finish('stub', { purpose: 'sign-in', state: sst.json.state, key: 'k7' }), 'C signs in with its own nonce');
    // malformed pairs beside the real one are skipped, and a second cookie of the name is read too
    const d = browser(gw);
    const dst = await d.start('stub', { purpose: 'sign-in' });
    ok(dst, 'sign-in start in D');
    const [name, value] = d.jar.flow.split('=');
    ok(await d.finish('stub', { purpose: 'sign-in', state: dst.json.state, key: 'k7' }, { flow: `${name}=not-a-pair~x.y~${'a'.repeat(200)}; ${name}=${value}`, store: false }), 'the real pair found among bad ones, in a second cookie');
    const s1 = mintSession(gw, ana.id, ana.methods[0].id);
    const s2 = mintSession(gw, ana.id, ana.methods[0].id);
    const b = browser(gw, { session: s1 });
    const ast = await b.start('stub', { purpose: 'add' });
    ok(ast, 'add start on S1');
    const before2 = gw.state();
    refused(await b.finish('stub', { purpose: 'add', state: ast.json.state, key: 'k7b' }, { session: s2 }), 403, T.otherSession, 'finished on S2');
    assert.deepEqual(gw.state(), before2, 'nothing written');
  } finally { await gw.close(); }
});

test('org-access A17: the flow cookie\'s name and attributes, on https and on http', async () => {
  const gw = await gateway('c8', { https: true });
  try {
    await claim(gw);
    seed(gw, [{ name: 'Ana', methods: [stubMethod('k8')] }]);
    const b = browser(gw);
    const st = await b.start('stub', { purpose: 'sign-in' });
    ok(st, 'https sign-in start');
    const fc = flowCookieOf(st);
    assert.match(fc ?? '', /^__Host-devteam_flow=[\w-]+\.[\w-]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=300$/);
    const value = fc.split(';')[0].slice('__Host-devteam_flow='.length);
    refused(await b.finish('stub', { purpose: 'sign-in', state: st.json.state, key: 'k8' }, { flow: `devteam_flow=${value}` }), 403, T.otherBrowser, 'the plain name on https');
    const fin = await b.finish('stub', { purpose: 'sign-in', state: st.json.state, key: 'k8' });
    ok(fin, 'with the __Host- cookie');
    assert.ok(fin.cookies[0]?.startsWith('devteam_session='), 'the session cookie first');
    assert.match(flowCookieOf(fin) ?? '', /^__Host-devteam_flow=[^;]*; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=0$/, 'the last pair spent clears the cookie');
  } finally { await gw.close(); }
  const plain = await gateway('c8-http');
  try {
    await claim(plain);
    seed(plain, [{ name: 'Ana', methods: [stubMethod('k8')] }]);
    const b = browser(plain);
    const st = await b.start('stub', { purpose: 'sign-in' });
    ok(st, 'http sign-in start');
    assert.match(flowCookieOf(st) ?? '', /^devteam_flow=[\w-]+\.[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=300$/);
    const fin = await b.finish('stub', { purpose: 'sign-in', state: st.json.state, key: 'k8' });
    ok(fin, 'http finish');
    assert.match(flowCookieOf(fin) ?? '', /^devteam_flow=[^;]*; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0$/);
  } finally { await plain.close(); }
});

test('org-access A17: today\'s passkey routes and /auth/method/passkey/* go through the row, cookie and all', async () => {
  // the aliases
  const gw = await gateway('c9');
  try {
    const b = browser(gw);
    const a = authenticator();
    const o = await b.post('/auth/claim/options', { token: gw.token });
    ok(o, 'claim options');
    assert.ok(flowCookieOf(o), 'claim options set the flow cookie');
    assert.equal(o.json.state, o.json.challenge);
    const cred = a.create(o.json, gw.publicUrl);
    refused(await b.post('/auth/claim/verify', { token: gw.token, ...cred }, { flow: null }), 403, T.otherBrowser, 'claim verify without the flow cookie');
    assert.deepEqual(gw.state().passkeys, [], 'still unclaimed');
    ok(await b.post('/auth/claim/verify', { token: gw.token, ...cred }), 'claim verify with it');
    assert.equal(gw.state().passkeys.length, 1, 'claimed');
    const l = await b.post('/auth/login/options', {}, { session: null });
    ok(l, 'login options');
    assert.ok(flowCookieOf(l), 'login options set the flow cookie');
    const asr = a.get(l.json, gw.publicUrl);
    refused(await b.post('/auth/login/verify', asr, { session: null, flow: null }), 403, T.otherBrowser, 'login verify without the flow cookie');
    const lv = await b.post('/auth/login/verify', asr, { session: null });
    ok(lv, 'login verify with it');
    assert.ok(sessionCookieOf(lv));
    const po = await b.post('/auth/passkeys/options', {});
    ok(po, 'passkeys options');
    assert.ok(flowCookieOf(po), 'passkeys options set the flow cookie');
    const a2 = authenticator();
    const c2 = a2.create(po.json, gw.publicUrl);
    refused(await b.post('/auth/passkeys/verify', c2, { flow: null }), 403, T.otherBrowser, 'passkeys verify without the flow cookie');
    assert.equal(gw.state().passkeys.length, 1);
    ok(await b.post('/auth/passkeys/verify', c2), 'passkeys verify with it');
    assert.ok(gw.state().passkeys.some((p) => p.id === u(a2.id)), 'the new passkey is top-level');
  } finally { await gw.close(); }
  // the generic routes for the passkey row
  const gw2 = await gateway('c9-generic');
  try {
    const b = browser(gw2);
    const a = authenticator();
    const s1 = await b.start('passkey', { purpose: 'claim', token: gw2.token });
    ok(s1, 'passkey claim start');
    assert.ok(flowCookieOf(s1));
    assert.equal(s1.json.state, s1.json.challenge);
    const cred = a.create(s1.json, gw2.publicUrl);
    refused(await b.finish('passkey', { purpose: 'claim', ...cred }, { flow: null }), 403, T.otherBrowser, 'claim finish without the flow cookie');
    assert.deepEqual(gw2.state().passkeys, []);
    ok(await b.finish('passkey', { purpose: 'claim', ...cred }), 'claim finish with it');
    assert.equal(gw2.state().passkeys.length, 1);
    const si = await b.start('passkey', { purpose: 'sign-in' }, { session: null });
    ok(si, 'passkey sign-in start');
    const asr = a.get(si.json, gw2.publicUrl);
    refused(await b.finish('passkey', { purpose: 'sign-in', ...asr }, { session: null, flow: null }), 403, T.otherBrowser, 'sign-in finish without the flow cookie');
    const sf = await b.finish('passkey', { purpose: 'sign-in', ...asr }, { session: null });
    ok(sf, 'sign-in finish with it');
    assert.ok(sessionCookieOf(sf));
    const ad = await b.start('passkey', { purpose: 'add' });
    ok(ad, 'passkey add start');
    const a2 = authenticator();
    const c2 = a2.create(ad.json, gw2.publicUrl);
    refused(await b.finish('passkey', { purpose: 'add', ...c2 }, { flow: null }), 403, T.otherBrowser, 'add finish without the flow cookie');
    ok(await b.finish('passkey', { purpose: 'add', ...c2 }), 'add finish with it');
    assert.ok(gw2.state().passkeys.some((p) => p.id === u(a2.id)), 'the new passkey is top-level');
  } finally { await gw2.close(); }
});

test('org-access A17: two flows in one browser both finish; the cookie keeps the newest four', async () => {
  const { gw, ana } = await setup('c10');
  try {
    const b = anaBrowser(gw, ana);
    const one = await b.start('stub', { purpose: 'add' });
    ok(one, 'first start');
    const two = await b.start('stub', { purpose: 'add' });
    ok(two, 'second start');
    assert.equal(pairsIn(b.jar.flow).length, 2, 'two pairs in the cookie');
    ok(await b.finish('stub', { purpose: 'add', state: two.json.state, key: 'a2' }), 'the second finishes');
    ok(await b.finish('stub', { purpose: 'add', state: one.json.state, key: 'a1' }), 'then the first');
    assert.deepEqual(rowOf(gw, ana.id).methods.filter((m) => m.type === 'stub').map((m) => m.key).sort(), ['a1', 'a2']);
    const five = [];
    for (let i = 0; i < 5; i++) { const r = await b.start('stub', { purpose: 'add' }); ok(r, `start ${i + 1} of 5`); five.push(r.json.state); }
    assert.equal(pairsIn(b.jar.flow).length, 4, 'the newest four');
    refused(await b.finish('stub', { purpose: 'add', state: five[0], key: 'b1' }), 403, T.otherBrowser, 'the oldest of five');
    ok(await b.finish('stub', { purpose: 'add', state: five[4], key: 'b5' }), 'the newest of five');
  } finally { await gw.close(); }
});

test('org-access A17: an add spanning a transfer is refused', async () => {
  const { gw, ana } = await setup('c11');
  try {
    const b = anaBrowser(gw, ana);
    const st = await b.start('stub', { purpose: 'add' });
    ok(st, 'add start');
    // the transfer, as kit-253 will write it: Ana owner with her passkeys top-level, the old owner admin
    const s = gw.state();
    const toTop = (m) => ({ id: m.key, userId: m.data.userId, jwk: m.data.jwk, alg: m.data.alg, signCount: m.data.signCount, name: m.label, rp: m.data.rp, createdAt: m.added_at });
    const toMethod = (p) => ({ id: rid('m-'), type: 'passkey', key: p.id, label: p.name, added_at: p.createdAt, last_used: p.usedAt ?? null, data: { userId: p.userId, jwk: p.jwk, alg: p.alg, signCount: p.signCount, rp: p.rp } });
    const anaRow = s.people.find((p) => p.id === ana.id);
    const passkeys = anaRow.methods.filter((m) => m.type === 'passkey').map(toTop);
    const people = s.people.map((p) => (p.role === 'owner' ? { ...p, role: 'admin', methods: [...p.methods, ...s.passkeys.map(toMethod)], rev: p.rev + 1 }
      : p.id === ana.id ? { ...p, role: 'owner', methods: p.methods.filter((m) => m.type !== 'passkey'), rev: p.rev + 1 } : p));
    gw.write({ ...s, passkeys, sessions: [], people, peopleStamp: stampOf(passkeys.map((p) => p.id)) });
    const before = gw.state();
    refused(await b.finish('stub', { purpose: 'add', state: st.json.state, key: 'k11' }), 409, T.changed, 'add across a transfer');
    assert.deepEqual(gw.state(), before, 'nothing written');
  } finally { await gw.close(); }
});

test('org-access A17: the owner\'s add spanning a transfer, their session kept, is refused', async () => {
  const { gw, owner, ana } = await setup('c11b');
  try {
    const st = await owner.start('stub', { purpose: 'add' });
    ok(st, 'the owner\'s add start');
    // the transfer with the old owner's top-level sessions left where they are: a top-level session
    // is now the new owner's, so only the person's id tells the add it is someone else's
    const s = gw.state();
    const toTop = (m) => ({ id: m.key, userId: m.data.userId, jwk: m.data.jwk, alg: m.data.alg, signCount: m.data.signCount, name: m.label, rp: m.data.rp, createdAt: m.added_at });
    const anaRow = s.people.find((p) => p.id === ana.id);
    const passkeys = anaRow.methods.filter((m) => m.type === 'passkey').map(toTop);
    const people = s.people.map((p) => (p.role === 'owner' ? { ...p, role: 'admin', rev: p.rev + 1 }
      : p.id === ana.id ? { ...p, role: 'owner', methods: p.methods.filter((m) => m.type !== 'passkey'), rev: p.rev + 1 } : p));
    gw.write({ ...s, passkeys, people, peopleStamp: stampOf(passkeys.map((p) => p.id)) });
    const before = gw.state();
    refused(await owner.finish('stub', { purpose: 'add', state: st.json.state, key: 'k11b' }), 409, T.changed, 'the old owner\'s add, finished after the transfer');
    assert.deepEqual(gw.state(), before, 'nothing written, to Ana\'s row least of all');
  } finally { await gw.close(); }
});

test('org-access A17: one invite adds one method', async () => {
  const { gw, ana } = await setup('c12');
  try {
    const token = seedInvite(gw, ana.id);
    const b = browser(gw);
    const one = await b.start('stub', { purpose: 'invite', token });
    ok(one, 'first start');
    const two = await b.start('stub', { purpose: 'invite', token });
    ok(two, 'second start, same token');
    assert.equal(pairsIn(b.jar.flow).length, 2);
    ok(await b.finish('stub', { purpose: 'invite', state: one.json.state, key: 'i1' }), 'first finish');
    const before = gw.state();
    refused(await b.finish('stub', { purpose: 'invite', state: two.json.state, key: 'i2' }), 403, T.invite, 'second finish');
    assert.deepEqual(gw.state(), before, 'nothing written');
    assert.equal(rowOf(gw, ana.id).methods.filter((m) => m.type === 'stub').length, 1, 'one new method');
    refused(await browser(gw).start('stub', { purpose: 'invite', token }), 403, T.invite, 'a start after the invite was used');
  } finally { await gw.close(); }
});

test('org-access A17: no change to the state\'s shape', async () => {
  const { gw, owner, ana, anaKey } = await setup('c13');
  try {
    const inv1 = seedInvite(gw, ana.id);
    const inv2 = seedInvite(gw, ana.id);
    const top = Object.keys(gw.state()).sort();
    // check 1's flows: an invite, a stub sign-in, a passkey sign-in
    const a = browser(gw);
    const ist = await a.start('stub', { purpose: 'invite', token: inv1 });
    ok(ist, 'invite start');
    ok(await a.finish('stub', { purpose: 'invite', state: ist.json.state, key: 'k1' }), 'invite finish');
    const c = browser(gw);
    const sst = await c.start('stub', { purpose: 'sign-in' });
    ok(sst, 'stub sign-in start');
    ok(await c.finish('stub', { purpose: 'sign-in', state: sst.json.state, key: 'k1' }), 'stub sign-in finish');
    const d = browser(gw);
    const lo = await d.post('/auth/login/options', {});
    ok(lo, 'login options');
    ok(await d.post('/auth/login/verify', anaKey.get(lo.json, gw.publicUrl)), 'login verify');
    // check 2's: Ana's add, the owner's add and sign-in
    const ast = await a.start('stub', { purpose: 'add' });
    ok(ast, 'Ana add start');
    ok(await a.finish('stub', { purpose: 'add', state: ast.json.state, key: 'k2' }), 'Ana add finish');
    const ost = await owner.start('stub', { purpose: 'add' });
    ok(ost, 'owner add start');
    ok(await owner.finish('stub', { purpose: 'add', state: ost.json.state, key: 'ko' }), 'owner add finish');
    const e = browser(gw);
    const osi = await e.start('stub', { purpose: 'sign-in' });
    ok(osi, 'owner stub sign-in start');
    ok(await e.finish('stub', { purpose: 'sign-in', state: osi.json.state, key: 'ko' }), 'owner stub sign-in finish');
    // check 12's: two starts of one invite, both finished
    const f = browser(gw);
    const i1 = await f.start('stub', { purpose: 'invite', token: inv2 });
    ok(i1, 'invite 2 start 1');
    const i2 = await f.start('stub', { purpose: 'invite', token: inv2 });
    ok(i2, 'invite 2 start 2');
    ok(await f.finish('stub', { purpose: 'invite', state: i1.json.state, key: 'i1' }), 'invite 2 finish 1');
    refused(await f.finish('stub', { purpose: 'invite', state: i2.json.state, key: 'i2' }), 403, T.invite, 'invite 2 finish 2');
    // the owner's passkey, added and signed in with through /auth/method/passkey/*
    const ok2 = authenticator();
    const pst = await owner.start('passkey', { purpose: 'add' });
    ok(pst, 'owner passkey add start');
    ok(await owner.finish('passkey', { purpose: 'add', ...ok2.create(pst.json, gw.publicUrl) }), 'owner passkey add finish');
    const g = browser(gw);
    const psi = await g.start('passkey', { purpose: 'sign-in' });
    ok(psi, 'owner passkey sign-in start');
    ok(await g.finish('passkey', { purpose: 'sign-in', ...ok2.get(psi.json, gw.publicUrl) }), 'owner passkey sign-in finish');
    // the shape
    const s = gw.state();
    assert.deepEqual(Object.keys(s).sort(), top, 'the same top-level keys');
    for (const p of s.people) {
      assert.deepEqual(keysOf(p), sorted(ROW_KEYS), `row ${p.name}`);
      for (const m of p.methods) assert.deepEqual(keysOf(m), sorted(METHOD_KEYS), `method ${m.label}`);
    }
    assert.ok(s.peopleSessions.length > 0);
    for (const x of s.peopleSessions) assert.deepEqual(keysOf(x), sorted(PEOPLE_SESSION_KEYS));
    for (const x of s.sessions) assert.deepEqual(keysOf(x), sorted(SESSION_KEYS));
    assert.equal(s.passkeys.length, 2);
    for (const p of s.passkeys) assert.deepEqual(keysOf(p), sorted(p.usedAt === undefined ? PASSKEY_KEYS : [...PASSKEY_KEYS, 'usedAt']), `passkey ${p.name}`);
    assert.ok(s.passkeys.find((p) => p.id === u(ok2.id))?.usedAt, 'the new passkey was used, top-level');
  } finally { await gw.close(); }
});

test('org-access A17: a provider claim alone links nobody', async () => {
  const { gw } = await setup('c14');
  try {
    const b = browser(gw);
    const st = await b.start('stub', { purpose: 'sign-in' });
    ok(st, 'sign-in start');
    const before = gw.state();
    const r = await b.finish('stub', { purpose: 'sign-in', state: st.json.state, key: 'nobody', email: 'Ana' });
    refused(r, 403, T.nobody, 'a key nobody holds, Ana\'s name as email');
    assert.equal(sessionCookieOf(r), null, 'no session');
    assert.deepEqual(gw.state(), before, 'no session, no method');
  } finally { await gw.close(); }
});

test('org-access A17: a redirect type finishes by GET, and next stays on the box', async () => {
  const { gw, ana } = await setup('c15', { methods: [stubMethod('k1')] });
  try {
    const next = `${gw.inst(INSTANCE)}/some/page?x=1`;
    const b = browser(gw);
    const st = await b.start('stub', { purpose: 'sign-in' });
    ok(st, 'sign-in start');
    const r = await b.req('GET', `/auth/method/stub/finish?${new URLSearchParams({ state: st.json.state, key: 'k1', next })}`);
    assert.equal(r.status, 302, r.body);
    assert.equal(r.headers.location, next);
    assert.ok(r.cookies[0]?.startsWith('devteam_session='), 'a session, its cookie first');
    const w = sessionIn(gw, r.cookies[0].split(';')[0]);
    assert.equal(w?.entry.person, ana.id, 'for its holder');
    const c = browser(gw);
    const st2 = await c.start('stub', { purpose: 'sign-in' });
    ok(st2, 'sign-in start 2');
    const r2 = await c.req('GET', `/auth/method/stub/finish?${new URLSearchParams({ state: st2.json.state, key: 'k1', next: 'https://evil.example/' })}`);
    assert.equal(r2.status, 302, r2.body);
    assert.equal(r2.headers.location, `${gw.publicUrl}/`, 'off the box is the box\'s /');
    const p = await browser(gw).req('GET', '/auth/method/passkey/finish');
    assert.equal(p.status, 405, 'the passkey row doesn\'t finish by GET');
  } finally { await gw.close(); }
});

test('org-access A17: the table\'s seam: no replacing the passkey row, no bad names, 404 for an unknown type', async () => {
  const build = async (methodTypes) => {
    const tag = `c16-${++made}`;
    const uploadsDir = path.join(tmp, `${tag}-uploads`);
    fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o750 });
    const ttydPage = path.join(tmp, `${tag}-ttyd.html`);
    fs.writeFileSync(ttydPage, 'ttyd');
    let g;
    try { g = G.createGateway({ publicUrl: `http://box.localhost:${await freePort()}`, dir: path.join(tmp, tag), ttydPort: await freePort(), ttydPage, uploadsDir, hubPage: HUB_PAGE, log: () => {}, methodTypes }); } catch (e) { return e; }
    g.server.close();
    return null;
  };
  assert.ok(await build({ passkey: stub }) instanceof Error, 'methodTypes { passkey } throws');
  assert.ok(await build({ 'Bad Name': stub }) instanceof Error, 'a bad name throws');
  assert.equal(await build({ stub }), null, 'a good name builds');
  const { gw } = await setup('c16');
  try {
    const r = await browser(gw).start('nosuch', { purpose: 'sign-in' });
    assert.equal(r.status, 404, r.body);
  } finally { await gw.close(); }
});
