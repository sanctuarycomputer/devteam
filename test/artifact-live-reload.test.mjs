// The viewer reloads a draft by itself when its files change (kit-106): every 2 s while the page is seen,
// a viewer on a draft asks /api/artifact-fp, and on a new fingerprint loads its frame again in a fresh
// frame (no history entry: kit-141's close rule), at the anchor its address carried. A 404 says the draft
// was landed or removed and stops the asking; main and a published tree are never asked about, and keep
// kit-206's outline on Reload, which a draft never shows. Headless Chrome against a real dashboard; the
// fingerprint route is faked in the page (a fetch wrapper), so the test says when the draft "changed".
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

// The page's own title says what it is and the anchor it loaded at; the lens's ready carries document.title.
const mock = (title) => ({
  'artifact.json': J({ v: 1, title: 'Live mock', summary: 'A page that changes', by: 'supervisor', for: [] }),
  'index.html': `<!doctype html><html><head><title>${title}</title></head><body><p id="section">${title}</p><script>document.title = ${J(title)} + location.hash;</script></body></html>`,
});

// The fake /api/artifact-fp: answers from window.__fake ({ status, fp }; fp null answers what the stage
// loaded, TS.fp, or a fixed one when the stage knows none: "unchanged"), logs each ask (its time, and whether the page read as hidden then), and
// passes every other request on. Also: every /api/data and /api/view read the page makes, with when it
// landed; document.visibilityState as window.__hidden says; the lens's ready titles, with their time.
const PAGE = `(() => {
  window.__fake = { status: 200, fp: null };
  window.__fpAsks = [];
  window.__reads = [];
  window.__hidden = false;
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get() { return window.__hidden ? 'hidden' : 'visible'; } });
  const f = window.fetch;
  window.fetch = async (u, o) => {
    const s = String(u);
    if (s.startsWith('/api/artifact-fp')) {
      window.__fpAsks.push({ u: s, t: Date.now(), hidden: document.visibilityState !== 'visible' });
      const k = window.__fake;
      const fp = k.fp ?? (typeof TS === 'object' && TS.fp ? TS.fp : 'a'.repeat(64));
      const body = k.status === 200 ? JSON.stringify({ fp, at: new URLSearchParams(s.split('?')[1]).get('at') }) : JSON.stringify({ error: 'no draft' });
      return new Response(body, { status: k.status, headers: { 'content-type': 'application/json' } });
    }
    const x = { u: s, landed: false };
    if (s.startsWith('/api/data') || s.startsWith('/api/view')) window.__reads.push(x);
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

test('a viewer on a draft reloads by itself when its fingerprint changes', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 600000 }, async (t) => {
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
  const DASH_DRAFT = `${B}/#artifact/wt/${WT}/${SLUG}`;
  const DASH_MAIN = `${B}/#artifact/main/${SLUG}`;
  // a page on the stage, once its frame's lens has said ready (`title` from it, or any)
  const open = async (url, at, title = null) => {
    await p.send('Page.navigate', { url });
    await soon(`typeof TS === 'object' && TS.kind === 'artifact' && TS.at === ${J(at)} && window.__titles.length >= 1${title ? ` && __titles[0].title === ${J(title)}` : ''}`, `${url}: the stage up, its frame ready`);
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
    const viewAsks0 = await p.ev(`__reads.filter((x) => x.u.startsWith('/api/view?')).length`);
    await sleep(20000);
    assert.ok(await asks() >= 8, `asked every 2 s for 20 s (asked ${await asks()}x)`);
    assert.deepEqual(await titles(), ['v1'], 'fp unchanged for 20 s: never reloaded');
    assert.equal(await p.ev(`__reads.filter((x) => x.u.startsWith('/api/view?')).length`), viewAsks0, "the tab's 10 s /api/view ask is not made for a draft");
    const t0 = await change(NEW_FP);
    const got = await reloadedSince(t0, 'a reload after fp changed');
    assert.ok(got.t - t0 <= 3000, `reloaded ${got.t - t0} ms after fp changed (at most 3000)`);
    assert.equal(await p.ev('TS.fp'), NEW_FP, 'the stage now names the fingerprint it loaded');
    assert.equal(await p.ev('history.length'), h0, 'no history entry: a fresh frame');
    await sleep(4500);
    assert.equal((await titles()).length, 2, 'once: the same fp again reloads nothing');
  });

  await t.test("C1: the dashboard's stage on a draft reloads within 3 s too", async () => {
    await open(DASH_DRAFT, WT, 'v1');
    await sleep(2500);
    assert.equal((await titles()).length, 1, 'no reload while fp is unchanged');
    const h0 = await p.ev('history.length');
    const t0 = await change(NEW_FP);
    const got = await reloadedSince(t0, 'a reload after fp changed');
    assert.ok(got.t - t0 <= 3000, `reloaded ${got.t - t0} ms after fp changed (at most 3000)`);
    assert.equal(await p.ev('history.length'), h0, 'no history entry: a fresh frame');
  });

  await t.test('C2: hidden, no ask; visible again, an ask', async () => {
    await open(`${VIEW}?at=${WT}`, WT);
    await soon('__fpAsks.length >= 1', 'the first ask');
    await p.ev(`(window.__hidden = true, document.dispatchEvent(new Event('visibilitychange')), true)`);
    // an ask already in flight when it hid may land; none starts after
    await sleep(300);
    const n = await asks();
    await sleep(6000);
    assert.equal(await asks(), n, 'no /api/artifact-fp ask while hidden');
    assert.equal(await p.ev('__fpAsks.some((x) => x.hidden)'), false, 'none made while the page read as hidden');
    const t0 = await p.ev(`(window.__hidden = false, document.dispatchEvent(new Event('visibilitychange')), Date.now())`);
    await soonIn(p, 2500)(`__fpAsks.some((x) => x.t >= ${t0})`, 'an ask once visible again');
  });

  for (const [where, url, link] of [['a viewer tab', `${VIEW}?at=${WT}`, `/view/artifact/${SLUG}`], ['the dashboard', DASH_DRAFT, `#artifact/main/${SLUG}`]]) {
    await t.test(`C3: ${where}: a 404 says the draft was landed or removed, links main's, and stops asking`, async () => {
      await open(url, WT);
      await soon('__fpAsks.length >= 1', 'the first ask');
      await p.ev('(window.__fake.status = 404, true)');
      const note = await soonIn(p, 5000)(`(() => { const n = document.getElementById('av-note'); return !n.hidden && n.textContent.includes('This draft was landed or removed') && { text: n.textContent, href: n.querySelector('a')?.getAttribute('href') ?? null }; })()`, 'the note');
      assert.equal(note.href, link, "the note's link is main's version");
      const n = await asks();
      await sleep(6000);
      assert.equal(await asks(), n, 'no ask after the 404');
    });
  }

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
    assert.equal(got.title, 'v1#section', 'reloaded at the anchor');
  });

  await t.test("C6: a draft never shows kit-206's outline; main keeps it, and its title", async () => {
    const watchStale = `(() => { window.__wasStale = false; const b = document.getElementById('av-reload'); const look = () => { if (b.classList.contains('stale')) window.__wasStale = true; }; look(); new MutationObserver(look).observe(b, { attributes: true }); return true; })()`;
    // two /api/data reads started after now have landed
    const twoReads = async () => { const n0 = await p.ev('__reads.length'); await soonIn(p, 90000)(`__reads.slice(${n0}).filter((x) => x.landed && x.u.startsWith('/api/data')).length >= 2`, 'two /api/data reads'); };
    await open(DASH_DRAFT, WT, 'v1');
    await p.ev(watchStale);
    // the files change on disk: /api/data lists the new fp; the fake says nothing changed, so no reload
    edit('v2');
    await twoReads();
    assert.notEqual(await p.ev('TS.fpNow'), await p.ev('TS.fp'), 'setup: the dashboard saw a newer fingerprint');
    assert.equal(await p.ev('window.__wasStale'), false, 'the draft never had the outline');
    // main: a second commit changes main's fingerprint; the outline and its title come, as kit-206 has them
    await open(DASH_MAIN, 'main', 'main');
    await p.ev(watchStale);
    land(F, mock('main2'));
    await soonIn(p, 90000)(`document.getElementById('av-reload').classList.contains('stale')`, "main's outline once a newer fingerprint is seen");
    assert.equal(await p.ev(`document.getElementById('av-reload').title`), 'A newer version is ready: reload to see it');
    assert.equal(await asks(), 0, 'main: no /api/artifact-fp ask');
  });
});
