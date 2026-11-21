// The Library card's ⋯ menu publish group and its desktop thumbnail (kit-751), in real headless Chrome over a
// real dashboard on a bare project whose /api/data is patched in the page with libraryFixture() (skipped where
// Chrome can't run). The box tests reach the page at http://4321.box.localhost:<port>/ through boxPage, a copy of
// test/dashboard-library.test.mjs's own (it lives in that test file, and importing a test file runs its tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORTS, bareProject, dashboardOnFreePort, dataPatchInit, libraryFixture } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const CHROME = { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' };

// a wait on a condition in the page
const soonIn = (p, ms = 20000) => async (expr, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v, err = null;
    try { v = await p.ev(expr); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out: ${what}${err ? `; last: ${err.message}` : ''}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

// The box, as test/dashboard-library.test.mjs's boxPage: requests to http://<n>.box.localhost:<port>/ are paused
// over a second DevTools connection and fulfilled from http://127.0.0.1:<port>, with x-devteam-public: <header>
// added to /api/data's answer, as the gateway adds it.
async function boxPage(chrome, port, { n = 4321, header }) {
  const dir = chrome.proc.spawnargs.find((a) => a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
  const portFile = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; !(fs.existsSync(portFile) && /^\d+\n/.test(fs.readFileSync(portFile, 'utf8'))); i++) {
    if (i > 200) throw new Error('no DevToolsActivePort');
    await new Promise((r) => setTimeout(r, 50));
  }
  const dt = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const list = async () => (await fetch(`http://127.0.0.1:${dt}/json/list`)).json();
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

// The page at #library over a bare project (its own HOME, every DEVTEAM_* but the ports unset) with fx's patch,
// every card drawn; box: the gateway's served map, the page then on 4321.box.localhost through boxPage.
async function libraryAt(t, { fx = libraryFixture(), box = null, width = 1440, height = 900, init = '' } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-libmenu-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const root = bareProject(base, 'library');
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 66), DEVTEAM_PORT_BASE: String(PORTS + 67), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && !['DEVTEAM_HUB_PORT', 'DEVTEAM_PORT_BASE'].includes(k)) delete env[k];
  for (const k of ['TMUX', 'TMUX_PANE']) delete env[k];
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = box ? await boxPage(chrome, port, { header: box }) : await chrome.newPage();
  later(() => p.close());
  const at = box ? p.origin : `http://127.0.0.1:${port}`;
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `${dataPatchInit(fx.patch)}\n${init}` });
  const soon = soonIn(p);
  await p.send('Page.navigate', { url: `${at}/#library` });
  await soon("!document.querySelector('main.waiting') && typeof DATA !== 'undefined' && !!DATA", 'the page with its data');
  await soon("document.querySelectorAll('#lib-grid > .lib-card').length > 0", 'the cards');
  return { p, soon, port, ...fx };
}

// the gateway's served map for libraryFixture, as x-devteam-public carries it
const servedOf = (ids) => ({ [ids.project]: { root: ids.root, port: 4321, artifacts: ids.served } });
const card = (id) => `document.querySelector('#lib-grid > .lib-card[data-lib-id="${id}"]')`;
const art = (slug) => card(`artifact:${slug}`);
// a card's publish group: [label, tag, href, target, rel, disabled] per item
const group = (id) => `(() => { const g = ${card(id)}.querySelector('.card-head details.menu .lib-menu-pub'); return g ? [...g.querySelectorAll(':scope > a, :scope > button')].map((e) => [e.textContent.trim(), e.tagName.toLowerCase(), e.getAttribute('href'), e.getAttribute('target'), e.getAttribute('rel'), e.disabled ?? false]) : null; })()`;
// the cards that have no landed row, or a broken one, or aren't artifacts
const noGroup = (ids, patch) => [
  `artifact:${ids.draftOnly}`, `artifact:${ids.broken}`,
  ...patch.library.previews.map((x) => `preview:${x.name}`),
  ...patch.library.links.map((l) => `link:${l.id}`),
  `review:${ids.reviewQ}`, `review:${ids.reviewQ2}`,
];
// non-GET requests the page makes but the Library's own ask of the fetch (artRemotePing)
const POSTS = `(() => {
  window.__posts = [];
  const f = window.fetch;
  window.fetch = (u, o) => { const url = String(u && u.url ? u.url : u), m = String(o?.method || (u && u.method) || 'GET').toUpperCase(); if (m !== 'GET' && m !== 'HEAD' && !url.startsWith('/api/artifact-remote')) window.__posts.push(m + ' ' + url); return f(u, o); };
})();`;

test('library menu publish: each landed card\'s ⋯ lists its publish actions, each the gateway\'s confirm page in a new tab', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { p, soon, port, ids, patch } = await libraryAt(t, { fx, box: servedOf(fx.ids), init: POSTS });
  assert.equal(await p.ev("!!PUBLIC && location.host.startsWith('4321.box.localhost')"), true, 'on the box');
  await soon(`!!${art(ids.public)}`, 'the public card');
  const box = `http://box.localhost:${port}`;
  const pubUrl = (slug) => `${box}/public/publish?port=4321&slug=${slug}`;
  const unpubUrl = (slug) => `${box}/public/unpublish?port=4321&project=${ids.project}&slug=${slug}`;
  const tab = (label, href) => [label, 'a', href, '_blank', 'noopener noreferrer', false];
  const want = {
    [ids.docs]: [tab('Publish', pubUrl(ids.docs))],
    [ids.drafted]: [tab('Publish', pubUrl(ids.drafted))],
    [ids.public]: [['Copy public link', 'button', null, null, null, false], tab('Unpublish', unpubUrl(ids.public))],
    [ids.pubUpdate]: [tab('Update', pubUrl(ids.pubUpdate)), ['Copy public link', 'button', null, null, null, false], tab('Unpublish', unpubUrl(ids.pubUpdate))],
    [ids.notLive]: [tab('Restore', pubUrl(ids.notLive)), ['Forget', 'button', null, null, null, false]],
    [ids.drift]: [tab('Restore', pubUrl(ids.drift)), ['Forget', 'button', null, null, null, false]],
  };
  for (const [slug, items] of Object.entries(want)) assert.deepEqual(await p.ev(group(`artifact:${slug}`)), items, `${slug}: its publish group`);
  // Copy public link and Forget as today
  assert.equal(await p.ev(`${art(ids.public)}.querySelector('.lib-menu-pub [data-copy]').dataset.copy`), `http://public.box.localhost:${port}/${ids.project}/${ids.public}/`);
  assert.equal(await p.ev(`${art(ids.notLive)}.querySelector('.lib-menu-pub [data-forget]').dataset.forget`), ids.notLive);
  for (const id of noGroup(ids, patch)) assert.equal(await p.ev(group(id)), null, `${id}: no publish group`);
  // the body keeps its words and error span; Restore left it
  assert.equal(await p.ev(`[...${art(ids.notLive)}.querySelectorAll('.lib-body a')].some((a) => a.textContent === 'Restore')`), false, 'no Restore in the body');
  assert.equal(await p.ev(`${art(ids.notLive)}.querySelector('.lib-body .lib-pub #e-pub-${ids.notLive}') !== null`), true, 'its error span');
  assert.match(await p.ev(`${art(ids.notLive)}.querySelector('.lib-body .lib-pub').textContent`), /recorded .+ from the dashboard/);
  // nothing publishes by itself: a click on each kind of link posts nothing and leaves the page where it is
  const here = await p.ev('location.href');
  for (const [slug, label] of [[ids.docs, 'Publish'], [ids.pubUpdate, 'Update'], [ids.public, 'Unpublish'], [ids.notLive, 'Restore']]) {
    const c = `[data-lib-id="artifact:${slug}"]`;
    await p.click(`${c} .card-head details.menu > summary`);
    await soon(`document.querySelector('${c} .card-head details.menu').open`, `${slug}: ⋯ open`);
    const k = (await p.ev(group(`artifact:${slug}`))).findIndex((x) => x[0] === label) + 1;
    await p.click(`${c} .lib-menu-pub > :nth-child(${k})`);
    await new Promise((r) => setTimeout(r, 300));
    await p.ev(`document.querySelector('${c} .card-head details.menu').open = false`);
  }
  assert.deepEqual(await p.ev('window.__posts'), [], 'no request but GETs');
  assert.equal(await p.ev('location.href'), here, 'the page stays');
});

test('library menu off gateway: a disabled Publish that says where publishing works, never a dead link', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { p, soon, ids, patch } = await libraryAt(t, { fx });
  assert.equal(await p.ev('PUBLIC'), null, 'off the gateway');
  await soon(`!!${art(ids.public)}`, 'the public card');
  const off = [['Publish', 'button', null, null, null, true]];
  const words = "Publishing works only when this dashboard is opened at the box's address.";
  const good = patch.library.artifacts.filter((a) => a.at === 'main' && !a.error).map((a) => a.slug);
  assert.ok(good.length >= 5, 'several landed cards');
  for (const slug of good) {
    assert.deepEqual(await p.ev(group(`artifact:${slug}`)), off, `${slug}: a disabled Publish`);
    assert.equal(await p.ev(`${art(slug)}.querySelector('.lib-menu-pub').textContent.replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})`), true, `${slug}: its words`);
    assert.equal(await p.ev(`${art(slug)}.querySelector('.lib-menu-pub a[href]')`), null, `${slug}: no link`);
  }
  for (const id of noGroup(ids, patch)) assert.equal(await p.ev(group(id)), null, `${id}: no publish group`);
});

test('library thumb desktop: a frame lays the page out at 1280 px and is scaled to its box', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { p, soon, ids } = await libraryAt(t, { fx });
  await soon("document.querySelectorAll('#lib-grid .lib-thumb > iframe').length > 0", 'a thumbnail frame');
  const measure = `[...document.querySelectorAll('#lib-grid .lib-thumb > iframe')].map((f) => { const b = f.parentElement, r = f.getBoundingClientRect(), q = b.getBoundingClientRect(), s = getComputedStyle(f);
    const m = /^matrix\\(([^)]+)\\)$/.exec(s.transform), v = m ? m[1].split(',').map(Number) : null;
    return { w: f.offsetWidth, h: f.offsetHeight, bw: b.clientWidth, bh: b.clientHeight, k: v && v[1] === 0 && v[2] === 0 && Math.abs(v[0] - v[3]) < 1e-6 ? v[0] : null,
      fills: Math.abs(r.width - b.clientWidth) <= 1 && Math.abs(r.height - b.clientHeight) <= 1 && Math.abs(r.left - q.left - b.clientLeft) <= 1 && Math.abs(r.top - q.top - b.clientTop) <= 1,
      sandbox: f.getAttribute('sandbox'), events: s.pointerEvents }; })`;
  const check = (fs_, what) => {
    assert.ok(fs_.length > 0, `${what}: frames`);
    for (const f of fs_) {
      assert.equal(f.w, 1280, `${what}: laid out 1280 px wide`);
      assert.ok(Math.abs(f.h - 1280 * f.bh / f.bw) <= 1, `${what}: its height from the box (${f.h} vs ${1280 * f.bh / f.bw})`);
      assert.ok(f.k !== null && Math.abs(f.k - f.bw / 1280) < 0.002, `${what}: scaled to the box (${f.k} vs ${f.bw / 1280})`);
      assert.equal(f.fills, true, `${what}: fills its box`);
      assert.equal(f.sandbox, 'allow-scripts');
      assert.equal(f.events, 'none');
    }
  };
  const wide = await p.ev(measure);
  check(wide, '1440');
  assert.ok(wide.length <= await p.ev('THUMB_MAX'), 'under THUMB_MAX');
  // a link's box: no frame, as before
  assert.equal(await p.ev(`(() => { const b = ${card(`link:${fx.patch.library.links[0].id}`)}.querySelector('.lib-thumb'); return !b.querySelector('iframe') && !b.dataset.thumbSrc; })()`), true, 'a link holds no frame');
  // the grid resizes: the scale follows the box
  await p.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
  await soon(`(() => { const xs = ${measure}; return xs.length > 0 && xs.every((f) => f.k !== null && Math.abs(f.k - f.bw / 1280) < 0.002) && xs[0].bw !== ${wide[0].bw}; })()`, 'the scale follows the new width');
  check(await p.ev(measure), '900');
  void ids;
});
