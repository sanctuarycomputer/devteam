import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { resolve } from './lib/canvas-fake.mjs';
import { canDrive } from './lib/chrome.mjs';
import { EVERY, EVERY_IMAGES, ackOf, ana, count, edits, enter, fieldSet, focusField, leavePanel, live, nextEdit, noExceptions, notes, open, refusedFrames, selectRow, setOp, showPg, text, typeKeys, waitSaved, within } from './lib/canvas-fixture.mjs';

// ---- a click on the panel right after a field edit (review T1-1) ----

test('a click on the panel after a field edit is kept', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  // typed, then Delete layer clicked (the field's change fires on that press), and typed, Enter, then
  // Delete layer clicked: each sends one set, then one del
  for (const [id, name, withEnter] of [['rule', 'Rule 2', false], ['dot', 'Dot 2', true]]) {
    await selectRow(p, id);
    const n0 = edits(rec).length;
    assert.equal(await focusField(p, 'name'), true, `${id}: the Name field focused`);
    await p.type(name);
    if (withEnter) await enter(p);
    await p.click('#props [data-action="delete"]');
    const set = await nextEdit(rec, n0);
    const del = await nextEdit(rec, n0 + 1);
    const how = withEnter ? 'with Enter' : 'without Enter';
    assert.deepEqual(set.ops, [{ op: 'set', id, prop: 'name', value: name }], `${id} (${how}): one set of name`);
    assert.deepEqual(del.ops, [{ op: 'del', id }], `${id} (${how}): then one del`);
    await ackOf(rec, del);
    assert.equal(await count(p, `#surface [data-id="${id}"]`), 0, `${id} no longer drawn`);
    assert.equal(await count(p, '#props [data-field]'), 0, `${id}: the panel shows no selection`);
  }
  await waitSaved(p);
  for (const id of ['rule', 'dot']) assert.equal(fake.doc('every').nodes[id], undefined, `${id} gone from the fake's document`);
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

// ---- the panel follows edits while a button in it has focus (review T1-2-1) ----

test('the panel follows edits while a button has focus', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const a = await ana(fake, later);
  await selectRow(p, 'title');
  // focus resting on Delete layer (as after a click or Tab)
  assert.equal(await p.ev("(() => { const b = document.querySelector('#props [data-action=\"delete\"]'); b.focus(); return document.activeElement === b; })()"), true, 'Delete layer focused');
  // someone else's rename of the selected node is shown in the panel
  await a.edit([{ op: 'set', id: 'title', prop: 'name', value: 'Renamed by Ana' }]);
  await within(async () => (await text(p, '#props [data-field="name"]')) === 'Renamed by Ana', "the read-only Name row follows Ana's rename", async () => text(p, '#props [data-field="name"]'), 5000);
  assert.equal(await p.ev("document.querySelector('#props [data-prop=\"name\"]').value"), 'Renamed by Ana', 'the Name field follows it');
  assert.equal(await p.ev("document.activeElement?.dataset.action ?? null"), 'delete', 'Delete layer keeps focus through the rebuild');
  // Escape clears the selection, and the panel follows: no fields, no Delete layer
  await p.key('Escape');
  await within(async () => (await count(p, '#props [data-field]')) === 0, 'no read-only rows after Escape', async () => count(p, '#props [data-field]'), 5000);
  assert.equal(await count(p, '#props [data-action="delete"]'), 0, 'no Delete layer after Escape');
  assert.equal(await text(p, '#props .note'), 'Select a layer to see what it is.', 'the empty note');
  const n0 = edits(rec).length;
  await p.key('Enter');
  await sleep(500);
  assert.equal(edits(rec).length, n0, 'nothing deleted after Escape');
  assert.ok(fake.doc('every').nodes.title, 'title kept');
  noExceptions(rec);
});

// ---- C2: the Properties panel's fields ----

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// A property path's value in a stored node (variants.<name>.<id>.<prop> split at its third dot,
// overrides.<id>.<prop> at its second), or undefined when absent.
function valueAt(n, prop) {
  const s = prop.split('.');
  const keys = s[0] === 'variants' && s.length >= 4 ? ['variants', s[1], s[2], s.slice(3).join('.')]
    : s[0] === 'overrides' && s.length >= 3 ? ['overrides', s[1], s.slice(2).join('.')] : s;
  let at = n;
  for (const k of keys) {
    if (!isObj(at) || !Object.hasOwn(at, k)) return undefined;
    at = at[k];
  }
  return at;
}
// A null that removes: a property whose default is absent (a variant, an override; contract §2
// Defaults, spec-3 F3-1) reads as the key absent; a null elsewhere (stroke, variant) is a stored null.
const removes = (prop) => /^(variants|overrides|props)\./.test(prop);
function holds(n, prop, value) {
  if (value === null && removes(prop)) return valueAt(n, prop) === undefined;
  try { assert.deepEqual(valueAt(n, prop), value); return true; } catch { return false; }
}

// The page each fixture node is on (its ancestors walked up to a page).
function pageOf(doc, id) {
  let at = id;
  while (Object.hasOwn(doc.nodes, at)) at = doc.nodes[at].parent;
  return at;
}
// A node's drawn width in page px, rounded (the box's width over the stage's zoom).
const drawnW = (p, id) => p.ev(`(() => {
  const e = document.querySelector('#surface [data-id="${id}"]');
  const z = new DOMMatrix(getComputedStyle(document.getElementById('surface')).transform).a;
  return Math.round(e.getBoundingClientRect().width / z);
})()`);
// A colour (hex) as the page's computed style gives it.
const cssColor = (p, hex) => p.ev(`(() => { const d = document.createElement('div'); d.style.backgroundColor = ${JSON.stringify(hex)}; document.body.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; })()`);
// A paint value's hex: a hex as it is, a colour token's hex, null transparent.
function hexOf(doc, v) {
  if (v === null || v === undefined) return 'transparent';
  if (typeof v === 'string') return v;
  let at = doc.tokens;
  for (const seg of v.$ref.split('.')) at = at[seg];
  return at.$value.hex;
}
// C2.4's drawing checks, run after their rows.
async function drawnRow(p) {
  await within(async () => (await p.ev("getComputedStyle(document.querySelector('#surface [data-id=\"card\"]')).flexDirection")) === 'row', 'card drawn as a row');
}
async function drawnHello(p) {
  await within(async () => (await text(p, '#surface [data-id="title"]')) === 'Hello', 'title shows Hello', async () => text(p, '#surface [data-id="title"]'));
}
async function drawnQuiet(p, fake) {
  const want = await cssColor(p, hexOf(EVERY, resolve(fake.doc('every'), 'buy')['button-bg'].fill));
  const got = () => p.ev("(() => { const e = document.querySelector('#surface [data-of=\"buy\"][data-src=\"button-bg\"]'); return e ? getComputedStyle(e).backgroundColor : null; })()");
  await within(async () => (await got()) === want, `buy's background drawn as resolve gives it (${want})`, got);
  // a check that can fail on this fixture (T2-1): buy's own override of button-bg's fill equals primary's
  await within(async () => (await text(p, '#props [data-field="variant"]')) === 'quiet', "the read-only Variant row reads quiet", async () => text(p, '#props [data-field="variant"]'));
}
// After Change in quiet sets button-bg's fill: the panel is still in quiet, the fields that can't be
// overridden (name) are hidden, and the stage keeps drawing the component's base (contract §2).
async function changedInQuiet(p) {
  assert.equal(await p.ev("document.querySelector('#props [data-prop=\"@variant\"]')?.value ?? null"), 'quiet', 'Change in still quiet');
  assert.equal(await count(p, '#props [data-prop="name"]'), 0, 'Name is hidden in Change in');
  const base = await cssColor(p, '#e5e7eb');
  assert.equal(await p.ev("getComputedStyle(document.querySelector('#surface [data-id=\"button-bg\"]')).backgroundColor"), base, "the stage keeps button-bg's base fill");
}
// After From base: the variant holds no fill, and the field says "From base".
async function saysFromBase(p) {
  const shown = () => p.ev("(() => { const s = document.querySelector('#props [data-prop=\"fill\"]'); return s ? `${s.value} ${s.selectedOptions[0]?.textContent}` : null; })()");
  await within(async () => (await shown()) === '@base From base', 'the fill field says From base', shown);
}
// One step of a C2 row: a field set (fieldSet); with 'type', the text typed into the field and no
// Enter; with 'click', the panel's button of that data-action (and data-variant, when given).
async function rowStep(p, [f, v, how]) {
  if (how === 'type') {
    assert.equal(await focusField(p, f), true, `${f} focused`);
    await typeKeys(p, String(v));
  } else if (how === 'click') {
    await p.click(`#props [data-action="${f}"]${v === null ? '' : `[data-variant="${v}"]`}`);
    await leavePanel(p);
  } else await fieldSet(p, f, v);
}

// Before final-1 F2's row: Ana adds the typography token type.lead (serif 24 700 1.2, none of them the
// page's default font) and sets title's font to it; the panel then offers it selected.
const LEAD = { $type: 'typography', $value: { fontFamily: 'serif', fontSize: { value: 24, unit: 'px' }, fontWeight: 700, letterSpacing: { value: 0, unit: 'px' }, lineHeight: 1.2 } };
async function leadFont(p, fake, a) {
  await a.edit([{ op: 'token', path: 'type.lead', value: LEAD }, setOp('title', 'font', { $ref: 'type.lead' })]);
  assert.deepEqual(fake.doc('every').nodes.title.font, { $ref: 'type.lead' }, "Ana's font held by the fake");
  const shown = () => p.ev("document.querySelector('#props [data-prop=\"font\"]')?.value ?? null");
  await within(async () => (await shown()) === 'type.lead', "the Font field shows Ana's type.lead", shown, 5000);
}

// The C2 table (spec C2), in its order: the node, its page, the field changed (each step a fieldSet),
// and the one set op sent (on `on`, else the node); `before`, when given, runs once the node is selected
// (an edit of Ana's the row starts from). The four rows on button's variants come before the
// last row, which stays last (the spec's order).
const C2_ROWS = [
  { id: 'card', steps: [['layout.mode', 'row']], prop: 'layout.mode', value: 'row', after: drawnRow },
  { id: 'card', steps: [['layout.gap', '24']], prop: 'layout.gap', value: 24 },
  { id: 'card', steps: [['layout.align', 'center']], prop: 'layout.align', value: 'center' },
  { id: 'card', steps: [['layout.justify', 'end']], prop: 'layout.justify', value: 'end' },
  { id: 'card', steps: [['layout.wrap', true]], prop: 'layout.wrap', value: true },
  { id: 'card', steps: [['layout.padding#1', '24']], prop: 'layout.padding', value: [16, 24, 16, 16] },
  { id: 'card', steps: [['size.w#n', '320']], prop: 'size.w', value: 320 },
  { id: 'card', steps: [['size.h', 'fill']], prop: 'size.h', value: 'fill' },
  { id: 'card', steps: [['fill', 'color.brand']], prop: 'fill', value: { $ref: 'color.brand' } },
  { id: 'card', steps: [['stroke#hex', '#ff000080']], prop: 'stroke', value: '#ff000080' },
  { id: 'card', steps: [['strokeWidth', '2']], prop: 'strokeWidth', value: 2 },
  { id: 'card', steps: [['radius', '6']], prop: 'radius', value: 6 },
  { id: 'card', steps: [['clip', false]], prop: 'clip', value: false },
  { id: 'card', steps: [['opacity', '50']], prop: 'opacity', value: 0.5 },
  { id: 'card', steps: [['name', 'Card 2']], prop: 'name', value: 'Card 2' },
  { id: 'dot', steps: [['fill', '@hex'], ['fill#hex', '#123456']], prop: 'fill', value: '#123456' },
  { id: 'icon', steps: [['stroke', '@none']], prop: 'stroke', value: null },
  { id: 'photo', steps: [['radius', '4']], prop: 'radius', value: 4 },
  { id: 'buy', steps: [['size.w', 'fixed']], prop: 'size.w', value: (p) => drawnW(p, 'buy') },
  { id: 'title', steps: [['size.w', 'hug']], prop: 'size.w', value: 'hug' },
  { id: 'button', page: 'p-parts', steps: [['layout.gap', '4']], prop: 'layout.gap', value: 4 },
  { id: 'tiles', steps: [['layout.columns', '1fr 80 auto']], prop: 'layout.columns', value: ['1fr', 80, 'auto'] },
  { id: 'tiles', steps: [['layout.rows', '40']], prop: 'layout.rows', value: [40] },
  { id: 'loose', steps: [['x', '420']], prop: 'x', value: 420 },
  { id: 'loose', steps: [['y', '10']], prop: 'y', value: 10 },
  { id: 'title', steps: [['text', 'Hello']], prop: 'text', value: 'Hello', after: drawnHello },
  { id: 'title', steps: [['font', '@custom']], prop: 'font', value: { family: 'sans', size: 16, weight: 400, lineHeight: 1.4 } },
  { id: 'title', steps: [['font#family', 'serif']], prop: 'font', value: { family: 'serif', size: 16, weight: 400, lineHeight: 1.4 } },
  { id: 'title', steps: [['font#size', '20']], prop: 'font', value: { family: 'serif', size: 20, weight: 400, lineHeight: 1.4 } },
  { id: 'title', steps: [['font', 'type.body']], prop: 'font', value: { $ref: 'type.body' } },
  // final-1 F2: type.body's values are also the page's default font, so the row above would pass on a
  // page that sent the defaults. Here Ana first adds a typography token of other values and sets title's
  // font to it; Custom must send that token's values.
  { id: 'title', before: leadFont, steps: [['font', '@custom']], prop: 'font', value: { family: 'serif', size: 24, weight: 700, lineHeight: 1.2 } },
  { id: 'title', steps: [['color', 'color.brand']], prop: 'color', value: { $ref: 'color.brand' } },
  { id: 'title', steps: [['align', 'center']], prop: 'align', value: 'center' },
  { id: 'photo', steps: [['fit', 'contain']], prop: 'fit', value: 'contain' },
  { id: 'buy', steps: [['variant', 'quiet']], prop: 'variant', value: 'quiet', after: drawnQuiet },
  { id: 'buy', steps: [['variant', '@none']], prop: 'variant', value: null },
  { id: 'button', page: 'p-parts', steps: [['@new-variant', 'x1', 'type'], ['add-variant', null, 'click']], prop: 'variants.x1', value: {} },
  { id: 'button', page: 'p-parts', steps: [['remove-variant', 'x1', 'click']], prop: 'variants.x1', value: null },
  { id: 'button-bg', on: 'button', page: 'p-parts', steps: [['@variant', 'quiet'], ['fill', '@hex'], ['fill#hex', '#00ff00']], prop: 'variants.quiet.button-bg.fill', value: '#00ff00', after: changedInQuiet },
  { id: 'button-bg', on: 'button', page: 'p-parts', steps: [['@variant', 'quiet'], ['fill', '@base']], prop: 'variants.quiet.button-bg.fill', value: null, after: saysFromBase },
  { id: 'loose', steps: [['visible', false]], prop: 'visible', value: false },
];

test('every property sends one set op the fake accepts', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const a = await ana(fake, later);
  for (const row of C2_ROWS) {
    const on = row.on ?? row.id;
    const what = `${row.id} ${row.steps.map(([f, v]) => `${f} ${JSON.stringify(v)}`).join(', ')}`;
    await showPg(p, row.page ?? 'p-main');
    await selectRow(p, row.id);
    if (row.before) await row.before(p, fake, a);
    const value = typeof row.value === 'function' ? await row.value(p) : row.value;
    assert.equal(holds(fake.doc('every').nodes[on], row.prop, value), false, `${what}: ${on} doesn't already hold ${JSON.stringify(value)}`);
    const n0 = edits(rec).length;
    for (const step of row.steps) await rowStep(p, step);
    const e = await nextEdit(rec, n0);
    assert.deepEqual(e.ops, [setOp(on, row.prop, value)], `${what}: one set op`);
    await ackOf(rec, e);
    await sleep(200);
    assert.equal(edits(rec).length, n0 + 1, `${what}: exactly one edit frame`);
    assert.deepEqual(refusedFrames(rec), [], `${what}: nothing refused`);
    assert.equal(holds(fake.doc('every').nodes[on], row.prop, value), true, `${what}: the fake's document holds ${JSON.stringify(value)} (${JSON.stringify(valueAt(fake.doc('every').nodes[on], row.prop))})`);
    if (row.after) await row.after(p, fake);
  }
  await waitSaved(p);
  noExceptions(rec);
});

test("the panel's fields are all checked", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const sent = new Set(C2_ROWS.map((r) => r.prop));
  // a field's property paths: data-prop values with no # (a part) and no @ (the panel's own)
  const paths = () => p.ev("[...document.querySelectorAll('#props [data-prop]')].map((e) => e.dataset.prop).filter((v) => !v.includes('#') && !v.includes('@'))");
  const covered = async (what) => {
    const ps = await paths();
    assert.ok(ps.includes('name') && ps.includes('size.w'), `${what}: the panel has its fields (${ps.join(' ')})`);
    for (const x of ps) assert.ok(sent.has(x), `${what}: ${x} is a path some row of C2 sends`);
    return ps;
  };
  const types = new Set();
  for (const id of Object.keys(EVERY.nodes)) {
    await showPg(p, pageOf(EVERY, id));
    await selectRow(p, id);
    await covered(id);
    types.add(EVERY.nodes[id].type);
  }
  assert.deepEqual([...types].sort(), ['component', 'ellipse', 'frame', 'image', 'instance', 'rect', 'text', 'vector'], 'one of each type');
  // card in each of the four layout modes, by its Direction buttons
  await showPg(p, 'p-main');
  await selectRow(p, 'card');
  const has = { none: [], row: ['layout.gap', 'layout.wrap'], column: ['layout.gap', 'layout.wrap'], grid: ['layout.gap', 'layout.columns', 'layout.rows'] };
  const not = { none: ['layout.gap', 'layout.wrap', 'layout.columns'], row: ['layout.columns'], column: ['layout.columns'], grid: ['layout.wrap'] };
  for (const mode of ['none', 'row', 'grid', 'column']) {
    await fieldSet(p, 'layout.mode', mode);
    await within(async () => (await p.ev(`document.querySelector('#props [data-prop="layout.mode"] button[aria-pressed="true"]')?.dataset.value ?? null`)) === mode, `card's Direction ${mode} pressed`);
    const ps = await covered(`card, ${mode}`);
    for (const x of has[mode]) assert.ok(ps.includes(x), `card, ${mode}: ${x} shown`);
    for (const x of not[mode]) assert.ok(!ps.includes(x), `card, ${mode}: ${x} not shown`);
  }
  await waitSaved(p);
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

test('out-of-class input sends nothing', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const TRACKS = 'Tracks are numbers, auto or 1fr-like, apart by spaces.';
  const COLOUR = 'A colour is #rgb, #rrggbb or #rrggbbaa.';
  await selectRow(p, 'tiles');
  let n0 = edits(rec).length;
  await fieldSet(p, 'layout.columns', 'repeat(3, 1fr)');
  await within(async () => (await notes(p)).includes(TRACKS), 'the tracks note', async () => JSON.stringify(await notes(p)));
  await sleep(800);
  assert.equal(edits(rec).length, n0, 'repeat(…) sends nothing');
  await selectRow(p, 'card');
  n0 = edits(rec).length;
  await fieldSet(p, 'stroke#hex', 'red');
  await within(async () => (await notes(p)).includes(COLOUR), 'the colour note', async () => JSON.stringify(await notes(p)));
  await sleep(800);
  assert.equal(edits(rec).length, n0, 'red sends nothing');
  assert.deepEqual(fake.doc('every').nodes.tiles.layout.columns, EVERY.nodes.tiles.layout.columns, 'tiles unchanged');
  assert.equal(fake.doc('every').nodes.card.stroke, EVERY.nodes.card.stroke, 'card unchanged');
  // a number out of its range is clamped to it, and sent
  await fieldSet(p, 'opacity', '150');
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [setOp('card', 'opacity', 1)], 'opacity 150 % clamped to 1');
  await ackOf(rec, e);
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

test('a hostile name is text', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const HOSTILE_NAME = '<img src=x onerror=alert(1)>';
  const imgs = () => count(p, 'img');
  await selectRow(p, 'rule');
  const before = await imgs();
  const n0 = edits(rec).length;
  await fieldSet(p, 'name', HOSTILE_NAME);
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [setOp('rule', 'name', HOSTILE_NAME)], 'sent as that string');
  await ackOf(rec, e);
  assert.equal(fake.doc('every').nodes.rule.name, HOSTILE_NAME);
  await within(async () => (await text(p, '#layers .layer[data-node="rule"] .nm')) === HOSTILE_NAME, 'the Layers row shows it as text', async () => text(p, '#layers .layer[data-node="rule"] .nm'));
  // the panel is rebuilt in a timer after focus leaves it, so it is waited on
  await within(async () => (await text(p, '#props [data-field="name"]')) === HOSTILE_NAME, 'the read-only Name row shows it as text', async () => text(p, '#props [data-field="name"]'), 5000);
  assert.equal(await imgs(), before, 'no img element added');
  assert.equal(await count(p, '#layers img, #props img'), 0, 'no img in the Layers or the panel');
  await sleep(300);
  assert.deepEqual(rec.dialogs, [], 'no dialog opened');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

test("a remote edit doesn't take a field from under a person typing", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const a = await ana(fake, later);
  await selectRow(p, 'title');
  assert.equal(await focusField(p, 'text'), true, 'the Text field focused');
  await typeKeys(p, 'Typed');
  const n0 = edits(rec).length;
  // Ana changes the same node's text and align while the person types
  await a.edit([setOp('title', 'text', 'From Ana'), setOp('title', 'align', 'center')]);
  await within(async () => (await text(p, '#surface [data-id="title"]')) === 'From Ana', "Ana's text drawn on the stage", async () => text(p, '#surface [data-id="title"]'), 5000);
  await sleep(300);
  assert.equal(await p.ev('document.activeElement?.dataset.prop ?? null'), 'text', 'the Text field keeps focus');
  assert.equal(await p.ev("document.querySelector('#props [data-prop=\"text\"]').value"), 'Typed', 'the Text field keeps what was typed');
  assert.equal(edits(rec).length, n0, 'nothing sent while typing');
  // leaving the field sends what was typed, once; the panel then follows Ana's align
  await leavePanel(p);
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [setOp('title', 'text', 'Typed')], 'one set of text');
  await ackOf(rec, e);
  await within(async () => (await p.ev("document.querySelector('#props [data-prop=\"align\"] button[aria-pressed=\"true\"]')?.dataset.value ?? null")) === 'center', "the panel shows Ana's align", async () => p.ev("document.querySelector('#props [data-prop=\"align\"] button[aria-pressed=\"true\"]')?.dataset.value ?? null"), 5000);
  await waitSaved(p);
  assert.equal(fake.doc('every').nodes.title.text, 'Typed', "the server's order: the page's edit came last");
  assert.equal(await p.ev("document.querySelector('#props [data-prop=\"text\"]').value"), 'Typed');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});
