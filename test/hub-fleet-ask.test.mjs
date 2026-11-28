// The hub's Overview asks a project's dashboard, in the frame the hub holds, to Run, Drain or Park;
// the dashboard page posts /api/fleet to its own origin and answers the hub (index.html's hub-fleet
// listener). This proves who is heard and what is posted, in Chrome: only the dashboard's own parent,
// straight under the top page and on another origin, is heard; never the dashboard's own page, a
// sibling frame, a parent that is not the top, the viewer, a page opened on its own, a malformed ask
// or a nonce already used. A heard ask posts exactly { op, reason? } once and answers that parent
// with { devteam: 'hub-fleet-done', nonce, ok, error? }.
// The hub here is a fake one on the port the dashboard is told is the hub's (its frame-ancestors
// names it), and /api/fleet is never reached: each dashboard frame's fetch is wrapped so a POST
// there is recorded and answered by the test. The same file runs on main against
// docs/devteam/dashboard/index.html and in the generated tree against the app.
// Ports: +75 the fake hub, +76 another origin, +77 the dashboard's port base (never bound: --port pins it)
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PORTS, bareProject, dashboardOnFreePort, until } from './lib/kit.mjs';
import { canDrive, openChrome } from './lib/chrome.mjs';

const HUB = PORTS + 75;
const OTHER = PORTS + 76;
const H = `http://127.0.0.1:${HUB}`;
const O = `http://127.0.0.1:${OTHER}`;
const nonce = () => crypto.randomBytes(8).toString('hex');
const ask = (mode, n, more = {}) => ({ devteam: 'hub-fleet', mode, nonce: n, ...more });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QUIET = 1500;

// Wraps the fetch of the window at `at` (an expression, evaluated in a page of the dashboard's
// origin): a POST to /api/fleet is recorded in that window's __fleetPosts (its body, parsed) and
// answered with __fleetAnswer ({ status, body }, 200 {} unless the test sets it), never sent. Says
// where that window is, whether it holds the dashboard's shell (#banner, in index.html and in the
// app's shell alike), and whether its parent is the top, so a test knows it wrapped the one it meant.
const wrap = (at) => `(() => {
  const w = ${at};
  if (!w.__fleetPosts) {
    w.__fleetPosts = [];
    w.__fleetAnswer = { status: 200, body: {} };
    const real = w.fetch;
    w.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      if (method === 'POST' && new w.URL(url, w.location.href).pathname === '/api/fleet') {
        let body = null;
        try { body = JSON.parse(init.body); } catch {}
        w.__fleetPosts.push(body);
        const a = w.__fleetAnswer;
        return w.Promise.resolve(new w.Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } }));
      }
      return real.apply(this, arguments);
    };
  }
  return { path: w.location.pathname, shell: !!w.document.getElementById('banner'), underTop: w.parent === w.top, framed: w.parent !== w };
})()`;

describe('the hub-fleet ask in Chrome: who is heard, what is posted, what is answered', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 240000 }, () => {
  const steps = [];
  let D; // the dashboard's origin
  let p; // the hub's page
  let q; // a tab of the dashboard's own
  const loadedIn = (pg, at) => until(() => pg.ev(`(() => { try { const w = ${at}; return w.location.href !== 'about:blank' && w.document.readyState === 'complete'; } catch { return false; } })()`).catch(() => false), `${at} loaded`);
  // in the hub page's frames of the dashboard's origin (evIn picks one; `at` names the window)
  const inD = (expr) => p.evIn(D, expr);
  const posts = (at) => inD(`(${at}).__fleetPosts.slice()`);
  const replies = () => p.ev('window.replies.slice()');
  // A frame that is meant not to answer, booted: loaded, and its own first read of `api` finished
  // (the listener block runs right after the boot's load(), or viewerBoot()). A frame that is meant
  // to answer is proved by an answer instead (before()).
  const booted = (ev, at, api) => until(() => ev(`(() => { try { const w = ${at}; return w.location.href !== 'about:blank' && w.document.readyState === 'complete' && w.performance.getEntriesByType('resource').some((e) => new URL(e.name).pathname.startsWith(${JSON.stringify(api)}) && e.responseEnd > 0); } catch { return false; } })()`).catch(() => false), `${at} booted (its first ${api} read)`);
  const answersTo = async (n) => (await replies()).filter((r) => r.nonce === n);
  const fromHub = (frame, m) => p.ev(`document.getElementById(${JSON.stringify(frame)}).contentWindow.postMessage(${JSON.stringify(m)}, ${JSON.stringify(D)})`);
  const DASH = 'top.frames[0]';
  const KID = "document.getElementById('kid').contentWindow";

  before(async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-hub-fleet-'));
    steps.push(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
    const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(HUB), DEVTEAM_PORT_BASE: String(PORTS + 77), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
    for (const k of Object.keys(env)) if (/^DEVTEAM_(ROLE|TICKET|FEATURE|RUN|SUPERVISOR|HOME)$/.test(k) || k === 'TMUX' || k === 'TMUX_PANE') delete env[k];
    const root = bareProject(base, 'alpha');
    // The fake hub, bound before the dashboard starts (a dashboard starts a hub of its own on that port
    // when none answers): its page frames the dashboard first, then a sibling of another origin; it keeps every answer
    const page = (res, html) => { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); res.end(`<!doctype html><meta charset="utf-8">${html}`); };
    const hub = http.createServer((req, res) => {
      if (req.url === '/') return page(res, `<div id="frames"><iframe id="dash" src="${D}/"></iframe><iframe id="sib" src="${O}/sib"></iframe></div><script>window.replies = []; addEventListener('message', (e) => { if (e.data && e.data.devteam === 'hub-fleet-done') window.replies.push({ ...e.data, origin: e.origin }); });</script>`);
      // a page of the hub's origin framing the dashboard, framed in turn by the hub's page
      if (req.url === '/inner') return page(res, `<iframe id="d2" src="${D}/"></iframe><script>window.ask = (m) => document.getElementById('d2').contentWindow.postMessage(m, ${JSON.stringify(D)});</script>`);
      res.writeHead(404); res.end();
    });
    await new Promise((r, no) => { hub.once('error', no); hub.listen(HUB, '127.0.0.1', r); });
    steps.push(() => new Promise((r) => { hub.closeAllConnections(); hub.close(r); }));
    // another origin: a sibling frame on the hub's page, posting to the dashboard frame when the hub says go
    const other = http.createServer((req, res) => {
      if (req.url === '/sib') return page(res, `<script>addEventListener('message', (e) => { if (e.data && e.data.go) parent.frames[0].postMessage(e.data.go, '*'); });</script>`);
      res.writeHead(404); res.end();
    });
    await new Promise((r, no) => { other.once('error', no); other.listen(OTHER, '127.0.0.1', r); });
    steps.push(() => new Promise((r) => { other.closeAllConnections(); other.close(r); }));
    const { dash, port } = await dashboardOnFreePort(root, env);
    steps.push(() => dash.stop());
    D = `http://127.0.0.1:${port}`;
    const chrome = await openChrome();
    steps.push(() => chrome.close());
    p = await chrome.newPage();
    steps.push(() => p.close());
    await p.send('Page.enable');
    await p.send('Runtime.enable');
    await p.send('Page.navigate', { url: `${H}/` });
    await until(() => p.ev(`document.readyState === 'complete' && Array.isArray(window.replies)`).catch(() => false), "the hub's page");
    await until(() => p.evIn(O, `document.readyState === 'complete'`).catch(() => false), 'the sibling frame');
    await until(() => inD(`(() => { try { return (${DASH}).document.readyState === 'complete'; } catch { return false; } })()`).catch(() => false), 'the dashboard frame loaded');
    assert.deepEqual(await inD(wrap(DASH)), { path: '/', shell: true, underTop: true, framed: true }, "the hub's dashboard frame, wrapped");
    // the listener proved installed: a valid ask answered (polled up to 30 s; a second answer, if any,
    // given QUIET to land), then every count back to zero, so the cases start from nothing
    const probe = nonce();
    await fromHub('dash', ask('run', probe));
    let heard = false;
    for (let i = 0; i < 300 && !heard; i++) { heard = (await answersTo(probe)).length > 0; if (!heard) await sleep(100); }
    if (!heard) assert.fail("the dashboard never answered a valid ask: the hub-fleet listener isn't installed");
    await sleep(QUIET);
    await inD(`(${DASH}).__fleetPosts.length = 0`);
    await p.ev('window.replies.length = 0');
    // the dashboard in a tab of its own, and that tab framing the dashboard again (its own origin)
    q = await chrome.newPage();
    steps.push(() => q.close());
    await q.send('Page.enable');
    await q.send('Runtime.enable');
    await q.send('Page.navigate', { url: `${D}/` });
    await booted(q.ev, 'window', '/api/data');
    // at /index.html, the same page: Chrome never loads a frame at its ancestor's own URL (a query or
    // a hash won't do: the server serves the page at / and /index.html only). Framed by its own origin
    // the page stops at its first script (window.frameElement) and draws one line: no listener at all.
    await q.ev(`(() => { const f = document.createElement('iframe'); f.id = 'kid'; f.src = '/index.html'; document.documentElement.append(f); return true; })()`);
    // (it reads nothing, stopped: loaded is all it does)
    await loadedIn(q, KID);
    assert.deepEqual(await q.ev(wrap('window')), { path: '/', shell: true, underTop: true, framed: false }, 'the tab, wrapped');
    const kid = await q.ev(wrap(KID));
    assert.deepEqual({ path: kid.path, underTop: kid.underTop, framed: kid.framed }, { path: '/index.html', underTop: true, framed: true }, "the tab's own frame, wrapped");
  });
  after(async () => {
    let first = null;
    for (const f of steps.reverse()) { try { await f(); } catch (e) { first ??= e; } }
    if (first) throw first;
  });

  test('1: the dashboard posting to itself is not heard', async () => {
    const was = (await posts(DASH)).length;
    const r0 = (await replies()).length;
    await inD(`(${DASH}).postMessage(${JSON.stringify(ask('park', nonce()))}, '*')`);
    await sleep(QUIET);
    assert.deepEqual((await posts(DASH)).slice(was), [], 'case 1: the dashboard asking itself posts nothing');
    assert.equal((await replies()).length, r0, 'case 1: and answers nothing');
  });

  test('1b: a dashboard framed by its own origin, straight under the top, is not heard', async () => {
    const was = (await q.ev(`${KID}.__fleetPosts.length`));
    await q.ev(`${KID}.postMessage(${JSON.stringify(ask('park', nonce()))}, location.origin)`);
    await sleep(QUIET);
    assert.deepEqual(await q.ev(`${KID}.__fleetPosts.slice(${was})`), [], 'case 1b: an ask from a parent of the dashboard\'s own origin posts nothing');
  });

  test('2: a sibling frame of another origin is not heard', async () => {
    const was = (await posts(DASH)).length;
    await p.ev(`document.getElementById('sib').contentWindow.postMessage({ go: ${JSON.stringify(ask('park', nonce()))} }, ${JSON.stringify(O)})`);
    await sleep(QUIET);
    assert.deepEqual((await posts(DASH)).slice(was), [], 'case 2: an ask from a sibling frame of another origin posts nothing');
  });

  test('3: a dashboard whose parent is not the top is not heard', async () => {
    await p.ev(`new Promise((r) => { const f = document.createElement('iframe'); f.id = 'inner'; f.src = '${H}/inner'; f.addEventListener('load', r); document.getElementById('frames').append(f); })`);
    const D2 = 'top.frames[2].frames[0]';
    await booted(inD, D2, '/api/data');
    try {
      assert.deepEqual(await inD(wrap(D2)), { path: '/', shell: true, underTop: false, framed: true }, 'the dashboard under the inner frame, wrapped');
      await p.ev(`document.getElementById('inner').contentWindow.ask(${JSON.stringify(ask('park', nonce()))})`);
      await sleep(QUIET);
      assert.deepEqual(await posts(D2), [], 'case 3: an ask from a parent that is not the top posts nothing');
    } finally {
      await p.ev(`document.getElementById('inner').remove()`);
    }
  });

  test('4: the viewer framed by the hub is not heard', async () => {
    await p.ev(`new Promise((r) => { const f = document.createElement('iframe'); f.id = 'viewer'; f.src = '${D}/view/artifact/x'; f.addEventListener('load', r); document.getElementById('frames').append(f); })`);
    const V = 'top.frames[2]';
    await booted(inD, V, '/api/');
    try {
      const v = await inD(wrap(V));
      assert.deepEqual({ path: v.path, underTop: v.underTop, framed: v.framed }, { path: '/view/artifact/x', underTop: true, framed: true }, 'the viewer, wrapped');
      await fromHub('viewer', ask('park', nonce()));
      await sleep(QUIET);
      assert.deepEqual(await posts(V), [], 'case 4: an ask to the viewer posts nothing');
    } finally {
      await p.ev(`document.getElementById('viewer').remove()`);
    }
  });

  test('5: a malformed ask from the hub is not heard', async () => {
    const was = (await posts(DASH)).length;
    const r0 = (await replies()).length;
    const bad = {
      'devteam wrong': { ...ask('park', nonce()), devteam: 'hub-fleet-x' },
      'mode stop': ask('stop', nonce()),
      'mode toString': ask('toString', nonce()),
      'nonce short': ask('park', 'short'),
      'nonce with an uppercase letter': ask('park', `${nonce()}A`),
      'nonce a number': ask('park', 123456789),
    };
    for (const [why, m] of Object.entries(bad)) {
      await fromHub('dash', m);
      await sleep(QUIET);
      assert.deepEqual((await posts(DASH)).slice(was), [], `case 5: a malformed ask (${why}) posts nothing`);
    }
    assert.equal((await replies()).length, r0, 'case 5: and none is answered');
  });

  const once = nonce();
  test('6: a valid park from the hub posts once and is answered ok', async () => {
    const was = (await posts(DASH)).length;
    const r0 = (await replies()).length;
    await fromHub('dash', ask('park', once));
    await until(async () => (await replies()).length > r0, 'the answer to park');
    await sleep(QUIET);
    assert.equal((await answersTo(once)).length, 1, 'case 6: exactly one hub-fleet-done for its nonce');
    assert.deepEqual((await posts(DASH)).slice(was), [{ op: 'park', reason: "parked from the hub's Overview" }], 'case 6: park posts once, with its reason');
    assert.deepEqual((await replies()).slice(r0), [{ devteam: 'hub-fleet-done', nonce: once, ok: true, origin: D }], 'case 6: one answer, ok, from the dashboard');
  });

  test('7: the same nonce again is dropped, with no answer', async () => {
    const was = (await posts(DASH)).length;
    const r0 = (await replies()).length;
    await fromHub('dash', ask('park', once));
    await sleep(QUIET);
    assert.deepEqual((await posts(DASH)).slice(was), [], 'case 7: a nonce already used posts nothing more');
    assert.equal((await replies()).length, r0, 'case 7: and is not answered again');
  });

  test('8: a valid drain for every project names that in its reason', async () => {
    const was = (await posts(DASH)).length;
    const r0 = (await replies()).length;
    const n = nonce();
    await fromHub('dash', ask('drain', n, { all: true }));
    await until(async () => (await replies()).length > r0, 'the answer to drain');
    await sleep(QUIET);
    assert.equal((await answersTo(n)).length, 1, 'case 8: exactly one hub-fleet-done for its nonce');
    assert.deepEqual((await posts(DASH)).slice(was), [{ op: 'drain', reason: "drained with every project, from the hub's Overview" }], 'case 8: drain with all posts its reason');
    assert.deepEqual((await replies()).slice(r0), [{ devteam: 'hub-fleet-done', nonce: n, ok: true, origin: D }], 'case 8: answered ok');
  });

  test('9: run posts resume; "nothing to resume" is ok, another refusal is not, cut to 300', async () => {
    let was = (await posts(DASH)).length;
    let r0 = (await replies()).length;
    const n1 = nonce();
    await inD(`(${DASH}).__fleetAnswer = { status: 409, body: { error: 'nothing to resume' } }`);
    await fromHub('dash', ask('run', n1));
    await until(async () => (await replies()).length > r0, 'the answer to run');
    await sleep(QUIET);
    assert.equal((await answersTo(n1)).length, 1, 'case 9: exactly one hub-fleet-done for the "nothing to resume" nonce');
    assert.deepEqual((await posts(DASH)).slice(was), [{ op: 'resume' }], 'case 9: run posts resume, with no reason');
    assert.deepEqual((await replies()).slice(r0), [{ devteam: 'hub-fleet-done', nonce: n1, ok: true, origin: D }], 'case 9: "nothing to resume" answers ok');
    was = (await posts(DASH)).length;
    r0 = (await replies()).length;
    const n2 = nonce();
    await inD(`(${DASH}).__fleetAnswer = { status: 500, body: { error: 'x'.repeat(400) } }`);
    await fromHub('dash', ask('run', n2));
    await until(async () => (await replies()).length > r0, 'the answer to the refused run');
    await sleep(QUIET);
    assert.equal((await answersTo(n2)).length, 1, 'case 9: exactly one hub-fleet-done for the refused nonce');
    await inD(`(${DASH}).__fleetAnswer = { status: 200, body: {} }`);
    assert.deepEqual((await posts(DASH)).slice(was), [{ op: 'resume' }], 'case 9: the second run posts resume');
    assert.deepEqual((await replies()).slice(r0), [{ devteam: 'hub-fleet-done', nonce: n2, ok: false, error: 'x'.repeat(300), origin: D }], 'case 9: another refusal answers not ok, its error cut to 300');
  });

  test('10: the dashboard opened in a tab of its own, posting to itself, is not heard', async () => {
    const was = await q.ev('window.__fleetPosts.length');
    await q.ev(`window.postMessage(${JSON.stringify(ask('park', nonce()))}, '*')`);
    await sleep(QUIET);
    assert.deepEqual(await q.ev(`window.__fleetPosts.slice(${was})`), [], 'case 10: a dashboard with no parent posts nothing');
  });
});
