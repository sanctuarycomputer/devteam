// Worktree installs (kit-596): a session or chore worktree reuses main's installed folder, skips its
// setup on resume, and runs it through machine-wide slots. Tests here cover the two settings, the
// setup runner and its slots, the marker and the copy, and the docs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { write, json, multiFixture, fleetFixture } from './lib/kit.mjs';

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
  // 4j: no runner leaves a slot folder (or a half-taken one); the test's own holders are its to remove
  const finish = () => {
    try {
      if (fs.existsSync(slots)) {
        const left = fs.readdirSync(slots).filter((e) => e.startsWith('.take-') || (/^\d+$/.test(e) && !String(readHolder(slots, e)?.id ?? '').startsWith('test-')));
        assert.deepEqual(left, [], `setup-slots holds ${left.join(', ')}: ${left.map((e) => JSON.stringify(readHolder(slots, e))).join(' ')}`);
      }
    } finally {
      for (const p of kids) try { p.kill('SIGKILL'); } catch {}
      fs.rmSync(home, { recursive: true, force: true });
      F.done();
    }
  };
  return { F, home, slots, role, start, startAsync, wt, live, finish };
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
  } finally { S.finish(); }
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
  } finally { S.finish(); }
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
  } finally { S.finish(); }
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
  } finally { S.finish(); }
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
  } finally { S.finish(); }
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
    process.kill(runner, 'SIGINT');
    const r = await run;
    assert.notEqual(r.status, 0);
    assert.deepEqual(fs.readdirSync(S.slots).filter((e) => e.startsWith('.take-')), []);
  } finally { S.finish(); }
});

test('4f: a slot whose holder is dead with no live group is freed at once', () => {
  const S = slotFleet('installs-4f', () => 'true');
  try {
    const dead = spawnSync('true').pid;
    hold(S.slots, 0, { pid: dead, start: '1' });
    const r = S.start('one', { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(3000) });
    assert.equal(r.status, 0, r.err);
  } finally { S.finish(); }
});

test('4f\': a slot folder whose holder.json is empty or not JSON, a minute old, is freed at once', () => {
  const S = slotFleet('installs-4f2', () => 'true');
  try {
    for (const [slug, text] of [['empty', ''], ['garbled', 'not json']]) {
      fs.mkdirSync(path.join(S.slots, '0'), { recursive: true });
      fs.writeFileSync(path.join(S.slots, '0', 'holder.json'), text);
      const old = new Date(Date.now() - 60000);
      fs.utimesSync(path.join(S.slots, '0'), old, old);
      const r = S.start(slug, { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(3000) });
      assert.equal(r.status, 0, `${slug}: ${r.err}`);
      assert.equal(fs.existsSync(path.join(S.slots, '0')), false);
    }
  } finally { S.finish(); }
});

test('4g: a slot whose holder pid is alive with another start time (a reused pid) is freed at once', () => {
  const S = slotFleet('installs-4g', () => 'true');
  try {
    const p = S.live();
    hold(S.slots, 0, { pid: p.pid, start: 'not-its-start' });
    const r = S.start('one', { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(3000) });
    assert.equal(r.status, 0, r.err);
  } finally { S.finish(); }
});

test('4g\': a dead runner whose group lives holds its slot only while the group leader\'s start time matches', () => {
  const S = slotFleet('installs-4g2', () => 'true');
  try {
    const dead = spawnSync('true').pid;
    const g = S.live({ detached: true });
    hold(S.slots, 0, { pid: dead, start: '1', pgid: g.pid, leader_start: 'not-its-start' });
    const freed = S.start('one', { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(3000) });
    assert.equal(freed.status, 0, freed.err);
    hold(S.slots, 0, { pid: dead, start: '1', pgid: g.pid, leader_start: startOf(g.pid) });
    const held = S.start('two', { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(2000) });
    assert.equal(held.status, 75, held.err);
  } finally { S.finish(); }
});

test('4h: a slot held past 15 minutes is taken over, warned and logged', () => {
  const S = slotFleet('installs-4h', () => 'true');
  try {
    const p = S.live();
    const at = new Date(Date.now() - 16 * 60000).toISOString();
    hold(S.slots, 0, { pid: p.pid, start: startOf(p.pid), at });
    const r = S.start('one', { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(3000) });
    assert.equal(r.status, 0, r.err);
    assert.match(r.err, new RegExp(`took over setup slot 0, held since ${at.replace(/\./g, '\\.')} by pid ${p.pid}`));
    const logDir = path.join(S.F.old, 'docs/devteam/run/log');
    const obs = fs.readdirSync(logDir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).filter((o) => o.type === 'observation' && o.kind === 'setup-slot-taken-over');
    assert.equal(obs.length, 1, 'one setup-slot-taken-over observation');
    assert.equal(obs[0].source, 'kit');
    assert.equal(obs[0].subject, 'setup-slot-0');
    assert.match(obs[0].detail, new RegExp(`${p.pid}`));
  } finally { S.finish(); }
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
  } finally { S.finish(); }
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
  } finally { S.finish(); }
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
  } finally { S.finish(); }
});
