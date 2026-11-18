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
import { startCanvasFake } from './lib/canvas-fake.mjs';
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
