// Account rotation with cswap (claude-swap): detection, the claim that picks who drives it, resuming panes
// stopped at a limit, and the findings. A stand-in cswap throughout: never the machine's real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PORTS, bareProject, hasTmux, json, startDashboard, until, write } from './lib/kit.mjs';

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
const row = (usage, more = {}) => ({ number: 1, email: 'a@x', usageStatus: 'ok', usage, ...more });
const findings = (F) => json(F.run(['metrics', '--json']).stdout).findings;

test('accounts-tick: off, or no cswap, touches nothing; a tick under tmux leaves the supervisor pane alone', () => {
  const F = fixture('off');
  try {
    const r = F.run(['accounts-tick', '--rotate'], { DEVTEAM_CSWAP: 'off', TMUX: 'x', TMUX_PANE: '%99' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(F.called(), [], 'off calls nothing');
    assert.equal(F.state().cswap, false);
    assert.ok(!fs.existsSync(path.join(F.root, 'docs/devteam/run/supervisor-pane')), "the dashboard's pane isn't taken for the supervisor's");
    // unset, on a fixture's own hub port: the machine's real cswap is never found, even on PATH
    const bin = path.dirname(F.env().DEVTEAM_CSWAP);
    const e = F.env({ PATH: `${bin}${path.delimiter}${process.env.PATH}`, DEVTEAM_HUB_PORT: String(PORTS) });
    delete e.DEVTEAM_CSWAP;
    const un = spawnSync(process.execPath, [path.join(F.root, 'docs/devteam/scripts/devteam.mjs'), 'accounts-tick', '--rotate'], { cwd: F.root, encoding: 'utf8', env: e });
    assert.equal(un.status, 0, un.stderr);
    assert.deepEqual(F.called(), []);
    assert.match(F.run(['accounts-tick'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'x-01-a' }).stderr, /the supervisor does this/);
  } finally { F.done(); }
});

test('rotation: runs cswap auto --once with no strategy of its own, reads its events whatever the exit code, and raises findings', () => {
  const F = fixture('rotate');
  try {
    F.set(ROOM, `${JSON.stringify({ schemaVersion: 1, event: 'poll' })}\n${JSON.stringify({ schemaVersion: 1, event: 'switch', from: { number: 1, email: 'a@x' }, to: { number: 2, email: 'b@x' } })}\nnot json\n`, 0);
    assert.match(F.tick('--rotate'), /cswap switched account: a@x -> b@x/);
    assert.deepEqual(F.called().filter((c) => c.startsWith('auto')), ['auto --once --json']);
    F.set(FULL, `${JSON.stringify({ event: 'all-exhausted' })}\n`, 3);
    assert.equal(F.tick('--rotate'), '', 'exit 3 is not a failure');
    assert.equal(F.state().exhausted, true);
    assert.ok(findings(F).some((f) => f.kind === 'accounts-exhausted' && f.severity === 'high'));
    // a dead login, every tick (cswap reports a quarantine only once)
    F.set({ accounts: [...ROOM.accounts, { number: 2, email: 'b@x', usageStatus: 'relogin_required', usage: null }] });
    F.tick();
    assert.ok(findings(F).some((f) => f.kind === 'account-needs-login' && f.subject === 'b@x'));
    assert.ok(!findings(F).some((f) => f.kind === 'accounts-exhausted'));
    // old news isn't reported
    const file = path.join(F.root, 'docs/devteam/run/accounts.json');
    fs.writeFileSync(file, JSON.stringify({ ...F.state(), at: new Date(Date.now() - 3600000).toISOString(), exhausted: true }));
    assert.ok(!findings(F).some((f) => f.kind === 'accounts-exhausted'));
    write(path.join(F.base, 'auto.out'), 'garbage');
    write(path.join(F.base, 'auto.status'), '1');
    assert.match(F.tick('--rotate'), /cswap auto: exit 1/);
    write(path.join(F.base, 'auto.out'), `${JSON.stringify({ event: 'error', message: 'keychain locked' })}\n`);
    assert.match(F.tick('--rotate'), /cswap auto: exit 1: keychain locked/, 'an error event is still a failure');
  } finally { F.done(); }
});

test('restarting: a session at the limit menu is relaunched on the active account, no key reaching the menu, once there is room', { skip: !hasTmux }, async () => {
  const F = fixture('resume');
  try {
    const a = F.planner('menu', MENU);
    await until(() => a.shows().includes('Esc to cancel'), 'the menu on screen');
    F.tick();
    assert.deepEqual(F.relaunched(), [], "the first tick: this project hasn't seen the account settle");
    F.set(FULL);
    F.tick();
    assert.deepEqual(F.relaunched(), [], 'no room: nothing is touched');
    assert.ok(!fs.existsSync(path.join(F.root, 'docs/devteam/run/tmux-session')), "no session called devteam here: the legacy name isn't taken");
    F.set(ROOM, `${JSON.stringify({ event: 'switch', to: 'b' })}\n`, 0);
    F.tick('--rotate');
    assert.deepEqual(F.relaunched(), [], 'not in the tick that switched');
    F.set(ROOM);
    // as under a dashboard started in tmux: the relaunch must stay on this server, and not take a pane
    const server = execFileSync('tmux', ['display-message', '-p', '-t', `=${F.session}:`, '#{socket_path}'], { encoding: 'utf8' }).trim();
    const under = F.run(['accounts-tick'], { TMUX: `${server},0,0`, TMUX_PANE: '%77' });
    assert.equal(under.status, 0, under.stderr);
    assert.match(under.stdout, /restarted plan-menu/);
    await until(() => F.relaunched().includes('plan-menu'), 'the session relaunched in its worktree');
    assert.equal(a.keys(), '', 'not a key to the old process: Enter or a digit on the menu could spend money');
    assert.deepEqual(F.state().resumed, ['plan-menu']);
    const logged = json(F.run(['log', '--json']).stdout);
    assert.ok(logged.some((o) => o.kind === 'limit-restarted' && o.subject === 'plan-menu'));
    assert.ok(logged.some((o) => o.type === 'act' && /^resumed planner plan-menu/.test(o.what)), 'relaunched as planner --resume would');
    assert.ok(!fs.existsSync(path.join(F.root, 'docs/devteam/run/supervisor-pane')), "the relaunch didn't take the dashboard's pane for the supervisor's");
  } finally { F.done(); }
});

test('restarting: a banner alone; never another prompt, a busy pane, a parked session, a window that is not a session; once in 10 minutes', { skip: !hasTmux }, async () => {
  const F = fixture('panes');
  try {
    const banner = F.planner('banner', [MENU[0], '> ']);
    const prompt = F.planner('prompt', [MENU[0], 'Do you want to proceed?', '❯ 1. Yes', '  2. No']);
    const busy = F.planner('busy', [MENU[0], '✶ Thinking… (esc to interrupt)']);
    const parked = F.planner('parked', [MENU[0], '> ']);
    const notes = F.agent('notes', [MENU[0], '> ']);
    await until(() => [banner, prompt, busy, parked, notes].every((p) => p.shows().includes('limit')), 'the panes drawn');
    fs.mkdirSync(path.join(F.root, 'docs/devteam/run/log'), { recursive: true });
    fs.appendFileSync(path.join(F.root, 'docs/devteam/run/log/plan-parked-2026-11.jsonl'), `${JSON.stringify({ v: 1, id: 'h-20261101-000000000-plan-parked', type: 'phase', op: 'new', at: '2026-11-01T00:00:00.000Z', by: 'plan-parked', to: 'parked' })}\n`);
    F.tick();
    assert.match(F.tick(), /restarted plan-banner/);
    await until(() => F.relaunched().includes('plan-banner'), 'the banner pane relaunched');
    F.tick();
    assert.deepEqual(F.relaunched(), ['plan-banner'], 'nothing else, and once per 10 minutes');
    for (const p of [banner, prompt, busy, parked, notes]) assert.equal(p.keys(), '');
  } finally { F.done(); }
});

test('restarting: a refusal or a failing worktree_setup leaves the old session running', { skip: !hasTmux }, async () => {
  const F = fixture('refuse');
  try {
    const a = F.planner('stays', MENU);
    await until(() => a.shows().includes('Esc to cancel'), 'the menu on screen');
    const sf = path.join(F.root, 'docs/devteam/project/settings.md');
    fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"project":', '"worktree_setup": "exit 1",\n  "project":'));
    execFileSync('sh', ['-c', 'git add -A && git -c user.email=t@t -c user.name=t commit -qm setup'], { cwd: F.root });
    F.tick();
    const out = F.tick();
    assert.match(out, /could not restart plan-stays/);
    assert.doesNotMatch(out, /restarted/);
    assert.equal(a.keys(), '', 'not a key to the old process');
    assert.deepEqual(F.relaunched(), []);
    assert.match(a.shows(), /Esc to cancel/, 'still on the menu: the process was never replaced');
    assert.ok(json(F.run(['log', '--json']).stdout).some((o) => o.kind === 'limit-restarted' && /could not be restarted/.test(o.detail)));
    assert.match(F.run(['planner', 'stays', '--resume', '--replace-agent'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'x-01-a' }).stderr, /the supervisor does this/, 'an agent cannot ask for the replacement');
    assert.match(a.shows(), /Esc to cancel/);
  } finally { F.done(); }
});

test('restarting: only a session the supervisor launched, in its own worktree, in one pane, with no background shells', { skip: !hasTmux }, async () => {
  const F = fixture('prove');
  try {
    const unstarted = F.worker('demo-01-unstarted', [MENU[0], '> '], { started: false });
    const noAct = F.planner('noact', [MENU[0], '> '], { launched: false });
    F.launchAct('planner', 'plan-elsewhere');
    const elsewhere = F.agent('plan-elsewhere', [MENU[0], '> '], path.join(F.root, '.worktrees', 'other'));
    const split = F.planner('split', [MENU[0], '> ']);
    const shells = F.planner('shells', [MENU[0], '⏵⏵ bypass permissions on · 2 background shells', '> ']);
    const started = F.worker('demo-02-started', [MENU[0], '> ']);
    const all = [unstarted, noAct, elsewhere, split, shells, started];
    await until(() => all.every((p) => p.shows().includes('limit')), 'the panes drawn');
    execFileSync('tmux', ['split-window', '-d', '-t', `=${F.session}:plan-split`, 'sleep 600']);
    F.tick();
    assert.match(F.tick(), /restarted demo-02-started/, 'a worker the supervisor launched, as the control');
    await until(() => F.relaunched().includes('demo-02-started'), 'the started worker relaunched');
    F.tick();
    assert.deepEqual(F.relaunched(), ['demo-02-started'], 'nothing else');
    for (const p of [unstarted, noAct, elsewhere, split, shells]) { assert.equal(p.keys(), ''); assert.match(p.shows(), /limit/); }
    assert.ok(!json(F.run(['log', '--json']).stdout).some((o) => o.type === 'act' && /^resumed .*(unstarted|noact|elsewhere|split|shells)/.test(o.what)));
  } finally { F.done(); }
});

test('restarting: a process that ignores the hangup gets a SIGTERM, and only it', { skip: !hasTmux }, async () => {
  const F = fixture('term');
  try {
    const termed = path.join(F.base, 'termed');
    // the stand-in holds on past the hangup, and says so when told to stop
    const a = F.planner('hup', MENU, { more: `process.on('SIGHUP',()=>{});process.stdin.on('error',()=>{});setInterval(()=>{},1000);process.on('SIGTERM',()=>{fs.writeFileSync(${JSON.stringify(termed)},'x');process.exit(0);});` });
    await until(() => a.shows().includes('Esc to cancel'), 'the menu on screen');
    F.tick();
    assert.match(F.tick(), /restarted plan-hup/);
    await until(() => fs.existsSync(termed), 'the SIGTERM');
    await until(() => F.relaunched().includes('plan-hup'), 'the relaunch');
    assert.equal(a.keys(), '');
  } finally { F.done(); }
});

test('restarting: 3 times in 6 hours at most, then left alone and reported, until the attempts age out', { skip: !hasTmux }, async () => {
  const F = fixture('cap');
  const rewind = (ms) => write(F.restartsFile, JSON.stringify(Object.fromEntries(Object.entries(json(fs.readFileSync(F.restartsFile, 'utf8'))).map(([k, v]) => [k, v.map((t) => t - ms)]))));
  const menu = (n) => until(() => F.relaunched().length === n && spawnSync('tmux', ['capture-pane', '-p', '-t', `=${F.session}:plan-cap`], { encoding: 'utf8' }).stdout.includes('Esc to cancel'), `relaunch ${n} stopped again`);
  try {
    F.stopsAgain();
    const a = F.planner('cap', MENU);
    await until(() => a.shows().includes('Esc to cancel'), 'the menu');
    F.tick();
    assert.match(F.tick(), /restarted plan-cap/);
    await menu(1);
    assert.doesNotMatch(F.tick(), /restarted/, 'once in 10 minutes');
    assert.deepEqual(F.state().restart_gave_up, [], "waiting isn't giving up");
    rewind(15 * 60000);
    assert.match(F.tick(), /restarted plan-cap/, 'a restarted session still counts as launched in its worktree');
    await menu(2);
    rewind(15 * 60000);
    assert.match(F.tick(), /restarted plan-cap/);
    await menu(3);
    rewind(15 * 60000);
    assert.doesNotMatch(F.tick(), /restarted/, 'three in 6 hours is the most');
    assert.deepEqual(F.state().restart_gave_up, ['plan-cap']);
    assert.deepEqual(F.relaunched().length, 3);
    const f = findings(F).find((x) => x.kind === 'restart-gave-up');
    assert.equal(f?.severity, 'high');
    assert.equal(f.subject, 'plan-cap');
    assert.match(f.suggestion, /capture-pane/, 'tells the owner how to look at it');
    // the oldest ages out: it recovers without a person
    const times = json(fs.readFileSync(F.restartsFile, 'utf8'))['plan-cap'];
    write(F.restartsFile, JSON.stringify({ 'plan-cap': [Date.now() - 7 * 3600000, times[1], times[2]] }));
    assert.match(F.tick(), /restarted plan-cap/);
    assert.deepEqual(F.state().restart_gave_up, []);
    assert.ok(!findings(F).some((x) => x.kind === 'restart-gave-up'));
    // a mangled list reads as none, and doesn't break metrics
    const file = path.join(F.root, 'docs/devteam/run/accounts.json');
    write(file, JSON.stringify({ at: new Date().toISOString(), restart_gave_up: 5 }));
    assert.equal(F.run(['metrics', '--json']).status, 0);
  } finally { F.done(); }
});

test("the restart record is untrusted, and a crash's lock can't wedge it", { skip: !hasTmux }, async () => {
  const F = fixture('record');
  const lock = `${F.restartsFile}.lock`;
  const again = async (n) => { await until(() => F.relaunched().length === n, `relaunch ${n}`); await until(() => spawnSync('tmux', ['capture-pane', '-p', '-t', `=${F.session}:plan-r`], { encoding: 'utf8' }).stdout.includes('Esc to cancel'), 'the menu again'); };
  try {
    F.stopsAgain();
    const a = F.planner('r', MENU);
    await until(() => a.shows().includes('Esc to cancel'), 'the menu');
    F.tick();
    // the old form: a lone number
    write(F.restartsFile, JSON.stringify({ 'plan-r': Date.now() - 1000 }));
    assert.doesNotMatch(F.tick(), /restarted/, 'the old number form still throttles');
    write(F.restartsFile, JSON.stringify({ 'plan-r': Date.now() + 3600000 }));
    assert.match(F.tick(), /restarted plan-r/, 'a time in the future is ignored');
    await again(1);
    for (const junk of ['{"plan-r":[null,"x",{},-1]}', '[1,2]', 'not json', '"str"']) {
      write(F.restartsFile, junk);
      assert.match(F.tick(), /restarted plan-r/, junk);
      await again(F.relaunched().length);
    }
    assert.ok(Array.isArray(json(fs.readFileSync(F.restartsFile, 'utf8'))['plan-r']));
    // a lock left by a crash, old or dated ahead, doesn't hold the tick
    for (const when of [Date.now() - 60000, Date.now() + 3600000]) {
      write(F.restartsFile, '{}');
      fs.mkdirSync(lock, { recursive: true });
      fs.utimesSync(lock, new Date(when), new Date(when));
      const n = F.relaunched().length;
      assert.match(F.tick(), /restarted plan-r/);
      await until(() => F.relaunched().length === n + 1, 'relaunched despite the lock');
      await until(() => !fs.existsSync(lock), 'the lock cleared');
    }
  } finally { F.done(); }
});

test('a stopped supervisor: reported, in tmux or not, with or without cswap, and never typed into', { skip: !hasTmux }, async () => {
  const F = fixture('sup');
  try {
    const slug = fs.realpathSync(F.root).replace(/[^a-zA-Z0-9]/g, '-');
    const file = path.join(F.base, 'claude', 'projects', slug, 's.jsonl');
    const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
    const rl = { type: 'assistant', timestamp: ago(2), error: 'rate_limit', isApiErrorMessage: true, message: { content: [{ type: 'text', text: "You've hit your weekly limit" }] } };
    write(file, `${JSON.stringify({ type: 'user', message: { content: 'You are the supervisor for this repository' } })}\n${JSON.stringify(rl)}\n`);
    F.run(['accounts-tick'], { DEVTEAM_CSWAP: 'off' });
    assert.match(F.state().supervisor_limit.text, /weekly limit/);
    const f = findings(F).find((x) => x.kind === 'supervisor-at-limit');
    assert.equal(f?.severity, 'high');
    assert.match(json(F.run(['hello', '--json'], { DEVTEAM_ROLE: '' }).stdout).alert, /supervisor stopped at a usage limit/);
    // it carried on: no longer stopped
    fs.appendFileSync(file, `${JSON.stringify({ type: 'assistant', timestamp: ago(1), message: { content: [{ type: 'text', text: 'carrying on' }] } })}\n`);
    F.tick();
    assert.equal(F.state().supervisor_limit, null);
    // in tmux, with room, but its resume_command isn't Claude Code's: reported, not restarted (recovery.test.mjs has the restart)
    const s = F.agent('sup-pane', MENU, F.root);
    await until(() => s.shows().includes('Esc to cancel'), 'the menu');
    for (const n of ['supervisor-pane', 'supervisor-pane-role']) write(path.join(F.root, 'docs/devteam/run', n), `=${F.session}:sup-pane`);
    fs.appendFileSync(file, `${JSON.stringify(rl)}\n`);
    F.tick();
    F.tick();
    assert.match(F.state().supervisor_limit.text, /weekly limit/);
    assert.equal(s.keys(), '');
    assert.deepEqual(F.relaunched(), []);
    // an old stop is not news; a limit lasts a week at most
    write(file, `${JSON.stringify({ type: 'user', message: { content: 'You are the supervisor for this repository' } })}\n${JSON.stringify({ ...rl, timestamp: ago(24 * 8) })}\n`);
    F.tick();
    assert.equal(F.state().supervisor_limit, null);
    // someone else's session at a limit isn't the supervisor's, even one quoting its commands; one running them is
    write(path.join(path.dirname(file), 'quoted.jsonl'), `${JSON.stringify({ type: 'user', message: { content: 'review this' } })}\n${JSON.stringify({ type: 'assistant', timestamp: ago(3), message: { content: [{ type: 'text', text: 'it runs DEVTEAM_ROLE=supervisor node x' }, { type: 'tool_use', input: { command: "grep -n 'DEVTEAM_ROLE=supervisor node' README.md" } }] } })}\n${JSON.stringify(rl)}\n`);
    const other = path.join(path.dirname(file), 'other.jsonl');
    write(other, `${JSON.stringify({ type: 'user', message: { content: 'what does this do?' } })}\n${JSON.stringify(rl)}\n`);
    write(file, `${JSON.stringify({ type: 'user', message: { content: 'fix the tests' } })}\n`);
    F.tick();
    assert.equal(F.state().supervisor_limit, null);
    write(other, `${JSON.stringify({ type: 'user', message: { content: 'assume the role' } })}\n${JSON.stringify({ type: 'assistant', timestamp: ago(3), message: { content: [{ type: 'tool_use', input: { command: 'DEVTEAM_ROLE=supervisor node x fleet status' } }] } })}\n${JSON.stringify(rl)}\n`);
    F.tick();
    assert.match(F.state().supervisor_limit.text, /weekly limit/);
  } finally { F.done(); }
});

test('supervisor-session: the supervisor\'s own conversation, read from disk, and nothing rather than a guess', () => {
  const F = fixture('sid');
  const id = () => { const r = F.run(['supervisor-session'], { DEVTEAM_ROLE: '' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  // the fixture's resume_command is a stand-in; this command only answers for Claude Code's
  const sf = path.join(F.root, 'docs/devteam/project/settings.md');
  const resumeWith = (cmd) => { fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace(/"resume_command": ".*?"/, `"resume_command": ${JSON.stringify(cmd)}`)); execFileSync('sh', ['-c', `git add -A && git -c user.email=t@t -c user.name=t commit -qm resume`], { cwd: F.root }); }; // owner settings count as committed on main
  try {
    resumeWith('claude --continue --dangerously-skip-permissions');
    assert.equal(id(), '', 'no transcripts yet');
    const dir = path.join(F.base, 'claude', 'projects', fs.realpathSync(F.root).replace(/[^a-zA-Z0-9]/g, '-'));
    const user = (content) => JSON.stringify({ type: 'user', message: { content } });
    const ran = (command) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', input: { command } }] } });
    let at = Date.now() / 1000 - 100;
    const save = (name, text) => { const f = path.join(dir, `${name}.jsonl`); write(f, `${text}\n`); fs.utimesSync(f, at, at); at += 1; };
    save('owner', user('fix the typo'));
    assert.equal(id(), '', "the owner's own conversation isn't the supervisor's");
    save('started', user('You are the supervisor for this repository'));
    assert.equal(id(), 'started\n');
    save('quoting', `${user('what does DEVTEAM_ROLE=supervisor node x do?')}\n${ran('grep "DEVTEAM_ROLE=supervisor node" README.md')}`);
    assert.equal(id(), 'started\n', 'quoting the commands is not running them');
    save('adopted', `${user('be the supervisor')}\n${ran('DEVTEAM_ROLE=supervisor node docs/devteam/scripts/devteam.mjs status')}`);
    assert.equal(id(), 'adopted\n', 'the newest that ran them');
    save('setup', `${user('Use github.com/sanctuarycomputer/devteam to set up a fleet in this repo')}\n${ran('cd /x/website; export DEVTEAM_ROLE=supervisor; D="node docs/devteam/scripts/devteam.mjs"; $D status')}`);
    assert.equal(id(), 'setup\n', 'a session that set up its own fleet, exporting the role');
    save('exported', `${user('look around')}\n${ran('export DEVTEAM_ROLE=supervisor; echo hi')}`);
    assert.equal(id(), 'setup\n', 'exporting the role without running the kit is not running it');
    for (const n of ['a', 'b', 'c', 'd', 'e']) save(n, user('something else'));
    assert.equal(id(), '', 'past the newest five');
    save('started', user('You are the supervisor for this repository'));
    resumeWith('codex resume --last');
    assert.equal(id(), '', 'another harness');
  } finally { F.done(); }
});

test('what the accounts say: only known-full accounts are exhausted, and room means every window it has', () => {
  const F = fixture('rows');
  const exhausted = (accounts) => { F.set({ accounts }); F.tick(); return F.state().exhausted; };
  try {
    assert.equal(exhausted([row({ fiveHour: { pct: 100 }, sevenDay: { pct: 1 } })]), true);
    assert.equal(exhausted([row({ sevenDay: { pct: 100 } })]), true, 'an account with no 5-hour window');
    assert.equal(exhausted([row({ sevenDay: { pct: 50 } })]), false);
    assert.equal(exhausted([row({ fiveHour: { pct: null }, sevenDay: { pct: null } })]), false, 'unmeasured is not full');
    for (const usageStatus of ['unavailable', 'token_expired', 'api_key']) assert.equal(exhausted([row(null, { usageStatus })]), false, usageStatus);
    assert.equal(exhausted([row({ sevenDay: { pct: 50 }, scoped: [{ name: 'x', pct: 100 }] })]), false, 'one full model is not a full account');
    assert.equal(exhausted([row({ fiveHour: { pct: 100 } }), row({ fiveHour: { pct: 2 } }, { disabled: true })]), true, 'a disabled account is no way out');
  } finally { F.done(); }
});

test('restarting: never on text that only reads like a limit, another harness, a finished session, or a per-model limit', { skip: !hasTmux }, async () => {
  const F = fixture('prose');
  try {
    const panes = [
      ['⏺ CI hit the memory limit on the second run; moving on.', '> '],
      ['⏺ The rate limit resets every 60s, so I added a backoff.', '> '],
      ['⎿  limit=100 resets=0', '> '],
      [MENU[0], '● Carried on, on Linux', '> '],
      ['⏺ The menu says 1. Stop and wait for limit to reset', 'Enter to confirm is what it shows', '> '],
      ["⏺ You've hit your weekly limit · resets Nov 12, the banner reads", '> '],
      ["■ You've hit your usage limit. Try again in 2h 5m.", '> '],
      [MENU[0], "⏺ Carried on after that: here's the summary", '> '],
      ["  You've hit your weekly limit · resets Nov 12, the banner read, so I stopped there.", '> '],
    ].map((shown, i) => F.planner(`text${i}`, shown));
    const done = F.planner('done', [MENU[0], '> ']);
    const scoped = F.planner('scoped', [MENU[0], '> ']);
    const later = F.planner('later', ['❯ 1. Upgrade your plan', '  2. Stop and wait for limit to reset', 'Enter to confirm · Esc to cancel']);
    const tasks = F.planner('tasks', [MENU[0], '◻ one', '◻ two', '◻ three', '◻ four', '╭──╮', '│ > │', '╰──╯', '⏵⏵ bypass permissions on']);
    const indented = F.planner('indented', [`  ⎿  ${MENU[0]}`, '> ']);
    await until(() => [...panes, done, scoped].every((p) => p.shows().includes('>')), 'the panes drawn');
    await until(() => later.shows().includes('Esc to cancel') && tasks.shows().includes('bypass'), 'the menu and the task list drawn');
    fs.mkdirSync(path.join(F.root, 'docs/devteam/run/log'), { recursive: true });
    fs.appendFileSync(path.join(F.root, 'docs/devteam/run/log/plan-done-2026-11.jsonl'), `${JSON.stringify({ v: 1, id: 'h-20261101-000000000-plan-done', type: 'phase', op: 'new', at: '2026-11-01T00:00:00.000Z', by: 'plan-done', to: 'done' })}\n`);
    F.set({ accounts: [{ ...ROOM.accounts[0], usage: { sevenDay: { pct: 30 }, scoped: [{ name: 'opus', pct: 100 }] } }] });
    F.tick();
    F.tick();
    assert.deepEqual(F.relaunched(), [], 'a full per-model window is not room');
    F.set(ROOM);
    let out = '';
    for (let i = 0; i < 8 && (out.match(/restarted/g) ?? []).length < 4; i++) {
      const one = F.tick();
      assert.ok((one.match(/restarted/g) ?? []).length <= 1, 'one relaunch a tick');
      out += one;
    }
    assert.match(out, /restarted plan-scoped/, 'the pane the others are measured against');
    assert.match(out, /restarted plan-later/, 'the menu in any position');
    assert.match(out, /restarted plan-tasks/, 'a banner over a task list and input box');
    assert.match(out, /restarted plan-indented/, "⎿ at any indent; a bare banner only at column 0");
    await until(() => ['plan-scoped', 'plan-later', 'plan-tasks', 'plan-indented'].every((n) => F.relaunched().includes(n)), 'the four relaunched');
    assert.deepEqual(F.relaunched().sort(), ['plan-indented', 'plan-later', 'plan-scoped', 'plan-tasks'], 'nothing else');
    for (const p of [...panes, done, scoped, later, tasks, indented]) assert.equal(p.keys(), '');
  } finally { F.done(); }
});

test('files any agent could write can stop nothing', { skip: !hasTmux }, async () => {
  const F = fixture('files');
  try {
    const a = F.planner('a', [MENU[0], '> ']);
    await until(() => a.shows().includes('limit'), 'the pane');
    const resumed = path.join(F.root, 'docs/devteam/run/accounts-resumed.json');
    F.tick();
    fs.mkdirSync(resumed);
    assert.doesNotMatch(F.tick(), /restarted/, "if the attempt can't be recorded nothing is done");
    assert.deepEqual(F.relaunched(), []);
    fs.rmSync(resumed, { recursive: true });
    write(resumed, 'null');
    assert.match(F.tick(), /restarted plan-a/, 'a null throttle file');
    await until(() => F.relaunched().length === 1, 'relaunched');
    write(path.join(F.root, 'docs/devteam/run/accounts.json'), JSON.stringify({ at: new Date().toISOString(), needs_login: 5 }));
    assert.equal(F.run(['metrics', '--json']).status, 0, 'a mangled state file does not break metrics');
  } finally { F.done(); }
});

const MINUTE = { DEVTEAM_ACCOUNTS_MS: '60000' };
const autos = (F) => F.called().filter((c) => c.startsWith('auto'));
const switchCalls = (F) => F.called().filter((c) => c.startsWith('switch'));
const SOON = new Date(Date.now() + 3600000).toISOString();
const PAST = new Date(Date.now() - 3600000).toISOString();
const expired = (over) => ({ number: 1, email: 'a@x', active: true, usageStatus: 'token_expired', usage: null, ...over });
const FULL_READING = { lastGoodUsage: { fiveHour: { pct: 40 }, sevenDay: { pct: 100, resetsAt: SOON } }, lastGoodAgeSeconds: 7200 };
const OTHER = { number: 2, email: 'b@x', usageStatus: 'ok', usage: { fiveHour: { pct: 10 }, sevenDay: { pct: 20 } } };
const OTHER_FULL = { ...OTHER, usage: { fiveHour: { pct: 100 }, sevenDay: { pct: 20 } } };
const ROOMIEST = { ...OTHER, number: 3, email: 'c@x', usage: { fiveHour: { pct: 5 }, sevenDay: { pct: 6 } } };
// cswap's own state, where cswap keeps it in this test file's home (paths.py; env() clears XDG_DATA_HOME)
const CSWAP_STATE = path.join(HOME, ...(process.platform === 'linux' ? ['.local', 'share', 'claude-swap'] : ['.claude-swap-backup']), 'autoswitch_state.json');
const quarantine = (slot, file = CSWAP_STATE) => write(file, JSON.stringify({ schemaVersion: 1, quarantine: { [slot]: { email: 'c@x', reason: 'invalid_grant', at: '2026-11-01T00:00:00+00:00', refreshTokenFingerprint: null } } }));

test('the claim: of several ticks at once only one rotates, and the rest of the interval stays quiet', async () => {
  const F = fixture('claim');
  try {
    const ticks = await Promise.all([1, 2, 3, 4].map(() => F.tickAsync(MINUTE)));
    for (const t of ticks) assert.equal(t.err, null, String(t.err));
    assert.deepEqual(autos(F), ['auto --once --json'], 'one rotation between them');
    assert.equal(F.called().filter((c) => c.startsWith('list')).length, 4, 'every tick still reads the accounts');
    F.run(['accounts-tick', '--rotate'], MINUTE);
    assert.equal(autos(F).length, 1, 'still inside the interval');
    assert.equal(fs.existsSync(`${claimFile()}.lock`), false, 'the lock is let go');
  } finally { F.done(); }
});

test('the claim: a stale, a future-dated or a mangled one holds nothing, and a live one does', () => {
  const F = fixture('claim-stale');
  try {
    const claimed = (text) => { fs.mkdirSync(path.dirname(claimFile()), { recursive: true }); fs.writeFileSync(claimFile(), text); };
    claimed(JSON.stringify({ at: Date.now() - 90000, by: 1 }));
    F.run(['accounts-tick', '--rotate'], MINUTE);
    assert.equal(autos(F).length, 1, 'stale: taken over');
    claimed(JSON.stringify({ at: Date.now() + 3600000, by: 1 }));
    F.run(['accounts-tick', '--rotate'], MINUTE);
    assert.equal(autos(F).length, 2, 'future-dated: taken over');
    claimed('not json');
    F.run(['accounts-tick', '--rotate'], MINUTE);
    assert.equal(autos(F).length, 3, 'mangled: taken over');
    fs.rmSync(claimFile());
    fs.mkdirSync(claimFile());
    F.run(['accounts-tick', '--rotate'], MINUTE);
    assert.equal(autos(F).length, 4, 'a directory in its place: taken over');
    assert.ok(fs.statSync(claimFile()).isFile());
    claimed(JSON.stringify({ at: Date.now() - 1000, by: 1 }));
    F.run(['accounts-tick', '--rotate'], MINUTE);
    assert.equal(autos(F).length, 4, 'a live claim holds');
  } finally { F.done(); }
});

test('leaving a full account: on an expired token with a full last reading, and on a plain full one', () => {
  const F = fixture('fallback');
  try {
    F.set({ accounts: [expired(FULL_READING), OTHER] });
    assert.match(F.tick('--rotate'), /cswap switched account: a@x -> b@x/);
    assert.deepEqual(switchCalls(F), ['switch 2 --json'], 'by number, once');
    assert.equal(F.state().active, 'b@x');
    assert.equal(F.state().active_no_room, false);
    assert.equal(F.state().exhausted, false);
    F.set({ accounts: [{ ...FULL.accounts[0] }, OTHER] });
    assert.match(F.tick('--rotate'), /cswap switched account: a@x -> b@x/);
    assert.equal(switchCalls(F).length, 2, 'a plain full account too');
  } finally { F.done(); }
});

test('leaving a full account: the enabled account with the most room is named, and staying put is reported', () => {
  const F = fixture('fallback-named');
  try {
    F.switches({ ...MOVED, to: { number: 3, email: 'c@x' } });
    F.set({ accounts: [expired(FULL_READING), OTHER, ROOMIEST, { ...OTHER, number: 4, email: 'd@x', disabled: true, usage: { fiveHour: { pct: 1 }, sevenDay: { pct: 1 } } }] });
    assert.match(F.tick('--rotate'), /cswap switched account: a@x -> c@x/);
    assert.deepEqual(switchCalls(F), ['switch 3 --json']);
    assert.equal(F.state().active, 'c@x');
    F.switches({ schemaVersion: 1, switched: false, reason: 'already-active' });
    F.set({ accounts: [{ ...FULL.accounts[0] }, OTHER] });
    assert.match(F.tick('--rotate'), /cswap stayed on a@x: already-active/);
    assert.equal(switchCalls(F).length, 2, 'one switch a tick');
  } finally { F.done(); }
});

test('leaving a full account: never onto a slot auto has quarantined, and a state file that makes no sense quarantines nothing', () => {
  const F = fixture('fallback-quarantine');
  const lastSwitch = () => switchCalls(F).at(-1);
  try {
    quarantine('3');
    F.set({ accounts: [expired(FULL_READING), OTHER, ROOMIEST] });
    F.tick('--rotate');
    assert.deepEqual(switchCalls(F), ['switch 2 --json'], 'the most room that is not quarantined');
    F.set({ accounts: [expired(FULL_READING), ROOMIEST] });
    F.tick('--rotate');
    assert.equal(switchCalls(F).length, 1, 'the only room is quarantined');
    F.set({ accounts: [expired(FULL_READING), OTHER, ROOMIEST] });
    for (const text of ['not json', 'null', '[]', '{}', '{"quarantine":null}', '{"quarantine":"abcd"}', '{"quarantine":["a","b","c","d"]}']) {
      write(CSWAP_STATE, text);
      const n = switchCalls(F).length;
      F.tick('--rotate');
      assert.equal(switchCalls(F).length, n + 1, text);
      assert.equal(lastSwitch(), 'switch 3 --json', text);
    }
    fs.rmSync(CSWAP_STATE);
    fs.mkdirSync(CSWAP_STATE);
    F.tick('--rotate');
    assert.equal(lastSwitch(), 'switch 3 --json', 'a directory');
    fs.rmSync(CSWAP_STATE, { recursive: true });
    F.tick('--rotate');
    assert.equal(lastSwitch(), 'switch 3 --json', 'no file');
  } finally { fs.rmSync(CSWAP_STATE, { recursive: true, force: true }); F.done(); }
});

test("leaving a full account: cswap's state is read from where cswap keeps it on this platform", () => {
  const F = fixture('fallback-xdg');
  const pick = (XDG_DATA_HOME) => { const r = F.run(['accounts-tick', '--rotate'], { XDG_DATA_HOME }); assert.equal(r.status, 0, r.stderr); return switchCalls(F).at(-1); };
  const inXdg = path.join(F.base, 'xdg', 'claude-swap', 'autoswitch_state.json');
  const inHome = path.join(HOME, 'xdg-tilde', 'claude-swap', 'autoswitch_state.json');
  try {
    F.set({ accounts: [expired(FULL_READING), OTHER, ROOMIEST] });
    quarantine('3', inXdg);
    quarantine('3', inHome);
    // Linux follows XDG_DATA_HOME, expanding a leading ~; macOS never looks at it
    assert.equal(pick(path.join(F.base, 'xdg')), process.platform === 'linux' ? 'switch 2 --json' : 'switch 3 --json');
    assert.equal(pick('~/xdg-tilde'), process.platform === 'linux' ? 'switch 2 --json' : 'switch 3 --json');
    // not absolute: ignored, as cswap ignores it, so the default place is the one that counts
    quarantine('3');
    assert.equal(pick('relative/xdg'), 'switch 2 --json');
  } finally { fs.rmSync(path.join(HOME, 'xdg-tilde'), { recursive: true, force: true }); fs.rmSync(CSWAP_STATE, { force: true }); F.done(); }
});

test('leaving a full account: not on unknown usage, an old reading, no room, no claim, or after cswap moved', () => {
  const F = fixture('fallback-not');
  try {
    F.set({ accounts: [expired(), OTHER] });
    assert.equal(F.tick('--rotate'), '', 'unknown usage');
    F.set({ accounts: [{ number: 1, email: 'a@x', active: true, usageStatus: 'unavailable', usage: null, lastGoodUsage: { sevenDay: { pct: 100, resetsAt: SOON } }, lastGoodAgeSeconds: 60 }, OTHER] });
    F.tick('--rotate');
    F.set({ accounts: [expired({ lastGoodUsage: { sevenDay: { pct: 100, resetsAt: PAST } }, lastGoodAgeSeconds: 7200 }), OTHER] });
    F.tick('--rotate');
    F.set({ accounts: [expired({ lastGoodUsage: { fiveHour: { pct: 100 } }, lastGoodAgeSeconds: 6 * 3600 }), OTHER] });
    F.tick('--rotate');
    F.set({ accounts: [expired({ lastGoodUsage: { sevenDay: { pct: 100 } } }), OTHER] });
    F.tick('--rotate');
    assert.deepEqual(switchCalls(F), [], 'an unknown or out-of-date reading is not a full account');
    assert.equal(F.state().active_no_room, false);
    // no account has room: left for accounts-exhausted to say, a last-known-full account counted
    F.set({ accounts: [expired(FULL_READING), OTHER_FULL] });
    F.tick('--rotate');
    assert.deepEqual(switchCalls(F), [], 'nothing has room');
    assert.equal(F.state().exhausted, true);
    assert.equal(F.state().active_no_room, true);
    assert.ok(findings(F).some((f) => f.kind === 'accounts-exhausted'));
    F.set({ accounts: [expired(FULL_READING), { ...OTHER, disabled: true }] });
    F.tick('--rotate');
    assert.deepEqual(switchCalls(F), [], 'a disabled account is not room');
    F.set({ accounts: [expired(FULL_READING), OTHER] });
    F.tick();
    assert.deepEqual(switchCalls(F), [], 'without --rotate');
    F.run(['accounts-tick', '--rotate'], MINUTE);
    const n = switchCalls(F).length;
    F.run(['accounts-tick', '--rotate'], MINUTE);
    assert.equal(switchCalls(F).length, n, 'another dashboard holds the claim');
    F.set({ accounts: [expired(FULL_READING), OTHER] }, `${JSON.stringify({ event: 'switch', from: { email: 'a@x' }, to: { email: 'b@x' } })}\n`, 0);
    const before = switchCalls(F).length;
    F.tick('--rotate');
    assert.equal(switchCalls(F).length, before, 'cswap moved it itself');
  } finally { F.done(); }
});

test('leaving a full account: not once another dashboard has taken the claim over', () => {
  const F = fixture('fallback-lost');
  try {
    F.set({ accounts: [expired(FULL_READING), OTHER] });
    // between auto and the switch, the way a slow list lets the claim lapse and another dashboard take it
    write(path.join(F.base, 'list.hook'), `printf '%s' '${JSON.stringify({ at: Date.now(), by: 1 })}' > ${JSON.stringify(claimFile())}\n`);
    F.run(['accounts-tick', '--rotate'], MINUTE);
    assert.equal(autos(F).length, 1);
    assert.deepEqual(switchCalls(F), [], 'the claim is no longer this tick\'s');
  } finally { F.done(); }
});

test('starting a session: a warning on a full active account, never a refusal, and only on fresh news', { skip: !hasTmux }, async () => {
  const F = fixture('prelaunch');
  try {
    F.worker('x-01-a', ['> ']);
    // its agent has exited, so the window is back at a shell and --resume starts it
    execFileSync('tmux', ['respawn-pane', '-k', '-t', `=${F.session}:x-01-a`, 'sh']);
    const accounts = path.join(F.root, 'docs/devteam/run/accounts.json');
    const start = () => F.run(['worker', 'x-01-a', '--resume']);
    F.set(FULL);
    F.tick();
    assert.equal(F.state().active_no_room, true);
    const warned = start();
    assert.equal(warned.status, 0, warned.stderr);
    assert.match(warned.stderr, /warning: the active Claude account \(a@x\) has no room left/);
    const stale = { ...F.state(), at: new Date(Date.now() - 3600000).toISOString() };
    write(accounts, JSON.stringify(stale));
    assert.doesNotMatch(start().stderr, /no room left/, 'old news');
    write(accounts, JSON.stringify({ ...stale, at: new Date(Date.now() + 3600000).toISOString() }));
    assert.doesNotMatch(start().stderr, /no room left/, 'dated in the future');
    write(accounts, JSON.stringify({ ...stale, at: new Date().toISOString(), active_no_room: 'yes' }));
    assert.doesNotMatch(start().stderr, /no room left/, 'not a true');
    write(accounts, JSON.stringify({ ...stale, at: new Date().toISOString(), active: 'x'.repeat(200) }));
    assert.match(start().stderr, /account \(x{80}\) has no room left/, 'a long name is cut short');
    F.set(ROOM);
    F.tick();
    assert.doesNotMatch(start().stderr, /no room left/, 'room');
  } finally { F.done(); }
});

test('the dashboard: rotation needs no hub, one dashboard does it per interval, and another picks it up; every one looks after its own panes', async () => {
  const A = fixture('rotator');
  const B = fixture('other');
  const HUB = PORTS + 70;
  const P = PORTS + 71;
  const env = (F) => { const e = { ...F.env({ DEVTEAM_HUB_PORT: String(HUB), DEVTEAM_PORT_BASE: String(P), DEVTEAM_ACCOUNTS_MS: '200', DEVTEAM_HUB_RETRY_MS: '60000' }) }; delete e.DEVTEAM_ROLE; return e; };
  // a hub neither of them holds: a dashboard on a kit older than rotation
  const oldHub = http.createServer((req, res) => { res.end(JSON.stringify({ hub: 1 })); });
  await new Promise((r) => oldHub.listen(HUB, '127.0.0.1', r));
  const began = Date.now();
  const a = startDashboard(A.root, env(A));
  let b;
  try {
    await until(() => autos(A).length > 0, 'rotation with the hub held elsewhere');
    b = startDashboard(B.root, env(B));
    await until(() => B.called().some((c) => c.startsWith('list')), 'the other dashboard ticking');
    assert.ok(autos(A).length + autos(B).length <= Math.ceil((Date.now() - began) / 180) + 1, 'one rotation per interval between them');
    await until(() => fs.existsSync(path.join(A.root, 'docs/devteam/run/accounts.json')), "the first dashboard's state");
    assert.ok(!json(A.run(['log', '--json']).stdout).some((o) => o.by === 'owner'), 'nothing is written as the owner');
    await a.stop();
    const n = autos(B).length;
    await until(() => autos(B).length > n, 'the other dashboard rotating once the first is gone');
  } finally { await a.stop(); await b?.stop(); await new Promise((r) => { oldHub.close(r); oldHub.closeAllConnections?.(); }); A.done(); B.done(); }
});

test("the supervisor's own pane: a lost Enter is pressed, at most three times, never into a prompt, never while it works", { skip: !hasTmux }, async () => {
  const F = fixture('sup-enter');
  try {
    const text = '[devteam answer q-1 from owner] read it with: devteam.mjs questions --id q-1';
    const sent = path.join(F.root, 'docs/devteam/run/sent', `${encodeURIComponent(`${F.session}:sup-enter`)}.json`);
    const deliver = (agoSec) => write(sent, JSON.stringify({ text, at: new Date(Date.now() - agoSec * 1000).toISOString() }));
    const pane = (shown) => {
      spawnSync('tmux', ['kill-window', '-t', `=${F.session}:sup-enter`]);
      const s = F.agent('sup-enter', shown, F.root);
      for (const n of ['supervisor-pane', 'supervisor-pane-role']) write(path.join(F.root, 'docs/devteam/run', n), `=${F.session}:sup-enter`);
      return s;
    };
    // the incident: compacted while idle, an owner's answer typed in and its Enter lost
    const stuck = ['⏺ Compacted while idle', '─'.repeat(60), `❯ ${text}`, '─'.repeat(60), '  ⏵⏵ bypass permissions on (shift+tab to cycle)'];
    let s = pane(stuck);
    await until(() => s.shows().includes('devteam answer'), 'the stuck input');
    deliver(5);
    F.tick();
    assert.equal(s.keys(), '', 'typed seconds ago: a slow submit is not double-pressed');
    deliver(3600);
    F.tick();
    await until(() => s.keys() === '\r', 'one Enter');
    assert.equal(json(fs.readFileSync(sent, 'utf8')).tries, 1, 'kept for another try');
    F.tick();
    assert.equal(s.keys(), '\r', 'a second tick inside 30s presses nothing');
    // that Enter was lost too (the stand-in never takes it): 30s on, another, up to three in all
    const later = () => { const r = json(fs.readFileSync(sent, 'utf8')); write(sent, JSON.stringify({ ...r, at: new Date(Date.now() - 60 * 1000).toISOString() })); };
    later();
    F.tick();
    await until(() => s.keys() === '\r\r', 'a second Enter');
    later();
    F.tick();
    await until(() => s.keys() === '\r\r\r', 'a third Enter');
    assert.ok(!fs.existsSync(sent), 'and then it stops');
    F.tick();
    assert.equal(s.keys(), '\r\r\r', 'never a fourth');
    // a hand-written negative count gives no extra tries
    write(sent, JSON.stringify({ text, at: new Date(Date.now() - 3600 * 1000).toISOString(), tries: -5 }));
    F.tick();
    await until(() => s.keys() === '\r\r\r\r', 'a first try');
    assert.equal(json(fs.readFileSync(sent, 'utf8')).tries, 1, 'counted from zero');
    fs.rmSync(sent, { force: true });
    // a stale read: another process pressed and put the record back (a fresh time) between this
    // one's read and its claim; the claim reads it again and presses nothing
    deliver(3600);
    const slowDone = new Promise((r) => execFile(process.execPath, [path.join(F.root, 'docs/devteam/scripts/devteam.mjs'), 'accounts-tick'], { cwd: F.root, env: F.env({ DEVTEAM_LOST_ENTER_CLAIM_DELAY_MS: '3000' }) }, r));
    await new Promise((r) => setTimeout(r, 2000));
    write(sent, JSON.stringify({ text, at: new Date().toISOString(), tries: 1, typed_at: new Date(Date.now() - 3600 * 1000).toISOString() }));
    await slowDone;
    assert.equal(s.keys(), '\r\r\r\r', 'a record pressed a moment ago is not pressed again');
    assert.equal(json(fs.readFileSync(sent, 'utf8')).tries, 1, 'and it is put back as it was');
    fs.rmSync(sent, { force: true });
    // the echo of a submitted line, then the bottom changes after a press: a reply, or the owner typing
    // their own line (no client in a test, so only the bottom tells): no second or third Enter
    const echo = [`> ${text}`, '⏺ Done.', '─'.repeat(60), '❯ ', '─'.repeat(60), '  ⏵⏵ bypass permissions on (shift+tab to cycle)'];
    for (const after of [[`> ${text}`, '⏺ Done, and more besides.', '─'.repeat(60), '❯ ', '─'.repeat(60), '  ⏵⏵ bypass permissions on (shift+tab to cycle)'], [`> ${text}`, '⏺ Done.', '─'.repeat(60), '❯ and next could you', '─'.repeat(60), '  ⏵⏵ bypass permissions on (shift+tab to cycle)']]) {
      s = pane(echo);
      await until(() => s.shows().includes('Done.'), 'the echo');
      deliver(3600);
      F.tick();
      await until(() => s.keys() === '\r', 'the one Enter a static echo gets');
      s = pane(after);
      await until(() => s.shows().includes(after[3] === '❯ ' ? 'besides' : 'next could'), 'the changed bottom');
      later();
      F.tick();
      if (fs.existsSync(sent)) { later(); F.tick(); }
      assert.equal(s.keys(), '', `no more Enters once the bottom changed: ${after[1]} / ${after[3]}`);
      assert.ok(!fs.existsSync(sent), 'the rescue ends');
    }
    for (const shown of [[`❯ ${text}`, '✻ Thinking… (esc to interrupt)'], [`❯ ${text}`, 'Do you want to proceed?', '❯ 1. Yes', '  2. No'], [...MENU, `❯ ${text}`]]) {
      s = pane(shown);
      await until(() => s.shows().includes('devteam answer'), 'the pane');
      deliver(3600);
      F.tick();
      assert.equal(s.keys(), '', `left alone: ${shown[1]}`);
    }
  } finally { F.done(); }
});
