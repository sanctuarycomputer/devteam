// The document's nodes (canvas.html 659-727, kit-1013). Each declaration is the page's own, with types added.
import { isObj, own, state, type Json } from './page';

export const COMMON = ['name', 'visible', 'opacity', 'x', 'y', 'size.w', 'size.h'];
export const STROKE = ['fill', 'stroke', 'strokeWidth'];
export const BOX = [...STROKE, 'radius', 'clip', 'layout.mode', 'layout.gap', 'layout.padding', 'layout.align',
  'layout.justify', 'layout.wrap', 'layout.columns', 'layout.rows'];
// Per type, the plain properties an instance resolves (contract §2 Properties).
export const PATHS: Record<string, string[]> = {
  frame: [...COMMON, ...BOX], component: [...COMMON, ...BOX],
  text: [...COMMON, 'text', 'font', 'color', 'align'],
  rect: [...COMMON, ...STROKE, 'radius'], ellipse: [...COMMON, ...STROKE],
  vector: [...COMMON, 'path', ...STROKE], image: [...COMMON, 'src', 'fit', 'radius'],
  instance: [...COMMON, 'component', 'variant'],
};
// An instance root's own properties (stored, else the contract's default), and the sides it takes
// from its component root when it doesn't store them; everything else is the component root's.
export const INSTANCE_OWN = new Set(['name', 'visible', 'opacity', 'x', 'y']);
export const INSTANCE_SIZE = new Set(['size.w', 'size.h']);
export const CONTAINERS = new Set(['frame', 'component']);
export const MAX_DEPTH = 20;
// The most elements a page draws; past it every further instance is a placeholder and the stage says so.
export const MAX_ELEMENTS = 50000;
export const SVG_NS = 'http://www.w3.org/2000/svg';

export const nodeOf = (id: Json): Json => (typeof id === 'string' && own(state.doc.nodes, id) && isObj(state.doc.nodes[id]) ? state.doc.nodes[id] : null);
export const kidsOf = (x: Json): string[] => (Array.isArray(x.children) ? x.children.filter((c: Json) => typeof c === 'string') : []);
export function getPath(o: Json, path: string): Json {
  let at = o;
  for (const k of path.split('.')) {
    if (!isObj(at) || !own(at, k)) return undefined;
    at = at[k];
  }
  return at;
}

// An instance's component tree, resolved (contract §2 "Resolution order", as the fake's resolve):
// per descendant, its stored values, then a prop's default aimed at it, then the chosen variant's
// override, then the instance's override, then the instance's prop value; the last present wins.
// A value not stored anywhere stays absent, so it takes its default when drawn.
export function resolveInstance(inst: Json, comp: Json): Map<string, Json> {
  const out = new Map<string, Json>();
  const stack = kidsOf(comp).reverse();
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    const n = nodeOf(id);
    if (!n || !own(PATHS, n.type)) continue;
    const vals = Object.create(null);
    for (const path of PATHS[n.type]) {
      const v = getPath(n, path);
      if (v !== undefined) vals[path] = v;
    }
    out.set(id, vals);
    if (CONTAINERS.has(n.type)) stack.push(...kidsOf(n).reverse());
  }
  const set = (id: Json, prop: Json, v: Json) => { if (typeof id === 'string' && out.has(id) && typeof prop === 'string') out.get(id)[prop] = v; };
  const each = (m: Json, f: (k: string, v: Json) => void) => { if (isObj(m)) for (const k of Object.keys(m)) f(k, m[k]); };
  const props = isObj(comp.props) ? comp.props : {};
  each(props, (_, pd) => { if (isObj(pd) && isObj(pd.target)) set(pd.target.id, pd.target.prop, pd.default); });
  const variant = typeof inst.variant === 'string' && isObj(comp.variants) && own(comp.variants, inst.variant) ? comp.variants[inst.variant] : null;
  each(variant, (id, o) => each(o, (prop, v) => set(id, prop, v)));
  each(inst.overrides, (id, o) => each(o, (prop, v) => set(id, prop, v)));
  each(inst.props, (name, v) => {
    const pd = own(props, name) ? props[name] : null;
    if (isObj(pd) && isObj(pd.target)) set(pd.target.id, pd.target.prop, v);
  });
  return out;
}
