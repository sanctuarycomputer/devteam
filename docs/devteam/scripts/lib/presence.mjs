/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { HUB_ACTIONS } from './orient.mjs';
import { HUB_BODY_MAX } from './orient.mjs';
import { HUB_PORT } from './orient.mjs';
import { OPERATOR_PROOF_MS } from './hub/operator.mjs';
import { PERSON_MALFORMED } from './orient.mjs';
import { PORT_RANGE } from './orient.mjs';
import { UPLOAD_REQUEST_MS } from './hub/operator.mjs';
import { boxHealth } from './hub/health.mjs';
import { draining } from './fleet.mjs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gatewayProofProblem } from './hub/operator.mjs';
import { here } from './state.mjs';
import { isObj } from './artifact-notes.mjs';
import { keepAlive } from './orient.mjs';
import { kitDir } from './state.mjs';
import { laptopUploadsDir } from './hub/operator.mjs';
import { mainRoot } from './state.mjs';
import { memoryRecorder } from './hub/memory.mjs';
import { onBox } from './hub/operator.mjs';
import { operatorThreads } from './hub/operator.mjs';
import { operatorThreadsFile } from './hub/operator.mjs';
import { out } from './base.mjs';
import { ownerActionEnv } from './orient.mjs';
import { personEnv } from './orient.mjs';
import { probeHello } from './orient.mjs';
import { receiveLaptopUpload } from './hub/operator.mjs';
import { requestPerson } from './orient.mjs';
import { runOwnerAction } from './orient.mjs';
import { safe } from './box-pins.mjs';
import { serveLaptopUpload } from './hub/operator.mjs';
import { serveMemory } from './hub/memory.mjs';
import { sha256 } from './lens.mjs';
import { spawnSync } from 'node:child_process';
import { threadsNeedGateway } from './hub/operator.mjs';
import { trackRequests } from './orient.mjs';
import { uploadLimits } from './hub/operator.mjs';
/* imports end */
// ===== live presence: the relay (presence@1, test/contracts/presence.md) =====
// A /presence WebSocket on a dashboard's server and on the hub's: RFC 6455's server side by hand (Node
// built-ins only). Each page says where it is (here) and where its pointer is (move); the relay tells
// everyone on this server who is here (people, coalesced to one each 250 ms) and passes each move only
// to the others on the sender's spot. Who a connection is comes only from the upgrade's headers
// (x-devteam-person, x-devteam-level, which the box's gateway sets); with neither it is the owner.
// Everything is in this process's memory: nothing is logged, written or kept. A connection that
// breaks a rule is closed with the contract's code; a throw closes only its own connection (1011).
// `okHost(host)` is the server's own Host check; `ownerCwd` where `git config user.name` names the
// owner; `draining()` true while the dashboard hands over to a new kit (an upgrade then gets 503).
export function presenceRelay({ hub = false, okHost, ownerCwd, draining = () => false } = {}) {
  const AT_KEYS = ['page', 'tab', 'peek', 'art', 'thread'];
  const AT_PART = /^[A-Za-z0-9._:@/-]{1,120}$/;
  const ID_RE = /^[A-Za-z0-9._:@/-]{1,64}$/;
  const NAME_RE = /^(?:[A-Za-z0-9\-_.!~*'()]|%[0-9A-Fa-f]{2})+$/;
  const L = { pageMsg: 2048, frames: 16, anchorBytes: 200, nameBytes: 80, peopleMs: 250, changedMs: 500, unsent: 1024 * 1024, closeWaitMs: 5000, perSecond: 30, overSeconds: 10, perPerson: 8, perServer: 200, present: 50 };
  // every 20 s; DEVTEAM_PRESENCE_PING_MS (tests) when it is a whole number of at least 100
  const pingMs = ((v) => (/^\d+$/.test(v ?? '') && Number(v) >= 100 ? Number(v) : 20000))(process.env.DEVTEAM_PRESENCE_PING_MS);
  const STATUS = { 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 503: 'Service Unavailable' };
  const OPCODES = [0, 1, 2, 8, 9, 10];
  const jsonBytes = (s) => Buffer.byteLength(JSON.stringify(s)) - 2;
  // §4: the longest start, by whole characters, whose JSON encoding (without quotes) is at most 80 bytes
  const cutName = (name) => { let out = ''; let n = 0; for (const ch of String(name)) { const b = jsonBytes(ch); if (n + b > L.nameBytes) break; out += ch; n += b; } return out; };
  const ownerName = (() => {
    try {
      const r = spawnSync('git', ['config', 'user.name'], { cwd: ownerCwd ?? process.cwd(), encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
      return cutName((r.status === 0 && r.stdout.trim()) || 'Owner') || 'Owner';
    } catch { return 'Owner'; }
  })();
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  // §5: only the five keys, each a string in the set or null, built afresh
  const checkAt = (at) => Object.fromEntries(AT_KEYS.map((k) => { const v = own(at, k) ? at[k] : null; return [k, typeof v === 'string' && AT_PART.test(v) ? v : null]; }));
  const sameSpot = (a, b) => a.page === b.page && a.tab === b.tab && a.peek === b.peek && a.art === b.art;
  const sameAt = (a, b) => AT_KEYS.every((k) => a[k] === b[k]);
  const frac01 = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  // §6: a move's `a` from checked fields; undefined when it is neither null nor a pointer
  const pointerOf = (a) => {
    if (a === null) return null;
    if (!isObj(a) || typeof a.k !== 'string' || a.k.length === 0 || Buffer.byteLength(a.k) > L.anchorBytes || !frac01(a.x) || !frac01(a.y)) return undefined;
    return { k: a.k, x: a.x, y: a.y };
  };
  // ---- frames (server frames are unmasked and whole) ----
  const frame = (payload, opcode) => {
    const n = payload.length;
    const head = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
    if (n >= 126 && n < 65536) { head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(n, 2); }
    if (n >= 65536) { head[0] = 0x80 | opcode; head[1] = 127; head.writeUInt32BE(Math.floor(n / 2 ** 32), 2); head.writeUInt32BE(n >>> 0, 6); }
    return Buffer.concat([head, payload]);
  };
  const textFrame = (m) => frame(Buffer.from(JSON.stringify(m)), 1);
  const closeFrame = (code) => { const b = Buffer.alloc(code == null ? 0 : 2); if (code != null) b.writeUInt16BE(code); return frame(b, 8); };
  const utf8 = (buf) => new TextDecoder('utf-8', { fatal: true }).decode(buf);
  // ---- the upgrade's headers (§2, §4) ----
  const rawValues = (req, name) => { const out = []; for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === name) out.push(req.rawHeaders[i + 1]); return out; };
  const decodeName = (s) => {
    const bytes = [];
    for (let i = 0; i < s.length;) { if (s[i] === '%') { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 3; } else { bytes.push(s.charCodeAt(i)); i += 1; } }
    try { return utf8(Uint8Array.from(bytes)); } catch { return null; }
  };
  const personOf = (req) => {
    const ps = rawValues(req, 'x-devteam-person');
    const ls = rawValues(req, 'x-devteam-level');
    if (ps.length > 1 || ls.length > 1) return null;
    if (ls.length && ls[0] !== 'full' && ls[0] !== 'view') return null;
    if (!ps.length) return ls.length ? null : { id: 'owner', name: ownerName, level: 'full' };
    const m = /^([^;]*);name=(.*)$/.exec(ps[0]);
    if (!m || !ID_RE.test(m[1]) || !NAME_RE.test(m[2])) return null;
    const name = decodeName(m[2]);
    if (!name) return null;
    const cut = cutName(name);
    return cut ? { id: m[1], name: cut, level: ls.length ? ls[0] : 'full' } : null;
  };
  const validKey = (k) => typeof k === 'string' && /^[A-Za-z0-9+/]{22}==$/.test(k) && Buffer.from(k, 'base64').length === 16;
  // the path exactly as sent, less a query: never normalised, so only /presence is /presence (§2)
  const pathOf = (url) => String(url ?? '').split('?')[0];
  // §2's guards in order: the person, or the status refusing it
  const guard = (req, upgrade) => {
    const host = req.headers.host;
    if (!okHost(host)) return 403;
    if (rawValues(req, 'x-devteam-relay').length) return 403;
    if (pathOf(req.url) !== '/presence') return 404;
    if (!upgrade || String(req.headers.upgrade || '').toLowerCase() !== 'websocket' || req.headers['sec-websocket-version'] !== '13' || !validKey(req.headers['sec-websocket-key'])) return 400;
    const origin = req.headers.origin;
    if (origin === undefined || origin === 'null' || origin !== `http://${host}`) return 403;
    return personOf(req) || 403;
  };

  const conns = new Set(); // open connections past welcome, in open order
  let connSeq = 0;
  let hereSeq = 0;
  let peopleTimer = null;
  const chg = { open: false, pending: false };
  const hereConns = () => [...conns].filter((c) => c.here).sort((a, b) => a.seq - b.seq);
  const peopleList = () => {
    const by = new Map();
    for (const c of hereConns()) {
      let p = by.get(c.who.id);
      if (!p) { p = { id: c.who.id, name: c.who.name, level: c.who.level, conns: [] }; by.set(c.who.id, p); }
      p.conns.push({ conn: c.conn, at: { ...c.at }, visible: c.visible });
    }
    return [...by.values()];
  };
  // a socket that would hold over 1 MB unsent isn't reading: dropped without a close frame
  const write = (c, buf) => {
    if (!c.open || c.socket.destroyed) return;
    if (c.socket.writableLength + buf.length > L.unsent) { c.open = false; c.socket.destroy(); leave(c); return; }
    c.socket.write(buf);
  };
  function leave(c) {
    if (!conns.delete(c)) return;
    for (const cancel of Object.values(c.timers)) cancel();
    if (c.here) peopleChanged();
  }
  // the socket ended with `last`, and destroyed if the peer hasn't hung up within 5 s (its side is half-open)
  const endSocket = (socket, last) => {
    try { socket.end(last); } catch {}
    const t = setTimeout(() => socket.destroy(), L.closeWaitMs);
    t.unref();
    socket.once('close', () => clearTimeout(t));
  };
  // a close frame, the socket ended
  function kill(c, code) {
    if (!c.open) return;
    c.open = false;
    endSocket(c.socket, closeFrame(code));
    leave(c);
  }
  const safe = (c, fn) => { try { fn(); } catch { kill(c, 1011); } };
  // a repeating timer of `c`'s, cleared when it leaves
  const every = (c, name, ms, fn) => { const t = setInterval(() => { if (c.open) safe(c, fn); }, ms); t.unref(); c.timers[name] = () => clearInterval(t); };
  // §7: the count, per whole second from the connection's open; closed after 10 seconds in a row over 30
  const roll = (c) => { c.over = c.sec > L.perSecond ? c.over + 1 : 0; c.sec = 0; if (c.over >= L.overSeconds) kill(c, 1008); };
  // counts one message or control frame; true when it is over the 30 of this second
  const count = (c) => { c.sec += 1; return c.sec > L.perSecond; };
  // §6: a ping each interval; two in a row unanswered by the next close it (1001)
  const ping = (c) => { if (c.unanswered >= 2) return kill(c, 1001); write(c, textFrame({ t: 'ping' })); c.unanswered += 1; return undefined; };
  // one message to every connection that has said here; each write wrapped on its own
  const broadcast = (build) => {
    const to = hereConns();
    let f;
    try { f = build(); } catch { for (const c of to) kill(c, 1011); return; }
    for (const c of to) safe(c, () => write(c, f));
  };
  const flushPeople = () => { peopleTimer = null; broadcast(() => textFrame({ t: 'people', people: peopleList() })); };
  // §6: the first change opens a 250 ms window; one people at its end carries all of them
  function peopleChanged() { if (!peopleTimer) { peopleTimer = setTimeout(flushPeople, L.peopleMs); peopleTimer.unref(); } }
  const sendChanged = () => broadcast(() => textFrame({ t: 'changed' }));
  const changedWindow = () => {
    chg.open = true;
    setTimeout(() => { if (chg.pending) { chg.pending = false; sendChanged(); changedWindow(); } else chg.open = false; }, L.changedMs).unref();
  };

  function accept(req, socket, head, who) {
    socket.setNoDelay(true);
    socket.setTimeout(0);
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${crypto.createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')}\r\n\r\n`);
    // §7: counted from the handshake; one over is accepted and closed at once, before welcome
    const mine = [...conns].filter((o) => o.who.id === who.id).length;
    if (mine >= L.perPerson || conns.size >= L.perServer) return endSocket(socket, closeFrame(1008));
    const c = { conn: `c${++connSeq}`, who, socket, buf: Buffer.alloc(0), msg: null, open: true, timers: {}, here: false, seq: 0, at: null, visible: false, sec: 0, over: 0, unanswered: 0 };
    conns.add(c);
    write(c, textFrame({ t: 'welcome', presence: 1, you: { id: who.id, conn: c.conn } }));
    every(c, 'second', 1000, () => roll(c));
    every(c, 'ping', pingMs, () => ping(c));
    const take = (d) => { if (!c.open) return; c.buf = c.buf.length ? Buffer.concat([c.buf, d]) : Buffer.from(d); parse(c); };
    socket.on('data', (d) => safe(c, () => take(d)));
    // the http server's sockets are half-open: a peer that ends without a close frame is gone too
    socket.on('end', () => { c.open = false; leave(c); try { socket.end(); } catch {} });
    socket.on('close', () => { c.open = false; leave(c); });
    if (head && head.length) safe(c, () => take(head));
  }

  // §2: a whole header first, checked for validity, then its length weighed, then the payload awaited
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
        if ((c.msg ? c.msg.size : 0) + len > L.pageMsg || (c.msg ? c.msg.parts.length : 0) + 1 > L.frames) return kill(c, 1008);
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
    if (op === 8) { // a close: answered with a close of its code and the socket ended
      if (!c.open) return;
      c.open = false;
      endSocket(c.socket, closeFrame(payload.length >= 2 ? payload.readUInt16BE(0) : null));
      leave(c);
      return;
    }
    const over = count(c);
    if (op === 10) { c.unanswered = 0; return; } // a pong frame: never dropped
    if (over) return; // a ping frame over the rate
    write(c, frame(payload, 10));
  }

  function message(c, buf) {
    let m;
    try { m = JSON.parse(utf8(buf)); } catch { return kill(c, 1008); }
    if (!isObj(m)) return kill(c, 1008);
    const over = count(c);
    if (m.t === 'here') return here(c, m); // never dropped, whatever the rate
    if (m.t === 'pong') { c.unanswered = 0; return undefined; }
    if (over) return undefined; // a move or an unknown t over the rate
    if (m.t === 'move') return move(c, m);
    return undefined; // any other t is ignored (additive)
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
    for (const o of conns) if (o !== c && o.here && o.visible && o.who.id !== c.who.id && sameSpot(o.at, c.at)) safe(o, () => write(o, f));
  }

  return {
    // an upgrade on this server: refused with the first guard's status, or accepted
    upgrade(req, socket, head) {
      socket.on('error', () => {});
      try {
        const who = draining() ? 503 : guard(req, true);
        if (typeof who === 'number') { endSocket(socket, `HTTP/1.1 ${who} ${STATUS[who]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); return; }
        accept(req, socket, head, who);
      } catch { socket.destroy(); }
    },
    // a plain request for /presence: the guard's status, an empty body
    refuse(req, res) {
      let code = 400;
      try { const r = guard(req, false); code = typeof r === 'number' ? r : 400; } catch {}
      res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', connection: 'close' });
      res.end();
      req.resume();
    },
    // §11: the people with a connection whose last here said visible, in people's order; 50 and the rest counted
    present() {
      const ps = peopleList().filter((p) => p.conns.some((x) => x.visible));
      return { present: ps.slice(0, L.present).map(({ id, name, level }) => ({ id, name, level })), present_more: Math.max(0, ps.length - L.present) };
    },
    // the log grew: a changed at once, then at most one each 500 ms, never dropped; the hub sends none
    changed() {
      if (hub) return;
      if (chg.open) { chg.pending = true; return; }
      sendChanged();
      changedWindow();
    },
    // every connection closed with `code` (a hand-over to a new kit, the hub closing)
    closeAll(code = 1001) { for (const c of [...conns]) kill(c, code); },
  };
}

// ===== live presence: the log's changes (presence@1 changed, kit-633) =====
// What a dashboard calls `onChange` for: its instance's live log folder (run/log/, append-only files),
// as the names and sizes of its *.jsonl files, differing from the last look. fs.watch only prompts a
// look, and tick() looks too (the dashboard runs it each second): where watching isn't reliable (a
// network disk, a watch that died or never started because the folder didn't exist yet) a change is
// still seen within a second. A difference is all that counts, so a lock file, or an event with
// nothing new, is nothing. look() is also run by each /api/data read, so a change the watch hasn't
// delivered yet still counts. Returns { look, tick, close }.
export function presenceChanged(dir, onChange) {
  let seen = null;
  let watcher = null;
  const sig = () => {
    let names;
    try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort(); } catch { return ''; }
    return names.map((f) => { try { return `${f}:${fs.statSync(path.join(dir, f)).size}`; } catch { return `${f}:-`; } }).join('|');
  };
  const look = () => {
    const s = sig();
    if (seen === null || s === seen) { seen = s; return; }
    seen = s;
    try { onChange(); } catch {}
  };
  const close = () => { try { watcher?.close(); } catch {} watcher = null; };
  const watch = () => {
    if (watcher) return;
    try {
      watcher = fs.watch(dir, { persistent: false }, () => look());
      watcher.on('error', close);
    } catch { watcher = null; }
  };
  look();
  watch();
  return { look, tick: () => { watch(); look(); }, close };
}

export function startHub(log, { kit = null, image = false, standalone = false } = {}) {
  const page = path.join(kitDir, 'dashboard', 'hub.html');
  // the hub alone runs its owner actions where it was started, as box-thread's run: on a box that is
  // where the image's kit is no checkout; a dashboard's run in its project
  const actionCwd = standalone ? process.cwd() : mainRoot;
  const listHead = { hub: 1, kit, ...(image ? { image: true } : {}) };
  const retry = Number(process.env.DEVTEAM_HUB_RETRY_MS ?? 30000);
  const ownHost = (h) => [`127.0.0.1:${HUB_PORT}`, `localhost:${HUB_PORT}`].includes(h ?? '');
  // One scan at a time, its answer kept for 2 s: however often pages ask, the block is probed at
  // most every 2 s. An instance speaking a newer hello than this hub knows lists only root and port.
  let scanning = null;
  let scanned = { at: 0, list: [] };
  const probeAll = async () => (await Promise.all(PORT_RANGE.map(async (p) => {
    const h = await probeHello(p);
    if (!h) return null;
    return Number(h.devteam) === 1 ? { ...h, port: p } : { devteam: h.devteam, root: h.root, port: p };
  }))).filter(Boolean).sort((a, b) => String(a.root).localeCompare(String(b.root)));
  const scan = () => {
    if (Date.now() - scanned.at < 2000) return Promise.resolve(scanned.list);
    scanning ??= probeAll().then((list) => { scanned = { at: Date.now(), list }; return list; }).finally(() => { scanning = null; });
    return scanning;
  };
  // the machine's memory, a reading a minute (kit-591): started when a listen succeeds, stopped only
  // when the hub is closed for good
  const recorder = memoryRecorder(log, scan);
  // its live health, a sample every 5 s in this process's memory (kit-836), started and stopped with it
  const health = boxHealth(log, scan, { kit });
  // What holds the hub port: 'hub', 'other' (a clean answer that isn't a hub), or 'unsure' (slow,
  // or gone between the bind and the ask), which is no reason to stop trying.
  const holder = () => new Promise((resolve) => {
    const r = http.get({ host: '127.0.0.1', port: HUB_PORT, path: '/instances.json', timeout: 2000, headers: { host: `127.0.0.1:${HUB_PORT}`, 'sec-fetch-site': 'same-origin' } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { try { resolve(JSON.parse(b)?.hub === 1 ? 'hub' : 'other'); } catch { resolve('other'); } }); });
    r.on('timeout', () => { r.destroy(); resolve('unsure'); });
    r.on('error', () => resolve('unsure'));
  });
  // The threads as the dock reads them, folded again only when the store's file changed.
  let threadsMemo = { key: null, body: '[]' };
  const threadsRead = () => {
    const st = fs.statSync(operatorThreadsFile(), { throwIfNoEntry: false });
    const key = st ? `${st.size}:${st.mtimeMs}` : '';
    if (key !== threadsMemo.key) threadsMemo = { key, body: JSON.stringify(st ? operatorThreads() : []) };
    return threadsMemo.body;
  };
  // What the operator is at, as the owner's own command reads it from tmux (operator-thread status):
  // in a child, one at a time, its answer kept 5 s, so a read of the threads never waits on tmux
  // beyond the first. A press asks again at once.
  const ownerEnv = ownerActionEnv('hub');
  let op = { at: 0, state: { state: 'unknown', can_start: false, box: onBox() } };
  let asking = null;
  const askOperator = () => (asking ??= new Promise((resolve) => {
    execFile(process.execPath, [fileURLToPath(import.meta.url), 'operator-thread', 'status', '--json'], { cwd: actionCwd, env: ownerEnv, timeout: 20000, maxBuffer: 65536 }, (err, stdout) => {
      try { const j = JSON.parse(stdout); if (!err && isObj(j) && typeof j.state === 'string') op = { at: Date.now(), state: { state: j.state, can_start: j.can_start === true, box: j.box === true, session: String(j.session ?? '') } }; } catch {}
      resolve();
    });
  }).finally(() => { asking = null; }));
  const operatorNow = async () => {
    if (!op.at) await askOperator();
    else if (Date.now() - op.at > 5000) askOperator();
    return op.state;
  };
  // An owner action: from the hub's own page and nowhere else. A browser sends Origin and
  // Sec-Fetch-Site on every fetch POST, and both must say this page (a dashboard takes a secret on
  // the same terms); on a box the gateway, behind its passkey, asks for the owner's page and says so.
  // On a laptop that is all it can tell: anything on this machine can send those headers, a session
  // of the owner's own fleets included, as it can to any dashboard here (and type into tmux). On a
  // box the owner is never local, so a press must also carry the gateway's signature (threadsNeedGateway),
  // each nonce taken once; the owner's command is handed it and checks it again.
  const seenNonces = new Map();
  const ownerPost = (req, send, act) => {
    const refuse = (error) => send(403, 'application/json', JSON.stringify({ error }));
    if (req.headers['sec-fetch-site'] !== 'same-origin' || req.headers.origin !== `http://127.0.0.1:${HUB_PORT}` || !(req.headers['content-type'] ?? '').startsWith('application/json')) return refuse('owner actions only from the hub\'s own page');
    const boxed = threadsNeedGateway();
    const header = (k) => { const v = req.headers[`x-devteam-gateway-${k}`]; return typeof v === 'string' ? v : null; };
    const boxOnly = 'on a box the owner\'s threads come only through the box\'s gateway';
    if (boxed && !(header('ts') && header('nonce') && header('sig'))) return refuse(boxOnly);
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size <= HUB_BODY_MAX) chunks.push(c); else { chunks.length = 0; req.destroy(); } });
    req.on('end', async () => {
      const raw = Buffer.concat(chunks);
      let proof = null;
      if (boxed) {
        proof = { path: req.url, ts: header('ts'), nonce: header('nonce'), sig: header('sig'), body: raw.toString('base64') };
        const why = gatewayProofProblem(proof) ?? (seenNonces.has(proof.nonce) ? 'its signature was used already' : null);
        if (why) { log(`hub: refused ${req.url}: ${why}`); return refuse(`${boxOnly} (${why})`); }
        const now = Date.now();
        for (const [n, at] of seenNonces) if (now - at > 2 * OPERATOR_PROOF_MS) seenNonces.delete(n);
        seenNonces.set(proof.nonce, now);
      }
      // who pressed it (kit-252), only now that every check above has passed
      const person = requestPerson(req);
      if (person?.bad) return send(400, 'application/json', JSON.stringify({ error: PERSON_MALFORMED }));
      let args = null;
      // a body no check foresaw is a bad request, never a crash: a throw here would end the dashboard
      try { const parsed = JSON.parse(raw.toString('utf8') || '{}'); args = isObj(parsed) ? act(parsed) : null; } catch { args = null; }
      if (args && args.some((a) => typeof a !== 'string' || a.includes('\0'))) args = null;
      if (!args) return send(400, 'application/json', JSON.stringify({ error: 'missing or invalid fields' }));
      // Start writes no line, and the operator's tmux session it opens must carry no person
      const env = personEnv(ownerEnv, args[1] === 'start' ? null : person);
      const r = await runOwnerAction(args, { env: proof ? { ...env, DEVTEAM_THREAD_PROOF: 'stdin' } : env, timeout: 120000, log, input: proof ? JSON.stringify(proof) : null, cwd: actionCwd });
      // what the operator is at is asked afresh before the next read answers: a press may have
      // started it, and a read served from before the press would offer Start again
      op.at = 0;
      send(r.ok ? 200 : 400, 'application/json', JSON.stringify(r.ok ? { ok: true, out: r.stdout.trim() } : { error: r.stderr.split('\n').filter((l) => l && !l.startsWith('devteam: warning:')).join(' ').replace(/^devteam: /, '') || r.stdout.trim() || 'failed' }));
    });
  };
  let held = null;
  // what a dashboard handing over to a new kit closes (kit-288): the hub it serves, or its next try
  let current = null;
  let again = null;
  let stopped = false;
  const hubDir = () => laptopUploadsDir({ hub: true });
  const bodyMs = uploadLimits().bodyMs;
  // live presence on the hub's own pages (presence@1): its people, never a changed
  const presence = presenceRelay({ hub: true, okHost: ownHost, ownerCwd: actionCwd });
  const handle = { close() { stopped = true; clearTimeout(again); recorder.stop(); health.stop(); presence.closeAll(1001); current?.close(); current?.closeIdleConnections?.(); current = null; } };
  const tryListen = () => {
    if (stopped) return;
    const hub = trackRequests(http.createServer(async (req, res) => {
      // as a dashboard's: five minutes for a body, for all but an upload (UPLOAD_REQUEST_MS, and its stall timer)
      const bodyTimer = setTimeout(() => { if (!req.complete) req.destroy(); }, bodyMs);
      bodyTimer.unref();
      req.once('close', () => clearTimeout(bodyTimer));
      const send = (code, type, body, extra = {}) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra }); res.end(body); };
      if (!ownHost(req.headers.host)) return send(403, 'text/plain; charset=utf-8', 'the hub answers only on its own address');
      // /presence is a socket: a plain request gets its guard's status (presence@1 §2), before the redirect
      if (req.url === '/presence' || req.url.startsWith('/presence?')) return presence.refuse(req, res);
      // One address: the hub listens on 127.0.0.1 only, and dashboards let only that origin frame
      // them, so localhost (which may mean ::1, held by something else) is sent there.
      if (req.headers.host !== `127.0.0.1:${HUB_PORT}`) { res.writeHead(302, { location: `http://127.0.0.1:${HUB_PORT}${req.url.startsWith('/') ? req.url : '/'}`, 'cache-control': 'no-store' }); return res.end(); }
      // a file for a thread with the operator (kit-724), stored and served beside no project: on a box the gateway's
      const sendRes = (_, ...a) => send(...a);
      if (req.method === 'POST' && (req.url === '/upload' || req.url.startsWith('/upload?'))) {
        clearTimeout(bodyTimer);
        try { return await receiveLaptopUpload(req, res, new URL(req.url, 'http://x').searchParams.get('name'), sendRes, { dir: hubDir, hub: true }); } catch (e) {
          log(`hub: a dropped file could not be stored: ${e.message}`);
          if (!res.headersSent && !res.destroyed) return send(500, 'application/json', JSON.stringify({ error: 'this machine could not store this file' }), { connection: 'close' });
          return void req.destroy();
        }
      }
      if (req.method === 'GET' && req.url.startsWith('/upload/')) return await serveLaptopUpload(req, res, req.url.split('?')[0], sendRes, { dir: hubDir, hub: true });
      const act = req.method === 'POST' && req.url.startsWith('/operator/') && Object.hasOwn(HUB_ACTIONS, req.url.slice(10)) ? HUB_ACTIONS[req.url.slice(10)] : null;
      if (act) return ownerPost(req, send, act);
      if (req.method !== 'GET') return send(405, 'text/plain; charset=utf-8', 'the hub only lists, and takes the owner\'s threads with the operator', { allow: 'GET' });
      if (req.url === '/') return send(200, 'text/html; charset=utf-8', fs.readFileSync(page), { 'content-security-policy': `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-src ${PORT_RANGE.map((p) => `http://127.0.0.1:${p}`).join(' ')}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` });
      // The list is for the hub's own page: another site's page doesn't get to make the hub probe
      // the block (a browser always says where a request came from). The page itself opens from
      // anywhere, a link in a README included.
      const site = req.headers['sec-fetch-site'];
      if (req.url === '/instances.json' && site && !['same-origin', 'none'].includes(site)) return send(403, 'text/plain; charset=utf-8', 'the list is for the hub\'s own page');
      if (req.url === '/instances.json') return send(200, 'application/json', JSON.stringify({ ...listHead, instances: await scan() }));
      // the machine's memory readings (machine-memory@1), refused to another site's page as the list is
      if (req.url === '/memory.json' || req.url.startsWith('/memory.json?')) {
        if (site && !['same-origin', 'none'].includes(site)) return send(403, 'text/plain; charset=utf-8', 'the readings are for the hub\'s own page');
        // the detail (it can name the hub's own file) goes to the hub's log, once, never to the page
        try { return await serveMemory(req, send); } catch (e) { recorder.say(`/memory.json: ${e?.message ?? String(e)}`); return send(500, 'application/json', JSON.stringify({ error: 'memory readings unavailable' })); }
      }
      // the machine's live health (box-health@1), refused as the readings are; off, no route
      if (health.on && (req.url === '/box-health.json' || req.url.startsWith('/box-health.json?'))) {
        if (site && !['same-origin', 'none'].includes(site)) return send(403, 'text/plain; charset=utf-8', 'the readings are for the hub\'s own page');
        try { return health.serve(req, send); } catch (e) { health.fail('sampler', '/box-health.json', e); return send(500, 'application/json', JSON.stringify({ error: 'box health unavailable' })); }
      }
      // The operator's threads, for the Overview's dock: a GET carries no Origin, so it is refused
      // when the browser says another site's page asks (as a dashboard's /api/threads is).
      if (req.url === '/operator/threads') {
        if (site !== undefined && site !== 'same-origin') return send(403, 'application/json', JSON.stringify({ error: "not for another site's page" }));
        let threads;
        try { threads = threadsRead(); } catch (e) { return send(500, 'application/json', JSON.stringify({ error: e.message })); }
        const body = `{"operator":${JSON.stringify(await operatorNow())},"threads":${threads}}`;
        // nothing changed since the page's last read: a 304, and the browser keeps its copy
        const tag = `"${sha256(body).slice(0, 20)}"`;
        if (req.headers['if-none-match'] === tag) { res.writeHead(304, { etag: tag, 'cache-control': 'private, no-cache' }); return res.end(); }
        return send(200, 'application/json', body, { etag: tag, 'cache-control': 'private, no-cache' });
      }
      return send(404, 'text/plain; charset=utf-8', 'not found');
    }));
    current = hub;
    hub.on('upgrade', (req, socket, head) => presence.upgrade(req, socket, head));
    hub.once('error', async (e) => {
      if (current === hub) current = null;
      if (stopped) return;
      if (standalone) {
        // said once for each state, never at each retry (a slow answer, unsure, changes nothing); the
        // timer keeps this process alive
        const now = e.code === 'EADDRINUSE' ? await holder() : `error ${e.message}`;
        if (now !== held && now === 'other') log(`hub: port ${HUB_PORT} is held by something that isn't a devteam hub; retrying every ${retry / 1000} s`);
        else if (now !== held && now.startsWith('error ')) log(`hub: ${e.message}; retrying every ${retry / 1000} s`);
        if (now !== 'unsure') held = now;
        return void (again = setTimeout(tryListen, retry));
      }
      if (e.code !== 'EADDRINUSE') return log(`hub: ${e.message}`);
      if ((await holder()) !== 'other') { if (!stopped) (again = setTimeout(tryListen, retry)).unref(); }
      else log(`hub: port ${HUB_PORT} is held by something that isn't a devteam hub; this dashboard won't serve the hub`);
    });
    hub.requestTimeout = UPLOAD_REQUEST_MS;
    keepAlive(hub).listen(HUB_PORT, '127.0.0.1', () => { log(`hub on http://127.0.0.1:${HUB_PORT}`); recorder.start(); health.start(); });
  };
  tryListen();
  return handle;
}

