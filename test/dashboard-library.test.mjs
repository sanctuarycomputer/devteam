// The dashboard's Library (kit-92): the library-items block (LIB_KINDS, libraryGoalIndex, linkHost,
// libraryItems and libraryKeep), run alone in vm with the preview-cards block beside it, over
// libraryFixture()'s /api/data parts; then the page in real headless Chrome over a real dashboard on a
// bare project whose /api/data is patched in the page with libraryFixture() (skipped where Chrome can't
// run). The Library's polls, peeks, viewer, versions and Reload are its second half,
// test/dashboard-library.viewer.test.mjs, and the helpers both use are test/lib/dashboard-library-fixture.mjs
// (kit-925 split them so each file stays well inside run.mjs's 300 s watchdog).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { dataPatchInit, libraryFixture } from './lib/kit.mjs';
import './lib/chrome.mjs';
import { INDEX, block, itemsOf, soonIn, backTo, FILE, ERRORS, libraryOn, CHROME, ctl, pick, EXTRA, HEAD, IDS, idsAre, READS_INIT, card, libraryAll, servedOf, art, FORGET_FAILS, sleep, tapPage, FRAMES_INIT, FRAMES, VIEW, libraryOnce, thumb, oneChrome } from './lib/dashboard-library-fixture.mjs';

// the file's one Chrome closes when the file ends
after(() => FILE.chrome?.close());

test('library-items: kinds, order, goals and keep', () => {
  // the two blocks alone, with no page globals but URL and URLSearchParams
  const vctx = vm.createContext({ URL, URLSearchParams });
  vm.runInContext(`${block(INDEX, 'preview-cards')}\n${block(INDEX, 'library-items')}\nthis.previewState = previewState; this.LIB_KINDS = LIB_KINDS; this.libraryGoalIndex = libraryGoalIndex; this.linkHost = linkHost; this.remoteWeb = remoteWeb; this.libraryItems = libraryItems; this.libraryKeep = libraryKeep;`, vctx);
  const { previewState, LIB_KINDS, libraryGoalIndex, linkHost, remoteWeb, libraryItems, libraryKeep } = vctx;
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
      assert.equal(x.tab, x.href ?? remoteWeb(l.remote) ?? `#lib/link%3A${l.id}`, `${x.id} tab: its href, else its remote's page, else its peek`);
      assert.ok(x.tab, `${x.id}: a tab`);
      continue;
    }
    if (x.error) { assert.equal(x.href, null, `${x.id}: a broken row opens nothing here`); assert.equal(x.tab, ctx.artViewer(x.art.slug, x.art.at), `${x.id}: its tab, the viewer`); continue; }
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
  assert.equal(byId.get(`link:${ids.linkPath}`).tab, '#file?path=docs/devteam/project/designs/pay.md', 'a path link\'s tab: the file peek');
  assert.equal(byId.get(`link:${ids.linkRemote}`).tab, 'https://github.com/sanctuarycomputer/devteam', 'a remote-only link\'s tab: its web page');
  // every item but a review has a tab
  for (const x of items) assert.equal(!!x.tab, x.kind !== 'review', `${x.id}: a tab unless a review`);
  // a link whose remote has no web page (local, file://): its ↗ opens its own peek
  const local = { library: { links: [{ id: 'local-repo', kind: 'repo', title: 'Local', url: null, remote: '/srv/repo.git', path: null }, { id: 'file-repo', kind: 'repo', title: 'File', url: null, remote: 'file:///srv/repo.git', path: 'x.md' }, { id: 'git-repo', kind: 'repo', title: 'Git', url: null, remote: 'git://host.example/a/b.git', path: null }] } };
  assert.deepEqual(plain(libraryItems(local, now, ctx).map((x) => x.tab)), ['#lib/link%3Alocal-repo', '#lib/link%3Afile-repo', 'https://host.example/a/b']);
  // remoteWeb: http(s) as given, git://, scp and ssh forms as https://host/..., each less a trailing .git;
  // a local path or file:// none
  assert.equal(remoteWeb('https://bitbucket.org/a/b.git'), 'https://bitbucket.org/a/b');
  assert.equal(remoteWeb('https://github.com/a/b'), 'https://github.com/a/b');
  assert.equal(remoteWeb('http://git.example.com/a/b.git'), 'http://git.example.com/a/b');
  assert.equal(remoteWeb('git://git.kernel.org/pub/scm/git/git.git'), 'https://git.kernel.org/pub/scm/git/git');
  assert.equal(remoteWeb('file:///srv/repo.git'), null);
  assert.equal(remoteWeb('../other-repo'), null);
  assert.equal(remoteWeb('git@github.com:a/b.git'), 'https://github.com/a/b');
  assert.equal(remoteWeb('git@GitHub.com:a/b'), 'https://github.com/a/b');
  assert.equal(remoteWeb('ssh://git@gitlab.com/a/b.git'), 'https://gitlab.com/a/b');
  assert.equal(remoteWeb('ssh://gitlab.com:2222/a/b'), 'https://gitlab.com/a/b');
  assert.equal(remoteWeb('/srv/repo.git'), null);
  assert.equal(remoteWeb(null), null);

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

test('the Library is one grid in kind order with no headers', { ...CHROME, timeout: 300000 }, async (t) => {
  const { patch, ids } = libraryFixture();
  // one title far longer than a card is wide
  const LONG = `The pay flow, ${'every screen the checkout shows and every state it can be in, '.repeat(4)}end`;
  patch.library.artifacts.find((a) => a.slug === ids.noKind).title = LONG;
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
  const heads = await p.ev(`[...document.querySelectorAll('#lib-grid > .lib-card')].map((c) => { const h = c.firstElementChild; const k = [...h.children]; return { id: c.dataset.libId, head: h.classList.contains('card-head'), icon: k[0].className, title: k[1].classList.contains('lib-title') ? k[1].textContent : null, last: k.at(-1).matches('details.menu'), tab: !!h.querySelector(':scope > a.lib-tab.av-open > i.icon-external-link'), beforeMenu: k.at(-2).matches('a.lib-tab.av-open') && !!k.at(-2).querySelector(':scope > i.icon-external-link'), href: h.querySelector(':scope > a.lib-tab')?.getAttribute('href') ?? null, thumb: !!c.querySelector(':scope > .lib-thumb[data-thumb-src]'), body: !!c.querySelector(':scope > .lib-body') }; })`);
  // each ↗'s target, written out per kind: an artifact's viewer (a broken one too), a preview's, a url link's url,
  // a path link's file peek, a remote-only link's web page
  const tabOf = {};
  for (const x of items) {
    if (x.art) tabOf[x.id] = `/view/artifact/${x.art.slug}${x.art.at === 'main' ? '' : `?at=${x.art.at}`}`;
    if (x.preview) tabOf[x.id] = `/view/preview/${x.preview.name}`;
  }
  tabOf[`link:${ids.linkUrl}`] = 'https://www.figma.com/file/pay-flow';
  tabOf[`link:${ids.linkPath}`] = `#file?${new URLSearchParams({ path: 'docs/devteam/project/designs/pay.md', title: 'The pay design' })}`;
  tabOf[`link:${ids.linkRemote}`] = 'https://github.com/sanctuarycomputer/devteam';
  assert.ok(tabOf[`artifact:${ids.broken}`] && tabOf[`artifact:${ids.drafted}`].includes('?at='), 'a broken and a drafted artifact among them');
  const icons = { mock: 'layout-dashboard', diagram: 'workflow', docs: 'book-open', review: 'list-checks', preview: 'monitor-play', link: 'link' };
  for (const [i, x] of items.entries()) {
    const h = heads[i];
    assert.equal(h.head, true, `${x.id}: a .card-head first`);
    assert.equal(h.icon, `icon-${icons[x.kind]}`, `${x.id}: the kind's icon`);
    assert.equal(h.title, x.title, `${x.id}: the title in the head`);
    assert.equal(h.last, true, `${x.id}: ⋯ last`);
    assert.equal(h.thumb && h.body, true, `${x.id}: a thumbnail box and a body`);
    if (x.kind === 'review') { assert.equal(h.tab, false, `${x.id}: a review has no ↗`); continue; }
    assert.equal(h.beforeMenu, true, `${x.id}: ↗ (icon-external-link) just before ⋯`);
    assert.equal(h.href, tabOf[x.id], `${x.id}: ↗'s target`);
  }
  // the title one line, truncated
  assert.deepEqual(await p.ev("(() => { const s = getComputedStyle(document.querySelector('#lib-grid .lib-title')); return [s.overflow, s.textOverflow, s.whiteSpace, s.minWidth]; })()"), ['hidden', 'ellipsis', 'nowrap', '0px']);
  // the long title is cut short, its ↗ and ⋯ still inside the card
  assert.deepEqual(await p.ev(`(() => { const c = ${card(`artifact:${ids.noKind}`)}, t = c.querySelector('.lib-title'), r = c.getBoundingClientRect().right; return { title: t.textContent.length, cut: t.scrollWidth > t.clientWidth, tab: c.querySelector('.card-head > .lib-tab').getBoundingClientRect().right <= r, menu: c.querySelector('.card-head > details.menu').getBoundingClientRect().right <= r, oneLine: t.getBoundingClientRect().height < 30 }; })()`),
    { title: LONG.length, cut: true, tab: true, menu: true, oneLine: true }, 'a long title truncated on one line');
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

test('a wait that runs out says where the page is; Back first wants the history it expects (kit-775)', { ...CHROME, timeout: 300000 }, async (t) => {
  const { patch } = libraryFixture();
  const { p, go } = await libraryOn(t, { init: dataPatchInit(patch) });
  await go('#library');
  const short = soonIn(p, 300);
  await assert.rejects(short('false', 'never'), (e) => {
    assert.match(e.message, /^timed out: never; the page at "#library", the tab's history \[.*"#library"\] at \d+$/);
    return true;
  });
  await assert.rejects(backTo(p, short, '#library', '#nowhere', 'a Back', undefined, 300), (e) => {
    assert.match(e.message, /^a Back: the tab's history doesn't end \["#nowhere","#library"\]: \[.*"#library"\] at \d+$/);
    return true;
  });
  assert.equal(await p.ev('location.hash'), '#library', 'a Back refused for its history goes nowhere');
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
  await backTo(p, soon, await p.ev('location.hash'), '#library?kind=diagram', 'back: the kind alone');
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
  const { p, soon, go } = await libraryOn(t, { init: `${dataPatchInit(patch)}\n${READS_INIT}` });
  await go('#library');
  await p.ev('localStorage.clear()');
  await go('#library');
  await soon(idsAre(items.map((x) => x.id)), 'every card');
  const target = `artifact:${ids.docs}`, other = `artifact:${ids.diagram}`;
  await p.ev(`(() => { const c = ${card(target)}, d = c.querySelector('.card-head details.menu'); d.open = true; d.__mark = 'kept'; c.__mark = 'kept'; ${card(other)}.__mark = 'other'; })()`);
  // polls, not a fixed wait: three more reads of /api/data begun (the page's 300 ms poll), the earlier ones read and drawn
  const reads = await p.ev('window.__dataReads');
  await soon(`window.__dataReads >= ${reads + 3}`, 'two more polls');
  assert.deepEqual(await p.ev(`(() => { const c = ${card(target)}, d = c.querySelector('.card-head details.menu'); return { card: c.__mark, menu: d.__mark, open: d.open, other: ${card(other)}.__mark }; })()`),
    { card: 'kept', menu: 'kept', open: true, other: 'other' }, 'the same nodes, the menu still open');
  // the card's summary changes: that card is drawn anew, its menu opened again; the others are kept
  await p.ev(`window.__fx.library.artifacts.find((a) => a.slug === ${JSON.stringify(ids.docs)}).summary = 'Now it shows the new guide'`);
  await soon(`${card(target)}.querySelector('.lib-body').textContent.includes('Now it shows the new guide')`, 'the new summary');
  assert.deepEqual(await p.ev(`(() => { const c = ${card(target)}, d = c.querySelector('.card-head details.menu'); return { card: c.__mark ?? null, menu: d.__mark ?? null, open: d.open, other: ${card(other)}.__mark }; })()`),
    { card: null, menu: null, open: true, other: 'other' }, 'a new node for the changed card, its menu open; the other kept');
  assert.equal(await p.ev(idsAre(items.map((x) => x.id))), true, 'the order kept');
  // an empty Library (no artifact, preview, review page or link): None
  await p.ev("window.__fx.library = { ...window.__fx.library, artifacts: [], previews: [], links: [] }; window.__fx.questions = window.__fx.questions.filter((q) => q.kind !== 'review')");
  await soon("document.getElementById('lib-grid').textContent.trim() === 'None'", 'None for an empty Library');
  assert.equal(await p.ev(`${IDS}.length`), 0);
  assert.equal(await p.ev("document.getElementById('n-library').textContent"), '', 'no count');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a preview card keeps dev-links\' selectors', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, patch, ids } = await libraryAll(t);
  const live = patch.library.previews.find((x) => x.name === ids.pvLive);
  const sel = `[data-preview="${ids.pvLive}"]`;
  assert.deepEqual(await p.ev(`(() => { const c = document.querySelector('${sel}'); return { card: c.matches('#lib-grid > .lib-card'), live: !!c.querySelector('.badge.good'), copy: c.querySelector('[data-copy]').dataset.copy, copyText: c.querySelector('[data-copy]').textContent, open: c.querySelector('a.av-open').getAttribute('href') }; })()`),
    { card: true, live: true, copy: `http://127.0.0.1:${live.port}/`, copyText: 'Copy link', open: `/view/preview/${ids.pvLive}` }, 'data-preview, the live .badge.good, Copy link the first [data-copy], ↗ as a.av-open');
  // Copy link in the head, before ↗ and ⋯
  assert.equal(await p.ev(`(() => { const h = document.querySelector('${sel} .card-head'), k = [...h.children]; return k.at(-3).matches('[data-copy]'); })()`), true);
  // every preview card carries data-preview; no card has a preview's error span (the bar's alone)
  for (const x of patch.library.previews) {
    assert.equal(await p.ev(`document.querySelector('[data-preview="${x.name}"]')?.dataset.libId`), `preview:${x.name}`);
    assert.equal(await p.ev(`document.querySelectorAll('[id="e-preview-${x.name}"]').length`), 0, `${x.name}: no e-preview span on the Library`);
  }
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a card\'s head', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, items, ids } = await libraryAll(t);
  const heads = await p.ev(`[...document.querySelectorAll('#lib-grid > .lib-card')].map((c) => {
    const h = c.querySelector(':scope > .card-head'), k = [...h.children], m = h.querySelector(':scope > details.menu');
    const edge = h.getBoundingClientRect().right - parseFloat(getComputedStyle(h).paddingRight);
    return { id: c.dataset.libId, title: !!h.querySelector(':scope > .lib-title'), tab: k.at(-2).matches('a.lib-tab') && !!k.at(-2).querySelector('i.icon-external-link'), menu: k.at(-1).matches('details.menu'), right: Math.abs(m.getBoundingClientRect().right - edge) };
  })`);
  for (const [i, x] of items.entries()) {
    const h = heads[i];
    assert.equal(h.title, true, `${x.id}: the title in .card-head`);
    assert.equal(h.menu, true, `${x.id}: ⋯ last`);
    if (x.kind !== 'review') assert.equal(h.tab, true, `${x.id}: ↗ (a.lib-tab, icon-external-link) then ⋯`);
    else assert.equal(h.tab, false, `${x.id}: a review's head ends with ⋯ alone`);
    assert.ok(h.right <= 1, `${x.id}: ⋯ at the head's right edge (off by ${h.right}px)`);
  }
  // the drafts: the draft badge, then "in <worktree>" (the newest draft's)
  const draft = (slug) => p.ev(`(() => { const h = ${art(slug)}.querySelector('.card-head'), b = h.querySelector('.badge.amber'); return { badge: b?.textContent ?? null, afterTitle: !!b && h.querySelector('.lib-title').compareDocumentPosition(b) === Node.DOCUMENT_POSITION_FOLLOWING, in: b?.nextElementSibling?.textContent ?? null, wt: b?.nextElementSibling?.querySelector('a')?.getAttribute('href') ?? null }; })()`);
  // the worktree by its id, as the spec writes it, a link to its ticket
  assert.deepEqual(await draft(ids.drafted), { badge: 'draft', afterTitle: true, in: `in ${ids.wt2}`, wt: `#ticket/${ids.wt2}` }, 'the newest draft\'s worktree');
  assert.deepEqual(await draft(ids.draftOnly), { badge: 'draft', afterTitle: true, in: `in ${ids.wt1}`, wt: `#ticket/${ids.wt1}` });
  assert.equal(await p.ev(`!!${art(ids.docs)}.querySelector('.badge.amber')`), false, 'a landed card has no draft badge');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('clicks open the viewer, links a new tab', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, ids } = await libraryAll(t);
  const wt = ids.wt2, slug = ids.drafted;
  const c = `[data-lib-id="artifact:${slug}"]`;
  assert.deepEqual(await p.ev(`[document.querySelector('${c} .lib-title').getAttribute('href'), document.querySelector('${c} .lib-thumb').matches('a'), document.querySelector('${c} .lib-thumb').getAttribute('href')]`),
    [`#artifact/wt/${wt}/${slug}`, true, `#artifact/wt/${wt}/${slug}`], 'title and thumbnail open the newest draft');
  const viewer = `!document.getElementById('artifact-view').hidden && document.getElementById('av-frame').getAttribute('src').endsWith('/artifact/wt/${wt}/${slug}/')`;
  await p.click(`${c} .lib-title`);
  await soon(viewer, 'the title opens the viewer on the draft');
  assert.equal(await p.ev("document.getElementById('drawer').hidden"), true, 'no peek');
  await p.click('#av-close');
  await soon("document.getElementById('artifact-view').hidden && location.hash.startsWith('#library')", 'closed, back on the Library');
  await p.click(`${c} .lib-thumb`);
  await soon(viewer, 'the thumbnail opens the viewer on the draft');
  assert.equal(await p.ev("document.getElementById('drawer').hidden"), true, 'no peek');
  await p.click('#av-close');
  await soon("document.getElementById('artifact-view').hidden && location.hash.startsWith('#library')", 'closed again');
  // a link's title: a new tab, the page stays (the default is stopped last, so no real tab loads; the page's own handlers ran first)
  const lc = `[data-lib-id="link:${ids.linkUrl}"]`;
  assert.deepEqual(await p.ev(`[document.querySelector('${lc} .lib-title').getAttribute('href'), document.querySelector('${lc} .lib-title').getAttribute('target'), document.querySelector('${lc} .lib-thumb').getAttribute('href'), document.querySelector('${lc} .lib-thumb').getAttribute('target')]`),
    ['https://www.figma.com/file/pay-flow', '_blank', 'https://www.figma.com/file/pay-flow', '_blank']);
  const href = await p.ev(`(() => { window.__opened = []; window.__clicked = []; const o = window.open; window.open = (...a) => { window.__opened.push(a); return null; };
    window.addEventListener('click', (e) => { const a = e.target.closest('a'); window.__clicked.push({ href: a?.getAttribute('href') ?? null, target: a?.target ?? null, prevented: e.defaultPrevented }); e.preventDefault(); }, { once: true }); return location.href; })()`);
  await p.click(`${lc} .lib-title`);
  await soon('window.__clicked.length === 1', 'the click seen');
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(await p.ev('[location.href, window.__opened.length, window.__clicked[0]]'), [href, 0, { href: 'https://www.figma.com/file/pay-flow', target: '_blank', prevented: false }], 'a new tab, the page unchanged');
  assert.deepEqual(await p.ev('window.__errors'), []);
  // a preview's title opens #preview/<name>; a review's #review/<qid>
  assert.equal(await p.ev(`document.querySelector('[data-lib-id="preview:${ids.pvLive}"] .lib-title').getAttribute('href')`), `#preview/${ids.pvLive}`);
  assert.equal(await p.ev(`document.querySelector('[data-lib-id="review:${ids.reviewQ}"] .lib-title').getAttribute('href')`), `#review/${ids.reviewQ}`);
  await p.click(`[data-lib-id="preview:${ids.pvLive}"] .lib-title`);
  await soon(`location.hash === '#preview/${ids.pvLive}' && !document.getElementById('artifact-view').hidden`, 'the preview in the viewer');
  await p.click('#av-close');
  await soon("document.getElementById('artifact-view').hidden && location.hash.startsWith('#library')", 'closed');
  await p.click(`[data-lib-id="review:${ids.reviewQ}"] .lib-title`);
  await soon(`location.hash === '#review/${ids.reviewQ}'`, 'the review page');
});

test('an artifact card\'s meta', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, ids } = await libraryAll(t);
  const meta = (slug) => p.ev(`(() => { const m = ${art(slug)}.querySelector('.lib-meta'); const by = m?.querySelector('.lib-by'), f = m?.querySelector('.lib-for');
    return { by: by ? [by.firstChild.textContent, [...by.querySelectorAll('a')].map((a) => a.getAttribute('href'))] : null, for: f ? [f.firstChild.textContent, [...f.querySelectorAll('a')].map((a) => a.getAttribute('href'))] : null, text: m?.textContent ?? '' }; })()`);
  const d = await meta(ids.drafted);
  assert.deepEqual([d.by, d.for], [['drawn by ', ['#planner/pay']], ['for ', [`#feature/${ids.feat1}`]]], 'the planner\'s session; the feature');
  assert.equal(await p.ev(`${art(ids.drafted)}.querySelector('.lib-for a').textContent === DATA.ooda.roadmap.features[${JSON.stringify(ids.feat1)}].title`), true, 'the feature by its title');
  const pub = await meta(ids.public);
  assert.deepEqual([pub.by, pub.for], [['drawn by ', ['#planner/pay']], ['for ', [`#goal/${ids.goal1}`]]], 'a goal');
  const nl = await meta(ids.notLive);
  assert.deepEqual([nl.by, nl.for], [['drawn by ', [`#ticket/${ids.tHeld}`]], ['for ', [`#ticket/${ids.tHeld}`]]], 'a ticket\'s session; a ticket');
  const broken = await meta(ids.broken);
  assert.equal(broken.by, null, 'no by: no drawn by');
  assert.ok(!broken.text.includes('drawn by'));
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('the ⋯ menu', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, items } = await libraryAll(t);
  const menus = await p.ev(`[...document.querySelectorAll('#lib-grid > .lib-card')].map((c) => { const m = c.querySelector('.card-head > details.menu'); const b = (s) => [...m.querySelectorAll(s)].map((x) => [x.textContent, x.dataset.copy ?? x.dataset.menuOpen]);
    return { id: c.dataset.libId, kv: m.querySelector('.kv code')?.textContent, copy: b('[data-copy]').filter(([s]) => s === 'Copy ID'), peek: b('[data-menu-open]') }; })`);
  for (const [i, x] of items.entries()) {
    assert.deepEqual(menus[i], { id: x.id, kv: x.id, copy: [['Copy ID', x.id]], peek: [['Open in side peek', `lib/${x.id}`]] }, `${x.id}: ID, Copy ID, Open in side peek`);
  }
});

test('the gap-audit rows off a box', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, patch, ids } = await libraryAll(t);
  const text = (id) => p.ev(`${card(id)}.textContent.replace(/\\s+/g, ' ')`);
  const badges = (id) => p.ev(`[...${card(id)}.querySelectorAll('.card-head .badge')].map((b) => b.textContent)`);
  // each preview state, its name, project, session (a link) and offered
  const states = { [ids.pvLive]: 'live', [ids.pvChecking]: 'checking', [ids.pvNotRunning]: 'not running', [ids.pvDown]: 'not answering', [ids.pvExpired]: 'expired' };
  for (const x of patch.library.previews) {
    const id = `preview:${x.name}`;
    assert.ok((await badges(id)).includes(states[x.name]), `${x.name}: its state`);
    const s = await text(id);
    assert.ok(s.includes(x.name) && s.includes(x.project) && s.includes('offered '), `${x.name}: name, project, offered: ${s}`);
    assert.equal(await p.ev(`${card(id)}.querySelector('.lib-body code')?.textContent`), x.name, `${x.name}: the name in code`);
  }
  assert.equal(await p.ev(`${card(`preview:${ids.pvLive}`)}.querySelector('.lib-body a[href="#ticket/${ids.tBuilding}"]') !== null`), true, 'the session a link');
  assert.ok((await text(`preview:${ids.pvDown}`)).includes('down since '), 'not answering: down since');
  const live = patch.library.previews.find((x) => x.name === ids.pvLive);
  assert.equal(await p.ev(`${card(`preview:${ids.pvLive}`)}.querySelector('[data-copy]').dataset.copy`), `http://127.0.0.1:${live.port}/`, 'Copy link on the live card');
  for (const x of [ids.pvNotRunning, ids.pvDown, ids.pvExpired]) assert.equal(await p.ev(`[...${card(`preview:${x}`)}.querySelectorAll('[data-copy]')].some((b) => b.textContent === 'Copy link')`), false, `${x}: no Copy link`);
  // no Start or Stop on any card
  assert.deepEqual(await p.ev("[...document.querySelectorAll('#lib-grid *')].filter((e) => ['Start', 'Stop'].includes(e.textContent.trim())).length"), 0, 'no Start or Stop');
  assert.equal(await p.ev("document.querySelectorAll('#lib-grid [data-preview-start], #lib-grid [data-preview-stop]').length"), 0);
  // the broken card
  assert.deepEqual(await badges(`artifact:${ids.broken}`), ['broken']);
  assert.equal(await p.ev(`${art(ids.broken)}.querySelector('.card-head .badge').matches('.badge.high')`), true);
  assert.ok((await text(`artifact:${ids.broken}`)).includes('manifest.json: title is missing'), 'its error');
  // each link: kind badge, id, location, for, notes
  for (const l of patch.library.links) {
    const id = `link:${l.id}`;
    const s = await text(id);
    assert.equal(await p.ev(`${card(id)}.querySelector('.lib-body .badge')?.textContent`), l.kind, `${l.id}: its kind`);
    assert.equal(await p.ev(`[...${card(id)}.querySelectorAll('.lib-body code')].some((c) => c.textContent === ${JSON.stringify(l.id)})`), true, `${l.id}: its id`);
    const loc = l.url || (l.remote ? `${l.remote}${l.path ? `:${l.path}` : ''}` : l.path);
    assert.ok(s.includes(loc), `${l.id}: its location ${loc}`);
    if (l.notes) assert.ok(s.includes(l.notes), `${l.id}: its notes`);
    if (l.for.length) assert.ok(s.includes('for '), `${l.id}: for`);
  }
  assert.equal(await p.ev(`${card(`link:${ids.linkUrl}`)}.querySelector('.lib-body a[href="#goal/${ids.goal1}"]') !== null`), true, 'for: a goal link');
  // published, off a box; no Public badge
  assert.ok((await badges(`artifact:${ids.public}`)).includes('published'), 'published off a box');
  assert.ok(!(await badges(`artifact:${ids.public}`)).includes('Public'));
  assert.ok((await text(`artifact:${ids.public}`)).includes('recorded '), 'when it was recorded');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('publish on the card (box)', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { p, port, ids } = await libraryAll(t, { fx, box: servedOf(fx.ids) });
  assert.equal(await p.ev("typeof PUBLIC === 'object' && !!PUBLIC && location.host.startsWith('4321.box.localhost')"), true, 'on the box');
  const pub = art(ids.public);
  assert.deepEqual(await p.ev(`(() => { const c = ${pub}, b = c.querySelector('.lib-title').nextElementSibling; return { good: b.matches('.badge.good'), globe: !!b.querySelector('i.icon-globe'), text: b.textContent.trim(), dot: !!c.querySelector('.dot'), live: /\\blive\\b/i.test(c.textContent), border: getComputedStyle(c).borderColor === getComputedStyle(${art(ids.docs)}).borderColor }; })()`),
    { good: true, globe: true, text: 'Public', dot: false, live: false, border: true }, 'Public with a globe, after the title; no dot, no live, the plain border');
  const text = (slug) => p.ev(`${art(slug)}.textContent.replace(/\\s+/g, ' ')`);
  const s = await text(ids.public);
  assert.ok(s.includes('Public on this box') && /recorded .+ from the dashboard/.test(s), `publish details: ${s}`);
  assert.ok((await text(ids.drift)).includes('changed on main since'), 'drift');
  // drift in amber: its computed colour is --amber-fg's (resolved on a probe beside it)
  assert.deepEqual(await p.ev(`(() => { const d = ${art(ids.drift)}.querySelector('.lib-drift'), x = document.createElement('span'); x.style.color = 'var(--amber-fg)'; d.after(x); const want = getComputedStyle(x).color; x.remove(); return [d.textContent, getComputedStyle(d).color === want, want !== getComputedStyle(${art(ids.drift)}).color]; })()`), ['changed on main since', true, true], 'drift in amber');
  // not live: the badge, Restore (the gateway's publish page, a new tab), the error span, Forget in ⋯
  const box = `http://box.localhost:${port}`;
  const nl = art(ids.notLive);
  assert.ok((await text(ids.notLive)).includes('not live on this box'));
  assert.deepEqual(await p.ev(`(() => { const a = [...${nl}.querySelectorAll('a')].find((x) => x.textContent === 'Restore'); return a && [a.getAttribute('href'), a.target]; })()`), [`${box}/public/publish?port=4321&slug=${ids.notLive}`, '_blank']);
  assert.equal(await p.ev(`${nl}.querySelector('#e-pub-${ids.notLive}') !== null`), true, 'its error span');
  assert.equal(await p.ev(`${nl}.querySelector('.card-head details.menu [data-forget="${ids.notLive}"]')?.textContent`), 'Forget', 'Forget in ⋯');
  assert.equal(await p.ev("[...document.querySelectorAll('#lib-top a')].some((a) => a.textContent === 'Restore all')"), true, 'Restore all above the grid');
  // the public card's ⋯: Copy public link
  assert.equal(await p.ev(`[...${pub}.querySelectorAll('.card-head details.menu [data-copy]')].find((b) => b.textContent === 'Copy public link')?.dataset.copy`), `http://public.box.localhost:${port}/${ids.project}/${ids.public}/`);
  assert.deepEqual(await p.ev(ERRORS), []);
});

test('no publish buttons on any card (box)', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { p, port, ids } = await libraryAll(t, { fx, box: servedOf(fx.ids) });
  const badges = (slug) => p.ev(`[...${art(slug)}.querySelectorAll('.card-head .badge')].map((b) => b.textContent.trim())`);
  // every state drawn: public, public with an update, drifted and not live, not live
  assert.ok((await badges(ids.public)).includes('Public'));
  assert.ok((await badges(ids.pubUpdate)).includes('Public'));
  assert.ok((await badges(ids.drift)).includes('not live on this box'));
  assert.ok((await badges(ids.notLive)).includes('not live on this box'));
  const WORDS = ['Start', 'Stop', "Review main's version"];
  assert.deepEqual(await p.ev(`[...document.querySelectorAll('#lib-grid *')].map((e) => e.textContent.trim()).filter((s) => ${JSON.stringify(WORDS)}.includes(s))`), [], 'none of the preview buttons, menus included');
  // no control publishes by itself (kit-751): Publish, Update, Unpublish and Restore are only links, each the
  // gateway's own confirm page in a new tab, where the owner confirms. Every element whose text is one of those
  // words, with children or not (a button holding an icon and the word), is such a link, sits in one or holds one.
  const PUB = ['Publish', 'Update', 'Unpublish', 'Restore'];
  const gw = JSON.stringify(`http://box.localhost:${port}/`);
  const gwSel = JSON.stringify(`a[href^="http://box.localhost:${port}/"]`);
  assert.deepEqual(await p.ev(`[...document.querySelectorAll('#lib-grid *')].filter((e) => ${JSON.stringify(PUB)}.includes(e.textContent.trim())).filter((e) => !(e.closest(${gwSel}) || e.querySelector(${gwSel}))).map((e) => e.outerHTML)`), [], 'every publish word a link to the gateway');
  const links = await p.ev(`[...document.querySelectorAll('#lib-grid a[href]')].filter((a) => a.getAttribute('href').startsWith(${gw})).map((a) => [a.textContent, a.target, new URL(a.href).pathname])`);
  assert.ok(links.length > 0, 'the gateway\'s pages are linked');
  for (const [label, target, at] of links) assert.ok(target === '_blank' && ['/public/publish', '/public/unpublish'].includes(at), `${label}: the gateway's confirm page in a new tab (${target} ${at})`);
  assert.deepEqual(await p.ev(ERRORS), []);
});

test('a refused Forget says why (box)', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { p, soon, ids } = await libraryAll(t, { fx, box: servedOf(fx.ids), init: FORGET_FAILS });
  const c = `[data-lib-id="artifact:${ids.notLive}"]`;
  await p.click(`${c} .card-head details.menu > summary`);
  await soon(`document.querySelector('${c} .card-head details.menu').open`, 'the ⋯ open');
  await p.click(`${c} [data-forget]`);
  await soon(`document.querySelector('${c} [data-forget]').textContent === 'Confirm forget'`, 'the confirm step');
  await p.click(`${c} [data-forget]`);
  await soon(`document.getElementById('e-pub-${ids.notLive}').textContent.includes('no')`, 'the refusal in e-pub');
  assert.equal(await p.ev(`document.getElementById('e-pub-${ids.notLive}').textContent`), 'Not saved: no');
  assert.equal(await p.ev(`document.querySelector('${c}').contains(document.getElementById('e-pub-${ids.notLive}'))`), true, 'on the card');
  assert.deepEqual(await p.ev(ERRORS), []);
});

test('a draft\'s worktree truncates in the head', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { patch, ids } = fx;
  // the newest draft in a worktree with a long id, its ticket a very long title
  const WT = `pay-99-${'a-very-long-worktree-name-'.repeat(4)}end`;
  const base = patch.tickets.find((x) => x.id === ids.wt2);
  patch.tickets = [...patch.tickets, { ...base, id: WT, title: `The refund screen, ${'with every state the processor can answer in, '.repeat(6)}end` }];
  patch.library.artifacts.find((a) => a.slug === ids.drafted && a.at === ids.wt2).at = WT;
  const { p } = await libraryAll(t, { fx });
  const m = await p.ev(`(() => { const c = ${art(ids.drafted)}, h = c.querySelector('.card-head'), w = h.querySelector('.lib-wt'), r = h.getBoundingClientRect(), edge = r.right - parseFloat(getComputedStyle(h).paddingRight);
    const plain = ${art(ids.docs)}.querySelector('.card-head').getBoundingClientRect().height;
    return { text: w.textContent, href: w.querySelector('a').getAttribute('href'), tip: w.querySelector('a').title.startsWith('The refund screen'), cut: w.scrollWidth > w.clientWidth, tab: h.querySelector(':scope > .lib-tab').getBoundingClientRect().right <= edge + 1, menu: h.querySelector(':scope > details.menu').getBoundingClientRect().right <= edge + 1, title: (() => { const x = h.querySelector('.lib-title'); return { wide: x.getBoundingClientRect().width >= 40, cut: x.scrollWidth > x.clientWidth }; })(), height: r.height === plain, cardRight: h.querySelector(':scope > details.menu').getBoundingClientRect().right <= c.getBoundingClientRect().right }; })()`);
  assert.deepEqual(m, { text: `in ${WT}`, href: `#ticket/${WT}`, tip: true, cut: true, tab: true, menu: true, title: { wide: true, cut: true }, height: true, cardRight: true }, 'the worktree id, cut short; the title keeps 40px or more, truncated; ↗ and ⋯ inside the head; the head\'s height unchanged');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('served by another instance: from instance <port> (box)', { ...CHROME, timeout: 300000 }, async (t) => {
  // the box serves this project's copy from instance 4399, not this page's 4321
  const fx = libraryFixture();
  const box = servedOf(fx.ids);
  box[fx.ids.project].port = 4399;
  const { p, ids } = await libraryAll(t, { fx, box });
  const s = await p.ev(`${art(ids.public)}.textContent.replace(/\\s+/g, ' ')`);
  assert.ok(s.includes('from instance 4399') && !s.includes('Public on this box'), `from instance: ${s}`);
  assert.deepEqual(await p.ev(ERRORS), []);
});

test('thumbnail frames are sandboxed, lazy and inert', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon } = await libraryAll(t);
  await soon("document.querySelectorAll('#lib-grid .lib-thumb > iframe').length > 0", 'a thumbnail frame');
  const fs_ = await p.ev(`[...document.querySelectorAll('#lib-grid .lib-thumb iframe')].map((f) => { const b = f.parentElement, r = f.getBoundingClientRect(), q = b.getBoundingClientRect(), s = getComputedStyle(b);
    return { parent: b.matches('.lib-thumb'), sandbox: f.getAttribute('sandbox'), loading: f.getAttribute('loading'), lazy: f.loading, events: getComputedStyle(f).pointerEvents, tabindex: f.getAttribute('tabindex'), hidden: f.getAttribute('aria-hidden'),
      src: f.getAttribute('src') === b.dataset.thumbSrc, state: b.dataset.thumb, ratio: Math.abs(q.width / q.height - 16 / 9) < 0.03,
      fills: Math.abs(r.width - b.clientWidth) <= 1 && Math.abs(r.height - b.clientHeight) <= 1 && Math.abs(r.left - q.left - b.clientLeft) <= 1 && Math.abs(r.top - q.top - b.clientTop) <= 1 }; })`);
  assert.ok(fs_.length > 0);
  for (const f of fs_) assert.deepEqual(f, { parent: true, sandbox: 'allow-scripts', loading: 'lazy', lazy: 'lazy', events: 'none', tabindex: '-1', hidden: 'true', src: true, state: 'live', ratio: true, fills: true }, 'a sandboxed, lazy, inert frame filling its 16:9 box');
  // every box says its state; one with no frame source never holds a frame
  const states = await p.ev("[...document.querySelectorAll('#lib-grid .lib-thumb')].map((b) => [b.dataset.thumbSrc, b.dataset.thumb ?? null, !!b.querySelector('iframe')])");
  for (const [src, state, frame] of states) {
    assert.ok(['icon', 'live', 'failed'].includes(state), `a box's state: ${state}`);
    if (!src) assert.deepEqual([state, frame], ['icon', false], 'no source: the icon');
  }
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('at most 12 live, only in view', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon } = await libraryAll(t, { fx: libraryFixture({ artifacts: 60 }), height: 3000 });
  await soon(`${VIEW}.frames === 12`, 'twelve frames');
  await sleep(1500);
  const top = await p.ev(VIEW);
  assert.ok(top.srcInView > 12, `more than 12 boxes with a frame source in view (${top.srcInView})`);
  assert.equal(top.frames, 12, 'exactly 12 frames');
  assert.ok(top.holding.every((h) => h.inView), 'every frame in view');
  await p.ev('window.scrollTo(0, document.scrollingElement.scrollHeight)');
  const was = JSON.stringify(top.holding.map((h) => h.id));
  await soon(`(() => { const v = ${VIEW}; return v.frames === 12 && v.holding.every((h) => h.inView) && !v.holding.some((h) => ${was}.includes(h.id)); })()`, 'twelve frames, all at the bottom');
  await sleep(1500);
  const bottom = await p.ev(VIEW);
  assert.ok(bottom.srcInView > 12, `more than 12 boxes with a frame source in view at the bottom (${bottom.srcInView})`);
  assert.equal(bottom.frames, 12, 'exactly 12 frames at the bottom');
  assert.ok(bottom.holding.every((h) => h.inView), 'every frame in view at the bottom');
  const tops = top.inView;
  assert.ok(tops.every((id) => !bottom.inView.includes(id)), 'the top boxes are out of view');
  assert.ok(bottom.holding.every((h) => !tops.includes(h.id)), 'the top boxes hold none');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a frame that never loads falls back after 5 s', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { ids } = fx;
  const held = [];
  // the slow artifact's request, paused and never continued, wherever the frame's request is made
  const page = (chrome) => tapPage(chrome, { patterns: [{ urlPattern: `*/artifact/main/${ids.slow}/*` }], children: true, paused: (o) => { held.push(o.request.url); } });
  const { p, soon } = await libraryOnce(t, fx, { height: 3000, init: FRAMES_INIT, page });
  const slow = `artifact:${ids.slow}`, ok = `artifact:${ids.mock}`;
  const rec = `window.__frames.find((f) => f.id === ${JSON.stringify(slow)})`;
  await soon(`!!${rec}`, 'a frame put in the slow box');
  const t0 = Date.now();
  while (!held.some((u) => u.includes(`/artifact/main/${ids.slow}/`))) {
    if (Date.now() - t0 > 3000) assert.fail(`no paused request for the slow frame within 3 s (held: ${JSON.stringify(held)})`);
    await sleep(50);
  }
  // the page's own clock throughout: data-thumb-at is stamped before its wait starts, and the observer stamps
  // a frame's going out and each data-thumb change no earlier than it happened
  const at = Number(await p.ev(`${thumb(slow)}.dataset.thumbAt`));
  assert.ok(at > 0, 'the box stamped when its frame went in');
  await soon(`${thumb(slow)}.dataset.thumb === 'failed' || performance.now() - ${at} > 8000`, 'the fallback');
  const after = await p.ev(`({ gone: ${rec}.out - ${at}, frame: !!${thumb(slow)}.querySelector('iframe'), state: ${thumb(slow)}.dataset.thumb, icon: !!${thumb(slow)}.querySelector(':scope > i.icon-layout-dashboard'),
    states: window.__states.filter((s) => s.id === ${JSON.stringify(slow)} && s.t >= ${at}).map((s) => [s.v, s.t - ${at}]) })`);
  assert.equal(after.state, 'failed', 'data-thumb="failed"');
  assert.equal(after.frame, false, 'no frame');
  assert.equal(after.icon, true, 'the kind\'s icon');
  // still a frame, and live, at its own stamp + 4 s: nothing but live before the frame went out
  assert.ok(after.gone > 4000, `a frame at 4 s (out at ${after.gone} ms)`);
  assert.ok(after.states.every(([v, dt]) => v === 'live' || dt >= 5000), `live until the fallback: ${JSON.stringify(after.states)}`);
  assert.ok(after.gone >= 5000 && after.gone <= 7000, `taken out between 5 and 7 s (${after.gone} ms)`);
  // not retried; one that loads keeps its frame
  await sleep(1500);
  assert.deepEqual(await p.ev(`[${thumb(slow)}.dataset.thumb, !!${thumb(slow)}.querySelector('iframe'), window.__frames.filter((f) => f.id === ${JSON.stringify(slow)}).length]`), ['failed', false, 1], 'not retried');
  assert.deepEqual(await p.ev(`[${thumb(ok)}.dataset.thumb, !!${thumb(ok)}.querySelector('iframe')]`), ['live', true], 'a normal box keeps its frame');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a refused preview frame is the icon', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { ids } = fx;
  const { p, soon } = await libraryOnce(t, fx, { init: FRAMES_INIT });
  const live = `preview:${ids.pvLive}`;
  // on 127.0.0.1 the page's frame-src allows no preview's own origin
  assert.match(await p.ev(`${thumb(live)}.dataset.thumbSrc`), /^http:\/\/127\.0\.0\.1:\d+\/$/);
  await p.ev(`${card(live)}.scrollIntoView({ block: 'center' })`);
  const rec = `window.__frames.find((f) => f.id === ${JSON.stringify(live)})`;
  await soon(`!!${rec}`, 'a frame put in the live preview\'s box');
  await soon(`${thumb(live)}.dataset.thumb === 'failed'`, 'the refused frame failed');
  const r = await p.ev(`({ gone: ${rec}.out === undefined ? null : ${rec}.out - ${rec}.in, frame: !!${thumb(live)}.querySelector('iframe'), icon: !!${thumb(live)}.querySelector(':scope > i.icon-monitor-play') })`);
  assert.ok(r.gone !== null && r.gone < 1000, `taken out within 1 s (${r.gone} ms)`);
  assert.deepEqual([r.frame, r.icon], [false, true], 'the icon, no frame');
  await sleep(1500);
  const notLive = [ids.pvChecking, ids.pvNotRunning, ids.pvDown, ids.pvExpired].map((n) => `preview:${n}`);
  assert.deepEqual(await p.ev(`[${thumb(live)}.dataset.thumb, !!${thumb(live)}.querySelector('iframe'), window.__frames.filter((f) => f.id === ${JSON.stringify(live)}).length]`), ['failed', false, 1], 'never a frame past that, not retried');
  const inView = await p.ev(VIEW);
  for (const id of notLive) assert.ok(inView.inView.includes(id), `${id} in view`);
  assert.deepEqual(await p.ev(`${FRAMES}.filter((f) => ${JSON.stringify(notLive)}.includes(f.id))`), [], 'a preview that isn\'t live never had a frame');
  for (const id of notLive) assert.equal(await p.ev(`${thumb(id)}.dataset.thumb`), 'icon', `${id}: the icon`);
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a link shows its site icon', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { ids } = fx;
  const asked = [];
  // figma's icon held (so it stays), github's refused (so it is removed)
  const page = (chrome) => tapPage(chrome, { patterns: [{ urlPattern: 'https://www.figma.com/favicon.ico' }, { urlPattern: 'https://github.com/favicon.ico' }], paused: (o, reply) => {
    asked.push(o.request.url);
    if (o.request.url.startsWith('https://github.com/')) reply('Fetch.failRequest', { requestId: o.requestId, errorReason: 'Failed' });
  } });
  const { p, soon } = await libraryOnce(t, fx, { init: FRAMES_INIT, page });
  const url = `link:${ids.linkUrl}`, remote = `link:${ids.linkRemote}`, file = `link:${ids.linkPath}`;
  await p.ev(`${card(url)}.scrollIntoView({ block: 'center' })`);
  const seen = (id) => p.ev(`(() => { const b = ${thumb(id)}, i = b.querySelector('img'); return { img: i ? [i.getAttribute('src'), i.getAttribute('referrerpolicy')] : null, text: b.textContent.trim(), icon: !!b.querySelector('i.icon-link'), frame: !!b.querySelector('iframe') }; })()`);
  assert.deepEqual(await seen(url), { img: ['https://www.figma.com/favicon.ico', 'no-referrer'], text: 'www.figma.com', icon: false, frame: false }, 'the site\'s icon and its host');
  // an icon that fails is removed; the host stays
  await soon(`!${thumb(remote)}.querySelector('img')`, 'the failed icon removed');
  assert.ok(asked.includes('https://github.com/favicon.ico'), 'github\'s icon was asked for');
  assert.deepEqual(await seen(remote), { img: null, text: 'github.com', icon: true, frame: false }, 'its host, the link icon');
  assert.deepEqual(await seen(file), { img: null, text: '', icon: true, frame: false }, 'no host: the link icon');
  await sleep(1000);
  assert.deepEqual(await p.ev(`${FRAMES}.filter((f) => f.id.startsWith('link:'))`), [], 'never a frame in a link\'s box');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a poll keeps a live frame', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { ids } = fx;
  const { p, soon } = await libraryAll(t, { fx, init: READS_INIT });
  const id = `artifact:${ids.mock}`;
  await soon(`!!${thumb(id)}.querySelector('iframe')`, 'a live frame');
  await p.ev(`${thumb(id)}.querySelector('iframe').__mark = 'kept'`);
  const reads = await p.ev('window.__dataReads');
  await soon(`window.__dataReads >= ${reads + 3}`, 'two more polls');
  assert.deepEqual(await p.ev(`(() => { const f = ${thumb(id)}.querySelector('iframe'); return [f?.__mark ?? null, f?.isConnected ?? false, ${thumb(id)}.dataset.thumb]; })()`), ['kept', true, 'live'], 'the same frame in its box');
  // another card changes: the grid is patched (that card drawn anew), and the marked frame is still the same element
  const other = `artifact:${ids.docs}`;
  await p.ev(`${card(other)}.__mark = 'old'`);
  await p.ev(`window.__fx.library.artifacts.find((a) => a.slug === ${JSON.stringify(ids.docs)}).summary = 'Now it shows the new guide'`);
  await soon(`${card(other)}.querySelector('.lib-body').textContent.includes('Now it shows the new guide')`, 'the other card patched');
  assert.equal(await p.ev(`${card(other)}.__mark ?? null`), null, 'the other card is a new node');
  assert.deepEqual(await p.ev(`(() => { const f = ${thumb(id)}.querySelector('iframe'); return [f?.__mark ?? null, f?.isConnected ?? false, ${thumb(id)}.dataset.thumb]; })()`), ['kept', true, 'live'], 'the same frame after a patch');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a card removed by a poll frees its slot', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon } = await libraryAll(t, { fx: libraryFixture({ artifacts: 60 }), height: 3000 });
  await soon(`${VIEW}.frames === 12`, 'twelve frames');
  await sleep(1000);
  const before = await p.ev(VIEW);
  assert.ok(before.srcInView > 12, `more than 12 boxes with a frame source in view (${before.srcInView})`);
  const gone = before.holding.map((h) => h.id).find((id) => id.startsWith('artifact:bulk-'));
  assert.ok(gone, 'a framed bulk card');
  const slug = gone.slice('artifact:'.length);
  await p.ev(`window.__fx.library.artifacts = window.__fx.library.artifacts.filter((a) => a.slug !== ${JSON.stringify(slug)})`);
  await soon(`!${card(gone)}`, 'the card patched away');
  const was = JSON.stringify(before.holding.map((h) => h.id));
  await soon(`(() => { const v = ${VIEW}; return v.frames === 12 && v.holding.some((h) => !${was}.includes(h.id)); })()`, 'its slot taken by the next box in view');
  await sleep(1000);
  const after = await p.ev(VIEW);
  assert.equal(after.frames, 12, 'exactly 12 frames');
  assert.ok(after.holding.every((h) => h.inView && h.id !== gone), 'every frame in a box in view that still exists');
  // nothing the thumbnails keep is a box no longer in the page (its observer let go of it)
  assert.deepEqual(await p.ev('[THUMBS.watched, THUMBS.seen, THUMBS.live].map((s) => [...s].filter((b) => !b.isConnected).length)'), [0, 0, 0], 'no detached box kept');
  assert.equal(await p.ev("[...document.querySelectorAll('iframe')].filter((f) => f.closest('.lib-thumb') && !f.closest('#lib-grid')).length"), 0);
  assert.deepEqual(await p.ev('window.__errors'), []);
});

// Last in the file (kit-925): every test before this one ran in the file's one Chrome and left none of its
// tabs open; and an origin an earlier page used starts with nothing in its storage. Run alone (a name
// pattern), no test ran before it, and the first two hold trivially.
test('one Chrome for the file: no tab left behind, and an origin used before starts empty (kit-925)', { ...CHROME, timeout: 300000 }, oneChrome);
