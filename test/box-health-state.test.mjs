// The hub's disk and state parts (kit-838): each worktree's du, and the box's last start, OOM kills,
// GitHub allowance and kit against the newest release. The regions run here with only the names they
// read given to them, beside the regions they build on; a fake ctx drives them, so no timer fires by
// itself, and du and gh are fakes on a PATH of their own: no test reads this machine's /proc, cgroup
// or worktrees, or asks GitHub.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn as realSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checks, regionOf } from './fixtures/box-health/contract/check.mjs';
import { kit, until } from './lib/kit.mjs';

const { boxHealthProblem } = checks();
const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-boxstate-'));
// every fake's pid, from its log, so one a failed check left hanging (exec sleep) is killed at the end
const bins = [];
after(() => {
  for (const b of bins) for (const l of b.lines()) {
    const pid = Number(l.startsWith('start ') ? l.split(' ')[1] : /^\d+ /.test(l) ? l.split(' ')[0] : NaN);
    if (Number.isSafeInteger(pid) && pid > 1) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  }
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
let dirs = 0;
const newDir = () => { const d = path.join(scratch, `d${++dirs}`); fs.mkdirSync(d, { recursive: true }); return d; };
const T0 = Date.parse('2026-11-25T12:00:00.000Z');
const MIN = 60000;
const iso = (ms) => new Date(ms).toISOString();
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `${a} … ${b}`); return src.slice(i, j); };
const SECRET = 'SECRET-OUT-5c1d';

// The fakes. du logs "start <pid> <nice> <args>" and, when it ends by itself, "end <pid>"; what it does
// is the worktree's .du file: "kb <n>", "slow", "hang" (exec sleep: the same pid), "fail" (a number,
// then exit 1, as du does when it can't read part of a tree). gh logs
// "<pid> <args>" and does what $FAKE_GH's file says: ok, hang, fail, junk.
const realNice = process.env.PATH.split(':').map((d) => path.join(d, 'nice')).find((p) => fs.existsSync(p));
const DU = `#!/bin/sh
PATH=/usr/bin:/bin
d="$2"
echo "start $$ $(ps -o ni= -p $$ | tr -d ' ') $*" >> "$FAKE_LOG"
mode=$(cat "$d/.du" 2>/dev/null || echo "kb 8")
case "$mode" in
  hang) exec sleep 600 ;;
  fail) printf '77\\t%s\\n' "$d"; echo "${SECRET}"; echo "${SECRET}" >&2; exit 1 ;;
  slow) sleep 0.3; printf '12\\t%s\\n' "$d" ;;
  kb*) printf '%s\\t%s\\n' "\${mode#kb }" "$d" ;;
  big) printf '7\\t%s\\n' "$d"; printf '%05000d\\n' 0 ;;
esac
echo "end $$" >> "$FAKE_LOG"
`;
const GH = `#!/bin/sh
PATH=/usr/bin:/bin
echo "$$ $*" >> "$FAKE_LOG"
mode=$(cat "$FAKE_GH" 2>/dev/null || echo ok)
case "$mode" in
  hang) exec sleep 600 ;;
  fail) echo "${SECRET}"; echo "${SECRET}" >&2; exit 1 ;;
  junk) echo "${SECRET} is not JSON or a tag"; exit 0 ;;
  big) printf '{"resources":{"core":{"limit":5000,"used":1,"remaining":3120,"reset":1795600438}},"pad":"%070000d"}\\n' 0 ;;
  neg) echo '{"resources":{"core":{"limit":5000,"used":1,"remaining":-1,"reset":1795600438}}}' ;;
  frac) echo '{"resources":{"core":{"limit":5000.5,"used":1,"remaining":3120,"reset":1795600438}}}' ;;
  reset0) echo '{"resources":{"core":{"limit":5000,"used":1,"remaining":3120,"reset":0}}}' ;;
  far) echo '{"resources":{"core":{"limit":5000,"used":1,"remaining":3120,"reset":9000000000000}}}' ;;
  ok) if [ "$2" = rate_limit ]; then echo '{"resources":{"core":{"limit":5000,"used":1880,"remaining":3120,"reset":1795600438}},"rate":{"limit":5000}}'; else echo v0.93.0; fi ;;
esac
`;
// A bin folder: { dir, log, mode(file text) }; without: names left out of it ('du', 'gh').
function bin({ without = [] } = {}) {
  const dir = newDir(), log = path.join(dir, 'log'), gh = path.join(dir, 'gh.mode');
  fs.symlinkSync(realNice, path.join(dir, 'nice'));
  if (!without.includes('du')) fs.writeFileSync(path.join(dir, 'du'), DU, { mode: 0o755 });
  if (!without.includes('gh')) fs.writeFileSync(path.join(dir, 'gh'), GH, { mode: 0o755 });
  fs.writeFileSync(log, '');
  const made = { dir, log, env: { PATH: dir, FAKE_LOG: log, FAKE_GH: gh }, gh: (m) => fs.writeFileSync(gh, m), lines: () => { try { return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean); } catch { return []; } } };
  bins.push(made);
  return made;
}
// long enough for a call that starts nothing to have ended, and one that starts a child to have
const settle = () => new Promise((r) => setTimeout(r, 300));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// The regions with what they read; spawn is the real one, its calls kept.
// fake.stuck(cmd, args): that child is a stuck one (a process in the kernel): a kill doesn't end it,
// only its end(code) does. fake.readdir(p): a promise in place of fs.promises.readdir's, or undefined.
function load({ env = {}, port = 20002, roots = [] } = {}) {
  const spawned = [];
  const fake = { stuck: () => false, kids: [], readdir: () => undefined, out: 0, most: 0 };
  const stuckChild = () => {
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.kills = 0;
    c.kill = () => { c.kills++; return true; };
    c.end = (code = 1) => c.emit('close', code);
    fake.kids.push(c);
    return c;
  };
  const spawn = (cmd, args, opts) => { spawned.push({ cmd, args, opts }); return fake.stuck(cmd, args) ? stuckChild() : realSpawn(cmd, args, opts); };
  const promises = new Proxy(fs.promises, { get: (o, k) => (k === 'readdir' ? (p, ...a) => {
    const got = fake.readdir(String(p));
    if (!got) return o.readdir(p, ...a);
    fake.out++; fake.most = Math.max(fake.most, fake.out);
    return got.finally(() => { fake.out--; });
  } : o[k]) });
  const ffs = new Proxy(fs, { get: (o, k) => (k === 'promises' ? promises : o[k]) });
  const timers = { list: [] };
  const set = (kind) => (fn, ms) => { const h = { kind, ms, fn, unref() {} }; timers.list.push(h); return h; };
  const fos = { cpus: () => [], loadavg: () => [0, 0, 0], totalmem: () => 16e9, freemem: () => 4e9, homedir: () => path.join(scratch, 'nowhere') };
  const names = {
    fs: ffs, path, os: fos, Buffer, URL, process: { env, pid: 4242, memoryUsage: { rss: () => 1 } }, HUB_PORT: port, spawn, KIT_UPSTREAM: 'sanctuarycomputer/devteam',
    setTimeout: set('once'), clearTimeout: () => {}, setInterval: set('every'), clearInterval: () => {}, setImmediate, machineRepos: () => roots,
  };
  const helpers = ['readText', 'readNum'].map((n) => cut(`const ${n} = `, '\n')).join('\n');
  const memory = cut('const memoryCountsCache', 'const GiB');
  const regions = ['box-memory', 'box-health-contract', 'box-health-sampler', 'box-health-processes', 'box-health-disk', 'box-health-state'];
  const stubs = ['pool', 'claude', 'park', 'room'].map((n) => `/* box-health-${n} start */\nconst boxHealth${n[0].toUpperCase()}${n.slice(1)} = { start(ctx) {}, part(ctx, parts) {}, stop() {} };\n/* box-health-${n} end */`).join('\n');
  const code = `'use strict';\n${helpers}\n${memory}\n${regions.map((n) => regionOf(n, src)).join('\n')}\n${stubs}\nreturn { boxHealth, boxHealthParts, boxHealthDisk, boxHealthState };`;
  return { ...new Function(...Object.keys(names), code)(...Object.values(names)), spawned, timers, fake };
}
// A fake ctx: clocks set by the test, timers kept and fired by it.
function ctxOf({ roots = [], proc, cgroup, kit: k = null } = {}) {
  const clock = { now: T0, real: T0 }, said = [], timers = [];
  const keep = (kind) => (ms, fn) => { const t = { kind, ms, fn }; timers.push(t); return () => { t.ended = true; }; };
  const ctx = {
    now: () => clock.now, real: () => clock.real, kit: k,
    every: keep('every'), after: keep('after'), timeout: keep('timeout'), turn: async () => {},
    roots: () => roots, ceiling: () => 0.8, scan: async () => [],
    proc: proc ?? path.join(scratch, 'no-proc'), cgroup: cgroup ?? path.join(scratch, 'no-cgroup'), stopped: () => false, say: (w) => said.push(String(w)),
  };
  const live = (kind, ms) => timers.filter((t) => t.kind === kind && (ms === undefined || t.ms === ms) && !t.ended);
  return { ctx, clock, said, timers, live };
}
// A root with worktrees: { root, wt(name, mode) } making .worktrees/<name> with its .du
function rootWith(...names) {
  const root = newDir();
  fs.mkdirSync(path.join(root, '.worktrees'));
  const wt = (n, mode) => { const d = path.join(root, '.worktrees', n); fs.mkdirSync(d, { recursive: true }); if (mode) fs.writeFileSync(path.join(d, '.du'), mode); return d; };
  for (const n of names) wt(n);
  return { root, wt };
}
// The disk part started: look(ms) runs the minute's look, ms later.
function diskStarted(roots, b, s = load({ env: b.env })) {
  const c = ctxOf({ roots: roots.map((root, i) => ({ root, name: `p${i}` })) });
  s.boxHealthDisk.start(c.ctx);
  assert.deepEqual(c.timers.map((t) => [t.kind, t.ms]), [['every', MIN]], 'start sets one interval of a minute and nothing else');
  const fn = c.timers[0].fn;
  const look = async (ms = MIN) => { c.clock.now += ms; c.clock.real += ms; await fn(); };
  return { ...s, ...c, look, fn, part: () => s.boxHealthDisk.part(c.ctx, {}) };
}
const starts = (b) => b.lines().filter((l) => l.startsWith('start '));

// ===== disk =====

test('D1: each worktree is read when first seen, then every 15 minutes of now(), giving disk in bytes and disk_at', async () => {
  const b = bin();
  const r = rootWith('a', 'b');
  r.wt('a', 'kb 8'); r.wt('b', 'kb 300');
  fs.writeFileSync(path.join(r.root, '.worktrees', 'not-a-folder'), 'x');
  const d = diskStarted([r.root, path.join(scratch, 'no-such-root')], b);
  assert.equal(d.part(), undefined, 'nothing before a read');
  await d.look();
  const at = iso(T0 + MIN);
  assert.deepEqual(d.part(), { worktrees: [{ root: r.root, worktree: 'a', disk: 8 * 1024, disk_at: at }, { root: r.root, worktree: 'b', disk: 300 * 1024, disk_at: at }] });
  assert.equal(starts(b).length, 2);
  for (let i = 0; i < 13; i++) await d.look();
  await d.look();
  assert.equal(starts(b).length, 2, 'not again 14 minutes on');
  await d.look();
  assert.equal(starts(b).length, 4, 'both again 15 minutes after their read began');
  assert.equal(d.part().worktrees[0].disk_at, iso(T0 + 16 * MIN));
});

test('D2: one du at a time, and never two looks at once', async () => {
  const b = bin();
  const r = rootWith();
  r.wt('a', 'slow'); r.wt('b', 'slow');
  const d = diskStarted([r.root], b);
  d.clock.now += MIN;
  await Promise.all([d.fn(), d.fn()]);
  const kinds = b.lines().map((l) => l.split(' ')[0]);
  assert.deepEqual(kinds, ['start', 'end', 'start', 'end'], 'each du ends before the next starts, and the second look read nothing');
});

test('D3: du runs as nice -n 19 du -skx <worktree>, at the lowest priority', async () => {
  const b = bin();
  const r = rootWith('a');
  const d = diskStarted([r.root], b);
  await d.look();
  const [, , ni, ...args] = starts(b)[0].split(' ');
  assert.equal(ni, '19', 'the lowest CPU priority');
  assert.deepEqual(args, ['-skx', path.join(r.root, '.worktrees', 'a')]);
  assert.deepEqual(d.spawned.map((x) => [x.cmd, x.args.slice(0, 4)]), [['nice', ['-n', '19', 'du', '-skx']]]);
});

test('D4: a du still running at 60 s is killed, and its worktree has disk_at and no disk until a read ends', async () => {
  const b = bin();
  const r = rootWith();
  r.wt('a', 'kb 5');
  const d = diskStarted([r.root], b);
  await d.look();
  assert.equal(d.part().worktrees[0].disk, 5120);
  r.wt('a', 'hang');
  const looking = d.look(15 * MIN);
  await until(() => starts(b).length === 2, 'the second du');
  const pid = Number(starts(b)[1].split(' ')[1]);
  const [limit] = d.live('timeout');
  assert.equal(limit.ms, 60000, 'stopped at 60 s of real()');
  d.clock.now += 30000;
  limit.fn();
  await looking;
  await until(() => !alive(pid), 'the du is killed');
  assert.deepEqual(d.part().worktrees, [{ root: r.root, worktree: 'a', disk_at: iso(T0 + 16 * MIN + 30000) }]);
  assert.ok(d.said.some((w) => /ran 60 s and was stopped/.test(w)));
  r.wt('a', 'kb 7');
  await d.look(15 * MIN);
  assert.equal(d.part().worktrees[0].disk, 7168, 'back when a read ends');
});

test('D5: a failing or missing du leaves disk out, and nothing of its output is kept or said', async () => {
  for (const [b, mode] of [[bin(), 'fail'], [bin({ without: ['du'] }), 'kb 9'], [bin(), 'big']]) {
    const r = rootWith();
    r.wt('a', mode);
    const d = diskStarted([r.root], b);
    await d.look();
    assert.deepEqual(d.part().worktrees, [{ root: r.root, worktree: 'a', disk_at: iso(T0 + MIN) }], mode);
    assert.ok(!JSON.stringify([d.part(), d.said]).includes(SECRET));
    assert.equal(d.spawned[0].opts.stdio[2], 'ignore', "du's stderr is never read or shown");
  }
});

test('D6: a worktree gone from .worktrees/ is forgotten at the next look; stop gives undefined', async () => {
  const b = bin();
  const r = rootWith('a', 'b');
  const d = diskStarted([r.root], b);
  await d.look();
  fs.rmSync(path.join(r.root, '.worktrees', 'a'), { recursive: true });
  await d.look();
  assert.deepEqual(d.part().worktrees.map((w) => w.worktree), ['b']);
  fs.rmSync(path.join(r.root, '.worktrees', 'b'), { recursive: true });
  await d.look();
  assert.equal(d.part(), undefined, 'none left: nothing');
  r.wt('c');
  await d.look();
  assert.equal(d.part().worktrees.length, 1);
  d.boxHealthDisk.stop();
  assert.equal(d.part(), undefined, 'stopped: nothing of the run is given');
});

test('D10: a .worktrees/ that can\'t be listed keeps its rows; one that is missing has none', async () => {
  const b = bin();
  const one = rootWith('a'), two = rootWith('b');
  const d = diskStarted([one.root, two.root], b);
  await d.look();
  const before = d.part().worktrees;
  assert.deepEqual(before.map((w) => w.worktree), ['a', 'b']);
  d.fake.readdir = (p) => (p.startsWith(one.root) ? Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' })) : undefined);
  await d.look();
  assert.deepEqual(d.part().worktrees, before, 'unreadable: its row stays, in its place');
  d.fake.readdir = () => undefined;
  fs.rmSync(path.join(one.root, '.worktrees'), { recursive: true });
  await d.look();
  assert.deepEqual(d.part().worktrees.map((w) => w.worktree), ['b'], 'missing: none');
});

test('D7: stop kills a du still running, and its read gives nothing after', async () => {
  const b = bin();
  const r = rootWith();
  r.wt('a', 'hang');
  const d = diskStarted([r.root], b);
  const looking = d.look();
  await until(() => starts(b).length === 1, 'the du');
  const pid = Number(starts(b)[0].split(' ')[1]);
  d.boxHealthDisk.stop();
  await until(() => !alive(pid), 'the du is killed at stop');
  await looking;
  assert.equal(d.part(), undefined);
});

test('D8: with three du stuck past their kill, at most two are alive, none is started again for its worktree, and a row that can\'t be read again stays', async () => {
  const b = bin();
  const r = rootWith('a', 'b', 'c');
  const d = diskStarted([r.root], b);
  await d.look();
  const old = d.part().worktrees.map((w) => w.disk);
  assert.deepEqual(old, [8192, 8192, 8192]);
  d.fake.stuck = (cmd) => cmd === 'nice';
  const stopAll = async (n) => { await until(() => d.spawned.length === n, `du ${n}`); for (const t of d.live('timeout')) t.fn(); };
  const looking = d.look(15 * MIN);
  await stopAll(4);
  await stopAll(5);
  await settle();
  assert.equal(d.spawned.length, 5, 'a third is not started while two are alive');
  await looking;
  assert.deepEqual(d.fake.kids.map((k) => k.kills), [1, 1]);
  const rows = d.part().worktrees;
  assert.deepEqual(rows.map((w) => [w.worktree, w.disk]), [['a', undefined], ['b', undefined], ['c', 8192]], "c's last read stays");
  assert.ok(d.said.some((w) => /two du are still alive/.test(w)));
  d.look(15 * MIN);
  await settle();
  assert.equal(d.spawned.length, 5, 'none while two are alive: not a second for a or b, nor one for c');
  // b's du ends at last; a's is still alive
  d.fake.kids[1].end();
  const again = d.look(15 * MIN);
  await stopAll(6);
  await settle();
  assert.deepEqual(d.spawned.slice(5).map((x) => x.args.at(-1)), [path.join(r.root, '.worktrees', 'b')], "not a second for a, whose du is alive; b is read again, and that is two alive again, so not c");
  await again;
});

test('D9: with three roots whose .worktrees/ never answers, one listing is out at a time and the last rows stay', async () => {
  const b = bin();
  const roots = [rootWith('a'), rootWith('b'), rootWith('c')];
  const d = diskStarted(roots.map((x) => x.root), b);
  await d.look();
  const before = d.part();
  assert.equal(before.worktrees.length, 3);
  let asked = 0;
  d.fake.readdir = () => { asked++; return new Promise(() => {}); };
  d.look(15 * MIN);
  await until(() => d.fake.out === 1, 'the first listing');
  for (let i = 0; i < 3; i++) d.look();
  await settle();
  assert.deepEqual([asked, d.fake.most], [1, 1], 'no second look, so no second listing, while one is out');
  assert.equal(d.part(), before, 'the rows stay');
});

// ===== state =====

// A fake /proc and cgroup: stat's btime, pid 1's stat with its start time, vmstat, memory.events.
function fakeMachine({ btime = 1783020689, start = 1257201349, vmstat = 252, events, boxed = !!events } = {}) {
  const proc = newDir(), cgroup = newDir();
  fs.writeFileSync(path.join(proc, 'stat'), `cpu  1 2 3 4\nbtime ${btime}\nprocesses 9\n`);
  fs.mkdirSync(path.join(proc, '1'));
  fs.writeFileSync(path.join(proc, '1', 'stat'), `1 (tini) S 0 1 1 0 -1 4194560 1 2 3 4 5 6 7 8 20 0 1 0 ${start} 1000 100 18446744073709551615\n`);
  fs.writeFileSync(path.join(proc, 'vmstat'), `nr_free_pages 1\noom_kill ${vmstat}\n`);
  if (boxed) fs.writeFileSync(path.join(cgroup, 'cpu.max'), '1200000 100000\n');
  if (events) fs.writeFileSync(path.join(cgroup, 'memory.events'), events);
  return { proc, cgroup };
}
function stateStarted({ b = bin(), machine = fakeMachine(), kit: k = null } = {}) {
  const s = load({ env: b.env });
  const c = ctxOf({ ...machine, kit: k });
  s.boxHealthState.start(c.ctx);
  const part = () => s.boxHealthState.part(c.ctx, {});
  // the timer's run, awaited: what after(0) or every(ms) would call
  const fire = (t) => t.fn();
  return { ...s, ...c, b, part, fire, box: () => part()?.answer?.box };
}
const whole = (box) => ({ v: 1, at: iso(T0), window_s: 3600, now: {}, samples: [], headroom: {}, box });

test('B1: started_at is pid 1\'s start, btime plus its start ticks; on a machine where pid 1 started with it, the boot', async () => {
  const s = stateStarted();
  assert.equal(s.box().started_at, iso((1783020689 + 12572013.49) * 1000), "the container's start");
  const host = stateStarted({ machine: fakeMachine({ start: 212 }) });
  assert.equal(host.box().started_at, iso((1783020689 + 2.12) * 1000), 'the boot, give or take pid 1\'s first 2 s');
  const none = stateStarted({ machine: { proc: path.join(scratch, 'no-proc'), cgroup: path.join(scratch, 'no-cgroup') } });
  assert.equal(none.box().started_at, undefined, 'absent with no /proc');
  const far = stateStarted({ machine: fakeMachine({ btime: 9000000000000 }) });
  assert.deepEqual(far.box(), { oom_kills: 252 }, 'a start past what a time can hold is left out, and the rest stays');
  assert.equal(boxHealthProblem(whole(s.box())), null);
});

test('B2: oom_kills is the box\'s memory.events oom_kill, read each tick; the machine\'s vmstat only where there is no box', async () => {
  const m = fakeMachine({ events: 'low 0\nhigh 0\nmax 1808\noom 4\noom_kill 3\noom_group_kill 9\n' });
  const s = stateStarted({ machine: m });
  const first = s.part();
  assert.equal(first.answer.box.oom_kills, 3, 'oom_kill, not oom_group_kill, nor the host\'s 252');
  assert.equal(s.part(), first, 'the same object while nothing changed');
  fs.writeFileSync(path.join(m.cgroup, 'memory.events'), 'oom 5\noom_kill 4\noom_group_kill 9\n');
  assert.equal(s.box().oom_kills, 4, 'read again each tick');
  assert.notEqual(s.part(), first);
  assert.equal(stateStarted({ machine: fakeMachine({ boxed: true }) }).box().oom_kills, undefined, "a box with no memory.events: never the host's");
  assert.equal(stateStarted({ machine: fakeMachine({ vmstat: 252 }) }).box().oom_kills, 252, 'no box: the machine\'s since boot');
});

test('B3: gh api rate_limit every 5 minutes and the newest release every hour, each first at start', async () => {
  const s = stateStarted({ kit: 'v0.92.0' });
  assert.deepEqual(s.timers.map((t) => [t.kind, t.ms]), [['after', 0], ['every', 300000], ['after', 0], ['every', 3600000]]);
  assert.equal(s.spawned.length, 0, 'start runs nothing itself');
  await Promise.all(s.live('after').map(s.fire));
  assert.deepEqual(s.spawned.map((x) => [x.cmd, ...x.args]), [['gh', 'api', 'rate_limit'], ['gh', 'api', 'repos/sanctuarycomputer/devteam/releases/latest', '--jq', '.tag_name']]);
  assert.deepEqual(s.spawned.map((x) => x.opts.env.GH_PROMPT_DISABLED), ['1', '1'], 'gh never waits on a prompt');
  const box = s.box();
  assert.deepEqual(box.github, { left: 3120, limit: 5000, resets_at: iso(1795600438000) });
  assert.deepEqual([box.kit, box.latest], ['v0.92.0', 'v0.93.0']);
  assert.equal(boxHealthProblem(whole(box)), null);
  await s.fire(s.live('every', 300000)[0]);
  assert.deepEqual(s.spawned.map((x) => x.args[1]), ['rate_limit', 'repos/sanctuarycomputer/devteam/releases/latest', 'rate_limit'], 'the interval asks rate_limit alone');
  await s.fire(s.live('every', 3600000)[0]);
  assert.equal(s.spawned.length, 4);
});

test('B4: each gh is one async child under a 30 s limit: never two of a kind at once, killed at the limit, its field left out', async () => {
  const s = stateStarted();
  await s.fire(s.live('after')[0]);
  assert.equal(s.box().github.left, 3120);
  s.b.gh('hang');
  const asking = s.fire(s.live('every', 300000)[0]);
  await until(() => s.b.lines().length === 2, 'the second gh');
  // not awaited: a second child would never end until its own limit
  s.fire(s.live('every', 300000)[0]);
  await settle();
  assert.equal(s.spawned.length, 2, 'none while one is out');
  const pid = Number(s.b.lines()[1].split(' ')[0]);
  const [limit] = s.live('timeout');
  assert.equal(limit.ms, 30000);
  limit.fn();
  await asking;
  await until(() => !alive(pid), 'the gh is killed');
  assert.equal(s.box().github, undefined, 'left out, not the last one kept');
  assert.equal(s.spawned[1].opts.timeout, undefined, 'its own limit, not spawn\'s');
});

test('B5: a missing or failing gh, or one that says nothing usable, leaves the field out and prints nothing of its output', async () => {
  for (const [b, mode] of [[bin({ without: ['gh'] }), 'ok'], [bin(), 'fail'], [bin(), 'junk']]) {
    b.gh(mode);
    const s = stateStarted({ b });
    await Promise.all(s.live('after').map(s.fire));
    const box = s.box();
    assert.deepEqual([box.github, box.latest], [undefined, undefined], mode);
    assert.ok(!JSON.stringify([s.part(), s.said]).includes(SECRET), mode);
    for (const x of s.spawned) assert.deepEqual(x.opts.stdio, ['ignore', 'pipe', 'ignore'], 'stderr never read or shown');
  }
  for (const [mode, github] of [['big', undefined], ['neg', undefined], ['frac', undefined], ['reset0', { left: 3120, limit: 5000 }], ['far', { left: 3120, limit: 5000 }]]) {
    const b = bin();
    b.gh(mode);
    const t = stateStarted({ b });
    await t.fire(t.live('after')[0]);
    assert.deepEqual(t.box().github, github, mode);
  }
  const s = stateStarted({ b: bin({ without: ['gh'] }) });
  await s.fire(s.live('after')[0]);
  assert.deepEqual(s.said, ["gh can't be run: GitHub's allowance and the newest release are left out"]);
});

test('B6: kit is ctx.kit, the release serving the hub; latest only when it is vX.Y.Z', async () => {
  assert.equal(stateStarted({ kit: 'v0.92.0+local' }).box().kit, 'v0.92.0+local');
  assert.equal(stateStarted({ kit: null }).box().kit, undefined);
  const b = bin();
  fs.writeFileSync(path.join(b.dir, 'gh'), GH.replace('echo v0.93.0', 'echo nightly'), { mode: 0o755 });
  const s = stateStarted({ b });
  await Promise.all(s.live('after').map(s.fire));
  assert.equal(s.box().latest, undefined);
  // startHub gives the sampler its kit, and the sampler gives it to each part
  assert.match(cut('function startHub(', '\n}\n'), /const health = boxHealth\(log, scan, \{ kit \}\);/);
});

test('B7: in the sampler, no gh or du child starts unless it is on; on, the parts run and box is in the answer with the hub\'s kit', async () => {
  const b = bin();
  const off = load({ env: { ...b.env, DEVTEAM_PROC: path.join(scratch, 'no-proc'), DEVTEAM_CGROUP: path.join(scratch, 'no-cgroup') } });
  const health = off.boxHealth(() => {}, async () => [], { kit: 'v0.92.0' });
  await health.start();
  assert.deepEqual([health.on, off.timers.list.length, off.spawned.length], [false, 0, 0], 'off: no timer, no child');
  const m = fakeMachine();
  const on = load({ env: { ...b.env, DEVTEAM_BOX_HEALTH: 'on', DEVTEAM_PROC: m.proc, DEVTEAM_CGROUP: m.cgroup } });
  const h = on.boxHealth(() => {}, async () => [], { kit: 'v0.92.0', real: () => T0 });
  await h.start();
  await Promise.all(on.timers.list.filter((t) => t.kind === 'once' && t.ms === 0).map((t) => t.fn()));
  await until(() => on.spawned.length === 2 && /latest/.test(b.lines().join()), 'both gh');
  await until(async () => { await h.tick(); let a; h.serve({ url: '/box-health.json' }, (st, ty, body) => { a = JSON.parse(body); }); return a.box?.github && a.box?.latest; }, 'the box answers');
  let a;
  h.serve({ url: '/box-health.json' }, (st, ty, body) => { a = body; });
  assert.equal(boxHealthProblem(a), null);
  const box = JSON.parse(a).box;
  assert.deepEqual([box.kit, box.latest, box.github.left, box.started_at], ['v0.92.0', 'v0.93.0', 3120, iso((1783020689 + 12572013.49) * 1000)]);
  h.stop();
});

test('B8: stop kills a gh still running', async () => {
  const b = bin();
  b.gh('hang');
  const s = stateStarted({ b });
  const asking = s.fire(s.live('after')[0]);
  await until(() => s.b.lines().length === 1, 'the gh');
  const pid = Number(s.b.lines()[0].split(' ')[0]);
  s.boxHealthState.stop();
  await until(() => !alive(pid), 'the gh is killed at stop');
  await asking;
  assert.equal(s.part(), undefined);
});

test('B9: with gh stuck past its kill, no second of its kind starts while it is alive, so at most two (one a kind) are alive', async () => {
  const s = stateStarted();
  s.fake.stuck = (cmd) => cmd === 'gh';
  const [rateFirst, latestFirst] = s.live('after');
  const rate = s.live('every', 300000)[0], latest = s.live('every', 3600000)[0];
  const asking = s.fire(rateFirst);
  await until(() => s.spawned.length === 1, 'the first gh');
  s.live('timeout')[0].fn();
  await asking;
  for (let i = 0; i < 3; i++) s.fire(rate);
  await settle();
  assert.equal(s.spawned.length, 1, 'no second rate_limit while the first is alive');
  const asked = s.fire(latestFirst);
  await until(() => s.spawned.length === 2, 'the release gh');
  s.live('timeout')[0].fn();
  await asked;
  for (let i = 0; i < 3; i++) { s.fire(rate); s.fire(latest); }
  await settle();
  assert.equal(s.spawned.length, 2, 'two alive, one of each kind, and nothing more');
  assert.deepEqual(s.fake.kids.map((k) => k.kills), [1, 1]);
  s.fake.kids[0].end();
  s.fake.stuck = () => false;
  await s.fire(rate);
  assert.equal(s.spawned.length, 3, 'once it ends, the next of its kind starts');
  assert.equal(s.box().github.left, 3120);
});
