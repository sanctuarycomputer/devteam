// What accounts.*.test.mjs share. Account rotation with cswap (claude-swap): detection, the claim
// that picks who drives it, resuming panes stopped at a limit, and the findings. A stand-in cswap
// throughout: never the machine's real one. Each part imports it, so each part (its own process)
// gets its own copy: its own home, claim files and tmux session.
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bareProject, json, PORTS, write } from './kit.mjs';

const MENU = ["You've hit your weekly limit · resets Nov 12 at 12am (America/New_York)", 'What do you want to do?', '❯ 1. Stop and wait for limit to reset', '  2. Wait here, then continue automatically at Nov 12 at 12am', '  3. Switch to usage credits', 'Enter to confirm · Esc to cancel'];
const ROOM = { schemaVersion: 1, accounts: [{ number: 1, email: 'a@x', active: true, usageStatus: 'ok', usage: { fiveHour: { pct: 20 }, sevenDay: { pct: 30 } } }] };
const FULL = { schemaVersion: 1, accounts: [{ number: 1, email: 'a@x', active: true, usageStatus: 'ok', usage: { fiveHour: { pct: 100 }, sevenDay: { pct: 30 } } }] };
// A home of this file's own, so nothing lands in the real ~/.devteam or reads the machine's cswap state.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-acct-home-'));
process.on('exit', () => fs.rmSync(HOME, { recursive: true, force: true }));
// The machine-wide claim, by hub port: every fixture's tick is on the test file's own hub port.
const claimFile = (port = PORTS) => path.join(HOME, '.devteam', `accounts-rotate-${port}.json`);
const clearClaims = () => { for (const p of [PORTS, PORTS + 70]) for (const f of [claimFile(p), `${claimFile(p)}.lock`]) fs.rmSync(f, { recursive: true, force: true }); };

function fixture(name) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-acct-'));
  const root = bareProject(base, name);
  // a relaunch runs this in the pane, as it would claude --continue: it records which session came back
  const launched = path.join(base, 'launched.log');
  const relaunch = path.join(base, 'relaunch.cjs');
  // a session that stops again once relaunched shows the menu, when the test has asked for that
  const again = path.join(base, 'stops-again');
  write(relaunch, `const fs = require('fs'); fs.appendFileSync(${JSON.stringify(launched)}, require('path').basename(process.cwd()) + '\\n'); if (fs.existsSync(${JSON.stringify(again)})) console.log(${JSON.stringify(MENU.join('\n'))}); setInterval(() => {}, 1000);`);
  const sf = path.join(root, 'docs/devteam/project/settings.md');
  fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"project":', `"resume_command": ${JSON.stringify(`${process.execPath} ${relaunch}`)},\n  "project":`));
  execFileSync('sh', ['-c', 'git add -A && git -c user.email=t@t -c user.name=t commit -qm init'], { cwd: root });
  const calls = path.join(base, 'calls.log');
  const stub = path.join(base, 'cswap');
  write(stub, `#!/bin/sh\necho "$*" >> ${JSON.stringify(calls)}\ncase "$1" in\n  list) [ -f ${JSON.stringify(path.join(base, 'list.hook'))} ] && sh ${JSON.stringify(path.join(base, 'list.hook'))}; cat ${JSON.stringify(path.join(base, 'list.json'))} ;;\n  auto) cat ${JSON.stringify(path.join(base, 'auto.out'))}; exit $(cat ${JSON.stringify(path.join(base, 'auto.status'))}) ;;\n  switch) cat ${JSON.stringify(path.join(base, 'switch.out'))} ;;\nesac\n`);
  fs.chmodSync(stub, 0o755);
  const set = (list, auto = '', status = 2) => { write(path.join(base, 'list.json'), JSON.stringify(list)); write(path.join(base, 'auto.out'), auto); write(path.join(base, 'auto.status'), String(status)); };
  set(ROOM);
  const switches = (said) => write(path.join(base, 'switch.out'), JSON.stringify(said));
  switches(MOVED);
  const dt = path.join(root, 'docs/devteam/scripts/devteam.mjs');
  const env = (extra = {}) => { const e = { ...process.env, HOME, XDG_DATA_HOME: '', CLAUDE_CONFIG_DIR: path.join(base, 'claude'), DEVTEAM_CSWAP: stub, DEVTEAM_ROLE: 'supervisor', DEVTEAM_ACCOUNTS_MS: '1', ...extra }; delete e.DEVTEAM_TICKET; delete e.DEVTEAM_FEATURE; return e; };
  const run = (args, extra) => spawnSync(process.execPath, [dt, ...args], { cwd: root, encoding: 'utf8', env: env(extra) });
  const tick = (...a) => { const r = run(['accounts-tick', ...a]); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  const state = () => json(fs.readFileSync(path.join(root, 'docs/devteam/run/accounts.json'), 'utf8'));
  const called = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean) : []);
  const session = run(['settings', '--get', 'tmux_session']).stdout.trim();
  // A stand-in agent in a real tmux pane: it shows what it's given and records every key.
  const agent = (window, shown, cwd = null, more = '') => {
    const wt = cwd ?? path.join(root, '.worktrees', window);
    fs.mkdirSync(wt, { recursive: true });
    const keys = path.join(base, `${window}.keys`);
    const prog = path.join(base, `${window}.cjs`);
    write(keys, '');
    write(prog, `const fs=require('fs');const shown=${JSON.stringify(shown)};console.log(shown.join('\\n'));process.stdin.setRawMode(true);process.stdin.on('data',(d)=>fs.appendFileSync(${JSON.stringify(keys)},d));${more}`);
    const cmd = [process.execPath, prog].join(' ');
    // as the kit does: the session first, then a window started in the worktree
    if (spawnSync('tmux', ['has-session', '-t', `=${session}`]).status !== 0) execFileSync('tmux', ['new-session', '-d', '-s', session, '-n', 'dashboard', '-x', '120', '-y', '30', 'sleep 600']);
    execFileSync('tmux', ['new-window', '-d', '-t', `=${session}:`, '-n', window, '-c', wt, cmd]);
    return { keys: () => fs.readFileSync(keys, 'utf8'), shows: () => spawnSync('tmux', ['capture-pane', '-p', '-t', `=${session}:${window}`], { encoding: 'utf8' }).stdout };
  };
  // Lines of the log, as the kit writes them: what proves a session is one the supervisor launched.
  let lines = 0;
  const logLine = (by, body) => { fs.mkdirSync(path.join(root, 'docs/devteam/run/log'), { recursive: true }); fs.appendFileSync(path.join(root, `docs/devteam/run/log/${by === 'supervisor' ? 'supervisor-2026-11' : by}.jsonl`), `${JSON.stringify({ v: 1, id: `${body.type === 'act' ? 'a' : 'h'}-20261101-${String(++lines).padStart(9, '0')}-${by}`, op: 'new', at: '2026-11-01T00:00:00.000Z', by, ...body })}\n`); };
  const launchAct = (role, name) => logLine('supervisor', { type: 'act', class: 'worker-slots', what: `made ${role} ${name} in ${session}:${name}`, refs: [], reversible: true });
  // a planner's session: the kit relaunches it as planner <feature> --resume
  const planner = (feature, shown, { launched = true, more = '' } = {}) => { execFileSync('git', ['branch', `plan/${feature}`], { cwd: root }); if (launched) launchAct('planner', `plan-${feature}`); return agent(`plan-${feature}`, shown, null, more); };
  // a worker's session: the ticket exists; started and launched are what the kit would have logged
  const worker = (id, shown, { started = true, launched = true } = {}) => {
    logLine('supervisor', { type: 'ticket', id, title: id, feature: 'demo' });
    if (started) logLine(id, { type: 'phase', from: null, to: 'starting' });
    if (launched) launchAct('worker', id);
    return agent(id, shown);
  };
  const relaunched = () => (fs.existsSync(launched) ? fs.readFileSync(launched, 'utf8').trim().split('\n').filter(Boolean) : []);
  const done = () => { spawnSync('tmux', ['kill-session', '-t', `=${session}`]); clearClaims(); try { fs.rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {} }; // a tick the dashboard started can outlive it by a moment
  const restartsFile = path.join(root, 'docs/devteam/run/accounts-resumed.json');
  const stopsAgain = () => write(again, '');
  // the same command, not waiting: for several ticks at once
  const tickAsync = (extra) => new Promise((resolve) => execFile(process.execPath, [dt, 'accounts-tick', '--rotate'], { cwd: root, env: env(extra), encoding: 'utf8' }, (err, stdout) => resolve({ err, stdout })));
  return { base, root, env, run, tick, tickAsync, state, called, set, switches, agent, planner, worker, launchAct, logLine, relaunched, session, restartsFile, stopsAgain, done };
}
const MOVED = { schemaVersion: 1, switched: true, from: { number: 1, email: 'a@x' }, to: { number: 2, email: 'b@x' }, reason: 'switched' };
const findings = (F) => json(F.run(['metrics', '--json']).stdout).findings;

const MINUTE = { DEVTEAM_ACCOUNTS_MS: '60000' };
const autos = (F) => F.called().filter((c) => c.startsWith('auto'));

export { autos, claimFile, findings, fixture, FULL, HOME, MENU, MINUTE, MOVED, ROOM };
