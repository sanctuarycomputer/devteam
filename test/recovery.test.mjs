// Coming back after a dead machine, and a supervisor at a usage limit: relaunching a session whose
// window is gone, --if-gone, restarting the supervisor on its exact conversation, and the command
// the owner gets when it can't be. Stand-in agents throughout, never the real claude or cswap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bareProject, hasTmux, json, until, write } from './lib/kit.mjs';

const MENU = ["You've hit your weekly limit · resets Nov 12 at 12am (America/New_York)", 'What do you want to do?', '❯ 1. Stop and wait for limit to reset', '  2. Wait here, then continue automatically at Nov 12 at 12am', '  3. Switch to usage credits', 'Enter to confirm · Esc to cancel'];
const ROOM = { schemaVersion: 1, accounts: [{ number: 1, email: 'a@x', active: true, usageStatus: 'ok', usage: { fiveHour: { pct: 20 }, sevenDay: { pct: 30 } } }] };
const FULL = { schemaVersion: 1, accounts: [{ number: 1, email: 'a@x', active: true, usageStatus: 'ok', usage: { fiveHour: { pct: 100 }, sevenDay: { pct: 30 } } }] };
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-recovery-home-'));
// A shell that sees only the stand-in claude on its PATH (a login shell would put back ~/.local/bin,
// and with it the machine's real claude). Set as this file's own tmux server's default-shell, so
// every window, and every pane a restart replaces, runs it. The server's kept up by a window of its own.
const SHELL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-recovery-bin-'));
process.on('exit', () => { fs.rmSync(HOME, { recursive: true, force: true }); fs.rmSync(SHELL_DIR, { recursive: true, force: true }); });
const CLAUDE = path.join(SHELL_DIR, 'claude');
const STUB_SHELL = path.join(SHELL_DIR, 'stubshell');
write(CLAUDE, '#!/bin/sh\nprintf \'%s|%s\\n\' "$DEVTEAM_ROLE" "$*" >> .claude-calls\nexec sleep 3600\n');
write(STUB_SHELL, `#!/bin/sh\nPATH=${SHELL_DIR}:/usr/bin:/bin\nexport PATH\nENV=/dev/null\nexport ENV\ncase "$1" in -c) exec /bin/sh "$@" ;; *) exec /bin/sh -i ;; esac\n`);
fs.chmodSync(CLAUDE, 0o755);
fs.chmodSync(STUB_SHELL, 0o755);
if (hasTmux) {
  execFileSync('tmux', ['new-session', '-d', '-s', 'keep', 'sleep 86400']);
  execFileSync('tmux', ['set-option', '-g', 'default-shell', STUB_SHELL]);
}

function fixture(name, { resume = null } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-recovery-'));
  const root = bareProject(base, name);
  const launched = path.join(base, 'launched.log');
  const relaunch = path.join(base, 'relaunch.cjs');
  write(relaunch, `const fs = require('fs'); fs.appendFileSync(${JSON.stringify(launched)}, require('path').basename(process.cwd()) + '\\n'); setInterval(() => {}, 1000);`);
  const sf = path.join(root, 'docs/devteam/project/settings.md');
  const command = resume ?? `${process.execPath} ${relaunch}`;
  fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"project":', `"resume_command": ${JSON.stringify(command)},\n  "project":`));
  execFileSync('sh', ['-c', 'git add -A && git -c user.email=t@t -c user.name=t commit -qm init'], { cwd: root });
  const stub = path.join(base, 'cswap');
  const list = path.join(base, 'list.json');
  write(list, JSON.stringify(ROOM));
  write(stub, `#!/bin/sh\ncase "$1" in list) cat ${JSON.stringify(list)} ;; esac\n`);
  fs.chmodSync(stub, 0o755);
  const dt = path.join(root, 'docs/devteam/scripts/devteam.mjs');
  const env = (extra = {}) => { const e = { ...process.env, HOME, XDG_DATA_HOME: '', CLAUDE_CONFIG_DIR: path.join(base, 'claude'), DEVTEAM_ROLE: 'supervisor', ...extra }; delete e.DEVTEAM_TICKET; delete e.DEVTEAM_FEATURE; return e; };
  const run = (args, extra) => spawnSync(process.execPath, [dt, ...args], { cwd: root, encoding: 'utf8', env: env(extra) });
  const runAsync = (args) => new Promise((resolve) => { const c = execFile(process.execPath, [dt, ...args], { cwd: root, env: env(), encoding: 'utf8' }, (err, stdout, stderr) => resolve({ status: err?.code ?? 0, stdout, stderr })); c.on('error', () => {}); });
  const tick = (extra) => { const r = run(['accounts-tick'], extra); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  const state = () => json(fs.readFileSync(path.join(root, 'docs/devteam/run/accounts.json'), 'utf8'));
  const session = run(['settings', '--get', 'tmux_session']).stdout.trim();
  // Real tmux on this file's server: a stand-in agent in a window started in its worktree.
  const ensureSession = () => { if (spawnSync('tmux', ['has-session', '-t', `=${session}`]).status !== 0) execFileSync('tmux', ['new-session', '-d', '-s', session, '-n', 'dashboard', '-x', '120', '-y', '30', 'sleep 3600']); };
  // exec: Linux's dash can stay as the parent otherwise, and the pane would read as a shell
  const agent = (window, shown, cwd = null, { prefix = '', args = '', shell = false } = {}) => {
    const wt = cwd ?? path.join(root, '.worktrees', window);
    fs.mkdirSync(wt, { recursive: true });
    const keys = path.join(base, `${window}.keys`);
    const prog = path.join(base, `${window}.cjs`);
    write(keys, '');
    write(prog, `const fs=require('fs');console.log(${JSON.stringify(shown)}.join('\\n'));process.stdin.setRawMode(true);process.stdin.on('data',(d)=>fs.appendFileSync(${JSON.stringify(keys)},d));setInterval(()=>{},1000);`);
    ensureSession();
    const run = `${prefix}${process.execPath} ${prog}${args}`;
    // shell: typed at an interactive shell, the only way a child is its pane's foreground job (a non-interactive `sh -c` leaves the pane reading as sh)
    if (shell) { execFileSync('tmux', ['new-window', '-d', '-t', `=${session}:`, '-n', window, '-c', wt]); execFileSync('tmux', ['send-keys', '-t', `=${session}:${window}`, '-l', run]); execFileSync('tmux', ['send-keys', '-t', `=${session}:${window}`, 'Enter']); }
    else execFileSync('tmux', ['new-window', '-d', '-t', `=${session}:`, '-n', window, '-c', wt, `exec ${run}`]);
    return { keys: () => fs.readFileSync(keys, 'utf8'), shows: () => spawnSync('tmux', ['capture-pane', '-p', '-t', `=${session}:${window}`], { encoding: 'utf8' }).stdout };
  };
  let lines = 0;
  const logLine = (by, body, at = new Date().toISOString()) => { fs.mkdirSync(path.join(root, 'docs/devteam/run/log'), { recursive: true }); fs.appendFileSync(path.join(root, `docs/devteam/run/log/${by === 'supervisor' ? 'supervisor-2026-11' : by}.jsonl`), `${JSON.stringify({ v: 1, id: `${body.type === 'act' ? 'a' : 'h'}-20261101-${String(++lines).padStart(9, '0')}-${by}`, op: 'new', at, by, ...body })}\n`); };
  // a minute ago unless a test says otherwise: a launch and the session after it are never in one second
  const launchAct = (role, sess, at = new Date(Date.now() - 60000).toISOString()) => logLine('supervisor', { type: 'act', class: 'worker-slots', what: `made ${role} ${sess} in ${session}:${sess}`, refs: [], reversible: true }, at);
  // the records a worker or planner leaves on disk, as the kit would write them; its worktree stays
  const worker = (id, { at, started = true, launched = true, extra = {} } = {}) => { logLine('supervisor', { type: 'ticket', id, title: id, feature: 'demo', ...extra }); if (started) logLine(id, { type: 'phase', from: null, to: 'starting' }); if (launched) launchAct('worker', id, at); fs.mkdirSync(path.join(root, '.worktrees', id), { recursive: true }); };
  const planner = (feature, { at, launched = true } = {}) => { execFileSync('git', ['branch', `plan/${feature}`], { cwd: root }); if (launched) launchAct('planner', `plan-${feature}`, at); fs.mkdirSync(path.join(root, '.worktrees', `plan-${feature}`), { recursive: true }); };
  const relaunched = () => (fs.existsSync(launched) ? fs.readFileSync(launched, 'utf8').trim().split('\n').filter(Boolean) : []);
  const claudeCalls = () => { const f = path.join(root, '.claude-calls'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean) : []; };
  const windows = () => (spawnSync('tmux', ['list-windows', '-t', `=${session}`, '-F', '#W'], { encoding: 'utf8' }).stdout ?? '').split('\n').filter(Boolean);
  const killSession = () => spawnSync('tmux', ['kill-session', '-t', `=${session}`]);
  const done = () => { killSession(); try { fs.rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {} };
  const restartsFile = path.join(root, 'docs/devteam/run/accounts-resumed.json');
  const writeTranscript = (id, entries) => write(path.join(base, 'claude', 'projects', fs.realpathSync(root).replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`), entries.map((o) => `${JSON.stringify(o)}\n`).join(''));
  return { base, root, env, run, runAsync, tick, state, session, agent, ensureSession, worker, planner, launchAct, logLine, relaunched, claudeCalls, windows, killSession, done, restartsFile, writeTranscript, list, cswap: stub };
}
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const findings = (F) => json(F.run(['metrics', '--json']).stdout).findings;
const OFF = { DEVTEAM_CSWAP: 'off' };

test('a machine that died: the tmux session gone, a worker and a planner come back, one a tick, with or without cswap', { skip: !hasTmux }, async () => {
  const F = fixture('gone');
  try {
    F.worker('demo-01-a');
    F.planner('plan1');
    const out1 = F.tick(OFF);
    assert.match(out1, /relaunched (demo-01-a|plan-plan1): its window was gone/);
    assert.equal(F.state().relaunched.length, 1, 'one relaunch per tick');
    await until(() => F.relaunched().length === 1, 'the first agent resumed');
    assert.match(F.tick(OFF), /relaunched/, 'the next tick brings back the other');
    await until(() => F.relaunched().length === 2, 'both resumed');
    assert.deepEqual(F.relaunched().sort(), ['demo-01-a', 'plan-plan1']);
    assert.ok(F.windows().includes('demo-01-a') && F.windows().includes('plan-plan1'));
    const acts = json(F.run(['log', '--type', 'act', '--json']).stdout).map((a) => a.what);
    assert.ok(acts.some((w) => /^resumed worker demo-01-a in /.test(w)), 'relaunched as worker --resume');
    assert.equal(F.tick(OFF), '', 'its windows are there: nothing more to do');
    assert.equal(F.relaunched().length, 2);
  } finally { F.done(); }
});

test('no tmux server at all (a reboot): the session is missing, so it is relaunched', { skip: !hasTmux }, async () => {
  const F = fixture('reboot');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-tmux-recovery-'));
  const env = { ...OFF, TMUX_TMPDIR: dir };
  try {
    F.worker('demo-02-b');
    assert.match(F.tick(env), /relaunched demo-02-b/);
    await until(() => F.relaunched().length === 1, 'resumed');
  } finally {
    spawnSync('tmux', ['kill-server'], { env: { ...process.env, TMUX_TMPDIR: dir } });
    fs.rmSync(dir, { recursive: true, force: true });
    F.done();
  }
});

test('the key guard: a window closed in a session older than its launch stays closed; a session newer than the launch brings it back', { skip: !hasTmux }, async () => {
  const F = fixture('guard');
  try {
    F.ensureSession();
    sleepMs(1100);
    const now = new Date().toISOString();
    F.worker('demo-03-c', { at: now });
    F.planner('p2', { at: now });
    assert.equal(F.tick(OFF), '', 'someone closed these on purpose');
    assert.deepEqual(F.relaunched(), []);
    assert.ok(findings(F).some((f) => f.kind === 'planner-gone' && f.subject === 'plan-p2'), 'the existing finding reports it');
    F.killSession();
    sleepMs(1100);
    F.ensureSession();
    // a session created after the launch: what a reboot, a kept tmux restarted by hand, leaves
    assert.match(F.tick(OFF), /relaunched/);
    await until(() => F.relaunched().length === 1, 'brought back');
  } finally { F.done(); }
});

test('held, parked, done, merged and superseded sessions, and a removed worktree, are left alone', { skip: !hasTmux }, async () => {
  const F = fixture('held');
  try {
    F.worker('demo-10-parked');
    F.logLine('demo-10-parked', { type: 'phase', from: 'starting', to: 'parked' });
    F.worker('demo-11-done');
    F.logLine('demo-11-done', { type: 'phase', from: 'starting', to: 'done' });
    F.worker('demo-12-merged');
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'demo-12-merged: landed'], { cwd: F.root });
    F.worker('demo-13-super', { extra: { superseded_by: 'demo-10-parked' } });
    F.worker('demo-14-nowt');
    fs.rmSync(path.join(F.root, '.worktrees', 'demo-14-nowt'), { recursive: true });
    F.worker('demo-15-unstarted', { started: false });
    F.worker('demo-16-unlaunched', { launched: false });
    F.tick(OFF);
    assert.equal(F.state().relaunched.length, 0);
    assert.deepEqual(F.relaunched(), []);
    // held by a drain in force: the same for every session, and it wears off with the hold
    F.worker('demo-17-live');
    F.logLine('supervisor', { type: 'act', class: 'drain', what: 'drained the fleet on host: moving', refs: [], reversible: true });
    F.tick(OFF);
    assert.deepEqual(F.relaunched(), [], 'held while the fleet is drained');
    F.logLine('supervisor', { type: 'act', class: 'undrain', what: 'undrained the fleet', refs: [], reversible: true });
    assert.match(F.tick(OFF), /relaunched demo-17-live/);
    await until(() => F.relaunched().length === 1, 'the live one comes back once the hold is lifted');
    assert.deepEqual(F.relaunched(), ['demo-17-live']);
  } finally { F.done(); }
});

test('--if-gone: refuses a live window, with nothing typed; two at once, one window', { skip: !hasTmux }, async () => {
  const F = fixture('ifgone');
  try {
    F.worker('demo-20-x', { launched: false });
    const live = F.agent('demo-20-x', ['> ']);
    await until(() => live.shows().includes('>'), 'the live agent drawn');
    const r = F.run(['worker', 'demo-20-x', '--resume', '--if-gone']);
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /--if-gone: window .* exists; left as it is/);
    assert.equal(live.keys(), '', 'nothing typed into the live agent');
    assert.match(live.shows(), /^> *$/m);
    assert.match(F.run(['worker', 'demo-20-x', '--if-gone']).stderr, /goes with --resume/);
    // no worktree: nothing to resume, whatever the window says
    F.worker('demo-21-nowt', { launched: false });
    fs.rmSync(path.join(F.root, '.worktrees', 'demo-21-nowt'), { recursive: true });
    assert.equal(F.run(['worker', 'demo-21-nowt', '--resume', '--if-gone']).status, 3);
    // two launches of one gone session at once: one wins, the other finds its window
    F.worker('demo-22-race', { launched: false });
    const both = await Promise.all([F.runAsync(['worker', 'demo-22-race', '--resume', '--if-gone']), F.runAsync(['worker', 'demo-22-race', '--resume', '--if-gone'])]);
    assert.deepEqual(both.map((x) => x.status).sort(), [0, 3], JSON.stringify(both));
    await until(() => F.relaunched().length === 1, 'the one that won started its agent');
    sleepMs(500);
    assert.deepEqual(F.relaunched(), ['demo-22-race'], 'one agent, not two');
    assert.equal(F.windows().filter((w) => w === 'demo-22-race').length, 1, 'one window, not two');
  } finally { F.done(); }
});

test('the race: a supervisor\'s --resume right after the tick\'s relaunch leaves it alone; the tick right after the supervisor\'s finds the window', { skip: !hasTmux }, async () => {
  const F = fixture('race');
  try {
    F.worker('demo-30-y');
    assert.match(F.tick(OFF), /relaunched demo-30-y/);
    await until(() => F.relaunched().length === 1, 'relaunched by the tick');
    const second = F.run(['worker', 'demo-30-y', '--resume']);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stderr, /relaunched by the dashboard moments ago; left as it is/);
    sleepMs(500);
    assert.deepEqual(F.relaunched(), ['demo-30-y'], 'no second launch typed in');
    // the record ages out, so a person's --resume isn't refused forever
    write(F.restartsFile, JSON.stringify({ 'demo-30-y': [Date.now() - 3 * 60000] }));
    // past that, a window with a live agent still refuses: a resume would be typed into that agent
    const live = F.run(['worker', 'demo-30-y', '--resume']);
    assert.equal(live.status, 1, live.stderr);
    assert.match(live.stderr, /has a live agent/);
    assert.doesNotMatch(live.stderr, /moments ago/);
    sleepMs(300);
    assert.deepEqual(F.relaunched(), ['demo-30-y'], 'nothing typed into it');
    // and once that agent has gone, it resumes
    execFileSync('tmux', ['respawn-pane', '-k', '-t', `=${F.session}:demo-30-y`, STUB_SHELL]);
    sleepMs(200);
    const later = F.run(['worker', 'demo-30-y', '--resume']);
    assert.equal(later.status, 0, later.stderr);
    assert.doesNotMatch(later.stderr, /moments ago/);
    await until(() => F.relaunched().length === 2, 'resumed, the agent gone');
    // the supervisor first: the tick (a moment later, as in the race) finds its window and stops
    F.worker('demo-31-z', { launched: false });
    assert.equal(F.run(['worker', 'demo-31-z', '--resume']).status, 0);
    assert.equal(F.run(['worker', 'demo-31-z', '--resume', '--if-gone']).status, 3);
  } finally { F.done(); }
});

test('the caps: one per 10 minutes, 3 in 6 hours per session, then restart-gave-up; attempts age out', { skip: !hasTmux }, async () => {
  const F = fixture('caps');
  try {
    F.worker('demo-40-cap');
    assert.match(F.tick(OFF), /relaunched demo-40-cap/);
    await until(() => F.relaunched().length === 1, 'first relaunch');
    F.killSession();
    assert.equal(F.tick(OFF), '', 'not again within 10 minutes');
    const stamp = (n) => write(F.restartsFile, JSON.stringify({ 'demo-40-cap': Array.from({ length: n }, (_, i) => Date.now() - (60 + i) * 60000) }));
    stamp(2);
    F.killSession();
    assert.match(F.tick(OFF), /relaunched demo-40-cap/, 'the third in 6 hours');
    await until(() => F.relaunched().length === 2, 'second relaunch');
    stamp(3);
    F.killSession();
    assert.equal(F.tick(OFF), '');
    assert.deepEqual(F.state().restart_gave_up, ['demo-40-cap']);
    assert.ok(findings(F).some((f) => f.kind === 'restart-gave-up' && f.subject === 'demo-40-cap' && f.severity === 'high'));
    assert.equal(F.relaunched().length, 2);
    // an attempt older than 6 hours no longer counts, so it recovers without a person
    write(F.restartsFile, JSON.stringify({ 'demo-40-cap': Array.from({ length: 3 }, (_, i) => Date.now() - (7 * 3600000 + i)) }));
    F.killSession();
    assert.match(F.tick(OFF), /relaunched demo-40-cap/);
    await until(() => F.relaunched().length === 3, 'third relaunch');
  } finally { F.done(); }
});

test('what a crash leaves behind: a stale lock and a mangled record neither stop nor wedge a relaunch', { skip: !hasTmux }, async () => {
  const F = fixture('crash');
  try {
    F.worker('demo-50-k');
    write(F.restartsFile, 'not json');
    for (const lock of [`${F.restartsFile}.lock`, path.join(F.root, 'docs/devteam/run/launch-demo-50-k.lock')]) { fs.mkdirSync(lock, { recursive: true }); fs.utimesSync(lock, new Date(Date.now() - 3600000), new Date(Date.now() - 3600000)); }
    assert.match(F.tick(OFF), /relaunched demo-50-k/);
    await until(() => F.relaunched().length === 1, 'relaunched despite what the crash left');
    assert.ok(!fs.existsSync(`${F.restartsFile}.lock`) && !fs.existsSync(path.join(F.root, 'docs/devteam/run/launch-demo-50-k.lock')));
    // a launch record dated in the future (the clock moved back) is ignored, and a tmux that won't answer starts nothing
    F.worker('demo-51-m');
    write(F.restartsFile, JSON.stringify({ 'demo-51-m': [Date.now() + 3600000, Date.now() + 7200000, Date.now() + 9000000] }));
    F.killSession();
    F.tick(OFF);
    assert.match(F.tick(OFF), /relaunched demo-51-m/);
    await until(() => F.relaunched().includes('demo-51-m'), 'relaunched past a future-dated record');
    const noTmux = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-recovery-notmux-'));
    write(path.join(noTmux, 'tmux'), '#!/bin/sh\necho "server busy" >&2\nexit 1\n');
    fs.chmodSync(path.join(noTmux, 'tmux'), 0o755);
    F.worker('demo-52-n');
    assert.equal(F.tick({ ...OFF, PATH: `${noTmux}${path.delimiter}${process.env.PATH}` }), '', 'tmux unknown: nothing is relaunched on a guess');
    assert.ok(!F.relaunched().includes('demo-52-n'));
    fs.rmSync(noTmux, { recursive: true, force: true });
  } finally { F.done(); }
});

test('not onto a full account: a known-full active account waits for room', { skip: !hasTmux }, async () => {
  const F = fixture('fullgone');
  try {
    F.worker('demo-60-f');
    write(F.list, JSON.stringify(FULL));
    F.tick({ DEVTEAM_CSWAP: F.cswap });
    assert.deepEqual(F.relaunched(), []);
    write(F.list, JSON.stringify(ROOM));
    assert.match(F.tick({ DEVTEAM_CSWAP: F.cswap }), /relaunched demo-60-f/);
  } finally { F.done(); }
});

// A supervisor stopped at a limit, in tmux, on its conversation
const SID = '11111111-2222-3333-4444-555555555555';
const SUP = 'You are the supervisor for this repository';
const rateLimit = () => ({ type: 'assistant', timestamp: new Date(Date.now() - 3600000).toISOString(), error: 'rate_limit', isApiErrorMessage: true, message: { content: [{ type: 'text', text: "You've hit your weekly limit" }] } });
const AS_SUPERVISOR = 'env DEVTEAM_ROLE=supervisor ';
const SKIP = ' --dangerously-skip-permissions';
const supervisorPane = (F, shown = MENU, { cwd = F.root, prefix = AS_SUPERVISOR, args = '', shell = false } = {}) => {
  const pane = F.agent('sup-pane', shown, cwd, { prefix, args, shell });
  write(path.join(F.root, 'docs/devteam/run/supervisor-pane'), `=${F.session}:sup-pane`);
  return pane;
};
const withCswap = (F) => ({ DEVTEAM_CSWAP: F.cswap });
const CLAUDE_RESUME = 'claude --continue --dangerously-skip-permissions';

test('a supervisor stopped at a limit is restarted on its exact conversation, no key to the old process, once the account has room and has settled', { skip: !hasTmux }, async () => {
  const F = fixture('suprestart', { resume: CLAUDE_RESUME });
  try {
    F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(F, MENU, { args: SKIP });
    await until(() => pane.shows().includes('Esc to cancel'), 'the menu');
    assert.equal(F.tick(withCswap(F)), '', 'the first tick: this project has not seen the account settle');
    assert.ok(F.state().supervisor_limit, 'not restarted yet: still reported');
    assert.deepEqual(F.claudeCalls(), []);
    const said = F.tick(withCswap(F));
    assert.match(said, /restarted the supervisor/);
    assert.equal(F.state().supervisor_limit, null, 'restarted this tick: not reported as stopped');
    await until(() => F.claudeCalls().length === 1, 'the stand-in claude ran');
    assert.equal(F.claudeCalls()[0], `supervisor|--resume ${SID} --dangerously-skip-permissions You were restarted after a usage limit, on this same conversation. Carry on from where you were.`);
    assert.equal(pane.keys(), '', 'no key reaches the old process');
    assert.match(fs.readFileSync(F.restartsFile, 'utf8'), /"supervisor"/, 'the same record as the workers');
    const logged = json(F.run(['log', '--type', 'observation', '--json']).stdout);
    assert.ok(logged.some((o) => o.kind === 'limit-restarted' && o.subject === 'supervisor'));
  } finally { F.done(); }
});

test('the supervisor is not restarted when its pane is split, in the wrong directory, or there is no conversation to resume; a non-Claude resume_command is left alone', { skip: !hasTmux }, async () => {
  const ready = async (F, pane) => { await until(() => pane.shows().includes('Esc to cancel'), 'the menu'); F.tick(withCswap(F)); };
  // a split window
  const split = fixture('supsplit', { resume: CLAUDE_RESUME });
  try {
    split.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(split);
    await ready(split, pane);
    spawnSync('tmux', ['split-window', '-d', '-t', `=${split.session}:sup-pane`, 'sleep 600']);
    assert.equal(split.tick(withCswap(split)), '');
    assert.equal(pane.keys(), '');
    assert.deepEqual(split.claudeCalls(), []);
    assert.ok(split.state().supervisor_limit, 'reported instead');
  } finally { split.done(); }
  // a wrong directory
  const wrong = fixture('supwrong', { resume: CLAUDE_RESUME });
  try {
    wrong.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(wrong, MENU, { cwd: wrong.base });
    await ready(wrong, pane);
    assert.equal(wrong.tick(withCswap(wrong)), '');
    assert.deepEqual(wrong.claudeCalls(), []);
  } finally { wrong.done(); }
  // no conversation: a pane at a limit, but no transcript of the supervisor's
  const noId = fixture('supnoid', { resume: CLAUDE_RESUME });
  try {
    const pane = supervisorPane(noId);
    await ready(noId, pane);
    assert.equal(noId.tick(withCswap(noId)), '');
    assert.deepEqual(noId.claudeCalls(), []);
    assert.equal(pane.keys(), '');
  } finally { noId.done(); }
  // another harness: no --resume to build
  const other = fixture('supother', { resume: 'codex resume' });
  try {
    other.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(other);
    await ready(other, pane);
    assert.equal(other.tick(withCswap(other)), '');
    assert.equal(other.run(['supervisor-session'], { DEVTEAM_ROLE: '' }).stdout, '', 'another harness: no id at all');
    const f = findings(other).find((x) => x.kind === 'supervisor-at-limit');
    assert.ok(f, 'still reported');
    assert.doesNotMatch(f.suggestion, /codex/);
  } finally { other.done(); }
  // a claude resume_command with nothing to replace: left alone too
  const noCont = fixture('supnocont', { resume: 'claude --dangerously-skip-permissions' });
  try {
    noCont.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(noCont);
    await ready(noCont, pane);
    assert.equal(noCont.tick(withCswap(noCont)), '');
    assert.deepEqual(noCont.claudeCalls(), []);
  } finally { noCont.done(); }
});

test('the supervisor\'s restarts share the caps: past 3 in 6 hours it is left alone and reported', { skip: !hasTmux }, async () => {
  const F = fixture('supcap', { resume: CLAUDE_RESUME });
  try {
    F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(F);
    await until(() => pane.shows().includes('Esc to cancel'), 'the menu');
    F.tick(withCswap(F));
    write(F.restartsFile, JSON.stringify({ supervisor: [Date.now() - 3600000, Date.now() - 2 * 3600000, Date.now() - 3 * 3600000] }));
    assert.equal(F.tick(withCswap(F)), '');
    assert.ok(F.state().restart_gave_up.includes('supervisor'));
    assert.deepEqual(F.claudeCalls(), []);
    assert.equal(pane.keys(), '');
    assert.doesNotMatch(findings(F).find((f) => f.kind === 'restart-gave-up').suggestion, /=.*:supervisor/);
  } finally { F.done(); }
});

const TMUX_BIN = hasTmux ? spawnSync('sh', ['-c', 'command -v tmux'], { encoding: 'utf8' }).stdout.trim() : null;
// A tmux that does what this body says, and is otherwise the test's own.
function tmuxShim(F, body) {
  const dir = fs.mkdtempSync(path.join(F.base, 'tmuxshim-'));
  write(path.join(dir, 'tmux'), `#!/bin/sh\n${body}\nexec ${TMUX_BIN} "$@"\n`);
  fs.chmodSync(path.join(dir, 'tmux'), 0o755);
  return { PATH: `${dir}${path.delimiter}${process.env.PATH}` };
}
const left = (F, pane) => { assert.equal(pane.keys(), ''); assert.deepEqual(F.claudeCalls(), []); assert.ok(!fs.existsSync(F.restartsFile) || !/"supervisor"/.test(fs.readFileSync(F.restartsFile, 'utf8')), 'no attempt spent'); };

test('an ad-hoc agent at the banner in the recorded pane is left alone when the supervisor\'s own transcript is not at a limit, or its process is not the supervisor', { skip: !hasTmux }, async () => {
  const dayOld = new Date(Date.now() - 24 * 3600000).toISOString();
  // the review's repro: a supervisor that was stopped a day ago, not at a limit, and an owner's agent in that pane
  const F = fixture('supadhoc', { resume: CLAUDE_RESUME });
  try {
    F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, { type: 'assistant', timestamp: dayOld, message: { content: [{ type: 'text', text: 'stopping here' }] } }]);
    const pane = supervisorPane(F, MENU, { prefix: '' });
    await until(() => pane.shows().includes('Esc to cancel'), 'the banner');
    assert.equal(F.tick(withCswap(F)), '');
    assert.equal(F.tick(withCswap(F)), '');
    left(F, pane);
    assert.equal(F.state().supervisor_limit, null);
  } finally { F.done(); }
  // its transcript is not at a limit, even with the role in the pane's environment
  const R = fixture('suprole', { resume: CLAUDE_RESUME });
  try {
    R.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, { type: 'assistant', timestamp: dayOld, message: { content: [{ type: 'text', text: 'stopping here' }] } }]);
    const pane = supervisorPane(R);
    await until(() => pane.shows().includes('Esc to cancel'), 'the banner');
    R.tick(withCswap(R));
    assert.equal(R.tick(withCswap(R)), '');
    left(R, pane);
  } finally { R.done(); }
  // at a limit, but the process in the pane isn't running as the supervisor: reported, not restarted
  const N = fixture('supnorole', { resume: CLAUDE_RESUME });
  try {
    N.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(N, MENU, { prefix: '' });
    await until(() => pane.shows().includes('Esc to cancel'), 'the banner');
    N.tick(withCswap(N));
    assert.equal(N.tick(withCswap(N)), '');
    left(N, pane);
    assert.ok(N.state().supervisor_limit, 'still reported');
  } finally { N.done(); }
});

test('a process that can\'t be read: refused, reported, nothing spent', { skip: !hasTmux || process.platform === 'linux' }, async () => {
  const F = fixture('supunread', { resume: CLAUDE_RESUME });
  try {
    F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(F);
    await until(() => pane.shows().includes('Esc to cancel'), 'the menu');
    F.tick(withCswap(F));
    const noPs = fs.mkdtempSync(path.join(F.base, 'nops-'));
    write(path.join(noPs, 'ps'), '#!/bin/sh\nexit 1\n');
    fs.chmodSync(path.join(noPs, 'ps'), 0o755);
    const said = F.tick({ ...withCswap(F), PATH: `${noPs}${path.delimiter}${process.env.PATH}` });
    assert.match(said, /not restarted: could not read the environment/);
    left(F, pane);
    assert.match(F.state().supervisor_limit.refused, /could not read/);
    assert.match(findings(F).find((x) => x.kind === 'supervisor-at-limit').detail, /not restarted: could not read/);
  } finally { F.done(); }
});

test('the restart keeps the permissions the running supervisor had: no flag it wasn\'t started with, and the command it prints suggests none', { skip: !hasTmux }, async () => {
  // README step 9's start: no flag, under a shell
  const plain = fixture('supplain', { resume: CLAUDE_RESUME });
  try {
    plain.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(plain, MENU, { prefix: 'DEVTEAM_ROLE=supervisor ', shell: true });
    await until(() => pane.shows().includes('Esc to cancel'), 'the menu');
    plain.tick(withCswap(plain));
    assert.doesNotMatch(findings(plain).find((x) => x.kind === 'supervisor-at-limit').suggestion, /dangerously/, 'the finding, the flag absent from the process');
    assert.doesNotMatch(plain.run(['fleet', 'status', '--no-fetch'], { DEVTEAM_ROLE: '' }).stdout, /dangerously/, 'the recovery line');
    assert.match(plain.tick(withCswap(plain)), /restarted the supervisor/);
    await until(() => plain.claudeCalls().length === 1, 'the stand-in claude ran');
    assert.equal(plain.claudeCalls()[0], `supervisor|--resume ${SID} You were restarted after a usage limit, on this same conversation. Carry on from where you were.`);
  } finally { plain.done(); }
  // started with it: carried over, and the printed command says so too
  const flagged = fixture('supflagged', { resume: CLAUDE_RESUME });
  try {
    flagged.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(flagged, MENU, { prefix: 'DEVTEAM_ROLE=supervisor ', shell: true, args: SKIP });
    await until(() => pane.shows().includes('Esc to cancel'), 'the menu');
    flagged.tick(withCswap(flagged));
    assert.ok(findings(flagged).find((x) => x.kind === 'supervisor-at-limit').suggestion.includes(`claude --resume ${SID}${SKIP}`));
    assert.match(flagged.run(['fleet', 'status', '--no-fetch'], { DEVTEAM_ROLE: '' }).stdout, new RegExp(`recovery .*claude --resume ${SID}${SKIP}`));
    assert.match(flagged.tick(withCswap(flagged)), /restarted the supervisor/);
    await until(() => flagged.claudeCalls().length === 1, 'the stand-in claude ran');
    assert.ok(flagged.claudeCalls()[0].startsWith(`supervisor|--resume ${SID}${SKIP} `), flagged.claudeCalls()[0]);
  } finally { flagged.done(); }
});

test('a parked or drained fleet\'s supervisor stays stopped, as box-supervisors leaves it', { skip: !hasTmux }, async () => {
  const F = fixture('supheld', { resume: CLAUDE_RESUME });
  try {
    F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(F);
    await until(() => pane.shows().includes('Esc to cancel'), 'the menu');
    F.tick(withCswap(F));
    F.logLine('supervisor', { type: 'act', class: 'drain', what: 'drained the fleet on host: moving', refs: [], reversible: true });
    assert.equal(F.tick(withCswap(F)), '', 'an old drain');
    left(F, pane);
    assert.ok(F.state().supervisor_limit, 'reported all the same');
    F.logLine('supervisor', { type: 'act', class: 'undrain', what: 'undrained the fleet', refs: [], reversible: true });
    const held = F.run(['fleet', 'drain', '--reason', 'moving']);
    assert.equal(held.status, 0, held.stderr);
    assert.equal(F.tick(withCswap(F)), '', 'a fleet drain');
    left(F, pane);
    assert.equal(F.run(['fleet', 'undrain']).status, 0);
    assert.match(F.tick(withCswap(F)), /restarted the supervisor/, 'running again, it is due');
  } finally { F.done(); }
});

test('a person at the pane: a half-typed line or a recently active client leaves it alone, and a re-check that finds nothing costs no attempt', { skip: !hasTmux }, async () => {
  const F = fixture('supdraft', { resume: CLAUDE_RESUME });
  try {
    F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(F, [MENU[0], '> half a thou']);
    await until(() => pane.shows().includes('half a thou'), 'the draft');
    F.tick(withCswap(F));
    assert.equal(F.tick(withCswap(F)), '');
    left(F, pane);
  } finally { F.done(); }
  const G = fixture('supclient', { resume: CLAUDE_RESUME });
  try {
    G.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(G, [MENU[0], '> ']);
    await until(() => pane.shows().includes('You\'ve hit'), 'the banner');
    execFileSync('tmux', ['select-window', '-t', `=${G.session}:sup-pane`]);
    G.tick(withCswap(G));
    const attached = tmuxShim(G, 'if [ "$1" = list-clients ]; then date +%s; exit 0; fi');
    assert.equal(G.tick({ ...withCswap(G), ...attached }), '', 'a client just pressed a key');
    left(G, pane);
    const idle = tmuxShim(G, 'if [ "$1" = list-clients ]; then echo $(( $(date +%s) - 3600 )); exit 0; fi');
    // the re-check right after the claim finds the banner gone: nothing done, no attempt taken
    const count = path.join(G.base, 'captures');
    const once = tmuxShim(G, `if [ "$1" = list-clients ]; then echo $(( $(date +%s) - 3600 )); exit 0; fi\nif [ "$1" = capture-pane ]; then n=$(cat ${count} 2>/dev/null || echo 0); n=$((n + 1)); echo $n > ${count}; if [ $n -gt 1 ]; then echo '> '; exit 0; fi; fi`);
    assert.equal(G.tick({ ...withCswap(G), ...once }), '');
    left(G, pane);
    assert.match(G.tick({ ...withCswap(G), ...idle }), /restarted the supervisor/, 'an idle client is nobody at the pane');
  } finally { G.done(); }
});

test('a tmux server the tick starts keeps no session markers, so windows opened there can run owner commands', { skip: !hasTmux }, async () => {
  const F = fixture('serverenv');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-tmux-recovery-'));
  try {
    F.worker('demo-70-e');
    assert.match(F.tick({ ...OFF, TMUX_TMPDIR: dir, CLAUDECODE: '1', DEVTEAM_CHANNEL: 'dashboard' }), /relaunched demo-70-e/);
    await until(() => F.relaunched().length === 1, 'relaunched');
    const global = spawnSync('tmux', ['show-environment', '-g'], { env: { ...process.env, TMUX_TMPDIR: dir }, encoding: 'utf8' }).stdout;
    assert.match(global, /^PATH=/m, 'it is the server\'s environment');
    assert.doesNotMatch(global, /^(DEVTEAM_ROLE|DEVTEAM_TICKET|DEVTEAM_FEATURE|DEVTEAM_CHANNEL|CLAUDECODE|CLAUDE_CODE_[A-Z_]+)=/m);
  } finally {
    spawnSync('tmux', ['kill-server'], { env: { ...process.env, TMUX_TMPDIR: dir } });
    fs.rmSync(dir, { recursive: true, force: true });
    F.done();
  }
});

test('--if-gone, its window made but nothing typed: says that, not that an old process has gone', { skip: !hasTmux }, () => {
  const F = fixture('ifgonefail');
  try {
    F.worker('demo-71-f', { launched: false });
    const r = F.run(['worker', 'demo-71-f', '--resume', '--if-gone'], tmuxShim(F, 'if [ "$1" = send-keys ]; then exit 1; fi'));
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /its new window has no agent in it/);
    assert.doesNotMatch(r.stderr, /old process/);
  } finally { F.done(); }
});

test('a supervisor that can\'t be restarted: the finding and fleet status give the exact command', () => {
  const F = fixture('supcmd', { resume: CLAUDE_RESUME });
  try {
    F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    F.tick(OFF);
    const f = findings(F).find((x) => x.kind === 'supervisor-at-limit');
    assert.ok(f);
    assert.ok(f.suggestion.includes(`claude --resume ${SID}`), f.suggestion);
    assert.doesNotMatch(f.suggestion, /dangerously-skip-permissions/, 'no running process to take it from: left out');
    assert.ok(f.suggestion.includes('DEVTEAM_ROLE=supervisor'), f.suggestion);
    // a dead machine, not at a limit: fleet status still says how to bring the supervisor back
    F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, { type: 'assistant', timestamp: new Date().toISOString(), message: { content: [{ type: 'text', text: 'working' }] } }]);
    const shown = F.run(['fleet', 'status', '--no-fetch'], { DEVTEAM_ROLE: '' });
    assert.match(shown.stdout, new RegExp(`recovery .*claude --resume ${SID}`), shown.stderr);
    assert.ok(json(F.run(['fleet', 'status', '--no-fetch', '--json'], { DEVTEAM_ROLE: '' }).stdout).recovery.endsWith(`claude --resume ${SID}`));
    assert.equal(F.run(['supervisor-session'], { DEVTEAM_ROLE: '' }).stdout, `${SID}\n`, 'stdout stays the bare id: the box\'s boot reads it');
  } finally { F.done(); }
});

// recover: a machine that came back, on real tmux, with stand-in agents. boot1 is the machine that
// ran; boot2 is the machine after it died.
const asOwner = { DEVTEAM_ROLE: '', DEVTEAM_CSWAP: 'off', DEVTEAM_MACHINE_EPOCH: 'boot2' };
const recover = (F, args = [], env = {}) => F.run(['recover', ...args], { ...asOwner, ...env });
const upFile = (F) => path.join(F.root, 'docs/devteam/run/supervisor-up.json');
const upRecord = (F) => json(fs.readFileSync(upFile(F), 'utf8'));
// the supervisor up and seen by a tick on the first boot; its pane left open for the caller
const seenUp = async (F, { skip = false } = {}) => {
  const pane = supervisorPane(F, ['SUP-UP'], { prefix: 'DEVTEAM_ROLE=supervisor ', shell: true, args: skip ? SKIP : '' });
  await until(() => pane.shows().includes('SUP-UP'), 'the stand-in supervisor');
  F.tick({ ...OFF, DEVTEAM_MACHINE_EPOCH: 'boot1' });
  return pane;
};
const privateServer = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-tmux-recover-')); return { dir, env: { TMUX_TMPDIR: dir, SHELL: STUB_SHELL }, done: () => { spawnSync('tmux', ['kill-server'], { env: { ...process.env, TMUX_TMPDIR: dir } }); fs.rmSync(dir, { recursive: true, force: true }); } }; };
const sessionTranscript = (F) => F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, { type: 'assistant', timestamp: new Date().toISOString(), message: { content: [{ type: 'text', text: 'working' }] } }]);

test('recover: a dead machine with no tmux server brings the supervisor back on its exact conversation, with the permissions it had, once', { skip: !hasTmux }, async () => {
  const F = fixture('recdead', { resume: CLAUDE_RESUME });
  const server = privateServer();
  try {
    sessionTranscript(F);
    await seenUp(F, { skip: true });
    assert.deepEqual([upRecord(F).kind, upRecord(F).up, upRecord(F).skip], ['tmux', true, true], 'what the tick saw of the running process');
    F.killSession();
    const dry = recover(F, ['--dry-run'], server.env);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, new RegExp(`^would resume session ${SID}`));
    assert.notEqual(spawnSync('tmux', ['has-session'], { env: { ...process.env, TMUX_TMPDIR: server.dir } }).status, 0, 'a dry run starts no server');
    const did = recover(F, [], server.env);
    assert.equal(did.status, 0, did.stderr);
    assert.match(did.stdout, new RegExp(`^resumed session ${SID}`));
    await until(() => F.claudeCalls().length === 1, 'the stand-in claude ran');
    assert.ok(F.claudeCalls()[0].startsWith(`supervisor|--resume ${SID} --dangerously-skip-permissions This machine restarted`), F.claudeCalls()[0]);
    assert.match(F.claudeCalls()[0], /Nothing about this restart came from the owner/, 'it carries no owner authority');
    const again = recover(F, [], server.env);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /already running/);
    sleepMs(300);
    assert.equal(F.claudeCalls().length, 1, 'safe to run twice: no second one');
    assert.equal(upRecord(F).machine, 'boot2', 'the record is this boot\'s now');
    const logged = json(F.run(['log', '--tail', '5', '--json'], { DEVTEAM_ROLE: '' }).stdout);
    assert.ok(!logged.some((o) => /recover/i.test(JSON.stringify(o))), 'it logs nothing as anyone');
  } finally { server.done(); F.done(); }
});

test('recover: a parked or drained fleet stays stopped; --force starts it', { skip: !hasTmux }, async () => {
  const F = fixture('recheld', { resume: CLAUDE_RESUME });
  const server = privateServer();
  try {
    sessionTranscript(F);
    await seenUp(F);
    F.killSession();
    assert.equal(F.run(['fleet', 'park', '--reason', 'moving']).status, 0);
    assert.match(recover(F, [], server.env).stdout, /left stopped \(its fleet is held: park\)/);
    assert.equal(F.run(['fleet', 'unpark']).status, 0);
    assert.equal(F.run(['fleet', 'drain', '--reason', 'moving']).status, 0);
    assert.match(recover(F, [], server.env).stdout, /left stopped \(its fleet is held: drain\)/);
    assert.deepEqual(F.claudeCalls(), []);
    assert.match(recover(F, ['--force', '--dry-run'], server.env).stdout, new RegExp(`^would resume session ${SID}`), '--force: its supervisor decides');
  } finally { server.done(); F.done(); }
});

test('recover: one the owner stopped stays stopped, whether a tick saw it or not; --force starts it', { skip: !hasTmux }, async () => {
  const F = fixture('recstopped', { resume: CLAUDE_RESUME });
  const server = privateServer();
  try {
    sessionTranscript(F);
    await seenUp(F);
    // closed while the machine stayed up, and no tick since
    F.killSession();
    assert.match(recover(F, [], { DEVTEAM_MACHINE_EPOCH: 'boot1' }).stdout, /left stopped/, 'the same boot, the same tmux server: closed, not died');
    // closed in tmux and a tick saw it: it says stopped, and a later restart doesn't undo that
    F.ensureSession();
    write(upFile(F), JSON.stringify({ ...upRecord(F), up: true, machine: 'boot1', server: spawnSync('tmux', ['list-sessions', '-F', '#{pid}'], { encoding: 'utf8' }).stdout.trim().split('\n')[0] }));
    F.tick({ ...OFF, DEVTEAM_MACHINE_EPOCH: 'boot1' });
    assert.equal(upRecord(F).up, false, 'the tick noticed');
    assert.match(recover(F, [], server.env).stdout, /left stopped \(stopped before the restart/);
    assert.deepEqual(F.claudeCalls(), []);
    assert.match(recover(F, ['--force', '--dry-run'], server.env).stdout, /^would resume/);
  } finally { server.done(); F.done(); }
});

test('recover: a live supervisor gets no second one, in tmux or in a terminal, even with --force', { skip: !hasTmux }, async () => {
  const F = fixture('reclive', { resume: CLAUDE_RESUME });
  const fgDir = fs.mkdtempSync(path.join(F.base, 'fg-'));
  let fg;
  try {
    sessionTranscript(F);
    await seenUp(F);
    assert.match(recover(F, ['--force']).stdout, /already running/);
    F.killSession();
    // A supervisor in a plain terminal is known by its own commands: the kit found the agent above it.
    write(path.join(fgDir, 'claude'), `require('child_process').spawnSync(process.execPath, [${JSON.stringify(path.join(F.root, 'docs/devteam/scripts/devteam.mjs'))}, 'knowledge', 'add', '--kind', 'fact', '--statement', 's'], { stdio: 'ignore' }); setInterval(() => {}, 1000);\n`);
    fs.rmSync(upFile(F), { force: true });
    fs.rmSync(path.join(F.root, 'docs/devteam/run/supervisor-up.checked'), { force: true });
    fg = spawn(process.execPath, [path.join(fgDir, 'claude'), SKIP.trim()], { cwd: F.root, env: { ...F.env(), DEVTEAM_SUPERVISOR_UP: '', TMUX: '', TMUX_PANE: '', DEVTEAM_MACHINE_EPOCH: 'boot1' }, stdio: 'ignore' });
    await until(() => fs.existsSync(upFile(F)) && upRecord(F).kind === 'foreground', 'its own command noted it');
    assert.equal(upRecord(F).pid, fg.pid);
    assert.equal(upRecord(F).skip, true, 'its flag, read from the process');
    assert.match(recover(F, ['--force']).stdout, /already running/, 'alive: no second one');
    assert.deepEqual(F.claudeCalls(), []);
    fg.kill('SIGKILL');
    await until(() => fg.exitCode !== null || fg.signalCode !== null, 'it stopped');
    await until(() => recover(F, ['--dry-run']).stdout.startsWith('would resume'), 'dead, on a new boot, it is due');
  } finally { fg?.kill('SIGKILL'); F.done(); }
});

test('recover --here: a supervisor from a plain terminal comes back in this one', { skip: !hasTmux }, () => {
  const F = fixture('rechere', { resume: CLAUDE_RESUME });
  const bin = fs.mkdtempSync(path.join(F.base, 'bin-'));
  const calls = path.join(F.base, 'here-calls');
  try {
    sessionTranscript(F);
    write(upFile(F), JSON.stringify({ at: new Date().toISOString(), up: true, kind: 'foreground', pid: null, start: null, machine: 'boot1', skip: false }));
    write(path.join(bin, 'claude'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\n`);
    fs.chmodSync(path.join(bin, 'claude'), 0o755);
    const did = spawnSync(process.execPath, [path.join(F.root, 'docs/devteam/scripts/devteam.mjs'), 'recover', '--here'], { cwd: F.root, encoding: 'utf8', env: { ...F.env(asOwner), SHELL: '/bin/sh', PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
    assert.equal(did.status, 0, did.stderr);
    assert.match(did.stdout, /in this terminal/);
    assert.match(fs.readFileSync(calls, 'utf8'), new RegExp(`^--resume ${SID} This machine restarted`), 'no permissions flag: it had none');
  } finally { F.done(); }
});

test('recover never grants what wasn\'t there: no record drops the flag, and a hand-written log line says nothing', { skip: !hasTmux }, async () => {
  const F = fixture('recgrant', { resume: CLAUDE_RESUME });
  try {
    sessionTranscript(F);
    assert.match(recover(F).stdout, /left stopped \(not running before/, 'nothing recorded: stays stopped');
    F.logLine('supervisor', { type: 'act', class: 'supervisor-up', what: `the supervisor was up with ${SKIP.trim()}`, refs: [], reversible: true });
    F.logLine('supervisor', { type: 'observation', source: 'pane', kind: 'supervisor-up', subject: 'supervisor', detail: 'up', detector: 'pane', source_key: 'x' });
    assert.match(recover(F).stdout, /left stopped \(not running before/, 'the log is no evidence of being up');
    const forced = recover(F, ['--force', '--dry-run']);
    assert.match(forced.stdout, new RegExp(`^would resume session ${SID} \\(without ${SKIP.trim()}`), 'no record of the flag: left off a resume');
    assert.notEqual(F.run(['recover'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'x-1' }).status, 0, 'a worker can\'t');
  } finally { F.done(); }
});

test('recover: a stale record stays stopped, a record from the future does too, and nothing wedges', { skip: !hasTmux }, () => {
  const F = fixture('recstale', { resume: CLAUDE_RESUME });
  try {
    sessionTranscript(F);
    const rec = { up: true, kind: 'tmux', pane: '%1', server: null, machine: 'boot1', skip: true };
    write(upFile(F), JSON.stringify({ ...rec, at: new Date(Date.now() - 4 * 86400000).toISOString() }));
    assert.match(recover(F).stdout, /left stopped \(last seen up 4 days ago/);
    write(upFile(F), JSON.stringify({ ...rec, at: new Date(Date.now() + 3600000).toISOString() }));
    assert.match(recover(F).stdout, /left stopped \(its record .* future/);
    // a recover that crashed mid-start: "starting" goes stale, and one dated in the future is ignored
    write(upFile(F), JSON.stringify({ ...rec, at: new Date().toISOString(), starting: Date.now() - 3600000 }));
    assert.match(recover(F, ['--dry-run']).stdout, /^would resume/);
    write(upFile(F), JSON.stringify({ ...rec, at: new Date().toISOString(), starting: Date.now() + 3600000 }));
    assert.match(recover(F, ['--dry-run']).stdout, /^would resume/);
    const lock = path.join(F.root, 'docs/devteam/run/recover.lock');
    fs.mkdirSync(lock, { recursive: true });
    const old = new Date(Date.now() - 3600000);
    fs.utimesSync(lock, old, old);
    assert.match(recover(F).stdout, /^resumed/, 'a lock left by a crash goes, and the restore goes ahead');
    assert.ok(!fs.existsSync(lock));
  } finally { spawnSync('tmux', ['kill-session', '-t', `=${F.session}`]); F.done(); }
});

test('recover: only the Claude Code harness resumes exactly, and the other says so', { skip: !hasTmux }, async () => {
  const F = fixture('reccodex', { resume: 'codex resume' });
  try {
    sessionTranscript(F);
    await seenUp(F);
    F.killSession();
    assert.match(recover(F, ['--dry-run']).stdout, /^would start fresh .*only Claude Code can resume a conversation exactly/);
  } finally { F.done(); }
});

test('recover --machine: every repo recorded on the machine, with each repo\'s own answer, a sibling skipped', { skip: !hasTmux }, async () => {
  const A = fixture('recmach-a', { resume: CLAUDE_RESUME });
  const B = fixture('recmach-b', { resume: CLAUDE_RESUME });
  const server = privateServer();
  try {
    sessionTranscript(A);
    await seenUp(A, { skip: true });
    A.killSession();
    B.tick({ ...OFF, DEVTEAM_MACHINE_EPOCH: 'boot1' });
    assert.equal(B.run(['fleet', 'park', '--reason', 'x']).status, 0);
    const reg = path.join(HOME, '.devteam', `repos-${process.env.DEVTEAM_HUB_PORT}`);
    fs.writeFileSync(path.join(reg, 'junk.json'), '{ not json');
    write(path.join(reg, 'gone.json'), JSON.stringify({ root: path.join(A.base, 'not-a-repo') }));
    const said = A.run(['recover', '--machine', '--dry-run'], { ...asOwner, ...server.env }).stdout;
    assert.match(said, new RegExp(`^recmach-a: would resume session ${SID}`, 'm'));
    assert.match(said, /^recmach-b: left stopped \(its fleet is held: park\)/m);
    assert.match(said, /^not-a-repo: skipped/m);
    // a repo with the kit but no settings isn't adopted: refused on its own too, nothing started
    const kitOnly = path.join(A.base, 'kit-only');
    fs.mkdirSync(path.join(kitOnly, 'docs/devteam/scripts'), { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: kitOnly });
    fs.copyFileSync(path.join(A.root, 'docs/devteam/scripts/devteam.mjs'), path.join(kitOnly, 'docs/devteam/scripts/devteam.mjs'));
    const skipped = spawnSync(process.execPath, [path.join(kitOnly, 'docs/devteam/scripts/devteam.mjs'), 'recover'], { cwd: kitOnly, encoding: 'utf8', env: A.env(asOwner) });
    assert.notEqual(skipped.status, 0);
    assert.match(skipped.stderr, /no docs\/devteam\/project\/settings\.md here/);
    // two that aren't linked are both started; a home's sibling only with --force is skipped
    const sf = path.join(B.root, 'docs/devteam/project/settings.md');
    fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"project":', `"links": { "recmach-a": { "kind": "repo", "remote": ${JSON.stringify(A.root)}, "title": "a" } },\n  "project":`));
    const forced = A.run(['recover', '--machine', '--force', '--dry-run'], { ...asOwner, ...server.env }).stdout;
    assert.match(forced, /^recmach-a: skipped \(a sibling of recmach-b\)/m);
    assert.match(forced, /^recmach-b: would start fresh/m);
  } finally { server.done(); A.done(); B.done(); }
});
