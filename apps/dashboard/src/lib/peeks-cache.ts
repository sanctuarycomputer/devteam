// kit-997: peeks's cache of fetched objects (index.html's peeks block, 5363-5398 at ceaf7665), as index.html has it,
// with types. No imports but two state objects' types, and no DOM at import: compiled to lib-dist/lib/peeks-cache.js
// (a lib module that imports code fails in Turbopack or on Node, kit-990 spec S7, S8), which the ported
// multirepo-views test imports. What the block uses from outside it comes through wirePeeksCache(), which
// src/views/peeks/wire.ts calls once with the real objects: peeksState and wordsState (each rewritten name is
// `peeksState.X` or `wordsState.X`) and two functions, redraw (peeks's drawer) and oaPaint (words), each a delegator
// below that throws until it is wired.
// `Loose` is `any`: the page's data has no fixed shape in index.html.
import type { peeksState as PeeksState } from '../views/peeks/state';
import type { wordsState as WordsState } from '../views/words/state';
type Loose = any;

let peeksState: typeof PeeksState;
let wordsState: typeof WordsState;
const wired: Record<string, Loose> = {};

// Each key given replaces what it had; a key left out keeps it.
export function wirePeeksCache(w: Record<string, Loose>): void {
  Object.assign(wired, w);
  if (wired.peeksState) peeksState = wired.peeksState;
  if (wired.wordsState) wordsState = wired.wordsState;
}
function need(n: string): Loose {
  const f = wired[n];
  if (!f) throw new Error(`peeks-cache: ${n} is not wired`);
  return f;
}
const redraw = (...a: Loose[]) => need('redraw')(...a);
const oaPaint = (...a: Loose[]) => need('oaPaint')(...a);

// ---- peeks: one fetch per object, kept, fetched again on each refresh ----
/* peeks start */
export const PEEK_FLIGHT = new Set();
// A failure that isn't "no such object" (the server restarting, a spawn timing out) is not kept:
// the drawer says it couldn't load and tries again on the next refresh or open.
export const PEEK_FAIL = new Map();
// A file is one object per repo and ref (home's README.md is not a sibling's). NUL is in no path,
// ref or repo id, so the parts can't run together.
export const peekKey = (kind: Loose, id: Loose, q: Loose = {}) => `${kind}:${id}${q.repo ? `\0repo=${q.repo}` : ''}${q.ref ? `\0ref=${q.ref}` : ''}`;
export function peekOf(kind: Loose, id: Loose, q: Loose = {}) {
  const k = peekKey(kind, id, q);
  if (peeksState.PEEKS.has(k)) return peeksState.PEEKS.get(k);
  const fail = PEEK_FAIL.get(k);
  if (!fail || Date.now() - fail.at > 10000) fetchPeek(kind, id, q);
  return fail ? { error: fail.error, transient: true } : undefined;
}
export async function fetchPeek(kind: Loose, id: Loose, q: Loose = {}) {
  const k = peekKey(kind, id, q);
  if (PEEK_FLIGHT.has(k)) return;
  PEEK_FLIGHT.add(k);
  if (peeksState.DRAWER.kind === kind && peeksState.DRAWER.id === id) (peeksState.DRAWER as Loose).q = q;
  try {
    const r = await fetch(`/api/peek?${new URLSearchParams({ kind, id, ...q })}`);
    const j = await r.json().catch(() => ({}));
    if (r.ok) { peeksState.PEEKS.set(k, j); PEEK_FAIL.delete(k); }
    else if (r.status === 404) { peeksState.PEEKS.set(k, { error: j.error || 'not found', missing: true }); PEEK_FAIL.delete(k); }
    else if (!peeksState.PEEKS.has(k)) PEEK_FAIL.set(k, { error: j.error || `HTTP ${r.status}`, at: Date.now() });
  } catch (e) { if (!peeksState.PEEKS.has(k)) PEEK_FAIL.set(k, { error: String((e as Loose)?.message ?? e), at: Date.now() }); } finally { PEEK_FLIGHT.delete(k); }
  // a drawer may draw another object's peek too (a thread its ticket's): redraw whatever is open
  redraw();
  // a record an owner-action card names: its rows, in place (never the whole Inbox, so typing holds)
  if (kind === 'lesson' && wordsState.OA_PEEKS.has(id)) oaPaint();
}
/* peeks end */
