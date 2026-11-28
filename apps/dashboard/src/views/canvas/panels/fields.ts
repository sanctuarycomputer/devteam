// The Properties panel's fields (canvas.html 2238-2629, kit-1014). Each declaration is the page's own, with
// types added; `PX` and `DEFAULT` are on `shared` (./held). No load-time code. No DOM at import.
// Each field shows the node's value as drawn and sends one edit of one set (setProp) of a value
// checked against its class: a number clamped to its range, a colour, tracks or a font built only
// from what the class allows. Text and number inputs send on change (Enter or leaving), the text
// textarea on leaving it. A field reads the value it builds on when it changes, not when it was built.
import { isObj, live, own, state, type Json } from '../core/page';
import { FAMILY, FR_RE, HEX_RE, MODE, clamp, color, finite, fontWords, isRef, pick, ref } from '../core/checkers';
import { CONTAINERS, getPath, nodeOf } from '../core/nodes';
import { freeText, pageAt, setProp, variantFor, variantHeld } from '../sync';
import { shared } from './held';
import { buildProps, hexChosen } from './layers';

/** [value, label] pairs of a select or a group of buttons. */
export type Opts = string[][];

export const NUM_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
export const TRACK_PX_RE = /^(?:\d+(?:\.\d*)?|\.\d+)$/;
export const NOTE = {
  tracks: 'Tracks are numbers, auto or 1fr-like, apart by spaces.',
  colour: 'A colour is #rgb, #rrggbb or #rrggbbaa.',
};
export const PAINTED = new Set(['frame', 'component', 'rect', 'ellipse', 'vector']);
export const ROUNDED = new Set(['frame', 'component', 'rect', 'image']);
// A property's value on the node as drawn now, or its default.
export function baseOf(id: Json, path: string): Json {
  const n = nodeOf(id);
  const v = n ? getPath(n, path) : undefined;
  return v === undefined ? shared.DEFAULT[path] : v;
}
// A field's value: in Change in, the variant's override where it holds one (a null included), else
// the base's; otherwise the base's.
export function valueOf(id: Json, path: string): Json {
  const o: Json = variantHeld(id, path);
  return o.held ? o.value : baseOf(id, path);
}
export const numText = (v: number): string => String(Math.round(v * 10000) / 10000);
export const lenOk = (x: Json): boolean => isRef(x) || (finite(x) && x >= 0 && x <= shared.PX);

// A field's note under its row (null removes it).
export function fieldNote(row: Element, text: string | null): void {
  let p = row.nextElementSibling;
  if (!(p instanceof HTMLElement && p.classList.contains('fnote'))) {
    if (text === null) return;
    p = document.createElement('p');
    p.className = 'note fnote';
    p.setAttribute('role', 'status');
    row.after(p);
  }
  if (text === null) p.remove(); else p.textContent = text;
}
// A labelled row of controls.
export function fieldRow(label: string, ...controls: Node[]): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'row';
  const k = document.createElement('span');
  k.className = 'k';
  k.textContent = label;
  const c = document.createElement('div');
  c.className = 'ctl';
  c.append(...controls);
  row.append(k, c);
  return row;
}
export function control<K extends keyof HTMLElementTagNameMap>(tag: K, prop: string, label: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.dataset.prop = prop;
  e.setAttribute('aria-label', label);
  return e;
}
export function textInput(prop: string, label: string, value: string): HTMLInputElement {
  const e = control('input', prop, label);
  e.type = 'text';
  e.spellcheck = false;
  e.value = value;
  return e;
}
// A select of [value, label] options showing `value` (an option of its own when none has it).
export function selectOf(prop: string, label: string, opts: Opts, value: Json): HTMLSelectElement {
  const s = control('select', prop, label);
  const v = String(value);
  const all = opts.some(([o]) => o === v) ? opts : [...opts, [v, v]];
  for (const [o, l] of all) {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = l;
    s.append(opt);
  }
  s.value = v;
  return s;
}
// A number input: the value shown times `scale` (a dimension token's path as its placeholder, the
// input then empty); on change the number typed, clamped to [min, max], is sent divided by `scale`;
// anything else puts back what was shown and sends nothing.
export function numInput(prop: string, label: string, v: Json, min: number, max: number, send: (x: number) => void, scale = 1): HTMLInputElement {
  const e = textInput(prop, label, '');
  e.inputMode = 'decimal';
  if (isRef(v)) e.placeholder = v.$ref; else if (finite(v)) e.value = numText(v * scale);
  let was = e.value;
  e.addEventListener('change', () => {
    const s = e.value.trim();
    if (!NUM_RE.test(s)) { e.value = was; return; }
    const x = clamp(Number(s), min, max);
    e.value = numText(x);
    was = e.value;
    send(x / scale);
  });
  return e;
}
export function checkbox(id: Json, path: string, label: string): HTMLDivElement {
  const e = control('input', path, label);
  e.type = 'checkbox';
  e.checked = valueOf(id, path) === true;
  e.addEventListener('change', () => setProp(id, path, e.checked));
  return fieldRow(label, e);
}
export function numField(id: Json, path: string, label: string, min: number, max: number, scale = 1): HTMLDivElement {
  return fieldRow(label, numInput(path, label, valueOf(id, path), min, max, (x) => setProp(id, path, x), scale));
}
// Buttons, one per [value, label], the current one pressed; a press on another sends it.
export function buttons(id: Json, path: string, label: string, opts: Opts): HTMLDivElement {
  const cur = valueOf(id, path);
  const g = document.createElement('div');
  g.className = 'group';
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', label);
  g.dataset.prop = path;
  for (const [v, l] of opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.value = v;
    b.textContent = l;
    b.setAttribute('aria-pressed', String(v === cur));
    b.addEventListener('click', () => { if (valueOf(id, path) !== v) setProp(id, path, v); });
    g.append(b);
  }
  return fieldRow(label, g);
}
// A select of fixed words; the panel is rebuilt after a choice, which keeps focus on it.
export function wordSelect(id: Json, path: string, label: string, opts: Opts): HTMLDivElement {
  const s = selectOf(path, label, opts, valueOf(id, path));
  s.addEventListener('change', () => { setProp(id, path, s.value); buildProps(); });
  return fieldRow(label, s);
}

// size.w or size.h: Hug, Fill or Fixed and its number. Choosing Fixed sends the size drawn now, in
// page px, rounded.
export function sizeField(id: Json, axis: string, label: string): HTMLDivElement {
  const path = `size.${axis}`;
  const v = valueOf(id, path);
  const kind = v === 'fill' ? 'fill' : finite(v) || isRef(v) ? 'fixed' : 'hug';
  const s = selectOf(path, label, [['hug', 'Hug'], ['fill', 'Fill'], ['fixed', 'Fixed']], kind);
  s.addEventListener('change', () => {
    if (s.value === 'fixed') {
      const el = live.drawn.get(id);
      const r = el ? el.getBoundingClientRect() : null;
      const px = r ? (axis === 'w' ? r.width : r.height) / shared.view.z : 100;
      setProp(id, path, Math.round(clamp(Number.isFinite(px) ? px : 100, 0, shared.PX)));
    } else setProp(id, path, s.value === 'fill' ? 'fill' : 'hug');
    buildProps();
  });
  const parts: HTMLElement[] = [s];
  if (kind === 'fixed') parts.push(numInput(`${path}#n`, `${label} in px`, v, 0, shared.PX, (x) => setProp(id, path, x)));
  return fieldRow(label, ...parts);
}
// Padding: four numbers; one changed sends the whole array, the other sides as stored ($refs kept).
export function paddingSides(id: Json): Json[] {
  const v = valueOf(id, 'layout.padding');
  return [0, 1, 2, 3].map((i) => (Array.isArray(v) && v.length === 4 && lenOk(v[i]) ? v[i] : 0));
}
export function paddingField(id: Json): HTMLDivElement {
  const sides = paddingSides(id);
  const box = document.createElement('div');
  box.className = 'pad';
  ['top', 'right', 'bottom', 'left'].forEach((side, i) => {
    box.append(numInput(`layout.padding#${i}`, `Padding ${side}`, sides[i], 0, shared.PX, (x) => {
      const now = paddingSides(id);
      now[i] = x;
      setProp(id, 'layout.padding', now);
    }));
  });
  return fieldRow('Padding', box);
}
// Tracks typed apart by spaces, each a number, `auto` or `<n>fr`, at most 64; null when any isn't.
export function parseTracks(s: string): (string | number)[] | null {
  const parts = s.trim() === '' ? [] : s.trim().split(/\s+/);
  if (parts.length > 64) return null;
  const out: (string | number)[] = [];
  for (const t of parts) {
    if (t === 'auto' || FR_RE.test(t)) out.push(t);
    else if (TRACK_PX_RE.test(t) && Number(t) <= shared.PX) out.push(Number(t));
    else return null;
  }
  return out;
}
export function tracksField(id: Json, path: string, label: string): HTMLDivElement {
  const v = valueOf(id, path);
  const e = textInput(path, label, Array.isArray(v) ? v.map((t) => (finite(t) ? numText(t) : typeof t === 'string' ? t : '?')).join(' ') : '');
  const row = fieldRow(label, e);
  e.addEventListener('change', () => {
    const t = parseTracks(e.value);
    fieldNote(row, t === null ? NOTE.tracks : null);
    if (t !== null) setProp(id, path, t);
  });
  return row;
}
// The document's tokens of one $type, by path (groups walked in order, at most 8 deep).
export function tokensOf(type: string): string[] {
  const out: string[] = [];
  const walk = (g: Json, pre: string, depth: number): void => {
    if (!isObj(g) || depth > 8) return;
    for (const k of Object.keys(g)) {
      const x = g[k];
      if (!isObj(x)) continue;
      const at = pre ? `${pre}.${k}` : k;
      if (own(x, '$type')) { if (x.$type === type) out.push(at); } else walk(x, at, depth + 1);
    }
  };
  walk(state.doc.tokens, '', 1);
  return out;
}
// The colour field: a select of the colour tokens, Hex and (where null is allowed) None, a swatch
// drawn through color(), and for Hex a hex input. Choosing Hex sends nothing: the hex typed is sent.
// In Change in, None is replaced by From base (`@base`), which sends null and so removes the
// variant's override (contract §2); the field says From base while the variant holds none, and a
// null the variant does hold (no paint in that variant) shows as None.
export function colourField(id: Json, path: string, label: string, none: boolean): HTMLDivElement {
  const v = valueOf(id, path);
  const vm: Json = variantFor(id);
  const key = `${id} ${path} ${vm === null ? '' : vm.name}`;
  const chosen = hexChosen.has(key);
  const opts = tokensOf('color').map((t) => [t, t]);
  opts.push(['@hex', 'Hex']);
  let mode;
  if (vm === null) {
    mode = isRef(v) && !chosen ? v.$ref : v === null && none && !chosen ? '@none' : '@hex';
    if (none) opts.push(['@none', 'None']);
  } else {
    const held = variantHeld(id, path).held;
    mode = chosen ? '@hex' : !held ? '@base' : isRef(v) ? v.$ref : v === null ? '@none' : '@hex';
    opts.push(['@base', 'From base']);
    if (mode === '@none') opts.push(['@none', 'None']);
  }
  const s = selectOf(path, label, opts, mode);
  const sw = document.createElement('span');
  sw.className = 'swatch';
  sw.setAttribute('aria-hidden', 'true');
  const c = color(v);
  if (c) sw.style.backgroundColor = c; else sw.classList.add('none');
  s.addEventListener('change', () => {
    if (s.value === '@hex') hexChosen.add(key);
    else {
      hexChosen.delete(key);
      setProp(id, path, s.value === '@none' || s.value === '@base' ? null : { $ref: s.value });
    }
    buildProps();
  });
  const parts: HTMLElement[] = [s, sw];
  let row: HTMLDivElement | null = null;
  if (mode === '@hex') {
    const r = isRef(v) ? ref(v, 'color') : v;
    const h = textInput(`${path}#hex`, `${label} hex`, typeof r === 'string' && HEX_RE.test(r) ? r : '');
    h.maxLength = 9;
    h.placeholder = '#rrggbb';
    h.addEventListener('change', () => {
      const x = h.value.trim();
      if (!HEX_RE.test(x)) { fieldNote(row!, NOTE.colour); return; }
      fieldNote(row!, null);
      hexChosen.delete(key);
      sw.classList.remove('none');
      sw.style.backgroundColor = x;
      setProp(id, path, x);
    });
    parts.push(h);
  }
  row = fieldRow(label, ...parts);
  return row;
}
// The font: a select of the typography tokens and Custom; choosing Custom sends the font drawn now
// as literals. Custom shows family, size, weight and line height, any of which sends the whole font
// (the other parts as stored, $refs kept, or as drawn when not stored in their class).
export const FONT_PART_OK: Record<string, (x: Json) => boolean> = {
  family: (x) => typeof x === 'string' && own(FAMILY, x),
  size: (x) => finite(x) && x >= 1 && x <= 1000,
  weight: (x) => finite(x) && x >= 100 && x <= 900 && x % 100 === 0,
  lineHeight: (x) => finite(x) && x >= 0.5 && x <= 10,
};
export function fontParts(id: Json): Json {
  const now = valueOf(id, 'font');
  const words: Json = fontWords(now);
  const out: Json = {};
  for (const k of ['family', 'size', 'weight', 'lineHeight']) {
    const x = isObj(now) && !isRef(now) ? now[k] : undefined;
    out[k] = isRef(x) || FONT_PART_OK[k](x) ? x : words[k];
  }
  return out;
}
export function fontField(id: Json): HTMLDivElement[] {
  const v = valueOf(id, 'font');
  const custom = !isRef(v);
  const opts = tokensOf('typography').map((t) => [t, t]);
  opts.push(['@custom', 'Custom']);
  const s = selectOf('font', 'Font', opts, custom ? '@custom' : v.$ref);
  s.addEventListener('change', () => {
    setProp(id, 'font', s.value === '@custom' ? fontWords(valueOf(id, 'font')) : { $ref: s.value });
    buildProps();
  });
  const rows = [fieldRow('Font', s)];
  if (!custom) return rows;
  const parts = fontParts(id);
  const sendPart = (k: string, x: Json): void => {
    const now = fontParts(id);
    now[k] = x;
    setProp(id, 'font', now);
  };
  // a part held by a token shows as that token in its select (its value `@<path>`)
  const refOpt = (x: Json): Opts => (isRef(x) ? [[`@${x.$ref}`, x.$ref]] : []);
  const partSelect = (k: string, label: string, opts: Opts): HTMLDivElement => {
    const x = parts[k];
    const ps = selectOf(`font#${k}`, label, [...opts, ...refOpt(x)], isRef(x) ? `@${x.$ref}` : x);
    ps.addEventListener('change', () => {
      const val = ps.value;
      sendPart(k, val.startsWith('@') ? { $ref: val.slice(1) } : k === 'weight' ? Number(val) : val);
      buildProps();
    });
    return fieldRow(label, ps);
  };
  rows.push(partSelect('family', 'Family', [['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']]));
  rows.push(fieldRow('Size', numInput('font#size', 'Font size', parts.size, 1, 1000, (x) => sendPart('size', x))));
  rows.push(partSelect('weight', 'Weight', [100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => [String(w), String(w)])));
  rows.push(fieldRow('Line height', numInput('font#lineHeight', 'Line height', parts.lineHeight, 0.5, 10, (x) => sendPart('lineHeight', x))));
  return rows;
}
// The text: a textarea (Enter is a new line), sent on leaving it.
export function textField(id: Json): HTMLDivElement {
  const v = valueOf(id, 'text');
  const e = control('textarea', 'text', 'Text');
  e.maxLength = 10000;
  e.rows = 3;
  e.spellcheck = false;
  e.value = typeof v === 'string' ? v : '';
  e.addEventListener('change', () => {
    if ([...e.value].length <= 10000 && freeText(e.value)) setProp(id, 'text', e.value);
  });
  return fieldRow('Text', e);
}
// An instance's variant: None or one of its component's variants.
export function variantField(id: Json, n: Json): HTMLDivElement {
  const comp = nodeOf(n.component);
  const names = comp && comp.type === 'component' && isObj(comp.variants) ? Object.keys(comp.variants) : [];
  const v = valueOf(id, 'variant');
  const s = selectOf('variant', 'Variant', [['@none', 'None'], ...names.map((x) => [x, x])], typeof v === 'string' ? v : '@none');
  s.addEventListener('change', () => { setProp(id, 'variant', s.value === '@none' ? null : s.value); buildProps(); });
  return fieldRow('Variant', s);
}
// x and y place a node only under a `none` frame or component, or the page.
export function placedByXY(n: Json): boolean {
  if (pageAt(state.doc, n.parent) >= 0) return true;
  const p = nodeOf(n.parent);
  return !!p && CONTAINERS.has(p.type) && pick(MODE, getPath(p, 'layout.mode'), 'none') === 'none';
}

// The fields of a node's type (spec §4's table), in the panel's order, after Name.
export function fieldsFor(id: Json, n: Json): HTMLDivElement[] {
  const t = n.type;
  const out = [checkbox(id, 'visible', 'Visible'), numField(id, 'opacity', 'Opacity %', 0, 100, 100)];
  if (placedByXY(n)) out.push(numField(id, 'x', 'X', -shared.PX, shared.PX), numField(id, 'y', 'Y', -shared.PX, shared.PX));
  out.push(sizeField(id, 'w', 'Width'), sizeField(id, 'h', 'Height'));
  if (CONTAINERS.has(t)) {
    const mode = pick(MODE, valueOf(id, 'layout.mode'), 'none');
    out.push(buttons(id, 'layout.mode', 'Direction', [['none', 'Free'], ['row', 'Row'], ['column', 'Column'], ['grid', 'Grid']]));
    if (mode !== 'none') {
      out.push(numField(id, 'layout.gap', 'Gap', 0, shared.PX));
      out.push(buttons(id, 'layout.align', 'Align', [['start', 'Start'], ['center', 'Center'], ['end', 'End'], ['stretch', 'Stretch']]));
      out.push(buttons(id, 'layout.justify', 'Justify', [['start', 'Start'], ['center', 'Center'], ['end', 'End'], ['between', 'Apart']]));
    }
    if (mode === 'row' || mode === 'column') out.push(checkbox(id, 'layout.wrap', 'Wrap'));
    out.push(paddingField(id));
    if (mode === 'grid') out.push(tracksField(id, 'layout.columns', 'Columns'), tracksField(id, 'layout.rows', 'Rows'));
  }
  if (PAINTED.has(t)) out.push(colourField(id, 'fill', 'Fill', true), colourField(id, 'stroke', 'Stroke', true), numField(id, 'strokeWidth', 'Stroke width', 0, shared.PX));
  if (ROUNDED.has(t)) out.push(numField(id, 'radius', 'Radius', 0, shared.PX));
  if (CONTAINERS.has(t)) out.push(checkbox(id, 'clip', 'Clip'));
  if (t === 'text') {
    out.push(textField(id), ...fontField(id), colourField(id, 'color', 'Colour', false));
    out.push(buttons(id, 'align', 'Align', [['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['justify', 'Justify']]));
  }
  if (t === 'image') out.push(wordSelect(id, 'fit', 'Fit', [['cover', 'Cover'], ['contain', 'Contain'], ['fill', 'Fill']]));
  // an inner instance's own wiring can't be overridden, so its Variant is hidden in Change in
  if (t === 'instance' && variantFor(id) === null) out.push(variantField(id, n));
  return out;
}
