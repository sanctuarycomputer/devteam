import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { docErrors } from './lib/canvas-fake.mjs';
import { canDrive } from './lib/chrome.mjs';
import { EVERY, EVERY_IMAGES, FIX, IMG_FILE, MINIMAL, accepted, allSaved, blurAll, box, count, edits, focusField, hideToast, key, live, nextEdit, noDialogs, noExceptions, open, selectRow, sendsNothing, shiftClick, showPageLink, shownText, toastSays, waitRows, zoomNow } from './lib/canvas-fixture.mjs';

// A paste of `s` as text: a `paste` event with a DataTransfer holding it, on document.body.
const pasteText = (p, s) => p.ev(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(s)}); document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return true; })()`);
// A copy now: a `copy` event with a fresh DataTransfer on what has focus (the body when nothing does);
// its text/plain after the page's handler ran ('' when it set none).
const clipNow = (p) => p.ev("(() => { const dt = new DataTransfer(); const t = document.activeElement || document.body; t.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true })); return dt.getData('text/plain'); })()");

// ---- C: copy and paste ----

const HOSTILE_TEXT = fs.readFileSync(path.join(FIX, 'hostile.json'), 'utf8');
const HOSTILE = JSON.parse(HOSTILE_TEXT);
const NEW_ID = /^[0-9a-z]{6}-\d+$/;
const PASTE_SAY = {
  notClip: "That isn't a canvas's layers, so nothing was pasted.",
  tooMuch: 'That is too much to paste at once.',
  frames: "Instances of components this canvas doesn't have were pasted as frames.",
  rects: "Images this canvas doesn't have were pasted as rectangles.",
  values: "Some values weren't valid here, so they were left out.",
};
// Ctrl+C and Ctrl+V as a keyboard sends them, running the browser's own copy and paste.
const copyKey = (p) => key(p, 'c', { ctrl: true, commands: ['copy'] });
const pasteKey = (p) => key(p, 'v', { ctrl: true, commands: ['paste'] });
// An add's node without its id.
const nodeless = (nd) => Object.fromEntries(Object.entries(nd).filter(([k]) => k !== 'id'));
// A node's drawn box in the shown page's px, rounded.
async function drawnAt(p, id) {
  const b = await box(p, `#surface [data-id="${id}"]`);
  const s = await box(p, '#surface');
  const z = await zoomNow(p);
  return { x: Math.round((b.l - s.l) / z), y: Math.round((b.t - s.t) / z), w: Math.round(b.w / z), h: Math.round(b.h / z) };
}
const rowNames = (p) => p.ev("[...document.querySelectorAll('#layers .layer[data-node]')].map((r) => [r.dataset.node, r.querySelector('.nm').textContent])");

// kit-661's census (test/canvas-editor.test.mjs), copied. Before the page loads: alert, confirm, prompt
// and print replaced by recorders (window.dialogTraps).
const DIALOG_TRAPS = `(() => {
  const calls = [];
  Object.defineProperty(window, 'dialogTraps', { value: calls });
  for (const name of ['alert', 'confirm', 'prompt', 'print']) {
    const trap = function () { calls.push([name, ...[...arguments].map(String)]); return name === 'confirm' ? false : name === 'prompt' ? null : undefined; };
    Object.defineProperty(window, name, { value: trap, writable: false, configurable: false });
  }
})();`;
const addTraps = (rec) => rec.send('Page.addScriptToEvaluateOnNewDocument', { source: DIALOG_TRAPS });
// The DOM's census: the elements a document's markup would add, and every on* attribute.
const CENSUS = `(() => ({
  traps: Array.isArray(window.dialogTraps) && ['alert', 'confirm', 'prompt', 'print'].every((k) => String(window[k]).includes('calls.push')),
  calls: window.dialogTraps ?? null,
  script: document.querySelectorAll('script').length,
  style: document.querySelectorAll('style').length,
  foreign: [...document.querySelectorAll('iframe, object, embed, link, b')].map((e) => e.localName),
  meta: [...document.querySelectorAll('meta')].map((m) => (m.hasAttribute('charset') ? 'charset' : m.name)),
  on: [...document.querySelectorAll('*')].flatMap((e) => [...e.attributes].filter((a) => /^on/i.test(a.name)).map((a) => e.localName + ' ' + a.name)),
}))()`;
// No dialog opened, no trap called, and the DOM holds only the page's own markup.
async function ranNothing(p, rec, what, taken = null) {
  assert.deepEqual(rec.dialogs, [], `${what}: no dialog opened`);
  const c = taken ?? await p.ev(CENSUS);
  assert.equal(c.traps, true, `${what}: the dialog traps are in place`);
  assert.deepEqual(c.calls, [], `${what}: no dialog function called`);
  assert.equal(c.script, 1, `${what}: one script element`);
  assert.equal(c.style, 1, `${what}: one style element`);
  assert.deepEqual(c.foreign, [], `${what}: no iframe, object, embed, link or b`);
  assert.deepEqual(c.meta, ['charset', 'viewport'], `${what}: only the page's own meta`);
  assert.deepEqual(c.on, [], `${what}: no on* attribute anywhere`);
}

test('C1.1 copy and paste on the same page', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await selectRow(p, 'loose');
  await blurAll(p);
  const n0 = edits(rec).length;
  await copyKey(p);
  await pasteKey(p);
  const e = await nextEdit(rec, n0);
  assert.equal(e.ops.length, 2, `two adds: ${JSON.stringify(e.ops)}`);
  const [a, b] = e.ops;
  for (const o of [a, b]) assert.match(o.node.id, NEW_ID, 'a new id');
  assert.notEqual(a.node.id, b.node.id);
  assert.ok(!['loose', 'badge'].includes(a.node.id) && !['loose', 'badge'].includes(b.node.id), 'not the originals');
  assert.deepEqual({ ...a, node: nodeless(a.node) }, { op: 'add', node: { type: 'frame', parent: 'p-main', name: 'Loose', layout: { mode: 'none' }, size: { w: 200, h: 200 }, x: 420, y: 20 }, after: 'tiles' }, "loose's copy, 20 px right and down");
  assert.deepEqual({ ...b, node: nodeless(b.node) }, { op: 'add', node: { type: 'rect', parent: a.node.id, name: 'Badge', x: 12, y: -8, size: { w: 24, h: 24 }, radius: 12, fill: '#ef4444' }, after: null }, "badge's copy in it");
  await accepted(rec, n0);
  await sleep(300);
  assert.equal(edits(rec).length, n0 + 1, 'one edit frame');
  await waitRows(p, [a.node.id], 'the copy selected');
  await allSaved(p);
  const d = fake.doc('every');
  assert.deepEqual([d.nodes.loose, d.nodes.badge], [EVERY.nodes.loose, EVERY.nodes.badge], 'the originals unchanged');
  assert.deepEqual(d.pages[0].children, ['card', 'loose', 'tiles', a.node.id], 'the copy last on Checkout');
  assert.deepEqual(d.nodes[a.node.id].children, [b.node.id], "badge's copy in loose's");
  noDialogs(rec);
  noExceptions(rec);
});

test('C1.2 paste on another page', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await selectRow(p, 'title');
  await shiftClick(p, '#layers .layer[data-node="dot"]');
  await waitRows(p, ['title', 'dot'], 'title and dot selected');
  const at = { title: await drawnAt(p, 'title'), dot: await drawnAt(p, 'dot') };
  await blurAll(p);
  await copyKey(p);
  await showPageLink(p, 'p-parts');
  await blurAll(p);
  const n0 = edits(rec).length;
  await pasteKey(p);
  const e = await nextEdit(rec, n0);
  assert.equal(e.ops.length, 2, `two adds: ${JSON.stringify(e.ops)}`);
  const [a, b] = e.ops;
  assert.deepEqual([a.op, a.node.type, a.node.parent, a.after], ['add', 'text', 'p-parts', 'button'], "title's copy after Parts' last node");
  assert.deepEqual([b.op, b.node.type, b.node.parent, b.after], ['add', 'ellipse', 'p-parts', a.node.id], "dot's copy after title's");
  assert.deepEqual([a.node.x, a.node.y], [at.title.x, at.title.y], "title's copy at its drawn position on Checkout");
  assert.deepEqual([b.node.x, b.node.y], [at.dot.x, at.dot.y], "dot's copy at its drawn position on Checkout");
  assert.deepEqual(a.node.size, { w: at.title.w, h: 'hug' }, "title's fill width as drawn");
  assert.equal(typeof a.node.size.w, 'number');
  assert.deepEqual([a.node.font, a.node.color, b.node.fill], [{ $ref: 'type.body' }, { $ref: 'color.ink' }, { $ref: 'color.brand' }], 'tokens this canvas has kept as references');
  assert.equal(a.node.text, 'Order summary');
  await accepted(rec, n0);
  await waitRows(p, [a.node.id, b.node.id], 'both copies selected');
  for (const id of [a.node.id, b.node.id]) assert.equal(await count(p, `#surface [data-id="${id}"]`), 1, `${id} drawn on Parts`);
  noDialogs(rec);
  noExceptions(rec);
});

test('C1.3 an instance whose component is here', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await selectRow(p, 'buy');
  await blurAll(p);
  await hideToast(p);
  const n0 = edits(rec).length;
  await copyKey(p);
  await pasteKey(p);
  const e = await nextEdit(rec, n0);
  assert.equal(e.ops.length, 1, `one add: ${JSON.stringify(e.ops)}`);
  const nd = e.ops[0].node;
  assert.match(nd.id, NEW_ID);
  assert.deepEqual([nd.type, nd.component, nd.variant, nd.parent, e.ops[0].after], ['instance', 'button', 'primary', 'p-main', 'tiles'], 'an instance of button');
  assert.deepEqual([nd.props, nd.overrides], [EVERY.nodes.buy.props, EVERY.nodes.buy.overrides], 'its props and overrides kept');
  await accepted(rec, n0);
  await waitRows(p, [nd.id], 'the copy selected');
  assert.equal(await shownText(p, '#toast'), null, 'nothing said');
  noDialogs(rec);
  noExceptions(rec);
});

test('C1.4 hostile.json from another canvas adds nothing that runs or loads', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const H = HOSTILE;
  const { p, fake, origin, rec } = await open(t, { canvases: { minimal: MINIMAL }, beforeLoad: addTraps });
  await live(p);
  const n0 = edits(rec).length;
  await pasteText(p, HOSTILE_TEXT);
  const e = await nextEdit(rec, n0);
  const ORDER = ['hf', 'ht', 'hr', 'hv', 'him', 'hc', 'hct', 'hi', 'he'];
  assert.equal(e.ops.length, 9, `nine adds: ${JSON.stringify(e.ops.map((o) => [o.op, o.node?.type]))}`);
  assert.ok(e.ops.every((o) => o.op === 'add'), 'all adds');
  const op = Object.fromEntries(ORDER.map((id, i) => [id, e.ops[i]]));
  const nid = Object.fromEntries(ORDER.map((id) => [id, op[id].node.id]));
  for (const id of ORDER) assert.match(nid[id], NEW_ID, `${id}'s copy has a new id`);
  assert.equal(new Set(Object.values(nid)).size, 9, 'nine ids');
  // (b)
  assert.deepEqual(ORDER.map((id) => op[id].node.type), ['frame', 'text', 'rect', 'vector', 'rect', 'component', 'text', 'frame', 'ellipse'], 'the types, in order');
  assert.deepEqual(ORDER.map((id) => [op[id].node.parent, op[id].after]), [
    ['p1', null], [nid.hf, null], [nid.hf, nid.ht], [nid.hf, nid.hr], [nid.hf, nid.hv],
    ['p1', nid.hf], [nid.hc, null], ['p1', nid.hc], ['p1', nid.hi],
  ], 'parents and afters');
  assert.deepEqual(Object.keys(op.hi.node).sort(), ['id', 'name', 'parent', 'type'], 'hi pasted as a frame: no component, variant, props or overrides');
  assert.deepEqual(nodeless(op.him.node), { type: 'rect', parent: nid.hf, name: H.nodes.him.name, fill: '#d9d9d9' }, 'him pasted as a rect, no src');
  assert.equal(op.hr.node.fill, '#ff0000', "hr's fill: the clip's color.brand");
  assert.deepEqual(op.hc.node.variants, { loud: { [nid.hct]: { text: H.nodes.hct.text } } }, "hc's variant keyed by hct's copy");
  assert.deepEqual(op.hc.node.props, { label: { ...H.nodes.hc.props.label, target: { id: nid.hct, prop: 'text' } } }, "hc's prop aimed at hct's copy");
  assert.equal(op.hv.node.path, H.nodes.hv.path);
  for (const id of ORDER) assert.equal(op[id].node.name, H.nodes[id].name, `${id}'s name exactly`);
  for (const id of ['ht', 'hct']) assert.equal(op[id].node.text, H.nodes[id].text, `${id}'s text exactly`);
  await accepted(rec, n0);
  await allSaved(p);
  assert.deepEqual(docErrors(fake.doc('minimal'), { images: null }), [], "the fake's document valid");
  // (a)
  const img = `${origin}/api/canvas/image/minimal/${IMG_FILE}`;
  assert.equal(rec.requests.filter((u) => u === img).length, 1, 'the image asked for once');
  const allowed = [`${origin}/view/canvas/minimal`, `${origin}/api/canvas/doc?slug=minimal`, img, `${origin}/favicon.ico`];
  assert.deepEqual([...rec.urls].filter((u) => !allowed.includes(u)), [], `no other request (saw ${[...rec.urls].join(' ')})`);
  // (c)
  await toastSays(p, `${PASTE_SAY.frames} ${PASTE_SAY.rects}`);
  // (d)
  await sleep(300);
  await ranNothing(p, rec, 'after the paste');
  const rows = await rowNames(p);
  assert.deepEqual(rows.map(([id]) => id), ORDER.map((id) => nid[id]), 'every copy has its row');
  for (const [id, name] of rows) assert.equal(name, H.nodes.hf.name, `${id}'s Layers row shows the name as text`);
  noDialogs(rec);
  noExceptions(rec);
});

test('C1.5 not a canvas', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const n0 = edits(rec).length;
  const clipOf = (nodes, children = Object.keys(nodes)) => ({ canvas: 1, rev: 0, tokens: {}, pages: [{ id: 'p-main', name: 'Checkout', children }], nodes });
  const badge = { ...EVERY.nodes.badge, parent: 'p-main' };
  const notClips = [
    'hello', '{"canvas":1}', '[]', 'null',
    JSON.stringify({ ...clipOf({ badge }), extra: 1 }), // a key the top doesn't have
    JSON.stringify(clipOf({ badge: { ...badge, id: 'badge' } })), // a node holding an id key
    JSON.stringify(clipOf({ badge }, [])), // a node no page lists
    JSON.stringify(clipOf({ badge: { ...badge, type: 'star' } })), // an unknown type
    JSON.stringify(clipOf({ 'a.b': { ...badge } }, ['a.b'])), // an id out of form
    JSON.stringify(clipOf({ c1: { type: 'component', parent: 'p-main', children: ['c2'] }, c2: { type: 'component', parent: 'c1', children: [] } }, ['c1'])), // a component in a component
  ];
  for (const s of notClips) {
    await hideToast(p);
    await pasteText(p, s);
    await toastSays(p, PASTE_SAY.notClip);
  }
  await sendsNothing(rec, n0, 'pastes that are not a canvas');
  await hideToast(p);
  await pasteText(p, JSON.stringify(clipOf({ badge: { ...badge, fill: 'url(x)' } })));
  const e = await nextEdit(rec, n0);
  assert.equal(e.ops.length, 1, `one add: ${JSON.stringify(e.ops)}`);
  assert.deepEqual({ ...e.ops[0], node: nodeless(e.ops[0].node) }, { op: 'add', node: { type: 'rect', parent: 'p-main', name: 'Badge', x: 12, y: -8, size: { w: 24, h: 24 }, radius: 12 }, after: 'tiles' }, 'badge pasted without its fill');
  await toastSays(p, PASTE_SAY.values);
  await accepted(rec, n0);
  noDialogs(rec);
  noExceptions(rec);
});

test('C1.6 a paste over 64 KB is refused', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const clip = { canvas: 1, rev: 0, tokens: {}, pages: [{ id: 'q', name: 'Q', children: [] }], nodes: {} };
  for (let i = 1; i <= 1500; i++) {
    clip.nodes[`n${i}`] = { type: 'rect', parent: 'q', name: `Rect ${String(i).padStart(25, '0')}`, x: (i % 40) * 10, y: Math.floor(i / 40) * 10, size: { w: 4, h: 4 }, fill: '#d9d9d9' };
    clip.pages[0].children.push(`n${i}`);
  }
  clip.nodes.img = { type: 'image', parent: 'q', name: 'Image', src: `images/${IMG_FILE}` };
  clip.pages[0].children.push('img');
  assert.equal(clip.nodes.n1.name.length, 30);
  assert.deepEqual(docErrors(clip, { images: null }), [], 'the clip is a valid document');
  const { p, rec } = await open(t, { canvases: { minimal: MINIMAL } });
  await live(p);
  const n0 = edits(rec).length;
  const r0 = rec.requests.length;
  await pasteText(p, JSON.stringify(clip));
  await toastSays(p, PASTE_SAY.tooMuch);
  await sendsNothing(rec, n0, 'the paste over 64 KB');
  assert.deepEqual(rec.requests.slice(r0).filter((u) => u.includes('/api/canvas/image/')), [], 'no image asked for');
  noDialogs(rec);
  noExceptions(rec);
});

test('C1.7 copy writes a canvas-doc@1 document', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await selectRow(p, 'loose');
  const clip = JSON.parse(await clipNow(p));
  assert.deepEqual(docErrors(clip, { images: null }), [], 'a valid document');
  assert.deepEqual(clip.pages, [{ id: 'p-main', name: 'Checkout', children: ['loose'] }], 'its one page');
  assert.deepEqual(Object.keys(clip.nodes).sort(), ['badge', 'loose'], 'loose and badge');
  assert.deepEqual([clip.nodes.loose, clip.nodes.badge], [EVERY.nodes.loose, EVERY.nodes.badge], 'as stored (loose drawn where it is stored)');
  assert.deepEqual([clip.canvas, clip.rev, clip.tokens], [1, 0, {}]);
  // a text in a column: drawn position and width, its tokens copied with their groups
  await selectRow(p, 'title');
  const at = await drawnAt(p, 'title');
  const c2 = JSON.parse(await clipNow(p));
  assert.deepEqual(docErrors(c2, { images: null }), [], 'a valid document');
  assert.deepEqual(c2.tokens, { type: { body: EVERY.tokens.type.body }, color: { ink: EVERY.tokens.color.ink } }, 'the tokens it names');
  assert.deepEqual(c2.nodes.title, { ...EVERY.nodes.title, parent: 'p-main', x: at.x, y: at.y, size: { w: at.w, h: 'hug' } }, 'title at its drawn place and width');
  // nothing selected: the browser's own copy
  await blurAll(p);
  await p.key('Escape');
  await waitRows(p, [], 'nothing selected');
  assert.equal(await clipNow(p), '', 'no clip with nothing selected');
  noDialogs(rec);
  noExceptions(rec);
});

test("C1.8 in a field the paste is the field's", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await selectRow(p, 'title');
  await blurAll(p);
  await copyKey(p);
  assert.equal(await focusField(p, 'name'), true, 'the Name field focused');
  assert.equal(await clipNow(p), '', 'a copy in the field is the browser\'s');
  const n0 = edits(rec).length;
  await pasteKey(p);
  await sendsNothing(rec, n0, 'Ctrl+V in the Name field');
  assert.equal(await p.ev('document.activeElement?.dataset.prop ?? null'), 'name', 'the field still focused');
  noDialogs(rec);
  noExceptions(rec);
});

test('C1.9 an image this canvas has stays an image', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, origin, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await selectRow(p, 'photo');
  await blurAll(p);
  await copyKey(p);
  await hideToast(p);
  const r0 = rec.requests.length;
  const n0 = edits(rec).length;
  await pasteKey(p);
  const e = await nextEdit(rec, n0);
  assert.equal(e.ops.length, 1, `one add: ${JSON.stringify(e.ops)}`);
  assert.deepEqual([e.ops[0].op, e.ops[0].node.type, e.ops[0].node.src], ['add', 'image', `images/${IMG_FILE}`], 'an image');
  await accepted(rec, n0);
  await sleep(500);
  const img = `${origin}/api/canvas/image/every/${IMG_FILE}`;
  // The check is the one `fetch` of the image route. Chrome drops its in-memory copy of an image when
  // a fetch asks for the same URL (any cache mode, probed), so the pasted image's own drawing loads it
  // again as an Image request: counted apart, by the recorder's resource type (Chrome reports the
  // page's fetch as XHR or Fetch).
  // Ruling m-20261119-121523795: strict.
  const after = rec.requests.map((u, i) => [u, rec.kinds[i]]).slice(r0);
  assert.deepEqual(after.filter(([u]) => u !== img), [], `no request but for the image: ${JSON.stringify(after)}`);
  assert.equal(after.filter(([, k]) => k === 'Fetch' || k === 'XHR').length, 1, `the image checked once by fetch: ${JSON.stringify(after)}`);
  assert.ok(after.every(([, k]) => k === 'Fetch' || k === 'XHR' || k === 'Image'), `else only the drawing's loads: ${JSON.stringify(after)}`);
  assert.equal(await shownText(p, '#toast'), null, 'nothing said');
  noDialogs(rec);
  noExceptions(rec);
});

test('C1.10 hostile values outside free text are left out', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  // computed keys, so `__proto__` is an own key of each object, as JSON.parse makes it
  const nodes = {
    im1: { type: 'image', parent: 'q', name: 'Evil 1', src: 'https://evil.example/a.png' },
    im2: { type: 'image', parent: 'q', name: 'Evil 2', src: 'images/../../429be16d0a91e377.png' },
    im3: { type: 'image', parent: 'q', name: 'Evil 3', src: 'javascript:alert(1)' },
    r1: { type: 'rect', parent: 'q', name: 'Wrong ref', fill: { $ref: 'space.m' }, radius: { $ref: 'color.brand' }, ['__proto__']: { polluted: 1 } },
    i1: {
      type: 'instance', parent: 'q', name: 'Inst', component: 'button',
      props: { label: 'Hi', constructor: 'x', ['__proto__']: 'y' },
      overrides: { 'button-label': { text: 'ok', name: 'X', bogus: 1, 'layout.gap': 4 }, ['__proto__']: { visible: false }, constructor: { visible: false } },
    },
    ['__proto__']: { type: 'rect', parent: 'q', name: 'Proto', x: 1, y: 2 },
  };
  const order = ['im1', 'im2', 'im3', 'r1', 'i1', '__proto__'];
  const clip = { canvas: 1, rev: 0, tokens: {}, pages: [{ id: 'q', name: 'Q', children: order }], nodes };
  const s = JSON.stringify(clip);
  assert.ok(s.includes('"__proto__":{"type":"rect"'), 'the clip text holds a __proto__ node');
  await hideToast(p);
  const r0 = rec.requests.length;
  const n0 = edits(rec).length;
  await pasteText(p, s);
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops.map((o) => [o.op, o.node.type, o.node.name]), [['add', 'rect', 'Wrong ref'], ['add', 'instance', 'Inst'], ['add', 'rect', 'Proto']], 'the images with a src outside images/ left out');
  const [r1, i1, proto] = e.ops.map((o) => o.node);
  for (const nd of [r1, i1, proto]) assert.match(nd.id, NEW_ID, 'a new id');
  assert.deepEqual(nodeless(r1), { type: 'rect', parent: 'p-main', name: 'Wrong ref' }, 'refs of the wrong type and the __proto__ key left out');
  assert.deepEqual([i1.props, i1.overrides], [{ label: 'Hi' }, { 'button-label': { text: 'ok' } }], 'props and overrides the component lacks or the target cannot take left out');
  assert.deepEqual(nodeless(proto), { type: 'rect', parent: 'p-main', name: 'Proto', x: 1, y: 2 }, 'the __proto__ node pasted as a plain node, under a new id');
  assert.ok(!JSON.stringify(e.ops).includes('__proto__') && !JSON.stringify(e.ops).includes('constructor') && !JSON.stringify(e.ops).includes('polluted'), 'no __proto__, constructor or polluted in what is sent');
  await toastSays(p, PASTE_SAY.values);
  await accepted(rec, n0);
  assert.equal(await p.ev("Object.keys(Object.prototype).length === 0 && ({}).polluted === undefined && ({}).type === undefined && ({}).visible === undefined"), true, 'Object.prototype untouched');
  assert.deepEqual(rec.requests.slice(r0), [], 'nothing loaded');
  noDialogs(rec);
  noExceptions(rec);
});

// The paste's own time on the page: the dispatch of the paste event to its return, then until #toast says `words`.
const pasteTimed = (p, s) => p.ev(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(s)}); const t0 = performance.now(); document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return performance.now() - t0; })()`);

test('C1.11 a deep or wide hostile clip is refused or handled at once', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const N = 20000;
  // the review's clip: a component holding a chain of 19999 frames, a variant naming every one
  const deep = { canvas: 1, rev: 0, tokens: {}, pages: [{ id: 'pg', name: 'P', children: ['c'] }], nodes: {} };
  deep.nodes.c = { type: 'component', parent: 'pg', children: ['n0'], variants: { v: {} } };
  for (let i = 0; i < N - 1; i++) {
    deep.nodes[`n${i}`] = { type: 'frame', parent: i ? `n${i - 1}` : 'c', children: i < N - 2 ? [`n${i + 1}`] : [] };
    deep.nodes.c.variants.v[`n${i}`] = { visible: false };
  }
  // the same nodes side by side: depth 2, so it is built, and refused only by its size
  const wide = { canvas: 1, rev: 0, tokens: {}, pages: [{ id: 'pg', name: 'P', children: ['c'] }], nodes: {} };
  wide.nodes.c = { type: 'component', parent: 'pg', children: [], variants: { v: {} } };
  for (let i = 0; i < N - 1; i++) {
    wide.nodes[`n${i}`] = { type: 'frame', parent: 'c', children: [] };
    wide.nodes.c.children.push(`n${i}`);
    wide.nodes.c.variants.v[`n${i}`] = { visible: false };
  }
  const { p, rec } = await open(t, { canvases: { minimal: MINIMAL } });
  await live(p);
  const n0 = edits(rec).length;
  for (const [what, clip, words] of [['deep', deep, PASTE_SAY.notClip], ['wide', wide, PASTE_SAY.tooMuch]]) {
    await hideToast(p);
    const ms = await pasteTimed(p, JSON.stringify(clip));
    assert.ok(ms < 2000, `${what}: the paste took ${Math.round(ms)} ms, under 2 s`);
    await toastSays(p, words);
  }
  await sendsNothing(rec, n0, 'the deep and wide pastes');
  noDialogs(rec);
  noExceptions(rec);
});
