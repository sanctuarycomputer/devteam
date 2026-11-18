// presence@1 (test/contracts/presence.md): the contract states every message, part and limit the
// design's "The contract: presence@1" sets (C1, C2, which read the document's own words); its fixtures
// match their shapes and break on every broken copy (A1); the fake relay enforces every rule (A2); the
// hello's present is capped (A34).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import {
  KINDS, AT_PART, LIMITS, hashPart, shapeErrors, capHello, limitPeople, startPresenceFake, openPresence,
} from './lib/presence-fake.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = () => fs.readFileSync(path.join(here, 'contracts', 'presence.md'), 'utf8');
const has = (text, needle) => assert.ok(text.includes(needle), `the contract says ${JSON.stringify(needle)}`);
// The text from the `## ` heading naming `word` to the next `## ` heading (a `###` never cuts it).
function section(md, word) {
  const parts = md.split(/^## /m);
  const hit = parts.filter((p) => p.split('\n', 1)[0].includes(word));
  assert.equal(hit.length, 1, `one ## section names ${word}`);
  return hit[0];
}
const all = (md, word, needles) => { const s = section(md, word); for (const n of needles) has(s, n); };

test('presence C1: the contract states every message, part and limit', () => {
  const md = contract();
  has(md, 'presence@1');
  all(md, 'The socket', ['GET /presence', 'x-devteam-relay', 'http://<Host>', 'okHost', 'before any of that payload is read']);
  all(md, 'Close codes', ['1008', '1002', '1001']);
  all(md, 'Who you are', ['x-devteam-person', '<id>;name=<name>', 'x-devteam-level', 'never from a message', '80 bytes']);
  all(md, 'Where you are', [
    '"page"', '"tab"', '"peek"', '"art"', '"thread"', 'A-Z a-z 0-9 . _ - : @ /', '1 to 120', 'h:',
    'first 16 lowercase hex characters', 'SHA-256', 'The same spot', '`page`, `tab`, `peek` and `art` all equal',
  ]);
  all(md, 'Messages', [
    '{ "t": "here", "at"', '{ "t": "move", "a"', '{ "t": "pong" }', '{ "t": "welcome", "presence": 1, "you"',
    '{ "t": "people", "people"', '{ "t": "move", "id", "conn", "a" }', '{ "t": "changed" }', '{ "t": "ping" }',
    "never to any connection of the sender's own person", 'data-presence', 'the selector alone',
    '250 ms', '500 ms', '20 s', '15 a second',
  ]);
  all(md, 'Limits', ['2048 bytes', '262144 bytes', '30 messages a second', '10 seconds in a row', '8 connections per person per server', '200 per server']);
  all(md, 'The page', ['1, 2, 4 … up to 30 s', 'never draws its own face', 'CSS.escape']);
});

test('presence C2: the lens, hub-visible, peek and present', () => {
  const md = contract();
  all(md, 'The lens', ['"type": "pointer"', '"type": "place"', '"type": "placed"', '"lens": 1', 'at most 8', 'viewport in CSS pixels', '`mouseleave` on the iframe as a leave', 'sends `{ "t": "move", "a": null }` itself', '`mouseout` with no `relatedTarget`']);
  all(md, 'hub-visible', [
    'dashboard-shell@3', '{ "devteam": "hub-visible"', 'hidden or shown', 'every load of a frame',
    "Presence's additions to shell@3's sender", "hasn't heard it counts as hidden",
  ]);
  has(section(md, 'Where you are'), "without a version and without `dashboard-shell@3`'s `view`");
  all(md, "The hello's", ['`present: [', '`present_more`', 'at most 50']);
});

// ---- A1: the fixtures and the shapes (test/lib/presence-fake.mjs's shapeErrors is the contract's value rules) ----

const fixtureDir = path.join(here, 'fixtures', 'presence');
const FIXTURES = [
  'here.json', 'here-hashed.json', 'here-hidden.json', 'move.json', 'move-leave.json', 'pong.json', 'welcome.json',
  'people.json', 'server-move.json', 'changed.json', 'ping.json', 'lens-pointer.json', 'lens-pointer-leave.json',
  'lens-place.json', 'lens-placed.json', 'hub-visible.json', 'hello-present.json', 'hello-present-cap.json',
];
// A fixture's kind: its basename is a KINDS entry, or starts with one and `-`; the longest such wins.
function kindOf(file) {
  const base = file.replace(/\.json$/, '');
  const hits = KINDS.filter((k) => base === k || base.startsWith(`${k}-`)).sort((a, b) => b.length - a.length);
  return hits[0] || null;
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const long = (n) => 'a'.repeat(n);
const bytes201 = `${'é'.repeat(100)}a`; // 201 bytes in 101 characters: the limit is bytes, not characters
const name81 = `${'"'.repeat(40)}a`; // 81 bytes once JSON-escaped
const okPresent = (i) => ({ id: `p-${i}`, name: 'Ann Lee', level: 'full' });
const okAt = () => ({ page: 'board', tab: null, peek: 'kit-1', art: null, thread: null });
const okConn = (c) => ({ conn: c, at: okAt(), visible: true });
// 25 people with 8 conns and one with 1: every field short, each person within 8, 201 conns in all.
const conns201 = () => Array.from({ length: 26 }, (_, i) => ({
  id: `p-${i}`, name: 'Ann Lee', level: 'full', conns: Array.from({ length: i < 25 ? 8 : 1 }, (_, j) => okConn(`c-${i}-${j}`)),
}));

// Every object in a message (its path and the object), for the generic key-removed and key-added breaks.
// `hello`'s own top level ignores other keys, so only `present` and `present_more` are walked there.
function walk(v, at = [], out = []) {
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...at, i], out));
  else if (isObj(v)) { out.push([at, v]); for (const [k, x] of Object.entries(v)) walk(x, [...at, k], out); }
  return out;
}
function leaves(v, at = [], out = []) {
  if (Array.isArray(v)) { if (at.length) out.push([at, v]); v.forEach((x, i) => leaves(x, [...at, i], out)); }
  else if (isObj(v)) { if (at.length) out.push([at, v]); for (const [k, x] of Object.entries(v)) leaves(x, [...at, k], out); }
  else out.push([at, v]);
  return out;
}
const get = (o, p) => p.reduce((v, k) => v[k], o);
function set(o, p, val) { get(o, p.slice(0, -1))[p[p.length - 1]] = val; }
// A value of another type than `v`, never one the contract allows in its place (a part's null, `a`'s null).
const wrongType = (v) => (v === null ? 42 : Array.isArray(v) ? {} : typeof v === 'object' ? [] : typeof v === 'string' ? 42 : typeof v === 'number' ? '1' : 'true');

// Each kind's value rules, one value just past each (set whole, so a fixture's leave form takes them too).
const VALUE_BREAKS = {
  here: [
    ['an at part of 121 characters', (m) => { m.at.page = long(121); }],
    ['an at part with a space', (m) => { m.at.tab = 'a b'; }],
    ['an empty at part', (m) => { m.at.peek = ''; }],
    ['an at part outside the set', (m) => { m.at.thread = 'é'; }],
    ['t not here', (m) => { m.t = 'hare'; }],
  ],
  move: [
    ['x: 1.01', (m) => { m.a = { k: 'kit-1', x: 1.01, y: 0 }; }],
    ['y below 0', (m) => { m.a = { k: 'kit-1', x: 0, y: -0.01 }; }],
    ['k of 201 bytes', (m) => { m.a = { k: bytes201, x: 0.5, y: 0.5 }; }],
    ['k empty', (m) => { m.a = { k: '', x: 0.5, y: 0.5 }; }],
    ['t not move', (m) => { m.t = 'mov'; }],
  ],
  pong: [['t not pong', (m) => { m.t = 'ping'; }]],
  welcome: [
    ['presence: 2', (m) => { m.presence = 2; }],
    ['a 65-character id', (m) => { m.you.id = long(65); }],
    ['an id with a space', (m) => { m.you.id = 'p a'; }],
    ['an empty id', (m) => { m.you.id = ''; }],
    ['a 33-character conn', (m) => { m.you.conn = long(33); }],
    ['t not welcome', (m) => { m.t = 'hello'; }],
  ],
  people: [
    ['level: "admin"', (m) => { m.people[0].level = 'admin'; }],
    ['a 65-character id', (m) => { m.people[0].id = long(65); }],
    ['a name of 81 bytes escaped', (m) => { m.people[0].name = name81; }],
    ['an empty name', (m) => { m.people[0].name = ''; }],
    ['a 33-character conn', (m) => { m.people[0].conns[0].conn = long(33); }],
    ['an at part of 121 characters', (m) => { m.people[0].conns[0].at.page = long(121); }],
    ['an at part with a space', (m) => { m.people[0].conns[0].at.art = 'a b'; }],
    ['a person with no conns', (m) => { m.people[0].conns = []; }],
    ['a person listed twice', (m) => { m.people.push(clone(m.people[0])); }],
    ['two people sharing one conn (ids distinct)', (m) => { m.people[1].conns[0].conn = m.people[0].conns[0].conn; }],
    ['two entries with one person id (conns distinct)', (m) => { m.people[1].id = m.people[0].id; }],
    ['a person with 9 conns', (m) => { m.people[0].conns = Array.from({ length: 9 }, (_, i) => okConn(`c-${i}`)); }],
    ['201 conns in total (26 people, at most 8 each)', (m) => { m.people = conns201(); }],
    ['a message over 262144 bytes', (m) => { m.people = limitPeople(300); }],
    ['t not people', (m) => { m.t = 'person'; }],
  ],
  'server-move': [
    ['a 65-character id', (m) => { m.id = long(65); }],
    ['a 33-character conn', (m) => { m.conn = long(33); }],
    ['x: 1.01', (m) => { m.a = { k: 'kit-1', x: 1.01, y: 0 }; }],
    ['k of 201 bytes', (m) => { m.a = { k: bytes201, x: 0.5, y: 0.5 }; }],
    ['t not move', (m) => { m.t = 'here'; }],
  ],
  changed: [['t not changed', (m) => { m.t = 'change'; }]],
  ping: [['t not ping', (m) => { m.t = 'pong'; }]],
  'lens-pointer': [
    ['x: 1.01', (m) => { Object.assign(m, { k: 'main > p', x: 1.01, y: 0 }); }],
    ['y below 0', (m) => { Object.assign(m, { k: 'main > p', x: 0, y: -0.01 }); }],
    ['k of 201 bytes', (m) => { Object.assign(m, { k: bytes201, x: 0.5, y: 0.5 }); }],
    ['k empty', (m) => { Object.assign(m, { k: '', x: 0.5, y: 0.5 }); }],
    ['lens: 2', (m) => { m.lens = 2; }],
    ['type not pointer', (m) => { m.type = 'place'; }],
  ],
  'lens-place': [
    ['9 anchors', (m) => { m.anchors = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, k: 'main > p' })); }],
    ['an anchor k of 201 bytes', (m) => { m.anchors[0].k = bytes201; }],
    ['an anchor k empty', (m) => { m.anchors[0].k = ''; }],
    ['a 33-character anchor id', (m) => { m.anchors[0].id = long(33); }],
    ['lens: 2', (m) => { m.lens = 2; }],
    ['type not place', (m) => { m.type = 'placed'; }],
  ],
  'lens-placed': [
    ['a rect x not an integer', (m) => { m.rects[0].rect = { x: 1.5, y: 0, w: 10, h: 10 }; }],
    ['a negative w', (m) => { m.rects[0].rect = { x: 0, y: 0, w: -1, h: 10 }; }],
    ['a negative h', (m) => { m.rects[0].rect = { x: 0, y: 0, w: 10, h: -1 }; }],
    ['a 33-character id', (m) => { m.rects[0].id = long(33); }],
    ['9 rects', (m) => { m.rects = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, rect: null })); }],
    ['lens: 2', (m) => { m.lens = 2; }],
    ['type not placed', (m) => { m.type = 'place'; }],
  ],
  'hub-visible': [['devteam not hub-visible', (m) => { m.devteam = 'hub-hidden'; }]],
  hello: [
    ['51 entries in present', (m) => { m.present = Array.from({ length: 51 }, (_, i) => okPresent(i)); m.present_more = 0; }],
    ['present_more: -1', (m) => { m.present_more = -1; }],
    ['present_more: 1.5', (m) => { m.present_more = 1.5; }],
    ['present_more with fewer than 50 present', (m) => { m.present = [okPresent(1)]; m.present_more = 3; }],
    ['level: "admin"', (m) => { m.present[0].level = 'admin'; }],
    ['a 65-character id', (m) => { m.present[0].id = long(65); }],
    ['a name of 81 bytes escaped', (m) => { m.present[0].name = name81; }],
    ['a person listed twice', (m) => { m.present[1] = clone(m.present[0]); }],
    ['present missing', (m) => { delete m.present; }],
    ['present_more missing', (m) => { delete m.present_more; }],
  ],
};

test('presence A1: every fixture parses and matches its shape; 200 at the limits fit 256 KB', () => {
  const files = fs.readdirSync(fixtureDir).sort();
  for (const f of FIXTURES) assert.ok(files.includes(f), `fixture ${f} exists`);
  assert.ok(files.includes('here-hashed.path.txt'), 'here-hashed.path.txt sits beside here-hashed.json');
  for (const f of files) assert.ok(f.endsWith('.json') || f === 'here-hashed.path.txt', `${f} is a fixture`);
  assert.equal(kindOf('nonsense.json'), null, 'an unknown kind is no kind');
  assert.ok(shapeErrors('nonsense', {}).length > 0, 'shapeErrors refuses an unknown kind');
  assert.deepEqual(Object.keys(VALUE_BREAKS).sort(), [...KINDS].sort(), 'every kind has its value breaks');

  const seen = new Set();
  for (const f of files.filter((x) => x.endsWith('.json'))) {
    const kind = kindOf(f);
    assert.ok(kind, `${f}'s kind is one of shapeErrors's`);
    seen.add(kind);
    const m = JSON.parse(fs.readFileSync(path.join(fixtureDir, f), 'utf8'));
    assert.deepEqual(shapeErrors(kind, m), [], `${f} matches ${kind}`);

    for (const bad of [null, [], 42, 'x']) assert.ok(shapeErrors(kind, bad).length, `${kind}: ${JSON.stringify(bad)} is no message`);
    const objs = walk(m).filter(([p]) => kind !== 'hello' || p[0] === 'present');
    assert.ok(objs.length, `${f} has an object to break`);
    for (const [p, o] of objs) {
      for (const k of Object.keys(o)) {
        const c = clone(m); delete get(c, p)[k];
        assert.ok(shapeErrors(kind, c).length, `${f}: key ${[...p, k].join('.')} removed`);
      }
      const c = clone(m); get(c, p).zz = 1;
      assert.ok(shapeErrors(kind, c).length, `${f}: key zz added at ${p.join('.') || 'top'}`);
    }
    if (kind === 'hello') { const c = clone(m); c.zz = 1; assert.deepEqual(shapeErrors(kind, c), [], `${f}: hello ignores its other keys`); }
    const typed = leaves(m).filter(([p]) => kind !== 'hello' || p[0] === 'present' || p[0] === 'present_more');
    for (const [p, v] of typed) {
      const c = clone(m); set(c, p, wrongType(v));
      assert.ok(shapeErrors(kind, c).length, `${f}: ${p.join('.')} of the wrong type`);
    }
    for (const [label, mutate] of VALUE_BREAKS[kind]) {
      const c = clone(m); mutate(c);
      assert.ok(shapeErrors(kind, c).length, `${f}: ${label}`);
    }
  }
  assert.deepEqual([...seen].sort(), [...KINDS].sort(), 'every kind has a fixture');

  const hashed = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'here-hashed.json'), 'utf8'));
  const filePath = fs.readFileSync(path.join(fixtureDir, 'here-hashed.path.txt'), 'utf8').trim();
  assert.ok(!AT_PART.test(filePath), 'the path itself is outside the set, so it is hashed');
  assert.equal(hashed.at.peek, hashPart(filePath), "here-hashed's peek is the h: of the path beside it");
  assert.match(hashed.at.peek, AT_PART);
  assert.match(hashed.at.peek, /^h:[0-9a-f]{16}$/);

  const cap = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'hello-present-cap.json'), 'utf8'));
  assert.deepEqual(cap, capHello(), 'hello-present-cap.json is capHello() (regenerate it from there)');

  const people = { t: 'people', people: limitPeople(200) };
  assert.equal(people.people.length, 200);
  for (const p of people.people) {
    assert.equal(p.id.length, 64);
    assert.equal(Buffer.byteLength(JSON.stringify(p.name)) - 2, 80, 'a name of 80 encoded bytes');
    assert.equal(p.conns.length, 1);
    assert.equal(p.conns[0].conn.length, 32);
    for (const v of Object.values(p.conns[0].at)) assert.equal(v.length, 120);
  }
  assert.deepEqual(shapeErrors('people', people), [], '200 people at the field limits match people');
  assert.ok(Buffer.byteLength(JSON.stringify(people)) < 262144, '200 people at the limits fit 256 KB');
  assert.deepEqual(shapeErrors('here', { t: 'here', at: okAt(), visible: true }), []);
  // The two bounds no other rule implies on its own: 200 conns in total, 262144 bytes.
  assert.ok(shapeErrors('people', { t: 'people', people: conns201() }).some((x) => /200 conns/.test(x)), '201 conns break the 200 per server');
  assert.ok(shapeErrors('people', { t: 'people', people: limitPeople(300) }).includes('over 262144 bytes'), 'the 262144 cap is checked');
});

// ---- A2: the fake relays as the contract says (test/lib/presence-fake.mjs's startPresenceFake) ----
// Timing checks run on the manual clock. Every wait is `next`, `closed`, or polling `stats()` (or a
// client's own counts) with a deadline; a "never" ends on a message every watched socket gets (one
// socket's order is kept), never on a wait.

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const SPOT = Object.freeze({ page: 'board', tab: null, peek: 'kit-1', art: null, thread: null });
const hereMsg = (at = {}, visible = true) => ({ t: 'here', at: { ...SPOT, ...at }, visible });
const P = (id, name = 'Ann Lee') => ({ 'x-devteam-person': `${id};name=${encodeURIComponent(name)}` });
const json = (m) => Buffer.from(JSON.stringify(m));
const stat = (fake, c) => fake.stats().find((s) => s.conn === c.you.conn);

async function until(fn, what, ms = 2000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out after ${ms} ms: ${what}`);
    await new Promise((r) => setTimeout(r, 2));
  }
}
// `c`'s close code, failing the test when no close comes within `ms` (node:test has no default timeout).
async function closedWithin(c, ms = 2000) {
  let timer;
  const late = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`not closed within ${ms} ms`)), ms); });
  try { return await Promise.race([c.closed, late]); } finally { clearTimeout(timer); }
}
// Until the fake has read `n` messages (data messages and control frames) from `c`.
const read = (fake, c, n, what = 'read') => until(() => (stat(fake, c)?.messages ?? -1) >= n, `${what}: ${n} messages`);

async function withFake(opts, fn) {
  const fake = await startPresenceFake(opts);
  try { return await fn(fake); } finally { await fake.close(); }
}
// A here of exactly `n` bytes (an extra key the server ignores pads it).
function padded(n) {
  const m = { ...hereMsg(), pad: '' };
  m.pad = 'x'.repeat(n - json(m).length);
  assert.equal(json(m).length, n);
  return json(m);
}
// `buf` cut in `n` pieces.
function pieces(buf, n) {
  const size = Math.ceil(buf.length / n);
  return Array.from({ length: n }, (_, i) => buf.subarray(i * size, (i + 1) * size));
}
// The messages `c` got from index `mark` up to (not including) `msg`.
const between = (c, mark, msg) => { const i = c.messages.indexOf(msg); assert.ok(i >= mark, 'the sentinel came after the mark'); return c.messages.slice(mark, i); };
const kinds = (list, t) => list.filter((m) => m.t === t);

// The sentinel: E (its own spot, joined and flushed earlier) changes its here; after tick(250) every
// connection that has said here gets one people naming E's new thread.
let sentinels = 0;
async function sentinel(fake, E, watched) {
  const tag = `s-${++sentinels}`;
  const n = stat(fake, E).messages;
  E.send(hereMsg({ page: 'sentinel', thread: tag }));
  await read(fake, E, n + 1, 'E');
  await fake.tick(LIMITS.peopleMs);
  const hasTag = (m) => m.t === 'people' && m.people.some((p) => p.conns.some((x) => x.conn === E.you.conn && x.at.thread === tag));
  return Promise.all(watched.map((c) => c.next(hasTag)));
}

// 200 clients at the field limits, connected and said here one at a time, so the order is fixed.
async function fill200(fake, keepFirst = false) {
  const people = limitPeople(LIMITS.perServer);
  const clients = [];
  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    const c = await openPresence(fake.url, { headers: { 'x-devteam-person': `${p.id};name=${'%22'.repeat(40)}` }, keep: keepFirst && i === 0 });
    assert.ok(c.you, `client ${i} welcomed`);
    clients.push(c);
    c.send({ t: 'here', at: p.conns[0].at, visible: true });
    await until(() => fake.stats().filter((s) => s.here).length === i + 1, `client ${i}'s here taken`);
  }
  return { people, clients };
}

test('presence A2: the fake relays as the contract says', async (t) => {
  await t.test('(a) handshake: 101 and welcome; each guard in its order; each malformed header refused', async () => {
    await withFake({ clock: 'manual' }, async (fake) => {
      const { url, port } = fake;
      const ok = await openPresence(url);
      assert.equal(ok.status, 101);
      assert.equal(ok.headers['sec-websocket-accept'], crypto.createHash('sha1').update(ok.key + GUID).digest('base64'));
      assert.equal(ok.messages[0].t, 'welcome', 'welcome first');
      assert.equal(ok.messages[0].presence, 1);
      assert.deepEqual(shapeErrors('welcome', ok.messages[0]), []);
      assert.equal((await openPresence(url, { host: `localhost:${port}` })).status, 101, 'localhost:<port> is a Host');
      assert.equal((await openPresence(`${url}/presence?x=1`)).status, 101, 'a query string is ignored');

      const person = (v) => ({ headers: { 'x-devteam-person': v } });
      const refusals = [
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
        // the order: the first guard that applies answers
        [403, 'a foreign Host on another path', { host: `evil.example:${port}` }, '/elsewhere'],
        [403, 'x-devteam-relay on another path', { headers: { 'x-devteam-relay': '1' } }, '/elsewhere'],
        [404, 'another path with no key', { headers: { 'Sec-WebSocket-Key': null } }, '/elsewhere'],
        [400, 'no key and no Origin', { headers: { 'Sec-WebSocket-Key': null }, origin: null }],
        // §4's headers
        [403, 'a name with %ZZ', person('p-a;name=%ZZ')],
        [403, 'a name that is not UTF-8 (%FF)', person('p-a;name=%FF')],
        [403, 'a name with a space', person('p-a;name=Ann Lee')],
        [403, ';name= empty', person('p-a;name=')],
        [403, 'another parameter (;x=1)', person('p-a;name=Ann;x=1')],
        [403, 'no ;name=', person('p-a')],
        [403, 'an id of 65 characters', person(`${'a'.repeat(65)};name=Ann`)],
        [403, 'an id with a space', person('p a;name=Ann')],
        [403, 'x-devteam-person twice', { headers: { 'x-devteam-person': ['p-a;name=Ann', 'p-b;name=Bo'] } }],
        [403, 'x-devteam-level: View', { headers: { ...P('p-a'), 'x-devteam-level': 'View' } }],
        [403, 'x-devteam-level twice', { headers: { ...P('p-a'), 'x-devteam-level': ['view', 'view'] } }],
        [403, 'x-devteam-level: view with no person', { headers: { 'x-devteam-level': 'view' } }],
      ];
      for (const [status, label, opts, where = ''] of refusals) {
        const c = await openPresence(`${url}${where}`, opts);
        assert.equal(c.status, status, label);
        assert.equal(c.you, undefined, `${label}: no welcome`);
        assert.deepEqual(c.messages, [], `${label}: no message`);
      }
      assert.equal(fake.stats().length, 3, 'only the three accepted connections are open');
    });
  });

  await t.test('(b) frames: every length form and fragments are read; a close is answered; protocol errors are 1002', async () => {
    await withFake({ clock: 'manual' }, async (fake) => {
      const body = json(hereMsg());
      const c7 = await openPresence(fake.url, { headers: P('p-7') });
      c7.frame(body, { len: 7 });
      const c16 = await openPresence(fake.url, { headers: P('p-16') });
      c16.frame(body, { len: 16 });
      const c64 = await openPresence(fake.url, { headers: P('p-64') });
      c64.frame(body, { len: 64 });
      const cf = await openPresence(fake.url, { headers: P('p-frag') });
      const [f1, f2, f3] = pieces(body, 3);
      cf.frame(f1, { fin: false });
      cf.frame(Buffer.from('hi'), { opcode: 9 });
      cf.frame(f2, { opcode: 0, fin: false });
      cf.frame(f3, { opcode: 0 });
      const cb = await openPresence(fake.url, { headers: P('p-byte') });
      for (const byte of cb.build(body)) { cb.raw(Buffer.from([byte])); await new Promise((r) => setImmediate(r)); }
      const all = [c7, c16, c64, cf, cb];
      await until(() => all.every((c) => stat(fake, c)?.here), 'each form taken');
      await until(() => cf.controls.some((x) => x.opcode === 10), 'the pong between fragments');
      assert.deepEqual(cf.controls.filter((x) => x.opcode === 10).map((x) => x.payload.toString()), ['hi'], 'a pong of the same payload');
      await fake.tick(LIMITS.peopleMs);
      const p = await c7.next((m) => m.t === 'people');
      assert.deepEqual(p.people.map((x) => x.id), ['p-7', 'p-16', 'p-64', 'p-frag', 'p-byte'], 'every form took its here');

      const closer = await openPresence(fake.url);
      closer.frame(Buffer.from([0x03, 0xe8]), { opcode: 8 });
      assert.equal(await closedWithin(closer), 1000, 'a close is answered with a close');

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
        const c = await openPresence(fake.url);
        act(c);
        assert.equal(await closedWithin(c), 1002, label);
      }
    });
  });

  await t.test('(c) names: only from the headers, cut to 80 JSON bytes; no headers is the owner (real clock)', async () => {
    await withFake({ ownerName: 'Ola Owner' }, async (fake) => {
      const A = await openPresence(fake.url, { headers: { 'x-devteam-person': 'p-a;name=Ann%20Lee', 'x-devteam-level': 'view' } });
      assert.equal(A.you.id, 'p-a');
      A.send({ ...hereMsg(), id: 'p-z', name: 'Zed', level: 'full', conn: 'zz' });
      const O = await openPresence(fake.url);
      assert.equal(O.you.id, 'owner');
      O.send(hereMsg());
      const Q = await openPresence(fake.url, { headers: { 'x-devteam-person': `p-q;name=${'%22'.repeat(100)}` } });
      Q.send(hereMsg());
      const K = await openPresence(fake.url, { headers: { 'x-devteam-person': 'p-k;name=%E5%B1%B1%E7%94%B0' } });
      K.send(hereMsg());
      const p = await A.next((m) => m.t === 'people' && m.people.length === 4);
      assert.deepEqual(shapeErrors('people', p), []);
      const who = Object.fromEntries(p.people.map(({ id, name, level }) => [id, { name, level }]));
      assert.deepEqual(who, {
        'p-a': { name: 'Ann Lee', level: 'view' },
        owner: { name: 'Ola Owner', level: 'full' },
        'p-q': { name: '"'.repeat(40), level: 'full' },
        'p-k': { name: '山田', level: 'full' },
      });
      assert.equal(p.people.find((x) => x.id === 'p-a').conns[0].conn, A.you.conn, "the conn is the welcome's");
    });
  });

  await t.test('(d) move: the same spot only, the sender\'s own id and conn, never to its own person, rebuilt', async () => {
    await withFake({ clock: 'manual' }, async (fake) => {
      const A = await openPresence(fake.url, { headers: P('p-a') });
      const B = await openPresence(fake.url, { headers: P('p-b', 'Bo') });
      const C = await openPresence(fake.url, { headers: P('p-c', 'Cy') });
      const A2 = await openPresence(fake.url, { headers: P('p-a') }); // A′: A's person, another browser tab
      const D = await openPresence(fake.url, { headers: P('p-d', 'Di') });
      const E = await openPresence(fake.url, { headers: P('p-e', 'Ed') });
      const N = await openPresence(fake.url, { headers: P('p-n', 'Ny') }); // says here only after the acts
      const all = [A, B, C, A2, D, E];
      A.send(hereMsg()); B.send(hereMsg()); C.send(hereMsg({ tab: 'other' })); A2.send(hereMsg());
      D.send(hereMsg({}, false)); E.send(hereMsg({ page: 'sentinel' }));
      await until(() => fake.stats().filter((s) => s.here).length === 6, 'six heres taken');
      await fake.tick(LIMITS.peopleMs);
      await Promise.all(all.map((c) => c.next((m) => m.t === 'people' && m.people.length === 5)));
      const mark = new Map(all.map((c) => [c, c.messages.length]));

      B.send({ t: 'move', a: { k: 'kit-1', x: 0.1, y: 0.2 } });
      const fromB = { t: 'move', id: 'p-b', conn: B.you.conn, a: { k: 'kit-1', x: 0.1, y: 0.2 } };
      assert.deepEqual(await A.next((m) => m.t === 'move'), fromB, "B's move reaches A");
      assert.deepEqual(await A2.next((m) => m.t === 'move'), fromB, "B's move reaches A′ (on the spot)");

      A.send({ t: 'move', id: 'p-b', conn: 'forged', name: 'Zed', zz: 1, a: { k: 'kit-1', x: 0.5, y: 0.25, zz: 2 } });
      const got = await B.next((m) => m.t === 'move');
      assert.deepEqual(got, { t: 'move', id: 'p-a', conn: A.you.conn, a: { k: 'kit-1', x: 0.5, y: 0.25 } }, "A's forged move reaches B as A's own");
      assert.deepEqual(shapeErrors('server-move', got), []);

      A.send({ t: 'move', a: { k: 'kit-1', x: 1.5, y: 0 } });
      A.send({ t: 'move', a: { k: `${'é'.repeat(100)}a`, x: 0.5, y: 0.5 } });
      A.send({ t: 'move', a: 'x' });
      A.send({ t: 'move' });
      D.send({ t: 'move', a: { k: 'kit-1', x: 0.5, y: 0.5 } }); // hidden: its move reaches nobody
      C.send({ t: 'move', a: { k: 'kit-1', x: 0.5, y: 0.5 } }); // another spot
      A.send({ t: 'move', a: null });
      assert.deepEqual(await B.next((m) => m.t === 'move'), { t: 'move', id: 'p-a', conn: A.you.conn, a: null }, 'a: null reaches B, and the bad moves before it never did');
      await read(fake, A, 1 + 6); await read(fake, C, 2); await read(fake, D, 2); await read(fake, B, 2);
      N.send({ t: 'move', a: { k: 'kit-1', x: 0.5, y: 0.5 } }); // before its here: dropped (B's two moves above stay its only)
      await read(fake, N, 1, 'N');
      N.send(hereMsg()); // on A's spot, but only now: every move above came while N had said no here
      await read(fake, N, 2, 'N');

      const ends = await sentinel(fake, E, [A, B, C, A2, D, N]);
      const moves = (c, i) => kinds(between(c, mark.get(c), ends[i]), 'move');
      assert.deepEqual(moves(A, 0), [fromB], 'A gets only B\'s move, never its own');
      assert.deepEqual(moves(B, 1).map((m) => m.a), [{ k: 'kit-1', x: 0.5, y: 0.25 }, null], 'B gets the good two only');
      assert.deepEqual(moves(C, 2), [], 'C (another tab) gets no move');
      assert.deepEqual(moves(A2, 3), [fromB], "A′ never gets its own person's moves");
      assert.deepEqual(moves(D, 4), [], 'D (hidden) gets no move');
      assert.deepEqual(between(N, 1, ends[5]), [], 'a connection that had not said here got no move (nothing between welcome and its first people)');
    });
  });

  await t.test('(e) at: each part checked and the at rebuilt; a non-object at is ignored', async () => {
    await withFake({ clock: 'manual' }, async (fake) => {
      const F = await openPresence(fake.url, { headers: P('p-f') });
      F.send({ t: 'here', at: { page: 'a b', tab: 'x'.repeat(121), peek: 5, thread: 'h:0123456789abcdef', zz: 'q' }, visible: 'yes' });
      const G = await openPresence(fake.url, { headers: P('p-g') });
      G.send({ t: 'here', at: 'x', visible: true });
      G.send({ t: 'here', at: null, visible: true });
      G.send({ t: 'here', at: [], visible: true });
      G.send({ t: 'here', visible: true });
      await read(fake, F, 1); await read(fake, G, 4);
      assert.equal(stat(fake, F).here, true);
      assert.equal(stat(fake, G).here, false, 'a here whose at is not an object is ignored');
      await fake.tick(LIMITS.peopleMs);
      const p = await F.next((m) => m.t === 'people');
      assert.deepEqual(p.people.map((x) => x.id), ['p-f'], 'G is listed nowhere');
      assert.deepEqual(p.people[0].conns[0].at, { page: null, tab: null, peek: null, art: null, thread: 'h:0123456789abcdef' });
      assert.equal(p.people[0].conns[0].visible, false, 'a visible that is not true is false');
      assert.equal(G.messages.filter((m) => m.t === 'people').length, 0, 'G gets no people');
    });
  });

  await t.test('(f) limits: sizes and frames, each closing 1008', async () => {
    await withFake({ clock: 'manual' }, async (fake) => {
      const ok = await openPresence(fake.url, { headers: P('p-ok') });
      ok.frame(padded(LIMITS.pageMsg));
      await until(() => stat(fake, ok)?.here, 'a 2048-byte message is taken');

      const limits = [
        ['a 2049-byte message', (c) => c.frame(padded(LIMITS.pageMsg + 1))],
        ['fragments summing over 2048', (c) => { const [a, b, d] = pieces(padded(2100), 3); c.frame(a, { fin: false }); c.frame(b, { opcode: 0, fin: false }); c.frame(d, { opcode: 0 }); }],
        ['17 fragments', (c) => { pieces(json(hereMsg()), 17).forEach((x, i) => c.frame(x, { opcode: i ? 0 : 1, fin: i === 16 })); }],
        ['a binary frame', (c) => c.frame(json(hereMsg()), { opcode: 2 })],
        ['a frame that is not JSON', (c) => c.frame(Buffer.from('not json'))],
        ['[]', (c) => c.frame(Buffer.from('[]'))],
        ['null', (c) => c.frame(Buffer.from('null'))],
        ['a number', (c) => c.frame(Buffer.from('42'))],
      ];
      for (const [label, act] of limits) {
        const c = await openPresence(fake.url);
        act(c);
        assert.equal(await closedWithin(c), 1008, label);
      }
      // A header declaring 2^40 bytes, with no payload ever sent, is closed on the header alone.
      const big = await openPresence(fake.url);
      big.raw(Buffer.from([0x81, 0xff, 0, 0, 0x01, 0, 0, 0, 0, 0, 1, 2, 3, 4]));
      assert.equal(await closedWithin(big), 1008, 'a 2^40 header is closed within 2 s, before any payload');
      big.destroy();
      assert.equal(stat(fake, ok).here, true, 'the 2048-byte one is still open');
    });
  });

  await t.test('(f) limits: 30 a second, here and pong never dropped, ten seconds over closed (manual clock)', async () => {
    await withFake({ clock: 'manual' }, async (fake) => {
      const A = await openPresence(fake.url, { headers: P('p-a') });
      const B = await openPresence(fake.url, { headers: P('p-b', 'Bo') });
      A.send(hereMsg()); B.send(hereMsg());
      await until(() => stat(fake, A)?.here && stat(fake, B)?.here, 'both heres taken');
      await fake.tick(LIMITS.peopleMs);
      await B.next((m) => m.t === 'people');
      await fake.tick(1000); // F2-2: the burst starts in a fresh second; the heres were in the one before
      const mark = B.messages.length;
      const move = (k, x) => A.build(json({ t: 'move', a: { k, x, y: 0 } }));
      A.raw(Buffer.concat(Array.from({ length: 31 }, (_, i) => move('kit-1', i / 100))));
      await read(fake, A, 1 + 31, 'the burst');
      assert.equal(stat(fake, A).dropped, 1, 'the 31st is dropped');
      await fake.tick(1000);
      A.send({ t: 'move', a: { k: 'sentinel', x: 0, y: 0 } });
      const s = await B.next((m) => m.t === 'move' && m.a?.k === 'sentinel');
      assert.deepEqual(kinds(between(B, mark, s), 'move').map((m) => m.a.x), Array.from({ length: 30 }, (_, i) => i / 100), '31 moves in one write reach B as 30');

      await fake.tick(1000);
      const before = stat(fake, A);
      A.raw(Buffer.concat([
        ...Array.from({ length: 31 }, (_, i) => move('kit-1', i / 100)),
        A.build(Buffer.from('p2'), { opcode: 9 }),
        A.build(json(hereMsg({ tab: 'late' }))),
        A.build(json({ t: 'pong' })),
        A.build(json({ t: 'zz' })),
      ]));
      await read(fake, A, before.messages + 35, 'the second burst');
      assert.equal(stat(fake, A).dropped - before.dropped, 3, 'the 31st move, the ping frame and the unknown t are dropped; the here and the pong are not');
      await fake.tick(LIMITS.peopleMs);
      await B.next((m) => m.t === 'people' && m.people[0].conns[0].at.tab === 'late');
      assert.ok(!A.controls.some((x) => x.opcode === 10 && x.payload.toString() === 'p2'), 'the ping over the rate is not answered');

      const G = await openPresence(fake.url, { headers: P('p-g') });
      for (let sec = 1; sec <= LIMITS.overSeconds; sec++) {
        G.raw(Buffer.concat(Array.from({ length: 31 }, () => G.build(json({ t: 'zz' })))));
        await read(fake, G, 31 * sec, `second ${sec}`);
        await fake.tick(1000);
        if (sec < LIMITS.overSeconds) assert.ok(stat(fake, G), `still open after ${sec} seconds over`);
      }
      assert.equal(await closedWithin(G), 1008, 'ten seconds of 31 close');
      assert.ok(stat(fake, A), 'A, over in single seconds only, stays open');
    });
  });

  await t.test('(f) limits: the 9th connection of one person is closed 1008 before welcome', async () => {
    await withFake({ clock: 'manual' }, async (fake) => {
      for (let i = 0; i < LIMITS.perPerson; i++) assert.ok((await openPresence(fake.url, { headers: P('p-n') })).you, `connection ${i + 1} welcomed`);
      const ninth = await openPresence(fake.url, { headers: P('p-n') });
      assert.equal(ninth.status, 101, 'accepted');
      assert.equal(ninth.you, undefined, 'no welcome');
      assert.equal(await closedWithin(ninth), 1008);
      assert.ok((await openPresence(fake.url, { headers: P('p-m') })).you, 'another person is still welcome');
    });
  });

  await t.test('(f) limits: 200 at the field limits, each people frame under 262144; the 201st closed 1008', async () => {
    await withFake({ clock: 'manual' }, async (fake) => {
      const { people, clients } = await fill200(fake, true);
      await fake.tick(LIMITS.peopleMs);
      // With keep: false a client keeps only frame sizes; its people is the first frame after welcome.
      await until(() => clients.every((c) => c.sizes.length >= 2), "each of the 200 has its people", 20000);
      for (const [i, c] of clients.entries()) {
        assert.equal(c.sizes.length, 2, `client ${i}: welcome and one people`);
        assert.ok(c.sizes.every((n) => n < LIMITS.serverMsg), `client ${i}: every frame under 262144`);
      }
      const p = clients[0].messages[1];
      assert.equal(p.t, 'people');
      assert.deepEqual(p.people.map((x) => x.id), people.map((x) => x.id), "people in the order they said here");
      assert.deepEqual(shapeErrors('people', p), []);
      const over = await openPresence(fake.url, { headers: P('p-201') });
      assert.equal(over.status, 101);
      assert.equal(over.you, undefined, 'the 201st gets no welcome');
      assert.equal(await closedWithin(over), 1008);
      assert.equal(fake.stats().length, LIMITS.perServer);
    });
  });

  await t.test('(g) changed: coalesced to one each 500 ms, never dropped; only to connections that said here; none on the hub', async () => {
    await withFake({ clock: 'manual' }, async (fake) => {
      const A = await openPresence(fake.url, { headers: P('p-a') });
      const B = await openPresence(fake.url, { headers: P('p-b') });
      const E = await openPresence(fake.url, { headers: P('p-e') });
      const N = await openPresence(fake.url, { headers: P('p-n') }); // never says here
      A.send(hereMsg()); B.send(hereMsg({ tab: 'other' })); E.send(hereMsg({ page: 'sentinel' }));
      await until(() => fake.stats().filter((s) => s.here).length === 3, 'three heres taken');
      await fake.tick(LIMITS.peopleMs);
      await Promise.all([A, B].map((c) => c.next((m) => m.t === 'people')));

      const mark = [A.messages.length, B.messages.length];
      fake.changed(); fake.changed(); fake.changed();
      await A.next((m) => m.t === 'changed'); await B.next((m) => m.t === 'changed');
      let ends = await sentinel(fake, E, [A, B]); // 250 ms in
      assert.equal(kinds(between(A, mark[0], ends[0]), 'changed').length, 1, 'one changed at once');
      assert.equal(kinds(between(B, mark[1], ends[1]), 'changed').length, 1, 'one changed at once (B)');
      await fake.tick(LIMITS.changedMs - LIMITS.peopleMs); // the window's end
      await A.next((m) => m.t === 'changed'); await B.next((m) => m.t === 'changed');
      const mark2 = [A.messages.length, B.messages.length];
      await fake.tick(LIMITS.changedMs);
      ends = await sentinel(fake, E, [A, B]);
      assert.deepEqual(kinds(between(A, mark2[0], ends[0]), 'changed'), [], 'none after another 500 ms');
      assert.deepEqual(kinds(between(B, mark2[1], ends[1]), 'changed'), []);
      assert.deepEqual(N.messages.map((m) => m.t), ['welcome'], 'a connection that never said here gets nothing');
    });
    await withFake({ clock: 'manual', hub: true }, async (fake) => {
      const A = await openPresence(fake.url, { headers: P('p-a') });
      const E = await openPresence(fake.url, { headers: P('p-e') });
      A.send(hereMsg()); E.send(hereMsg({ page: 'sentinel' }));
      await until(() => fake.stats().filter((s) => s.here).length === 2, 'two heres taken');
      await fake.tick(LIMITS.peopleMs);
      await A.next((m) => m.t === 'people');
      const mark = A.messages.length;
      fake.changed();
      await fake.tick(LIMITS.changedMs);
      const [end] = await sentinel(fake, E, [A]);
      assert.deepEqual(kinds(between(A, mark, end), 'changed'), [], 'the hub sends no changed');
    });
  });

  await t.test('(h) ping and people: two unanswered pings close 1001; people coalesced in 250 ms; a gone client leaves', async () => {
    await withFake({ clock: 'manual' }, async (fake) => {
      const Pn = await openPresence(fake.url, { headers: P('p-never') });
      const Q = await openPresence(fake.url, { headers: P('p-q') });
      for (let i = 1; i <= 2; i++) {
        await fake.tick(LIMITS.pingMs);
        await Q.next((m) => m.t === 'ping');
        Q.send({ t: 'pong' });
        await until(() => stat(fake, Q).unanswered === 0, 'Q answered');
        await Pn.next((m) => m.t === 'ping');
        assert.equal(stat(fake, Pn).unanswered, i);
      }
      await fake.tick(LIMITS.pingMs);
      assert.equal(await closedWithin(Pn), 1001, 'closed after the third tick(20000)');
      await Q.next((m) => m.t === 'ping');
      assert.ok(stat(fake, Q), 'the one that pongs is still open');
    });
    await withFake({ clock: 'manual' }, async (fake) => {
      const X = await openPresence(fake.url, { headers: P('p-x') });
      const Y = await openPresence(fake.url, { headers: P('p-y') });
      const Z = await openPresence(fake.url, { headers: P('p-z') });
      for (const [i, c] of [X, Y, Z].entries()) {
        c.send(hereMsg({ tab: `t${i}` }));
        await until(() => stat(fake, c)?.here, `here ${i} taken`);
      }
      await fake.tick(LIMITS.peopleMs);
      const first = await Promise.all([X, Y, Z].map((c) => c.next((m) => m.t === 'people')));
      for (const p of first) assert.deepEqual(p.people.map((x) => x.id), ['p-x', 'p-y', 'p-z'], "the first people lists all three, in here's order");
      const marks = [X, Y].map((c, i) => c.messages.indexOf(first[i]) + 1);
      X.send(hereMsg({ tab: 't0' })); // identical to X's last here: changes nothing, so no people
      await read(fake, X, 2);
      await fake.tick(LIMITS.peopleMs);
      Y.send(hereMsg({ tab: 'moved' })); // the sentinel, from another client
      await read(fake, Y, 2);
      await fake.tick(LIMITS.peopleMs);
      for (const [i, c] of [X, Y].entries()) {
        const p = await c.next((m) => m.t === 'people');
        assert.equal(p.people[1].conns[0].at.tab, 'moved', "the first people after the repeat is the sentinel's: the repeat sent none");
        assert.deepEqual(between(c, marks[i], p), [], 'exactly one people per window, none for the repeat');
      }
      Z.destroy(); // no close frame
      await until(() => !fake.stats().some((s) => s.id === 'p-z'), 'Z gone');
      await fake.tick(LIMITS.peopleMs);
      const gone = await X.next((m) => m.t === 'people');
      assert.deepEqual(gone.people.map((x) => x.id), ['p-x', 'p-y'], 'a client gone without a close leaves people');
    });
  });
});

// ---- A34: a hello's present ----

test("presence A34: a hello's present is capped at 50, with present_more", async (t) => {
  const s = section(contract(), "The hello's");
  has(s, 'at most 50'); has(s, '`present_more`');
  const cap = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'hello-present-cap.json'), 'utf8'));
  assert.deepEqual(shapeErrors('hello', cap), []);
  assert.equal(cap.present.length, 50);
  for (const p of cap.present) {
    assert.equal(p.id.length, 64);
    assert.equal(Buffer.byteLength(JSON.stringify(p.name)) - 2, 80);
  }
  assert.equal(cap.present_more, 150);
  assert.ok(Buffer.byteLength(JSON.stringify({ present: cap.present, present_more: cap.present_more })) < LIMITS.presentBytes);

  await t.test('3 people: 3 and 0', async () => {
    await withFake({ clock: 'manual' }, async (fake) => {
      for (const id of ['p-1', 'p-2', 'p-3']) {
        const c = await openPresence(fake.url, { headers: P(id) });
        c.send(hereMsg());
        await until(() => stat(fake, c)?.here, `${id} said here`);
      }
      await openPresence(fake.url, { headers: P('p-silent') }); // no here: in no present
      assert.deepEqual(fake.present(), {
        present: ['p-1', 'p-2', 'p-3'].map((id) => ({ id, name: 'Ann Lee', level: 'full' })), present_more: 0,
      });
    });
  });
  await t.test("200 people: 50 in people's order and present_more 150", async () => {
    await withFake({ clock: 'manual' }, async (fake) => {
      const { people } = await fill200(fake);
      const pr = fake.present();
      assert.deepEqual(pr.present, people.slice(0, 50).map(({ id, name, level }) => ({ id, name, level })));
      assert.equal(pr.present_more, 150);
      assert.deepEqual(shapeErrors('hello', pr), []);
      assert.ok(Buffer.byteLength(JSON.stringify(pr)) < LIMITS.presentBytes);
    });
  });
});
