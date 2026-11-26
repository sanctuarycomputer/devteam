/* imports start */
import fs from 'node:fs';
import path from 'node:path';
import { covered } from './observe.mjs';
import { devteamLine } from './links.mjs';
import { lastPhaseOf } from './fleet.mjs';
import { loadSettings } from './settings.mjs';
import { logObjects } from './log-sync.mjs';
import { mainRoot } from './state.mjs';
import { mergeShaFor } from './repos.mjs';
import { out } from './base.mjs';
import { phaseRunStart } from './orient.mjs';
import { readLog } from './log-sync.mjs';
import { repo } from './repos.mjs';
import { repoOfTicketLink } from './repos.mjs';
import { repoReadable } from './repos.mjs';
import { resolvePane } from './sessions.mjs';
import { rest } from './base.mjs';
import { spendByWho } from './spend.mjs';
import { tmuxTarget } from './base.mjs';
/* imports end */
// Computed once per read of the log (a write starts a new read): callers don't change what they get.
export const memo = (key, fn) => { const l = readLog(); l.memo ??= new Map(); if (!l.memo.has(key)) l.memo.set(key, fn()); return l.memo.get(key); };
export const tickets = () => memo('tickets', () => new Map(logObjects('ticket').map((t) => [t.id, t])));
export const features = () => memo('features', () => new Map(logObjects('feature').map((f) => [f.id, f])));
export const isActive = (t) => !t.superseded_by;
// A held ticket is one the supervisor chose not to schedule yet (`ticket hold <id> --reason "why" --for <cause>…`; `ticket release <id>` lifts it).
export const isHeld = (t) => typeof t.held === 'string' && t.held.trim() !== '';
export const activeTickets = () => new Map([...tickets()].filter(([, t]) => isActive(t)));
export const weight = (t) => (t.size === 'M' ? 2 : 1);

export function closures(ts) {
  const memo = new Map();
  const visit = (id, stack = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (stack.has(id)) return new Set();
    stack.add(id);
    const o = new Set();
    for (const d of ts.get(id)?.depends_on ?? []) if (ts.has(d)) { o.add(d); for (const x of visit(d, stack)) o.add(x); }
    stack.delete(id);
    memo.set(id, o);
    return o;
  };
  for (const id of ts.keys()) visit(id);
  return memo;
}
export function findCycle(ts) {
  const state = new Map();
  const stack = [];
  const dfs = (id) => {
    state.set(id, 1);
    stack.push(id);
    for (const d of ts.get(id)?.depends_on ?? []) {
      if (!ts.has(d)) continue;
      if (state.get(d) === 1) return [...stack.slice(stack.indexOf(d)), d];
      if (!state.has(d)) { const c = dfs(d); if (c) return c; }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of ts.keys()) if (!state.has(id)) { const c = dfs(id); if (c) return c; }
  return null;
}
// Longest dependency chain, weighted S = 1, M = 2 (or by w: () => 1 counts tickets).
export function criticalPath(ts, w = weight) {
  const best = new Map();
  const longest = (id) => {
    if (best.has(id)) return best.get(id);
    let top = { len: 0, path: [] };
    for (const d of ts.get(id).depends_on ?? []) if (ts.has(d)) { const r = longest(d); if (r.len > top.len) top = r; }
    const res = { len: top.len + w(ts.get(id)), path: [...top.path, id] };
    best.set(id, res);
    return res;
  };
  let crit = { len: 0, path: [] };
  for (const id of ts.keys()) { const r = longest(id); if (r.len > crit.len) crit = r; }
  return crit;
}
// Dependency depth (0-based) of every ticket in a subgraph without cycles.
export function levels(ts) {
  const level = new Map();
  const lvl = (id) => {
    if (level.has(id)) return level.get(id);
    const deps = (ts.get(id).depends_on ?? []).filter((d) => ts.has(d));
    const v = deps.length ? 1 + Math.max(...deps.map(lvl)) : 0;
    level.set(id, v);
    return v;
  };
  for (const id of ts.keys()) lvl(id);
  return level;
}

/* globs start */
// touches entries: a plain path matches itself and everything beneath it; globs use * ** ? {a,b}.
export const escRe = (s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&');
export const hasWild = (g) => /[*?{[]/.test(g);
export const unbalanced = (g) => (g.match(/\{/g) ?? []).length !== (g.match(/\}/g) ?? []).length;
// Each glob is compiled once per process, keyed by its text: coverage asks every glob about every
// tracked path, and compiling per call made 50k paths x 30 globs take seconds.
export const globCache = new Map();
export function globToRegex(g) {
  const hit = globCache.get(g);
  if (hit) return hit;
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = g.indexOf('}', i);
      if (end === -1) { re += '\\{'; continue; }
      re += `(${g.slice(i + 1, end).split(',').map(escRe).join('|')})`;
      i = end;
    } else re += escRe(c);
  }
  const rx = new RegExp(`^${re}$`);
  globCache.set(g, rx);
  return rx;
}
export const trimSlash = (p) => p.replace(/\/+$/, '');
export const staticPrefix = (g) => { const i = g.search(/[*?{[]/); return i === -1 ? g : g.slice(0, i); };
// One matcher per touches entry or glob, built once per process and kept by its text.
export const matcherCache = new Map();
export function globMatcher(entry) {
  let m = matcherCache.get(entry);
  if (!m) {
    if (!hasWild(entry)) { const e = trimSlash(entry), under = `${e}/`; m = (file) => file === e || file.startsWith(under); }
    else { const rx = globToRegex(entry); m = (file) => rx.test(file); }
    matcherCache.set(entry, m);
  }
  return m;
}
export const pathMatches = (entry, file) => globMatcher(entry)(file);
// Conservative: may report an overlap that isn't real, never misses one.
export function globsOverlap(a, b) {
  if (!hasWild(a) && !hasWild(b)) { const x = trimSlash(a), y = trimSlash(b); return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`); }
  if (!hasWild(a)) return pathMatches(b, trimSlash(a)) || staticPrefix(b).startsWith(`${trimSlash(a)}/`);
  if (!hasWild(b)) return globsOverlap(b, a);
  const pa = staticPrefix(a), pb = staticPrefix(b);
  return pa.startsWith(pb) || pb.startsWith(pa);
}
/* globs end */
/* coverage start */
// Component lines: every tracked path matches exactly one component's owns, once the
// kit's own line (devteam) is set aside. Pure: the caller reads the tree and the settings, so the
// four places that enforce this (validate, check-pr and merge, observe-metrics, check-ticket) run
// the same function on the same kind of input.
//
// Who owns one path: 'devteam' alone when it lies in the kit's line, else every component whose
// owns match it. A sole component with no owns owns everything devteam doesn't; with two or more,
// a component without owns owns nothing (validate says why). onHit(name, glob) counts glob hits.
// coverage, prefixOwners, coverageReport and checkTicket's footprint all ask this one function.
// The lines compiled: each glob's matcher looked up once, not once per path.
export const compileLines = (components, devteamLine) => ({
  dev: devteamLine.map(globMatcher),
  sole: components.length === 1,
  comps: components.map((c) => ({ name: c.name, bare: c.owns === undefined, globs: (c.owns ?? []).map((g) => [g, globMatcher(g)]) })),
});
// The kit's own line is set aside before any component is asked: a path in it is devteam's
// alone, so a project line over docs/** coexists with the kit at docs/devteam/** with no contest,
// and a glob reaching into it claims nothing there.
export function ownersIn(p, L, onHit) {
  if (L.dev.some((m) => m(p))) return ['devteam'];
  const owners = [];
  for (const c of L.comps) {
    if (c.bare) { if (L.sole) owners.push(c.name); continue; }
    let mine = false;
    for (const [g, m] of c.globs) if (m(p)) { mine = true; if (onHit) onHit(c.name, g); }
    if (mine) owners.push(c.name);
  }
  return owners;
}
export const ownersOf = (p, components, devteamLine, onHit = null) => ownersIn(p, compileLines(components, devteamLine), onHit);
export function coverage(paths, components, devteamLine) {
  const hits = new Map();
  for (const c of components) for (const g of c.owns ?? []) hits.set(`${c.name}\0${g}`, 0);
  const count = (name, g) => hits.set(`${name}\0${g}`, hits.get(`${name}\0${g}`) + 1);
  const L = compileLines(components, devteamLine);
  const unowned = [];
  const contested = [];
  for (const p of paths) {
    const owners = ownersIn(p, L, count);
    if (owners[0] === 'devteam') continue;
    if (!owners.length) unowned.push(p);
    // a contest names the globs that collide, so the fix can say which to narrow
    else if (owners.length > 1) { const globs = []; ownersIn(p, L, (n, g) => globs.push([n, g])); contested.push([p, owners, globs]); }
  }
  const empty = [...hits].filter(([, n]) => n === 0).map(([k]) => k.slice(k.indexOf('\0') + 1));
  return { unowned, contested, empty, case_collisions: caseCollisions(paths) };
}
// Two tracked paths that differ only by case break a checkout on macOS and Windows.
export function caseCollisions(paths) {
  const by = new Map();
  for (const p of paths) { const k = p.toLowerCase(); if (!by.has(k)) by.set(k, []); by.get(k).push(p); }
  return [...by.values()].filter((g) => g.length > 1).map((g) => [...g].sort());
}
// The owner to suggest for an unowned folder: the owner of the first owned path (in tree order) in
// that folder, else in the nearest folder above it; the repo root suggests nothing. One pass over
// the tree indexes the first owned path under every folder, so each path's owner is asked once,
// however many folders are unowned. ownerOf(p) is the owner to name, or null.
export function ownerSuggestions(paths, unowned, ownerOf) {
  const first = new Map();
  for (const p of paths) {
    if (unowned.has(p)) continue;
    let who;
    for (let i = p.indexOf('/'); i !== -1; i = p.indexOf('/', i + 1)) {
      const d = p.slice(0, i + 1);
      if (first.has(d)) continue;
      if (who === undefined) who = ownerOf(p);
      if (!who) break;
      first.set(d, who);
    }
  }
  return (dir) => {
    for (let d = dir; d && d !== './'; d = d.slice(0, d.slice(0, -1).lastIndexOf('/') + 1)) if (first.has(d)) return first.get(d);
    return null;
  };
}
// Who owns a touches entry's static prefix (the part before its first wildcard), by ownersOf.
// Null when there is no prefix (`**/*.rb` could be anywhere). A plain path is a folder and what is
// in it, as in touches, so both the path and the path with a trailing slash are asked.
export function prefixOwners(entry, components, devteamLine) {
  const pre = staticPrefix(entry);
  if (!pre) return null;
  const probes = hasWild(entry) ? [pre] : [trimSlash(pre), `${trimSlash(pre)}/`];
  return [...new Set(probes.flatMap((p) => ownersOf(p, components, devteamLine)))];
}
/* coverage end */
/* parts start */
// Parts of a file, read by line (spec: what a part is). A touches entry may name one of any file:
// path#name, or path#+name for a part the ticket adds.
export const PART_NAME = /^[A-Za-z0-9_$.-]+$/;
export const touchPath = (entry) => { const i = entry.indexOf('#'); return i === -1 ? entry : entry.slice(0, i); };
export const touchPart = (entry) => { const i = entry.indexOf('#'); if (i === -1) return null; const p = entry.slice(i + 1); return { name: p.replace(/^\+/, ''), added: p.startsWith('+') }; };
export const PART_MARK = /^\s*(?:\/\*|<!--)\s*([A-Za-z0-9_$.-]+)\s+(start|end)\s*(?:\*\/|-->)\s*$/;
// a line comment's marker (# for Ruby, Python, shell, YAML; // and -- for others), outside Markdown,
// where # name start is a heading
export const PART_MARK_LINE = /^\s*(?:#|\/\/|--)\s*([A-Za-z0-9_$.-]+)\s+(start|end)\s*$/;
export const isMarkdown = (file) => /\.(?:md|mdx|markdown|mdown|mkd)$/i.test(file);
// files whose top-level JavaScript or TypeScript declarations are parts (other files: regions only)
export const hasDecls = (file) => /\.(?:[cm]?[jt]sx?|html?|vue|svelte|astro)$/i.test(file);
export const partMark = (line, file) => line.match(PART_MARK) ?? (isMarkdown(file) ? null : line.match(PART_MARK_LINE));
// a top-level JavaScript or TypeScript declaration at column 0
export const PART_DECL = /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:(?:async\s+)?function(?:\s*\*\s*|\s+)([A-Za-z_$][\w$]*)|(?:(?:abstract\s+)?class|interface|(?:const\s+)?enum|type(?=\s+[A-Za-z_$][\w$]*\s*[=<])|const|let|var)\s+([A-Za-z_$][\w$]*))/;
export const PART_COMMENT = /^(?:\/\/|\/\*| ?\*)/;
export const headingSlug = (s) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').replace(/ /g, '-');
// { places: Map name -> [{from, to}] (1-based, inclusive), owner: line -> leaf key, lines, n }. The
// leaves partition the file: each declaration's or heading's own lines, and the rest by region. A
// leaf is keyed by its path (a heading's ancestor headings; a declaration's enclosing regions), its
// name and its count among places with that path and name, so a same-named place added elsewhere
// never renumbers it: d:<path/>name#k, r:<region> for a region's rest, r: for the file's.
export function fileParts(text, file) {
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const n = lines.length;
  const places = new Map();
  const add = (name, from, to) => { if (!places.has(name)) places.set(name, []); places.get(name).push({ from, to }); };
  const owner = new Array(n + 1).fill(null); // line -> own leaf key (declaration or heading), else null
  const count = new Map();
  const own = (path, name, from, to) => { const id = `${path.length ? `${path.join('/')}/` : ''}${name}`; const k = (count.get(id) ?? 0) + 1; count.set(id, k); const key = `d:${id}#${k}`; for (let i = from; i <= to; i++) owner[i] = key; return key; };
  // regions
  const open = new Map();
  const regions = [];
  for (let i = 1; i <= n; i++) {
    const m = partMark(lines[i - 1], file);
    if (!m) continue;
    if (m[2] === 'start') { if (!open.has(m[1])) open.set(m[1], i); }
    else if (open.has(m[1])) { regions.push({ name: m[1], from: open.get(m[1]), to: i }); add(m[1], open.get(m[1]), i); open.delete(m[1]); }
  }
  const isMark = (i) => !!partMark(lines[i - 1], file);
  // only a marker at column 0 ends a declaration; an indented one sits inside a body
  const isMark0 = (i) => isMark(i) && !/^\s/.test(lines[i - 1]);
  if (isMarkdown(file)) {
    const heads = [];
    let fence = null;
    for (let i = 1; i <= n; i++) {
      const l = lines[i - 1];
      const f = l.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; continue; }
      if (fence) continue;
      // the title without its closing #s, trimmed by hand: a regex for it backtracks on long lines
      const h = l.match(/^(#{1,6})\s+/);
      if (h) {
        let t = l.slice(h[0].length).trimEnd(), e = t.length;
        while (e > 0 && t[e - 1] === '#') e--;
        heads.push({ i, level: h[1].length, name: headingSlug(t.slice(0, e).trimEnd()) });
      }
    }
    const above = [];
    for (let j = 0; j < heads.length; j++) {
      const h = heads[j];
      while (above.length && above[above.length - 1].level >= h.level) above.pop();
      let to = n;
      for (let k = j + 1; k < heads.length; k++) if (heads[k].level <= h.level) { to = heads[k].i - 1; break; }
      add(h.name, h.i, to);
      const ownTo = j + 1 < heads.length ? heads[j + 1].i - 1 : n;
      own(above.map((a) => a.name), h.name, h.i, ownTo);
      above.push(h);
    }
  } else {
    const html = /\.html?$/i.test(file);
    const decls = [];
    if (hasDecls(file)) for (let i = 1; i <= n; i++) { const m = lines[i - 1].match(PART_DECL); if (m) decls.push({ i, name: m[1] ?? m[2] }); }
    // a declaration starts at the comment lines directly above it
    for (const d of decls) { d.from = d.i; while (d.from > 1 && PART_COMMENT.test(lines[d.from - 2]) && !isMark(d.from - 1) && !PART_DECL.test(lines[d.from - 2])) d.from--; }
    for (let j = 0; j < decls.length; j++) {
      const d = decls[j];
      const stop = j + 1 < decls.length ? Math.max(decls[j + 1].from, d.i + 1) : n + 1;
      let to = d.i;
      while (to + 1 < stop && !isMark0(to + 1) && !(html && lines[to].startsWith('<'))) to++;
      const from = Math.max(d.from, j ? decls[j - 1].i + 1 : 1);
      add(d.name, from, to);
      own(regions.filter((r) => r.from < d.i && d.i < r.to).sort((a, b) => a.from - b.from).map((r) => r.name), d.name, from, to);
    }
  }
  // the rest: lines no declaration or heading owns, by innermost region
  // keyed by the regions round it too, so a region moved into another is a different leaf
  const restKey = (i) => {
    const round = regions.filter((r) => r.from <= i && i <= r.to).sort((a, b) => a.from - b.from || b.to - a.to);
    return round.length ? `r:${round.map((r) => r.name).join('/')}` : 'r:';
  };
  for (let i = 1; i <= n; i++) if (!owner[i]) owner[i] = restKey(i);
  return { places, regions, owner, lines, n };
}
// The leaf keys a named part covers in these parts: every leaf with a line inside one of its places.
export function partLeaves(P, name) {
  const s = new Set();
  for (const pl of P.places.get(name) ?? []) for (let i = pl.from; i <= pl.to; i++) s.add(P.owner[i]);
  return s;
}
// Whether a named part holds every leaf but the file's rest: naming it is naming the whole file,
// so it overlaps every part, a new one too (a title heading, a region round everything).
export function wholeLike(P, name) {
  P.wholeLike ??= new Map();
  if (!P.wholeLike.has(name)) {
    const L = partLeaves(P, name);
    let all = L.size > 0;
    for (let i = 1; all && i <= P.n; i++) all = P.owner[i] === 'r:' || L.has(P.owner[i]);
    P.wholeLike.set(name, all);
  }
  return P.wholeLike.get(name);
}
// Each leaf's text, trailing blank lines dropped. A rest (the file's, a region's) is in runs, the
// blank lines at a run's edges left out (inside one they are content: a YAML block, a heredoc), and
// a mark where another leaf's lines come between two of its lines, so a part put in the middle of
// the rest (between two imports, into a region's body) changes it.
export function leafTexts(P) {
  const m = new Map();
  let last = null;
  for (let i = 1; i <= P.n; i++) {
    const k = P.owner[i], l = P.lines[i - 1], blank = !l.trim();
    if (k.startsWith('r:') && blank && last !== k) continue;
    const cut = k.startsWith('r:') && m.has(k) && last !== k;
    m.set(k, m.has(k) ? `${cut ? `${trimBlankEnd(m.get(k))}\n\u241e` : m.get(k)}\n${l}` : l);
    if (!blank) last = k;
  }
  for (const [k, v] of m) m.set(k, trimBlankEnd(v));
  return m;
}
// A text without its trailing blank (whitespace-only) lines, its first line kept. A loop, not a
// regex: /(?:\n\s*)+$/ backtracks exponentially on a run of blank lines followed by more text.
export function trimBlankEnd(s) {
  let e = s.length;
  for (let i = s.lastIndexOf('\n'); i >= 0 && !s.slice(i + 1, e).trim(); i = i ? s.lastIndexOf('\n', i - 1) : -1) e = i;
  return s.slice(0, e);
}
// The leaves of a file that changed between two texts and that none of the named parts covers. A
// leaf the base has is judged by the base: only a part named there covers it, so widening a part at
// the head (a region moved round a function, a heading demoted under a named one) covers nothing
// more. A leaf only the head has is judged by the head: a function added inside a named region is
// the region's, and a part the ticket adds (+name) covers its own leaves, unless the base has it.
export function partsChanged(baseText, headText, file, named) {
  const B = fileParts(baseText ?? '', file), H = fileParts(headText ?? '', file);
  const tb = leafTexts(B), th = leafTexts(H);
  const covB = new Set(), covH = new Set();
  for (const x of named) {
    if (!x.added) for (const k of partLeaves(B, x.name)) covB.add(k);
    if (!x.added || !B.places.has(x.name)) for (const k of partLeaves(H, x.name)) covH.add(k);
  }
  const gap = new Set([...new Set([...tb.keys(), ...th.keys()])].filter((k) => tb.get(k) !== th.get(k) && !(tb.has(k) ? covB : covH).has(k)));
  // What the leaves' texts miss is where the leaves are, judged by content, not by a diff. With no
  // part named every changed or new leaf is in the gap already.
  if (named.length) {
    const names = new Set(named.filter((x) => !x.added).map((x) => x.name));
    // A place's children in order, blank lines skipped: a leaf by kind, name and count (its path
    // dropped, so a place moved whole reads the same), each run of one leaf's lines once.
    const children = (P, pl) => {
      const out = [];
      let last = null;
      for (let i = pl.from; i <= pl.to; i++) {
        if (!P.lines[i - 1].trim()) continue;
        const k = P.owner[i];
        if (k === last) continue;
        last = k;
        out.push(k.startsWith('d:') ? `d:${k.slice(2).split('/').pop()}` : `r:${k.slice(2).split('/').pop()}`);
      }
      return out.join('\n');
    };
    // A place the ticket doesn't name whose children changed: a part added inside it (a region in
    // another's region, a sub-heading under another's heading), one taken out, or its parts
    // reordered. Not a place that holds the whole file (whole-like: naming it overlaps every part,
    // so no other ticket runs beside it); a change inside it is still its parts'.
    for (const [name, pls] of B.places) {
      if (names.has(name) || wholeLike(B, name)) continue;
      const hp = H.places.get(name) ?? [];
      pls.forEach((pl, i) => { if (hp[i] && children(B, pl) !== children(H, hp[i])) gap.add(`p:${name}`); });
    }
    // The order of the leaves no named part covers at the base, through the whole file: moving
    // one's own parts is free, moving another ticket's (into a named part too) is a change to it.
    const keep = (k) => tb.has(k) && th.has(k) && !covB.has(k);
    const order = (P) => { const out = []; for (let i = 1; i <= P.n; i++) { const k = P.owner[i]; if (P.lines[i - 1].trim() && keep(k) && out[out.length - 1] !== k) out.push(k); } return out; };
    const ob = order(B), oh = order(H);
    if (ob.join('\n') !== oh.join('\n') && ob.length * oh.length > 4e7) {
      // too many leaves to find which moved (a table's worth): the first one out of place
      let i = 0;
      while (ob[i] === oh[i]) i++;
      gap.add(`m:${ob[i] ?? oh[i]}`);
    } else if (ob.join('\n') !== oh.join('\n')) {
      // the base leaves off the longest common order: the ones that moved
      const L = Array.from({ length: ob.length + 1 }, () => new Int32Array(oh.length + 1));
      for (let i = ob.length - 1; i >= 0; i--) for (let j = oh.length - 1; j >= 0; j--) L[i][j] = ob[i] === oh[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      for (let i = 0, j = 0; i < ob.length;) {
        if (j < oh.length && ob[i] === oh[j]) { i++; j++; } else if (j < oh.length && L[i][j + 1] > L[i + 1][j]) j++; else gap.add(`m:${ob[i++]}`);
      }
    }
  }
  return [...gap];
}
// A leaf key in words: a declaration's or heading's name, or whose rest it is.
export const leafWords = (k) => (k.startsWith('p:') ? `${k.slice(2)} (a part added, taken out or reordered inside it)` : k.startsWith('m:') ? `${leafWords(k.slice(2))} (moved)` : k === 'r:' ? "the file's rest" : k.startsWith('r:') ? `region ${k.slice(2)}'s rest` : k.slice(2).replace(/#\d+$/, ''));
/* parts end */
// Parts of a file at a repo's main, read once per process and only for a file some entry names a
// part of, or that a dependency's two tickets both claim (validate's big-file warning): null when this machine can't read the repo or its main has no such file (a folder too).
export const partsAtMainCache = new Map();
export function partsAtMain(repoName, file) {
  const k = `${repoName}\0${file}`;
  if (!partsAtMainCache.has(k)) {
    let P = null;
    if (repoReadable(repoName)) {
      const R = repo(repoName);
      const ref = R.mainRef();
      const text = ref ? R.git(['cat-file', 'blob', `${ref}:${file}`]) : null;
      if (text !== null) P = fileParts(text, file);
    }
    partsAtMainCache.set(k, P);
  }
  return partsAtMainCache.get(k);
}
// Whether settings.split_files lists a file: one the project expects many tickets to change, so a
// whole-file claim on it that orders two tickets warns whatever its size (validate). Any file may be
// named by part; this list no longer decides that.
export const isSplitFile = (file, s = loadSettings()) => Array.isArray(s.split_files) && s.split_files.some((g) => typeof g === 'string' && pathMatches(g, file));
// A file this long at main is big: a whole-file claim on it that orders two tickets warns (validate).
export const BIG_FILE_LINES = 1500;
// A test file, by the usual layouts: a test/, tests/, spec/, __tests__/, e2e/ or cypress/ folder, or a
// name like x.test.js, x.spec.ts, x_test.go, x_spec.rb, test_x.py, XTest.java or XTests.swift.
export const TEST_FILE_RE = /(^|\/)(test|tests|spec|__tests__|e2e|cypress)\/|[._](test|spec)\.[a-z0-9]+$|(^|\/)test_[^/]+\.py$|[a-z0-9]Tests?\.(java|kt|swift|cs|scala)$/;
// The text a done-when quotes: `code` spans and "strings" (straight or curly). Each quote is taken
// whole, whatever its length, so a short one can't pair its closing mark with the next one's opening;
// then those of 4 to 80 characters are kept, less a path or a command line, which name what runs,
// not what a test asserts. Those exclusions only ever miss a warning (UI text such as "3/4" too).
export function doneWhenQuotes(t) {
  const out = new Set();
  for (const d of t.done_when ?? []) {
    if (typeof d !== 'string') continue;
    for (const m of d.matchAll(/`([^`\n]*)`|"([^"\n]*)"|\u201c([^\u201d\n]*)\u201d/g)) {
      const q = (m[1] ?? m[2] ?? m[3]).trim();
      if (q.length < 4 || q.length > 80 || q.includes('/') || /^(node|npm|npx|git|bin\/|bundle|yarn|pnpm|make|cd|devteam)\b/.test(q)) continue;
      out.add(q);
      if (out.size >= 12) return [...out];
    }
  }
  return [...out];
}
// [quote, test files at main that hold it and no touches entry of t covers], for each quote that has
// any. One grep for all of a ticket's quotes, at the repo's root (a ref's grep searches only below the
// directory it runs in), as fixed strings, text files only. A path#part entry covers its whole file:
// the test may assert the text anywhere in it, and naming the file is what lets the ticket change it.
export function testsOutsideTouches(t) {
  const rn = repoOfTicketLink(t);
  if (!repoReadable(rn)) return [];
  const R = repo(rn);
  const ref = R.mainRef();
  const quotes = doneWhenQuotes(t);
  if (!ref || !quotes.length) return [];
  const covered = (f) => (t.touches ?? []).some((g) => { const p = trimSlash(touchPath(g)); return pathMatches(p, f) || f.startsWith(`${p}/`); });
  const out = (R.git(['grep', '-I', '-o', '-F', ...quotes.flatMap((q) => ['-e', q]), ref, '--'], R.root) ?? '').split('\n').filter(Boolean);
  const by = new Map();
  for (const line of out) {
    const rest = line.slice(ref.length + 1);
    const i = rest.indexOf(':');
    if (i < 0) continue;
    const f = rest.slice(0, i), q = rest.slice(i + 1);
    if (!TEST_FILE_RE.test(f) || covered(f) || !quotes.includes(q)) continue;
    if (!by.has(q)) by.set(q, new Set());
    by.get(q).add(f);
  }
  return quotes.filter((q) => by.has(q)).map((q) => [q, [...by.get(q)]]);
}
// Whether two touches entries of tickets in one repo can collide (D4, ready). Paths that don't
// overlap never do; a whole file or a glob overlaps as before. Two parts of one file: names that
// exist at main collide when they cover a common leaf there; a name not there yet (path#+name, or
// one a dependency adds) is compared by name, and collides with a part main has only when that part
// holds the whole file (wholeLike: a title heading, a region round everything). A repo this
// machine can't read, or a file main lacks, collides.
export function touchesOverlap(a, b, repoName) {
  const pa = touchPath(a), pb = touchPath(b);
  if (!globsOverlap(pa, pb)) return false;
  const xa = touchPart(a), xb = touchPart(b);
  if (!xa || !xb || trimSlash(pa) !== trimSlash(pb) || hasWild(pa)) return true;
  const P = partsAtMain(repoName, trimSlash(pa));
  if (!P) return true;
  const ma = !xa.added && P.places.has(xa.name), mb = !xb.added && P.places.has(xb.name);
  if (!ma && !mb) return xa.name === xb.name;
  if (ma !== mb) return wholeLike(P, ma ? xa.name : xb.name);
  const la = partLeaves(P, xa.name);
  for (const k of partLeaves(P, xb.name)) if (la.has(k)) return true;
  return false;
}

// Live state of a ticket's worker: its last phase line, and its last line of any kind.
export function workerState(id) {
  const mine = readLog().lines.filter((l) => l.by === id);
  if (!mine.length) return null;
  const phases = mine.filter((l) => l.type === 'phase').sort((a, b) => a.at.localeCompare(b.at));
  const last = phases[phases.length - 1];
  const lastSeen = mine.map((l) => l.at).sort().pop();
  const cost = [...phases].reverse().find((p) => typeof p.usd === 'number');
  return {
    phase: last?.to ?? null, task: last?.task ?? null, note: last?.note ?? null, head_sha: last?.sha ?? null,
    started_at: phases[0]?.at ?? mine[0].at, last_seen: lastSeen,
    // the first line of the current phase run (liveness pings after it keep it)
    phase_started_at: phaseRunStart(phases)?.at ?? null,
    minutes_silent: Math.round((Date.now() - Date.parse(lastSeen)) / 60000),
    ...(spendByWho().get(id) ?? { usd: cost?.usd ?? 0, input_tokens: cost?.input_tokens ?? 0, output_tokens: cost?.output_tokens ?? 0 }),
  };
}
export const activeWorker = (id) => { const w = workerState(id); return !!w && w.phase && !['done', 'parked'].includes(w.phase) && !mergeShaFor(id); };
// A launch stopped before its agent ran: its last phase is 'starting', and neither its worktree
// (home's .worktrees/<id>, for a linked repo's ticket too) nor its tmux window is here. Stopped on
// purpose, removed with worker --remove --force, or a fleet moved here: nothing of it runs on this
// machine. A launch in progress always has its worktree before its window and its 'starting' line,
// so it never reads as stopped. Cheapest first: tmux is asked only when the other two agree.
export function stoppedLaunch(id) {
  if (lastPhaseOf(id)?.to !== 'starting') return false;
  if (fs.existsSync(path.join(mainRoot, '.worktrees', id))) return false;
  return /^no tmux (session|window)/.test(resolvePane(tmuxTarget(id)).problem ?? '');
}
// A worker that counts toward max_active_tickets, max_active_per_component and "active workers":
// active, not held on purpose, and not a stopped launch.
export const countsAsWorker = (t) => activeWorker(t.id) && !isHeld(t) && !stoppedLaunch(t.id);

// What a worker's pane is stuck on, if anything: a question the agent CLI put up (a permission or
// trust prompt, a y/n) or a usage-limit banner. The log can't show these (the worker is frozen
// mid-phase, so it isn't stale yet); the pane can. Only the bottom of the visible pane is read and
// nothing is typed here: clearing it is the supervisor's call (supervisor.md §11), and accounts-tick's
// for a limit stop. Once per process.
export const LIMIT_REACHED = '(usage|rate|session|weekly|daily|hourly|\\d+-hour) limit (reached|hit|exceeded)';
export const LIMIT_HIT = "^(?:[⎿■✖!]\\s*)?you(?:['’]ve| have) hit your (\\w+ )*limit";
export const PANE_WAITS = [
  // a banner says the limit was reached or when it resets; "rate limit" on its own is too common in
  // code and prose the pane may be showing (see PANE_CODE)
  ['limit', new RegExp(`\\b${LIMIT_REACHED}\\b|${LIMIT_HIT}\\b|\\bresets? (at|in) \\d|^approaching (your )?usage limit`, 'i')],
  ['prompt', /Do you want to (proceed|make this edit|create|allow|run)|Do you trust the files|\[y\/n\]|\(y\/n\)|Press Enter to continue|❯\s*1\.\s*Yes/i],
];
// A folder-trust dialog: an agent asks whether to trust a folder it has never run in, as every new
// worktree is, and waits (Claude Code 2.1: "Quick safety check: …", "❯ No, exit", "Yes, I trust this
// folder", with no numbers). Its words are tied to the line start (after a box edge, the cursor and a
// number) and read only when nothing on the pane is busy, so the same words shown as an agent's own
// output (a spec it printed, a pane it captured) don't count. A prompt wait, like PANE_WAITS' own.
export const PANE_TRUST = /Do you trust (?:the (?:files|contents)|this (?:folder|directory|workspace))|^(?:[│|]\s*)?(?:❯\s*)?(?:\d+\.\s*)?Yes, I trust this (?:folder|directory|workspace)\b|^(?:[│|]\s*)?Quick safety check:/i;
// A pane line that is content the agent is showing, not the agent's own UI: numbered source or diff
// lines, comments, and quoted output. A banner or prompt never looks like these.
export const PANE_CODE = /^(\d+\s|[+-]\s|#|\/\/|\/\*|\*\s|--\s|<!--|>\s|[│|]\s*\d+\s)/;
export const paneWaits = new Map();
