// The canvas module: contract canvas-doc@1 (test/contracts/canvas.md §2, §4, §6, §7) as production
// code. `validate(doc, { images, folderBytes })` lists every way a document breaks the contract, rule by
// rule in DOC_RULES order; `apply(doc, ops, { images, folderBytes, level, maxOpsBytes })` judges an edit
// as a whole (canvas@1 §4) and gives the new document at rev + 1, or the same document and the refusal
// code. Every op is idempotent. The tables (LIMITS, RANGES, TYPES, PROPS, CLASSES, TOKEN_TYPES,
// DOC_RULES, OPS, REFUSALS) are frozen and are the ones the next canvas tickets read; so are
// `opErrors(op)` (an op's own shape, nothing that needs a document) and `NODE_ID_RE`, kit-internal
// helpers for the merge and the CLI, held to the fake through `apply`.
//
// A port of the rules half of test/lib/canvas-fake.mjs, the contract's executable form: the fake is
// the reference, and test/canvas-document.test.mjs holds this module to it (the same errors, the same
// judgement, the same tables). Change a rule there first. This module's own additions: `images` may be
// an array (made a Set), and `apply` refuses `shape` for a document outside the shape rules (top,
// page-shape, node-shape) where the fake would throw. Pure (never mutates its arguments), no I/O, no
// dependencies; tree walks use explicit stacks and queues, never recursion. Node 18 and later.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// A key from the document written as an own data property, so `__proto__`, `constructor` and the
// like are ids like any other and never reach a prototype; the object stays plain and JSON-equal.
const put = (o, k, v) => { Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true }); return v; };
const ownGet = (o, k) => (isObj(o) && own(o, k) ? o[k] : undefined);
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const safeInt = (v, lo) => Number.isSafeInteger(v) && v >= lo;

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

// ---- the tables ----

// Every number of the spec: the document's, the socket's, the routes', the clocks'.
export const LIMITS = Object.freeze({
  // canvas-doc@1
  docBytes: 5 * 1024 * 1024, // canvas.json as written: JSON.stringify(doc, null, 2) plus a newline
  folderBytes: 25 * 1024 * 1024, // the folder: canvas.json, images/ and its other files
  nodes: 20000,
  pages: 100,
  tokens: 1000,
  tokenDepth: 8, // segments in a token's path
  depth: 100, // a page's children are depth 1
  overrideEntries: 1000, // entries in one instance's overrides, or one variant's
  props: 32,
  variants: 32,
  tracks: 64,
  idChars: 40,
  nameChars: 200, // code points
  textChars: 10000, // code points
  pathBytes: 64 * 1024,
  figmaChars: 100,
  propNameChars: 40,
  tokenSegmentChars: 40,
  // canvas@1: the socket
  pageMsgBytes: 256 * 1024,
  pageFrames: 16,
  editOpsBytes: 64 * 1024,
  serverMsgBytes: 1024 * 1024,
  serverFrameBytes: 256 * 1024,
  perSecond: 30,
  perPerson: 8,
  perCanvas: 50,
  openCanvases: 20,
  perServer: 200,
  selectIds: 100,
  refusedMemory: 2000, // refused seqs remembered within this of a client's highest seq seen (a half-open link's ~60 s at 30 a second is 1800)
  pingMs: 20000,
  unansweredPings: 2,
  savedMs: 500,
  selectionsMs: 250,
  // canvas@1: the routes
  imageBytes: 4 * 1024 * 1024,
  imageBodyBytes: 6 * 1024 * 1024,
  localBodyBytes: 5 * 1024 * 1024,
  importBodyBytes: 50 * 1024 * 1024,
  byChars: 64,
  // artifact-notes@1's node anchor
  noteAnchorChars: 64,
});

// The numeric ranges of the value classes and token types, [lo, hi] inclusive, keyed by the contract's
// Value classes row (a class) or Token types row (`token:<$type>`). The checks below read them.
export const RANGES = deepFreeze({
  dim: { value: [-100000, 100000] },
  len: { value: [0, 100000] },
  opacity: { value: [0, 1] },
  tracks: { value: [0, 100000], fr: [1, 999] },
  font: { size: [1, 1000], weight: [100, 900], lineHeight: [0.5, 10] },
  'token:color': { component: [0, 1], alpha: [0, 1] },
  'token:dimension': { value: [-100000, 100000] },
  'token:fontWeight': { value: [100, 900] },
});

export const TYPES = Object.freeze(['frame', 'text', 'rect', 'ellipse', 'vector', 'image', 'component', 'instance']);
const CONTAINERS = new Set(['frame', 'component']);
const STRUCTURAL = new Set(['id', 'type', 'parent', 'children']);

export const CLASSES = Object.freeze([
  'color', 'paint', 'dim', 'len', 'opacity', 'padding', 'sizing', 'tracks', 'font', 'pathData', 'imageSrc', 'name', 'text',
  'figmaId', 'bool', 'enum', 'componentRef', 'variantName', 'propDefs', 'propDef', 'propValues', 'propValue', 'variants',
  'variant', 'overrides', 'override',
]);

export const TOKEN_TYPES = Object.freeze(['color', 'dimension', 'fontFamily', 'fontWeight', 'number', 'typography']);

// A property: its value class, its default (undefined: absent) and whether it is required. An enum
// also has its `words`. Map entries are templates: `props.<name>`, `variants.<name>`,
// `variants.<name>.<id>.<prop>`, `overrides.<id>.<prop>`.
const p = (cls, dflt) => ({ class: cls, default: dflt, required: false });
const req = (cls) => ({ class: cls, default: undefined, required: true });
const en = (words, dflt) => ({ class: 'enum', default: dflt, required: false, words });
const COMMON = {
  name: p('name', ''), visible: p('bool', true), opacity: p('opacity', 1), x: p('dim', 0), y: p('dim', 0),
  'size.w': p('sizing', 'hug'), 'size.h': p('sizing', 'hug'), figma: p('figmaId', undefined),
};
const STROKE = { fill: p('paint', null), stroke: p('paint', null), strokeWidth: p('len', 0) };
const BOX = () => ({
  ...STROKE, radius: p('len', 0), clip: p('bool', false),
  'layout.mode': en(['none', 'row', 'column', 'grid'], 'none'), 'layout.gap': p('len', 0), 'layout.padding': p('padding', [0, 0, 0, 0]),
  'layout.align': en(['start', 'center', 'end', 'stretch'], 'start'), 'layout.justify': en(['start', 'center', 'end', 'between'], 'start'),
  'layout.wrap': p('bool', false), 'layout.columns': p('tracks', []), 'layout.rows': p('tracks', []),
});
export const PROPS = deepFreeze({
  frame: { ...COMMON, ...BOX() },
  text: {
    ...COMMON, text: p('text', ''), font: p('font', { family: 'sans', size: 16, weight: 400, lineHeight: 1.4 }),
    color: p('color', '#000000'), align: en(['left', 'center', 'right', 'justify'], 'left'),
  },
  rect: { ...COMMON, ...STROKE, radius: p('len', 0) },
  ellipse: { ...COMMON, ...STROKE },
  vector: { ...COMMON, path: req('pathData'), ...STROKE },
  image: { ...COMMON, src: req('imageSrc'), fit: en(['cover', 'contain', 'fill'], 'cover'), radius: p('len', 0) },
  component: {
    ...COMMON, ...BOX(),
    props: p('propDefs', {}), 'props.<name>': p('propDef', undefined),
    variants: p('variants', {}), 'variants.<name>': p('variant', undefined), 'variants.<name>.<id>.<prop>': p('override', undefined),
  },
  instance: {
    ...COMMON, component: req('componentRef'), variant: p('variantName', null),
    props: p('propValues', {}), 'props.<name>': p('propValue', undefined),
    overrides: p('overrides', {}), 'overrides.<id>.<prop>': p('override', undefined),
  },
});
const isTemplate = (path) => path.includes('<');
// Per type: the plain (non-template) property paths; the groups (`layout`, `size`) whose keys are paths.
const PLAIN = {};
const GROUPS = {};
for (const type of TYPES) {
  PLAIN[type] = Object.keys(PROPS[type]).filter((k) => !isTemplate(k));
  GROUPS[type] = new Set(PLAIN[type].filter((k) => k.includes('.')).map((k) => k.split('.')[0]));
}
// Never overridden: names stay design-time (F5), and an instance's or component's own wiring.
const NOT_OVERRIDDEN = new Set(['name', 'figma', 'component', 'variant', 'props', 'variants', 'overrides']);
function overridable(type, prop) {
  if (!TYPES.includes(type) || isTemplate(prop) || NOT_OVERRIDDEN.has(prop) || !own(PROPS[type], prop)) return null;
  return PROPS[type][prop];
}
// An override key not allowed there (refused `prop`): one never overridden, a structural key, a
// template, or, its target node known, a property its type doesn't have. A target that doesn't resolve
// is the refs rule's (`ref`), so ops in one edit may still refer forward.
function overrideKeyBad(nodes, target, prop) {
  if (NOT_OVERRIDDEN.has(prop) || STRUCTURAL.has(prop) || isTemplate(prop)) return true;
  const t = ownGet(nodes, target);
  return isObj(t) && TYPES.includes(t.type) && !overridable(t.type, prop);
}
// The same, over a whole map: `overrides` and `variant` ({ id: { prop } }), `variants` ({ name: { id: { prop } } }).
function overrideMapBad(nodes, cls, m) {
  if (!isObj(m)) return false;
  const idMaps = cls === 'variants' ? Object.values(m).filter(isObj) : [m];
  return idMaps.some((im) => Object.entries(im).some(([id, o]) => isObj(o) && Object.keys(o).some((prop) => overrideKeyBad(nodes, id, prop))));
}

// The document rules, in judgement order: the first that fails refuses an edit with its code.
// The spec's order (tree, types and keys, classes, refs, component placement, instance cycles,
// limits), with the shapes every later rule reads first, and the token tree before the refs into it.
export const DOC_RULES = deepFreeze([
  { rule: 'top', code: 'shape' }, // exactly { canvas: 1, rev, tokens, pages, nodes }
  { rule: 'page-shape', code: 'shape' }, // each page exactly { id, name, children }
  { rule: 'node-shape', code: 'shape' }, // each node an object with a known type, a parent, children only on frame and component
  { rule: 'id-form', code: 'value' }, // ids are 1 to 40 of [A-Za-z0-9_-]
  { rule: 'id-unique', code: 'exists' }, // unique across pages and nodes
  { rule: 'tree', code: 'parent' }, // parents exist and list their children once, children name their parent, all reached from a page
  { rule: 'keys', code: 'prop' }, // a node's keys are its type's properties
  { rule: 'required', code: 'shape' }, // vector path, image src, instance component
  { rule: 'classes', code: 'value' }, // every value in its class
  { rule: 'tokens', code: 'value' }, // groups and tokens of the six types, values literal
  { rule: 'refs', code: 'ref' }, // tokens, components, prop targets, overrides, variants, images resolve
  { rule: 'components', code: 'parent' }, // a component never inside another, at any depth
  { rule: 'instance-cycle', code: 'cycle' }, // an instance never inside the component it names, directly or through others
  { rule: 'limits', code: 'limit' }, // nodes, pages, tokens, depth, props, variants, override entries, bytes
]);

export const OPS = Object.freeze(['set', 'add', 'del', 'move', 'token']);
export const REFUSALS = Object.freeze(['shape', 'prop', 'value', 'missing', 'parent', 'exists', 'cycle', 'ref', 'limit', 'view']);

export const NODE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const PROP_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const SEGMENT_RE = /^[A-Za-z0-9_-]{1,40}$/;
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const HEX6_RE = /^#[0-9a-fA-F]{6}$/;
const FIGMA_RE = /^[A-Za-z0-9:;_-]{1,100}$/;
const PATH_CMD = new Set('MLHVCSQTAZmlhvcsqtaz');
const PATH_NUM = /[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/y;
const PATH_WS = new Set([' ', '\t', '\n', '\r', '\f']);
// Optional whitespace, a move, then commands and numbers separated by whitespace and at most one comma
// (none leading, none trailing, never two in a row). A scan, so a long path costs linear time.
function pathOk(s) {
  let i = 0;
  const n = s.length;
  const ws = () => { while (i < n && PATH_WS.has(s[i])) i++; };
  ws();
  if (s[i] !== 'M' && s[i] !== 'm') return false;
  i++;
  for (;;) {
    ws();
    let comma = false;
    if (s[i] === ',') { comma = true; i++; ws(); }
    if (i >= n) return !comma;
    if (PATH_CMD.has(s[i])) { i++; continue; }
    PATH_NUM.lastIndex = i;
    if (!PATH_NUM.test(s)) return false;
    i = PATH_NUM.lastIndex;
  }
}
const FR_RE = /^([0-9]+)fr$/;
const SRC_RE = /^images\/([0-9a-f]{16}\.(?:png|jpg|webp|gif))$/;
const FAMILIES = ['sans', 'serif', 'mono'];

// ---- strings: code points and well-formedness, by a loop over code units ----

function wellFormed(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (d < 0xdc00 || d > 0xdfff) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
function codePoints(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}
const textOf = (v, max) => {
  if (typeof v !== 'string') return 'not a string';
  if (!wellFormed(v)) return 'a lone surrogate';
  if (codePoints(v) > max) return `over ${max} characters`;
  return null;
};
const tokenPathOk = (s) => typeof s === 'string' && s.split('.').every((seg) => SEGMENT_RE.test(seg));

// ---- value classes: each returns null or what is wrong, and lists the refs a value makes ----

// A `{ "$ref" }` to a token of `type`, for a dimension or number in min..max.
function tokenRef(v, refs, type, min, max) {
  if (!isObj(v) || !own(v, '$ref')) return `neither a literal nor a ${type} reference`;
  if (Object.keys(v).length !== 1) return 'a reference with other keys';
  if (!tokenPathOk(v.$ref)) return 'a reference that is not a token path';
  refs.push({ kind: 'token', path: v.$ref, type, min, max });
  return null;
}
const D = LIMITS;
const R = RANGES;
const inR = (v, [lo, hi]) => num(v, lo, hi);
function lenOf(v, refs) {
  const [lo, hi] = R.len.value;
  if (typeof v === 'number') return num(v, lo, hi) ? null : `not a number in ${lo}..${hi}`;
  return tokenRef(v, refs, 'dimension', lo, hi);
}
const weightIn = (v, [lo, hi]) => Number.isInteger(v) && v >= lo && v <= hi && v % 100 === 0;
const weightOk = (v) => weightIn(v, R.font.weight);
const frOk = (x) => { const m = typeof x === 'string' ? FR_RE.exec(x) : null; return !!m && !/^0[0-9]/.test(m[1]) && inR(Number(m[1]), R.tracks.fr); };

const SIMPLE = {
  color(v, refs) {
    if (typeof v === 'string') return HEX_RE.test(v) ? null : 'not #rgb, #rrggbb or #rrggbbaa';
    return tokenRef(v, refs, 'color');
  },
  paint: (v, refs) => (v === null ? null : SIMPLE.color(v, refs)),
  dim(v, refs) {
    const [lo, hi] = R.dim.value;
    if (typeof v === 'number') return num(v, lo, hi) ? null : `not a number in ${lo}..${hi}`;
    return tokenRef(v, refs, 'dimension', lo, hi);
  },
  len: lenOf,
  opacity: (v) => (inR(v, R.opacity.value) ? null : 'not a number in 0..1'),
  padding(v, refs) {
    if (!Array.isArray(v) || v.length !== 4) return 'not four lengths';
    for (const x of v) { const e = lenOf(x, refs); if (e) return e; }
    return null;
  },
  sizing: (v, refs) => (v === 'hug' || v === 'fill' ? null : lenOf(v, refs)),
  tracks(v) {
    if (!Array.isArray(v)) return 'not an array';
    if (v.length > D.tracks) return `over ${D.tracks} tracks`;
    for (const x of v) {
      if (typeof x === 'number' ? !inR(x, R.tracks.value) : !(x === 'auto' || frOk(x))) return `a track ${JSON.stringify(x)}`;
    }
    return null;
  },
  font(v, refs) {
    if (isObj(v) && own(v, '$ref')) return tokenRef(v, refs, 'typography');
    if (!isObj(v)) return 'not a font';
    const ks = Object.keys(v);
    if (ks.length !== 4 || !['family', 'size', 'weight', 'lineHeight'].every((k) => own(v, k))) return 'not exactly { family, size, weight, lineHeight }';
    if (!FAMILIES.includes(v.family) && tokenRef(v.family, refs, 'fontFamily')) return 'family not sans, serif, mono or a fontFamily reference';
    if (!(typeof v.size === 'number' ? inR(v.size, R.font.size) : !tokenRef(v.size, refs, 'dimension', ...R.font.size))) return 'size not 1..1000 or a dimension reference';
    if (!weightOk(v.weight) && tokenRef(v.weight, refs, 'fontWeight')) return 'weight not 100..900 by 100 or a fontWeight reference';
    if (!(typeof v.lineHeight === 'number' ? inR(v.lineHeight, R.font.lineHeight) : !tokenRef(v.lineHeight, refs, 'number', ...R.font.lineHeight))) return 'lineHeight not 0.5..10 or a number reference';
    return null;
  },
  pathData(v) {
    if (typeof v !== 'string') return 'not a string';
    if (Buffer.byteLength(v) > D.pathBytes) return `over ${D.pathBytes} bytes`;
    return pathOk(v) ? null : 'not SVG path commands and numbers starting with a move';
  },
  imageSrc(v, refs) {
    const m = typeof v === 'string' ? SRC_RE.exec(v) : null;
    if (!m) return 'not images/<16 hex>.<png|jpg|webp|gif>';
    refs.push({ kind: 'image', file: m[1] });
    return null;
  },
  name: (v) => textOf(v, D.nameChars),
  text: (v) => textOf(v, D.textChars),
  figmaId: (v) => (typeof v === 'string' && FIGMA_RE.test(v) ? null : 'not 1 to 100 of [A-Za-z0-9:;_-]'),
  bool: (v) => (typeof v === 'boolean' ? null : 'not a boolean'),
  enum: (v, refs, words) => (words.includes(v) ? null : `not one of ${words.join(', ')}`),
  componentRef: (v) => (typeof v === 'string' && NODE_ID_RE.test(v) ? null : 'not a node id'),
  variantName: (v) => (v === null || (typeof v === 'string' && PROP_NAME_RE.test(v)) ? null : 'not null or a variant name'),
  propDef(v) {
    if (!isObj(v)) return 'not an object';
    const ks = Object.keys(v);
    if (ks.length !== 3 || !['type', 'default', 'target'].every((k) => own(v, k))) return 'not exactly { type, default, target }';
    if (v.type !== 'text' && v.type !== 'bool') return 'type not text or bool';
    const e = v.type === 'text' ? textOf(v.default, D.textChars) : typeof v.default === 'boolean' ? null : 'not a boolean';
    if (e) return `default ${e}`;
    const tg = v.target;
    if (!isObj(tg) || Object.keys(tg).length !== 2 || !own(tg, 'id') || !own(tg, 'prop')) return 'target not exactly { id, prop }';
    if (typeof tg.id !== 'string' || !NODE_ID_RE.test(tg.id)) return 'target id not a node id';
    if (tg.prop !== (v.type === 'text' ? 'text' : 'visible')) return `target prop not ${v.type === 'text' ? 'text' : 'visible'}`;
    return null;
  },
  propValue: (v) => (typeof v === 'boolean' ? null : textOf(v, D.textChars)),
};

// A class check with the document at hand (`nodes`, for an override's target); errors go to `bad`
// as { where, message }, refs to `refs` with their `where`. `extra` is the property (its `words`) or
// an override's { target, prop }.
function checkClass(nodes, bad, refs, where, cls, v, extra) {
  const r = [];
  const fail = (w, c, detail) => bad.push({ where: w, message: `not ${c}: ${detail}` });
  const mapOf = (w, c, m, keyRe, keyWhat, each) => {
    if (!isObj(m)) { fail(w, c, 'not an object'); return; }
    for (const k of Object.keys(m)) {
      if (!keyRe.test(k)) fail(`${w}.${k}`, c, `key not ${keyWhat}`);
      else each(`${w}.${k}`, k, m[k]);
    }
  };
  const overrideMap = (w, c, m) => mapOf(w, c, m, NODE_ID_RE, 'a node id', (wi, id, o) => {
    if (!isObj(o)) { fail(wi, c, 'not an object of properties'); return; }
    for (const prop of Object.keys(o)) checkClass(nodes, bad, refs, `${wi}.${prop}`, 'override', o[prop], { target: id, prop });
  });
  switch (cls) {
    case 'propDefs': mapOf(where, cls, v, PROP_NAME_RE, 'a prop name', (w, k, x) => checkClass(nodes, bad, refs, w, 'propDef', x)); return;
    case 'propValues': mapOf(where, cls, v, PROP_NAME_RE, 'a prop name', (w, k, x) => checkClass(nodes, bad, refs, w, 'propValue', x)); return;
    case 'variants': mapOf(where, cls, v, PROP_NAME_RE, 'a variant name', (w, k, x) => checkClass(nodes, bad, refs, w, 'variant', x)); return;
    case 'variant': overrideMap(where, cls, v); return;
    case 'overrides': overrideMap(where, cls, v); return;
    case 'override': {
      // checked against its target's property when that resolves; otherwise the refs rule says so
      const t = own(nodes, extra.target) ? nodes[extra.target] : null;
      const def = isObj(t) ? overridable(t.type, extra.prop) : null;
      if (!def) return;
      const e = SIMPLE[def.class](v, r, def.words);
      if (e) fail(where, cls, `${extra.prop}: not ${def.class}: ${e}`);
      break;
    }
    default: {
      const e = SIMPLE[cls](v, r, extra && extra.words);
      if (e) fail(where, cls, e);
    }
  }
  for (const x of r) refs.push({ ...x, where });
}

// ---- tokens ----

function dimToken(v) {
  return isObj(v) && Object.keys(v).length === 2 && inR(v.value, R['token:dimension'].value) && v.unit === 'px';
}
// What is wrong with a token, or null.
function tokenProblem(t) {
  if (!isObj(t)) return 'not a token';
  if (Object.keys(t).length !== 2 || !own(t, '$type') || !own(t, '$value')) return 'not exactly { $type, $value }';
  const v = t.$value;
  switch (t.$type) {
    case 'color': {
      if (!isObj(v) || v.colorSpace !== 'srgb' || !Array.isArray(v.components) || v.components.length !== 3) return 'color: not { colorSpace: srgb, components: [r, g, b] }';
      if (Object.keys(v).some((k) => !['colorSpace', 'components', 'alpha', 'hex'].includes(k))) return 'color: an extra key';
      if (!v.components.every((c) => inR(c, R['token:color'].component))) return 'color: a component not in 0..1';
      if (own(v, 'alpha') && !inR(v.alpha, R['token:color'].alpha)) return 'color: alpha not in 0..1';
      if (own(v, 'hex') && !(typeof v.hex === 'string' && HEX6_RE.test(v.hex))) return 'color: hex not #rrggbb';
      return null;
    }
    case 'dimension': return dimToken(v) ? null : 'dimension: not { value: -100000..100000, unit: px }';
    case 'fontFamily': return FAMILIES.includes(v) ? null : 'fontFamily: not sans, serif or mono';
    case 'fontWeight': return weightIn(v, R['token:fontWeight'].value) ? null : 'fontWeight: not 100..900 by 100';
    case 'number': return num(v, -Infinity, Infinity) ? null : 'number: not a finite number';
    case 'typography': {
      const ks = ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight'];
      if (!isObj(v) || Object.keys(v).length !== 5 || !ks.every((k) => own(v, k))) return 'typography: not exactly { fontFamily, fontSize, fontWeight, letterSpacing, lineHeight }';
      if (!FAMILIES.includes(v.fontFamily)) return 'typography: fontFamily not sans, serif or mono';
      if (!dimToken(v.fontSize)) return 'typography: fontSize not a dimension';
      if (!weightIn(v.fontWeight, R['token:fontWeight'].value)) return 'typography: fontWeight not 100..900 by 100';
      if (!dimToken(v.letterSpacing)) return 'typography: letterSpacing not a dimension';
      if (!num(v.lineHeight, -Infinity, Infinity)) return 'typography: lineHeight not a number';
      return null;
    }
    default: return `$type not one of ${TOKEN_TYPES.join(', ')}`;
  }
}
// A token is an object with a `$` key; anything else that is an object is a group.
const isTokenNode = (v) => isObj(v) && Object.keys(v).some((k) => k.startsWith('$'));

// ---- validate (the fake's docErrors) ----

// `images` as the rules read it: a Set of file names, or null; an array is made a Set.
const imageSet = (images) => (Array.isArray(images) ? new Set(images) : images);

// The shape rules (top, page-shape, node-shape), the first three of DOC_RULES, which every later rule
// reads: each failure goes to `add(rule, where, message)`. Returns null when `doc` isn't an object,
// else what the later rules walk: the pages, nodes and tokens (empty when malformed), the node ids,
// the pages of a sound shape and the nodes of a sound shape (id -> node).
function shapeRules(doc, add) {
  // top
  if (!isObj(doc)) { add('top', 'doc', 'not an object'); return null; }
  const TOP = ['canvas', 'rev', 'tokens', 'pages', 'nodes'];
  for (const k of TOP) if (!own(doc, k)) add('top', 'doc', `no ${k}`);
  for (const k of Object.keys(doc)) if (!TOP.includes(k)) add('top', 'doc', `extra key ${k}`);
  if (own(doc, 'canvas') && doc.canvas !== 1) add('top', 'doc.canvas', 'not 1');
  if (own(doc, 'rev') && !safeInt(doc.rev, 0)) add('top', 'doc.rev', 'not an integer >= 0');
  if (own(doc, 'tokens') && !isObj(doc.tokens)) add('top', 'doc.tokens', 'not an object');
  if (own(doc, 'pages') && !Array.isArray(doc.pages)) add('top', 'doc.pages', 'not an array');
  if (own(doc, 'nodes') && !isObj(doc.nodes)) add('top', 'doc.nodes', 'not an object');
  const pages = Array.isArray(doc.pages) ? doc.pages : [];
  const nodes = isObj(doc.nodes) ? doc.nodes : {};
  const tokens = isObj(doc.tokens) ? doc.tokens : {};
  const nodeIds = Object.keys(nodes);

  // page-shape
  const goodPages = [];
  pages.forEach((pg, i) => {
    const w = `pages[${i}]`;
    if (!isObj(pg)) { add('page-shape', w, 'not an object'); return; }
    let ok = true;
    for (const k of ['id', 'name', 'children']) if (!own(pg, k)) { add('page-shape', w, `no ${k}`); ok = false; }
    for (const k of Object.keys(pg)) if (!['id', 'name', 'children'].includes(k)) add('page-shape', w, `extra key ${k}`);
    if (own(pg, 'children') && !(Array.isArray(pg.children) && pg.children.every((c) => typeof c === 'string'))) { add('page-shape', `${w}.children`, 'not an array of ids'); ok = false; }
    if (typeof pg.id !== 'string') { add('page-shape', `${w}.id`, 'not a string'); ok = false; }
    if (ok) goodPages.push(pg);
  });

  // node-shape
  const good = new Map(); // id -> node, for nodes of a sound shape
  for (const id of nodeIds) {
    const n = nodes[id];
    const w = `nodes.${id}`;
    if (!isObj(n)) { add('node-shape', w, 'not an object'); continue; }
    let ok = true;
    if (!TYPES.includes(n.type)) { add('node-shape', `${w}.type`, `not one of ${TYPES.join(', ')}`); ok = false; }
    if (typeof n.parent !== 'string') { add('node-shape', `${w}.parent`, 'not an id'); ok = false; }
    if (CONTAINERS.has(n.type)) {
      if (!(Array.isArray(n.children) && n.children.every((c) => typeof c === 'string'))) { add('node-shape', `${w}.children`, 'not an array of ids'); ok = false; }
    } else if (own(n, 'children')) { add('node-shape', `${w}.children`, `a ${n.type} has no children`); ok = false; }
    if (ok) good.set(id, n);
  }
  return { pages, nodes, tokens, nodeIds, goodPages, good };
}

// True when `doc` passes the shape rules: the domain on which `apply` judges as the fake does.
function shapeOk(doc) {
  let ok = true;
  shapeRules(doc, () => { ok = false; });
  return ok;
}

// The way `doc` breaks canvas-doc@1, rule by rule in DOC_RULES order. `images`: the file names under
// `images/` (a Set, or an array made one), or null to skip the file check; `folderBytes`: every byte of
// the folder but canvas.json (images and other files), counted with canvas.json as written against the
// folder limit. The fake's `docErrors`.
export function validate(doc, { images = null, folderBytes = 0 } = {}) {
  images = imageSet(images);
  const by = new Map(DOC_RULES.map((r) => [r.rule, []]));
  const add = (rule, where, message) => by.get(rule).push({ where, message });
  const finish = () => {
    const out = [];
    for (const { rule, code } of DOC_RULES) for (const e of by.get(rule)) out.push({ rule, code, where: e.where, message: e.message });
    return out;
  };
  const shaped = shapeRules(doc, add);
  if (!shaped) return finish();
  const { pages, nodes, tokens, nodeIds, goodPages, good } = shaped;

  // id-form
  pages.forEach((pg, i) => { if (isObj(pg) && !(typeof pg.id === 'string' && NODE_ID_RE.test(pg.id))) add('id-form', `pages[${i}].id`, 'not 1 to 40 of [A-Za-z0-9_-]'); });
  for (const id of nodeIds) if (!NODE_ID_RE.test(id)) add('id-form', `nodes.${JSON.stringify(id)}`, 'not 1 to 40 of [A-Za-z0-9_-]');

  // id-unique
  const pageIds = new Map();
  for (const pg of goodPages) {
    if (pageIds.has(pg.id)) add('id-unique', `pages.${pg.id}`, 'a page id listed twice');
    else pageIds.set(pg.id, pg);
    if (own(nodes, pg.id)) add('id-unique', `pages.${pg.id}`, 'a page id that is also a node id');
  }

  // keys
  for (const [id, n] of good) {
    const w = `nodes.${id}`;
    for (const k of Object.keys(n)) {
      if (STRUCTURAL.has(k)) {
        if (k === 'id') add('keys', `${w}.id`, 'a node holds no id key (its key is its id)');
        continue;
      }
      if (GROUPS[n.type].has(k)) {
        if (!isObj(n[k])) { add('keys', `${w}.${k}`, 'a group that is not an object'); continue; }
        for (const sub of Object.keys(n[k])) if (!own(PROPS[n.type], `${k}.${sub}`)) add('keys', `${w}.${k}.${sub}`, `not a property of a ${n.type}`);
      } else if (!own(PROPS[n.type], k) || isTemplate(k)) add('keys', `${w}.${k}`, `not a property of a ${n.type}`);
    }
    // override keys not allowed there: a variant's (on a component) and an instance's
    const idMaps = [];
    if (n.type === 'component' && isObj(n.variants)) for (const [vn, vm] of Object.entries(n.variants)) idMaps.push([`${w}.variants.${vn}`, vm]);
    if (n.type === 'instance') idMaps.push([`${w}.overrides`, n.overrides]);
    for (const [wm, im] of idMaps) {
      if (!isObj(im)) continue;
      for (const [tid, o] of Object.entries(im)) {
        if (!isObj(o)) continue;
        for (const prop of Object.keys(o)) if (overrideKeyBad(nodes, tid, prop)) add('keys', `${wm}.${tid}.${prop}`, `${prop} may not be overridden on ${tid}`);
      }
    }
  }

  // required
  for (const [id, n] of good) {
    for (const path of PLAIN[n.type]) if (PROPS[n.type][path].required && getPath(n, path) === undefined) add('required', `nodes.${id}.${path}`, 'required');
  }

  // classes (and the refs values make, judged by the refs rule)
  const bad = [];
  const refs = [];
  pages.forEach((pg, i) => { if (isObj(pg) && own(pg, 'name')) checkClass(nodes, bad, refs, `pages[${i}].name`, 'name', pg.name); });
  for (const [id, n] of good) {
    for (const path of PLAIN[n.type]) {
      const v = getPath(n, path);
      if (v === undefined) continue;
      const def = PROPS[n.type][path];
      checkClass(nodes, bad, refs, `nodes.${id}.${path}`, def.class, v, def);
    }
  }
  for (const e of bad) add('classes', e.where, e.message);

  // tree: parents, children, reach; and from the walk, depth and each node's nearest component
  const listedBy = new Map(); // child id -> the first page or node listing it
  const lists = [];
  for (const pg of goodPages) lists.push([pg.id, pg.children, `pages.${pg.id}.children`]);
  for (const [id, n] of good) if (CONTAINERS.has(n.type)) lists.push([id, n.children, `nodes.${id}.children`]);
  for (const [owner, kids, w] of lists) {
    for (const c of kids) {
      if (listedBy.has(c)) { add('tree', w, `${c} listed twice (also by ${listedBy.get(c)})`); continue; }
      listedBy.set(c, owner);
      if (!good.has(c)) { if (!own(nodes, c)) add('tree', w, `${c} is not a node`); continue; }
      if (good.get(c).parent !== owner) add('tree', w, `${c} names another parent (${good.get(c).parent})`);
    }
  }
  for (const [id, n] of good) {
    const pid = n.parent;
    const isPage = pageIds.has(pid);
    const pn = good.get(pid);
    if (!isPage && !pn) add('tree', `nodes.${id}.parent`, `${pid} is neither a page nor a node`);
    else if (!isPage && !CONTAINERS.has(pn.type)) add('tree', `nodes.${id}.parent`, `${pid} is a ${pn.type}, which holds no children`);
    else if (listedBy.get(id) !== pid) add('tree', `nodes.${id}.parent`, `${pid} does not list it`);
  }
  const depth = new Map();
  const encl = new Map(); // id -> its nearest component ancestor, or null
  const queue = [];
  for (const pg of pageIds.values()) for (const c of pg.children) if (good.has(c) && good.get(c).parent === pg.id && !depth.has(c)) { depth.set(c, 1); encl.set(c, null); queue.push(c); }
  let maxDepth = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi];
    const n = good.get(id);
    const dpt = depth.get(id);
    if (dpt > maxDepth) maxDepth = dpt;
    if (!CONTAINERS.has(n.type)) continue;
    const inside = n.type === 'component' ? id : encl.get(id);
    for (const c of n.children) {
      if (good.has(c) && good.get(c).parent === id && !depth.has(c)) { depth.set(c, dpt + 1); encl.set(c, inside); queue.push(c); }
    }
  }
  for (const id of good.keys()) if (!depth.has(id)) add('tree', `nodes.${id}`, 'not reached from a page');

  // components
  for (const [id, n] of good) if (n.type === 'component' && encl.get(id)) add('components', `nodes.${id}`, `a component inside component ${encl.get(id)}`);

  // tokens
  const tokenAt = new Map(); // path -> token
  let tokenCount = 0;
  let tokenDepth = 0;
  const tstack = [[tokens, []]];
  while (tstack.length) {
    const [g, at] = tstack.pop();
    for (const k of Object.keys(g)) {
      const path = [...at, k];
      const w = `tokens.${path.join('.')}`;
      if (!SEGMENT_RE.test(k)) { add('tokens', w, 'a segment not 1 to 40 of [A-Za-z0-9_-]'); continue; }
      const v = g[k];
      if (!isObj(v)) { add('tokens', w, 'neither a token nor a group'); continue; }
      if (isTokenNode(v)) {
        tokenCount += 1;
        if (path.length > tokenDepth) tokenDepth = path.length;
        const e = tokenProblem(v);
        if (e) add('tokens', w, e);
        tokenAt.set(path.join('.'), v);
      } else tstack.push([v, path]);
    }
  }

  // refs
  for (const r of refs) {
    if (r.kind === 'image') {
      if (images && !images.has(r.file)) add('refs', r.where, `images/${r.file} is not in the folder`);
      continue;
    }
    const tok = tokenAt.get(r.path);
    if (!tok) { add('refs', r.where, `no token ${r.path}`); continue; }
    if (tok.$type !== r.type) { add('refs', r.where, `${r.path} is a ${tok.$type}, not a ${r.type}`); continue; }
    if (r.min !== undefined) {
      const v = r.type === 'dimension' ? (isObj(tok.$value) ? tok.$value.value : NaN) : tok.$value;
      if (!num(v, r.min, r.max)) add('refs', r.where, `${r.path} is out of ${r.min}..${r.max} here`);
    }
  }
  const isComp = (id) => good.has(id) && good.get(id).type === 'component';
  const inComp = (id, comp) => good.has(id) && encl.get(id) === comp;
  const overrideRefs = (w, comp, m) => {
    if (!isObj(m)) return;
    for (const id of Object.keys(m)) if (!inComp(id, comp)) add('refs', `${w}.${id}`, `${id} is not a descendant of component ${comp}`);
  };
  for (const [id, n] of good) {
    const w = `nodes.${id}`;
    if (n.type === 'component') {
      if (isObj(n.props)) {
        for (const [name, pd] of Object.entries(n.props)) {
          if (!isObj(pd) || !isObj(pd.target)) continue;
          const tg = pd.target.id;
          if (!inComp(tg, id)) add('refs', `${w}.props.${name}.target`, `${tg} is not a descendant of the component`);
          else if (pd.type === 'text' && good.get(tg).type !== 'text') add('refs', `${w}.props.${name}.target`, `a text prop aimed at a ${good.get(tg).type}`);
        }
      }
      if (isObj(n.variants)) for (const [vn, vm] of Object.entries(n.variants)) overrideRefs(`${w}.variants.${vn}`, id, vm);
    }
    if (n.type === 'instance' && typeof n.component === 'string') {
      if (!isComp(n.component)) { add('refs', `${w}.component`, `${n.component} is not a component`); continue; }
      const comp = good.get(n.component);
      if (typeof n.variant === 'string' && !(isObj(comp.variants) && own(comp.variants, n.variant))) add('refs', `${w}.variant`, `component ${n.component} has no variant ${n.variant}`);
      if (isObj(n.props)) {
        for (const [name, v] of Object.entries(n.props)) {
          const pd = isObj(comp.props) && own(comp.props, name) ? comp.props[name] : null;
          if (!pd) add('refs', `${w}.props.${name}`, `component ${n.component} has no prop ${name}`);
          else if ((pd.type === 'text') !== (typeof v === 'string')) add('refs', `${w}.props.${name}`, `not a ${pd.type} value`);
        }
      }
      overrideRefs(`${w}.overrides`, n.component, n.overrides);
    }
  }

  // instance-cycle: edges component -> component it holds an instance of; what is left after pruning
  // sources and sinks lies on or between cycles.
  const edges = new Map();
  const holders = [];
  for (const [id, n] of good) {
    if (n.type !== 'instance' || !encl.get(id) || !isComp(n.component)) continue;
    const from = encl.get(id);
    if (!edges.has(from)) edges.set(from, new Set());
    edges.get(from).add(n.component);
    holders.push([id, from, n.component]);
  }
  if (holders.length) {
    const live = new Set();
    for (const [, a, b] of holders) { live.add(a); live.add(b); }
    for (const dir of ['in', 'out']) {
      const deg = new Map([...live].map((x) => [x, 0]));
      const next = new Map([...live].map((x) => [x, []]));
      for (const [a, outs] of edges) {
        for (const b of outs) {
          if (!live.has(a) || !live.has(b)) continue;
          const [from, to] = dir === 'in' ? [a, b] : [b, a];
          deg.set(to, deg.get(to) + 1);
          next.get(from).push(to);
        }
      }
      const q = [...live].filter((x) => deg.get(x) === 0);
      while (q.length) {
        const x = q.pop();
        live.delete(x);
        for (const y of next.get(x)) { deg.set(y, deg.get(y) - 1); if (deg.get(y) === 0) q.push(y); }
      }
    }
    for (const [id, from, to] of holders) if (live.has(from) && live.has(to)) add('instance-cycle', `nodes.${id}`, `an instance of ${to} inside ${from}, which ${to} holds again`);
  }

  // limits
  if (nodeIds.length > D.nodes) add('limits', 'nodes', `${nodeIds.length} nodes, over ${D.nodes}`);
  if (pages.length < 1) add('limits', 'pages', 'no page');
  if (pages.length > D.pages) add('limits', 'pages', `${pages.length} pages, over ${D.pages}`);
  if (tokenCount > D.tokens) add('limits', 'tokens', `${tokenCount} tokens, over ${D.tokens}`);
  if (tokenDepth > D.tokenDepth) add('limits', 'tokens', `a token ${tokenDepth} deep, over ${D.tokenDepth}`);
  if (maxDepth > D.depth) add('limits', 'nodes', `depth ${maxDepth}, over ${D.depth}`);
  const entries = (m) => (isObj(m) ? Object.values(m).reduce((s, o) => s + (isObj(o) ? Object.keys(o).length : 0), 0) : 0);
  for (const [id, n] of good) {
    const w = `nodes.${id}`;
    if (n.type === 'component') {
      if (isObj(n.props) && Object.keys(n.props).length > D.props) add('limits', `${w}.props`, `over ${D.props} props`);
      if (isObj(n.variants)) {
        if (Object.keys(n.variants).length > D.variants) add('limits', `${w}.variants`, `over ${D.variants} variants`);
        for (const [vn, vm] of Object.entries(n.variants)) if (entries(vm) > D.overrideEntries) add('limits', `${w}.variants.${vn}`, `over ${D.overrideEntries} override entries`);
      }
    }
    if (n.type === 'instance' && entries(n.overrides) > D.overrideEntries) add('limits', `${w}.overrides`, `over ${D.overrideEntries} override entries`);
  }
  const bytes = writtenBytes(doc);
  if (bytes > D.docBytes) add('limits', 'doc', `${bytes} bytes as written, over ${D.docBytes} bytes`);
  if (bytes + folderBytes > D.folderBytes) add('limits', 'folder', `${bytes + folderBytes} bytes in the folder, over ${D.folderBytes} bytes`);

  return finish();
}
const writtenBytes = (doc) => Buffer.byteLength(`${JSON.stringify(doc, null, 2)}\n`);

// A plain property's value on a node (nested by its dots), or undefined.
function getPath(n, path) {
  let v = n;
  for (const seg of path.split('.')) {
    if (!isObj(v) || !own(v, seg)) return undefined;
    v = v[seg];
  }
  return v;
}

// ---- opErrors and apply (the fake's applyEdit) ----

const idOk = (v) => typeof v === 'string' && NODE_ID_RE.test(v);
const idOrNull = (v) => v === null || idOk(v);
function exact(e, o, want) {
  for (const k of want) if (!own(o, k)) e.push(`no ${k}`);
  for (const k of Object.keys(o)) if (!want.includes(k)) e.push(`extra key ${k}`);
}

// An op's own shape: its keys and their kinds, nothing that needs a document.
export function opErrors(op) {
  if (!isObj(op)) return ['not an object'];
  if (!OPS.includes(op.op)) return [`op not one of ${OPS.join(', ')}`];
  const e = [];
  switch (op.op) {
    case 'set':
      exact(e, op, ['op', 'id', 'prop', 'value']);
      if (!idOk(op.id)) e.push('id not a node or page id');
      if (typeof op.prop !== 'string' || op.prop.length === 0 || op.prop.length > 400) e.push('prop not a property path');
      break;
    case 'add': {
      exact(e, op, ['op', 'node', 'after']);
      if (!idOrNull(op.after)) e.push('after not an id or null');
      const n = op.node;
      if (!isObj(n)) { e.push('node not an object'); break; }
      if (!idOk(n.id)) e.push('node.id not an id');
      if (!TYPES.includes(n.type) && n.type !== 'page') e.push(`node.type not page or one of ${TYPES.join(', ')}`);
      if (!own(n, 'parent') || !idOrNull(n.parent)) e.push('node.parent not an id or null');
      if (own(n, 'children')) e.push('node.children: a container starts empty');
      if (n.type === 'page' && !own(n, 'name')) e.push('node.name: a page has a name');
      break;
    }
    case 'del':
      exact(e, op, ['op', 'id']);
      if (!idOk(op.id)) e.push('id not an id');
      break;
    case 'move':
      exact(e, op, ['op', 'id', 'parent', 'after']);
      if (!idOk(op.id)) e.push('id not an id');
      if (!idOrNull(op.parent)) e.push('parent not an id or null');
      if (!idOrNull(op.after)) e.push('after not an id or null');
      break;
    case 'token':
      exact(e, op, ['op', 'path', 'value']);
      if (!tokenPathOk(op.path)) e.push('path not segments of [A-Za-z0-9_-] joined by dots');
      if (own(op, 'value') && op.value !== null && !isObj(op.value)) e.push('value not a token or null');
      break;
    default:
  }
  return e;
}

// A property path against a type: { def, keys, target, prop } (keys: where it is stored), or null.
function propPath(type, path) {
  const T = PROPS[type];
  if (!isTemplate(path) && own(T, path)) return { def: T[path], keys: path.split('.'), plain: true };
  const s = path.split('.');
  if (s[0] === 'props' && s.length === 2 && own(T, 'props.<name>') && PROP_NAME_RE.test(s[1])) return { def: T['props.<name>'], keys: s };
  if (s[0] === 'variants' && own(T, 'variants.<name>') && s.length >= 2 && PROP_NAME_RE.test(s[1])) {
    if (s.length === 2) return { def: T['variants.<name>'], keys: s };
    if (s.length >= 4 && NODE_ID_RE.test(s[2])) {
      const prop = s.slice(3).join('.');
      return { def: T['variants.<name>.<id>.<prop>'], keys: ['variants', s[1], s[2], prop], target: s[2], prop };
    }
  }
  if (s[0] === 'overrides' && own(T, 'overrides.<id>.<prop>') && s.length >= 3 && NODE_ID_RE.test(s[1])) {
    const prop = s.slice(2).join('.');
    return { def: T['overrides.<id>.<prop>'], keys: ['overrides', s[1], prop], target: s[1], prop };
  }
  return null;
}

// Sets one property on node `n` in the running copy `d`; a refusal code or null.
function setProp(d, n, path, value) {
  if (STRUCTURAL.has(path)) return 'prop';
  const pp = propPath(n.type, path);
  if (!pp) return 'prop';
  const { def, keys } = pp;
  if (pp.target && overrideKeyBad(d.nodes, pp.target, pp.prop)) return 'prop';
  if (['overrides', 'variant', 'variants'].includes(def.class) && overrideMapBad(d.nodes, def.class, value)) return 'prop';
  if (value === null && def.default === undefined && !def.required) {
    // an entry or an absent-by-default property: null removes it; an override's id map
    // (`overrides.<id>`, `variants.<name>.<id>`) left empty goes too, never the variant or a map above
    const chain = [n];
    for (const k of keys.slice(0, -1)) {
      const at = chain[chain.length - 1];
      if (!isObj(ownGet(at, k))) return null;
      chain.push(at[k]);
    }
    delete chain[chain.length - 1][keys[keys.length - 1]];
    const last = chain.length - 1;
    if (pp.target && Object.keys(chain[last]).length === 0) delete chain[last - 1][keys[last - 1]];
    return null;
  }
  const bad = [];
  checkClass(d.nodes, bad, [], path, def.class, value, pp.target ? { target: pp.target, prop: pp.prop } : def);
  if (bad.length) return 'value';
  let at = n;
  for (const k of keys.slice(0, -1)) at = isObj(ownGet(at, k)) ? at[k] : put(at, k, {});
  put(at, keys[keys.length - 1], structuredClone(value));
  return null;
}
// An add's node as property paths: a group's keys under its name, everything else as it is.
function flatten(type, node) {
  const out = [];
  for (const k of Object.keys(node)) {
    if (k === 'id' || k === 'type' || k === 'parent') continue;
    if (GROUPS[type].has(k) && isObj(node[k])) for (const sub of Object.keys(node[k])) out.push([`${k}.${sub}`, node[k][sub]]);
    else out.push([k, node[k]]);
  }
  return out;
}
const pageIndex = (d, id) => d.pages.findIndex((pg) => pg.id === id);
// The children list of a page or container, or null.
function childList(d, id) {
  const pi = pageIndex(d, id);
  if (pi >= 0) return d.pages[pi].children;
  if (own(d.nodes, id) && CONTAINERS.has(d.nodes[id].type)) return d.nodes[id].children;
  return null;
}
function insertAfter(list, item, after, key = (x) => x) {
  if (after === null) { list.unshift(item); return; }
  const i = list.findIndex((x) => key(x) === after);
  if (i < 0) list.push(item); else list.splice(i + 1, 0, item);
}
function removeSubtrees(d, roots) {
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop();
    if (!own(d.nodes, id)) continue;
    const n = d.nodes[id];
    if (CONTAINERS.has(n.type) && Array.isArray(n.children)) stack.push(...n.children);
    delete d.nodes[id];
  }
}

const APPLY = {
  set(d, op) {
    const pi = pageIndex(d, op.id);
    if (pi >= 0) {
      if (op.prop !== 'name') return 'prop';
      if (SIMPLE.name(op.value)) return 'value';
      d.pages[pi].name = op.value;
      return null;
    }
    if (!own(d.nodes, op.id)) return 'missing';
    return setProp(d, d.nodes[op.id], op.prop, op.value);
  },
  add(d, op) {
    const nd = op.node;
    if (nd.type === 'page') {
      if (nd.parent !== null) return 'parent';
      if (own(d.nodes, nd.id)) return 'exists';
      for (const k of Object.keys(nd)) if (!['id', 'type', 'parent', 'name'].includes(k)) return 'prop';
      if (SIMPLE.name(nd.name)) return 'value';
      const pi = pageIndex(d, nd.id);
      if (pi >= 0) { d.pages[pi].name = nd.name; return null; }
      insertAfter(d.pages, { id: nd.id, name: nd.name, children: [] }, op.after, (pg) => pg.id);
      return null;
    }
    if (nd.parent === null) return 'parent';
    if (pageIndex(d, nd.id) >= 0) return 'exists';
    if (own(d.nodes, nd.id)) {
      const ex = d.nodes[nd.id];
      if (ex.type !== nd.type || ex.parent !== nd.parent) return 'exists';
      for (const [path, v] of flatten(nd.type, nd)) { const why = setProp(d, ex, path, v); if (why) return why; }
      return null;
    }
    const list = childList(d, nd.parent);
    if (!list) return 'parent';
    const n = { type: nd.type, parent: nd.parent };
    if (CONTAINERS.has(nd.type)) n.children = [];
    for (const [path, v] of flatten(nd.type, nd)) { const why = setProp(d, n, path, v); if (why) return why; }
    put(d.nodes, nd.id, n);
    insertAfter(list, nd.id, op.after);
    return null;
  },
  del(d, op) {
    const pi = pageIndex(d, op.id);
    if (pi >= 0) {
      const [pg] = d.pages.splice(pi, 1);
      removeSubtrees(d, pg.children);
      return null;
    }
    if (!own(d.nodes, op.id)) return null;
    const list = childList(d, d.nodes[op.id].parent);
    if (list) { const i = list.indexOf(op.id); if (i >= 0) list.splice(i, 1); }
    removeSubtrees(d, [op.id]);
    return null;
  },
  move(d, op) {
    const { id, parent, after } = op;
    const pi = pageIndex(d, id);
    if (pi >= 0) {
      if (parent !== null) return 'parent';
      const prev = pi > 0 ? d.pages[pi - 1].id : null;
      if (after === prev || after === id) return null;
      const [pg] = d.pages.splice(pi, 1);
      insertAfter(d.pages, pg, after, (x) => x.id);
      return null;
    }
    if (!own(d.nodes, id)) return 'missing';
    if (parent === null) return 'parent';
    const list = childList(d, parent);
    if (!list) return 'parent';
    // into its own subtree: walk up from the new parent (bounded, in case of a broken chain)
    let cur = parent;
    for (let steps = 0; own(d.nodes, cur) && steps <= LIMITS.nodes + 1; steps++) {
      if (cur === id) return 'cycle';
      cur = d.nodes[cur].parent;
    }
    const n = d.nodes[id];
    const old = childList(d, n.parent);
    if (old && n.parent === parent) {
      const i = old.indexOf(id);
      const prev = i > 0 ? old[i - 1] : null;
      if (after === prev || after === id) return null;
    }
    if (old) { const i = old.indexOf(id); if (i >= 0) old.splice(i, 1); }
    insertAfter(list, id, after);
    n.parent = parent;
    return null;
  },
  token(d, op) {
    const segs = op.path.split('.');
    const chain = [[d.tokens, null]];
    let g = d.tokens;
    for (const seg of segs.slice(0, -1)) {
      if (!own(g, seg)) {
        if (op.value === null) return null;
        put(g, seg, {});
      } else if (!isObj(g[seg]) || isTokenNode(g[seg])) return 'value'; // inside a token
      chain.push([g[seg], seg]);
      g = g[seg];
    }
    const last = segs[segs.length - 1];
    const cur = own(g, last) ? g[last] : undefined;
    if (cur !== undefined && !isTokenNode(cur)) return 'value'; // a group
    if (op.value === null) {
      if (cur === undefined) return null;
      delete g[last];
      for (let i = chain.length - 1; i >= 1; i--) if (Object.keys(chain[i][0]).length === 0) delete chain[i - 1][0][chain[i][1]];
      return null;
    }
    if (tokenProblem(op.value)) return 'value';
    put(g, last, structuredClone(op.value));
    return null;
  },
};

// The spec's whole-edit judgement: each op's own checks in order against the running copy, then
// validate on the end state. Applied: a new document at rev + 1, why null. Refused: the same document
// and the refusal code.
// `maxOpsBytes` bounds the ops as JSON: a page's edit by `editOpsBytes` (the default); null for a local
// apply, which its body bounds instead (§7).
// Beyond the fake: a `doc` that fails the shape rules is refused `shape` (after `view` and the ops' own
// `shape`, before the ops' bytes) where the fake would throw; and `images` may be an array (it reaches
// the rules only through `validate`, which makes it a Set).
export function apply(doc, ops, { images = null, folderBytes = 0, level = 'full', maxOpsBytes = LIMITS.editOpsBytes } = {}) {
  const no = (why) => ({ doc, why });
  if (level !== 'full') return no('view');
  if (!Array.isArray(ops) || ops.length === 0) return no('shape');
  if (!shapeOk(doc)) return no('shape');
  if (maxOpsBytes !== null && Buffer.byteLength(JSON.stringify(ops)) > maxOpsBytes) return no('limit');
  const d = structuredClone(doc);
  for (const op of ops) {
    if (opErrors(op).length) return no('shape');
    const why = APPLY[op.op](d, op);
    if (why) return no(why);
  }
  d.rev = doc.rev + 1;
  const errs = validate(d, { images, folderBytes });
  if (errs.length) return no(errs[0].code);
  return { doc: d, why: null };
}
