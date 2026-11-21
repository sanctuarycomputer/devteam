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
// added to /api/data's answer, as the gateway adds it. Unlike that copy it pauses every request the page makes (to
// any origin, by fetch, XHR, beacon, form or navigation) and keeps [method, url] of each in requests, letting the
// ones to other origins go on unchanged; targets() lists the browser's page targets.
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
  const requests = [];
  const answer = async ({ requestId, request }) => {
    requests.push([request.method, request.url]);
    const u = new URL(request.url);
    if (u.origin !== origin) return quiet('Fetch.continueRequest', { requestId });
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
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  const close = p.close;
  const targets = async () => (await list()).filter((x) => x.type === 'page');
  return { ...p, origin, requests, targets, close: () => { try { ws.close(); } catch {} close(); } };
}

// The page at #library over a bare project (its own HOME, every DEVTEAM_* but the ports unset) with fx's patch,
// every card drawn; box: the gateway's served map, the page then on 4321.box.localhost through boxPage.
async function libraryAt(t, { fx = libraryFixture(), box = null, n = 4321, width = 1440, height = 900, init = '' } = {}) {
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
  const p = box ? await boxPage(chrome, port, { n, header: box }) : await chrome.newPage();
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
// a box page's requests but GET and HEAD and the Library's own ask of the fetch (artRemotePing's POST)
const posts = (p) => p.requests.filter(([m, u]) => !['GET', 'HEAD'].includes(m) && new URL(u).pathname !== '/api/artifact-remote').map((x) => x.join(' '));
// a card's publish item by its label, clicked where it is on the screen (its ⋯ opened first)
async function clickItem(p, soon, id, label) {
  const c = `[data-lib-id="${id}"]`;
  if (!(await p.ev(`document.querySelector('${c} .card-head details.menu').open`))) await p.click(`${c} .card-head details.menu > summary`);
  await soon(`document.querySelector('${c} .card-head details.menu').open`, `${id}: ⋯ open`);
  const at = await p.ev(`(() => { const e = [...document.querySelectorAll('${c} .lib-menu-pub > a, ${c} .lib-menu-pub > button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === e }; })()`);
  assert.ok(at?.hit, `${id}: ${label} is there and on top`);
  await p.clickAt(at.x, at.y);
}

test('library menu publish: each landed card\'s ⋯ lists its publish actions, each the gateway\'s confirm page in a new tab', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { p, soon, port, ids, patch } = await libraryAt(t, { fx, box: servedOf(fx.ids) });
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
  // a newer draft shown over the landed one: the group says it acts on main's version (ruling R3); a landed card doesn't
  const note = (slug) => p.ev(`${art(slug)}.querySelector('.lib-menu-pub .lib-menu-note')?.textContent.trim() ?? null`);
  assert.equal(await note(ids.drafted), "Acts on main's version, not the draft shown.");
  for (const slug of [ids.docs, ids.public, ids.notLive]) assert.equal(await note(slug), null, `${slug}: no draft note`);
  // Copy public link and Forget as today
  assert.equal(await p.ev(`${art(ids.public)}.querySelector('.lib-menu-pub [data-copy]').dataset.copy`), `http://public.box.localhost:${port}/${ids.project}/${ids.public}/`);
  assert.equal(await p.ev(`${art(ids.notLive)}.querySelector('.lib-menu-pub [data-forget]').dataset.forget`), ids.notLive);
  for (const id of noGroup(ids, patch)) assert.equal(await p.ev(group(id)), null, `${id}: no publish group`);
  // the body keeps its words and error span; Restore left it
  assert.equal(await p.ev(`[...${art(ids.notLive)}.querySelectorAll('.lib-body a')].some((a) => a.textContent === 'Restore')`), false, 'no Restore in the body');
  assert.equal(await p.ev(`${art(ids.notLive)}.querySelector('.lib-body .lib-pub #e-pub-${ids.notLive}') !== null`), true, 'its error span');
  assert.match(await p.ev(`${art(ids.notLive)}.querySelector('.lib-body .lib-pub').textContent`), /recorded .+ from the dashboard/);
  // a poll that changes the card while its ⋯ is open: the card is replaced, its ⋯ stays open, the group the same
  const pc = `[data-lib-id="artifact:${ids.public}"]`;
  const groupBefore = await p.ev(group(`artifact:${ids.public}`));
  await p.click(`${pc} .card-head details.menu > summary`);
  await soon(`document.querySelector('${pc} .card-head details.menu').open`, 'the public card\'s ⋯ open');
  // the change, the redraw and the reads in one task, so the page's own poll (which redraws from the server's data)
  // can't come between them
  const redrawn = await p.ev(`(() => { DATA.library.artifacts.find((a) => a.slug === ${JSON.stringify(ids.public)} && a.at === 'main').title += ' (renamed)'; renderLibrary(DATA.library);
    return [document.querySelector('${pc} .lib-title').textContent.endsWith(' (renamed)'), document.querySelector('${pc} .card-head details.menu').open, ${group(`artifact:${ids.public}`)}]; })()`);
  assert.deepEqual(redrawn.slice(0, 2), [true, true], 'redrawn with its ⋯ still open');
  assert.deepEqual(redrawn[2], groupBefore, 'the same group');
  await p.ev(`document.querySelector('${pc} .card-head details.menu').open = false`);
  // nothing publishes by itself: a click on each kind of link opens the gateway's page in a new tab, the page makes
  // no request but GETs (any transport, any origin), and stays where it is
  const here = await p.ev('location.href');
  const sent = posts(p).length;
  for (const [slug, label, href] of [[ids.docs, 'Publish', pubUrl(ids.docs)], [ids.pubUpdate, 'Update', pubUrl(ids.pubUpdate)], [ids.public, 'Unpublish', unpubUrl(ids.public)], [ids.notLive, 'Restore', pubUrl(ids.notLive)]]) {
    const before = new Set((await p.targets()).map((x) => x.id));
    await clickItem(p, soon, `artifact:${slug}`, label);
    const end = Date.now() + 10000;
    let opened = null;
    while (!opened && Date.now() < end) {
      opened = (await p.targets()).find((x) => !before.has(x.id) && x.url === href) ?? null;
      if (!opened) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(opened, `${slug}: ${label} opened ${href} in a new tab`);
    await p.ev(`document.querySelector('[data-lib-id="artifact:${slug}"] .card-head details.menu').open = false`);
  }
  assert.deepEqual(posts(p).slice(sent), [], 'no request but GETs');
  assert.equal(await p.ev('location.href'), here, 'the page stays');
});

const OFF_WORDS = "Publishing happens on the cloud box: open this dashboard at the box's address to publish.";
// every good landed card: one disabled Publish with words, no link; the rest no group
async function offGroups(p, ids, patch, words) {
  const off = [['Publish', 'button', null, null, null, true]];
  const good = patch.library.artifacts.filter((a) => a.at === 'main' && !a.error).map((a) => a.slug);
  assert.ok(good.length >= 5, 'several landed cards');
  for (const slug of good) {
    assert.deepEqual(await p.ev(group(`artifact:${slug}`)), off, `${slug}: a disabled Publish`);
    assert.equal(await p.ev(`${art(slug)}.querySelector('.lib-menu-pub').textContent.replace(/\\s+/g, ' ').includes(${JSON.stringify(words)})`), true, `${slug}: its words`);
    assert.equal(await p.ev(`${art(slug)}.querySelector('.lib-menu-pub a[href]')`), null, `${slug}: no link`);
  }
  for (const id of noGroup(ids, patch)) assert.equal(await p.ev(group(id)), null, `${id}: no publish group`);
}

test('library menu off gateway: a disabled Publish that says where publishing works, never a dead link', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { p, soon, ids, patch } = await libraryAt(t, { fx });
  assert.equal(await p.ev('PUBLIC'), null, 'off the gateway');
  await soon(`!!${art(ids.public)}`, 'the public card');
  await offGroups(p, ids, patch, OFF_WORDS);
});

test('library menu off gateway: the gateway\'s header but not at <port>.<box> (publicHere null)', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { p, soon, ids, patch } = await libraryAt(t, { fx, box: servedOf(fx.ids), n: 'www' });
  assert.deepEqual(await p.ev("[!!PUBLIC, location.host.startsWith('www.box.localhost')]"), [true, true], 'the header, on a host publicHere refuses');
  await soon(`!!${art(ids.public)}`, 'the public card');
  await offGroups(p, ids, patch, OFF_WORDS);
});

test('library menu publish: no project in settings, a disabled Publish that says so', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  fx.patch.library.public.project = null;
  const { p, soon, ids } = await libraryAt(t, { fx, box: servedOf(fx.ids) });
  await soon(`!!${art(ids.docs)}`, 'the docs card');
  assert.deepEqual(await p.ev(group(`artifact:${ids.docs}`)), [['Publish', 'button', null, null, null, true]], 'a disabled Publish');
  assert.equal(await p.ev(`${art(ids.docs)}.querySelector('.lib-menu-pub').textContent.replace(/\\s+/g, ' ').includes('Set project in settings.md to publish from here.')`), true, 'its words');
  assert.equal(await p.ev(`${art(ids.docs)}.querySelector('.lib-menu-pub a[href]')`), null, 'no link');
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
