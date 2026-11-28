// Copy and paste (canvas.html 3788-4361, kit-1017): a canvas-doc@1 document as text, checked and resolved here.
// Each declaration is the page's own, with types added; the page's load-time statements run, in its
// order, from initPaste(). No DOM at import.
import { clamp, FAMILY, finite, FR_RE, HEX_RE, HEX6_RE, imageFile, pathOk, SRC_RE, VARIANT_RE } from '../core/checkers';
import { CONTAINERS, getPath, kidsOf, MAX_ELEMENTS, nodeOf, PATHS } from '../core/nodes';
import { $, isObj, live, own, pageById, pageName, state, type Json } from '../core/page';
import { hasBox, toolsOn } from '../editing';
import { ready, selectIds, selRoots, typing } from '../panels';
import { edit, freeText, jsonBytes, newId, nodeIn, put, say } from '../sync';
import { subtreeIds } from './undo';
import * as panels from '../panels';
import * as sync from '../sync';

// ---- copy and paste (kit-669 §4): a canvas-doc@1 document as text, checked and resolved here ----
// Text pasted from another canvas is hostile: it is parsed as JSON only, checked against the
// contract's shape, every value put through its class's checker (a value outside is left out), its
// references resolved against this canvas, and only then sent as one edit of adds; it reaches the
// drawing only as any document does. The only request it makes is the image check.
export const PASTE_SAY = {
  notClip: "That isn't a canvas's layers, so nothing was pasted.",
  tooMuch: 'That is too much to paste at once.',
  frames: "Instances of components this canvas doesn't have were pasted as frames.",
  rects: "Images this canvas doesn't have were pasted as rectangles.",
  values: "Some values weren't valid here, so they were left out.",
};
export const DOC_BYTES = 5242880; // canvas@1 §7 docBytes
export const NODES_MAX = 20000; // canvas@1 §7 nodes
export const DEPTH_MAX = 100; // canvas@1 §7 depth (a page's children are depth 1)
export const MAP_MAX = 32; // canvas@1 §7 props and variants, per component
export const OVERRIDE_ENTRIES = 1000; // canvas@1 §7 overrideEntries, per instance's overrides or variant
export const PAGES_MAX_DOC = 100; // canvas@1 §7 pages
export const NODE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const TOKEN_PATH_RE = /^[A-Za-z0-9_-]{1,40}(?:\.[A-Za-z0-9_-]{1,40}){0,7}$/;
export const FIGMA_RE = /^[A-Za-z0-9:;_-]{1,100}$/;
export const NODE_TYPES = new Set(['frame', 'text', 'rect', 'ellipse', 'vector', 'image', 'component', 'instance']);
export const RECT_FILL = '#d9d9d9';

// Every token path a value names by $ref, at any depth, added to `out`.
export function refPaths(v: Json, out: Json) {
  const stack = [v];
  while (stack.length) {
    const x = stack.pop();
    if (Array.isArray(x)) stack.push(...x);
    else if (isObj(x)) {
      if (own(x, '$ref') && typeof x.$ref === 'string') out.add(x.$ref);
      else stack.push(...Object.values(x));
    }
  }
  return out;
}
// The token at a dotted path of a token tree ({ $type, $value }), or null: own keys only.
export function tokenAt(tokens: Json, path: Json) {
  if (typeof path !== 'string' || !TOKEN_PATH_RE.test(path)) return null;
  let at = tokens;
  for (const seg of path.split('.')) {
    if (!isObj(at) || !own(at, seg)) return null;
    at = at[seg];
  }
  return isObj(at) && own(at, '$type') && own(at, '$value') ? at : null;
}

// The clip: the selection's roots (not inside another selected node, in layer order) on one page, the
// shown one's id and name; each root's subtree as stored, the root's parent the page. A root drawn
// with a box has x, y its drawn top-left in the page's px and a `fill` side its drawn size, rounded;
// one without (hidden) keeps what is stored. `tokens`: every token the nodes name, with its groups.
export function makeClip() {
  const pg = pageById(state.pageId);
  const roots = selRoots().filter((id) => nodeOf(id));
  const nodes: Json = {};
  const refs = new Set<string>();
  const s = $('surface').getBoundingClientRect();
  const z = panels.shared.view.z;
  for (const r of roots) {
    for (const id of subtreeIds(state.doc, r)) refPaths(put(nodes, id, structuredClone(nodeOf(id))), refs);
    const n = nodes[r];
    n.parent = pg.id;
    if (!hasBox(r)) continue;
    const b = live.drawn.get(r)!.getBoundingClientRect();
    n.x = clamp(Math.round((b.left - s.left) / z), -panels.shared.PX, panels.shared.PX);
    n.y = clamp(Math.round((b.top - s.top) / z), -panels.shared.PX, panels.shared.PX);
    if (getPath(n, 'size.w') === 'fill') n.size.w = clamp(Math.round(b.width / z), 0, panels.shared.PX);
    if (getPath(n, 'size.h') === 'fill') n.size.h = clamp(Math.round(b.height / z), 0, panels.shared.PX);
  }
  const tokens: Json = {};
  for (const path of refs) {
    const tk = tokenAt(state.doc.tokens, path);
    if (!tk) continue;
    const segs = path.split('.');
    let at = tokens;
    for (const seg of segs.slice(0, -1)) at = own(at, seg) && isObj(at[seg]) ? at[seg] : put(at, seg, {});
    put(at, segs[segs.length - 1], structuredClone(tk));
  }
  return { canvas: 1, rev: 0, tokens, pages: [{ id: pg.id, name: pageName(pg), children: roots }], nodes };
}
// Copy (Ctrl+C, Cmd+C, the browser's Copy) with a selection and no field focused: the clip as
// compact JSON, text/plain. Watching too: it changes nothing. Else the browser's own copy.

// The value classes (contract §2), each a checker (v, r) giving the value to keep or undefined to
// leave it out. A `{ $ref }` is handed to `r(v, $type, fits)`: on the clip's own check (cleanClip) it
// is kept as it is, its form checked; at paste (buildPaste) it is resolved against this canvas.
export const tokRef = (v: Json) => isObj(v) && Object.keys(v).length === 1 && own(v, '$ref') && typeof v.$ref === 'string' && TOKEN_PATH_RE.test(v.$ref);
export const inRange = (v: Json, lo: Json, hi: Json) => finite(v) && v >= lo && v <= hi;
export const weightOk = (v: Json) => Number.isInteger(v) && v >= 100 && v <= 900 && v % 100 === 0;
// A string of at most `max` code points (a code point is one or two UTF-16 units), free text.
export const textOk = (v: Json, max: Json) => typeof v === 'string' && (v.length <= max || (v.length <= max * 2 && [...v].length <= max)) && freeText(v);
export const familyOk = (v: Json) => typeof v === 'string' && own(FAMILY, v);
export const fontOk = (v: Json) => isObj(v) && familyOk(v.family) && inRange(v.size, 1, 1000) && weightOk(v.weight) && inRange(v.lineHeight, 0.5, 10);
export const dimOk = (v: Json) => inRange(v, -panels.shared.PX, panels.shared.PX);
export const lenNum = (v: Json) => inRange(v, 0, panels.shared.PX);
export const hexOk = (v: Json) => typeof v === 'string' && HEX_RE.test(v);
export const lit = (ok: Json) => (v: Json) => (ok(v) ? v : undefined);
export const orRef = (ok: Json, type: Json) => (v: Json, r: Json) => (tokRef(v) ? r(v, type, ok) : ok(v) ? v : undefined);
export const oneOf = (...words: Json) => lit((v: Json) => typeof v === 'string' && words.includes(v));
export const CLASS = {
  name: lit((v: Json) => textOk(v, 200)),
  text: lit((v: Json) => textOk(v, 10000)),
  bool: lit((v: Json) => typeof v === 'boolean'),
  opacity: lit((v: Json) => inRange(v, 0, 1)),
  dim: orRef(dimOk, 'dimension'),
  len: orRef(lenNum, 'dimension'),
  color: orRef(hexOk, 'color'),
  paint: (v: Json, r: Json) => (v === null ? null : CLASS.color(v, r)),
  sizing: (v: Json, r: Json) => (v === 'hug' || v === 'fill' ? v : CLASS.len(v, r)),
  padding(v: Json, r: Json) {
    if (!Array.isArray(v) || v.length !== 4) return undefined;
    const out = v.map((x) => CLASS.len(x, r));
    return out.includes(undefined) ? undefined : out;
  },
  tracks: (v: Json) => (Array.isArray(v) && v.length <= 64 && v.every((t) => lenNum(t) || t === 'auto' || (typeof t === 'string' && FR_RE.test(t))) ? [...v] : undefined),
  font(v: Json, r: Json) {
    if (tokRef(v)) return r(v, 'typography', fontOk);
    if (!isObj(v) || Object.keys(v).length !== 4 || !['family', 'size', 'weight', 'lineHeight'].every((k) => own(v, k))) return undefined;
    const out = {
      family: orRef(familyOk, 'fontFamily')(v.family, r),
      size: orRef((x: Json) => inRange(x, 1, 1000), 'dimension')(v.size, r),
      weight: orRef(weightOk, 'fontWeight')(v.weight, r),
      lineHeight: orRef((x: Json) => inRange(x, 0.5, 10), 'number')(v.lineHeight, r),
    };
    return Object.values(out).includes(undefined) ? undefined : out;
  },
  pathData: lit(pathOk),
  imageSrc: lit((v: Json) => typeof v === 'string' && SRC_RE.test(v)),
  figmaId: lit((v: Json) => typeof v === 'string' && FIGMA_RE.test(v)),
  componentRef: lit((v: Json) => typeof v === 'string' && NODE_ID_RE.test(v)),
  variantName: lit((v: Json) => v === null || (typeof v === 'string' && VARIANT_RE.test(v))),
};
// Property path → its class's checker: one per row of contract §2's Properties table (the maps,
// props, variants and overrides, are checked entry by entry: propDefOf, propValueOf, overridesOf).
export const PROP_CLASS = Object.assign(Object.create(null), {
  name: CLASS.name, visible: CLASS.bool, opacity: CLASS.opacity, x: CLASS.dim, y: CLASS.dim,
  'size.w': CLASS.sizing, 'size.h': CLASS.sizing, figma: CLASS.figmaId,
  fill: CLASS.paint, stroke: CLASS.paint, strokeWidth: CLASS.len, radius: CLASS.len, clip: CLASS.bool,
  'layout.mode': oneOf('none', 'row', 'column', 'grid'), 'layout.gap': CLASS.len, 'layout.padding': CLASS.padding,
  'layout.align': oneOf('start', 'center', 'end', 'stretch'), 'layout.justify': oneOf('start', 'center', 'end', 'between'),
  'layout.wrap': CLASS.bool, 'layout.columns': CLASS.tracks, 'layout.rows': CLASS.tracks,
  text: CLASS.text, font: CLASS.font, color: CLASS.color, align: oneOf('left', 'center', 'right', 'justify'),
  path: CLASS.pathData, src: CLASS.imageSrc, fit: oneOf('cover', 'contain', 'fill'),
  component: CLASS.componentRef, variant: CLASS.variantName,
});
// Type → its plain property paths (a group's, layout and size, as `<group>.<key>`), and its maps.
export const TYPE_PROPS = Object.assign(Object.create(null), Object.fromEntries(Object.entries(PATHS).map(([t, ps]) => [t, new Set([...ps, 'figma'])])));
export const TYPE_MAPS: Record<string, Set<string>> = { component: new Set(['props', 'variants']), instance: new Set(['props', 'overrides']) };
// An override may set a property of its target's type but these (contract §2).
export const NOT_OVERRIDDEN = new Set(['name', 'figma', 'component', 'variant', 'props', 'variants', 'overrides']);
export const overridable = (type: Json, prop: Json) => !NOT_OVERRIDDEN.has(prop) && own(TYPE_PROPS, type) && TYPE_PROPS[type].has(prop);
// A component's prop definition, exactly { type, default, target: { id, prop } } and in its class, as
// a fresh object, or undefined.
export function propDefOf(pd: Json) {
  if (!isObj(pd) || Object.keys(pd).length !== 3 || !['type', 'default', 'target'].every((k) => own(pd, k))) return undefined;
  const tg = pd.target;
  if (!isObj(tg) || Object.keys(tg).length !== 2 || !own(tg, 'id') || !own(tg, 'prop') || typeof tg.id !== 'string' || !NODE_ID_RE.test(tg.id)) return undefined;
  if (pd.type === 'text' && textOk(pd.default, 10000) && tg.prop === 'text') return { type: 'text', default: pd.default, target: { id: tg.id, prop: 'text' } };
  if (pd.type === 'bool' && typeof pd.default === 'boolean' && tg.prop === 'visible') return { type: 'bool', default: pd.default, target: { id: tg.id, prop: 'visible' } };
  return undefined;
}
export const propValueOf = (v: Json) => (typeof v === 'boolean' || textOk(v, 10000) ? v : undefined);
// An override map's shape ({ <node id>: { <prop>: value } }) as a fresh object, its first 1000
// entries (canvas@1 §7 overrideEntries; the rest left out and said); its values are checked at
// paste, against the target's type there (overrideOf).
export function overridesOf(m: Json, said: Json) {
  const out: Json = {};
  if (!isObj(m)) { said.values = true; return out; }
  let room = OVERRIDE_ENTRIES;
  for (const tid of Object.keys(m)) {
    if (!NODE_ID_RE.test(tid) || !isObj(m[tid])) { said.values = true; continue; }
    const props = Object.keys(m[tid]);
    if (props.length > room) said.values = true;
    const kept = props.slice(0, room);
    if (kept.length === 0) continue;
    const o = put(out, tid, {});
    for (const prop of kept) put(o, prop, m[tid][prop]);
    room -= kept.length;
  }
  return out;
}

// The clip's shape (spec §4 step 1): null when it holds to canvas-doc@1's rules top, page-shape,
// node-shape, id-form, id-unique and tree, with no node holding an `id` key and no component inside a
// component; else the first rule that fails.
export function clipShape(doc: Json) {
  const TOP = ['canvas', 'rev', 'tokens', 'pages', 'nodes'];
  if (!isObj(doc) || Object.keys(doc).length !== TOP.length || !TOP.every((k) => own(doc, k))) return 'top';
  if (doc.canvas !== 1 || !Number.isSafeInteger(doc.rev) || doc.rev < 0 || !isObj(doc.tokens) || !Array.isArray(doc.pages) || !isObj(doc.nodes)) return 'top';
  if (doc.pages.length < 1 || doc.pages.length > PAGES_MAX_DOC) return 'limits';
  const ids = Object.keys(doc.nodes);
  if (ids.length > NODES_MAX) return 'limits';
  const pageIds = new Set();
  for (const pg of doc.pages) {
    if (!isObj(pg) || Object.keys(pg).length !== 3 || !['id', 'name', 'children'].every((k) => own(pg, k))) return 'page-shape';
    if (!Array.isArray(pg.children) || !pg.children.every((c: Json) => typeof c === 'string')) return 'page-shape';
    if (typeof pg.id !== 'string' || !NODE_ID_RE.test(pg.id)) return 'id-form';
    if (pageIds.has(pg.id) || own(doc.nodes, pg.id)) return 'id-unique';
    pageIds.add(pg.id);
  }
  const node = (id: Json) => doc.nodes[id];
  for (const id of ids) {
    if (!NODE_ID_RE.test(id)) return 'id-form';
    const n = node(id);
    if (!isObj(n) || !own(n, 'type') || !NODE_TYPES.has(n.type) || !own(n, 'parent') || typeof n.parent !== 'string' || own(n, 'id')) return 'node-shape';
    if (CONTAINERS.has(n.type) ? !(own(n, 'children') && Array.isArray(n.children) && n.children.every((c: Json) => typeof c === 'string')) : own(n, 'children')) return 'node-shape';
  }
  // each listed child exists, names that parent and is listed once; each node's parent is a page or
  // a container that lists it; every node reached from a page
  const listedBy = new Map();
  const lists = doc.pages.map((pg: Json) => [pg.id, pg.children]);
  for (const id of ids) if (CONTAINERS.has(node(id).type)) lists.push([id, node(id).children]);
  for (const [owner, kids] of lists) {
    for (const c of kids) {
      if (listedBy.has(c) || !own(doc.nodes, c) || node(c).parent !== owner) return 'tree';
      listedBy.set(c, owner);
    }
  }
  for (const id of ids) {
    const pid = node(id).parent;
    if (!pageIds.has(pid) && !(own(doc.nodes, pid) && CONTAINERS.has(node(pid).type))) return 'tree';
    if (listedBy.get(id) !== pid) return 'tree';
  }
  // the walk carries each node's depth: deeper than 100 is refused (limits), so no walk up a
  // clip's parents is longer than that
  const queue: Json[] = [];
  for (const pg of doc.pages) for (const c of pg.children) queue.push([c, false, 1]);
  for (let i = 0; i < queue.length; i++) {
    const [id, inComp, depth] = queue[i];
    const n = node(id);
    if (depth > DEPTH_MAX) return 'limits';
    if (n.type === 'component' && inComp) return 'components';
    if (CONTAINERS.has(n.type)) for (const c of n.children) queue.push([c, inComp || n.type === 'component', depth + 1]);
  }
  if (queue.length !== ids.length) return 'tree';
  return null;
}

// The clip's nodes cleaned (spec §4 step 1's keys and classes): per node, a key not of its type's
// properties or a value not in its class is left out; a node then missing a required property (a
// vector's path, an image's src, an instance's component; none of them holds children) is left out.
// → { pages: [{ id, children }], nodes: Map id → node, tokens, said: { values } }.
export function cleanClip(doc: Json) {
  const said = { values: false };
  const keepRef = (v: Json) => ({ $ref: v.$ref });
  const keep = (path: Json, v: Json) => {
    const out = PROP_CLASS[path](v, keepRef);
    if (out === undefined) said.values = true;
    return out;
  };
  const nodes = new Map();
  for (const id of Object.keys(doc.nodes)) {
    const n = doc.nodes[id];
    const paths = TYPE_PROPS[n.type];
    const out: Json = { type: n.type, parent: n.parent };
    if (CONTAINERS.has(n.type)) out.children = [...n.children];
    for (const k of Object.keys(n)) {
      if (k === 'type' || k === 'parent' || k === 'children') continue;
      if ((k === 'layout' || k === 'size') && paths.has(k === 'size' ? 'size.w' : 'layout.mode')) {
        if (!isObj(n[k])) { said.values = true; continue; }
        const g: Json = {};
        for (const sub of Object.keys(n[k])) {
          const path = `${k}.${sub}`;
          if (!paths.has(path)) { said.values = true; continue; }
          const v = keep(path, n[k][sub]);
          if (v !== undefined) g[sub] = v;
        }
        if (Object.keys(g).length) out[k] = g;
      } else if (!k.includes('.') && paths.has(k)) {
        const v = keep(k, n[k]);
        if (v !== undefined) out[k] = v;
      } else if (own(TYPE_MAPS, n.type) && TYPE_MAPS[n.type].has(k)) {
        const m = n[k];
        if (!isObj(m)) { said.values = true; continue; }
        const o = {};
        if (k === 'overrides') Object.assign(out, { overrides: overridesOf(m, said) });
        else if (k === 'variants') {
          for (const name of Object.keys(m)) {
            if (VARIANT_RE.test(name) && Object.keys(o).length < MAP_MAX) put(o, name, overridesOf(m[name], said));
            else said.values = true;
          }
          out.variants = o;
        } else {
          const check = n.type === 'component' ? propDefOf : propValueOf;
          for (const name of Object.keys(m)) {
            const room = n.type !== 'component' || Object.keys(o).length < MAP_MAX;
            const v = VARIANT_RE.test(name) && room ? check(m[name]) : undefined;
            if (v === undefined) said.values = true; else put(o, name, v);
          }
          out.props = o;
        }
      } else said.values = true;
    }
    const lacks = (n.type === 'vector' && !own(out, 'path')) || (n.type === 'image' && !own(out, 'src')) || (n.type === 'instance' && !own(out, 'component'));
    if (lacks) said.values = true; else nodes.set(id, out);
  }
  const listed = (kids: Json) => kids.filter((c: Json) => nodes.has(c));
  for (const n of nodes.values()) if (n.children) n.children = listed(n.children);
  return { pages: doc.pages.map((pg: Json) => ({ id: pg.id, children: listed(pg.children) })), nodes, tokens: doc.tokens, said };
}

// A token's literal value of `type` (spec §4 step 2): a colour token's hex, else #rrggbb or
// #rrggbbaa from its components and alpha; a dimension's px value; a fontFamily's word; a
// fontWeight's and a number's number; a typography token's { family, size, weight, lineHeight }.
export const hex2 = (n: Json) => Math.round(n * 255).toString(16).padStart(2, '0');
export function literalOf(tk: Json, type: Json): Json {
  if (!isObj(tk) || tk.$type !== type) return undefined;
  const x = tk.$value;
  switch (type) {
    case 'color': {
      if (!isObj(x)) return undefined;
      if (typeof x.hex === 'string' && HEX6_RE.test(x.hex)) return x.hex;
      const c = x.components;
      const a = own(x, 'alpha') ? x.alpha : 1;
      if (!Array.isArray(c) || c.length !== 3 || !c.every((n) => inRange(n, 0, 1)) || !inRange(a, 0, 1)) return undefined;
      return `#${c.map(hex2).join('')}${a === 1 ? '' : hex2(a)}`;
    }
    case 'dimension': return isObj(x) && x.unit === 'px' && finite(x.value) ? x.value : undefined;
    case 'fontFamily': return familyOk(x) ? x : undefined;
    case 'fontWeight': return weightOk(x) ? x : undefined;
    case 'number': return finite(x) ? x : undefined;
    case 'typography': {
      if (!isObj(x)) return undefined;
      const out = {
        family: literalOf({ $type: 'fontFamily', $value: x.fontFamily }, 'fontFamily'),
        size: literalOf({ $type: 'dimension', $value: x.fontSize }, 'dimension'),
        weight: literalOf({ $type: 'fontWeight', $value: x.fontWeight }, 'fontWeight'),
        lineHeight: literalOf({ $type: 'number', $value: x.lineHeight }, 'number'),
      };
      return Object.values(out).includes(undefined) ? undefined : out;
    }
    default: return undefined;
  }
}

// The paste's ops (spec §4 steps 2 and 3) against this canvas as it stands, the shown page its
// target; `lacking`: the image files this canvas doesn't have. → { ops, roots (the pasted roots' new
// ids), files (every image file the ops name), said: { frames, rects, values } }, or null with no
// shown page.
export function buildPaste(clip: Json, lacking = new Set()) {
  const pg = pageById(state.pageId);
  if (!pg) return null;
  const d = state.doc;
  const said = { frames: false, rects: false, values: clip.said.values };
  const files = new Set();
  // a $ref resolved: kept when this canvas has the token with that type and a value that fits, else
  // the clip's token's literal when it fits, else left out
  const resolve = (v: Json, type: Json, fits: Json) => {
    const mine = literalOf(tokenAt(d.tokens, v.$ref), type);
    if (mine !== undefined && fits(mine)) return { $ref: v.$ref };
    const theirs = literalOf(tokenAt(clip.tokens, v.$ref), type);
    return theirs !== undefined && fits(theirs) ? theirs : undefined;
  };
  const value = (path: Json, v: Json) => {
    let out = PROP_CLASS[path](v, resolve);
    if (path === 'src' && out !== undefined) {
      if (lacking.has(imageFile(out))) out = undefined; else files.add(imageFile(out));
    }
    if (out === undefined) said.values = true;
    return out;
  };
  // the types as pasted: an instance of a component this canvas doesn't have a frame, an image of a
  // file it doesn't have a rect
  const isComp = (id: Json) => nodeIn(d, id)?.type === 'component';
  const typed = new Map();
  for (const [id, n] of clip.nodes) {
    if (n.type === 'instance' && !isComp(n.component)) typed.set(id, 'frame');
    else if (n.type === 'image' && lacking.has(imageFile(n.src))) typed.set(id, 'rect');
    else typed.set(id, n.type);
  }
  // new ids for every node pasted
  const fresh = new Map();
  for (const cp of clip.pages) {
    const stack = [...cp.children].reverse();
    while (stack.length) {
      const id = stack.pop();
      fresh.set(id, newId());
      stack.push(...[...(clip.nodes.get(id).children ?? [])].reverse());
    }
  }
  // each clip node's nearest component (null for none), found once by a walk down from the pages
  const encl = new Map();
  for (const cp of clip.pages) {
    const stack = cp.children.map((c: Json) => [c, null]);
    while (stack.length) {
      const [id, comp] = stack.pop();
      encl.set(id, comp);
      const n = clip.nodes.get(id);
      const inside = n.type === 'component' ? id : comp;
      for (const c of n.children ?? []) stack.push([c, inside]);
    }
  }
  // inside: `id` a descendant of component `comp` (its nearest component), in the clip or on this canvas
  const insideClip = (id: Json, comp: Json) => encl.get(id) === comp;
  const insideHere = (id: Json, comp: Json) => {
    let cur = nodeIn(d, id)?.parent;
    for (let steps = 0; steps <= MAX_ELEMENTS && cur !== undefined; steps++) {
      if (cur === comp) return true;
      const pn = nodeIn(d, cur);
      if (!pn || pn.type === 'component') return false;
      cur = pn.parent;
    }
    return false;
  };
  // an override's properties for a target of `type`: those it may take, each in its class
  const overrideOf = (type: Json, o: Json) => {
    const out: Json = {};
    for (const prop of Object.keys(o)) {
      if (!overridable(type, prop)) { said.values = true; continue; }
      const v = value(prop, o[prop]);
      if (v !== undefined) put(out, prop, v);
    }
    return out;
  };
  const ONLY: Record<string, string[]> = { frame: ['name', 'visible', 'opacity', 'x', 'y', 'size'], rect: ['name', 'visible', 'opacity', 'x', 'y', 'size', 'radius'] };
  function nodeOut(id: Json, parent: Json, shift: Json) {
    const n = clip.nodes.get(id);
    const type = typed.get(id);
    const out: Json = { id: fresh.get(id), type, parent };
    const converted = type !== n.type;
    const keys = converted ? ONLY[type].filter((k: Json) => own(n, k)) : Object.keys(n).filter((k) => k !== 'type' && k !== 'parent' && k !== 'children');
    for (const k of keys) {
      if (k === 'layout' || k === 'size') {
        const g: Json = {};
        for (const sub of Object.keys(n[k])) {
          const v = value(`${k}.${sub}`, n[k][sub]);
          if (v !== undefined) g[sub] = v;
        }
        if (Object.keys(g).length) out[k] = g;
      } else if (PROP_CLASS[k] && !(n.type === 'instance' && k === 'variant')) {
        const v = value(k, n[k]);
        if (v !== undefined) out[k] = v;
      }
    }
    if (converted) {
      if (type === 'frame') said.frames = true;
      else { said.rects = true; out.fill = RECT_FILL; }
    } else if (type === 'component') {
      if (own(n, 'props')) {
        const m = {};
        for (const name of Object.keys(n.props)) {
          const pd = n.props[name];
          const tg = pd.target.id;
          if (!fresh.has(tg) || !insideClip(tg, id) || (pd.type === 'text' && typed.get(tg) !== 'text')) { said.values = true; continue; }
          put(m, name, { type: pd.type, default: pd.default, target: { id: fresh.get(tg), prop: pd.target.prop } });
        }
        out.props = m;
      }
      if (own(n, 'variants')) {
        const m = {};
        for (const name of Object.keys(n.variants)) {
          const vm = put(m, name, {});
          for (const tg of Object.keys(n.variants[name])) {
            if (!fresh.has(tg) || !insideClip(tg, id)) { said.values = true; continue; }
            const o = overrideOf(typed.get(tg), n.variants[name][tg]);
            if (Object.keys(o).length) put(vm, fresh.get(tg), o);
          }
        }
        out.variants = m;
      }
    } else if (type === 'instance') {
      // against this canvas's component: its variants, props and descendants
      const comp = nodeIn(d, n.component);
      if (own(n, 'variant')) {
        const ok = n.variant === null || (isObj(comp.variants) && own(comp.variants, n.variant));
        if (!ok) said.values = true;
        out.variant = ok ? n.variant : null;
      }
      if (own(n, 'props')) {
        const defs = isObj(comp.props) ? comp.props : {};
        const m = {};
        for (const name of Object.keys(n.props)) {
          const pd = own(defs, name) && isObj(defs[name]) ? defs[name] : null;
          const v = n.props[name];
          if (pd && ((pd.type === 'text' && typeof v === 'string') || (pd.type === 'bool' && typeof v === 'boolean'))) put(m, name, v);
          else said.values = true;
        }
        out.props = m;
      }
      if (own(n, 'overrides')) {
        const m = {};
        for (const tg of Object.keys(n.overrides)) {
          const t = nodeIn(d, tg);
          if (!t || !insideHere(tg, n.component)) { said.values = true; continue; }
          const o = overrideOf(t.type, n.overrides[tg]);
          if (Object.keys(o).length) put(m, tg, o);
        }
        out.overrides = m;
      }
    }
    // over its original: 20 px right and down
    if (shift) {
      for (const k of ['x', 'y']) {
        const v = own(out, k) ? out[k] : 0;
        const at = tokRef(v) ? literalOf(tokenAt(d.tokens, v.$ref), 'dimension') : v;
        out[k] = clamp((finite(at) ? at : 0) + shift, -panels.shared.PX, panels.shared.PX);
      }
    }
    return out;
  }
  // one add per node: each root after the previous (the first after the page's last node), each
  // subtree in pre-order, each child after its previous sibling (the first null)
  const ops = [];
  const roots = [];
  const top = kidsOf(pg);
  const onPage = new Set(top);
  let after = top.length ? top[top.length - 1] : null;
  for (const cp of clip.pages) {
    const shift = cp.id === pg.id && cp.children.some((r: Json) => onPage.has(r)) ? 20 : 0;
    for (const r of cp.children) {
      const stack: Json[] = [[r, pg.id, after, shift]];
      while (stack.length) {
        const [id, parent, prev, sh] = stack.pop();
        ops.push({ op: 'add', node: nodeOut(id, parent, sh), after: prev });
        const kids = typed.get(id) === clip.nodes.get(id).type ? clip.nodes.get(id).children ?? [] : [];
        for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], fresh.get(id), i ? fresh.get(kids[i - 1]) : null, 0]);
      }
      roots.push(fresh.get(r));
      after = fresh.get(r);
    }
  }
  return { ops, roots, files, said };
}

// A paste (spec §4): checked, then its ops built with every image kept (over 64 KB: refused, nothing
// asked), then each distinct image file asked for once on the image route, then built again with
// those this canvas doesn't have as rects, sent as one edit, the roots selected and the changes said.
export async function pasteClip(text: Json) {
  const notClip = () => say(PASTE_SAY.notClip);
  if (typeof text !== 'string' || text.length > DOC_BYTES || new TextEncoder().encode(text).length > DOC_BYTES) { notClip(); return; }
  let doc;
  try { doc = JSON.parse(text); } catch { notClip(); return; }
  if (clipShape(doc) !== null) { notClip(); return; }
  const clip = cleanClip(doc);
  let built = buildPaste(clip);
  if (!built) return;
  if (jsonBytes(built.ops) > sync.shared.OPS_BYTES) { say(PASTE_SAY.tooMuch); return; }
  if (built.files.size) {
    const lacking = new Set();
    await Promise.all([...built.files].map(async (file) => {
      let has = false;
      try {
        const res = await fetch(`/api/canvas/image/${encodeURIComponent(state.slug!)}/${file}`, { credentials: 'same-origin', cache: 'no-store' });
        has = res.status === 200;
        if (res.body) res.body.cancel().catch(() => {});
      } catch { has = false; }
      if (!has) lacking.add(file);
    }));
    if (!toolsOn()) return;
    built = buildPaste(clip, lacking);
    if (!built) return;
    if (jsonBytes(built.ops) > sync.shared.OPS_BYTES) { say(PASTE_SAY.tooMuch); return; }
  }
  const { said } = built;
  const words = [said.frames && PASTE_SAY.frames, said.rects && PASTE_SAY.rects, said.values && PASTE_SAY.values].filter(Boolean).join(' ');
  if (built.ops.length === 0) { if (words) say(words); return; }
  if (!edit(built.ops)) return;
  selectIds(built.roots);
  if (words) say(words);
}
// Paste (Ctrl+V, Cmd+V, the browser's Paste) while editing is allowed and no field has focus: the
// text/plain as a clip. In a field, the field's own.
export function initPaste(): void {
  document.addEventListener('copy', (e) => {
    if (!ready() || state.sels.length === 0 || typing(e.target) || !e.clipboardData || !pageById(state.pageId)) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', JSON.stringify(makeClip()));
  });
  document.addEventListener('paste', (e) => {
    if (!toolsOn() || typing(e.target) || !e.clipboardData) return;
    e.preventDefault();
    pasteClip(e.clipboardData.getData('text/plain'));
  });
}
