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
// server's, parsed), with the time each was seen here (`sentAt`, `gotAt`, Date.now()). `answer` may
// return { fail: true } to fail the request; a test may set `rec.hold` to a URL test, and the requests
// it matches wait in `rec.held` (their URLs in `rec.heldUrl`) until `rec.release()`.
async function recorder(ws, origin, answer) {
  let seq = 0;
  const waiting = new Map();
  const rec = {
    urls: new Set(), requests: [], dialogs: [], exceptions: [], sent: [], sentAt: [], got: [], gotAt: [],
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
// Focus out of the Properties panel: a click on its title (not focusable), so a deferred rebuild runs.
const leavePanel = (p) => p.click('.panel.right .ptitle');
// Change a field by real input, then leave the panel: an input has its text selected, typed over and
// Enter pressed; the `text` textarea is typed and Tabbed out of (Enter there is a new line); a select is
// set by value with a `change` event (headless Chrome opens no popup); a button group is clicked.
async function fieldSet(p, prop, value) {
  const kind = await p.ev(`(() => { const e = document.querySelector('#props [data-prop="${prop}"]'); return e ? e.localName : null; })()`);
  assert.ok(kind, `a #props [data-prop="${prop}"] control`);
  if (kind === 'input' || kind === 'textarea') {
    assert.equal(await focusField(p, prop), true, `${prop} focused`);
    await p.type(String(value));
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
  // (Task 3 adds the tools bar here: at least one #tools button[data-tool], and each disabled.)
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
