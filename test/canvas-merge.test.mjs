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
