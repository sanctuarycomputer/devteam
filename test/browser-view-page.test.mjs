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
  const srv = http.createServer((q, s) => {
    if (q.url === '/') { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return s.end(page()); }
    others++;
    s.writeHead(404); s.end();
  });
  srv.on('upgrade', (q, sock) => {
    sock.on('error', () => {});
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
    port, conns,
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
    await noHandBack(p);
  } finally { p.close(); await srv.close(); }
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
  } finally { p.close(); await srv.close(); }
});

test('the canvas fits the window, up and down', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  try {
    let p = await open(srv, { width: 700, height: 700 });
    await srv.waitConn(1);
    srv.last().send(BIG);
    let s = await drawn(p, 320, 200);
    assert.ok(s.width > 320, `a 320 px frame is scaled up in a 700 px window (shown ${s.width} px)`);
    assert.ok(Math.abs(s.width / s.height - 1.6) < 0.016, 'aspect kept');
    p.close();
    p = await open(srv, { width: 1200, height: 500 });
    await srv.waitConn(2);
    srv.last().send(BIG);
    s = await drawn(p, 320, 200);
    assert.ok(s.bottom <= s.vh, `the whole frame is on screen in a wide, short window (bottom ${s.bottom} of ${s.vh})`);
    assert.ok(Math.abs(s.width / s.height - 1.6) < 0.016, 'aspect kept');
    const foot = await p.ev(`document.getElementById('foot').getBoundingClientRect().bottom`);
    assert.ok(foot <= s.vh, 'and the foot line too');
    p.close();
  } finally { await srv.close(); }
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
  } finally { p.close(); other.close(); await srv.close(); }
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
    await srv.waitConn(2, 3000);
    await until(async () => (await text(p, 'chip')) === 'Live', 'Live again');
    srv.last().send({ ...SMALL, seq: 0 });
    await drawn(p, 160, 100); // the count starts again on a new socket
  } finally { p.close(); await srv.close(); }
});
