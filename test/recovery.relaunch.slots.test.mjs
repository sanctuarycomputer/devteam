// A relaunch whose setup finds no slot, or is killed at the deadline (kit-596).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { hasTmux, json, until } from './lib/kit.mjs';
import { clearSlots, findings, fixture, MENU, sleepMs, SLOTS, UNDER, withSetup } from './lib/recovery-fixture.mjs';

const deadlineIn = (ms) => ({ DEVTEAM_SETUP_DEADLINE: String(Date.now() + ms) });

// a process's start time as the kit reads it: field 22 of /proc/<pid>/stat, or ps lstart off Linux
function startOf(pid) {
  try { const t = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return t.slice(t.lastIndexOf(')') + 2).split(' ')[19]; } catch {}
  return (spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } }).stdout ?? '').trim() || null;
}

// slot n held by a live process (a sleep this test starts), its holder written temp-then-rename
async function holdSlot(n) {
  const c = spawn('sleep', ['290'], { stdio: 'ignore' });
  const exited = new Promise((r) => c.once('exit', r));
  const start = await until(() => startOf(c.pid), 'the holder started');
  fs.mkdirSync(SLOTS, { recursive: true });
  const tmp = path.join(SLOTS, `.test-${process.pid}-${n}`);
  fs.mkdirSync(tmp);
  fs.writeFileSync(path.join(tmp, 'holder.json'), JSON.stringify({ id: `test-${process.pid}-${n}`, pid: c.pid, start, at: new Date().toISOString() }));
  fs.renameSync(tmp, path.join(SLOTS, String(n)));
  // killed and reaped: a zombie still reads as alive
  return async () => { if (c.exitCode === null && c.signalCode === null) { c.kill('SIGKILL'); await exited; } };
}

const observations = (F) => json(F.run(['log', '--type', 'observation', '--json']).stdout);

const restarts = (F) => (fs.existsSync(F.restartsFile) ? json(fs.readFileSync(F.restartsFile, 'utf8')) : {});

test('5b: a gone session whose resume finds no setup slot waits, spending no attempt, and comes back once one frees', { skip: !hasTmux }, async () => {
  const F = fixture('slotwait');
  clearSlots();
  let free = async () => {};
  try {
    withSetup(F, 'true');
    F.worker('demo-104-slot');
    free = await holdSlot(0);
    for (let i = 0; i < 4; i++) {
      const out = F.tick({ ...UNDER(F), DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(2000) });
      if (i === 0) assert.match(out, /^1 gone session waits for a setup slot$/m);
      else assert.doesNotMatch(out, /setup slot/, 'said when the number changes, not every tick');
      assert.doesNotMatch(out, /relaunched|could not/);
      const st = F.state();
      assert.equal(st.slot_held, 1);
      assert.equal(st.memory_held, 0);
      assert.deepEqual(st.restart_gave_up, []);
      assert.deepEqual(st.relaunched, []);
      assert.ok(!restarts(F)['demo-104-slot'], `no attempt in the record: ${JSON.stringify(restarts(F))}`);
    }
    assert.ok(!observations(F).some((o) => o.kind === 'session-relaunched' && /could not/.test(o.detail)), 'no failure logged');
    const fs1 = findings(F);
    assert.ok(!fs1.some((f) => f.kind === 'restart-gave-up'));
    // never silent: a finding says how many wait and since when, high past 30 minutes
    const since = F.state().slot_held_since;
    assert.ok(Number.isFinite(Date.parse(since)), `slot_held_since is a time: ${since}`);
    const wait = fs1.filter((f) => f.kind === 'setup-slot-wait');
    assert.equal(wait.length, 1, JSON.stringify(fs1.map((f) => f.kind)));
    assert.equal(wait[0].severity, 'medium');
    assert.equal(wait[0].subject, 'setup-slots');
    assert.match(wait[0].detail, /1 gone session/);
    assert.match(wait[0].suggestion, /DEVTEAM_SETUP_SLOTS/);
    const af = path.join(F.root, 'docs/devteam/run/accounts.json');
    fs.writeFileSync(af, JSON.stringify({ ...F.state(), slot_held_since: new Date(Date.now() - 31 * 60000).toISOString() }));
    assert.equal(findings(F).find((f) => f.kind === 'setup-slot-wait')?.severity, 'high', 'past 30 minutes');
    const out1 = F.tick({ ...UNDER(F), DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(2000) });
    assert.doesNotMatch(out1, /relaunched/);
    assert.ok(Date.now() - Date.parse(F.state().slot_held_since) > 30 * 60000, 'kept while the wait goes on');
    await free();
    const out = F.tick({ ...UNDER(F), DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(20000) });
    assert.match(out, /relaunched demo-104-slot/);
    assert.equal(F.state().slot_held, 0);
    assert.equal(F.state().slot_held_since, undefined, 'dropped at 0');
    assert.ok(!findings(F).some((f) => f.kind === 'setup-slot-wait'), 'the finding is gone once none waits');
    assert.equal(restarts(F)['demo-104-slot'].length, 1);
    await until(() => F.relaunched().length === 1, 'resumed');
  } finally { await free(); clearSlots(); F.done(); }
});

test('5c: a pane stopped at a limit whose resume finds no setup slot is left running, its attempt given back', { skip: !hasTmux }, async () => {
  const F = fixture('slotlimit');
  clearSlots();
  let free = async () => {};
  try {
    withSetup(F, 'true');
    F.worker('demo-105-limit');
    const pane = F.agent('demo-105-limit', MENU);
    await until(() => pane.shows().includes('Esc to cancel'), 'the menu on screen');
    const pid = Number(spawnSync('tmux', ['display-message', '-p', '-t', `=${F.session}:demo-105-limit`, '#{pane_pid}'], { encoding: 'utf8' }).stdout.trim());
    assert.ok(pid > 1);
    const env = () => ({ ...UNDER(F), DEVTEAM_CSWAP: F.cswap, DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(2000) });
    assert.equal(F.tick(env()), '', 'the first tick: the account has not settled');
    free = await holdSlot(0);
    const out = F.tick(env());
    assert.match(out, /^1 gone session waits for a setup slot$/m);
    assert.doesNotMatch(out, /restarted|could not/);
    const st = F.state();
    assert.equal(st.slot_held, 1);
    assert.deepEqual(st.resumed, []);
    assert.deepEqual(st.restart_gave_up, []);
    assert.ok(!restarts(F)['demo-105-limit'], `the attempt given back: ${JSON.stringify(restarts(F))}`);
    assert.doesNotThrow(() => process.kill(pid, 0), 'the pane\'s process is still alive');
    assert.equal(Number(spawnSync('tmux', ['display-message', '-p', '-t', `=${F.session}:demo-105-limit`, '#{pane_pid}'], { encoding: 'utf8' }).stdout.trim()), pid, 'not replaced');
    assert.match(pane.shows(), /Esc to cancel/);
    assert.equal(pane.keys(), '');
    assert.ok(!observations(F).some((o) => o.kind === 'limit-restarted'), 'nothing logged');
  } finally { await free(); clearSlots(); F.done(); }
});

test('5d: a setup killed at the deadline is a failed attempt, and leaves no process behind', { skip: !hasTmux }, async () => {
  const F = fixture('slotdeadline');
  clearSlots();
  // this fixture's: on Linux, only one whose working directory is the setup's worktree, so another
  // run of this file on the machine (a reviewer's, CI's) is never taken for this one's leak
  const wt = () => fs.realpathSync(path.join(F.root, '.worktrees', 'demo-106-late'));
  const ours = (pid) => { try { return fs.readlinkSync(`/proc/${pid}/cwd`) === wt(); } catch { return !fs.existsSync('/proc/self/cwd'); } };
  const left = () => (spawnSync('pgrep', ['-f', 'sleep 71'], { encoding: 'utf8' }).stdout ?? '').split('\n').filter(Boolean).filter(ours);
  try {
    // it says when it has started, so the check below is of a setup that ran, not one cut off before it began
    const started = path.join(F.base, 'started');
    withSetup(F, `echo started > ${started}; sleep 71 & sleep 71`);
    F.worker('demo-106-late');
    const out = F.tick({ ...UNDER(F), ...deadlineIn(5000) });
    assert.ok(fs.existsSync(started), 'the setup ran before its deadline');
    assert.match(out, /could not relaunch demo-106-late/);
    assert.doesNotMatch(out, /setup slot/);
    assert.equal(F.state().slot_held, 0);
    assert.equal(restarts(F)['demo-106-late']?.length, 1, 'one attempt counted');
    assert.ok(observations(F).some((o) => o.kind === 'session-relaunched' && /could not/.test(o.detail)));
    // a few seconds' grace, not until's 120 s: a setup that outlived the deadline must fail this
    const end = Date.now() + 5000;
    while (left().length && Date.now() < end) sleepMs(100);
    assert.deepEqual(left(), [], 'no sleep 71 left');
  } finally { clearSlots(); F.done(); }
});
