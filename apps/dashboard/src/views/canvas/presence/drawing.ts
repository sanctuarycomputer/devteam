// ---- drawing others (canvas.html 4989-5092, kit-1018) ----
// Each declaration is the page's own, with types added; the page's one load-time statement here (its
// window resize listener) runs from initDrawing(). No DOM at import.
import { $, live, state, type Json } from '../core/page';
import { ready } from '../panels';
import * as panels from '../panels';
import { boxLayer, colourOf, cursorBounds, cursorLayer, pres, type Cursor } from './cursors';
import { BOXES_MAX } from './selections';
import { shared } from './held';
import { placePins } from './pins';

// An anchor's point on screen: a drawn node's box at the fraction, or the shown page's content bounds
// at the fraction through the view; null when it can't be drawn here (another page, a node not drawn).
export function anchorPoint(k: string, x: number, y: number): { x: number; y: number } | null {
  if (k.startsWith('@')) {
    if (k.slice(1) !== state.pageId) return null;
    const o = $('surface').getBoundingClientRect();
    const b = cursorBounds();
    return { x: o.left + (b.l + x * (b.r - b.l)) * panels.shared.view.z, y: o.top + (b.t + y * (b.b - b.t)) * panels.shared.view.z };
  }
  const el = live.drawn.get(k);
  if (!el || el.getClientRects().length === 0) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + x * r.width, y: r.top + y * r.height };
}
export const SVG = 'http://www.w3.org/2000/svg';
export function cursorEl(conn: string, c: Cursor): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'cursor';
  el.dataset.conn = conn;
  el.dataset.person = c.id;
  el.style.setProperty('--who', colourOf(c.id));
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '18');
  svg.setAttribute('viewBox', '0 0 16 18');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M0 0L14 7.5L7.5 9.5L4.5 16Z');
  path.setAttribute('fill', colourOf(c.id));
  path.setAttribute('stroke', '#fff');
  path.setAttribute('stroke-width', '1.2');
  svg.append(path);
  const name = document.createElement('span');
  name.className = 'cursor-name';
  name.textContent = c.name;
  el.append(svg, name);
  return el;
}
// A box around a drawn node of the shown page (grown by `grow` px), in stage px, or null.
export function boxEl(cls: string, person: string, id: string, st: DOMRect, grow: number): HTMLDivElement | null {
  const el = live.drawn.get(id);
  if (!el || el.getClientRects().length === 0) return null;
  const r = el.getBoundingClientRect();
  const b = document.createElement('div');
  b.className = cls;
  b.dataset.person = person;
  b.dataset.node = id;
  b.style.setProperty('--who', colourOf(person));
  b.style.transform = `translate(${r.left - grow - st.left}px, ${r.top - grow - st.top}px)`;
  b.style.width = `${r.width + 2 * grow}px`;
  b.style.height = `${r.height + 2 * grow}px`;
  return b;
}
// The first box of a person carries their name.
export function tagged(box: HTMLElement, name: string): void {
  const t = document.createElement('span');
  t.className = 'tag';
  t.textContent = name;
  box.append(t);
}
// Others' selection boxes and the last edit's mark, rebuilt from the drawn nodes; at most 1000 boxes
// in all, the mark's first so selections never crowd it out (task-3 T3-4).
export function placeBoxes(st: DOMRect = $('stage').getBoundingClientRect()): void {
  const els: HTMLDivElement[] = [];
  if (ready()) {
    const add = (cls: string, person: string, name: string, ids: Json[], grow: number): void => {
      let first = true;
      for (const id of ids) {
        if (els.length >= BOXES_MAX) return;
        const b = boxEl(cls, person, id, st, grow);
        if (!b) continue;
        if (first) { tagged(b, name); first = false; }
        els.push(b);
      }
    };
    if (shared.seen.mark !== null) add('flash', shared.seen.mark.person, shared.seen.mark.name, shared.seen.mark.ids, 0);
    for (const p of shared.seen.sels) add('others-sel', p.id, p.name, p.ids, 2);
  }
  boxLayer.replaceChildren(...els);
}
// Every other person's cursor placed again from its anchor. Cursors are rebuilt whole: there are few,
// and a name or person never goes stale. A move or people frame redraws only these (task-3 T3-5).
export function placeCursors(st: DOMRect = $('stage').getBoundingClientRect()): void {
  const els: HTMLDivElement[] = [];
  for (const [conn, c] of pres.cursors) {
    const el = cursorEl(conn, c);
    el.dataset.k = c.k;
    const pt = ready() ? anchorPoint(c.k, c.x, c.y) : null;
    if (pt === null) el.hidden = true;
    else el.style.transform = `translate(${pt.x - st.left}px, ${pt.y - st.top}px)`;
    els.push(el);
  }
  cursorLayer.replaceChildren(...els);
}
// Both, after every redraw, zoom, pan, resize and late image load, and when selections or the mark change.
export function placeOthers(): void {
  const st = $('stage').getBoundingClientRect();
  placeBoxes(st);
  placeCursors(st);
  try { placePins(st); } catch { /* a pin never stops cursors and boxes being placed */ }
}

// The page's load-time line of this part (5091). mount() runs it once.
export function initDrawing(): void {
  window.addEventListener('resize', () => placeOthers());
}
