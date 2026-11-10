// Coming back after a dead machine, and a supervisor at a usage limit: relaunching a session whose
// window is gone, --if-gone, restarting the supervisor on its exact conversation, and the command
// the owner gets when it can't be. Stand-in agents throughout, never the real claude or cswap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
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
  const agent = (window, shown, cwd = null) => {
    const wt = cwd ?? path.join(root, '.worktrees', window);
    fs.mkdirSync(wt, { recursive: true });
    const keys = path.join(base, `${window}.keys`);
    const prog = path.join(base, `${window}.cjs`);
    write(keys, '');
    write(prog, `const fs=require('fs');console.log(${JSON.stringify(shown)}.join('\\n'));process.stdin.setRawMode(true);process.stdin.on('data',(d)=>fs.appendFileSync(${JSON.stringify(keys)},d));setInterval(()=>{},1000);`);
    ensureSession();
    execFileSync('tmux', ['new-window', '-d', '-t', `=${session}:`, '-n', window, '-c', wt, `${process.execPath} ${prog}`]);
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
    const later = F.run(['worker', 'demo-30-y', '--resume']);
    assert.equal(later.status, 0, later.stderr);
    assert.doesNotMatch(later.stderr, /moments ago/);
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
const supervisorPane = (F, shown = MENU, { cwd = F.root } = {}) => {
  const pane = F.agent('sup-pane', shown, cwd);
  write(path.join(F.root, 'docs/devteam/run/supervisor-pane'), `=${F.session}:sup-pane`);
  return pane;
};
const withCswap = (F) => ({ DEVTEAM_CSWAP: F.cswap });
const CLAUDE_RESUME = 'claude --continue --dangerously-skip-permissions';

test('a supervisor stopped at a limit is restarted on its exact conversation, no key to the old process, once the account has room and has settled', { skip: !hasTmux }, async () => {
  const F = fixture('suprestart', { resume: CLAUDE_RESUME });
  try {
    F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(F);
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

test('a supervisor that can\'t be restarted: the finding and fleet status give the exact command', () => {
  const F = fixture('supcmd', { resume: CLAUDE_RESUME });
  try {
    F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    F.tick(OFF);
    const f = findings(F).find((x) => x.kind === 'supervisor-at-limit');
    assert.ok(f);
    assert.ok(f.suggestion.includes(`claude --resume ${SID} --dangerously-skip-permissions`), f.suggestion);
    assert.ok(f.suggestion.includes('DEVTEAM_ROLE=supervisor'), f.suggestion);
    // a dead machine, not at a limit: fleet status still says how to bring the supervisor back
    F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, { type: 'assistant', timestamp: new Date().toISOString(), message: { content: [{ type: 'text', text: 'working' }] } }]);
    const shown = F.run(['fleet', 'status', '--no-fetch'], { DEVTEAM_ROLE: '' });
    assert.match(shown.stdout, new RegExp(`recovery .*claude --resume ${SID}`), shown.stderr);
    assert.ok(json(F.run(['fleet', 'status', '--no-fetch', '--json'], { DEVTEAM_ROLE: '' }).stdout).recovery.endsWith(`claude --resume ${SID} --dangerously-skip-permissions`));
    assert.equal(F.run(['supervisor-session'], { DEVTEAM_ROLE: '' }).stdout, `${SID}\n`, 'stdout stays the bare id: the box\'s boot reads it');
  } finally { F.done(); }
});
