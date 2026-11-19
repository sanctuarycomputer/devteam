// Others on a canvas (kit-663, docs/devteam/dashboard/canvas.html): their named cursors, anchored to
// layers or to a fraction of the page's content bounds (presence@1, canvas@1 §9), their selections
// (canvas@1 §5 `selections`) and a 3 s mark on what their last edit changed; and a `select` that waits
// for a document fetch (kit-669 final-1 F2). In headless Chrome against both fakes
// (test/lib/canvas-fake.mjs, test/lib/presence-fake.mjs).
//
// Two people at once: one Chrome, two windows (Target.createTarget with newWindow, so both pages are
// visible; two tabs of one window aren't), each page on its own front origin, which stands in for the
// gateway: it forwards plain requests and `/canvas` upgrades to the canvas fake and `/presence`
// upgrades to the presence fake, with Host and Origin rewritten to the target's and the person's
// `x-devteam-person` header set, so Ana and Ben are two people to both fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { request, startCanvasFake, shapeErrors as canvasShape } from './lib/canvas-fake.mjs';
import { hashPart, startPresenceFake, shapeErrors as presenceShape } from './lib/presence-fake.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { until } from './lib/kit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE_FILE = path.join(here, '..', 'docs', 'devteam', 'dashboard', 'canvas.html');

// ---- the canvas ----

// Three fixed-size frames placed by x, y on p-main (content bounds -200..800 x -200..540, so after a
// 1000 x 700 page's fit and two zoom-ins every frame and the empty point (360, 100) stay on its stage),
// one on p-two, none on p-empty.
const frame = (parent, name, x, y, w, h, fill) => ({ type: 'frame', parent, name, x, y, size: { w, h }, fill, children: [] });
const CANVAS = {
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
const SLUG = 'cursors';
const LONG_SLUG = `long-${'a'.repeat(115)}`; // 120 characters: `<slug>@canvas` passes presence's 120

// The page, read once (on the first request for it): a missing file is a 404, as an unknown path is.
let pageHtml = null;
function serve(req, res) {
  const raw = req.url.split('?')[0];
  if (req.method === 'GET' && raw.startsWith('/view/canvas/')) {
    if (pageHtml === null) { try { pageHtml = fs.readFileSync(PAGE_FILE); } catch { pageHtml = null; } }
    if (pageHtml !== null) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': pageHtml.length });
      res.end(pageHtml);
      return;
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
async function front(canvasPort, presencePort, person) {
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

const DOM_GONE = /navigated or closed|Cannot find context|context was destroyed|Execution context|Inspected target navigated/i;
const KEYS = { Escape: 27, ' ': 32, Shift: 16 };
const CODES = { ' ': 'Space', Shift: 'ShiftLeft', Escape: 'Escape' };

// A DevTools connection: send(method, params) → result, `on(handler)` for its events.
async function devtools(url) {
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
async function pageClient(dt, origin) {
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
async function twoPages(t, { canvases = { [SLUG]: CANVAS }, slug = SLUG, sizeA = [1440, 900], sizeB = [1000, 700], presenceClock = 'real' } = {}) {
  const later = cleanup(t);
  const fake = await startCanvasFake({ canvases, serve });
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
async function within(ctx, f, what, why = async () => '', ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await f()) return;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what} (${await why()})`);
    if (ctx.manual) await ctx.ptick(250);
    await sleep(50);
  }
}
const body = (p, key) => p.ev(`document.body.dataset[${JSON.stringify(key)}] ?? null`);
const live = (ctx, p) => within(ctx, async () => (await body(p, 'live')) === 'on', 'data-live on', async () => `data-live ${await body(p, 'live')}`);
const noExceptions = (p, what) => assert.deepEqual(p.rec.exceptions.map((e) => e.exception?.description ?? e.text), [], `${what}: no exception`);
const after = (list, n0) => list.filter((f) => f.n > n0);
const ofKind = (list, t) => list.filter((f) => f.m && f.m.t === t);
// The page's zoom and the surface's top-left on screen: page px (x, y) is at left + x * z, top + y * z.
const view = (p) => p.ev("(() => { const s = document.getElementById('surface'); const m = new DOMMatrix(getComputedStyle(s).transform); const r = s.getBoundingClientRect(); return { z: m.a, tx: m.e, ty: m.f, left: r.left, top: r.top }; })()");
const screenOf = async (p, x, y) => { const v = await view(p); return { x: v.left + x * v.z, y: v.top + y * v.z }; };

// The first edit the page sent after order n0 holding an `add` of a new node, and its ack.
async function addAfter(ctx, p, n0, what, id = null) {
  const find = () => ofKind(after(p.rec.sent, n0), 'edit').find((f) => f.m.ops.some((o) => o.op === 'add' && (id === null || o.node.id === id)));
  await within(ctx, async () => !!find(), `${what}: the add`, async () => JSON.stringify(p.rec.sent.slice(-4).map((f) => f.m)));
  const e = find();
  const ackFind = () => ofKind(p.rec.got, 'ops').find((f) => f.n > e.n && f.m.ack && f.m.ack.client === e.m.client && f.m.ack.seq === e.m.seq);
  await within(ctx, async () => !!ackFind(), `${what}: the add's ack`, async () => JSON.stringify(p.rec.got.slice(-4).map((f) => f.m)));
  return { edit: e, ack: ackFind(), id: e.m.ops.find((o) => o.op === 'add').node.id };
}
// A rect drawn with the Rectangle tool from page px (x, y), 40 screen px square; its add and ack.
async function drawRect(ctx, p, x, y, what) {
  const n0 = p.rec.order();
  await p.click('#tools button[data-tool="rect"]');
  const at = await screenOf(p, x, y);
  await p.drag(at, 40, 40);
  return addAfter(ctx, p, n0, what);
}
// The `selections` frames a page got after order n0, as Ana's ids in each (null where she isn't listed).
const anaSelections = (p, n0, id = 'ana') => ofKind(after(p.rec.got, n0), 'selections').map((f) => {
  const e = f.m.people.find((x) => x.id === id);
  return e ? e.ids : null;
});

// Others' boxes on a page: selection boxes (.others-sel) or last-edit marks (.flash) of a person, each
// with its node, its box on screen and its tag's text (null when it has none).
const boxesOf = (p, cls, person) => p.ev(`[...document.querySelectorAll('#others .${cls}[data-person="${person}"]')].filter((e) => e.getClientRects().length > 0).map((e) => {
  const r = e.getBoundingClientRect();
  return { node: e.dataset.node, l: r.left, t: r.top, w: r.width, h: r.height, tag: e.querySelector('.tag')?.textContent ?? null };
})`);
const allBoxes = (p, cls) => p.ev(`[...document.querySelectorAll('#others .${cls}')].filter((e) => e.getClientRects().length > 0).map((e) => ({ person: e.dataset.person, node: e.dataset.node }))`);
// A selection box sits 2 px outside its node's drawn box (within 1 px).
async function boxAround(p, b, grow = 2) {
  const n = await nodeBox(p, b.node);
  return !!n && Math.abs(b.l - (n.l - grow)) <= 1 && Math.abs(b.t - (n.t - grow)) <= 1 && Math.abs(b.w - (n.w + 2 * grow)) <= 1 && Math.abs(b.h - (n.h + 2 * grow)) <= 1;
}
// A node's name changed in the Properties panel: its row selected, the Name field's text replaced, Enter.
async function rename(p, id, value) {
  await p.click(`#layers .layer[data-node="${id}"]`);
  const ok = await p.ev(`(() => { const e = document.querySelector('#props [data-prop="name"]'); if (!e) return false; e.focus(); e.select(); return document.activeElement === e; })()`);
  assert.equal(ok, true, 'the Name field focused');
  await p.send('Input.insertText', { text: value });
  const k = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k, text: '\r', unmodifiedText: '\r' });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
}
// The first ops frame a page got after order n0 whose by is `id`.
async function opsBy(ctx, p, n0, id, what) {
  const find = () => ofKind(after(p.rec.got, n0), 'ops').find((f) => f.m.by && f.m.by.id === id);
  await within(ctx, async () => !!find(), what, async () => JSON.stringify(after(p.rec.got, n0).map((f) => f.m.t)));
  return find();
}
// Polls until `f()` is false; the time (Date.now()) it was first seen false.
async function goneAt(ctx, f, what, ms = 8000) {
  const end = Date.now() + ms;
  while (await f()) {
    if (Date.now() > end) assert.fail(`timed out waiting for ${what} to go`);
    await sleep(25);
  }
  return Date.now();
}

// ---- kit-669 F2: a select waits for a document fetch (spec §6, S6.1, S6.2) ----

test('canvas cursors: a select made while the document is fetched after a restart or a reload waits for the fetch and the re-sent edits', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 240000 }, async (t) => {
  const ctx = await twoPages(t);
  const { A, B, fake } = ctx;
  // S6.1: an unsaved X selected, then the server restarts without it
  fake.pause(SLUG);
  const x = await drawRect(ctx, A, 340, 20, 'X');
  await within(ctx, async () => ofKind(A.rec.sent, 'select').some((f) => f.m.ids.length === 1 && f.m.ids[0] === x.id), "X's select");
  A.rec.hold = (url) => url.includes('/api/canvas/doc?');
  const r0 = A.rec.order();
  const b0 = B.rec.order();
  fake.restart(SLUG);
  await within(ctx, async () => A.rec.held.length > 0, "A's document fetch after the restart, held", async () => `requests ${A.rec.requests.slice(-3).join(' ')}`);
  await A.shiftClick('#layers .layer[data-node="n-card"]');
  await within(ctx, async () => (await A.ev('[...document.querySelectorAll(\'#layers .layer[aria-selected="true"]\')].map((r) => r.dataset.node).join(" ")')).split(' ').length === 2, 'A has two layers selected');
  // the new socket's welcome came (a select it would send goes at once), and a select window passed
  await within(ctx, async () => ofKind(after(A.rec.got, r0), 'welcome').length > 0, "A's welcome after the restart");
  await sleep(400);
  assert.deepEqual(ofKind(after(A.rec.sent, r0), 'select').map((f) => f.m), [], 'no select while the document is fetched');
  A.rec.hold = null;
  A.rec.release();
  const again = await addAfter(ctx, A, r0, "X's add re-sent", x.id);
  await within(ctx, async () => ofKind(after(A.rec.sent, r0), 'select').length > 0, 'a select after the fetch');
  const sel = ofKind(after(A.rec.sent, r0), 'select')[0];
  assert.ok(sel.n > again.ack.n, `the first select after the restart (${sel.n}) comes after X's ack (${again.ack.n})`);
  assert.deepEqual([...sel.m.ids].sort(), [x.id, 'n-card'].sort(), 'it names X and n-card');
  await within(ctx, async () => anaSelections(B, b0).some((ids) => ids && ids.includes(x.id) && ids.includes('n-card')), "B's selections list Ana with X and n-card", async () => JSON.stringify(anaSelections(B, b0)));
  await within(ctx, async () => { const n = (await boxesOf(B, 'others-sel', 'ana')).map((b) => b.node).sort(); return n.join(' ') === [x.id, 'n-card'].sort().join(' '); }, "B draws Ana's boxes on X and n-card", async () => JSON.stringify(await boxesOf(B, 'others-sel', 'ana')));

  // S6.2: X saved; a new unsaved X2 selected alone; the canvas replaced without X2 (a reload)
  fake.resume(SLUG);
  await within(ctx, async () => (await body(A, 'kept')) === '0', "A's kept edits saved");
  fake.pause(SLUG);
  const x2 = await drawRect(ctx, A, 340, 220, 'X2');
  await within(ctx, async () => ofKind(A.rec.sent, 'select').some((f) => f.m.ids.length === 1 && f.m.ids[0] === x2.id), "X2's select");
  await within(ctx, async () => (await body(A, 'pending')) === '0', "A's pending empty");
  const doc = fake.doc(SLUG);
  delete doc.nodes[x2.id];
  for (const pg of doc.pages) pg.children = pg.children.filter((c) => c !== x2.id);
  const r1 = A.rec.order();
  const b1 = B.rec.order();
  fake.replace(SLUG, doc);
  const again2 = await addAfter(ctx, A, r1, "X2's add re-sent", x2.id);
  await within(ctx, async () => ofKind(after(A.rec.sent, again2.ack.n), 'select').length > 0, 'a select after the reload and the ack', async () => JSON.stringify(after(A.rec.sent, r1).map((f) => f.m.t)));
  assert.deepEqual(ofKind(after(A.rec.sent, again2.ack.n), 'select')[0].m.ids, [x2.id], 'the select names X2 again');
  await within(ctx, async () => anaSelections(B, b1).some((ids) => ids && ids.includes(x2.id)), "B's selections after the reload list Ana with X2", async () => JSON.stringify(anaSelections(B, b1)));
  await within(ctx, async () => (await boxesOf(B, 'others-sel', 'ana')).map((b) => b.node).join(' ') === x2.id, "B draws Ana's box on X2", async () => JSON.stringify(await boxesOf(B, 'others-sel', 'ana')));

  // S6.3 (task-1 T1-1, T1-2, task-1-2 F2-1): A's selection cleared while a reload's fetch is held goes
  // out as an empty select once the fetch lands and the re-sent edit X3 is acked, although an empty
  // selection is what the old dedupe took a fresh socket's last select to be; B's selections then list
  // Ana with none
  fake.resume(SLUG);
  await within(ctx, async () => (await body(A, 'kept')) === '0' && (await body(A, 'pending')) === '0', "A's edits all saved");
  fake.pause(SLUG);
  const x3 = await drawRect(ctx, A, 340, 120, 'X3');
  await A.click('#layers .layer[data-node="n-side"]');
  await within(ctx, async () => ofKind(A.rec.sent, 'select').at(-1)?.m.ids.join(' ') === 'n-side', "A's select of n-side");
  const b2 = B.rec.order();
  await within(ctx, async () => anaSelections(B, b2).some((ids) => ids && ids.join(' ') === 'n-side'), "B's selections list Ana with n-side");
  A.rec.hold = (url) => url.includes('/api/canvas/doc?');
  const r2 = A.rec.order();
  const doc3 = fake.doc(SLUG);
  delete doc3.nodes[x3.id];
  for (const pg of doc3.pages) pg.children = pg.children.filter((c) => c !== x3.id);
  fake.replace(SLUG, doc3);
  await within(ctx, async () => A.rec.held.length > 0, "A's document fetch after the reload, held");
  await A.key('Escape');
  await within(ctx, async () => (await A.ev('document.querySelectorAll(\'#layers .layer[aria-selected="true"]\').length')) === 0, 'A has nothing selected');
  await sleep(400);
  assert.deepEqual(ofKind(after(A.rec.sent, r2), 'select').map((f) => f.m), [], 'no select while the document is fetched');
  const b3 = B.rec.order();
  A.rec.hold = null;
  A.rec.release();
  const again3 = await addAfter(ctx, A, r2, "X3's add re-sent", x3.id);
  await within(ctx, async () => ofKind(after(A.rec.sent, r2), 'select').length > 0, 'a select once the fetch lands and X3 is acked');
  assert.deepEqual(ofKind(after(A.rec.sent, r2), 'select').map((f) => f.m.ids), [[]], 'one empty select');
  assert.ok(ofKind(after(A.rec.sent, r2), 'select')[0].n > again3.ack.n, "the select after X3's ack");
  await within(ctx, async () => anaSelections(B, b3).some((ids) => ids && ids.length === 0), "B's selections list Ana with nothing", async () => JSON.stringify(anaSelections(B, b3)));
  await within(ctx, async () => (await boxesOf(B, 'others-sel', 'ana')).length === 0, "B draws no Ana box", async () => JSON.stringify(await boxesOf(B, 'others-sel', 'ana')));
  noExceptions(A, 'A');
  noExceptions(B, 'B');
});

// ---- cursors: helpers ----

// The receiving page's last `people` puts `id` on its own spot (its last `here`'s page, tab, peek and
// art), visible: a move from that person is drawn only then (spec §3).
const SPOT = ['page', 'tab', 'peek', 'art'];
async function waitSpot(ctx, p, id, what) {
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
const nodeBox = (p, id) => p.ev(`(() => { const e = document.querySelector('#surface [data-id="${id}"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
// The page's content bounds on screen, measured here (not by the page): the union of the top-level
// drawn nodes' boxes grown by 200 page px, or the -200..200 square around the surface's origin when
// the page is empty.
const boundsOf = (p) => p.ev(`(() => {
  const s = document.getElementById('surface');
  const z = new DOMMatrix(getComputedStyle(s).transform).a;
  let b = null;
  for (const e of s.children) {
    if (!e.dataset.id || e.getClientRects().length === 0) continue;
    const r = e.getBoundingClientRect();
    b = b === null ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : { l: Math.min(b.l, r.left), t: Math.min(b.t, r.top), r: Math.max(b.r, r.right), b: Math.max(b.b, r.bottom) };
  }
  const o = s.getBoundingClientRect();
  if (b === null) b = { l: o.left, t: o.top, r: o.left, b: o.top };
  return { l: b.l - 200 * z, t: b.t - 200 * z, w: b.r - b.l + 400 * z, h: b.b - b.t + 400 * z };
})()`);
// A person's shown cursor on a page: its tip, anchor and name; null when there is none or it is hidden.
const cursorOf = (p, person) => p.ev(`(() => {
  const c = [...document.querySelectorAll('#others .cursor[data-person="${person}"]')].find((e) => e.getClientRects().length > 0);
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { x: r.left, y: r.top, k: c.dataset.k, name: c.querySelector('.cursor-name')?.textContent ?? null };
})()`);
const cursorCount = (p, person) => p.ev(`[...document.querySelectorAll('#others .cursor[data-person="${person}"]')].filter((e) => e.getClientRects().length > 0).length`);
const at = (box, fx, fy) => ({ x: box.l + fx * box.w, y: box.t + fy * box.h });
// The person's cursor on `p` anchored to `k`, its tip within 2 px of `want` (a function, read afresh).
async function cursorAt(ctx, p, person, k, want, what, ms = 10000) {
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
async function pointOn(p, id, fx, fy) {
  const b = await nodeBox(p, id);
  assert.ok(b, `${id} drawn`);
  const pt = { x: Math.round(b.l + fx * b.w), y: Math.round(b.t + fy * b.h) };
  return { pt, fx: (pt.x - b.l) / b.w, fy: (pt.y - b.t) / b.h };
}
const showPageOf = async (ctx, p, id) => {
  await p.ev(`location.hash = '#page=${id}'`);
  await within(ctx, async () => (await p.ev("document.getElementById('pageSel').value")) === id && (await body(p, 'state')) === 'ready', `page ${id} shown`);
};

// ---- done-when 1: cursors anchored so every screen agrees (spec §2, §3) ----

test("canvas A3: two pages of different sizes and zooms show each other's cursor on the same node and at the same fraction of empty canvas, within 2 px", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 240000 }, async (t) => {
  const ctx = await twoPages(t);
  const { A, B } = ctx;
  const z0 = (await view(B)).z;
  await B.click('#zoomIn');
  await B.click('#zoomIn');
  await within(ctx, async () => Math.abs((await view(B)).z - z0 * 1.5625) < 0.001, "B zoomed in twice");
  assert.notEqual((await view(A)).z.toFixed(3), (await view(B)).z.toFixed(3), 'the two pages at different zooms');
  await waitSpot(ctx, B, 'ana', 'B');
  await waitSpot(ctx, A, 'ben', 'A');

  // C1.1: A's pointer on n-card at (0.3, 0.7)
  const c1 = await pointOn(A, 'n-card', 0.3, 0.7);
  await A.move(c1.pt.x, c1.pt.y);
  const cur = await cursorAt(ctx, B, 'ana', 'n-card', async () => at(await nodeBox(B, 'n-card'), c1.fx, c1.fy), "C1.1: Ana's cursor on B at n-card (0.3, 0.7)");
  assert.equal(cur.name, 'Ana', "the cursor's name");
  // C1.2: B's pointer on n-side at (0.6, 0.25), shown on A
  const c2 = await pointOn(B, 'n-side', 0.6, 0.25);
  await B.move(c2.pt.x, c2.pt.y);
  const curB = await cursorAt(ctx, A, 'ben', 'n-side', async () => at(await nodeBox(A, 'n-side'), c2.fx, c2.fy), "C1.2: Ben's cursor on A at n-side (0.6, 0.25)");
  assert.equal(curB.name, 'Ben');
  // an edit moves n-side (the supervisor's): A redraws and Ben's cursor follows the node (task-2 T2-3)
  const moved = await request(`${ctx.fake.url}/api/canvas/local?slug=${SLUG}`, {
    method: 'POST', headers: { 'x-devteam-canvas-token': ctx.fake.token, 'Content-Type': 'application/json' },
    body: { by: 'supervisor', via: 'apply', ops: [{ op: 'set', id: 'n-side', prop: 'y', value: 30 }] },
  });
  assert.equal(moved.status, 200, "the supervisor's move of n-side");
  await within(ctx, async () => (await A.ev("document.querySelector('#surface [data-id=\"n-side\"]').style.top")) === '30px', 'n-side moved on A');
  // within 1 s: well before the supervisor's 3 s mark ends (its end places cursors again too)
  await cursorAt(ctx, A, 'ben', 'n-side', async () => at(await nodeBox(A, 'n-side'), c2.fx, c2.fy), "Ben's cursor follows n-side after A's redraw", 1000);

  // C1.3: A's pointer on empty canvas at page (360, 100), shown on B at the same fraction of its bounds
  const e = await screenOf(A, 360, 100);
  const pe = { x: Math.round(e.x), y: Math.round(e.y) };
  const ba = await boundsOf(A);
  const fe = { x: (pe.x - ba.l) / ba.w, y: (pe.y - ba.t) / ba.h };
  await A.move(pe.x, pe.y);
  const emptyWant = async () => { const bb = await boundsOf(B); return at(bb, fe.x, fe.y); };
  await cursorAt(ctx, B, 'ana', '@p-main', emptyWant, "C1.3: Ana's cursor on B over empty canvas");
  // C1.4: B pans (Space drag on empty stage): the cursor moves with the canvas
  const v0 = await view(B);
  const grab = await screenOf(B, 360, 420);
  await B.drag({ x: Math.round(grab.x), y: Math.round(grab.y) }, 50, 30, { space: true });
  await within(ctx, async () => { const v = await view(B); return Math.abs(v.tx - v0.tx - 50) < 1 && Math.abs(v.ty - v0.ty - 30) < 1; }, 'B panned by (50, 30)', async () => JSON.stringify(await view(B)));
  await cursorAt(ctx, B, 'ana', '@p-main', emptyWant, "C1.4: Ana's cursor after B's pan");

  // C1.8: 60 moves in about 1 s across n-card: moves at least 60 ms apart, the last position arrives
  const m0 = A.rec.order();
  const box = await nodeBox(A, 'n-card');
  let last = null;
  for (let i = 0; i < 60; i++) {
    last = { x: Math.round(box.l + box.w * (0.1 + 0.8 * (i / 59))), y: Math.round(box.t + box.h * 0.5) };
    await A.move(last.x, last.y);
    await sleep(16);
  }
  // the last move made inside an open 67 ms window (just after a move went), so only the window-end
  // send can deliver it (task-2 T2-1)
  const sentMoves = () => ofKind(A.rec.psent, 'move').length;
  const k0 = sentMoves();
  await A.move(last.x, Math.round(box.t + box.h * 0.3));
  const wEnd = Date.now() + 2000;
  while (sentMoves() === k0 && Date.now() < wEnd) await sleep(2);
  assert.ok(sentMoves() > k0, 'a move went');
  last = { x: Math.round(box.l + box.w * 0.75), y: Math.round(box.t + box.h * 0.8) };
  await A.move(last.x, last.y);
  const lf = { x: (last.x - box.l) / box.w, y: (last.y - box.t) / box.h };
  await cursorAt(ctx, B, 'ana', 'n-card', async () => at(await nodeBox(B, 'n-card'), lf.x, lf.y), "C1.8: Ana's cursor at her last position");
  const moves = ofKind(after(A.rec.psent, m0), 'move');
  assert.ok(moves.length >= 5, `A sent moves (${moves.length})`);
  for (let i = 1; i < moves.length; i++) {
    const gap = (moves[i].ts - moves[i - 1].ts) * 1000;
    assert.ok(gap >= 60, `moves ${i - 1} and ${i} ${gap.toFixed(1)} ms apart`);
  }

  // C1.5: A's pointer leaves the stage: Ana's cursor is gone from B
  const layers = await A.ev("(() => { const r = document.getElementById('layers').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 40 }; })()");
  await A.move(layers.x, layers.y);
  await within(ctx, async () => (await cursorCount(B, 'ana')) === 0, "C1.5: Ana's cursor gone from B", async () => JSON.stringify(await cursorOf(B, 'ana')), 2000);
  assert.ok(ofKind(after(A.rec.psent, m0), 'move').some((f) => f.m.a === null), 'A sent a move with a: null');

  // C1.6: both on the empty page; B zoomed and panned so the two views differ; A's pointer at stage (100, 100)
  await showPageOf(ctx, A, 'p-empty');
  await showPageOf(ctx, B, 'p-empty');
  await B.click('#zoomIn');
  const st = await B.ev("(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
  const vb0 = await view(B);
  await B.drag({ x: Math.round(st.x), y: Math.round(st.y) }, 80, 60, { space: true });
  await within(ctx, async () => { const v = await view(B); return Math.abs(v.tx - vb0.tx - 80) < 1; }, 'B panned on p-empty');
  const va = await view(A);
  const vb = await view(B);
  assert.ok(Math.abs(va.z - vb.z) > 0.01 && Math.abs(va.tx - vb.tx) > 10 && Math.abs(va.ty - vb.ty) > 10, `the views differ: A ${JSON.stringify(va)}, B ${JSON.stringify(vb)}`);
  await waitSpot(ctx, B, 'ana', 'B on p-empty');
  const sa = await A.ev("(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.left + 100, y: r.top + 100 }; })()");
  await A.move(sa.x, sa.y);
  // A's fraction of the -200..200 square, through A's view; B's point at that fraction, through B's
  const f6 = { x: ((sa.x - va.left) / va.z + 200) / 400, y: ((sa.y - va.top) / va.z + 200) / 400 };
  assert.ok(f6.x > 0 && f6.x < 1 && f6.y > 0 && f6.y < 1, `stage (100, 100) inside A's fallback square (${JSON.stringify(f6)})`);
  await cursorAt(ctx, B, 'ana', '@p-empty', async () => { const v = await view(B); return { x: v.left + (-200 + f6.x * 400) * v.z, y: v.top + (-200 + f6.y * 400) * v.z }; }, "C1.6: Ana's cursor on B's empty page");
  noExceptions(A, 'A');
  noExceptions(B, 'B');
});

// ---- the presence duties (spec §1, §3; presence@1 §6–§9) ----

test('canvas cursors: the presence socket answers pings, reconnects when dropped and reports a hidden page', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 360000 }, async (t) => {
  const ctx = await twoPages(t, { presenceClock: 'manual' });
  const { A, B, pfake, fa } = ctx;
  await waitSpot(ctx, A, 'ben', 'A');
  await waitSpot(ctx, B, 'ana', 'B');
  // C1.7: three pings, each answered before the next falls due
  const pongs = () => ofKind(A.rec.psent, 'pong').length;
  const pings = () => ofKind(A.rec.pgot, 'ping').length;
  for (let i = 0; i < 3; i++) {
    const p0 = pongs();
    await ctx.ptick(20000);
    await within(ctx, async () => pongs() === p0 + 1, `C1.7: A's pong ${i + 1}`, async () => `pings ${pings()}, pongs ${pongs()}`);
  }
  assert.ok(pings() >= 3, `A got at least three pings (${pings()})`);
  assert.equal(pongs(), pings(), 'a pong for every ping');
  const mine = pfake.stats().find((s) => s.id === 'ana');
  assert.ok(mine, "A's presence connection still open");
  assert.equal(mine.unanswered, 0, 'no ping unanswered');

  // C1.9: Ben's cursor on A; A's presence connection dropped: the cursor goes at once, A reconnects
  const b1 = await pointOn(B, 'n-card', 0.5, 0.5);
  await B.move(b1.pt.x, b1.pt.y);
  await cursorAt(ctx, A, 'ben', 'n-card', async () => at(await nodeBox(A, 'n-card'), b1.fx, b1.fy), "Ben's cursor on A");
  const h0 = A.rec.order();
  assert.ok(fa.drop() >= 1, "A's presence connection dropped at the front");
  await within(ctx, async () => (await cursorCount(A, 'ben')) === 0, "C1.9: Ben's cursor gone from A while down", async () => JSON.stringify(await cursorOf(A, 'ben')), 500);
  await within(ctx, async () => ofKind(after(A.rec.psent, h0), 'here').length > 0, 'C1.9: A says here on a new presence socket', async () => '', 3000);
  await waitSpot(ctx, A, 'ben', 'A after reconnecting');
  const b2 = await pointOn(B, 'n-side', 0.5, 0.5);
  await B.move(b2.pt.x, b2.pt.y);
  await cursorAt(ctx, A, 'ben', 'n-side', async () => at(await nodeBox(A, 'n-side'), b2.fx, b2.fy), "C1.9: Ben's cursor on A again");

  // C1.10: A hidden (a tab opened in its window): here visible false, Ana's cursor gone from B
  const a1 = await pointOn(A, 'n-card', 0.5, 0.5);
  await A.move(a1.pt.x, a1.pt.y);
  await cursorAt(ctx, B, 'ana', 'n-card', async () => at(await nodeBox(B, 'n-card'), a1.fx, a1.fy), "Ana's cursor on B");
  assert.equal(await cursorCount(A, 'ben'), 1, "Ben's cursor on A before A is hidden");
  const v0 = A.rec.order();
  await ctx.hideA();
  await within(ctx, async () => (await A.ev('document.visibilityState')) === 'hidden', 'C1.10: A hidden');
  // final-1 F1: a hidden page drops others' cursors (it is sent no moves meanwhile)
  await within(ctx, async () => (await cursorCount(A, 'ben')) === 0, "C1.10: Ben's cursor dropped on hidden A", async () => JSON.stringify(await cursorOf(A, 'ben')));
  // final-2 F2-1: a move of Ben's that was on its way before the relay heard A hide draws nothing
  const benConn = A.rec.pgot.filter((f) => f.m.t === 'move' && f.m.id === 'ben').at(-1).m.conn;
  const g0 = A.rec.order();
  assert.ok(fa.inject(JSON.stringify({ t: 'move', id: 'ben', conn: benConn, a: { k: 'n-card', x: 0.5, y: 0.5 } })) >= 1, "a late move written to A's presence socket");
  await within(ctx, async () => after(A.rec.pgot, g0).some((f) => f.m.t === 'move'), 'A got the late move');
  assert.equal(await cursorCount(A, 'ben'), 0, "C1.10: the late move draws no cursor on hidden A");
  await within(ctx, async () => ofKind(after(A.rec.psent, v0), 'here').some((f) => f.m.visible === false), 'C1.10: A says here visible false');
  await within(ctx, async () => (await cursorCount(B, 'ana')) === 0, "C1.10: Ana's cursor gone from B", async () => JSON.stringify(await cursorOf(B, 'ana')));
  await ctx.showA();
  await within(ctx, async () => (await A.ev('document.visibilityState')) === 'visible', 'A shown again');
  await within(ctx, async () => ofKind(after(A.rec.psent, v0), 'here').at(-1)?.m.visible === true, 'C1.10: A says here visible true');
  assert.equal(await cursorCount(A, 'ben'), 0, 'C1.10: no stale Ben cursor on A once shown');
  const b3 = await pointOn(B, 'n-card', 0.25, 0.75);
  await B.move(b3.pt.x, b3.pt.y);
  await cursorAt(ctx, A, 'ben', 'n-card', async () => at(await nodeBox(A, 'n-card'), b3.fx, b3.fy), "C1.10: Ben's cursor on A with his next move");

  // C1.11 (task-2 T2-2; presence@1 §9): A loaded while hidden says here visible false, closes its
  // presence socket within 60 s (plus slack) and opens a new one when shown
  await ctx.hideA();
  await within(ctx, async () => (await A.ev('document.visibilityState')) === 'hidden', 'A hidden again');
  const l0 = A.rec.order();
  await A.load(`/view/canvas/${SLUG}`);
  await within(ctx, async () => ofKind(after(A.rec.psent, l0), 'here').some((f) => f.m.visible === false), 'C1.11: the hidden load says here visible false');
  assert.ok(!ofKind(after(A.rec.psent, l0), 'here').some((f) => f.m.visible === true), 'C1.11: the hidden load never says visible true');
  const opened = Date.now();
  await within(ctx, async () => !pfake.stats().some((x) => x.id === 'ana'), "C1.11: A's presence socket closed while hidden", async () => JSON.stringify(pfake.stats()), 75000);
  assert.ok(Date.now() - opened >= 50000, `closed after ${Date.now() - opened} ms, not before 60 s`);
  await ctx.showA();
  await within(ctx, async () => ofKind(after(A.rec.psent, l0), 'here').some((f) => f.m.visible === true), 'C1.11: shown, A says here on a new socket', async () => '', 10000);
  assert.ok(pfake.stats().some((x) => x.id === 'ana'), "A's presence socket open again");
  noExceptions(A, 'A');
  noExceptions(B, 'B');
});

// ---- done-when 2: the spot (spec §1) ----

const wantAt = (tab, slug = SLUG) => ({ page: 'canvas', tab, peek: null, art: `${slug}@canvas`, thread: null });

test("canvas cursors: the page reports its spot, draws others' selections and marks another person's last edit for 3 s", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 240000 }, async (t) => {
  const ctx = await twoPages(t);
  const { A, B } = ctx;
  await waitSpot(ctx, B, 'ana', 'B');
  // C2.1: every here's at, every move's shape
  const a1 = await pointOn(A, 'n-card', 0.4, 0.4);
  await A.move(a1.pt.x, a1.pt.y);
  await cursorAt(ctx, B, 'ana', 'n-card', async () => at(await nodeBox(B, 'n-card'), a1.fx, a1.fy), "Ana's cursor on B");
  await showPageOf(ctx, A, 'p-two');
  const h2 = await within(ctx, async () => ofKind(A.rec.psent, 'here').some((f) => f.m.at.tab === 'p-two'), "A's here on p-two");
  void h2;
  const s0 = B.rec.order();
  const two = await pointOn(A, 'n-two', 0.5, 0.5);
  // A's moves on p-two: wait until the last one sent is its latest position (task-2-2 F2-1), after which
  // B would have had any relay
  const mv0 = A.rec.order();
  await A.move(two.pt.x, two.pt.y);
  const lastTwo = await pointOn(A, 'n-two', 0.7, 0.6);
  await A.move(lastTwo.pt.x, lastTwo.pt.y);
  await within(ctx, async () => {
    const a = ofKind(after(A.rec.psent, mv0), 'move').at(-1)?.m.a;
    return !!a && a.k === 'n-two' && Math.abs(a.x - lastTwo.fx) < 0.02 && Math.abs(a.y - lastTwo.fy) < 0.02;
  }, "A's latest move on p-two sent", async () => JSON.stringify(ofKind(after(A.rec.psent, mv0), 'move').map((f) => f.m.a)));
  await sleep(300);
  assert.equal(await cursorCount(B, 'ana'), 0, "no Ana cursor on B's p-main while A is on p-two");
  assert.equal(ofKind(after(B.rec.pgot, s0), 'move').length, 0, 'B got no move from another spot');
  for (const f of ofKind(A.rec.psent, 'here')) {
    assert.deepEqual(f.m.at, wantAt(f.m.at.tab), "a here's at");
    assert.ok(['p-main', 'p-two'].includes(f.m.at.tab), `tab ${f.m.at.tab}`);
    assert.deepEqual(presenceShape('here', f.m), [], 'presence here shape');
    assert.deepEqual(canvasShape('presence-here', f.m), [], 'canvas presence-here shape');
  }
  const moves = ofKind(A.rec.psent, 'move');
  assert.ok(moves.length > 0, 'A sent moves');
  for (const f of moves) {
    assert.deepEqual(presenceShape('move', f.m), [], 'presence move shape');
    if (f.m.a !== null) assert.deepEqual(canvasShape('presence-move', f.m), [], 'canvas presence-move shape');
  }
  await showPageOf(ctx, A, 'p-main');

  // C2.2: A selects n-side; B selects n-card: A draws Ben's box, never its own; B draws Ana's
  await A.click('#layers .layer[data-node="n-side"]');
  await B.click('#layers .layer[data-node="n-card"]');
  await within(ctx, async () => { const b = await boxesOf(A, 'others-sel', 'ben'); return b.length === 1 && b[0].node === 'n-card' && b[0].tag === 'Ben' && await boxAround(A, b[0]); }, "C2.2: Ben's box on A around n-card, tagged Ben", async () => JSON.stringify(await boxesOf(A, 'others-sel', 'ben')));
  await within(ctx, async () => { const b = await boxesOf(B, 'others-sel', 'ana'); return b.length === 1 && b[0].node === 'n-side' && await boxAround(B, b[0]); }, "C2.2: Ana's box on B around n-side", async () => JSON.stringify(await boxesOf(B, 'others-sel', 'ana')));
  assert.deepEqual(await boxesOf(A, 'others-sel', 'ana'), [], 'A never draws its own selection');
  // task-3 T3-3: B's canvas socket dropped: Ana's box goes at once (B retries after 1 s or more) and
  // comes back with the new socket's selections
  assert.ok(ctx.fb.dropCanvas() >= 1, "B's canvas connection dropped at the front");
  await within(ctx, async () => (await boxesOf(B, 'others-sel', 'ana')).length === 0, "no Ana box on B while its canvas socket is down", async () => JSON.stringify(await boxesOf(B, 'others-sel', 'ana')), 900);
  await within(ctx, async () => (await boxesOf(B, 'others-sel', 'ana')).map((b) => b.node).join(' ') === 'n-side', "Ana's box on B again once it reconnects", async () => JSON.stringify(await boxesOf(B, 'others-sel', 'ana')), 15000);
  await B.shiftClick('#layers .layer[data-node="n-side"]');
  await within(ctx, async () => { const b = await boxesOf(A, 'others-sel', 'ben'); return b.map((x) => x.node).sort().join(' ') === 'n-card n-side' && b.filter((x) => x.tag !== null).length === 1; }, "C2.2: two Ben boxes on A, one tag", async () => JSON.stringify(await boxesOf(A, 'others-sel', 'ben')));
  await B.key('Escape');
  await within(ctx, async () => (await boxesOf(A, 'others-sel', 'ben')).length === 0, 'C2.2: no Ben box on A once B clears', async () => JSON.stringify(await boxesOf(A, 'others-sel', 'ben')));
  assert.deepEqual(await boxesOf(A, 'others-sel', 'ana'), [], 'A never draws its own selection');

  // C2.3: B renames n-card: A marks it with Ben's name at once, B marks nothing; gone 2.5 to 4.5 s later
  const a0 = A.rec.order();
  await rename(B, 'n-card', 'Card two');
  const benOps = await opsBy(ctx, A, a0, 'ben', "Ben's ops on A");
  const flashBen = async () => (await boxesOf(A, 'flash', 'ben')).some((b) => b.node === 'n-card' && b.tag === 'Ben');
  await within(ctx, flashBen, "C2.3: A marks n-card with Ben's name", async () => JSON.stringify(await allBoxes(A, 'flash')), 2000);
  assert.deepEqual(await allBoxes(B, 'flash'), [], "C2.3: B marks nothing for its own edit");
  const gone = await goneAt(ctx, flashBen, "Ben's mark on A");
  const lasted = gone - benOps.at;
  assert.ok(lasted >= 2500 && lasted <= 4500, `C2.3: the mark lasted ${lasted} ms`);

  // task-3 T3-1, T3-2: an edit by Ben from elsewhere (the local route, no ack of B's): B still marks
  // nothing (by.id is its own); A marks the nodes its add, move and set name
  const a2 = A.rec.order();
  const b2 = B.rec.order();
  const byBen = await request(`${ctx.fake.url}/api/canvas/local?slug=${SLUG}`, {
    method: 'POST', headers: { 'x-devteam-canvas-token': ctx.fake.token, 'Content-Type': 'application/json' },
    body: { by: 'ben', via: 'apply', ops: [
      { op: 'add', node: { id: 'n-new', type: 'frame', parent: 'p-main', name: 'New', x: 640, y: 0, size: { w: 80, h: 80 } }, after: 'n-foot' },
      { op: 'move', id: 'n-foot', parent: 'p-main', after: null },
    ] },
  });
  assert.equal(byBen.status, 200, "Ben's local apply");
  await opsBy(ctx, B, b2, 'ben', "Ben's local ops on B");
  await opsBy(ctx, A, a2, 'ben', "Ben's local ops on A");
  await within(ctx, async () => (await allBoxes(A, 'flash')).map((b) => b.node).sort().join(' ') === 'n-foot n-new', 'T3-2: A marks the added and the moved node', async () => JSON.stringify(await allBoxes(A, 'flash')), 2000);
  assert.deepEqual(await allBoxes(B, 'flash'), [], "T3-1: B marks nothing for its own person's edit from elsewhere");
  await goneAt(ctx, async () => (await allBoxes(A, 'flash')).length > 0, "the mark of Ben's local edit on A");

  // C2.4: Ben edits again; 1.5 to 2 s after its mark shows, the supervisor applies an op to n-side:
  // only n-side is marked, with "supervisor", for its own 3 s
  const o1 = A.rec.order();
  await rename(B, 'n-card', 'Card three');
  await within(ctx, flashBen, "Ben's second mark on A", async () => JSON.stringify(await allBoxes(A, 'flash')), 2000);
  await sleep(1700);
  const res = await request(`${ctx.fake.url}/api/canvas/local?slug=${SLUG}`, {
    method: 'POST', headers: { 'x-devteam-canvas-token': ctx.fake.token, 'Content-Type': 'application/json' },
    body: { by: 'supervisor', via: 'apply', ops: [{ op: 'set', id: 'n-side', prop: 'name', value: 'Side by the supervisor' }] },
  });
  assert.equal(res.status, 200, "the supervisor's local apply");
  const supOps = await opsBy(ctx, A, o1, 'supervisor', "the supervisor's ops on A");
  const flashSup = async (p) => (await boxesOf(p, 'flash', 'supervisor')).some((b) => b.node === 'n-side' && b.tag === 'supervisor');
  await within(ctx, () => flashSup(A), "C2.4: A marks n-side with supervisor", async () => JSON.stringify(await allBoxes(A, 'flash')), 2000);
  assert.deepEqual(await allBoxes(A, 'flash'), [{ person: 'supervisor', node: 'n-side' }], "C2.4: the supervisor's mark replaced Ben's");
  await within(ctx, () => flashSup(B), "C2.4: B marks n-side with supervisor", async () => JSON.stringify(await allBoxes(B, 'flash')), 2000);
  const wait = supOps.at + 2500 - Date.now();
  if (wait > 0) await sleep(wait);
  assert.equal(await flashSup(A), true, "C2.4: the supervisor's mark still shown 2.5 s after its ops");
  const gone2 = await goneAt(ctx, () => flashSup(A), "the supervisor's mark on A");
  assert.ok(gone2 - supOps.at <= 4500, `C2.4: the supervisor's mark gone by 4.5 s (${gone2 - supOps.at} ms)`);
  noExceptions(A, 'A');
  noExceptions(B, 'B');
});

test('canvas cursors: a canvas with a 120-character slug reports its art hashed and still shows cursors', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 240000 }, async (t) => {
  const ctx = await twoPages(t, { canvases: { [LONG_SLUG]: CANVAS }, slug: LONG_SLUG });
  const { A, B } = ctx;
  assert.equal(LONG_SLUG.length, 120);
  await waitSpot(ctx, B, 'ana', 'B');
  const heres = ofKind(A.rec.psent, 'here');
  assert.ok(heres.length > 0);
  for (const f of heres) {
    assert.deepEqual(f.m.at, { ...wantAt('p-main', LONG_SLUG), art: hashPart(`${LONG_SLUG}@canvas`) }, 'C2.5: art hashed');
    assert.deepEqual(presenceShape('here', f.m), [], 'presence here shape');
  }
  const a1 = await pointOn(A, 'n-card', 0.4, 0.6);
  await A.move(a1.pt.x, a1.pt.y);
  await cursorAt(ctx, B, 'ana', 'n-card', async () => at(await nodeBox(B, 'n-card'), a1.fx, a1.fy), "C2.5: Ana's cursor on B");
  noExceptions(A, 'A');
  noExceptions(B, 'B');
});
