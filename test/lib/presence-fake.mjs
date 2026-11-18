// presence@1 (test/contracts/presence.md, §12): the shapes every message must have, as code. A page
// test, the fake relay below and the real relay's tests (kit-631) check messages with `shapeErrors`,
// and build the server's rebuilds with `checkAt`, `cutName` and `hashPart`. Node built-ins only.
import crypto from 'node:crypto';

// §5: an `at` part, and the ids and conns drawn from the same set (§4).
export const AT_PART = /^[A-Za-z0-9._:@/-]{1,120}$/;
export const AT_KEYS = ['page', 'tab', 'peek', 'art', 'thread'];
export const ID_RE = /^[A-Za-z0-9._:@/-]{1,64}$/;
export const CONN_RE = /^[A-Za-z0-9._:@/-]{1,32}$/;

// Every number of §2, §6, §7, §10 and §11.
export const LIMITS = Object.freeze({
  part: 120, pageMsg: 2048, serverMsg: 262144, perSecond: 30, overSeconds: 10, perPerson: 8, perServer: 200,
  frames: 16, anchorBytes: 200, nameBytes: 80, place: 8, present: 50, presentBytes: 16384,
  peopleMs: 250, changedMs: 500, pingMs: 20000,
});

// The kinds `shapeErrors` knows: from the page, from the server, the lens's, the hub's, the hello's.
export const KINDS = Object.freeze([
  'here', 'move', 'pong', 'welcome', 'people', 'server-move', 'changed', 'ping',
  'lens-pointer', 'lens-place', 'lens-placed', 'hub-visible', 'hello',
]);

// §5: a value outside the set or over 120 characters is sent as `h:` and 16 hex of its SHA-256.
export function hashPart(value) {
  return `h:${crypto.createHash('sha256').update(Buffer.from(String(value), 'utf8')).digest('hex').slice(0, 16)}`;
}

const jsonBytes = (s) => Buffer.byteLength(JSON.stringify(s)) - 2; // a string's JSON encoding, without its quotes

// §4: the longest start, by whole characters, whose JSON encoding (without quotes) is at most 80 bytes.
export function cutName(name) {
  let out = '';
  let n = 0;
  for (const ch of String(name)) {
    const b = jsonBytes(ch);
    if (n + b > LIMITS.nameBytes) break;
    out += ch;
    n += b;
  }
  return out;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// §5: the server's rebuild of `at`: only the five keys, each a string in the set or null.
export function checkAt(at) {
  const o = isObj(at) ? at : {};
  const out = {};
  for (const k of AT_KEYS) {
    const v = own(o, k) ? o[k] : null;
    out[k] = typeof v === 'string' && AT_PART.test(v) ? v : null;
  }
  return out;
}

// ---- shapeErrors: each check pushes a short reason to `e`, naming the path it broke at ----

function keys(e, where, o, want) {
  if (!isObj(o)) { e.push(`${where}: not an object`); return false; }
  for (const k of want) if (!own(o, k)) e.push(`${where}: no ${k}`);
  for (const k of Object.keys(o)) if (!want.includes(k)) e.push(`${where}: extra key ${k}`);
  return true;
}
function eq(e, where, v, want) { if (v !== want) e.push(`${where}: not ${JSON.stringify(want)}`); }
function re(e, where, v, rx, what) { if (typeof v !== 'string' || !rx.test(v)) e.push(`${where}: not ${what}`); }
const id = (e, where, v) => re(e, where, v, ID_RE, 'an id (1 to 64 of the set)');
const conn = (e, where, v) => re(e, where, v, CONN_RE, 'a conn (1 to 32 of the set)');
function bool(e, where, v) { if (typeof v !== 'boolean') e.push(`${where}: not a boolean`); }
function frac(e, where, v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) e.push(`${where}: not a finite number in 0..1`);
}
function anchor(e, where, v) {
  if (typeof v !== 'string' || v.length === 0 || Buffer.byteLength(v) > LIMITS.anchorBytes) e.push(`${where}: not 1 to 200 bytes`);
}
function level(e, where, v) { if (v !== 'full' && v !== 'view') e.push(`${where}: not full or view`); }
function name(e, where, v) {
  if (typeof v !== 'string' || v.length === 0 || jsonBytes(v) > LIMITS.nameBytes) e.push(`${where}: not a name of 1 to 80 JSON bytes`);
}
function list(e, where, v, max) {
  if (!Array.isArray(v)) { e.push(`${where}: not an array`); return false; }
  if (v.length > max) e.push(`${where}: over ${max} entries`);
  return true;
}
function unique(e, where, ids) { if (new Set(ids).size !== ids.length) e.push(`${where}: an id listed twice`); }
function at(e, where, v) {
  if (!keys(e, where, v, AT_KEYS)) return;
  for (const k of AT_KEYS) if (v[k] !== null) re(e, `${where}.${k}`, v[k], AT_PART, 'null or an at part');
}
// `a` in a move, the page's or the server's: null or { k, x, y }.
function pointer(e, where, v) {
  if (v === null) return;
  if (!keys(e, where, v, ['k', 'x', 'y'])) return;
  anchor(e, `${where}.k`, v.k); frac(e, `${where}.x`, v.x); frac(e, `${where}.y`, v.y);
}
function size(e, m, max) {
  if (Buffer.byteLength(JSON.stringify(m)) > max) e.push(`over ${max} bytes`);
}
// A person's own fields (`people` entries and `present` entries share them).
function person(e, where, p, extra) {
  if (!keys(e, where, p, ['id', 'name', 'level', ...extra])) return false;
  id(e, `${where}.id`, p.id); name(e, `${where}.name`, p.name); level(e, `${where}.level`, p.level);
  return true;
}

const CHECK = {
  here(e, m) {
    if (!keys(e, 'here', m, ['t', 'at', 'visible'])) return;
    eq(e, 'here.t', m.t, 'here'); at(e, 'here.at', m.at); bool(e, 'here.visible', m.visible);
    size(e, m, LIMITS.pageMsg);
  },
  move(e, m) {
    if (!keys(e, 'move', m, ['t', 'a'])) return;
    eq(e, 'move.t', m.t, 'move'); pointer(e, 'move.a', m.a);
    size(e, m, LIMITS.pageMsg);
  },
  pong(e, m) { if (keys(e, 'pong', m, ['t'])) eq(e, 'pong.t', m.t, 'pong'); },
  welcome(e, m) {
    if (!keys(e, 'welcome', m, ['t', 'presence', 'you'])) return;
    eq(e, 'welcome.t', m.t, 'welcome'); eq(e, 'welcome.presence', m.presence, 1);
    if (keys(e, 'welcome.you', m.you, ['id', 'conn'])) { id(e, 'welcome.you.id', m.you.id); conn(e, 'welcome.you.conn', m.you.conn); }
  },
  people(e, m) {
    if (!keys(e, 'people', m, ['t', 'people'])) return;
    eq(e, 'people.t', m.t, 'people');
    if (!list(e, 'people.people', m.people, LIMITS.perServer)) return;
    const conns = [];
    m.people.forEach((p, i) => {
      const w = `people.people[${i}]`;
      if (!person(e, w, p, ['conns'])) return;
      if (!list(e, `${w}.conns`, p.conns, LIMITS.perPerson)) return;
      if (p.conns.length === 0) e.push(`${w}.conns: empty (a person is listed only with a connection)`);
      p.conns.forEach((c, j) => {
        const cw = `${w}.conns[${j}]`;
        if (!keys(e, cw, c, ['conn', 'at', 'visible'])) return;
        conn(e, `${cw}.conn`, c.conn); at(e, `${cw}.at`, c.at); bool(e, `${cw}.visible`, c.visible);
        conns.push(c.conn);
      });
    });
    unique(e, 'people.people', m.people.map((p) => (isObj(p) ? p.id : p)));
    unique(e, 'people.people[].conns', conns);
    size(e, m, LIMITS.serverMsg);
  },
  'server-move'(e, m) {
    if (!keys(e, 'server-move', m, ['t', 'id', 'conn', 'a'])) return;
    eq(e, 'server-move.t', m.t, 'move'); id(e, 'server-move.id', m.id); conn(e, 'server-move.conn', m.conn);
    pointer(e, 'server-move.a', m.a);
  },
  changed(e, m) { if (keys(e, 'changed', m, ['t'])) eq(e, 'changed.t', m.t, 'changed'); },
  ping(e, m) { if (keys(e, 'ping', m, ['t'])) eq(e, 'ping.t', m.t, 'ping'); },
  'lens-pointer'(e, m) {
    if (!isObj(m)) { e.push('lens-pointer: not an object'); return; }
    const leave = own(m, 'k') && m.k === null;
    if (!keys(e, 'lens-pointer', m, leave ? ['lens', 'type', 'k'] : ['lens', 'type', 'k', 'x', 'y'])) return;
    eq(e, 'lens-pointer.lens', m.lens, 1); eq(e, 'lens-pointer.type', m.type, 'pointer');
    if (!leave) { anchor(e, 'lens-pointer.k', m.k); frac(e, 'lens-pointer.x', m.x); frac(e, 'lens-pointer.y', m.y); }
  },
  'lens-place'(e, m) {
    if (!keys(e, 'lens-place', m, ['lens', 'type', 'anchors'])) return;
    eq(e, 'lens-place.lens', m.lens, 1); eq(e, 'lens-place.type', m.type, 'place');
    if (!list(e, 'lens-place.anchors', m.anchors, LIMITS.place)) return;
    m.anchors.forEach((a, i) => {
      const w = `lens-place.anchors[${i}]`;
      if (keys(e, w, a, ['id', 'k'])) { conn(e, `${w}.id`, a.id); anchor(e, `${w}.k`, a.k); }
    });
  },
  'lens-placed'(e, m) {
    if (!keys(e, 'lens-placed', m, ['lens', 'type', 'rects'])) return;
    eq(e, 'lens-placed.lens', m.lens, 1); eq(e, 'lens-placed.type', m.type, 'placed');
    if (!list(e, 'lens-placed.rects', m.rects, LIMITS.place)) return;
    m.rects.forEach((r, i) => {
      const w = `lens-placed.rects[${i}]`;
      if (!keys(e, w, r, ['id', 'rect'])) return;
      conn(e, `${w}.id`, r.id);
      if (r.rect === null || !keys(e, `${w}.rect`, r.rect, ['x', 'y', 'w', 'h'])) return;
      for (const k of ['x', 'y', 'w', 'h']) if (!Number.isInteger(r.rect[k])) e.push(`${w}.rect.${k}: not an integer`);
      for (const k of ['w', 'h']) if (typeof r.rect[k] === 'number' && r.rect[k] < 0) e.push(`${w}.rect.${k}: negative`);
    });
  },
  'hub-visible'(e, m) {
    if (!keys(e, 'hub-visible', m, ['devteam', 'visible'])) return;
    eq(e, 'hub-visible.devteam', m.devteam, 'hub-visible'); bool(e, 'hub-visible.visible', m.visible);
  },
  // §11: only `present` and `present_more`; the hello's other keys belong to its own contract.
  hello(e, m) {
    if (!isObj(m)) { e.push('hello: not an object'); return; }
    if (!own(m, 'present')) e.push('hello: no present');
    if (!own(m, 'present_more')) e.push('hello: no present_more');
    const pm = m.present_more;
    if (own(m, 'present_more') && (!Number.isInteger(pm) || pm < 0)) e.push('hello.present_more: not a non-negative integer');
    if (!own(m, 'present') || !list(e, 'hello.present', m.present, LIMITS.present)) return;
    m.present.forEach((p, i) => person(e, `hello.present[${i}]`, p, []));
    unique(e, 'hello.present', m.present.map((p) => (isObj(p) ? p.id : p)));
    if (Number.isInteger(pm) && pm > 0 && m.present.length < LIMITS.present) e.push('hello.present_more: people left out of a present under 50');
  },
};

// The ways `msg` breaks kind `kind`'s shape; empty when it matches.
export function shapeErrors(kind, msg) {
  if (!Object.prototype.hasOwnProperty.call(CHECK, kind)) return [`unknown kind ${JSON.stringify(kind)}`];
  const e = [];
  CHECK[kind](e, msg);
  return e;
}

// ---- people at the field limits (A1's 200 in `people`, A34's hello, the fake's 200 connections) ----

const pad = (head, len, i) => `${head}${'x'.repeat(len - head.length - 3)}${String(i).padStart(3, '0')}`;

// `n` people (n <= 1000), one connection each, every field at its limit: a 64-character id, a name of
// 40 `"` (80 bytes once escaped), a 32-character conn and five 120-character parts. Deterministic.
export function limitPeople(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: pad('p-', 64, i),
    name: '"'.repeat(40),
    level: 'full',
    conns: [{
      conn: pad('c-', 32, i),
      at: Object.fromEntries(AT_KEYS.map((k) => [k, pad(`${k}-`, LIMITS.part, i)])),
      visible: true,
    }],
  }));
}

// test/fixtures/presence/hello-present-cap.json: a hello for 200 people at the field limits, capped as
// §11 says (the first 50 in `people`'s order, `present_more` 150). Its other keys are generic.
export function capHello() {
  const all = limitPeople(200);
  return {
    devteam: 1,
    hub: 1,
    name: 'example',
    present: all.slice(0, LIMITS.present).map(({ id, name, level }) => ({ id, name, level })),
    present_more: all.length - LIMITS.present,
  };
}
