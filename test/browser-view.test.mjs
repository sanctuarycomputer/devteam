// The browser's live view server (kit-66): the daemon's view port serves browser.html and its one
// socket, which carries Chrome's screencast out and the owner's input in; the view is a preview the
// owner opens through the box's gateway (behind the passkey) or a laptop dashboard's relay. Each check
// is the spec's (docs/devteam/project/tickets/kit-66-browser-view-server/spec.md, home), named by its
// id. The CLI runs async: the fixture site, the stand-in hub and the gateway live in this process.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { canDrive } from './lib/chrome.mjs';
import { monoFixture, dashboardOnFreePort, until, sessionOf, PORTS, kit } from './lib/kit.mjs';
import { startSites } from './lib/sites.mjs';
import { validate, message } from './fixtures/browser/check.mjs';

// CI's Node 22 and 24 jobs have Chrome: there the file must run, never skip.
const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;
const skip = canDrive ? false : 'needs Chrome and Node 22+';
const opts = { skip, timeout: 120000 };
if (mustRun && !canDrive) test('Chrome is needed on CI\'s Node 22+', () => assert.fail('Chrome is needed on CI\'s Node 22+: this file must run there, not skip'));

// The gateway reads its hub port and instance block once, at import: a stand-in hub and a block of
// this file's own (+60, +61..85 of lib/kit.mjs's block), apart from the hub (+0) the dashboard binds.
const GW_HUB = PORTS + 60, GW_BASE = PORTS + 61;
const kept = [process.env.DEVTEAM_HUB_PORT, process.env.DEVTEAM_PORT_BASE];
process.env.DEVTEAM_HUB_PORT = String(GW_HUB);
process.env.DEVTEAM_PORT_BASE = String(GW_BASE);
delete process.env.DEVTEAM_CLAIM_TOKEN;
const G = await import('../cloud/gateway.mjs');
[process.env.DEVTEAM_HUB_PORT, process.env.DEVTEAM_PORT_BASE] = kept;
// the laptop dashboard's relays: a range of this file's own (+86..95)
const RELAYS = `${PORTS + 86}-${PORTS + 95}`;

const PAGE = fs.readFileSync(path.join(kit, 'dashboard', 'browser.html'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-bview-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MARK = () => `mk${crypto.randomBytes(6).toString('hex').replace(/\d/g, (d) => 'qrstuvwxyz'[d])}`;

let site, a, dash;
const sockets = [];

// A project whose CLI runs as the supervisor with a throwaway HOME, renewing its record every second.
function project(name) {
  const F = monoFixture(name);
  const home = fs.mkdtempSync(path.join(tmp, 'home-'));
  const env = { ...F.env({ DEVTEAM_ROLE: 'supervisor' }), HOME: home, DEVTEAM_TEST: '1', DEVTEAM_TEST_BROWSER_ALLOW: `${site.port}`, DEVTEAM_TEST_BROWSER_RENEW_MS: '1000', DEVTEAM_TEST_BROWSER_CAST_MAX: '400', DEVTEAM_PREVIEW_TICK_MS: '200', DEVTEAM_RELAY_PORTS: RELAYS };
  const key = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${crypto.createHash('sha1').update(fs.realpathSync(F.old)).digest('hex').slice(0, 12)}`;
  return { ...F, name, home, env, key, profile: path.join(home, '.devteam', 'browser', key), run: path.join(F.old, 'docs', 'devteam', 'run'), state: path.join(F.old, 'docs', 'devteam', 'run', 'browser', 'state.json') };
}
// devteam.mjs <args> on project P, async: { status, out, err }.
function kitCli(P, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...P.env, ...extraEnv };
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
    const child = spawn(process.execPath, [path.join(P.old, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: P.old, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 90000);
    child.on('error', reject);
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, out: out.trim(), err: err.trim() }); });
  });
}
const browser = (P, args, env) => kitCli(P, ['browser', ...args], env);
async function ok(P, args) { const r = await browser(P, args); assert.equal(r.status, 0, `browser ${args.join(' ')}: ${r.err || r.out}`); return r.out; }

function alive(pid) {
  try { process.kill(pid, 0); } catch (err) { if (err.code !== 'EPERM') return false; }
  try { const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return st.slice(st.lastIndexOf(')') + 2)[0] !== 'Z'; } catch { return false; }
}
const ppid = (pid) => { try { const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]); } catch { return 0; } };
const tmuxOf = (P, args) => spawnSync('tmux', args, { encoding: 'utf8', env: { ...process.env, TMUX_TMPDIR: P.env.TMUX_TMPDIR } });
function devWindows(P) {
  const r = tmuxOf(P, ['list-panes', '-s', '-t', `=${sessionOf(P.old, P.name)}`, '-F', '#{window_name} #{pane_pid} #{window_id}']);
  if (r.status !== 0) return [];
  return r.stdout.split('\n').filter(Boolean).map((l) => { const [name, pid, id] = l.split(' '); return { name, pid: Number(pid), id }; }).filter((w) => w.name.startsWith('dev~'));
}
const readState = (P) => JSON.parse(fs.readFileSync(P.state, 'utf8'));
const recFile = (P, name) => path.join(P.run, 'previews', `${name}.json`);
const readRec = (P, name) => JSON.parse(fs.readFileSync(recFile(P, name), 'utf8'));
const statusJson = async (P) => JSON.parse(await ok(P, ['status', '--json']));

// An HTTP request to 127.0.0.1:port with the Host (and headers) given: { status, headers, body }.
function get(port, route, host, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: route, agent: false, headers: { host, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.setTimeout(15000, () => r.destroy(new Error(`no answer from ${host}${route} in 15 s`)));
    r.end();
  });
}

// --- a WebSocket client of the test's own: raw, so it sets Host and Origin as it likes -----------------
function frameOf(op, payload, { masked = true, fin = true, rsv = 0 } = {}) {
  const len = payload.length;
  let hdr;
  if (len < 126) hdr = Buffer.from([0, len]);
  else if (len < 65536) { hdr = Buffer.alloc(4); hdr[1] = 126; hdr.writeUInt16BE(len, 2); } else { hdr = Buffer.alloc(10); hdr[1] = 127; hdr.writeBigUInt64BE(BigInt(len), 2); }
  hdr[0] = (fin ? 0x80 : 0) | rsv | op;
  if (!masked) return Buffer.concat([hdr, payload]);
  hdr[1] |= 0x80;
  const m = crypto.randomBytes(4);
  return Buffer.concat([hdr, m, Buffer.from(payload).map((b, i) => b ^ m[i % 4])]);
}
// { status, head, msgs, bad, closed, pings, send(obj), raw(buf), wait(pred, ms, from), closedIn(ms), close() }.
// It answers each ping with a pong unless pong is false; a number answers that many pings, then none
// (lastPong: when it sent its last).
// Each message from the server is checked against browser@1 as it comes (bad holds what failed); a
// frame's data is kept only as its length and its first 64 characters, so a long test holds little.
function ws(port, { host = `127.0.0.1:${port}`, origin = `http://${host}`, route = '/socket', cookie, headers = {}, pong = true } = {}) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    const c = { status: 0, head: '', msgs: [], bad: [], closed: null, pings: 0, lastPong: 0, sock };
    let buf = Buffer.alloc(0), shaken = false, parts = [];
    const waiters = new Set();
    const poke = () => { for (const w of [...waiters]) w(); };
    sock.on('connect', () => sock.write(`GET ${route} HTTP/1.1\r\nhost: ${host}\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-version: 13\r\nsec-websocket-key: ${crypto.randomBytes(16).toString('base64')}\r\n${origin ? `origin: ${origin}\r\n` : ''}${cookie ? `cookie: ${cookie}\r\n` : ''}${Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n`));
    const parse = () => {
      for (;;) {
        if (buf.length < 2) return;
        let len = buf[1] & 127, at = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); at = 10; }
        if (buf.length < at + len) return;
        const op = buf[0] & 15, fin = !!(buf[0] & 0x80), body = buf.subarray(at, at + len);
        buf = buf.subarray(at + len);
        if (op === 8) { c.closed = body.length >= 2 ? body.readUInt16BE(0) : 1005; poke(); continue; }
        if (op === 9) { c.pings++; if (pong === true || (typeof pong === 'number' && c.pings <= pong)) { sock.write(frameOf(10, body)); c.lastPong = Date.now(); } continue; }
        if (op === 10) continue;
        parts.push(body);
        if (!fin) continue;
        const text = Buffer.concat(parts).toString('utf8');
        parts = [];
        let m;
        try { m = JSON.parse(text); } catch { c.bad.push(`not JSON: ${text.slice(0, 80)}`); continue; }
        const errs = message('from_server', m);
        if (errs.length) c.bad.push(errs.join('; '));
        if (m.t === 'frame') m.data = `${m.data.slice(0, 64)}…(${m.data.length})`;
        c.msgs.push(m);
        poke();
      }
    };
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!shaken) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        c.head = buf.subarray(0, i).toString('latin1');
        c.status = Number(/^HTTP\/1\.1 (\d+)/.exec(c.head)?.[1] ?? 0);
        buf = buf.subarray(i + 4);
        shaken = true;
        resolve(c);
        if (c.status !== 101) return;
      }
      parse();
    });
    sock.on('error', () => {});
    sock.on('close', () => { if (c.closed === null) c.closed = 1006; poke(); if (!shaken) resolve(c); });
    c.send = (o) => sock.write(frameOf(1, Buffer.from(JSON.stringify(o))));
    c.raw = (b) => sock.write(b);
    c.wait = (pred, ms = 2000, from = 0) => new Promise((ok2, fail) => {
      const look = () => { const m = c.msgs.slice(from).find(pred); if (m) { done(); ok2(m); } else if (c.closed !== null) { done(); fail(new Error(`the socket closed (${c.closed}) before the message came`)); } };
      const t = setTimeout(() => { done(); fail(new Error(`no such message within ${ms} ms (${c.msgs.length - from} came: ${JSON.stringify(c.msgs.slice(from).slice(-3)).slice(0, 300)})`)); }, ms);
      const done = () => { clearTimeout(t); waiters.delete(look); };
      waiters.add(look);
      look();
    });
    c.closedIn = (ms) => new Promise((r) => { const t0 = Date.now(); const tick = () => (c.closed !== null || Date.now() - t0 > ms ? r(c.closed) : setTimeout(tick, 25)); tick(); });
    c.close = () => sock.destroy();
    sockets.push(c);
  });
}
const isFrame = (m) => m.t === 'frame';

// --- a software authenticator (cbor and an ES256 key), copied from test/gateway.test.mjs, not shared ---
function cbor(v) {
  const head = (mt, n) => (n < 24 ? Buffer.from([(mt << 5) | n]) : n < 256 ? Buffer.from([(mt << 5) | 24, n]) : (() => { const b = Buffer.alloc(3); b[0] = (mt << 5) | 25; b.writeUInt16BE(n, 1); return b; })());
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error(`cbor: ${typeof v}`);
}
const sha = (b) => crypto.createHash('sha256').update(b).digest();
const b64u = (b) => Buffer.from(b).toString('base64url');
function authenticator() {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
  const id = crypto.randomBytes(16);
  return {
    create(o, origin) {
      const cd = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: o.challenge, origin }));
      const len = Buffer.alloc(2); len.writeUInt16BE(id.length);
      const ad = Buffer.concat([sha(o.rp.id), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, id, cbor(cose)]);
      return { rawId: b64u(id), clientDataJSON: b64u(cd), attestationObject: b64u(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]))) };
    },
  };
}
// The real gateway in process on http://box.localhost:<port>, claimed by the authenticator: its
// session cookie, and a JSON request on its own name.
async function claimedGateway() {
  const port = await new Promise((r) => { const v = net.createServer(); v.listen(0, '127.0.0.1', () => { const p = v.address().port; v.close(() => r(p)); }); });
  const publicUrl = `http://box.localhost:${port}`;
  const ttydPage = path.join(tmp, 'ttyd.html');
  fs.writeFileSync(ttydPage, 'ttyd');
  const uploadsDir = path.join(tmp, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o750 });
  const logs = [];
  const g = G.createGateway({ publicUrl, dir: fs.mkdtempSync(path.join(tmp, 'gw-')), ttydPort: 1, ttydPage, uploadsDir, log: (m) => logs.push(m) });
  await new Promise((r) => g.server.listen(port, '127.0.0.1', r));
  const close = () => new Promise((r) => { g.server.closeAllConnections?.(); g.server.close(r); });
  try {
  const token = /claim#([A-Za-z0-9_-]+)/.exec(logs.join('\n'))?.[1];
  assert.ok(token, 'the gateway printed a claim link');
  const post = (route, body) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: route, headers: { host: `box.localhost:${port}`, origin: publicUrl, 'content-type': 'application/json' } }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(b); } catch { return null; } })(), cookie: res.headers['set-cookie']?.find((x) => x.startsWith('devteam_session='))?.split(';')[0] }));
    });
    r.on('error', reject);
    r.end(JSON.stringify(body));
  });
  const o = await post('/auth/claim/options', { token });
  assert.equal(o.status, 200);
  const v = await post('/auth/claim/verify', { token, ...authenticator().create(o.json, publicUrl) });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.ok(v.cookie, 'a session cookie');
  return { g, port, cookie: v.cookie, close };
  } catch (e) { await close(); throw e; }
}

// The /record page's layout in headless Chrome: the button (200 x 80) under the h1. Its centre, in
// CSS pixels of the viewport, which the frames are in.
const BUTTON = { x: 108, y: 120 };

// fn's first truthy value within ms (polled every 25 ms), or a failure naming what and how long.
async function within(ms, fn, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return assert.fail(`${what}: not within ${ms} ms`);
    await sleep(25);
  }
}

let view = null; // { name, port }: a's view
let s1 = null; // the viewer's socket, while one is open
let standIn = null; // I3: a loopback server whose port isn't allowed, counting what reaches it
let setup = Promise.resolve();
before(() => {
  if (skip) return;
  setup = (async () => {
    site = await startSites();
    a = project('bview-a');
    standIn = { requests: 0 };
    standIn.server = http.createServer((q, s) => { standIn.requests++; s.end('stand-in'); });
    await new Promise((r) => standIn.server.listen(0, '127.0.0.1', r));
    standIn.port = standIn.server.address().port;
  })();
  return setup;
});
after(async () => {
  if (skip) return;
  await setup.catch(() => {});
  for (const c of sockets) c.close();
  await dash?.dash.stop();
  if (a) {
    await browser(a, ['stop']).catch(() => {});
    a.done();
  }
  await site?.close();
  if (standIn?.server) await new Promise((r) => { standIn.server.closeAllConnections?.(); standIn.server.close(r); });
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Each check sets up what it needs, so it runs, and is seen red, on its own: the browser running (and
// view naming it), a dashboard on a's fixture, a viewer's socket with a frame drawn.
const liveState = () => { try { const s = readState(a); return alive(s.daemon_pid) ? s : null; } catch { return null; } };
async function running(env) {
  let s = liveState();
  // a daemon still going after a stop (its record already gone) is waited out, then started again
  if (s && !fs.existsSync(recFile(a, s.preview))) { await until(() => !alive(s.daemon_pid), 'the stopping daemon gone'); s = null; }
  if (!s) {
    const r = await browser(a, ['start'], env);
    assert.equal(r.status, 0, `start: ${r.err || r.out}`);
    s = readState(a);
  }
  view = { name: s.preview, port: s.view_port };
  return s;
}
async function dashboard() {
  if (!dash) dash = await dashboardOnFreePort(a.old, a.env);
  return dash.port;
}
async function viewer() {
  await running();
  if (s1 && s1.status === 101 && s1.closed === null) return s1;
  s1 = await ws(view.port);
  assert.equal(s1.status, 101, s1.head.split('\r\n')[0]);
  await s1.wait(isFrame, 2000);
  return s1;
}
async function onRecord() {
  await running();
  await ok(a, ['open', `${site.origin}/record`]);
}

test('V1 the view is a preview labelled browser, in its own window, listed in hello', opts, async () => {
  const s = await running();
  const rec = readRec(a, view.name);
  assert.equal(rec.label, 'browser');
  assert.equal(rec.port, view.port);
  const w = devWindows(a).find((x) => x.name === `dev~${view.name}`);
  assert.ok(w, `a dev~${view.name} window: ${JSON.stringify(devWindows(a))}`);
  assert.equal(rec.run.window, w.id);
  let p = s.daemon_pid;
  for (let i = 0; i < 20 && p > 1 && p !== w.pid; i++) p = ppid(p);
  assert.equal(p, w.pid, 'the daemon descends from the pane');
  const port = await dashboard();
  await until(async () => (await (await fetch(`http://127.0.0.1:${port}/api/hello`)).json()).previews?.some((x) => x.name === view.name), 'hello to list the view');
});

test('V5 the view serves browser.html', opts, async () => {
  await running();
  for (const host of [`127.0.0.1:${view.port}`, `localhost:${view.port}`]) {
    const r = await get(view.port, '/', host);
    assert.equal(r.status, 200, `${host}: ${r.body.toString().slice(0, 200)}`);
    assert.ok(r.body.equals(PAGE), 'exactly browser.html');
    assert.match(r.headers['content-type'], /^text\/html/);
    assert.match(r.headers['content-security-policy'] ?? '', /frame-ancestors 'self'/);
    assert.equal(r.headers['cache-control'], 'no-store');
  }
  assert.equal((await get(view.port, '/', 'evil.example')).status, 403, 'another Host');
  assert.equal((await get(view.port, '/other', `127.0.0.1:${view.port}`)).status, 404);
});

test('V6 a socket on either loopback form gets held, url and frames of the page within 2 s', opts, async () => {
  await onRecord();
  s1?.close();
  await sleep(300);
  for (const host of [`localhost:${view.port}`, `127.0.0.1:${view.port}`]) {
    const t0 = Date.now();
    const c = await ws(view.port, { host });
    assert.equal(c.status, 101, `${host}: ${c.head.split('\r\n')[0]}`);
    await c.wait(isFrame, Math.max(1, 2000 - (Date.now() - t0)));
    assert.deepEqual(c.msgs.find((m) => m.t === 'held'), { t: 'held', qid: null });
    assert.equal(c.msgs.find((m) => m.t === 'url')?.url, `${site.origin}/record`);
    assert.deepEqual(c.bad, [], 'every message is browser@1');
    // in CSS pixels of the page, not the frame image's (400 px at most here): the page is wider
    const f = c.msgs.find(isFrame);
    assert.ok(f.w > 400 && f.w <= 8192 && f.h > 0, `frame size ${f.w}x${f.h} is the page's, not the image's`);
    c.close();
    await sleep(300);
  }
});

test('R2 a second viewer gets bye; the first keeps its frames', opts, async () => {
  const first = await viewer();
  const c2 = await ws(view.port);
  assert.equal(c2.status, 101, c2.head.split('\r\n')[0]);
  const bye = await c2.wait((m) => m.t === 'bye', 2000);
  assert.match(bye.why, /another window/);
  assert.ok((await c2.closedIn(3000)) !== null, 'the server closes it');
  assert.equal(c2.msgs.filter(isFrame).length, 0, 'no frame to the second');
  const n = first.msgs.length;
  await ok(a, ['open', `${site.origin}/`]);
  await first.wait(isFrame, 3000, n);
});

test('I1 a click reaches the page at the same point, within 2 s', opts, async () => {
  await onRecord();
  const c = await viewer();
  const before = site.events().length;
  c.send({ t: 'mouse', type: 'click', x: BUTTON.x, y: BUTTON.y, button: 'left', clicks: 1 });
  const e = await within(2000, () => site.events().slice(before).find((x) => x.kind === 'click'), 'the click');
  assert.ok(Math.abs(e.x - BUTTON.x) <= 2 && Math.abs(e.y - BUTTON.y) <= 2, JSON.stringify(e));
});

const typed = { key: MARK(), paste: MARK(), nav: MARK() };
Object.defineProperty(typed, 'sent', { value: { keys: false, nav: false } }); // not a marker: kept out of Object.entries
test('I2 keys, a paste and a 60 KB paste in two frames reach the page, within 2 s', opts, async () => {
  await onRecord();
  const c = await viewer();
  // focus the input: a click on the button, then Tab
  c.send({ t: 'mouse', type: 'click', x: BUTTON.x, y: BUTTON.y, button: 'left', clicks: 1 });
  await sleep(200);
  const before = site.events().length;
  c.send({ t: 'key', type: 'down', key: 'Tab', code: 'Tab' });
  c.send({ t: 'key', type: 'up', key: 'Tab', code: 'Tab' });
  for (const ch of typed.key) c.send({ t: 'key', type: 'press', key: ch, code: `Key${ch.toUpperCase()}`, text: ch });
  c.send({ t: 'paste', text: typed.paste });
  // 10 000 characters, each a \u escape: over 60 KB of JSON, sent as a text frame and a continuation
  const big = Buffer.from(`{"t":"paste","text":"${'\\u0062'.repeat(10000)}"}`);
  assert.ok(big.length > 60000);
  const cut = Math.floor(big.length / 2);
  c.raw(frameOf(1, big.subarray(0, cut), { fin: false }));
  c.raw(frameOf(0, big.subarray(cut)));
  const want = typed.key + typed.paste + 'b'.repeat(10000);
  await within(2000, () => site.events().slice(before).some((x) => x.kind === 'input' && x.value === want), 'the input to hold the keys and both pastes');
  assert.equal(c.closed, null, 'the socket stays open');
  typed.sent.keys = true;
});

test('I5 Back returns to the page before', opts, async () => {
  await onRecord();
  const c = await viewer();
  c.send({ t: 'nav', url: `${site.origin}/account?m=${typed.nav}` });
  await within(5000, async () => (await statusJson(a)).url === `${site.origin}/account?m=•••`, 'the nav');
  typed.sent.nav = true;
  c.send({ t: 'back' });
  await within(5000, async () => (await statusJson(a)).url === `${site.origin}/record`, 'back at /record');
});

test('I3 a nav to the dashboard, or any loopback port, shows the guard\'s refusal', opts, async () => {
  const port = await dashboard();
  const c = await viewer();
  const seen0 = standIn.requests;
  for (const p of [port, standIn.port]) {
    c.send({ t: 'nav', url: `http://127.0.0.1:${p}/` });
    const snap = await within(5000, async () => { const r = await browser(a, ['snapshot']); return /This page is blocked/.test(r.out) && r.out.includes(`can't open 127.0.0.1:${p}`) ? r.out : null; }, `the refusal page for port ${p}`);
    assert.ok(snap);
    await ok(a, ['open', `${site.origin}/`]);
  }
  assert.equal(standIn.requests, seen0, 'nothing reached the stand-in');
});

test('I4 a nav to file: is refused', opts, async () => {
  await onRecord();
  const c = await viewer();
  c.send({ t: 'nav', url: 'file:///etc/passwd' });
  await sleep(2000);
  assert.equal((await statusJson(a)).url, `${site.origin}/record`);
  assert.doesNotMatch(await ok(a, ['snapshot']), /root:/);
});

test('R3 nothing the owner typed is in run/, project/, the dashboard\'s output or the window', opts, async () => {
  // the markers as I2 and I5 send them, when they haven't run: typed keys and a paste into the
  // record page's input, and a nav to a URL carrying the third in its query
  if (!typed.sent.keys || !typed.sent.nav) {
    await onRecord();
    const c = await viewer();
    if (!typed.sent.keys) {
      c.send({ t: 'mouse', type: 'click', x: BUTTON.x, y: BUTTON.y, button: 'left', clicks: 1 });
      await sleep(200);
      const before = site.events().length;
      c.send({ t: 'key', type: 'down', key: 'Tab', code: 'Tab' });
      c.send({ t: 'key', type: 'up', key: 'Tab', code: 'Tab' });
      for (const ch of typed.key) c.send({ t: 'key', type: 'press', key: ch, code: `Key${ch.toUpperCase()}`, text: ch });
      c.send({ t: 'paste', text: typed.paste });
      await within(5000, () => site.events().slice(before).some((x) => x.kind === 'input' && x.value === typed.key + typed.paste), 'the keys and the paste on the page');
      typed.sent.keys = true;
    }
    if (!typed.sent.nav) {
      c.send({ t: 'nav', url: `${site.origin}/account?m=${typed.nav}` });
      await within(5000, async () => (await statusJson(a)).url === `${site.origin}/account?m=•••`, 'the nav');
      typed.sent.nav = true;
    }
  }
  await running();
  const files = [];
  const walk = (d) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, n.name); if (n.isDirectory()) walk(f); else if (n.isFile()) files.push(f); } };
  walk(a.run);
  walk(path.join(a.old, 'docs', 'devteam', 'project'));
  const w = devWindows(a).find((x) => x.name === `dev~${view.name}`);
  const pane = tmuxOf(a, ['capture-pane', '-p', '-J', '-S', '-', '-t', w.id]).stdout;
  for (const [what, m] of Object.entries(typed)) {
    for (const f of files) assert.ok(!fs.readFileSync(f).includes(m), `the ${what} marker in ${path.relative(a.old, f)}`);
    assert.ok(!pane.includes(m), `the ${what} marker in the window`);
    assert.ok(!(dash?.dash.out() ?? '').includes(m), `the ${what} marker in the dashboard's output`);
  }
});

test('R1 a socket with a missing or foreign Origin, or another Host, is refused with 403', opts, async () => {
  const c0 = await viewer();
  const p = view.port, other = p === 65535 ? p - 1 : p + 1;
  const cases = [
    { origin: null },
    { origin: 'http://evil.example' },
    { origin: `http://127.0.0.1:${other}` },
    { origin: `https://127.0.0.1:${p}` },
    { host: `example.com:${p}`, origin: `http://127.0.0.1:${p}` },
    { host: '127.0.0.1', origin: `http://127.0.0.1:${p}` },
    { host: `[::1]:${p}`, origin: `http://127.0.0.1:${p}` },
    { host: `127.0.0.1:${other}`, origin: `http://127.0.0.1:${p}` },
  ];
  for (const k of cases) {
    const c = await ws(p, { host: k.host ?? `127.0.0.1:${p}`, origin: k.origin });
    assert.equal(c.status, 403, `${JSON.stringify(k)}: ${c.head.split('\r\n')[0]}`);
    assert.equal(c.msgs.length, 0);
  }
  assert.equal((await ws(p, { route: '/other' })).status, 404);
  const n = c0.msgs.length;
  await ok(a, ['open', `${site.origin}/`]);
  await c0.wait(isFrame, 3000, n);
});

test('R4 a binary, an unmasked or an oversized frame closes the socket; the daemon serves the next', opts, async () => {
  let c = await viewer();
  c.raw(frameOf(2, Buffer.from('bin')));
  assert.equal(await c.closedIn(3000), 1003);
  c = await viewer();
  c.raw(frameOf(1, Buffer.from('{"t":"back"}'), { masked: false }));
  assert.equal(await c.closedIn(3000), 1002);
  c = await viewer();
  // a header declaring 300 KiB, and no payload: refused on the header
  const h = Buffer.alloc(14);
  h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(300n * 1024n, 2); crypto.randomBytes(4).copy(h, 10);
  c.raw(h);
  assert.equal(await c.closedIn(2000), 1009);
  await viewer();
});

test('R5 a viewer that answers no ping is closed, and the next one gets in', opts, async () => {
  s1?.close();
  await browser(a, ['stop']);
  await running({ DEVTEAM_TEST_BROWSER_PING_MS: '500' });
  try {
    const live = await ws(view.port);
    assert.equal(live.status, 101);
    await sleep(2500);
    assert.equal(live.closed, null, 'one that answers pings stays');
    assert.ok(live.pings >= 2, `pinged (${live.pings})`);
    live.close();
    await sleep(300);
    const silent = await ws(view.port, { pong: false });
    assert.equal(silent.status, 101);
    const t0 = Date.now(); // from its 101: no frame is waited for, the server may close it first
    assert.notEqual(await silent.closedIn(2000), null, 'the silent one is closed within 2 s');
    assert.ok(Date.now() - t0 <= 2000);
    // silence counts from the last byte heard: one that answers one ping and then nothing is closed
    // within the spec's 2 s of its pong
    await sleep(300);
    const once = await ws(view.port, { pong: 1 });
    assert.equal(once.status, 101);
    await within(2000, () => once.lastPong, 'its one pong');
    const closedAt = await once.closedIn(3000).then(() => Date.now());
    assert.notEqual(once.closed, null, 'the one that fell silent after a pong is closed');
    assert.ok(closedAt - once.lastPong <= 2000, `closed ${closedAt - once.lastPong} ms after its pong (at most 2000)`);
    const next = await ws(view.port);
    assert.equal(next.status, 101);
    await next.wait(isFrame, 2000);
    assert.ok(!next.msgs.some((m) => m.t === 'bye'), 'no bye for the next one');
    next.close();
  } finally {
    await browser(a, ['stop']);
    await running();
  }
});

// The fixture's login through the agent's verbs: refs read from a snapshot.
const refOf = (snap, role, name) => new RegExp(`^(e\\d+) ${role} "${name}"`, 'm').exec(snap)?.[1] ?? assert.fail(`no ${role} "${name}" in ${snap}`);
async function signIn(P) {
  await ok(P, ['open', `${site.origin}/login`]);
  let s = await ok(P, ['snapshot']);
  await ok(P, ['type', refOf(s, 'textbox', 'Username'), site.username]);
  await ok(P, ['type', refOf(s, 'textbox', 'Password'), site.password]);
  await ok(P, ['click', refOf(s, 'checkbox', 'Remember me')]);
  await ok(P, ['click', refOf(s, 'button', 'Sign in')]);
  s = await ok(P, ['snapshot']);
  await ok(P, ['type', refOf(s, 'textbox', 'Code'), site.code]);
  await ok(P, ['click', refOf(s, 'button', 'Continue')]);
  await ok(P, ['open', `${site.origin}/account`]);
  assert.match(await ok(P, ['snapshot']), /Signed in as owner/);
}

test('I6 forget signs the browser out and restarts it on an empty profile', opts, async () => {
  await running();
  await signIn(a);
  const c = await viewer();
  const old = readState(a);
  const marker = path.join(a.profile, 'kit-66-marker');
  fs.writeFileSync(marker, 'x');
  await sleep(500);
  c.send({ t: 'forget' });
  // state.json is replaced by a rename, never missing while the daemon lives: gone means it stopped
  await within(20000, () => { if (!fs.existsSync(a.state)) assert.fail('the daemon stopped (state.json gone)'); try { const s = readState(a); return s.chrome_pid !== old.chrome_pid; } catch { return false; } }, 'a new Chrome in state.json');
  assert.equal(readState(a).daemon_pid, old.daemon_pid, 'the same daemon');
  await within(20000, () => !alive(old.chrome_pid), 'the old Chrome gone');
  assert.ok(alive(old.daemon_pid), 'the daemon stays');
  assert.equal(fs.existsSync(marker), false, 'the profile was emptied');
  assert.equal(JSON.parse(fs.readFileSync(path.join(a.profile, 'root.json'), 'utf8')).root, fs.realpathSync(a.old));
  // frames after the new Chrome is up and the old one gone: drawn by the new screencast. A page is
  // opened on the new Chrome so it paints: about:blank's one frame may come before n is taken
  const n = c.msgs.length;
  await ok(a, ['open', `${site.origin}/account`]);
  await c.wait(isFrame, 10000, n);
  const seqs = c.msgs.filter(isFrame).map((m) => m.seq);
  for (let i = 1; i < seqs.length; i++) assert.ok(seqs[i] > seqs[i - 1], `the frame count keeps rising over the socket's life: ${seqs.slice(Math.max(0, i - 3), i + 2).join(', ')}`);
  assert.equal(c.closed, null, 'the socket stayed open');
  assert.match(await ok(a, ['snapshot']), /Not signed in/);
  assert.equal(readState(a).preview, view.name);
});

test('B1 a CLI verb during a long forget finds the daemon alive and starts no second one', opts, async () => {
  s1?.close();
  await browser(a, ['stop']);
  // the forget held 12 s (a test hook): longer than browserEnsure's two 5 s liveness pings
  await running({ DEVTEAM_TEST_BROWSER_FORGET_DELAY_MS: '12000' });
  try {
    const c = await viewer();
    const old = readState(a);
    c.send({ t: 'forget' });
    await sleep(500);
    const t0 = Date.now();
    const r = await browser(a, ['start']);
    const took = Date.now() - t0;
    assert.equal(r.status, 0, r.err || r.out);
    assert.match(r.out, /browser running/);
    assert.ok(took < 4000, `answered in ${took} ms, while the forget runs (under 4000)`);
    assert.equal(readState(a).chrome_pid, old.chrome_pid, 'the forget is still running');
    assert.equal(readState(a).daemon_pid, old.daemon_pid, 'the same daemon');
    assert.ok(alive(old.daemon_pid), 'the daemon stays');
    // the forget then ends on the same daemon
    await within(30000, () => { try { return readState(a).chrome_pid !== old.chrome_pid; } catch { return false; } }, 'the forget done');
    assert.equal(readState(a).daemon_pid, old.daemon_pid, 'the same daemon after the forget');
    assert.equal(devWindows(a).filter((x) => x.name === `dev~${view.name}`).length, 1, 'one window');
  } finally {
    s1?.close();
    await browser(a, ['stop']);
    await running();
  }
});

test('V3 the record is renewed within 5 s, with the same window id', opts, async () => {
  await running();
  const r0 = readRec(a, view.name);
  const r1 = await within(5000, () => { const r = readRec(a, view.name); return r.at !== r0.at ? r : null; }, 'a renewal');
  assert.ok(Date.parse(r1.expires) > Date.parse(r0.expires));
  assert.equal(r1.run.window, r0.run.window, 'the same window id');
});

test('V2 it survives the dashboard\'s sweep and the renewals', opts, async () => {
  await dashboard();
  const s = await running();
  // the dashboard ticks every 200 ms and the record renews every second: 3 s is at least 10 ticks
  await sleep(3000);
  const w = devWindows(a).find((x) => x.name === `dev~${view.name}`);
  assert.ok(w, 'the window is still there');
  assert.equal(readRec(a, view.name).run.window, w.id);
  assert.ok(alive(s.daemon_pid), 'the daemon is still there');
});

test('V4 the Library labels it Supervisor\'s browser', opts, async () => {
  const port = await dashboard();
  await running();
  const row = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/api/hello`)).json()).previews?.find((x) => x.name === view.name), 'hello to list the view');
  assert.equal(row.label, "Supervisor's browser");
  assert.match((await kitCli(a, ['preview', 'list'])).out, new RegExp(`${view.name} .*Supervisor's browser`));
});

test('L1 on a laptop, through the dashboard\'s relay', opts, async () => {
  const port = await dashboard();
  await onRecord();
  const r = await (await fetch(`http://127.0.0.1:${port}/api/view?kind=preview&name=${view.name}`)).json();
  assert.match(r.origin ?? '', /^http:\/\/127\.0\.0\.1:\d+$/, JSON.stringify(r));
  const relay = Number(new URL(r.origin).port);
  const page = await get(relay, '/', `127.0.0.1:${relay}`);
  assert.equal(page.status, 200, page.body.toString().slice(0, 200));
  assert.ok(page.body.equals(PAGE), 'browser.html through the relay');
  s1?.close();
  await sleep(300);
  const t0 = Date.now();
  const c = await ws(relay);
  assert.equal(c.status, 101, c.head.split('\r\n')[0]);
  await c.wait(isFrame, Math.max(1, 2000 - (Date.now() - t0)));
  const before = site.events().length;
  c.send({ t: 'mouse', type: 'click', x: BUTTON.x, y: BUTTON.y, button: 'left', clicks: 1 });
  await within(2000, () => site.events().slice(before).some((x) => x.kind === 'click'), 'the click through the relay');
  c.close();
  await sleep(300);
});

// The real gateway, a stand-in hub listing a's hello row for the view under a's root.
async function gatewayOnView() {
  const port = await dashboard();
  await running();
  const row = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/api/hello`)).json()).previews?.find((x) => x.name === view.name), 'hello to list the view');
  const hub = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ hub: 1, instances: [{ devteam: 1, root: fs.realpathSync(a.old), port: GW_BASE, name: 'bview-a', previews: [row] }] })); });
  await new Promise((r) => hub.listen(GW_HUB, '127.0.0.1', r));
  const hubClose = () => new Promise((r) => { hub.closeAllConnections?.(); hub.close(r); });
  let gw;
  try { gw = await claimedGateway(); await gw.g.pollPush(); } catch (e) { await gw?.close(); await hubClose(); throw e; }
  return { gw, host: `${view.name}.box.localhost:${gw.port}`, close: async () => { await gw.close(); await hubClose(); } };
}

test('G1 through the real gateway with a passkey session', opts, async () => {
  await onRecord();
  s1?.close();
  await sleep(300);
  const { gw, host, close } = await gatewayOnView();
  try {
    const page = await get(gw.port, '/', host, { cookie: gw.cookie, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' });
    assert.equal(page.status, 200, page.body.toString().slice(0, 300));
    assert.ok(page.body.equals(PAGE), 'browser.html through the gateway');
    const t0 = Date.now();
    const c = await ws(gw.port, { host, origin: `http://${host}`, cookie: gw.cookie });
    assert.equal(c.status, 101, c.head.split('\r\n')[0]);
    await c.wait(isFrame, Math.max(1, 2000 - (Date.now() - t0)));
    c.close();
    await sleep(300);
  } finally { await close(); }
});

test('G2 without a session the gateway refuses the view', opts, async () => {
  const { gw, host, close } = await gatewayOnView();
  try {
    assert.equal((await ws(gw.port, { host, origin: `http://${host}` })).status, 401, 'a socket without a session');
    assert.equal((await get(gw.port, '/', host, { 'sec-fetch-mode': 'cors' })).status, 401, 'a GET without a session');
  } finally { await close(); }
});

test('V7 preview stop on it stops the browser, whoever runs it', opts, async () => {
  s1?.close();
  const s = await running();
  const r = await kitCli(a, ['preview', 'stop', view.name], { DEVTEAM_ROLE: undefined, DEVTEAM_TICKET: 'kit-1-x' });
  assert.equal(r.status, 0, r.err || r.out);
  assert.match(r.out, /supervisor's browser/);
  await until(() => !alive(s.daemon_pid) && !alive(s.chrome_pid), 'the daemon and Chrome gone');
  assert.equal(fs.existsSync(recFile(a, view.name)), false, 'the record');
  assert.equal(fs.existsSync(a.state), false, 'state.json');
  assert.ok(!devWindows(a).some((x) => x.name === `dev~${view.name}`), 'the window');
});

test('V8 the name is kept across stops and starts', opts, async () => {
  s1?.close();
  await running();
  const name = view.name;
  // a preview stop (works on main by the daemon's SIGHUP), then a browser stop
  await kitCli(a, ['preview', 'stop', name]);
  await until(() => !fs.existsSync(recFile(a, name)), 'the record gone');
  await running();
  assert.equal(view.name, name, 'the same name after preview stop and browser start');
  await ok(a, ['stop']);
  await running();
  assert.equal(view.name, name, 'the same name after browser stop and start');
});

test('V9 preview start on it is browser start: a worker is refused', opts, async () => {
  const s = await running();
  // stopped with its record kept: the daemon signalled, as a crash or a sweep would leave it
  process.kill(s.daemon_pid, 'SIGTERM');
  await until(() => !alive(s.daemon_pid) && !alive(s.chrome_pid), 'the daemon gone');
  assert.ok(fs.existsSync(recFile(a, view.name)), 'the record is kept');
  const w = await kitCli(a, ['preview', 'start', view.name], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'kit-1-x' });
  assert.equal(w.status, 1, w.out);
  assert.match(w.err, /workers ask the supervisor/);
  await sleep(1500);
  assert.equal(liveState(), null, 'no daemon started');
  const sup = await kitCli(a, ['preview', 'start', view.name]);
  assert.equal(sup.status, 0, sup.err || sup.out);
  assert.match(sup.out, /browser running \(preview /);
  const now = await within(10000, liveState, 'the browser up');
  assert.equal(now.preview, view.name);
});

test('the label browser is the browser\'s own', opts, async () => {
  const s = await running();
  for (const args of [['preview', '45999', '--label', 'browser'], ['preview', '--run', 'true', '--label', 'browser']]) {
    const r = await kitCli(a, args);
    assert.equal(r.status, 1, r.out);
    assert.match(r.err, /the label browser is the supervisor's browser's/);
  }
  assert.ok(alive(s.daemon_pid), 'the browser untouched');
  assert.equal(readRec(a, view.name).run.window, devWindows(a).find((x) => x.name === `dev~${view.name}`)?.id);
});
