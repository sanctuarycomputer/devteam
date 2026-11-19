// The canvas module: contract canvas-doc@1 (test/contracts/canvas.md §2, §4, §6, §7) as production
// code. `validate(doc, { images, folderBytes })` lists every way a document breaks the contract, rule by
// rule in DOC_RULES order; `apply(doc, ops, { images, folderBytes, level, maxOpsBytes })` judges an edit
// as a whole (canvas@1 §4) and gives the new document at rev + 1, or the same document and the refusal
// code. Every op is idempotent. The tables (LIMITS, RANGES, TYPES, PROPS, CLASSES, TOKEN_TYPES,
// DOC_RULES, OPS, REFUSALS) are frozen and are the ones the next canvas tickets read; so are
// `opErrors(op)` (an op's own shape, nothing that needs a document) and `NODE_ID_RE`, kit-internal
// helpers for the merge and the CLI, held to the fake through `apply`. `resolve(doc, instanceId)` gives
// an instance's descendants with their effective values (§2's resolution order), a port of the fake's
// held to it by test/canvas-static-page.test.mjs. `merge(base, copy, now)` merges the supervisor's
// working copy three ways against the base it checked out, into ops that apply to the canvas as it is
// now (`canvas take`), and `normalDoc(doc)` gives a document by effective value; both held by
// test/canvas-merge.test.mjs.
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
// The control characters free text refuses: every C0 but tab, line feed and carriage return, DEL and every C1 (kit-312).
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const textOf = (v, max) => {
  if (typeof v !== 'string') return 'not a string';
  if (!wellFormed(v)) return 'a lone surrogate';
  if (CONTROL_RE.test(v)) return 'a control character';
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

// A node key holding a dot: a property is stored nested, never flat (kit-312); only an override's keys are flat.
const DOTTED_MESSAGE = 'a dotted key (a property is stored nested: "layout": { "mode": … })';

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
      if (k.includes('.')) { add('keys', `${w}.${k}`, DOTTED_MESSAGE); continue; }
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
    // one at a time: a spread of a huge children list (a hand-edited file) would overflow the call stack
    if (CONTAINERS.has(n.type) && Array.isArray(n.children)) for (const c of n.children) stack.push(c);
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

// ---- resolve: an instance's tree, five levels (the fake's resolve) ----

// For each descendant of the instance's component: every plain property's value as the instance shows
// it (contract §2's order). Base (the node's value, else its default), then a prop's default aimed at
// it, then the chosen variant's override, then the instance's override, then the instance's prop value
// aimed at it. Throws when `instanceId` is not an instance or its component is not a component.
export function resolve(doc, instanceId) {
  const nodes = doc.nodes;
  const inst = ownGet(nodes, instanceId);
  if (!isObj(inst) || inst.type !== 'instance') throw new Error(`resolve: ${instanceId} is not an instance`);
  const comp = ownGet(nodes, inst.component);
  if (!isObj(comp) || comp.type !== 'component') throw new Error(`resolve: ${inst.component} is not a component`);
  const out = {};
  const stack = [...comp.children].reverse();
  while (stack.length) {
    const id = stack.pop();
    if (own(out, id)) continue;
    const n = ownGet(nodes, id);
    if (!isObj(n) || !TYPES.includes(n.type)) continue;
    const vals = {};
    for (const path of PLAIN[n.type]) {
      if (path === 'props' || path === 'variants' || path === 'overrides') continue;
      let v = getPath(n, path);
      if (v === undefined) v = PROPS[n.type][path].default;
      if (v !== undefined) vals[path] = structuredClone(v);
    }
    put(out, id, vals);
    if (CONTAINERS.has(n.type)) for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
  }
  const props = isObj(comp.props) ? comp.props : {};
  const set = (id, prop, v) => { if (own(out, id)) put(out[id], prop, structuredClone(v)); };
  for (const pd of Object.values(props)) if (isObj(pd) && isObj(pd.target)) set(pd.target.id, pd.target.prop, pd.default);
  const variant = typeof inst.variant === 'string' && isObj(comp.variants) ? ownGet(comp.variants, inst.variant) : null;
  if (isObj(variant)) for (const [id, o] of Object.entries(variant)) for (const [prop, v] of Object.entries(o)) set(id, prop, v);
  if (isObj(inst.overrides)) for (const [id, o] of Object.entries(inst.overrides)) for (const [prop, v] of Object.entries(o)) set(id, prop, v);
  if (isObj(inst.props)) {
    for (const [name, v] of Object.entries(inst.props)) {
      const pd = ownGet(props, name);
      if (isObj(pd) && isObj(pd.target)) set(pd.target.id, pd.target.prop, v);
    }
  }
  return out;
}

// ---- merge: a copy three ways against its base (kit-653) ----

// A value as canonical JSON (object keys sorted), so two values compare equal whatever their key order.
// Only ever called on values of a validated document, whose nesting is bounded by its classes.
function canon(v) {
  return JSON.stringify(v, (_k, x) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
}
const same = (a, b) => (a === undefined || b === undefined ? a === b : canon(a) === canon(b));
const MAPS = ['props', 'variants', 'overrides'];

// A plain path's keys, split once (the merge walks every path of every node).
const KEYS = new Map();
const keysOfPath = (path) => { let k = KEYS.get(path); if (!k) { k = path.split('.'); KEYS.set(path, k); } return k; };
function valueAt(n, path) {
  let v = n;
  for (const seg of keysOfPath(path)) { if (!isObj(v) || !own(v, seg)) return undefined; v = v[seg]; }
  return v;
}
function deletePath(n, path) {
  const keys = keysOfPath(path);
  let at = n;
  for (const k of keys.slice(0, -1)) { if (!isObj(ownGet(at, k))) return; at = at[k]; }
  delete at[keys[keys.length - 1]];
}

// The document by effective value (spec "The normal form"): `rev` 0; on every node each stored
// property equal to its default dropped, then each group (`layout`, `size`), override id map
// (`overrides.<id>`, `variants.<name>.<id>`) and map (`props`, `variants`, `overrides`) left empty.
// Two documents with the same normal form show the same canvas, and ops can't tell them apart (a
// `set` can't remove a property that has a default). Takes a document that passes the shape rules.
export function normalDoc(doc) {
  const d = structuredClone(doc);
  d.rev = 0;
  for (const id of Object.keys(d.nodes)) {
    const n = d.nodes[id];
    for (const p of PLAIN[n.type]) {
      const def = PROPS[n.type][p].default;
      if (def === undefined) continue;
      const v = valueAt(n, p);
      if (v !== undefined && same(v, def)) deletePath(n, p);
    }
    for (const g of GROUPS[n.type]) if (isObj(ownGet(n, g)) && Object.keys(n[g]).length === 0) delete n[g];
    const idMaps = [];
    if (isObj(ownGet(n, 'overrides')) && n.type === 'instance') idMaps.push(n.overrides);
    if (isObj(ownGet(n, 'variants')) && n.type === 'component') for (const v of Object.values(n.variants)) if (isObj(v)) idMaps.push(v);
    for (const m of idMaps) for (const k of Object.keys(m)) if (isObj(m[k]) && Object.keys(m[k]).length === 0) delete m[k];
    for (const m of MAPS) if (isObj(ownGet(n, m)) && Object.keys(n[m]).length === 0 && PROPS[n.type][m]) delete n[m];
  }
  return d;
}

// The `set`s that make node `b` into node `c` (both of `type`, from normal forms): plain properties at
// their paths, map entries never a whole map (spec step 5). A property `c` lacks gets its default, or
// null when it has none (which removes it).
function propDiffs(type, b, c) {
  const out = [];
  const T = PROPS[type];
  const fill = (p, cv, def) => (cv !== undefined ? cv : def !== undefined ? def : null);
  for (const p of PLAIN[type]) {
    if (MAPS.includes(p)) continue;
    const bv = valueAt(b, p), cv = valueAt(c, p);
    if (!same(bv, cv)) out.push([p, fill(p, cv, T[p].default)]);
  }
  const mapOf = (n, k) => (isObj(ownGet(n, k)) ? n[k] : {});
  const keysOf = (...objs) => [...new Set(objs.flatMap((o) => (isObj(o) ? Object.keys(o) : [])))];
  if (own(T, 'props.<name>')) {
    const bm = mapOf(b, 'props'), cm = mapOf(c, 'props');
    for (const k of keysOf(bm, cm)) if (!same(ownGet(bm, k), ownGet(cm, k))) out.push([`props.${k}`, fill(null, ownGet(cm, k))]);
  }
  // { id: { prop: value } } entries under `prefix`
  const idEntries = (prefix, bm, cm) => {
    for (const id of keysOf(bm, cm)) {
      const bo = ownGet(bm, id), co = ownGet(cm, id);
      for (const p of keysOf(bo, co)) if (!same(ownGet(bo, p), ownGet(co, p))) out.push([`${prefix}${id}.${p}`, fill(null, ownGet(co, p))]);
    }
  };
  if (own(T, 'overrides.<id>.<prop>')) idEntries('overrides.', mapOf(b, 'overrides'), mapOf(c, 'overrides'));
  if (own(T, 'variants.<name>')) {
    const bm = mapOf(b, 'variants'), cm = mapOf(c, 'variants');
    for (const name of keysOf(bm, cm)) {
      const bv = ownGet(bm, name), cv = ownGet(cm, name);
      if (cv === undefined) out.push([`variants.${name}`, null]);
      else if (bv === undefined) out.push([`variants.${name}`, cv]);
      else idEntries(`variants.${name}.`, bv, cv);
    }
  }
  return out;
}

// Token path → token, for every token in a token tree (own keys, an explicit stack).
function tokenLeaves(tokens) {
  const out = new Map();
  const stack = [[tokens, '']];
  while (stack.length) {
    const [g, prefix] = stack.pop();
    for (const k of Object.keys(g)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (isTokenNode(g[k])) out.set(p, g[k]);
      else if (isObj(g[k])) stack.push([g[k], p]);
    }
  }
  return out;
}

function parseDoc(x, who) {
  if (typeof x !== 'string') return { doc: x };
  try { return { doc: JSON.parse(x) }; } catch (e) { return { why: `the ${who} does not parse: ${e.message}` }; }
}
// An id's kind in a shape-valid document: 'page', a node type, or undefined.
function kindOf(doc, id) {
  if (doc.pages.some((pg) => pg.id === id)) return 'page';
  return isObj(ownGet(doc.nodes, id)) ? doc.nodes[id].type : undefined;
}

// The supervisor's working copy merged three ways (spec project/tickets/kit-653-canvas-merge/spec.md):
// what `copy` changed from `base` (by normal form), as canvas@1 ops that apply to `now`, the canvas as
// it is now, so a person's edit to anything the copy didn't change survives. `base` and `copy` may be
// JSON text. → { ops, skipped, refused }: refused null and the ops, with `skipped` the copy's changes a
// person's edit since made impossible ({ id | path, why }); or ops [] and refused { reason, errors }.
// `images`, `folderBytes`: as validate's, for judging the copy. Pure; never throws for any base or copy.
export function merge(base, copy, now, { images = null, folderBytes = 0 } = {}) {
  const refuse = (reason, errors = []) => ({ ops: [], skipped: [], refused: { reason, errors } });
  const judged = (x, who, opts) => {
    const p = parseDoc(x, who);
    if (p.why) return { why: refuse(p.why) };
    let errors;
    // What no document is (a cycle, nesting too deep to write as JSON) is a refusal too, found by
    // writing it before validate walks it (validate's token walk would never end on a cycle)
    try {
      if (typeof x !== 'string') JSON.stringify(p.doc);
      errors = validate(p.doc, opts);
    } catch (e) {
      return { why: refuse(`the ${who} breaks canvas-doc@1: ${String(e && e.message).split('\n')[0]}`) };
    }
    if (errors.length) {
      const e = errors[0];
      return { why: refuse(`the ${who} breaks canvas-doc@1: ${e.rule} at ${e.where}: ${e.message}`, errors) };
    }
    return { doc: p.doc };
  };
  const jb = judged(base, 'base', { images: null, folderBytes: 0 });
  if (jb.why) return jb.why;
  const jc = judged(copy, 'copy', { images, folderBytes });
  if (jc.why) return jc.why;
  if (!shapeOk(now)) return refuse('the live canvas is malformed');
  const b = jb.doc, c = jc.doc;
  for (const id of [...b.pages.map((pg) => pg.id), ...Object.keys(b.nodes)]) {
    const kb = kindOf(b, id), kc = kindOf(c, id);
    if (kc !== undefined && kc !== kb) return refuse(`node ${id} changed type from ${kb} to ${kc}: give the new node a new id`);
  }
  const nb = normalDoc(b), nc = normalDoc(c);

  const ops = [];
  const skipped = [];
  const seenSkip = new Set();
  const skip = (key, value, why) => {
    const k = `${key}:${value}:${why}`;
    if (!seenSkip.has(k)) { seenSkip.add(k); skipped.push({ [key]: value, why }); }
  };
  // 1. tokens: removals deepest first, then additions and changes in path order, each judged on a
  // model of now's tokens as APPLY.token judges it
  const tb = tokenLeaves(nb.tokens), tc = tokenLeaves(nc.tokens);
  const tmodel = { tokens: structuredClone(now.tokens) };
  const depth = (p) => p.split('.').length;
  const removals = [...tb.keys()].filter((p) => !tc.has(p)).sort((x, y) => depth(y) - depth(x) || (x < y ? -1 : x > y ? 1 : 0));
  const additions = [...tc.keys()].filter((p) => !tb.has(p) || !same(tb.get(p), tc.get(p))).sort();
  // What the model holds at a path: 'token', 'group', or undefined (nothing, or a token on the way).
  const tokenAt = (path) => {
    let g = tmodel.tokens;
    for (const seg of path.split('.')) {
      if (!isObj(g) || isTokenNode(g) || !own(g, seg)) return undefined;
      g = g[seg];
    }
    return isTokenNode(g) ? 'token' : isObj(g) ? 'group' : undefined;
  };
  for (const [p, value] of [...removals.map((p) => [p, null]), ...additions.map((p) => [p, tc.get(p)])]) {
    // a removal of a token that isn't there (a person removed it or made it a group, or a second
    // `take` after the copy made it a group) is nothing to do
    if (value === null && tokenAt(p) !== 'token') continue;
    const op = { op: 'token', path: p, value: value === null ? null : structuredClone(value) };
    if (APPLY.token(tmodel, op)) skip('path', p, 'token-conflict');
    else ops.push(op);
  }

  // The model of now's tree, updated op by op as APPLY updates the document: each id's kind and
  // parent ('#pages' for a page), and each page's, container's and the pages' list as a doubly linked
  // list (`head`/`tail` per list, `prev`/`next` per id; an id is in one list), so placing, moving and
  // finding a neighbour cost the same on a 20000-child list as on a short one. `now` is never touched.
  const PAGES = '#pages';
  const kind = new Map(), parentOf = new Map();
  const head = new Map(), tail = new Map(), prev = new Map(), next = new Map();
  const linkLast = (P, id) => {
    const t = tail.get(P);
    prev.set(id, t); next.set(id, null);
    if (t === null) head.set(P, id); else next.set(t, id);
    tail.set(P, id);
  };
  const newList = (P, ids) => { head.set(P, null); tail.set(P, null); for (const id of ids) linkLast(P, id); };
  const unlink = (P, id) => {
    if (!prev.has(id)) return;
    const p = prev.get(id), n = next.get(id);
    if (p === null) head.set(P, n); else next.set(p, n);
    if (n === null) tail.set(P, p); else prev.set(n, p);
    prev.delete(id); next.delete(id);
  };
  const childrenOf = (P) => { const out = []; for (let x = head.get(P); x !== null && x !== undefined; x = next.get(x)) out.push(x); return out; };
  newList(PAGES, now.pages.map((pg) => pg.id));
  for (const pg of now.pages) { kind.set(pg.id, 'page'); parentOf.set(pg.id, PAGES); }
  for (const id of Object.keys(now.nodes)) { kind.set(id, now.nodes[id].type); parentOf.set(id, now.nodes[id].parent); }
  for (const pg of now.pages) newList(pg.id, Array.isArray(pg.children) ? pg.children : []);
  for (const id of Object.keys(now.nodes)) if (CONTAINERS.has(now.nodes[id].type)) newList(id, Array.isArray(now.nodes[id].children) ? now.nodes[id].children : []);
  const has = (id) => kind.has(id);
  const hasList = (P) => head.has(P);
  // insertAfter's rule on P's list: first for null, after `at` when it is in the list, else last
  const place = (P, id, at) => {
    if (at === null) {
      const h = head.get(P);
      prev.set(id, null); next.set(id, h);
      if (h === null) tail.set(P, id); else prev.set(h, id);
      head.set(P, id);
    } else if (parentOf.get(at) === P && prev.has(at) && at !== id) {
      const n = next.get(at);
      prev.set(id, at); next.set(id, n); next.set(at, id);
      if (n === null) tail.set(P, id); else prev.set(n, id);
    } else linkLast(P, id);
  };
  const modelAdd = (id, type, parent, at) => {
    if (has(id)) return; // an add of an existing id (same type and parent) is its properties as sets
    kind.set(id, type);
    if (type === 'page' || CONTAINERS.has(type)) newList(id, []);
    place(parent, id, at);
    parentOf.set(id, parent);
  };
  const modelMove = (id, parent, at) => {
    const old = parentOf.get(id);
    if (old === parent && (at === (prev.has(id) ? prev.get(id) : null) || at === id)) return; // where it is
    unlink(old, id);
    parentOf.set(id, undefined); // so `place` doesn't read it as its own anchor's list
    place(parent, id, at);
    parentOf.set(id, parent);
  };
  const modelDel = (id) => {
    unlink(parentOf.get(id), id);
    const stack = [id];
    while (stack.length) {
      const x = stack.pop();
      if (hasList(x)) { for (const k of childrenOf(x)) stack.push(k); head.delete(x); tail.delete(x); }
      kind.delete(x); parentOf.delete(x); prev.delete(x); next.delete(x);
    }
  };
  // Would moving `id` under `parent` put it inside its own subtree?
  const cycles = (id, parent) => {
    let cur = parent;
    for (let steps = 0; cur !== undefined && cur !== PAGES && steps <= LIMITS.nodes + 1; steps++) {
      if (cur === id) return true;
      cur = parentOf.get(cur);
    }
    return false;
  };
  // A move, unless the id is already there (as on a second `take`), which would be an op that changes nothing.
  const emitMove = (id, parent, at) => {
    if (parentOf.get(id) === parent && (prev.get(id) === at || at === id)) return;
    ops.push({ op: 'move', id, parent: parent === PAGES ? null : parent, after: at });
    modelMove(id, parent, at);
  };

  const bPage = new Map(nb.pages.map((pg) => [pg.id, pg]));
  const cPage = new Map(nc.pages.map((pg) => [pg.id, pg]));
  const inBase = (id) => bPage.has(id) || own(nb.nodes, id);
  const baseList = (P) => (P === PAGES ? nb.pages.map((pg) => pg.id) : bPage.has(P) ? bPage.get(P).children : isObj(ownGet(nb.nodes, P)) && Array.isArray(nb.nodes[P].children) ? nb.nodes[P].children : []);
  const parentInCopy = (id) => (cPage.has(id) ? PAGES : nc.nodes[id].parent);
  const copyList = (P) => (P === PAGES ? nc.pages.map((pg) => pg.id) : cPage.has(P) ? cPage.get(P).children : nc.nodes[P].children);

  // In the base and not in the copy: step 6 deletes it.
  const doomed = (id) => inBase(id) && !(cPage.has(id) || own(nc.nodes, id));
  // Where an id goes in list P (spec step 3): after the nearest settled id to its left in C, else
  // right before the nearest kept id to its right in C that is in P's list, else first. "Right before"
  // is after its nearest predecessor that stays put: not one step 6 deletes nor one of this list's ids
  // still to be placed (`pending`), so the op places the same when `take` runs again.
  const anchor = (P, leftSettled, C, from, keep, pending) => {
    if (leftSettled !== null) return leftSettled;
    for (let j = from + 1; j < C.length; j++) {
      const r = C[j];
      if (keep.has(r) && parentOf.get(r) === P) {
        let p = prev.get(r);
        while (p !== null && (doomed(p) || pending.has(p))) p = prev.get(p);
        return p;
      }
    }
    return null;
  };

  // One list: C (the copy's) against B (the base's), on P's list in the model.
  const mergeList = (P, B, C) => {
    const bpos = new Map(B.map((id, i) => [id, i]));
    const common = C.filter((id) => bpos.has(id));
    const keep = lisKeep(common.map((id) => bpos.get(id)), common);
    const pending = new Set(C.filter((id) => !keep.has(id)));
    let left = null;
    for (let i = 0; i < C.length; i++) {
      const x = C[i];
      if (keep.has(x)) { if (parentOf.get(x) === P) left = x; continue; }
      pending.delete(x);
      if (!hasList(P)) { skip('id', x, 'parent-deleted'); continue; }
      if (!inBase(x)) {
        const at = anchor(P, left, C, i, keep, pending);
        // already there (`take` run again after its ops applied): an add of an existing id only sets
        // its properties, so put it in its place first
        if (has(x) && at !== x && (parentOf.get(x) !== P || prev.get(x) !== at)) {
          if (P !== PAGES && cycles(x, P)) { skip('id', x, 'cycle'); continue; }
          emitMove(x, P, at);
        }
        if (P === PAGES) {
          ops.push({ op: 'add', node: { id: x, type: 'page', parent: null, name: cPage.get(x).name }, after: at });
          modelAdd(x, 'page', PAGES, at);
        } else {
          const node = { id: x };
          const cn = nc.nodes[x];
          for (const k of Object.keys(cn)) if (k !== 'children') put(node, k, structuredClone(cn[k]));
          ops.push({ op: 'add', node, after: at });
          modelAdd(x, cn.type, P, at);
        }
        left = x;
        continue;
      }
      if (!has(x)) { skip('id', x, 'deleted'); continue; }
      if (P !== PAGES && cycles(x, P)) { skip('id', x, 'cycle'); continue; }
      emitMove(x, P, anchor(P, left, C, i, keep, pending));
      left = x;
    }
  };

  // 2. pages: the pages list (adds and moves), then names
  mergeList(PAGES, baseList(PAGES), copyList(PAGES));
  for (const pg of nc.pages) {
    const bp = bPage.get(pg.id);
    if (!bp || bp.name === pg.name) continue;
    if (has(pg.id)) ops.push({ op: 'set', id: pg.id, prop: 'name', value: pg.name });
    else skip('id', pg.id, 'deleted');
  }

  // 3. children lists, top-down in the copy's breadth-first order
  const order = [];
  const queue = nc.pages.map((pg) => pg.id);
  for (let qi = 0; qi < queue.length; qi++) {
    const P = queue[qi];
    const C = copyList(P);
    mergeList(P, baseList(P), C);
    for (const id of C) { order.push(id); if (CONTAINERS.has(nc.nodes[id].type)) queue.push(id); }
  }

  // 4. kept nodes under something step 6 deletes: back to their copy parent
  for (const id of order) {
    if (!has(id)) continue;
    let under = false;
    let cur = parentOf.get(id);
    for (let steps = 0; cur !== undefined && cur !== PAGES && steps <= LIMITS.nodes + 1; steps++) {
      if (doomed(cur)) { under = true; break; }
      cur = parentOf.get(cur);
    }
    if (!under) continue;
    const P = parentInCopy(id);
    if (!hasList(P)) { skip('id', id, 'parent-deleted'); continue; }
    if (cycles(id, P)) { skip('id', id, 'cycle'); continue; }
    const C = copyList(P);
    const i = C.indexOf(id);
    let left = null;
    for (let j = i - 1; j >= 0; j--) if (parentOf.get(C[j]) === P) { left = C[j]; break; }
    emitMove(id, P, anchor(P, left, C, i, new Set(C.filter((x) => parentOf.get(x) === P)), new Set()));
  }

  // 5. properties
  for (const id of Object.keys(nc.nodes)) {
    if (!own(nb.nodes, id)) continue;
    const diffs = propDiffs(nc.nodes[id].type, nb.nodes[id], nc.nodes[id]);
    if (!diffs.length) continue;
    if (!has(id)) { skip('id', id, 'deleted'); continue; }
    for (const [prop, value] of diffs) ops.push({ op: 'set', id, prop, value: structuredClone(value) });
  }

  // 6. deletions: nodes in the base's breadth-first order, then pages
  const bq = nb.pages.flatMap((pg) => pg.children);
  for (let qi = 0; qi < bq.length; qi++) {
    const id = bq[qi];
    const n = nb.nodes[id];
    if (CONTAINERS.has(n.type)) for (const k of n.children) bq.push(k);
    if (own(nc.nodes, id) || !has(id)) continue;
    ops.push({ op: 'del', id });
    modelDel(id);
  }
  for (const pg of nb.pages) {
    if (cPage.has(pg.id) || !has(pg.id)) continue;
    ops.push({ op: 'del', id: pg.id });
    modelDel(pg.id);
  }
  return { ops, skipped, refused: null };
}

// The ids of a longest increasing subsequence of `seq` (distinct numbers, one per id in `ids`), by the
// patience method: for each in order, replace the first tail not below it, else append; then walk back
// from the last tail's predecessor links. O(n log n).
function lisKeep(seq, ids) {
  const tails = [], tailIdx = [], prev = new Array(seq.length);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (tails[m] < seq[i]) lo = m + 1; else hi = m; }
    prev[i] = lo > 0 ? tailIdx[lo - 1] : -1;
    tails[lo] = seq[i];
    tailIdx[lo] = i;
  }
  const keep = new Set();
  for (let k = tailIdx.length ? tailIdx[tailIdx.length - 1] : -1; k >= 0; k = prev[k]) keep.add(ids[k]);
  return keep;
}

// ---- staticPage: the first page as a static, escaped HTML page ----

// The most elements instances may expand to on one page (the cap is applied by the walk below).
export const STATIC_MAX_ELEMENTS = 100000;
// The length of page body past which no further instance is expanded (half the artifact check's 8 MB).
export const STATIC_MAX_CHARS = 4000000;
// The page's one style block: resets only, nothing from the document.
export const STATIC_STYLE = '*{box-sizing:border-box;margin:0;padding:0}html,body{min-height:100%}body{font-family:sans-serif}main{position:relative;min-height:100vh}img,svg{display:block}';
// The page's one comment.
export const STATIC_COMMENT = '<!-- Generated by the devteam kit from canvas.json: edit it in the canvas, not by hand. -->';
const VIEWPORT = 'width=device-width, initial-scale=1';

// The one escape, for element text and every attribute value alike.
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const attr = (name, value) => ` ${name}="${escHtml(value)}"`;

const FAMILY_CSS = { sans: 'sans-serif', serif: 'serif', mono: 'monospace' };
const ALIGN_CSS = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' };
const JUSTIFY_CSS = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between' };
const isRef = (v) => isObj(v) && own(v, '$ref');

// Checked values to CSS, with `$ref`s resolved against the document's tokens (a valid document's
// refs all resolve to a token of the right type).
function cssOf(tokens) {
  const token = (path) => {
    let v = tokens;
    for (const seg of path.split('.')) v = ownGet(v, seg);
    return v.$value;
  };
  const number = (v) => (isRef(v) ? token(v.$ref) : v); // fontWeight, number
  const len = (v) => (isRef(v) ? token(v.$ref).value : v); // dim, len: a number of px
  const px = (v) => `${String(len(v))}px`;
  const color = (v) => {
    if (!isRef(v)) return v;
    const t = token(v.$ref);
    const [r, g, b] = t.components.map((c) => Math.round(c * 255));
    return `rgb(${r} ${g} ${b} / ${String(own(t, 'alpha') ? t.alpha : 1)})`;
  };
  const family = (v) => FAMILY_CSS[isRef(v) ? token(v.$ref) : v];
  const track = (t) => (typeof t === 'number' ? `${String(t)}px` : t);
  return { token, number, len, px, color, family, track };
}

// A node's own values as `resolve` gives a descendant's: every plain property path, its default when
// absent (the wiring of a component or instance aside).
function ownValues(n) {
  const vals = {};
  for (const path of PLAIN[n.type]) {
    if (path === 'props' || path === 'variants' || path === 'overrides') continue;
    let v = getPath(n, path);
    if (v === undefined) v = PROPS[n.type][path].default;
    if (v !== undefined) vals[path] = v;
  }
  return vals;
}

// The declarations every node takes: position, size, opacity, visibility. `pm` is the parent's layout
// mode ('page' for the page). `sizeAsAttrs` (a vector) leaves numeric sizes to the svg's attributes.
function commonDecls(css, v, pm, sizeAsAttrs) {
  const out = [];
  if (pm === 'page' || pm === 'none') out.push(['position', 'absolute'], ['left', css.px(v.x)], ['top', css.px(v.y)]);
  for (const [axis, prop] of [['w', 'width'], ['h', 'height']]) {
    const s = v[`size.${axis}`];
    if (s === 'hug') continue;
    if (s === 'fill') {
      if (pm === 'page' || pm === 'none') out.push([prop, '100%']);
      else if (pm === 'row') out.push(axis === 'w' ? ['flex', '1 1 0'] : ['align-self', 'stretch']);
      else if (pm === 'column') out.push(axis === 'h' ? ['flex', '1 1 0'] : ['align-self', 'stretch']);
      continue; // a grid cell stretches by default
    }
    if (!sizeAsAttrs) out.push([prop, css.px(s)]);
  }
  if (v.opacity !== 1) out.push(['opacity', String(v.opacity)]);
  if (v.visible === false) out.push(['display', 'none']);
  return out;
}
// fill, stroke (a solid border when both are set and the width is above 0).
function paintDecls(css, v) {
  const out = [];
  if (v.fill !== null) out.push(['background-color', css.color(v.fill)]);
  if (v.stroke !== null && css.len(v.strokeWidth) > 0) out.push(['border', `${css.px(v.strokeWidth)} solid ${css.color(v.stroke)}`]);
  return out;
}
const radiusDecls = (css, v) => (css.len(v.radius) !== 0 ? [['border-radius', css.px(v.radius)]] : []);
// A frame's or component's box (an instance's from its component root): layout, paint, radius, clip.
// `absolute` and `hidden` come from the node's own common declarations, which hold that position and display.
function boxDecls(css, v, absolute, hidden) {
  const out = [];
  const mode = v['layout.mode'];
  if (mode === 'row' || mode === 'column') {
    if (!hidden) out.push(['display', 'flex']);
    out.push(['flex-direction', mode]);
    if (v['layout.wrap']) out.push(['flex-wrap', 'wrap']);
    out.push(['gap', css.px(v['layout.gap'])], ['padding', v['layout.padding'].map(css.px).join(' ')]);
    out.push(['align-items', ALIGN_CSS[v['layout.align']]], ['justify-content', JUSTIFY_CSS[v['layout.justify']]]);
  } else if (mode === 'grid') {
    if (!hidden) out.push(['display', 'grid']);
    out.push(['gap', css.px(v['layout.gap'])], ['padding', v['layout.padding'].map(css.px).join(' ')]);
    if (v['layout.columns'].length) out.push(['grid-template-columns', v['layout.columns'].map(css.track).join(' ')]);
    if (v['layout.rows'].length) out.push(['grid-template-rows', v['layout.rows'].map(css.track).join(' ')]);
  } else if (!absolute) out.push(['position', 'relative']);
  out.push(...paintDecls(css, v), ...radiusDecls(css, v));
  if (v.clip) out.push(['overflow', 'hidden']);
  return out;
}
function textDecls(css, v) {
  const out = [['white-space', 'pre-wrap']];
  const f = v.font;
  if (isRef(f)) {
    const t = css.token(f.$ref);
    out.push(['font-family', FAMILY_CSS[t.fontFamily]], ['font-size', `${String(t.fontSize.value)}px`], ['font-weight', String(t.fontWeight)]);
    out.push(['line-height', String(t.lineHeight)], ['letter-spacing', `${String(t.letterSpacing.value)}px`]);
  } else {
    out.push(['font-family', css.family(f.family)], ['font-size', css.px(f.size)], ['font-weight', String(css.number(f.weight))]);
    out.push(['line-height', String(css.number(f.lineHeight))]);
  }
  out.push(['color', css.color(v.color)], ['text-align', v.align]);
  return out;
}
const styleAttr = (decls) => (decls.length ? attr('style', decls.map(([k, x]) => `${k}:${x}`).join(';')) : '');
const nodeAttrs = (id, type, name) => `${attr('data-node', id)}${attr('data-type', type)}${name !== '' ? attr('data-name', name) : ''}`;

// The elements a node writes itself: a vector its <svg> and <path>, any other node one.
const ownElements = (n) => (n.type === 'vector' ? 2 : 1);

// Each component's expanded element count: the elements its descendants write (its root is the
// instance's box, so not counted), each instance among them counting 1 plus its own component's count.
// Worked in dependency order (Kahn's algorithm over component -> the components it instances, acyclic
// by the instance-cycle rule), no recursion, saturating at STATIC_MAX_ELEMENTS + 1. A component left
// over (none in a valid document) counts as over the cap.
function expandedSizes(nodes) {
  const over = STATIC_MAX_ELEMENTS + 1;
  const base = new Map(); // component -> elements of its non-instance descendants and instance boxes
  const uses = new Map(); // component -> component ids it instances, once per instance
  for (const [id, n] of Object.entries(nodes)) {
    if (n.type !== 'component') continue;
    let count = 0;
    const used = [];
    const stack = [...n.children];
    while (stack.length) {
      const d = nodes[stack.pop()];
      count += ownElements(d);
      if (d.type === 'instance') used.push(d.component);
      else if (Array.isArray(d.children)) stack.push(...d.children);
    }
    base.set(id, count);
    uses.set(id, used);
  }
  const waiting = new Map(); // component -> how many distinct components it instances are not yet sized
  const usedBy = new Map(); // component -> the components that instance it
  for (const [id, used] of uses) {
    const distinct = new Set(used);
    waiting.set(id, distinct.size);
    for (const c of distinct) {
      if (!usedBy.has(c)) usedBy.set(c, []);
      usedBy.get(c).push(id);
    }
  }
  const size = new Map();
  const ready = [...waiting].filter(([, w]) => w === 0).map(([id]) => id);
  while (ready.length) {
    const id = ready.pop();
    let s = base.get(id);
    for (const c of uses.get(id)) s = Math.min(over, s + size.get(c));
    size.set(id, Math.min(over, s));
    for (const p of usedBy.get(id) || []) {
      waiting.set(p, waiting.get(p) - 1);
      if (waiting.get(p) === 0) ready.push(p);
    }
  }
  for (const id of uses.keys()) if (!size.has(id)) size.set(id, over);
  return size;
}

// The first page of a valid canvas-doc@1 document as a static HTML page: no script, every free text
// escaped, every style from checked values. `{ ok: true, html }`, or `{ ok: false, errors }` (the
// `validate` list, file check skipped) for a document that isn't valid. The same document gives the
// same bytes. An explicit stack of open items ({ id, inst, pm }: a node, the `resolve` map of the
// instance it shows inside (null outside one) and its parent's layout mode) and close items
// ({ close: tag }); an instance opens as its component root's box and pushes its component's children
// with its own `resolve` map. A node's values are its entry in `inst`, or its own outside an instance.
// The cap: the count starts at every element written outside instances, and an instance there whose
// expansion would take it past STATIC_MAX_ELEMENTS is cut (its own empty box, `data-cut="true"`), so
// the page body holds at most STATIC_MAX_ELEMENTS elements, or the outside elements alone when more.
// And the length cap: any instance, nested ones included, reached once the body written so far is at or
// past STATIC_MAX_CHARS is cut too, so long paths or texts repeated through instances can't make a
// page too long for a string (the page stays within STATIC_MAX_CHARS + the page with every instance
// cut + the longest component's own tree).
export function staticPage(doc) {
  const errors = validate(doc, { images: null });
  if (errors.length) return { ok: false, errors };
  const nodes = doc.nodes;
  const css = cssOf(doc.tokens);
  const page = doc.pages[0];
  const resolved = new Map(); // instance id -> resolve(doc, id); the same wherever the instance shows
  const resolveOf = (id) => {
    if (!resolved.has(id)) resolved.set(id, resolve(doc, id));
    return resolved.get(id);
  };
  const parts = [];
  let chars = 0; // the length of the parts written so far
  const write = (s) => { parts.push(s); chars += s.length; };
  const stack = [];
  const pushChildren = (ids, inst, pm) => {
    for (let i = ids.length - 1; i >= 0; i--) stack.push({ id: ids[i], inst, pm });
  };
  const sizes = expandedSizes(nodes);
  // The count starts at every element the page writes outside instances (the first page's tree, each
  // instance there as its one box), so instances get only what is left; each instance let in adds
  // its expansion.
  let written = 0;
  for (const outside = [...page.children]; outside.length;) {
    const n = nodes[outside.pop()];
    written += ownElements(n);
    if (n.type !== 'instance' && Array.isArray(n.children)) outside.push(...n.children);
  }
  pushChildren(page.children, null, 'page');
  while (stack.length) {
    const item = stack.pop();
    if (own(item, 'close')) { write(`</${item.close}>`); continue; }
    const { id, inst, pm } = item;
    const n = nodes[id];
    const v = inst ? inst[id] : ownValues(n);
    const head = nodeAttrs(id, n.type, v.name);
    const common = commonDecls(css, v, pm, n.type === 'vector');
    const absolute = pm === 'page' || pm === 'none';
    const hidden = v.visible === false;
    switch (n.type) {
      case 'frame':
      case 'component':
        write(`<div${head}${styleAttr([...common, ...boxDecls(css, v, absolute, hidden)])}>`);
        stack.push({ close: 'div' });
        pushChildren(n.children, inst, v['layout.mode']);
        break;
      case 'instance': {
        // Its own common values (from the enclosing instance's resolve inside one), its component
        // root's box, its component's children with its own resolve.
        // The cap, outside instances only (an instance let in holds its whole expansion, already
        // counted; its box was counted with the page's outside elements): when its expansion would take
        // the count past STATIC_MAX_ELEMENTS, its own box with data-cut="true" and nothing in it.
        const comp = nodes[n.component];
        const cv = ownValues(comp);
        const box = `<div${head}${styleAttr([...common, ...boxDecls(css, cv, absolute, hidden)])}`;
        // The length cap, at every instance, nested ones included: once the page written so far is at
        // or past STATIC_MAX_CHARS, the cut box.
        if (chars >= STATIC_MAX_CHARS || (!inst && written + sizes.get(n.component) > STATIC_MAX_ELEMENTS)) {
          write(`${box}${attr('data-cut', 'true')}></div>`);
          break;
        }
        if (!inst) written += sizes.get(n.component);
        write(`${box}>`);
        stack.push({ close: 'div' });
        pushChildren(comp.children, resolveOf(id), cv['layout.mode']);
        break;
      }
      case 'rect':
        write(`<div${head}${styleAttr([...common, ...paintDecls(css, v), ...radiusDecls(css, v)])}></div>`);
        break;
      case 'ellipse':
        write(`<div${head}${styleAttr([...common, ...paintDecls(css, v), ['border-radius', '50%']])}></div>`);
        break;
      case 'text':
        write(`<div${head}${styleAttr([...common, ...textDecls(css, v)])}>${escHtml(v.text)}</div>`);
        break;
      case 'vector': {
        let size = '';
        for (const [axis, a] of [['w', 'width'], ['h', 'height']]) {
          const s = v[`size.${axis}`];
          if (s !== 'hug' && s !== 'fill') size += attr(a, String(css.len(s)));
        }
        let paint = attr('fill', v.fill === null ? 'none' : css.color(v.fill));
        if (v.stroke !== null) paint += `${attr('stroke', css.color(v.stroke))}${attr('stroke-width', String(css.len(v.strokeWidth)))}`;
        write(`<svg${head}${size}${styleAttr([...common, ['overflow', 'visible']])}><path${attr('d', v.path)}${paint}></path></svg>`);
        break;
      }
      case 'image':
        write(`<img${head}${attr('src', v.src)}${attr('alt', v.name)}${styleAttr([...common, ['object-fit', v.fit], ...radiusDecls(css, v)])}>`);
        break;
      default:
    }
  }
  const title = page.name !== '' ? page.name : page.id;
  const html = `<!doctype html>\n${STATIC_COMMENT}\n<html lang="en"><head><meta charset="utf-8"><meta${attr('name', 'viewport')}${attr('content', VIEWPORT)}>`
    + `<title>${escHtml(title)}</title><style>${STATIC_STYLE}</style></head>`
    + `<body><main${attr('data-page', page.id)}>${parts.join('')}</main></body></html>\n`;
  return { ok: true, html };
}
