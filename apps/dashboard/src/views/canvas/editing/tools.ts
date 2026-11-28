// The tools (canvas.html 2798-3077, kit-1016): Move, Frame, Text, Rectangle, Ellipse, Image and Vector,
// where a made node goes (placeAt), the stage's press, move and release, and what a press made. Each
// declaration is the page's own, with types added; the page's load-time statements run, in its order,
// from initTools(). No DOM at import.
//
// Move (the default) selects; Frame, Text, Rectangle, Ellipse and Image make a node by a click or a
// drag on the stage, Vector by a click per point. Each made node is one `add` edit, placed by
// placeAt; the new node is selected and the tool goes back to Move. Space or the middle button pans
// in every tool (the pan's own handlers run first and the tools leave such a press alone).
import { $, live, own, pageById, state, type Json } from '../core/page';
import { MODE, clamp, pick } from '../core/checkers';
import { CONTAINERS, MAX_ELEMENTS, getPath, kidsOf, nodeOf } from '../core/nodes';
import { isTouch, ready, select, toggleSel, typing } from '../panels';
import * as panels from '../panels';
import { edit, editable, narrow, newId } from '../sync';
import { dragEntry, drawPen, dropPen, finishPen, penPoint } from '../history';
import { shared } from './held';
import { placeInstance } from './components';
import { drawHandles, dropResize, hasBox, pressResize } from './resize';
import { dropMove, liveSend, marqueeSelect, movePreview, pressMove, restore } from './move';

// `instance` has no button: Place instance (§3) picks it, the component in state.placing
export const TOOLS = ['move', 'frame', 'text', 'rect', 'ellipse', 'vector', 'image', 'instance'];
export const TOOL_KEY: Record<string, string> = { v: 'move', f: 'frame', t: 'text', r: 'rect', o: 'ellipse', p: 'vector', i: 'image' };
export const NEW_NAME: Record<string, string> = { frame: 'Frame', text: 'Text', rect: 'Rectangle', ellipse: 'Ellipse', vector: 'Vector', image: 'Image' };
// (IMAGE_SAY, IMAGE_BYTES, tool, gesture, toolPress, pen and placing are on `shared`, held.ts)
export const DRAG_SLOP = 3; // px a press may move and still be a click
export const toolsOn = (): boolean => ready() && editable() && !narrow();

export function setTool(name: Json): void {
  if (!TOOLS.includes(name)) return;
  endGesture(shared.gesture, { abort: true }); // Escape, a lock, a narrow screen: a drag dropped, not dropped in
  dropPen() as void; // dropPen is canvas-history's stub (typed never) until kit-1017: `as void` keeps the lines after it typed
  shared.tool = name;
  if (name !== 'instance') state.placing = null;
  for (const b of $('tools').querySelectorAll<HTMLElement>('button[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === shared.tool));
  $('stage').classList.toggle('drawing', shared.tool !== 'move');
}

// Is `id` the node `root` or inside its subtree (walked up, bounded)?
export function inSubtree(id: Json, root: Json): boolean {
  let cur = id;
  for (let steps = 0; steps <= MAX_ELEMENTS && nodeOf(cur); steps++) {
    if (cur === root) return true;
    cur = nodeOf(cur).parent;
  }
  return false;
}
export const inComponent = (id: Json): boolean => {
  let cur = id;
  for (let steps = 0; steps <= MAX_ELEMENTS && nodeOf(cur); steps++) {
    if (nodeOf(cur).type === 'component') return true;
    cur = nodeOf(cur).parent;
  }
  return false;
};
// Where a new (or moved) node goes for a pointer at (cx, cy): the deepest frame or component drawn
// under it (an instance's inner nodes are its component's, not the page's: they carry no data-id),
// skipping `exclude`'s subtree and, for a component (`component: true`), any component or anything
// in one; else the shown page. { parent, after, x, y, free }: x, y the pointer in the parent's page
// px; free when the parent places by x, y (a `none` frame or the page), after then its last child
// (on top); in a row, column or grid, after the last child whose middle along the axis (a grid or a
// wrapped row or column: by reading order) is before the pointer, null for first.
export function placeAt(cx: number, cy: number, exclude: Json = null, { component = false }: { component?: boolean } = {}): Json {
  let parent: Json = null;
  let pel: HTMLElement | null = null;
  for (const el of document.elementsFromPoint(cx, cy)) {
    if (!(el instanceof HTMLElement) || !$('surface').contains(el) || el.dataset.id === undefined) continue;
    const id = el.dataset.id;
    const n = nodeOf(id);
    if (!n || !CONTAINERS.has(n.type) || live.drawn.get(id) !== el) continue;
    if (exclude !== null && inSubtree(id, exclude)) continue;
    if (component && inComponent(id)) continue;
    parent = id;
    pel = el;
    break;
  }
  const z = panels.shared.view.z;
  const o = (pel ?? $('surface')).getBoundingClientRect();
  const x = (cx - o.left) / z;
  const y = (cy - o.top) / z;
  const pid = parent ?? state.pageId;
  const pn = parent === null ? null : nodeOf(parent);
  const kids = (pn ? kidsOf(pn) : kidsOf(pageById(pid) || { children: [] })).filter((k) => k !== exclude);
  const mode = pn ? pick(MODE, getPath(pn, 'layout.mode'), 'none') : 'none';
  if (mode === 'none') return { parent: pid, after: kids.length ? kids[kids.length - 1] : null, x, y, free: true };
  const wrap = getPath(pn, 'layout.wrap') === true;
  let after: Json = null;
  for (const k of kids) {
    const el = live.drawn.get(k);
    if (!el || el.getClientRects().length === 0) continue;
    const r = el.getBoundingClientRect();
    const mx = (r.left + r.right) / 2;
    const my = (r.top + r.bottom) / 2;
    let before;
    if (mode === 'row' && !wrap) before = mx < cx;
    else if (mode === 'column' && !wrap) before = my < cy;
    else if (mode === 'column') before = r.right <= cx || (r.left <= cx && my < cy);
    else before = r.bottom <= cy || (r.top <= cy && mx < cx);
    if (before) after = k;
  }
  return { parent: pid, after, x, y, free: false };
}

// A new node of `type` at a placement, with its own properties: one add edit; then selected, and the
// tool back to Move. The new node's id is new (newId). True when it was queued.
export function addNode(type: string, at: Json, props: Json): boolean {
  const id = newId();
  const node: Json = { id, type, parent: at.parent, name: NEW_NAME[type] };
  if (at.free) { node.x = Math.round(at.x); node.y = Math.round(at.y); }
  Object.assign(node, props);
  setTool('move');
  if (!edit([{ op: 'add', node, after: at.after }])) return false;
  select(id);
  return true;
}
export const fixedSize = (w: number, h: number): { w: number; h: number } => ({ w: Math.round(clamp(w, 1, panels.shared.PX)), h: Math.round(clamp(h, 1, panels.shared.PX)) });
// Is (cx, cy) inside the one selected node's drawn box, that box under 16 px on a side?
export function insideSmall(cx: number, cy: number): boolean {
  const id = state.sel;
  if (id === null || !hasBox(id)) return false;
  const r = live.drawn.get(id)!.getBoundingClientRect();
  return (r.width < 16 || r.height < 16) && cx > r.left && cx < r.right && cy > r.top && cy < r.bottom;
}
// A gesture ended: its pointer released, its draft and preview gone, a drag's throttle timer cleared.
// An abort (Escape, a lost pointer, a lock) of a Move drag after live edits went sends it back (restore).
export function endGesture(g: Json = shared.gesture, { abort = false }: { abort?: boolean } = {}): void {
  if (!g || g !== shared.gesture) return;
  try { $('stage').releasePointerCapture(g.id); } catch { /* already released */ }
  if (g.draft) g.draft.remove();
  if (g.el) g.el.style.translate = '';
  if (g.nodes) for (const m of g.nodes) if (m.el) m.el.style.translate = '';
  if (g.timer) { clearTimeout(g.timer); g.timer = null; }
  shared.gesture = null;
  if (abort && (g.tool === 'move' || g.tool === 'resize')) restore(g);
  drawHandles();
}

// What a press made: placed by where it was pressed; a drag's box (frame, rectangle, ellipse, image)
// gives its top-left and its size, in page px.
export function make(g: Json): void {
  if (g.tool === 'move') { if (dropMove(g) === 'refused') restore(g); return; }
  if (g.tool === 'resize') { dropResize(g); return; }
  if (g.tool === 'marquee') { if (g.dragged) marqueeSelect(g); return; }
  const at = placeAt(g.sx, g.sy);
  const z = panels.shared.view.z;
  const box = g.dragged && g.tool !== 'text'
    ? { at: { ...at, x: at.x + (Math.min(g.sx, g.cx) - g.sx) / z, y: at.y + (Math.min(g.sy, g.cy) - g.sy) / z }, w: Math.abs(g.cx - g.sx) / z, h: Math.abs(g.cy - g.sy) / z }
    : null;
  const where = box ? box.at : at;
  switch (g.tool) {
    case 'frame':
      addNode('frame', where, { size: box ? fixedSize(box.w, box.h) : { w: 200, h: 120 }, layout: { mode: 'none' }, fill: '#ffffff' });
      return;
    case 'rect':
    case 'ellipse':
      addNode(g.tool, where, { size: box ? fixedSize(box.w, box.h) : { w: 100, h: 100 }, fill: '#d9d9d9' });
      return;
    case 'text':
      if (addNode('text', where, { size: { w: 'hug', h: 'hug' }, text: 'Text' })) {
        // its Text field focused, its text selected, so typing replaces it
        const f = $('props').querySelector('[data-prop="text"]');
        if (f instanceof HTMLTextAreaElement && !f.disabled) { f.focus({ preventScroll: true }); f.select(); }
      }
      return;
    case 'image':
      // the picker; the chosen file is posted, and the image added where this press was
      shared.placing = { at: where, size: box ? fixedSize(box.w, box.h) : { w: 'hug', h: 'hug' } };
      setTool('move');
      $<HTMLInputElement>('imageFile').value = '';
      $('imageFile').click();
      return;
    case 'instance': {
      // Place instance: an instance of the component, placed where this press was
      const comp = state.placing;
      setTool('move');
      placeInstance(comp, at);
      return;
    }
    default:
  }
}

// The page's load-time statements of these lines, in its order.
export function initTools(): void {
  $('tools').addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('button[data-tool]') : null;
    if (b && !b.disabled && editable()) setTool(b.dataset.tool);
  });
  // The tool keys, only while no field has focus, at 760 px and over, and while editing is allowed.
  // Enter ends a path.
  document.addEventListener('keydown', (e) => {
    if (!toolsOn() || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter' && shared.pen !== null) { e.preventDefault(); finishPen(); return; }
    const k = typeof e.key === 'string' && e.key.length === 1 ? e.key.toLowerCase() : '';
    if (own(TOOL_KEY, k)) { e.preventDefault(); setTool(TOOL_KEY[k]); }
  });
  // A press by a creating tool: followed with the pointer captured, so a release outside the stage
  // still ends it; past 3 px it is a drag, previewed by a dashed draft. A press with Space held, by the
  // middle button or by touch is the pan's.
  $('stage').addEventListener('pointerdown', (e) => {
    shared.toolPress = false;
    if (!toolsOn() || isTouch(e) || e.button !== 0 || panels.shared.spaceHeld || panels.shared.pan || shared.gesture) return;
    if (!(e.target instanceof Element) || e.target.closest('.zoom, .stage-top, #tools')) return;
    const h = e.target.closest<HTMLElement>('.handle[data-handle]');
    // a handle's press resizes: never a select, a move or a rectangle; but on a node under 16 px a side
    // the handles cover it, so there a press inside its drawn box is the node's (it moves, kit-662)
    const onSmall = h !== null && insideSmall(e.clientX, e.clientY);
    if (h && !onSmall) { pressResize(e, h.dataset.handle); return; }
    if (shared.tool === 'move') {
      // the click of a press there has the stage for its target (the handle is gone by its release), so
      // the press does what that click would on the node: Shift toggles it out, else it is pressed
      if (onSmall && e.shiftKey) { toggleSel(state.sel); shared.toolPress = true; return; }
      pressMove(e, onSmall ? live.drawn.get(state.sel) : e.target.closest('#surface [data-id]'));
      if (onSmall && shared.gesture !== null) shared.toolPress = true; // its click keeps the selection
      return;
    }
    shared.toolPress = true;
    if (shared.tool === 'vector') { penPoint(e.clientX, e.clientY); return; }
    shared.gesture = { id: e.pointerId, tool: shared.tool, sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, dragged: false, draft: null };
    try { $('stage').setPointerCapture(e.pointerId); } catch { /* moves over the stage still arrive */ }
  });
  // the handles go while a press is followed (back when it ends): a release never lands on one the
  // press itself put under the pointer, so a click on a node stays that node's
  $('stage').addEventListener('pointerdown', () => { if (shared.gesture !== null) drawHandles(); });
  $('stage').addEventListener('pointermove', (e) => {
    if (shared.pen !== null && shared.tool === 'vector') drawPen(e.clientX, e.clientY);
    const g = shared.gesture;
    if (!g || e.pointerId !== g.id) return;
    g.cx = e.clientX;
    g.cy = e.clientY;
    if (!g.dragged && Math.hypot(g.cx - g.sx, g.cy - g.sy) <= DRAG_SLOP) return;
    if ((g.tool === 'move' || g.tool === 'resize') && !g.dragged) {
      // past 3 px a Move press is a drag: the pointer kept (a release outside the stage still ends
      // it), and the click that ends it isn't a selection; a resize likewise (kit-669 §3)
      try { $('stage').setPointerCapture(g.id); } catch { /* moves over the stage still arrive */ }
      shared.toolPress = true;
      g.lastAt = performance.now(); // the throttle's first live edit goes 100 ms after this
      g.snapshot = structuredClone(state.doc); // the drag's one undo entry is walked from here (§3)
    }
    if (g.tool === 'marquee' && !g.dragged) {
      // the drag rectangle: the pointer kept, and the click that ends it (or Escape's) isn't a clear
      try { $('stage').setPointerCapture(g.id); } catch { /* moves over the stage still arrive */ }
      shared.toolPress = true;
    }
    const first = !g.dragged;
    g.dragged = true;
    if (first) drawHandles(); // none while a drag, a resize or the rectangle is under way
    if (g.tool === 'resize') {
      // no preview: the drawing follows the live edits, each drawn at once
      if (g.timer === null) g.timer = setTimeout(() => liveSend(g), Math.max(0, 100 - (performance.now() - g.lastAt)));
      return;
    }
    if (g.tool === 'move') {
      if (g.live && g.timer === null) g.timer = setTimeout(() => liveSend(g), Math.max(0, 100 - (performance.now() - g.lastAt)));
      movePreview(g);
      return;
    }
    if (g.tool === 'text') return; // a text is placed where it was pressed
    if (!g.draft) {
      g.draft = document.createElement('div');
      g.draft.className = g.tool === 'ellipse' ? 'draft round' : 'draft';
      $('stage').append(g.draft);
    }
    const st = $('stage').getBoundingClientRect();
    g.draft.style.left = `${Math.min(g.sx, g.cx) - st.left}px`;
    g.draft.style.top = `${Math.min(g.sy, g.cy) - st.top}px`;
    g.draft.style.width = `${Math.abs(g.cx - g.sx)}px`;
    g.draft.style.height = `${Math.abs(g.cy - g.sy)}px`;
  });
  $('stage').addEventListener('pointerup', (e) => {
    const g = shared.gesture;
    if (!g || e.pointerId !== g.id) return;
    g.shift = e.shiftKey;
    endGesture(g);
    if (!toolsOn()) return;
    // a press on a member of several, released without a drag, selects that one alone
    if (g.tool === 'move' && !g.dragged && g.collapseTo) select(g.collapseTo);
    make(g);
    if (g.tool === 'move' || g.tool === 'resize') dragEntry(g);
  });
  $('stage').addEventListener('pointercancel', (e) => { if (shared.gesture && e.pointerId === shared.gesture.id) endGesture(shared.gesture, { abort: true }); });
}
