// Resize handles (canvas.html 3163-3263, kit-1016): drawn on the one selected node, a handle's press, the
// resize's values and its release. Each declaration is the page's own, with types added; the page's
// load-time statements run, in its order, from initResize(). No DOM at import.
//
// With exactly one node selected, editing allowed (760 px and over), the node drawn with a box, and
// no drag, resize, rectangle or path under way: 8 × 8 px handles (stage chrome) centred on its drawn
// box's corners and edge middles, in stage px. A node placed by x, y gets all eight; one in an
// auto-layout frame e, s and se only (the layout places its left and top edges). Drawn again after
// every redraw, selection change, view change, window resize and image load.
import { $, live, own, state, type Json } from '../core/page';
import { clamp, finite } from '../core/checkers';
import { getPath, nodeOf } from '../core/nodes';
import { placedByXY, ready } from '../panels';
import * as panels from '../panels';
import { edit, editable } from '../sync';
import { placeOthers } from '../presence';
import { shared } from './held';
import { moveBy } from './move';

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const hasBox = (id: Json): boolean => live.drawn.has(id) && live.drawn.get(id)!.getClientRects().length > 0;
export function drawHandles(): void {
  for (const h of $('stage').querySelectorAll('.handle')) h.remove();
  const id = state.sel;
  if (id === null || !ready() || !editable() || shared.gesture !== null || shared.pen !== null) return;
  const n = nodeOf(id);
  if (!n || !hasBox(id)) return;
  const st = $('stage').getBoundingClientRect();
  const r = live.drawn.get(id)!.getBoundingClientRect();
  const xs = { w: r.left - st.left, m: (r.left + r.right) / 2 - st.left, e: r.right - st.left };
  const ys = { n: r.top - st.top, m: (r.top + r.bottom) / 2 - st.top, s: r.bottom - st.top };
  for (const name of placedByXY(n) ? HANDLES : ['e', 's', 'se']) {
    const el = document.createElement('div');
    el.className = 'handle';
    el.dataset.handle = name;
    el.setAttribute('aria-hidden', 'true');
    el.style.left = `${xs[name.includes('w') ? 'w' : name.includes('e') ? 'e' : 'm']}px`;
    el.style.top = `${ys[name.includes('n') ? 'n' : name.includes('s') ? 's' : 'm']}px`;
    $('stage').append(el);
  }
}
// A press on a handle: the resize of the one selected node, followed as kit-668's drag (gesture fields
// as pressMove's). start: the stored x, y, size.w, size.h where they are numbers, else as drawn (in
// the parent's page px, whole px; hug, fill and a token become fixed); loose: placed by x, y (its left
// and top handles move x, y too).
export function pressResize(e: PointerEvent, handle: Json): void {
  const id = state.sel;
  shared.toolPress = true; // the click that ends it is the resize's, never a selection
  if (id === null || !HANDLES.includes(handle) || !nodeOf(id) || !hasBox(id)) return;
  const n = nodeOf(id);
  const z = panels.shared.view.z;
  const s = $('surface').getBoundingClientRect();
  const r = live.drawn.get(id)!.getBoundingClientRect();
  const pel = live.drawn.get(n.parent);
  const o = (pel ?? $('surface')).getBoundingClientRect();
  const stored = (path: string, drawnPx: number): number => {
    const v = getPath(n, path);
    return finite(v) ? v : Math.round(drawnPx);
  };
  const start = {
    x: stored('x', (r.left - o.left) / z), y: stored('y', (r.top - o.top) / z),
    w: stored('size.w', r.width / z), h: stored('size.h', r.height / z),
  };
  const loose = placedByXY(n);
  if (!loose && !['e', 's', 'se'].includes(handle)) return;
  shared.gesture = {
    id: e.pointerId, tool: 'resize', sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, dragged: false, draft: null,
    handle, node: id, loose, px: (e.clientX - s.left) / z, py: (e.clientY - s.top) / z,
    live: true, start, sent: { ...start }, lastAt: null, timer: null, liveSent: false, items: [], snapshot: null, restored: false,
  };
  try { $('stage').setPointerCapture(e.pointerId); } catch { /* moves over the stage still arrive */ }
}
// The resize's values now, only those its handle moves: e and w move size.w (w, loose only, x too,
// so the right edge stays), s and n size.h (n: y); whole px, sizes 1..100000, x, y within ±100000.
export function resizeTarget(g: Json): Json {
  const { dx, dy } = moveBy(g);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  const to: Json = {};
  const h = g.handle;
  if (h.includes('e')) to.w = clamp(Math.round(g.start.w + dx), 1, panels.shared.PX);
  if (h.includes('w') && g.loose) {
    to.w = clamp(Math.round(g.start.w - dx), 1, panels.shared.PX);
    to.x = clamp(Math.round(g.start.x + (g.start.w - to.w)), -panels.shared.PX, panels.shared.PX);
  }
  if (h.includes('s')) to.h = clamp(Math.round(g.start.h + dy), 1, panels.shared.PX);
  if (h.includes('n') && g.loose) {
    to.h = clamp(Math.round(g.start.h - dy), 1, panels.shared.PX);
    to.y = clamp(Math.round(g.start.y + (g.start.h - to.h)), -panels.shared.PX, panels.shared.PX);
  }
  return to;
}
export const RESIZE_PROP: Record<string, string> = { w: 'size.w', h: 'size.h', x: 'x', y: 'y' };
// The sets of what `to` holds that differs from what the resize last sent.
export function resizeOps(g: Json, to: Json): Json[] {
  const ops: Json[] = [];
  for (const k of ['w', 'h', 'x', 'y']) if (own(to, k) && to[k] !== g.sent[k]) ops.push({ op: 'set', id: g.node, prop: RESIZE_PROP[k], value: to[k] });
  return ops;
}
// The release: one edit of the sets that differ from the last live edit, held by the sender until
// 100 ms after it (notBefore), never coalesced.
export function dropResize(g: Json): void {
  if (!g.dragged || !editable() || !nodeOf(g.node)) return;
  const to = resizeTarget(g);
  if (to === null) return;
  const ops = resizeOps(g, to);
  if (ops.length === 0) return;
  const item = edit(ops, { kind: 'release', notBefore: g.liveSent ? g.lastAt + 100 : 0 });
  if (!item) return;
  g.sent = { ...g.sent, ...to };
  g.items.push(item);
}

// The page's load-time statements of these lines, in its order.
export function initResize(): void {
  // an image loaded later (load doesn't bubble: caught on the way down) moves the box
  $('surface').addEventListener('load', () => { drawHandles(); placeOthers(); }, true);
  $('surface').addEventListener('error', () => { drawHandles(); placeOthers(); }, true);
}
