// The pen (canvas.html 4401-4451, kit-1017): a click per point; Enter or a double-click ends the path, Escape drops it.
// Each declaration is the page's own, with types added; the page's load-time statements run, in its
// order, from initPen(). No DOM at import.
import { SVG_NS } from '../core/nodes';
import { $, type Json } from '../core/page';
import { addNode, drawHandles, placeAt, setTool, toolsOn } from '../editing';
import * as panels from '../panels';
import * as editing from '../editing';

// ---- the pen: a click per point; Enter or a double-click ends the path, Escape drops it ----
export function penPoint(cx: Json, cy: Json) {
  const s = $('surface').getBoundingClientRect();
  const pt = [(cx - s.left) / panels.shared.view.z, (cy - s.top) / panels.shared.view.z];
  if (editing.shared.pen === null) { editing.shared.pen = { pts: [], el: null, line: null }; drawHandles(); }
  const last = editing.shared.pen.pts[editing.shared.pen.pts.length - 1];
  // a double-click's second press, or a click on the last point, adds none
  if (last && Math.hypot(pt[0] - last[0], pt[1] - last[1]) * panels.shared.view.z < 2) return;
  editing.shared.pen.pts.push(pt);
  drawPen(cx, cy);
}
// The path's preview (stage chrome), in stage px, to the pointer when given.
export function drawPen(cx: number | null = null, cy: number | null = null): void {
  if (editing.shared.pen === null) return;
  if (editing.shared.pen.el === null) {
    editing.shared.pen.el = document.createElementNS(SVG_NS, 'svg');
    editing.shared.pen.el.classList.add('pen');
    editing.shared.pen.el.setAttribute('aria-hidden', 'true');
    editing.shared.pen.line = document.createElementNS(SVG_NS, 'polyline');
    editing.shared.pen.el.append(editing.shared.pen.line);
    $('stage').append(editing.shared.pen.el);
  }
  const st = $('stage').getBoundingClientRect();
  const s = $('surface').getBoundingClientRect();
  const pts = editing.shared.pen.pts.map(([x, y]: Json) => [s.left - st.left + x * panels.shared.view.z, s.top - st.top + y * panels.shared.view.z]);
  if (cx !== null && cy !== null) pts.push([cx - st.left, cy - st.top]);
  editing.shared.pen.line.setAttribute('points', pts.map(([x, y]: Json) => `${x},${y}`).join(' '));
}
export function dropPen() {
  if (editing.shared.pen !== null && editing.shared.pen.el !== null) editing.shared.pen.el.remove();
  const had = editing.shared.pen !== null;
  editing.shared.pen = null;
  if (had) drawHandles();
}
// The path made a vector: placed by its first point; x, y its points' top-left (whole px), the path
// `M x y L x y …` from there, numbers to 0.1; at least two points, else nothing.
export function finishPen() {
  const pts = editing.shared.pen === null ? [] : editing.shared.pen.pts;
  dropPen();
  if (pts.length < 2 || !toolsOn()) { setTool('move'); return; }
  const s = $('surface').getBoundingClientRect();
  const at = placeAt(s.left + pts[0][0] * panels.shared.view.z, s.top + pts[0][1] * panels.shared.view.z);
  const lp = pts.map(([x, y]: Json) => [x - pts[0][0] + at.x, y - pts[0][1] + at.y]);
  const x0 = Math.round(Math.min(...lp.map(([x]: Json) => x)));
  const y0 = Math.round(Math.min(...lp.map(([, y]: Json) => y)));
  const r = (v: Json) => String(Math.round(v * 10) / 10 || 0);
  const path = lp.map(([x, y]: Json, i: Json) => `${i ? 'L' : 'M'} ${r(x - x0)} ${r(y - y0)}`).join(' ');
  addNode('vector', { ...at, x: x0, y: y0 }, { path, size: { w: 'hug', h: 'hug' }, stroke: '#000000', strokeWidth: 1 });
}
export function initPen(): void {
  $('stage').addEventListener('dblclick', () => { if (editing.shared.pen !== null && editing.shared.tool === 'vector') finishPen(); });
}
