// Helpers the kit's test files share. Importing it gives the process its own tmux server and its
// own block of ports (see ports.mjs), so test files can run side by side.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { PORTS } from './ports.mjs';

export { PORTS };
export const testDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const kit = path.resolve(testDir, '..', 'docs', 'devteam');
// The tmux session a project's workers live in: devteam-<project>-<hash of the checkout's path>.
export function sessionOf(root, name) { return `devteam-${name}-${crypto.createHash('sha1').update(fs.realpathSync(root)).digest('hex').slice(0, 6)}`; }
export const line = (o) => `${JSON.stringify({ v: 1, ...o })}\n`;
// tmux in this test talks to its own server, never the developer's (or a live fleet's) sessions.
process.env.TMUX_TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-tmux-'));
delete process.env.TMUX;
delete process.env.TMUX_PANE;
// and never the machine's default server, which tmux falls back to when TMUX_TMPDIR is unset or
// names a directory that is gone: every tmux a test or the kit runs is bin/tmux, which refuses then.
const shims = path.join(testDir, 'lib', 'bin');
const isShim = (f) => { try { return fs.readFileSync(f, 'utf8').includes('DEVTEAM_TEST_REAL_TMUX'); } catch { return false; } };
process.env.DEVTEAM_TEST_REAL_TMUX = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map((d) => path.join(d, 'tmux')).find((f) => { try { fs.accessSync(f, fs.constants.X_OK); return fs.statSync(f).isFile() && !isShim(f); } catch { return false; } }) ?? '';
process.env.PATH = `${shims}${path.delimiter}${process.env.PATH}`;
// Dashboards started by tests never use the machine's real ports or become its hub: the hub and
// the instance block move to ports the tests own.
// Each run owns a block of 100 ports, so two suites on one machine don't collide either: the
// file-wide hub and instance block at X, the ports test at X+30, the hub test at X+60.
process.env.DEVTEAM_HUB_PORT = String(PORTS);
process.env.DEVTEAM_PORT_BASE = String(PORTS + 1);
process.on('exit', () => { spawnSync('tmux', ['kill-server']); fs.rmSync(process.env.TMUX_TMPDIR, { recursive: true, force: true }); });
export const hasTmux = spawnSync('tmux', ['-V']).status === 0;
// A port the OS says is free: a random one in a range can land on a machine's own listener (macOS's
// AirPlay receiver holds 5000 and answers 403), which then passes the test's startup probe.
export const freePort = () => new Promise((resolve, reject) => { const v = net.createServer(); v.on('error', reject); v.listen(0, '127.0.0.1', () => { const { port } = v.address(); v.close(() => resolve(port)); }); });
// Wait for a server the test started to answer: up to 30s, since a loaded machine starts it slowly;
// a server that never answers fails here, not at the test's first real request.
export const serverUp = async (url) => { for (let i = 0; i < 300; i++) { try { await fetch(url); return; } catch { await new Promise((r) => setTimeout(r, 100)); } } throw new Error(`no server at ${url} after 30s`); };
export const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
export const review = (reviewer, sha) => `- Reviewer: ${reviewer}\n\n| Id | Severity | Rule | Where | Finding | Disposition |\n|---|---|---|---|---|---|\n\nVerdict: APPROVE ${sha}\n`;
export const json = (s) => JSON.parse(s);

// Moving the fleet: its own throwaway repo, an old machine and a fresh clone standing in for the new one.
// A throwaway origin, an old machine and a new one, for the fleet tests.
export function fleetFixture(name) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `devteam-${name}-`));
  const org = path.join(base, 'origin.git');
  const old = path.join(base, 'old');
  const neu = path.join(base, 'new');
  const home = path.join(base, 'home');
  const tmuxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-tmux-'));
  const env = (role) => {
    const e = { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, 'claude'), CODEX_HOME: path.join(home, 'codex'), TMUX_TMPDIR: tmuxDir };
    for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'TMUX', 'TMUX_PANE']) delete e[k];
    return { ...e, ...role };
  };
  const run = (cwd, args, role = {}, input) => { const r = spawnSync(process.execPath, [path.join(cwd, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd, env: env(role), encoding: 'utf8', input }); return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
  const ok = (cwd, args, role, input) => { const r = run(cwd, args, role, input); assert.equal(r.status, 0, `${args.join(' ')}: ${r.err || r.out}`); return r.out; };
  const g = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  g(['init', '-q', '--bare', '-b', 'main', org], base); // the clone checks out origin's HEAD; CI's git defaults to master
  fs.mkdirSync(old);
  g(['init', '-q', '-b', 'main'], old);
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) g(['config', k, v], old);
  g(['remote', 'add', 'origin', org], old);
  fs.cpSync(kit, path.join(old, 'docs', 'devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
  ok(old, ['init', '--name', name]);
  const sf = path.join(old, 'docs/devteam/project/settings.md');
  fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"gates": {}', '"gates": {}, "forge": "git", "worktree_files": ["config/dev.key"], "agent_command": "true", "resume_command": "true"'));
  write(path.join(old, 'config/dev.key'), 'not a real key\n');
  write(path.join(old, '.gitignore'), `${fs.readFileSync(path.join(old, '.gitignore'), 'utf8')}config/dev.key\n`);
  g(['add', '-A'], old);
  g(['commit', '-qm', 'init'], old);
  g(['push', '-q', 'origin', 'main'], old);
  // the log lands (as merge --chore log would put it on main)
  const land = () => {
    const live = path.join(old, 'docs/devteam/run/log');
    fs.mkdirSync(path.join(old, 'docs/devteam/project/log'), { recursive: true }); // as log-sync makes it: init leaves no placeholder
    for (const f of fs.readdirSync(live).filter((x) => x.endsWith('.jsonl'))) fs.copyFileSync(path.join(live, f), path.join(old, 'docs/devteam/project/log', f));
    g(['add', '-A', 'docs/devteam/project/log'], old);
    g(['commit', '-qm', 'chore-log: log through now'], old);
    g(['push', '-q', 'origin', 'main'], old);
  };
  const done = () => { spawnSync('tmux', ['kill-server'], { env: env({}) }); fs.rmSync(tmuxDir, { recursive: true, force: true }); if (!process.env.DEVTEAM_TEST_KEEP) fs.rmSync(base, { recursive: true, force: true }); else console.log(`${name} fixture kept at ${base}`); };
  return { base, org, old, neu, home, env, run, ok, g, land, done };
}

// G1: a single-repo project with no new settings prints exactly what it printed before
// links and component lines. The goldens were recorded from the kit before the change
// (DEVTEAM_G1_RECORD=1) and re-recorded twice, each time for one line: check-ticket and merge
// --dry-run print a non-ASCII path raw rather than as git's quoted octal (a fix in this change), and
// fleet-status's last checklist line names the hub (upstream). Never re-record them to make this pass.
export const G1_DIR = path.join(testDir, 'fixtures', 'g1');
// The tmux session is named after a hash of the fixture's path and the hub port follows the
// suite's pid, so both move between runs as <tmp> does.
export const g1Norm = (s, base) => s.split(fs.realpathSync(base)).join('<tmp>').split(base).join('<tmp>').replace(/\b[0-9a-f]{7,40}\b/g, '<sha>').replace(/-\d{4}-\d{2}\.jsonl\b/g, '-<month>.jsonl')
  .replace(/\bdevteam-g1-[0-9a-f]{6}\b/g, 'devteam-g1-<hash>').split(`127.0.0.1:${process.env.DEVTEAM_HUB_PORT}`).join('127.0.0.1:<hub-port>');
export function g1Outputs(F) {
  const { old, ok, run, g } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const fake = 'g-20260101-000000000-supervisor';
  ok(old, ['feature', 'add', 'g1-work', '--json', JSON.stringify({ title: 'G1', goals: [fake], stories: [{ id: 'G1-S1', text: 'it still works', release: 'v1.0.0' }] })], SUP);
  const tk = (id, extra = {}) => ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'g1-work', component: 'g1', kind: 'build', size: 'S', risk: 'normal', serves: ['G1-S1'], depends_on: [], touches: ['src/**'], done_when: ['the src test passes in CI'], ...extra })], SUP);
  tk('g1-01-a');
  tk('g1-02-b', { depends_on: ['g1-01-a', 'g1-99-missing'], touches: ['src/b/**'] });
  const w = path.join(old, '.worktrees', 'g1-01-a');
  g(['worktree', 'add', '-q', '-b', 'ticket/g1-01-a', w, 'origin/main'], old);
  const tdir = path.join(w, 'docs/devteam/project/tickets/g1-01-a');
  write(path.join(tdir, 'spec.md'), '# spec\n');
  write(path.join(tdir, 'plan.md'), '# plan\n\n## TL;DR\n\n- one file\n');
  write(path.join(tdir, 'verification.md'), '| Done-when | Command | Result |\n|---|---|---|\n| src test | npm t | pass |\n');
  write(path.join(w, 'src/a.js'), 'a\n');
  write(path.join(w, 'OUTSIDE.md'), 'not in touches\n');
  write(path.join(w, 'src/é.js'), 'non-ascii\n');
  g(['add', '-A'], w);
  g(['commit', '-qm', 'g1-01-a: work'], w);
  const sha = g(['rev-parse', 'HEAD'], w);
  write(path.join(tdir, 'reviews/final-1.md'), review('reviewer-b', sha));
  g(['add', '-A'], w);
  g(['commit', '-qm', 'review'], w);
  const head = g(['rev-parse', 'HEAD'], w);
  g(['push', '-q', 'origin', 'ticket/g1-01-a'], w);
  const bodyFile = path.join(F.base, 'g1-body.md');
  write(bodyFile, '## One-way doors\n\nNone.\n');
  // what merge, metrics, knowledge, orient and questions have to show: approvals, a PR text (forge
  // git), an accepted lesson, a recurring observation from two writers, an open question with links
  ok(old, ['act', '--class', 'approve-spec', '--refs', 'g1-01-a', '--', 'spec ok'], SUP);
  ok(old, ['act', '--class', 'approve-plan', '--refs', 'g1-01-a', '--', 'plan ok'], SUP);
  write(path.join(old, 'docs/devteam/run/pr/ticket/g1-01-a.md'), '# g1-01-a: work\n\n## One-way doors\n\nNone.\n');
  ok(old, ['knowledge', 'add', '--kind', 'fact', '--statement', 'g1 builds with make', '--scope', 'component:g1', '--owner']);
  for (const i of [1, 2]) ok(old, ['observe', '--subject', 'g1', '--kind', 'slow-test', '--key', 'slow:g1', '--detail', `slow ${i}`, '--valence', '-1'], SUP);
  ok(old, ['observe', '--subject', 'g1', '--kind', 'slow-test', '--key', 'slow:g1', '--detail', 'slow 3', '--valence', '-1', '--owner']);
  ok(old, ['ask', '--question', 'Ship g1 behind a flag?', '--ticket', 'g1-01-a', '--recommendation', 'yes', '--choices', JSON.stringify([{ label: 'yes', detail: 'behind a flag' }, { label: 'no' }]), '--links', JSON.stringify([{ title: 'The spec', path: 'docs/devteam/project/tickets/g1-01-a/spec.md', ref: 'ticket/g1-01-a' }])], SUP);
  const both = (r) => `exit ${r.status}\n--- stdout\n${r.out}\n--- stderr\n${r.err}\n`;
  // metrics and fleet status carry clocks and durations; everything else in them must not move
  const TIMEY = /(^since$|_at$|^at$|^now$|hours|minutes|seconds|_ms$|^ms$|^until$|^parity$)/;
  const untimed = (x) => (Array.isArray(x) ? x.map(untimed) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([k]) => !TIMEY.test(k)).map(([k, v]) => [k, untimed(v)])) : x);
  const jsonOut = (r) => both({ ...r, out: r.status === 0 ? JSON.stringify(untimed(JSON.parse(r.out)), null, 2) : r.out });
  const outs = {
    validate: both(run(old, ['validate'])),
    status: both(run(old, ['status'])),
    ready: both(run(old, ['ready'])),
    'check-ticket': both(run(old, ['check-ticket', 'g1-01-a', '--sha', head, '--title', 'g1-01-a: work', '--body-file', bodyFile])),
    'prompt-worker': both(run(old, ['prompt', 'worker', 'g1-01-a'])),
    'merge-dry-run': both(run(old, ['merge', 'g1-01-a', '--dry-run'], SUP)),
    metrics: jsonOut(run(old, ['metrics', '--json'])),
    'fleet-status': jsonOut(run(old, ['fleet', 'status', '--json', '--no-fetch'], SUP)),
    knowledge: both(run(old, ['knowledge', '--for', 'g1-01-a'])),
    orient: both(run(old, ['orient'])),
    questions: both(run(old, ['questions'])),
  };
  return Object.fromEntries(Object.entries(outs).map(([k, v]) => [k, g1Norm(v, F.base)]));
}

// The coverage function, loaded from the script by itself (as the review bridge is): tables for
// the shapes a tree can take, then a property test against a brute-force oracle.
export function coverageFns() {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b); assert.ok(i >= 0 && j > i, `${a} … ${b} marks a block in devteam.mjs`); return src.slice(i, j); };
  const ctx = vm.createContext({});
  return vm.runInContext(`${cut('/* globs start */', '/* globs end */')}\n${cut('/* coverage start */', '/* coverage end */')}\n;({ coverage, caseCollisions, prefixOwners, ownersOf, pathMatches, ownerSuggestions })`, ctx);
}
// A clean partition: nothing unowned, contested, empty or colliding (the script has no caller for it).
export function coverageClean(r) {
  return !r.unowned.length && !r.contested.length && !r.empty.length && !r.case_collisions.length;
}

// A monorepo: home with three apps and its own kit, forge git, one gate. Lines are set with
// lines(...) and land on main as the supervisor's chore would.
export function monoFixture(name) {
  const F = fleetFixture(name);
  const { old, g } = F;
  for (const f of ['api/app.rb', 'api/lib/x.rb', 'web/src/index.js', 'web/package.json', 'ops/deploy.sh', 'README.md', '.github/workflows/ci.yml']) write(path.join(old, f), `${f}\n`);
  g(['add', '-A'], old);
  g(['commit', '-qm', 'apps'], old);
  g(['push', '-q', 'origin', 'main'], old);
  const settingsFile = path.join(old, 'docs/devteam/project/settings.md');
  const edit = (fn, cwd = old) => {
    const f = path.join(cwd, 'docs/devteam/project/settings.md');
    const txt = fs.readFileSync(f, 'utf8');
    const m = txt.match(/```json devteam\s*\n([\s\S]*?)\n```/);
    const j = JSON.parse(m[1]);
    fn(j);
    fs.writeFileSync(f, txt.replace(m[1], () => JSON.stringify(j, null, 2)));
  };
  const lines = (components, extra = {}) => { edit((j) => { j.components = components; Object.assign(j, extra); }); g(['commit', '-qam', 'lines'], old); g(['push', '-q', 'origin', 'main'], old); };
  // every path init and fleetFixture track: AGENTS.md and .gitignore from init; config/dev.key is gitignored
  const STD = { api: { owns: ['api/**'] }, web: { owns: ['web/**'] }, ops: { owns: ['ops/**', '.github/**', 'README.md', '.gitignore', 'AGENTS.md'] } };
  return { ...F, settingsFile, edit, lines, STD };
}

// A git on PATH ahead of the real one: it logs every call to GIT_SPY_LOG, and GIT_SHIM_MODE makes
// it act out a git it isn't: "old" is 2.34 (no merge-tree --write-tree), "lstree" fails every ls-tree.
export const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
export function gitShim(F, mode = '') {
  const dir = path.join(F.base, `git-shim-${mode || 'spy'}`);
  const log = path.join(dir, 'calls.log');
  write(path.join(dir, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\ncase "${mode}:$1" in\n  old:--version) echo "git version 2.34.1"; exit 0 ;;\n  old:merge-tree) case " $* " in *" --write-tree "*) echo "error: unknown option \\\`write-tree'" >&2; exit 129 ;; esac ;;\n  lstree:ls-tree) echo "fatal: not a tree object" >&2; exit 128 ;;\nesac\nexec "${REAL_GIT}" "$@"\n`);
  fs.chmodSync(path.join(dir, 'git'), 0o755);
  return { env: { PATH: `${dir}${path.delimiter}${process.env.PATH}` }, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''), reset: () => fs.rmSync(log, { force: true }) };
}

// A fresh project of its own, for tests that need more than one instance on the machine.
export function bareProject(base, name) {
  const r = path.join(base, name);
  fs.mkdirSync(r);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: r });
  fs.cpSync(kit, path.join(r, 'docs', 'devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
  const i = spawnSync(process.execPath, [path.join(r, 'docs/devteam/scripts/devteam.mjs'), 'init', '--name', name], { cwd: r, encoding: 'utf8' });
  assert.equal(i.status, 0, i.stderr);
  return r;
}
export function startDashboard(root, env, args = []) {
  const p = spawn(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), 'dashboard', ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let o = '';
  p.stdout.on('data', (b) => { o += b; });
  p.stderr.on('data', (b) => { o += b; });
  return { p, out: () => o, stop: () => new Promise((r) => { if (p.exitCode !== null) return r(); p.on('close', r); p.kill(); }) };
}
export async function until(f, what = 'the condition') {
  for (let i = 0; i < 300; i++) { const v = await f(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); }
  assert.fail(`timed out waiting for ${what}`);
}

// A request with a Host the test chooses (fetch may not send one): the status code.
export function statusWithHost(port, route, host, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: route, method, headers: { host, ...headers } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    r.on('error', reject);
    r.end();
  });
}
