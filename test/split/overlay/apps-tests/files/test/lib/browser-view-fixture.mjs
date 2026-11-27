// browser-view's family (kit-223): the state, hooks and helpers test/browser-view.test.mjs and
// test/browser-view.lifecycle.test.mjs share, moved from the first unchanged. State that hooks and helpers
// set is exported live (export let), so the tests read it by its bare name.
import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { canDrive } from './chrome.mjs';
import { monoFixture, dashboardOnFreePort, until, sessionOf, PORTS, kit } from './kit.mjs';
import { startSites } from './sites.mjs';
import { message } from '../fixtures/browser/check.mjs';

const skip = canDrive ? false : 'needs Chrome and Node 22+';
// the laptop dashboard's relays: a range of this file's own (+86..95)
const RELAYS = `${PORTS + 86}-${PORTS + 95}`;

export const PAGE = fs.readFileSync(path.join(kit, 'apps', 'dashboard', 'browser', 'index.html'));
export let tmp;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export let site, a, dash;
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
export function kitCli(P, args, extraEnv = {}) {
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
export const browser = (P, args, env) => kitCli(P, ['browser', ...args], env);
export async function ok(P, args) { const r = await browser(P, args); assert.equal(r.status, 0, `browser ${args.join(' ')}: ${r.err || r.out}`); return r.out; }

export function alive(pid) {
  try { process.kill(pid, 0); } catch (err) { if (err.code !== 'EPERM') return false; }
  try { const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return st.slice(st.lastIndexOf(')') + 2)[0] !== 'Z'; } catch { return false; }
}
export const tmuxOf = (P, args) => spawnSync('tmux', args, { encoding: 'utf8', env: { ...process.env, TMUX_TMPDIR: P.env.TMUX_TMPDIR } });
export function devWindows(P) {
  const r = tmuxOf(P, ['list-panes', '-s', '-t', `=${sessionOf(P.old, P.name)}`, '-F', '#{window_name} #{pane_pid} #{window_id}']);
  if (r.status !== 0) return [];
  return r.stdout.split('\n').filter(Boolean).map((l) => { const [name, pid, id] = l.split(' '); return { name, pid: Number(pid), id }; }).filter((w) => w.name.startsWith('dev~'));
}
export const readState = (P) => JSON.parse(fs.readFileSync(P.state, 'utf8'));
export const recFile = (P, name) => path.join(P.run, 'previews', `${name}.json`);
export const readRec = (P, name) => JSON.parse(fs.readFileSync(recFile(P, name), 'utf8'));

// An HTTP request to 127.0.0.1:port with the Host (and headers) given: { status, headers, body }.
export function get(port, route, host, headers = {}, method = 'GET') {
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
export function frameOf(op, payload, { masked = true, fin = true, rsv = 0 } = {}) {
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
export function ws(port, { host = `127.0.0.1:${port}`, origin = `http://${host}`, route = '/socket', cookie, headers = {}, pong = true } = {}) {
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
export const isFrame = (m) => m.t === 'frame';

// The /record page's layout in headless Chrome: the button (200 x 80) under the h1. Its centre, in
// CSS pixels of the viewport, which the frames are in.
export const BUTTON = { x: 108, y: 120 };

// fn's first truthy value within ms (polled every 25 ms), or a failure naming what and how long.
export async function within(ms, fn, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return assert.fail(`${what}: not within ${ms} ms`);
    await sleep(25);
  }
}

export let view = null; // { name, port }: a's view
export let s1 = null; // the viewer's socket, while one is open
export let standIn = null; // I3: a loopback server whose port isn't allowed, counting what reaches it
let setup = Promise.resolve();
// Each check sets up what it needs, so it runs, and is seen red, on its own: the browser running (and
// view naming it), a dashboard on a's fixture, a viewer's socket with a frame drawn.
export const liveState = () => { try { const s = readState(a); return alive(s.daemon_pid) ? s : null; } catch { return null; } };
export async function running(env) {
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
export async function dashboard() {
  if (!dash) dash = await dashboardOnFreePort(a.old, a.env);
  return dash.port;
}
export async function viewer() {
  await running();
  if (s1 && s1.status === 101 && s1.closed === null) return s1;
  s1 = await ws(view.port);
  assert.equal(s1.status, 101, s1.head.split('\r\n')[0]);
  await s1.wait(isFrame, 2000);
  return s1;
}
export async function onRecord() {
  await running();
  await ok(a, ['open', `${site.origin}/record`]);
}

// The file's hooks, and its temp folder, start when the file calls this at its top (no work at import).
export function viewFile() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-bview-'));
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
}
