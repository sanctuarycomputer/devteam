// Invite links (cloud/gateway.mjs and devteam.mjs, kit-248): the owner makes an invite with a name
// and a level and gets a link once; the person it names opens it, makes a passkey and is signed in;
// a new link (relink) adds a sign-in method to someone who already joined, keeps their others, and
// leaves a notice they see at their next sign-in and in GET /auth/method/list. No sign-in path but
// a passkey. A claim link pasted into a thread turn, an answer or a pane answer has its token
// replaced before the log, threads.jsonl or a pane. Tests for the org-access goal's measure are
// named 'org-access A<n>: …'; the ones named 'kit-248: …' are this ticket's own (the pre-View
// refusal goes when kit-250 lands). People, invites and sessions are seeded by writing the state
// file (the store re-reads a replaced file), as test/org-access.methods.test.mjs does.
// Run: node --test test/org-access.invites.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
// the suite's shared env scrub and tmux shim, and this process's block of ports: the gateway's hub
// is PORTS, its instances PORTS + 1 … PORTS + 25
import { PORTS, threadsFixture, hasTmux, until } from './lib/kit.mjs';
// a box's operator store, its gateway key and a signed press (as test/operator-threads.*.test.mjs)
import { machine } from './lib/operator-threads-fixture.mjs';
import { gatewaySource } from './lib/gateway-source.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const HUB_PAGE = path.join(repo, 'docs', 'devteam', 'dashboard', 'hub.html');
delete process.env.DEVTEAM_CLAIM_TOKEN;
const G = await import(pathToFileURL(path.join(repo, 'cloud', 'gateway.mjs')).href);
const HUB = PORTS;
const INSTANCE = PORTS + 1;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-invites-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

const sha = (b) => crypto.createHash('sha256').update(b).digest();
const u = (b) => Buffer.from(b).toString('base64url');
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const rid = (prefix) => prefix + Array.from(crypto.randomBytes(12), (x) => B32[x & 31]).join('');
const DAY = 24 * 3600 * 1000;

// The texts the spec names, verbatim.
const T = {
  gone: 'This invite has expired or was used; ask for a new one.',
  stale: 'This changed since you opened it; reload',
  noticeWords: 'was added to your account',
};

// --- a software authenticator, as test/org-access.methods.test.mjs's ------------------------------
function cbor(v) {
  const head = (mt, n) => (n < 24 ? Buffer.from([(mt << 5) | n]) : n < 256 ? Buffer.from([(mt << 5) | 24, n]) : Buffer.from([(mt << 5) | 25, n >> 8, n & 255]));
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
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
    create(opts, origin) {
      this.userHandle = opts.user.id;
      const cd = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: opts.challenge, origin }));
      const len = Buffer.alloc(2); len.writeUInt16BE(id.length);
      const ad = Buffer.concat([sha(opts.rp.id), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, id, cbor(cose)]);
      return { rawId: u(id), clientDataJSON: u(cd), attestationObject: u(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]))) };
    },
    get(opts, origin) {
      const cd = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: opts.challenge, origin }));
      const c = Buffer.alloc(4); c.writeUInt32BE(++count);
      const ad = Buffer.concat([sha(opts.rpId), Buffer.from([0x05]), c]);
      const sig = crypto.sign('sha256', Buffer.concat([ad, sha(cd)]), privateKey);
      return { rawId: u(id), clientDataJSON: u(cd), authenticatorData: u(ad), signature: u(sig), userHandle: this.userHandle ?? null };
    },
    method(label = 'passkey 1') {
      this.userHandle ??= u(crypto.randomBytes(16));
      return { id: rid('m-'), type: 'passkey', key: u(id), label, added_at: new Date().toISOString(), last_used: null, data: { userId: this.userHandle, jwk, alg: -7, signCount: 0, rp: 'box.localhost' } };
    },
  };
}

// --- a gateway on a free port, and a browser's requests to it -------------------------------------
const freePort = () => new Promise((resolve, reject) => { const v = net.createServer(); v.on('error', reject); v.listen(0, '127.0.0.1', () => { const { port } = v.address(); v.close(() => resolve(port)); }); });
let made = 0;
async function gateway(name, opts = {}) {
  const tag = `${name}-${++made}`;
  const port = await freePort();
  const publicUrl = `http://box.localhost:${port}`;
  const host = new URL(publicUrl).host;
  const ttydPage = path.join(tmp, `${tag}-ttyd.html`);
  fs.writeFileSync(ttydPage, 'ttyd');
  const uploadsDir = path.join(tmp, `${tag}-uploads`);
  fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o750 });
  const logs = [];
  const dir = path.join(tmp, tag);
  const g = G.createGateway({ publicUrl, dir, ttydPort: await freePort(), ttydPage, uploadsDir, hubPage: HUB_PAGE, log: (m) => logs.push(m), ...opts });
  await new Promise((r) => g.server.listen(port, '127.0.0.1', r));
  const token = /claim#([\w-]+)/.exec(logs.join('\n'))?.[1];
  const file = path.join(dir, 'state.json');
  const state = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const write = (s) => { const t = `${file}.test.tmp`; fs.writeFileSync(t, JSON.stringify(s, null, 2), { mode: 0o600 }); fs.renameSync(t, file); };
  const raw = (method, route, { body, cookie = '', headers = {}, on = null } = {}) => new Promise((resolve, reject) => {
    const h = { host: on ? `${on}.${host}` : host, ...(method !== 'GET' ? { origin: on ? `http://${on}.${host}` : publicUrl, 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers };
    const r = http.request({ host: '127.0.0.1', port, method, path: route, headers: h }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, headers: res.headers, cookies: res.headers['set-cookie'] ?? [], body: b, json: j }); });
    });
    r.on('error', reject);
    r.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  });
  return { g, port, publicUrl, host, logs, token, dir, file, state, write, raw, close: () => new Promise((r) => { g.server.closeAllConnections?.(); g.server.close(r); }) };
}

const FLOW_NAME = /^(__Host-)?devteam_flow=/;
const sessionCookieOf = (r) => r.cookies.find((c) => c.startsWith('devteam_session=') && !/Max-Age=0/i.test(c)) ?? null;
const hashOf = (pair) => u(sha(Buffer.from(pair.slice(pair.indexOf('=') + 1), 'base64url')));
function browser(gw, { session = null } = {}) {
  const jar = { session, flow: null };
  const req = async (method, route, { body, headers, on } = {}) => {
    const r = await gw.raw(method, route, { body, headers, on, cookie: [jar.session, jar.flow].filter(Boolean).join('; ') });
    for (const c of r.cookies) {
      const pair = c.split(';')[0];
      const gone = /;\s*Max-Age=0\s*(;|$)/i.test(c);
      if (c.startsWith('devteam_session=')) jar.session = gone ? null : pair;
      else if (FLOW_NAME.test(c)) jar.flow = gone ? null : pair;
    }
    return r;
  };
  return { jar, req, post: (route, body, o = {}) => req('POST', route, { body, ...o }) };
}
const ok = (r, what) => assert.equal(r.status, 200, `${what}: ${r.status} ${r.body}`);
// a People route's refusal: the shared body { error, code } (kit-249's route contract)
const refusedAs = (r, status, code, what) => {
  assert.equal(r.status, status, `${what}: ${r.status} ${r.body}`);
  assert.equal(r.json?.code, code, `${what}: code (${r.body})`);
  assert.equal(typeof r.json?.error, 'string', `${what}: a sentence`);
};

async function claim(gw) {
  const owner = browser(gw);
  const key = authenticator();
  const o = await owner.post('/auth/claim/options', { token: gw.token });
  ok(o, 'claim options');
  ok(await owner.post('/auth/claim/verify', { token: gw.token, ...key.create(o.json, gw.publicUrl) }), 'claim verify');
  return { owner, ownerKey: key };
}
function seed(gw, people) {
  const s = gw.state();
  const rows = people.map(({ name, role = 'member', level = 'full', methods = [] }) => ({ id: rid('p-'), name, role, level, methods, pushSubs: [], added_at: new Date().toISOString(), last_seen: null, notices: [], rev: 1 }));
  gw.write({ ...s, people: [...s.people, ...rows] });
  return rows;
}
function mintSession(gw, personId, methodId, { at = Date.now() } = {}) {
  const tok = crypto.randomBytes(32);
  const s = gw.state();
  gw.write({ ...s, peopleSessions: [...(s.peopleSessions ?? []), { hash: u(sha(tok)), person: personId, method: methodId, at, expires: at + 3600e3 }] });
  return `devteam_session=${u(tok)}`;
}
// the owner's session, signed in `ago` ms ago (not fresh past five minutes)
function ageOwner(gw, owner, ago) {
  const h = hashOf(owner.jar.session);
  const s = gw.state();
  gw.write({ ...s, sessions: s.sessions.map((x) => (x.hash === h ? { ...x, at: Date.now() - ago } : x)) });
}
const rowOf = (gw, id) => gw.state().people.find((p) => p.id === id);
const tokenOf = (link) => decodeURIComponent(new URL(link).hash.slice(1));
// A claimed box with Ana on it (member, full, one passkey).
async function setup(name) {
  const gw = await gateway(name);
  const { owner, ownerKey } = await claim(gw);
  const anaKey = authenticator();
  const [ana] = seed(gw, [{ name: 'Ana', methods: [anaKey.method()] }]);
  return { gw, owner, ownerKey, ana, anaKey };
}
// The invite page's flow, as its script runs it: the passkey row's start and finish, purpose invite.
async function join(gw, link, key = authenticator(), name = 'laptop') {
  const b = browser(gw);
  const st = await b.post('/auth/method/passkey/start', { purpose: 'invite', token: tokenOf(link) });
  if (st.status !== 200) return { b, st, fin: null, key };
  const fin = await b.post('/auth/method/passkey/finish', { purpose: 'invite', name, ...key.create(st.json, gw.publicUrl) });
  return { b, st, fin, key };
}
async function signIn(gw, key) {
  const b = browser(gw);
  const o = await b.post('/auth/login/options', {});
  ok(o, 'login options');
  const v = await b.post('/auth/login/verify', key.get(o.json, gw.publicUrl));
  return { b, v };
}

// --- A2: the invite --------------------------------------------------------------------------------

test('org-access A2: the owner makes an invite: a link shown once, only its hash kept, for 24 hours, a Full member row', async () => {
  const { gw, owner } = await setup('make');
  try {
    const before = Date.now();
    const r = await owner.post('/auth/people/invite', { name: 'Bea', level: 'full' });
    ok(r, 'invite');
    assert.match(r.json.link, new RegExp(`^${gw.publicUrl}/auth/claim#[A-Za-z0-9_-]{43}$`), 'the link is the box\'s claim page with a token');
    const tok = tokenOf(r.json.link);
    const s = gw.state();
    const bea = s.people.find((p) => p.name === 'Bea');
    assert.ok(bea, 'Bea has a row');
    assert.deepEqual({ role: bea.role, level: bea.level, methods: bea.methods, rev: bea.rev }, { role: 'member', level: 'full', methods: [], rev: 1 });
    assert.deepEqual(r.json.person, { id: bea.id, rev: 1 });
    assert.equal(s.invites.length, 1);
    assert.deepEqual(Object.keys(s.invites[0]).sort(), ['expires', 'hash', 'person']);
    assert.equal(s.invites[0].hash, u(sha(tok)), 'the hash as kit-254 reads it');
    assert.equal(s.invites[0].person, bea.id);
    assert.equal(r.json.expires, s.invites[0].expires);
    assert.ok(s.invites[0].expires >= before + DAY && s.invites[0].expires <= Date.now() + DAY, 'expires in 24 hours, epoch ms');
    assert.ok(!fs.readFileSync(gw.file, 'utf8').includes(tok), 'the token is nowhere in the state');
    assert.ok(!gw.logs.join('\n').includes(tok), 'nor in the gateway\'s log');
    // a second invite makes a second person and link, never the first's again
    const r2 = await owner.post('/auth/people/invite', { name: 'Cy' });
    ok(r2, 'a level left out is Full');
    assert.notEqual(tokenOf(r2.json.link), tok);
    assert.equal(rowOf(gw, r2.json.person.id).level, 'full');
  } finally { await gw.close(); }
});

// An invite as the gateway writes one (people@1: hash = b64u(sha256(token)), expires epoch ms), for
// the claim path's checks, so each stands apart from the route that makes the link.
function seedInvite(gw, personId, { expires = Date.now() + DAY } = {}) {
  const token = u(crypto.randomBytes(32));
  const s = gw.state();
  gw.write({ ...s, invites: [...(s.invites ?? []), { hash: u(sha(token)), person: personId, expires }] });
  return `${gw.publicUrl}/auth/claim#${token}`;
}

test('org-access A2: on a claimed box the claim link opens the invite page, which reads whose invite it is', async () => {
  const { gw } = await setup('page');
  try {
    const [bea] = seed(gw, [{ name: 'Bea' }]);
    const link = seedInvite(gw, bea.id);
    const page = await gw.raw('GET', '/auth/claim');
    assert.equal(page.status, 200, `the invite page, not the sign-in: ${page.status} ${page.headers.location ?? ''}`);
    assert.match(page.body, /Join this devteam box/);
    assert.equal(sessionCookieOf(page), null);
    const peek = await gw.raw('POST', '/auth/claim/invite', { body: { token: tokenOf(link) } });
    ok(peek, 'what the page shows before the passkey');
    assert.deepEqual({ name: peek.json.name, level: peek.json.level, again: peek.json.again, expires: peek.json.expires }, { name: 'Bea', level: 'full', again: false, expires: gw.state().invites[0].expires });
    assert.equal(sessionCookieOf(peek), null);
    for (const token of [u(crypto.randomBytes(32)), '', 7]) {
      const dead = await gw.raw('POST', '/auth/claim/invite', { body: { token } });
      assert.deepEqual([dead.status, dead.json], [403, { error: T.gone }], `a dead token (${JSON.stringify(token).slice(0, 12)}) is refused alike`);
    }
  } finally { await gw.close(); }
});

test('org-access A2: the invite link adds a passkey for that person only and signs them in at its level', async () => {
  const { gw, ana } = await setup('claim');
  try {
    const [bea] = seed(gw, [{ name: 'Bea' }]);
    const link = seedInvite(gw, bea.id);
    const ownerBefore = gw.state().passkeys;
    const { b, fin, key } = await join(gw, link);
    ok(fin, 'invite finish');
    const sc = sessionCookieOf(fin);
    assert.ok(sc, 'the invite signed Bea in');
    const s = gw.state();
    assert.deepEqual(s.people.find((p) => p.id === bea.id).methods.map((m) => [m.type, m.key]), [['passkey', u(key.id)]], 'Bea holds the passkey');
    assert.deepEqual(s.people.find((p) => p.id === ana.id).methods, ana.methods, 'Ana is as she was');
    assert.deepEqual(s.passkeys, ownerBefore, 'the owner\'s passkeys are as they were');
    assert.equal(s.people.find((p) => p.role === 'owner').methods.length, 0, 'nothing in the owner\'s row');
    const entry = s.peopleSessions.find((x) => x.hash === hashOf(sc.split(';')[0]));
    assert.equal(entry?.person, bea.id, 'the session is Bea\'s');
    assert.equal(s.people.find((p) => p.id === bea.id).level, 'full', 'at the invite\'s level');
    assert.equal(s.sessions.some((x) => x.hash === entry.hash), false, 'not a top-level (owner) session');
    ok(await b.req('GET', '/'), 'Bea opens the hub');
    const { v } = await signIn(gw, key);
    ok(v, 'Bea signs in later with it');
    assert.equal(gw.state().peopleSessions.find((x) => x.hash === hashOf(sessionCookieOf(v).split(';')[0]))?.person, bea.id);
  } finally { await gw.close(); }
});

test('org-access A2: an invite link works once', async () => {
  const { gw } = await setup('once');
  try {
    const [bea] = seed(gw, [{ name: 'Bea' }]);
    const link = seedInvite(gw, bea.id);
    ok((await join(gw, link)).fin, 'the first use');
    const second = await join(gw, link);
    assert.equal(second.st.status, 403, 'the second use is refused');
    assert.deepEqual(second.st.json, { error: T.gone });
    assert.equal(rowOf(gw, bea.id).methods.length, 1, 'one link, one method');
  } finally { await gw.close(); }
});

test('org-access A2: an invite link expires after 24 hours', async () => {
  const { gw } = await setup('expiry');
  try {
    const [bea] = seed(gw, [{ name: 'Bea' }]);
    const link = seedInvite(gw, bea.id, { expires: Date.now() - 1 });
    const late = await join(gw, link);
    assert.equal(late.st.status, 403, 'a day later the link does nothing');
    assert.deepEqual(late.st.json, { error: T.gone });
    assert.equal(rowOf(gw, bea.id).methods.length, 0);
  } finally { await gw.close(); }
});

test('org-access A2: only the owner, signed in within five minutes, makes an invite, with a name that is theirs alone', async () => {
  const { gw, owner, ana } = await setup('who');
  try {
    const before = JSON.stringify(gw.state());
    assert.equal((await gw.raw('POST', '/auth/people/invite', { body: { name: 'Bea' } })).status, 401, 'signed out');
    const anaB = browser(gw, { session: mintSession(gw, ana.id, ana.methods[0].id) });
    const mid = JSON.stringify(gw.state());
    refusedAs(await anaB.post('/auth/people/invite', { name: 'Bea' }), 403, 'not-allowed', 'a Full member');
    for (const [body, code, what] of [
      [{ name: '' }, 'bad-name', 'an empty name'],
      [{ name: '   ' }, 'bad-name', 'a blank name'],
      [{ name: 'x'.repeat(61) }, 'bad-name', 'over 60 characters'],
      [{ name: 'two\nlines' }, 'bad-name', 'two lines'],
      [{ name: 'Ana\u202egnp.exe' }, 'bad-name', 'a bidi control'],
      [{ name: 7 }, 'bad-name', 'not a string'],
      [{ name: 'ana' }, 'name-taken', 'Ana\'s name, another case'],
      [{ name: 'OWNER' }, 'name-taken', 'the owner\'s row\'s name'],
    ]) refusedAs(await owner.post('/auth/people/invite', body), 400, code, what);
    refusedAs(await owner.post('/auth/people/invite', [1]), 400, 'bad-request', 'a body that isn\'t an object');
    assert.equal(JSON.stringify(gw.state()), mid, 'none of those wrote anything');
    ageOwner(gw, owner, 6 * 60 * 1000);
    refusedAs(await owner.post('/auth/people/invite', { name: 'Bea' }), 403, 'fresh-sign-in', 'the owner, signed in six minutes ago');
    assert.equal(gw.state().people.some((p) => p.name === 'Bea'), false);
    assert.ok(before);
  } finally { await gw.close(); }
});

// The owner's operator threads: the gateway signs each press, and the signed body is what the hub
// keeps in threads.jsonl, so the token goes before the gateway signs it.
test('org-access A2: a claim link in an operator thread turn has its token replaced before the gateway signs and sends it', async () => {
  const gw = await gateway('operator');
  const seen = [];
  const hub = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { seen.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
  });
  await until(() => new Promise((r) => { hub.once('error', () => r(false)); hub.listen(HUB, '127.0.0.1', () => r(true)); }), 'the hub port');
  try {
    const { owner } = await claim(gw);
    const tok = u(crypto.randomBytes(32));
    const link = `${gw.publicUrl}/auth/claim#${tok}`;
    for (const [route, body] of [['/operator/thread-new', { text: `join here: ${link}`, title: `invite ${link}` }], ['/operator/thread-say', { id: 'ot-20261114-101500123-abcdef', text: `again ${link}.` }]]) {
      ok(await owner.post(route, body), route);
      const sent = seen.at(-1);
      const got = JSON.parse(sent.body.toString('utf8'));
      assert.ok(!sent.body.toString('utf8').includes(tok), `${route}: the token never reaches the hub`);
      assert.match(got.text, /\/auth\/claim#…/, `${route}: the link stays, its token replaced`);
      if (got.title) assert.match(got.title, /\/auth\/claim#…/);
      const pub = crypto.createPublicKey(gw.g.threadPublicKey());
      const msg = Buffer.from(`devteam-operator-post-v1\n${sent.url}\n${sent.headers['x-devteam-gateway-ts']}\n${sent.headers['x-devteam-gateway-nonce']}\n${sha(sent.body).toString('hex')}`);
      assert.ok(crypto.verify(null, msg, pub, Buffer.from(sent.headers['x-devteam-gateway-sig'], 'base64url')), `${route}: the signature is over what was sent`);
    }
  } finally { hub.closeAllConnections?.(); await new Promise((r) => hub.close(r)); await gw.close(); }
});

test('org-access A2: a claim link in a thread turn, answer or pane answer has its token replaced before the log, threads.jsonl or a pane', { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = threadsFixture('invites-redact');
  t.after(() => F.done());
  const tok = u(crypto.randomBytes(32));
  const link = `https://box.example.com/auth/claim#${tok}`;
  const logText = () => fs.readdirSync(F.logDir).map((f) => fs.readFileSync(path.join(F.logDir, f), 'utf8')).join('');
  const pane = F.standIn();
  const P = { DEVTEAM_SUPERVISOR: pane.target };
  let thread = null;
  await t.test('a thread turn typed into the supervisor\'s pane', async () => {
    const [id] = F.owner(['thread', 'new', `Bea joins with ${link} today`], P).split('\n');
    thread = id;
    const typed = await until(() => pane.typed().includes('claim#') && pane.typed(), 'the turn in the pane');
    assert.ok(!typed.includes(tok), `the pane never sees the token: ${typed}`);
    assert.match(typed, /\/auth\/claim#… today/);
  });
  await t.test('a thread turn in the log', () => {
    F.owner(['thread', 'say', thread, `or ${link}`], P);
    F.owner(['thread', 'say', thread, `forms: https://box.example.com/auth/claim?x=1#${tok}, /auth/claim%23${tok} https%3A%2F%2Fbox.example.com%2Fauth%2Fclaim%23${tok} (${link}).`], P);
    const show = JSON.parse(F.owner(['thread', 'show', thread, '--json']));
    assert.deepEqual(show.turns.map((x) => x.text), ['Bea joins with https://box.example.com/auth/claim#… today', 'or https://box.example.com/auth/claim#…', 'forms: https://box.example.com/auth/claim?x=1#… /auth/claim%23… https%3A%2F%2Fbox.example.com%2Fauth%2Fclaim%23… (https://box.example.com/auth/claim#…).'], 'each turn as the log keeps it');
    assert.equal(show.title, 'Bea joins with https://box.example.com/auth/claim#… today', 'and the title made of it');
  });
  await t.test('an answer in the log', () => {
    const q = F.sup(['ask', '--question', 'Who joins?']).split('\n')[0];
    F.owner(['answer', q, `Bea, at ${link}`]);
    const line = logText().split('\n').find((l) => l.includes(q) && l.includes('Bea, at'));
    assert.ok(line, 'the answer is logged');
    assert.ok(!line.includes(tok), `the answer never keeps the token: ${line}`);
    assert.match(line, /Bea, at https:\/\/box\.example\.com\/auth\/claim#…/);
  });
  await t.test('a pane answer in the log', () => {
    fs.mkdirSync(F.home, { recursive: true });
    const pa = F.run(F.old, ['pane', 'answered', '--owner'], { HOME: F.home }, JSON.stringify({ digest: 'a'.repeat(40), option: 1, label: `Open ${link}`, first: `Join at ${link}?`, keys: '1', taken: false, why: 'a test' }));
    assert.equal(pa.status, 0, pa.err);
    const line = logText().split('\n').find((l) => l.includes('"class":"pane-answer"'));
    assert.ok(line, 'the pane answer is logged');
    assert.ok(!line.includes(tok), `the pane answer never keeps the token: ${line}`);
    assert.match(line, /Join at https:\/\/box\.example\.com\/auth\/claim#…/);
  });
  await t.test('nothing in the log keeps it', () => assert.ok(!logText().includes(tok), 'the token is nowhere in the log'));
  await t.test('the owner\'s thread with the operator, on a laptop: threads.jsonl', () => {
    const home = path.join(F.base, 'ophome');
    fs.mkdirSync(home, { recursive: true });
    F.run(F.old, ['operator-thread', 'new', `see ${link}`], { HOME: home, DEVTEAM_ROLE: '' });
    const find = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? find(path.join(d, e.name)) : e.name === 'threads.jsonl' ? [path.join(d, e.name)] : []));
    const [store] = find(home);
    assert.ok(store, 'the operator\'s store was written');
    const kept = fs.readFileSync(store, 'utf8');
    assert.ok(!kept.includes(tok), `threads.jsonl never holds the token: ${kept}`);
    assert.match(kept, /see https:\/\/box\.example\.com\/auth\/claim#…/);
  });
});

// The supervisor's browser view is a preview the hub labels "Supervisor's browser": whoever opens it
// drives the owner's signed-in browser, so only the owner may (kit-66 spec S1-8).
test('kit-248: the supervisor\'s browser view opens for the owner only', async () => {
  const dev = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('the view'); });
  const DEV = await freePort();
  const DEV2 = await freePort();
  await new Promise((r) => dev.listen(DEV, '127.0.0.1', r));
  const dev2 = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('an app'); });
  await new Promise((r) => dev2.listen(DEV2, '127.0.0.1', r));
  const list = { hub: 1, instances: [{ devteam: 1, name: 'alpha', root: '/srv/alpha', port: INSTANCE, viewer: 1, previews: [
    { name: 'cool-tiger', port: DEV, project: 'alpha', session: 'supervisor', label: "Supervisor's browser" },
    { name: 'calm-otter', port: DEV2, project: 'alpha', session: 'alpha-01', label: 'checkout' },
    { name: 'sly-fox', port: DEV, project: 'alpha', session: 'alpha-02', label: 'mine' },
  ] }] };
  // then a second instance lists the browser's own name, which makes that name no one's and its row
  // label-less (previewLinks): the twin on the browser's port must stay the owner's
  const collide = { devteam: 1, name: 'beta', root: '/srv/beta', port: INSTANCE + 1, viewer: 1, previews: [{ name: 'cool-tiger', port: DEV2 + 1, project: 'beta', session: 'beta-01', label: 'other' }] };
  const hub = http.createServer((req, res) => { req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(list)); });
  await until(() => new Promise((r) => { hub.once('error', () => r(false)); hub.listen(HUB, '127.0.0.1', () => r(true)); }), 'the hub port');
  const { gw, owner, ana } = await setup('browser-view');
  try {
    const anaB = browser(gw, { session: mintSession(gw, ana.id, ana.methods[0].id) });
    const page = await anaB.req('GET', '/', { on: 'cool-tiger' });
    assert.equal(page.status, 403, `Ana is refused the view: ${page.status} ${page.body}`);
    assert.doesNotMatch(page.body, /the view/);
    const twin = await anaB.req('GET', '/', { on: 'sly-fox' });
    assert.equal(twin.status, 403, `nor under another name on its port: ${twin.status} ${twin.body}`);
    assert.equal(page.body, 'Only the box\'s owner can open the supervisor\'s browser.', 'the refusal says why');
    const app = await anaB.req('GET', '/', { on: 'calm-otter' });
    assert.equal(app.body, 'an app', 'another preview opens for Ana');
    const mine = await owner.req('GET', '/', { on: 'cool-tiger' });
    assert.equal(mine.body, 'the view', 'the owner opens it');
    const shake = (cookie, name = 'cool-tiger') => new Promise((resolve, reject) => {
      const c = net.connect(gw.port, '127.0.0.1');
      let got = '';
      c.on('data', (d) => { got += d; c.end(); });
      c.on('error', reject);
      c.on('close', () => resolve(got.split('\r\n')[0]));
      c.write(['GET /ws HTTP/1.1', `Host: ${name}.${gw.host}`, `Origin: http://${name}.${gw.host}`, `Cookie: ${cookie}`, 'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', '', ''].join('\r\n'));
    });
    assert.match(await shake(anaB.jar.session), /^HTTP\/1\.1 403/, 'and its socket');
    assert.match(await shake(anaB.jar.session, 'sly-fox'), /^HTTP\/1\.1 403/, 'and the twin name\'s socket');
    assert.doesNotMatch(await shake(owner.jar.session), /^HTTP\/1\.1 40[13]/, 'the owner\'s socket is not refused');
    assert.match(await shake(''), /^HTTP\/1\.1 401/, 'no session is still 401, before who');
    // the collision
    list.instances.push(collide);
    // a name not listed makes the gateway read the list again
    await anaB.req('GET', '/', { on: 'zz-not-listed' });
    assert.equal((await owner.req('GET', '/', { on: 'cool-tiger' })).status === 200, false, 'cool-tiger is no one\'s now');
    const twin2 = await anaB.req('GET', '/', { on: 'sly-fox' });
    assert.equal(twin2.status, 403, `the twin stays the owner's when another instance lists the browser's name: ${twin2.status} ${twin2.body}`);
    assert.match(await shake(anaB.jar.session, 'sly-fox'), /^HTTP\/1\.1 403/, 'and its socket');
  } finally {
    await gw.close();
    for (const s of [hub, dev, dev2]) { s.closeAllConnections?.(); await new Promise((r) => s.close(r)); }
  }
});

test('org-access A2: an invite on a box whose state predates people is stamped, so the next start keeps it', async () => {
  const { gw, owner } = await setup('pre-people');
  try {
    const s = gw.state();
    delete s.people; delete s.peopleStamp; delete s.peopleSessions; delete s.invites;
    gw.write(s);
    ok(await owner.post('/auth/people/invite', { name: 'Bea' }), 'the stand-in owner invites');
    const t = gw.state();
    assert.equal(t.people.filter((p) => p.role === 'owner').length, 1, 'the owner\'s row is written with it');
    assert.equal(typeof t.peopleStamp, 'string', 'and the people list is stamped');
    // the next start: the same file, read by a new gateway
    const again = G.createGateway({ publicUrl: gw.publicUrl, dir: gw.dir, ttydPort: await freePort(), ttydPage: path.join(tmp, 'pre-people-ttyd.html'), uploadsDir: fs.mkdtempSync(path.join(tmp, 'pre-people-up-')), hubPage: HUB_PAGE, log: () => {} });
    again.server.close?.();
    assert.equal(gw.state().invites.length, 1, 'the invite survives the next start');
    assert.ok(!(gw.state().people.find((p) => p.role === 'owner').notices ?? []).some((n) => n.kind === 'people-reset'), 'with no reset notice');
  } finally { await gw.close(); }
});

test('org-access A2: invites and people stop at their caps', async () => {
  const { gw, owner, ana } = await setup('caps');
  try {
    const s = gw.state();
    const far = Date.now() + DAY;
    gw.write({ ...s, invites: Array.from({ length: 50 }, () => ({ hash: u(sha(crypto.randomBytes(32))), person: ana.id, expires: far })) });
    refusedAs(await owner.post('/auth/people/invite', { name: 'Bea' }), 409, 'too-many', '50 outstanding invites');
    gw.write({ ...s, invites: [], people: [...s.people, ...Array.from({ length: 198 }, (_, i) => ({ id: rid('p-'), name: `P${i}`, role: 'member', level: 'full', methods: [], pushSubs: [], added_at: new Date().toISOString(), last_seen: null, notices: [], rev: 1 }))] });
    refusedAs(await owner.post('/auth/people/invite', { name: 'Bea' }), 409, 'too-many', '200 people');
  } finally { await gw.close(); }
});

// The gateway's copy of the rule and devteam.mjs's are one rule: a press the gateway redacted is
// kept by the operator's store word for word, so it still reads as the gateway's.
const CLAIM_RULE = /const CLAIM_LINK = (\/.*\/[a-z]*);/;
test('org-access A2: the gateway\'s and devteam.mjs\'s claim-link rules are one, and a press the gateway redacted still reads as signed', async () => {
  const gwRule = CLAIM_RULE.exec(gatewaySource())?.[1];
  const dtRule = CLAIM_RULE.exec(fs.readFileSync(path.join(repo, 'docs', 'devteam', 'scripts', 'devteam.mjs'), 'utf8'))?.[1];
  assert.ok(gwRule, 'the gateway has the rule');
  assert.equal(dtRule, gwRule, 'devteam.mjs has the same rule');
  const tok = u(crypto.randomBytes(32));
  const M = machine({ box: true, starts: false });
  const body = G.redactClaimLinks({ text: `join at https://box.example.com/auth/claim?x=1#${tok}. and /auth/claim%23${tok}`, title: `invite https://box.example.com/auth/claim#${tok}` });
  assert.ok(!JSON.stringify(body).includes(tok));
  const r = M.press('thread-new', body);
  assert.equal(r.status === 0 || r.status === 3, true, r.stderr);
  const [t] = M.list();
  assert.deepEqual(t.turns.map((x) => [x.text, x.signed]), [[body.text.trim(), true]], 'kept word for word, signed');
});

test('org-access A2: an older gateway\'s raw press leaves no token in threads.jsonl, proof included', async () => {
  const tok = u(crypto.randomBytes(32));
  const M = machine({ box: true, starts: false });
  const r = M.press('thread-new', { text: `join at https://box.example.com/auth/claim#${tok}` });
  assert.equal(r.status === 0 || r.status === 3, true, r.stderr);
  const raw = fs.readFileSync(`${M.dir}/threads.jsonl`, 'utf8');
  const bodies = M.store().map((o) => (o.proof?.body ? Buffer.from(o.proof.body, 'base64').toString('utf8') : '')).join('\n');
  assert.ok(!raw.includes(tok), 'no line holds the token');
  assert.ok(!bodies.includes(tok), `no proof body holds it: ${bodies.slice(0, 200)}`);
  assert.deepEqual(M.list()[0].turns.map((x) => x.signed), [false], 'and that turn reads as unsigned');
});

// --- A4: a new link ---------------------------------------------------------------------------------

test('org-access A4: a new link adds a sign-in method to someone who joined and keeps the others', async () => {
  const { gw, owner, ana, anaKey } = await setup('relink');
  try {
    const first = await owner.post('/auth/people/relink', { id: ana.id, rev: 1 });
    ok(first, 'relink');
    assert.deepEqual(Object.keys(first.json).sort(), ['expires', 'link']);
    assert.match(first.json.link, new RegExp(`^${gw.publicUrl}/auth/claim#[A-Za-z0-9_-]{43}$`));
    const r = await owner.post('/auth/people/relink', { id: ana.id, rev: 1 });
    ok(r, 'a second relink replaces the first link');
    assert.equal(gw.state().invites.length, 1, 'one live link per person');
    assert.equal((await gw.raw('POST', '/auth/claim/invite', { body: { token: tokenOf(first.json.link) } })).status, 403, 'the earlier link is dead');
    const peek = await gw.raw('POST', '/auth/claim/invite', { body: { token: tokenOf(r.json.link) } });
    assert.deepEqual({ name: peek.json.name, again: peek.json.again }, { name: 'Ana', again: true });
    const { fin, key: phone } = await join(gw, r.json.link, authenticator(), 'phone');
    ok(fin, 'the new link adds a passkey');
    const row = rowOf(gw, ana.id);
    assert.deepEqual(row.methods.map((m) => m.key), [u(anaKey.id), u(phone.id)], 'the old passkey kept, the new one added');
    assert.equal(row.level, 'full');
    ok((await signIn(gw, anaKey)).v, 'the old passkey still signs in');
  } finally { await gw.close(); }
});

test('org-access A4: the added-method notice comes with the next sign-in, once, and always with GET /auth/method/list', async () => {
  const { gw, ana, anaKey } = await setup('notice');
  try {
    // a new link for Ana, who already has a passkey, as the relink route writes it
    const link = seedInvite(gw, ana.id);
    const { fin: added, key: phone } = await join(gw, link, authenticator(), 'phone');
    ok(added, 'the link adds a passkey');
    const notes = rowOf(gw, ana.id).notices.filter((n) => n.kind === 'method-added');
    assert.equal(notes.length, 1, 'one notice in Ana\'s row');
    assert.deepEqual([notes[0].type, notes[0].label], ['passkey', 'phone']);
    assert.ok(Date.parse(notes[0].at) > Date.now() - 60000);
    // a sign-in with the passkey that link added neither shows nor spends it: whoever holds a leaked
    // link can't use up the warning meant for Ana
    const own = await signIn(gw, phone);
    ok(own.v, 'the new passkey signs in');
    assert.deepEqual(own.v.json, { ok: true }, 'the new method\'s own sign-in shows nothing');
    const one = await signIn(gw, anaKey);
    ok(one.v, 'her next sign-in');
    assert.deepEqual(one.v.json.notices?.map((n) => [n.kind, n.type, n.label, n.at]), [['method-added', 'passkey', 'phone', notes[0].at]], 'shown at the next sign-in');
    const two = await signIn(gw, anaKey);
    ok(two.v, 'and the one after');
    assert.deepEqual(two.v.json, { ok: true }, 'once');
    const list = await two.b.req('GET', '/auth/method/list');
    ok(list, 'method list');
    assert.deepEqual(list.json.notices, [{ kind: 'method-added', at: notes[0].at, type: 'passkey', label: 'phone' }], 'always in her own list');
    assert.equal(list.json.methods.length, 2);
    // a first invite leaves no notice: nothing was added to an account that had none
    const [bea] = seed(gw, [{ name: 'Bea' }]);
    ok((await join(gw, seedInvite(gw, bea.id))).fin, 'Bea joins');
    assert.deepEqual(rowOf(gw, bea.id).notices, [], 'no notice for a first invite');
  } finally { await gw.close(); }
});

// The sign-in page's own scripts, run in a stand-in browser: the sign-in answers with a notice.
function fakePage(html, answer, { refuse = null, hash = '', pathname = '/auth/login' } = {}) {
  const els = new Map();
  const replaced = [];
  const states = [];
  const el = (id = null) => {
    const e = { id, textContent: '', innerHTML: '', value: '', hidden: false, disabled: false, children: [], style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      append(...c) { this.children.push(...c); }, appendChild(c) { this.children.push(c); return c; }, replaceChildren(...c) { this.children = c; }, prepend(...c) { this.children.unshift(...c); }, remove() {}, setAttribute(k, v) { this[k] = v; }, removeAttribute() {}, addEventListener(t, f) { this[`on${t}`] = f; }, querySelector: () => null, querySelectorAll: () => [], focus() {} };
    return e;
  };
  const document = { addEventListener() {}, removeEventListener() {}, getElementById: (id) => { if (!els.has(id)) els.set(id, el(id)); return els.get(id); }, createElement: () => { const e = el(); els.set(Symbol('made'), e); return e; }, createTextNode: (t) => ({ textContent: String(t), children: [] }), querySelector: () => null, querySelectorAll: () => [], body: el('body') };
  const fetch = async (url) => (refuse ? { ok: false, statusText: 'Forbidden', json: async () => refuse } : { ok: true, json: async () => (String(url).includes('options') ? { challenge: 'AAAA', rpId: 'box.localhost', allowCredentials: [] } : answer) });
  const navigator = { credentials: { get: async () => ({ rawId: new Uint8Array([1]).buffer, response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer, userHandle: null } }) } };
  const location = { href: `http://box.localhost${pathname}${hash}`, pathname, hash, search: '', replace: (to) => replaced.push(to), assign: (to) => replaced.push(to) };
  const ctx = vm.createContext({ addEventListener() {}, document, fetch, navigator, location, history: { replaceState: (...a) => states.push(a) }, window: {}, console, atob, btoa, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, setTimeout, clearTimeout, Promise, JSON, Date, encodeURIComponent, decodeURIComponent, confirm: () => true, matchMedia: () => ({ matches: false }) });
  for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(code, ctx);
  // every word on the page: text as text, markup as it would parse
  const words = () => { const all = []; const walk = (e) => { if (!e) return; all.push(e.textContent ?? '', e.innerHTML ?? ''); for (const c of e.children ?? []) walk(c); }; for (const e of els.values()) walk(e); return all.join('\n'); };
  const button = (text) => { let hit = null; const walk = (e) => { if (!e || hit) return; if (typeof e.onclick === 'function' && (e.textContent ?? '').trim() === text) hit = e; for (const c of e.children ?? []) walk(c); }; for (const e of els.values()) walk(e); return hit; };
  return { els, words, button, replaced, states };
}

test('org-access A4: a row keeps its newest 20 added-method notices', async () => {
  const { gw, ana } = await setup('notice-cap');
  try {
    const s = gw.state();
    const old = Array.from({ length: 20 }, (_, i) => ({ kind: 'method-added', at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), type: 'passkey', label: `old ${i}`, method: rid('m-'), shown_at: null }));
    const other = { kind: 'people-reset', at: '2026-01-01T00:00:00.000Z' };
    gw.write({ ...s, people: s.people.map((p) => (p.id === ana.id ? { ...p, notices: [other, ...old] } : p)) });
    ok((await join(gw, seedInvite(gw, ana.id), authenticator(), 'newest')).fin, 'a 21st method');
    const kept = rowOf(gw, ana.id).notices;
    const added = kept.filter((n) => n.kind === 'method-added');
    assert.equal(added.length, 20, 'twenty kept');
    assert.deepEqual([added[0].label, added.at(-1).label], ['old 1', 'newest'], 'the oldest one goes');
    assert.ok(kept.some((n) => n.kind === 'people-reset'), 'a notice of another kind stays');
  } finally { await gw.close(); }
});

test('org-access A4: the sign-in page shows the added-method notice it is given, as text, before going on', async () => {
  const gw = await gateway('notice-words');
  try {
    await claim(gw);
    const login = await gw.raw('GET', '/auth/login?next=' + encodeURIComponent(`${gw.publicUrl}/#settings`));
    ok(login, 'the sign-in page');
    const page = fakePage(login.body, { ok: true, notices: [{ kind: 'method-added', at: '2026-11-17T10:00:00.000Z', type: 'passkey', label: '<b>phone</b>' }] });
    await page.els.get('go').onclick();
    await new Promise((r) => setTimeout(r, 20));
    const said = page.words();
    assert.ok(said.includes(T.noticeWords), `the notice is shown: ${said.slice(0, 300)}`);
    assert.ok(!/<b>phone<\/b>/.test([...page.els.values()].map((e) => e.innerHTML).join('')), 'the label is text, never markup');
    assert.deepEqual(page.replaced, [], 'it waits on the person');
    const okBtn = page.button('OK');
    assert.ok(okBtn, 'with OK');
    await okBtn.onclick();
    assert.deepEqual(page.replaced, [`${gw.publicUrl}/#settings`], 'then goes on');
    // with nothing to show, straight on
    const plain = fakePage(login.body, { ok: true });
    await plain.els.get('go').onclick();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(plain.replaced, [`${gw.publicUrl}/#settings`]);
  } finally { await gw.close(); }
});

test('org-access A4: only the owner relinks, never their own row, at the row\'s rev', async () => {
  const { gw, owner, ana } = await setup('relink-who');
  try {
    const ownerId = gw.state().people.find((p) => p.role === 'owner').id;
    const before = JSON.stringify(gw.state());
    assert.equal((await gw.raw('POST', '/auth/people/relink', { body: { id: ana.id, rev: 1 } })).status, 401);
    const anaB = browser(gw, { session: mintSession(gw, ana.id, ana.methods[0].id) });
    const mid = JSON.stringify(gw.state());
    refusedAs(await anaB.post('/auth/people/relink', { id: ana.id, rev: 1 }), 403, 'not-allowed', 'Ana for herself');
    refusedAs(await owner.post('/auth/people/relink', { id: ownerId, rev: 1 }), 403, 'not-allowed', 'the owner\'s own row');
    const stale = await owner.post('/auth/people/relink', { id: ana.id, rev: 2 });
    refusedAs(stale, 409, 'stale', 'a stale rev');
    assert.equal(stale.json.error, T.stale);
    refusedAs(await owner.post('/auth/people/relink', { id: rid('p-'), rev: 1 }), 409, 'stale', 'nobody by that id');
    assert.equal(JSON.stringify(gw.state()), mid, 'none of those wrote anything');
    ageOwner(gw, owner, 6 * 60 * 1000);
    refusedAs(await owner.post('/auth/people/relink', { id: ana.id, rev: 1 }), 403, 'fresh-sign-in', 'not fresh');
    assert.deepEqual(gw.state().invites ?? [], []);
    assert.ok(before);
  } finally { await gw.close(); }
});

test('org-access A2: a dead invite link\'s page says it can\'t be used, and the page takes the token out of the address', async () => {
  const { gw } = await setup('dead-page');
  try {
    const page = await gw.raw('GET', '/auth/claim');
    ok(page, 'the invite page');
    const tok = u(crypto.randomBytes(32));
    const p = fakePage(page.body, null, { refuse: { error: T.gone }, hash: `#${tok}`, pathname: '/auth/claim' });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(p.states, [[null, '', '/auth/claim']], 'the token leaves the address bar at once');
    const said = p.words();
    assert.ok(said.includes('This invite can\'t be used'), `the dead link's words: ${said.slice(0, 300)}`);
    assert.ok(said.includes('Each link works once, for 24 hours.'));
    assert.ok(!said.includes(tok), 'the token is nowhere on the page');
    // any other failure is an error to retry, never a dead link
    const busy = fakePage(page.body, null, { refuse: { error: 'the box is busy' }, hash: `#${tok}`, pathname: '/auth/claim' });
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(!busy.words().includes('This invite can\'t be used'), 'another failure is not a dead link');
    assert.equal(busy.els.get('go').hidden, false, 'the button stays');
    assert.match(busy.els.get('err').textContent, /the box is busy/);
  } finally { await gw.close(); }
});

test('org-access A2: on an unclaimed box an invite link reads as dead', async () => {
  const gw = await gateway('peek-unclaimed');
  try {
    for (const token of [u(crypto.randomBytes(32)), gw.token]) {
      const r = await gw.raw('POST', '/auth/claim/invite', { body: { token } });
      assert.deepEqual([r.status, r.json], [403, { error: T.gone }], 'refused alike, the box\'s own claim token included');
      assert.equal(sessionCookieOf(r), null);
    }
  } finally { await gw.close(); }
});

test('org-access A2: an invite whose owner session ends while its body is in flight lands nothing', async () => {
  const { gw, owner } = await setup('reclaim-mid');
  try {
    const before = gw.state();
    const answer = new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: gw.port, method: 'POST', path: '/auth/people/invite', headers: { host: gw.host, origin: gw.publicUrl, 'content-type': 'application/json', cookie: owner.jar.session } }, (res) => {
        let b = '';
        res.on('data', (c) => { b += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      });
      r.on('error', reject);
      r.write('{"name":"Be');
      // what the reclaim writes (cloud/gateway.mjs's devteam-reclaim): nobody's passkey or session stands
      setTimeout(() => {
        gw.write({ ...before, passkeys: [], sessions: [], pushSubs: [], peopleSessions: [], invites: [] });
        setTimeout(() => r.end('a"}'), 50);
      }, 50);
    });
    const got = await answer;
    assert.ok([401, 403].includes(got.status), `refused: ${got.status} ${got.body}`);
    const s = gw.state();
    assert.equal(s.people.some((p) => p.name === 'Bea'), false, 'no row');
    assert.deepEqual(s.invites, [], 'no invite');
  } finally { await gw.close(); }
});

// --- A5: only a passkey -----------------------------------------------------------------------------

test('org-access A5: no sign-in method type but passkey, and no password, email or link route', async () => {
  const { gw } = await setup('only-passkey');
  try {
    for (const type of ['password', 'email', 'link', 'magic-link', 'oidc', 'token']) {
      const r = await gw.raw('POST', `/auth/method/${type}/start`, { body: { purpose: 'sign-in' } });
      assert.equal(r.status, 404, `${type}: no such type`);
      assert.equal(sessionCookieOf(r), null);
    }
    for (const route of ['/auth/password', '/auth/email', '/auth/magic', '/auth/link', '/auth/token', '/auth/login?token=x', '/auth/claim/login']) {
      for (const method of ['GET', 'POST']) {
        const r = await gw.raw(method, route, method === 'POST' ? { body: { email: 'a@b.c', password: 'x', token: 'x' } } : {});
        assert.equal(sessionCookieOf(r), null, `${method} ${route} opens no session`);
      }
    }
  } finally { await gw.close(); }
});

test('org-access A5: an invite link signs nobody in until a passkey is made', async () => {
  const { gw } = await setup('no-link-signin');
  try {
    const [bea] = seed(gw, [{ name: 'Bea' }]);
    const tok = tokenOf(seedInvite(gw, bea.id));
    const b = browser(gw);
    for (const [what, step] of [['opening it', await b.req('GET', '/auth/claim')], ['reading it', await b.post('/auth/claim/invite', { token: tok })], ['starting', await b.post('/auth/method/passkey/start', { purpose: 'invite', token: tok })]]) {
      assert.equal(sessionCookieOf(step), null, `${what} opens no session`);
    }
    const bogus = await b.post('/auth/method/passkey/finish', { purpose: 'invite', clientDataJSON: u('{}'), attestationObject: '', rawId: '' });
    assert.notEqual(bogus.status, 200);
    assert.equal(sessionCookieOf(bogus), null, 'a finish without a passkey opens none');
    assert.notEqual((await b.req('GET', '/')).status, 200, 'still signed out');
    assert.equal(gw.state().invites.length, 1, 'the link is still there for a real passkey');
  } finally { await gw.close(); }
});

test('org-access A5: only a finished sign-in method flow mints a session (the gateway\'s source)', () => {
  const src = gatewaySource();
  const from = src.indexOf('const finishFlow = async');
  const to = src.indexOf('const flowAnswer', from);
  assert.ok(from > 0 && to > from, 'finishFlow is found');
  const calls = [...src.matchAll(/\bsessionFor\(/g)].map((m) => m.index).filter((i) => !src.slice(i - 6, i).includes('const '));
  assert.ok(calls.length >= 3, 'claim, sign-in and invite');
  for (const i of calls) assert.ok(i > from && i < to, `a session is minted outside finishFlow, at offset ${i}: ${src.slice(i - 80, i + 40)}`);
  const minted = [...src.matchAll(/cookie\(b64u\(/g)].map((m) => m.index);
  const sf = src.indexOf('const sessionFor = ');
  for (const i of minted) assert.ok(i > sf && i < sf + 800, `a session cookie is set outside sessionFor, at offset ${i}`);
});

// --- View (kit-250) ----------------------------------------------------------------------------------

test('invites: a View invite claims at View; a relink changes no level', async () => {
  const { gw, owner, ana } = await setup('view');
  try {
    const before = JSON.stringify(gw.state());
    for (const level of ['admin', 'owner', 7, null]) refusedAs(await owner.post('/auth/people/invite', { name: 'Bea', level }), 400, 'bad-request', `level ${JSON.stringify(level)}`);
    assert.equal(JSON.stringify(gw.state()), before, 'nothing written');
    const r = await owner.post('/auth/people/invite', { name: 'Bea', level: 'view' });
    ok(r, 'an invite at View');
    const { b, fin } = await join(gw, r.json.link);
    ok(fin, 'Bea joins');
    assert.equal(rowOf(gw, r.json.person.id).level, 'view', 'Bea is View');
    assert.equal((await b.req('GET', '/box.json')).json.level, 'view', 'and her session says so');
    // a new link keeps the level the row has, whatever the body says
    ok(await owner.post('/auth/people/relink', { id: ana.id, rev: 1, level: 'view' }), 'a relink');
    assert.equal(rowOf(gw, ana.id).level, 'full', 'Ana is still Full');
  } finally { await gw.close(); }
});
