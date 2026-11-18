// The presence relay (kit-631, presence@1): the /presence WebSocket on a real dashboard and on its
// real hub, driven by the contract's own test client (test/lib/presence-fake.mjs's openPresence) and
// held to its shapes (shapeErrors). The clock is real: every wait is a `next` or a `closed` with a
// deadline, and every "never" is bounded by a sentinel people on the same socket.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fleetFixture, dashboardOnFreePort, PORTS } from './lib/kit.mjs';
import { startPresenceFake, openPresence, shapeErrors, LIMITS } from './lib/presence-fake.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = () => fs.readFileSync(path.join(here, 'contracts', 'presence.md'), 'utf8');

// ---- the file's people: every id, name and at word starts zq7, so A8(d) can look for them on disk ----
const SPOT = Object.freeze({ page: 'zq7-board', tab: null, peek: 'zq7-kit-1', art: null, thread: null });
const hereMsg = (at = {}, visible = true) => ({ t: 'here', at: { ...SPOT, ...at }, visible });
const P = (id, name = 'zq7 Ann') => ({ 'x-devteam-person': `${id};name=${encodeURIComponent(name)}` });

async function until(fn, what, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out after ${ms} ms: ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

// ---- A8 (e): the contract and the fake say present is visible people only (the ruling) ----

test('presence A8: (e) the fake and the contract list only people with a visible connection', async () => {
  const s = contract();
  assert.ok(s.includes('whose connection said here and is visible'), "§11 says present is visible people only");
  const fake = await startPresenceFake({ clock: 'manual' });
  try {
    const open = (id) => openPresence(fake.url, { headers: P(id) });
    const said = async (c, m) => { const n = fake.stats().find((x) => x.conn === c.you.conn).messages; c.send(m); await until(() => fake.stats().find((x) => x.conn === c.you.conn).messages > n, 'taken'); };
    const A1 = await open('zq7-a'); const A2 = await open('zq7-a');
    const F1 = await open('zq7-f'); const F2 = await open('zq7-f');
    const B = await open('zq7-b'); const V = await open('zq7-v'); const H = await open('zq7-h');
    await open('zq7-s'); // silent: never says here
    await said(A1, hereMsg()); await said(A2, hereMsg({ tab: 'zq7-2' }));
    await said(F1, hereMsg({}, false)); await said(B, hereMsg());
    await said(V, hereMsg()); await said(H, hereMsg({}, false));
    await said(F2, hereMsg({ tab: 'zq7-2' }));
    await said(V, hereMsg({}, false));
    const who = (id) => ({ id, name: 'zq7 Ann', level: 'full' });
    assert.deepEqual(fake.present(), { present: [who('zq7-a'), who('zq7-f'), who('zq7-b')], present_more: 0 },
      'A (two visible tabs) once, F (first tab hidden, a later one visible) at its first here, B; not V (now hidden), H (hidden) or S (silent)');
    assert.deepEqual(shapeErrors('hello', fake.present()), []);
  } finally {
    await fake.close();
  }
});

// ---- the fixture: a real dashboard on a scratch fleet; its hub is real too (DEVTEAM_HUB_PORT) ----

const HUB_PORT = PORTS + 0;
let fixture = null;
// The dashboard, started once for the file (the first check that needs it waits for it).
function dashboard() {
  fixture ??= (async () => {
    const F = fleetFixture('presence');
    const env = F.env({ DEVTEAM_HUB_PORT: String(HUB_PORT) });
    const { dash, port } = await dashboardOnFreePort(F.old, env);
    const gitName = execFileSync('git', ['config', 'user.name'], { cwd: F.old, encoding: 'utf8' }).trim();
    return { F, dash, port, url: `http://127.0.0.1:${port}`, gitName, runDir: path.join(F.old, 'docs/devteam/run') };
  })();
  return fixture;
}
after(async () => {
  if (!fixture) return;
  const { F, dash } = await fixture;
  await dash.stop();
  F.done();
});

// A plain HTTP request with exactly the Host given (127.0.0.1:<port> by default).
function get(port, p, { host, headers = {}, method = 'GET', ms = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: host ?? `127.0.0.1:${port}`, ...headers }, setHost: false, timeout: ms }, (res) => {
      const parts = [];
      res.on('data', (b) => parts.push(b));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(parts).toString('utf8') }));
      res.on('error', reject);
    });
    r.on('timeout', () => r.destroy(new Error(`${p}: no answer in ${ms} ms`)));
    r.on('error', reject);
    r.end();
  });
}

// ---- the file's clients: every one through open(), which answers the relay's ping, and closed with its
// close awaited at the end of each check (closeEvery), so no check starts with another's connections ----

const clients = new Set();
async function open(url, opts = {}) {
  const c = await openPresence(url, opts);
  clients.add(c);
  let answered = 0;
  const pong = setInterval(() => {
    const pings = c.messages.filter((m) => m.t === 'ping').length;
    for (; answered < pings; answered++) c.send({ t: 'pong' });
  }, 500);
  pong.unref();
  c.closed.then(() => clearInterval(pong));
  return c;
}
async function closeEvery() {
  const all = [...clients];
  clients.clear();
  await Promise.all(all.map(async (c) => {
    c.close(1000);
    let timer;
    const late = new Promise((r) => { timer = setTimeout(r, 5000); });
    await Promise.race([c.closed, late]);
    clearTimeout(timer);
    c.destroy();
  }));
}
// Each check: its clients closed whatever happens in it.
const check = (fn) => async (t) => { try { await fn(t); } finally { await closeEvery(); } };

const json = (m) => Buffer.from(JSON.stringify(m));
const pieces = (buf, n) => { const size = Math.ceil(buf.length / n); return Array.from({ length: n }, (_, i) => buf.subarray(i * size, (i + 1) * size)); };
// A here of exactly n bytes (an extra key the server ignores pads it).
function padded(n, at = {}) {
  const m = { ...hereMsg(at), pad: '' };
  m.pad = 'x'.repeat(n - json(m).length);
  assert.equal(json(m).length, n);
  return json(m);
}
async function closedWithin(c, ms = 5000) {
  let timer;
  const late = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`not closed within ${ms} ms`)), ms); });
  try { return await Promise.race([c.closed, late]); } finally { clearTimeout(timer); }
}
const kinds = (list, t) => list.filter((m) => m.t === t);
// `c`'s messages from index `mark` up to (not including) `msg`.
const between = (c, mark, msg) => { const i = c.messages.indexOf(msg); assert.ok(i >= mark, 'the sentinel came after the mark'); return c.messages.slice(mark, i); };

// The sentinel: `E` (which has said here at `at`) says here again with a fresh thread tag. A server
// handles one socket's messages in order, so the people naming the tag, which every watched client
// (each has said here) gets, comes after anything E sent before it, and after anything the server sent
// those clients before it. Resolves to each watched client's people.
let tags = 0;
async function sentinel(E, at, watched, ms = 5000) {
  const tag = `zq7-s${++tags}`;
  E.send(hereMsg({ ...at, thread: tag }));
  const hasTag = (m) => m.t === 'people' && m.people.some((p) => p.conns.some((x) => x.conn === E.you.conn && x.at.thread === tag));
  return Promise.all(watched.map((c) => c.next(hasTag, ms)));
}
const peopleWith = (n) => (m) => m.t === 'people' && m.people.length === n;
const peopleIds = (m) => m.people.map((p) => p.id);

// ---- the shared tables, each a function of a server's URL, run on the dashboard and on the hub ----

// §2 and §4: every refusal of the fake's A2(a), the order pairs, and a plain GET /presence.
async function refusals(url, port, { ownOrigin = null } = {}) {
  const person = (v) => ({ headers: { 'x-devteam-person': v } });
  const rows = [
    [403, 'a foreign Host with a matching Origin', { host: `evil.example:${port}` }],
    [403, 'x-devteam-relay: 1', { headers: { 'x-devteam-relay': '1' } }],
    [403, 'no Origin', { origin: null }],
    [403, 'Origin: null', { origin: 'null' }],
    [403, 'a foreign Origin', { origin: 'http://evil.example' }],
    [403, 'Origin http://localhost on a 127.0.0.1 Host', { origin: `http://localhost:${port}` }],
    [404, 'another path', {}, '/elsewhere'],
    [400, 'no key', { headers: { 'Sec-WebSocket-Key': null } }],
    [400, 'version 12', { headers: { 'Sec-WebSocket-Version': '12' } }],
    [400, 'a key of 15 bytes', { headers: { 'Sec-WebSocket-Key': Buffer.alloc(15, 1).toString('base64') } }],
    [400, 'no Upgrade: websocket', { headers: { Upgrade: 'h2c' } }],
    [403, 'a foreign Host on another path', { host: `evil.example:${port}` }, '/elsewhere'],
    [403, 'x-devteam-relay on another path', { headers: { 'x-devteam-relay': '1' } }, '/elsewhere'],
    [404, 'another path with no key', { headers: { 'Sec-WebSocket-Key': null } }, '/elsewhere'],
    [400, 'no key and no Origin', { headers: { 'Sec-WebSocket-Key': null }, origin: null }],
    [403, 'a name with %ZZ', person('zq7-a;name=%ZZ')],
    [403, 'a name that is not UTF-8 (%FF)', person('zq7-a;name=%FF')],
    [403, 'a name with a space', person('zq7-a;name=Ann Lee')],
    [403, ';name= empty', person('zq7-a;name=')],
    [403, 'another parameter (;x=1)', person('zq7-a;name=Ann;x=1')],
    [403, 'no ;name=', person('zq7-a')],
    [403, 'an id of 65 characters', person(`zq7${'a'.repeat(62)};name=Ann`)],
    [403, 'an id with a space', person('zq7 a;name=Ann')],
    [403, 'x-devteam-person twice', { headers: { 'x-devteam-person': ['zq7-a;name=Ann', 'zq7-b;name=Bo'] } }],
    [403, 'x-devteam-level: View', { headers: { ...P('zq7-a'), 'x-devteam-level': 'View' } }],
    [403, 'x-devteam-level twice', { headers: { ...P('zq7-a'), 'x-devteam-level': ['view', 'view'] } }],
    [403, 'x-devteam-level: view with no person', { headers: { 'x-devteam-level': 'view' } }],
  ];
  if (ownOrigin) rows.push([403, `another server's origin (${ownOrigin})`, { origin: ownOrigin }]);
  for (const [status, label, opts, where = ''] of rows) {
    const c = await open(`${url}${where}`, opts);
    assert.equal(c.status, status, label);
    assert.equal(c.you, undefined, `${label}: no welcome`);
    assert.deepEqual(c.messages, [], `${label}: no message`);
  }
  // accepted: localhost:<port> as Host, and a query string
  assert.ok((await open(url, { host: `localhost:${port}` })).you, 'localhost:<port> is a Host');
  assert.ok((await open(`${url}/presence?x=1`)).you, 'a query string is ignored');
  // a plain request for /presence: the guard's status, never the page
  assert.equal((await get(port, '/presence', { headers: { origin: `http://127.0.0.1:${port}` } })).status, 400, 'a plain GET /presence is 400');
  assert.equal((await get(port, '/presence?x=1')).status, 400, 'a plain GET /presence?x=1 is 400');
  assert.equal((await get(port, '/presence', { host: `evil.example:${port}` })).status, 403, 'a plain GET /presence with a foreign Host is 403');
  assert.equal((await get(port, '/presence', { method: 'POST', headers: { 'content-length': '0' } })).status, 400, 'a plain POST /presence is 400');
}

// A bystander that has said here on its own spot, for alive().
async function bystander(url) {
  const W = await open(url, { headers: P('zq7-bystander') });
  const at = { page: 'zq7-bystander' };
  W.send(hereMsg(at));
  await W.next((m) => m.t === 'people' && peopleIds(m).includes('zq7-bystander'));
  return { W, at };
}
// The server still relays to the bystander and still answers `path` with 200.
async function alive(url, port, { W, at }, okPath) {
  await sentinel(W, at, [W]);
  assert.equal(W.status, 101);
  assert.equal((await get(port, okPath)).status, 200, `${okPath} still answers`);
}

// §2 and §3: every length form, fragments with a ping between, a byte at a time; a close echoed; 1002s.
async function frames(url) {
  const W = await open(url, { headers: P('zq7-watch') });
  W.send(hereMsg({ page: 'zq7-watch' }));
  await W.next((m) => m.t === 'people');
  const body = json(hereMsg());
  const c7 = await open(url, { headers: P('zq7-7') }); c7.frame(body, { len: 7 });
  const c16 = await open(url, { headers: P('zq7-16') }); c16.frame(body, { len: 16 });
  const c64 = await open(url, { headers: P('zq7-64') }); c64.frame(body, { len: 64 });
  const cf = await open(url, { headers: P('zq7-frag') });
  const [f1, f2, f3] = pieces(body, 3);
  cf.frame(f1, { fin: false });
  cf.frame(Buffer.from('hi'), { opcode: 9 });
  cf.frame(f2, { opcode: 0, fin: false });
  cf.frame(f3, { opcode: 0 });
  const cb = await open(url, { headers: P('zq7-byte') });
  for (const byte of cb.build(body)) { cb.raw(Buffer.from([byte])); await new Promise((r) => setImmediate(r)); }
  const want = ['zq7-watch', 'zq7-7', 'zq7-16', 'zq7-64', 'zq7-frag', 'zq7-byte'];
  const p = await W.next((m) => m.t === 'people' && want.every((id) => peopleIds(m).includes(id)), 5000);
  assert.deepEqual(shapeErrors('people', p), []);
  const pongs = () => cf.controls.filter((x) => x.opcode === 10).map((x) => x.payload.toString());
  await until(() => pongs().length, 'the pong between fragments');
  assert.deepEqual(pongs(), ['hi'], 'a pong of the same payload');

  const closer = await open(url);
  closer.frame(Buffer.from([0x0f, 0xa0]), { opcode: 8 }); // 4000
  assert.equal(await closedWithin(closer), 4000, 'a close is answered with a close of the same code');

  const protocol = [
    ['an unmasked frame', (c) => c.frame(body, { mask: false })],
    ['a reserved bit', (c) => c.frame(body, { rsv: 4 })],
    ['opcode 3', (c) => c.frame(body, { opcode: 3 })],
    ['a fragmented ping', (c) => c.frame(Buffer.from('hi'), { opcode: 9, fin: false })],
    ['a 126-byte ping', (c) => c.frame(Buffer.alloc(126, 97), { opcode: 9 })],
    ['a stray continuation', (c) => c.frame(body, { opcode: 0 })],
    ['a text frame while a message is open', (c) => { c.frame(f1, { fin: false }); c.frame(f2); }],
    ['a 64-bit length with its top bit set', (c) => c.raw(Buffer.from([0x81, 0xff, 0x80, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]))],
  ];
  for (const [label, act] of protocol) {
    const c = await open(url);
    act(c);
    assert.equal(await closedWithin(c), 1002, label);
  }
}

// §2, §3 and §7: 2048 bytes taken; everything over a size or not a JSON object is 1008.
async function sizes(url) {
  const W = await open(url, { headers: P('zq7-watch') });
  W.send(hereMsg({ page: 'zq7-watch' }));
  await W.next((m) => m.t === 'people');
  const ok = await open(url, { headers: P('zq7-2048') });
  ok.frame(padded(LIMITS.pageMsg));
  await W.next((m) => m.t === 'people' && peopleIds(m).includes('zq7-2048'), 5000);
  const f16 = await open(url, { headers: P('zq7-16frames') });
  pieces(json(hereMsg()), 16).forEach((x, i) => f16.frame(x, { opcode: i ? 0 : 1, fin: i === 15 }));
  await W.next((m) => m.t === 'people' && peopleIds(m).includes('zq7-16frames'), 5000);
  const rows = [
    ['a 2049-byte message', (c) => c.frame(padded(LIMITS.pageMsg + 1))],
    ['fragments summing over 2048', (c) => { const [a, b, d] = pieces(padded(2100), 3); c.frame(a, { fin: false }); c.frame(b, { opcode: 0, fin: false }); c.frame(d, { opcode: 0 }); }],
    ['17 fragments', (c) => { pieces(json(hereMsg()), 17).forEach((x, i) => c.frame(x, { opcode: i ? 0 : 1, fin: i === 16 })); }],
    ['a binary frame', (c) => c.frame(json(hereMsg()), { opcode: 2 })],
    ['a frame that is not JSON', (c) => c.frame(Buffer.from('not json'))],
    ['[]', (c) => c.frame(Buffer.from('[]'))],
    ['null', (c) => c.frame(Buffer.from('null'))],
    ['a number', (c) => c.frame(Buffer.from('42'))],
  ];
  for (const [label, act] of rows) {
    const c = await open(url);
    act(c);
    assert.equal(await closedWithin(c), 1008, label);
  }
  const big = await open(url);
  big.raw(Buffer.from([0x81, 0xff, 0, 0, 0x01, 0, 0, 0, 0, 0, 1, 2, 3, 4]));
  assert.equal(await closedWithin(big, 2000), 1008, 'a header declaring 2^40 bytes is closed within 2 s, before any payload');
  assert.equal(ok.status, 101);
  await sentinel(W, { page: 'zq7-watch' }, [W]);
  assert.equal(W.messages.filter((m) => m.t === 'people').at(-1).people.some((p) => p.id === 'zq7-2048'), true, 'the 2048-byte one is still listed');
}

// ---- A3: two clients, people, and moves on the same spot only ----

test('presence A3: on a real dashboard, welcome, people, and a move reaches only others on its spot', check(async () => {
  const { url } = await dashboard();
  const A = await open(url, { headers: P('zq7-a') });
  assert.equal(A.status, 101);
  assert.equal(A.headers['sec-websocket-accept'], crypto.createHash('sha1').update(`${A.key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64'));
  assert.equal(A.messages[0].t, 'welcome', 'welcome first');
  assert.equal(A.messages[0].presence, 1);
  assert.deepEqual(shapeErrors('welcome', A.messages[0]), []);
  assert.equal(A.you.id, 'zq7-a');
  const B = await open(url, { headers: P('zq7-b', 'zq7 Bo') });
  const C = await open(url, { headers: P('zq7-c', 'zq7 Cy') });
  const A2 = await open(url, { headers: P('zq7-a') }); // A's person, another browser tab
  const D = await open(url, { headers: P('zq7-d', 'zq7 Di') });
  const E = await open(url, { headers: P('zq7-e', 'zq7 Ed') });
  const N = await open(url, { headers: P('zq7-n', 'zq7 Ny') }); // says here only after the acts
  const Pk = await open(url, { headers: P('zq7-pk', 'zq7 Pk') }); // the same page and tab, another peek
  const Ar = await open(url, { headers: P('zq7-ar', 'zq7 Ar') }); // the same page, tab and peek, an art
  const all = [A, B, C, A2, D, E, Pk, Ar];
  const atC = { tab: 'zq7-other' };
  const atD = {};
  const atE = { page: 'zq7-sentinel' };
  A.send(hereMsg()); B.send(hereMsg()); C.send(hereMsg(atC)); A2.send(hereMsg());
  D.send(hereMsg(atD, false)); E.send(hereMsg(atE));
  Pk.send(hereMsg({ peek: 'zq7-kit-2' })); Ar.send(hereMsg({ art: 'zq7-mock@main' }));
  const firsts = await Promise.all(all.map((c) => c.next(peopleWith(7), 5000)));
  for (const p of firsts) assert.deepEqual(shapeErrors('people', p), []);
  assert.deepEqual(firsts[0].people.find((p) => p.id === 'zq7-a').conns.map((x) => x.conn).sort(), [A.you.conn, A2.you.conn].sort(), "one entry for A's person, both its tabs");
  const mark = new Map(all.map((c) => [c, c.messages.length]));

  B.send({ t: 'move', a: { k: 'zq7-kit-1', x: 0.1, y: 0.2 } });
  const fromB = { t: 'move', id: 'zq7-b', conn: B.you.conn, a: { k: 'zq7-kit-1', x: 0.1, y: 0.2 } };
  assert.deepEqual(await A.next((m) => m.t === 'move'), fromB, "B's move reaches A");
  assert.deepEqual(await A2.next((m) => m.t === 'move'), fromB, "B's move reaches A′ (on the spot)");

  A.send({ t: 'move', id: 'zq7-b', conn: 'forged', name: 'zq7 Zed', zz: 1, a: { k: 'zq7-kit-1', x: 0.5, y: 0.25, zz: 2 } });
  const got = await B.next((m) => m.t === 'move');
  assert.deepEqual(got, { t: 'move', id: 'zq7-a', conn: A.you.conn, a: { k: 'zq7-kit-1', x: 0.5, y: 0.25 } }, "A's forged move reaches B as A's own, rebuilt");
  assert.deepEqual(shapeErrors('server-move', got), []);
  A.send({ t: 'move', a: null });
  assert.deepEqual(await B.next((m) => m.t === 'move'), { t: 'move', id: 'zq7-a', conn: A.you.conn, a: null }, 'a: null reaches B');

  D.send({ t: 'move', a: { k: 'zq7-kit-1', x: 0.5, y: 0.5 } }); // hidden: reaches nobody
  C.send({ t: 'move', a: { k: 'zq7-kit-1', x: 0.5, y: 0.5 } }); // another spot: reaches nobody
  await sentinel(D, atD, all); // everything D sent before is handled
  await sentinel(C, atC, all);
  N.send({ t: 'move', a: { k: 'zq7-kit-1', x: 0.5, y: 0.5 } }); // before its here: dropped
  N.send(hereMsg({ thread: 'zq7-n-here' })); // on A's spot, only now
  const nFirst = await N.next((m) => m.t === 'people', 5000);
  assert.deepEqual(N.messages.slice(1, N.messages.indexOf(nFirst)), [], 'before its here, N got nothing');

  // a here identical to the last sends no people: X's repeat, then (past a window) X's own change
  E.send(hereMsg({ ...atE, thread: tagE(0) }));
  await A.next((m) => m.t === 'people' && m.people.some((p) => p.conns.some((x) => x.conn === E.you.conn && x.at.thread === tagE(0))), 5000);
  const markR = A.messages.length;
  E.send(hereMsg({ ...atE, thread: tagE(0) })); // the repeat
  await new Promise((r) => setTimeout(r, 3 * LIMITS.peopleMs));
  const [endR] = await sentinel(E, atE, [A]);
  assert.deepEqual(kinds(between(A, markR, endR), 'people'), [], 'a here that changes nothing sends no people');

  const ends = await sentinel(E, atE, [A, B, C, A2, D, N, Pk, Ar]);
  const moves = (c, i) => kinds(between(c, mark.get(c) ?? 1, ends[i]), 'move');
  assert.deepEqual(moves(A, 0), [fromB], "A gets only B's move, never its own");
  assert.deepEqual(moves(B, 1).map((m) => m.a), [{ k: 'zq7-kit-1', x: 0.5, y: 0.25 }, null], "B gets A's two");
  assert.deepEqual(moves(C, 2), [], 'C (another tab) gets no move');
  assert.deepEqual(moves(A2, 3), [fromB], "A′ never gets its own person's moves");
  assert.deepEqual(moves(D, 4), [], 'D (hidden) gets no move');
  assert.deepEqual(moves(N, 5), [], 'N gets no move');
  assert.deepEqual(moves(Pk, 6), [], 'Pk (another peek) gets no move');
  assert.deepEqual(moves(Ar, 7), [], 'Ar (an artifact open) gets no move');
  assert.ok(!A.messages.some((m) => m.t === 'move' && m.id === 'zq7-n'), "N's move from before its here reached nobody");

  // C comes to A's spot: now its move reaches A
  C.send(hereMsg());
  await A.next((m) => m.t === 'people' && m.people.find((p) => p.id === 'zq7-c')?.conns[0].at.tab === null, 5000);
  C.send({ t: 'move', a: { k: 'zq7-kit-1', x: 0.75, y: 0.5 } });
  assert.deepEqual(await A.next((m) => m.t === 'move' && m.id === 'zq7-c'), { t: 'move', id: 'zq7-c', conn: C.you.conn, a: { k: 'zq7-kit-1', x: 0.75, y: 0.5 } });
}));
const tagE = (i) => `zq7-e${i}`;

// ---- A5: who you are comes only from the upgrade's headers; at and move are rebuilt ----

test('presence A5: names, ids and levels only from the headers; no header is the owner; at and move checked and rebuilt', check(async () => {
  const { url, port, gitName } = await dashboard();
  // (a) the headers, not the message
  const A = await open(url, { headers: { 'x-devteam-person': 'zq7-a;name=zq7%20Ann%20Lee', 'x-devteam-level': 'view' } });
  assert.equal(A.you.id, 'zq7-a');
  A.send({ ...hereMsg(), id: 'zq7-z', name: 'zq7 Zed', level: 'full', conn: 'zz' });
  // (b) no headers: the owner, named as the instance's owner
  const O = await open(url);
  assert.equal(O.you.id, 'owner');
  O.send(hereMsg());
  // (d) cut to 80 JSON bytes; percent-encoded UTF-8
  const Q = await open(url, { headers: { 'x-devteam-person': `zq7-q;name=zq7${'%22'.repeat(100)}` } });
  Q.send(hereMsg());
  const K = await open(url, { headers: { 'x-devteam-person': 'zq7-k;name=zq7%E5%B1%B1%E7%94%B0' } });
  K.send(hereMsg());
  const p = await A.next(peopleWith(4), 5000);
  assert.deepEqual(shapeErrors('people', p), []);
  const who = Object.fromEntries(p.people.map(({ id, name, level }) => [id, { name, level }]));
  assert.ok(gitName && gitName !== 'Owner', 'the fixture has a git user.name of its own');
  assert.deepEqual(who, {
    'zq7-a': { name: 'zq7 Ann Lee', level: 'view' },
    owner: { name: gitName, level: 'full' },
    'zq7-q': { name: `zq7${'"'.repeat(38)}`, level: 'full' },
    'zq7-k': { name: 'zq7山田', level: 'full' },
  });
  assert.equal(p.people.find((x) => x.id === 'zq7-a').conns[0].conn, A.you.conn, "the conn is the welcome's");
  // a move carrying a name, an id and a conn reaches the other as the sender's own
  A.send({ t: 'move', id: 'owner', conn: 'zz', name: 'zq7 Zed', level: 'full', a: { k: 'zq7-kit-1', x: 0.5, y: 0.5, name: 'x' } });
  assert.deepEqual(await O.next((m) => m.t === 'move'), { t: 'move', id: 'zq7-a', conn: A.you.conn, a: { k: 'zq7-kit-1', x: 0.5, y: 0.5 } });

  // (c) every malformed person or level header is refused, never the owner
  await refusals(url, port);

  // (e) at: each part checked and the at rebuilt; a non-object at ignored; visible true or false
  const Fh = await open(url, { headers: P('zq7-f') });
  Fh.send({ t: 'here', at: { page: 'a b', tab: 'x'.repeat(121), peek: 5, thread: 'h:0123456789abcdef', zz: 'q' }, visible: 'yes' });
  const G = await open(url, { headers: P('zq7-g') });
  for (const at of ['x', null, []]) G.send({ t: 'here', at, visible: true });
  G.send({ t: 'here', visible: true });
  const pf = await A.next((m) => m.t === 'people' && peopleIds(m).includes('zq7-f'), 5000);
  const f = pf.people.find((x) => x.id === 'zq7-f').conns[0];
  assert.deepEqual(f.at, { page: null, tab: null, peek: null, art: null, thread: 'h:0123456789abcdef' });
  assert.equal(f.visible, false, 'a visible that is not true is false');
  const [endG] = await sentinel(A, {}, [A]);
  assert.ok(!endG.people.some((x) => x.id === 'zq7-g'), 'a here whose at is not an object is ignored: G is listed nowhere');
  assert.equal(G.messages.filter((m) => m.t === 'people').length, 0, 'G gets no people');

  // (f) moves: the bounds
  const k200 = `zq7${'é'.repeat(98)}a`; // 3 + 196 + 1 = 200 bytes
  assert.equal(Buffer.byteLength(k200), 200);
  const mark = O.messages.length;
  for (const a of [
    { k: 'zq7-kit-1', x: 1.5, y: 0 }, { k: 'zq7-kit-1', x: -0.01, y: 0 }, { k: 'zq7-kit-1', x: 0, y: 1.01 },
    { k: `${k200}b`, x: 0, y: 0 }, { k: '', x: 0, y: 0 }, { k: 5, x: 0, y: 0 }, { k: 'zq7-kit-1', x: '0', y: 0 }, 'x',
  ]) A.send({ t: 'move', a });
  A.send({ t: 'move' });
  A.send({ t: 'move', a: { k: 'zq7-kit-1', x: 0, y: 1 } });
  A.send({ t: 'move', a: { k: k200, x: 1, y: 0 } });
  A.send({ t: 'move', a: null });
  const [end] = await sentinel(A, {}, [O]);
  assert.deepEqual(kinds(between(O, mark, end), 'move').map((m) => m.a), [{ k: 'zq7-kit-1', x: 0, y: 1 }, { k: k200, x: 1, y: 0 }, null], 'only the good three, in order');
}));

// A raw client that never ends its side (allowHalfOpen): sends the upgrade (and, once upgraded, `then`),
// then probe bytes 3, 3.5, 6.5 and 7 s after. The second write after the server drops the socket fails
// (the first is answered with a reset), so the close comes at 3.5 s if it was dropped before 3 s, at 7 s
// if between 3.5 and 6.5 s, never if it is kept. Resolves to the ms from its last message to the close.
function halfOpen(port, upgradeHeaders, then) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: '127.0.0.1', port, allowHalfOpen: true });
    s.on('error', () => {});
    let at = 0;
    let shook = false;
    s.on('connect', () => { s.write(upgradeHeaders); at = Date.now(); });
    s.on('data', (d) => {
      if (shook || !then) return;
      if (d.toString('latin1').startsWith('HTTP/1.1 101')) { shook = true; s.write(then); at = Date.now(); }
    });
    for (const ms of [3000, 3500, 6500, 7000]) setTimeout(() => { if (!s.destroyed) s.write('x'); }, ms).unref();
    s.on('end', () => {}); // never ended from here
    s.on('close', () => resolve(Date.now() - at));
    setTimeout(() => { s.destroy(); reject(new Error('the server never dropped a half-open socket')); }, 15000).unref();
  });
}
const upgradeReq = (port, extra = '') => `GET /presence HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n${extra}\r\n`;
const maskedClose = () => { const k = crypto.randomBytes(4); const b = Buffer.from([0x03, 0xe8]); return Buffer.concat([Buffer.from([0x88, 0x82]), k, Buffer.from([b[0] ^ k[0], b[1] ^ k[1]])]); };

// ---- A6: the guards, and a bad frame closes only its own connection ----

test('presence A6: a laptop dashboard refuses a foreign Host or Origin; a malformed frame closes only that connection', check(async () => {
  const { url, port } = await dashboard();
  await refusals(url, port);
  const by = await bystander(url);
  const bad = await open(url, { headers: P('zq7-bad') });
  bad.frame(Buffer.from('not json'));
  assert.equal(await closedWithin(bad), 1008, 'not JSON: 1008');
  const um = await open(url, { headers: P('zq7-unmasked') });
  um.frame(json(hereMsg()), { mask: false });
  assert.equal(await closedWithin(um), 1002, 'unmasked: 1002');
  // a peer that never hangs up holds no socket: dropped 5 s after its close is answered, or its refusal
  const [afterClose, afterRefusal] = await Promise.all([
    halfOpen(port, upgradeReq(port, `Origin: http://127.0.0.1:${port}\r\n`), maskedClose()),
    halfOpen(port, upgradeReq(port, 'Origin: http://evil.example\r\n')),
  ]);
  assert.ok(afterClose >= 6000 && afterClose < 9500, `a closed connection whose peer never hangs up is dropped after 5 s (${afterClose} ms)`);
  assert.ok(afterRefusal >= 6000 && afterRefusal < 9500, `a refused upgrade whose peer never hangs up is dropped after 5 s (${afterRefusal} ms)`);
  await alive(url, port, by, '/api/data');
}));

// ---- A35: framing against the real dashboard ----

test('presence A35: the dashboard reads every length form and fragments, and closes 1002 and 1008 as the contract says', check(async () => {
  const { url, port } = await dashboard();
  const by = await bystander(url);
  await frames(url);
  await sizes(url);
  await alive(url, port, by, '/api/data');
}));

// ---- the hub: the same relay on the hub's own server (hub: true, its own Host check) ----

async function hubUp() {
  const d = await dashboard();
  await until(async () => { try { return (await get(HUB_PORT, '/instances.json', { ms: 5000 })).status === 200; } catch { return false; } }, 'the hub listening', 60000);
  return { ...d, hubUrl: `http://127.0.0.1:${HUB_PORT}` };
}

test('presence A4: the hub answers /presence the same way for its own pages, and sends no changed', check(async () => {
  const { hubUrl, url: dashUrl, runDir } = await hubUp();
  const A = await open(hubUrl, { headers: P('zq7-a') });
  assert.equal(A.status, 101);
  assert.deepEqual(shapeErrors('welcome', A.messages[0]), []);
  const B = await open(hubUrl, { headers: P('zq7-b', 'zq7 Bo') });
  const C = await open(hubUrl, { headers: P('zq7-c', 'zq7 Cy') });
  const E = await open(hubUrl, { headers: P('zq7-e', 'zq7 Ed') });
  const atC = { page: 'zq7-hub-other' };
  const atE = { page: 'zq7-sentinel' };
  A.send(hereMsg()); B.send(hereMsg()); C.send(hereMsg(atC)); E.send(hereMsg(atE));
  const firsts = await Promise.all([A, B, C, E].map((c) => c.next(peopleWith(4), 5000)));
  assert.deepEqual(shapeErrors('people', firsts[0]), []);
  const mark = new Map([A, B, C].map((c) => [c, c.messages.length]));
  B.send({ t: 'move', a: { k: 'zq7-row', x: 0.25, y: 0.75 } });
  const fromB = { t: 'move', id: 'zq7-b', conn: B.you.conn, a: { k: 'zq7-row', x: 0.25, y: 0.75 } };
  assert.deepEqual(await A.next((m) => m.t === 'move'), fromB, "B's move reaches A on the hub");
  await sentinel(B, {}, [A, B, C]);

  // the guards, on the hub's own Host check; a dashboard's origin is not the hub's
  await refusals(hubUrl, HUB_PORT, { ownOrigin: dashUrl });
  assert.equal((await get(HUB_PORT, '/presence', { host: `localhost:${HUB_PORT}` })).status, 400, "a plain /presence on the hub's localhost Host is answered before its redirect");

  // the log grows: the hub sends no changed (it can only fail once kit-633 sends changed on a dashboard)
  const logDir = path.join(runDir, 'log');
  fs.mkdirSync(logDir, { recursive: true });
  const file = fs.readdirSync(logDir).find((f) => f.endsWith('.jsonl')) ?? 'supervisor.jsonl';
  fs.appendFileSync(path.join(logDir, file), `${JSON.stringify({ v: 1, ts: new Date().toISOString(), type: 'note', by: 'test', text: 'a line' })}\n`);
  await new Promise((r) => setTimeout(r, 1500));
  const ends = await sentinel(E, atE, [A, B, C]);
  for (const [i, c] of [A, B, C].entries()) {
    assert.deepEqual(kinds(between(c, mark.get(c), ends[i]), 'changed'), [], 'the hub sends no changed');
  }
  assert.deepEqual(kinds(between(B, mark.get(B), ends[1]), 'move'), [], 'B never gets its own move');
  assert.deepEqual(kinds(between(C, mark.get(C), ends[2]), 'move'), [], 'C (another hub page) gets no move');
}));

test('presence A35: the hub reads every length form and fragments, and closes 1002 and 1008 as the contract says', check(async () => {
  const { hubUrl } = await hubUp();
  const by = await bystander(hubUrl);
  await frames(hubUrl);
  await sizes(hubUrl);
  await alive(hubUrl, HUB_PORT, by, '/instances.json');
}));

// ---- A7 and A8: the limits, the ping, and the hello's present ----

// `n` people at the field limits, every field starting zq7: a 64-character id, a name of 80 JSON bytes
// (zq7, 38 escaped quotes, a), five 120-character at parts.
const padTo = (head, len, i) => `${head}${'x'.repeat(len - head.length - 3)}${String(i).padStart(3, '0')}`;
const limitZq7 = (n) => Array.from({ length: n }, (_, i) => ({
  id: padTo('zq7-p', 64, i),
  header: `zq7${'%22'.repeat(38)}a`,
  name: `zq7${'"'.repeat(38)}a`,
  at: { page: padTo('zq7-pg', 120, i), tab: padTo('zq7-tb', 120, i), peek: padTo('zq7-pk', 120, i), art: padTo('zq7-ar', 120, i), thread: padTo('zq7-th', 120, i) },
}));
// 200 at the field limits, all open first (only the first keeps its messages), then every here at once.
// Resolves to the clients and the first client's people listing all 200.
async function fill200(url) {
  const people = limitZq7(LIMITS.perServer);
  const cs = [];
  for (const [i, p] of people.entries()) {
    const c = await open(url, { headers: { 'x-devteam-person': `${p.id};name=${p.header}` }, keep: i === 0 });
    assert.ok(c.you, `client ${i} welcomed`);
    cs.push(c);
  }
  for (const [i, c] of cs.entries()) c.send({ t: 'here', at: people[i].at, visible: true });
  const p = await cs[0].next(peopleWith(LIMITS.perServer), 30000);
  assert.deepEqual(shapeErrors('people', p), []);
  return { cs, people, p };
}
// Nobody but a probe is on the server: its first people lists only itself.
async function onlyProbe(url) {
  const probe = await open(url, { headers: P('zq7-probe') });
  probe.send(hereMsg({ page: 'zq7-probe' }));
  const p = await probe.next((m) => m.t === 'people', 5000);
  assert.deepEqual(peopleIds(p), ['zq7-probe'], 'nobody else is connected');
  probe.close(1000);
  await closedWithin(probe);
  clients.delete(probe);
}

test('presence A7: the rate, the per-person and per-server caps, and the ping, each closing as the contract says', check(async (t) => {
  const { url } = await dashboard();
  await t.test('(a) over 30 a second for 10 s is closed 1008; one second over is not', async () => {
    const O = await open(url, { headers: P('zq7-once') });
    O.send(hereMsg({ page: 'zq7-once' }));
    await O.next((m) => m.t === 'people', 5000);
    const G = await open(url, { headers: P('zq7-flood') });
    const burst = (c) => c.raw(Buffer.concat(Array.from({ length: 40 }, () => c.build(json({ t: 'zz' })))));
    await new Promise((r) => setTimeout(r, 1100));
    burst(O); // one second over, then nothing
    const start = Date.now();
    let code = null;
    G.closed.then((x) => { code = x; });
    while (code === null && Date.now() - start < 15000) { burst(G); await new Promise((r) => setTimeout(r, 250)); }
    const took = Date.now() - start;
    assert.equal(code, 1008, 'the flood is closed 1008');
    assert.ok(took >= 9000 && took <= 14000, `closed after ten seconds over, not before (${took} ms)`);
    await sentinel(O, { page: 'zq7-once' }, [O]);
    assert.equal(O.status, 101, 'the one-second burst is still open');
  });
  await t.test('(a2) ten seconds over, but not in a row, is not closed', async () => {
    const R = await open(url, { headers: P('zq7-rows') });
    R.send(hereMsg({ page: 'zq7-rows' }));
    await R.next((m) => m.t === 'people', 5000);
    let closed = false;
    R.closed.then(() => { closed = true; });
    const burst = () => R.raw(Buffer.concat(Array.from({ length: 40 }, () => R.build(json({ t: 'zz' })))));
    const flood = async (ms) => { const end = Date.now() + ms; while (Date.now() < end && !closed) { burst(); await new Promise((r) => setTimeout(r, 250)); } };
    await flood(7000);
    await new Promise((r) => setTimeout(r, 2500)); // at least one whole server second under 30
    await flood(7000);
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(closed, false, 'fourteen seconds over in two runs of seven is not closed');
    await sentinel(R, { page: 'zq7-rows' }, [R]);
  });
  await t.test('(a3) heres, ping and pong frames and pongs count; a here and a pong over the rate are never dropped', async () => {
    const A = await open(url, { headers: P('zq7-ca') });
    const B = await open(url, { headers: P('zq7-cb') });
    const at = { page: 'zq7-count' };
    A.send(hereMsg(at)); B.send(hereMsg(at));
    await B.next((m) => m.t === 'people' && ['zq7-ca', 'zq7-cb'].every((id) => peopleIds(m).includes(id)), 5000);
    const mark = B.messages.length;
    const move = (k) => A.build(json({ t: 'move', a: { k, x: 0, y: 0 } }));
    const wait = () => new Promise((r) => setTimeout(r, 1100));
    // each write: 30 counted messages of one kind, then a move, which is the 31st and dropped
    await wait();
    A.raw(Buffer.concat([...Array.from({ length: 30 }, (_, i) => A.build(json(hereMsg({ ...at, thread: `zq7-h${i % 2}` })))), move('zq7-after-heres')]));
    await wait();
    A.raw(Buffer.concat([...Array.from({ length: 30 }, () => A.build(Buffer.from('p'), { opcode: 9 })), move('zq7-after-pings')]));
    await wait();
    A.raw(Buffer.concat([...Array.from({ length: 30 }, () => A.build(json({ t: 'pong' }))), move('zq7-after-pongs')]));
    await wait();
    A.raw(Buffer.concat([...Array.from({ length: 30 }, () => A.build(Buffer.from('p'), { opcode: 10 })), move('zq7-after-pong-frames')]));
    // over the rate already, a here still lands
    await wait();
    A.raw(Buffer.concat([...Array.from({ length: 40 }, () => A.build(json({ t: 'zz' }))), A.build(json(hereMsg({ ...at, thread: 'zq7-late' })))]));
    await B.next((m) => m.t === 'people' && m.people.some((p) => p.id === 'zq7-ca' && p.conns[0].at.thread === 'zq7-late'), 5000);
    await wait();
    A.send({ t: 'move', a: { k: 'zq7-end', x: 0, y: 0 } });
    const end = await B.next((m) => m.t === 'move' && m.a?.k === 'zq7-end', 5000);
    assert.deepEqual(kinds(between(B, mark, end), 'move').map((m) => m.a.k), [], 'the move after 30 heres, 30 ping frames, 30 pongs or 30 pong frames is the 31st and dropped');
  });
  await t.test('(b) moves over 30 in a second are dropped', async () => {
    const A = await open(url, { headers: P('zq7-ra') });
    const B = await open(url, { headers: P('zq7-rb') });
    A.send(hereMsg({ page: 'zq7-rate' })); B.send(hereMsg({ page: 'zq7-rate' }));
    await B.next((m) => m.t === 'people' && ['zq7-ra', 'zq7-rb'].every((id) => peopleIds(m).includes(id)), 5000);
    await new Promise((r) => setTimeout(r, 1100));
    const mark = B.messages.length;
    A.raw(Buffer.concat(Array.from({ length: 200 }, (_, i) => A.build(json({ t: 'move', a: { k: 'zq7-kit-1', x: i / 1000, y: 0 } })))));
    await new Promise((r) => setTimeout(r, 2100));
    A.send({ t: 'move', a: { k: 'zq7-end', x: 0, y: 0 } });
    const end = await B.next((m) => m.t === 'move' && m.a?.k === 'zq7-end', 5000);
    const xs = kinds(between(B, mark, end), 'move').map((m) => m.a.x);
    assert.ok(xs.length >= 30 && xs.length <= 60, `30 to 60 of 200 moves in one write arrive (${xs.length})`);
    assert.deepEqual(xs, [...xs].sort((a, b) => a - b), 'in their order');
  });
  await closeEvery();
  await t.test('(c) the 9th connection of one person is closed 1008 before welcome', async () => {
    for (let i = 0; i < LIMITS.perPerson; i++) assert.ok((await open(url, { headers: P('zq7-p8') })).you, `connection ${i + 1} welcomed`);
    const ninth = await open(url, { headers: P('zq7-p8') });
    assert.equal(ninth.status, 101, 'accepted');
    assert.equal(ninth.you, undefined, 'no welcome');
    assert.equal(await closedWithin(ninth), 1008);
    assert.ok((await open(url, { headers: P('zq7-p9') })).you, 'another person is still welcome');
  });
  await closeEvery();
  await t.test('(d) 200 at the field limits fit; a new person\'s 201st is closed 1008 before welcome', async () => {
    await onlyProbe(url);
    const { cs } = await fill200(url);
    await until(() => cs.every((c) => c.sizes.length >= 2), 'each of the 200 has a people', 30000);
    for (const [i, c] of cs.entries()) assert.ok(c.sizes.every((n) => n < LIMITS.serverMsg), `client ${i}: every frame under 262144`);
    const over = await open(url, { headers: P('zq7-p201') });
    assert.equal(over.status, 101);
    assert.equal(over.you, undefined, 'the 201st gets no welcome');
    assert.equal(await closedWithin(over), 1008);
  });
  await closeEvery();
  await t.test('(d2) the per-server cap counts connections: 25 people with 8 each fill it', async () => {
    await onlyProbe(url);
    for (let p = 0; p < 25; p++) {
      for (let i = 0; i < LIMITS.perPerson; i++) assert.ok((await open(url, { headers: P(`zq7-m${p}`), keep: false })).you, `person ${p} connection ${i + 1} welcomed`);
    }
    const over = await open(url, { headers: P('zq7-m-new') });
    assert.equal(over.status, 101);
    assert.equal(over.you, undefined, "a new person's 201st connection gets no welcome");
    assert.equal(await closedWithin(over), 1008);
  });
  await closeEvery();
  await t.test('(e) two unanswered pings close 1001; a connection that pongs stays', async () => {
    const F = fleetFixture('presence-ping');
    const env = F.env({ DEVTEAM_HUB_PORT: String(PORTS + 2), DEVTEAM_PRESENCE_PING_MS: '1000' });
    const { dash, port } = await dashboardOnFreePort(F.old, env);
    try {
      const u = `http://127.0.0.1:${port}`;
      const Pn = await openPresence(u, { headers: P('zq7-never') });
      clients.add(Pn);
      const t0 = Date.now();
      // Q answers each ping with its pong at the end of a burst over the rate: a pong is never dropped
      const Q = await openPresence(u, { headers: P('zq7-pongs') });
      clients.add(Q);
      let answered = 0;
      const answer = setInterval(() => {
        const pings = Q.messages.filter((m) => m.t === 'ping').length;
        for (; answered < pings; answered++) Q.raw(Buffer.concat([...Array.from({ length: 40 }, () => Q.build(json({ t: 'zz' }))), Q.build(json({ t: 'pong' }))]));
      }, 100);
      answer.unref();
      let qClosed = false;
      Q.closed.then(() => { qClosed = true; clearInterval(answer); });
      assert.equal(await closedWithin(Pn, 8000), 1001, 'two unanswered pings close 1001');
      const took = Date.now() - t0;
      assert.ok(took >= 2500 && took <= 6000, `at the third ping, not the second (${took} ms)`);
      const seen = Q.messages.filter((m) => m.t === 'ping').length;
      await until(() => Q.messages.filter((m) => m.t === 'ping').length > seen, 'a ping after Pn closed', 5000);
      assert.equal(qClosed, false, 'the connection that pongs, over the rate each time, is still open');
      clearInterval(answer);
    } finally {
      await closeEvery();
      await dash.stop();
      F.done();
    }
  });
}));

test('presence A8: the hello carries present, one entry per visible person, capped at 50; nothing about presence is kept', check(async () => {
  const { url, port, runDir, dash } = await dashboard();
  const hello = async () => JSON.parse((await get(port, '/api/hello')).text);
  // (a) nobody connected
  const h0 = await hello();
  assert.deepEqual({ present: h0.present, present_more: h0.present_more }, { present: [], present_more: 0 }, 'empty with nobody connected');
  await onlyProbe(url);
  // (b) one entry per person with a visible connection, in here order
  const c = (id) => open(url, { headers: P(id) });
  const A1 = await c('zq7-a'); const A2 = await c('zq7-a');
  const F1 = await c('zq7-f'); const F2 = await c('zq7-f');
  const B = await c('zq7-b'); const V = await c('zq7-v'); const H = await c('zq7-h');
  await c('zq7-s'); // never says here
  const say = async (x, m, id) => { x.send(m); await A1.next((p) => p.t === 'people' && peopleIds(p).includes(id), 5000).catch(() => {}); };
  A1.send(hereMsg()); await A1.next((p) => p.t === 'people', 5000);
  await say(A2, hereMsg({ tab: 'zq7-2' }), 'zq7-a');
  await say(F1, hereMsg({}, false), 'zq7-f');
  await say(B, hereMsg(), 'zq7-b');
  await say(V, hereMsg(), 'zq7-v');
  await say(H, hereMsg({}, false), 'zq7-h');
  F2.send(hereMsg({ tab: 'zq7-2' }));
  V.send(hereMsg({}, false));
  const who = (id) => ({ id, name: 'zq7 Ann', level: 'full' });
  const want = [who('zq7-a'), who('zq7-f'), who('zq7-b')];
  const hb = await until(async () => { const h = await hello(); return JSON.stringify(h.present) === JSON.stringify(want) && h; }, 'present is A, F, B', 5000);
  assert.equal(hb.present_more, 0);
  assert.deepEqual(shapeErrors('hello', hb), []);
  await closeEvery();
  // (c) 200 at the field limits: the first 50 in here order, present_more 150, under 64 KB
  await onlyProbe(url);
  const { p } = await fill200(url);
  const body = (await get(port, '/api/hello')).text;
  const h = JSON.parse(body);
  assert.deepEqual(h.present, p.people.slice(0, LIMITS.present).map(({ id, name, level }) => ({ id, name, level })), "the first 50 in people's order");
  assert.equal(h.present_more, LIMITS.perServer - LIMITS.present);
  assert.deepEqual(shapeErrors('hello', h), []);
  assert.ok(Buffer.byteLength(body) < 65536, `the hello is under 64 KB (${Buffer.byteLength(body)} bytes)`);
  await closeEvery();
  // (d) nothing about presence is kept: no file under run/ holds a zq7 word, no path names presence,
  // and the dashboard's own output holds none
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.isFile() ? [path.join(d, e.name)] : []));
  const files = walk(runDir);
  assert.ok(files.length > 0, 'run/ has files to look in');
  for (const f of files) {
    const rel = path.relative(runDir, f);
    assert.ok(!/presence/i.test(rel), `no path under run/ names presence (${rel})`);
    assert.ok(!fs.readFileSync(f).includes('zq7'), `run/${rel} holds nothing of the test's presence`);
  }
  assert.ok(!dash.out().includes('zq7'), "the dashboard's output holds nothing of the test's presence");
}));
