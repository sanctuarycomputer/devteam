// The canvas module (docs/devteam/scripts/canvas.mjs): canvas-doc@1's rules for production, held to
// the contract's fake (test/lib/canvas-fake.mjs), the reference. Its surface (exports, Node built-ins
// only, the tables), its own rules (a document outside apply's domain is refused `shape`, `images` as
// an array). Names start `canvas module:`, never the measure's; this file obeys contract §13's skip rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as fake from './lib/canvas-fake.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODULE_FILE = path.join(here, '..', 'docs', 'devteam', 'scripts', 'canvas.mjs');
const FIXTURES = path.join(here, 'fixtures', 'canvas');
const IMAGES_DIR = path.join(FIXTURES, 'images');
// The module, loaded on first use: a load failure fails each test that uses it, not the whole file,
// so the built-ins check (which reads the source) still fails on its own assertion.
let loading = null;
const load = () => (loading ??= import(pathToFileURL(MODULE_FILE).href));
const TABLES = ['TYPES', 'PROPS', 'CLASSES', 'TOKEN_TYPES', 'DOC_RULES', 'OPS', 'REFUSALS', 'LIMITS'];

// ---- helpers (shared with the differential and done-when tests) ----

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const fixture = (name) => readJson(path.join(FIXTURES, name));
const clone = (v) => structuredClone(v);
const imageNames = () => (fs.existsSync(IMAGES_DIR) ? fs.readdirSync(IMAGES_DIR).sort() : []);

function deepFreeze(root) {
  const stack = [root];
  while (stack.length) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object' || Object.isFrozen(v)) continue;
    Object.freeze(v);
    for (const k of Object.keys(v)) stack.push(v[k]);
  }
  return root;
}

// Every object reachable from `root` that isn't frozen, as paths; [] when deeply frozen.
function unfrozen(root, at = '') {
  const out = [];
  const stack = [[root, at]];
  const seen = new Set();
  while (stack.length) {
    const [v, w] = stack.pop();
    if (v === null || typeof v !== 'object' || seen.has(v)) continue;
    seen.add(v);
    if (!Object.isFrozen(v)) out.push(w || '(top)');
    for (const k of Object.keys(v)) stack.push([v[k], `${w}.${k}`]);
  }
  return out;
}

// Every module specifier a source names: static `import … from`, bare `import '…'`, dynamic
// `import('…')`, `export … from`; and whether it calls `require(`.
function specifiers(source) {
  const out = [];
  const forms = [
    /\bimport\s*\(\s*(['"`])([^'"`]*)\1/g,
    /\bimport\s+(['"])([^'"]*)\1/g,
    /\bimport\s+[^'"();]*?\bfrom\s*(['"])([^'"]*)\1/g,
    /\bexport\s+[^'"();]*?\bfrom\s*(['"])([^'"]*)\1/g,
  ];
  for (const rx of forms) for (const m of source.matchAll(rx)) out.push(m[2]);
  return { specs: out, requires: /\brequire\s*\(/.test(source) };
}

// A small document holding an image node, valid with its image in `images`.
const IMG = '0123456789abcdef.png';
function withImage() {
  return {
    canvas: 1,
    rev: 2,
    tokens: {},
    pages: [{ id: 'p1', name: 'Page 1', children: ['pic'] }],
    nodes: { pic: { type: 'image', parent: 'p1', src: `images/${IMG}` } },
  };
}
const addImage = (id, file) => ({ op: 'add', node: { id, type: 'image', parent: 'p1', src: `images/${file}` }, after: null });

// ---- surface ----

test('canvas module: exports', async () => {
  const canvas = await load();
  assert.equal(typeof canvas.validate, 'function', 'validate is exported');
  assert.equal(typeof canvas.apply, 'function', 'apply is exported');
  for (const t of TABLES) assert.ok(canvas[t] !== undefined && canvas[t] !== null, `${t} is exported`);
  assert.deepEqual(canvas.validate(fixture('doc-minimal.json')), [], 'the minimal document is valid');
  const r = canvas.apply(fixture('doc-minimal.json'), [{ op: 'set', id: 'p1', prop: 'name', value: 'Home' }]);
  assert.equal(r.why, null, 'a page rename applies');
  assert.equal(r.doc.pages[0].name, 'Home');
  assert.equal(r.doc.rev, 1);
});

test('canvas module: Node built-ins only', () => {
  // the scanner itself finds every form it must refuse
  const sample = [
    "import a from 'ws';",
    "import { b } from \"../x.mjs\";",
    "import * as c from 'node:fs';",
    "import './side.mjs';",
    "const d = await import('pkg');",
    "export { e } from '../../test/lib/canvas-fake.mjs';",
    "export * from 'node:path';",
  ].join('\n');
  assert.deepEqual(specifiers(sample).specs.sort(), ['../../test/lib/canvas-fake.mjs', '../x.mjs', './side.mjs', 'node:fs', 'node:path', 'pkg', 'ws'].sort());
  assert.equal(specifiers('const m = require("fs");').requires, true);
  const source = fs.readFileSync(MODULE_FILE, 'utf8');
  const { specs, requires } = specifiers(source);
  const bad = specs.filter((s) => !s.startsWith('node:'));
  assert.deepEqual(bad, [], 'every import names a node: module');
  assert.equal(requires, false, 'no require(');
});

test("canvas module: tables equal the contract fake's", async () => {
  const canvas = await load();
  for (const t of TABLES) {
    assert.deepStrictEqual(canvas[t], fake[t], `${t} equals the fake's`);
    assert.deepEqual(unfrozen(canvas[t], t), [], `${t} is deeply frozen`);
  }
  assert.deepStrictEqual(canvas.RANGES, fake.RANGES, 'RANGES equals the fake\'s');
  assert.deepEqual(unfrozen(canvas.RANGES, 'RANGES'), [], 'RANGES is deeply frozen');
  // the frozen check sees a nested part left mutable
  assert.deepEqual(unfrozen(Object.freeze({ a: { b: 1 } }), 'x'), ['x.a']);
});

// ---- canvas.mjs's own rules (outside the differential) ----

test('canvas module: outside the shape domain apply refuses shape, never throws', async () => {
  const canvas = await load();
  const small = [{ op: 'set', id: 'a', prop: 'name', value: 'A' }];
  const big = [{ op: 'set', id: 'a', prop: 'name', value: 'A' }, { op: 'set', id: 'a', prop: 'figma', value: 'x'.repeat(70 * 1024) }];
  assert.ok(Buffer.byteLength(JSON.stringify(big)) > canvas.LIMITS.editOpsBytes, 'the big ops pass 64 KB');
  const outside = [
    ['null', null],
    ['{}', {}],
    ['pages not an array', { canvas: 1, rev: 0, tokens: {}, pages: { p1: { id: 'p1', name: 'P', children: [] } }, nodes: {} }],
    ['a node not an object', { canvas: 1, rev: 0, tokens: {}, pages: [{ id: 'p1', name: 'P', children: ['a'] }], nodes: { a: 5 } }],
  ];
  for (const [label, doc] of outside) {
    for (const [size, ops] of [['small ops', small], ['ops over 64 KB', big]]) {
      let r;
      assert.doesNotThrow(() => { r = canvas.apply(doc, ops); }, `${label}, ${size}: no throw`);
      assert.equal(r.why, 'shape', `${label}, ${size}: shape`);
      assert.equal(r.doc, doc, `${label}, ${size}: the same object back`);
    }
  }
  // the order: view before shape, empty ops shape on any doc
  assert.equal(canvas.apply(null, small, { level: 'view' }).why, 'view');
  assert.equal(canvas.apply(null, []).why, 'shape');
});

test('canvas module: images as an array equal the Set', async () => {
  const canvas = await load();
  const doc = deepFreeze(withImage());
  for (const names of [[IMG], [], ['ffffffffffffffff.png'], imageNames()]) {
    const asSet = canvas.validate(doc, { images: new Set(names) });
    const asArray = canvas.validate(doc, { images: names });
    assert.deepEqual(asArray, asSet, `validate, images ${JSON.stringify(names)}`);
  }
  assert.deepEqual(canvas.validate(doc, { images: [IMG] }), [], 'the image is found in an array');
  const missing = canvas.validate(doc, { images: [] });
  assert.ok(missing.some((e) => e.rule === 'refs'), 'an empty array is no images, not a skipped check');
  for (const [file, names, want] of [[IMG, [IMG], null], ['ffffffffffffffff.png', [IMG], 'ref'], [IMG, [], 'ref']]) {
    const ops = [addImage('pic2', file)];
    const asSet = canvas.apply(doc, ops, { images: new Set(names) });
    const asArray = canvas.apply(doc, ops, { images: names });
    assert.equal(asArray.why, want, `apply, ${file} with images ${JSON.stringify(names)}`);
    assert.deepEqual(asArray, asSet, `apply equals the Set's, ${file} with images ${JSON.stringify(names)}`);
  }
});
