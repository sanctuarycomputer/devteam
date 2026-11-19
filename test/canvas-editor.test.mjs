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
// otherwise; dialogs recorded and dismissed; exceptions recorded.
async function recorder(ws, origin, answer) {
  let seq = 0;
  const waiting = new Map();
  const rec = { urls: new Set(), dialogs: [], exceptions: [], send: null };
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
      if (a) {
        const body = Buffer.from(typeof a.body === 'string' ? a.body : JSON.stringify(a.body ?? null)).toString('base64');
        quiet('Fetch.fulfillRequest', { requestId, responseCode: a.status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body });
      } else if (url === origin || url.startsWith(`${origin}/`)) quiet('Fetch.continueRequest', { requestId });
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

test('loads the document and lists the pages', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 120000 }, async (t) => {
  const { p, origin, rec } = await open(t, { canvases: { every: EVERY }, images: { every: { [IMG_FILE]: IMG } } });
  assert.equal(await state(p), 'ready');
  assert.ok(rec.urls.has(`${origin}/api/canvas/doc?slug=every`), `the doc request, among ${[...rec.urls].join(' ')}`);
  assert.deepEqual(await p.ev("[...document.querySelectorAll('#pages a[data-page]')].map((a) => a.textContent)"), ['Checkout', 'Parts']);
  assert.deepEqual(await p.ev("[...document.querySelectorAll('#pages a[data-page]')].map((a) => a.dataset.page)"), EVERY.pages.map((x) => x.id));
  assert.equal(await p.ev("document.querySelector('#pages a[aria-current=\"page\"]')?.textContent"), 'Checkout');
  assert.equal(await text(p, '#title'), 'every');
  assert.equal(await shown(p, '#msg'), false, 'no stage message on a page with nodes');
  assert.deepEqual(rec.exceptions, []);
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
      const { p } = await open(st, { canvases: { minimal: MINIMAL }, repo });
      assert.equal(await state(p), 'ready');
      assert.equal(await text(p, '#repoChip'), chip);
      assert.equal(await p.ev("document.getElementById('repoChip').classList.contains('public')"), amber);
      assert.equal(await shown(p, '#repoChip'), true);
      assert.equal(await p.ev("document.getElementById('repoChip').title"), `Every edit is committed and pushed to ${repo.name ?? "this project's repo"}.`);
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
  });
  await t.test('C1.11 a slug the server does not have', async (st) => {
    const { p, origin, rec } = await open(st, { canvases: { every: EVERY }, images: { every: { [IMG_FILE]: IMG } }, path: '/view/canvas/nope' });
    assert.equal(await state(p), 'error');
    assert.equal(await msg(p), "This canvas isn't open for editing.");
    assert.ok(rec.urls.has(`${origin}/api/canvas/doc?slug=nope`));
  });
  await t.test('C1.11 a 500', async (st) => {
    const { p } = await open(st, { canvases: { every: EVERY }, images: { every: { [IMG_FILE]: IMG } }, answer: (u) => (isDoc(u) ? { status: 500, body: '{"why":"boom"}' } : null) });
    assert.equal(await state(p), 'error');
    assert.equal(await msg(p), "This canvas couldn't be loaded. (500)");
  });
  await t.test('C1.11 a 200 that is not a doc-response', async (st) => {
    const { p } = await open(st, { canvases: { every: EVERY }, images: { every: { [IMG_FILE]: IMG } }, answer: (u) => (isDoc(u) ? { status: 200, body: {} } : null) });
    assert.equal(await state(p), 'error');
    assert.equal(await msg(p), "This canvas couldn't be loaded. (200)");
    assert.deepEqual(await p.ev("[...document.querySelectorAll('#pages a')].length"), 0);
  });
  await t.test('C1.11 an empty page', async (st) => {
    const { p, rec } = await open(st, { canvases: { minimal: MINIMAL } });
    assert.equal(await state(p), 'ready');
    assert.equal(await msg(p), 'This page is empty.');
    assert.equal(await p.ev("!!document.getElementById('surface')"), true);
    assert.deepEqual(await p.ev("[...document.querySelectorAll('#pages a[data-page]')].map((a) => a.textContent)"), ['Page 1']);
    assert.deepEqual(rec.exceptions, []);
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
  assert.deepEqual(rec.exceptions, []);

  await t.test('C1.7 a bool prop beats every earlier level', async (st) => {
    const off = structuredClone(EVERY);
    off.nodes.buy.props.enabled = false;
    const o = await open(st, { canvases: { 'every-off': off }, images: EVERY_IMAGES('every-off') });
    assert.equal(await state(o.p), 'ready');
    assert.equal(await css(o.p, '[data-of="buy"][data-src="button-bg"]', 'display'), 'none');
    assert.notEqual(await css(o.p, '[data-of="buy"][data-src="button-label"]', 'display'), 'none');
    assert.deepEqual(o.rec.exceptions, []);
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
  assert.deepEqual(rec.exceptions, []);
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
  assert.deepEqual(rec.exceptions, []);
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
  assert.deepEqual(rec.exceptions, []);
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
  assert.deepEqual(rec.exceptions, []);
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
  await rec.send('Network.enable');
  await rec.send('Network.setCacheDisabled', { cacheDisabled: true });
  await p.ev(`(async () => {
    const go = (id) => new Promise((r) => { addEventListener('hashchange', r, { once: true }); location.hash = '#page=' + id; });
    await go('p-main');
    await go('p-parts');
    await go('p-main');
    await go('p-parts');
    await go('p-main');
  })()`);
  await until(() => p.ev("document.body.dataset.state === 'ready'"), 'ready after the fast switches');
  assert.deepEqual(await current(), ['Checkout']);
  assert.equal(await count(p, '#surface [data-id="card"]'), 1);
  assert.equal(await count(p, '#surface [data-id="button"]'), 0);
  assert.equal(await count(p, '#surface img'), 1);
  assert.equal(await p.ev("(() => { const i = document.querySelector('#surface img'); return i.complete && i.naturalWidth > 0; })()"), true, 'the image loaded');
  assert.equal(await p.ev("document.getElementById('pageSel').value"), 'p-main');
  assert.deepEqual(rec.exceptions, []);
});
