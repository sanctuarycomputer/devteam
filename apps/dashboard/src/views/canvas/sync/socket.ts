// ---- the socket (canvas@1 §3, §5) and the `select` sender (kit-669 §2) (canvas.html 4452-4724, kit-1015) ----
// Each declaration is the page's own, with types added; checks/faithful.mjs holds it to the page's tokens.
import { frameOk, isObj, own, state, type Json } from '../core/page';
import * as history from '../history';
import { markEdit, placeOthers, takeSelections } from '../presence';
import * as presence from '../presence';
import { applyOps } from './ops';
import { lock, redraw, say, showBanner, syncBody, takeDoc } from './copies';
import { BANNER, KEPT_MAX, NOT_VALID, RATE } from './ids';
import { shared } from './shared';

type Timer = ReturnType<typeof setTimeout>;
/** The socket's state (see the comment on `sock`). */
export type Sock = {
  ws: WebSocket | null; live: boolean; down: boolean; ended: boolean; tries: number; cursor: number; sentAt: number[]; pumpTimer: Timer | null; seq: number;
  fetching: boolean; held: Json[]; stale: boolean; again: boolean; session: Json; highest: number; epoch: number; lowered: boolean;
  lastSelect: string | null; resendSelect: boolean;
};

// ws: the open socket or null; live: welcomed; down: closed and reconnecting; ended: closed for good;
// tries: reconnects since the last welcome; cursor: pending[cursor] is the next edit to send on this
// socket; sentAt: when the edits of the last second went; seq: the last seq given; fetching: the
// document being fetched again, the ops that arrive meanwhile waiting in held; stale: fetch at the next
// welcome whatever it says; again: fetch once more when this fetch ends. kit-668: session: the session
// the socket is on now (every welcome's and reload's; state.session is base's); highest: the highest
// rev seen in it; epoch: counts reloads, so a fetch asked for before one is thrown away; lowered: a
// welcome on base's session came at a rev below the highest seen (the edits above it are gone).
export const sock: Sock = {
  ws: null, live: false, down: false, ended: false, tries: 0, cursor: 0, sentAt: [], pumpTimer: null, seq: 0,
  fetching: false, held: [], stale: false, again: false, session: null, highest: 0, epoch: 0, lowered: false,
  // kit-669: the ids of the last `select` sent on this socket (as JSON), null since its welcome
  lastSelect: null,
  // kit-663 §6: a fetch has landed on a new session (a restart or a reload) or a lowered rev since the
  // last `select` went: the next one goes even when it equals the last (an empty one too), since the
  // server's selection may have lost those ids
  resendSelect: false,
};
// ---- the `select` sender (kit-669 §2, canvas@1 §5) ----
// Whenever the selection changes the server is told its ids in layer order, the first 100 (contract
// selectIds): at most one `select` per 250 ms, the first change at once, later ones within the window
// one at its end with the selection as it is then. It waits until the page has no edit unacked
// (pending empty: each ack or refusal that empties it lets it go), so it never names a node whose add
// the server hasn't applied. Nothing while the socket is down (every welcome sends the selection again
// when it isn't empty), on main's copy, or when it equals the last sent on this socket.
export const SELECT_MS = 250;
export const selq: { want: boolean; timer: Timer | null; lastAt: number } = { want: false, timer: null, lastAt: -Infinity };
export function queueSelect(): void {
  selq.want = true;
  trySelect();
}
export function trySelect(): void {
  if (!selq.want || selq.timer !== null) return;
  // kit-663 §6: nor while the document is fetched (refetch queues one when it lands)
  if (state.session === null || !sock.ws || !sock.live || sock.fetching || state.pending.length > 0) return;
  const now = performance.now();
  const wait = selq.lastAt + SELECT_MS - now;
  if (wait > 0) {
    selq.timer = setTimeout(() => { selq.timer = null; trySelect(); }, Math.ceil(wait));
    return;
  }
  selq.want = false;
  const ids = state.sels.slice(0, shared.SELECT_IDS);
  const key = JSON.stringify(ids);
  if (!sock.resendSelect && key === (sock.lastSelect ?? '[]')) return;
  if (send({ t: 'select', ids })) {
    sock.lastSelect = key;
    sock.resendSelect = false;
    selq.lastAt = now;
  }
}
export function connect(): void {
  if (sock.ended || sock.ws) return;
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws: WebSocket;
  try { ws = new WebSocket(`${scheme}://${location.host}/canvas?slug=${encodeURIComponent(state.slug!)}`); } catch { retry(); return; }
  sock.ws = ws;
  ws.addEventListener('message', (e) => { if (sock.ws === ws) message(e.data); });
  ws.addEventListener('close', () => closed(ws));
}
// A socket closed for any reason but `closed` reconnects after 1 s, then 2, 4, up to 10 s.
export function retry(): void {
  const ms = Math.min(10000, 1000 * 2 ** Math.min(sock.tries, 4));
  sock.tries += 1;
  setTimeout(connect, ms);
}
export function closed(ws: WebSocket): void {
  if (sock.ws !== ws) return;
  sock.ws = null;
  sock.live = false;
  presence.shared.seen.sels = []; // others' selections are stale while down (kit-663)
  placeOthers();
  if (sock.pumpTimer !== null) { clearTimeout(sock.pumpTimer!); sock.pumpTimer = null; }
  if (!sock.ended) { sock.down = true; retry(); }
  showBanner();
  syncBody();
}
export function send(m: Json): boolean {
  if (!sock.ws) return false;
  try { sock.ws.send(JSON.stringify(m)); return true; } catch { return false; }
}
// Send what waits, in order, at most RATE edits in any second; a seq is given when an edit is first
// sent, and an edit resent keeps it.
export function pump(): void {
  if (sock.pumpTimer !== null || !sock.ws || !sock.live || sock.fetching) return;
  while (sock.cursor < state.pending.length) {
    const now = performance.now();
    while (sock.sentAt.length && now - sock.sentAt[0] >= 1000) sock.sentAt.shift();
    if (sock.sentAt.length >= RATE) {
      sock.pumpTimer = setTimeout(() => { sock.pumpTimer = null; pump(); }, 1001 - (now - sock.sentAt[0]));
      return;
    }
    const e = state.pending[sock.cursor];
    // a drag's throttle: this edit, and everything behind it, waits until its notBefore
    if (e.notBefore > now) {
      sock.pumpTimer = setTimeout(() => { sock.pumpTimer = null; pump(); }, Math.ceil(e.notBefore - now));
      return;
    }
    if (e.seq === null) e.seq = ++sock.seq;
    if (!send({ t: 'edit', client: shared.CLIENT, seq: e.seq, ops: e.ops })) return;
    sock.sentAt.push(now);
    sock.cursor += 1;
  }
}
// Drop the pending edits `drop` picks, keeping the cursor on the same next edit.
export function dropPending(drop: (e: Json) => boolean): void {
  const keep: Json[] = [];
  let before = 0;
  state.pending.forEach((e, i) => { if (!drop(e)) keep.push(e); else if (i < sock.cursor) before += 1; });
  state.pending = keep;
  sock.cursor -= before;
}

export function message(data: Json): void {
  let m: Json;
  try { m = JSON.parse(data); } catch { return; }
  if (!isObj(m) || typeof m.t !== 'string' || !state.base) return;
  if (m.t === 'welcome') welcome(m);
  else if (m.t === 'ops') { if (Number.isSafeInteger(m.rev)) { markEdit(m); m.via = sock.session; ops(m); } }
  else if (m.t === 'selections') takeSelections(m);
  else if (m.t === 'refused') refused(m);
  else if (m.t === 'saved') { if (Number.isSafeInteger(m.rev)) saved(m); }
  else if (m.t === 'ping') send({ t: 'pong' });
  else if (m.t === 'paused') { state.paused = true; showBanner(); }
  else if (m.t === 'resumed') { state.paused = false; showBanner(); }
  else if (m.t === 'closed') lock('closed', m.why === 'landed' ? BANNER.landed : BANNER.removed);
  else if (m.t === 'reload') {
    // the document replaced whole, a new session on this socket: the frames held from before it are
    // the old session's (their acks no longer count, so those edits stay pending and are resent), and
    // the document is fetched again; a fetch already running is superseded (its answer thrown away)
    if (typeof m.session !== 'string') return;
    sock.session = m.session;
    sock.held = [];
    sock.epoch += 1;
    refetch();
  }
  // any other kind is ignored
}
// welcome: on the session loaded and at base's rev, send again what was sent and not acked, then the
// rest; on any other (a new session, a rev below the highest seen, or edits made while away, which the
// socket doesn't replay), fetch the document first (the fetch then resends kept on a new session).
export function welcome(m: Json): void {
  presence.shared.seen.you = isObj(m.you) && typeof m.you.id === 'string' ? m.you.id : null; // kit-663
  sock.session = m.session;
  if (m.session === state.session && Number.isSafeInteger(m.rev) && m.rev < sock.highest) {
    sock.lowered = true;
    sock.held = []; // their revs are gone
  }
  if (Number.isSafeInteger(m.rev)) sock.highest = Math.max(sock.highest, m.rev);
  sock.live = true;
  sock.down = false;
  sock.tries = 0;
  sock.cursor = 0;
  showBanner();
  syncBody();
  if (!sock.stale && !sock.lowered && m.session === state.session && m.rev === state.base.rev) pump();
  else refetch();
  sock.lastSelect = null; // a new socket: the selection is sent again (when it isn't empty)
  queueSelect();
}
// ops: applied to base when it is the next rev (dropped at or below base's rev; one missed fetches
// the document); this page's own ack drops that edit, and any earlier one, from pending.
export function ops(m: Json): void {
  if (sock.fetching) { sock.held.push(m); return; }
  takeOps(m);
  redraw();
  pump();
}
export function takeOps(m: Json): void {
  if (m.rev > state.base.rev + 1) { sock.held.push(m); refetch(); return; }
  if (m.via === sock.session) sock.highest = Math.max(sock.highest, m.rev);
  if (m.rev === state.base.rev + 1) {
    applyOps(state.base, m.ops);
    state.base.rev = m.rev;
  }
  const ack = m.ack;
  if (isObj(ack) && ack.client === shared.CLIENT && Number.isSafeInteger(ack.seq)) {
    const acked: Json[] = [];
    dropPending((e) => { const hit = e.seq !== null && e.seq <= ack.seq; if (hit) acked.push(e); return hit; });
    // an ack held through a fetch can come after the saved that covers it: that edit is on disk already
    const onDisk = state.savedOn === m.via && state.saved !== null && state.saved >= m.rev;
    for (const e of acked) { e.rev = m.rev; e.session = m.via; if (!onDisk) state.kept.push(e); }
    if (state.kept.length > KEPT_MAX) {
      state.kept.splice(0, state.kept.length - KEPT_MAX);
      say(shared.SAY.notSaved);
    }
    if (state.pending.length === 0) queueSelect(); // a waiting select may go now
  }
}
// saved: the socket's session's kept edits at or below its rev are on disk; another session's stay.
export function saved(m: Json): void {
  state.saved = m.rev;
  state.savedOn = sock.session;
  state.kept = state.kept.filter((e) => e.session !== sock.session || e.rev > m.rev);
  syncBody();
}
// A refused edit's undo entry goes with it (kit-668 §3); a drag's edit refused before the drag ends
// keeps the drag from pushing one (dropped).
export function dropEntryOf(item: Json): void {
  item.dropped = true;
  const i = item.entry ? history.shared.undos.indexOf(item.entry) : -1;
  if (i >= 0) history.shared.undos.splice(i, 1);
}
// refused, for this page: that edit dropped (from pending, or kept should a resent one be refused) and
// why said in plain words; then the document fetched again (canvas@1 §5), the other pending edits
// drawn over it and sent after it.
export function refused(m: Json): void {
  if (m.client !== shared.CLIENT || !Number.isSafeInteger(m.seq)) return;
  const gone: Json[] = [];
  dropPending((e) => { const hit = e.seq === m.seq; if (hit) gone.push(e); return hit; });
  state.kept = state.kept.filter((e) => { const hit = e.seq === m.seq; if (hit) gone.push(e); return !hit; });
  for (const e of gone) dropEntryOf(e);
  const why = typeof m.why === 'string' && own(shared.REFUSED, m.why) ? m.why : null;
  say(why === null ? NOT_VALID : shared.REFUSED[why]);
  if (why === 'view') lock('view');
  redraw();
  refetch();
  if (state.pending.length === 0) queueSelect(); // a waiting select may go now
}
export const bySeq = (a: Json, b: Json): number => a.seq - b.seq;
// The document fetched again as base (its session too); the ops held meanwhile applied after it, in
// order, those above its rev. A fetch that fails closes the socket, and the next welcome fetches. When
// the fetched session isn't the one base had (a restart or a replace), or a welcome came at a lower
// rev, kept goes back in front of pending, in seq order; pending is then sent from the start either way
// (a same-session resend is re-acked). A fetch a reload came during is thrown away, failed or not, and
// asked again at once.
export async function refetch(): Promise<void> {
  if (sock.fetching) { sock.again = true; return; }
  sock.fetching = true;
  sock.again = false;
  const epoch = sock.epoch;
  const before = state.session;
  let b: Json = null;
  try {
    const res = await fetch(`/api/canvas/doc?slug=${encodeURIComponent(state.slug!)}`, { credentials: 'same-origin', cache: 'no-store' });
    if (res.status === 200) {
      const j = await res.json();
      if (frameOk(j)) b = j;
    }
  } catch { b = null; }
  sock.fetching = false;
  if (epoch !== sock.epoch) { refetch(); return; }
  if (b === null) {
    sock.held = [];
    sock.stale = true;
    if (sock.ws) sock.ws.close();
    return;
  }
  sock.stale = false;
  takeDoc(b);
  if (state.session !== before || sock.lowered) {
    sock.resendSelect = true; // kit-663 §6 (kit-669 F2): the server's selections may have lost ours
    state.pending = [...state.kept.sort(bySeq), ...state.pending];
    state.kept = [];
    sock.lowered = false;
    sock.highest = state.base.rev;
  }
  sock.cursor = 0;
  // frames of another session than the one fetched are dropped: their acks don't count there
  for (const m of sock.held.splice(0)) {
    if (m.via !== state.session) continue;
    if (sock.fetching) sock.held.push(m); else takeOps(m);
  }
  if (sock.again && !sock.fetching) refetch();
  redraw();
  pump();
  // kit-663 §6 (kit-669 F2): redraw's selectIds has queued the selection, which goes once the re-sent
  // edits are acked, even when it equals the last one sent (resendSelect, set above)
}
