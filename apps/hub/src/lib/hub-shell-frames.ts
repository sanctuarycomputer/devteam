// kit-1008: every check the hub makes on a frame's message or a frame's refusal, moved from hub.html (spec,
// The lib modules; C1-C4, C7-C11, C14-C15). The glue's listeners call these and decide nothing themselves
// (A22). Compiled to lib-dist/lib/hub-shell-frames.js and unit-tested on Node.

// A dashboard's head: a string starting with '#' of at most 2,048 characters (the dashboard sends null
// for a longer one), or null, in a hub-route message (C7-C9).
export function isRouteHead(m: unknown): m is { devteam: 'hub-route'; head: string | null } {
  if (!m || typeof m !== 'object' || (m as { devteam?: unknown }).devteam !== 'hub-route') return false;
  const head = (m as { head?: unknown }).head;
  return head === null || (typeof head === 'string' && head.startsWith('#') && head.length <= 2048);
}

export type FleetAnswer = { ok: boolean; error: string | null };
export type FleetWait = { resolve: (a: FleetAnswer) => void; origin: string; win: unknown };
export type MsgEv = { data: unknown; source: unknown; origin: string };

// A fleet ask's answer: only from the asked frame's own window, on its own origin, under its own nonce.
// It takes the ask (deleted, resolved) and says so, or touches nothing.
export function takeFleetDone(ev: MsgEv, wait: Map<string, FleetWait>): boolean {
  const m = ev.data as { devteam?: unknown; nonce?: unknown; ok?: unknown; error?: unknown } | null;
  if (!m || typeof m !== 'object' || m.devteam !== 'hub-fleet-done' || typeof m.nonce !== 'string') return false;
  const w = wait.get(m.nonce);
  if (!w || ev.source !== w.win || ev.origin !== w.origin) return false;
  wait.delete(m.nonce);
  w.resolve({ ok: m.ok === true, error: typeof m.error === 'string' ? m.error : null });
  return true;
}

// A dashboard's head, from its own frame window on its own origin only: the item it is from, or null.
export function routeFrom<I>(ev: MsgEv, items: Iterable<I>, windowOf: (it: I) => unknown, originOf: (it: I) => string | null): I | null {
  if (!isRouteHead(ev.data)) return null;
  const it = [...items].find((o) => windowOf(o) === ev.source);
  if (!it || !ev.source) return null;
  let origin: string | null = null;
  try { origin = originOf(it); } catch {}
  if (!origin || ev.origin !== origin) return null;
  return it;
}

// Under box: 2, a frame the page's frame-src refused: the listed item whose address has that origin.
export function refusedItem<I>(ev: { effectiveDirective: string; blockedURI: string }, boxV: unknown, items: Iterable<I>, addrOf: (it: I) => unknown): { it: I; origin: string } | null {
  if (boxV !== 2 || !['frame-src', 'child-src', 'default-src'].includes(ev.effectiveDirective)) return null;
  let origin: string;
  try { origin = new URL(ev.blockedURI).origin; } catch { return null; }
  const it = [...items].find((o) => { try { const a = addrOf(o); return Boolean(a) && new URL(String(a)).origin === origin; } catch { return false; } });
  return it ? { it, origin } : null;
}

export const REFUSED_KEY = 'devteam-hub-refused';
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };

// true only when the origin is newly kept, read back: a storage that can't keep it never reloads
export function markRefused(store: Store, origin: string): boolean {
  const read = (): unknown[] => { const l = JSON.parse(store.getItem(REFUSED_KEY) ?? '[]'); return Array.isArray(l) ? l : []; };
  try {
    const l = read();
    if (l.includes(origin)) return false;
    store.setItem(REFUSED_KEY, JSON.stringify([...l, origin]));
    return read().includes(origin);
  } catch { return false; }
}

export function dropRefused(store: Store, origin: string): void {
  try {
    const l = JSON.parse(store.getItem(REFUSED_KEY) ?? '[]');
    if (Array.isArray(l) && l.includes(origin)) store.setItem(REFUSED_KEY, JSON.stringify(l.filter((o) => o !== origin)));
  } catch {}
}
