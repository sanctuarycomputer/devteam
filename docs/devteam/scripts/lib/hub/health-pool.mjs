/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ACCOUNTS_FILE } from '../accounts.mjs';
import { ACCOUNTS_FRESH_MS } from '../accounts.mjs';
import { BOX_HEALTH_FULL } from './health.mjs';
import { GiB } from './operator.mjs';
import { HUB_PORT } from '../orient.mjs';
import { KIT_UPSTREAM } from '../state.mjs';
import { POOL_MAX_BYTES } from './health.mjs';
import { RESTART_CHILD_MS } from '../accounts.mjs';
import { RESTART_MIN_MS } from '../accounts.mjs';
import { RESTART_TICK_MS } from '../accounts.mjs';
import { accountHasRoom } from '../accounts.mjs';
import { accountKnownFull } from '../accounts.mjs';
import { alertLessBox } from '../remediation.mjs';
import { boxHealthIo } from './health.mjs';
import { boxHealthIoFull } from './health.mjs';
import { boxHealthIso } from './health.mjs';
import { boxHealthPresent } from './health.mjs';
import { boxHealthShare } from './health.mjs';
import { boxStatusLine } from './operator.mjs';
import { capacityOf } from '../accounts.mjs';
import { claimRotation } from '../accounts.mjs';
import { cswapAccounts } from '../accounts.mjs';
import { die } from '../base.mjs';
import { draining } from '../fleet.mjs';
import { findCswap } from '../accounts.mjs';
import { flagStr } from '../base.mjs';
import { flags } from '../base.mjs';
import { flushAllHeld } from '../panes.mjs';
import { gb } from './operator.mjs';
import { harvestOf } from './operator.mjs';
import { hasWorktreeSetup } from '../accounts.mjs';
import { hours } from '../base.mjs';
import { hubLine } from './operator.mjs';
import { isAdopted } from '../recover.mjs';
import { isHeld } from '../graph.mjs';
import { isNum } from '../sensors.mjs';
import { kitDir } from '../state.mjs';
import { kitVersion } from '../lineage.mjs';
import { lastReview } from './operator.mjs';
import { leaveFullAccount } from '../accounts.mjs';
import { loadSettings } from '../settings.mjs';
import { logWriter } from '../log.mjs';
import { machineMemory } from './operator.mjs';
import { machineProjects } from '../recover.mjs';
import { machineRecords } from '../recover.mjs';
import { mainRoot } from '../state.mjs';
import { memo } from '../graph.mjs';
import { memoryAtOk } from './memory.mjs';
import { memoryFull } from './operator.mjs';
import { memoryIsMap } from './memory.mjs';
import { mergeShaFor } from '../repos.mjs';
import { modeOf } from '../holds.mjs';
import { noteSupervisorFromTick } from '../recover.mjs';
import { notedIn } from './operator.mjs';
import { notedPaneOf } from '../recover.mjs';
import { nowIso } from '../base.mjs';
import { nudgeResponder } from '../responder.mjs';
import { openQuestionsOf } from './operator.mjs';
import { ourWindows } from '../base.mjs';
import { out } from '../base.mjs';
import { paneKey } from '../panes.mjs';
import { paneState } from '../recover.mjs';
import { planners } from '../panes.mjs';
import { plural } from '../questions.mjs';
import { poolProblem } from './health.mjs';
import { portAnswers } from './operator.mjs';
import { projectDir } from '../state.mjs';
import { projectJson } from '../recover.mjs';
import { projectKit } from '../recover.mjs';
import { readJson } from '../base.mjs';
import { readNum } from './operator.mjs';
import { readText } from '../base.mjs';
import { relaunchGone } from '../accounts.mjs';
import { resendSupervisorLostEnter } from '../panes.mjs';
import { resolvePane } from '../sessions.mjs';
import { rest } from '../base.mjs';
import { restartPane } from '../accounts.mjs';
import { restartSupervisor } from '../accounts.mjs';
import { rotateAccounts } from '../accounts.mjs';
import { runDir } from '../state.mjs';
import { safe } from '../box-pins.mjs';
import { sessionMode } from '../holds.mjs';
import { sessionsToRelaunch } from '../accounts.mjs';
import { sh } from '../base.mjs';
import { siblingOf } from '../recover.mjs';
import { spawnSync } from 'node:child_process';
import { startHub } from '../presence.mjs';
import { supervisorLimit } from '../accounts.mjs';
import { supervisorPaneIn } from '../recover.mjs';
import { supervisorTarget } from '../sessions.mjs';
import { tickets } from '../graph.mjs';
import { tmuxSession } from '../base.mjs';
import { utcDay } from './operator.mjs';
import { versionBefore } from './operator.mjs';
import { warn } from '../base.mjs';
import { workerState } from '../graph.mjs';
import { writeText } from '../recover.mjs';
/* imports end */
/* box-health-pool start */
// answer.pool (kit-842): every project's worker pool, read from its supervisor's
// run/cache/pool.json (pool@1), with each worker's CPU, memory and disk joined to it.
//
// Every 15 s of now() it reads again when a minute of now() has passed since the last read, or when
// ctx.roots() gives a new list (the first read follows the sampler's first read of the roots). A read,
// never two at once: ctx.scan() for the dashboards' hellos, then for each known root, one at a time,
// <root>/docs/devteam/run/cache/pool.json (at most 256 KB + 1 read; poolProblem judges it) and, for
// a root no hello answers for, whether its dashboard is slow or gone (below). Each file read is raced
// with 2 s of real(): one that hasn't answered keeps that root's last read (its at still ages it), and
// isn't asked again until it settles. At most two reads are out at once, across every project: while
// two are, a root whose read can't start keeps its last read too, so hung files never hold more than
// two of the hub's file threads. Each is a read of the hub's budget (boxHealthIo, kit-919) as well: one
// the budget can't start is late at once, the same way.
//
// A project's dashboard, from the hub's scan (which can't tell a refused port from a slow one):
//   up     a hello names the root: its port and its fleet's mode are the hello's
//   slow   no hello, but its port (the last hello's for the root, else its run/dashboard-port, or
//          while that read is late the port its last read had) takes a TCP connection, or doesn't
//          answer the connection within 1 s of real(): still counted, with that port and the last
//          hello's mode
//   none   no port known, the port refuses the connection, or another root's hello holds it: not
//          counted, and its rows have no port
// A project's ready, for answer.headroom and the parts after it:
//   not counted   dashboard none
//   0             its fleet is parked or drained (the hello's fleet.mode park or drain), whatever its
//                 file's age
//   unknown       no file, a file poolProblem refuses, or one whose at is over 15 minutes of real()
//                 old: its name is in ready_unknown, and its ready counts for nothing. A stale
//                 file's rows stay, marked by the project's at; a refused file gives none
//   its file's    otherwise
//
// part(ctx, parts) joins the last read with parts.processes (kit-837's result: places by root and
// worktree, outside, unattributed, strays; undefined without /proc or before two whole walks) and
// parts.disk ({ worktrees: [{ root, worktree, disk?, disk_at }] }, kit-838's), and gives, as the same
// object while none of them changed:
//   answer.pool       box-health@1's projects, allocated, recent, others and strays. A project's cpu
//                     and rss are every place under its root (worktrees, planners, its supervisor).
//                     A worker is the place <root>/.worktrees/<its name>: agent is whether the walk
//                     saw an agent there (false with no process there). others: planners are the
//                     .worktrees/plan-* places, supervisors the roots' own places, outside and
//                     unattributed the walk's. Without parts.processes: no cpu, rss, tests, agent,
//                     others or strays. tokens are pool@1's, its new_hour as per_hour, its prices left
//                     out. Each allocated worker keeps one point a minute of now() for an hour (at
//                     most 60: cpu, rss, disk, those known; none is added when no worker has any, so the
//                     object stays the same); recent rows have last: the CPU and memory of its
//                     worktree's processes when the walk last saw any there, and the disk when a du
//                     last gave one, while it held its slot (absent when this run saw none, as after
//                     a restart or a stop and start). allocated: most CPU first, at most 60; recent: newest first, those
//                     left in 24 hours of real(), at most 20
//   answer.headroom   ready (over the projects counted and known), ready_unknown (their names)
//   projects          [{ root, name, port?, dashboard, mode, fresh, ready?, pool }] for the parts
//                     after it: pool is the file as read (pool@1), null when missing or refused
//   ready, ready_unknown   as in answer.headroom
// A process whose cmdline or cwd isn't read yet counts outside (kit-837), so a worker's figures can be
// low and outside high for a walk or two after the hub starts.
export const POOL_EVERY_MS = 15000, POOL_READ_MS = 60000, POOL_STALE_MS = 900000, POOL_KNOCK_MS = 1000, POOL_FILE_MS = 2000;
export const POOL_POINT_MS = 60000, POOL_POINTS = 60, POOL_HOUR_MS = 3600000, POOL_DAY_MS = 86400000;
export const POOL_ALLOCATED = 60, POOL_RECENT = 20, POOL_READS = 2;
export const boxHealthPool = (() => {
  let run = null;
  // a file's text, at most max bytes and one more (so poolProblem sees one over its size), or null
  const readCapped = async (file, max) => {
    let fh = null;
    try {
      fh = await fs.promises.open(file, fs.constants.O_RDONLY);
      const buf = Buffer.alloc(max + 1);
      const { bytesRead } = await fh.read(buf, 0, max + 1, 0);
      return buf.toString('utf8', 0, bytesRead);
    } catch { return null; } finally { await fh?.close().catch(() => {}); }
  };
  // a file read raced with 2 s of real(): its text, null, or late. At most two reads are ever out,
  // across every project and read (final-1 F1): a read still out goes on alone and keeps its place,
  // and one that can't start (its own still out, or two out) is late at once. So hung files hold at
  // most two of the threads every file read in the hub shares, as the sampler's volumes and the
  // processes walk do.
  const LATE = Symbol('late');
  const settled = (ctx, r, file, max) => {
    if (r.out.has(file) || r.out.size >= POOL_READS) { ctx.say("two file reads are out: a project whose read can't start keeps its last read"); return Promise.resolve(LATE); }
    // and a read of the hub's budget (kit-919): one that can't start is late too
    const read = boxHealthIo(file, () => readCapped(file, max));
    if (read === null) { if (boxHealthIoFull()) ctx.say(BOX_HEALTH_FULL); return Promise.resolve(LATE); }
    r.out.add(file);
    const p = read.finally(() => r.out.delete(file));
    let end = () => {};
    const late = new Promise((res) => { end = ctx.timeout(POOL_FILE_MS, () => res(LATE)); });
    return Promise.race([p, late]).finally(() => end());
  };
  // open (it takes a connection), slow (no answer in 1 s) or refused (anything else)
  const knock = (ctx, r, port) => new Promise((res) => {
    let done = false, end = () => {};
    const s = net.connect({ port, host: '127.0.0.1' });
    r.sockets.add(s);
    const settle = (v) => { if (done) return; done = true; end(); r.sockets.delete(s); s.destroy(); res(v); };
    end = ctx.timeout(POOL_KNOCK_MS, () => settle('slow'));
    s.once('connect', () => settle('open'));
    s.once('error', () => settle('refused'));
  });
  const portOf = (v) => (Number.isSafeInteger(v) && v >= 1 && v <= 65535 ? v : undefined);
  const modeOf = (h) => (h?.fleet?.mode === 'park' || h?.fleet?.mode === 'drain' ? h.fleet.mode : 'run');
  const read = async (ctx, r) => {
    const roots = ctx.roots();
    r.readAt = ctx.now(); r.rootsOf = roots;
    let list = [];
    try { list = await ctx.scan(); } catch { list = []; }
    if (run !== r || ctx.stopped()) return;
    const hellos = new Map();
    for (const h of Array.isArray(list) ? list : []) if (memoryIsMap(h) && typeof h.root === 'string' && portOf(h.port) && !hellos.has(h.root.replace(/\/+$/, ''))) hellos.set(h.root.replace(/\/+$/, ''), h);
    for (const [root, h] of hellos) r.hellos.set(root, { port: h.port, mode: modeOf(h) });
    const held = new Map([...hellos].map(([root, h]) => [h.port, root]));
    const files = [];
    for (const { root, name } of roots) {
      const run_ = path.join(root, 'docs', 'devteam', 'run');
      const text = await settled(ctx, r, path.join(run_, 'cache', 'pool.json'), POOL_MAX_BYTES);
      if (run !== r || ctx.stopped()) return;
      // this root's last read: kept by a read that is late
      const was = r.files.find((x) => x.root === root);
      let f;
      if (text === LATE) {
        // its last read stands (its at still ages it), or none
        f = { root, name, pool: was?.pool ?? null, refused: !!was?.refused };
        ctx.say("a project's pool.json did not answer within 2 s: its last read is kept");
      } else {
        const pool = text === null || poolProblem(text) ? null : JSON.parse(text);
        f = { root, name, pool, refused: text !== null && !pool };
      }
      const h = hellos.get(root);
      if (h) Object.assign(f, { dashboard: 'up', port: h.port, mode: modeOf(h) });
      else {
        const last = r.hellos.get(root);
        let saved;
        if (last?.port === undefined) { const t = await settled(ctx, r, path.join(run_, 'dashboard-port'), 16); saved = t === LATE ? was?.port : portOf(Number(t?.trim())); }
        const port = last?.port ?? saved;
        const how = port === undefined || (held.has(port) && held.get(port) !== root) ? 'refused' : await knock(ctx, r, port);
        if (run !== r || ctx.stopped()) return;
        Object.assign(f, how === 'refused' ? { dashboard: 'none', mode: last?.mode ?? 'run' } : { dashboard: 'slow', port, mode: last?.mode ?? 'run' });
      }
      files.push(f);
    }
    r.files = files;
    r.version++;
  };
  // pool@1's tokens as box-health@1's: new_hour is per_hour, prices and review hours are left out
  const tokensOf = (t) => {
    const out = { state: t.state };
    for (const k of ['reason', 'new', 'cached', 'points', 'reviews_new']) if (t[k] !== undefined) out[k] = t[k];
    if (t.state === 'measured' && t.new_hour !== undefined) out.per_hour = t.new_hour;
    return out;
  };
  const keyOf = (root, name) => `${root}\0${name}`;
  const build = (ctx, r, procs, disk) => {
    const real = ctx.real();
    const places = procs ? procs.places : [];
    const hasCpu = !!procs && procs.over_s !== undefined;
    const sum = (list) => {
      const out = { n: list.length, rss: list.reduce((a, p) => a + p.rss, 0) };
      if (hasCpu) out.cpu = list.reduce((a, p) => a + (p.cpu ?? 0), 0);
      return out;
    };
    const diskOf = (root, name) => (Array.isArray(disk?.worktrees) ? disk.worktrees.find((d) => d?.root === root && d?.worktree === name) : undefined);
    const projects = [], allocated = [], recent = [], forParts = [];
    let ready = 0;
    const unknown = [];
    for (const f of r.files) {
      const fresh = !!f.pool && real - Date.parse(f.pool.at) <= POOL_STALE_MS;
      const counted = f.dashboard !== 'none';
      const parked = f.mode === 'park' || f.mode === 'drain';
      const known = parked || fresh;
      const own = procs ? sum(places.filter((p) => p.root === f.root)) : null;
      const row = { name: f.name };
      if (f.port !== undefined) row.port = f.port;
      if (f.pool) {
        row.at = f.pool.at; row.workers = f.pool.workers.length; row.planners = f.pool.planners;
        if (f.pool.cap !== undefined) row.cap = f.pool.cap;
      }
      let mine;
      if (counted && known) { mine = parked ? 0 : f.pool.ready; row.ready = mine; ready += mine; } else if (counted) unknown.push(f.name);
      if (own) { if (hasCpu) row.cpu = own.cpu; row.rss = own.rss; }
      projects.push(row);
      forParts.push({ root: f.root, name: f.name, ...(f.port !== undefined ? { port: f.port } : {}), dashboard: f.dashboard, mode: f.mode, fresh, ...(mine !== undefined ? { ready: mine } : {}), pool: f.pool });
      if (!f.pool) continue;
      const at = f.port !== undefined ? { port: f.port } : {};
      for (const w of f.pool.workers) {
        const a = { project: f.name, ...at, name: w.name };
        for (const k of ['title', 'phase', 'since']) if (w[k] !== undefined) a[k] = w[k];
        // what the walk and the du saw of it, for recent's last: a worktree with no process gives none
        const seen = {};
        if (procs) {
          const p = places.find((x) => x.root === f.root && x.worktree === w.name);
          if (p) { if (p.cpu !== undefined) seen.cpu = p.cpu; seen.rss = p.rss; }
          a.agent = (p?.agents ?? 0) > 0;
          if (hasCpu) a.cpu = p?.cpu ?? 0;
          a.rss = p?.rss ?? 0;
          a.tests = { n: p?.tests.n ?? 0, ...(hasCpu ? { cpu: p?.tests.cpu ?? 0 } : {}), rss: p?.tests.rss ?? 0 };
        }
        const d = diskOf(f.root, w.name);
        if (Number.isSafeInteger(d?.disk) && d.disk >= 0) a.disk = seen.disk = d.disk;
        if (d && memoryAtOk(d.disk_at)) a.disk_at = d.disk_at;
        a.tokens = tokensOf(w.tokens);
        const k = keyOf(f.root, w.name);
        const pts = r.points.get(k);
        if (pts?.length) a.points = pts.map((x) => ({ ...x }));
        allocated.push({ k, a, seen });
      }
      for (const w of f.pool.recent) {
        if (!(real - Date.parse(w.left_at) <= POOL_DAY_MS)) continue;
        const x = { project: f.name, ...at, name: w.name };
        if (w.title !== undefined) x.title = w.title;
        Object.assign(x, { left_at: w.left_at, why: w.why, tokens: tokensOf(w.tokens) });
        const last = r.last.get(keyOf(f.root, w.name));
        if (last) x.last = { ...last.use };
        recent.push(x);
      }
    }
    allocated.sort((x, y) => (y.a.cpu ?? -1) - (x.a.cpu ?? -1) || x.a.project.localeCompare(y.a.project) || x.a.name.localeCompare(y.a.name));
    recent.sort((x, y) => Date.parse(y.left_at) - Date.parse(x.left_at));
    const pool = { projects, allocated: allocated.slice(0, POOL_ALLOCATED).map((x) => x.a), recent: recent.slice(0, POOL_RECENT) };
    if (procs) {
      const others = {
        planners: sum(places.filter((p) => p.worktree?.startsWith('plan-'))),
        supervisors: sum(places.filter((p) => p.worktree === undefined)),
        outside: { n: procs.outside.n, ...(hasCpu ? { cpu: procs.outside.cpu ?? 0 } : {}), rss: procs.outside.rss },
      };
      if (procs.unattributed) others.unattributed = { cpu: procs.unattributed.cpu };
      pool.others = others;
      pool.strays = procs.strays;
    }
    const headroom = { ready, ...(unknown.length ? { ready_unknown: unknown } : {}) };
    return { answer: { pool, headroom }, projects: forParts, ready, ready_unknown: unknown, use: allocated };
  };
  return {
    start(ctx) {
      const r = { files: [], version: 0, readAt: -Infinity, rootsOf: null, reading: false, out: new Set(), hellos: new Map(), sockets: new Set(), points: new Map(), last: new Map(), pointAt: -Infinity, memo: null, given: undefined };
      run = r;
      ctx.every(POOL_EVERY_MS, async () => {
        if (r.reading || run !== r) return;
        if (ctx.roots() === r.rootsOf && ctx.now() - r.readAt < POOL_READ_MS) return;
        r.reading = true;
        try { await read(ctx, r); } finally { r.reading = false; }
      });
    },
    part(ctx, parts) {
      const r = run;
      if (!r || !r.files.length) return undefined;
      const procs = memoryIsMap(parts.processes) && Array.isArray(parts.processes.places) ? parts.processes : undefined;
      const disk = parts.disk;
      const now = ctx.now(), real = ctx.real();
      // a file turns stale with time alone: its freshness is part of what the answer is built from
      const stale = r.files.map((f) => (f.pool && real - Date.parse(f.pool.at) <= POOL_STALE_MS ? 1 : 0)).join('');
      const due = now - r.pointAt >= POOL_POINT_MS;
      const m = r.memo;
      const same = !!m && m.version === r.version && m.procs === procs && m.disk === disk && m.stale === stale;
      if (same && !due) return r.given;
      let got = build(ctx, r, procs, disk);
      // what was seen of each allocated worker: its last use, for recent, and a point a minute
      const live = new Set();
      let added = false;
      for (const { k, a, seen } of got.use) {
        live.add(k);
        const use = {};
        for (const f of ['cpu', 'rss', 'disk']) if (a[f] !== undefined) use[f] = a[f];
        if (Object.keys(seen).length) r.last.set(k, { at: real, use: { ...r.last.get(k)?.use, ...seen } });
        if (due && Object.keys(use).length) {
          added = true;
          const list = (r.points.get(k) ?? []).filter((x) => Date.parse(x.at) > now - POOL_HOUR_MS);
          list.push({ at: boxHealthIso(now), ...use });
          r.points.set(k, list.slice(-POOL_POINTS));
        }
      }
      for (const k of r.points.keys()) if (!live.has(k)) r.points.delete(k);
      for (const [k, v] of r.last) if (real - v.at > POOL_DAY_MS) r.last.delete(k);
      if (due) r.pointAt = now;
      // a minute with no point to add, and nothing else changed: the same object
      if (same && !added) return r.given;
      if (added) got = build(ctx, r, procs, disk);
      delete got.use;
      r.memo = { version: r.version, procs, disk, stale };
      r.given = got;
      return got;
    },
    stop() {
      if (run) for (const s of run.sockets) s.destroy();
      run = null;
    },
  };
})();
/* box-health-pool end */
/* box-health-claude start */
// answer.claude (kit-840): the cswap accounts, the burn rate over six hours, and whether the room
// lasts to the resets. Nothing is written, and cswap is never run here: accounts-tick's record is read.
//
// Every 15 s of now() it reads again once a minute of now() has passed since the last read (the first
// read follows the sampler's first read of the roots). A read: for each known root, one at a time,
// <root>/docs/devteam/run/accounts.json (at most 256 KB + 1), raced with 2 s of real(). At most two
// reads are out at once, never two of one file: a read that can't start (here, or in the hub's budget,
// boxHealthIo: kit-919), or hasn't answered in 2 s, keeps that file's last read. The record used is the freshest (by its at) whose capacity.list is a
// list, among those within 5 minutes of real() (one older, or ahead: a wrong clock, is dropped); with none, claude is absent (no cswap,
// an older kit's record, or a stopped tick). Each read that finds one adds a reading to the ring.
//
// A row is copied by named fields only (claudeRows), so no email or token can leave with it: a label
// with an @ (in any width), a control character or over 40 characters is "Account n".
//
// The ring holds the readings of the last six hours of now(), one a read. Burn (claudeBurn) is, per
// account, the sum of rises of its weekly percent over the highest reading so far of the same window,
// in points of one account-week. A window is new only when the reset time moves forward by more than
// an hour: cswap's times shift by a fraction of a second at each fetch, across a minute or an hour. A
// drop inside a window adds nothing; an absent reset time keeps the last seen; with none ever seen
// every rise counts. Accounts weigh equally unless every enabled account names a tier multiplier;
// then each weighs its tier over the mean tier, so "an account" stays the average one. The rate is the
// weighted burn over the hours the ring covers; under 30 minutes of readings it is measuring (no rate,
// no projection).
//
// projectClaude(accounts, rate, now) is the projection, for this part and the parts after it (park,
// room): capacity.list rows, points of an account-week an hour, and ms. It steps every 15 minutes to
// the last known reset, spending accounts as cswap's default best strategy does: the active one until
// 90%, then the one with the most room (100 less its higher window; on a tie, the sooner reset of
// that window, then the earliest slot), and
// the last tenth of each only when none is under 90%. An account is restored at its weekly reset (the
// next one a week on) and at its five-hour reset; one with a full per-model window, or a full
// five-hour window now, has no room until that resets (never, with no reset time). Disabled accounts
// and those that can't be read (no weekly percent, or a status that isn't ok) are left out: at_least
// is then true. It gives { lasts, runs_out_at, paused_until (the first step after running out with
// room again), next_reset_at (the earliest weekly reset after now), points [{ at, room }] (room in
// accounts' worth: the weekly room left of accounts that have room; at most 400: every change of
// direction, then evenly), switches [{ at, n }] (the account spent from, first the one it starts on, then
// each change), at_least }, or null with no reset ahead, or a rate that isn't 0 to 1e9. It looks at most
// 8 days ahead (a weekly reset is never further): a reset time past that, which only a garbled record
// gives, ends the steps at 8 days and doesn't come within them (task-3 F1).
// claudeSafeRate(accounts, now) is the highest rate, to 0.1, at which it lasts, or undefined when not
// even 0.1 does.
//
// part(ctx, parts) gives, as the same object until the next read:
//   answer.claude   accounts (enabled ones, at most 40: n, label, active, week_left, five_left,
//                   week_resets_at, five_resets_at, status), rate (absent while measuring),
//                   rate_hours, points (one a reading: at, room), projection (lasts, runs_out_at,
//                   next_reset_at, safe_rate, points; absent while measuring or with no reset ahead)
//   rows            the record's rows (claudeRows), rate, measuring, projection (projectClaude's),
//                   safe_rate (claudeSafeRate's), has_room (an account has room now)
export const CLAUDE_EVERY_MS = 15000, CLAUDE_READ_MS = 60000, CLAUDE_FRESH_MS = 300000, CLAUDE_FILE_MS = 2000, CLAUDE_READS = 2;
export const CLAUDE_MAX_BYTES = 262144, CLAUDE_RING_MS = 6 * 3600000, CLAUDE_MEASURING_MS = 1800000, CLAUDE_JUMP_MS = 3600000;
export const CLAUDE_STEP_MS = 900000, CLAUDE_POINTS = 400, CLAUDE_ACCOUNTS = 40, CLAUDE_LINE = 90;
export const CLAUDE_WEEK_MS = 7 * 86400000, CLAUDE_FIVE_MS = 5 * 3600000, CLAUDE_HOUR_MS = 3600000;
export const CLAUDE_AHEAD_MS = 8 * 86400000, CLAUDE_RATE_MAX = 1e9;
// capacity.list's rows, each built again from its named fields; null when it isn't a list
export function claudeRows(list) {
  if (!Array.isArray(list)) return null;
  const pct = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : undefined);
  const at = (t) => (memoryAtOk(t) ? t : undefined);
  const out = [], seen = new Set();
  for (const a of list) {
    if (!memoryIsMap(a) || !Number.isSafeInteger(a.n) || a.n < 1 || seen.has(a.n)) continue;
    seen.add(a.n);
    const label = typeof a.label === 'string' && a.label.trim() && a.label.length <= 40 && !/[@\p{C}]/u.test(a.label.normalize('NFKC')) ? a.label : `Account ${a.n}`;
    out.push(boxHealthPresent({
      n: a.n, label, active: a.active === true, disabled: a.disabled === true,
      status: typeof a.status === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(a.status) ? a.status : undefined,
      week_pct: pct(a.week_pct), week_resets_at: at(a.week_resets_at),
      five_pct: pct(a.five_pct), five_resets_at: at(a.five_resets_at),
      models_full: Array.isArray(a.models_full) ? a.models_full.filter(memoryIsMap).map((m) => boxHealthPresent({ resets_at: at(m.resets_at) })) : [],
      tier: Number.isSafeInteger(a.tier) && a.tier > 0 && a.tier < 1000 ? a.tier : undefined,
    }));
  }
  return out;
}
// each account's weight: 1, or its tier over the mean tier when every enabled account names one
export function claudeWeights(rows) {
  const live = rows.filter((a) => !a.disabled);
  if (!live.length || !live.every((a) => a.tier)) return () => 1;
  const mean = live.reduce((s, a) => s + a.tier, 0) / live.length;
  return (a) => (a.tier ? a.tier / mean : 1);
}
// the burn in the ring, weighted, for the accounts of the latest rows
export function claudeBurn(ring, rows) {
  const w = claudeWeights(rows);
  let burn = 0;
  for (const a of rows) {
    if (a.disabled) continue;
    let hi, reset;
    for (const x of ring) {
      const r = x.rows.find((y) => y.n === a.n);
      if (r?.week_pct === undefined) continue;
      const at = r.week_resets_at === undefined ? reset : Date.parse(r.week_resets_at);
      if (hi === undefined || (at !== undefined && reset !== undefined && at - reset > CLAUDE_JUMP_MS)) hi = r.week_pct;
      else if (r.week_pct > hi) { burn += (r.week_pct - hi) * w(a); hi = r.week_pct; }
      reset = at;
    }
  }
  return burn;
}
// the accounts as the projection spends them: readable, enabled, with ok usage
export function claudeState(rows, now) {
  const w = claudeWeights(rows);
  const t = (s) => (s === undefined ? undefined : Date.parse(s));
  const live = rows.filter((a) => !a.disabled);
  const known = live.filter((a) => a.status === 'ok' && a.week_pct !== undefined);
  const acc = known.map((a) => {
    const x = { n: a.n, w: w(a), active: a.active, week: a.week_pct, weekAt: t(a.week_resets_at), five: a.five_pct ?? 0, fiveAt: t(a.five_resets_at) };
    if (a.models_full.length) x.models = a.models_full.every((m) => m.resets_at) ? Math.max(...a.models_full.map((m) => t(m.resets_at))) : Infinity;
    // a reset already past has happened: restored now, the next one a period on
    claudeRestore(x, now);
    return x;
  });
  return { acc, at_least: known.length < live.length };
}
// the next reset after now, a whole number of periods on, in one step however far back a garbled time
// is (final-1 F1)
export const claudeRoll = (at, period, now) => at + Math.ceil((now - at + 1) / period) * period;
export function claudeRestore(x, now) {
  if (x.weekAt !== undefined && x.weekAt <= now) { x.week = 0; x.weekAt = claudeRoll(x.weekAt, CLAUDE_WEEK_MS, now); }
  if (x.fiveAt !== undefined && x.fiveAt <= now) { x.five = 0; x.fiveAt = claudeRoll(x.fiveAt, CLAUDE_FIVE_MS, now); }
  if (x.models !== undefined && x.models <= now) delete x.models;
}
export const claudeHasRoom = (x) => x.week < 100 && x.five < 100 && x.models === undefined;
export const claudeRawRoom = (acc) => acc.reduce((s, x) => s + (claudeHasRoom(x) ? (x.w * (100 - x.week)) / 100 : 0), 0);
export const claudeRound = (n) => Number(n.toFixed(3));
// the room of a reading, in accounts' worth
export const claudeRoom = (rows, now) => claudeRound(claudeRawRoom(claudeState(rows, now).acc));
// at most CLAUDE_POINTS of the projection's points: the first, the last and every change of direction
// (on the room unrounded, so rounding is no turn), then evenly; room is rounded as they are sent
export function claudeThin(points) {
  const sent = (list) => list.map((p) => ({ at: p.at, room: claudeRound(p.room) }));
  if (points.length <= CLAUDE_POINTS) return sent(points);
  const sign = (i) => { const d = points[i + 1].room - points[i].room; return Math.abs(d) < 1e-9 ? 0 : Math.sign(d); };
  const keep = new Set([0, points.length - 1]);
  for (let i = 1; i < points.length - 1; i++) if (sign(i - 1) !== sign(i)) keep.add(i);
  const even = (list, n) => (n <= 0 || !list.length ? [] : n === 1 ? [list[Math.floor((list.length - 1) / 2)]] : Array.from({ length: n }, (_, j) => list[Math.round((j * (list.length - 1)) / (n - 1))]));
  let idx = [...keep].sort((a, b) => a - b);
  if (idx.length > CLAUDE_POINTS) idx = even(idx, CLAUDE_POINTS);
  else {
    const rest = points.map((_, i) => i).filter((i) => !keep.has(i));
    idx = [...idx, ...even(rest, CLAUDE_POINTS - idx.length)].sort((a, b) => a - b);
  }
  return sent([...new Set(idx)].map((i) => points[i]));
}
export function projectClaude(accounts, rate, now) {
  const rows = claudeRows(accounts);
  if (!rows || !(typeof rate === 'number' && rate >= 0 && rate <= CLAUDE_RATE_MAX) || !Number.isFinite(now)) return null;
  return claudeProject(rows, rate, now, false);
}
// the steps of projectClaude over rows already rebuilt; quick (claudeSafeRate's trials) keeps no points
// or switches and stops at the first shortfall, giving only { lasts } (final-1 F4)
export function claudeProject(rows, rate, now, quick) {
  const { acc, at_least } = claudeState(rows, now);
  const ahead = acc.flatMap((x) => [x.weekAt, x.fiveAt, x.models]).filter((t) => Number.isFinite(t) && t > now);
  if (!ahead.length) return null;
  const end = Math.min(Math.max(...ahead), now + CLAUDE_AHEAD_MS);
  const weekly = acc.map((x) => x.weekAt).filter((t) => t !== undefined && t > now);
  const iso = boxHealthIso;
  const binding = (x) => Math.max(x.week, x.five);
  const recovers = (x) => (x.five > x.week ? x.fiveAt : x.weekAt) ?? Infinity;
  const before = (x, b) => binding(x) < binding(b) || (binding(x) === binding(b) && (recovers(x) < recovers(b) || (recovers(x) === recovers(b) && x.n < b.n)));
  const best = (list) => list.reduce((b, x) => (!b || before(x, b) ? x : b), null);
  const pick = (cur) => {
    if (cur && claudeHasRoom(cur) && binding(cur) < CLAUDE_LINE) return cur;
    const room = acc.filter(claudeHasRoom);
    const under = room.filter((x) => binding(x) < CLAUDE_LINE);
    if (under.length) return best(under);
    if (cur && claudeHasRoom(cur)) return cur;
    return best(room);
  };
  const points = [], switches = [];
  let cur = acc.find((x) => x.active), lasts = true, runsOut, pausedUntil, was = null;
  for (let ts = now; ; ts = Math.min(ts + CLAUDE_STEP_MS, end)) {
    for (const x of acc) claudeRestore(x, ts);
    if (!quick) points.push({ at: iso(ts), room: claudeRawRoom(acc) });
    if (!lasts && pausedUntil === undefined && acc.some(claudeHasRoom)) pausedUntil = ts;
    if (ts >= end) break;
    const step = Math.min(CLAUDE_STEP_MS, end - ts);
    const need0 = (rate * step) / CLAUDE_HOUR_MS;
    let need = need0;
    for (let guard = 0; need > 1e-9 && guard < 2 * acc.length + 2; guard++) {
      cur = pick(cur);
      if (!cur) break;
      if (cur !== was && !quick) { switches.push({ at: iso(ts), n: cur.n }); was = cur; }
      const line = binding(cur) < CLAUDE_LINE ? CLAUDE_LINE : 100;
      const take = Math.min(need, (line - cur.week) * cur.w);
      if (take <= 0) { cur = null; continue; }
      cur.week = Math.min(line, cur.week + take / cur.w);
      need -= take;
    }
    if (need > 1e-9 && lasts) { lasts = false; runsOut = ts + Math.round(step * (1 - need / need0)); }
    if (quick && !lasts) return { lasts };
  }
  if (quick) return { lasts };
  return boxHealthPresent({
    lasts, runs_out_at: lasts ? undefined : iso(runsOut), paused_until: pausedUntil === undefined ? undefined : iso(pausedUntil),
    next_reset_at: weekly.length ? iso(Math.min(...weekly)) : undefined, points: claudeThin(points), switches, at_least,
  });
}
export function claudeSafeRate(accounts, now) {
  const rows = claudeRows(accounts);
  if (!rows || !Number.isFinite(now)) return undefined;
  const lasts = (tenths) => claudeProject(rows, tenths / 10, now, true)?.lasts === true;
  if (!lasts(1)) return undefined;
  let lo = 1, hi = 2;
  while (lasts(hi)) { lo = hi; hi *= 2; if (hi > 1e7) return lo / 10; }
  while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (lasts(m)) lo = m; else hi = m; }
  return lo / 10;
}
export const boxHealthClaude = (() => {
  let run = null;
  const LATE = Symbol('late');
  // a file's text, at most max bytes and one more, or null
  const readCapped = async (file, max) => {
    let fh = null;
    try {
      fh = await fs.promises.open(file, fs.constants.O_RDONLY);
      const buf = Buffer.alloc(max + 1);
      const { bytesRead } = await fh.read(buf, 0, max + 1, 0);
      return buf.toString('utf8', 0, bytesRead);
    } catch { return null; } finally { await fh?.close().catch(() => {}); }
  };
  // raced with 2 s of real(); at most two out, never two of one file: one that can't start is late
  const settled = (ctx, r, file) => {
    if (r.out.has(file) || r.out.size >= CLAUDE_READS) { ctx.say("two file reads are out: a project whose accounts.json read can't start keeps its last read"); return Promise.resolve(LATE); }
    // and a read of the hub's budget (kit-919): one that can't start is late too
    const read = boxHealthIo(file, () => readCapped(file, CLAUDE_MAX_BYTES));
    if (read === null) { if (boxHealthIoFull()) ctx.say(BOX_HEALTH_FULL); return Promise.resolve(LATE); }
    r.out.add(file);
    const p = read.finally(() => r.out.delete(file));
    let end = () => {};
    const late = new Promise((res) => { end = ctx.timeout(CLAUDE_FILE_MS, () => res(LATE)); });
    return Promise.race([p, late]).finally(() => end());
  };
  // a record with a list: { at, rows }, else null
  const recordOf = (text) => {
    if (typeof text !== 'string' || text.length > CLAUDE_MAX_BYTES) return null;
    let o;
    try { o = JSON.parse(text); } catch { return null; }
    const rows = memoryIsMap(o) && memoryAtOk(o.at) && memoryIsMap(o.capacity) ? claudeRows(o.capacity.list) : null;
    return rows ? { at: o.at, rows } : null;
  };
  const build = (ctx, r, rec) => {
    const now = ctx.now();
    const ring = r.ring;
    const span = ring.length ? ring.at(-1).t - ring[0].t : 0;
    const accounts = rec.rows.filter((a) => !a.disabled).slice(0, CLAUDE_ACCOUNTS).map((a) => boxHealthPresent({
      n: a.n, label: a.label, active: a.active,
      week_left: a.week_pct === undefined ? undefined : 100 - a.week_pct, five_left: a.five_pct === undefined ? undefined : 100 - a.five_pct,
      week_resets_at: a.week_resets_at, five_resets_at: a.five_resets_at, status: a.status,
    }));
    const claude = { accounts, rate_hours: Number((span / CLAUDE_HOUR_MS).toFixed(2)), points: ring.map((x) => ({ at: boxHealthIso(x.t), room: x.room })) };
    const measuring = span < CLAUDE_MEASURING_MS;
    let rate, projection, safe;
    if (!measuring) {
      rate = Number((claudeBurn(ring, rec.rows) / (span / CLAUDE_HOUR_MS)).toFixed(2));
      claude.rate = rate;
      projection = projectClaude(rec.rows, rate, now);
      if (projection) {
        safe = claudeSafeRate(rec.rows, now);
        claude.projection = boxHealthPresent({ lasts: projection.lasts, runs_out_at: projection.runs_out_at, next_reset_at: projection.next_reset_at, safe_rate: safe, points: projection.points });
      }
    }
    return { answer: { claude }, rows: rec.rows, rate, measuring, projection: projection ?? undefined, safe_rate: safe, has_room: claudeState(rec.rows, now).acc.some(claudeHasRoom) };
  };
  const read = async (ctx, r) => {
    r.readAt = ctx.now();
    let best = null;
    const files = new Set();
    for (const { root } of ctx.roots()) {
      const file = path.join(root, 'docs', 'devteam', 'run', 'accounts.json');
      files.add(file);
      const text = await settled(ctx, r, file);
      if (run !== r || ctx.stopped()) return;
      let rec;
      if (text === LATE) rec = r.files.get(file) ?? null;
      else { rec = recordOf(text); r.files.set(file, rec); }
      if (rec && Math.abs(ctx.real() - Date.parse(rec.at)) <= CLAUDE_FRESH_MS && (!best || Date.parse(rec.at) > Date.parse(best.at))) best = rec;
    }
    for (const f of r.files.keys()) if (!files.has(f)) r.files.delete(f);
    const now = ctx.now();
    r.ring = r.ring.filter((x) => x.t >= now - CLAUDE_RING_MS);
    if (!best) { r.given = undefined; return; }
    r.ring.push({ t: now, rows: best.rows, room: claudeRoom(best.rows, now) });
    r.given = build(ctx, r, best);
  };
  return {
    start(ctx) {
      const r = { files: new Map(), out: new Set(), ring: [], readAt: -Infinity, reading: false, given: undefined };
      run = r;
      ctx.every(CLAUDE_EVERY_MS, async () => {
        if (r.reading || run !== r || ctx.now() - r.readAt < CLAUDE_READ_MS) return;
        // before the sampler's first read of the roots there is nothing to read yet; after it, none is no record
        if (!ctx.roots().length && r.readAt === -Infinity) return;
        r.reading = true;
        try { await read(ctx, r); } finally { r.reading = false; }
      });
    },
    part() { return run?.given; },
    stop() { run = null; },
  };
})();
/* box-health-claude end */
/* box-health-park start */
// answer.claude.park (kit-843): when Claude would run out, each project's goals whose parking would
// make it last. Nothing is read or written here and no timer is set: part() works from what the
// claude and pool parts gave this tick, and gives the same object while neither changed.
//
// parts.claude needs a rate (not measuring) and a projection; else park is absent. A projection that
// lasts has nothing to park: park is []. One that runs out with no safe_rate (no rate lasts) has park
// absent: no parking would make it last. One that runs out with a safe_rate has the rows below.
//
// The projects are parts.pool's with a pool.json (pool@1). Only one whose file is fresh (at most 15
// minutes old) gets a row: parking an unknown can't be promised. A stale file's hours, as of its
// file, are still in the total (spec-1 F5): that project's sessions are using the machine, and leaving
// them out would raise every share, so a row could read as enough when it isn't.
//   weight   each hour is usd_hour when every project with a file has every price (no usd_hour,
//            reviews_usd_hour or other.usd_hour is null), else new_hour. Both count Claude models
//            only (pool@1).
//   total    the hour every session used: over every project with a file, each worker's own hour, its reviewers'
//            hour, and other (supervisors, planners, the responder, ended sessions), each once. A
//            goal's hour is a second view of that use and isn't added (pool@1). Work that isn't
//            measured has no hour and is in no share.
//   share    a goal's hour over the total. A goal's hour is its workers', their reviewers', its
//            planners' and its ended sessions': its project's supervisor time is in other, so it is
//            in the total and in no goal's share (F3-3).
// A goal is offered when a worker holding a slot names it (something of it runs now) and its share
// is over 0 (parking it would slow the burn). Each project's row takes its goals lowest priority first
// (the highest priority number first; one with no priority before any with one; then the larger
// share, then the id) until the burn left, rate × (1 − the row's share), is at or under safe_rate:
// enough. A row that never gets there holds every goal offered, and is not enough. A project with no
// goal offered has no row. Rows that are enough come first, fewest goals first (then the larger
// share); then the rest, larger share first; ties by name, then port. Each row carries its project's
// port (absent with no dashboard), so two projects of one name keep a row each.
// It gives { answer: { claude: { park } } } (park [] too when it would run out and no goal can be
// offered: no fresh project, nothing running, or no measured use), or undefined.
export const boxHealthPark = (() => {
  let memo = null;
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const rows = (claude, pool) => {
    const known = (Array.isArray(pool?.projects) ? pool.projects : []).filter((p) => memoryIsMap(p) && memoryIsMap(p.pool));
    const projects = known.filter((p) => p.fresh === true);
    const priced = known.every(({ pool: f }) => f.other.usd_hour !== null && f.goals.every((g) => g.usd_hour !== null)
      && f.workers.every((w) => w.tokens.usd_hour !== null && w.tokens.reviews_usd_hour !== null));
    const k = priced ? 'usd_hour' : 'new_hour', rk = priced ? 'reviews_usd_hour' : 'reviews_new_hour';
    const hour = (v) => (isNum(v) ? v : 0);
    let total = 0;
    for (const { pool: f } of known) {
      total += hour(f.other[k]);
      for (const w of f.workers) total += hour(w.tokens[k]) + hour(w.tokens[rk]);
    }
    if (!(total > 0)) return [];
    const { rate, safe_rate: safe } = claude;
    const out = [];
    for (const p of projects) {
      const f = p.pool;
      const running = new Set(f.workers.map((w) => w.goal).filter((i) => i !== undefined));
      const rank = (g) => (Number.isSafeInteger(g.priority) ? g.priority : Infinity);
      const offered = f.goals.map((g, i) => ({ g, i, share: hour(g[k]) / total }))
        .filter((x) => running.has(x.i) && x.share > 0)
        .sort((a, b) => (rank(a.g) === rank(b.g) ? 0 : rank(b.g) > rank(a.g) ? 1 : -1) || b.share - a.share || (a.g.id < b.g.id ? -1 : a.g.id > b.g.id ? 1 : 0));
      if (!offered.length) continue;
      const goals = [];
      let share = 0, enough = false;
      for (const x of offered) {
        goals.push({ id: x.g.id, title: x.g.title });
        share += x.share;
        if (rate * (1 - share) <= safe + 1e-9) { enough = true; break; }
      }
      out.push({ fleet: p.name, ...(p.port !== undefined ? { port: p.port } : {}), goals, share: Number(boxHealthShare(share).toFixed(4)), enough, raw: share });
    }
    const byName = (a, b) => (a.fleet < b.fleet ? -1 : a.fleet > b.fleet ? 1 : 0) || (a.port ?? 0) - (b.port ?? 0);
    out.sort((a, b) => (a.enough === b.enough ? 0 : a.enough ? -1 : 1)
      || (a.enough ? a.goals.length - b.goals.length : 0) || b.raw - a.raw || byName(a, b));
    return out.map(({ raw, ...r }) => r);
  };
  const build = (claude, pool) => {
    if (!memoryIsMap(claude) || claude.measuring || !isNum(claude.rate) || !memoryIsMap(claude.projection)) return undefined;
    if (claude.projection.lasts === true) return { answer: { claude: { park: [] } } };
    if (claude.projection.lasts !== false || !isNum(claude.safe_rate)) return undefined;
    return { answer: { claude: { park: rows(claude, pool) } } };
  };
  return {
    start() { memo = null; },
    part(ctx, parts) {
      const claude = parts.claude, pool = parts.pool;
      if (memo && memo.claude === claude && memo.pool === pool) return memo.given;
      const given = build(claude, pool);
      memo = { claude, pool, given };
      return given;
    },
    stop() { memo = null; },
  };
})();
/* box-health-park end */
/* box-health-room start */
// answer.headroom, answer.pool.what_if and each sample's room (kit-844): how many more workers the box
// could hold and what limits it, and what if the pool were 0 to 20 more than it is. Nothing is read,
// written, stored or sent here, and no timer is set: part() works from what the sampler and the parts
// before it gave this tick, and every time is ctx.now()'s.
//
// Sessions. From the processes part's walks of the last five minutes of now() (each new result object is
// one walk): a session is a worktree place (<root>/.worktrees/<name>, planners' too) with an agent in it.
// What one holds is the 75th percentile (nearest rank) of its resident memory over every session of
// every walk kept, and its CPU the mean over those with CPU, times total over attributed: the walks'
// CPU of every place and outside, plus unattributed, over the first (1 when nothing is attributed), so
// work nobody's process shows isn't free. Until the first walk kept is five minutes of now() old, or
// with no session in the walks kept (or no /proc: no walks), memory and cpu are absent: there is
// nothing to measure from.
//   memory   (ceiling × max − used) ÷ what one holds, of the sampler's now.memory, whole, never below 0
//   cpu      0 when now.cpu.some60 is 40 or more; else (90% of now.cpu.limit − the mean of the samples'
//            cpu over the last minute) ÷ a session's CPU, whole, never below 0
// The token forecast, worked out again only when parts.claude is a new object (once a minute, at its
// read) or the hours it is built from change (the pool part gives a new object every walk, so its
// object alone is not a change), with the time then:
//   the hour   over every project with a pool.json (fresh or stale, as park's total): each hour is
//              usd_hour when every one has every price, else new_hour, as park weighs them. now is
//              their workers holding a slot; measured those whose tokens are measured. m is the mean of
//              a measured worker's hour and its reviewers' (another provider's worker is measured at
//              0 and counts); o is every file's other. An unmeasured worker is taken as average, and its
//              reviewers' hours count in neither. The whole hour (for no-claude-use) is o and every
//              worker's own and reviewers' hours.
//   burn(W)    R × (o + m·W) ÷ (o + m·now), R the claude part's rate; R itself at W = now
//   steps      W from 0 to now + 20, each projectClaude(rows, burn(W), the time) as lasts, runs_out_at
//              and paused_until; most_that_lasts the most workers whose step lasts
//   why        no forecast: the first that holds of no-cswap (no parts.claude), measuring,
//              no-projection (no projection, or a step that has none), too-many (now over 60),
//              no-claude-use (the whole hour is 0), none-measured, none-by-workers (m is 0)
// headroom.claude, one rule with the steps (claude_why whenever it is absent):
//   no parts.claude: absent, no-cswap. No account with room now: 0. With a forecast: absent (lasts)
//   when the top step lasts, 0 when none does, else most_that_lasts − now, never below 0. With none:
//   absent with why when why is no-cswap or measuring, or with no-projection when the claude part has
//   no projection; absent with no-claude-use when
//   the hour has no Claude use, or with none-by-workers when workers are measured and none used any
//   (even with too-many); else 0 when the claude part's projection runs out, absent (lasts) when it
//   lasts.
// headroom.room is the least of memory, cpu and claude (absent when none is there); binds is ready when
// every fleet is known (parts.pool gave ready and no ready_unknown) and ready is under room, else the
// first of memory, cpu, claude that is the least; starts the least of room and ready, only when every
// fleet is known. With no room figure, neither starts nor binds: there is nothing to compare ready to. sample.room is room. pool.what_if, once the first walk kept is five minutes old and
// parts.pool is there: now, measured, steps (each with the forecast's fields when there is one; none
// over 60 workers), most_that_lasts, memory_full_at and cpu_full_at (now + that room + 1), why. It gives
// the same object while nothing in it changed.
export const ROOM_WALKS_MS = 300000, ROOM_CPU_MS = 60000, ROOM_PRESSURE = 40, ROOM_CPU_SHARE = 0.9, ROOM_MORE = 20, ROOM_POOL_MAX = 60;
export const boxHealthRoom = (() => {
  let run = null;
  const num = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const whole = (n) => Math.max(0, Math.floor(n + 1e-9));
  // one walk, as what is kept of it
  const digest = (procs) => {
    const sessions = [];
    let attributed = 0;
    for (const p of procs.places) {
      if (!memoryIsMap(p)) continue;
      if (num(p.cpu)) attributed += p.cpu;
      if (p.worktree !== undefined && p.agents > 0 && num(p.rss)) sessions.push({ rss: p.rss, cpu: num(p.cpu) ? p.cpu : undefined });
    }
    if (num(procs.outside?.cpu)) attributed += procs.outside.cpu;
    const un = procs.unattributed?.cpu;
    return { at: procs.at, sessions, attributed: procs.over_s === undefined ? undefined : attributed, unattributed: num(un) ? un : undefined };
  };
  // what one session holds and uses, from the walks kept, or null
  const perSession = (walks) => {
    const rss = walks.flatMap((w) => w.sessions.map((s) => s.rss)).sort((a, b) => a - b);
    if (!rss.length) return null;
    const mem = rss[Math.ceil(0.75 * rss.length) - 1];
    const cpus = walks.flatMap((w) => w.sessions.map((s) => s.cpu)).filter(num);
    let attr = 0, all = 0;
    for (const w of walks) if (w.attributed !== undefined && w.unattributed !== undefined) { attr += w.attributed; all += w.attributed + w.unattributed; }
    const scale = attr > 0 ? all / attr : 1;
    return { mem, cpu: cpus.length ? (cpus.reduce((a, b) => a + b, 0) / cpus.length) * scale : undefined };
  };
  const memoryRoom = (now, one) => {
    const m = now?.memory;
    if (!one || !(one.mem > 0) || !memoryIsMap(m) || !num(m.ceiling) || !num(m.max) || !num(m.used)) return undefined;
    return whole((m.ceiling * m.max - m.used) / one.mem);
  };
  const cpuRoom = (ctx, now, samples, one) => {
    const c = now?.cpu;
    if (!one || !memoryIsMap(c)) return undefined;
    if (num(c.some60) && c.some60 >= ROOM_PRESSURE) return 0;
    if (!(one.cpu > 0) || !num(c.limit)) return undefined;
    const t = ctx.now();
    const last = (Array.isArray(samples) ? samples : []).filter((s) => memoryIsMap(s) && num(s.cpu) && t - Date.parse(s.at) < ROOM_CPU_MS).map((s) => s.cpu);
    if (!last.length) return undefined;
    return whole((ROOM_CPU_SHARE * c.limit - last.reduce((a, b) => a + b, 0) / last.length) / one.cpu);
  };
  const knownOf = (pool) => (Array.isArray(pool?.projects) ? pool.projects : []).filter((p) => memoryIsMap(p) && memoryIsMap(p.pool));
  // what the forecast is built from, of the pool: its counts, states and hours
  const hoursOf = (pool) => JSON.stringify(knownOf(pool).map(({ pool: f }) => [f.other, f.goals.map((g) => g.usd_hour === null),
    f.workers.map((w) => [w.tokens.state, w.tokens.usd_hour, w.tokens.new_hour, w.tokens.reviews_usd_hour, w.tokens.reviews_new_hour])]));
  // the token forecast: { now, measured, steps?, most?, why?, noUse, noneByWorkers }
  const forecast = (ctx, claude, pool) => {
    const known = knownOf(pool);
    const priced = known.every(({ pool: f }) => f.other.usd_hour !== null && f.goals.every((g) => g.usd_hour !== null)
      && f.workers.every((w) => w.tokens.usd_hour !== null && w.tokens.reviews_usd_hour !== null));
    const k = priced ? 'usd_hour' : 'new_hour', rk = priced ? 'reviews_usd_hour' : 'reviews_new_hour';
    const hour = (v) => (num(v) ? v : 0);
    let now = 0, measured = 0, mine = 0, o = 0, all = 0;
    for (const { pool: f } of known) {
      o += hour(f.other[k]);
      for (const w of f.workers) {
        now++;
        const h = hour(w.tokens[k]) + hour(w.tokens[rk]);
        all += h;
        if (w.tokens.state === 'measured') { measured++; mine += h; }
      }
    }
    all += o;
    const m = measured ? mine / measured : 0;
    const out = { now, measured, noUse: !(all > 0), noneByWorkers: measured > 0 && !(m > 0) };
    const why = !memoryIsMap(claude) ? 'no-cswap' : claude.measuring || !num(claude.rate) ? 'measuring' : !memoryIsMap(claude.projection) ? 'no-projection'
      : now > ROOM_POOL_MAX ? 'too-many' : out.noUse ? 'no-claude-use' : !measured ? 'none-measured' : out.noneByWorkers ? 'none-by-workers' : null;
    if (why) return { ...out, why };
    const t = ctx.now(), R = claude.rate, steps = [];
    for (let W = 0; W <= now + ROOM_MORE; W++) {
      const burn = W === now ? R : (R * (o + m * W)) / (o + m * now);
      const p = projectClaude(claude.rows, burn, t);
      if (!p) return { ...out, why: 'no-projection' };
      steps.push(boxHealthPresent({ workers: W, lasts: p.lasts, runs_out_at: p.runs_out_at, paused_until: p.paused_until }));
    }
    const lasting = steps.filter((s) => s.lasts);
    return { ...out, steps, ...(lasting.length ? { most: lasting.at(-1).workers } : {}) };
  };
  const claudeLimit = (claude, f) => {
    if (!memoryIsMap(claude)) return { why: 'no-cswap' };
    if (claude.has_room === false) return { n: 0 };
    if (f.steps) {
      if (f.steps.at(-1).lasts) return { why: 'lasts' };
      return { n: f.most === undefined ? 0 : Math.max(0, f.most - f.now) };
    }
    if (f.why === 'no-cswap' || f.why === 'measuring' || !memoryIsMap(claude.projection)) return { why: f.why };
    if (f.noUse) return { why: 'no-claude-use' };
    if (f.noneByWorkers) return { why: 'none-by-workers' };
    return claude.projection.lasts === false ? { n: 0 } : { why: 'lasts' };
  };
  return {
    start() { run = { walks: [], first: undefined, procs: undefined, memo: null, given: undefined, key: undefined }; },
    part(ctx, parts) {
      const r = run;
      if (!r) return undefined;
      const t = ctx.now();
      const procs = memoryIsMap(parts.processes) && Array.isArray(parts.processes.places) ? parts.processes : undefined;
      if (procs && procs !== r.procs && num(procs.at)) {
        r.procs = procs;
        r.walks.push(digest(procs));
        if (r.first === undefined) r.first = procs.at;
      }
      r.walks = r.walks.filter((w) => w.at > t - ROOM_WALKS_MS);
      const ready = r.first !== undefined && t - r.first >= ROOM_WALKS_MS;
      const one = ready ? perSession(r.walks) : null;
      const memory = memoryRoom(parts.now, one), cpu = cpuRoom(ctx, parts.now, parts.samples, one);
      const claude = memoryIsMap(parts.claude) ? parts.claude : undefined, pool = memoryIsMap(parts.pool) ? parts.pool : undefined;
      const hours = hoursOf(pool);
      if (!r.memo || r.memo.claude !== claude || r.memo.hours !== hours) r.memo = { claude, hours, f: forecast(ctx, claude, pool) };
      const f = r.memo.f;
      const lim = claudeLimit(claude, f);
      const headroom = {};
      const limits = [['memory', memory], ['cpu', cpu], ['claude', lim.n]].filter(([, v]) => v !== undefined);
      const fleetsKnown = !!pool && num(pool.ready) && !(Array.isArray(pool.ready_unknown) && pool.ready_unknown.length);
      if (limits.length) {
        const room = Math.min(...limits.map(([, v]) => v));
        headroom.room = room;
        if (fleetsKnown) headroom.starts = Math.min(room, pool.ready);
        headroom.binds = fleetsKnown && pool.ready < room ? 'ready' : limits.find(([, v]) => v === room)[0];
      }
      if (memory !== undefined) headroom.memory = memory;
      if (cpu !== undefined) headroom.cpu = cpu;
      if (lim.n !== undefined) headroom.claude = lim.n; else headroom.claude_why = lim.why;
      const answer = { headroom };
      if (ready && pool) {
        const w = { now: f.now, measured: f.measured };
        if (f.now <= ROOM_POOL_MAX) {
          w.steps = f.steps ? f.steps.map((s) => ({ ...s })) : Array.from({ length: f.now + ROOM_MORE + 1 }, (_, i) => ({ workers: i }));
        }
        if (f.most !== undefined) w.most_that_lasts = f.most;
        if (memory !== undefined) w.memory_full_at = f.now + memory + 1;
        if (cpu !== undefined) w.cpu_full_at = f.now + cpu + 1;
        if (!f.steps) w.why = f.why;
        answer.pool = { what_if: w };
      }
      const given = { answer, ...(headroom.room !== undefined ? { sample: { room: headroom.room } } : {}) };
      const key = JSON.stringify(given);
      if (key === r.key) return r.given;
      r.key = key;
      r.given = given;
      return given;
    },
    stop() { run = null; },
  };
})();
/* box-health-room end */
// The machine's own caps, not the host's: a platform caps CPU and memory in the cgroup, while
// /proc/meminfo and the CPU count say what the whole host has (a 4-CPU, 16 GB box reads 32 CPUs, 123 GB).
export function machineLine(last) {
  const [, total, , free] = (sh('df', ['-Pk', os.homedir()]) ?? '').split('\n').pop().trim().split(/\s+/).map(Number);
  const now = Math.floor(Date.now() / 1000);
  const wasFree = last.disk;
  const moved = wasFree === undefined ? 0 : Math.trunc((free - wasFree) / 1048576);
  const d = (free - wasFree) / 1048576;
  const trend = moved ? ` (${d > 0 ? '+' : ''}${Math.round(d)}G in ${Math.trunc((now - (last.at ?? now)) / 60)}m)` : '';
  const low = free < 20971520 || Math.floor((free * 100) / (total + 1)) < 15 ? ' LOW' : '';
  const cg = process.env.DEVTEAM_CGROUP ?? '/sys/fs/cgroup';
  const m = machineMemory();
  // the number memoryFull reads: with the page cache where the platform counts it
  const mem = m?.source === 'cgroup' ? `${GiB(m.inUse)} GB in use of ${GiB(m.max)} GB${m.cache !== undefined ? ` (${GiB(m.cache)} GB of it page cache, and ${GiB(m.idle)} GB of inactive cache left out)` : ''}` : m ? `${GiB(m.max - m.inUse)} GB free of ${GiB(m.max)} GB` : `${GiB(os.freemem())} GB free of ${GiB(os.totalmem())} GB`;
  // the CPUs it may use, and how much of the last minute every task stood waiting for one
  const [quota, period] = (readText(path.join(cg, 'cpu.max')) ?? '').trim().split(/\s+/);
  const cpus = quota && quota !== 'max' && Number(period) > 0 ? String(Number((Number(quota) / Number(period)).toPrecision(6))) : String(os.cpus().length || '?');
  const stall = /^full .*\bavg60=([\d.]+)/m.exec(readText(path.join(cg, 'cpu.pressure')) ?? '')?.[1];
  return { free, line: `machine: disk ${gb(free)} free of ${gb(total)}${low}${trend}; memory ${mem}; cpus ${cpus}${stall ? ` (all waiting ${Math.round(Number(stall))}% of the last minute)` : ''}; load ${os.loadavg().map((x) => x.toFixed(2)).join(' ')}` };
}
// What the last check-in saw, and what this one leaves for the next: kept at least DEVTEAM_STATUS_SECONDS
// (20 minutes), so a run by hand in between doesn't hide a change from the next check-in.
export const statusLastFile = () => path.join(os.homedir(), '.devteam', `status-last-${HUB_PORT}`);
// box-status's fleet= when goals are mixed: (2 of 11 goals running), with draining ones named too
export const partlyHeld = (f) => { const c = f?.goals; if (!c) return ''; const all = c.run + c.drain + c.park; if (!all || c.run === all || c.park === all || (c.drain === all)) return ''; return `(${c.run} of ${all} goals running${c.drain ? `, ${c.drain} draining` : ''})`; };
// How long a supervisor's loop has gone without a sign, in minutes, once that's SUPERVISOR_IDLE_MS or
// more; else null, and null when its kit keeps no record. The sign is its host check (run/host-claim.json,
// a plain file, so no network): every tick's observe-metrics makes one, and so does a wait every
// HOST_REFRESH_MS however long it runs, even offline, so a supervisor waiting between ticks never goes this long.
// One whose last check found another machine holding the repo was told to stop: never one to tick.
export const SUPERVISOR_IDLE_MS = 45 * 60000;
export function supervisorIdleMinutes(root) {
  let h = null;
  try { h = readJson(path.join(root, 'docs', 'devteam', 'run', 'host-claim.json')); } catch {}
  if (!h || typeof h !== 'object' || h.refused === true) return null;
  const seen = Math.max(Number(h.checked) || 0, Date.parse(h.at) || 0);
  const age = Date.now() - seen;
  return seen > 0 && age >= SUPERVISOR_IDLE_MS ? Math.floor(age / 60000) : null;
}
export async function machineStatus() {
  const lastText = readText(statusLastFile()) ?? '';
  const last = { at: Number(/^at (\d+)$/m.exec(lastText)?.[1] ?? NaN), disk: /^disk (\d+)$/m.test(lastText) ? Number(/^disk (\d+)$/m.exec(lastText)[1]) : undefined };
  if (!Number.isFinite(last.at)) last.at = undefined;
  const { free, line } = machineLine(last);
  out(line);
  const roots = machineProjects().filter(isAdopted);
  // the freshest of each project's record of its accounts (accounts-tick writes it each minute); cswap itself is never run here
  const acc = roots.map((r) => { try { const a = readJson(path.join(r, 'docs', 'devteam', 'run', 'accounts.json')); return a && typeof a.at === 'string' ? a : null; } catch { return null; } }).filter(Boolean).sort((x, y) => y.at.localeCompare(x.at))[0];
  out(acc ? `machine: accounts ${acc.cswap ? 'cswap' : 'no-cswap'} active=${acc.active ?? '?'} exhausted=${acc.exhausted ?? false} no-room=${acc.active_no_room ?? false} needs-login=${(Array.isArray(acc.needs_login) ? acc.needs_login.join(',') : '') || '-'} as of ${acc.at}` : 'machine: accounts ? (no dashboard has recorded any)');
  const cap = acc?.capacity;
  if (cap && typeof cap.accounts === 'number') {
    const when = (t) => (t ? t.slice(0, 16).replace('T', ' ') : '-');
    // NONE only when every account is known to be full: usage that can't be read is unknown, not none
    const unknown = typeof cap.unknown === 'number' ? cap.unknown : 0;
    const flag = cap.room === 0 && unknown === 0 && cap.accounts > 0 ? ' NONE' : cap.gap ? ' GAP' : cap.room + unknown <= 1 && cap.accounts > 1 ? ' THIN' : '';
    out(`machine: capacity ${cap.room} of ${cap.accounts} accounts with room${unknown ? `, ${unknown} unknown (usage unreadable)` : ''}${flag}; active ${cap.active_week_pct ?? '?'}% week, ${cap.active_5h_pct ?? '?'}% 5h; room runs out ${cap.runs_out_at ? when(cap.runs_out_at) : cap.room ? 'after the next reset' : unknown ? 'unknown' : 'now'}; next reset ${when(cap.next_reset_at)}`);
  }
  // a hub that doesn't answer and each project's dashboard: nothing else says they went down
  const alert = readText(path.join(os.homedir(), '.box', 'alert'))?.trim();
  out(`machine: hub ${HUB_PORT} ${await hubLine(HUB_PORT)}${alert ? `; alert: ${alert}` : ''}`);
  const boxed = boxStatusLine();
  if (boxed) out(boxed);
  // after the box line, which stays right after the hub's; the file name only, never the root it holds
  for (const s of machineRecords().strays) out(`machine: stray hub record ${/^[\w.-]{1,80}$/.test(s.file) ? s.file : '?'} (${s.why}; ignored, remove it)`);
  const notes = notedIn();
  if (flagStr('notes')) { const r = lastReview(notes); out(r === utcDay() ? `machine: daily review done ${r}` : `machine: daily review due (last ${r ?? 'never'})`); }
  // the operator's own PRs on the kit (operator.md, Pull requests upstream): one gh call, ? when it can't.
  // The search keeps the reply to PRs whose body has the operator's line (no fleet or owner PRs and
  // their comments); operatorPrsLine checks the line exactly, since search matches words, not lines
  if (flagStr('notes')) out(`machine: ${operatorPrsLine(sh('gh', ['pr', 'list', '-R', KIT_UPSTREAM, '--author', '@me', '--state', 'open', '--search', `"${OPERATOR_PR_MARK}" in:body`, '--limit', '100', '--json', 'number,headRefName,body,isDraft,headRefOid,createdAt,latestReviews,comments,statusCheckRollup'], { timeout: 15000, maxBuffer: 16 * 1024 * 1024 }))}`); // gh-direct: the kit's own repo, which no project here speaks for
  const flagged = [];
  const latest = new Map();
  for (const root of roots) {
    const n = path.basename(root);
    const runAt = (f) => path.join(root, 'docs', 'devteam', 'run', f);
    const hello = projectJson(root, ['hello', '--json']) ?? {};
    const files = projectJson(root, ['settings', '--get', 'worktree_files']);
    const missing = (Array.isArray(files) ? files : []).filter((f) => typeof f === 'string' && !fs.existsSync(path.join(root, f)));
    const mise = spawnSync('mise', ['ls', '--current', '--missing'], { cwd: root, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] });
    const tools = mise.error ? '?' : mise.stdout.split('\n').map((l) => l.trim().split(/\s+/)).filter(([t, v]) => t && v).map(([t, v]) => `${t}@${v}`).join(',') || 'ok';
    let rec = null;
    try { rec = readJson(runAt('supervisor-up.json')); } catch {}
    if (!rec || typeof rec !== 'object') rec = null;
    const noted = notedPaneOf(root);
    const sup = supervisorPaneIn(root, noted, rec) ? 'up' : 'down';
    const p = supervisorPaneIn(root, noted, rec, { strict: true });
    const kit = typeof hello.kit === 'string' ? hello.kit : '?';
    // the newest release of the project's own upstream, asked once per upstream
    const upstream = (projectKit(root, ['settings', '--get', 'upstream_repo']) ?? '').trim();
    if (upstream && !latest.has(upstream)) latest.set(upstream, sh('gh', ['release', 'list', '-R', upstream, '--limit', '1', '--json', 'tagName', '-q', '.[0].tagName'], { timeout: 8000 }) || null); // gh-direct: another project's upstream, named by -R; no repo of this kit's speaks for it
    const newest = latest.get(upstream);
    const base = kit.split('+')[0];
    const behind = newest && base !== newest && /^v\d/.test(base) && versionBefore(base, newest) ? ` behind=${newest}` : '';
    const port = readNum(runAt('dashboard-port')) ?? [...(readText(runAt('dashboard.log')) ?? '').matchAll(/started on http:\/\/127\.0\.0\.1:(\d+)/g)].pop()?.[1];
    const dash = port ? `${port}/${await portAnswers(port)}` : '-';
    let wt = '-';
    const wtDir = path.join(root, '.worktrees');
    if (fs.existsSync(wtDir)) {
      const du = spawnSync('du', ['-sk', wtDir], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] });
      const k = Number(du.stdout?.split(/\s/)[0]);
      wt = `${fs.readdirSync(wtDir).length}/${du.status === 0 && Number.isFinite(k) ? gb(k) : '?'}`;
    }
    const qs = openQuestionsOf(root);
    const q = qs ? qs.filter((x) => x?.id && !(notes && notes.includes(x.id))).length : '?';
    const ks = harvestOf(root, notes);
    // the box's own alert has the hub line; only the project's part is this project's attention
    const ownAlert = alertLessBox(hello.alert, hello.box_alert);
    if (ownAlert) flagged.push(`attention: ${n}: ${ownAlert}`);
    const state = p ? paneState(p) : null;
    // up, idle at its prompt, its fleet running or draining (a drain still merges what is in flight),
    // and no sign of its loop for 45 minutes: it ended its turn and stopped ticking (a resume that
    // only wrote the owner a summary), and nothing wakes it. Parked, it has nothing to start.
    const idle = sup === 'up' && state === 'ready' && ['run', 'drain'].includes(hello.fleet?.mode) ? supervisorIdleMinutes(root) : null;
    if (idle !== null) flagged.push(`attention: ${n} supervisor idle, not ticking for ${idle}m`);
    const sib = siblingOf(root, roots);
    out(`${n} sup=${sup} fleet=${hello.fleet?.mode ?? '?'}${partlyHeld(hello.fleet)} kit=${kit} inbox=${hello.inbox ?? '?'} missing=${missing.join(',') || '-'} tools=${tools}${behind}${p ? ` pane=${p} state=${state}` : ''} dash=${dash} wt=${wt} new-questions=${q} new-knowledge=${ks ? ks.length : '?'}${sib ? ` sibling-of=${path.basename(sib)}` : ''}`);
  }
  // every agent's pane (never the owner's shell, never read): those stuck, and those that moved since the last reading
  const panes = (sh('tmux', ['list-panes', '-a', '-F', '#{pane_id}\t#{window_name}\t#{pane_current_command}\t#{session_name}']) ?? '').split('\n').filter(Boolean).map((l) => l.split('\t'));
  const seen = [];
  const changed = [];
  for (const [id, win, cmd, sess] of panes) {
    if (['shell', 'operator', 'dashboard'].includes(win) || win.startsWith('dash-')) continue;
    const s = paneState(id, cmd ?? '');
    if (['shell', 'other', 'gone'].includes(s)) continue;
    if (['dialog', 'limit'].includes(s)) flagged.push(`attention: ${id} ${sess}:${win} ${s}`);
    // the spinner and its counters change by the second; the rest is the agent's work
    const shown = (sh('tmux', ['capture-pane', '-p', '-t', id]) ?? '').split('\n').filter((l) => l.trim() && !/tokens|esc to/.test(l)).slice(0, -3);
    const sum = crypto.createHash('sha1').update(shown.join('\n')).digest('hex').slice(0, 12);
    seen.push(`pane ${id} ${sum}`);
    if (!lastText.split('\n').includes(`pane ${id} ${sum}`)) changed.push(id);
  }
  for (const f of flagged) out(f);
  out(`changed since last reading: ${changed.join(' ')}`);
  const now = Math.floor(Date.now() / 1000);
  if (now - (last.at ?? 0) >= Number(process.env.DEVTEAM_STATUS_SECONDS ?? 1200)) writeText(statusLastFile(), [`at ${now}`, `disk ${free}`, ...seen].map((l) => `${l}\n`).join(''));
}
// The operator's open PRs on the kit, from gh pr list's JSON, as one digest line: those that need it
// now. A PR's verdicts are its GitHub reviews that approve or request changes, and quality.md §3's
// `Verdict: APPROVE|CHANGES <sha>` line in a review or comment (the operator's reviewers share its gh
// login, so most are comments). A PR needs the operator when its latest verdict is CHANGES at its
// head, when a check at its head failed, or when no verdict names its head a day after its last
// comment or review, or its opening (a fix pushed and never looked at again). Drafts wait.
// Which PRs are the operator's: the box's gh login is shared by the owner, the supervisors and other
// sessions, so --author @me is not enough. The operator ends every PR body it opens with the line
// OPERATOR_PR_MARK (operator.md, Pull requests upstream), and only a PR whose body has that line on
// its own counts: it is set when the PR is opened, needs no records to agree, and a reader can see
// it on the PR. Branches the fleets and the kit's own releases push (ticket/, plan/, chore-,
// release-prep-) aren't the operator's even so. gh gives a PR's first 100 comments: a longer
// thread's latest verdict is unread.
export const OPERATOR_PR_MARK = 'Opened by the box operator.';
export const OPERATOR_PR_WAIT_MS = 15 * 60000;
export function operatorPrsLine(text, now = Date.now()) {
  let prs;
  try { prs = JSON.parse(text); } catch { return 'operator PRs: ?'; }
  if (!Array.isArray(prs)) return 'operator PRs: ?';
  const marked = (body) => String(body ?? '').split(/\r?\n/).some((l) => l.trim() === OPERATOR_PR_MARK);
  const mine = prs.filter((p) => p && Number.isInteger(p.number) && typeof p.headRefName === 'string' && !/^(ticket\/|plan\/|chore-|release-prep-)/.test(p.headRefName) && marked(p.body) && p.isDraft !== true);
  if (!mine.length) return 'operator PRs: none open';
  const atHead = (sha, head) => typeof sha === 'string' && typeof head === 'string' && sha.length >= 7 && head.toLowerCase().startsWith(sha.toLowerCase());
  const RED = new Set(['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE', 'ACTION_REQUIRED', 'ERROR']);
  // the line's last verdict; reviewers may add a note after the sha ("Verdict: CHANGES <sha> (F1, F2)")
  const verdictIn = (body, at) => {
    const v = [...String(body ?? '').matchAll(/^Verdict:[ \t]*(APPROVE|CHANGES)[ \t]+([0-9a-fA-F]{7,40})(?![0-9a-zA-Z])[^\n]*$/gm)].pop();
    return v ? { v: v[1], sha: v[2], at: String(at ?? '') } : null;
  };
  const need = [];
  for (const p of mine) {
    const verdicts = [];
    for (const r of Array.isArray(p.latestReviews) ? p.latestReviews : []) {
      if (!r) continue;
      const v = verdictIn(r.body, r.submittedAt);
      if (v) verdicts.push(v);
      else if (r.state === 'CHANGES_REQUESTED' || r.state === 'APPROVED') verdicts.push({ v: r.state === 'APPROVED' ? 'APPROVE' : 'CHANGES', sha: r.commit?.oid, at: String(r.submittedAt ?? '') });
    }
    for (const c of Array.isArray(p.comments) ? p.comments : []) {
      const v = c && verdictIn(c.body, c.createdAt);
      if (v) verdicts.push(v);
    }
    const last = verdicts.sort((x, y) => x.at.localeCompare(y.at)).pop();
    const why = [];
    if (last?.v === 'CHANGES' && atHead(last.sha, p.headRefOid)) why.push('changes requested');
    const checks = Array.isArray(p.statusCheckRollup) ? p.statusCheckRollup : [];
    if (checks.some((c) => c && (RED.has(c.conclusion) || RED.has(c.state)))) why.push('CI red');
    if (!last || !atHead(last.sha, p.headRefOid)) {
      // from its newest word: the operator comments what it changed when it pushes (operator.md); any
      // comment restarts the wait, so a thread kept busy without a verdict waits longer to be flagged
      const said = [p.createdAt, ...(Array.isArray(p.comments) ? p.comments.map((c) => c?.createdAt) : []), ...(Array.isArray(p.latestReviews) ? p.latestReviews.map((r) => r?.submittedAt) : [])];
      const since = Math.max(0, ...said.map((t) => Date.parse(t) || 0));
      const waited = since ? now - since : 0;
      if (waited > OPERATOR_PR_WAIT_MS) why.push(`${last ? 'no review of its head' : 'no review'} ${waited < 3600000 ? `${Math.floor(waited / 60000)}min` : `${Math.floor(waited / 3600000)}h`}`);
    }
    if (why.length) need.push(`#${p.number} ${why.join(' and ')}`);
  }
  return `operator PRs: ${mine.length} open, ${need.length ? `${need.length} need you (${need.join(', ')})` : 'none need you'}`;
}
export function accountsState() {
  try {
    const s = JSON.parse(readText(ACCOUNTS_FILE));
    const age = Date.now() - Date.parse(s.at);
    return age >= 0 && age < ACCOUNTS_FRESH_MS ? { ...s, active_no_room: s.active_no_room === true, needs_login: Array.isArray(s.needs_login) ? s.needs_login.map(String) : [], restart_gave_up: Array.isArray(s.restart_gave_up) ? s.restart_gave_up.map(String) : [], slot_held: Number.isInteger(s.slot_held) && s.slot_held > 0 ? s.slot_held : 0, slot_held_since: Number.isFinite(Date.parse(s.slot_held_since)) ? s.slot_held_since : null } : null;
  } catch { return null; }
}
// Not supervisorOnly: that records this process's pane as the supervisor's, and this runs under the dashboard.
export function cmdAccountsTick() {
  const began = Date.now();
  if (logWriter() !== 'supervisor' || ['worker', 'planner'].includes(process.env.DEVTEAM_ROLE)) die('accounts-tick: the supervisor does this');
  noteSupervisorFromTick();
  const bin = findCswap();
  const before = accountsState();
  const state = { at: nowIso(), cswap: !!bin, active: null, active_no_room: false, exhausted: false, needs_login: [], restart_gave_up: [], supervisor_limit: null, resumed: [], relaunched: [] };
  // sessions whose resume found no setup slot (restartPane or relaunchGone): no attempt, tried next tick
  state.slot_held = 0;
  let switched = false;
  let supervisorRestarted = false;
  let supervisorRefused = null;
  // sessions sent a prompt after a login change (loginChangedStop), not restarted: in resumed too
  const continued = new Set();
  // only the kit's own sessions, and only those it would launch now: a held one stays as it is
  const launchOf = (name) => (name.startsWith('plan-') ? ['planner', name.slice('plan-'.length)] : tickets().has(name) ? ['worker', name] : null);
  // a ticket's held field holds it too: nothing runs for a held ticket
  const held = (name) => ['done', 'parked'].includes(workerState(name)?.phase) || !!mergeShaFor(name) || isHeld(tickets().get(name) ?? {}) || ['park', 'let-go'].includes(sessionMode(name)) || !!draining();
  // one restart a tick (up to 3 relaunches, below), in what's left of it; the rest still report if
  // they've given up. A budget of 0 only looks: claimRestart takes nothing from the record.
  let tries = 0;
  const budget = (cap = 1, need = RESTART_MIN_MS) => { const left = RESTART_TICK_MS - (Date.now() - began); return tries >= cap || left < need ? 0 : Math.min(RESTART_CHILD_MS, left); };
  if (bin) {
    const who = (x) => (x && typeof x === 'object' ? x.email ?? x.alias ?? x.number ?? '?' : x ?? '?');
    const saySwitched = (e) => out(`cswap switched account${e.from || e.to ? `: ${who(e.from)} -> ${who(e.to)}` : ''}`);
    const claimed = !!flags.rotate && claimRotation();
    if (claimed) {
      const r = rotateAccounts(bin);
      if (!r.ok) out(r.failure);
      r.switched.forEach(saySwitched);
      switched = r.switched.length > 0;
      state.exhausted = r.exhausted;
    }
    const rows = cswapAccounts(bin);
    if (rows) {
      state.needs_login = rows.filter((a) => a.usageStatus === 'relogin_required').map((a) => String(a.alias ?? a.email ?? a.number));
      state.capacity = capacityOf(rows);
      const usable = rows.filter((a) => !a.disabled);
      if (usable.length && usable.every(accountKnownFull)) state.exhausted = true;
      const active = rows.find((a) => a.active);
      state.active = active ? String(active.email ?? active.number) : null;
      // What a session started now would run into: known full, or stopped on a per-model limit.
      state.active_no_room = !!active && (accountKnownFull(active) || (active.usageStatus === 'ok' && Array.isArray(active.usage?.scoped) && active.usage.scoped.some((x) => x?.pct >= 100)));
      if (claimed && !switched && accountKnownFull(active)) {
        const s = leaveFullAccount(bin, active, rows, began);
        if (s?.failure) out(s.failure);
        else if (s?.moved) {
          saySwitched(s);
          switched = true;
          state.exhausted = false;
          state.active = s.to ? String(s.to.email ?? s.to.number) : null;
          state.active_no_room = false;
        } else if (s) out(`cswap stayed on ${who(active)}: ${s.reason ?? 'no reason given'}`);
      }
      // A session holds the old login for about 30 s after a switch (macOS), and any dashboard's
      // rotation can be the one that switched: resume only on an account this project's last tick saw too.
      if (!switched && state.active && before?.active === state.active && accountHasRoom(active)) {
        const sup = restartSupervisor(budget());
        if (sup?.refused) { supervisorRefused = sup.refused; out(`the supervisor is stopped at a usage limit and was not restarted: ${sup.refused}`); }
        else if (sup === 'gave-up') state.restart_gave_up.push('supervisor');
        else if (sup) tries += 1;
        if (sup === 'restarted') { supervisorRestarted = true; out('restarted the supervisor: it had stopped at a usage limit'); }
        // continued, it is starting a turn as a restarted one is: no limit to report, no held line now
        if (sup === 'continued') { supervisorRestarted = true; state.resumed.push('supervisor'); continued.add('supervisor'); }
        for (const { name } of ourWindows(tmuxSession())) {
          const launch = launchOf(name);
          if (!launch || held(name)) continue;
          const did = restartPane(name, launch, budget());
          if (did === 'gave-up') state.restart_gave_up.push(name);
          else if (did === 'slot-held') state.slot_held += 1;
          else if (did) tries += 1;
          if (did === 'restarted' || did === 'continued') state.resumed.push(name);
          if (did === 'continued') continued.add(name);
        }
      }
      for (const w of state.resumed) out(continued.has(w) ? `continued ${w}: its login changed while it was stopped` : `restarted ${w}: it had stopped at a usage limit`);
    }
  }
  // After a dead machine, with or without cswap. Not onto an account known to be full: the session
  // would only stop again, and it is still there for a later tick.
  // Up to 3 a tick while the machine's memory is under its ceiling (or unread), and none at or over
  // it: memory is read again before each one, as a new start reads it, so a box near its cap waits
  // for room instead of coming back all at once (every fleet on a restarted box relaunches together:
  // up to 3 a tick each took a 32 GB box from 1 to 18 GB in three minutes, then past its cap). One
  // held for memory is still looked at with a budget of 0, so one past its caps is still said
  // (restart-gave-up); how many wait (memory_held) is said when it changes, not every minute. A
  // resume runs its repo's worktree_setup before its window exists, and that can take most of the
  // 100 s: a later relaunch whose repo has one starts only with the full 100 s left, so it is never
  // cut short into a spent attempt; it waits for the next tick instead.
  state.memory_held = 0;
  if (!state.active_no_room) {
    const gone = sessionsToRelaunch(launchOf, held);
    const settings = gone.length ? loadSettings() : null;
    let said = null;
    for (const { name, launch } of gone) {
      const full = memoryFull(settings);
      const could = full ? budget(3) : 0;
      if (full) said = full;
      const did = relaunchGone(name, launch, full ? 0 : budget(3, tries && tries < 3 && hasWorktreeSetup(name, launch) ? RESTART_CHILD_MS : RESTART_MIN_MS));
      if (did === 'gave-up') state.restart_gave_up.push(name);
      else if (did === 'slot-held') state.slot_held += 1;
      else if (did) tries += 1;
      else if (could) state.memory_held += 1;
      if (did === 'relaunched') { state.relaunched.push(name); out(`relaunched ${name}: its window was gone`); }
    }
    if (state.memory_held && state.memory_held !== before?.memory_held) out(`${plural(state.memory_held, 'gone session')} wait${state.memory_held === 1 ? 's' : ''} for room to relaunch: ${said.words}`);
  }
  // since when any has waited, kept while some still do, so the wait is a finding, never silent
  if (state.slot_held) state.slot_held_since = (before?.slot_held && before.slot_held_since) || state.at;
  if (state.slot_held && state.slot_held !== before?.slot_held) out(`${plural(state.slot_held, 'gone session')} wait${state.slot_held === 1 ? 's' : ''} for a setup slot`);
  // in tmux or not, with or without cswap; just restarted, it hasn't stopped
  state.supervisor_limit = supervisorRestarted ? null : supervisorLimit();
  if (state.supervisor_limit && supervisorRefused) state.supervisor_limit.refused = supervisorRefused;
  resendSupervisorLostEnter();
  // lines held while a pane asked (typeInto), typed once it is ready; never into a session this
  // tick just restarted, whose agent is still coming up
  const session = tmuxSession();
  const supKey = (() => { const { target } = resolvePane(supervisorTarget()); return target ? paneKey(target) : null; })();
  flushAllHeld([...(supervisorRestarted && supKey ? [supKey] : []), ...[...state.resumed.filter((n) => !(n === 'supervisor' && continued.has(n))), ...state.relaunched].map((n) => `${session}:${n}`)]);
  // an idle responder with turns queued for it is told so, once a minute (kit-104); a failure here
  // never stops the tick's own record
  try { nudgeResponder(); } catch (e) { warn(`responder nudge: ${e?.message ?? e}`); }
  fs.mkdirSync(runDir, { recursive: true });
  const tmp = `${ACCOUNTS_FILE}.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, ACCOUNTS_FILE);
}

// Why a server stopped, in its own log: a crash with its stack, or the signal that ended it.
export function processLog(log, name) {
  process.on('uncaughtException', (e) => { log(`crashed: ${e?.stack ?? e}`); process.stderr.write(`devteam ${name} crashed: ${e?.stack ?? e}\n`); process.exit(1); });
  process.on('unhandledRejection', (e) => { log(`crashed (unhandled rejection): ${e?.stack ?? e}`); process.stderr.write(`devteam ${name} crashed: ${e?.stack ?? e}\n`); process.exit(1); });
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { log(`stopped by ${sig}`); process.exit(0); });
}
// The hub alone has no run/ of its own: its log is the machine's, named for the hub port, and never
// passes 1 MB (checked at each write, the full one moved to .1). Also on stderr, for its window.
export function hubLogger() {
  const file = path.join(os.homedir(), '.devteam', `hub-${HUB_PORT}.log`);
  return (msg) => {
    const line = `${nowIso()} [${process.pid}] ${msg}\n`;
    process.stderr.write(line);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if ((fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0) + Buffer.byteLength(line) > 1024 * 1024) fs.renameSync(file, `${file}.1`);
      fs.appendFileSync(file, line);
    } catch {}
  };
}
// The running kit's version, when it is the project's own kit; null for a kit with no project (the
// image's), or one run against a project that isn't its checkout's (DEVTEAM_HOME, another repo's cwd).
export const ownKitVersion = () => (fs.existsSync(path.join(projectDir, 'settings.md')) && !path.relative(mainRoot, kitDir).startsWith('..') ? kitVersion() : null);
// hub [--release vX.Y.Z]: the machine's hub and nothing else, the way the box's boot runs it from the
// image's kit (--release is the image's, and only the boot passes it). It stays up whatever holds the
// port, retrying, so a restart loop around it never spins; a bad --release is said and served without.
export function cmdHub() {
  const log = hubLogger();
  processLog(log, 'hub');
  const rel = flagStr('release') ?? (flags.release === true ? '' : undefined);
  const ok = rel !== undefined && /^v\d+\.\d+\.\d+$/.test(rel);
  if (rel !== undefined && !ok) log(`hub: --release ${JSON.stringify(rel)} is not vX.Y.Z; serving with no release`);
  startHub(log, ok ? { kit: rel, image: true, standalone: true } : { kit: ownKitVersion(), standalone: true });
}

