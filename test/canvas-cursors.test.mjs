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
import { startCanvasFake } from './lib/canvas-fake.mjs';
import { startPresenceFake } from './lib/presence-fake.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { until } from './lib/kit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE_FILE = path.join(here, '..', 'docs', 'devteam', 'dashboard', 'canvas.html');
const SKIP = canDrive ? false : 'needs Chrome and WebSocket';

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
// presence connection on both sides, as a dropped network would.
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
    if (isPresence) presence.add(pair);
    const end = () => { presence.delete(pair); socket.destroy(); up.destroy(); };
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

// ---- kit-669 F2: a select waits for a document fetch (spec §6, S6.1, S6.2) ----

test('canvas cursors: a select made while the document is fetched after a restart or a reload waits for the fetch and the re-sent edits', { skip: SKIP, timeout: 240000 }, async (t) => {
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
  await sleep(1500); // a select sent at the welcome, or at the Shift+click, would be out by now
  assert.deepEqual(ofKind(after(A.rec.sent, r0), 'select').map((f) => f.m), [], 'no select while the document is fetched');
  A.rec.hold = null;
  A.rec.release();
  const again = await addAfter(ctx, A, r0, "X's add re-sent", x.id);
  await within(ctx, async () => ofKind(after(A.rec.sent, r0), 'select').length > 0, 'a select after the fetch');
  const sel = ofKind(after(A.rec.sent, r0), 'select')[0];
  assert.ok(sel.n > again.ack.n, `the first select after the restart (${sel.n}) comes after X's ack (${again.ack.n})`);
  assert.deepEqual([...sel.m.ids].sort(), [x.id, 'n-card'].sort(), 'it names X and n-card');
  await within(ctx, async () => anaSelections(B, b0).some((ids) => ids && ids.includes(x.id) && ids.includes('n-card')), "B's selections list Ana with X and n-card", async () => JSON.stringify(anaSelections(B, b0)));

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
  noExceptions(A, 'A');
  noExceptions(B, 'B');
});
