// Zoom and pan (canvas.html 1305-1527, kit-1014). Each declaration is the page's own, with types added;
// `view`, `pan` and `spaceHeld` are on `shared` and `moved`, `panned` on `held` (./held). The page's
// load-time statements run, in its order, from initZoom(). No DOM at import.
import { $, renderPages, state } from '../core/page';
import { narrow } from '../sync';
import { drawHandles, setTool } from '../editing';
import * as editing from '../editing';
import { drawPen } from '../history';
import { placeOthers } from '../presence';
import { held, shared } from './held';
import { renderProps } from './layers';

/** Content bounds in page px. */
export type Bounds = { l: number; t: number; r: number; b: number };
/** A pinch under way: its two pointers, their distance and the zoom then, and the page point under its centre. */
export type Pinch = { ia: number; ib: number; d: number; z: number; px: number; py: number };
/** A point in client px. */
export type Pt = { x: number; y: number };

// The view: #surface moved by translate(x, y) scale(z), origin top-left, x and y in stage px.
export const ZMIN = 0.1;
export const ZMAX = 8;
export const STEP = 1.25;

export function applyView(): void {
  $('surface').style.transform = `translate(${shared.view.x}px, ${shared.view.y}px) scale(${shared.view.z})`;
  $('zoomPct').textContent = `${Math.round(shared.view.z * 100)}%`;
  drawPen(); // a path being drawn follows the view
  drawHandles(); // and the resize handles
  placeOthers(); // and others' cursors (kit-663)
}
// Zoom by `factor` around the stage point (sx, sy), which stays put; z kept to [0.1, 8], so at a
// bound the view doesn't change at all.
export function zoomTo(target: number, sx: number, sy: number): void {
  if (!Number.isFinite(target) || target <= 0) return;
  const z = Math.min(ZMAX, Math.max(ZMIN, target));
  if (z === shared.view.z) return;
  const k = z / shared.view.z;
  shared.view.x = sx - (sx - shared.view.x) * k;
  shared.view.y = sy - (sy - shared.view.y) * k;
  shared.view.z = z;
  held.moved = true;
  applyView();
}
export const zoomAt = (factor: number, sx: number, sy: number): void => zoomTo(shared.view.z * factor, sx, sy);
export const stageSize = (): { w: number; h: number } => ({ w: $('stage').clientWidth, h: $('stage').clientHeight });
export const zoomCentre = (z: number): void => { const s = stageSize(); zoomTo(z, s.w / 2, s.h / 2); };
// The shown page's content bounds in page px: the union of its top-level nodes' rectangles plus
// 200 px around (contract §9), or null on a page with nothing shown.
export function contentBounds(): Bounds | null {
  const surface = $('surface');
  const o = surface.getBoundingClientRect();
  let b: Bounds | null = null;
  for (const el of surface.children as HTMLCollectionOf<HTMLElement>) {
    if (!el.dataset.id || el.getClientRects().length === 0) continue;
    const r = el.getBoundingClientRect();
    const l = (r.left - o.left) / shared.view.z;
    const t = (r.top - o.top) / shared.view.z;
    const rr = l + r.width / shared.view.z;
    const bb = t + r.height / shared.view.z;
    b = b === null ? { l, t, r: rr, b: bb } : { l: Math.min(b.l, l), t: Math.min(b.t, t), r: Math.max(b.r, rr), b: Math.max(b.b, bb) };
  }
  return b && { l: b.l - 200, t: b.t - 200, r: b.r + 200, b: b.b + 200 };
}
// Fit: the content bounds fill the stage, at most 100%, centred.
export function fit(): void {
  const b = contentBounds();
  const s = stageSize();
  if (!b || s.w <= 0 || s.h <= 0) {
    Object.assign(shared.view, { x: 0, y: 0, z: 1 });
  } else {
    const z = Math.min(1, Math.max(ZMIN, Math.min(s.w / (b.r - b.l), s.h / (b.b - b.t))));
    Object.assign(shared.view, { z, x: (s.w - (b.r - b.l) * z) / 2 - b.l * z, y: (s.h - (b.b - b.t) * z) / 2 - b.t * z });
  }
  held.moved = false;
  applyView();
}
export const ready = (): boolean => state.doc !== null && document.body.dataset.state !== 'error';

// a resized window (a phone turned, a panel shown or hidden at 760 px) refits, unless the person has moved
export let wasNarrow: boolean | null = null;

// Dragging with the middle button, or with Space held, pans; the stage keeps the pointer meanwhile.
// By touch (or a pen), one finger dragging pans and two pinch to zoom about their centre; a touch
// that doesn't move (a tap) stays a click, so it selects or clears as one does.
export const TAP_SLOP = 6; // px a touch may wander and still be a tap
export const touches = new Map<number, Pt>(); // pointerId -> { x, y } of each touch or pen pointer down on the stage
export let pinch: Pinch | null = null;
export const isTouch = (e: PointerEvent): boolean => e.pointerType === 'touch' || e.pointerType === 'pen';
export const stagePoint = (pt: Pt): Pt => { const r = $('stage').getBoundingClientRect(); return { x: pt.x - r.left, y: pt.y - r.top }; };
// (Re)start the touch gesture from the pointers now down: one pans, two pinch.
export function startTouch(): void {
  const pts = [...touches.entries()];
  shared.pan = null;
  pinch = null;
  if (pts.length === 1) {
    const [id, at] = pts[0];
    shared.pan = { id, cx: at.x, cy: at.y, x: shared.view.x, y: shared.view.y, touch: true };
  } else if (pts.length >= 2) {
    const [[ia, a], [ib, b]] = pts;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const mid = stagePoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    // the page point under the pinch centre, which follows the centre as the fingers move
    if (d > 0) pinch = { ia, ib, d, z: shared.view.z, px: (mid.x - shared.view.x) / shared.view.z, py: (mid.y - shared.view.y) / shared.view.z };
  }
}
export const endPan = (e: PointerEvent): void => {
  if (touches.has(e.pointerId)) {
    touches.delete(e.pointerId);
    startTouch(); // a finger lifted from a pinch: the other one pans on from where it is
    return;
  }
  if (!shared.pan || e.pointerId !== shared.pan.id) return;
  shared.pan = null;
  $('stage').classList.remove('panning');
};

// Keys: +/= zoom in, - zoom out, 0 sets 100%, Shift+1 fits (by its code, so any layout's Shift+1);
// Space held, with the pointer over the stage, makes a drag pan. None of them while typing in a
// field, and Space is left to a focused button or link (it presses it).
export const typing = (t: EventTarget | null): boolean => t instanceof Element && (t.closest('input, select, textarea') !== null || (t instanceof HTMLElement && t.isContentEditable));
export const pressable = (t: EventTarget | null): boolean => t instanceof Element && t.closest('button, a, summary, [role="button"], [role="link"]') !== null;
export let overStage = false;
export const spaceUp = (): void => { shared.spaceHeld = false; $('stage').classList.remove('space'); };

// The page's load-time statements of these lines (1372-1526), in its order: run once by the section's
// init(), from mount().
export function initZoom(): void {
  $('zoomIn').addEventListener('click', () => { if (ready()) zoomCentre(shared.view.z * STEP); });
  $('zoomOut').addEventListener('click', () => { if (ready()) zoomCentre(shared.view.z / STEP); });
  $('zoomFit').addEventListener('click', () => { if (ready()) fit(); });
  window.addEventListener('resize', () => {
    if (narrow() && (editing.shared.tool !== 'move' || editing.shared.gesture !== null || editing.shared.pen !== null)) setTool('move'); // under 760 px, watch only
    // across 760 px the panel's fields are built again, usable or not
    if (narrow() !== wasNarrow) { wasNarrow = narrow(); if (ready()) { renderProps(); renderPages(); } }
    if (ready() && !held.moved) fit();
    drawHandles(); // shown only at 760 px and over, and on the box where the resize left it
  });

  // The wheel pans; with Ctrl or ⌘ (a trackpad's pinch comes as Ctrl+wheel) it zooms around the pointer.
  $('stage').addEventListener('wheel', (e) => {
    if (!ready()) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stageSize().h : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) {
      const r = $('stage').getBoundingClientRect();
      zoomAt(Math.exp(-dy / 300), e.clientX - r.left, e.clientY - r.top);
      return;
    }
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    shared.view.x -= dx;
    shared.view.y -= dy;
    held.moved = true;
    applyView();
  }, { passive: false });

  $('stage').addEventListener('pointerdown', (e) => {
    if (touches.size === 0) held.panned = false;
    if (!ready() || !(e.target instanceof Element) || e.target.closest('.zoom, .stage-top, #tools')) return;
    if (isTouch(e)) {
      if (e.button !== 0 || (shared.pan && !shared.pan.touch)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { $('stage').setPointerCapture(e.pointerId); } catch { /* moves over the stage still arrive */ }
      if (touches.size > 1) held.panned = true; // a second finger makes it a pinch, never a tap
      startTouch();
      return;
    }
    if (shared.pan) return;
    if (!(e.button === 1 || (e.button === 0 && shared.spaceHeld))) return;
    e.preventDefault();
    shared.pan = { id: e.pointerId, cx: e.clientX, cy: e.clientY, x: shared.view.x, y: shared.view.y };
    held.panned = true;
    try { $('stage').setPointerCapture(e.pointerId); } catch { /* the pan still follows moves over the stage */ }
    $('stage').classList.add('panning');
  });
  $('stage').addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch) {
        const a = touches.get(pinch.ia);
        const b = touches.get(pinch.ib);
        if (!a || !b) return;
        const z = Math.min(ZMAX, Math.max(ZMIN, pinch.z * (Math.hypot(b.x - a.x, b.y - a.y) / pinch.d)));
        const mid = stagePoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        if (!Number.isFinite(z)) return;
        shared.view.z = z;
        shared.view.x = mid.x - pinch.px * z;
        shared.view.y = mid.y - pinch.py * z;
        held.moved = true;
        applyView();
        return;
      }
      // one finger: a pan once it has gone past a tap's slop
      if (!shared.pan || e.pointerId !== shared.pan.id) return;
      const dx = e.clientX - shared.pan.cx;
      const dy = e.clientY - shared.pan.cy;
      if (!held.panned && Math.hypot(dx, dy) < TAP_SLOP) return;
      held.panned = true;
      shared.view.x = shared.pan.x + dx;
      shared.view.y = shared.pan.y + dy;
      held.moved = true;
      applyView();
      return;
    }
    if (!shared.pan || e.pointerId !== shared.pan.id) return;
    shared.view.x = shared.pan.x + e.clientX - shared.pan.cx;
    shared.view.y = shared.pan.y + e.clientY - shared.pan.cy;
    held.moved = true;
    applyView();
  });
  $('stage').addEventListener('pointerup', endPan);
  $('stage').addEventListener('pointercancel', endPan);
  // no middle-button autoscroll or paste on the stage
  $('stage').addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  $('stage').addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

  document.addEventListener('pointerover', (e) => { overStage = e.target instanceof Element && e.target.closest('#stage') !== null; });
  document.documentElement.addEventListener('pointerleave', () => { overStage = false; });
  document.addEventListener('keydown', (e) => {
    if (!ready() || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space' || e.key === ' ') {
      if (!overStage || pressable(e.target)) return;
      e.preventDefault(); // nothing scrolled
      shared.spaceHeld = true;
      $('stage').classList.add('space');
      return;
    }
    if (e.code === 'Digit1' && e.shiftKey) { e.preventDefault(); fit(); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomCentre(shared.view.z * STEP); return; }
    if (e.key === '-') { e.preventDefault(); zoomCentre(shared.view.z / STEP); return; }
    if (e.key === '0') { e.preventDefault(); zoomCentre(1); }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (shared.spaceHeld && !typing(e.target)) e.preventDefault();
    spaceUp();
  });
  window.addEventListener('blur', spaceUp);
}
