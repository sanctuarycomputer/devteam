// The canvas editor page (kit-661, docs/devteam/dashboard/canvas.html): a canvas drawn from
// GET /api/canvas/doc, in headless Chrome. The kit-651 fake (test/lib/canvas-fake.mjs) serves the
// document, its images and, through its `serve` option, the page itself at /view/canvas/<slug>.
// Every test watches the page's requests on a second DevTools connection of its own (the recorder):
// a same-origin request goes on, any other is failed, and a test may answer one itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { resolve, startCanvasFake } from './lib/canvas-fake.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { until } from './lib/kit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE_FILE = path.join(here, '..', 'docs', 'devteam', 'dashboard', 'canvas.html');
const FIX = path.join(here, 'fixtures', 'canvas');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
const IMG_FILE = '429be16d0a91e377.png';
const IMG = fs.readFileSync(path.join(FIX, 'images', IMG_FILE));
const EVERY = fixture('doc-every-type.json');
const MINIMAL = fixture('doc-minimal.json');

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

// The request recorder: a second DevTools connection to the page's target (the helper's own drops
// events). Fetch for every URL: recorded, then answered by `answer`, continued when same-origin, failed
// otherwise; dialogs recorded and dismissed; exceptions recorded. `answer` may return { fail: true }
// to fail the request (a network error); a test may set `rec.hold` to a URL test, and the requests it
// matches wait in `rec.held` (their URLs in `rec.heldUrl`) until `rec.release()`.
async function recorder(ws, origin, answer) {
  let seq = 0;
  const waiting = new Map();
  const rec = { urls: new Set(), dialogs: [], exceptions: [], send: null, hold: null, held: [], heldUrl: new Map(), release: null };
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
    } else if (o.method === 'Page.javascriptDialogOpening') {
      rec.dialogs.push(o.params);
      quiet('Page.handleJavaScriptDialog', { accept: false });
    } else if (o.method === 'Runtime.exceptionThrown') {
      rec.exceptions.push(o.params.exceptionDetails);
    }
  };
  ws.onclose = () => { for (const [id, w] of waiting) { waiting.delete(id); w.reject(new Error(`recorder ${w.method}: connection closed`)); } };
  await raw('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
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
  return { p, fake, origin, rec, load, size: resize };
}

const text = (p, sel) => p.ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
const shown = (p, sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })()`);
const state = (p) => p.ev('document.body.dataset.state');
// `until` with a shorter bound, and what was last seen (`why()`) in its failure.
async function within(f, what, why = async () => '', ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await f()) return;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what} (${await why()})`);
    await sleep(100);
  }
}
// Two animation frames: what the page does on an event (a refit, a load handler) has run.
const frames = (p) => p.ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
// Nothing the page ran threw (Runtime.exceptionThrown on the recorder's connection): every test ends on it.
const noExceptions = (rec, what = 'the page') => assert.deepEqual(rec.exceptions.map((e) => e.exception?.description ?? e.text), [], `${what}: no exception`);

test('loads the document and lists the pages', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  const { p, origin, rec } = await open(t, { canvases: { every: EVERY }, images: { every: { [IMG_FILE]: IMG } } });
  assert.equal(await state(p), 'ready');
  assert.ok(rec.urls.has(`${origin}/api/canvas/doc?slug=every`), `the doc request, among ${[...rec.urls].join(' ')}`);
  assert.deepEqual(await p.ev("[...document.querySelectorAll('#pages a[data-page]')].map((a) => a.textContent)"), ['Checkout', 'Parts']);
  assert.deepEqual(await p.ev("[...document.querySelectorAll('#pages a[data-page]')].map((a) => a.dataset.page)"), EVERY.pages.map((x) => x.id));
  assert.equal(await p.ev("document.querySelector('#pages a[aria-current=\"page\"]')?.textContent"), 'Checkout');
  assert.equal(await text(p, '#title'), 'every');
  assert.equal(await shown(p, '#msg'), false, 'no stage message on a page with nodes');
  noExceptions(rec);
});

test('the repo chip, four ways', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  const cases = [
    ['C3.1 public', { name: 'acme/site', public: true }, 'Saved to acme/site · public', true],
    ['C3.2 private', { name: 'acme/site', public: false }, 'Saved to acme/site · private', false],
    ['C3.3 not known', { name: 'acme/site', public: null }, 'Saved to acme/site · may be public', true],
    ['C3.4 no name', { name: null, public: null }, "Saved to this project's repo · may be public", true],
  ];
  for (const [name, repo, chip, amber] of cases) {
    await t.test(name, async (st) => {
      const { p, rec } = await open(st, { canvases: { minimal: MINIMAL }, repo });
      assert.equal(await state(p), 'ready');
      assert.equal(await text(p, '#repoChip'), chip);
      assert.equal(await p.ev("document.getElementById('repoChip').classList.contains('public')"), amber);
      assert.equal(await shown(p, '#repoChip'), true);
      assert.equal(await p.ev("document.getElementById('repoChip').title"), `Every edit is committed and pushed to ${repo.name ?? "this project's repo"}.`);
      noExceptions(rec);
    });
  }
});

test('loading states', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  const isDoc = (u) => u.includes('/api/canvas/doc');
  const msg = (p) => p.ev("(() => { const m = document.getElementById('msg'); return m && !m.hidden && getComputedStyle(m).display !== 'none' ? m.textContent : null; })()");
  await t.test('C1.11 a path that is not a canvas address fetches nothing', async (st) => {
    const { p, rec } = await open(st, { canvases: { every: EVERY }, images: { every: { [IMG_FILE]: IMG } }, path: '/view/canvas/Bad_Slug' });
    assert.equal(await state(p), 'error');
    assert.equal(await msg(p), "This isn't a canvas address.");
    assert.deepEqual([...rec.urls].filter(isDoc), []);
    noExceptions(rec);
  });
  await t.test('C1.11 a slug the server does not have', async (st) => {
    const { p, origin, rec } = await open(st, { canvases: { every: EVERY }, images: { every: { [IMG_FILE]: IMG } }, path: '/view/canvas/nope' });
    assert.equal(await state(p), 'error');
    assert.equal(await msg(p), "This canvas isn't open for editing.");
    assert.ok(rec.urls.has(`${origin}/api/canvas/doc?slug=nope`));
    noExceptions(rec);
  });
  await t.test('C1.11 a 500', async (st) => {
    const { p, rec } = await open(st, { canvases: { every: EVERY }, images: { every: { [IMG_FILE]: IMG } }, answer: (u) => (isDoc(u) ? { status: 500, body: '{"why":"boom"}' } : null) });
    assert.equal(await state(p), 'error');
    assert.equal(await msg(p), "This canvas couldn't be loaded. (500)");
    noExceptions(rec);
  });
  await t.test('C1.11 a 200 that is not a doc-response', async (st) => {
    const { p, rec } = await open(st, { canvases: { every: EVERY }, images: { every: { [IMG_FILE]: IMG } }, answer: (u) => (isDoc(u) ? { status: 200, body: {} } : null) });
    assert.equal(await state(p), 'error');
    assert.equal(await msg(p), "This canvas couldn't be loaded. (200)");
    assert.deepEqual(await p.ev("[...document.querySelectorAll('#pages a')].length"), 0);
    noExceptions(rec);
  });
  await t.test('a doc request that fails on the network: no status', async (st) => {
    const { p, origin, rec } = await open(st, { canvases: { every: EVERY }, images: { every: { [IMG_FILE]: IMG } }, answer: (u) => (isDoc(u) ? { fail: true } : null) });
    assert.ok(rec.urls.has(`${origin}/api/canvas/doc?slug=every`));
    assert.equal(await state(p), 'error');
    assert.equal(await msg(p), "This canvas couldn't be loaded.");
    noExceptions(rec);
  });
  await t.test('C1.11 an empty page', async (st) => {
    const { p, rec } = await open(st, { canvases: { minimal: MINIMAL } });
    assert.equal(await state(p), 'ready');
    assert.equal(await msg(p), 'This page is empty.');
    assert.equal(await p.ev("!!document.getElementById('surface')"), true);
    assert.deepEqual(await p.ev("[...document.querySelectorAll('#pages a[data-page]')].map((a) => a.textContent)"), ['Page 1']);
    noExceptions(rec);
  });
});


// ---- drawing (C1.2 to C1.7, C1.12, and the review focus's odd trees and missing $ref) ----

const EVERY_IMAGES = (slug) => ({ [slug]: { [IMG_FILE]: IMG } });
const isDocUrl = (u) => u.includes('/api/canvas/doc');
const docAnswer = (doc) => (u) => (isDocUrl(u) ? { status: 200, body: { session: null, rev: doc.rev, doc, repo: { name: null, public: null } } } : null);
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const css = (p, sel, prop) => p.ev(`(() => { const e = ${q(sel)}; return e ? getComputedStyle(e).getPropertyValue(${JSON.stringify(prop)}) : null; })()`);
const count = (p, sel) => p.ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
// A drawn element's box in the page's own (unscaled) px, from the page surface's top-left corner: the
// on-screen rectangle divided by the scale of #surface's transform.
const RECT = `(sel) => {
  const s = document.getElementById('surface');
  const tr = getComputedStyle(s).transform;
  const z = tr === 'none' ? 1 : new DOMMatrixReadOnly(tr).a;
  const o = s.getBoundingClientRect();
  const e = document.querySelector(sel);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { l: (r.left - o.left) / z, t: (r.top - o.top) / z, r: (r.right - o.left) / z, b: (r.bottom - o.top) / z, w: r.width / z, h: r.height / z };
}`;
const rect = (p, sel) => p.ev(`(${RECT})(${JSON.stringify(sel)})`);
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`);
const CHECKOUT_IDS = ['card', 'title', 'rule', 'dot', 'icon', 'photo', 'actions', 'buy', 'loose', 'badge', 'tiles'];

// A fixture colour (a hex or a colour token's $ref) as getComputedStyle gives it: rgb(r, g, b).
function rgbOf(doc, v) {
  let hex = v;
  if (v && typeof v === 'object' && typeof v.$ref === 'string') hex = v.$ref.split('.').reduce((o, k) => o?.[k], doc.tokens)?.$value?.hex;
  assert.match(String(hex), /^#([0-9a-f]{3}|[0-9a-f]{6})$/i, `a colour in the fixture: ${JSON.stringify(v)}`);
  const h = hex.length === 4 ? hex.slice(1).split('').map((c) => c + c).join('') : hex.slice(1);
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
}
// An instance of `button` drawn as the fake's resolve(doc, instanceId) has it, every level the
// resolution order sets: button-bg's shown or not, fill and width rule (fill: it grows in the row);
// button-label's text and colour.
async function drawnAsResolved(p, doc, instanceId) {
  const r = resolve(doc, instanceId);
  const bg = `[data-of="${instanceId}"][data-src="button-bg"]`;
  const label = `[data-of="${instanceId}"][data-src="button-label"]`;
  assert.equal(await count(p, bg), 1, `${instanceId}: one button-bg`);
  assert.equal(await count(p, label), 1, `${instanceId}: one button-label`);
  assert.equal((await css(p, bg, 'display')) !== 'none', r['button-bg'].visible !== false, `${instanceId}: button-bg shown as resolved`);
  assert.equal(await css(p, bg, 'background-color'), rgbOf(doc, r['button-bg'].fill), `${instanceId}: button-bg's fill as resolved`);
  assert.equal(await css(p, bg, 'flex-grow'), r['button-bg']['size.w'] === 'fill' ? '1' : '0', `${instanceId}: button-bg's width rule as resolved (${r['button-bg']['size.w']})`);
  assert.equal(await text(p, label), r['button-label'].text, `${instanceId}: button-label's text as resolved`);
  assert.equal(await css(p, label, 'color'), rgbOf(doc, r['button-label'].color), `${instanceId}: button-label's colour as resolved`);
  return r;
}

test('every node type', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  const { p, origin, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  assert.equal(await state(p), 'ready');
  for (const id of CHECKOUT_IDS) assert.equal(await count(p, `#surface [data-id="${id}"]`), 1, `${id} drawn once`);
  assert.equal(await count(p, '[data-id]'), CHECKOUT_IDS.length, 'only drawn nodes carry data-id');

  // C1.2 frames, real layout
  assert.equal(await css(p, '[data-id="card"]', 'display'), 'flex');
  assert.equal(await css(p, '[data-id="card"]', 'flex-direction'), 'column');
  assert.equal(await css(p, '[data-id="card"]', 'row-gap'), '16px');
  for (const side of ['top', 'right', 'bottom', 'left']) assert.equal(await css(p, '[data-id="card"]', `padding-${side}`), '16px', `card padding-${side}`);
  assert.equal(await css(p, '[data-id="card"]', 'justify-content'), 'space-between');
  assert.equal(await css(p, '[data-id="card"]', 'align-items'), 'stretch');
  const title = await rect(p, '[data-id="title"]');
  const rule = await rect(p, '[data-id="rule"]');
  near(rule.t, title.b + 16, 0.5, "rule's top is title's bottom + 16");
  assert.equal(await css(p, '[data-id="actions"]', 'display'), 'flex');
  assert.equal(await css(p, '[data-id="tiles"]', 'display'), 'grid');
  const cols = (await css(p, '[data-id="tiles"]', 'grid-template-columns')).split(' ');
  assert.equal(cols.length, 2, `two column tracks: ${cols.join(' ')}`);
  assert.equal(cols[0], cols[1], 'equal column tracks');
  assert.ok((await css(p, '[data-id="tiles"]', 'grid-template-rows')).startsWith('80px'), 'rows start 80px');
  assert.ok(!['flex', 'grid'].includes(await css(p, '[data-id="loose"]', 'display')), 'loose is neither flex nor grid');
  assert.equal(await css(p, '[data-id="badge"]', 'position'), 'absolute');
  assert.equal(await css(p, '[data-id="badge"]', 'left'), '12px');
  assert.equal(await css(p, '[data-id="badge"]', 'top'), '-8px');
  const loose = await rect(p, '[data-id="loose"]');
  const badge = await rect(p, '[data-id="badge"]');
  near(badge.l - loose.l, 12, 0.5, 'badge left within loose');
  near(badge.t - loose.t, -8, 0.5, 'badge top within loose');
  near(loose.l, 400, 0.5, 'loose at x 400 on the page');

  // C1.3 text
  assert.equal(await text(p, '[data-id="title"]'), 'Order summary');
  assert.equal(await css(p, '[data-id="title"]', 'font-size'), '16px');
  assert.equal(await css(p, '[data-id="title"]', 'color'), 'rgb(17, 17, 17)');

  // C1.4 rect and ellipse
  assert.equal(await css(p, '[data-id="rule"]', 'background-color'), 'rgb(229, 231, 235)');
  near(rule.h, 1, 0.01, 'rule height');
  assert.equal(await css(p, '[data-id="dot"]', 'border-radius'), '50%');
  const dot = await rect(p, '[data-id="dot"]');
  near(dot.w, 8, 0.01, 'dot width');
  near(dot.h, 8, 0.01, 'dot height');

  // C1.5 vector
  assert.equal(await p.ev(`${q('[data-id="icon"]')}.localName`), 'svg');
  assert.equal(await count(p, '[data-id="icon"] path'), 1);
  assert.equal(await p.ev(`${q('[data-id="icon"] path')}.getAttribute('d')`), 'M2 8 L6 12 L14 4');
  assert.equal(await css(p, '[data-id="icon"] path', 'fill'), 'none');
  assert.equal(await css(p, '[data-id="icon"] path', 'stroke-width'), '2px');

  // C1.6 image
  assert.equal(await p.ev(`${q('[data-id="photo"]')}.localName`), 'img');
  assert.equal(await p.ev(`${q('[data-id="photo"]')}.src`), `${origin}/api/canvas/image/every/${IMG_FILE}`);
  assert.equal(await p.ev(`(() => { const i = ${q('[data-id="photo"]')}; return i.complete && i.naturalWidth > 0; })()`), true, 'the image loaded');
  assert.equal(await css(p, '[data-id="photo"]', 'object-fit'), 'cover');
  near((await rect(p, '[data-id="photo"]')).h, 120, 0.01, 'photo height');
  assert.equal(await p.ev(`${q('[data-id="photo"]')}.alt`), 'Photo');

  // C1.7 instance: the five-level conflict, as the fake resolves it
  const label = '[data-of="buy"][data-src="button-label"]';
  assert.equal(await count(p, label), 1);
  assert.equal(await text(p, label), resolve(EVERY, 'buy')['button-label'].text);
  assert.notEqual(await css(p, '[data-of="buy"][data-src="button-bg"]', 'display'), 'none', "buy's background is displayed");
  assert.equal(await count(p, '#surface [data-id="button-label"], #surface [data-id="button-bg"]'), 0, "an instance's inner nodes carry no data-id");
  assert.equal(await count(p, '.clabel'), 0, 'no component on Checkout');
  // below the prop level: buy's override sets button-bg's fill (color.brand) and width (fill) over the
  // variant, and the variant sets button-label's colour over the base
  const buy = await drawnAsResolved(p, EVERY, 'buy');
  assert.deepEqual(buy['button-bg'].fill, { $ref: 'color.brand' }, "buy's fill is its override's");
  assert.equal(await css(p, '[data-of="buy"][data-src="button-bg"]', 'background-color'), 'rgb(59, 91, 219)', "buy's background: color.brand");
  assert.equal(await css(p, '[data-of="buy"][data-src="button-bg"]', 'flex-grow'), '1', "buy's background fills its row (override size.w)");
  assert.equal(await css(p, '[data-of="buy"][data-src="button-label"]', 'color'), 'rgb(255, 255, 255)', "buy's label: white, not the base #111");

  // C1.7 component, on Parts (clicked in the Pages list)
  await p.click('#pages a[data-page="p-parts"]');
  await until(() => p.ev(`document.body.dataset.state === 'ready' && !!${q('#surface [data-id="button"]')}`), 'Parts drawn');
  assert.equal(await p.ev('location.hash'), '#page=p-parts');
  assert.equal(await css(p, '[data-id="button"]', 'display'), 'flex');
  assert.equal(await css(p, '[data-id="button"]', 'flex-direction'), 'row');
  assert.equal(await text(p, '[data-id="button-label"]'), 'Base label');
  const bg = await rect(p, '[data-id="button-bg"]');
  const lab = await rect(p, '[data-id="button-label"]');
  near(lab.l, bg.r + 16, 0.5, "button-label's left is button-bg's right + 16");
  near(lab.t, bg.t, 0.5, 'button-bg and button-label share a top');
  assert.equal(await count(p, '#surface .clabel'), 1, "the component's label");
  const btn = await rect(p, '[data-id="button"]');
  const clabel = await rect(p, '#surface .clabel');
  assert.ok(clabel.b <= btn.t + 0.5, `the label sits above the component: ${clabel.b} vs ${btn.t}`);
  near(clabel.l, btn.l, 0.5, "the label starts at the component's left");
  assert.equal(await count(p, '[data-id="card"]'), 0, 'Checkout is gone');
  noExceptions(rec);

  await t.test('C1.7 a bool prop beats every earlier level', async (st) => {
    const off = structuredClone(EVERY);
    off.nodes.buy.props.enabled = false;
    const o = await open(st, { canvases: { 'every-off': off }, images: EVERY_IMAGES('every-off') });
    assert.equal(await state(o.p), 'ready');
    assert.equal(await css(o.p, '[data-of="buy"][data-src="button-bg"]', 'display'), 'none');
    assert.notEqual(await css(o.p, '[data-of="buy"][data-src="button-label"]', 'display'), 'none');
    noExceptions(o.rec);
  });

  // Three more instances of button beside buy, each stopping at one level: `plain` has no variant,
  // override or prop (the prop default shows), `varied` only the variant (it beats the default), `over`
  // the variant and an override whose fill and label differ from the variant's (the override beats it).
  await t.test("C1.7 each level of an instance's resolution shows where it is the last present", async (st) => {
    const doc = structuredClone(EVERY);
    const like = (id, extra) => {
      const n = structuredClone(EVERY.nodes.buy);
      delete n.variant; delete n.props; delete n.overrides;
      doc.nodes[id] = { ...n, name: id, ...extra };
      doc.nodes.actions.children.push(id);
    };
    like('plain', {});
    like('varied', { variant: 'primary' });
    like('over', { variant: 'primary', overrides: { 'button-bg': { fill: '#12b886' }, 'button-label': { text: 'Over label', color: '#e03131' } } });
    const o = await open(st, { canvases: { 'every-levels': doc }, images: EVERY_IMAGES('every-levels') });
    assert.equal(await state(o.p), 'ready');
    for (const id of ['buy', 'plain', 'varied', 'over']) await drawnAsResolved(o.p, doc, id);
    const bg = (id) => `[data-of="${id}"][data-src="button-bg"]`;
    const label = (id) => `[data-of="${id}"][data-src="button-label"]`;
    assert.equal(await text(o.p, label('plain')), 'Default label', 'no props: the prop default, not the base');
    assert.equal(await css(o.p, bg('plain'), 'background-color'), 'rgb(229, 231, 235)', 'no variant: the base fill');
    assert.equal(await css(o.p, bg('plain'), 'flex-grow'), '0', 'no override: no fill width');
    assert.equal(await text(o.p, label('varied')), 'Variant label', 'no override: the variant beats the prop default');
    assert.equal(await css(o.p, bg('varied'), 'background-color'), 'rgb(59, 91, 219)', "no override: the variant's #3b5bdb");
    assert.equal(await css(o.p, label('varied'), 'color'), 'rgb(255, 255, 255)', "the variant's label colour");
    assert.equal(await text(o.p, label('over')), 'Over label', 'the override beats the variant');
    assert.equal(await css(o.p, bg('over'), 'background-color'), 'rgb(18, 184, 134)', 'the override fill beats the variant fill');
    assert.equal(await css(o.p, label('over'), 'color'), 'rgb(224, 49, 49)', 'the override colour beats the variant colour');
    noExceptions(o.rec);
  });
});

// 22 components, each holding an instance of the next, and an instance of the first on the page.
function chainDoc() {
  const nodes = {};
  const comps = [];
  for (let k = 0; k < 22; k++) {
    comps.push(`c${k}`);
    nodes[`c${k}`] = { type: 'component', parent: 'p-comps', name: `C${k}`, x: 0, y: k * 100, layout: { mode: 'row', padding: [2, 2, 2, 2] }, children: [k < 21 ? `i${k + 1}` : 'leaf'] };
    if (k < 21) nodes[`i${k + 1}`] = { type: 'instance', parent: `c${k}`, name: `I${k + 1}`, component: `c${k + 1}` };
  }
  nodes.leaf = { type: 'rect', parent: 'c21', name: 'Leaf', size: { w: 4, h: 4 }, fill: '#ff0000' };
  nodes.i0 = { type: 'instance', parent: 'p-main', name: 'I0', component: 'c0' };
  return { canvas: 1, rev: 0, tokens: {}, pages: [{ id: 'p-main', name: 'Main', children: ['i0'] }, { id: 'p-comps', name: 'Components', children: comps }], nodes };
}

test('nested instances', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { chain: chainDoc() } });
  assert.equal(await state(p), 'ready');
  assert.equal(await count(p, '#surface [data-id="i0"]'), 1, 'the page instance, level 1');
  assert.equal(await count(p, '#surface [data-id="i0"].placeholder'), 0);
  let parent = '[data-id="i0"]';
  for (let k = 1; k <= 19; k++) {
    const sel = `${parent} [data-src="i${k}"]`;
    assert.equal(await count(p, sel), 1, `level ${k + 1} drawn inside level ${k}`);
    assert.equal(await count(p, `[data-src="i${k}"].placeholder`), 0, `level ${k + 1} is no placeholder`);
    parent = `[data-src="i${k}"]`;
  }
  assert.equal(await count(p, `${parent} [data-src="i20"].placeholder`), 1, 'level 21 is a placeholder');
  assert.equal(await text(p, '[data-src="i20"]'), 'I20', "the placeholder shows the instance's name");
  assert.equal(await count(p, '[data-src="i20"] [data-src]'), 0, 'nothing drawn inside the placeholder');
  assert.equal(await count(p, '[data-src="i21"], [data-src="leaf"]'), 0);
  assert.equal(await count(p, '.placeholder'), 1);
  noExceptions(rec);
});

test('odd trees', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  // invalid, so the recorder serves it; the fake holds the valid document (and its image) under the slug
  const odd = structuredClone(EVERY);
  odd.pages[0].children = ['card', 'loose', 'card', 'nope', 'tiles', 'loose'];
  odd.nodes.card.children = ['title', 'title', 'nope', 'rule', 'dot', 'icon', 'photo', 'actions'];
  odd.nodes.actions.children = ['buy', 'card', 'buy'];
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every'), answer: docAnswer(odd) });
  assert.equal(await state(p), 'ready');
  for (const id of CHECKOUT_IDS) assert.equal(await count(p, `[data-id="${id}"]`), 1, `${id} drawn once`);
  assert.equal(await count(p, '[data-id="nope"]'), 0);
  assert.equal(await count(p, '.placeholder'), 0);
  const title = await rect(p, '[data-id="title"]');
  const rule = await rect(p, '[data-id="rule"]');
  near(rule.t, title.b + 16, 0.5, 'the repeat and the missing child take no room');
  noExceptions(rec);
});

test('a $ref to a missing token', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  const odd = structuredClone(EVERY);
  odd.nodes.card.fill = { $ref: 'color.nope' };
  odd.nodes.card.layout.gap = { $ref: 'space' };
  odd.nodes.title.color = { $ref: 'nope.ink' };
  odd.nodes.rule.fill = { $ref: 'space.m' };
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every'), answer: docAnswer(odd) });
  assert.equal(await state(p), 'ready');
  assert.equal(await css(p, '[data-id="card"]', 'background-color'), 'rgba(0, 0, 0, 0)', 'fill: its default, none');
  assert.ok(['normal', '0px'].includes(await css(p, '[data-id="card"]', 'row-gap')), 'gap: its default, 0');
  assert.equal(await css(p, '[data-id="title"]', 'color'), 'rgb(0, 0, 0)', 'colour: its default');
  assert.equal(await css(p, '[data-id="rule"]', 'background-color'), 'rgba(0, 0, 0, 0)', 'a ref to a token of another type');
  assert.equal(await css(p, '[data-id="card"]', 'display'), 'flex', 'the rest of the node drawn');
  noExceptions(rec);
});

test('C1.13 an instance takes its own position, opacity and visibility', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  // button placed and faded on its own page; bare stores no x, y, opacity or size (its label prop gives
  // it button's own base text, so the two are drawn the same size)
  const doc = structuredClone(EVERY);
  Object.assign(doc.nodes.button, { x: 300, y: 200, opacity: 0.5 });
  doc.nodes.bare = { type: 'instance', parent: 'p-main', name: 'Bare', component: 'button', props: { label: 'Base label' } };
  doc.pages[0].children.unshift('bare');
  const { p, rec } = await open(t, { canvases: { own: doc }, images: EVERY_IMAGES('own') });
  assert.equal(await state(p), 'ready');
  const bare = await rect(p, '#surface [data-id="bare"]');
  near(bare.l, 0, 0.5, "bare's left: the default x, not the component's");
  near(bare.t, 0, 0.5, "bare's top: the default y, not the component's");
  assert.equal(await css(p, '[data-id="bare"]', 'opacity'), '1', "bare's opacity: the default, not the component's");
  assert.notEqual(await css(p, '[data-id="bare"]', 'display'), 'none');
  assert.equal(await text(p, '[data-of="bare"][data-src="button-label"]'), 'Base label');
  await p.click('#pages a[data-page="p-parts"]');
  await until(() => p.ev(`document.body.dataset.state === 'ready' && !!${q('#surface [data-id="button"]')}`), 'Parts drawn');
  const button = await rect(p, '#surface [data-id="button"]');
  near(bare.w, button.w, 0.5, 'bare is as wide as button is drawn');
  near(bare.h, button.h, 0.5, 'bare is as tall as button is drawn');
  near(button.l, 300, 0.5, 'button itself at its own x');
  assert.equal(await css(p, '[data-id="button"]', 'opacity'), '0.5', 'button itself at its own opacity');
  noExceptions(rec);

  await t.test("C1.13 an instance's size is its own when stored, else the component's; visible its own", async (st) => {
    // button stores a fixed width and visible: false; bare stores neither, narrow stores its own width
    const doc2 = structuredClone(EVERY);
    Object.assign(doc2.nodes.button, { size: { w: 240, h: 'hug' }, visible: false });
    doc2.nodes.bare = { type: 'instance', parent: 'p-main', name: 'Bare', component: 'button' };
    doc2.nodes.narrow = { type: 'instance', parent: 'p-main', name: 'Narrow', component: 'button', x: 0, y: 700, size: { w: 100, h: 'hug' } };
    doc2.pages[0].children.unshift('bare', 'narrow');
    const o = await open(st, { canvases: { sized: doc2 }, images: EVERY_IMAGES('sized') });
    assert.equal(await state(o.p), 'ready');
    assert.notEqual(await css(o.p, '#surface [data-id="bare"]', 'display'), 'none', 'bare shown: its own visible (the default), not the component\'s false');
    assert.notEqual(await css(o.p, '#surface [data-id="narrow"]', 'display'), 'none', 'narrow shown');
    near((await rect(o.p, '#surface [data-id="bare"]')).w, 240, 0.5, "bare, storing no size, is the component's 240 wide");
    near((await rect(o.p, '#surface [data-id="narrow"]')).w, 100, 0.5, 'narrow, storing size.w 100, is 100 wide');
    noExceptions(o.rec);
  });
});

// 20 components, each holding 3 instances of the next (the last a rect), and one instance of the
// first on the page: 3^19 elements if nothing stopped it.
function fanDoc() {
  const nodes = {};
  const comps = [];
  for (let k = 0; k < 20; k++) {
    comps.push(`c${k}`);
    const kids = k < 19 ? [0, 1, 2].map((j) => `i${k + 1}-${j}`) : ['leaf'];
    nodes[`c${k}`] = { type: 'component', parent: 'p-comps', name: `C${k}`, x: 0, y: k * 100, layout: { mode: 'row', gap: 1 }, children: kids };
    if (k < 19) for (const id of kids) nodes[id] = { type: 'instance', parent: `c${k}`, name: `I${k + 1}`, component: `c${k + 1}` };
  }
  nodes.leaf = { type: 'rect', parent: 'c19', name: 'Leaf', size: { w: 1, h: 1 }, fill: '#ff0000' };
  nodes.i0 = { type: 'instance', parent: 'p-main', name: 'I0', component: 'c0' };
  return { canvas: 1, rev: 0, tokens: {}, pages: [{ id: 'p-main', name: 'Main', children: ['i0'] }, { id: 'p-comps', name: 'Components', children: comps }], nodes };
}
const CAP_NOTE = "Some components weren't drawn: this page holds too many.";
const capNote = (p) => p.ev(`(() => { const e = [...document.querySelectorAll('#stage *')].find((x) => !x.closest('#surface') && x.textContent === ${JSON.stringify(CAP_NOTE)}); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { shown: r.width > 0 && r.height > 0 && cs.visibility === 'visible', maxWidth: cs.maxWidth, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width }; })()`);

// The plan's 120000 ms: the cap bounds the draw at about 50000 elements, and the whole test (the
// 390 px resize and the subtest included) took about 3 s on the box (kit-661 Task 6 run). A page
// without the cap never reaches ready and fails on that timeout.
test('C1.14 a page draws at most 50000 elements and says so', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  const { p, rec, size } = await open(t, { canvases: { fan: fanDoc() } });
  assert.equal(await state(p), 'ready');
  const n = await count(p, '#surface *');
  assert.ok(n <= 50000, `at most 50000 elements drawn: ${n}`);
  assert.ok(n > 1000, `the page draws up to the cap: ${n}`);
  assert.ok(await count(p, '#surface .placeholder') >= 1, 'at least one placeholder');
  assert.equal(await count(p, '#surface [data-id="i0"]'), 1);
  const check = async (what) => {
    const note = await capNote(p);
    assert.ok(note && note.shown, `${what}: the note shown`);
    assert.ok(/^(min\()?560px\b/.test(note.maxWidth), `${what}: the note capped at the measure (${note.maxWidth})`);
    const stage = await screenRect(p, '#stage');
    assert.ok(note.l >= stage.l && note.r <= stage.r && note.t >= stage.t && note.b <= stage.b, `${what}: the note ${JSON.stringify(note)} on the stage ${JSON.stringify(stage)}`);
    for (const sel of ['.zoom', '#pageSel', '#narrowNote']) {
      if (!(await shown(p, sel))) continue;
      assert.ok(!overlap(note, await screenRect(p, sel)), `${what}: the note clear of ${sel}`);
    }
  };
  await check('at 1440');
  await size(390, 844);
  await until(() => p.ev('innerWidth === 390'), 'the window at 390');
  assert.equal(await shown(p, '#narrowNote'), true);
  await check('at 390');
  noExceptions(rec);

  await t.test('no note on a page under the cap', async (st) => {
    const o = await open(st, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
    assert.equal(await state(o.p), 'ready');
    const note = await capNote(o.p);
    assert.ok(note === null || !note.shown, 'the note is not shown on doc-every-type.json');
    assert.equal(await count(o.p, '#surface .placeholder'), 0);
    noExceptions(o.rec);
  });
});

test('font numbers out of range clamp to their range', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  // out of class, so the recorder serves it: numbers clamp as lengths do, a non-number takes its default
  const odd = structuredClone(EVERY);
  const add = (id, x, f) => {
    odd.nodes[id] = { type: 'text', parent: 'p-main', name: id, x, y: 600, text: 'Aa', font: { family: 'sans', weight: 400, ...f } };
    odd.pages[0].children.push(id);
  };
  add('big', 0, { size: 2000, lineHeight: 20 });
  add('small', 100, { size: 0.25, lineHeight: 0.1 });
  add('words', 200, { size: '20px', lineHeight: '2' });
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every'), answer: docAnswer(odd) });
  assert.equal(await state(p), 'ready');
  const px = async (id, prop) => parseFloat(await css(p, `[data-id="${id}"]`, prop));
  near(await px('big', 'font-size'), 1000, 0.01, 'size 2000 clamps to 1000');
  near(await px('big', 'line-height'), 10 * 1000, 0.5, 'lineHeight 20 clamps to 10');
  near(await px('small', 'font-size'), 1, 0.01, 'size 0.25 clamps to 1');
  near(await px('small', 'line-height'), 0.5, 0.05, 'lineHeight 0.1 clamps to 0.5');
  near(await px('words', 'font-size'), 16, 0.01, 'a size that is no number: the default');
  near(await px('words', 'line-height'), 1.4 * 16, 0.05, 'a lineHeight that is no number: the default');
  noExceptions(rec);
});

test("a component's label", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  // no label for a component that isn't shown: button inside a hidden frame
  const doc = structuredClone(EVERY);
  doc.nodes.wrap = { type: 'frame', parent: 'p-parts', name: 'Wrap', visible: false, layout: { mode: 'none' }, children: ['button'] };
  doc.nodes.button.parent = 'wrap';
  doc.pages[1].children = ['wrap'];
  const { p, rec } = await open(t, { canvases: { hid: doc }, images: EVERY_IMAGES('hid'), path: '/view/canvas/hid#page=p-parts' });
  assert.equal(await state(p), 'ready');
  assert.equal(await count(p, '#surface [data-id="button"]'), 1, 'button drawn (hidden)');
  assert.equal(await count(p, '#surface .clabel'), 0, 'no label for a component in a hidden frame');
  // where anchor positioning isn't supported the labels are hidden, not stacked at the surface's corner
  assert.equal(await p.ev(`[...document.styleSheets].flatMap((s) => [...s.cssRules]).some((r) => r instanceof CSSSupportsRule && /not\\s*\\(\\s*anchor-name:\\s*--[\\w-]+\\s*\\)/.test(r.conditionText) && [...r.cssRules].some((x) => x.selectorText === '.clabel' && x.style.display === 'none'))`), true, '@supports not (anchor-name) hides .clabel');
  noExceptions(rec);
});

// ---- pages, layers, selection and properties (C1.8, C1.10, and the review focus's fast switch) ----

const rows = (p) => p.ev("[...document.querySelectorAll('#layers .layer[data-node]')].map((r) => ({ id: r.dataset.node, pad: parseFloat(getComputedStyle(r).paddingLeft), level: Number(r.getAttribute('aria-level')), sel: r.getAttribute('aria-selected'), name: r.querySelector('.nm')?.textContent ?? null, mark: r.querySelector('.ic')?.textContent ?? '' }))");
const field = (p, f) => text(p, `#props [data-field="${f}"]`);
const selectedRows = async (p) => (await rows(p)).filter((r) => r.sel === 'true').map((r) => r.id);
const outlined = (p) => p.ev("[...document.querySelectorAll('#surface .sel')].map((e) => e.dataset.id ?? null)");
const noSelection = async (p, what) => {
  assert.deepEqual(await selectedRows(p), [], `${what}: no row selected`);
  assert.deepEqual(await outlined(p), [], `${what}: nothing outlined`);
  assert.equal(await text(p, '#props .note'), 'Select a layer to see what it is.', `${what}: the empty note`);
  assert.equal(await count(p, '#props [data-field]'), 0, `${what}: no fields`);
};

test('layers and selection', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  assert.equal(await state(p), 'ready');
  await noSelection(p, 'at load');

  // the Checkout tree, nested by children order; an instance's inner nodes aren't listed
  const r = await rows(p);
  const want = [['card', 0], ['title', 1], ['rule', 1], ['dot', 1], ['icon', 1], ['photo', 1], ['actions', 1], ['buy', 2], ['loose', 0], ['badge', 1], ['tiles', 0]];
  assert.deepEqual(r.map((x) => [x.id, x.level - 1]), want, 'rows in order, by depth');
  const pad = new Map(r.map((x) => [x.level, x.pad]));
  for (const x of r) assert.equal(x.pad, pad.get(x.level), `${x.id}: the padding of its depth`);
  assert.ok(pad.get(1) < pad.get(2) && pad.get(2) < pad.get(3), `indent grows with depth: ${[...pad].join(' ')}`);
  for (const x of r) {
    assert.equal(x.name, EVERY.nodes[x.id].name, `${x.id}'s row shows its name`);
    assert.ok(x.mark.trim().length > 0, `${x.id}'s row has a type mark`);
  }
  assert.equal(await count(p, '[data-node="button-bg"], [data-node="button-label"]'), 0, "buy's inner nodes have no rows");
  assert.equal(await count(p, '#layers [data-id]'), 0, 'rows carry data-node, never data-id');

  // a row selects its node: the row, the outline, the panel
  await p.click('#layers .layer[data-node="title"]');
  assert.deepEqual(await selectedRows(p), ['title']);
  assert.deepEqual(await outlined(p), ['title'], 'the drawn title is outlined');
  assert.equal(await css(p, '#surface [data-id="title"]', 'outline-style'), 'solid');
  assert.equal(await field(p, 'name'), 'Title');
  assert.equal(await field(p, 'type'), 'text');
  assert.equal(await count(p, '#props [data-field="component"]'), 0, 'no component field on a text');

  await p.click('#layers .layer[data-node="buy"]');
  assert.deepEqual(await selectedRows(p), ['buy']);
  assert.deepEqual(await outlined(p), ['buy']);
  assert.equal(await field(p, 'name'), 'Buy');
  assert.equal(await field(p, 'type'), 'instance');
  assert.equal(await field(p, 'component'), 'Button');
  assert.equal(await field(p, 'variant'), 'primary');

  // a drawn node selects itself; inside an instance, the instance
  await p.click('#surface [data-id="dot"]');
  assert.deepEqual(await selectedRows(p), ['dot']);
  assert.deepEqual(await outlined(p), ['dot']);
  assert.equal(await field(p, 'name'), 'Dot');
  assert.equal(await field(p, 'type'), 'ellipse');
  await p.click('#surface [data-of="buy"][data-src="button-label"]');
  assert.deepEqual(await selectedRows(p), ['buy']);
  assert.deepEqual(await outlined(p), ['buy']);

  // a click on empty stage clears it
  const empty = await p.ev("(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.right - 60, y: r.bottom - 60 }; })()");
  assert.equal(await p.ev(`document.elementFromPoint(${empty.x}, ${empty.y})?.id`), 'stage', 'the point is empty stage');
  await p.clickAt(empty.x, empty.y);
  await noSelection(p, 'after a click on empty stage');

  // Escape after a new selection clears it too
  await p.click('#layers .layer[data-node="loose"]');
  assert.deepEqual(await selectedRows(p), ['loose']);
  assert.equal(await field(p, 'type'), 'frame');
  await p.key('Escape');
  await noSelection(p, 'after Escape');
  noExceptions(rec);

  await t.test('a node with no name shows its type in its row', async (st) => {
    const doc = structuredClone(EVERY);
    doc.nodes.dot.name = '';
    const o = await open(st, { canvases: { unnamed: doc }, images: EVERY_IMAGES('unnamed') });
    assert.equal(await state(o.p), 'ready');
    assert.equal(await text(o.p, '#layers .layer[data-node="dot"] .nm'), 'ellipse');
    assert.equal(await text(o.p, '#layers .layer[data-node="rule"] .nm'), 'Rule', 'a named node keeps its name');
    noExceptions(o.rec);
  });
});

test('pages', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  const { p, rec, load } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every'), path: '/view/canvas/every#page=p-parts' });
  const current = () => p.ev("[...document.querySelectorAll('#pages a[aria-current=\"page\"]')].map((a) => a.textContent)");
  const onParts = async (what) => {
    assert.equal(await state(p), 'ready', what);
    assert.deepEqual(await current(), ['Parts'], `${what}: Parts is current`);
    assert.equal(await count(p, '#surface [data-id="button"]'), 1, `${what}: button drawn`);
    assert.equal(await count(p, '#surface [data-id="card"]'), 0, `${what}: Checkout not drawn`);
    assert.equal(await p.ev("document.getElementById('pageSel').value"), 'p-parts', `${what}: the page select follows`);
    assert.deepEqual(await p.ev("[...document.querySelectorAll('#layers .layer[data-node]')].map((r) => r.dataset.node)"), ['button', 'button-bg', 'button-label'], `${what}: Parts' layers`);
  };
  await onParts('loaded on #page=p-parts');

  // C1.10 a reload stays on the page in the address
  await p.ev('window.beforeReload = true');
  await p.send('Page.reload', {});
  await until(() => p.ev("!window.beforeReload && document.body && document.body.dataset.state === 'ready'").catch(() => false), 'reloaded and ready');
  assert.equal(await p.ev('location.hash'), '#page=p-parts');
  await onParts('after a reload');

  // an unknown page id shows the first page
  await load('/view/canvas/every#page=nope');
  assert.equal(await state(p), 'ready');
  assert.deepEqual(await current(), ['Checkout']);
  assert.equal(await count(p, '#surface [data-id="card"]'), 1);
  assert.equal(await p.ev("document.getElementById('pageSel').value"), 'p-main');

  // the page select: one option per page, by name in order; a change shows that page and sets the hash
  assert.deepEqual(await p.ev("[...document.querySelectorAll('#pageSel option')].map((o) => [o.value, o.textContent])"), EVERY.pages.map((x) => [x.id, x.name]));
  await p.ev("(() => { const s = document.getElementById('pageSel'); s.value = 'p-parts'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await until(() => p.ev("location.hash === '#page=p-parts' && document.body.dataset.state === 'ready' && !!document.querySelector('#surface [data-id=\"button\"]')"), 'Parts by the page select');
  await onParts('after the page select');

  // a selection doesn't outlive its page
  await p.ev("location.hash = '#page=p-main'");
  await until(() => p.ev("document.body.dataset.state === 'ready' && !!document.querySelector('#surface [data-id=\"card\"]')"), 'Checkout again');
  await p.click('#layers .layer[data-node="title"]');
  assert.equal(await field(p, 'name'), 'Title');
  await p.click('#pages a[data-page="p-parts"]');
  await until(() => p.ev("document.body.dataset.state === 'ready' && !!document.querySelector('#surface [data-id=\"button\"]')"), 'Parts by the Pages list');
  assert.equal(await p.ev('location.hash'), '#page=p-parts');
  await noSelection(p, 'after a page switch');

  // the review focus: switching twice fast while Checkout's image is still loading
  // (the recorder holds every image request until the switches are done, so the image is certainly
  // still loading while the page moves on)
  await rec.send('Network.enable');
  await rec.send('Network.setCacheDisabled', { cacheDisabled: true });
  rec.hold = (u) => u.includes('/api/canvas/image/');
  await p.ev(`(async () => {
    const go = (id) => new Promise((r) => { addEventListener('hashchange', r, { once: true }); location.hash = '#page=' + id; });
    await go('p-main');
    await go('p-parts');
    await go('p-main');
    await go('p-parts');
    await go('p-main');
  })()`);
  await until(() => rec.held.length > 0, 'an image request held');
  assert.equal(await state(p), 'loading', 'still loading while the image is held');
  assert.deepEqual(await current(), ['Checkout']);
  assert.equal(await p.ev("document.querySelector('#surface img').complete"), false, 'the image not loaded yet');
  rec.hold = null;
  rec.release();
  await until(() => p.ev("document.body.dataset.state === 'ready'"), 'ready after the fast switches');
  assert.deepEqual(await current(), ['Checkout']);
  assert.equal(await count(p, '#surface [data-id="card"]'), 1);
  assert.equal(await count(p, '#surface [data-id="button"]'), 0);
  assert.equal(await count(p, '#surface img'), 1);
  assert.equal(await p.ev("(() => { const i = document.querySelector('#surface img'); return i.complete && i.naturalWidth > 0; })()"), true, 'the image loaded');
  assert.equal(await p.ev("document.getElementById('pageSel').value"), 'p-main');
  noExceptions(rec);

  await t.test("a fast switch: an older drawing's image loading first doesn't mark the page ready", async (st) => {
    // Parts holds an image of its own file, so its request is told apart from Checkout's (the browser
    // shares one request among drawings of the same URL, cache disabled or not)
    const IMG_B = '0b0b0b0b0b0b0b0b.png';
    const doc = structuredClone(EVERY);
    doc.nodes.pimg = { type: 'image', parent: 'p-parts', name: 'Parts photo', x: 0, y: 300, size: { w: 40, h: 40 }, src: `images/${IMG_B}` };
    doc.pages[1].children.push('pimg');
    const o = await open(st, { canvases: { fast: doc }, images: { fast: { [IMG_FILE]: IMG, [IMG_B]: IMG } } });
    assert.equal(await state(o.p), 'ready');
    const urlA = `${o.origin}/api/canvas/image/fast/${IMG_FILE}`;
    const urlB = `${o.origin}/api/canvas/image/fast/${IMG_B}`;
    await o.rec.send('Network.enable');
    await o.rec.send('Network.setCacheDisabled', { cacheDisabled: true });
    o.rec.hold = (u) => u.includes('/api/canvas/image/');
    const heldFor = (u) => o.rec.held.filter((id) => o.rec.heldUrl.get(id) === u);
    const doneFor = (u) => o.p.ev(`performance.getEntriesByType('resource').filter((e) => e.name === ${JSON.stringify(u)}).length`);
    const doneB0 = await doneFor(urlB);
    await o.p.ev(`(async () => {
      const go = (id) => new Promise((r) => { addEventListener('hashchange', r, { once: true }); location.hash = '#page=' + id; });
      await go('p-parts');
      await go('p-main');
      await go('p-parts');
      await go('p-main');
    })()`);
    await within(() => heldFor(urlA).length > 0 && heldFor(urlB).length > 0, "both pages' image requests held", async () => [...o.rec.heldUrl.values()].join(' '));
    assert.equal(await state(o.p), 'loading');
    assert.deepEqual(await o.p.ev("[...document.querySelectorAll('#pages a[aria-current=\"page\"]')].map((a) => a.textContent)"), ['Checkout']);
    o.rec.hold = null;
    // the detached Parts drawings' image first: it loads, and the page stays loading
    const idsB = heldFor(urlB);
    o.rec.held = o.rec.held.filter((id) => !idsB.includes(id));
    for (const requestId of idsB) await o.rec.send('Fetch.continueRequest', { requestId });
    await within(async () => (await doneFor(urlB)) > doneB0, "Parts' image loaded", async () => `state ${await state(o.p)}`);
    await frames(o.p);
    assert.equal(await state(o.p), 'loading', "still loading once only the detached drawing's image has loaded");
    assert.equal(await o.p.ev("document.querySelector('#surface img').complete"), false, "Checkout's image not loaded yet");
    // then the live page's image: ready
    o.rec.release();
    await within(() => o.p.ev("document.body.dataset.state === 'ready'"), 'ready once the live image loaded', async () => `state ${await state(o.p)}`);
    assert.equal(await count(o.p, '#surface [data-id="card"]'), 1);
    assert.equal(await count(o.p, '#surface [data-id="pimg"]'), 0);
    assert.equal(await o.p.ev("(() => { const i = document.querySelector('#surface img'); return i.complete && i.naturalWidth > 0; })()"), true, 'the live image loaded');
    noExceptions(o.rec);
  });
});

// ---- zoom and pan (C1.9, and the review focus's zoom at its bounds) ----

// The zoom #surface's transform holds, and the page's content bounds on screen: the union of the
// top-level drawn nodes' rectangles plus 200 page px around, which scale with the zoom.
const zoomOf = (p) => p.ev("(() => { const t = getComputedStyle(document.getElementById('surface')).transform; return t === 'none' ? 1 : new DOMMatrixReadOnly(t).a; })()");
const screenRect = (p, sel) => p.ev(`(() => { const r = ${q(sel)}.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()`);
const contentBounds = (p) => p.ev(`(() => {
  const s = document.getElementById('surface');
  const t = getComputedStyle(s).transform;
  const z = t === 'none' ? 1 : new DOMMatrixReadOnly(t).a;
  const rs = [...s.children].filter((e) => e.dataset.id && e.getClientRects().length).map((e) => e.getBoundingClientRect());
  return { l: Math.min(...rs.map((r) => r.left)) - 200 * z, t: Math.min(...rs.map((r) => r.top)) - 200 * z, r: Math.max(...rs.map((r) => r.right)) + 200 * z, b: Math.max(...rs.map((r) => r.bottom)) + 200 * z };
})()`);
const mouse = (p, type, x, y, extra = {}) => p.send('Input.dispatchMouseEvent', { type, x, y, ...extra });
// A key by its key, code and virtual key code (the helper's key() names '+' 'Key+'), typed text and all.
const press = async (p, key, code, vk, modifiers = 0) => {
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers, text: key });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
};
const plusKey = (p) => press(p, '+', 'Equal', 187, 8);
const minusKey = (p) => press(p, '-', 'Minus', 189);
const zeroKey = (p) => press(p, '0', 'Digit0', 48);
const shiftOne = async (p) => {
  await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: '!', code: 'Digit1', windowsVirtualKeyCode: 49, modifiers: 8 });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '!', code: 'Digit1', windowsVirtualKeyCode: 49, modifiers: 8 });
};
const centre = (r) => ({ x: (r.l + r.r) / 2, y: (r.t + r.b) / 2 });
// A press at `from`, two moves to `from` + (dx, dy) with the button held, and a release there.
async function drag(p, from, dx, dy, button, buttons) {
  await mouse(p, 'mouseMoved', from.x, from.y);
  await mouse(p, 'mousePressed', from.x, from.y, { button, buttons, clickCount: 1 });
  await mouse(p, 'mouseMoved', from.x + dx / 2, from.y + dy / 2, { button, buttons });
  await mouse(p, 'mouseMoved', from.x + dx, from.y + dy, { button, buttons });
  await mouse(p, 'mouseReleased', from.x + dx, from.y + dy, { button, buttons: 0, clickCount: 1 });
}

test('zoom and pan', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  assert.equal(await state(p), 'ready');
  const stage = await screenRect(p, '#stage');
  const pct = () => text(p, '#zoomPct');
  const card = () => screenRect(p, '#surface [data-id="card"]');
  const buttonAt = async (sel) => centre(await screenRect(p, sel));
  const clickButton = async (sel) => { const at = await buttonAt(sel); await p.clickAt(at.x, at.y); };
  const inside = (b, what) => {
    for (const [k, cmp] of [['l', (v) => v >= stage.l - 1], ['t', (v) => v >= stage.t - 1], ['r', (v) => v <= stage.r + 1], ['b', (v) => v <= stage.b + 1]]) {
      assert.ok(cmp(b[k]), `${what}: content bounds ${k} ${b[k]} inside the stage ${JSON.stringify(stage)}`);
    }
  };
  const centred = (b, what) => {
    near((b.l + b.r) / 2, (stage.l + stage.r) / 2, 1, `${what}: the content bounds centred across`);
    near((b.t + b.b) / 2, (stage.t + stage.b) / 2, 1, `${what}: the content bounds centred down`);
  };
  // the page point at the stage's centre stays put through `act` (a zoom about the stage centre)
  const keepsCentre = async (act, what) => {
    const sc = { x: (stage.l + stage.r) / 2, y: (stage.t + stage.b) / 2 };
    const a = await card();
    const fx = (sc.x - a.l) / a.w;
    const fy = (sc.y - a.t) / a.h;
    await act();
    const b = await card();
    near(b.l + b.w * fx, sc.x, 1, `${what}: the stage centre's point stays, x`);
    near(b.t + b.h * fy, sc.y, 1, `${what}: the stage centre's point stays, y`);
  };
  // fitted when first shown
  inside(await contentBounds(p), 'at load');
  const zLoad = await zoomOf(p);
  assert.ok(zLoad > 0 && zLoad <= 1, `at most 100%: ${zLoad}`);

  // Fit: the content bounds inside the stage, filling it on one axis, at most 100%
  await clickButton('#zoomFit');
  const zFit = await zoomOf(p);
  const fitted = await contentBounds(p);
  inside(fitted, 'after Fit');
  centred(fitted, 'after Fit');
  assert.ok(zFit === 1 || Math.abs((fitted.r - fitted.l) - stage.w) <= 1 || Math.abs((fitted.b - fitted.t) - stage.h) <= 1, `Fit fills the stage on one axis: ${JSON.stringify(fitted)}`);
  assert.equal(await pct(), `${Math.round(zFit * 100)}%`);

  // + (the button): 1.25 times the zoom, and the card 1.25 times as wide on screen
  const w0 = (await card()).w;
  await keepsCentre(() => clickButton('#zoomIn'), 'the + button');
  near(await zoomOf(p), zFit * 1.25, 1e-4, '+ zooms by 1.25');
  near((await card()).w, w0 * 1.25, 1, "the card's on-screen width after +");
  assert.equal(await pct(), `${Math.round(zFit * 125)}%`);
  // the + key does the same again
  await keepsCentre(() => plusKey(p), 'the + key');
  near(await zoomOf(p), zFit * 1.25 * 1.25, 1e-4, 'the + key zooms by 1.25');
  near((await card()).w, w0 * 1.25 * 1.25, 1, "the card's on-screen width after the + key");
  // - divides by 1.25
  await keepsCentre(() => minusKey(p), 'the - key');
  near(await zoomOf(p), zFit * 1.25, 1e-4, 'the - key divides by 1.25');
  near((await card()).w, w0 * 1.25, 1, "the card's on-screen width after -");
  // 0 returns to 100%
  await zeroKey(p);
  assert.equal(await zoomOf(p), 1);
  assert.equal(await pct(), '100%');
  near((await card()).w, 360, 1, "the card's own width at 100%");
  // Shift+1 fits again
  await shiftOne(p);
  near(await zoomOf(p), zFit, 1e-4, 'Shift+1 fits');
  assert.equal(await pct(), `${Math.round(zFit * 100)}%`);
  inside(await contentBounds(p), 'after Shift+1');

  // the wheel pans: deltaY 100 moves the card up 100 px
  let c0 = await card();
  const over = { x: stage.l + 40, y: stage.b - 40 };
  await mouse(p, 'mouseWheel', over.x, over.y, { deltaX: 0, deltaY: 100 });
  let c1 = await card();
  near(c1.t, c0.t - 100, 1, 'the wheel moves the card up');
  near(c1.l, c0.l, 1, 'the wheel keeps the card across');
  assert.equal(await zoomOf(p), zFit, 'the wheel alone does not zoom');

  // a middle-button drag of (40, 30), from on the card, moves it by (40, 30); it neither selects the
  // card nor clears the selection
  await p.click('#layers .layer[data-node="title"]');
  assert.deepEqual(await selectedRows(p), ['title']);
  c0 = await card();
  await drag(p, centre(c0), 40, 30, 'middle', 4);
  c1 = await card();
  near(c1.l, c0.l + 40, 1, 'middle drag x');
  near(c1.t, c0.t + 30, 1, 'middle drag y');
  assert.deepEqual(await selectedRows(p), ['title'], 'a middle drag keeps the selection as it was');

  // a drag with Space held (the pointer over the stage) does the same; the left button's click that
  // ends it neither selects nor clears
  await p.click('#layers .layer[data-node="title"]');
  assert.deepEqual(await selectedRows(p), ['title']);
  c0 = await card();
  await mouse(p, 'mouseMoved', centre(c0).x, centre(c0).y);
  await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await drag(p, centre(c0), 40, 30, 'left', 1);
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  c1 = await card();
  near(c1.l, c0.l + 40, 1, 'Space drag x');
  near(c1.t, c0.t + 30, 1, 'Space drag y');
  assert.deepEqual(await selectedRows(p), ['title'], 'a Space drag keeps the selection as it was');
  assert.equal(await zoomOf(p), zFit, 'panning does not zoom');

  // a click on empty stage after a pan still clears a selection, and a plain click still selects
  await p.click('#layers .layer[data-node="title"]');
  assert.deepEqual(await selectedRows(p), ['title']);
  assert.equal(await p.ev(`document.elementFromPoint(${stage.r - 60}, ${stage.b - 60})?.id`), 'stage', 'the point is empty stage');
  await p.clickAt(stage.r - 60, stage.b - 60);
  assert.deepEqual(await selectedRows(p), [], 'a click on empty stage clears');

  // Ctrl+wheel zooms around the pointer: the point under it stays put
  c0 = await card();
  const pt = { x: c0.l + c0.w * 0.3, y: c0.t + c0.h * 0.6 };
  const fx = (pt.x - c0.l) / c0.w;
  const fy = (pt.y - c0.t) / c0.h;
  await mouse(p, 'mouseMoved', pt.x, pt.y);
  await mouse(p, 'mouseWheel', pt.x, pt.y, { deltaX: 0, deltaY: -120, modifiers: 2 });
  const zW = await zoomOf(p);
  assert.ok(zW > zFit * 1.2, `Ctrl+wheel zooms in: ${zFit} to ${zW}`);
  c1 = await card();
  near(c1.l + c1.w * fx, pt.x, 1, 'the point under the pointer, x');
  near(c1.t + c1.h * fy, pt.y, 1, 'the point under the pointer, y');
  assert.equal(await pct(), `${Math.round(zW * 100)}%`);

  // the bounds: + at 800% and - at 10% stay put
  for (let k = 0; k < 20; k++) await plusKey(p);
  assert.equal(await zoomOf(p), 8);
  assert.equal(await pct(), '800%');
  c0 = await card();
  await plusKey(p);
  await clickButton('#zoomIn');
  assert.equal(await zoomOf(p), 8, '+ at 800%');
  assert.equal(await pct(), '800%');
  c1 = await card();
  near(c1.l, c0.l, 0.01, '+ at 800% keeps the card, x');
  near(c1.t, c0.t, 0.01, '+ at 800% keeps the card, y');
  for (let k = 0; k < 30; k++) await minusKey(p);
  assert.equal(await zoomOf(p), 0.1);
  assert.equal(await pct(), '10%');
  c0 = await card();
  await minusKey(p);
  await clickButton('#zoomOut');
  assert.equal(await zoomOf(p), 0.1, '- at 10%');
  assert.equal(await pct(), '10%');
  c1 = await card();
  near(c1.l, c0.l, 0.01, '- at 10% keeps the card, x');
  near(c1.t, c0.t, 0.01, '- at 10% keeps the card, y');

  // Space on a focused button presses it (once), the pointer over the stage or not
  await mouse(p, 'mouseMoved', stage.r - 60, stage.b - 60);
  await p.ev("document.getElementById('zoomIn').focus()");
  assert.equal(await p.ev('document.activeElement.id'), 'zoomIn');
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await until(async () => Math.abs(await zoomOf(p) - 0.125) < 1e-4, 'Space on the + button zooms in');
  near(await zoomOf(p), 0.1 * 1.25, 1e-4, 'Space on the + button: once');
  await p.ev('document.activeElement.blur()');

  // keys with Ctrl held are not the page's
  const zNow = await zoomOf(p);
  await press(p, '+', 'Equal', 187, 2 | 8);
  await press(p, '-', 'Minus', 189, 2);
  await press(p, '0', 'Digit0', 48, 2);
  assert.equal(await zoomOf(p), zNow, 'Ctrl with + - 0: the zoom unchanged');

  // a page switch refits: Parts fitted, then Checkout fitted as at Fit
  await p.click('#pages a[data-page="p-parts"]');
  await until(() => p.ev("document.body.dataset.state === 'ready' && !!document.querySelector('#surface [data-id=\"button\"]')"), 'Parts');
  inside(await contentBounds(p), 'Parts when shown');
  centred(await contentBounds(p), 'Parts when shown');
  assert.ok(await zoomOf(p) <= 1);
  await p.click('#pages a[data-page="p-main"]');
  await until(() => p.ev("document.body.dataset.state === 'ready' && !!document.querySelector('#surface [data-id=\"card\"]')"), 'Checkout');
  near(await zoomOf(p), zFit, 1e-4, 'Checkout refitted when shown again');
  centred(await contentBounds(p), 'Checkout when shown again');

  // keys while the page select has focus are the select's (it is shown under 760 px)
  await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await until(() => p.ev("innerWidth === 390 && getComputedStyle(document.getElementById('pageSel')).display !== 'none'"), 'the page select at 390');
  await p.ev("document.getElementById('pageSel').focus()");
  assert.equal(await p.ev('document.activeElement.id'), 'pageSel');
  await p.ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'); // the resize's refit done
  const zSel = await zoomOf(p);
  await plusKey(p);
  await minusKey(p);
  await zeroKey(p);
  await shiftOne(p);
  assert.equal(await zoomOf(p), zSel, 'keys in the page select: the zoom unchanged');
  assert.equal(await p.ev("document.getElementById('pageSel').value"), 'p-main');
  noExceptions(rec);
});

test('Space with the pointer off the stage does not pan', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  assert.equal(await state(p), 'ready');
  const stage = await screenRect(p, '#stage');
  const card = () => screenRect(p, '#surface [data-id="card"]');
  // whether the last Space keydown was taken by the page (window's listener runs after the page's)
  await p.ev("addEventListener('keydown', (e) => { if (e.code === 'Space') window.spaceTaken = e.defaultPrevented; })");
  // the pointer over the Layers panel, focus on the body: Space is not the page's
  const panelAt = centre(await screenRect(p, '#layers .layer[data-node="tiles"]'));
  await mouse(p, 'mouseMoved', panelAt.x, panelAt.y);
  assert.equal(await p.ev(`document.elementFromPoint(${panelAt.x}, ${panelAt.y})?.closest('#stage') ?? null`), null, 'the pointer is off the stage');
  assert.equal(await p.ev('document.activeElement === document.body'), true, 'focus on the body');
  await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  assert.equal(await p.ev('window.spaceTaken'), false, 'the Space keydown is not default-prevented');
  assert.equal(await p.ev("document.getElementById('stage').classList.contains('space')"), false, 'the stage is not in its Space state');
  // with Space still held, a left drag on the panel, then one on empty stage: neither moves the design
  const c0 = await card();
  await drag(p, panelAt, 40, 30, 'left', 1);
  const empty = { x: stage.r - 120, y: stage.b - 120 };
  assert.equal(await p.ev(`document.elementFromPoint(${empty.x}, ${empty.y})?.id`), 'stage', 'the point is empty stage');
  await drag(p, empty, 40, 30, 'left', 1);
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  const c1 = await card();
  near(c1.l, c0.l, 0.5, 'the card stays, x');
  near(c1.t, c0.t, 0.5, 'the card stays, y');
  noExceptions(rec);
});

// ---- width rules (C4, and the review focus's long hostile title at 390 px) ----

// Every visible element outside the drawn design (#surface) that directly holds a non-blank text node
// and may wrap its text: a name for it and its width on screen.
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
// A probe given width: var(--measure), measured (a custom property read back is its unresolved text).
const MEASURE_PROBE = `(() => {
  const d = document.createElement('div');
  d.style.width = 'var(--measure)';
  d.style.position = 'absolute';
  document.body.append(d);
  const w = d.getBoundingClientRect().width;
  d.remove();
  return w;
})()`;

test('running text within six columns at 1440', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  const { p, rec, load } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  near(await p.ev(MEASURE_PROBE), 560, 0.01, 'a probe width: var(--measure)');
  const check = async (what, mustHold) => {
    const found = await p.ev(RUNNING_TEXT);
    for (const { name, w } of found) assert.ok(w <= 560.5, `${what}: ${name} is ${w} px wide, over the measure`);
    for (const m of mustHold) assert.ok(found.some((f) => f.name.startsWith(m)), `${what}: the walk reaches ${m} (found ${found.map((f) => f.name).join(', ')})`);
    // the fixture's texts are short, so the running-text elements also carry the cap itself
    for (const sel of mustHold) {
      const mw = await p.ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.getClientRects().length).map((e) => getComputedStyle(e).maxWidth)`);
      assert.ok(mw.length > 0 && mw.every((v) => /^(min\()?560px\b/.test(v)), `${what}: ${sel} capped at the measure (${mw.join(', ')})`);
    }
  };
  assert.equal(await state(p), 'ready');
  await check('every, nothing selected', ['p.note']);
  await p.click('#layers .layer[data-node="title"]');
  assert.equal(await field(p, 'name'), 'Title');
  await check('every, title selected', ['span.v']);
  await load('/view/canvas/nope');
  assert.equal(await state(p), 'error');
  assert.equal(await shown(p, '#msg'), true);
  await check('a slug the server does not have', ['p#msg']);
  near(await p.ev(MEASURE_PROBE), 560, 0.01, 'a probe width: var(--measure), on the error page');
  noExceptions(rec);
});

// The bar at the current width: its height, and every shown item of it (the title and the repo chip
// among them) inside it on one line, not wrapping, and nothing scrolled sideways.
async function barChecks(p, barH, what) {
  const width = await p.ev('innerWidth');
  assert.ok(await p.ev('document.documentElement.scrollWidth') <= width, `${what}: no sideways scroll (${await p.ev('document.documentElement.scrollWidth')} > ${width})`);
  const bar = await screenRect(p, '.bar');
  near(bar.h, barH, 0.01, `${what}: the bar's height, as at 1440`);
  near(bar.l, 0, 0.01, `${what}: the bar's left`);
  near(bar.w, width, 0.5, `${what}: the bar's width`);
  for (const sel of ['#title', '#repoChip']) {
    assert.equal(await shown(p, sel), true, `${what}: ${sel} shown`);
    const r = await screenRect(p, sel);
    assert.ok(r.w >= 8, `${what}: ${sel} keeps some width (${r.w})`);
    assert.ok(r.l >= bar.l - 0.5 && r.r <= bar.r + 0.5 && r.t >= bar.t - 0.5 && r.b <= bar.b + 0.5, `${what}: ${sel} ${JSON.stringify(r)} inside the bar ${JSON.stringify(bar)}`);
    assert.equal(await css(p, sel, 'text-wrap-mode'), 'nowrap', `${what}: ${sel} never wraps`);
  }
  // the title keeps a floor: its whole text, or 5em of it when longer (a long repo name gives way first)
  const tw = await p.ev("(() => { const h = document.getElementById('title'); return { w: h.getBoundingClientRect().width, full: h.scrollWidth, em5: 5 * parseFloat(getComputedStyle(h).fontSize) }; })()");
  assert.ok(tw.w >= Math.min(tw.full, tw.em5) - 1, `${what}: #title keeps min(its text, 5em) of width (${JSON.stringify(tw)})`);
  // the title's ellipsis: text-overflow draws one only on a block container (h1 is one)
  assert.equal(await css(p, '#title', 'text-overflow'), 'ellipsis', `${what}: #title ends in an ellipsis when cut`);
  assert.ok(['block', 'inline-block', 'flow-root'].includes(await css(p, '#title', 'display')), `${what}: #title a block container`);
  // the chip: its repo name may be cut with an ellipsis, its visibility (the chip's whole point) never is
  const chip = await p.ev(`(() => {
    const c = document.getElementById('repoChip');
    const nm = c.querySelector('.repo-name');
    const vis = c.querySelector('.repo-vis');
    if (!nm || !vis) return null;
    const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width }; };
    const ns = getComputedStyle(nm);
    return { text: c.textContent, name: nm.textContent, vis: vis.textContent, chip: box(c), v: box(vis), vsw: vis.scrollWidth, vcw: vis.clientWidth,
      nDisplay: ns.display, nOverflow: ns.textOverflow, nClip: ns.overflowX, nWrap: ns.textWrapMode, nsw: nm.scrollWidth, ncw: nm.clientWidth };
  })()`);
  assert.ok(chip, `${what}: the chip holds a .repo-name and a .repo-vis span`);
  assert.match(chip.vis, /^· (public|private|may be public)$/, `${what}: the visibility span`);
  assert.match(chip.name, /^Saved to ./, `${what}: the name span`);
  assert.equal(chip.text, `${chip.name} ${chip.vis}`, `${what}: the chip's whole text`);
  assert.ok(chip.vcw > 0 && chip.vsw <= chip.vcw + 0.5, `${what}: the visibility fully shown (scrollWidth ${chip.vsw}, clientWidth ${chip.vcw})`);
  assert.ok(chip.v.l >= bar.l - 0.5 && chip.v.r <= bar.r + 0.5 && chip.v.t >= bar.t - 0.5 && chip.v.b <= bar.b + 0.5, `${what}: the visibility ${JSON.stringify(chip.v)} inside the bar ${JSON.stringify(bar)}`);
  assert.ok(chip.v.l >= -0.5 && chip.v.r <= width + 0.5, `${what}: the visibility ${JSON.stringify(chip.v)} inside the viewport`);
  assert.ok(chip.v.l >= chip.chip.l - 0.5 && chip.v.r <= chip.chip.r + 0.5, `${what}: the visibility ${JSON.stringify(chip.v)} inside the chip ${JSON.stringify(chip.chip)}, not clipped by it`);
  assert.ok(['block', 'inline-block', 'flow-root'].includes(chip.nDisplay), `${what}: the name span a block container (${chip.nDisplay}), so its ellipsis draws`);
  assert.equal(chip.nOverflow, 'ellipsis', `${what}: the name span ends in an ellipsis when cut`);
  assert.equal(chip.nClip, 'hidden', `${what}: the name span clips`);
  assert.equal(chip.nWrap, 'nowrap', `${what}: the name span never wraps`);
  const items = await p.ev("[...document.querySelector('.bar').children].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return { name: e.className || e.id, l: r.left, r: r.right, t: r.top, b: r.bottom, h: r.height }; })");
  for (const it of items) {
    assert.ok(it.l >= bar.l - 0.5 && it.r <= bar.r + 0.5, `${what}: bar item ${it.name} ${JSON.stringify(it)} inside the bar across`);
    assert.ok(it.t >= bar.t - 0.5 && it.b <= bar.b + 0.5, `${what}: bar item ${it.name} ${JSON.stringify(it)} inside the bar down`);
  }
  const mids = items.map((it) => (it.t + it.b) / 2);
  assert.ok(Math.max(...mids) - Math.min(...mids) <= 1, `${what}: the bar's items on one line (${mids.join(', ')})`);
}
const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

test('watch and comment at 390', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  const { p, rec, load, size } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  const barH = (await screenRect(p, '.bar')).h;
  assert.ok(barH > 0);
  // at 1440 the page select and the note are not shown
  assert.equal(await css(p, '#pageSel', 'display'), 'none', 'no page select at 1440');
  assert.equal(await css(p, '#narrowNote', 'display'), 'none', 'no narrow note at 1440');

  await size(390, 844);
  await load('/view/canvas/every');
  assert.equal(await state(p), 'ready');
  assert.equal(await p.ev('innerWidth'), 390);
  // the panels hidden, the stage the window's full width under the bar
  assert.equal(await css(p, '.panel.left', 'display'), 'none', 'the left panel');
  assert.equal(await css(p, '.panel.right', 'display'), 'none', 'the right panel');
  const stage = await screenRect(p, '#stage');
  near(stage.l, 0, 0.5, "the stage's left");
  near(stage.w, 390, 0.5, "the stage's width");
  await barChecks(p, barH, 'every at 390');
  near(stage.t, (await screenRect(p, '.bar')).b, 1, 'the stage under the bar');
  // the note, and the page select, on the stage and clear of the zoom controls
  assert.equal(await shown(p, '#narrowNote'), true, 'the narrow note shown');
  assert.equal(await text(p, '#narrowNote'), 'Watching: editing needs a wider screen.');
  assert.match(await css(p, '#narrowNote', 'max-width'), /^(min\()?560px\b/, 'the narrow note capped at the measure');
  assert.equal(await shown(p, '#pageSel'), true, 'the page select shown');
  const zoomBox = await screenRect(p, '.zoom');
  for (const sel of ['#narrowNote', '#pageSel']) {
    const r = await screenRect(p, sel);
    assert.ok(r.l >= stage.l && r.r <= stage.r && r.t >= stage.t && r.b <= stage.b, `${sel} ${JSON.stringify(r)} on the stage ${JSON.stringify(stage)}`);
    assert.ok(!overlap(r, zoomBox), `${sel} ${JSON.stringify(r)} clear of the zoom controls ${JSON.stringify(zoomBox)}`);
  }
  // fitted to the 390 px stage: the whole content-bounds box inside it, at a zoom below 100%
  const z = await zoomOf(p);
  assert.ok(z < 1, `a zoom below 100% (${z})`);
  const b = await contentBounds(p);
  assert.ok((b.r - b.l) / z > 390, `left as drawn, Checkout's bounds overflow the stage (${(b.r - b.l) / z} px)`);
  assert.ok(b.l >= stage.l - 1 && b.r <= stage.r + 1 && b.t >= stage.t - 1 && b.b <= stage.b + 1, `content bounds ${JSON.stringify(b)} inside the stage ${JSON.stringify(stage)}`);
  assert.equal(await text(p, '#zoomPct'), `${Math.round(z * 100)}%`);
  // the page select lists both pages; choosing Parts draws button
  assert.deepEqual(await p.ev("[...document.querySelectorAll('#pageSel option')].map((o) => o.textContent)"), ['Checkout', 'Parts']);
  await p.ev("(() => { const s = document.getElementById('pageSel'); s.value = 'p-parts'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await until(() => p.ev("document.body.dataset.state === 'ready' && !!document.querySelector('#surface [data-id=\"button\"]')"), 'Parts by the page select at 390');
  assert.equal(await count(p, '#surface [data-id="card"]'), 0);
  assert.equal(await shown(p, '#surface [data-id="button"]'), true, 'button drawn and on screen');
  // + changes the zoom percentage
  const before = await text(p, '#zoomPct');
  const zb = await zoomOf(p);
  const zi = centre(await screenRect(p, '#zoomIn'));
  await p.clickAt(zi.x, zi.y);
  near(await zoomOf(p), zb * 1.25, 1e-4, '+ at 390');
  assert.notEqual(await text(p, '#zoomPct'), before, '+ changes the percentage');
  assert.ok(await p.ev('document.documentElement.scrollWidth') <= 390, 'still no sideways scroll');
  noExceptions(rec);
});

const HOSTILE = fixture('hostile.json');
const LONG_SLUG = `hostile-${'a-very-long-canvas-name-'.repeat(8)}end`;

test('a hostile document and a long title in the bar at 390', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  const { p, rec, load, size } = await open(t, { canvases: { hostile: HOSTILE, [LONG_SLUG]: HOSTILE }, images: { hostile: { [IMG_FILE]: IMG }, [LONG_SLUG]: { [IMG_FILE]: IMG } } });
  assert.equal(await state(p), 'ready');
  const barH = (await screenRect(p, '.bar')).h;
  await size(390, 844);
  for (const slug of ['hostile', LONG_SLUG]) {
    for (const page of ['h1', 'h2']) {
      await load(`/view/canvas/${slug}#page=${page}`);
      assert.equal(await state(p), 'ready', `${slug} ${page}`);
      assert.equal(await text(p, '#title'), slug);
      await barChecks(p, barH, `${slug.slice(0, 20)}… ${page} at 390`);
      const stage = await screenRect(p, '#stage');
      const sel = await screenRect(p, '#pageSel');
      assert.ok(sel.l >= stage.l && sel.r <= stage.r, `the page select ${JSON.stringify(sel)} within the stage across`);
      assert.ok(!overlap(sel, await screenRect(p, '.zoom')), 'the page select clear of the zoom controls');
    }
  }
  noExceptions(rec);
});

test('a long repo name at 390: the title stays, the name gives way', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  const repo = { name: 'sanctuarycomputer/a-forty-character-repo-name-xx', public: true };
  const { p, rec, load, size } = await open(t, { canvases: { every: EVERY, [LONG_SLUG]: HOSTILE }, images: { every: { [IMG_FILE]: IMG }, [LONG_SLUG]: { [IMG_FILE]: IMG } }, repo });
  assert.equal(await state(p), 'ready');
  const barH = (await screenRect(p, '.bar')).h;
  await size(390, 844);
  for (const slug of ['every', LONG_SLUG]) {
    await load(`/view/canvas/${slug}`);
    assert.equal(await state(p), 'ready', slug);
    assert.equal(await text(p, '#repoChip'), `Saved to ${repo.name} · public`);
    await barChecks(p, barH, `${slug.slice(0, 20)} with a long repo name at 390`);
    const nm = await p.ev("(() => { const n = document.querySelector('#repoChip .repo-name'); return { sw: n.scrollWidth, cw: n.clientWidth }; })()");
    assert.ok(nm.sw > nm.cw, `${slug.slice(0, 20)}: the repo name is cut (scrollWidth ${nm.sw}, clientWidth ${nm.cw})`);
  }
  noExceptions(rec);
});

// ---- nothing a document holds runs or loads (C2) ----

// Before the page loads: alert, confirm, prompt and print replaced by recorders (window.dialogTraps).
const DIALOG_TRAPS = `(() => {
  const calls = [];
  Object.defineProperty(window, 'dialogTraps', { value: calls });
  for (const name of ['alert', 'confirm', 'prompt', 'print']) {
    const trap = function () { calls.push([name, ...[...arguments].map(String)]); return name === 'confirm' ? false : name === 'prompt' ? null : undefined; };
    Object.defineProperty(window, name, { value: trap, writable: false, configurable: false });
  }
})();`;
const addTraps = (rec) => rec.send('Page.addScriptToEvaluateOnNewDocument', { source: DIALOG_TRAPS });
// The DOM's census for C2.2: the elements a document's markup would add, and every on* attribute.
const CENSUS = `(() => ({
  traps: Array.isArray(window.dialogTraps) && ['alert', 'confirm', 'prompt', 'print'].every((k) => String(window[k]).includes('calls.push')),
  calls: window.dialogTraps ?? null,
  script: document.querySelectorAll('script').length,
  style: document.querySelectorAll('style').length,
  foreign: [...document.querySelectorAll('iframe, object, embed, link, b')].map((e) => e.localName),
  meta: [...document.querySelectorAll('meta')].map((m) => (m.hasAttribute('charset') ? 'charset' : m.name)),
  on: [...document.querySelectorAll('*')].flatMap((e) => [...e.attributes].filter((a) => /^on/i.test(a.name)).map((a) => e.localName + ' ' + a.name)),
}))()`;
const HOSTILE_IMG = `/api/canvas/image/hostile/${IMG_FILE}`;
// C2.1: the distinct URLs seen are a subset of the page, its doc, its image and /favicon.ico, and hold the first three.
function onlyOwnRequests(rec, origin, what) {
  const allowed = [`${origin}/view/canvas/hostile`, `${origin}/api/canvas/doc?slug=hostile`, `${origin}${HOSTILE_IMG}`, `${origin}/favicon.ico`];
  const seen = [...rec.urls];
  assert.deepEqual(seen.filter((u) => !allowed.includes(u)), [], `${what}: C2.1 no request but the page's own (saw ${seen.join(' ')})`);
  for (const u of allowed.slice(0, 3)) assert.ok(rec.urls.has(u), `${what}: C2.1 the request for ${u}`);
}
// C2.2: no dialog opened, no trap called, and the DOM holds only the page's own markup.
async function ranNothing(p, rec, what, taken = null) {
  assert.deepEqual(rec.dialogs, [], `${what}: C2.2 no dialog opened`);
  const c = taken ?? await p.ev(CENSUS);
  assert.equal(c.traps, true, `${what}: C2.2 the dialog traps are in place`);
  assert.deepEqual(c.calls, [], `${what}: C2.2 no dialog function called`);
  assert.equal(c.script, 1, `${what}: C2.2 one script element`);
  assert.equal(c.style, 1, `${what}: C2.2 one style element`);
  assert.deepEqual(c.foreign, [], `${what}: C2.2 no iframe, object, embed, link or b`);
  assert.deepEqual(c.meta, ['charset', 'viewport'], `${what}: C2.2 only the page's own meta`);
  assert.deepEqual(c.on, [], `${what}: C2.2 no on* attribute anywhere`);
}

test('the hostile document runs nothing', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  const H = HOSTILE;
  const { p, origin, rec } = await open(t, { canvases: { hostile: H }, images: { hostile: { [IMG_FILE]: IMG } }, path: '/view/canvas/hostile#page=h1', beforeLoad: addTraps });
  assert.equal(await state(p), 'ready');
  const rowNames = () => p.ev("[...document.querySelectorAll('#layers .layer[data-node]')].map((r) => [r.dataset.node, r.querySelector('.nm').textContent])");
  // the walk: every node of h1 selected by its Layers row, then h2 and he
  const props = [];
  const layers = [];
  layers.push(...await rowNames());
  for (const id of ['hf', 'ht', 'hr', 'hv', 'him', 'hc', 'hct', 'hi']) {
    await p.click(`#layers .layer[data-node="${id}"]`);
    assert.deepEqual(await selectedRows(p), [id], `${id} selected`);
    props.push([id, await field(p, 'name'), id === 'hi' ? await field(p, 'component') : null]);
  }
  const drawnText = await text(p, '#surface [data-id="ht"]');
  // the census while h1 (its drawn nodes, Layers and Properties) is shown, as well as at the end on h2
  await sleep(500);
  const censusH1 = await p.ev(CENSUS);
  await p.click('#pages a[data-page="h2"]');
  await until(() => p.ev("document.body.dataset.state === 'ready' && !!document.querySelector('#surface [data-id=\"he\"]')"), 'h2 drawn');
  layers.push(...await rowNames());
  await p.click('#layers .layer[data-node="he"]');
  assert.deepEqual(await selectedRows(p), ['he'], 'he selected');
  props.push(['he', await field(p, 'name'), null]);
  await sleep(500);

  await t.test('C2.1 nothing loads from elsewhere, at 1440', () => onlyOwnRequests(rec, origin, 'at 1440'));
  await t.test('C2.2 no script from the document ran, at 1440', async () => {
    await ranNothing(p, rec, 'at 1440, h1 shown', censusH1);
    await ranNothing(p, rec, 'at 1440, at the end');
  });
  await t.test('C2.3 the hostile strings are shown as text, exactly', async () => {
    assert.equal(drawnText, H.nodes.ht.text, "the drawn ht's textContent");
    assert.deepEqual(await p.ev("[...document.querySelectorAll('#pages a[data-page]')].map((a) => a.textContent)"), H.pages.map((x) => x.name), 'the Pages list');
    assert.deepEqual(await p.ev("[...document.querySelectorAll('#pageSel option')].map((o) => o.textContent)"), H.pages.map((x) => x.name), 'the page select');
    assert.deepEqual(layers.map(([id]) => id), ['hf', 'ht', 'hr', 'hv', 'him', 'hc', 'hct', 'hi', 'he'], 'every node has its row');
    for (const [id, name] of layers) assert.equal(name, H.nodes[id].name, `${id}'s Layers row`);
    assert.equal(props.length, 9);
    for (const [id, name, comp] of props) {
      assert.equal(name, H.nodes[id].name, `${id}'s Properties name`);
      if (id === 'hi') assert.equal(comp, H.nodes.hc.name, "hi's Properties component: hc's name");
    }
  });
  noExceptions(rec);

  await t.test('at 390, pages switched by the page select', async (st) => {
    const o = await open(st, { canvases: { hostile: H }, images: { hostile: { [IMG_FILE]: IMG } }, size: [390, 844], beforeLoad: addTraps });
    assert.equal(await state(o.p), 'ready');
    assert.equal(await css(o.p, '.panel.left', 'display'), 'none', 'the panels hidden');
    assert.equal(await css(o.p, '.panel.right', 'display'), 'none', 'the panels hidden');
    const choose = async (id, node) => {
      await o.p.ev(`(() => { const s = document.getElementById('pageSel'); s.value = ${JSON.stringify(id)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until(() => o.p.ev(`document.body.dataset.state === 'ready' && !!document.querySelector('#surface [data-id="${node}"]')`), `${id} by the page select`);
    };
    await choose('h2', 'he');
    await choose('h1', 'hf');
    await sleep(500);
    await st.test('C2.1 at 390', () => onlyOwnRequests(o.rec, o.origin, 'at 390'));
    await st.test('C2.2 at 390', () => ranNothing(o.p, o.rec, 'at 390'));
    await st.test('C2.3 the page select at 390', async () => {
      assert.deepEqual(await o.p.ev("[...document.querySelectorAll('#pageSel option')].map((x) => x.textContent)"), H.pages.map((x) => x.name), 'C2.3 the page select at 390');
    });
    noExceptions(o.rec);
  });
});

// The script between the page's <script> and </script>.
const pageScript = () => {
  const src = fs.readFileSync(PAGE_FILE, 'utf8');
  const m = /<script>([\s\S]*?)<\/script>/.exec(src);
  assert.ok(m, 'the page has an inline script');
  return m[1];
};

test("the page's source holds no markup sinks", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  const src = fs.readFileSync(PAGE_FILE, 'utf8');
  assert.equal((src.match(/<script\b/g) ?? []).length, 1, 'one script element in the page');
  const js = pageScript();
  for (const token of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'createContextualFragment', 'DOMParser', 'setHTMLUnsafe', 'parseHTMLUnsafe', 'srcdoc', 'cssText', "setAttribute('style'", 'setAttribute("style"', 'eval(', 'new Function', 'import(']) {
    assert.equal(js.includes(token), false, `the script holds no ${token}`);
  }
  assert.doesNotMatch(js, /\bset(Timeout|Interval)\s*\(\s*['"`]/, 'no setTimeout or setInterval given a string');
  // and no will-change anywhere in the page (the supervisor's note from dev-650)
  assert.equal(src.includes('will-change') || src.includes('willChange'), false, 'no will-change');
});

test('values outside their classes', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  // out of class, so the recorder serves it; the fake holds the valid document (and its image) under the slug
  const bad = structuredClone(EVERY);
  const N = bad.nodes;
  N.card.fill = 'rgb(255, 0, 0)';
  N.rule.fill = 'url(https://evil.example/b)';
  N.card.layout.gap = '2em';
  N.card.layout.mode = 'block';
  N.tiles.layout.columns = ['repeat(3, 10px)'];
  N.title.font = { family: 'fantasy', size: '20px', weight: 400, lineHeight: 1.4 };
  N.title.color = 'red';
  N.icon.path = 'M0 0" onload="alert(5)';
  N.photo.src = 'https://evil.example/f.png';
  N.dot.size.w = '50%';
  N.ghost = { type: 'instance', parent: 'actions', name: 'Ghost', component: 'nope' };
  N.actions.children.push('ghost');
  const { p, origin, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every'), answer: docAnswer(bad), beforeLoad: addTraps });
  assert.equal(await state(p), 'ready');
  await sleep(500);

  await t.test('C2.5 nothing requested off the origin', () => {
    const seen = [...rec.urls];
    assert.deepEqual(seen.filter((u) => u !== origin && !u.startsWith(`${origin}/`)), [], `no request off the origin (saw ${seen.join(' ')})`);
    assert.deepEqual(seen.filter((u) => u.includes('evil.example')), [], 'no request for evil.example');
  });
  await t.test('C2.5 card: no fill, no gap, neither flex nor grid', async () => {
    assert.equal(await css(p, '[data-id="card"]', 'background-color'), 'rgba(0, 0, 0, 0)');
    assert.ok(['normal', '0px'].includes(await css(p, '[data-id="card"]', 'row-gap')), 'no gap');
    assert.ok(!['flex', 'grid'].includes(await css(p, '[data-id="card"]', 'display')), 'mode: the default, none');
    assert.equal(await css(p, '[data-id="title"]', 'position'), 'absolute', "under a none frame its children are absolute");
  });
  await t.test('C2.5 rule: no background image', async () => {
    assert.equal(await css(p, '[data-id="rule"]', 'background-image'), 'none');
    assert.equal(await css(p, '[data-id="rule"]', 'background-color'), 'rgba(0, 0, 0, 0)');
  });
  await t.test('C2.5 tiles: one column track', async () => {
    const cols = await css(p, '[data-id="tiles"]', 'grid-template-columns');
    assert.equal(cols.trim().split(/\s+/).length, 1, `a single track: ${cols}`);
  });
  await t.test('C2.5 title: the default font and colour', async () => {
    assert.equal(await css(p, '[data-id="title"]', 'font-family'), await p.ev('getComputedStyle(document.body).fontFamily'), "the page's sans stack");
    assert.equal(await css(p, '[data-id="title"]', 'font-size'), '16px');
    assert.equal(await css(p, '[data-id="title"]', 'font-weight'), '400');
    near(parseFloat(await css(p, '[data-id="title"]', 'line-height')), 1.4 * 16, 0.05, 'line height 1.4');
    assert.equal(await css(p, '[data-id="title"]', 'color'), 'rgb(0, 0, 0)');
  });
  await t.test('C2.5 icon: an svg with no path', async () => {
    assert.equal(await p.ev(`${q('[data-id="icon"]')}.localName`), 'svg');
    assert.equal(await count(p, '[data-id="icon"] path'), 0);
  });
  await t.test('C2.5 photo: an empty box of its size, no img, no src', async () => {
    assert.equal(await p.ev(`${q('[data-id="photo"]')}.localName`), 'div');
    assert.equal(await count(p, '[data-id="photo"] img, img[data-id="photo"]'), 0);
    assert.equal(await p.ev(`(() => { const e = ${q('[data-id="photo"]')}; return e.hasAttribute('src') || e.querySelectorAll('[src]').length > 0; })()`), false, 'no src anywhere in it');
    assert.equal(await count(p, '#surface img'), 0, 'no img drawn at all');
    near((await rect(p, '[data-id="photo"]')).h, 120, 0.01, "the photo's height");
    near((await rect(p, '[data-id="photo"]')).w, 360, 0.5, "the photo's width (fill under the card)");
  });
  await t.test('C2.5 dot: 0 px wide', async () => {
    near((await rect(p, '[data-id="dot"]')).w, 0, 0.01, "dot's width: hug of an empty ellipse");
    near((await rect(p, '[data-id="dot"]')).h, 8, 0.01, "dot's height as stored");
  });
  await t.test('C2.5 ghost: a dashed placeholder', async () => {
    assert.equal(await count(p, '#surface [data-id="ghost"].placeholder'), 1);
    assert.equal(await css(p, '[data-id="ghost"]', 'border-top-style'), 'dashed');
    assert.equal(await text(p, '[data-id="ghost"]'), 'Ghost');
  });
  await t.test('C2.5 every other node drawn as in C1, and nothing ran', async () => {
    for (const id of CHECKOUT_IDS) assert.equal(await count(p, `#surface [data-id="${id}"]`), 1, `${id} drawn once`);
    assert.equal(await count(p, '#surface .placeholder'), 1, 'ghost the only placeholder');
    assert.equal(await css(p, '[data-id="actions"]', 'display'), 'flex');
    assert.equal(await css(p, '[data-id="tiles"]', 'display'), 'grid');
    assert.equal(await text(p, '[data-of="buy"][data-src="button-label"]'), resolve(EVERY, 'buy')['button-label'].text);
    assert.equal(await css(p, '[data-id="badge"]', 'left'), '12px');
    assert.equal(await css(p, '[data-id="badge"]', 'top'), '-8px');
    near((await rect(p, '[data-id="rule"]')).h, 1, 0.01, 'rule height');
    near((await rect(p, '[data-id="loose"]')).l, 400, 0.5, 'loose at x 400');
    assert.deepEqual(rec.dialogs, [], 'no dialog');
    assert.deepEqual(await p.ev('window.dialogTraps'), [], 'no dialog function called');
  });
  noExceptions(rec);
});

// ---- touch at 390, and the refit on a resize ----

test('touch at 390: one finger pans, two pinch, a tap selects', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every'), size: [390, 844] });
  assert.equal(await state(p), 'ready');
  await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  assert.equal(await css(p, '#stage', 'touch-action'), 'none', 'the browser neither scrolls nor zooms the stage itself');
  const stage = await screenRect(p, '#stage');
  const card = () => screenRect(p, '#surface [data-id="card"]');
  const touch = (type, pts) => p.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const tap = async (at) => { await touch('touchStart', [[at.x, at.y]]); await touch('touchEnd', []); };

  // a tap on the drawn dot selects it
  const dotAt = centre(await screenRect(p, '#surface [data-id="dot"]'));
  assert.equal(await p.ev(`document.elementFromPoint(${dotAt.x}, ${dotAt.y})?.closest('[data-id]')?.dataset.id`), 'dot', 'the dot is under the tap');
  await tap(dotAt);
  await until(async () => (await selectedRows(p)).includes('dot'), 'a tap selects the dot');
  assert.deepEqual(await selectedRows(p), ['dot']);
  assert.deepEqual(await outlined(p), ['dot']);

  // a one-finger drag of (40, 30), from on the card, moves it by (40, 30) and neither selects nor clears
  let c0 = await card();
  const from = centre(c0);
  await touch('touchStart', [[from.x, from.y]]);
  await touch('touchMove', [[from.x + 20, from.y + 15]]);
  await touch('touchMove', [[from.x + 40, from.y + 30]]);
  await touch('touchEnd', []);
  await frames(p);
  let c1 = await card();
  near(c1.l, c0.l + 40, 1, 'a one-finger drag, x');
  near(c1.t, c0.t + 30, 1, 'a one-finger drag, y');
  assert.deepEqual(await selectedRows(p), ['dot'], 'a drag keeps the selection as it was');

  // a two-finger pinch spreading the fingers to twice as far apart doubles the zoom about its centre
  const z0 = await zoomOf(p);
  c0 = await card();
  const pc = { x: c0.l + c0.w * 0.4, y: c0.t + c0.h * 0.5 };
  const fx = (pc.x - c0.l) / c0.w;
  const fy = (pc.y - c0.t) / c0.h;
  const fingers = (d) => [[pc.x - d, pc.y - d / 2], [pc.x + d, pc.y + d / 2]];
  await touch('touchStart', [fingers(30)[0]]);
  await touch('touchStart', fingers(30));
  for (const d of [36, 45, 52, 60]) await touch('touchMove', fingers(d));
  await touch('touchEnd', [fingers(60)[0]]);
  await touch('touchEnd', []);
  await frames(p);
  const z1 = await zoomOf(p);
  assert.ok(Math.abs(z1 / z0 - 2) <= 0.1, `a pinch to twice the spread doubles the zoom: ${z0} to ${z1}`);
  c1 = await card();
  near(c1.l + c1.w * fx, pc.x, 2, 'the pinch centre stays, x');
  near(c1.t + c1.h * fy, pc.y, 2, 'the pinch centre stays, y');
  assert.equal(await text(p, '#zoomPct'), `${Math.round(z1 * 100)}%`);
  assert.deepEqual(await selectedRows(p), ['dot'], 'a pinch keeps the selection as it was');

  // a tap on empty stage clears, as a click does
  const empty = { x: stage.r - 30, y: stage.b - 30 };
  assert.equal(await p.ev(`document.elementFromPoint(${empty.x}, ${empty.y})?.id`), 'stage', 'the point is empty stage');
  await tap(empty);
  await until(async () => (await selectedRows(p)).length === 0, 'a tap on empty stage clears');
  assert.deepEqual(await outlined(p), []);
  assert.ok(await p.ev('document.documentElement.scrollWidth') <= 390, 'no sideways scroll');

  // a finger that wiggles 3 px on the dot (within the 6 px slop) is a tap: it selects, the view stays
  c0 = await card();
  const dot2 = centre(await screenRect(p, '#surface [data-id="dot"]'));
  await touch('touchStart', [[dot2.x, dot2.y]]);
  await touch('touchMove', [[dot2.x + 3, dot2.y]]);
  await touch('touchEnd', []);
  await within(async () => (await selectedRows(p)).includes('dot'), 'a 3 px wiggle selects the dot', async () => `selected ${JSON.stringify(await selectedRows(p))}, the card moved by ${(await card()).l - c0.l} px`, 5000);
  await frames(p);
  c1 = await card();
  near(c1.l, c0.l, 0.01, 'a 3 px wiggle keeps the view, x');
  near(c1.t, c0.t, 0.01, 'a 3 px wiggle keeps the view, y');

  // a 10 px drag starting on the title (past the page's slop, under the browser's own) pans by 10 px
  // and neither selects the title nor clears the dot
  c0 = await card();
  const tAt = centre(await screenRect(p, '#surface [data-id="title"]'));
  assert.equal(await p.ev(`document.elementFromPoint(${tAt.x}, ${tAt.y})?.closest('[data-id]')?.dataset.id`), 'title', 'the drag starts on the title');
  await touch('touchStart', [[tAt.x, tAt.y]]);
  await touch('touchMove', [[tAt.x + 5, tAt.y]]);
  await touch('touchMove', [[tAt.x + 10, tAt.y]]);
  await touch('touchEnd', []);
  await frames(p);
  await sleep(300); // a click Chrome may send after the touch has arrived
  c1 = await card();
  near(c1.l, c0.l + 10, 1, 'a 10 px drag moves the view, x');
  near(c1.t, c0.t, 1, 'a 10 px drag moves the view, y');
  assert.deepEqual(await selectedRows(p), ['dot'], 'a 10 px drag neither selects nor clears');
  noExceptions(rec);
});

test('a resize refits, unless the view was moved', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  const { p, rec, size } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  assert.equal(await state(p), 'ready');
  const view = () => p.ev("(() => { const t = getComputedStyle(document.getElementById('surface')).transform; const m = t === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(t); return { z: m.a, x: m.e, y: m.f }; })()");
  // 1440 to 390: the loaded page refits to the narrow stage
  await size(390, 844);
  await until(() => p.ev('innerWidth === 390'), 'the window at 390');
  await frames(p);
  const stage = await screenRect(p, '#stage');
  near(stage.w, 390, 0.5, "the stage's width at 390");
  const b = await contentBounds(p);
  assert.ok(b.l >= stage.l - 1 && b.r <= stage.r + 1 && b.t >= stage.t - 1 && b.b <= stage.b + 1, `content bounds ${JSON.stringify(b)} inside the stage ${JSON.stringify(stage)} after the resize`);
  assert.equal(await text(p, '#zoomPct'), `${Math.round((await zoomOf(p)) * 100)}%`);
  // zoomed with +, then back to 1440: the view as it was
  const zi = centre(await screenRect(p, '#zoomIn'));
  await p.clickAt(zi.x, zi.y);
  const v0 = await view();
  await size(1440, 900);
  await until(() => p.ev('innerWidth === 1440'), 'the window at 1440');
  await frames(p);
  const v1 = await view();
  assert.deepEqual(v1, v0, 'a moved view is not refitted on a resize');
  noExceptions(rec);
});
