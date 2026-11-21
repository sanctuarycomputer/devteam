// The canvas editor's tools (kit-669, docs/devteam/dashboard/canvas.html): pages added, renamed,
// reordered and deleted, multi-select, resize handles, and copy and paste, in headless Chrome against
// the kit-651 fake (test/lib/canvas-fake.mjs), which serves the page through its `serve` option. The
// harness is kit-668's (test/canvas-sync.test.mjs), copied: the recorder watches the page on a second
// DevTools connection of its own: its requests (Fetch), its dialogs and exceptions, and its WebSocket
// frames (Network), each parsed, both ways.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { canDrive } from './lib/chrome.mjs';
import { DOM_GONE, EVERY, EVERY_IMAGES, MINIMAL, PLACED, accepted, ackOf, afterWelcome, allSaved, ana, arrow, blurAll, body, byProp, count, docVariant, drag, dragPath, edits, enter, hasRev, holdDocs, kept, live, marquee, mouse, nameSet, nextEdit, noDialogs, noExceptions, onlyXY, open, pageLink, pagePt, rectsCanvas, refusedFrames, rename, rowButton, rowName, selectRow, selectedRows, selectsTimed, sendsNothing, shiftClick, showPageLink, shownPage, slowDrag, text, toastSays, undoKey, waitOps, waitRows, waitSelect, waitSeq, welcomeCount, within, zoomNow } from './lib/canvas-fixture.mjs';

// A double-click in the middle of what `sel` finds: two presses and releases, the second clickCount 2.
async function dblclick(p, sel) {
  const at = await p.at(sel);
  await p.move(at.x, at.y);
  await mouse(p, 'mousePressed', at.x, at.y);
  await mouse(p, 'mouseReleased', at.x, at.y);
  await mouse(p, 'mousePressed', at.x, at.y, { clickCount: 2 });
  await mouse(p, 'mouseReleased', at.x, at.y, { clickCount: 2 });
}
// The fixtures built here (spec's Acceptance checks). NOBUY: `every` with `buy` removed from `nodes`
// and from `actions`'s children, so Parts' `button` has no instance.
const NOBUY = docVariant(EVERY, (d) => {
  delete d.nodes.buy;
  d.nodes.actions.children = d.nodes.actions.children.filter((c) => c !== 'buy');
});
// ---- P: pages ----

const PAGE_SAY = {
  max: 'A canvas has at most 100 pages.',
  last: "A canvas needs at least one page, so this one wasn't deleted.",
  used: 'A component on this page is used on another page. Delete those instances first.',
};
const pageNames = (p) => p.ev("[...document.querySelectorAll('#pages a[data-page]')].map((a) => a.textContent)");
const pageIds = (p) => p.ev("[...document.querySelectorAll('#pages a[data-page]')].map((a) => a.dataset.page)");
const disabled = (p, sel) => p.ev(`document.querySelector(${JSON.stringify(sel)})?.disabled ?? null`);
const focusedAction = (p) => p.ev("(() => { const e = document.activeElement; return e instanceof Element ? (e.dataset.action ?? e.localName) : null; })()");

test('P1.1–P1.4 add, rename, reorder and reload', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);

  // P1.1: add
  assert.equal(await p.ev("(() => { const b = document.getElementById('pageAdd'); return !!b && !b.hidden && b.getAttribute('aria-label') === 'Add page'; })()"), true, 'the Add page button shown');
  let n0 = edits(rec).length;
  await p.click('#pageAdd');
  const add = await nextEdit(rec, n0);
  const id = add.ops[0]?.node?.id;
  assert.match(String(id), /^[0-9a-z]{6}-\d+$/, "the new page's id");
  assert.deepEqual(add.ops, [{ op: 'add', node: { id, type: 'page', parent: null, name: 'Page 3' }, after: 'p-parts' }], 'one add of a page');
  await accepted(rec, n0);
  assert.equal(edits(rec).length, n0 + 1, 'one edit frame');
  await within(async () => (await shownPage(p)) === id && (await p.ev('location.hash')) === `#page=${id}`, 'the new page shown', async () => `${await shownPage(p)} ${await p.ev('location.hash')}`);
  assert.deepEqual(await pageIds(p), ['p-main', 'p-parts', id], 'listed last');

  // P1.2: rename by the button, Enter
  await within(async () => (await count(p, rowButton('page-rename'))) === 1, "the shown page's Rename button");
  assert.equal(await p.ev(`document.querySelector(${JSON.stringify(rowButton('page-rename'))}).getAttribute('aria-label')`), 'Rename page');
  await p.click(rowButton('page-rename'));
  await within(async () => (await focusedAction(p)) === 'page-name', 'the name input focused', async () => focusedAction(p));
  assert.equal(await p.ev("document.activeElement.getAttribute('aria-label')"), 'Page name');
  // 201 code points (402 UTF-16 units) send nothing; 200 are sent
  n0 = edits(rec).length;
  await p.send('Input.insertText', { text: '😀'.repeat(201) });
  await enter(p);
  await sendsNothing(rec, n0, 'a name of 201 code points', 500);
  await within(async () => (await text(p, pageLink(id))) === 'Page 3', 'the link reads Page 3', async () => text(p, pageLink(id)));
  await p.click(rowButton('page-rename'));
  await within(async () => (await focusedAction(p)) === 'page-name', 'the name input focused', async () => focusedAction(p));
  await p.send('Input.insertText', { text: '😀'.repeat(200) });
  await enter(p);
  const emo = await nextEdit(rec, n0);
  assert.deepEqual(emo.ops, [{ op: 'set', id, prop: 'name', value: '😀'.repeat(200) }], 'a name of 200 code points sent');
  await accepted(rec, n0);
  // Rename, typed, Enter
  await p.click(rowButton('page-rename'));
  await within(async () => (await focusedAction(p)) === 'page-name', 'the name input focused', async () => focusedAction(p));
  n0 = edits(rec).length;
  await p.type('Draft');
  await enter(p);
  const ren = await nextEdit(rec, n0);
  assert.deepEqual(ren.ops, [{ op: 'set', id, prop: 'name', value: 'Draft' }], 'one set of the name');
  await accepted(rec, n0);
  await within(async () => (await text(p, pageLink(id))) === 'Draft', 'the link reads Draft', async () => text(p, pageLink(id)));
  // Rename, typed, then another page's link clicked: the name sent, that page shown
  await p.click(rowButton('page-rename'));
  await within(async () => (await focusedAction(p)) === 'page-name', 'the name input focused', async () => focusedAction(p));
  n0 = edits(rec).length;
  await p.type('Settings');
  await p.click(pageLink('p-main'));
  const ren2 = await nextEdit(rec, n0);
  assert.deepEqual(ren2.ops, [{ op: 'set', id, prop: 'name', value: 'Settings' }], 'the name sent on leaving');
  await accepted(rec, n0);
  await within(async () => (await shownPage(p)) === 'p-main' && (await p.ev('location.hash')) === '#page=p-main', 'Checkout shown by the click', async () => `${await shownPage(p)} ${await p.ev('location.hash')}`);
  await within(async () => (await text(p, pageLink(id))) === 'Settings', 'the link reads Settings', async () => text(p, pageLink(id)));
  // a double-click on Checkout's link, typed over, Escape: nothing sent, the link back
  n0 = edits(rec).length;
  await dblclick(p, pageLink('p-main'));
  await within(async () => (await focusedAction(p)) === 'page-name', "Checkout's name input focused", async () => focusedAction(p));
  assert.equal(await p.ev('document.activeElement.value'), 'Checkout', 'the input holds the name');
  assert.equal(await p.ev('location.hash'), '#page=p-main', 'Checkout shown');
  await p.type('Cart');
  await p.key('Escape');
  await sendsNothing(rec, n0, 'Escape in the name input', 500);
  await within(async () => (await text(p, pageLink('p-main'))) === 'Checkout', 'the link reads Checkout', async () => text(p, pageLink('p-main')));
  // a control character: nothing sent
  await within(async () => (await shownPage(p)) === 'p-main', 'Checkout shown', async () => shownPage(p));
  await p.click(rowButton('page-rename'));
  await within(async () => (await focusedAction(p)) === 'page-name', 'the name input focused again', async () => focusedAction(p));
  await p.send('Input.insertText', { text: 'Bell\u0007' });
  assert.equal(await p.ev('document.activeElement.value'), 'Bell\u0007', 'the control character typed');
  await enter(p);
  await sendsNothing(rec, n0, 'a name with a control character', 500);
  await within(async () => (await text(p, pageLink('p-main'))) === 'Checkout', 'the link reads Checkout', async () => text(p, pageLink('p-main')));

  // P1.3: reorder
  await showPageLink(p, id);
  assert.equal(await disabled(p, rowButton('page-down')), true, 'Move down disabled on the last page');
  assert.equal(await p.ev(`document.querySelector(${JSON.stringify(rowButton('page-up'))}).getAttribute('aria-label')`), 'Move page up');
  n0 = edits(rec).length;
  await p.click(rowButton('page-up'));
  const up = await nextEdit(rec, n0);
  assert.deepEqual(up.ops, [{ op: 'move', id, parent: null, after: 'p-main' }], 'one move up');
  await accepted(rec, n0);
  await within(async () => JSON.stringify(await pageNames(p)) === JSON.stringify(['Checkout', 'Settings', 'Parts']), 'Checkout, Settings, Parts', async () => JSON.stringify(await pageNames(p)));
  assert.equal(await shownPage(p), id, 'Settings still shown');
  assert.equal(await focusedAction(p), 'page-up', 'focus stays on Move up (still enabled)');
  await showPageLink(p, 'p-main');
  assert.equal(await disabled(p, rowButton('page-up')), true, 'Move up disabled on the first page');
  n0 = edits(rec).length;
  await p.click(rowButton('page-down'));
  const down = await nextEdit(rec, n0);
  assert.deepEqual(down.ops, [{ op: 'move', id: 'p-main', parent: null, after: id }], "one move down, after Settings's id");
  await accepted(rec, n0);
  await within(async () => JSON.stringify(await pageNames(p)) === JSON.stringify(['Settings', 'Checkout', 'Parts']), 'Settings, Checkout, Parts', async () => JSON.stringify(await pageNames(p)));
  assert.equal(await focusedAction(p), 'page-down', 'focus stays on Move down (still enabled)');
  await showPageLink(p, id);
  assert.equal(await disabled(p, rowButton('page-up')), true, 'Move up disabled on the first page');
  await showPageLink(p, 'p-parts');
  assert.equal(await disabled(p, rowButton('page-down')), true, 'Move down disabled on the last page');

  // P1.4: a reload keeps them
  await allSaved(p);
  const before = await pageNames(p);
  assert.deepEqual(before, ['Settings', 'Checkout', 'Parts']);
  await p.ev('(() => { window.__beforeReload = true; return true; })()');
  await p.send('Page.reload', {});
  const fresh = () => p.ev("!window.__beforeReload && document.body && document.body.dataset.state === 'ready'").catch((e) => { if (DOM_GONE.test(e.message)) return false; throw e; });
  await within(fresh, 'the page reloaded and ready');
  const after = await pageNames(p);
  assert.deepEqual(after, fake.doc('every').pages.map((pg) => pg.name), "the list is the fake document's pages, in order");
  assert.deepEqual(after, before, 'the list as it was before the reload');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test('P1.5 delete a page, never the last', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  // `every` with a third page, Settings, first: the state P1.1–P1.3 leave
  const THREE = docVariant(EVERY, (d) => { d.pages.unshift({ id: 'p-set', name: 'Settings', children: [] }); });
  const { p, fake, rec, load } = await open(t, { canvases: { every: THREE, minimal: MINIMAL }, images: EVERY_IMAGES('every') });
  await live(p);
  await showPageLink(p, 'p-set');
  assert.equal(await p.ev(`document.querySelector(${JSON.stringify(rowButton('page-delete'))}).getAttribute('aria-label')`), 'Delete page');
  let n0 = edits(rec).length;
  await p.click(rowButton('page-delete'));
  const del = await nextEdit(rec, n0);
  assert.deepEqual(del.ops, [{ op: 'del', id: 'p-set' }], 'one del');
  await accepted(rec, n0);
  await within(async () => (await shownPage(p)) === 'p-main', 'the next page (Checkout) shown', async () => shownPage(p));
  assert.deepEqual(await pageNames(p), ['Checkout', 'Parts']);
  assert.deepEqual(fake.doc('every').pages.map((pg) => pg.id), ['p-main', 'p-parts']);
  // the only page: nothing sent, said
  await load('/view/canvas/minimal');
  await live(p);
  await within(async () => (await count(p, rowButton('page-delete'))) === 1, "the only page's Delete button");
  n0 = edits(rec).length;
  await p.click(rowButton('page-delete'));
  await toastSays(p, PAGE_SAY.last);
  await sendsNothing(rec, n0, 'Delete on the only page', 500);
  assert.deepEqual(fake.doc('minimal').pages.map((pg) => pg.id), ['p1'], 'the fake still has its page');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test('P1.6 a page delete undone', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { nobuy: NOBUY }, images: EVERY_IMAGES('nobuy') });
  await live(p);
  await showPageLink(p, 'p-parts');
  let n0 = edits(rec).length;
  await p.click(rowButton('page-delete'));
  const del = await nextEdit(rec, n0);
  assert.deepEqual(del.ops, [{ op: 'del', id: 'p-parts' }], 'one del of Parts');
  await accepted(rec, n0);
  await within(async () => (await shownPage(p)) === 'p-main', 'the page before (Checkout) shown', async () => shownPage(p));
  n0 = edits(rec).length;
  await undoKey(p);
  const back = await nextEdit(rec, n0);
  assert.deepEqual(back.ops[0], { op: 'add', node: { id: 'p-parts', type: 'page', parent: null, name: 'Parts' }, after: 'p-main' }, "the undo's first op re-adds the page, parent null");
  await accepted(rec, n0);
  assert.equal(edits(rec).length, n0 + 1, 'one edit frame');
  const d = fake.doc('nobuy');
  assert.deepEqual(d.pages, NOBUY.pages, "the fake's pages are nobuy's");
  assert.deepEqual(d.nodes, NOBUY.nodes, "the fake's nodes are nobuy's");
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test("P1.7 a page holding a used component isn't deleted", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  // SAME: nobuy with an instance of `button` on Parts itself
  const SAME = docVariant(NOBUY, (d) => {
    d.nodes['buy-here'] = { ...structuredClone(EVERY.nodes.buy), parent: 'p-parts' };
    d.pages[1].children.push('buy-here');
  });
  const { p, fake, rec, load } = await open(t, { canvases: { every: EVERY, same: SAME }, images: { ...EVERY_IMAGES('every'), ...EVERY_IMAGES('same') } });
  await live(p);
  await showPageLink(p, 'p-parts');
  const n0 = edits(rec).length;
  await p.click(rowButton('page-delete'));
  await toastSays(p, PAGE_SAY.used);
  await sendsNothing(rec, n0, 'Delete on Parts', 500);
  assert.equal(await shownPage(p), 'p-parts', 'Parts still shown');
  assert.deepEqual(fake.doc('every').pages.map((pg) => pg.id), ['p-main', 'p-parts'], 'the fake keeps Parts');
  // an instance on the component's own page: that page's delete is allowed
  await load('/view/canvas/same');
  await live(p);
  await showPageLink(p, 'p-parts');
  const n1 = edits(rec).length;
  await p.click(rowButton('page-delete'));
  const del = await nextEdit(rec, n1);
  assert.deepEqual(del.ops, [{ op: 'del', id: 'p-parts' }], 'one del of Parts');
  await accepted(rec, n1);
  assert.deepEqual(fake.doc('same').pages.map((pg) => pg.id), ['p-main'], 'Parts deleted');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

// ---- S5: kit-668 final-1 F1 ----

test("S5.1 a restart during a running fetch drops the old session's held frames", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const a = await ana(fake, later);
  fake.pause('every');
  const e1 = await rename(p, rec, 'dot', 'E one');
  await ackOf(rec, e1);
  await within(async () => (await kept(p)) === '1', 'data-kept 1 once E1 is acked', async () => `kept ${await kept(p)}`);
  // the refusal's fetch, held
  holdDocs(rec);
  await showPageLink(p, 'p-parts', { row: false });
  await selectRow(p, 'button-label');
  const n0 = edits(rec).length;
  await p.key('Delete');
  const del = await waitOps(rec, [{ op: 'del', id: 'button-label' }], 0, 'the del sent');
  assert.ok(edits(rec).length > n0);
  await within(async () => refusedFrames(rec).some((m) => m.seq === del.seq && m.why === 'ref'), 'the del refused ref', async () => JSON.stringify(rec.got.slice(-3)));
  await within(async () => rec.held.length === 1, "the refusal's doc request held", async () => rec.requests.join(' '), 5000);
  const revHeld = await body(p, 'rev');
  // Ana's rename reaches the page while the fetch is held
  await a.edit(nameSet('title', 'Gone'));
  await within(async () => rec.got.some((m) => m && m.t === 'ops' && JSON.stringify(m.ops) === JSON.stringify(nameSet('title', 'Gone'))), "Ana's ops frame reached the page", async () => JSON.stringify(rec.got.slice(-3)));
  assert.equal(await body(p, 'rev'), revHeld, "Ana's frame held by the page, not applied");
  // the restart: the document back to the last saved one, a new session
  fake.restart('every');
  await within(async () => welcomeCount(rec) >= 2, "the page's second welcome", async () => `welcomes ${welcomeCount(rec)}`);
  rec.release();
  rec.hold = null;
  await live(p);
  await hasRev(p, fake);
  await waitSeq(rec, e1, afterWelcome(rec, 2), 'E1 sent again, the same seq');
  await showPageLink(p, 'p-main', { row: false });
  await within(async () => (await rowName(p, 'title')) === EVERY.nodes.title.name, "title listed with the fixture's name", async () => rowName(p, 'title'));
  fake.resume('every');
  await allSaved(p);
  await hasRev(p, fake);
  assert.equal(await rowName(p, 'title'), EVERY.nodes.title.name, 'title never Gone');
  const d = fake.doc('every');
  assert.equal(d.nodes.dot.name, 'E one', "dot has E1's name");
  assert.equal(d.nodes.title.name, EVERY.nodes.title.name, "title has the fixture's name");
  assert.equal(refusedFrames(rec).length, 1, 'only the del refused');
  noDialogs(rec);
  noExceptions(rec);
});

// ---- M: multi-select ----

// MANY: one page, 120 rects r1…r120, a 12 × 10 grid of 10 × 10 px rects 20 px apart.
const MANY = rectsCanvas([{ id: 'p1', name: 'Page 1' }], { count: 120, cols: 12, side: 10, step: 20 });
const outlined = (p) => p.ev("[...document.querySelectorAll('#surface .sel')].map((e) => e.dataset.id).sort()");
const propsText = (p) => p.ev("document.getElementById('props').textContent");
test('M1.1 shift-click selects several and sends select', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  assert.equal(await p.ev("document.getElementById('layers').getAttribute('aria-multiselectable')"), 'true', '#layers is multiselectable');
  const s0 = rec.sent.length;
  await p.click('#surface [data-id="title"]');
  await waitRows(p, ['title'], 'title selected');
  await shiftClick(p, '#surface [data-id="badge"]');
  await waitRows(p, ['title', 'badge'], 'title and badge selected');
  await shiftClick(p, '#layers .layer[data-node="dot"]');
  await waitRows(p, ['title', 'dot', 'badge'], 'title, dot and badge selected');
  assert.deepEqual(await outlined(p), ['badge', 'dot', 'title'], 'the three outlined');
  await waitSelect(rec, ['title', 'dot', 'badge'], 'a select of the three, in layer order');
  await shiftClick(p, '#layers .layer[data-node="dot"]');
  await waitRows(p, ['title', 'badge'], 'dot toggled off');
  assert.deepEqual(await outlined(p), ['badge', 'title'], 'two outlined');
  await waitSelect(rec, ['title', 'badge'], 'a later select of title and badge');
  await sleep(400);
  const sel = selectsTimed(rec, s0);
  for (let i = 1; i < sel.length; i++) assert.ok(sel[i].ts - sel[i - 1].ts >= 240, `select frames ${sel[i].ts - sel[i - 1].ts} ms apart`);
  assert.deepEqual(sel[sel.length - 1].m, { t: 'select', ids: ['title', 'badge'] }, 'the last select frame');
  assert.deepEqual(edits(rec), [], 'no edit');
  noDialogs(rec);
  noExceptions(rec);
});

test('M1.2 the drag rectangle selects top-level nodes', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { placed: PLACED }, images: EVERY_IMAGES('placed') });
  await live(p);
  await marquee(p, { x: -40, y: -40 }, { x: 650, y: 250 });
  await waitRows(p, ['card', 'loose'], 'card and loose selected, not tiles');
  await sleep(300);
  assert.deepEqual(await selectedRows(p), ['card', 'loose'], 'the click that ended it did not clear');
  assert.deepEqual(await outlined(p), ['card', 'loose']);
  assert.equal(await count(p, '.draft'), 0, 'the rectangle gone');
  assert.ok((await propsText(p)).includes('2 layers selected.'), 'the panel says 2 layers selected.');
  assert.equal(await text(p, '#props button[data-action="delete"]'), 'Delete layers');
  await waitSelect(rec, ['card', 'loose'], 'a select of card and loose');
  // Escape with the button down drops it, selecting nothing new
  await p.click('#layers .layer[data-node="tiles"]');
  await waitRows(p, ['tiles'], 'tiles selected');
  await dragPath(p, [await pagePt(p, -40, -40), await pagePt(p, 650, 250)], async () => {
    assert.equal(await count(p, '.draft'), 1, 'the rectangle drawn');
    await p.key('Escape');
  });
  await sleep(300);
  assert.deepEqual(await selectedRows(p), ['tiles'], 'Escape selected nothing new');
  assert.deepEqual(edits(rec), [], 'no edit');
  noDialogs(rec);
  noExceptions(rec);
});

test('M1.3 a move of the selection is one edit', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { placed: PLACED }, images: EVERY_IMAGES('placed') });
  await live(p);
  await p.click('#layers .layer[data-node="loose"]');
  await shiftClick(p, '#layers .layer[data-node="tiles"]');
  await waitRows(p, ['loose', 'tiles'], 'loose and tiles selected');
  const z = await zoomNow(p);
  const n0 = edits(rec).length;
  // slowly (live edits go while the button is down), then released
  const from = await pagePt(p, 500, 100);
  await slowDrag(p, from, { x: from.x + 40, y: from.y + 30 }, 500);
  await within(async () => edits(rec).length > n0 && (await body(p, 'pending')) === '0', 'the drag sent and acked');
  await accepted(rec, n0);
  assert.ok(edits(rec).length - n0 >= 2, `live edits went before the release (${edits(rec).length - n0} frames)`);
  for (const e of edits(rec).slice(n0)) {
    const of = (id) => e.ops.filter((o) => o.id === id).map((o) => [o.op, o.prop]).sort();
    assert.ok(e.ops.every((o) => o.op === 'set' && ['loose', 'tiles'].includes(o.id) && ['x', 'y'].includes(o.prop)), 'sets of x, y only');
    assert.deepEqual(of('loose'), of('tiles'), `the same properties of both: ${JSON.stringify(e.ops)}`);
  }
  const d = fake.doc('placed');
  assert.deepEqual([d.nodes.loose.x, d.nodes.loose.y], [Math.round(400 + 40 / z), Math.round(0 + 30 / z)], 'loose moved');
  assert.deepEqual([d.nodes.tiles.x, d.nodes.tiles.y], [Math.round(700 + 40 / z), Math.round(0 + 30 / z)], 'tiles moved');
  const n1 = edits(rec).length;
  await undoKey(p);
  const back = await nextEdit(rec, n1);
  assert.deepEqual(byProp(back.ops.filter((o) => o.id === 'loose')), [{ op: 'set', id: 'loose', prop: 'x', value: 400 }, { op: 'set', id: 'loose', prop: 'y', value: 0 }]);
  assert.deepEqual(byProp(back.ops.filter((o) => o.id === 'tiles')), [{ op: 'set', id: 'tiles', prop: 'x', value: 700 }, { op: 'set', id: 'tiles', prop: 'y', value: 0 }]);
  assert.equal(back.ops.length, 4, 'all four set back');
  await accepted(rec, n1);
  assert.equal(edits(rec).length, n1 + 1, 'one undo frame');
  noDialogs(rec);
  noExceptions(rec);
});

test('M1.4 a delete of the selection is one edit', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await p.click('#surface [data-id="title"]');
  await shiftClick(p, '#surface [data-id="badge"]');
  await waitRows(p, ['title', 'badge'], 'title and badge selected');
  await blurAll(p);
  const n0 = edits(rec).length;
  await p.key('Delete');
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'del', id: 'title' }, { op: 'del', id: 'badge' }]);
  await accepted(rec, n0);
  await sleep(300);
  assert.equal(edits(rec).length, n0 + 1, 'one edit frame');
  const d = fake.doc('every');
  assert.equal(Object.hasOwn(d.nodes, 'title') || Object.hasOwn(d.nodes, 'badge'), false, 'both gone from the fake');
  noDialogs(rec);
  noExceptions(rec);
});

test('M1.5 over 100 selected', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { many: MANY } });
  await live(p);
  await marquee(p, { x: -15, y: -15 }, { x: 250, y: 210 });
  await within(async () => (await selectedRows(p)).length === 120, 'all 120 selected', async () => String((await selectedRows(p)).length), 5000);
  const first100 = Array.from({ length: 100 }, (_, i) => `r${i + 1}`);
  await waitSelect(rec, first100, 'a select of r1…r100');
  assert.ok(selectsTimed(rec).every((x) => x.m.ids.length <= 100), 'no select of more than 100 ids');
  await blurAll(p);
  const n0 = edits(rec).length;
  await p.key('Delete');
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, Array.from({ length: 120 }, (_, i) => ({ op: 'del', id: `r${i + 1}` })), '120 dels');
  await accepted(rec, n0);
  await sleep(300);
  assert.equal(edits(rec).length, n0 + 1, 'one edit frame');
  assert.deepEqual(fake.doc('many').pages[0].children, [], "the fake's page empty");
  noDialogs(rec);
  noExceptions(rec);
});

test('M1.6 several nudged at once, roots only', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await p.click('#layers .layer[data-node="card"]');
  await shiftClick(p, '#layers .layer[data-node="badge"]');
  await waitRows(p, ['card', 'badge'], 'card and badge selected');
  await blurAll(p);
  let n0 = edits(rec).length;
  await arrow(p, 'ArrowRight');
  let e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'set', id: 'card', prop: 'x', value: 1 }, { op: 'set', id: 'badge', prop: 'x', value: 13 }]);
  await accepted(rec, n0);
  // badge inside loose: loose alone
  await p.click('#layers .layer[data-node="loose"]');
  await shiftClick(p, '#layers .layer[data-node="badge"]');
  await waitRows(p, ['loose', 'badge'], 'loose and badge selected');
  await blurAll(p);
  n0 = edits(rec).length;
  await arrow(p, 'ArrowRight');
  e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'set', id: 'loose', prop: 'x', value: 401 }]);
  await accepted(rec, n0);
  await sleep(300);
  assert.equal(edits(rec).length, n0 + 1, 'one nudge frame');
  // and a drag of loose: loose's sets only (badge at x 13 since the first nudge)
  assert.deepEqual([fake.doc('every').nodes.badge.x, fake.doc('every').nodes.badge.y], [13, -8], 'badge before the drag');
  const z = await zoomNow(p);
  n0 = edits(rec).length;
  await drag(p, await pagePt(p, 401 + 150, 150), 40, 30);
  await within(async () => edits(rec).length > n0 && (await body(p, 'pending')) === '0', 'the drag sent and acked');
  await accepted(rec, n0);
  for (const f of edits(rec).slice(n0)) assert.ok(onlyXY(f, 'loose'), `loose's x, y only: ${JSON.stringify(f.ops)}`);
  const d = fake.doc('every');
  assert.deepEqual([d.nodes.loose.x, d.nodes.loose.y], [Math.round(401 + 40 / z), Math.round(30 / z)], 'loose moved');
  assert.deepEqual([d.nodes.badge.x, d.nodes.badge.y], [13, -8], 'badge kept its x, y');
  noDialogs(rec);
  noExceptions(rec);
});
