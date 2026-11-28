// ---- others on the canvas (kit-663): presence@1 cursors (canvas.html 4725-4954, kit-1018) ----
// Each declaration is the page's own, with types added. The overlay's elements, which the page made at
// load, are module lets that initCursors() makes, in the page's order with its listeners. No DOM at import.
import { $, isObj, state, type Json } from '../core/page';
import { clamp } from '../core/checkers';
import { contentBounds, ready } from '../panels';
import * as panels from '../panels';
import { placeCursors } from './drawing';
import { readPins, setLevel } from './pins';

type Timer = ReturnType<typeof setTimeout>;
/** An anchor (canvas@1 §9): a drawn node's id, or `@<page id>`, and the fractions across it. */
export type Anchor = { k: string; x: number; y: number };
export type Who = { id: string; name: string; on: boolean };
export type Cursor = { id: string; name: string; k: string; x: number; y: number };
export type Pres = {
  ws: WebSocket | null; live: boolean; tries: number; you: string | null; here: Json; hereKey: string | null;
  people: Map<string, Who>; cursors: Map<string, Cursor>; parked: boolean; hiddenTimer: Timer | null;
  retryTimer: Timer | null; lastMoveAt: number; moveTimer: Timer | null; nextMove: Anchor | null | undefined;
};

// The overlay others are drawn in: stage chrome over the design, placed in stage px from anchors.
export let othersLayer: HTMLDivElement;
// boxes (others' selections and the last edit's mark) under cursors; each redrawn on its own
export let boxLayer: HTMLDivElement;
export let cursorLayer: HTMLDivElement;
// A person's colour, by a hash of their id: each holds white text at 4.5:1 or more.
export const PALETTE = ['#c92a2a', '#a61e4d', '#862e9c', '#5f3dc4', '#364fc7', '#1864ab', '#0b7285', '#1f6f3f'];
export function colourOf(id: Json): string {
  let h = 0;
  for (const ch of String(id)) h = (Math.imul(h, 31) + ch.codePointAt(0)!) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// SHA-256 of a string's UTF-8 bytes, as hex (presence@1 §5's h: rule; crypto.subtle exists only on
// secure origins, and a laptop's dashboard may be plain http on a LAN address). The constants are the
// standard's: the first 32 bits of the fractional parts of the square and cube roots of the primes.
export const SHA = (() => {
  const primes: number[] = [];
  for (let n = 2; primes.length < 64; n++) if (primes.every((p) => n % p !== 0)) primes.push(n);
  const frac = (v: number): number => Math.floor((v - Math.floor(v)) * 0x100000000) >>> 0;
  return { K: primes.map((p) => frac(Math.cbrt(p))), H: primes.slice(0, 8).map((p) => frac(Math.sqrt(p))) };
})();
export const ror = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
export function sha256Hex(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const len = bytes.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor(len / 0x20000000));
  dv.setUint32(total - 4, (len * 8) >>> 0);
  const h = SHA.H.slice();
  const w = new Uint32Array(64);
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + SHA.K[i] + w[i]) >>> 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      k = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, k].forEach((v, i) => { h[i] = (h[i] + v) >>> 0; });
  }
  return h.map((v) => v.toString(16).padStart(8, '0')).join('');
}
// An `at` part as presence@1 §5 sends it: as it is when in the set and at most 120 characters, else h:.
export const AT_PART = /^[A-Za-z0-9._:@/-]{1,120}$/;
export const atPart = (v: string): string => (AT_PART.test(v) ? v : `h:${sha256Hex(v).slice(0, 16)}`);

// The presence socket. ws: open or null; live: welcomed; you: our person id; here: the at last sent
// (and visible, as JSON in hereKey); people: conn -> { id, name, on } for others' connections, `on`
// when on our spot and visible; cursors: conn -> { id, name, k, x, y }; parked: closed while hidden.
export const MOVE_MS = 67; // presence@1 §6: at most 15 moves a second
export const HIDDEN_MS = 60000; // §9: a page hidden this long closes its socket
export const SPOT = ['page', 'tab', 'peek', 'art'];
export const pres: Pres = {
  ws: null, live: false, tries: 0, you: null, here: null, hereKey: null, people: new Map(), cursors: new Map(),
  parked: false, hiddenTimer: null, retryTimer: null, lastMoveAt: -Infinity, moveTimer: null, nextMove: undefined,
};
export function connectPresence(): void {
  if (pres.ws || pres.parked || state.session === null || pres.retryTimer !== null) return;
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws: WebSocket;
  try { ws = new WebSocket(`${scheme}://${location.host}/presence`); } catch { retryPresence(); return; }
  pres.ws = ws;
  ws.addEventListener('message', (e) => { if (pres.ws === ws) presenceMessage(e.data); });
  ws.addEventListener('close', () => presenceClosed(ws));
}
// §8: reconnect after 1, 2, 4 … up to 30 s.
export function retryPresence(): void {
  const ms = Math.min(30000, 1000 * 2 ** Math.min(pres.tries, 5));
  pres.tries += 1;
  pres.retryTimer = setTimeout(() => { pres.retryTimer = null; connectPresence(); }, ms);
}
// Down: every cursor goes (§8: cursors stop), and the page tries again unless it is parked (hidden).
export function presenceClosed(ws: WebSocket | null): void {
  if (pres.ws !== ws) return;
  pres.ws = null;
  pres.live = false;
  pres.here = null;
  pres.hereKey = null;
  pres.people.clear();
  pres.cursors.clear();
  placeCursors();
  if (!pres.parked) retryPresence();
}
export function presenceSend(m: Json): boolean {
  if (!pres.ws || !pres.live) return false;
  try { pres.ws.send(JSON.stringify(m)); return true; } catch { return false; }
}
// `here`, when the socket is welcomed and the spot or the visibility changed (or `force`).
export function sendHere(force = false): void {
  if (!pres.live || state.pageId === null || state.slug === null) return;
  const at = { page: 'canvas', tab: atPart(String(state.pageId)), peek: null, art: atPart(`${state.slug}@canvas`), thread: null };
  const visible = document.visibilityState === 'visible';
  const key = JSON.stringify([at, visible]);
  if (!force && key === pres.hereKey) return;
  if (presenceSend({ t: 'here', at, visible })) { pres.here = at; pres.hereKey = key; }
}
export function presenceMessage(data: Json): void {
  let m: Json;
  try { m = JSON.parse(data); } catch { return; }
  if (!isObj(m) || typeof m.t !== 'string') return;
  if (m.t === 'welcome') {
    pres.live = true;
    pres.tries = 0;
    pres.you = isObj(m.you) && typeof m.you.id === 'string' ? m.you.id : null;
    sendHere(true);
  } else if (m.t === 'people') takePeople(m);
  else if (m.t === 'move') takeMove(m);
  else if (m.t === 'ping') presenceSend({ t: 'pong' });
  else if (m.t === 'changed') readPins(); // the log grew: a pin's thread may have (kit-664)
  // any other kind: nothing on a canvas
}
// people: others' connections, each `on` when its at is our spot and it is visible; a cursor whose
// conn isn't on any more goes.
export function takePeople(m: Json): void {
  if (!Array.isArray(m.people)) return;
  pres.people.clear();
  for (const p of m.people) {
    if (isObj(p) && typeof p.id === 'string' && p.id === pres.you) setLevel(p.level); // our own entry: our level (kit-664)
    if (!isObj(p) || typeof p.id !== 'string' || p.id === pres.you || !Array.isArray(p.conns)) continue;
    const name = typeof p.name === 'string' && p.name ? p.name : p.id;
    for (const c of p.conns) {
      if (!isObj(c) || typeof c.conn !== 'string' || !isObj(c.at)) continue;
      const on = c.visible === true && pres.here !== null && SPOT.every((k) => c.at[k] === pres.here[k]);
      pres.people.set(c.conn, { id: p.id, name, on });
    }
  }
  for (const conn of [...pres.cursors.keys()]) {
    const who = pres.people.get(conn);
    if (!who || !who.on) pres.cursors.delete(conn);
  }
  placeCursors();
}
export const unit = (v: Json): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
export function takeMove(m: Json): void {
  // hidden, others' cursors are dropped (onVisibility); a move sent before the relay heard our here
  // visible false must not draw one back, stale when the page is shown (final-2 F2-1)
  if (document.visibilityState !== 'visible') return;
  const who = typeof m.conn === 'string' ? pres.people.get(m.conn) : undefined;
  if (!who || !who.on) return;
  const a = m.a;
  if (a === null) pres.cursors.delete(m.conn);
  else if (isObj(a) && typeof a.k === 'string' && a.k && unit(a.x) && unit(a.y)) pres.cursors.set(m.conn, { id: who.id, name: who.name, k: a.k, x: a.x, y: a.y });
  else return;
  placeCursors();
}

// Our pointer: the drawn node under it and its fraction across that node's box, else `@<page id>`
// and its fraction across the page's content bounds (canvas@1 §9), in page px.
export const fracOf = (d: number, w: number): number => (w > 0 ? clamp(d / w, 0, 1) : 0);
// The content bounds for cursors: contentBounds(), or on an empty page the -200..200 square.
export const cursorBounds = () => contentBounds() ?? { l: -200, t: -200, r: 200, b: 200 };
export function anchorAt(cx: number, cy: number): Anchor {
  for (const el of document.elementsFromPoint(cx, cy)) {
    const n = el.closest<HTMLElement>('#surface [data-id]');
    if (!n) continue;
    const r = n.getBoundingClientRect();
    return { k: n.dataset.id!, x: fracOf(cx - r.left, r.width), y: fracOf(cy - r.top, r.height) };
  }
  const o = $('surface').getBoundingClientRect();
  const b = cursorBounds();
  const px = (cx - o.left) / panels.shared.view.z;
  const py = (cy - o.top) / panels.shared.view.z;
  return { k: `@${state.pageId}`, x: fracOf(px - b.l, b.r - b.l), y: fracOf(py - b.t, b.b - b.t) };
}
// At most one move per 67 ms: the latest waits for the window's end, those in between are dropped.
export function flushMove(): void {
  if (pres.moveTimer !== null || pres.nextMove === undefined) return;
  const now = performance.now();
  const wait = pres.lastMoveAt + MOVE_MS - now;
  if (wait > 0) {
    pres.moveTimer = setTimeout(() => { pres.moveTimer = null; flushMove(); }, Math.ceil(wait));
    return;
  }
  const a = pres.nextMove;
  pres.nextMove = undefined;
  if (presenceSend({ t: 'move', a })) pres.lastMoveAt = now;
}

// Visibility (§9): every change says `here`; hidden for 60 s closes the socket, shown reconnects. Run
// on every change and once at start, so a canvas that loads hidden (a background tab) closes too.
export function onVisibility(): void {
  clearTimeout(pres.hiddenTimer!);
  pres.hiddenTimer = null;
  if (document.visibilityState === 'visible') {
    if (pres.parked) { pres.parked = false; connectPresence(); }
    sendHere();
    return;
  }
  sendHere();
  // hidden, the page is sent no moves (presence@1 §9), so others' cursors would go stale: drop them;
  // each comes back with that person's next move once the page is shown (final-1 F1)
  pres.cursors.clear();
  placeCursors();
  pres.hiddenTimer = setTimeout(() => {
    pres.hiddenTimer = null;
    if (document.visibilityState === 'visible') return;
    pres.parked = true;
    clearTimeout(pres.retryTimer!);
    pres.retryTimer = null;
    if (pres.ws) pres.ws.close(); else presenceClosed(null);
  }, HIDDEN_MS);
}

// The page's load-time lines of this part (4728-4735, 4918-4927, 4953), in its order: the overlay made
// and placed in #stage, our pointer's two listeners, and the visibility listener. mount() runs it once.
export function initCursors(): void {
  othersLayer = document.createElement('div');
  othersLayer.id = 'others';
  othersLayer.setAttribute('aria-hidden', 'true');
  $('stage').insertBefore(othersLayer, $('surface').nextSibling);
  boxLayer = document.createElement('div');
  cursorLayer = document.createElement('div');
  othersLayer.append(boxLayer, cursorLayer);
  $('stage').addEventListener('pointermove', (e) => {
    if (!pres.live || !ready() || state.pageId === null) return;
    pres.nextMove = anchorAt(e.clientX, e.clientY);
    flushMove();
  });
  $('stage').addEventListener('pointerleave', () => {
    if (!pres.live) return;
    pres.nextMove = null;
    flushMove();
  });
  document.addEventListener('visibilitychange', onVisibility);
}
