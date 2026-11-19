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
// `import('…')`, `export … from`; and whether it calls `require(` or makes one (`createRequire`).
function specifiers(source) {
  const out = [];
  const forms = [
    /\bimport\s*\(\s*(['"`])([^'"`]*)\1/g,
    /\bimport\s+(['"])([^'"]*)\1/g,
    /\bimport\s+[^'"();]*?\bfrom\s*(['"])([^'"]*)\1/g,
    /\bexport\s+[^'"();]*?\bfrom\s*(['"])([^'"]*)\1/g,
  ];
  for (const rx of forms) for (const m of source.matchAll(rx)) out.push(m[2]);
  return { specs: out, requires: /\brequire\s*\(|\bcreateRequire\b/.test(source) };
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
  assert.equal(specifiers("import { createRequire } from 'node:module';\nconst r = createRequire(import.meta.url);").requires, true, 'createRequire counts as require');
  const source = fs.readFileSync(MODULE_FILE, 'utf8');
  const { specs, requires } = specifiers(source);
  const bad = specs.filter((s) => !s.startsWith('node:'));
  assert.deepEqual(bad, [], 'every import names a node: module');
  assert.equal(requires, false, 'no require( and no createRequire');
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

// ---- the differential tests: canvas.mjs against the contract's fake ----
//
// Every call goes to both, on the same deep-frozen input (C7: a mutation of the input throws, a refused
// apply returns the very object it was given, the ops' JSON is unchanged), and the outcomes must be
// equal: the same `why` and a deep-equal document; `validate` and `docErrors` the same list. The
// records each part keeps (the document, the edit, the options, the outcome) feed the done-when tests'
// idempotency check through `appliedSingleEdits()`.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const FIXTURE_IMAGES = new Set(imageNames());

// Every file under the fixtures folder in a named category: checked by the tests below, or holding no
// document or edit (asserted so by `fixtureAccountProblems`). The first category whose pattern
// matches a file's name is its category; the checked ones' patterns are the ones the tests list by.
export const FIXTURE_CATEGORIES = Object.freeze([
  { name: 'document', re: /^(?:doc-[^/]*|hostile)\.json$/, checked: true },
  { name: 'message edit', re: /^msg-edit[^/]*\.json$/, checked: true },
  { name: 'message ops', re: /^msg-ops[^/]*\.json$/, checked: true },
  { name: 'local apply', re: /^http-local-[^/]*\.json$/, checked: true },
  { name: 'edit route', re: /^http-edit-[^/]*\.json$/, checked: true },
  { name: 'doc route', re: /^http-doc-[^/]*\.json$/, checked: true },
  { name: 'exchange', re: /^exchange-[^/]*\.json$/, checked: true },
  { name: 'other message', re: /^msg-[^/]*\.json$/, checked: false },
  { name: 'other route', re: /^http-[^/]*\.json$/, checked: false },
  { name: 'presence', re: /^presence-[^/]*\.json$/, checked: false },
  { name: 'note anchor', re: /^note-anchor[^/]*\.json$/, checked: false },
]);
const categoryOf = (name) => FIXTURE_CATEGORIES.find((c) => c.re.test(name)) || null;
const fixturesIn = (dir, catName) => fs.readdirSync(dir).filter((f) => {
  const c = categoryOf(f);
  return c && c.name === catName && fs.statSync(path.join(dir, f)).isFile();
}).sort();

// C4b: every way the fixtures folder `dir` has a file the tests don't account for; [] when each is in
// a named category, `images/` holds image files only, and no file of the no-document categories holds
// an `ops` array or an object with a document's keys (pages, nodes or tokens) at any depth.
export function fixtureAccountProblems(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const name = ent.name;
    if (ent.isDirectory()) {
      if (name !== 'images') { out.push(`${name}/: a folder in no named category`); continue; }
      for (const f of fs.readdirSync(path.join(dir, name))) if (!fake.IMAGE_FILE_RE.test(f)) out.push(`images/${f}: not an image file`);
      continue;
    }
    const cat = categoryOf(name);
    if (!cat) { out.push(`${name}: in no named category`); continue; }
    if (cat.checked) continue;
    let v;
    try { v = readJson(path.join(dir, name)); } catch { out.push(`${name}: not JSON`); continue; }
    const stack = [[v, '']];
    while (stack.length) {
      const [x, at] = stack.pop();
      if (x === null || typeof x !== 'object') continue;
      if (isObj(x)) {
        if (own(x, 'ops') && Array.isArray(x.ops)) out.push(`${name}: an ops array at ${at || '(top)'}`);
        const keys = ['pages', 'nodes', 'tokens'].filter((k) => own(x, k));
        if (keys.length) out.push(`${name}: a document's ${keys.join(', ')} at ${at || '(top)'}`);
      }
      for (const k of Object.keys(x)) stack.push([x[k], `${at}.${k}`]);
    }
  }
  return out;
}

// The two judgements of one edit, compared (C4, C5) and held pure (C7). `doc` deep-frozen.
function judgeBoth(canvas, doc, ops, opts, label) {
  deepFreeze(ops);
  const before = JSON.stringify(ops);
  const mine = canvas.apply(doc, ops, opts);
  const theirs = fake.applyEdit(doc, ops, opts);
  assert.equal(JSON.stringify(ops), before, `${label}: the ops unchanged`);
  assert.equal(mine.why, theirs.why, `${label}: apply's why equals applyEdit's`);
  if (mine.why !== null) assert.equal(mine.doc, doc, `${label}: a refused apply returns the very document`);
  else assert.deepStrictEqual(mine.doc, theirs.doc, `${label}: apply's document equals applyEdit's`);
  return mine;
}
// validate ≡ docErrors on one input; the list.
function sameErrors(canvas, doc, opts, label) {
  const mine = canvas.validate(doc, opts);
  assert.deepStrictEqual(mine, fake.docErrors(doc, opts), `${label}: validate equals docErrors`);
  return mine;
}

const docFixtureNames = (dir = FIXTURES) => fixturesIn(dir, 'document');
// The documents the fixtures hold: each document fixture, each doc route's response.doc, each doc an
// exchange step states.
function documentsInFixtures(dir = FIXTURES) {
  const out = [];
  for (const f of docFixtureNames(dir)) out.push({ label: f, doc: readJson(path.join(dir, f)), kind: 'fixture' });
  for (const f of fixturesIn(dir, 'doc route')) {
    const fx = readJson(path.join(dir, f));
    if (isObj(fx.response) && own(fx.response, 'doc')) out.push({ label: `${f} response.doc`, doc: fx.response.doc, kind: 'http' });
  }
  for (const f of fixturesIn(dir, 'exchange')) {
    readJson(path.join(dir, f)).steps.forEach((s, i) => { if (own(s, 'doc')) out.push({ label: `${f} step ${i + 1} doc`, doc: s.doc, kind: 'exchange' }); });
  }
  return out;
}

// ---- C4: the fixtures' edits ----

const once = (fn) => { let p = null; return () => (p ??= fn()); };

// Each msg-edit*/msg-ops* fixture's ops on every document fixture, with the page's bound and with none.
const messageRecords = once(async () => {
  const canvas = await load();
  const out = [];
  const files = [...fixturesIn(FIXTURES, 'message edit'), ...fixturesIn(FIXTURES, 'message ops')];
  for (const f of files) {
    const m = fixture(f);
    for (const d of docFixtureNames()) {
      const doc = deepFreeze(fixture(d));
      for (const opts of [{ images: FIXTURE_IMAGES }, { images: FIXTURE_IMAGES, maxOpsBytes: null }]) {
        const r = judgeBoth(canvas, doc, clone(m.ops), opts, `${f} on ${d}${opts.maxOpsBytes === null ? ', no bound' : ''}`);
        out.push({ from: f, doc, ops: m.ops, opts, why: r.why });
      }
    }
  }
  return { files, records: out };
});

// Each http-local-*/http-edit-* fixture whose request body parses with an ops array, on the document
// its fake.canvases names for the request's slug (doc-minimal.json when none), unbounded.
const localRecords = once(async () => {
  const canvas = await load();
  const out = [];
  const files = [...fixturesIn(FIXTURES, 'local apply'), ...fixturesIn(FIXTURES, 'edit route')];
  for (const f of files) {
    const fx = fixture(f);
    const body = fx.request && fx.request.body;
    if (!isObj(body) || !Array.isArray(body.ops)) continue;
    const slug = new URL(fx.request.path, 'http://x').searchParams.get('slug');
    const fk = isObj(fx.fake) ? fx.fake : {};
    const docName = isObj(fk.canvases) && own(fk.canvases, slug) ? fk.canvases[slug] : 'doc-minimal.json';
    const names = isObj(fk.images) && own(fk.images, slug) ? fk.images[slug] : [];
    const extra = isObj(fk.folderBytes) && own(fk.folderBytes, slug) ? fk.folderBytes[slug] : 0;
    const opts = { images: new Set(names), folderBytes: names.reduce((s, n) => s + fs.statSync(path.join(IMAGES_DIR, n)).size, 0) + extra, maxOpsBytes: null };
    const doc = deepFreeze(fixture(docName));
    const r = judgeBoth(canvas, doc, clone(body.ops), opts, `${f} on ${docName}`);
    out.push({ from: f, doc, ops: body.ops, opts, why: r.why });
  }
  return { files, records: out };
});

// One exchange replayed as the fake's server judges it (spec C4): the sender's level from its open
// step (null is full), the exchange's images and their bytes, a new seq book when a connection opens
// with none open and on replace or restart, replace's fixture at the old rev + 1, restart going on from
// its stated doc or ending the replay; the edits the session never judges afresh are passed over.
// Up to the first replace or restart, each judged edit's stated outcome and each stated doc must match.
const NOT_JUDGED = [403, 404, 413, 423, 503, 400];
function replayExchange(canvas, name, x) {
  const names = Array.isArray(x.images) ? x.images : [];
  const images = new Set(names);
  const folderBytes = names.reduce((s, n) => s + fs.statSync(path.join(IMAGES_DIR, n)).size, 0);
  let doc = deepFreeze(fixture(x.canvas));
  let book = null; // the open session's seq book; null with no connection open
  const conns = new Map(); // live connection name -> level
  let tracking = true; // no replace or restart yet
  const res = { records: [], applied: 0, refused: 0, docs: 0, judged: 0 };
  // an edit answered by the sender's close is never judged; no fixture's edit is answered so today
  const closes = (expect, cn) => {
    const l = expect[cn];
    return Array.isArray(l) && l.length > 0 && isObj(l[l.length - 1]) && own(l[l.length - 1], '$close');
  };
  for (let i = 0; i < x.steps.length; i++) {
    const s = x.steps[i];
    const where = `${name} step ${i + 1}`;
    const expect = isObj(s.expect) ? s.expect : {};
    let end = false;
    if (own(s, 'open')) {
      const status = own(s, 'status') ? s.status : 101;
      const welcomed = Array.isArray(expect[s.open]) && expect[s.open].some((m) => isObj(m) && m.t === 'welcome');
      if (status === 101 && welcomed) {
        if (conns.size === 0) book = fake.makeSeqBook();
        conns.set(s.open, s.level === null ? 'full' : s.level);
      }
    } else if (own(s, 'as')) {
      const m = s.send;
      if (s.close === true) conns.delete(s.as);
      else if (conns.has(s.as) && !closes(expect, s.as) && isObj(m) && m.t === 'edit' && book.judge(m.client, m.seq) === 'new') {
        const opts = { images, folderBytes, level: conns.get(s.as) };
        const r = judgeBoth(canvas, doc, clone(m.ops), opts, `${where} (edit ${m.client} ${m.seq})`);
        book.record(m.client, m.seq, r.why);
        res.records.push({ from: where, doc, ops: m.ops, opts, why: r.why });
        res.judged += 1;
        if (r.why === null) doc = deepFreeze(r.doc);
        if (tracking) {
          const mine = Array.isArray(expect[s.as]) ? expect[s.as] : [];
          const refused = mine.find((e) => isObj(e) && e.t === 'refused' && e.client === m.client && e.seq === m.seq);
          const acked = mine.find((e) => isObj(e) && e.t === 'ops' && isObj(e.ack) && e.ack.client === m.client && e.ack.seq === m.seq && Array.isArray(e.ops) && e.ops.length > 0);
          if (refused) { assert.equal(r.why, refused.why, `${where}: refused as the exchange says`); res.refused += 1; }
          else if (acked) { assert.equal(r.why, null, `${where}: applied as the exchange says`); assert.equal(doc.rev, acked.rev, `${where}: the acked rev`); res.applied += 1; }
        }
      }
    } else if (own(s, 'local')) {
      const body = s.local;
      if (!NOT_JUDGED.includes(s.status) && isObj(body) && Array.isArray(body.ops)) {
        const opts = { images, folderBytes, maxOpsBytes: null };
        const r = judgeBoth(canvas, doc, clone(body.ops), opts, `${where} (local)`);
        res.records.push({ from: where, doc, ops: body.ops, opts, why: r.why });
        res.judged += 1;
        // a 409 limit after an applied judgement is the route's own 1 MB check: the fake alone decides it
        // (no fixture reaches it today)
        const routeLimit = s.status === 409 && r.why === null;
        if (r.why === null && !routeLimit) {
          const counts = Object.values(expect).map((l) => (Array.isArray(l) ? l.filter((e) => isObj(e) && e.t === 'ops').length : 0));
          // a local apply split into several ops messages raises rev by each (no fixture splits one today)
          const runs = Math.max(0, ...counts) || (isObj(s.body) && Number.isInteger(s.body.edits) ? s.body.edits : 1);
          const next = r.doc;
          next.rev = doc.rev + runs;
          doc = deepFreeze(next);
        }
        if (tracking && !routeLimit) {
          if (s.status === 409) {
            if (isObj(s.body)) assert.equal(r.why, s.body.why, `${where}: the local route's 409 why`);
            else assert.notEqual(r.why, null, `${where}: refused`);
            res.refused += 1;
          } else if (s.status === 200) {
            assert.equal(r.why, null, `${where}: the local apply applies`);
            if (isObj(s.body)) assert.equal(doc.rev, s.body.rev, `${where}: the local route's rev`);
            res.applied += 1;
          }
        }
      }
    } else if (own(s, 'do')) {
      if (s.do === 'replace') {
        // the replaced document at the old rev + 1 (no fixture states a doc or an edit outcome after it today)
        doc = deepFreeze({ ...fixture(s.arg), rev: doc.rev + 1 });
        book = fake.makeSeqBook();
        tracking = false;
      } else if (s.do === 'restart') {
        conns.clear();
        book = null;
        tracking = false;
        if (own(s, 'doc')) doc = deepFreeze(clone(s.doc));
        else end = true;
      } else if (s.do === 'land' || s.do === 'remove') end = true;
    }
    if (end) break;
    for (const cn of Object.keys(expect)) if (closes(expect, cn)) conns.delete(cn);
    if (conns.size === 0) book = null;
    if (own(s, 'doc') && tracking) {
      assert.deepStrictEqual(doc, s.doc, `${where}: the running document equals the stated doc`);
      res.docs += 1;
    }
  }
  return res;
}
const exchangeRecords = once(async () => {
  const canvas = await load();
  const files = fixturesIn(FIXTURES, 'exchange');
  const per = files.map((f) => ({ file: f, ...replayExchange(canvas, f, fixture(f)) }));
  return { files, per, records: per.flatMap((p) => p.records) };
});

// ---- C5: the seeded corpus ----
//
// Per document fixture, one running document: each edit is generated from the document it runs on
// (the generators below read `st.cur` when they yield), and an applied edit's result becomes the
// running document, so later edits act on what earlier ones built (adds, then sets on what was
// added). A small LCG with a fixed seed picks parents, ids and values; nothing else varies.

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}
const pick = (rnd, list) => (list.length ? list[Math.floor(rnd() * list.length)] : undefined);
function sample(rnd, list, n) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}
const CONTAINER_TYPES = ['frame', 'component'];
const SPECIAL_IDS = ['__proto__', 'constructor', 'hasOwnProperty'];
const IMAGE_FILE = [...FIXTURE_IMAGES][0] || '0123456789abcdef.png';

// Readers of the running document.
const nodeIds = (d) => Object.keys(d.nodes);
const ofType = (d, t) => nodeIds(d).filter((id) => d.nodes[id].type === t);
const containers = (d) => nodeIds(d).filter((id) => CONTAINER_TYPES.includes(d.nodes[id].type));
const leaves = (d) => nodeIds(d).filter((id) => !CONTAINER_TYPES.includes(d.nodes[id].type));
const pageIds = (d) => d.pages.map((pg) => pg.id);
const holders = (d) => [...pageIds(d), ...containers(d)];
function childrenOf(d, id) {
  const pg = d.pages.find((x) => x.id === id);
  if (pg) return pg.children;
  return own(d.nodes, id) && Array.isArray(d.nodes[id].children) ? d.nodes[id].children : [];
}
function descendants(d, id) {
  const out = [];
  const stack = [...childrenOf(d, id)];
  while (stack.length) { const c = stack.pop(); if (!own(d.nodes, c)) continue; out.push(c); stack.push(...childrenOf(d, c)); }
  return out;
}
function tokenList(d) { // [path, token] for every token; groups as [path, null]
  const out = [];
  const stack = [[d.tokens, []]];
  while (stack.length) {
    const [g, at] = stack.pop();
    for (const k of Object.keys(g)) {
      const v = g[k];
      const p = [...at, k];
      if (!isObj(v)) continue;
      if (Object.keys(v).some((x) => x.startsWith('$'))) out.push([p.join('.'), v]);
      else { out.push([p.join('.'), null]); stack.push([v, p]); }
    }
  }
  return out;
}
const tokensOf = (d, type) => tokenList(d).filter(([, t]) => t && t.$type === type).map(([p]) => p);
const groupsOf = (d) => tokenList(d).filter(([, t]) => t === null).map(([p]) => p);

// Values by class: a few valid ones (static; the document's token refs are added where they fit).
const SAMPLES = {
  color: ['#123456', '#abc', '#11223344'],
  paint: ['#ff0000', null],
  dim: [12, -40.5],
  len: [8, 0],
  opacity: [0.25, 0, 1],
  padding: [[4, 8, 4, 8]],
  sizing: ['fill', 'hug', 240],
  tracks: [['1fr', 'auto', 80], []],
  font: [{ family: 'serif', size: 14, weight: 700, lineHeight: 1.2 }],
  pathData: ['M0 0 L10 10 Z', 'm1 1h2v2z'],
  imageSrc: [`images/${IMAGE_FILE}`, 'images/ffffffffffffffff.png'],
  name: ['Hello', ''],
  text: ['Some text', ''],
  figmaId: ['1:2'],
  bool: [true, false],
  enum: ['start'],
  componentRef: ['button'],
  variantName: ['primary', null],
  propDefs: [{}],
  propDef: [{ type: 'bool', default: true, target: { id: 'ghost', prop: 'visible' } }],
  propValues: [{}],
  propValue: ['Go', true],
  variants: [{}],
  variant: [{}],
  overrides: [{}],
  override: ['#ffffff'],
};
// Values no class takes, or few do.
const ODD_VALUES = [-1, 2, 1e9, 'x', { $ref: 'nope.none' }];
function overLong(cls) {
  switch (cls) {
    case 'name': return 'n'.repeat(201);
    case 'text': case 'propValue': return 't'.repeat(10001);
    case 'figmaId': return '9'.repeat(101);
    case 'pathData': return `M0 0${' L1 1'.repeat(13108)}`;
    case 'tracks': return Array(65).fill('1fr');
    case 'padding': return [1, 2, 3, 4, 5];
    case 'componentRef': return 'c'.repeat(41);
    case 'variantName': return 'V'.repeat(41);
    case 'propDefs': return Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`p${i}`, { type: 'bool', default: true, target: { id: 'ghost', prop: 'visible' } }]));
    case 'variants': return Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`v${i}`, {}]));
    case 'propValues': return { [`p${'x'.repeat(40)}`]: 'a' };
    case 'overrides': case 'variant': return Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`o${i}`, { opacity: 1 }]));
    default: return 'x'.repeat(300);
  }
}
// The class an override path aims at, from its target in the running document.
function targetDef(d, target, prop) {
  const t = own(d.nodes, target) ? d.nodes[target] : null;
  return t && own(fake.PROPS, t.type) && own(fake.PROPS[t.type], prop) ? fake.PROPS[t.type][prop] : { class: 'name', default: undefined };
}
// A property path's definition on node `id`, as the rules read it (templates instantiated).
function defOf(d, id, p) {
  const n = d.nodes[id];
  const T = fake.PROPS[n.type];
  if (own(T, p) && !p.includes('<')) return T[p];
  const s = p.split('.');
  if (s[0] === 'props' && s.length === 2 && own(T, 'props.<name>')) return T['props.<name>'];
  if (s[0] === 'variants' && own(T, 'variants.<name>')) {
    if (s.length === 2) return T['variants.<name>'];
    if (s.length >= 4) return targetDef(d, s[2], s.slice(3).join('.'));
  }
  if (s[0] === 'overrides' && own(T, 'overrides.<id>.<prop>') && s.length >= 3) return targetDef(d, s[1], s.slice(2).join('.'));
  return { class: 'name', default: undefined };
}
// The valid values of a class on node `id` of the running document.
function validFor(d, id, cls, def) {
  const n = d.nodes[id];
  const refs = (type) => tokensOf(d, type).slice(0, 2).map((p) => ({ $ref: p }));
  const comp = n && n.type === 'instance' && own(d.nodes, n.component) && d.nodes[n.component].type === 'component' ? d.nodes[n.component] : null;
  const inside = n && n.type === 'component' ? descendants(d, id) : comp ? descendants(d, n.component) : [];
  const someIn = inside[0] || 'ghost';
  const textIn = inside.find((x) => d.nodes[x].type === 'text') || 'ghost';
  switch (cls) {
    case 'color': case 'paint': return [...SAMPLES[cls], ...refs('color'), ...refs('dimension')];
    case 'dim': case 'len': case 'sizing': return [...SAMPLES[cls], ...refs('dimension'), ...refs('color')];
    case 'padding': return [...SAMPLES.padding, ...refs('dimension').map((r) => [r, 0, 0, 0])];
    case 'font': {
      const f = (k, t) => (tokensOf(d, t)[0] ? { $ref: tokensOf(d, t)[0] } : k);
      return [...SAMPLES.font, ...refs('typography'), { family: f('mono', 'fontFamily'), size: f(10, 'dimension'), weight: f(300, 'fontWeight'), lineHeight: f(1, 'number') }];
    }
    case 'enum': return [...(def && def.words ? def.words : []), ...SAMPLES.enum];
    case 'componentRef': return [...ofType(d, 'component').slice(0, 3), 'ghost', id];
    case 'variantName': return [...(comp && isObj(comp.variants) ? Object.keys(comp.variants) : []), null, 'nope'];
    case 'propDef': return [{ type: 'text', default: 'Hi', target: { id: textIn, prop: 'text' } }, { type: 'bool', default: false, target: { id: someIn, prop: 'visible' } }];
    case 'propDefs': return [{ label: { type: 'text', default: 'Hi', target: { id: textIn, prop: 'text' } }, on: { type: 'bool', default: true, target: { id: someIn, prop: 'visible' } } }, {}];
    case 'propValues': {
      const defs = comp && isObj(comp.props) ? comp.props : {};
      return [Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, isObj(v) && v.type === 'bool' ? false : 'Set'])), { nope: 'x' }, {}];
    }
    case 'variants': return [{ primary: {}, alt: { [someIn]: { opacity: 0.5 } } }, {}];
    case 'variant': case 'overrides': return [{ [someIn]: { opacity: 0.5 } }, { [textIn]: { text: 'Over' } }, {}];
    default: return SAMPLES[cls] || [];
  }
}
// Every value a set of path `p` on node `id` is tried with: valid ones, the default, null, one of each
// other class, odd ones, an over-long one.
function valuesFor(d, id, p) {
  const def = defOf(d, id, p);
  const cls = def.class;
  const out = [...validFor(d, id, cls, def)];
  if (def.default !== undefined) out.push(def.default);
  out.push(null);
  for (const c of fake.CLASSES) if (c !== cls && SAMPLES[c]) out.push(SAMPLES[c][0]);
  out.push(...ODD_VALUES, overLong(cls));
  const seen = new Set();
  return out.filter((v) => { const k = JSON.stringify(v) ?? 'undefined'; if (seen.has(k)) return false; seen.add(k); return true; });
}
// Every path a set on node `id` is tried with: the type's plain paths, its templates instantiated.
function pathsFor(d, id) {
  const n = d.nodes[id];
  const out = [];
  const comp = n.type === 'instance' ? n.component : id;
  const inside = descendants(d, comp);
  const tgt = inside[0] || 'ghost';
  const txt = inside.find((x) => d.nodes[x].type === 'text') || tgt;
  for (const k of Object.keys(fake.PROPS[n.type])) {
    if (!k.includes('<')) { out.push(k); continue; }
    if (k === 'props.<name>') out.push('props.label', 'props.enabled', 'props.fresh', 'props.constructor', 'props.hasOwnProperty', 'props.__proto__', `props.p${'x'.repeat(40)}`);
    else if (k === 'variants.<name>') out.push('variants.primary', 'variants.fresh', 'variants.constructor', `variants.V${'x'.repeat(40)}`);
    else if (k === 'variants.<name>.<id>.<prop>') out.push(`variants.primary.${tgt}.fill`, `variants.primary.${txt}.text`, `variants.fresh.${tgt}.opacity`, `variants.primary.${tgt}.name`, `variants.primary.${tgt}.layout.gap`, 'variants.primary.__proto__.opacity', 'variants.primary.constructor.opacity', `variants.primary.${tgt}.nope`);
    else if (k === 'overrides.<id>.<prop>') out.push(`overrides.${txt}.text`, `overrides.${txt}.color`, `overrides.${tgt}.fill`, `overrides.${tgt}.name`, `overrides.${tgt}.size.w`, 'overrides.__proto__.opacity', 'overrides.hasOwnProperty.opacity', `overrides.${tgt}.component`);
  }
  return out;
}
// A node's minimal required properties, and a fuller set (groups nested) for an add.
function requiredFor(d, type) {
  if (type === 'vector') return { path: 'M0 0 L4 4' };
  if (type === 'image') return { src: `images/${IMAGE_FILE}` };
  if (type === 'instance') return { component: ofType(d, 'component')[0] || 'button' };
  return {};
}
function richFor(d, type) {
  const out = {};
  for (const k of Object.keys(fake.PROPS[type])) {
    if (k.includes('<')) continue;
    const def = fake.PROPS[type][k];
    const v = def.class === 'enum' ? def.words[1] : validFor(d, null, def.class, def)[0];
    if (v === undefined) continue;
    const [g, sub] = k.split('.');
    if (sub) { out[g] = out[g] || {}; out[g][sub] = v; } else out[k] = v;
  }
  return { ...out, ...requiredFor(d, type), name: `Rich ${type}` };
}

const TOKEN_GOOD = {
  color: { $type: 'color', $value: { colorSpace: 'srgb', components: [0.1, 0.2, 0.3], alpha: 0.5, hex: '#1a334d' } },
  dimension: { $type: 'dimension', $value: { value: 8, unit: 'px' } },
  fontFamily: { $type: 'fontFamily', $value: 'mono' },
  fontWeight: { $type: 'fontWeight', $value: 600 },
  number: { $type: 'number', $value: 2 },
  typography: { $type: 'typography', $value: { fontFamily: 'serif', fontSize: { value: 12, unit: 'px' }, fontWeight: 400, letterSpacing: { value: 0, unit: 'px' }, lineHeight: 1.3 } },
};
const TOKEN_BAD = {
  color: { $type: 'color', $value: { colorSpace: 'p3', components: [0, 0, 0] } },
  dimension: { $type: 'dimension', $value: { value: 8, unit: 'em' } },
  fontFamily: { $type: 'fontFamily', $value: 'cursive' },
  fontWeight: { $type: 'fontWeight', $value: 650 },
  number: { $type: 'number', $value: 'x' },
  typography: { $type: 'typography', $value: { fontFamily: 'serif' } },
};
const TOKEN_ODD = [{ $type: 'nope', $value: 1 }, { $type: 'color' }, { $type: 'number', $value: 1, extra: 1 }, {}, { a: { $type: 'number', $value: 1 } }, 'x', 5, []];

// ---- the generators: each yields edits (op lists) read from st.cur at the moment it yields ----

function* structuralEdits(st) {
  const r = st.rnd;
  for (const type of fake.TYPES) {
    const id = pick(r, ofType(st.cur, type));
    if (id === undefined) continue;
    for (const p of ['id', 'type', 'parent', 'children', 'layout', 'size', 'font.size', 'nope', 'layout.nope', 'size.d', '', 'a'.repeat(401), 'props', 'toString', ...SPECIAL_IDS, 'variants.primary.x', 'overrides']) {
      yield [{ op: 'set', id, prop: p, value: p === 'layout' ? { mode: 'row' } : p === 'size' ? { w: 1, h: 1 } : 1 }];
    }
  }
  for (const pid of pageIds(st.cur)) {
    for (const v of ['Renamed', '', 'n'.repeat(200), 'n'.repeat(201), 5, null, '\u0000x']) yield [{ op: 'set', id: pid, prop: 'name', value: v }];
    for (const p of ['children', 'id', 'nope', 'name.x']) yield [{ op: 'set', id: pid, prop: p, value: [] }];
  }
  for (const id of ['ghost', ...SPECIAL_IDS]) yield [{ op: 'set', id, prop: 'name', value: 'X' }];
}

function* setEdits(st) {
  const r = st.rnd;
  for (const type of fake.TYPES) {
    const first = pick(r, ofType(st.cur, type));
    // each type once per fixture: a later pass sets the types earlier edits added
    if (first === undefined || st.setTypes.has(type)) continue;
    st.setTypes.add(type);
    for (const p of pathsFor(st.cur, first)) {
      for (const v of valuesFor(st.cur, first, p)) {
        const id = own(st.cur.nodes, first) ? first : pick(r, ofType(st.cur, type));
        if (id === undefined) break;
        yield [{ op: 'set', id, prop: p, value: v }];
      }
    }
  }
}

function* moveEdits(st) {
  const r = st.rnd;
  for (const id of nodeIds(st.cur)) {
    for (const target of holders(st.cur)) {
      const kids = childrenOf(st.cur, target);
      for (const after of [null, kids[kids.length - 1] ?? 'gone-after', 'gone-after']) yield [{ op: 'move', id, parent: target, after }];
    }
    if (own(st.cur.nodes, id)) {
      yield [{ op: 'move', id, parent: st.cur.nodes[id].parent, after: id }];
      yield [{ op: 'move', id, parent: id, after: null }];
      for (const dsc of descendants(st.cur, id).slice(0, 3)) yield [{ op: 'move', id, parent: dsc, after: null }];
      yield [{ op: 'move', id, parent: null, after: null }];
      const leaf = pick(r, leaves(st.cur));
      if (leaf !== undefined) yield [{ op: 'move', id, parent: leaf, after: null }];
    }
  }
  for (const pid of pageIds(st.cur)) {
    for (const after of [null, pick(r, pageIds(st.cur)), pid, 'gone-page']) yield [{ op: 'move', id: pid, parent: null, after }];
    yield [{ op: 'move', id: pid, parent: pick(r, pageIds(st.cur)), after: null }];
  }
  for (const id of ['ghost', ...SPECIAL_IDS]) yield [{ op: 'move', id, parent: pageIds(st.cur)[0], after: null }];
}

function* tokenEdits(st) {
  const r = st.rnd;
  for (const type of fake.TOKEN_TYPES) {
    yield [{ op: 'token', path: `gen.${type}.a`, value: TOKEN_GOOD[type] }];
    for (const p of tokenList(st.cur).filter(([, t]) => t).map(([q]) => q).slice(0, 12)) {
      yield [{ op: 'token', path: p, value: TOKEN_GOOD[type] }];
      yield [{ op: 'token', path: p, value: TOKEN_BAD[type] }];
    }
    yield [{ op: 'token', path: `gen.${type}.b`, value: TOKEN_BAD[type] }];
  }
  for (const v of TOKEN_ODD) yield [{ op: 'token', path: 'gen.odd', value: v }];
  const toks = tokenList(st.cur).filter(([, t]) => t).map(([q]) => q);
  for (const p of toks) {
    yield [{ op: 'token', path: `${p}.inner`, value: TOKEN_GOOD.number }];
    yield [{ op: 'token', path: `${p}.inner`, value: null }];
  }
  for (const g of groupsOf(st.cur)) yield [{ op: 'token', path: g, value: TOKEN_GOOD.number }];
  for (const p of ['a.b.c.d.e.f.g.h', 'a.b.c.d.e.f.g.h.i', 's'.repeat(40), 's'.repeat(41), 'a..b', '', 'a b', '.a', 'a.', ...SPECIAL_IDS, '__proto__.x', 'constructor.y', 'g.hasOwnProperty']) {
    yield [{ op: 'token', path: p, value: TOKEN_GOOD.number }];
  }
  yield [{ op: 'token', path: 7, value: TOKEN_GOOD.number }];
  yield [{ op: 'token', path: 'gen.missing.x', value: null }];
  for (const p of tokenList(st.cur).filter(([, t]) => t).map(([q]) => q)) yield [{ op: 'token', path: p, value: null }];
  const left = pick(r, tokenList(st.cur).map(([q]) => q));
  if (left !== undefined) yield [{ op: 'token', path: left, value: null }];
}

function* addEdits(st) {
  const r = st.rnd;
  let k = 0;
  const fresh = (p) => `${p}${st.tag}${k++}`;
  for (const type of fake.TYPES) {
    const base = (id, parent) => ({ id, type, parent, ...requiredFor(st.cur, type) });
    for (const parent of sample(r, holders(st.cur), 4)) {
      const kids = childrenOf(st.cur, parent);
      for (const after of [null, kids[kids.length - 1] ?? 'gone-sibling', kids[0] ?? null, 'gone-sibling']) {
        yield [{ op: 'add', node: base(fresh('n'), parent), after }];
      }
    }
    const into = pick(r, holders(st.cur));
    yield [{ op: 'add', node: { ...richFor(st.cur, type), id: fresh('rich'), type, parent: into }, after: null }];
    const same = pick(r, ofType(st.cur, type));
    if (same !== undefined) {
      const at = st.cur.nodes[same].parent;
      yield [{ op: 'add', node: { ...base(same, at), name: 'Again' }, after: null }];
      yield [{ op: 'add', node: base(same, at), after: 'gone-sibling' }];
      const elsewhere = pick(r, holders(st.cur).filter((h) => h !== at));
      if (elsewhere !== undefined) yield [{ op: 'add', node: base(same, elsewhere), after: null }];
    }
    const other = pick(r, nodeIds(st.cur).filter((id) => st.cur.nodes[id].type !== type));
    if (other !== undefined) yield [{ op: 'add', node: base(other, st.cur.nodes[other].parent), after: null }];
    const pg = pageIds(st.cur)[0];
    yield [{ op: 'add', node: base(pg, pg), after: null }];
    yield [{ op: 'add', node: base(fresh('n'), 'ghost-parent'), after: null }];
    const leaf = pick(r, leaves(st.cur));
    if (leaf !== undefined) yield [{ op: 'add', node: base(fresh('n'), leaf), after: null }];
    yield [{ op: 'add', node: base(fresh('n'), null), after: null }];
    for (const id of SPECIAL_IDS) yield [{ op: 'add', node: base(id, pick(r, holders(st.cur))), after: null }];
    yield [{ op: 'add', node: { ...base(fresh('n'), pg), bogus: 1 }, after: null }];
    yield [{ op: 'add', node: { ...base(fresh('n'), pg), name: 5 }, after: null }];
    yield [{ op: 'add', node: { ...base(fresh('n'), pg), children: [] }, after: null }];
  }
  const pages = () => pageIds(st.cur);
  for (const after of [null, pages()[0], pages()[pages().length - 1], 'gone-page']) yield [{ op: 'add', node: { id: fresh('pg'), type: 'page', parent: null, name: 'New' }, after }];
  yield [{ op: 'add', node: { id: pages()[0], type: 'page', parent: null, name: 'Renamed by add' }, after: null }];
  const anyNode = pick(r, nodeIds(st.cur));
  if (anyNode !== undefined) yield [{ op: 'add', node: { id: anyNode, type: 'page', parent: null, name: 'X' }, after: null }];
  yield [{ op: 'add', node: { id: fresh('pg'), type: 'page', parent: pages()[0], name: 'X' }, after: null }];
  yield [{ op: 'add', node: { id: fresh('pg'), type: 'page', parent: null, name: 'X', x: 1 }, after: null }];
  yield [{ op: 'add', node: { id: fresh('pg'), type: 'page', parent: null, name: 'n'.repeat(201) }, after: null }];
  yield [{ op: 'add', node: { id: fresh('pg'), type: 'page', parent: null }, after: null }];
  for (const id of SPECIAL_IDS) yield [{ op: 'add', node: { id, type: 'page', parent: null, name: id }, after: null }];
}

// One plausible op of a random kind, from the running document.
function randomOp(st) {
  const r = st.rnd;
  const d = st.cur;
  const kind = pick(r, fake.OPS);
  if (kind === 'set') {
    const id = pick(r, nodeIds(d));
    if (id === undefined) return { op: 'set', id: pick(r, pageIds(d)), prop: 'name', value: `Page ${Math.floor(r() * 100)}` };
    const p = pick(r, pathsFor(d, id));
    return { op: 'set', id, prop: p, value: pick(r, valuesFor(d, id, p)) };
  }
  if (kind === 'add') {
    const type = pick(r, [...fake.TYPES, 'page']);
    if (type === 'page') return { op: 'add', node: { id: `rp${st.tag}${st.n++}`, type, parent: null, name: 'R' }, after: pick(r, [null, ...pageIds(d)]) };
    const parent = pick(r, holders(d));
    const id = r() < 0.2 && nodeIds(d).length ? pick(r, nodeIds(d)) : `r${st.tag}${st.n++}`;
    return { op: 'add', node: { id, type, parent, ...requiredFor(d, type), name: 'R' }, after: pick(r, [null, ...childrenOf(d, parent), 'gone']) };
  }
  if (kind === 'del') return { op: 'del', id: pick(r, [...nodeIds(d), ...pageIds(d), 'ghost']) };
  if (kind === 'move') {
    const id = pick(r, [...nodeIds(d), ...pageIds(d)]);
    if (pageIds(d).includes(id)) return { op: 'move', id, parent: null, after: pick(r, [null, ...pageIds(d)]) };
    const parent = pick(r, holders(d));
    return { op: 'move', id, parent, after: pick(r, [null, ...childrenOf(d, parent), 'gone']) };
  }
  const type = pick(r, fake.TOKEN_TYPES);
  const existing = tokenList(d).map(([p]) => p);
  const path = r() < 0.5 && existing.length ? pick(r, existing) : `rt.${type}${Math.floor(r() * 4)}`;
  return { op: 'token', path, value: pick(r, [TOKEN_GOOD[type], TOKEN_GOOD[type], TOKEN_BAD[type], null]) };
}

function* comboEdits(st) {
  const r = st.rnd;
  for (let i = 0; i < 80; i++) yield [randomOp(st)];
  for (let i = 0; i < 80; i++) yield [randomOp(st), randomOp(st)];
  for (let i = 0; i < 50; i++) yield [randomOp(st), randomOp(st), randomOp(st)];
  // ops that lean on each other inside one edit
  for (let i = 0; i < 6; i++) {
    const t = `c${st.tag}${i}`;
    const pg = pick(r, pageIds(st.cur));
    const box = pick(r, containers(st.cur)) ?? pg;
    yield [{ op: 'add', node: { id: `${t}f`, type: 'frame', parent: pg }, after: null }, { op: 'set', id: `${t}f`, prop: 'name', value: 'Fresh' }, { op: 'move', id: `${t}f`, parent: box, after: null }];
    const gone = pick(r, nodeIds(st.cur));
    if (gone !== undefined) {
      const at = st.cur.nodes[gone].parent;
      yield [{ op: 'del', id: gone }, { op: 'add', node: { id: `${t}r`, type: 'rect', parent: own(st.cur.nodes, at) || pageIds(st.cur).includes(at) ? at : pg }, after: gone }];
    }
    yield [{ op: 'token', path: `combo.c${i}`, value: TOKEN_GOOD.color }, { op: 'add', node: { id: `${t}t`, type: 'text', parent: pg, color: { $ref: `combo.c${i}` } }, after: null }];
    yield [{ op: 'add', node: { id: `${t}p`, type: 'page', parent: null, name: 'P' }, after: null }, { op: 'add', node: { id: `${t}n`, type: 'ellipse', parent: `${t}p` }, after: null }, { op: 'move', id: `${t}n`, parent: pg, after: 'gone' }];
    yield [
      { op: 'add', node: { id: `${t}c`, type: 'component', parent: pg }, after: null },
      { op: 'add', node: { id: `${t}l`, type: 'text', parent: `${t}c`, text: 'L' }, after: null },
      { op: 'set', id: `${t}c`, prop: 'props.label', value: { type: 'text', default: 'D', target: { id: `${t}l`, prop: 'text' } } },
      { op: 'set', id: `${t}c`, prop: 'variants.alt', value: { [`${t}l`]: { color: '#ff0000' } } },
      { op: 'add', node: { id: `${t}i`, type: 'instance', parent: pg, component: `${t}c`, variant: 'alt', props: { label: 'I' }, overrides: { [`${t}l`]: { text: 'O' } } }, after: null },
    ];
    yield [{ op: 'add', node: { id: `${t}c2`, type: 'component', parent: pg }, after: null }, { op: 'add', node: { id: `${t}i2`, type: 'instance', parent: `${t}c2`, component: `${t}c2` }, after: null }];
    yield [{ op: 'add', node: { id: `${t}x`, type: 'rect', parent: pg }, after: null }, { op: 'del', id: `${t}x` }];
  }
}

const MALFORMED = [
  null, 'set', 5, [], {}, { op: 'nope' }, { op: 'set' }, { op: 'set', id: 'p1', prop: 'name' },
  { op: 'set', id: 'p1', prop: 'name', value: 'x', extra: 1 }, { op: 'set', id: 7, prop: 'name', value: 'x' }, { op: 'set', id: 'p1', prop: 7, value: 'x' },
  { op: 'set', id: 'bad id', prop: 'name', value: 'x' }, { op: 'set', id: 'i'.repeat(41), prop: 'name', value: 'x' },
  { op: 'add', node: null, after: null }, { op: 'add', node: { id: 'm1', type: 'rect', parent: 'p1' } }, { op: 'add', node: { id: 'm1', type: 'blob', parent: 'p1' }, after: null },
  { op: 'add', node: { id: 'm1', type: 'rect' }, after: null }, { op: 'add', node: { id: 'm1', type: 'rect', parent: 5 }, after: null },
  { op: 'add', node: { id: 'm 1', type: 'rect', parent: 'p1' }, after: null }, { op: 'add', node: { id: 'm1', type: 'rect', parent: 'p1' }, after: 5 },
  { op: 'add', node: { id: 'm1', type: 'page', parent: null }, after: null }, { op: 'add', node: { id: 'm1', type: 'frame', parent: 'p1', children: [] }, after: null },
  { op: 'add', node: { id: 'm1', type: 'rect', parent: 'p1' }, after: null, x: 1 },
  { op: 'del' }, { op: 'del', id: 5 }, { op: 'del', id: 'p1', x: 1 },
  { op: 'move', id: 'a', parent: 'p1' }, { op: 'move', id: 'a', parent: 5, after: null }, { op: 'move', id: 'a', parent: 'p1', after: 'bad id' }, { op: 'move', id: 'a', parent: 'p1', after: null, x: 1 },
  { op: 'token', path: 'a' }, { op: 'token', path: 'a', value: 'x' }, { op: 'token', path: 'a', value: [] }, { op: 'token', path: 'a b', value: null }, { op: 'token', path: 'a', value: null, x: 1 },
  { op: 'SET', id: 'p1', prop: 'name', value: 'x' },
];
function* malformedEdits(st) {
  const pg = pageIds(st.cur)[0];
  for (const m of MALFORMED) {
    yield [m];
    yield [{ op: 'set', id: pg, prop: 'name', value: 'Before' }, m];
  }
  // the edit itself malformed: not a list, or empty
  yield 'not a list';
  yield null;
  yield { op: 'del', id: pg };
  yield [];
}

function* delEdits(st) {
  const r = st.rnd;
  for (const id of sample(r, nodeIds(st.cur), 60)) yield [{ op: 'del', id }];
  for (const id of ['ghost', ...SPECIAL_IDS]) yield [{ op: 'del', id }];
  while (pageIds(st.cur).length > 1) yield [{ op: 'del', id: pick(r, pageIds(st.cur)) }];
  yield [{ op: 'del', id: pageIds(st.cur)[0] }]; // the last page
  for (const id of nodeIds(st.cur)) yield [{ op: 'del', id }];
}

// One node of each type the running document lacks (a component with a text and a frame inside, and an
// instance of it), so the next set pass has every type on a small document.
function* seedEdits(st) {
  const pg = pageIds(st.cur)[0];
  const t = `s${st.tag}`;
  for (const type of fake.TYPES) {
    if (ofType(st.cur, type).length) continue;
    if (type === 'component') {
      yield [{ op: 'add', node: { id: `${t}comp`, type, parent: pg }, after: null }];
      yield [{ op: 'add', node: { id: `${t}label`, type: 'text', parent: `${t}comp`, text: 'Label' }, after: null }];
      yield [{ op: 'add', node: { id: `${t}bg`, type: 'frame', parent: `${t}comp` }, after: null }];
    } else yield [{ op: 'add', node: { id: `${t}${type}`, type, parent: pg, ...requiredFor(st.cur, type) }, after: null }];
  }
}

const GENERATORS = [structuralEdits, setEdits, moveEdits, tokenEdits, seedEdits, setEdits, addEdits, comboEdits, malformedEdits, delEdits];
// The options an edit is judged with: mostly the fixtures' images; now and then no image check, no
// ops bound, a folder near its limit, or a view connection.
function corpusOpts(i) {
  if (i % 97 === 5) return { images: FIXTURE_IMAGES, level: 'view' };
  if (i % 13 === 3) return { images: FIXTURE_IMAGES, maxOpsBytes: null };
  if (i % 17 === 4) return { images: FIXTURE_IMAGES, folderBytes: fake.LIMITS.folderBytes - 9000 };
  if (i % 7 === 2) return { images: null };
  return { images: FIXTURE_IMAGES };
}
const kindOf = (op) => (isObj(op) && fake.OPS.includes(op.op) ? op.op : 'malformed');

const corpus = once(async () => {
  const canvas = await load();
  const records = [];
  const generated = Object.fromEntries([...fake.OPS, 'malformed'].map((k) => [k, 0]));
  const applied = { ...generated };
  let edits = 0;
  let reached = 0;
  const byGen = {};
  const msByGen = {};
  const pageApplied = { add: 0, del: 0, move: 0, set: 0 };
  docFixtureNames().forEach((name, fi) => {
    const st = { cur: deepFreeze(fixture(name)), rnd: lcg(0x6b697436 + fi), tag: `f${fi}x`, n: 0, setTypes: new Set() };
    sameErrors(canvas, st.cur, { images: FIXTURE_IMAGES }, `${name} as it starts`);
    reached += 1;
    for (const gen of GENERATORS) {
      const t0 = Date.now();
      for (const ops of gen(st)) {
        const opts = corpusOpts(edits);
        const label = `corpus ${name} #${edits} ${gen.name}`;
        const doc = st.cur;
        let r;
        try { r = judgeBoth(canvas, doc, ops, opts, label); } catch (e) {
          e.message += `\n  the edit: ${JSON.stringify(ops).slice(0, 400)}\n  the options: ${JSON.stringify({ ...opts, images: opts.images && [...opts.images] })}`;
          throw e;
        }
        edits += 1;
        byGen[`${name} ${gen.name}`] = (byGen[`${name} ${gen.name}`] || 0) + 1;
        const list = Array.isArray(ops) ? ops : [];
        for (const op of list) generated[kindOf(op)] += 1;
        records.push({ from: label, doc, ops, opts, why: r.why });
        if (r.why !== null) continue;
        for (const op of list) {
          applied[kindOf(op)] += 1;
          const onPage = op.op === 'add' ? op.node.type === 'page' : op.op !== 'token' && pageIds(doc).includes(op.id);
          if (onPage) pageApplied[op.op] += 1;
        }
        st.cur = deepFreeze(r.doc);
        reached += 1;
        // both judgements already found it valid with the edit's own options; compared again with no
        // images, where an image node gives a refs entry, and a folder near its limit now and then
        const near = edits % 11 === 0 ? fake.LIMITS.folderBytes - 12000 : 0;
        sameErrors(canvas, st.cur, { images: new Set(), folderBytes: near }, `${label}: the document reached`);
      }
      msByGen[`${name} ${gen.name}`] = (msByGen[`${name} ${gen.name}`] || 0) + Date.now() - t0;
    }
  });
  return { records, generated, applied, edits, reached, pageApplied, byGen, msByGen };
});

// Every applied single-op edit the differential tests judged, from the corpus and the fixtures: the
// done-when tests' idempotency check runs each again (`{ doc, op, opts, from }`, `doc` deep-frozen).
export async function appliedSingleEdits() {
  const parts = [await corpus(), await messageRecords(), await localRecords(), await exchangeRecords()];
  const out = [];
  for (const p of parts) {
    for (const rec of p.records) {
      if (rec.why === null && Array.isArray(rec.ops) && rec.ops.length === 1) out.push({ doc: rec.doc, op: rec.ops[0], opts: rec.opts, from: rec.from });
    }
  }
  return out;
}

// ---- C5: one broken copy of doc-every-type.json per document rule ----

const BROKEN = {
  top: [(d) => { delete d.rev; }, (d) => { d.extra = 1; }],
  'page-shape': [(d) => { d.pages[0].extra = 1; }, (d) => { delete d.pages[1].name; }],
  'node-shape': [(d) => { d.nodes.card.type = 'blob'; }, (d) => { d.nodes.title.children = []; }],
  'id-form': [(d) => { d.pages[1].id = 'bad id'; }],
  'id-unique': [(d) => { d.pages[1].id = 'p-main'; }],
  tree: [(d) => { d.nodes.badge.parent = 'card'; }, (d) => { d.nodes.card.children.push('card'); }],
  keys: [(d) => { d.nodes.card.bogus = 1; }, (d) => { d.nodes.buy.overrides['button-label'].name = 'X'; }],
  required: [(d) => { delete d.nodes.icon.path; }],
  classes: [(d) => { d.nodes.card.opacity = 2; }, (d) => { d.pages[0].name = 'n'.repeat(201); }],
  tokens: [(d) => { d.tokens.space.s.$value = { value: 1, unit: 'em' }; }, (d) => { d.tokens.bad = 5; }],
  refs: [(d) => { d.nodes.title.color = { $ref: 'color.nope' }; }, (d) => { d.nodes.buy.variant = 'nope'; }],
  components: [(d) => { d.nodes.inner = { type: 'component', parent: 'button', children: [] }; d.nodes.button.children.push('inner'); }],
  'instance-cycle': [(d) => { d.nodes.self = { type: 'instance', parent: 'button', component: 'button' }; d.nodes.button.children.push('self'); }],
  limits: [(d) => { d.tokens.a = { b: { c: { d: { e: { f: { g: { h: { i: { $type: 'number', $value: 1 } } } } } } } } }; }, (d) => { for (let i = 0; i < 31; i++) d.nodes.button.props[`p${i}`] = { type: 'bool', default: true, target: { id: 'button-bg', prop: 'visible' } }; }],
};

// ---- the tests ----

test('canvas module: fixtures: every document is valid', async (t) => {
  const canvas = await load();
  const docs = documentsInFixtures();
  let imageDocs = 0;
  for (const { label, doc } of docs) {
    const d = deepFreeze(clone(doc));
    assert.deepEqual(sameErrors(canvas, d, { images: FIXTURE_IMAGES }, label), [], `${label}: valid`);
    const none = sameErrors(canvas, d, { images: new Set() }, `${label}, no images`);
    if (isObj(d.nodes) && Object.values(d.nodes).some((n) => isObj(n) && n.type === 'image')) {
      imageDocs += 1;
      assert.ok(none.some((e) => e.rule === 'refs'), `${label}: with no images, its image node has a refs entry`);
    }
  }
  const by = (k) => docs.filter((x) => x.kind === k).length;
  t.diagnostic(`documents: ${by('fixture')} fixtures, ${by('http')} doc route responses, ${by('exchange')} stated by exchanges; ${imageDocs} hold an image`);
  assert.ok(by('fixture') >= 3 && by('http') >= 1 && by('exchange') >= 1, 'documents of each source checked');
  assert.ok(imageDocs >= 1, 'a document holding an image checked');
});

test('canvas module: fixtures: every message edit', async (t) => {
  const { files, records } = await messageRecords();
  t.diagnostic(`${files.length} message fixtures, ${records.length} judgements`);
  assert.ok(files.length >= 2, 'message fixtures found');
  assert.equal(records.length, files.length * docFixtureNames().length * 2, 'each on every document, bounded and not');
  assert.ok(records.some((x) => x.why === null) && records.some((x) => x.why !== null), 'some applied, some refused');
});

test('canvas module: fixtures: every local fixture', async (t) => {
  const { files, records } = await localRecords();
  t.diagnostic(`${files.length} local and edit route fixtures, ${records.length} with an ops array judged`);
  const withOps = files.filter((f) => { const b = fixture(f).request.body; return isObj(b) && Array.isArray(b.ops); });
  assert.deepEqual(records.map((x) => x.from), withOps, 'every fixture with an ops array judged');
  assert.ok(records.length >= 2, 'local fixtures judged');
});

test("canvas module: fixtures: every exchange's edits", async (t) => {
  const { files, per } = await exchangeRecords();
  for (const p of per) t.diagnostic(`${p.file}: ${p.judged} judged, ${p.applied} applied and ${p.refused} refused as stated, ${p.docs} docs compared`);
  const sum = (k) => per.reduce((s, p) => s + p[k], 0);
  assert.ok(files.length >= 1, 'exchanges found');
  // floors at today's fixtures' totals, so a replay that silently stops matching most outcomes fails
  assert.ok(sum('applied') >= 37, `applied edits matched to their exchanges (${sum('applied')})`);
  assert.ok(sum('refused') >= 46, `refused edits matched to their exchanges (${sum('refused')})`);
  assert.ok(sum('docs') >= 27, `stated docs compared (${sum('docs')})`);
});

test('canvas module: fixtures: every file accounted for', () => {
  assert.deepEqual(fixtureAccountProblems(FIXTURES), [], 'every fixture in a named category, no document or edit in the others');
  for (const c of FIXTURE_CATEGORIES.filter((x) => x.checked)) assert.ok(fixturesIn(FIXTURES, c.name).length >= 1, `a ${c.name} fixture found`);
});

test('canvas module: corpus: apply and validate agree with the fake', async (t) => {
  const { edits, generated, applied, reached, pageApplied, byGen, msByGen } = await corpus();
  t.diagnostic(`edits by fixture and generator: ${JSON.stringify(byGen)}`);
  t.diagnostic(`ms by fixture and generator: ${JSON.stringify(msByGen)}`);
  t.diagnostic(`${edits} edits, ${reached} documents reached; ops generated ${JSON.stringify(generated)}, applied ${JSON.stringify(applied)}; page ops applied ${JSON.stringify(pageApplied)}`);
  assert.ok(edits >= 2000, `at least 2000 edits (${edits})`);
  for (const k of fake.OPS) {
    assert.ok(generated[k] >= 50, `${k}: at least 50 generated (${generated[k]})`);
    assert.ok(applied[k] >= 20, `${k}: at least 20 applied (${applied[k]})`);
  }
  assert.ok(generated.malformed >= 20, 'malformed ops generated');
  for (const k of Object.keys(pageApplied)) assert.ok(pageApplied[k] >= 1, `a page ${k} applied`);
});

test('canvas module: rules: each broken copy', async () => {
  const canvas = await load();
  const base = fixture('doc-every-type.json');
  assert.deepEqual(Object.keys(BROKEN).sort(), fake.DOC_RULES.map((r) => r.rule).sort(), 'a broken copy for every rule');
  for (const { rule } of fake.DOC_RULES) {
    BROKEN[rule].forEach((breakIt, i) => {
      const d = clone(base);
      breakIt(d);
      deepFreeze(d);
      const errs = sameErrors(canvas, d, { images: FIXTURE_IMAGES }, `${rule} copy ${i + 1}`);
      assert.ok(errs.some((e) => e.rule === rule), `${rule} copy ${i + 1}: the rule is listed (${errs.map((e) => e.rule).join(', ')})`);
    });
  }
});

// ---- the done-when tests (C8 to C12) ----
//
// Each refusal is asserted with the code the contract states (§4, §6, §7), on a deep-frozen document,
// and returns that very object; the fake is asked the same and must agree.

const writtenBytes = (d) => Buffer.byteLength(`${JSON.stringify(d, null, 2)}\n`);
const onPage = (doc, op) => (op.op === 'add' ? op.node.type === 'page' : op.op !== 'token' && pageIds(doc).includes(op.id));
const brief = (ops) => { const s = JSON.stringify(ops); return s.length > 160 ? `${s.slice(0, 160)}…` : s; };

// An edit that must apply; its document, deep-frozen.
function mustApply(canvas, doc, ops, opts, label) {
  const r = canvas.apply(doc, ops, opts);
  assert.equal(r.why, null, `${label}: applies (${brief(ops)})`);
  assert.equal(fake.applyEdit(doc, ops, opts).why, null, `${label}: the fake applies it too`);
  return deepFreeze(r.doc);
}
// An edit that must be refused with `code`, the document (deep-frozen) unchanged: the same object back.
function mustRefuse(canvas, doc, ops, opts, code, label) {
  deepFreeze(doc);
  const r = canvas.apply(doc, ops, opts);
  assert.equal(r.why, code, `${label}: refused ${code} (${brief(ops)})`);
  assert.equal(r.doc, doc, `${label}: the document unchanged (the same object)`);
  assert.equal(fake.applyEdit(doc, ops, opts).why, code, `${label}: the fake refuses it ${code} too`);
}

const EVERY = { images: FIXTURE_IMAGES };
const everyType = () => deepFreeze(fixture('doc-every-type.json'));
const rect = (id, parent, more = {}) => ({ op: 'add', node: { id, type: 'rect', parent, ...more }, after: null });
const kids = (d, id) => (pageIds(d).includes(id) ? d.pages.find((pg) => pg.id === id).children : d.nodes[id].children);

// C8
test('canvas module: ops: each applied twice is the same as once', async (t) => {
  const canvas = await load();
  const edits = await appliedSingleEdits();
  const counts = Object.fromEntries(fake.OPS.map((k) => [k, 0]));
  const pages = { add: 0, del: 0, move: 0, set: 0 };
  let unbounded = 0;
  const t0 = Date.now();
  for (const { doc, op, opts, from } of edits) {
    const label = `${from}: ${brief([op])}`;
    const first = canvas.apply(doc, [op], opts);
    assert.equal(first.why, null, `${label}: applies once`);
    deepFreeze(first.doc);
    const again = canvas.apply(first.doc, [op], opts);
    assert.equal(again.why, null, `${label}: applies again`);
    assert.equal(again.doc.rev, first.doc.rev + 1, `${label}: again raises rev by one`);
    assert.deepStrictEqual({ ...again.doc, rev: first.doc.rev }, first.doc, `${label}: again is the same document but rev`);
    // the op twice in one edit; a page's bound lifted when the doubled ops alone would pass it
    let twiceOpts = opts;
    if (opts.maxOpsBytes !== null && Buffer.byteLength(JSON.stringify([op, op])) > fake.LIMITS.editOpsBytes) {
      twiceOpts = { ...opts, maxOpsBytes: null };
      unbounded += 1;
    }
    const twice = canvas.apply(doc, [op, op], twiceOpts);
    assert.equal(twice.why, null, `${label}: [op, op] applies`);
    assert.deepStrictEqual(twice.doc, first.doc, `${label}: [op, op] is the same document as [op]`);
    counts[op.op] += 1;
    if (onPage(doc, op)) pages[op.op] += 1;
  }
  t.diagnostic(`${edits.length} applied single-op edits in ${Date.now() - t0} ms; by op ${JSON.stringify(counts)}; page ops ${JSON.stringify(pages)}; ${unbounded} doubled edits judged unbounded`);
  for (const k of fake.OPS) assert.ok(counts[k] >= 1, `a ${k} checked (${counts[k]})`);
  for (const k of Object.keys(pages)) assert.ok(pages[k] >= 1, `a page ${k} checked (${pages[k]})`);
});

// C9
test('canvas module: ops: add of an existing id with another type or parent is exists', async () => {
  const canvas = await load();
  const doc = everyType();
  const cases = [
    ['another type, the same parent', { id: 'icon', type: 'rect', parent: 'card' }],
    ['the same type, another parent', { id: 'icon', type: 'vector', parent: 'loose', path: 'M0 0' }],
    ['the same type, another page parent', { id: 'card', type: 'frame', parent: 'p-parts' }],
    ["a node with a page's id", { id: 'p-parts', type: 'rect', parent: 'card' }],
    ["a page with a node's id", { id: 'card', type: 'page', parent: null, name: 'Card page' }],
  ];
  for (const [label, node] of cases) mustRefuse(canvas, doc, [{ op: 'add', node, after: null }], EVERY, 'exists', label);
  // the same type and parent: its properties as sets, its place kept (after null would put a new one first)
  const at = doc.nodes.card.children.indexOf('icon');
  assert.ok(at > 0, 'icon is not first in card');
  const got = mustApply(canvas, doc, [{ op: 'add', node: { id: 'icon', type: 'vector', parent: 'card', name: 'Icon 2', opacity: 0.5 }, after: null }], EVERY, 'the same type and parent');
  const want = clone(doc);
  want.rev += 1;
  want.nodes.icon.name = 'Icon 2';
  want.nodes.icon.opacity = 0.5;
  assert.deepStrictEqual(got, want, 'the same type and parent: only its properties change');
  assert.equal(got.nodes.card.children.indexOf('icon'), at, 'its index in its parent is unchanged');
  // a page added again with its own id sets its name, in place
  const pg = mustApply(canvas, doc, [{ op: 'add', node: { id: 'p-parts', type: 'page', parent: null, name: 'Parts 2' }, after: null }], EVERY, 'a page again');
  assert.deepEqual(pg.pages.map((p) => [p.id, p.name]), [['p-main', 'Checkout'], ['p-parts', 'Parts 2']], 'a page added again: its name set, its place kept');
});

// C10
test('canvas module: ops: a move into itself or its subtree is cycle', async () => {
  const canvas = await load();
  const doc = everyType();
  mustRefuse(canvas, doc, [{ op: 'move', id: 'card', parent: 'card', after: null }], EVERY, 'cycle', 'card into itself');
  mustRefuse(canvas, doc, [{ op: 'move', id: 'card', parent: 'actions', after: null }], EVERY, 'cycle', 'card into its child actions');
  // a chain p1 > a > b > c > d, each a frame
  const chain = { canvas: 1, rev: 3, tokens: {}, pages: [{ id: 'p1', name: 'P', children: ['a'] }], nodes: {} };
  ['a', 'b', 'c', 'd'].forEach((id, i, all) => {
    chain.nodes[id] = { type: 'frame', parent: i ? all[i - 1] : 'p1', children: i < all.length - 1 ? [all[i + 1]] : [] };
  });
  deepFreeze(chain);
  assert.deepEqual(canvas.validate(chain), [], 'the chain is valid');
  for (const [into, what] of [['a', 'itself'], ['b', 'a child'], ['c', 'a grandchild'], ['d', 'a descendant three down']]) {
    mustRefuse(canvas, chain, [{ op: 'move', id: 'a', parent: into, after: null }], {}, 'cycle', `a into ${what}`);
  }
  mustRefuse(canvas, chain, [{ op: 'move', id: 'b', parent: 'd', after: null }], {}, 'cycle', 'b into its grandchild');
  // the walk is up from the new parent: an ancestor into a sibling's subtree is no cycle
  mustApply(canvas, chain, [{ op: 'move', id: 'd', parent: 'a', after: null }], {}, 'd up under a');
});

// C11
test('canvas module: ops: add or move after a gone sibling places last', async () => {
  const canvas = await load();
  const doc = everyType();
  const last = (d, holder) => kids(d, holder)[kids(d, holder).length - 1];
  const cases = [
    ['an add under a page, after nothing', [{ ...rect('n1', 'p-main'), after: 'nope' }], 'p-main', 'n1'],
    ['an add under a frame, after nothing', [{ ...rect('n1', 'card'), after: 'nope' }], 'card', 'n1'],
    ['an add under a frame, after a sibling deleted in the edit', [{ op: 'del', id: 'rule' }, { ...rect('n1', 'card'), after: 'rule' }], 'card', 'n1'],
    ['an add under a page, after a sibling deleted in the edit', [{ op: 'del', id: 'loose' }, { ...rect('n1', 'p-main'), after: 'loose' }], 'p-main', 'n1'],
    ['a move to another parent, after nothing', [{ op: 'move', id: 'badge', parent: 'card', after: 'nope' }], 'card', 'badge'],
    ['a move in its own parent, after nothing', [{ op: 'move', id: 'title', parent: 'card', after: 'nope' }], 'card', 'title'],
    ['a move after a sibling deleted in the edit', [{ op: 'del', id: 'dot' }, { op: 'move', id: 'title', parent: 'card', after: 'dot' }], 'card', 'title'],
  ];
  for (const [label, ops, holder, id] of cases) {
    const before = kids(doc, holder).filter((x) => x !== id);
    const got = mustApply(canvas, doc, ops, EVERY, label);
    assert.equal(last(got, holder), id, `${label}: placed last`);
    assert.equal(kids(got, holder).filter((x) => x === id).length, 1, `${label}: listed once`);
    assert.deepEqual(kids(got, holder).slice(0, -1), before.filter((x) => own(got.nodes, x)), `${label}: the others in their order`);
  }
  const page = mustApply(canvas, doc, [{ op: 'add', node: { id: 'p3', type: 'page', parent: null, name: 'Three' }, after: 'nope' }], EVERY, 'a page add after nothing');
  assert.deepEqual(pageIds(page), ['p-main', 'p-parts', 'p3'], 'a page add after nothing: placed last');
  const moved = mustApply(canvas, doc, [{ op: 'move', id: 'p-main', parent: null, after: 'nope' }], EVERY, 'a page move after nothing');
  assert.deepEqual(pageIds(moved), ['p-parts', 'p-main'], 'a page move after nothing: placed last');
});

// ---- C12: the limits ----

const L = fake.LIMITS;
const blank = () => ({ canvas: 1, rev: 0, tokens: {}, pages: [{ id: 'p1', name: 'Page 1', children: [] }], nodes: {} });
// Puts a node into a document being built, listed last in its parent.
function place(d, id, type, parent, more = {}) {
  d.nodes[id] = { type, parent, ...more };
  if (CONTAINER_TYPES.includes(type)) d.nodes[id].children = [];
  kids(d, parent).push(id);
  return d;
}
const id5 = (prefix, i) => `${prefix}${String(i).padStart(5, '0')}`;
// A valid SVG path of exactly n bytes (n ≥ 2): a move and zeros.
const pathOf = (n) => `M0${' 0'.repeat(Math.floor((n - 2) / 2))}${(n - 2) % 2 ? '0' : ''}`;
// The properties a rect takes as overrides, ten of them, and values for them.
const OVERRIDE_PROPS = [['visible', false], ['opacity', 0.5], ['x', 1], ['y', 2], ['size.w', 10], ['size.h', 10], ['fill', '#000000'], ['stroke', '#ffffff'], ['strokeWidth', 1], ['radius', 2]];
// A component `comp` holding rects r0..r<n-1>, and an instance `inst` of it, on p1.
function withComponent(n) {
  const d = place(blank(), 'comp', 'component', 'p1', { props: {}, variants: {} });
  for (let i = 0; i < n; i++) place(d, `r${i}`, 'rect', 'comp');
  place(d, 'inst', 'instance', 'p1', { component: 'comp' });
  return d;
}
// An override map of `count` entries over r0, r1, … (ten each).
function overrideMap(count) {
  const m = {};
  for (let i = 0; i < count; i++) {
    const [prop, v] = OVERRIDE_PROPS[i % 10];
    (m[`r${Math.floor(i / 10)}`] ??= {})[prop] = v;
  }
  return m;
}
const entryCount = (m) => Object.values(m).reduce((s, o) => s + Object.keys(o).length, 0);
// A valid document exactly `target` bytes as written, holding an empty-named rect `f`: text nodes of
// 10000 characters, the last cut to fit.
function ofBytes(target) {
  const d = place(blank(), 'f', 'rect', 'p1', { name: '' });
  const full = 'x'.repeat(L.textChars);
  const n = Math.floor((target - writtenBytes(d)) / (L.textChars + 200));
  for (let i = 0; i < n; i++) place(d, id5('t', i), 'text', 'p1', { text: full });
  place(d, 'tlast', 'text', 'p1', { text: '' });
  let need = target - writtenBytes(d);
  for (let i = n; need > L.textChars; i++) {
    place(d, id5('t', i), 'text', 'p1', { text: full });
    need = target - writtenBytes(d);
  }
  assert.ok(need >= 0, `the filler fits (${need})`);
  d.nodes.tlast.text = 'x'.repeat(need);
  assert.equal(writtenBytes(d), target, 'the document is the bytes asked');
  return d;
}
const tokenCount = (d) => tokenList(d).filter(([, tk]) => tk).length;
const NUM = { $type: 'number', $value: 1 };

// One limit: `at` applies to `doc` and `check` holds on what it reaches; `over` (on what `at` reached,
// or on `doc` when `fromStart`) is refused `code`, the document unchanged.
function edge(canvas, ms, name, { doc, at, over, opts = {}, overOpts = opts, code, fromStart = false, check }) {
  const t0 = Date.now();
  deepFreeze(doc);
  const reached = mustApply(canvas, doc, at, opts, `${name}: at the limit`);
  if (check) check(reached);
  mustRefuse(canvas, fromStart ? doc : reached, over, overOpts, code, `${name}: over by one`);
  ms[name] = Date.now() - t0;
  return reached;
}

test('canvas module: limits: each refused limit at and over', async (t) => {
  const canvas = await load();
  const ms = {};
  const t0 = Date.now();

  let d = blank();
  for (let i = 0; i < L.nodes - 1; i++) place(d, id5('n', i), 'rect', 'p1');
  edge(canvas, ms, 'nodes', {
    doc: d, at: [rect('at', 'p1')], over: [rect('over', 'p1')], code: 'limit',
    check: (r) => assert.equal(Object.keys(r.nodes).length, L.nodes, 'nodes: the limit reached'),
  });

  d = blank();
  for (let i = 2; i < L.pages; i++) d.pages.push({ id: `p${i}`, name: '', children: [] });
  const page = (id) => [{ op: 'add', node: { id, type: 'page', parent: null, name: id }, after: null }];
  edge(canvas, ms, 'pages', {
    doc: d, at: page('pat'), over: page('pover'), code: 'limit',
    check: (r) => assert.equal(r.pages.length, L.pages, 'pages: the limit reached'),
  });

  d = blank();
  d.tokens.t = {};
  for (let i = 0; i < L.tokens - 1; i++) d.tokens.t[`k${i}`] = { ...NUM };
  edge(canvas, ms, 'tokens', {
    doc: d, at: [{ op: 'token', path: 't.at', value: NUM }], over: [{ op: 'token', path: 't.over', value: NUM }], code: 'limit',
    check: (r) => assert.equal(tokenCount(r), L.tokens, 'tokens: the limit reached'),
  });

  const segs = (n) => Array.from({ length: n }, (_, i) => `s${i}`);
  edge(canvas, ms, 'tokenDepth', {
    doc: blank(), at: [{ op: 'token', path: segs(L.tokenDepth).join('.'), value: NUM }], over: [{ op: 'token', path: [...segs(L.tokenDepth - 1), 'o0', 'o1'].join('.'), value: NUM }], code: 'limit',
    check: (r) => assert.equal(segs(L.tokenDepth).reduce((g, k) => g[k], r.tokens).$value, 1, `tokenDepth: a token ${L.tokenDepth} deep`),
  });

  d = blank();
  for (let i = 1; i < L.depth; i++) place(d, `f${i}`, 'frame', i === 1 ? 'p1' : `f${i - 1}`);
  edge(canvas, ms, 'depth', {
    doc: d, at: [{ ...rect('at', `f${L.depth - 1}`), node: { id: `f${L.depth}`, type: 'frame', parent: `f${L.depth - 1}` } }],
    over: [rect('over', `f${L.depth}`)], code: 'limit',
    check: (r) => { let n = 0; for (let c = `f${L.depth}`; own(r.nodes, c); c = r.nodes[c].parent) n += 1; assert.equal(n, L.depth, 'depth: a node at the limit'); },
  });

  const rects = Math.ceil(L.overrideEntries / 10) + 1;
  const [atProp, atValue] = OVERRIDE_PROPS[(L.overrideEntries - 1) % 10];
  const atTarget = `r${Math.floor((L.overrideEntries - 1) / 10)}`;
  const overTarget = `r${rects - 1}`;
  d = withComponent(rects);
  d.nodes.inst.overrides = overrideMap(L.overrideEntries - 1);
  edge(canvas, ms, "overrideEntries (an instance's)", {
    doc: d, at: [{ op: 'set', id: 'inst', prop: `overrides.${atTarget}.${atProp}`, value: atValue }],
    over: [{ op: 'set', id: 'inst', prop: `overrides.${overTarget}.visible`, value: false }], code: 'limit',
    check: (r) => assert.equal(entryCount(r.nodes.inst.overrides), L.overrideEntries, "overrideEntries (an instance's): the limit reached"),
  });
  d = withComponent(rects);
  d.nodes.comp.variants.v = overrideMap(L.overrideEntries - 1);
  edge(canvas, ms, "overrideEntries (a variant's)", {
    doc: d, at: [{ op: 'set', id: 'comp', prop: `variants.v.${atTarget}.${atProp}`, value: atValue }],
    over: [{ op: 'set', id: 'comp', prop: `variants.v.${overTarget}.visible`, value: false }], code: 'limit',
    check: (r) => assert.equal(entryCount(r.nodes.comp.variants.v), L.overrideEntries, "overrideEntries (a variant's): the limit reached"),
  });

  const def = { type: 'bool', default: true, target: { id: 'r0', prop: 'visible' } };
  d = withComponent(1);
  for (let i = 0; i < L.props - 1; i++) d.nodes.comp.props[`p${i}`] = { ...def, target: { ...def.target } };
  edge(canvas, ms, 'props', {
    doc: d, at: [{ op: 'set', id: 'comp', prop: 'props.pat', value: def }], over: [{ op: 'set', id: 'comp', prop: 'props.pover', value: def }], code: 'limit',
    check: (r) => assert.equal(Object.keys(r.nodes.comp.props).length, L.props, 'props: the limit reached'),
  });

  const variant = { r0: { visible: false } };
  d = withComponent(1);
  for (let i = 0; i < L.variants - 1; i++) d.nodes.comp.variants[`v${i}`] = clone(variant);
  edge(canvas, ms, 'variants', {
    doc: d, at: [{ op: 'set', id: 'comp', prop: 'variants.vat', value: variant }], over: [{ op: 'set', id: 'comp', prop: 'variants.vover', value: variant }], code: 'limit',
    check: (r) => assert.equal(Object.keys(r.nodes.comp.variants).length, L.variants, 'variants: the limit reached'),
  });

  // canvas.json as written: 100 bytes short, then a name of 100 (at) or 101 (over) characters
  const name = (n) => [{ op: 'set', id: 'f', prop: 'name', value: 'x'.repeat(n) }];
  edge(canvas, ms, 'docBytes', {
    doc: ofBytes(L.docBytes - 100), at: name(100), over: name(101), code: 'limit', fromStart: true,
    check: (r) => assert.equal(writtenBytes(r), L.docBytes, 'docBytes: canvas.json at the limit'),
  });

  d = place(blank(), 'f', 'rect', 'p1', { name: '' });
  const others = L.folderBytes - (writtenBytes(d) + 100);
  edge(canvas, ms, 'folderBytes', {
    doc: d, at: name(100), over: name(101), opts: { folderBytes: others }, code: 'limit', fromStart: true,
    check: (r) => assert.equal(writtenBytes(r) + others, L.folderBytes, 'folderBytes: the folder at the limit'),
  });

  // an edit's ops as JSON: exactly 64 KB (at), one byte more (over); over, unbounded, applies
  d = place(blank(), 'v', 'vector', 'p1', { path: 'M0 0' });
  const setPath = (n) => [{ op: 'set', id: 'v', prop: 'path', value: pathOf(n) }];
  const around = Buffer.byteLength(JSON.stringify(setPath(2))) - 2;
  const atOps = setPath(L.editOpsBytes - around);
  const overOps = setPath(L.editOpsBytes - around + 1);
  assert.equal(Buffer.byteLength(JSON.stringify(atOps)), L.editOpsBytes, 'editOpsBytes: the at edit is 64 KB');
  assert.equal(Buffer.byteLength(JSON.stringify(overOps)), L.editOpsBytes + 1, 'editOpsBytes: the over edit is a byte more');
  edge(canvas, ms, 'editOpsBytes', { doc: d, at: atOps, over: overOps, code: 'limit', fromStart: true });
  const free = mustApply(canvas, d, overOps, { maxOpsBytes: null }, 'editOpsBytes: over with maxOpsBytes null');
  assert.equal(free.nodes.v.path, overOps[0].value, 'editOpsBytes: unbounded, the path set');

  d = blank();
  d.pages.push({ id: 'p2', name: '', children: [] });
  place(d, 'gone', 'rect', 'p1');
  edge(canvas, ms, 'the last page', {
    doc: d, at: [{ op: 'del', id: 'p2' }], over: [{ op: 'del', id: 'p1' }], code: 'limit',
    check: (r) => assert.deepEqual(pageIds(r), ['p1'], 'the last page: one left'),
  });

  t.diagnostic(`ms per limit ${JSON.stringify(ms)}; the test ${Date.now() - t0} ms`);
});

test('canvas module: limits: each refused value at and over', async (t) => {
  const canvas = await load();
  const ms = {};
  const t0 = Date.now();
  const comp40 = `k${'x'.repeat(L.idChars - 1)}`;
  const d = withComponent(1);
  place(d, 'fr', 'frame', 'p1');
  place(d, 'tx', 'text', 'p1');
  place(d, 'v', 'vector', 'p1', { path: 'M0 0' });
  place(d, comp40, 'component', 'p1');
  deepFreeze(d);
  assert.deepEqual(canvas.validate(d), [], 'the document is valid');
  const set = (id, prop, value) => [{ op: 'set', id, prop, value }];
  const both = (name, at, over, code = 'value', opts = {}) => edge(canvas, ms, name, { doc: d, at, over, code, opts, fromStart: true });
  const s = (n, c = 'x') => c.repeat(n);
  const pname = (n) => `p${s(n - 1, 'a')}`;
  const def = { type: 'bool', default: true, target: { id: 'r0', prop: 'visible' } };
  const variant = { r0: { visible: false } };

  both('tracks', set('fr', 'layout.columns', Array(L.tracks).fill('auto')), set('fr', 'layout.columns', Array(L.tracks + 1).fill('auto')));
  both('nameChars (a node)', set('fr', 'name', s(L.nameChars)), set('fr', 'name', s(L.nameChars + 1)));
  both('nameChars (a page)', set('p1', 'name', s(L.nameChars)), set('p1', 'name', s(L.nameChars + 1)));
  both('textChars', set('tx', 'text', s(L.textChars)), set('tx', 'text', s(L.textChars + 1)));
  both('pathBytes (a local apply)', set('v', 'path', pathOf(L.pathBytes)), set('v', 'path', pathOf(L.pathBytes + 1)), 'value', { maxOpsBytes: null });
  both('figmaChars', set('fr', 'figma', s(L.figmaChars, 'a')), set('fr', 'figma', s(L.figmaChars + 1, 'a')));
  const n40 = pname(L.propNameChars);
  const n41 = pname(L.propNameChars + 1);
  both('propNameChars (the whole props map)', set('comp', 'props', { [n40]: def }), set('comp', 'props', { [n41]: def }));
  both('propNameChars (the whole variants map)', set('comp', 'variants', { [n40]: variant }), set('comp', 'variants', { [n41]: variant }));
  both('propNameChars (a props entry path)', set('comp', `props.${n40}`, def), set('comp', `props.${n41}`, def), 'prop');
  both('propNameChars (a variants entry path)', set('comp', `variants.${n40}`, variant), set('comp', `variants.${n41}`, variant), 'prop');
  const tok = (n) => [{ op: 'token', path: `g.${s(n, 'a')}`, value: NUM }];
  both("tokenSegmentChars (a token op's path)", tok(L.tokenSegmentChars), tok(L.tokenSegmentChars + 1), 'shape');
  both("idChars (an add's node.id)", [rect(s(L.idChars, 'a'), 'p1')], [rect(s(L.idChars + 1, 'a'), 'p1')], 'shape');
  both("idChars (a set's id)", set(comp40, 'name', 'n'), set(`${comp40}x`, 'name', 'n'), 'shape');
  both("idChars (a del's id)", [{ op: 'del', id: comp40 }], [{ op: 'del', id: `${comp40}x` }], 'shape');
  both("idChars (a move's id)", [{ op: 'move', id: comp40, parent: 'p1', after: null }], [{ op: 'move', id: `${comp40}x`, parent: 'p1', after: null }], 'shape');
  both('idChars (a componentRef value)', set('inst', 'component', comp40), set('inst', 'component', `${comp40}x`));

  t.diagnostic(`ms per limit ${JSON.stringify(ms)}; the test ${Date.now() - t0} ms`);
});
