// Helpers the artifact viewer's live-reload tests share (artifact-live-reload.test.mjs, its split files
// artifact-live-reload.guards.test.mjs and artifact-live-reload.main-place.test.mjs (kit-757), and
// artifact-reload-removed.test.mjs, kit-755): the artifact's slug and draft, the page script that fakes
// /api/artifact-fp and logs reads and lens readies, a poll for a page expression, the titled pages of
// main's versions, and a click on one of their links; the draft test's pages (mock), a landing on main
// (land) and the draft test's stage (draftStage).
import assert from 'node:assert/strict';
import path from 'node:path';
import { write, dashboardOnFreePort, threadsFixture } from './kit.mjs';
import { cleanup, openChrome } from './chrome.mjs';

export const J = JSON.stringify;
export const SLUG = 'live-mock', WT = 'demo-01-draft';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The fake /api/artifact-fp, matched by the request's path however it is called (a string, a URL, a
// Request): it answers from window.__fake ({ status, fp, body, delay }: fp null answers what the stage
// loaded, TS.fp, or a fixed one when the stage knows none, i.e. "unchanged"; body, a raw body in place
// of the JSON; delay, ms held, given up when the page's signal aborts), and logs each ask (its time,
// whether the page read as hidden then). Every other request goes on. Also: every /api/data and
// /api/view read, with whether it landed; document.visibilityState as window.__hidden says; the lens's
// ready titles, with their time. window.__artStatus ({ <path>: answer }): a page's own fetch of that
// /artifact/ path (a reload's ask, kit-755) logged in __artAsks and answered by `answer`: a status; 0, a
// network error (fetch's TypeError); { status, hold }, held until the test calls __artRelease[hold]()
// (a held ask its page gives up on rejects as fetch does); or an array of these, one taken per ask, the
// request going on once it is empty.
export const PAGE = `(() => {
  // C10: a viewer tab whose address carries kit106-framed stands for one under the owner's wrapper, a
  // parent of another origin: its window.parent is another window (a stand-in that takes messages and
  // does nothing), and frameElement stays null, as under any parent of another origin
  if (window.parent === window && location.pathname.startsWith('/view/') && new URLSearchParams(location.search).has('kit106-framed')) { const stand = { postMessage() {} }; Object.defineProperty(window, 'parent', { configurable: true, get: () => stand }); }
  window.__fake = { status: 200, fp: null, body: null, delay: 0 };
  window.__fpAsks = [];
  window.__reads = [];
  window.__hidden = false;
  window.__artStatus = {};
  window.__artAsks = [];
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get() { return window.__hidden ? 'hidden' : 'visible'; } });
  const f = window.fetch;
  window.fetch = async (u, o) => {
    const s = u instanceof Request ? u.url : String(u);
    let pathname = '';
    try { pathname = new URL(s, location.href).pathname; } catch {}
    if (pathname === '/api/artifact-fp') {
      const ask = { u: s, t: Date.now(), hidden: document.visibilityState !== 'visible', done: false };
      window.__fpAsks.push(ask);
      const k = { ...window.__fake };
      if (k.delay) await new Promise((res, rej) => { const tm = setTimeout(res, k.delay); o?.signal?.addEventListener('abort', () => { clearTimeout(tm); ask.done = true; rej(new DOMException('aborted', 'AbortError')); }); });
      ask.done = true;
      const fp = k.fp ?? (typeof TS === 'object' && TS.fp ? TS.fp : 'a'.repeat(64));
      const body = k.body ?? (k.status === 200 ? JSON.stringify({ fp, at: new URL(s, location.href).searchParams.get('at') }) : JSON.stringify({ error: 'no draft' }));
      return new Response(body, { status: k.status, headers: { 'content-type': 'application/json' } });
    }
    const art = window.__artStatus[pathname];
    const k = Array.isArray(art) ? art.shift() : art;
    if (k !== undefined) {
      window.__artAsks.push(pathname);
      const { status, hold = null } = typeof k === 'number' ? { status: k } : k;
      if (hold) await new Promise((res, rej) => { (window.__artRelease ??= {})[hold] = res; o?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); });
      if (status === 0) throw new TypeError('Failed to fetch');
      return new Response('faked', { status });
    }
    const x = { u: s, landed: false };
    if (pathname === '/api/data' || pathname === '/api/view') window.__reads.push(x);
    const r = await f(u, o);
    for (const m of ['json', 'text']) { const g = r[m].bind(r); r[m] = () => g().finally(() => { x.landed = true; }); }
    return r;
  };
  window.__titles = [];
  addEventListener('message', (e) => { const fr = document.getElementById('av-frame'); if (fr && e.source === fr.contentWindow && e.data?.lens === 1 && e.data.type === 'ready') window.__titles.push({ title: e.data.title, t: Date.now() }); });
})();`;

export const soonIn = (p, ms = 30000) => async (expr, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v, err = null;
    try { v = await p.ev(expr); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) {
      const at = await p.ev('[location.href, JSON.stringify(window.__titles ?? null), (window.__fpAsks ?? []).length]').catch((e) => e.message);
      assert.fail(`timed out: ${what}; the tab: ${JSON.stringify(at)}${err ? `; last: ${err.message}` : ''}`);
    }
    await sleep(50);
  }
};

// main's versions, for a reload told from the page it lands on: each version's pages carry its title
// (index.html: the version plus location.hash; page2.html: the version and -page2); a link at the top
// left goes to page2.html, one beside it to #tab2.
export const placed = (title) => ({
  'artifact.json': J({ v: 1, title: 'Live mock', summary: 'A page that changes', by: 'supervisor', for: [] }),
  'index.html': `<!doctype html><html><head><title>${title}</title></head><body style="margin:0"><a id="p2" href="page2.html" style="display:block;position:fixed;left:0;top:0;width:80px;height:40px;background:#ccc">page 2</a><a id="t2" href="#tab2" style="display:block;position:fixed;left:100px;top:0;width:80px;height:40px;background:#ccc">tab 2</a><p id="section" style="margin-top:60px">${title}</p><p id="tab2" style="margin-top:900px">tab 2</p><script>document.title = ${J(title)} + location.hash; addEventListener('hashchange', () => { document.title = ${J(title)} + location.hash; });</script></body></html>`,
  'page2.html': `<!doctype html><html><head><title>${title}-page2</title></head><body><p>the second page</p></body></html>`,
});

// A click on one of the page's links (dx from the frame's left, 15 px down), and the lens naming where
// it went. The click goes where the frame is on top, and is sent again (up to 3 times, 5 s apart) while
// the lens names nothing new: a click sent just after the frame's ready sometimes moves nothing (about 1
// run in 3 on the dashboard's stage, its rect and the element at the point unchanged; said as a
// diagnostic). A click sent again lands on the same link or, once it went, on nothing on page2.html or
// the same #tab2, so it moves nothing further.
export const follower = (p, t) => async (dx, lens) => {
  const at = `(() => { const f = document.getElementById('av-frame'), b = f.getBoundingClientRect(), x = b.left + ${dx}, y = b.top + 15; return JSON.stringify({ x, y, on: document.elementFromPoint(x, y) === f }); })()`;
  for (let i = 1; ; i++) {
    const r = JSON.parse(await p.ev(at));
    assert.ok(r.on, `the frame is on top at the click point: ${J(r)}`);
    await p.clickAt(r.x, r.y);
    try { await soonIn(p, 5000)(lens, `the lens names ${lens}`); return; } catch (e) { if (i === 3) throw e; t.diagnostic(`click ${i} moved nothing on ${await p.ev('location.pathname + location.hash')}; sent again`); }
  }
};

// The page's own title says what it is and the anchor it loaded at (the lens's ready carries
// document.title); a link at its top left goes to its second page.
export const mock = (title) => ({
  'artifact.json': J({ v: 1, title: 'Live mock', summary: 'A page that changes', by: 'supervisor', for: [] }),
  'index.html': `<!doctype html><html><head><title>${title}</title></head><body style="margin:0"><a id="p2" href="page2.html" style="display:block;position:fixed;left:0;top:0;width:80px;height:40px;background:#ccc">page 2</a><p id="section" style="margin-top:60px">${title}</p><script>document.title = ${J(title)} + location.hash;</script></body></html>`,
  'page2.html': '<!doctype html><html><head><title>page2</title></head><body><p>the second page</p></body></html>',
});

// An artifact landed on main, as a merged PR puts it there: its tree id.
export function land(F, files) {
  const dir = path.join(F.old, 'docs/devteam/project/artifacts', SLUG);
  for (const [rel, text] of Object.entries(files)) write(path.join(dir, rel), text);
  F.g(['add', '-A', dir], F.old);
  F.g(['commit', '-qm', `artifact: ${SLUG}`], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
  return F.g(['rev-parse', `HEAD:docs/devteam/project/artifacts/${SLUG}`], F.old);
}

// The draft test's stage (kit-106), set up anew by each file that holds a part of its subtests
// (artifact-live-reload.test.mjs and artifact-live-reload.guards.test.mjs, kit-757): its own fixture
// with main's mock('main') landed (its tree id) and the draft at v1 before the dashboard starts, a
// Chrome page with PAGE on every document, and the helpers the subtests use.
export async function draftStage(t, name) {
  const later = cleanup(t);
  const F = threadsFixture(name);
  later(() => F.done());
  const tree = land(F, mock('main'));
  const draft = path.join(F.old, `.worktrees/${WT}/docs/devteam/project/artifacts/${SLUG}`);
  const edit = (title) => { for (const [rel, text] of Object.entries(mock(title))) write(path.join(draft, rel), text); };
  // before the dashboard starts: its first read lists the draft
  edit('v1');
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  const B = `http://127.0.0.1:${port}`;
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE });
  const soon = soonIn(p);
  const VIEW = `${B}/view/artifact/${SLUG}`;
  const DRAFT_HEAD = `#artifact/wt/${WT}/${SLUG}`;
  const DASH_DRAFT = `${B}/${DRAFT_HEAD}`;
  const DASH_MAIN = `${B}/#artifact/main/${SLUG}`;
  const up = (at, title) => `typeof TS === 'object' && TS.kind === 'artifact' && TS.at === ${J(at)} && window.__titles.length >= 1${title ? ` && __titles[0].title === ${J(title)}` : ''}`;
  // a page on the stage, in a document of its own (from about:blank: a hash-only move would keep the
  // last document and its logs), once its frame's lens has said ready (`title`, or any)
  const go = async (url) => {
    await p.send('Page.navigate', { url: 'about:blank' });
    await soon(`location.href === 'about:blank'`, 'about:blank');
    await p.send('Page.navigate', { url });
  };
  const open = async (url, at, title = null) => {
    await go(url);
    await soon(up(at, title), `${url}: the stage up, its frame ready`);
  };
  // the dashboard on #library, then the draft opened over it, as a link in the page opens it
  const openOverLibrary = async () => {
    await go(`${B}/#library`);
    await soon(`typeof PAGE_NOW === 'string' && PAGE_NOW === 'library'`, 'on #library');
    await p.ev(`(location.hash = ${J(DRAFT_HEAD)}, true)`);
    await soon(up(WT, 'v1'), 'the draft over #library');
  };
  const asks = () => p.ev('__fpAsks.length');
  const titles = () => p.ev('__titles.map((x) => x.title)');
  // fp changed at the fake: the time it changed, in the page's clock
  const change = (fp) => p.ev(`(window.__fake.fp = ${J(fp)}, Date.now())`);
  const reloadedSince = (t0, what) => soonIn(p, 10000)(`__titles.find((x) => x.t > ${t0})`, what);
  const NEW_FP = 'f'.repeat(64);
  return { F, tree, draft, edit, B, p, soon, VIEW, DRAFT_HEAD, DASH_DRAFT, DASH_MAIN, up, go, open, openOverLibrary, asks, titles, change, reloadedSince, NEW_FP };
}
