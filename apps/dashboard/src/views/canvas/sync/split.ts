// ---- edits over 64 KB (kit-669 §5, as ruled): split in their own order (canvas.html 2029-2237, kit-1015) ----
// Then a field's set, components and variants as the fields edit them, deletes, and free text.
// Each declaration is the page's own, with types added; checks/faithful.mjs holds it to the page's tokens.
// editSplit has a local `shared` (the page's), so there the holder is read as `holders.shared`.
import { isObj, own, state, type Json } from '../core/page';
import { MAX_ELEMENTS, nodeOf } from '../core/nodes';
import { VARIANT_RE } from '../core/checkers';
import { selRoots } from '../panels';
import { makeEntry, pushEntry, subtreeIds } from '../history';
import { applyOps, nodeIn } from './ops';
import { edit, editable, say, type EditOpts } from './copies';
import { shared } from './shared';
import * as holders from './shared';

// An op's bytes as JSON (UTF-8); a list of ops is [ … ] with a comma between.
export const jsonBytes = (v: Json): number => new TextEncoder().encode(JSON.stringify(v)).length;
// The references a node holds (kit-669 §5): [id, kind] pairs, kind 'comp' for an instance's component
// (it must be a component on the canvas), 'node' for a component's prop targets and variant overrides'
// ids and an instance's overrides' ids (each must be a node on the canvas).
export function refsHeld(n: Json): [string, string][] {
  const out: [string, string][] = [];
  if (!isObj(n)) return out;
  if (n.type === 'instance') {
    if (typeof n.component === 'string') out.push([n.component, 'comp']);
    if (isObj(n.overrides)) for (const id of Object.keys(n.overrides)) out.push([id, 'node']);
  } else if (n.type === 'component') {
    if (isObj(n.props)) for (const pd of Object.values<Json>(n.props)) if (isObj(pd) && isObj(pd.target) && typeof pd.target.id === 'string') out.push([pd.target.id, 'node']);
    if (isObj(n.variants)) for (const v of Object.values<Json>(n.variants)) if (isObj(v)) for (const id of Object.keys(v)) out.push([id, 'node']);
  }
  return out;
}
// `ops` cut, in their own order, into parts of at most OPS_BYTES as JSON, a cut allowed after an op
// only where applying the ops up to it to `doc` leaves no reference unresolved: no instance whose
// component is gone or not yet added, no component prop target or variant override, and no instance
// override, naming a node not on the canvas. The server judges the rest (an instance's variant and
// props ride on its own add, after its component's; whether a target is inside its component). One
// part when the whole fits; null when no allowed cut keeps every part within OPS_BYTES. Linear in the
// ops: one copy of `doc` each op is applied to in turn, the references held by its nodes indexed once
// (who names whom), and a running count of unresolved references updated per op.
export function splitParts(ops: Json, doc: Json): Json[][] | null {
  if (!Array.isArray(ops) || ops.length === 0) return null;
  const sizes = ops.map(jsonBytes);
  const total = sizes.reduce((s, x) => s + x, 0) + ops.length + 1;
  if (total <= shared.OPS_BYTES) return [ops];
  const d = structuredClone(doc);
  const out = new Map<string, Map<string, Map<string, number>>>(); // referrer -> Map(id -> Map(kind -> count))
  const into = new Map<string, Set<string>>(); // id -> Set(referrer)
  const index = (r: string): void => {
    const was = out.get(r);
    if (was) for (const id of was.keys()) into.get(id)?.delete(r);
    out.delete(r);
    const n = nodeIn(d, r);
    const held = n ? refsHeld(n) : [];
    if (held.length === 0) return;
    const m = new Map<string, Map<string, number>>();
    for (const [id, kind] of held) {
      if (!m.has(id)) m.set(id, new Map());
      m.get(id)!.set(kind, (m.get(id)!.get(kind) ?? 0) + 1);
      if (!into.has(id)) into.set(id, new Set());
      into.get(id)!.add(r);
    }
    out.set(r, m);
  };
  for (const id of Object.keys(d.nodes)) index(id);
  const ok = (id: string, kind: string): boolean => { const n = nodeIn(d, id); return n !== null && (kind !== 'comp' || n.type === 'component'); };
  // the unresolved references among the pairs held by `touched` ids or naming them
  const unresolved = (touched: string[]): number => {
    let bad = 0;
    const seen = new Set<string>();
    const pair = (r: string, id: string): void => {
      const k = `${r}\u0000${id}`;
      if (seen.has(k)) return;
      seen.add(k);
      if (!nodeIn(d, r)) return;
      const kinds = out.get(r)?.get(id);
      if (kinds) for (const [kind, c] of kinds) if (!ok(id, kind)) bad += c;
    };
    for (const x of touched) {
      const m = out.get(x);
      if (m) for (const id of m.keys()) pair(x, id);
      const by = into.get(x);
      if (by) for (const r of by) pair(r, x);
    }
    return bad;
  };
  let bad = unresolved(Object.keys(d.nodes));
  const start = bad;
  const cuts: number[] = []; // the op counts after which a cut is allowed
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    let touched: Json[] = [];
    if (isObj(op)) {
      if (op.op === 'add' && isObj(op.node) && typeof op.node.id === 'string') touched = [op.node.id];
      else if (op.op === 'del' && typeof op.id === 'string') touched = subtreeIds(d, op.id);
      else if (op.op === 'set' && typeof op.id === 'string') touched = [op.id];
    }
    bad -= unresolved(touched);
    applyOps(d, [op]);
    for (const x of touched) index(x);
    bad += unresolved(touched);
    if (bad <= start) cuts.push(i + 1);
  }
  // greedy: from each part's start, the furthest allowed cut that keeps the part within OPS_BYTES
  const parts: Json[][] = [];
  let from = 0;
  let c = 0;
  while (from < ops.length) {
    let bytes = 1; // '['
    let best = -1;
    let j = from;
    while (c < cuts.length && cuts[c] <= from) c++;
    for (let k = c; k < cuts.length; k++) {
      while (j < cuts[k]) { bytes += sizes[j] + 1; j++; } // each op and its ',' or ']'
      if (bytes > shared.OPS_BYTES) break;
      best = cuts[k];
    }
    if (best < 0) return null;
    parts.push(ops.slice(from, best));
    from = best;
  }
  return parts;
}
// An edit that may pass 64 KB (a delete, a nudge, a multi-node drag's release or restore): its parts
// (splitParts over the drawn document) queued in order, sharing one undo entry made before any is
// queued (each part's redraw changes state.doc); a plain edit pushes it once, a drag's kinds none
// (dragEntry makes the drag's). One part is one edit() as ever (a held key's set still coalesces). The
// queued items, or false: nothing queued (no allowed cut: "That change is too big to send.").
export function editSplit(ops: Json, opts: EditOpts = {}): Json[] | false {
  if (!editable() || !Array.isArray(ops) || ops.length === 0) return false;
  const parts = splitParts(ops, state.doc);
  if (parts === null) { say(holders.shared.SAY.tooBig); return false; }
  if (parts.length === 1 && opts.entry === undefined) {
    const item = edit(parts[0], opts);
    return item ? [item] : false;
  }
  let shared = opts.entry;
  if (shared === undefined) {
    shared = (opts.kind ?? 'plain') === 'plain' ? makeEntry(state.doc, ops) : null;
    if (shared) pushEntry(shared);
  }
  const items = [];
  for (const part of parts) {
    const item = edit(part, { ...opts, entry: shared });
    if (item) items.push(item);
  }
  return items.length ? items : false;
}
// One property of one node set: one edit of one set op.
export const setRaw = (id: Json, prop: string, value: Json): Json => edit([{ op: 'set', id, prop, value }]);
// A field's change: one set on the node, or in Change in one set on its component of the variant's
// override, `variants.<name>.<node id>.<prop>` (contract §2). Every field sends through here.
export function setProp(id: Json, prop: string, value: Json): Json {
  const vm = variantFor(id);
  if (vm === null) return setRaw(id, prop, value);
  return setRaw(vm.comp, `variants.${vm.name}.${id}.${prop}`, value);
}
// The component a node is inside (its nearest component ancestor, never the node itself), or null.
export function componentOf(id: Json): Json {
  const n = nodeOf(id);
  let cur = n ? n.parent : null;
  for (let steps = 0; steps <= MAX_ELEMENTS && nodeOf(cur); steps++) {
    if (nodeOf(cur).type === 'component') return cur;
    cur = nodeOf(cur).parent;
  }
  return null;
}
// A component's variant names, in order.
export const variantNames = (c: Json): string[] => (c && c.type === 'component' && isObj(c.variants) ? Object.keys(c.variants).filter((k) => VARIANT_RE.test(k)) : []);
// The variant a node's fields edit (Change in): { comp, name } while the panel is set to a variant of
// the component the node is inside and that variant still exists, else null (Base).
export function variantFor(id: Json): Json {
  const vm = state.variantMode;
  if (vm === null) return null;
  const comp = componentOf(id);
  if (comp === null || comp !== vm.comp || !variantNames(nodeOf(comp)).includes(vm.name)) return null;
  return vm;
}
// In Change in, whether the variant holds an override of `path` on the node, and its value.
export function variantHeld(id: Json, path: string): { held: boolean; value?: Json } {
  const vm = variantFor(id);
  if (vm === null) return { held: false };
  const v = nodeOf(vm.comp).variants[vm.name];
  const o = isObj(v) && own(v, id) && isObj(v[id]) ? v[id] : null;
  return o !== null && own(o, path) ? { held: true, value: o[path] } : { held: false };
}
// Delete nodes (kit-669 §2): a del per root, in the order given, every root whose subtree holds a
// component after the rest (so an instance goes before its component); split over 64 KB (editSplit),
// one undo entry. Nothing sent, and kit-662's words, when a component deleted has an instance outside
// what is deleted.
export function deleteIds(roots: Json[]): Json[] | false {
  if (!editable()) return false;
  const d = state.doc;
  const ids = roots.filter((id) => nodeOf(id));
  if (ids.length === 0) return false;
  const inside = new Set<Json>();
  const holds = new Set<Json>();
  for (const r of ids) {
    for (const x of subtreeIds(d, r) as Json[]) {
      inside.add(x);
      if (nodeIn(d, x)?.type === 'component') holds.add(r);
    }
  }
  if (holds.size > 0) {
    const comps = new Set([...inside].filter((x) => nodeIn(d, x)?.type === 'component'));
    if (Object.keys(d.nodes).some((x) => !inside.has(x) && nodeIn(d, x)?.type === 'instance' && comps.has(d.nodes[x].component))) {
      say(shared.SAY.instancesFirst);
      return false;
    }
  }
  const order = [...ids.filter((r) => !holds.has(r)), ...ids.filter((r) => holds.has(r))];
  return editSplit(order.map((id) => ({ op: 'del', id })));
}
// Delete a node (the tree's Delete on a row not selected); a component that still has instances is kept.
export const deleteNode = (id: Json): Json[] | false => deleteIds([id]);
// Delete the selection (Delete, Backspace, Delete layer, Delete layers): its roots.
export const deleteSelection = (): Json[] | false => deleteIds(selRoots());
export const wellFormed = (v: Json): boolean => typeof v.isWellFormed !== 'function' || v.isWellFormed();
// Free text as canvas-doc@1's name and text classes take it (kit-312): well-formed, and no control
// character but tab, line feed and carriage return; the server refuses anything else.
export const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
export const freeText = (v: Json): boolean => wellFormed(v) && !CONTROL_RE.test(v);
