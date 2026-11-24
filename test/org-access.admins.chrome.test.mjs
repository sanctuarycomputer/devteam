// Admins' Chrome tests (split out of test/org-access.admins.test.mjs by kit-798): the hub's People page,
// driven in a real Chrome against a real gateway. They skip without Chrome and a Node with WebSocket.
// Run: node --test test/org-access.admins.chrome.test.mjs
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// the suite's shared env scrub and tmux shim
import './lib/kit.mjs';
import { canDrive, openChrome } from './lib/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const NEW = path.join(repo, 'cloud', 'gateway.mjs');
const HUB_PAGE = path.join(repo, 'docs', 'devteam', 'dashboard', 'hub.html');
// ports of its own, apart from test/gateway.test.mjs's (10000 + …) and lib/kit.mjs's blocks (20000 and up);
// +25 keeps it apart from admins' and people-state's +0/+1
const HUB = 15000 + (process.pid % 90) * 50 + 25;
const P = HUB + 1;
process.env.DEVTEAM_HUB_PORT = String(HUB);
process.env.DEVTEAM_PORT_BASE = String(P);
process.env.DEVTEAM_HUB_RETRY_MS = '500';
delete process.env.DEVTEAM_CLAIM_TOKEN;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-admins-chrome-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

const sha = (b) => crypto.createHash('sha256').update(b).digest();
const u = (b) => Buffer.from(b).toString('base64url');
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const rid = (prefix) => prefix + Array.from(crypto.randomBytes(12), (x) => B32[x & 31]).join('');
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
  return { g, port, publicUrl, inst, term, logs, token, dir, file, req, claim, login, state, write, seed, jar: () => jar, flow: () => flowJar, setJar: (v) => { jar = v; }, // a socket a browser opened ahead and never sent on would hold server.close (kit-798)
    close: () => new Promise((r) => { g.server.close(r); g.server.closeAllConnections(); }) };
}

const rowOf = (s, id) => s.people.find((p) => p.id === id);
const ownerOf = (s) => s.people.filter((p) => p.role === 'owner');
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
const post = (gw, cookie, action, body) => gw.req('POST', `/auth/people/${action}`, { cookie, body });

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
const accepts = async (gw, cookie, action, body, what) => {
  const r = await post(gw, cookie, action, body);
  assert.equal(r.status, 200, `${what}: ${r.status} ${r.body}`);
  return r;
};
const rev = (gw, id) => rowOf(gw.state(), id).rev;


// kit-798: a browser can open a socket and send nothing on it yet (a socket opened ahead); Node's
// server.close() waits for it, so the harness's close must end it
test('kit-798: the gateway\'s close ends a socket that never sent a request, at once', async () => {
  const gw = await gateway('close-held');
  const s = net.connect(gw.port, '127.0.0.1');
  await new Promise((r, j) => { s.once('connect', r); s.once('error', j); });
  // a request on another socket, answered, so the server has started serving
  assert.equal((await gw.req('GET', '/auth/login', { cookie: '' })).status < 500, true);
  const ended = new Promise((r) => s.once('close', r));
  const closed = gw.close().then(() => 'closed');
  const at = await Promise.race([closed, new Promise((r) => setTimeout(() => r('still waiting after 5 s'), 5000))]);
  s.destroy();
  assert.equal(at, 'closed', 'the gateway\'s close, with a socket open that sent nothing');
  await ended;
});

// --- the hub's People, in Chrome, on a real gateway (kit-249's harness, copied, not imported) -----
// The hub page asks the hub for its projects; a stand-in on HUB answers, started with the first page.
let hubStandIn = null;
const standInHub = () => {
  if (hubStandIn) return hubStandIn;
  const srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url.startsWith('/operator/')) return res.end(JSON.stringify(req.method === 'GET' ? { operator: { state: 'ready' }, threads: [] } : { ok: true, out: 'ot-1' }));
      res.end(JSON.stringify({ hub: 1, kit: 'v0.0.0', instances: [] }));
    });
  });
  hubStandIn = new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(HUB, '127.0.0.1', () => resolve(srv)); });
  after(async () => { const s = await hubStandIn; s.closeAllConnections?.(); s.close(); });
  return hubStandIn;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 240000 };
// kit-798: a Chrome holds a socket open that it never sent on, and Node's server.close waits for it, so a test's
// teardown closes its Chromes first, then its gateway
const chromesOf = new WeakMap();
async function teardown(t, gw) { try { for (const c of chromesOf.get(t) ?? []) await c.close(); } finally { await gw.close(); } }
async function hubAs(t, gw, cookie, { width = 1280, height = 900 } = {}) {
  await standInHub();
  const chrome = await openChrome();
  chromesOf.set(t, [...(chromesOf.get(t) ?? []), chrome]);
  const p = await chrome.newPage();
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  const [name, value] = cookie.split('=');
  await p.send('Network.enable');
  await p.send('Network.setCookie', { name, value, domain: 'box.localhost', path: '/', httpOnly: true });
  await p.send('Page.navigate', { url: `${gw.publicUrl}/#settings` });
  let loaded = false;
  for (let i = 0; i < 100 && !loaded; i++) { loaded = (await p.ev('document.title').catch(() => '')) === 'devteam'; if (!loaded) await sleep(100); }
  assert.ok(loaded, 'the hub loads from the gateway');
  // each evaluate gets 5 s: one that never answers (a page mid-navigation) can't hold the wait past its deadline
  const evSoon = (expr) => Promise.race([p.ev(expr).catch(() => false), sleep(5000).then(() => false)]);
  const until = async (what, expr, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await evSoon(expr)) return; await sleep(100); } assert.fail(`waited for ${what}: ${expr}`); };
  return { ...p, until };
}
const personSel = (id) => `#hub-settings .person[data-id=${JSON.stringify(id)}]`;
const groups = `[...document.querySelectorAll('#hub-settings .sec > .lbl')].map((x) => x.textContent)`;
const toastNow = `(document.querySelector('.oa-toast.on')?.textContent ?? '')`;
const textOf = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.textContent ?? null)`;
// the menu's red items: Remove, Leave this box, Revoke the link; nothing else
const redItems = (p) => p.ev(`[...document.querySelectorAll('.oa-menu button.red')].map((b) => b.textContent)`);
const menuOf = async (p, id) => {
  await p.ev(`document.querySelector('.oa-menu') && document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await p.until('its ⋯', `Boolean(document.querySelector(${JSON.stringify(`${personSel(id)} .menu-btn`)}))`);
  await p.ev(`document.querySelector(${JSON.stringify(`${personSel(id)} .menu-btn`)}).click()`);
  await p.until('its menu', `Boolean(document.querySelector('.oa-menu'))`);
  return p.ev(`[...document.querySelectorAll('.oa-menu button')].map((b) => b.textContent)`);
};
const pick = (p, words) => p.ev(`[...document.querySelectorAll('.oa-menu button')].find((b) => b.textContent === ${JSON.stringify(words)}).click()`);
// the confirmation's words and its yes button, then yes
const confirmed = async (p, words, yes) => {
  await p.until('the confirmation', `Boolean(document.querySelector('#oa-confirm'))`);
  assert.equal(await p.ev(textOf('#oa-confirm p')), words, 'the confirmation, in the mock\'s words');
  assert.equal(await p.ev(`document.querySelector('#oa-confirm .acts button').textContent`), yes, 'its yes button');
  assert.equal(await p.ev(`document.querySelector('#oa-confirm .acts button').classList.contains('danger')`), yes === 'Remove' || yes === 'Leave', `${yes}: red only for Remove and Leave`);
  await p.ev(`document.querySelector('#oa-confirm .acts button').click()`);
};
const toasted = (p, words) => p.until(`the toast "${words}"`, `${toastNow} === ${JSON.stringify(words)}`);
const peopleShown = (p, n) => p.until('People', `document.querySelectorAll('#hub-settings .person').length === ${n}`);

test('org-access A16: in Chrome, the owner\'s Make admin, Take Admin away, Make full and Make owner work as the mock does', CHROME, async (t) => {
  const { gw, C, kai, ana, vic, bea } = await box('a16-hub');
  t.after(() => teardown(t, gw));
  invite(gw, kai.id, Date.now() - 1);
  const p = await hubAs(t, gw, C.owner);
  await peopleShown(p, 7);
  // an expired new link still shows, and offers Revoke, until it is revoked (R3)
  assert.ok((await p.ev(textOf(`${personSel(kai.id)} .pmeta`))).endsWith(' · a new link expired'), 'Kai\'s line names his expired link');
  assert.deepEqual(await menuOf(p, kai.id), ['Revoke the link', 'Rename', 'Remove'], 'Kai, an expired link: Revoke first, no Make admin or Make owner');
  assert.deepEqual(await menuOf(p, vic.id), ['Rename', 'Make full', 'Make admin', 'Make owner', 'Send a new link', 'Remove'], 'Vic (View): the mock\'s order');
  assert.deepEqual(await redItems(p), ['Remove'], 'only Remove is red');
  await pick(p, 'Make admin');
  await p.until('the confirmation', `Boolean(document.querySelector('#oa-confirm'))`);
  assert.equal(await p.ev(textOf('#oa-confirm p')), 'Make Vic an admin? They can then move members between Full and View only, and rename or remove members and other admins. They can\'t invite, make admins, or touch your row. They become Full too.', 'a View member: Full too');
  await p.ev(`[...document.querySelectorAll('#oa-confirm button')].find((b) => b.textContent === 'Cancel').click()`);
  await menuOf(p, vic.id);
  await pick(p, 'Make full');
  await confirmed(p, 'Make Vic full? They can then change anything except People, and open the terminal, which reaches every repo and the box\'s GitHub and AI logins.', 'Make full');
  await toasted(p, 'Vic is now full');
  assert.equal(rowOf(gw.state(), vic.id).level, 'full', 'Vic is Full');
  await p.until('Vic\'s badge', `${textOf(`${personSel(vic.id)} .badge`)} === 'Full'`);
  assert.deepEqual(await menuOf(p, ana.id), ['Rename', 'Make admin', 'Make owner', 'Send a new link', 'Remove'], 'Ana (Full)');
  await pick(p, 'Make admin');
  await confirmed(p, 'Make Ana an admin? They can then move members between Full and View only, and rename or remove members and other admins. They can\'t invite, make admins, or touch your row.', 'Make admin');
  await toasted(p, 'Ana is now an admin');
  assert.deepEqual([rowOf(gw.state(), ana.id).role, rowOf(gw.state(), ana.id).level], ['admin', 'full'], 'Ana is an admin');
  await p.until('Ana\'s badge', `${textOf(`${personSel(ana.id)} .badge`)} === 'Admin'`);
  assert.deepEqual(await menuOf(p, ana.id), ['Rename', 'Take Admin away', 'Make owner', 'Send a new link', 'Remove'], 'Ana (admin)');
  await pick(p, 'Take Admin away');
  await confirmed(p, 'Take Admin away from Ana? They stay Full, and can no longer manage people.', 'Take Admin away');
  await toasted(p, 'Ana is no longer an admin');
  assert.deepEqual([rowOf(gw.state(), ana.id).role, rowOf(gw.state(), ana.id).level], ['member', 'full'], 'Ana is a Full member');
  const beaMenu = await menuOf(p, bea.id);
  assert.ok(!beaMenu.includes('Make admin') && !beaMenu.includes('Make owner'), `Bea: no Make admin or Make owner with a link out: ${beaMenu}`);
  await menuOf(p, vic.id);
  await pick(p, 'Make owner');
  await confirmed(p, 'Make Vic the owner of this box? Vic can then invite, make admins and hand it over again. You become an admin. Only Vic can undo this.', 'Make Vic the owner');
  await toasted(p, 'Vic is now the owner. You are an admin');
  assert.deepEqual(ownerOf(gw.state()).map((x) => x.id), [vic.id], 'Vic is the owner');
  await p.until('the admin\'s intro', `${textOf('#oa-people .oa-intro')}?.startsWith("You're an admin")`);
  assert.equal(await p.ev(`[...document.querySelectorAll('#oa-people button')].some((b) => b.textContent === 'Invite someone')`), false, 'no Invite someone');
  await p.until('Your sign-in without the owner\'s words', `![...document.querySelectorAll('#hub-settings .oa-intro')].some((x) => x.textContent.includes('as the owner, at least one passkey'))`);
});

test('org-access A15: in Chrome, an admin\'s Rename, Make full, Remove and Leave work as the mock does', CHROME, async (t) => {
  const { gw, C, owner, sam, kai, ana, vic, lee } = await box('a15-hub');
  t.after(() => teardown(t, gw));
  const p = await hubAs(t, gw, C.sam);
  await peopleShown(p, 7);
  assert.deepEqual(await menuOf(p, vic.id), ['Rename', 'Make full', 'Remove'], 'Vic (View)');
  assert.deepEqual(await menuOf(p, kai.id), ['Rename', 'Remove'], 'Kai (admin)');
  await p.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  for (const [row, what] of [[owner, 'the owner\'s row'], [lee, 'Lee\'s (never joined)']]) assert.equal(await p.ev(`document.querySelectorAll(${JSON.stringify(`${personSel(row.id)} .menu-btn`)}).length`), 0, `no ⋯ on ${what}`);
  await menuOf(p, ana.id);
  await pick(p, 'Rename');
  await p.until('the rename box', `Boolean(document.querySelector('#oa-rename input'))`);
  await p.ev(`(() => { const i = document.querySelector('#oa-rename input'); i.value = 'Ana Costa-Ruiz'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await p.ev(`[...document.querySelectorAll('#oa-rename button')].find((b) => b.textContent === 'Save').click()`);
  await toasted(p, 'Renamed to Ana Costa-Ruiz');
  assert.equal(rowOf(gw.state(), ana.id).name, 'Ana Costa-Ruiz', 'renamed');
  await menuOf(p, vic.id);
  await pick(p, 'Make full');
  await confirmed(p, 'Make Vic full? They can then change anything except People, and open the terminal, which reaches every repo and the box\'s GitHub and AI logins.', 'Make full');
  await toasted(p, 'Vic is now full');
  assert.equal(rowOf(gw.state(), vic.id).level, 'full', 'Vic is Full');
  await menuOf(p, ana.id);
  await pick(p, 'Remove');
  await confirmed(p, 'Remove Ana? They are signed out everywhere now, and their sign-in methods stop working. What they did with the terminal stays, such as a program left running or a login copied; if that matters, change the box\'s logins.', 'Remove');
  await toasted(p, 'Ana was removed and signed out');
  assert.equal(rowOf(gw.state(), ana.id), undefined, 'Ana\'s row is gone');
  await peopleShown(p, 6);
  assert.deepEqual(await menuOf(p, sam.id), ['Rename', 'Leave this box'], 'his own row');
  assert.deepEqual(await redItems(p), ['Leave this box'], 'Leave is red');
  await pick(p, 'Leave this box');
  await p.until('the confirmation', `Boolean(document.querySelector('#oa-confirm'))`);
  assert.ok(await p.ev(`document.querySelector('#oa-confirm .acts button').classList.contains('danger')`), 'Leave is red');
  await confirmed(p, 'Leave this box? You are signed out everywhere now, and your sign-in methods stop working. Only the owner can invite you back.', 'Leave');
  // straight there, not by a repaint whose next request finds the session gone (that reload carries ?next=)
  await p.until('the sign-in page', `location.pathname === '/auth/login' && location.search === ''`, 5000);
  assert.equal(rowOf(gw.state(), sam.id), undefined, 'Sam\'s row is gone');
  // Kai's Settings is open when the owner takes his Admin away: at his next list fetch, People goes
  const k = await hubAs(t, gw, C.kai);
  await k.until('Kai\'s People', `${groups}.includes('People')`);
  await accepts(gw, C.owner, 'role', { id: kai.id, rev: rev(gw, kai.id), role: 'member' }, 'the owner takes Admin from Kai');
  await k.until('Kai\'s Settings has no People', `!${groups}.includes('People')`, 30000);
});
