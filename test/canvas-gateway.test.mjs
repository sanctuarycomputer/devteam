// The gateway's part of canvas@1 (cloud/gateway.mjs, kit-660; test/contracts/canvas.md §3 and §8): it
// forwards a /canvas upgrade on a project's name as it does /presence (a session, that name's Origin,
// the person and level it says itself), closes it with the session, and lets a View session hold it;
// a View session's every POST under /api/canvas/ is refused before it reaches the dashboard. The
// dashboard is the contract's fake, behind an instance that records what reached it.
// Ports: hub +0, instances +1 (alpha) and +2 (devteam-dev, a project name shaped like a preview's), the
// gateway +40 (past the instances the hub's list may name).
// Run: node --test --test-concurrency=1 test/canvas-gateway.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PORTS } from './lib/kit.mjs';
import { openCanvas, startCanvasFake, ROUTES } from './lib/canvas-fake.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const DOC = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/canvas/doc-minimal.json'), 'utf8'));
delete process.env.DEVTEAM_CLAIM_TOKEN;
// imported after lib/kit.mjs has set the ports the gateway reads at load
const G = await import(pathToFileURL(path.join(repo, 'cloud', 'gateway.mjs')).href);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-canvas-gw-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const HUB = PORTS;
const ALPHA = PORTS + 1;
const SHAPED = PORTS + 2;
const GATEWAY = PORTS + 40;

const sha = (b) => crypto.createHash('sha256').update(b).digest();
const u = (b) => Buffer.from(b).toString('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listen = (srv, port) => new Promise((ok, no) => { srv.once('error', no); srv.listen(port, '127.0.0.1', () => ok(srv.address().port)); });

// people@1's state, claimed: the owner, Ana (View) and Jo (Full, two sessions), as presence-gateway's.
function seeded(dir) {
  const at = Date.now();
  const iso = new Date().toISOString();
  const top = { id: 'k-owner', userId: 'u', jwk: {}, alg: -7, signCount: 0, name: 'passkey 1', rp: 'box.localhost', createdAt: iso };
  const method = (key) => ({ id: `m-${key}`, type: 'passkey', key, label: 'passkey 1', added_at: iso, last_used: null, data: { userId: 'u', jwk: {}, alg: -7, signCount: 0, rp: 'box.localhost' } });
  const row = (id, name, role, level, methods) => ({ id, name, role, level, methods, pushSubs: [], added_at: iso, last_seen: null, notices: [], rev: 1 });
  const tok = () => crypto.randomBytes(32);
  const t = { owner: tok(), ana: tok(), jo: tok(), jo2: tok() };
  const s = { passkeys: [top], claimHash: null, sessions: [{ hash: u(sha(t.owner)), method: 'k-owner', at, expires: at + 3600e3 }],
    people: [row('p-owner', 'Owner Z', 'owner', 'full', []), row('p-ana', 'Ana', 'member', 'view', [method('ana')]), row('p-jo', 'Jo Ω', 'member', 'full', [method('jo')])],
    peopleSessions: [['ana', 'ana'], ['jo', 'jo'], ['jo2', 'jo']].map(([k, p]) => ({ hash: u(sha(t[k])), person: `p-${p}`, method: `m-${p}`, at, expires: at + 3600e3 })),
    invites: [], peopleStamp: u(sha('devteam-people-stamp-v1\nk-owner')) };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(s));
  return { cookies: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, `devteam_session=${u(v)}`])), hashes: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, u(sha(v))])) };
}

// A dashboard that records each request and upgrade and hands both to the fake, Host and Origin said
// for the fake's port. The answer to an upgrade carries a cookie and the gateway's own header.
async function recorder(port, closers, json = null) {
  const fake = await startCanvasFake({ canvases: { board: DOC } });
  closers.push(() => fake.close());
  const ups = [];
  const reqs = [];
  let silent = false;
  const open = new Set();
  const said = (v) => v.replace(`127.0.0.1:${port}`, `127.0.0.1:${fake.port}`);
  const srv = http.createServer((q, r) => {
    if (json) { q.resume(); r.writeHead(200, { 'content-type': 'application/json' }); return r.end(JSON.stringify(json)); }
    // a HEAD / is nobody's here: something else on the machine may probe a listening port
    if (q.method !== 'HEAD' || q.url !== '/') reqs.push(`${q.method} ${q.url}`);
    const headers = Object.fromEntries(Object.entries(q.headers).map(([k, v]) => [k, typeof v === 'string' ? said(v) : v]));
    const on = http.request({ host: '127.0.0.1', port: fake.port, method: q.method, path: q.url, headers }, (a) => { r.writeHead(a.statusCode, a.headers); a.pipe(r); });
    on.on('error', () => r.destroy());
    return q.pipe(on);
  });
  srv.on('connection', (c) => { open.add(c); c.on('close', () => open.delete(c)); });
  srv.on('upgrade', (q, sock) => {
    sock.on('error', () => {});
    ups.push({ url: q.url, raw: q.rawHeaders, h: q.headers });
    if (silent) return;
    const back = net.connect(fake.port, '127.0.0.1');
    back.on('error', () => sock.destroy());
    sock.on('close', () => back.destroy());
    back.on('close', () => sock.destroy());
    const lines = [];
    for (let i = 0; i < q.rawHeaders.length; i += 2) lines.push(`${q.rawHeaders[i]}: ${said(q.rawHeaders[i + 1])}`);
    back.write(`${q.method} ${q.url} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
    sock.pipe(back);
    back.once('data', (d) => { sock.write(d.toString('latin1').replace('\r\n', '\r\nset-cookie: devteam_session=evil\r\nx-devteam-public: {}\r\n'), 'latin1'); back.pipe(sock); });
  });
  const drop = () => { for (const c of open) c.destroy(); };
  await listen(srv, port);
  closers.push(() => { drop(); return new Promise((r) => srv.close(r)); });
  return { ups, reqs, fake, hush: (v) => { silent = v; }, srv, drop };
}

async function box(t, opts = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'box-'));
  const { cookies, hashes } = seeded(dir);
  // before anything listens: a port that can't be had fails this test alone, not every one after it
  const closers = [];
  t.after(async () => { for (const close of closers.reverse()) await close(); });
  const alpha = await recorder(ALPHA, closers);
  const shaped = await recorder(SHAPED, closers);
  const listed = [['alpha', ALPHA], ['devteam-dev', SHAPED]].map(([name, port]) => ({ devteam: 1, root: `/srv/${name}`, port, name, previews: [] }));
  const hub = await recorder(HUB, closers, { hub: 1, instances: listed });
  const ttyd = net.createServer((c) => { c.on('error', () => {}); c.once('data', () => c.write('HTTP/1.1 101 Switching Protocols\r\nconnection: Upgrade\r\nupgrade: websocket\r\n\r\n')); });
  const ttydPort = await listen(ttyd, 0);
  closers.push(() => ttyd.close());
  const port = GATEWAY;
  const uploadsDir = path.join(dir, 'uploads');
  fs.mkdirSync(uploadsDir, { mode: 0o750 });
  const ttydPage = path.join(dir, 'ttyd.html');
  fs.writeFileSync(ttydPage, 'ttyd');
  const g = G.createGateway({ publicUrl: `http://box.localhost:${port}`, dir, ttydPort, ttydPage, uploadsDir, hubPage: path.join(repo, 'docs/devteam/dashboard/hub.html'), log: () => {}, ...opts });
  const held = new Set();
  g.server.on('connection', (c) => { held.add(c); c.on('close', () => held.delete(c)); });
  await listen(g.server, port);
  closers.push(() => { for (const c of held) c.destroy(); return new Promise((r) => g.server.close(r)); });
  const host = `box.localhost:${port}`;
  const file = path.join(dir, 'state.json');
  const state = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const write = (s) => { fs.writeFileSync(`${file}.t`, JSON.stringify(s)); fs.renameSync(`${file}.t`, file); };
  const named = (name) => (name ? `${name}.${host}` : host);
  // a handshake on a name of the box, through the contract's own client
  const up = (name, { as = null, origin, route = '/canvas?slug=board', headers = {} } = {}) => {
    const h = named(name);
    const asked = openCanvas(`http://127.0.0.1:${port}${route}`, { host: h, origin: origin === undefined ? `http://${h}` : origin, headers: { ...(as ? { cookie: cookies[as] } : {}), ...headers } });
    // a socket the gateway lets through to something that never welcomes: a status of its own
    return Promise.race([asked, sleep(3000).then(() => ({ status: 'no answer in 3 s' }))]);
  };
  const ask = (as, name, method, route, { body = null, headers = {} } = {}) => new Promise((resolve, reject) => {
    const h = named(name);
    const b = body === null ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port, method, path: route, headers: { host: h, origin: `http://${h}`, cookie: cookies[as], ...(b === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) }), ...headers } }, (res) => { let x = ''; res.on('data', (d) => { x += d; }); res.on('end', () => resolve({ status: res.statusCode, body: x })); });
    r.on('error', reject);
    r.end(b ?? undefined);
  });
  const people = (route, body) => ask('owner', null, 'POST', `/auth/people/${route}`, { body });
  const row = (id) => state().people.find((p) => p.id === id);
  return { alpha, shaped, hub, listed, up, ask, people, state, write, row, hashes, host, port, cookies };
}
const opened = (c, what) => { assert.equal(c.status, 101, `${what}: opened (${c.status})`); assert.ok(c.you, `${what}: welcomed`); return c; };
const closes = async (c, what, ms = 1500) => assert.ok(await Promise.race([c.closed.then(() => true), sleep(ms).then(() => false)]), `${what}: still open after ${ms} ms`);
const stays = async (c, what) => assert.ok(await Promise.race([c.closed.then(() => false), sleep(1300).then(() => true)]), `${what}: closed`);
const only = (raw, name) => raw.filter((v, i) => i % 2 === 0 && v.toLowerCase() === name).length;
const FORGED = { 'x-devteam-person': 'p-owner;name=Boss', 'x-devteam-level': 'full' };
const NAMES = [['alpha', 'alpha'], ['devteam-dev', 'shaped']];
// each edit its own client: a client's seq used twice is acknowledged again, not judged
const token = (name) => ({ t: 'edit', client: crypto.randomBytes(8).toString('hex'), seq: 1, ops: [{ op: 'token', path: `color.${name}`, value: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 1] } } }] });

test('canvas gateway: a signed-in upgrade reaches its own dashboard with the gateway\'s person and level, and an edit goes through', async (t) => {
  const B = await box(t);
  for (const [name, at] of NAMES) {
    const c = opened(await B.up(name, { as: 'jo', route: '/canvas?slug=board&x=1' }), at);
    assert.equal(c.you.id, 'p-jo', `${at}: the dashboard was told Jo`);
    const r = B[at].ups.at(-1);
    assert.equal(r.url, '/canvas?slug=board&x=1', `${at}: the query is kept`);
    assert.equal(r.h['x-devteam-person'], `p-jo;name=${encodeURIComponent('Jo Ω')}`);
    assert.equal(r.h['x-devteam-level'], 'full', `${at}: Jo's level`);
    assert.equal(r.h.cookie, undefined, `${at}: no session cookie goes on`);
    assert.equal(c.headers['set-cookie'], undefined, `${at}: the dashboard sets no session`);
    assert.equal(c.headers['x-devteam-public'], undefined, `${at}: nor the gateway's own headers`);
    c.send(token('brand'));
    const m = await c.next((x) => x.t === 'ops');
    assert.equal(m.by.id, 'p-jo', `${at}: the edit is Jo's`);
    assert.equal(B[at].fake.rev('board'), 1, `${at}: applied`);
    c.destroy();
  }
});
test('canvas gateway: the browser\'s person and level never pass, once or twice over', async (t) => {
  const B = await box(t);
  for (const headers of [FORGED, { 'X-Devteam-Person': ['p-owner;name=A', 'p-owner;name=B'], 'X-Devteam-Level': ['full', 'full'] }]) {
    for (const [name, at] of NAMES) {
      const c = opened(await B.up(name, { as: 'ana', headers }), at);
      assert.equal(c.you.id, 'p-ana', `${at}: Ana stays Ana`);
      const r = B[at].ups.at(-1);
      assert.deepEqual([r.h['x-devteam-person'], r.h['x-devteam-level']], ['p-ana;name=Ana', 'view'], `${at}: the gateway's two`);
      assert.deepEqual([only(r.raw, 'x-devteam-person'), only(r.raw, 'x-devteam-level')], [1, 1]);
      c.destroy();
    }
  }
  const { people, peopleSessions, peopleStamp, ...before } = B.state();
  B.write(before);
  const c = opened(await B.up('alpha', { as: 'owner', headers: FORGED }), 'the owner from before people');
  assert.equal(c.you.id, 'owner', 'the dashboard\'s own owner');
  const { raw } = B.alpha.ups.at(-1);
  assert.deepEqual([only(raw, 'x-devteam-person'), only(raw, 'x-devteam-level')], [0, 0], 'no forged header passed');
  c.destroy();
});
test('canvas gateway: 401 without a session, 403 from another Origin or none, and nothing reaches the dashboard', async (t) => {
  const B = await box(t);
  for (const [name, at] of NAMES) {
    assert.equal((await B.up(name)).status, 401, `${at}: signed out`);
    assert.equal((await B.up(name, { headers: { cookie: 'devteam_session=AAAA' } })).status, 401, `${at}: a bad cookie`);
    const other = name === 'alpha' ? 'devteam-dev' : 'alpha';
    for (const origin of ['http://evil.example', `http://term.${B.host}`, `http://${other}.${B.host}`, `http://${B.host}`, `https://${name}.${B.host}`, 'null', null]) {
      assert.equal((await B.up(name, { as: 'jo', origin })).status, 403, `${at}: Origin ${origin}`);
    }
    assert.equal(B[at].ups.length, 0, `${at}: untouched`);
  }
});
test('canvas gateway: a slug the dashboard refuses is told by its status', async (t) => {
  const B = await box(t);
  for (const route of ['/canvas?slug=nosuch', '/canvas?slug=../x', '/canvas']) {
    const n = B.alpha.ups.length;
    assert.equal((await B.up('alpha', { as: 'jo', route })).status, 404, route);
    assert.equal(B.alpha.ups.length, n + 1, `${route}: the dashboard judged it`);
  }
});
test('canvas gateway: the box\'s own name has no canvas, and no reading of the path but the exact one passes', async (t) => {
  const B = await box(t);
  for (const [name, at] of NAMES) {
    opened(await B.up(name, { as: 'owner' }), at).destroy();
    B[at].ups.length = 0;
    for (const route of ['/canvas/', '/canvas/x', '/canvases', '/CANVAS', '//canvas', '/a/../canvas', '/%63anvas', '/x?/canvas', '/canvas.html', '/api/canvas/edit?slug=board', '/ws']) {
      assert.equal((await B.up(name, { as: 'owner', route })).status, 421, `${at} ${route}`);
    }
    assert.equal(B[at].ups.length, 0, `${at}: untouched`);
  }
  assert.equal((await B.up(null, { as: 'owner' })).status, 421, 'the box\'s own name');
  assert.equal(B.hub.ups.length, 0, 'the hub is untouched');
  for (const name of ['nosuch', 'a.alpha', 'public', 'www', 'term']) assert.notEqual((await B.up(name, { as: 'owner' })).status, 101, name);
  const post = await new Promise((resolve) => {
    const c = net.connect(B.port, '127.0.0.1', () => c.write(`POST /canvas?slug=board HTTP/1.1\r\nhost: alpha.${B.host}\r\norigin: http://alpha.${B.host}\r\ncookie: ${B.cookies.jo}\r\nconnection: Upgrade\r\nupgrade: websocket\r\nsec-websocket-version: 13\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`));
    let x = '';
    c.on('error', () => {});
    c.on('data', (d) => { x += d; });
    c.on('close', () => resolve(x));
    setTimeout(() => c.destroy(), 1500);
  });
  assert.match(post, /^HTTP\/1\.1 421 /, 'only a GET is a handshake');
  assert.equal(B.alpha.ups.length, 0, 'and it went nowhere');
});
test('canvas gateway: an upstream with no canvas socket is told by its status, and nothing more of the browser\'s reaches it', async (t) => {
  const B = await box(t);
  const conns = [];
  const held = new Set();
  // a kit from before presence answers as to a plain request and reads on; the bytes of each
  // connection, as a server's parser would hide the ones that come with the handshake
  const old = net.createServer((c) => {
    const x = { bytes: '' };
    conns.push(x);
    held.add(c);
    c.on('error', () => {});
    c.on('data', (d) => { if (!x.bytes) c.write('HTTP/1.1 404 Not Found\r\ncontent-length: 2\r\n\r\nno'); x.bytes += d; });
  });
  await new Promise((r) => B.alpha.srv.close(r) && B.alpha.drop());
  await listen(old, ALPHA);
  try {
    const smuggled = 'POST /api/canvas/image?slug=board HTTP/1.1\r\nhost: 127.0.0.1\r\nx-devteam-person: p-owner;name=Boss\r\nx-devteam-level: full\r\ncontent-length: 0\r\n\r\n';
    const shake = `GET /canvas?slug=board HTTP/1.1\r\nhost: alpha.${B.host}\r\norigin: http://alpha.${B.host}\r\ncookie: ${B.cookies.ana}\r\nconnection: Upgrade\r\nupgrade: websocket\r\nsec-websocket-version: 13\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`;
    for (const early of [false, true]) {
      conns.length = 0;
      const answer = await new Promise((resolve) => {
        const c = net.connect(B.port, '127.0.0.1', () => c.write(shake + (early ? smuggled : '')));
        let x = '';
        c.on('error', () => {});
        c.on('data', (d) => { x += d; if (!early) c.write(smuggled); });
        c.on('close', () => resolve(x));
        setTimeout(() => c.destroy(), 1500);
      });
      await sleep(200);
      const mine = conns.filter((x) => x.bytes.startsWith('GET /canvas?slug=board HTTP/1.1\r\n'));
      assert.equal(mine.length, 1, 'the handshake went on');
      assert.equal(mine[0].bytes.indexOf('\r\n\r\n'), mine[0].bytes.length - 4, early ? 'nothing sent with the handshake went on' : 'nothing sent after the answer went on');
      assert.ok(!conns.some((x) => x.bytes.includes('/api/canvas/image')), 'nor on a connection of its own');
      assert.match(answer, /^HTTP\/1\.1 404 /, 'the browser is told its status');
      assert.equal((answer.match(/HTTP\/1\.1/g) ?? []).length, 1, 'and nothing after it');
    }
  } finally { for (const c of held) c.destroy(); await new Promise((r) => old.close(r)); }
});
test('canvas gateway: signing out closes that session\'s canvases and no other', async (t) => {
  const B = await box(t);
  const a = opened(await B.up('alpha', { as: 'jo' }), 'alpha');
  const b = opened(await B.up('devteam-dev', { as: 'jo' }), 'devteam-dev');
  const other = opened(await B.up('alpha', { as: 'jo2' }), 'Jo\'s other session');
  const ana = opened(await B.up('alpha', { as: 'ana' }), 'Ana');
  assert.equal((await B.ask('jo', null, 'POST', '/auth/logout', { body: {} })).status, 200);
  await Promise.all([closes(a, 'alpha', 400), closes(b, 'devteam-dev', 400)]);
  await Promise.all([stays(other, 'Jo\'s other session'), stays(ana, 'Ana')]);
  assert.equal((await B.up('alpha', { as: 'jo' })).status, 401, 'and it can\'t come back');
});
test('canvas gateway: a session that expires closes its canvas then', async (t) => {
  const B = await box(t);
  const s = B.state();
  B.write({ ...s, peopleSessions: s.peopleSessions.map((x) => (x.hash === B.hashes.jo ? { ...x, expires: Date.now() + 1200 } : x)) });
  const c = opened(await B.up('alpha', { as: 'jo' }), 'alpha');
  await closes(c, 'the expired session', 1600);
});
test('canvas gateway: removing the person closes every canvas of theirs', async (t) => {
  const B = await box(t);
  const [a, b, ana] = [opened(await B.up('alpha', { as: 'jo' }), 'one'), opened(await B.up('devteam-dev', { as: 'jo2' }), 'two'), opened(await B.up('alpha', { as: 'ana' }), 'Ana')];
  const r = await B.people('remove', { id: 'p-jo', rev: B.row('p-jo').rev });
  assert.equal(r.status, 200, r.body);
  await Promise.all([closes(a, 'one', 400), closes(b, 'two', 400)]);
  await stays(ana, 'Ana');
});
test('canvas gateway: a level change either way closes the person\'s canvas, and View comes back unable to edit', async (t) => {
  const B = await box(t);
  const c = opened(await B.up('alpha', { as: 'jo' }), 'Jo, Full');
  const r = await B.people('level', { id: 'p-jo', rev: B.row('p-jo').rev, level: 'view' });
  assert.equal(r.status, 200, r.body);
  await closes(c, 'Jo, made View', 400);
  const again = opened(await B.up('alpha', { as: 'jo' }), 'Jo again');
  again.send(token('brand'));
  assert.equal((await again.next((x) => x.t === 'refused' || x.t === 'ops')).why, 'view', 'the dashboard refuses it');
  const up = await B.people('level', { id: 'p-jo', rev: B.row('p-jo').rev, level: 'full' });
  assert.equal(up.status, 200, up.body);
  await closes(again, 'Jo, made Full', 400);
  const full = opened(await B.up('alpha', { as: 'jo' }), 'Jo, Full again');
  assert.equal(B.alpha.ups.at(-1).h['x-devteam-level'], 'full');
  full.destroy();
});
test('canvas gateway: a session ended by another process closes its canvas, and so does one that ends while the dashboard is slow to answer', async (t) => {
  const B = await box(t);
  const c = opened(await B.up('alpha', { as: 'jo' }), 'Jo');
  const s = B.state();
  B.write({ ...s, peopleSessions: s.peopleSessions.filter((x) => x.hash !== B.hashes.jo) });
  await closes(c, 'after another process\'s write', 2500);
  B.alpha.hush(true);
  const waiting = B.up('alpha', { as: 'jo2' });
  const n = B.alpha.ups.length;
  for (let i = 0; i < 100 && B.alpha.ups.length === n; i++) await sleep(20);
  assert.equal((await B.ask('jo2', null, 'POST', '/auth/logout', { body: {} })).status, 200);
  assert.equal(await Promise.race([waiting.then((x) => x.status), sleep(1000).then(() => 'open')]), undefined, 'closed with no answer');
});
test('canvas gateway: a View person watches another\'s edit live, and their own is refused', async (t) => {
  const B = await box(t);
  const jo = opened(await B.up('alpha', { as: 'jo' }), 'Jo');
  const ana = opened(await B.up('alpha', { as: 'ana' }), 'Ana');
  assert.equal(B.alpha.ups.at(-1).h['x-devteam-level'], 'view', 'Ana\'s level');
  jo.send(token('brand'));
  assert.equal((await ana.next((m) => m.t === 'ops')).by.id, 'p-jo', 'Ana sees Jo\'s edit');
  ana.send(token('other'));
  assert.equal((await ana.next((m) => m.t === 'refused')).why, 'view', 'Ana\'s edit is refused');
  assert.equal(B.alpha.fake.rev('board'), 1, 'and it changed nothing');
});
test('canvas gateway: every POST a View person makes under /api/canvas/ is refused and goes nowhere; a Full person\'s goes on', async (t) => {
  const B = await box(t);
  const posts = ROUTES.filter((r) => r.method === 'POST').map((r) => r.path);
  assert.deepEqual(posts, ['/api/canvas/image', '/api/canvas/local', '/api/canvas/import', '/api/canvas/edit']);
  const body = { name: 'x', data: '' };
  for (const p of posts) {
    const r = await B.ask('ana', null, 'POST', `${p}?slug=board`, { body });
    assert.equal(r.status, 403, `the box's own name: ${p}`);
    assert.match(r.body, /"code":"view-only"/, `the box's own name: ${p}: the gateway's own refusal`);
  }
  for (const [name, at] of NAMES) {
    for (const route of [...posts.flatMap((p) => [p, `${p}?slug=board`, `${p}/`]), '/api/canvas/', '/api/canvas/nosuch', '/api//canvas/edit', '/api/%63anvas/edit', '/api/canvas/../canvas/edit', '/API/canvas/edit']) {
      for (const headers of [{}, { 'sec-fetch-mode': 'navigate', accept: 'text/html' }, { 'x-http-method-override': 'GET' }, FORGED]) {
        const r = await B.ask('ana', name, 'POST', route, { body, headers });
        assert.equal(r.status, 403, `${at} ${route}`);
        assert.match(r.body, /"code":"view-only"/, `${at} ${route}: the gateway's own refusal`);
      }
    }
    for (const method of ['PUT', 'PATCH', 'DELETE']) assert.equal((await B.ask('ana', name, method, '/api/canvas/edit?slug=board', { body })).status, 403, method);
    assert.deepEqual(B[at].reqs, [], `${at}: none reached the dashboard`);
    assert.equal((await B.ask('ana', name, 'GET', '/api/canvas/doc?slug=board')).status, 200, `${at}: a View person reads the document`);
    for (const p of posts) await B.ask('jo', name, 'POST', `${p}?slug=board`, { body });
    assert.deepEqual(B[at].reqs.slice(1), posts.map((p) => `POST ${p}?slug=board`), `${at}: a Full person's go on`);
  }
});
test('canvas gateway: a person the header can\'t carry is 500, and a dashboard that never answers is given up', async (t) => {
  const B = await box(t, { presenceAnswerMs: 300 });
  const s = B.state();
  B.write({ ...s, people: s.people.map((p) => (p.id === 'p-jo' ? { ...p, name: 7 } : p)) });
  assert.equal((await B.up('alpha', { as: 'jo' })).status, 500, 'the bad row');
  B.write(s);
  assert.equal(B.alpha.ups.length, 0, 'which went nowhere');
  B.alpha.hush(true);
  assert.equal((await B.up('alpha', { as: 'jo' })).status, undefined, 'closed with no answer');
  assert.equal(B.alpha.ups.length, 1, 'after it was asked');
});
test('canvas gateway: nothing else is added to what a View person may do', async (t) => {
  const B = await box(t);
  const pv = { name: 'cool-tiger', port: 0, project: 'alpha', session: 's', label: 'app', at: '2026-11-10', up: true, run: false };
  const seen = [];
  const held = new Set();
  const app = http.createServer((q, r) => r.end('app'));
  app.on('connection', (c) => { held.add(c); });
  app.on('upgrade', (q, s) => { s.on('error', () => {}); seen.push(q.headers); s.write('HTTP/1.1 101 Switching Protocols\r\nconnection: Upgrade\r\nupgrade: websocket\r\n\r\n'); });
  pv.port = await listen(app, 0);
  B.listed[0].previews.push(pv);
  // the status alone: a preview's app and the terminal send no canvas welcome
  const shake = (as, name, route) => new Promise((resolve) => {
    const h = `${name}.${B.host}`;
    const r = http.request({ host: '127.0.0.1', port: B.port, path: route, headers: { host: h, origin: `http://${h}`, cookie: B.cookies[as], connection: 'Upgrade', upgrade: 'websocket', ...FORGED } });
    r.on('upgrade', (res, s) => { s.destroy(); resolve(101); });
    r.on('response', (res) => { res.resume(); resolve(res.statusCode); });
    r.on('error', () => resolve('error'));
    r.end();
  });
  try {
    assert.equal(await shake('jo', 'cool-tiger', '/canvas?slug=board'), 101, 'a preview\'s own /canvas is its app\'s');
    assert.equal(seen[0]['x-devteam-person'], undefined, 'which is told no person');
    assert.equal(await shake('ana', 'cool-tiger', '/canvas?slug=board'), 403, 'View: a preview\'s /canvas');
    assert.equal(await shake('ana', 'cool-tiger', '/hmr'), 403, 'View: a preview\'s other socket');
    assert.equal(await shake('ana', 'term', '/ws'), 403, 'View: the terminal');
    assert.equal(await shake('ana', 'term', '/canvas'), 403, 'View: /canvas on the terminal\'s name');
    for (const route of ['/', '/ws', '/api/term/x', '/api/canvas/edit', '/canvas/edit']) assert.equal(await shake('ana', 'alpha', route), 421, `View: ${route}`);
    assert.equal(seen.length, 1, 'the app saw Jo\'s alone');
    for (const p of ROUTES.filter((r) => r.method === 'POST').map((r) => r.path)) {
      const r = await B.ask('ana', 'cool-tiger', 'POST', p, { body: {} });
      assert.equal(r.status, 403, `a preview: POST ${p}`);
      assert.match(r.body, /"code":"view-only"/, `a preview: POST ${p}: the gateway's own refusal`);
    }
    for (const route of ['/canvas', '/canvas?slug=board', '/api/answer', '/api/thread', '/api/artifact/note', '/upload']) {
      assert.equal((await B.ask('ana', 'alpha', 'POST', route, { body: {} })).status, 403, `POST ${route}`);
    }
    assert.equal((await B.ask('ana', 'alpha', 'GET', '/api/term/list')).body, '{"why":"view"}', 'the terminal\'s routes');
    assert.equal((await B.ask('ana', null, 'GET', '/public')).status, 403, 'Publish');
    assert.deepEqual(B.alpha.reqs, [], 'none reached the dashboard');
  } finally { for (const c of held) c.destroy(); await new Promise((r) => app.close(r)); }
});
