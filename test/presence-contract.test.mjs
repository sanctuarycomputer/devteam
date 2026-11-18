// presence@1 (test/contracts/presence.md): the contract states every message, part and limit the
// design's "The contract: presence@1" sets (C1, C2, which read the document's own words); its fixtures
// match their shapes and break on every broken copy (A1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS, AT_PART, hashPart, shapeErrors, capHello, limitPeople } from './lib/presence-fake.mjs';

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
  all(md, 'The lens', ['"type": "pointer"', '"type": "place"', '"type": "placed"', '"lens": 1', 'at most 8', 'viewport in CSS pixels']);
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
  assert.ok(shapeErrors('here', { t: 'here', at: okAt(), visible: true }).length === 0);
});
