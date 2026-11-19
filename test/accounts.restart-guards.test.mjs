// Restarting: what is left running, which sessions qualify, the SIGTERM, and the cap on attempts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { findings, fixture, MENU } from './lib/accounts-fixture.mjs';
import { hasTmux, json, until, write } from './lib/kit.mjs';

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
