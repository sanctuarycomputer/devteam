// kit-1008: the hub's address rules, moved from hub.html (spec, The lib modules). No imports and no DOM:
// compiled to lib-dist/lib/hub-shell-head.js and unit-tested on Node.

export type HubHead = { key: string; head: string | null; ot: string | null };

// #<key>[/<dashboard head>], #overview[?ot=<operator thread id>], #settings and #terminal. The key is
// written URI-encoded, so the first literal '/' ends it; it is decoded only after that split, and the
// dashboard's head after it is kept exactly as written.
export function hubHead(hash: string): HubHead {
  const raw = String(hash).replace(/^#/, '');
  const cut = raw.indexOf('/');
  const first = cut < 0 ? raw : raw.slice(0, cut);
  const q = first.indexOf('?');
  let key = '';
  try { key = decodeURIComponent(q < 0 ? first : first.slice(0, q)); } catch {}
  const rest = cut < 0 ? '' : raw.slice(cut + 1);
  let ot: string | null = null;
  if (key === 'overview' && cut < 0 && q >= 0) ot = new URLSearchParams(first.slice(q + 1)).get('ot') || null;
  return { key, head: rest ? `#${rest}` : null, ot };
}

// a history entry the hub wrote
export const hubMarked = (s: unknown): boolean => Boolean(s) && typeof s === 'object' && (s as { hub?: unknown }).hub === 1 && typeof (s as { key?: unknown }).key === 'string';

// the entry hubAddr writes: marked with its key (the hash's first part, as written)
export function addrState(url: string): { hub: 1; key: string } {
  return { hub: 1, key: String(url).replace(/^#/, '').split('/')[0].split('?')[0] };
}

// A dashboard's head: a string starting with '#' of at most 2,048 characters (the dashboard sends null
// for a longer one), or null, in a hub-route message (C7-C9).
export function isRouteHead(m: unknown): m is { devteam: 'hub-route'; head: string | null } {
  if (!m || typeof m !== 'object' || (m as { devteam?: unknown }).devteam !== 'hub-route') return false;
  const head = (m as { head?: unknown }).head;
  return head === null || (typeof head === 'string' && head.startsWith('#') && head.length <= 2048);
}

// the Overview's address: the operator thread open on it, if one with a name is
export const tlHashOf = (open: unknown): string => (open && !String(open).startsWith('pending-') ? `#overview?ot=${encodeURIComponent(String(open))}` : '#overview');

// a project's kept head: the last its frame said, or '' (hubKept's test)
export const keptHead = (head: unknown): string => (typeof head === 'string' && head.length > 1 ? head : '');
