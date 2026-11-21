// The viewer reloads a draft by itself when its files change (kit-106): every 2 s while the page is seen,
// a viewer on a draft asks /api/artifact-fp, and on a new fingerprint loads its frame again in a fresh
// frame (no history entry: kit-141's close rule), at the anchor its address carried or the page the lens
// last named. A 404 says the draft was landed or removed, links main's version (shown in place) and stops
// the asking; main and a published tree are never asked about, and keep kit-206's outline on Reload, which
// a draft never shows. Headless Chrome against a real dashboard; the fingerprint route is faked in the
// page (a fetch wrapper), so the test says when the draft "changed" and how the route answers.
// Skipped where Chrome can't be driven, as the kit's other Chrome tests are.
// Ports: none of its own (lib/kit.mjs's +0 hub, +1..25)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { write, dashboardOnFreePort, threadsFixture } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const J = JSON.stringify;
const SLUG = 'live-mock', WT = 'demo-01-draft';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The page's own title says what it is and the anchor it loaded at (the lens's ready carries
// document.title); a link at its top left goes to its second page.
const mock = (title) => ({
  'artifact.json': J({ v: 1, title: 'Live mock', summary: 'A page that changes', by: 'supervisor', for: [] }),
  'index.html': `<!doctype html><html><head><title>${title}</title></head><body style="margin:0"><a id="p2" href="page2.html" style="display:block;position:fixed;left:0;top:0;width:80px;height:40px;background:#ccc">page 2</a><p id="section" style="margin-top:60px">${title}</p><script>document.title = ${J(title)} + location.hash;</script></body></html>`,
  'page2.html': '<!doctype html><html><head><title>page2</title></head><body><p>the second page</p></body></html>',
});

// The fake /api/artifact-fp, matched by the request's path however it is called (a string, a URL, a
// Request): it answers from window.__fake ({ status, fp, body, delay }: fp null answers what the stage
// loaded, TS.fp, or a fixed one when the stage knows none, i.e. "unchanged"; body, a raw body in place
// of the JSON; delay, ms held, given up when the page's signal aborts), and logs each ask (its time,
// whether the page read as hidden then). Every other request goes on. Also: every /api/data and
// /api/view read, with whether it landed; document.visibilityState as window.__hidden says; the lens's
// ready titles, with their time.
const PAGE = `(() => {
  // C10: a viewer tab whose address carries kit106-framed stands for one under the owner's wrapper, a
  // parent of another origin: its window.parent is another window (a stand-in that takes messages and
  // does nothing), and frameElement stays null, as under any parent of another origin
  if (window.parent === window && location.pathname.startsWith('/view/') && new URLSearchParams(location.search).has('kit106-framed')) { const stand = { postMessage() {} }; Object.defineProperty(window, 'parent', { configurable: true, get: () => stand }); }
  window.__fake = { status: 200, fp: null, body: null, delay: 0 };
  window.__fpAsks = [];
  window.__reads = [];
  window.__hidden = false;
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
    const x = { u: s, landed: false };
    if (pathname === '/api/data' || pathname === '/api/view') window.__reads.push(x);
    const r = await f(u, o);
    for (const m of ['json', 'text']) { const g = r[m].bind(r); r[m] = () => g().finally(() => { x.landed = true; }); }
    return r;
  };
  window.__titles = [];
  addEventListener('message', (e) => { const fr = document.getElementById('av-frame'); if (fr && e.source === fr.contentWindow && e.data?.lens === 1 && e.data.type === 'ready') window.__titles.push({ title: e.data.title, t: Date.now() }); });
})();`;

const soonIn = (p, ms = 30000) => async (expr, what) => {
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

// An artifact landed on main, as a merged PR puts it there: its tree id.
function land(F, files) {
  const dir = path.join(F.old, 'docs/devteam/project/artifacts', SLUG);
  for (const [rel, text] of Object.entries(files)) write(path.join(dir, rel), text);
  F.g(['add', '-A', dir], F.old);
  F.g(['commit', '-qm', `artifact: ${SLUG}`], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
  return F.g(['rev-parse', `HEAD:docs/devteam/project/artifacts/${SLUG}`], F.old);
}

test('a viewer on a draft reloads by itself when its fingerprint changes', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 900000 }, async (t) => {
  const later = cleanup(t);
  const F = threadsFixture('live-reload');
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

  await t.test('C1: a viewer tab on a draft: fp unchanged for 20 s, no reload; fp changed, reloaded within 3 s, in a fresh frame', async () => {
    await open(`${VIEW}?at=${WT}`, WT, 'v1');
    assert.match(await p.ev('TS.fp ?? ""'), /^[0-9a-f]{64}$/, 'opened with its fingerprint');
    const h0 = await p.ev('history.length');
    const viewAsks0 = await p.ev(`__reads.filter((x) => x.u.includes('/api/view?')).length`);
    await sleep(20000);
    assert.ok(await asks() >= 8, `asked every 2 s for 20 s (asked ${await asks()}x)`);
    assert.deepEqual(await titles(), ['v1'], 'fp unchanged for 20 s: never reloaded');
    assert.equal(await p.ev(`__reads.filter((x) => x.u.includes('/api/view?')).length`), viewAsks0, "the tab's 10 s /api/view ask is not made for a draft");
    const t0 = await change(NEW_FP);
    const got = await reloadedSince(t0, 'a reload after fp changed');
    assert.ok(got.t - t0 <= 3000, `reloaded ${got.t - t0} ms after fp changed (at most 3000)`);
    assert.equal(await p.ev('TS.fp'), NEW_FP, 'the stage now names the fingerprint it loaded');
    assert.equal(await p.ev('history.length'), h0, 'no history entry: a fresh frame');
    await sleep(4500);
    assert.equal((await titles()).length, 2, 'once: the same fp again reloads nothing');
  });

  await t.test("C1: the dashboard's stage on a draft reloads within 3 s too, and the close still counts no move", async () => {
    await openOverLibrary();
    await sleep(2500);
    assert.equal((await titles()).length, 1, 'no reload while fp is unchanged');
    const h0 = await p.ev('[history.length, AV_NAVS]');
    const t0 = await change(NEW_FP);
    const got = await reloadedSince(t0, 'a reload after fp changed');
    assert.ok(got.t - t0 <= 3000, `reloaded ${got.t - t0} ms after fp changed (at most 3000)`);
    assert.deepEqual(await p.ev('[history.length, AV_NAVS]'), h0, 'no history entry and no frame move counted: a fresh frame');
  });

  await t.test('C2: hidden, no ask; visible again, an ask at once', async () => {
    await open(`${VIEW}?at=${WT}`, WT);
    await soon('__fpAsks.length >= 2', 'two asks');
    await p.ev(`(window.__hidden = true, document.dispatchEvent(new Event('visibilitychange')), true)`);
    // an ask already in flight when it hid may land; none starts after
    await sleep(300);
    const n = await asks();
    await sleep(6000);
    assert.equal(await asks(), n, 'no /api/artifact-fp ask while hidden');
    assert.equal(await p.ev('__fpAsks.some((x) => x.hidden)'), false, 'none made while the page read as hidden');
    // shown again midway between two of the 2 s ticks (their phase is the last ask's): only an ask on
    // visibilitychange comes within 400 ms
    const last = await p.ev('__fpAsks[__fpAsks.length - 1].t');
    const now = await p.ev('Date.now()');
    const at = last + Math.ceil((now - last + 200) / 2000) * 2000 + 1000;
    await sleep(at - now);
    // the time taken before the event: the page's ask is logged while the event is dispatched
    const t0 = await p.ev(`(() => { const t = Date.now(); window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')); return t; })()`);
    await sleep(400);
    const first = await p.ev(`__fpAsks.find((x) => x.t >= ${t0})?.t ?? null`);
    assert.ok(first !== null && first - t0 <= 400, `an ask at once when shown again (${first === null ? 'none' : `${first - t0} ms`} after, the tick ~1000 ms away)`);
  });

  await t.test("C3: a viewer tab: a 404 says the draft was landed or removed, links main's (shown in place), and stops asking", async () => {
    await open(`${VIEW}?at=${WT}`, WT, 'v1');
    await soon('__fpAsks.length >= 1', 'the first ask');
    await p.ev('(window.__fake.status = 404, true)');
    const note = await soonIn(p, 5000)(`(() => { const n = document.getElementById('av-note'); return !n.hidden && n.textContent.includes('This draft was landed or removed') && { text: n.textContent, href: n.querySelector('a')?.getAttribute('href') ?? null }; })()`, 'the note');
    assert.equal(note.href, `/view/artifact/${SLUG}`, "the note's link is main's version");
    const n = await asks();
    await sleep(6000);
    assert.equal(await asks(), n, 'no ask after the 404');
    const href = await p.ev('location.href');
    await p.click('#av-note a');
    await soon(`TS.at === 'main' && document.getElementById('av-frame').getAttribute('src') === '/artifact/main/${SLUG}/' && __titles.some((x) => x.title === 'main')`, "main's version on the stage");
    assert.equal(await p.ev('location.href'), href, 'shown in place: the address unchanged');
  });

  await t.test("C3: the dashboard: a 404 says so, links main's (shown in place), stops asking; × still closes to the page under", async () => {
    await openOverLibrary();
    await soon('__fpAsks.length >= 1', 'the first ask');
    await p.ev('(window.__fake.status = 404, true)');
    const note = await soonIn(p, 5000)(`(() => { const n = document.getElementById('av-note'); return !n.hidden && n.textContent.includes('This draft was landed or removed') && { href: n.querySelector('a')?.getAttribute('href') ?? null }; })()`, 'the note');
    assert.equal(note.href, `#artifact/main/${SLUG}`, "the note's link is main's version");
    const n = await asks();
    await sleep(6000);
    assert.equal(await asks(), n, 'no ask after the 404');
    const h0 = await p.ev('history.length');
    await p.click('#av-note a');
    await soon(`TS.at === 'main' && __titles.some((x) => x.title === 'main')`, "main's version on the stage");
    assert.deepEqual(await p.ev('[location.hash, history.length]'), [DRAFT_HEAD, h0], 'shown in place: no route, no history entry');
    await p.click('#av-close');
    await soon(`document.getElementById('artifact-view').hidden && location.hash === '#library'`, '× closes the viewer to #library');
  });

  await t.test('C4: a viewer on main or a tree makes no /api/artifact-fp ask', async () => {
    for (const [url, at] of [[VIEW, 'main'], [`${VIEW}?at=tree:${tree}`, `tree:${tree}`], [DASH_MAIN, 'main']]) {
      await open(url, at, 'main');
      await sleep(6000);
      assert.equal(await asks(), 0, `${url}: no ask`);
    }
  });

  await t.test("C5: a viewer tab's anchor is the frame's, and the reload keeps it", async () => {
    await open(`${VIEW}?at=${WT}#section`, WT);
    assert.match(await p.ev(`document.getElementById('av-frame').getAttribute('src')`), /#section$/, "the frame's src carries the anchor");
    assert.equal((await titles())[0], 'v1#section', 'the page loaded at the anchor');
    const t0 = await change(NEW_FP);
    const got = await reloadedSince(t0, 'a reload after fp changed');
    assert.equal(got.title, 'v1#section', 'reloaded at the anchor');    // a thread's hash (#talk/) or one over 200 characters is no anchor (the browser's hash never holds whitespace)
    for (const h of ['#talk/t-20261120-000000000-owner', `#${'a'.repeat(201)}`]) {
      await open(`${VIEW}?at=${WT}${h}`, WT);
      assert.equal(await p.ev(`document.getElementById('av-frame').getAttribute('src')`), `/artifact/wt/${WT}/${SLUG}/`, `${h.slice(0, 24)}: no anchor`);
    }
  });

  await t.test('C8: a reload keeps the page the owner followed a link to', async () => {
    await open(`${VIEW}?at=${WT}`, WT, 'v1');
    const r = await p.ev(`(() => { const b = document.getElementById('av-frame').getBoundingClientRect(); return { x: b.left + 20, y: b.top + 15 }; })()`);
    await p.clickAt(r.x, r.y);
    await soon(`__titles.some((x) => x.title === 'page2') && TS.path === 'page2.html'`, "the second page, as the lens names it");
    const t0 = await change(NEW_FP);
    const got = await reloadedSince(t0, 'a reload after fp changed');
    assert.equal(got.title, 'page2', 'reloaded on the second page');
  });

  await t.test("C9: the poll's guards: one ask at a time, given up at 5 s; a bad answer reloads nothing; an answer for a stage gone is dropped", async () => {
    await open(`${VIEW}?at=${WT}`, WT, 'v1');
    await soon('__fpAsks.length >= 1 && __fpAsks.every((x) => x.done)', 'the first ask answered');
    // (a) a new fp held 12 s: no second ask while it is out; the 5 s give-up lets the next tick ask
    // again well before the 12 s (within 5 s + one 2 s tick + slack); the held answer, given up, reloads nothing
    await p.ev(`(window.__fake.delay = 12000, window.__fake.fp = ${J(NEW_FP)}, true)`);
    const held = await soonIn(p, 5000)('__fpAsks.find((x) => !x.done)?.t', 'a held ask');
    await p.ev(`(window.__fake.delay = 0, window.__fake.fp = null, true)`);
    await sleep(Math.max(0, held + 4500 - await p.ev('Date.now()')));
    assert.equal(await p.ev(`__fpAsks.filter((x) => x.t > ${held}).length`), 0, 'no second ask while one is out');
    const again = await soonIn(p, 6000)(`__fpAsks.find((x) => x.t > ${held})?.t`, 'asked again after the 5 s give-up');
    assert.ok(again - held >= 5000 && again - held <= 8000, `asked again ${again - held} ms after the held ask (the give-up at 5 s, the hold 12 s)`);
    await sleep(Math.max(0, held + 12500 - await p.ev('Date.now()')));
    assert.equal((await titles()).length, 1, 'the given-up answer reloaded nothing');
    // (b) answers that aren't { fp: a string of 1 to 128 characters }
    const fp0 = await p.ev('TS.fp');
    for (const body of ['{}', '{"fp":null}', J({ fp: 'x'.repeat(129) }), J({ fp: '' }), 'not json']) {
      await p.ev(`(window.__fake.body = ${J(body)}, true)`);
      const n = await asks();
      await soon(`__fpAsks.length >= ${n} + 2`, `two asks answered ${body.slice(0, 20)}`);
      assert.equal((await titles()).length, 1, `${body.slice(0, 20)}: no reload`);
      assert.equal(await p.ev('TS.fp'), fp0, `${body.slice(0, 20)}: TS.fp unchanged`);
    }
    await p.ev('(window.__fake.body = null, true)');
    // (c) a new fp held 1.5 s; the stage goes to main in place while it is out: the answer is dropped
    await p.ev(`(window.__fake.delay = 1500, window.__fake.fp = ${J(NEW_FP)}, true)`);
    const n = await asks();
    await soon(`__fpAsks.length > ${n} && !__fpAsks[__fpAsks.length - 1].done`, 'a held ask with the new fp');
    await p.ev(`(showArtifact(${J(SLUG)}, 'main', { fp: ${J('b'.repeat(64))} }), true)`);
    await soon(`__titles.some((x) => x.title === 'main')`, "main's frame ready");
    await sleep(3000);
    assert.deepEqual(await titles(), ['v1', 'main'], "the answer for the draft didn't reload main's frame");
    assert.equal(await p.ev('TS.fp'), 'b'.repeat(64), "main's fp unchanged");
  });

  await t.test('C10: a framed viewer tab (the owner wrapper) on a draft makes no /api/artifact-fp ask', async () => {
    // the wrapper's parent is another origin, which no test here can serve within the viewer's
    // frame-ancestors; the tab stands in for it with window.parent another window (PAGE, kit106-framed)
    await open(`${VIEW}?at=${WT}&kit106-framed=1`, WT, 'v1');
    assert.equal(await p.ev('window.parent !== window && window.frameElement === null'), true, 'setup: the tab reads as framed by another origin');
    await sleep(8000);
    assert.equal(await asks(), 0, 'the framed viewer tab: no ask');
  });

  await t.test("C6: a draft never shows kit-206's outline, and main now reloads by itself without it (kit-750, A1)", async () => {
    const watchStale = `(() => { window.__wasStale = false; const b = document.getElementById('av-reload'); const look = () => { if (b.classList.contains('stale')) window.__wasStale = true; }; look(); new MutationObserver(look).observe(b, { attributes: true }); return true; })()`;
    const row = `(DATA?.library?.artifacts ?? []).find((a) => a.slug === ${J(SLUG)} && a.at === ${J(WT)})?.fp ?? null`;
    await open(DASH_DRAFT, WT, 'v1');
    await soon(`!!(${row})`, "the Library's row for the draft");
    const listed = await p.ev(row);
    await p.ev(watchStale);
    // the files change on disk: /api/data lists the new fp; the fake says nothing changed, so no reload
    edit('v2');
    await soonIn(p, 90000)(`(${row}) !== ${J(listed)}`, "the dashboard's read lists the draft's new fingerprint");
    await sleep(1000);
    assert.equal(await p.ev('window.__wasStale'), false, 'the draft never had the outline');
    // main: a second commit changes main's fingerprint; the frame loads it again by itself, and the
    // outline kit-206 had never shows (ruling A1, d-20261121-041756284)
    await open(DASH_MAIN, 'main', 'main');
    await p.ev(watchStale);
    land(F, mock('main2'));
    await soonIn(p, 90000)(`__titles.some((x) => x.title === 'main2')`, 'main reloaded to main2 by itself');
    await sleep(1000);
    assert.equal(await p.ev('window.__wasStale'), false, "main never had kit-206's outline");
    assert.equal(await p.ev(`document.getElementById('av-reload').classList.contains('stale')`), false, 'no outline after the reload');
    assert.equal(await asks(), 0, 'main: no /api/artifact-fp ask');
  });
});
