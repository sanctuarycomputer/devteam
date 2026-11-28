// kit-999: index.html's review-bridge block (3665-3732 at 0dd991bb), as index.html has it, with types: bridgeAccept,
// the one gate a review frame's message passes (only that frame's window, only an opaque origin, only the known
// messages, within the caps), and sha256Js. bridgeMessage(ev) is the body of index.html's message listener
// (4126-4135); src/views/review/client.tsx registers it. No imports and no DOM at import: compiled to
// lib-dist/lib/review-bridge.js (spec S7, S8). reviewState, renderReviewPreview and onBridge come through
// wireBridge(), which src/views/review/wire.ts calls once.
// `Loose` is `any`: a message's data has no fixed shape.
type Loose = any;
type Fn = (...a: Loose[]) => Loose;
let reviewState: Loose;
const wired: { [k: string]: Fn } = {};
const BRIDGE_SEAMS = ['renderReviewPreview', 'onBridge'] as const;
export type BridgeWire = { reviewState: Loose } & { [k in (typeof BRIDGE_SEAMS)[number]]: Fn };
// each key given replaces that key; the rest keep theirs
export function wireBridge(w: Partial<BridgeWire>): void {
  if (w.reviewState) reviewState = w.reviewState;
  for (const k of BRIDGE_SEAMS) { const f = w[k]; if (typeof f === 'function') wired[k] = f; }
}
const need = (n: string): Fn => {
  const f = wired[n];
  if (typeof f !== 'function') throw new Error(`review: ${n} is not wired`);
  return f;
};
const renderReviewPreview = (...a: Loose[]) => need('renderReviewPreview')(...a);
const onBridge = (...a: Loose[]) => need('onBridge')(...a);

/* review-bridge start */
// Every message from a review frame passes here first. It is accepted only from that frame's own
// window, with the opaque origin a sandboxed frame has ("null"), as one of the known types, within
// the size caps; what comes back holds only the fields its type allows. Anything else is dropped,
// with the reason. The kit's test loads this block by itself.
export const BRIDGE_MAX = 4 * 1024 * 1024;
export const BRIDGE_MD_MAX = 64 * 1024;
export function bridgeAccept(ev?: Loose, frameWindow?: Loose) {
  if (!ev || !frameWindow || ev.source !== frameWindow) return { drop: 'source' };
  if (ev.origin !== 'null') return { drop: 'origin' };
  const d = ev.data;
  const isPlain = (x?: Loose) => Object.prototype.toString.call(x) === '[object Object]';
  if (!isPlain(d)) return { drop: 'shape' };
  let size;
  try { size = JSON.stringify(d).length; } catch { return { drop: 'shape' }; }
  if (size > BRIDGE_MAX) return { drop: 'size' };
  const num = (x?: Loose) => typeof x === 'number' && Number.isFinite(x);
  switch (d.type) {
    case 'ready': return { type: 'ready' };
    case 'progress': return num(d.done) && num(d.total) && d.done >= 0 && d.done <= d.total && d.total <= 1e6 ? { type: 'progress', done: Math.floor(d.done), total: Math.floor(d.total) } : { drop: 'fields' };
    case 'draft': return d.state === undefined ? { drop: 'fields' } : { type: 'draft', state: d.state };
    case 'propose': return isPlain(d.result) ? { type: 'propose', result: d.result } : { drop: 'fields' };
    case 'markdown':
      if (!(num(d.id) || (typeof d.id === 'string' && d.id.length <= 100)) || typeof d.text !== 'string') return { drop: 'fields' };
      return d.text.length > BRIDGE_MD_MAX ? { drop: 'size' } : { type: 'markdown', id: d.id, text: d.text };
    case 'open':
      // a web page (https only), or a committed file in the repo
      if (typeof d.href === 'string') return d.href.length <= 2048 && /^https:\/\/[^\s/?#@]+(?:[/?#][^\s]*)?$/i.test(d.href) ? { type: 'open', href: d.href } : { drop: 'href' };
      if (typeof d.path === 'string') return d.path.length <= 512 && /^(?![/\\])(?!.*\.\.)[^\s]+$/.test(d.path) && (d.ref === undefined || (typeof d.ref === 'string' && /^[A-Za-z0-9._/-]{1,200}$/.test(d.ref))) ? { type: 'open', path: d.path, ref: d.ref } : { drop: 'path' };
      return { drop: 'fields' };
    case 'resize': return num(d.height) ? { type: 'resize', height: Math.max(0, Math.min(d.height, 100000)) } : { drop: 'fields' };
    default: return { drop: 'type' };
  }
}
// SHA-256 (FIPS 180-4) for when the page isn't a secure context (a dashboard on another host
// over plain http has no crypto.subtle); the same bytes, the same hash as the owner's process.
export function sha256Js(bytes?: Loose) {
  const K: Loose[] = [], H: Loose[] = [];
  for (let n = 2, c = 0; c < 64; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (!prime) continue;
    if (c < 8) H.push((Math.sqrt(n) % 1) * 2 ** 32 >>> 0);
    K.push((Math.cbrt(n) % 1) * 2 ** 32 >>> 0);
    c++;
  }
  const len = bytes.length;
  const words = new Uint32Array((((len + 8) >> 6) + 1) * 16);
  for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
  words[words.length - 1] = len * 8;
  words[words.length - 2] = Math.floor(len / 0x20000000);
  const w = new Uint32Array(64);
  const rot = (x?: Loose, n?: Loose) => (x >>> n) | (x << (32 - n));
  for (let j = 0; j < words.length; j += 16) {
    let [a, b, c, d, e, f, g, hh] = H;
    for (let i = 0; i < 64; i++) {
      if (i < 16) w[i] = words[j + i];
      else w[i] = (rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10)) + w[i - 7] + (rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3)) + w[i - 16];
      const t1 = (hh + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [hh, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    [a, b, c, d, e, f, g, hh].forEach((x?: Loose, i?: Loose) => { H[i] = (H[i] + x) >>> 0; });
  }
  return H.map((x?: Loose) => x.toString(16).padStart(8, '0')).join('');
}
/* review-bridge end */

export function bridgeMessage(ev?: Loose) {
  if (!reviewState.RV?.frame) return;
  const m = bridgeAccept(ev, reviewState.RV.frame.contentWindow);
  if (m.drop) {
    reviewState.RV.dropped++;
    if (reviewState.RV.dropped === 1 || reviewState.RV.dropped % 20 === 0) renderReviewPreview();
    return;
  }
  onBridge(m);
}
