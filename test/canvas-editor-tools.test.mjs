// The canvas editor's tools (kit-669, docs/devteam/dashboard/canvas.html): pages added, renamed,
// reordered and deleted, multi-select, resize handles, and copy and paste, in headless Chrome against
// the kit-651 fake (test/lib/canvas-fake.mjs), which serves the page through its `serve` option. The
// harness is kit-668's (test/canvas-sync.test.mjs), copied: the recorder watches the page on a second
// DevTools connection of its own: its requests (Fetch), its dialogs and exceptions, and its WebSocket
// frames (Network), each parsed, both ways.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { docErrors, openCanvas, startCanvasFake } from './lib/canvas-fake.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { until } from './lib/kit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE_FILE = path.join(here, '..', 'docs', 'devteam', 'dashboard', 'canvas.html');
const FIX = path.join(here, 'fixtures', 'canvas');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
const IMG_FILE = '429be16d0a91e377.png';
const IMG = fs.readFileSync(path.join(FIX, 'images', IMG_FILE));
const EVERY = fixture('doc-every-type.json');
const EVERY_IMAGES = (slug) => ({ [slug]: { [IMG_FILE]: IMG } });

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

const DOM_GONE = /navigated or closed|Cannot find context|context was destroyed|Execution context|Inspected target navigated/i;

// The recorder: a second DevTools connection to the page's target (the helper's own drops events).
// Fetch for every URL: recorded (`urls`, a set, and `requests`, every one in order, with its resource type in `kinds`), then answered by
// `answer`, continued when same-origin, failed otherwise; dialogs recorded and dismissed; exceptions
// recorded. Network for the page's WebSocket frames: `sent` (the page's, parsed) and `got` (the
// server's, parsed), with the time each was seen here (`sentAt`, `gotAt`, Date.now()), and for the
// page's also the browser's own frame time (`sentTs`, Network's timestamp, in seconds). File choosers
// the page opens (once a test has set Page.setInterceptFileChooserDialog) in `choosers`. `answer` may
// return { fail: true } to fail the request; a test may set `rec.hold` to a URL test, and the requests
// it matches wait in `rec.held` (their URLs in `rec.heldUrl`) until `rec.release()`, or one is
// answered 200 with a JSON body of the test's by `rec.fulfill(requestId, body)` (never forwarded).
async function recorder(ws, origin, answer) {
  let seq = 0;
  const waiting = new Map();
  const rec = {
    urls: new Set(), requests: [], kinds: [], dialogs: [], exceptions: [], sent: [], sentAt: [], sentTs: [], got: [], gotAt: [], choosers: [],
    send: null, hold: null, held: [], heldUrl: new Map(), release: null, fulfill: null,
  };
  const raw = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`recorder ${method}: no answer in 30 s`)); }, 30000);
    timer.unref();
    waiting.set(id, { method, resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  rec.send = raw;
  // a request answered after its page has gone fails; nothing waits on those answers
  const quiet = (method, params) => { raw(method, params).catch(() => {}); };
  rec.release = () => { for (const requestId of rec.held.splice(0)) quiet('Fetch.continueRequest', { requestId }); };
  rec.fulfill = (requestId, json) => {
    const i = rec.held.indexOf(requestId);
    if (i < 0) throw new Error(`rec.fulfill: ${requestId} is not held`);
    rec.held.splice(i, 1);
    const b = Buffer.from(JSON.stringify(json)).toString('base64');
    return raw('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: b });
  };
  const frame = (r) => {
    if (!r || r.opcode !== 1) return null;
    try { return JSON.parse(r.payloadData); } catch { return { unparsed: r.payloadData }; }
  };
  ws.onmessage = (m) => {
    const o = JSON.parse(m.data);
    if (o.id !== undefined) {
      const w = waiting.get(o.id);
      if (!w) return;
      waiting.delete(o.id);
      if (o.error) w.reject(new Error(`recorder ${w.method}: ${o.error.message}`)); else w.resolve(o.result);
      return;
    }
    if (o.method === 'Fetch.requestPaused') {
      const { requestId, request, resourceType } = o.params;
      const url = request.url;
      rec.urls.add(url);
      rec.requests.push(url);
      rec.kinds.push(resourceType);
      const a = answer ? answer(url) : null;
      if (a && a.fail) quiet('Fetch.failRequest', { requestId, errorReason: 'Failed' });
      else if (a) {
        const body = Buffer.from(typeof a.body === 'string' ? a.body : JSON.stringify(a.body ?? null)).toString('base64');
        quiet('Fetch.fulfillRequest', { requestId, responseCode: a.status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body });
      } else if ((url === origin || url.startsWith(`${origin}/`)) && rec.hold && rec.hold(url)) {
        rec.held.push(requestId);
        rec.heldUrl.set(requestId, url);
      }
      else if (url === origin || url.startsWith(`${origin}/`)) quiet('Fetch.continueRequest', { requestId });
      else quiet('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    } else if (o.method === 'Network.webSocketFrameSent') {
      const f = frame(o.params.response);
      if (f) { rec.sent.push(f); rec.sentAt.push(Date.now()); rec.sentTs.push(o.params.timestamp); }
    } else if (o.method === 'Network.webSocketFrameReceived') {
      const f = frame(o.params.response);
      if (f) { rec.got.push(f); rec.gotAt.push(Date.now()); }
    } else if (o.method === 'Page.fileChooserOpened') {
      rec.choosers.push(o.params);
    } else if (o.method === 'Page.javascriptDialogOpening') {
      rec.dialogs.push(o.params);
      quiet('Page.handleJavaScriptDialog', { accept: false });
    } else if (o.method === 'Runtime.exceptionThrown') {
      rec.exceptions.push(o.params.exceptionDetails);
    }
  };
  ws.onclose = () => { for (const [id, w] of waiting) { waiting.delete(id); w.reject(new Error(`recorder ${w.method}: connection closed`)); } };
  await raw('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await raw('Network.enable');
  await raw('Page.enable');
  await raw('Runtime.enable');
  return rec;
}

// A fake with these canvases, Chrome, a page at `size`, the recorder on it, then the page loaded at
// `path` (default: the first canvas's address) and waited on until it is ready or showing an error.
async function open(t, { canvases = {}, images = {}, repo, size = [1440, 900], path: at, answer, beforeLoad } = {}) {
  const later = cleanup(t);
  const fake = await startCanvasFake({ canvases, images, ...(repo ? { repo } : {}), serve });
  later(() => fake.close());
  const origin = fake.url;
  const chrome = await openChrome();
  later(() => chrome.close());
  const dir = chrome.proc.spawnargs.find((a) => a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
  const portFile = path.join(dir, 'DevToolsActivePort');
  await until(() => fs.existsSync(portFile) && /^\d+\n/.test(fs.readFileSync(portFile, 'utf8')), 'DevToolsActivePort');
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const list = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const before = new Set((await list()).map((x) => x.id));
  const p = await chrome.newPage();
  later(() => p.close());
  const target = (await list()).find((x) => x.type === 'page' && !before.has(x.id));
  assert.ok(target, 'the new page target in /json/list');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('could not reach the page for the recorder')); });
  later(() => ws.close());
  const rec = await recorder(ws, origin, answer);
  await p.send('Emulation.setScrollbarsHidden', { hidden: true });
  const resize = (w, h) => p.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await resize(size[0], size[1]);
  if (beforeLoad) await beforeLoad(rec);
  const evNav = (expr) => p.ev(expr).catch((e) => { if (DOM_GONE.test(e.message)) return false; throw e; });
  const load = async (where) => {
    const url = `${origin}${where}`;
    await p.send('Page.navigate', { url: 'about:blank' });
    await until(() => evNav("location.href === 'about:blank'"), 'about:blank');
    await p.send('Page.navigate', { url });
    await until(() => evNav(`location.href === ${JSON.stringify(url)} && ['ready', 'error'].includes(document.body && document.body.dataset.state)`), `${where} ready or showing an error`);
  };
  await load(at ?? `/view/canvas/${Object.keys(canvases)[0]}`);
  return { p, fake, origin, rec, load, size: resize, later };
}

const text = (p, sel) => p.ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
const count = (p, sel) => p.ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const body = (p, key) => p.ev(`document.body.dataset[${JSON.stringify(key)}] ?? null`);
// `until` with a shorter bound, and what was last seen (`why()`) in its failure.
async function within(f, what, why = async () => '', ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await f()) return;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what} (${await why()})`);
    await sleep(50);
  }
}
// Nothing the page ran threw (Runtime.exceptionThrown on the recorder's connection): every test ends on it.
const noExceptions = (rec, what = 'the page') => assert.deepEqual(rec.exceptions.map((e) => e.exception?.description ?? e.text), [], `${what}: no exception`);

// ---- the socket's frames ----

// The page's edit frames, in the order sent.
const edits = (rec) => rec.sent.filter((m) => m && m.t === 'edit');
// The page's edit after the first `n0` (its index n0), once it is sent.
async function nextEdit(rec, n0, ms = 10000) {
  await within(async () => edits(rec).length > n0, `an edit frame after the first ${n0}`, async () => JSON.stringify(rec.sent.slice(-5)), ms);
  return edits(rec)[n0];
}
// The server's `ops` frame acking `edit` (its client and seq), once it arrives.
async function ackOf(rec, edit, ms = 10000) {
  const find = () => rec.got.find((m) => m && m.t === 'ops' && m.ack && m.ack.client === edit.client && m.ack.seq === edit.seq);
  await within(async () => !!find(), `the ack of seq ${edit.seq}`, async () => JSON.stringify(rec.got.slice(-5)), ms);
  return find();
}
const refusedFrames = (rec) => rec.got.filter((m) => m && m.t === 'refused');
// The doc requests the page made, in order.
const docRequests = (rec, slug) => rec.requests.filter((u) => u.endsWith(`/api/canvas/doc?slug=${slug}`));

// ---- the page's state and its panel ----

const live = (p) => within(async () => (await body(p, 'live')) === 'on', 'data-live on', async () => `data-live ${await body(p, 'live')}`);
// Everything the page holds is acked and saved: data-pending 0 and data-saved equal to data-rev.
async function waitSaved(p) {
  const why = async () => `pending ${await body(p, 'pending')}, saved ${await body(p, 'saved')}, rev ${await body(p, 'rev')}`;
  await within(async () => (await body(p, 'pending')) === '0' && (await body(p, 'saved')) === (await body(p, 'rev')) && (await body(p, 'rev')) !== null, 'pending 0 and saved at rev', why);
}
const selectRow = async (p, id) => {
  await p.click(`#layers .layer[data-node="${id}"]`);
  await within(async () => (await p.ev(`document.querySelector('#layers .layer[data-node="${id}"]')?.getAttribute('aria-selected')`)) === 'true', `${id}'s row selected`);
};
// Focus a field's control, its text selected (so typing replaces it).
const focusField = (p, prop) => p.ev(`(() => { const e = document.querySelector('#props [data-prop="${prop}"]'); if (!e) return false; e.focus(); if (typeof e.select === 'function') e.select(); return document.activeElement === e; })()`);
// Enter as a keyboard sends it: the key with its text ("\r"), which is what commits an input (the
// helper's key('Enter') carries no text, so an input never sees it as Enter).
async function enter(p) {
  const k = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k, text: '\r', unmodifiedText: '\r' });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
}
// Typed, key by key: letters, digits and space by the helper's key(); any other character as a key
// event carrying only its text (the helper gives `(` the virtual key code 40, ArrowDown, `#` 35, End,
// `.` 46, Delete, so Chrome would take them for those keys).
async function typeKeys(p, s) {
  for (const c of s) {
    if (/^[A-Za-z0-9 ]$/.test(c)) { await p.key(c); continue; }
    await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: c, text: c, unmodifiedText: c });
    await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: c });
  }
}
// Focus out of the Properties panel: a click on its title (not focusable), so a deferred rebuild runs.
const leavePanel = (p) => p.click('.panel.right .ptitle');
// Change a field by real input, then leave the panel: an input has its text selected, typed over and
// Enter pressed; the `text` textarea is typed and Tabbed out of (Enter there is a new line); a select is
// set by value with a `change` event (headless Chrome opens no popup); a button group is clicked; a
// checkbox is clicked when it isn't already `value` (true or false).
async function fieldSet(p, prop, value) {
  const kind = await p.ev(`(() => { const e = document.querySelector('#props [data-prop="${prop}"]'); return e ? (e.type === 'checkbox' ? 'checkbox' : e.localName) : null; })()`);
  assert.ok(kind, `a #props [data-prop="${prop}"] control`);
  if (kind === 'checkbox') {
    const checked = await p.ev(`document.querySelector('#props [data-prop="${prop}"]').checked`);
    assert.notEqual(checked, value, `${prop} is not already ${value}`);
    await p.click(`#props [data-prop="${prop}"]`);
  } else if (kind === 'input' || kind === 'textarea') {
    assert.equal(await focusField(p, prop), true, `${prop} focused`);
    await typeKeys(p, String(value));
    if (kind === 'textarea') await p.key('Tab'); else await enter(p);
  } else if (kind === 'select') {
    await p.ev(`(() => { const e = document.querySelector('#props [data-prop="${prop}"]'); e.focus(); e.value = ${JSON.stringify(String(value))}; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  } else {
    await p.click(`#props [data-prop="${prop}"] button[data-value="${value}"]`);
  }
  await leavePanel(p);
}
// Every property control of the panel (`[data-prop]`), and whether each is disabled: a form control by
// its own `disabled`, a button group by every one of its buttons.
const propControls = (p) => p.ev(`[...document.querySelectorAll('#props [data-prop]')].map((e) => {
  const off = e.matches('input, select, textarea, button, fieldset') ? e.disabled : (() => { const b = [...e.querySelectorAll('button')]; return b.length > 0 && b.every((x) => x.disabled); })();
  return { prop: e.dataset.prop, off };
})`);

// The words and banners (spec §1, §2).
const SAY = {
  ref: "That is still used by a component, an instance or a token, so it wasn't changed.",
  instancesFirst: "Delete this component's instances first.",
};
const BANNER = {
  paused: "Saving paused: the canvas's branch changed. Your edits are kept here.",
  landed: 'This canvas has landed. It is read-only until it is opened for editing again.',
  down: 'Reconnecting… your edits are kept here.',
};
const shownText = (p, sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.hidden || e.getClientRects().length === 0 || getComputedStyle(e).visibility === 'hidden') return null; return e.textContent; })()`);

// Another person on the canvas: the fake's own client, as Ana.
const ANA = { 'x-devteam-person': 'ana;name=Ana' };
const ANA_CLIENT = 'ana0000000000000';
async function ana(fake, later, slug = 'every') {
  const c = await openCanvas(fake.url, { slug, headers: ANA });
  later(() => c.destroy());
  assert.equal(c.status, 101, 'Ana connected');
  let seq = 0;
  // one edit of Ana's, resolved with its ack (the ops frame Ana gets back)
  c.edit = async (ops) => {
    const s = ++seq;
    c.send({ t: 'edit', client: ANA_CLIENT, seq: s, ops });
    return c.next((m) => m.t === 'ops' && m.ack && m.ack.client === ANA_CLIENT && m.ack.seq === s, 5000);
  };
  return c;
}

// The page's own WebSocket closed from the page's side, with no hook in the page: every WebSocket the
// page holds found by its prototype (Runtime.queryObjects) and closed (Runtime.callFunctionOn), on the
// recorder's connection. Resolves the number closed.
async function closePageSocket(rec) {
  const proto = await rec.send('Runtime.evaluate', { expression: 'WebSocket.prototype' });
  const found = await rec.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId });
  const r = await rec.send('Runtime.callFunctionOn', {
    objectId: found.objects.objectId,
    functionDeclaration: 'function () { for (const w of this) w.close(); return this.length; }',
    returnByValue: true,
  });
  return r.result.value;
}

const titleRowName = (p) => text(p, '#layers .layer[data-node="title"] .nm');

// ---- kit-668's helpers ----

const kept = (p) => body(p, 'kept');
const noDialogs = (rec) => assert.deepEqual(rec.dialogs, [], 'no dialog');
// The page's edit frames with that seq, among rec.sent from index `from` on.
const framesWithSeq = (rec, seq, from = 0) => rec.sent.slice(from).filter((m) => m && m.t === 'edit' && m.seq === seq);
// The page's edit frames from index `from` of rec.sent on whose ops deep-equal `ops`.
const framesWithOps = (rec, ops, from = 0) => rec.sent.slice(from).filter((m) => {
  if (!m || m.t !== 'edit') return false;
  try { assert.deepEqual(m.ops, ops); return true; } catch { return false; }
});
// The server's frames of kind `t` with when each was seen ({ m, at, i }).
const gotOf = (rec, t) => rec.got.map((m, i) => ({ m, at: rec.gotAt[i], i })).filter((x) => x.m && x.m.t === t);
// The index in rec.sent of the first frame the page sent at or after `at` (rec.sent.length when none yet).
const sentFrom = (rec, at) => { const i = rec.sentAt.findIndex((s) => s >= at); return i < 0 ? rec.sent.length : i; };
// The index in rec.sent of the first frame sent after the n-th welcome (1 for the first) was received.
const afterWelcome = (rec, n) => {
  const w = gotOf(rec, 'welcome')[n - 1];
  assert.ok(w, `a welcome number ${n}`);
  return sentFrom(rec, w.at);
};
const welcomeCount = (rec) => gotOf(rec, 'welcome').length;
// Release the held requests as they come, until none has been held for `quietMs`; the hold stays.
async function releaseAll(rec, quietMs = 500, ms = 20000) {
  const end = Date.now() + ms;
  let quietSince = Date.now();
  for (;;) {
    if (rec.held.length > 0) { rec.release(); quietSince = Date.now(); }
    if (Date.now() - quietSince >= quietMs) return;
    if (Date.now() > end) assert.fail('releaseAll: requests kept coming');
    await sleep(20);
  }
}
// The doc response as the fake gives it now, read by the test.
async function docNow(origin, slug = 'every') {
  const r = await fetch(`${origin}/api/canvas/doc?slug=${slug}`);
  assert.equal(r.status, 200, 'the doc response read by the test');
  return r.json();
}
const holdDocs = (rec, slug = 'every') => { rec.hold = (u) => u.endsWith(`/api/canvas/doc?slug=${slug}`); };
const nameSet = (id, value) => [{ op: 'set', id, prop: 'name', value }];
const rowName = (p, id) => text(p, `#layers .layer[data-node="${id}"] .nm`);
// A node renamed by its Name field (its row selected first); resolves the edit frame once it is sent.
async function rename(p, rec, id, value) {
  await selectRow(p, id);
  const n0 = edits(rec).length;
  await fieldSet(p, 'name', value);
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, nameSet(id, value), `one set of ${id}'s name`);
  return e;
}
// Wait for a frame sent from index `from` on: by seq (and the same ops as `e`) or by ops.
async function waitSeq(rec, e, from, what) {
  await within(async () => framesWithSeq(rec, e.seq, from).length > 0, what, async () => JSON.stringify(rec.sent.slice(-4)));
  for (const f of framesWithSeq(rec, e.seq, from)) assert.deepEqual(f.ops, e.ops, `${what}: the same ops`);
}
async function waitOps(rec, ops, from, what) {
  await within(async () => framesWithOps(rec, ops, from).length > 0, what, async () => JSON.stringify(rec.sent.slice(-4)));
  return framesWithOps(rec, ops, from)[0];
}
const allSaved = (p) => within(async () => (await body(p, 'pending')) === '0' && (await kept(p)) === '0' && (await body(p, 'saved')) === (await body(p, 'rev')),
  'pending 0, kept 0 and saved at rev', async () => `pending ${await body(p, 'pending')}, kept ${await kept(p)}, saved ${await body(p, 'saved')}, rev ${await body(p, 'rev')}`);

// kit-662's drag helpers (test/canvas-editing.test.mjs), copied.
// An element's box on screen.
const box = (p, sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()`);
const zoomNow = (p) => p.ev("new DOMMatrix(getComputedStyle(document.getElementById('surface')).transform).a");
const hitAt = (p, pt) => p.ev(`(() => { const e = document.elementFromPoint(${pt.x}, ${pt.y}); return e ? (e.closest('#surface [data-id]')?.dataset.id ?? e.id ?? null) : null; })()`);
const mouse = (p, type, x, y, extra = {}) => p.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
// A left drag from `a` by (dx, dy), in steps; `mid` runs while the button is still down.
async function drag(p, a, dx, dy, mid = null) {
  await p.move(a.x, a.y);
  await mouse(p, 'mousePressed', a.x, a.y);
  for (let i = 1; i <= 4; i++) await mouse(p, 'mouseMoved', a.x + (dx * i) / 4, a.y + (dy * i) / 4);
  if (mid) await mid();
  await mouse(p, 'mouseReleased', a.x + dx, a.y + dy);
}
// A left press at the first point, moved through the others in steps of at most 10 px, released at the
// last; `mid` runs before the release, the button still down.
async function dragPath(p, pts, mid = null) {
  const [a] = pts;
  await p.move(a.x, a.y);
  await mouse(p, 'mousePressed', a.x, a.y);
  let at = a;
  for (const b of pts.slice(1)) {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - at.x, b.y - at.y) / 10));
    for (let i = 1; i <= steps; i++) await mouse(p, 'mouseMoved', at.x + ((b.x - at.x) * i) / steps, at.y + ((b.y - at.y) * i) / steps);
    at = b;
  }
  if (mid) await mid();
  await mouse(p, 'mouseReleased', at.x, at.y);
}
const ARROW_CODE = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
// An arrow key as a keyboard sends it, Shift held when asked.
async function arrow(p, k, shift = false) {
  const e = { key: k, code: k, windowsVirtualKeyCode: ARROW_CODE[k], nativeVirtualKeyCode: ARROW_CODE[k], modifiers: shift ? 8 : 0 };
  await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...e });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...e });
}
const centre = (b) => ({ x: Math.round(b.l + b.w / 2), y: Math.round(b.t + b.h / 2) });
// No edit frame after the first n0 for `ms`.
async function sendsNothing(rec, n0, what, ms = 600) {
  await sleep(ms);
  assert.deepEqual(edits(rec).slice(n0).map((e) => e.ops), [], `${what}: nothing sent`);
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} within ${tol} of ${b}`);

// A slow left drag: pressed at `from`, moved to `to` (a point, or a list of points passed through in
// turn) in moves of at most 2 px, one every 20 ms, taking at least `ms` in all (more when the way is
// longer than 2 px a move allows); `mid` runs before the release, the button still down; `half` runs
// once half the moves are made, the button down, before the rest.
async function slowDrag(p, from, to, ms, mid = null, { half = null } = {}) {
  const pts = [from, ...(Array.isArray(to) ? to : [to])];
  const legs = pts.slice(1).map((b, i) => ({ a: pts[i], b, d: Math.hypot(b.x - pts[i].x, b.y - pts[i].y) }));
  const total = legs.reduce((s, l) => s + l.d, 0);
  const moves = [];
  for (const l of legs) {
    const n = Math.max(1, Math.ceil(l.d / 2), Math.ceil((ms / 20) * (total > 0 ? l.d / total : 1 / legs.length)));
    for (let i = 1; i <= n; i++) moves.push({ x: l.a.x + ((l.b.x - l.a.x) * i) / n, y: l.a.y + ((l.b.y - l.a.y) * i) / n });
  }
  await p.move(from.x, from.y);
  await mouse(p, 'mousePressed', from.x, from.y);
  let next = Date.now();
  const halfAt = Math.floor(moves.length / 2);
  for (let i = 0; i < moves.length; i++) {
    next += 20;
    const wait = next - Date.now();
    if (wait > 0) await sleep(wait);
    await mouse(p, 'mouseMoved', moves[i].x, moves[i].y);
    if (half && i + 1 === halfAt) { await half(); next = Date.now(); }
  }
  if (mid) await mid();
  const end = moves[moves.length - 1];
  await mouse(p, 'mouseReleased', end.x, end.y);
}
const CANT_GO = "That layer can't go there.";
const kidsOf = (fake, id) => fake.doc('every').nodes[id].children;
// The page's edit frames with the browser's time each was sent (ms), from rec.sent's index `from` on.
const editsTimed = (rec, from = 0) => rec.sent.map((m, i) => ({ m, ts: rec.sentTs[i] * 1000, i })).slice(from).filter((x) => x.m && x.m.t === 'edit');
const setsOf = (m) => m.ops.map((o) => [o.op, o.id, o.prop]);
const onlyXY = (m, id) => m.ops.length > 0 && m.ops.every((o) => o.op === 'set' && o.id === id && (o.prop === 'x' || o.prop === 'y'));
// x and y as the page's set frames left them, from `start` on.
function sentXY(frames, id, start) {
  const v = { ...start };
  for (const f of frames) for (const o of f.ops) if (o.op === 'set' && o.id === id && (o.prop === 'x' || o.prop === 'y')) v[o.prop] = o.value;
  return v;
}
// A live frame of `id` carrying (x, y) seen in rec.sent from `from` on (frames of x, y sets only).
const liveAt = (rec, from, id, start, want) => {
  const f = editsTimed(rec, from).map((x) => x.m).filter((m) => onlyXY(m, id));
  const v = sentXY(f, id, start);
  return f.length > 0 && v.x === want.x && v.y === want.y;
};
// The drag's target position: the start moved by the pointer's (dx, dy) screen px at zoom z, whole px.
const moved = (start, dx, dy, z) => ({ x: Math.round(start.x + dx / z), y: Math.round(start.y + dy / z) });


// Ctrl and a letter key as a keyboard sends it (Ctrl as modifiers 2).
async function ctrl(p, key) {
  const u = key.toUpperCase();
  const e = { key, code: `Key${u}`, windowsVirtualKeyCode: u.charCodeAt(0), nativeVirtualKeyCode: u.charCodeAt(0), modifiers: 2 };
  await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...e });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...e });
}
// Focus on the page itself (nothing focused), then Ctrl+Z.
async function undoKey(p) {
  await p.ev('(() => { const a = document.activeElement; if (a && a !== document.body && typeof a.blur === \'function\') a.blur(); return true; })()');
  await ctrl(p, 'z');
}
const UNDO_SAY = {
  none: 'Nothing to undo.',
  all: "Someone else changed that since, so it wasn't undone.",
  part: 'Part of that was changed by someone else since, so only the rest was undone.',
};
const hideToast = (p) => p.ev("(() => { const t = document.getElementById('toast'); t.hidden = true; t.textContent = ''; return true; })()");
const toastSays = (p, words) => within(async () => (await shownText(p, '#toast')) === words, `#toast says ${JSON.stringify(words)}`, async () => shownText(p, '#toast'), 5000);
const hasRev = (p, fake) => within(async () => (await body(p, 'rev')) === String(fake.rev('every')), 'data-rev equals the fake rev', async () => `${await body(p, 'rev')} vs ${fake.rev('every')}`);
const byProp = (ops) => [...ops].sort((a, b) => String(a.prop).localeCompare(String(b.prop)));

// ---- kit-669's helpers ----

// Every edit frame the page sent from edits(rec)[from] on got its ack, and no `refused` came for any
// of them (the page's own client: refused frames go only to the client that sent the edit).
async function accepted(rec, from, ms = 10000) {
  const mine = edits(rec).slice(from);
  assert.ok(mine.length > 0, `an edit frame from index ${from}`);
  const answered = (e) => rec.got.some((m) => m && ((m.t === 'ops' && m.ack && m.ack.client === e.client && m.ack.seq === e.seq) || (m.t === 'refused' && m.client === e.client && m.seq === e.seq)));
  await within(async () => mine.every(answered), `every edit from index ${from} answered`, async () => JSON.stringify(rec.got.slice(-4)), ms);
  const client = mine[0].client;
  assert.deepEqual(refusedFrames(rec).filter((m) => m.client === client && mine.some((e) => e.seq === m.seq)), [], `the edits from index ${from}: none refused`);
}
// A copy of `base` changed by `f`, checked valid by the fake's own rules (no image folder); its `refs`
// errors allowed only when `refs` is true (a test that says so).
function docVariant(base, f, { refs = false } = {}) {
  const d = structuredClone(base);
  f(d);
  const errs = docErrors(d, { images: null }).filter((e) => !(refs && e.rule === 'refs'));
  assert.deepEqual(errs, [], 'the variant document is valid');
  return d;
}
// A Shift+click in the middle of what `sel` finds: a press and release with modifiers 8.
async function shiftClick(p, sel) {
  const at = await p.at(sel);
  await p.move(at.x, at.y, 8);
  await mouse(p, 'mousePressed', at.x, at.y, { modifiers: 8 });
  await mouse(p, 'mouseReleased', at.x, at.y, { modifiers: 8 });
}
// A double-click in the middle of what `sel` finds: two presses and releases, the second clickCount 2.
async function dblclick(p, sel) {
  const at = await p.at(sel);
  await p.move(at.x, at.y);
  await mouse(p, 'mousePressed', at.x, at.y);
  await mouse(p, 'mouseReleased', at.x, at.y);
  await mouse(p, 'mousePressed', at.x, at.y, { clickCount: 2 });
  await mouse(p, 'mouseReleased', at.x, at.y, { clickCount: 2 });
}
// One key as a keyboard sends it, Ctrl (modifiers 2) and Shift (8) held when asked; `commands` are the
// editing commands it runs (['copy'], ['paste']), as Chrome's own key bindings would.
const KEY_VK = { Backspace: 8, Tab: 9, Enter: 13, Escape: 27, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
async function key(p, k, { ctrl: c = false, shift = false, commands } = {}) {
  const letter = /^[A-Za-z]$/.test(k);
  const vk = KEY_VK[k] ?? k.toUpperCase().charCodeAt(0);
  const e = { key: k, code: letter ? `Key${k.toUpperCase()}` : /^[0-9]$/.test(k) ? `Digit${k}` : k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: (c ? 2 : 0) | (shift ? 8 : 0) };
  await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...e, ...(commands ? { commands } : {}) });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...e });
}
// A paste of `s` as text: a `paste` event with a DataTransfer holding it, on document.body.
const pasteText = (p, s) => p.ev(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(s)}); document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return true; })()`);
// A copy now: a `copy` event with a fresh DataTransfer on what has focus (the body when nothing does);
// its text/plain after the page's handler ran ('' when it set none).
const clipNow = (p) => p.ev("(() => { const dt = new DataTransfer(); const t = document.activeElement || document.body; t.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true })); return dt.getData('text/plain'); })()");

// The fixtures built here (spec's Acceptance checks). NOBUY: `every` with `buy` removed from `nodes`
// and from `actions`'s children, so Parts' `button` has no instance.
const NOBUY = docVariant(EVERY, (d) => {
  delete d.nodes.buy;
  d.nodes.actions.children = d.nodes.actions.children.filter((c) => c !== 'buy');
});
const MINIMAL = fixture('doc-minimal.json');

// ---- P: pages ----

const PAGE_SAY = {
  max: 'A canvas has at most 100 pages.',
  last: "A canvas needs at least one page, so this one wasn't deleted.",
  used: 'A component on this page is used on another page. Delete those instances first.',
};
const pageNames = (p) => p.ev("[...document.querySelectorAll('#pages a[data-page]')].map((a) => a.textContent)");
const pageIds = (p) => p.ev("[...document.querySelectorAll('#pages a[data-page]')].map((a) => a.dataset.page)");
const shownPage = (p) => p.ev("document.querySelector('#pages a[aria-current=\"page\"]')?.dataset.page ?? null");
const pageLink = (id) => `#pages a[data-page="${id}"]`;
// The shown page's row button for `action` (page-rename, page-up, page-down, page-delete).
const rowButton = (action) => `#pages button[data-action="${action}"]`;
const disabled = (p, sel) => p.ev(`document.querySelector(${JSON.stringify(sel)})?.disabled ?? null`);
// Show a page by its link, and wait until it is shown (marked current, in the address); with `row`,
// until its row holds the buttons too.
async function showPageLink(p, id, { row = true } = {}) {
  await p.click(pageLink(id));
  await within(async () => (await shownPage(p)) === id && (await p.ev('location.hash')) === `#page=${encodeURIComponent(id)}`, `page ${id} shown`, async () => `${await shownPage(p)} ${await p.ev('location.hash')}`);
  if (row) await within(async () => (await count(p, rowButton('page-delete'))) === 1 && (await p.ev(`!!document.querySelector(${JSON.stringify(pageLink(id))})?.closest('.prow')?.querySelector('[data-action="page-delete"]')`)), `${id}'s row holds the buttons`);
}
const focusedAction = (p) => p.ev("(() => { const e = document.activeElement; return e instanceof Element ? (e.dataset.action ?? e.localName) : null; })()");

test('P1.1–P1.4 add, rename, reorder and reload', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);

  // P1.1: add
  assert.equal(await p.ev("(() => { const b = document.getElementById('pageAdd'); return !!b && !b.hidden && b.getAttribute('aria-label') === 'Add page'; })()"), true, 'the Add page button shown');
  let n0 = edits(rec).length;
  await p.click('#pageAdd');
  const add = await nextEdit(rec, n0);
  const id = add.ops[0]?.node?.id;
  assert.match(String(id), /^[0-9a-z]{6}-\d+$/, "the new page's id");
  assert.deepEqual(add.ops, [{ op: 'add', node: { id, type: 'page', parent: null, name: 'Page 3' }, after: 'p-parts' }], 'one add of a page');
  await accepted(rec, n0);
  assert.equal(edits(rec).length, n0 + 1, 'one edit frame');
  await within(async () => (await shownPage(p)) === id && (await p.ev('location.hash')) === `#page=${id}`, 'the new page shown', async () => `${await shownPage(p)} ${await p.ev('location.hash')}`);
  assert.deepEqual(await pageIds(p), ['p-main', 'p-parts', id], 'listed last');

  // P1.2: rename by the button, Enter
  await within(async () => (await count(p, rowButton('page-rename'))) === 1, "the shown page's Rename button");
  assert.equal(await p.ev(`document.querySelector(${JSON.stringify(rowButton('page-rename'))}).getAttribute('aria-label')`), 'Rename page');
  await p.click(rowButton('page-rename'));
  await within(async () => (await focusedAction(p)) === 'page-name', 'the name input focused', async () => focusedAction(p));
  assert.equal(await p.ev("document.activeElement.getAttribute('aria-label')"), 'Page name');
  // 201 code points (402 UTF-16 units) send nothing; 200 are sent
  n0 = edits(rec).length;
  await p.send('Input.insertText', { text: '😀'.repeat(201) });
  await enter(p);
  await sendsNothing(rec, n0, 'a name of 201 code points', 500);
  await within(async () => (await text(p, pageLink(id))) === 'Page 3', 'the link reads Page 3', async () => text(p, pageLink(id)));
  await p.click(rowButton('page-rename'));
  await within(async () => (await focusedAction(p)) === 'page-name', 'the name input focused', async () => focusedAction(p));
  await p.send('Input.insertText', { text: '😀'.repeat(200) });
  await enter(p);
  const emo = await nextEdit(rec, n0);
  assert.deepEqual(emo.ops, [{ op: 'set', id, prop: 'name', value: '😀'.repeat(200) }], 'a name of 200 code points sent');
  await accepted(rec, n0);
  // Rename, typed, Enter
  await p.click(rowButton('page-rename'));
  await within(async () => (await focusedAction(p)) === 'page-name', 'the name input focused', async () => focusedAction(p));
  n0 = edits(rec).length;
  await p.type('Draft');
  await enter(p);
  const ren = await nextEdit(rec, n0);
  assert.deepEqual(ren.ops, [{ op: 'set', id, prop: 'name', value: 'Draft' }], 'one set of the name');
  await accepted(rec, n0);
  await within(async () => (await text(p, pageLink(id))) === 'Draft', 'the link reads Draft', async () => text(p, pageLink(id)));
  // Rename, typed, then another page's link clicked: the name sent, that page shown
  await p.click(rowButton('page-rename'));
  await within(async () => (await focusedAction(p)) === 'page-name', 'the name input focused', async () => focusedAction(p));
  n0 = edits(rec).length;
  await p.type('Settings');
  await p.click(pageLink('p-main'));
  const ren2 = await nextEdit(rec, n0);
  assert.deepEqual(ren2.ops, [{ op: 'set', id, prop: 'name', value: 'Settings' }], 'the name sent on leaving');
  await accepted(rec, n0);
  await within(async () => (await shownPage(p)) === 'p-main' && (await p.ev('location.hash')) === '#page=p-main', 'Checkout shown by the click', async () => `${await shownPage(p)} ${await p.ev('location.hash')}`);
  await within(async () => (await text(p, pageLink(id))) === 'Settings', 'the link reads Settings', async () => text(p, pageLink(id)));
  // a double-click on Checkout's link, typed over, Escape: nothing sent, the link back
  n0 = edits(rec).length;
  await dblclick(p, pageLink('p-main'));
  await within(async () => (await focusedAction(p)) === 'page-name', "Checkout's name input focused", async () => focusedAction(p));
  assert.equal(await p.ev('document.activeElement.value'), 'Checkout', 'the input holds the name');
  assert.equal(await p.ev('location.hash'), '#page=p-main', 'Checkout shown');
  await p.type('Cart');
  await p.key('Escape');
  await sendsNothing(rec, n0, 'Escape in the name input', 500);
  await within(async () => (await text(p, pageLink('p-main'))) === 'Checkout', 'the link reads Checkout', async () => text(p, pageLink('p-main')));
  // a control character: nothing sent
  await within(async () => (await shownPage(p)) === 'p-main', 'Checkout shown', async () => shownPage(p));
  await p.click(rowButton('page-rename'));
  await within(async () => (await focusedAction(p)) === 'page-name', 'the name input focused again', async () => focusedAction(p));
  await p.send('Input.insertText', { text: 'Bell\u0007' });
  assert.equal(await p.ev('document.activeElement.value'), 'Bell\u0007', 'the control character typed');
  await enter(p);
  await sendsNothing(rec, n0, 'a name with a control character', 500);
  await within(async () => (await text(p, pageLink('p-main'))) === 'Checkout', 'the link reads Checkout', async () => text(p, pageLink('p-main')));

  // P1.3: reorder
  await showPageLink(p, id);
  assert.equal(await disabled(p, rowButton('page-down')), true, 'Move down disabled on the last page');
  assert.equal(await p.ev(`document.querySelector(${JSON.stringify(rowButton('page-up'))}).getAttribute('aria-label')`), 'Move page up');
  n0 = edits(rec).length;
  await p.click(rowButton('page-up'));
  const up = await nextEdit(rec, n0);
  assert.deepEqual(up.ops, [{ op: 'move', id, parent: null, after: 'p-main' }], 'one move up');
  await accepted(rec, n0);
  await within(async () => JSON.stringify(await pageNames(p)) === JSON.stringify(['Checkout', 'Settings', 'Parts']), 'Checkout, Settings, Parts', async () => JSON.stringify(await pageNames(p)));
  assert.equal(await shownPage(p), id, 'Settings still shown');
  assert.equal(await focusedAction(p), 'page-up', 'focus stays on Move up (still enabled)');
  await showPageLink(p, 'p-main');
  assert.equal(await disabled(p, rowButton('page-up')), true, 'Move up disabled on the first page');
  n0 = edits(rec).length;
  await p.click(rowButton('page-down'));
  const down = await nextEdit(rec, n0);
  assert.deepEqual(down.ops, [{ op: 'move', id: 'p-main', parent: null, after: id }], "one move down, after Settings's id");
  await accepted(rec, n0);
  await within(async () => JSON.stringify(await pageNames(p)) === JSON.stringify(['Settings', 'Checkout', 'Parts']), 'Settings, Checkout, Parts', async () => JSON.stringify(await pageNames(p)));
  assert.equal(await focusedAction(p), 'page-down', 'focus stays on Move down (still enabled)');
  await showPageLink(p, id);
  assert.equal(await disabled(p, rowButton('page-up')), true, 'Move up disabled on the first page');
  await showPageLink(p, 'p-parts');
  assert.equal(await disabled(p, rowButton('page-down')), true, 'Move down disabled on the last page');

  // P1.4: a reload keeps them
  await allSaved(p);
  const before = await pageNames(p);
  assert.deepEqual(before, ['Settings', 'Checkout', 'Parts']);
  await p.ev('(() => { window.__beforeReload = true; return true; })()');
  await p.send('Page.reload', {});
  const fresh = () => p.ev("!window.__beforeReload && document.body && document.body.dataset.state === 'ready'").catch((e) => { if (DOM_GONE.test(e.message)) return false; throw e; });
  await within(fresh, 'the page reloaded and ready');
  const after = await pageNames(p);
  assert.deepEqual(after, fake.doc('every').pages.map((pg) => pg.name), "the list is the fake document's pages, in order");
  assert.deepEqual(after, before, 'the list as it was before the reload');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test('P1.5 delete a page, never the last', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  // `every` with a third page, Settings, first: the state P1.1–P1.3 leave
  const THREE = docVariant(EVERY, (d) => { d.pages.unshift({ id: 'p-set', name: 'Settings', children: [] }); });
  const { p, fake, rec, load } = await open(t, { canvases: { every: THREE, minimal: MINIMAL }, images: EVERY_IMAGES('every') });
  await live(p);
  await showPageLink(p, 'p-set');
  assert.equal(await p.ev(`document.querySelector(${JSON.stringify(rowButton('page-delete'))}).getAttribute('aria-label')`), 'Delete page');
  let n0 = edits(rec).length;
  await p.click(rowButton('page-delete'));
  const del = await nextEdit(rec, n0);
  assert.deepEqual(del.ops, [{ op: 'del', id: 'p-set' }], 'one del');
  await accepted(rec, n0);
  await within(async () => (await shownPage(p)) === 'p-main', 'the next page (Checkout) shown', async () => shownPage(p));
  assert.deepEqual(await pageNames(p), ['Checkout', 'Parts']);
  assert.deepEqual(fake.doc('every').pages.map((pg) => pg.id), ['p-main', 'p-parts']);
  // the only page: nothing sent, said
  await load('/view/canvas/minimal');
  await live(p);
  await within(async () => (await count(p, rowButton('page-delete'))) === 1, "the only page's Delete button");
  n0 = edits(rec).length;
  await p.click(rowButton('page-delete'));
  await toastSays(p, PAGE_SAY.last);
  await sendsNothing(rec, n0, 'Delete on the only page', 500);
  assert.deepEqual(fake.doc('minimal').pages.map((pg) => pg.id), ['p1'], 'the fake still has its page');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test('P1.6 a page delete undone', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { nobuy: NOBUY }, images: EVERY_IMAGES('nobuy') });
  await live(p);
  await showPageLink(p, 'p-parts');
  let n0 = edits(rec).length;
  await p.click(rowButton('page-delete'));
  const del = await nextEdit(rec, n0);
  assert.deepEqual(del.ops, [{ op: 'del', id: 'p-parts' }], 'one del of Parts');
  await accepted(rec, n0);
  await within(async () => (await shownPage(p)) === 'p-main', 'the page before (Checkout) shown', async () => shownPage(p));
  n0 = edits(rec).length;
  await undoKey(p);
  const back = await nextEdit(rec, n0);
  assert.deepEqual(back.ops[0], { op: 'add', node: { id: 'p-parts', type: 'page', parent: null, name: 'Parts' }, after: 'p-main' }, "the undo's first op re-adds the page, parent null");
  await accepted(rec, n0);
  assert.equal(edits(rec).length, n0 + 1, 'one edit frame');
  const d = fake.doc('nobuy');
  assert.deepEqual(d.pages, NOBUY.pages, "the fake's pages are nobuy's");
  assert.deepEqual(d.nodes, NOBUY.nodes, "the fake's nodes are nobuy's");
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test("P1.7 a page holding a used component isn't deleted", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  // SAME: nobuy with an instance of `button` on Parts itself
  const SAME = docVariant(NOBUY, (d) => {
    d.nodes['buy-here'] = { ...structuredClone(EVERY.nodes.buy), parent: 'p-parts' };
    d.pages[1].children.push('buy-here');
  });
  const { p, fake, rec, load } = await open(t, { canvases: { every: EVERY, same: SAME }, images: { ...EVERY_IMAGES('every'), ...EVERY_IMAGES('same') } });
  await live(p);
  await showPageLink(p, 'p-parts');
  const n0 = edits(rec).length;
  await p.click(rowButton('page-delete'));
  await toastSays(p, PAGE_SAY.used);
  await sendsNothing(rec, n0, 'Delete on Parts', 500);
  assert.equal(await shownPage(p), 'p-parts', 'Parts still shown');
  assert.deepEqual(fake.doc('every').pages.map((pg) => pg.id), ['p-main', 'p-parts'], 'the fake keeps Parts');
  // an instance on the component's own page: that page's delete is allowed
  await load('/view/canvas/same');
  await live(p);
  await showPageLink(p, 'p-parts');
  const n1 = edits(rec).length;
  await p.click(rowButton('page-delete'));
  const del = await nextEdit(rec, n1);
  assert.deepEqual(del.ops, [{ op: 'del', id: 'p-parts' }], 'one del of Parts');
  await accepted(rec, n1);
  assert.deepEqual(fake.doc('same').pages.map((pg) => pg.id), ['p-main'], 'Parts deleted');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

// ---- S5: kit-668 final-1 F1 ----

test("S5.1 a restart during a running fetch drops the old session's held frames", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const a = await ana(fake, later);
  fake.pause('every');
  const e1 = await rename(p, rec, 'dot', 'E one');
  await ackOf(rec, e1);
  await within(async () => (await kept(p)) === '1', 'data-kept 1 once E1 is acked', async () => `kept ${await kept(p)}`);
  // the refusal's fetch, held
  holdDocs(rec);
  await showPageLink(p, 'p-parts', { row: false });
  await selectRow(p, 'button-label');
  const n0 = edits(rec).length;
  await p.key('Delete');
  const del = await waitOps(rec, [{ op: 'del', id: 'button-label' }], 0, 'the del sent');
  assert.ok(edits(rec).length > n0);
  await within(async () => refusedFrames(rec).some((m) => m.seq === del.seq && m.why === 'ref'), 'the del refused ref', async () => JSON.stringify(rec.got.slice(-3)));
  await within(async () => rec.held.length === 1, "the refusal's doc request held", async () => rec.requests.join(' '), 5000);
  const revHeld = await body(p, 'rev');
  // Ana's rename reaches the page while the fetch is held
  await a.edit(nameSet('title', 'Gone'));
  await within(async () => rec.got.some((m) => m && m.t === 'ops' && JSON.stringify(m.ops) === JSON.stringify(nameSet('title', 'Gone'))), "Ana's ops frame reached the page", async () => JSON.stringify(rec.got.slice(-3)));
  assert.equal(await body(p, 'rev'), revHeld, "Ana's frame held by the page, not applied");
  // the restart: the document back to the last saved one, a new session
  fake.restart('every');
  await within(async () => welcomeCount(rec) >= 2, "the page's second welcome", async () => `welcomes ${welcomeCount(rec)}`);
  rec.release();
  rec.hold = null;
  await live(p);
  await hasRev(p, fake);
  await waitSeq(rec, e1, afterWelcome(rec, 2), 'E1 sent again, the same seq');
  await showPageLink(p, 'p-main', { row: false });
  await within(async () => (await rowName(p, 'title')) === EVERY.nodes.title.name, "title listed with the fixture's name", async () => rowName(p, 'title'));
  fake.resume('every');
  await allSaved(p);
  await hasRev(p, fake);
  assert.equal(await rowName(p, 'title'), EVERY.nodes.title.name, 'title never Gone');
  const d = fake.doc('every');
  assert.equal(d.nodes.dot.name, 'E one', "dot has E1's name");
  assert.equal(d.nodes.title.name, EVERY.nodes.title.name, "title has the fixture's name");
  assert.equal(refusedFrames(rec).length, 1, 'only the del refused');
  noDialogs(rec);
  noExceptions(rec);
});

// ---- M: multi-select ----

// PLACED: `every` with `tiles` at x 700, y 0, 100 × 100, clear of `card` and `loose`.
const PLACED = docVariant(EVERY, (d) => { Object.assign(d.nodes.tiles, { x: 700, y: 0, size: { w: 100, h: 100 } }); });
// A canvas of rects `<prefix><n>` named `Rect <n>`, `count` of them on the first page in a grid of
// `cols` columns, each `side` px square, `step` px apart; `more` changes it further.
function rectsCanvas(pagesList, { count, cols, side, step, prefix = 'r', parent = pagesList[0].id }, more = () => {}) {
  const base = { canvas: 1, rev: 0, tokens: {}, pages: pagesList.map((pg) => ({ ...pg, children: [] })), nodes: {} };
  return docVariant(base, (d) => {
    const holder = d.pages.find((pg) => pg.id === parent);
    for (let i = 1; i <= count; i++) {
      const id = `${prefix}${i}`;
      d.nodes[id] = { type: 'rect', parent, name: `Rect ${i}`, x: ((i - 1) % cols) * step, y: Math.floor((i - 1) / cols) * step, size: { w: side, h: side }, fill: '#d9d9d9' };
      if (holder) holder.children.push(id);
    }
    more(d);
  });
}
// MANY: one page, 120 rects r1…r120, a 12 × 10 grid of 10 × 10 px rects 20 px apart.
const MANY = rectsCanvas([{ id: 'p1', name: 'Page 1' }], { count: 120, cols: 12, side: 10, step: 20 });
// BIG: page `pa` with 3000 rects r1…r3000 (a 60 × 50 grid of 4 × 4 px, 6 px apart); page `pb` one rect.
const BIG = rectsCanvas([{ id: 'pa', name: 'Page A' }, { id: 'pb', name: 'Page B' }], { count: 3000, cols: 60, side: 4, step: 6 }, (d) => {
  d.nodes.q1 = { type: 'rect', parent: 'pb', name: 'Rect B', x: 0, y: 0, size: { w: 40, h: 40 }, fill: '#d9d9d9' };
  d.pages[1].children.push('q1');
});
// BIGC: one page holding a component `bc` of 1500 rects c1…c1500, its variant `loud` naming the last.
const BIGC = rectsCanvas([{ id: 'p1', name: 'Page 1' }], { count: 1500, cols: 40, side: 4, step: 10, prefix: 'c', parent: 'bc' }, (d) => {
  d.nodes.bc = { type: 'component', parent: 'p1', name: 'Big', x: 0, y: 0, size: { w: 400, h: 400 }, layout: { mode: 'none' }, children: Array.from({ length: 1500 }, (_, i) => `c${i + 1}`), variants: { loud: { c1500: { visible: false } } } };
  d.pages[0].children.push('bc');
});
const SAY_TOO_BIG = 'That change is too big to send.';
const OPS_MAX = 65536;
const bytesOf = (ops) => Buffer.byteLength(JSON.stringify(ops));
// The page's `select` frames with the browser's time each was sent (ms).
const selectsTimed = (rec, from = 0) => rec.sent.map((m, i) => ({ m, ts: rec.sentTs[i] * 1000, i })).slice(from).filter((x) => x.m && x.m.t === 'select');
const lastSelect = (rec) => { const s = selectsTimed(rec); return s.length ? s[s.length - 1].m.ids : null; };
const waitSelect = (rec, ids, what) => within(async () => JSON.stringify(lastSelect(rec)) === JSON.stringify(ids), what, async () => `last select ${JSON.stringify(lastSelect(rec))}`, 5000);
const selectedRows = (p) => p.ev("[...document.querySelectorAll('#layers .layer[aria-selected=\"true\"]')].map((r) => r.dataset.node)");
const outlined = (p) => p.ev("[...document.querySelectorAll('#surface .sel')].map((e) => e.dataset.id).sort()");
const waitRows = (p, ids, what) => within(async () => JSON.stringify(await selectedRows(p)) === JSON.stringify(ids), what, async () => JSON.stringify(await selectedRows(p)), 5000);
// A page point (page px) on screen.
async function pagePt(p, x, y) {
  const s = await box(p, '#surface');
  const z = await zoomNow(p);
  return { x: s.l + x * z, y: s.t + y * z };
}
// Focus on the page itself, so the arrows and Delete are the page's, not a row's.
const blurAll = (p) => p.ev('(() => { const a = document.activeElement; if (a && a !== document.body && typeof a.blur === \'function\') a.blur(); return true; })()');
const propsText = (p) => p.ev("document.getElementById('props').textContent");
// The drag rectangle from page point a to page point b, in steps of at most 10 px.
async function marquee(p, a, b) {
  await dragPath(p, [await pagePt(p, a.x, a.y), await pagePt(p, b.x, b.y)]);
}
const docOf = (d) => ({ pages: d.pages, nodes: d.nodes, tokens: d.tokens });

test('M1.1 shift-click selects several and sends select', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  assert.equal(await p.ev("document.getElementById('layers').getAttribute('aria-multiselectable')"), 'true', '#layers is multiselectable');
  const s0 = rec.sent.length;
  await p.click('#surface [data-id="title"]');
  await waitRows(p, ['title'], 'title selected');
  await shiftClick(p, '#surface [data-id="badge"]');
  await waitRows(p, ['title', 'badge'], 'title and badge selected');
  await shiftClick(p, '#layers .layer[data-node="dot"]');
  await waitRows(p, ['title', 'dot', 'badge'], 'title, dot and badge selected');
  assert.deepEqual(await outlined(p), ['badge', 'dot', 'title'], 'the three outlined');
  await waitSelect(rec, ['title', 'dot', 'badge'], 'a select of the three, in layer order');
  await shiftClick(p, '#layers .layer[data-node="dot"]');
  await waitRows(p, ['title', 'badge'], 'dot toggled off');
  assert.deepEqual(await outlined(p), ['badge', 'title'], 'two outlined');
  await waitSelect(rec, ['title', 'badge'], 'a later select of title and badge');
  await sleep(400);
  const sel = selectsTimed(rec, s0);
  for (let i = 1; i < sel.length; i++) assert.ok(sel[i].ts - sel[i - 1].ts >= 240, `select frames ${sel[i].ts - sel[i - 1].ts} ms apart`);
  assert.deepEqual(sel[sel.length - 1].m, { t: 'select', ids: ['title', 'badge'] }, 'the last select frame');
  assert.deepEqual(edits(rec), [], 'no edit');
  noDialogs(rec);
  noExceptions(rec);
});

test('M1.2 the drag rectangle selects top-level nodes', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { placed: PLACED }, images: EVERY_IMAGES('placed') });
  await live(p);
  await marquee(p, { x: -40, y: -40 }, { x: 650, y: 250 });
  await waitRows(p, ['card', 'loose'], 'card and loose selected, not tiles');
  await sleep(300);
  assert.deepEqual(await selectedRows(p), ['card', 'loose'], 'the click that ended it did not clear');
  assert.deepEqual(await outlined(p), ['card', 'loose']);
  assert.equal(await count(p, '.draft'), 0, 'the rectangle gone');
  assert.ok((await propsText(p)).includes('2 layers selected.'), 'the panel says 2 layers selected.');
  assert.equal(await text(p, '#props button[data-action="delete"]'), 'Delete layers');
  await waitSelect(rec, ['card', 'loose'], 'a select of card and loose');
  // Escape with the button down drops it, selecting nothing new
  await p.click('#layers .layer[data-node="tiles"]');
  await waitRows(p, ['tiles'], 'tiles selected');
  await dragPath(p, [await pagePt(p, -40, -40), await pagePt(p, 650, 250)], async () => {
    assert.equal(await count(p, '.draft'), 1, 'the rectangle drawn');
    await p.key('Escape');
  });
  await sleep(300);
  assert.deepEqual(await selectedRows(p), ['tiles'], 'Escape selected nothing new');
  assert.deepEqual(edits(rec), [], 'no edit');
  noDialogs(rec);
  noExceptions(rec);
});

test('M1.3 a move of the selection is one edit', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { placed: PLACED }, images: EVERY_IMAGES('placed') });
  await live(p);
  await p.click('#layers .layer[data-node="loose"]');
  await shiftClick(p, '#layers .layer[data-node="tiles"]');
  await waitRows(p, ['loose', 'tiles'], 'loose and tiles selected');
  const z = await zoomNow(p);
  const n0 = edits(rec).length;
  // slowly (live edits go while the button is down), then released
  const from = await pagePt(p, 500, 100);
  await slowDrag(p, from, { x: from.x + 40, y: from.y + 30 }, 500);
  await within(async () => edits(rec).length > n0 && (await body(p, 'pending')) === '0', 'the drag sent and acked');
  await accepted(rec, n0);
  assert.ok(edits(rec).length - n0 >= 2, `live edits went before the release (${edits(rec).length - n0} frames)`);
  for (const e of edits(rec).slice(n0)) {
    const of = (id) => e.ops.filter((o) => o.id === id).map((o) => [o.op, o.prop]).sort();
    assert.ok(e.ops.every((o) => o.op === 'set' && ['loose', 'tiles'].includes(o.id) && ['x', 'y'].includes(o.prop)), 'sets of x, y only');
    assert.deepEqual(of('loose'), of('tiles'), `the same properties of both: ${JSON.stringify(e.ops)}`);
  }
  const d = fake.doc('placed');
  assert.deepEqual([d.nodes.loose.x, d.nodes.loose.y], [Math.round(400 + 40 / z), Math.round(0 + 30 / z)], 'loose moved');
  assert.deepEqual([d.nodes.tiles.x, d.nodes.tiles.y], [Math.round(700 + 40 / z), Math.round(0 + 30 / z)], 'tiles moved');
  const n1 = edits(rec).length;
  await undoKey(p);
  const back = await nextEdit(rec, n1);
  assert.deepEqual(byProp(back.ops.filter((o) => o.id === 'loose')), [{ op: 'set', id: 'loose', prop: 'x', value: 400 }, { op: 'set', id: 'loose', prop: 'y', value: 0 }]);
  assert.deepEqual(byProp(back.ops.filter((o) => o.id === 'tiles')), [{ op: 'set', id: 'tiles', prop: 'x', value: 700 }, { op: 'set', id: 'tiles', prop: 'y', value: 0 }]);
  assert.equal(back.ops.length, 4, 'all four set back');
  await accepted(rec, n1);
  assert.equal(edits(rec).length, n1 + 1, 'one undo frame');
  noDialogs(rec);
  noExceptions(rec);
});

test('M1.4 a delete of the selection is one edit', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await p.click('#surface [data-id="title"]');
  await shiftClick(p, '#surface [data-id="badge"]');
  await waitRows(p, ['title', 'badge'], 'title and badge selected');
  await blurAll(p);
  const n0 = edits(rec).length;
  await p.key('Delete');
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'del', id: 'title' }, { op: 'del', id: 'badge' }]);
  await accepted(rec, n0);
  await sleep(300);
  assert.equal(edits(rec).length, n0 + 1, 'one edit frame');
  const d = fake.doc('every');
  assert.equal(Object.hasOwn(d.nodes, 'title') || Object.hasOwn(d.nodes, 'badge'), false, 'both gone from the fake');
  noDialogs(rec);
  noExceptions(rec);
});

test('M1.5 over 100 selected', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { many: MANY } });
  await live(p);
  await marquee(p, { x: -15, y: -15 }, { x: 250, y: 210 });
  await within(async () => (await selectedRows(p)).length === 120, 'all 120 selected', async () => String((await selectedRows(p)).length), 5000);
  const first100 = Array.from({ length: 100 }, (_, i) => `r${i + 1}`);
  await waitSelect(rec, first100, 'a select of r1…r100');
  assert.ok(selectsTimed(rec).every((x) => x.m.ids.length <= 100), 'no select of more than 100 ids');
  await blurAll(p);
  const n0 = edits(rec).length;
  await p.key('Delete');
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, Array.from({ length: 120 }, (_, i) => ({ op: 'del', id: `r${i + 1}` })), '120 dels');
  await accepted(rec, n0);
  await sleep(300);
  assert.equal(edits(rec).length, n0 + 1, 'one edit frame');
  assert.deepEqual(fake.doc('many').pages[0].children, [], "the fake's page empty");
  noDialogs(rec);
  noExceptions(rec);
});

test('M1.6 several nudged at once, roots only', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await p.click('#layers .layer[data-node="card"]');
  await shiftClick(p, '#layers .layer[data-node="badge"]');
  await waitRows(p, ['card', 'badge'], 'card and badge selected');
  await blurAll(p);
  let n0 = edits(rec).length;
  await arrow(p, 'ArrowRight');
  let e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'set', id: 'card', prop: 'x', value: 1 }, { op: 'set', id: 'badge', prop: 'x', value: 13 }]);
  await accepted(rec, n0);
  // badge inside loose: loose alone
  await p.click('#layers .layer[data-node="loose"]');
  await shiftClick(p, '#layers .layer[data-node="badge"]');
  await waitRows(p, ['loose', 'badge'], 'loose and badge selected');
  await blurAll(p);
  n0 = edits(rec).length;
  await arrow(p, 'ArrowRight');
  e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'set', id: 'loose', prop: 'x', value: 401 }]);
  await accepted(rec, n0);
  await sleep(300);
  assert.equal(edits(rec).length, n0 + 1, 'one nudge frame');
  // and a drag of loose: loose's sets only (badge at x 13 since the first nudge)
  assert.deepEqual([fake.doc('every').nodes.badge.x, fake.doc('every').nodes.badge.y], [13, -8], 'badge before the drag');
  const z = await zoomNow(p);
  n0 = edits(rec).length;
  await drag(p, await pagePt(p, 401 + 150, 150), 40, 30);
  await within(async () => edits(rec).length > n0 && (await body(p, 'pending')) === '0', 'the drag sent and acked');
  await accepted(rec, n0);
  for (const f of edits(rec).slice(n0)) assert.ok(onlyXY(f, 'loose'), `loose's x, y only: ${JSON.stringify(f.ops)}`);
  const d = fake.doc('every');
  assert.deepEqual([d.nodes.loose.x, d.nodes.loose.y], [Math.round(401 + 40 / z), Math.round(30 / z)], 'loose moved');
  assert.deepEqual([d.nodes.badge.x, d.nodes.badge.y], [13, -8], 'badge kept its x, y');
  noDialogs(rec);
  noExceptions(rec);
});

test('M1.7 the select resent on reconnect', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await p.click('#surface [data-id="title"]');
  await shiftClick(p, '#surface [data-id="badge"]');
  await waitSelect(rec, ['title', 'badge'], 'a select of title and badge');
  assert.ok(await closePageSocket(rec) >= 1, 'the socket closed');
  await within(async () => welcomeCount(rec) >= 2, 'the second welcome', async () => `welcomes ${welcomeCount(rec)}`);
  const from = afterWelcome(rec, 2);
  await within(async () => selectsTimed(rec, from).length > 0, 'a select after the second welcome', async () => JSON.stringify(rec.sent.slice(from)));
  assert.deepEqual(selectsTimed(rec, from)[0].m, { t: 'select', ids: ['title', 'badge'] }, 'the same ids again');
  noDialogs(rec);
  noExceptions(rec);
});

test('M1.8 a delete over 64 KB is split, and its undo too', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  assert.equal(bytesOf(Array.from({ length: 3000 }, (_, i) => ({ op: 'del', id: `r${i + 1}` }))), 76894, "the 3000 dels' bytes");
  const { p, fake, rec } = await open(t, { canvases: { big: BIG } });
  await live(p);
  await marquee(p, { x: -20, y: -20 }, { x: 380, y: 320 });
  await within(async () => (await selectedRows(p)).length === 3000, 'all 3000 selected', async () => String((await selectedRows(p)).length), 10000);
  await blurAll(p);
  let n0 = edits(rec).length;
  await p.key('Delete');
  await within(async () => (await body(p, 'pending')) === '0' && edits(rec).length > n0, 'the delete sent and acked', async () => `pending ${await body(p, 'pending')}`, 30000);
  await accepted(rec, n0, 30000);
  const dels = edits(rec).slice(n0);
  assert.ok(dels.length >= 2, `at least two edit frames (${dels.length})`);
  for (const f of dels) assert.ok(bytesOf(f.ops) <= OPS_MAX, `a part of ${bytesOf(f.ops)} bytes`);
  assert.deepEqual(dels.flatMap((f) => f.ops), Array.from({ length: 3000 }, (_, i) => ({ op: 'del', id: `r${i + 1}` })), 'the 3000 dels, in order');
  assert.deepEqual(fake.doc('big').pages[0].children, [], "pa empty in the fake");
  n0 = edits(rec).length;
  await undoKey(p);
  await within(async () => (await body(p, 'pending')) === '0' && edits(rec).length > n0, 'the undo sent and acked', async () => `pending ${await body(p, 'pending')}; ${await shownText(p, '#toast')}`, 30000);
  await accepted(rec, n0, 30000);
  const back = edits(rec).slice(n0);
  assert.ok(back.length >= 2, `at least two undo frames (${back.length})`);
  for (const f of back) assert.ok(bytesOf(f.ops) <= OPS_MAX, `an undo part of ${bytesOf(f.ops)} bytes`);
  const d = fake.doc('big');
  assert.deepEqual(d.pages, BIG.pages, "the fake's pages, children in order, are big's");
  assert.deepEqual(docOf(d), docOf(BIG), "the fake's document is big's");
  noDialogs(rec);
  noExceptions(rec);
});

test("M1.9 a page delete's undo over 64 KB", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { big: BIG } });
  await live(p);
  await within(async () => (await shownPage(p)) === 'pa', 'pa shown', async () => shownPage(p));
  let n0 = edits(rec).length;
  await p.click(rowButton('page-delete'));
  const del = await nextEdit(rec, n0);
  assert.deepEqual(del.ops, [{ op: 'del', id: 'pa' }], 'one del of pa');
  await accepted(rec, n0);
  n0 = edits(rec).length;
  await undoKey(p);
  await within(async () => (await body(p, 'pending')) === '0' && edits(rec).length > n0, 'the undo sent and acked', async () => `pending ${await body(p, 'pending')}; ${await shownText(p, '#toast')}`, 30000);
  await accepted(rec, n0, 30000);
  const back = edits(rec).slice(n0);
  assert.ok(back.length >= 2, `at least two undo frames (${back.length})`);
  for (const f of back) assert.ok(bytesOf(f.ops) <= OPS_MAX, `an undo part of ${bytesOf(f.ops)} bytes`);
  assert.deepEqual(back[0].ops[0], { op: 'add', node: { id: 'pa', type: 'page', parent: null, name: 'Page A' }, after: null }, "the first op re-adds the page");
  const d = fake.doc('big');
  assert.deepEqual(d.pages, BIG.pages, "the fake's pages, children in order, are big's");
  assert.deepEqual(docOf(d), docOf(BIG), "the fake's document is big's");
  noDialogs(rec);
  noExceptions(rec);
});

test('M1.10 an undo with no valid cut is refused', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { bigc: BIGC } });
  await live(p);
  await selectRow(p, 'bc');
  await blurAll(p);
  let n0 = edits(rec).length;
  await p.key('Delete');
  const del = await nextEdit(rec, n0);
  assert.deepEqual(del.ops, [{ op: 'del', id: 'bc' }], 'one del of bc');
  await accepted(rec, n0);
  await allSaved(p);
  const before = structuredClone(fake.doc('bigc'));
  n0 = edits(rec).length;
  await undoKey(p);
  await toastSays(p, SAY_TOO_BIG);
  await sendsNothing(rec, n0, 'the undo with no valid cut', 1000);
  assert.deepEqual(fake.doc('bigc'), before, "the fake's document as it was (bc still gone)");
  // the entry stays: the same words again, nothing sent
  await hideToast(p);
  await undoKey(p);
  await toastSays(p, SAY_TOO_BIG);
  await sendsNothing(rec, n0, 'the second Ctrl+Z', 1000);
  assert.deepEqual(fake.doc('bigc'), before, "the fake's document unchanged");
  noDialogs(rec);
  noExceptions(rec);
});

test('M1.11 a multi-drag whose nodes all leave the shown page sends them back', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { placed: PLACED }, images: EVERY_IMAGES('placed') });
  await live(p);
  const a = await ana(fake, later, 'placed');
  await p.click('#layers .layer[data-node="loose"]');
  await shiftClick(p, '#layers .layer[data-node="tiles"]');
  await waitRows(p, ['loose', 'tiles'], 'loose and tiles selected');
  const n0 = edits(rec).length;
  const from = await pagePt(p, 500, 100);
  await slowDrag(p, from, { x: from.x + 60, y: from.y + 40 }, 1000, null, {
    half: async () => {
      await within(async () => edits(rec).length > n0, 'a live edit before Ana moves them');
      // Ana moves both to Parts: off the shown page, still on the canvas
      await a.edit([{ op: 'move', id: 'loose', parent: 'p-parts', after: 'button' }, { op: 'move', id: 'tiles', parent: 'p-parts', after: 'loose' }]);
      await within(async () => (await count(p, '#layers .layer[data-node="loose"]')) === 0, "Ana's move drawn: loose off Checkout");
    },
  });
  await within(async () => (await body(p, 'pending')) === '0' && (await kept(p)) !== null, 'every edit acked', async () => `pending ${await body(p, 'pending')}`);
  await accepted(rec, n0);
  const d = fake.doc('placed');
  assert.deepEqual([d.nodes.loose.parent, d.nodes.loose.x, d.nodes.loose.y], ['p-parts', 400, 0], 'loose sent back to its start');
  assert.deepEqual([d.nodes.tiles.parent, d.nodes.tiles.x, d.nodes.tiles.y], ['p-parts', 700, 0], 'tiles sent back to its start');
  noDialogs(rec);
  noExceptions(rec);
});

test('M1.12 a held arrow with several selected merges, one undo', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await p.click('#layers .layer[data-node="card"]');
  await shiftClick(p, '#layers .layer[data-node="badge"]');
  await waitRows(p, ['card', 'badge'], 'card and badge selected');
  await blurAll(p);
  await sleep(1100); // the sender's last second clear
  const n0 = edits(rec).length;
  const k = { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 };
  // held: 30 keydowns (the later ones auto-repeats), then the keyup, as kit-662's held-key test
  const presses = [];
  for (let i = 0; i < 30; i++) presses.push(p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k, autoRepeat: i > 0 }));
  await Promise.all(presses);
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
  await within(async () => { const s = edits(rec).slice(n0); return s.length > 0 && s[s.length - 1].ops[0].value === 30; }, 'the last nudge sent', async () => JSON.stringify(edits(rec).slice(n0).map((x) => x.ops)), 10000);
  await waitSaved(p);
  await sleep(300);
  const burst = edits(rec).slice(n0);
  const at = rec.sentAt.filter((_, i) => rec.sent[i] && rec.sent[i].t === 'edit').slice(n0);
  assert.ok(burst.length < 30, `fewer than 30 edit frames (${burst.length})`);
  for (const f of burst) assert.deepEqual(f.ops.map((o) => [o.op, o.id, o.prop]), [['set', 'card', 'x'], ['set', 'badge', 'x']], 'each sets card x and badge x');
  const vals = burst.map((f) => f.ops[0].value);
  for (let i = 1; i < vals.length; i++) assert.ok(vals[i] > vals[i - 1], `rising: ${vals.join(' ')}`);
  assert.ok(vals.some((v, i) => (i === 0 ? v : v - vals[i - 1]) > 1), `at least one jump over 1 (coalesced): ${vals.join(' ')}`);
  for (const f of burst) assert.equal(f.ops[1].value, f.ops[0].value + 12, 'badge moves with card');
  for (let i = 0; i < at.length; i++) assert.ok(at.filter((x) => x >= at[i] && x < at[i] + 1000).length <= 21, 'at most 21 in any second');
  let d = fake.doc('every');
  assert.deepEqual([d.nodes.card.x, d.nodes.badge.x], [30, 42], 'the final positions');
  // one Ctrl+Z takes back the whole hold
  const n1 = edits(rec).length;
  await undoKey(p);
  const back = await nextEdit(rec, n1);
  assert.deepEqual(byProp(back.ops).map((o) => [o.id, o.prop, o.value]).sort(), [['badge', 'x', 12], ['card', 'x', 0]], 'both set back to their starts');
  await accepted(rec, n1);
  await sleep(300);
  assert.equal(edits(rec).length, n1 + 1, 'one undo frame');
  d = fake.doc('every');
  assert.deepEqual([d.nodes.card.x, d.nodes.badge.x], [0, 12], 'restored in the fake');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test("M1.13 a select naming a new node waits for its add's ack", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  // the acks held: a refused del starts a fetch, held by the recorder; frames that come meanwhile
  // (the add's ack) wait in the page, and its edits wait unsent
  holdDocs(rec);
  await showPageLink(p, 'p-parts', { row: false });
  await selectRow(p, 'button-label');
  await blurAll(p);
  await p.key('Delete');
  await within(async () => refusedFrames(rec).some((m) => m.why === 'ref'), 'the del refused ref', async () => JSON.stringify(rec.got.slice(-3)));
  await within(async () => rec.held.length === 1, "the refusal's doc request held", async () => rec.requests.join(' '), 5000);
  await showPageLink(p, 'p-main', { row: false });
  // a rectangle drawn on empty stage: added and selected
  await blurAll(p);
  await p.key('r');
  const at = await pagePt(p, -150, -150);
  await p.clickAt(at.x, at.y);
  await within(async () => (await selectedRows(p)).length === 1 && !['card', 'loose', 'tiles'].includes((await selectedRows(p))[0]), 'the new rect selected', async () => JSON.stringify(await selectedRows(p)));
  const [id] = await selectedRows(p);
  const naming = () => rec.sent.map((m, i) => ({ m, i })).filter((x) => x.m && x.m.t === 'select' && x.m.ids.includes(id));
  await sleep(1000);
  assert.deepEqual(naming(), [], 'no select naming it while its add is unacked');
  rec.release();
  rec.hold = null;
  await within(async () => naming().length > 0, 'a select naming it', async () => JSON.stringify(rec.sent.slice(-4)), 10000);
  const add = edits(rec).find((e) => e.ops.some((o) => o.op === 'add' && o.node && o.node.id === id));
  assert.ok(add, 'its add sent');
  const ack = await ackOf(rec, add);
  const ackAt = rec.gotAt[rec.got.indexOf(ack)];
  const sel = naming()[0];
  assert.ok(rec.sentAt[sel.i] >= ackAt, `the select (${rec.sentAt[sel.i]}) after the ack (${ackAt})`);
  assert.ok(sel.i > rec.sent.indexOf(add), 'the select after the add');
  noDialogs(rec);
  noExceptions(rec);
});

// ---- R: resize handles (spec §3) ----

// The handles shown, by data-handle, sorted.
const handles = (p) => p.ev("[...document.querySelectorAll('.handle')].map((h) => h.dataset.handle).sort()");
const handleSel = (h) => `.handle[data-handle="${h}"]`;
const handleAt = async (p, h) => centre(await box(p, handleSel(h)));
const waitHandles = (p, want, what) => within(async () => JSON.stringify(await handles(p)) === JSON.stringify([...want].sort()), what, async () => JSON.stringify(await handles(p)), 5000);
// Frames whose ops are all sets of `id`'s props among `props`.
const setsOnly = (m, id, props) => m.ops.length > 0 && m.ops.every((o) => o.op === 'set' && o.id === id && props.includes(o.prop));
// The last value each prop was sent with, over frames.
function lastSent(frames, id) {
  const v = {};
  for (const f of frames) for (const o of f.ops) if (o.op === 'set' && o.id === id) v[o.prop] = o.value;
  return v;
}
const SIZES = ['size.w', 'size.h'];
const XYWH = ['x', 'y', 'size.w', 'size.h'];
const HANDLES8 = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

test("R1.1 a loose node's corner resizes live, at most every 100 ms", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await p.click('#layers .layer[data-node="badge"]');
  await waitRows(p, ['badge'], 'badge selected');
  await waitHandles(p, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], 'eight handles');
  const z = await zoomNow(p);
  const b0 = await box(p, '#surface [data-id="badge"]');
  const a = await handleAt(p, 'se');
  near(a.x, b0.r, 1, 'se on the right edge');
  near(a.y, b0.b, 1, 'se on the bottom edge');
  const s0 = rec.sent.length;
  // 60 moves, one every 20 ms, the i-th to the press + (i, round(i × 2 / 3))
  await p.move(a.x, a.y);
  await mouse(p, 'mousePressed', a.x, a.y);
  let next = Date.now();
  let hiddenMid = null;
  for (let i = 1; i <= 60; i++) {
    next += 20;
    const wait = next - Date.now();
    if (wait > 0) await sleep(wait);
    await mouse(p, 'mouseMoved', a.x + i, a.y + Math.round((i * 2) / 3));
    if (i === 30) hiddenMid = await count(p, '.handle');
  }
  const beforeRelease = rec.sent.length;
  await mouse(p, 'mouseReleased', a.x + 60, a.y + 40);
  const releasedAt = Date.now();
  assert.equal(hiddenMid, 0, 'no handles while the resize is under way');
  const want = { 'size.w': Math.round(24 + 60 / z), 'size.h': Math.round(24 + 40 / z) };
  await within(async () => { const v = lastSent(edits(rec), 'badge'); return v['size.w'] === want['size.w'] && v['size.h'] === want['size.h']; }, 'the final sizes sent', async () => JSON.stringify(edits(rec).slice(-3).map((e) => e.ops)), 5000);
  const wait = releasedAt + 500 - Date.now();
  if (wait > 0) await sleep(wait);
  const frames = editsTimed(rec, s0);
  for (const f of frames) assert.ok(setsOnly(f.m, 'badge', SIZES), `only badge's size.w / size.h: ${JSON.stringify(f.m.ops)}`);
  const before = frames.filter((f) => f.i < beforeRelease).length;
  t.diagnostic(`${frames.length} frames, ${before} before the release`);
  assert.ok(before >= 5, `at least 5 frames before the release (${before})`);
  const span = frames[frames.length - 1].ts - frames[0].ts;
  assert.ok(frames.length <= span / 100 + 1, `at most one per 100 ms: ${frames.length} frames in ${span.toFixed(1)} ms`);
  for (let i = 1; i < frames.length; i++) {
    const gap = frames[i].ts - frames[i - 1].ts;
    assert.ok(gap >= 70, `no two frames under 70 ms apart (${gap.toFixed(1)} ms, frames ${i - 1} and ${i})`);
  }
  assert.deepEqual(lastSent(frames.map((f) => f.m), 'badge'), want, 'the last values sent');
  await allSaved(p);
  assert.deepEqual(fake.doc('every').nodes.badge.size, { w: want['size.w'], h: want['size.h'] }, "the fake's badge size");
  assert.deepEqual([fake.doc('every').nodes.badge.x, fake.doc('every').nodes.badge.y], [12, -8], 'x, y unchanged');
  assert.deepEqual(await selectedRows(p), ['badge'], 'still badge alone selected');
  assert.equal(await count(p, '.draft'), 0, 'no rectangle');
  await waitHandles(p, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], 'the handles back');
  const b1 = await box(p, '#surface [data-id="badge"]');
  const se = await handleAt(p, 'se');
  near(se.x, b1.r, 1, 'se follows the new right edge');
  near(se.y, b1.b, 1, 'se follows the new bottom edge');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test('R1.2 left and top handles send x and y', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await p.click('#layers .layer[data-node="badge"]');
  await waitHandles(p, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], 'eight handles');
  const z = await zoomNow(p);
  const n0 = edits(rec).length;
  await drag(p, await handleAt(p, 'nw'), -20, -10);
  await within(async () => edits(rec).length > n0, 'the resize sent');
  await allSaved(p);
  await accepted(rec, n0);
  for (const f of edits(rec).slice(n0)) assert.ok(setsOnly(f, 'badge', XYWH), `x, y, size.w, size.h of badge only: ${JSON.stringify(f.ops)}`);
  const w = Math.round(24 + 20 / z);
  const h = Math.round(24 + 10 / z);
  let d = fake.doc('every').nodes.badge;
  assert.deepEqual({ x: d.x, y: d.y, size: d.size }, { x: Math.round(12 - 20 / z), y: Math.round(-8 - 10 / z), size: { w, h } }, "the fake's badge");
  assert.deepEqual(await selectedRows(p), ['badge'], 'the press on the handle selected nothing else');
  // an e drag, moved down too: size.w alone
  await waitHandles(p, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], 'the handles back');
  const n1 = edits(rec).length;
  await drag(p, await handleAt(p, 'e'), 16, 12);
  await within(async () => edits(rec).length > n1, 'the e resize sent');
  await allSaved(p);
  await accepted(rec, n1);
  for (const f of edits(rec).slice(n1)) assert.ok(setsOnly(f, 'badge', ['size.w']), `size.w alone: ${JSON.stringify(f.ops)}`);
  d = fake.doc('every').nodes.badge;
  assert.deepEqual({ x: d.x, y: d.y, size: d.size }, { x: Math.round(12 - 20 / z), y: Math.round(-8 - 10 / z), size: { w: Math.round(w + 16 / z), h } }, "the fake's badge after the e drag");
  noDialogs(rec);
  noExceptions(rec);
});

test('R1.3 an auto-layout child sends fixed sizes only', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await p.click('#layers .layer[data-node="photo"]');
  await waitRows(p, ['photo'], 'photo selected');
  await waitHandles(p, ['e', 's', 'se'], 'exactly e, s and se');
  const z = await zoomNow(p);
  const dw = (await box(p, '#surface [data-id="photo"]')).w;
  const n0 = edits(rec).length;
  const a = await handleAt(p, 'se');
  await slowDrag(p, a, { x: a.x + 30, y: a.y + 20 }, 400);
  await within(async () => edits(rec).length > n0, 'the resize sent');
  await allSaved(p);
  await accepted(rec, n0);
  for (const f of edits(rec).slice(n0)) {
    assert.ok(setsOnly(f, 'photo', SIZES), `sets of photo's size.w / size.h only: ${JSON.stringify(f.ops)}`);
    assert.ok(f.ops.every((o) => typeof o.value === 'number'), `numbers only: ${JSON.stringify(f.ops)}`);
  }
  const s = fake.doc('every').nodes.photo.size;
  assert.equal(typeof s.w, 'number', 'fill became a fixed width');
  near(s.w, Math.round(dw / z + 30 / z), 1, "the fake's photo width");
  assert.equal(s.h, Math.round(120 + 20 / z), "the fake's photo height");
  assert.deepEqual(await selectedRows(p), ['photo'], 'still photo selected');
  noDialogs(rec);
  noExceptions(rec);
});

test('R1.4 Escape restores, and a resize is one undo', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await p.click('#layers .layer[data-node="badge"]');
  await waitHandles(p, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], 'eight handles');
  const n0 = edits(rec).length;
  let nEsc = null;
  const a = await handleAt(p, 'se');
  await slowDrag(p, a, { x: a.x + 40, y: a.y + 30 }, 400, async () => {
    await within(async () => edits(rec).length > n0, 'a live frame seen', async () => '', 5000);
    nEsc = edits(rec).length;
    await p.key('Escape');
  });
  // a live frame already on its way when Escape went may land after nEsc; the restore is the frame
  // after the live ones, and the last
  const is24 = (f) => JSON.stringify(byProp(f.ops)) === JSON.stringify([{ op: 'set', id: 'badge', prop: 'size.h', value: 24 }, { op: 'set', id: 'badge', prop: 'size.w', value: 24 }]);
  await within(async () => edits(rec).slice(nEsc).some(is24), 'the restore sent', async () => JSON.stringify(edits(rec).slice(nEsc).map((f) => f.ops)), 5000);
  await allSaved(p);
  await accepted(rec, n0);
  assert.deepEqual(fake.doc('every').nodes.badge.size, { w: 24, h: 24 }, "the fake's badge is 24 × 24");
  await sleep(300);
  const after = edits(rec).slice(nEsc);
  assert.ok(is24(after[after.length - 1]), 'the restore sets both sizes back, the last frame');
  assert.ok(after.length <= 2, `at most one live frame in flight before it (${after.length} frames)`);
  for (const f of after) assert.ok(setsOnly(f, 'badge', SIZES), `sizes of badge only: ${JSON.stringify(f.ops)}`);
  // a full resize (live edits and the release), then Ctrl+Z: one frame setting both back
  await waitHandles(p, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], 'the handles back');
  const n1 = edits(rec).length;
  const b = await handleAt(p, 'se');
  await slowDrag(p, b, { x: b.x + 40, y: b.y + 30 }, 500);
  await within(async () => edits(rec).length > n1 + 1, 'live frames and the release sent');
  await allSaved(p);
  await accepted(rec, n1);
  assert.notDeepEqual(fake.doc('every').nodes.badge.size, { w: 24, h: 24 }, 'resized');
  await blurAll(p);
  const n2 = edits(rec).length;
  await undoKey(p);
  const u = await nextEdit(rec, n2);
  assert.deepEqual(byProp(u.ops), [{ op: 'set', id: 'badge', prop: 'size.h', value: 24 }, { op: 'set', id: 'badge', prop: 'size.w', value: 24 }], 'one undo sets both back');
  await accepted(rec, n2);
  await sleep(300);
  assert.equal(edits(rec).length, n2 + 1, 'one undo frame');
  assert.deepEqual(fake.doc('every').nodes.badge.size, { w: 24, h: 24 }, 'undone in the fake');
  // the restore pushed no entry: the next Ctrl+Z has nothing of the resize to undo
  const n3 = edits(rec).length;
  await undoKey(p);
  await sendsNothing(rec, n3, 'a second Ctrl+Z');
  noDialogs(rec);
  noExceptions(rec);
});

test('R1.5 no handles for several, none watching', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec, size } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await p.click('#layers .layer[data-node="badge"]');
  await waitHandles(p, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], 'eight handles for badge alone');
  // they follow the view: zoomed in, still on badge's corners
  await p.click('#zoomIn');
  await within(async () => { const b = await box(p, '#surface [data-id="badge"]'); const h = await box(p, handleSel('nw')); return b && h && Math.abs(centre(h).x - b.l) <= 1 && Math.abs(centre(h).y - b.t) <= 1; }, 'nw on the zoomed top-left');
  const hb = await box(p, handleSel('nw'));
  assert.deepEqual([Math.round(hb.w), Math.round(hb.h)], [8, 8], '8 × 8 px');
  await shiftClick(p, '#layers .layer[data-node="title"]');
  await waitRows(p, ['title', 'badge'], 'title and badge selected');
  await waitHandles(p, [], 'no handle with two selected');
  await p.click('#layers .layer[data-node="badge"]');
  await waitHandles(p, ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], 'eight again');
  await size(700, 900);
  await waitHandles(p, [], 'no handle at 700 px wide');
  noDialogs(rec);
  noExceptions(rec);
});

// `every` with the 8 × 8 `dot` moved out of the column `card` into the `none` frame `loose` at (100, 100),
// so it is placed by x, y and gets all eight handles.
const SMALL = docVariant(EVERY, (d) => {
  d.nodes.card.children = d.nodes.card.children.filter((k) => k !== 'dot');
  d.nodes.loose.children.push('dot');
  Object.assign(d.nodes.dot, { parent: 'loose', x: 100, y: 100 });
});

test('R1.6 a small node moves from inside and resizes from outside its box', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { small: SMALL }, images: EVERY_IMAGES('small') });
  await live(p);
  const z = await zoomNow(p);
  await p.click('#layers .layer[data-node="dot"]');
  await waitRows(p, ['dot'], 'dot selected');
  await waitHandles(p, HANDLES8, 'eight handles on dot');
  // a press at its centre (under the handles) and a drag: a move, x and y only
  const c = centre(await box(p, '#surface [data-id="dot"]'));
  assert.equal(await p.ev(`document.elementFromPoint(${c.x}, ${c.y})?.classList.contains('handle') ?? false`), true, "dot's centre is under a handle");
  const n0 = edits(rec).length;
  await drag(p, c, 30, 20);
  await within(async () => edits(rec).length > n0, 'the move sent');
  await allSaved(p);
  await accepted(rec, n0);
  for (const f of edits(rec).slice(n0)) assert.ok(setsOnly(f, 'dot', ['x', 'y']), `x, y of dot only: ${JSON.stringify(f.ops)}`);
  let d = fake.doc('small').nodes.dot;
  assert.deepEqual([d.parent, d.x, d.y, d.size], ['loose', Math.round(100 + 30 / z), Math.round(100 + 20 / z), { w: 8, h: 8 }], "the fake's dot moved, not resized");
  assert.deepEqual(await selectedRows(p), ['dot'], 'still dot selected');
  // a press on the outer half of se (outside dot's box) and a drag: a resize, sizes only
  await waitHandles(p, HANDLES8, 'the handles back');
  const b = await box(p, '#surface [data-id="dot"]');
  const hb = await box(p, handleSel('se'));
  const out = { x: Math.round(hb.r - 2), y: Math.round(hb.b - 2) };
  assert.ok(out.x > b.r && out.y > b.b, `the press (${out.x}, ${out.y}) outside dot's box (${b.r}, ${b.b})`);
  assert.equal(await p.ev(`document.elementFromPoint(${out.x}, ${out.y})?.dataset.handle ?? null`), 'se', 'the press is on se');
  const n1 = edits(rec).length;
  await drag(p, out, 20, 10);
  await within(async () => edits(rec).length > n1, 'the resize sent');
  await allSaved(p);
  await accepted(rec, n1);
  for (const f of edits(rec).slice(n1)) assert.ok(setsOnly(f, 'dot', SIZES), `size.w, size.h of dot only: ${JSON.stringify(f.ops)}`);
  d = fake.doc('small').nodes.dot;
  assert.deepEqual([d.x, d.y, d.size], [Math.round(100 + 30 / z), Math.round(100 + 20 / z), { w: Math.round(8 + 20 / z), h: Math.round(8 + 10 / z) }], "the fake's dot resized, not moved");
  // back to 8 × 8 by Ctrl+Z, then Shift+click on its centre (under the handles) takes it out
  await blurAll(p);
  const n2 = edits(rec).length;
  await undoKey(p);
  await nextEdit(rec, n2);
  await allSaved(p);
  assert.deepEqual(fake.doc('small').nodes.dot.size, { w: 8, h: 8 }, 'dot 8 × 8 again');
  await waitHandles(p, HANDLES8, 'the handles on the small dot');
  const c2 = centre(await box(p, '#surface [data-id="dot"]'));
  assert.equal(await p.ev(`document.elementFromPoint(${c2.x}, ${c2.y})?.classList.contains('handle') ?? false`), true, "dot's centre is under a handle");
  const n3 = edits(rec).length;
  await shiftClick(p, '#surface [data-id="dot"]');
  await waitRows(p, [], 'Shift+click took dot out of the selection');
  await waitHandles(p, [], 'no handles');
  await sendsNothing(rec, n3, 'the Shift+click');
  noDialogs(rec);
  noExceptions(rec);
});

// ---- C: copy and paste ----

const HOSTILE_TEXT = fs.readFileSync(path.join(FIX, 'hostile.json'), 'utf8');
const HOSTILE = JSON.parse(HOSTILE_TEXT);
const NEW_ID = /^[0-9a-z]{6}-\d+$/;
const PASTE_SAY = {
  notClip: "That isn't a canvas's layers, so nothing was pasted.",
  tooMuch: 'That is too much to paste at once.',
  frames: "Instances of components this canvas doesn't have were pasted as frames.",
  rects: "Images this canvas doesn't have were pasted as rectangles.",
  values: "Some values weren't valid here, so they were left out.",
};
// Ctrl+C and Ctrl+V as a keyboard sends them, running the browser's own copy and paste.
const copyKey = (p) => key(p, 'c', { ctrl: true, commands: ['copy'] });
const pasteKey = (p) => key(p, 'v', { ctrl: true, commands: ['paste'] });
// An add's node without its id.
const nodeless = (nd) => Object.fromEntries(Object.entries(nd).filter(([k]) => k !== 'id'));
// A node's drawn box in the shown page's px, rounded.
async function drawnAt(p, id) {
  const b = await box(p, `#surface [data-id="${id}"]`);
  const s = await box(p, '#surface');
  const z = await zoomNow(p);
  return { x: Math.round((b.l - s.l) / z), y: Math.round((b.t - s.t) / z), w: Math.round(b.w / z), h: Math.round(b.h / z) };
}
const rowNames = (p) => p.ev("[...document.querySelectorAll('#layers .layer[data-node]')].map((r) => [r.dataset.node, r.querySelector('.nm').textContent])");

// kit-661's census (test/canvas-editor.test.mjs), copied. Before the page loads: alert, confirm, prompt
// and print replaced by recorders (window.dialogTraps).
const DIALOG_TRAPS = `(() => {
  const calls = [];
  Object.defineProperty(window, 'dialogTraps', { value: calls });
  for (const name of ['alert', 'confirm', 'prompt', 'print']) {
    const trap = function () { calls.push([name, ...[...arguments].map(String)]); return name === 'confirm' ? false : name === 'prompt' ? null : undefined; };
    Object.defineProperty(window, name, { value: trap, writable: false, configurable: false });
  }
})();`;
const addTraps = (rec) => rec.send('Page.addScriptToEvaluateOnNewDocument', { source: DIALOG_TRAPS });
// The DOM's census: the elements a document's markup would add, and every on* attribute.
const CENSUS = `(() => ({
  traps: Array.isArray(window.dialogTraps) && ['alert', 'confirm', 'prompt', 'print'].every((k) => String(window[k]).includes('calls.push')),
  calls: window.dialogTraps ?? null,
  script: document.querySelectorAll('script').length,
  style: document.querySelectorAll('style').length,
  foreign: [...document.querySelectorAll('iframe, object, embed, link, b')].map((e) => e.localName),
  meta: [...document.querySelectorAll('meta')].map((m) => (m.hasAttribute('charset') ? 'charset' : m.name)),
  on: [...document.querySelectorAll('*')].flatMap((e) => [...e.attributes].filter((a) => /^on/i.test(a.name)).map((a) => e.localName + ' ' + a.name)),
}))()`;
// No dialog opened, no trap called, and the DOM holds only the page's own markup.
async function ranNothing(p, rec, what, taken = null) {
  assert.deepEqual(rec.dialogs, [], `${what}: no dialog opened`);
  const c = taken ?? await p.ev(CENSUS);
  assert.equal(c.traps, true, `${what}: the dialog traps are in place`);
  assert.deepEqual(c.calls, [], `${what}: no dialog function called`);
  assert.equal(c.script, 1, `${what}: one script element`);
  assert.equal(c.style, 1, `${what}: one style element`);
  assert.deepEqual(c.foreign, [], `${what}: no iframe, object, embed, link or b`);
  assert.deepEqual(c.meta, ['charset', 'viewport'], `${what}: only the page's own meta`);
  assert.deepEqual(c.on, [], `${what}: no on* attribute anywhere`);
}

test('C1.1 copy and paste on the same page', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await selectRow(p, 'loose');
  await blurAll(p);
  const n0 = edits(rec).length;
  await copyKey(p);
  await pasteKey(p);
  const e = await nextEdit(rec, n0);
  assert.equal(e.ops.length, 2, `two adds: ${JSON.stringify(e.ops)}`);
  const [a, b] = e.ops;
  for (const o of [a, b]) assert.match(o.node.id, NEW_ID, 'a new id');
  assert.notEqual(a.node.id, b.node.id);
  assert.ok(!['loose', 'badge'].includes(a.node.id) && !['loose', 'badge'].includes(b.node.id), 'not the originals');
  assert.deepEqual({ ...a, node: nodeless(a.node) }, { op: 'add', node: { type: 'frame', parent: 'p-main', name: 'Loose', layout: { mode: 'none' }, size: { w: 200, h: 200 }, x: 420, y: 20 }, after: 'tiles' }, "loose's copy, 20 px right and down");
  assert.deepEqual({ ...b, node: nodeless(b.node) }, { op: 'add', node: { type: 'rect', parent: a.node.id, name: 'Badge', x: 12, y: -8, size: { w: 24, h: 24 }, radius: 12, fill: '#ef4444' }, after: null }, "badge's copy in it");
  await accepted(rec, n0);
  await sleep(300);
  assert.equal(edits(rec).length, n0 + 1, 'one edit frame');
  await waitRows(p, [a.node.id], 'the copy selected');
  await allSaved(p);
  const d = fake.doc('every');
  assert.deepEqual([d.nodes.loose, d.nodes.badge], [EVERY.nodes.loose, EVERY.nodes.badge], 'the originals unchanged');
  assert.deepEqual(d.pages[0].children, ['card', 'loose', 'tiles', a.node.id], 'the copy last on Checkout');
  assert.deepEqual(d.nodes[a.node.id].children, [b.node.id], "badge's copy in loose's");
  noDialogs(rec);
  noExceptions(rec);
});

test('C1.2 paste on another page', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await selectRow(p, 'title');
  await shiftClick(p, '#layers .layer[data-node="dot"]');
  await waitRows(p, ['title', 'dot'], 'title and dot selected');
  const at = { title: await drawnAt(p, 'title'), dot: await drawnAt(p, 'dot') };
  await blurAll(p);
  await copyKey(p);
  await showPageLink(p, 'p-parts');
  await blurAll(p);
  const n0 = edits(rec).length;
  await pasteKey(p);
  const e = await nextEdit(rec, n0);
  assert.equal(e.ops.length, 2, `two adds: ${JSON.stringify(e.ops)}`);
  const [a, b] = e.ops;
  assert.deepEqual([a.op, a.node.type, a.node.parent, a.after], ['add', 'text', 'p-parts', 'button'], "title's copy after Parts' last node");
  assert.deepEqual([b.op, b.node.type, b.node.parent, b.after], ['add', 'ellipse', 'p-parts', a.node.id], "dot's copy after title's");
  assert.deepEqual([a.node.x, a.node.y], [at.title.x, at.title.y], "title's copy at its drawn position on Checkout");
  assert.deepEqual([b.node.x, b.node.y], [at.dot.x, at.dot.y], "dot's copy at its drawn position on Checkout");
  assert.deepEqual(a.node.size, { w: at.title.w, h: 'hug' }, "title's fill width as drawn");
  assert.equal(typeof a.node.size.w, 'number');
  assert.deepEqual([a.node.font, a.node.color, b.node.fill], [{ $ref: 'type.body' }, { $ref: 'color.ink' }, { $ref: 'color.brand' }], 'tokens this canvas has kept as references');
  assert.equal(a.node.text, 'Order summary');
  await accepted(rec, n0);
  await waitRows(p, [a.node.id, b.node.id], 'both copies selected');
  for (const id of [a.node.id, b.node.id]) assert.equal(await count(p, `#surface [data-id="${id}"]`), 1, `${id} drawn on Parts`);
  noDialogs(rec);
  noExceptions(rec);
});

test('C1.3 an instance whose component is here', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await selectRow(p, 'buy');
  await blurAll(p);
  await hideToast(p);
  const n0 = edits(rec).length;
  await copyKey(p);
  await pasteKey(p);
  const e = await nextEdit(rec, n0);
  assert.equal(e.ops.length, 1, `one add: ${JSON.stringify(e.ops)}`);
  const nd = e.ops[0].node;
  assert.match(nd.id, NEW_ID);
  assert.deepEqual([nd.type, nd.component, nd.variant, nd.parent, e.ops[0].after], ['instance', 'button', 'primary', 'p-main', 'tiles'], 'an instance of button');
  assert.deepEqual([nd.props, nd.overrides], [EVERY.nodes.buy.props, EVERY.nodes.buy.overrides], 'its props and overrides kept');
  await accepted(rec, n0);
  await waitRows(p, [nd.id], 'the copy selected');
  assert.equal(await shownText(p, '#toast'), null, 'nothing said');
  noDialogs(rec);
  noExceptions(rec);
});

test('C1.4 hostile.json from another canvas adds nothing that runs or loads', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const H = HOSTILE;
  const { p, fake, origin, rec } = await open(t, { canvases: { minimal: MINIMAL }, beforeLoad: addTraps });
  await live(p);
  const n0 = edits(rec).length;
  await pasteText(p, HOSTILE_TEXT);
  const e = await nextEdit(rec, n0);
  const ORDER = ['hf', 'ht', 'hr', 'hv', 'him', 'hc', 'hct', 'hi', 'he'];
  assert.equal(e.ops.length, 9, `nine adds: ${JSON.stringify(e.ops.map((o) => [o.op, o.node?.type]))}`);
  assert.ok(e.ops.every((o) => o.op === 'add'), 'all adds');
  const op = Object.fromEntries(ORDER.map((id, i) => [id, e.ops[i]]));
  const nid = Object.fromEntries(ORDER.map((id) => [id, op[id].node.id]));
  for (const id of ORDER) assert.match(nid[id], NEW_ID, `${id}'s copy has a new id`);
  assert.equal(new Set(Object.values(nid)).size, 9, 'nine ids');
  // (b)
  assert.deepEqual(ORDER.map((id) => op[id].node.type), ['frame', 'text', 'rect', 'vector', 'rect', 'component', 'text', 'frame', 'ellipse'], 'the types, in order');
  assert.deepEqual(ORDER.map((id) => [op[id].node.parent, op[id].after]), [
    ['p1', null], [nid.hf, null], [nid.hf, nid.ht], [nid.hf, nid.hr], [nid.hf, nid.hv],
    ['p1', nid.hf], [nid.hc, null], ['p1', nid.hc], ['p1', nid.hi],
  ], 'parents and afters');
  assert.deepEqual(Object.keys(op.hi.node).sort(), ['id', 'name', 'parent', 'type'], 'hi pasted as a frame: no component, variant, props or overrides');
  assert.deepEqual(nodeless(op.him.node), { type: 'rect', parent: nid.hf, name: H.nodes.him.name, fill: '#d9d9d9' }, 'him pasted as a rect, no src');
  assert.equal(op.hr.node.fill, '#ff0000', "hr's fill: the clip's color.brand");
  assert.deepEqual(op.hc.node.variants, { loud: { [nid.hct]: { text: H.nodes.hct.text } } }, "hc's variant keyed by hct's copy");
  assert.deepEqual(op.hc.node.props, { label: { ...H.nodes.hc.props.label, target: { id: nid.hct, prop: 'text' } } }, "hc's prop aimed at hct's copy");
  assert.equal(op.hv.node.path, H.nodes.hv.path);
  for (const id of ORDER) assert.equal(op[id].node.name, H.nodes[id].name, `${id}'s name exactly`);
  for (const id of ['ht', 'hct']) assert.equal(op[id].node.text, H.nodes[id].text, `${id}'s text exactly`);
  await accepted(rec, n0);
  await allSaved(p);
  assert.deepEqual(docErrors(fake.doc('minimal'), { images: null }), [], "the fake's document valid");
  // (a)
  const img = `${origin}/api/canvas/image/minimal/${IMG_FILE}`;
  assert.equal(rec.requests.filter((u) => u === img).length, 1, 'the image asked for once');
  const allowed = [`${origin}/view/canvas/minimal`, `${origin}/api/canvas/doc?slug=minimal`, img, `${origin}/favicon.ico`];
  assert.deepEqual([...rec.urls].filter((u) => !allowed.includes(u)), [], `no other request (saw ${[...rec.urls].join(' ')})`);
  // (c)
  await toastSays(p, `${PASTE_SAY.frames} ${PASTE_SAY.rects}`);
  // (d)
  await sleep(300);
  await ranNothing(p, rec, 'after the paste');
  const rows = await rowNames(p);
  assert.deepEqual(rows.map(([id]) => id), ORDER.map((id) => nid[id]), 'every copy has its row');
  for (const [id, name] of rows) assert.equal(name, H.nodes.hf.name, `${id}'s Layers row shows the name as text`);
  noDialogs(rec);
  noExceptions(rec);
});

test('C1.5 not a canvas', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const n0 = edits(rec).length;
  const clipOf = (nodes, children = Object.keys(nodes)) => ({ canvas: 1, rev: 0, tokens: {}, pages: [{ id: 'p-main', name: 'Checkout', children }], nodes });
  const badge = { ...EVERY.nodes.badge, parent: 'p-main' };
  const notClips = [
    'hello', '{"canvas":1}', '[]', 'null',
    JSON.stringify({ ...clipOf({ badge }), extra: 1 }), // a key the top doesn't have
    JSON.stringify(clipOf({ badge: { ...badge, id: 'badge' } })), // a node holding an id key
    JSON.stringify(clipOf({ badge }, [])), // a node no page lists
    JSON.stringify(clipOf({ badge: { ...badge, type: 'star' } })), // an unknown type
    JSON.stringify(clipOf({ 'a.b': { ...badge } }, ['a.b'])), // an id out of form
    JSON.stringify(clipOf({ c1: { type: 'component', parent: 'p-main', children: ['c2'] }, c2: { type: 'component', parent: 'c1', children: [] } }, ['c1'])), // a component in a component
  ];
  for (const s of notClips) {
    await hideToast(p);
    await pasteText(p, s);
    await toastSays(p, PASTE_SAY.notClip);
  }
  await sendsNothing(rec, n0, 'pastes that are not a canvas');
  await hideToast(p);
  await pasteText(p, JSON.stringify(clipOf({ badge: { ...badge, fill: 'url(x)' } })));
  const e = await nextEdit(rec, n0);
  assert.equal(e.ops.length, 1, `one add: ${JSON.stringify(e.ops)}`);
  assert.deepEqual({ ...e.ops[0], node: nodeless(e.ops[0].node) }, { op: 'add', node: { type: 'rect', parent: 'p-main', name: 'Badge', x: 12, y: -8, size: { w: 24, h: 24 }, radius: 12 }, after: 'tiles' }, 'badge pasted without its fill');
  await toastSays(p, PASTE_SAY.values);
  await accepted(rec, n0);
  noDialogs(rec);
  noExceptions(rec);
});

test('C1.6 a paste over 64 KB is refused', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const clip = { canvas: 1, rev: 0, tokens: {}, pages: [{ id: 'q', name: 'Q', children: [] }], nodes: {} };
  for (let i = 1; i <= 1500; i++) {
    clip.nodes[`n${i}`] = { type: 'rect', parent: 'q', name: `Rect ${String(i).padStart(25, '0')}`, x: (i % 40) * 10, y: Math.floor(i / 40) * 10, size: { w: 4, h: 4 }, fill: '#d9d9d9' };
    clip.pages[0].children.push(`n${i}`);
  }
  clip.nodes.img = { type: 'image', parent: 'q', name: 'Image', src: `images/${IMG_FILE}` };
  clip.pages[0].children.push('img');
  assert.equal(clip.nodes.n1.name.length, 30);
  assert.deepEqual(docErrors(clip, { images: null }), [], 'the clip is a valid document');
  const { p, rec } = await open(t, { canvases: { minimal: MINIMAL } });
  await live(p);
  const n0 = edits(rec).length;
  const r0 = rec.requests.length;
  await pasteText(p, JSON.stringify(clip));
  await toastSays(p, PASTE_SAY.tooMuch);
  await sendsNothing(rec, n0, 'the paste over 64 KB');
  assert.deepEqual(rec.requests.slice(r0).filter((u) => u.includes('/api/canvas/image/')), [], 'no image asked for');
  noDialogs(rec);
  noExceptions(rec);
});

test('C1.7 copy writes a canvas-doc@1 document', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await selectRow(p, 'loose');
  const clip = JSON.parse(await clipNow(p));
  assert.deepEqual(docErrors(clip, { images: null }), [], 'a valid document');
  assert.deepEqual(clip.pages, [{ id: 'p-main', name: 'Checkout', children: ['loose'] }], 'its one page');
  assert.deepEqual(Object.keys(clip.nodes).sort(), ['badge', 'loose'], 'loose and badge');
  assert.deepEqual([clip.nodes.loose, clip.nodes.badge], [EVERY.nodes.loose, EVERY.nodes.badge], 'as stored (loose drawn where it is stored)');
  assert.deepEqual([clip.canvas, clip.rev, clip.tokens], [1, 0, {}]);
  // a text in a column: drawn position and width, its tokens copied with their groups
  await selectRow(p, 'title');
  const at = await drawnAt(p, 'title');
  const c2 = JSON.parse(await clipNow(p));
  assert.deepEqual(docErrors(c2, { images: null }), [], 'a valid document');
  assert.deepEqual(c2.tokens, { type: { body: EVERY.tokens.type.body }, color: { ink: EVERY.tokens.color.ink } }, 'the tokens it names');
  assert.deepEqual(c2.nodes.title, { ...EVERY.nodes.title, parent: 'p-main', x: at.x, y: at.y, size: { w: at.w, h: 'hug' } }, 'title at its drawn place and width');
  // nothing selected: the browser's own copy
  await blurAll(p);
  await p.key('Escape');
  await waitRows(p, [], 'nothing selected');
  assert.equal(await clipNow(p), '', 'no clip with nothing selected');
  noDialogs(rec);
  noExceptions(rec);
});

test("C1.8 in a field the paste is the field's", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await selectRow(p, 'title');
  await blurAll(p);
  await copyKey(p);
  assert.equal(await focusField(p, 'name'), true, 'the Name field focused');
  assert.equal(await clipNow(p), '', 'a copy in the field is the browser\'s');
  const n0 = edits(rec).length;
  await pasteKey(p);
  await sendsNothing(rec, n0, 'Ctrl+V in the Name field');
  assert.equal(await p.ev('document.activeElement?.dataset.prop ?? null'), 'name', 'the field still focused');
  noDialogs(rec);
  noExceptions(rec);
});

test('C1.9 an image this canvas has stays an image', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, origin, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await selectRow(p, 'photo');
  await blurAll(p);
  await copyKey(p);
  await hideToast(p);
  const r0 = rec.requests.length;
  const n0 = edits(rec).length;
  await pasteKey(p);
  const e = await nextEdit(rec, n0);
  assert.equal(e.ops.length, 1, `one add: ${JSON.stringify(e.ops)}`);
  assert.deepEqual([e.ops[0].op, e.ops[0].node.type, e.ops[0].node.src], ['add', 'image', `images/${IMG_FILE}`], 'an image');
  await accepted(rec, n0);
  await sleep(500);
  const img = `${origin}/api/canvas/image/every/${IMG_FILE}`;
  // The check is the one `fetch` of the image route. Chrome drops its in-memory copy of an image when
  // a fetch asks for the same URL (any cache mode, probed), so the pasted image's own drawing loads it
  // again as an Image request: counted apart, by the recorder's resource type (Chrome reports the
  // page's fetch as XHR or Fetch).
  // Ruling m-20261119-121523795: strict.
  const after = rec.requests.map((u, i) => [u, rec.kinds[i]]).slice(r0);
  assert.deepEqual(after.filter(([u]) => u !== img), [], `no request but for the image: ${JSON.stringify(after)}`);
  assert.equal(after.filter(([, k]) => k === 'Fetch' || k === 'XHR').length, 1, `the image checked once by fetch: ${JSON.stringify(after)}`);
  assert.ok(after.every(([, k]) => k === 'Fetch' || k === 'XHR' || k === 'Image'), `else only the drawing's loads: ${JSON.stringify(after)}`);
  assert.equal(await shownText(p, '#toast'), null, 'nothing said');
  noDialogs(rec);
  noExceptions(rec);
});

test('C1.10 hostile values outside free text are left out', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  // computed keys, so `__proto__` is an own key of each object, as JSON.parse makes it
  const nodes = {
    im1: { type: 'image', parent: 'q', name: 'Evil 1', src: 'https://evil.example/a.png' },
    im2: { type: 'image', parent: 'q', name: 'Evil 2', src: 'images/../../429be16d0a91e377.png' },
    im3: { type: 'image', parent: 'q', name: 'Evil 3', src: 'javascript:alert(1)' },
    r1: { type: 'rect', parent: 'q', name: 'Wrong ref', fill: { $ref: 'space.m' }, radius: { $ref: 'color.brand' }, ['__proto__']: { polluted: 1 } },
    i1: {
      type: 'instance', parent: 'q', name: 'Inst', component: 'button',
      props: { label: 'Hi', constructor: 'x', ['__proto__']: 'y' },
      overrides: { 'button-label': { text: 'ok', name: 'X', bogus: 1, 'layout.gap': 4 }, ['__proto__']: { visible: false }, constructor: { visible: false } },
    },
    ['__proto__']: { type: 'rect', parent: 'q', name: 'Proto', x: 1, y: 2 },
  };
  const order = ['im1', 'im2', 'im3', 'r1', 'i1', '__proto__'];
  const clip = { canvas: 1, rev: 0, tokens: {}, pages: [{ id: 'q', name: 'Q', children: order }], nodes };
  const s = JSON.stringify(clip);
  assert.ok(s.includes('"__proto__":{"type":"rect"'), 'the clip text holds a __proto__ node');
  await hideToast(p);
  const r0 = rec.requests.length;
  const n0 = edits(rec).length;
  await pasteText(p, s);
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops.map((o) => [o.op, o.node.type, o.node.name]), [['add', 'rect', 'Wrong ref'], ['add', 'instance', 'Inst'], ['add', 'rect', 'Proto']], 'the images with a src outside images/ left out');
  const [r1, i1, proto] = e.ops.map((o) => o.node);
  for (const nd of [r1, i1, proto]) assert.match(nd.id, NEW_ID, 'a new id');
  assert.deepEqual(nodeless(r1), { type: 'rect', parent: 'p-main', name: 'Wrong ref' }, 'refs of the wrong type and the __proto__ key left out');
  assert.deepEqual([i1.props, i1.overrides], [{ label: 'Hi' }, { 'button-label': { text: 'ok' } }], 'props and overrides the component lacks or the target cannot take left out');
  assert.deepEqual(nodeless(proto), { type: 'rect', parent: 'p-main', name: 'Proto', x: 1, y: 2 }, 'the __proto__ node pasted as a plain node, under a new id');
  assert.ok(!JSON.stringify(e.ops).includes('__proto__') && !JSON.stringify(e.ops).includes('constructor') && !JSON.stringify(e.ops).includes('polluted'), 'no __proto__, constructor or polluted in what is sent');
  await toastSays(p, PASTE_SAY.values);
  await accepted(rec, n0);
  assert.equal(await p.ev("Object.keys(Object.prototype).length === 0 && ({}).polluted === undefined && ({}).type === undefined && ({}).visible === undefined"), true, 'Object.prototype untouched');
  assert.deepEqual(rec.requests.slice(r0), [], 'nothing loaded');
  noDialogs(rec);
  noExceptions(rec);
});

// The paste's own time on the page: the dispatch of the paste event to its return, then until #toast says `words`.
const pasteTimed = (p, s) => p.ev(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(s)}); const t0 = performance.now(); document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return performance.now() - t0; })()`);

test('C1.11 a deep or wide hostile clip is refused or handled at once', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const N = 20000;
  // the review's clip: a component holding a chain of 19999 frames, a variant naming every one
  const deep = { canvas: 1, rev: 0, tokens: {}, pages: [{ id: 'pg', name: 'P', children: ['c'] }], nodes: {} };
  deep.nodes.c = { type: 'component', parent: 'pg', children: ['n0'], variants: { v: {} } };
  for (let i = 0; i < N - 1; i++) {
    deep.nodes[`n${i}`] = { type: 'frame', parent: i ? `n${i - 1}` : 'c', children: i < N - 2 ? [`n${i + 1}`] : [] };
    deep.nodes.c.variants.v[`n${i}`] = { visible: false };
  }
  // the same nodes side by side: depth 2, so it is built, and refused only by its size
  const wide = { canvas: 1, rev: 0, tokens: {}, pages: [{ id: 'pg', name: 'P', children: ['c'] }], nodes: {} };
  wide.nodes.c = { type: 'component', parent: 'pg', children: [], variants: { v: {} } };
  for (let i = 0; i < N - 1; i++) {
    wide.nodes[`n${i}`] = { type: 'frame', parent: 'c', children: [] };
    wide.nodes.c.children.push(`n${i}`);
    wide.nodes.c.variants.v[`n${i}`] = { visible: false };
  }
  const { p, rec } = await open(t, { canvases: { minimal: MINIMAL } });
  await live(p);
  const n0 = edits(rec).length;
  for (const [what, clip, words] of [['deep', deep, PASTE_SAY.notClip], ['wide', wide, PASTE_SAY.tooMuch]]) {
    await hideToast(p);
    const ms = await pasteTimed(p, JSON.stringify(clip));
    assert.ok(ms < 2000, `${what}: the paste took ${Math.round(ms)} ms, under 2 s`);
    await toastSays(p, words);
  }
  await sendsNothing(rec, n0, 'the deep and wide pastes');
  noDialogs(rec);
  noExceptions(rec);
});
