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
  const src = fs.readFileSync(path.join(repo, 'cloud', 'gateway.mjs'), 'utf8');
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

// --- until kit-250: no View ---------------------------------------------------------------------------

test('kit-248: until kit-250, an invite at View and a move to View are refused', async () => {
  const { gw, owner, ana } = await setup('no-view');
  try {
    const before = JSON.stringify(gw.state());
    refusedAs(await owner.post('/auth/people/invite', { name: 'Bea', level: 'view' }), 400, 'view-not-yet', 'an invite at View');
    for (const level of ['admin', 'owner', 7, null]) refusedAs(await owner.post('/auth/people/invite', { name: 'Bea', level }), 400, 'bad-request', `level ${JSON.stringify(level)}`);
    assert.equal(JSON.stringify(gw.state()), before, 'nothing written');
    // no route moves anyone to View, and a new link keeps the level it has
    for (const route of ['/auth/people/level', '/auth/people/move', '/auth/people/change']) {
      const r = await owner.post(route, { id: ana.id, rev: 1, level: 'view' });
      assert.notEqual(r.status, 200, route);
    }
    ok(await owner.post('/auth/people/relink', { id: ana.id, rev: 1, level: 'view' }), 'a relink');
    assert.equal(rowOf(gw, ana.id).level, 'full', 'Ana is still Full');
  } finally { await gw.close(); }
});
