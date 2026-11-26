// The library test files' shared fixture (kit-925): the helpers, libraryOn and the file's one Chrome
// (fileChrome: each test file is a process of its own, so each has its own Chrome). Split from
// test/dashboard-library.test.mjs; test/dashboard-library.viewer.test.mjs is the other half.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PORTS, bareProject, dashboardOnFreePort, dataPatchInit, libraryFixture } from './kit.mjs';
import { canDrive, cleanup, openChrome } from './chrome.mjs';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const INDEX = fs.readFileSync(path.join(here, '..', '..', 'docs', 'devteam', 'dashboard', 'index.html'), 'utf8');
export const block = (src, name) => {
  const a = src.indexOf(`/* ${name} start */`), b = src.indexOf(`/* ${name} end */`);
  assert.ok(a >= 0 && b > a, `the ${name} block is in the page`);
  assert.equal(src.indexOf(`/* ${name} start */`, a + 1), -1, `one ${name} block`);
  return src.slice(a, b + `/* ${name} end */`.length);
};

// ---- in Chrome (kit-92 T2): the page on the shell, the grid in kind order, Kind and Goal in the page bar ----

// the items libraryItems gives for data (the block run in vm, as above), for what the page should draw
export function itemsOf(data, now = Date.now()) {
  const vctx = vm.createContext({ URL, URLSearchParams });
  vm.runInContext(`${block(INDEX, 'preview-cards')}\n${block(INDEX, 'library-items')}\nthis.previewState = previewState; this.libraryItems = libraryItems; this.libraryKeep = libraryKeep;`, vctx);
  const ctx = { previewState: vctx.previewState, artHref: () => '#a', artViewer: () => '/v', pvViewer: () => '/v', fileHref: () => '#f' };
  const items = JSON.parse(JSON.stringify(vctx.libraryItems(data, now, ctx)));
  return { items, keep: (f) => items.filter((x) => vctx.libraryKeep(x, f)).map((x) => x.id) };
}

// The tab's history as the browser has it (its own record, not the page's): each entry's head (its URL's
// hash, or the URL when it has none) and which is current.
export async function tabHistory(p) {
  const h = await p.send('Page.getNavigationHistory');
  return { at: h.currentIndex, heads: h.entries.map((e) => { try { return new URL(e.url).hash || e.url; } catch { return e.url; } }) };
}
// what a timeout reports of the page: its head and the tab's history (kit-775: a Back that never arrived
// said only that it timed out); each read given 3 s, so a hung page can't hold the report back
export async function whereNow(p) {
  const in3s = (x) => Promise.race([x, new Promise((_, no) => setTimeout(() => no(new Error('no answer in 3 s')), 3000).unref())]);
  try { const h = await in3s(tabHistory(p)); return `; the page at ${JSON.stringify(await in3s(p.ev('location.hash')))}, the tab's history ${JSON.stringify(h.heads)} at ${h.at}`; } catch (e) { return `; the page unread: ${e.message}`; }
}
// a wait on a condition in the page
export const soonIn = (p, ms = 20000, server = null) => async (expr, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v, err = null;
    try { v = await p.ev(expr); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out: ${what}${err ? `; last: ${err.message}` : ''}${await whereNow(p)}${server ? `; the server said, last: ${JSON.stringify(String(server()).slice(-600))}` : ''}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};
// Back, as the owner's Back button goes: first the tab's history must hold `from` as its current entry with
// `to` right below it (each entry the test made committed, nothing pushed after it), then one step back, then
// the page at `to` (or, given `landed`, that expression true in the page). ms: how long the history may take.
export async function backTo(p, soon, from, to, what, landed = `location.hash === ${JSON.stringify(to)}`, ms = 20000) {
  const end = Date.now() + ms;
  for (let h = await tabHistory(p); !(h.heads[h.at] === from && h.heads[h.at - 1] === to); h = await tabHistory(p)) {
    if (Date.now() > end) assert.fail(`${what}: the tab's history doesn't end ${JSON.stringify([to, from])}: ${JSON.stringify(h.heads)} at ${h.at}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  await p.ev('history.back()');
  await soon(landed, what);
}

// One Chrome for each test file (kit-925). Each Chrome costs its start and its stop, and on CI's runner image
// 20261122.9.1 each cost about 3 s more; at one per test (40) that took the library file past run.mjs's
// 300 s watchdog. A test still has its own tab, and its own dashboard on its own port, so its own origin, that
// origin's storage cleared before its page loads (a port, and so an origin, can come round again). The tabs
// a test opened are closed after it. A Chrome that has exited is started again for the next test.
// FILE.opened counts the Chromes started.
export const FILE = { chrome: null, opened: 0 };
export async function fileChrome() {
  const c = FILE.chrome;
  if (c && c.proc.exitCode === null && c.proc.signalCode === null) return c;
  FILE.chrome = null;
  if (c) await c.close();
  FILE.opened++;
  return (FILE.chrome = await openChrome());
}
// a Chrome's own endpoint (/json/...), from the port it wrote in its profile
export async function devtoolsOf(chrome) {
  const dir = chrome.proc.spawnargs.find((a) => a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
  const portFile = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; !(fs.existsSync(portFile) && /^\d+\n/.test(fs.readFileSync(portFile, 'utf8'))); i++) {
    if (i > 200) throw new Error('no DevToolsActivePort');
    await new Promise((r) => setTimeout(r, 50));
  }
  return `http://127.0.0.1:${fs.readFileSync(portFile, 'utf8').split('\n')[0]}`;
}
export const tabsOf = async (dt) => (await (await fetch(`${dt}/json/list`)).json()).filter((x) => x.type === 'page').map((x) => x.id);
// close the tabs opened since `had` (the test's own, and any its page opened), and wait until Chrome no
// longer lists them (/json/close answers before the tab is gone). One still listed after 5 s fails the test,
// and takes the file's Chrome with it first, so a wedged tab can't hold the renderer later tests share (the
// last test then fails on the count of Chromes).
export async function closeTabs(dt, had) {
  const mine = (await tabsOf(dt)).filter((id) => !had.has(id));
  await Promise.all(mine.map((id) => fetch(`${dt}/json/close/${id}`).then((r) => r.arrayBuffer())));
  for (let i = 0; ; i++) {
    const left = (await tabsOf(dt)).filter((id) => mine.includes(id));
    if (!left.length) return;
    if (i >= 50) {
      const c = FILE.chrome;
      FILE.chrome = null;
      await c?.close();
      throw new Error(`tabs still open 5 s after their close: ${left.join(', ')}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}
// a page's origin with nothing kept from an earlier test on it
export const freshOrigin = (p, origin) => p.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
// a test's tab in the file's Chrome, for the dashboard on port: the page `page` gives, a box page (box: its
// header, boxPage) or a plain one; its origin (at) cleared before anything loads. { p, at }
export async function tabOn(chrome, port, { box = null, page = null } = {}) {
  const p = page ? await page(chrome, port) : box ? await boxPage(chrome, port, { header: box }) : await chrome.newPage();
  const at = box ? p.origin : `http://127.0.0.1:${port}`;
  await freshOrigin(p, at);
  return { p, at };
}

// The box (kit-92 T3): a page whose requests to http://<n>.box.localhost:<port>/ (Chrome sends *.localhost to
// loopback; the dashboard answers only its own Host) are paused over a second DevTools connection (the helper's
// own drops events) and fulfilled from http://127.0.0.1:<port>, method, body, headers and status passed through,
// with x-devteam-public: <header> added to /api/data's answer, as the gateway adds it. header is the gateway's
// served map, { [project]: { root, port, artifacts: { slug: tree } } }. Its close() closes both connections.
export async function boxPage(chrome, port, { n = 4321, header }) {
  const dt = await devtoolsOf(chrome);
  const list = async () => (await fetch(`${dt}/json/list`)).json();
  const before = new Set((await list()).map((x) => x.id));
  const p = await chrome.newPage();
  const target = (await list()).find((x) => x.type === 'page' && !before.has(x.id));
  assert.ok(target, 'the new page target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('could not reach the page for the proxy')); });
  let seq = 0;
  const waiting = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  // an answer for a page that has gone fails; nothing waits on it
  const quiet = (method, params) => { send(method, params).catch(() => {}); };
  const origin = `http://${n}.box.localhost:${port}`;
  const answer = async ({ requestId, request }) => {
    const u = new URL(request.url);
    const headers = Object.fromEntries(Object.entries(request.headers).filter(([k]) => !/^(host|content-length|connection)$/i.test(k))
      .map(([k, v]) => [k, /^origin$/i.test(k) && v === origin ? `http://127.0.0.1:${port}` : v]));
    try {
      const body = ['GET', 'HEAD'].includes(request.method) ? undefined : request.postData;
      const r = await fetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`, { method: request.method, headers, body, redirect: 'manual' });
      const buf = Buffer.from(await r.arrayBuffer());
      // fetch has decoded the body: its encoding and length go
      const out = [...r.headers].filter(([k]) => !/^(content-encoding|content-length|transfer-encoding|connection)$/i.test(k)).map(([name, value]) => ({ name, value }));
      if (u.pathname === '/api/data') out.push({ name: 'x-devteam-public', value: JSON.stringify(header) });
      quiet('Fetch.fulfillRequest', { requestId, responseCode: r.status, responseHeaders: out, body: buf.toString('base64') });
    } catch { quiet('Fetch.failRequest', { requestId, errorReason: 'Failed' }); }
  };
  ws.onmessage = (m) => {
    const o = JSON.parse(m.data);
    if (o.id !== undefined) { const w = waiting.get(o.id); if (!w) return; waiting.delete(o.id); if (o.error) w.reject(new Error(o.error.message)); else w.resolve(o.result); return; }
    if (o.method === 'Fetch.requestPaused') answer(o.params);
  };
  ws.onclose = () => { for (const [id, w] of waiting) { waiting.delete(id); w.reject(new Error('the proxy connection closed')); } };
  await send('Fetch.enable', { patterns: [{ urlPattern: `${origin}/*` }] });
  const close = p.close;
  return { ...p, origin, close: () => { try { ws.close(); } catch {} close(); } };
}
// what a box page's window.__errors holds but the /presence socket's (not proxied)
export const ERRORS = "window.__errors.filter((e) => !/presence|websocket/i.test(e))";

// A bare project (every Library record comes from the patch), its env with its own HOME and every
// DEVTEAM_* but the ports unset; the dashboard on it and Chrome with init: { p, soon, port, go }. box: the
// gateway's served map, and the page is at http://4321.box.localhost:<port>/ through boxPage. page: a
// function (chrome, port) giving the page instead (tapPage). setup(root, env): run on the bare project before
// the dashboard starts, its result given back as made; box may then be a function (made, port) giving the header.
export async function libraryOn(t, { width = 1440, height = 900, init, box = null, page = null, setup = null } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-library-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const root = bareProject(base, 'library');
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 66), DEVTEAM_PORT_BASE: String(PORTS + 67), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && !['DEVTEAM_HUB_PORT', 'DEVTEAM_PORT_BASE'].includes(k)) delete env[k];
  for (const k of ['TMUX', 'TMUX_PANE']) delete env[k];
  const made = setup ? setup(root, env) : null;
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await fileChrome();
  const dt = await devtoolsOf(chrome);
  const had = new Set(await tabsOf(dt));
  later(() => closeTabs(dt, had));
  if (typeof box === 'function') box = box(made, port);
  const { p, at } = await tabOn(chrome, port, { box, page });
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  if (init) await p.send('Page.addScriptToEvaluateOnNewDocument', { source: init });
  const soon = soonIn(p, 20000, () => dash.out());
  const loaded = "!document.querySelector('main.waiting') && typeof DATA !== 'undefined' && !!DATA";
  // a fresh document at a head (from about:blank, so a head that differs only in its hash loads anew)
  const go = async (hash) => {
    await p.send('Page.navigate', { url: 'about:blank' });
    await soon("location.href === 'about:blank'", 'about:blank');
    await p.send('Page.navigate', { url: `${at}/${hash}` });
    // and loaded (kit-784): until the load event, Chrome makes a script's hash change with no user gesture (every
    // p.ev here) replace the entry rather than add one, so a Back or a close after it would land off the page
    // a test with its own request tap (page) holds a request of the page on purpose, so its load may never come: it keeps the old wait
    await soon(page ? loaded : `document.readyState === 'complete' && ${loaded}`, 'the page with its data');
  };
  return { p, soon, port, go, at, made, box };
}

export const CHROME = { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' };
// the page bar's filters: a control by its data-f, a pick (its change event, as the owner's choice makes)
export const ctl = (f) => `document.querySelector('.pagebar .extra [data-f="${f}"]')`;
export const pick = (p, f, v) => p.ev(`(() => { const s = ${ctl(f)}; s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
export const EXTRA = "[...document.querySelectorAll('.pagebar .extra select, .pagebar .extra button, .pagebar .extra input')].map((c) => c.dataset.f)";
// the hash, its query read back (so the test doesn't lean on how a value is escaped)
export const HEAD = "(() => { const h = location.hash, i = h.indexOf('?'); return { page: h.slice(1, i < 0 ? h.length : i), q: Object.fromEntries(new URLSearchParams(i < 0 ? '' : h.slice(i + 1))) }; })()";
// the grid's cards by id, in order
export const IDS = "[...document.querySelectorAll('#lib-grid > .lib-card')].map((c) => c.dataset.libId)";
export const idsAre = (xs) => `JSON.stringify(${IDS}) === ${JSON.stringify(JSON.stringify(xs))}`;
// an init (after dataPatchInit) that counts the page's /api/data reads
export const READS_INIT = `(() => {
  window.__dataReads = 0;
  const f = window.fetch;
  window.fetch = (u, o) => { if (String(u && u.url ? u.url : u).startsWith('/api/data')) window.__dataReads++; return f(u, o); };
})();`;
export const card = (id) => `document.querySelector('#lib-grid > .lib-card[data-lib-id="${id}"]')`;

// ---- in Chrome (kit-92 T3): the card: head, badges, details, menu and actions; box states through boxPage ----

// the page at #library with every card drawn, localStorage cleared first
export async function libraryAll(t, opts = {}) {
  const fx = opts.fx ?? libraryFixture();
  const { items } = itemsOf(fx.patch);
  const on = await libraryOn(t, { ...opts, init: `${dataPatchInit(fx.patch)}${opts.init ? `\n${opts.init}` : ''}` });
  await on.go('#library');
  await on.p.ev('localStorage.clear()');
  await on.go('#library');
  await on.soon(idsAre(items.map((x) => x.id)), 'a card per item');
  return { ...on, ...fx, items };
}
// the gateway's served map for libraryFixture, as x-devteam-public carries it
export const servedOf = (ids) => ({ [ids.project]: { root: ids.root, port: 4321, artifacts: ids.served } });
// an artifact card by slug, in the page
export const art = (slug) => card(`artifact:${slug}`);

// an init after dataPatchInit: the server refuses POST /api/artifact-publish with 400 {"error":"no"}
export const FORGET_FAILS = `(() => {
  const f = window.fetch;
  window.fetch = (u, o) => (String(u && u.url ? u.url : u).startsWith('/api/artifact-publish') && String(o?.method || 'GET').toUpperCase() === 'POST'
    ? Promise.resolve(new Response(JSON.stringify({ error: 'no' }), { status: 400, headers: { 'content-type': 'application/json' } })) : f(u, o));
})();`;

// ---- in Chrome (kit-92 T4): thumbnails: sandboxed frames in view, at most 12, the icon after 5 s ----

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A page with a second DevTools connection that hears its events (the helper's own drops them): Fetch on
// patterns, each paused request given to paused(params, reply), reply(method, params) answering on the
// session it came from; children: also auto-attached to child frame targets (flatten), Fetch on each, so a
// sandboxed frame in its own process is held too. Its close() closes both connections.
export async function tapPage(chrome, { patterns, paused, children = false }) {
  const dt = await devtoolsOf(chrome);
  const list = async () => (await fetch(`${dt}/json/list`)).json();
  const before = new Set((await list()).map((x) => x.id));
  const p = await chrome.newPage();
  const target = (await list()).find((x) => x.type === 'page' && !before.has(x.id));
  assert.ok(target, 'the new page target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('could not reach the page for the tap')); });
  let seq = 0;
  const waiting = new Map();
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const quiet = (method, params, sessionId) => { send(method, params, sessionId).catch(() => {}); };
  const attach = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true };
  const sessions = [];
  ws.onmessage = (m) => {
    const o = JSON.parse(m.data);
    if (o.id !== undefined) { const w = waiting.get(o.id); if (!w) return; waiting.delete(o.id); if (o.error) w.reject(new Error(o.error.message)); else w.resolve(o.result); return; }
    if (o.method === 'Fetch.requestPaused') paused(o.params, (method, params) => quiet(method, params, o.sessionId));
    if (o.method === 'Target.attachedToTarget' && children) {
      const s = o.params.sessionId;
      sessions.push(o.params.targetInfo);
      quiet('Fetch.enable', { patterns }, s);
      quiet('Target.setAutoAttach', attach, s);
    }
  };
  ws.onclose = () => { for (const [id, w] of waiting) { waiting.delete(id); w.reject(new Error('the tap connection closed')); } };
  await send('Fetch.enable', { patterns });
  if (children) await send('Target.setAutoAttach', attach);
  const close = p.close;
  return { ...p, sessions, close: () => { try { ws.close(); } catch {} close(); } };
}
// an init that records every thumbnail frame put in and taken out, with the page's clock: window.__frames,
// { id: its card's, in, out }, and each box's data-thumb change: window.__states, { id, v, t }
export const FRAMES_INIT = `(() => {
  window.__frames = [];
  window.__states = [];
  const frames = (n) => (n.nodeName === 'IFRAME' ? [n] : n.querySelectorAll ? [...n.querySelectorAll('iframe')] : []);
  new MutationObserver((ms) => {
    const t = performance.now();
    for (const m of ms) {
      if (m.type === 'attributes') { window.__states.push({ id: m.target.closest('.lib-card')?.dataset.libId ?? null, v: m.target.dataset.thumb ?? null, t }); continue; }
      for (const n of m.addedNodes) for (const f of frames(n)) if (f.parentElement?.classList.contains('lib-thumb')) window.__frames.push({ el: f, id: f.closest('.lib-card')?.dataset.libId ?? null, in: t });
      for (const n of m.removedNodes) for (const f of frames(n)) { const r = window.__frames.find((x) => x.el === f); if (r && r.out === undefined) r.out = t; }
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-thumb'] });
})();`;
export const FRAMES = "window.__frames.map(({ id, in: a, out }) => ({ id, in: a, out: out ?? null }))";
// what is in view (the window scrolls): the boxes intersecting it, those with a frame source, the frames
export const VIEW = `(() => {
  const H = innerHeight, inv = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < H; };
  const boxes = [...document.querySelectorAll('#lib-grid .lib-thumb')], id = (b) => b.closest('.lib-card').dataset.libId;
  return { frames: document.querySelectorAll('#lib-grid .lib-thumb iframe').length, inView: boxes.filter(inv).map(id), srcInView: boxes.filter((b) => inv(b) && b.dataset.thumbSrc).length,
    holding: boxes.filter((b) => b.querySelector('iframe')).map((b) => ({ id: id(b), inView: inv(b) })) };
})()`;
// the page at #library once, every card drawn (a fresh profile: no remembered filter)
export async function libraryOnce(t, fx, opts = {}) {
  const { items } = itemsOf(fx.patch);
  const on = await libraryOn(t, { ...opts, init: `${dataPatchInit(fx.patch)}${opts.init ? `\n${opts.init}` : ''}` });
  await on.go('#library');
  await on.soon(idsAre(items.map((x) => x.id)), 'a card per item');
  return { ...on, ...fx, items };
}
export const thumb = (id) => `${card(id)}.querySelector('.lib-thumb')`;

// ---- in Chrome (kit-92 T5): an item's side peek, properties first ----

// the peek as drawn: shown, its bar's type badge and title, its properties (dt, dd text, dd's links), what follows them
export const PEEK = `(() => { const d = document.getElementById('drawer'), b = document.getElementById('drawer-body');
  const dl = b.querySelector('section.attrs > dl.props');
  const rows = dl ? [...dl.querySelectorAll(':scope > dt')].map((dt) => { const dd = dt.nextElementSibling; return [dt.textContent, dd.textContent, [...dd.querySelectorAll('a')].map((a) => a.getAttribute('href'))]; }) : [];
  const after = dl ? [...b.querySelector('section.attrs').parentElement.children].filter((e) => b.querySelector('section.attrs').compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING) : [];
  return { shown: !d.hidden, type: document.querySelector('#drawer-bar-title .dtype .badge')?.textContent ?? null, title: document.querySelector('#drawer-bar-title .dtitle')?.textContent ?? null, rows,
    thumb: after[0]?.matches('.lib-thumb') ?? false, thumbW: after[0] ? Math.round(after[0].getBoundingClientRect().width) : 0, bodyW: Math.round(b.clientWidth - parseFloat(getComputedStyle(b).paddingLeft) - parseFloat(getComputedStyle(b).paddingRight)),
    measure: after[1]?.matches('.measure') ? after[1].textContent : null }; })()`;
// the properties' order: each row a peek can have, in the spec's order; a link's (its Kind the item's Kind row) Where, For, Notes
export const LIB_ORDER = ['ID', 'Kind', 'Drawn by', 'For', 'Where', 'State', 'Published', 'Error', 'Updated', 'How it changes'];
export const LINK_ORDER = ['ID', 'Kind', 'Where', 'For', 'Notes', 'Updated', 'How it changes'];

// counts the page's /api/peek requests (after dataPatchInit and READS_INIT)
export const PEEK_REQS_INIT = `(() => {
  window.__peekReqs = [];
  const f = window.fetch;
  window.fetch = (u, o) => { const s = String(u && u.url ? u.url : u); if (s.startsWith('/api/peek')) window.__peekReqs.push(s); return f(u, o); };
})();`;

// ---- in Chrome (kit-92 T6): the viewer bar: the version pill, Reload, the Public tile, Start and Stop ----

export const VERS = 'vers-mock', VERS_WT = 'demo-01-draft', VERS_TITLE = 'Vers mock';
export const versFiles = (n) => ({
  'artifact.json': JSON.stringify({ v: 1, title: VERS_TITLE, summary: 'A page with versions', by: 'supervisor', for: [] }),
  'index.html': `<!doctype html><html><head><meta charset="utf-8"><title>v${n}</title></head><body><p>v${n}</p></body></html>\n`,
});
export const putFiles = (dir, files) => { fs.mkdirSync(dir, { recursive: true }); for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), text); };
// libraryOn's setup: settings.md's project set (kit92, edited in place as peekFixture edits it), vers-mock landed on
// main in three commits and drafted in a worktree's folder under .worktrees/ (as artifact-versions.test.mjs builds
// one); its versions as the CLI lists them, the realpath of the project, the draft's folder
export function versProject(root, env) {
  const sf = path.join(root, 'docs/devteam/project/settings.md');
  const s = fs.readFileSync(sf, 'utf8');
  assert.ok(s.includes('"gates": {}'), 'settings.md as init writes it');
  fs.writeFileSync(sf, s.replace('"gates": {}', '"project": "kit92", "gates": {}'));
  const dir = path.join(root, 'docs/devteam/project/artifacts', VERS);
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: root, encoding: 'utf8' }).trim();
  for (const n of [1, 2, 3]) { putFiles(dir, versFiles(n)); git('add', '-A', dir); git('commit', '-qm', `${VERS} v${n}`); }
  const draft = path.join(root, '.worktrees', VERS_WT, 'docs/devteam/project/artifacts', VERS);
  putFiles(draft, versFiles('d'));
  const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), 'artifact', 'versions', VERS, '--json'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const versions = JSON.parse(r.stdout).versions;
  assert.deepEqual(versions.map((v) => v.kind), ['draft', 'landed', 'earlier', 'earlier'], 'a draft, main\'s and two earlier');
  return { root: fs.realpathSync(root), versions, draft };
}
// the dataPatchInit pattern, merging instead of replacing (so the served vers-mock stays): window.__fx.previews
// appended to the served library.previews, and window.__fx.published (when the key is there) put on vers-mock's
// landed row; read on every answer, so a test changes it in the page
export const libraryMergeInit = ({ previews = [], published } = {}) => `(() => {
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => si(f, ms === 10000 ? 300 : ms, ...a);
  window.__fx = ${JSON.stringify({ previews, ...(published !== undefined ? { published } : {}) })};
  window.__errors = [];
  window.addEventListener('error', (e) => window.__errors.push(String(e.message || e.error || e)));
  window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason && e.reason.message || e.reason)));
  const real = window.fetch;
  window.fetch = async (u, o) => {
    const url = String(u && u.url ? u.url : u);
    const method = String(o?.method || 'GET').toUpperCase();
    const r = await real(u, o);
    const fx = window.__fx;
    if (method !== 'GET' || !r.ok || !url.startsWith('/api/data')) return r;
    const d = await r.json();
    const lib = d.library || {};
    d.library = { ...lib, previews: [...(lib.previews || []), ...(fx.previews || [])] };
    if ('published' in fx) d.library.artifacts = (lib.artifacts || []).map((a) => (a.slug === ${JSON.stringify(VERS)} && a.at === 'main' ? { ...a, published: fx.published } : a));
    return new Response(JSON.stringify(d), { status: r.status, statusText: r.statusText, headers: r.headers });
  };
})();`;
// /api/artifact-versions asks counted (window.__versReads); window.__versFail answers them 500
export const VERS_INIT = `(() => {
  window.__versReads = 0;
  window.__versFail = false;
  const f = window.fetch;
  window.fetch = (u, o) => {
    if (String(u && u.url ? u.url : u).startsWith('/api/artifact-versions')) {
      window.__versReads++;
      if (window.__versFail) return Promise.resolve(new Response('{"error":"down"}', { status: 500, headers: { 'content-type': 'application/json' } }));
    }
    return f(u, o);
  };
})();`;
// /api/preview-start answered by the page: window.__start's status (400 refuses with "no", 200 takes it)
export const START_INIT = `(() => {
  window.__start = 400;
  window.__starts = 0;
  const f = window.fetch;
  window.fetch = (u, o) => {
    if (!String(u && u.url ? u.url : u).startsWith('/api/preview-start')) return f(u, o);
    window.__starts++;
    return Promise.resolve(new Response(JSON.stringify(window.__start === 200 ? { ok: true } : { error: 'no' }), { status: window.__start, headers: { 'content-type': 'application/json' } }));
  };
})();`;
export async function versOn(t, { previews = [], published, init = '', ...rest } = {}) {
  return libraryOn(t, { ...rest, setup: versProject, init: `${libraryMergeInit({ previews, published })}\n${READS_INIT}\n${VERS_INIT}${init ? `\n${init}` : ''}` });
}
// whether an element by id is there and drawn
export const shown = (id) => `(() => { const e = document.getElementById(${JSON.stringify(id)}); return !!e && e.getClientRects().length > 0; })()`;
export const VIEWING = "!document.getElementById('artifact-view').hidden";
export const frameIs = (src) => `${VIEWING} && document.getElementById('av-frame').getAttribute('src') === ${JSON.stringify(src)}`;
// the version list's options
export const OPTS = "[...document.querySelectorAll('#av-vers [role=option]')].map((o) => ({ at: o.dataset.at, text: o.textContent.trim() }))";
export const LIST_OPEN = "!document.getElementById('av-vers').hidden";
export const BAR = `(() => { const g = (id) => document.getElementById(id); return { title: g('av-title').textContent, where: g('av-where').textContent, note: g('av-note').hidden ? null : g('av-note').textContent,
  reload: ${shown('av-reload')}, pub: ${shown('av-pub')}, list: !g('av-vers').hidden }; })()`;
// a colour token as this scheme resolves it
export const tokenColor = (p, token) => p.ev(`(() => { const e = document.createElement('span'); e.style.color = 'var(${token})'; document.getElementById('artifact-view').append(e); const c = getComputedStyle(e).color; e.remove(); return c; })()`);
export const polls = async (p, soon, n = 2) => { const k = await p.ev('window.__dataReads'); await soon(`window.__dataReads >= ${k + n}`, `${n} polls`); };
export const cardTitle = (slug) => `[data-lib-id="artifact:${slug}"] .lib-title`;

// the last test of each library file (kit-925): one Chrome for the file, no tab left behind, a reused
// origin starts empty, a closed tab gone when closeTabs returns
export async function oneChrome(t) {
  assert.ok(FILE.opened <= 1, `one Chrome for every test before this one, not ${FILE.opened}`);
  if (FILE.chrome) assert.deepEqual((await tabsOf(await devtoolsOf(FILE.chrome))).length, 1, 'no tab left but the one Chrome opened with');
  const { p, go, at, port } = await libraryOn(t);
  await go('#library');
  assert.equal(await p.ev("(localStorage.setItem('kit-925', 'kept'), localStorage.getItem('kit-925'))"), 'kept');
  // a second tab on the same dashboard, so the same origin, made as libraryOn makes one: its storage starts empty
  const { p: q, at: qAt } = await tabOn(FILE.chrome, port);
  try {
    assert.equal(qAt, at, 'the same origin');
    await q.send('Page.navigate', { url: `${at}/` });
    const got = await soonIn(q)("document.readyState === 'complete' && location.origin !== 'null' && JSON.stringify(localStorage.getItem('kit-925'))", 'the second tab on the origin');
    assert.equal(got, 'null', 'nothing kept from the earlier page');
  } finally { q.close(); }
  // closeTabs returns only once Chrome no longer lists what it closed (Chrome answers /json/close before the tab
  // goes, at its own pace): against a DevTools stand-in that lists a closed tab for two more looks
  const listed = new Set(['before', 'mine']);
  let looks = 0, closedAt = null;
  const stand = http.createServer((req, res) => {
    if (req.url === '/json/list') {
      looks++;
      if (closedAt !== null && looks - closedAt > 2) listed.delete('mine');
      res.end(JSON.stringify([...listed].map((id) => ({ id, type: 'page' }))));
    } else if (req.url === '/json/close/mine') { closedAt = looks; res.end('Target is closing'); } else { res.statusCode = 404; res.end(); }
  });
  await new Promise((resolve) => stand.listen(0, '127.0.0.1', resolve));
  try {
    await closeTabs(`http://127.0.0.1:${stand.address().port}`, new Set(['before']));
    assert.equal(closedAt, 1, 'closeTabs closed the tab it opened');
    assert.ok(!listed.has('mine'), 'closeTabs returned only once the closed tab was no longer listed');
  } finally { stand.close(); }
  assert.equal(FILE.opened, 1, 'still the one Chrome');
}
