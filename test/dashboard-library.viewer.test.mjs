// The Library's polls, peeks, viewer, versions and Reload: the second half of test/dashboard-library.test.mjs
// (kit-925 split it so each file stays well inside run.mjs's 300 s watchdog; the fixture they share is
// test/lib/dashboard-library-fixture.mjs).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { libraryFixture } from './lib/kit.mjs';
import './lib/chrome.mjs';
import { itemsOf, soonIn, backTo, FILE, ERRORS, libraryOn, CHROME, idsAre, READS_INIT, libraryAll, sleep, VIEW, libraryOnce, PEEK, LIB_ORDER, LINK_ORDER, PEEK_REQS_INIT, VERS, versFiles, putFiles, libraryMergeInit, START_INIT, versOn, shown, VIEWING, frameIs, OPTS, LIST_OPEN, BAR, tokenColor, polls, cardTitle, VERS_WT, VERS_TITLE, oneChrome } from './lib/dashboard-library-fixture.mjs';

// the file's one Chrome closes when the file ends
after(() => FILE.chrome?.close());

test('a poll that reorders the items moves the kept cards, re-creating none', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { ids } = fx;
  const { p, soon, items } = await libraryAll(t, { fx, init: READS_INIT });
  // every card marked with its own id, to tell a kept node from a new one
  await p.ev("for (const c of document.querySelectorAll('#lib-grid > .lib-card')) c.__mark = c.dataset.libId");
  // the server lists the same rows in a new order: the first mock's row moves to the end, behind every other mock
  const rows = fx.patch.library.artifacts, at = rows.findIndex((a) => a.slug === ids.mock);
  const reordered = [...rows.slice(0, at), ...rows.slice(at + 1), rows[at]];
  const want = itemsOf({ ...fx.patch, library: { ...fx.patch.library, artifacts: reordered } }).items.map((x) => x.id);
  assert.notDeepEqual(want, items.map((x) => x.id), 'the new order differs from the old');
  assert.deepEqual([...want].sort(), items.map((x) => x.id).sort(), 'the same items');
  await p.ev(`window.__fx.library.artifacts = ${JSON.stringify(reordered)}`);
  await soon(idsAre(want), 'the cards in the new order');
  // every card is the node it was
  assert.deepEqual(await p.ev("[...document.querySelectorAll('#lib-grid > .lib-card')].filter((c) => c.__mark !== c.dataset.libId).map((c) => c.dataset.libId)"), [], 'no card re-created');
  // and later polls keep that order and those nodes
  const reads = await p.ev('window.__dataReads');
  await soon(`window.__dataReads >= ${reads + 3}`, 'two more polls');
  assert.equal(await p.ev(idsAre(want)), true, 'the new order kept');
  assert.deepEqual(await p.ev("[...document.querySelectorAll('#lib-grid > .lib-card')].filter((c) => c.__mark !== c.dataset.libId).length"), 0, 'still no card re-created');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('no thumbnail frame while the viewer covers the grid', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, ids } = await libraryOnce(t, libraryFixture());
  const frames = "document.querySelectorAll('.lib-thumb iframe').length";
  await soon(`${frames} > 0`, 'frames in the grid');
  // the viewer's page, framed again in a thumbnail, would talk to this window beside the stage's own frame
  await p.click(`[data-lib-id="artifact:${ids.mock}"] .lib-title`);
  await soon(`!document.getElementById('artifact-view').hidden && ${frames} === 0`, 'every thumbnail frame out while the viewer is open');
  await sleep(1000);
  assert.equal(await p.ev(frames), 0, 'and none comes back while it is open');
  await p.click('#av-close');
  await soon(`document.getElementById('artifact-view').hidden && ${frames} > 0`, 'the frames back once it closes');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('Open in side peek opens the item\'s properties', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, ids, items } = await libraryAll(t);
  const id = `artifact:${ids.drafted}`;
  const x = items.find((i) => i.id === id);
  const sel = `#lib-grid > .lib-card[data-lib-id="${id}"] .card-head details.menu`;
  await p.click(`${sel} > summary`);
  await soon(`document.querySelector('${sel}').open`, 'the ⋯ menu open');
  await p.click(`${sel} [data-menu-open]`);
  // the menu writes it encoded, #lib/artifact%3A<slug>
  await soon(`decodeURIComponent(location.hash) === ${JSON.stringify(`#lib/${id}`)} && !document.getElementById('drawer').hidden`, 'the peek on the item');
  await soon(`${PEEK}.rows.length > 3`, 'its properties');
  const pk = await p.ev(PEEK);
  assert.equal(pk.shown, true);
  assert.equal(pk.type, 'Library item', 'the bar\'s type badge');
  assert.equal(pk.title, x.title, 'the item\'s title in the bar');
  assert.deepEqual(pk.rows[0].slice(0, 2), ['ID', id], 'ID first, the item id');
  const dts = pk.rows.map((r) => r[0]);
  assert.deepEqual(dts, ['ID', 'Kind', 'Drawn by', 'For', 'Where', 'Updated', 'How it changes'], 'the drafted artifact\'s properties, in order');
  const row = (k) => pk.rows.find((r) => r[0] === k);
  assert.match(row('Kind')[1], /Mock/);
  assert.deepEqual(row('Drawn by')[2], [`#planner/${ids.feat1}`], 'Drawn by: a link to the session');
  assert.deepEqual(row('For')[2], [`#feature/${ids.feat1}`]);
  assert.match(row('Where')[1], new RegExp(`draft.*in ${ids.wt2}`), 'the newest draft\'s worktree');
  assert.deepEqual(row('Where')[2], [`#ticket/${ids.wt2}`]);
  assert.equal(row('How it changes')[1], 'Shift+click it and say so in a thread');
  // then the thumbnail at the peek's width, then the summary
  assert.equal(pk.thumb, true, 'the thumbnail box after the properties');
  assert.ok(Math.abs(pk.thumbW - pk.bodyW) <= 1, `the thumbnail at the peek's width (${pk.thumbW} against ${pk.bodyW})`);
  assert.equal(pk.measure, x.summary, 'the summary');
  // a published one has Published, with its details, in its place; a broken one its Error
  await p.ev(`location.hash = ${JSON.stringify(`#lib/${encodeURIComponent(`artifact:${ids.public}`)}`)}`);
  await soon(`${PEEK}.rows[0]?.[1] === ${JSON.stringify(`artifact:${ids.public}`)}`, 'the public artifact\'s peek');
  const pub = await p.ev(PEEK);
  assert.deepEqual(pub.rows.map((r) => r[0]), ['ID', 'Kind', 'Drawn by', 'For', 'Where', 'Published', 'Updated', 'How it changes']);
  assert.match(pub.rows.find((r) => r[0] === 'Where')[1], /Landed on main/);
  assert.match(pub.rows.find((r) => r[0] === 'Published')[1], /recorded .* from the dashboard/);
  await p.ev(`location.hash = ${JSON.stringify(`#lib/${encodeURIComponent(`artifact:${ids.broken}`)}`)}`);
  await soon(`${PEEK}.rows[0]?.[1] === ${JSON.stringify(`artifact:${ids.broken}`)}`, 'the broken artifact\'s peek');
  const bad = await p.ev(PEEK);
  assert.deepEqual(bad.rows.find((r) => r[0] === 'Error')?.[1], 'manifest.json: title is missing');
  // its row's own fields still show: its time (it names no by and no for)
  assert.deepEqual(bad.rows.map((r) => r[0]), ['ID', 'Kind', 'Where', 'Error', 'Updated', 'How it changes'], 'a broken one: what its row has');
  // every item's peek: ID first, How it changes last, the rows in the spec's order
  for (const i of items) {
    await p.ev(`location.hash = ${JSON.stringify(`#lib/${encodeURIComponent(i.id)}`)}`);
    await soon(`${PEEK}.rows[0]?.[1] === ${JSON.stringify(i.id)}`, `${i.id}'s peek`);
    const r = (await p.ev(PEEK)).rows.map((x) => x[0]);
    const order = i.kind === 'link' ? LINK_ORDER : LIB_ORDER;
    assert.deepEqual(r, order.filter((k) => r.includes(k)), `${i.id}: rows in order (${r.join(', ')})`);
    assert.equal(r.length, new Set(r).size, `${i.id}: each row once`);
    assert.deepEqual([r[0], r[1], r.at(-1)], ['ID', 'Kind', 'How it changes'], `${i.id}: ID, Kind first, How it changes last`);
  }
  // an unknown id: not found, the type badge still the item's
  await p.ev("location.hash = '#lib/artifact%3Ano-such-thing'");
  await soon("document.querySelector('#drawer-bar-title .dtitle')?.textContent === 'artifact:no-such-thing'", 'not found');
  assert.equal(await p.ev("document.querySelector('#drawer-bar-title .dtype .badge')?.textContent"), 'Library item');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a link\'s peek has its details', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, ids } = await libraryAll(t);
  await p.ev(`location.hash = ${JSON.stringify(`#lib/link:${ids.linkUrl}`)}`);
  await soon(`${PEEK}.rows[0]?.[1] === ${JSON.stringify(`link:${ids.linkUrl}`)}`, 'the link\'s peek');
  const pk = await p.ev(PEEK);
  assert.equal(pk.type, 'Library item');
  assert.equal(pk.title, 'The pay flow in Figma');
  assert.deepEqual(pk.rows.map((r) => r[0]), ['ID', 'Kind', 'Where', 'For', 'Notes', 'How it changes'], 'a link\'s Kind, Where, For, Notes');
  const row = (k) => pk.rows.find((r) => r[0] === k);
  assert.match(row('Kind')[1], /Link/);
  assert.match(row('Kind')[1], /url/, 'the link\'s own kind');
  assert.match(row('Where')[1], /https:\/\/www\.figma\.com\/file\/pay-flow/);
  assert.deepEqual(row('For')[2], [`#goal/${ids.goal1}`]);
  assert.equal(row('Notes')[1], 'The screens the pay tickets build');
  assert.equal(row('How it changes')[1], 'Shift+click it and say so in a thread');
  // a local remote's ↗ opens this peek (T2): its Where is the remote and path
  await p.ev(`location.hash = ${JSON.stringify(`#lib/${encodeURIComponent(`link:${ids.linkPath}`)}`)}`);
  await soon(`${PEEK}.rows[0]?.[1] === ${JSON.stringify(`link:${ids.linkPath}`)}`, 'the path link\'s peek');
  const path_ = await p.ev(PEEK);
  assert.match(path_.rows.find((r) => r[0] === 'Where')[1], /docs\/devteam\/project\/designs\/pay\.md/);
  assert.deepEqual(path_.rows.find((r) => r[0] === 'For')[2], [`#feature/${ids.feat1}`]);
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a preview\'s peek: its state and who drew it', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, ids } = await libraryAll(t);
  const peekOn = async (id) => {
    await p.ev(`location.hash = ${JSON.stringify(`#lib/${encodeURIComponent(id)}`)}`);
    await soon(`${PEEK}.rows[0]?.[1] === ${JSON.stringify(id)}`, `${id}'s peek`);
    return Object.fromEntries((await p.ev(PEEK)).rows.map(([k, v, a]) => [k, { v, a }]));
  };
  const down = await peekOn(`preview:${ids.pvDown}`);
  assert.deepEqual(Object.keys(down), ['ID', 'Kind', 'Drawn by', 'State', 'Updated', 'How it changes']);
  assert.match(down.State.v, /^not answering down since .+/, 'State: the card\'s words, and since when');
  assert.deepEqual(down['Drawn by'].a, [`#planner/${ids.feat1}`], 'Drawn by: the planner\'s session');
  const live = await peekOn(`preview:${ids.pvLive}`);
  assert.equal(live.State.v, 'live');
  assert.deepEqual(live['Drawn by'].a, [`#ticket/${ids.tBuilding}`], 'Drawn by: the ticket\'s session');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a lib peek asks the server for no peek', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, ids } = await libraryAll(t, { init: `${READS_INIT}\n${PEEK_REQS_INIT}` });
  for (const id of [`artifact:${ids.drafted}`, `link:${ids.linkUrl}`, 'artifact:no-such-thing']) {
    await p.ev(`location.hash = ${JSON.stringify(`#lib/${encodeURIComponent(id)}`)}`);
    await soon(`document.querySelector('#drawer-bar-title .dtitle')?.textContent.length > 0 && (${PEEK}.rows[0]?.[1] === ${JSON.stringify(id)})`, `${id}'s peek`);
    // through three refreshes (each one asks again for the open object's peek, unless it is missing)
    const n = await p.ev('window.__dataReads');
    await soon(`window.__dataReads >= ${n + 3}`, 'three refreshes');
  }
  assert.deepEqual(await p.ev('window.__peekReqs'), [], 'no /api/peek request');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('the peek\'s frame is one of the 12', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon } = await libraryAll(t, { fx: libraryFixture({ artifacts: 60 }), height: 3000 });
  await soon(`${VIEW}.frames === 12`, 'twelve frames');
  await sleep(1000);
  const before = await p.ev(VIEW);
  const framed = before.holding.map((h) => h.id).find((id) => id.startsWith('artifact:'));
  assert.ok(framed, 'a framed artifact');
  // the grid frame farthest from the viewport's centre is the one that makes room (any of those tied for farthest)
  const farthest = await p.ev(`(() => { const d = (b) => { const r = b.getBoundingClientRect(); return Math.hypot((r.left + r.right - innerWidth) / 2, (r.top + r.bottom - innerHeight) / 2); };
    const xs = [...document.querySelectorAll('#lib-grid .lib-thumb')].filter((b) => b.querySelector('iframe')), m = Math.max(...xs.map(d));
    return xs.filter((b) => d(b) > m - 0.5).map((b) => b.closest('.lib-card').dataset.libId); })()`);
  const all = "document.querySelectorAll('.lib-thumb iframe').length";
  const inPeek = "document.querySelectorAll('#drawer-body .lib-thumb iframe').length";
  await p.ev(`location.hash = ${JSON.stringify(`#lib/${encodeURIComponent(framed)}`)}`);
  const box = "document.querySelector('#drawer-body .lib-thumb')";
  await soon(`!!${box}?.querySelector('iframe')`, 'the peek\'s box holds a frame');
  await sleep(1000);
  assert.equal(await p.ev(`${box}.dataset.thumb`), 'live');
  assert.equal(await p.ev(`${box}.querySelector('iframe').getAttribute('src') === ${box}.dataset.thumbSrc`), true);
  assert.deepEqual(await p.ev(`[${all}, ${inPeek}, ${VIEW}.frames]`), [12, 1, 11], '12 in all: 1 in the peek, 11 in the grid');
  const open = await p.ev(VIEW);
  const gone = before.holding.map((h) => h.id).filter((id) => !open.holding.some((h) => h.id === id));
  assert.equal(gone.length, 1, 'one grid frame made room');
  assert.ok(farthest.includes(gone[0]), `the grid frame farthest from the centre made room (${gone[0]}; farthest: ${farthest.join(', ')})`);
  // closed: its slot goes back to the grid
  await p.key('Escape');
  await soon("document.getElementById('drawer').hidden", 'the peek closed');
  await soon(`${VIEW}.frames === 12 && ${inPeek} === 0`, 'the grid back to 12');
  await sleep(1000);
  assert.deepEqual(await p.ev(`[${all}, ${VIEW}.frames]`), [12, 12]);
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a cold link opens over the Library', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go, ids } = await libraryAll(t);
  await go(`#lib/${encodeURIComponent(`artifact:${ids.drafted}`)}`);
  await soon(`!document.getElementById('drawer').hidden && ${PEEK}.rows[0]?.[1] === ${JSON.stringify(`artifact:${ids.drafted}`)}`, 'the peek on a cold load');
  assert.equal(await p.ev('history.state.page'), '#library', 'over the Library');
  assert.equal(await p.ev("document.getElementById('library').classList.contains('on')"), true, 'the Library under it');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('the viewer bar: its sizes and order', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go } = await versOn(t);
  await go(`#artifact/main/${VERS}`);
  await soon(`${frameIs(`/artifact/main/${VERS}/`)} && document.getElementById('av-title').textContent === ${JSON.stringify(VERS_TITLE)} && ${shown('av-pub')}`, 'the landed version in the viewer, with its tile');
  const m = await p.ev(`(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(), bar = r('.av-bar');
    return { bar: bar.height, ver: r('#av-ver').height, badge: r('#av-kind').height, kind: document.getElementById('av-kind').matches('span.badge'), icon: !!document.querySelector('.av-bar > i.av-kind.icon-layout-dashboard:first-child'),
      pills: ['#av-reload', '#av-pub', '#av-tab', '#av-close'].map((s) => ({ s, h: r(s).height, x: r(s).left })), edge: bar.right - r('#av-close').right, title: r('#av-title').right, ver2: r('#av-ver').left }; })()`);
  assert.equal(m.bar, 41, '.av-bar is --head-h tall');
  assert.equal(m.kind, true, 'the kind badge');
  assert.equal(m.icon, true, 'the kind\'s icon first');
  assert.equal(m.ver, m.badge, '#av-ver is a badge\'s height');
  for (const x of m.pills) assert.equal(x.h, 20, `${x.s} is 20 tall`);
  assert.deepEqual([...m.pills].sort((a, b) => a.x - b.x).map((x) => x.s), ['#av-reload', '#av-pub', '#av-tab', '#av-close'], 'Reload, the tile, open in a tab, close');
  assert.ok(m.edge >= 0 && m.edge <= 16, `close at the bar's right (${m.edge}px in)`);
  assert.ok(m.ver2 >= m.title, 'the pill after the title');
  // off a box: the recorded state, disabled, saying why
  assert.deepEqual(await p.ev("(() => { const b = document.getElementById('av-pub'); return [b.tagName, b.disabled, b.textContent.trim(), /cloud box/.test(b.title)]; })()"), ['BUTTON', true, 'Not public', true]);
  // open in a tab and close: one hover rule
  await p.send('DOM.enable');
  await p.send('CSS.enable');
  const { root } = await p.send('DOM.getDocument', { depth: 0 });
  const hover = async (sel) => {
    const { nodeId } = await p.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
    await p.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
    // a button's background has a .12s transition
    await sleep(400);
    return p.ev(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).backgroundColor`);
  };
  const [tab, close] = [await hover('#av-tab'), await hover('#av-close')];
  assert.equal(tab, close, 'the same background under :hover');
  assert.notEqual(tab, 'rgba(0, 0, 0, 0)', 'a hover background');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('the version pill: the versions, an earlier one read-only, Escape closes only the list', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go, made } = await versOn(t);
  const [, , mid, oldest] = made.versions;
  await go('#library');
  await soon(`!!document.querySelector(${JSON.stringify(cardTitle(VERS))})`, 'the card');
  await p.click(cardTitle(VERS));
  await soon(frameIs(`/artifact/wt/${VERS_WT}/${VERS}/`), 'the draft in the viewer');
  assert.equal(await p.ev("document.getElementById('av-where').textContent"), `Draft · live in ${VERS_WT}`);
  assert.equal(await p.ev("getComputedStyle(document.getElementById('av-ver')).color"), await tokenColor(p, '--amber-fg'), 'amber');
  assert.equal(await p.ev("document.querySelector('#av-ver > #av-where') !== null && document.getElementById('av-ver').matches('button.badge.ver-pill')"), true);
  assert.equal(await p.ev("document.getElementById('av-vers').getAttribute('role')"), 'listbox');
  assert.equal(await p.ev(LIST_OPEN), false, 'the list closed at first');
  await p.click('#av-ver');
  await soon(`${LIST_OPEN} && ${OPTS}.length === 4`, 'the versions listed');
  const opts = await p.ev(OPTS);
  assert.deepEqual(opts.map((o) => o.at), [VERS_WT, 'main', mid.at, oldest.at], 'drafts, landed, earlier');
  const day = await p.ev(`new Date(${JSON.stringify(made.versions[0].time)}).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })`);
  assert.equal(opts[0].text, `Draft · live in ${VERS_WT} · ${day}`);
  assert.match(opts[1].text, /^Landed on main · \S/);
  assert.ok(opts[3].text.endsWith(` · ${oldest.commit.slice(0, 7)}`), `an earlier one by its date and short commit: ${opts[3].text}`);
  // the oldest: read-only
  await p.click(`#av-vers [data-at="${oldest.at}"]`);
  await soon(frameIs(`/artifact/tree/${oldest.tree}/${VERS}/`), 'the oldest in the frame');
  const ro = { title: VERS_TITLE, where: opts[3].text, note: `Showing ${opts[3].text}, read-only`, reload: false, pub: false, list: false };
  assert.deepEqual(await p.ev(BAR), ro, 'read-only: the note, no Reload, no tile');
  await polls(p, soon);
  assert.deepEqual(await p.ev(BAR), ro, 'two polls on, the title is still the artifact\'s');
  // the landed one: Reload again
  await p.click('#av-ver');
  await soon(`${LIST_OPEN} && ${OPTS}.length === 4`, 'the list again');
  await p.click('#av-vers [data-at="main"]');
  await soon(frameIs(`/artifact/main/${VERS}/`), 'main\'s in the frame');
  const b = await p.ev(BAR);
  assert.deepEqual([b.title, b.note, b.reload, b.pub, b.list], [VERS_TITLE, null, true, true, false], 'Reload and the tile back, no note');
  assert.equal(b.where, opts[1].text, 'Landed on main, with its date');
  assert.equal(await p.ev('window.__versReads'), 1, 'the versions read once per open');
  // Escape with the list open closes the list, never the viewer
  await p.click('#av-ver');
  await soon(LIST_OPEN, 'the list open');
  await p.key('Escape');
  await soon(`!${LIST_OPEN}`, 'Escape closed the list');
  await sleep(500);
  assert.equal(await p.ev(VIEWING), true, 'the viewer stays');
  // a click outside closes it too
  await p.click('#av-ver');
  await soon(LIST_OPEN, 'the list open');
  await p.click('#av-title');
  await soon(`!${LIST_OPEN}`, 'a click outside closed the list');
  assert.equal(await p.ev(VIEWING), true);
  // a versions read that fails says so
  await p.click('#av-close');
  await soon(`!${VIEWING}`, 'closed');
  await p.ev('window.__versFail = true');
  await p.click(cardTitle(VERS));
  await soon(frameIs(`/artifact/wt/${VERS_WT}/${VERS}/`), 'the draft again');
  await p.click('#av-ver');
  await soon(`${LIST_OPEN} && document.getElementById('av-vers').textContent.includes('Versions could not be read')`, 'the failure said');
  assert.equal(await p.ev('window.__versReads'), 2, 'a new open reads them again');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a list open when the viewer closes holds no Escape', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go } = await versOn(t);
  await go('#library');
  await soon(`!!document.querySelector(${JSON.stringify(cardTitle(VERS))})`, 'the card');
  await p.click(cardTitle(VERS));
  await soon(frameIs(`/artifact/wt/${VERS_WT}/${VERS}/`), 'the draft in the viewer');
  await p.click('#av-ver');
  await soon(`${LIST_OPEN} && ${OPTS}.length === 4`, 'the list open');
  await backTo(p, soon, await p.ev('location.hash'), '#library', 'the viewer closed by Back', `!${VIEWING} && location.hash.startsWith('#library')`);
  assert.equal(await p.ev(LIST_OPEN), false, 'the list closed with it');
  // the page's own Escape listeners hear the next Escape
  await p.ev("window.__esc = 0; document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__esc++; }); document.activeElement?.blur?.(); true");
  await p.key('Escape');
  await soon('window.__esc === 1', 'the page heard Escape');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a viewer tab guesses no kind', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, at } = await versOn(t);
  await p.send('Page.navigate', { url: `${at}/view/artifact/${VERS}` });
  await soonIn(p, 30000)("document.documentElement.classList.contains('viewer') && typeof TS === 'object' && TS.kind === 'artifact' && TS.ready", 'the viewer tab, its lens ready');
  assert.deepEqual(await p.ev(`[${shown('av-kind')}, document.getElementById('av-where').textContent]`), [false, 'Landed on main'], 'no kind badge: a viewer tab has no Library row to read it from');
});

test('a tree opened by a link is the published version', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go, made } = await versOn(t);
  const mid = made.versions[2];
  await go('#library');
  await p.ev(`showArtifact(${JSON.stringify(VERS)}, ${JSON.stringify(mid.at)})`);
  await soon(frameIs(`/artifact/tree/${mid.tree}/${VERS}/`), 'the tree in the frame');
  const b = await p.ev(BAR);
  assert.deepEqual([b.where, b.note, b.reload], ['the published version', null, true], 'no read-only note: read-only is the picked state');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

// On main: a newer version loads by itself, as a draft's does (kit-106), and the pill is never
// outlined (kit-750, ruling A1, which supersedes kit-206's outline for main).
test('Reload: main loads a newer version by itself, and the pill is never outlined', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go, made } = await versOn(t);
  await go(`#artifact/main/${VERS}`);
  await soon(`${frameIs(`/artifact/main/${VERS}/`)} && /^[0-9a-f]{64}$/.test(TS.fp ?? '')`, "main's version in the viewer, with its fingerprint");
  const button = () => p.ev("(() => { const b = document.getElementById('av-reload'), s = getComputedStyle(b); return { stale: b.classList.contains('stale'), style: s.outlineStyle, h: b.getBoundingClientRect().height }; })()");
  assert.equal((await button()).stale, false, 'nothing newer at open');
  const fp0 = await p.ev('TS.fp');
  // the frame as loaded now, marked by a property (avFreshFrame's clone copies attributes, not that):
  // a reload puts a fresh frame in its place; and
  // whether the pill was ever outlined from here on
  await p.ev("(() => { document.getElementById('av-frame').__before = true; window.__wasStale = false; const b = document.getElementById('av-reload'); new MutationObserver(() => { if (b.classList.contains('stale')) window.__wasStale = true; }).observe(b, { attributes: true }); return true; })()");
  // main changes as versProject made it: a fourth commit (pushed too where the project has an origin, which mainRef reads first)
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: made.root, encoding: 'utf8' }).trim();
  const dir = path.join(made.root, 'docs/devteam/project/artifacts', VERS);
  putFiles(dir, versFiles(4));
  git('add', '-A', dir);
  git('commit', '-qm', `${VERS} v4`);
  if (git('remote').split('\n').includes('origin')) git('push', '-q', 'origin', 'HEAD:main');
  await soonIn(p, 60000)(`(() => { const f = document.getElementById('av-frame'); return !!f && !f.__before && ${frameIs(`/artifact/main/${VERS}/`)} && TS.fp !== ${JSON.stringify(fp0)} && TS.fp === TS.fpNow; })()`, 'the frame loaded again by itself once a newer fingerprint is seen');
  const b = await button();
  assert.deepEqual([b.stale, b.style, b.h], [false, 'none', 20], 'no outline, on the 20px pill');
  assert.equal(await p.ev('window.__wasStale'), false, 'the pill was never outlined');
  assert.equal(await p.ev("getComputedStyle(document.getElementById('av-reload')).borderTopWidth"), '1px', 'the pill\'s border width');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('the Public tile (box)', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go, made, port, box: header } = await versOn(t, { box: (m, port) => ({ kit92: { root: m.root, port, artifacts: {} } }) });
  const [, landed, mid] = made.versions;
  const publish = `http://box.localhost:${port}/public/publish?port=4321&slug=${VERS}`;
  const unpublish = `http://box.localhost:${port}/public/unpublish?port=4321&project=kit92&slug=${VERS}`;
  const rec = (tree) => ({ tree, at: new Date(Date.now() - 3600e3).toISOString(), channel: 'dashboard' });
  const TILE = `(() => { const e = document.getElementById('av-pub'); if (!e || !e.getClientRects().length) return null;
    return { tag: e.tagName, text: e.textContent.trim(), href: e.getAttribute('href'), target: e.getAttribute('target'), disabled: !!e.disabled, h: e.getBoundingClientRect().height }; })()`;
  const tileColor = "getComputedStyle(document.getElementById('av-pub')).color";
  await go(`#artifact/main/${VERS}`);
  await soon(`${frameIs(`/artifact/main/${VERS}/`)} && ${shown('av-pub')}`, 'the landed version, with its tile');
  const set = async (served, published) => { header.kit92.artifacts = served; await p.ev(`window.__fx.published = ${JSON.stringify(published)}`); };
  const link = (text, href) => ({ tag: 'A', text, href, target: '_blank', disabled: false, h: 20 });
  // public, nothing to update: Public (green), the unpublish page
  await set({ [VERS]: landed.tree }, rec(landed.tree));
  await soon(`JSON.stringify(${TILE}) === ${JSON.stringify(JSON.stringify(link('Public', unpublish)))}`, 'public');
  assert.equal(await p.ev(tileColor), await tokenColor(p, '--green-fg'), 'green');
  assert.equal(await p.ev("!!document.querySelector('#av-pub i.icon-globe')"), true, 'with a globe');
  // public, main moved on: the update menu
  await set({ [VERS]: mid.tree }, rec(landed.tree));
  await soon(`${TILE}?.text === 'Public · update available'`, 'public with an update');
  assert.deepEqual(await p.ev(TILE), { tag: 'BUTTON', text: 'Public · update available', href: null, target: null, disabled: false, h: 20 });
  assert.equal(await p.ev(tileColor), await tokenColor(p, '--amber-fg'), 'amber');
  assert.equal(await p.ev(shown('av-pub-menu')), false, 'its menu closed');
  await p.click('#av-pub');
  await soon(shown('av-pub-menu'), 'its menu');
  const entries = "[...document.querySelectorAll('#av-pub-menu a')].map((a) => [a.textContent.trim(), a.getAttribute('href'), a.target])";
  assert.deepEqual(await p.ev(entries), [['Update to main\'s version', publish, '_blank'], ['Unpublish', unpublish, '_blank']]);
  await polls(p, soon);
  assert.equal(await p.ev(shown('av-pub-menu')), true, 'a poll leaves the open menu');
  await p.click('#av-title');
  await soon(`!${shown('av-pub-menu')}`, 'a click outside closes it');
  // recorded but not served: Not public (amber), the publish page
  await set({}, rec(landed.tree));
  await soon(`JSON.stringify(${TILE}) === ${JSON.stringify(JSON.stringify(link('Not public', publish)))}`, 'not live');
  assert.equal(await p.ev(tileColor), await tokenColor(p, '--amber-fg'), 'amber');
  // never published: Not public, the publish page
  await set({}, null);
  await soon(`JSON.stringify(${TILE}) === ${JSON.stringify(JSON.stringify(link('Not public', publish)))} && ${tileColor} !== ${JSON.stringify(await tokenColor(p, '--amber-fg'))}`, 'none');
  // a draft has none
  await go(`#artifact/wt/${VERS_WT}/${VERS}`);
  await soon(`${frameIs(`/artifact/wt/${VERS_WT}/${VERS}/`)} && document.getElementById('av-title').textContent === ${JSON.stringify(VERS_TITLE)}`, 'the draft');
  await polls(p, soon);
  assert.equal(await p.ev(TILE), null, 'no tile on a draft');
  assert.deepEqual(await p.ev(ERRORS), []);
});

test('a preview\'s Start and Stop', { ...CHROME, timeout: 300000 }, async (t) => {
  const { patch, ids } = libraryFixture();
  const { p, soon, go } = await libraryOn(t, { init: `${libraryMergeInit({ previews: patch.library.previews })}\n${READS_INIT}\n${START_INIT}` });
  const RUN = `(() => { const g = (id) => document.getElementById(id), r = (id) => g(id).getBoundingClientRect();
    return { run: [...g('av-run').querySelectorAll('button')].map((b) => b.textContent.trim()), pub: ${shown('av-pub')}, ver: g('av-ver').disabled, plain: g('av-ver').classList.contains('plain'),
      order: r('av-reload').right <= r('av-run').left && r('av-run').right <= r('av-tab').left && r('av-tab').right <= r('av-close').left }; })()`;
  for (const [name, run] of [[ids.pvNotRunning, ['Start', 'Stop']], [ids.pvLive, ['Stop']], [ids.pvChecking, ['Stop']], [ids.pvDown, ['Stop']], [ids.pvExpired, ['Stop']]]) {
    await go(`#preview/${name}`);
    await soon(`${VIEWING} && document.querySelectorAll('#av-run button').length > 0`, `${name}'s bar`);
    assert.deepEqual(await p.ev(RUN), { run, pub: false, ver: true, plain: true, order: true }, `${name}: its buttons, after Reload and before open in a tab and close; no tile; the pill plain`);
  }
  const name = ids.pvNotRunning;
  const start = `#av-run [data-preview-start="${name}"]`;
  await go(`#preview/${name}`);
  await soon(`document.querySelectorAll('#av-run button').length === 2`, 'Start and Stop');
  // refused: the error beside the buttons, the page's only element with that id, kept through polls
  // a press within a second of its coming up is refused with its words (kit-145); once it has settled, the same press goes
  const live = `(() => { const b = document.querySelector('${start}'); return !!b && performance.now() - avStep.press.last <= 250 && [...avStep.press.seen.values()].some((r) => r.el === b && avStep.settled(r)); })()`;
  assert.equal(await p.ev('window.__starts ?? 0'), 0, 'nothing sent yet');
  // (begun again as the press's own move arrives, so a slow box can't let the second go by in between)
  await p.ev(`(window.addEventListener('mousemove', () => avStep.press.seen.clear(), { capture: true, once: true }), true)`);
  await p.click(start);
  await soon(`document.getElementById('av-held')?.textContent === 'That moved just now. Press again in a second.' && !document.getElementById('av-held').hidden`, 'the press refused, with its words');
  assert.equal(await p.ev('window.__starts ?? 0'), 0, 'refused: nothing sent');
  await soon(live, 'Start is live');
  await p.click(start);
  await soon(`document.getElementById('e-preview-${name}')?.textContent === 'Not saved: no'`, 'the refusal in the bar');
  assert.deepEqual(await p.ev(`[document.querySelectorAll('[id="e-preview-${name}"]').length, !!document.getElementById('e-preview-${name}').closest('.av-bar'), !!document.getElementById('e-preview-${name}').closest('#av-run')]`), [1, true, false]);
  await polls(p, soon);
  assert.equal(await p.ev(`document.getElementById('e-preview-${name}').textContent`), 'Not saved: no', 'a poll leaves it');
  assert.deepEqual((await p.ev(RUN)).run, ['Start', 'Stop'], 'Start back as it was');
  // closed and opened again: the span is emptied (written once per opening, never by a poll)
  await p.click('#av-close');
  await soon(`!${VIEWING}`, 'closed');
  await p.ev(`location.hash = '#preview/${name}'`);
  await soon(`${VIEWING} && document.querySelectorAll('#av-run button').length === 2`, 'the same preview again');
  assert.deepEqual(await p.ev(`[document.querySelectorAll('[id="e-preview-${name}"]').length, document.getElementById('e-preview-${name}').textContent]`), [1, ''], 'its error span empty on the new opening');
  // taken: once the preview reads live, Stop alone, within two polls, the viewer still open
  await p.ev('window.__start = 200');
  await soon(live, 'Start is live again');
  await p.click(start);
  await soon('window.__starts === 2', 'the second Start sent');
  await p.ev(`window.__fx.previews.find((x) => x.name === ${JSON.stringify(name)}).up = true`);
  await polls(p, soon);
  assert.deepEqual((await p.ev(RUN)).run, ['Stop'], 'Stop alone, never Starting…');
  assert.equal(await p.ev(VIEWING), true, 'the viewer stays open');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

// Last in the file (kit-925): every test before this one ran in the file's one Chrome and left none of its
// tabs open; and an origin an earlier page used starts with nothing in its storage. Run alone (a name
// pattern), no test ran before it, and the first two hold trivially.
test('one Chrome for the file: no tab left behind, and an origin used before starts empty (kit-925)', { ...CHROME, timeout: 300000 }, oneChrome);
