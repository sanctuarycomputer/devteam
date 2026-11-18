// canvas-doc@1 and canvas@1 (test/contracts/canvas.md): the rules as code. The tables the contract's
// machine-read tables are compared with, `docErrors` (the document rules, in judgement order),
// `opErrors` and `applyEdit` (an edit judged as a whole), `resolve` (an instance's five-level order),
// `shapeErrors` (every message the socket and the routes carry), `freeTexts` (the fields hostile content
// may fill), and the canvas test-file rule (`skipProblems`, `measureProblems`) with the cases it is
// tested on. Tree walks use explicit stacks and queues, never recursion. Node built-ins only; consumes
// presence@1 through its fake's `ID_RE`, `CONN_RE`, `cutName` and `shapeErrors`.
import { ID_RE as PERSON_ID_RE, CONN_RE, cutName, shapeErrors as presenceShapeErrors } from './presence-fake.mjs';

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
export const PAGE_KINDS = Object.freeze(['edit', 'select', 'pong']);
export const SERVER_KINDS = Object.freeze(['welcome', 'ops', 'saved', 'refused', 'selections', 'paused', 'resumed', 'reload', 'closed', 'ping']);
export const HTTP_KINDS = Object.freeze(['doc-response', 'image-request', 'image-response', 'local-request', 'local-response', 'error-response']);
export const REFUSALS = Object.freeze(['shape', 'prop', 'value', 'missing', 'parent', 'exists', 'cycle', 'ref', 'limit', 'view']);
export const PAUSE_WHYS = Object.freeze(['branch-moved', 'worktree-gone', 'index-dirty']);
export const CLOSE_WHYS = Object.freeze(['landed', 'removed']);
const VIAS = ['page', 'apply', 'take'];
// The local route's own whys, beside the refusal codes.
const ROUTE_WHYS = ['no-session', 'closed'];

export const ROUTES = deepFreeze([
  { key: 'doc', method: 'GET', path: '/api/canvas/doc', fake: true },
  { key: 'image-post', method: 'POST', path: '/api/canvas/image', fake: true },
  { key: 'image-get', method: 'GET', path: '/api/canvas/image/<slug>/<file>', fake: true },
  { key: 'local', method: 'POST', path: '/api/canvas/local', fake: true },
  { key: 'import', method: 'POST', path: '/api/canvas/import', fake: true },
  { key: 'export', method: 'GET', path: '/api/canvas/export', fake: false },
  { key: 'edit', method: 'POST', path: '/api/canvas/edit', fake: false },
]);

export const NODE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const SLUG_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const CLIENT_RE = /^[0-9a-z]{16}$/;
export const SESSION_RE = /^[0-9a-z]{16}$/;
export const BY_RE = /^[A-Za-z0-9._-]{1,64}$/;
export const IMAGE_FILE_RE = /^[0-9a-f]{16}\.(png|jpg|webp|gif)$/;
const PROP_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const SEGMENT_RE = /^[A-Za-z0-9_-]{1,40}$/;
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const HEX6_RE = /^#[0-9a-fA-F]{6}$/;
const FIGMA_RE = /^[A-Za-z0-9:;_-]{1,100}$/;
const PATH_RE = /^[ ,]*[Mm][MLHVCSQTAZmlhvcsqtaz0-9.eE+\-, ]*$/;
const FR_RE = /^([1-9][0-9]{0,2})fr$/;
const SRC_RE = /^images\/([0-9a-f]{16}\.(?:png|jpg|webp|gif))$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const FAMILIES = ['sans', 'serif', 'mono'];

export const HOSTILE_MARKERS = Object.freeze([
  '<script', '</script>', '<style', '</style>', 'url(', '@import', '@font-face', 'onerror=', 'onload=', 'javascript:',
  'expression(', '"', "'", '\\', '\\(', '`', '#', '}', '\n', '](',
]);

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
const DIM_MAX = 100000;
function lenOf(v, refs) {
  if (typeof v === 'number') return num(v, 0, DIM_MAX) ? null : 'not a number in 0..100000';
  return tokenRef(v, refs, 'dimension', 0, DIM_MAX);
}
const weightOk = (v) => Number.isInteger(v) && v >= 100 && v <= 900 && v % 100 === 0;

const SIMPLE = {
  color(v, refs) {
    if (typeof v === 'string') return HEX_RE.test(v) ? null : 'not #rgb, #rrggbb or #rrggbbaa';
    return tokenRef(v, refs, 'color');
  },
  paint: (v, refs) => (v === null ? null : SIMPLE.color(v, refs)),
  dim(v, refs) {
    if (typeof v === 'number') return num(v, -DIM_MAX, DIM_MAX) ? null : 'not a number in -100000..100000';
    return tokenRef(v, refs, 'dimension', -DIM_MAX, DIM_MAX);
  },
  len: lenOf,
  opacity: (v) => (num(v, 0, 1) ? null : 'not a number in 0..1'),
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
      if (typeof x === 'number' ? !num(x, 0, DIM_MAX) : !(x === 'auto' || (typeof x === 'string' && FR_RE.test(x)))) return `a track ${JSON.stringify(x)}`;
    }
    return null;
  },
  font(v, refs) {
    if (isObj(v) && own(v, '$ref')) return tokenRef(v, refs, 'typography');
    if (!isObj(v)) return 'not a font';
    const ks = Object.keys(v);
    if (ks.length !== 4 || !['family', 'size', 'weight', 'lineHeight'].every((k) => own(v, k))) return 'not exactly { family, size, weight, lineHeight }';
    if (!FAMILIES.includes(v.family) && tokenRef(v.family, refs, 'fontFamily')) return 'family not sans, serif, mono or a fontFamily reference';
    if (!(typeof v.size === 'number' ? num(v.size, 1, 1000) : !tokenRef(v.size, refs, 'dimension', 1, 1000))) return 'size not 1..1000 or a dimension reference';
    if (!weightOk(v.weight) && tokenRef(v.weight, refs, 'fontWeight')) return 'weight not 100..900 by 100 or a fontWeight reference';
    if (!(typeof v.lineHeight === 'number' ? num(v.lineHeight, 0.5, 10) : !tokenRef(v.lineHeight, refs, 'number', 0.5, 10))) return 'lineHeight not 0.5..10 or a number reference';
    return null;
  },
  pathData(v) {
    if (typeof v !== 'string') return 'not a string';
    if (Buffer.byteLength(v) > D.pathBytes) return `over ${D.pathBytes} bytes`;
    return PATH_RE.test(v) ? null : 'not SVG path commands and numbers starting with a move';
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

function dimToken(v, lo = -DIM_MAX, hi = DIM_MAX) {
  return isObj(v) && Object.keys(v).length === 2 && num(v.value, lo, hi) && v.unit === 'px';
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
      if (!v.components.every((c) => num(c, 0, 1))) return 'color: a component not in 0..1';
      if (own(v, 'alpha') && !num(v.alpha, 0, 1)) return 'color: alpha not in 0..1';
      if (own(v, 'hex') && !(typeof v.hex === 'string' && HEX6_RE.test(v.hex))) return 'color: hex not #rrggbb';
      return null;
    }
    case 'dimension': return dimToken(v) ? null : 'dimension: not { value: -100000..100000, unit: px }';
    case 'fontFamily': return FAMILIES.includes(v) ? null : 'fontFamily: not sans, serif or mono';
    case 'fontWeight': return weightOk(v) ? null : 'fontWeight: not 100..900 by 100';
    case 'number': return num(v, -Infinity, Infinity) ? null : 'number: not a finite number';
    case 'typography': {
      const ks = ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight'];
      if (!isObj(v) || Object.keys(v).length !== 5 || !ks.every((k) => own(v, k))) return 'typography: not exactly { fontFamily, fontSize, fontWeight, letterSpacing, lineHeight }';
      if (!FAMILIES.includes(v.fontFamily)) return 'typography: fontFamily not sans, serif or mono';
      if (!dimToken(v.fontSize)) return 'typography: fontSize not a dimension';
      if (!weightOk(v.fontWeight)) return 'typography: fontWeight not 100..900 by 100';
      if (!dimToken(v.letterSpacing)) return 'typography: letterSpacing not a dimension';
      if (!num(v.lineHeight, -Infinity, Infinity)) return 'typography: lineHeight not a number';
      return null;
    }
    default: return `$type not one of ${TOKEN_TYPES.join(', ')}`;
  }
}
// A token is an object with a `$` key; anything else that is an object is a group.
const isTokenNode = (v) => isObj(v) && Object.keys(v).some((k) => k.startsWith('$'));

// ---- docErrors ----

// The way `doc` breaks canvas-doc@1, rule by rule in DOC_RULES order. `images`: the file names under
// `images/` (a Set), or null to skip the file check; `folderBytes`: every byte of the folder but
// canvas.json (images and other files), counted with canvas.json as written against the folder limit.
export function docErrors(doc, { images = null, folderBytes = 0 } = {}) {
  const by = new Map(DOC_RULES.map((r) => [r.rule, []]));
  const add = (rule, where, message) => by.get(rule).push({ where, message });
  const finish = () => {
    const out = [];
    for (const { rule, code } of DOC_RULES) for (const e of by.get(rule)) out.push({ rule, code, where: e.where, message: e.message });
    return out;
  };

  // top
  if (!isObj(doc)) { add('top', 'doc', 'not an object'); return finish(); }
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
    for (const [id, o] of Object.entries(m)) {
      if (!inComp(id, comp)) { add('refs', `${w}.${id}`, `${id} is not a descendant of component ${comp}`); continue; }
      if (!isObj(o)) continue;
      for (const prop of Object.keys(o)) if (!overridable(good.get(id).type, prop)) add('refs', `${w}.${id}.${prop}`, `${prop} is not an overridable property of a ${good.get(id).type}`);
    }
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

// ---- opErrors and applyEdit ----

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
// docErrors on the end state. Applied: a new document at rev + 1, why null. Refused: the same document
// and the refusal code.
export function applyEdit(doc, ops, { images = null, folderBytes = 0, level = 'full' } = {}) {
  const no = (why) => ({ doc, why });
  if (level !== 'full') return no('view');
  if (!Array.isArray(ops) || ops.length === 0) return no('shape');
  if (Buffer.byteLength(JSON.stringify(ops)) > LIMITS.editOpsBytes) return no('limit');
  const d = structuredClone(doc);
  for (const op of ops) {
    if (opErrors(op).length) return no('shape');
    const why = APPLY[op.op](d, op);
    if (why) return no(why);
  }
  d.rev = doc.rev + 1;
  const errs = docErrors(d, { images, folderBytes });
  if (errs.length) return no(errs[0].code);
  return { doc: d, why: null };
}

// ---- resolve: an instance's tree, five levels ----

// For each descendant of the instance's component: every plain property's value as the instance shows
// it. Base (the node's value, else its default), then a prop's default aimed at it, then the chosen
// variant's override, then the instance's override, then the instance's prop value aimed at it.
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
      if (['props', 'variants', 'overrides'].includes(path)) continue;
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

// ---- freeTexts ----

// Every free-text field: page and node names, texts, text prop defaults, instance text prop values,
// and text overrides on variants and instances.
export function freeTexts(doc) {
  const out = [];
  (doc.pages || []).forEach((pg, i) => { if (typeof pg.name === 'string') out.push({ where: `pages[${i}].name`, kind: 'page-name', value: pg.name }); });
  for (const [id, n] of Object.entries(doc.nodes || {})) {
    const w = `nodes.${id}`;
    if (typeof n.name === 'string') out.push({ where: `${w}.name`, kind: 'node-name', value: n.name });
    if (n.type === 'text' && typeof n.text === 'string') out.push({ where: `${w}.text`, kind: 'text', value: n.text });
    if (n.type === 'component') {
      if (isObj(n.props)) {
        for (const [name, pd] of Object.entries(n.props)) {
          if (isObj(pd) && pd.type === 'text' && typeof pd.default === 'string') out.push({ where: `${w}.props.${name}.default`, kind: 'prop-default', value: pd.default });
        }
      }
      if (isObj(n.variants)) {
        for (const [vn, vm] of Object.entries(n.variants)) {
          if (!isObj(vm)) continue;
          for (const [tid, o] of Object.entries(vm)) if (isObj(o) && typeof o.text === 'string') out.push({ where: `${w}.variants.${vn}.${tid}.text`, kind: 'variant-text', value: o.text });
        }
      }
    }
    if (n.type === 'instance') {
      if (isObj(n.props)) for (const [name, v] of Object.entries(n.props)) if (typeof v === 'string') out.push({ where: `${w}.props.${name}`, kind: 'prop-value', value: v });
      if (isObj(n.overrides)) {
        for (const [tid, o] of Object.entries(n.overrides)) if (isObj(o) && typeof o.text === 'string') out.push({ where: `${w}.overrides.${tid}.text`, kind: 'override-text', value: o.text });
      }
    }
  }
  return out;
}

// ---- shapeErrors: every message kind ----

function keys(e, where, o, want) {
  if (!isObj(o)) { e.push(`${where}: not an object`); return false; }
  for (const k of want) if (!own(o, k)) e.push(`${where}: no ${k}`);
  for (const k of Object.keys(o)) if (!want.includes(k)) e.push(`${where}: extra key ${k}`);
  return true;
}
const eq = (e, where, v, want) => { if (v !== want) e.push(`${where}: not ${JSON.stringify(want)}`); };
const re = (e, where, v, rx, what) => { if (typeof v !== 'string' || !rx.test(v)) e.push(`${where}: not ${what}`); };
const oneOf = (e, where, v, list) => { if (!list.includes(v)) e.push(`${where}: not one of ${list.join(', ')}`); };
const int = (e, where, v, lo) => { if (!safeInt(v, lo)) e.push(`${where}: not an integer >= ${lo}`); };
const personName = (e, where, v) => { if (typeof v !== 'string' || v.length === 0 || cutName(v) !== v) e.push(`${where}: not a name of 1 to 80 JSON bytes`); };
const size = (e, kind, m, max) => { if (Buffer.byteLength(JSON.stringify(m)) > max) e.push(`${kind}: over ${max} bytes`); };
function ids(e, where, v) {
  if (!Array.isArray(v)) { e.push(`${where}: not an array`); return; }
  if (v.length > LIMITS.selectIds) e.push(`${where}: over ${LIMITS.selectIds} ids`);
  v.forEach((x, i) => re(e, `${where}[${i}]`, x, NODE_ID_RE, 'a node id'));
}
const msg = (kind, want, t, more) => (e, m) => {
  if (!keys(e, kind, m, want)) return;
  if (t) eq(e, `${kind}.t`, m.t, t);
  if (more) more(e, m);
};

const CHECK = {
  // F3: the envelope only; the ops are opErrors' and applyEdit's
  edit: msg('edit', ['t', 'client', 'seq', 'ops'], 'edit', (e, m) => {
    re(e, 'edit.client', m.client, CLIENT_RE, '16 of [0-9a-z]');
    int(e, 'edit.seq', m.seq, 1);
    if (!Array.isArray(m.ops)) e.push('edit.ops: not an array');
    size(e, 'edit', m, LIMITS.pageMsgBytes);
  }),
  select: msg('select', ['t', 'ids'], 'select', (e, m) => { ids(e, 'select.ids', m.ids); size(e, 'select', m, LIMITS.pageMsgBytes); }),
  pong: msg('pong', ['t'], 'pong'),
  welcome: msg('welcome', ['t', 'canvas', 'session', 'rev', 'you'], 'welcome', (e, m) => {
    eq(e, 'welcome.canvas', m.canvas, 1);
    re(e, 'welcome.session', m.session, SESSION_RE, '16 of [0-9a-z]');
    int(e, 'welcome.rev', m.rev, 0);
    if (keys(e, 'welcome.you', m.you, ['id', 'conn'])) {
      re(e, 'welcome.you.id', m.you.id, PERSON_ID_RE, 'a person id');
      re(e, 'welcome.you.conn', m.you.conn, CONN_RE, 'a conn');
    }
  }),
  ops: msg('ops', ['t', 'rev', 'by', 'ack', 'ops'], 'ops', (e, m) => {
    int(e, 'ops.rev', m.rev, 1);
    if (keys(e, 'ops.by', m.by, ['id', 'name', 'via'])) {
      oneOf(e, 'ops.by.via', m.by.via, VIAS);
      if (m.by.via === 'page') {
        re(e, 'ops.by.id', m.by.id, PERSON_ID_RE, 'a person id');
        personName(e, 'ops.by.name', m.by.name);
        if (m.ack === null) e.push("ops.ack: null on a page's edit");
      } else {
        re(e, 'ops.by.id', m.by.id, BY_RE, '1 to 64 of [A-Za-z0-9._-]');
        if (m.by.name !== m.by.id) e.push('ops.by.name: not the claimed by');
        if (m.ack !== null) e.push('ops.ack: not null on a local apply');
      }
    }
    if (m.ack !== null && keys(e, 'ops.ack', m.ack, ['client', 'seq'])) {
      re(e, 'ops.ack.client', m.ack.client, CLIENT_RE, '16 of [0-9a-z]');
      int(e, 'ops.ack.seq', m.ack.seq, 1);
    }
    if (!Array.isArray(m.ops)) e.push('ops.ops: not an array');
    else m.ops.forEach((op, i) => { for (const x of opErrors(op)) e.push(`ops.ops[${i}]: ${x}`); });
    size(e, 'ops', m, LIMITS.serverMsgBytes);
  }),
  saved: msg('saved', ['t', 'rev'], 'saved', (e, m) => int(e, 'saved.rev', m.rev, 0)),
  refused: msg('refused', ['t', 'client', 'seq', 'why'], 'refused', (e, m) => {
    re(e, 'refused.client', m.client, CLIENT_RE, '16 of [0-9a-z]');
    int(e, 'refused.seq', m.seq, 1);
    oneOf(e, 'refused.why', m.why, REFUSALS);
  }),
  selections: msg('selections', ['t', 'people'], 'selections', (e, m) => {
    if (!Array.isArray(m.people)) { e.push('selections.people: not an array'); return; }
    if (m.people.length > LIMITS.perCanvas) e.push(`selections.people: over ${LIMITS.perCanvas} people`);
    const seen = new Set();
    m.people.forEach((pp, i) => {
      const w = `selections.people[${i}]`;
      if (!keys(e, w, pp, ['id', 'name', 'ids'])) return;
      re(e, `${w}.id`, pp.id, PERSON_ID_RE, 'a person id');
      if (seen.has(pp.id)) e.push(`${w}.id: listed twice`);
      seen.add(pp.id);
      personName(e, `${w}.name`, pp.name);
      ids(e, `${w}.ids`, pp.ids);
    });
    size(e, 'selections', m, LIMITS.serverMsgBytes);
  }),
  paused: msg('paused', ['t', 'why'], 'paused', (e, m) => oneOf(e, 'paused.why', m.why, PAUSE_WHYS)),
  resumed: msg('resumed', ['t'], 'resumed'),
  reload: msg('reload', ['t', 'session'], 'reload', (e, m) => re(e, 'reload.session', m.session, SESSION_RE, '16 of [0-9a-z]')),
  closed: msg('closed', ['t', 'why'], 'closed', (e, m) => oneOf(e, 'closed.why', m.why, CLOSE_WHYS)),
  ping: msg('ping', ['t'], 'ping'),
  'doc-response': msg('doc-response', ['session', 'rev', 'doc', 'repo'], null, (e, m) => {
    if (m.session !== null) re(e, 'doc-response.session', m.session, SESSION_RE, 'null or 16 of [0-9a-z]');
    int(e, 'doc-response.rev', m.rev, 0);
    for (const x of docErrors(m.doc)) e.push(`doc-response.doc: ${x.rule}: ${x.where}: ${x.message}`);
    if (isObj(m.doc) && m.doc.rev !== m.rev) e.push("doc-response.rev: not the document's rev");
    if (keys(e, 'doc-response.repo', m.repo, ['name', 'public'])) {
      if (m.repo.name !== null) re(e, 'doc-response.repo.name', m.repo.name, REPO_RE, 'null or owner/repo');
      if (m.repo.public !== null && typeof m.repo.public !== 'boolean') e.push('doc-response.repo.public: not true, false or null');
      if (m.repo.name === null && m.repo.public !== null) e.push('doc-response.repo.public: known with no repo');
    }
  }),
  'image-request': msg('image-request', ['name', 'data'], null, (e, m) => {
    const n = SIMPLE.name(m.name);
    if (n || m.name.length === 0) e.push('image-request.name: not 1 to 200 characters');
    if (typeof m.data !== 'string' || m.data.length === 0 || !BASE64_RE.test(m.data)) e.push('image-request.data: not base64');
    else if (Math.floor((m.data.length * 3) / 4) - (m.data.endsWith('==') ? 2 : m.data.endsWith('=') ? 1 : 0) > LIMITS.imageBytes) e.push(`image-request.data: over ${LIMITS.imageBytes} bytes`);
  }),
  'image-response': msg('image-response', ['src'], null, (e, m) => { if (SIMPLE.imageSrc(m.src, [])) e.push('image-response.src: not images/<16 hex>.<png|jpg|webp|gif>'); }),
  'local-request': msg('local-request', ['by', 'via', 'ops'], null, (e, m) => {
    re(e, 'local-request.by', m.by, BY_RE, '1 to 64 of [A-Za-z0-9._-]');
    oneOf(e, 'local-request.via', m.via, ['apply', 'take']);
    if (!Array.isArray(m.ops)) e.push('local-request.ops: not an array');
  }),
  'local-response': msg('local-response', ['rev', 'edits', 'saved'], null, (e, m) => {
    int(e, 'local-response.rev', m.rev, 0);
    int(e, 'local-response.edits', m.edits, 1);
    if (typeof m.saved !== 'boolean') e.push('local-response.saved: not a boolean');
  }),
  'error-response': msg('error-response', ['why'], null, (e, m) => oneOf(e, 'error-response.why', m.why, [...REFUSALS, ...ROUTE_WHYS])),
  'note-anchor': msg('note-anchor', ['node'], null, (e, m) => {
    const v = m.node;
    if (typeof v !== 'string' || v.length === 0 || !wellFormed(v) || codePoints(v) > LIMITS.noteAnchorChars || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(v)) {
      e.push(`note-anchor.node: not 1 to ${LIMITS.noteAnchorChars} characters of one line of plain text`);
    }
  }),
  'presence-here'(e, m) {
    for (const x of presenceShapeErrors('here', m)) e.push(x);
    if (!isObj(m) || !isObj(m.at)) return;
    const a = m.at;
    eq(e, 'here.at.page', a.page, 'canvas');
    re(e, 'here.at.tab', a.tab, NODE_ID_RE, 'a canvas page id');
    eq(e, 'here.at.peek', a.peek, null);
    const slug = typeof a.art === 'string' && a.art.endsWith('@canvas') ? a.art.slice(0, -'@canvas'.length) : null;
    if (slug === null || !SLUG_RE.test(slug)) e.push('here.at.art: not <slug>@canvas');
  },
  'presence-move'(e, m) {
    for (const x of presenceShapeErrors('move', m)) e.push(x);
    if (!isObj(m) || !isObj(m.a)) return;
    const k = m.a.k;
    const nodeK = typeof k === 'string' && (NODE_ID_RE.test(k) || (k.startsWith('@') && NODE_ID_RE.test(k.slice(1))));
    if (!nodeK) e.push('move.a.k: not a node id or @<page id>');
  },
};

// The ways `msg` breaks kind `kind`'s shape; empty when it holds.
export function shapeErrors(kind, m) {
  if (!own(CHECK, kind)) return [`unknown kind ${JSON.stringify(kind)}`];
  const e = [];
  CHECK[kind](e, m);
  return e;
}

// ---- the canvas test-file rule ----

// One pass over a source: each character's kind (code, comment, string, template text, regex), the
// openers of strings, and the source blanked (comments and the insides of strings, templates and
// regexes made spaces, newlines and delimiters kept), at the same offsets. A `/` starts a regex after
// nothing, an operator or punctuator other than ) ] }, or a keyword below; a regex, like a string,
// ends at the end of its line at the latest.
const CODE = 0;
const KIND_NAMES = ['code', 'comment', 'string', 'template', 'regex'];
const REGEX_AFTER = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do']);
const IDENT_CH = /[A-Za-z0-9_$\u0080-\uffff]/;
function scan(src) {
  const n = src.length;
  const kind = new Uint8Array(n);
  const keep = new Uint8Array(n);
  const opener = new Uint8Array(n);
  const mark = (a, b, k) => { for (let j = a; j < b; j++) kind[j] = k; };
  const subs = []; // the brace depth outside each open template substitution
  let depth = 0;
  let last = { t: 'none' };
  // A template's text from `from` to its closing backtick or next `${`.
  const templateText = (from) => {
    let j = from;
    while (j < n) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '`') { mark(from, j + 1, 3); keep[j] = 1; return { end: j + 1, sub: false }; }
      if (src[j] === '$' && src[j + 1] === '{') { mark(from, j + 2, 3); keep[j] = 1; keep[j + 1] = 1; return { end: j + 2, sub: true }; }
      j++;
    }
    mark(from, n, 3);
    return { end: n, sub: false };
  };
  const afterTemplate = (r) => {
    if (r.sub) { subs.push(depth); depth = 0; last = { t: 'punct', v: '{' }; } else last = { t: 'value' };
    return r.end;
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; mark(i, j, 1); i = j; continue; }
    if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; mark(i, j, 1); i = j; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      const end = j < n && src[j] === c ? j + 1 : Math.min(j, n);
      mark(i, end, 2);
      keep[i] = 1; opener[i] = 1;
      if (end - 1 > i && src[end - 1] === c) keep[end - 1] = 1;
      i = end;
      last = { t: 'value' };
      continue;
    }
    if (c === '`') { kind[i] = 3; keep[i] = 1; opener[i] = 1; i = afterTemplate(templateText(i + 1)); continue; }
    if (c === '}' && depth === 0 && subs.length) { depth = subs.pop(); kind[i] = 3; keep[i] = 1; i = afterTemplate(templateText(i + 1)); continue; }
    if (c === '/') {
      const isRegex = last.t === 'none' || (last.t === 'punct' && !')]}'.includes(last.v)) || (last.t === 'word' && REGEX_AFTER.has(last.v));
      if (isRegex) {
        let j = i + 1;
        let cls = false;
        while (j < n && src[j] !== '\n') {
          const ch = src[j];
          if (ch === '\\') { if (src[j + 1] === '\n') { j++; break; } j += 2; continue; }
          if (cls) { if (ch === ']') cls = false; } else if (ch === '[') cls = true; else if (ch === '/') break;
          j++;
        }
        let end = Math.min(j, n);
        if (j < n && src[j] === '/') { end = j + 1; while (end < n && /[A-Za-z]/.test(src[end])) end++; keep[j] = 1; }
        mark(i, end, 4);
        keep[i] = 1;
        i = end;
        last = { t: 'value' };
        continue;
      }
      last = { t: 'punct', v: '/' };
      i++;
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (IDENT_CH.test(c)) {
      let j = i;
      while (j < n && IDENT_CH.test(src[j])) j++;
      const w = src.slice(i, j);
      last = /^[0-9]/.test(w) ? { t: 'value' } : { t: 'word', v: w };
      i = j;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && depth > 0) depth--;
    last = { t: 'punct', v: c };
    i++;
  }
  let blank = '';
  for (let j = 0; j < n; j++) blank += kind[j] === CODE || keep[j] || src[j] === '\n' ? src[j] : ' ';
  return { kind, opener, keep, blank };
}
const lineAt = (src, k) => { let l = 1; for (let j = 0; j < k; j++) if (src.charCodeAt(j) === 10) l++; return l; };
const noComment = (s, a, b) => { for (let j = a; j < b; j++) if (s.kind[j] === 1) return false; return true; };

// Whether `source` imports `canDrive` (by that name) from './lib/chrome.mjs'.
function importsCanDrive(source, s) {
  for (const m of s.blank.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*(['"])/g)) {
    const start = m.index + m[0].length;
    const end = source.indexOf(m[2], start);
    const names = m[1].split(',').map((x) => x.trim());
    if (end > start && source.slice(start, end) === './lib/chrome.mjs' && names.includes('canDrive')) return true;
  }
  return false;
}

const ALLOWED_SKIPS = [
  /skip\s*:\s*canDrive\s*\?\s*false\s*:\s*'[^'\n\\]+'/y,
  /skip\s*:\s*process\.platform\s*===\s*'darwin'\s*\?\s*false\s*:\s*'not macOS'/y,
];
// The skip rule, on the source with comments removed and string, template and regex insides blanked:
// `skip:` only as one of the two allowed forms (canDrive imported from ./lib/chrome.mjs for the first);
// no `.skip`, `.todo`, `.only`, `todo:` or `only:`.
export function skipProblems(source) {
  const s = scan(source);
  const b = s.blank;
  const out = [];
  for (const m of b.matchAll(/\.\s*(skip|todo|only)\b/g)) out.push(`line ${lineAt(source, m.index)}: .${m[1]}`);
  for (const m of b.matchAll(/(?<![\w$.])(todo|only)\s*:/g)) out.push(`line ${lineAt(source, m.index)}: ${m[1]}:`);
  // a quoted or computed key, or bracket access: a string or plain template whose text is skip, todo
  // or only, followed by `:` or `]`
  for (let k = 0; k < source.length; k++) {
    if (!s.opener[k]) continue;
    let j = k + 1;
    while (j < source.length && s.kind[j] === s.kind[k] && !s.keep[j]) j++;
    if (j >= source.length || source[j] !== source[k]) continue;
    const word = source.slice(k + 1, j);
    if (!['skip', 'todo', 'only'].includes(word)) continue;
    let after = j + 1;
    while (after < b.length && /\s/.test(b[after])) after++;
    if (b[after] === ':' || b[after] === ']') out.push(`line ${lineAt(source, k)}: ${source[k]}${word}${source[k]} as a key`);
  }
  let imported = null;
  for (const m of b.matchAll(/(?<![\w$.])skip\s*:/g)) {
    const k = m.index;
    const form = ALLOWED_SKIPS.findIndex((rx) => { rx.lastIndex = k; return rx.test(source) && noComment(s, k, rx.lastIndex); });
    if (form === 0) {
      if (imported === null) imported = importsCanDrive(source, s);
      if (!imported) out.push(`line ${lineAt(source, k)}: skip: canDrive without importing canDrive from ./lib/chrome.mjs`);
    } else if (form < 0) out.push(`line ${lineAt(source, k)}: skip: neither canDrive ? false : '<reason>' nor process.platform === 'darwin' ? false : 'not macOS'`);
  }
  return out;
}

// The measure's pattern, as its grep has it (no word boundary before `test`).
const MEASURE_RE = /test\('canvas A([0-9]+):/g;
const CANVAS_FILE_RE = /^canvas-.*\.test\.mjs$/;
// Where names live: every match of the measure's pattern is a real call (its `test` the whole
// identifier, in code, its quote opening the first argument) in a test/canvas-*.test.mjs file; no
// name twice; every file holding one, and every canvas-*.test.mjs, passes the skip rule.
export function measureProblems(files) {
  const out = [];
  const seen = new Map();
  for (const f of files) {
    const base = f.name.split('/').pop();
    let s = null;
    let holds = false;
    for (const m of f.source.matchAll(MEASURE_RE)) {
      holds = true;
      if (!s) s = scan(f.source);
      const k = m.index;
      const at = `${f.name}:${lineAt(f.source, k)}`;
      const name = `canvas A${m[1]}:`;
      if (seen.has(name)) out.push(`${at}: ${name} again (first at ${seen.get(name)})`);
      else seen.set(name, at);
      if (s.kind[k] !== CODE) { out.push(`${at}: ${name} inside a ${KIND_NAMES[s.kind[k]]}, which the measure still counts`); continue; }
      let j = k - 1;
      while (j >= 0 && /\s/.test(f.source[j])) j--;
      if (k > 0 && (IDENT_CH.test(f.source[k - 1]) || (j >= 0 && f.source[j] === '.'))) { out.push(`${at}: ${name} called on something other than the identifier test`); continue; }
      if (!s.opener[k + 5]) out.push(`${at}: ${name}'s quote does not open the first argument`);
      if (!CANVAS_FILE_RE.test(base)) out.push(`${at}: ${name} outside a test/canvas-*.test.mjs file`);
    }
    if (holds || CANVAS_FILE_RE.test(base)) for (const x of skipProblems(f.source)) out.push(`${f.name}: ${x}`);
  }
  return out;
}

// The cases the rules are tested on (spec 2.7). Built by concatenation, so this file's own text holds
// no match of the measure's pattern.
const CALL = 'test(' + "'canvas A";
const IMPORT_TEST = "import { test } from 'node:test';\n";
const call = (n) => `${CALL}${n}: a name', () => {});\n`;
const file = (name, source) => ({ name, source });

export const SKIP_CASES = deepFreeze({
  bad: [
    file('test.skip(', "test.skip('x', () => {});\n"),
    file('t.skip(', "test('x', (t) => { t.skip('later'); });\n"),
    file('{ skip: true }', "test('x', { skip: true }, () => {});\n"),
    file('skip: SKIP', "const SKIP = false;\ntest('x', { skip: SKIP }, () => {});\n"),
    file("skip: other ? false : 'x'", "const other = true;\ntest('x', { skip: other ? false : 'x' }, () => {});\n"),
    file("skip: canDrive ? false : 'x' without the import", "const canDrive = true;\ntest('x', { skip: canDrive ? false : 'x' }, () => {});\n"),
    file("skip: canDrive imported from elsewhere", "import { canDrive } from './lib/other.mjs';\ntest('x', { skip: canDrive ? false : 'x' }, () => {});\n"),
    file('test.todo(', "test.todo('x');\n"),
    file('{ todo: true }', "test('x', { todo: true }, () => {});\n"),
    file('test.only(', "test.only('x', () => {});\n"),
    file('{ only: true }', "test('x', { only: true }, () => {});\n"),
    file('describe.only(', "describe.only('x', () => {});\n"),
    file('a quote in a regex literal hides nothing after it', "const r = /'/;\ntest.skip('x', () => {});\n"),
    file('a quote in a regex literal hides nothing after it on its own line', "const r = /'/; test.skip('x', () => {});\n"),
    file('a backtick in a regex literal opens no template', 'const r = /`/;\nconst s = 1;\ntest.skip(\'x\', () => {});\n'),
    file('a backtick and a quote in a regex class hide nothing after them', 'const r = /[`"]/;\ntest.skip(\'x\', () => {});\n'),
    file('a slash inside a regex class does not end the regex', "const r = /[/']/;\ntest.skip('x', () => {});\n"),
    file('a slash after ) is division: the quote it meets opens a string that ends at its line', "if (x) /'/.test(s);\ntest.skip('x', () => {});\n"),
    file('a slash misread as a regex blanks only to the end of its line', 'const of = 4; const y = of / 2;\ntest.skip(\'x\', () => {});\n'),
    file('a slash inside a regex class does not end the regex, on its own line', "const r = /[/']/; test.skip(1);\n"),
    file('a slash after ) is division, on its own line', 'const h = (a) / 2; test.skip(1); const k = 3 / 4;\n'),
    file("{ 'skip': true }", "test('x', { 'skip': true }, () => {});\n"),
    file('{ "only": true }', 'test(\'x\', { "only": true }, () => {});\n'),
    file("{ 'todo': true }", "test('x', { 'todo': true }, () => {});\n"),
    file("{ ['skip']: true }", "test('x', { ['skip']: true }, () => {});\n"),
    file('{ [`todo`]: true }', "test('x', { [`todo`]: true }, () => {});\n"),
    file("test['skip'](", "test['skip']('x', () => {});\n"),
    file('t["only"](', 'test(\'x\', (t) => { t["only"](\'y\', () => {}); });\n'),
    file("test['todo'](", "test['todo']('x');\n"),
    file('a skip inside a template substitution is code', "const s = `${test.skip('x')}`;\n"),
  ],
  good: [
    file('canDrive imported from ./lib/chrome.mjs', "import { canDrive } from './lib/chrome.mjs';\ntest('x', { skip: canDrive ? false : 'no Chrome or no WebSocket' }, () => {});\n"),
    file('not macOS', "test('x', { skip: process.platform === 'darwin' ? false : 'not macOS' }, () => {});\n"),
    file('the forbidden words in comments', "// test.skip( test.only( { todo: true } skip: SKIP\n/* t.skip() .only only: */\ntest('x', () => {});\n"),
    file('the forbidden words in a test name', "test('does not use .skip, .only, .todo, skip: or only: here', () => {});\n"),
    file('a quote in a regex opens no string', "const r = /'/; const s = 'test.skip(';\ntest('x', () => { r.test(s); });\n"),
    file('the forbidden words in a template text', 'const s = `a .skip and only: in ${1 + 1} text`;\n'),
    file('division', "const half = a / 2 / b; const s = 'x / .only';\n"),
    file('division after )', "const h = (a) / 2; const s = '/ .only';\n"),
    file('the words as values, not keys', "const why = 'skip'; test('only', () => { why.length; });\n"),
  ],
});

export const MEASURE_CASES = deepFreeze({
  bad: [
    [file('other.test.mjs', IMPORT_TEST + call(9))],
    [file('canvas-x.test.mjs', `${IMPORT_TEST}// ${call(9)}`)],
    [file('canvas-x.test.mjs', `${IMPORT_TEST}/* ${call(9)} */\n`)],
    [file('canvas-x.test.mjs', `${IMPORT_TEST}const s = "${CALL}9: x";\n`)],
    [file('canvas-x.test.mjs', `${IMPORT_TEST}const s = \`${CALL}9: x\`;\n`)],
    [file('canvas-a.test.mjs', IMPORT_TEST + call(9)), file('canvas-b.test.mjs', IMPORT_TEST + call(9))],
    [file('canvas-x.test.mjs', `${IMPORT_TEST}${call(9)}test.skip('y', () => {});\n`)],
    [file('canvas-x.test.mjs', `${IMPORT_TEST}const subtest = test;\nsub${CALL}9: x', () => {});\n`)],
    [file('canvas-x.test.mjs', `${IMPORT_TEST}test('x', async (t) => { await t.${CALL}9: x', () => {}); });\n`)],
    [file('canvas-y.test.mjs', `${IMPORT_TEST}test('x', { only: true }, () => {});\n`)],
  ],
  good: [
    [file('canvas-x.test.mjs', IMPORT_TEST + call(1))],
    [file('canvas-a.test.mjs', IMPORT_TEST + call(1)), file('canvas-b.test.mjs', IMPORT_TEST + call(2)), file('other.test.mjs', "test('canvas-ish, not measured', () => {});\n")],
    [file('canvas-x.test.mjs', `${IMPORT_TEST}import { canDrive } from './lib/chrome.mjs';\n${CALL}3: a name', { skip: canDrive ? false : 'no Chrome' }, () => {});\n`)],
  ],
});
