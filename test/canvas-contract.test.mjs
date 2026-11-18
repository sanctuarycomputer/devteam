// canvas-doc@1 and canvas@1 (test/contracts/canvas.md): the document's rules, the ops and the
// messages as code in test/lib/canvas-fake.mjs, held to one another here. One test, A1, whose subtests
// run in order: the rules on inline documents and messages (each rule, class and kind with a broken
// copy), whole-edit judgement, resolution order, unicode, scale, and the canvas test-file rule that
// keeps the measure's names honest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TYPES, PROPS, CLASSES, TOKEN_TYPES, DOC_RULES, OPS, PAGE_KINDS, SERVER_KINDS, HTTP_KINDS, REFUSALS, ROUTES, LIMITS, LIMIT_ANSWERS, RANGES,
  NODE_ID_RE, SLUG_RE, CLIENT_RE, SESSION_RE, BY_RE, IMAGE_FILE_RE, HOSTILE_MARKERS, PAUSE_WHYS, CLOSE_WHYS,
  docErrors, opErrors, applyEdit, resolve, makeSeqBook, shapeErrors, freeTexts, skipProblems, measureProblems, SKIP_CASES, MEASURE_CASES,
} from './lib/canvas-fake.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const clone = (v) => JSON.parse(JSON.stringify(v));
const IMG = '0123456789abcdef.png';
const OPTS = { images: new Set([IMG]), folderBytes: 0 };
const long = (n, ch = 'a') => ch.repeat(n);
const PROTO_NAMES = Object.getOwnPropertyNames(Object.prototype).sort();
const CLIENT = 'abcdefghij012345';
const SESSION = '0123456789abcdef';

// A small valid document with every node type, every token type, a component with a text and a bool
// prop and a variant, and an instance with a variant, prop values and overrides (one five-level conflict
// on ct's text).
function small() {
  return {
    canvas: 1,
    rev: 3,
    tokens: {
      color: { brand: { $type: 'color', $value: { colorSpace: 'srgb', components: [0.2, 0.4, 0.8], alpha: 1, hex: '#3366cc' } } },
      space: { m: { $type: 'dimension', $value: { value: 12, unit: 'px' } }, neg: { $type: 'dimension', $value: { value: -4, unit: 'px' } } },
      type: {
        body: {
          $type: 'typography',
          $value: { fontFamily: 'sans', fontSize: { value: 16, unit: 'px' }, fontWeight: 400, letterSpacing: { value: 0, unit: 'px' }, lineHeight: 1.4 },
        },
      },
      fam: { $type: 'fontFamily', $value: 'serif' },
      weight: { $type: 'fontWeight', $value: 700 },
      ratio: { $type: 'number', $value: 1.5 },
    },
    pages: [{ id: 'p1', name: 'Page one', children: ['f1', 'c1', 'n1'] }, { id: 'p2', name: 'Two', children: [] }],
    nodes: {
      f1: {
        type: 'frame', parent: 'p1', name: 'Card', children: ['t1', 'r1', 'e1', 'v1', 'i1'],
        layout: { mode: 'row', gap: { $ref: 'space.m' }, padding: [8, 8, 8, 8], columns: ['auto', '2fr', 100] },
        size: { w: 'fill', h: 'hug' }, fill: { $ref: 'color.brand' },
      },
      t1: { type: 'text', parent: 'f1', name: 'Title', text: 'Hello', font: { $ref: 'type.body' }, color: '#112233' },
      r1: { type: 'rect', parent: 'f1', fill: '#fff', radius: 4, figma: '1:23' },
      e1: { type: 'ellipse', parent: 'f1', stroke: '#000000ff', strokeWidth: 1 },
      v1: { type: 'vector', parent: 'f1', path: 'M0 0 L10,10 c1.5 -2e1 3 4 Z' },
      i1: { type: 'image', parent: 'f1', src: `images/${IMG}`, fit: 'contain' },
      c1: {
        type: 'component', parent: 'p1', name: 'Button', children: ['ct', 'cr'],
        props: {
          title: { type: 'text', default: 'Def', target: { id: 'ct', prop: 'text' } },
          shown: { type: 'bool', default: true, target: { id: 'cr', prop: 'visible' } },
        },
        variants: { dark: { cr: { fill: '#000000' }, ct: { text: 'Var' } } },
      },
      ct: { type: 'text', parent: 'c1', text: 'Base', font: { family: { $ref: 'fam' }, size: 14, weight: { $ref: 'weight' }, lineHeight: { $ref: 'ratio' } } },
      cr: { type: 'rect', parent: 'c1', fill: null },
      n1: {
        type: 'instance', parent: 'p1', component: 'c1', variant: 'dark',
        props: { title: 'Val', shown: false }, overrides: { ct: { text: 'Inst', 'size.w': 'fill' } },
      },
    },
  };
}
const minimal = () => ({ canvas: 1, rev: 0, tokens: {}, pages: [{ id: 'p1', name: '', children: [] }], nodes: {} });
const errs = (doc, opts = OPTS) => docErrors(doc, opts);
const rulesOf = (es) => es.map((e) => e.rule);

// ---- broken copies: every rule, every class ----

const RULE_BREAKS = {
  top: (d) => { d.canvas = 2; },
  'page-shape': (d) => { d.pages[1].extra = 1; },
  'node-shape': (d) => { d.nodes.r1.type = 'blob'; },
  'id-form': (d) => { d.nodes['a.b'] = { type: 'rect', parent: 'p2' }; d.pages[1].children.push('a.b'); },
  'id-unique': (d) => { d.pages.push({ id: 'p1', name: '', children: [] }); },
  keys: (d) => { d.nodes.r1.text = 'x'; },
  required: (d) => { delete d.nodes.v1.path; },
  classes: (d) => { d.nodes.r1.opacity = 2; },
  tree: (d) => { d.nodes.r1.parent = 'p2'; },
  components: (d) => { d.nodes.c2 = { type: 'component', parent: 'c1', children: [] }; d.nodes.c1.children.push('c2'); },
  tokens: (d) => { d.tokens.color.brand.$value = '#ffffff'; },
  refs: (d) => { d.nodes.t1.color = { $ref: 'color.nope' }; },
  'instance-cycle': (d) => { d.nodes.n2 = { type: 'instance', parent: 'c1', component: 'c1' }; d.nodes.c1.children.push('n2'); },
  limits: (d) => { for (let i = 0; i < 99; i++) d.pages.push({ id: `px${i}`, name: '', children: [] }); },
};

const CLASS_BREAKS = {
  color: (d) => { d.nodes.t1.color = 'red'; },
  paint: (d) => { d.nodes.r1.fill = 'red'; },
  dim: (d) => { d.nodes.r1.x = 100001; },
  len: (d) => { d.nodes.r1.radius = -1; },
  opacity: (d) => { d.nodes.r1.opacity = 1.5; },
  padding: (d) => { d.nodes.f1.layout.padding = [1, 2, 3]; },
  sizing: (d) => { d.nodes.r1.size = { w: 'auto' }; },
  tracks: (d) => { d.nodes.f1.layout.columns = ['1px']; },
  font: (d) => { d.nodes.t1.font = { family: 'comic', size: 16, weight: 400, lineHeight: 1.4 }; },
  pathData: (d) => { d.nodes.v1.path = 'X 1 2'; },
  imageSrc: (d) => { d.nodes.i1.src = 'https://example.com/a.png'; },
  name: (d) => { d.nodes.r1.name = long(201); },
  text: (d) => { d.nodes.t1.text = long(10001); },
  figmaId: (d) => { d.nodes.r1.figma = '1 23'; },
  bool: (d) => { d.nodes.r1.visible = 'yes'; },
  enum: (d) => { d.nodes.f1.layout.mode = 'flex'; },
  componentRef: (d) => { d.nodes.n1.component = 'c 1'; },
  variantName: (d) => { d.nodes.n1.variant = 5; },
  propDefs: (d) => { d.nodes.c1.props = []; },
  propDef: (d) => { d.nodes.c1.props.title = { type: 'text' }; },
  propValues: (d) => { d.nodes.n1.props = 'x'; },
  propValue: (d) => { d.nodes.n1.props.title = 5; },
  variants: (d) => { d.nodes.c1.variants = 'x'; },
  variant: (d) => { d.nodes.c1.variants.dark = []; },
  overrides: (d) => { d.nodes.n1.overrides = []; },
  override: (d) => { d.nodes.n1.overrides.ct = { color: 'red' }; },
};
// A class error's message starts `not <class>` with the class as a whole word.
const namesClass = (m, cls) => m.startsWith(`not ${cls}`) && !/[A-Za-z]/.test(m.charAt(`not ${cls}`.length));

// ---- broken messages: every kind ----

const SET_OP = { op: 'set', id: 'r1', prop: 'radius', value: 2 };
const AT = { page: 'canvas', tab: 'p1', peek: null, art: 'checkout@canvas', thread: null };
const MESSAGES = {
  edit: [{ t: 'edit', client: CLIENT, seq: 1, ops: [SET_OP] }, [
    (m) => { m.client = CLIENT.slice(1); }, (m) => { m.client = CLIENT.toUpperCase(); }, (m) => { m.seq = 0; },
    (m) => { m.seq = 1.5; }, (m) => { m.seq = 2 ** 53; }, (m) => { m.ops = {}; }, (m) => { m.t = 'edits'; },
  ]],
  select: [{ t: 'select', ids: ['r1', 'p1'] }, [
    (m) => { m.ids = Array.from({ length: 101 }, (_, i) => `n${i}`); }, (m) => { m.ids = ['a.b']; }, (m) => { m.ids = 'r1'; },
  ]],
  pong: [{ t: 'pong' }, [(m) => { m.t = 'ping'; }]],
  welcome: [{ t: 'welcome', canvas: 1, session: SESSION, rev: 3, you: { id: 'owner', conn: 'c1' } }, [
    (m) => { m.canvas = 2; }, (m) => { m.session = SESSION.toUpperCase(); }, (m) => { m.rev = -1; }, (m) => { m.you.id = long(65); },
    (m) => { m.you = { id: 'owner' }; },
  ]],
  ops: [{ t: 'ops', rev: 4, by: { id: 'ann', name: 'Ann', via: 'page' }, ack: { client: CLIENT, seq: 1 }, ops: [SET_OP] }, [
    (m) => { m.by.via = 'browser'; }, (m) => { m.ack = null; }, (m) => { m.ops = [{ op: 'set', id: 'r1' }]; }, (m) => { m.rev = 1.5; },
    (m) => { m.by = { id: 'supervisor', name: 'Someone', via: 'apply' }; m.ack = null; },
    (m) => { m.by = { id: 'supervisor', name: 'supervisor', via: 'apply' }; },
    (m) => { m.ack = { client: CLIENT, seq: 0 }; }, (m) => { m.by.name = ''; },
  ]],
  saved: [{ t: 'saved', rev: 4 }, [(m) => { m.rev = '4'; }]],
  refused: [{ t: 'refused', client: CLIENT, seq: 2, why: 'value' }, [(m) => { m.why = 'closed'; }, (m) => { m.seq = -2; }]],
  selections: [{ t: 'selections', people: [{ id: 'ann', name: 'Ann', ids: ['r1'] }, { id: 'bo', name: 'Bo', ids: [] }] }, [
    (m) => { m.people[0].ids = Array.from({ length: 101 }, (_, i) => `n${i}`); }, (m) => { m.people[1].id = 'ann'; },
    (m) => { m.people[0].name = ''; }, (m) => { m.people[0].level = 'full'; },
    (m) => { m.people = Array.from({ length: 51 }, (_, i) => ({ id: `p${i}`, name: 'P', ids: [] })); },
  ]],
  paused: [{ t: 'paused', why: 'branch-moved' }, [(m) => { m.why = 'landed'; }]],
  resumed: [{ t: 'resumed' }, [(m) => { m.t = 'resume'; }]],
  reload: [{ t: 'reload', session: SESSION }, [(m) => { m.session = 'short'; }]],
  closed: [{ t: 'closed', why: 'landed' }, [(m) => { m.why = 'index-dirty'; }]],
  ping: [{ t: 'ping' }, [(m) => { m.t = 'pong'; }]],
  'doc-response': [{ session: SESSION, rev: 3, doc: small(), repo: { name: 'a/b', public: true } }, [
    (m) => { m.repo.name = 'ab'; }, (m) => { m.repo.public = 'yes'; }, (m) => { m.doc.nodes.r1.opacity = 9; },
    (m) => { m.session = 'x'; }, (m) => { m.repo = { name: null, public: true }; },
  ]],
  'image-request': [{ name: 'photo.png', data: 'iVBORw0KGgo=' }, [(m) => { m.data = 'not base64!'; }, (m) => { m.name = 5; }, (m) => { m.data = 'abc'; }]],
  'image-response': [{ src: `images/${IMG}` }, [(m) => { m.src = 'images/0123456789abcdef.svg'; }, (m) => { m.src = IMG; }]],
  'local-request': [{ by: 'supervisor', via: 'apply', ops: [SET_OP] }, [(m) => { m.via = 'page'; }, (m) => { m.by = 'a b'; }, (m) => { m.ops = null; }]],
  'local-response': [{ rev: 5, edits: 1, saved: true }, [(m) => { m.saved = 'yes'; }, (m) => { m.edits = 0; }, (m) => { m.rev = -1; }]],
  'error-response': [{ why: 'no-session' }, [(m) => { m.why = 'nah'; }]],
  'note-anchor': [{ node: 'r1' }, [(m) => { m.node = long(65); }, (m) => { m.node = 'a\nb'; }, (m) => { m.node = ''; }, (m) => { m.node = '\ud800'; }]],
  'presence-here': [{ t: 'here', at: AT, visible: true }, [
    (m) => { m.at.page = 'board'; }, (m) => { m.at.art = 'checkout'; }, (m) => { m.at.tab = 'a.b'; }, (m) => { m.at.peek = 'kit-1'; },
    (m) => { m.at.art = 'Bad-Slug@canvas'; }, (m) => { m.visible = 'yes'; },
  ]],
  'presence-move': [{ t: 'move', a: { k: '@p1', x: 0.5, y: 0.25 } }, [
    (m) => { m.a.k = 'a.b'; }, (m) => { m.a.k = '@'; }, (m) => { m.a.x = 2; }, (m) => { m.a = 'r1'; },
  ]],
};
const MESSAGE_KINDS = [...PAGE_KINDS, ...SERVER_KINDS, ...HTTP_KINDS, 'note-anchor', 'presence-here', 'presence-move'];

// ---- applyEdit helpers: applied gives a new doc at rev + 1; refused gives the same doc, unchanged ----

function applied(doc, ops, opts = {}) {
  const before = clone(doc);
  const r = applyEdit(doc, ops, { ...OPTS, ...opts });
  assert.equal(r.why, null, `applied: ${JSON.stringify(ops).slice(0, 200)} (refused ${r.why}: ${JSON.stringify(docErrors(r.doc, OPTS).slice(0, 2))})`);
  assert.notEqual(r.doc, doc, 'a new document');
  assert.equal(r.doc.rev, doc.rev + 1, 'rev + 1');
  assert.deepEqual(doc, before, 'the old document is untouched');
  assert.deepEqual(errs(r.doc), [], 'the result is valid');
  return r.doc;
}
const seenCodes = new Set();
function refused(doc, ops, why, opts = {}) {
  const before = clone(doc);
  const r = applyEdit(doc, ops, { ...OPTS, ...opts });
  assert.equal(r.why, why, `refused ${why}: ${JSON.stringify(ops).slice(0, 200)}`);
  assert.equal(r.doc, doc, 'the same document');
  assert.deepEqual(doc, before, 'the document is unchanged');
  seenCodes.add(why);
}

// ---- scale: built by loops ----

function deep(levels) {
  const d = minimal();
  let parent = 'p1';
  for (let i = 1; i <= levels; i++) {
    const id = `d${i}`;
    d.nodes[id] = { type: 'frame', parent, children: [] };
    if (parent === 'p1') d.pages[0].children.push(id); else d.nodes[parent].children.push(id);
    parent = id;
  }
  return d;
}
function wide(count) {
  const d = minimal();
  for (let i = 0; i < count; i++) {
    const id = `w${i}`;
    d.nodes[id] = { type: 'rect', parent: 'p1' };
    d.pages[0].children.push(id);
  }
  return d;
}
const timed = (fn) => { const t0 = Date.now(); const v = fn(); return [v, Date.now() - t0]; };

// ---- the contract: its machine-read tables, found by their ### heading ----

const contract = () => fs.readFileSync(path.join(here, 'contracts', 'canvas.md'), 'utf8');
// Cells split at unescaped pipes; `\|` (a pipe inside a cell, as GitHub writes it) is read as `|`.
const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
const spans = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const first = (cell, what) => { const s = spans(cell); assert.ok(s.length > 0, `${what}: a code span in ${JSON.stringify(cell)}`); return s[0]; };
// The rows of the first table under `### <heading>` (before any other heading), its header checked.
function table(md, heading, header) {
  const lines = md.split('\n');
  const at = lines.flatMap((l, i) => (l === `### ${heading}` ? [i] : []));
  assert.equal(at.length, 1, `one ### ${heading} heading`);
  let i = at[0] + 1;
  while (i < lines.length && !lines[i].startsWith('|')) { assert.ok(!lines[i].startsWith('#'), `### ${heading} holds a table`); i++; }
  assert.deepEqual(cellsOf(lines[i] || ''), header, `### ${heading}: its header`);
  assert.match(lines[i + 1] || '', /^\|(?:\s*-+\s*\|)+$/, `### ${heading}: its separator`);
  const rows = [];
  for (i += 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const c = cellsOf(lines[i]);
    assert.equal(c.length, header.length, `### ${heading}: ${header.length} cells in ${lines[i]}`);
    rows.push(c);
  }
  assert.ok(rows.length > 0, `### ${heading} has rows`);
  return rows;
}
const sameSet = (got, want, what) => {
  assert.equal(new Set(got).size, got.length, `${what}: no row twice`);
  assert.deepEqual([...got].sort(), [...want].sort(), `${what}: the contract's rows and the code's, both ways`);
};
const has = (text, needle, where) => assert.ok(text.includes(needle), `${where} says ${JSON.stringify(needle)}`);
// The text from the `## ` heading naming `word` to the next `## ` heading (a `###` never cuts it).
function section(md, word) {
  const hit = md.split(/^## /m).filter((p) => p.split('\n', 1)[0].includes(word));
  assert.equal(hit.length, 1, `one ## section names ${word}`);
  return hit[0];
}
// Each needle once in its section, so it pins one rule (a needle found twice could survive the rule's removal).
const all = (md, word, needles) => {
  const s = section(md, word);
  for (const n of needles) {
    has(s, n, `section ${word}`);
    assert.equal(s.split(n).length - 1, 1, `section ${word} says ${JSON.stringify(n)} once`);
  }
};
// The ranges a..b in a cell, as numbers written plainly.
const rangesIn = (cell) => [...cell.matchAll(/(-?[0-9]+(?:\.[0-9]+)?)\.\.(-?[0-9]+(?:\.[0-9]+)?)/g)].map((m) => `${Number(m[1])}..${Number(m[2])}`);

// ---- the fixtures: every file under test/fixtures/canvas/ is of a known kind by its name ----

const FIX = path.join(here, 'fixtures', 'canvas');
const readFix = (rel) => JSON.parse(fs.readFileSync(path.join(FIX, rel), 'utf8'));
const MSG_KINDS = [...PAGE_KINDS, ...SERVER_KINDS];
const NAMED = [...MSG_KINDS.map((k) => [`msg-${k}`, k]), ['presence-here', 'presence-here'], ['presence-move', 'presence-move'], ['note-anchor', 'note-anchor']];
const MAGIC = {
  png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  gif: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8',
  webp: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};
// { kind: 'doc' | 'http' | 'exchange' | 'image' | 'message', shape? } or null for an unknown file.
function fixtureKind(rel) {
  if (rel.startsWith('images/')) return IMAGE_FILE_RE.test(rel.slice('images/'.length)) ? { kind: 'image' } : null;
  if (rel.includes('/') || !rel.endsWith('.json')) return null;
  const base = rel.slice(0, -'.json'.length);
  if (base === 'hostile' || /^doc-[a-z0-9-]+$/.test(base)) return { kind: 'doc' };
  if (/^http-[a-z0-9-]+$/.test(base)) return { kind: 'http' };
  if (/^exchange-[a-z0-9-]+$/.test(base)) return { kind: 'exchange' };
  const hits = NAMED.filter(([pre]) => base === pre || (base.startsWith(`${pre}-`) && /^[a-z0-9-]+$/.test(base))).sort((a, b) => b[0].length - a[0].length);
  return hits.length ? { kind: 'message', shape: hits[0][1] } : null;
}
// Every file under the folder, relative, `images/` one level down; any other folder is listed as itself.
function fixtureFiles() {
  const out = [];
  for (const e of fs.readdirSync(FIX, { withFileTypes: true })) {
    if (e.isDirectory() && e.name === 'images') for (const f of fs.readdirSync(path.join(FIX, 'images'))) out.push(`images/${f}`);
    else out.push(e.isDirectory() ? `${e.name}/` : e.name);
  }
  return out.sort();
}
const imagesOf = () => {
  const names = fs.existsSync(path.join(FIX, 'images')) ? fs.readdirSync(path.join(FIX, 'images')) : [];
  const bytes = names.reduce((s, f) => s + fs.statSync(path.join(FIX, 'images', f)).size, 0);
  return { images: new Set(names), folderBytes: bytes };
};
const docFixtures = () => fixtureFiles().filter((f) => (fixtureKind(f) || {}).kind === 'doc');
// A value at a stored property path (groups nested by their dots), or undefined.
function valueAt(n, p) {
  let v = n;
  for (const seg of p.split('.')) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, seg)) return undefined;
    v = v[seg];
  }
  return v;
}
// Whether a node uses a property: a plain path set, or a map-entry template with an entry.
function uses(n, p) {
  const nonEmpty = (m) => m !== null && typeof m === 'object' && Object.keys(m).length > 0;
  if (!p.includes('<')) return valueAt(n, p) !== undefined;
  if (p === 'props.<name>') return nonEmpty(n.props);
  if (p === 'variants.<name>') return nonEmpty(n.variants);
  if (p === 'variants.<name>.<id>.<prop>') return nonEmpty(n.variants) && Object.values(n.variants).some((v) => nonEmpty(v) && Object.values(v).some(nonEmpty));
  if (p === 'overrides.<id>.<prop>') return nonEmpty(n.overrides) && Object.values(n.overrides).some(nonEmpty);
  throw new Error(`no use rule for ${p}`);
}
function tokenTypesOf(tokens) {
  const out = new Set();
  const stack = [tokens];
  while (stack.length) {
    const g = stack.pop();
    for (const v of Object.values(g)) {
      if (v && typeof v === 'object' && Object.hasOwn(v, '$type')) out.add(v.$type);
      else if (v && typeof v === 'object') stack.push(v);
    }
  }
  return out;
}
const FREE_KINDS = ['page-name', 'node-name', 'text', 'prop-default', 'prop-value', 'variant-text', 'override-text'];

test('canvas A1: canvas-doc@1 and canvas@1, their fixtures and fake hold to one another, and no canvas test skips', async (t) => {
  await t.test('rules: a minimal document is valid', () => {
    assert.deepEqual(errs(minimal()), []);
    assert.deepEqual(errs(small()), []);
    assert.deepEqual(docErrors(small()), [], 'images null skips the file check');
    assert.ok(docErrors(small(), { images: new Set() }).some((e) => e.rule === 'refs'), 'an image file that is not in the folder is a ref');
    // the tables hang together
    assert.deepEqual([...TYPES], ['frame', 'text', 'rect', 'ellipse', 'vector', 'image', 'component', 'instance']);
    assert.deepEqual(Object.keys(PROPS), [...TYPES]);
    for (const type of TYPES) {
      for (const [p, def] of Object.entries(PROPS[type])) {
        assert.ok(CLASSES.includes(def.class), `${type}.${p}: class ${def.class} is in CLASSES`);
        assert.equal(typeof def.required, 'boolean');
        assert.ok(def.required === (def.default === undefined && ['path', 'src', 'component'].includes(p)), `${type}.${p}: required only where the spec says`);
      }
      for (const p of ['name', 'visible', 'opacity', 'x', 'y', 'size.w', 'size.h', 'figma']) assert.ok(PROPS[type][p], `${type} has ${p}`);
    }
    assert.deepEqual(PROPS.text.font.default, { family: 'sans', size: 16, weight: 400, lineHeight: 1.4 });
    assert.deepEqual([...TOKEN_TYPES], ['color', 'dimension', 'fontFamily', 'fontWeight', 'number', 'typography']);
    assert.deepEqual([...OPS], ['set', 'add', 'del', 'move', 'token']);
    assert.deepEqual([...PAGE_KINDS], ['edit', 'select', 'pong']);
    assert.deepEqual([...SERVER_KINDS], ['welcome', 'ops', 'saved', 'refused', 'selections', 'paused', 'resumed', 'reload', 'closed', 'ping']);
    assert.deepEqual([...HTTP_KINDS], ['doc-response', 'image-request', 'image-response', 'local-request', 'local-response', 'error-response']);
    assert.deepEqual([...REFUSALS], ['shape', 'prop', 'value', 'missing', 'parent', 'exists', 'cycle', 'ref', 'limit', 'view']);
    assert.deepEqual([...PAUSE_WHYS], ['branch-moved', 'worktree-gone', 'index-dirty']);
    assert.deepEqual([...CLOSE_WHYS], ['landed', 'removed']);
    assert.deepEqual(ROUTES.map((r) => [r.key, r.fake]), [
      ['doc', true], ['image-post', true], ['image-get', true], ['local', true], ['import', true], ['export', false], ['edit', false],
    ]);
    for (const r of DOC_RULES) assert.ok(REFUSALS.includes(r.code), `${r.rule}: code ${r.code} is a refusal`);
    assert.equal(new Set(DOC_RULES.map((r) => r.rule)).size, DOC_RULES.length, 'rule names are unique');
    assert.ok(Object.isFrozen(LIMITS));
    for (const [k, v] of Object.entries(LIMITS)) assert.ok(Number.isFinite(v) && v > 0, `LIMITS.${k} is a number`);
    for (const [k, v] of Object.entries({ docBytes: 5 * 2 ** 20, nodes: 20000, folderBytes: 25 * 2 ** 20, pages: 100, tokens: 1000, depth: 100, props: 32, variants: 32, overrideEntries: 1000, pageMsgBytes: 256 * 1024, editOpsBytes: 64 * 1024, serverMsgBytes: 2 ** 20, perSecond: 30, perPerson: 8, perCanvas: 50, openCanvases: 20, perServer: 200 })) {
      assert.equal(LIMITS[k], v, `LIMITS.${k}`);
    }
    assert.ok(NODE_ID_RE.test(long(40, 'A')) && !NODE_ID_RE.test(long(41)) && !NODE_ID_RE.test('a.b'));
    assert.ok(SLUG_RE.test('check-out2') && !SLUG_RE.test('Check') && !SLUG_RE.test('a--b'));
    assert.ok(CLIENT_RE.test(CLIENT) && SESSION_RE.test(SESSION) && !SESSION_RE.test(long(17, '0')));
    assert.ok(BY_RE.test('plan-checkout.2_x') && !BY_RE.test(long(65)) && !BY_RE.test('a b'));
    assert.ok(IMAGE_FILE_RE.test(IMG) && !IMAGE_FILE_RE.test('0123456789ABCDEF.png') && !IMAGE_FILE_RE.test('0123456789abcdef.svg'));
    assert.equal(HOSTILE_MARKERS.length, 20);
    for (const m of ['<script', '</script>', '`', '\n', '](', '\\(']) assert.ok(HOSTILE_MARKERS.includes(m), `marker ${JSON.stringify(m)}`);
  });

  await t.test('rules: broken documents by rule and class', () => {
    for (const { rule, code } of DOC_RULES) {
      assert.ok(Object.hasOwn(RULE_BREAKS, rule), `rule ${rule} has a broken copy`);
      const d = small();
      RULE_BREAKS[rule](d);
      const es = errs(d);
      const hit = es.filter((e) => e.rule === rule);
      assert.ok(hit.length > 0, `rule ${rule}: its broken copy names it (got ${JSON.stringify(es)})`);
      for (const e of hit) {
        assert.equal(e.code, code, `rule ${rule} gives ${code}`);
        assert.equal(typeof e.where, 'string');
        assert.equal(typeof e.message, 'string');
      }
    }
    for (const k of Object.keys(RULE_BREAKS)) assert.ok(DOC_RULES.some((r) => r.rule === k), `broken copy ${k} names a rule`);
    for (const cls of CLASSES) {
      assert.ok(Object.hasOwn(CLASS_BREAKS, cls), `class ${cls} has a broken copy`);
      const d = small();
      CLASS_BREAKS[cls](d);
      const es = errs(d);
      assert.ok(es.some((e) => e.rule === 'classes' && namesClass(e.message, cls)), `class ${cls}: its broken copy names it (got ${JSON.stringify(es)})`);
    }
    for (const k of Object.keys(CLASS_BREAKS)) assert.ok(CLASSES.includes(k), `broken copy ${k} names a class`);
    // errors come in the table's order
    const d = small();
    RULE_BREAKS.limits(d); RULE_BREAKS.keys(d); RULE_BREAKS.top(d);
    const order = DOC_RULES.map((r) => r.rule);
    const got = rulesOf(errs(d)).map((r) => order.indexOf(r));
    assert.deepEqual(got, [...got].sort((a, b) => a - b), 'docErrors lists errors in DOC_RULES order');
    // documents that are not documents
    for (const bad of [null, [], 'x', 5, {}]) assert.ok(errs(bad).some((e) => e.rule === 'top'), `${JSON.stringify(bad)} is not a document`);
  });

  await t.test('rules: broken messages by kind', () => {
    for (const kind of MESSAGE_KINDS) {
      assert.ok(Object.hasOwn(MESSAGES, kind), `kind ${kind} has a valid message and its mutations`);
      const [ok, breaks] = MESSAGES[kind];
      assert.deepEqual(shapeErrors(kind, clone(ok)), [], `${kind}: the valid message`);
      assert.ok(breaks.length > 0);
      const generic = [];
      for (const k of Object.keys(ok)) generic.push((m) => { delete m[k]; });
      generic.push((m) => { m.extra = 1; });
      for (const [i, br] of [...breaks, ...generic].entries()) {
        const m = clone(ok);
        br(m);
        assert.ok(shapeErrors(kind, m).length > 0, `${kind}: mutation ${i} (${JSON.stringify(m).slice(0, 160)}) has errors`);
      }
    }
    for (const k of Object.keys(MESSAGES)) assert.ok(MESSAGE_KINDS.includes(k), `${k} is a kind`);
    assert.ok(shapeErrors('nonsense', {}).length > 0, 'an unknown kind');
    assert.ok(shapeErrors('edit', null).length > 0, 'not an object');
    // the edit envelope only: an op meant to be refused still makes a well-shaped edit
    assert.deepEqual(shapeErrors('edit', { t: 'edit', client: CLIENT, seq: 1, ops: [{ op: 'nope' }] }), []);
    assert.ok(opErrors({ op: 'nope' }).length > 0);
    // a local apply's ops message: via apply or take, ack null, by.name the claimed by
    assert.deepEqual(shapeErrors('ops', { t: 'ops', rev: 9, by: { id: 'kit-651', name: 'kit-651', via: 'take' }, ack: null, ops: [SET_OP] }), []);
    // a re-ack: no ops
    assert.deepEqual(shapeErrors('ops', { t: 'ops', rev: 9, by: { id: 'ann', name: 'Ann', via: 'page' }, ack: { client: CLIENT, seq: 3 }, ops: [] }), []);
    assert.deepEqual(shapeErrors('doc-response', { session: null, rev: 0, doc: minimal(), repo: { name: null, public: null } }), [], 'at=main: session null');
    assert.deepEqual(shapeErrors('presence-move', { t: 'move', a: null }), [], 'a leave');
    assert.deepEqual(shapeErrors('presence-move', { t: 'move', a: { k: 'r1', x: 0, y: 1 } }), [], 'over a node');
    assert.ok(shapeErrors('edit', { t: 'edit', client: CLIENT, seq: 1, ops: [{ op: 'set', id: 'r1', prop: 'text', value: long(LIMITS.pageMsgBytes) }] }).length > 0, 'a page message over 256 KB');
  });

  await t.test('rules: applyEdit', () => {
    const base = small();
    // opErrors: the op's own shape
    assert.deepEqual(opErrors(SET_OP), []);
    for (const op of [
      null, [], { op: 'set', id: 'r1', prop: 'radius' }, { op: 'set', id: 'r1', prop: 'radius', value: 1, x: 1 }, { op: 'set', id: 'a b', prop: 'x', value: 1 },
      { op: 'add', node: { id: 'z', type: 'rect', parent: 'p1', children: [] }, after: null }, { op: 'add', node: { id: 'z', type: 'blob', parent: 'p1' }, after: null },
      { op: 'add', node: { id: 'z', type: 'rect', parent: 'p1' } }, { op: 'del' }, { op: 'move', id: 'r1', parent: 'f1' },
      { op: 'token', path: 'a..b', value: null }, { op: 'token', path: 'a', value: 'x' }, { op: 'unknown' },
    ]) assert.ok(opErrors(op).length > 0, `opErrors: ${JSON.stringify(op)}`);

    // set
    let d = applied(base, [{ op: 'set', id: 'f1', prop: 'layout.gap', value: 8 }]);
    assert.equal(d.nodes.f1.layout.gap, 8);
    assert.equal(d.nodes.f1.layout.mode, 'row', 'per real property: the other layout keys stay');
    d = applied(base, [{ op: 'set', id: 'r1', prop: 'size.h', value: 40 }]);
    assert.deepEqual(d.nodes.r1.size, { h: 40 }, 'a group made on first set');
    d = applied(base, [{ op: 'set', id: 'p2', prop: 'name', value: 'Renamed' }]);
    assert.equal(d.pages[1].name, 'Renamed', 'a page name');
    d = applied(base, [{ op: 'set', id: 'n1', prop: 'overrides.ct.size.h', value: 30 }, { op: 'set', id: 'n1', prop: 'overrides.ct.text', value: null }]);
    assert.deepEqual(d.nodes.n1.overrides.ct, { 'size.w': 'fill', 'size.h': 30 }, 'override entries are flat dotted keys; null removes one');
    d = applied(base, [{ op: 'set', id: 'c1', prop: 'variants.dark.cr.fill', value: '#ffffff' }, { op: 'set', id: 'c1', prop: 'variants.light', value: {} }]);
    assert.equal(d.nodes.c1.variants.dark.cr.fill, '#ffffff');
    assert.deepEqual(d.nodes.c1.variants.light, {});
    d = applied(base, [{ op: 'set', id: 'n1', prop: 'props.title', value: null }, { op: 'set', id: 'r1', prop: 'figma', value: null }]);
    assert.ok(!('title' in d.nodes.n1.props) && !('figma' in d.nodes.r1), 'null removes an entry and an absent-by-default property');
    d = applied(base, [{ op: 'set', id: 'n1', prop: 'overrides', value: {} }]);
    assert.deepEqual(d.nodes.n1.overrides, {}, 'a whole map is settable');
    d = applied(base, [{ op: 'set', id: 'r1', prop: 'fill', value: null }]);
    assert.equal(d.nodes.r1.fill, null, 'paint takes null');

    // add, and pages as ops
    d = applied(base, [{ op: 'add', node: { id: 'r2', type: 'rect', parent: 'f1', fill: '#abc', size: { w: 10 } }, after: 't1' }]);
    assert.deepEqual(d.nodes.f1.children, ['t1', 'r2', 'r1', 'e1', 'v1', 'i1'], 'placed after its sibling');
    assert.deepEqual(d.nodes.r2, { type: 'rect', parent: 'f1', fill: '#abc', size: { w: 10 } });
    d = applied(base, [{ op: 'add', node: { id: 'r2', type: 'rect', parent: 'f1' }, after: null }]);
    assert.equal(d.nodes.f1.children[0], 'r2', 'after null: first');
    d = applied(base, [{ op: 'add', node: { id: 'r2', type: 'rect', parent: 'f1' }, after: 'gone' }]);
    assert.equal(d.nodes.f1.children.at(-1), 'r2', 'an after that is gone: last');
    d = applied(base, [
      { op: 'add', node: { id: 'f2', type: 'frame', parent: 'p2', layout: { mode: 'column' } }, after: null },
      { op: 'add', node: { id: 'f3', type: 'frame', parent: 'f2' }, after: null },
      { op: 'add', node: { id: 't2', type: 'text', parent: 'f3', text: 'Hi' }, after: null },
    ]);
    assert.deepEqual([d.nodes.f2.children, d.nodes.f3.children], [['f3'], ['t2']], 'a container then its children, in one edit');
    d = applied(base, [{ op: 'add', node: { id: 'r1', type: 'rect', parent: 'f1', radius: 9 }, after: null }]);
    assert.equal(d.nodes.r1.radius, 9, 'an add of an existing id, same type and parent: its properties as sets');
    assert.deepEqual(d.nodes.f1.children, base.nodes.f1.children, 'and not moved');
    d = applied(base, [{ op: 'add', node: { id: 'p3', type: 'page', parent: null, name: 'Three' }, after: 'p1' }]);
    assert.deepEqual(d.pages.map((p) => p.id), ['p1', 'p3', 'p2'], 'a page added after a page');
    assert.deepEqual(d.pages[1], { id: 'p3', name: 'Three', children: [] });
    d = applied(base, [{ op: 'add', node: { id: 'p0', type: 'page', parent: null, name: 'Zero' }, after: null }]);
    assert.equal(d.pages[0].id, 'p0');
    d = applied(base, [{ op: 'add', node: { id: 'p2', type: 'page', parent: null, name: 'Again' }, after: null }]);
    assert.deepEqual([d.pages.map((p) => p.id), d.pages[1].name], [['p1', 'p2'], 'Again'], 'an add of an existing page: its name as a set');

    // del
    d = applied(base, [{ op: 'del', id: 'f1' }]);
    for (const id of ['f1', 't1', 'r1', 'e1', 'v1', 'i1']) assert.ok(!(id in d.nodes), `del removes the subtree (${id})`);
    assert.deepEqual(d.pages[0].children, ['c1', 'n1']);
    d = applied(base, [{ op: 'del', id: 'nothing' }]);
    assert.deepEqual({ ...d, rev: base.rev }, base, 'del of a missing id does nothing (and still raises rev)');
    d = applied(base, [{ op: 'del', id: 'p2' }]);
    assert.deepEqual(d.pages.map((p) => p.id), ['p1'], 'del of a page');
    d = applied(base, [{ op: 'add', node: { id: 'r9', type: 'rect', parent: 'p2' }, after: null }]);
    d = applied(d, [{ op: 'del', id: 'p2' }]);
    assert.ok(!('r9' in d.nodes), "del of a page removes its nodes");

    // move
    d = applied(base, [{ op: 'move', id: 'r1', parent: 'p2', after: null }]);
    assert.deepEqual([d.nodes.r1.parent, d.pages[1].children, d.nodes.f1.children.includes('r1')], ['p2', ['r1'], false]);
    d = applied(base, [{ op: 'move', id: 'r1', parent: 'f1', after: 't1' }]);
    assert.deepEqual(d.nodes.f1.children, base.nodes.f1.children, 'move to where it is does nothing');
    d = applied(base, [{ op: 'move', id: 't1', parent: 'f1', after: 'i1' }]);
    assert.deepEqual(d.nodes.f1.children, ['r1', 'e1', 'v1', 'i1', 't1'], 'reorder');
    d = applied(base, [{ op: 'move', id: 't1', parent: 'f1', after: 'gone' }]);
    assert.equal(d.nodes.f1.children.at(-1), 't1', 'after gone: last');
    d = applied(base, [{ op: 'move', id: 'p1', parent: null, after: 'p2' }]);
    assert.deepEqual(d.pages.map((p) => p.id), ['p2', 'p1'], 'a page reordered');

    // token
    d = applied(base, [{ op: 'token', path: 'color.accent', value: { $type: 'color', $value: { colorSpace: 'srgb', components: [1, 0, 0] } } }]);
    assert.equal(d.tokens.color.accent.$type, 'color');
    d = applied(base, [{ op: 'token', path: 'new.group.size', value: { $type: 'dimension', $value: { value: 3, unit: 'px' } } }]);
    assert.equal(d.tokens.new.group.size.$value.value, 3, 'groups made on the way');
    d = applied(base, [{ op: 'token', path: 'missing.path', value: null }]);
    assert.deepEqual({ ...d, rev: base.rev }, base, 'token null on a missing path does nothing');
    d = applied(base, [{ op: 'token', path: 'space.neg', value: null }]);
    assert.ok(!('neg' in d.tokens.space), 'an unused token removed');
    d = applied(base, [{ op: 'set', id: 't1', prop: 'color', value: '#000' }, { op: 'token', path: 'color.brand', value: null }, { op: 'set', id: 'f1', prop: 'fill', value: null }]);
    assert.ok(!('color' in d.tokens) || !('brand' in d.tokens.color), 'a token removed and its uses changed in the same edit');

    // whole-edit judgement
    d = applied(base, [
      { op: 'set', id: 'c1', prop: 'props.label', value: { type: 'text', default: 'L', target: { id: 'cl', prop: 'text' } } },
      { op: 'add', node: { id: 'cl', type: 'text', parent: 'c1', text: 'l' }, after: null },
    ]);
    assert.ok(d.nodes.c1.props.label && d.nodes.cl, 'a forward reference (a prop target set before its node is added) is applied');
    d = applied(base, [
      { op: 'token', path: 'space.m', value: { $type: 'number', $value: 3 } },
      { op: 'set', id: 'f1', prop: 'layout.gap', value: 4 },
      { op: 'set', id: 'ct', prop: 'font', value: { family: 'sans', size: 14, weight: 400, lineHeight: { $ref: 'space.m' } } },
    ]);
    assert.equal(d.tokens.space.m.$type, 'number', 'a token retyped before its uses change');
    refused(base, [{ op: 'set', id: 'f1', prop: 'layout.gap', value: 4 }, { op: 'del', id: 'ct' }], 'ref'); // the end state: a prop target gone
    refused(base, [{ op: 'set', id: 'r1', prop: 'radius', value: 7 }, { op: 'set', id: 'r1', prop: 'opacity', value: 3 }], 'value'); // nothing applied
    refused(base, [], 'shape');
    refused(base, 'x', 'shape');
    refused(base, [SET_OP, { op: 'set' }], 'shape');

    // each refusal code
    refused(base, [{ op: 'add', node: { id: 'z', type: 'rect', parent: 'p1', children: [] }, after: null }], 'shape');
    refused(base, [{ op: 'set', id: 'r1', prop: 'children', value: [] }], 'prop');
    refused(base, [{ op: 'set', id: 'r1', prop: 'parent', value: 'p2' }], 'prop');
    refused(base, [{ op: 'set', id: 'r1', prop: 'type', value: 'ellipse' }], 'prop');
    refused(base, [{ op: 'set', id: 'r1', prop: 'id', value: 'r7' }], 'prop');
    refused(base, [{ op: 'set', id: 'r1', prop: 'text', value: 'x' }], 'prop');
    refused(base, [{ op: 'set', id: 'p1', prop: 'children', value: [] }], 'prop');
    refused(base, [{ op: 'add', node: { id: 'z', type: 'rect', parent: 'p1', layout: { mode: 'row' } }, after: null }], 'prop');
    refused(base, [{ op: 'set', id: 'r1', prop: 'opacity', value: 2 }], 'value');
    refused(base, [{ op: 'set', id: 't1', prop: 'color', value: 'url(x)' }], 'value');
    refused(base, [{ op: 'token', path: 'color.brand.inner', value: { $type: 'number', $value: 1 } }], 'value'); // inside a token
    refused(base, [{ op: 'token', path: 'color', value: { $type: 'number', $value: 1 } }], 'value'); // over a group
    refused(base, [{ op: 'token', path: 'space', value: null }], 'value'); // a group named
    refused(base, [{ op: 'token', path: 'x', value: { $type: 'number', $value: 'one' } }], 'value');
    refused(base, [{ op: 'set', id: 'nope', prop: 'opacity', value: 1 }], 'missing');
    refused(base, [{ op: 'move', id: 'nope', parent: 'p1', after: null }], 'missing');
    refused(base, [{ op: 'add', node: { id: 'z', type: 'rect', parent: 'nope' }, after: null }], 'parent');
    refused(base, [{ op: 'add', node: { id: 'z', type: 'rect', parent: 't1' }, after: null }], 'parent');
    refused(base, [{ op: 'add', node: { id: 'z', type: 'rect', parent: null }, after: null }], 'parent');
    refused(base, [{ op: 'add', node: { id: 'p9', type: 'page', parent: 'p1', name: '' }, after: null }], 'parent');
    refused(base, [{ op: 'move', id: 'r1', parent: 'nope', after: null }], 'parent');
    refused(base, [{ op: 'move', id: 'p1', parent: 'p2', after: null }], 'parent');
    refused(base, [{ op: 'add', node: { id: 'c2', type: 'component', parent: 'c1' }, after: null }], 'parent'); // a component inside a component
    refused(base, [{ op: 'add', node: { id: 'r1', type: 'ellipse', parent: 'f1' }, after: null }], 'exists');
    refused(base, [{ op: 'add', node: { id: 'r1', type: 'rect', parent: 'p2' }, after: null }], 'exists');
    refused(base, [{ op: 'add', node: { id: 'p2', type: 'rect', parent: 'p1' }, after: null }], 'exists'); // a page's id
    refused(base, [{ op: 'add', node: { id: 'r1', type: 'page', parent: null, name: '' }, after: null }], 'exists'); // a node's id
    refused(base, [{ op: 'move', id: 'f1', parent: 'f1', after: null }], 'cycle');
    d = applied(base, [{ op: 'add', node: { id: 'f2', type: 'frame', parent: 'f1' }, after: null }]);
    refused(d, [{ op: 'move', id: 'f1', parent: 'f2', after: null }], 'cycle');
    d = applied(base, [{ op: 'add', node: { id: 'c2', type: 'component', parent: 'p2' }, after: null }, { op: 'add', node: { id: 'n2', type: 'instance', parent: 'c2', component: 'c1' }, after: null }]);
    refused(d, [{ op: 'add', node: { id: 'n3', type: 'instance', parent: 'c1', component: 'c2' }, after: null }], 'cycle'); // an instance cycle through another instance
    refused(base, [{ op: 'set', id: 't1', prop: 'color', value: { $ref: 'space.m' } }], 'ref'); // the wrong token type
    refused(base, [{ op: 'set', id: 'r1', prop: 'radius', value: { $ref: 'space.neg' } }], 'ref'); // a negative dimension as a len
    refused(base, [{ op: 'token', path: 'color.brand', value: null }], 'ref'); // removed while used
    refused(base, [{ op: 'token', path: 'color.brand', value: { $type: 'number', $value: 1 } }], 'ref'); // retyped while used
    refused(base, [{ op: 'set', id: 'n1', prop: 'component', value: 'f1' }], 'ref');
    refused(base, [{ op: 'set', id: 'n1', prop: 'variant', value: 'light' }], 'ref');
    refused(base, [{ op: 'set', id: 'n1', prop: 'overrides.t1.text', value: 'x' }], 'ref'); // not a descendant
    refused(base, [{ op: 'set', id: 'n1', prop: 'overrides.ct.name', value: 'x' }], 'prop'); // a name override
    refused(base, [{ op: 'set', id: 'n1', prop: 'props.title', value: true }], 'ref'); // the wrong prop type
    refused(base, [{ op: 'set', id: 'n1', prop: 'props.nope', value: 'x' }], 'ref');
    refused(base, [{ op: 'set', id: 'c1', prop: 'props.title', value: { type: 'text', default: '', target: { id: 'cr', prop: 'text' } } }], 'ref'); // a text prop on a rect
    refused(base, [{ op: 'del', id: 'c1' }], 'ref'); // a component an instance names
    refused(base, [{ op: 'move', id: 'cr', parent: 'p2', after: null }], 'ref'); // out of its component while named
    refused(base, [{ op: 'set', id: 'i1', prop: 'src', value: 'images/fedcba9876543210.png' }], 'ref'); // no such file
    refused(base, [{ op: 'del', id: 'p1' }, { op: 'del', id: 'p2' }], 'limit'); // the last page
    refused(base, [{ op: 'set', id: 't1', prop: 'text', value: long(LIMITS.editOpsBytes) }], 'limit'); // over 64 KB of ops
    refused(base, [SET_OP], 'view', { level: 'view' });
    refused(base, [SET_OP], 'limit', { folderBytes: LIMITS.folderBytes });
    assert.deepEqual([...seenCodes].sort(), [...REFUSALS].sort(), 'every refusal code is reached');
    // a page's own name is the only page property
    refused(base, [{ op: 'set', id: 'p1', prop: 'name', value: long(201) }], 'value');

    // a variant's last override removed: the variant stays (n1 still uses it)
    d = applied(base, [{ op: 'set', id: 'c1', prop: 'variants.dark.cr.fill', value: null }]);
    assert.deepEqual(d.nodes.c1.variants.dark, { ct: { text: 'Var' } }, 'an emptied id map goes');
    d = applied(d, [{ op: 'set', id: 'c1', prop: 'variants.dark.ct.text', value: null }]);
    assert.deepEqual(d.nodes.c1.variants, { dark: {} }, 'the variant itself stays');
    assert.equal(d.nodes.n1.variant, 'dark');
    d = applied(base, [{ op: 'set', id: 'n1', prop: 'overrides.ct.text', value: null }, { op: 'set', id: 'n1', prop: 'overrides.ct.size.w', value: null }]);
    assert.deepEqual(d.nodes.n1.overrides, {}, "an instance's emptied override id map goes, the map stays");

    // a required property set to null: the op's own class check refuses it
    refused(base, [{ op: 'set', id: 'v1', prop: 'path', value: null }], 'value');
    refused(base, [{ op: 'set', id: 'i1', prop: 'src', value: null }], 'value');
    refused(base, [{ op: 'set', id: 'n1', prop: 'component', value: null }], 'value');

    // an override key not allowed there is `prop`: by path, in a whole map, in a stored document
    for (const key of ['name', 'figma', 'id', 'type', 'parent', 'children', 'component', 'variant', 'props', 'variants', 'overrides', 'radius', 'layout']) {
      refused(base, [{ op: 'set', id: 'n1', prop: `overrides.ct.${key}`, value: 'x' }], 'prop');
      refused(base, [{ op: 'set', id: 'c1', prop: `variants.dark.ct.${key}`, value: 'x' }], 'prop');
      refused(base, [{ op: 'set', id: 'n1', prop: 'overrides', value: { ct: { [key]: 'x' } } }], 'prop');
      refused(base, [{ op: 'set', id: 'c1', prop: 'variants', value: { dark: { ct: { [key]: 'x' } } } }], 'prop');
      refused(base, [{ op: 'set', id: 'c1', prop: 'variants.loud', value: { ct: { [key]: 'x' } } }], 'prop');
      const stored = small();
      stored.nodes.n1.overrides.ct[key] = 'x';
      assert.equal(errs(stored)[0].code, 'prop', `a stored ${key} override is prop first`);
      assert.ok(errs(stored).some((e) => e.rule === 'keys'), `a stored ${key} override breaks keys`);
      const storedV = small();
      storedV.nodes.c1.variants.dark.ct[key] = 'x';
      assert.equal(errs(storedV)[0].code, 'prop', `a stored variant ${key} override is prop first`);
    }
    // the op's own check: an override key is judged when its op is, so it beats a later op's code
    refused(base, [{ op: 'set', id: 'n1', prop: 'overrides.ct.name', value: 'x' }, { op: 'set', id: 'nope', prop: 'opacity', value: 1 }], 'prop');
    refused(base, [{ op: 'set', id: 'n1', prop: 'overrides', value: { ct: { name: 'x' } } }, { op: 'set', id: 'nope', prop: 'opacity', value: 1 }], 'prop');
    refused(base, [{ op: 'set', id: 'c1', prop: 'variants', value: { dark: { ct: { parent: 'x' } } } }, { op: 'set', id: 'nope', prop: 'opacity', value: 1 }], 'prop');
    // a key never overridden is prop even when its target doesn't resolve (yet)
    for (const key of ['name', 'figma', 'component', 'variant', 'props', 'variants', 'overrides', 'id', 'type', 'parent', 'children']) {
      refused(base, [{ op: 'set', id: 'n1', prop: `overrides.zz.${key}`, value: 'x' }], 'prop');
      refused(base, [{ op: 'set', id: 'c1', prop: `variants.dark.zz.${key}`, value: 'x' }], 'prop');
      refused(base, [{ op: 'set', id: 'n1', prop: 'overrides', value: { zz: { [key]: 'x' } } }], 'prop');
      const stored = small();
      stored.nodes.n1.overrides.zz = { [key]: 'x' };
      assert.equal(errs(stored)[0].code, 'prop', `a stored ${key} override on an unknown target is prop first`);
    }
    // a target that doesn't resolve stays ref, so a forward reference still works; and once its node
    // is known, a key not of its type is prop
    refused(base, [{ op: 'set', id: 'n1', prop: 'overrides.zz.radius', value: 2 }], 'ref');
    refused(base, [{ op: 'set', id: 'c1', prop: 'variants.dark.zz.radius', value: 2 }, { op: 'add', node: { id: 'zz', type: 'text', parent: 'c1' }, after: null }], 'prop');
    applied(base, [{ op: 'set', id: 'c1', prop: 'variants.dark.zz.text', value: 'Z' }, { op: 'add', node: { id: 'zz', type: 'text', parent: 'c1' }, after: null }]);
    applied(base, [{ op: 'set', id: 'n1', prop: 'overrides', value: { ct: { text: 'T', 'size.w': 'fill' }, cr: { radius: 3 } } }]);

    // pathData: a move, then commands and numbers separated by whitespace and at most one comma
    for (const ok of ['M0,0L10,10', 'm-1.5-2e-3.5 .5z', 'M 0 0 C 1 2, 3 4, 5 6 Z', ' \n\tM0 0', 'M1.5.5', 'M+1E+2 -3e-1', 'M0 0 h 10 v 10 z m 1 1']) {
      assert.equal(applied(base, [{ op: 'set', id: 'v1', prop: 'path', value: ok }]).nodes.v1.path, ok, `path ${JSON.stringify(ok)}`);
    }
    for (const bad of [' ,M--e.e+ Z', ',M0 0', 'M0,,0', 'M0 0,', 'M1e', 'M.', 'M+-1', 'M1e+', 'Z M0 0', 'L0 0', '', ' ', 'M0 0 X', 'M0\u00a00', 'M--1', 'M0 0;', 'M0 e5']) {
      refused(base, [{ op: 'set', id: 'v1', prop: 'path', value: bad }], 'value');
    }
    const longPath = `M${' 0'.repeat((LIMITS.pathBytes - 1) / 2)}`.padEnd(LIMITS.pathBytes, '0');
    assert.equal(Buffer.byteLength(longPath), LIMITS.pathBytes);
    assert.deepEqual(errs({ ...small(), nodes: { ...small().nodes, v1: { ...small().nodes.v1, path: longPath } } }), [], 'a path of 65536 bytes');
    assert.ok(errs({ ...small(), nodes: { ...small().nodes, v1: { ...small().nodes.v1, path: `${longPath}0` } } }).some((e) => e.rule === 'classes'), 'a path of 65537 bytes');
    const spaces = `M${' '.repeat(LIMITS.pathBytes - 2)}!`;
    const [, spaceMs] = timed(() => errs({ ...small(), nodes: { ...small().nodes, v1: { ...small().nodes.v1, path: spaces } } }));
    assert.ok(spaceMs < 2000, `a long run of spaces is judged in linear time (${spaceMs} ms)`);

    // the ranges the classes read
    refused(base, [{ op: 'set', id: 'f1', prop: 'layout.columns', value: ['1000fr'] }], 'value');
    refused(base, [{ op: 'set', id: 'f1', prop: 'layout.columns', value: ['0fr'] }], 'value');
    refused(base, [{ op: 'set', id: 'f1', prop: 'layout.columns', value: ['01fr'] }], 'value');
    applied(base, [{ op: 'set', id: 'f1', prop: 'layout.columns', value: ['999fr', '1fr', 0, 100000] }]);

    // a typography token's fontSize is any dimension
    applied(base, [{ op: 'token', path: 'type.huge', value: { $type: 'typography', $value: { fontFamily: 'mono', fontSize: { value: 2000, unit: 'px' }, fontWeight: 900, letterSpacing: { value: -2, unit: 'px' }, lineHeight: 1 } } }]);
  });

  await t.test('rules: the seq book remembers refusals', () => {
    const b = makeSeqBook();
    assert.equal(b.judge(CLIENT, 5), 'new');
    b.record(CLIENT, 5, 'missing');
    assert.equal(b.judge(CLIENT, 6), 'new');
    b.record(CLIENT, 6, null);
    // the refused for 5 and the ack for 6 are lost in a drop; the page resends both
    assert.deepEqual(b.judge(CLIENT, 5), { refused: 'missing' }, 'resend 5: refused again, same why');
    assert.equal(b.judge(CLIENT, 6), 'reack', 'resend 6: re-acked');
    assert.equal(b.judge(CLIENT, 4), 'reack', 'a seq never seen below the highest applied: re-acked');
    assert.equal(b.judge(CLIENT, 7), 'new');
    assert.equal(b.judge('zzzzzzzzzzzzzzzz', 5), 'new', 'per client');
    assert.equal(b.highest(CLIENT), 6);
    // a refusal above the highest applied is remembered too
    b.record(CLIENT, 8, 'value');
    assert.deepEqual(b.judge(CLIENT, 8), { refused: 'value' });
    // remembered while within refusedMemory of the highest seq seen; forgotten beyond it
    assert.equal(LIMITS.refusedMemory, 2000, "a half-open link's worst case: 30 a second for about 60 s is 1800");
    assert.ok(LIMITS.refusedMemory >= LIMITS.perSecond * (LIMITS.unansweredPings + 1) * (LIMITS.pingMs / 1000), 'refusedMemory covers the seqs sent before two unanswered pings close the link');
    b.record(CLIENT, 5 + LIMITS.refusedMemory, null);
    assert.deepEqual(b.judge(CLIENT, 5), { refused: 'missing' }, 'exactly refusedMemory below: remembered');
    b.record(CLIENT, 6 + LIMITS.refusedMemory, null);
    assert.equal(b.judge(CLIENT, 5), 'reack', 'more than refusedMemory below: forgotten, re-acked');
    assert.deepEqual(b.judge(CLIENT, 8), { refused: 'value' }, 'still within: remembered');
    // bounded: many refusals keep at most refusedMemory + 1
    const c = makeSeqBook();
    for (let s = 1; s <= 3 * LIMITS.refusedMemory; s++) c.record(CLIENT, s, 'value');
    let kept = 0;
    for (let s = 1; s <= 3 * LIMITS.refusedMemory; s++) if (typeof c.judge(CLIENT, s) === 'object') kept++;
    assert.equal(kept, LIMITS.refusedMemory + 1, 'the book is bounded');
    assert.deepEqual(makeSeqBook().judge(CLIENT, 5), 'new', 'a new session remembers nothing');
  });

  await t.test('rules: ids that name prototype keys are ids like any other', () => {
    const base = small();
    // an override keyed __proto__ is not a descendant: ref, and nothing reaches Object.prototype
    refused(base, [{ op: 'set', id: 'n1', prop: 'overrides.__proto__.text', value: 'polluted' }], 'ref');
    refused(base, [{ op: 'set', id: 'n1', prop: 'overrides.constructor.text', value: 'polluted' }], 'ref');
    // a node with id __proto__ is added, validated and stored as an own key, as JSON round-trips it
    for (const id of ['__proto__', 'constructor', 'hasOwnProperty', 'toString']) {
      let d = applied(base, [{ op: 'add', node: { id, type: 'frame', parent: 'p2', name: id }, after: null }]);
      assert.ok(Object.prototype.hasOwnProperty.call(d.nodes, id), `${id} is an own node`);
      assert.equal(Object.getPrototypeOf(d.nodes), Object.prototype, 'nodes stays a plain object');
      assert.deepEqual(d.pages[1].children, [id]);
      const round = JSON.parse(JSON.stringify(d));
      assert.deepEqual(errs(round), [], `${id}: the JSON document holding it is valid too`);
      assert.deepEqual(Object.keys(round.nodes).includes(id), true);
      d = applied(d, [{ op: 'add', node: { id: 'k', type: 'rect', parent: id }, after: null }, { op: 'set', id, prop: 'layout.gap', value: 3 }]);
      assert.equal(d.nodes[id].layout.gap, 3);
      d = applied(d, [{ op: 'move', id: 'k', parent: 'p2', after: null }, { op: 'del', id }]);
      assert.ok(!Object.prototype.hasOwnProperty.call(d.nodes, id), `${id} deleted`);
      refused(base, [{ op: 'add', node: { id, type: 'rect', parent: id }, after: null }], 'parent');
    }
    const fromJson = JSON.parse(JSON.stringify(small()).replace('"r1":', '"__proto__":').replace(/"r1"/g, '"__proto__"'));
    assert.deepEqual(errs(fromJson), [], 'a JSON document with a __proto__ node is valid');
    const moved = applied(fromJson, [{ op: 'set', id: '__proto__', prop: 'radius', value: 6 }]);
    assert.equal(moved.nodes.__proto__.radius, 6, 'and its node is edited like any other');
    // token segments
    let d = applied(base, [{ op: 'token', path: '__proto__.x', value: { $type: 'number', $value: 2 } }]);
    assert.ok(Object.prototype.hasOwnProperty.call(d.tokens, '__proto__'), 'a __proto__ token group is stored');
    assert.equal(d.tokens.__proto__.x.$value, 2);
    assert.deepEqual(errs(JSON.parse(JSON.stringify(d))), []);
    d = applied(d, [{ op: 'set', id: 'ct', prop: 'font', value: { family: 'sans', size: 12, weight: 400, lineHeight: { $ref: '__proto__.x' } } }]);
    refused(d, [{ op: 'token', path: '__proto__.x', value: null }], 'ref');
    d = applied(base, [{ op: 'token', path: 'constructor', value: { $type: 'number', $value: 1 } }]);
    assert.equal(d.tokens.constructor.$value, 1);
    refused(base, [{ op: 'set', id: 't1', prop: 'color', value: { $ref: 'toString' } }], 'ref');
    // prop and variant names
    d = applied(base, [
      { op: 'set', id: 'c1', prop: 'props.constructor', value: { type: 'text', default: 'C', target: { id: 'ct', prop: 'text' } } },
      { op: 'set', id: 'c1', prop: 'variants.toString', value: { cr: { fill: '#123' } } },
      { op: 'set', id: 'n1', prop: 'props.constructor', value: 'Ctor' },
      { op: 'set', id: 'n1', prop: 'variant', value: 'toString' },
    ]);
    assert.equal(d.nodes.c1.props.constructor.default, 'C');
    assert.equal(resolve(d, 'n1').ct.text, 'Ctor', 'resolve reads own prop names');
    assert.equal(resolve(d, 'n1').cr.fill, '#123', 'and own variant names');
    refused(base, [{ op: 'set', id: 'n1', prop: 'props.hasOwnProperty', value: 'x' }], 'ref');
    refused(base, [{ op: 'set', id: 'n1', prop: 'variant', value: 'valueOf' }], 'ref');
    const r = resolve(base, 'n1');
    assert.ok(!Object.prototype.hasOwnProperty.call(r, '__proto__'));
  });


  await t.test('rules: resolve order', () => {
    const d = small();
    assert.equal(resolve(d, 'n1').ct.text, 'Val', 'the instance prop value wins');
    delete d.nodes.n1.props.title;
    assert.equal(resolve(d, 'n1').ct.text, 'Inst', 'then the instance override');
    delete d.nodes.n1.overrides.ct.text;
    assert.equal(resolve(d, 'n1').ct.text, 'Var', "then the variant's override");
    delete d.nodes.c1.variants.dark.ct;
    assert.equal(resolve(d, 'n1').ct.text, 'Def', "then the prop's default, never the base");
    delete d.nodes.c1.props.title;
    assert.equal(resolve(d, 'n1').ct.text, 'Base', 'then the base');
    const r = resolve(small(), 'n1');
    assert.deepEqual(Object.keys(r).sort(), ['cr', 'ct'], "every descendant of the component, and nothing else");
    assert.equal(r.cr.visible, false, 'a bool prop value');
    assert.equal(r.cr.fill, '#000000', "the variant's fill");
    assert.equal(r.ct['size.w'], 'fill', 'an override on a dotted path');
    assert.equal(r.ct.opacity, 1, 'a default where nothing is set');
  });

  await t.test('rules: unicode', () => {
    const d = small();
    for (const [name, ok, why] of [
      [long(200, '\u{1F600}'), true, '200 four-byte characters'],
      [long(201, '\u{1F600}'), false, '201 four-byte characters'],
      [long(100, 'e\u0301'), true, '100 letters with combining marks: 200 code points'],
      [`${long(100, 'e\u0301')}x`, false, '201 code points'],
      ['a\ud800b', false, 'a lone high surrogate'],
      ['a\udc00', false, 'a lone low surrogate'],
      ['\udc00\ud800', false, 'a reversed pair'],
      ['\ud800', false, 'a lone surrogate alone'],
    ]) {
      if (ok) assert.equal(applied(d, [{ op: 'set', id: 'r1', prop: 'name', value: name }]).nodes.r1.name, name, why);
      else refused(d, [{ op: 'set', id: 'r1', prop: 'name', value: name }], 'value');
    }
    refused(d, [{ op: 'set', id: 't1', prop: 'text', value: 'x\udbff' }], 'value');
    refused(d, [{ op: 'set', id: 'p1', prop: 'name', value: '\udfff' }], 'value');
    assert.equal(applied(d, [{ op: 'set', id: 't1', prop: 'text', value: long(10000, '\u{10FFFF}') }]).nodes.t1.text.length, 20000, 'text counts code points');
    refused(d, [{ op: 'set', id: 't1', prop: 'text', value: long(10001, '\u{1F600}') }], 'value');
    assert.ok(shapeErrors('note-anchor', { node: long(64, '\u{1F600}') }).length === 0, 'an anchor counts code points');
  });

  await t.test('rules: free texts', () => {
    const got = freeTexts(small());
    const kinds = new Set(got.map((f) => f.kind));
    for (const k of ['page-name', 'node-name', 'text', 'prop-default', 'prop-value', 'variant-text', 'override-text']) assert.ok(kinds.has(k), `freeTexts finds ${k}`);
    const values = got.map((f) => f.value);
    for (const v of ['Page one', 'Two', 'Card', 'Hello', 'Base', 'Def', 'Val', 'Var', 'Inst']) assert.ok(values.includes(v), `freeTexts finds ${v}`);
    assert.ok(!values.includes('#112233') && !values.includes(true), 'only free text');
    for (const f of got) assert.equal(typeof f.where, 'string');
  });

  await t.test('rules: scale', () => {
    const [deepErrs, deepMs] = timed(() => docErrors(deep(LIMITS.depth), OPTS));
    assert.deepEqual(deepErrs, [], 'depth 100 is valid');
    assert.ok(deepMs < 5000, `depth 100 validated in ${deepMs} ms`);
    assert.ok(errs(deep(LIMITS.depth + 1)).some((e) => e.rule === 'limits'), 'depth 101 is over');
    refused(deep(LIMITS.depth), [{ op: 'add', node: { id: 'd101', type: 'rect', parent: `d${LIMITS.depth}` }, after: null }], 'limit');
    const w = wide(LIMITS.nodes);
    const [wideErrs, wideMs] = timed(() => docErrors(w, OPTS));
    assert.deepEqual(wideErrs, [], '20,000 nodes is valid');
    assert.ok(wideMs < 5000, `20,000 nodes validated in ${wideMs} ms`);
    const [, editMs] = timed(() => refused(w, [{ op: 'add', node: { id: 'one-more', type: 'rect', parent: 'p1' }, after: null }], 'limit'));
    assert.ok(editMs < 5000, `the 20,001st node refused in ${editMs} ms`);
    const big = minimal();
    big.nodes.t = { type: 'text', parent: 'p1', text: 'x' };
    big.pages[0].children.push('t');
    for (let i = 0; i < 600; i++) {
      const id = `t${i}`;
      big.nodes[id] = { type: 'text', parent: 'p1', text: long(9000, '\u00e9') };
      big.pages[0].children.push(id);
    }
    assert.ok(errs(big).some((e) => e.rule === 'limits' && /5242880|MB|bytes/.test(e.message)), 'a document over 5 MB as written');
    const pages = minimal();
    for (let i = 0; i < LIMITS.pages; i++) pages.pages.push({ id: `q${i}`, name: '', children: [] });
    assert.ok(errs(pages).some((e) => e.rule === 'limits'), '101 pages');
    const toks = minimal();
    for (let i = 0; i <= LIMITS.tokens; i++) toks.tokens[`n${i}`] = { $type: 'number', $value: i };
    assert.ok(errs(toks).some((e) => e.rule === 'limits'), '1,001 tokens');
    const props = small();
    for (let i = 0; i < LIMITS.props - 1; i++) props.nodes.c1.props[`b${i}`] = { type: 'bool', default: true, target: { id: 'cr', prop: 'visible' } };
    assert.ok(errs(props).some((e) => e.rule === 'limits'), '33 props');
  });

  await t.test('rules: skip and measure', () => {
    assert.ok(SKIP_CASES.bad.length >= 11 && SKIP_CASES.good.length >= 4);
    for (const c of SKIP_CASES.bad) assert.ok(skipProblems(c.source).length > 0, `skip rule flags: ${c.name}`);
    for (const c of SKIP_CASES.good) assert.deepEqual(skipProblems(c.source), [], `skip rule passes: ${c.name}`);
    // the scanner: a quote or backtick in a regex literal hides nothing after it, and a misread slash
    // blanks at most to the end of its line
    const regexCases = SKIP_CASES.bad.filter((c) => /regex|slash/.test(c.name));
    assert.ok(regexCases.length >= 4, 'the regex cases are among the bad ones');
    assert.ok(skipProblems("const r = /'/;\ntest.skip('x', () => {});").length > 0, 'a quote in a regex');
    assert.ok(skipProblems('const r = /[`]/;\ntest.skip(1);').length > 0, 'a backtick in a regex class');
    assert.ok(skipProblems("if (x) /'/.test(s)\ntest.skip(1);").length > 0, 'a slash after ) read as division: the string it opens ends at the line');
    assert.ok(skipProblems("const r = /[/']/; test.skip(1);").length > 0, 'a slash in a regex class, the skip on the same line');
    assert.ok(skipProblems('const h = (a) / 2; test.skip(1); const k = 3 / 4;').length > 0, 'division after ), the skip on the same line');
    assert.deepEqual(skipProblems("const h = (a) / 2; const s = '/ .only';"), [], 'division after ) opens no regex');
    assert.deepEqual(skipProblems("const r = /'/; const s = 'test.skip(';"), [], 'a quote in a regex opens no string');
    assert.ok(MEASURE_CASES.bad.length >= 7 && MEASURE_CASES.good.length >= 2);
    for (const files of MEASURE_CASES.bad) assert.ok(measureProblems(files).length > 0, `measure rule flags: ${files.map((f) => f.name).join(', ')}`);
    for (const files of MEASURE_CASES.good) assert.deepEqual(measureProblems(files), [], `measure rule passes: ${files.map((f) => f.name).join(', ')}`);
    // the repo: every test/*.test.mjs, found by listing test/
    const files = fs.readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort()
      .map((name) => ({ name, source: fs.readFileSync(path.join(here, name), 'utf8') }));
    const me = files.find((f) => f.name === 'canvas-contract.test.mjs');
    assert.ok(me, 'this file is listed');
    assert.deepEqual(measureProblems(files), [], 'every test file obeys the rule');
    assert.ok(measureProblems([me, { name: 'canvas-copy.test.mjs', source: me.source }]).length > 0, "this file's own A1 is counted (a copy repeats it)");
    assert.ok(measureProblems([{ name: 'elsewhere.test.mjs', source: me.source }]).length > 0, 'and is a canvas file');
  });
  await t.test('contract: tables match the code', () => {
    const md = contract();
    // types and properties, with class, enum words and default (`every` for the common rows)
    const props = new Map();
    for (const [typeCell, propCell, classCell, defCell] of table(md, 'Properties', ['Type', 'Property', 'Class', 'Default'])) {
      const types = typeCell === 'every' ? [...TYPES] : spans(typeCell);
      assert.ok(types.length > 0 && types.every((ty) => TYPES.includes(ty)), `Properties: types in ${typeCell}`);
      const prop = first(propCell, 'Properties');
      const [cls, ...words] = spans(classCell);
      let def;
      if (defCell === 'required') def = { default: undefined, required: true };
      else if (defCell === 'absent') def = { default: undefined, required: false };
      else def = { default: JSON.parse(first(defCell, `Properties ${prop}`)), required: false };
      for (const ty of types) {
        const key = `${ty} ${prop}`;
        assert.ok(!props.has(key), `Properties: ${key} once`);
        props.set(key, { class: cls, default: def.default, required: def.required, ...(cls === 'enum' ? { words } : {}) });
      }
    }
    const code = new Map();
    for (const ty of TYPES) {
      for (const [p, d] of Object.entries(PROPS[ty])) code.set(`${ty} ${p}`, { class: d.class, default: d.default, required: d.required, ...(d.class === 'enum' ? { words: [...d.words] } : {}) });
    }
    sameSet([...props.keys()], [...code.keys()], 'Properties');
    for (const [k, v] of code) assert.deepEqual(props.get(k), v, `Properties: ${k}: class, words, default`);

    const names = (heading, header) => table(md, heading, header).map((r) => { assert.ok(r.slice(1).every((c) => c.length > 0), `${heading}: ${r[0]} is described`); return first(r[0], heading); });
    // the numeric ranges in the Value classes and Token types rows are the code's RANGES, both ways
    const ranged = new Set();
    for (const [heading, header, keyOf] of [['Value classes', ['Class', 'Rule'], (k) => k], ['Token types', ['$type', '$value'], (k) => `token:${k}`]]) {
      for (const [k, cell] of table(md, heading, header)) {
        const key = keyOf(first(k, heading));
        ranged.add(key);
        const want = Object.hasOwn(RANGES, key) ? [...new Set(Object.values(RANGES[key]).map(([lo, hi]) => `${lo}..${hi}`))] : [];
        assert.deepEqual([...new Set(rangesIn(cell))].sort(), want.sort(), `${heading}: ${key}'s ranges are the code's`);
      }
    }
    for (const key of Object.keys(RANGES)) assert.ok(ranged.has(key), `RANGES.${key} has a row`);
    sameSet(names('Value classes', ['Class', 'Rule']), CLASSES, 'Value classes');
    sameSet(names('Token types', ['$type', '$value']), TOKEN_TYPES, 'Token types');
    assert.deepEqual(names('Ops', ['Op', 'Shape', 'Idempotent as']), [...OPS], 'Ops, in order');
    sameSet(names('Page messages', ['t', 'Shape']), PAGE_KINDS, 'Page messages');
    sameSet(names('Server messages', ['t', 'Shape']), SERVER_KINDS, 'Server messages');
    sameSet(names('HTTP bodies', ['Kind', 'Shape']), HTTP_KINDS, 'HTTP bodies');
    assert.deepEqual(names('Refusals', ['why', 'When']), [...REFUSALS], 'Refusals, in order');
    // document rules: names and codes, in judgement order
    const rules = table(md, 'Document rules', ['Rule', 'Code', 'What']).map(([r, c, w]) => { assert.ok(w.length > 0); return [first(r, 'rule'), first(c, 'code')]; });
    assert.deepEqual(rules, DOC_RULES.map((r) => [r.rule, r.code]), 'Document rules, with their codes, in order');
    // limits: every LIMITS key with its number and what crossing it answers
    const limits = table(md, 'Limits', ['Name', 'Number', 'Answer']);
    sameSet(limits.map((r) => first(r[0], 'Limits')), Object.keys(LIMITS), 'Limits');
    sameSet(Object.keys(LIMIT_ANSWERS), Object.keys(LIMITS), 'LIMIT_ANSWERS is keyed like LIMITS');
    for (const [n, num, answer] of limits) {
      const name = first(n, 'Limits');
      assert.equal(Number(first(num, `Limits ${name}`)), LIMITS[name], `Limits: ${name}'s number`);
      assert.equal(answer, LIMIT_ANSWERS[name], `Limits: ${name}'s answer is the code's`);
    }
    // routes
    const routes = table(md, 'Routes', ['Key', 'Method and path', 'Fake']).map(([k, mp, f]) => [first(k, 'Routes'), first(mp, 'Routes'), f]);
    assert.deepEqual(routes, ROUTES.map((r) => [r.key, `${r.method} ${r.path}`, r.fake ? 'yes' : 'no']), 'Routes, in order');
  });

  await t.test('contract: prose', () => {
    const md = contract();
    has(md, 'canvas-doc@1', 'the contract');
    has(md, 'canvas@1', 'the contract');
    const order = md.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
    assert.deepEqual(order.map((h) => h.replace(/^[0-9]+\. /, '')), [
      'Consumers and providers', 'The document: canvas-doc@1', 'The socket: canvas@1', 'Ops', 'Messages', 'Refusals', 'Limits',
      'HTTP routes', 'Presence on a canvas', 'Pins', 'Exports', 'Not defended', 'Canvas test files', 'The fake, the exchanges and the HTTP fixtures',
    ], 'the sections, in order');
    // each needle pins a whole rule and appears once in its section, so removing or rewording the rule fails
    all(md, 'Consumers and providers', [
      'Version: `canvas: 1` in the document and in `welcome`; additive changes only, anything else bumps it.',
      "a reader ignores keys and message kinds it doesn't know",
      'Nothing in `presence@1` changes.',
    ]);
    all(md, 'The document', [
      'The document is exactly `{ "canvas": 1, "rev": <integer ≥ 0>, "tokens": {…}, "pages": [ … ], "nodes": { … } }`',
      '**Pages**: 1 to 100, each exactly `{ "id", "name", "children" }`',
      'A page is not a node and `page` is not a node type.',
      '**Nodes** are a flat map by id.',
      'The tree is exact: each node\'s parent exists and lists it once, each listed child exists and names that parent, every node is reached from a page.',
      '**Ids** are 1 to 40 of `[A-Za-z0-9_-]`, unique across pages and nodes; any id of that pattern is valid.',
      "By the design's convention, which the rules don't check, whoever makes a node",
      'A `component` never sits inside another component, at any depth (instances of other components may).',
      "Depth counts a page's children as 1; at most 100.",
      'stored nested (`"layout": { "gap": 12 }`), so last-writer-wins applies per real property',
      'An override\'s properties are stored as flat dotted keys, `"overrides": { "k1-2": { "layout.gap": 4, "text": "Hi" } }`',
      'so the path splits at its second dot (`variants.<name>.<id>.<prop>` at its third)',
      'Setting a property whose default is absent (a map entry, `figma`) to null removes it; an override\'s id map (`overrides.<id>`, `variants.<name>.<id>`) left empty by that goes too, never the variant or a map above it.',
      'A required property (`path`, `src`, `component`) can\'t be removed, and an `add` without it is `shape`.',
      'place it only under a parent whose `layout.mode` is `none`: elsewhere they are kept and take no effect',
      'never `name`, `figma` (names stay design-time, so no override carries a name)',
      'An override key not allowed there is `prop`: one of those, a structural key (`id`, `type`, `parent`, `children`), or, once its target node is known, a property that node\'s type doesn\'t have',
      'An override whose target doesn\'t resolve, or isn\'t a descendant of the component, is `ref`',
      "the base value, then the default of a prop aimed at it, then the chosen variant's override, then the instance's override, then the instance's prop value aimed at it; the last that is present wins.",
      'A prop\'s default always applies to an instance, so an instance with no prop value shows the default, never the base.',
      "A component's own tree on the canvas shows its base values: a prop's default applies to instances only.",
      "page and node `name`, `text`, a text prop's `default`, an instance's text prop value, and a `text` override on a variant or an instance",
      'an object with any key starting `$` is a token and must be exactly `{ "$type", "$value" }`; any other object is a group.',
      'A path is either a token or a group, never both.',
      'No aliases inside tokens: a token\'s value is literal, so a `$ref` resolves in one step.',
      '`docErrors(doc, { images, folderBytes })` lists every way a document isn\'t valid, as `{ rule, code, where, message }`, in the table\'s order',
      'An edit\'s end state is refused with the code of the first rule that fails.',
      '`canvas.json` at most 5 MB as written (`JSON.stringify(doc, null, 2)` plus a newline)',
      'the server keeps them in the count and refuses an edit that would pass it',
    ]);
    all(md, 'The socket', [
      '`GET /canvas?slug=<slug>` with a WebSocket upgrade',
      '`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`',
      "in presence@1 §2's order, then the slug: host, relay mark, path, upgrade, origin, person headers, slug (a request breaking two guards gets the earlier one's status)",
      'a slug missing, malformed, not open for editing (no `chore-canvas-<slug>` worktree), or landed (closed by `canvas land`) is 404',
      'a server message over 256 KB is fragmented, a text frame then continuations, each of at most 256 KB',
      'An open session has a `session` id, 16 of `[0-9a-z]`, made each time a session opens',
      'A canvas with no open session has the id its next session will use, made when the last session ended',
      'A canvas is open from its first connection until its last closes.',
      'the page reloads the document over HTTP and resends every edit of its own above the last `saved`, acked or not',
      'A reconnect to the same session resends only its unacked edits.',
      'Neither ever resends an edit the page saw refused',
      'and 1000 after `closed`',
    ]);
    all(md, 'Ops', [
      'an `add` of an existing id with the same type and parent is its properties as `set`s; with a different type or parent it is `exists`; an `after` that is gone places last',
      'removes the node and its subtree; `del` of a missing id does nothing',
      '`move` to where it is does nothing; an `after` that is gone places last',
      'sets the token, making groups on the way; `token` null on a missing path does nothing; a group left empty goes',
      '`id`, `type`, `parent` and `children` change only by `add`, `del` and `move`: a `set` of any of them is `prop`.',
      'A `move` of a missing node is `missing`; into its own subtree `cycle`.',
      "the first op that fails refuses the edit with that check's code",
      "the first failing rule in the table's order refuses the edit with that rule's code",
      'So ops within one edit may refer forward (a prop target set before its node is added, a token retyped before its uses change), and a broken end state is charged to its rule, not to an op.',
      'An edit with no ops is `shape`, and a View person\'s edit is `view` before anything else is judged.',
      'An applied edit raises `rev` by one, whatever it changed',
      '**Pages as ops** (so there is no sixth op)',
      '`add` with `{ "id", "type": "page", "parent": null, "name" }` adds a page after `after` (null for first), and an `add` of an existing page sets its name',
      '`del` of a page id removes it and its nodes (the last page is `limit`)',
      "`set` of a page's `name` (any other property of a page is `prop`)",
      '`move` of a page with parent null reorders it',
    ]);
    all(md, 'Messages', [
      'An `edit` at or below it is acked again to that connection only, without being applied, unless it is a refusal the server remembers',
      'whether or not that `seq` itself was applied',
      "A refused edit doesn't raise the client's highest `seq`.",
      'the page drops its local copy of the refused edit by reloading the document and reapplying its other unacked edits over it, says why in plain words, and never resends an edit it saw refused',
      'An `edit` whose `seq` is one it remembers refusing is answered `refused` again with the same `why`, to that connection only, and never re-acked',
      "it keeps the seqs it refused that are within 2000 of the client's highest seq seen (`refusedMemory`)",
      "2000 covers a half-open link's worst case: a page sending 30 messages a second until two unanswered 20 s pings close it, about 60 s, is 1800 seqs.",
      'A refused `seq` more than 2000 below the highest seen is forgotten and, at or below the highest applied, re-acked.',
      'A new session (a restart, a `reload`) starts with nothing remembered.',
      'An `edit` whose `client` or `seq` breaks its rule is a message a page must not send: the connection is closed 1008.',
      'a longer list or a bad id and the whole `select` is ignored; ids that name no node are dropped',
      'their latest `select` from any of their connections (empty until one), in the order they first connected',
      "at most one per 250 ms window (the first change opens it, and one message at its end carries all), like presence's `people`",
      'A deleted node leaves every selection.',
      'at most 500 ms after an applied edit (the first unsaved edit opens the window), to every connection; none while saving is paused; when the pause ends, at once if anything is unsaved',
      '`paused` `why` is `branch-moved`, `worktree-gone` or `index-dirty`; `closed` `why` is `landed` or `removed`.',
      '`closed` is followed by a close with code 1000; a later upgrade for that slug is 404.',
      "A replace starts a new session on the open connections: `session` is the new id, every client's highest `seq` is forgotten, and the replaced document's `rev` is the old one plus one.",
      'which the new session judges afresh (applied or refused aloud, never re-acked unseen)',
      '`ping` every 20 s; two unanswered close the connection 1001.',
    ]);
    all(md, 'Refusals', [
      '`refused.why` is one word; the page turns it into plain words',
      'No `closed` code: after `closed` the socket is closed, and the local route answers 423.',
    ]);
    all(md, 'Limits', [
      'A limit that is a class bound',
      'where the over-long string is an op\'s own `id`, an `add`\'s `node.id` or a `token` op\'s `path`, the op is malformed (`shape`)',
      '`editOpsBytes` binds a page\'s edit only; a local apply is bound by its body.',
      "the page's message is checked on each frame header before its payload is read",
      'one over is accepted, then closed 1008 before `welcome`, so the page reads the code',
      'A local apply is not a connection and counts toward no connection limit.',
      'a single op whose `ops` message alone would pass 1 MB refuses the whole apply with `limit`',
      'judged from `Content-Length` before the body is read, and from what is read',
    ]);
    all(md, 'HTTP routes', [
      "The GETs are guarded as the dashboard's other data GETs are (its host check and the relay mark refused, 403)",
      'a same-origin `Origin` (exactly `http://<Host>`; absent or another is 403), no relay mark, the person headers by presence@1 §4 (403), level `full` (View 403), `Content-Type: application/json` (415)',
      'With `&at=main`, the canvas as main has it, for any canvas on main (open for editing or not), `session` null.',
      'A slug neither open nor on main: 404.',
      'Then a slug `land` closed 423, any other slug not open for editing 404: the 423 is judged first.',
      'the image at most 4 MB, the body at most 6 MB (413, judged from `Content-Length` before reading and from what is read)',
      'sniffed by its first bytes as PNG, JPEG, WebP or GIF (anything else, SVG included, 415)',
      'saved as `images/<first 16 hex of SHA-256>.<ext>` → `{ "src" }`, so the same bytes twice give the same `src`',
      '413 when the folder would pass 25 MB; 400 for bad JSON, keys or base64',
      '`<file>` exactly `[0-9a-f]{16}\\.(png|jpg|webp|gif)`, else 404: nothing from the URL is joined to a path unless it matches',
      "Served from the canvas's folder on its branch while it is open for editing, else from main's, else 404",
      '`X-Content-Type-Options: nosniff`',
      'it refuses any `Origin`, `Sec-Fetch-Site`, `x-devteam-relay`, `x-devteam-person` or `x-devteam-level` (403), and requires `x-devteam-canvas-token` equal to the token in `run/canvas-token`',
      'With no session open, the answer is 503 `{ "why": "no-session" }` and nothing changes',
      '**One judgement, then one change.**',
      'Refused, nothing changes, no `ops` is sent, and the answer is 409 `{ "why": <refusal code> }`.',
      'the change is sent as consecutive `ops` messages, each a run of the ops in order whose message fits 1 MB, each raising `rev` by one, all sent before any other edit is taken, with `by` `{ "id": by, "name": by, "via" }` and `ack` null',
      '**The answer waits for the disk.**',
      'answers 200 `{ "rev", "edits": <messages sent>, "saved": true }` once the write covering `rev` is done (and `saved` is sent)',
      'While saving is paused it answers at once with `"saved": false`',
      'A restart after a local apply answered `saved: true` keeps that apply.',
      '**Statuses in order**: the guards (403, 413), then a slug `land` closed 423 `{ "why": "closed" }`, then any other slug not open for editing 404, then no session 503, then the body (400 for bad JSON or keys), then 409 or 200.',
      'the owner-action guards and a 50 MB body limit (413 from `Content-Length`)',
      'The fake answers 501 within the limit.',
      "the fake doesn't serve them (404)",
    ]);
    all(md, 'Presence on a canvas', [
      '`{ "page": "canvas", "tab": "<canvas page id>", "peek": null, "art": "<slug>@canvas", "thread": … }`',
      'A cursor\'s anchor `k` is the node id under the pointer; over empty canvas it is `@<page id>`',
      "fractions of the page's content bounds (the union of its top-level nodes' rectangles plus 200 px around)",
      "checked with presence's own `shapeErrors` plus these rules",
    ]);
    all(md, 'Pins', [
      'an `artifact-notes@1` note whose anchor is `{ "node": "<id>" }`',
      'The value is 1 to 64 characters of one line of plain text',
      'documented here for the kit\'s `anchorProblem` ticket',
      '`shapeErrors(\'note-anchor\', …)`',
    ]);
    all(md, 'Exports', [
      'HTML: text escaped as text; attribute values quoted and escaped.',
      'CSS: class and custom-property names built from a sanitiser (`[a-z0-9-]`, a numeric suffix on collision), never from raw names',
      'and `\\(` written as `\\\\(` so nothing interpolates',
      'Markdown: names and text inside code spans whose fence is longer than any run of backticks they hold',
      'goldens',
    ]);
    all(md, 'Not defended', [
      'A process that can read `run/canvas-token` edits as any session name it claims.',
      'A local process opening `/canvas` on the loopback port with no person headers is the owner',
    ]);
    all(md, 'Canvas test files', [
      "A real measured call's callee is the whole identifier `test`, in code",
      "so it also counts `subtest('canvas A<n>:` and `t.test('canvas A<n>:`, and those are problems too",
      'a match inside a comment, a string or a template is a problem wherever it is',
      'every real call is in a `test/canvas-*.test.mjs` file; no `canvas A<n>:` appears twice',
      'every `test/canvas-*.test.mjs`, and every file holding a match, passes the skip rule',
      "`skip: canDrive ? false : '<reason>'` (a single-quoted, non-empty reason), with `canDrive` imported by that name from `./lib/chrome.mjs` in that file",
      "`skip: process.platform === 'darwin' ? false : 'not macOS'`",
      'No `.skip`, `.todo`, `todo:`, `.only` or `only:`.',
      'No quoted keys, computed keys or bracket access with those words',
      "as in `case 'skip':`, `x ? 'only' : y` or `['a', 'skip']`",
      'In a canvas test file, reword such a line',
    ]);
    all(md, 'The fake', [
      '`startCanvasFake(opts) → Promise<fake>`',
      '`canvases`: slug → document, open for editing; `main`: slug → document, as main has it',
      '`images`: slug → `{ "<16 hex>.<ext>": Buffer }`; `folderBytes`: slug → bytes of the folder\'s other files',
      '`repo`: `{ name, public }`, default `{ name: null, public: null }`; `ownerName`: `\'Owner\'`; `token`: the local route\'s token, default random',
      '`clock`: `\'real\'` (default) or `\'manual\'`, where no timer fires and time moves only by `tick(ms)`',
      '`serve(req, res)` for any other plain request',
      '`{ url, port, token, close(), doc(slug), rev(slug), session(slug), save(slug), pause(slug, why), resume(slug), replace(slug, doc), land(slug), remove(slug), restart(slug), stats(), tick(ms) }`',
      '`replace` sends `reload` with a new session id and forgets every client\'s `seq`',
      '`land` sends `closed` `landed`, closes with 1000 and moves the slug to main (later upgrades 404, the local route 423)',
      '`restart` closes every connection on that canvas with 1012, reverts it to its last saved document and makes a new session id',
      'over `net`, joining continuation frames into one message',
      '`request(url, { method, headers, body, contentLength })`',
      '`{ "fake": { options }, "request": { "method", "path", "headers", "body"?, "contentLength"? }, "status", "requestKind", "responseKind", "response"? }`',
      '`"requestKind"` is an `HTTP_KINDS` entry the request body holds to, or null when the request has no JSON body or is deliberately broken',
      '`playHttp(file, { fixturesDir }) → Promise<void>`',
      'a fixture for an unserved route (`export`, `edit`) expects 404 with `responseKind` null',
      '`{ "canvas": "<doc fixture>", "slug", "images"?: [names], "steps": [ … ] }`',
      '`{ "open": "<name>", "person": "<x-devteam-person value>" or null, "level": "full"|"view" or null, "status"?: <n> }`',
      '`{ "as": "<name>", "send": {…} }`; `{ "as": "<name>", "close": true }`',
      'its body checked as `local-request` unless its expected `status` is a refusal (403, 413, 400) meant to exercise a broken body',
      '`{ "do": "save"|"pause"|"resume"|"replace"|"land"|"remove"|"restart", "arg"?: … }`; `{ "tick": <ms> }`',
      'each optionally with `"expect": { "<name>": [ messages ] }` and `"doc"`',
      '`playExchange(fake, exchange, { fixturesDir })` runs it on the manual clock',
      'a connection not named must have received nothing; pings never fall due inside an exchange',
      'An expected list may end with `{ "$close": <code> }`',
      'In expected messages `"$session"` matches the canvas\'s current session id and `"$conn:<name>"` that connection\'s conn; nothing else is a placeholder.',
      '**An HTTP fixture** (`http-<route key>-<case>.json`)',
    ]);
  });

  await t.test('fixtures: every file is known', () => {
    const files = fixtureFiles();
    assert.ok(files.length > 0);
    const { images, folderBytes } = imagesOf();
    assert.ok(images.size > 0, 'images/ holds an image');
    for (const rel of files) {
      const k = fixtureKind(rel);
      assert.ok(k, `${rel} is of a known kind by its name`);
      if (k.kind === 'image') {
        const bytes = fs.readFileSync(path.join(FIX, rel));
        const [hex, ext] = rel.slice('images/'.length).split('.');
        assert.equal(crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16), hex, `${rel} is named by its own hash`);
        assert.ok(MAGIC[ext](bytes), `${rel} is a ${ext} by its first bytes`);
      } else if (k.kind === 'doc') {
        assert.deepEqual(docErrors(readFix(rel), { images, folderBytes }), [], `${rel} is a valid document`);
      } else if (k.kind === 'message') {
        assert.deepEqual(shapeErrors(k.shape, readFix(rel)), [], `${rel} holds to ${k.shape}`);
      } else {
        // http-* (T3) and exchange-* (T4) are checked by their own runners; here they need only parse
        readFix(rel);
      }
    }
    // the rule itself: unknown names are unknown
    for (const bad of ['notes.json', 'msg-nope.json', 'doc.json', 'images/0123456789ABCDEF.png', 'images/x.png', 'golden/a.html', 'doc-a.txt', 'msg-ops_x.json']) {
      assert.equal(fixtureKind(bad), null, `${bad} is unknown`);
    }
    assert.deepEqual(fixtureKind('msg-ops-local.json'), { kind: 'message', shape: 'ops' });
    assert.deepEqual(fixtureKind('presence-move-empty.json'), { kind: 'message', shape: 'presence-move' });
  });

  await t.test('fixtures: static coverage', () => {
    const types = new Set();
    const used = new Set();
    const modes = new Set();
    const tokenTypes = new Set();
    for (const rel of docFixtures()) {
      const d = readFix(rel);
      for (const ty of tokenTypesOf(d.tokens)) tokenTypes.add(ty);
      for (const n of Object.values(d.nodes)) {
        types.add(n.type);
        for (const p of Object.keys(PROPS[n.type])) if (uses(n, p)) used.add(`${n.type} ${p}`);
        if (n.layout && n.layout.mode) modes.add(n.layout.mode);
      }
    }
    sameSet([...types], TYPES, 'every node type is in a document fixture');
    for (const ty of TYPES) for (const p of Object.keys(PROPS[ty])) assert.ok(used.has(`${ty} ${p}`), `a document fixture's ${ty} sets ${p}`);
    sameSet([...modes], PROPS.frame['layout.mode'].words, 'every layout mode');
    sameSet([...tokenTypes], TOKEN_TYPES, 'every token type');
    const files = fixtureFiles();
    for (const kind of MSG_KINDS) assert.ok(files.some((f) => { const k = fixtureKind(f); return k && k.kind === 'message' && k.shape === kind; }), `a msg- fixture of ${kind}`);
    for (const kind of ['presence-here', 'presence-move', 'note-anchor']) assert.ok(files.some((f) => (fixtureKind(f) || {}).shape === kind), `a fixture of ${kind}`);
    assert.ok(files.includes('presence-move-empty.json'), 'a cursor over empty canvas');
    assert.ok(readFix('presence-move-empty.json').a.k.startsWith('@'), 'anchored to @<page id>');
  });

  await t.test('fixtures: resolve on doc-every-type', () => {
    const d = readFix('doc-every-type.json');
    const at = (doc) => resolve(doc, 'buy')['button-label'].text;
    assert.equal(at(d), 'Buy now', 'the instance prop value');
    delete d.nodes.buy.props.label;
    assert.equal(at(d), 'Override label', "then the instance's override");
    delete d.nodes.buy.overrides['button-label'].text;
    assert.equal(at(d), 'Variant label', "then the chosen variant's override");
    delete d.nodes.button.variants.primary['button-label'].text;
    assert.equal(at(d), 'Default label', "then the prop's default, never the base");
    delete d.nodes.button.props.label;
    assert.equal(at(d), 'Base label', 'then the base');
    // the five levels are really there
    const full = readFix('doc-every-type.json');
    assert.equal(full.nodes['button-label'].text, 'Base label');
    assert.equal(full.nodes.buy.component, 'button');
    assert.equal(full.nodes.buy.variant, 'primary');
  });

  await t.test('hostile: valid with every field kind; every free text carries every marker; freeTexts finds each kind', () => {
    const h = readFix('hostile.json');
    assert.deepEqual(docErrors(h, imagesOf()), [], 'hostile.json is a valid document');
    const nodes = Object.values(h.nodes);
    sameSet([...new Set(nodes.map((n) => n.type))], TYPES, 'every node type');
    assert.ok(h.pages.length >= 2, 'two pages');
    const comps = nodes.filter((n) => n.type === 'component');
    assert.ok(comps.some((c) => Object.values(c.props || {}).some((pd) => pd.type === 'text')), 'a component with a text prop');
    assert.ok(comps.some((c) => Object.values(c.variants || {}).some((v) => Object.values(v).some((o) => typeof o.text === 'string'))), 'a variant with a text override');
    const insts = nodes.filter((n) => n.type === 'instance');
    assert.ok(insts.some((n) => Object.values(n.props || {}).some((v) => typeof v === 'string')), 'an instance with a text prop value');
    assert.ok(insts.some((n) => Object.values(n.overrides || {}).some((o) => typeof o.text === 'string')), 'an instance with a text override');
    const texts = freeTexts(h);
    sameSet([...new Set(texts.map((f) => f.kind))], FREE_KINDS, 'hostile.json fills every kind of free-text field');
    for (const f of texts) for (const m of HOSTILE_MARKERS) assert.ok(f.value.includes(m), `${f.where} holds ${JSON.stringify(m)}`);
    assert.ok(texts.some((f) => f.kind === 'node-name' && [...f.value].length <= LIMITS.nameChars), 'a name of at most 200 characters carries every marker');
    // freeTexts on an inline document with one field of each kind: each kind found once
    const one = {
      canvas: 1, rev: 0, tokens: {},
      pages: [{ id: 'p', name: 'P', children: ['c', 'i'] }],
      nodes: {
        c: { type: 'component', parent: 'p', children: ['ct'], props: { a: { type: 'text', default: 'D', target: { id: 'ct', prop: 'text' } } }, variants: { v: { ct: { text: 'V' } } } },
        ct: { type: 'text', parent: 'c', text: 'T' },
        i: { type: 'instance', parent: 'p', component: 'c', name: 'N', props: { a: 'PV' }, overrides: { ct: { text: 'O' } } },
      },
    };
    assert.deepEqual(docErrors(one), [], 'the inline document is valid');
    const got = freeTexts(one);
    assert.deepEqual(got.map((f) => f.kind).sort(), [...FREE_KINDS].sort(), 'each kind found, once');
    assert.deepEqual(got.map((f) => f.value).sort(), ['D', 'N', 'O', 'P', 'PV', 'T', 'V']);
  });

  await t.test('rules: Object.prototype is untouched', () => {
    assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).sort(), PROTO_NAMES);
    assert.equal(({}).text, undefined);
    assert.equal(({}).x, undefined);
  });
});
