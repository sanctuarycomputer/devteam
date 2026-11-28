// ---- ops (canvas@1 §4) applied to a document (canvas.html 1712-1897, kit-1015) ----
// The page's own apply, for ops the server has judged (to `base`) or is yet to judge (`pending`, over
// a copy of base): an op that doesn't apply as the document stands (its node gone, a parent that holds
// no children) is skipped, and the server judges it. Keys are put as own data properties, so an id
// that is an Object.prototype name is a plain key.
// Each declaration is the page's own, with types added; checks/faithful.mjs holds it to the page's tokens.
import { isObj, own, type Json } from '../core/page';
import { CONTAINERS, kidsOf } from '../core/nodes';

export const put = (o: Json, k: string, v: Json): Json => { Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true }); return v; };
export const nodeIn = (d: Json, id: Json): Json => (typeof id === 'string' && own(d.nodes, id) && isObj(d.nodes[id]) ? d.nodes[id] : null);
export const pageAt = (d: Json, id: Json): number => d.pages.findIndex((pg: Json) => isObj(pg) && pg.id === id);
export const STRUCTURAL = new Set(['id', 'type', 'parent', 'children']);
// A property path's keys as stored: a plain path splits at every dot; an override's property is one
// flat dotted key, so variants.<name>.<id>.<prop> splits at its third dot and overrides.<id>.<prop>
// at its second (canvas-doc@1 §2).
export function pathKeys(path: string): string[] {
  const s = path.split('.');
  if (s[0] === 'variants' && s.length >= 4) return ['variants', s[1], s[2], s.slice(3).join('.')];
  if (s[0] === 'overrides' && s.length >= 3) return ['overrides', s[1], s.slice(2).join('.')];
  return s;
}
export const isOverride = (keys: string[]): boolean => (keys[0] === 'variants' && keys.length === 4) || (keys[0] === 'overrides' && keys.length === 3);
// A null that removes: a property whose default is absent (figma, an entry of props, variants or overrides).
export const removing = (keys: string[]): boolean => (keys.length === 1 && keys[0] === 'figma') || (['props', 'variants', 'overrides'].includes(keys[0]) && keys.length >= 2);
export function setPath(n: Json, path: Json, value: Json): void {
  if (typeof path !== 'string' || STRUCTURAL.has(path)) return;
  const keys = pathKeys(path);
  if (value === null && removing(keys)) {
    const chain = [n];
    for (const k of keys.slice(0, -1)) {
      const at = chain[chain.length - 1];
      if (!own(at, k) || !isObj(at[k])) return;
      chain.push(at[k]);
    }
    const last = chain.length - 1;
    delete chain[last][keys[last]];
    // an override's id map left empty goes too, never the variant or a map above it
    if (isOverride(keys) && Object.keys(chain[last]).length === 0) delete chain[last - 1][keys[last - 1]];
    return;
  }
  let at = n;
  for (const k of keys.slice(0, -1)) at = own(at, k) && isObj(at[k]) ? at[k] : put(at, k, {});
  put(at, keys[keys.length - 1], structuredClone(value));
}
// An added node's properties as paths: a group's (layout, size) keys under its name, the rest as they are.
export const GROUPS = new Set(['layout', 'size']);
export function addedProps(nd: Json): [string, Json][] {
  const out: [string, Json][] = [];
  for (const k of Object.keys(nd)) {
    if (STRUCTURAL.has(k)) continue;
    if (GROUPS.has(k) && isObj(nd[k])) for (const sub of Object.keys(nd[k])) out.push([`${k}.${sub}`, nd[k][sub]]);
    else out.push([k, nd[k]]);
  }
  return out;
}
// The children list of a page or a container, or null.
export function childrenOf(d: Json, id: Json): Json[] | null {
  const pi = pageAt(d, id);
  if (pi >= 0) return Array.isArray(d.pages[pi].children) ? d.pages[pi].children : null;
  const n = nodeIn(d, id);
  return n && CONTAINERS.has(n.type) && Array.isArray(n.children) ? n.children : null;
}
// Put `item` after `after` (first for null; last when `after` is gone).
export function insertAfter(list: Json[], item: Json, after: Json, key = (x: Json): Json => x): void {
  if (after === null) { list.unshift(item); return; }
  const i = list.findIndex((x) => key(x) === after);
  if (i < 0) list.push(item); else list.splice(i + 1, 0, item);
}
export function unlist(list: Json[] | null, item: Json): void {
  const i = list ? list.indexOf(item) : -1;
  if (i >= 0) list!.splice(i, 1);
}
export function dropSubtrees(d: Json, roots: Json[]): void {
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop();
    const n = nodeIn(d, id);
    if (!n) continue;
    stack.push(...kidsOf(n));
    delete d.nodes[id];
  }
}
export const isTokenNode = (x: Json): boolean => isObj(x) && Object.keys(x).some((k) => k.startsWith('$'));
export const APPLY: Record<string, (d: Json, op: Json) => void> = {
  set(d: Json, op: Json) {
    const pi = pageAt(d, op.id);
    if (pi >= 0) { if (op.prop === 'name') d.pages[pi].name = op.value; return; }
    const n = nodeIn(d, op.id);
    if (n) setPath(n, op.prop, op.value);
  },
  add(d: Json, op: Json) {
    const nd = op.node;
    if (!isObj(nd) || typeof nd.id !== 'string') return;
    const after = typeof op.after === 'string' ? op.after : null;
    if (nd.type === 'page') {
      const pi = pageAt(d, nd.id);
      if (pi >= 0) { d.pages[pi].name = nd.name; return; }
      if (!own(d.nodes, nd.id)) insertAfter(d.pages, { id: nd.id, name: nd.name, children: [] }, after, (pg) => pg.id);
      return;
    }
    const ex = nodeIn(d, nd.id);
    if (ex) {
      // the same id again, of the same type and parent: its properties as sets
      if (ex.type === nd.type && ex.parent === nd.parent) for (const [path, v] of addedProps(nd)) setPath(ex, path, v);
      return;
    }
    const list = childrenOf(d, nd.parent);
    if (!list || pageAt(d, nd.id) >= 0) return;
    const n: Json = { type: nd.type, parent: nd.parent };
    if (CONTAINERS.has(nd.type)) n.children = [];
    for (const [path, v] of addedProps(nd)) setPath(n, path, v);
    put(d.nodes, nd.id, n);
    insertAfter(list, nd.id, after);
  },
  del(d: Json, op: Json) {
    const pi = pageAt(d, op.id);
    if (pi >= 0) {
      const [pg] = d.pages.splice(pi, 1);
      dropSubtrees(d, kidsOf(pg));
      return;
    }
    const n = nodeIn(d, op.id);
    if (!n) return;
    unlist(childrenOf(d, n.parent), op.id);
    dropSubtrees(d, [op.id]);
  },
  move(d: Json, op: Json) {
    const after = typeof op.after === 'string' ? op.after : null;
    const pi = pageAt(d, op.id);
    if (pi >= 0) {
      const prev = pi > 0 ? d.pages[pi - 1].id : null;
      if (op.parent !== null || after === prev || after === op.id) return;
      const [pg] = d.pages.splice(pi, 1);
      insertAfter(d.pages, pg, after, (x) => (isObj(x) ? x.id : null));
      return;
    }
    const n = nodeIn(d, op.id);
    const list = n ? childrenOf(d, op.parent) : null;
    if (!list) return;
    // never into its own subtree (walked up from the new parent, bounded)
    let cur = op.parent;
    for (let steps = 0; nodeIn(d, cur) && steps <= 20001; steps++) {
      if (cur === op.id) return;
      cur = d.nodes[cur].parent;
    }
    const old = childrenOf(d, n.parent);
    if (old && n.parent === op.parent) {
      const i = old.indexOf(op.id);
      const prev = i > 0 ? old[i - 1] : null;
      if (after === prev || after === op.id) return;
    }
    unlist(old, op.id);
    insertAfter(list, op.id, after);
    n.parent = op.parent;
  },
  token(d: Json, op: Json) {
    if (typeof op.path !== 'string') return;
    if (!isObj(d.tokens)) d.tokens = {};
    const segs = op.path.split('.');
    const chain: [Json, Json][] = [[d.tokens, null]];
    let g = d.tokens;
    for (const seg of segs.slice(0, -1)) {
      if (!own(g, seg)) {
        if (op.value === null) return;
        put(g, seg, {});
      } else if (!isObj(g[seg]) || isTokenNode(g[seg])) return;
      chain.push([g[seg], seg]);
      g = g[seg];
    }
    const last = segs[segs.length - 1];
    if (op.value === null) {
      if (!own(g, last)) return;
      delete g[last];
      // a group left empty goes
      for (let i = chain.length - 1; i >= 1; i--) if (Object.keys(chain[i][0]).length === 0) delete chain[i - 1][0][chain[i][1]];
      return;
    }
    put(g, last, structuredClone(op.value));
  },
};
// Apply `ops` to `d` in order (it is changed in place); an op that doesn't apply is skipped.
export function applyOps(d: Json, ops: Json): void {
  if (!Array.isArray(ops)) return;
  for (const op of ops) {
    if (!isObj(op) || typeof op.op !== 'string' || !own(APPLY, op.op)) continue;
    try { APPLY[op.op](d, op); } catch { /* skipped: the server judges it */ }
  }
}
