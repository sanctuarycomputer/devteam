// What recovery.*.test.mjs share. Coming back after a dead machine, and a supervisor at a usage
// limit: relaunching a session whose window is gone, --if-gone, restarting the supervisor on its exact
// conversation, and the command the owner gets when it can't be. Stand-in agents throughout, never
// the real claude or cswap.
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bareProject, hasTmux, json, write } from './kit.mjs';

const MENU = ["You've hit your weekly limit · resets Nov 12 at 12am (America/New_York)", 'What do you want to do?', '❯ 1. Stop and wait for limit to reset', '  2. Wait here, then continue automatically at Nov 12 at 12am', '  3. Switch to usage credits', 'Enter to confirm · Esc to cancel'];
const ROOM = { schemaVersion: 1, accounts: [{ number: 1, email: 'a@x', active: true, usageStatus: 'ok', usage: { fiveHour: { pct: 20 }, sevenDay: { pct: 30 } } }] };
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

// A supervisor stopped at a limit, in tmux, on its conversation
const SID = '11111111-2222-3333-4444-555555555555';
const SUP = 'You are the supervisor for this repository';
const rateLimit = () => ({ type: 'assistant', timestamp: new Date(Date.now() - 3600000).toISOString(), error: 'rate_limit', isApiErrorMessage: true, message: { content: [{ type: 'text', text: "You've hit your weekly limit" }] } });
const AS_SUPERVISOR = 'env DEVTEAM_ROLE=supervisor ';
const SKIP = ' --dangerously-skip-permissions';
const supervisorPane = (F, shown = MENU, { cwd = F.root, prefix = AS_SUPERVISOR, args = '', shell = false } = {}) => {
  const pane = F.agent('sup-pane', shown, cwd, { prefix, args, shell });
  for (const n of ['supervisor-pane', 'supervisor-pane-role']) write(path.join(F.root, 'docs/devteam/run', n), `=${F.session}:sup-pane`);
  return pane;
};
const CLAUDE_RESUME = 'claude --continue --dangerously-skip-permissions';

const TMUX_BIN = hasTmux ? spawnSync('sh', ['-c', 'command -v tmux'], { encoding: 'utf8' }).stdout.trim() : null;
// A tmux that does what this body says, and is otherwise the test's own.
function tmuxShim(F, body) {
  const dir = fs.mkdtempSync(path.join(F.base, 'tmuxshim-'));
  write(path.join(dir, 'tmux'), `#!/bin/sh\n${body}\nexec ${TMUX_BIN} "$@"\n`);
  fs.chmodSync(path.join(dir, 'tmux'), 0o755);
  return { PATH: `${dir}${path.delimiter}${process.env.PATH}` };
}

export { CLAUDE_RESUME, findings, fixture, HOME, MENU, OFF, rateLimit, ROOM, SID, SKIP, sleepMs, STUB_SHELL, SUP, supervisorPane, tmuxShim };
