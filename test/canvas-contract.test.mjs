// canvas-doc@1 and canvas@1 (test/contracts/canvas.md): the document's rules, the ops and the
// messages as code in test/lib/canvas-fake.mjs, held to one another here. One test, A1, whose subtests
// run in order: the rules on inline documents and messages (each rule, class and kind with a broken
// copy), whole-edit judgement, resolution order, unicode, scale, and the canvas test-file rule that
// keeps the measure's names honest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TYPES, PROPS, CLASSES, TOKEN_TYPES, DOC_RULES, OPS, PAGE_KINDS, SERVER_KINDS, HTTP_KINDS, REFUSALS, ROUTES, LIMITS, LIMIT_ANSWERS, RANGES,
  NODE_ID_RE, SLUG_RE, CLIENT_RE, SESSION_RE, BY_RE, IMAGE_FILE_RE, HOSTILE_MARKERS, PAUSE_WHYS, CLOSE_WHYS,
  docErrors, opErrors, applyEdit, resolve, makeSeqBook, shapeErrors, freeTexts, skipProblems, measureProblems, SKIP_CASES, MEASURE_CASES,
  startCanvasFake, openCanvas, request, playHttp, playExchange, exchangeOptions, exchangeProblems,
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

// ---- the fake (startCanvasFake), its client (openCanvas) and request ----
// Timing runs on the manual clock. Every wait is `next`, `closed`, or polling with a deadline; a
// "never" ends on a round trip (a ping frame answered after everything the fake wrote before it).

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const SLUG = 'board';
const PNG_NAME = '429be16d0a91e377.png';
const pngBytes = () => fs.readFileSync(path.join(FIX, 'images', PNG_NAME));
const P = (id, name = 'Ann Lee') => ({ 'x-devteam-person': `${id};name=${encodeURIComponent(name)}` });
const PV = (id, name = 'Vi') => ({ ...P(id, name), 'x-devteam-level': 'view' });
const W = (d) => Buffer.byteLength(`${JSON.stringify(d, null, 2)}\n`);
const hashName = (b, ext) => `${crypto.createHash('sha256').update(b).digest('hex').slice(0, 16)}.${ext}`;
const IMAGE_BYTES = {
  png: () => pngBytes(),
  jpg: () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('a jpeg body')]),
  webp: () => Buffer.concat([Buffer.from('RIFF'), Buffer.from([20, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(8, 1)]),
  gif: () => Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(10, 2)]),
};
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

async function until(fn, what, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out after ${ms} ms: ${what}`);
    await new Promise((r) => setTimeout(r, 2));
  }
}
// `c`'s close code, failing when no close comes within `ms`.
async function closedWithin(c, ms = 5000) {
  let timer;
  const late = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`not closed within ${ms} ms`)), ms); });
  try { return await Promise.race([c.closed, late]); } finally { clearTimeout(timer); }
}
async function withFake(opts, fn) {
  const fake = await startCanvasFake({ clock: 'manual', ...opts });
  try { return await fn(fake); } finally { await fake.close(); }
}
const stat = (fake, c) => fake.stats().find((s) => s.conn === c.you.conn);
const openOn = (fake, opts = {}) => openCanvas(fake.url, { slug: SLUG, ...opts });
// Everything the fake wrote to `c` before this has arrived once its pong is back.
let trips = 0;
async function roundTrip(c) {
  const tag = `rt-${++trips}`;
  c.frame(Buffer.from(tag), { opcode: 9 });
  await until(() => c.controls.some((x) => x.opcode === 10 && x.payload.toString() === tag), `the pong ${tag}`);
}
let seqN = 0;
// Sends an edit; resolves on its ack or its refusal.
function sendEdit(c, ops, client = CLIENT, seq = ++seqN) {
  c.send({ t: 'edit', client, seq, ops });
  const mine = (m) => (m.t === 'ops' && m.ack !== null && m.ack.client === client && m.ack.seq === seq) || (m.t === 'refused' && m.client === client && m.seq === seq);
  return c.next(mine, 20000);
}
const outcome = (m) => (m.t === 'refused' ? m.why : 'applied');
const originOf = (fake) => `http://127.0.0.1:${fake.port}`;
// An owner-action POST (image, import), same-origin and JSON unless `headers` says otherwise.
const post = (fake, route, body, { headers = {}, slug = SLUG, contentLength } = {}) => request(`${fake.url}/api/canvas/${route}?slug=${slug}`, {
  method: 'POST', headers: { Origin: originOf(fake), 'Content-Type': 'application/json', ...headers }, body, contentLength,
});
// The supervisor's local route, with the fake's token unless `headers` says otherwise.
const local = (fake, body, { headers = {}, slug = SLUG, contentLength } = {}) => request(`${fake.url}/api/canvas/local?slug=${slug}`, {
  method: 'POST', headers: { 'x-devteam-canvas-token': fake.token, 'Content-Type': 'application/json', ...headers }, body, contentLength,
});
const localBody = (ops, by = 'supervisor', via = 'apply') => ({ by, via, ops });
const setName = (id, value) => ({ op: 'set', id, prop: 'name', value });
// `buf` cut in `n` pieces.
const pieces = (buf, n) => { const size = Math.ceil(buf.length / n); return Array.from({ length: n }, (_, i) => buf.subarray(i * size, (i + 1) * size)); };
// The messages `c` got after `mark`, up to a round trip.
async function since(c, mark) { await roundTrip(c); return c.messages.slice(mark); }
const noTicks = (list) => list.filter((m) => m.t !== 'ping');
// A page holding `nodes` (id -> node, each parented to p1 unless it says otherwise), its children in order.
function docWith(nodes, extra = {}) {
  const d = { ...minimal(), ...extra, nodes: {} };
  for (const [id, n] of Object.entries(nodes)) {
    d.nodes[id] = { parent: 'p1', ...structuredClone(n) };
    if (d.nodes[id].parent === 'p1') d.pages[0].children.push(id);
  }
  for (const [id, n] of Object.entries(d.nodes)) if (n.parent !== 'p1') d.nodes[n.parent].children.push(id);
  return d;
}
const range = (n) => Array.from({ length: n }, (_, i) => i);
const rectsDoc = (n) => docWith(Object.fromEntries(range(n).map((i) => [`r${i}`, { type: 'rect' }])));
// A canvas holding `doc` with one owner connection.
const onCanvas = (doc, fn, opts = {}) => withFake({ canvases: { [SLUG]: doc }, ...opts }, async (fake) => {
  const c = await openOn(fake);
  assert.ok(c.you, 'welcomed');
  return fn(fake, c);
});
// Two edits through the fake: the first, at the limit, applies; the second, one over, is refused `why`.
const atAndOver = (doc, atOps, overOps, why, opts) => onCanvas(doc, async (fake, c) => {
  assert.equal(outcome(await sendEdit(c, atOps)), 'applied', 'at the limit');
  assert.equal(outcome(await sendEdit(c, overOps)), why, 'one over');
}, opts);
// Opens `n` connections (keep: false) on `slug`, person i its own unless `person` says, each welcomed.
async function fill(fake, slug, n, person = (i) => `p-${slug}-${i}`) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = await openCanvas(fake.url, { slug, headers: P(person(i)), keep: false });
    assert.ok(c.you, `${slug} connection ${i} welcomed`);
    out.push(c);
  }
  return out;
}
// One over: accepted (101), then closed 1008 before welcome.
async function oneOver(fake, slug, headers, what) {
  const c = await openCanvas(fake.url, { slug, headers, keep: false });
  assert.equal(c.status, 101, `${what}: accepted from the handshake`);
  assert.equal(c.you, undefined, `${what}: no welcome`);
  assert.equal(await closedWithin(c), 1008, `${what}: closed 1008`);
}
const closeAll = (cs) => { for (const c of cs) c.destroy(); };
// A pong of exactly `n` bytes (an extra key the fake ignores pads it).
function paddedPong(n) {
  const m = { t: 'pong', pad: '' };
  m.pad = 'x'.repeat(n - Buffer.byteLength(JSON.stringify(m)));
  return Buffer.from(JSON.stringify(m));
}
// A vector path of exactly `n` bytes: a move and one long number.
const pathOfBytes = (n) => `M${'0'.repeat(n - 1)}`;
const isPing = (m) => m.t === 'ping';
// `obj` as JSON, padded with trailing spaces (still valid JSON) to exactly `n` bytes.
function padJson(obj, n) {
  const s = JSON.stringify(obj);
  assert.ok(Buffer.byteLength(s) <= n);
  return Buffer.concat([Buffer.from(s), Buffer.alloc(n - Buffer.byteLength(s), 0x20)]);
}
// A body in chunked transfer coding (1 MB chunks), sent with no Content-Length.
function chunked(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i += 2 ** 20) {
    const part = buf.subarray(i, i + 2 ** 20);
    out.push(Buffer.from(`${part.length.toString(16)}\r\n`), part, Buffer.from('\r\n'));
  }
  out.push(Buffer.from('0\r\n\r\n'));
  return Buffer.concat(out);
}
const CHUNKED = { 'Content-Length': null, 'Transfer-Encoding': 'chunked' };
// A POST that declares `Content-Length: n` and sends no body: true when, `ms` later, the fake has neither
// answered nor closed (so it did not refuse from the header and abort).
function silentAfter(fake, where, headers, n, ms = 300) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port: fake.port });
    let heard = false;
    sock.on('data', () => { heard = true; });
    sock.on('close', () => { heard = true; });
    sock.on('error', () => {});
    sock.on('connect', () => {
      const lines = [`Host: 127.0.0.1:${fake.port}`, `Content-Length: ${n}`, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`)];
      sock.write(`POST ${where} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
      setTimeout(() => { const quiet = !heard; sock.destroy(); resolve(quiet); }, ms);
    });
  });
}
// The header of a masked client frame of `len` bytes: the bytes before its payload.
const headerBytes = (len) => (len < 126 ? 6 : len < 65536 ? 8 : 14);

// Each limit of the contract's Limits table, crossed by one against the fake (document limits through an
// edit on its socket, or the local route where a page's 64 KB can't carry it). A table row with no entry fails.
const LIMIT_CHECKS = {
  async docBytes() {
    // k texts of `full` characters (ids of one width, so each adds the same bytes) fill the document so
    // that t0000's text of L characters makes it exactly 5 MB as written at rev 1
    const id = (i) => `t${String(i).padStart(4, '0')}`;
    const withTexts = (k, full) => {
      const d = docWith({ [id(0)]: { type: 'text', text: '' } });
      for (let i = 1; i <= k; i++) { d.nodes[id(i)] = { type: 'text', parent: 'p1', text: 'x'.repeat(full) }; d.pages[0].children.push(id(i)); }
      return d;
    };
    const base = W({ ...withTexts(0, 0), rev: 1 });
    const per0 = W({ ...withTexts(1, 0), rev: 1 }) - base;
    let full = LIMITS.textChars;
    while ((LIMITS.docBytes - base) % (per0 + full) >= LIMITS.textChars) full -= 1;
    const d = withTexts(Math.floor((LIMITS.docBytes - base) / (per0 + full)), full);
    const L = LIMITS.docBytes - W({ ...d, rev: 1 });
    assert.ok(L >= 0 && L < LIMITS.textChars, `t0000 takes the rest (${L})`);
    const text = (n) => [{ op: 'set', id: id(0), prop: 'text', value: 'x'.repeat(n) }];
    await atAndOver(d, text(L), text(L + 1), 'limit');
  },
  async folderBytes() {
    const d = minimal();
    const after = W({ ...d, rev: 1, pages: [{ ...d.pages[0], name: 'a' }] });
    await atAndOver(d, [setName('p1', 'a')], [setName('p1', 'ab')], 'limit', { folderBytes: { [SLUG]: LIMITS.folderBytes - after } });
  },
  async nodes() {
    const add = (id) => [{ op: 'add', node: { id, type: 'rect', parent: 'p1' }, after: null }];
    await atAndOver(rectsDoc(LIMITS.nodes - 1), add('last'), add('over'), 'limit');
  },
  async pages() {
    const d = minimal();
    for (let i = 2; i < LIMITS.pages; i++) d.pages.push({ id: `p${i}`, name: '', children: [] });
    const add = (id) => [{ op: 'add', node: { id, type: 'page', parent: null, name: id }, after: null }];
    await atAndOver(d, add('plast'), add('pover'), 'limit');
  },
  async tokens() {
    const g = {};
    for (let i = 0; i < LIMITS.tokens - 1; i++) g[`t${i}`] = { $type: 'number', $value: i };
    const tok = (p) => [{ op: 'token', path: p, value: { $type: 'number', $value: 1 } }];
    await atAndOver({ ...minimal(), tokens: { g } }, tok('g.last'), tok('g.over'), 'limit');
  },
  async tokenDepth() {
    const tok = (p) => [{ op: 'token', path: p, value: { $type: 'number', $value: 1 } }];
    await atAndOver(minimal(), tok(range(LIMITS.tokenDepth).map((i) => `a${i}`).join('.')), tok(range(LIMITS.tokenDepth + 1).map((i) => `b${i}`).join('.')), 'limit');
  },
  async depth() {
    const chain = {};
    for (let i = 1; i < LIMITS.depth; i++) chain[`f${i}`] = { type: 'frame', parent: i === 1 ? 'p1' : `f${i - 1}`, children: [] };
    const add = (id, parent) => [{ op: 'add', node: { id, type: 'frame', parent }, after: null }];
    await atAndOver(docWith(chain), add(`f${LIMITS.depth}`, `f${LIMITS.depth - 1}`), add('deeper', `f${LIMITS.depth}`), 'limit');
  },
  async overrideEntries() {
    const nodes = { c: { type: 'component', children: [] } };
    for (let i = 0; i <= LIMITS.overrideEntries; i++) nodes[`r${i}`] = { type: 'rect', parent: 'c' };
    nodes.i = { type: 'instance', component: 'c', overrides: Object.fromEntries(range(LIMITS.overrideEntries - 1).map((k) => [`r${k}`, { visible: false }])) };
    const ov = (k) => [{ op: 'set', id: 'i', prop: `overrides.r${k}.visible`, value: false }];
    await atAndOver(docWith(nodes), ov(LIMITS.overrideEntries - 1), ov(LIMITS.overrideEntries), 'limit');
  },
  async props() {
    const def = { type: 'bool', default: true, target: { id: 'b', prop: 'visible' } };
    const props = Object.fromEntries(range(LIMITS.props - 1).map((i) => [`p${i}`, def]));
    const set = (name) => [{ op: 'set', id: 'c', prop: `props.${name}`, value: def }];
    await atAndOver(docWith({ c: { type: 'component', children: [], props }, b: { type: 'rect', parent: 'c' } }), set('last'), set('over'), 'limit');
  },
  async variants() {
    const v = { b: { visible: false } };
    const variants = Object.fromEntries(range(LIMITS.variants - 1).map((i) => [`v${i}`, v]));
    const set = (name) => [{ op: 'set', id: 'c', prop: `variants.${name}`, value: v }];
    await atAndOver(docWith({ c: { type: 'component', children: [], variants }, b: { type: 'rect', parent: 'c' } }), set('last'), set('over'), 'limit');
  },
  async tracks() {
    const cols = (n) => [{ op: 'set', id: 'f', prop: 'layout.columns', value: Array(n).fill('auto') }];
    await atAndOver(docWith({ f: { type: 'frame', children: [] } }), cols(LIMITS.tracks), cols(LIMITS.tracks + 1), 'value');
  },
  async idChars() {
    // a componentRef value: an op's own id over 40 would be a malformed op (shape), §7
    const C = 'c'.repeat(LIMITS.idChars);
    const ref = (v) => [{ op: 'set', id: 'i', prop: 'component', value: v }];
    await atAndOver(docWith({ [C]: { type: 'component', children: [] }, i: { type: 'instance', component: C } }), ref(C), ref(`${C}c`), 'value');
  },
  async nameChars() {
    await atAndOver(docWith({ r: { type: 'rect' } }), [setName('r', 'n'.repeat(LIMITS.nameChars))], [setName('r', 'n'.repeat(LIMITS.nameChars + 1))], 'value');
  },
  async textChars() {
    const text = (n) => [{ op: 'set', id: 't', prop: 'text', value: 'x'.repeat(n) }];
    await atAndOver(docWith({ t: { type: 'text' } }), text(LIMITS.textChars), text(LIMITS.textChars + 1), 'value');
  },
  async pathBytes() {
    // past a page's 64 KB edit, so by the local route (409 with the code)
    await onCanvas(docWith({ v: { type: 'vector', path: 'M0 0' } }), async (fake) => {
      const set = (n) => localBody([{ op: 'set', id: 'v', prop: 'path', value: pathOfBytes(n) }]);
      assert.equal((await local(fake, set(LIMITS.pathBytes))).status, 200, 'at the limit');
      const over = await local(fake, set(LIMITS.pathBytes + 1));
      assert.equal(over.status, 409);
      assert.deepEqual(over.json, { why: 'value' });
    });
  },
  async figmaChars() {
    const fig = (n) => [{ op: 'set', id: 'r', prop: 'figma', value: '1'.repeat(n) }];
    await atAndOver(docWith({ r: { type: 'rect' } }), fig(LIMITS.figmaChars), fig(LIMITS.figmaChars + 1), 'value');
  },
  async propNameChars() {
    // a variantName value: a set path naming a 41-character variant names no property (prop), §7
    const V = `V${'a'.repeat(LIMITS.propNameChars - 1)}`;
    const choose = (v) => [{ op: 'set', id: 'i', prop: 'variant', value: v }];
    const d = docWith({ c: { type: 'component', children: [], variants: { [V]: { b: { visible: false } } } }, b: { type: 'rect', parent: 'c' }, i: { type: 'instance', component: 'c' } });
    await atAndOver(d, choose(V), choose(`${V}a`), 'value');
  },
  async tokenSegmentChars() {
    // a $ref value: a token op's own path over 40 would be a malformed op (shape), §7
    const K = 'k'.repeat(LIMITS.tokenSegmentChars);
    const fillRef = (p) => [{ op: 'set', id: 'r', prop: 'fill', value: { $ref: p } }];
    const d = docWith({ r: { type: 'rect' } }, { tokens: { [K]: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 0] } } } });
    await atAndOver(d, fillRef(K), fillRef(`${K}k`), 'value');
  },
  async pageMsgBytes() {
    await onCanvas(minimal(), async (fake, c) => {
      c.frame(paddedPong(LIMITS.pageMsgBytes));
      await until(() => stat(fake, c)?.messages === 1, 'the 256 KB message read');
      // once joined: two frames, each under the limit, together exactly at it, are read
      const [a, b] = pieces(paddedPong(LIMITS.pageMsgBytes), 2);
      c.frame(a, { fin: false });
      c.frame(b, { opcode: 0 });
      await until(() => stat(fake, c)?.messages === 2, 'the 256 KB message in two frames read');
      // and together one over closes 1008 from the second frame's header, before its payload
      const [x, y] = pieces(paddedPong(LIMITS.pageMsgBytes + 1), 2);
      assert.ok(x.length < LIMITS.pageMsgBytes && y.length < LIMITS.pageMsgBytes);
      c.frame(x, { fin: false });
      c.raw(c.build(y, { opcode: 0 }).subarray(0, headerBytes(y.length)));
      assert.equal(await closedWithin(c), 1008, 'over once joined');
    });
    await onCanvas(minimal(), async (fake, c) => {
      const over = c.build(paddedPong(LIMITS.pageMsgBytes + 1));
      c.raw(over.subarray(0, headerBytes(LIMITS.pageMsgBytes + 1))); // the header alone: the size is weighed before any payload
      assert.equal(await closedWithin(c), 1008, 'one frame over');
    });
  },
  async pageFrames() {
    await onCanvas(minimal(), async (fake, c) => {
      const inFrames = (buf, n) => pieces(buf, n).forEach((p, i) => c.frame(p, { opcode: i === 0 ? 1 : 0, fin: i === n - 1 }));
      const e = { t: 'edit', client: CLIENT, seq: ++seqN, ops: [setName('p1', 'sixteen frames')] };
      inFrames(Buffer.from(JSON.stringify(e)), LIMITS.pageFrames);
      assert.equal(outcome(await c.next((m) => m.t === 'ops' && m.ack.seq === e.seq)), 'applied', '16 frames');
      inFrames(Buffer.from(JSON.stringify({ ...e, seq: ++seqN })), LIMITS.pageFrames + 1);
      assert.equal(await closedWithin(c), 1008, 'a 17th frame');
    });
  },
  async editOpsBytes() {
    const opsOf = (n) => {
      const ops = range(8).map(() => ({ op: 'set', id: 't', prop: 'text', value: 'x'.repeat(8000) }));
      ops[7].value = 'x'.repeat(8000 + n - Buffer.byteLength(JSON.stringify(ops)));
      assert.equal(Buffer.byteLength(JSON.stringify(ops)), n);
      return ops;
    };
    await atAndOver(docWith({ t: { type: 'text' } }), opsOf(LIMITS.editOpsBytes), opsOf(LIMITS.editOpsBytes + 1), 'limit');
  },
  async serverMsgBytes() {
    const P64 = pathOfBytes(LIMITS.pathBytes);
    const vectors = Object.fromEntries(range(40).map((i) => [`v${i}`, { type: 'vector', path: 'M0 0' }]));
    await onCanvas(docWith(vectors), async (fake, c) => {
      const ops = range(40).map((i) => ({ op: 'set', id: `v${i}`, prop: 'path', value: P64 }));
      const mark = c.messages.length;
      const r = await local(fake, localBody(ops));
      assert.equal(r.status, 200);
      const got = (await since(c, mark)).filter((m) => m.t === 'ops');
      assert.ok(got.length >= 3, `split in ${got.length} messages`);
      assert.deepEqual(r.json, { rev: got.length, edits: got.length, saved: true }, 'one rev per message');
      assert.deepEqual(got.map((m) => m.rev), range(got.length).map((i) => i + 1));
      for (const m of got) assert.ok(Buffer.byteLength(JSON.stringify(m)) <= LIMITS.serverMsgBytes, 'each message at most 1 MB');
      assert.deepEqual(got.flatMap((m) => m.ops), ops, 'the runs, in order, are the ops');
      assert.equal(fake.rev(SLUG), got.length);
      // each run as long as fits (§8): no message but the last could take the next op within 1 MB, so the
      // count is the least the ops allow; for these 40 ops of a 64 KB path, 15, 15 and 10
      got.slice(0, -1).forEach((m, i) => {
        const more = { ...m, ops: [...m.ops, got[i + 1].ops[0]] };
        assert.ok(Buffer.byteLength(JSON.stringify(more)) > LIMITS.serverMsgBytes, `message ${i + 1} could not take the next op`);
      });
      assert.deepEqual(got.map((m) => m.ops.length), [15, 15, 10], 'the fewest messages: runs of 15, 15 and 10');
    });
    // the greedy fit at its edge: ops whose one message is exactly 1 MB go as one message; a byte more, as two
    const by1 = { id: 'supervisor', name: 'supervisor', via: 'apply' };
    const sixteen = Object.fromEntries(range(16).map((i) => [`v${i}`, { type: 'vector', path: 'M0 0' }]));
    const opsOfMessage = (n) => {
      const ops = range(16).map((i) => ({ op: 'set', id: `v${i}`, prop: 'path', value: P64 }));
      const size = () => Buffer.byteLength(JSON.stringify({ t: 'ops', rev: 1, by: by1, ack: null, ops }));
      ops[15].value = pathOfBytes(LIMITS.pathBytes - (size() - n));
      assert.equal(size(), n, `a message of exactly ${n} bytes`);
      return ops;
    };
    for (const [n, runs] of [[LIMITS.serverMsgBytes, [16]], [LIMITS.serverMsgBytes + 1, [15, 1]]]) {
      await onCanvas(docWith(sixteen), async (fake, c) => {
        const ops = opsOfMessage(n);
        const mark = c.messages.length;
        const r = await local(fake, localBody(ops));
        assert.equal(r.status, 200);
        const got = (await since(c, mark)).filter((m) => m.t === 'ops');
        assert.deepEqual(got.map((m) => m.ops.length), runs, `ops whose one message is ${n} bytes: runs of ${runs.join(', ')}`);
        assert.deepEqual(r.json, { rev: runs.length, edits: runs.length, saved: true });
      });
    }
    // a single op whose message alone passes 1 MB refuses the whole apply
    const nodes = { k: { type: 'component', children: [] } };
    for (let i = 0; i < 20; i++) nodes[`w${i}`] = { type: 'vector', parent: 'k', path: 'M0 0' };
    await onCanvas(docWith(nodes), async (fake, c) => {
      const big = { op: 'set', id: 'k', prop: 'variants', value: { big: Object.fromEntries(range(20).map((i) => [`w${i}`, { path: P64 }])) } };
      const mark = c.messages.length;
      const r = await local(fake, localBody([setName('p1', 'first'), big]));
      assert.equal(r.status, 409);
      assert.deepEqual(r.json, { why: 'limit' });
      assert.deepEqual(noTicks(await since(c, mark)), [], 'no ops sent');
      assert.equal(fake.rev(SLUG), 0, 'nothing changed');
    });
    // the threshold exactly: one op whose ops message is 1 MB is sent as it is; 1 MB + 1 is refused
    const by = { id: 'supervisor', name: 'supervisor', via: 'apply' };
    const opOfMessage = (n, rev) => {
      const big = Object.fromEntries(range(16).map((i) => [`w${i}`, { path: P64 }]));
      const op = { op: 'set', id: 'k', prop: 'variants', value: { big } };
      const size = () => Buffer.byteLength(JSON.stringify({ t: 'ops', rev, by, ack: null, ops: [op] }));
      big.w15.path = 'M0';
      big.w15.path = pathOfBytes(2 + n - size());
      assert.equal(size(), n, `an op whose message is ${n} bytes`);
      assert.ok(Buffer.byteLength(big.w15.path) <= LIMITS.pathBytes);
      return op;
    };
    await onCanvas(docWith(nodes), async (fake, c) => {
      const at = opOfMessage(LIMITS.serverMsgBytes, 1);
      let mark = c.messages.length;
      const r = await local(fake, localBody([at]));
      assert.deepEqual([r.status, r.json], [200, { rev: 1, edits: 1, saved: true }], 'a message of exactly 1 MB');
      const got = (await since(c, mark)).filter((m) => m.t === 'ops');
      assert.equal(got.length, 1);
      assert.equal(Buffer.byteLength(JSON.stringify(got[0])), LIMITS.serverMsgBytes, 'sent at exactly 1 MB');
      mark = c.messages.length;
      const over = await local(fake, localBody([opOfMessage(LIMITS.serverMsgBytes + 1, 2)]));
      assert.deepEqual([over.status, over.json], [409, { why: 'limit' }], 'one byte over');
      assert.deepEqual(noTicks(await since(c, mark)), [], 'no ops sent');
      assert.equal(fake.rev(SLUG), 1, 'nothing changed');
    });
  },
  async serverFrameBytes() {
    const P64 = pathOfBytes(LIMITS.pathBytes);
    const vectors = Object.fromEntries(range(8).map((i) => [`v${i}`, { type: 'vector', path: 'M0 0' }]));
    await onCanvas(docWith(vectors), async (fake, c) => {
      const ops = range(8).map((i) => ({ op: 'set', id: `v${i}`, prop: 'path', value: P64 }));
      const mark = c.frames.length;
      assert.equal((await local(fake, localBody(ops))).status, 200);
      const m = await c.next((x) => x.t === 'ops' && x.ops.length === 8);
      assert.deepEqual(m.ops, ops, 'joined by openCanvas');
      const fr = c.frames.slice(mark);
      for (const f of fr) assert.ok(f.len <= LIMITS.serverFrameBytes, 'each frame at most 256 KB');
      assert.ok(fr.some((f) => f.opcode === 1 && !f.fin) && fr.some((f) => f.opcode === 0 && f.fin), 'a text frame, then continuations');
    });
  },
  async perSecond() {
    await onCanvas(minimal(), async (fake, c) => {
      for (let i = 0; i < LIMITS.perSecond; i++) c.send({ t: 'pong' });
      await until(() => stat(fake, c)?.messages === LIMITS.perSecond, '30 read');
      await fake.tick(1000);
      for (let i = 0; i < LIMITS.perSecond; i++) c.send({ t: 'pong' });
      await until(() => stat(fake, c)?.messages === 2 * LIMITS.perSecond, '30 more, in the next second');
      c.frame(Buffer.from('31'), { opcode: 9 }); // a ping frame counts too
      assert.equal(await closedWithin(c), 1008, 'a 31st in a second');
    });
  },
  async perPerson() {
    await withFake({ canvases: { [SLUG]: minimal(), second: minimal() } }, async (fake) => {
      const cs = await fill(fake, SLUG, LIMITS.perPerson, () => 'p-same');
      await oneOver(fake, SLUG, P('p-same'), 'a 9th connection of a person');
      cs.push(...await fill(fake, 'second', 1, () => 'p-same')); // per canvas: a 9th on another canvas is welcomed
      cs.push(...await fill(fake, SLUG, 1, () => 'p-other'));
      closeAll(cs);
    });
  },
  async perCanvas() {
    await withFake({ canvases: { [SLUG]: minimal() } }, async (fake) => {
      const cs = await fill(fake, SLUG, LIMITS.perCanvas);
      await oneOver(fake, SLUG, P('p-51'), 'a 51st on a canvas');
      closeAll(cs);
    });
  },
  async openCanvases() {
    const slugs = range(LIMITS.openCanvases + 1).map((i) => `c${i}`);
    await withFake({ canvases: Object.fromEntries(slugs.map((s) => [s, minimal()])) }, async (fake) => {
      const cs = [];
      for (const s of slugs.slice(0, -1)) cs.push(...await fill(fake, s, 1));
      await oneOver(fake, slugs[LIMITS.openCanvases], P('p-21'), 'a 21st open canvas');
      cs.push(...await fill(fake, slugs[0], 1, () => 'p-again'));
      closeAll(cs);
    });
  },
  async perServer() {
    const n = LIMITS.perServer / LIMITS.perCanvas;
    const slugs = range(n + 1).map((i) => `s${i}`);
    await withFake({ canvases: Object.fromEntries(slugs.map((s) => [s, minimal()])) }, async (fake) => {
      const cs = [];
      for (const s of slugs.slice(0, n)) cs.push(...await fill(fake, s, LIMITS.perCanvas));
      assert.equal(fake.stats().length, LIMITS.perServer);
      await oneOver(fake, slugs[n], P('p-201'), 'a 201st on the server');
      closeAll(cs);
    });
  },
  async selectIds() {
    await onCanvas(rectsDoc(LIMITS.selectIds + 1), async (fake, c) => {
      const ids = range(LIMITS.selectIds + 1).map((i) => `r${i}`);
      await fake.tick(LIMITS.selectionsMs);
      await c.next((m) => m.t === 'selections');
      c.send({ t: 'select', ids: ids.slice(0, LIMITS.selectIds) });
      await roundTrip(c);
      await fake.tick(LIMITS.selectionsMs);
      const s = await c.next((m) => m.t === 'selections' && m.people[0].ids.length > 0);
      assert.deepEqual(s.people[0].ids, ids.slice(0, LIMITS.selectIds));
      const mark = c.messages.length;
      c.send({ t: 'select', ids });
      await roundTrip(c);
      await fake.tick(LIMITS.selectionsMs);
      assert.deepEqual(await since(c, mark), [], 'a select of 101 ids changes nothing');
    });
  },
  async refusedMemory() {
    await onCanvas(minimal(), async (fake, c) => {
      const cl = 'refusedmemory001';
      const bad = [setName('nope', 'x')];
      assert.equal(outcome(await sendEdit(c, bad, cl, 1)), 'missing');
      assert.equal(outcome(await sendEdit(c, [setName('p1', 'a')], cl, 1 + LIMITS.refusedMemory)), 'applied');
      assert.equal(outcome(await sendEdit(c, bad, cl, 1)), 'missing', 'within 2000 of the highest seen: refused again');
      assert.equal(outcome(await sendEdit(c, [setName('p1', 'b')], cl, 2 + LIMITS.refusedMemory)), 'applied');
      const again = await sendEdit(c, bad, cl, 1);
      assert.deepEqual(again, { t: 'ops', rev: 2, by: { id: 'owner', name: 'Owner', via: 'page' }, ack: { client: cl, seq: 1 }, ops: [] }, '2001 below: forgotten, re-acked');
    });
  },
  async pingMs() {
    await onCanvas(minimal(), async (fake, c) => {
      await fake.tick(LIMITS.pingMs - 1);
      await roundTrip(c);
      assert.equal(c.messages.filter(isPing).length, 0, 'no ping before 20000 ms');
      await fake.tick(1);
      await c.next(isPing);
    });
  },
  async unansweredPings() {
    await onCanvas(minimal(), async (fake, c) => {
      for (let i = 1; i <= 3; i++) {
        await fake.tick(LIMITS.pingMs);
        await until(() => c.messages.filter(isPing).length === i, `ping ${i}`);
        c.send({ t: 'pong' });
        await roundTrip(c);
      }
      await fake.tick(LIMITS.pingMs * LIMITS.unansweredPings);
      await until(() => c.messages.filter(isPing).length === 3 + LIMITS.unansweredPings, 'two pings unanswered');
      await fake.tick(LIMITS.pingMs);
      assert.equal(await closedWithin(c), 1001);
    });
  },
  async savedMs() {
    await onCanvas(minimal(), async (fake, c) => {
      assert.equal(outcome(await sendEdit(c, [setName('p1', 'a')])), 'applied');
      await fake.tick(LIMITS.savedMs - 1);
      await roundTrip(c);
      assert.equal(c.messages.filter((m) => m.t === 'saved').length, 0, 'not yet');
      await fake.tick(1);
      assert.deepEqual(await c.next((m) => m.t === 'saved'), { t: 'saved', rev: 1 });
    });
    // the default clock is real: the window closes on its own
    await onCanvas(minimal(), async (fake, c) => {
      assert.throws(() => fake.tick(1), /manual clock only/);
      const t0 = Date.now();
      assert.equal(outcome(await sendEdit(c, [setName('p1', 'a')])), 'applied');
      assert.deepEqual(await c.next((m) => m.t === 'saved', 5000), { t: 'saved', rev: 1 });
      assert.ok(Date.now() - t0 >= LIMITS.savedMs - 50, 'not before the window');
    }, { clock: 'real' });
  },
  async selectionsMs() {
    await onCanvas(rectsDoc(1), async (fake, c) => {
      await fake.tick(LIMITS.selectionsMs);
      assert.deepEqual(await c.next((m) => m.t === 'selections'), { t: 'selections', people: [{ id: 'owner', name: 'Owner', ids: [] }] }, 'a connection is a change');
      c.send({ t: 'select', ids: ['r0', 'r0'] }); // an id listed twice counts once
      await roundTrip(c);
      await fake.tick(LIMITS.selectionsMs - 1);
      const mark = c.messages.length;
      assert.deepEqual(await since(c, mark), [], 'not yet');
      await fake.tick(1);
      assert.deepEqual(await c.next((m) => m.t === 'selections' && m.people[0].ids.length === 1), { t: 'selections', people: [{ id: 'owner', name: 'Owner', ids: ['r0'] }] });
    });
  },
  async imageBytes() {
    await withFake({ canvases: { [SLUG]: minimal() } }, async (fake) => {
      const img = (n) => { const b = Buffer.alloc(n, 7); pngBytes().copy(b, 0, 0, 8); return b; };
      const atBody = { name: 'big.png', data: img(LIMITS.imageBytes).toString('base64') };
      const overBody = { name: 'big.png', data: img(LIMITS.imageBytes + 1).toString('base64') };
      assert.deepEqual(shapeErrors('image-request', atBody), [], 'a 4 MB image holds to image-request (a linear base64 check)');
      assert.ok(shapeErrors('image-request', overBody).some((x) => /over 4194304 bytes/.test(x)), 'one byte over does not');
      const at = await post(fake, 'image', atBody);
      assert.equal(at.status, 200, 'a 4 MB image');
      assert.equal((await post(fake, 'image', overBody)).status, 413, 'one byte over');
      // over 4 MB and not an image by its first bytes: the size is judged first, 413 not 415 (§8's order)
      const junk = { name: 'big.png', data: Buffer.alloc(LIMITS.imageBytes + 1, 7).toString('base64') };
      assert.equal((await post(fake, 'image', junk)).status, 413, 'over 4 MB with wrong first bytes');
    });
  },
  async imageBodyBytes() {
    await withFake({ canvases: { [SLUG]: minimal() } }, async (fake) => {
      const body = { name: 'p', data: pngBytes().toString('base64') };
      const at = await post(fake, 'image', padJson(body, LIMITS.imageBodyBytes));
      assert.equal(at.status, 200, 'a body of exactly 6 MB, declared and sent');
      const over = await post(fake, 'image', chunked(padJson(body, LIMITS.imageBodyBytes + 1)), { headers: CHUNKED });
      assert.equal(over.status, 413, 'one byte over with no Content-Length: judged from what is read');
      assert.equal((await post(fake, 'image', null, { contentLength: LIMITS.imageBodyBytes + 1 })).status, 413, 'declared, never sent');
    });
  },
  async localBodyBytes() {
    await onCanvas(minimal(), async (fake) => {
      const body = localBody([setName('p1', 'a')]);
      const at = await local(fake, padJson(body, LIMITS.localBodyBytes));
      assert.deepEqual([at.status, at.json], [200, { rev: 1, edits: 1, saved: true }], 'a body of exactly 5 MB, declared and sent');
      const over = await local(fake, chunked(padJson(body, LIMITS.localBodyBytes + 1)), { headers: CHUNKED });
      assert.equal(over.status, 413, 'one byte over with no Content-Length: judged from what is read');
      assert.equal((await local(fake, null, { contentLength: LIMITS.localBodyBytes + 1 })).status, 413, 'declared, never sent');
      assert.equal(fake.rev(SLUG), 1, 'neither refusal changed anything');
    });
  },
  async importBodyBytes() {
    await withFake({ canvases: { [SLUG]: minimal() } }, async (fake) => {
      // 50 MB is never sent: a declaration of exactly the limit gets no answer from its header alone
      const owner = { Origin: originOf(fake), 'Content-Type': 'application/json' };
      assert.ok(await silentAfter(fake, `/api/canvas/import?slug=${SLUG}`, owner, LIMITS.importBodyBytes), 'exactly 50 MB declared: no 413 from the header');
      assert.equal((await post(fake, 'import', null, { contentLength: LIMITS.importBodyBytes + 1 })).status, 413, 'declared, never sent');
      assert.equal((await post(fake, 'import', { key: 'abc' })).status, 501, 'within the limit');
    });
  },
  async byChars() {
    await onCanvas(minimal(), async (fake) => {
      assert.equal((await local(fake, localBody([setName('p1', 'a')], 'b'.repeat(LIMITS.byChars)))).status, 200, '64 characters');
      assert.equal((await local(fake, localBody([setName('p1', 'b')], 'b'.repeat(LIMITS.byChars + 1)))).status, 400, '65');
    });
  },
  async noteAnchorChars() {
    assert.deepEqual(shapeErrors('note-anchor', { node: 'n'.repeat(LIMITS.noteAnchorChars) }), []);
    assert.ok(shapeErrors('note-anchor', { node: 'n'.repeat(LIMITS.noteAnchorChars + 1) }).length, 'not an anchor');
  },
};
// The http-<route key>-<case>.json fixtures, and the route each names (the longest key its name starts with).
const httpFixtures = () => fixtureFiles().filter((f) => (fixtureKind(f) || {}).kind === 'http');
const EXCHANGE_NAMES = ['edit', 'resend', 'refusals', 'whole-edit', 'view', 'select', 'pause', 'reload', 'closed', 'restart', 'hostile', 'pages', 'tokens', 'local'];
const exchangeFixtures = () => fixtureFiles().filter((f) => (fixtureKind(f) || {}).kind === 'exchange');
// One exchange on its own fake, closed after it whatever happens.
async function playOne(x, name, waitMs) {
  const fake = await startCanvasFake(exchangeOptions(x, { fixturesDir: FIX }));
  try { await playExchange(fake, x, { fixturesDir: FIX, name, waitMs }); } finally { await fake.close(); }
}
const routeOf = (f) => ROUTES.filter((r) => f.startsWith(`http-${r.key}-`)).sort((a, b) => b.key.length - a.key.length)[0];

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
      'an id listed twice counts once',
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
      'A person whose last connection closed and who connects again is listed anew: after the people already there, with an empty selection.',
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
      'Without `at`, only a canvas open for editing is served: a slug only on main is 404 there and served with `at=main`.',
      'Statuses in order, past the guards: 413 from `Content-Length`, then 413 from what is read, 423, 404, 400, 413 for an image over 4 MB, 415 by its first bytes, 413 for the folder, then 200.',
      'Each run is as long as fits: an op starts a new message only when adding it would pass 1 MB, so the ops alone fix `edits` and every `rev`.',
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
      "which browsers can't reach: past the host check (403), it refuses any `Origin`",
      '**Statuses in order**: the guards (the host, the forbidden headers, the token: 403; the body: 413), then a slug `land` closed 423 `{ "why": "closed" }`, then any other slug not open for editing 404, then no session 503, then the body (400 for bad JSON or keys), then 409 or 200.',
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
      'No option in shorthand: a bare `skip`, `todo` or `only` between a `{` or `,` and a `,` or `}` (`{ skip }`, `{ a, only }`, `{ ...o, todo }`), which Node\'s runner reads as `skip: skip`.',
      'The shorthand rule has known false positives too: the bare word as a list item or an argument (`[a, skip, b]`, `f(a, only, b)`) or destructured (`const { skip } = o`); in a canvas test file, use another name.',
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
      "An `open`'s `person` and `level` are the `x-devteam-person` and `x-devteam-level` headers, null for none (both null is the owner).",
      'A `local` step posts its body with the fake\'s token and `Content-Type: application/json`; a step with no `body` checks the status alone, saying nothing of the answer\'s body.',
      "A `do`'s `arg` is the `why` for `pause` (`branch-moved` when absent) and a document fixture's name for `replace`; the other controls take none.",
      'A connection name is opened once; one refused (a `status` other than 101) receives nothing.',
      "a `welcome` on a canvas with no open connection, and every `reload`, carries an id not seen before in the exchange (so never the session it replaces), and a step's reloads all carry the same one",
      'Every received message is first held to its kind\'s shape (`shapeErrors`), and each connection\'s `conn` is its own',
      'After the last step every open connection gets a round trip and a 50 ms settle, and must then have received nothing more.',
      "or, for a `select`, which §5 ignores whole, the step expects nothing for anyone)",
      'The ticks of an exchange add up to less than 20000 ms, so no ping falls due and no exchange expects one',
      'the exchanges together cover every other message kind, every op (pages included), every refusal code, every `via` and every `paused` and `closed` why',
      "No two windows (`saved`, `selections`) end at the same instant, since their order then is the server's to choose.",
      '`exchangeOptions(exchange, { fixturesDir })` gives the fake\'s options for an exchange',
      '`exchangeProblems(exchange, { fixturesDir })` lists every way it breaks these rules; `playExchange` refuses an exchange with any',
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

  await t.test('rules: applyEdit takes maxOpsBytes (null for the local route)', () => {
    const d = docWith({ t: { type: 'text' } });
    const ops = range(8).map(() => ({ op: 'set', id: 't', prop: 'text', value: 'x'.repeat(9000) }));
    assert.equal(applyEdit(d, ops).why, 'limit', 'a page edit over 64 KB');
    assert.equal(applyEdit(d, ops, { maxOpsBytes: null }).why, null, 'unbounded for a local apply');
    assert.equal(applyEdit(d, [setName('p1', 'abc')], { maxOpsBytes: 10 }).why, 'limit', 'a bound of its own');
  });

  await t.test('fake: guards in order', async () => {
    await withFake({ canvases: { [SLUG]: minimal(), gone: minimal() } }, async (fake) => {
      const { url, port } = fake;
      const ok = await openOn(fake);
      assert.equal(ok.status, 101);
      assert.equal(ok.headers['sec-websocket-accept'], crypto.createHash('sha1').update(ok.key + GUID).digest('base64'));
      assert.deepEqual(ok.messages[0], { t: 'welcome', canvas: 1, session: fake.session(SLUG), rev: 0, you: { id: 'owner', conn: ok.you.conn } }, 'welcome first');
      assert.deepEqual(shapeErrors('welcome', ok.messages[0]), []);
      assert.equal((await openOn(fake, { host: `localhost:${port}` })).status, 101, 'localhost:<port> is a Host');
      fake.land('gone');
      const person = (v) => ({ headers: { 'x-devteam-person': v } });
      const refusals = [
        [403, 'a foreign Host', { host: `evil.example:${port}` }],
        [403, 'x-devteam-relay', { headers: { 'x-devteam-relay': '1' } }],
        [404, 'another path', {}, '/elsewhere'],
        [400, 'no key', { headers: { 'Sec-WebSocket-Key': null } }],
        [400, 'version 12', { headers: { 'Sec-WebSocket-Version': '12' } }],
        [400, 'a key of 15 bytes', { headers: { 'Sec-WebSocket-Key': Buffer.alloc(15, 1).toString('base64') } }],
        [400, 'no Upgrade: websocket', { headers: { Upgrade: 'h2c' } }],
        [403, 'no Origin', { origin: null }],
        [403, 'Origin: null', { origin: 'null' }],
        [403, 'a foreign Origin', { origin: 'http://evil.example' }],
        [403, 'an empty name', person('p-a;name=')],
        [403, 'no ;name=', person('p-a')],
        [403, 'x-devteam-person twice', { headers: { 'x-devteam-person': ['p-a;name=Ann', 'p-b;name=Bo'] } }],
        [403, 'x-devteam-level: View', { headers: { ...P('p-a'), 'x-devteam-level': 'View' } }],
        [403, 'a level with no person', { headers: { 'x-devteam-level': 'view' } }],
        [404, 'no slug', { slug: undefined }],
        [404, 'a malformed slug', { slug: 'Bad_Slug' }],
        [404, 'a slug not open for editing', { slug: 'nope' }],
        [404, 'a landed slug', { slug: 'gone' }],
        // the order: the first guard that applies answers
        [403, 'a foreign Host on another path', { host: `evil.example:${port}` }, '/elsewhere'],
        [403, 'the relay mark on another path', { headers: { 'x-devteam-relay': '1' } }, '/elsewhere'],
        [404, 'another path with no key', { headers: { 'Sec-WebSocket-Key': null } }, '/elsewhere'],
        [400, 'no key and no Origin', { headers: { 'Sec-WebSocket-Key': null }, origin: null }],
        [400, 'no key and an unknown slug', { headers: { 'Sec-WebSocket-Key': null }, slug: 'nope' }],
        [403, 'no Origin and an unknown slug', { origin: null, slug: 'nope' }],
        [403, 'a bad person and an unknown slug', { ...person('p-a'), slug: 'nope' }],
      ];
      for (const [status, label, opts, where = ''] of refusals) {
        const c = await openCanvas(`${url}${where}`, { slug: SLUG, ...opts });
        assert.equal(c.status, status, label);
        assert.equal(c.you, undefined, `${label}: no welcome`);
        assert.deepEqual(c.messages, [], `${label}: no message`);
      }
      assert.equal(fake.stats().length, 2, 'only the two accepted connections are open');
      assert.equal((await request(`${url}/canvas?slug=${SLUG}`)).status, 400, 'a plain GET of /canvas is not an upgrade');
      const view = await openOn(fake, { headers: PV('p-v') });
      assert.equal(view.you.id, 'p-v', 'a View person holds a socket');
    });
  });

  await t.test('fake: frames and close codes', async () => {
    await withFake({ canvases: { [SLUG]: minimal() } }, async (fake) => {
      const editBuf = (name) => Buffer.from(JSON.stringify({ t: 'edit', client: CLIENT, seq: ++seqN, ops: [setName('p1', name)] }));
      const applied = (c, name) => c.next((m) => m.t === 'ops' && m.ops[0] && m.ops[0].value === name);
      for (const len of [7, 16, 64]) {
        const c = await openOn(fake);
        const b = editBuf(`len${len}`);
        c.frame(b, { len });
        await applied(c, `len${len}`);
      }
      const cf = await openOn(fake);
      const [f1, f2, f3] = pieces(editBuf('fragments'), 3);
      cf.frame(f1, { fin: false });
      cf.frame(Buffer.from('hi'), { opcode: 9 });
      cf.frame(f2, { opcode: 0, fin: false });
      cf.frame(f3, { opcode: 0 });
      await applied(cf, 'fragments');
      await until(() => cf.controls.some((x) => x.opcode === 10 && x.payload.toString() === 'hi'), 'a pong of the same payload, between fragments');
      // a message split across TCP writes, a byte at a time, is joined
      const cb = await openOn(fake);
      for (const byte of cb.build(editBuf('bytewise'))) { cb.raw(Buffer.from([byte])); await new Promise((r) => setImmediate(r)); }
      await applied(cb, 'bytewise');

      const closer = await openOn(fake);
      closer.frame(Buffer.from([0x03, 0xe8]), { opcode: 8 });
      assert.equal(await closedWithin(closer), 1000, 'a close is answered with a close');

      const ignored = await openOn(fake);
      ignored.send({ t: 'nope', x: 1 });
      ignored.send({ t: 'edit', client: CLIENT, seq: ++seqN, ops: 'not an array' });
      assert.equal((await ignored.next((m) => m.t === 'refused')).why, 'shape', 'ops not an array is refused shape');
      await roundTrip(ignored);
      assert.ok(stat(fake, ignored), 'an unknown t is ignored');

      const body = editBuf('x');
      const closes = [
        [1002, 'an unmasked frame', (c) => c.frame(body, { mask: false })],
        [1002, 'a reserved bit', (c) => c.frame(body, { rsv: 4 })],
        [1002, 'opcode 3', (c) => c.frame(body, { opcode: 3 })],
        [1002, 'a fragmented ping', (c) => c.frame(Buffer.from('hi'), { opcode: 9, fin: false })],
        [1002, 'a 126-byte ping', (c) => c.frame(Buffer.alloc(126, 97), { opcode: 9 })],
        [1002, 'a stray continuation', (c) => c.frame(body, { opcode: 0 })],
        [1002, 'a text frame while a message is open', (c) => { c.frame(f1, { fin: false }); c.frame(f2); }],
        [1002, 'a 64-bit length with its top bit set, from the header alone', (c) => c.raw(Buffer.from([0x81, 0xff, 0x80, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]))],
        [1008, 'binary', (c) => c.frame(body, { opcode: 2 })],
        [1008, 'not JSON', (c) => c.frame(Buffer.from('{nope'))],
        [1008, 'not UTF-8', (c) => c.frame(Buffer.from([0x7b, 0xff, 0x7d]))],
        [1008, 'an array', (c) => c.send([])],
        [1008, 'null', (c) => c.send(null)],
        [1008, 'a number', (c) => c.send(5)],
        [1008, 'a client of 15', (c) => c.send({ t: 'edit', client: 'abc', seq: 1, ops: [] })],
        [1008, 'an upper-case client', (c) => c.send({ t: 'edit', client: CLIENT.toUpperCase(), seq: 1, ops: [] })],
        [1008, 'no client', (c) => c.send({ t: 'edit', seq: 1, ops: [] })],
        [1008, 'seq 0', (c) => c.send({ t: 'edit', client: CLIENT, seq: 0, ops: [] })],
        [1008, 'seq 1.5', (c) => c.send({ t: 'edit', client: CLIENT, seq: 1.5, ops: [] })],
        [1008, "seq '1'", (c) => c.send({ t: 'edit', client: CLIENT, seq: '1', ops: [] })],
        [1008, 'seq past a safe integer', (c) => c.send({ t: 'edit', client: CLIENT, seq: 2 ** 53, ops: [] })],
      ];
      for (const [code, label, act] of closes) {
        const c = await openOn(fake);
        act(c);
        assert.equal(await closedWithin(c), code, label);
      }
      assert.equal(fake.doc(SLUG).pages[0].name, 'bytewise', 'nothing a closed connection sent was applied');
    });
  });

  await t.test('fake: doc route', async () => {
    const every = readFix('doc-every-type.json');
    const images = { [SLUG]: { [PNG_NAME]: pngBytes() } };
    for (const repo of [{ name: 'a/b', public: true }, { name: 'a/b', public: false }, undefined]) {
      const opts = { canvases: { [SLUG]: every, both: minimal() }, main: { [SLUG]: minimal(), old: readFix('hostile.json'), both: rectsDoc(1) }, images: { ...images, old: { [PNG_NAME]: pngBytes() } } };
      if (repo) opts.repo = repo;
      await withFake(opts, async (fake) => {
        const want = repo || { name: null, public: null };
        const docAt = (q) => request(`${fake.url}/api/canvas/doc?${q}`);
        const r = await docAt(`slug=${SLUG}`);
        assert.equal(r.status, 200);
        assert.equal(r.headers['content-type'], 'application/json');
        assert.deepEqual(shapeErrors('doc-response', r.json), []);
        assert.deepEqual(r.json, { session: fake.session(SLUG), rev: every.rev, doc: every, repo: want }, 'repo passed through');
        const c = await openOn(fake);
        assert.equal(c.messages[0].session, r.json.session, "session is the next welcome's");
        assert.equal((await docAt(`slug=${SLUG}`)).json.session, c.messages[0].session, 'and the open one while open');
        const both = await docAt('slug=both&at=main');
        assert.deepEqual(both.json, { session: null, rev: 0, doc: rectsDoc(1), repo: want }, "at=main: main's document for one also open");
        const old = await docAt('slug=old&at=main');
        assert.deepEqual([old.status, old.json.session, old.json.doc], [200, null, readFix('hostile.json')], 'at=main for a canvas only on main');
        assert.equal((await docAt('slug=old')).status, 404, 'a canvas only on main is not open for editing');
        assert.equal(outcome(await sendEdit(c, [setName('p-main', 'landed')])), 'applied');
        fake.land(SLUG);
        assert.equal(await closedWithin(c), 1000);
        const landed = await docAt(`slug=${SLUG}&at=main`);
        assert.equal(landed.json.doc.pages[0].name, 'landed', 'a landed canvas is on main');
        assert.equal(landed.json.session, null);
        assert.deepEqual(shapeErrors('doc-response', landed.json), []);
        assert.equal((await docAt(`slug=${SLUG}`)).status, 404, 'landed: no longer open');
        for (const [status, label, q, headers] of [
          [403, 'a bad host', 'slug=both', { Host: `evil.example:${fake.port}` }],
          [403, 'the relay mark', 'slug=both', { 'x-devteam-relay': '1' }],
          [403, 'the relay mark before an unknown slug', 'slug=nope', { 'x-devteam-relay': '1' }],
          [404, 'an unknown slug', 'slug=nope'],
          [404, 'an unknown slug on main', 'slug=nope&at=main'],
          [404, 'no slug', ''],
          [404, 'another at', 'slug=both&at=elsewhere'],
        ]) assert.equal((await request(`${fake.url}/api/canvas/doc?${q}`, { headers })).status, status, label);
        assert.equal((await request(`${fake.url}/api/canvas/doc?slug=both`, { headers: PV('p-v') })).status, 200, 'a View person gets the GETs');
      });
    }
  });

  await t.test('fake: image routes', async () => {
    const png = pngBytes();
    await withFake({ canvases: { [SLUG]: minimal(), shut: minimal() }, main: { old: minimal() }, images: { old: { [PNG_NAME]: png } } }, async (fake) => {
      const srcs = {};
      for (const ext of Object.keys(IMAGE_BYTES)) {
        const b = IMAGE_BYTES[ext]();
        const body = { name: `pic.${ext}`, data: b.toString('base64') };
        assert.deepEqual(shapeErrors('image-request', body), []);
        const r = await post(fake, 'image', body);
        assert.equal(r.status, 200, ext);
        assert.deepEqual(shapeErrors('image-response', r.json), []);
        assert.deepEqual(r.json, { src: `images/${hashName(b, ext)}` }, `${ext}: saved under its hash`);
        assert.deepEqual((await post(fake, 'image', { name: 'again', data: body.data })).json, r.json, `${ext}: the same bytes, the same src`);
        const g = await request(`${fake.url}/api/canvas/image/${SLUG}/${hashName(b, ext)}`);
        assert.equal(g.status, 200, `${ext}: served`);
        assert.equal(g.headers['content-type'], MIME[ext]);
        assert.equal(g.headers['x-content-type-options'], 'nosniff');
        assert.ok(g.body.equals(b), `${ext}: the bytes`);
        srcs[ext] = r.json.src;
      }
      const c = await openOn(fake);
      const add = (id, src) => [{ op: 'add', node: { id, type: 'image', parent: 'p1', src }, after: null }];
      assert.equal(outcome(await sendEdit(c, add('pic', srcs.webp))), 'applied', 'an add of an image node naming it');
      assert.equal(outcome(await sendEdit(c, add('nopic', 'images/ffffffffffffffff.png'))), 'ref', 'one naming no file');
      assert.equal((await request(`${fake.url}/api/canvas/image/old/${PNG_NAME}`)).status, 200, "served from main's folder");

      fake.land('shut');
      const pngBody = { name: 'p', data: png.toString('base64') };
      const refusals = [
        [415, 'a non-image', { body: { name: 'x', data: Buffer.from('hello world').toString('base64') } }],
        [415, 'an SVG', { body: { name: 'x.svg', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64') } }],
        [415, 'a text/plain body', { headers: { 'Content-Type': 'text/plain' } }],
        [415, 'no Content-Type', { headers: { 'Content-Type': null } }],
        [400, 'bad JSON', { body: '{"name":' }],
        [400, 'an extra key', { body: { ...pngBody, x: 1 } }],
        [400, 'no name', { body: { data: pngBody.data } }],
        [400, 'an empty name', { body: { ...pngBody, name: '' } }],
        [400, 'a name of 201 characters', { body: { ...pngBody, name: 'n'.repeat(201) } }],
        [400, 'bad base64', { body: { name: 'p', data: '***' } }],
        [400, 'no data', { body: { name: 'p', data: '' } }],
        [403, 'a View person', { headers: PV('p-v') }],
        [403, 'a cross origin', { headers: { Origin: 'http://evil.example' } }],
        [403, 'no Origin', { headers: { Origin: null } }],
        [403, 'the relay mark', { headers: { 'x-devteam-relay': '1' } }],
        [403, 'a bad person header', { headers: { 'x-devteam-person': 'p-a;name=' } }],
        [403, 'a bad host', { headers: { Host: `evil.example:${fake.port}` } }],
        [413, 'a body over 6 MB by Content-Length', { body: null, contentLength: LIMITS.imageBodyBytes + 1 }],
        [404, 'an unknown slug', { slug: 'nope' }],
        [404, 'a slug only on main', { slug: 'old' }],
        [423, 'a landed canvas', { slug: 'shut' }],
        // the order
        [403, 'a View person on a landed canvas', { headers: PV('p-v'), slug: 'shut' }],
        [415, 'text/plain on an unknown slug', { headers: { 'Content-Type': 'text/plain' }, slug: 'nope' }],
        [413, 'over 6 MB on a landed canvas', { body: null, contentLength: LIMITS.imageBodyBytes + 1, slug: 'shut' }],
        [423, 'bad JSON on a landed canvas', { body: '{', slug: 'shut' }],
        [404, 'bad JSON on an unknown slug', { body: '{', slug: 'nope' }],
      ];
      for (const [status, label, o] of refusals) {
        const r = await post(fake, 'image', o.body === undefined ? pngBody : o.body, o);
        assert.equal(r.status, status, label);
        assert.equal(r.body.length, 0, `${label}: a refusal carries no body (§14)`);
      }
      const hex = PNG_NAME.slice(0, 16);
      const gets = [
        [404, '../canvas-token', `${SLUG}/../canvas-token`],
        [404, '%2e%2e%2f', `${SLUG}/%2e%2e%2fcanvas-token`],
        [404, '%2e%2e%2f in the slug', `%2e%2e%2f${SLUG}/${PNG_NAME}`],
        [404, 'upper-case hex', `${SLUG}/${hex.toUpperCase()}.png`],
        [404, 'another extension', `${SLUG}/${hex}.svg`],
        [404, 'a short name', `${SLUG}/${hex.slice(1)}.png`],
        [404, 'an extra segment', `${SLUG}/x/${PNG_NAME}`],
        [404, 'an unknown slug', `nope/${PNG_NAME}`],
        [404, 'a malformed slug', `Bad_Slug/${PNG_NAME}`],
        [404, 'a file not there', `${SLUG}/ffffffffffffffff.png`],
      ];
      for (const [status, label, rest] of gets) {
        const r = await request(`${fake.url}/api/canvas/image/${rest}`);
        assert.equal(r.status, status, label);
        assert.equal(r.body.length, 0, `${label}: a refusal carries no body (§14)`);
      }
      assert.equal((await request(`${fake.url}/api/canvas/image/old/${PNG_NAME}`, { headers: { Host: `evil.example:${fake.port}` } })).status, 403, 'a bad host');
      assert.equal((await request(`${fake.url}/api/canvas/image/old/${PNG_NAME}`, { headers: { 'x-devteam-relay': '1' } })).status, 403, 'the relay mark');
      assert.equal((await request(`${fake.url}/api/canvas/image/nope/x`, { headers: { 'x-devteam-relay': '1' } })).status, 403, 'the relay mark before the file rule');
    });
    // a folder past 25 MB: the image route's 413
    const jpg = IMAGE_BYTES.jpg();
    await withFake({ canvases: { [SLUG]: minimal() }, folderBytes: { [SLUG]: LIMITS.folderBytes - W(minimal()) - png.length } }, async (fake) => {
      assert.equal((await post(fake, 'image', { name: 'p', data: png.toString('base64') })).status, 200, 'the folder at 25 MB');
      assert.equal((await post(fake, 'image', { name: 'p', data: png.toString('base64') })).status, 200, 'the same bytes again add nothing');
      assert.equal((await post(fake, 'image', { name: 'j', data: jpg.toString('base64') })).status, 413, 'past it');
    });
  });

  await t.test('fake: local route', async () => {
    await withFake({ canvases: { [SLUG]: minimal(), shut: minimal() }, token: 'the-token' }, async (fake) => {
      assert.equal(fake.token, 'the-token');
      const body = localBody([setName('p1', 'Local')]);
      assert.deepEqual(shapeErrors('local-request', body), []);
      for (const [label, headers] of [
        ['an Origin', { Origin: originOf(fake) }],
        ['Sec-Fetch-Site', { 'Sec-Fetch-Site': 'same-origin' }],
        ['x-devteam-relay', { 'x-devteam-relay': '1' }],
        ['x-devteam-person', P('p-a')],
        ['x-devteam-level', { 'x-devteam-level': 'full' }],
        ['no token', { 'x-devteam-canvas-token': null }],
        ['a wrong token', { 'x-devteam-canvas-token': 'not-the-token' }],
        ['the token twice', { 'x-devteam-canvas-token': ['the-token', 'the-token'] }],
        ['a bad host', { Host: `evil.example:${fake.port}` }],
      ]) {
        const r = await local(fake, body, { headers });
        assert.equal(r.status, 403, label);
        assert.equal(r.body.length, 0, `${label}: a 403 carries no body (§14)`);
      }
      const none = await local(fake, body);
      assert.equal(none.status, 503, 'no page connected');
      assert.deepEqual(none.json, { why: 'no-session' });
      assert.deepEqual(shapeErrors('error-response', none.json), []);
      assert.deepEqual([fake.rev(SLUG), fake.doc(SLUG)], [0, minimal()], 'nothing changed');
      const unknown = await local(fake, body, { slug: 'nope' });
      assert.equal(unknown.status, 404, 'an unknown slug');
      assert.equal(unknown.body.length, 0, 'a 404 carries no body (§14)');

      const c = await openOn(fake);
      for (const [label, b] of [
        ['bad JSON', '{"by":'],
        ['not an object', []],
        ['an extra key', { ...body, x: 1 }],
        ['no ops', { by: 'supervisor', via: 'apply' }],
        ['ops not an array', { ...body, ops: {} }],
        ['a via of page', { ...body, via: 'page' }],
        ['a by with a space', { ...body, by: 'a b' }],
        ['an empty by', { ...body, by: '' }],
      ]) {
        const r = await local(fake, b);
        assert.equal(r.status, 400, label);
        assert.equal(r.body.length, 0, `${label}: a 400 carries no body (§14)`);
      }
      assert.equal(fake.rev(SLUG), 0);

      let mark = c.messages.length;
      const r = await local(fake, body);
      assert.equal(r.status, 200);
      assert.deepEqual(r.json, { rev: 1, edits: 1, saved: true });
      assert.deepEqual(shapeErrors('local-response', r.json), []);
      const seen = await since(c, mark);
      assert.deepEqual(seen, [
        { t: 'ops', rev: 1, by: { id: 'supervisor', name: 'supervisor', via: 'apply' }, ack: null, ops: body.ops },
        { t: 'saved', rev: 1 },
      ], 'the ops, then saved, both before the answer');
      for (const m of seen) assert.deepEqual(shapeErrors(m.t, m), []);

      mark = c.messages.length;
      const take = localBody([{ op: 'move', id: 'p1', parent: null, after: null }], 'kit-651', 'take');
      assert.deepEqual((await local(fake, take)).json, { rev: 2, edits: 1, saved: true }, 'via take');
      assert.deepEqual((await since(c, mark))[0].by, { id: 'kit-651', name: 'kit-651', via: 'take' });

      fake.pause(SLUG, 'index-dirty');
      mark = c.messages.length;
      assert.deepEqual((await local(fake, localBody([setName('p1', 'Paused')]))).json, { rev: 3, edits: 1, saved: false }, 'paused: answered at once');
      assert.deepEqual((await since(c, mark)).map((m) => m.t), ['paused', 'ops'], 'no saved while paused');
      mark = c.messages.length;
      fake.resume(SLUG);
      assert.deepEqual(await since(c, mark), [{ t: 'resumed' }, { t: 'saved', rev: 3 }], 'saved at once when the pause ends');

      // a refused apply changes nothing and sends nothing
      const before = fake.doc(SLUG);
      mark = c.messages.length;
      const refused = await local(fake, localBody([{ op: 'add', node: { id: 'i', type: 'instance', parent: 'p1', component: 'nope' }, after: null }]));
      assert.equal(refused.status, 409);
      assert.deepEqual(refused.json, { why: 'ref' }, 'an end state that breaks a rule');
      assert.deepEqual(await since(c, mark), [], 'no ops sent');
      assert.deepEqual(fake.doc(SLUG), before, 'the document and rev unchanged');
      assert.deepEqual((await local(fake, localBody([]))).json, { why: 'shape' }, 'no ops is shape');

      // a restart after saved: true keeps the apply; a page edit not yet saved is lost
      assert.equal(outcome(await sendEdit(c, [setName('p1', 'unsaved')])), 'applied');
      const session = fake.session(SLUG);
      fake.restart(SLUG);
      assert.equal(await closedWithin(c), 1012);
      assert.deepEqual(fake.doc(SLUG), before, 'reverted to the last saved document, the local apply kept');
      assert.notEqual(fake.session(SLUG), session, 'a new session id');
      const c2 = await openOn(fake);
      assert.deepEqual([c2.messages[0].session, c2.messages[0].rev], [fake.session(SLUG), 3]);

      // 423 after land, before the 404; statuses in order
      fake.land('shut');
      const shut = await local(fake, body, { slug: 'shut' });
      assert.deepEqual([shut.status, shut.json], [423, { why: 'closed' }], 'a landed canvas');
      for (const [status, label, b, o] of [
        [403, 'no token, over 5 MB', null, { headers: { 'x-devteam-canvas-token': null }, contentLength: LIMITS.localBodyBytes + 1 }],
        [413, 'over 5 MB on a landed canvas', null, { slug: 'shut', contentLength: LIMITS.localBodyBytes + 1 }],
        [423, 'bad JSON on a landed canvas', '{', { slug: 'shut' }],
        [404, 'bad JSON on an unknown slug', '{', { slug: 'nope' }],
        [400, 'bad JSON with a session', '{', {}],
      ]) assert.equal((await local(fake, b, o)).status, status, label);
      c2.destroy();
      await until(() => fake.stats().length === 0, 'the session ends');
      assert.equal((await local(fake, '{')).status, 503, 'no session before the body');
    });
  });

  await t.test('fake: import limit', async () => {
    await withFake({ canvases: { [SLUG]: minimal() } }, async (fake) => {
      assert.equal((await post(fake, 'import', { key: 'abc' })).status, 501, 'within the limit: a later ticket');
      assert.equal((await post(fake, 'import', null, { contentLength: LIMITS.importBodyBytes + 1 })).status, 413, 'over 50 MB by Content-Length');
      for (const [status, label, headers] of [
        [403, 'a View person', PV('p-v')],
        [403, 'no Origin', { Origin: null }],
        [403, 'the relay mark', { 'x-devteam-relay': '1' }],
        [415, 'text/plain', { 'Content-Type': 'text/plain' }],
      ]) assert.equal((await post(fake, 'import', { key: 'abc' }, { headers })).status, status, label);
    });
  });

  await t.test('fake: every limit', async () => {
    sameSet(Object.keys(LIMIT_CHECKS), Object.keys(LIMITS), 'a check for every limit');
    for (const [name, check] of Object.entries(LIMIT_CHECKS)) {
      try {
        await check();
      } catch (e) {
        e.message = `${name}: ${e.message}`;
        throw e;
      }
    }
  });

  await t.test('fixtures: http files', async () => {
    const files = httpFixtures();
    assert.ok(files.length > 0);
    for (const f of files) await playHttp(f, { fixturesDir: FIX });
    // the runner fails a fixture whose status, body or kinds differ
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-http-'));
    try {
      const base = readFix('http-doc-public.json');
      const broken = [
        ['status', { ...base, status: 201 }],
        ['response', { ...base, response: { ...base.response, rev: 9 } }],
        ['responseKind', { ...base, responseKind: 'image-response' }],
        ['requestKind', { ...base, requestKind: 'local-request' }],
        ['an extra key', { ...base, extra: 1 }],
      ];
      for (const [label, fx] of broken) {
        const file = path.join(tmp, 'http-doc-broken.json');
        fs.writeFileSync(file, JSON.stringify(fx));
        await assert.rejects(playHttp(file, { fixturesDir: FIX }), `a broken ${label} fails`);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('coverage: routes', () => {
    const files = httpFixtures();
    for (const f of files) assert.ok(routeOf(f), `${f} names a route`);
    for (const r of ROUTES) {
      const mine = files.filter((f) => routeOf(f) === r);
      assert.ok(mine.length > 0, `an http- fixture for ${r.key}`);
      for (const f of mine) {
        const fx = readFix(f);
        assert.equal(fx.request.method, r.method, `${f}: ${r.key}'s method`);
        assert.ok(fx.request.path.startsWith(r.path.split('<')[0]), `${f}: ${r.key}'s path`);
        if (!r.fake) assert.deepEqual([fx.status, fx.responseKind], [404, null], `${f}: the fake doesn't serve ${r.key}`);
      }
      if (r.fake) assert.ok(mine.some((f) => readFix(f).status !== 404), `a fixture of ${r.key} the fake answers past a 404`);
    }
    const repos = files.filter((f) => routeOf(f).key === 'doc').map(readFix).filter((fx) => fx.status === 200).map((fx) => fx.response.repo.public);
    for (const v of [true, false, null]) assert.ok(repos.includes(v), `a doc fixture with repo.public ${v}`);
  });

  await t.test('fixtures: exchange files hold to the rules', () => {
    const files = exchangeFixtures();
    sameSet(files, EXCHANGE_NAMES.map((n) => `exchange-${n}.json`), 'the exchanges');
    for (const f of files) assert.deepEqual(exchangeProblems(readFix(f), { fixturesDir: FIX }), [], `${f} holds to the rules`);
    // the rules catch each break: a broken copy of exchange-edit.json, and the needle its problem names
    const base = readFix('exchange-edit.json');
    const stepOf = (x, pred) => x.steps.find(pred);
    const editStep = (x) => stepOf(x, (s) => s.send && s.send.t === 'edit');
    const broken = [
      ['an expected message off its shape', (x) => { stepOf(x, (s) => s.expect && s.expect.a && s.expect.a.some((m) => m.t === 'saved')).expect.a.find((m) => m.t === 'saved').rev = -1; }, 'saved.rev'],
      ['an expected kind no server sends', (x) => { x.steps[0].expect.a.push({ t: 'hello' }); }, 'unknown kind'],
      ['an expected ping', (x) => { x.steps[0].expect.a.push({ t: 'ping' }); }, 'ping'],
      ['a sent edit off its shape, neither refused shape nor closed 1008', (x) => { editStep(x).send.client = 'BAD'; }, 'edit.client'],
      ['a sent select off its shape in a step that expects a message', (x) => { x.steps.splice(3, 0, { as: 'a', send: { t: 'select', ids: ['no good'] }, expect: { a: [{ t: 'saved', rev: 0 }] } }); }, 'select.ids'],
      ['a sent edit off its shape in a step that expects nothing', (x) => { x.steps.splice(3, 0, { as: 'a', send: { t: 'edit', client: 'BAD', seq: 1, ops: [] } }); }, 'edit.client'],
      ['an invalid doc', (x) => { stepOf(x, (s) => s.doc).doc.rev = -1; }, 'doc'],
      ['an invalid canvas', (x) => { x.canvas = 'msg-ping.json'; }, 'canvas'],
      ['an expect naming no connection', (x) => { x.steps[0].expect.zz = []; }, 'zz'],
      ['a $close not last', (x) => { x.steps[0].expect.a.unshift({ $close: 1000 }); }, '$close'],
      ['a step of no known action', (x) => { x.steps.push({ wait: 1 }); }, 'action'],
      ['an extra key on a step', (x) => { x.steps[0].extra = 1; }, 'extra'],
      ['a connection named twice', (x) => { x.steps.splice(1, 0, clone(x.steps[0])); }, 'twice'],
      ['a send as no connection', (x) => { editStep(x).as = 'zz'; }, 'zz'],
      ['ticks that let a ping fall due', (x) => { x.steps.push({ tick: LIMITS.pingMs }); }, 'ping'],
      ['a local body off its shape with status 200', (x) => { x.steps.push({ local: { by: 'bad by', via: 'apply', ops: [] }, status: 200, body: { rev: 1, edits: 1, saved: true } }); }, 'local-request.by'],
      ['a local response off its shape', (x) => { x.steps.push({ local: { by: 'supervisor', via: 'apply', ops: [] }, status: 409, body: { why: 'nope' } }); }, 'error-response.why'],
      ['a do of no known control', (x) => { x.steps.push({ do: 'explode' }); }, 'explode'],
      ['a pause of an unknown why', (x) => { x.steps.push({ do: 'pause', arg: 'tired' }); }, 'tired'],
      ['an unknown placeholder conn', (x) => { x.steps[0].expect.a[0].you.conn = '$conn:zz'; }, '$conn:zz'],
    ];
    for (const [label, mutate, needle] of broken) {
      const x = clone(base);
      mutate(x);
      const p = exchangeProblems(x, { fixturesDir: FIX });
      assert.ok(p.some((s) => s.includes(needle)), `${label}: a problem naming ${JSON.stringify(needle)} in ${JSON.stringify(p)}`);
    }
    // and allow what §14 allows: a sent message off its shape the same step refuses shape, or closes 1008,
    // or a select (ignored whole, §5) in a step that expects nothing for anyone
    const allowed = clone(base);
    allowed.steps.push(
      { as: 'a', send: { t: 'edit', client: 'abcdefghij012345', seq: 9, ops: 'nope' }, expect: { a: [{ t: 'refused', client: 'abcdefghij012345', seq: 9, why: 'shape' }] } },
      { as: 'a', send: { t: 'edit', client: 'BAD', seq: 1, ops: [] }, expect: { a: [{ $close: 1008 }] } },
      { as: 'b', send: { t: 'select', ids: ['no good'] } },
      { as: 'b', send: { t: 'select', ids: ['x'] }, expect: { a: [], b: [] } },
    );
    assert.deepEqual(exchangeProblems(allowed, { fixturesDir: FIX }), [], 'refused shape, closed 1008 and an ignored select excuse a broken send');
  });

  await t.test('exchanges: the fake answers each', async () => {
    for (const f of exchangeFixtures()) await playOne(readFix(f), f);
    // the runner fails an exchange the fake doesn't answer, naming the step and the connection
    const base = readFix('exchange-edit.json');
    const savedStep = base.steps.findIndex((s) => s.expect && s.expect.b && s.expect.b.some((m) => m.t === 'saved'));
    const opsStep = base.steps.findIndex((s) => s.send && s.send.t === 'edit');
    const broken = [
      ['a field differs', (x) => { x.steps[savedStep].expect.b.find((m) => m.t === 'saved').rev += 1; }, `step ${savedStep + 1}`, 'connection b'],
      ['a message missing', (x) => { x.steps[opsStep].expect.b = []; }, `step ${opsStep + 1}`, 'connection b'],
      ['a message too many', (x) => { x.steps[opsStep].expect.b.push(x.steps[opsStep].expect.b[0]); }, `step ${opsStep + 1}`, 'connection b'],
      ['a document differs', (x) => { x.steps.find((s) => s.doc).doc.pages[0].name = 'Other'; }, 'step ', 'doc'],
      ['a close expected that never comes', (x) => { x.steps[opsStep].expect.a.push({ $close: 1000 }); }, `step ${opsStep + 1}`, 'connection a'],
      ['a session placeholder for a wrong id', (x) => { x.steps[0].expect.a[0].session = 'zzzzzzzzzzzzzzzz'; }, 'step 1', 'connection a'],
    ];
    for (const [label, mutate, ...needles] of broken) {
      const x = clone(base);
      mutate(x);
      await assert.rejects(playOne(x, 'exchange-edit.json', 300), (e) => {
        for (const n of needles) assert.ok(String(e.message).includes(n), `${label}: the failure names ${JSON.stringify(n)}: ${e.message}`);
        return true;
      }, label);
    }
  });

  await t.test('coverage: every op, message kind and refusal code', () => {
    const ops = new Set();
    const kinds = new Set();
    const whys = new Set();
    const vias = new Set();
    const closes = new Set();
    const pauses = new Set();
    for (const f of exchangeFixtures()) {
      const x = readFix(f);
      const pages = new Set(readFix(x.canvas).pages.map((pg) => pg.id));
      const opKind = (op) => {
        if (op.op === 'add' && op.node.type === 'page') { pages.add(op.node.id); return 'add page'; }
        return op.op !== 'token' && op.op !== 'add' && pages.has(op.id) ? `${op.op} page` : op.op;
      };
      for (const s of x.steps) {
        if (s.send) kinds.add(s.send.t);
        if (s.local && s.body && REFUSALS.includes(s.body.why)) whys.add(s.body.why);
        for (const list of Object.values(s.expect || {})) {
          for (const m of list) {
            if (!m.t) continue;
            kinds.add(m.t);
            if (m.t === 'ops') { vias.add(m.by.via); for (const op of m.ops) ops.add(opKind(op)); }
            if (m.t === 'refused') whys.add(m.why);
            if (m.t === 'closed') closes.add(m.why);
            if (m.t === 'paused') pauses.add(m.why);
          }
        }
      }
    }
    for (const op of [...OPS, 'add page', 'del page', 'set page', 'move page']) assert.ok(ops.has(op), `an exchange applies ${op}`);
    // pings never fall due inside an exchange (§14); every other kind is sent or expected
    assert.ok(!kinds.has('ping'), 'no exchange expects a ping');
    sameSet([...kinds], [...PAGE_KINDS, ...SERVER_KINDS].filter((k) => k !== 'ping'), 'every message kind but ping, in the exchanges');
    sameSet([...whys], REFUSALS, 'every refusal code, in the exchanges');
    sameSet([...vias], ['page', 'apply', 'take'], 'every via');
    sameSet([...closes], CLOSE_WHYS, 'every closed why');
    sameSet([...pauses], PAUSE_WHYS, 'every paused why');
  });

  await t.test('rules: Object.prototype is untouched', () => {
    assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).sort(), PROTO_NAMES);
    assert.equal(({}).text, undefined);
    assert.equal(({}).x, undefined);
  });
});
