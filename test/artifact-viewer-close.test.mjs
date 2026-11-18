// The artifact viewer closes (kit-141): X, Escape (with the dashboard's focus or the frame's) and a click
// on the scrim close it, back on the head it was opened over, whatever the page inside it has done, and
// the history is left as the spec says (spec §Acceptance checks DW1 to DW3). Headless Chrome against a
// real dashboard on a project of its own (threadsFixture), skipped where Chrome can't be driven, as the
// kit's other Chrome tests are.
//
// The joint session history is what this is about: a frame's own navigation adds an entry to the tab's
// history, so a close by history.back() after the frame has moved steps the frame back and leaves the
// viewer open. Every case runs in a tab of its own (one Chrome for the file): history.length stops at 50
// in a tab, and the file makes far more entries than that, so a length "unchanged" in a shared tab would
// prove nothing.
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { threadsFixture, dashboardOnFreePort, PORTS } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const SKIP = canDrive ? false : 'needs Chrome and a Node with WebSocket';
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'artifact-viewer');
const J = JSON.stringify;
const idOf = (out) => out.split('\n')[0].trim();

// The laptop's preview relays, in this file's own block of ports (lib/ports.mjs's layout: +62..79).
const RELAY_ENV = { DEVTEAM_RELAY_PORTS: `${PORTS + 62}-${PORTS + 79}` };

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
// - what the frames' pages say (their { own: 'at' } messages: which page, its hash, where its elements are);
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
  addEventListener('message', (e) => { if (e.data && e.data.own) window.__own.push(e.data); });
  window.__loads = [];
  // every click that reached the dashboard's own document, by what it landed on (a press the page never
  // got is a missed press, not a close that failed)
  window.__clicks = [];
  document.addEventListener('click', (e) => { const el = e.target; window.__clicks.push(el && el.nodeType === 1 ? (el.closest('#av-close') ? 'av-close' : el.closest('#drawer-close') ? 'drawer-close' : el.id || el.tagName) : null); }, true);
  document.addEventListener('load', (e) => { const f = e.target; if (f && f.tagName === 'IFRAME') window.__loads.push({ id: f.id, src: f.getAttribute('src') }); }, true);
})()`;

// Resolves after two frames: whatever was just set has been drawn.
const FRAMES = 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))';
const LOADED = 'typeof DATA === "object" && DATA !== null && TL.have > 0';
const VIEW = "document.getElementById('artifact-view')";
const VIEWER_UP = `(!${VIEW}.hidden && document.body.classList.contains('av-open'))`;
// Closed (spec §Acceptance checks): #artifact-view hidden, body without av-open, neither frame with a src.
const CLOSED = `(() => { const v = ${VIEW}; return !!v && v.hidden && !document.body.classList.contains('av-open') && !['av-frame', 'pv-frame'].some((id) => document.getElementById(id)?.hasAttribute('src')); })()`;
// a peek open and at rest (not sliding: a press on its X mid-slide is the slide's, not the X's)
const PEEK = "(!document.getElementById('drawer').hidden && document.body.classList.contains('peek-open') && getComputedStyle(document.getElementById('drawer')).transform === 'none')";
// True once the stage's frame's box reads the same twice running (soon's polls are 50 ms apart).
const STEADY = "(() => { const r = tsFrame().getBoundingClientRect(), k = [r.left, r.top, r.width, r.height].join(); const was = window.__steady; window.__steady = k; return was === k; })()";
const CARD = "document.getElementById('tl-card')";
const IN_PANEL = (id) => `(!!document.querySelector('#th-card-slot > #tl-card.in-panel') && !${CARD}.hidden && ${CARD}.dataset.key === '${id}')`;
// What a case checks after a close, read in one go (and readable on a page that isn't the dashboard).
const STATE = `(() => { const v = ${VIEW}; return {
  href: location.href, hash: location.hash, dash: location.pathname === '/' && !!v,
  open: v ? !v.hidden : null, avOpen: document.body ? document.body.classList.contains('av-open') : null,
  srcs: ['av-frame', 'pv-frame'].map((id) => document.getElementById(id)?.getAttribute('src') ?? null),
  length: history.length, state: history.state, backs: window.__backs, gos: window.__gos,
  leaveReplaces: (window.__replaces || []).filter((r) => r.leave).length,
  slug: typeof TS === 'object' ? TS.slug : null, kind: typeof TS === 'object' ? TS.kind : null } })()`;

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

test('the viewer closes, whatever the page inside it did', { skip: SKIP, timeout: 1500000 }, async (t) => {
  const later = cleanup(t);
  const F = threadsFixture('artifact-viewer-close');
  later(() => F.done());
  land(F);
  // T: a thread with no subject (it opens in the panel); TA: one on viewer-a's #pin-me (DW3 g, and T3's and T4's)
  const T = idOf(F.owner(['thread', 'new', 'Where do we start?']));
  F.sup(['thread', 'reply', T, 'Here, I think.']);
  const TA = idOf(F.owner(['thread', 'new', 'This button', '--subject', J({ kind: 'artifact', slug: 'viewer-a', at: 'main', path: 'index.html', anchor: { selector: '#pin-me', tag: 'button', text: 'Pin me' } })]));
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
  let tab = null;
  later(async () => { if (tab) { await tab.send('Page.close').catch(() => {}); tab.close(); } });
  async function visit(hash) {
    if (tab) { await tab.send('Page.close').catch(() => {}); tab.close(); tab = null; }
    const p = await chrome.newPage();
    tab = p;
    // the tab in front: a hidden one draws nothing, and the mouse is hit-tested against what it drew
    await p.send('Page.bringToFront');
    await p.send('Page.enable');
    await p.send('Runtime.enable');
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: POLL_FAST });
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: WATCH });
    await p.send('Page.navigate', { url: `${B}/${hash}` });
    const soon = soonIn(p, 20000, () => dash.out());
    const settle = settleIn(p);
    await soon(LOADED, 'setup: the dashboard and its threads read');
    const V = { p, soon, settle, state: () => p.ev(STATE) };
    // how many words the frames' pages have said so far
    V.mark = () => p.ev('window.__own.length');
    const said = (from, page, hash = null) => `window.__own.slice(${from}).some((m) => m.own === 'at' && m.page === ${J(page)}${hash === null ? '' : ` && m.hash === ${J(hash)}`})`;
    // the viewer opened by its head (a new entry, as a link in the dashboard makes), up and its page loaded
    V.open = async (head) => {
      const n = await V.mark();
      await p.ev(`location.hash = ${J(head)}; void 0`);
      await V.up(head, n);
    };
    // up on head's stage: the lens ready (and a preview's app at /), the page's own word heard since from
    V.up = async (head, from) => {
      if (head.startsWith('#preview/')) {
        await soon(`${VIEWER_UP} && TS.kind === 'preview' && TS.ready && TS.route === '/'`, `setup: the preview's lens ready at / (the relay in the page's policy?): ${head}`);
        await soon(said(from, 'app/'), "setup: the app's page loaded in the lens");
      } else {
        const slug = /^#artifact\/main\/(.+)$/.exec(head)[1];
        await soon(`${VIEWER_UP} && TS.kind === 'artifact' && TS.slug === ${J(slug)} && TS.ready`, `setup: the viewer up on ${slug}, its lens ready`);
        await soon(said(from, `${slug}/index.html`), `setup: ${slug}'s page loaded in the frame`);
      }
    };
    // A real click (CDP) inside the stage's frame on an element of the page there, at the place that
    // page last said it is, then a wait for the page it leads to (and, for a load, the frame's load event).
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
    V.frameClick = async (id, next, { hash = null, load = true } = {}) => {
      // the frame's box read the same twice running: the bar above it can still be settling
      await soon(STEADY, "setup: the stage's frame at rest");
      await soon(`window.__own.some((m) => m.own === 'at' && m.rects && m.rects[${J(id)}] && m.rects[${J(id)}].w > 0)`, `setup: the page on the stage says where #${id} is`);
      const at = await p.ev(`(() => { const m = window.__own.filter((m) => m.own === 'at' && m.rects && m.rects[${J(id)}] && m.rects[${J(id)}].w > 0).pop(); if (!m) return null; const f = tsFrame(), r = f.getBoundingClientRect(), e = m.rects[${J(id)}]; const x = r.left + f.clientLeft + e.x + e.w / 2, y = r.top + f.clientTop + e.y + e.h / 2, hit = document.elementFromPoint(x, y); return { x, y, hit: hit === f, on: hit ? hit.id || hit.className || hit.tagName : null }; })()`);
      assert.ok(at, `setup: the page on the stage never said where #${id} is`);
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
    // Each closer (DW2): X pressed; Escape with the dashboard's focus; Escape with the frame's (a full
    // CDP press, so the lens sends what a real press sends: plan-1 P1-1, P1-5); a click on the scrim.
    V.close = async (kind) => {
      if (kind === 'x') {
        const at = await p.ev("(() => { const b = document.getElementById('av-close'), r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return { x, y, shown: r.width > 0 && r.height > 0, top: !!document.elementFromPoint(x, y)?.closest('#av-close') }; })()");
        assert.ok(at.shown, 'setup: the X is not shown');
        // On main the viewer's box (inset: 10%) runs under the open panel above 900px, so the X can be
        // under the panel (T4's box, var(--av-right), moves it clear): then a DOM click on it, which
        // reaches the same listener. DW6 checks the box itself.
        if (at.top) await V.press(at.x, at.y, 'av-close');
        else { t.diagnostic('the X was under something: pressed by a DOM click'); await p.ev("document.getElementById('av-close').click(), true"); }
      } else if (kind === 'escape-dash') {
        assert.equal(await p.ev('(() => { document.activeElement?.blur?.(); window.focus(); return document.activeElement === document.body; })()'), true, "setup: the dashboard's body has the focus");
        await p.key('Escape');
      } else if (kind === 'escape-frame') {
        assert.equal(await p.ev('(() => { const f = tsFrame(); f.focus(); return document.activeElement === f; })()'), true, 'setup: the stage\'s frame has the focus');
        await p.key('Escape');
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

  // DW1: the bug, reproduced on main: the frame's link adds the history's newest entry, and a close by
  // history.back() steps the frame back, leaving the viewer open.
  await sub('DW1: X after an in-frame link closes the viewer on #library', async () => {
    const V = await visit('#library');
    await V.open(AV_A);
    await V.frameClick('to-b', 'viewer-a/b.html');
    await V.close('x');
    await V.closedOn('#library', 'X after the link');
  });

  // DW2: every closer, every move: closed, on the head it was opened over.
  const MOVES = {
    // opened from the panel open on a thread; the close carries its th and t
    link: async (V, kind) => {
      assert.equal(await V.p.ev('location.hash'), LIB_T, 'setup: the visit on the panel\'s head');
      await V.soon(IN_PANEL(T), 'setup: T open in the panel');
      await V.open(AV_A);
      await V.frameClick('to-b', 'viewer-a/b.html');
      await V.close(kind);
      await V.closedOn(LIB_T, `${kind} after the link`);
    },
    // open A, close it, open B (a second src on the frame), close it
    'open A, close, open B': async (V, kind) => {
      await V.open(AV_A);
      await V.close(kind);
      await V.closedOn('#library', `${kind}, the first close (A)`);
      await V.open(AV_B);
      await V.close(kind);
      await V.closedOn('#library', `${kind}, the second close (B)`);
    },
    // a preview whose app moves to /second inside the lens
    'preview route': async (V, kind) => {
      await V.open(PV);
      await V.appLink();
      await V.close(kind);
      await V.closedOn('#library', `${kind} after the app's route change`);
    },
  };
  for (const [move, run] of Object.entries(MOVES)) {
    for (const kind of ['x', 'escape-dash', 'escape-frame', 'scrim']) {
      await sub(`DW2: ${kind} after ${move}`, async () => run(await visit(move === 'link' ? LIB_T : '#library'), kind));
    }
  }

  // DW3: history. a: no move, so a close by history.back(), as main does.
  await sub('DW3 a: no frame move: X goes back one entry', async () => {
    const V = await visit('#library');
    await V.open(AV_A);
    const n = await V.before();
    await V.close('x');
    const s = await V.closedOn('#library', 'X with no move');
    assert.equal(s.backs, 1, 'history.back called once');
    assert.equal(s.leaveReplaces, 0, 'no replaceState by leaveArtifact');
    assert.equal(s.length, n, 'history.length unchanged');
  });
  await sub('DW3 b: after an in-frame link: X replaces, never back', async () => {
    const V = await visit('#library');
    await V.open(AV_A);
    await V.frameClick('to-b', 'viewer-a/b.html');
    const n = await V.before();
    await V.close('x');
    const s = await V.closedOn('#library', 'X after the link');
    assert.equal(s.backs, 0, 'history.back not called');
    assert.equal(s.length, n, 'history.length unchanged');
    assert.deepEqual(s.state, { page: '#library', depth: 0, openedHere: false }, 'the stamp');
  });

  // c: over a ticket peek opened on #progress with the panel open on T
  const overPeek = async () => {
    const V = await visit(PROG_T);
    assert.equal(await V.p.ev('location.hash'), PROG_T, "setup: the visit on the panel's head");
    await V.soon(IN_PANEL(T), 'setup: T open in the panel');
    await V.p.ev(`location.hash = '#ticket/${TK}'; void 0`);
    await V.soon(`${PEEK} && location.hash === '#ticket/${TK}'`, 'setup: the ticket peek');
    const peekState = await V.p.ev('history.state');
    await V.open(AV_A);
    return { V, peekState };
  };
  const PEEK_BACK = `${CLOSED} && location.hash === '#ticket/${TK}' && ${PEEK}`;
  await sub('DW3 c: from a ticket peek, no move: X back to the peek, its X back to the page', async () => {
    const { V, peekState } = await overPeek();
    const n = await V.before();
    await V.close('x');
    await V.settle(PEEK_BACK, 3000);
    const s = await V.state();
    assert.equal(s.open, false, `the viewer is still visible (hash ${s.hash})`);
    assert.equal(s.hash, `#ticket/${TK}`, 'back on the peek');
    assert.equal(await V.p.ev(PEEK), true, 'the peek open');
    assert.deepEqual(s.state, peekState, "the peek's stamp as it was when it opened");
    assert.deepEqual(s.state, { page: PROG_T, depth: 1, openedHere: true }, "the peek's stamp");
    assert.equal(s.length, n, 'history.length unchanged');
    await V.before();
    await V.peekClose();
    await V.settle(`location.hash === ${J(PROG_T)} && document.getElementById('drawer').hidden`, 3000);
    const s2 = await V.state();
    assert.equal(s2.hash, PROG_T, `the peek's X walks back one entry (history.go called with ${J(s2.gos)}, the drawer ${await V.p.ev("document.getElementById('drawer').hidden ? 'hidden' : 'shown'")})`);
  });
  for (const moves of [1, 2]) {
    await sub(`DW3 c: from a ticket peek, after ${moves} move${moves > 1 ? 's' : ''}: X restores the peek in place, its X closes it in place`, async () => {
      const { V } = await overPeek();
      await V.frameClick('to-b', 'viewer-a/b.html');
      if (moves > 1) await V.frameClick('to-c', 'viewer-a/c.html');
      const n = await V.before();
      await V.close('x');
      await V.settle(PEEK_BACK, 3000);
      const s = await V.state();
      assert.equal(s.open, false, `the viewer is still visible (hash ${s.hash}, back called ${s.backs}x)`);
      assert.equal(s.hash, `#ticket/${TK}`, 'on the peek');
      assert.equal(await V.p.ev(`${PEEK} && PAGE_NOW === 'progress'`), true, 'the peek open over #progress');
      assert.deepEqual(s.state, { page: PROG_T, depth: 1, openedHere: false }, "the peek's stamp, by hand");
      assert.equal(s.length, n, 'history.length unchanged');
      await V.peekClose();
      await V.settle(`location.hash === ${J(PROG_T)} && document.getElementById('drawer').hidden`, 3000);
      assert.equal(await V.p.ev('location.hash'), PROG_T, "the peek's X closes it");
      const s2 = await V.state();
      assert.equal(s2.open, false, 'the viewer hidden');
      assert.equal(s2.state?.depth, 0, 'the page entry, depth 0');
      assert.equal(s2.length, n, 'history.length unchanged after the peek closes in place');
      await V.p.ev('history.forward(); void 0');
      await new Promise((r) => setTimeout(r, 700));
      assert.equal(await V.p.ev('location.hash'), PROG_T, 'history.forward() moves nothing: no entry left ahead');
    });
  }

  // d: a reload of the viewer's entry: its first route, so a replace to the page its stamp names
  for (const moved of [false, true]) {
    await sub(`DW3 d: reloaded over a ticket peek, ${moved ? 'moved once after' : 'unmoved'}: X replaces to the page`, async () => {
      const { V } = await overPeek();
      await V.reload();
      // (a new document: what its frames say is counted from 0 again)
      await V.up(AV_A, 0);
      if (moved) await V.frameClick('to-b', 'viewer-a/b.html');
      const n = await V.before();
      await V.close('x');
      const s = await V.closedOn(PROG_T, `X after the reload${moved ? ' and a link' : ''}`);
      assert.equal(s.backs, 0, 'history.back not called');
      assert.equal(s.length, n, 'history.length unchanged');
      assert.deepEqual(s.state, { page: PROG_T, depth: 0, openedHere: false }, 'the stamp');
      if (moved) {
        await V.p.ev(`location.hash = '#ticket/${TK}'; void 0`);
        await V.soon(`${PEEK} && location.hash === '#ticket/${TK}'`, 'a ticket peek opened next');
        await V.peekClose();
        await V.soon(`location.hash === ${J(PROG_T)} && document.getElementById('drawer').hidden`, "its X lands on the page");
      }
    });
  }

  // e: cold links (the visit's first route): closed by replace to #library
  for (const head of [AV_A, PV]) {
    await sub(`DW3 e: a cold link to ${head.startsWith('#preview/') ? 'a preview' : 'an artifact'}: X replaces to #library`, async () => {
      const V = await visit(head);
      // the relay is open already, so the page names it; a page that still says to reload is reloaded once
      if (head === PV && await V.p.ev("!document.getElementById('av-note').hidden && document.getElementById('av-note').textContent === 'Reload to view this preview'")) await V.reload();
      await V.up(head, 0);
      const n = await V.before();
      await V.close('x');
      const s = await V.closedOn('#library', 'X on a cold link');
      assert.equal(s.backs, 0, 'history.back not called');
      assert.ok(s.leaveReplaces >= 1, 'closed by replaceState');
      assert.equal(s.length, n, 'history.length unchanged');
      assert.deepEqual(s.state, { page: '#library', depth: 0, openedHere: false }, 'the stamp');
    });
  }

  // f: a preview reloaded (its first route again), then the app's route change
  await sub('DW3 f: a reloaded preview after a route change: X replaces to #library', async () => {
    const V = await visit('#library');
    await V.open(PV);
    await V.reload();
    await V.up(PV, 0);
    await V.appLink();
    const n = await V.before();
    await V.close('x');
    const s = await V.closedOn('#library', 'X after the reload and the route change');
    assert.equal(s.backs, 0, 'history.back not called');
    assert.deepEqual(s.state, { page: '#library', depth: 0, openedHere: false }, 'the stamp');
    assert.equal(s.length, n, 'history.length unchanged');
  });

  // g: opened by a thread's card (#talk/<id>): routing that head again reopens the viewer, so the close
  // goes to the page under the card and stays closed
  for (const moved of [false, true]) {
    await sub(`DW3 g: from a #talk/ card, ${moved ? 'after an in-frame link' : 'no move'}: X closes and it stays closed`, async () => {
      const V = await visit('#library');
      const n0 = await V.mark();
      await V.p.ev(`location.hash = '#talk/${TA}'; void 0`);
      await V.up(AV_A, n0);
      assert.equal(await V.p.ev('location.hash'), AV_A, "setup: the card's thread opened the viewer on its artifact");
      const under = await V.p.ev('history.state?.page');
      assert.ok(under, "setup: the viewer entry's stamp names a page");
      if (moved) await V.frameClick('to-b', 'viewer-a/b.html');
      const n = await V.before();
      await V.close('x');
      await V.closedOn(under, 'X');
      await new Promise((r) => setTimeout(r, 1000));
      const s = await V.closedOn(under, 'still closed 1 s later');
      assert.equal(s.backs, 0, 'history.back not called');
      assert.equal(s.length, n, 'history.length unchanged');
      assert.equal(s.state?.depth, 0, 'the stamp, depth 0');
    });
  }

  // Two close cases of T2's (plan-2 P2-1, plan-3 P3-1): a close must never leave the viewer unable to close again.
  await sub('viewer A, then B over it, then X twice: back to A, then closed', async () => {
    const V = await visit('#library');
    await V.open(AV_A);
    const n = await V.mark();
    await V.p.ev(`location.hash = ${J(AV_B)}; void 0`);
    await V.up(AV_B, n);
    await V.close('x');
    await V.settle(`location.hash === ${J(AV_A)} && ${VIEWER_UP} && TS.slug === 'viewer-a'`, 3000);
    const s = await V.state();
    assert.equal(s.hash, AV_A, "the first X: back on A's entry");
    assert.equal(s.open, true, 'the first X: the viewer still up');
    assert.equal(s.slug, 'viewer-a', 'the first X: on A');
    await V.soon('TS.ready', "A's lens ready again");
    await V.close('x');
    await V.closedOn('#library', 'the second X');
  });
  await sub('an in-frame #anchor link, then X, then X: closed at the end', async () => {
    const V = await visit('#library');
    await V.open(AV_A);
    await V.frameClick('to-anchor', 'viewer-a/index.html', { hash: '#anchor', load: false });
    await V.close('x');
    // the first X may only step the frame back off its #anchor (an in-frame fragment move is kit-142's), but
    // it must never lock the viewer: a second X, if it is still open, closes it
    await V.settle(CLOSED, 1500);
    if (await V.p.ev(VIEWER_UP)) await V.close('x');
    await V.closedOn('#library', 'X, then X');
  });
});
