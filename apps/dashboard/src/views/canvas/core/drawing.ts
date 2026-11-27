// Drawing a page (canvas.html 728-1057, kit-1013). Each declaration is the page's own, with types added.
import { $, live, pageById, pages, state, type Json } from './page';
import { ALIGN, FIT, JUSTIFY, MODE, TEXT_ALIGN, color, font, imageFile, num, pathOk, pick, sizing, tracks } from './checkers';
import { CONTAINERS, INSTANCE_OWN, INSTANCE_SIZE, MAX_DEPTH, MAX_ELEMENTS, SVG_NS, getPath, kidsOf, nodeOf, resolveInstance } from './nodes';

/** An element the drawing makes for a node. */
export type Drawn = HTMLElement | SVGElement;
/** One node's values by property path. */
export type Getter = (p: string) => Json;
/** The instance whose component's tree is being drawn. */
export type Inst = { id: string; values: Map<string, Json>; key: string; depth: number };
/** One drawing of a page (see `drawing`). */
export type Drawing = {
  seen: Set<string>; after: (() => void)[]; labels: HTMLElement[]; anchors: number; byId: Map<string, Drawn>;
  marked: string[]; hidden: number; sizes: Map<string, number>; used: number; capped: boolean;
};

// One drawing of a page: the ids drawn (per instance), work to do once the tree is attached, the
// components' labels, the hidden frames now open, and the element budget: `used` counts every element
// the page's own tree and the instances drawn so far may make, worked out before each is drawn.
// (Set only while drawPage runs: every function below that reads it runs inside it.)
export let drawing: Drawing = null!;

// The most elements the tree under `ids` makes, instances counted as one each (not expanded): a
// vector is two (its path), a component two (its label), anything else one.
export function treeElements(ids: string[]): number {
  const seen = new Set<string>();
  const stack = [...ids];
  let total = 0;
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = nodeOf(id);
    if (!n) continue;
    total += n.type === 'vector' || n.type === 'component' ? 2 : 1;
    if (CONTAINERS.has(n.type)) stack.push(...kidsOf(n));
  }
  return total;
}
// What one instance of a component adds below its own element (memoised per drawing).
export function compElements(compId: string, comp: Json): number {
  if (!drawing.sizes.has(compId)) drawing.sizes.set(compId, treeElements(kidsOf(comp)));
  return drawing.sizes.get(compId)!;
}

export function mark(el: Drawn, id: string, inst: Inst | null) {
  el.classList.add('dnode');
  if (inst) { el.dataset.of = inst.id; el.dataset.src = id; } else {
    el.dataset.id = id;
    drawing.byId.set(id, el);
    drawing.marked.push(id);
  }
}

// One side's size: px, `hug` (the content's size) or `fill` (by the parent's layout).
export function size(el: Drawn, axis: string, s: 'hug' | 'fill' | number, parentMode: string) {
  const prop = axis === 'w' ? 'width' : 'height';
  const flex = parentMode === 'row' || parentMode === 'column';
  const mainAxis = flex && (parentMode === 'row') === (axis === 'w');
  if (typeof s === 'number') {
    el.style[prop] = `${s}px`;
    if (mainAxis) el.style.flexShrink = '0';
    return;
  }
  if (s === 'fill') {
    if (flex) {
      if (mainAxis) el.style.flex = '1 1 0px'; else el.style.alignSelf = 'stretch';
      return;
    }
    if (parentMode === 'none') { el.style[prop] = '100%'; return; }
    if (parentMode === 'grid') { el.style[axis === 'w' ? 'justifySelf' : 'alignSelf'] = 'stretch'; return; }
    // at a page's top level, fill acts as hug
  }
  if (flex) return;
  if (parentMode === 'grid') { el.style[axis === 'w' ? 'justifySelf' : 'alignSelf'] = 'start'; return; }
  el.style[prop] = 'max-content';
}

// What every type has: visibility, opacity, placement under a `none` parent, size.
export function common(el: Drawn, g: Getter, parentMode: string, { hugLater = false }: { hugLater?: boolean } = {}): string[] {
  const o = num(g('opacity'), 0, 1, null);
  if (o !== null && o !== 1) el.style.opacity = String(o);
  if (parentMode === 'none' || parentMode === 'page') {
    el.style.position = 'absolute';
    el.style.left = `${num(g('x'), -100000, 100000) ?? 0}px`;
    el.style.top = `${num(g('y'), -100000, 100000) ?? 0}px`;
  }
  const sides: string[] = [];
  for (const axis of ['w', 'h']) {
    const s = sizing(g(`size.${axis}`));
    if (hugLater && (s === 'hug' || (s === 'fill' && parentMode === 'page'))) {
      el.style[axis === 'w' ? 'width' : 'height'] = '0px';
      sides.push(axis);
    } else size(el, axis, s, parentMode);
  }
  return sides;
}
export function hide(el: Drawn, g: Getter) { if (g('visible') === false) el.style.display = 'none'; }

export function paint(el: Drawn, g: Getter) {
  const f = color(g('fill'));
  if (f) el.style.backgroundColor = f;
  const s = color(g('stroke'));
  const w = num(g('strokeWidth'), 0, 100000);
  if (s && w) el.style.boxShadow = `inset 0 0 0 ${w}px ${s}`;
}
export function radius(el: Drawn, g: Getter) {
  const r = num(g('radius'), 0, 100000);
  if (r) el.style.borderRadius = `${r}px`;
}

// A frame's or a component's box and layout; returns its children's layout mode.
export function layout(el: Drawn, g: Getter): string {
  const mode = pick(MODE, g('layout.mode'), 'none');
  if (mode === 'row' || mode === 'column') {
    el.style.display = 'flex';
    el.style.flexDirection = mode;
    if (g('layout.wrap') === true) el.style.flexWrap = 'wrap';
  } else if (mode === 'grid') {
    el.style.display = 'grid';
    el.style.gridTemplateColumns = tracks(g('layout.columns')) || 'auto';
    const rows = tracks(g('layout.rows'));
    if (rows) el.style.gridTemplateRows = rows;
  } else if (el.style.position !== 'absolute') el.style.position = 'relative';
  if (mode !== 'none') {
    const gap = num(g('layout.gap'), 0, 100000);
    if (gap) el.style.gap = `${gap}px`;
    el.style.alignItems = pick(ALIGN, g('layout.align'), 'start');
    el.style.justifyContent = pick(JUSTIFY, g('layout.justify'), 'start');
  }
  const pad = g('layout.padding');
  if (Array.isArray(pad) && pad.length === 4) {
    const [t, r, b, l] = pad.map((v) => num(v, 0, 100000) ?? 0);
    el.style.padding = `${t}px ${r}px ${b}px ${l}px`;
  }
  paint(el, g);
  radius(el, g);
  if (g('clip') === true) el.style.overflow = 'hidden';
  return mode;
}

export function placeholder(id: string, g: Getter, parentMode: string, inst: Inst | null): HTMLElement {
  const el = document.createElement('div');
  mark(el, id, inst);
  el.classList.add('placeholder');
  const name = g('name');
  el.textContent = typeof name === 'string' ? name : '';
  try { common(el, g, parentMode); } catch { /* a placeholder needs no size */ }
  return el;
}

// The getter of one node's values: inside an instance, its resolved values; else what it stores.
export function getter(id: string, n: Json, inst: Inst | null): Getter {
  if (inst && inst.values.has(id)) {
    const vals = inst.values.get(id);
    return (p) => vals[p];
  }
  return (p) => getPath(n, p);
}

// One node as DOM, or null when it is missing or already drawn on this page (in this instance).
// inst: null, or { id, values, key, depth } for the instance whose component's tree this is in.
export function drawNode(id: string, parentMode: string, inst: Inst | null): Drawn | null {
  const key = `${inst ? inst.key : ''}/${id}`;
  if (drawing.seen.has(key)) return null;
  const n = nodeOf(id);
  if (!n) return null;
  drawing.seen.add(key);
  const g = getter(id, n, inst);
  const labels = drawing.labels.length;
  const after = drawing.after.length;
  const marked = drawing.marked.length;
  try {
    return drawOne(id, n, g, parentMode, inst);
  } catch {
    // nothing of the discarded element is kept: no label, no later measuring, and no drawn-node
    // entry (its nodes' Layers rows then select nothing drawn, rather than a detached element); an
    // id is drawn at most once per page, so each entry removed was added by this attempt
    drawing.labels.length = labels;
    drawing.after.length = after;
    for (const k of drawing.marked.splice(marked)) drawing.byId.delete(k);
    return placeholder(id, g, parentMode, inst);
  }
}

export function drawChildren(el: Drawn, kids: string[], mode: string, inst: Inst | null) {
  for (const c of kids) {
    const child = drawNode(c, mode, inst);
    if (child) el.append(child);
  }
}

export function drawOne(id: string, n: Json, g: Getter, parentMode: string, inst: Inst | null): Drawn {
  let el;
  switch (n.type) {
    case 'frame':
    case 'component': {
      el = document.createElement('div');
      mark(el, id, inst);
      common(el, g, parentMode);
      const mode = layout(el, g);
      const hidden = g('visible') === false;
      if (hidden) drawing.hidden++;
      try { drawChildren(el, kidsOf(n), mode, inst); } finally { if (hidden) drawing.hidden--; }
      // a label only for a component that is shown: not hidden itself, nor inside a hidden frame
      if (n.type === 'component' && !inst && !hidden && drawing.hidden === 0) {
        const anchor = `--canvas-component-${++drawing.anchors}`;
        el.style.anchorName = anchor;
        const lab = document.createElement('div');
        lab.className = 'clabel';
        const name = g('name');
        lab.textContent = typeof name === 'string' && name ? name : 'Component';
        lab.style.positionAnchor = anchor;
        drawing.labels.push(lab);
      }
      break;
    }
    case 'text': {
      el = document.createElement('div');
      mark(el, id, inst);
      common(el, g, parentMode);
      const t = g('text');
      el.textContent = typeof t === 'string' ? t : '';
      el.style.whiteSpace = 'pre-wrap';
      const f = font(g('font'));
      el.style.fontFamily = f.family;
      el.style.fontSize = `${f.size}px`;
      el.style.fontWeight = String(f.weight);
      el.style.lineHeight = String(f.lineHeight);
      el.style.color = color(g('color')) ?? '#000000';
      el.style.textAlign = pick(TEXT_ALIGN, g('align'), 'left');
      break;
    }
    case 'rect':
    case 'ellipse':
      el = document.createElement('div');
      mark(el, id, inst);
      common(el, g, parentMode);
      paint(el, g);
      if (n.type === 'ellipse') el.style.borderRadius = '50%'; else radius(el, g);
      break;
    case 'vector': {
      el = document.createElementNS(SVG_NS, 'svg');
      mark(el, id, inst);
      el.style.overflow = 'visible';
      const hug = common(el, g, parentMode, { hugLater: true });
      let path: SVGPathElement | null = null;
      const d = g('path');
      if (pathOk(d)) {
        path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        path.style.fill = color(g('fill')) ?? 'none';
        path.style.stroke = color(g('stroke')) ?? 'none';
        path.style.strokeWidth = `${num(g('strokeWidth'), 0, 100000) ?? 0}px`;
        el.append(path);
      }
      if (hug.length && path) {
        const svg = el;
        drawing.after.push(() => {
          const b = path!.getBBox();
          if (hug.includes('w')) svg.style.width = `${Math.max(0, b.x + b.width)}px`;
          if (hug.includes('h')) svg.style.height = `${Math.max(0, b.y + b.height)}px`;
        });
      }
      break;
    }
    case 'image': {
      const file = imageFile(g('src'));
      if (file === null) {
        // anything but an images/ file: an empty box of the node's size
        el = document.createElement('div');
        mark(el, id, inst);
        common(el, g, parentMode);
        break;
      }
      el = document.createElement('img');
      mark(el, id, inst);
      common(el, g, parentMode);
      const name = g('name');
      el.alt = typeof name === 'string' ? name : '';
      el.draggable = false;
      el.style.objectFit = pick(FIT, g('fit'), 'cover');
      radius(el, g);
      el.src = `/api/canvas/image/${encodeURIComponent(state.slug!)}/${file}`;
      break;
    }
    case 'instance':
      return drawInstance(id, n, g, parentMode, inst);
    default:
      return placeholder(id, g, parentMode, inst);
  }
  hide(el, g);
  return el;
}

// An instance: its component's tree, resolved. Its root takes the instance's own name, visible,
// opacity, x and y (stored, else their defaults), its own size.w and size.h when stored (else the
// component root's), and everything else from the component root. Nested to a depth of 20; deeper,
// or a component that doesn't resolve, is a placeholder; so is every instance once the page's
// element budget is spent.
export function drawInstance(id: string, n: Json, g: Getter, parentMode: string, inst: Inst | null): Drawn {
  const depth = inst ? inst.depth + 1 : 1;
  const compId = g('component');
  const comp = nodeOf(compId);
  if (depth > MAX_DEPTH || !comp || comp.type !== 'component') return placeholder(id, g, parentMode, inst);
  if (drawing.capped || drawing.used + compElements(compId, comp) > MAX_ELEMENTS) {
    drawing.capped = true;
    return placeholder(id, g, parentMode, inst);
  }
  drawing.used += compElements(compId, comp);
  const rootG: Getter = (p) => {
    if (INSTANCE_OWN.has(p)) return g(p);
    if (INSTANCE_SIZE.has(p)) {
      const v = g(p);
      if (v !== undefined) return v;
    }
    return getPath(comp, p);
  };
  const inner = { id, values: resolveInstance(n, comp), key: `${inst ? inst.key : ''}/${id}`, depth };
  const el = document.createElement('div');
  mark(el, id, inst);
  common(el, rootG, parentMode);
  const mode = layout(el, rootG);
  drawChildren(el, kidsOf(comp), mode, inner);
  hide(el, rootG);
  return el;
}

// The page's top-level nodes on #surface, each placed at its x, y.
export function drawPage(pageId: Json) {
  const pg = pageById(pageId) || pages()[0];
  // the page's own tree, instances as one element each, counts against the budget first
  drawing = { seen: new Set(), after: [], labels: [], anchors: 0, byId: new Map(), marked: [], hidden: 0, sizes: new Map(), used: 0, capped: false };
  drawing.used = treeElements(kidsOf(pg));
  const els: Drawn[] = [];
  for (const id of kidsOf(pg)) {
    const el = drawNode(id, 'page', null);
    if (el) els.push(el);
  }
  $('surface').replaceChildren(...els, ...drawing.labels);
  for (const f of drawing.after) { try { f(); } catch { /* a size it can't measure stays 0 */ } }
  live.drawn = drawing.byId;
  $('capNote').hidden = !drawing.capped;
  drawing = null!;
}
