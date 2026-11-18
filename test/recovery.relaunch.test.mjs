// A dead machine's workers and planners come back, work in progress first, up to 3 a tick (none
// while the machine's memory is at its ceiling): the guards, the order, the race, the caps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasTmux, json, until, write } from './lib/kit.mjs';
import { findings, fixture, OFF, sleepMs, STUB_SHELL } from './lib/recovery-fixture.mjs';

// The machine's memory as a test sets it: at or over the 80% ceiling (no relaunch), or under it.
const memory = (F, availGb) => { const f = path.join(F.base, `meminfo-${availGb}`); write(f, `MemTotal:       8388608 kB\nMemFree:         262144 kB\nMemAvailable:   ${Math.round(availGb * 1048576)} kB\n`); return { ...OFF, DEVTEAM_MEMINFO: f, DEVTEAM_CGROUP: path.join(F.base, 'no-cgroup') }; };
const FULL = (F) => memory(F, 0.5);
const UNDER = (F) => memory(F, 6);
// What a worker, the supervisor and the owner say, through the kit itself (lines the log accepts).
const dtRun = (F, args, env) => { const r = spawnSync(process.execPath, [path.join(F.root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: F.root, encoding: 'utf8', env }); assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const asWorker = (F, id, args) => { const e = F.env({ DEVTEAM_ROLE: 'worker' }); e.DEVTEAM_TICKET = id; return dtRun(F, args, e); };
const asOwner = (F, args) => { const e = F.env(); delete e.DEVTEAM_ROLE; return dtRun(F, args, e); };
const phase = (F, id, to) => F.logLine(id, { type: 'phase', from: 'starting', to });
// Tick after tick, up to 3 each: what they bring back, in the order they bring it.
const order = (F, n) => { const got = []; for (let i = 0; got.length < n && i < n; i++) got.push(...(F.tick(UNDER(F)).match(/relaunched \S+(?=: its window was gone)/g) ?? []).map((l) => l.slice(11))); return got; };

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

test('the order: work in progress first, sessions idle on a dependency last; ties keep the launch order', { skip: !hasTmux }, async () => {
  const F = fixture('order');
  try {
    F.worker('demo-60-idle'); phase(F, 'demo-60-idle', 'awaiting-word');
    F.worker('demo-61-blocked'); phase(F, 'demo-61-blocked', 'spec');
    asWorker(F, 'demo-61-blocked', ['send', 'supervisor', 'waiting on demo-60', '--kind', 'blocked']);
    F.worker('demo-62-plain'); phase(F, 'demo-62-plain', 'spec');
    F.worker('demo-63-build'); phase(F, 'demo-63-build', 'build');
    F.worker('demo-64-dirty'); phase(F, 'demo-64-dirty', 'awaiting-word');
    const wt = path.join(F.root, '.worktrees', 'demo-64-dirty');
    execFileSync('git', ['init', '-q'], { cwd: wt });
    write(path.join(wt, 'half-done.txt'), 'not committed\n');
    F.planner('p6');
    dtRun(F, ['ask', '--question', 'Which layout for p6?', '--recommendation', 'the grid', '--links', JSON.stringify([{ title: 'the p6 design', path: 'docs/p6.md', ref: 'plan/p6' }])], F.env());
    F.planner('p7');
    asOwner(F, ['thread', 'new', 'The header is too tall', '--subject', JSON.stringify({ kind: 'artifact', slug: 'mock', at: 'plan-p7' })]);
    F.planner('p8');
    asOwner(F, ['thread', 'new', 'Split this feature', '--subject', JSON.stringify({ kind: 'item', ref: 'planner:p8' })]);
    F.worker('demo-65-plain2'); phase(F, 'demo-65-plain2', 'plan');
    // a blocked message the supervisor answered, and one followed by a later message: neither idles
    F.worker('demo-66-answered'); phase(F, 'demo-66-answered', 'spec');
    const asked = asWorker(F, 'demo-66-answered', ['send', 'supervisor', 'which table?', '--kind', 'blocked']).split('\n')[0];
    dtRun(F, ['send', 'demo-66-answered', 'the new one', '--re', asked], F.env());
    F.worker('demo-67-later'); phase(F, 'demo-67-later', 'spec');
    asWorker(F, 'demo-67-later', ['send', 'supervisor', 'waiting on demo-60', '--kind', 'blocked']);
    asWorker(F, 'demo-67-later', ['send', 'supervisor', 'found a way round it', '--kind', 'info']);
    F.worker('demo-68-blocked'); phase(F, 'demo-68-blocked', 'blocked');
    // a thread on the planner by its session name
    F.planner('p9');
    asOwner(F, ['thread', 'new', 'Is this one still needed?', '--subject', JSON.stringify({ kind: 'item', ref: 'planner:plan-p9' })]);
    // the main checkout has changes of its own: a worktree that is no checkout of its own never reads them
    write(path.join(F.root, 'stray.txt'), 'not committed\n');
    assert.deepEqual(order(F, 13), ['demo-63-build', 'demo-64-dirty', 'plan-p6', 'plan-p7', 'plan-p8', 'plan-p9', 'demo-62-plain', 'demo-65-plain2', 'demo-66-answered', 'demo-67-later', 'demo-60-idle', 'demo-61-blocked', 'demo-68-blocked']);
    await until(() => F.relaunched().length === 13, 'all thirteen resumed');
  } finally { F.done(); }
});

test('the order: a planner whose question is withdrawn and whose thread is resolved waits like any other', { skip: !hasTmux }, async () => {
  const F = fixture('order2');
  try {
    F.planner('q1');
    const q = dtRun(F, ['ask', '--question', 'Which layout for q1?', '--recommendation', 'the grid', '--links', JSON.stringify([{ title: 'the q1 design', path: 'docs/q1.md', ref: 'plan/q1' }])], F.env()).split('\n')[0];
    dtRun(F, ['withdraw', q], F.env());
    F.planner('q2');
    const t = asOwner(F, ['thread', 'new', 'Split this feature', '--subject', JSON.stringify({ kind: 'item', ref: 'planner:q2' })]).split('\n')[0];
    asOwner(F, ['thread', 'resolve', t]);
    F.worker('demo-70-build'); phase(F, 'demo-70-build', 'build');
    assert.deepEqual(order(F, 3), ['demo-70-build', 'plan-q1', 'plan-q2']);
  } finally { F.done(); }
});

test('up to 3 a tick under the memory ceiling, each under the restart record and caps', { skip: !hasTmux }, async () => {
  const F = fixture('three');
  try {
    for (const id of ['demo-80-a', 'demo-81-notdue', 'demo-82-b', 'demo-83-c', 'demo-84-d']) F.worker(id);
    const once = Date.now() - 60000;
    write(F.restartsFile, JSON.stringify({ 'demo-81-notdue': [once] }));
    F.tick(UNDER(F));
    assert.deepEqual(F.state().relaunched, ['demo-80-a', 'demo-82-b', 'demo-83-c'], 'three, passing over the one not due');
    assert.deepEqual(F.tick(UNDER(F)).match(/relaunched [^\s:]+/g), ['relaunched demo-84-d']);
    assert.deepEqual(json(fs.readFileSync(F.restartsFile, 'utf8'))['demo-81-notdue'], [once], 'not claimed: its one attempt only');
    await until(() => F.relaunched().length === 4, 'four resumed');
    assert.ok(!F.relaunched().includes('demo-81-notdue'));
  } finally { F.done(); }
});

test('a box that counts the page cache: the cache counts toward the ceiling, read again before each relaunch', { skip: !hasTmux }, async () => {
  const F = fixture('cache');
  try {
    // the 2026-11-17 box: a 32 GB cap the platform enforces on memory.current, 11 GB of it page cache
    const G = 1024 ** 3;
    const cg = fs.mkdtempSync(path.join(F.base, 'cgroup-'));
    const use = (current) => { write(path.join(cg, 'memory.max'), `${32 * G}\n`); write(path.join(cg, 'memory.current'), `${current}\n`); write(path.join(cg, 'memory.stat'), `anon ${15 * G}\nfile ${11 * G}\nshmem 0\n`); };
    const box = { ...OFF, DEVTEAM_CGROUP: cg, DEVTEAM_MEMINFO: path.join(F.base, 'no-meminfo'), DEVTEAM_MEMORY_COUNTS_CACHE: '1' };
    // each resume (its worktree_setup) takes the box to 27 GB, 84% with the cache
    const sf = path.join(F.root, 'docs/devteam/project/settings.md');
    fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"project":', `"worktree_setup": ${JSON.stringify(`echo ${27 * G} > ${path.join(cg, 'memory.current')}`)},\n  "project":`));
    execFileSync('sh', ['-c', 'git add -A && git -c user.email=t@t -c user.name=t commit -qm setup'], { cwd: F.root });
    for (const id of ['demo-95-a', 'demo-96-b', 'demo-97-c']) F.worker(id);
    // 27 of 32 GB: 16 GB without the cache, under the ceiling; with it, over, so nothing comes back
    use(27 * G);
    assert.match(F.tick(box), /^3 gone sessions wait for room to relaunch: the machine's memory is at 27\.0 of 32\.0 GB \(84%, 11\.0 GB of it page cache\), at or over its 80% ceiling$/m);
    assert.deepEqual(F.relaunched(), []);
    // 20 GB: the first comes back, its resume takes the box to 27, and the next waits
    use(20 * G);
    const out = F.tick(box);
    assert.deepEqual(F.state().relaunched, ['demo-95-a'], out);
    assert.match(out, /^2 gone sessions wait for room to relaunch: the machine's memory is at 27\.0 of 32\.0 GB/m);
    // where the platform's cap leaves the cache out (no DEVTEAM_MEMORY_COUNTS_CACHE): 16 GB, so both
    // come back (in two ticks if the first one's worktree_setup leaves under 100 s for the second)
    const { DEVTEAM_MEMORY_COUNTS_CACHE: _, ...laptop } = box;
    const back = [];
    for (let i = 0; i < 2 && back.length < 2; i++) { F.tick(laptop); back.push(...F.state().relaunched); }
    assert.deepEqual(back, ['demo-96-b', 'demo-97-c']);
    assert.equal(F.state().memory_held, 0);
    await until(() => F.relaunched().length === 3, 'all three resumed');
  } finally { F.done(); }
});

test('with a worktree_setup, a later relaunch in a tick starts only with the full 100 s left', { skip: !hasTmux }, async () => {
  const F = fixture('setup');
  try {
    const sf = path.join(F.root, 'docs/devteam/project/settings.md');
    fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"project":', '"worktree_setup": "sleep 12",\n  "project":'));
    execFileSync('sh', ['-c', 'git add -A && git -c user.email=t@t -c user.name=t commit -qm setup'], { cwd: F.root });
    // a planner's resume runs home's worktree_setup too
    F.worker('demo-90-a'); F.planner('p91'); F.worker('demo-92-c');
    F.tick(UNDER(F));
    assert.deepEqual(F.state().relaunched, ['demo-90-a'], 'the first took 12 s of the 110: under 100 s left for another');
    const record = json(fs.readFileSync(F.restartsFile, 'utf8'));
    assert.ok(!record['plan-p91'] && !record['demo-92-c'], 'the others are not claimed');
    F.tick(UNDER(F));
    assert.deepEqual(F.state().relaunched, ['plan-p91']);
  } finally { F.done(); }
});
