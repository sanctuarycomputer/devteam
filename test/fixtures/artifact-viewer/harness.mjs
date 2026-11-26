// The artifact viewer's Chrome tests' shared harness (kit-141): the fixture project, its artifacts landed
// on main, the threads, the ticket and the preview's app; one dashboard and one Chrome for a test file; a
// tab of its own per case (visit) with the helpers a case drives it by. test/artifact-viewer-close.test.mjs
// (DW1 to DW3) and test/artifact-viewer-escape.test.mjs (DW4, the lenses' key messages) use it.
//
// The joint session history is what these tests are about: a frame's own navigation adds an entry to the
// tab's history, so a close by history.back() after the frame has moved steps the frame back and leaves the
// viewer open. Every case runs in a tab of its own (one Chrome for the file): history.length stops at 50
// in a tab, and a file makes far more entries than that, so a length "unchanged" in a shared tab would
// prove nothing.
//
// (Each test file imports ./lib/chrome.mjs itself as well: test/run.mjs puts a file in its Chrome group
// by that import in the file's own source.)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { threadsFixture, dashboardOnFreePort, PORTS } from '../../lib/kit.mjs';
import { cleanup, openChrome } from '../../lib/chrome.mjs';

const FIX = path.dirname(fileURLToPath(import.meta.url));
export const J = JSON.stringify;
const idOf = (out) => out.split('\n')[0].trim();

// The laptop's preview relays, in this file's own block of ports (lib/ports.mjs's layout: +62..79).
const RELAY_ENV = { DEVTEAM_RELAY_PORTS: `${PORTS + 62}-${PORTS + 79}` };

// Knobs for widening a race on demand (kit-305), each changing nothing unless set:
// DEVTEAM_TEST_CPU_THROTTLE=<n>, Chrome's CPU throttling on each case's tab (a loaded runner);
// DEVTEAM_TEST_RECTS_DELAY_MS=<ms>, once V.open has the viewer up, each lens's rects message (where its
// watched anchors are) reaches the dashboard that much later, so the pins follow a move late (DW6). Only from
// then: held from the start, the stage's pins are first drawn late, already in their final places. (The pins
// are also redrawn by the panel's slide ending, from the rects the dashboard has, so delaying the dashboard's
// animation frames instead doesn't hold them back every time.) A message held is dispatched again, as it
// came, to the dashboard's own listeners; nothing else is. Only for a case that doesn't move the frame: a
// message held across an in-frame link would reach the next page's pins with the last page's rects.
const CPU_THROTTLE = Number(process.env.DEVTEAM_TEST_CPU_THROTTLE) || 0;
const RECTS_DELAY_MS = Number(process.env.DEVTEAM_TEST_RECTS_DELAY_MS) || 0;
const RECTS_DELAY = `(() => {
  if (window !== top) return;
  const again = new WeakSet();
  addEventListener('message', (e) => {
    const m = e.data;
    if (!window.__rectsDelay || again.has(e) || !m || m.lens !== 1 || m.type !== 'rects') return;
    e.stopImmediatePropagation();
    setTimeout(() => { const d = new MessageEvent('message', { data: m, origin: e.origin, source: e.source }); again.add(d); dispatchEvent(d); }, ${RECTS_DELAY_MS});
  });
})()`;

// A wait on a condition in the page (this file's own copy of dashboard.test.mjs's soonIn): an
// evaluation that throws is "not yet"; timed out, it says where the tab is and the last error.
const soonIn = (p, ms = 20000, server = null) => async (expr, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v, err = null;
    try { v = await p.ev(expr); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) {
      const at = await p.ev('[location.href, document.title, document.readyState]').catch((e) => e.message);
      assert.fail(`timed out: ${what}; the tab is at ${J(at)}${err ? `; last: ${err.message}` : ''}${server ? `; the server said, last: ${J(String(server()).slice(-600))}` : ''}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
};
// The same wait, for a close: true once the condition holds, false when ms run out (the assertions
// that follow say what was wrong, from the state read then).
const settleIn = (p) => async (expr, ms) => {
  const end = Date.now() + ms;
  for (;;) {
    let v = false;
    try { v = await p.ev(expr); } catch {}
    if (v) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
};

// The page polls every 10 s; here every 300 ms (as dashboard.test.mjs's POLL_FAST).
const POLL_FAST = `(() => { const si = window.setInterval; window.setInterval = (f, ms, ...a) => si(f, ms === 10000 ? 300 : ms, ...a); })()`;
// In the tab's own page only (never a frame's), before the dashboard's scripts run:
// - localStorage cleared once per tab (a sessionStorage mark, so a reload keeps it), so a panel or a
//   filter one case remembered never adds th or t to a later case's head (spec-1 F1-7);
// - history.back, history.go and history.replaceState counted, each replace with whether
//   leaveArtifact is on its stack (a close by replace, not the router's own stamps);
// - what the frames' pages say (their { own: 'at' } messages: which page, its hash, where its elements are),
//   each with the dashboard's iframe it came from (window.__ownFrom: the one whose window sent it or holds the
//   window that did, as a preview's app sits inside its lens), so an aim reads only the stage's (kit-928); a
//   case may hold words back (window.__ownHold, a test on the word) and let them go, as they came, later
//   (window.__ownLetGo());
// - every key message a lens sends (window.__lensKeys: its key, shift and up, as the lens sent them);
// - every iframe's load, by id (load doesn't bubble, so a capture listener on the document: one on the
//   element would be lost when the element is replaced).
const WATCH = `(() => {
  if (window !== top) return;
  try { if (!sessionStorage.getItem('avc.cleared')) { localStorage.clear(); sessionStorage.setItem('avc.cleared', '1'); } } catch {}
  const H = History.prototype, back = H.back, go = H.go, rep = H.replaceState;
  window.__backs = 0; window.__gos = []; window.__replaces = [];
  H.back = function () { window.__backs++; return back.call(this); };
  H.go = function (n) { window.__gos.push(n); return go.call(this, n); };
  H.replaceState = function (s, t, u) { window.__replaces.push({ url: u === undefined ? null : String(u), page: s && s.page, leave: /leaveArtifact/.test(String(new Error().stack)) }); return rep.apply(this, arguments); };
  window.__own = [];
  window.__ownFrom = new WeakMap();
  window.__ownHold = null;
  window.__ownHeld = [];
  const frameOf = (w) => { for (let i = 0; w && i < 8; i++) { const f = [...document.querySelectorAll('iframe')].find((f) => f.contentWindow === w); if (f) return f; if (w === w.parent) return null; w = w.parent; } return null; };
  const word = (e) => { window.__own.push(e.data); const f = frameOf(e.source); if (f) window.__ownFrom.set(e.data, f); };
  window.__ownLetGo = () => { const h = window.__ownHeld; window.__ownHold = null; window.__ownHeld = []; h.forEach(word); return h.length; };
  addEventListener('message', (e) => { if (!e.data || !e.data.own) return; if (window.__ownHold && window.__ownHold(e.data)) { window.__ownHeld.push(e); return; } word(e); });
  window.__lensKeys = [];
  addEventListener('message', (e) => { const m = e.data; if (m && m.lens === 1 && m.type === 'key') window.__lensKeys.push({ key: m.key, shift: m.shift, ...('up' in m ? { up: m.up } : {}) }); });
  window.__loads = [];
  // every click that reached the dashboard's own document, by what it landed on (a press the page never
  // got is a missed press, not a close that failed)
  window.__clicks = [];
  document.addEventListener('click', (e) => { const el = e.target; window.__clicks.push(el && el.nodeType === 1 ? (el.closest('#av-close') ? 'av-close' : el.closest('#drawer-close') ? 'drawer-close' : el.closest('[data-tl-pin]') ? 'tl-pin' : el.id || el.tagName) : null); }, true);
  document.addEventListener('load', (e) => { const f = e.target; if (f && f.tagName === 'IFRAME') window.__loads.push({ id: f.id, src: f.getAttribute('src') }); }, true);
})()`;

// Resolves after two frames: whatever was just set has been drawn.
export const FRAMES = 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))';
const VIEWER_TAB = 'document.documentElement.classList.contains("viewer") && typeof TL === "object" && TL.have > 0';
const LOADED = 'typeof DATA === "object" && DATA !== null && TL.have > 0';
export const VIEW = "document.getElementById('artifact-view')";
export const VIEWER_UP = `(!${VIEW}.hidden && document.body.classList.contains('av-open'))`;
// Closed (spec §Acceptance checks): #artifact-view hidden, body without av-open, neither frame with a src.
export const CLOSED = `(() => { const v = ${VIEW}; return !!v && v.hidden && !document.body.classList.contains('av-open') && !['av-frame', 'pv-frame'].some((id) => document.getElementById(id)?.hasAttribute('src')); })()`;
// a peek open and at rest (not sliding: a press on its X mid-slide is the slide's, not the X's)
export const PEEK = "(!document.getElementById('drawer').hidden && document.body.classList.contains('peek-open') && getComputedStyle(document.getElementById('drawer')).transform === 'none')";
// Where #id is on the page now on the stage, at the stage's frame: read only from the words the stage's own
// frame said (never a thumbnail's or another frame's) since it last named another page or hash than the
// one the stage is on now (TS: an artifact's path and hash, a preview's route); null until that page says
// where #id is (kit-928: run 45684113340 aimed at a Library thumbnail's #to-b). STAGE names that page.
const STAGE = "(TS.kind === 'preview' ? `${TS.name} ${TS.route}` : `${TS.slug}/${TS.path}${TS.hash}`)";
export const AIM = (id) => `(() => {
  const f = tsFrame(), want = TS.kind === 'preview' ? TS.route : TS.path && '/' + TS.path, hash = TS.kind === 'preview' ? null : TS.hash;
  if (!f || !want) return null;
  const mine = window.__own.filter((m) => m.own === 'at' && m.rects && window.__ownFrom.get(m) === f);
  for (let i = mine.length - 1; i >= 0; i--) {
    const m = mine[i];
    // a word naming another page or hash ends the run: what came before it is an earlier visit's
    if (typeof m.page !== 'string' || !m.page.endsWith(want) || (hash !== null && m.hash !== hash)) return null;
    const e = m.rects[${J(id)}];
    if (!e || !(e.w > 0)) continue;
    const r = f.getBoundingClientRect(), x = r.left + f.clientLeft + e.x + e.w / 2, y = r.top + f.clientTop + e.y + e.h / 2, hit = document.elementFromPoint(x, y);
    return { x, y, hit: hit === f, on: hit ? hit.id || hit.className || hit.tagName : null, page: m.page + m.hash };
  }
  return null;
})()`;
// True once the stage's frame's box reads the same twice running (soon's polls are 50 ms apart).
const STEADY = "(() => { const r = tsFrame().getBoundingClientRect(), k = [r.left, r.top, r.width, r.height].join(); const was = window.__steady; window.__steady = k; return was === k; })()";
export const CARD = "document.getElementById('tl-card')";
export const IN_PANEL = (id) => `(!!document.querySelector('#th-card-slot > #tl-card.in-panel') && !${CARD}.hidden && ${CARD}.dataset.key === '${id}')`;
// A thread's card open beside its pin (a floating card: not the panel's)
export const FLOATING = (id) => `(!${CARD}.hidden && !${CARD}.classList.contains('in-panel') && ${CARD}.dataset.key === '${id}')`;
// What a case checks after a close, read in one go (and readable on a page that isn't the dashboard).
const STATE = `(() => { const v = ${VIEW}; return {
  href: location.href, hash: location.hash, dash: location.pathname === '/' && !!v,
  open: v ? !v.hidden : null, avOpen: document.body ? document.body.classList.contains('av-open') : null,
  srcs: ['av-frame', 'pv-frame'].map((id) => document.getElementById(id)?.getAttribute('src') ?? null),
  length: history.length, state: history.state, backs: window.__backs, gos: window.__gos,
  leaveReplaces: (window.__replaces || []).filter((r) => r.leave).length,
  slug: typeof TS === 'object' ? TS.slug : null, kind: typeof TS === 'object' ? TS.kind : null } })()`;

// A case's tab closed, and seen gone (kit-918). Page.close runs the page's beforeunload, and the
// dashboard's asks while a press is saving (SAVING > 0): a dialog nobody answers holds the tab, and the
// renderer it shares with the next one. So the close first waits, up to saving ms, until nothing is
// saving. Page.close answers at once, even when that dialog then opens, so the tab is gone only once its
// socket closes: it is called until then. Still answering after gone ms, it never went; a call with no
// answer (a dialog holds it) fails the caller with what chrome.mjs says Chrome was doing.
export async function closeTab(p, { saving = 10000, gone = 5000 } = {}) {
  const closed = (e) => /: Chrome's page connection closed /.test(e.message);
  const fail = (e, after = '') => { throw new Error(`closing the tab: ${after}${e.message}`, { cause: e }); };
  const pause = () => new Promise((r) => setTimeout(r, 50));
  try {
    const end = Date.now() + saving;
    for (;;) {
      // a page that can't say (not the dashboard, or its evaluation threw) has nothing saving; one that gives no answer fails here
      const n = await p.ev("typeof SAVING === 'number' ? SAVING : 0").catch((e) => (/: no answer from Chrome /.test(e.message) ? fail(e) : 0));
      if (!n) break;
      if (Date.now() > end) assert.fail(`closing the tab: the page still saving (SAVING ${n}) after ${saving / 1000} s; closing it would open its beforeunload dialog`);
      await pause();
    }
    if (await p.send('Page.close').then(() => false, (e) => closed(e) || fail(e))) return;
    const by = Date.now() + gone;
    for (;;) {
      if (await p.send('Runtime.evaluate', { expression: '1' }).then(() => false, (e) => closed(e) || fail(e, 'still open after Page.close; '))) return;
      if (Date.now() > by) assert.fail(`closing the tab: still open ${gone / 1000} s after Page.close`);
      await pause();
    }
  } finally { p.close(); }
}

// One tab at a time on chrome: next() closes the last one (closeTab) and opens a new one; done()
// closes the last. The last is let go before its close, so a close that fails isn't tried again.
export function oneTab(chrome) {
  let tab = null;
  const done = async () => { if (!tab) return; const last = tab; tab = null; await closeTab(last); };
  return { done, next: async () => { await done(); tab = await chrome.newPage(); return tab; } };
}

// The fixture's artifacts on main, as the supervisor lands one, with an HTML file of the project's
// (docs/drawer-page.html, for the file drawer's frame; T4's).
function land(F) {
  const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.cpSync(from, to, { recursive: true }); };
  for (const slug of ['viewer-a', 'viewer-b']) copy(path.join(FIX, slug), path.join(F.old, 'docs/devteam/project/artifacts', slug));
  copy(path.join(FIX, 'drawer-page.html'), path.join(F.old, 'docs/drawer-page.html'));
  F.g(['add', '-A', 'docs'], F.old);
  F.g(['commit', '-qm', 'artifacts: viewer-a, viewer-b; docs/drawer-page.html'], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
}
// A dev server of the test's own: / and /second, a link from the first to the second. It answers the
// relay's own /api/hello with a 404 (it is not a dashboard).
async function app() {
  const pages = { '/': fs.readFileSync(path.join(FIX, 'app/index.html')), '/second': fs.readFileSync(path.join(FIX, 'app/second.html')) };
  const srv = http.createServer((q, s) => {
    const own = q.url.split('?')[0];
    if (!Object.hasOwn(pages, own)) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    s.end(pages[own]);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { port: srv.address().port, close: () => { srv.closeAllConnections?.(); srv.close(); } };
}

// The whole setup for a test file's one parent test t: the fixture project (named fixture), its threads
// (T with no subject, for the panel; TA on viewer-a's #pin-me; TR on its right-anchored #pin-right), the ticket TK for a peek, the app behind a
// preview named name, the dashboard, Chrome, and the preview's relay opened once (plan-1 P1-2). Returns the
// heads and visit(hash) (a case's tab) and sub(name, fn) (a case).
export async function harness(t, fixture) {
  const later = cleanup(t);
  const F = threadsFixture(fixture);
  later(() => F.done());
  land(F);
  // T: a thread with no subject (it opens in the panel); TA: one on viewer-a's #pin-me (DW3 g, DW4, DW6)
  const T = idOf(F.owner(['thread', 'new', 'Where do we start?']));
  F.sup(['thread', 'reply', T, 'Here, I think.']);
  const TA = idOf(F.owner(['thread', 'new', 'This button', '--subject', J({ kind: 'artifact', slug: 'viewer-a', at: 'main', path: 'index.html', anchor: { selector: '#pin-me', tag: 'button', text: 'Pin me', point: { x: 60, y: 20 } } })]));
  // TR: one on viewer-a's #pin-right, placed from the frame's right edge (DW6: a stale rect misses it)
  const TR = idOf(F.owner(['thread', 'new', 'That button', '--subject', J({ kind: 'artifact', slug: 'viewer-a', at: 'main', path: 'index.html', anchor: { selector: '#pin-right', tag: 'button', text: 'Pin me right', point: { x: 60, y: 20 } } })]));
  // TA and TR handed over, as an owner done noting does: a close of viewer-a closes, with no ask before it (kit-937)
  F.owner(['artifact', 'handoff', 'viewer-a', '--at', 'main']);
  const TK = 'ch-01-tidy-docs';
  F.sup(['ticket', 'add', TK, '--json', J({ title: 'Tidy the docs', feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['docs/**'], done_when: ['the docs check passes in CI'], notes: 'n' })]);
  const A = await app();
  later(() => A.close());
  const name = /preview (\S+) /.exec(F.sup(['preview', String(A.port), '--label', 'App']))[1];
  const { dash, port } = await dashboardOnFreePort(F.old, F.env(RELAY_ENV));
  later(() => dash.stop());
  const B = `http://127.0.0.1:${port}`;
  const chrome = await openChrome();
  later(() => chrome.close());

  const AV_A = '#artifact/main/viewer-a', AV_B = '#artifact/main/viewer-b', PV = `#preview/${name}`;
  const LIB_T = `#library?th=open&t=${T}`, PROG_T = `#progress?th=open&t=${T}`;

  // A tab of its own for a case (the last one's closed), at 1280x800, on the dashboard at hash.
  const tabs = oneTab(chrome);
  later(() => tabs.done());
  // (a viewer tab, opts.path 'view/artifact/viewer-a', is ready when the page says it is the viewer and has read its threads)
  async function visit(hash, opts = {}) {
    const p = await tabs.next();
    return visitOn(p, hash, opts);
  }
  // (opts.hub: the hub's address to load, and opts.inHub the dashboard's origin in its project frame: the case drives
  // that dashboard, every evaluation in its page and every mouse event at the frame's place; kit-937)
  async function visitOn(raw, hash, { path = '', width = 1280, height = 800, hub = null, inHub = null } = {}) {
    let p = raw;
    // the tab in front: a hidden one draws nothing, and the mouse is hit-tested against what it drew
    await p.send('Page.bringToFront');
    await p.send('Page.enable');
    await p.send('Runtime.enable');
    await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    if (CPU_THROTTLE) await p.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
    if (RECTS_DELAY_MS) await p.send('Page.addScriptToEvaluateOnNewDocument', { source: RECTS_DELAY });
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: POLL_FAST });
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: hub ? WATCH.replace('if (window !== top) return;', 'if (window === top || window.parent !== top) return;') : WATCH });
    await p.send('Page.navigate', { url: hub ?? `${B}/${path}${hash}` });
    if (hub) {
      // the dashboard in the hub's project frame: every evaluation in its page, every mouse event at its frame's place in the hub
      const off = () => raw.ev("(() => { const f = [...document.querySelectorAll('iframe')].find((x) => !x.hidden && x.getBoundingClientRect().width > 0); if (!f) return null; const r = f.getBoundingClientRect(); return { x: r.left + f.clientLeft, y: r.top + f.clientTop }; })()");
      const end = Date.now() + 20000;
      while (!(await off()) && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
      if (!(await off())) assert.fail(`setup: the hub shows no project frame: ${J(await raw.ev("({ href: location.href, frames: [...document.querySelectorAll('iframe')].map((f) => [f.getAttribute('src'), f.hidden, f.getBoundingClientRect().width]), text: document.body.innerText.slice(0, 600) })"))}`);
      const at = async () => (await off()) ?? { x: 0, y: 0 };
      p = { ...raw,
        ev: (e) => raw.evIn(inHub, e),
        move: async (x, y, m) => { const o = await at(); return raw.move(x + o.x, y + o.y, m); },
        clickAt: async (x, y, m) => { const o = await at(); return raw.clickAt(x + o.x, y + o.y, m); },
      };
    }
    const soon = soonIn(p, 20000, () => dash.out());
    const settle = settleIn(p);
    await soon(path.startsWith('view/') ? VIEWER_TAB : LOADED, path ? 'setup: the viewer tab and its threads read' : 'setup: the dashboard and its threads read');
    const V = { p, soon, settle, state: () => p.ev(STATE) };
    // the window resized, and the page told of it
    V.size = async (w, h) => { await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await soon(`innerWidth === ${w} && innerHeight === ${h}`, `setup: the window ${w}x${h}`); await p.ev(FRAMES); };
    // how many words the frames' pages have said so far
    V.mark = () => p.ev('window.__own.length');
    const said = (from, page, hash = null) => `window.__own.slice(${from}).some((m) => m.own === 'at' && m.page === ${J(page)}${hash === null ? '' : ` && m.hash === ${J(hash)}`})`;
    // the stage's own frame said, since from, where page's elements are, drawn: none of them 0x0. A page's
    // word on its load can find its frame not yet drawn and say 0x0, its drawn word two frames later; up
    // on the first, an aim read at once found nothing, and a word held from then on was the drawn one (kit-948)
    const drawn = (from, page) => `window.__own.slice(${from}).some((m) => m.own === 'at' && m.page === ${J(page)} && window.__ownFrom.get(m) === tsFrame() && !!m.rects && Object.values(m.rects).every((r) => r.w > 0 && r.h > 0))`;
    // the viewer opened by its head (a new entry, as a link in the dashboard makes), up and its page loaded
    V.open = async (head) => {
      const n = await V.mark();
      await p.ev(`location.hash = ${J(head)}; void 0`);
      await V.up(head, n);
      if (RECTS_DELAY_MS) await p.ev('window.__rectsDelay = true');
    };
    // up on head's stage: the lens ready (and a preview's app at /), the page's own drawn word heard since from
    V.up = async (head, from) => {
      if (head.startsWith('#preview/')) {
        await soon(`${VIEWER_UP} && TS.kind === 'preview' && TS.ready && TS.route === '/'`, `setup: the preview's lens ready at / (the relay in the page's policy?): ${head}`);
        await soon(drawn(from, 'app/'), "setup: the app's page loaded in the lens and said where its elements are drawn");
      } else {
        const slug = /^#artifact\/main\/(.+)$/.exec(head)[1];
        await soon(`${VIEWER_UP} && TS.kind === 'artifact' && TS.slug === ${J(slug)} && TS.ready`, `setup: the viewer up on ${slug}, its lens ready`);
        await soon(drawn(from, `${slug}/index.html`), `setup: ${slug}'s page loaded in the frame and said where its elements are drawn`);
      }
    };
    // A real press at (x, y) on the dashboard's own element what (its id): drawn first and the mouse
    // moved there, so the press is hit-tested against what is on screen; one the page never got (Chrome
    // can drop the first press in a fresh document) is pressed once more, and said so.
    V.press = async (x, y, what) => {
      for (let i = 0; i < 2; i++) {
        const n = await p.ev('window.__clicks.length');
        await p.ev(FRAMES);
        await p.move(x, y);
        await p.ev(FRAMES);
        await p.clickAt(x, y);
        // (a press that took the tab off the page, as a close by history.back() can, reached it)
        if (await settle(`!document.getElementById('artifact-view') || !Array.isArray(window.__clicks) || window.__clicks.slice(${n}).includes(${J(what)})`, 1000)) return;
        t.diagnostic(`the press on #${what} never reached the page${i ? '' : ': pressed again'}`);
      }
      assert.fail(`setup: two presses on #${what} at ${x},${y} never reached the page`);
    };
    // A real click (CDP) inside the stage's frame on an element of the page there, at the place that
    // page last said it is, then a wait for the page it leads to (and, for a load, the frame's load event).
    V.frameClick = async (id, next, { hash = null, load = true } = {}) => {
      // the frame's box read the same twice running: the bar above it can still be settling
      await soon(STEADY, "setup: the stage's frame at rest");
      // the page now on the stage, by its own frame's word (a moved stage: the new page's, once it says it)
      if (!(await settle(`${AIM(id)} !== null`, 20000))) assert.fail(`setup: the page on the stage (${await p.ev(STAGE).catch(() => '?')}) never said where #${id} is`);
      const at = await p.ev(AIM(id));
      assert.ok(at, `setup: the page on the stage (${await p.ev(STAGE).catch(() => '?')}) no longer says where #${id} is`);
      assert.ok(at.hit, `setup: the point at #${id} is not on the stage's frame (it is on ${at.on})`);
      const n = await V.mark(), loads = await p.ev('window.__loads.length');
      // drawn first and the mouse moved there; a press the frame never acted on (no word from the page it
      // leads to in 3 s) is pressed once more: the next page has nothing at this point, so a second
      // press after a slow first one does nothing
      let went = false;
      for (let i = 0; i < 2 && !went; i++) {
        if (i) t.diagnostic(`the press on #${id} in the frame did nothing in 3 s: pressed again`);
        await p.ev(FRAMES);
        await p.move(at.x, at.y);
        await p.ev(FRAMES);
        await p.clickAt(at.x, at.y);
        went = await settle(said(n, next, hash), i ? 10000 : 3000);
      }
      if (!went) {
        const seen = await p.ev(`({ own: window.__own.slice(${n}), loads: window.__loads.slice(${loads}), active: document.activeElement?.id || document.activeElement?.tagName, frame: (() => { const r = tsFrame().getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })(), hidden: document.hidden, focus: document.hasFocus() })`);
        assert.fail(`setup: the click on #${id} at ${J(at)} never took the frame to ${next}${hash ? hash : ''}; since: ${J(seen)}`);
      }
      if (load) await soon(`window.__loads.slice(${loads}).some((l) => l.id === tsFrame().id)`, `setup: the stage's frame fired load after the click on #${id}`);
    };
    // The app's link inside a preview's lens, by a real click, then the lens's word that the route is /second.
    V.appLink = async () => {
      await V.frameClick('to-second', 'app/second', { load: false });
      await soon("TS.route === '/second'", "setup: the lens says the app's route is /second");
    };
    // counters zeroed and the length read, just before a close
    V.before = async () => p.ev('window.__backs = 0, window.__gos = [], window.__replaces = [], history.length');
    // how many key messages the lenses have sent so far
    V.keysMark = () => p.ev('window.__lensKeys.length');
    // Focus put on the dashboard's body, or on the stage's frame (so the lens has the keyboard), and checked.
    V.focusBody = async () => assert.equal(await p.ev('(() => { document.activeElement?.blur?.(); window.focus(); return document.activeElement === document.body; })()'), true, "setup: the dashboard's body has the focus");
    V.focusFrame = async () => assert.equal(await p.ev('(() => { const f = tsFrame(); f.focus(); return document.activeElement === f; })()'), true, 'setup: the stage\'s frame has the focus');
    // A full Escape press (CDP keyDown then keyUp) with the frame's focus, and the lens's keydown message
    // for it heard by the dashboard's window (task-1 T1-5: a press that never reached the lens would be
    // the dashboard's own Escape, not the lens's).
    // The keyUp waits until nothing it is aimed at is being removed (kit-305): the dashboard closes the
    // viewer on the keydown's message and swaps the frame out, and a keyUp sent to that out-of-process frame
    // while it goes is never answered (Input.dispatchKeyEvent's 30 s timeout). WATCH's message listener runs
    // before the dashboard's, so once the keydown is in __lensKeys the dashboard has acted on it: its
    // history.back or its replace is counted. A close begun is waited for; a press that closes nothing (a
    // card, pin mode) still sends its keyUp to the frame, so the lens's up message is there to check. The
    // counters are only read here, never zeroed: the DW3 cases read them.
    V.frameEscape = async () => {
      await V.focusFrame();
      const k = await V.keysMark();
      const [b0, r0] = await p.ev('[window.__backs, window.__replaces.length]');
      const ESC = { key: 'Escape', code: 'Escape', modifiers: 0, windowsVirtualKeyCode: 27 };
      await p.send('Input.dispatchKeyEvent', { type: 'keyDown', ...ESC });
      await soon(`window.__lensKeys.slice(${k}).some((m) => m.key === 'Escape' && m.up !== true)`, "the lens told the dashboard of the Escape's keydown");
      if (await p.ev(`window.__backs > ${b0} || window.__replaces.slice(${r0}).some((r) => r.leave) || !${VIEWER_UP}`)) await settle(CLOSED, 3000);
      await p.ev(FRAMES);
      await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...ESC });
      return k;
    };
    // Each closer (DW2): X pressed; Escape with the dashboard's focus; Escape with the frame's (a full
    // CDP press, so the lens sends what a real press sends: plan-1 P1-1, P1-5); a click on the scrim.
    V.close = async (kind) => {
      if (kind === 'x') {
        const at = await p.ev("(() => { const b = document.getElementById('av-close'), r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return { x, y, shown: r.width > 0 && r.height > 0, top: !!document.elementFromPoint(x, y)?.closest('#av-close'), on: (() => { const e = document.elementFromPoint(x, y); return e ? e.id || e.className || e.tagName : null; })() }; })()");
        assert.ok(at.shown, 'setup: the X is not shown');
        // the viewer's box leaves room for the open panel (--av-right), so nothing covers the X: a real press
        // on it, after checking it is what the point shows (a DOM click would pass with the X covered)
        assert.ok(at.top, `setup: the X is covered: the element at its centre is ${at.on}`);
        await V.press(at.x, at.y, 'av-close');
      } else if (kind === 'escape-dash') {
        await V.focusBody();
        await p.key('Escape');
      } else if (kind === 'escape-frame') {
        await V.frameEscape();
      } else if (kind === 'scrim') {
        const on = await p.ev('(() => { const e = document.elementFromPoint(6, 400); return e ? e.id || e.className || e.tagName : null; })()');
        assert.equal(on, 'scrim', 'setup: the point (6, 400) is on the scrim, outside the viewer');
        await V.press(6, 400, 'scrim');
      } else throw new Error(`no closer ${kind}`);
    };
    // Closed on head, within 3 s, or which part of it is wrong.
    V.closedOn = async (head, what) => {
      await settle(`${CLOSED} && location.hash === ${J(head)}`, 3000);
      const s = await V.state();
      assert.ok(s.dash, `${what}: the tab left the dashboard; it is at ${s.href}`);
      assert.equal(s.open, false, `${what}: the viewer is still visible (hash ${s.hash}, frames ${J(s.srcs)}, back called ${s.backs}x)`);
      assert.equal(s.avOpen, false, `${what}: body keeps av-open`);
      assert.deepEqual(s.srcs, [null, null], `${what}: a frame keeps its src`);
      assert.equal(s.hash, head, `${what}: closed on the wrong head`);
      return s;
    };
    V.reload = async () => {
      await p.ev('window.__old = true; void 0');
      await p.send('Page.reload');
      await soon(`!window.__old && ${LOADED}`, 'setup: the page reloaded and read');
    };
    // the peek's own X, pressed once the peek is at rest
    V.peekClose = async () => {
      await soon(PEEK, 'setup: the peek open and at rest');
      const at = await p.ev("(() => { const r = document.getElementById('drawer-close').getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return { x, y, top: !!document.elementFromPoint(x, y)?.closest('#drawer-close') }; })()");
      assert.ok(at.top, "setup: the peek's X is on top");
      await V.press(at.x, at.y, 'drawer-close');
    };
    return V;
  }
  const sub = (name, fn) => t.test(name, { timeout: 120000 }, fn);

  // The relay opened before any preview case (plan-1 P1-2): the first look at the preview opens it,
  // and the page, loaded without it in its policy, says to reload; every tab after loads with it.
  {
    const V = await visit(PV);
    await V.soon("(document.getElementById('av-note').textContent === 'Reload to view this preview' && !document.getElementById('av-note').hidden) || (TS.kind === 'preview' && TS.ready)", 'setup: the first look at the preview opened its relay');
    await V.reload();
    await V.soon("TS.kind === 'preview' && TS.ready && TS.route === '/'", 'setup: the preview shown through its relay once the page names it');
  }

  return { F, T, TA, TR, TK, name, AV_A, AV_B, PV, LIB_T, PROG_T, visit, sub };
}
