// Helpers the kit's test files share. Importing it gives the process its own tmux server and its
// own block of ports (ports.mjs), so test files run side by side.
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
import { runNode } from './cli.mjs';

export { PORTS };
export const testDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const kit = path.resolve(testDir, '..', 'docs', 'devteam');
// The tmux session a project's workers live in: devteam-<project>-<hash of the checkout's path>.
export function sessionOf(root, name) { return `devteam-${name}-${crypto.createHash('sha1').update(fs.realpathSync(root)).digest('hex').slice(0, 6)}`; }
export const line = (o) => `${JSON.stringify({ v: 1, ...o })}\n`;
// A test never rotates the machine's real Claude accounts: a test that wants cswap sets a stand-in.
process.env.DEVTEAM_CSWAP = 'off';
// A fixture's stand-in supervisor runs under whatever agent runs the tests; it isn't that agent.
process.env.DEVTEAM_SUPERVISOR_UP = 'off';
// tmux in this test talks to its own server, never the developer's (or a live fleet's) sessions.
// tmux falls back to the machine's default server when TMUX_TMPDIR names a directory that is gone,
// and a kill-server there takes down every live fleet on the machine. So a shim first on PATH runs
// tmux only while TMUX_TMPDIR is an existing private dt-tmux-* directory, and this run's directory
// is removed only as the process exits, after its server.
export const tmuxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-tmux-'));
process.env.TMUX_TMPDIR = tmuxRoot;
delete process.env.TMUX;
// a devteam session's own home never reaches the kits under test
delete process.env.DEVTEAM_HOME;
delete process.env.TMUX_PANE;
// The real tmux is the first one on PATH that isn't a shim: a fork or a warm CLI process inherits
// its parent's PATH, shim first.
const isShim = (f) => { try { return fs.readFileSync(f, 'utf8').includes('tmux refused: TMUX_TMPDIR'); } catch { return false; } };
export const realTmux = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map((d) => path.join(d, 'tmux')).find((f) => { try { fs.accessSync(f, fs.constants.X_OK); return fs.statSync(f).isFile() && !isShim(f); } catch { return false; } }) ?? '';
// The shim lives at a path named for what it runs, written whole and never removed, so a process
// that outlives the one that made it (a fork's child, a dashboard) still finds it.
const shimText = `#!/bin/sh\ncase "$TMUX_TMPDIR" in */dt-tmux-*) [ -d "$TMUX_TMPDIR" ] && exec ${JSON.stringify(realTmux || 'tmux-not-installed')} "$@" ;; esac\necho "tmux refused: TMUX_TMPDIR ($TMUX_TMPDIR) is not an existing private test directory" >&2\nexit 1\n`;
export const tmuxShim = path.join(os.tmpdir(), `devteam-test-tmux-shim-${crypto.createHash('sha1').update(shimText).digest('hex').slice(0, 12)}`);
if (!isShim(path.join(tmuxShim, 'tmux'))) {
  fs.mkdirSync(tmuxShim, { recursive: true });
  const t = path.join(tmuxShim, `tmux.${process.pid}`);
  fs.writeFileSync(t, shimText, { mode: 0o755 });
  fs.renameSync(t, path.join(tmuxShim, 'tmux'));
}
process.env.PATH = `${tmuxShim}${path.delimiter}${process.env.PATH}`;
process.on('exit', () => {
  spawnSync('tmux', ['kill-server']);
  fs.rmSync(tmuxRoot, { recursive: true, force: true });
});
// Dashboards started by tests never use the machine's real ports or become its hub: the hub and
// the instance block move to ports the tests own.
process.env.DEVTEAM_HUB_PORT = String(PORTS);
process.env.DEVTEAM_PORT_BASE = String(PORTS + 1);
export const hasTmux = spawnSync('tmux', ['-V']).status === 0;
// A port the OS says is free: a random one in a range can land on a machine's own listener (macOS's
// AirPlay receiver holds 5000 and answers 403), which then passes the test's startup probe.
export const freePort = () => new Promise((resolve, reject) => { const v = net.createServer(); v.on('error', reject); v.listen(0, '127.0.0.1', () => { const { port } = v.address(); v.close(() => resolve(port)); }); });
// Wait for a server the test started to answer: up to 2 min, since a loaded machine starts it slowly;
// a server that never answers fails here, not at the test's first real request.
export const serverUp = async (url) => { for (let i = 0; i < 1200; i++) { try { await fetch(url); return; } catch { await new Promise((r) => setTimeout(r, 100)); } } throw new Error(`no server at ${url} after 2 min`); };
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
  const run = (cwd, args, role = {}, input) => { const r = runNode(path.join(cwd, 'docs/devteam/scripts/devteam.mjs'), args, { cwd, env: env(role), input }); return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
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
  const done = () => { spawnSync('tmux', ['kill-server'], { env: { ...process.env, TMUX_TMPDIR: tmuxDir } }); fs.rmSync(tmuxDir, { recursive: true, force: true }); if (!process.env.DEVTEAM_TEST_KEEP) fs.rmSync(base, { recursive: true, force: true }); else console.log(`${name} fixture kept at ${base}`); };
  return { base, org, old, neu, home, env, run, ok, g, land, done };
}

// Threads, on a project of their own: the chain's log runs its clock into 2100 (lines written by
// hand dated there), and a thread's rules compare when the owner and the supervisor last spoke. A
// goal to point at, the owner's and the supervisor's commands, a stand-in supervisor pane that logs
// what is typed into it, and lines written by hand at a time the test picks.
export function threadsFixture(name = 'threads') {
  const F = fleetFixture(name);
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const DT = path.join(F.old, 'docs/devteam/scripts/devteam.mjs');
  // The supervisor's pane is only ever the one a test names: a DEVTEAM_SUPERVISOR from the session
  // running the tests would have the fixture type into a real supervisor.
  const env = (role = {}) => { const e = F.env(role); if (!('DEVTEAM_SUPERVISOR' in role)) delete e.DEVTEAM_SUPERVISOR; return e; };
  const run = (args, role = {}) => { const r = runNode(DT, args, { cwd: F.old, env: env(role) }); return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
  const ok = (args, role = {}) => { const r = run(args, role); assert.equal(r.status, 0, `${args.join(' ')}: ${r.err || r.out}`); return r.out; };
  const owner = (args, extra = {}) => ok(args, extra);
  const sup = (args, extra = {}) => ok(args, { ...SUP, ...extra });
  const fails = (args, role = {}) => { const r = run(args, role); assert.notEqual(r.status, 0, `${args.join(' ')} should fail: ${r.out}`); return `${r.err}\n${r.out}`; };
  const goalArgs = (title, priority) => ['goal', 'add', '--title', title, '--outcome', 'admins pay alone', '--measure', 'self-serve share', '--target', '80', '--unit', '%', '--direction', 'up', '--source', 'prod', '--check', 'echo 5', '--horizon', '2027-03-31', '--non-goals', 'enterprise invoicing', '--preconditions', 'cards work', 'prices defined', '--priority', String(priority)];
  const goal = sup(goalArgs('Launch checkout', 1));
  const logDir = path.join(F.old, 'docs/devteam/run/log');
  const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
  // a line as the kit would have written it agoMs ago (owner lines carry their channel); file
  // overrides the writer's file, for a writer the authority table refuses
  const hand = (by, o, agoMs, file = null) => {
    const d = new Date(Date.now() - agoMs);
    const id = o.id ?? `${{ thread: 't', turn: 'u', question: 'q', observation: 'o' }[o.type]}-${stamp(d)}-${by}`;
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, file ?? `${by}-${d.toISOString().slice(0, 7)}.jsonl`), line({ op: 'new', ...(by === 'owner' ? { channel: 'cli' } : {}), ...o, id, at: d.toISOString(), by }));
    return id;
  };
  // the live log as it is, and put back: a hand-written line must not outlive its case
  const snapLog = () => new Map(fs.readdirSync(logDir).map((f) => [f, fs.readFileSync(path.join(logDir, f))]));
  const restoreLog = (snap) => { for (const f of fs.readdirSync(logDir)) if (snap.has(f)) fs.writeFileSync(path.join(logDir, f), snap.get(f)); else fs.rmSync(path.join(logDir, f), { force: true }); };
  // log-check on the log with these lines in it, which are then taken out again
  const checkWith = (...lines) => {
    const snap = snapLog();
    try { lines.forEach(([by, o, file], i) => hand(by, o, 60000 - i, file)); const r = run(['log-check']); return { status: r.status, said: `${r.out}\n${r.err}` }; } finally { restoreLog(snap); }
  };
  // A stand-in for the supervisor's agent (not a shell, which the kit never types into): it draws a
  // line and logs what it is sent, so a test reads exactly what the kit typed. A pty takes at most
  // MAX_INPUT bytes of one unfinished line (1,024 on macOS); the kit's pane line stays under it, its
  // words cut at 300 bytes and the rest kind, ids and the show command.
  const standIn = () => {
    const dir = fs.mkdtempSync(path.join(F.base, 'pane-'));
    const agent = path.join(dir, 'agent.mjs');
    const keys = path.join(dir, 'keys.txt');
    write(agent, "import fs from 'node:fs';\nprocess.stdout.write('stand-in supervisor\\n');\nprocess.stdin.on('data', (d) => fs.appendFileSync(process.argv[2], String(d)));\n");
    const s = `sup-${path.basename(dir).slice(5)}`;
    const e = env();
    spawnSync('tmux', ['new-session', '-d', '-x', '220', '-y', '50', '-s', s, '-n', 'main', `${process.execPath} ${agent} ${keys}`], { env: e });
    for (let i = 0; i < 300 && !/stand-in/.test(spawnSync('tmux', ['capture-pane', '-p', '-t', `=${s}:main`], { env: e, encoding: 'utf8' }).stdout ?? ''); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    return { target: `${s}:main`, typed: () => (fs.existsSync(keys) ? fs.readFileSync(keys, 'utf8') : '') };
  };
  // A goal up for approval: fully defined, read, its milestones set, a design linked (planning.md §1).
  const approval = () => {
    const g = sup(goalArgs('Self-serve billing', 2));
    sup(['goal', 'reading', g, '--run']);
    sup(['goal', 'set', g, '--milestones', JSON.stringify([{ title: 'Cards on file', target: 40, by: '2027-01-31', preconditions: [1], tickets: 4 }, { title: 'Self-serve prices', target: 80, preconditions: [2], tickets: 6 }])]);
    const q = sup(['ask', '--kind', 'goal-approval', '--goal', g, '--question', 'Approve self-serve billing, built as the design describes?', '--links', JSON.stringify([{ title: 'The approach', path: 'docs/devteam/project/designs/self-serve-billing.md', ref: 'main' }])]);
    return { goal: g, question: q };
  };
  // env replaces fleetFixture's, so a dashboard a test starts (startDashboard(F.old, F.env({}))) gets the same
  return { ...F, env, SUP, owner, sup, fails, goal, hand, snapLog, restoreLog, checkWith, standIn, approval, logDir };
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

// Three repos: home (the kit, project/, its log) and two siblings, each a bare remote plus a
// checkout laid out where path says (../<id>), forge git so no GitHub is needed. Console's main
// branch is trunk.
export function multiFixture(name) {
  const F = monoFixture(name);
  const { base, g, old } = F;
  const sibling = (id, branch, files) => {
    const bare = path.join(base, `${id}.git`);
    const co = path.join(base, id);
    g(['init', '-q', '--bare', '-b', branch, bare], base);
    fs.mkdirSync(co);
    g(['init', '-q', '-b', branch], co);
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) g(['config', k, v], co);
    g(['remote', 'add', 'origin', bare], co);
    for (const [f, text] of Object.entries(files)) write(path.join(co, f), text);
    g(['add', '-A'], co);
    g(['commit', '-qm', 'init'], co);
    g(['push', '-q', 'origin', branch], co);
    g(['fetch', '-q', 'origin'], co);
    return { bare, co };
  };
  const c = sibling('console', 'trunk', { 'src/main.js': 'console\n', 'package.json': '{}\n', '.gitignore': 'node_modules/\n' });
  const p = sibling('companion', 'main', { 'app/index.js': 'companion\n', 'README.md': 'c\n' });
  F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { links: {
    console: { kind: 'repo', title: 'Electron console', remote: c.bare, main_branch: 'trunk', gates: { test: 'test -f src/main.js' } },
    companion: { kind: 'repo', title: 'Companion app', remote: p.bare },
  } });
  // the kit is home's, run by absolute path from any checkout (a sibling worktree has no kit)
  const kitDT = path.join(old, 'docs/devteam/scripts/devteam.mjs');
  const runIn = (cwd, args, role = {}, extra = {}, input) => { const r = spawnSync(process.execPath, [kitDT, ...args], { cwd, env: { ...F.env(role), ...extra }, encoding: 'utf8', input }); return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
  const okIn = (cwd, args, role, extra, input) => { const r = runIn(cwd, args, role, extra, input); assert.equal(r.status, 0, `${args.join(' ')}: ${r.err || r.out}`); return r.out; };
  // git prints real paths (/private/var on macOS); compare paths through this
  const real = (x) => fs.realpathSync(x);
  const ticket = (id, extra = {}) => okIn(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component: id.split('-')[0], kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['src/**'], done_when: ['its suite passes in CI'], notes: 'n', ...extra })], { DEVTEAM_ROLE: 'supervisor' });
  return { ...F, consoleOrigin: c.bare, console: c.co, companionOrigin: p.bare, companion: p.co, kitDT, runIn, okIn, ticket, real };
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
  return { p, out: () => o, stop: () => new Promise((r) => {
    if (p.exitCode !== null || p.signalCode !== null) return r();
    // its children can hold the pipes open after it has gone: 'close' can wait forever, so not past a moment after 'exit'
    p.once('exit', () => setTimeout(() => { p.stdout.destroy(); p.stderr.destroy(); r(); }, 500).unref());
    p.on('close', r);
    const hard = setTimeout(() => p.kill('SIGKILL'), 10000);
    hard.unref();
    p.once('exit', () => clearTimeout(hard));
    p.kill();
  }) };
}
// Up to 2 min: a dashboard's first background run (hello hashes every kit file) takes that long on
// a loaded machine; a healthy one returns at once.
export async function until(f, what = 'the condition') {
  for (let i = 0; i < 1200; i++) { const v = await f(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); }
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

// ===== components in other repos =====

// A copy of the kit in a repo with no project settings (a sibling the kit was copied into by
// mistake, before it has any tickets/) is no home: nothing runs but init and help.

// A sibling worker's worktree is its repo's, so home's git can't remove it: worker <id> --remove
// does, through that repo, and prunes that repo's list, so a later worker <id> starts cleanly.

// Views route by name (repoOfTicketLink, factsRepo, repoReadable), so a machine without one
// sibling's checkout still shows status and metrics; acts route by object and fail fast.

// Across repos neither the branch nor the gates can see a provider that hasn't landed, so the
// ticket that depends on it lands only after it, by merge or check-pr; a forge-UI merge that lands
// it first is a finding.

// A worker's deny rules name its own repo's main, and a merge no merge act made, on any repo's
// main, is a finding (a worker's push, the forge's button), counted only after the upgrade.

// The tick reads every repo's main as its origin has it now: observe-metrics fetches each repo
// link's main before it reads anything, so a push from another clone (or a forge-UI merge) shows.

// gh resolves a single-repo project's base repo itself (gh repo set-default, else the only remote),
// so home's gh calls name no repo, as before repo links; only a sibling's say -R.

// The drawer's peek cache, loaded from index.html by itself: a file is one object per repo and ref,
// so home's README.md and a sibling's README.md never share a cached Commits list.

// One answer may approve a bundle of repo link changes, but only the bundle its question showed:
// merge binds each changed owner-kind entry to an act of that answer with the entry that lands.
