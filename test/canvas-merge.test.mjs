// kit-653: canvas.mjs's merge(base, copy, now): the supervisor's working copy merged three ways against
// the base it checked out, into canvas@1 ops that apply to the canvas as it is now (spec
// project/tickets/kit-653-canvas-merge/spec.md, C1 to C16). Names start `canvas merge:`, never the
// design's measured `canvas A<n>:` (contract §13).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { merge, normalDoc, apply, validate } from '../docs/devteam/scripts/canvas.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures', 'canvas');
const IMAGES = new Set(fs.readdirSync(path.join(fixtures, 'images')));
const load = (name) => JSON.parse(fs.readFileSync(path.join(fixtures, name), 'utf8'));
const EVERY = load('doc-every-type.json');
const MINIMAL = load('doc-minimal.json');

function freezeDeep(x) {
  const stack = [x];
  while (stack.length) {
    const v = stack.pop();
    if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) stack.push(v[k]); }
  }
  return x;
}
const frozen = (x) => freezeDeep(structuredClone(x));

// Applies ops that must apply; the new document.
function edit(doc, ops) {
  const r = apply(doc, ops, { maxOpsBytes: null });
  assert.equal(r.why, null, `edit refused ${r.why}: ${JSON.stringify(ops).slice(0, 400)}`);
  return r.doc;
}
// The document `ops` make of `doc` (an empty list leaves it as it is: apply refuses an empty edit).
function after(doc, ops) {
  if (ops.length === 0) return doc;
  return edit(doc, ops);
}
// Applying `ops` to `doc` gives `want` by effective value (the spec's normal form).
function gives(doc, ops, want, msg = '') {
  assert.deepEqual(normalDoc(after(doc, ops)), normalDoc(want), msg);
}
// merge on deep-frozen clones, so a mutation throws (C1), with the result's keys checked.
function mergeF(base, copy, now, opts) {
  const fz = (x) => (typeof x === 'string' ? x : frozen(x));
  const r = merge(fz(base), fz(copy), fz(now), opts);
  assert.deepEqual(Object.keys(r).sort(), ['ops', 'refused', 'skipped']);
  return r;
}
// A merge that must succeed with nothing skipped; its ops.
function opsOf(base, copy, now = base, opts) {
  const r = mergeF(base, copy, now, opts);
  assert.equal(r.refused, null, r.refused && r.refused.reason);
  return r;
}
const set = (id, prop, value) => ({ op: 'set', id, prop, value });

// ---- T1: refusals, the normal form, tokens and properties ----

test('canvas merge: exports merge and normalDoc; inputs are left as they were', () => {
  assert.equal(typeof merge, 'function');
  assert.equal(typeof normalDoc, 'function');
  const before = JSON.stringify(EVERY);
  const copy = edit(EVERY, [set('card', 'name', 'Card 2')]);
  const r = opsOf(EVERY, copy, EVERY);
  assert.equal(JSON.stringify(EVERY), before);
  assert.deepEqual(r.ops, [set('card', 'name', 'Card 2')]);
  // normalDoc itself never mutates either
  const f = frozen(EVERY);
  normalDoc(f);
});

test('canvas merge: no change gives no ops, by effective value', () => {
  const now = edit(EVERY, [set('title', 'text', 'A person typed this')]);
  for (const [base, copy, n] of [[EVERY, EVERY, EVERY], [EVERY, structuredClone(EVERY), now], [MINIMAL, MINIMAL, MINIMAL]]) {
    assert.deepEqual(opsOf(base, copy, n), { ops: [], skipped: [], refused: null });
  }
  // a copy differing only in its normal form
  const c = structuredClone(EVERY);
  c.rev = 999;
  c.nodes.tiles.opacity = 1; // a default written
  c.nodes.tiles.size = {}; // an empty group
  c.nodes.button.variants = { ...c.nodes.button.variants, quiet: { ...c.nodes.button.variants.quiet, 'button-label': {} } }; // an empty override id map
  c.nodes.tiles.layout = { ...c.nodes.tiles.layout, wrap: false }; // a default inside a group
  assert.deepEqual(validate(c, { images: IMAGES }), []);
  assert.deepEqual(opsOf(EVERY, c, EVERY), { ops: [], skipped: [], refused: null });
  // a stored default in base, absent in copy: no op
  const base3 = edit(EVERY, [set('tiles', 'opacity', 1), set('tiles', 'layout.gap', 0)]);
  const copy3 = structuredClone(base3);
  delete copy3.nodes.tiles.opacity;
  delete copy3.nodes.tiles.layout.gap;
  assert.deepEqual(opsOf(base3, copy3, base3).ops, []);
  // props: {} on an instance with none, against none
  const base4 = edit(MINIMAL, [{ op: 'add', node: { id: 'f', type: 'frame', parent: 'p1' }, after: null }]);
  const copy4 = structuredClone(base4);
  copy4.nodes.f.layout = {};
  assert.deepEqual(opsOf(base4, copy4, base4).ops, []);
});

test('canvas merge: a changed property becomes one set at its path', () => {
  const cases = [
    [set('card', 'layout.gap', 24)],
    [set('title', 'font', { family: 'mono', size: 12, weight: 700, lineHeight: 1.2 })],
    [set('title', 'text', 'New title')],
    [set('rule', 'radius', 8)],
    [set('dot', 'fill', '#ff0000')],
    [set('icon', 'path', 'M0 0 L10 10')],
    [set('photo', 'fit', 'contain')],
    [set('buy', 'variant', null)],
    [set('button', 'clip', false)],
    [set('p-main', 'name', 'Checkout 2')],
    [set('card', 'size.w', 'fill')],
    [set('buy', 'overrides.button-label.text', 'Changed')],
    [set('buy', 'props.label', 'Pay')],
    [set('button', 'props.label', { type: 'text', default: 'Go', target: { id: 'button-label', prop: 'text' } })],
    [set('button', 'variants.primary.button-bg.fill', '#000000')],
    [set('button', 'variants.loud', { 'button-bg': { fill: '#ff0000' } })],
    [set('button', 'variants.quiet', null)],
    [set('card', 'figma', null)],
  ];
  for (const ops of cases) {
    const copy = edit(EVERY, ops);
    const r = opsOf(EVERY, copy);
    assert.deepEqual(r.ops, ops, JSON.stringify(ops));
    assert.deepEqual(r.skipped, []);
    gives(EVERY, r.ops, copy);
  }
});

test('canvas merge: a property the copy dropped is set to its default, or removed when it has none', () => {
  const copy = structuredClone(EVERY);
  delete copy.nodes.card.name;
  delete copy.nodes.card.clip;
  delete copy.nodes.card.figma;
  delete copy.nodes.card.layout.gap;
  delete copy.nodes.buy.props.label;
  delete copy.nodes.buy.overrides['button-bg'].fill;
  assert.deepEqual(validate(copy, { images: IMAGES }), []);
  const r = opsOf(EVERY, copy);
  const byPath = Object.fromEntries(r.ops.map((o) => [`${o.id}:${o.prop}`, o.value]));
  assert.deepEqual(byPath, {
    'card:name': '', 'card:clip': false, 'card:figma': null, 'card:layout.gap': 0,
    'buy:props.label': null, 'buy:overrides.button-bg.fill': null,
  });
  assert.ok(r.ops.every((o) => o.op === 'set'));
  gives(EVERY, r.ops, copy);
});

test('canvas merge: a token added, changed or removed becomes a token op', () => {
  const tok = (v) => ({ $type: 'dimension', $value: { value: v, unit: 'px' } });
  const base1 = edit(EVERY, [{ op: 'token', path: 'extra.one', value: tok(9) }]);
  const copy = structuredClone(base1);
  copy.tokens.space.l = tok(32);
  copy.tokens.space.s = tok(6);
  delete copy.tokens.extra;
  const r = opsOf(base1, copy);
  assert.deepEqual(r.ops, [
    { op: 'token', path: 'extra.one', value: null },
    { op: 'token', path: 'space.l', value: tok(32) },
    { op: 'token', path: 'space.s', value: tok(6) },
  ]);
  gives(base1, r.ops, copy);
  // a token turned into a group, and a group into a token
  const base = edit(MINIMAL, [{ op: 'token', path: 'a.b', value: tok(1) }, { op: 'token', path: 'g.x', value: tok(2) }, { op: 'token', path: 'g.y', value: tok(3) }]);
  const c2 = structuredClone(base);
  c2.tokens.a.b = { c: tok(4) };
  c2.tokens.g = tok(5);
  const r2 = opsOf(base, c2);
  assert.deepEqual(r2.ops.filter((o) => o.value === null).map((o) => o.path), ['a.b', 'g.x', 'g.y']);
  gives(base, r2.ops, c2);
});

test('canvas merge: a copy that does not parse is refused with the reason', () => {
  for (const text of ['{"canvas": 1,', '']) {
    const r = mergeF(EVERY, text, EVERY);
    assert.deepEqual(r.ops, []);
    assert.deepEqual(r.skipped, []);
    assert.match(r.refused.reason, /^the copy does not parse: /);
    assert.deepEqual(r.refused.errors, []);
  }
  const r = mergeF(EVERY, 'null', EVERY);
  assert.match(r.refused.reason, /^the copy breaks canvas-doc@1: top/);
  assert.deepEqual(r.ops, []);
});

test('canvas merge: a copy that breaks canvas-doc@1 is refused with validate\'s errors', () => {
  const broken = [];
  let c = structuredClone(EVERY); c.nodes.tiles['layout.gap'] = 4; broken.push(['keys', c]);
  c = structuredClone(EVERY); c.nodes.tiles.type = 'blob'; broken.push(['node-shape', c]);
  c = structuredClone(EVERY); c.pages[0].children = c.pages[0].children.filter((x) => x !== 'tiles'); broken.push(['tree', c]);
  c = structuredClone(EVERY); c.nodes.card.opacity = 7; broken.push(['classes', c]);
  c = structuredClone(EVERY); c.nodes.photo.src = 'images/0000000000000000.png'; broken.push(['refs', c]);
  for (const [rule, copy] of broken) {
    const r = mergeF(EVERY, copy, EVERY, { images: IMAGES });
    const errors = validate(copy, { images: IMAGES });
    assert.equal(errors[0].rule, rule);
    assert.deepEqual(r.ops, []);
    assert.ok(r.refused.reason.startsWith(`the copy breaks canvas-doc@1: ${rule}`), r.refused.reason);
    assert.deepEqual(r.refused.errors, errors);
    // as JSON text, the same
    assert.deepEqual(mergeF(EVERY, JSON.stringify(copy), EVERY, { images: IMAGES }).refused, r.refused);
  }
  // the image check only when images are given
  const img = broken[4][1];
  assert.equal(mergeF(EVERY, img, EVERY).refused, null);
  // a good copy as text and as a document merge alike
  const good = edit(EVERY, [set('card', 'name', 'X')]);
  assert.deepEqual(mergeF(EVERY, JSON.stringify(good), EVERY), mergeF(EVERY, good, EVERY));
});

test('canvas merge: a bad base, a malformed live canvas and a changed kind are refused', () => {
  let r = mergeF('{', EVERY, EVERY);
  assert.match(r.refused.reason, /^the base does not parse: /);
  const badBase = structuredClone(EVERY); badBase.nodes.card.opacity = 9;
  r = mergeF(badBase, EVERY, EVERY);
  assert.match(r.refused.reason, /^the base breaks canvas-doc@1: classes/);
  assert.deepEqual(r.refused.errors, validate(badBase, { images: null }));
  // the base is judged without the image check
  const imgBase = structuredClone(EVERY); imgBase.nodes.photo.src = 'images/0000000000000000.png';
  assert.equal(mergeF(imgBase, imgBase, EVERY, { images: IMAGES }).refused.reason.startsWith('the copy'), true);
  assert.equal(mergeF(imgBase, EVERY, EVERY, { images: IMAGES }).refused, null);
  for (const now of [{}, (() => { const d = structuredClone(EVERY); d.nodes.card = 5; return d; })()]) {
    r = mergeF(EVERY, EVERY, now);
    assert.equal(r.refused.reason, 'the live canvas is malformed');
    assert.deepEqual(r.ops, []);
  }
  // a rect retyped as an ellipse
  const retyped = structuredClone(EVERY);
  retyped.nodes.rule = { type: 'ellipse', parent: 'card' };
  r = mergeF(EVERY, retyped, EVERY);
  assert.equal(r.refused.reason, 'node rule changed type from rect to ellipse: give the new node a new id');
  assert.deepEqual(r.ops, []);
  // a page id made a node id
  const base = edit(MINIMAL, [{ op: 'add', node: { id: 'p2', type: 'page', parent: null, name: 'Two' }, after: 'p1' }]);
  const pageToNode = structuredClone(MINIMAL);
  pageToNode.nodes.p2 = { type: 'rect', parent: 'p1' };
  pageToNode.pages[0].children = ['p2'];
  r = mergeF(base, pageToNode, base);
  assert.equal(r.refused.reason, 'node p2 changed type from page to rect: give the new node a new id');
});
