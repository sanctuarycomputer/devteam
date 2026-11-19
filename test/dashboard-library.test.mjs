// The dashboard's Library (kit-92): the library-items block (LIB_KINDS, libraryGoalIndex, linkHost,
// libraryItems and libraryKeep), run alone in vm with the preview-cards block beside it, over
// libraryFixture()'s /api/data parts; then the page in real headless Chrome over a real dashboard on a
// bare project whose /api/data is patched in the page with libraryFixture() (skipped where Chrome can't
// run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { PORTS, bareProject, dashboardOnFreePort, dataPatchInit, libraryFixture } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = fs.readFileSync(path.join(here, '..', 'docs', 'devteam', 'dashboard', 'index.html'), 'utf8');
const block = (src, name) => {
  const a = src.indexOf(`/* ${name} start */`), b = src.indexOf(`/* ${name} end */`);
  assert.ok(a >= 0 && b > a, `the ${name} block is in the page`);
  assert.equal(src.indexOf(`/* ${name} start */`, a + 1), -1, `one ${name} block`);
  return src.slice(a, b + `/* ${name} end */`.length);
};

test('library-items: kinds, order, goals and keep', () => {
  // the two blocks alone, with no page globals but URL and URLSearchParams
  const vctx = vm.createContext({ URL, URLSearchParams });
  vm.runInContext(`${block(INDEX, 'preview-cards')}\n${block(INDEX, 'library-items')}\nthis.previewState = previewState; this.LIB_KINDS = LIB_KINDS; this.libraryGoalIndex = libraryGoalIndex; this.linkHost = linkHost; this.libraryItems = libraryItems; this.libraryKeep = libraryKeep;`, vctx);
  const { previewState, LIB_KINDS, libraryGoalIndex, linkHost, libraryItems, libraryKeep } = vctx;
  // stubs for the page's href helpers, so an href that isn't theirs shows
  const ctx = {
    previewState,
    artHref: (s, at) => `#artifact/${at}/${s}`,
    artViewer: (s, at) => `/view/artifact/${s}?at=${at}`,
    pvViewer: (n) => `/view/preview/${n}`,
    fileHref: (l) => `#file?path=${l.path}`,
  };
  const now = Date.parse('2026-11-19T12:00:00Z');
  const { patch: data, ids } = libraryFixture({ now });
  const plain = (x) => JSON.parse(JSON.stringify(x));

  assert.deepEqual(plain(LIB_KINDS), [['mock', 'Mock', 'layout-dashboard'], ['diagram', 'Diagram', 'workflow'], ['docs', 'Docs', 'book-open'], ['review', 'Review page', 'list-checks'], ['preview', 'Preview', 'monitor-play'], ['link', 'Link', 'link']]);
  const before = JSON.stringify(data);
  // in this realm, so deepEqual compares values, not the vm's prototypes
  const items = plain(libraryItems(data, now, ctx));
  assert.equal(JSON.stringify(data), before, 'the data is not changed');
  const byId = new Map(items.map((x) => [x.id, x]));
  assert.equal(byId.size, items.length, 'one item per id');

  // kind order, every kind held; the fixture lists them out of order
  const order = LIB_KINDS.map((k) => k[0]);
  const kinds = items.map((x) => x.kind);
  assert.ok(kinds.every((k, i) => i === 0 || order.indexOf(kinds[i - 1]) <= order.indexOf(k)), `kind order: ${kinds.join(' ')}`);
  for (const k of order) assert.ok(kinds.includes(k), `a ${k} item`);
  const rawKinds = data.library.artifacts.map((a) => a.kind ?? 'mock');
  assert.ok(rawKinds.some((k, i) => i > 0 && order.indexOf(rawKinds[i - 1]) > order.indexOf(k === 'x' ? 'mock' : k)), 'the fixture lists artifacts out of kind order');
  // artifacts in the server's order within a kind (first row of each slug)
  const slugsOf = (k) => [...new Set(data.library.artifacts.filter((a) => (['mock', 'diagram', 'docs'].includes(a.kind) ? a.kind : 'mock') === k).map((a) => a.slug))];
  for (const k of ['mock', 'diagram', 'docs']) assert.deepEqual(items.filter((x) => x.kind === k).map((x) => x.id), slugsOf(k).map((s) => `artifact:${s}`), `${k}: one per slug, in the server's order`);

  // an unknown kind and a missing one read as Mock
  assert.equal(byId.get(`artifact:${ids.unknownKind}`).kind, 'mock');
  assert.equal(byId.get(`artifact:${ids.noKind}`).kind, 'mock');
  assert.equal(byId.get(`artifact:${ids.diagram}`).kind, 'diagram');
  assert.equal(byId.get(`artifact:${ids.docs}`).kind, 'docs');

  // every item's hrefs are the page's helpers' (the block builds none of its own)
  for (const x of items) {
    if (x.kind === 'review') { assert.equal(x.href, `#review/${x.review.id}`); assert.equal(x.tab, null); continue; }
    if (x.kind === 'preview') { assert.equal(x.href, `#preview/${x.preview.name}`); assert.equal(x.tab, ctx.pvViewer(x.preview.name)); continue; }
    if (x.kind === 'link') {
      const l = x.link;
      assert.equal(x.href, l.url ? l.url : l.path && !l.remote ? ctx.fileHref(l) : null, `${x.id} href`);
      assert.equal(x.tab, l.url || null, `${x.id} tab`);
      continue;
    }
    if (x.error) { assert.equal(x.href, null, `${x.id}: a broken row opens nothing`); assert.equal(x.tab, null); continue; }
    assert.equal(x.href, ctx.artHref(x.art.slug, x.art.at), `${x.id} href`);
    assert.equal(x.tab, ctx.artViewer(x.art.slug, x.art.at), `${x.id} tab`);
  }

  // a slug landed with drafts in two worktrees: one item, the newer draft shown
  const drafted = items.filter((x) => x.id === `artifact:${ids.drafted}`);
  assert.equal(drafted.length, 1, 'one item for the drafted slug');
  const d = drafted[0];
  assert.equal(d.at, ids.wt2, 'the newer worktree\'s draft');
  assert.equal(d.art.at, ids.wt2);
  assert.equal(d.drafts.length, 2);
  assert.deepEqual(d.drafts.map((r) => r.at).sort(), [ids.wt1, ids.wt2].sort());
  assert.equal(d.landed?.at, 'main', 'its landed row');
  assert.equal(d.href, `#artifact/${ids.wt2}/${ids.drafted}`);
  assert.equal(d.title, data.library.artifacts.find((a) => a.slug === ids.drafted && a.at === ids.wt2).title, 'the draft\'s title');
  // a draft of a slug that never landed
  const only = byId.get(`artifact:${ids.draftOnly}`);
  assert.equal(only.landed, null);
  assert.equal(only.drafts.length, 1);
  assert.equal(only.at, ids.wt1);
  // a landed row with no drafts
  const pub = byId.get(`artifact:${ids.public}`);
  assert.equal(pub.at, 'main');
  assert.deepEqual(pub.landed, pub.art);
  assert.deepEqual(plain(pub.drafts), []);
  // a broken row: its slug and its error
  const broken = byId.get(`artifact:${ids.broken}`);
  assert.ok(broken.error, 'the broken row carries its error');
  assert.equal(broken.title, ids.broken, 'a broken row shows its slug');
  for (const x of items.filter((y) => y.art && y.id !== `artifact:${ids.broken}`)) assert.equal(x.error, null, `${x.id} not broken`);

  // reviews: one per open review question, none for a plain question
  const reviewQs = data.questions.filter((q) => q.kind === 'review');
  assert.equal(reviewQs.length, 2);
  assert.ok(data.questions.length > reviewQs.length, 'plain questions beside them');
  assert.deepEqual(items.filter((x) => x.kind === 'review').map((x) => x.id), reviewQs.map((q) => `review:${q.id}`));
  const rv = byId.get(`review:${ids.reviewQ}`);
  assert.equal(rv.href, `#review/${ids.reviewQ}`);
  assert.equal(rv.tab, null);
  assert.equal(rv.title, reviewQs.find((q) => q.id === ids.reviewQ).review.title);
  const rv2 = items.find((x) => x.kind === 'review' && x.id !== `review:${ids.reviewQ}`);
  assert.equal(rv2.title, rv2.review.question, 'no review title: the question');

  // previews: as served, each with its state
  assert.deepEqual(items.filter((x) => x.kind === 'preview').map((x) => x.preview.name), data.library.previews.map((p) => p.name));
  const st = (n) => byId.get(`preview:${n}`).pstate.state;
  assert.equal(st(ids.pvLive), 'live');
  assert.equal(st(ids.pvChecking), 'checking');
  assert.equal(st(ids.pvNotRunning), 'not-running');
  assert.equal(st(ids.pvDown), 'not-answering');
  assert.ok(byId.get(`preview:${ids.pvDown}`).pstate.since, 'down since');
  assert.equal(st(ids.pvExpired), 'expired');
  for (const p of data.library.previews) assert.match(p.name, /^[a-z]{3,7}-[a-z]{3,7}(-[1-9]\d?)?$/, 'a name openPreview accepts');

  // links: as served, each with its host
  assert.deepEqual(items.filter((x) => x.kind === 'link').map((x) => x.link.id), data.library.links.map((l) => l.id));
  assert.equal(byId.get(`link:${ids.linkUrl}`).host, new URL(data.library.links.find((l) => l.id === ids.linkUrl).url).host);
  assert.equal(byId.get(`link:${ids.linkRemote}`).host, 'github.com');
  assert.equal(byId.get(`link:${ids.linkRemote}`).href, null, 'a remote-only link opens nothing here');
  assert.equal(byId.get(`link:${ids.linkPath}`).host, null);
  assert.match(byId.get(`link:${ids.linkPath}`).href, /^#file\?path=/);
  // literally: a url link opens its url, here and in a new tab; a path link has no tab
  const urlLink = byId.get(`link:${ids.linkUrl}`);
  assert.equal(urlLink.href, 'https://www.figma.com/file/pay-flow');
  assert.equal(urlLink.tab, 'https://www.figma.com/file/pay-flow');
  assert.equal(byId.get(`link:${ids.linkPath}`).tab, null);

  // goals: a ref's goals
  const goalsOf = libraryGoalIndex(data);
  const sorted = (xs) => [...xs].sort();
  assert.deepEqual(plain(goalsOf(`goal:${ids.goal2}`)), [ids.goal2]);
  assert.deepEqual(plain(goalsOf(`ticket:${ids.tBuilding}`)), [ids.goal1], 'a ticket through its feature');
  assert.deepEqual(plain(goalsOf(ids.tMergedReceipts)), [ids.goal2], 'a bare ticket id (a session)');
  assert.deepEqual(plain(goalsOf(`feature:${ids.feat1}`)), [ids.goal1]);
  assert.deepEqual(plain(goalsOf(`feature:${ids.feat2}`)), [ids.goal2]);
  assert.deepEqual(plain(goalsOf(`plan-${ids.feat1}`)), [ids.goal1], 'a planner session by its feature');
  assert.deepEqual(plain(goalsOf(`plan-${ids.planPromptQ}`)), [ids.goal2], 'a planner session by its planner row');
  assert.deepEqual(plain(goalsOf(`ticket:${ids.tPlain}`)), [], 'a ticket of a feature in no goal');
  assert.deepEqual(plain(goalsOf('component:x')), []);
  assert.deepEqual(plain(goalsOf('supervisor')), []);
  assert.deepEqual(plain(goalsOf('ticket:nope')), []);
  // each item's goals
  assert.deepEqual(sorted(byId.get(`artifact:${ids.diagram}`).goals), [ids.goal2]);
  assert.deepEqual(sorted(byId.get(`artifact:${ids.public}`).goals), [ids.goal1]);
  assert.deepEqual(plain(byId.get(`artifact:${ids.noGoal}`).goals), [], 'an artifact for nothing');
  assert.deepEqual(plain(byId.get(`review:${ids.reviewQ}`).goals), [ids.goal2], 'a review question\'s goal');
  assert.deepEqual(plain(rv2.goals), [ids.goal1], 'a review question\'s ticket\'s goal');
  assert.deepEqual(plain(byId.get(`preview:${ids.pvLive}`).goals), [ids.goal1], 'a preview\'s session (a ticket)');
  assert.deepEqual(plain(byId.get(`preview:${ids.pvChecking}`).goals), [ids.goal2], 'a preview\'s session (a planner)');
  assert.deepEqual(plain(byId.get(`link:${ids.linkPath}`).goals), [ids.goal1], 'a link for a feature');

  // libraryKeep: by kind, by goal, both; no goal kept only with no goal filter
  const keep = (f) => items.filter((x) => libraryKeep(x, f)).map((x) => x.id);
  assert.deepEqual(keep({}), items.map((x) => x.id), 'no filter: everything');
  assert.deepEqual(keep({ kind: 'diagram' }), items.filter((x) => x.kind === 'diagram').map((x) => x.id));
  assert.ok(keep({ kind: 'diagram' }).length > 0);
  assert.deepEqual(keep({ goal: ids.goal1 }), items.filter((x) => x.goals.includes(ids.goal1)).map((x) => x.id));
  assert.ok(keep({ goal: ids.goal1 }).length > 0 && keep({ goal: ids.goal1 }).length < items.length);
  assert.deepEqual(keep({ kind: 'preview', goal: ids.goal2 }), [`preview:${ids.pvChecking}`], 'kind and goal');
  const none = { kind: 'mock', goals: [] };
  assert.equal(libraryKeep(none, {}), true);
  assert.equal(libraryKeep(none, { kind: 'mock' }), true);
  assert.equal(libraryKeep(none, { goal: ids.goal1 }), false);
  assert.equal(libraryKeep(none, { kind: 'mock', goal: ids.goal1 }), false);
  assert.equal(libraryKeep({ kind: 'docs', goals: [ids.goal1] }, { kind: 'mock', goal: ids.goal1 }), false);

  // linkHost: a url, then a remote, else none
  assert.equal(linkHost({ url: 'https://github.com/a/b' }), 'github.com');
  assert.equal(linkHost({ remote: 'git@github.com:a/b.git' }), 'github.com');
  assert.equal(linkHost({ remote: 'ssh://git@gitlab.com/a/b' }), 'gitlab.com');
  assert.equal(linkHost({ remote: 'https://bitbucket.org/a/b.git' }), 'bitbucket.org');
  assert.equal(linkHost({ url: 'https://docs.example.com/x', remote: 'git@github.com:a/b.git' }), 'docs.example.com');
  assert.equal(linkHost({ path: 'x' }), null);
  assert.equal(linkHost({ url: 'not a url' }), null);

  // artifacts: n adds n landed mocks bulk-<i>
  const big = libraryFixture({ now, artifacts: 3 });
  assert.deepEqual(big.patch.library.artifacts.filter((a) => a.slug.startsWith('bulk-')).map((a) => [a.slug, a.at]), [['bulk-0', 'main'], ['bulk-1', 'main'], ['bulk-2', 'main']]);
  assert.equal(libraryItems(big.patch, now, ctx).length, items.length + 3);
});

// ---- in Chrome (kit-92 T2): the page on the shell, the grid in kind order, Kind and Goal in the page bar ----

// the items libraryItems gives for data (the block run in vm, as above), for what the page should draw
function itemsOf(data, now = Date.now()) {
  const vctx = vm.createContext({ URL, URLSearchParams });
  vm.runInContext(`${block(INDEX, 'preview-cards')}\n${block(INDEX, 'library-items')}\nthis.previewState = previewState; this.libraryItems = libraryItems; this.libraryKeep = libraryKeep;`, vctx);
  const ctx = { previewState: vctx.previewState, artHref: () => '#a', artViewer: () => '/v', pvViewer: () => '/v', fileHref: () => '#f' };
  const items = JSON.parse(JSON.stringify(vctx.libraryItems(data, now, ctx)));
  return { items, keep: (f) => items.filter((x) => vctx.libraryKeep(x, f)).map((x) => x.id) };
}

// a wait on a condition in the page
const soonIn = (p, ms = 20000, server = null) => async (expr, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v, err = null;
    try { v = await p.ev(expr); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out: ${what}${err ? `; last: ${err.message}` : ''}${server ? `; the server said, last: ${JSON.stringify(String(server()).slice(-600))}` : ''}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

// A bare project (every Library record comes from the patch), its env with its own HOME and every
// DEVTEAM_* but the ports unset; the dashboard on it and Chrome with init: { p, soon, port, go }.
async function libraryOn(t, { width = 1440, height = 900, init } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-library-'));
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
  const p = await chrome.newPage();
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
    await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/${hash}` });
    await soon(loaded, 'the page with its data');
  };
  return { p, soon, port, go };
}

const CHROME = { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' };
// the page bar's filters: a control by its data-f, a pick (its change event, as the owner's choice makes)
const ctl = (f) => `document.querySelector('.pagebar .extra [data-f="${f}"]')`;
const pick = (p, f, v) => p.ev(`(() => { const s = ${ctl(f)}; s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
const EXTRA = "[...document.querySelectorAll('.pagebar .extra select, .pagebar .extra button, .pagebar .extra input')].map((c) => c.dataset.f)";
// the hash, its query read back (so the test doesn't lean on how a value is escaped)
const HEAD = "(() => { const h = location.hash, i = h.indexOf('?'); return { page: h.slice(1, i < 0 ? h.length : i), q: Object.fromEntries(new URLSearchParams(i < 0 ? '' : h.slice(i + 1))) }; })()";
// the grid's cards by id, in order
const IDS = "[...document.querySelectorAll('#lib-grid > .lib-card')].map((c) => c.dataset.libId)";
const idsAre = (xs) => `JSON.stringify(${IDS}) === ${JSON.stringify(JSON.stringify(xs))}`;
const card = (id) => `document.querySelector('#lib-grid > .lib-card[data-lib-id="${id}"]')`;

test('the Library is one grid in kind order with no headers', { ...CHROME, timeout: 300000 }, async (t) => {
  const { patch } = libraryFixture();
  const { items } = itemsOf(patch);
  const { p, soon, go } = await libraryOn(t, { init: dataPatchInit(patch) });
  await go('#library');
  await p.ev('localStorage.clear()');
  await go('#library');
  await soon(idsAre(items.map((x) => x.id)), 'a card per item, in the items\' order');
  const kinds = await p.ev("[...document.querySelectorAll('#lib-grid > .lib-card')].map((c) => c.dataset.kind)");
  const order = ['mock', 'diagram', 'docs', 'review', 'preview', 'link'];
  assert.deepEqual(kinds, items.map((x) => x.kind), 'each card its item\'s kind');
  assert.deepEqual(kinds, [...kinds].sort((a, b) => order.indexOf(a) - order.indexOf(b)), 'kind order');
  assert.deepEqual([...new Set(kinds)], order, 'every kind, in order');
  assert.deepEqual(await p.ev(`(() => { const L = document.getElementById('library'); return { headers: L.querySelectorAll('h1, h2, h3, h4, hr').length, noShell: L.classList.contains('no-shell') || !!L.querySelector('.no-shell'), grid: document.getElementById('lib-grid').classList.contains('cards'), grids: L.querySelectorAll('.cards').length, top: !!document.getElementById('lib-top'), old: !!L.querySelector('#artifacts, #previews, #lib-links') }; })()`),
    { headers: 0, noShell: false, grid: true, grids: 1, top: true, old: false }, 'one .cards grid on the shell, no section header');
  // each card's head: the kind's icon and the title first, ↗ (none on a review) and ⋯ last
  const heads = await p.ev(`[...document.querySelectorAll('#lib-grid > .lib-card')].map((c) => { const h = c.firstElementChild; const k = [...h.children]; return { id: c.dataset.libId, head: h.classList.contains('card-head'), icon: k[0].className, title: k[1].classList.contains('lib-title') ? k[1].textContent : null, last: k.at(-1).matches('details.menu'), tab: !!h.querySelector(':scope > a.lib-tab.av-open > i.icon-external-link'), beforeMenu: k.at(-2).className, thumb: !!c.querySelector(':scope > .lib-thumb[data-thumb-src]'), body: !!c.querySelector(':scope > .lib-body') }; })`);
  const icons = { mock: 'layout-dashboard', diagram: 'workflow', docs: 'book-open', review: 'list-checks', preview: 'monitor-play', link: 'link' };
  for (const [i, x] of items.entries()) {
    const h = heads[i];
    assert.equal(h.head, true, `${x.id}: a .card-head first`);
    assert.equal(h.icon, `icon-${icons[x.kind]}`, `${x.id}: the kind's icon`);
    assert.equal(h.title, x.title, `${x.id}: the title in the head`);
    assert.equal(h.last, true, `${x.id}: ⋯ last`);
    assert.equal(h.thumb && h.body, true, `${x.id}: a thumbnail box and a body`);
    if (x.kind === 'review') assert.equal(h.tab, false, `${x.id}: a review has no ↗`);
    else if (x.tab) assert.equal(h.beforeMenu, 'lib-tab av-open', `${x.id}: ↗ just before ⋯`);
  }
  // the title one line, truncated
  assert.deepEqual(await p.ev("(() => { const s = getComputedStyle(document.querySelector('#lib-grid .lib-title')); return [s.overflow, s.textOverflow, s.whiteSpace, s.minWidth]; })()"), ['hidden', 'ellipsis', 'nowrap', '0px']);
  // a frame source for a working artifact and a live preview, none for a review, a broken one or a link
  const srcs = await p.ev("Object.fromEntries([...document.querySelectorAll('#lib-grid > .lib-card')].map((c) => [c.dataset.libId, c.querySelector('.lib-thumb').dataset.thumbSrc]))");
  for (const x of items) {
    const want = x.kind === 'review' || x.kind === 'link' || x.error || (x.kind === 'preview' && x.pstate.state !== 'live') ? '' : null;
    if (want === '') assert.equal(srcs[x.id], '', `${x.id}: no frame source`);
    else assert.ok(srcs[x.id], `${x.id}: a frame source`);
  }
  assert.equal(await p.ev("document.getElementById('n-library').textContent"), String(items.filter((x) => ['mock', 'diagram', 'docs', 'preview'].includes(x.kind)).length), 'the nav count: one per artifact and preview card');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('Kind and Goal ride in the hash', { ...CHROME, timeout: 300000 }, async (t) => {
  const { patch, ids } = libraryFixture();
  const { items, keep } = itemsOf(patch);
  const { p, soon, go } = await libraryOn(t, { init: dataPatchInit(patch) });
  await go('#library');
  await p.ev('localStorage.clear()');
  await go('#library');
  await soon(idsAre(items.map((x) => x.id)), 'every card');
  assert.deepEqual(await p.ev(EXTRA), ['goal', 'kind'], 'Goal, then Kind');
  assert.deepEqual(await p.ev(`[...${ctl('kind')}.options].map((o) => [o.value, o.textContent])`), [['', 'All kinds'], ['mock', 'Mock'], ['diagram', 'Diagram'], ['docs', 'Docs'], ['review', 'Review page'], ['preview', 'Preview'], ['link', 'Link']]);
  assert.equal(await p.ev(`${ctl('kind')}.getAttribute('aria-label')`), 'Kind');
  assert.deepEqual(await p.ev(`[...${ctl('goal')}.options].map((o) => o.value)`), ['', ids.goal1, ids.goal2]);

  await pick(p, 'kind', 'diagram');
  await soon("location.hash === '#library?kind=diagram'", 'the kind in the hash');
  const diagrams = keep({ kind: 'diagram' });
  assert.ok(diagrams.length >= 2 && diagrams.length < items.length);
  await soon(idsAre(diagrams), 'only Diagram cards');
  // a goal that narrows the diagrams to some of them
  const g = [ids.goal1, ids.goal2].find((x) => { const k = keep({ kind: 'diagram', goal: x }); return k.length && k.length < diagrams.length; });
  assert.ok(g, 'a goal holding some of the diagrams');
  await pick(p, 'goal', g);
  await soon(`location.hash.includes(${JSON.stringify(`goal=${g}`)})`, 'the goal in the hash');
  assert.deepEqual(await p.ev(HEAD), { page: 'library', q: { kind: 'diagram', goal: g } });
  await soon(idsAre(keep({ kind: 'diagram', goal: g })), "only the goal's diagrams");
  assert.deepEqual(await p.ev(`[${ctl('goal')}.value, ${ctl('kind')}.value]`), [g, 'diagram'], 'the selects show the filters');
  // Back restores the Diagram-only set
  await p.ev('history.back()');
  await soon("location.hash === '#library?kind=diagram'", 'back: the kind alone');
  await soon(idsAre(diagrams), 'back: the Diagram cards');
  assert.equal(await p.ev(`${ctl('goal')}.value`), '', 'back: All goals');
  // the goal alone
  await pick(p, 'kind', '');
  await soon("location.hash === '#library'", 'All kinds: no kind key');
  await pick(p, 'goal', ids.goal2);
  await soon(idsAre(keep({ goal: ids.goal2 })), "goal2's items, of every kind");
  assert.ok(keep({ goal: ids.goal2 }).length < items.length);

  // a kind or a goal naming nothing: every card, the select at All
  await go('#library?kind=zzz');
  await soon(idsAre(items.map((x) => x.id)), 'an unknown kind: every card');
  assert.equal(await p.ev(`${ctl('kind')}.value`), '', 'All kinds');
  await go('#library?goal=g-20200101-000000009-supervisor');
  await soon(idsAre(items.map((x) => x.id)), 'an unknown goal: every card');
  assert.equal(await p.ev(`${ctl('goal')}.value`), '', 'All goals');
  // filters that keep nothing: None
  const kinds = ['mock', 'diagram', 'docs', 'review', 'preview', 'link'];
  const nothing = kinds.flatMap((k) => [ids.goal1, ids.goal2].map((x) => [k, x])).find(([k, x]) => !keep({ kind: k, goal: x }).length);
  assert.ok(nothing, 'a kind and goal that keep nothing');
  await go(`#library?kind=${nothing[0]}&goal=${nothing[1]}`);
  await soon("document.getElementById('lib-grid').textContent.trim() === 'None'", 'None');
  assert.equal(await p.ev(IDS + '.length'), 0);
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('the goal is shared and Board\'s keys never reach Library', { ...CHROME, timeout: 300000 }, async (t) => {
  const { patch, ids } = libraryFixture();
  const { keep } = itemsOf(patch);
  const { p, soon, go } = await libraryOn(t, { init: dataPatchInit(patch) });
  await go('#overview');
  await p.ev('localStorage.clear()');
  await go('#board');
  await soon(`!!${ctl('goal')}`, 'the Board filters');
  await pick(p, 'goal', ids.goal2);
  await soon(`location.hash === ${JSON.stringify(`#board?goal=${ids.goal2}`)}`, 'goal2 on the Board');
  // the Board's goal on Library
  await p.click('.side a[href="#library"]');
  await soon(`location.hash === ${JSON.stringify(`#library?goal=${ids.goal2}`)}`, "the Board's goal on Library");
  await soon(idsAre(keep({ goal: ids.goal2 })), "goal2's items");
  assert.deepEqual(await p.ev(EXTRA), ['goal', 'kind'], 'no Feature, Repo or Needs attention on Library');
  assert.equal(await p.ev(`document.querySelectorAll('.pagebar .extra select[data-f="feat"], .pagebar .extra select[data-f="repo"], .pagebar .extra [data-f="att"]').length`), 0);
  // a goal picked on Library shows on Progress
  await pick(p, 'goal', ids.goal1);
  await soon(`location.hash === ${JSON.stringify(`#library?goal=${ids.goal1}`)}`, 'goal1 on Library');
  await p.click('.side a[href="#progress"]');
  await soon(`location.hash === ${JSON.stringify(`#progress?goal=${ids.goal1}`)}`, "Library's goal on Progress");
  // a feature picked on the Board, then the goal changed on Library: the Board has the new goal and no feature
  await p.click('.side a[href="#board"]');
  await soon(`location.hash === ${JSON.stringify(`#board?goal=${ids.goal1}`)}`, 'goal1 on the Board');
  await soon(`[...${ctl('feat')}.options].some((o) => o.value === 'pay')`, "goal1's feature offered");
  await pick(p, 'feat', 'pay');
  await soon(`location.hash === ${JSON.stringify(`#board?goal=${ids.goal1}&feat=pay`)}`, 'the feature on the Board');
  await p.click('.side a[href="#library"]');
  await soon(`location.hash === ${JSON.stringify(`#library?goal=${ids.goal1}`)}`, 'Library: the goal, no feature');
  await pick(p, 'goal', ids.goal2);
  await soon(`location.hash === ${JSON.stringify(`#library?goal=${ids.goal2}`)}`, 'goal2 on Library');
  await p.click('.side a[href="#board"]');
  await soon("location.hash.startsWith('#board')", 'the Board');
  await soon(`(${HEAD}).q.goal === ${JSON.stringify(ids.goal2)}`, "Library's goal on the Board");
  assert.deepEqual(await p.ev(HEAD), { page: 'board', q: { goal: ids.goal2 } }, "no feature: the old goal's is dropped");
  // Library's hash never has Board's keys
  await p.ev('localStorage.clear()');
  await go('#library?feat=x&att=1');
  await soon("location.hash === '#library'", "Board's keys dropped, in place");
  assert.equal(await p.ev('history.state.page'), '#library', 'the stamp names the canonical head');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('Kind is remembered by Library alone', { ...CHROME, timeout: 300000 }, async (t) => {
  const { patch } = libraryFixture();
  const { keep } = itemsOf(patch);
  const { p, soon, go } = await libraryOn(t, { init: dataPatchInit(patch) });
  await go('#overview');
  await p.ev('localStorage.clear()');
  await go('#library');
  await soon(`!!${ctl('kind')}`, 'the Kind select');
  await pick(p, 'kind', 'docs');
  await soon("location.hash === '#library?kind=docs'", 'docs on Library');
  await soon(idsAre(keep({ kind: 'docs' })), 'the Docs cards');
  for (const page of ['board', 'progress', 'overview', 'loop']) {
    await p.click(`.side a[href="#${page}"]`);
    await soon(`PAGE_NOW === ${JSON.stringify(page)} && (${HEAD}).page === ${JSON.stringify(page)}`, page);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal((await p.ev(HEAD)).q.kind, undefined, `${page}: no kind`);
  }
  await p.click('.side a[href="#library"]');
  await soon("location.hash === '#library?kind=docs'", 'back on Library: its kind');
  await soon(idsAre(keep({ kind: 'docs' })), 'the Docs cards again');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a poll leaves the grid alone; a changed card is replaced, its ⋯ open again', { ...CHROME, timeout: 300000 }, async (t) => {
  const { patch, ids } = libraryFixture();
  const { items } = itemsOf(patch);
  const { p, soon, go } = await libraryOn(t, { init: dataPatchInit(patch) });
  await go('#library');
  await p.ev('localStorage.clear()');
  await go('#library');
  await soon(idsAre(items.map((x) => x.id)), 'every card');
  const target = `artifact:${ids.docs}`, other = `artifact:${ids.diagram}`;
  await p.ev(`(() => { const c = ${card(target)}, d = c.querySelector('.card-head details.menu'); d.open = true; d.__mark = 'kept'; c.__mark = 'kept'; ${card(other)}.__mark = 'other'; })()`);
  await new Promise((r) => setTimeout(r, 1200)); // four polls at the patch's 300 ms
  assert.deepEqual(await p.ev(`(() => { const c = ${card(target)}, d = c.querySelector('.card-head details.menu'); return { card: c.__mark, menu: d.__mark, open: d.open, other: ${card(other)}.__mark }; })()`),
    { card: 'kept', menu: 'kept', open: true, other: 'other' }, 'the same nodes, the menu still open');
  // the card's summary changes: that card is drawn anew, its menu opened again; the others are kept
  await p.ev(`window.__fx.library.artifacts.find((a) => a.slug === ${JSON.stringify(ids.docs)}).summary = 'Now it shows the new guide'`);
  await soon(`${card(target)}.querySelector('.lib-body').textContent.includes('Now it shows the new guide')`, 'the new summary');
  assert.deepEqual(await p.ev(`(() => { const c = ${card(target)}, d = c.querySelector('.card-head details.menu'); return { card: c.__mark ?? null, menu: d.__mark ?? null, open: d.open, other: ${card(other)}.__mark }; })()`),
    { card: null, menu: null, open: true, other: 'other' }, 'a new node for the changed card, its menu open; the other kept');
  assert.equal(await p.ev(idsAre(items.map((x) => x.id))), true, 'the order kept');
  assert.deepEqual(await p.ev('window.__errors'), []);
});
