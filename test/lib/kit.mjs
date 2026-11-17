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
// The suite's own switches, the only DEVTEAM_* a test process keeps from the shell that ran it.
export const HARNESS_ENV = /^DEVTEAM_(TEST_.*|FORK|FORK_AUDIT|G1_RECORD|CGROUP|MEMINFO)$/;
// Nothing of the session that runs the tests reaches the kits under test: a worker's DEVTEAM_RUN once
// sent a test's writes into its fleet's live log, and a box's DEVTEAM_PUBLIC_URL makes every kit a box.
for (const k of Object.keys(process.env)) if ((/^DEVTEAM_/.test(k) && !HARNESS_ENV.test(k)) || /^TMUX(_PANE)?$/.test(k)) delete process.env[k];
// On a box, its files say box whatever a test's environment says; the kit drops them for a test's
// throwaway HOME (devteam.mjs, boxFilesOff), so a test sees the box its environment describes.
process.env.DEVTEAM_BOX = 'off';
// A test never rotates the machine's real Claude accounts: a test that wants cswap sets a stand-in.
process.env.DEVTEAM_CSWAP = 'off';
// A fixture's stand-in supervisor runs under whatever agent runs the tests; it isn't that agent.
process.env.DEVTEAM_SUPERVISOR_UP = 'off';
// The kit won't start a session while the machine's memory is over its ceiling: a test reads a
// machine of its own (DEVTEAM_CGROUP, DEVTEAM_MEMINFO), or none, never the one it runs on.
process.env.DEVTEAM_CGROUP ??= path.join(os.tmpdir(), 'dt-no-such-machine');
process.env.DEVTEAM_MEMINFO ??= path.join(os.tmpdir(), 'dt-no-such-machine');
// tmux in this test talks to its own server, never the developer's (or a live fleet's) sessions.
// tmux falls back to the machine's default server when TMUX_TMPDIR names a directory that is gone,
// and a kill-server there takes down every live fleet on the machine. So a shim first on PATH runs
// tmux only while TMUX_TMPDIR is an existing private dt-tmux-* directory, and this run's directory
// is removed only as the process exits, after its server.
export const tmuxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-tmux-'));
process.env.TMUX_TMPDIR = tmuxRoot;
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
// A default's deadline, passed: the question's own line says it fell due a minute ago, so a default
// applied now is applied after it (answer --defaulted refuses before).
export function pastDeadline(root, qid) {
  const dir = path.join(root, 'docs/devteam/run/log');
  for (const f of fs.readdirSync(dir).filter((x) => x.startsWith('supervisor-'))) {
    const p = path.join(dir, f);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').split('\n').map((l) => (l.includes(`"id":"${qid}"`) && l.includes('"deadline"') ? JSON.stringify({ ...JSON.parse(l), deadline: new Date(Date.now() - 60000).toISOString() }) : l)).join('\n'));
  }
}

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
    return { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, 'claude'), CODEX_HOME: path.join(home, 'codex'), TMUX_TMPDIR: tmuxDir, ...role };
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
  // retried: a dashboard's child can still be writing its cache (run/cache) a moment after it stopped
  const done = () => { spawnSync('tmux', ['kill-server'], { env: { ...process.env, TMUX_TMPDIR: tmuxDir } }); fs.rmSync(tmuxDir, { recursive: true, force: true }); if (!process.env.DEVTEAM_TEST_KEEP) fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); else console.log(`${name} fixture kept at ${base}`); };
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
  // the log as main has it, read back through git: text beyond ASCII, and one file whose last line
  // has no newline (each must read back from main exactly as it does from the disk)
  ok(old, ['observe', '--subject', 'g1', '--kind', 'note', '--key', 'note:g1', '--detail', 'naïve — em dash ✓', '--owner']);
  F.land();
  // a ticket merged on main and released: its merge commit, its date and the tag that holds it
  g(['checkout', '-q', '-b', 'ticket/g1-02-b'], old);
  write(path.join(old, 'src/b/b.js'), 'b\n');
  g(['add', '-A', 'src'], old);
  g(['commit', '-qm', 'g1-02-b: work'], old);
  g(['checkout', '-q', 'main'], old);
  g(['merge', '-q', '--no-ff', '-m', 'Merge pull request #2 from t/ticket/g1-02-b', 'ticket/g1-02-b'], old);
  g(['tag', 'v1.0.0'], old);
  g(['push', '-q', 'origin', 'main', 'v1.0.0'], old);
  const durable = path.join(old, 'docs/devteam/project/log');
  const owners = fs.readdirSync(durable).filter((f) => f.startsWith('owner-'));
  for (const f of owners) fs.writeFileSync(path.join(durable, f), fs.readFileSync(path.join(durable, f), 'utf8').replace(/\n$/, ''));
  g(['commit', '-qam', 'chore-log: the owner file without its last newline'], old);
  g(['push', '-q', 'origin', 'main'], old);
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
    'dashboard-data': jsonOut(run(old, ['dashboard-data'])),
    'peek-ticket': jsonOut(run(old, ['peek', 'ticket', 'g1-01-a'])),
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
// The script's git readers, loaded by themselves and run against cwd: git(), the batched reader,
// reads at a commit.
export function gitReadFns(cwd) {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const i = src.indexOf('/* git reads start */'), j = src.indexOf('/* git reads end */');
  assert.ok(i >= 0 && j > i, 'the git reads block in devteam.mjs');
  const ctx = vm.createContext({ execFileSync, spawnSync, Buffer, process: { cwd: () => cwd } });
  return vm.runInContext(`${src.slice(i, j)}\nHOME_CWD = ${JSON.stringify(cwd)};\n;({ git, gitStatus, parseBatch, gitBatch, prefetchAt, showAt, atCommit })`, ctx);
}
// The same readers with the store of git facts, its file under runDir; onExit stands for the
// process ending (the store writes then).
export function gitFactFns(cwd, runDir) {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b); assert.ok(i >= 0 && j > i, `${a} … ${b}`); return src.slice(i, j); };
  const exits = [];
  const writeJson = (p, obj) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const tmp = `${p}.${process.pid}.tmp`; fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`); fs.renameSync(tmp, p); };
  const ctx = vm.createContext({ execFileSync, spawnSync, Buffer, fs, path, runDir, writeJson,
    readJson: (p) => JSON.parse(fs.readFileSync(p, 'utf8')), isObj: (x) => !!x && typeof x === 'object' && !Array.isArray(x),
    sha256: (b) => crypto.createHash('sha256').update(b).digest('hex'),
    process: { cwd: () => cwd, env: {}, on: (ev, f) => { if (ev === 'exit') exits.push(f); } } });
  const fns = vm.runInContext(`${cut('/* git reads start */', '/* git reads end */')}\n${cut('/* git facts start */', '/* git facts end */')}\nHOME_CWD = ${JSON.stringify(cwd)};\n;({ commitDateOf, ancestorOf, releasedInAt, factGet })`, ctx);
  return { ...fns, exit: () => { for (const f of exits.splice(0)) f(); } };
}
// One folder for every boxFns machine in this process, removed as it exits.
let boxFnsRoot = null;
const boxFnsDir = () => { if (!boxFnsRoot) { boxFnsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-boxfns-')); process.on('exit', () => fs.rmSync(boxFnsRoot, { recursive: true, force: true })); } return boxFnsRoot; };
// The script's box detection, loaded by itself on a machine of the test's making: the box's files
// exist only as files names them ({ path: text }), HOME is home, the password file's home is passwd
// (null: the uid has none, and userInfo throws), and the environment is { HOME, ...env }.
export function boxFns({ files = {}, home, passwd, env = {} }) {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b); assert.ok(i >= 0 && j > i, `${a} … ${b} marks a block in devteam.mjs`); return src.slice(i, j); };
  const BOX = ['/opt/devteam/gateway.mjs', '/etc/devteam/thread-key.pub'];
  const dir = fs.mkdtempSync(path.join(boxFnsDir(), 'm-'));
  const stand = Object.fromEntries(BOX.filter((f) => f in files).map((f, i) => { const p = path.join(dir, `box-${i}`); fs.writeFileSync(p, files[f]); return [f, p]; }));
  const at = (f) => (BOX.includes(f) ? stand[f] ?? path.join(dir, 'none') : f);
  const sandboxFs = { existsSync: (f) => fs.existsSync(at(f)), statSync: (f) => fs.statSync(at(f)), readFileSync: (f, e) => fs.readFileSync(at(f), e), realpathSync: (f) => fs.realpathSync(f) };
  const sandboxOs = { homedir: () => home, userInfo: () => { if (passwd === null) throw new Error('no passwd entry'); return { homedir: passwd }; } };
  const ctx = vm.createContext({ fs: sandboxFs, os: sandboxOs, crypto, URL, process: { env: { HOME: home, ...env } } });
  return vm.runInContext(`${cut('/* preview box start */', '/* preview box end */')}\n${cut('/* box start */', '/* box end */')}\n;({ onBox, threadsNeedGateway, gatewayThreadKey, boxFilesOff, BOX_GATEWAY_FILE, BOX_THREAD_KEY })`, ctx);
}
// The script's ranked keyword search, loaded by itself.
export function searchFns() {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const i = src.indexOf('/* search start */'), j = src.indexOf('/* search end */');
  assert.ok(i >= 0 && j > i, 'the search block in devteam.mjs');
  return vm.runInContext(`${src.slice(i, j)}\n;({ searchTokens, searchIndex, searchRank, searchSimilar })`, vm.createContext({}));
}
// A project's writing, generated the same way every time (seeded): questions, each about a topic of
// its own and with a context that shares some of its words, observations and lessons, from a few
// thousand made-up words. Sized by the count of each.
export function searchCorpus({ questions = 130, observations = 300, lessons = 30, words = 60 } = {}) {
  // mulberry32: 32-bit integer arithmetic, so it never loses precision and cycles
  let seed = 7;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const syl = ['ka', 'lo', 'mi', 'ne', 'ru', 'sa', 'to', 'vi', 'zo', 'pe', 'qu', 'da', 'fi', 'gu', 'ho', 'ja'];
  const vocab = Array.from({ length: 3000 }, () => Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => syl[Math.floor(rnd() * syl.length)]).join(''));
  const pick = (n) => Array.from({ length: n }, () => vocab[Math.floor(rnd() * vocab.length)]);
  const say = (n, topic = []) => [...topic, ...pick(n)].sort(() => rnd() - 0.5).join(' ');
  const qs = Array.from({ length: questions }, (_, i) => { const topic = pick(5); return { id: `q-${i}`, question: `${say(8, topic)}?`, context: say(words, topic.slice(0, 3)) }; });
  const obs = Array.from({ length: observations }, (_, i) => ({ id: `o-${i}`, subject: pick(1)[0], detail: say(words) }));
  const ks = Array.from({ length: lessons }, (_, i) => ({ id: `k-${i}`, statement: say(15) }));
  assert.equal(new Set(qs.map((q) => q.context)).size, qs.length, 'every context its own');
  assert.equal(new Set(obs.map((o) => o.detail)).size, obs.length, 'every detail its own');
  return { questions: qs, observations: obs, lessons: ks };
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
  // every path init and fleetFixture track: AGENTS.md, .gitignore and .gitleaks.toml from init; config/dev.key is gitignored
  const STD = { api: { owns: ['api/**'] }, web: { owns: ['web/**'] }, ops: { owns: ['ops/**', '.github/**', 'README.md', '.gitignore', '.gitleaks.toml', 'AGENTS.md'] } };
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
  // a fixture is a repo of its own: a kit copied into a folder of another repo would take that repo's home
  assert.equal(fs.realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: r, encoding: 'utf8' }).trim()), fs.realpathSync(r), 'a fixture is a repo of its own');
  fs.cpSync(kit, path.join(r, 'docs', 'devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
  const i = spawnSync(process.execPath, [path.join(r, 'docs/devteam/scripts/devteam.mjs'), 'init', '--name', name], { cwd: r, encoding: 'utf8' });
  assert.equal(i.status, 0, i.stderr);
  return r;
}
// The dashboard in a process group of its own: what it runs (hello, dashboard-data, an owner's command)
// is in that group and can outlive it, still writing into the fixture, so stop() ends the group too and
// waits until nothing in it is left: a fixture removed after stop() has nobody writing into it.
// A test process that exits without stop() leaves none of the groups running; and as they are out of
// the terminal's reach (a Ctrl-C reaches only its own group, and Node's default for a signal skips
// 'exit'), a SIGINT or SIGTERM is made an exit. One hook for every dashboard alive, gone with the last.
// A test process killed outright (node --test kills a file's process at once on Ctrl-C when it is in
// a synchronous wait, as the CLI helpers are) runs no hook: each dashboard has a watcher, out of both
// groups, holding the read end of a pipe from the test process. The kernel closes the write end on any
// death of the test process, SIGKILL too (and Node opens it close-on-exec, so nothing the test process
// starts holds it), and the watcher then ends the dashboard's group. stop() and the exit hook end the
// watcher first, so it outlives its dashboard only when the test process died some other way.
const DASH_WATCH = `const g = Number(process.argv[1]); const end = () => { try { process.kill(-g, 'SIGKILL'); } catch {} process.exit(0); };
process.stdin.on('end', end); process.stdin.on('close', end); process.stdin.on('error', end); process.stdin.resume();`;
const DASH_GROUPS = new Map(); // the dashboard's pid (its group), its watcher
const killDashGroups = () => { for (const [g, w] of DASH_GROUPS) { try { w.kill('SIGKILL'); } catch {} try { process.kill(-g, 'SIGKILL'); } catch {} } };
const onDashSig = (s) => process.exit(128 + (s === 'SIGINT' ? 2 : 15));
// the groups killed before any other exit hook (the fixtures' removal among them)
const dashHooks = (on) => { if (on) process.prependListener('exit', killDashGroups); else process.off('exit', killDashGroups); for (const s of ['SIGINT', 'SIGTERM']) process[on ? 'on' : 'off'](s, onDashSig); };
export function startDashboard(root, env, args = []) {
  const p = spawn(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), 'dashboard', ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  p.on('error', () => {});
  const group = (sig) => { try { process.kill(-p.pid, sig); return true; } catch { return false; } };
  let watcher = null;
  if (p.pid) {
    watcher = spawn(process.execPath, ['-e', DASH_WATCH, String(p.pid)], { detached: true, stdio: ['pipe', 'ignore', 'ignore'] });
    watcher.on('error', () => {});
    watcher.stdin.on('error', () => {});
    watcher.unref();
    watcher.stdin.unref();
    if (!DASH_GROUPS.size) dashHooks(true);
    DASH_GROUPS.set(p.pid, watcher);
  }
  let o = '';
  p.stdout.on('data', (b) => { o += b; });
  p.stderr.on('data', (b) => { o += b; });
  let stopping = null;
  const stop = () => (stopping ??= new Promise((r) => {
    // the dashboard gone: whatever it started is killed, and waited for (up to 10 s, then left)
    const rest = async () => {
      try { watcher?.kill('SIGKILL'); } catch {}
      watcher?.stdin.destroy();
      for (let i = 0; i < 200 && group('SIGKILL'); i++) await new Promise((w) => setTimeout(w, 50));
      p.stdout.destroy();
      p.stderr.destroy();
      if (DASH_GROUPS.delete(p.pid) && !DASH_GROUPS.size) dashHooks(false);
      r();
    };
    if (p.exitCode !== null || p.signalCode !== null) return void rest();
    p.once('exit', () => void rest());
    const hard = setTimeout(() => p.kill('SIGKILL'), 10000);
    hard.unref();
    p.once('exit', () => clearTimeout(hard));
    p.kill();
  }));
  return { p, out: () => o, stop };
}
// A dashboard pinned to a port freePort found, resolved once it listens. The port is free when
// freePort lets go of it, and anything on the machine can take it before the dashboard binds it: a
// Chrome's DevTools port, which the kernel picks the same way, or a connection's own end. A pinned
// dashboard that lost it says EADDRINUSE and exits, and is started again on another; one that exits
// for any other reason fails here with what it said, not after a 2 min wait for a line it never prints.
export async function dashboardOnFreePort(root, env, args = []) {
  for (let i = 0; ; i++) {
    const port = await freePort();
    const dash = startDashboard(root, env, [...args, '--port', String(port)]);
    // never left running by a wait that failed: no test has it to stop yet
    try { await until(() => /dashboard on http/.test(dash.out()) || dash.p.exitCode !== null || dash.p.signalCode !== null, 'the dashboard'); } catch (e) { await dash.stop(); throw e; }
    if (/dashboard on http/.test(dash.out())) return { dash, port };
    // its last words may still be in the pipe when it exits
    await new Promise((r) => { if (dash.p.stdout.closed && dash.p.stderr.closed) return r(); dash.p.once('close', r); setTimeout(r, 5000).unref(); });
    await dash.stop();
    if (!/EADDRINUSE/.test(dash.out()) || i >= 4) assert.fail(`the dashboard on ${port} exited: ${dash.out().slice(-800)}`);
  }
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

// kit-174: the Efficiency page's fixture, as kit-173's /api/data efficiency and metrics.cost carry it.
// Every week has kit-173's shape and its null rules; the numbers are picked for the page's checks, not
// worked out by kit-173's scoring (the page computes nothing, so it can't tell): weeks[3] had no ticket
// and no spend (score, parts and per-point figures null), this week has an escaped defect (score 31) unless defect is false (score 72), and the
// phase 'spec' is missing from weeks 0 to 2 and 4 to 5. metrics differs from observe in a key each and
// in output tokens, so a test can tell which one the page drew from.
export function efficiencyFixture({ defect = true, efficiency = true, source = 'measured', suggestions, waste, weeks, threads = [] } = {}) {
  const usdPP = [62, 59, 64, null, 54, 50, 33.2, 51, 46, 43, 45, 41];
  const hPP = [8.1, 7.9, 8.4, null, 7, 6.6, 5, 6.9, 6.4, 6.2, 7.3, 6.8];
  const first = [0.44, 0.47, 0.41, 1, 0.49, 0.52, 0.55, 0.51, 0.56, 0.6, 0.58, 0.62];
  const cache = [0.52, 0.55, 0.5, null, 0.58, 0.61, 0.63, 0.6, 0.62, 0.64, 0.61, 0.58];
  const points = [6, 7, 5, 0, 7, 9, 6, 8, 9, 10, 7, 8];
  const score = [55, 58, 52, null, 60, 62, 64, 61, 63, 65, 67, defect ? 31 : 72];
  const thisParts = defect ? { spend: 0.16, time: 0.15, rework: 0.62 } : { spend: 0.81, time: 0.74, rework: 0.62 };
  const tok = (n) => ({ input: n * 1e5, output: n * 4e4, cache_read: n * 2e5, cache_write: n * 2e4 });
  const start = Date.parse('2026-08-24T00:00:00Z');
  const W = usdPP.map((u, i) => {
    const empty = i === 3;
    const phases = empty ? [] : [['build', 130 - i], ['planning', 95 - i], ['final-review', 80 - i], ...(i <= 2 || i === 4 || i === 5 ? [] : [['spec', 60 - i]])];
    return {
      starts_at: new Date(start + i * 7 * 864e5).toISOString(), tickets: empty ? 0 : 4, points: points[i], usd_per_point: u, hours_per_point: hPP[i],
      first_pass: first[i], first_passes: empty ? 0 : 5, cache_read_share: cache[i], escaped_defects: i === 11 && defect ? 1 : 0,
      usd_by_phase: Object.fromEntries(phases), tokens_by_phase: Object.fromEntries(phases.map(([k, v]) => [k, tok(v / 10)])),
      score: score[i], parts: empty ? null : i === 11 ? thisParts : { spend: 0.7, time: 0.7, rework: first[i] },
    };
  });
  const observe = {
    phase_hours: { build: 21.4, 'final-review': 9.1, planning: 4.2, spec: 3.1 },
    phase_usd: { build: 128, planning: 94, 'final-review': 81, spec: 61 },
    by_model: { 'claude-opus-5-5': { usd: 447 }, 'claude-sonnet-5-5-with-a-very-long-model-name-for-the-390px-check': { usd: 14 } },
    tokens: { input: 2.4e6, output: 3.1e6, cache_read: 9e6, cache_write: 1.2e6 },
    tokens_by_phase: { build: tok(216), planning: tok(162), 'final-review': tok(71), spec: tok(104) },
  };
  const eff = {
    weeks: weeks ?? W, best: { usd_per_point: 33.2, hours_per_point: 5 }, score: { this_week: score[11], last_week: 67 }, parts: thisParts, observe,
    waste: waste ?? [
      { id: 'o-20261115-000000001-supervisor', kind: 'costly-ticket', subject: 'kit-87', detail: 'kit-87 cost 3.1× the median merged ticket per point ($254)' },
      { id: null, kind: 'low-cache-hit', subject: 'prompt-cache', detail: '58% of input tokens were cache reads, under 60%' },
    ],
    trials: [],
    suggestions: suggestions ?? [
      { id: 'eff-costly-ticket-kit-87', kind: 'costly-ticket', what: 'Look at where kit-87 spent its dollars', evidence: '$254, 3.1× the median merged ticket per point', effect: 'about $172 once', usd: 172, per: 'once' },
      { id: 'eff-smaller-model-claude-opus-5-5', kind: 'smaller-model', what: 'Run searches and test runs on claude-sonnet-5-5', evidence: 'claude-opus-5-5 took 97% of spend', effect: 'about $75 a week', usd: 75, per: 'week' },
      { id: 'eff-cache-prompt-cache', kind: 'cache', what: 'Resume sessions instead of starting them again', evidence: '58% of input tokens were cache reads', effect: 'about $25 a week', usd: 25, per: 'week' },
      { id: 'eff-mystery-x', kind: 'mystery', what: 'Something the page has no words for', evidence: 'seen once', effect: 'about $5 a week', usd: 5, per: 'week' },
    ],
  };
  const metrics = {
    phase_hours: { ...observe.phase_hours, 'metrics-only-phase': 2 },
    phase_usd: { ...observe.phase_usd, 'metrics-only-phase': 5 },
    cost: { source, tokens: { ...observe.tokens, output: 9.9e6 }, by_model: { 'metrics-only-model': { usd: 9 } }, unpriced_models: { 'gpt-x': 3 } },
    acknowledged: [{ kind: 'slow-gate', subject: 'test', ack: { by: 'supervisor', reason: 'known', until: new Date(Date.now() + 7 * 864e5).toISOString() } }],
    findings: [{ severity: 'medium', kind: 'stale-worker', subject: 'kit-1', detail: 'no phase line for 3 hours', suggestion: 'look at its pane' }],
  };
  return { efficiency: efficiency ? eff : null, metrics, threads };
}
// A thread as /api/threads gives one (threadView), on a subject, for efficiencyFixture's threads.
export function effThread({ id, subject, status = 'open', title = 'A thread', turns = [] }) {
  const at = new Date(Date.now() - 3600000).toISOString();
  return { id, title, subject, status, outcome: status === 'resolved' ? 'done' : null, ready: null, turns, questions: [], waiting: 'owner', created_at: at, resolved_at: status === 'resolved' ? at : null, activity_at: at, first_reply_ms: null };
}
// A script for Page.addScriptToEvaluateOnNewDocument: the page's fetch wrapped (as dashboard-answers'
// initScript) so /api/data carries fx's efficiency (none when null) and its metrics merged over the
// server's, and /api/threads also fx's threads; window.__fx is read on every answer, so a test can
// change it in the page. Every non-GET request is kept in window.__writes, every error in
// window.__errors, and the 10 s poll runs every 300 ms.
export function dataRewriteInit(fx) {
  return `(() => {
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => si(f, ms === 10000 ? 300 : ms, ...a);
  window.__fx = ${JSON.stringify(fx)};
  window.__writes = [];
  window.__errors = [];
  window.addEventListener('error', (e) => window.__errors.push(String(e.message || e.error || e)));
  window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason && e.reason.message || e.reason)));
  const json = (r, body) => new Response(JSON.stringify(body), { status: r.status, statusText: r.statusText, headers: r.headers });
  const real = window.fetch;
  window.fetch = async (u, o) => {
    const url = String(u && u.url ? u.url : u);
    const method = String(o?.method || 'GET').toUpperCase();
    if (method !== 'GET') window.__writes.push({ url, method, body: o?.body ?? null });
    const r = await real(u, o);
    const fx = window.__fx;
    if (method === 'GET' && r.ok && url.startsWith('/api/data')) {
      const d = await r.json();
      if (fx.efficiency) d.efficiency = fx.efficiency; else delete d.efficiency;
      const m = d.metrics || {};
      d.metrics = { ...m, ...fx.metrics, cost: { ...(m.cost || {}), ...(fx.metrics.cost || {}) } };
      return json(r, d);
    }
    if (method === 'GET' && r.ok && url.startsWith('/api/threads')) {
      const j = await r.json();
      return json(r, { ...j, threads: [...(j.threads || []), ...(fx.threads || [])] });
    }
    return r;
  };
})();`;
}


// kit-88: a project with a record for every side peek, every "How it changes" case and every item of
// the design's peek inventory ("Every detail and widget stays"), for test/dashboard-peek.test.mjs (and
// the measure's peek entries). The kit's own commands where they exist (goal, feature, ticket,
// questions, knowledge, a correction, a sensor ignore), lines as the kit would have written them for
// the rest (acts, decisions, problems, signals, learning, retros, a message, phases, gate runs, spend),
// git as the kit reads it (a merged ticket, a ticket branch with its documents, a review and a
// handoff commit, a planner's branch with its draft), sensor files as the poller writes them, and
// files committed on main. Returns the project and the id of each record.
// decision rests on qDefaulted (authority default), so its "The answer it rests on" is a defaulted
// answered card. decisionNotMine is older than the 80 rows the Decide tab draws (81 later calls), so
// no row on Self Improvement has its Correct.
export const PEEK_LONG = `Should the checkout keep the card form on one page, ${'with every field the processor asks for and every one it may ask for later, '.repeat(3)}or split it?`;
export function peekFixture(base, name = 'peek') {
  const root = bareProject(base, name);
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 2), DEVTEAM_PORT_BASE: String(PORTS + 3), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && !['DEVTEAM_HUB_PORT', 'DEVTEAM_PORT_BASE', 'DEVTEAM_BOX'].includes(k)) delete env[k];
  for (const k of ['TMUX', 'TMUX_PANE']) delete env[k];
  const dt = (args, role = 'supervisor') => {
    const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: root, env: role ? { ...env, DEVTEAM_ROLE: role } : env, encoding: 'utf8' });
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: root, encoding: 'utf8' }).trim();
  const logDir = path.join(root, 'docs/devteam/run/log');
  const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
  const T0 = Date.now();
  const PFX = { observation: 'o', problem: 'p', decision: 'd', act: 'a', knowledge: 'k', message: 'm', phase: 'h', gate: 'r', spend: 's' };
  // a line by hand at T0 - ago ms, in its writer's file; each picks a distinct ago, so ids differ
  const hand = (by, o, ago) => {
    const d = new Date(T0 - ago);
    const id = o.id ?? `${PFX[o.type]}-${stamp(d)}-${by}`;
    const file = ['owner', 'supervisor'].includes(by) ? `${by}-${d.toISOString().slice(0, 7)}.jsonl` : `${by}.jsonl`;
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, file), line({ op: 'new', ...(by === 'owner' ? { channel: 'cli' } : {}), ...o, id, at: d.toISOString(), by }));
    return id;
  };
  const H = 3600000, DAY = 24 * H;
  const ids = {};
  // files: a plain document, a governance file (the kit's own), a probe, an artifact, the feature's
  // design (its TL;DR), three retros' write-ups with their numbers; and two sensors
  write(path.join(root, 'docs/guide.md'), '# The guide\n\nHow the checkout works.\n');
  ids.file = 'docs/guide.md';
  ids.governanceFile = 'docs/devteam/governance/constitution.md';
  // a document with a diagram, an image, a page and a PDF (each file view the peek draws)
  write(path.join(root, 'docs/flow.md'), '# The flow\n\n```mermaid\nflowchart LR\n  cart --> pay\n```\n');
  ids.fileDiagram = 'docs/flow.md';
  fs.writeFileSync(path.join(root, 'docs/dot.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  ids.fileImage = 'docs/dot.png';
  write(path.join(root, 'docs/page.html'), '<!doctype html><html><head><meta charset="utf-8"><title>A page</title></head><body><p>a page</p></body></html>\n');
  ids.fileHtml = 'docs/page.html';
  const pdfObjs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] >>'];
  let pdf = '%PDF-1.4\n';
  const offs = pdfObjs.map((o, i) => { const at = pdf.length; pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = pdf.length;
  pdf += `xref\n0 ${pdfObjs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${pdfObjs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  write(path.join(root, 'docs/brief.pdf'), pdf);
  ids.filePdf = 'docs/brief.pdf';
  write(path.join(root, 'docs/devteam/project/sensors/reader.mjs'), 'export default async function () { return { events: [] }; }\n');
  write(path.join(root, 'docs/devteam/project/designs/launch-checkout.md'), '# Launch checkout\n\n## TL;DR\n\nAdmins pay by card without help.\n');
  write(path.join(root, 'docs/devteam/project/designs/pay.md'), '# Pay\n\n## TL;DR\n\nAn admin pays by card on one page.\n\n## The rest\n\nDetails.\n');
  const retroDoc = (n) => `# Retro\n\n\`\`\`json devteam-retro\n${JSON.stringify({ merged: n, reverts: n - 1, escaped: 0 })}\n\`\`\`\n`;
  for (const [f, n] of [['2026-11-02', 2], ['2026-11-09', 4], ['2026-11-16', 5]]) write(path.join(root, `docs/devteam/project/retros/${f}.md`), retroDoc(n));
  const sf = path.join(root, 'docs/devteam/project/settings.md');
  fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"gates": {}', '"links": { "docs-site": { "kind": "url", "url": "https://example.com/docs" } }, "sensors": { "web": { "kind": "http", "url": "https://example.com/health", "slo": { "uptime": 0.99, "p95_ms": 300 } }, "reader": { "kind": "probe", "probe": "project/sensors/reader.mjs", "every_minutes": 5 } }, "gates": {}'));
  ids.sensorHttp = 'web';
  ids.sensorReader = 'reader';
  const art = path.join(root, 'docs/devteam/project/artifacts/peek-mock');
  write(path.join(art, 'artifact.json'), JSON.stringify({ v: 1, title: 'Peek mock', summary: 'A page to view', by: 'supervisor', for: [] }));
  write(path.join(art, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Peek mock</title></head><body><p>the mock</p></body></html>\n');
  ids.artifact = 'peek-mock';
  git('add', '-A');
  git('commit', '-qm', 'the project');
  // the sensors' own files, as their poller writes them: the URL check's samples over a week (two
  // failed) and its state; the reader's fingerprints (one ignored below), their hourly counts, the
  // cached raw event of one, and its state with an invalid line
  const sdir = (n) => path.join(root, 'docs/devteam/run/sensors', n);
  const samples = [];
  for (let m = 7 * 24 * 60; m > 0; m -= 30) samples.push({ at: new Date(T0 - m * 60000).toISOString(), ok: !(m === 90 || m === 3000), ms: m === 90 || m === 3000 ? 40 : 100 + (m % 7) * 30, ...(m === 90 || m === 3000 ? { error: 'HTTP 503' } : {}) });
  write(path.join(sdir('web'), 'samples.jsonl'), samples.map((s) => `${JSON.stringify(s)}\n`).join(''));
  write(path.join(sdir('web'), 'state.json'), JSON.stringify({ state: 'up', since: new Date(T0 - DAY).toISOString(), last_at: new Date(T0 - 30 * 60000).toISOString(), last: { ok: true, ms: 120 }, fails: 0, tls_days: 40 }));
  const hourKey = (ago) => new Date(T0 - ago).toISOString().slice(0, 13);
  const fpE1 = { kind: 'exception', level: 'error', class: 'TypeError', title: 'card is undefined', total: 5, users: 2, first_seen: new Date(T0 - 5 * H).toISOString(), last_seen: new Date(T0 - H).toISOString(), frames: [{ file: 'pay/form.js', line: 12 }] };
  const fpE2 = { kind: 'exception', level: 'warning', class: 'Error', title: 'a crawler hit /cart', total: 2, first_seen: new Date(T0 - 3 * H).toISOString(), last_seen: new Date(T0 - 2 * H).toISOString() };
  write(path.join(sdir('reader'), 'fingerprints.json'), JSON.stringify({ 'exception:E1': fpE1, 'exception:E2': fpE2 }));
  write(path.join(sdir('reader'), 'counts.json'), JSON.stringify({ 'exception:E1': { [hourKey(H)]: 3, [hourKey(3 * H)]: 2 }, 'exception:E2': { [hourKey(2 * H)]: 2 } }));
  write(path.join(sdir('reader'), 'events', `${crypto.createHash('sha1').update('exception:E1').digest('hex').slice(0, 16)}.json`), JSON.stringify({ at: new Date(T0 - H).toISOString(), event: { message: 'TypeError: card is undefined', at: 'pay/form.js:12' } }));
  const today = new Date(T0).toISOString().slice(0, 10);
  write(path.join(sdir('reader'), 'state.json'), JSON.stringify({ state: 'ok', fails: 0, last_at: new Date(T0 - 10 * 60000).toISOString(), last: { ok: true, events: 2, ms: 120 }, invalid: { lines: [{ why: 'a line that is not an event' }] }, days: { [today]: { events: 7, qualified: 1, runs: 3, fails: 0, invalid: 1, ms_sum: 360, by_level: {} } } }));
  // the work: two goals (the second one the first plans after), a milestone, a feature with its
  // design and a story in a release; tickets: one merged, one with every stored field (held, waiting
  // on the merged one) that another waits on, and one replaced by it
  ids.goal = dt(['goal', 'add', '--title', 'Launch checkout', '--outcome', 'admins pay alone']);
  ids.goal2 = dt(['goal', 'add', '--title', 'Launch receipts', '--outcome', 'every payment has a receipt']);
  dt(['goal', 'set', ids.goal, '--measure', 'cards taken a day', '--target', '10', '--horizon', '2027-06-30', '--non-goals', '["refunds"]', '--preconditions', '["a card form","a processor account"]',
    '--milestones', JSON.stringify([{ title: 'First card taken', target: 1, preconditions: [1], tickets: 1 }, { title: 'Ten a day', target: 10, preconditions: [2], tickets: 2 }]), '--plan-after', ids.goal2, '--reason', 'the receipts design first']);
  ids.milestone = `${ids.goal}:1`;
  dt(['feature', 'add', 'pay', '--json', JSON.stringify({ title: 'Pay', goals: [ids.goal], design: 'project/designs/pay.md', notes: 'one page', preconditions: [`${ids.goal}#1`], stories: [{ id: 'PAY-S1', text: 'admin adds a card', release: 'v0.2.0' }] })]);
  ids.feature = 'pay';
  ids.story = 'PAY-S1';
  ids.release = 'v0.2.0';
  ids.ticketMerged = 'pay-00-schema';
  dt(['ticket', 'add', ids.ticketMerged, '--json', JSON.stringify({ title: 'card schema', feature: 'pay', component: 'pay', kind: 'build', size: 'S', risk: 'normal', serves: ['PAY-S1'], depends_on: [], touches: ['pay/schema/**'], done_when: ['the schema test passes'] })]);
  ids.ticket = 'pay-01-card';
  dt(['ticket', 'add', ids.ticket, '--json', JSON.stringify({ title: 'card capture', feature: 'pay', component: 'pay', kind: 'build', size: 'S', risk: 'high', serves: ['PAY-S1'], depends_on: [ids.ticketMerged], touches: ['pay/**'], done_when: ['the card check passes in CI'],
    contracts: { provides: ['card-api@1'], consumes: [] }, links: ['docs-site'], one_way_doors: ['where card numbers are kept'], notes: 'keep the form on one page' })]);
  dt(['ticket', 'set', ids.ticket, '--json', JSON.stringify({ held: 'until the processor is chosen' })]);
  dt(['ticket', 'add', 'pay-02-receipt', '--json', JSON.stringify({ title: 'card receipt', feature: 'pay', component: 'pay', kind: 'build', size: 'M', risk: 'normal', serves: ['PAY-S1'], depends_on: [ids.ticket], touches: ['pay/receipt/**'], done_when: ['a receipt is sent'] })]);
  ids.ticketReplaced = 'pay-09-old-form';
  dt(['ticket', 'add', ids.ticketReplaced, '--json', JSON.stringify({ title: 'the old card form', feature: 'pay', component: 'pay', kind: 'build', size: 'S', risk: 'normal', serves: ['PAY-S1'], depends_on: [], touches: ['pay/old/**'], done_when: ['the old form still renders'], superseded_by: ids.ticket })]);
  // the last wave: the held ticket, in the wave before, is not merged
  ids.wave = '3';
  // the merged ticket: its branch merged into main as a PR merge
  git('checkout', '-q', '-b', `ticket/${ids.ticketMerged}`);
  write(path.join(root, 'pay/schema/card.json'), '{}\n');
  git('add', '-A');
  git('commit', '-qm', 'the card schema');
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', `ticket/${ids.ticketMerged}`, '-m', `Merge pull request #1 from o/ticket/${ids.ticketMerged}`);
  // the held ticket's branch: its spec and a spec review (Documents, Reviews, Branch), and the
  // handoff commit its session made when it parked (the Handoff)
  git('checkout', '-q', '-b', `ticket/${ids.ticket}`);
  write(path.join(root, `docs/devteam/project/tickets/${ids.ticket}/spec.md`), '# pay-01-card: spec\n\nTake the card.\n');
  write(path.join(root, `docs/devteam/project/tickets/${ids.ticket}/reviews/spec-1.md`), `# spec review 1\n\n- Reviewer: claude\n\nVerdict: APPROVE ${'a'.repeat(40)}\n`);
  git('add', '-A');
  git('commit', '-qm', `${ids.ticket}: spec`);
  git('commit', '-q', '--allow-empty', '-m', `devteam handoff: ${ids.ticket}`, '-m', 'The card form is half done: the expiry field is next.');
  git('checkout', '-q', 'main');
  // its phases (Time per phase; the last, parked, is the handoff's), gate runs on four commits (a
  // pass, a fail, a flaky one that both passed and failed, and a slow lint at over twice its median),
  // and its spend (worker and reviewer)
  for (const [to, from, h] of [['starting', null, 12], ['spec', 'starting', 11], ['build', 'spec', 8], ['parked', 'build', 1.5]]) hand(ids.ticket, { type: 'phase', to, from }, h * H);
  const shas = ['1111111aaaa', '2222222bbbb', '3333333cccc', '4444444dddd'].map((s) => s.padEnd(40, '0'));
  const gates = [[0, 'test', true, 1000], [0, 'lint', true, 1000], [1, 'test', false, 1100], [1, 'lint', true, 1000], [2, 'test', false, 1000], [2, 'test', true, 1000], [2, 'lint', true, 1000], [3, 'lint', true, 9000], [3, 'test', true, 1000]];
  gates.forEach(([s, gate, ok, ms], i) => hand(ids.ticket, { type: 'gate', gate, ok, ms, sha: shas[s], tests_total: 3, tests: [] }, (7 - i * 0.5) * H));
  hand('supervisor', { type: 'spend', who: ids.ticket, role: 'worker', phase: 'build', through: new Date(T0 - 6 * H).toISOString(), usd: 1.25 }, 6 * H - 5);
  hand('supervisor', { type: 'spend', who: ids.ticket, role: 'worker', phase: 'build', through: new Date(T0 - 3 * H).toISOString(), usd: 0.75 }, 3 * H - 5);
  hand('supervisor', { type: 'spend', who: ids.ticket, role: 'reviewer', phase: 'spec', through: new Date(T0 - 9 * H).toISOString(), usd: 0.4 }, 9 * H - 5);
  // a planner at work on a second feature: its branch holds its plan file (the feature with its
  // design, and a draft of two tickets, one waiting on the other) and the design
  ids.planner = 'receipts';
  git('checkout', '-q', '-b', `plan/${ids.planner}`);
  write(path.join(root, 'docs/devteam/project/designs/receipts.md'), '# Receipts\n\n## TL;DR\n\nEvery payment mails a receipt.\n');
  const pl = (o, ago) => line({ op: 'new', ...o, at: new Date(T0 - ago).toISOString(), by: `plan-${ids.planner}` });
  write(path.join(root, `docs/devteam/project/log/plan-${ids.planner}.jsonl`), [
    pl({ id: ids.planner, type: 'feature', title: 'Receipts', goals: [ids.goal], design: 'project/designs/receipts.md', stories: [] }, 50 * 60000),
    pl({ id: 'rec-01-email', type: 'ticket', title: 'email the receipt', feature: ids.planner, component: 'pay', kind: 'build', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['pay/mail/**'], done_when: ['a mail is sent'] }, 40 * 60000),
    pl({ id: 'rec-02-pdf', type: 'ticket', title: 'a receipt as a PDF', feature: ids.planner, component: 'pay', kind: 'build', size: 'S', risk: 'normal', serves: [], depends_on: ['rec-01-email'], touches: ['pay/pdf/**'], done_when: ['a PDF is attached'] }, 30 * 60000),
  ].join(''));
  git('add', '-A');
  git('commit', '-qm', `plan-${ids.planner}: the draft`);
  git('checkout', '-q', 'main');
  // a message from the ticket's worker: its thread
  ids.thread = hand(ids.ticket, { type: 'message', to: 'supervisor', kind: 'info', text: 'the card form is in' }, 2 * H);
  // questions: open, answered (with context, choices with their effect for users, a recommendation,
  // its goal and the ticket it held up), defaulted (in the Inbox's Answered list), withdrawn, and one
  // too long for a line
  const RATE = ['--stake', '1', '--urgency', '1'];
  ids.qOpen = dt(['ask', '--question', 'Which processor?', '--choices', '[{"label":"Stripe"},{"label":"Adyen"}]', ...RATE]);
  ids.qAnswered = dt(['ask', '--question', 'Keep the receipts?', '--context', 'Receipts take space; the processor keeps a copy too.', '--choices', JSON.stringify([{ label: 'Yes', detail: 'keep them a year', effect: 'an admin can find last month\'s receipt' }, { label: 'No', effect: 'an admin asks the processor' }]),
    '--recommendation', 'Yes', '--goal', ids.goal, '--blocks', ids.ticket, ...RATE]);
  dt(['answer', ids.qAnswered, 'Yes'], null);
  ids.qDefaulted = dt(['ask', '--question', 'Which port?', '--default', '8080']);
  pastDeadline(root, ids.qDefaulted);
  dt(['answer', ids.qDefaulted, '--defaulted']);
  ids.qWithdrawn = dt(['ask', '--question', 'Split the form?', '--choices', '[{"label":"Yes"},{"label":"No"}]', ...RATE]);
  dt(['withdraw', ids.qWithdrawn, '--reason', 'asked twice']);
  ids.qLong = dt(['ask', '--question', PEEK_LONG, '--choices', '[{"label":"One page"},{"label":"Split"}]', ...RATE]);
  dt(['answer', ids.qLong, 'One page'], null);
  // the goal: judged, read, approved by the owner, then drained by the supervisor
  dt(['goal', 'impact', ids.goal, '3', '--rationale', 'checkout moves the number the strategy watches']);
  dt(['goal', 'reading', ids.goal, '--value', '4']);
  dt(['goal', 'decide', ids.goal, 'approve', '--force', '--notes', 'go'], null);
  // a change to the goal you approved, applied as asked (its Approved)
  ids.qGoalChange = dt(['ask', '--class', 'goal-change', '--goal', ids.goal, '--question', 'Leave chargebacks out of the checkout goal?', '--change', JSON.stringify({ non_goals: ['refunds', 'chargebacks'] }),
    '--choices', '[{"label":"Yes"},{"label":"No"}]', '--recommendation', 'Yes', ...RATE]);
  dt(['answer', ids.qGoalChange, 'Yes'], null);
  dt(['goal', 'set', ids.goal, '--approved', ids.qGoalChange]);
  dt(['goal', 'hold', ids.goal, 'drain', '--reason', 'waiting on the processor']);
  // knowledge, observations, a recurring signal, a problem and an incident
  ids.observation = dt(['observe', '--subject', 'app', '--kind', 'slow-test', '--detail', 'the checkout test is slow']);
  ids.lesson = dt(['knowledge', 'add', '--kind', 'lesson', '--scope', 'project', '--statement', 'payments time out under load', '--evidence', ids.observation]).match(/k-\S+/)[0];
  // a lesson sent to the owner: its plain words, and the Inbox is where it is kept or retired
  ids.lessonOwner = dt(['knowledge', 'add', '--kind', 'lesson', '--scope', 'project', '--statement', 'ask before changing the processor', '--for-owner', '--plain', 'Ask the owner before the checkout changes processor.', '--evidence', ids.observation]).match(/k-\S+/)[0];
  ids.signal = 'metrics:flaky-gate:web/e2e';
  for (const h of [30, 28, 2]) hand('supervisor', { type: 'observation', source: 'metrics', detector: 'metrics', subject: 'web/e2e', kind: 'flaky-gate', detail: 'web/e2e failed, then passed', source_key: ids.signal }, h * H);
  ids.problem = hand('supervisor', { type: 'problem', title: 'the card form drops input', severity: 2, realized: true, status: 'open', threatens: [ids.goal], refs: [ids.observation] }, 5 * H);
  hand('supervisor', { type: 'problem', op: 'set', id: ids.problem, status: 'owned' }, 5 * H - 1000);
  // the incident on the reader's fingerprint, which the reader observed (its related signal), and
  // the reader's other fingerprint ignored
  hand('supervisor', { type: 'observation', source: 'reader', subject: 'sensor:reader', detector: 'sensor', kind: 'exception', severity: 2, detail: 'TypeError: card is undefined', source_key: 'sensor:reader:exception:E1' }, 4.5 * H);
  ids.incident = hand('supervisor', { type: 'problem', title: 'payment errors', severity: 3, realized: true, status: 'open', threatens: [], refs: [], fingerprints: ['reader:exception:E1'], sensor: 'reader' }, 4 * H);
  dt(['sensor', 'ignore', 'reader:exception:E2', '--reason', 'a crawler, not a person']);
  // calls: a decision on the defaulted answer, drawing on the lesson, and an act under it given the
  // lesson; an act of its own, one corrected; an act your answer approved (What used it); a start
  // given the lesson in last week (the learning record's efficacy)
  ids.decision = hand('supervisor', { type: 'decision', class: 'priority-change', what: 'put checkout first', rationale: 'the default said so', authority: 'default', approved_by: ids.qDefaulted, knowledge: [ids.lesson], refs: [ids.goal], reversible: true }, 3 * H);
  ids.actUnderDecision = hand('supervisor', { type: 'act', class: 'priority-change', decision: ids.decision, what: 'moved checkout to the top', knowledge: [ids.lesson], refs: [ids.goal], reversible: true }, 3 * H - 1000);
  ids.act = hand('supervisor', { type: 'act', class: 'priority-change', what: 'moved receipts down', refs: [ids.goal], reversible: true }, 3 * H - 2000);
  ids.actCorrected = hand('supervisor', { type: 'act', class: 'priority-change', what: 'moved the docs up', refs: [ids.goal], reversible: true }, 3 * H - 3000);
  dt(['correct', ids.actCorrected, '--reason', 'the docs can wait'], null);
  ids.actAnswered = hand('supervisor', { type: 'act', class: 'priority-change', what: 'kept the receipts', approved_by: ids.qAnswered, refs: [ids.goal], reversible: true }, 3 * H - 4000);
  // a decision on a standing rule (the lesson)
  ids.decisionRule = hand('supervisor', { type: 'decision', class: 'priority-change', what: 'kept payments light', authority: 'standing-rule', approved_by: ids.lesson, refs: [], reversible: true }, 3 * H - 5000);
  ids.decisionNotMine = hand('supervisor', { type: 'decision', class: 'priority-change', what: 'an old call', authority: 'rung', refs: [], reversible: true }, 40 * DAY);
  // 81 later calls: with the newer rows above them, decisionNotMine is past the 80 the Decide tab draws
  for (let i = 0; i < 81; i++) hand('supervisor', { type: 'decision', class: 'priority-change', what: `a later call ${i + 1}`, authority: 'rung', refs: [], reversible: true }, 20 * DAY - i * 60000);
  hand('supervisor', { type: 'act', class: 'worker-slots', what: `started ${ids.ticket}`, knowledge: [ids.lesson], refs: [ids.ticket], reversible: true }, 9 * DAY);
  // last week's learning record and three closed retros, ids.retro the middle one (its previous and
  // next), each with its write-up's numbers
  // last week's ISO week (its Thursday's year and week)
  const th = new Date(T0 - 7 * DAY);
  th.setUTCDate(th.getUTCDate() + 3 - ((th.getUTCDay() + 6) % 7));
  const jan4 = new Date(Date.UTC(th.getUTCFullYear(), 0, 4));
  const week = `${th.getUTCFullYear()}-W${String(1 + Math.round(((th - jan4) / DAY - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7)).padStart(2, '0')}`;
  ids.learning = hand('supervisor', { type: 'observation', source: 'metrics', detector: 'metrics', subject: 'project', kind: 'learning', week, source_key: `learning:${week}`, detail: 'the week in figures',
    figures: { informed: { knowledge: 1, signals_explained: 0, signals_formed: 1, starts_given: 0, starts: 0 }, autonomous: { trusted_calls: 1, ladder_calls: 2, questions: 3, merged: 0 }, trusted: { agreed: 1, answered: 2, corrections: 1, calls: 3 } } }, 6 * DAY);
  hand('supervisor', { type: 'observation', source: 'supervisor', subject: 'project', kind: 'retro', detail: 'a week of schema work', source_ref: 'project/retros/2026-11-02.md', refs: [] }, 8 * DAY);
  ids.retro = hand('supervisor', { type: 'observation', source: 'supervisor', subject: 'project', kind: 'retro', detail: 'a week of checkout', source_ref: 'project/retros/2026-11-09.md', refs: [ids.lesson] }, 1 * H);
  hand('supervisor', { type: 'observation', source: 'supervisor', subject: 'project', kind: 'retro', detail: 'a week of receipts', source_ref: 'project/retros/2026-11-16.md', refs: [] }, 0.5 * H);
  return { root, ids };
}

// kit-100: a project whose Inbox has one of everything the panel's Inbox tab draws (spec §3), for
// test/dashboard-inbox-panel.test.mjs (and the measure, which can seed a project with it). root is a
// project bareProject made, env the environment its commands run in (its own HOME and ports). Built
// with the kit's commands as the supervisor and the owner would: six open questions (q1 and q2 choices,
// q1 with its standing-rule box; q3 an owner-action; q4 to q6 one secret each), a review question r with
// its page and data committed, two lessons sent to the owner, one answered, one defaulted and one
// withdrawn question, two goals and the threads Q (on q1), P (a spot on the old Inbox page, as an old
// dashboard wrote it), S (no subject) and G (on goal's card; goal2 has none).
export function inboxFixture(root, env) {
  const dt = (args, role = 'supervisor') => {
    const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: root, env: role ? { ...env, DEVTEAM_ROLE: role } : env, encoding: 'utf8' });
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim().split('\n')[0].trim();
  };
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: root, encoding: 'utf8' }).trim();
  write(path.join(root, 'review/page.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Group the items</title></head>\n<body>\n<p>Look.</p>\n</body></html>\n');
  write(path.join(root, 'review/data.json'), `${JSON.stringify({ rows: [{ id: 'g1' }, { id: 'g2' }] })}\n`);
  // the secrets' file sinks write only gitignored files, so a Post on q4 lands (AC5)
  const ignore = path.join(root, '.gitignore');
  write(ignore, `${fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8') : ''}.devteam-secrets/\n`);
  git('add', '-A');
  git('commit', '-qm', 'the review page');
  const RATE = ['--stake', '1', '--urgency', '1'];
  const goal = dt(['goal', 'add', '--title', 'Launch checkout', '--outcome', 'admins pay alone']);
  const goal2 = dt(['goal', 'add', '--title', 'Launch receipts', '--outcome', 'every payment has a receipt']);
  const q1 = dt(['ask', '--question', 'Which processor?', '--choices', '[{"label":"Stripe"},{"label":"Adyen"}]', '--goal', goal, ...RATE]);
  const q2 = dt(['ask', '--question', 'Keep the card form on one page?', '--choices', '[{"label":"One page"},{"label":"Split it"}]', ...RATE]);
  const q3 = dt(['ask', '--kind', 'owner-action', '--question', 'Please renew the certificate', '--context', 'It expires next week.', ...RATE]);
  const secret = (n, words) => dt(['ask', '--kind', 'owner-action', '--question', words, '--secrets', JSON.stringify([{ name: `KEY_${n}`, sink: `file:.devteam-secrets/key-${n}` }]), ...RATE]);
  const q4 = secret(4, 'Post the processor key');
  const q5 = secret(5, 'Post the mail key');
  const q6 = secret(6, 'Post the receipts key');
  const r = dt(['ask', '--kind', 'review', '--question', 'Which items belong to each group?', '--ref', 'main', '--page', 'review/page.html', '--data', 'review/data.json', ...RATE]);
  const o = dt(['observe', '--subject', 'app', '--kind', 'slow-test', '--detail', 'the checkout test is slow']);
  const lesson = (statement, plain) => dt(['knowledge', 'add', '--kind', 'lesson', '--scope', 'project', '--statement', statement, '--for-owner', '--plain', plain, '--evidence', o]).match(/k-\S+/)[0];
  const L1 = lesson('ask before changing the processor', 'Ask the owner before the checkout changes processor.');
  const L2 = lesson('ask before changing the receipts', 'Ask the owner before the receipts change.');
  const answered = dt(['ask', '--question', 'Keep the receipts?', '--choices', '[{"label":"Yes"},{"label":"No"}]', ...RATE]);
  dt(['answer', answered, 'Yes'], null);
  const defaulted = dt(['ask', '--question', 'Which port?', '--default', '8080']);
  pastDeadline(root, defaulted);
  dt(['answer', defaulted, '--defaulted']);
  const withdrawn = dt(['ask', '--question', 'Split the form?', '--choices', '[{"label":"Yes"},{"label":"No"}]', ...RATE]);
  dt(['withdraw', withdrawn, '--reason', 'asked twice']);
  // the threads, started through the owner channel (no role)
  const thread = (text, subject) => dt(['thread', 'new', text, ...(subject ? ['--subject', JSON.stringify(subject)] : [])], null);
  const Q = thread('About the processor', { kind: 'item', ref: `question:${q1}` });
  const P = thread('On the Inbox', { kind: 'page', view: '#inbox', at: { x: 0.5, y: 0.2 } });
  const S = thread('A thought about checkout');
  const G = thread('About this goal', { kind: 'item', ref: `goal:${goal}` });
  return { Q, P, S, G, q: { q1, q2, q3, q4, q5, q6 }, r, L1, L2, answered, defaulted, withdrawn, goal, goal2 };
}
