// kit-1008: the hub's box rules, moved from hub.html (spec, The lib modules). No imports and no DOM:
// compiled to lib-dist/lib/hub-shell-box.js and unit-tested on Node.

export type Label = 'not-a-label' | 'all-digits' | 'reserved' | 'shared';

// project-hosts@1's label rule (cloud/gateway.mjs), copied: why a project has no address under box: 2.
// `shared` says whether another listed (not gone) project has this name; the caller counts that.
export function labelWhy(name: unknown, v: unknown, shared: boolean): Label | null {
  if (v !== 2) return null;
  const n = name;
  if (typeof n !== 'string' || !/^(?!\d+$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(n)) return typeof n === 'string' && /^\d+$/.test(n) ? 'all-digits' : 'not-a-label';
  if (['term', 'public', 'www'].includes(n)) return 'reserved';
  if (shared) return 'shared';
  return null;
}

export type Box = {
  v: 1 | 2;
  terminal: string;
  instance: string | null;
  project: string | null;
  push: string | null;
  image: unknown;
  previews: string | null;
  passkeys: string | null;
  role: string | null;
  people: string | null;
  level: 'full' | 'view' | null;
};

type Loc = { protocol: string; href: string; origin: string };

// findBox's reading of box.json: the box, or null where findBox returns before setting it.
export function boxFrom(b: unknown, loc: Loc, roles: readonly string[]): Box | null {
  const j = (b && typeof b === 'object' ? b : null) as Record<string, unknown> | null;
  // https, or a local gateway on http://*.localhost (a laptop testing the box chain end to end)
  const secure = (u: string) => { try { const x = new URL(u.replace('{port}', '1').replace('{project}', 'a')); return x.protocol === 'https:' || (loc.protocol === 'http:' && x.protocol === 'http:' && x.hostname.endsWith('.localhost')); } catch { return false; } };
  // box: 1 names each dashboard by its port ({port}), box: 2 by its project's name ({project})
  const tpl = (k: string, hole: string) => typeof j?.[k] === 'string' && (j[k] as string).includes(hole) && secure(j[k] as string);
  const v = j?.box === 1 && tpl('instance', '{port}') ? 1 : j?.box === 2 && tpl('project', '{project}') ? 2 : 0;
  if (!v || !j || typeof j.terminal !== 'string' || !secure(j.terminal)) return null;
  const box: Box = { v, terminal: j.terminal, instance: v === 1 ? (j.instance as string) : null, project: v === 2 ? (j.project as string) : null, push: typeof j.push === 'string' ? j.push : null, image: j.image, previews: null, passkeys: null, role: null, people: null, level: null };
  if (typeof j.previews === 'string' && secure(j.previews)) box.previews = j.previews;
  if (typeof j.passkeys === 'string' && secure(j.passkeys)) box.passkeys = j.passkeys;
  if (roles.includes(j.role as string)) box.role = j.role as string;
  box.level = j.level === 'full' || j.level === 'view' ? j.level : null;
  // the page may fetch only its own origin (connect-src)
  if (box.role && box.role !== 'member' && typeof j.people === 'string') { try { const u = new URL(j.people, loc.href); if (u.origin === loc.origin) box.people = u.href; } catch {} }
  return box;
}

// One entry per root: if two answers claim one root, keep the port already shown, else the lowest.
export function perRoot<X extends { root: string; port: unknown }>(list: unknown, keptPort: (root: string) => unknown): Map<string, X> {
  const out = new Map<string, X>();
  // H:3298's `data.instances ?? []`: a value that isn't iterable throws, as hub.html's draw does (its tabs kept)
  for (const x of ((list ?? []) as Iterable<X>)) {
    if (!x || typeof x.root !== 'string' || !Number.isInteger(Number(x.port))) continue;
    const had = out.get(x.root);
    const keep = keptPort(x.root);
    if (!had || Number(x.port) === Number(keep) || (Number(had.port) !== Number(keep) && Number(x.port) < Number(had.port))) out.set(x.root, x);
  }
  return out;
}

// a fleet ask's nonce: 24 characters of [a-z0-9] from 12 random bytes (C6)
export const nonceOf = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
