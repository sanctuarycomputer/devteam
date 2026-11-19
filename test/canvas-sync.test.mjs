// The canvas editor keeps edits safe across drops (kit-668, docs/devteam/dashboard/canvas.html): its
// own edits resent after a restart, a reconnect, a reload or a refusal, in headless Chrome against the
// kit-651 fake (test/lib/canvas-fake.mjs), which serves the page through its `serve` option. The
// harness is kit-662's (test/canvas-editing.test.mjs): the recorder watches the page on a second
// DevTools connection of its own: its requests (Fetch), its dialogs and exceptions, and its WebSocket
// frames (Network), each parsed, both ways.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { openCanvas, startCanvasFake } from './lib/canvas-fake.mjs';
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
// Fetch for every URL: recorded (`urls`, a set, and `requests`, every one in order), then answered by
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
    urls: new Set(), requests: [], dialogs: [], exceptions: [], sent: [], sentAt: [], sentTs: [], got: [], gotAt: [], choosers: [],
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
      const { requestId, request } = o.params;
      const url = request.url;
      rec.urls.add(url);
      rec.requests.push(url);
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

// ---- S1: resend and reload ----

test('S1.1 a restart resends every own edit above the last saved', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const e1 = await rename(p, rec, 'title', 'One');
  await ackOf(rec, e1);
  await waitSaved(p);
  // S1.6: an acked edit and its saved: nothing kept
  await within(async () => (await kept(p)) === '0', 'data-kept 0 after the saved', async () => `kept ${await kept(p)}`);
  fake.pause('every');
  const e2 = await rename(p, rec, 'dot', 'Two');
  await ackOf(rec, e2);
  await within(async () => (await kept(p)) === '1', 'data-kept 1 once E2 is acked', async () => `kept ${await kept(p)}`);
  assert.ok(Number(await body(p, 'saved')) < Number(await body(p, 'rev')), 'data-saved below data-rev');
  // E3: typed before the restart, Enter pressed while down
  await selectRow(p, 'badge');
  assert.equal(await focusField(p, 'name'), true, "badge's Name field focused");
  await p.type('Three');
  fake.restart('every');
  await within(async () => (await body(p, 'live')) === 'off', 'data-live off', async () => body(p, 'live'), 5000);
  await enter(p);
  await leavePanel(p);
  assert.equal(await rowName(p, 'badge'), 'Three', 'E3 drawn at once, while down');
  await live(p);
  await within(async () => docRequests(rec, 'every').length === 2, 'a second doc request', async () => rec.requests.join(' '));
  await within(async () => welcomeCount(rec) >= 2, 'a second welcome');
  const from = afterWelcome(rec, 2);
  await waitSeq(rec, e2, from, 'E2 resent after the second welcome');
  const e3 = await waitOps(rec, nameSet('badge', 'Three'), from, 'E3 sent after the second welcome');
  assert.ok(e3.seq > e2.seq, 'E3 a seq of its own');
  assert.deepEqual(framesWithSeq(rec, e1.seq, from), [], 'E1 (saved) never resent');
  fake.resume('every');
  await allSaved(p);
  const d = fake.doc('every');
  assert.equal(d.nodes.title.name, 'One');
  assert.equal(d.nodes.dot.name, 'Two');
  assert.equal(d.nodes.badge.name, 'Three');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test('S1.2 a new session at a rev not lower still resends', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  fake.pause('every');
  const e4 = await rename(p, rec, 'dot', 'Four');
  await ackOf(rec, e4);
  await within(async () => (await kept(p)) === '1', 'data-kept 1 once E4 is acked', async () => `kept ${await kept(p)}`);
  const highest = Math.max(...rec.got.filter((m) => m && (m.t === 'ops' || m.t === 'welcome')).map((m) => m.rev));
  const w1 = gotOf(rec, 'welcome')[0].m;
  fake.restart('every');
  const a = await ana(fake, later);
  for (const n of ['Ana 1', 'Ana 2', 'Ana 3']) await a.edit(nameSet('title', n));
  const anaDone = Date.now();
  await within(async () => welcomeCount(rec) >= 2, 'a second welcome');
  await live(p);
  const w2 = gotOf(rec, 'welcome')[1];
  assert.ok(anaDone <= w2.at, "Ana's last ack came before the page's second welcome");
  assert.ok(w2.m.rev >= highest, `the second welcome's rev ${w2.m.rev} is at or above the highest seen ${highest}`);
  assert.notEqual(w2.m.session, w1.session, 'a new session');
  await waitSeq(rec, e4, afterWelcome(rec, 2), 'E4 resent to the new session');
  fake.resume('every');
  await allSaved(p);
  const d = fake.doc('every');
  assert.equal(d.nodes.dot.name, 'Four');
  assert.equal(d.nodes.title.name, 'Ana 3');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test('S1.3 a same-session reconnect resends only the unacked', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await ana(fake, later); // Ana keeps the session open
  fake.pause('every');
  const e5 = await rename(p, rec, 'dot', 'Five');
  await ackOf(rec, e5);
  await within(async () => (await kept(p)) === '1', 'data-kept 1 once E5 is acked', async () => `kept ${await kept(p)}`);
  await selectRow(p, 'title');
  assert.equal(await focusField(p, 'name'), true, "title's Name field focused");
  await p.type('Six');
  assert.equal(await closePageSocket(rec), 1, "the page's one socket closed");
  await within(async () => (await body(p, 'live')) === 'off', 'data-live off', async () => body(p, 'live'), 5000);
  await enter(p);
  await leavePanel(p);
  await live(p);
  await within(async () => welcomeCount(rec) >= 2, 'a second welcome');
  const [w1, w2] = gotOf(rec, 'welcome');
  assert.equal(w2.m.session, w1.m.session, 'the same session');
  const from = afterWelcome(rec, 2);
  const e6 = await waitOps(rec, nameSet('title', 'Six'), from, 'E6 sent after the second welcome');
  await ackOf(rec, e6);
  // E5 is still kept (not saved), beside E6, and never resent on the same session
  assert.equal(await kept(p), '2', 'E5 still kept, with E6');
  await sleep(500);
  assert.deepEqual(framesWithSeq(rec, e5.seq, from), [], 'E5 not resent on the same session');
  assert.equal(await kept(p), '2', 'nothing dropped from kept before the saved');
  fake.resume('every');
  await allSaved(p);
  assert.deepEqual(framesWithSeq(rec, e5.seq, from), [], 'E5 never resent');
  const d = fake.doc('every');
  assert.equal(d.nodes.dot.name, 'Five');
  assert.equal(d.nodes.title.name, 'Six');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test('S1.4 a refused edit reloads and keeps the other unacked edits', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every'), path: '/view/canvas/every#page=p-parts' });
  await live(p);
  holdDocs(rec);
  await selectRow(p, 'button-label');
  const n0 = edits(rec).length;
  await p.key('Delete');
  const del = await nextEdit(rec, n0);
  assert.deepEqual(del.ops, [{ op: 'del', id: 'button-label' }], 'one del of button-label');
  await within(async () => refusedFrames(rec).some((m) => m.seq === del.seq && m.why === 'ref'), 'the del refused ref', async () => JSON.stringify(rec.got.slice(-3)));
  await within(async () => docRequests(rec, 'every').length === 2 && rec.held.length === 1, 'a second doc request, held', async () => rec.requests.join(' '), 5000);
  await within(async () => (await shownText(p, '#toast')) === SAY.ref, 'the refusal said', async () => shownText(p, '#toast'));
  // R2, made while the fetch is held: drawn at once, waiting unsent
  await selectRow(p, 'button');
  const n1 = edits(rec).length;
  await fieldSet(p, 'name', 'Kept');
  assert.equal(await rowName(p, 'button'), 'Kept', 'R2 drawn at once');
  assert.equal(await body(p, 'pending'), '1', 'R2 waits in pending');
  await sleep(300);
  assert.equal(edits(rec).length, n1, 'nothing sent while the fetch runs');
  rec.hold = null;
  rec.release();
  const r2 = await waitOps(rec, nameSet('button', 'Kept'), 0, 'R2 sent after the fetch');
  await ackOf(rec, r2);
  assert.equal(await count(p, '#surface [data-id="button-label"]'), 1, 'button-label drawn again');
  await waitSaved(p);
  assert.equal(await body(p, 'pending'), '0');
  assert.equal(fake.doc('every').nodes.button.name, 'Kept');
  assert.ok(fake.doc('every').nodes['button-label'], 'button-label kept on the server');
  assert.equal(refusedFrames(rec).length, 1, 'only the del refused');
  noDialogs(rec);
  noExceptions(rec);
});

test('S1.5 a reload resends above the last saved and keeps the unacked', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  fake.pause('every');
  const k1 = await rename(p, rec, 'dot', 'K one');
  await ackOf(rec, k1);
  await within(async () => (await kept(p)) === '1', 'data-kept 1 once K1 is acked', async () => `kept ${await kept(p)}`);
  holdDocs(rec);
  fake.replace('every', EVERY);
  await within(async () => gotOf(rec, 'reload').length === 1, 'the reload frame');
  await within(async () => rec.held.length === 1, 'the doc request held', async () => rec.requests.join(' '), 5000);
  const reloadAt = gotOf(rec, 'reload')[0].at;
  // K2, made while the fetch is held
  await selectRow(p, 'title');
  const n1 = edits(rec).length;
  await fieldSet(p, 'name', 'K two');
  assert.equal(await rowName(p, 'title'), 'K two', 'K2 drawn at once');
  assert.equal(edits(rec).length, n1, 'K2 not sent while the fetch runs');
  await releaseAll(rec);
  rec.hold = null;
  const from = sentFrom(rec, reloadAt);
  await waitSeq(rec, k1, from, 'K1 resent to the new session');
  await waitOps(rec, nameSet('title', 'K two'), from, 'K2 sent to the new session');
  fake.resume('every');
  await allSaved(p);
  const d = fake.doc('every');
  assert.equal(d.nodes.dot.name, 'K one');
  assert.equal(d.nodes.title.name, 'K two');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test("S1.7 a new session's saved during the fetch drops nothing of the old session's", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const e7 = await rename(p, rec, 'dot', 'Seven');
  const a7 = await ackOf(rec, e7);
  holdDocs(rec);
  assert.ok(!gotOf(rec, 'saved').some((x) => x.m.rev >= a7.rev), "restarted before E7's saved");
  fake.restart('every');
  assert.ok(Number(await body(p, 'saved') || -1) < a7.rev, "data-saved below E7's ack rev");
  await within(async () => welcomeCount(rec) >= 2 && rec.held.length === 1, 'the second welcome and its doc request held', async () => `${welcomeCount(rec)} welcomes, ${rec.held.length} held`);
  const w2At = gotOf(rec, 'welcome')[1].at;
  const a = await ana(fake, later);
  const anaAck = await a.edit(nameSet('title', 'Ana'));
  assert.equal(anaAck.rev, a7.rev, "the new session reuses E7's ack rev");
  await within(async () => gotOf(rec, 'saved').some((x) => x.at >= w2At && x.m.rev >= a7.rev), "the new session's saved at E7's ack rev, received", async () => JSON.stringify(rec.got.slice(-3)), 5000);
  assert.equal(rec.held.length, 1, 'the fetch still held');
  await releaseAll(rec);
  rec.hold = null;
  await waitSeq(rec, e7, afterWelcome(rec, 2), 'E7 resent to the new session');
  await allSaved(p);
  const d = fake.doc('every');
  assert.equal(d.nodes.dot.name, 'Seven');
  assert.equal(d.nodes.title.name, 'Ana');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test('S1.8 a reload during a fetch', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, origin, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  fake.pause('every');
  const k3 = await rename(p, rec, 'dot', 'K three');
  await ackOf(rec, k3);
  await within(async () => (await kept(p)) === '1', 'data-kept 1 once K3 is acked', async () => `kept ${await kept(p)}`);
  await ana(fake, later); // Ana keeps the session open
  await p.click('#pages a[data-page="p-parts"]');
  await within(async () => (await count(p, '#surface [data-id="button"]')) === 1, 'Parts shown');
  holdDocs(rec);
  await selectRow(p, 'button-label');
  const session = fake.session('every');
  // the socket closed; inside the 1 s reconnect delay, the del and R4 queued unsent
  assert.equal(await closePageSocket(rec), 1, "the page's one socket closed");
  await within(async () => (await body(p, 'live')) === 'off', 'data-live off', async () => body(p, 'live'), 5000);
  const n0 = edits(rec).length;
  await p.key('Delete');
  await selectRow(p, 'button');
  await fieldSet(p, 'name', 'Held');
  assert.equal(welcomeCount(rec), 1, 'both queued before the reconnect');
  assert.equal(await body(p, 'pending'), '2', 'the del and R4 wait');
  assert.equal(edits(rec).length, n0, 'neither sent while down');
  // on reconnect (same session, same rev: no fetch) both go; the del is refused, R4 acked while the
  // fetch the refusal started is held
  await within(async () => welcomeCount(rec) >= 2, 'a second welcome');
  assert.equal(gotOf(rec, 'welcome')[1].m.session, session, 'the same session');
  const del = await waitOps(rec, [{ op: 'del', id: 'button-label' }], n0, 'the del sent');
  const r4 = await waitOps(rec, nameSet('button', 'Held'), n0, 'R4 sent');
  assert.ok(r4.seq > del.seq, 'R4 after the del');
  await within(async () => refusedFrames(rec).some((m) => m.seq === del.seq), 'the del refused', async () => JSON.stringify(rec.got.slice(-3)));
  const ack4 = await ackOf(rec, r4);
  const refusedAt = rec.got.findIndex((m) => m && m.t === 'refused' && m.seq === del.seq);
  assert.ok(refusedAt < rec.got.indexOf(ack4), "the refused frame came before R4's ack");
  await within(async () => rec.held.length === 1, 'the refusal\'s doc request held', async () => rec.requests.join(' '), 5000);
  const old = await docNow(origin);
  assert.equal(old.session, session, "the doc response read is the old session's");
  const R = structuredClone(EVERY);
  R.nodes.title.name = 'Replaced';
  fake.replace('every', R);
  await within(async () => gotOf(rec, 'reload').length === 1, 'the reload frame');
  const reloadAt = gotOf(rec, 'reload')[0].at;
  // the held pre-reload request answered with the old response; the next one held only until it is
  // seen, so the page is checked not to have taken the old answer (its rev, R4's ack rev, above base's
  // since R4's held ack went with the reload), then released as they come
  const revBefore = await body(p, 'rev');
  assert.equal(old.rev, Number(revBefore) + 1, "the old response holds R4's ack rev");
  const nReq = docRequests(rec, 'every').length;
  await rec.fulfill(rec.held[0], old);
  await within(async () => docRequests(rec, 'every').length > nReq && rec.held.length === 1, 'a doc request after the reload, held', async () => rec.requests.join(' '));
  assert.equal(await body(p, 'rev'), revBefore, 'the pre-reload answer was not taken as the document');
  await releaseAll(rec);
  rec.hold = null;
  const from = sentFrom(rec, reloadAt);
  await waitSeq(rec, k3, from, 'K3 resent to the new session');
  await waitSeq(rec, r4, from, 'R4 resent to the new session');
  fake.resume('every');
  await allSaved(p);
  assert.equal(await body(p, 'rev'), String(fake.rev('every')), 'data-rev is the fake rev');
  await p.click('#pages a[data-page="p-main"]');
  await within(async () => (await rowName(p, 'title')) === 'Replaced', "title drawn as Replaced", async () => rowName(p, 'title'));
  const d = fake.doc('every');
  assert.equal(d.nodes.dot.name, 'K three');
  assert.equal(d.nodes.button.name, 'Held');
  assert.equal(d.nodes.title.name, 'Replaced');
  assert.equal(refusedFrames(rec).length, 1, 'only the del refused');
  noDialogs(rec);
  noExceptions(rec);
});
