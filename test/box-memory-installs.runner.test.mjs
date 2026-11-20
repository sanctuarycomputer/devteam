// Worktree installs (kit-596): the setup runner through `chore start`: its process group, the deadline,
// one slot at a time, signals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { alive, clock, deadlineIn, hold, pgrep, sleepMs, slotFleet, startOf, until } from './lib/box-memory-fixture.mjs';

const pgidOf = (pid) => Number((spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).stdout ?? '').trim()) || null;
test('4a: the setup leads its own process group under a node runner, and a long stdout leaves the report whole', async () => {
  const S = slotFleet('installs-4a', (F) => `echo "$$ $(ps -o pgid= -p $$ | tr -d ' ') $PPID $(ps -o ppid= -p $PPID | tr -d ' ') $(basename "$(ps -o args= -p $PPID | awk '{ print $1 }')")" > ${F.base}/4a.txt; awk 'BEGIN { for (i = 0; i < 2048; i++) printf "%0100d\\n", i }'`);
  try {
    const r = await S.startAsync('one');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.length > 200000, 'the setup\'s stdout comes through');
    const [sh, pgid, ppid, gp, comm] = fs.readFileSync(path.join(S.F.base, '4a.txt'), 'utf8').trim().split(/\s+/);
    assert.equal(pgid, sh, 'the setup\'s shell leads its own group');
    // the parent's program, from its command line: node 24 names its main thread MainThread, so comm no longer says node
    assert.match(comm, /^node/);
    assert.notEqual(Number(ppid), r.pid, 'its parent is not the chore start process');
    assert.equal(Number(gp), r.pid, 'its parent is a child of chore start (the runner)');
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('4b: at the deadline the setup\'s whole group is killed and chore start exits 124', async () => {
  const S = slotFleet('installs-4b', () => 'echo $$ > sh.pid; sleep 61 & echo $! > gc.pid; sleep 61');
  try {
    const t0 = Date.now();
    const r = S.start('one', deadlineIn(2000));
    assert.equal(r.status, 124, r.err);
    assert.ok(Date.now() - t0 < 6000, `exited after ${Date.now() - t0} ms`);
    assert.match(r.err, /worktree_setup ran past its deadline in /);
    const sh = Number(fs.readFileSync(path.join(S.wt('one'), 'sh.pid'), 'utf8'));
    const gc = Number(fs.readFileSync(path.join(S.wt('one'), 'gc.pid'), 'utf8'));
    const ours = () => pgrep('sleep 61').filter((p) => p === gc || pgidOf(p) === sh);
    await until(() => !alive(sh) && ours().length === 0, 2000, 'the setup\'s shell and sleeps to be gone').catch((e) => { for (const p of ours()) try { process.kill(p, 'SIGKILL'); } catch {} throw e; });
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('4c: with one slot, two chore starts run their setups one after the other', async () => {
  const S = slotFleet('installs-4c', (F) => `echo "start ${clock}" >> ${F.base}/4c-$(basename "$PWD").txt; sleep 1; echo "end ${clock}" >> ${F.base}/4c-$(basename "$PWD").txt`);
  try {
    const env = { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(20000) };
    const [a, b] = await Promise.all([S.startAsync('a', env), S.startAsync('b', env)]);
    assert.equal(a.status, 0, a.stderr);
    assert.equal(b.status, 0, b.stderr);
    const iv = (s) => { const t = Object.fromEntries(fs.readFileSync(path.join(S.F.base, `4c-chore-${s}.txt`), 'utf8').trim().split('\n').map((l) => l.split(' ')).map(([k, v]) => [k, Number(v)])); return [t.start, t.end]; };
    const [[s1, e1], [s2, e2]] = [iv('a'), iv('b')];
    assert.ok(e1 <= s2 || e2 <= s1, `the setups overlap: a ${s1}-${e1}, b ${s2}-${e2}`);
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('4d: with the one slot held by a live process, the deadline gives exit 75 and setup-slot-wait', () => {
  const S = slotFleet('installs-4d', () => 'true');
  try {
    const p = S.live();
    hold(S.slots, 0, { pid: p.pid, start: startOf(p.pid) });
    const r = S.start('one', { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(1000) });
    assert.equal(r.status, 75, r.err);
    assert.match(r.err, /setup-slot-wait/);
    assert.match(r.err, /waiting for a setup slot \(1 of 1 in use on this machine\)/);
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('4d\': a slot that comes free only after a wait, its setup then killed at the deadline, is still a slot wait (75), and nothing is left', async () => {
  const token = `t596w-${process.pid}-${Date.now()}`;
  const S = slotFleet('installs-4d2', () => `: ${token}; echo $$ > sh.pid; sleep 64 & echo $! > gc.pid; sleep 64`);
  let sh = null;
  let gc = null;
  const ours = () => pgrep('sleep 64').filter((p) => p === gc || (sh && pgidOf(p) === sh));
  try {
    const p = S.live();
    hold(S.slots, 0, { pid: p.pid, start: startOf(p.pid) });
    const deadline = Date.now() + 5000;
    const run = S.startAsync('one', { DEVTEAM_SETUP_SLOTS: '1', DEVTEAM_SETUP_DEADLINE: String(deadline) });
    await until(() => pgrep(token).length, 4000, `a runner whose argv names ${token}`);
    // at least one wait round passes, then the holder goes about 1.5 s before the deadline
    await sleepMs(Math.max(1100, deadline - 1500 - Date.now()));
    p.kill('SIGKILL');
    const r = await run;
    const shf = path.join(S.wt('one'), 'sh.pid');
    assert.ok(fs.existsSync(shf), `the setup got the slot and started before the deadline: ${r.stderr}`);
    sh = Number(fs.readFileSync(shf, 'utf8'));
    gc = Number(fs.readFileSync(path.join(S.wt('one'), 'gc.pid'), 'utf8'));
    assert.equal(r.status, 75, r.stderr);
    assert.match(r.stderr, /setup-slot-wait/);
    await until(() => !alive(sh) && ours().length === 0, 2000, 'the setup\'s shell and sleeps to be gone').catch((e) => { for (const q of ours()) try { process.kill(q, 'SIGKILL'); } catch {} throw e; });
    assert.deepEqual(fs.readdirSync(S.slots).filter((e) => /^\d+$/.test(e)), [], 'the slot is released');
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('a chore start cut short at the deadline leaves no marker, so the next chore start in that worktree runs the setup', () => {
  const S = slotFleet('installs-retry', (F) => `echo run >> ${F.base}/retry.log; test -f ${F.base}/retry.fast || sleep 65`);
  const runs = () => { const f = path.join(S.F.base, 'retry.log'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').length : 0; };
  try {
    let r = S.start('one', deadlineIn(2000));
    assert.equal(r.status, 124, r.err);
    assert.equal(runs(), 1);
    fs.writeFileSync(path.join(S.F.base, 'retry.fast'), '');
    r = S.start('one', deadlineIn(20000));
    assert.equal(r.status, 0, r.err);
    assert.equal(runs(), 2, 'the retry in the existing worktree ran the setup');
    r = S.start('one', deadlineIn(20000));
    assert.equal(r.status, 0, r.err);
    assert.equal(runs(), 2, 'once it passed, its marker matches: no setup');
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('4e: SIGTERM to the runner ends the setup\'s whole group', async () => {
  const S = slotFleet('installs-4e', (F) => `echo "$$ $PPID" > ${F.base}/4e.pids; sleep 62 & wait`);
  // only this setup's group: a command line elsewhere on the machine may name sleep 62 too
  let sh = null;
  const ours = () => pgrep('sleep 62').filter((p) => sh && pgidOf(p) === sh);
  try {
    const run = S.startAsync('one', deadlineIn(20000));
    const pids = path.join(S.F.base, '4e.pids');
    const ppid = await until(() => { const t = fs.existsSync(pids) && fs.readFileSync(pids, 'utf8').trim().split(' ').map(Number); if (t?.length === 2) sh = t[0]; return t?.length === 2 && ours().some((p) => p !== sh) && t[1]; }, 10000, 'the setup to start');
    process.kill(ppid, 'SIGTERM');
    await until(() => ours().length === 0, 3000, 'the setup\'s group (sleep 62) to be gone').catch((e) => { for (const p of ours()) try { process.kill(p, 'SIGKILL'); } catch {} throw e; });
    const r = await run;
    assert.notEqual(r.status, 0);
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('4e: SIGINT to a runner waiting for a slot ends chore start and leaves no half-taken slot', async () => {
  const token = `t596-${process.pid}-${Date.now()}`;
  const S = slotFleet('installs-4e2', () => `: ${token}; true`);
  try {
    const p = S.live();
    hold(S.slots, 0, { pid: p.pid, start: startOf(p.pid) });
    const run = S.startAsync('one', { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(20000) });
    const [runner] = await until(() => { const l = pgrep(token); return l.length && l; }, 10000, `a runner whose argv names ${token}`);
    await sleepMs(1000); // its signal handlers are set before it waits
    const t0 = Date.now();
    process.kill(runner, 'SIGINT');
    const r = await run;
    // ended by the signal, not by the deadline 20 s ahead
    assert.ok(Date.now() - t0 < 8000, `chore start ended ${Date.now() - t0} ms after the SIGINT`);
    assert.notEqual(r.status, 0);
    assert.notEqual(r.status, 75, r.stderr);
    assert.doesNotMatch(r.stderr, /setup-slot-wait/);
    assert.deepEqual(fs.readdirSync(S.slots).filter((e) => e.startsWith('.take-')), []);
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});
