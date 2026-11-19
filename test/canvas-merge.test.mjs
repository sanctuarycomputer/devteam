// kit-653: canvas.mjs's merge(base, copy, now): the supervisor's working copy merged three ways against
// the base it checked out, into canvas@1 ops that apply to the canvas as it is now (spec
// project/tickets/kit-653-canvas-merge/spec.md, C1 to C16). Names start `canvas merge:`, never the
// design's measured `canvas A<n>:` (contract §13).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { merge, normalDoc, apply, validate, PROPS } from '../docs/devteam/scripts/canvas.mjs';

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
  // an empty layout group, against none
  const base4 = edit(MINIMAL, [{ op: 'add', node: { id: 'f', type: 'frame', parent: 'p1' }, after: null }]);
  const copy4 = structuredClone(base4);
  copy4.nodes.f.layout = {};
  assert.deepEqual(opsOf(base4, copy4, base4).ops, []);
  // props: {} and overrides: {} on an instance with none, against none
  const base5 = edit(EVERY, [{ op: 'add', node: { id: 'inst2', type: 'instance', parent: 'tiles', component: 'button' }, after: null }]);
  const copy5 = structuredClone(base5);
  copy5.nodes.inst2.props = {};
  copy5.nodes.inst2.overrides = { 'button-bg': {} };
  assert.deepEqual(validate(copy5, { images: IMAGES }), []);
  assert.deepEqual(opsOf(base5, copy5, base5).ops, []);
  // normalDoc drops exactly these: defaults, empty groups, empty id maps, empty maps, rev
  assert.deepEqual(normalDoc(c), normalDoc(EVERY));
  assert.deepEqual(normalDoc(copy5), normalDoc(base5));
  assert.deepEqual(normalDoc(copy4), normalDoc(base4));
  assert.equal(normalDoc(c).rev, 0);
  assert.equal('size' in normalDoc(c).nodes.tiles, false);
  assert.equal('button-label' in normalDoc(c).nodes.button.variants.quiet, false);
  assert.equal('props' in normalDoc(copy5).nodes.inst2, false);
  assert.equal('overrides' in normalDoc(copy5).nodes.inst2, false);
  assert.equal('layout' in normalDoc(copy4).nodes.f, false);
  assert.equal('opacity' in normalDoc(c).nodes.tiles, false);
  // a value with its keys in another order is the same value
  const base6 = edit(EVERY, [set('title', 'font', { family: 'sans', size: 14, weight: 400, lineHeight: 1.5 })]);
  const copy6 = structuredClone(base6);
  copy6.nodes.title.font = { lineHeight: 1.5, weight: 400, size: 14, family: 'sans' };
  assert.deepEqual(opsOf(base6, copy6, base6).ops, []);
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
  assert.deepEqual(r2.ops, [
    { op: 'token', path: 'a.b', value: null }, { op: 'token', path: 'g.x', value: null }, { op: 'token', path: 'g.y', value: null },
    { op: 'token', path: 'a.b.c', value: tok(4) }, { op: 'token', path: 'g', value: tok(5) },
  ]);
  // removals deepest first
  const base7 = edit(MINIMAL, [{ op: 'token', path: 'z', value: tok(1) }, { op: 'token', path: 'a.b.c', value: tok(2) }]);
  const copy7 = structuredClone(base7); copy7.tokens = {};
  assert.deepEqual(opsOf(base7, copy7).ops.map((o) => o.path), ['a.b.c', 'z']);
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
  // the reason names the first error's rule, where and message
  const e0 = validate(broken[3][1], { images: IMAGES })[0];
  assert.equal(mergeF(EVERY, broken[3][1], EVERY).refused.reason, `the copy breaks canvas-doc@1: ${e0.rule} at ${e0.where}: ${e0.message}`);
  // what no document is (too deep to measure, a cycle) is refused, never thrown
  const deep = '['.repeat(100000) + ']'.repeat(100000);
  for (const bad of [deep, (() => { const x = structuredClone(EVERY); x.tokens.self = x; return x; })(), (() => { const x = structuredClone(EVERY); x.nodes.card.self = x; return x; })()]) {
    const r = merge(EVERY, bad, EVERY);
    assert.deepEqual(r.ops, []);
    assert.match(r.refused.reason, /^the copy breaks canvas-doc@1: /);
    assert.match(merge(bad, EVERY, EVERY).refused.reason, /^the base breaks canvas-doc@1: /);
  }
  // the image check only when images are given
  const img = broken[4][1];
  assert.equal(mergeF(EVERY, img, EVERY).refused, null);
  // a good copy as text and as a document merge alike
  const good = edit(EVERY, [set('card', 'name', 'X')]);
  assert.deepEqual(mergeF(EVERY, JSON.stringify(good), EVERY), mergeF(EVERY, good, EVERY));
});

const broken0 = () => { const c = structuredClone(EVERY); c.nodes.card.opacity = 7; return c; };
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
  // the order: base, then copy, then the live canvas
  assert.match(mergeF('{', '{', {}).refused.reason, /^the base does not parse/);
  assert.match(mergeF(EVERY, '{', {}).refused.reason, /^the copy does not parse/);
  assert.match(mergeF(EVERY, broken0(), {}).refused.reason, /^the copy breaks/);
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

// ---- T2: children lists, the model, skipped, rescue ----

const add = (id, type, parent, afterId = null, props = {}) => ({ op: 'add', node: { id, type, parent, ...props }, after: afterId });
const mv = (id, parent, afterId) => ({ op: 'move', id, parent, after: afterId });
const del = (id) => ({ op: 'del', id });
// p1 holds frames f (rects a, b, c, d) and g (empty); pages p1, p2, p3.
const LISTS = edit(MINIMAL, [
  add('p2', 'page', null, 'p1', { name: 'Two' }), add('p3', 'page', null, 'p2', { name: 'Three' }),
  add('f', 'frame', 'p1'), add('g', 'frame', 'p1', 'f'),
  add('a', 'rect', 'f'), add('b', 'rect', 'f', 'a'), add('c', 'rect', 'f', 'b'), add('d', 'rect', 'f', 'c'),
]);
const kids = (doc, id) => (doc.nodes[id] ? doc.nodes[id].children : doc.pages.find((p) => p.id === id).children);

test('canvas merge: children lists merge as inserts, removals and moves', () => {
  const cases = [
    // [what the copy did, the exact ops merge must write]
    [[add('x', 'rect', 'f')], [add('x', 'rect', 'f')]],
    [[add('x', 'rect', 'f', 'b')], [add('x', 'rect', 'f', 'b')]],
    [[add('x', 'rect', 'f', 'd')], [add('x', 'rect', 'f', 'd')]],
    [[del('c')], [del('c')]],
    [[mv('c', 'f', 'a')], [mv('c', 'f', 'a')]], // [a, c, b, d]
    [[mv('d', 'f', null)], [mv('d', 'f', null)]], // [d, a, b, c]
    [[mv('a', 'f', 'd')], [mv('a', 'f', 'd')]], // [b, c, d, a]
    [[mv('c', 'f', null), mv('d', 'f', 'c')], [mv('c', 'f', null), mv('d', 'f', 'c')]], // [c, d, a, b]
    [[mv('b', 'g', null)], [mv('b', 'g', null)]],
    [[add('x', 'frame', 'g'), add('y', 'rect', 'x'), add('z', 'rect', 'x', 'y')], [add('x', 'frame', 'g'), add('y', 'rect', 'x'), add('z', 'rect', 'x', 'y')]],
    [[add('p4', 'page', null, 'p1', { name: 'Four' })], [add('p4', 'page', null, 'p1', { name: 'Four' })]],
    [[del('p2')], [del('p2')]],
    [[mv('p3', null, null)], [mv('p3', null, null)]],
    [[mv('g', 'f', 'b')], [mv('g', 'f', 'b')]], // a frame from a page into a frame
  ];
  for (const [did, want] of cases) {
    const copy = edit(LISTS, did);
    const r = opsOf(LISTS, copy);
    assert.deepEqual(r.ops, want, JSON.stringify(did));
    gives(LISTS, r.ops, copy, JSON.stringify(did));
  }
  // two frames swapping nesting: X held Y, now Y holds X
  const base = edit(LISTS, [add('X', 'frame', 'p1'), add('Y', 'frame', 'X'), add('k', 'rect', 'Y')]);
  const copy = edit(base, [mv('Y', 'p1', null), mv('X', 'Y', null)]);
  const r = opsOf(base, copy);
  gives(base, r.ops, copy);
  // a whole list reversed: one move per id but the one kept
  const rev = edit(LISTS, [mv('d', 'f', null), mv('c', 'f', 'd'), mv('b', 'f', 'c')]);
  assert.deepEqual(kids(rev, 'f'), ['d', 'c', 'b', 'a']);
  const rr = opsOf(LISTS, rev);
  assert.equal(rr.ops.length, 3);
  gives(LISTS, rr.ops, rev);
});

test('canvas merge: inserts and moves land by their neighbours among a person\'s list edits', () => {
  const B = edit(MINIMAL, [add('f', 'frame', 'p1'), add('a', 'rect', 'f'), add('b', 'rect', 'f', 'a'), add('c', 'rect', 'f', 'b')]);
  const run = (personOps, supOps) => {
    const now = edit(B, personOps), copy = edit(B, supOps);
    const r = opsOf(B, copy, now);
    assert.deepEqual(r.skipped, []);
    return kids(after(now, r.ops), 'f');
  };
  assert.deepEqual(run([add('p', 'rect', 'f', 'a')], [add('x', 'rect', 'f', 'a')]), ['a', 'x', 'p', 'b', 'c']);
  assert.deepEqual(run([del('b')], [add('x', 'rect', 'f', 'b')]), ['a', 'x', 'c']);
  assert.deepEqual(run([add('p', 'rect', 'f')], [add('x', 'rect', 'f')]), ['p', 'x', 'a', 'b', 'c']);
  assert.deepEqual(run([mv('c', 'f', null)], [set('a', 'name', 'A')]), ['c', 'a', 'b']);
  assert.deepEqual(run([add('p', 'rect', 'f', 'a')], [mv('a', 'f', 'c')]), ['p', 'b', 'c', 'a']);
});

test('canvas merge: on the same property or place, the supervisor wins', () => {
  const now = edit(LISTS, [set('f', 'layout.gap', 4), mv('b', 'g', null)]);
  const base = edit(LISTS, [add('h', 'frame', 'p1', 'g')]);
  const now2 = edit(base, [set('f', 'layout.gap', 4), mv('b', 'g', null)]);
  const copy = edit(base, [set('f', 'layout.gap', 8), mv('b', 'h', null)]);
  const r = opsOf(base, copy, now2);
  const out = after(now2, r.ops);
  assert.equal(out.nodes.f.layout.gap, 8);
  assert.equal(out.nodes.b.parent, 'h');
  assert.ok(now.nodes.b.parent === 'g');
});

test('canvas merge: a change a person\'s edit made impossible is skipped and listed', () => {
  // a node a person deleted, renamed in the copy
  let now = edit(LISTS, [del('c')]);
  let copy = edit(LISTS, [set('c', 'name', 'Sea')]);
  let r = opsOf(LISTS, copy, now);
  assert.deepEqual(r.ops, []);
  assert.deepEqual(r.skipped, [{ id: 'c', why: 'deleted' }]);
  // a child added under a frame a person deleted
  now = edit(LISTS, [del('g')]);
  copy = edit(LISTS, [add('x', 'rect', 'g'), set('a', 'name', 'A')]);
  r = opsOf(LISTS, copy, now);
  assert.deepEqual(r.ops, [set('a', 'name', 'A')]);
  assert.deepEqual(r.skipped, [{ id: 'x', why: 'parent-deleted' }]);
  edit(now, r.ops);
  // y moved under x by the copy, x moved under y by a person
  const base = edit(LISTS, [add('x', 'frame', 'p1'), add('y', 'frame', 'p1', 'x')]);
  now = edit(base, [mv('x', 'y', null)]);
  copy = edit(base, [mv('y', 'x', null)]);
  r = opsOf(base, copy, now);
  assert.deepEqual(r.ops, []);
  assert.deepEqual(r.skipped, [{ id: 'y', why: 'cycle' }]);
  // a moved node a person deleted
  now = edit(LISTS, [del('b')]);
  copy = edit(LISTS, [mv('b', 'g', null)]);
  r = opsOf(LISTS, copy, now);
  assert.deepEqual(r.ops, []);
  assert.deepEqual(r.skipped, [{ id: 'b', why: 'deleted' }]);
  // a page a person deleted, renamed in the copy
  now = edit(LISTS, [del('p3')]);
  copy = edit(LISTS, [set('p3', 'name', 'Drei')]);
  assert.deepEqual(opsOf(LISTS, copy, now).skipped, [{ id: 'p3', why: 'deleted' }]);
  // tokens: the copy changed a.b, a person made it a group; and the other way
  const tok = (v) => ({ $type: 'number', $value: v });
  const tb = edit(MINIMAL, [{ op: 'token', path: 'a.b', value: tok(1) }]);
  now = edit(tb, [{ op: 'token', path: 'a.b', value: null }, { op: 'token', path: 'a.b.c', value: tok(2) }]);
  copy = edit(tb, [{ op: 'token', path: 'a.b', value: tok(3) }]);
  r = opsOf(tb, copy, now);
  assert.deepEqual(r.ops, []);
  assert.deepEqual(r.skipped, [{ path: 'a.b', why: 'token-conflict' }]);
  const tg = edit(MINIMAL, [{ op: 'token', path: 'a.b.c', value: tok(1) }]);
  now = edit(tg, [{ op: 'token', path: 'a.b.d', value: tok(2) }]);
  copy = edit(tg, [{ op: 'token', path: 'a.b.c', value: null }, { op: 'token', path: 'a.b', value: tok(3) }]);
  r = opsOf(tg, copy, now);
  assert.deepEqual(r.ops, [{ op: 'token', path: 'a.b.c', value: null }]);
  assert.deepEqual(r.skipped, [{ path: 'a.b', why: 'token-conflict' }]);
  edit(now, r.ops);
});

test('canvas merge: a node the copy keeps is rescued from a frame or page the copy deletes', () => {
  // a person moved k into g; the copy deletes g
  let now = edit(LISTS, [mv('b', 'g', null)]);
  let copy = edit(LISTS, [del('g')]);
  let r = opsOf(LISTS, copy, now);
  let out = after(now, r.ops);
  assert.ok(out.nodes.b, 'b survives');
  assert.equal(out.nodes.b.parent, 'f');
  assert.deepEqual(kids(out, 'f'), ['a', 'b', 'c', 'd']);
  assert.equal(out.nodes.g, undefined);
  // a person moved g onto p3; the copy deletes p3
  now = edit(LISTS, [mv('g', 'p3', null)]);
  copy = edit(LISTS, [del('p3')]);
  r = opsOf(LISTS, copy, now);
  out = after(now, r.ops);
  assert.equal(out.nodes.g.parent, 'p1');
  assert.deepEqual(kids(out, 'p1'), ['f', 'g']);
  assert.equal(out.pages.length, 2);
});

test('canvas merge: a 20000-node list reversed merges in time', () => {
  const N = 19999;
  const base = structuredClone(MINIMAL);
  base.nodes.big = { type: 'frame', parent: 'p1', children: [] };
  base.pages[0].children = ['big'];
  for (let i = 0; i < N; i++) { const id = `n${i}`; base.nodes[id] = { type: 'rect', parent: 'big' }; base.nodes.big.children.push(id); }
  const copy = structuredClone(base);
  copy.nodes.big.children.reverse();
  const t0 = Date.now();
  const r = merge(base, copy, base);
  assert.ok(Date.now() - t0 < 10000, `merge took ${Date.now() - t0} ms`);
  assert.equal(r.refused, null);
  assert.equal(r.ops.length, N - 1);
  gives(base, r.ops, copy);
});

// ---- T3: generated copies, commuting edits, running twice ----

// A seeded generator: mulberry32, so every run makes the same cases.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, xs) => xs[Math.floor(rng() * xs.length)];

// Values per property path: every value doc-every-type stores at that path, the default, and a few more.
const POOL = new Map();
function poolAdd(p, v) { if (v === undefined) return; if (!POOL.has(p)) POOL.set(p, []); POOL.get(p).push(v); }
for (const type of Object.keys(PROPS)) for (const [p, def] of Object.entries(PROPS[type])) if (!p.includes('<')) poolAdd(p, def.default);
for (const n of Object.values(EVERY.nodes)) {
  for (const p of Object.keys(PROPS[n.type])) {
    if (p.includes('<')) continue;
    let v = n;
    for (const k of p.split('.')) v = v && typeof v === 'object' ? v[k] : undefined;
    poolAdd(p, v);
  }
}
for (const [p, vs] of Object.entries({
  name: ['A', 'Beta', 'x y'], text: ['Hello', 'Bye'], x: [3, -40], y: [7, 120], opacity: [0.5], 'size.w': [100, 'fill'], 'size.h': [44, 'fill'],
  'layout.gap': [2, 8], 'layout.mode': ['row', 'column', 'grid', 'none'], radius: [2, 12], fill: ['#ff0000', '#00ff00'], color: ['#123456'],
  'layout.padding': [[1, 2, 3, 4]], visible: [false, true], strokeWidth: [2],
})) for (const v of vs) poolAdd(p, v);
const TOKEN_VALUES = [
  { $type: 'number', $value: 2 }, { $type: 'number', $value: 3.5 }, { $type: 'dimension', $value: { value: 8, unit: 'px' } },
  { $type: 'color', $value: { colorSpace: 'srgb', components: [0.1, 0.2, 0.3] } }, { $type: 'fontWeight', $value: 600 },
];
const TOKEN_PATHS = ['t.a', 't.b', 't.g.x', 't.g.y', 't.g', 'u', 'space.xl', 'ratio.loose', 'constructor.k'];

// Every token path in a token tree, leaves and groups: [path, isToken].
function tokenPaths(tokens) {
  const out = [];
  const stack = [[tokens, '']];
  while (stack.length) {
    const [g, prefix] = stack.pop();
    for (const k of Object.keys(g)) {
      const p = prefix ? `${prefix}.${k}` : k;
      const isToken = Object.keys(g[k]).some((x) => x.startsWith('$'));
      out.push([p, isToken]);
      if (!isToken) stack.push([g[k], p]);
    }
  }
  return out;
}
const SRC = EVERY.nodes.photo.src;
// The forms the plain draw below rarely reaches (task-3 review T3-1): a token made a group and back,
// components, vectors and images added, `path`, `src` and `component` set, variant and override
// entries, new variants, whole maps with content, an empty group. An op list, or null.
function extraOps(doc, rng, tag, counter) {
  const nodeIds = Object.keys(doc.nodes);
  const of = (type) => nodeIds.filter((id) => doc.nodes[id].type === type);
  const pageIds = doc.pages.map((p) => p.id);
  const frames = [...pageIds, ...of('frame')];
  const comps = of('component');
  const kidOf = (c) => (doc.nodes[c].children.length ? pick(rng, doc.nodes[c].children) : null);
  const newId = () => `${tag}x${counter.n++}`;
  const tok = () => structuredClone(pick(rng, TOKEN_VALUES));
  switch (Math.floor(rng() * 12)) {
    case 0: { // a token made a group, or a group made a token
      const paths = tokenPaths(doc.tokens);
      if (!paths.length) return null;
      const [p, isToken] = pick(rng, paths);
      if (isToken) return [{ op: 'token', path: p, value: null }, { op: 'token', path: `${p}.sub`, value: tok() }];
      const leaves = paths.filter(([q, t]) => t && q.startsWith(`${p}.`)).map(([q]) => q).sort((a, b) => b.split('.').length - a.split('.').length);
      return [...leaves.map((q) => ({ op: 'token', path: q, value: null })), { op: 'token', path: p, value: tok() }];
    }
    case 1: { // a component with a child, a prop and a variant
      const c = newId(), t = `${c}t`;
      return [add(c, 'component', pick(rng, pageIds), null), add(t, 'text', c, null, { text: 'C' }),
        set(c, 'props.label', { type: 'text', default: 'Go', target: { id: t, prop: 'text' } }), set(c, 'variants.hot', { [t]: { color: '#ff0000' } })];
    }
    case 2: return [add(newId(), 'vector', pick(rng, frames), null, { path: pick(rng, ['M0 0 L10 10', 'M1 1 H5 V5 Z']) })];
    case 3: return [add(newId(), 'image', pick(rng, frames), null, { src: SRC, fit: 'contain' })];
    case 4: { const v = of('vector'); return v.length ? [set(pick(rng, v), 'path', pick(rng, ['M2 2 L3 3', 'm0 0 c1 1 2 2 3 3'])) ] : null; }
    case 5: { const v = of('image'); return v.length ? [set(pick(rng, v), 'src', SRC), set(pick(rng, v), 'fit', pick(rng, ['cover', 'fill']))] : null; }
    case 6: { // an instance pointed at another component
      const i = of('instance');
      return i.length && comps.length ? [set(pick(rng, i), 'variant', null), set(pick(rng, i), 'component', pick(rng, comps))] : null;
    }
    case 7: { // a variant's entry
      if (!comps.length) return null;
      const c = pick(rng, comps), d = kidOf(c);
      return d ? [set(c, `variants.${pick(rng, ['primary', 'quiet', 'v1', 'hot', 'vnew'])}.${d}.${pick(rng, ['opacity', 'visible'])}`, pick(rng, [0.5, false, null]))] : null;
    }
    case 8: { // a new variant, or a whole variants map
      if (!comps.length) return null;
      const c = pick(rng, comps), d = kidOf(c);
      if (!d) return null;
      return rng() < 0.5 ? [set(c, `variants.vn${counter.n++}`, { [d]: { opacity: 0.25 } })] : [set(c, 'variants', { solo: { [d]: { visible: false } } })];
    }
    case 9: { // an instance's override entry, or its whole overrides map
      const i = of('instance').filter((x) => doc.nodes[doc.nodes[x].component]);
      if (!i.length) return null;
      const x = pick(rng, i), d = kidOf(doc.nodes[x].component);
      if (!d) return null;
      return rng() < 0.5 ? [set(x, `overrides.${d}.${pick(rng, ['opacity', 'visible'])}`, pick(rng, [0.75, false, null]))] : [set(x, 'overrides', { [d]: { visible: false } })];
    }
    case 10: { // a whole props map with content
      if (!comps.length) return null;
      const c = pick(rng, comps), d = kidOf(c);
      return d ? [set(c, 'props', { shown: { type: 'bool', default: true, target: { id: d, prop: 'visible' } } })] : null;
    }
    default: return [add(newId(), 'frame', pick(rng, frames), null, { layout: {} })]; // an empty group
  }
}

// One random edit (an op list) that `apply` applies to `doc`, or null after many tries. `tag` prefixes new ids.
function randomOp(doc, rng, tag, counter) {
  const nodeIds = Object.keys(doc.nodes);
  const pageIds = doc.pages.map((p) => p.id);
  const containers = [...pageIds, ...nodeIds.filter((id) => ['frame', 'component'].includes(doc.nodes[id].type))];
  const listOf = (id) => (doc.nodes[id] ? doc.nodes[id].children : doc.pages.find((p) => p.id === id).children);
  const afterIn = (id) => { const l = listOf(id); return rng() < 0.3 || l.length === 0 ? null : pick(rng, l); };
  for (let tries = 0; tries < 60; tries++) {
    if (rng() < 0.3) {
      const extra = extraOps(doc, rng, tag, counter);
      if (!extra) continue;
      const r = apply(doc, extra, { maxOpsBytes: null });
      if (r.why === null) return { ops: extra, doc: r.doc };
      continue;
    }
    const k = rng();
    let op;
    if (k < 0.32 && nodeIds.length) {
      const id = pick(rng, nodeIds);
      const n = doc.nodes[id];
      const r = rng();
      if (n.type === 'instance' && r < 0.3) {
        const comp = doc.nodes[n.component];
        const desc = comp && comp.children.length ? pick(rng, comp.children) : null;
        const forms = [
          desc && ['overrides.' + desc + '.' + pick(rng, ['visible', 'opacity', 'name', 'text', 'fill']), pick(rng, [false, 0.4, 'Ov', '#abcdef', null])],
          ['props.' + pick(rng, Object.keys((comp && comp.props) || { label: 1 })), pick(rng, ['Pay', true, false, null])],
          ['variant', pick(rng, [null, ...Object.keys((comp && comp.variants) || {})])],
          ['overrides', {}],
        ].filter(Boolean);
        const [prop, value] = pick(rng, forms);
        op = set(id, prop, value);
      } else if (n.type === 'component' && r < 0.3) {
        const desc = n.children.length ? pick(rng, n.children) : 'none';
        const forms = [
          ['variants.' + pick(rng, ['v1', 'v2', 'primary', 'quiet']) + '.' + desc + '.' + pick(rng, ['visible', 'opacity', 'fill']), pick(rng, [false, 0.3, '#0000ff', null])],
          ['variants.' + pick(rng, ['v3', 'quiet']), pick(rng, [{}, null])],
          ['props.' + pick(rng, ['label', 'p2']), pick(rng, [null, { type: 'bool', default: true, target: { id: desc, prop: 'visible' } }])],
          ['props', {}],
        ];
        const [prop, value] = pick(rng, forms);
        op = set(id, prop, value);
      } else {
        const paths = Object.keys(PROPS[n.type]).filter((p) => !p.includes('<') && !['component', 'props', 'variants', 'overrides', 'path', 'src'].includes(p));
        const p = pick(rng, paths);
        op = set(id, p, structuredClone(pick(rng, POOL.get(p) || [null])));
      }
    } else if (k < 0.37) {
      op = set(pick(rng, pageIds), 'name', pick(rng, ['Pg', 'Page X', 'Ü']));
    } else if (k < 0.55) {
      const type = pick(rng, ['rect', 'ellipse', 'text', 'frame', 'frame', 'instance']);
      const id = rng() < 0.03 ? pick(rng, ['constructor', 'toString', '__proto__']) : `${tag}${counter.n++}`;
      const parent = pick(rng, containers);
      const props = type === 'instance' ? { component: pick(rng, nodeIds.filter((x) => doc.nodes[x].type === 'component').concat(['none'])) } : {};
      if (rng() < 0.5) props.name = pick(rng, ['N1', 'N2']);
      if (type === 'frame' && rng() < 0.5) props.layout = { mode: pick(rng, ['row', 'column']), gap: 4 };
      op = add(id, type, parent, afterIn(parent), props);
    } else if (k < 0.58) {
      op = add(`${tag}pg${counter.n++}`, 'page', null, rng() < 0.5 ? null : pick(rng, pageIds), { name: 'New page' });
    } else if (k < 0.68 && nodeIds.length) {
      op = del(pick(rng, nodeIds));
    } else if (k < 0.7) {
      op = del(pick(rng, pageIds));
    } else if (k < 0.85 && nodeIds.length) {
      const parent = pick(rng, containers);
      op = mv(pick(rng, nodeIds), parent, afterIn(parent));
    } else if (k < 0.88) {
      op = mv(pick(rng, pageIds), null, rng() < 0.5 ? null : pick(rng, pageIds));
    } else {
      op = { op: 'token', path: pick(rng, TOKEN_PATHS), value: rng() < 0.3 ? null : structuredClone(pick(rng, TOKEN_VALUES)) };
    }
    const r = apply(doc, [op], { maxOpsBytes: null });
    if (r.why === null) return { ops: [op], doc: r.doc };
  }
  return null;
}
function randomEdit(doc, rng, n, tag, counter) {
  const ops = [];
  let d = doc;
  for (let i = 0; i < n; i++) {
    const r = randomOp(d, rng, tag, counter);
    if (!r) break;
    ops.push(...r.ops);
    d = r.doc;
  }
  return { ops, doc: d };
}

// The wide base: 3 pages of 4 frames of 4 to 6 children, a nested frame per page, a component with a
// variant and a prop, two instances, 12 tokens.
function wideBase() {
  const ops = [add('p2', 'page', null, 'p1', { name: 'Two' }), add('p3', 'page', null, 'p2', { name: 'Three' })];
  const rng = prng(7);
  for (const pg of ['p1', 'p2', 'p3']) {
    let prevF = null;
    for (let f = 0; f < 4; f++) {
      const fid = `${pg}f${f}`;
      ops.push(add(fid, 'frame', pg, prevF, { layout: { mode: 'column', gap: 4 } }));
      prevF = fid;
      let prevC = null;
      const n = 4 + Math.floor(rng() * 3);
      for (let c = 0; c < n; c++) { const cid = `${fid}c${c}`; ops.push(add(cid, c % 2 ? 'text' : 'rect', fid, prevC, { name: cid })); prevC = cid; }
    }
    ops.push(add(`${pg}sub`, 'frame', `${pg}f0`, null), add(`${pg}sub1`, 'rect', `${pg}sub`, null), add(`${pg}sub2`, 'ellipse', `${pg}sub`, `${pg}sub1`));
  }
  ops.push(add('cmp', 'component', 'p3', null), add('cmp-t', 'text', 'cmp', null, { text: 'Label' }), add('cmp-b', 'rect', 'cmp', 'cmp-t'));
  ops.push(set('cmp', 'props.label', { type: 'text', default: 'Go', target: { id: 'cmp-t', prop: 'text' } }));
  ops.push(set('cmp', 'variants.v1', { 'cmp-b': { fill: '#ff0000' } }));
  ops.push(add('i1', 'instance', 'p1f1', null, { component: 'cmp', variant: 'v1' }), add('i2', 'instance', 'p2f2', null, { component: 'cmp', props: { label: 'Hi' } }));
  for (let t = 0; t < 10; t++) ops.push({ op: 'token', path: `w.g${t % 3}.k${t}`, value: TOKEN_VALUES[t % TOKEN_VALUES.length] });
  ops.push({ op: 'token', path: 'w.font.family', value: { $type: 'fontFamily', $value: 'mono' } });
  ops.push({ op: 'token', path: 'w.font.body', value: { $type: 'typography', $value: { fontFamily: 'serif', fontSize: { value: 14, unit: 'px' }, fontWeight: 400, letterSpacing: { value: 0, unit: 'px' }, lineHeight: 1.5 } } });
  return edit(MINIMAL, ops);
}
const BASES = [['doc-every-type', EVERY], ['wide', wideBase()]];

// What an op touches (spec C8), on the document it applies to.
function touchesOf(doc, ops) {
  const t = { nodes: new Set(), lists: new Set(), tokens: [] };
  const listKey = (id) => (id === null ? '#pages' : id);
  let d = doc;
  for (const op of ops) {
    const subtree = (root) => {
      const out = [];
      const stack = [root];
      while (stack.length) {
        const id = stack.pop();
        out.push(id);
        const n = d.nodes[id];
        const kids = n ? n.children : (d.pages.find((p) => p.id === id) || {}).children;
        if (kids) { t.lists.add(id); for (const k of kids) stack.push(k); }
      }
      return out;
    };
    const parentOf = (id) => (d.nodes[id] ? d.nodes[id].parent : null);
    if (op.op === 'set') t.nodes.add(op.id);
    else if (op.op === 'add') { t.nodes.add(op.node.id); t.lists.add(listKey(op.node.parent)); }
    else if (op.op === 'del') { for (const id of subtree(op.id)) t.nodes.add(id); t.lists.add(listKey(parentOf(op.id))); }
    else if (op.op === 'move') { t.nodes.add(op.id); t.lists.add(listKey(parentOf(op.id))); t.lists.add(listKey(op.parent)); }
    else if (op.op === 'token') t.tokens.push(op.path);
    d = edit(d, [op]);
  }
  return t;
}
function disjoint(a, b) {
  for (const id of a.nodes) if (b.nodes.has(id)) return false;
  for (const l of a.lists) if (b.lists.has(l)) return false;
  const near = (x, y) => x === y || x.startsWith(`${y}.`) || y.startsWith(`${x}.`);
  return !a.tokens.some((x) => b.tokens.some((y) => near(x, y)));
}

// Running twice is safe (C12): the ops again change nothing; a second merge against the result changes nothing.
// Replayed, a token removal whose path the same ops made run through a token (a token made a group, or
// a group a token) is refused by apply (contract §4: a path inside a token is `value`), so the replay
// leaves out removals of tokens the result doesn't hold; the second merge, which is what `take` run
// again does, gets no such exception.
const hasToken = (doc, p) => {
  let g = doc.tokens;
  for (const seg of p.split('.')) { if (!g || typeof g !== 'object' || !Object.hasOwn(g, seg)) return false; g = g[seg]; }
  return Object.keys(g).some((k) => k.startsWith('$'));
};
function twice(base, copy, result, ops, msg) {
  const replay = ops.filter((o) => !(o.op === 'token' && o.value === null && !hasToken(result, o.path)));
  const again = after(result, replay);
  assert.deepEqual(normalDoc(again), normalDoc(result), `${msg}: ops applied twice`);
  const r2 = opsOf(base, copy, result);
  assert.deepEqual(r2.skipped, [], `${msg}: a second merge skipped`);
  assert.deepEqual(normalDoc(after(result, r2.ops)), normalDoc(result), `${msg}: a second merge`);
}

// What the generated copies did, by form, so C7's coverage is checked, not hoped for (task-3 review T3-1).
const FORMS = {
  'token to group': (o, i, all) => o.op === 'token' && o.value === null && all.some((q) => q.op === 'token' && q.value && q.path.startsWith(`${o.path}.`)),
  'group to token': (o, i, all) => o.op === 'token' && o.value && all.some((q) => q.op === 'token' && q.value === null && q.path.startsWith(`${o.path}.`)),
  'token set': (o) => o.op === 'token' && o.value !== null,
  'token removed': (o) => o.op === 'token' && o.value === null,
  ...Object.fromEntries(['frame', 'text', 'rect', 'ellipse', 'vector', 'image', 'component', 'instance', 'page'].map((t) => [`add ${t}`, (o) => o.op === 'add' && o.node.type === t])),
  'add with an empty group': (o) => o.op === 'add' && o.node.layout && Object.keys(o.node.layout).length === 0,
  ...Object.fromEntries(['path', 'src', 'component', 'name', 'layout.gap', 'fill', 'font', 'variant'].map((p) => [`set ${p}`, (o) => o.op === 'set' && o.prop === p])),
  'set a variant entry': (o) => o.op === 'set' && /^variants\.[^.]+\.[^.]+\./.test(o.prop),
  'set a new variant': (o) => o.op === 'set' && /^variants\.[^.]+$/.test(o.prop) && o.value !== null,
  'set an override entry': (o) => o.op === 'set' && o.prop.startsWith('overrides.'),
  'set a prop entry': (o) => o.op === 'set' && o.prop.startsWith('props.'),
  'set a whole map with content': (o) => o.op === 'set' && ['props', 'variants', 'overrides'].includes(o.prop) && Object.keys(o.value).length > 0,
  'del': (o) => o.op === 'del', 'move': (o) => o.op === 'move' && o.parent !== null, 'move a page': (o) => o.op === 'move' && o.parent === null,
  'a prototype-like id': (o) => o.op === 'add' && ['constructor', 'toString', '__proto__'].includes(o.node.id),
};
test('canvas merge: merging a generated copy against its own base gives the copy (C7, C12)', () => {
  const seen = Object.fromEntries(Object.keys(FORMS).map((k) => [k, 0]));
  for (const [name, base] of BASES) {
    const rng = prng(name.length * 1000 + 11);
    for (let i = 0; i < 200; i++) {
      const counter = { n: 0 };
      const { ops: did, doc: copy } = randomEdit(base, rng, 1 + Math.floor(rng() * 12), 's', counter);
      did.forEach((o, j) => { for (const [k, is] of Object.entries(FORMS)) if (is(o, j, did)) seen[k]++; });
      const msg = `${name} case ${i}: ${JSON.stringify(did).slice(0, 1500)}`;
      const r = opsOf(base, copy, base);
      assert.deepEqual(r.skipped, [], msg);
      const out = after(base, r.ops);
      assert.deepEqual(normalDoc(out), normalDoc(copy), msg);
      twice(base, copy, out, r.ops, msg);
    }
  }
  for (const [k, n] of Object.entries(seen)) assert.ok(n > 0, `no generated copy did: ${k} (${JSON.stringify(seen)})`);
});

test('canvas merge: a person\'s edit to what the copy didn\'t change survives (C8, C12)', () => {
  for (const [name, base] of BASES) {
    const rng = prng(name.length * 1000 + 23);
    let kept = 0;
    for (let tries = 0; tries < 2000 && kept < 150; tries++) {
      const counter = { n: 0 };
      const person = randomEdit(base, rng, 1 + Math.floor(rng() * 6), 'h', counter);
      const sup = randomEdit(base, rng, 1 + Math.floor(rng() * 6), 's', counter);
      if (!person.ops.length || !sup.ops.length) continue;
      if (!disjoint(touchesOf(base, person.ops), touchesOf(base, sup.ops))) continue;
      const want = apply(sup.doc, person.ops, { maxOpsBytes: null });
      if (want.why !== null) continue;
      kept++;
      const msg = `${name} try ${tries}: person ${JSON.stringify(person.ops).slice(0, 800)} supervisor ${JSON.stringify(sup.ops).slice(0, 800)}`;
      const r = opsOf(base, sup.doc, person.doc);
      assert.deepEqual(r.skipped, [], msg);
      const out = after(person.doc, r.ops);
      assert.deepEqual(normalDoc(out), normalDoc(want.doc), msg);
      twice(base, sup.doc, out, r.ops, msg);
    }
    assert.ok(kept >= 150, `${name}: only ${kept} disjoint pairs`);
  }
});

test('canvas merge: subtrees, nested rescue, dropped children, ids already there (task-2 review)', () => {
  // a nested subtree deleted by one del
  const base = edit(LISTS, [add('x', 'frame', 'g'), add('y', 'frame', 'x'), add('z', 'rect', 'y')]);
  let copy = edit(base, [del('x')]);
  assert.deepEqual(opsOf(base, copy).ops, [del('x')]);
  // a kept node two levels under a deleted frame is rescued
  let now = edit(base, [mv('b', 'y', null)]);
  copy = edit(base, [del('x')]);
  let r = opsOf(base, copy, now);
  let out = after(now, r.ops);
  assert.equal(out.nodes.b.parent, 'f');
  assert.equal(out.nodes.x, undefined);
  // the children of a node dropped for a deleted parent are listed too
  now = edit(LISTS, [del('g')]);
  copy = edit(LISTS, [add('x', 'frame', 'g'), add('y', 'rect', 'x')]);
  r = opsOf(LISTS, copy, now);
  assert.deepEqual(r.ops, []);
  assert.deepEqual(r.skipped, [{ id: 'x', why: 'parent-deleted' }, { id: 'y', why: 'parent-deleted' }]);
  // a node the copy adds that is already there elsewhere (a person moved it after a first take): moved, then set
  copy = edit(LISTS, [add('x', 'rect', 'f', 'b', { name: 'X' })]);
  now = edit(copy, [mv('x', 'g', null)]);
  r = opsOf(LISTS, copy, now);
  out = after(now, r.ops);
  assert.deepEqual(kids(out, 'f'), ['a', 'b', 'x', 'c', 'd']);
  assert.deepEqual(kids(out, 'g'), []);
  // run again on its own result, a list whose right anchor's predecessor is still to be placed writes no move
  const b2 = edit(MINIMAL, [add('f', 'frame', 'p1'), add('r', 'rect', 'f'), add('y', 'rect', 'f', 'r')]);
  const c2 = edit(b2, [add('x', 'rect', 'f'), mv('y', 'f', 'x')]);
  assert.deepEqual(kids(c2, 'f'), ['x', 'y', 'r']);
  const first = opsOf(b2, c2);
  const res = after(b2, first.ops);
  assert.deepEqual(kids(res, 'f'), ['x', 'y', 'r']);
  assert.ok(opsOf(b2, c2, res).ops.every((o) => o.op !== 'move'));
  // and a right anchor's predecessor that step 6 deletes is passed over
  const b3 = edit(MINIMAL, [add('f', 'frame', 'p1'), add('t', 'rect', 'f'), add('r', 'rect', 'f', 't'), add('d', 'rect', 'f', 'r')]);
  const c3 = edit(b3, [del('t'), mv('d', 'f', null)]);
  const r3 = opsOf(b3, c3);
  assert.deepEqual(r3.ops[0], mv('d', 'f', null));
  // already in place: nothing moves
  r = opsOf(LISTS, copy, copy);
  assert.ok(r.ops.every((o) => o.op !== 'move'), JSON.stringify(r.ops));
});
