// Account rotation with cswap (claude-swap): detection, the hub-holder driving it, resuming panes
// stopped at a limit, and the findings. A stand-in cswap throughout: never the machine's real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORTS, bareProject, hasTmux, json, startDashboard, until, write } from './lib/kit.mjs';

const MENU = ["You've hit your weekly limit · resets Nov 12 at 12am (America/New_York)", 'What do you want to do?', '❯ 1. Stop and wait for limit to reset', '  2. Wait here, then continue automatically at Nov 12 at 12am', '  3. Switch to usage credits', 'Enter to confirm · Esc to cancel'];
const ROOM = { schemaVersion: 1, accounts: [{ number: 1, email: 'a@x', active: true, usageStatus: 'ok', usage: { fiveHour: { pct: 20 }, sevenDay: { pct: 30 } } }] };
const FULL = { schemaVersion: 1, accounts: [{ number: 1, email: 'a@x', active: true, usageStatus: 'ok', usage: { fiveHour: { pct: 100 }, sevenDay: { pct: 30 } } }] };

function fixture(name) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-acct-'));
  const root = bareProject(base, name);
  // a relaunch runs this in the pane, as it would claude --continue: it records which session came back
  const launched = path.join(base, 'launched.log');
  const relaunch = path.join(base, 'relaunch.cjs');
  write(relaunch, `require('fs').appendFileSync(${JSON.stringify(launched)}, require('path').basename(process.cwd()) + '\\n'); setInterval(() => {}, 1000);`);
  const sf = path.join(root, 'docs/devteam/project/settings.md');
  fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"project":', `"resume_command": ${JSON.stringify(`${process.execPath} ${relaunch}`)},\n  "project":`));
  execFileSync('sh', ['-c', 'git add -A && git -c user.email=t@t -c user.name=t commit -qm init'], { cwd: root });
  const calls = path.join(base, 'calls.log');
  const stub = path.join(base, 'cswap');
  write(stub, `#!/bin/sh\necho "$*" >> ${JSON.stringify(calls)}\ncase "$1" in\n  list) cat ${JSON.stringify(path.join(base, 'list.json'))} ;;\n  auto) cat ${JSON.stringify(path.join(base, 'auto.out'))}; exit $(cat ${JSON.stringify(path.join(base, 'auto.status'))}) ;;\nesac\n`);
  fs.chmodSync(stub, 0o755);
  const set = (list, auto = '', status = 2) => { write(path.join(base, 'list.json'), JSON.stringify(list)); write(path.join(base, 'auto.out'), auto); write(path.join(base, 'auto.status'), String(status)); };
  set(ROOM);
  const dt = path.join(root, 'docs/devteam/scripts/devteam.mjs');
  const env = (extra = {}) => { const e = { ...process.env, CLAUDE_CONFIG_DIR: path.join(base, 'claude'), DEVTEAM_CSWAP: stub, DEVTEAM_ROLE: 'supervisor', ...extra }; delete e.DEVTEAM_TICKET; delete e.DEVTEAM_FEATURE; return e; };
  const run = (args, extra) => spawnSync(process.execPath, [dt, ...args], { cwd: root, encoding: 'utf8', env: env(extra) });
  const tick = (...a) => { const r = run(['accounts-tick', ...a]); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  const state = () => json(fs.readFileSync(path.join(root, 'docs/devteam/run/accounts.json'), 'utf8'));
  const called = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean) : []);
  const session = run(['settings', '--get', 'tmux_session']).stdout.trim();
  // A stand-in agent in a real tmux pane: it shows what it's given and records every key.
  const agent = (window, shown, cwd = null) => {
    const wt = cwd ?? path.join(root, '.worktrees', window);
    fs.mkdirSync(wt, { recursive: true });
    const keys = path.join(base, `${window}.keys`);
    const prog = path.join(base, `${window}.cjs`);
    write(keys, '');
    write(prog, `const fs=require('fs');const shown=${JSON.stringify(shown)};console.log(shown.join('\\n'));process.stdin.setRawMode(true);process.stdin.on('data',(d)=>fs.appendFileSync(${JSON.stringify(keys)},d));`);
    const cmd = [process.execPath, prog].join(' ');
    // as the kit does: the session first, then a window started in the worktree
    if (spawnSync('tmux', ['has-session', '-t', `=${session}`]).status !== 0) execFileSync('tmux', ['new-session', '-d', '-s', session, '-n', 'dashboard', '-x', '120', '-y', '30', 'sleep 600']);
    execFileSync('tmux', ['new-window', '-d', '-t', `=${session}:`, '-n', window, '-c', wt, cmd]);
    return { keys: () => fs.readFileSync(keys, 'utf8'), shows: () => spawnSync('tmux', ['capture-pane', '-p', '-t', `=${session}:${window}`], { encoding: 'utf8' }).stdout };
  };
  // a planner's session: the kit relaunches it as planner <feature> --resume
  const planner = (feature, shown) => { execFileSync('git', ['branch', `plan/${feature}`], { cwd: root }); return agent(`plan-${feature}`, shown); };
  const relaunched = () => (fs.existsSync(launched) ? fs.readFileSync(launched, 'utf8').trim().split('\n').filter(Boolean) : []);
  const done = () => { spawnSync('tmux', ['kill-session', '-t', `=${session}`]); fs.rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }; // a tick the dashboard started can outlive it by a moment
  return { base, root, env, run, tick, state, called, set, agent, planner, relaunched, session, done };
}
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
    assert.match(F.tick(), /restarted plan-menu/);
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
    // in tmux, with room: still only reported (it is the owner's session, started their way)
    const s = F.agent('sup-pane', MENU, F.root);
    await until(() => s.shows().includes('Esc to cancel'), 'the menu');
    write(path.join(F.root, 'docs/devteam/run/supervisor-pane'), `=${F.session}:sup-pane`);
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
    ].map((shown, i) => F.planner(`text${i}`, shown));
    const done = F.planner('done', [MENU[0], '> ']);
    const scoped = F.planner('scoped', [MENU[0], '> ']);
    const later = F.planner('later', ['❯ 1. Upgrade your plan', '  2. Stop and wait for limit to reset', 'Enter to confirm · Esc to cancel']);
    const tasks = F.planner('tasks', [MENU[0], '◻ one', '◻ two', '◻ three', '◻ four', '╭──╮', '│ > │', '╰──╯', '⏵⏵ bypass permissions on']);
    await until(() => [...panes, done, scoped].every((p) => p.shows().includes('>')), 'the panes drawn');
    await until(() => later.shows().includes('Esc to cancel') && tasks.shows().includes('bypass'), 'the menu and the task list drawn');
    fs.mkdirSync(path.join(F.root, 'docs/devteam/run/log'), { recursive: true });
    fs.appendFileSync(path.join(F.root, 'docs/devteam/run/log/plan-done-2026-11.jsonl'), `${JSON.stringify({ v: 1, id: 'h-20261101-000000000-plan-done', type: 'phase', op: 'new', at: '2026-11-01T00:00:00.000Z', by: 'plan-done', to: 'done' })}\n`);
    F.set({ accounts: [{ ...ROOM.accounts[0], usage: { sevenDay: { pct: 30 }, scoped: [{ name: 'opus', pct: 100 }] } }] });
    F.tick();
    F.tick();
    assert.deepEqual(F.relaunched(), [], 'a full per-model window is not room');
    F.set(ROOM);
    const out = F.tick();
    assert.match(out, /restarted plan-scoped/, 'the pane the others are measured against');
    assert.match(out, /restarted plan-later/, 'the menu in any position');
    assert.match(out, /restarted plan-tasks/, 'a banner over a task list and input box');
    await until(() => ['plan-scoped', 'plan-later', 'plan-tasks'].every((n) => F.relaunched().includes(n)), 'the three relaunched');
    assert.deepEqual(F.relaunched().sort(), ['plan-later', 'plan-scoped', 'plan-tasks'], 'nothing else');
    for (const p of [...panes, done, scoped, later, tasks]) assert.equal(p.keys(), '');
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

test('the dashboard: only the one holding the hub rotates; every one looks after its own panes', async () => {
  const A = fixture('holder');
  const B = fixture('other');
  const HUB = PORTS + 70;
  const P = PORTS + 71;
  const env = (F) => { const e = { ...F.env({ DEVTEAM_HUB_PORT: String(HUB), DEVTEAM_PORT_BASE: String(P), DEVTEAM_ACCOUNTS_MS: '200', DEVTEAM_HUB_RETRY_MS: '60000' }) }; delete e.DEVTEAM_ROLE; return e; };
  const a = startDashboard(A.root, env(A));
  let b;
  try {
    await until(() => A.called().some((c) => c.startsWith('auto')), "the hub holder's rotation");
    b = startDashboard(B.root, env(B));
    await until(() => B.called().some((c) => c.startsWith('list')), 'the other dashboard ticking');
    assert.ok(!B.called().some((c) => c.startsWith('auto')), 'only the hub holder rotates');
    await until(() => fs.existsSync(path.join(A.root, 'docs/devteam/run/accounts.json')), "the holder's state");
    assert.ok(!json(A.run(['log', '--json']).stdout).some((o) => o.by === 'owner'), 'nothing is written as the owner');
  } finally { await a.stop(); await b?.stop(); A.done(); B.done(); }
});
