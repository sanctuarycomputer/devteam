// presence@1 (test/contracts/presence.md, §12): the shapes every message must have, as code, and a
// fake relay that enforces §2 to §7 with its test client. A page test, the fake relay below and the
// real relay's tests (kit-631) check messages with `shapeErrors`, and build the server's rebuilds with
// `checkAt`, `cutName` and `hashPart`. The fake is a `node:http` server on 127.0.0.1 with the
// `/presence` upgrade and RFC 6455 written by hand; `openPresence` is a client over `net` that can
// send any frame, legal or not. Node built-ins only.
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';

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
    // §7: 200 connections per server, so at most 200 conns in all (which also bounds people to 200).
    const total = m.people.reduce((n, p) => n + (isObj(p) && Array.isArray(p.conns) ? p.conns.length : 0), 0);
    if (total > LIMITS.perServer) e.push(`people.people: over ${LIMITS.perServer} conns in total`);
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

// ---- the clock: every timer of the fake, and the per-second count, go through it ----

const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };

// `now()` and `after(ms, fn)` (returning a cancel). The manual clock starts at 0, keeps due times and
// moves only by `tick(ms)`, which runs each due timer in order (by due time, then by when it was set),
// yielding after each so socket writes go out and pending reads come in.
function makeClock(kind) {
  if (kind === 'manual') {
    let t = 0;
    let seq = 0;
    let due = [];
    return {
      now: () => t,
      after(ms, fn) {
        const e = { at: t + ms, seq: seq++, fn, off: false };
        due.push(e);
        return () => { e.off = true; };
      },
      async tick(ms) {
        const end = t + ms;
        await settle();
        for (;;) {
          let next = null;
          for (const e of due) if (!e.off && e.at <= end && (!next || e.at < next.at || (e.at === next.at && e.seq < next.seq))) next = e;
          if (!next) break;
          next.off = true;
          t = next.at;
          next.fn();
          due = due.filter((e) => !e.off);
          await settle();
        }
        t = end;
        await settle();
      },
      stop() { due = []; },
    };
  }
  if (kind !== 'real') throw new Error(`clock: 'real' or 'manual', not ${JSON.stringify(kind)}`);
  const t0 = Date.now();
  const live = new Set();
  return {
    now: () => Date.now() - t0,
    after(ms, fn) {
      const h = setTimeout(() => { live.delete(h); fn(); }, ms);
      live.add(h);
      return () => { clearTimeout(h); live.delete(h); };
    },
    tick() { throw new Error('tick(ms) is for the manual clock only'); },
    stop() { for (const h of live) clearTimeout(h); live.clear(); },
  };
}

// ---- RFC 6455 framing, both ends ----

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const acceptOf = (key) => crypto.createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
const OPCODES = [0, 1, 2, 8, 9, 10];

// A frame: `len` forces the 7-, 16- or 64-bit length form (a longer form for a short payload is legal).
function encodeFrame(bytes, { opcode = 1, fin = true, mask = false, len, rsv = 0 } = {}) {
  const p = Buffer.from(bytes);
  const n = p.length;
  const form = len ?? (n < 126 ? 7 : n < 65536 ? 16 : 64);
  const head = [(fin ? 0x80 : 0) | ((rsv & 7) << 4) | (opcode & 0x0f)];
  const m = mask ? 0x80 : 0;
  let ext = Buffer.alloc(0);
  if (form === 7) {
    if (n > 125) throw new Error('a 7-bit length holds at most 125');
    head.push(m | n);
  } else if (form === 16) {
    head.push(m | 126); ext = Buffer.alloc(2); ext.writeUInt16BE(n);
  } else {
    head.push(m | 127); ext = Buffer.alloc(8); ext.writeUInt32BE(Math.floor(n / 2 ** 32)); ext.writeUInt32BE(n >>> 0, 4);
  }
  if (!mask) return Buffer.concat([Buffer.from(head), ext, p]);
  const key = crypto.randomBytes(4);
  const body = Buffer.alloc(n);
  for (let i = 0; i < n; i++) body[i] = p[i] ^ key[i & 3];
  return Buffer.concat([Buffer.from(head), ext, key, body]);
}
const closeFrame = (code) => {
  const b = Buffer.alloc(code == null ? 0 : 2);
  if (code != null) b.writeUInt16BE(code);
  return encodeFrame(b, { opcode: 8 });
};
const textFrame = (m) => encodeFrame(Buffer.from(JSON.stringify(m)), { opcode: 1 });
const utf8 = (buf) => new TextDecoder('utf-8', { fatal: true }).decode(buf);

// ---- the headers (§4) ----

const NAME_RE = /^(?:[A-Za-z0-9\-_.!~*'()]|%[0-9A-Fa-f]{2})+$/;
// rawHeaders' values for one header name, however it was cased.
function rawValues(req, name) {
  const out = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === name) out.push(req.rawHeaders[i + 1]);
  return out;
}
function decodeName(s) {
  const bytes = [];
  for (let i = 0; i < s.length;) {
    if (s[i] === '%') { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 3; } else { bytes.push(s.charCodeAt(i)); i += 1; }
  }
  try { return utf8(Uint8Array.from(bytes)); } catch { return null; }
}
// The person of an upgrade, or null when §4 refuses it.
function personOf(req, ownerName) {
  const ps = rawValues(req, 'x-devteam-person');
  const ls = rawValues(req, 'x-devteam-level');
  if (ps.length > 1 || ls.length > 1) return null;
  if (ls.length && ls[0] !== 'full' && ls[0] !== 'view') return null;
  if (!ps.length) return ls.length ? null : { id: 'owner', name: cutName(ownerName), level: 'full' };
  const m = /^([^;]*);name=(.*)$/.exec(ps[0]);
  if (!m || !ID_RE.test(m[1]) || !NAME_RE.test(m[2])) return null;
  const name = decodeName(m[2]);
  if (!name) return null;
  return { id: m[1], name: cutName(name), level: ls.length ? ls[0] : 'full' };
}
const validKey = (k) => typeof k === 'string' && /^[A-Za-z0-9+/]{22}==$/.test(k) && Buffer.from(k, 'base64').length === 16;
const pathOf = (url) => { try { return new URL(url, 'http://x').pathname; } catch { return null; } };
const STATUS = { 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found' };

const sameSpot = (a, b) => a.page === b.page && a.tab === b.tab && a.peek === b.peek && a.art === b.art;
const sameAt = (a, b) => AT_KEYS.every((k) => a[k] === b[k]);
const frac01 = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
// §6: a move's `a`, rebuilt from checked fields; undefined when it is neither null nor a pointer.
function pointerOf(a) {
  if (a === null) return null;
  if (!isObj(a) || typeof a.k !== 'string' || a.k.length === 0 || Buffer.byteLength(a.k) > LIMITS.anchorBytes) return undefined;
  if (!frac01(a.x) || !frac01(a.y)) return undefined;
  return { k: a.k, x: a.x, y: a.y };
}

// ---- the fake relay (§12) ----

export async function startPresenceFake({ hub = false, ownerName = 'Owner', serve, clock = 'real' } = {}) {
  const clk = makeClock(clock);
  const sockets = new Set();
  const conns = new Set(); // open connections past welcome, in open order
  let port = 0;
  let connSeq = 0;
  let hereSeq = 0;
  let peopleCancel = null;
  const chg = { open: false, pending: false };

  // §2's guards, in order; the person, or the status refusing it.
  function guard(req, upgrade) {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return 403;
    if (rawValues(req, 'x-devteam-relay').length) return 403;
    if (pathOf(req.url) !== '/presence') return 404;
    if (!upgrade || String(req.headers.upgrade || '').toLowerCase() !== 'websocket'
      || req.headers['sec-websocket-version'] !== '13' || !validKey(req.headers['sec-websocket-key'])) return 400;
    const origin = req.headers.origin;
    if (origin === undefined || origin === 'null' || origin !== `http://${host}`) return 403;
    return personOf(req, ownerName) || 403;
  }

  const server = http.createServer((req, res) => {
    try {
      if (pathOf(req.url) === '/presence') { const r = guard(req, false); res.writeHead(r); res.end(); return; }
      if (serve) { serve(req, res); return; }
      res.writeHead(404); res.end();
    } catch {
      try { res.writeHead(500); res.end(); } catch { /* gone */ }
    }
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    try {
      const who = guard(req, true);
      if (typeof who === 'number') {
        socket.end(`HTTP/1.1 ${who} ${STATUS[who]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
        return;
      }
      accept(req, socket, head, who);
    } catch {
      socket.destroy();
    }
  });

  const write = (c, buf) => { if (c.open && !c.socket.destroyed) c.socket.write(buf); };
  const hereConns = () => [...conns].filter((c) => c.here).sort((a, b) => a.seq - b.seq);
  function peopleList() {
    const by = new Map();
    for (const c of hereConns()) {
      let p = by.get(c.who.id);
      if (!p) { p = { id: c.who.id, name: c.who.name, level: c.who.level, conns: [] }; by.set(c.who.id, p); }
      p.conns.push({ conn: c.conn, at: { ...c.at }, visible: c.visible });
    }
    return [...by.values()];
  }
  function flushPeople() {
    peopleCancel = null;
    const f = textFrame({ t: 'people', people: peopleList() });
    for (const c of hereConns()) write(c, f);
  }
  // §6: the first change opens a 250 ms window; one people at its end carries all of them.
  const peopleChanged = () => { if (!peopleCancel) peopleCancel = clk.after(LIMITS.peopleMs, flushPeople); };
  function sendChanged() { const f = textFrame({ t: 'changed' }); for (const c of hereConns()) write(c, f); }
  function changedWindow() {
    chg.open = true;
    clk.after(LIMITS.changedMs, () => {
      if (chg.pending) { chg.pending = false; sendChanged(); changedWindow(); } else chg.open = false;
    });
  }

  function leave(c) {
    if (!conns.delete(c)) return;
    for (const cancel of Object.values(c.timers)) cancel();
    if (c.here) peopleChanged();
  }
  // Close a connection with `code` (a close frame, then the socket ended).
  function kill(c, code) {
    if (!c.open) return;
    try { c.socket.end(closeFrame(code)); } catch { /* gone */ }
    c.open = false;
    leave(c);
  }
  function safe(c, fn) {
    try { fn(); } catch { kill(c, 1011); }
  }
  // A repeating timer for `c`, through the clock.
  function every(c, name, ms, fn) {
    const arm = () => { c.timers[name] = clk.after(ms, () => { if (!c.open) return; safe(c, fn); if (c.open) arm(); }); };
    arm();
  }

  function accept(req, socket, head, who) {
    socket.setNoDelay(true);
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptOf(req.headers['sec-websocket-key'])}\r\n\r\n`);
    // §7: counted from the handshake; one over is accepted and closed at once, before welcome.
    const mine = [...conns].filter((c) => c.who.id === who.id).length;
    if (mine >= LIMITS.perPerson || conns.size >= LIMITS.perServer) { socket.end(closeFrame(1008)); return; }
    const c = {
      conn: `c${++connSeq}`, who, socket, buf: Buffer.alloc(0), msg: null, open: true, timers: {},
      here: false, seq: 0, at: null, visible: false, messages: 0, dropped: 0, unanswered: 0, sec: 0, over: 0,
    };
    conns.add(c);
    write(c, textFrame({ t: 'welcome', presence: 1, you: { id: who.id, conn: c.conn } }));
    every(c, 'second', 1000, () => roll(c));
    every(c, 'ping', LIMITS.pingMs, () => ping(c));
    const take = (d) => { if (!c.open) return; c.buf = c.buf.length ? Buffer.concat([c.buf, d]) : Buffer.from(d); parse(c); };
    socket.on('data', (d) => safe(c, () => take(d)));
    // The http server's sockets are half-open: a peer that ends without a close frame is gone too.
    socket.on('end', () => { c.open = false; leave(c); socket.end(); });
    socket.on('close', () => { c.open = false; leave(c); });
    if (head && head.length) safe(c, () => take(head));
  }

  // §7: the per-second count, per whole second from the connection's open.
  function roll(c) {
    c.over = c.sec > LIMITS.perSecond ? c.over + 1 : 0;
    c.sec = 0;
    if (c.over >= LIMITS.overSeconds) kill(c, 1008);
  }
  // Counts one message or control frame; true when it is over the 30 of this second.
  const count = (c) => { c.messages += 1; c.sec += 1; return c.sec > LIMITS.perSecond; };
  function ping(c) {
    if (c.unanswered >= 2) { kill(c, 1001); return; }
    write(c, textFrame({ t: 'ping' }));
    c.unanswered += 1;
  }

  // §2: a whole header first, checked for validity, then its length weighed, then the payload awaited.
  function parse(c) {
    while (c.open) {
      const b = c.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const rsv = b[0] & 0x70;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      const len7 = b[1] & 0x7f;
      const control = op >= 8;
      if (rsv || !OPCODES.includes(op) || !masked || (control && !fin)) return kill(c, 1002);
      if (op === 0 && !c.msg) return kill(c, 1002);
      if ((op === 1 || op === 2) && c.msg) return kill(c, 1002);
      const ext = len7 === 126 ? 2 : len7 === 127 ? 8 : 0;
      const start = 2 + ext + 4;
      if (b.length < start) return;
      let len = len7;
      if (ext === 2) len = b.readUInt16BE(2);
      else if (ext === 8) {
        const hi = b.readUInt32BE(2);
        if (hi >= 0x80000000) return kill(c, 1002);
        len = hi * 2 ** 32 + b.readUInt32BE(6);
      }
      if (control && len > 125) return kill(c, 1002);
      if (!control) {
        if (op === 2) return kill(c, 1008);
        const held = c.msg ? c.msg.size : 0;
        const frames = c.msg ? c.msg.parts.length : 0;
        if (held + len > LIMITS.pageMsg || frames + 1 > LIMITS.frames) return kill(c, 1008);
      }
      if (b.length < start + len) return;
      const key = b.subarray(start - 4, start);
      const payload = Buffer.alloc(len);
      for (let i = 0; i < len; i++) payload[i] = b[start + i] ^ key[i & 3];
      c.buf = b.subarray(start + len);
      if (control) controlFrame(c, op, payload);
      else {
        if (!c.msg) c.msg = { parts: [], size: 0 };
        c.msg.parts.push(payload);
        c.msg.size += len;
        if (fin) { const whole = Buffer.concat(c.msg.parts); c.msg = null; message(c, whole); }
      }
    }
  }

  function controlFrame(c, op, payload) {
    if (op === 8) { // a close: never counted, never dropped; answered with a close and the socket ended
      try { c.socket.end(closeFrame(payload.length >= 2 ? payload.readUInt16BE(0) : null)); } catch { /* gone */ }
      c.open = false;
      leave(c);
      return;
    }
    const over = count(c);
    if (op === 10) { c.unanswered = 0; return; } // a pong frame: never dropped
    if (over) { c.dropped += 1; return; } // a ping frame over the rate
    write(c, encodeFrame(payload, { opcode: 10 }));
  }

  function message(c, buf) {
    let m;
    try { m = JSON.parse(utf8(buf)); } catch { return kill(c, 1008); }
    if (!isObj(m)) return kill(c, 1008);
    const over = count(c);
    if (m.t === 'here') return here(c, m);
    if (m.t === 'pong') { c.unanswered = 0; return undefined; }
    if (over) { c.dropped += 1; return undefined; }
    if (m.t === 'move') return move(c, m);
    return undefined; // any other t is ignored
  }

  function here(c, m) {
    if (!isObj(m.at)) return; // a here whose at is not an object is ignored
    const at = checkAt(m.at);
    const visible = m.visible === true;
    if (c.here && sameAt(c.at, at) && c.visible === visible) return; // changes nothing: no people
    if (!c.here) { c.here = true; c.seq = ++hereSeq; }
    c.at = at;
    c.visible = visible;
    peopleChanged();
  }

  function move(c, m) {
    if (!c.here || !c.visible) return;
    const a = pointerOf(m.a);
    if (a === undefined) return;
    const f = textFrame({ t: 'move', id: c.who.id, conn: c.conn, a });
    for (const o of conns) {
      if (o !== c && o.here && o.visible && o.who.id !== c.who.id && sameSpot(o.at, c.at)) write(o, f);
    }
  }

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    async close() {
      clk.stop();
      for (const c of conns) { c.open = false; }
      conns.clear();
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(() => r()));
    },
    // The log growing: a changed at once, then at most one each 500 ms, never dropped. The hub sends none.
    changed() {
      if (hub) return;
      if (chg.open) { chg.pending = true; return; }
      sendChanged();
      changedWindow();
    },
    // §11, computed when read.
    present() {
      const ps = peopleList();
      return {
        present: ps.slice(0, LIMITS.present).map(({ id: pid, name: pname, level: plevel }) => ({ id: pid, name: pname, level: plevel })),
        present_more: Math.max(0, ps.length - LIMITS.present),
      };
    },
    stats() {
      return [...conns].map((c) => ({ conn: c.conn, id: c.who.id, here: c.here, messages: c.messages, dropped: c.dropped, unanswered: c.unanswered }));
    },
    tick(ms) {
      if (clock !== 'manual') throw new Error('tick(ms) is for the manual clock only');
      return clk.tick(ms);
    },
  };
}

// ---- the test client ----

// A WebSocket client over `net` for the fake (or a real relay): the handshake, then frames. It resolves
// on whichever comes first: a non-101 status, `welcome`, or the socket closing. `headers` adds or
// overrides request headers (null leaves one out, an array repeats it); `origin: null` sends none.
export function openPresence(url, { headers = {}, origin, host, keep = true } = {}) {
  const u = new URL(url);
  const port = Number(u.port);
  const hostH = host ?? `127.0.0.1:${port}`;
  const originH = origin === undefined ? `http://${hostH}` : origin;
  const where = `${u.pathname && u.pathname !== '/' ? u.pathname : '/presence'}${u.search}`;
  const key = crypto.randomBytes(16).toString('base64');
  const base = [['Host', hostH], ['Upgrade', 'websocket'], ['Connection', 'Upgrade'], ['Sec-WebSocket-Key', key], ['Sec-WebSocket-Version', '13']];
  if (originH !== null) base.push(['Origin', originH]);
  const given = new Set(Object.keys(headers).map((k) => k.toLowerCase()));
  const lines = base.filter(([k]) => !given.has(k.toLowerCase())).map(([k, v]) => `${k}: ${v}`);
  for (const [k, v] of Object.entries(headers)) if (v != null) for (const x of [].concat(v)) lines.push(`${k}: ${x}`);

  return new Promise((resolve) => {
    const sock = net.connect({ host: u.hostname, port });
    sock.setNoDelay(true);
    sock.on('error', () => {});
    let buf = Buffer.alloc(0);
    let shook = false;
    let settled = false;
    let code = null;
    let closedResolve;
    const returned = new Set();
    const waiters = [];
    const c = {
      status: undefined, headers: {}, key, you: undefined, messages: [], sizes: [], controls: [],
      closed: new Promise((r) => { closedResolve = r; }),
      build: (bytes, opts = {}) => encodeFrame(bytes, { mask: true, ...opts }),
      raw: (bytes) => { if (!sock.destroyed) sock.write(Buffer.from(bytes)); },
      frame: (bytes, opts = {}) => c.raw(c.build(bytes, opts)),
      send: (obj) => c.frame(Buffer.from(JSON.stringify(obj))),
      close(closeCode = 1000) { const b = Buffer.alloc(2); b.writeUInt16BE(closeCode); c.raw(c.build(b, { opcode: 8 })); sock.end(); },
      destroy: () => sock.destroy(),
      next(pred, ms = 2000) {
        const test = (m) => { try { return pred(m); } catch { return false; } };
        for (let i = 0; i < c.messages.length; i++) {
          if (!returned.has(i) && test(c.messages[i])) { returned.add(i); return Promise.resolve(c.messages[i]); }
        }
        return new Promise((res, rej) => {
          const w = { test, res, timer: null };
          w.timer = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); rej(new Error(`next: no matching message in ${ms} ms`)); }, ms);
          waiters.push(w);
        });
      },
    };
    const done = () => { if (!settled) { settled = true; resolve(c); } };
    function got(m) {
      const i = c.messages.push(m) - 1;
      for (const w of [...waiters]) {
        if (!returned.has(i) && w.test(m)) { returned.add(i); clearTimeout(w.timer); waiters.splice(waiters.indexOf(w), 1); w.res(m); }
      }
    }
    function frames() {
      while (buf.length >= 2) {
        const op = buf[0] & 0x0f;
        const l7 = buf[1] & 0x7f;
        const masked = (buf[1] & 0x80) !== 0;
        let off = 2;
        let len = l7;
        if (l7 === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        if (l7 === 127) { if (buf.length < 10) return; len = buf.readUInt32BE(2) * 2 ** 32 + buf.readUInt32BE(6); off = 10; }
        const mk = masked ? buf.subarray(off, off + 4) : null;
        if (masked) off += 4;
        if (buf.length < off + len) return;
        const p = Buffer.from(buf.subarray(off, off + len));
        if (mk) for (let i = 0; i < p.length; i++) p[i] ^= mk[i & 3];
        buf = buf.subarray(off + len);
        c.sizes.push(len);
        if (op === 1) {
          if (keep || c.you === undefined) {
            const m = JSON.parse(p.toString('utf8'));
            got(m);
            if (c.you === undefined && m.t === 'welcome') { c.you = m.you; done(); }
          }
        } else if (op === 8) {
          code = p.length >= 2 ? p.readUInt16BE(0) : 1005;
          sock.end();
        } else c.controls.push({ opcode: op, payload: p });
      }
    }
    sock.on('connect', () => sock.write(`GET ${where} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`));
    sock.on('data', (d) => {
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      if (!shook) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        const [first, ...rest] = buf.subarray(0, i).toString('latin1').split('\r\n');
        c.status = Number(first.split(' ')[1]);
        for (const line of rest) { const j = line.indexOf(':'); if (j > 0) c.headers[line.slice(0, j).trim().toLowerCase()] = line.slice(j + 1).trim(); }
        buf = buf.subarray(i + 4);
        shook = true;
        if (c.status !== 101) { done(); return; }
      }
      frames();
    });
    sock.on('close', () => { closedResolve(code ?? 1006); done(); });
  });
}
