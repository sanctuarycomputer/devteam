#!/usr/bin/env node
// apps-try (kit-1022; kit-package-apps, "The developer's loop"): run the named test files against the
// built apps, in a generated tree at this checkout's HEAD.
//   node test/split/apps-try.mjs <test file>…
// The tree lives in the checkout's own .apps-try/ (which the repository's info/exclude ignores) and is
// generated again only when HEAD, or the split tool's own folder as it is on disk (its manifests and
// overlay, which split.mjs reads from where it runs), changes: split.mjs writes it outside the checkout, it becomes a
// repository of its own (parity's snapshot), and it is copied in. An app is built again only when its
// sources changed (its folder, and the shared code and build scripts every app uses); otherwise its
// out/, lib-dist/ and node_modules/ move over from the last tree. One apps-try at a time on the machine:
// it holds <os tmpdir>/devteam-apps-try.lock while it builds and runs. The named files, and nothing else,
// run as `node --test --test-concurrency=2 <files>` in the tree, with a scratch HOME, DEVTEAM_HUB_PORT
// 4987 and every inherited DEVTEAM_*, GIT_*, TMUX and NODE_TEST_CONTEXT variable unset.
// Exit: the test run's own status; 1 when the split or a build failed; 2 refused (no file named, an
// option, a file outside the checkout or not in the tree). Apps build on Node 24 only (parity's rule);
// the tests run on the Node that runs this.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshot } from './parity.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DIR = '.apps-try';
export const LOCK_NAME = 'devteam-apps-try.lock';
export const HUB_PORT = '4987';
// what every app's build reads besides its own folder: the hub imports the shared code as @shared/*
// (apps/hub/tsconfig.json) and both builds run the dashboard's scripts (each package.json's build)
export const SHARED = ['apps/dashboard/src/shared', 'apps/dashboard/scripts'];
// an app's build outputs, carried from the last tree when its sources are unchanged (out/ is copied to
// docs/devteam/apps/<app>/ too, where the servers read it)
const OUTPUTS = ['out', 'lib-dist', 'node_modules'];

export class Refusal extends Error {}
export class Failure extends Error {}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const tail = (s, n = 20) => String(s ?? '').trimEnd().split('\n').slice(-n).join('\n');
// nothing of the caller's git, devteam or tmux reaches a child, nor a test runner's NODE_TEST_CONTEXT (a
// node --test started under one reports to it instead of running as its own: test/run.mjs drops it too)
export const cleanEnv = (from) => Object.fromEntries(Object.entries(from).filter(([k]) => !/^(GIT_|DEVTEAM_)/.test(k) && !['TMUX', 'TMUX_PANE', 'NODE_TEST_CONTEXT'].includes(k)));
const gitIn = (cwd, args, env) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: cleanEnv(env), maxBuffer: 1 << 28 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the named files ----
const NO_FILES = 'name the test files to run: node test/split/apps-try.mjs test/<name>.test.mjs …; apps-try never runs the whole suite';
export function parseFiles(argv, { cwd, repo }) {
  if (!argv.length) throw new Refusal(NO_FILES);
  const files = [];
  for (const a of argv) {
    if (a.startsWith('-')) throw new Refusal(`unknown option ${a}: apps-try takes test files only`);
    const rel = path.relative(repo, path.resolve(cwd, a)).split(path.sep).join('/');
    if (!rel || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) throw new Refusal(`${a} is outside this checkout (${repo})`);
    if (rel === DIR || rel.startsWith(`${DIR}/`)) throw new Refusal(`${a} is inside ${DIR}/; name the file as it is in the checkout`);
    if (!files.includes(rel)) files.push(rel);
  }
  return files;
}

// ---- the machine-wide lock ----
// The lock file holds { pid, started, cwd }, written whole before it appears (a link from a file of our
// own), so a reader never sees it half written. A lock whose pid is gone is stale and taken over.
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
let held = null, pending = null;
export async function acquire(file, { say, pollMs = 2000 }) {
  const mine = `${JSON.stringify({ pid: process.pid, started: new Date().toISOString(), cwd: process.cwd() })}\n`;
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  pending = tmp;
  fs.writeFileSync(tmp, mine);
  let told = false;
  try {
    for (;;) {
      try { fs.linkSync(tmp, file); held = { file, mine }; return held; } catch (e) { if (e.code !== 'EEXIST') throw e; }
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
      let h = null;
      try { h = JSON.parse(text); } catch {}
      const pid = Number.isInteger(h?.pid) && h.pid > 0 ? h.pid : null;
      if (pid === null || !alive(pid)) {
        say(`apps-try: ${file} is stale (${pid === null ? 'unreadable' : `pid ${pid} is gone`}); taking it over`);
        // remove it only while it still says what was read, so a lock taken meanwhile stays
        try { if (fs.readFileSync(file, 'utf8') === text) fs.unlinkSync(file); } catch {}
        continue;
      }
      if (!told) { say(`apps-try: waiting for the apps-try holding ${file} (pid ${pid}, since ${h.started}, in ${h.cwd})`); told = true; }
      await sleep(pollMs);
    }
  } finally { fs.rmSync(tmp, { force: true }); pending = null; }
}
// also on a signal while waiting: the file of our own goes
export function release() {
  if (pending) { fs.rmSync(pending, { force: true }); pending = null; }
  if (!held) return;
  try { if (fs.readFileSync(held.file, 'utf8') === held.mine) fs.unlinkSync(held.file); } catch {}
  held = null;
}

// ---- the tree ----
// the line the repository's info/exclude needs (a worktree's is the common one: git rev-parse --git-path)
export function exclude(repo, env) {
  const r = gitIn(repo, ['rev-parse', '--git-path', 'info/exclude'], env);
  if (r.status !== 0) throw new Failure(`git rev-parse --git-path info/exclude failed: ${tail(r.stderr, 3)}`);
  const file = path.resolve(repo, r.stdout.trim());
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (text.split('\n').some((l) => l.trim() === `/${DIR}/`)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}/${DIR}/\n`);
}

// each app's key: its sources as the tree's own commit holds them; lock: its lockfile's blob
export function appKeys(tree, env) {
  const dir = path.join(tree, 'apps');
  const keys = {};
  if (!fs.existsSync(dir)) return keys;
  for (const app of fs.readdirSync(dir).sort()) {
    if (!fs.existsSync(path.join(dir, app, 'package.json'))) continue;
    const ls = gitIn(tree, ['ls-tree', '-r', 'HEAD', '--', `apps/${app}`, ...SHARED], env);
    if (ls.status !== 0) throw new Failure(`git ls-tree in the tree failed: ${tail(ls.stderr, 3)}`);
    const lock = gitIn(tree, ['rev-parse', '--verify', '--quiet', `HEAD:apps/${app}/package-lock.json`], env);
    keys[app] = { key: sha256(ls.stdout), lock: lock.status === 0 ? lock.stdout.trim() : null };
  }
  return keys;
}

// the split tool's folder as it is on disk (a file's path and bytes, in name order): split.mjs reads its
// manifests and overlay from there, so an uncommitted overlay edit is a new tree
export function splitDirHash(dir) {
  const h = crypto.createHash('sha256');
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) h.update(`${r}\0${fs.readFileSync(path.join(dir, r)).length}\0`).update(fs.readFileSync(path.join(dir, r)));
    }
  };
  walk('');
  return h.digest('hex');
}

const readState = (file) => { try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); return s && typeof s.sha === 'string' && typeof s.split === 'string' && s.apps && typeof s.apps === 'object' ? s : null; } catch { return null; } };
const writeState = (file, s) => { const t = `${file}.${process.pid}.tmp`; fs.writeFileSync(t, `${JSON.stringify(s, null, 2)}\n`); fs.renameSync(t, file); };
const move = (from, to) => { if (!fs.existsSync(from)) return; fs.rmSync(to, { recursive: true, force: true }); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(from, to); };

// the tree for head in <repo>/.apps-try/tree, reused or generated; returns { tree, state, modules }
// (modules: the apps whose node_modules came over from a build with the same lockfile)
export function ensureTree({ repo, head, split, tmpdir, env, say }) {
  const splitKey = splitDirHash(path.dirname(split));
  const work = path.join(repo, DIR), tree = path.join(work, 'tree'), next = path.join(work, 'tree.new'), stateFile = path.join(work, 'state.json');
  fs.mkdirSync(work, { recursive: true });
  // a tree.new is what an interrupted run left: never a tree
  fs.rmSync(next, { recursive: true, force: true });
  const state = readState(stateFile);
  if (state?.sha === head && state.split === splitKey && fs.existsSync(tree)) { say(`apps-try: reusing the tree for ${head.slice(0, 8)}`); return { tree, stateFile, state, modules: new Set() }; }
  say(`apps-try: generating the tree for ${head.slice(0, 8)}${state?.sha === head ? ` (${path.dirname(split)} changed)` : ''}`);
  const tmp = fs.mkdtempSync(path.join(tmpdir, 'devteam-apps-try-'));
  try {
    const out = path.join(tmp, 'tree');
    const r = spawnSync(process.execPath, [split, '--at', head, '--repo', repo, '--out', out, '--json'], { encoding: 'utf8', env: cleanEnv(env), maxBuffer: 1 << 28, timeout: 10 * 60000 });
    if (r.status !== 0 || !fs.existsSync(out)) throw new Failure(`the split failed (exit ${r.status ?? r.signal}):\n${tail(r.stderr)}`);
    let js = null;
    try { js = JSON.parse(r.stdout); } catch {}
    const stale = Array.isArray(js?.stale) ? js.stale : [];
    if (stale.length) say(`apps-try: the tree is stale (${stale.length} overlay items, the parity run reports each): ${stale.slice(0, 5).map((s) => `${s.area} ${s.kind} ${s.name}`).join('; ')}`);
    const o = gitIn(repo, ['remote', 'get-url', 'origin'], env);
    snapshot(out, `apps-try: the tree at ${head}`, o.status === 0 ? o.stdout.trim() || null : null);
    // from here the old tree is being replaced: without a state, an interrupted run starts over
    fs.rmSync(stateFile, { force: true });
    fs.cpSync(out, next, { recursive: true, verbatimSymlinks: true });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const keys = appKeys(next, env);
  const apps = {}, modules = new Set();
  for (const [app, k] of Object.entries(keys)) {
    const was = state?.apps?.[app];
    if (!was || !fs.existsSync(tree)) continue;
    if (was.key === k.key) {
      for (const d of OUTPUTS) move(path.join(tree, 'apps', app, d), path.join(next, 'apps', app, d));
      move(path.join(tree, 'docs', 'devteam', 'apps', app), path.join(next, 'docs', 'devteam', 'apps', app));
      apps[app] = was;
    } else if (was.lock !== null && was.lock === k.lock && fs.existsSync(path.join(tree, 'apps', app, 'node_modules'))) {
      move(path.join(tree, 'apps', app, 'node_modules'), path.join(next, 'apps', app, 'node_modules'));
      modules.add(app);
    }
  }
  fs.rmSync(tree, { recursive: true, force: true });
  fs.renameSync(next, tree);
  const s = { sha: head, split: splitKey, apps };
  writeState(stateFile, s);
  return { tree, stateFile, state: s, modules };
}

// ---- the apps ----
// the real build, as parity's buildApps: npm ci (unless node_modules came from a build with the same
// lockfile), then the app's build, with DEVTEAM_BASE_PATH empty so the build serves at the root
export function buildApp({ dir, env, install }) {
  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 24) return { ok: false, why: `apps build on Node 24 only (this is Node ${major}); run apps-try with Node 24` };
  for (const a of [...(install ? [['ci', '--ignore-scripts']] : []), ['run', 'build']]) {
    const r = spawnSync('npm', a, { cwd: dir, env, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 30 * 60000 });
    if (r.status !== 0) return { ok: false, why: `npm ${a.join(' ')} failed (${r.status ?? r.signal}):\n${tail(`${r.stdout}\n${r.stderr}`)}` };
  }
  return fs.existsSync(path.join(dir, 'out')) ? { ok: true } : { ok: false, why: 'the build wrote no out/' };
}

export function buildChanged({ tree, stateFile, state, modules, build, env, say }) {
  const keys = appKeys(tree, env);
  const failed = [];
  const apps = {};
  for (const [app, k] of Object.entries(keys)) {
    const served = path.join(tree, 'docs', 'devteam', 'apps', app);
    if (state.apps[app]?.key === k.key && fs.existsSync(served)) { apps[app] = state.apps[app]; say(`apps-try: ${app} unchanged; not rebuilt`); continue; }
    say(`apps-try: building ${app}`);
    const dir = path.join(tree, 'apps', app);
    const r = build({ app, dir, tree, install: !modules.has(app), env: { ...cleanEnv(env), DEVTEAM_BASE_PATH: '' } });
    if (!r?.ok || !fs.existsSync(path.join(dir, 'out'))) { failed.push(`${app}: ${r?.why ?? 'the build wrote no out/'}`); continue; }
    fs.rmSync(served, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(served), { recursive: true });
    fs.cpSync(path.join(dir, 'out'), served, { recursive: true });
    apps[app] = k;
    writeState(stateFile, { ...state, apps: { ...state.apps, ...apps } });
  }
  writeState(stateFile, { ...state, apps });
  if (failed.length) throw new Failure(`not built, so no test ran:\n${failed.join('\n')}`);
}

// ---- the run ----
let running = null, scratchHome = null;
export async function appsTry({ argv, cwd = process.cwd(), repo = null, split = path.join(here, 'split.mjs'), build = buildApp, node = process.execPath, tmpdir = os.tmpdir(), env = process.env, say = (s) => process.stderr.write(`${s}\n`), stdio = 'inherit', pollMs = 2000 }) {
  // no file named is refused before anything is read, git included
  if (!argv.length) throw new Refusal(NO_FILES);
  if (!repo) {
    const t = gitIn(here, ['rev-parse', '--show-toplevel'], env);
    if (t.status !== 0) throw new Refusal(`${here} is not in a git checkout`);
    repo = t.stdout.trim();
  }
  repo = path.resolve(repo);
  const files = parseFiles(argv, { cwd, repo });
  const h = gitIn(repo, ['rev-parse', '--verify', 'HEAD^{commit}'], env);
  if (h.status !== 0) throw new Refusal(`${repo} has no HEAD commit`);
  const head = h.stdout.trim();
  await acquire(path.join(tmpdir, LOCK_NAME), { say, pollMs });
  try {
    exclude(repo, env);
    const dirty = gitIn(repo, ['status', '--porcelain'], env).stdout.trim();
    if (dirty) say(`apps-try: the tree is HEAD (${head.slice(0, 8)}); uncommitted changes aren't in it`);
    const t = ensureTree({ repo, head, split, tmpdir, env, say });
    buildChanged({ ...t, build, env, say });
    const missing = files.filter((f) => !fs.statSync(path.join(t.tree, f), { throwIfNoEntry: false })?.isFile());
    if (missing.length) throw new Refusal(`not a file in the tree at ${head.slice(0, 8)}: ${missing.join(', ')}`);
    const home = fs.mkdtempSync(path.join(tmpdir, 'devteam-apps-try-home-'));
    scratchHome = home;
    try {
      say(`apps-try: node --test --test-concurrency=2 ${files.join(' ')} (in ${t.tree})`);
      const child = spawn(node, ['--test', '--test-concurrency=2', ...files], { cwd: t.tree, env: { ...cleanEnv(env), HOME: home, DEVTEAM_HUB_PORT: HUB_PORT }, stdio });
      running = child;
      const status = await new Promise((resolve) => { child.on('error', () => resolve(1)); child.on('close', (code) => resolve(code ?? 1)); });
      running = null;
      return status;
    } finally { fs.rmSync(home, { recursive: true, force: true }); scratchHome = null; }
  } finally { release(); }
}

async function main(argv) {
  // a signal stops the test run too, and releases the lock (a split or build in progress ends first: they
  // run synchronously; a terminal's Ctrl-C reaches them directly, as the foreground group)
  for (const [sig, n] of [['SIGINT', 2], ['SIGTERM', 15], ['SIGHUP', 1]]) process.on(sig, () => { try { running?.kill(sig); } catch {} if (scratchHome) fs.rmSync(scratchHome, { recursive: true, force: true }); release(); process.exit(128 + n); });
  try { return await appsTry({ argv }); } catch (e) {
    if (e instanceof Refusal) { process.stderr.write(`apps-try: ${e.message}\n`); return 2; }
    if (e instanceof Failure) { process.stderr.write(`apps-try: ${e.message}\n`); return 1; }
    throw e;
  }
}

const isEntry = () => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (isEntry()) process.exitCode = await main(process.argv.slice(2));
