#!/usr/bin/env node
// The kit's test runner: node test/run.mjs [options] [file…]
//
// Runs the named test files, or every test/*.test.mjs, each in a process of its own:
// `node --test --test-reporter=tap <file>`, from the repo root, in a process group of its own. Each
// file's TAP is printed whole, under a `# <file>` header, when the file ends; a summary follows.
// It exits 0 only when every file's process exited 0 on every run; 1 on any failure or timeout,
// 2 on a usage error, 128 + the signal's number when interrupted. Node 18.15 or later (for
// --test-reporter), built-ins only.
//
//   --concurrency n      files at once (default DEVTEAM_TEST_CONCURRENCY, else 2). Files in the
//                        `alone` group run one at a time before any other.
//   --chrome-concurrency n
//                        files of the `chrome` group at once, within --concurrency: each starts a
//                        headless Chrome, so off CI they run one at a time while other files run
//                        beside them. Default DEVTEAM_TEST_CHROME_CONCURRENCY; else, when CI is set
//                        (to anything but empty, 0 or false), --concurrency; else 1.
//   --file-timeout s     every file's watchdog, in seconds. Without it: 600 for `chain` and for the
//                        files in LONG below, 300 for the rest. A file past its timeout is stopped
//                        and killed with its whole process tree, its tmux servers are killed and its
//                        temp folder removed, and the run fails with
//                        "timed out: <file> after <s> s (last test finished: <name>)". A file that
//                        took over 5/6 of its timeout is flagged "near timeout" in the summary.
//                        No --test-timeout is passed to node: the watchdog is the hang guard.
//   --group g[,g…]       only files in these groups, read from the files themselves:
//                          chain   test/kit.test.mjs
//                          alone   the files in ALONE below
//                          chrome  a file that imports ./lib/chrome.mjs
//                          rest    every other file
//   --shard i/n          the i-th of n shards (n from 1 to 4), dealt greedily by the weights in
//                        test/timings.json (an unlisted file weighs the median). Stale weights cost
//                        balance, never a file.
//   --list               print the chosen files with their groups and timeouts; run nothing
//   --repeat n           run every chosen file n times; a failure on any run fails, and says which
//   --timings out.json   write each file's wall seconds, in test/timings.json's shape
//
// Each file runs with TMPDIR set to a scratch folder of its own (under /tmp/dtr- where /tmp is
// writable), removed when the file ends, and DEVTEAM_TEST_SHARED_TMP naming the shared temp dir
// (port locks, the compile cache, and this runner's own tmux shim, which refuses tmux to any
// process whose private tmux folder is gone). SIGINT, SIGTERM and SIGHUP clean up every running
// file the same way before the runner exits.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
export const ROOT = fs.realpathSync(path.resolve(path.dirname(here), '..'));
export const ALONE = ['test/bounds.test.mjs'];
// Files known to run longer than 300 s, until kit-210 splits it.
export const LONG = { 'test/dashboard.test.mjs': 600 };
export const GROUPS = ['chain', 'alone', 'chrome', 'rest'];
export class UsageError extends Error {}

const posInt = (flag, v, min = 1, max = Number.MAX_SAFE_INTEGER) => {
  if (!/^\d+$/.test(v ?? '') || Number(v) < min || Number(v) > max) throw new UsageError(`${flag} wants a whole number from ${min}${max < Number.MAX_SAFE_INTEGER ? ` to ${max}` : ' up'}, not ${JSON.stringify(v ?? '')}`);
  return Number(v);
};
const relOf = (root, abs) => {
  const rel = path.relative(root, abs);
  return rel.startsWith('..') || path.isAbsolute(rel) ? abs : rel.split(path.sep).join('/');
};

// CI is a machine of its own: there the chrome group keeps the run's concurrency
export const isCI = (env) => !!env.CI && !/^(0|false)$/i.test(env.CI);

export function parseArgs(argv, env, root = ROOT) {
  const o = { files: [], groups: null, shard: null, list: false, repeat: 1, timings: null, concurrency: null, chromeConcurrency: null, fileTimeout: null };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    const val = () => { if (k + 1 >= argv.length) throw new UsageError(`${a} wants a value`); return argv[++k]; };
    if (a === '--list') o.list = true;
    else if (a === '--concurrency') o.concurrency = posInt(a, val());
    else if (a === '--chrome-concurrency') o.chromeConcurrency = posInt(a, val());
    // a day at most: setTimeout can't count past about 24.8 days, and no file needs a day
    else if (a === '--file-timeout') o.fileTimeout = posInt(a, val(), 1, 86400);
    else if (a === '--repeat') o.repeat = posInt(a, val());
    else if (a === '--timings') o.timings = val();
    else if (a === '--group') {
      o.groups = val().split(',').map((g) => g.trim()).filter(Boolean);
      const bad = o.groups.filter((g) => !GROUPS.includes(g));
      if (bad.length || !o.groups.length) throw new UsageError(`--group takes ${GROUPS.join(', ')}, not ${JSON.stringify(bad.join(',') || '')}`);
    } else if (a === '--shard') {
      const m = /^(\d+)\/(\d+)$/.exec(val());
      const i = m && Number(m[1]), n = m && Number(m[2]);
      if (!m || n < 1 || n > 4 || i < 1 || i > n) throw new UsageError(`--shard wants i/n with n from 1 to 4 and i from 1 to n, not ${JSON.stringify(argv[k])}`);
      o.shard = { i, n };
    } else if (a.startsWith('-')) throw new UsageError(`unknown option ${a}`);
    else {
      let real;
      try { real = fs.realpathSync(a); } catch { throw new UsageError(`no such file: ${a}`); }
      if (!fs.statSync(real).isFile()) throw new UsageError(`not a file: ${a}`);
      const rel = relOf(root, real);
      if (!o.files.includes(rel)) o.files.push(rel);
    }
  }
  if (o.concurrency === null) o.concurrency = env.DEVTEAM_TEST_CONCURRENCY ? posInt('DEVTEAM_TEST_CONCURRENCY', env.DEVTEAM_TEST_CONCURRENCY) : 2;
  if (o.chromeConcurrency === null) o.chromeConcurrency = env.DEVTEAM_TEST_CHROME_CONCURRENCY ? posInt('DEVTEAM_TEST_CHROME_CONCURRENCY', env.DEVTEAM_TEST_CHROME_CONCURRENCY) : isCI(env) ? o.concurrency : 1;
  return o;
}

const CHROME_STATIC = /^\s*import\b[^;]*?['"]\.\/lib\/chrome\.mjs['"]/m;
// A dynamic import with no quote before it on its line, so one named inside a string isn't one.
// What that gives up: a dynamic import after a quote on the same line (`if (x === '1') await
// import(...)`) groups as rest. Put such an import on a line of its own; no kit file has one.
const CHROME_DYNAMIC = /^[^'"`\n]*\bimport\(\s*['"]\.\/lib\/chrome\.mjs['"]\s*\)/m;
export function groupOf(rel, src) {
  if (rel === 'test/kit.test.mjs') return 'chain';
  if (ALONE.includes(rel)) return 'alone';
  if (CHROME_STATIC.test(src) || CHROME_DYNAMIC.test(src)) return 'chrome';
  return 'rest';
}

export function timeoutOf(rel, group, override) {
  if (override) return override;
  return group === 'chain' ? 600 : LONG[rel] ?? 300;
}
export const nearTimeout = (seconds, timeout) => seconds > (timeout * 5) / 6;

export function weightsFor(files, timingsFiles) {
  const listed = files.map((f) => timingsFiles?.[f]).filter((w) => typeof w === 'number' && w >= 0).sort((a, b) => a - b);
  const mid = listed.length ? (listed.length % 2 ? listed[(listed.length - 1) / 2] : (listed[listed.length / 2 - 1] + listed[listed.length / 2]) / 2) : 1;
  return new Map(files.map((f) => [f, typeof timingsFiles?.[f] === 'number' && timingsFiles[f] >= 0 ? timingsFiles[f] : mid]));
}

export function shard(files, weights, n) {
  const order = [...files].sort((a, b) => weights.get(b) - weights.get(a) || (a < b ? -1 : a > b ? 1 : 0));
  const shards = Array.from({ length: n }, () => ({ total: 0, files: [] }));
  for (const f of order) {
    let best = shards[0];
    for (const s of shards) if (s.total < best.total) best = s;
    best.files.push(f);
    best.total += weights.get(f);
  }
  return shards.map((s) => s.files);
}

const readTimings = (root) => { try { return JSON.parse(fs.readFileSync(path.join(root, 'test', 'timings.json'), 'utf8')).files ?? {}; } catch { return {}; } };
export function planRun(opts, root = ROOT) {
  const files = opts.files?.length ? opts.files : fs.readdirSync(path.join(root, 'test')).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => `test/${f}`);
  let chosen = files.map((file) => {
    const group = groupOf(file, fs.readFileSync(path.isAbsolute(file) ? file : path.join(root, file), 'utf8'));
    return { file, group, timeout: timeoutOf(file, group, opts.fileTimeout ?? null) };
  }).filter((p) => !opts.groups || opts.groups.includes(p.group));
  if (opts.shard) {
    const mine = shard(chosen.map((p) => p.file), weightsFor(chosen.map((p) => p.file), readTimings(root)), opts.shard.n)[opts.shard.i - 1];
    const by = new Map(chosen.map((p) => [p.file, p]));
    chosen = mine.map((f) => by.get(f));
  }
  return [...chosen.filter((p) => p.group === 'alone'), ...chosen.filter((p) => p.group !== 'alone')];
}

// The description on the last ok / not ok line in output order (TAP reports a test once it ends),
// directives stripped, never a per-file wrapper's line (its description is the file's path).
export function lastFinished(tap, file) {
  let last = null;
  for (const line of tap.split('\n')) {
    const m = /^\s*(?:not )?ok \d+(?: - (.*?))?(?:\s+# (?:SKIP|TODO)\b.*)?$/i.exec(line);
    if (!m || m[1] === undefined) continue;
    const name = m[1].replace(/\\([\\#])/g, '$1');
    if (name === file || (path.isAbsolute(name) && name.endsWith(`/${file}`))) continue;
    last = name;
  }
  return last;
}

export const childArgs = (file) => ['--test', '--test-reporter=tap', file];

export function rowFor({ file, run, seconds, result, timeout, repeat }) {
  return `${file}  ${seconds.toFixed(1)}  ${result}${nearTimeout(seconds, timeout) ? ', near timeout' : ''}${repeat > 1 ? ` (run ${run})` : ''}`;
}

export function isEntry(argv1, metaUrl) {
  if (!argv1) return false;
  // both sides real: with --preserve-symlinks-main, import.meta.url keeps the symlinked path too
  try { return fs.realpathSync(argv1) === fs.realpathSync(fileURLToPath(metaUrl)); } catch { return false; }
}

// ---- running files ----

export const sharedDir = (env) => env.DEVTEAM_TEST_SHARED_TMP || os.tmpdir();
// Short, so tmux's socket paths stay under their length limit (macOS's os.tmpdir() is long).
export function scratchDir() {
  let tmp = false;
  try { tmp = fs.statSync('/tmp').isDirectory(); fs.accessSync('/tmp', fs.constants.W_OK); } catch { tmp = false; }
  return fs.mkdtempSync(tmp ? '/tmp/dtr-' : path.join(os.tmpdir(), 'dtr-'));
}

// The marker lib/kit.mjs's isShim looks for: a shim is never taken for the real tmux.
const MARK = 'tmux refused: TMUX_TMPDIR';
const isShim = (f) => { try { return fs.readFileSync(f, 'utf8').includes(MARK); } catch { return false; } };
export function realTmux(PATH) {
  for (const d of (PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const f = path.join(d, 'tmux');
    try { fs.accessSync(f, fs.constants.X_OK); if (fs.statSync(f).isFile() && !isShim(f)) return f; } catch {}
  }
  return '';
}
// lib/kit.mjs's rule: tmux runs only while TMUX_TMPDIR is an existing private dt-tmux-* folder.
// This one sits in the shared dir, behind lib/kit.mjs's per-file shim on each child's PATH, and is
// never removed: a process that outlives its scratch folder (and kit's shim in it) still finds a
// shim, never the real tmux, and its folder is gone, so it is refused.
const shimText = (real) => `#!/bin/sh\ncase "$TMUX_TMPDIR" in */dt-tmux-*) [ -d "$TMUX_TMPDIR" ] && exec ${JSON.stringify(real || 'tmux-not-installed')} "$@" ;; esac\necho "tmux refused: TMUX_TMPDIR ($TMUX_TMPDIR) is not an existing private test directory" >&2\nexit 1\n`;
export function ensureShim(shared, PATH) {
  let isDir = false;
  try { isDir = fs.statSync(shared).isDirectory(); } catch {}
  if (!isDir) throw new UsageError(`DEVTEAM_TEST_SHARED_TMP (${shared}) is not a directory`);
  const text = shimText(realTmux(PATH));
  const uid = process.getuid ? process.getuid() : 0;
  const dir = path.join(shared, `devteam-test-tmux-shim-run-${uid}-${crypto.createHash('sha1').update(text).digest('hex').slice(0, 12)}`);
  const f = path.join(dir, 'tmux');
  // the shared dir may be /tmp, which other users write to: only a shim of this user's, that no one
  // else can change, is run
  const safe = (p) => { const st = fs.lstatSync(p); return !st.isSymbolicLink() && st.uid === uid && (st.mode & 0o022) === 0; };
  // mkdir's mode is narrowed by the umask; the chmod sets it whole, so every runner makes the same dir
  try { fs.mkdirSync(dir, { mode: 0o755 }); fs.chmodSync(dir, 0o755); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  if (!safe(dir) || (fs.existsSync(f) && !safe(f))) throw new UsageError(`unsafe shim at ${dir}: not this user's, or writable by others`);
  if (fs.existsSync(f) && fs.readFileSync(f, 'utf8') === text) return dir;
  const tmp = path.join(dir, `.tmux-${process.pid}`);
  fs.writeFileSync(tmp, text);
  fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, f);
  return dir;
}

// Every socket under dir, by a walk that never follows a symlink (a Dirent's type is the link's
// own), whose real path is still under dir and all of whose names (hard links) are under dir too: a
// socket hard-linked in from outside has a name elsewhere, and is left alone. Nothing outside a
// file's scratch folder is touched. A dir that is itself a symlink isn't walked.
export function socketsUnder(dir) {
  let base;
  try { if (fs.lstatSync(dir).isSymbolicLink()) return []; base = fs.realpathSync(dir); } catch { return []; }
  const byInode = new Map();
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isSocket()) {
        try {
          const r = fs.realpathSync(p);
          if (!r.startsWith(base + path.sep)) continue;
          const st = fs.lstatSync(p);
          const k = `${st.dev}:${st.ino}`;
          if (!byInode.has(k)) byInode.set(k, { nlink: st.nlink, names: [] });
          byInode.get(k).names.push(r);
        } catch {}
      }
    }
  };
  walk(base);
  return [...byInode.values()].filter((v) => v.names.length === v.nlink).flatMap((v) => v.names);
}

// A stream's end, or ms, whichever comes first: something else holding the pipe can't hold a file.
export function drain(stream, ms) {
  if (!stream || stream.readableEnded || stream.destroyed) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); stream.off('end', done); stream.off('close', done); resolve(); }
    stream.on('end', done);
    stream.on('close', done);
  });
}

// The port locks (lib/ports.mjs, in <shared>/devteam-kit-ports) held by the named pids that are
// gone. A process the runner SIGKILLs never runs its exit hook, and lib/ports.mjs frees a dead
// owner's lock only after an hour, so without this a few timeouts fill every block on the machine.
// A lock whose owner is alive is never freed, named or not.
const isAlive = (pid) => {
  try { process.kill(pid, 0); } catch (e) { return e.code === 'EPERM'; }
  return !/Z/.test(spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 }).stdout ?? '');
};
export function freeLocks(shared, pids, alive = isAlive) {
  const d = path.join(shared, 'devteam-kit-ports');
  const want = new Set(pids.map(String));
  let names;
  try { names = fs.readdirSync(d); } catch { return []; }
  const freed = [];
  for (const n of names.filter((x) => x.endsWith('.lock'))) {
    const f = path.join(d, n);
    let owner;
    try { owner = fs.readFileSync(f, 'utf8').trim(); } catch { continue; }
    if (!want.has(owner) || alive(Number(owner))) continue;
    try { fs.rmSync(f); freed.push(Number(owner)); } catch {}
  }
  return freed;
}

// Steps 2 and 3 of a file's cleanup: its tmux servers (they detach, so no tree walk reaches them),
// then its scratch folder.
export function cleanupAfter(entry, tmux, shared) {
  if (shared && entry.killed?.length) {
    // what was killed dies in a moment: wait (2 s at most, by the clock) so its locks count as a
    // dead owner's; one still alive then keeps its lock
    const until = Date.now() + 2000;
    while (Date.now() < until && entry.killed.some(isAlive)) sleepSync(20);
    freeLocks(shared, entry.killed);
  }
  if (tmux) for (const s of socketsUnder(entry.dir)) spawnSync(tmux, ['-S', s, 'kill-server'], { timeout: 5000, stdio: 'ignore' });
  fs.rmSync(entry.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

// ---- stopping a file's process tree ----

// pid -> { ppid, stat } for every process on the machine (Linux and macOS)
export function snapshot() {
  const r = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,stat='], { encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0 || r.error) throw new Error(`ps failed: ${r.error?.message ?? r.stderr ?? `exit ${r.status}`}`);
  const m = new Map();
  for (const line of r.stdout.split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f.length >= 3 && /^\d+$/.test(f[0])) m.set(Number(f[0]), { ppid: Number(f[1]), stat: f[2] });
  }
  return m;
}
// A signal sender that reports false, rather than throwing, for a pid that is gone (ESRCH) or not
// this user's (EPERM): neither is the walk's to stop, and the walk goes on.
export const signalWith = (send) => (pid, sig) => {
  try { send(pid, sig); return true; } catch (e) { if (e.code === 'ESRCH' || e.code === 'EPERM') return false; throw e; }
};
const sendSignal = signalWith((pid, sig) => process.kill(pid, sig));
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const STOPPED = /^T/;
const SETTLED = /^[TZ]/;

// Step 1 of a file's cleanup. The root is stopped first; then each snapshot stops every pid whose
// parent this walk stopped (that reaches children in process groups of their own), until a
// snapshot finds no new pid and every stopped pid shows stopped (signals land asynchronously) or
// has already exited (a zombie), for at most 2 s. Then SIGKILL goes, in reverse stop order
// (children before parents, the root last), to:
// - the root: the runner's own child, not yet reaped, so its pid is still its own;
// - every other pid this walk stopped that the final snapshot still shows stopped, under the parent
//   it had when stopped, or orphaned from a parent that has since exited (gone, or a zombie): a
//   stopped process can't exit, so its pid can't have been reused.
// Whatever the walk stopped and didn't kill, and that hasn't exited and still has its recorded
// parent (or an orphan's), is sent SIGCONT. One exception to "seen stopped": if ps fails partway,
// the last good snapshot can't show a stop landing, so what it showed under its recorded parent is
// killed without that check.
// What this doesn't defend against: a pid that exits and is reused by an unrelated process in the
// milliseconds between a snapshot and its SIGSTOP (it takes a wrap of pid_max). That process is
// then stopped, and left stopped (or killed, if its recorded parent has exited or ps failed).
export function stopTree(root, { snapshot: snap, signal, sleep, now } = {}) {
  if (!snap !== !signal) throw new Error('stopTree: snapshot and signal go together');
  snap ??= snapshot;
  signal ??= sendSignal;
  sleep ??= sleepSync;
  now ??= Date.now;
  const parentAt = new Map([[root, null]]);
  const stopped = [root];
  signal(root, 'SIGSTOP');
  let final = null;
  let error = null;
  let quietSince = null;
  const skipped = new Set();
  for (let round = 0; round < 1000; round++) {
    try { final = snap(); } catch (e) { error = e.message; break; }
    const fresh = [];
    for (const [pid, { ppid }] of final) if (!parentAt.has(pid) && !skipped.has(pid) && parentAt.has(ppid)) fresh.push([pid, ppid]);
    for (const [pid, ppid] of fresh) {
      if (signal(pid, 'SIGSTOP') === false) { skipped.add(pid); continue; }
      stopped.push(pid);
      parentAt.set(pid, ppid);
    }
    if (fresh.length) { quietSince = null; continue; }
    if (stopped.every((p) => !final.has(p) || SETTLED.test(final.get(p).stat))) break;
    quietSince ??= now();
    if (now() - quietSince > 2000) break;
    sleep(20);
  }
  final ??= new Map();
  const exited = (p) => !final.has(p) || /^Z/.test(final.get(p).stat);
  // still the process the walk stopped: under the parent it had then, or orphaned since
  const same = (p) => final.get(p).ppid === parentAt.get(p) || exited(parentAt.get(p));
  const ours = (p) => {
    if (p === root) return true;
    const cur = final.get(p);
    if (!cur) return false;
    if (error) return cur.ppid === parentAt.get(p);
    return STOPPED.test(cur.stat) && same(p);
  };
  const killed = [...stopped].reverse().filter(ours);
  for (const p of killed) signal(p, 'SIGKILL');
  const resumed = stopped.filter((p) => !killed.includes(p) && !exited(p) && same(p));
  for (const p of resumed) signal(p, 'SIGCONT');
  const unstopped = error ? [] : stopped.filter((p) => final.has(p) && !SETTLED.test(final.get(p).stat));
  return { stopped, killed, resumed, unstopped, error };
}

// stdout may be a pipe whose reader went away (`| head`): a write then fails with EPIPE, which
// runFiles treats as an interrupt. Until then, and after, writing never throws.
let outClosed = false;
const say = (text) => { if (outClosed) return; try { process.stdout.write(text); } catch { outClosed = true; } };

// Stops and kills a running file's tree (steps 2 and 3 follow when its child's exit fires).
function cleanup(entry) {
  // once per file: a second walk (an interrupt right after a timeout) would find only the root,
  // and replace the list of killed pids whose port locks are freed
  if (entry.exited || entry.killed) return;
  try {
    const r = stopTree(entry.child.pid);
    entry.killed = r.killed;
    if (r.error) entry.out.push(Buffer.from(`# run.mjs: the tree walk stopped early (${r.error}); killed what its last look showed\n`));
    if (r.resumed.length) entry.out.push(Buffer.from(`# run.mjs: stopped but not killed, so resumed: ${r.resumed.join(' ')}\n`));
  } catch (e) {
    sendSignal(entry.child.pid, 'SIGKILL');
    entry.killed = [entry.child.pid];
    entry.out.push(Buffer.from(`# run.mjs: tree walk failed: ${e.message}; killed the file's own process only\n`));
  }
}

function startFile(p, run, ctx) {
  const dir = scratchDir();
  // no empty entry: an empty PATH entry means the cwd
  const env = { ...process.env, TMPDIR: dir, DEVTEAM_TEST_SHARED_TMP: ctx.shared, PATH: [ctx.shimDir, ...(process.env.PATH ?? '').split(path.delimiter)].filter(Boolean).join(path.delimiter) };
  // run under node --test (as run.test.mjs does), node would see this and skip the file's tests
  delete env.NODE_TEST_CONTEXT;
  // tmux takes $TMUX's socket ahead of TMUX_TMPDIR: the session that ran the runner is never a file's
  delete env.TMUX;
  delete env.TMUX_PANE;
  const child = spawn(process.execPath, childArgs(p.file), { cwd: ROOT, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const entry = { file: p.file, run, timeout: p.timeout, child, dir, out: [], start: Date.now(), exited: false, timer: null, result: null, seconds: 0 };
  child.stdout.on('data', (b) => entry.out.push(b));
  child.stderr.on('data', (b) => entry.out.push(b));
  ctx.running.add(entry);
  entry.timer = setTimeout(() => {
    if (entry.exited || ctx.stopping) return;
    entry.result = 'timed out';
    entry.line = `timed out: ${entry.file} after ${entry.timeout} s (last test finished: ${lastFinished(Buffer.concat(entry.out).toString(), entry.file) ?? 'none'})`;
    say(`${entry.line}\n`);
    cleanup(entry);
  }, entry.timeout * 1000);
  entry.done = new Promise((resolve) => {
    let ended = false;
    const end = async (code, signal, error) => {
      if (ended) return;
      ended = true;
      entry.exited = true;
      clearTimeout(entry.timer);
      await Promise.all([drain(child.stdout, 2000), drain(child.stderr, 2000)]);
      child.stdout.destroy();
      child.stderr.destroy();
      try { cleanupAfter(entry, ctx.tmux, ctx.shared); } catch (e) { entry.out.push(Buffer.from(`# run.mjs: cleanup failed: ${e.message}\n`)); }
      entry.seconds = (Date.now() - entry.start) / 1000;
      entry.result ??= error ? `failed (${error.message})` : code === 0 ? 'ok' : code !== null ? `failed (exit ${code})` : `failed (signal ${signal})`;
      ctx.running.delete(entry);
      say(`# ${entry.file}${ctx.repeat > 1 ? ` (run ${run})` : ''}\n${Buffer.concat(entry.out).toString()}`);
      if (!/\n$/.test(Buffer.concat(entry.out).toString()) && entry.out.length) say('\n');
      resolve(entry);
    };
    child.on('exit', (code, signal) => end(code, signal));
    child.on('error', (e) => end(null, null, e));
  });
  return entry;
}

async function runPool(items, limit, ctx) {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length && !ctx.stopping) {
      const [p, run] = items[next++];
      results.push(await startFile(p, run, ctx).done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// The steps of one run: the `alone` files one at a time, then every other file at the concurrency.
export function schedule(plan, concurrency) {
  return [{ files: plan.filter((p) => p.group === 'alone'), limit: 1 }, { files: plan.filter((p) => p.group !== 'alone'), limit: concurrency }].filter((st) => st.files.length);
}

async function runAll(opts, plan) {
  const shared = sharedDir(process.env);
  const ctx = { shared, shimDir: ensureShim(shared, process.env.PATH), tmux: realTmux(process.env.PATH), running: new Set(), repeat: opts.repeat, stopping: false };
  try {
    return await runFiles(opts, plan, ctx);
  } catch (e) {
    // the runner itself failed (a file that couldn't start, a bug): nothing it started is left
    // running unwatched
    ctx.stopping = true;
    const running = [...ctx.running];
    for (const en of running) { en.result ??= `failed (runner error: ${e.message})`; cleanup(en); }
    await Promise.all(running.map((en) => en.done));
    throw e;
  }
}

async function runFiles(opts, plan, ctx) {
  // Children have process groups of their own, so a terminal's Ctrl-C reaches only this process,
  // and a dropped session's SIGHUP too: each running file is cleaned up before it exits.
  const stopAll = async (code) => {
    if (ctx.stopping) return;
    ctx.stopping = true;
    const running = [...ctx.running];
    // a file the watchdog already timed out stays `timed out`
    for (const e of running) { e.result ??= 'interrupted'; cleanup(e); }
    await Promise.all(running.map((e) => e.done));
    say('interrupted\n');
    process.stderr.write(`run.mjs: interrupted (${code === 141 ? 'its output closed' : `signal ${code - 128}`})\n`);
    process.exit(code);
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => stopAll(128 + os.constants.signals[sig]));
  // the reader of our output went away: stop as SIGPIPE would (128 + 13), cleaning up first
  process.stdout.on('error', (e) => { outClosed = true; if (e.code === 'EPIPE') stopAll(128 + os.constants.signals.SIGPIPE); });
  const results = [];
  for (let run = 1; run <= opts.repeat && !ctx.stopping; run++) {
    for (const st of schedule(plan, opts.concurrency)) results.push(...await runPool(st.files.map((p) => [p, run]), st.limit, ctx));
  }
  if (!plan.length) say('no files\n');
  else {
    say(`\nsummary: ${plan.length} file${plan.length === 1 ? '' : 's'}, concurrency ${opts.concurrency}\n`);
    for (const r of results) say(`${rowFor({ ...r, repeat: opts.repeat })}\n`);
  }
  const bad = results.filter((r) => r.result !== 'ok');
  for (const r of bad) if (r.line) say(`${r.line}\n`);
  for (const r of bad) say(`failed: ${r.file} (${r.result}${opts.repeat > 1 ? `, run ${r.run}` : ''})\n`);
  if (opts.timings) {
    const files = {};
    for (const r of results) files[r.file] = Math.max(files[r.file] ?? 0, Math.round(r.seconds * 10) / 10);
    fs.writeFileSync(opts.timings, `${JSON.stringify({ run: process.env.GITHUB_RUN_ID ?? null, files }, null, 2)}\n`);
  }
  return bad.length ? 1 : 0;
}

async function main(argv) {
  let opts;
  let plan;
  try {
    opts = parseArgs(argv, process.env);
    plan = planRun(opts);
    if (opts.list) {
      for (const p of plan) say(`${p.file}  ${p.group}  ${p.timeout} s\n`);
      return 0;
    }
    return await runAll(opts, plan);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    process.stderr.write(`run.mjs: ${e.message}\n`);
    return 2;
  }
}

if (isEntry(process.argv[1], import.meta.url)) process.exitCode = await main(process.argv.slice(2));
