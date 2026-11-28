// Undo (canvas.html 3573-3787, kit-1017): each page undoes its own edits.
// Each declaration is the page's own, with types added; the page's load-time statements run, in its
// order, from initUndo(). No DOM at import.
import { kidsOf, MAX_ELEMENTS } from '../core/nodes';
import { isObj, own, state, type Json } from '../core/page';
import { dragWaiting, toolsOn } from '../editing';
import { typing } from '../panels';
import { applyOps, childrenOf, edit, nodeIn, pageAt, pathKeys, put, removing, say, splitParts } from '../sync';
import * as panels from '../panels';
import * as sync from '../sync';
import * as editing from '../editing';
import { shared } from './held';

// ---- undo (kit-668 §3) ----
// Each page undoes its own edits. Every plain edit (a tool, a field, a key, a drop, a button) pushes
// one entry on `undos`; a whole Move drag (its live edits and its release) one entry at its end, none
// when it ended in a restore; an undo's own edit none. At most UNDO_MAX, the oldest goes; an entry
// goes when any of its edits is refused (dropEntryOf). An entry holds one revert per op, walked over
// a copy of the drawn document when the edit was made, each with what its op left; an undo reverts
// only what is still as its edit left it, so someone else's change since is skipped, and said.
export const UNDO_MAX = 100;
export const UNDO_SAY = {
  none: 'Nothing to undo.',
  all: "Someone else changed that since, so it wasn't undone.",
  part: 'Part of that was changed by someone else since, so only the rest was undone.',
};
// (undos is on `shared`, held.ts)
export const NONE = Symbol('nothing stored');
// A path whose default is absent: a null there removes it (contract §4), so that is its "before".
export const ABSENT_DEFAULT = removing;
// The value stored at a property path of a node (own keys only; a page has only its name), or NONE.
export function stored(d: Json, id: Json, path: Json) {
  const pi = pageAt(d, id);
  if (pi >= 0) return path === 'name' && own(d.pages[pi], 'name') ? d.pages[pi].name : NONE;
  let at = nodeIn(d, id);
  if (at === null) return NONE;
  for (const k of pathKeys(path)) {
    if (!isObj(at) || !own(at, k)) return NONE;
    at = at[k];
  }
  return at;
}
// Stored values compared deep-equal (objects by their keys, whatever the order); NONE equals only NONE.
export function same(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (a === NONE || b === NONE) return false;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (isObj(a)) {
    if (!isObj(b)) return false;
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => own(b, k) && same(a[k], b[k]));
  }
  return false;
}
export const copy = (v: Json) => (v === NONE ? NONE : structuredClone(v));
export const onCanvas = (d: Json, id: Json) => pageAt(d, id) >= 0 || nodeIn(d, id) !== null;
export const parentIn = (d: Json, id: Json) => (pageAt(d, id) >= 0 ? null : nodeIn(d, id)?.parent);
// A page's or node's subtree, its ids in pre-order (the root first), bounded.
export function subtreeIds(d: Json, id: Json) {
  const out = [];
  const seen = new Set();
  const stack = [id];
  while (stack.length && out.length <= MAX_ELEMENTS) {
    const x = stack.pop();
    if (seen.has(x)) continue;
    const pi = pageAt(d, x);
    const n = pi >= 0 ? d.pages[pi] : nodeIn(d, x);
    if (!n) continue;
    seen.add(x);
    out.push(x);
    stack.push(...kidsOf(n).reverse());
  }
  return out;
}
// The sibling before `id` in its parent's children (a page's: the pages), null for first.
export function prevOf(d: Json, id: Json) {
  const pi = pageAt(d, id);
  if (pi >= 0) return pi > 0 && isObj(d.pages[pi - 1]) ? d.pages[pi - 1].id : null;
  const list: Json = childrenOf(d, nodeIn(d, id)?.parent);
  const i = list ? list.indexOf(id) : -1;
  return i > 0 ? list[i - 1] : null;
}
// A node as an add puts it back: its properties as stored, no children key; a page by its name, with
// parent null (kit-668 final-1 F3: the server refuses a page add without it).
export function addBack(d: Json, id: Json) {
  const pi = pageAt(d, id);
  if (pi >= 0) return { op: 'add', node: { id, type: 'page', parent: null, name: d.pages[pi].name }, after: prevOf(d, id) };
  const n = nodeIn(d, id);
  const node = { id };
  for (const k of Object.keys(n)) if (k !== 'children' && k !== 'id') put(node, k, structuredClone(n[k]));
  return { op: 'add', node, after: prevOf(d, id) };
}
// One op's revert, read from `d` before the op is applied (spec §3's table); what it left is read
// after (makeEntry). null when the op changes nothing undoable here; `entry.partial` when it changes
// something with no revert (a set of a path with no default, a token, an add over an id already there).
export function revertOf(d: Json, op: Json, entry: Json) {
  if (op.op === 'set') {
    if (typeof op.prop !== 'string' || !onCanvas(d, op.id)) return null;
    if (pageAt(d, op.id) >= 0 && op.prop !== 'name') return null;
    let before = stored(d, op.id, op.prop);
    if (before === NONE) {
      if (ABSENT_DEFAULT(pathKeys(op.prop))) before = null;
      else if (own(panels.shared.DEFAULT, op.prop)) before = panels.shared.DEFAULT[op.prop];
      else { entry.partial = true; return null; }
    }
    return { t: 'set', id: op.id, prop: op.prop, before: structuredClone(before), left: NONE };
  }
  if (op.op === 'add') {
    const id = isObj(op.node) ? op.node.id : null;
    if (typeof id !== 'string') return null;
    if (onCanvas(d, id)) { entry.partial = true; return null; }
    return { t: 'add', id, ids: [] };
  }
  if (op.op === 'del') {
    if (!onCanvas(d, op.id)) return null;
    const ids = subtreeIds(d, op.id);
    return { t: 'del', id: op.id, parent: parentIn(d, op.id), ids, adds: ids.map((x) => addBack(d, x)) };
  }
  if (op.op === 'move') {
    if (!onCanvas(d, op.id)) return null;
    return { t: 'move', id: op.id, parent: parentIn(d, op.id), after: prevOf(d, op.id), left: null };
  }
  entry.partial = true;
  return null;
}
// An edit's entry: its ops walked one by one over a copy of `doc`, each giving a revert with what it
// left; several sets of one path keep the earliest before and the latest left. null when no op gave one.
export function makeEntry(doc: Json, ops: Json) {
  const d = structuredClone(doc);
  const entry: Json = { reverts: [], partial: false };
  for (const op of ops) {
    if (!isObj(op)) continue;
    const r = revertOf(d, op, entry);
    applyOps(d, [op]);
    if (r === null) continue;
    if (r.t === 'set') {
      r.left = copy(stored(d, r.id, r.prop));
      const prior = entry.reverts.find((x: Json) => x.t === 'set' && x.id === r.id && x.prop === r.prop);
      if (prior) { prior.left = r.left; continue; }
    } else if (r.t === 'add') {
      if (!onCanvas(d, r.id)) continue; // it didn't apply here: nothing to take back
      r.ids = subtreeIds(d, r.id);
    } else if (r.t === 'move') {
      r.left = parentIn(d, r.id);
    }
    entry.reverts.push(r);
  }
  return entry.reverts.length > 0 ? entry : null;
}
// A coalesced set (kit-662's held key): the replaced edit's entry takes what the new value leaves.
export function coalesceEntry(entry: Json, op: Json) {
  const r = entry.reverts.find((x: Json) => x.t === 'set' && x.id === op.id && x.prop === op.prop);
  if (r) r.left = op.value === null && ABSENT_DEFAULT(pathKeys(op.prop)) ? NONE : structuredClone(op.value);
}
export function pushEntry(entry: Json) {
  shared.undos.push(entry);
  if (shared.undos.length > UNDO_MAX) shared.undos.splice(0, shared.undos.length - UNDO_MAX);
}
// A Move drag's end: one entry for all its edits, from where the node was when it passed its slop
// (g.snapshot) to where it ended; none when it ended in a restore, sent nothing, or an edit of it was
// refused already.
export function dragEntry(g: Json) {
  if (g.restored || g.snapshot === null || g.items.length === 0 || g.items.some((i: Json) => i.dropped)) return;
  const entry = makeEntry(g.snapshot, g.items.flatMap((i: Json) => i.ops));
  if (entry === null) return;
  for (const i of g.items) i.entry = entry;
  pushEntry(entry);
}
// One revert judged against `c` (the drawn document, with the reverts kept so far applied): its ops,
// or null when someone else changed it since (spec §3's skip column). A move back whose old parent is
// gone is skipped too: the server would refuse it, and with it the rest of the undo.
export function judge(c: Json, r: Json) {
  if (r.t === 'set') {
    if (!onCanvas(c, r.id) || !same(stored(c, r.id, r.prop), r.left)) return null;
    return [{ op: 'set', id: r.id, prop: r.prop, value: structuredClone(r.before) }];
  }
  if (r.t === 'add') {
    if (!onCanvas(c, r.id)) return null;
    const was = new Set(r.ids);
    if (subtreeIds(c, r.id).some((x) => !was.has(x))) return null;
    return [{ op: 'del', id: r.id }];
  }
  if (r.t === 'del') {
    if (r.ids.some((x: Json) => onCanvas(c, x))) return null;
    if (r.parent !== null && !onCanvas(c, r.parent)) return null;
    return structuredClone(r.adds);
  }
  if (r.t === 'move') {
    if (!onCanvas(c, r.id) || parentIn(c, r.id) !== r.left) return null;
    if (r.parent !== null && !onCanvas(c, r.parent)) return null;
    return [{ op: 'move', id: r.id, parent: r.parent, after: r.after }];
  }
  return null;
}
// Ctrl+Z: the top entry taken off, its reverts judged in reverse op order over a copy of the drawn
// document (each kept one applied to it, so later ones are judged against what earlier ones did);
// the kept ones go as one edit, and the person is told what was skipped.
export function undo() {
  const entry = shared.undos.pop();
  if (!entry) { say(UNDO_SAY.none); return; }
  const c = structuredClone(state.doc);
  const out = [];
  let skipped = entry.partial;
  for (const r of [...entry.reverts].reverse()) {
    const ops = judge(c, r);
    if (ops === null) { skipped = true; continue; }
    applyOps(c, ops);
    out.push(...ops);
  }
  if (out.length === 0) { say(UNDO_SAY.all); return; }
  // kit-669 §5 (as ruled): over 64 KB, cut in this order where no reference is left unresolved and
  // sent as consecutive edits; with no such cut nothing is sent, said, and the entry is kept
  const parts = splitParts(out, state.doc);
  if (parts === null) { pushEntry(entry); say(sync.shared.SAY.tooBig); return; }
  let sent = false;
  for (const part of parts) if (edit(part, { kind: 'undo' })) sent = true;
  if (sent && skipped) say(UNDO_SAY.part);
}
// Ctrl+Z (Cmd+Z on a Mac), no Shift, no Alt: only while no field has focus (there it is the field's),
// at 760 px and over, while editing is allowed, and not during a drag (its throttled release or
// restore included) or a path being drawn.
export function initUndo(): void {
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || typeof e.key !== 'string' || e.key.toLowerCase() !== 'z') return;
    if (!toolsOn() || typing(e.target) || editing.shared.gesture !== null || editing.shared.pen !== null || dragWaiting()) return;
    e.preventDefault();
    undo();
  });
}
