import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { request, startCanvasFake } from './canvas-fake.mjs';
import { startPresenceFake } from './presence-fake.mjs';
import { cleanup, openChrome } from './chrome.mjs';
import { until } from './kit.mjs';

// The harness test/canvas-cursors*.test.mjs share, moved verbatim from test/canvas-cursors.test.mjs (kit-224).

export const here = path.dirname(fileURLToPath(import.meta.url));

export const PAGE_FILE = path.join(here, '..', '..', 'docs', 'devteam', 'apps', 'dashboard', 'view', 'canvas', 'index.html');
export const APP = path.join(here, '..', '..', 'docs', 'devteam', 'apps', 'dashboard');

// ---- the canvas ----

// Three fixed-size frames placed by x, y on p-main (content bounds -200..800 x -200..540, so after a
// 1000 x 700 page's fit and two zoom-ins every frame and the empty point (360, 100) stay on its stage),
// one on p-two, none on p-empty.
export const frame = (parent, name, x, y, w, h, fill) => ({ type: 'frame', parent, name, x, y, size: { w, h }, fill, children: [] });

export const CANVAS = {
  canvas: 1,
  rev: 0,
  tokens: {},
  pages: [
    { id: 'p-main', name: 'Main', children: ['n-card', 'n-side', 'n-foot'] },
    { id: 'p-two', name: 'Two', children: ['n-two'] },
    { id: 'p-empty', name: 'Empty', children: [] },
  ],
  nodes: {
    'n-card': frame('p-main', 'Card', 0, 0, 320, 200, '#dbe4ff'),
    'n-side': frame('p-main', 'Side', 400, 0, 200, 300, '#d3f9d8'),
    'n-foot': frame('p-main', 'Foot', 0, 260, 320, 80, '#fff3bf'),
    'n-two': frame('p-two', 'Two', 0, 0, 200, 200, '#ffe3e3'),
  },
};

export const SLUG = 'cursors';

// The page, read once (on the first request for it): a missing file is a 404, as an unknown path is.
export let pageHtml = null;

export function serve(req, res) {
  const raw = req.url.split('?')[0];
  if (req.method === 'GET' && raw.startsWith('/view/canvas/')) {
    if (pageHtml === null) { try { pageHtml = fs.readFileSync(PAGE_FILE); } catch { pageHtml = null; } }
    if (pageHtml !== null) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': pageHtml.length });
      res.end(pageHtml);
      return;
    }
  }
  // the export's own files (/_next/* and the rest), GET or HEAD, of a known type; never anything outside
  // the build: the decoded path must resolve under it, hold no NUL, and be a regular file (not a link)
  const TYPES = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', html: 'text/html; charset=utf-8', json: 'application/json', txt: 'text/plain; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon', woff2: 'font/woff2' };
  if (req.method === 'GET' || req.method === 'HEAD') {
    let p = null;
    try { p = decodeURIComponent(raw); } catch { p = null; }
    const type = p === null ? undefined : TYPES[path.extname(p).slice(1)];
    if (p !== null && !p.includes('\0') && type) {
      const file = path.resolve(APP, `.${p}`);
      let body = null;
      try {
        const real = fs.realpathSync(APP);
        if (file.startsWith(APP + path.sep) && fs.lstatSync(file).isFile() && fs.realpathSync(file).startsWith(real + path.sep)) body = fs.readFileSync(file);
      } catch { body = null; }
      if (body !== null) {
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
    }
  }
  res.writeHead(404, { 'Content-Length': 0 });
  res.end();
}

// ---- the fronts (the gateway's part) ----

// A front for one person: every plain request to the canvas fake, `/presence` upgrades to the
// presence fake and every other upgrade to the canvas fake; Host (and Origin, when sent) rewritten to
// the target's, any person or level header dropped and the person's set. `drop()` ends every open
// presence connection on both sides, as a dropped network would; `dropCanvas()` every canvas one.
export async function front(canvasPort, presencePort, person) {
  const headersFor = (raw, port) => {
    const out = [];
    for (let i = 0; i < raw.length; i += 2) {
      const k = raw[i].toLowerCase();
      if (k === 'host' || k === 'x-devteam-person' || k === 'x-devteam-level') continue;
      out.push([raw[i], k === 'origin' ? `http://127.0.0.1:${port}` : raw[i + 1]]);
    }
    return [['Host', `127.0.0.1:${port}`], ...out, ['x-devteam-person', person]];
  };
  const presence = new Set(); // [browser socket, upstream socket]
  const canvasSocks = new Set(); // the same, for canvas sockets
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const headers = {};
    for (const [k, v] of headersFor(req.rawHeaders, canvasPort)) headers[k] = v;
    const up = http.request({ host: '127.0.0.1', port: canvasPort, method: req.method, path: req.url, headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('error', () => { try { res.writeHead(502); res.end(); } catch { /* gone */ } });
    req.pipe(up);
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  server.on('upgrade', (req, socket, head) => {
    const isPresence = req.url.split('?')[0] === '/presence';
    const port = isPresence ? presencePort : canvasPort;
    const lines = [`${req.method} ${req.url} HTTP/1.1`, ...headersFor(req.rawHeaders, port).map(([k, v]) => `${k}: ${v}`), '', ''];
    const up = net.connect({ host: '127.0.0.1', port }, () => {
      up.write(lines.join('\r\n'));
      if (head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    const pair = [socket, up];
    (isPresence ? presence : canvasSocks).add(pair);
    const end = () => { presence.delete(pair); canvasSocks.delete(pair); socket.destroy(); up.destroy(); };
    up.on('error', end);
    socket.on('error', end);
    up.on('close', end);
    socket.on('close', end);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}`,
    drop() { const n = presence.size; for (const [a, b] of [...presence]) { a.destroy(); b.destroy(); } presence.clear(); return n; },
    // A server-to-browser text frame written onto every open presence connection, as if the presence
    // server had sent it (unmasked; up to 65535 bytes).
    inject(text) {
      const p = Buffer.from(text);
      const head = p.length < 126 ? Buffer.from([0x81, p.length]) : Buffer.from([0x81, 126, p.length >> 8, p.length & 255]);
      for (const [a] of presence) a.write(Buffer.concat([head, p]));
      return presence.size;
    },
    dropCanvas() { const n = canvasSocks.size; for (const [a, b] of [...canvasSocks]) { a.destroy(); b.destroy(); } canvasSocks.clear(); return n; },
    close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  };
}

// ---- Chrome: two windows ----

export const DOM_GONE = /navigated or closed|Cannot find context|context was destroyed|Execution context|Inspected target navigated/i;

export const KEYS = { Escape: 27, ' ': 32, Shift: 16 };

export const CODES = { ' ': 'Space', Shift: 'ShiftLeft', Escape: 'Escape' };

// A DevTools connection: send(method, params) → result, `on(handler)` for its events.
export async function devtools(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error(`could not reach ${url}`)); });
  let seq = 0;
  const waiting = new Map();
  const handlers = [];
  ws.onmessage = (m) => {
    const o = JSON.parse(m.data);
    if (o.id !== undefined) {
      const w = waiting.get(o.id);
      if (!w) return;
      waiting.delete(o.id);
      if (o.error) w.reject(new Error(`${w.method}: ${o.error.message}`)); else w.resolve(o.result);
      return;
    }
    for (const h of handlers) h(o);
  };
  ws.onclose = () => { for (const [id, w] of waiting) { waiting.delete(id); w.reject(new Error(`${w.method}: connection closed`)); } };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`${method}: no answer in 30 s`)); }, 30000);
    timer.unref();
    waiting.set(id, { method, resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { send, on: (h) => handlers.push(h), close: () => ws.close() };
}

// One page: its DevTools connection, the recorder on it, and the input helpers. The recorder (kit-669's,
// extended): Fetch for every URL (same-origin continued, held when `hold(url)` says so, others
// failed), exceptions and dialogs, and every WebSocket frame both ways, told apart by its socket:
// `sent` / `got` on the canvas socket, `psent` / `pgot` on the presence socket, each entry
// `{ m, n, at, ts }` (the parsed message, a page-wide order number, Date.now() here, and the
// browser's own frame time in seconds).
export async function pageClient(dt, origin) {
  let order = 0;
  const sockUrl = new Map();
  const rec = { requests: [], exceptions: [], dialogs: [], sent: [], got: [], psent: [], pgot: [], hold: null, held: [], heldUrl: new Map() };
  const quiet = (method, params) => { dt.send(method, params).catch(() => {}); };
  rec.release = () => { for (const requestId of rec.held.splice(0)) quiet('Fetch.continueRequest', { requestId }); };
  const frame = (r) => {
    if (!r || r.opcode !== 1) return null;
    try { return JSON.parse(r.payloadData); } catch { return { unparsed: r.payloadData }; }
  };
  const kindOf = (requestId) => {
    const u = sockUrl.get(requestId) || '';
    return /\/presence(\?|$)/.test(u) ? 'presence' : /\/canvas(\?|$)/.test(u) ? 'canvas' : null;
  };
  dt.on((o) => {
    if (o.method === 'Fetch.requestPaused') {
      const { requestId, request } = o.params;
      const url = request.url;
      rec.requests.push(url);
      const mine = url === origin || url.startsWith(`${origin}/`);
      if (mine && rec.hold && rec.hold(url)) { rec.held.push(requestId); rec.heldUrl.set(requestId, url); }
      else if (mine) quiet('Fetch.continueRequest', { requestId });
      else quiet('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    } else if (o.method === 'Network.webSocketCreated') {
      sockUrl.set(o.params.requestId, o.params.url);
    } else if (o.method === 'Network.webSocketFrameSent' || o.method === 'Network.webSocketFrameReceived') {
      const m = frame(o.params.response);
      const kind = kindOf(o.params.requestId);
      if (!m || !kind) return;
      const sent = o.method === 'Network.webSocketFrameSent';
      const list = kind === 'canvas' ? (sent ? rec.sent : rec.got) : (sent ? rec.psent : rec.pgot);
      list.push({ m, n: ++order, at: Date.now(), ts: o.params.timestamp });
    } else if (o.method === 'Page.javascriptDialogOpening') {
      rec.dialogs.push(o.params);
      quiet('Page.handleJavaScriptDialog', { accept: false });
    } else if (o.method === 'Runtime.exceptionThrown') {
      rec.exceptions.push(o.params.exceptionDetails);
    }
  });
  rec.order = () => order;
  await dt.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await dt.send('Network.enable');
  await dt.send('Page.enable');
  await dt.send('Runtime.enable');
  const send = dt.send;
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${expression}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const evNav = (expr) => ev(expr).catch((e) => { if (DOM_GONE.test(e.message)) return false; throw e; });
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  const move = (x, y, modifiers = 0) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers });
  const clickAt = async (x, y, modifiers = 0) => {
    await move(x, y, modifiers);
    await mouse('mousePressed', x, y, { modifiers });
    await mouse('mouseReleased', x, y, { modifiers });
  };
  const centre = (selector) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const click = async (selector, modifiers = 0) => {
    const at = await centre(selector);
    assert.ok(at, `${selector} is on the page`);
    await clickAt(at.x, at.y, modifiers);
  };
  const keyEvent = (type, k, modifiers = 0) => send('Input.dispatchKeyEvent', { type, key: k, code: CODES[k] ?? k, windowsVirtualKeyCode: KEYS[k] ?? 0, modifiers });
  const key = async (k) => { await keyEvent('rawKeyDown', k); await keyEvent('keyUp', k); };
  const shiftClick = async (selector) => { await keyEvent('rawKeyDown', 'Shift', 8); await click(selector, 8); await keyEvent('keyUp', 'Shift'); };
  // A left drag from `a` by (dx, dy) in four steps; with `space`, Space is held through it (a pan).
  const drag = async (a, dx, dy, { space = false } = {}) => {
    // Space pans only when no button has focus (a Zoom in click leaves it on the button)
    if (space) await ev('document.activeElement && document.activeElement.blur && document.activeElement.blur()');
    await move(a.x, a.y);
    if (space) await keyEvent('keyDown', ' ');
    await mouse('mousePressed', a.x, a.y);
    for (let i = 1; i <= 4; i++) await mouse('mouseMoved', a.x + (dx * i) / 4, a.y + (dy * i) / 4);
    await mouse('mouseReleased', a.x + dx, a.y + dy);
    if (space) await keyEvent('keyUp', ' ');
  };
  const size = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  const load = async (where) => {
    const url = `${origin}${where}`;
    await send('Page.navigate', { url });
    await until(() => evNav(`location.href === ${JSON.stringify(url)} && ['ready', 'error'].includes(document.body && document.body.dataset.state)`), `${where} ready or showing an error`);
  };
  return { rec, send, ev, move, mouse, clickAt, click, shiftClick, key, keyEvent, drag, size, load, origin };
}

// Both fakes, two fronts, one Chrome with two windows (B's first, then A's, so a tab opened later lands
// in A's window and hides A), each page sized and loaded at `/view/canvas/<slug>` and live.
// `presenceClock` 'manual' puts the presence fake on its manual clock; `within` then ticks it 250 ms
// between polls (the people window), and `ptick(ms)` moves it further.
export async function twoPages(t, { canvases = { [SLUG]: CANVAS }, slug = SLUG, sizeA = [1440, 900], sizeB = [1000, 700], presenceClock = 'real', serve: page = serve } = {}) {
  const later = cleanup(t);
  const fake = await startCanvasFake({ canvases, serve: page });
  later(() => fake.close());
  const pfake = await startPresenceFake({ clock: presenceClock });
  later(() => pfake.close());
  const fa = await front(fake.port, pfake.port, 'ana;name=Ana');
  later(() => fa.close());
  const fb = await front(fake.port, pfake.port, 'ben;name=Ben');
  later(() => fb.close());
  const chrome = await openChrome();
  later(() => chrome.close());
  const dir = chrome.proc.spawnargs.find((a) => a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
  const portFile = path.join(dir, 'DevToolsActivePort');
  await until(() => fs.existsSync(portFile) && /^\d+\n/.test(fs.readFileSync(portFile, 'utf8')), 'DevToolsActivePort');
  const dport = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const version = await (await fetch(`http://127.0.0.1:${dport}/json/version`)).json();
  const browser = await devtools(version.webSocketDebuggerUrl);
  later(() => browser.close());
  const pageOf = async (origin, [w, h]) => {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', newWindow: true });
    const list = await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json();
    const target = list.find((x) => x.id === targetId);
    assert.ok(target, 'the new window in /json/list');
    const dt = await devtools(target.webSocketDebuggerUrl);
    later(() => dt.close());
    const p = await pageClient(dt, origin);
    await send(p, 'Emulation.setScrollbarsHidden', { hidden: true });
    await p.size(w, h);
    return p;
  };
  const send = (p, m, params) => p.send(m, params);
  const B = await pageOf(fb.url, sizeB);
  const A = await pageOf(fa.url, sizeA);
  await A.load(`/view/canvas/${slug}`);
  await B.load(`/view/canvas/${slug}`);
  const ptick = async (ms) => { if (presenceClock === 'manual') await pfake.tick(ms); };
  const ctx = { A, B, fake, pfake, fa, fb, browser, ptick, manual: presenceClock === 'manual', later };
  await live(ctx, A);
  await live(ctx, B);
  // A tab opened now lands in the newest window, A's: it hides A until it is closed.
  let hider = null;
  ctx.hideA = async () => { hider = (await browser.send('Target.createTarget', { url: 'about:blank', newWindow: false })).targetId; };
  ctx.showA = async () => { if (hider) await browser.send('Target.closeTarget', { targetId: hider }); hider = null; };
  return ctx;
}

// ---- waiting and reading ----

// `until` with a shorter bound, and what was last seen (`why()`) in its failure; on the manual clock
// each poll also moves the presence fake 250 ms (its people window).
export async function within(ctx, f, what, why = async () => '', ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await f()) return;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what} (${await why()})`);
    if (ctx.manual) await ctx.ptick(250);
    await sleep(50);
  }
}

export const body = (p, key) => p.ev(`document.body.dataset[${JSON.stringify(key)}] ?? null`);

export const live = (ctx, p) => within(ctx, async () => (await body(p, 'live')) === 'on', 'data-live on', async () => `data-live ${await body(p, 'live')}`);

export const noExceptions = (p, what) => assert.deepEqual(p.rec.exceptions.map((e) => e.exception?.description ?? e.text), [], `${what}: no exception`);

export const after = (list, n0) => list.filter((f) => f.n > n0);

export const ofKind = (list, t) => list.filter((f) => f.m && f.m.t === t);

// The page's zoom and the surface's top-left on screen: page px (x, y) is at left + x * z, top + y * z.
export const view = (p) => p.ev("(() => { const s = document.getElementById('surface'); const m = new DOMMatrix(getComputedStyle(s).transform); const r = s.getBoundingClientRect(); return { z: m.a, tx: m.e, ty: m.f, left: r.left, top: r.top }; })()");

export const screenOf = async (p, x, y) => { const v = await view(p); return { x: v.left + x * v.z, y: v.top + y * v.z }; };

// Others' boxes on a page: selection boxes (.others-sel) or last-edit marks (.flash) of a person, each
// with its node, its box on screen and its tag's text (null when it has none).
export const boxesOf = (p, cls, person) => p.ev(`[...document.querySelectorAll('#others .${cls}[data-person="${person}"]')].filter((e) => e.getClientRects().length > 0).map((e) => {
  const r = e.getBoundingClientRect();
  return { node: e.dataset.node, l: r.left, t: r.top, w: r.width, h: r.height, tag: e.querySelector('.tag')?.textContent ?? null };
})`);

// The receiving page's last `people` puts `id` on its own spot (its last `here`'s page, tab, peek and
// art), visible: a move from that person is drawn only then (spec §3).
export const SPOT = ['page', 'tab', 'peek', 'art'];

export async function waitSpot(ctx, p, id, what) {
  const ok = () => {
    const mine = ofKind(p.rec.psent, 'here').at(-1);
    // only a people that came after that here (an older one may be from before a reconnect)
    const people = mine ? ofKind(after(p.rec.pgot, mine.n), 'people').at(-1) : null;
    if (!mine || !people) return false;
    const e = people.m.people.find((x) => x.id === id);
    return !!e && e.conns.some((c) => c.visible === true && SPOT.every((k) => c.at[k] === mine.m.at[k]));
  };
  await within(ctx, async () => ok(), `${what}: ${id} on the page's spot`, async () => JSON.stringify(ofKind(p.rec.pgot, 'people').at(-1)?.m ?? null));
}

// A drawn node's box on screen.
export const nodeBox = (p, id) => p.ev(`(() => { const e = document.querySelector('#surface [data-id="${id}"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);

// A person's shown cursor on a page: its tip, anchor and name; null when there is none or it is hidden.
export const cursorOf = (p, person) => p.ev(`(() => {
  const c = [...document.querySelectorAll('#others .cursor[data-person="${person}"]')].find((e) => e.getClientRects().length > 0);
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { x: r.left, y: r.top, k: c.dataset.k, name: c.querySelector('.cursor-name')?.textContent ?? null };
})()`);

export const cursorCount = (p, person) => p.ev(`[...document.querySelectorAll('#others .cursor[data-person="${person}"]')].filter((e) => e.getClientRects().length > 0).length`);

export const at = (box, fx, fy) => ({ x: box.l + fx * box.w, y: box.t + fy * box.h });

// The person's cursor on `p` anchored to `k`, its tip within 2 px of `want` (a function, read afresh).
export async function cursorAt(ctx, p, person, k, want, what, ms = 10000) {
  let last = null;
  let w = null;
  await within(ctx, async () => {
    last = await cursorOf(p, person);
    w = await want();
    return !!last && last.k === k && Math.abs(last.x - w.x) <= 2 && Math.abs(last.y - w.y) <= 2;
  }, what, async () => `cursor ${JSON.stringify(last)}, want ${k} at ${JSON.stringify(w)}; presence got ${JSON.stringify(p.rec.pgot.slice(-3).map((f) => f.m))}`, ms);
  return last;
}

// A point at the fraction (fx, fy) of a node's box on screen, in whole px, and its fraction as rounded.
export async function pointOn(p, id, fx, fy) {
  const b = await nodeBox(p, id);
  assert.ok(b, `${id} drawn`);
  const pt = { x: Math.round(b.l + fx * b.w), y: Math.round(b.t + fy * b.h) };
  return { pt, fx: (pt.x - b.l) / b.w, fy: (pt.y - b.t) / b.h };
}

// The C1.11 spy (ruling m-20261121-105758692): on every new document of the page it is added to, it wraps
// window.setTimeout; a call asking for exactly 60000 ms (canvas.html's HIDDEN_MS) is recorded in
// window.hiddenAsked and runs after 5000 ms instead. Every other call is untouched.
export const HIDDEN_SPY = "(() => { const st = window.setTimeout; window.hiddenAsked = []; window.setTimeout = function (f, ms, ...a) { if (ms === 60000) { window.hiddenAsked.push(ms); ms = 5000; } return st.call(this, f, ms, ...a); }; })()";
