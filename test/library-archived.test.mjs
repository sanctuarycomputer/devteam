// The Library hides archived items (kit-936): an archived landed artifact (/api/data's library.artifacts[i].archived,
// kit-934) leaves the grid; the Kind filter's Archived (kind=archived) shows only archived items, each badged,
// still narrowed by Goal; one with a draft of its own still shows as its draft card; a goal's or feature's peek
// still lists them, badged. The library-items and peek-artifacts blocks run alone in vm over libraryFixture()'s
// /api/data parts with archived set on some rows; then the page in real headless Chrome over a real dashboard
// on a bare project whose /api/data is patched in the page (skipped where Chrome can't run).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { dataPatchInit, libraryFixture } from './lib/kit.mjs';
import './lib/chrome.mjs';
import { INDEX, block, itemsOf, FILE, libraryOn, CHROME, ctl, pick, HEAD, IDS, idsAre, card } from './lib/dashboard-library-fixture.mjs';

// the file's one Chrome closes when the file ends
after(() => FILE.chrome?.close());

const NOW = Date.parse('2026-11-19T12:00:00Z');
const plain = (x) => JSON.parse(JSON.stringify(x));
const ARCH = (goal) => ({ at: '2026-11-19T10:00:00.000Z', by: 'supervisor', goal });

// libraryFixture() with three landed rows archived: pay-guide (docs, for goal1's feature), receipt-flow
// (diagram, goal2) and refund-screen (landed, with two drafts of its own)
function archivedFixture() {
  const fx = libraryFixture({ now: NOW });
  const { ids } = fx;
  const marks = { [ids.docs]: ids.goal1, [ids.diagram]: ids.goal2, [ids.drafted]: ids.goal1 };
  for (const a of fx.patch.library.artifacts) if (a.at === 'main' && a.slug in marks) a.archived = ARCH(marks[a.slug]);
  assert.equal(fx.patch.library.artifacts.filter((a) => a.archived).length, 3, 'three landed rows archived');
  assert.ok(fx.patch.library.artifacts.some((a) => a.slug === ids.drafted && a.at !== 'main'), 'refund-screen has a draft of its own');
  // the two the grid hides, in its kind order (diagram before docs)
  return { ...fx, arch: [`artifact:${ids.diagram}`, `artifact:${ids.docs}`] };
}

// the blocks alone in vm, with the page's helpers the peek-artifacts block calls stubbed
function loadBlocks() {
  const vctx = vm.createContext({ URL, URLSearchParams });
  const pre = `
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const psect = (title, html) => '<div class="card psect"><div class="card-head"><span class="grow">' + esc(title) + '</span></div><div class="psect-body">' + html + '</div></div>';
  `;
  vm.runInContext(`${pre}\n${block(INDEX, 'preview-cards')}\n${block(INDEX, 'library-items')}\n${block(INDEX, 'peek-artifacts')}
    this.LIB_KINDS = LIB_KINDS; this.libraryItems = libraryItems; this.libraryKeep = libraryKeep; this.peekArtifacts = peekArtifacts; this.peekArtSection = peekArtSection;
    this.ctx = { previewState, artHref: (s, at) => '#artifact/' + at + '/' + s, artViewer: (s, at) => '/view/artifact/' + s + '?at=' + at, pvViewer: (n) => '/view/preview/' + n, fileHref: (l) => '#file?path=' + l.path };`, vctx);
  return vctx;
}

test('library-items: Archived is a kind no item has; libraryKeep keeps an archived item only under it', () => {
  const { LIB_KINDS, libraryItems, libraryKeep, ctx } = loadBlocks();
  const { patch, ids, arch } = archivedFixture();
  assert.deepEqual(plain(LIB_KINDS).at(-1), ['archived', 'Archived', 'archive'], 'Archived last, the archive icon');
  const items = plain(libraryItems(patch, NOW, ctx));
  const byId = new Map(items.map((x) => [x.id, x]));
  assert.ok(!items.some((x) => x.kind === 'archived'), 'no item has the pseudo-kind');
  // archived: the landed row's, on an item with no draft; null on every other item
  assert.deepEqual(byId.get(arch[1]).archived, ARCH(ids.goal1), 'pay-guide: archived, as the row has it');
  assert.equal(byId.get(arch[1]).kind, 'docs', 'its own kind kept');
  assert.deepEqual(byId.get(arch[0]).archived, ARCH(ids.goal2), 'receipt-flow: archived');
  assert.equal(byId.get(`artifact:${ids.drafted}`).archived, null, 'refund-screen: a draft of its own, so not archived');
  assert.equal(byId.get(`artifact:${ids.drafted}`).at, ids.wt2, 'refund-screen shows its newest draft, as today');
  assert.deepEqual(items.filter((x) => x.archived).map((x) => x.id), arch, 'only those two');
  for (const x of items) if (!arch.includes(x.id)) assert.equal(x.archived, null, `${x.id}: archived null`);

  const keep = (f) => items.filter((x) => libraryKeep(x, f)).map((x) => x.id);
  const active = items.filter((x) => !arch.includes(x.id)).map((x) => x.id);
  assert.deepEqual(keep({}), active, 'no filter: every item but the archived');
  for (const [k] of LIB_KINDS.filter(([k]) => k !== 'archived')) {
    assert.deepEqual(keep({ kind: k }), items.filter((x) => x.kind === k && !x.archived).map((x) => x.id), `${k}: its unarchived items`);
    for (const id of arch) assert.equal(libraryKeep(byId.get(id), { kind: k }), false, `${k} leaves ${id} out`);
  }
  assert.ok(keep({ kind: 'docs' }).length < items.filter((x) => x.kind === 'docs').length, 'Docs left an archived one out');
  assert.deepEqual(keep({ kind: 'archived' }), arch, 'Archived: only the archived, of any kind');
  assert.deepEqual(keep({ kind: 'archived', goal: ids.goal1 }), [arch[1]], 'Archived and goal1: pay-guide');
  assert.deepEqual(keep({ kind: 'archived', goal: ids.goal2 }), [arch[0]], 'Archived and goal2: receipt-flow');
  assert.deepEqual(keep({ goal: ids.goal1 }), items.filter((x) => x.goals.includes(ids.goal1) && !x.archived).map((x) => x.id), 'goal1 alone: no archived');
  // a null or missing archived is not archived
  assert.equal(libraryKeep({ kind: 'mock', goals: [], archived: null }, { kind: 'archived' }), false);
  assert.equal(libraryKeep({ kind: 'mock', goals: [] }, { kind: 'archived' }), false, 'no field: not archived');
  assert.equal(libraryKeep({ kind: 'mock', goals: [] }, {}), true, 'no field: shown');
});

test('peek-artifacts: a goal\'s and a feature\'s peek list their archived artifacts, badged', () => {
  const { peekArtifacts, peekArtSection, ctx } = loadBlocks();
  const { patch, ids } = archivedFixture();
  for (const [ref, slug] of [[`goal:${ids.goal1}`, ids.docs], [`feature:${ids.feat1}`, ids.docs], [`goal:${ids.goal2}`, ids.diagram]]) {
    const listed = plain(peekArtifacts(patch, ref, ctx));
    assert.ok(listed.some((x) => x.id === `artifact:${slug}` && x.archived), `${ref}: lists ${slug}, archived`);
    const html = peekArtSection(peekArtifacts(patch, ref, ctx));
    const lis = [...html.matchAll(/<li>[^]*?<\/li>/g)].map((m) => m[0]);
    assert.equal(lis.length, listed.length, `${ref}: one line per artifact`);
    for (const [i, li] of lis.entries()) {
      const badged = /<span class="badge[^"]*">Archived<\/span>/.test(li);
      assert.equal(badged, !!listed[i].archived, `${ref}: ${listed[i].id} ${listed[i].archived ? 'badged' : 'not badged'}: ${li}`);
    }
  }
});

// the grid's cards that carry the Archived badge
const BADGED = "[...document.querySelectorAll('#lib-grid > .lib-card')].filter((c) => [...c.querySelectorAll('.card-head .badge')].some((b) => b.textContent.trim() === 'Archived')).map((c) => c.dataset.libId)";

test('the Library hides archived items; Kind Archived shows them badged, narrowed by Goal, and is remembered', { ...CHROME, timeout: 300000 }, async (t) => {
  const { patch, ids, arch } = archivedFixture();
  const { items, keep } = itemsOf(patch, NOW);
  // what the grid should show, by the fixture alone (not by the block under test): every item but the two archived
  const active = items.map((x) => x.id).filter((id) => !arch.includes(id));
  assert.equal(active.length, items.length - 2);
  const { p, soon, go } = await libraryOn(t, { init: dataPatchInit(patch) });
  await go('#library');
  await p.ev('localStorage.clear()');
  await go('#library');
  await soon(idsAre(active), 'every card but the archived');
  assert.deepEqual(await p.ev(BADGED), [], 'no Archived badge on the grid');
  // the drafted one still shows, as its draft card
  assert.equal(await p.ev(`${card(`artifact:${ids.drafted}`)}.querySelector('.card-head .badge.amber')?.textContent`), 'draft', 'refund-screen: its draft card');
  assert.equal(await p.ev("document.getElementById('n-library').textContent"), String(items.filter((x) => (x.art || x.preview) && !arch.includes(x.id)).length), 'the nav count leaves the archived out');
  // the Kind select gains Archived, last
  assert.deepEqual(await p.ev(`[...${ctl('kind')}.options].map((o) => [o.value, o.textContent])`), [['', 'All kinds'], ['mock', 'Mock'], ['diagram', 'Diagram'], ['docs', 'Docs'], ['review', 'Review page'], ['preview', 'Preview'], ['link', 'Link'], ['archived', 'Archived']]);
  await pick(p, 'kind', 'archived');
  await soon("location.hash === '#library?kind=archived'", 'kind=archived in the hash');
  await soon(idsAre(arch), 'only the archived cards');
  assert.deepEqual(await p.ev(BADGED), arch, 'each with the Archived badge');
  // still narrowed by Goal
  await pick(p, 'goal', ids.goal1);
  await soon(`location.hash.includes(${JSON.stringify(`goal=${ids.goal1}`)})`, 'the goal in the hash');
  assert.deepEqual(await p.ev(HEAD), { page: 'library', q: { kind: 'archived', goal: ids.goal1 } });
  await soon(idsAre(keep({ kind: 'archived', goal: ids.goal1 })), "goal1's archived");
  assert.deepEqual(keep({ kind: 'archived', goal: ids.goal1 }), [arch[1]]);
  await pick(p, 'goal', '');
  await soon("location.hash === '#library?kind=archived'", 'the goal cleared');
  // remembered like any kind: away and back on Library
  for (const page of ['board', 'overview']) {
    await p.click(`.side a[href="#${page}"]`);
    await soon(`PAGE_NOW === ${JSON.stringify(page)}`, page);
  }
  await p.click('.side a[href="#library"]');
  await soon("location.hash === '#library?kind=archived'", 'back on Library: Archived remembered');
  await soon(idsAre(arch), 'the archived cards again');
  // a URL with kind=archived, and one with an unknown kind (All kinds, as today: the archived hidden)
  await go('#library?kind=archived');
  await soon(idsAre(arch), 'kind=archived from the URL');
  assert.equal(await p.ev(`${ctl('kind')}.value`), 'archived', 'the select shows Archived');
  await go('#library?kind=zzz');
  await soon(idsAre(active), 'an unknown kind: every unarchived card');
  assert.equal(await p.ev(`${ctl('kind')}.value`), '', 'All kinds');
  assert.deepEqual(await p.ev(IDS + '.filter((id) => ' + JSON.stringify(arch) + '.includes(id))'), [], 'no archived card');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a goal\'s and a feature\'s peek list their archived artifacts, badged', { ...CHROME, timeout: 300000 }, async (t) => {
  const { patch, ids } = archivedFixture();
  const { p, soon, go } = await libraryOn(t, { init: dataPatchInit(patch) });
  const LINES = "[...document.querySelectorAll('#drawer [data-peek-arts] li')].map((li) => [li.querySelector('a').textContent.trim(), [...li.querySelectorAll('.badge')].some((b) => b.textContent.trim() === 'Archived')])";
  const title = (slug) => patch.library.artifacts.find((a) => a.slug === slug && a.at === 'main').title;
  for (const [hash, slug] of [[`#goal/${ids.goal1}`, ids.docs], [`#feature/${ids.feat1}`, ids.docs], [`#goal/${ids.goal2}`, ids.diagram]]) {
    await go(hash);
    await soon("!document.getElementById('drawer').hidden && !!document.querySelector('#drawer [data-peek-arts]')", `${hash}: the peek's artifacts`);
    const lines = await p.ev(LINES);
    assert.ok(lines.some(([t, b]) => t === title(slug) && b), `${hash}: ${slug} listed with the Archived badge: ${JSON.stringify(lines)}`);
    assert.ok(lines.filter(([, b]) => b).every(([t]) => [title(ids.docs), title(ids.diagram)].includes(t)), `${hash}: only archived ones badged: ${JSON.stringify(lines)}`);
  }
  assert.deepEqual(await p.ev('window.__errors'), []);
});
