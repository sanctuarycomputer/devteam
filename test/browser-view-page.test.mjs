// The live browser view page (docs/devteam/dashboard/browser.html) in real Chrome, against a fake
// socket server that speaks browser@1's view messages: the server replays fixture frames and
// records every message the page sends, each checked against its from_page shape.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { canDrive, openChrome } from './lib/chrome.mjs';
import { message } from './fixtures/browser/check.mjs';

const PAGE = new URL('../docs/devteam/dashboard/browser.html', import.meta.url);
const FROM_SERVER = JSON.parse(fs.readFileSync(new URL('./fixtures/browser/view-from-server.json', import.meta.url), 'utf8'));
const FRAMES = FROM_SERVER.filter((m) => m.t === 'frame');
const SMALL = FRAMES.find((f) => f.w === 160); // 160×100
const BIG = FRAMES.find((f) => f.w === 320); // 320×200
const QID = FROM_SERVER.find((m) => m.t === 'held' && m.qid).qid;

// CI's Node 22 and 24 jobs have Chrome: there the test must run, never skip.
const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;
const skip = canDrive ? false : 'needs Chrome and a Node with WebSocket';

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 3000) {
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
async function startServer({ page = () => fs.readFileSync(PAGE) } = {}) {
  const conns = [];
  let refusing = false;
  let others = 0;
  const attempts = []; // when each upgrade to /socket came, refused or not
  const srv = http.createServer((q, s) => {
    if (q.url === '/') { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return s.end(page()); }
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
before(async () => { if (canDrive) chrome = await openChrome(); });
after(async () => { await chrome?.close(); });

async function open(srv, { width = 1000, height = 800, url = `${srv.origin}/` } = {}) {
  const p = await chrome.newPage();
  await p.send('Page.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER });
  await p.send('Page.navigate', { url });
  await until(async () => (await p.ev('document.readyState')) === 'complete', 'the page to load');
  return p;
}
// The tab is left on about:blank, so it stops reconnecting to a server that is gone.
const shut = async (p) => { try { await p.send('Page.navigate', { url: 'about:blank' }); } catch {} p.close(); };
const canvasState = (p) => p.ev(`(() => { const c = document.getElementById('screen'); const r = c.getBoundingClientRect();
  let alpha = 0; if (c.width && c.height) { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) { alpha = 1; break; } }
  return { w: c.width, h: c.height, alpha, left: r.left, top: r.top, width: r.width, height: r.height, bottom: r.bottom, vh: innerHeight }; })()`);
const drawn = (p, w, h, ms) => until(async () => { const s = await canvasState(p); return s.w === w && s.h === h && s.alpha && s; }, `a ${w}×${h} frame drawn`, ms);
const text = (p, id) => p.ev(`document.getElementById(${JSON.stringify(id)}).textContent`);
// A control that would hand the browser back: the page must never have one (design §4).
const noHandBack = async (p) => assert.deepEqual(await p.ev(`[...document.querySelectorAll('button, a, input, [role=button]')]
  .map((e) => [e.textContent, e.getAttribute('aria-label'), e.getAttribute('title'), e.value].join(' '))
  .filter((s) => /\\bdone\\b|hand.?back|give.?back/i.test(s))`), [], 'no Done or hand-back control');

if (mustRun && !canDrive) test('Chrome is needed on CI\'s Node 22+', () => assert.fail('Chrome is needed on CI\'s Node 22+: this test must run there, not skip'));

// ----- Task 1: the screen and the connection's basics -----------------------------------------
test('the page draws each frame at its size, shows the url, and the held line', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const p = await open(srv);
  try {
    await srv.waitConn(1);
    const c = srv.last();
    assert.equal(await text(p, 'foot'), '', 'no held line before held');
    assert.equal(await p.ev(`document.getElementById('waiting').hidden`), false);
    assert.equal(await text(p, 'waiting'), 'Connecting to the supervisor\'s browser…', 'before the first frame');
    for (const m of FROM_SERVER.filter((m) => m.t !== 'bye')) {
      c.send(m);
      if (m.t === 'frame') await drawn(p, m.w, m.h);
      if (m.t === 'url') await until(async () => (await p.ev(`document.getElementById('addr').value`)) === m.url, `the address bar to show ${m.url}`);
      if (m.t === 'held') {
        const want = m.qid ? 'When you\'re done, press Done on the card.' : 'The supervisor has the browser. You can watch.';
        await until(async () => (await text(p, 'foot')) === want, `the foot line "${want}"`);
      }
    }
    assert.equal(await p.ev(`document.getElementById('addr').value`), 'https://shop.example/account');
  } finally { await shut(p); await srv.close(); }
});

test('the address bar shows the url exactly as sent, masked', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const p = await open(srv);
  try {
    await srv.waitConn(1);
    srv.last().send({ t: 'url', url: 'https://shop.example/account/login?next=•••' });
    await until(async () => (await p.ev(`document.getElementById('addr').value`)) === 'https://shop.example/account/login?next=•••', 'the masked url');
    srv.last().send({ t: 'held', qid: QID });
    await until(async () => (await text(p, 'foot')) === 'When you\'re done, press Done on the card.', 'the held line');
  } finally { await shut(p); await srv.close(); }
});

test('the address bar shows only a masked url: the page holds the contract\'s mask', { skip, timeout: 60000 }, async () => {
  const schema = JSON.parse(fs.readFileSync(new URL('../docs/devteam/schema/browser.schema.json', import.meta.url), 'utf8'));
  const html = fs.readFileSync(PAGE, 'utf8');
  const src = /const MASKED = new RegExp\(String\.raw`(.*)`\);\n/.exec(html);
  assert.ok(src, 'the page has its MASKED pattern');
  assert.equal(src[1], schema['x-masked-url'], 'the page\'s mask is x-masked-url, exactly');
  const srv = await startServer();
  const p = await open(srv);
  try {
    await srv.waitConn(1);
    const c = srv.last();
    c.send({ t: 'url', url: 'https://shop.example/account' });
    await until(async () => (await p.ev(`document.getElementById('addr').value`)) === 'https://shop.example/account', 'a masked url');
    for (const url of ['https://shop.example/login?code=abc123', 'https://shop.example/a#token=1', 'https://u:p@shop.example/', 'https://shop.example/reset/12345678', 'file:///etc/passwd']) c.send({ t: 'url', url });
    c.send({ t: 'url', url: 'https://shop.example/ok', extra: 1 });
    c.send({ t: 'held', qid: QID }); // a marker: everything before it has been read
    await until(async () => (await text(p, 'foot')) !== '', 'the held line');
    assert.equal(await p.ev(`document.getElementById('addr').value`), 'https://shop.example/account', 'an unmasked url, or one with another field, is never shown');
  } finally { await shut(p); await srv.close(); }
});

test('the page has no Done or hand-back control', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const p = await open(srv);
  try {
    await srv.waitConn(1);
    srv.last().send({ t: 'held', qid: QID });
    srv.last().send(BIG);
    await drawn(p, 320, 200);
    await noHandBack(p);
  } finally { await shut(p); await srv.close(); }
});

test('the canvas fits the window, up and down', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  let p;
  try {
    p = await open(srv, { width: 700, height: 700 });
    await srv.waitConn(1);
    srv.last().send(BIG);
    let s = await drawn(p, 320, 200);
    assert.ok(s.width > 320, `a 320 px frame is scaled up in a 700 px window (shown ${s.width} px)`);
    assert.ok(Math.abs(s.width / s.height - 1.6) < 0.016, 'aspect kept');
    await shut(p);
    p = await open(srv, { width: 1200, height: 500 });
    await srv.waitConn(2);
    srv.last().send(BIG);
    s = await drawn(p, 320, 200);
    assert.ok(s.bottom <= s.vh, `the whole frame is on screen in a wide, short window (bottom ${s.bottom} of ${s.vh})`);
    assert.ok(Math.abs(s.width / s.height - 1.6) < 0.016, 'aspect kept');
    const foot = await p.ev(`document.getElementById('foot').getBoundingClientRect().bottom`);
    assert.ok(foot <= s.vh, 'and the foot line too');
  } finally { if (p) await shut(p); await srv.close(); }
});

test('the page\'s CSP hashes its own script and style, and it loads nothing from elsewhere', { skip, timeout: 60000 }, async () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  const head = /<head>\s*<meta charset="utf-8">\s*<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  assert.ok(head, 'the head opens with the charset, then the CSP');
  const one = (tag) => { const all = [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))]; assert.equal(all.length, 1, `one <${tag}>`); return all[0][1]; };
  const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('base64');
  assert.equal(head[1], `default-src 'none'; script-src 'sha256-${sha(one('script'))}'; style-src 'sha256-${sha(one('style'))}'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'`);
  const markup = html.replace(/<script>[\s\S]*?<\/script>|<style>[\s\S]*?<\/style>/g, '');
  assert.doesNotMatch(markup, /\s(?:src|href)\s*=/i, 'no src or href attribute');
  assert.doesNotMatch(markup, /<script[^>]*\ssrc|<link\b|<iframe|<object|<embed|<img/i);
  assert.doesNotMatch(markup, /\sstyle\s*=|\son[a-z]+\s*=/i, 'no style attribute and no inline handler (the CSP would refuse them)');
  const srv = await startServer();
  let hits = 0;
  const other = http.createServer((q, s) => { hits++; s.end(''); });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  const p = await open(srv);
  try {
    await srv.waitConn(1);
    const at = `http://127.0.0.1:${other.address().port}`;
    await p.ev(`(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => __csp.push(e.effectiveDirective));
      const s = document.createElement('script'); s.src = '${at}/x.js'; document.head.append(s);
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '${at}/x.css'; document.head.append(l); })()`);
    const v = await until(async () => { const v = await p.ev('window.__csp'); return v.length >= 2 && v; }, 'two CSP violations');
    assert.ok(v.some((d) => d.startsWith('script-src')) && v.some((d) => d.startsWith('style-src')), JSON.stringify(v));
    await sleep(300);
    assert.equal(hits, 0, 'the other origin got no request');
    assert.equal(srv.others, 0, 'and the page asked its own server for nothing but itself');
  } finally { await shut(p); other.close(); await srv.close(); }
});

test('the page reconnects by itself after the server closes the socket', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const p = await open(srv);
  try {
    await srv.waitConn(1);
    await until(async () => (await text(p, 'chip')) === 'Live', 'the chip to say Live');
    srv.last().send({ ...BIG, seq: 5 });
    await drawn(p, 320, 200);
    srv.last().close();
    await until(async () => (await text(p, 'chip')) === 'Reconnecting…', 'the chip to say Reconnecting…');
    assert.equal(await p.ev(`document.getElementById('area').classList.contains('down')`), true, 'the last frame dimmed while it is down');
    await srv.waitConn(2, 3000);
    await until(async () => (await text(p, 'chip')) === 'Live', 'Live again');
    srv.last().send({ ...SMALL, seq: 0 });
    await drawn(p, 160, 100); // the count starts again on a new socket
    assert.equal(await p.ev(`document.getElementById('area').classList.contains('down')`), false);
  } finally { await shut(p); await srv.close(); }
});

test('the page waits 0.5 s, then doubling up to 5 s, between tries, and 0.5 s again once one opens', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const p = await open(srv);
  try {
    await srv.waitConn(1);
    srv.refuse(true);
    const from = srv.attempts.length;
    const closedAt = Date.now();
    srv.last().close();
    await until(() => srv.attempts.length >= from + 4, 'four refused tries', 12000);
    const at = [closedAt, ...srv.attempts.slice(from, from + 4)];
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    for (const [i, want] of [500, 1000, 2000, 4000].entries()) assert.ok(gaps[i] >= want * 0.8 && gaps[i] <= want * 1.3 + 300, `try ${i + 1} after ~${want} ms (gaps ${gaps})`);
    assert.equal(await text(p, 'chip'), 'Reconnecting…');
    srv.refuse(false);
    await srv.waitConn(2, 9000);
    await until(async () => (await text(p, 'chip')) === 'Live', 'Live');
    await sleep(200);
    const t = Date.now();
    srv.last().close();
    await srv.waitConn(3, 3000);
    assert.ok(Date.now() - t < 1400, `after a socket opened, the next try is back to 0.5 s (${Date.now() - t} ms)`);
  } finally { await shut(p); await srv.close(); }
});

test('a page whose first socket never opens still says Connecting…', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  srv.refuse(true);
  const p = await open(srv);
  try {
    await until(() => srv.attempts.length >= 2, 'two refused tries', 5000);
    assert.equal(await text(p, 'chip'), 'Connecting…', 'nothing dropped: it never connected');
    srv.refuse(false);
    await srv.waitConn(1, 6000);
    await until(async () => (await text(p, 'chip')) === 'Live', 'Live');
  } finally { await shut(p); await srv.close(); }
});

// ----- Task 2: the owner's input ----------------------------------------------------------------
// A page with a frame drawn, the socket live and the canvas focused: what input tests start from.
async function ready(srv, opts) {
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
const pt = (s, fx, fy, w = s.w, h = s.h) => ({ x: s.left + s.width * fx, y: s.top + s.height * fy, fx: fx * w, fy: fy * h });
const near = (m, want, what) => { assert.ok(Math.abs(m.x - want.fx) <= 1 && Math.abs(m.y - want.fy) <= 1, `${what}: (${m.x}, ${m.y}) is (${want.fx}, ${want.fy})`); };
// What one action sent: every message after it, less the pointer's travel (button none) before it.
async function sent(c, act, settle = 400, { all = false } = {}) {
  const n = c.got.length;
  await act();
  await sleep(settle);
  const got = c.got.slice(n);
  for (const m of got) valid(m);
  if (all) return got;
  const i = got.findIndex((m) => !(m.t === 'mouse' && m.type === 'move' && m.button === 'none'));
  return i < 0 ? [] : got.slice(i);
}
const mouse = (p, type, at, extra = {}) => p.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, ...extra });
const keyEvent = (p, type, key, code, extra = {}) => p.send('Input.dispatchKeyEvent', { type, key, code, ...extra });
async function clip(p, srv, value) {
  await p.send('Browser.grantPermissions', { origin: srv.origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await p.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  assert.equal(await p.ev(`navigator.clipboard.writeText(${JSON.stringify(value)}).then(() => 'ok', (e) => String(e))`), 'ok');
  await p.ev(`document.getElementById('screen').focus()`);
}
const ctrlV = async (p) => {
  await p.hold('Control', true);
  await keyEvent(p, 'rawKeyDown', 'v', 'KeyV', { windowsVirtualKeyCode: 86, modifiers: 2, commands: ['paste'] });
  await keyEvent(p, 'keyUp', 'v', 'KeyV', { windowsVirtualKeyCode: 86, modifiers: 2 });
  await p.hold('Control', false);
};

test('a click, a double click and a Shift+click each send one click, at the frame\'s point', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c, s } = await ready(srv, { width: 700, height: 700 });
  try {
    assert.notEqual(Math.round(s.width), 320, 'the canvas is shown at another size than the frame');
    const a = pt(s, 0.25, 0.5);
    let got = await sent(c, () => p.clickAt(a.x, a.y));
    assert.equal(got.length, 1, JSON.stringify(got));
    assert.equal(got[0].t, 'mouse'); assert.equal(got[0].type, 'click'); assert.equal(got[0].button, 'left'); assert.equal(got[0].clicks, 1);
    assert.equal(got[0].mods, undefined);
    near(got[0], a, 'the click');
    await sleep(600); // past the double-click window
    const b = pt(s, 0.75, 0.25);
    got = await sent(c, async () => { await p.clickAt(b.x, b.y); await p.clickAt(b.x, b.y); });
    got = got.filter((m) => !(m.type === 'move' && m.button === 'none')); // the helper's travel before its second press
    assert.deepEqual(got.map((m) => [m.type, m.clicks]), [['click', 1], ['click', 2]], 'the page counts the second click of a double click');
    near(got[1], b, 'the double click');
    await sleep(600);
    got = await sent(c, async () => { await p.hold('Shift', true); await p.clickAt(a.x, a.y, 8); await p.hold('Shift', false); });
    assert.deepEqual(got.map((m) => [m.t, m.type, m.mods]), [['mouse', 'click', 8]], 'Shift itself sends nothing; the click carries it');
  } finally { await shut(p); await srv.close(); }
});

test('a drag sends down, moves with its button, and up; a Shift+drag carries Shift on each', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c, s } = await ready(srv, { width: 700, height: 700 });
  try {
    const a = pt(s, 0.2, 0.2), b = pt(s, 0.6, 0.7);
    const drag = (mods = 0) => async () => {
      await mouse(p, 'mouseMoved', a, { modifiers: mods });
      await mouse(p, 'mousePressed', a, { button: 'left', buttons: 1, clickCount: 1, modifiers: mods });
      await mouse(p, 'mouseMoved', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, { button: 'left', buttons: 1, modifiers: mods });
      await sleep(50);
      await mouse(p, 'mouseMoved', b, { button: 'left', buttons: 1, modifiers: mods });
      await mouse(p, 'mouseReleased', b, { button: 'left', buttons: 0, clickCount: 1, modifiers: mods });
    };
    let got = await sent(c, drag());
    assert.equal(got[0].type, 'down'); near(got[0], a, 'the down, at the press');
    assert.equal(got.at(-1).type, 'up'); near(got.at(-1), b, 'the up, at the release');
    const moves = got.slice(1, -1);
    assert.ok(moves.length >= 1 && moves.every((m) => m.type === 'move' && m.button === 'left'), JSON.stringify(got));
    assert.ok(got.every((m) => m.mods === undefined));
    got = await sent(c, async () => { await p.hold('Shift', true); await drag(8)(); await p.hold('Shift', false); });
    assert.deepEqual([got[0].type, got.at(-1).type], ['down', 'up']);
    assert.ok(got.every((m) => m.t === 'mouse' && m.mods === 8), JSON.stringify(got));
  } finally { await shut(p); await srv.close(); }
});

test('a wheel turn sends one wheel, and the page itself doesn\'t scroll', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c, s } = await ready(srv, { width: 700, height: 700 });
  try {
    const a = pt(s, 0.5, 0.5);
    const got = await sent(c, () => mouse(p, 'mouseWheel', a, { deltaX: 0, deltaY: 120 }));
    assert.deepEqual(got.map((m) => [m.t, m.dx, m.dy]), [['wheel', 0, 120]]);
    near(got[0], a, 'the wheel');
    assert.ok((await p.ev('window.__prevented')).some((e) => e.t === 'wheel' && e.prevented));
  } finally { await shut(p); await srv.close(); }
});

test('typed text, Enter, AltGr, Backspace and Ctrl+A each send what the spec says', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c } = await ready(srv);
  try {
    let got = await sent(c, () => p.type('ab'));
    assert.deepEqual(got, [{ t: 'key', type: 'press', key: 'a', code: 'KeyA', text: 'a' }, { t: 'key', type: 'press', key: 'b', code: 'KeyB', text: 'b' }]);
    got = await sent(c, async () => { await keyEvent(p, 'keyDown', 'Enter', 'Enter', { windowsVirtualKeyCode: 13 }); await keyEvent(p, 'keyUp', 'Enter', 'Enter', { windowsVirtualKeyCode: 13 }); });
    assert.deepEqual(got, [{ t: 'key', type: 'press', key: 'Enter', code: 'Enter', text: '\r' }]);
    // AltGr on Windows is Ctrl and Alt together: how @ is typed on many layouts
    got = await sent(c, async () => { await keyEvent(p, 'keyDown', '@', 'KeyQ', { text: '@', modifiers: 3, windowsVirtualKeyCode: 81 }); await keyEvent(p, 'keyUp', '@', 'KeyQ', { modifiers: 3, windowsVirtualKeyCode: 81 }); });
    assert.deepEqual(got, [{ t: 'key', type: 'press', key: '@', code: 'KeyQ', text: '@' }]);
    got = await sent(c, async () => { await keyEvent(p, 'rawKeyDown', 'Backspace', 'Backspace', { windowsVirtualKeyCode: 8 }); await keyEvent(p, 'keyUp', 'Backspace', 'Backspace', { windowsVirtualKeyCode: 8 }); });
    assert.deepEqual(got, [{ t: 'key', type: 'down', key: 'Backspace', code: 'Backspace' }, { t: 'key', type: 'up', key: 'Backspace', code: 'Backspace' }]);
    got = await sent(c, async () => { await p.hold('Control', true); await keyEvent(p, 'rawKeyDown', 'a', 'KeyA', { modifiers: 2, windowsVirtualKeyCode: 65 }); await keyEvent(p, 'keyUp', 'a', 'KeyA', { modifiers: 2, windowsVirtualKeyCode: 65 }); await p.hold('Control', false); });
    assert.deepEqual(got, [{ t: 'key', type: 'down', key: 'a', code: 'KeyA', mods: 2 }, { t: 'key', type: 'up', key: 'a', code: 'KeyA' }]);
  } finally { await shut(p); await srv.close(); }
});

test('a real paste sends one paste and no key; a long one goes in whole pieces; too long or empty sends nothing', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c } = await ready(srv);
  try {
    await clip(p, srv, 'owner@shop.example');
    let got = await sent(c, () => ctrlV(p));
    assert.deepEqual(got, [{ t: 'paste', text: 'owner@shop.example' }]);
    assert.ok((await p.ev('window.__prevented')).some((e) => e.t === 'keydown' && e.key === 'v' && !e.prevented), 'Ctrl+V is left to the browser, so its paste fires');
    const long = `${'x'.repeat(9999)}😀yz`; // the emoji sits over the 10 000-character cut
    await clip(p, srv, long);
    got = await sent(c, () => ctrlV(p));
    assert.equal(got.length, 2, 'two pieces');
    assert.ok(got.every((m) => m.t === 'paste' && m.text.length <= 10000));
    assert.equal(got.map((m) => m.text).join(''), long, 'in order, nothing lost');
    assert.ok(!/[\uD800-\uDBFF]$/.test(got[0].text), 'no piece ends in half an emoji');
    await clip(p, srv, 'z'.repeat(100001));
    got = await sent(c, () => ctrlV(p));
    assert.deepEqual(got, [], 'over 100 000 characters sends nothing');
    assert.equal(await text(p, 'note'), 'That paste is too long to send.');
    await clip(p, srv, 'short');
    got = await sent(c, () => ctrlV(p));
    assert.deepEqual(got, [{ t: 'paste', text: 'short' }]);
    assert.equal(await text(p, 'note'), '', 'a paste that goes clears the line');
    await clip(p, srv, 'z'.repeat(100001));
    await ctrlV(p);
    await until(async () => (await text(p, 'note')) !== '', 'the line again');
    const shown = await canvasState(p);
    assert.ok(shown.bottom <= shown.vh, 'with the note line shown, the whole frame is still on screen');
    await clip(p, srv, '');
    got = await sent(c, () => ctrlV(p));
    assert.deepEqual(got, [], 'an empty paste sends nothing');
  } finally { await shut(p); await srv.close(); }
});

test('coordinates follow the newest frame\'s size', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c } = await ready(srv, { width: 700, height: 700 });
  try {
    c.send({ ...SMALL, seq: 2 });
    let s = await drawn(p, 160, 100);
    let a = pt(s, 0.5, 0.25);
    let got = await sent(c, () => p.clickAt(a.x, a.y));
    near(got[0], a, 'on the 160×100 frame');
    await sleep(600);
    c.send({ ...BIG, seq: 3 });
    s = await drawn(p, 320, 200);
    a = pt(s, 0.5, 0.25);
    got = await sent(c, () => p.clickAt(a.x, a.y));
    near(got[0], a, 'on the 320×200 frame');
  } finally { await shut(p); await srv.close(); }
});

test('keys the page sends move nothing on it, and the canvas has no menu of its own', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c, s } = await ready(srv);
  try {
    await sent(c, async () => {
      await keyEvent(p, 'keyDown', ' ', 'Space', { text: ' ', windowsVirtualKeyCode: 32 }); await keyEvent(p, 'keyUp', ' ', 'Space', { windowsVirtualKeyCode: 32 });
      await keyEvent(p, 'rawKeyDown', 'ArrowDown', 'ArrowDown', { windowsVirtualKeyCode: 40 }); await keyEvent(p, 'keyUp', 'ArrowDown', 'ArrowDown', { windowsVirtualKeyCode: 40 });
      await keyEvent(p, 'rawKeyDown', 'Tab', 'Tab', { windowsVirtualKeyCode: 9 }); await keyEvent(p, 'keyUp', 'Tab', 'Tab', { windowsVirtualKeyCode: 9 });
      const a = pt(s, 0.5, 0.5);
      await mouse(p, 'mousePressed', a, { button: 'right', buttons: 2, clickCount: 1 });
      await mouse(p, 'mouseReleased', a, { button: 'right', buttons: 0, clickCount: 1 });
    });
    const seen = await p.ev('window.__prevented');
    for (const k of [' ', 'ArrowDown', 'Tab']) assert.ok(seen.some((e) => e.t === 'keydown' && e.key === k && e.prevented), `${k} default-prevented`);
    assert.ok(seen.some((e) => e.t === 'contextmenu' && e.prevented), 'the context menu prevented');
    assert.equal(await p.ev(`document.activeElement.id`), 'screen', 'Tab kept the focus on the canvas');
  } finally { await shut(p); await srv.close(); }
});

test('a lost pointer capture ends a drag with its up; a press not yet a drag sends nothing', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c, s } = await ready(srv, { width: 700, height: 700 });
  try {
    const a = pt(s, 0.2, 0.2), b = pt(s, 0.5, 0.5);
    const lose = () => p.ev(`document.getElementById('screen').dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1 }))`);
    let got = await sent(c, async () => {
      await mouse(p, 'mouseMoved', a);
      await mouse(p, 'mousePressed', a, { button: 'left', buttons: 1, clickCount: 1 });
      await mouse(p, 'mouseMoved', b, { button: 'left', buttons: 1 });
      await sleep(100);
      await lose();
      await mouse(p, 'mouseReleased', b, { button: 'left', buttons: 0, clickCount: 1 });
    });
    assert.deepEqual(got.map((m) => m.type).filter((t) => t !== 'move'), ['down', 'up'], JSON.stringify(got));
    near(got.at(-1), b, 'the up, at the last point');
    await sleep(600);
    got = await sent(c, async () => {
      await mouse(p, 'mouseMoved', a);
      await mouse(p, 'mousePressed', a, { button: 'left', buttons: 1, clickCount: 1 });
      await lose();
      await mouse(p, 'mouseReleased', a, { button: 'left', buttons: 0, clickCount: 1 });
    });
    assert.deepEqual(got, [], 'a press still waiting to be a click sends nothing once the capture is lost');
  } finally { await shut(p); await srv.close(); }
});

test('the 4 px rule: a press that moves 3 px is a click at the press; one that moves 6 px, or is released 10 px off, is a drag', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c, s } = await ready(srv, { width: 700, height: 700 });
  try {
    const a = pt(s, 0.3, 0.3);
    const off = (dx) => ({ x: a.x + dx, y: a.y });
    let got = await sent(c, async () => {
      await mouse(p, 'mouseMoved', a);
      await mouse(p, 'mousePressed', a, { button: 'left', buttons: 1, clickCount: 1 });
      await mouse(p, 'mouseMoved', off(3), { button: 'left', buttons: 1 });
      await mouse(p, 'mouseReleased', off(3), { button: 'left', buttons: 0, clickCount: 1 });
    });
    assert.deepEqual(got.map((m) => m.type), ['click'], JSON.stringify(got));
    near(got[0], a, 'the click is where the press was');
    await sleep(600);
    got = await sent(c, async () => {
      await mouse(p, 'mouseMoved', a);
      await mouse(p, 'mousePressed', a, { button: 'left', buttons: 1, clickCount: 1 });
      await mouse(p, 'mouseMoved', off(6), { button: 'left', buttons: 1 });
      await mouse(p, 'mouseReleased', off(6), { button: 'left', buttons: 0, clickCount: 1 });
    });
    assert.deepEqual(got.map((m) => m.type).filter((t) => t !== 'move'), ['down', 'up'], JSON.stringify(got));
    await sleep(600);
    got = await sent(c, async () => {
      await mouse(p, 'mouseMoved', a);
      await mouse(p, 'mousePressed', a, { button: 'left', buttons: 1, clickCount: 1 });
      await mouse(p, 'mouseReleased', off(10), { button: 'left', buttons: 0, clickCount: 1 });
    });
    assert.deepEqual(got.map((m) => m.type).filter((t) => t !== 'move'), ['down', 'up'], `released 10 px off: ${JSON.stringify(got)}`);
    near(got[0], a, 'the down at the press');
    near(got.at(-1), { fx: got.at(-1).x, fy: got.at(-1).y }, 'the up');
  } finally { await shut(p); await srv.close(); }
});

test('moves wait for an animation frame, one per frame, and a waiting one goes before the up', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c, s } = await ready(srv, { width: 700, height: 700 });
  try {
    const at = (fx, fy) => pt(s, fx, fy);
    await p.ev('__raf.hold()');
    let got = await sent(c, async () => { for (let i = 1; i <= 5; i++) await mouse(p, 'mouseMoved', at(0.1 * i, 0.5)); }, 200, { all: true });
    assert.deepEqual(got, [], 'no move before its frame');
    let ran;
    got = await sent(c, async () => { ran = await p.ev('__raf.run()'); }, 200, { all: true });
    assert.equal(got.length, 1, `one move for five in one frame: ${JSON.stringify(got)} (${ran} frames held)`);
    near(got[0], at(0.5, 0.5), 'the newest');
    await p.ev('__raf.hold()');
    got = await sent(c, async () => { await p.hold('Shift', true); await mouse(p, 'mouseMoved', at(0.6, 0.6), { modifiers: 8 }); await p.hold('Shift', false); await p.ev('__raf.run()'); }, 200, { all: true });
    assert.deepEqual(got.map((m) => [m.type, m.button, m.mods]), [['move', 'none', 8]], 'a hover move carries Shift');
    await p.ev('__raf.hold()');
    const a = at(0.2, 0.2), b = at(0.7, 0.7);
    got = await sent(c, async () => {
      await mouse(p, 'mouseMoved', a);
      await mouse(p, 'mousePressed', a, { button: 'left', buttons: 1, clickCount: 1 });
      await mouse(p, 'mouseMoved', b, { button: 'left', buttons: 1 });
      await mouse(p, 'mouseReleased', b, { button: 'left', buttons: 0, clickCount: 1 });
    }, 200);
    assert.deepEqual(got.map((m) => m.type), ['down', 'move', 'up'], `the waiting move goes before the up: ${JSON.stringify(got)}`);
    near(got[1], b, 'the move');
    got = await sent(c, () => p.ev('__raf.run()'), 200, { all: true });
    assert.deepEqual(got, [], 'and nothing after it');
  } finally { await shut(p); await srv.close(); }
});

test('the wheel scales line and page turns to pixels and clamps them; a drag released off the canvas ends at its edge', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c, s } = await ready(srv, { width: 1200, height: 500 });
  try {
    const a = pt(s, 0.5, 0.5);
    const wheel = (dy, mode) => p.ev(`document.getElementById('screen').dispatchEvent(new WheelEvent('wheel', { deltaY: ${dy}, deltaMode: ${mode}, clientX: ${a.x}, clientY: ${a.y}, bubbles: true, cancelable: true }))`);
    for (const [dy, mode, want] of [[3, 1, 48], [1, 2, 200], [1e6, 0, 100000], [-1e6, 0, -100000]]) {
      const got = await sent(c, () => wheel(dy, mode), 200);
      assert.deepEqual(got.map((m) => [m.t, m.dy]), [['wheel', want]], `deltaY ${dy} in mode ${mode}`);
    }
    assert.ok(s.left > 60, 'the canvas has room beside it in a wide window');
    const from = pt(s, 0.8, 0.5);
    const out = { x: s.left + s.width + 40, y: s.top - 30 };
    const got = await sent(c, async () => {
      await mouse(p, 'mouseMoved', from);
      await mouse(p, 'mousePressed', from, { button: 'left', buttons: 1, clickCount: 1 });
      await mouse(p, 'mouseMoved', out, { button: 'left', buttons: 1 });
      await mouse(p, 'mouseReleased', out, { button: 'left', buttons: 0, clickCount: 1 });
    });
    const up = got.at(-1);
    assert.equal(up.type, 'up', JSON.stringify(got));
    assert.deepEqual([up.x, up.y], [320, 0], 'the up, clamped to the frame');
  } finally { await shut(p); await srv.close(); }
});

test('Ctrl+V on a non-Latin layout still pastes; a Cmd chord whose keyup never comes gets its up when Cmd goes', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c } = await ready(srv);
  try {
    await clip(p, srv, 'привет');
    let got = await sent(c, async () => {
      await p.hold('Control', true);
      await keyEvent(p, 'rawKeyDown', 'м', 'KeyV', { windowsVirtualKeyCode: 86, modifiers: 2, commands: ['paste'] });
      await keyEvent(p, 'keyUp', 'м', 'KeyV', { windowsVirtualKeyCode: 86, modifiers: 2 });
      await p.hold('Control', false);
    });
    assert.deepEqual(got, [{ t: 'paste', text: 'привет' }], 'the paste, and no key for it');
    // macOS sends no keyup for a key pressed while Cmd is held
    got = await sent(c, async () => {
      await keyEvent(p, 'rawKeyDown', 'Meta', 'MetaLeft', { windowsVirtualKeyCode: 91, modifiers: 4 });
      await keyEvent(p, 'rawKeyDown', 'a', 'KeyA', { windowsVirtualKeyCode: 65, modifiers: 4 });
      await keyEvent(p, 'keyUp', 'Meta', 'MetaLeft', { windowsVirtualKeyCode: 91 });
    });
    assert.deepEqual(got, [{ t: 'key', type: 'down', key: 'a', code: 'KeyA', mods: 4 }, { t: 'key', type: 'up', key: 'a', code: 'KeyA' }]);
  } finally { await shut(p); await srv.close(); }
});
