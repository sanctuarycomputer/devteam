// Worktree installs (kit-596): a session or chore worktree reuses main's installed folder, skips its
// setup on resume, and runs it through machine-wide slots. Tests here cover the two settings, the
// setup runner and its slots, the marker and the copy, and the docs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { write, json, multiFixture, fleetFixture, hasTmux } from './lib/kit.mjs';

test('the two settings: defaults, a repo link may carry them, and validate types them', () => {
  const F = multiFixture('installs-settings');
  const { old, runIn, okIn } = F;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-home-'));
  const env = { HOME: home };
  try {
    assert.equal(okIn(old, ['settings', '--get', 'worktree_copy'], {}, env), '[]');
    assert.equal(okIn(old, ['settings', '--get', 'worktree_setup_always'], {}, env), 'false');
    const links = json(okIn(old, ['settings'], {}, env)).links;
    const withLink = (extra) => F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { links: { ...links, console: { ...links.console, ...extra } } });
    withLink({ worktree_copy: [{ path: 'node_modules', key: 'package-lock.json' }], worktree_setup_always: true });
    const good = runIn(old, ['validate'], {}, env);
    assert.equal(good.status, 0, good.err || good.out);
    withLink({ worktree_setup_always: 'yes' });
    const bad = runIn(old, ['validate'], {}, env);
    assert.notEqual(bad.status, 0);
    assert.match(`${bad.out}\n${bad.err}`, /worktree_setup_always is true or false/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); F.done(); }
});

// ---- DW4: the setup runner and the machine-wide slots, through `chore start` (and 2g) ----

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const SETTINGS = 'docs/devteam/project/settings.md';
const NOWHERE = path.join(os.tmpdir(), 'dt-no-such-machine-kit-596');
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
// a process that exited but is not yet reaped is a zombie: not alive
const alive = (pid) => { try { process.kill(pid, 0); } catch { return false; } return !/Z/.test(spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout ?? ''); };
// the pids (not zombies) whose command line matches pat
const pgrep = (pat) => (spawnSync('pgrep', ['-f', pat], { encoding: 'utf8' }).stdout ?? '').split('\n').filter(Boolean).map(Number).filter(alive);
const pgidOf = (pid) => Number((spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).stdout ?? '').trim()) || null;
// a process's start time as the kit reads it: field 22 of /proc/<pid>/stat, or ps lstart off Linux
function startOf(pid) {
  try { const t = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return t.slice(t.lastIndexOf(')') + 2).split(' ')[19]; } catch {}
  return (spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).stdout ?? '').trim() || null;
}
// written temp-then-rename, as the runner writes its own
function hold(dir, n, h) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.test-${process.pid}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmp);
  fs.writeFileSync(path.join(tmp, 'holder.json'), JSON.stringify({ id: `test-${Math.random().toString(36).slice(2)}`, at: new Date().toISOString(), ...h }));
  fs.renameSync(tmp, path.join(dir, String(n)));
}
function rewriteHolder(dir, n, fn) {
  const f = path.join(dir, String(n), 'holder.json');
  const h = fn(JSON.parse(fs.readFileSync(f, 'utf8')));
  fs.writeFileSync(`${f}.test-tmp`, JSON.stringify(h));
  fs.renameSync(`${f}.test-tmp`, f);
}
const readHolder = (dir, n) => { try { return JSON.parse(fs.readFileSync(path.join(dir, String(n), 'holder.json'), 'utf8')); } catch { return null; } };
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}`); await sleepMs(50); }
}
// The kit run as its own process (execFile), resolving { status, stdout, stderr, pid }.
function runAsync(F, args, role) {
  return new Promise((resolve) => {
    const c = execFile(process.execPath, [path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: F.old, env: F.env(role), maxBuffer: 1 << 26 }, (err, stdout, stderr) => resolve({ status: err ? (typeof err.code === 'number' ? err.code : null) : 0, stdout, stderr, pid: c.pid }));
  });
}
// A fleet whose committed worktree_setup is setup(F) (it may name files under F.base), with its own
// HOME, so ~/.devteam/setup-slots is this test's alone.
function slotFleet(name, setup) {
  const F = fleetFixture(name);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-home-'));
  const f = path.join(F.old, SETTINGS);
  const txt = fs.readFileSync(f, 'utf8');
  const m = txt.match(/```json devteam\s*\n([\s\S]*?)\n```/);
  const j = JSON.parse(m[1]);
  j.worktree_setup = setup(F);
  fs.writeFileSync(f, txt.replace(m[1], () => JSON.stringify(j, null, 2)));
  F.g(['commit', '-qam', 'worktree_setup'], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
  const slots = path.join(home, '.devteam', 'setup-slots');
  const role = (extra = {}) => ({ ...SUP, HOME: home, DEVTEAM_CGROUP: NOWHERE, DEVTEAM_MEMINFO: NOWHERE, ...extra });
  const start = (slug, extra) => F.run(F.old, ['chore', 'start', slug], role(extra));
  const startAsync = (slug, extra) => runAsync(F, ['chore', 'start', slug], role(extra));
  const wt = (slug) => path.join(F.old, '.worktrees', `chore-${slug}`);
  const kids = [];
  // a live process of the test's own (a slot's holder), killed at the end
  const live = (opts = {}) => { const p = spawn('sleep', ['30'], { stdio: 'ignore', ...opts }); kids.push(p); return p; };
  // 4j: no runner leaves a slot folder (or a half-taken or half-freed one); the test's own holders are
  // its to remove. Checked only when the test's body passed, so its own failure is the one reported.
  const finish = () => {
    try {
      if (!S.failed && fs.existsSync(slots)) {
        const left = fs.readdirSync(slots).filter((e) => /^\.(take|free)-/.test(e) || (/^\d+$/.test(e) && !String(readHolder(slots, e)?.id ?? '').startsWith('test-')));
        assert.deepEqual(left, [], `setup-slots holds ${left.join(', ')}: ${left.map((e) => JSON.stringify(readHolder(slots, e))).join(' ')}`);
      }
    } finally {
      for (const p of kids) try { p.kill('SIGKILL'); } catch {}
      fs.rmSync(home, { recursive: true, force: true });
      F.done();
    }
  };
  const S = { F, home, slots, role, start, startAsync, wt, live, finish, failed: null };
  return S;
}
const deadlineIn = (ms) => ({ DEVTEAM_SETUP_DEADLINE: String(Date.now() + ms) });
const clock = '$(node -e "process.stdout.write(String(Date.now()))")';

test('4a: the setup leads its own process group under a node runner, and a long stdout leaves the report whole', async () => {
  const S = slotFleet('installs-4a', (F) => `echo "$$ $(ps -o pgid= -p $$ | tr -d ' ') $PPID $(ps -o ppid= -p $PPID | tr -d ' ') $(ps -o comm= -p $PPID)" > ${F.base}/4a.txt; awk 'BEGIN { for (i = 0; i < 2048; i++) printf "%0100d\\n", i }'`);
  try {
    const r = await S.startAsync('one');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.length > 200000, 'the setup\'s stdout comes through');
    const [sh, pgid, ppid, gp, comm] = fs.readFileSync(path.join(S.F.base, '4a.txt'), 'utf8').trim().split(/\s+/);
    assert.equal(pgid, sh, 'the setup\'s shell leads its own group');
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

test('4f: a slot whose holder is dead with no live group is freed at once', () => {
  const S = slotFleet('installs-4f', () => 'true');
  try {
    const dead = spawnSync('true').pid;
    hold(S.slots, 0, { pid: dead, start: '1' });
    const r = S.start('one', { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(20000) });
    assert.equal(r.status, 0, r.err);
    assert.doesNotMatch(r.err, /waiting for a setup slot/, 'freed at once, with no wait for a slot');
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('4f\': a slot folder whose holder.json is empty or not JSON, a minute old, is freed at once', () => {
  const S = slotFleet('installs-4f2', () => 'true');
  try {
    for (const [slug, text] of [['empty', ''], ['garbled', 'not json']]) {
      fs.mkdirSync(path.join(S.slots, '0'), { recursive: true });
      fs.writeFileSync(path.join(S.slots, '0', 'holder.json'), text);
      const old = new Date(Date.now() - 60000);
      fs.utimesSync(path.join(S.slots, '0'), old, old);
      const r = S.start(slug, { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(20000) });
      assert.equal(r.status, 0, `${slug}: ${r.err}`);
      assert.doesNotMatch(r.err, /waiting for a setup slot/, 'freed at once, with no wait for a slot');
      assert.equal(fs.existsSync(path.join(S.slots, '0')), false);
    }
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('4g: a slot whose holder pid is alive with another start time (a reused pid) is freed at once', () => {
  const S = slotFleet('installs-4g', () => 'true');
  try {
    const p = S.live();
    hold(S.slots, 0, { pid: p.pid, start: 'not-its-start' });
    const r = S.start('one', { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(20000) });
    assert.equal(r.status, 0, r.err);
    assert.doesNotMatch(r.err, /waiting for a setup slot/, 'freed at once, with no wait for a slot');
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('4g\': a dead runner whose group lives holds its slot only while the group leader\'s start time matches', () => {
  const S = slotFleet('installs-4g2', () => 'true');
  try {
    const dead = spawnSync('true').pid;
    const g = S.live({ detached: true });
    hold(S.slots, 0, { pid: dead, start: '1', pgid: g.pid, leader_start: 'not-its-start' });
    const freed = S.start('one', { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(20000) });
    assert.equal(freed.status, 0, freed.err);
    assert.doesNotMatch(freed.err, /waiting for a setup slot/, 'freed at once, with no wait for a slot');
    hold(S.slots, 0, { pid: dead, start: '1', pgid: g.pid, leader_start: startOf(g.pid) });
    const held = S.start('two', { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(2000) });
    assert.equal(held.status, 75, held.err);
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('4h: a slot held past 15 minutes is taken over, warned and logged', () => {
  const S = slotFleet('installs-4h', () => 'true');
  try {
    const p = S.live();
    const at = new Date(Date.now() - 16 * 60000).toISOString();
    hold(S.slots, 0, { pid: p.pid, start: startOf(p.pid), at });
    const r = S.start('one', { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(20000) });
    assert.equal(r.status, 0, r.err);
    assert.doesNotMatch(r.err, /waiting for a setup slot/, 'freed at once, with no wait for a slot');
    assert.match(r.err, new RegExp(`took over setup slot 0, held since ${at.replace(/\./g, '\\.')} by pid ${p.pid}`));
    const logDir = path.join(S.F.old, 'docs/devteam/run/log');
    const obs = fs.readdirSync(logDir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).filter((o) => o.type === 'observation' && o.kind === 'setup-slot-taken-over');
    assert.equal(obs.length, 1, 'one setup-slot-taken-over observation');
    assert.equal(obs[0].source, 'kit');
    assert.equal(obs[0].subject, 'setup-slot-0');
    assert.match(obs[0].detail, new RegExp(`${p.pid}`));
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('4h\': a runner whose slot was taken over leaves the taker\'s slot alone', async () => {
  // A sleeps 3 s, B (the taker) 5 s, C 1 s
  const S = slotFleet('installs-4h2', (F) => `n=$(basename "$PWD"); echo "start ${clock}" >> ${F.base}/4h-$n.txt; case $n in chore-a) sleep 3;; chore-b) sleep 5;; *) sleep 1;; esac; echo "end ${clock}" >> ${F.base}/4h-$n.txt`);
  const times = (s) => Object.fromEntries(fs.readFileSync(path.join(S.F.base, `4h-chore-${s}.txt`), 'utf8').trim().split('\n').map((l) => l.split(' ')).map(([k, v]) => [k, Number(v)]));
  try {
    const env = () => ({ DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(20000) });
    const runA = S.startAsync('a', env());
    await until(() => fs.existsSync(path.join(S.F.base, '4h-chore-a.txt')), 10000, 'setup A to start');
    const idA = readHolder(S.slots, 0)?.id;
    assert.ok(idA, 'A holds slot 0');
    rewriteHolder(S.slots, 0, (h) => ({ ...h, at: new Date(Date.now() - 16 * 60000).toISOString() }));
    const runB = S.startAsync('b', env());
    const idB = await until(() => { const id = readHolder(S.slots, 0)?.id; return id && id !== idA && id; }, 10000, 'B to take over slot 0');
    const a = await runA;
    assert.equal(a.status, 0, a.stderr);
    assert.equal(readHolder(S.slots, 0)?.id, idB, 'A\'s release left B\'s slot alone');
    const c = await S.startAsync('c', env());
    const b = await runB;
    assert.equal(b.status, 0, b.stderr);
    assert.equal(c.status, 0, c.stderr);
    assert.match(b.stderr, /took over setup slot 0/);
    assert.ok(times('c').start >= times('b').end, `C started at ${times('c').start}, before B ended at ${times('b').end}`);
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('4i: DEVTEAM_SETUP_SLOTS outside 1-8 warns naming the value and gives two slots', async () => {
  const S = slotFleet('installs-4i', (F) => `echo "start ${clock}" >> ${F.base}/4i-$(basename "$PWD").txt; sleep 2; echo "end ${clock}" >> ${F.base}/4i-$(basename "$PWD").txt`);
  const iv = (s) => { const t = Object.fromEntries(fs.readFileSync(path.join(S.F.base, `4i-chore-${s}.txt`), 'utf8').trim().split('\n').map((l) => l.split(' ')).map(([k, v]) => [k, Number(v)])); return [t.start, t.end]; };
  try {
    for (const v of ['0', '9', 'x']) {
      const env = { DEVTEAM_SETUP_SLOTS: v, ...deadlineIn(20000) };
      const rs = await Promise.all([S.startAsync(`${v}-a`, env), S.startAsync(`${v}-b`, env)]);
      for (const r of rs) {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stderr, new RegExp(`DEVTEAM_SETUP_SLOTS "${v}"`));
      }
      const [[s1, e1], [s2, e2]] = [iv(`${v}-a`), iv(`${v}-b`)];
      assert.ok(s1 < e2 && s2 < e1, `${v}: the two setups ran one after the other (a ${s1}-${e1}, b ${s2}-${e2})`);
    }
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('a slots folder that can\'t be written to stops no install: warned, run without a slot', { skip: process.getuid?.() === 0 && 'root writes through a read-only folder' }, () => {
  const S = slotFleet('installs-ro', (F) => `touch ${F.base}/ro.ran`);
  try {
    fs.mkdirSync(S.slots, { recursive: true });
    fs.chmodSync(S.slots, 0o555);
    const t0 = Date.now();
    const r = S.start('one', { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(20000) });
    assert.equal(r.status, 0, r.err);
    assert.ok(Date.now() - t0 < 15000, `took ${Date.now() - t0} ms`);
    assert.match(r.err, /no usable setup slots folder .*running worktree_setup without a slot/);
    assert.doesNotMatch(r.err, /waiting for a setup slot/);
    assert.ok(fs.existsSync(path.join(S.F.base, 'ro.ran')), 'the setup ran');
  } catch (e) { S.failed = e; throw e; } finally { try { fs.chmodSync(S.slots, 0o755); } catch {} S.finish(); }
});

test('2g: a setup that itself exits 75 or 124 is an ordinary failure (exit 1)', () => {
  const S = slotFleet('installs-2g', (F) => `exit "$(cat ${F.base}/2g.code)"`);
  try {
    for (const code of ['75', '124']) {
      fs.writeFileSync(path.join(S.F.base, '2g.code'), code);
      const r = S.start(`exit-${code}`);
      assert.equal(r.status, 1, `${code}: ${r.err}`);
      assert.match(r.err, /worktree_setup failed in /);
    }
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

// ---- DW1, DW2, DW3: the copy (worktree_copy), the marker (skip on resume), gate checkouts ----

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
// A fleet whose main has lockfiles (one at the root, one a folder down, one two down), a copy key on
// no lockfile list, and gitignored installed folders main holds (node_modules, vendor, and one whose
// name has a space); its committed settings are patched with patch(F), and it has its own HOME.
function installFleet(name, patch) {
  const F = fleetFixture(name);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-home-'));
  const o = F.old;
  write(path.join(o, 'package-lock.json'), '{"lockfileVersion": 3}\n');
  write(path.join(o, '.deps-key'), 'deps 1\n');
  write(path.join(o, 'sub/yarn.lock'), '# yarn 1\n');
  write(path.join(o, 'a/b/yarn.lock'), '# yarn deep\n');
  write(path.join(o, '.gitignore'), `${fs.readFileSync(path.join(o, '.gitignore'), 'utf8')}node_modules/\nvendor/\nnode modules x/\n`);
  write(path.join(o, 'node_modules/marker.txt'), 'main\n');
  write(path.join(o, 'vendor/v.txt'), 'vendor\n');
  write(path.join(o, 'node modules x/x.txt'), 'x\n');
  const settings = (fn, msg) => {
    const f = path.join(o, SETTINGS);
    const txt = fs.readFileSync(f, 'utf8');
    const m = txt.match(/```json devteam\s*\n([\s\S]*?)\n```/);
    const j = JSON.parse(m[1]);
    fn(j);
    fs.writeFileSync(f, txt.replace(m[1], () => JSON.stringify(j, null, 2)));
    F.g(['add', '-A'], o);
    F.g(['commit', '-qm', msg], o);
    F.g(['push', '-q', 'origin', 'main'], o);
  };
  settings((j) => Object.assign(j, patch(F)), 'installs');
  const role = (extra = {}) => ({ ...SUP, HOME: home, DEVTEAM_CGROUP: NOWHERE, DEVTEAM_MEMINFO: NOWHERE, ...deadlineIn(30000), ...extra });
  const ticket = (id) => F.ok(o, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: [`ch/${id}/**`], done_when: ['the tidy check passes in CI'] })], SUP);
  const wt = (n) => path.join(o, '.worktrees', n);
  // the session's window closed (its tmux server is the fixture's own), then a resume
  const resume = (id, extra) => {
    const session = fs.readFileSync(path.join(o, 'docs/devteam/run/tmux-session'), 'utf8').trim();
    spawnSync('tmux', ['kill-window', '-t', `=${session}:${id}`], { env: F.env({}), stdio: 'ignore' });
    return F.run(o, ['worker', id, '--resume'], role(extra));
  };
  // the setups' records: one line per run, "<worktree> <what it saw>"
  const runs = (n) => { const f = path.join(F.base, 'runs.log'); return (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '').split('\n').filter(Boolean).map((l) => l.split(' ')).filter(([w]) => w === n).map(([, v]) => v ?? ''); };
  const marker = (w) => { const f = path.join(spawnSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: w, encoding: 'utf8' }).stdout.trim(), 'devteam-setup'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
  const finish = () => { fs.rmSync(home, { recursive: true, force: true }); F.done(); };
  return { F, home, role, settings, ticket, wt, resume, runs, marker, finish };
}
const RECORD = (F) => `echo "$(basename "$PWD") $(test -f node_modules/marker.txt && echo had || echo none)" >> ${F.base}/runs.log`;
const COPY = [{ path: 'node_modules', key: 'package-lock.json' }, { path: 'vendor', key: '.deps-key' }, { path: 'node modules x', key: '.deps-key' }];

test('1a-1d, 2a, 2a\', 2b: a new worktree gets main\'s installed folders when its key matches, and a resume skips a setup that passed', { skip: !hasTmux && 'no tmux' }, () => {
  const I = installFleet('installs-copy', (F) => ({ worktree_setup: RECORD(F), worktree_copy: COPY }));
  const { F } = I;
  try {
    I.ticket('ch-01-a');
    I.ticket('ch-02-b');
    // 1a: worker <id>, a new session worktree: copied before the setup ran
    const w = I.wt('ch-01-a');
    let r = F.run(F.old, ['worker', 'ch-01-a'], I.role());
    assert.equal(r.status, 0, r.err);
    assert.deepEqual(I.runs('ch-01-a'), ['had'], 'the setup saw the copied node_modules');
    assert.equal(fs.readFileSync(path.join(w, 'node_modules/marker.txt'), 'utf8'), 'main\n');
    assert.equal(fs.readFileSync(path.join(w, 'vendor/v.txt'), 'utf8'), 'vendor\n');
    assert.equal(fs.readFileSync(path.join(w, 'node modules x/x.txt'), 'utf8'), 'x\n', 'a path with a space is copied too');
    assert.deepEqual(fs.readdirSync(w).filter((e) => e.includes('.devteam-copy-')), [], 'no temp folder left');
    // 1c: a copy, never a link: a write into the worktree's leaves main's alone
    const mainFile = path.join(F.old, 'node_modules/marker.txt');
    assert.notEqual(fs.statSync(path.join(w, 'node_modules/marker.txt')).ino, fs.statSync(mainFile).ino);
    assert.equal(fs.lstatSync(path.join(w, 'node_modules')).isSymbolicLink(), false);
    fs.writeFileSync(path.join(w, 'node_modules/marker.txt'), 'changed in the worktree\n');
    assert.equal(fs.readFileSync(mainFile, 'utf8'), 'main\n');
    // 2a: the marker, in the worktree's own git dir, outside the tree
    const m = I.marker(w);
    assert.ok(m, 'a marker after a passing setup');
    assert.equal(m.v, 1);
    assert.equal(m.setup, sha(RECORD(F)));
    assert.deepEqual(m.files, {
      '.deps-key': sha(fs.readFileSync(path.join(w, '.deps-key'))),
      'package-lock.json': sha(fs.readFileSync(path.join(w, 'package-lock.json'))),
      'sub/yarn.lock': sha(fs.readFileSync(path.join(w, 'sub/yarn.lock'))),
    });
    assert.equal(F.g(['status', '--porcelain'], w), '', 'nothing new in the worktree');
    // 2b: a resume after the window closed runs no setup
    r = I.resume('ch-01-a');
    assert.equal(r.status, 0, r.err);
    assert.equal(I.runs('ch-01-a').length, 1, 'no setup on a matching resume');
    // 2a': a copy key changed in the worktree: the resume runs it again, and the copy (there already) is left as it is
    fs.writeFileSync(path.join(w, '.deps-key'), 'deps 2\n');
    // stale temp copies a killed seed left are swept whenever the entry is looked at, even one that
    // copies nothing now (its folder is there, its key differs); a live pid's is left alone
    const dead = spawnSync('true').pid;
    for (const x of [`node_modules.devteam-copy-${dead}`, `vendor.devteam-copy-${dead}`, `vendor.devteam-copy-${process.pid}`]) write(path.join(w, x, 'half.txt'), 'half\n');
    r = I.resume('ch-01-a');
    assert.equal(r.status, 0, r.err);
    assert.equal(I.runs('ch-01-a').length, 2, 'a changed copy key runs the setup again');
    assert.deepEqual(fs.readdirSync(w).filter((e) => e.includes('.devteam-copy-')), [`vendor.devteam-copy-${process.pid}`], 'the dead pids\' temp copies are swept, the live one\'s kept');
    fs.rmSync(path.join(w, `vendor.devteam-copy-${process.pid}`), { recursive: true, force: true });
    assert.equal(fs.readFileSync(path.join(w, 'node_modules/marker.txt'), 'utf8'), 'changed in the worktree\n', 'a resume never overwrites the worktree\'s own install');
    assert.equal(I.marker(w).files['.deps-key'], sha('deps 2\n'));
    // 1d: a ticket branch whose package-lock.json differs from main's gets no node_modules
    const tmp = path.join(F.base, 'branch-b');
    F.g(['worktree', 'add', '-q', '-b', 'ticket/ch-02-b', tmp, 'origin/main'], F.old);
    fs.writeFileSync(path.join(tmp, 'package-lock.json'), '{"lockfileVersion": 3, "changed": true}\n');
    F.g(['commit', '-qam', 'a new lockfile'], tmp);
    F.g(['push', '-q', 'origin', 'ticket/ch-02-b'], tmp);
    F.g(['worktree', 'remove', '--force', tmp], F.old);
    F.g(['branch', '-q', '-D', 'ticket/ch-02-b'], F.old);
    r = F.run(F.old, ['worker', 'ch-02-b'], I.role());
    assert.equal(r.status, 0, r.err);
    assert.match(fs.readFileSync(path.join(I.wt('ch-02-b'), 'package-lock.json'), 'utf8'), /changed/, 'the worktree continues from origin\'s branch');
    assert.equal(fs.existsSync(path.join(I.wt('ch-02-b'), 'node_modules')), false, 'no copy: the key differs');
    assert.deepEqual(I.runs('ch-02-b'), ['none']);
    assert.ok(fs.existsSync(path.join(I.wt('ch-02-b'), 'vendor/v.txt')), 'an entry whose key matches is still copied');
    // 1b: chore start, a new chore worktree
    r = F.run(F.old, ['chore', 'start', 'one'], I.role());
    assert.equal(r.status, 0, r.err);
    assert.deepEqual(I.runs('chore-one'), ['had']);
    assert.ok(I.marker(I.wt('chore-one')), 'a chore worktree gets its marker too');
  } finally { I.finish(); }
});

test('2c-2f: a resume runs the setup again when a lockfile, the setup string or worktree_setup_always says so, or the last one failed', { skip: !hasTmux && 'no tmux' }, () => {
  const setup = (F, tag = '') => `${tag}echo "$(basename "$PWD")" >> ${F.base}/runs.log; exit "$(cat ${F.base}/code 2>/dev/null || echo 0)"`;
  const I = installFleet('installs-marker', (F) => ({ worktree_setup: setup(F) }));
  const { F } = I;
  const n = () => I.runs('ch-01-a').length;
  try {
    I.ticket('ch-01-a');
    const w = I.wt('ch-01-a');
    let r = F.run(F.old, ['worker', 'ch-01-a'], I.role());
    assert.equal(r.status, 0, r.err);
    assert.equal(n(), 1);
    assert.equal(fs.existsSync(path.join(w, 'node_modules')), false, 'no worktree_copy, no copy');
    assert.ok(I.marker(w));
    assert.equal(I.resume('ch-01-a').status, 0);
    assert.equal(n(), 1, 'a matching resume skips it');
    // 2c: a lockfile changed in the worktree (worktree_copy unset)
    fs.writeFileSync(path.join(w, 'package-lock.json'), '{"lockfileVersion": 3, "local": 1}\n');
    assert.equal(I.resume('ch-01-a').status, 0);
    assert.equal(n(), 2, 'a changed lockfile runs it again');
    // 2d: the setup string changed, committed on main
    I.settings((j) => { j.worktree_setup = setup(F, ': v2; '); }, 'a new setup');
    assert.equal(I.resume('ch-01-a').status, 0);
    assert.equal(n(), 3, 'a changed setup string runs it again');
    assert.equal(I.marker(w).setup, sha(setup(F, ': v2; ')));
    assert.equal(I.resume('ch-01-a').status, 0);
    assert.equal(n(), 3);
    // 2e: worktree_setup_always runs it on every resume
    I.settings((j) => { j.worktree_setup_always = true; }, 'always');
    assert.equal(I.resume('ch-01-a').status, 0);
    assert.equal(I.resume('ch-01-a').status, 0);
    assert.equal(n(), 5, 'worktree_setup_always runs it each time');
    I.settings((j) => { j.worktree_setup_always = false; }, 'not always');
    assert.equal(I.resume('ch-01-a').status, 0);
    assert.equal(n(), 5);
    // 2f: a failing setup leaves no marker, and the next resume runs it again
    fs.writeFileSync(path.join(w, 'package-lock.json'), '{"lockfileVersion": 3, "local": 2}\n');
    fs.writeFileSync(path.join(F.base, 'code'), '1');
    r = I.resume('ch-01-a');
    assert.equal(r.status, 1, r.err);
    assert.match(r.err, /worktree_setup failed in /);
    assert.equal(n(), 6);
    assert.equal(I.marker(w), null, 'no marker after a failed setup');
    fs.writeFileSync(path.join(F.base, 'code'), '0');
    r = I.resume('ch-01-a');
    assert.equal(r.status, 0, r.err);
    assert.equal(n(), 7, 'the resume after a failure runs it again');
    assert.ok(I.marker(w));
  } finally { I.finish(); }
});

test('the copy refuses what it must: invalid entries, worktree_files, a symlinked main folder; a nested path; cut short at the deadline', () => {
  const ENTRIES = [
    { path: 'node_modules', key: 'package-lock.json' },
    { path: '/abs/folder', key: 'package-lock.json' },
    { path: '../up', key: 'package-lock.json' },
    { path: 'vendor', key: '../package-lock.json' },
    'not an object',
    { path: 'config', key: '.deps-key' },
    { path: 'build/deps', key: '.deps-key' },
  ];
  const I = installFleet('installs-refuse', (F) => ({ worktree_copy: ENTRIES, worktree_setup: `${RECORD(F)}; mkdir -p node_modules; echo worktree > node_modules/w.txt` }));
  const { F } = I;
  try {
    write(path.join(F.old, 'config/extra.txt'), 'gitignored, beside the worktree_files key\n');
    write(path.join(F.old, 'build/deps/d.txt'), 'deps\n');
    write(path.join(F.old, '.gitignore'), `${fs.readFileSync(path.join(F.old, '.gitignore'), 'utf8')}config/extra.txt\nbuild/\n`);
    F.g(['commit', '-qam', 'ignores'], F.old);
    F.g(['push', '-q', 'origin', 'main'], F.old);
    // invalid entries and a worktree_files overlap are warned and skipped; the rest copy, a nested
    // path whose parent the worktree lacks among them
    let r = F.run(F.old, ['chore', 'start', 'a'], I.role());
    assert.equal(r.status, 0, r.err);
    for (const bad of ['/abs/folder', '../up', '../package-lock.json', 'not an object']) assert.ok(r.err.includes(`worktree_copy: ${JSON.stringify(ENTRIES.find((e) => JSON.stringify(e).includes(JSON.stringify(bad))))} is not`), `${bad} warned: ${r.err}`);
    assert.match(r.err, /worktree_copy: config is or holds a worktree_files entry/);
    const wa = I.wt('chore-a');
    assert.equal(fs.existsSync(path.join(wa, 'config/extra.txt')), false, 'a worktree_files folder is never copied');
    assert.equal(fs.readFileSync(path.join(wa, 'config/dev.key'), 'utf8'), 'not a real key\n', 'worktree_files still copied');
    assert.equal(fs.readFileSync(path.join(wa, 'build/deps/d.txt'), 'utf8'), 'deps\n', 'a path whose parent the worktree lacks is copied');
    assert.deepEqual(I.runs('chore-a'), ['had']);
    assert.doesNotMatch(r.err, /could not copy/);
    // cut short at the deadline: a cp that never finishes is killed, its temp removed, no folder left
    const shims = fs.mkdtempSync(path.join(F.base, 'shims-'));
    fs.writeFileSync(path.join(shims, 'cp'), '#!/bin/sh\nfor a; do last="$a"; done; mkdir -p "$last"; exec sleep 63\n', { mode: 0o755 });
    const t0 = Date.now();
    r = F.run(F.old, ['chore', 'start', 'b'], I.role({ PATH: `${shims}${path.delimiter}${process.env.PATH}`, ...deadlineIn(2000) }));
    assert.ok(Date.now() - t0 < 10000, `took ${Date.now() - t0} ms`);
    assert.match(r.err, /worktree_copy: could not copy node_modules .*cut short at the deadline/);
    assert.equal(r.status, 124, r.err);
    const wb = I.wt('chore-b');
    assert.equal(fs.existsSync(path.join(wb, 'node_modules/marker.txt')), false, 'no copy');
    assert.deepEqual(fs.readdirSync(wb).filter((e) => e.includes('.devteam-copy-')), [], 'no temp copy left');
    assert.deepEqual(pgrep('sleep 63'), [], 'the cut-short cp is gone');
    // main's folder a symlink (to a shared store): never copied, so the setup can't write through it
    const store = path.join(F.base, 'store');
    fs.renameSync(path.join(F.old, 'node_modules'), store);
    fs.symlinkSync(store, path.join(F.old, 'node_modules'));
    r = F.run(F.old, ['chore', 'start', 'c'], I.role());
    assert.equal(r.status, 0, r.err);
    assert.match(r.err, /worktree_copy: node_modules not copied: .* is a symlink/);
    const wc = I.wt('chore-c');
    assert.deepEqual(I.runs('chore-c'), ['none']);
    assert.equal(fs.lstatSync(path.join(wc, 'node_modules')).isSymbolicLink(), false);
    assert.equal(fs.existsSync(path.join(store, 'w.txt')), false, 'the setup wrote nothing into main\'s store');
    assert.deepEqual(fs.readdirSync(store), ['marker.txt']);
  } finally { I.finish(); }
});

test('3a: a gate checkout (merge --chore\'s landing one) runs its setup inline: no slot, no runner, no copy', async () => {
  const I = installFleet('installs-gate', (F) => ({ worktree_copy: COPY, worktree_setup: `echo "$PWD $(ps -o pgid= -p $$ | tr -d ' ') $$ nm=$(ls node_modules 2>/dev/null | tr '\\n' ,) mk=$(test -f "$(git rev-parse --absolute-git-dir)/devteam-setup" && echo yes || echo no)" >> ${F.base}/gate.log` }));
  const { F } = I;
  const kids = [];
  try {
    // the chore branch, made with git and pushed with its PR text (chore start would take a slot)
    const slug = 'tidy';
    const c = path.join(F.old, '.worktrees', `chore-${slug}`);
    F.g(['worktree', 'add', '-q', '-b', `chore-${slug}`, c, 'origin/main'], F.old);
    write(path.join(c, 'docs/devteam/project/tidy.md'), '# Tidy\n');
    F.g(['add', '-A'], c);
    F.g(['commit', '-qm', slug], c);
    F.g(['push', '-q', 'origin', `chore-${slug}`], c);
    F.g(['worktree', 'remove', '--force', c], F.old);
    write(path.join(F.old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: x\n\n## One-way doors\n\nNone.\n`);
    // the one slot held by a live process
    const p = spawn('sleep', ['30'], { stdio: 'ignore' });
    kids.push(p);
    hold(path.join(I.home, '.devteam', 'setup-slots'), 0, { pid: p.pid, start: startOf(p.pid) });
    const t0 = Date.now();
    const r = await runAsync(F, ['merge', '--chore', slug], I.role({ DEVTEAM_SETUP_SLOTS: '1' }));
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.ok(Date.now() - t0 < 60000, `merge took ${Date.now() - t0} ms`);
    assert.doesNotMatch(r.stderr, /waiting for a setup slot/);
    const lines = fs.readFileSync(path.join(F.base, 'gate.log'), 'utf8').split('\n').filter(Boolean).map((l) => l.split(' '));
    const land = lines.filter(([wt]) => /[\\/]tmp-land-/.test(wt));
    assert.ok(land.length, `a setup ran in the landing checkout: ${JSON.stringify(lines)}`);
    for (const [wt, pgid, pid, nm, mk] of land) {
      assert.notEqual(pgid, pid, `${wt}: the setup's shell leads no group of its own (no runner)`);
      assert.equal(nm, 'nm=', `${wt}: no copied node_modules`);
      assert.equal(mk, 'mk=no', `${wt}: no marker`);
    }
  } finally { for (const p of kids) try { p.kill('SIGKILL'); } catch {} I.finish(); }
});
