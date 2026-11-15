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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
export const ROOT = fs.realpathSync(path.resolve(path.dirname(here), '..'));
export const ALONE = ['test/bounds.test.mjs'];
// Files known to run longer than 300 s, until kit-210 splits it.
export const LONG = { 'test/dashboard.test.mjs': 600 };
export const GROUPS = ['chain', 'alone', 'chrome', 'rest'];
export class UsageError extends Error {}

const posInt = (flag, v, min = 1) => {
  if (!/^\d+$/.test(v ?? '') || Number(v) < min) throw new UsageError(`${flag} wants a whole number ${min} or more, not ${JSON.stringify(v ?? '')}`);
  return Number(v);
};
const relOf = (root, abs) => {
  const rel = path.relative(root, abs);
  return rel.startsWith('..') || path.isAbsolute(rel) ? abs : rel.split(path.sep).join('/');
};

export function parseArgs(argv, env, root = ROOT) {
  const o = { files: [], groups: null, shard: null, list: false, repeat: 1, timings: null, concurrency: null, fileTimeout: null };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    const val = () => { if (k + 1 >= argv.length) throw new UsageError(`${a} wants a value`); return argv[++k]; };
    if (a === '--list') o.list = true;
    else if (a === '--concurrency') o.concurrency = posInt(a, val());
    else if (a === '--file-timeout') o.fileTimeout = posInt(a, val());
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
  return o;
}

const CHROME_STATIC = /^\s*import\b[^;]*?['"]\.\/lib\/chrome\.mjs['"]/m;
const CHROME_DYNAMIC = /\bimport\(\s*['"]\.\/lib\/chrome\.mjs['"]\s*\)/;
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
    const name = m[1].replace(/\\#/g, '#');
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
  try { return fs.realpathSync(argv1) === fileURLToPath(metaUrl); } catch { return false; }
}

async function main(argv) {
  let opts;
  let plan;
  try {
    opts = parseArgs(argv, process.env);
    plan = planRun(opts);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    process.stderr.write(`run.mjs: ${e.message}\n`);
    return 2;
  }
  if (opts.list) {
    for (const p of plan) process.stdout.write(`${p.file}  ${p.group}  ${p.timeout} s\n`);
    return 0;
  }
  process.stderr.write('run.mjs: running files is not built yet\n');
  return 1;
}

if (isEntry(process.argv[1], import.meta.url)) process.exitCode = await main(process.argv.slice(2));
