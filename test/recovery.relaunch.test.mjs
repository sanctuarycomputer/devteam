// A dead machine's workers and planners come back (none while the machine's memory is at its
// ceiling): the guards, the race, the caps. The order and the 3-a-tick limit are in
// recovery.relaunch.order; a worktree_setup's deadline and its slots in .setup and .slots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasTmux, json, until, write } from './lib/kit.mjs';
import { findings, fixture, memory, OFF, sleepMs, STUB_SHELL, UNDER } from './lib/recovery-fixture.mjs';

const FULL = (F) => memory(F, 0.5);
test('a machine that died: the tmux session gone, a worker and a planner come back once there is room, with or without cswap', { skip: !hasTmux }, async () => {
  const F = fixture('gone');
  try {
    F.worker('demo-01-a');
    F.planner('plan1');
    // at the memory ceiling, as a new start would: both wait, and the tick says why
    assert.match(F.tick(FULL(F)), /^2 gone sessions wait for room to relaunch: the machine's memory is at 7\.5 of 8\.0 GB \(94%\), at or over its 80% ceiling$/m);
    assert.equal(F.state().memory_held, 2);
    assert.equal(F.tick(FULL(F)), '', 'said when the number changes, not every minute');
    assert.deepEqual(F.state().relaunched, []);
    assert.deepEqual(F.relaunched(), []);
    assert.equal(F.state().restart_gave_up.length, 0, 'waiting spends no attempt');
    const out1 = F.tick(UNDER(F));
    assert.match(out1, /relaunched demo-01-a: its window was gone/);
    assert.match(out1, /relaunched plan-plan1: its window was gone/);
    await until(() => F.relaunched().length === 2, 'both resumed');
    assert.deepEqual(F.relaunched().sort(), ['demo-01-a', 'plan-plan1']);
    assert.ok(F.windows().includes('demo-01-a') && F.windows().includes('plan-plan1'));
    const acts = json(F.run(['log', '--type', 'act', '--json']).stdout).map((a) => a.what);
    assert.ok(acts.some((w) => /^resumed worker demo-01-a in /.test(w)), 'relaunched as worker --resume');
    assert.equal(F.tick(FULL(F)), '', 'its windows are there: nothing more to do, and nothing said of memory');
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
    // the launch a second after the session was made
    const made = Number(spawnSync('tmux', ['display-message', '-p', '-t', `=${F.session}:`, '#{session_created}'], { encoding: 'utf8' }).stdout.trim());
    assert.ok(made > 0, 'the session\'s session_created');
    await until(() => Math.floor(Date.now() / 1000) > made, 'the second after the session was made');
    const now = new Date().toISOString();
    F.worker('demo-03-c', { at: now });
    F.planner('p2', { at: now });
    assert.equal(F.tick(OFF), '', 'someone closed these on purpose');
    assert.deepEqual(F.relaunched(), []);
    assert.ok(findings(F).some((f) => f.kind === 'planner-gone' && f.subject === 'plan-p2'), 'the existing finding reports it');
    F.killSession();
    // and a session made a second after the launch
    await until(() => Math.floor(Date.now() / 1000) > Math.floor(Date.parse(now) / 1000), 'the second after the launch');
    F.ensureSession();
    // a session created after the launch: what a reboot, a kept tmux restarted by hand, leaves
    assert.match(F.tick(UNDER(F)), /relaunched/);
    await until(() => F.relaunched().length === 2, 'both brought back');
  } finally { F.done(); }
});

test('held (a held ticket too), parked, done, merged and superseded sessions, and a removed worktree, are left alone', { skip: !hasTmux }, async () => {
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
    // a ticket held (its held field set), whatever its phase
    F.worker('demo-18-held', { extra: { held: 'waiting on PR #9' } });
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
    // a shell the kit knows (the stub shell execs /bin/sh -i): not node, and not the stub's own name
    await until(() => /^-?(sh|bash|dash|zsh)$/.test((spawnSync('tmux', ['display-message', '-p', '-t', `=${F.session}:demo-30-y`, '#{pane_current_command}'], { encoding: 'utf8' }).stdout ?? '').trim()), 'a shell in its pane, the agent gone');
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
    // demo-50-k (its record overwritten) and demo-51-m in one tick
    assert.match(F.tick(UNDER(F)), /relaunched demo-51-m/);
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
