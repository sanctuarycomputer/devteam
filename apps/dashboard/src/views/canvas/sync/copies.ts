// ---- the two copies (canvas.html 1898-2028, kit-1015) ----
// base and pending, drawn as one; the message line and the banner; whether editing is allowed; one edit.
// Each declaration is the page's own, with types added; checks/faithful.mjs holds it to the page's tokens.
import { $, TEXT, hideMsg, isObj, live, own, pageById, renderPageSel, renderPages, showMsg, state, type Json } from '../core/page';
import { kidsOf } from '../core/nodes';
import { drawPage } from '../core/drawing';
import { hashPage, markPage, renderLayers, selectIds, showPage } from '../panels';
import { drawHandles, keepDrag, setTool } from '../editing';
import * as editing from '../editing';
import { coalesceEntry, makeEntry, pushEntry } from '../history';
import { placeOthers } from '../presence';
import { applyOps } from './ops';
import { BANNER } from './ids';
import { shared } from './shared';
import { pump, sock } from './socket';

// What is drawn: base, with every pending edit applied over a copy of it (base itself when none).
export function viewDoc(): Json {
  if (state.pending.length === 0) return state.base;
  const d = structuredClone(state.base);
  for (const e of state.pending) applyOps(d, e.ops);
  return d;
}
// A doc response taken as base: its document, rev and session.
export function takeDoc(b: Json): void {
  const d = b.doc;
  d.rev = Number.isSafeInteger(b.rev) ? b.rev : Number.isSafeInteger(d.rev) ? d.rev : 0;
  state.base = d;
  state.rev = d.rev;
  state.session = own(b, 'session') && typeof b.session === 'string' ? b.session : null;
  state.repo = b.repo;
  sock.highest = Math.max(sock.highest, d.rev);
  $('tools').hidden = state.session === null; // main's copy is watched, never edited: no tools
}
// For tests and the bar: data-live, data-rev (base's), data-pending and data-kept (their counts) and
// data-saved.
export function syncBody(): void {
  const b = document.body.dataset;
  b.live = sock.live ? 'on' : 'off';
  b.rev = state.base ? String(state.base.rev) : '';
  b.pending = String(state.pending.length);
  b.kept = String(state.kept.length);
  b.saved = state.saved === null ? '' : String(state.saved);
}
// Draw again from the two copies: the shown page, its layers, the selection and the properties (the
// view kept, not refitted). A row of the Layers tree that had focus has it again; the Pages list and
// the page select are rebuilt only when the pages changed.
export function redraw(): void {
  if (!state.base) return;
  state.doc = viewDoc();
  state.rev = state.base.rev;
  renderPages();
  renderPageSel();
  const pg = pageById(state.pageId);
  if (!pg) { showPage(hashPage()); syncBody(); keepDrag(); return; } // the shown page is gone: the first one
  const a = document.activeElement as HTMLElement | null;
  const focusRow = a instanceof Element && a.matches('#layers .layer[data-node]') ? a.dataset.node : null;
  markPage(pg);
  drawPage(pg.id);
  renderLayers(pg.id);
  selectIds(state.sels); // ids no longer on the shown page drop out
  // a focused row that is gone (deleted) leaves focus in the tree, on its tab stop
  const back = focusRow === null ? null : live.layerRows.get(focusRow!) || [...live.layerRows.values()].find((r) => r.tabIndex === 0);
  if (back) back.focus({ preventScroll: true });
  if (document.body.dataset.state !== 'error') { if (kidsOf(pg).length === 0) showMsg(TEXT.empty); else hideMsg(); }
  syncBody();
  keepDrag();
  drawHandles();
  placeOthers();
}

// The message line (#toast) for 6 s, and the banner (#banner; null hides it).
let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function say(text: string): void {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer!);
  toastTimer = setTimeout(() => { t.hidden = true; t.textContent = ''; }, 6000);
}
export function banner(text: string | null): void {
  const b = $('banner');
  b.textContent = text === null ? '' : text;
  b.hidden = text === null;
}
// The one banner due: closed, else the socket down, else saving paused, else none.
export function showBanner(): void {
  if (state.closedText !== null) banner(state.closedText);
  else if (sock.down) banner(BANNER.down);
  else if (state.paused) banner(BANNER.paused);
  else banner(null);
}

// Editing is allowed on a canvas open for editing (a session), until it is closed or refused `view`,
// and only at 760 px and over: under that the page is watch-only (no tools, keys or fields; edits
// already queued are still sent).
export const narrow = (): boolean => window.matchMedia('(max-width: 760px)').matches;
export const editable = (): boolean => state.base !== null && state.session !== null && state.locked === null && !narrow();
// No more edits: the tools and fields disabled; after `closed`, its banner and no reconnect.
export function lock(kind: 'view' | 'closed', text: string | null = null): void {
  if (state.locked !== 'closed') state.locked = kind;
  if (kind === 'closed') { sock.ended = true; state.closedText = text; }
  setTool('move');
  editing.shared.placing = null;
  for (const c of document.querySelectorAll<HTMLButtonElement>('#tools button, #props input, #props select, #props textarea, #props button, #pageAdd, #pages button')) c.disabled = true;
  // @ts-ignore -- setTool is canvas-editing's stub (typed never) until kit-1016 ports it, so this call reads as unreachable; the line is the page's
  drawHandles(); // no editing, no handles
  showBanner();
}

/** edit()'s options: its kind, when it may go, and the undo entry it shares (editSplit). */
export type EditOpts = { kind?: string; notBefore?: number; entry?: Json };

// One edit: queued in pending, drawn at once, sent when the socket and the rate allow. A single set of
// the same node and property as the last unsent edit replaces it (so a held key sends the latest
// value, never a burst). kit-668: each edit has a kind: 'plain' (a person's), 'live' (a drag's while
// the pointer is down), 'release' (a drag's drop), 'restore' (a drag ended without its drop, back to
// its start); only two plain edits coalesce. notBefore: the sender holds it, and everything behind
// it, until then (performance.now() ms; a drag's throttle). The queued item, or false when nothing was.
// A plain edit pushes its undo entry (§3; 'undo' is an undo's own edit, which pushes none); a plain
// edit coalesced into the last one updates that one's own entry with what the new value leaves.
// kit-669: sets of the same nodes and properties, in the same order, coalesce as one set does (a held
// arrow with several selected sends the latest values too). `entry` given (a part of a split edit,
// or a held arrow's repeat, editSplit): the item takes that entry and pushes none; it coalesces only
// into an unsent edit of that same entry.
export function edit(ops: Json, { kind = 'plain', notBefore = 0, entry }: EditOpts = {}): Json {
  if (!editable() || !Array.isArray(ops) || ops.length === 0) return false;
  if (new TextEncoder().encode(JSON.stringify(ops)).length > shared.OPS_BYTES) { say(shared.SAY.tooBig); return false; }
  const last = state.pending[state.pending.length - 1];
  const isSet = (o: Json): boolean => isObj(o) && o.op === 'set';
  const sameSets = (a: Json[], b: Json[]): boolean => a.length === b.length && a.every((o, i) => isSet(o) && isSet(b[i]) && o.id === b[i].id && o.prop === b[i].prop);
  let item: Json;
  if ((entry === undefined || entry === last?.entry) && kind === 'plain' && last && last.kind === 'plain' && last.seq === null && sameSets(last.ops, ops)) {
    last.ops = ops;
    item = last;
    if (last.entry) for (const op of ops) coalesceEntry(last.entry, op);
  } else {
    item = { ops, seq: null, kind, entry: null, notBefore };
    if (entry !== undefined) item.entry = entry;
    else if (kind === 'plain') {
      item.entry = makeEntry(state.doc, ops);
      if (item.entry) pushEntry(item.entry);
    }
    state.pending.push(item);
  }
  redraw();
  pump();
  return item;
}
