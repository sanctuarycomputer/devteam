// Move (canvas.html 3078-3162 and 3264-3572, kit-1016): a press selects, a drag moves (one node or
// several, with live edits), the drag rectangle, a drop, a restore, and the arrows' nudge. Each
// declaration is the page's own, with types added; the page's load-time statements run, in its order,
// from initMove(). No DOM at import.
//
import { $, live, own, pageById, state, type Json } from '../core/page';
import { CONTAINERS, MAX_ELEMENTS, kidsOf, nodeOf } from '../core/nodes';
import { clamp, finite } from '../core/checkers';
import { baseOf, placedByXY, select, selectIds, selRoots } from '../panels';
import * as panels from '../panels';
import { edit, editSplit, editable, jsonBytes, say } from '../sync';
import * as sync from '../sync';
import { coalesceEntry } from '../history';
import * as history from '../history';
import { shared } from './held';
import { SAY3, ownComponentAbove } from './components';
import { endGesture, inSubtree, placeAt, toolsOn } from './tools';
import { hasBox, resizeOps, resizeTarget } from './resize';

/** One of several's targets: the node's drag entry and where it goes now. */
export type Target = { m: Json; x: number; y: number };

// A press on a drawn node selects it (kit-661's rule: inside an instance, the instance); past 3 px it
// drags it, the node previewed under the pointer by a translate on its element; the release sends one
// edit. Escape (setTool) or a lost pointer drops the drag. The press, the grab and the movement are
// kept in page px, so the grab point stays under the pointer whatever the view does meanwhile.
// kit-668 §2: a node placed by x, y sends live edits while dragged (set x, set y as if dropped in its
// own parent at the pointer), at most one per 100 ms: the first 100 ms after the drag passes its slop,
// then 100 ms after the last while the position has changed, each with the latest values. The release's
// edit and a restore wait (notBefore) until 100 ms after the last live edit. A drag that ends without
// its drop after live edits went (Escape, a lost pointer, a refused drop, the node off the shown page)
// sends x, y back to its start. A drag's queued items are kept in g.items (its one undo entry, T3).

// kit-669 §2: a press on empty stage starts the drag rectangle; a Shift press on a node starts nothing
// (its click toggles it); a press on a member of a selection of several keeps the selection and drags
// every root of it placed by numeric x, y (g.nodes; see pressSeveral).
export function pressMove(e: PointerEvent, hit: Json): void {
  const id = hit ? hit.dataset.id : null;
  if (id === null) {
    shared.gesture = { id: e.pointerId, tool: 'marquee', sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, dragged: false, draft: null, shift: false };
    return;
  }
  if (!nodeOf(id) || e.shiftKey) return;
  if (state.sels.length > 1 && state.sels.includes(id)) { pressSeveral(e, id); return; }
  select(id);
  if (state.sel !== id) return;
  const s = $('surface').getBoundingClientRect();
  const r = (live.drawn.get(id) ?? hit).getBoundingClientRect();
  const z = panels.shared.view.z;
  shared.gesture = {
    id: e.pointerId, tool: 'move', sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, dragged: false, draft: null,
    node: id, el: null,
    px: (e.clientX - s.left) / z, py: (e.clientY - s.top) / z, // the press, in page px
    gx: (e.clientX - r.left) / z, gy: (e.clientY - r.top) / z, // the grab, from the node's top-left
    // live: sends live edits (placed by x, y, both stored as numbers: a token-valued x or y sends none,
    // its drop falls back to the pointer's position); start: x, y as drawn at the press; sent: x, y as
    // the last live edit (or restore) left them; lastAt: when the last live edit went (performance.now);
    // timer: the throttle's; liveSent: a live edit went; items: the drag's queued edits; snapshot: the
    // drawn document when it passed its slop (its one undo entry is walked from it); restored: the
    // drag ended in a restore (pushes no undo entry)
    live: false, start: { x: baseOf(id, 'x'), y: baseOf(id, 'y') }, sent: null, lastAt: null, timer: null,
    liveSent: false, items: [], snapshot: null, restored: false,
  };
  shared.gesture.live = placedByXY(nodeOf(id)) && finite(shared.gesture.start.x) && finite(shared.gesture.start.y);
  shared.gesture.sent = { ...shared.gesture.start };
}
// A press on a member of several: the selection kept while pressed (released without a drag, the
// pressed node alone: collapseTo); g.nodes, every selection root placed by x, y with numeric x and y,
// each { id, start, sent, el }, moved by the pointer's movement within its own parent (never into
// another: a multi-node drag sends sets only). Live edits as one node's, of all their sets; none when
// one would pass 64 KB.
export function pressSeveral(e: PointerEvent, id: Json): void {
  const s = $('surface').getBoundingClientRect();
  const z = panels.shared.view.z;
  const nodes: Json[] = [];
  for (const r of selRoots()) {
    const n = nodeOf(r);
    if (!n || !placedByXY(n)) continue;
    const start = { x: baseOf(r, 'x'), y: baseOf(r, 'y') };
    if (finite(start.x) && finite(start.y)) nodes.push({ id: r, start, sent: { ...start }, el: null });
  }
  shared.gesture = {
    id: e.pointerId, tool: 'move', sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, dragged: false, draft: null,
    node: id, el: null, nodes, collapseTo: id,
    px: (e.clientX - s.left) / z, py: (e.clientY - s.top) / z,
    gx: 0, gy: 0, live: nodes.length > 0, start: null, sent: null, lastAt: null, timer: null,
    liveSent: false, items: [], snapshot: null, restored: false,
  };
}
// The selection's drag rectangle released: the shown page's top-level nodes drawn with a box that
// meets it (hidden ones have none), added to the selection when Shift is held at the release.
export function marqueeSelect(g: Json): void {
  const l = Math.min(g.sx, g.cx);
  const r = Math.max(g.sx, g.cx);
  const t = Math.min(g.sy, g.cy);
  const b = Math.max(g.sy, g.cy);
  const pg = pageById(state.pageId);
  const hits: Json[] = [];
  for (const id of pg ? kidsOf(pg) : []) {
    const el = live.drawn.get(id);
    if (!el || el.getClientRects().length === 0) continue;
    const box = el.getBoundingClientRect();
    if (box.left <= r && box.right >= l && box.top <= b && box.bottom >= t) hits.push(id);
  }
  selectIds(g.shift ? [...state.sels, ...hits] : hits);
}

// The pointer's movement since the press, in page px.
export function moveBy(g: Json): { dx: number; dy: number } {
  const s = $('surface').getBoundingClientRect();
  return { dx: (g.cx - s.left) / panels.shared.view.z - g.px, dy: (g.cy - s.top) / panels.shared.view.z - g.py };
}
export function movePreview(g: Json): void {
  if (g.nodes) {
    const { dx, dy } = moveBy(g);
    for (const m of g.nodes) {
      const el = live.drawn.get(m.id);
      if (m.el && m.el !== el) m.el.style.translate = '';
      m.el = el ?? null;
      if (m.el && Number.isFinite(dx) && Number.isFinite(dy)) m.el.style.translate = `${dx - (m.sent.x - m.start.x)}px ${dy - (m.sent.y - m.start.y)}px`;
    }
    return;
  }
  const el = live.drawn.get(g.node);
  if (g.el && g.el !== el) g.el.style.translate = '';
  g.el = el ?? null;
  if (!g.el) return;
  // less what the live edits have already moved it in the drawing (no doubled step after a redraw)
  const { dx, dy } = moveBy(g);
  const ox = g.live ? g.sent.x - g.start.x : 0;
  const oy = g.live ? g.sent.y - g.start.y : 0;
  if (Number.isFinite(dx) && Number.isFinite(dy)) g.el.style.translate = `${dx - ox}px ${dy - oy}px`;
}
// The drag's position now in its own parent, whole px: the start moved by the pointer.
export function liveTarget(g: Json): Json {
  const { dx, dy } = moveBy(g);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  return { x: clamp(Math.round(g.start.x + dx), -panels.shared.PX, panels.shared.PX), y: clamp(Math.round(g.start.y + dy), -panels.shared.PX, panels.shared.PX) };
}
// The throttle's timer: one live edit of the sets that changed since the last sent. g.sent moves to the
// targets before edit() (whose redraw then previews from them); back when nothing was queued.
// Each of several's target now: its start moved by the pointer, whole px.
export function severalTargets(g: Json): Target[] | null {
  const { dx, dy } = moveBy(g);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  return g.nodes.map((m: Json) => ({ m, x: clamp(Math.round(m.start.x + dx), -panels.shared.PX, panels.shared.PX), y: clamp(Math.round(m.start.y + dy), -panels.shared.PX, panels.shared.PX) }));
}
// Several's sets from what each last sent (or, `back`, to their starts), in g.nodes' order.
export function severalOps(list: Json[], back = false): Json[] {
  const ops: Json[] = [];
  for (const t of list) for (const k of ['x', 'y']) {
    const to = back ? t.m.start[k] : t[k];
    if (to !== t.m.sent[k]) ops.push({ op: 'set', id: t.m.id, prop: k, value: to });
  }
  return ops;
}
export function liveSend(g: Json): void {
  g.timer = null;
  if (g.tool === 'resize') {
    if (shared.gesture !== g || !editable() || !nodeOf(g.node)) return;
    const to = resizeTarget(g);
    if (to === null) return;
    const ops = resizeOps(g, to);
    if (ops.length === 0) return;
    const prev = g.sent;
    g.sent = { ...g.sent, ...to };
    const item = edit(ops, { kind: 'live' });
    if (!item) { g.sent = prev; return; }
    g.lastAt = performance.now();
    g.liveSent = true;
    g.items.push(item);
    return;
  }
  if (g.nodes) {
    if (shared.gesture !== g || !g.live || !editable()) return;
    const list = severalTargets(g);
    if (list === null) return;
    const ops = severalOps(list);
    if (ops.length === 0) return;
    if (jsonBytes(ops) > sync.shared.OPS_BYTES) { g.live = false; return; } // only the release then, split
    const prev = list.map((t) => t.m.sent);
    for (const t of list) t.m.sent = { x: t.x, y: t.y };
    const item = edit(ops, { kind: 'live' });
    if (!item) { list.forEach((t, i) => { t.m.sent = prev[i]; }); return; }
    g.lastAt = performance.now();
    g.liveSent = true;
    g.items.push(item);
    return;
  }
  if (shared.gesture !== g || !g.live || !editable() || !nodeOf(g.node)) return;
  const to = liveTarget(g);
  if (to === null) return;
  const ops = [];
  for (const k of ['x', 'y']) if (to[k] !== g.sent[k]) ops.push({ op: 'set', id: g.node, prop: k, value: to[k] });
  if (ops.length === 0) return;
  const prev = g.sent;
  g.sent = to;
  const item = edit(ops, { kind: 'live' });
  if (!item) { g.sent = prev; return; }
  g.lastAt = performance.now();
  g.liveSent = true;
  g.items.push(item);
}
// A drag ended without its drop after live edits went: one edit setting x, y back to the start (those
// the last live edit moved), through the same throttle, drawn at once. Nothing when editing is no
// longer allowed, or the node is gone.
export function restore(g: Json): void {
  if (g.tool === 'resize') {
    if (!g.liveSent || !editable() || !nodeOf(g.node)) return;
    g.restored = true;
    const ops = resizeOps(g, g.start);
    if (ops.length === 0) return;
    g.sent = { ...g.start };
    const item = edit(ops, { kind: 'restore', notBefore: g.lastAt + 100 });
    if (item) g.items.push(item);
    return;
  }
  if (g.nodes) {
    if (!g.liveSent || !editable()) return;
    g.restored = true;
    const ops = severalOps(g.nodes.filter((m: Json) => nodeOf(m.id)).map((m: Json) => ({ m })), true);
    if (ops.length === 0) return;
    for (const m of g.nodes) m.sent = { ...m.start };
    const items: Json = editSplit(ops, { kind: 'restore', notBefore: g.lastAt + 100 });
    if (items) g.items.push(...items);
    return;
  }
  if (!g.liveSent || !editable() || !nodeOf(g.node)) return;
  g.restored = true;
  const ops = [];
  for (const k of ['x', 'y']) if (g.sent[k] !== g.start[k]) ops.push({ op: 'set', id: g.node, prop: k, value: g.start[k] });
  if (ops.length === 0) return;
  g.sent = { ...g.start };
  const item = edit(ops, { kind: 'restore', notBefore: g.lastAt + 100 });
  if (item) g.items.push(item);
}
// A Move drag or its release or restore waiting for the throttle (T3: Ctrl+Z is ignored meanwhile).
export const dragWaiting = (): boolean => state.pending.some((e) => e.notBefore > performance.now());
// After a redraw (someone's edit) the dragged node's new element takes the preview; a node gone ends
// the drag with nothing sent, one no longer on the shown page ends it with a restore.
export function keepDrag(): void {
  const g = shared.gesture;
  if (g && g.tool === 'resize') {
    // a resize: its node gone ends it with nothing sent; no longer drawn (another page, hidden), with
    // a restore when live edits went
    if (!nodeOf(g.node)) endGesture(g);
    else if (!hasBox(g.node)) endGesture(g, { abort: true });
    return;
  }
  if (!g || g.tool !== 'move' || !g.dragged) return;
  if (g.nodes) {
    // several: a node gone drops out; one off the shown page drops out, sent back to its start when
    // live edits moved it; none left ends the drag with nothing sent
    const gone = g.nodes.filter((m: Json) => !nodeOf(m.id) || !live.drawn.has(m.id));
    if (gone.length) {
      g.nodes = g.nodes.filter((m: Json) => !gone.includes(m));
      for (const m of gone) if (m.el) { m.el.style.translate = ''; m.el = null; }
      const back = severalOps(gone.filter((m: Json) => nodeOf(m.id)).map((m: Json) => ({ m })), true);
      for (const m of gone) m.sent = { ...m.start };
      // those still on the canvas sent back first (T2-1), even when none is left to drag; then a drag
      // with no node left ends (nothing more sent when every node is gone)
      const restoring = back.length > 0 && g.liveSent && editable();
      if (restoring) {
        const items: Json = editSplit(back, { kind: 'restore', notBefore: g.lastAt + 100 });
        if (items) g.items.push(...items);
      }
      if (g.nodes.length === 0) { if (restoring) g.restored = true; endGesture(g); return; }
      if (restoring) return; // its redraw has previewed the rest
    }
    movePreview(g);
    return;
  }
  if (!nodeOf(g.node)) { endGesture(g); return; }
  if (!live.drawn.has(g.node)) { endGesture(g, { abort: true }); return; }
  movePreview(g);
}
// Every node of a subtree (the root first), bounded.
export function subtreeOf(id: Json): Json[] {
  const out: Json[] = [];
  const stack = [id];
  while (stack.length && out.length <= MAX_ELEMENTS) {
    const n = nodeOf(stack.pop());
    if (!n) continue;
    out.push(n);
    if (CONTAINERS.has(n.type)) stack.push(...kidsOf(n));
  }
  return out;
}
// The components at or above a parent (a node id, or a page id: none).
export function componentsAbove(pid: Json): Set<Json> {
  const out = new Set<Json>();
  let cur = pid;
  for (let steps = 0; steps <= MAX_ELEMENTS && nodeOf(cur); steps++) {
    if (nodeOf(cur).type === 'component') out.add(cur);
    cur = nodeOf(cur).parent;
  }
  return out;
}
// Why node `id` may not go under `pid`, in the page's words, or null when it may: never into itself
// or its subtree, never a component inside a component ("That layer can't go there."), never an
// instance inside its own component, directly or through other instances (§3's words).
export function goRefusal(id: Json, pid: Json): string | null {
  if (inSubtree(pid, id)) return sync.shared.REFUSED.parent;
  if (componentsAbove(pid).size === 0) return null;
  const sub = subtreeOf(id);
  if (sub.some((n) => n.type === 'component')) return sync.shared.REFUSED.parent;
  if (sub.some((n) => n.type === 'instance' && typeof n.component === 'string' && ownComponentAbove(n.component, pid))) return SAY3.ownComponent;
  return null;
}
// The release: placed by placeAt at the pointer (the node's own subtree skipped). Under the same
// `none` frame or page: set x, set y, only those that changed. Elsewhere, or within an auto-layout
// frame: a move with its `after` (nothing when that is where it already is), plus set x, set y (its
// top-left as previewed, whole px) when the new parent places by x, y. A drop the canvas would
// refuse sends nothing and says so. kit-668: under the same parent the sets are computed from the
// drag's start and hold only those that differ from the last live edit; the edit waits for the
// throttle (notBefore) and is never coalesced. 'sent', 'none' (nothing more to send) or 'refused' (a
// refused drop, or the node off the shown page: the caller restores).
export function dropMove(g: Json): 'sent' | 'none' | 'refused' {
  if (!g.dragged || !editable()) return 'none';
  if (g.nodes) {
    // several: the sets of what differs from the last live edit, split over 64 KB; never a move
    const list = severalTargets(g);
    if (list === null) return 'refused';
    const live = list.filter((t) => nodeOf(t.m.id));
    const ops = severalOps(live);
    if (ops.length === 0) return 'none';
    const items: Json = editSplit(ops, { kind: 'release', notBefore: g.liveSent ? g.lastAt + 100 : 0 });
    if (!items) return 'refused';
    for (const t of live) t.m.sent = { x: t.x, y: t.y };
    g.items.push(...items);
    return 'sent';
  }
  const id = g.node;
  const n = nodeOf(id);
  if (!n) return 'none'; // gone
  if (!live.layerRows.has(id)) return 'refused'; // no longer on the shown page
  const at = placeAt(g.cx, g.cy, id);
  const no = goRefusal(id, at.parent);
  if (no !== null) { say(no); return 'refused'; }
  const { dx, dy } = moveBy(g);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 'refused';
  const left = clamp(Math.round(at.x - g.gx), -panels.shared.PX, panels.shared.PX);
  const top = clamp(Math.round(at.y - g.gy), -panels.shared.PX, panels.shared.PX);
  const ops = [];
  if (at.parent === n.parent && at.free) {
    for (const [k, d, drop] of [['x', dx, left], ['y', dy, top]]) {
      const v = g.start[k];
      const next = finite(v) ? clamp(Math.round(v + d), -panels.shared.PX, panels.shared.PX) : drop;
      if (next !== g.sent[k]) ops.push({ op: 'set', id, prop: k, value: next });
    }
  } else {
    if (at.parent === n.parent) {
      const sibs = kidsOf(nodeOf(n.parent) ?? pageById(n.parent) ?? { children: [] });
      const i = sibs.indexOf(id);
      if (i >= 0 && at.after === (i > 0 ? sibs[i - 1] : null)) return 'none'; // dropped where it was
    }
    ops.push({ op: 'move', id, parent: at.parent, after: at.after });
    if (at.free) ops.push({ op: 'set', id, prop: 'x', value: left }, { op: 'set', id, prop: 'y', value: top });
  }
  if (ops.length === 0) return 'none';
  const item = edit(ops, { kind: 'release', notBefore: g.liveSent ? g.lastAt + 100 : 0 });
  if (!item) return 'none';
  g.items.push(item);
  return 'sent';
}

// Arrow keys nudge the selected node placed by x, y: 1 px, 10 with Shift; one set each, so held keys
// coalesce in the sender while unsent (§1). Only while focus is on the page itself or the stage: in a
// field the arrows are the field's, in the Layers tree they move between rows.
export const ARROWS: Record<string, number[]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
// kit-669 §2: every selection root placed by x, y (its x or y, the axis moved, a number), as one edit
// of their sets (split over 64 KB); one node's one set still coalesces with the last unsent one.
// A held arrow (kit-669 T2-2): its repeats extend the undo entry its first press pushed (what each set
// left moves on, its before stays), so one Ctrl+Z takes back the whole hold; with that entry they also
// coalesce into the last unsent nudge (edit()), so the latest values go, never a burst. { key, entry,
// keys }, or null; a new press or the key's release ends it.
export let heldNudge: Json = null;
export const opKeys = (ops: Json[]): string => ops.map((o) => `${o.id}\u0000${o.prop}`).join('\u0001');
export function nudge(dx: number, dy: number, key: string | null = null, repeat = false): void {
  if (!editable()) return;
  const ops: Json[] = [];
  for (const id of selRoots()) {
    const n = nodeOf(id);
    if (!n || !placedByXY(n)) continue;
    // the axis moved must hold a number (a token there is left as it is, as kit-662's nudge did)
    for (const [k, d] of [['x', dx], ['y', dy]] as [string, number][]) {
      const v = baseOf(id, k);
      if (d !== 0 && finite(v)) ops.push({ op: 'set', id, prop: k, value: clamp(v + d, -panels.shared.PX, panels.shared.PX) });
    }
  }
  if (ops.length === 0) return;
  const h = heldNudge;
  const same = repeat && h !== null && h.key === key && h.keys === opKeys(ops) && history.shared.undos[history.shared.undos.length - 1] === h.entry
    && ops.every((op) => h.entry.reverts.some((r: Json) => r.t === 'set' && r.id === op.id && r.prop === op.prop));
  if (same) {
    for (const op of ops) coalesceEntry(h.entry, op);
    editSplit(ops, { entry: h.entry });
    return;
  }
  const items: Json = editSplit(ops);
  const entry = items ? items[items.length - 1].entry : null;
  heldNudge = key !== null && entry ? { key, entry, keys: opKeys(ops) } : null;
}

// The page's load-time statements of these lines, in its order.
export function initMove(): void {
  document.addEventListener('keydown', (e) => {
    if (!own(ARROWS, e.key) || !toolsOn() || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t !== document.body && t !== document.documentElement && t !== $('stage')) return;
    if (state.sels.length === 0 || shared.gesture !== null || shared.pen !== null) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const [dx, dy] = ARROWS[e.key];
    nudge(dx * step, dy * step, e.key, e.repeat);
  });
  document.addEventListener('keyup', (e) => { if (heldNudge !== null && e.key === heldNudge.key) heldNudge = null; });
}
