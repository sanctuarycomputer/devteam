// browser-view-page's family (kit-223): the fake server, Chrome and the page helpers
// test/browser-view-page.test.mjs and test/browser-view-page.input.test.mjs share, moved from the first
// unchanged. Chrome, which the hooks open, stays in the fixture: only its own open() reads it.
import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { canDrive, openChrome } from './chrome.mjs';
import { message } from '../fixtures/browser/check.mjs';

export const PAGE = new URL('../../docs/devteam/dashboard/browser.html', import.meta.url);
export const FROM_SERVER = JSON.parse(fs.readFileSync(new URL('../fixtures/browser/view-from-server.json', import.meta.url), 'utf8'));
const FRAMES = FROM_SERVER.filter((m) => m.t === 'frame');
export const SMALL = FRAMES.find((f) => f.w === 160); // 160×100
export const BIG = FRAMES.find((f) => f.w === 320); // 320×200

// What the page sends to the console, its errors, and whether its key, wheel and context-menu events
// were default-prevented: recorded in the page's own world before its script runs (chrome.mjs has no
// CDP event stream). Every argument is kept as full text, so a marker inside an object still shows.
const RECORDER = `(() => {
  const seen = []; Object.defineProperty(window, '__seen', { value: seen });
  const text = (v) => { if (v instanceof Error) return String(v.stack || v); if (typeof v === 'string') return v; try { return JSON.stringify(v) ?? String(v); } catch { return String(v); } };
  for (const k of Object.keys(console)) { const f = console[k]; if (typeof f !== 'function') continue; console[k] = (...a) => { seen.push('console.' + k + ': ' + a.map(text).join(' ')); return f.apply(console, a); }; }
  addEventListener('error', (e) => seen.push('error: ' + text(e.error ?? e.message)));
  addEventListener('unhandledrejection', (e) => seen.push('rejection: ' + text(e.reason)));
  const prevented = []; Object.defineProperty(window, '__prevented', { value: prevented });
  for (const t of ['keydown', 'wheel', 'contextmenu']) addEventListener(t, (e) => prevented.push({ t, key: e.key, prevented: e.defaultPrevented }));
  // animation frames the test can hold and then run by hand, to see what the page throttles
  const raf = requestAnimationFrame.bind(window), caf = cancelAnimationFrame.bind(window);
  let holding = false, next = 1e9; const held = new Map();
  window.requestAnimationFrame = (f) => { if (!holding) return raf(f); held.set(++next, f); return next; };
  window.cancelAnimationFrame = (id) => { if (!held.delete(id)) caf(id); };
  Object.defineProperty(window, '__raf', { value: { hold: () => { holding = true; }, run: () => { holding = false; const fs = [...held.values()]; held.clear(); for (const f of fs) f(performance.now()); return fs.length; } } });
})();`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(fn, what, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    let v; try { v = await fn(); } catch { v = false; }
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}
const valid = (m) => assert.deepEqual(message('from_page', m), [], `a from_page message: ${JSON.stringify(m)}`);

// ----- the fake server: the page at /, a minimal RFC 6455 socket at /socket --------------------
function wsFrame(op, payload) {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x80 | op, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  return Buffer.concat([head, payload]);
}
export async function startServer({ page = () => fs.readFileSync(PAGE) } = {}) {
  const conns = [];
  let refusing = false;
  let others = 0;
  const attempts = []; // when each upgrade to /socket came, refused or not
  const srv = http.createServer((q, s) => {
    if (q.url === '/') { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return s.end(page()); }
    if (q.url === '/blank') { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return s.end('<!doctype html><title>blank</title>'); }
    others++;
    s.writeHead(404); s.end();
  });
  srv.on('upgrade', (q, sock) => {
    sock.on('error', () => {});
    if (q.url === '/socket') attempts.push(Date.now());
    if (q.url !== '/socket' || refusing) return sock.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    const accept = crypto.createHash('sha1').update(`${q.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const c = {
      got: [], raw: [], open: true, closedByPage: false, errors: [],
      send: (o) => { if (c.open) sock.write(wsFrame(1, Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)))); },
      close: () => { if (!c.open) return; c.open = false; sock.write(wsFrame(8, Buffer.alloc(0))); sock.end(); },
    };
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        const fin = buf[0] & 0x80, op = buf[0] & 15, masked = buf[1] & 0x80;
        let len = buf[1] & 127, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const maskAt = off;
        if (masked) off += 4;
        if (buf.length < off + len) return;
        const body = Buffer.from(buf.subarray(off, off + len));
        if (masked) for (let i = 0; i < body.length; i++) body[i] ^= buf[maskAt + (i % 4)];
        buf = buf.subarray(off + len);
        if (!fin || op === 0) c.errors.push('a fragmented message');
        if (op === 1) { const t = body.toString('utf8'); c.raw.push(t); try { c.got.push(JSON.parse(t)); } catch { c.errors.push(`not JSON: ${t.slice(0, 80)}`); } }
        else if (op === 8) { c.closedByPage = c.open; if (c.open) { c.open = false; sock.write(wsFrame(8, Buffer.alloc(0))); } sock.end(); }
        else if (op === 9) sock.write(wsFrame(10, body));
      }
    });
    sock.on('close', () => { c.open = false; });
    conns.push(c);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  return {
    port, conns, attempts,
    origin: `http://127.0.0.1:${port}`,
    get others() { return others; },
    refuse: (v) => { refusing = v; },
    last: () => conns.at(-1),
    waitConn: (n, ms = 3000) => until(() => conns.length >= n && conns[n - 1].open, `connection ${n}`, ms),
    close: () => new Promise((r) => { for (const c of conns) c.close(); srv.closeAllConnections?.(); srv.close(() => r()); }),
  };
}

// ----- Chrome ---------------------------------------------------------------------------------
let chrome;

export async function open(srv, { width = 1000, height = 800, url = `${srv.origin}/` } = {}) {
  const p = await chrome.newPage();
  await p.send('Page.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER });
  await p.send('Page.navigate', { url });
  await until(async () => (await p.ev('document.readyState')) === 'complete', 'the page to load');
  return p;
}
// The tab is left on about:blank, so it stops reconnecting to a server that is gone.
export const shut = async (p) => { try { await p.send('Page.navigate', { url: 'about:blank' }); } catch {} p.close(); };
export const canvasState = (p) => p.ev(`(() => { const c = document.getElementById('screen'); const r = c.getBoundingClientRect();
  let alpha = 0; if (c.width && c.height) { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) { alpha = 1; break; } }
  return { w: c.width, h: c.height, alpha, left: r.left, top: r.top, width: r.width, height: r.height, bottom: r.bottom, vh: innerHeight }; })()`);
export const drawn = (p, w, h, ms) => until(async () => { const s = await canvasState(p); return s.w === w && s.h === h && s.alpha && s; }, `a ${w}×${h} frame drawn`, ms);
export const text = (p, id) => p.ev(`document.getElementById(${JSON.stringify(id)}).textContent`);
// A control that would hand the browser back: the page must never have one (design §4).
export const noHandBack = async (p) => assert.deepEqual(await p.ev(`[...document.querySelectorAll('button, a, input, [role=button]')]
  .map((e) => [e.textContent, e.getAttribute('aria-label'), e.getAttribute('title'), e.value].join(' '))
  .filter((s) => /\\bdone\\b|hand.?back|give.?back/i.test(s))`), [], 'no Done or hand-back control');

// A page with a frame drawn, the socket live and the canvas focused: what input tests start from.
export async function ready(srv, opts) {
  const n = srv.conns.length;
  const p = await open(srv, opts);
  await srv.waitConn(n + 1);
  const c = srv.last();
  await until(async () => (await text(p, 'chip')) === 'Live', 'Live');
  c.send({ ...BIG, seq: 1 });
  const s = await drawn(p, 320, 200);
  await p.ev(`document.getElementById('screen').focus()`);
  assert.equal(await p.ev(`document.activeElement.id`), 'screen');
  return { p, c, s };
}
// A point on the canvas, as a fraction of its on-screen box, and where that is in the frame.
export const pt = (s, fx, fy, w = s.w, h = s.h) => ({ x: s.left + s.width * fx, y: s.top + s.height * fy, fx: fx * w, fy: fy * h });
// What one action sent: every message after it, less the pointer's travel (button none) before it.
export async function sent(c, act, settle = 400, { all = false } = {}) {
  const n = c.got.length;
  await act();
  await sleep(settle);
  const got = c.got.slice(n);
  for (const m of got) valid(m);
  if (all) return got;
  const i = got.findIndex((m) => !(m.t === 'mouse' && m.type === 'move' && m.button === 'none'));
  return i < 0 ? [] : got.slice(i);
}
export const mouse = (p, type, at, extra = {}) => p.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, ...extra });
export const keyEvent = (p, type, key, code, extra = {}) => p.send('Input.dispatchKeyEvent', { type, key, code, ...extra });
export async function clip(p, srv, value) {
  await p.send('Browser.grantPermissions', { origin: srv.origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await p.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  assert.equal(await p.ev(`navigator.clipboard.writeText(${JSON.stringify(value)}).then(() => 'ok', (e) => String(e))`), 'ok');
  await p.ev(`document.getElementById('screen').focus()`);
}
export const ctrlV = async (p) => {
  await p.hold('Control', true);
  await keyEvent(p, 'rawKeyDown', 'v', 'KeyV', { windowsVirtualKeyCode: 86, modifiers: 2, commands: ['paste'] });
  await keyEvent(p, 'keyUp', 'v', 'KeyV', { windowsVirtualKeyCode: 86, modifiers: 2 });
  await p.hold('Control', false);
};

// An address-bar entry: the field filled, then a real Enter in it.
export async function go(p, value) {
  await p.ev(`(() => { const a = document.getElementById('addr'); a.focus(); a.value = ${JSON.stringify(value)}; })()`);
  await keyEvent(p, 'keyDown', 'Enter', 'Enter', { text: '\r', windowsVirtualKeyCode: 13 });
  await keyEvent(p, 'keyUp', 'Enter', 'Enter', { windowsVirtualKeyCode: 13 });
}

// The file's hooks start when the file calls this at its top (no work at import).
export function viewPageFile() {
  before(async () => { if (canDrive) chrome = await openChrome(); });
  after(async () => { await chrome?.close(); });
}
