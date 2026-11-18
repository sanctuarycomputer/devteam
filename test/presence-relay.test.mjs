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
  closer.frame(Buffer.from([0x03, 0xe8]), { opcode: 8 });
  assert.equal(await closedWithin(closer), 1000, 'a close is answered with a close of the same code');

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
  const all = [A, B, C, A2, D, E];
  const atC = { tab: 'zq7-other' };
  const atD = {};
  const atE = { page: 'zq7-sentinel' };
  A.send(hereMsg()); B.send(hereMsg()); C.send(hereMsg(atC)); A2.send(hereMsg());
  D.send(hereMsg(atD, false)); E.send(hereMsg(atE));
  const firsts = await Promise.all(all.map((c) => c.next(peopleWith(5), 5000)));
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

  const ends = await sentinel(E, atE, [A, B, C, A2, D, N]);
  const moves = (c, i) => kinds(between(c, mark.get(c) ?? 1, ends[i]), 'move');
  assert.deepEqual(moves(A, 0), [fromB], "A gets only B's move, never its own");
  assert.deepEqual(moves(B, 1).map((m) => m.a), [{ k: 'zq7-kit-1', x: 0.5, y: 0.25 }, null], "B gets A's two");
  assert.deepEqual(moves(C, 2), [], 'C (another tab) gets no move');
  assert.deepEqual(moves(A2, 3), [fromB], "A′ never gets its own person's moves");
  assert.deepEqual(moves(D, 4), [], 'D (hidden) gets no move');
  assert.deepEqual(moves(N, 5), [], 'N gets no move');
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
