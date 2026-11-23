// People on the hub's Settings (cloud/gateway.mjs and docs/devteam/dashboard/hub.html, kit-249): the
// gateway's /auth/people/* routes, the rules behind them (only the owner and admins read People, every
// change needs a fresh sign-in and the row's rev, nobody changes the owner's row but to rename it),
// what a removal ends at once (the person's requests, sign-ins, invites, devices, terminal and preview
// sockets), that a Full person's session does what the owner's does, /box.json's people and role, and
// the sections on the hub's Settings in Chrome. Tests for the org-access goal's measure are named
// 'org-access A<n>: …'. People, invites and sessions are seeded by writing the state file (the store
// re-reads a replaced file), as test/org-access.methods.test.mjs does.
// Run: node --test test/org-access.people-page.test.mjs (Chrome checks need Node 22 and Chrome)
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// the suite's shared env scrub and this process's ports: the hub's is PORTS, the instances' PORTS + 1 …
import { PORTS } from './lib/kit.mjs';
import { canDrive, openChrome } from './lib/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const HUB_PAGE = path.join(repo, 'docs', 'devteam', 'dashboard', 'hub.html');
delete process.env.DEVTEAM_CLAIM_TOKEN;
const G = await import(pathToFileURL(path.join(repo, 'cloud', 'gateway.mjs')).href);
const HUB = PORTS;
const ECHO = PORTS + 6;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-people-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

const sha = (b) => crypto.createHash('sha256').update(b).digest();
const u = (b) => Buffer.from(b).toString('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const rid = (prefix) => prefix + Array.from(crypto.randomBytes(12), (x) => B32[x & 31]).join('');
const ACTIONS = ['invite', 'relink', 'revoke', 'rename', 'remove'];
const STALE = 'This changed since you opened it; reload';
const OWNER_ONLY = ['relink', 'revoke'];
const has = (list, yes, no = []) => yes.every((a) => list.includes(a)) && !no.some((a) => list.includes(a));

// --- a software authenticator, as test/org-access.methods.test.mjs's ---------------------------
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

// --- the box's neighbours: the hub on its port, an instance (echo) and ttyd, as stand-ins ---------
// One of each for the whole file, recording what reaches them. The hub lists echo, with one preview.
const seen = { hub: [], echo: [], ttyd: [] };
let previewPort = null;
const listening = (srv, port) => new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(port, '127.0.0.1', () => resolve(srv.address().port)); });
const hubSrv = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    seen.hub.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url.startsWith('/operator/')) return res.end(JSON.stringify(req.method === 'GET' ? { operator: { state: 'ready' }, threads: [] } : { ok: true, out: 'ot-1' }));
    res.end(JSON.stringify({ hub: 1, kit: 'v0.0.0', instances: [{ devteam: 1, name: 'echo', root: '/srv/echo', port: ECHO, previews: previewPort ? [{ name: 'cool-tiger', port: previewPort, project: 'echo', session: 'kit-1', label: 'app', at: '2026-11-20', up: true, run: false }] : [] }] }));
  });
});
const echoSrv = http.createServer((req, res) => {
  if (req.url === '/api/hello') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ devteam: 1, name: 'echo', root: '/srv/echo', port: ECHO })); }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => { seen.echo.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }); res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); });
});
// a socket server that answers any upgrade with 101 and then echoes: ttyd, and a preview's dev server
const echoSockets = () => net.createServer((s) => {
  let buf = '';
  s.on('error', () => {});
  s.on('data', function first(c) {
    buf += c;
    if (!buf.includes('\r\n\r\n')) return;
    s.off('data', first);
    seen.ttyd.push(buf.split('\r\n\r\n')[0]);
    if (/^GET \/ HTTP/.test(buf) && !/upgrade:/i.test(buf)) { s.end('HTTP/1.1 200 OK\r\ncontent-type: text/html\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok'); return; }
    s.write('HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n');
    s.on('data', (x) => s.write(x));
  });
});
const ttydSrv = echoSockets();
const devSrv = echoSockets();
await listening(hubSrv, HUB);
await listening(echoSrv, ECHO);
const TTYD = await listening(ttydSrv, 0);
previewPort = await listening(devSrv, 0);
// the stand-ins hold the process open until the file's last test is done
after(() => { for (const s of [hubSrv, echoSrv, ttydSrv, devSrv]) { s.closeAllConnections?.(); s.close(); } });

// --- a gateway on a free port, and a browser's requests to it -------------------------------------
const freePort = () => new Promise((resolve, reject) => { const v = net.createServer(); v.on('error', reject); v.listen(0, '127.0.0.1', () => { const { port } = v.address(); v.close(() => resolve(port)); }); });
let made = 0;
async function gateway(name) {
  const tag = `${name}-${++made}`;
  const port = await freePort();
  const publicUrl = `http://box.localhost:${port}`;
  const host = `box.localhost:${port}`;
  const ttydPage = path.join(tmp, `${tag}-ttyd.html`);
  fs.writeFileSync(ttydPage, 'the gateway\'s copy of ttyd');
  const uploadsDir = path.join(tmp, `${tag}-uploads`);
  fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o750 });
  const logs = [];
  const dir = path.join(tmp, tag);
  const g = G.createGateway({ publicUrl, dir, ttydPort: TTYD, ttydPage, uploadsDir, hubPage: HUB_PAGE, log: (m) => logs.push(m) });
  await new Promise((r) => g.server.listen(port, '127.0.0.1', r));
  const token = /claim#([\w-]+)/.exec(logs.join('\n'))?.[1];
  const file = path.join(dir, 'state.json');
  const state = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const write = (s) => { const t = `${file}.test.tmp`; fs.writeFileSync(t, JSON.stringify(s, null, 2), { mode: 0o600 }); fs.renameSync(t, file); };
  // on: 'term', an instance's or a preview's name, else the box's own
  const origin = (on) => (on ? `http://${on}.${host}` : publicUrl);
  const req = (method, route, { body, cookie = '', headers = {}, on, hold } = {}) => new Promise((resolve, reject) => {
    const self = origin(on);
    const h = { host: new URL(self).host, ...(method !== 'GET' ? { origin: self, 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers };
    const r = http.request({ host: '127.0.0.1', port, method, path: route, headers: h }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, headers: res.headers, cookies: res.headers['set-cookie'] ?? [], body: b, json: j }); });
    });
    r.on('error', reject);
    const end = () => r.end(body === undefined ? undefined : JSON.stringify(body));
    if (hold) { r.flushHeaders(); hold.then(end); } else end();
  });
  // A WebSocket handshake on a name; resolves with the socket once it answers 101 (or the status)
  const ws = (on, route, cookie) => new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(`GET ${route} HTTP/1.1\r\nhost: ${on}.${host}\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\nsec-websocket-version: 13\r\norigin: ${origin(on)}\r\ncookie: ${cookie}\r\n\r\n`));
    let b = '';
    opened.add(s);
    const t = setTimeout(() => { s.destroy(); resolve({ status: 0, socket: null }); }, 5000);
    s.on('error', () => {});
    s.on('close', () => { clearTimeout(t); resolve({ status: 0, socket: null }); });
    s.on('data', function head(c) { b += c; if (!b.includes('\r\n\r\n')) return; clearTimeout(t); s.off('data', head); resolve(b.startsWith('HTTP/1.1 101') ? { status: 101, socket: s } : { status: Number(b.split(' ')[1]), socket: null }); });
  });
  // every socket a test opened goes with the gateway, whatever the test asserted before it got there
  const opened = new Set();
  return { g, port, publicUrl, host, logs, token, dir, file, state, write, req, ws, close: () => new Promise((r) => { for (const s of opened) s.destroy(); g.server.closeAllConnections?.(); g.server.close(r); }) };
}
// Is a socket still relayed? A ping comes back within a second, or it doesn't.
const alive = (s) => new Promise((resolve) => {
  if (!s || s.destroyed) return resolve(false);
  const t = setTimeout(() => resolve(false), 1000);
  s.once('data', () => { clearTimeout(t); resolve(true); });
  s.once('close', () => { clearTimeout(t); resolve(false); });
  s.write('ping');
});
const closedWithin = (s, ms) => new Promise((resolve) => { if (s.destroyed) return resolve(true); const t = setTimeout(() => resolve(false), ms); s.once('close', () => { clearTimeout(t); resolve(true); }); });

// The owner claims the box through today's claim routes; their session cookie pair.
async function claim(gw) {
  const key = authenticator();
  const o = await gw.req('POST', '/auth/claim/options', { body: { token: gw.token } });
  assert.equal(o.status, 200, o.body);
  const flow = o.cookies.map((c) => c.split(';')[0]).join('; ');
  const v = await gw.req('POST', '/auth/claim/verify', { body: { token: gw.token, ...key.create(o.json, gw.publicUrl) }, cookie: flow });
  assert.equal(v.status, 200, v.body);
  return { owner: v.cookies.find((c) => c.startsWith('devteam_session=')).split(';')[0], ownerKey: key };
}
const row = (name, { role = 'member', level = 'full', methods = [], pushSubs = [], notices = [] } = {}) => ({ id: rid('p-'), name, role, level, methods, pushSubs, added_at: new Date().toISOString(), last_seen: null, notices, rev: 1 });
// a session for anyone, minted as the gateway mints one; `at` sets when they signed in
function mint(gw, person, { at = Date.now() } = {}) {
  const tok = crypto.randomBytes(32);
  const s = gw.state();
  const entry = { hash: u(sha(tok)), method: person.methods?.[0]?.id ?? null, at, expires: at + 3600e3 };
  gw.write(person.role === 'owner' ? { ...s, sessions: [...s.sessions, entry] } : { ...s, peopleSessions: [...(s.peopleSessions ?? []), { ...entry, person: person.id }] });
  return `devteam_session=${u(tok)}`;
}
function seedInvite(gw, personId, { expires = Date.now() + 864e5 } = {}) {
  const token = u(crypto.randomBytes(32));
  const s = gw.state();
  gw.write({ ...s, invites: [...(s.invites ?? []), { hash: u(sha(token)), person: personId, expires }] });
  return token;
}
const pushSub = (n) => ({ endpoint: `https://web.push.apple.com/${n}`, p256dh: u(Buffer.alloc(65, 4)), auth: u(Buffer.alloc(16, 1)), at: new Date().toISOString() });
const ownerOf = (gw) => gw.state().people.find((p) => p.role === 'owner');
const rowOf = (gw, id) => gw.state().people.find((p) => p.id === id) ?? null;
const STALE_AT = () => Date.now() - 10 * 60e3;

// A claimed box: the owner (a fresh and a stale session), Sam the admin, Ana a Full member with a
// passkey and a phone, Lee invited and not yet joined; each with a fresh session but Lee.
async function box(name) {
  const gw = await gateway(name);
  try {
    const { owner, ownerKey } = await claim(gw);
    const anaKey = authenticator();
    const sam = row('Sam Rivera', { role: 'admin', methods: [authenticator().method()] });
    const ana = row('Ana Costa', { methods: [anaKey.method()], pushSubs: [pushSub('ana')] });
    const lee = row('Lee Park');
    const s = gw.state();
    gw.write({ ...s, people: [...s.people, sam, ana, lee] });
    const leeToken = seedInvite(gw, lee.id);
    const o = ownerOf(gw);
    return {
      gw, owner, ownerKey, ownerRow: o, ownerStale: mint(gw, o, { at: STALE_AT() }),
      sam, samC: mint(gw, sam), ana, anaKey, anaC: mint(gw, ana), lee, leeToken,
    };
  } catch (e) { await gw.close(); throw e; }
}
const post = (gw, action, cookie, body) => gw.req('POST', `/auth/people/${action}`, { cookie, body });
// a body each action would take for this row, at its rev
const bodyFor = (action, p) => (action === 'invite' ? { name: `New ${crypto.randomBytes(3).toString('hex')}`, level: 'full' } : action === 'rename' ? { id: p.id, rev: p.rev, name: `${p.name} B` } : { id: p.id, rev: p.rev });
const refused = (r, status, code, what) => { assert.equal(r.status, status, `${what}: ${r.status} ${r.body}`); assert.equal(r.json?.code, code, `${what}: ${r.body}`); assert.equal(typeof r.json?.error, 'string', what); };

// --- A3: who gets People, and that every change needs a fresh sign-in and the row's rev ------------

test('org-access A3: the owner reads People with a session only, each row with the actions they may take', async () => {
  const B = await box('a3-list');
  try {
    const r = await B.gw.req('GET', '/auth/people/list', { cookie: B.ownerStale });
    assert.equal(r.status, 200, `a session signed in ten minutes ago reads it: ${r.body}`);
    assert.deepEqual(r.json.viewer, { id: B.ownerRow.id, role: 'owner', invite: true });
    const by = Object.fromEntries(r.json.people.map((p) => [p.name, p]));
    assert.deepEqual(r.json.people.map((p) => p.name), ['Owner', 'Sam Rivera', 'Ana Costa', 'Lee Park'], 'the owner first, then as they were added');
    assert.deepEqual(by.Owner.actions, ['rename'], 'the owner\'s own row: only Rename');
    assert.equal(by.Owner.you, true);
    for (const n of ['Ana Costa', 'Sam Rivera']) assert.ok(has(by[n].actions, ['rename', 'relink', 'remove'], ['revoke']), `${n}, who joined: Rename, Send a new link, Remove, and no Revoke: ${by[n].actions}`);
    assert.ok(has(by['Lee Park'].actions, ['revoke'], ['relink', 'remove']), `someone who hasn't joined: Revoke, not a new link nor Remove: ${by['Lee Park'].actions}`);
    assert.deepEqual({ kind: by['Lee Park'].link?.kind, expired: by['Lee Park'].link?.expired }, { kind: 'invite', expired: false });
    assert.equal(typeof by['Lee Park'].link.expires, 'number');
    assert.deepEqual([by.Owner.methods, by['Ana Costa'].methods, by['Lee Park'].methods], [1, 1, 0], 'how many sign-in methods each has');
    assert.deepEqual(Object.keys(by['Ana Costa']).sort(), ['actions', 'added_at', 'id', 'last_seen', 'level', 'link', 'methods', 'name', 'rev', 'role', 'you']);
    assert.ok(!r.body.includes('"key"') && !r.body.includes('jwk') && !r.body.includes('endpoint'), 'no key material, nor devices');
    // a new link to someone who joined: their row stays as it was, with Revoke first and no new link
    seedInvite(B.gw, B.ana.id);
    const again = (await B.gw.req('GET', '/auth/people/list', { cookie: B.ownerStale })).json.people.find((p) => p.id === B.ana.id);
    assert.equal(again.link.kind, 'new-link');
    assert.ok(has(again.actions, ['revoke', 'rename', 'remove'], ['relink']), `a link out: Revoke first, no second link: ${again.actions}`);
    assert.equal(again.actions[0], 'revoke');
    // the stand-in owner: a claimed box whose owner row isn't written yet reads People as the owner
    const t = B.gw.state();
    B.gw.write({ ...t, people: t.people.filter((p) => p.role !== 'owner') });
    const st = await B.gw.req('GET', '/auth/people/list', { cookie: B.owner });
    assert.equal(st.status, 200, `the stand-in owner: ${st.body}`);
    assert.deepEqual([st.json.viewer.id, st.json.viewer.role], [null, 'owner']);
    assert.ok(st.json.people.every((p) => p.you === false && p.role !== 'owner'), 'no owner row, and no row is theirs');
    // someone who never joined and whose link was swept (an invite's save keeps only live ones)
    const u = B.gw.state();
    B.gw.write({ ...u, invites: u.invites.filter((x) => x.person !== B.lee.id) });
    const lee = (await B.gw.req('GET', '/auth/people/list', { cookie: B.owner })).json.people.find((p) => p.id === B.lee.id);
    assert.deepEqual([lee.link, has(lee.actions, ['remove'], ['revoke', 'relink'])], [null, true], `no link left: Remove only, nothing to revoke: ${lee.actions}`);
    const sb = (await B.gw.req('GET', '/box.json', { cookie: B.owner })).json;
    assert.deepEqual([sb.role, sb.people], ['owner', `${B.gw.publicUrl}/auth/people/list`], 'the stand-in owner\'s /box.json names People');
  } finally { await B.gw.close(); }
});

test('org-access A3: an admin reads People with no actions; a member and anyone signed out are refused it', async () => {
  const B = await box('a3-who');
  try {
    const a = await B.gw.req('GET', '/auth/people/list', { cookie: B.samC });
    assert.equal(a.status, 200, a.body);
    assert.deepEqual(a.json.viewer, { id: B.sam.id, role: 'admin', invite: false });
    assert.equal(a.json.people.length, 4, 'an admin sees every row, pending links included');
    assert.deepEqual(a.json.people[0].actions, [], 'an admin has no action on the owner\'s row');
    for (const x of a.json.people) assert.ok(has(x.actions, [], OWNER_ONLY), `an admin is offered no owner-only action: ${x.name} ${x.actions}`);
    refused(await B.gw.req('GET', '/auth/people/list', { cookie: B.anaC }), 403, 'not-allowed', 'a member');
    assert.equal((await B.gw.req('GET', '/auth/people/list')).status, 401, 'signed out');
  } finally { await B.gw.close(); }
});

test('org-access A3: every People action needs a fresh sign-in, refused with fresh-sign-in, and changes nothing', async () => {
  const B = await box('a3-fresh');
  try {
    const before = B.gw.state();
    for (const action of ACTIONS) {
      const target = action === 'revoke' ? B.lee : B.ana;
      refused(await post(B.gw, action, B.ownerStale, bodyFor(action, target)), 403, 'fresh-sign-in', `the owner's ${action}, signed in ten minutes ago`);
    }
    assert.deepEqual({ people: B.gw.state().people, invites: B.gw.state().invites }, { people: before.people, invites: before.invites }, 'nothing changed');
  } finally { await B.gw.close(); }
});

test('org-access A3: a member is refused every People action, an admin every owner-only one', async () => {
  const B = await box('a3-roles');
  try {
    const before = B.gw.state();
    for (const action of ACTIONS) refused(await post(B.gw, action, B.anaC, bodyFor(action, action === 'revoke' ? B.lee : B.sam)), 403, 'not-allowed', `a member's ${action}`);
    for (const action of ['invite', 'relink', 'revoke']) refused(await post(B.gw, action, B.samC, bodyFor(action, action === 'revoke' ? B.lee : B.ana)), 403, 'not-allowed', `an admin's ${action}`);
    assert.deepEqual({ people: B.gw.state().people, invites: B.gw.state().invites }, { people: before.people, invites: before.invites }, 'nothing changed');
  } finally { await B.gw.close(); }
});

test('org-access A3: a change from a stale tab is refused: an old rev, or a person since removed', async () => {
  const B = await box('a3-rev');
  try {
    // a rev the row never had, and then one it had before a change
    for (const action of ['rename', 'remove', 'relink', 'revoke']) refused(await post(B.gw, action, B.owner, bodyFor(action, { ...(action === 'revoke' ? B.lee : B.ana), rev: 99 })), 409, 'stale', `${action} at a rev the row never had`);
    refused(await post(B.gw, 'rename', B.owner, { id: B.ana.id, rev: 'one', name: 'Ana' }), 409, 'stale', 'a rev that isn\'t a number');
    refused(await post(B.gw, 'rename', B.owner, { id: 7, rev: 1, name: 'Ana' }), 409, 'stale', 'an id that isn\'t a string');
    const stale = await post(B.gw, 'remove', B.owner, { id: B.ana.id, rev: 99 });
    assert.equal(stale.json?.error, STALE, 'in the words the hub shows');
    const s = B.gw.state();
    B.gw.write({ ...s, people: s.people.map((p) => (p.id === B.ana.id ? { ...p, name: 'Ana C', rev: 2 } : p)) });
    for (const action of ['rename', 'remove', 'relink']) refused(await post(B.gw, action, B.owner, bodyFor(action, { ...B.ana, rev: 1 })), 409, 'stale', `${action} at the row's old rev`);
    const o = ownerOf(B.gw);
    refused(await post(B.gw, 'rename', B.samC, { id: o.id, rev: o.rev + 5, name: 'X' }), 409, 'stale', 'an admin at a wrong rev: the rev is asked before who may');
    // Sam removed meanwhile (by another tab): nothing brings him back
    const t = B.gw.state();
    B.gw.write({ ...t, people: t.people.filter((p) => p.id !== B.sam.id) });
    for (const action of ['rename', 'remove', 'relink']) refused(await post(B.gw, action, B.owner, bodyFor(action, B.sam)), 409, 'stale', `${action} of someone removed`);
    refused(await post(B.gw, 'revoke', B.owner, { id: B.ana.id, rev: 2 }), 409, 'stale', 'a revoke with no link to revoke');
    refused(await post(B.gw, 'rename', B.owner, ['a list']), 400, 'bad-request', 'a body that isn\'t an object');
    refused(await B.gw.req('POST', '/auth/people/list', { cookie: B.owner, body: {} }), 405, 'bad-request', 'a POST to the list');
    refused(await B.gw.req('GET', '/auth/people/rename', { cookie: B.owner }), 404, 'not-found', 'a GET of an action');
    assert.deepEqual([rowOf(B.gw, B.sam.id), rowOf(B.gw, B.ana.id).name], [null, 'Ana C'], 'nothing changed');
  } finally { await B.gw.close(); }
});

test('org-access A3: Your sign-in learns how long the sign-in stays fresh, beside its methods and notices', async () => {
  const B = await box('a3-freshms');
  try {
    const f = await B.gw.req('GET', '/auth/method/list', { cookie: B.owner });
    assert.equal(f.status, 200, f.body);
    assert.ok(Number.isInteger(f.json.fresh_ms) && f.json.fresh_ms > 4 * 60e3 && f.json.fresh_ms <= 5 * 60e3, `just signed in: about five minutes left: ${f.json.fresh_ms}`);
    assert.ok(Array.isArray(f.json.methods) && f.json.methods.length === 1 && Array.isArray(f.json.notices), 'methods and notices as they were');
    assert.equal((await B.gw.req('GET', '/auth/method/list', { cookie: B.ownerStale })).json.fresh_ms, 0, 'signed in ten minutes ago: none left');
    assert.equal((await B.gw.req('GET', '/auth/method/list', { cookie: B.anaC })).json.fresh_ms > 0, true, 'a member\'s own, too');
  } finally { await B.gw.close(); }
});

test('org-access A3: a change whose body arrives after its row went, or its session ended, writes nothing', async () => {
  const B = await box('a3-race');
  try {
    let go;
    const held = B.gw.req('POST', '/auth/people/rename', { cookie: B.owner, body: { id: B.ana.id, rev: B.ana.rev, name: 'Ana Back' }, hold: new Promise((r) => { go = r; }) });
    await sleep(300);
    const s = B.gw.state();
    B.gw.write({ ...s, people: s.people.filter((p) => p.id !== B.ana.id) });
    go();
    const r = await held;
    assert.ok([401, 409].includes(r.status), `the row went while its body waited: ${r.status} ${r.body}`);
    assert.equal(rowOf(B.gw, B.ana.id), null, 'nothing brings her back');
    let go2;
    const held2 = B.gw.req('POST', '/auth/people/rename', { cookie: B.owner, body: { id: B.sam.id, rev: B.sam.rev, name: 'Sam R' }, hold: new Promise((r2) => { go2 = r2; }) });
    await sleep(300);
    const t = B.gw.state();
    B.gw.write({ ...t, peopleSessions: [], sessions: [] });
    go2();
    assert.equal((await held2).status, 401, 'the session ended while its body waited');
    assert.equal(rowOf(B.gw, B.sam.id).name, 'Sam Rivera', 'nothing renamed');
    // a sign-in fresh when the headers came, but not by the time the body did
    const o = ownerOf(B.gw);
    const late = mint(B.gw, o, { at: Date.now() - (5 * 60e3 - 2500) });
    let go3;
    const held3 = B.gw.req('POST', '/auth/people/rename', { cookie: late, body: { id: o.id, rev: o.rev, name: 'Late Name' }, hold: new Promise((r3) => { go3 = r3; }) });
    await sleep(4000);
    go3();
    refused(await held3, 403, 'fresh-sign-in', 'fresh when the headers came, not when the body did');
    assert.equal(ownerOf(B.gw).name, o.name, 'nothing renamed');
  } finally { await B.gw.close(); }
});

test('org-access A3: a name is required, one line, at most 60 characters and unique ignoring case', async () => {
  const B = await box('a3-names');
  try {
    for (const [name, code] of [['', 'bad-name'], ['   ', 'bad-name'], ['a\nb', 'bad-name'], ['a‮b', 'bad-name'], ['x'.repeat(61), 'bad-name'], ['a\u2066b', 'bad-name'], ['a\u2069b', 'bad-name'], ['\u{1F600}'.repeat(61), 'bad-name'], [7, 'bad-name'], ['owner', 'name-taken'], [' SAM RIVERA ', 'name-taken']]) refused(await post(B.gw, 'rename', B.owner, { id: B.ana.id, rev: 1, name }), 400, code, `rename to ${JSON.stringify(name)}`);
    assert.equal(rowOf(B.gw, B.ana.id).name, 'Ana Costa', 'nothing changed');
    const wide = await post(B.gw, 'rename', B.owner, { id: B.lee.id, rev: 1, name: '\u{1F600}'.repeat(60) });
    assert.equal(wide.status, 200, `60 characters counted as characters, not UTF-16 units: ${wide.body}`);
    const s = B.gw.state();
    B.gw.write({ ...s, people: s.people.map((p) => (p.id === B.ana.id ? { ...p, name: '\u00c1na Costa' } : p)) });
    refused(await post(B.gw, 'rename', B.owner, { id: B.sam.id, rev: 1, name: 'A\u0301na Costa' }), 400, 'name-taken', 'Sam renamed to Ana\'s name in another Unicode form');
    assert.equal(rowOf(B.gw, B.sam.id).name, 'Sam Rivera', 'nothing renamed');
  } finally { await B.gw.close(); }
});

test('org-access A3: the owner renames anyone, themselves included, and rev moves on', async () => {
  const B = await box('a3-rename');
  try {
    const ok = await post(B.gw, 'rename', B.owner, { id: B.ana.id, rev: 1, name: '  Ana Costa-Lima ' });
    assert.equal(ok.status, 200, ok.body);
    assert.deepEqual(ok.json, { ok: true, rev: 2 });
    assert.deepEqual([rowOf(B.gw, B.ana.id).name, rowOf(B.gw, B.ana.id).rev], ['Ana Costa-Lima', 2], 'trimmed, and a new rev');
    assert.equal((await post(B.gw, 'rename', B.owner, { id: B.ana.id, rev: 2, name: 'ana costa-lima' })).status, 200, 'their own name in other case is no clash');
    const o = ownerOf(B.gw);
    const me = await post(B.gw, 'rename', B.owner, { id: o.id, rev: o.rev, name: 'Robin Hale' });
    assert.equal(me.status, 200, `the owner renames their own row: ${me.body}`);
    assert.equal(ownerOf(B.gw).name, 'Robin Hale');
  } finally { await B.gw.close(); }
});

test('org-access A3: Revoke: someone who never joined goes with their link; someone who joined keeps their row', async () => {
  const B = await box('a3-revoke');
  try {
    const r = await post(B.gw, 'revoke', B.owner, { id: B.lee.id, rev: 1 });
    assert.equal(r.status, 200, r.body);
    assert.deepEqual([rowOf(B.gw, B.lee.id), B.gw.state().invites.length], [null, 0], 'Lee\'s row goes with the only link');
    seedInvite(B.gw, B.ana.id, { expires: Date.now() - 1000 });
    seedInvite(B.gw, B.ana.id);
    assert.equal((await post(B.gw, 'revoke', B.owner, { id: B.ana.id, rev: 1 })).status, 200);
    assert.deepEqual([rowOf(B.gw, B.ana.id)?.name, B.gw.state().invites.length], ['Ana Costa', 0], 'Ana stays; only the link goes');
  } finally { await B.gw.close(); }
});

test('org-access A3: /box.json names People for the owner and admins, and each person\'s role', async () => {
  const B = await box('a3-boxjson');
  try {
    const of = async (cookie) => (await B.gw.req('GET', '/box.json', { cookie })).json;
    const o = await of(B.owner);
    assert.deepEqual([o.box, o.role, o.people], [2, 'owner', `${B.gw.publicUrl}/auth/people/list`]);
    const a = await of(B.samC);
    assert.deepEqual([a.role, a.people], ['admin', `${B.gw.publicUrl}/auth/people/list`]);
    const m = await of(B.anaC);
    assert.equal(m.role, 'member');
    assert.equal(Object.hasOwn(m, 'people'), false, 'a member\'s has no People');
  } finally { await B.gw.close(); }
});

// --- A6: a Full person's session does what the owner's does ----------------------------------------

test('org-access A6: a Full member\'s session signs the owner\'s posts, as the owner\'s does', async () => {
  const B = await box('a6-signed');
  try {
    const pub = crypto.createPublicKey(B.gw.g.threadPublicKey());
    for (const [route, domain, body] of [['/api/pane-answer', 'devteam-pane-answer-v1', { digest: 'a'.repeat(40), option: 1, token: 't' }], ['/api/owner-setting', 'devteam-owner-setting-v1', { key: 'max_active_tickets', value: 7 }]]) {
      for (const [who, cookie] of [['the owner', B.owner], ['Ana', B.anaC]]) {
        const r = await B.gw.req('POST', route, { on: 'echo', cookie, body });
        assert.equal(r.status, 200, `${who}'s ${route}: ${r.body}`);
        const h = seen.echo.at(-1).headers;
        const bytes = Buffer.from(`${domain}\n${ECHO}\n${h['x-devteam-gateway-ts']}\n${h['x-devteam-gateway-nonce']}\n${crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')}`);
        assert.equal(crypto.verify(null, bytes, pub, Buffer.from(h['x-devteam-gateway-sig'] ?? '', 'base64url')), true, `${who}'s ${route} is signed`);
      }
    }
  } finally { await B.gw.close(); }
});

test('org-access A6: a Full member\'s session reaches the operator\'s threads, as the owner\'s does', async () => {
  const B = await box('a6-operator');
  try {
    for (const [who, cookie] of [['the owner', B.owner], ['Ana', B.anaC]]) {
      const n = seen.hub.length;
      const r = await B.gw.req('POST', '/operator/thread-new', { cookie, body: { text: `from ${who}` } });
      assert.equal(r.status, 200, `${who}: ${r.body}`);
      const got = seen.hub.slice(n).find((x) => x.url === '/operator/thread-new');
      assert.ok(got, `${who}'s press reached the hub`);
      assert.match(got.headers['x-devteam-gateway-sig'] ?? '', /^[\w-]{40,}$/, `${who}'s press is signed for the hub`);
    }
  } finally { await B.gw.close(); }
});

test('org-access A6: a Full member\'s session opens the terminal and its socket, as the owner\'s does', async () => {
  const B = await box('a6-term');
  try {
    for (const [who, cookie] of [['the owner', B.owner], ['Ana', B.anaC]]) {
      const page = await B.gw.req('GET', '/', { on: 'term', cookie });
      assert.equal(page.status, 200, `${who}'s terminal page`);
      const w = await B.gw.ws('term', '/ws', cookie);
      assert.equal(w.status, 101, `${who}'s terminal socket`);
      assert.equal(await alive(w.socket), true, `${who}'s socket relays`);
      w.socket.destroy();
    }
  } finally { await B.gw.close(); }
});

test('org-access A6: a Full member\'s session opens the publish page, as the owner\'s does', async () => {
  const B = await box('a6-publish');
  try {
    const nav = { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'same-origin' };
    const route = `/public/publish?port=${ECHO}&slug=x`;
    const o = await B.gw.req('GET', route, { cookie: B.owner, headers: nav });
    const a = await B.gw.req('GET', route, { cookie: B.anaC, headers: nav });
    assert.equal(o.status, 200, o.body.slice(0, 200));
    assert.equal(a.status, 200, `Ana's publish page: ${a.body.slice(0, 200)}`);
    const p = await B.gw.req('POST', '/public/publish', { cookie: B.anaC, body: { port: ECHO, items: [] } });
    assert.equal(p.status, 400, `Ana's publish reaches its own checks: ${p.body}`);
  } finally { await B.gw.close(); }
});

test('org-access A6: a Full member\'s session posts to a dashboard, as the owner\'s does', async () => {
  const B = await box('a6-dash');
  try {
    for (const [who, cookie] of [['the owner', B.owner], ['Ana', B.anaC]]) {
      const n = seen.echo.length;
      const r = await B.gw.req('POST', '/api/fleet', { on: 'echo', cookie, body: { op: 'drain' }, headers: { 'sec-fetch-site': 'same-origin' } });
      assert.equal(r.status, 200, `${who}: ${r.body}`);
      assert.equal(seen.echo.slice(n).some((x) => x.method === 'POST' && x.url === '/api/fleet'), true, `${who}'s post reached the dashboard`);
    }
  } finally { await B.gw.close(); }
});

test('org-access A6: a Full member\'s session opens artifacts under a capability that ends with it', async () => {
  const B = await box('a6-artifact');
  try {
    const frame = { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' };
    const opaque = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' };
    const af = await B.gw.req('GET', '/artifact/main/x/?v=1', { on: 'echo', cookie: B.anaC, headers: frame });
    assert.equal(af.status, 302, `Ana's artifact frame goes under a capability: ${af.body}`);
    const cap = /^(\/c\/[^/]+)\//.exec(af.headers.location ?? '')?.[1];
    assert.ok(cap, af.headers.location);
    assert.equal((await B.gw.req('GET', `${cap}/artifact/main/x/a.js`, { on: 'echo', headers: opaque })).status, 200, 'its files load with no cookie');
    assert.equal((await B.gw.req('POST', '/auth/logout', { cookie: B.anaC, body: {} })).status, 200);
    assert.equal((await B.gw.req('GET', `${cap}/artifact/main/x/a.js`, { on: 'echo', headers: opaque })).status, 403, 'and end with her session');
  } finally { await B.gw.close(); }
});

// --- A7: removing a person ends their access at once ----------------------------------------------

test('org-access A7: after Remove, the person\'s next request is refused, their passkey signs no one in, and their invites and devices go', async () => {
  const B = await box('a7-access');
  try {
    const link = seedInvite(B.gw, B.ana.id);
    const before = B.gw.state();
    const others = (x) => ({ rows: x.people.filter((q) => q.id === B.sam.id || q.id === B.lee.id), sessions: (x.peopleSessions ?? []).filter((q) => q.person !== B.ana.id), invites: (x.invites ?? []).filter((q) => q.person !== B.ana.id) });
    const r = await post(B.gw, 'remove', B.owner, { id: B.ana.id, rev: 1 });
    assert.equal(r.status, 200, r.body);
    assert.equal((await B.gw.req('GET', '/box.json', { cookie: B.anaC })).status, 401, 'her next request');
    const s = B.gw.state();
    assert.equal(rowOf(B.gw, B.ana.id), null, 'her row, methods and devices');
    assert.equal(JSON.stringify(s).includes('web.push.apple.com/ana'), false, 'her push subscription');
    assert.deepEqual((s.peopleSessions ?? []).filter((x) => x.person === B.ana.id), [], 'her sessions');
    assert.deepEqual((s.invites ?? []).filter((x) => x.person === B.ana.id), [], 'her invites');
    // no one else's: Sam's and Lee's rows, Sam's session, Lee's invite, each as it was
    assert.deepEqual(others(s), others(before), 'everyone else\'s rows, sessions and invites are as they were');
    assert.equal(others(s).sessions.length > 0 && others(s).invites.length > 0, true, 'there was something else to keep');
    const o = await B.gw.req('POST', '/auth/login/options', { body: {} });
    const flow = o.cookies.map((c) => c.split(';')[0]).join('; ');
    const v = await B.gw.req('POST', '/auth/login/verify', { cookie: flow, body: B.anaKey.get(o.json, B.gw.publicUrl) });
    assert.notEqual(v.status, 200, `her passkey: ${v.body}`);
    assert.match(v.body, /unknown passkey/, 'her passkey is no one\'s now');
    assert.equal(v.cookies.some((c) => c.startsWith('devteam_session=') && !c.startsWith('devteam_session=;')), false, 'and opens no session');
    const st = await B.gw.req('POST', '/auth/method/passkey/start', { body: { purpose: 'invite', token: link } });
    assert.equal(st.status, 403, 'an invite made for her before the removal');
    assert.equal(st.json?.error, 'This invite has expired or was used; ask for a new one.');
    assert.equal((await B.gw.req('GET', '/box.json', { cookie: B.owner })).status, 200, 'the owner is still in');
    assert.equal((await B.gw.req('GET', '/box.json', { cookie: B.samC })).status, 200, 'Sam is still in');
    assert.equal((await B.gw.req('POST', '/auth/claim/invite', { body: { token: B.leeToken } })).status, 200, 'Lee\'s link still opens');
  } finally { await B.gw.close(); }
});

test('org-access A7: Remove closes the person\'s open terminal and preview sockets at once, and no one else\'s', async () => {
  const B = await box('a7-sockets');
  try {
    // the preview's name known to the gateway: a first request on it reads the hub's list
    assert.equal((await B.gw.req('GET', '/', { on: 'cool-tiger', cookie: B.owner, headers: { 'sec-fetch-mode': 'cors', accept: '*/*' } })).status, 200, 'the preview answers');
    const term = await B.gw.ws('term', '/ws', B.anaC);
    const prev = await B.gw.ws('cool-tiger', '/hmr', B.anaC);
    const ownerTerm = await B.gw.ws('term', '/ws', B.owner);
    const samPrev = await B.gw.ws('cool-tiger', '/hmr', B.samC);
    assert.deepEqual([term.status, prev.status, ownerTerm.status, samPrev.status], [101, 101, 101, 101], 'all four open');
    const r = await post(B.gw, 'remove', B.owner, { id: B.ana.id, rev: 1 });
    assert.equal(r.status, 200, r.body);
    assert.equal(await closedWithin(term.socket, 1000), true, 'her terminal socket closes');
    assert.equal(await closedWithin(prev.socket, 1000), true, 'her preview socket closes');
    assert.equal(await alive(ownerTerm.socket), true, 'the owner\'s terminal stays');
    assert.equal(await alive(samPrev.socket), true, 'Sam\'s preview stays');
    for (const s of [ownerTerm.socket, samPrev.socket]) s.destroy();
  } finally { await B.gw.close(); }
});

// --- A8: nobody changes the owner's row but to rename it -------------------------------------------

test('org-access A8: nobody removes the owner, the owner included', async () => {
  const B = await box('a8-remove');
  try {
    const o = ownerOf(B.gw);
    refused(await post(B.gw, 'remove', B.owner, { id: o.id, rev: o.rev }), 403, 'not-allowed', 'the owner removing themselves');
    assert.deepEqual([ownerOf(B.gw), B.gw.state().passkeys.length], [o, 1], 'the owner\'s row and passkey are as they were');
  } finally { await B.gw.close(); }
});

test('org-access A8: nobody sends the owner a new link, the owner included', async () => {
  const B = await box('a8-relink');
  try {
    const o = ownerOf(B.gw);
    refused(await post(B.gw, 'relink', B.owner, { id: o.id, rev: o.rev }), 403, 'not-allowed', 'a new link to the owner');
    assert.deepEqual(B.gw.state().invites.filter((x) => x.person === o.id), [], 'no invite names the owner');
  } finally { await B.gw.close(); }
});

test('org-access A8: nobody makes the owner View, the owner included', async () => {
  const B = await box('a8-level');
  try {
    const o = ownerOf(B.gw);
    for (const [who, cookie] of [['the owner', B.owner], ['an admin', B.samC]]) {
      const lv = await post(B.gw, 'level', cookie, { id: o.id, rev: o.rev, level: 'view' });
      assert.ok(lv.status >= 400, `${who} making the owner View: ${lv.status}`);
    }
    assert.equal(ownerOf(B.gw).level, 'full');
  } finally { await B.gw.close(); }
});

test('org-access A8: no admin changes the owner\'s row', async () => {
  const B = await box('a8-admin');
  try {
    const o = ownerOf(B.gw);
    for (const action of ['rename', 'remove', 'relink', 'revoke']) refused(await post(B.gw, action, B.samC, bodyFor(action, o)), 403, 'not-allowed', `an admin's ${action} of the owner's row`);
    const lv = await post(B.gw, 'level', B.samC, { id: o.id, rev: o.rev, level: 'view' });
    assert.ok(lv.status >= 400, `an admin making the owner View: ${lv.status}`);
    assert.deepEqual(ownerOf(B.gw), o, 'the owner\'s row is as it was');
  } finally { await B.gw.close(); }
});

// --- the hub's Settings, in Chrome, on a real gateway ---------------------------------------------
const CHROME = { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 };
async function hubAs(t, B, cookie, { width = 1280, height = 900 } = {}) {
  const chrome = await openChrome();
  t.after(() => chrome.close());
  const p = await chrome.newPage();
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  const [name, value] = cookie.split('=');
  await p.send('Network.enable');
  await p.send('Network.setCookie', { name, value, domain: 'box.localhost', path: '/', httpOnly: true });
  await p.send('Page.navigate', { url: `${B.gw.publicUrl}/#settings` });
  let loaded = false;
  for (let i = 0; i < 100 && !loaded; i++) { loaded = (await p.ev('document.title').catch(() => '')) === 'devteam'; if (!loaded) await sleep(100); }
  if (!loaded) return null;
  const until = async (what, expr, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await p.ev(expr).catch(() => false)) return; await sleep(100); } assert.fail(`waited for ${what}: ${expr}`); };
  return { ...p, until };
}
const groups = `[...document.querySelectorAll('#hub-settings .sec > .lbl')].map((x) => x.textContent)`;

test('org-access A3: in Chrome, a member\'s Settings has no People section; the owner\'s and an admin\'s do', CHROME, async (t) => {
  const B = await box('a3-chrome');
  t.after(() => B.gw.close());
  for (const [who, cookie, want] of [['the owner', B.owner, true], ['Sam', B.samC, true], ['Ana', B.anaC, false]]) {
    const p = await hubAs(t, B, cookie);
    if (!p) return t.skip('headless Chrome can\'t load box.localhost here');
    await p.until(`${who}'s Settings`, `document.querySelectorAll('#hub-settings .sec').length >= 3`);
    if (want) await p.until(`${who}'s People`, `${groups}.includes('People') && document.querySelectorAll('#hub-settings .person').length === 4`);
    else await sleep(1500);
    assert.equal((await p.ev(groups)).includes('People'), want, `${who}: ${await p.ev(groups)}`);
  }
});

// C25, its first half: Your sign-in as the mock words it, on a real gateway
const dMon = (iso) => { const d = new Date(iso); return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`; };
const methodRows = `[...document.querySelectorAll('#hub-settings .set-row.method')].map((r) => r.textContent)`;
const toast = `(document.querySelector('.oa-toast.on')?.textContent ?? '')`;
// how many requests this page made to a path (Resource Timing records every fetch)
const sent = (route) => `performance.getEntriesByType('resource').filter((e) => new URL(e.name).pathname.endsWith(${JSON.stringify(`/${route}`)})).length`;
const removeOf = (label) => `[...document.querySelectorAll('#hub-settings .set-row.method')].find((r) => r.querySelector('.t').textContent.endsWith(${JSON.stringify(label)}))?.querySelector('button')?.click() ?? 'none'`;
// a second passkey for the owner, as the claim stores one (top-level `passkeys`)
function secondOwnerKey(gw, name = 'Phone') {
  const s = gw.state();
  const k = { ...s.passkeys[0], id: u(crypto.randomBytes(16)), name, createdAt: new Date().toISOString() };
  delete k.usedAt;
  gw.write({ ...s, passkeys: [...s.passkeys, k] });
  return k;
}

test('org-access A3: in Chrome, Your sign-in works as the mock does', CHROME, async (t) => {
  const B = await box('a3-signin');
  t.after(() => B.gw.close());
  // Ana's passkey came by a new link: its notice, and a method added at the same minute
  const at = new Date(Date.now() - 3 * 864e5).toISOString();
  const s = B.gw.state();
  const label = B.ana.methods[0].label;
  B.gw.write({ ...s, people: s.people.map((p) => (p.id !== B.ana.id ? p : { ...p, methods: p.methods.map((m) => ({ ...m, added_at: at })), notices: [{ kind: 'method-added', at, type: 'passkey', label, method: p.methods[0].id, shown_at: null }] })) });
  const a = await hubAs(t, B, B.anaC);
  if (!a) return t.skip('headless Chrome can\'t load box.localhost here');
  await a.until('Ana\'s Your sign-in', `${groups}.includes('Your sign-in') && document.querySelectorAll('#hub-settings .set-row.method').length === 1`);
  assert.equal(await a.ev(`document.querySelector('#oa-notice p')?.textContent`), `A sign-in method (a passkey) was added to your account on ${dMon(at)}, from a new link the box's owner sent. If you didn't ask for one, tell them.`);
  assert.deepEqual(await a.ev(methodRows), [`Passkey · ${label}added ${dMon(at)} by a new link · used neverRemove`], 'her row, added by a new link');
  await a.ev(`document.querySelector('#oa-notice button').click()`);
  await a.until('the notice goes', `!document.querySelector('#oa-notice')`);
  await a.send('Page.reload');
  await a.until('Ana\'s Settings again', `document.querySelectorAll('#hub-settings .set-row.method').length === 1`);
  await sleep(1000);
  assert.equal(await a.ev(`Boolean(document.querySelector('#oa-notice'))`), false, 'OK is kept on this device');
  // her only method: refused in the hub in the mock's words, nothing sent
  await a.ev(removeOf(label));
  await a.until('the last-method words', `${toast} === "Your last sign-in method can't be removed; add another first"`);
  assert.equal(await a.ev(sent('auth/method/remove')), 0, 'nothing sent');
  assert.equal(rowOf(B.gw, B.ana.id).methods.length, 1, 'she keeps it');
  // Add a passkey: the gateway's add ceremony, through this device's (virtual) authenticator
  await a.send('WebAuthn.enable');
  await a.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
  await a.ev(clickText('#hub-settings button', 'Add a passkey'));
  await a.until('the added toast', `${toast} === 'Passkey added. Your device asked to make one'`);
  await a.until('two methods', `document.querySelectorAll('#hub-settings .set-row.method').length === 2`);
  assert.equal(rowOf(B.gw, B.ana.id).methods.length, 2, 'the box holds her new passkey');

  // the owner's only passkey: refused in the hub, nothing sent
  const p = await hubAs(t, B, B.owner);
  await p.until('the owner\'s Your sign-in', `document.querySelectorAll('#hub-settings .set-row.method').length === 1`);
  assert.equal(await p.ev(`document.querySelector('#hub-settings .oa-intro').textContent`), 'Any of these signs you in to this box as you. Today a sign-in method is a passkey; other ways to sign in can be added here later. Keep at least one, and as the owner, at least one passkey.', 'the owner\'s intro');
  const only = B.gw.state().passkeys[0];
  assert.match((await p.ev(methodRows))[0], new RegExp(`^Passkey · ${only.name}added ${dMon(only.createdAt)} · used `), 'the owner\'s row');
  await p.ev(removeOf(only.name));
  await p.until('the last-passkey words', `${toast} === "Your last passkey can't be removed: the box would look unclaimed. Add another first"`);
  assert.equal(B.gw.state().passkeys.length, 1, 'the box still holds it');
  // a second, removed
  const phone = secondOwnerKey(B.gw);
  await p.send('Page.reload');
  await p.until('two methods', `document.querySelectorAll('#hub-settings .set-row.method').length === 2`);
  await p.ev(removeOf('Phone'));
  await p.until('the removed toast', `${toast} === 'Removed. Sessions opened with it were signed out'`);
  // the list asked again right after the change, not at the next 10 s draw
  await p.until('one method again, at once', `document.querySelectorAll('#hub-settings .set-row.method').length === 1`, 1500);
  assert.equal(B.gw.state().passkeys.some((k) => k.id === phone.id), false, 'the box no longer holds it');
  // fresh by the page's count, but the box says otherwise (the session aged meanwhile): the refusal
  // makes the hub ask again, and the answer brings Confirm it's you
  const laptop = secondOwnerKey(B.gw, 'Laptop');
  await p.send('Page.reload');
  await p.until('two methods again', `document.querySelectorAll('#hub-settings .set-row.method').length === 2`);
  const aged = B.gw.state();
  B.gw.write({ ...aged, sessions: aged.sessions.map((x) => ({ ...x, at: STALE_AT() })) });
  await p.ev(removeOf('Laptop'));
  await p.until('Confirm it\'s you after the refusal', `Boolean(document.querySelector('#oa-fresh'))`);
  assert.equal(await p.ev(sent('auth/method/remove')), 1, 'sent once, and refused');
  assert.equal(B.gw.state().passkeys.some((k) => k.id === laptop.id), true, 'Laptop kept');

  // signed in ten minutes ago: Confirm it's you, and nothing sent. Minted now: the removal above
  // ended the owner's other sessions, B.ownerStale with them.
  secondOwnerKey(B.gw, 'Tablet');
  const q = await hubAs(t, B, mint(B.gw, ownerOf(B.gw), { at: STALE_AT() }));
  await q.until('the stale owner\'s methods', `document.querySelectorAll('#hub-settings .set-row.method').length === 3`);
  await q.ev(removeOf('Tablet'));
  await q.until('Confirm it\'s you', `Boolean(document.querySelector('#oa-fresh'))`);
  assert.equal(await q.ev(`document.querySelector('#oa-fresh p').textContent`), "Confirm it's you to change this. You signed in more than five minutes ago; sign in again with your passkey, then make the change again.");
  assert.equal(await q.ev(`document.querySelector('#hub-settings').children[1]?.id`), 'oa-fresh', 'at the top of Settings, under its heading');
  assert.equal(B.gw.state().passkeys.length, 3, 'nothing removed');
  assert.equal(await q.ev(sent('auth/method/remove')), 0, 'nothing sent: the page knew the sign-in was stale');
  await sleep(11000);
  assert.equal(await q.ev(`Boolean(document.querySelector('#oa-fresh'))`), true, 'a repaint keeps the note');
  await q.ev(`document.querySelector('#oa-fresh button').click()`);
  const want = `${B.gw.publicUrl}/auth/login?next=${encodeURIComponent(`${B.gw.publicUrl}/#settings`)}`;
  await q.until('the sign-in page', `location.href === ${JSON.stringify(want)}`);
});

// C25, its second half: the owner's People, each step against the gateway's state
const personSel = (id) => `#hub-settings .person[data-id=${JSON.stringify(id)}]`;
const menuOf = async (p, id) => {
  await p.ev(`document.querySelector(${JSON.stringify(`${personSel(id)} .menu-btn`)}).click()`);
  await p.until('its menu', `Boolean(document.querySelector('.oa-menu'))`);
  return p.ev(`[...document.querySelectorAll('.oa-menu button')].map((b) => b.textContent)`);
};
const pick = (p, words) => p.ev(`[...document.querySelectorAll('.oa-menu button')].find((b) => b.textContent === ${JSON.stringify(words)}).click()`);
const typeIn = (sel, v) => `(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
const clickText = (sel, words) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => b.textContent === ${JSON.stringify(words)}).click()`;
const textOf = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.textContent ?? null)`;
const invitesOf = (gw, id) => (gw.state().invites ?? []).filter((x) => x.person === id);

test('org-access A3: in Chrome, the owner\'s People work as the mock does', CHROME, async (t) => {
  const B = await box('a3-people');
  t.after(() => B.gw.close());
  const p = await hubAs(t, B, B.owner);
  if (!p) return t.skip('headless Chrome can\'t load box.localhost here');
  await p.until('People', `document.querySelectorAll('#hub-settings .person').length === 4`);
  assert.equal(await p.ev(textOf('#oa-people .oa-intro')), 'Everyone here sees everything on this box. Full people can also change anything but People. Admins move members between Full and View only, and rename or remove people; only you invite, make admins or hand the box over. For someone who must not see the rest, set up a box of their own.');
  assert.equal(await p.ev(textOf(`${personSel(B.lee.id)} .pmeta`)), 'Full · invite link not used yet · expires in 24 hours', 'Lee, invited');
  assert.equal(await p.ev(textOf(`${personSel(B.ana.id)} .pmeta`)), '1 sign-in method · never signed in', 'Ana, joined');
  assert.deepEqual(await p.ev(`[...document.querySelectorAll('#hub-settings .person .badge')].map((b) => b.textContent)`), ['Owner', 'Admin', 'Full', 'invited']);
  assert.equal(await p.ev(textOf(`${personSel(B.ownerRow.id)} .nm`)), 'Owner (you) Owner', 'the owner\'s own row');

  // the menu: Escape gives the keyboard back to its ⋯, a click outside closes it, and while it is
  // open the 10 s fetch waits; once it closes, the list catches up
  await menuOf(p, B.lee.id);
  await p.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`);
  await p.until('Escape closes it', `!document.querySelector('.oa-menu') && document.activeElement?.dataset.k === ${JSON.stringify(`settings:menu:${B.lee.id}`)}`);
  await menuOf(p, B.lee.id);
  await p.ev(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true`);
  await p.until('a click outside closes it', `!document.querySelector('.oa-menu')`);
  await menuOf(p, B.lee.id);
  const w = B.gw.state();
  B.gw.write({ ...w, people: w.people.map((x) => (x.id === B.lee.id ? { ...x, name: 'Lee Park B', rev: x.rev + 1 } : x)) });
  await sleep(11000);
  assert.equal(await p.ev(`Boolean(document.querySelector('.oa-menu'))`), true, 'the menu stays open through the repaint');
  assert.ok((await p.ev(textOf(`${personSel(B.lee.id)} .nm`))).startsWith('Lee Park '), 'and the list waits');
  assert.ok(!(await p.ev(textOf(`${personSel(B.lee.id)} .nm`))).startsWith('Lee Park B'), 'the list waited while the menu was open');
  await p.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`);
  await p.until('the list catches up at the next draw', `${textOf(`${personSel(B.lee.id)} .nm`)}?.startsWith('Lee Park B')`, 12000);
  // an action this hub doesn't know (a newer gateway's) is left out, never a blank item
  await p.ev(`OA.list.people.find((x) => x.id === ${JSON.stringify(B.ownerRow.id)}).actions.push('level'); oaDrawPeople(); true`);
  assert.deepEqual(await menuOf(p, B.ownerRow.id), ['Rename'], 'no blank item');
  await p.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`);

  // Ana's menu; Rename
  assert.deepEqual(await menuOf(p, B.ana.id), ['Rename', 'Send a new link', 'Remove']);
  await pick(p, 'Rename');
  await p.until('the rename box', `Boolean(document.querySelector('#oa-rename input'))`);
  assert.equal(await p.ev(textOf('#oa-rename p')), 'Their name, as everyone here sees it:');
  for (const [v, words] of [['', 'A name is needed.'], ['Sam Rivera', 'Someone here already has that name.']]) {
    await p.ev(typeIn('#oa-rename input', v));
    await p.ev(clickText('#oa-rename button', 'Save'));
    await p.until(`"${words}"`, `${JSON.stringify(words)} === ${textOf('#oa-rename .oa-err')}`);
    assert.deepEqual([rowOf(B.gw, B.ana.id).name, rowOf(B.gw, B.ana.id).rev], ['Ana Costa', 1], `nothing changed for ${JSON.stringify(v)}`);
  }
  await p.ev(typeIn('#oa-rename input', '<i>Ana</i>'));
  await p.ev(clickText('#oa-rename button', 'Save'));
  await p.until('the rename toast', `${toast} === 'Renamed to <i>Ana</i>'`);
  await p.until('the row renamed, as text', `${textOf(`${personSel(B.ana.id)} .nm`)}?.startsWith('<i>Ana</i>')`);
  assert.equal(await p.ev(`document.querySelectorAll('#hub-settings .person i').length`), 0, 'a name is only ever text');
  await menuOf(p, B.ana.id);
  await pick(p, 'Rename');
  await p.until('the rename box', `Boolean(document.querySelector('#oa-rename input'))`);
  await p.ev(typeIn('#oa-rename input', 'Ana C'));
  await p.ev(clickText('#oa-rename button', 'Save'));
  await p.until('the rename toast', `${toast} === 'Renamed to Ana C'`);
  assert.deepEqual([rowOf(B.gw, B.ana.id).name, rowOf(B.gw, B.ana.id).rev], ['Ana C', 3], 'renamed, rev moved on');
  await p.until('the row renamed', `${textOf(`${personSel(B.ana.id)} .nm`)}?.startsWith('Ana C')`);

  // Send a new link: the confirm, the link card, kept across a repaint
  const old = seedInvite(B.gw, B.ana.id, { expires: Date.now() - 1000 });
  await menuOf(p, B.ana.id);
  await pick(p, 'Send a new link');
  assert.equal(await p.ev(textOf('#oa-confirm p')), 'Make a new link for Ana? Opening it adds a sign-in method (a passkey) to their account; their others keep working. Use it when they lost theirs. They are told one was added.');
  await p.ev(clickText('#oa-confirm button', 'Make the link'));
  await p.until('the link card', `Boolean(document.querySelector('#oa-link code'))`);
  assert.equal(await p.ev(textOf('#oa-link h3')), 'Send this link to Ana yourself');
  assert.equal(await p.ev(textOf('#oa-link p')), 'It works once, for 24 hours. Opening it adds a passkey to Ana\'s account.');
  assert.equal(await p.ev(textOf('#oa-link .oa-warn')), 'Send it privately, in a message to them, not in a thread on this box: whoever opens it first can use it. It is shown only now.');
  assert.equal(await p.ev(`document.querySelector('#oa-people .oa-plist').hidden`), true, 'the rows hide under the card');
  const url = await p.ev(textOf('#oa-link code'));
  assert.ok(url.startsWith(`${B.gw.publicUrl}/auth/claim#`), url);
  const ana = invitesOf(B.gw, B.ana.id);
  assert.equal(ana.length, 1, 'one invite for Ana');
  assert.notEqual(ana[0].hash, u(sha(old)), 'the old one gone, a new one made');
  await p.ev(`(() => { const f = window.fetch; window.fetch = (u, o) => (String(u).includes('people/list') ? (window.fetch = f, Promise.resolve(new Response('', { status: 502 }))) : f(u, o)); return oaLoad().then(() => { paintSettings(); return true; }); })()`);
  assert.equal(await p.ev(textOf('#oa-link code')), url, 'a failed fetch of the list keeps the card, through a repaint');
  assert.equal(await p.ev(`Boolean(document.querySelector('#oa-people')?.isConnected)`), true, 'and People');
  await p.ev(clickText('#oa-link button', 'Copy'));
  await p.until('Copied', `${JSON.stringify('Copied')} === [...document.querySelectorAll('#oa-link button')].map((b) => b.textContent).find((x) => x.startsWith('Cop'))`);
  await sleep(11000);
  assert.equal(await p.ev(textOf('#oa-link code')), url, 'the card and its link outlive the repaint');
  await p.ev(clickText('#oa-link button', 'Done'));
  await p.until('the rows again', `!document.querySelector('#oa-link') && !document.querySelector('#oa-people .oa-plist').hidden`);
  assert.deepEqual(await p.ev(`[OA.link, document.body.innerHTML.includes(${JSON.stringify(url)})]`), [null, false], 'Done drops the link');
  await p.until('Ana\'s new link shows', `${textOf(`${personSel(B.ana.id)} .pmeta`)}?.endsWith(' · a new link not used yet')`);

  // task-5 F3: Revoke a new link: her methods stay, the link goes
  assert.deepEqual(await menuOf(p, B.ana.id), ['Revoke the link', 'Rename', 'Remove']);
  await pick(p, 'Revoke the link');
  assert.equal(await p.ev(textOf('#oa-confirm p')), 'Revoke Ana\'s new link? It stops working now; their sign-in methods keep working.');
  await p.ev(clickText('#oa-confirm button', 'Revoke'));
  await p.until('the new-link revoke toast', `${toast} === "Ana's new link no longer works"`);
  assert.deepEqual([rowOf(B.gw, B.ana.id)?.methods.length, invitesOf(B.gw, B.ana.id)], [1, []], 'her row and method stay; her link goes');
  await p.until('Ana\'s line without the link', `${textOf(`${personSel(B.ana.id)} .pmeta`)} === '1 sign-in method · never signed in'`);

  // Revoke Lee's invite
  assert.deepEqual(await menuOf(p, B.lee.id), ['Revoke the link']);
  await pick(p, 'Revoke the link');
  assert.equal(await p.ev(textOf('#oa-confirm p')), 'Revoke Lee\'s invite link? It stops working now.');
  await p.ev(clickText('#oa-confirm button', 'Revoke'));
  await p.until('the revoke toast', `${toast} === "Lee's invite link no longer works"`);
  assert.deepEqual([rowOf(B.gw, B.lee.id), invitesOf(B.gw, B.lee.id)], [null, []], 'Lee\'s row and invite gone');
  await p.until('three rows', `document.querySelectorAll('#hub-settings .person').length === 3`);

  // Remove Ana
  assert.deepEqual(await menuOf(p, B.ana.id), ['Rename', 'Send a new link', 'Remove']);
  await pick(p, 'Remove');
  assert.equal(await p.ev(textOf('#oa-confirm p')), 'Remove Ana? They are signed out everywhere now, and their sign-in methods stop working. What they did with the terminal stays, such as a program left running or a login copied; if that matters, change the box\'s logins.');
  await p.ev(`(() => { const b = [...document.querySelectorAll('#oa-confirm button')].find((x) => x.textContent === 'Remove'); b.click(); b.click(); return true; })()`);
  await p.until('the remove toast', `${toast} === 'Ana was removed and signed out'`);
  await sleep(800);
  assert.equal(await p.ev(toast), 'Ana was removed and signed out', 'a double click sends one request (no stale toast after)');
  assert.equal(await p.ev(sent('auth/people/remove')), 1, 'one remove sent');
  const s = B.gw.state();
  assert.deepEqual([rowOf(B.gw, B.ana.id), (s.peopleSessions ?? []).filter((x) => x.person === B.ana.id), invitesOf(B.gw, B.ana.id)], [null, [], []], 'Ana\'s row, sessions and invites gone');
  await p.until('two rows', `document.querySelectorAll('#hub-settings .person').length === 2`);

  // Invite someone: the Full card alone
  await p.ev(clickText('#oa-people button', 'Invite someone'));
  await p.until('the invite card', `Boolean(document.querySelector('#oa-invite input'))`);
  assert.equal(await p.ev(textOf('#oa-invite h3')), 'Invite someone');
  assert.equal(await p.ev(textOf('#oa-invite p')), 'They get a link that works once, for 24 hours. You send it to them yourself.');
  assert.equal(await p.ev(`document.querySelector('#oa-invite input').placeholder`), 'Their name');
  assert.deepEqual(await p.ev(`[...document.querySelectorAll('#oa-invite .lvl-opt b')].map((b) => b.textContent)`), ['Full'], 'Full alone');
  assert.equal(await p.ev(`[...document.querySelectorAll('#oa-people button')].some((b) => b.textContent === 'Invite someone')`), false, 'no second card while one is open');
  const count = B.gw.state().people.length;
  await p.ev(clickText('#oa-invite button', 'Make the invite link'));
  await p.until('the blank-name words', `${textOf('#oa-invite .oa-err')} === 'Give them a name, so you can tell people apart here.'`);
  assert.equal(B.gw.state().people.length, count, 'nothing made');
  await p.ev(typeIn('#oa-invite input', 'sam rivera'));
  await p.ev(clickText('#oa-invite button', 'Make the invite link'));
  await p.until('the taken-name words', `${textOf('#oa-invite .oa-err')} === 'Someone here already has that name.'`);
  assert.equal(B.gw.state().people.length, count, 'nothing made');
  await p.ev(typeIn('#oa-invite input', 'Kim Lee'));
  await p.ev(clickText('#oa-invite button', 'Make the invite link'));
  await p.until('Kim\'s link card', `${textOf('#oa-link h3')} === 'Send this link to Kim yourself'`);
  assert.equal(await p.ev(textOf('#oa-link p')), 'It works once, for 24 hours. Whoever opens it first makes a passkey and joins as full.');
  const kim = B.gw.state().people.find((x) => x.name === 'Kim Lee');
  assert.ok(kim, 'Kim\'s row');
  assert.equal(invitesOf(B.gw, kim.id).length, 1, 'and her invite');
  await p.ev(clickText('#oa-link button', 'Done'));
  await p.until('three rows again', `document.querySelectorAll('#hub-settings .person').length === 3`);

  // a rename box with typed text outlives the repaint; then Sam goes in another tab
  await menuOf(p, B.sam.id);
  await pick(p, 'Rename');
  await p.until('Sam\'s rename box', `Boolean(document.querySelector('#oa-rename input'))`);
  await p.ev(typeIn('#oa-rename input', 'Sam typed'));
  await sleep(11000);
  assert.equal(await p.ev(`document.querySelector('#oa-rename input')?.value ?? null`), 'Sam typed', 'still open, with what was typed');
  await p.ev('oaDrawPeople(); paintSettings(); true');
  assert.equal(await p.ev(`document.querySelector('#oa-rename input')?.value ?? null`), 'Sam typed', 'and across a redraw of the section itself');
  const t2 = B.gw.state();
  B.gw.write({ ...t2, people: t2.people.filter((x) => x.id !== B.sam.id) });
  await p.ev(clickText('#oa-rename button', 'Save'));
  await p.until('the stale toast', `${toast} === ${JSON.stringify(STALE)}`);
  await p.until('Sam\'s row gone', `!document.querySelector(${JSON.stringify(personSel(B.sam.id))})`);

  // signed in ten minutes ago: Confirm it's you, nothing sent
  const q = await hubAs(t, B, mint(B.gw, ownerOf(B.gw), { at: STALE_AT() }));
  const o = ownerOf(B.gw);
  await q.until('the stale owner\'s People', `document.querySelectorAll('#hub-settings .person').length === 2`);
  assert.deepEqual(await menuOf(q, o.id), ['Rename']);
  await pick(q, 'Rename');
  await q.until('the rename box', `Boolean(document.querySelector('#oa-rename input'))`);
  assert.equal(await q.ev(textOf('#oa-rename p')), 'Your name, as others here see it:');
  await q.ev(typeIn('#oa-rename input', 'Robin'));
  await q.ev(clickText('#oa-rename button', 'Save'));
  await q.until('Confirm it\'s you', `Boolean(document.querySelector('#oa-fresh'))`);
  assert.deepEqual(ownerOf(B.gw), o, 'the owner\'s row unchanged');
});

test('org-access A3: in Chrome, an admin\'s People: the admin\'s words, each row\'s line, and no menu or Invite', CHROME, async (t) => {
  const B = await box('a3-admin');
  t.after(() => B.gw.close());
  const s = B.gw.state();
  B.gw.write({ ...s, people: s.people.map((x) => (x.id === B.ana.id ? { ...x, last_seen: new Date(Date.now() - 2 * 3600e3).toISOString() } : x)), invites: s.invites.map((x) => (x.person === B.lee.id ? { ...x, expires: Date.now() - 1000 } : x)) });
  const p = await hubAs(t, B, B.samC);
  if (!p) return t.skip('headless Chrome can\'t load box.localhost here');
  await p.until('Sam\'s People', `document.querySelectorAll('#hub-settings .person').length === 4`);
  assert.equal(await p.ev(textOf('#oa-people .oa-intro')), "You're an admin: you can move members between Full and View only, and rename or remove members and other admins. Only the owner invites, makes admins or hands the box over, and nobody changes the owner's row.");
  assert.equal(await p.ev(`document.querySelectorAll('#hub-settings .person .menu-btn').length`), 0, 'no menus: nothing here is an admin\'s to change yet');
  assert.equal(await p.ev(`[...document.querySelectorAll('#oa-people button')].some((b) => b.textContent === 'Invite someone')`), false, 'no Invite someone');
  assert.equal(await p.ev(textOf(`${personSel(B.sam.id)} .nm`)), 'Sam Rivera (you) Admin', 'his own row');
  assert.equal(await p.ev(textOf(`${personSel(B.sam.id)} .pmeta`)), '1 sign-in method · never signed in');
  assert.equal(await p.ev(textOf(`${personSel(B.ana.id)} .pmeta`)), '1 sign-in method · signed in 2 h ago');
  assert.equal(await p.ev(textOf(`${personSel(B.lee.id)} .pmeta`)), 'Full · invite link expired');
});
