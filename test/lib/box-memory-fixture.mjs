// What box-memory-installs*.test.mjs share: the setup runner and its machine-wide slots, driven through
// `chore start` in fleets with HOMEs of their own. Each importer (its own process) gets its own copy.
import assert from 'node:assert/strict';
import { execFile, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fleetFixture } from './kit.mjs';

// ---- DW4: the setup runner and the machine-wide slots, through `chore start` (and 2g) ----

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const SETTINGS = 'docs/devteam/project/settings.md';
const NOWHERE = path.join(os.tmpdir(), 'dt-no-such-machine-kit-596');
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
// a process that exited but is not yet reaped is a zombie: not alive
const alive = (pid) => { try { process.kill(pid, 0); } catch { return false; } return !/Z/.test(spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout ?? ''); };
// the pids (not zombies) whose command line matches pat
const pgrep = (pat) => (spawnSync('pgrep', ['-f', pat], { encoding: 'utf8' }).stdout ?? '').split('\n').filter(Boolean).map(Number).filter(alive);
// a process's start time as the kit reads it: field 22 of /proc/<pid>/stat, or ps lstart off Linux
function startOf(pid) {
  try { const t = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return t.slice(t.lastIndexOf(')') + 2).split(' ')[19]; } catch {}
  return (spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } }).stdout ?? '').trim() || null;
}
// written temp-then-rename, as the runner writes its own
function hold(dir, n, h) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.test-${process.pid}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmp);
  fs.writeFileSync(path.join(tmp, 'holder.json'), JSON.stringify({ id: `test-${Math.random().toString(36).slice(2)}`, at: new Date().toISOString(), ...h }));
  fs.renameSync(tmp, path.join(dir, String(n)));
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

export { alive, clock, deadlineIn, hold, NOWHERE, pgrep, readHolder, runAsync, SETTINGS, sleepMs, slotFleet, startOf, SUP, until };
