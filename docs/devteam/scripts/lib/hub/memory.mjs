/* imports start */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COMMANDS } from '../help.mjs';
import { HUB_PORT } from '../orient.mjs';
import { argv } from '../base.mjs';
import { machineMemory } from './operator.mjs';
import { machineRepos } from '../recover.mjs';
import { out } from '../base.mjs';
import { timedOut } from '../box-pins.mjs';
/* imports end */
/* box-memory start */
// The memory reading's names, here so its check reads nothing outside this region (a test runs it
// alone). The ceiling's bounds are memoryCeilingProblem's; the test holds the two equal.
export const MEMORY_KINDS = ['agent', 'browser', 'install', 'devteam', 'node', 'other'];
export const MEMORY_SOURCES = ['cgroup', 'meminfo', 'os'];
export const MEMORY_READING_KEYS = ['v', 'at', 'working_set', 'max', 'ceiling', 'source', 'partial', 'sessions', 'kinds', 'devteam', 'projects'];
export const MEMORY_PROJECT_KEYS = ['rss', 'sessions', 'devteam'];
export const MEMORY_CEILING_MIN = 0.5, MEMORY_CEILING_MAX = 0.95;
export const MEMORY_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
export const MEMORY_SUBCOMMAND = /^[a-z][a-z0-9-]*$/;
export const isBytes = (v) => Number.isSafeInteger(v) && v >= 0;
export const isCount = (v) => Number.isSafeInteger(v) && v >= 0;
export const memoryIsMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// A field's path: a key that isn't [A-Za-z0-9_-]+ is quoted in brackets (projects["my.app"].rss),
// so a name with a dot can't read as two fields.
export const memoryPath = (base, key) => (/^[A-Za-z0-9_-]+$/.test(key) ? (base ? `${base}.${key}` : key) : `${base}[${JSON.stringify(key)}]`);
// A value as the words show it, never a throw (a writer's own object can hold a BigInt or a cycle).
export const memoryShown = (v) => {
  let s;
  try { s = JSON.stringify(v) ?? String(v); } catch { try { s = String(v); } catch { s = 'an unprintable value'; } }
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
};
// A real UTC time in the one form: 2026-02-30 or 24:00 doesn't come back as itself, so it is refused.
export const memoryAtOk = (at) => {
  if (typeof at !== 'string' || !MEMORY_AT.test(at)) return false;
  const t = new Date(at);
  return Number.isFinite(t.getTime()) && t.toISOString().slice(0, 19) === at.slice(0, 19);
};
export const memoryIs = (p, v, should) => `${p} is ${v === undefined ? 'missing' : memoryShown(v)}: it should be ${should}`;
// A kinds or devteam entry, { n, rss }: null, or the words for its first bad field.
export const memoryCountsProblem = (p, e) => {
  if (!memoryIsMap(e)) return memoryIs(p, e, '{ n, rss }, a count of processes and their integer bytes');
  if (!isCount(e.n)) return memoryIs(`${p}.n`, e.n, 'a count of processes, an integer, 0 or more');
  if (!isBytes(e.rss)) return memoryIs(`${p}.rss`, e.rss, 'integer bytes, 0 or more');
  const other = Object.keys(e).find((k) => k !== 'n' && k !== 'rss');
  return other === undefined ? null : `${memoryPath(p, other)} is not a field of ${p}: it holds only n and rss`;
};
// machine-memory@1, the memory reading: one JSON object a line in
// ~/.devteam/machine-<hub port>/memory.jsonl, written once a minute by the machine's hub.
//   `v`            required, `v: 1` (the line's "v":1): the contract's version; any other value is refused
//   `at`           required, ISO 8601 UTC, YYYY-MM-DDTHH:MM:SS(.sss)Z: when the reading was taken
//   `working_set`  required, integer bytes, 0 or more: in use as machineMemory() counts it for the
//                  gate (cgroup working set, /proc/meminfo, or os.totalmem() - os.freemem())
//   `max`          integer bytes, more than 0: the cap the gate reads
//   `ceiling`      a number from 0.5 to 0.95: the lowest machine_memory_ceiling among the known
//                  instances (default 0.8)
//   `source`       "cgroup", "meminfo" or "os": where `working_set` and `max` came from
//   `partial`      true: the tick ran past its 2-second budget and wrote what it had
//   `sessions`     an integer, 0 or more: agent processes (claude, codex, opencode) whose cwd is
//                  inside <root>/.worktrees/<name> of a known root; a supervisor in its root is not one
//   `kinds`        { <kind>: { `n`, `rss` } }: every process by its executable's kind; `n` an integer,
//                  0 or more, `rss` integer bytes, 0 or more
//   `devteam`      { <subcommand>: { `n`, `rss` } }: the `devteam` kind split by subcommand, machine-wide
//   `projects`     { <instance name>: { `rss`, `sessions`?, `devteam`? } }: by the known root holding
//                  the process's cwd; its `devteam` is { <subcommand>: integer bytes }
// Only `v`, `at` and `working_set` are required. The six kinds: `agent` (claude, codex, opencode),
// `browser` (chrome, chromium, headless_shell), `install` (npm, pnpm, yarn, bundle, pip, uv, or node
// running one of their scripts, with an install subcommand), `devteam` (node whose script ends in
// devteam.mjs), `node` (any other node), `other` (everything else). Exactly: an installer is an
// argv[0] basename whose first word is `npm`, `pnpm`, `yarn`, `bundle`, `pip` or `uv`, or node whose
// script's basename is `npm-cli.js`, `pnpm.cjs`, `pnpm.js` or `yarn.js`; it is `install` only with an
// install subcommand, the next word (`install`, `i`, `ci`, `add` or `sync`). An installer with another
// subcommand (`npm test`) is `other`, and node running an installer script with another subcommand
// is `node`. The kind comes from cmdline's
// argv[0] basename (its first word), never comm (node 24 names its main thread MainThread; npm
// retitles itself "npm ci"). A subcommand is the word after the script, kept only if it is a CLI
// command name. Nothing else of a command line, no environment and no file content is ever kept.
// Sizes are integer bytes (RSS is statm's resident pages times the page size). A field the machine
// can't read is left out, never zero: on a machine with no /proc (macOS) a line has `working_set`,
// `max`, "source":"os" and no `sessions`, `kinds` or `projects`. A new field, or a change to one, is
// machine-memory@2.
// A line the check refuses (one torn by a hub killed mid-append, a "v":2 line from a newer
// recorder, anything else memoryReadingProblem has words for) is skipped by every reader, never
// fatal: the hub's /memory.json serves only passing lines, `machine memory` and `metrics` read past
// it and say how many lines they skipped, and the Overview draws the readings it was given. A writer
// starts each line on a fresh line (a torn tail is ended with a newline before the next append), so
// one torn line spoils only itself.
// /memory.json, served by the hub with /instances.json's same-origin check (and on a box through
// the gateway): `{"v":1,"readings":[<reading>, …]}`, oldest first.
//   `?since=<n>h|<n>d`  the window, default 24 hours, at most 8 days; thinned to one reading per
//                       5 minutes for readings older than 6 hours, and one per 30 minutes older than 3 days
//   `?after=<at>`       only readings newer than at, unthinned, for an at up to 6 hours back; an
//                       older one is answered 400 (the Overview then asks since=24h again)
//   `?thin=0`           no thinning, for a loopback request whose window is 24 hours or less
// memoryReadingProblem(line) takes a line's text or a parsed value: null when it is a valid
// machine-memory@1 reading, else one sentence starting with the first bad field's path and a space
// (reading, when the line isn't a JSON object). Shape only: it doesn't add up kinds, compare
// working_set with max, or look a subcommand up in COMMANDS.
export function memoryReadingProblem(line) {
  let r = line;
  if (typeof line === 'string') {
    try { r = JSON.parse(line); } catch { return 'reading is not JSON (a torn line, or no reading at all): it should be one JSON object, a machine-memory@1 reading'; }
  }
  if (!memoryIsMap(r)) return memoryIs('reading', r, 'one JSON object, a machine-memory@1 reading');
  if (r.v !== 1) return memoryIs('v', r.v, "1, this contract's version; a line of any other version is skipped");
  if (!memoryAtOk(r.at)) return memoryIs('at', r.at, 'the time of the reading in UTC, YYYY-MM-DDTHH:MM:SSZ, with or without milliseconds');
  if (!isBytes(r.working_set)) return memoryIs('working_set', r.working_set, 'integer bytes, 0 or more');
  const other = Object.keys(r).find((k) => !MEMORY_READING_KEYS.includes(k));
  if (other !== undefined) return `${memoryPath('', other)} is not a field of machine-memory@1: a reading holds only ${MEMORY_READING_KEYS.join(', ')} (a new field is machine-memory@2)`;
  if (r.max !== undefined && !(isBytes(r.max) && r.max > 0)) return memoryIs('max', r.max, 'integer bytes, more than 0, or left out');
  if (r.ceiling !== undefined && !(typeof r.ceiling === 'number' && r.ceiling >= MEMORY_CEILING_MIN && r.ceiling <= MEMORY_CEILING_MAX)) return memoryIs('ceiling', r.ceiling, `a number from ${MEMORY_CEILING_MIN} to ${MEMORY_CEILING_MAX}, or left out`);
  if (r.source !== undefined && !MEMORY_SOURCES.includes(r.source)) return memoryIs('source', r.source, `one of ${MEMORY_SOURCES.join(', ')}, or left out`);
  if (r.partial !== undefined && r.partial !== true) return memoryIs('partial', r.partial, 'true, or left out');
  if (r.sessions !== undefined && !isCount(r.sessions)) return memoryIs('sessions', r.sessions, 'a count of agent sessions, an integer, 0 or more, or left out');
  if (r.kinds !== undefined) {
    if (!memoryIsMap(r.kinds)) return memoryIs('kinds', r.kinds, '{ <kind>: { n, rss } }, or left out');
    for (const [k, e] of Object.entries(r.kinds)) {
      if (!MEMORY_KINDS.includes(k)) return `${memoryPath('kinds', k)} is not a kind: it should be one of ${MEMORY_KINDS.join(', ')}`;
      const p = memoryCountsProblem(memoryPath('kinds', k), e); if (p) return p;
    }
  }
  if (r.devteam !== undefined) {
    if (!memoryIsMap(r.devteam)) return memoryIs('devteam', r.devteam, '{ <subcommand>: { n, rss } }, or left out');
    for (const [k, e] of Object.entries(r.devteam)) {
      if (!MEMORY_SUBCOMMAND.test(k)) return `${memoryPath('devteam', k)} is not a command name: it should be a devteam subcommand, lowercase letters, digits and dashes`;
      const p = memoryCountsProblem(memoryPath('devteam', k), e); if (p) return p;
    }
  }
  if (r.projects !== undefined) {
    if (!memoryIsMap(r.projects)) return memoryIs('projects', r.projects, '{ <instance name>: { rss, sessions?, devteam? } }, or left out');
    for (const [name, e] of Object.entries(r.projects)) {
      const p = memoryPath('projects', name);
      if (name === '') return `${p} is an empty name: a project is keyed by its instance's name`;
      if (!memoryIsMap(e)) return memoryIs(p, e, '{ rss, sessions?, devteam? }');
      if (!isBytes(e.rss)) return memoryIs(`${p}.rss`, e.rss, 'integer bytes, 0 or more');
      if (e.sessions !== undefined && !isCount(e.sessions)) return memoryIs(`${p}.sessions`, e.sessions, 'a count of agent sessions, an integer, 0 or more, or left out');
      if (e.devteam !== undefined) {
        if (!memoryIsMap(e.devteam)) return memoryIs(`${p}.devteam`, e.devteam, '{ <subcommand>: integer bytes }, or left out');
        for (const [k, b] of Object.entries(e.devteam)) {
          if (!MEMORY_SUBCOMMAND.test(k)) return `${memoryPath(`${p}.devteam`, k)} is not a command name: it should be a devteam subcommand, lowercase letters, digits and dashes`;
          if (!isBytes(b)) return memoryIs(memoryPath(`${p}.devteam`, k), b, 'integer bytes, 0 or more');
        }
      }
      const extra = Object.keys(e).find((k) => !MEMORY_PROJECT_KEYS.includes(k));
      if (extra !== undefined) return `${memoryPath(p, extra)} is not a field of ${p}: it holds only ${MEMORY_PROJECT_KEYS.join(', ')}`;
    }
  }
  return null;
}
// The recorder's pure parts (kit-591): they name nothing outside this region, so a test runs them alone.
export const MEMORY_AGENTS = ['claude', 'codex', 'opencode'];
export const MEMORY_BROWSERS = ['chrome', 'chromium', 'headless_shell'];
export const MEMORY_INSTALLERS = ['npm', 'pnpm', 'yarn', 'bundle', 'pip', 'uv'];
export const MEMORY_INSTALLER_SCRIPTS = ['npm-cli.js', 'pnpm.cjs', 'pnpm.js', 'yarn.js'];
export const MEMORY_INSTALLS = ['install', 'i', 'ci', 'add', 'sync'];
export const MEMORY_CMDLINE_MAX = 65536;
export const MEMORY_HOUR = 3600000, MEMORY_DAY = 86400000;
export const memoryBase = (p) => p.split('/').pop();
// A cmdline's words: NUL-separated; a retitled process ("npm ci", "chromium --type=renderer") puts
// its words in argv[0], so argv[0] alone is split on spaces and a later entry (a script path holding
// a space) stays whole. Only the first 64 KB: the kind needs the first few words.
export function memoryWords(cmdline) {
  const argv = String(cmdline).slice(0, MEMORY_CMDLINE_MAX).split('\0');
  if (argv[0].includes(' ')) argv.splice(0, 1, ...argv[0].split(' '));
  return argv.filter((w) => w !== '');
}
// { kind, subcommand? } by the contract's rules: the executable's basename, never comm; node's script
// is its first word not an option; a subcommand only when it is a command name (commands, a Set).
export function memoryClassify(words, commands) {
  if (!words.length) return { kind: 'other' };
  const exe = memoryBase(words[0]);
  if (MEMORY_AGENTS.includes(exe)) return { kind: 'agent' };
  if (MEMORY_BROWSERS.includes(exe)) return { kind: 'browser' };
  if (MEMORY_INSTALLERS.includes(exe)) return { kind: MEMORY_INSTALLS.includes(words[1]) ? 'install' : 'other' };
  if (exe !== 'node') return { kind: 'other' };
  const i = words.findIndex((w, j) => j > 0 && !w.startsWith('-'));
  if (i < 0) return { kind: 'node' };
  const script = memoryBase(words[i]), next = words[i + 1];
  if (script === 'devteam.mjs') return next !== undefined && commands.has(next) ? { kind: 'devteam', subcommand: next } : { kind: 'devteam' };
  if (MEMORY_INSTALLER_SCRIPTS.includes(script) && MEMORY_INSTALLS.includes(next)) return { kind: 'install' };
  return { kind: 'node' };
}
// The known roots, the registry's and the hub's scan's, absolute only and once each, named by the
// hello, else settings.md's project, else the folder; the reading's ceiling is the lowest valid one
// among them (a root with none counts 0.8, as its gate does). settingsOf(root) is the root's settings
// block or null.
export function memoryNameRoots(registry, scanned, settingsOf) {
  // one spelling a root: /c/a/ is /c/a; / itself becomes '' and is dropped as not absolute
  const norm = (r) => (typeof r === 'string' ? r.replace(/\/+$/, '') : null);
  const hello = new Map();
  for (const s of scanned) if (s && typeof s.name === 'string' && s.name && norm(s.root) !== null && !hello.has(norm(s.root))) hello.set(norm(s.root), s.name);
  const all = [...new Set([...registry, ...scanned.map((s) => s && s.root)].map(norm))].filter((r) => typeof r === 'string' && r.startsWith('/'));
  const roots = [];
  let ceiling = Infinity;
  for (const root of all) {
    const s = settingsOf(root) ?? {};
    const c = s.machine_memory_ceiling;
    ceiling = Math.min(ceiling, typeof c === 'number' && c >= MEMORY_CEILING_MIN && c <= MEMORY_CEILING_MAX ? c : 0.8);
    const name = hello.get(root) ?? (typeof s.project === 'string' && s.project ? s.project : memoryBase(root));
    if (name) roots.push({ root, name });
  }
  return { roots, ceiling: ceiling === Infinity ? 0.8 : ceiling };
}
// statm counts pages and node has no page-size call: the nearest of the three sizes to rss over the
// resident pages of the same process.
export function memoryPageSize(residentPages, rssBytes) {
  if (!(residentPages > 0 && rssBytes > 0)) return 4096;
  const per = rssBytes / residentPages;
  return [4096, 16384, 65536].reduce((m, s) => (Math.abs(s - per) < Math.abs(m - per) ? s : m));
}
// The longest root holding cwd: { name, worktree }, worktree when cwd is in <root>/.worktrees/<name>.
export function memoryRootOf(cwd, roots) {
  if (typeof cwd !== 'string') return null;
  let best = null;
  for (const r of roots) {
    if (cwd !== r.root && !cwd.startsWith(`${r.root}/`)) continue;
    if (!best || r.root.length > best.root.length) best = r;
  }
  if (!best) return null;
  return { name: best.name, worktree: /^\.worktrees\/[^/]/.test(cwd.slice(best.root.length + 1)) };
}
// An own key on a plain object, whatever its name: a root named __proto__ or constructor is a
// project like any other (plain assignment would reach Object.prototype instead).
export const memoryOwn = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
// Map entries into a plain object in the Map's order (or in `order`, those present).
export const memoryObject = (m, order = [...m.keys()]) => order.filter((k) => m.has(k)).reduce((o, k) => memoryOwn(o, k, m.get(k)), {});
// procs ({ words, cwd, rss }[], or null with no /proc) into a machine-memory@1 reading, its keys in
// the contract's order; a field the machine couldn't read is left out, never zero.
export function memoryFold(procs, { at, memory, ceiling, roots, commands, partial }) {
  const r = { v: 1, at, working_set: memory.inUse };
  if (memory.max != null) r.max = memory.max;
  if (ceiling != null) r.ceiling = ceiling;
  if (memory.source != null) r.source = memory.source;
  if (partial) r.partial = true;
  if (procs === null) return r;
  let sessions = 0;
  // Maps, not objects: the keys are names (projects, subcommands) and a name may be __proto__
  const kinds = new Map(), devteam = new Map(), projects = new Map();
  const add = (m, k, make) => { if (!m.has(k)) m.set(k, make()); return m.get(k); };
  for (const p of procs) {
    const { kind, subcommand } = memoryClassify(p.words, commands);
    const k = add(kinds, kind, () => ({ n: 0, rss: 0 })); k.n++; k.rss += p.rss;
    if (subcommand) { const d = add(devteam, subcommand, () => ({ n: 0, rss: 0 })); d.n++; d.rss += p.rss; }
    const home = memoryRootOf(p.cwd, roots);
    if (!home) continue;
    const session = kind === 'agent' && home.worktree;
    if (session) sessions++;
    const e = add(projects, home.name, () => ({ rss: 0, sessions: 0, devteam: new Map() }));
    e.rss += p.rss;
    if (session) e.sessions++;
    if (subcommand) e.devteam.set(subcommand, (e.devteam.get(subcommand) ?? 0) + p.rss);
  }
  r.sessions = sessions;
  r.kinds = memoryObject(kinds, MEMORY_KINDS);
  r.devteam = memoryObject(devteam);
  r.projects = {};
  for (const [name, e] of projects) {
    const out = memoryOwn(r.projects, name, { rss: e.rss })[name];
    if (e.sessions) out.sessions = e.sessions;
    if (e.devteam.size) out.devteam = memoryObject(e.devteam);
  }
  return r;
}
// /memory.json's query (params: name to value, an array when repeated) as { from, after?, thin }, or
// { error } in words, the guards in the spec's order. now is ms; loopback is the request's socket.
export function memoryQuery(params, { now, loopback }) {
  const known = ['since', 'after', 'thin'];
  const unknown = Object.keys(params).find((k) => !known.includes(k));
  if (unknown !== undefined) return { error: `${unknown} is not a parameter of /memory.json: it takes ${known.join(', ')}` };
  const repeated = Object.keys(params).find((k) => Array.isArray(params[k]));
  if (repeated !== undefined) return { error: `${repeated} is given more than once: give it once` };
  const { since, after, thin } = params;
  let q;
  if (after !== undefined) {
    if (!memoryAtOk(after)) return { error: `after is ${memoryShown(after)}: it should be a reading's at, YYYY-MM-DDTHH:MM:SSZ in UTC` };
    const t = Date.parse(after);
    if (t > now + 60000) return { error: `after is ${after}, in the future: it should be a time up to 6 hours back` };
    if (t < now - 6 * MEMORY_HOUR) return { error: `after is ${after}, more than 6 hours back: ask since=24h instead` };
    q = { from: t, after: t, window: now - t };
  } else {
    const s = since ?? '24h';
    const m = /^(\d{1,3})([hd])$/.exec(s);
    if (!m) return { error: `since is ${memoryShown(s)}: it should be hours or days, 1 to 3 digits then h or d (24h, 8d)` };
    const window = Number(m[1]) * (m[2] === 'h' ? MEMORY_HOUR : MEMORY_DAY);
    if (window === 0) return { error: `since is ${s}: it should be more than 0` };
    if (window > 8 * MEMORY_DAY) return { error: `since is ${s}: the window is at most 8 days` };
    q = { from: now - window, window };
  }
  if (thin !== undefined && thin !== '0') return { error: `thin is ${memoryShown(thin)}: it should be 0, or left out` };
  if (thin === '0' && !loopback) return { error: 'thin=0 is only for a loopback request' };
  if (thin === '0' && q.window > MEMORY_DAY) return { error: 'thin=0 is only for a window of 24 hours or less' };
  const out = { from: q.from };
  if (q.after !== undefined) out.after = q.after;
  out.thin = q.after === undefined && thin !== '0';
  return out;
}
// Readings 6 hours old or less stay; older ones keep one per 5-minute bucket of their epoch time (30
// past 3 days), the bucket's highest working_set and the earliest of equals, so a peak survives.
export function memoryThin(readings, now) {
  const kept = [], best = new Map();
  for (const r of readings) {
    const t = Date.parse(r.at);
    if (!Number.isFinite(t)) continue;
    const age = now - t;
    if (age <= 6 * MEMORY_HOUR) { kept.push([t, r]); continue; }
    const size = age > 3 * MEMORY_DAY ? 30 * 60000 : 5 * 60000;
    const key = `${size}:${Math.floor(t / size)}`;
    const b = best.get(key);
    if (!b || r.working_set > b[1].working_set || (r.working_set === b[1].working_set && t < b[0])) best.set(key, [t, r]);
  }
  return [...best.values(), ...kept].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
}
// The recorder's I/O parts (kit-591): they name fs, path, os, process and the kit's helpers only
// inside their bodies, run when the hub calls them, so the region still evaluates with nothing in
// scope. memoryWalk names only fs.promises, fs.constants, path, Buffer, setImmediate and setTimeout.
export const MEMORY_BATCH = 50, MEMORY_BUDGET_MS = 2000, MEMORY_CHUNK = 262144;
export const memoryFile = () => path.join(os.homedir(), '.devteam', `machine-${HUB_PORT}`, 'memory.jsonl');
// A root's settings.md json devteam block, read as a file in its working tree: null when missing,
// unreadable or not a JSON object.
export async function memorySettings(root) {
  try {
    const text = await fs.promises.readFile(path.join(root, 'docs', 'devteam', 'project', 'settings.md'), 'utf8');
    const b = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text)?.[1];
    const o = b == null ? null : JSON.parse(b);
    return memoryIsMap(o) ? o : null;
  } catch { return null; }
}
// The known roots (the machine's registry and the hub's scan) named, and the reading's ceiling.
export async function memoryRoots(scanned) {
  let registry = [];
  try { registry = machineRepos(); } catch { registry = []; }
  const list = (Array.isArray(scanned) ? scanned : []).filter((s) => memoryIsMap(s) && typeof s.root === 'string').map((s) => ({ root: s.root, name: typeof s.name === 'string' ? s.name : '' }));
  // read as memoryNameRoots will ask: one spelling a root, absolute only
  const all = [...new Set([...registry, ...list.map((s) => s.root)].filter((r) => typeof r === 'string').map((r) => r.replace(/\/+$/, '')))].filter((r) => r.startsWith('/'));
  const settings = new Map(await Promise.all(all.map(async (r) => [r, await memorySettings(r)])));
  return memoryNameRoots(registry, list, (r) => settings.get(r) ?? null);
}
// One /proc/<pid>: { words, cwd, pages }, or null when it is gone (cmdline or statm missing or
// unreadable, or statm's resident field isn't an integer). The cmdline is read once, to 64 KB at most.
export async function memoryProc(dir) {
  const cmdline = async () => {
    const fh = await fs.promises.open(path.join(dir, 'cmdline'), fs.constants.O_RDONLY);
    try {
      const buf = Buffer.alloc(MEMORY_CMDLINE_MAX);
      const { bytesRead } = await fh.read(buf, 0, MEMORY_CMDLINE_MAX, 0);
      return buf.toString('utf8', 0, bytesRead);
    } finally { await fh.close().catch(() => {}); }
  };
  const resident = async () => {
    const f = (await fs.promises.readFile(path.join(dir, 'statm'), 'utf8')).trim().split(/\s+/)[1];
    if (!/^\d+$/.test(f ?? '')) throw new Error('statm');
    return Number(f);
  };
  const cwd = () => fs.promises.readlink(path.join(dir, 'cwd')).catch(() => null);
  try {
    const [c, pages, wd] = await Promise.all([cmdline(), resident(), cwd()]);
    return { words: memoryWords(c), cwd: wd, pages };
  } catch { return null; }
}
// The walk: { procs: [{ words, cwd, pages }] | null, partial }. Numeric names only, in batches of 50
// with a turn of the event loop between them; before each batch after the first, the seam's delay,
// then the budget (from start, the tick's own start): past it the walk stops, partial. Each batch
// also races what is left of the budget, so a read that never settles (a process stuck in the
// kernel, a hung mount) ends the walk there, partial, with what the batch has read. A procDir that
// can't be listed gives procs null.
export async function memoryWalk(procDir, { budgetMs, slowMs, start }) {
  let names;
  try { names = await fs.promises.readdir(procDir); } catch { return { procs: null, partial: false }; }
  const pids = names.filter((n) => /^\d+$/.test(n));
  const procs = [];
  for (let i = 0; i < pids.length; i += MEMORY_BATCH) {
    if (i > 0) {
      await new Promise((r) => setImmediate(r));
      if (slowMs > 0) await new Promise((r) => setTimeout(r, slowMs));
      if (Date.now() - start >= budgetMs) return { procs, partial: true };
    }
    const got = [];
    const all = Promise.all(pids.slice(i, i + MEMORY_BATCH).map(async (pid) => { const p = await memoryProc(path.join(procDir, pid)); if (p) got.push(p); }));
    // the race's timer is unref'd, so it never holds the process open (clearTimeout isn't one of the
    // walk's names: C3e2 runs it with only setTimeout)
    const late = new Promise((r) => { setTimeout(() => r(true), Math.max(0, budgetMs - (Date.now() - start))).unref?.(); });
    const timedOut = await Promise.race([all.then(() => false), late]);
    // a read still out is left to settle on its own: only what is read by now counts
    procs.push(...got.splice(0));
    if (timedOut) return { procs, partial: true };
  }
  return { procs, partial: false };
}
// A line at the end of the file, on a line of its own: a torn tail (no newline last) is ended first.
export async function memoryAppend(file, line) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  let torn = false;
  let fh = null;
  try {
    fh = await fs.promises.open(file, 'r');
    const { size } = await fh.stat();
    if (size > 0) { const b = Buffer.alloc(1); await fh.read(b, 0, 1, size - 1); torn = b[0] !== 10; }
  } catch (e) { if (e.code !== 'ENOENT') throw e; } finally { await fh?.close().catch(() => {}); }
  await fs.promises.appendFile(file, `${torn ? '\n' : ''}${line}\n`);
}
// One tick: the reading taken now, checked, appended. The line written, or null when the check
// refused it (said through say).
export async function recordMemory({ scan, slowMs = Number(process.env.DEVTEAM_MEMORY_SLOW_MS) || 0, say = () => {} }) {
  const start = Date.now();
  const at = new Date(start).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const memory = machineMemory() ?? { inUse: os.totalmem() - os.freemem(), max: os.totalmem(), source: 'os' };
  let scanned = [];
  try { scanned = await scan(); } catch { scanned = []; }
  const { roots, ceiling } = await memoryRoots(scanned);
  const proc = process.env.DEVTEAM_PROC ?? '/proc';
  const walk = await memoryWalk(proc, { budgetMs: MEMORY_BUDGET_MS, slowMs, start });
  let procs = null;
  if (walk.procs) {
    let own = null;
    try { own = Number((await fs.promises.readFile(path.join(proc, 'self', 'statm'), 'utf8')).trim().split(/\s+/)[1]); } catch { own = null; }
    const size = memoryPageSize(own, process.memoryUsage.rss());
    procs = walk.procs.map((p) => ({ words: p.words, cwd: p.cwd, rss: p.pages * size }));
  }
  // only names the check takes as a subcommand: a command that isn't one is never kept
  const commands = new Set(Object.keys(COMMANDS).filter((k) => MEMORY_SUBCOMMAND.test(k)));
  const line = JSON.stringify(memoryFold(procs, { at, memory, ceiling, roots, commands, partial: walk.partial }));
  const problem = memoryReadingProblem(line);
  if (problem) { say(`a reading the check refuses, not written: ${problem}`); return null; }
  await memoryAppend(memoryFile(), line);
  return line;
}
// The file keeps 8 days: lines that are a JSON object with a valid at that recent, whatever their v;
// torn and undatable lines go. Written to a temp file, then renamed over it.
export async function memoryTrim(file, now) {
  let text;
  try { text = await fs.promises.readFile(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  const keep = text.split('\n').filter((l) => {
    let r;
    try { r = JSON.parse(l); } catch { return false; }
    return memoryIsMap(r) && memoryAtOk(r.at) && Date.parse(r.at) >= now - 8 * MEMORY_DAY;
  });
  const out = keep.map((l) => `${l}\n`).join('');
  if (out === text) return;
  const tmp = `${file}.tmp`;
  // a write or rename that fails part-way leaves the file as it was, and no temp file beside it
  try {
    await fs.promises.writeFile(tmp, out);
    await fs.promises.rename(tmp, file);
  } catch (e) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw e;
  }
}
// The readings at or after from (ms), oldest first, the ones the check passes: the file read from
// its end in 256 KB chunks, until a chunk whose first complete dated line is before from.
export async function memoryWindow(file, from) {
  let fh;
  try { fh = await fs.promises.open(file, 'r'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  try {
    let pos = (await fh.stat()).size;
    let carry = Buffer.alloc(0);
    const chunks = [];
    while (pos > 0) {
      const n = Math.min(MEMORY_CHUNK, pos);
      pos -= n;
      const b = Buffer.alloc(n);
      let got = 0;
      while (got < n) { const { bytesRead } = await fh.read(b, got, n - got, pos + got); if (!bytesRead) break; got += bytesRead; }
      const buf = Buffer.concat([b.subarray(0, got), carry]);
      const parts = [];
      for (let s = 0, e; s <= buf.length; s = e + 1) { e = buf.indexOf(10, s); if (e < 0) e = buf.length; parts.push(buf.subarray(s, e)); }
      // the first part may be the end of a line the next chunk back begins
      carry = pos > 0 ? Buffer.from(parts.shift()) : Buffer.alloc(0);
      const kept = [];
      let first = null;
      for (const part of parts) {
        if (!part.length) continue;
        let r;
        try { r = JSON.parse(part.toString('utf8')); } catch { continue; }
        if (!memoryIsMap(r) || !memoryAtOk(r.at)) continue;
        const t = Date.parse(r.at);
        if (first === null) first = t;
        if (t >= from && memoryReadingProblem(r) === null) kept.push(r);
      }
      chunks.push(kept);
      if (first !== null && first < from) break;
    }
    return chunks.reverse().flat();
  } finally { await fh.close().catch(() => {}); }
}
// /memory.json: the query (a repeated key an array; every key its own, __proto__ included), the
// window, thinned unless asked not to, as { v: 1, readings }.
export async function serveMemory(req, send) {
  const params = Object.create(null);
  for (const [k, v] of new URL(req.url, 'http://127.0.0.1').searchParams) memoryOwn(params, k, Object.hasOwn(params, k) ? [].concat(params[k], v) : v);
  const now = Date.now();
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const q = memoryQuery(params, { now, loopback });
  if (q.error) return send(400, 'application/json', JSON.stringify({ error: q.error }));
  let readings = await memoryWindow(memoryFile(), q.from);
  if (q.after !== undefined) readings = readings.filter((r) => Date.parse(r.at) > q.after);
  if (q.thin) readings = memoryThin(readings, now);
  return send(200, 'application/json', JSON.stringify({ v: 1, readings }));
}
// The hub's recorder: a trim then a tick at start, a tick a minute and a trim a day after, one at a
// time in one chain (a tick due while one is still running is skipped); each distinct error said once
// in the hub's log, never thrown. Off (both no-ops) where DEVTEAM_MEMORY_RECORD is off (tests). The
// timers are unref'd: the hub's server keeps the process alive. stop() is for good. say is the
// once-logger, for the route's own errors too (on whether the recorder is on or off).
export function memoryRecorder(log, scan) {
  const said = new Set();
  const say = (m) => { if (!said.has(m)) { said.add(m); log(`hub: memory: ${m}`); } };
  if (process.env.DEVTEAM_MEMORY_RECORD === 'off') return { start() {}, stop() {}, say };
  const seam = (k, d) => { const v = process.env[k]; const n = Number(v); return v?.trim() && Number.isFinite(n) && n >= 0 ? n : d; };
  let started = false, stopped = false, ticking = false, trimming = false, slowMs = 0;
  let chain = Promise.resolve();
  const timers = [];
  const run = (job) => { chain = chain.then(() => (stopped ? undefined : job())).catch((e) => say(e?.message ?? String(e))); };
  const trim = () => {
    if (trimming || stopped) return;
    trimming = true;
    run(async () => { try { await memoryTrim(memoryFile(), Date.now()); } finally { trimming = false; } });
  };
  const tick = () => {
    if (ticking || stopped) return;
    ticking = true;
    run(async () => { try { await recordMemory({ scan, slowMs, say }); } finally { ticking = false; } });
  };
  return {
    start() {
      if (started || stopped) return;
      started = true;
      const every = seam('DEVTEAM_MEMORY_EVERY_MS', 60000) || 60000;
      const trimEvery = seam('DEVTEAM_MEMORY_TRIM_MS', 86400000) || 86400000;
      slowMs = seam('DEVTEAM_MEMORY_SLOW_MS', 0);
      trim();
      tick();
      timers.push(setInterval(tick, every), setInterval(trim, trimEvery));
      for (const t of timers) t.unref();
    },
    stop() { stopped = true; for (const t of timers) clearInterval(t); timers.length = 0; },
    say,
  };
}
/* box-memory end */
