/* imports start */
import fs from 'node:fs';
import path from 'node:path';
import { CHORES } from './settings.mjs';
import { DAY } from './base.mjs';
import { SCHEMA } from './log.mjs';
import { SCRUB_MAX } from './sensors.mjs';
import { appendLog } from './log-sync.mjs';
import { byTime } from './log-sync.mjs';
import { canonical } from './settings.mjs';
import { commonDir } from './state.mjs';
import { die } from './base.mjs';
import { fileURLToPath } from 'node:url';
import { goalMode } from './holds.mjs';
import { heldWords } from './sessions.mjs';
import { isObj } from './artifact-notes.mjs';
import { lastRetro } from './goals.mjs';
import { loadSettings } from './settings.mjs';
import { logCache } from './log-sync.mjs';
import { logGet } from './log-sync.mjs';
import { logObjects } from './log-sync.mjs';
import { mainRef } from './log.mjs';
import { mainRoot } from './state.mjs';
import { mainSha } from './log.mjs';
import { mergedAt } from './repos.mjs';
import { nowIso } from './base.mjs';
import { out } from './base.mjs';
import { pastHalfMade } from './check-ticket.mjs';
import { pidAlive } from './sensors.mjs';
import { processInfo } from './accounts.mjs';
import { projectInRepo } from './settings.mjs';
import { realPath } from './state.mjs';
import { recurringEntryProblems } from './recurring.mjs';
import { recurringRegistry } from './recurring.mjs';
import { repo } from './repos.mjs';
import { runPath } from './settings.mjs';
import { scrubText } from './sensors.mjs';
import { sensorStatus } from './sensors.mjs';
import { slug } from './base.mjs';
import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { upkeepOrVirtual } from './holds.mjs';
/* imports end */
// When a recurring job is next due (design C1), from its landings on main and its recorded results.
// landings: [{ at, entry }] in any order, entry null when the job stopped; runs: [{ slot, at }], at the
// run's start. An unanchored job's next slot is the last result's start plus every; an anchored one
// (on/at) keeps a fixed sequence. An edit to every/on/at restarts the schedule at that landing, and a
// slot counts its earliest result only. Missed slots run once, for the latest. Self-contained: the
// test loads this function alone, so it names nothing outside its body, and no line of it is a bare
// closing brace but its last.
export function recurringNextSlot(landings, runs, now) {
  const ms = (x) => (typeof x === 'number' ? x : Date.parse(x));
  const iso = (t) => new Date(t).toISOString().replace(/\.000Z$/, 'Z');
  const schedule = (e) => JSON.stringify([e.every ?? null, e.on ?? null, e.at ?? null]);
  let start = null;
  let entry = null;
  for (const l of [...landings].sort((a, b) => ms(a.at) - ms(b.at))) {
    if (l.entry === null || typeof l.entry !== 'object') {
      start = null;
      entry = null;
      continue;
    }
    if (!entry || schedule(l.entry) !== schedule(entry)) start = ms(l.at);
    entry = l.entry;
  }
  const m = entry && typeof entry.every === 'string' ? /^([1-9][0-9]{0,3})(h|d|w|mo)$/.exec(entry.every) : null;
  if (!m || !(start >= 0)) return null;
  const n = Number(m[1]);
  const unit = m[2];
  const t = ms(now);
  // one result per slot: the earliest start, of runs since the schedule began
  const first = new Map();
  for (const r of runs) {
    const s = ms(r.slot);
    const a = ms(r.at);
    if (!(s >= 0) || !(a >= start)) continue;
    if (!first.has(s) || a < first.get(s)) first.set(s, a);
  }
  const DAY = 86400000;
  // k calendar months on, the day held to the target month's last (Jan 31 + 1mo is Feb 28 or 29)
  const addMonths = (x, k) => {
    const d = new Date(x);
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + k;
    const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    return Date.UTC(y, mo, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
  };
  const step = (x, k) => {
    if (unit === 'h') return x + k * n * 3600000;
    if (unit === 'd') return x + k * n * DAY;
    if (unit === 'w') return x + k * n * 7 * DAY;
    return addMonths(x, k * n);
  };
  const out = (due, slot) => ({ due, slot: iso(slot), next: iso(slot), start: iso(start) });
  if (unit === 'h' || (entry.on == null && entry.at == null)) {
    const latest = first.size ? Math.max(...first.keys()) : null;
    const slot = latest === null ? start : step(first.get(latest), 1);
    return out(t >= slot, slot);
  }
  // anchored: slot 0 is the first on/at instant at or after the start
  const [hh, mm] = String(entry.at ?? '00:00').split(':').map(Number);
  const s = new Date(start);
  const y = s.getUTCFullYear();
  const mon = s.getUTCMonth();
  let slot0;
  if (unit === 'mo') {
    const day = entry.on ?? Math.min(s.getUTCDate(), 28);
    slot0 = Date.UTC(y, mon, day, hh, mm);
    if (slot0 < start) slot0 = Date.UTC(y, mon + 1, day, hh, mm);
  } else {
    slot0 = Date.UTC(y, mon, s.getUTCDate(), hh, mm);
    if (!Number.isFinite(slot0)) return null;
    if (unit === 'w') {
      const want = entry.on == null ? s.getUTCDay() : ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(entry.on);
      // an on that is no weekday (a hand edit the shape refuses) has no schedule, never a loop without end
      if (want < 0) return null;
      while (new Date(slot0).getUTCDay() !== want || slot0 < start) slot0 += DAY;
    } else if (slot0 < start) {
      slot0 += DAY;
    }
  }
  // an on or at the shape refuses gives no instant: no schedule, never a throw or a loop
  if (!Number.isFinite(slot0)) return null;
  if (t < slot0) return out(false, slot0);
  // the latest slot at or before now: estimate by a short period, then walk to it
  const period = unit === 'd' ? n * DAY : unit === 'w' ? n * 7 * DAY : n * 28 * DAY;
  let k = Math.floor((t - slot0) / period);
  while (k > 0 && step(slot0, k) > t) k--;
  while (step(slot0, k + 1) <= t) k++;
  const cur = step(slot0, k);
  return first.has(cur) ? out(false, step(slot0, k + 1)) : out(true, cur);
}

// The lock one recurring runner holds while it runs due checks: run/recurring/.lock, JSON { pid,
// start, budget_s, checks, current: { name, slot, pgid?, checkout? } | null }. It is made whole in
// one step (written to a temp file, then linked into place, which fails when a lock exists), so no
// reader ever sees it half-written. Live means a good shape, a live pid other than ours (a lock
// naming our own pid is a reused pid) and now inside its budget; anything else that exists is stale.
export const recurringLock = Object.freeze({
  file: () => path.join(runPath('recurring'), '.lock'),
  sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  // the lock's text, null when there is none, '' when it can't be read (stale)
  text() { try { return fs.readFileSync(recurringLock.file(), 'utf8'); } catch (e) { return e.code === 'ENOENT' ? null : ''; } },
  good: (l) => isObj(l) && Number.isInteger(l.pid) && l.pid > 0 && typeof l.start === 'string' && Number.isFinite(Date.parse(l.start)) && typeof l.budget_s === 'number' && l.budget_s > 0,
  parse(text) {
    if (text === null) return null;
    try { const l = JSON.parse(text); return recurringLock.good(l) ? l : { bad: true }; } catch { return { bad: true }; }
  },
  read: () => recurringLock.parse(recurringLock.text()),
  live: (l, nowMs = Date.now()) => !!l && !l.bad && l.pid !== process.pid && pidAlive(l.pid) && nowMs < Date.parse(l.start) + l.budget_s * 1000,
  mine: (l, me) => !!me && !!l && !l.bad && l.pid === me.pid && l.start === me.start,
  // our lock into place: true when made, false when one exists
  create(me) {
    const f = recurringLock.file();
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(me)}\n`);
    try { fs.linkSync(tmp, f); return true; } catch (e) { if (e.code === 'EEXIST') return false; throw e; } finally { try { fs.unlinkSync(tmp); } catch {} }
  },
  // { me, old } once ours (old: the stale lock it replaced, or null), else { held: <the lock> }.
  // A stale lock is replaced in one step (a rename over it), so there is never a moment with no lock
  // for a plain create to win in (it would win with nothing to clean up). Every create or replace is
  // followed by a re-read a second later: two runners can both get past a stale lock, and only the
  // one whose lock is still there goes on.
  take(checks, budget_s) {
    fs.mkdirSync(path.dirname(recurringLock.file()), { recursive: true });
    const me = { pid: process.pid, start: nowIso(), budget_s, checks, current: null };
    const settle = (old) => {
      recurringLock.sleep(1000);
      const now = recurringLock.read();
      return recurringLock.mine(now, me) ? { me, old } : { held: now };
    };
    for (let round = 0; round < 3; round++) {
      if (recurringLock.create(me)) return settle(null);
      const text = recurringLock.text();
      // gone between the create and the read: create again
      if (text === null) continue;
      const l = recurringLock.parse(text);
      if (recurringLock.live(l)) return { held: l };
      // stale: taken over only when it reads the same again, so a lock another runner just wrote is
      // never removed; a change starts the round over
      if (recurringLock.text() !== text) continue;
      // tests only: hold here, past the unchanged re-read and before the replace, until the test opens
      // the gate (at most 30 s), so the race two runners can run past a stale lock is forced exactly
      const gate = process.env.DEVTEAM_TEST_RECURRING_UNLINK_GATE;
      if (gate) {
        fs.writeFileSync(`${gate}.waiting`, `${process.pid}\n`);
        for (const end = Date.now() + 30000; !fs.existsSync(gate) && Date.now() < end;) recurringLock.sleep(25);
      }
      const f = recurringLock.file();
      const tmp = `${f}.${process.pid}.take`;
      fs.writeFileSync(tmp, `${JSON.stringify(me)}\n`);
      fs.renameSync(tmp, f);
      return settle(l);
    }
    return { held: recurringLock.read() };
  },
  // current into our lock, only while it is ours; false when it isn't (the runner stops)
  set(me, current) {
    if (!recurringLock.mine(recurringLock.read(), me)) return false;
    me.current = current;
    const f = recurringLock.file();
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(me)}\n`);
    fs.renameSync(tmp, f);
    return true;
  },
  release(me) {
    if (recurringLock.mine(recurringLock.read(), me)) try { fs.unlinkSync(recurringLock.file()); } catch {}
  },
  // this kit's runner (an argument that is this script, then recurring run --due): never a reused
  // pid, a --draft, or another instance's runner
  isRunner(pid) {
    const a = processInfo(pid)?.args ?? [];
    const self = realPath(fileURLToPath(import.meta.url));
    return a.some((x, i) => a[i + 1] === 'recurring' && a[i + 2] === 'run' && a[i + 3] === '--due' && realPath(x) === self);
  },
  // the groups holding a live process whose marker starts with prefix (`<pid>:<start>:`, one
  // runner's): the check it was on, and any it started after its lock was last read
  markedGroups(prefix) {
    const want = `DEVTEAM_RECURRING=${prefix}`;
    const groups = new Set();
    const add = (p, g, carries) => { if (g > 1 && p !== process.pid && carries()) groups.add(g); };
    if (process.platform === 'linux') {
      let names = [];
      try { names = fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)); } catch {}
      for (const n of names) {
        // the fields after the last ")" (the command can hold one) are state, ppid, pgrp
        try {
          const st = fs.readFileSync(`/proc/${n}/stat`, 'utf8');
          const g = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[2]);
          if (!groups.has(g)) add(Number(n), g, () => (processInfo(Number(n))?.env ?? []).some((e) => e.startsWith(want)));
        } catch {}
      }
    } else {
      // one ps for every process: pid, pgid, then its command line and environment (final-2b R3)
      const r = spawnSync('ps', ['eww', '-A', '-o', 'pid=,pgid=,command='], { encoding: 'utf8', timeout: 10000, maxBuffer: 64 * 1024 * 1024 });
      for (const line of String(r.stdout ?? '').split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)\s(.*)$/.exec(line);
        if (m) add(Number(m[1]), Number(m[2]), () => m[3].split(/\s+/).some((e) => e.startsWith(want)));
      }
    }
    return [...groups];
  },
  // After taking over a stale lock: kill the old runner if it is one, every group where a process
  // carries its marker (its pid and start), remove the checkouts named with its pid, and log an error
  // run for the check it was on. checks: main's checks by name. A lock that didn't parse names
  // nothing to trust.
  cleanup(old, checks) {
    if (!old || old.bad) return;
    if (old.pid !== process.pid && recurringLock.isRunner(old.pid)) try { process.kill(old.pid, 'SIGKILL'); } catch {}
    const cur = isObj(old.current) ? old.current : null;
    for (const pg of recurringLock.markedGroups(`${old.pid}:${old.start}:`)) try { process.kill(-pg, 'SIGKILL'); } catch {}
    const dir = path.join(mainRoot, '.worktrees');
    const mine = new RegExp(`^tmp-recurring-${old.pid}-.+-${old.pid}$`);
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => mine.test(n)); } catch {}
    for (const n of names) recurringRegistry.git(['worktree', 'remove', '--force', path.join(dir, n)], { cwd: mainRoot });
    if (names.length) recurringRegistry.git(['worktree', 'prune'], { cwd: mainRoot });
    const sha = mainSha();
    if (cur && typeof cur.name === 'string' && Object.hasOwn(checks, cur.name) && typeof cur.slot === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/.test(cur.slot) && sha) {
      recurringRunDue.log(cur.name, cur.slot, sha, { status: 'error', seconds: 0, excerpt: 'the runner checking it stopped (taken over)', takenFrom: old.pid });
    }
  },
  heldWords: (l) => (l && !l.bad ? `a runner holds the lock: pid ${l.pid} since ${l.start} (${Array.isArray(l.checks) ? l.checks.join(', ') : ''})` : `a runner holds the lock (${recurringLock.file()} reads as no lock the kit wrote)`),
});

// Main's recurring checks, when each is due (recurringNextSlot over its landings and its results in
// the log), and the runner that runs the due ones: each in an unseeded detached checkout of main, in
// its own process group under timeout_s, judged by its fail rule, its output scrubbed, one
// recurring-run line logged as the supervisor with detector recurring. Nothing is kept but the log
// and the tails in run/recurring/<name>/, so deleting run/recurring/ changes no due time.
export const recurringRunDue = Object.freeze({
  KEEP: 16384,
  TAILS: 20,
  // the check and checkout running now, for the signal handlers
  state: { current: null },
  // only the supervisor's detector recurring lines count, one result (pass, fail, error) per slot;
  // a run's start is its line's time less its seconds (the runner logs at the end)
  results(name) {
    return logObjects('observation')
      .filter((o) => o.kind === 'recurring-run' && o.subject === `recurring:${name}` && o.detector === 'recurring' && o.created_by === 'supervisor' && ['pass', 'fail', 'error'].includes(o.run?.status) && typeof o.run.slot === 'string')
      .map((o) => ({ slot: o.run.slot, at: new Date(recurringFailures.runStart(o.created_at, o.run.seconds)).toISOString() }));
  },
  // the entry's landings: each merge-chore act citing an answered recurring-edit question that shows
  // this name, oldest first; main's entry when the last of them isn't it, at main's last commit to the file
  landings(name, entry, ref) {
    const R = recurringRegistry;
    const views = new Map(R.questions().map((v) => [v.id, v]));
    const out = [];
    for (const a of logObjects('act').filter((x) => x.class === 'merge-chore' && typeof x.approved_by === 'string').sort(byTime)) {
      const v = views.get(a.approved_by);
      const shown = R.shown(v);
      if (v?.status === 'answered' && shown && Object.hasOwn(shown, name)) out.push({ at: a.created_at, entry: shown[name] });
    }
    const last = out.at(-1);
    if (!last || canonical(last.entry) !== canonical(entry)) {
      const r = R.git(['log', '-1', '--format=%cI', ref, '--', R.path()]);
      const ms = r.ok ? Date.parse(r.out.trim()) : NaN;
      if (Number.isFinite(ms)) out.push({ at: new Date(Math.max(ms, last ? Date.parse(last.at) : 0)).toISOString(), entry });
    }
    return out;
  },
  // main's checks in name order, each { name, entry, due, slot, next, start }; nothing when main's
  // file has a problem, an entry breaks the shape or the registry is over the cap
  checks(nowMs = Date.now()) {
    const R = recurringRegistry;
    const ref = mainRef();
    if (!ref) return { checks: [], problem: `no ${loadSettings().main_branch} branch to read the jobs from` };
    const r = R.read(ref);
    if (r.problem) return { checks: [], problem: r.problem };
    for (const [n, e] of Object.entries(r.jobs)) {
      const p = recurringEntryProblems(n, e);
      if (p.length) return { checks: [], problem: p[0] };
    }
    const cap = R.capProblem(r.jobs, 'on main');
    if (cap) return { checks: [], problem: cap };
    const checks = [];
    for (const name of Object.keys(r.jobs).sort()) {
      const entry = r.jobs[name];
      if (entry.kind !== 'check') continue;
      const s = recurringNextSlot(recurringRunDue.landings(name, entry, ref), recurringRunDue.results(name), nowMs);
      if (s) checks.push({ name, entry, ...s });
    }
    return { checks, problem: null };
  },
  checkout: (name) => path.join(mainRoot, '.worktrees', `tmp-recurring-${process.pid}-${name}-${process.pid}`),
  removeCheckout(wt) {
    recurringRegistry.git(['worktree', 'remove', '--force', wt], { cwd: mainRoot });
    recurringRegistry.git(['worktree', 'prune'], { cwd: mainRoot });
  },
  // one run: { status, seconds, exit?, value?, killed?, noCheckout?, excerpt, tail }
  async runOne(name, entry, { sha, slot, me, draft }) {
    const R = recurringRunDue;
    const t0 = Date.now();
    const seconds = () => Math.round((Date.now() - t0) / 100) / 10;
    const wt = R.checkout(name);
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    // the test hook: a file where the checkout goes, so git's own refusal is what is logged
    const hook = process.env.DEVTEAM_TEST_RECURRING_NO_CHECKOUT === name;
    if (hook) fs.writeFileSync(wt, 'kit-163 test hook\n');
    // no hook runs there: a tracked core.hooksPath (husky) would run a command no entry names (final-2 F3)
    // -c core.useReplaceRefs=false (kit-778): a replace ref or core.useReplaceRefs any session can set would otherwise swap the tree checked out
    const add = pastHalfMade(() => recurringRegistry.git(['-c', 'core.useReplaceRefs=false', '-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--quiet', '--detach', wt, sha], { cwd: mainRoot }), { common: commonDir, wt });
    if (hook) try { fs.unlinkSync(wt); } catch {}
    if (!add.ok) {
      // git's first error line, with the checkout's path made short so the excerpt keeps all of it
      const first = (add.err.split('\n').find((l) => l.trim()) ?? recurringRegistry.why(add)).trim().split(wt).join(path.relative(mainRoot, wt));
      const tail = R.scrub(`the checkout could not be made: ${first}${add.note && '; still half made at the limit'}`, false);
      return { status: 'error', seconds: seconds(), noCheckout: true, excerpt: R.excerpt(tail), tail };
    }
    R.state.current = { wt };
    const marker = `${me?.pid ?? process.pid}:${me?.start ?? 'draft'}:${name}`;
    const timeout = Number.isInteger(entry.timeout_s) && entry.timeout_s > 0 ? entry.timeout_s : 120;
    let pgid = null;
    let lost = false;
    let run;
    // whatever happens, the checkout goes; a throw also kills the check's group (nothing else would)
    try {
      run = await R.spawnCheck(entry, { wt, marker, timeout, onSpawn: (pid) => {
        pgid = pid;
        R.state.current = { wt, pgid: pid };
        // a lock lost by now (taken over) can't hold this check's group for a takeover to kill:
        // kill it here, and the runner stops (spec-1 F6)
        if (!draft && !recurringLock.set(me, { name, slot, pgid: pid, checkout: wt })) { lost = true; try { process.kill(-pid, 'SIGKILL'); } catch {} }
      } });
    } catch (e) {
      if (pgid) try { process.kill(-pgid, 'SIGKILL'); } catch {}
      throw e;
    } finally {
      R.removeCheckout(wt);
      R.state.current = null;
    }
    if (lost) return { lost: true, status: 'error', seconds: seconds(), excerpt: '', tail: '' };
    const judged = R.judge(entry, run);
    const tail = R.scrub(run.both, run.cut);
    return { ...judged, seconds: seconds(), ...(run.exit !== null && !run.killed ? { exit: run.exit } : {}), killed: run.killed, signal: run.signal, timeout, excerpt: R.excerpt(tail), tail };
  },
  // sh -c <run> in a group of its own: { both, stdout (each its last 16 KB), cut, killed, spawnError, exit, signal }
  spawnCheck(entry, { wt, marker, timeout, onSpawn }) {
    const R = recurringRunDue;
    return new Promise((resolve) => {
      let both = Buffer.alloc(0);
      let stdout = Buffer.alloc(0);
      let total = 0;
      let killed = false;
      let exited = null;
      let spawnError = null;
      let timer = null;
      let cap = null;
      let ended = false;
      let child;
      const keep = (buf, b) => { const c = Buffer.concat([buf, b]); return c.length > R.KEEP * 2 ? c.subarray(c.length - R.KEEP) : c; };
      const end = () => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        clearTimeout(cap);
        // a process that left the group (setsid) can hold the pipes open past the cap: our ends are
        // closed, so the runner never waits on it (task-2 T2-1)
        try { child?.stdout?.destroy(); child?.stderr?.destroy(); child?.unref(); } catch {}
        const last = (b) => b.subarray(Math.max(0, b.length - R.KEEP)).toString('utf8');
        resolve({ both: last(both), stdout: last(stdout), cut: total > R.KEEP, killed, spawnError, exit: exited?.code ?? null, signal: exited?.signal ?? null });
      };
      try {
        child = spawn('sh', ['-c', entry.run], { cwd: wt, detached: true, env: { ...process.env, DEVTEAM_RECURRING: marker }, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) { spawnError = e; end(); return; }
      const group = (sig) => { if (child.pid) try { process.kill(-child.pid, sig); } catch {} };
      if (child.pid) onSpawn(child.pid);
      child.stdout.on('data', (b) => { total += b.length; both = keep(both, b); stdout = keep(stdout, b); });
      child.stderr.on('data', (b) => { total += b.length; both = keep(both, b); });
      child.on('error', (e) => { spawnError = e; end(); });
      timer = setTimeout(() => { killed = true; group('SIGKILL'); }, timeout * 1000);
      // the check ends when its shell does: the rest of its group (anything it left running) is
      // killed so nothing outlives the run or holds its pipes open, then the pipes get 5 s to close
      child.on('exit', (code, signal) => {
        exited = { code, signal };
        clearTimeout(timer);
        group('SIGKILL');
        cap = setTimeout(end, 5000);
      });
      child.on('close', end);
    });
  },
  // pass, fail or error by the entry's fail rule (C1); value: a last_line read as a number
  judge(entry, { exit, killed, spawnError, stdout }) {
    if (killed || spawnError || exit === null || exit === 126 || exit === 127) return { status: 'error' };
    const fail = isObj(entry.fail) ? entry.fail : { exit: 'nonzero' };
    if (!isObj(fail.last_line)) return { status: exit === 0 ? 'pass' : 'fail' };
    const rule = fail.last_line;
    const line = String(stdout ?? '').split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? '';
    const num = /^-?\d+(\.\d+)?$/.test(line) ? Number(line) : NaN;
    const value = Number.isFinite(num) ? { value: num } : {};
    if (Object.hasOwn(rule, 'is_not')) return { status: line === String(rule.is_not) ? 'pass' : 'fail', ...value };
    if (!Number.isFinite(num)) return { status: 'error' };
    const over = Object.hasOwn(rule, 'above') && num > rule.above;
    const under = Object.hasOwn(rule, 'below') && num < rule.below;
    return { status: over || under ? 'fail' : 'pass', ...value };
  },
  // From the front to just after the first line break that isn't the last character, so a cut
  // never leaves part of a line (or of a secret) at the front; a text with none is kept as it is.
  fromLine(t) {
    const i = t.indexOf('\n');
    return i >= 0 && i < t.length - 1 ? t.slice(i + 1) : t;
  },
  // What a check printed, safe to keep: line-aligned when it was cut, the runner's own rules for what
  // scrubText misses (an assignment to a secret-sounding name, --password, mysql -p), cut again if
  // they made it longer than scrubText keeps (so scrubText never cuts its end off), then scrubText.
  RULES: [
    [/\b([A-Za-z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL)[A-Za-z0-9_]*)(\s*[=:]\s*)("[^"\n]*"|'[^'\n]*'|[^\s"']+)/gi, '$1$2[scrubbed]'],
    [/(--password)(=|\s+)(\S+)/gi, '$1$2[scrubbed]'],
    [/\b((?:mysql|mysqldump|mysqladmin|mariadb)\b[^\n]*?\s-p)(\S+)/gi, '$1[scrubbed]'],
  ],
  scrub(text, cut) {
    const R = recurringRunDue;
    let t = cut ? R.fromLine(text) : text;
    for (const [re, to] of R.RULES) t = t.replace(re, to);
    if (Buffer.byteLength(t) > SCRUB_MAX) t = R.fromLine(Buffer.from(t).subarray(-SCRUB_MAX).toString('utf8'));
    return scrubText(t);
  },
  excerpt: (tail) => String(tail).replace(/\s+/g, ' ').trim().slice(-200),
  // one recurring-run line, as the supervisor, and the tail kept beside the newest 20
  log(name, slot, sha, r) {
    const how = r.takenFrom ? `taken over from runner ${r.takenFrom}` : r.noCheckout ? 'no checkout' : r.killed ? `killed at ${r.timeout}s` : r.exit === undefined ? (r.signal ? `ended by ${r.signal}` : 'did not start') : `exit ${r.exit}`;
    const run = { status: r.status, slot, sha, seconds: r.seconds, ...(r.exit !== undefined ? { exit: r.exit } : {}), ...(r.value !== undefined ? { value: r.value } : {}), excerpt: r.excerpt };
    appendLog({ type: 'observation', source: 'recurring', kind: 'recurring-run', subject: `recurring:${name}`, detector: 'recurring', severity: 0, valence: 0, detail: r.takenFrom ? `${name}: error (${how})` : `${name}: ${r.status} in ${r.seconds}s (${how})`, source_key: `recurring:${name}:${slot}:${process.pid}`, run }, 'supervisor');
    if (r.noCheckout || r.takenFrom) return;
    const dir = path.join(runPath('recurring'), name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${slot.slice(0, 10).replace(/-/g, '')}-${slot.slice(11, 23).replace(/[:.]/g, '')}-${process.pid}.txt`), r.tail);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).map((f) => { try { return [f, fs.statSync(path.join(dir, f)).mtimeMs]; } catch { return [f, 0]; } }).sort((a, b) => b[1] - a[1]);
    for (const [f] of files.slice(recurringRunDue.TAILS)) try { fs.unlinkSync(path.join(dir, f)); } catch {}
  },
  // Start `recurring run --due` for wait: in the background of a shell that exits at once (under
  // setsid where the machine has it, so the runner has a session of its own), output appended to
  // run/recurring/runner.log. spawnSync reaps the shell and init the runner, so wait, whose loop
  // blocks in Atomics.wait and never reaps a child, holds no zombie; whether a runner is running is
  // read from the lock alone. True when the shell ran: the runner's own failures are in runner.log.
  start(self) {
    const dir = runPath('recurring');
    const logFile = path.join(dir, 'runner.log');
    fs.mkdirSync(dir, { recursive: true });
    fs.closeSync(fs.openSync(logFile, 'a'));
    // its last 64 KB kept, so what runners say there never grows without end (final-1b F3)
    try {
      const size = fs.statSync(logFile).size;
      if (size > 65536) {
        const buf = Buffer.alloc(65536);
        const fd = fs.openSync(logFile, 'r');
        try { fs.readSync(fd, buf, 0, 65536, size - 65536); } finally { fs.closeSync(fd); }
        const nl = buf.indexOf(10);
        fs.writeFileSync(logFile, nl >= 0 ? buf.subarray(nl + 1) : buf);
      }
    } catch {}
    const script = 'if command -v setsid >/dev/null 2>&1; then setsid "$0" "$1" recurring run --due </dev/null >>"$2" 2>&1 & else "$0" "$1" recurring run --due </dev/null >>"$2" 2>&1 & fi';
    const r = spawnSync('sh', ['-c', script, process.execPath, self, logFile], { cwd: mainRoot, env: process.env, timeout: 10000, stdio: 'ignore' });
    return r.status === 0;
  },
  // a SIGTERM or SIGINT mid-check kills its group, removes its checkout and releases the lock
  onSignals(me) {
    const stop = (code) => () => {
      const cur = recurringRunDue.state.current;
      if (cur?.pgid) try { process.kill(-cur.pgid, 'SIGKILL'); } catch {}
      if (cur?.wt) recurringRunDue.removeCheckout(cur.wt);
      if (me) recurringLock.release(me);
      process.exit(code);
    };
    process.on('SIGTERM', stop(143));
    process.on('SIGINT', stop(130));
  },
  async run(opts) {
    const R = recurringRunDue;
    if (opts.draft) {
      const name = opts.draft;
      const w = recurringRegistry.readWorking();
      if (w.problem) die(w.problem);
      const entry = w.jobs[name];
      if (!entry) die(`no job ${name} in this checkout's ${recurringRegistry.path()}`);
      if (entry.kind !== 'check') die(`${name} is a ${entry.kind ?? 'kindless'} job; only a check runs here`);
      const p = recurringEntryProblems(name, entry);
      if (p.length) die(p[0]);
      const sha = mainSha();
      if (!sha) die(`no ${loadSettings().main_branch} branch to check out`);
      R.onSignals(null);
      const r = await R.runOne(name, entry, { sha, slot: null, me: null, draft: true });
      const how = r.noCheckout ? 'no checkout' : r.killed ? `killed at ${r.timeout}s` : r.exit === undefined ? (r.signal ? `ended by ${r.signal}` : 'did not start') : `exit ${r.exit}`;
      out(`${name}: ${r.status} in ${r.seconds}s (${how})\nexcerpt: ${r.excerpt}`);
      return;
    }
    const first = R.checks();
    if (first.problem) process.stderr.write(`recurring run: nothing runs, ${first.problem}\n`);
    const due = first.checks.filter((c) => c.due);
    const budget = Math.max(60, due.reduce((t, c) => t + (Number.isInteger(c.entry.timeout_s) ? c.entry.timeout_s : 120) + 60, 0));
    const t = recurringLock.take(due.map((c) => c.name), budget);
    if (t.held) return out(recurringLock.heldWords(t.held));
    const { me } = t;
    process.on('exit', () => recurringLock.release(me));
    R.onSignals(me);
    recurringLock.cleanup(t.old, Object.fromEntries(first.checks.map((c) => [c.name, c.entry])));
    if (first.problem) return;
    const sha = mainSha();
    for (const { name } of due) {
      // again before each check: a takeover's error line or another runner's result may have its slot
      logCache = null;
      const now = R.checks().checks.find((c) => c.name === name && c.due);
      if (!now) continue;
      if (!recurringLock.set(me, { name, slot: now.slot })) break;
      const r = await R.runOne(name, now.entry, { sha, slot: now.slot, me, draft: false });
      if (r.lost) break;
      R.log(name, now.slot, sha, r);
    }
  },
});

// ===== recurring: a failing check becomes work (kit-168) =====
// A check's results since it was last added, its failing stretch, its fix ticket, and the failure pass:
// one recurring-failed when a stretch of fails reaches fail_after, one recurring-recovered at the pass
// that ends it. Marks name their stretch by its first run (refs[0]), so a missed pass is caught up in
// order. Only the supervisor's detector recurring lines count, anywhere (design C2, P5). Every time it
// gives is ISO to the second, as the dashboard contract has them.
export const recurringFailures = Object.freeze({
  isoSec: (t) => `${new Date(typeof t === 'number' ? t : Date.parse(t)).toISOString().slice(0, 19)}Z`,
  // a run's start, in ms: its line's time less its seconds (the runner logs at the end); a seconds
  // that isn't a positive number, or would put the start before 1970 (no date, or one the
  // contract's times can't show), is ignored as a duration, and the start is the line's time (kit-781)
  runStart(createdAt, seconds) {
    const t = Date.parse(createdAt);
    if (!(Number.isFinite(seconds) && seconds > 0)) return t;
    const start = t - seconds * 1000;
    return start >= 0 ? start : t;
  },
  counts: (o) => o?.created_by === 'supervisor' && o?.detector === 'recurring',
  failAfter: (entry) => (Number.isInteger(entry?.fail_after) ? entry.fail_after : 1),
  // the answered landings that show this name, oldest first (a stop shows it as null)
  answered(name) {
    const R = recurringRegistry;
    const views = new Map(R.questions().map((v) => [v.id, v]));
    const out = [];
    for (const a of logObjects('act').filter((x) => x.class === 'merge-chore' && typeof x.approved_by === 'string').sort(byTime)) {
      const v = views.get(a.approved_by);
      const shown = R.shown(v);
      if (v?.status === 'answered' && shown && Object.hasOwn(shown, name)) out.push({ at: a.created_at, entry: shown[name] });
    }
    return out;
  },
  // when the job was last added after an answered stop: the answered re-add, or the stop itself when it
  // came back by hand; null with no answered stop. A commit to the file never moves it (spec-2 F1).
  addedAt(name) {
    const ls = recurringFailures.answered(name);
    const i = ls.findLastIndex((l) => l.entry === null);
    if (i < 0) return null;
    return (ls.slice(i + 1).find((l) => l.entry !== null) ?? ls[i]).at;
  },
  // the newest answered landing that shows main's entry as it is: { qid, at, by, act }, else null
  registered(name, entry) {
    const R = recurringRegistry;
    const views = new Map(R.questions().map((v) => [v.id, v]));
    const acts = logObjects('act').filter((a) => a.class === 'merge-chore' && typeof a.approved_by === 'string' && views.has(a.approved_by)).sort(byTime);
    for (const a of [...acts].reverse()) {
      const v = views.get(a.approved_by);
      const shown = R.shown(v);
      if (v.status === 'answered' && shown && Object.hasOwn(shown, name) && shown[name] !== null && canonical(shown[name]) === canonical(entry)) return { qid: v.id, at: a.created_at, by: a.created_by, act: a.id };
    }
    return null;
  },
  // one result per slot (its earliest start, a run's start being its line's time less its seconds),
  // counted lines only, none starting before `from`; by slot
  results(name, from = null) {
    const RF = recurringFailures;
    const floor = from ? Date.parse(from) : -Infinity;
    const first = new Map();
    for (const o of logObjects('observation')) {
      if (o.kind !== 'recurring-run' || o.subject !== `recurring:${name}` || !RF.counts(o)) continue;
      const r = o.run;
      if (!r || !['pass', 'fail', 'error'].includes(r.status) || typeof r.slot !== 'string' || !Number.isFinite(Date.parse(r.slot))) continue;
      const ms = RF.runStart(o.created_at, r.seconds);
      if (!(ms >= floor)) continue;
      const cur = first.get(r.slot);
      if (!cur || ms < cur.ms) first.set(r.slot, { ms, id: o.id, status: r.status, slot: r.slot, seconds: Number.isFinite(r.seconds) ? r.seconds : null, excerpt: typeof r.excerpt === 'string' ? r.excerpt : null });
    }
    return [...first.values()].sort((a, b) => Date.parse(a.slot) - Date.parse(b.slot) || a.ms - b.ms).map(({ ms, ...r }) => ({ ...r, at: RF.isoSec(ms) }));
  },
  // the runs of consecutive fails and errors, in order, each { runs, endedBy (the pass after it, or null) }
  stretches(results) {
    const out = [];
    let cur = null;
    for (const r of results) {
      if (r.status !== 'pass') (cur ??= { runs: [], endedBy: null }).runs.push(r);
      else if (cur) { cur.endedBy = r; out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
    return out;
  },
  stretch(results) {
    const s = recurringFailures.stretches(results).at(-1);
    return s && !s.endedBy ? s.runs : [];
  },
  // a live chores ticket the supervisor added for this check after its stretch began
  fixTicket(name, since) {
    const t0 = since ? Date.parse(since) : -Infinity;
    const acts = logObjects('act').filter((a) => a.class === 'add-ticket' && a.created_by === 'supervisor' && (a.refs ?? []).includes(`recurring:${name}`) && Date.parse(a.created_at) > t0).sort(byTime);
    for (const a of acts.reverse()) {
      for (const id of a.refs) {
        const t = logGet(id);
        if (t?.type === 'ticket' && t.feature === CHORES && !t.superseded_by) return id;
      }
    }
    return null;
  },
  state(name, entry) {
    const RF = recurringFailures;
    const results = RF.results(name, RF.addedAt(name));
    const stretch = RF.stretch(results);
    const alerting = stretch.length >= RF.failAfter(entry);
    const since = stretch[0]?.at ?? null;
    return { results, stretch, alerting, since, fixTicket: stretch.length ? RF.fixTicket(name, since) : null };
  },
  // the failure pass: read from the log each time, so a pass that never ran is caught up by the next
  note() {
    const RF = recurringFailures;
    const done = { failed: 0, recovered: 0 };
    const { checks, problem } = recurringRunDue.checks();
    if (problem) return done;
    const obs = logObjects('observation');
    for (const { name, entry } of checks) {
      const marks = (kind) => obs.filter((o) => o.kind === kind && o.subject === `recurring:${name}` && RF.counts(o));
      const failed = marks('recurring-failed');
      const recovered = marks('recurring-recovered');
      const n = RF.failAfter(entry);
      const all = RF.stretches(RF.results(name, RF.addedAt(name)));
      const line = (o) => appendLog({ type: 'observation', source: 'recurring', subject: `recurring:${name}`, detector: 'recurring', ...o }, 'supervisor');
      // the newest ended stretch that was marked failed, recovered at the pass that ended it
      const ended = all.filter((s) => s.endedBy).at(-1);
      const f = ended && ended.runs.length >= n ? failed.find((o) => o.refs?.[0] === ended.runs[0].id) : null;
      if (f && !recovered.some((o) => o.refs?.[1] === ended.endedBy.id)) {
        line({ kind: 'recurring-recovered', source_key: `recurring:${name}:recovered`, severity: 0, valence: 1, refs: [f.id, ended.endedBy.id], detail: `${name}: passing again at ${ended.endedBy.at}, after ${ended.runs.length} failing in a row` });
        done.recovered += 1;
      }
      const cur = all.at(-1);
      if (cur && !cur.endedBy && cur.runs.length >= n && !failed.some((o) => o.refs?.[0] === cur.runs[0].id)) {
        line({ kind: 'recurring-failed', source_key: `recurring:${name}`, severity: Number.isInteger(entry.severity) ? entry.severity : 2, valence: -1, refs: cur.runs.slice(0, n).map((r) => r.id), detail: `${name}: failing, ${cur.runs.length} in a row since ${cur.runs[0].at}` });
        done.failed += 1;
      }
    }
    return done;
  },
});

// ===== recurring: chores come due, start and finish (kit-164) =====
// A chore is due by its slots (recurringNextSlot over its landings and its started runs), as a check
// is. Its run for a slot is its start: `recurring start` logs a started line (ref the chore branch
// chore-recurring-<name>-<yyyymmdd>, or the chores ticket it wrote) and the run finishes when that ref
// merges (done), with `recurring done --nothing` or `--abandoned` (a supervisor chore's only), when a
// supervisor chore's PR is closed unmerged (abandoned) or when a worker chore's ticket is superseded
// (abandoned). Nothing else ends a worker chore: a ticket written but not started, or whose PR was
// closed, is live. A run started and not finished keeps the chore from coming due again; once it
// finishes, the slots that passed meanwhile are one, due for the latest. Only the supervisor's
// detector recurring lines count (design C2, P5). Every time it gives is ISO to the second.
export const recurringChores = Object.freeze({
  REF: /^chore-recurring-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)-(\d{8})$/,
  // a closed PR's state is kept this long before gh is asked again; a closed one is kept for good
  PR_REUSE_MS: 10 * 60000,
  // a start dated more than this far ahead (the clock was off when it started) reads stuck at once
  SKEW_MS: 10 * 60000,
  grace: (entry) => (Number.isInteger(entry?.grace_days) ? entry.grace_days : entry?.by === 'worker' ? 3 : 1),
  // a started run's ref: the chore branch (a supervisor chore) or a chores ticket id (a worker chore). A
  // branch can match the ticket pattern (a job named deps-02-bump makes chore-recurring-deps-02-bump-<date>),
  // so a ref that is a chore branch is never a ticket
  isTicketRef: (ref) => new RegExp(SCHEMA['x-id'].keyed.ticket).test(ref) && !recurringChores.REF.test(ref),
  // the job a run's ref names: a chore branch's name, or a recurring chores ticket's (<c>-<NN>-recurring-<name>);
  // null for any other ref
  refJob(ref) { const RC = recurringChores; return RC.REF.exec(ref)?.[1] ?? (RC.isTicketRef(ref) ? /-\d{2,}-recurring-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/.exec(ref)?.[1] ?? null : null); },
  slug: (name, ms) => `chore-recurring-${name}-${new Date(ms).toISOString().slice(0, 10).replace(/-/g, '')}`,
  // main's chores in name order, each { name, entry }, read and gated as main's checks are (a file that
  // doesn't read, an entry that breaks the shape, a registry over the cap: none, with the problem)
  list() {
    const R = recurringRegistry;
    const ref = projectInRepo ? mainRef() : null;
    if (!ref) return { chores: [], ref: null, problem: projectInRepo ? `no ${loadSettings().main_branch} branch to read the jobs from` : null };
    const r = R.read(ref);
    if (r.problem) return { chores: [], ref, problem: r.problem };
    for (const [n, e] of Object.entries(r.jobs)) {
      const p = recurringEntryProblems(n, e);
      if (p.length) return { chores: [], ref, problem: p[0] };
    }
    const cap = R.capProblem(r.jobs, 'on main');
    if (cap) return { chores: [], ref, problem: cap };
    return { chores: Object.keys(r.jobs).sort().filter((n) => r.jobs[n].kind === 'chore').map((name) => ({ name, entry: r.jobs[name] })), ref, problem: null };
  },
  // the counted chore lines for this name since it was last added (started, nothing, abandoned), oldest first
  lines(name) {
    const from = recurringFailures.addedAt(name);
    const floor = from ? Date.parse(from) : -Infinity;
    return logObjects('observation')
      .filter((o) => o.kind === 'recurring-run' && o.subject === `recurring:${name}` && recurringFailures.counts(o) && ['started', 'nothing', 'abandoned'].includes(o.run?.status) && typeof o.run.slot === 'string' && Number.isFinite(Date.parse(o.run.slot)) && typeof o.run.ref === 'string' && o.run.ref && Date.parse(o.created_at) >= floor)
      .sort(byTime);
  },
  // a supervisor chore's PR on the forge, closed without a merge: its closedAt, else null. Read through
  // run/recurring/prs.json: a closed PR for good, anything else again after PR_REUSE_MS. No forge (git),
  // no gh, or gh failing: null, so the run stays live.
  prClosed(branch, nowMs = Date.now(), { ask = false } = {}) {
    if (loadSettings().forge === 'git') return null;
    const file = path.join(runPath('recurring'), 'prs.json');
    let cache = {};
    try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    if (!isObj(cache)) cache = {};
    const c = isObj(cache[branch]) ? cache[branch] : null;
    if (c && typeof c.closed_at === 'string') return c.closed_at;
    if (!ask || (c && Number.isFinite(Date.parse(c.at)) && nowMs - Date.parse(c.at) < recurringChores.PR_REUSE_MS)) return null;
    const raw = repo('home').gh(['pr', 'list', '--head', branch, '--state', 'closed', '--json', 'number,closedAt,mergedAt', '--limit', '20'], { timeout: 10000 });
    let prs = null;
    try { prs = raw === null ? null : JSON.parse(raw); } catch { prs = null; }
    if (!Array.isArray(prs)) return null;
    const closed = prs.filter((p) => isObj(p) && !p.mergedAt && Number.isFinite(Date.parse(p.closedAt))).map((p) => p.closedAt).sort()[0] ?? null;
    cache[branch] = { at: new Date(nowMs).toISOString(), closed_at: closed };
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(cache, null, 2)}\n`); } catch {}
    return closed;
  },
  // each started run, oldest first: { id, ref, slot, start, status: started | done | nothing | abandoned,
  // at (when it finished, or its start), why (a nothing or abandoned line's detail) }. forge: true asks gh
  // about an open supervisor run's PR (recurring start and done only); without it a closed PR is read from
  // run/recurring/prs.json alone, so metrics, the dashboard and peek never wait on gh.
  runs(name, { nowMs = Date.now(), forge = false } = {}) {
    const RC = recurringChores;
    const lines = RC.lines(name);
    const acts = logObjects('act').filter((a) => a.class === 'merge-chore' && a.created_by === 'supervisor');
    const out = [];
    // a finish counts whatever its date against the start (one before it shows the clock was off), from
    // when the job was last added, as its lines do
    const from = recurringFailures.addedAt(name);
    const floor = from ? Date.parse(from) : -Infinity;
    for (const o of lines.filter((l) => l.run.status === 'started')) {
      const ref = o.run.ref;
      // a line whose ref names another job is no run of this one: it can't finish or remove that job's work
      const job = RC.refJob(ref);
      if (job !== null && job !== name) continue;
      const run = { id: o.id, ref, slot: o.run.slot, start: o.created_at, status: 'started', at: o.created_at, why: null };
      const end = (status, at, why = null) => { const ms = Date.parse(at); if (Number.isFinite(ms) && (run.status === 'started' || ms < Date.parse(run.at))) Object.assign(run, { status, at: new Date(ms).toISOString(), why }); };
      if (RC.isTicketRef(ref)) {
        // a worker chore ends only through its ticket: merged (done) or superseded (abandoned)
        const t = logGet(ref);
        if (t?.type === 'ticket') {
          const m = mergedAt(ref);
          if (m !== null && m !== undefined) end('done', typeof m === 'number' ? new Date(m).toISOString() : m);
          // the earliest finish holds: a ticket superseded and merged later stays abandoned
          if (t.superseded_by) end('abandoned', (t.updates ?? []).filter((u) => u.superseded_by).map((u) => u.at).sort()[0] ?? t.created_at ?? o.created_at, `superseded by ${t.superseded_by}`);
        }
      } else {
        for (const a of acts) if (a.refs?.[0] === ref && Date.parse(a.created_at) >= floor) end('done', a.created_at);
        for (const l of lines) if (l !== o && ['nothing', 'abandoned'].includes(l.run.status) && l.run.ref === ref && Date.parse(l.created_at) >= floor) end(l.run.status, l.created_at, typeof l.detail === 'string' ? l.detail : null);
        if (run.status === 'started') { const c = RC.prClosed(ref, nowMs, { ask: forge }); if (c) end('abandoned', c, 'its PR was closed without a merge'); }
      }
      out.push(run);
    }
    return out;
  },
  // When a chore is due, from its landings and its runs ([{ slot, start, status }], status started for a
  // run not finished): the newest started run is open, and while one is open nothing is due; else
  // recurringNextSlot over the runs' starts, so slots that passed meanwhile are one, due for the latest.
  // { open, due, slot, next }, or null with no schedule. Names nothing but recurringNextSlot (the test
  // runs it on test/fixtures/recurring/slots.json's chore cases).
  schedule(landings, runs, nowMs) {
    const open = runs.findLast((r) => r.status === 'started') ?? null;
    // a run that finished before its own start (a clock that ran fast) takes its slot from when it finished
    const s = recurringNextSlot(landings, runs.map((r) => ({ slot: r.slot, at: Math.min(Date.parse(r.start), Date.parse(r.at ?? r.start)) })), nowMs);
    return s ? { open, due: !open && s.due, slot: s.slot, next: s.next } : null;
  },
  // one chore's state now: { runs, open (the started run not finished, or null), due, slot, next, overdue,
  // stuck, held, state: started | due | overdue | held | never | passing }, or null when it has no schedule
  state(name, entry, { nowMs = Date.now(), forge = false, mode = goalMode(upkeepOrVirtual()) } = {}) {
    const RC = recurringChores;
    const runs = RC.runs(name, { nowMs, forge });
    const s = RC.schedule(recurringRunDue.landings(name, entry, mainRef()), runs, nowMs);
    if (!s) return null;
    const { open } = s;
    const graceMs = RC.grace(entry) * DAY;
    const held = mode !== 'run';
    const { due } = s;
    const overdue = due && nowMs - Date.parse(s.slot) > graceMs;
    // stuck grace_days after its start, or at once while its start is more than SKEW_MS ahead (kit-785 R1)
    const startMs = open ? Date.parse(open.start) : NaN;
    const stuck = !!open && (nowMs - startMs > graceMs || startMs - nowMs > RC.SKEW_MS);
    const state = open ? 'started' : due ? (held ? 'held' : overdue ? 'overdue' : 'due') : runs.length ? 'passing' : 'never';
    return { runs, open, due, slot: s.slot, next: s.next, overdue, stuck, held, mode, state };
  },
  // the started line: as the supervisor, detector recurring, for the slot it was due for
  logStart(name, slot, ref, how) {
    return appendLog({ type: 'observation', source: 'recurring', kind: 'recurring-run', subject: `recurring:${name}`, detector: 'recurring', severity: 0, valence: 0, detail: `${name}: started for ${slot} (${how})`, source_key: `recurring:${name}:${slot}:started:${ref}`, run: { status: 'started', slot, ref } }, 'supervisor');
  },
  // a live chores ticket of this job's that no started line names: a start cut short after writing it
  // (before its line). The next start takes it up rather than write a second.
  stray(name, entry, runs) {
    const named = new Set(runs.map((r) => r.ref));
    const re = new RegExp(`^${entry.component.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{2,}-recurring-${name}$`);
    return logObjects('ticket').filter((t) => re.test(t.id) && t.feature === CHORES && !t.superseded_by && !named.has(t.id) && (mergedAt(t.id) === null || mergedAt(t.id) === undefined)).sort(byTime)[0]?.id ?? null;
  },
  // the next free ticket number for a component: one past the highest <component>-<NN>- id, two digits at least
  nextId(component, name) {
    const re = new RegExp(`^${component.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d{2,})-`);
    const n = Math.max(0, ...logObjects('ticket').map((t) => re.exec(t.id)?.[1]).filter(Boolean).map(Number)) + 1;
    return `${component}-${String(n).padStart(2, '0')}-recurring-${name}`;
  },
});

// The dashboard's upkeep.recurring (kit-168), in test/fixtures/recurring/dashboard.json's shape: main's
// checks with their state, then main's chores (kit-164), and the built-in schedules. Proposals come with
// kit-165, signals with kit-175. Every time is ISO to the second.
export function recurringDashboard() {
  const RF = recurringFailures;
  const sec = (t) => (t === null || t === undefined || t === '' ? null : RF.isoSec(t));
  const rc = projectInRepo && mainRef() ? recurringRunDue.checks() : { checks: [], problem: null };
  const entries = rc.checks.map(({ name, entry, next }) => {
    const st = RF.state(name, entry);
    const last = st.results.at(-1) ?? null;
    const reg = RF.registered(name, entry);
    return {
      name, title: entry.title, what: entry.what, kind: entry.kind, by: null, every: entry.every, on: entry.on ?? null, at: entry.at ?? null,
      state: !last ? 'never' : last.status === 'pass' ? 'passing' : 'failing',
      fails_in_a_row: st.stretch.length,
      last: last ? { status: last.status, at: last.at, seconds: last.seconds, excerpt: typeof last.excerpt === 'string' ? last.excerpt.slice(-200) : null } : null,
      next_at: sec(next), ticket: st.fixTicket, registered: reg ? { qid: reg.qid, at: sec(reg.at) } : null, signals: [],
    };
  });
  const s = loadSettings();
  const plus = (at, ms) => (at ? sec(Date.parse(at) + ms) : null);
  const retroAt = sec(lastRetro()?.created_at);
  const spikes = logObjects('ticket').filter((t) => t.kind === 'spike').map((t) => mergedAt(t.id)).filter((t) => t !== null && t !== undefined).map((t) => (typeof t === 'number' ? t : Date.parse(t))).filter(Number.isFinite);
  const researchAt = spikes.length ? sec(Math.max(...spikes)) : null;
  const syncs = logObjects('act').filter((a) => a.class === 'merge-chore' && a.created_by === 'supervisor' && /^chore-devteam-sync-/.test(String(a.refs?.[0] ?? ''))).sort(byTime);
  const sensorsAt = sensorStatus().map((m) => m.last_at).filter(Boolean).sort().at(-1) ?? null;
  const builtin = [
    { name: 'retro', every: `${s.retro_every_days}d`, last_at: retroAt, next_at: plus(retroAt, s.retro_every_days * 86400000), note: 'A look back at what the team did since the last one.', setting: 'retro_every_days' },
    { name: 'research', every: `${s.research_every_days}d`, last_at: researchAt, next_at: plus(researchAt, s.research_every_days * 86400000), note: 'A spike on new tools and practice.', setting: 'research_every_days' },
    { name: 'kit-sync', every: `${s.upstream_check_hours}h`, last_at: sec(syncs.at(-1)?.created_at), next_at: null, note: `Adopts each new devteam release; you check for one every ${s.upstream_check_hours} hours.`, setting: 'upstream_check_hours' },
    { name: 'sensors', every: 'each cycle', last_at: sec(sensorsAt), next_at: null, note: 'Production signals, read on every wait cycle.', setting: null },
  ];
  const mode = goalMode(upkeepOrVirtual());
  const lc = recurringChores.list();
  for (const { name, entry } of lc.chores) {
    const st = recurringChores.state(name, entry, { forge: false, mode });
    if (!st) continue;
    const lr = st.runs.at(-1) ?? null;
    const reg = RF.registered(name, entry);
    entries.push({
      name, title: entry.title, what: entry.what, kind: 'chore', by: entry.by, every: entry.every, on: entry.on ?? null, at: entry.at ?? null,
      state: st.state, fails_in_a_row: 0,
      last: lr ? { status: lr.status, at: sec(lr.status === 'started' ? lr.start : lr.at), seconds: null, excerpt: null } : null,
      next_at: sec(st.next), ticket: null, registered: reg ? { qid: reg.qid, at: sec(reg.at) } : null, signals: [],
    });
  }
  return { entries, builtin, proposals: [] };
}

