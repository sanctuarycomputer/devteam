import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { docErrors } from './lib/canvas-fake.mjs';
import { canDrive } from './lib/chrome.mjs';
import { EVERY, EVERY_IMAGES, IMG, IMG_FILE, IMG_PATH, MINIMAL, SAY, ackOf, added, ana, arrow, body, box, centre, count, drag, dragPath, edits, enter, fieldSet, fixture, focusField, hitAt, kept, key, live, madeAndSelected, mouse, near, nextEdit, noExceptions, notes, open, pressedTool, propControls, refusedFrames, selectRow, selectedIds, sendsNothing, setOp, showPg, shownMsg, shownPage, shownText, text, typeKeys, waitSaved, within, zoomNow } from './lib/canvas-fixture.mjs';

// ---- components, variants and instances (spec §3) ----

const VARIANT_NOTE = "A variant's name is a letter, then letters, digits or _.";
const OWN_COMPONENT = "An instance can't go inside its own component.";
const offered = (p, action) => count(p, `#props [data-action="${action}"]`);
const variantsListed = (p) => p.ev("[...document.querySelectorAll('#props [data-action=\"remove-variant\"]')].map((b) => b.dataset.variant)");
const hideToast = (p) => p.ev("document.getElementById('toast').hidden = true");

test('make component', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  // offered on a frame where a component may be; not on another type, nor on a frame in a component,
  // nor on a frame holding a component
  await selectRow(p, 'badge');
  assert.equal(await offered(p, 'make-component'), 0, 'not on a rect');
  const a = await ana(fake, later);
  await a.edit([
    { op: 'add', node: { id: 'holder', type: 'frame', parent: 'p-parts', name: 'Holder', x: 400, y: 200, size: { w: 200, h: 150 }, layout: { mode: 'none' } }, after: 'button' },
    { op: 'add', node: { id: 'chip', type: 'component', parent: 'holder', name: 'Chip', x: 10, y: 10, size: { w: 40, h: 40 }, layout: { mode: 'none' } }, after: null },
  ]);
  await within(async () => (await body(p, 'rev')) === String(fake.rev('every')), "the page has Ana's edit");
  await showPg(p, 'p-parts');
  await selectRow(p, 'button-bg');
  assert.equal(await offered(p, 'make-component'), 0, 'not on a frame inside a component');
  await selectRow(p, 'holder');
  assert.equal(await offered(p, 'make-component'), 0, 'not on a frame holding a component');

  // loose (a `none` frame on the page, holding badge) made a component: one edit
  await showPg(p, 'p-main');
  await selectRow(p, 'loose');
  assert.equal(await offered(p, 'make-component'), 1, 'offered on loose');
  const looseBox = await box(p, '#surface [data-id="loose"]');
  const badgeBox = await box(p, '#surface [data-id="badge"]');
  const n0 = edits(rec).length;
  await p.click('#props [data-action="make-component"]');
  const e = await nextEdit(rec, n0);
  assert.equal(e.ops.length, 3, `one edit of three ops (${JSON.stringify(e.ops)})`);
  const cid = e.ops[0].node?.id;
  assert.match(String(cid), /^[0-9a-z]{6}-\d+$/, 'a new id <prefix>-<n>');
  assert.deepEqual(e.ops, [
    { op: 'add', node: { id: cid, type: 'component', parent: 'p-main', name: 'Loose', layout: { mode: 'none' }, size: { w: 200, h: 200 }, x: 400, y: 0 }, after: 'loose' },
    { op: 'move', id: 'badge', parent: cid, after: null },
    { op: 'del', id: 'loose' },
  ], 'add the component with the frame\'s properties after it, move its child, delete the frame');
  await ackOf(rec, e);
  await sleep(200);
  assert.equal(edits(rec).length, n0 + 1, 'exactly one edit frame');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  const d = fake.doc('every');
  assert.equal(Object.hasOwn(d.nodes, 'loose'), false, 'the frame is gone');
  assert.equal(d.nodes[cid].type, 'component');
  assert.deepEqual(d.nodes[cid].children, ['badge'], 'the component holds badge');
  assert.equal(d.nodes.badge.parent, cid);
  assert.deepEqual([d.nodes.badge.x, d.nodes.badge.y], [12, -8], 'badge keeps its place');
  assert.deepEqual(d.pages[0].children, ['card', cid, 'tiles'], "the component in the frame's place");
  // drawn with its child, where the frame was, and selected
  await within(async () => (await count(p, `#surface [data-id="${cid}"] [data-id="badge"]`)) === 1, 'the component drawn holding badge');
  assert.equal(await count(p, '#surface [data-id="loose"]'), 0, 'loose no longer drawn');
  const cb = await box(p, `#surface [data-id="${cid}"]`);
  const bb = await box(p, '#surface [data-id="badge"]');
  for (const k of ['l', 't', 'w', 'h']) {
    near(cb[k], looseBox[k], 0.5, `the component drawn as loose was: ${k}`);
    near(bb[k], badgeBox[k], 0.5, `badge drawn where it was: ${k}`);
  }
  assert.deepEqual(await selectedIds(p), [cid], 'the component selected');
  assert.equal(await offered(p, 'make-component'), 0, 'a component is not offered make component');
  assert.equal(await offered(p, 'place-instance'), 1, 'a component offers place instance');
  await waitSaved(p);
  noExceptions(rec);
});

test('variants', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await showPg(p, 'p-parts');
  await selectRow(p, 'button');
  assert.deepEqual(await variantsListed(p), ['primary', 'quiet'], "button's variants listed, each with Remove");
  // Add variant dark
  let n0 = edits(rec).length;
  assert.equal(await focusField(p, '@new-variant'), true, 'the variant name field');
  await typeKeys(p, 'dark');
  await p.click('#props [data-action="add-variant"]');
  let e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [setOp('button', 'variants.dark', {})], 'Add variant sends one set of {}');
  await ackOf(rec, e);
  await within(async () => JSON.stringify(await variantsListed(p)) === '["primary","quiet","dark"]', 'dark listed', () => variantsListed(p));
  assert.deepEqual(fake.doc('every').nodes.button.variants.dark, {}, 'the fake holds dark');
  // a bad name: its note, nothing sent
  for (const bad of ['1x', 'dark-mode']) {
    n0 = edits(rec).length;
    assert.equal(await focusField(p, '@new-variant'), true, 'the variant name field');
    await typeKeys(p, bad);
    await p.click('#props [data-action="add-variant"]');
    await within(async () => (await notes(p)).includes(VARIANT_NOTE), `${bad}: the variant name's note`, () => notes(p), 5000);
    await sendsNothing(rec, n0, `the name ${bad}`);
  }
  // Remove on dark
  n0 = edits(rec).length;
  await p.click('#props [data-action="remove-variant"][data-variant="dark"]');
  e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [setOp('button', 'variants.dark', null)], 'Remove sends one set of null');
  await ackOf(rec, e);
  await within(async () => JSON.stringify(await variantsListed(p)) === '["primary","quiet"]', 'dark no longer listed', () => variantsListed(p));
  assert.equal(Object.hasOwn(fake.doc('every').nodes.button.variants, 'dark'), false, 'the fake no longer holds dark');
  // Change in shows on a node inside the component (it has variants), not on the component itself
  assert.equal(await count(p, '#props [data-prop="@variant"]'), 0, 'no Change in on the component');
  await selectRow(p, 'button-label');
  const opts = await p.ev("[...document.querySelectorAll('#props [data-prop=\"@variant\"] option')].map((o) => o.textContent)");
  assert.deepEqual(opts, ['Base', 'primary', 'quiet'], 'Change in: Base or a variant');
  // in primary, the label's text shows the variant's value and sends to the variant
  await fieldSet(p, '@variant', 'primary');
  assert.equal(await p.ev("document.querySelector('#props [data-prop=\"text\"]').value"), 'Variant label', "the variant's value shown");
  n0 = edits(rec).length;
  await fieldSet(p, 'text', 'Go');
  e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [setOp('button', 'variants.primary.button-label.text', 'Go')], 'sent to the variant');
  await ackOf(rec, e);
  assert.equal(await text(p, '#surface [data-id="button-label"]'), 'Base label', 'the stage keeps the base');
  // back to Base: a set on the node itself
  await fieldSet(p, '@variant', '@base');
  assert.equal(await p.ev("document.querySelector('#props [data-prop=\"text\"]').value"), 'Base label', 'the base value shown');
  await waitSaved(p);
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

test('place an instance and set its variant', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await showPg(p, 'p-parts');
  // Place instance, then a click on the stage beside button
  await selectRow(p, 'button');
  const b = await box(p, '#surface [data-id="button"]');
  const pt = { x: Math.round(b.r + 150), y: Math.round(b.t + 30) };
  assert.equal(['button', 'button-bg', 'button-label'].includes(await hitAt(p, pt)), false, 'the click is beside button');
  let n0 = edits(rec).length;
  await p.click('#props [data-action="place-instance"]');
  await mouse(p, 'mousePressed', pt.x, pt.y);
  await mouse(p, 'mouseReleased', pt.x, pt.y);
  const add = await added(rec, n0, 'the instance');
  const iid = add.node.id;
  assert.equal(add.node.type, 'instance');
  assert.equal(add.node.component, 'button', 'of button');
  assert.equal(add.node.name, 'Button', "named as button");
  assert.deepEqual(add.node.size, { w: 'hug', h: 'hug' }, 'hug × hug');
  assert.equal(add.node.parent, 'p-parts', 'on the page');
  assert.equal(add.after, 'button', 'after the last node');
  const s = await p.ev("(() => { const r = document.getElementById('surface').getBoundingClientRect(); return { l: r.left, t: r.top }; })()");
  const z = await zoomNow(p);
  assert.deepEqual([add.node.x, add.node.y], [Math.round((pt.x - s.l) / z), Math.round((pt.y - s.t) / z)], 'at the pointer');
  await madeAndSelected(p, iid, 'the instance');
  await within(async () => (await count(p, `#surface [data-id="${iid}"]`)) === 1, 'the instance drawn');
  assert.equal(fake.doc('every').nodes[iid].component, 'button', 'the fake holds the instance');
  // its Variant set to primary
  n0 = edits(rec).length;
  await fieldSet(p, 'variant', 'primary');
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [setOp(iid, 'variant', 'primary')], 'the variant set');
  await ackOf(rec, e);
  assert.equal(fake.doc('every').nodes[iid].variant, 'primary');
  await within(async () => (await text(p, '#props [data-field="variant"]')) === 'primary', 'the Variant row reads primary');

  // never inside its own component: a click on button's drawn box adds nothing and says so
  await selectRow(p, 'button');
  await hideToast(p);
  n0 = edits(rec).length;
  await p.click('#props [data-action="place-instance"]');
  const inside = centre(await box(p, '#surface [data-id="button-label"]'));
  await mouse(p, 'mousePressed', inside.x, inside.y);
  await mouse(p, 'mouseReleased', inside.x, inside.y);
  await within(async () => (await shownText(p, '#toast')) === OWN_COMPONENT, 'the page says an instance cannot go inside its own component', () => shownText(p, '#toast'), 5000);
  await sendsNothing(rec, n0, 'an instance inside its own component');
  assert.equal(await pressedTool(p), 'move', 'the tool back to Move');
  // Escape ends placing: the next click adds nothing
  await p.click('#props [data-action="place-instance"]');
  await p.key('Escape');
  await mouse(p, 'mousePressed', pt.x, pt.y + 120);
  await mouse(p, 'mouseReleased', pt.x, pt.y + 120);
  await sendsNothing(rec, n0, 'a click after Escape');

  // an instance dragged into the component it names (T4-1): buy, moved to Parts by Ana, onto button
  const a = await ana(fake, later);
  await a.edit([
    { op: 'move', id: 'buy', parent: 'p-parts', after: iid },
    { op: 'set', id: 'buy', prop: 'x', value: 0 },
    { op: 'set', id: 'buy', prop: 'y', value: 300 },
  ]);
  await within(async () => (await count(p, '#surface [data-id="buy"]')) === 1, 'buy drawn on Parts');
  const buy0 = await box(p, '#surface [data-id="buy"]');
  await hideToast(p);
  n0 = edits(rec).length;
  await dragPath(p, [centre(buy0), centre(await box(p, '#surface [data-id="button"]'))]);
  await within(async () => (await shownText(p, '#toast')) === OWN_COMPONENT, 'buy dropped on button: the own-component words', () => shownText(p, '#toast'), 5000);
  // kit-668: a restore if live frames went, the fake's buy unchanged
  await sleep(600);
  const fr = edits(rec).slice(n0);
  for (const f of fr) assert.ok(f.ops.every((o) => o.op === 'set' && o.id === 'buy' && ['x', 'y'].includes(o.prop)), `buy: live frames and a restore only: ${JSON.stringify(f.ops)}`);
  if (fr.length) assert.deepEqual(fr[fr.length - 1].ops.map((o) => o.value), fr[fr.length - 1].ops.map((o) => ({ x: 0, y: 300 })[o.prop]), 'buy: the last frame restores the start');
  await waitSaved(p);
  assert.deepEqual([fake.doc('every').nodes.buy.x, fake.doc('every').nodes.buy.y], [0, 300], "buy unchanged in the fake");
  const buy1 = await box(p, '#surface [data-id="buy"]');
  near(buy1.l, buy0.l, 0.5, 'buy drawn back: x');
  near(buy1.t, buy0.t, 0.5, 'buy drawn back: y');
  assert.equal(fake.doc('every').nodes.buy.parent, 'p-parts', 'buy still on the page');
  await waitSaved(p);
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

// ---- the Layers tree by keyboard (C5), narrow screens and width (C6) ----

// A key as a keyboard sends it, with its own virtual key code (the helper's key() gives these keys a
// letter's code), and no text.
const VK = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, Delete: 46, Backspace: 8, Tab: 9 };
async function press(p, k) {
  const c = { key: k, code: k, windowsVirtualKeyCode: VK[k], nativeVirtualKeyCode: VK[k] };
  await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...c });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...c });
}
// The Layers tree as it stands: its rows, the rows in the tab order (tabIndex 0), whether every other
// row is -1, the selected rows, the focused row and its outline, the Name row, and the drawn selection.
const tree = (p) => p.ev(`(() => {
  const rows = [...document.querySelectorAll('#layers .layer[data-node]')];
  const a = document.activeElement;
  const inTree = a instanceof Element && a.matches('#layers .layer[data-node]');
  const sel = [...document.querySelectorAll('#surface .sel')];
  return {
    rows: rows.map((r) => r.dataset.node),
    stops: rows.filter((r) => r.tabIndex === 0).map((r) => r.dataset.node),
    rest: rows.every((r) => r.tabIndex === 0 || r.tabIndex === -1),
    selected: rows.filter((r) => r.getAttribute('aria-selected') === 'true').map((r) => r.dataset.node),
    focused: inTree ? a.dataset.node : null,
    outline: inTree ? getComputedStyle(a).outlineStyle : null,
    outlineW: inTree ? parseFloat(getComputedStyle(a).outlineWidth) : 0,
    name: document.querySelector('#props [data-field="name"]')?.textContent ?? null,
    drawn: sel.map((e) => e.dataset.id ?? null),
    drawnOutline: sel.length ? getComputedStyle(sel[0]).outlineStyle : null,
  };
})()`);
// Focus is on `id`'s row, and it is selected, the one tab stop, ringed, named and drawn outlined.
async function onRow(p, id, what) {
  await within(async () => (await tree(p)).focused === id, `${what}: focus on ${id}'s row`, async () => JSON.stringify(await tree(p)), 5000);
  await within(async () => (await tree(p)).name === EVERY.nodes[id].name, `${what}: the Name row shows ${id}'s name`, async () => JSON.stringify(await tree(p)), 5000);
  const s = await tree(p);
  assert.deepEqual(s.selected, [id], `${what}: ${id} selected`);
  assert.deepEqual(s.stops, [id], `${what}: ${id}'s row the one tab stop`);
  assert.equal(s.rest, true, `${what}: every other row -1`);
  assert.ok(s.outline !== 'none' && s.outlineW > 0, `${what}: the focused row ringed (${s.outline} ${s.outlineW})`);
  assert.deepEqual(s.drawn, [id], `${what}: ${id} drawn outlined`);
  assert.notEqual(s.drawnOutline, 'none', `${what}: the drawn outline shown`);
}

test('the Layers tree by keyboard', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const n0 = edits(rec).length;
  const t0 = await tree(p);
  const rows = t0.rows;
  assert.deepEqual(rows, ['card', 'title', 'rule', 'dot', 'icon', 'photo', 'actions', 'buy', 'loose', 'badge', 'tiles'], "Checkout's rows");
  assert.deepEqual(t0.stops, ['card'], 'nothing selected: the first row the one tab stop');
  assert.equal(t0.rest, true, 'every other row -1');
  // Tab from the page's start reaches a row within 20 presses: the first
  let tabs = 0;
  while ((await tree(p)).focused === null && tabs < 20) { await press(p, 'Tab'); tabs++; }
  const s = await tree(p);
  assert.equal(s.focused, 'card', `Tab reaches card's row (${tabs} presses; focus on ${await p.ev('document.activeElement?.outerHTML.slice(0, 80) ?? null')})`);
  assert.ok(s.outline !== 'none' && s.outlineW > 0, `the row reached by Tab ringed (${s.outline})`);
  // ArrowDown, ArrowUp, End, Home
  await press(p, 'ArrowDown');
  await onRow(p, 'title', 'ArrowDown');
  await press(p, 'ArrowUp');
  await onRow(p, 'card', 'ArrowUp');
  await press(p, 'ArrowUp');
  await onRow(p, 'card', 'ArrowUp on the first row');
  await press(p, 'End');
  await onRow(p, 'tiles', 'End');
  await press(p, 'ArrowDown');
  await onRow(p, 'tiles', 'ArrowDown on the last row');
  await press(p, 'Home');
  await onRow(p, 'card', 'Home');
  // down every row (card, loose and badge are placed by x, y: the arrows never nudge them)
  for (const id of rows.slice(1)) {
    await press(p, 'ArrowDown');
    await onRow(p, id, `ArrowDown to ${id}`);
  }
  for (const id of rows.slice(0, -1).reverse()) {
    await press(p, 'ArrowUp');
    await onRow(p, id, `ArrowUp to ${id}`);
  }
  await sendsNothing(rec, n0, 'the walk');
  for (const id of ['card', 'loose', 'badge']) {
    assert.equal(fake.doc('every').nodes[id].x, EVERY.nodes[id].x, `${id}'s x unchanged`);
    assert.equal(fake.doc('every').nodes[id].y, EVERY.nodes[id].y, `${id}'s y unchanged`);
  }
  // a click on the drawn dot makes dot's row the tab stop
  const dot = await box(p, '#surface [data-id="dot"]');
  const pt = centre(dot);
  assert.equal(await hitAt(p, pt), 'dot', 'the point is on dot');
  await p.clickAt(pt.x, pt.y);
  await within(async () => (await tree(p)).stops.join(' ') === 'dot', "dot's row the tab stop", async () => JSON.stringify(await tree(p)), 5000);
  const d = await tree(p);
  assert.deepEqual(d.selected, ['dot'], 'dot selected');
  assert.equal(d.rest, true, 'every other row -1');
  await sendsNothing(rec, n0, 'the click');
  // back into the tree at dot's row, and Delete on the focused rule row: one del of rule
  await p.ev(`document.querySelector('#layers .layer[data-node="dot"]').focus()`);
  await press(p, 'ArrowUp');
  await onRow(p, 'rule', 'ArrowUp from dot');
  await press(p, 'Delete');
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'del', id: 'rule' }], 'one del of rule');
  await ackOf(rec, e);
  await sendsNothing(rec, n0 + 1, 'after the del');
  assert.equal(fake.doc('every').nodes.rule, undefined, 'rule gone from the fake');
  const after = await tree(p);
  assert.equal(after.rows.includes('rule'), false, "rule's row gone");
  assert.equal(after.stops.length, 1, `one tab stop after the delete (${after.stops.join(' ')})`);
  assert.equal(after.rest, true, 'every other row -1 after the delete');
  assert.equal(after.focused, after.stops[0], 'focus stays in the tree, on the tab stop');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

// final-1 F1: another person's edits leave the Pages list as it is. A link with focus keeps it (so the
// arrow keys don't fall to the page and nudge the selected node), and the page select's options are the
// same elements (an open picker isn't replaced under it). A renamed page rebuilds the list; focus stays
// on the same page's link.
test("the Pages list keeps focus through others' edits", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const a = await ana(fake, later);
  await selectRow(p, 'loose');
  const focusedPage = (pg) => pg.ev("(() => { const e = document.activeElement; return e instanceof Element && e.matches('#pages a[data-page]') ? e.dataset.page : (e ? e.localName : null); })()");
  assert.equal(await p.ev("(() => { const e = document.querySelector('#pages a[data-page=\"p-main\"]'); e.focus(); return document.activeElement === e; })()"), true, "Checkout's link focused");
  await p.ev("(() => { window.__mainLink = document.querySelector('#pages a[data-page=\"p-main\"]'); window.__firstOpt = document.querySelector('#pageSel option'); })()");
  const n0 = edits(rec).length;
  for (const [i, words] of [[1, 'From Ana'], [2, 'Again from Ana']]) {
    await a.edit([setOp('title', 'text', words)]);
    await within(async () => (await text(p, '#surface [data-id="title"]')) === words, `Ana's edit ${i} drawn`, async () => text(p, '#surface [data-id="title"]'), 5000);
    assert.equal(await focusedPage(p), 'p-main', `Checkout's link keeps focus through Ana's edit ${i}`);
    assert.equal(await p.ev("document.querySelector('#pages a[data-page=\"p-main\"]') === window.__mainLink"), true, `the Pages link not rebuilt by Ana's edit ${i}`);
    assert.equal(await p.ev("document.querySelector('#pageSel option') === window.__firstOpt"), true, `the page select's options not replaced by Ana's edit ${i}`);
  }
  // the arrow keys on the link are the link's: nothing nudged, nothing sent
  await arrow(p, 'ArrowDown');
  await arrow(p, 'ArrowRight');
  await sendsNothing(rec, n0, 'arrows on a Pages link');
  assert.equal(await focusedPage(p), 'p-main', "Checkout's link still focused after the arrows");
  // Ana renames the other page: the list shows it, and focus is still on Checkout's link
  await a.edit([setOp('p-parts', 'name', 'Parts 2')]);
  await within(async () => (await text(p, '#pages a[data-page="p-parts"]')) === 'Parts 2', 'the renamed page shown', async () => text(p, '#pages a[data-page="p-parts"]'), 5000);
  assert.equal(await text(p, '#pageSel option[value="p-parts"]'), 'Parts 2', 'the page select shows the new name');
  assert.equal(await focusedPage(p), 'p-main', "Checkout's link keeps focus through the rename");
  assert.equal(await shownPage(p), 'p-main', 'Checkout still shown');
  await sendsNothing(rec, n0, "Ana's edits");
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

test("a narrow screen doesn't edit", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec, size } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every'), size: [390, 844] });
  await live(p);
  assert.equal(await p.ev("(() => { const t = document.getElementById('tools'); return getComputedStyle(t).display === 'none' || t.getBoundingClientRect().width === 0; })()"), true, 'the tools bar not shown');
  const n0 = edits(rec).length;
  for (const id of ['title', 'badge']) {
    const pt = centre(await box(p, `#surface [data-id="${id}"]`));
    assert.equal(await hitAt(p, pt), id, `the point is on ${id}`);
    await p.clickAt(pt.x, pt.y);
    await within(async () => (await selectedIds(p)).join(' ') === id, `${id} selected by a click`, async () => selectedIds(p), 5000);
    for (const k of ['F', 'R']) {
      await p.key(k);
      assert.equal(await pressedTool(p), 'move', `${id}: ${k} changes no tool`);
    }
    for (const k of ['Delete', 'Backspace', 'ArrowRight', 'ArrowDown']) await press(p, k);
    await sendsNothing(rec, n0, `${id}: F, R, Delete, Backspace and the arrows`);
    assert.equal(await count(p, `#surface [data-id="${id}"]`), 1, `${id} still drawn`);
    // the panel's fields are there for the wide layout, and none of them can be used
    const ctl = await propControls(p);
    assert.ok(ctl.length > 0, `${id}: the panel built`);
    assert.deepEqual(ctl.filter((c) => !c.off).map((c) => c.prop), [], `${id}: every field disabled under 760 px`);
    assert.equal(await p.ev("[...document.querySelectorAll('#props button')].every((b) => b.disabled)"), true, `${id}: every panel button disabled`);
  }
  // wide again: badge still selected, its fields usable, and the keys work
  await size(1440, 900);
  await within(async () => (await p.ev('innerWidth')) === 1440, 'the window at 1440');
  await within(async () => (await propControls(p)).every((c) => !c.off), 'the fields usable at 1440', async () => JSON.stringify(await propControls(p)), 5000);
  await p.key('F');
  assert.equal(await pressedTool(p), 'frame', '1440: F presses Frame');
  await p.key('Escape');
  noExceptions(rec);
});

// kit-661's walk (canvas-editor.test.mjs, C4.1), copied: every visible element outside #surface that
// directly holds a non-blank text node and may wrap: a name for it and its width on screen.
const RUNNING_TEXT = `(() => {
  const surface = document.getElementById('surface');
  const out = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (surface.contains(el) || el.closest('script, style')) continue;
    if (![...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.data.trim() !== '')) continue;
    if (el.getClientRects().length === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible') continue;
    const wraps = cs.textWrapMode ? cs.textWrapMode !== 'nowrap' : !['nowrap', 'pre'].includes(cs.whiteSpace);
    if (!wraps) continue;
    const name = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + [...el.classList].map((c) => '.' + c).join('');
    out.push({ name, w: el.getBoundingClientRect().width });
  }
  return out;
})()`;

test('running text within six columns while editing', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every'), path: '/view/canvas/every#page=p-parts' });
  await live(p);
  const capped = (sel) => p.ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => getComputedStyle(e).maxWidth)`);
  const check = async (what, mustHold) => {
    const found = await p.ev(RUNNING_TEXT);
    for (const { name, w } of found) assert.ok(w <= 560.5, `${what}: ${name} is ${w} px wide, over the measure`);
    for (const m of mustHold) assert.ok(found.some((f) => f.name.startsWith(m)), `${what}: the walk reaches ${m} (found ${found.map((f) => f.name).join(', ')})`);
  };
  // the refused message of C3.3, then title selected on Checkout while it shows
  await selectRow(p, 'button-label');
  const n0 = edits(rec).length;
  await press(p, 'Delete');
  const e = await nextEdit(rec, n0);
  await within(async () => refusedFrames(rec).some((m) => m.seq === e.seq), 'the refused frame', async () => JSON.stringify(rec.got.slice(-3)));
  await within(async () => (await shownText(p, '#toast')) === SAY.ref, 'the refusal said', async () => shownText(p, '#toast'));
  await showPg(p, 'p-main');
  await selectRow(p, 'title');
  assert.equal(await shownText(p, '#toast'), SAY.ref, 'the refusal still shown');
  await check('title selected, the refusal shown', ['p#toast', 'span.v']);
  // a field note shown too: a colour typed as red on card
  await selectRow(p, 'card');
  await fieldSet(p, 'stroke#hex', 'red');
  await within(async () => (await notes(p)).length > 0, 'a field note', async () => JSON.stringify(await notes(p)));
  await check('card selected, a field note shown', ['p.note.fnote']);
  // the new running-text elements carry the cap itself (the banner too, while hidden)
  for (const sel of ['#toast', '#banner', '#props .fnote']) {
    const mw = await capped(sel);
    assert.ok(mw.length > 0 && mw.every((v) => /^(min\()?560px\b/.test(v)), `${sel} capped at the measure (${mw.join(', ')})`);
  }
  noExceptions(rec);
});

// ---- C1: every node type drawn with the tools, saved and reloaded unchanged (done-when 1) ----

const HOSTILE = fixture('hostile.json');
// What the page draws, in page px: every drawn node (`[data-id]`) and every node drawn inside an
// instance (`[data-of][data-src]`), in document order, with its tag, its box unscaled (from the
// surface's origin, over the zoom), its computed display and background colour; and the Layers rows'
// ids, names and levels.
const snapshot = (p) => p.ev(`(() => {
  const s = document.getElementById('surface');
  const o = s.getBoundingClientRect();
  const z = new DOMMatrix(getComputedStyle(s).transform).a;
  const drawn = [...s.querySelectorAll('[data-id], [data-of][data-src]')].map((e) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return { key: e.dataset.id ?? e.dataset.of + '/' + e.dataset.src, tag: e.localName, l: (r.left - o.left) / z, t: (r.top - o.top) / z, w: r.width / z, h: r.height / z, display: cs.display, bg: cs.backgroundColor };
  });
  const layers = [...document.querySelectorAll('#layers .layer[data-node]')].map((r) => ({ id: r.dataset.node, name: r.querySelector('.nm')?.textContent ?? null, level: r.getAttribute('aria-level') }));
  return { drawn, layers };
})()`);
// Two snapshots draw the same thing: the same rows and nodes, each node's tag, display and background
// equal and its box within 0.5 page px.
function sameDrawing(a, b) {
  assert.deepEqual(b.layers, a.layers, 'the Layers rows: ids, names and levels');
  assert.deepEqual(b.drawn.map((d) => d.key), a.drawn.map((d) => d.key), 'the same drawn nodes, in the same order');
  a.drawn.forEach((d, i) => {
    const e = b.drawn[i];
    assert.deepEqual([e.tag, e.display, e.bg], [d.tag, d.display, d.bg], `${d.key}: its tag, display and background`);
    for (const k of ['l', 't', 'w', 'h']) near(e[k], d[k], 0.5, `${d.key}: its box's ${k}`);
  });
}
const imagesLoaded = (p) => within(() => p.ev("[...document.querySelectorAll('#surface img')].every((i) => i.complete)"), 'the drawn images loaded');

test('canvas A8: every node type is drawn with the tools, saved and reloaded unchanged, and the hostile fixture loads nothing from elsewhere', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, origin, rec, load } = await open(t, { canvases: { draw: MINIMAL, hostile: HOSTILE }, images: { hostile: { [IMG_FILE]: IMG } } });
  await live(p);
  await rec.send('Page.setInterceptFileChooserDialog', { enabled: true });
  const folder = { images: new Set([IMG_FILE]) }; // the image the picker uploads is the only file draw's folder gets
  const id = {};
  let drawn = false;
  let kept = null;
  let before = null;

  // C1.1: on the empty page (p1), at 1440 × 900, with the tools and the panel only
  await t.test('C1.1 drawn with the tools', async () => {
    assert.equal(await shownMsg(p), 'This page is empty.', 'the empty page says so');
    const z = await zoomNow(p);
    // a point given in page px, on screen
    const at = async (x, y) => {
      const s = await box(p, '#surface');
      return { x: Math.round(s.l + x * z), y: Math.round(s.t + y * z) };
    };
    // one tool used: one add of that type into that parent, acked, the new node selected, Move again
    const made = async (key, type, parent, use) => {
      const n0 = edits(rec).length;
      await use();
      const op = await added(rec, n0, key);
      assert.equal(op.node.type, type, `${key}: a ${type}`);
      assert.equal(op.node.parent, parent, `${key}: in ${parent}`);
      await madeAndSelected(p, op.node.id, key);
      id[key] = op.node.id;
      return op;
    };
    // fields changed by real input: one edit of one set, acked
    const changed = async (what, steps, want) => {
      const n0 = edits(rec).length;
      for (const [f, v] of steps) await fieldSet(p, f, v);
      const e = await nextEdit(rec, n0);
      assert.deepEqual(e.ops, [want], `${what}: one set`);
      await ackOf(rec, e);
    };
    const dragOut = async (key, x, y, w, h) => { await p.key(key); await drag(p, await at(x, y), w * z, h * z); };
    const clickIn = async (key, x, y) => { await p.key(key); const q = await at(x, y); await p.clickAt(q.x, q.y); };

    // a `none` frame dragged out on the page; the empty-page note goes (C1.1a)
    await made('free', 'frame', 'p1', () => dragOut('F', 20, 60, 560, 560));
    await within(async () => (await shownMsg(p)) === null, 'C1.1a: "This page is empty." no longer shown', async () => shownMsg(p), 5000);
    // inside it, three frames dragged out and set to Row, Column and Grid (its columns typed)
    await made('row', 'frame', id.free, () => dragOut('F', 40, 80, 400, 120));
    await changed('Row', [['layout.mode', 'row']], setOp(id.row, 'layout.mode', 'row'));
    await made('column', 'frame', id.free, () => dragOut('F', 40, 220, 200, 340));
    await changed('Column', [['layout.mode', 'column']], setOp(id.column, 'layout.mode', 'column'));
    await made('grid', 'frame', id.free, () => dragOut('F', 260, 220, 200, 150));
    await changed('Grid', [['layout.mode', 'grid']], setOp(id.grid, 'layout.mode', 'grid'));
    await within(async () => (await count(p, '#props [data-prop="layout.columns"]')) === 1, "the grid's Columns field");
    await changed('Columns', [['layout.columns', '1fr 1fr']], setOp(id.grid, 'layout.columns', ['1fr', '1fr']));
    // a text clicked into the row, its text typed; a rectangle into the row, after it
    await made('text', 'text', id.row, () => clickIn('T', 100, 140));
    await changed('Text', [['text', 'Hello']], setOp(id.text, 'text', 'Hello'));
    const r = await made('rect', 'rect', id.row, () => clickIn('R', 340, 140));
    assert.equal(r.after, id.text, 'the rectangle after the text in the row');
    // an ellipse into the column
    await made('ellipse', 'ellipse', id.column, () => clickIn('O', 140, 270));
    // a vector of three clicks in the `none` frame, ended with Enter
    await made('vector', 'vector', id.free, async () => {
      await p.key('P');
      for (const [x, y] of [[510, 260], [570, 320], [520, 390]]) { const q = await at(x, y); await p.clickAt(q.x, q.y); }
      await enter(p);
    });
    // an image clicked into the column, below the ellipse, and uploaded through the picker: its add is
    // sent (what the server keeps of it is C1.2's)
    {
      const n0 = edits(rec).length;
      const c0 = rec.choosers.length;
      await clickIn('I', 140, 480);
      await within(async () => rec.choosers.length > c0, 'the file chooser opened', async () => JSON.stringify(rec.choosers));
      await rec.send('DOM.setFileInputFiles', { files: [IMG_PATH], backendNodeId: rec.choosers[c0].backendNodeId });
      const e = await nextEdit(rec, n0);
      assert.equal(e.ops.length, 1, 'image: one op');
      assert.deepEqual([e.ops[0].op, e.ops[0].node?.type, e.ops[0].node?.parent, e.ops[0].after], ['add', 'image', id.column, id.ellipse], 'image: an add into the column, after the ellipse');
      id.image = e.ops[0].node.id;
      assert.equal(await pressedTool(p), 'move', 'image: Move again');
    }
    // a frame dragged out on the page with a rectangle drawn in it, made a component
    await made('frameB', 'frame', 'p1', () => dragOut('F', 620, 60, 240, 160));
    await made('inner', 'rect', id.frameB, () => dragOut('R', 640, 80, 80, 60));
    await selectRow(p, id.frameB);
    {
      const n0 = edits(rec).length;
      await p.click('#props [data-action="make-component"]');
      const e = await nextEdit(rec, n0);
      assert.deepEqual([e.ops[0].op, e.ops[0].node?.type, e.ops[0].node?.parent], ['add', 'component', 'p1'], 'Make component: adds a component on the page');
      id.comp = e.ops[0].node.id;
      await ackOf(rec, e);
      await within(async () => JSON.stringify(await selectedIds(p)) === JSON.stringify([id.comp]), 'the component selected', () => selectedIds(p));
    }
    // given a variant dark by Add variant
    {
      const n0 = edits(rec).length;
      assert.equal(await focusField(p, '@new-variant'), true, 'the variant name field');
      await typeKeys(p, 'dark');
      await p.click('#props [data-action="add-variant"]');
      const e = await nextEdit(rec, n0);
      assert.deepEqual(e.ops, [setOp(id.comp, 'variants.dark', {})], 'Add variant: one set of {}');
      await ackOf(rec, e);
      await within(async () => (await variantsListed(p)).includes('dark'), 'dark listed', () => variantsListed(p));
    }
    // with Change in dark on the rectangle, its fill set to hex #222222
    await selectRow(p, id.inner);
    await changed('Change in dark: fill', [['@variant', 'dark'], ['fill', '@hex'], ['fill#hex', '#222222']], setOp(id.comp, `variants.dark.${id.inner}.fill`, '#222222'));
    // Place instance on the page, and the instance's Variant set to dark
    await selectRow(p, id.comp);
    const inst = await made('instance', 'instance', 'p1', async () => {
      await p.click('#props [data-action="place-instance"]');
      const q = await at(620, 300);
      await mouse(p, 'mousePressed', q.x, q.y);
      await mouse(p, 'mouseReleased', q.x, q.y);
    });
    assert.equal(inst.node.component, id.comp, 'an instance of the component');
    await changed('Variant', [['variant', 'dark']], setOp(id.instance, 'variant', 'dark'));
    drawn = true;
  });

  // C1.2: once all is acked and saved, the fake's document holds every type, rightly
  await t.test('C1.2 sent and kept', async () => {
    assert.ok(drawn, 'C1.1 drew everything');
    await waitSaved(p);
    const doc = structuredClone(fake.doc('draw'));
    const N = doc.nodes;
    assert.deepEqual([...new Set(Object.values(N).map((n) => n.type))].sort(), ['component', 'ellipse', 'frame', 'image', 'instance', 'rect', 'text', 'vector'], 'a node of each type');
    assert.deepEqual(Object.values(N).filter((n) => n.type === 'frame').map((n) => n.layout?.mode ?? 'none').sort(), ['column', 'grid', 'none', 'row'], 'frames of each of the four modes');
    const where = [['free', 'frame', 'p1'], ['row', 'frame', id.free], ['column', 'frame', id.free], ['grid', 'frame', id.free], ['text', 'text', id.row], ['rect', 'rect', id.row], ['ellipse', 'ellipse', id.column], ['vector', 'vector', id.free], ['image', 'image', id.column], ['inner', 'rect', id.comp], ['comp', 'component', 'p1'], ['instance', 'instance', 'p1']];
    for (const [key, type, parent] of where) assert.deepEqual([N[id[key]]?.type, N[id[key]]?.parent], [type, parent], `${key}: a ${type} in ${parent}`);
    assert.equal(Object.hasOwn(N, id.frameB), false, 'the frame made a component is gone');
    assert.deepEqual(doc.pages[0].children, [id.free, id.comp, id.instance], "the page's nodes");
    assert.deepEqual(N[id.row].children, [id.text, id.rect], 'the row: the text, then the rectangle');
    assert.deepEqual(N[id.column].children, [id.ellipse, id.image], 'the column: the ellipse, then the image');
    assert.equal(N[id.text].text, 'Hello', 'the text typed');
    assert.deepEqual(N[id.grid].layout.columns, ['1fr', '1fr'], "the grid's columns");
    assert.match(N[id.vector].path, /^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/, "the vector's path of three points");
    assert.equal(N[id.image].src, `images/${IMG_FILE}`, "the image's src");
    assert.deepEqual(N[id.comp].variants, { dark: { [id.inner]: { fill: '#222222' } } }, "the component's variant dark: the rectangle's fill");
    assert.deepEqual([N[id.instance].component, N[id.instance].variant], [id.comp, 'dark'], 'the instance: of the component, variant dark');
    assert.deepEqual(docErrors(doc, folder), [], "docErrors finds nothing, with the folder's images");
    assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
    kept = doc;
  });

  // C1.3: the fake restarted (back to its last saved document, the socket closed 1012) loses nothing
  await t.test('C1.3 saved, not just held', async () => {
    assert.ok(kept, 'C1.2 read the document');
    // what the page draws now, with nothing selected, for C1.4
    await p.key('Escape');
    await within(async () => (await selectedIds(p)).length === 0, 'nothing selected', () => selectedIds(p));
    await imagesLoaded(p);
    before = await snapshot(p);
    fake.restart('draw');
    assert.deepEqual(fake.doc('draw'), kept, 'the restarted document is the one read in C1.2');
  });

  // C1.4: the page reloaded draws the same thing
  await t.test('C1.4 reloaded unchanged', async () => {
    assert.ok(before, 'C1.3 took the drawing before the restart');
    const keys = before.drawn.map((d) => d.key);
    for (const key of ['free', 'row', 'column', 'grid', 'text', 'rect', 'ellipse', 'vector', 'image', 'comp', 'inner', 'instance']) assert.ok(keys.includes(id[key]), `${key} drawn before the reload`);
    assert.ok(keys.includes(`${id.instance}/${id.inner}`), "the instance's rectangle drawn before the reload");
    const n0 = edits(rec).length;
    await load('/view/canvas/draw');
    await live(p);
    await imagesLoaded(p);
    sameDrawing(before, await snapshot(p));
    assert.equal(edits(rec).length, n0, 'the reload sent no edit');
    assert.deepEqual(fake.doc('draw'), kept, 'the document is still the one saved');
    assert.deepEqual(docErrors(fake.doc('draw'), folder), [], 'docErrors finds nothing after the reload');
  });

  // C1.5: the hostile fixture loaded in the editor loads nothing from elsewhere and opens no dialog
  await t.test('C1.5 the hostile fixture loads nothing from elsewhere', async () => {
    await load('/view/canvas/hostile');
    await live(p);
    await imagesLoaded(p);
    await sleep(500);
    const urls = [...rec.urls];
    assert.deepEqual(urls.filter((u) => u !== origin && !u.startsWith(`${origin}/`)), [], `no URL off the fake's origin (saw ${urls.join(' ')})`);
    assert.deepEqual(urls.filter((u) => u.includes('evil.example')), [], 'no evil.example');
    assert.ok(rec.urls.has(`${origin}/api/canvas/doc?slug=hostile`), 'the hostile document loaded');
    assert.deepEqual(rec.dialogs, [], 'no dialog opened');
    assert.equal(await body(p, 'live'), 'on', 'the socket open');
  });
  noExceptions(rec);
});
