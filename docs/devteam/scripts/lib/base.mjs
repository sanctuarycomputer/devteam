/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { deliverNudges } from './sessions.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isObj } from './artifact-notes.mjs';
import { loadSettings } from './settings.mjs';
import { mainRoot } from './state.mjs';
import { runDir } from './state.mjs';
import { sha256 } from './lens.mjs';
import { spawnSync } from 'node:child_process';
/* imports end */
// devteam: the one script. Node 18+, built-ins only.
//   node docs/devteam/scripts/devteam.mjs <command> [args]      (`help` lists the commands)
//
// Everything structured about a project is a line in the log (schema/log.schema.json), folded by
// time. Everything prose is markdown. This file validates and folds the log, computes the graph,
// status, metrics, roadmap and dashboard from it, runs the checks the supervisor merges on, makes
// worker sessions, serves the dashboard, and gives every role its commands.
//
// Sections: 1 helpers · 2 settings · 3 schema and log · 4 git facts · 5 graph · 6 reviews and the
// definition of done · 7 trust · 8 decide and act · 9 goals, roadmap, retros · 10 metrics and the
// dashboard · 11 sessions (workers, messages, phases, gates) · 12 init, help, dispatch.


// ===== 1. helpers =====

// Projects pin their own Node (asdf, nvm), and the dashboard reruns this file with that Node, so
// say plainly when it is too old instead of failing mid-command. Use nothing newer than Node 18.
if (Number(process.versions.node.split('.')[0]) < 18) {
  process.stderr.write(`devteam: needs Node 18 or newer; this is ${process.version} (check the project's .tool-versions, .nvmrc or .node-version)\n`);
  process.exit(1);
}

// A worktree's branch carries the kit as it was when the branch forked, but every session writes the
// one live log and answers to the rules on main, so in a project the main checkout's copy runs: a
// worker on an old branch otherwise gets old commands (an "unknown command" for one the docs name)
// and folds the log by old rules. Only where the main checkout holds a project (not the kit's own
// repo, whose worktrees are where the kit is changed); DEVTEAM_OWN_KIT=1 runs this copy anyway.
{
  const self = fileURLToPath(import.meta.url);
  let common = null;
  let top = null;
  // asked of the script's own folder, never of the caller's repo: git sets GIT_DIR for a hook and for
  // rebase --exec, and with it would take the script's folder for a checkout's top level
  const scriptGit = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE'].includes(k)));
  try { [common, top] = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir', '--show-toplevel'], { cwd: path.dirname(self), env: scriptGit, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n'); } catch {}
  // A kit copied into a folder inside another checkout with no repo of its own (a fixture made
  // without git init) would take that checkout's git, and so its kit, home and live log: a kit in a
  // repo runs only as that checkout's own docs/devteam. (A kit in no repo, as a box image's, is free.)
  const cmd = process.argv[2];
  const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  if (top && cmd && !['help', '--help'].includes(cmd) && real(path.join(top, 'docs', 'devteam', 'scripts')) !== real(path.dirname(self))) {
    process.stderr.write(`devteam: this kit (${self}) is not its checkout's own (${path.join(top, 'docs', 'devteam')}): a copy inside another repo can't run against that repo's home; give the copy a repo of its own (git init)\n`);
    process.exit(1);
  }
  const kitMain = common && path.join(path.dirname(common), 'docs', 'devteam');
  const mainScript = kitMain && path.join(kitMain, 'scripts', 'devteam.mjs');
  if (mainScript && !process.env.DEVTEAM_OWN_KIT && path.resolve(mainScript) !== path.resolve(self) && fs.existsSync(path.join(kitMain, 'project')) && fs.existsSync(mainScript) && fs.readFileSync(mainScript, 'utf8') !== fs.readFileSync(self, 'utf8')) {
    const r = spawnSync(process.execPath, [mainScript, ...process.argv.slice(2)], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
}

// Object.groupBy is Node 21+.
export const groupBy = (xs, key) => { const o = {}; for (const x of xs) (o[key(x)] ??= []).push(x); return o; };

process.stdout.on('error', (e) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

export const argv = process.argv.slice(2);
export const command = argv.shift();

/* args start */
// Flags take every following non-flag token as their value(s); put positionals before flags.
// --key=value takes the value whole, so a value that starts with -- can be passed.
// Everything after a bare `--` is left for commands that run another command (gate, act, link set).
export function parseArgs(args) {
  const flags = {};
  const positional = [];
  const dash = args.indexOf('--');
  const own = dash === -1 ? args : args.slice(0, dash);
  for (let i = 0; i < own.length; i++) {
    const a = own[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq > 2 ? a.slice(2, eq) : a.slice(2);
      const values = eq > 2 ? [a.slice(eq + 1)] : [];
      while (i + 1 < own.length && !own[i + 1].startsWith('--')) values.push(own[++i]);
      flags[key] = values.length === 0 ? true : values.length === 1 ? values[0] : values;
    } else positional.push(a);
  }
  return { flags, positional, rest: dash === -1 ? null : args.slice(dash + 1) };
}
/* args end */

export const { flags, positional, rest } = parseArgs(argv);
export const asList = (v) => (v === undefined || v === true ? [] : Array.isArray(v) ? v : [v]);
// A list flag: separate values, or one JSON array of strings. A single value that starts with "["
// but is not one is refused rather than stored as one item.
export const listFlag = (k) => {
  const v = flags[k];
  if (typeof v !== 'string' || !v.trim().startsWith('[')) return asList(v);
  let parsed;
  try { parsed = JSON.parse(v); } catch { parsed = null; }
  if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'string')) die(`--${k}: "${v}" looks like JSON but is not an array of strings; pass a JSON array of strings ('["a","b"]') or separate values ("a" "b")`);
  return parsed;
};
export const flagStr = (k) => (flags[k] === undefined || flags[k] === true ? undefined : Array.isArray(flags[k]) ? flags[k].join(' ') : String(flags[k]));
export const flagNum = (k) => (flagStr(k) === undefined ? undefined : Number(flagStr(k)));

export function die(msg, code = 1) {
  process.stderr.write(`devteam: ${msg}\n`);
  // a line already logged is still announced: a partly posted set of secrets dies after its nudge
  deliverNudges();
  process.exit(code);
}
export const warn = (msg) => process.stderr.write(`devteam: warning: ${msg}\n`);
export const out = (s) => process.stdout.write(`${s}\n`);
// An owner action the dashboard runs replies on a pipe of its own (DEVTEAM_REPLY_FD) as soon as
// the command is done, with what it printed, and only then types into the supervisor's pane: a
// slow tmux never holds the owner's press. Read once and taken out of the environment, so nothing
// this process starts (a secret's sink) can write to the pipe.
export const REPLY_FD = (() => { const v = process.env.DEVTEAM_REPLY_FD; delete process.env.DEVTEAM_REPLY_FD; return /^[3-9]$/.test(v ?? '') ? Number(v) : null; })();
export let printed = '';
if (REPLY_FD !== null) { const write = process.stdout.write.bind(process.stdout); process.stdout.write = (c, ...rest) => { printed += String(c); return write(c, ...rest); }; }
export const queuedNudges = [];
export function replyNow() {
  if (REPLY_FD === null) return;
  try { fs.writeSync(REPLY_FD, `${JSON.stringify({ out: printed })}\n`); fs.closeSync(REPLY_FD); } catch {}
}
export const json = (x) => out(JSON.stringify(x, null, 2));
export const nowIso = () => new Date().toISOString();
export const dateOnly = (iso) => iso.slice(0, 10);
export const DAY = 864e5;

/* git reads start */
// A read-only command (dashboard-data, timeline) caches identical git reads for the rest of the
// process: one refresh asked git the same questions hundreds of times. Commands that write never
// turn this on, so they always read live.
export let gitReadCache = null;
// Where a git call with no cwd runs: home's main checkout when this command runs outside home (a
// worker in another repo's worktree), else undefined, the cwd, as always (set in section 2).
export let HOME_CWD;
export const GIT_READS = new Set(['rev-parse', 'show', 'ls-tree', 'tag', 'merge-base', 'cat-file', 'log', 'for-each-ref', 'symbolic-ref', 'diff', 'rev-list', 'status']);
export function git(args, cwd = HOME_CWD) {
  const key = gitReadCache && GIT_READS.has(args[0]) ? `${cwd ?? ''}\0${args.join('\0')}` : null;
  if (key && gitReadCache.has(key)) return gitReadCache.get(key);
  let r;
  try {
    r = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).replace(/\n$/, '');
  } catch {
    r = null;
  }
  if (key) gitReadCache.set(key, r);
  return r;
}
export function gitOrDie(args, cwd = HOME_CWD) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    die(`git ${args.join(' ')} failed: ${(e.stderr || e.message).toString().trim()}`);
  }
}
// This checkout's own HEAD, branch and working tree, wherever it is: a worker in another repo's
// worktree records its own head, while every other read goes to home (HOME_CWD).
export const cwdGit = (args) => git(args, process.cwd());
export const cwdGitOrDie = (args) => gitOrDie(args, process.cwd());
// git's exit status and its bytes: the one runner that tells "no" (an ancestor check's 1) from an
// error (128, an object not here yet), which git() folds into one null.
export function gitStatus(args, cwd = HOME_CWD) {
  const r = spawnSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? Buffer.alloc(0) };
}
// What `git cat-file --batch` printed, as a Map of each spec to { type, oid, bytes }, or null for a
// spec git called missing or ambiguous. Sizes are in bytes, so the output is read as bytes; output
// cut short leaves the rest null, never a slice of the next object.
export function parseBatch(buf, specs) {
  const res = new Map(specs.map((s) => [s, null]));
  let at = 0;
  for (const spec of specs) {
    const nl = buf.indexOf(10, at);
    if (nl === -1) break;
    const head = buf.toString('latin1', at, nl).split(' ');
    at = nl + 1;
    if (head.length !== 3 || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(head[0])) continue; // "<spec> missing"
    const size = Number(head[2]);
    if (!Number.isSafeInteger(size) || at + size + 1 > buf.length) break;
    res.set(spec, { oid: head[0], type: head[1], bytes: buf.subarray(at, at + size) });
    at += size + 1;
  }
  return res;
}
// Many objects in one git call (each spec <sha>:<path> or an oid). A spec with a newline is never
// sent (it would be two specs). A failed call returns null: the caller asks one at a time.
export function gitBatch(specs, cwd = HOME_CWD) {
  const ok = specs.filter((s) => !/[\n\r]/.test(s));
  let buf = Buffer.alloc(0);
  if (ok.length) {
    try { buf = execFileSync('git', ['cat-file', '--batch'], { cwd, input: `${ok.join('\n')}\n`, stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 }); } catch { return null; }
  }
  const got = parseBatch(buf, ok);
  return new Map(specs.map((s) => [s, got.get(s) ?? null]));
}
// Reads at a commit, kept for the whole process in every command: a sha names the same bytes
// forever, so even a command that writes can't read them stale. Keyed by the repository (its
// common git dir, so its worktrees share), the sha and the path. Text comes back as git() gives it:
// one trailing newline taken off.
export const FULL_SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
export const commonDirs = new Map();
export function gitCommonDirOf(cwd = HOME_CWD) {
  const k = cwd ?? process.cwd();
  if (!commonDirs.has(k)) commonDirs.set(k, git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd) ?? k);
  return commonDirs.get(k);
}
export const atCommit = new Map();
export const atKey = (sha, p, cwd) => `${gitCommonDirOf(cwd)}\0${sha}\0${p}`;
export const asGitText = (o) => (o ? o.bytes.toString('utf8').replace(/\n$/, '') : null);
export function prefetchAt(sha, paths, cwd = HOME_CWD) {
  if (!FULL_SHA.test(sha ?? '')) return;
  const need = [...new Set(paths)].filter((p) => !/[\n\r]/.test(p) && !atCommit.has(atKey(sha, p, cwd)));
  if (!need.length) return;
  const got = gitBatch(need.map((p) => `${sha}:${p}`), cwd);
  if (!got) return;
  for (const p of need) { const o = got.get(`${sha}:${p}`); atCommit.set(atKey(sha, p, cwd), o && o.type === 'blob' ? o : null); }
}
// A file at a commit, as `git show <sha>:<path>` gives it through git(). Not a full sha: asked live.
export function showAt(sha, p, cwd = HOME_CWD) {
  if (!FULL_SHA.test(sha ?? '')) return git(['show', `${sha}:${p}`], cwd);
  const k = atKey(sha, p, cwd);
  if (!atCommit.has(k)) prefetchAt(sha, [p], cwd);
  return atCommit.has(k) ? asGitText(atCommit.get(k)) : git(['show', `${sha}:${p}`], cwd);
}
/* git reads end */

/* git facts start */
// Git's answers that never change, kept across processes in run/cache/git-facts.json: a commit's
// date, whether one commit is an ancestor of another, the first release that holds a commit. Each
// is keyed by everything it depends on (the repository, full shas, and for ancestry and releases
// whether the clone is shallow; for releases the pattern and the tag list), and only a definite
// answer is kept: an error (an object not fetched yet) is asked again next time. A cache of what git
// computes, never a record (constitution: compute state, don't record it); deleting it costs time.
// The file is the machine user's, like the rest of run/: anything running as that user could
// write a wrong answer into it, as it could into the repository itself.
export const factsFile = () => path.join(runDir, 'cache', 'git-facts.json');
// Answers against main move with main (every refresh asks about main's newest commit), so the store
// keeps the most recently used, oldest dropped first.
export const FACTS_MAX = 20000;
export const factsIn = () => { try { const j = readJson(factsFile()); return j?.v === 1 && isObj(j.e) ? j.e : {}; } catch { return {}; } };
export let factStore = null;
export let factsAdded = {};
export const factsUsed = new Set();
export let factsSaving = false;
// Written at exit, once: when this process added an answer, or used some while the store is near its
// cap (then what was used must move to the end, or the cap would drop it). Read again first and
// ours added: another process may have written since; a race loses an addition only. What this
// process used goes to the end, so the cap drops what nobody has asked for longest. The box
// operator only reads, so its facts last only as long as its process.
export function factsSaveAtExit() {
  if (factsSaving || process.env.DEVTEAM_ROLE === 'operator') return;
  factsSaving = true;
  process.on('exit', () => {
    try {
      const e = factsIn();
      for (const k of factsUsed) { const val = Object.hasOwn(factsAdded, k) ? factsAdded[k] : Object.hasOwn(e, k) ? e[k] : factStore[k]; delete e[k]; if (val !== undefined) e[k] = val; }
      const keys = Object.keys(e);
      for (const k of keys.slice(0, Math.max(0, keys.length - FACTS_MAX))) delete e[k];
      writeJson(factsFile(), { v: 1, e });
    } catch {}
  });
}
export let factsCount = 0;
export function factGet(k) {
  if (!factStore) { factStore = factsIn(); factsCount = Object.keys(factStore).length; }
  if (!Object.hasOwn(factStore, k)) return undefined;
  factsUsed.add(k);
  if (factsCount > FACTS_MAX * 0.8) factsSaveAtExit();
  return factStore[k];
}
export function factSet(k, v) {
  factGet(k);
  factStore[k] = v;
  factsUsed.add(k);
  factsAdded[k] = v;
  factsSaveAtExit();
}
export const perRepo = (fn) => { const m = new Map(); return (cwd) => { const k = gitCommonDirOf(cwd); if (!m.has(k)) m.set(k, fn(cwd)); return m.get(k); }; };
// a clone's cut, as git keeps it (the commits at its edge): empty for a whole clone, and different
// after every deepen, so an answer from before a deepen is asked again
export const shallowOf = perRepo((cwd) => { try { return sha256(fs.readFileSync(path.join(gitCommonDirOf(cwd), 'shallow'))).slice(0, 16); } catch { return ''; } });
export const tagPrintOf = perRepo((cwd) => sha256(git(['for-each-ref', '--format=%(refname)%00%(objectname)', 'refs/tags'], cwd) ?? ''));
export const fullShaOf = (x, cwd) => (FULL_SHA.test(x ?? '') ? x : x ? git(['rev-parse', '--verify', '--quiet', `${x}^{commit}`], cwd) : null);
// A commit's date in ms, or NaN.
export function commitDateOf(sha, cwd = HOME_CWD) {
  const full = fullShaOf(sha, cwd);
  if (!full) return NaN;
  const k = `d\0${gitCommonDirOf(cwd)}\0${full}`;
  const kept = factGet(k);
  if (kept !== undefined) return kept;
  const r = gitStatus(['show', '-s', '--format=%cI', full], cwd);
  const t = r.status === 0 ? Date.parse(r.stdout.toString('utf8').trim()) : NaN;
  if (!Number.isNaN(t)) factSet(k, t);
  return t;
}
// Whether a is an ancestor of b (or is b): true, false, or null when git couldn't say.
export function ancestorOf(a, b, cwd = HOME_CWD) {
  const A = fullShaOf(a, cwd);
  const B = fullShaOf(b, cwd);
  if (!A || !B) return null;
  const k = `a\0${gitCommonDirOf(cwd)}\0${shallowOf(cwd)}\0${A}\0${B}`;
  const kept = factGet(k);
  if (kept !== undefined) return kept;
  const { status } = gitStatus(['merge-base', '--is-ancestor', A, B], cwd);
  if (status !== 0 && status !== 1) return null;
  factSet(k, status === 0);
  return status === 0;
}
// The first tag matching pattern (default v*), not a release candidate, that contains sha.
export function releasedInAt(sha, pattern = 'v*', cwd = HOME_CWD) {
  const full = fullShaOf(sha, cwd);
  if (!full) return null;
  const k = `r\0${gitCommonDirOf(cwd)}\0${shallowOf(cwd)}\0${tagPrintOf(cwd)}\0${pattern}\0${full}`;
  const kept = factGet(k);
  if (kept !== undefined) return kept;
  const r = gitStatus(['tag', '--contains', full, '--list', pattern, '--sort=creatordate'], cwd);
  if (r.status !== 0) return null;
  const tag = r.stdout.toString('utf8').split('\n').find((t) => t && !/-rc/.test(t)) ?? null;
  factSet(k, tag);
  return tag;
}
/* git facts end */
// tmux gets a time limit unless the caller set one: a tmux call that never returns (send-keys has hung
// for hours on a box) would otherwise wedge whatever called it, a dashboard's tick included.
export const TMUX_TIMEOUT_MS = 30000;
export function sh(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...(cmd === 'tmux' ? { timeout: TMUX_TIMEOUT_MS } : {}), ...opts }).trim();
  } catch {
    return null;
  }
}
// The tmux session that holds this project's workers and planners: settings.tmux_session when set;
// else the name saved in run/tmux-session; else devteam-<project>-<hash>, so two projects on one machine
// never share a session. A project whose live sessions already sit in a `devteam` session (the
// default before) keeps it. Resolving writes nothing, except to keep that legacy name: the name is
// saved when the kit creates the session (save), so a read-only command, or CI, never writes run/.
// This project's windows in a tmux session: the kit starts each worker or planner in its worktree
// (-c), so a window is ours when it started under this checkout's .worktrees/, whatever its name;
// another project's window named like one of our tickets never counts.
export function ourWindows(session) {
  // list-panes -s answers for another session when this one doesn't exist, so a project with no
  // legacy `devteam` session (a new box) would find its own windows there and take that name.
  if (sh('tmux', ['has-session', '-t', `=${session}`]) === null) return [];
  // Compared resolved: tmux keeps the path as it was given (on macOS /var is /private/var).
  const roots = [`${path.join(fs.realpathSync(mainRoot), '.worktrees')}${path.sep}`];
  // Every pane, not only the active one: a worker window the owner split keeps counting.
  const panes = (sh('tmux', ['list-panes', '-s', '-t', `=${session}`, '-F', '#W\t#{pane_start_path}']) ?? '').split('\n').filter(Boolean)
    .map((l) => { const i = l.indexOf('\t'); const p = l.slice(i + 1); let real = p; try { real = fs.realpathSync(p); } catch {} return { name: l.slice(0, i), start: `${real}${path.sep}` }; });
  // A dev~ window is a preview's server (cmdPreview), not a session.
  return [...new Set(panes.filter((w) => !w.name.startsWith('dev~') && roots.some((r) => w.start.startsWith(r))).map((w) => w.name))].map((name) => ({ name }));
}
export let tmuxSessionName = null;
export function tmuxSession({ save = false } = {}) {
  const s = loadSettings();
  if (s.tmux_session) return s.tmux_session;
  if (tmuxSessionName && !save) return tmuxSessionName;
  const file = path.join(runDir, 'tmux-session');
  const saved = readText(file)?.trim();
  if (saved) return (tmuxSessionName = saved);
  // Not liveSessions(): it lists windows, which asks this function. Named after the project and
  // this checkout's path, so two clones of one repo (or two repos with one name) never share either.
  const keep = ourWindows('devteam').length > 0;
  const name = keep ? 'devteam' : `devteam-${slug(s.project ?? path.basename(mainRoot))}-${crypto.createHash('sha1').update(fs.realpathSync(mainRoot)).digest('hex').slice(0, 6)}`;
  // A legacy name is found and used on every call, and saved only by a start (save: every caller that
  // opens a window passes it), never by a read: a GET of the dashboard runs reads, and changes nothing
  // (kit-339). A start while the legacy windows are open saves it, so it can't flip once they close.
  if (save) { fs.mkdirSync(runDir, { recursive: true }); fs.writeFileSync(file, `${name}\n`); }
  return (tmuxSessionName = name);
}
// A window of this project's session, matched exactly: tmux would otherwise take a prefix, so
// `devteam` would find `devteam-<another project>`.
export const tmuxTarget = (window) => `=${tmuxSession()}:${window}`;

export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const readText = (p) => (fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf8') : null);
export function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  fs.renameSync(tmp, p);
}
export const median = (xs) => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
export const hours = (ms) => (ms === null ? null : +(ms / 3600000).toFixed(1));
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';

// ===== 2. locations and settings =====

