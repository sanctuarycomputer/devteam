// The canvas editor edits (kit-662, docs/devteam/dashboard/canvas.html): edits sent live over the
// /canvas socket and everyone else's applied, in headless Chrome against the kit-651 fake
// (test/lib/canvas-fake.mjs), which serves the page through its `serve` option. Every test watches the
// page on a second DevTools connection of its own (the recorder, kit-661's): its requests (Fetch), its
// dialogs and exceptions, and here also its WebSocket frames (Network), each parsed, both ways.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { docErrors, openCanvas, resolve, startCanvasFake } from './lib/canvas-fake.mjs';
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
// server's, parsed), with the time each was seen here (`sentAt`, `gotAt`, Date.now()). File choosers
// the page opens (once a test has set Page.setInterceptFileChooserDialog) in `choosers`. `answer` may
// return { fail: true } to fail the request; a test may set `rec.hold` to a URL test, and the requests
// it matches wait in `rec.held` (their URLs in `rec.heldUrl`) until `rec.release()`.
async function recorder(ws, origin, answer) {
  let seq = 0;
  const waiting = new Map();
  const rec = {
    urls: new Set(), requests: [], dialogs: [], exceptions: [], sent: [], sentAt: [], got: [], gotAt: [], choosers: [],
    send: null, hold: null, held: [], heldUrl: new Map(), release: null,
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
      if (f) { rec.sent.push(f); rec.sentAt.push(Date.now()); }
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

// ---- C3: sent live, both ways ----

test('sent live, both ways', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  assert.equal(await body(p, 'rev'), String(EVERY.rev), 'data-rev is the loaded rev');
  assert.equal(await body(p, 'pending'), '0');
  const welcome = rec.got.find((m) => m.t === 'welcome');
  assert.ok(welcome, 'the page got welcome');
  const a = await ana(fake, later);

  // C3.1: the page's edit (title's name, by the Name field) reaches Ana as ops within 1 s of its frame
  await selectRow(p, 'title');
  const n0 = edits(rec).length;
  await fieldSet(p, 'name', 'Page title');
  const e = await nextEdit(rec, n0);
  const sentAt = rec.sentAt[rec.sent.indexOf(e)];
  assert.match(e.client, /^[0-9a-z]{16}$/, 'client: 16 of [0-9a-z]');
  assert.ok(Number.isSafeInteger(e.seq) && e.seq >= 1, `seq a positive integer (${e.seq})`);
  assert.deepEqual(e.ops, [{ op: 'set', id: 'title', prop: 'name', value: 'Page title' }], 'one set of name');
  assert.equal(edits(rec).length, n0 + 1, 'exactly one edit frame');
  const theirs = await a.next((m) => m.t === 'ops' && m.ack && m.ack.client === e.client && m.ack.seq === e.seq, 5000);
  const gotAt = Date.now();
  assert.ok(gotAt - sentAt < 1000, `Ana got the page's edit ${gotAt - sentAt} ms after its frame`);
  assert.deepEqual(theirs.ops, e.ops, 'Ana got the same ops');
  await ackOf(rec, e);
  await waitSaved(p);
  assert.equal(fake.doc('every').nodes.title.name, 'Page title', "the fake's document holds it");
  assert.equal(await titleRowName(p), 'Page title', 'the Layers row shows it');
  assert.equal(await text(p, '#props [data-field="name"]'), 'Page title', 'the read-only Name row shows it');

  // C3.2: Ana's edit is drawn by the page within 1 s, without a reload (no new doc request)
  const docs = docRequests(rec, 'every').length;
  assert.equal(docs, 1, 'one doc request so far');
  const t0 = Date.now();
  await a.edit([{ op: 'set', id: 'title', prop: 'text', value: 'From Ana' }]);
  await within(async () => (await text(p, '#surface [data-id="title"]')) === 'From Ana', "Ana's text drawn", async () => text(p, '#surface [data-id="title"]'), 5000);
  assert.ok(Date.now() - t0 < 1000, `drawn ${Date.now() - t0} ms after Ana sent it`);
  assert.equal(docRequests(rec, 'every').length, docs, 'no new doc request');
  assert.equal(await body(p, 'rev'), String(fake.rev('every')), "data-rev follows the server's rev");
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

test('a refused edit is undone and said', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every'), path: '/view/canvas/every#page=p-parts' });
  await live(p);
  await selectRow(p, 'button-label');
  const n0 = edits(rec).length;
  await p.key('Delete');
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'del', id: 'button-label' }], 'one del of button-label');
  await within(async () => refusedFrames(rec).some((m) => m.seq === e.seq), 'the refused frame', async () => JSON.stringify(rec.got.slice(-3)));
  assert.equal(refusedFrames(rec).find((m) => m.seq === e.seq).why, 'ref', 'refused ref (variant primary overrides it)');
  await within(async () => (await shownText(p, '#toast')) === SAY.ref, 'the refusal said', async () => shownText(p, '#toast'));
  await within(async () => (await body(p, 'pending')) === '0', 'data-pending back to 0', async () => body(p, 'pending'));
  assert.equal(await count(p, '#surface [data-id="button-label"]'), 1, 'button-label drawn again');
  assert.equal(await count(p, '#layers .layer[data-node="button-label"]'), 1, "button-label's row back");
  noExceptions(rec);
});

test('reconnects and sends what waited', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  assert.equal(docRequests(rec, 'every').length, 1);
  const session = fake.session('every');
  await selectRow(p, 'title');
  // the new name typed before the socket goes; Enter (the change) pressed while it is down
  assert.equal(await focusField(p, 'name'), true, 'the Name field focused');
  await p.type('While down');
  const n0 = edits(rec).length;
  fake.restart('every');
  await within(async () => (await body(p, 'live')) === 'off', 'data-live off', async () => body(p, 'live'), 5000);
  await within(async () => (await shownText(p, '#banner')) === BANNER.down, 'the reconnecting banner', async () => shownText(p, '#banner'), 5000);
  await enter(p);
  assert.equal(await titleRowName(p), 'While down', 'the edit shows at once, while down');
  await leavePanel(p);
  // back: a new session, so the document fetched again, then the edit sent
  await live(p);
  assert.notEqual(fake.session('every'), session, 'a new session');
  await within(async () => docRequests(rec, 'every').length === 2, 'a second doc request', async () => rec.requests.join(' '));
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'set', id: 'title', prop: 'name', value: 'While down' }]);
  const welcomes = rec.got.map((m, i) => [m, rec.gotAt[i]]).filter(([m]) => m.t === 'welcome');
  assert.equal(welcomes.length, 2, 'two welcomes');
  assert.ok(rec.sentAt[rec.sent.indexOf(e)] >= welcomes[1][1], 'the edit was sent after the second welcome');
  await ackOf(rec, e);
  await waitSaved(p);
  assert.equal(fake.doc('every').nodes.title.name, 'While down', 'applied once it was back');
  assert.equal(await shownText(p, '#banner'), null, 'no banner once back');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

test('a same-session reconnect fetches what it missed', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const a = await ana(fake, later); // Ana keeps the session open
  const session = fake.session('every');
  assert.equal(await closePageSocket(rec), 1, "the page's one socket closed");
  await a.edit([{ op: 'set', id: 'title', prop: 'name', value: "Ana's name" }]);
  await within(async () => (await titleRowName(p)) === "Ana's name", "Ana's name drawn after the reconnect", async () => titleRowName(p), 10000);
  await live(p);
  const welcomes = rec.got.filter((m) => m.t === 'welcome');
  assert.equal(welcomes.length, 2, 'two welcomes');
  assert.equal(welcomes[1].session, session, 'the same session');
  assert.ok(welcomes[1].rev > welcomes[0].rev, 'a higher rev');
  assert.equal(docRequests(rec, 'every').length, 2, 'the document fetched again');
  assert.equal(fake.session('every'), session);
  assert.equal(await body(p, 'rev'), String(fake.rev('every')));
  noExceptions(rec);
});

test('paused, resumed and landed', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  assert.equal(await shownText(p, '#banner'), null, 'no banner at first');
  await selectRow(p, 'title');
  fake.pause('every');
  await within(async () => (await shownText(p, '#banner')) === BANNER.paused, 'the paused banner', async () => shownText(p, '#banner'), 5000);
  assert.equal(await p.ev("document.getElementById('banner').getAttribute('role')"), 'status');
  fake.resume('every');
  await within(async () => (await shownText(p, '#banner')) === null, 'the banner gone on resume', async () => shownText(p, '#banner'), 5000);
  fake.land('every');
  await within(async () => (await shownText(p, '#banner')) === BANNER.landed, 'the landed banner', async () => shownText(p, '#banner'), 5000);
  await within(async () => (await body(p, 'live')) === 'off', 'data-live off', async () => body(p, 'live'), 5000);
  // with a node selected, every property control of the panel is disabled (fields later tasks add
  // are covered by the same walk), and so is Delete layer
  const ctl = await propControls(p);
  assert.ok(ctl.length > 0, 'the panel has property controls');
  for (const c of ctl) assert.equal(c.off, true, `${c.prop} disabled after landed`);
  assert.equal(await p.ev("document.querySelector('#props [data-action=\"delete\"]')?.disabled ?? null"), true, 'Delete layer disabled');
  // the tools bar's buttons too: at least one, and each disabled (plan-2 F2-1)
  const tools = await p.ev("[...document.querySelectorAll('#tools button')].map((b) => b.disabled)");
  assert.ok(tools.length > 0, 'the tools bar has buttons');
  assert.ok(tools.every((d) => d === true), `every tool disabled after landed (${JSON.stringify(tools)})`);
  await p.key('F');
  assert.equal(await p.ev("document.querySelector('#tools button[aria-pressed=\"true\"]')?.dataset.tool ?? null"), 'move', 'F changes no tool after landed');
  // no edit goes out, and no reconnect is tried
  const n0 = edits(rec).length;
  await p.click('#layers .layer[data-node="title"]');
  await p.key('Delete');
  await sleep(2500);
  assert.equal(edits(rec).length, n0, 'Delete sends nothing after landed');
  assert.equal(await count(p, '#surface [data-id="title"]'), 1, 'title still drawn');
  assert.equal(rec.got.filter((m) => m.t === 'welcome').length, 1, 'no reconnect after closed');
  assert.equal(await shownText(p, '#banner'), BANNER.landed, 'the landed banner stays');
  noExceptions(rec);
});

// ---- C4.5: Delete, and the component guard ----

test('delete and the component guard', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  // Delete on the selected rule: one del
  await selectRow(p, 'rule');
  let n0 = edits(rec).length;
  await p.key('Delete');
  let e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'del', id: 'rule' }], 'one del of rule');
  await ackOf(rec, e);
  assert.equal(await count(p, '#surface [data-id="rule"]'), 0, 'rule no longer drawn');
  assert.equal(await count(p, '#layers .layer[data-node="rule"]'), 0, "rule's row gone");
  assert.equal(await count(p, '#props [data-field]'), 0, 'the selection cleared');
  // Backspace on dot, and Delete layer on icon
  await selectRow(p, 'dot');
  n0 = edits(rec).length;
  await p.key('Backspace');
  e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'del', id: 'dot' }], 'Backspace: one del of dot');
  await selectRow(p, 'icon');
  n0 = edits(rec).length;
  await p.click('#props [data-action="delete"]');
  e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'del', id: 'icon' }], 'Delete layer: one del of icon');
  await ackOf(rec, e);
  await waitSaved(p);
  for (const id of ['rule', 'dot', 'icon']) assert.equal(fake.doc('every').nodes[id], undefined, `${id} gone from the fake's document`);

  // the component button, which buy uses: neither Delete nor Delete layer sends anything
  await p.click('#pages a[data-page="p-parts"]');
  await within(async () => (await count(p, '#surface [data-id="button"]')) === 1, 'Parts shown');
  await selectRow(p, 'button');
  n0 = edits(rec).length;
  await p.key('Delete');
  await within(async () => (await shownText(p, '#toast')) === SAY.instancesFirst, 'the guard said', async () => shownText(p, '#toast'));
  await p.ev("document.getElementById('toast').hidden = true");
  await p.click('#props [data-action="delete"]');
  await within(async () => (await shownText(p, '#toast')) === SAY.instancesFirst, 'the guard said again', async () => shownText(p, '#toast'));
  await sleep(500);
  assert.equal(edits(rec).length, n0, 'nothing sent for the component');
  assert.equal(await count(p, '#surface [data-id="button"]'), 1, 'button still drawn');
  assert.ok(fake.doc('every').nodes.button, 'button kept');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

// ---- the review focus: the own edit wins until acked ----

test('the own edit wins until acked', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const a = await ana(fake, later);
  await selectRow(p, 'title');
  assert.equal(await focusField(p, 'name'), true);
  await p.type('Mine');
  const n0 = edits(rec).length;
  // Ana's rename sent, then the page's at once
  const theirs = a.edit([{ op: 'set', id: 'title', prop: 'name', value: 'Theirs' }]);
  await enter(p);
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'set', id: 'title', prop: 'name', value: 'Mine' }]);
  await theirs;
  await ackOf(rec, e);
  await leavePanel(p);
  await waitSaved(p);
  assert.ok(rec.got.some((m) => m.t === 'ops' && m.by && m.by.id === 'ana'), "the page got Ana's ops");
  const final = fake.doc('every').nodes.title.name;
  // the drawing ends on the server's order: the fake's final value
  await within(async () => (await titleRowName(p)) === final, `the Layers row on the fake's final name (${final})`, async () => titleRowName(p), 5000);
  assert.equal(await text(p, '#props [data-field="name"]'), final, "the read-only Name row on the fake's final name");
  assert.equal(await p.ev("document.querySelector('#props [data-prop=\"name\"]').value"), final, "the Name field on the fake's final name");
  assert.equal(await body(p, 'pending'), '0');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

// ---- a click on the panel right after a field edit (review T1-1) ----

test('a click on the panel after a field edit is kept', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  // typed, then Delete layer clicked (the field's change fires on that press), and typed, Enter, then
  // Delete layer clicked: each sends one set, then one del
  for (const [id, name, withEnter] of [['rule', 'Rule 2', false], ['dot', 'Dot 2', true]]) {
    await selectRow(p, id);
    const n0 = edits(rec).length;
    assert.equal(await focusField(p, 'name'), true, `${id}: the Name field focused`);
    await p.type(name);
    if (withEnter) await enter(p);
    await p.click('#props [data-action="delete"]');
    const set = await nextEdit(rec, n0);
    const del = await nextEdit(rec, n0 + 1);
    const how = withEnter ? 'with Enter' : 'without Enter';
    assert.deepEqual(set.ops, [{ op: 'set', id, prop: 'name', value: name }], `${id} (${how}): one set of name`);
    assert.deepEqual(del.ops, [{ op: 'del', id }], `${id} (${how}): then one del`);
    await ackOf(rec, del);
    assert.equal(await count(p, `#surface [data-id="${id}"]`), 0, `${id} no longer drawn`);
    assert.equal(await count(p, '#props [data-field]'), 0, `${id}: the panel shows no selection`);
  }
  await waitSaved(p);
  for (const id of ['rule', 'dot']) assert.equal(fake.doc('every').nodes[id], undefined, `${id} gone from the fake's document`);
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

// ---- the panel follows edits while a button in it has focus (review T1-2-1) ----

test('the panel follows edits while a button has focus', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const a = await ana(fake, later);
  await selectRow(p, 'title');
  // focus resting on Delete layer (as after a click or Tab)
  assert.equal(await p.ev("(() => { const b = document.querySelector('#props [data-action=\"delete\"]'); b.focus(); return document.activeElement === b; })()"), true, 'Delete layer focused');
  // someone else's rename of the selected node is shown in the panel
  await a.edit([{ op: 'set', id: 'title', prop: 'name', value: 'Renamed by Ana' }]);
  await within(async () => (await text(p, '#props [data-field="name"]')) === 'Renamed by Ana', "the read-only Name row follows Ana's rename", async () => text(p, '#props [data-field="name"]'), 5000);
  assert.equal(await p.ev("document.querySelector('#props [data-prop=\"name\"]').value"), 'Renamed by Ana', 'the Name field follows it');
  assert.equal(await p.ev("document.activeElement?.dataset.action ?? null"), 'delete', 'Delete layer keeps focus through the rebuild');
  // Escape clears the selection, and the panel follows: no fields, no Delete layer
  await p.key('Escape');
  await within(async () => (await count(p, '#props [data-field]')) === 0, 'no read-only rows after Escape', async () => count(p, '#props [data-field]'), 5000);
  assert.equal(await count(p, '#props [data-action="delete"]'), 0, 'no Delete layer after Escape');
  assert.equal(await text(p, '#props .note'), 'Select a layer to see what it is.', 'the empty note');
  const n0 = edits(rec).length;
  await p.key('Enter');
  await sleep(500);
  assert.equal(edits(rec).length, n0, 'nothing deleted after Escape');
  assert.ok(fake.doc('every').nodes.title, 'title kept');
  noExceptions(rec);
});

// ---- C2: the Properties panel's fields ----

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const setOp = (id, prop, value) => ({ op: 'set', id, prop, value });
// A property path's value in a stored node (variants.<name>.<id>.<prop> split at its third dot,
// overrides.<id>.<prop> at its second), or undefined when absent.
function valueAt(n, prop) {
  const s = prop.split('.');
  const keys = s[0] === 'variants' && s.length >= 4 ? ['variants', s[1], s[2], s.slice(3).join('.')]
    : s[0] === 'overrides' && s.length >= 3 ? ['overrides', s[1], s.slice(2).join('.')] : s;
  let at = n;
  for (const k of keys) {
    if (!isObj(at) || !Object.hasOwn(at, k)) return undefined;
    at = at[k];
  }
  return at;
}
// A null that removes: a property whose default is absent (a variant, an override; contract §2
// Defaults, spec-3 F3-1) reads as the key absent; a null elsewhere (stroke, variant) is a stored null.
const removes = (prop) => /^(variants|overrides|props)\./.test(prop);
function holds(n, prop, value) {
  if (value === null && removes(prop)) return valueAt(n, prop) === undefined;
  try { assert.deepEqual(valueAt(n, prop), value); return true; } catch { return false; }
}

// The shown page (the Pages list's current link), and showing another by its link.
const shownPage = (p) => p.ev("document.querySelector('#pages a[aria-current=\"page\"]')?.dataset.page ?? null");
async function showPg(p, pg) {
  if ((await shownPage(p)) === pg) return;
  await p.click(`#pages a[data-page="${pg}"]`);
  await within(async () => (await shownPage(p)) === pg, `page ${pg} shown`, async () => shownPage(p));
}
// The page each fixture node is on (its ancestors walked up to a page).
function pageOf(doc, id) {
  let at = id;
  while (Object.hasOwn(doc.nodes, at)) at = doc.nodes[at].parent;
  return at;
}
// A node's drawn width in page px, rounded (the box's width over the stage's zoom).
const drawnW = (p, id) => p.ev(`(() => {
  const e = document.querySelector('#surface [data-id="${id}"]');
  const z = new DOMMatrix(getComputedStyle(document.getElementById('surface')).transform).a;
  return Math.round(e.getBoundingClientRect().width / z);
})()`);
// A colour (hex) as the page's computed style gives it.
const cssColor = (p, hex) => p.ev(`(() => { const d = document.createElement('div'); d.style.backgroundColor = ${JSON.stringify(hex)}; document.body.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; })()`);
// A paint value's hex: a hex as it is, a colour token's hex, null transparent.
function hexOf(doc, v) {
  if (v === null || v === undefined) return 'transparent';
  if (typeof v === 'string') return v;
  let at = doc.tokens;
  for (const seg of v.$ref.split('.')) at = at[seg];
  return at.$value.hex;
}
// The panel's notes, as text.
const notes = (p) => p.ev("[...document.querySelectorAll('#props .note')].filter((e) => !e.hidden).map((e) => e.textContent)");

// C2.4's drawing checks, run after their rows.
async function drawnRow(p) {
  await within(async () => (await p.ev("getComputedStyle(document.querySelector('#surface [data-id=\"card\"]')).flexDirection")) === 'row', 'card drawn as a row');
}
async function drawnHello(p) {
  await within(async () => (await text(p, '#surface [data-id="title"]')) === 'Hello', 'title shows Hello', async () => text(p, '#surface [data-id="title"]'));
}
async function drawnQuiet(p, fake) {
  const want = await cssColor(p, hexOf(EVERY, resolve(fake.doc('every'), 'buy')['button-bg'].fill));
  const got = () => p.ev("(() => { const e = document.querySelector('#surface [data-of=\"buy\"][data-src=\"button-bg\"]'); return e ? getComputedStyle(e).backgroundColor : null; })()");
  await within(async () => (await got()) === want, `buy's background drawn as resolve gives it (${want})`, got);
  // a check that can fail on this fixture (T2-1): buy's own override of button-bg's fill equals primary's
  await within(async () => (await text(p, '#props [data-field="variant"]')) === 'quiet', "the read-only Variant row reads quiet", async () => text(p, '#props [data-field="variant"]'));
}
// After Change in quiet sets button-bg's fill: the panel is still in quiet, the fields that can't be
// overridden (name) are hidden, and the stage keeps drawing the component's base (contract §2).
async function changedInQuiet(p) {
  assert.equal(await p.ev("document.querySelector('#props [data-prop=\"@variant\"]')?.value ?? null"), 'quiet', 'Change in still quiet');
  assert.equal(await count(p, '#props [data-prop="name"]'), 0, 'Name is hidden in Change in');
  const base = await cssColor(p, '#e5e7eb');
  assert.equal(await p.ev("getComputedStyle(document.querySelector('#surface [data-id=\"button-bg\"]')).backgroundColor"), base, "the stage keeps button-bg's base fill");
}
// After From base: the variant holds no fill, and the field says "From base".
async function saysFromBase(p) {
  const shown = () => p.ev("(() => { const s = document.querySelector('#props [data-prop=\"fill\"]'); return s ? `${s.value} ${s.selectedOptions[0]?.textContent}` : null; })()");
  await within(async () => (await shown()) === '@base From base', 'the fill field says From base', shown);
}
// One step of a C2 row: a field set (fieldSet); with 'type', the text typed into the field and no
// Enter; with 'click', the panel's button of that data-action (and data-variant, when given).
async function rowStep(p, [f, v, how]) {
  if (how === 'type') {
    assert.equal(await focusField(p, f), true, `${f} focused`);
    await typeKeys(p, String(v));
  } else if (how === 'click') {
    await p.click(`#props [data-action="${f}"]${v === null ? '' : `[data-variant="${v}"]`}`);
    await leavePanel(p);
  } else await fieldSet(p, f, v);
}

// Before final-1 F2's row: Ana adds the typography token type.lead (serif 24 700 1.2, none of them the
// page's default font) and sets title's font to it; the panel then offers it selected.
const LEAD = { $type: 'typography', $value: { fontFamily: 'serif', fontSize: { value: 24, unit: 'px' }, fontWeight: 700, letterSpacing: { value: 0, unit: 'px' }, lineHeight: 1.2 } };
async function leadFont(p, fake, a) {
  await a.edit([{ op: 'token', path: 'type.lead', value: LEAD }, setOp('title', 'font', { $ref: 'type.lead' })]);
  assert.deepEqual(fake.doc('every').nodes.title.font, { $ref: 'type.lead' }, "Ana's font held by the fake");
  const shown = () => p.ev("document.querySelector('#props [data-prop=\"font\"]')?.value ?? null");
  await within(async () => (await shown()) === 'type.lead', "the Font field shows Ana's type.lead", shown, 5000);
}

// The C2 table (spec C2), in its order: the node, its page, the field changed (each step a fieldSet),
// and the one set op sent (on `on`, else the node); `before`, when given, runs once the node is selected
// (an edit of Ana's the row starts from). The four rows on button's variants come before the
// last row, which stays last (the spec's order).
const C2_ROWS = [
  { id: 'card', steps: [['layout.mode', 'row']], prop: 'layout.mode', value: 'row', after: drawnRow },
  { id: 'card', steps: [['layout.gap', '24']], prop: 'layout.gap', value: 24 },
  { id: 'card', steps: [['layout.align', 'center']], prop: 'layout.align', value: 'center' },
  { id: 'card', steps: [['layout.justify', 'end']], prop: 'layout.justify', value: 'end' },
  { id: 'card', steps: [['layout.wrap', true]], prop: 'layout.wrap', value: true },
  { id: 'card', steps: [['layout.padding#1', '24']], prop: 'layout.padding', value: [16, 24, 16, 16] },
  { id: 'card', steps: [['size.w#n', '320']], prop: 'size.w', value: 320 },
  { id: 'card', steps: [['size.h', 'fill']], prop: 'size.h', value: 'fill' },
  { id: 'card', steps: [['fill', 'color.brand']], prop: 'fill', value: { $ref: 'color.brand' } },
  { id: 'card', steps: [['stroke#hex', '#ff000080']], prop: 'stroke', value: '#ff000080' },
  { id: 'card', steps: [['strokeWidth', '2']], prop: 'strokeWidth', value: 2 },
  { id: 'card', steps: [['radius', '6']], prop: 'radius', value: 6 },
  { id: 'card', steps: [['clip', false]], prop: 'clip', value: false },
  { id: 'card', steps: [['opacity', '50']], prop: 'opacity', value: 0.5 },
  { id: 'card', steps: [['name', 'Card 2']], prop: 'name', value: 'Card 2' },
  { id: 'dot', steps: [['fill', '@hex'], ['fill#hex', '#123456']], prop: 'fill', value: '#123456' },
  { id: 'icon', steps: [['stroke', '@none']], prop: 'stroke', value: null },
  { id: 'photo', steps: [['radius', '4']], prop: 'radius', value: 4 },
  { id: 'buy', steps: [['size.w', 'fixed']], prop: 'size.w', value: (p) => drawnW(p, 'buy') },
  { id: 'title', steps: [['size.w', 'hug']], prop: 'size.w', value: 'hug' },
  { id: 'button', page: 'p-parts', steps: [['layout.gap', '4']], prop: 'layout.gap', value: 4 },
  { id: 'tiles', steps: [['layout.columns', '1fr 80 auto']], prop: 'layout.columns', value: ['1fr', 80, 'auto'] },
  { id: 'tiles', steps: [['layout.rows', '40']], prop: 'layout.rows', value: [40] },
  { id: 'loose', steps: [['x', '420']], prop: 'x', value: 420 },
  { id: 'loose', steps: [['y', '10']], prop: 'y', value: 10 },
  { id: 'title', steps: [['text', 'Hello']], prop: 'text', value: 'Hello', after: drawnHello },
  { id: 'title', steps: [['font', '@custom']], prop: 'font', value: { family: 'sans', size: 16, weight: 400, lineHeight: 1.4 } },
  { id: 'title', steps: [['font#family', 'serif']], prop: 'font', value: { family: 'serif', size: 16, weight: 400, lineHeight: 1.4 } },
  { id: 'title', steps: [['font#size', '20']], prop: 'font', value: { family: 'serif', size: 20, weight: 400, lineHeight: 1.4 } },
  { id: 'title', steps: [['font', 'type.body']], prop: 'font', value: { $ref: 'type.body' } },
  // final-1 F2: type.body's values are also the page's default font, so the row above would pass on a
  // page that sent the defaults. Here Ana first adds a typography token of other values and sets title's
  // font to it; Custom must send that token's values.
  { id: 'title', before: leadFont, steps: [['font', '@custom']], prop: 'font', value: { family: 'serif', size: 24, weight: 700, lineHeight: 1.2 } },
  { id: 'title', steps: [['color', 'color.brand']], prop: 'color', value: { $ref: 'color.brand' } },
  { id: 'title', steps: [['align', 'center']], prop: 'align', value: 'center' },
  { id: 'photo', steps: [['fit', 'contain']], prop: 'fit', value: 'contain' },
  { id: 'buy', steps: [['variant', 'quiet']], prop: 'variant', value: 'quiet', after: drawnQuiet },
  { id: 'buy', steps: [['variant', '@none']], prop: 'variant', value: null },
  { id: 'button', page: 'p-parts', steps: [['@new-variant', 'x1', 'type'], ['add-variant', null, 'click']], prop: 'variants.x1', value: {} },
  { id: 'button', page: 'p-parts', steps: [['remove-variant', 'x1', 'click']], prop: 'variants.x1', value: null },
  { id: 'button-bg', on: 'button', page: 'p-parts', steps: [['@variant', 'quiet'], ['fill', '@hex'], ['fill#hex', '#00ff00']], prop: 'variants.quiet.button-bg.fill', value: '#00ff00', after: changedInQuiet },
  { id: 'button-bg', on: 'button', page: 'p-parts', steps: [['@variant', 'quiet'], ['fill', '@base']], prop: 'variants.quiet.button-bg.fill', value: null, after: saysFromBase },
  { id: 'loose', steps: [['visible', false]], prop: 'visible', value: false },
];

test('every property sends one set op the fake accepts', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const a = await ana(fake, later);
  for (const row of C2_ROWS) {
    const on = row.on ?? row.id;
    const what = `${row.id} ${row.steps.map(([f, v]) => `${f} ${JSON.stringify(v)}`).join(', ')}`;
    await showPg(p, row.page ?? 'p-main');
    await selectRow(p, row.id);
    if (row.before) await row.before(p, fake, a);
    const value = typeof row.value === 'function' ? await row.value(p) : row.value;
    assert.equal(holds(fake.doc('every').nodes[on], row.prop, value), false, `${what}: ${on} doesn't already hold ${JSON.stringify(value)}`);
    const n0 = edits(rec).length;
    for (const step of row.steps) await rowStep(p, step);
    const e = await nextEdit(rec, n0);
    assert.deepEqual(e.ops, [setOp(on, row.prop, value)], `${what}: one set op`);
    await ackOf(rec, e);
    await sleep(200);
    assert.equal(edits(rec).length, n0 + 1, `${what}: exactly one edit frame`);
    assert.deepEqual(refusedFrames(rec), [], `${what}: nothing refused`);
    assert.equal(holds(fake.doc('every').nodes[on], row.prop, value), true, `${what}: the fake's document holds ${JSON.stringify(value)} (${JSON.stringify(valueAt(fake.doc('every').nodes[on], row.prop))})`);
    if (row.after) await row.after(p, fake);
  }
  await waitSaved(p);
  noExceptions(rec);
});

test("the panel's fields are all checked", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const sent = new Set(C2_ROWS.map((r) => r.prop));
  // a field's property paths: data-prop values with no # (a part) and no @ (the panel's own)
  const paths = () => p.ev("[...document.querySelectorAll('#props [data-prop]')].map((e) => e.dataset.prop).filter((v) => !v.includes('#') && !v.includes('@'))");
  const covered = async (what) => {
    const ps = await paths();
    assert.ok(ps.includes('name') && ps.includes('size.w'), `${what}: the panel has its fields (${ps.join(' ')})`);
    for (const x of ps) assert.ok(sent.has(x), `${what}: ${x} is a path some row of C2 sends`);
    return ps;
  };
  const types = new Set();
  for (const id of Object.keys(EVERY.nodes)) {
    await showPg(p, pageOf(EVERY, id));
    await selectRow(p, id);
    await covered(id);
    types.add(EVERY.nodes[id].type);
  }
  assert.deepEqual([...types].sort(), ['component', 'ellipse', 'frame', 'image', 'instance', 'rect', 'text', 'vector'], 'one of each type');
  // card in each of the four layout modes, by its Direction buttons
  await showPg(p, 'p-main');
  await selectRow(p, 'card');
  const has = { none: [], row: ['layout.gap', 'layout.wrap'], column: ['layout.gap', 'layout.wrap'], grid: ['layout.gap', 'layout.columns', 'layout.rows'] };
  const not = { none: ['layout.gap', 'layout.wrap', 'layout.columns'], row: ['layout.columns'], column: ['layout.columns'], grid: ['layout.wrap'] };
  for (const mode of ['none', 'row', 'grid', 'column']) {
    await fieldSet(p, 'layout.mode', mode);
    await within(async () => (await p.ev(`document.querySelector('#props [data-prop="layout.mode"] button[aria-pressed="true"]')?.dataset.value ?? null`)) === mode, `card's Direction ${mode} pressed`);
    const ps = await covered(`card, ${mode}`);
    for (const x of has[mode]) assert.ok(ps.includes(x), `card, ${mode}: ${x} shown`);
    for (const x of not[mode]) assert.ok(!ps.includes(x), `card, ${mode}: ${x} not shown`);
  }
  await waitSaved(p);
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

test('out-of-class input sends nothing', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const TRACKS = 'Tracks are numbers, auto or 1fr-like, apart by spaces.';
  const COLOUR = 'A colour is #rgb, #rrggbb or #rrggbbaa.';
  await selectRow(p, 'tiles');
  let n0 = edits(rec).length;
  await fieldSet(p, 'layout.columns', 'repeat(3, 1fr)');
  await within(async () => (await notes(p)).includes(TRACKS), 'the tracks note', async () => JSON.stringify(await notes(p)));
  await sleep(800);
  assert.equal(edits(rec).length, n0, 'repeat(…) sends nothing');
  await selectRow(p, 'card');
  n0 = edits(rec).length;
  await fieldSet(p, 'stroke#hex', 'red');
  await within(async () => (await notes(p)).includes(COLOUR), 'the colour note', async () => JSON.stringify(await notes(p)));
  await sleep(800);
  assert.equal(edits(rec).length, n0, 'red sends nothing');
  assert.deepEqual(fake.doc('every').nodes.tiles.layout.columns, EVERY.nodes.tiles.layout.columns, 'tiles unchanged');
  assert.equal(fake.doc('every').nodes.card.stroke, EVERY.nodes.card.stroke, 'card unchanged');
  // a number out of its range is clamped to it, and sent
  await fieldSet(p, 'opacity', '150');
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [setOp('card', 'opacity', 1)], 'opacity 150 % clamped to 1');
  await ackOf(rec, e);
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

test('a hostile name is text', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const HOSTILE_NAME = '<img src=x onerror=alert(1)>';
  const imgs = () => count(p, 'img');
  await selectRow(p, 'rule');
  const before = await imgs();
  const n0 = edits(rec).length;
  await fieldSet(p, 'name', HOSTILE_NAME);
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [setOp('rule', 'name', HOSTILE_NAME)], 'sent as that string');
  await ackOf(rec, e);
  assert.equal(fake.doc('every').nodes.rule.name, HOSTILE_NAME);
  await within(async () => (await text(p, '#layers .layer[data-node="rule"] .nm')) === HOSTILE_NAME, 'the Layers row shows it as text', async () => text(p, '#layers .layer[data-node="rule"] .nm'));
  // the panel is rebuilt in a timer after focus leaves it, so it is waited on
  await within(async () => (await text(p, '#props [data-field="name"]')) === HOSTILE_NAME, 'the read-only Name row shows it as text', async () => text(p, '#props [data-field="name"]'), 5000);
  assert.equal(await imgs(), before, 'no img element added');
  assert.equal(await count(p, '#layers img, #props img'), 0, 'no img in the Layers or the panel');
  await sleep(300);
  assert.deepEqual(rec.dialogs, [], 'no dialog opened');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

test("a remote edit doesn't take a field from under a person typing", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const a = await ana(fake, later);
  await selectRow(p, 'title');
  assert.equal(await focusField(p, 'text'), true, 'the Text field focused');
  await typeKeys(p, 'Typed');
  const n0 = edits(rec).length;
  // Ana changes the same node's text and align while the person types
  await a.edit([setOp('title', 'text', 'From Ana'), setOp('title', 'align', 'center')]);
  await within(async () => (await text(p, '#surface [data-id="title"]')) === 'From Ana', "Ana's text drawn on the stage", async () => text(p, '#surface [data-id="title"]'), 5000);
  await sleep(300);
  assert.equal(await p.ev('document.activeElement?.dataset.prop ?? null'), 'text', 'the Text field keeps focus');
  assert.equal(await p.ev("document.querySelector('#props [data-prop=\"text\"]').value"), 'Typed', 'the Text field keeps what was typed');
  assert.equal(edits(rec).length, n0, 'nothing sent while typing');
  // leaving the field sends what was typed, once; the panel then follows Ana's align
  await leavePanel(p);
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [setOp('title', 'text', 'Typed')], 'one set of text');
  await ackOf(rec, e);
  await within(async () => (await p.ev("document.querySelector('#props [data-prop=\"align\"] button[aria-pressed=\"true\"]')?.dataset.value ?? null")) === 'center', "the panel shows Ana's align", async () => p.ev("document.querySelector('#props [data-prop=\"align\"] button[aria-pressed=\"true\"]')?.dataset.value ?? null"), 5000);
  await waitSaved(p);
  assert.equal(fake.doc('every').nodes.title.text, 'Typed', "the server's order: the page's edit came last");
  assert.equal(await p.ev("document.querySelector('#props [data-prop=\"text\"]').value"), 'Typed');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

// ---- C4.1, C4.6 and C1.1a: the tools ----

const MINIMAL = fixture('doc-minimal.json');
const IMG_PATH = path.join(FIX, 'images', IMG_FILE);
const IMAGE_SAY = {
  tooBig: 'That image is too big (at most 4 MB).',
  types: 'Only PNG, JPEG, WebP or GIF images can be added.',
  failed: "The image couldn't be added.",
};
const TOOL_KEYS = [['F', 'frame'], ['T', 'text'], ['R', 'rect'], ['O', 'ellipse'], ['P', 'vector'], ['I', 'image'], ['V', 'move']];
const pressedTool = (p) => p.ev("[...document.querySelectorAll('#tools button[aria-pressed=\"true\"]')].map((b) => b.dataset.tool).join(' ') || null");
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
// The one add the page sent after the first n0 edits, acked.
async function added(rec, n0, what) {
  const e = await nextEdit(rec, n0);
  assert.equal(e.ops.length, 1, `${what}: one op`);
  assert.equal(e.ops[0].op, 'add', `${what}: an add`);
  assert.equal(Object.hasOwn(e.ops[0].node, 'children'), false, `${what}: no children key`);
  assert.match(e.ops[0].node.id, /^[0-9a-z]{6}-\d+$/, `${what}: a new id <prefix>-<n>`);
  await ackOf(rec, e);
  return e.ops[0];
}
// After a creation: the tool is Move again and the new node is selected.
async function madeAndSelected(p, id, what) {
  await within(async () => (await pressedTool(p)) === 'move', `${what}: the tool back to Move`, async () => pressedTool(p), 5000);
  await within(async () => (await p.ev(`document.querySelector('#layers .layer[data-node="${id}"]')?.getAttribute('aria-selected') ?? null`)) === 'true', `${what}: the new node selected`, async () => p.ev("[...document.querySelectorAll('#layers .layer[aria-selected=\"true\"]')].map((r) => r.dataset.node).join(' ')"), 5000);
}
const shownMsg = (p) => shownText(p, '#msg');

test('tool keys', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec, size } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  // the bar: a toolbar at the stage's foot, centred, its right edge at least 160 px from the stage's
  assert.equal(await p.ev("document.getElementById('tools')?.getAttribute('role') ?? null"), 'toolbar');
  const tools = await p.ev("[...document.querySelectorAll('#tools button[data-tool]')].map((b) => [b.dataset.tool, b.querySelector('kbd')?.textContent ?? null])");
  assert.deepEqual(tools.map(([tool]) => tool).sort(), ['ellipse', 'frame', 'image', 'move', 'rect', 'text', 'vector']);
  for (const [k, tool] of TOOL_KEYS) assert.deepEqual(tools.find(([x]) => x === tool), [tool, k], `${tool}'s key hint is a kbd ${k}`);
  const stage = await box(p, '#stage');
  const bar = await box(p, '#tools');
  assert.ok(stage.r - bar.r >= 160, `the bar's right edge ${stage.r - bar.r} px from the stage's`);
  assert.ok(Math.abs((bar.l + bar.r) / 2 - (stage.l + stage.r) / 2) < 1, 'the bar centred');
  assert.ok(stage.b - bar.b >= 0 && stage.b - bar.b < 40, `the bar at the stage's foot (${stage.b - bar.b})`);
  assert.equal(await pressedTool(p), 'move', 'Move at first');
  // C4.1: each key presses its button, Escape returns to Move
  for (const [k, tool] of TOOL_KEYS) {
    await p.key(k);
    assert.equal(await pressedTool(p), tool, `${k} presses ${tool}`);
    await p.key('Escape');
    assert.equal(await pressedTool(p), 'move', `Escape after ${k}: Move`);
  }
  // a click on a button presses it too, and Escape with Move on still clears the selection
  await p.click('#tools button[data-tool="rect"]');
  assert.equal(await pressedTool(p), 'rect', 'the Rectangle button pressed by a click');
  await p.key('Escape');
  assert.equal(await pressedTool(p), 'move');
  await selectRow(p, 'title');
  // the same keys typed in the Name field change no tool
  assert.equal(await focusField(p, 'name'), true, 'the Name field focused');
  const n0 = edits(rec).length;
  for (const [k] of TOOL_KEYS) {
    await p.key(k);
    assert.equal(await pressedTool(p), 'move', `${k} in the Name field changes no tool`);
  }
  assert.equal(await p.ev("document.querySelector('#props [data-prop=\"name\"]').value"), TOOL_KEYS.map(([k]) => k).join(''), 'the keys went to the field');
  assert.equal(edits(rec).length, n0, 'nothing sent while typing');
  await leavePanel(p);
  // a narrower desktop stage (review T3-1, T3-2-1): the bar stays one row at the foot, every button
  // inside it, its right edge at least 160 px left of the stage's, centred while key buttons of a
  // usable size fit so (a stage of 520 px and over), and the stage's own corner points bare
  for (const w of [1280, 1070, 1024, 870, 800]) {
    await size(w, 900);
    await within(async () => (await p.ev('innerWidth')) === w, `the window at ${w}`);
    const st = await box(p, '#stage');
    const g = await p.ev(`(() => {
      const t = document.getElementById('tools');
      const b = t.getBoundingClientRect();
      const btns = [...t.querySelectorAll('button[data-tool]')].map((x) => { const r = x.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width }; });
      return { shown: getComputedStyle(t).display !== 'none' && b.width > 0, bar: { l: b.left, r: b.right, t: b.top, b: b.bottom }, btns };
    })()`);
    assert.equal(g.shown, true, `${w}: the bar shown`);
    assert.equal(g.btns.length, 7, `${w}: seven tools`);
    for (const [i, r] of g.btns.entries()) {
      assert.ok(r.w > 0 && r.l >= g.bar.l - 0.5 && r.r <= g.bar.r + 0.5 && r.t >= g.bar.t - 0.5 && r.b <= g.bar.b + 0.5, `${w}: button ${i} ${JSON.stringify(r)} inside the bar ${JSON.stringify(g.bar)}`);
    }
    assert.equal(new Set(g.btns.map((r) => Math.round(r.t))).size, 1, `${w}: the bar is one row`);
    assert.ok(st.r - g.bar.r >= 160, `${w}: the bar's right edge ${st.r - g.bar.r} px left of the stage's`);
    assert.ok(g.bar.l >= st.l && st.b - g.bar.b >= 0 && st.b - g.bar.b < 40, `${w}: the bar inside the stage, at its foot`);
    if (st.w >= 520) {
      assert.ok(Math.abs((g.bar.l + g.bar.r) / 2 - (st.l + st.r) / 2) < 1, `${w}: the bar centred on a ${st.w} px stage`);
      assert.ok(g.btns.every((r) => r.w >= 20), `${w}: key buttons of a usable size (${g.btns.map((r) => r.w).join(', ')})`);
    }
    for (const d of [60, 120]) assert.equal(await p.ev(`document.elementFromPoint(${st.r - d}, ${st.b - d})?.id`), 'stage', `${w}: the stage's corner point ${d} px in is bare stage`);
    await p.key('F');
    assert.equal(await pressedTool(p), 'frame', `${w}: F still presses Frame`);
    await p.key('Escape');
  }
  // at 790 (a 250 px stage) no bar keeps 160 px clear: it is hidden, and the keys still pick tools
  await size(790, 900);
  await within(async () => (await p.ev('innerWidth')) === 790, 'the window at 790');
  assert.equal(await p.ev("(() => { const t = document.getElementById('tools'); return getComputedStyle(t).display === 'none' || t.getBoundingClientRect().width === 0; })()"), true, '790: the bar hidden');
  await p.key('F');
  assert.equal(await pressedTool(p), 'frame', '790: F still picks Frame');
  await p.key('Escape');
  assert.equal(await pressedTool(p), 'move', '790: Escape back to Move');
  noExceptions(rec);
});

test('new nodes go where the pointer is', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await rec.send('Page.setInterceptFileChooserDialog', { enabled: true });
  const z = await zoomNow(p);
  const made = {};
  const node = (id) => fake.doc('every').nodes[id];

  // C4.6: a frame clicked into the row `actions`, right of buy: after buy, no x, y, 200 × 120
  let actions = await box(p, '#surface [data-id="actions"]');
  const buy = await box(p, '#surface [data-id="buy"]');
  let pt = { x: Math.round((buy.r + actions.r) / 2), y: Math.round((actions.t + actions.b) / 2) };
  assert.equal(await hitAt(p, pt), 'actions', 'the point is on actions, right of buy');
  let n0 = edits(rec).length;
  await p.key('F');
  await p.clickAt(pt.x, pt.y);
  let op = await added(rec, n0, 'frame in actions');
  assert.equal(op.after, 'buy', 'after buy');
  assert.deepEqual(op.node, { id: op.node.id, type: 'frame', parent: 'actions', name: op.node.name, size: { w: 200, h: 120 }, layout: { mode: 'none' }, fill: '#ffffff' }, 'a frame in actions, no x, y');
  await madeAndSelected(p, op.node.id, 'frame in actions');
  assert.deepEqual(fake.doc('every').nodes.actions.children, ['buy', op.node.id], "the fake's actions: buy, then the frame");
  assert.equal(Object.hasOwn(node(op.node.id), 'x') || Object.hasOwn(node(op.node.id), 'y'), false, 'no x, y stored');
  made.frameInRow = op.node.id;

  // C4.6: a frame clicked into the none frame `loose`: its x, y at the pointer in loose's px
  let loose = await box(p, '#surface [data-id="loose"]');
  pt = { x: Math.round(loose.l + 100 * z), y: Math.round(loose.t + 100 * z) };
  assert.equal(await hitAt(p, pt), 'loose');
  n0 = edits(rec).length;
  await p.key('F');
  await p.clickAt(pt.x, pt.y);
  op = await added(rec, n0, 'frame in loose');
  assert.equal(op.node.parent, 'loose');
  assert.equal(op.after, 'badge', 'on top: after the last child');
  assert.equal(op.node.x, Math.round((pt.x - loose.l) / z), 'x at the pointer');
  assert.equal(op.node.y, Math.round((pt.y - loose.t) / z), 'y at the pointer');
  assert.deepEqual(op.node.size, { w: 200, h: 120 });
  await madeAndSelected(p, op.node.id, 'frame in loose');
  assert.equal(node(op.node.id).x, op.node.x, 'x stored');
  assert.equal(node(op.node.id).y, op.node.y, 'y stored');

  // a frame dragged out on the page, right of loose: that size, at the press point, a dashed draft meanwhile
  loose = await box(p, '#surface [data-id="loose"]');
  const surf = await box(p, '#surface');
  pt = { x: Math.round(loose.r + 40), y: Math.round(loose.t + 10) };
  assert.equal(await hitAt(p, pt), 'stage', 'empty stage right of loose');
  n0 = edits(rec).length;
  await p.key('F');
  let draft = null;
  await drag(p, pt, 90, 60, async () => { draft = await p.ev("(() => { const d = document.querySelector('#stage .draft'); return d ? { dashed: getComputedStyle(d).borderStyle, id: d.dataset.id ?? null, pe: getComputedStyle(d).pointerEvents } : null; })()"); });
  assert.deepEqual(draft, { dashed: 'dashed', id: null, pe: 'none' }, 'a dashed draft while dragging, no data-id');
  op = await added(rec, n0, 'frame dragged on the page');
  assert.equal(await count(p, '#stage .draft'), 0, 'the draft gone');
  assert.equal(op.node.parent, 'p-main');
  assert.equal(op.after, 'tiles', "after the page's last node");
  assert.equal(op.node.x, Math.round((pt.x - surf.l) / z));
  assert.equal(op.node.y, Math.round((pt.y - surf.t) / z));
  assert.deepEqual(op.node.size, { w: Math.round(90 / z), h: Math.round(60 / z) }, 'the dragged size, fixed');
  await madeAndSelected(p, op.node.id, 'frame on the page');
  made.frameOnPage = op.node.id;

  // a text clicked into loose: "Text", hug × hug, its Text field focused
  loose = await box(p, '#surface [data-id="loose"]');
  pt = { x: Math.round(loose.l + 30 * z), y: Math.round(loose.t + 150 * z) };
  assert.equal(await hitAt(p, pt), 'loose');
  n0 = edits(rec).length;
  await p.key('T');
  await p.clickAt(pt.x, pt.y);
  op = await added(rec, n0, 'text');
  assert.deepEqual(op.node, { id: op.node.id, type: 'text', parent: 'loose', name: op.node.name, x: Math.round((pt.x - loose.l) / z), y: Math.round((pt.y - loose.t) / z), size: { w: 'hug', h: 'hug' }, text: 'Text' });
  await madeAndSelected(p, op.node.id, 'text');
  await within(async () => (await p.ev('document.activeElement?.dataset.prop ?? null')) === 'text', 'the Text field focused', async () => p.ev('document.activeElement?.outerHTML.slice(0, 80) ?? null'), 5000);
  await leavePanel(p);
  made.text = op.node.id;

  // a rectangle dragged out in loose: that size, fill #d9d9d9
  pt = { x: Math.round(loose.l + 120 * z), y: Math.round(loose.t + 30 * z) };
  assert.equal(await hitAt(p, pt), 'loose');
  n0 = edits(rec).length;
  await p.key('R');
  await drag(p, pt, 40, 30);
  op = await added(rec, n0, 'rect');
  assert.deepEqual(op.node, { id: op.node.id, type: 'rect', parent: 'loose', name: op.node.name, x: Math.round((pt.x - loose.l) / z), y: Math.round((pt.y - loose.t) / z), size: { w: Math.round(40 / z), h: Math.round(30 / z) }, fill: '#d9d9d9' });
  await madeAndSelected(p, op.node.id, 'rect');
  made.rect = op.node.id;

  // an ellipse clicked on the page, below the frames made right of loose: 100 × 100
  pt = { x: Math.round(loose.r + 40), y: Math.round(loose.t + 260 * z) };
  assert.equal(await hitAt(p, pt), 'stage', 'empty stage below the frames right of loose');
  n0 = edits(rec).length;
  await p.key('O');
  await p.clickAt(pt.x, pt.y);
  op = await added(rec, n0, 'ellipse');
  assert.deepEqual(op.node, { id: op.node.id, type: 'ellipse', parent: 'p-main', name: op.node.name, x: Math.round((pt.x - surf.l) / z), y: Math.round((pt.y - surf.t) / z), size: { w: 100, h: 100 }, fill: '#d9d9d9' });
  assert.equal(op.after, made.frameOnPage, "after the page's last node");
  await madeAndSelected(p, op.node.id, 'ellipse');
  made.ellipse = op.node.id;

  // a vector: Escape drops a path; then three clicks in loose ended with Enter
  const pts = [[150, 20], [185, 60], [160, 90]].map(([x, y]) => ({ x: Math.round(loose.l + x * z), y: Math.round(loose.t + y * z) }));
  n0 = edits(rec).length;
  await p.key('P');
  await p.clickAt(pts[0].x, pts[0].y);
  await p.clickAt(pts[1].x, pts[1].y);
  assert.equal(await count(p, '#stage .pen'), 1, 'the path previewed');
  await p.key('Escape');
  assert.equal(await pressedTool(p), 'move', 'Escape: Move');
  assert.equal(await count(p, '#stage .pen'), 0, 'the preview gone');
  await sleep(300);
  assert.equal(edits(rec).length, n0, 'Escape sends nothing');
  await p.key('P');
  for (const q of pts) await p.clickAt(q.x, q.y);
  await enter(p);
  op = await added(rec, n0, 'vector');
  const lp = pts.map((q) => [(q.x - loose.l) / z, (q.y - loose.t) / z]);
  const x0 = Math.round(Math.min(...lp.map(([x]) => x)));
  const y0 = Math.round(Math.min(...lp.map(([, y]) => y)));
  assert.equal(op.node.type, 'vector');
  assert.equal(op.node.parent, 'loose');
  assert.equal(op.node.x, x0, 'x: the points’ left');
  assert.equal(op.node.y, y0, 'y: the points’ top');
  assert.deepEqual(op.node.size, { w: 'hug', h: 'hug' });
  assert.match(op.node.path, /^M -?[\d.]+ -?[\d.]+ L -?[\d.]+ -?[\d.]+ L -?[\d.]+ -?[\d.]+$/, `the path (${op.node.path})`);
  const nums = op.node.path.match(/-?[\d.]+/g).map(Number);
  lp.forEach(([x, y], i) => {
    assert.ok(Math.abs(nums[2 * i] - (x - x0)) <= 0.051 && Math.abs(nums[2 * i + 1] - (y - y0)) <= 0.051, `point ${i} at (${x - x0}, ${y - y0}) in the path (${op.node.path})`);
  });
  assert.ok(nums.every((v) => Math.round(v * 10) === v * 10 || Math.abs(Math.round(v * 10) - v * 10) < 1e-9), 'numbers to 0.1');
  assert.equal(await count(p, '#stage .pen'), 0, 'the preview gone');
  await madeAndSelected(p, op.node.id, 'vector');
  made.vector = op.node.id;

  // an image clicked into the column `card`, in photo's lower half: after photo, the picker, the upload
  const photo = await box(p, '#surface [data-id="photo"]');
  pt = { x: Math.round((photo.l + photo.r) / 2), y: Math.round(photo.t + photo.h * 0.75) };
  assert.equal(await hitAt(p, pt), 'photo');
  n0 = edits(rec).length;
  const c0 = rec.choosers.length;
  await p.key('I');
  await p.clickAt(pt.x, pt.y);
  await within(async () => rec.choosers.length > c0, 'the file chooser opened', async () => JSON.stringify(rec.choosers));
  const ch = rec.choosers[c0];
  assert.equal(ch.mode, 'selectSingle');
  await rec.send('DOM.setFileInputFiles', { files: [IMG_PATH], backendNodeId: ch.backendNodeId });
  op = await added(rec, n0, 'image');
  assert.deepEqual(op.node, { id: op.node.id, type: 'image', parent: 'card', name: op.node.name, size: { w: 'hug', h: 'hug' }, src: `images/${IMG_FILE}` });
  assert.equal(op.after, 'photo', 'after photo');
  assert.ok(rec.requests.some((u) => u.endsWith('/api/canvas/image?slug=every')), 'the image posted');
  await madeAndSelected(p, op.node.id, 'image');
  made.image = op.node.id;

  await waitSaved(p);
  const doc = fake.doc('every');
  const types = Object.values(made).map((id) => doc.nodes[id]?.type);
  assert.deepEqual(types.sort(), ['ellipse', 'frame', 'frame', 'image', 'rect', 'text', 'vector'], "the fake's document holds each made node");
  assert.equal(doc.nodes.card.children.indexOf(made.image), doc.nodes.card.children.indexOf('photo') + 1, 'the image after photo in card');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

test('an upload the server refuses adds nothing', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  // the image route answered by the recorder: 415, 413, then a 200 whose src isn't an images/ file
  const answers = [
    [{ status: 415, body: '' }, IMAGE_SAY.types],
    [{ status: 413, body: '' }, IMAGE_SAY.tooBig],
    [{ status: 200, body: { src: 'https://evil.example/x.png' } }, IMAGE_SAY.failed],
    [{ status: 500, body: '' }, IMAGE_SAY.failed],
  ];
  let i = 0;
  const answer = (url) => (url.includes('/api/canvas/image?') ? answers[i++][0] : null);
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every'), answer });
  await live(p);
  await rec.send('Page.setInterceptFileChooserDialog', { enabled: true });
  const loose = await box(p, '#surface [data-id="loose"]');
  const pt = { x: Math.round(loose.r + 40), y: Math.round(loose.t + 10) };
  assert.equal(await hitAt(p, pt), 'stage');
  const n0 = edits(rec).length;
  for (const [, words] of answers) {
    const c0 = rec.choosers.length;
    const seen = i;
    await p.ev("document.getElementById('toast').hidden = true");
    await p.key('I');
    await p.clickAt(pt.x, pt.y);
    await within(async () => rec.choosers.length > c0, 'the file chooser opened');
    await rec.send('DOM.setFileInputFiles', { files: [IMG_PATH], backendNodeId: rec.choosers[c0].backendNodeId });
    await within(async () => i > seen, 'the image posted');
    await within(async () => (await shownText(p, '#toast')) === words, `said: ${words}`, async () => shownText(p, '#toast'));
    assert.equal(await pressedTool(p), 'move', 'the tool back to Move');
  }
  await sleep(500);
  assert.equal(edits(rec).length, n0, 'no add sent');
  assert.equal(await body(p, 'pending'), '0');
  assert.equal(await count(p, '#surface img'), 1, 'only photo drawn as an image');
  noExceptions(rec);
});

test('the empty-page note follows the page', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { draw: MINIMAL } });
  await live(p);
  assert.equal(await shownMsg(p), 'This page is empty.', 'the note on the empty page');
  // the note takes no pointer events: the stage under it can be drawn on
  const msg = await box(p, '#msg');
  const pt = { x: Math.round(msg.l + msg.w / 2), y: Math.round(msg.t + msg.h / 2) };
  assert.equal(await hitAt(p, pt), 'stage', 'the stage under the note');
  const n0 = edits(rec).length;
  await p.key('F');
  await drag(p, pt, 120, 80);
  const op = await added(rec, n0, 'the first frame');
  assert.equal(op.node.parent, 'p1');
  assert.equal(op.after, null, 'first on the page');
  // C1.1a: once the page has a node, the note is gone
  await within(async () => (await shownMsg(p)) === null, 'the note hidden', async () => shownMsg(p), 5000);
  await madeAndSelected(p, op.node.id, 'the first frame');
  await waitSaved(p);
  assert.deepEqual(fake.doc('draw').pages[0].children, [op.node.id]);
  // deleting it shows the note again
  await p.key('Delete');
  const e = await nextEdit(rec, n0 + 1);
  assert.deepEqual(e.ops, [{ op: 'del', id: op.node.id }]);
  await ackOf(rec, e);
  await within(async () => (await shownMsg(p)) === 'This page is empty.', 'the note shown again', async () => shownMsg(p), 5000);
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

// ---- C4.2 to C4.4: moving by drag and by arrows ----

const CANT_GO = "That layer can't go there.";
const ARROW_CODE = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
// An arrow key as a keyboard sends it (the helper's key() knows only Left and Right), Shift held when asked.
async function arrow(p, k, shift = false) {
  const e = { key: k, code: k, windowsVirtualKeyCode: ARROW_CODE[k], nativeVirtualKeyCode: ARROW_CODE[k], modifiers: shift ? 8 : 0 };
  await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...e });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...e });
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
const centre = (b) => ({ x: Math.round(b.l + b.w / 2), y: Math.round(b.t + b.h / 2) });
const selectedIds = (p) => p.ev("[...document.querySelectorAll('#layers .layer[aria-selected=\"true\"]')].map((r) => r.dataset.node)");
// No edit frame after the first n0 for `ms`.
async function sendsNothing(rec, n0, what, ms = 600) {
  await sleep(ms);
  assert.deepEqual(edits(rec).slice(n0).map((e) => e.ops), [], `${what}: nothing sent`);
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} within ${tol} of ${b}`);

test('drag a loose node', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  // a zoom other than 1
  const z0 = await zoomNow(p);
  await p.click('#zoomOut');
  await within(async () => Math.abs((await zoomNow(p)) - z0 / 1.25) < 1e-4, 'zoomed out a step');
  const z = await zoomNow(p);
  assert.ok(Math.abs(z - 1) > 0.05, `the zoom is not 1 (${z})`);
  assert.deepEqual(await selectedIds(p), [], 'nothing selected at first');

  // C4.2a and C4.2: a press on the unselected badge selects it, and a drag of (30, 20) moves it, previewed
  // under the pointer meanwhile; one edit of set x and set y by (30/z, 20/z), rounded
  const b0 = await box(p, '#surface [data-id="badge"]');
  const a = centre(b0);
  assert.equal(await hitAt(p, a), 'badge');
  let n0 = edits(rec).length;
  await drag(p, a, 30, 20, async () => {
    assert.deepEqual(await selectedIds(p), ['badge'], 'the press selected badge');
    const b = await box(p, '#surface [data-id="badge"]');
    near(b.l, b0.l + 30, 1, 'previewed x');
    near(b.t, b0.t + 20, 1, 'previewed y');
    assert.equal(await count(p, '#surface [data-id="badge"]'), 1, 'one badge drawn while dragging');
  });
  // kit-668: any live frames (however many, none included), then the drop's set x and set y
  await nextEdit(rec, n0);
  await waitSaved(p); // every frame of the drag sent and acked
  const dragged = edits(rec).slice(n0);
  const e = dragged[dragged.length - 1];
  const want = [{ op: 'set', id: 'badge', prop: 'x', value: Math.round(12 + 30 / z) }, { op: 'set', id: 'badge', prop: 'y', value: Math.round(-8 + 20 / z) }];
  for (const f of dragged.slice(0, -1)) assert.ok(f.ops.length > 0 && f.ops.every((o) => o.op === 'set' && o.id === 'badge' && ['x', 'y'].includes(o.prop)), `a live frame only sets badge's x and/or y: ${JSON.stringify(f.ops)}`);
  assert.deepEqual(e.ops, want, 'the last frame: set x and set y');
  await ackOf(rec, e);
  await sendsNothing(rec, n0 + dragged.length, 'after the drop');
  const b1 = await box(p, '#surface [data-id="badge"]');
  near(b1.l, b0.l + 30, z, 'drawn there: x');
  near(b1.t, b0.t + 20, z, 'drawn there: y');
  assert.deepEqual(await selectedIds(p), ['badge'], 'still selected after the release');
  await waitSaved(p);
  assert.equal(fake.doc('every').nodes.badge.x, want[0].value, "the fake's badge.x");
  assert.equal(fake.doc('every').nodes.badge.y, want[1].value, "the fake's badge.y");

  // a press without a drag (3 px or less) is a click: it selects and sends nothing
  const d = centre(await box(p, '#surface [data-id="dot"]'));
  n0 = edits(rec).length;
  await drag(p, d, 2, 2);
  await within(async () => JSON.stringify(await selectedIds(p)) === '["dot"]', 'the press on dot selected it', async () => JSON.stringify(await selectedIds(p)), 5000);
  await sendsNothing(rec, n0, 'a press of 2 px');

  // Escape during a drag drops it: badge back where it was (kit-668: any live frames followed by a
  // restore, the fake's badge where it was), the selection kept
  n0 = edits(rec).length;
  await drag(p, centre(b1), 40, 0, async () => {
    near((await box(p, '#surface [data-id="badge"]')).l, b1.l + 40, 1, 'previewed before Escape');
    await p.key('Escape');
  });
  await sleep(600);
  const esc = edits(rec).slice(n0);
  for (const f of esc) assert.ok(f.ops.every((o) => o.op === 'set' && o.id === 'badge' && ['x', 'y'].includes(o.prop)), `Escape: live frames and a restore only: ${JSON.stringify(f.ops)}`);
  if (esc.length) assert.deepEqual(esc[esc.length - 1].ops, [{ op: 'set', id: 'badge', prop: 'x', value: want[0].value }], 'Escape after live frames: the last frame restores x');
  await waitSaved(p);
  assert.deepEqual([fake.doc('every').nodes.badge.x, fake.doc('every').nodes.badge.y], [want[0].value, want[1].value], "Escape: the fake's badge where it was");
  const b2 = await box(p, '#surface [data-id="badge"]');
  near(b2.l, b1.l, 0.5, 'badge back: x');
  near(b2.t, b1.t, 0.5, 'badge back: y');
  assert.deepEqual(await selectedIds(p), ['badge'], 'Escape during a drag keeps the selection');

  // a drag released outside the stage still ends (pointer capture): released over the Layers panel,
  // the drop is on the page, by the same rule as any drop there
  const lay = await box(p, '#layers');
  n0 = edits(rec).length;
  await dragPath(p, [centre(b2), { x: Math.round(lay.l + lay.w / 2), y: centre(b2).y }]);
  await within(async () => edits(rec).slice(n0).some((f) => f.ops[0].op === 'move'), 'the move sent', async () => JSON.stringify(edits(rec).slice(n0).map((f) => f.ops)), 10000);
  await sendsNothing(rec, edits(rec).length, 'after the move');
  const out = edits(rec)[edits(rec).length - 1];
  assert.deepEqual(out.ops[0], { op: 'move', id: 'badge', parent: 'p-main', after: 'tiles' }, 'released outside the stage: the last frame a move onto the page');
  assert.deepEqual(out.ops.slice(1).map((o) => o.prop), ['x', 'y'], 'with set x and set y');
  await ackOf(rec, out);
  assert.equal(await p.ev("document.querySelector('#surface [data-id=\"badge\"]').style.translate"), '', 'no preview left');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

test('drag into and within auto-layout', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const z = await zoomNow(p);
  const kids = (id) => fake.doc('every').nodes[id].children;

  // dot (in the column card) to the lower half of photo's drawn box: one move into card after photo
  let dot = await box(p, '#surface [data-id="dot"]');
  let photo = await box(p, '#surface [data-id="photo"]');
  let n0 = edits(rec).length;
  await dragPath(p, [centre(dot), { x: Math.round(photo.l + photo.w / 2), y: Math.round(photo.t + photo.h * 0.75) }]);
  let e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'move', id: 'dot', parent: 'card', after: 'photo' }], 'one move of dot after photo');
  await ackOf(rec, e);
  await waitSaved(p);
  assert.deepEqual(kids('card'), ['title', 'rule', 'icon', 'photo', 'dot', 'actions'], "the fake's card");
  photo = await box(p, '#surface [data-id="photo"]');
  dot = await box(p, '#surface [data-id="dot"]');
  assert.ok(dot.t >= photo.b, 'dot drawn below photo');

  // dot to the centre of loose's drawn box: one edit of a move into loose with set x and set y, where
  // the drop put it (its top-left, as previewed) in loose's px, whole
  const loose = await box(p, '#surface [data-id="loose"]');
  const from = centre(dot);
  const to = centre(loose);
  n0 = edits(rec).length;
  await dragPath(p, [from, to]);
  e = await nextEdit(rec, n0);
  const x = Math.round((dot.l + (to.x - from.x) - loose.l) / z);
  const y = Math.round((dot.t + (to.y - from.y) - loose.t) / z);
  assert.deepEqual(e.ops, [{ op: 'move', id: 'dot', parent: 'loose', after: 'badge' }, { op: 'set', id: 'dot', prop: 'x', value: x }, { op: 'set', id: 'dot', prop: 'y', value: y }], 'a move into loose with its x, y');
  await ackOf(rec, e);
  await waitSaved(p);
  assert.deepEqual(kids('loose'), ['badge', 'dot']);
  assert.equal(fake.doc('every').nodes.dot.x, x);
  assert.equal(fake.doc('every').nodes.dot.y, y);
  dot = await box(p, '#surface [data-id="dot"]');
  near(dot.l, loose.l + x * z, 1, 'dot drawn at its x in loose');
  near(dot.t, loose.t + y * z, 1, 'dot drawn at its y in loose');
  assert.equal(await p.ev("document.querySelector('#surface [data-id=\"dot\"]').parentElement.dataset.id"), 'loose', 'drawn inside loose');

  // badge to the lower half of title's drawn box: a move into card after title, and no x, y
  const badge = await box(p, '#surface [data-id="badge"]');
  const title = await box(p, '#surface [data-id="title"]');
  n0 = edits(rec).length;
  await dragPath(p, [centre(badge), { x: Math.round(title.l + title.w / 2), y: Math.round(title.t + title.h * 0.75) }]);
  await within(async () => edits(rec).slice(n0).some((f) => f.ops[0].op === 'move'), 'the move sent', async () => JSON.stringify(edits(rec).slice(n0).map((f) => f.ops)), 10000);
  await sendsNothing(rec, edits(rec).length, 'after the move');
  e = edits(rec)[edits(rec).length - 1];
  assert.deepEqual(e.ops, [{ op: 'move', id: 'badge', parent: 'card', after: 'title' }], 'the last frame: one move of badge after title, no x, y');
  await ackOf(rec, e);
  await waitSaved(p);
  assert.deepEqual(kids('card'), ['title', 'badge', 'rule', 'icon', 'photo', 'actions'], "the fake's card");
  assert.equal(await p.ev("document.querySelector('#surface [data-id=\"badge\"]').parentElement.dataset.id"), 'card', 'badge drawn inside card');

  // within the column: rule dragged to the upper half of title goes first
  const rule = await box(p, '#surface [data-id="rule"]');
  const title2 = await box(p, '#surface [data-id="title"]');
  n0 = edits(rec).length;
  await dragPath(p, [centre(rule), { x: Math.round(title2.l + title2.w / 2), y: Math.round(title2.t + title2.h * 0.25) }]);
  e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'move', id: 'rule', parent: 'card', after: null }], 'rule moved first in card');
  await ackOf(rec, e);
  await waitSaved(p);
  assert.deepEqual(kids('card'), ['rule', 'title', 'badge', 'icon', 'photo', 'actions'], "the fake's card");
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

test('arrow keys nudge, coalesced', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const badgeAt = async () => centre(await box(p, '#surface [data-id="badge"]'));
  // badge selected by a click on its drawn node: focus stays on the page
  const pt = await badgeAt();
  await p.clickAt(pt.x, pt.y);
  await within(async () => JSON.stringify(await selectedIds(p)) === '["badge"]', 'badge selected');
  assert.equal(await p.ev('document.activeElement === document.body'), true, 'focus on the page');
  // Arrow Right: set x +1; Shift+Arrow Down: set y +10
  let n0 = edits(rec).length;
  await arrow(p, 'ArrowRight');
  let e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'set', id: 'badge', prop: 'x', value: 13 }], 'Arrow Right: x + 1');
  await ackOf(rec, e);
  n0 = edits(rec).length;
  await arrow(p, 'ArrowDown', true);
  e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'set', id: 'badge', prop: 'y', value: 2 }], 'Shift+Arrow Down: y + 10');
  await ackOf(rec, e);
  await waitSaved(p);

  // in a field the arrows are the field's, and on a Layers row they never nudge
  assert.equal(await focusField(p, 'x'), true, 'the X field focused');
  n0 = edits(rec).length;
  await arrow(p, 'ArrowRight');
  await arrow(p, 'ArrowUp');
  assert.equal(await p.ev("document.activeElement.matches('#props [data-prop=\"x\"]')"), true, 'focus still in the field');
  await leavePanel(p);
  assert.equal(await p.ev("(() => { const r = document.querySelector('#layers .layer[data-node=\"badge\"]'); r.focus(); return document.activeElement === r; })()"), true, "badge's row focused");
  for (const k of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']) await arrow(p, k);
  await sendsNothing(rec, n0, 'arrows in the X field and on a Layers row');
  assert.equal(fake.doc('every').nodes.badge.x, 13, 'x unchanged by those arrows');

  // 30 Arrow Right presses back to back: fewer than 30 frames, at most 21 in any second, each a single
  // set x, rising, at least one jump over 1, the last the start + 30, which the fake holds
  const pt2 = await badgeAt();
  await p.clickAt(pt2.x, pt2.y);
  await within(async () => (await p.ev('document.activeElement === document.body')) && JSON.stringify(await selectedIds(p)) === '["badge"]', 'badge selected, focus on the page');
  await sleep(1100); // the sender's last second clear
  n0 = edits(rec).length;
  const k = { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 };
  // the key held: 30 keydowns (the later ones auto-repeats, as a held key sends them), then its keyup,
  // dispatched without waiting on each other. When each press was made is its event's timeStamp (a
  // listener of the test's, on window, before the page's): the presses queue in the page and are
  // handled one after another, so the wall time to the last answer is the page's work, not the presses'
  await p.ev("window.pressedAt = []; addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') window.pressedAt.push(e.timeStamp); }, true)");
  const presses = [];
  for (let i = 0; i < 30; i++) presses.push(p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k, autoRepeat: i > 0 }));
  await Promise.all(presses);
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
  const stamps = await p.ev('window.pressedAt');
  assert.equal(stamps.length, 30, '30 presses reached the page');
  const span = stamps[stamps.length - 1] - stamps[0];
  t.diagnostic(`30 presses made within ${span.toFixed(1)} ms`);
  assert.ok(span <= 300, `30 presses within 300 ms (${span} ms)`);
  await within(async () => { const s = edits(rec).slice(n0); return s.length > 0 && s[s.length - 1].ops[0].value === 43; }, 'the last nudge sent', async () => JSON.stringify(edits(rec).slice(n0).map((x) => x.ops)), 10000);
  await waitSaved(p);
  await sleep(300);
  const burst = edits(rec).slice(n0);
  const at = rec.sentAt.filter((_, i) => rec.sent[i] && rec.sent[i].t === 'edit').slice(n0);
  assert.ok(burst.length < 30, `fewer than 30 edit frames (${burst.length})`);
  for (const f of burst) assert.deepEqual(f.ops.map((o) => [o.op, o.id, o.prop]), [['set', 'badge', 'x']], 'each a single set x');
  const vals = burst.map((f) => f.ops[0].value);
  for (let i = 1; i < vals.length; i++) assert.ok(vals[i] > vals[i - 1], `rising: ${vals.join(' ')}`);
  assert.ok(vals.some((v, i) => (i === 0 ? v - 13 : v - vals[i - 1]) > 1), `at least one jump over 1 (coalesced): ${vals.join(' ')}`);
  assert.equal(vals[vals.length - 1], 43, 'the last is the start + 30');
  for (let i = 0; i < at.length; i++) assert.ok(at.filter((x) => x >= at[i] && x < at[i] + 1000).length <= 21, 'at most 21 in any second');
  assert.equal(fake.doc('every').nodes.badge.x, 43, "the fake's badge.x");
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

test('a drag into its own subtree sends nothing', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  // a frame pressed and dragged over itself and back, released on itself: it isn't dropped into itself
  // (nor into its child), so nothing is sent; nor is the row actions, dragged out and back in card
  let n0 = edits(rec).length;
  const loose = await box(p, '#surface [data-id="loose"]');
  const lp = { x: Math.round(loose.l + loose.w * 0.6), y: Math.round(loose.t + loose.h * 0.6) };
  const badge = centre(await box(p, '#surface [data-id="badge"]'));
  const loose0 = { x: fake.doc('every').nodes.loose.x, y: fake.doc('every').nodes.loose.y };
  await dragPath(p, [lp, { x: lp.x + 40, y: lp.y + 30 }, { x: lp.x + (badge.x - lp.x) / 2, y: lp.y + (badge.y - lp.y) / 2 }, lp]);
  await sleep(600);
  for (const f of edits(rec).slice(n0)) assert.ok(f.ops.every((o) => o.op === 'set' && o.id === 'loose' && ['x', 'y'].includes(o.prop)), `loose out and back: live frames only: ${JSON.stringify(f.ops)}`);
  await waitSaved(p);
  assert.deepEqual({ x: fake.doc('every').nodes.loose.x, y: fake.doc('every').nodes.loose.y, parent: fake.doc('every').nodes.loose.parent }, { ...loose0, parent: 'p-main' }, "loose dropped where it was: the fake's loose unchanged");
  const actions = await box(p, '#surface [data-id="actions"]');
  const ap = { x: Math.round(actions.r - 6), y: Math.round(actions.t + actions.h / 2) };
  assert.equal(await hitAt(p, ap), 'actions');
  n0 = edits(rec).length;
  await dragPath(p, [ap, { x: ap.x, y: ap.y - 30 }, ap]);
  await sendsNothing(rec, n0, 'actions dropped where it was');
  // dragged by (40, 30) and released on itself: moved within its parent, never into itself
  n0 = edits(rec).length;
  await dragPath(p, [lp, { x: lp.x + 40, y: lp.y + 30 }]);
  await nextEdit(rec, n0);
  await waitSaved(p); // every frame of the drag sent and acked
  const e = edits(rec)[edits(rec).length - 1];
  assert.deepEqual(e.ops.map((o) => [o.op, o.id, o.prop]), [['set', 'loose', 'x'], ['set', 'loose', 'y']], 'loose moved within the page: the last frame');
  await ackOf(rec, e);

  // a component dropped into another component, or a frame holding one: refused here with the page's
  // words, nothing sent, and drawn back where it was
  const a = await ana(fake, later);
  await a.edit([
    { op: 'add', node: { id: 'chip', type: 'component', parent: 'p-parts', name: 'Chip', x: 400, y: 0, size: { w: 120, h: 60 }, layout: { mode: 'none' }, fill: '#cccccc' }, after: 'button' },
    { op: 'add', node: { id: 'holder', type: 'frame', parent: 'p-parts', name: 'Holder', x: 400, y: 200, size: { w: 200, h: 150 }, layout: { mode: 'none' }, fill: '#eeeeee' }, after: 'chip' },
    { op: 'add', node: { id: 'chip2', type: 'component', parent: 'holder', name: 'Chip 2', x: 150, y: 100, size: { w: 40, h: 40 }, layout: { mode: 'none' }, fill: '#999999' }, after: null },
  ]);
  await within(async () => (await body(p, 'rev')) === String(fake.rev('every')), 'the page has Ana\'s edit');
  await p.click('#pages a[data-page="p-parts"]');
  await within(async () => (await count(p, '#surface [data-id="chip"]')) === 1 && (await count(p, '#surface [data-id="button"]')) === 1, 'Parts shown with chip');
  const button = centre(await box(p, '#surface [data-id="button"]'));
  for (const [id, grab] of [['chip', (b) => centre(b)], ['holder', (b) => ({ x: Math.round(b.l + 10), y: Math.round(b.t + 10) })]]) {
    const b0 = await box(p, `#surface [data-id="${id}"]`);
    const from = grab(b0);
    assert.equal(await hitAt(p, from), id, `the press is on ${id}`);
    await p.ev("document.getElementById('toast').hidden = true");
    const start = { x: fake.doc('every').nodes[id].x, y: fake.doc('every').nodes[id].y };
    n0 = edits(rec).length;
    await dragPath(p, [from, button]);
    await within(async () => (await shownText(p, '#toast')) === CANT_GO, `${id}: the page says it can't go there`, async () => shownText(p, '#toast'), 5000);
    // kit-668: a restore if live frames went, the fake's node at its start
    await sleep(600);
    const fr = edits(rec).slice(n0);
    for (const f of fr) assert.ok(f.ops.every((o) => o.op === 'set' && o.id === id && ['x', 'y'].includes(o.prop)), `${id}: live frames and a restore only: ${JSON.stringify(f.ops)}`);
    if (fr.length) assert.deepEqual(fr[fr.length - 1].ops.map((o) => o.value), fr[fr.length - 1].ops.map((o) => start[o.prop]), `${id}: the last frame restores the start`);
    await waitSaved(p);
    assert.deepEqual({ x: fake.doc('every').nodes[id].x, y: fake.doc('every').nodes[id].y }, start, `${id}: the fake's node at its start`);
    const b1 = await box(p, `#surface [data-id="${id}"]`);
    near(b1.l, b0.l, 0.5, `${id} drawn back: x`);
    near(b1.t, b0.t, 0.5, `${id} drawn back: y`);
    assert.equal(fake.doc('every').nodes[id].parent, 'p-parts', `${id} still on the page`);
  }
  // a component dragged on the page itself moves
  const chip = await box(p, '#surface [data-id="chip"]');
  n0 = edits(rec).length;
  await dragPath(p, [centre(chip), { x: centre(chip).x + 30, y: centre(chip).y + 40 }]);
  const m = await nextEdit(rec, n0);
  assert.deepEqual(m.ops.map((o) => [o.op, o.id, o.prop]), [['set', 'chip', 'x'], ['set', 'chip', 'y']], 'chip moved on its page');
  await ackOf(rec, m);
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

// ---- components, variants and instances (spec §3) ----

const VARIANT_NOTE = "A variant's name is a letter, then letters, digits or _.";
const OWN_COMPONENT = "An instance can't go inside its own component.";
const offered = (p, action) => count(p, `#props [data-action="${action}"]`);
const variantsListed = (p) => p.ev("[...document.querySelectorAll('#props [data-action=\"remove-variant\"]')].map((b) => b.dataset.variant)");
const hideToast = (p) => p.ev("document.getElementById('toast').hidden = true");

test('make component', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  // offered on a frame where a component may be; not on another type, nor on a frame in a component,
  // nor on a frame holding a component
  await selectRow(p, 'badge');
  assert.equal(await offered(p, 'make-component'), 0, 'not on a rect');
  const a = await ana(fake, later);
  await a.edit([
    { op: 'add', node: { id: 'holder', type: 'frame', parent: 'p-parts', name: 'Holder', x: 400, y: 200, size: { w: 200, h: 150 }, layout: { mode: 'none' } }, after: 'button' },
    { op: 'add', node: { id: 'chip', type: 'component', parent: 'holder', name: 'Chip', x: 10, y: 10, size: { w: 40, h: 40 }, layout: { mode: 'none' } }, after: null },
  ]);
  await within(async () => (await body(p, 'rev')) === String(fake.rev('every')), "the page has Ana's edit");
  await showPg(p, 'p-parts');
  await selectRow(p, 'button-bg');
  assert.equal(await offered(p, 'make-component'), 0, 'not on a frame inside a component');
  await selectRow(p, 'holder');
  assert.equal(await offered(p, 'make-component'), 0, 'not on a frame holding a component');

  // loose (a `none` frame on the page, holding badge) made a component: one edit
  await showPg(p, 'p-main');
  await selectRow(p, 'loose');
  assert.equal(await offered(p, 'make-component'), 1, 'offered on loose');
  const looseBox = await box(p, '#surface [data-id="loose"]');
  const badgeBox = await box(p, '#surface [data-id="badge"]');
  const n0 = edits(rec).length;
  await p.click('#props [data-action="make-component"]');
  const e = await nextEdit(rec, n0);
  assert.equal(e.ops.length, 3, `one edit of three ops (${JSON.stringify(e.ops)})`);
  const cid = e.ops[0].node?.id;
  assert.match(String(cid), /^[0-9a-z]{6}-\d+$/, 'a new id <prefix>-<n>');
  assert.deepEqual(e.ops, [
    { op: 'add', node: { id: cid, type: 'component', parent: 'p-main', name: 'Loose', layout: { mode: 'none' }, size: { w: 200, h: 200 }, x: 400, y: 0 }, after: 'loose' },
    { op: 'move', id: 'badge', parent: cid, after: null },
    { op: 'del', id: 'loose' },
  ], 'add the component with the frame\'s properties after it, move its child, delete the frame');
  await ackOf(rec, e);
  await sleep(200);
  assert.equal(edits(rec).length, n0 + 1, 'exactly one edit frame');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  const d = fake.doc('every');
  assert.equal(Object.hasOwn(d.nodes, 'loose'), false, 'the frame is gone');
  assert.equal(d.nodes[cid].type, 'component');
  assert.deepEqual(d.nodes[cid].children, ['badge'], 'the component holds badge');
  assert.equal(d.nodes.badge.parent, cid);
  assert.deepEqual([d.nodes.badge.x, d.nodes.badge.y], [12, -8], 'badge keeps its place');
  assert.deepEqual(d.pages[0].children, ['card', cid, 'tiles'], "the component in the frame's place");
  // drawn with its child, where the frame was, and selected
  await within(async () => (await count(p, `#surface [data-id="${cid}"] [data-id="badge"]`)) === 1, 'the component drawn holding badge');
  assert.equal(await count(p, '#surface [data-id="loose"]'), 0, 'loose no longer drawn');
  const cb = await box(p, `#surface [data-id="${cid}"]`);
  const bb = await box(p, '#surface [data-id="badge"]');
  for (const k of ['l', 't', 'w', 'h']) {
    near(cb[k], looseBox[k], 0.5, `the component drawn as loose was: ${k}`);
    near(bb[k], badgeBox[k], 0.5, `badge drawn where it was: ${k}`);
  }
  assert.deepEqual(await selectedIds(p), [cid], 'the component selected');
  assert.equal(await offered(p, 'make-component'), 0, 'a component is not offered make component');
  assert.equal(await offered(p, 'place-instance'), 1, 'a component offers place instance');
  await waitSaved(p);
  noExceptions(rec);
});

test('variants', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await showPg(p, 'p-parts');
  await selectRow(p, 'button');
  assert.deepEqual(await variantsListed(p), ['primary', 'quiet'], "button's variants listed, each with Remove");
  // Add variant dark
  let n0 = edits(rec).length;
  assert.equal(await focusField(p, '@new-variant'), true, 'the variant name field');
  await typeKeys(p, 'dark');
  await p.click('#props [data-action="add-variant"]');
  let e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [setOp('button', 'variants.dark', {})], 'Add variant sends one set of {}');
  await ackOf(rec, e);
  await within(async () => JSON.stringify(await variantsListed(p)) === '["primary","quiet","dark"]', 'dark listed', () => variantsListed(p));
  assert.deepEqual(fake.doc('every').nodes.button.variants.dark, {}, 'the fake holds dark');
  // a bad name: its note, nothing sent
  for (const bad of ['1x', 'dark-mode']) {
    n0 = edits(rec).length;
    assert.equal(await focusField(p, '@new-variant'), true, 'the variant name field');
    await typeKeys(p, bad);
    await p.click('#props [data-action="add-variant"]');
    await within(async () => (await notes(p)).includes(VARIANT_NOTE), `${bad}: the variant name's note`, () => notes(p), 5000);
    await sendsNothing(rec, n0, `the name ${bad}`);
  }
  // Remove on dark
  n0 = edits(rec).length;
  await p.click('#props [data-action="remove-variant"][data-variant="dark"]');
  e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [setOp('button', 'variants.dark', null)], 'Remove sends one set of null');
  await ackOf(rec, e);
  await within(async () => JSON.stringify(await variantsListed(p)) === '["primary","quiet"]', 'dark no longer listed', () => variantsListed(p));
  assert.equal(Object.hasOwn(fake.doc('every').nodes.button.variants, 'dark'), false, 'the fake no longer holds dark');
  // Change in shows on a node inside the component (it has variants), not on the component itself
  assert.equal(await count(p, '#props [data-prop="@variant"]'), 0, 'no Change in on the component');
  await selectRow(p, 'button-label');
  const opts = await p.ev("[...document.querySelectorAll('#props [data-prop=\"@variant\"] option')].map((o) => o.textContent)");
  assert.deepEqual(opts, ['Base', 'primary', 'quiet'], 'Change in: Base or a variant');
  // in primary, the label's text shows the variant's value and sends to the variant
  await fieldSet(p, '@variant', 'primary');
  assert.equal(await p.ev("document.querySelector('#props [data-prop=\"text\"]').value"), 'Variant label', "the variant's value shown");
  n0 = edits(rec).length;
  await fieldSet(p, 'text', 'Go');
  e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [setOp('button', 'variants.primary.button-label.text', 'Go')], 'sent to the variant');
  await ackOf(rec, e);
  assert.equal(await text(p, '#surface [data-id="button-label"]'), 'Base label', 'the stage keeps the base');
  // back to Base: a set on the node itself
  await fieldSet(p, '@variant', '@base');
  assert.equal(await p.ev("document.querySelector('#props [data-prop=\"text\"]').value"), 'Base label', 'the base value shown');
  await waitSaved(p);
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

test('place an instance and set its variant', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await showPg(p, 'p-parts');
  // Place instance, then a click on the stage beside button
  await selectRow(p, 'button');
  const b = await box(p, '#surface [data-id="button"]');
  const pt = { x: Math.round(b.r + 150), y: Math.round(b.t + 30) };
  assert.equal(['button', 'button-bg', 'button-label'].includes(await hitAt(p, pt)), false, 'the click is beside button');
  let n0 = edits(rec).length;
  await p.click('#props [data-action="place-instance"]');
  await mouse(p, 'mousePressed', pt.x, pt.y);
  await mouse(p, 'mouseReleased', pt.x, pt.y);
  const add = await added(rec, n0, 'the instance');
  const iid = add.node.id;
  assert.equal(add.node.type, 'instance');
  assert.equal(add.node.component, 'button', 'of button');
  assert.equal(add.node.name, 'Button', "named as button");
  assert.deepEqual(add.node.size, { w: 'hug', h: 'hug' }, 'hug × hug');
  assert.equal(add.node.parent, 'p-parts', 'on the page');
  assert.equal(add.after, 'button', 'after the last node');
  const s = await p.ev("(() => { const r = document.getElementById('surface').getBoundingClientRect(); return { l: r.left, t: r.top }; })()");
  const z = await zoomNow(p);
  assert.deepEqual([add.node.x, add.node.y], [Math.round((pt.x - s.l) / z), Math.round((pt.y - s.t) / z)], 'at the pointer');
  await madeAndSelected(p, iid, 'the instance');
  await within(async () => (await count(p, `#surface [data-id="${iid}"]`)) === 1, 'the instance drawn');
  assert.equal(fake.doc('every').nodes[iid].component, 'button', 'the fake holds the instance');
  // its Variant set to primary
  n0 = edits(rec).length;
  await fieldSet(p, 'variant', 'primary');
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [setOp(iid, 'variant', 'primary')], 'the variant set');
  await ackOf(rec, e);
  assert.equal(fake.doc('every').nodes[iid].variant, 'primary');
  await within(async () => (await text(p, '#props [data-field="variant"]')) === 'primary', 'the Variant row reads primary');

  // never inside its own component: a click on button's drawn box adds nothing and says so
  await selectRow(p, 'button');
  await hideToast(p);
  n0 = edits(rec).length;
  await p.click('#props [data-action="place-instance"]');
  const inside = centre(await box(p, '#surface [data-id="button-label"]'));
  await mouse(p, 'mousePressed', inside.x, inside.y);
  await mouse(p, 'mouseReleased', inside.x, inside.y);
  await within(async () => (await shownText(p, '#toast')) === OWN_COMPONENT, 'the page says an instance cannot go inside its own component', () => shownText(p, '#toast'), 5000);
  await sendsNothing(rec, n0, 'an instance inside its own component');
  assert.equal(await pressedTool(p), 'move', 'the tool back to Move');
  // Escape ends placing: the next click adds nothing
  await p.click('#props [data-action="place-instance"]');
  await p.key('Escape');
  await mouse(p, 'mousePressed', pt.x, pt.y + 120);
  await mouse(p, 'mouseReleased', pt.x, pt.y + 120);
  await sendsNothing(rec, n0, 'a click after Escape');

  // an instance dragged into the component it names (T4-1): buy, moved to Parts by Ana, onto button
  const a = await ana(fake, later);
  await a.edit([
    { op: 'move', id: 'buy', parent: 'p-parts', after: iid },
    { op: 'set', id: 'buy', prop: 'x', value: 0 },
    { op: 'set', id: 'buy', prop: 'y', value: 300 },
  ]);
  await within(async () => (await count(p, '#surface [data-id="buy"]')) === 1, 'buy drawn on Parts');
  const buy0 = await box(p, '#surface [data-id="buy"]');
  await hideToast(p);
  n0 = edits(rec).length;
  await dragPath(p, [centre(buy0), centre(await box(p, '#surface [data-id="button"]'))]);
  await within(async () => (await shownText(p, '#toast')) === OWN_COMPONENT, 'buy dropped on button: the own-component words', () => shownText(p, '#toast'), 5000);
  // kit-668: a restore if live frames went, the fake's buy unchanged
  await sleep(600);
  const fr = edits(rec).slice(n0);
  for (const f of fr) assert.ok(f.ops.every((o) => o.op === 'set' && o.id === 'buy' && ['x', 'y'].includes(o.prop)), `buy: live frames and a restore only: ${JSON.stringify(f.ops)}`);
  if (fr.length) assert.deepEqual(fr[fr.length - 1].ops.map((o) => o.value), fr[fr.length - 1].ops.map((o) => ({ x: 0, y: 300 })[o.prop]), 'buy: the last frame restores the start');
  await waitSaved(p);
  assert.deepEqual([fake.doc('every').nodes.buy.x, fake.doc('every').nodes.buy.y], [0, 300], "buy unchanged in the fake");
  const buy1 = await box(p, '#surface [data-id="buy"]');
  near(buy1.l, buy0.l, 0.5, 'buy drawn back: x');
  near(buy1.t, buy0.t, 0.5, 'buy drawn back: y');
  assert.equal(fake.doc('every').nodes.buy.parent, 'p-parts', 'buy still on the page');
  await waitSaved(p);
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

// ---- the Layers tree by keyboard (C5), narrow screens and width (C6) ----

// A key as a keyboard sends it, with its own virtual key code (the helper's key() gives these keys a
// letter's code), and no text.
const VK = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, Delete: 46, Backspace: 8, Tab: 9 };
async function press(p, k) {
  const c = { key: k, code: k, windowsVirtualKeyCode: VK[k], nativeVirtualKeyCode: VK[k] };
  await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...c });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...c });
}
// The Layers tree as it stands: its rows, the rows in the tab order (tabIndex 0), whether every other
// row is -1, the selected rows, the focused row and its outline, the Name row, and the drawn selection.
const tree = (p) => p.ev(`(() => {
  const rows = [...document.querySelectorAll('#layers .layer[data-node]')];
  const a = document.activeElement;
  const inTree = a instanceof Element && a.matches('#layers .layer[data-node]');
  const sel = [...document.querySelectorAll('#surface .sel')];
  return {
    rows: rows.map((r) => r.dataset.node),
    stops: rows.filter((r) => r.tabIndex === 0).map((r) => r.dataset.node),
    rest: rows.every((r) => r.tabIndex === 0 || r.tabIndex === -1),
    selected: rows.filter((r) => r.getAttribute('aria-selected') === 'true').map((r) => r.dataset.node),
    focused: inTree ? a.dataset.node : null,
    outline: inTree ? getComputedStyle(a).outlineStyle : null,
    outlineW: inTree ? parseFloat(getComputedStyle(a).outlineWidth) : 0,
    name: document.querySelector('#props [data-field="name"]')?.textContent ?? null,
    drawn: sel.map((e) => e.dataset.id ?? null),
    drawnOutline: sel.length ? getComputedStyle(sel[0]).outlineStyle : null,
  };
})()`);
// Focus is on `id`'s row, and it is selected, the one tab stop, ringed, named and drawn outlined.
async function onRow(p, id, what) {
  await within(async () => (await tree(p)).focused === id, `${what}: focus on ${id}'s row`, async () => JSON.stringify(await tree(p)), 5000);
  await within(async () => (await tree(p)).name === EVERY.nodes[id].name, `${what}: the Name row shows ${id}'s name`, async () => JSON.stringify(await tree(p)), 5000);
  const s = await tree(p);
  assert.deepEqual(s.selected, [id], `${what}: ${id} selected`);
  assert.deepEqual(s.stops, [id], `${what}: ${id}'s row the one tab stop`);
  assert.equal(s.rest, true, `${what}: every other row -1`);
  assert.ok(s.outline !== 'none' && s.outlineW > 0, `${what}: the focused row ringed (${s.outline} ${s.outlineW})`);
  assert.deepEqual(s.drawn, [id], `${what}: ${id} drawn outlined`);
  assert.notEqual(s.drawnOutline, 'none', `${what}: the drawn outline shown`);
}

test('the Layers tree by keyboard', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const n0 = edits(rec).length;
  const t0 = await tree(p);
  const rows = t0.rows;
  assert.deepEqual(rows, ['card', 'title', 'rule', 'dot', 'icon', 'photo', 'actions', 'buy', 'loose', 'badge', 'tiles'], "Checkout's rows");
  assert.deepEqual(t0.stops, ['card'], 'nothing selected: the first row the one tab stop');
  assert.equal(t0.rest, true, 'every other row -1');
  // Tab from the page's start reaches a row within 20 presses: the first
  let tabs = 0;
  while ((await tree(p)).focused === null && tabs < 20) { await press(p, 'Tab'); tabs++; }
  const s = await tree(p);
  assert.equal(s.focused, 'card', `Tab reaches card's row (${tabs} presses; focus on ${await p.ev('document.activeElement?.outerHTML.slice(0, 80) ?? null')})`);
  assert.ok(s.outline !== 'none' && s.outlineW > 0, `the row reached by Tab ringed (${s.outline})`);
  // ArrowDown, ArrowUp, End, Home
  await press(p, 'ArrowDown');
  await onRow(p, 'title', 'ArrowDown');
  await press(p, 'ArrowUp');
  await onRow(p, 'card', 'ArrowUp');
  await press(p, 'ArrowUp');
  await onRow(p, 'card', 'ArrowUp on the first row');
  await press(p, 'End');
  await onRow(p, 'tiles', 'End');
  await press(p, 'ArrowDown');
  await onRow(p, 'tiles', 'ArrowDown on the last row');
  await press(p, 'Home');
  await onRow(p, 'card', 'Home');
  // down every row (card, loose and badge are placed by x, y: the arrows never nudge them)
  for (const id of rows.slice(1)) {
    await press(p, 'ArrowDown');
    await onRow(p, id, `ArrowDown to ${id}`);
  }
  for (const id of rows.slice(0, -1).reverse()) {
    await press(p, 'ArrowUp');
    await onRow(p, id, `ArrowUp to ${id}`);
  }
  await sendsNothing(rec, n0, 'the walk');
  for (const id of ['card', 'loose', 'badge']) {
    assert.equal(fake.doc('every').nodes[id].x, EVERY.nodes[id].x, `${id}'s x unchanged`);
    assert.equal(fake.doc('every').nodes[id].y, EVERY.nodes[id].y, `${id}'s y unchanged`);
  }
  // a click on the drawn dot makes dot's row the tab stop
  const dot = await box(p, '#surface [data-id="dot"]');
  const pt = centre(dot);
  assert.equal(await hitAt(p, pt), 'dot', 'the point is on dot');
  await p.clickAt(pt.x, pt.y);
  await within(async () => (await tree(p)).stops.join(' ') === 'dot', "dot's row the tab stop", async () => JSON.stringify(await tree(p)), 5000);
  const d = await tree(p);
  assert.deepEqual(d.selected, ['dot'], 'dot selected');
  assert.equal(d.rest, true, 'every other row -1');
  await sendsNothing(rec, n0, 'the click');
  // back into the tree at dot's row, and Delete on the focused rule row: one del of rule
  await p.ev(`document.querySelector('#layers .layer[data-node="dot"]').focus()`);
  await press(p, 'ArrowUp');
  await onRow(p, 'rule', 'ArrowUp from dot');
  await press(p, 'Delete');
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'del', id: 'rule' }], 'one del of rule');
  await ackOf(rec, e);
  await sendsNothing(rec, n0 + 1, 'after the del');
  assert.equal(fake.doc('every').nodes.rule, undefined, 'rule gone from the fake');
  const after = await tree(p);
  assert.equal(after.rows.includes('rule'), false, "rule's row gone");
  assert.equal(after.stops.length, 1, `one tab stop after the delete (${after.stops.join(' ')})`);
  assert.equal(after.rest, true, 'every other row -1 after the delete');
  assert.equal(after.focused, after.stops[0], 'focus stays in the tree, on the tab stop');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

// final-1 F1: another person's edits leave the Pages list as it is. A link with focus keeps it (so the
// arrow keys don't fall to the page and nudge the selected node), and the page select's options are the
// same elements (an open picker isn't replaced under it). A renamed page rebuilds the list; focus stays
// on the same page's link.
test("the Pages list keeps focus through others' edits", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const a = await ana(fake, later);
  await selectRow(p, 'loose');
  const focusedPage = (pg) => pg.ev("(() => { const e = document.activeElement; return e instanceof Element && e.matches('#pages a[data-page]') ? e.dataset.page : (e ? e.localName : null); })()");
  assert.equal(await p.ev("(() => { const e = document.querySelector('#pages a[data-page=\"p-main\"]'); e.focus(); return document.activeElement === e; })()"), true, "Checkout's link focused");
  await p.ev("(() => { window.__mainLink = document.querySelector('#pages a[data-page=\"p-main\"]'); window.__firstOpt = document.querySelector('#pageSel option'); })()");
  const n0 = edits(rec).length;
  for (const [i, words] of [[1, 'From Ana'], [2, 'Again from Ana']]) {
    await a.edit([setOp('title', 'text', words)]);
    await within(async () => (await text(p, '#surface [data-id="title"]')) === words, `Ana's edit ${i} drawn`, async () => text(p, '#surface [data-id="title"]'), 5000);
    assert.equal(await focusedPage(p), 'p-main', `Checkout's link keeps focus through Ana's edit ${i}`);
    assert.equal(await p.ev("document.querySelector('#pages a[data-page=\"p-main\"]') === window.__mainLink"), true, `the Pages link not rebuilt by Ana's edit ${i}`);
    assert.equal(await p.ev("document.querySelector('#pageSel option') === window.__firstOpt"), true, `the page select's options not replaced by Ana's edit ${i}`);
  }
  // the arrow keys on the link are the link's: nothing nudged, nothing sent
  await arrow(p, 'ArrowDown');
  await arrow(p, 'ArrowRight');
  await sendsNothing(rec, n0, 'arrows on a Pages link');
  assert.equal(await focusedPage(p), 'p-main', "Checkout's link still focused after the arrows");
  // Ana renames the other page: the list shows it, and focus is still on Checkout's link
  await a.edit([setOp('p-parts', 'name', 'Parts 2')]);
  await within(async () => (await text(p, '#pages a[data-page="p-parts"]')) === 'Parts 2', 'the renamed page shown', async () => text(p, '#pages a[data-page="p-parts"]'), 5000);
  assert.equal(await text(p, '#pageSel option[value="p-parts"]'), 'Parts 2', 'the page select shows the new name');
  assert.equal(await focusedPage(p), 'p-main', "Checkout's link keeps focus through the rename");
  assert.equal(await shownPage(p), 'p-main', 'Checkout still shown');
  await sendsNothing(rec, n0, "Ana's edits");
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

test("a narrow screen doesn't edit", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec, size } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every'), size: [390, 844] });
  await live(p);
  assert.equal(await p.ev("(() => { const t = document.getElementById('tools'); return getComputedStyle(t).display === 'none' || t.getBoundingClientRect().width === 0; })()"), true, 'the tools bar not shown');
  const n0 = edits(rec).length;
  for (const id of ['title', 'badge']) {
    const pt = centre(await box(p, `#surface [data-id="${id}"]`));
    assert.equal(await hitAt(p, pt), id, `the point is on ${id}`);
    await p.clickAt(pt.x, pt.y);
    await within(async () => (await selectedIds(p)).join(' ') === id, `${id} selected by a click`, async () => selectedIds(p), 5000);
    for (const k of ['F', 'R']) {
      await p.key(k);
      assert.equal(await pressedTool(p), 'move', `${id}: ${k} changes no tool`);
    }
    for (const k of ['Delete', 'Backspace', 'ArrowRight', 'ArrowDown']) await press(p, k);
    await sendsNothing(rec, n0, `${id}: F, R, Delete, Backspace and the arrows`);
    assert.equal(await count(p, `#surface [data-id="${id}"]`), 1, `${id} still drawn`);
    // the panel's fields are there for the wide layout, and none of them can be used
    const ctl = await propControls(p);
    assert.ok(ctl.length > 0, `${id}: the panel built`);
    assert.deepEqual(ctl.filter((c) => !c.off).map((c) => c.prop), [], `${id}: every field disabled under 760 px`);
    assert.equal(await p.ev("[...document.querySelectorAll('#props button')].every((b) => b.disabled)"), true, `${id}: every panel button disabled`);
  }
  // wide again: badge still selected, its fields usable, and the keys work
  await size(1440, 900);
  await within(async () => (await p.ev('innerWidth')) === 1440, 'the window at 1440');
  await within(async () => (await propControls(p)).every((c) => !c.off), 'the fields usable at 1440', async () => JSON.stringify(await propControls(p)), 5000);
  await p.key('F');
  assert.equal(await pressedTool(p), 'frame', '1440: F presses Frame');
  await p.key('Escape');
  noExceptions(rec);
});

// kit-661's walk (canvas-editor.test.mjs, C4.1), copied: every visible element outside #surface that
// directly holds a non-blank text node and may wrap: a name for it and its width on screen.
const RUNNING_TEXT = `(() => {
  const surface = document.getElementById('surface');
  const out = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (surface.contains(el) || el.closest('script, style')) continue;
    if (![...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.data.trim() !== '')) continue;
    if (el.getClientRects().length === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible') continue;
    const wraps = cs.textWrapMode ? cs.textWrapMode !== 'nowrap' : !['nowrap', 'pre'].includes(cs.whiteSpace);
    if (!wraps) continue;
    const name = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + [...el.classList].map((c) => '.' + c).join('');
    out.push({ name, w: el.getBoundingClientRect().width });
  }
  return out;
})()`;

test('running text within six columns while editing', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every'), path: '/view/canvas/every#page=p-parts' });
  await live(p);
  const capped = (sel) => p.ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => getComputedStyle(e).maxWidth)`);
  const check = async (what, mustHold) => {
    const found = await p.ev(RUNNING_TEXT);
    for (const { name, w } of found) assert.ok(w <= 560.5, `${what}: ${name} is ${w} px wide, over the measure`);
    for (const m of mustHold) assert.ok(found.some((f) => f.name.startsWith(m)), `${what}: the walk reaches ${m} (found ${found.map((f) => f.name).join(', ')})`);
  };
  // the refused message of C3.3, then title selected on Checkout while it shows
  await selectRow(p, 'button-label');
  const n0 = edits(rec).length;
  await press(p, 'Delete');
  const e = await nextEdit(rec, n0);
  await within(async () => refusedFrames(rec).some((m) => m.seq === e.seq), 'the refused frame', async () => JSON.stringify(rec.got.slice(-3)));
  await within(async () => (await shownText(p, '#toast')) === SAY.ref, 'the refusal said', async () => shownText(p, '#toast'));
  await showPg(p, 'p-main');
  await selectRow(p, 'title');
  assert.equal(await shownText(p, '#toast'), SAY.ref, 'the refusal still shown');
  await check('title selected, the refusal shown', ['p#toast', 'span.v']);
  // a field note shown too: a colour typed as red on card
  await selectRow(p, 'card');
  await fieldSet(p, 'stroke#hex', 'red');
  await within(async () => (await notes(p)).length > 0, 'a field note', async () => JSON.stringify(await notes(p)));
  await check('card selected, a field note shown', ['p.note.fnote']);
  // the new running-text elements carry the cap itself (the banner too, while hidden)
  for (const sel of ['#toast', '#banner', '#props .fnote']) {
    const mw = await capped(sel);
    assert.ok(mw.length > 0 && mw.every((v) => /^(min\()?560px\b/.test(v)), `${sel} capped at the measure (${mw.join(', ')})`);
  }
  noExceptions(rec);
});

// ---- C1: every node type drawn with the tools, saved and reloaded unchanged (done-when 1) ----

const HOSTILE = fixture('hostile.json');
// What the page draws, in page px: every drawn node (`[data-id]`) and every node drawn inside an
// instance (`[data-of][data-src]`), in document order, with its tag, its box unscaled (from the
// surface's origin, over the zoom), its computed display and background colour; and the Layers rows'
// ids, names and levels.
const snapshot = (p) => p.ev(`(() => {
  const s = document.getElementById('surface');
  const o = s.getBoundingClientRect();
  const z = new DOMMatrix(getComputedStyle(s).transform).a;
  const drawn = [...s.querySelectorAll('[data-id], [data-of][data-src]')].map((e) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return { key: e.dataset.id ?? e.dataset.of + '/' + e.dataset.src, tag: e.localName, l: (r.left - o.left) / z, t: (r.top - o.top) / z, w: r.width / z, h: r.height / z, display: cs.display, bg: cs.backgroundColor };
  });
  const layers = [...document.querySelectorAll('#layers .layer[data-node]')].map((r) => ({ id: r.dataset.node, name: r.querySelector('.nm')?.textContent ?? null, level: r.getAttribute('aria-level') }));
  return { drawn, layers };
})()`);
// Two snapshots draw the same thing: the same rows and nodes, each node's tag, display and background
// equal and its box within 0.5 page px.
function sameDrawing(a, b) {
  assert.deepEqual(b.layers, a.layers, 'the Layers rows: ids, names and levels');
  assert.deepEqual(b.drawn.map((d) => d.key), a.drawn.map((d) => d.key), 'the same drawn nodes, in the same order');
  a.drawn.forEach((d, i) => {
    const e = b.drawn[i];
    assert.deepEqual([e.tag, e.display, e.bg], [d.tag, d.display, d.bg], `${d.key}: its tag, display and background`);
    for (const k of ['l', 't', 'w', 'h']) near(e[k], d[k], 0.5, `${d.key}: its box's ${k}`);
  });
}
const imagesLoaded = (p) => within(() => p.ev("[...document.querySelectorAll('#surface img')].every((i) => i.complete)"), 'the drawn images loaded');

test('canvas A8: every node type is drawn with the tools, saved and reloaded unchanged, and the hostile fixture loads nothing from elsewhere', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, origin, rec, load } = await open(t, { canvases: { draw: MINIMAL, hostile: HOSTILE }, images: { hostile: { [IMG_FILE]: IMG } } });
  await live(p);
  await rec.send('Page.setInterceptFileChooserDialog', { enabled: true });
  const folder = { images: new Set([IMG_FILE]) }; // the image the picker uploads is the only file draw's folder gets
  const id = {};
  let drawn = false;
  let kept = null;
  let before = null;

  // C1.1: on the empty page (p1), at 1440 × 900, with the tools and the panel only
  await t.test('C1.1 drawn with the tools', async () => {
    assert.equal(await shownMsg(p), 'This page is empty.', 'the empty page says so');
    const z = await zoomNow(p);
    // a point given in page px, on screen
    const at = async (x, y) => {
      const s = await box(p, '#surface');
      return { x: Math.round(s.l + x * z), y: Math.round(s.t + y * z) };
    };
    // one tool used: one add of that type into that parent, acked, the new node selected, Move again
    const made = async (key, type, parent, use) => {
      const n0 = edits(rec).length;
      await use();
      const op = await added(rec, n0, key);
      assert.equal(op.node.type, type, `${key}: a ${type}`);
      assert.equal(op.node.parent, parent, `${key}: in ${parent}`);
      await madeAndSelected(p, op.node.id, key);
      id[key] = op.node.id;
      return op;
    };
    // fields changed by real input: one edit of one set, acked
    const changed = async (what, steps, want) => {
      const n0 = edits(rec).length;
      for (const [f, v] of steps) await fieldSet(p, f, v);
      const e = await nextEdit(rec, n0);
      assert.deepEqual(e.ops, [want], `${what}: one set`);
      await ackOf(rec, e);
    };
    const dragOut = async (key, x, y, w, h) => { await p.key(key); await drag(p, await at(x, y), w * z, h * z); };
    const clickIn = async (key, x, y) => { await p.key(key); const q = await at(x, y); await p.clickAt(q.x, q.y); };

    // a `none` frame dragged out on the page; the empty-page note goes (C1.1a)
    await made('free', 'frame', 'p1', () => dragOut('F', 20, 60, 560, 560));
    await within(async () => (await shownMsg(p)) === null, 'C1.1a: "This page is empty." no longer shown', async () => shownMsg(p), 5000);
    // inside it, three frames dragged out and set to Row, Column and Grid (its columns typed)
    await made('row', 'frame', id.free, () => dragOut('F', 40, 80, 400, 120));
    await changed('Row', [['layout.mode', 'row']], setOp(id.row, 'layout.mode', 'row'));
    await made('column', 'frame', id.free, () => dragOut('F', 40, 220, 200, 340));
    await changed('Column', [['layout.mode', 'column']], setOp(id.column, 'layout.mode', 'column'));
    await made('grid', 'frame', id.free, () => dragOut('F', 260, 220, 200, 150));
    await changed('Grid', [['layout.mode', 'grid']], setOp(id.grid, 'layout.mode', 'grid'));
    await within(async () => (await count(p, '#props [data-prop="layout.columns"]')) === 1, "the grid's Columns field");
    await changed('Columns', [['layout.columns', '1fr 1fr']], setOp(id.grid, 'layout.columns', ['1fr', '1fr']));
    // a text clicked into the row, its text typed; a rectangle into the row, after it
    await made('text', 'text', id.row, () => clickIn('T', 100, 140));
    await changed('Text', [['text', 'Hello']], setOp(id.text, 'text', 'Hello'));
    const r = await made('rect', 'rect', id.row, () => clickIn('R', 340, 140));
    assert.equal(r.after, id.text, 'the rectangle after the text in the row');
    // an ellipse into the column
    await made('ellipse', 'ellipse', id.column, () => clickIn('O', 140, 270));
    // a vector of three clicks in the `none` frame, ended with Enter
    await made('vector', 'vector', id.free, async () => {
      await p.key('P');
      for (const [x, y] of [[510, 260], [570, 320], [520, 390]]) { const q = await at(x, y); await p.clickAt(q.x, q.y); }
      await enter(p);
    });
    // an image clicked into the column, below the ellipse, and uploaded through the picker: its add is
    // sent (what the server keeps of it is C1.2's)
    {
      const n0 = edits(rec).length;
      const c0 = rec.choosers.length;
      await clickIn('I', 140, 480);
      await within(async () => rec.choosers.length > c0, 'the file chooser opened', async () => JSON.stringify(rec.choosers));
      await rec.send('DOM.setFileInputFiles', { files: [IMG_PATH], backendNodeId: rec.choosers[c0].backendNodeId });
      const e = await nextEdit(rec, n0);
      assert.equal(e.ops.length, 1, 'image: one op');
      assert.deepEqual([e.ops[0].op, e.ops[0].node?.type, e.ops[0].node?.parent, e.ops[0].after], ['add', 'image', id.column, id.ellipse], 'image: an add into the column, after the ellipse');
      id.image = e.ops[0].node.id;
      assert.equal(await pressedTool(p), 'move', 'image: Move again');
    }
    // a frame dragged out on the page with a rectangle drawn in it, made a component
    await made('frameB', 'frame', 'p1', () => dragOut('F', 620, 60, 240, 160));
    await made('inner', 'rect', id.frameB, () => dragOut('R', 640, 80, 80, 60));
    await selectRow(p, id.frameB);
    {
      const n0 = edits(rec).length;
      await p.click('#props [data-action="make-component"]');
      const e = await nextEdit(rec, n0);
      assert.deepEqual([e.ops[0].op, e.ops[0].node?.type, e.ops[0].node?.parent], ['add', 'component', 'p1'], 'Make component: adds a component on the page');
      id.comp = e.ops[0].node.id;
      await ackOf(rec, e);
      await within(async () => JSON.stringify(await selectedIds(p)) === JSON.stringify([id.comp]), 'the component selected', () => selectedIds(p));
    }
    // given a variant dark by Add variant
    {
      const n0 = edits(rec).length;
      assert.equal(await focusField(p, '@new-variant'), true, 'the variant name field');
      await typeKeys(p, 'dark');
      await p.click('#props [data-action="add-variant"]');
      const e = await nextEdit(rec, n0);
      assert.deepEqual(e.ops, [setOp(id.comp, 'variants.dark', {})], 'Add variant: one set of {}');
      await ackOf(rec, e);
      await within(async () => (await variantsListed(p)).includes('dark'), 'dark listed', () => variantsListed(p));
    }
    // with Change in dark on the rectangle, its fill set to hex #222222
    await selectRow(p, id.inner);
    await changed('Change in dark: fill', [['@variant', 'dark'], ['fill', '@hex'], ['fill#hex', '#222222']], setOp(id.comp, `variants.dark.${id.inner}.fill`, '#222222'));
    // Place instance on the page, and the instance's Variant set to dark
    await selectRow(p, id.comp);
    const inst = await made('instance', 'instance', 'p1', async () => {
      await p.click('#props [data-action="place-instance"]');
      const q = await at(620, 300);
      await mouse(p, 'mousePressed', q.x, q.y);
      await mouse(p, 'mouseReleased', q.x, q.y);
    });
    assert.equal(inst.node.component, id.comp, 'an instance of the component');
    await changed('Variant', [['variant', 'dark']], setOp(id.instance, 'variant', 'dark'));
    drawn = true;
  });

  // C1.2: once all is acked and saved, the fake's document holds every type, rightly
  await t.test('C1.2 sent and kept', async () => {
    assert.ok(drawn, 'C1.1 drew everything');
    await waitSaved(p);
    const doc = structuredClone(fake.doc('draw'));
    const N = doc.nodes;
    assert.deepEqual([...new Set(Object.values(N).map((n) => n.type))].sort(), ['component', 'ellipse', 'frame', 'image', 'instance', 'rect', 'text', 'vector'], 'a node of each type');
    assert.deepEqual(Object.values(N).filter((n) => n.type === 'frame').map((n) => n.layout?.mode ?? 'none').sort(), ['column', 'grid', 'none', 'row'], 'frames of each of the four modes');
    const where = [['free', 'frame', 'p1'], ['row', 'frame', id.free], ['column', 'frame', id.free], ['grid', 'frame', id.free], ['text', 'text', id.row], ['rect', 'rect', id.row], ['ellipse', 'ellipse', id.column], ['vector', 'vector', id.free], ['image', 'image', id.column], ['inner', 'rect', id.comp], ['comp', 'component', 'p1'], ['instance', 'instance', 'p1']];
    for (const [key, type, parent] of where) assert.deepEqual([N[id[key]]?.type, N[id[key]]?.parent], [type, parent], `${key}: a ${type} in ${parent}`);
    assert.equal(Object.hasOwn(N, id.frameB), false, 'the frame made a component is gone');
    assert.deepEqual(doc.pages[0].children, [id.free, id.comp, id.instance], "the page's nodes");
    assert.deepEqual(N[id.row].children, [id.text, id.rect], 'the row: the text, then the rectangle');
    assert.deepEqual(N[id.column].children, [id.ellipse, id.image], 'the column: the ellipse, then the image');
    assert.equal(N[id.text].text, 'Hello', 'the text typed');
    assert.deepEqual(N[id.grid].layout.columns, ['1fr', '1fr'], "the grid's columns");
    assert.match(N[id.vector].path, /^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/, "the vector's path of three points");
    assert.equal(N[id.image].src, `images/${IMG_FILE}`, "the image's src");
    assert.deepEqual(N[id.comp].variants, { dark: { [id.inner]: { fill: '#222222' } } }, "the component's variant dark: the rectangle's fill");
    assert.deepEqual([N[id.instance].component, N[id.instance].variant], [id.comp, 'dark'], 'the instance: of the component, variant dark');
    assert.deepEqual(docErrors(doc, folder), [], "docErrors finds nothing, with the folder's images");
    assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
    kept = doc;
  });

  // C1.3: the fake restarted (back to its last saved document, the socket closed 1012) loses nothing
  await t.test('C1.3 saved, not just held', async () => {
    assert.ok(kept, 'C1.2 read the document');
    // what the page draws now, with nothing selected, for C1.4
    await p.key('Escape');
    await within(async () => (await selectedIds(p)).length === 0, 'nothing selected', () => selectedIds(p));
    await imagesLoaded(p);
    before = await snapshot(p);
    fake.restart('draw');
    assert.deepEqual(fake.doc('draw'), kept, 'the restarted document is the one read in C1.2');
  });

  // C1.4: the page reloaded draws the same thing
  await t.test('C1.4 reloaded unchanged', async () => {
    assert.ok(before, 'C1.3 took the drawing before the restart');
    const keys = before.drawn.map((d) => d.key);
    for (const key of ['free', 'row', 'column', 'grid', 'text', 'rect', 'ellipse', 'vector', 'image', 'comp', 'inner', 'instance']) assert.ok(keys.includes(id[key]), `${key} drawn before the reload`);
    assert.ok(keys.includes(`${id.instance}/${id.inner}`), "the instance's rectangle drawn before the reload");
    const n0 = edits(rec).length;
    await load('/view/canvas/draw');
    await live(p);
    await imagesLoaded(p);
    sameDrawing(before, await snapshot(p));
    assert.equal(edits(rec).length, n0, 'the reload sent no edit');
    assert.deepEqual(fake.doc('draw'), kept, 'the document is still the one saved');
    assert.deepEqual(docErrors(fake.doc('draw'), folder), [], 'docErrors finds nothing after the reload');
  });

  // C1.5: the hostile fixture loaded in the editor loads nothing from elsewhere and opens no dialog
  await t.test('C1.5 the hostile fixture loads nothing from elsewhere', async () => {
    await load('/view/canvas/hostile');
    await live(p);
    await imagesLoaded(p);
    await sleep(500);
    const urls = [...rec.urls];
    assert.deepEqual(urls.filter((u) => u !== origin && !u.startsWith(`${origin}/`)), [], `no URL off the fake's origin (saw ${urls.join(' ')})`);
    assert.deepEqual(urls.filter((u) => u.includes('evil.example')), [], 'no evil.example');
    assert.ok(rec.urls.has(`${origin}/api/canvas/doc?slug=hostile`), 'the hostile document loaded');
    assert.deepEqual(rec.dialogs, [], 'no dialog opened');
    assert.equal(await body(p, 'live'), 'on', 'the socket open');
  });
  noExceptions(rec);
});
