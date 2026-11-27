// The checkers: every style value comes from one of these, never a document string passed through
// (canvas.html 512-658, kit-1013). Each declaration is the page's own, with types added.
import { isObj, own, state, type Json } from './page';

/** A font as fontWords gives it: the family as its word (sans, serif, mono). */
export type FontWords = { family: string; size: number; weight: number; lineHeight: number };

export const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
export const VARIANT_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/; // a variant's name (canvas-doc@1 variantName)
export const HEX6_RE = /^#[0-9a-f]{6}$/i;
export const SRC_RE = /^images\/([0-9a-f]{16}\.(?:png|jpg|webp|gif))$/;
export const FR_RE = /^([1-9][0-9]{0,2})fr$/;
export const finite = (v: Json): boolean => typeof v === 'number' && Number.isFinite(v);
export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
export const isRef = (v: Json): boolean => isObj(v) && Object.keys(v).length === 1 && typeof v.$ref === 'string';
// The page's own tables: a document word is looked up here, never passed through.
export const FAMILY: Record<string, string> = {
  sans: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "ui-serif, Georgia, Cambria, 'Times New Roman', serif",
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};
export const MODE: Record<string, string> = { none: 'none', row: 'row', column: 'column', grid: 'grid' };
export const ALIGN: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' };
export const JUSTIFY: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between' };
export const TEXT_ALIGN: Record<string, string> = { left: 'left', center: 'center', right: 'right', justify: 'justify' };
export const FIT: Record<string, string> = { cover: 'cover', contain: 'contain', fill: 'fill' };
export const pick = (table: Record<string, string>, v: Json, dflt: string): string => (typeof v === 'string' && own(table, v) ? table[v] : table[dflt]);

// The token a $ref names ({ $type, $value }), or null: one step, no aliases (contract §2 Tokens).
export function token(v: Json): Json {
  if (!isRef(v)) return null;
  let at = isObj(state.doc.tokens) ? state.doc.tokens : null;
  for (const seg of v.$ref.split('.')) {
    if (!isObj(at) || !own(at, seg)) return null;
    at = at[seg];
  }
  return isObj(at) && own(at, '$type') && own(at, '$value') ? at : null;
}
// A colour token's value as CSS the page builds: its hex, or else rgb() from its components and alpha.
export function colorToken(x: Json): string | null {
  if (!isObj(x)) return null;
  if (typeof x.hex === 'string' && HEX6_RE.test(x.hex)) return x.hex;
  const c = x.components;
  if (!Array.isArray(c) || c.length !== 3 || !c.every((n) => finite(n) && n >= 0 && n <= 1)) return null;
  const a = own(x, 'alpha') ? x.alpha : 1;
  if (!finite(a) || a < 0 || a > 1) return null;
  const [r, g, b] = c.map((n) => Math.round(n * 255));
  return `rgb(${r} ${g} ${b} / ${a})`;
}
// A $ref's literal value (of `type` when given), or undefined when it doesn't resolve.
export function ref(v: Json, type?: string): Json {
  const tk = token(v);
  if (!tk || (type && tk.$type !== type)) return undefined;
  const x = tk.$value;
  switch (tk.$type) {
    case 'color': return colorToken(x) ?? undefined;
    case 'dimension': return isObj(x) && x.unit === 'px' && finite(x.value) ? x.value : undefined;
    case 'fontFamily': case 'fontWeight': case 'number': return x;
    case 'typography': return isObj(x) ? x : undefined;
    default: return undefined;
  }
}
// A colour (a hex, or a colour token), or null.
export function color(v: Json): string | null {
  if (isRef(v)) return ref(v, 'color') ?? null;
  return typeof v === 'string' && HEX_RE.test(v) ? v : null;
}
// A finite number (or, with `type`, a token of that type) clamped to [min, max], or null.
export function num(v: Json, min: number, max: number, type: string | null = 'dimension'): number | null {
  const x = isRef(v) ? (type ? ref(v, type) : undefined) : v;
  return finite(x) ? clamp(x, min, max) : null;
}
// 'hug', 'fill' or a fixed px size; anything else is the default, 'hug'.
export function sizing(v: Json): 'hug' | 'fill' | number {
  if (v === 'hug' || v === 'fill') return v;
  const n = num(v, 0, 100000);
  return n === null ? 'hug' : n;
}
// A CSS track list rebuilt from px, `auto` and `<n>fr`; '' for an empty list or one out of its class.
export function tracks(v: Json): string {
  if (!Array.isArray(v) || v.length > 64) return '';
  const out: string[] = [];
  for (const t of v) {
    if (finite(t) && t >= 0 && t <= 100000) out.push(`${t}px`);
    else if (t === 'auto') out.push('auto');
    else if (typeof t === 'string' && FR_RE.test(t)) out.push(`${Number(FR_RE.exec(t)![1])}fr`);
    else return '';
  }
  return out.join(' ');
}
// A whole font: a typography token, or the four fields each a literal or a token. A size or line
// height that is a number is clamped to its range (as a length is); a field that is no number, or a
// weight off the 100 steps, takes its default. fontWords gives the family as its word (sans, serif,
// mono), font as the page's own font stack for it.
export function font(v: Json): FontWords {
  const w = fontWords(v);
  return { ...w, family: FAMILY[w.family] };
}
export function fontWords(v: Json): FontWords {
  const out = { family: 'sans', size: 16, weight: 400, lineHeight: 1.4 };
  let fam: Json; let size: Json; let weight: Json; let lh: Json;
  if (isRef(v)) {
    const t = ref(v, 'typography');
    if (!t) return out;
    fam = t.fontFamily;
    size = isObj(t.fontSize) && t.fontSize.unit === 'px' ? t.fontSize.value : undefined;
    weight = t.fontWeight;
    lh = t.lineHeight;
  } else if (isObj(v)) {
    fam = isRef(v.family) ? ref(v.family, 'fontFamily') : v.family;
    size = isRef(v.size) ? ref(v.size, 'dimension') : v.size;
    weight = isRef(v.weight) ? ref(v.weight, 'fontWeight') : v.weight;
    lh = isRef(v.lineHeight) ? ref(v.lineHeight, 'number') : v.lineHeight;
  } else return out;
  if (typeof fam === 'string' && own(FAMILY, fam)) out.family = fam;
  if (finite(size)) out.size = clamp(size, 1, 1000);
  if (finite(weight) && weight >= 100 && weight <= 900 && weight % 100 === 0) out.weight = weight;
  if (finite(lh)) out.lineHeight = clamp(lh, 0.5, 10);
  return out;
}
// The contract's pathData grammar: optional whitespace, a move, then commands and numbers separated
// by whitespace and at most one comma (none leading, none trailing, never two in a row); at most
// 65536 bytes. A scan with a sticky number pattern, so a long path costs linear time and no regular
// expression backtracks over the whole string.
export const PATH_NUM = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
export const PATH_CMD = 'MLHVCSQTAZmlhvcsqtaz';
export const PATH_WS = ' \t\n\r\f';
export function pathOk(s: Json): boolean {
  if (typeof s !== 'string' || s.length > 65536) return false;
  let i = 0;
  const n = s.length;
  const ws = () => { while (i < n && PATH_WS.includes(s[i])) i++; };
  ws();
  if (s[i] !== 'M' && s[i] !== 'm') return false;
  i++;
  for (;;) {
    ws();
    let comma = false;
    if (s[i] === ',') { comma = true; i++; ws(); }
    if (i >= n) return !comma;
    if (PATH_CMD.includes(s[i])) { i++; continue; }
    PATH_NUM.lastIndex = i;
    if (!PATH_NUM.test(s)) return false;
    i = PATH_NUM.lastIndex;
  }
}
// The image route's file for an `images/<16 hex>.<ext>` src, or null.
export function imageFile(src: Json): string | null {
  const m = typeof src === 'string' ? SRC_RE.exec(src) : null;
  return m ? m[1] : null;
}
