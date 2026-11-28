// apps-src@1 threads-core: the thread layer's rules, index.html's threads-core block (I:9715-10085 at 0dd991bb)
// moved statement for statement, in its order, with its comments. Its only changes are `export ` before each
// top-level declaration, the types, and the reads of other views' state through their objects:
// threadsCoreState.<name> for the 11 names views/threads-core/state.ts holds, threadsPanelState.TL,
// peeksState.DRAWER (peeks reassigns it) and autonomyState.GOV. Pure: no import but one type, nothing run at
// load but the block's own values (TextEncoder, RegExp, String.raw), compiled to lib-dist/lib/threads-core-rules.js
// for the kit's tests. views/threads-core/wire.ts wires it once; the tests wire threadsCoreState alone, and then
// it acts as the block did loaded by itself (no TL, govBlockAt, who, tNoteState or avRecipient).
import type { threadsCoreState as ThreadsCoreState } from '../views/threads-core/state';

// The page's script is untyped JavaScript; a value read off the log or another view is any, as data's modules type it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

// The block calls Object.hasOwn (ES2022), which every browser the dashboard supports has; the lib's ES2020 types
// lack it, so it is declared here, as a type only.
declare global {
  interface ObjectConstructor { hasOwn(o: object, k: PropertyKey): boolean; }
}

export type ThreadsCoreWire = {
  threadsCoreState: typeof ThreadsCoreState;
  threadsPanelState: Loose;
  peeksState: Loose;
  autonomyState: Loose;
  govBlockAt: Loose;
  who: Loose;
  tNoteState: Loose;
  avRecipient: Loose;
};

// Unwired, every state object is empty and every function undefined: the block's "loaded by itself". State is
// typed Loose here (ThreadsCoreWire types what is passed in): the block indexes its maps with any key.
let threadsCoreState: Loose = {};
let threadsPanelState: Loose = {};
let peeksState: Loose = {};
let autonomyState: Loose = {};
let govBlockAt: Loose, who: Loose, tNoteState: Loose, avRecipient: Loose;

/** Sets each given binding (even to undefined); a key left out keeps its value; any other key throws. */
export function wireThreadsCore(w: Partial<ThreadsCoreWire>): void {
  for (const k of Object.keys(w) as (keyof ThreadsCoreWire)[]) {
    const v = w[k];
    switch (k) {
      case 'threadsCoreState': threadsCoreState = v; break;
      case 'threadsPanelState': threadsPanelState = v; break;
      case 'peeksState': peeksState = v; break;
      case 'autonomyState': autonomyState = v; break;
      case 'govBlockAt': govBlockAt = v; break;
      case 'who': who = v; break;
      case 'tNoteState': tNoteState = v; break;
      case 'avRecipient': avRecipient = v; break;
      default: throw new Error(`threads-core: ${k as string} is not a wire key`);
    }
  }
}

// The thread layer's rules, apart from the page: what the pointer is on, what a subject records and
// how big it is, where a card opens and what its state line says, the pins and the dock's words.
// The kit's test loads this block by itself.
// What the page can point at: the kit's SUBJECT_TYPES (a test holds the two lists equal).
// T_TYPES: threadsCoreState's (views/threads-core/state.ts), read as threadsCoreState.T_TYPES
// The kit's SUBJECT_REF, the same way (a test holds the two equal): the page never sends a ref the log refuses.
// T_REF_MAX: the kit's SUBJECT_CAPS.ref, in bytes; the pattern alone lets a long kind's ref past it.
// T_REF, T_REF_MAX: threadsCoreState's (views/threads-core/state.ts), read as threadsCoreState.T_REF …
// What each kind is called where an item has no name of its own (the owner never reads a ref).
// T_KIND: threadsCoreState's (views/threads-core/state.ts), read as threadsCoreState.T_KIND
// Where each kind of item lives: an item drawn in two places (an observation also in the Sensors
// feed, a question in a Decide row) is pinned in its home section. A question's, 'inbox', is the
// Threads panel's Inbox tab (#th-inbox #questions, kit-100 spec §2.6), not a page's section.
// T_HOME: threadsCoreState's (views/threads-core/state.ts), read as threadsCoreState.T_HOME
// The sections' names, as the sidebar shows them.
// T_SECTIONS: threadsCoreState's (views/threads-core/state.ts), read as threadsCoreState.T_SECTIONS
// T_ENCODED_MAX: a turn as the log line holds it, JSON-escaped (a quotation mark is two bytes there,
// a control character six), so a line of 4,096 bytes always has room for it.
export const T_SUBJECT_MAX = 2500, T_WAIT_MS = 10 * 60000;
export const T_ENC = new TextEncoder();
// Sizes are the log's, in bytes of UTF-8: a CJK character is three, an emoji four.
export const tBytes = (s: Loose) => T_ENC.encode(String(s ?? '')).length;
export const tCut = (s: Loose, n: Loose) => { let o = '', b = 0; for (const c of String(s ?? '')) { const k = T_ENC.encode(c).length; if (b + k > n) break; o += c; b += k; } return o; };
// One line of plain text, at most n UTF-16 units (what the log's schema counts), never half a pair.
// What a terminal or a reader's eye acts on (a control, a bidi override): the kit's UNSAFE_TEXT, held
// equal by a test. Only ever used to replace (it is global).
export const T_UNSAFE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
export const tLine = (s: Loose, n: Loose) => { const x = String(s ?? '').replace(T_UNSAFE, ' ').replace(/\s+/g, ' ').trim(); const c = x.slice(0, n); return /[\ud800-\udbff]$/.test(c) ? c.slice(0, -1) : c; };
// A Settings row's view (#settings?key=<key>): its key, else null.
export const T_SETTING_VIEW = /^#settings\?key=([a-z][a-z0-9_]{0,63})$/;
export const parseSettingView = (view: Loose) => T_SETTING_VIEW.exec(typeof view === 'string' ? view : '')?.[1] ?? null;
// A suggestion on Efficiency (kit-174) or Awareness (kit-93): #<page>?suggestion=<its id, URI-encoded>;
// its id, else null (the longer prefix is 23 bytes: an encoded id of at most 177 keeps the view within
// the log's 200); its page is suggPageOf's
// T_SUGG_VIEW: threadsCoreState's (views/threads-core/state.ts), read as threadsCoreState.T_SUGG_VIEW
export const suggView = (id: Loose, page = 'efficiency') => `#${page}?suggestion=${encodeURIComponent(String(id))}`;
export const parseSuggView = (view: Loose) => { const m = threadsCoreState.T_SUGG_VIEW.exec(typeof view === 'string' ? view : ''); if (!m) return null; try { return decodeURIComponent(m[2]); } catch { return null; } };
// What a point is on: the nearest item the dashboard drew (data-subject, a ref the log takes), else
// a spot in its section, as fractions of the section's box. sec(el) gives the section: { el, view,
// box, heading }. An item's quote is its name and its heading, not every word in it (the buttons'
// labels are no part of what the owner pointed at); its whole text only when it has neither.
export function tSubjectAt(el: Loose, x: Loose, y: Loose, sec: Loose) {
  const item = el?.closest?.('[data-subject]');
  const ref = item?.dataset?.subject ?? '';
  if (item && threadsCoreState.T_REF.test(ref) && tBytes(ref) <= threadsCoreState.T_REF_MAX) {
    const title = tLine(item.dataset.title, threadsCoreState.T_TITLE_MAX);
    const head = tLine(item.querySelector?.('h4, .t, b')?.textContent, 300);
    const said = [title, head && head !== title ? head : ''].filter(Boolean).join(' · ') || tLine(item.innerText ?? item.textContent, 2000);
    return { subject: { kind: 'item', ref, quote: tCut(said, 300) }, title: title || threadsCoreState.T_KIND[ref.split(':')[0]], el: item };
  }
  // a suggestion on Efficiency (kit-174) or Awareness (kit-93): its page subject, the item its spot,
  // its title the quote
  const sg = el?.closest?.('#efficiency [data-sugg], #awareness [data-sugg]');
  if (sg) {
    const title = tLine(sg.dataset.title, threadsCoreState.T_TITLE_MAX);
    return { subject: { kind: 'page', view: suggView(sg.dataset.sugg, sg.closest('section[id]').id), quote: tCut(title, 300) }, title, el: sg };
  }
  // a Settings row (spec §8): a page subject on #settings?key=<key>, the row (not a point) its spot,
  // its plain name the quote
  const row = el?.closest?.('[data-setting]');
  const key = row?.dataset?.setting ?? '';
  if (row && parseSettingView(`#settings?key=${key}`)) {
    const name = tLine(row.querySelector?.('.set-name')?.textContent, 300) || key;
    return { subject: { kind: 'page', view: `#settings?key=${key}`, quote: tCut(name, 300) }, title: tLine(`Setting · ${name} (${key})`, threadsCoreState.T_TITLE_MAX), el: row };
  }
  // a block of a governance file's rendered text, in its peek (kit-93 C5, C8): a page subject on the file (on
  // #governance when that view is over the log's 200 bytes), the block its spot, its text the quote
  // threads-core is also evaluated alone by test/dashboard.test.mjs, without the governance code
  const block = typeof govBlockAt === 'function' ? govBlockAt(el) : null;
  if (block) {
    const path = peeksState.DRAWER.id, view = `#file?path=${encodeURIComponent(path)}`;
    const said = tLine(block.innerText ?? block.textContent, 300);
    const name = autonomyState.GOV.files.find((f: Loose) => f?.path === path)?.title || path;
    return { subject: { kind: 'page', view: tBytes(view) <= threadsCoreState.T_CAPS.view ? view : '#governance', quote: tCut(said, 300) }, title: tLine(`${name} · ${said.split(' ').slice(0, 6).join(' ')}`, threadsCoreState.T_TITLE_MAX), el: block };
  }
  const s = sec(el);
  if (!s) return null;
  const f = (n: Loose, a: Loose, w: Loose) => (w ? Math.min(1, Math.max(0, Math.round(((n - a) / w) * 1000) / 1000)) : 0);
  return { subject: { kind: 'page', view: s.view, at: { x: f(x, s.box.left, s.box.width), y: f(y, s.box.top, s.box.height) }, quote: tCut(tLine(s.heading, 300), 300) }, title: tLine(`the dashboard · ${s.heading || s.view}`, threadsCoreState.T_TITLE_MAX), el: s.el };
}
// What the log takes of a capture: each kind's keys (the kit's SUBJECT_KEYS) and each string's cap in
// bytes (SUBJECT_CAPS, ANCHOR_CAPS: a test holds the three equal to the kit's).
// T_CAPS: threadsCoreState's (views/threads-core/state.ts), read as threadsCoreState.T_CAPS
export const T_ANCHOR_CAPS: Loose = { selector: 200, tag: 40, role: 40, text: 80, name: 80, html: 1024 };
export const T_SUBJECT_KEYS: Loose = { item: ['ref', 'quote'], page: ['view', 'at', 'quote'], artifact: ['slug', 'at', 'fp', 'path', 'anchor', 'point'], preview: ['name', 'route', 'viewport', 'anchor', 'point', 'errors'] };
export const T_ERRORS = 3, T_ERROR_MAX = 200, T_AT_MAX = 100;
// A box's capability (the kit's BOX_CAPABILITY and its _TAIL, held equal by a test), cut from every
// string before a cap is, so a cap never leaves half of one that the kit could no longer tell.
export const T_CAP_SLASH = String.raw`(?:\\{0,8}\/|%(?:25){0,4}2f|\\{0,8}u002f|&#(?:x0{0,4}2f|0{0,4}47);)`;
export const T_CAP_DOT = String.raw`(?:\.|%(?:25){0,4}2e|\\{0,8}u002e|&#(?:x0{0,4}2e|0{0,4}46);)`;
export const T_BOX_CAPABILITY = new RegExp(`${T_CAP_SLASH}c${T_CAP_SLASH}\\d{1,15}${T_CAP_DOT}[\\w-]{16}${T_CAP_DOT}[\\w-]{22}`, 'gi');
export const T_BOX_CAPABILITY_TAIL = new RegExp(`${T_CAP_SLASH}c${T_CAP_SLASH}\\d{13,15}${T_CAP_DOT}(?:[\\w-]{0,15}|[\\w-]{16}(?:${T_CAP_DOT}[\\w-]{0,21})?)\u2026?$`, 'i');
export const tUncap = (v: Loose) => String(v).replace(T_BOX_CAPABILITY, '[link removed]').replace(T_BOX_CAPABILITY_TAIL, '[link removed]');
// Names the log matches whole (a ref, a section, a slug, a version, a fingerprint, a preview): one
// over its cap is dropped, not cut, so the kit refuses the subject rather than point somewhere else.
export const T_WHOLE = ['ref', 'view', 'slug', 'at', 'fp', 'name'];
// What gives, in order, while a subject is over the log's 2,500 bytes encoded.
export const T_SHRINK = [['anchor', 'html'], ['errors'], ['quote'], ['route'], ['path'], ['anchor', 'selector'], ['anchor', 'text'], ['anchor', 'name'], ['anchor', 'role'], ['anchor', 'tag']];
// A box of numbers (a rect, a point, a viewport), only when every one is a finite number, in whole
// pixels unless it is a page's fractions; else null.
export const tBox = (v: Loose, keys: Loose, round = true) => (v && typeof v === 'object' && keys.every((k: Loose) => typeof v[k] === 'number' && Number.isFinite(v[k]) && ((k !== 'w' && k !== 'h') || v[k] >= 0)) ? Object.fromEntries(keys.map((k: Loose) => [k, round ? Math.round(v[k]) : v[k]])) : null);
// An anchor as a lens described it: the kit's keys only, each cut to its cap, its rect and point
// only when whole; null when there is nothing of one. Its words (all but the element's HTML) drop
// what T_UNSAFE matches, as the kit refuses them: a bidi override would have the owner's card read
// the page's words reversed. Dropped before the capability is cut, so none can hide one in two.
export function tAnchor(a: Loose) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  const x: Loose = {};
  for (const k of Object.keys(T_ANCHOR_CAPS)) if (typeof a[k] === 'string') x[k] = tCut(tUncap(k === 'html' ? a[k] : a[k].replace(T_UNSAFE, '')), T_ANCHOR_CAPS[k]);
  const rect = tBox(a.rect, ['x', 'y', 'w', 'h']);
  if (rect) x.rect = rect;
  const point = tBox(a.point, ['x', 'y']);
  if (point) x.point = point;
  return Object.keys(x).length ? x : null;
}
// A subject as the log takes it, before it is sent: only its kind's keys, each field cut of any
// capability and to its own cap (a lens's capture is the framed page's, so nothing in it is trusted
// to be small), then the whole to the log's 2,500 bytes, T_SHRINK's fields giving in turn: an
// element's HTML first, then console errors, the quote, the route, the path, the anchor's words.
export function tFit(s: Loose) {
  const keys = s && Object.hasOwn(T_SUBJECT_KEYS, s.kind) ? T_SUBJECT_KEYS[s.kind] : null;
  if (!keys) return null;
  const x: Loose = { kind: s.kind };
  for (const k of keys) {
    const v = s[k];
    if (v === undefined || v === null) continue;
    if (k === 'anchor') { const a = tAnchor(v); if (a) x.anchor = a; }
    else if (k === 'point') { const p = tBox(v, ['x', 'y']); if (p) x.point = p; }
    else if (k === 'viewport') { const p = tBox(v, ['w', 'h']); if (p) x.viewport = p; }
    else if (k === 'at' && s.kind === 'page') { const p = tBox(v, ['x', 'y'], false); if (p) x.at = p; }
    else if (k === 'errors') { if (Array.isArray(v)) x.errors = v.filter((e) => typeof e === 'string').slice(-T_ERRORS).map((e) => tCut(tUncap(e.replace(T_UNSAFE, '')), T_ERROR_MAX)); }
    else if (typeof v !== 'string') continue;
    else if (T_WHOLE.includes(k)) { if (tBytes(v) <= (k === 'at' ? T_AT_MAX : threadsCoreState.T_CAPS[k])) x[k] = v; }
    // a preview's route is its app's say-so, as an anchor's words are: no control or bidi character
    else x[k] = tCut(tUncap(k === 'route' ? v.replace(T_UNSAFE, '') : v), threadsCoreState.T_CAPS[k]);
  }
  const size = () => tBytes(JSON.stringify(x));
  for (let i = 0; i < 100 && size() > T_SUBJECT_MAX; i++) {
    const over = size() - T_SUBJECT_MAX;
    const f = T_SHRINK.find(([a, b]) => (b ? x[a]?.[b] : x[a]?.length));
    if (!f) break;
    if (f[0] === 'errors') { x.errors.pop(); continue; }
    const [o, k] = f[1] ? [x[f[0]], f[1]] : [x, f[0]];
    o[k] = tCut(o[k], Math.max(0, tBytes(o[k]) - over));
    if (!o[k]) delete o[k];
  }
  if (x.anchor && !Object.keys(x.anchor).length) delete x.anchor;
  return x;
}
// The line under the turns: nothing once the supervisor has the last word (its reply is the state).
// Else: "Sent." when the POST that sent it said a pane took it; "Not delivered" when no terminal took
// it (sup: /api/threads' record of such turns and the supervisor's last check, as tlRefresh keeps
// it); "will read it when it next checks" when nobody knows (a reload); after 10 minutes with the
// supervisor running (a pane, as /api/threads says), that it hasn't replied. A session that has the
// newest owner turn (working: /api/threads' records, as tlRefresh keeps them) says it picked it up or
// is responding, even after its own first reply, and over held or not delivered for that turn.
export function tCardState(t: Loose, now: Loose, typed: Loose, pane: Loose, sup = typeof threadsPanelState.TL !== 'undefined' ? threadsPanelState.TL.sup ?? null : null, working = typeof threadsPanelState.TL !== 'undefined' ? threadsPanelState.TL.working ?? null : null) {
  const turns = t.turns;
  const last = turns[turns.length - 1];
  if (!last) return null;
  // a record counts only for the newest owner turn, and only while every turn after it is a non-owner
  // one written before the record began; the view names every non-owner turn supervisor, so this
  // compares times, not writers. A record for an older turn never speaks for a newer one.
  const w = working && typeof working === 'object' && Object.hasOwn(working, t.id) ? working[t.id] : null;
  const o = turns.findLastIndex((x: Loose) => x.by === 'owner');
  const wAt = Date.parse(w?.at ?? '');
  const has = !!w && (w.stage === 'picked-up' || w.stage === 'responding') && o >= 0 && !!turns[o].id && w.turn === turns[o].id
    && turns.slice(o + 1).every((x: Loose) => x.by !== 'owner' && Date.parse(x.at) < wAt);
  // an artifact note (kit-148): by kit-145's state; the page's other threads are as ever (two tests load threads-core alone)
  const art = t.subject?.kind === 'artifact' && typeof tNoteState === 'function' && typeof avRecipient === 'function';
  const ns = art ? tNoteState(t) : null;
  if (art && !last.pending && !has) {
    if (ns === 'check') return null;
    if (ns === 'with') {
      const to = t.with ?? t.handed?.to;
      const from = Date.parse(t.handed?.at ?? '');
      // the supervisor's own turn after the hand-over (writer, else any non-owner turn: the view names them all supervisor)
      const replied = turns.some((x: Loose) => x.by !== 'owner' && Date.parse(x.at) > from && (x.writer ? x.writer === 'supervisor' : true));
      if (to === 'supervisor' && !replied && now - from > T_WAIT_MS) return "The supervisor hasn't replied yet.";
      return `With ${to}.`;
    }
  }
  if (last.by !== 'owner' && !has) return null;
  if (last.pending) return 'Sending…';
  if (has) {
    // plain words for who: ticket ids have no fixed shape, so any other name is a session on it
    const b = w.by;
    const plan = typeof b === 'string' ? /^plan-(.+)$/.exec(b) : null;
    const named = typeof b === 'string' && b && !plan && typeof who === 'function' ? who(b) : '';
    const who2 = typeof b !== 'string' || !b ? 'A session' : b === 'supervisor' ? 'The supervisor' : b === 'responder' ? 'The responder' : plan ? `The planner for ${plan[1]}` : named && named !== b ? `${named.charAt(0).toUpperCase()}${named.slice(1)}` : `The session on ${b}`;
    return w.stage === 'responding' ? `${who2} is responding…` : `${who2} picked it up.`;
  }
  // an open note whose newest words are the owner's and nobody's yet (kit-144): they wait for Hand over
  if (art && ns === 'open' && last.by === 'owner' && (last.routed_to ?? 'supervisor') === 'supervisor') return `Not handed over yet. Hand over sends it to ${avRecipient(t.subject.at).replace(/^supervisor$/, 'the supervisor')}.`;
  // a turn routed to the responder (kit-104): the landed turn's route says so (a turn in the log is
  // the server's record's to say), else the page's own send; the responder's hold or failed typing
  // stays late until a reply. Never "Not delivered" nor the supervisor's hold for it.
  const landed = /^u-/.test(last.id ?? '');
  // a turn routed to a session (kit-109): the landed turn's route names it, else the page's own send
  // ({ session, who }, from the send's words); the card names that session, never the supervisor, and
  // never says "Not delivered" for it (its turn is never in the undelivered list)
  const sName = (x: Loose) => { const n = typeof who === 'function' ? who(x) : ''; return n && n !== x ? n : /^plan-/.test(x) ? `the planner for ${x.slice(5)}` : `the agent on ${x}`; };
  const mine = typed && typeof typed === 'object' && typeof typed.session === 'string' && typeof typed.who === 'string' ? typed : null;
  const sess = landed ? (last.routed_to === 'session' && typeof last.routed_session === 'string' ? { who: sName(last.routed_session), state: mine?.session ?? null } : null) : mine ? { who: mine.who, state: mine.session } : null;
  if (sess) {
    const s = sess.who;
    if (now - Date.parse(last.at) > T_WAIT_MS) return `${s.charAt(0).toUpperCase()}${s.slice(1)} hasn't replied yet; the supervisor has been told.`;
    if (sess.state === 'held') return `Held: ${s}'s terminal is asking something, and these words must not answer it. They reach it once it is answered.`;
    if (sess.state === 'missed') return `Still with ${s}: its terminal didn't take it, and the supervisor is told if there's no reply in 5 minutes.`;
    return sess.state === 'typed' ? `Sent to ${s}.` : `Sent to ${s}; it replies here.`;
  }
  const r = landed ? (last.routed_to === 'responder' ? (typed === 'responder-late' ? 'responder-late' : last.delivered === 'queued' ? 'queued' : 'responder') : null)
    : typed === 'responder' || typed === 'queued' || typed === 'responder-late' ? typed : null;
  if (r) {
    if (now - Date.parse(last.at) > T_WAIT_MS) return "The responder hasn't replied yet.";
    if (r === 'responder-late') return "The responder hasn't taken it yet; the supervisor takes it if it waits 3 minutes.";
    return r === 'queued' ? 'The responder is busy; it takes this next.' : 'Sent to the responder.';
  }
  // its terminal is asking a question: these words wait, and are never the answer to it
  if (typed === 'held' && pane) return "Held: the supervisor's terminal is asking something, and these words must not answer it. They reach the supervisor once it is answered (see the card).";
  // missed: a turn in the log is the server's record's to say (typed is the thread's last send, and
  // can be stale); the page's own turn, before a read has it, is its send's. Never "no pane now".
  const missed = sup && /^u-/.test(last.id ?? '') ? !!sup.undelivered?.includes(last.id) : typed === false;
  if (missed) {
    const at = Date.parse(sup?.checked ?? '');
    const m = Math.max(0, Math.round((now - at) / 60000));
    const ago = m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
    if (at > Date.parse(last.at)) return `Not delivered: no supervisor terminal took it. The supervisor has checked since (${ago}) but hasn't replied yet.`;
    return `Not delivered: no supervisor terminal took it. The supervisor sees it only when it next checks; ${at > 0 ? `it last checked ${ago}` : 'it has not checked yet'}.`;
  }
  if (now - Date.parse(last.at) > T_WAIT_MS) return pane ? "The supervisor hasn't replied yet." : 'Sent; the supervisor will read it when it next checks.';
  return typed === true ? 'Sent.' : 'Sent; the supervisor will read it when it next checks.';
}
// Where a card opens: beside its pin (r, the pin's or subject's box), on whichever side keeps it on
// screen, its top kept inside the window; a bottom sheet under 640 px.
export function tPlace(r: Loose, w: Loose, h: Loose, vw: Loose, vh: Loose) {
  if (vw < 640) return { sheet: true };
  const gap = 10;
  const left = r.right + gap + w <= vw - 8 ? r.right + gap : Math.max(8, r.left - gap - w);
  const top = Math.min(Math.max(8, r.top), Math.max(8, vh - h - 8));
  return { sheet: false, left: Math.round(left), top: Math.round(top) };
}
export const T_WHERE: Loose = { goal: 'Goals', question: 'Inbox', ticket: 'Board', planner: 'Board', observation: 'Loop, Observe', problem: 'Loop, Orient', lesson: 'Loop, Orient', decision: 'Loop, Decide', act: 'Loop, Act', preview: 'Library', artifact: 'Library', suggestion: 'Trust' };
// Where a thread's subject is, in the dock's words.
export function tWhere(s: Loose) {
  if (!s) return 'no subject';
  // own keys only: a subject's ref or view is page-written, and "constructor" is on every object
  if (s.kind === 'item') { const k = String(s.ref).split(':')[0]; return Object.hasOwn(T_WHERE, k) ? T_WHERE[k] : 'the dashboard'; }
  // a Settings row: by the name it had when the thread began (the subject's quote), else its key
  if (s.kind === 'page' && parseSuggView(s.view) !== null) return threadsCoreState.T_SECTIONS[threadsCoreState.T_SUGG_VIEW.exec(s.view)[1]];
  if (s.kind === 'page' && parseSettingView(s.view)) return `Settings, ${tLine(s.quote, 300) || parseSettingView(s.view)}`;
  if (s.kind === 'page') { const [sec, tab] = String(s.view).slice(1).split('/'); return Object.hasOwn(threadsCoreState.T_SECTIONS, sec) ? `${threadsCoreState.T_SECTIONS[sec]}${tab ? `, ${tab.charAt(0).toUpperCase()}${tab.slice(1)}` : ''}` : 'the dashboard'; }
  if (s.kind === 'artifact') return s.slug;
  if (s.kind === 'preview') return `${s.name}${s.route ? ` ${s.route}` : ''}`;
  return 'no subject';
}
// A spot in a framed page, for its key: its anchor as the lens named it, else the point.
export const tFrameSpot = (s: Loose) => (s.anchor?.node !== undefined ? `node:${s.anchor.node}` : s.anchor ? `${s.anchor.selector ?? ''}|${s.anchor.text ?? ''}` : `${s.point?.x},${s.point?.y}`);
export const tKey = (s: Loose) => (!s ? null : s.kind === 'item' ? `item:${s.ref}` : s.kind === 'page' ? `page:${s.view}:${s.at?.x}:${s.at?.y}` : s.kind === 'artifact' ? `artifact:${s.slug}:${s.path ?? 'index.html'}:${tFrameSpot(s)}` : s.kind === 'preview' ? `preview:${s.name}:${s.route ?? ''}:${tFrameSpot(s)}` : null);
// One pin per subject, for open threads: numbered as the dock numbers them (by when each began), with
// every thread on it, oldest first.
export function tPins(threads: Loose) {
  const open = threads.filter((t: Loose) => t.status === 'open').sort((a: Loose, b: Loose) => a.created_at.localeCompare(b.created_at));
  const by = new Map();
  open.forEach((t: Loose, i: Loose) => { const k = tKey(t.subject); if (!k) return; const g = by.get(k) ?? { key: k, subject: t.subject, n: i + 1, ids: [] }; g.ids.push(t.id); by.set(k, g); });
  return [...by.values()];
}
// The owner's turn, shown before the server has it, shaped as threadView gives one; a thread the
// owner is starting likewise. Neither counts as seen or unread: a pending turn's clock is the page's.
// files: those sent with it (kit-171), as threadView gives a turn's.
export const tPendingTurn = (text: Loose, at: Loose, files: Loose) => ({ id: null, by: 'owner', at, text, refs: [], question: null, pending: true, files: files ?? [] });
export const tPendingThread = (id: Loose, title: Loose, subject: Loose, turn: Loose) => ({ id, title, subject: subject || null, status: 'open', outcome: null, ready: null, turns: [turn], questions: [], waiting: subject?.kind === 'artifact' ? 'owner' : 'supervisor', created_at: turn.at, resolved_at: null, activity_at: turn.at, first_reply_ms: null, pending: true, ...(subject?.kind === 'artifact' ? { check: null, handed: null } : {}) });
// The threads as the owner's presses will leave them: each pending send's turn on its thread (or
// its new thread), and a thread resolved or reopened, until the server's threads show it.
export function tOverlay(raw: Loose, pend: Loose) {
  let threads = raw.map((t: Loose) => ({ ...t, turns: [...t.turns] }));
  for (const p of pend) {
    const id = tPendId(p);
    const t = threads.find((x: Loose) => x.id === id);
    // whatever the owner says, resolves or reopens clears a standing proposal, as threadView has it
    // a note on an artifact is the owner's move again, nothing handed or to check standing (kit-148)
    const note = (x: Loose) => { x.ready = null; x.check = null; x.handed = null; delete x.with; x.waiting = 'owner'; };
    if (p.status) { if (t) { Object.assign(t, { status: p.status, ready: null }); if (t.subject?.kind === 'artifact') note(t); } continue; }
    if (t) { if (t.turns.filter((u: Loose) => u.by === 'owner' && u.text === p.turn.text).length <= p.had) { t.turns.push(p.turn); t.ready = null; if (t.subject?.kind === 'artifact') note(t); else t.waiting = 'supervisor'; } }
    else if (p.fresh) threads.push(tPendingThread(id, p.fresh.title, p.fresh.subject, p.turn));
  }
  return threads;
}
// Whether the server's threads show a press: its turn, one more than the thread had, or its status.
// a second Send on a thread still being started goes where the first one's went
export const tPendId = (p: Loose) => p.real ?? p.firstOf?.real ?? p.thread;
export function tLanded(raw: Loose, p: Loose) {
  const t = raw.find((x: Loose) => x.id === tPendId(p));
  if (!t) return false;
  return p.status ? t.status === p.status : t.turns.filter((u: Loose) => u.by === 'owner' && u.text === p.turn.text).length > p.had;
}
// A dot in the dock: the supervisor spoke after the owner last looked at the thread (this browser).
export const tUnread = (t: Loose, seenAt: Loose) => t.turns.some((u: Loose) => u.by === 'supervisor' && (!seenAt || u.at > seenAt));
// What a lens says (the artifact lens, the preview lens: spec §6, §7). Every message is the framed
// page's, so its code's, and trusted for nothing: kept only from the frame the page posted to
// (source), of a kind a lens says, a hit-reply only to an id this page minted for a real pointer
// event (minted), and rebuilt from that kind's fields, every string cut of a box's capability and
// to the kit's cap. It is shown as text and starts nothing until the owner writes.
export const T_LENS_SAYS = ['ready', 'route', 'hit-reply', 'rects', 'key', 'errors', 'nav'];
export function tLensMessage(e: Loose, frameWin: Loose, minted: Loose) {
  if (!frameWin || e.source !== frameWin) return null;
  const m = e.data;
  if (!m || typeof m !== 'object' || m.lens !== 1 || !T_LENS_SAYS.includes(m.type)) return null;
  // a path or a route: the page's words, without what would have the owner's eye read them otherwise
  const str = (v: Loose, n: Loose) => (typeof v === 'string' ? tCut(tUncap(v.replace(T_UNSAFE, '')), n) : null);
  // a page's #hash, the same way, and nothing unless it is one
  const hash = (v: Loose) => { const h = str(v, 200); return h && h[0] === '#' ? h : ''; };
  if (m.type === 'hit-reply') {
    if (typeof m.id !== 'string' || !minted.has(m.id)) return null;
    const anchor = tAnchor(m.anchor);
    return { type: 'hit-reply', id: m.id, anchor, rect: anchor?.rect ?? tBox(m.rect, ['x', 'y', 'w', 'h']), route: str(m.route, threadsCoreState.T_CAPS.route) };
  }
  // where watched anchors are now: null is "not found there"; a rect that is no box says nothing
  if (m.type === 'rects') return { type: 'rects', rects: (Array.isArray(m.rects) ? m.rects.slice(0, 200) : []).filter((r: Loose) => r && typeof r.key === 'string').flatMap((r: Loose) => { const rect = r.rect === null ? null : tBox(r.rect, ['x', 'y', 'w', 'h']); return r.rect === null || rect ? [{ key: r.key, rect, changed: r.changed === true }] : []; }) };
  // a keyup's key message is marked up (kit-141 design-change 1); the field is left out for a keydown's
  if (m.type === 'key') return { type: 'key', key: m.key === 'Escape' || m.key === 'ArrowLeft' || m.key === 'ArrowRight' ? m.key : 'Shift', shift: m.shift === true, ...(m.up === true ? { up: true } : {}) };
  // ready's hash only when the lens sent one (a page with none says what it said before kit-142)
  if (m.type === 'ready') return { type: 'ready', path: str(m.path, threadsCoreState.T_CAPS.path + 400), route: str(m.route, threadsCoreState.T_CAPS.route), title: typeof m.title === 'string' ? tLine(tUncap(m.title), 80) : '', viewport: tBox(m.viewport, ['w', 'h']), ...(typeof m.hash === 'string' ? { hash: hash(m.hash) } : {}) };
  // a move inside the page (a #hash, pushState): where it is now
  if (m.type === 'nav') return { type: 'nav', path: str(m.path, threadsCoreState.T_CAPS.path + 400), hash: hash(m.hash) };
  if (m.type === 'route') return { type: 'route', route: str(m.route, threadsCoreState.T_CAPS.route) };
  return { type: 'errors', errors: (Array.isArray(m.errors) ? m.errors : []).filter((x: Loose) => typeof x === 'string').slice(-T_ERRORS).map((x: Loose) => tCut(tUncap(x.replace(T_UNSAFE, '')), T_ERROR_MAX)) };
}
// Where a preview's lens may be told to go (go): a path of the app's own (origin: the lens's), never
// another site's, a scheme's, or the lens's own; null for anything else. A route is the log's, so the
// page's: its lens checks again, and this keeps a bad one from being sent at all.
export function tGoRoute(r: Loose, origin: Loose) {
  if (typeof r !== 'string' || r[0] !== '/' || r[1] === '/' || r.includes('\\') || r.replace(T_UNSAFE, '') !== r || tBytes(r) > threadsCoreState.T_CAPS.route) return null;
  try {
    const base = /^https?:\/\/[^/]+$/.test(origin ?? '') ? origin : 'http://preview.invalid';
    const u = new URL(r, base);
    return u.origin === base && !u.pathname.startsWith('/.devteam/') ? `${u.pathname}${u.search}${u.hash}` : null;
  } catch { return null; }
}
// The page inside an artifact, from the path its lens reports: whatever the prefix (main, a draft's
// worktree, a published tree, the gateway's capability before it), what follows <slug>/, cut to the
// kit's cap only once the prefix is gone (tLensMessage keeps room for it).
// A page that is no page in it (a dot segment, an absolute path) is its index.
export function tArtPath(p: Loose, slug: Loose) {
  const m = /\/artifact\/(?:main|wt\/[^/]+|tree\/[0-9a-f]+)\/([^/]+)\/(.*)$/.exec(String(p ?? ''));
  if (!m || m[1] !== slug || m[2].startsWith('/') || m[2].split('/').some((x) => x === '..' || x === '.')) return 'index.html';
  return tCut(m[2], threadsCoreState.T_CAPS.path) || 'index.html';
}
// A thread's title for a spot in a framed page: what is there as the page names it (button "Buy
// now"), or the page itself. Page-written, so data like the rest of the capture (spec §1).
export function tFrameTitle(s: Loose) {
  const where = s.kind === 'artifact' ? `${s.slug} · /${s.path || 'index.html'}` : `${s.name}${s.route ? ` · ${s.route}` : ''}`;
  const a = s.anchor;
  if (!a) return tLine(where, threadsCoreState.T_TITLE_MAX);
  const named = tLine(a.name || a.text, 60);
  return tLine(`${a.role || a.tag || 'element'}${named ? ` "${named}"` : ''}`, threadsCoreState.T_TITLE_MAX) || tLine(where, threadsCoreState.T_TITLE_MAX);
}
// Whether the stage shows a subject's page now: the same artifact and page, or the same preview and route.
// An artifact note's path may hold the view it was placed on (file#hash): then the stage's hash too; one
// with no hash (or a bare '#') is on its file whatever the view, as every note before kit-142 is.
export function tFrameOn(s: Loose, stage: Loose) {
  if (!s || s.kind !== stage?.kind) return false;
  if (s.kind === 'preview') return s.name === stage.name && (s.route ?? '') === (stage.route ?? '');
  if (s.kind !== 'artifact' || s.slug !== stage.slug) return false;
  const p = s.path || 'index.html', i = p.indexOf('#');
  const file = i < 0 ? p : p.slice(0, i), hash = i < 0 ? '' : p.slice(i);
  // (a path that is only a hash, #tab2, is the index's: task-2 T2-2)
  return (file || 'index.html') === (stage.path || 'index.html') && (hash.length <= 1 || hash === (stage.hash ?? ''));
}
