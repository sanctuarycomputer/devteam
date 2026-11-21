import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { openCanvas, startCanvasFake, docErrors } from './canvas-fake.mjs';
import { cleanup, openChrome } from './chrome.mjs';
import { until } from './kit.mjs';

// The canvas harness test/canvas-editing*, canvas-editor-tools* and canvas-sync*.test.mjs share, moved
// verbatim from those files (kit-224); `recorder` is canvas-editor-tools' copy, which records the most.

export const here = path.dirname(fileURLToPath(import.meta.url));

export const PAGE_FILE = path.join(here, '..', '..', 'docs', 'devteam', 'dashboard', 'canvas.html');

export const FIX = path.join(here, '..', 'fixtures', 'canvas');

export const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));

export const IMG_FILE = '429be16d0a91e377.png';

export const IMG = fs.readFileSync(path.join(FIX, 'images', IMG_FILE));

export const EVERY = fixture('doc-every-type.json');

export const EVERY_IMAGES = (slug) => ({ [slug]: { [IMG_FILE]: IMG } });

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
  res.writeHead(404, { 'Content-Length': 0 });
  res.end();
}

export const DOM_GONE = /navigated or closed|Cannot find context|context was destroyed|Execution context|Inspected target navigated/i;

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
export async function recorder(ws, origin, answer) {
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
export async function open(t, { canvases = {}, images = {}, repo, size = [1440, 900], path: at, answer, beforeLoad } = {}) {
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

export const text = (p, sel) => p.ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);

export const count = (p, sel) => p.ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);

export const body = (p, key) => p.ev(`document.body.dataset[${JSON.stringify(key)}] ?? null`);

// `until` with a shorter bound, and what was last seen (`why()`) in its failure.
export async function within(f, what, why = async () => '', ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await f()) return;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what} (${await why()})`);
    await sleep(50);
  }
}

// Nothing the page ran threw (Runtime.exceptionThrown on the recorder's connection): every test ends on it.
export const noExceptions = (rec, what = 'the page') => assert.deepEqual(rec.exceptions.map((e) => e.exception?.description ?? e.text), [], `${what}: no exception`);

// ---- the socket's frames ----

// The page's edit frames, in the order sent.
export const edits = (rec) => rec.sent.filter((m) => m && m.t === 'edit');

// The page's edit after the first `n0` (its index n0), once it is sent.
export async function nextEdit(rec, n0, ms = 10000) {
  await within(async () => edits(rec).length > n0, `an edit frame after the first ${n0}`, async () => JSON.stringify(rec.sent.slice(-5)), ms);
  return edits(rec)[n0];
}

// The server's `ops` frame acking `edit` (its client and seq), once it arrives.
export async function ackOf(rec, edit, ms = 10000) {
  const find = () => rec.got.find((m) => m && m.t === 'ops' && m.ack && m.ack.client === edit.client && m.ack.seq === edit.seq);
  await within(async () => !!find(), `the ack of seq ${edit.seq}`, async () => JSON.stringify(rec.got.slice(-5)), ms);
  return find();
}

export const refusedFrames = (rec) => rec.got.filter((m) => m && m.t === 'refused');

// The doc requests the page made, in order.
export const docRequests = (rec, slug) => rec.requests.filter((u) => u.endsWith(`/api/canvas/doc?slug=${slug}`));

// ---- the page's state and its panel ----

export const live = (p) => within(async () => (await body(p, 'live')) === 'on', 'data-live on', async () => `data-live ${await body(p, 'live')}`);

// Everything the page holds is acked and saved: data-pending 0 and data-saved equal to data-rev.
export async function waitSaved(p) {
  const why = async () => `pending ${await body(p, 'pending')}, saved ${await body(p, 'saved')}, rev ${await body(p, 'rev')}`;
  await within(async () => (await body(p, 'pending')) === '0' && (await body(p, 'saved')) === (await body(p, 'rev')) && (await body(p, 'rev')) !== null, 'pending 0 and saved at rev', why);
}

export const selectRow = async (p, id) => {
  await p.click(`#layers .layer[data-node="${id}"]`);
  await within(async () => (await p.ev(`document.querySelector('#layers .layer[data-node="${id}"]')?.getAttribute('aria-selected')`)) === 'true', `${id}'s row selected`);
};

// Focus a field's control, its text selected (so typing replaces it).
export const focusField = (p, prop) => p.ev(`(() => { const e = document.querySelector('#props [data-prop="${prop}"]'); if (!e) return false; e.focus(); if (typeof e.select === 'function') e.select(); return document.activeElement === e; })()`);

// Enter as a keyboard sends it: the key with its text ("\r"), which is what commits an input (the
// helper's key('Enter') carries no text, so an input never sees it as Enter).
export async function enter(p) {
  const k = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k, text: '\r', unmodifiedText: '\r' });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
}

// Typed, key by key: letters, digits and space by the helper's key(); any other character as a key
// event carrying only its text (the helper gives `(` the virtual key code 40, ArrowDown, `#` 35, End,
// `.` 46, Delete, so Chrome would take them for those keys).
export async function typeKeys(p, s) {
  for (const c of s) {
    if (/^[A-Za-z0-9 ]$/.test(c)) { await p.key(c); continue; }
    await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: c, text: c, unmodifiedText: c });
    await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: c });
  }
}

// Focus out of the Properties panel: a click on its title (not focusable), so a deferred rebuild runs.
export const leavePanel = (p) => p.click('.panel.right .ptitle');

// Change a field by real input, then leave the panel: an input has its text selected, typed over and
// Enter pressed; the `text` textarea is typed and Tabbed out of (Enter there is a new line); a select is
// set by value with a `change` event (headless Chrome opens no popup); a button group is clicked; a
// checkbox is clicked when it isn't already `value` (true or false).
export async function fieldSet(p, prop, value) {
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
export const propControls = (p) => p.ev(`[...document.querySelectorAll('#props [data-prop]')].map((e) => {
  const off = e.matches('input, select, textarea, button, fieldset') ? e.disabled : (() => { const b = [...e.querySelectorAll('button')]; return b.length > 0 && b.every((x) => x.disabled); })();
  return { prop: e.dataset.prop, off };
})`);

// The words and banners (spec §1, §2).
export const SAY = {
  ref: "That is still used by a component, an instance or a token, so it wasn't changed.",
  instancesFirst: "Delete this component's instances first.",
};

export const BANNER = {
  paused: "Saving paused: the canvas's branch changed. Your edits are kept here.",
  landed: 'This canvas has landed. It is read-only until it is opened for editing again.',
  down: 'Reconnecting… your edits are kept here.',
};

export const shownText = (p, sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.hidden || e.getClientRects().length === 0 || getComputedStyle(e).visibility === 'hidden') return null; return e.textContent; })()`);

// Another person on the canvas: the fake's own client, as Ana.
export const ANA = { 'x-devteam-person': 'ana;name=Ana' };

export const ANA_CLIENT = 'ana0000000000000';

export async function ana(fake, later, slug = 'every') {
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
export async function closePageSocket(rec) {
  const proto = await rec.send('Runtime.evaluate', { expression: 'WebSocket.prototype' });
  const found = await rec.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId });
  const r = await rec.send('Runtime.callFunctionOn', {
    objectId: found.objects.objectId,
    functionDeclaration: 'function () { for (const w of this) w.close(); return this.length; }',
    returnByValue: true,
  });
  return r.result.value;
}

export const titleRowName = (p) => text(p, '#layers .layer[data-node="title"] .nm');

// ---- kit-668's helpers ----

export const kept = (p) => body(p, 'kept');

export const noDialogs = (rec) => assert.deepEqual(rec.dialogs, [], 'no dialog');

// The page's edit frames with that seq, among rec.sent from index `from` on.
export const framesWithSeq = (rec, seq, from = 0) => rec.sent.slice(from).filter((m) => m && m.t === 'edit' && m.seq === seq);

// The page's edit frames from index `from` of rec.sent on whose ops deep-equal `ops`.
export const framesWithOps = (rec, ops, from = 0) => rec.sent.slice(from).filter((m) => {
  if (!m || m.t !== 'edit') return false;
  try { assert.deepEqual(m.ops, ops); return true; } catch { return false; }
});

// The server's frames of kind `t` with when each was seen ({ m, at, i }).
export const gotOf = (rec, t) => rec.got.map((m, i) => ({ m, at: rec.gotAt[i], i })).filter((x) => x.m && x.m.t === t);

// The index in rec.sent of the first frame the page sent at or after `at` (rec.sent.length when none yet).
export const sentFrom = (rec, at) => { const i = rec.sentAt.findIndex((s) => s >= at); return i < 0 ? rec.sent.length : i; };

// The index in rec.sent of the first frame sent after the n-th welcome (1 for the first) was received.
export const afterWelcome = (rec, n) => {
  const w = gotOf(rec, 'welcome')[n - 1];
  assert.ok(w, `a welcome number ${n}`);
  return sentFrom(rec, w.at);
};

export const welcomeCount = (rec) => gotOf(rec, 'welcome').length;

// Release the held requests as they come, until none has been held for `quietMs`; the hold stays.
export async function releaseAll(rec, quietMs = 500, ms = 20000) {
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
export async function docNow(origin, slug = 'every') {
  const r = await fetch(`${origin}/api/canvas/doc?slug=${slug}`);
  assert.equal(r.status, 200, 'the doc response read by the test');
  return r.json();
}

export const holdDocs = (rec, slug = 'every') => { rec.hold = (u) => u.endsWith(`/api/canvas/doc?slug=${slug}`); };

export const nameSet = (id, value) => [{ op: 'set', id, prop: 'name', value }];

export const rowName = (p, id) => text(p, `#layers .layer[data-node="${id}"] .nm`);

// A node renamed by its Name field (its row selected first); resolves the edit frame once it is sent.
export async function rename(p, rec, id, value) {
  await selectRow(p, id);
  const n0 = edits(rec).length;
  await fieldSet(p, 'name', value);
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, nameSet(id, value), `one set of ${id}'s name`);
  return e;
}

// Wait for a frame sent from index `from` on: by seq (and the same ops as `e`) or by ops.
export async function waitSeq(rec, e, from, what) {
  await within(async () => framesWithSeq(rec, e.seq, from).length > 0, what, async () => JSON.stringify(rec.sent.slice(-4)));
  for (const f of framesWithSeq(rec, e.seq, from)) assert.deepEqual(f.ops, e.ops, `${what}: the same ops`);
}

export async function waitOps(rec, ops, from, what) {
  await within(async () => framesWithOps(rec, ops, from).length > 0, what, async () => JSON.stringify(rec.sent.slice(-4)));
  return framesWithOps(rec, ops, from)[0];
}

export const allSaved = (p) => within(async () => (await body(p, 'pending')) === '0' && (await kept(p)) === '0' && (await body(p, 'saved')) === (await body(p, 'rev')),
  'pending 0, kept 0 and saved at rev', async () => `pending ${await body(p, 'pending')}, kept ${await kept(p)}, saved ${await body(p, 'saved')}, rev ${await body(p, 'rev')}`);

// kit-662's drag helpers (test/canvas-editing.test.mjs), copied.
// An element's box on screen.
export const box = (p, sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()`);

export const zoomNow = (p) => p.ev("new DOMMatrix(getComputedStyle(document.getElementById('surface')).transform).a");

export const hitAt = (p, pt) => p.ev(`(() => { const e = document.elementFromPoint(${pt.x}, ${pt.y}); return e ? (e.closest('#surface [data-id]')?.dataset.id ?? e.id ?? null) : null; })()`);

export const mouse = (p, type, x, y, extra = {}) => p.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });

// A left drag from `a` by (dx, dy), in steps; `mid` runs while the button is still down.
export async function drag(p, a, dx, dy, mid = null) {
  await p.move(a.x, a.y);
  await mouse(p, 'mousePressed', a.x, a.y);
  for (let i = 1; i <= 4; i++) await mouse(p, 'mouseMoved', a.x + (dx * i) / 4, a.y + (dy * i) / 4);
  if (mid) await mid();
  await mouse(p, 'mouseReleased', a.x + dx, a.y + dy);
}

// A left press at the first point, moved through the others in steps of at most 10 px, released at the
// last; `mid` runs before the release, the button still down.
export async function dragPath(p, pts, mid = null) {
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

export const ARROW_CODE = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };

// An arrow key as a keyboard sends it, Shift held when asked.
export async function arrow(p, k, shift = false) {
  const e = { key: k, code: k, windowsVirtualKeyCode: ARROW_CODE[k], nativeVirtualKeyCode: ARROW_CODE[k], modifiers: shift ? 8 : 0 };
  await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...e });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...e });
}

export const centre = (b) => ({ x: Math.round(b.l + b.w / 2), y: Math.round(b.t + b.h / 2) });

// No edit frame after the first n0 for `ms`.
export async function sendsNothing(rec, n0, what, ms = 600) {
  await sleep(ms);
  assert.deepEqual(edits(rec).slice(n0).map((e) => e.ops), [], `${what}: nothing sent`);
}

export const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} within ${tol} of ${b}`);

// A slow left drag: pressed at `from`, moved to `to` (a point, or a list of points passed through in
// turn) in moves of at most 2 px, one every 20 ms, taking at least `ms` in all (more when the way is
// longer than 2 px a move allows); `mid` runs before the release, the button still down; `half` runs
// once half the moves are made, the button down, before the rest.
export async function slowDrag(p, from, to, ms, mid = null, { half = null } = {}) {
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

export const CANT_GO = "That layer can't go there.";

export const kidsOf = (fake, id) => fake.doc('every').nodes[id].children;

// The page's edit frames with the browser's time each was sent (ms), from rec.sent's index `from` on.
export const editsTimed = (rec, from = 0) => rec.sent.map((m, i) => ({ m, ts: rec.sentTs[i] * 1000, i })).slice(from).filter((x) => x.m && x.m.t === 'edit');

export const setsOf = (m) => m.ops.map((o) => [o.op, o.id, o.prop]);

export const onlyXY = (m, id) => m.ops.length > 0 && m.ops.every((o) => o.op === 'set' && o.id === id && (o.prop === 'x' || o.prop === 'y'));

// x and y as the page's set frames left them, from `start` on.
export function sentXY(frames, id, start) {
  const v = { ...start };
  for (const f of frames) for (const o of f.ops) if (o.op === 'set' && o.id === id && (o.prop === 'x' || o.prop === 'y')) v[o.prop] = o.value;
  return v;
}

// A live frame of `id` carrying (x, y) seen in rec.sent from `from` on (frames of x, y sets only).
export const liveAt = (rec, from, id, start, want) => {
  const f = editsTimed(rec, from).map((x) => x.m).filter((m) => onlyXY(m, id));
  const v = sentXY(f, id, start);
  return f.length > 0 && v.x === want.x && v.y === want.y;
};

// The drag's target position: the start moved by the pointer's (dx, dy) screen px at zoom z, whole px.
export const moved = (start, dx, dy, z) => ({ x: Math.round(start.x + dx / z), y: Math.round(start.y + dy / z) });

// Ctrl and a letter key as a keyboard sends it (Ctrl as modifiers 2).
export async function ctrl(p, key) {
  const u = key.toUpperCase();
  const e = { key, code: `Key${u}`, windowsVirtualKeyCode: u.charCodeAt(0), nativeVirtualKeyCode: u.charCodeAt(0), modifiers: 2 };
  await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...e });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...e });
}

// Focus on the page itself (nothing focused), then Ctrl+Z.
export async function undoKey(p) {
  await p.ev('(() => { const a = document.activeElement; if (a && a !== document.body && typeof a.blur === \'function\') a.blur(); return true; })()');
  await ctrl(p, 'z');
}

export const UNDO_SAY = {
  none: 'Nothing to undo.',
  all: "Someone else changed that since, so it wasn't undone.",
  part: 'Part of that was changed by someone else since, so only the rest was undone.',
};

export const hideToast = (p) => p.ev("(() => { const t = document.getElementById('toast'); t.hidden = true; t.textContent = ''; return true; })()");

export const toastSays = (p, words) => within(async () => (await shownText(p, '#toast')) === words, `#toast says ${JSON.stringify(words)}`, async () => shownText(p, '#toast'), 5000);

export const hasRev = (p, fake) => within(async () => (await body(p, 'rev')) === String(fake.rev('every')), 'data-rev equals the fake rev', async () => `${await body(p, 'rev')} vs ${fake.rev('every')}`);

export const byProp = (ops) => [...ops].sort((a, b) => String(a.prop).localeCompare(String(b.prop)));
// ---- kit-669's helpers ----

// Every edit frame the page sent from edits(rec)[from] on got its ack, and no `refused` came for any
// of them (the page's own client: refused frames go only to the client that sent the edit).
export async function accepted(rec, from, ms = 10000) {
  const mine = edits(rec).slice(from);
  assert.ok(mine.length > 0, `an edit frame from index ${from}`);
  const answered = (e) => rec.got.some((m) => m && ((m.t === 'ops' && m.ack && m.ack.client === e.client && m.ack.seq === e.seq) || (m.t === 'refused' && m.client === e.client && m.seq === e.seq)));
  await within(async () => mine.every(answered), `every edit from index ${from} answered`, async () => JSON.stringify(rec.got.slice(-4)), ms);
  const client = mine[0].client;
  assert.deepEqual(refusedFrames(rec).filter((m) => m.client === client && mine.some((e) => e.seq === m.seq)), [], `the edits from index ${from}: none refused`);
}

// A copy of `base` changed by `f`, checked valid by the fake's own rules (no image folder); its `refs`
// errors allowed only when `refs` is true (a test that says so).
export function docVariant(base, f, { refs = false } = {}) {
  const d = structuredClone(base);
  f(d);
  const errs = docErrors(d, { images: null }).filter((e) => !(refs && e.rule === 'refs'));
  assert.deepEqual(errs, [], 'the variant document is valid');
  return d;
}

// A Shift+click in the middle of what `sel` finds: a press and release with modifiers 8.
export async function shiftClick(p, sel) {
  const at = await p.at(sel);
  await p.move(at.x, at.y, 8);
  await mouse(p, 'mousePressed', at.x, at.y, { modifiers: 8 });
  await mouse(p, 'mouseReleased', at.x, at.y, { modifiers: 8 });
}

// One key as a keyboard sends it, Ctrl (modifiers 2) and Shift (8) held when asked; `commands` are the
// editing commands it runs (['copy'], ['paste']), as Chrome's own key bindings would.
export const KEY_VK = { Backspace: 8, Tab: 9, Enter: 13, Escape: 27, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };

export async function key(p, k, { ctrl: c = false, shift = false, commands } = {}) {
  const letter = /^[A-Za-z]$/.test(k);
  const vk = KEY_VK[k] ?? k.toUpperCase().charCodeAt(0);
  const e = { key: k, code: letter ? `Key${k.toUpperCase()}` : /^[0-9]$/.test(k) ? `Digit${k}` : k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: (c ? 2 : 0) | (shift ? 8 : 0) };
  await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...e, ...(commands ? { commands } : {}) });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...e });
}

export const MINIMAL = fixture('doc-minimal.json');

export const shownPage = (p) => p.ev("document.querySelector('#pages a[aria-current=\"page\"]')?.dataset.page ?? null");

export const pageLink = (id) => `#pages a[data-page="${id}"]`;

// The shown page's row button for `action` (page-rename, page-up, page-down, page-delete).
export const rowButton = (action) => `#pages button[data-action="${action}"]`;

// Show a page by its link, and wait until it is shown (marked current, in the address); with `row`,
// until its row holds the buttons too.
export async function showPageLink(p, id, { row = true } = {}) {
  await p.click(pageLink(id));
  await within(async () => (await shownPage(p)) === id && (await p.ev('location.hash')) === `#page=${encodeURIComponent(id)}`, `page ${id} shown`, async () => `${await shownPage(p)} ${await p.ev('location.hash')}`);
  if (row) await within(async () => (await count(p, rowButton('page-delete'))) === 1 && (await p.ev(`!!document.querySelector(${JSON.stringify(pageLink(id))})?.closest('.prow')?.querySelector('[data-action="page-delete"]')`)), `${id}'s row holds the buttons`);
}

// PLACED: `every` with `tiles` at x 700, y 0, 100 × 100, clear of `card` and `loose`.
export const PLACED = docVariant(EVERY, (d) => { Object.assign(d.nodes.tiles, { x: 700, y: 0, size: { w: 100, h: 100 } }); });

// A canvas of rects `<prefix><n>` named `Rect <n>`, `count` of them on the first page in a grid of
// `cols` columns, each `side` px square, `step` px apart; `more` changes it further.
export function rectsCanvas(pagesList, { count, cols, side, step, prefix = 'r', parent = pagesList[0].id }, more = () => {}) {
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

// The page's `select` frames with the browser's time each was sent (ms).
export const selectsTimed = (rec, from = 0) => rec.sent.map((m, i) => ({ m, ts: rec.sentTs[i] * 1000, i })).slice(from).filter((x) => x.m && x.m.t === 'select');

export const lastSelect = (rec) => { const s = selectsTimed(rec); return s.length ? s[s.length - 1].m.ids : null; };

export const waitSelect = (rec, ids, what) => within(async () => JSON.stringify(lastSelect(rec)) === JSON.stringify(ids), what, async () => `last select ${JSON.stringify(lastSelect(rec))}`, 5000);

export const selectedRows = (p) => p.ev("[...document.querySelectorAll('#layers .layer[aria-selected=\"true\"]')].map((r) => r.dataset.node)");

export const waitRows = (p, ids, what) => within(async () => JSON.stringify(await selectedRows(p)) === JSON.stringify(ids), what, async () => JSON.stringify(await selectedRows(p)), 5000);

// A page point (page px) on screen.
export async function pagePt(p, x, y) {
  const s = await box(p, '#surface');
  const z = await zoomNow(p);
  return { x: s.l + x * z, y: s.t + y * z };
}

// Focus on the page itself, so the arrows and Delete are the page's, not a row's.
export const blurAll = (p) => p.ev('(() => { const a = document.activeElement; if (a && a !== document.body && typeof a.blur === \'function\') a.blur(); return true; })()');

// The drag rectangle from page point a to page point b, in steps of at most 10 px.
export async function marquee(p, a, b) {
  await dragPath(p, [await pagePt(p, a.x, a.y), await pagePt(p, b.x, b.y)]);
}
