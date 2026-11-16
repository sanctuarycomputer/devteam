// Restarting a session stopped at a limit: the menu, a banner alone, and text that only reads like a limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, FULL, MENU, ROOM } from './lib/accounts-fixture.mjs';
import { hasTmux, json, until } from './lib/kit.mjs';

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
