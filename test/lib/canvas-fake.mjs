// canvas-doc@1 and canvas@1 (test/contracts/canvas.md): the rules as code. The tables the contract's
// machine-read tables are compared with, `docErrors` (the document rules, in judgement order),
// `opErrors` and `applyEdit` (an edit judged as a whole), `resolve` (an instance's five-level order),
// `shapeErrors` (every message the socket and the routes carry), `freeTexts` (the fields hostile content
// may fill), and the canvas test-file rule (`skipProblems`, `measureProblems`) with the cases it is
// tested on. Tree walks use explicit stacks and queues, never recursion. Then the fake server
// (`startCanvasFake`: the `/canvas` socket and the `/api/canvas/…` routes), its client (`openCanvas`),
// `request` over `net`, `playHttp` for the http-*.json fixtures, and `exchangeOptions`, `exchangeProblems`
// and `playExchange` for the exchange-*.json ones. Node built-ins only; consumes
// presence@1 through its fake's `ID_RE`, `CONN_RE`, `cutName` and `shapeErrors`.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
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

// What crossing each limit by one answers, as the contract's Limits table words it (keyed like LIMITS).
export const LIMIT_ANSWERS = Object.freeze({
  docBytes: 'refused limit', folderBytes: 'refused limit', nodes: 'refused limit', pages: 'refused limit', tokens: 'refused limit',
  tokenDepth: 'refused limit', depth: 'refused limit', overrideEntries: 'refused limit', props: 'refused limit', variants: 'refused limit',
  tracks: 'refused value', idChars: 'refused value', nameChars: 'refused value', textChars: 'refused value', pathBytes: 'refused value',
  figmaChars: 'refused value', propNameChars: 'refused value', tokenSegmentChars: 'refused value',
  pageMsgBytes: 'close 1008', pageFrames: 'close 1008', editOpsBytes: 'refused limit', serverMsgBytes: 'split; one op over: 409 limit',
  serverFrameBytes: 'fragmented', perSecond: 'close 1008', perPerson: 'close 1008', perCanvas: 'close 1008', openCanvases: 'close 1008',
  perServer: 'close 1008', selectIds: 'ignored', refusedMemory: 're-acked', pingMs: 'window: ping', unansweredPings: 'close 1001', savedMs: 'window: saved',
  selectionsMs: 'window: selections', imageBytes: '413', imageBodyBytes: '413', localBodyBytes: '413', importBodyBytes: '413',
  byChars: '400', noteAnchorChars: 'not an anchor',
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
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const B64_CHAR = /[A-Za-z0-9+/]/;
// Padded base64: groups of four of the alphabet, the last ending `=` or `==`. A scan, never a regex
// over the whole string (a repeated group overflows the stack on a few MB of image).
function base64Ok(s) {
  if (s.length % 4 !== 0) return false;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  for (let i = 0; i < s.length - pad; i++) if (!B64_CHAR.test(s[i])) return false;
  return true;
}
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
// docErrors on the end state. Applied: a new document at rev + 1, why null. Refused: the same document
// and the refusal code.
// `maxOpsBytes` bounds the ops as JSON: a page's edit by `editOpsBytes` (the default); null for a local
// apply, which its body bounds instead (§7).
export function applyEdit(doc, ops, { images = null, folderBytes = 0, level = 'full', maxOpsBytes = LIMITS.editOpsBytes } = {}) {
  const no = (why) => ({ doc, why });
  if (level !== 'full') return no('view');
  if (!Array.isArray(ops) || ops.length === 0) return no('shape');
  if (maxOpsBytes !== null && Buffer.byteLength(JSON.stringify(ops)) > maxOpsBytes) return no('limit');
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

// ---- the edit bookkeeping of one session: applied and refused seqs per client ----

// One per session (a new session starts a new book). `judge(client, seq)`: 'new' (judge it), 'reack'
// (at or below the highest applied, not a refusal it remembers: ack again with ops []), or
// { refused: why } (a seq it refused: refuse it again, same why, never re-ack). `record(client, seq, why)`
// after judging a new edit: why null when applied. Refused seqs are remembered while within
// LIMITS.refusedMemory of the client's highest seq seen, so the book stays bounded.
export function makeSeqBook() {
  const clients = new Map();
  const of = (client) => {
    if (!clients.has(client)) clients.set(client, { applied: 0, seen: 0, refused: new Map() });
    return clients.get(client);
  };
  return {
    judge(client, seq) {
      const c = clients.get(client);
      if (!c) return 'new';
      if (c.refused.has(seq)) return { refused: c.refused.get(seq) };
      return seq <= c.applied ? 'reack' : 'new';
    },
    record(client, seq, why) {
      const c = of(client);
      if (why === null) {
        if (seq > c.applied) c.applied = seq;
        c.refused.delete(seq);
      } else c.refused.set(seq, why);
      if (seq > c.seen) c.seen = seq;
      for (const s of c.refused.keys()) if (s < c.seen - LIMITS.refusedMemory) c.refused.delete(s);
    },
    highest: (client) => (clients.has(client) ? clients.get(client).applied : 0),
  };
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
    if (typeof m.data !== 'string' || m.data.length === 0 || !base64Ok(m.data)) e.push('image-request.data: not base64');
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

// ---- the fake server (§14): the clock, RFC 6455 both ends, the guards, the socket and the routes ----
// The approach is presence-fake.mjs's (guards in presence@1 §2's order, each frame header weighed before
// its payload is read, a manual clock, a client over `net`), with this contract's limits and messages.

const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };

// `now()` and `after(ms, fn)` (returning a cancel). The manual clock starts at 0, keeps due times and
// moves only by `tick(ms)`, which runs each due timer in order (by due time, then by when it was set),
// yielding after each so socket writes go out and pending reads come in.
function makeClock(kind) {
  if (kind === 'manual') {
    let t = 0;
    let seq = 0;
    let due = [];
    return {
      now: () => t,
      after(ms, fn) {
        const e = { at: t + ms, seq: seq++, fn, off: false };
        due.push(e);
        return () => { e.off = true; };
      },
      async tick(ms) {
        const end = t + ms;
        await settle();
        for (;;) {
          let next = null;
          for (const e of due) if (!e.off && e.at <= end && (!next || e.at < next.at || (e.at === next.at && e.seq < next.seq))) next = e;
          if (!next) break;
          next.off = true;
          t = next.at;
          next.fn();
          due = due.filter((e) => !e.off);
          await settle();
        }
        t = end;
        await settle();
      },
      stop() { due = []; },
    };
  }
  if (kind !== 'real') throw new Error(`clock: 'real' or 'manual', not ${JSON.stringify(kind)}`);
  const live = new Set();
  return {
    after(ms, fn) {
      const h = setTimeout(() => { live.delete(h); fn(); }, ms);
      live.add(h);
      return () => { clearTimeout(h); live.delete(h); };
    },
    tick() { throw new Error('tick(ms) is for the manual clock only'); },
    stop() { for (const h of live) clearTimeout(h); live.clear(); },
  };
}

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const acceptOf = (key) => crypto.createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
const OPCODES = [0, 1, 2, 8, 9, 10];

// A frame: `len` forces the 7-, 16- or 64-bit length form (a longer form for a short payload is legal).
function encodeFrame(bytes, { opcode = 1, fin = true, mask = false, len, rsv = 0 } = {}) {
  const p = Buffer.from(bytes);
  const n = p.length;
  const form = len ?? (n < 126 ? 7 : n < 65536 ? 16 : 64);
  const head = [(fin ? 0x80 : 0) | ((rsv & 7) << 4) | (opcode & 0x0f)];
  const m = mask ? 0x80 : 0;
  let ext = Buffer.alloc(0);
  if (form === 7) {
    if (n > 125) throw new Error('a 7-bit length holds at most 125');
    head.push(m | n);
  } else if (form === 16) {
    head.push(m | 126); ext = Buffer.alloc(2); ext.writeUInt16BE(n);
  } else {
    head.push(m | 127); ext = Buffer.alloc(8); ext.writeUInt32BE(Math.floor(n / 2 ** 32)); ext.writeUInt32BE(n >>> 0, 4);
  }
  if (!mask) return Buffer.concat([Buffer.from(head), ext, p]);
  const key = crypto.randomBytes(4);
  const body = Buffer.alloc(n);
  for (let i = 0; i < n; i++) body[i] = p[i] ^ key[i & 3];
  return Buffer.concat([Buffer.from(head), ext, key, body]);
}
const closeFrame = (code) => {
  const b = Buffer.alloc(code == null ? 0 : 2);
  if (code != null) b.writeUInt16BE(code);
  return encodeFrame(b, { opcode: 8 });
};
// A server message (§3): one text frame, or, over 256 KB, a text frame then continuations, each at most 256 KB.
function messageFrames(m) {
  const b = Buffer.from(JSON.stringify(m));
  const max = LIMITS.serverFrameBytes;
  if (b.length <= max) return encodeFrame(b, { opcode: 1 });
  const out = [];
  for (let i = 0; i < b.length; i += max) out.push(encodeFrame(b.subarray(i, i + max), { opcode: i === 0 ? 1 : 0, fin: i + max >= b.length }));
  return Buffer.concat(out);
}
const utf8 = (buf) => new TextDecoder('utf-8', { fatal: true }).decode(buf);

// ---- the person headers (presence@1 §4), as presence's fake reads them ----

const NAME_RE = /^(?:[A-Za-z0-9\-_.!~*'()]|%[0-9A-Fa-f]{2})+$/;
// rawHeaders' values for one header name, however it was cased.
function rawValues(req, name) {
  const out = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === name) out.push(req.rawHeaders[i + 1]);
  return out;
}
function decodeName(s) {
  const bytes = [];
  for (let i = 0; i < s.length;) {
    if (s[i] === '%') { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 3; } else { bytes.push(s.charCodeAt(i)); i += 1; }
  }
  try { return utf8(Uint8Array.from(bytes)); } catch { return null; }
}
// The person of a request, or null when presence@1 §4 refuses it.
function personOf(req, ownerName) {
  const ps = rawValues(req, 'x-devteam-person');
  const ls = rawValues(req, 'x-devteam-level');
  if (ps.length > 1 || ls.length > 1) return null;
  if (ls.length && ls[0] !== 'full' && ls[0] !== 'view') return null;
  if (!ps.length) return ls.length ? null : { id: 'owner', name: cutName(ownerName), level: 'full' };
  const m = /^([^;]*);name=(.*)$/.exec(ps[0]);
  if (!m || !PERSON_ID_RE.test(m[1]) || !NAME_RE.test(m[2])) return null;
  const name = decodeName(m[2]);
  if (!name) return null;
  return { id: m[1], name: cutName(name), level: ls.length ? ls[0] : 'full' };
}
const validKey = (k) => typeof k === 'string' && /^[A-Za-z0-9+/]{22}==$/.test(k) && Buffer.from(k, 'base64').length === 16;
const urlOf = (url) => { try { return new URL(url, 'http://x'); } catch { return null; } };
const STATUS = {
  200: 'OK', 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 413: 'Payload Too Large',
  415: 'Unsupported Media Type', 423: 'Locked', 500: 'Internal Server Error', 501: 'Not Implemented', 503: 'Service Unavailable',
};
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
// An image by its first bytes: PNG, JPEG, WebP or GIF; anything else (SVG included) null.
function sniff(b) {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'))) return 'gif';
  return null;
}
const SESSION_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
const newSession = () => { let s = ''; for (const x of crypto.randomBytes(16)) s += SESSION_CHARS[x % 36]; return s; };
const exactKeys = (o, want) => isObj(o) && Object.keys(o).length === want.length && want.every((k) => own(o, k));
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export async function startCanvasFake({
  canvases = {}, main = {}, images = {}, folderBytes = {}, repo = { name: null, public: null }, ownerName = 'Owner',
  token = crypto.randomBytes(16).toString('hex'), clock = 'real', serve,
} = {}) {
  const clk = makeClock(clock);
  const sockets = new Set();
  const conns = new Set(); // every connection past welcome
  let port = 0;
  let connSeq = 0;
  const files = new Map(); // slug -> Map(file -> Buffer), the canvas's images/ (its branch's, then main's)
  for (const [slug, m] of Object.entries(images)) files.set(slug, new Map(Object.entries(m).map(([f, b]) => [f, Buffer.from(b)])));
  const filesOf = (slug) => { if (!files.has(slug)) files.set(slug, new Map()); return files.get(slug); };
  // docErrors' and applyEdit's folder: the image names, and every byte of the folder but canvas.json.
  const folderOf = (slug) => ({
    images: new Set(filesOf(slug).keys()),
    folderBytes: [...filesOf(slug).values()].reduce((s, b) => s + b.length, 0) + (own(folderBytes, slug) ? folderBytes[slug] : 0),
  });
  const valid = (slug, d, what) => {
    if (!SLUG_RE.test(slug)) throw new Error(`startCanvasFake: ${what} slug ${JSON.stringify(slug)} is not a slug`);
    const e = docErrors(d, folderOf(slug));
    if (e.length) throw new Error(`startCanvasFake: ${what} ${slug}: ${e[0].rule}: ${e[0].where}: ${e[0].message}`);
  };
  // A canvas open for editing. `session` is the open one, or the one its next session will use (§3).
  const live = new Map();
  const mains = new Map();
  const landed = new Set();
  const newCanvas = (slug, d) => ({
    slug, doc: structuredClone(d), saved: structuredClone(d), session: newSession(), open: false, book: makeSeqBook(),
    conns: [], people: new Map(), paused: null, savedCancel: null, selCancel: null,
  });
  for (const [slug, d] of Object.entries(canvases)) { valid(slug, d, 'canvas'); live.set(slug, newCanvas(slug, d)); }
  for (const [slug, d] of Object.entries(main)) { valid(slug, d, 'main'); mains.set(slug, structuredClone(d)); }

  const hostOk = (req) => req.headers.host === `127.0.0.1:${port}` || req.headers.host === `localhost:${port}`;
  const relayed = (req) => rawValues(req, 'x-devteam-relay').length > 0;

  // presence@1 §2's guards, in order, then the slug (§3); { who, cv }, or the status refusing it.
  function guardSocket(req, upgrade) {
    if (!hostOk(req)) return 403;
    if (relayed(req)) return 403;
    const u = urlOf(req.url);
    if (!u || u.pathname !== '/canvas') return 404;
    if (!upgrade || String(req.headers.upgrade || '').toLowerCase() !== 'websocket'
      || req.headers['sec-websocket-version'] !== '13' || !validKey(req.headers['sec-websocket-key'])) return 400;
    const origin = req.headers.origin;
    if (origin === undefined || origin !== `http://${req.headers.host}`) return 403;
    const who = personOf(req, ownerName);
    if (!who) return 403;
    const slug = u.searchParams.get('slug');
    if (slug === null || !SLUG_RE.test(slug) || !live.has(slug)) return 404;
    return { who, cv: live.get(slug) };
  }
  // The data GETs' guards (§8): the host check, the relay mark.
  const dataGuard = (req) => (!hostOk(req) || relayed(req) ? 403 : null);
  // The owner-action POSTs' guards (§8), in the contract's order.
  function ownerGuard(req) {
    if (!hostOk(req)) return 403;
    if (req.headers.origin !== `http://${req.headers.host}`) return 403;
    if (relayed(req)) return 403;
    const who = personOf(req, ownerName);
    if (!who || who.level !== 'full') return 403;
    const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (ct !== 'application/json') return 415;
    return null;
  }

  // ---- the socket: writing, windows, connections ----

  const write = (c, buf) => { if (c.open && !c.socket.destroyed) c.socket.write(buf); };
  const send = (c, m) => write(c, messageFrames(m));
  // One message to every connection on a canvas, built once; a build that throws closes them 1011.
  function toAll(cv, m) {
    const to = [...cv.conns];
    let f;
    try { f = messageFrames(m); } catch { for (const c of to) kill(c, 1011); return; }
    for (const c of to) safe(c, () => write(c, f));
  }
  const unsaved = (cv) => cv.doc.rev !== cv.saved.rev;
  function writeSaved(cv) {
    if (cv.savedCancel) { cv.savedCancel(); cv.savedCancel = null; }
    cv.saved = structuredClone(cv.doc);
    toAll(cv, { t: 'saved', rev: cv.doc.rev });
  }
  // §5: the first unsaved edit opens a 500 ms window; none while paused.
  function savedWindow(cv) {
    if (cv.paused || cv.savedCancel) return;
    cv.savedCancel = clk.after(LIMITS.savedMs, () => {
      cv.savedCancel = null;
      if (!cv.paused && live.get(cv.slug) === cv && unsaved(cv)) writeSaved(cv);
    });
  }
  const selectionsOf = (cv) => [...cv.people.values()].map((p) => ({ id: p.id, name: p.name, ids: [...p.ids] }));
  // §5: the first change opens a 250 ms window; one selections at its end carries all of them.
  function selectionsChanged(cv) {
    if (cv.selCancel) return;
    cv.selCancel = clk.after(LIMITS.selectionsMs, () => {
      cv.selCancel = null;
      if (live.get(cv.slug) === cv) toAll(cv, { t: 'selections', people: selectionsOf(cv) });
    });
  }
  // A deleted node leaves every selection.
  function dropDeleted(cv) {
    let changed = false;
    for (const p of cv.people.values()) {
      const keep = p.ids.filter((id) => own(cv.doc.nodes, id));
      if (keep.length !== p.ids.length) { p.ids = keep; changed = true; }
    }
    if (changed) selectionsChanged(cv);
  }
  const cancelWindows = (cv) => {
    if (cv.savedCancel) { cv.savedCancel(); cv.savedCancel = null; }
    if (cv.selCancel) { cv.selCancel(); cv.selCancel = null; }
  };

  function leave(c) {
    if (!conns.delete(c)) return;
    for (const cancel of Object.values(c.timers)) cancel();
    const cv = c.cv;
    const i = cv.conns.indexOf(c);
    if (i >= 0) cv.conns.splice(i, 1);
    const p = cv.people.get(c.who.id);
    if (p && --p.n === 0) { cv.people.delete(c.who.id); selectionsChanged(cv); }
    if (cv.conns.length === 0 && cv.open) {
      // the session ends with its last connection; the next one will use a new id (§3)
      cv.open = false;
      cv.session = newSession();
      if (cv.selCancel) { cv.selCancel(); cv.selCancel = null; }
    }
  }
  // Close a connection with `code` (a close frame, then the socket ended).
  function kill(c, code) {
    if (!c.open) return;
    try { c.socket.end(closeFrame(code)); } catch { /* gone */ }
    c.open = false;
    leave(c);
  }
  function safe(c, fn) {
    try { fn(); } catch { kill(c, 1011); }
  }
  // A repeating timer for `c`, through the clock.
  function every(c, name, ms, fn) {
    const arm = () => { c.timers[name] = clk.after(ms, () => { if (!c.open) return; safe(c, fn); if (c.open) arm(); }); };
    arm();
  }

  function accept(req, socket, head, who, cv) {
    socket.setNoDelay(true);
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptOf(req.headers['sec-websocket-key'])}\r\n\r\n`);
    // §7: counted from the handshake; one over is accepted and closed 1008 at once, before welcome.
    const openCanvases = [...live.values()].filter((x) => x.conns.length > 0).length;
    if (conns.size >= LIMITS.perServer || (cv.conns.length === 0 && openCanvases >= LIMITS.openCanvases)
      || cv.conns.length >= LIMITS.perCanvas || cv.conns.filter((x) => x.who.id === who.id).length >= LIMITS.perPerson) {
      socket.end(closeFrame(1008));
      return;
    }
    if (!cv.open) { cv.open = true; cv.book = makeSeqBook(); }
    const c = { conn: `c${++connSeq}`, who, cv, slug: cv.slug, socket, buf: Buffer.alloc(0), msg: null, open: true, timers: {}, messages: 0, sec: 0, unanswered: 0 };
    conns.add(c);
    cv.conns.push(c);
    if (!cv.people.has(who.id)) { cv.people.set(who.id, { id: who.id, name: who.name, ids: [], n: 0 }); selectionsChanged(cv); }
    cv.people.get(who.id).n += 1;
    send(c, { t: 'welcome', canvas: 1, session: cv.session, rev: cv.doc.rev, you: { id: who.id, conn: c.conn } });
    every(c, 'second', 1000, () => { c.sec = 0; });
    every(c, 'ping', LIMITS.pingMs, () => ping(c));
    const take = (d) => { if (!c.open) return; c.buf = c.buf.length ? Buffer.concat([c.buf, d]) : Buffer.from(d); parse(c); };
    socket.on('data', (d) => safe(c, () => take(d)));
    // The http server's sockets are half-open: a peer that ends without a close frame is gone too.
    socket.on('end', () => { c.open = false; leave(c); socket.end(); });
    socket.on('close', () => { c.open = false; leave(c); });
    if (head && head.length) safe(c, () => take(head));
  }

  // §7: a data message or a ping frame; the 31st in a second closes the connection at once.
  const counted = (c) => { c.messages += 1; c.sec += 1; if (c.sec > LIMITS.perSecond) { kill(c, 1008); return false; } return true; };
  function ping(c) {
    if (c.unanswered >= LIMITS.unansweredPings) { kill(c, 1001); return; }
    send(c, { t: 'ping' });
    c.unanswered += 1;
  }

  // presence@1 §2: a whole header first, checked for validity, then its length weighed, then the payload awaited.
  function parse(c) {
    while (c.open) {
      const b = c.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const rsv = b[0] & 0x70;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      const len7 = b[1] & 0x7f;
      const control = op >= 8;
      if (rsv || !OPCODES.includes(op) || !masked || (control && !fin)) return kill(c, 1002);
      if (op === 0 && !c.msg) return kill(c, 1002);
      if ((op === 1 || op === 2) && c.msg) return kill(c, 1002);
      const ext = len7 === 126 ? 2 : len7 === 127 ? 8 : 0;
      const start = 2 + ext + 4;
      if (b.length < start) return;
      let len = len7;
      if (ext === 2) len = b.readUInt16BE(2);
      else if (ext === 8) {
        const hi = b.readUInt32BE(2);
        if (hi >= 0x80000000) return kill(c, 1002);
        len = hi * 2 ** 32 + b.readUInt32BE(6);
      }
      if (control && len > 125) return kill(c, 1002);
      if (!control) {
        if (op === 2) return kill(c, 1008);
        const held = c.msg ? c.msg.size : 0;
        const frames = c.msg ? c.msg.parts.length : 0;
        if (held + len > LIMITS.pageMsgBytes || frames + 1 > LIMITS.pageFrames) return kill(c, 1008);
      }
      if (b.length < start + len) return;
      const key = b.subarray(start - 4, start);
      const payload = Buffer.alloc(len);
      for (let i = 0; i < len; i++) payload[i] = b[start + i] ^ key[i & 3];
      c.buf = b.subarray(start + len);
      if (control) controlFrame(c, op, payload);
      else {
        if (!c.msg) c.msg = { parts: [], size: 0 };
        c.msg.parts.push(payload);
        c.msg.size += len;
        if (fin) { const whole = Buffer.concat(c.msg.parts); c.msg = null; message(c, whole); }
      }
    }
  }

  function controlFrame(c, op, payload) {
    if (op === 8) { // a close: never counted; answered with a close and the socket ended
      try { c.socket.end(closeFrame(payload.length >= 2 ? payload.readUInt16BE(0) : null)); } catch { /* gone */ }
      c.open = false;
      leave(c);
      return;
    }
    if (op === 10) { c.messages += 1; c.unanswered = 0; return; } // a pong frame
    if (!counted(c)) return;
    write(c, encodeFrame(payload, { opcode: 10 }));
  }

  function message(c, buf) {
    let m;
    try { m = JSON.parse(utf8(buf)); } catch { return kill(c, 1008); }
    if (!isObj(m)) return kill(c, 1008);
    if (!counted(c)) return undefined;
    if (m.t === 'edit') return edit(c, m);
    if (m.t === 'select') return select(c, m);
    if (m.t === 'pong') { c.unanswered = 0; return undefined; }
    return undefined; // any other t is ignored
  }

  // §5: the seq book, then the whole-edit judgement; an applied edit to every connection, a refusal to its sender.
  function edit(c, m) {
    if (typeof m.client !== 'string' || !CLIENT_RE.test(m.client) || !safeInt(m.seq, 1)) return kill(c, 1008);
    const cv = c.cv;
    const by = { id: c.who.id, name: c.who.name, via: 'page' };
    const ack = { client: m.client, seq: m.seq };
    const j = cv.book.judge(m.client, m.seq);
    if (j === 'reack') return send(c, { t: 'ops', rev: cv.doc.rev, by, ack, ops: [] });
    if (isObj(j)) return send(c, { t: 'refused', client: m.client, seq: m.seq, why: j.refused });
    const r = applyEdit(cv.doc, m.ops, { ...folderOf(cv.slug), level: c.who.level });
    cv.book.record(m.client, m.seq, r.why);
    if (r.why) return send(c, { t: 'refused', client: m.client, seq: m.seq, why: r.why });
    cv.doc = r.doc;
    toAll(cv, { t: 'ops', rev: cv.doc.rev, by, ack, ops: m.ops });
    savedWindow(cv);
    dropDeleted(cv);
    return undefined;
  }

  // §5: at most 100 ids of the id class, else ignored; ids naming no node dropped; the person's latest.
  function select(c, m) {
    if (!Array.isArray(m.ids) || m.ids.length > LIMITS.selectIds || !m.ids.every((x) => typeof x === 'string' && NODE_ID_RE.test(x))) return;
    const cv = c.cv;
    const ids = [...new Set(m.ids)].filter((id) => own(cv.doc.nodes, id));
    const p = cv.people.get(c.who.id);
    if (!p || sameList(p.ids, ids)) return;
    p.ids = ids;
    selectionsChanged(cv);
  }

  // ---- the routes (§8) ----

  function reply(res, status, body = null, headers = {}) {
    const json = body !== null && !Buffer.isBuffer(body);
    const b = body === null ? Buffer.alloc(0) : json ? Buffer.from(JSON.stringify(body)) : body;
    const h = { ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers, 'Content-Length': b.length };
    res.writeHead(status, STATUS[status], h);
    res.end(b);
  }
  // A refusal before the body is read: the connection closes after it.
  const early = (res, status, body = null) => reply(res, status, body, { Connection: 'close' });
  const declared = (req) => (req.headers['content-length'] === undefined ? 0 : Number(req.headers['content-length']));
  // The body, or null once it passes `limit` (it stops being kept).
  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const parts = [];
      let n = 0;
      let over = false;
      req.on('data', (d) => {
        if (over) return;
        n += d.length;
        if (n > limit) { over = true; parts.length = 0; resolve(null); return; }
        parts.push(d);
      });
      req.on('end', () => { if (!over) resolve(Buffer.concat(parts)); });
      req.on('error', reject);
    });
  }
  const jsonOf = (buf) => { try { return { v: JSON.parse(utf8(buf)) }; } catch { return null; } };

  function docRoute(req, res, q) {
    const g = dataGuard(req);
    if (g) return reply(res, g);
    const slug = q.get('slug');
    const at = q.get('at');
    const repoOut = { name: repo.name ?? null, public: repo.public ?? null };
    if (at === 'main') {
      const d = slug === null ? null : mains.get(slug);
      if (!d) return reply(res, 404);
      return reply(res, 200, { session: null, rev: d.rev, doc: d, repo: repoOut });
    }
    const cv = at === null && slug !== null ? live.get(slug) : null;
    if (!cv) return reply(res, 404);
    return reply(res, 200, { session: cv.session, rev: cv.doc.rev, doc: cv.doc, repo: repoOut });
  }

  async function imagePost(req, res, q) {
    const g = ownerGuard(req);
    if (g) return early(res, g);
    if (declared(req) > LIMITS.imageBodyBytes) return early(res, 413);
    const body = await readBody(req, LIMITS.imageBodyBytes);
    if (!body) return early(res, 413);
    const slug = q.get('slug');
    const cv = slug === null ? null : live.get(slug);
    if (!cv && landed.has(slug)) return reply(res, 423);
    if (!cv) return reply(res, 404);
    const j = jsonOf(body);
    const v = j && j.v;
    if (!exactKeys(v, ['name', 'data']) || typeof v.name !== 'string' || v.name.length === 0 || SIMPLE.name(v.name)
      || typeof v.data !== 'string' || v.data.length === 0 || !base64Ok(v.data)) return reply(res, 400);
    const bytes = Buffer.from(v.data, 'base64');
    if (bytes.length > LIMITS.imageBytes) return reply(res, 413);
    const ext = sniff(bytes);
    if (!ext) return reply(res, 415);
    const file = `${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${ext}`;
    const have = filesOf(slug);
    const add = have.has(file) ? 0 : bytes.length;
    if (writtenBytes(cv.doc) + folderOf(slug).folderBytes + add > LIMITS.folderBytes) return reply(res, 413);
    have.set(file, bytes);
    return reply(res, 200, { src: `images/${file}` });
  }

  function imageGet(req, res, rawPath) {
    const g = dataGuard(req);
    if (g) return reply(res, g);
    // nothing from the URL is joined to a path unless it matches: the raw path, undecoded
    const rest = rawPath.slice('/api/canvas/image/'.length).split('/');
    if (rest.length !== 2 || !SLUG_RE.test(rest[0]) || !IMAGE_FILE_RE.test(rest[1])) return reply(res, 404);
    const [slug, file] = rest;
    const b = live.has(slug) || mains.has(slug) ? filesOf(slug).get(file) : undefined;
    if (!b) return reply(res, 404);
    return reply(res, 200, b, { 'Content-Type': IMAGE_TYPES[file.split('.')[1]], 'X-Content-Type-Options': 'nosniff' });
  }

  // A local apply's runs: consecutive ops whose `ops` message fits 1 MB, or null when one op alone passes it.
  function runsOf(base, by, ops) {
    const head = (rev) => Buffer.byteLength(JSON.stringify({ t: 'ops', rev, by, ack: null, ops: [] }));
    const runs = [];
    let cur = [];
    let bytes = 0;
    for (const op of ops) {
      const n = Buffer.byteLength(JSON.stringify(op));
      const rev = base + runs.length + 1;
      if (cur.length && head(rev) + bytes + 1 + n <= LIMITS.serverMsgBytes) { cur.push(op); bytes += 1 + n; continue; }
      if (cur.length) runs.push(cur);
      if (head(base + runs.length + 1) + n > LIMITS.serverMsgBytes) return null;
      cur = [op];
      bytes = n;
    }
    if (cur.length) runs.push(cur);
    return runs;
  }

  async function localRoute(req, res, q) {
    if (!hostOk(req)) return early(res, 403);
    for (const h of ['origin', 'sec-fetch-site', 'x-devteam-relay', 'x-devteam-person', 'x-devteam-level']) if (rawValues(req, h).length) return early(res, 403);
    const tk = rawValues(req, 'x-devteam-canvas-token');
    if (tk.length !== 1 || tk[0] !== token) return early(res, 403);
    if (declared(req) > LIMITS.localBodyBytes) return early(res, 413);
    const body = await readBody(req, LIMITS.localBodyBytes);
    if (!body) return early(res, 413);
    const slug = q.get('slug');
    const cv = slug === null ? null : live.get(slug);
    if (!cv && landed.has(slug)) return reply(res, 423, { why: 'closed' });
    if (!cv) return reply(res, 404);
    if (!cv.open) return reply(res, 503, { why: 'no-session' });
    const j = jsonOf(body);
    const v = j && j.v;
    if (!exactKeys(v, ['by', 'via', 'ops']) || typeof v.by !== 'string' || !BY_RE.test(v.by) || (v.via !== 'apply' && v.via !== 'take') || !Array.isArray(v.ops)) return reply(res, 400);
    // one judgement, then one change, sent as consecutive ops messages before any other edit is taken
    const r = applyEdit(cv.doc, v.ops, { ...folderOf(slug), maxOpsBytes: null });
    if (r.why) return reply(res, 409, { why: r.why });
    const by = { id: v.by, name: v.by, via: v.via };
    const base = cv.doc.rev;
    const runs = runsOf(base, by, v.ops);
    if (!runs) return reply(res, 409, { why: 'limit' });
    cv.doc = r.doc;
    cv.doc.rev = base + runs.length;
    runs.forEach((ops, i) => toAll(cv, { t: 'ops', rev: base + i + 1, by, ack: null, ops }));
    dropDeleted(cv);
    // the answer waits for the disk: written at once, unless saving is paused
    if (cv.paused) return reply(res, 200, { rev: cv.doc.rev, edits: runs.length, saved: false });
    writeSaved(cv);
    return reply(res, 200, { rev: cv.doc.rev, edits: runs.length, saved: true });
  }

  async function importRoute(req, res) {
    const g = ownerGuard(req);
    if (g) return early(res, g);
    if (declared(req) > LIMITS.importBodyBytes) return early(res, 413);
    if (!await readBody(req, LIMITS.importBodyBytes)) return early(res, 413);
    return reply(res, 501);
  }

  async function handle(req, res) {
    const raw = req.url.split('?')[0];
    const u = urlOf(req.url);
    const q = u ? u.searchParams : new URLSearchParams();
    if (raw === '/canvas') return reply(res, guardSocket(req, false));
    if (req.method === 'GET' && raw === '/api/canvas/doc') return docRoute(req, res, q);
    if (req.method === 'POST' && raw === '/api/canvas/image') return imagePost(req, res, q);
    if (req.method === 'GET' && raw.startsWith('/api/canvas/image/')) return imageGet(req, res, raw);
    if (req.method === 'POST' && raw === '/api/canvas/local') return localRoute(req, res, q);
    if (req.method === 'POST' && raw === '/api/canvas/import') return importRoute(req, res);
    if (serve) return serve(req, res);
    return reply(res, 404); // export, edit and the rest: later tickets'
  }

  const server = http.createServer((req, res) => {
    Promise.resolve().then(() => handle(req, res)).catch(() => {
      try { if (!res.headersSent) early(res, 500); else res.destroy(); } catch { /* gone */ }
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    try {
      const r = guardSocket(req, true);
      if (typeof r === 'number') {
        socket.end(`HTTP/1.1 ${r} ${STATUS[r]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
        return;
      }
      accept(req, socket, head, r.who, r.cv);
    } catch {
      socket.destroy();
    }
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;

  const need = (slug) => {
    const cv = live.get(slug);
    if (!cv) throw new Error(`no canvas ${JSON.stringify(slug)} open for editing`);
    return cv;
  };
  // §5's closed: the message, then a close with 1000; the slug is no longer open for editing.
  function closeCanvas(cv, why) {
    live.delete(cv.slug);
    cancelWindows(cv);
    for (const c of [...cv.conns]) { send(c, { t: 'closed', why }); kill(c, 1000); }
  }

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    token,
    async close() {
      clk.stop();
      for (const c of conns) c.open = false;
      conns.clear();
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(() => r()));
    },
    doc(slug) { const d = live.has(slug) ? live.get(slug).doc : mains.get(slug); return d === undefined ? undefined : structuredClone(d); },
    rev: (slug) => need(slug).doc.rev,
    session: (slug) => need(slug).session,
    save(slug) { writeSaved(need(slug)); },
    pause(slug, why = 'branch-moved') {
      if (!PAUSE_WHYS.includes(why)) throw new Error(`pause: why one of ${PAUSE_WHYS.join(', ')}`);
      const cv = need(slug);
      cv.paused = why;
      if (cv.savedCancel) { cv.savedCancel(); cv.savedCancel = null; }
      toAll(cv, { t: 'paused', why });
    },
    resume(slug) {
      const cv = need(slug);
      cv.paused = null;
      toAll(cv, { t: 'resumed' });
      if (unsaved(cv)) writeSaved(cv);
    },
    // §5: the document replaced whole (it is the file now): rev the old one plus one, a new session on
    // the open connections, every client's seq forgotten.
    replace(slug, doc) {
      const cv = need(slug);
      const d = { ...structuredClone(doc), rev: cv.doc.rev + 1 };
      valid(slug, d, 'replace');
      if (cv.savedCancel) { cv.savedCancel(); cv.savedCancel = null; }
      cv.doc = d;
      cv.saved = structuredClone(d);
      cv.session = newSession();
      cv.book = makeSeqBook();
      toAll(cv, { t: 'reload', session: cv.session });
      dropDeleted(cv);
    },
    land(slug) {
      const cv = need(slug);
      mains.set(slug, structuredClone(cv.doc));
      landed.add(slug);
      closeCanvas(cv, 'landed');
    },
    remove(slug) { closeCanvas(need(slug), 'removed'); },
    // Every connection closed 1012, the canvas back to its last saved document, a new session id.
    restart(slug) {
      const cv = need(slug);
      for (const c of [...cv.conns]) kill(c, 1012);
      cancelWindows(cv);
      cv.doc = structuredClone(cv.saved);
      cv.people.clear();
      cv.open = false;
      cv.session = newSession();
      cv.book = makeSeqBook();
    },
    stats: () => [...conns].map((c) => ({ conn: c.conn, id: c.who.id, slug: c.slug, messages: c.messages })),
    tick(ms) {
      if (clock !== 'manual') throw new Error('tick(ms) is for the manual clock only');
      return clk.tick(ms);
    },
  };
}

// ---- the client (§14) ----

// The request lines: `base` unless `headers` names one (null leaves it out, an array repeats it).
function headerLines(base, headers) {
  const given = new Set(Object.keys(headers).map((k) => k.toLowerCase()));
  const lines = base.filter(([k]) => !given.has(k.toLowerCase())).map(([k, v]) => `${k}: ${v}`);
  for (const [k, v] of Object.entries(headers)) if (v != null) for (const x of [].concat(v)) lines.push(`${k}: ${x}`);
  return lines;
}
// host, port and the raw path of `url`, which is never normalised (so `..` and `%2e` reach the server).
function splitUrl(url) {
  const m = /^http:\/\/([^/?#]+)([^#]*)$/.exec(url);
  if (!m) throw new Error(`not an http URL: ${url}`);
  const [hostname, port] = m[1].split(':');
  return { hostname, port: Number(port || 80), rest: m[2] || '/' };
}

// A WebSocket client over `net` for the fake (or a real server): openPresence's, with `slug` as the
// query and continuation frames joined into one message. It resolves on whichever comes first: a
// non-101 status, `welcome`, or the socket closing. `headers` adds or overrides request headers (null
// leaves one out, an array repeats it); `origin: null` sends none; `keep: false` keeps only frame sizes
// after welcome. `frames` lists each frame read ({ opcode, fin, len }).
export function openCanvas(url, { slug, headers = {}, origin, host, keep = true } = {}) {
  const u = splitUrl(url);
  const port = u.port;
  const hostH = host ?? `127.0.0.1:${port}`;
  const originH = origin === undefined ? `http://${hostH}` : origin;
  const q = u.rest.indexOf('?');
  const pathname = q < 0 ? u.rest : u.rest.slice(0, q);
  const search = q < 0 ? '' : u.rest.slice(q);
  const where = `${pathname && pathname !== '/' ? pathname : '/canvas'}${search || (slug === undefined ? '' : `?slug=${slug}`)}`;
  const key = crypto.randomBytes(16).toString('base64');
  const base = [['Host', hostH], ['Upgrade', 'websocket'], ['Connection', 'Upgrade'], ['Sec-WebSocket-Key', key], ['Sec-WebSocket-Version', '13']];
  if (originH !== null) base.push(['Origin', originH]);
  const lines = headerLines(base, headers);

  return new Promise((resolve) => {
    const sock = net.connect({ host: u.hostname, port });
    sock.setNoDelay(true);
    sock.on('error', () => {});
    let buf = Buffer.alloc(0);
    let shook = false;
    let settled = false;
    let code = null;
    let parts = null; // the fragments of a message not yet whole
    let closedResolve;
    const returned = new Set();
    const waiters = [];
    const c = {
      status: undefined, headers: {}, key, you: undefined, messages: [], sizes: [], frames: [], controls: [],
      closed: new Promise((r) => { closedResolve = r; }),
      build: (bytes, opts = {}) => encodeFrame(bytes, { mask: true, ...opts }),
      raw: (bytes) => { if (!sock.destroyed) sock.write(Buffer.from(bytes)); },
      frame: (bytes, opts = {}) => c.raw(c.build(bytes, opts)),
      send: (obj) => c.frame(Buffer.from(JSON.stringify(obj))),
      close(closeCode = 1000) { const b = Buffer.alloc(2); b.writeUInt16BE(closeCode); c.raw(c.build(b, { opcode: 8 })); sock.end(); },
      destroy: () => sock.destroy(),
      next(pred, ms = 2000) {
        const test = (m) => { try { return pred(m); } catch { return false; } };
        for (let i = 0; i < c.messages.length; i++) {
          if (!returned.has(i) && test(c.messages[i])) { returned.add(i); return Promise.resolve(c.messages[i]); }
        }
        return new Promise((res, rej) => {
          const w = { test, res, timer: null };
          w.timer = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); rej(new Error(`next: no matching message in ${ms} ms`)); }, ms);
          waiters.push(w);
        });
      },
    };
    const done = () => { if (!settled) { settled = true; resolve(c); } };
    function got(m) {
      const i = c.messages.push(m) - 1;
      for (const w of [...waiters]) {
        if (!returned.has(i) && w.test(m)) { returned.add(i); clearTimeout(w.timer); waiters.splice(waiters.indexOf(w), 1); w.res(m); }
      }
    }
    function frames() {
      while (buf.length >= 2) {
        const fin = (buf[0] & 0x80) !== 0;
        const op = buf[0] & 0x0f;
        const l7 = buf[1] & 0x7f;
        const masked = (buf[1] & 0x80) !== 0;
        let off = 2;
        let len = l7;
        if (l7 === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        if (l7 === 127) { if (buf.length < 10) return; len = buf.readUInt32BE(2) * 2 ** 32 + buf.readUInt32BE(6); off = 10; }
        const mk = masked ? buf.subarray(off, off + 4) : null;
        if (masked) off += 4;
        if (buf.length < off + len) return;
        const p = Buffer.from(buf.subarray(off, off + len));
        if (mk) for (let i = 0; i < p.length; i++) p[i] ^= mk[i & 3];
        buf = buf.subarray(off + len);
        c.sizes.push(len);
        c.frames.push({ opcode: op, fin, len });
        if (op === 1 || op === 0) {
          if (op === 1) parts = [p]; else if (parts) parts.push(p);
          if (fin && parts) {
            const whole = parts.length === 1 ? parts[0] : Buffer.concat(parts);
            parts = null;
            if (keep || c.you === undefined) {
              const m = JSON.parse(whole.toString('utf8'));
              got(m);
              if (c.you === undefined && m.t === 'welcome') { c.you = m.you; done(); }
            }
          }
        } else if (op === 8) {
          code = p.length >= 2 ? p.readUInt16BE(0) : 1005;
          sock.end();
        } else c.controls.push({ opcode: op, payload: p });
      }
    }
    sock.on('connect', () => sock.write(`GET ${where} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`));
    sock.on('data', (d) => {
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      if (!shook) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        const [first, ...rest] = buf.subarray(0, i).toString('latin1').split('\r\n');
        c.status = Number(first.split(' ')[1]);
        for (const line of rest) { const j = line.indexOf(':'); if (j > 0) c.headers[line.slice(0, j).trim().toLowerCase()] = line.slice(j + 1).trim(); }
        buf = buf.subarray(i + 4);
        shook = true;
        if (c.status !== 101) { done(); return; }
      }
      frames();
    });
    sock.on('close', () => { closedResolve(code ?? 1006); done(); });
  });
}

// An HTTP/1.1 request over `net`, so a test can declare a `contentLength` it doesn't send (the body is
// sent only when given). `body`: a Buffer or string as is, anything else as JSON. `headers` adds or
// overrides (null leaves one out). Resolves { status, headers, body (Buffer), json (parsed when the
// response says application/json, else undefined) }.
export function request(url, { method = 'GET', headers = {}, body, contentLength } = {}) {
  const u = splitUrl(url);
  const b = body === undefined || body === null ? null : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const base = [['Host', `127.0.0.1:${u.port}`], ['Connection', 'close']];
  const len = contentLength ?? (b ? b.length : null);
  if (len !== null) base.push(['Content-Length', String(len)]);
  const lines = headerLines(base, headers);
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: u.hostname, port: u.port });
    let buf = Buffer.alloc(0);
    let head = null;
    let finished = false;
    const finish = (out) => {
      if (finished) return;
      finished = true;
      sock.destroy();
      const json = /application\/json/.test(head.headers['content-type'] || '') ? JSON.parse(out.toString('utf8')) : undefined;
      resolve({ status: head.status, headers: head.headers, body: out, json });
    };
    // A chunked body, or null while it is incomplete.
    const unchunk = (x) => {
      const out = [];
      let i = 0;
      for (;;) {
        const j = x.indexOf('\r\n', i);
        if (j < 0) return null;
        const n = parseInt(x.subarray(i, j).toString('latin1'), 16);
        if (n === 0) return Buffer.concat(out);
        if (x.length < j + 2 + n + 2) return null;
        out.push(x.subarray(j + 2, j + 2 + n));
        i = j + 2 + n + 2;
      }
    };
    function tryFinish(atClose) {
      if (!head) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        const [first, ...rest] = buf.subarray(0, i).toString('latin1').split('\r\n');
        const hs = {};
        for (const line of rest) { const j = line.indexOf(':'); if (j > 0) hs[line.slice(0, j).trim().toLowerCase()] = line.slice(j + 1).trim(); }
        head = { status: Number(first.split(' ')[1]), headers: hs };
        buf = buf.subarray(i + 4);
      }
      const h = head.headers;
      if (h['content-length'] !== undefined) {
        const n = Number(h['content-length']);
        if (buf.length >= n) finish(buf.subarray(0, n));
      } else if (/chunked/i.test(h['transfer-encoding'] || '')) {
        const out = unchunk(buf);
        if (out) finish(out);
      } else if (atClose) finish(buf);
    }
    sock.on('connect', () => {
      sock.write(`${method} ${u.rest} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
      if (b) sock.write(b);
    });
    sock.on('data', (d) => {
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      try { tryFinish(false); } catch (e) { finished = true; sock.destroy(); reject(e); }
    });
    // an early answer (a 413 from Content-Length) may close the socket while a body is still going out
    sock.on('error', () => {});
    sock.on('close', () => {
      if (finished) return;
      try { if (head || buf.length) tryFinish(true); } catch (e) { finished = true; reject(e); return; }
      if (!finished) { finished = true; reject(new Error(`request ${method} ${u.rest}: closed with no whole response`)); }
    });
  });
}

// ---- the HTTP fixtures (§14) ----

const HTTP_FIXTURE_KEYS = ['fake', 'request', 'status', 'requestKind', 'responseKind'];
const FAKE_FIXTURE_KEYS = ['canvases', 'main', 'images', 'folderBytes', 'repo', 'ownerName', 'token', 'clock'];
// The fake's options from a fixture's `fake`: documents and images named by fixture file.
function fixtureOptions(fake, fixturesDir) {
  const out = { clock: 'manual' };
  const readDoc = (f) => JSON.parse(fs.readFileSync(path.join(fixturesDir, f), 'utf8'));
  for (const k of Object.keys(fake)) {
    if (!FAKE_FIXTURE_KEYS.includes(k)) throw new Error(`fake: an option ${JSON.stringify(k)} a fixture can't give`);
    if (k === 'canvases' || k === 'main') out[k] = Object.fromEntries(Object.entries(fake[k]).map(([slug, f]) => [slug, readDoc(f)]));
    else if (k === 'images') out[k] = Object.fromEntries(Object.entries(fake[k]).map(([slug, names]) => [slug, Object.fromEntries(names.map((n) => [n, fs.readFileSync(path.join(fixturesDir, 'images', n))]))]));
    else out[k] = fake[k];
  }
  return out;
}

// Plays one http-<route key>-<case>.json: starts the fake, sends the request, checks the status, the
// request's and response's kinds by shapeErrors, and the response body exactly when given. In the
// request's headers `"$origin"` is the fake's own origin, `http://<Host>`.
export async function playHttp(file, { fixturesDir }) {
  const where = path.isAbsolute(file) ? file : path.join(fixturesDir, file);
  const name = path.basename(where);
  const fx = JSON.parse(fs.readFileSync(where, 'utf8'));
  assert.ok(isObj(fx), `${name}: an object`);
  for (const k of HTTP_FIXTURE_KEYS) assert.ok(own(fx, k), `${name}: has ${k}`);
  for (const k of Object.keys(fx)) assert.ok([...HTTP_FIXTURE_KEYS, 'response'].includes(k), `${name}: no key ${k}`);
  const r = fx.request;
  assert.ok(isObj(r) && typeof r.method === 'string' && typeof r.path === 'string' && r.path.startsWith('/') && isObj(r.headers), `${name}: request { method, path, headers }`);
  for (const k of Object.keys(r)) assert.ok(['method', 'path', 'headers', 'body', 'contentLength'].includes(k), `${name}: request has no key ${k}`);
  for (const k of ['requestKind', 'responseKind']) assert.ok(fx[k] === null || HTTP_KINDS.includes(fx[k]), `${name}: ${k} an HTTP_KINDS entry or null`);
  if (fx.requestKind !== null) {
    assert.ok(own(r, 'body'), `${name}: a requestKind with a body`);
    assert.deepEqual(shapeErrors(fx.requestKind, r.body), [], `${name}: the request holds to ${fx.requestKind}`);
  }
  if (own(fx, 'response')) assert.notEqual(fx.responseKind, null, `${name}: a response has a responseKind`);
  const fake = await startCanvasFake(fixtureOptions(fx.fake, fixturesDir));
  try {
    const headers = {};
    for (const [k, v] of Object.entries(r.headers)) headers[k] = v === '$origin' ? `http://127.0.0.1:${fake.port}` : v;
    const res = await request(`${fake.url}${r.path}`, { method: r.method, headers, body: r.body, contentLength: r.contentLength });
    assert.equal(res.status, fx.status, `${name}: status`);
    if (fx.responseKind === null) {
      assert.equal(res.json, undefined, `${name}: no JSON body`);
      return;
    }
    assert.notEqual(res.json, undefined, `${name}: a JSON body`);
    assert.deepEqual(shapeErrors(fx.responseKind, res.json), [], `${name}: the response holds to ${fx.responseKind}`);
    if (own(fx, 'response')) assert.deepEqual(res.json, fx.response, `${name}: the response`);
  } finally {
    await fake.close();
  }
}

// ---- the exchanges (§14) ----

const EXCHANGE_KEYS = ['canvas', 'slug', 'images', 'steps'];
const STEP_KEYS = {
  open: ['open', 'person', 'level', 'status'],
  as: ['as', 'send', 'close'],
  local: ['local', 'status', 'body'],
  do: ['do', 'arg'],
  tick: ['tick'],
};
const CONTROLS = ['save', 'pause', 'resume', 'replace', 'land', 'remove', 'restart'];
const BROKEN_BODY = [403, 413, 400]; // a local step's statuses that may exercise a broken body
const DOC_FIXTURE_RE = /^(?:doc-[a-z0-9-]+|hostile)\.json$/;
const actionOf = (s) => Object.keys(STEP_KEYS).filter((k) => own(s, k));
const readFixture = (fixturesDir, f) => JSON.parse(fs.readFileSync(path.join(fixturesDir, f), 'utf8'));
// The folder an exchange's documents are judged with: its images, by name, and their bytes.
function exchangeFolder(x, fixturesDir) {
  const names = Array.isArray(x.images) ? x.images : [];
  const bytes = Object.fromEntries(names.map((n) => [n, fs.readFileSync(path.join(fixturesDir, 'images', n))]));
  return { bytes, images: new Set(names), folderBytes: Object.values(bytes).reduce((s, b) => s + b.length, 0) };
}

// The fake's options for an exchange: its canvas open for editing under its slug, with its images, on
// the manual clock.
export function exchangeOptions(x, { fixturesDir }) {
  const { bytes } = exchangeFolder(x, fixturesDir);
  return { clock: 'manual', canvases: { [x.slug]: readFixture(fixturesDir, x.canvas) }, images: { [x.slug]: bytes } };
}

// A copy of an expected message with its placeholders filled: "$session" by `session`, "$conn:<name>"
// by that connection's conn (`conns` name -> conn, or a stand-in when only the shape matters).
function filled(v, session, conns) {
  if (typeof v === 'string') {
    if (v === '$session') return session;
    if (v.startsWith('$conn:') && conns.has(v.slice('$conn:'.length))) return conns.get(v.slice('$conn:'.length));
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => filled(x, session, conns));
  if (isObj(v)) return Object.fromEntries(Object.keys(v).map((k) => [k, filled(v[k], session, conns)]));
  return v;
}
const isClose = (m) => isObj(m) && own(m, '$close');

// Every way an exchange breaks §14's rules, as strings naming the step; empty when it holds: its keys
// and steps, the connections it names, every sent and expected message's shape (a sent one off its
// shape only when the same step expects a `refused` `shape` for it or the sender's `$close` 1008),
// every document valid, a local step's body and response by their kinds, and no ping falling due.
export function exchangeProblems(x, { fixturesDir }) {
  const out = [];
  if (!isObj(x)) return ['not an object'];
  for (const k of ['canvas', 'slug', 'steps']) if (!own(x, k)) out.push(`no ${k}`);
  for (const k of Object.keys(x)) if (!EXCHANGE_KEYS.includes(k)) out.push(`an extra key ${k}`);
  if (typeof x.slug !== 'string' || !SLUG_RE.test(x.slug)) out.push('slug: not a slug');
  if (own(x, 'images') && (!Array.isArray(x.images) || !x.images.every((n) => typeof n === 'string' && IMAGE_FILE_RE.test(n) && fs.existsSync(path.join(fixturesDir, 'images', n))))) {
    out.push('images: not names of files in the fixtures\' images/');
    return out;
  }
  const folder = exchangeFolder(x, fixturesDir);
  const docProblem = (where, d) => { const e = docErrors(d, folder); if (e.length) out.push(`${where}: doc: ${e[0].rule}: ${e[0].where}: ${e[0].message}`); };
  const fixtureDoc = (where, f) => {
    if (typeof f !== 'string' || !DOC_FIXTURE_RE.test(f) || !fs.existsSync(path.join(fixturesDir, f))) { out.push(`${where}: not a document fixture`); return; }
    docProblem(where, readFixture(fixturesDir, f));
  };
  fixtureDoc('canvas', x.canvas);
  if (!Array.isArray(x.steps) || x.steps.length === 0) { out.push('steps: not a list of steps'); return out; }
  const named = new Set(); // every connection opened so far
  const stand = new Map();
  let ticks = 0;
  x.steps.forEach((s, i) => {
    const where = `step ${i + 1}`;
    if (!isObj(s)) { out.push(`${where}: not an object`); return; }
    const acts = actionOf(s);
    if (acts.length !== 1) { out.push(`${where}: not one action of ${Object.keys(STEP_KEYS).join(', ')}`); return; }
    const act = acts[0];
    for (const k of Object.keys(s)) if (![...STEP_KEYS[act], 'expect', 'doc'].includes(k)) out.push(`${where}: an extra key ${k}`);
    const expect = own(s, 'expect') ? s.expect : {};
    if (act === 'open') {
      if (typeof s.open !== 'string' || s.open.length === 0) out.push(`${where}: open: not a name`);
      else if (named.has(s.open)) out.push(`${where}: open: ${s.open} named twice`);
      if (!own(s, 'person') || (s.person !== null && typeof s.person !== 'string')) out.push(`${where}: person: a header value or null`);
      if (!own(s, 'level') || ![null, 'full', 'view'].includes(s.level)) out.push(`${where}: level: full, view or null`);
      if (own(s, 'status') && !Number.isInteger(s.status)) out.push(`${where}: status: not a status`);
      if (!own(s, 'status') || s.status === 101) { named.add(s.open); stand.set(s.open, `c${stand.size + 1}`); }
      else if (own(expect, s.open)) out.push(`${where}: expect: ${s.open} is refused, so it receives nothing`);
    } else if (act === 'as') {
      if (!named.has(s.as)) out.push(`${where}: as: ${s.as} is no connection opened before`);
      if (own(s, 'send') === own(s, 'close')) out.push(`${where}: as: one of send or close`);
      if (own(s, 'close') && s.close !== true) out.push(`${where}: close: true`);
    } else if (act === 'local') {
      if (!Number.isInteger(s.status)) out.push(`${where}: status: not a status`);
      if (!BROKEN_BODY.includes(s.status)) for (const e of shapeErrors('local-request', s.local)) out.push(`${where}: local: ${e}`);
      if (own(s, 'body')) for (const e of shapeErrors(s.status === 200 ? 'local-response' : 'error-response', s.body)) out.push(`${where}: body: ${e}`);
    } else if (act === 'do') {
      if (!CONTROLS.includes(s.do)) out.push(`${where}: do: ${JSON.stringify(s.do)} is not one of ${CONTROLS.join(', ')}`);
      else if (s.do === 'pause') { if (own(s, 'arg') && !PAUSE_WHYS.includes(s.arg)) out.push(`${where}: arg: ${JSON.stringify(s.arg)} is not a paused why`); }
      else if (s.do === 'replace') fixtureDoc(`${where}: arg`, s.arg);
      else if (own(s, 'arg')) out.push(`${where}: arg: ${s.do} takes none`);
    } else if (act === 'tick') {
      if (!Number.isInteger(s.tick) || s.tick <= 0) out.push(`${where}: tick: not a positive integer of ms`);
      else ticks += s.tick;
      if (ticks >= LIMITS.pingMs) out.push(`${where}: tick: ${ticks} ms in all lets a ping fall due`);
    }
    if (!isObj(expect)) { out.push(`${where}: expect: not an object`); return; }
    for (const [name, list] of Object.entries(expect)) {
      if (!named.has(name)) { out.push(`${where}: expect: ${name} is no connection opened by then`); continue; }
      if (!Array.isArray(list)) { out.push(`${where}: expect ${name}: not a list`); continue; }
      list.forEach((m, j) => {
        const w = `${where}: expect ${name}[${j}]`;
        if (isClose(m)) {
          if (j !== list.length - 1) out.push(`${w}: a $close only last`);
          if (Object.keys(m).length !== 1 || !Number.isInteger(m.$close)) out.push(`${w}: exactly { "$close": <code> }`);
          return;
        }
        if (!isObj(m) || !SERVER_KINDS.includes(m.t)) { out.push(`${w}: unknown kind ${JSON.stringify(isObj(m) ? m.t : m)}`); return; }
        if (m.t === 'ping') out.push(`${w}: a ping never falls due inside an exchange`);
        JSON.stringify(m).replace(/"\$conn:([^"]*)"/g, (all, n) => { if (!named.has(n)) out.push(`${w}: ${all.slice(1, -1)} names no connection`); return all; });
        for (const e of shapeErrors(m.t, filled(m, 'aaaaaaaaaaaaaaaa', stand))) out.push(`${w}: ${e}`);
      });
    }
    if (act === 'as' && own(s, 'send')) {
      const m = s.send;
      const errs = isObj(m) && PAGE_KINDS.includes(m.t) ? shapeErrors(m.t, m) : [`unknown kind ${JSON.stringify(isObj(m) ? m.t : m)}`];
      const mine = Array.isArray(expect[s.as]) ? expect[s.as] : [];
      const excused = mine.some((r) => isObj(r) && r.t === 'refused' && r.why === 'shape' && isObj(m) && r.client === m.client && r.seq === m.seq)
        || (mine.length > 0 && isClose(mine[mine.length - 1]) && mine[mine.length - 1].$close === 1008)
        // a select off its shape is ignored (§5): the step expects nothing for anyone
        || (isObj(m) && m.t === 'select' && Object.values(expect).every((l) => Array.isArray(l) && l.length === 0));
      if (errs.length && !excused) for (const e of errs) out.push(`${where}: send: ${e}`);
    }
    if (own(s, 'doc')) docProblem(where, s.doc);
  });
  return out;
}

// Waits (polling, on the real clock) until `fn()` is truthy or `ms` pass; whether it became so.
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 1));
  }
  return true;
}
const quiet = async () => { await settle(); await new Promise((r) => setTimeout(r, 3)); await settle(); };
let exchangeTrips = 0;

// Plays one exchange (§14) against `fake` (started with `exchangeOptions`, or a server with the same
// controls): each step's action, then every open connection's new messages compared with its `expect`
// list exactly, in order (none for a connection not named), a `$close` awaited with its code, and the
// document compared when the step gives one. Every received message must first hold to its kind's
// shape, and every connection's conn be its own. It also holds `welcome` and `reload` to §3's session
// rule: a welcome on a canvas with no open connection, and every reload, carries an id not seen before
// in the exchange (a step's reloads all the same one); any other welcome the open session's. After the
// last step, a round trip per connection and a 50 ms settle, then silence. A failure names the
// exchange, the step and the connection. `waitMs` bounds each wait for a message, a close or a pong.
// Every connection it opens is closed when it ends, however it ends.
export async function playExchange(fake, x, { fixturesDir, name = 'exchange', waitMs = 3000 } = {}) {
  const problems = exchangeProblems(x, { fixturesDir });
  assert.deepEqual(problems, [], `${name}: holds to the exchange rules`);
  const conns = new Map(); // name -> { c, mark, code, done }
  const connOf = new Map(); // name -> its conn, for "$conn:<name>"
  const seen = new Set(); // every session id a welcome or reload carried
  let current = null; // the open session's id, as the runner has seen it
  const live = () => [...conns.entries()].filter(([, e]) => !e.done);
  const sessionNow = () => { try { return fake.session(x.slug); } catch { return null; } };
  const roundTrip = async (e, where) => {
    const tag = `x-${++exchangeTrips}`;
    e.c.frame(Buffer.from(tag), { opcode: 9 });
    const ok = await waitFor(() => e.code !== null || e.c.controls.some((k) => k.opcode === 10 && k.payload.toString() === tag), waitMs);
    assert.ok(ok, `${where}: the round trip's pong`);
  };
  try {
    for (let i = 0; i < x.steps.length; i++) {
      const s = x.steps[i];
      const act = actionOf(s)[0];
      const where = `${name} step ${i + 1} (${act} ${JSON.stringify(s[act]).slice(0, 60)})`;
      const expect = s.expect || {};
      const liveBefore = live().length;
      const before = current; // the session as it stood before this step
      let reloaded = null; // the id this step's reloads carry
      let sender = null;
      if (act === 'open') {
        const headers = {};
        if (s.person !== null) headers['x-devteam-person'] = s.person;
        if (s.level !== null) headers['x-devteam-level'] = s.level;
        const c = await openCanvas(fake.url, { slug: x.slug, headers });
        const status = own(s, 'status') ? s.status : 101;
        assert.equal(c.status, status, `${where}: connection ${s.open}: the upgrade's status`);
        if (status !== 101) c.destroy();
        else {
          const e = { c, mark: 0, code: null, done: false };
          c.closed.then((code) => { e.code = code; });
          conns.set(s.open, e);
          if (c.you) connOf.set(s.open, c.you.conn);
        }
      } else if (act === 'as') {
        const e = conns.get(s.as);
        assert.ok(e && !e.done, `${where}: connection ${s.as} is open`);
        if (s.close) {
          e.c.close(1000);
          assert.ok(await waitFor(() => e.code !== null, waitMs), `${where}: connection ${s.as}: the close answered`);
          e.done = true;
          assert.deepEqual(e.c.messages.slice(e.mark), [], `${where}: connection ${s.as}: nothing before its close`);
        } else {
          e.c.send(s.send);
          sender = s.as;
        }
      } else if (act === 'local') {
        const res = await request(`${fake.url}/api/canvas/local?slug=${x.slug}`, {
          method: 'POST', headers: { 'x-devteam-canvas-token': fake.token, 'Content-Type': 'application/json' }, body: s.local,
        });
        assert.equal(res.status, s.status, `${where}: the local route's status`);
        // no `body`: the status alone is checked (§14)
        if (own(s, 'body')) assert.deepEqual(res.json, s.body, `${where}: the local route's body`);
      } else if (act === 'do') {
        const arg = s.do === 'replace' ? readFixture(fixturesDir, s.arg) : s.arg;
        await (own(s, 'arg') ? fake[s.do](x.slug, arg) : fake[s.do](x.slug));
      } else {
        await fake.tick(s.tick);
      }
      // a sender that expects nothing gets a round trip, so the server has judged its message
      if (sender !== null) {
        const mine = expect[sender] || [];
        if (mine.length === 0) await roundTrip(conns.get(sender), `${where}: connection ${sender}`);
      }
      for (const [cn] of Object.entries(expect)) assert.ok(conns.has(cn) && (!conns.get(cn).done || false), `${where}: connection ${cn} is open`);
      // every open connection: its messages arrive, then exactly the expected ones
      for (const [cn, e] of live()) {
        const want = expect[cn] || [];
        const closeWant = want.length && isClose(want[want.length - 1]) ? want[want.length - 1].$close : null;
        const msgs = closeWant === null ? want : want.slice(0, -1);
        await waitFor(() => e.c.messages.length - e.mark >= msgs.length && (closeWant === null || e.code !== null), waitMs);
      }
      await quiet();
      for (const [cn, e] of live()) {
        const want = expect[cn] || [];
        const closeWant = want.length && isClose(want[want.length - 1]) ? want[want.length - 1].$close : null;
        const got = e.c.messages.slice(e.mark);
        e.mark = e.c.messages.length;
        for (const m of got) {
          // every received message holds to its kind's shape, before any matching
          assert.ok(isObj(m) && SERVER_KINDS.includes(m.t), `${where}: connection ${cn}: a server kind, not ${JSON.stringify(isObj(m) ? m.t : m)}`);
          assert.deepEqual(shapeErrors(m.t, m), [], `${where}: connection ${cn}: a ${m.t} holding to its shape`);
          if (m.t === 'welcome' && act === 'open' && cn === s.open) {
            if (liveBefore === 0) assert.ok(!seen.has(m.session), `${where}: connection ${cn}: a new session's id, never seen before`);
            else assert.equal(m.session, current, `${where}: connection ${cn}: the open session's id`);
            current = m.session;
            seen.add(m.session);
            for (const [other, conn] of connOf) assert.ok(other === cn || conn !== m.you.conn, `${where}: connection ${cn}: a conn of its own, not ${other}'s`);
            connOf.set(cn, m.you.conn);
          } else if (m.t === 'reload') {
            if (reloaded === null) {
              assert.ok(m.session !== before && !seen.has(m.session), `${where}: connection ${cn}: a reload's session is new, never seen before`);
              reloaded = m.session;
              current = m.session;
              seen.add(m.session);
            } else assert.equal(m.session, reloaded, `${where}: connection ${cn}: the same new session as the step's other reloads`);
          }
        }
        const msgs = (closeWant === null ? want : want.slice(0, -1)).map((m) => filled(m, sessionNow(), connOf));
        assert.deepEqual(got, msgs, `${where}: connection ${cn}: its messages`);
        if (closeWant !== null) {
          assert.equal(e.code, closeWant, `${where}: connection ${cn}: closed by the server with ${closeWant}`);
          e.done = true;
        } else assert.equal(e.code, null, `${where}: connection ${cn}: not closed`);
      }
      if (live().length === 0) current = null;
      if (own(s, 'doc')) assert.deepEqual(fake.doc(x.slug), s.doc, `${where}: the canvas's doc`);
    }
    // nothing more after the last step: a round trip each, then a short settle, then silence
    for (const [cn, e] of live()) await roundTrip(e, `${name} end: connection ${cn}`);
    await new Promise((r) => setTimeout(r, 50));
    await settle();
    for (const [cn, e] of live()) {
      assert.deepEqual(e.c.messages.slice(e.mark), [], `${name} end: connection ${cn}: nothing after the last step`);
      assert.equal(e.code, null, `${name} end: connection ${cn}: not closed after the last step`);
    }
  } finally {
    for (const e of conns.values()) e.c.destroy();
  }
}
