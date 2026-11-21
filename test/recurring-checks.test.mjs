// Recurring checks run (kit-163; design recurring-checks-and-chores-under-upkeep, C1, C2, "Running
// checks", the lock, P5): wait starts `recurring run --due` detached when a check is due; the runner
// takes run/recurring/.lock with an exclusive create, runs each due check in an unseeded detached
// checkout of main in its own process group with a time limit, judges it by its fail rule, scrubs
// what it printed, and logs one recurring-run line per run, as the supervisor with detector
// recurring. Due times come from the log alone (only those lines count, one result per slot). A
// stale lock is taken over by one runner, which kills only a real runner and only a check group
// carrying the old runner's marker, removes only that runner's checkouts and logs an error run.
// Each test is a monoFixture whose main holds docs/devteam/project/recurring.json (a plain commit:
// the schedule starts at that commit), driven through the kit's commands as real processes.
// Run with TMUX unset: no fixture here starts a tmux server. Every child has a timeout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { monoFixture, write, kit, until } from './lib/kit.mjs';
import { setup as registrySetup } from './fixtures/recurring-registry/shared.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const PROJ = 'docs/devteam/project';
const JOBS = `${PROJ}/recurring.json`;
const RUN = 'docs/devteam/run';
const LOCK = `${RUN}/recurring/.lock`;
const T_OUT = 120000;
const SLOTS = JSON.parse(fs.readFileSync(path.join(kit, '..', '..', 'test', 'fixtures', 'recurring', 'slots.json'), 'utf8'));

const check = (extra = {}) => ({ kind: 'check', title: 'A check', what: 'runs on a schedule', every: '1d', run: 'true', ...extra });
const iso = (ms) => new Date(ms).toISOString();
const stamp = (at) => `${at.slice(0, 10).replace(/-/g, '')}-${at.slice(11, 23).replace(/[:.]/g, '')}`;
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const groupAlive = (pgid) => { try { process.kill(-pgid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// recurringNextSlot, loaded from the script by itself (top-level function through its closing brace)
function nextSlotFn() {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const i = src.indexOf('\nfunction recurringNextSlot(');
  assert.ok(i >= 0, 'devteam.mjs has a top-level function recurringNextSlot');
  const j = src.indexOf('\n}\n', i);
  return vm.runInContext(`${src.slice(i, j + 3)}\n;recurringNextSlot`, vm.createContext({}));
}

// A fixture: main holds these jobs (and any extra files), committed and pushed by plain git.
function setup(name, jobs, { files = {}, settings } = {}) {
  const F = monoFixture(`rc-${name}`);
  const { old } = F;
  const g = (args, cwd = old) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim();
  for (const [f, text] of Object.entries(files)) write(path.join(old, f), text);
  if (settings) F.edit(settings);
  write(path.join(old, JOBS), `${JSON.stringify(jobs, null, 2)}\n`);
  g(['add', '-A']);
  // dated three days back, so the schedule starts then and the run lines a test dates after it count
  const back = new Date(Date.now() - 3 * 86400000).toISOString();
  execFileSync('git', ['commit', '-qm', 'main: jobs'], { cwd: old, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, env: { ...process.env, GIT_COMMITTER_DATE: back, GIT_AUTHOR_DATE: back } });
  g(['push', '-q', 'origin', 'main']);
  g(['fetch', '-q', 'origin']);
  const DT = path.join(old, 'docs/devteam/scripts/devteam.mjs');
  const env = (extra = {}) => { const e = { ...F.env(SUP), ...extra }; delete e.DEVTEAM_TICKET; return e; };
  const dt = (args, extra = {}, cwd = old) => { const r = spawnSync(process.execPath, [DT, ...args], { cwd, env: env(extra), encoding: 'utf8', timeout: T_OUT }); return { status: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim(), text: `${r.stdout ?? ''}\n${r.stderr ?? ''}` }; };
  // a runner as a real process: { child, done: Promise<{ code, out, err }> }
  const runner = (args = ['recurring', 'run', '--due'], extra = {}) => {
    const child = spawn(process.execPath, [DT, ...args], { cwd: old, env: env(extra), stdio: ['ignore', 'pipe', 'pipe'], timeout: T_OUT });
    let out = '', err = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { err += b; });
    return { child, done: new Promise((r) => child.on('close', (code) => r({ code, out, err }))) };
  };
  const logDir = path.join(old, RUN, 'log');
  const allLines = () => (fs.existsSync(logDir) ? fs.readdirSync(logDir) : []).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  const runs = (name) => allLines().filter((l) => l.type === 'observation' && l.kind === 'recurring-run' && (!name || l.subject === `recurring:${name}`)).sort((a, b) => a.at.localeCompare(b.at));
  // a run line written by hand, as `by` would have written it, at a time of the test's choosing
  let n = 0;
  const addRun = (name, { slot, at, status = 'pass', by = 'supervisor', detector = 'recurring', seconds = 0 }) => {
    const file = by === 'supervisor' ? `supervisor-${at.slice(0, 7)}.jsonl` : `${by}.jsonl`;
    const t = new Date(Date.parse(at) + (n++ % 1000)).toISOString();
    const l = { v: 1, id: `o-${stamp(t)}-${by}`, type: 'observation', op: 'new', at: t, by, source: 'recurring', kind: 'recurring-run', subject: `recurring:${name}`, ...(detector ? { detector } : {}), detail: `${name}: ${status}`, severity: 0, valence: 0, source_key: `recurring:${name}:${slot}:hand${n}`, run: { status, slot, seconds } };
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, file), `${JSON.stringify(l)}\n`);
  };
  const due = () => { const r = dt(['recurring', 'due', '--json']); assert.equal(r.status, 0, r.text); return JSON.parse(r.out); };
  const dueOf = (name) => due().checks.find((c) => c.name === name);
  const lockFile = path.join(old, LOCK);
  const readLock = () => { try { return JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch { return null; } };
  const putLock = (o) => { fs.mkdirSync(path.dirname(lockFile), { recursive: true }); fs.writeFileSync(lockFile, `${JSON.stringify(o)}\n`); };
  const mainSha = () => g(['rev-parse', 'origin/main']);
  const wtDir = path.join(old, '.worktrees');
  const checkouts = () => (fs.existsSync(wtDir) ? fs.readdirSync(wtDir) : []).filter((x) => x.startsWith('tmp-recurring-'));
  // processes the test started that are still to be killed, and groups
  const kids = [];
  const sleeper = ({ detached = false } = {}) => { const c = spawn('sleep', ['120'], { detached, stdio: 'ignore', timeout: T_OUT }); c.unref(); kids.push(c.pid); return c.pid; };
  const deadPid = () => { const r = spawnSync('true'); return r.pid; };
  const done = () => {
    const l = readLock();
    for (const p of [...kids, l?.pid].filter(Boolean)) { try { process.kill(p, 'SIGKILL'); } catch {} try { process.kill(-p, 'SIGKILL'); } catch {} }
    if (l?.current?.pgid) try { process.kill(-l.current.pgid, 'SIGKILL'); } catch {}
    F.done();
  };
  return { ...F, g, DT, env, dt, runner, allLines, runs, addRun, due, dueOf, lockFile, readLock, putLock, mainSha, wtDir, checkouts, kids, sleeper, deadPid, done };
}
// the run's own status and slot, from its line
const status = (l) => l.run?.status;

// ===== A15, A16: the schedule (C1), as a pure function =====

test('A15: every case in test/fixtures/recurring/slots.json gives its expected due and next slot', () => {
  const next = nextSlotFn();
  for (const c of SLOTS.cases) {
    const landings = [{ at: c.land, entry: c.entry }, ...(c.edits ?? [])];
    const r = next(landings, c.runs.map((x) => ({ slot: x.slot, at: x.at })), c.now);
    assert.equal(r.due, c.due, `${c.case}: due`);
    assert.equal(Date.parse(r.next), Date.parse(c.next), `${c.case}: next ${r.next}, expected ${c.next}`);
  }
});

test('A16: due times follow C1 for each example the design names, and a slot recorded twice counts once', () => {
  const next = nextSlotFn();
  const chore = (e) => ({ kind: 'chore', title: 'c', what: 'w', by: 'supervisor', prompt: 'p', ...e });
  const cases = [
    // [what, land, entry, runs, now, due, next]
    ['1d at 09:00 runs daily at 09:00 UTC', '2026-11-10T08:00:00Z', check({ every: '1d', at: '09:00' }), [{ slot: '2026-11-10T09:00:00Z', at: '2026-11-10T09:00:01Z' }], '2026-11-10T20:00:00Z', false, '2026-11-11T09:00:00Z'],
    ['1d at 09:00 is due once 09:00 comes', '2026-11-10T08:00:00Z', check({ every: '1d', at: '09:00' }), [{ slot: '2026-11-10T09:00:00Z', at: '2026-11-10T09:00:01Z' }], '2026-11-11T09:00:00Z', true, '2026-11-11T09:00:00Z'],
    ['1w on mon at 00:00 UTC', '2026-11-04T12:00:00Z', check({ every: '1w', on: 'mon' }), [], '2026-11-08T23:59:59Z', false, '2026-11-09T00:00:00Z'],
    ['2w on mon every other Monday', '2026-11-04T12:00:00Z', check({ every: '2w', on: 'mon' }), [{ slot: '2026-11-09T00:00:00Z', at: '2026-11-09T00:00:01Z' }], '2026-11-16T12:00:00Z', false, '2026-11-23T00:00:00Z'],
    ['1mo on 1 on the 1st', '2026-01-10T00:00:00Z', check({ every: '1mo', on: 1 }), [], '2026-01-31T00:00:00Z', false, '2026-02-01T00:00:00Z'],
    ['3mo on 15 every third 15th', '2026-01-20T00:00:00Z', check({ every: '3mo', on: 15 }), [{ slot: '2026-02-15T00:00:00Z', at: '2026-02-15T00:00:01Z' }], '2026-04-15T12:00:00Z', false, '2026-05-15T00:00:00Z'],
    ['6h six hours after the last run starts', '2026-11-18T00:00:00Z', check({ every: '6h' }), [{ slot: '2026-11-18T00:00:00Z', at: '2026-11-18T01:30:00Z' }], '2026-11-18T07:00:00Z', false, '2026-11-18T07:30:00Z'],
    ['an unanchored entry is first due when it lands', '2026-11-18T00:00:00Z', check({ every: '6h' }), [], '2026-11-18T00:00:00Z', true, '2026-11-18T00:00:00Z'],
    ['1w on mon run late on a Wednesday next runs the coming Monday', '2026-11-02T10:00:00Z', chore({ every: '1w', on: 'mon' }), [{ slot: '2026-11-09T00:00:00Z', at: '2026-11-11T20:00:00Z' }], '2026-11-12T00:00:00Z', false, '2026-11-16T00:00:00Z'],
    ['1mo on 1 started on the 3rd next runs on the 1st', '2026-01-10T00:00:00Z', check({ every: '1mo', on: 1 }), [{ slot: '2026-03-01T00:00:00Z', at: '2026-03-03T10:00:00Z' }], '2026-03-04T00:00:00Z', false, '2026-04-01T00:00:00Z'],
    ['three missed daily slots run once, for the latest', '2026-11-10T08:00:00Z', check({ every: '1d', at: '09:00' }), [{ slot: '2026-11-11T09:00:00Z', at: '2026-11-11T09:00:02Z' }], '2026-11-14T12:00:00Z', true, '2026-11-14T09:00:00Z'],
    ['after the latest missed slot runs, the next is the following one', '2026-11-10T08:00:00Z', check({ every: '1d', at: '09:00' }), [{ slot: '2026-11-11T09:00:00Z', at: '2026-11-11T09:00:02Z' }, { slot: '2026-11-14T09:00:00Z', at: '2026-11-14T12:00:02Z' }], '2026-11-14T13:00:00Z', false, '2026-11-15T09:00:00Z'],
    ['an unanchored 1mo from the 31st next runs on the last day of the next month', '2026-01-31T10:00:00Z', check({ every: '1mo' }), [{ slot: '2026-01-31T10:00:00Z', at: '2026-01-31T10:00:00Z' }], '2026-02-01T00:00:00Z', false, '2026-02-28T10:00:00Z'],
    ['a slot recorded twice counts once (the first result)', '2026-11-18T00:00:00Z', check({ every: '1h' }), [{ slot: '2026-11-18T00:00:00Z', at: '2026-11-18T00:00:00Z' }, { slot: '2026-11-18T00:00:00Z', at: '2026-11-18T00:50:00Z' }], '2026-11-18T01:10:00Z', true, '2026-11-18T01:00:00Z'],
  ];
  for (const [what, land, entry, runs, now, d, nx] of cases) {
    const r = next([{ at: land, entry }], runs, now);
    assert.equal(r.due, d, `${what}: due`);
    assert.equal(Date.parse(r.next), Date.parse(nx), `${what}: next ${r.next}, expected ${nx}`);
    if (d) assert.equal(Date.parse(r.slot), Date.parse(nx), `${what}: the slot a run now records`);
  }
  // entries the shape refuses (a hand edit on main) never hang or throw here: no schedule (task-1 T1-1)
  for (const e of [check({ every: '1w', on: 'Monday' }), check({ every: '2w', on: 7 }), check({ every: '1mo', on: 'mon' }), check({ every: '1d', at: '9am' }), check({ every: '1w', at: '9am' })]) {
    assert.equal(next([{ at: '2026-11-10T08:00:00Z', entry: e }], [], '2026-11-20T00:00:00Z'), null, JSON.stringify(e));
  }
  // a null on and at are absent: unanchored, first due at its landing (task-1 T1-2)
  const bare = next([{ at: '2026-11-10T08:00:00Z', entry: check({ every: '1d', on: null, at: null }) }], [], '2026-11-10T08:00:00Z');
  assert.equal(bare.due, true);
  assert.equal(Date.parse(bare.next), Date.parse('2026-11-10T08:00:00Z'));
});

// ===== A17, A16 end to end: one run, its checkout and its line =====

test('A17: a due check runs in an unseeded detached checkout of main at its sha and logs one line', async () => {
  const awk = "awk 'BEGIN{for(i=0;i<400;i++)print \"line \" i \" ..................................................\"}'";
  const T = setup('one', { ci: check({ every: '1h', run: `${awk}; touch made-here; test ! -e SETUP_RAN && echo unseeded; git rev-parse HEAD` }) }, { settings: (j) => { j.worktree_setup = 'touch SETUP_RAN'; } });
  try {
    T.addRun('ci', { slot: iso(Date.now() - 2 * 3600000), at: iso(Date.now() - 61 * 60000) });
    const d = T.dueOf('ci');
    assert.equal(d.due, true, JSON.stringify(d));
    const before = T.runs('ci').length;
    const r = await T.runner().done;
    assert.equal(r.code, 0, `${r.out}${r.err}`);
    const lines = T.runs('ci').slice(before);
    assert.equal(lines.length, 1, JSON.stringify(lines));
    const [l] = lines;
    assert.equal(l.by, 'supervisor');
    assert.equal(l.detector, 'recurring');
    assert.equal(l.source, 'recurring');
    assert.equal(status(l), 'pass', JSON.stringify(l));
    assert.equal(l.run.sha, T.mainSha());
    assert.equal(l.run.exit, 0);
    assert.equal(typeof l.run.seconds, 'number');
    assert.equal(Date.parse(l.run.slot), Date.parse(d.slot), 'the line records the slot it was due for');
    assert.ok(l.run.excerpt.length <= 200, l.run.excerpt);
    assert.ok(l.run.excerpt.includes(T.mainSha()), `the excerpt is the output's end: ${l.run.excerpt}`);
    assert.ok(l.run.excerpt.includes('unseeded'), `worktree_setup did not run there: ${l.run.excerpt}`);
    assert.ok(!l.run.excerpt.includes('line 0 '), l.run.excerpt);
    const tdir = path.join(T.old, RUN, 'recurring', 'ci');
    const tails = fs.readdirSync(tdir).map((f) => fs.readFileSync(path.join(tdir, f), 'utf8'));
    assert.equal(tails.length, 1);
    assert.ok(Buffer.byteLength(tails[0]) <= 16384, `the tail is at most 16 KB (${Buffer.byteLength(tails[0])})`);
    assert.ok(tails[0].includes(T.mainSha()), "the tail is the output's end");
    assert.equal(T.g(['status', '--porcelain']), '', 'the main checkout is unchanged');
    assert.ok(!fs.existsSync(path.join(T.old, 'made-here')) && !fs.existsSync(path.join(T.old, 'SETUP_RAN')));
    assert.deepEqual(T.checkouts(), [], 'the checkout is removed');
    assert.equal(T.readLock(), null, 'the lock is released');
    assert.equal(T.dueOf('ci').due, false);
  } finally { T.done(); }
});

// ===== A18: the fail rules =====

test('A18: exit and last_line rules pass and fail on the right numbers; a timeout, exit 126 and 127, and a non-numeric line are error', async () => {
  const rules = { exit: { exit: 'nonzero' }, above: { last_line: { above: 5 } }, below: { last_line: { below: 5 } }, isnot: { last_line: { is_not: 'ok' } } };
  const jobs = {
    'ex-pass': check({ run: 'true' }), 'ex-fail': check({ run: 'false' }),
    'ab-fail': check({ run: 'echo 6', fail: rules.above }), 'ab-pass': check({ run: 'echo 4', fail: rules.above }),
    'be-fail': check({ run: 'echo 4', fail: rules.below }), 'be-pass': check({ run: 'echo 6', fail: rules.below }),
    'is-pass': check({ run: 'echo ok', fail: rules.isnot }), 'is-fail': check({ run: 'echo bad', fail: rules.isnot }),
    'ab-word': check({ run: 'echo n/a', fail: rules.above }), 'be-word': check({ run: 'echo n/a', fail: rules.below }), 'ab-none': check({ run: 'true', fail: rules.above }),
  };
  for (const [k, f] of Object.entries(rules)) {
    jobs[`to-${k}`] = check({ run: 'echo 1; sleep 30', timeout_s: 1, fail: f });
    jobs[`nx-${k}`] = check({ run: 'echo 1; ./noexec.sh', fail: f });
    jobs[`nf-${k}`] = check({ run: 'echo 1; no-such-tool-kit163', fail: f });
  }
  const T = setup('rules', jobs, { files: { 'noexec.sh': 'echo hi\n' } });
  try {
    const r = await T.runner().done;
    assert.equal(r.code, 0, `${r.out}${r.err}`);
    const want = { 'ex-pass': 'pass', 'ex-fail': 'fail', 'ab-fail': 'fail', 'ab-pass': 'pass', 'be-fail': 'fail', 'be-pass': 'pass', 'is-pass': 'pass', 'is-fail': 'fail', 'ab-word': 'error', 'be-word': 'error', 'ab-none': 'error' };
    for (const k of Object.keys(rules)) { want[`to-${k}`] = 'error'; want[`nx-${k}`] = 'error'; want[`nf-${k}`] = 'error'; }
    const got = Object.fromEntries(Object.keys(jobs).map((k) => [k, T.runs(k).map(status)]));
    assert.deepEqual(got, Object.fromEntries(Object.entries(want).map(([k, v]) => [k, [v]])));
    assert.equal(T.runs('ab-fail')[0].run.value, 6);
    assert.equal(T.runs('nx-exit')[0].run.exit, 126);
    assert.equal(T.runs('nf-exit')[0].run.exit, 127);
    assert.equal(T.runs('to-exit')[0].run.exit, undefined, 'a killed check has no exit');
  } finally { T.done(); }
});

// ===== A14: the time limit kills the group and the runner goes on =====

test('A14: a check past timeout_s is killed with its process group and logged error; the next check still runs', async () => {
  // the check's cwd is its checkout, .worktrees/<name>/ under the main checkout: run/ is two up
  const T2 = setup('timeout', { aa: check({ run: 'echo $$ > ../../docs/devteam/run/pg.txt; sleep 300 & sleep 300', timeout_s: 2 }), zz: check({ run: 'echo next' }) });
  const pgFile = path.join(T2.old, RUN, 'pg.txt');
  try {
    const r = await T2.runner().done;
    assert.equal(r.code, 0, `${r.out}${r.err}`);
    assert.deepEqual(T2.runs('aa').map(status), ['error']);
    assert.ok(T2.runs('aa')[0].run.seconds < 30, 'killed at its limit');
    const pgid = Number(fs.readFileSync(pgFile, 'utf8'));
    assert.ok(pgid > 0);
    await until(() => !groupAlive(pgid), 'the check group gone');
    assert.deepEqual(T2.runs('zz').map(status), ['pass'], 'the next due check ran');
  } finally { T2.done(); }
});

// ===== A10: a checkout that can't be made =====

test('A10: a checkout that cannot be made logs an error run and the runner goes on to the next due check', async () => {
  const T = setup('nocheckout', { aa: check({ run: 'true' }), bb: check({ run: 'true' }) });
  try {
    const r = await T.runner(['recurring', 'run', '--due'], { DEVTEAM_TEST_RECURRING_NO_CHECKOUT: 'aa' }).done;
    assert.equal(r.code, 0, `${r.out}${r.err}`);
    const [a] = T.runs('aa');
    assert.equal(status(a), 'error', JSON.stringify(a));
    assert.match(a.run.excerpt, /the checkout could not be made: /);
    assert.match(a.run.excerpt, /already exists/, "git's own refusal, so git ran");
    assert.deepEqual(T.runs('bb').map(status), ['pass']);
  } finally { T.done(); }
});

// ===== A12: scrubbing =====

test('A12: a check printing credentials logs an excerpt with none, and stores a tail with none', async () => {
  const ghp = `ghp_${'aB3dE5fG7hJ9kL1mN2pQ4rS6tU8vW0xY2zA4'}`;
  const akia = 'AKIAIOSFODNN7EXAMPLE';
  const aws = 'wJalrXUtnFEMIKMDENGbPxRfiCYEXAMPLEKEYzzz';
  const mysqlPw = 'S3cretPw1';
  const pw = 'hunter2xyz';
  const owner = 'ACME-123456';
  const leak = `echo "token ${ghp}"\necho "id ${akia}"\necho "AWS_SECRET_ACCESS_KEY=${aws}"\necho "mysql -u root -p${mysqlPw} app"\necho "deploy --password ${pw}"\necho "order ${owner}"\n`;
  const T = setup('scrub', { leak: check({ run: 'sh scripts/leak.sh' }) }, { files: { 'scripts/leak.sh': leak }, settings: (j) => { j.sensor_scrub = ['ACME-[0-9]{6}']; } });
  try {
    const r = await T.runner().done;
    assert.equal(r.code, 0, `${r.out}${r.err}`);
    const [l] = T.runs('leak');
    assert.equal(status(l), 'pass');
    const dir = path.join(T.old, RUN, 'recurring', 'leak');
    const tails = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.equal(tails.length, 1);
    assert.match(tails[0], /order/, 'the tail is stored');
    for (const secret of [ghp, akia, aws, mysqlPw, pw, owner]) {
      assert.ok(!l.run.excerpt.includes(secret), `excerpt holds ${secret}: ${l.run.excerpt}`);
      assert.ok(!tails[0].includes(secret), `tail holds ${secret}: ${tails[0]}`);
      assert.ok(!JSON.stringify(l).includes(secret), `the line holds ${secret}`);
    }
  } finally { T.done(); }
});

// ===== A13, A9: which lines count =====

test('A13: a recurring-run line by a ticket session, or by the supervisor without detector recurring, changes no due time', () => {
  const T = setup('lines', { ci: check({ every: '1h' }) });
  try {
    T.ok(T.old, ['ticket', 'add', 'api-01-a', '--json', JSON.stringify({ title: 'a', feature: 'chores', component: 'api', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['api/**'], done_when: ["its suite passes in CI"], notes: 'n' })], SUP);
    T.addRun('ci', { slot: iso(Date.now() - 2 * 3600000), at: iso(Date.now() - 61 * 60000) });
    const d = T.dueOf('ci');
    assert.equal(d.due, true);
    T.addRun('ci', { slot: d.slot, at: iso(Date.now() - 60000), by: 'api-01-a' });
    T.addRun('ci', { slot: d.slot, at: iso(Date.now() - 30000), detector: null });
    T.addRun('ci', { slot: iso(Date.now() + 3600000), at: iso(Date.now() - 20000), by: 'api-01-a' });
    const after = T.dueOf('ci');
    assert.equal(after.due, true, JSON.stringify(after));
    assert.equal(Date.parse(after.slot), Date.parse(d.slot));
    // the supervisor's own detector line for that slot does count
    T.addRun('ci', { slot: d.slot, at: iso(Date.now() - 10000) });
    assert.equal(T.dueOf('ci').due, false, 'the counted line records the slot');
  } finally { T.done(); }
});

test('A9: a slot recorded twice counts once: the next slot follows the first result', () => {
  const T = setup('twice', { ci: check({ every: '1h' }) });
  try {
    const first = Date.now() - 61 * 60000;
    T.addRun('ci', { slot: iso(first - 3600000), at: iso(first) });
    T.addRun('ci', { slot: iso(first - 3600000), at: iso(Date.now() - 10 * 60000), status: 'fail' });
    const d = T.dueOf('ci');
    assert.equal(d.due, true, JSON.stringify(d));
    assert.equal(Math.round(Date.parse(d.next) / 1000), Math.round((first + 3600000) / 1000));
  } finally { T.done(); }
});

// ===== A2, A3: wait =====

// a real wait with its trace and 200 ms cycles; high findings acked first so it keeps cycling
function startWait(T) {
  for (const f of JSON.parse(T.dt(['metrics', '--json']).out).findings.filter((x) => x.severity === 'high')) T.dt(['ack', f.kind, f.subject, '--reason', 'test']);
  const trace = path.join(fs.mkdtempSync(path.join(T.base, 'trace-')), 'trace.jsonl');
  const child = spawn(process.execPath, [T.DT, 'wait', '--minutes', '2'], { cwd: T.old, env: T.env({ DEVTEAM_TEST_WAIT_TRACE: trace, DEVTEAM_TEST_WAIT_CYCLE_MS: '200' }), stdio: ['ignore', 'pipe', 'pipe'], timeout: T_OUT });
  let out = '';
  child.stdout.on('data', (b) => { out += b; });
  child.stderr.on('data', (b) => { out += b; });
  const lines = () => { try { return fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const starts = () => lines().filter((l) => l.children.some((c) => c.join(' ') === 'recurring run --due'));
  return { child, lines, starts, out: () => out, kill: () => { try { child.kill('SIGKILL'); } catch {} } };
}

test('A2: with a 1h check last run 61 minutes ago, wait starts one detached recurring run --due and keeps cycling', async () => {
  const T = setup('wait', { ci: check({ every: '1h', run: 'sleep 15; echo done' }) });
  const W = { kill() {} };
  try {
    T.addRun('ci', { slot: iso(Date.now() - 2 * 3600000), at: iso(Date.now() - 61 * 60000) });
    Object.assign(W, startWait(T));
    await until(() => T.runs('ci').length === 2 || W.child.exitCode !== null, 'the run line');
    assert.equal(W.child.exitCode, null, `wait kept running: ${W.out()}`);
    const starts = W.starts();
    assert.equal(starts.length, 1, JSON.stringify(W.lines().map((l) => l.children)));
    const ran = Date.parse(T.runs('ci')[1].at);
    const during = W.lines().filter((l) => l.at > starts[0].at && l.at < ran - 1000);
    assert.ok(during.length >= 3, `wait cycled while the check ran (${during.length} snapshots)`);
  } finally { W.kill(); T.done(); }
});

test('A3: wait starts no runner when the check ran 30 minutes ago, or while a live runner holds the lock', async () => {
  const T = setup('wait-none', { ci: check({ every: '1h' }), dd: check({ every: '1d' }) });
  let W = { kill() {} };
  try {
    // dd is due (never run since it landed), but a live runner holds the lock
    T.addRun('ci', { slot: iso(Date.now() - 31 * 60000), at: iso(Date.now() - 30 * 60000) });
    const holder = T.sleeper();
    T.putLock({ pid: holder, start: iso(Date.now()), budget_s: 600, checks: ['dd'], current: null });
    W = startWait(T);
    await until(() => W.lines().length >= 6 || W.child.exitCode !== null, 'six snapshots');
    assert.equal(W.starts().length, 0, 'no runner while the lock is live');
    W.kill();
    // without the lock, and dd stopped from main by running it: only ci 30 min ago, so nothing is due
    fs.rmSync(T.lockFile);
    T.addRun('dd', { slot: T.dueOf('dd').slot, at: iso(Date.now() - 1000) });
    assert.equal(T.due().checks.some((c) => c.due), false);
    W = startWait(T);
    await until(() => W.lines().length >= 6 || W.child.exitCode !== null, 'six snapshots');
    assert.equal(W.starts().length, 0, 'no runner when nothing is due');
  } finally { W.kill(); T.done(); }
});

// ===== A4, A5, A11: the lock =====

test('A4: two runners started at once leave exactly one running (exclusive create)', async () => {
  const T = setup('two', { ci: check({ run: 'sleep 3; echo one' }) });
  try {
    const [a, b] = [T.runner(), T.runner()];
    const [ra, rb] = await Promise.all([a.done, b.done]);
    assert.equal(ra.code, 0, ra.err);
    assert.equal(rb.code, 0, rb.err);
    assert.equal(T.runs('ci').length, 1, JSON.stringify(T.runs('ci')));
    assert.equal([ra, rb].filter((r) => /holds the lock/.test(`${r.out}${r.err}`)).length, 1, `${ra.out}${ra.err}\n---\n${rb.out}${rb.err}`);
  } finally { T.done(); }
});

test('A5: a stale lock (its pid gone, or past its budget) is taken over by exactly one of two racing runners, which logs an error run for the check it names', async () => {
  for (const kind of ['dead', 'budget']) {
    const T = setup(`stale-${kind}`, { ci: check({ run: 'echo ok' }), other: check({ every: '1h' }) });
    try {
      const slot = iso(Date.now() - 31 * 60000);
      T.addRun('other', { slot: iso(Date.now() - 91 * 60000), at: iso(Date.now() - 90 * 60000) });
      const pid = kind === 'dead' ? T.deadPid() : T.sleeper();
      T.putLock({ pid, start: iso(Date.now() - (kind === 'dead' ? 60000 : 7200000)), budget_s: kind === 'dead' ? 600 : 60, checks: ['other'], current: { name: 'other', slot } });
      const rs = await Promise.all([T.runner().done, T.runner().done]);
      for (const r of rs) assert.equal(r.code, 0, `${r.out}${r.err}`);
      assert.deepEqual(T.runs('ci').map(status), ['pass'], `${kind}: one runner ran the due check`);
      const errs = T.runs('other').filter((l) => status(l) === 'error');
      assert.equal(errs.length, 1, `${kind}: one error run for the lock's check: ${JSON.stringify(errs)}`);
      assert.equal(Date.parse(errs[0].run.slot), Date.parse(slot));
      assert.match(errs[0].run.excerpt, /taken over/);
      if (kind === 'budget') assert.ok(alive(pid), 'a live pid that is no runner is never killed');
      assert.equal(T.readLock(), null);
    } finally { T.done(); }
  }
});

test('A11: a runner facing a live lock within its budget, or a live reused pid within budget, exits at once and touches nothing', async () => {
  const T = setup('live', { slow: check({ run: 'sleep 15' }), ci: check({ run: 'echo ok' }) });
  try {
    const R1 = T.runner();
    // on slow (ci, first in name order, ends at once on its own)
    await until(() => T.readLock()?.current?.name === 'slow' && T.readLock()?.current?.pgid, 'the first runner mid-check on slow');
    const held = T.readLock();
    const before = T.allLines().length;
    const co = T.checkouts();
    assert.equal(co.length, 1);
    const r = await T.runner().done;
    assert.equal(r.code, 0);
    assert.match(`${r.out}${r.err}`, /holds the lock/);
    assert.ok(alive(held.pid) && groupAlive(held.current.pgid), 'the holder and its check group are untouched');
    assert.deepEqual(T.checkouts(), co);
    assert.equal(T.allLines().length, before, 'nothing logged');
    assert.deepEqual(T.readLock(), held);
    R1.child.kill('SIGKILL');
    try { process.kill(-held.current.pgid, 'SIGKILL'); } catch {}
    await R1.done;
    // a live process that is no runner (a reused pid), within its budget
    const other = T.sleeper();
    T.putLock({ pid: other, start: iso(Date.now()), budget_s: 600, checks: ['ci'], current: { name: 'ci', slot: iso(Date.now()) } });
    const n = T.allLines().length;
    const r2 = await T.runner().done;
    assert.match(`${r2.out}${r2.err}`, /holds the lock/);
    assert.ok(alive(other));
    assert.equal(T.allLines().length, n);
  } finally { T.done(); }
});

// ===== A6, A7, A8: what a takeover cleans up =====

test('A6: a takeover kills the old runner and its check group only when its pid is a recurring run, and removes its checkout', async () => {
  const T = setup('kill-real', { slow: check({ run: 'sleep 60' }) });
  try {
    const R1 = T.runner();
    await until(() => T.readLock()?.current?.pgid, 'the first runner mid-check');
    const held = T.readLock();
    assert.equal(T.checkouts().length, 1);
    T.putLock({ ...held, budget_s: 1 });
    sleepMs(1500);
    const sig = new Promise((res) => R1.child.on('exit', (code, signal) => res(signal)));
    const r = await T.runner().done;
    assert.equal(r.code, 0, `${r.out}${r.err}`);
    assert.equal(await sig, 'SIGKILL', 'the old runner was killed, not left to end by itself');
    await until(() => !alive(held.pid) && !groupAlive(held.current.pgid), 'the old runner and its check group gone');
    assert.deepEqual(T.checkouts(), [], 'its checkout removed');
    const errs = T.runs('slow').filter((l) => status(l) === 'error');
    assert.equal(errs.length, 1);
    assert.match(errs[0].run.excerpt, /taken over/);
  } finally { T.done(); }
});

test("A7: a takeover kills the recorded group by the old runner's marker even when that runner is gone and the check exec'd, and never an unmarked group", async () => {
  const T = setup('marker', { execd: check({ run: 'exec sleep 60' }) });
  try {
    const R1 = T.runner();
    await until(() => T.readLock()?.current?.pgid, 'the runner mid-check');
    const held = T.readLock();
    R1.child.kill('SIGKILL');
    await R1.done;
    assert.ok(groupAlive(held.current.pgid), 'the check outlives its runner');
    const r = await T.runner().done;
    assert.equal(r.code, 0, `${r.out}${r.err}`);
    await until(() => !groupAlive(held.current.pgid), "the exec'd check killed by its marker");
    // an unmarked group the lock names: left alone
    const lone = T.sleeper({ detached: true });
    T.putLock({ pid: T.deadPid(), start: iso(Date.now() - 60000), budget_s: 600, checks: ['execd'], current: { name: 'execd', slot: iso(Date.now()), pgid: lone } });
    const r2 = await T.runner().done;
    assert.equal(r2.code, 0, `${r2.out}${r2.err}`);
    assert.ok(groupAlive(lone) && alive(lone), 'a group with no marked process is never killed');
  } finally { T.done(); }
});

test("A8: a takeover removes only checkouts named with the old runner's pid", async () => {
  const T = setup('checkouts', { ci: check({ every: '1h' }) });
  try {
    T.addRun('ci', { slot: iso(Date.now() - 31 * 60000), at: iso(Date.now() - 30 * 60000) });
    const old = T.deadPid();
    const live = process.pid;
    const mine = `tmp-recurring-${old}-ci-${old}`;
    const theirs = `tmp-recurring-${live}-ci-${live}`;
    for (const n of [mine, theirs]) T.g(['worktree', 'add', '-q', '--detach', path.join(T.wtDir, n), 'HEAD']);
    T.putLock({ pid: old, start: iso(Date.now() - 60000), budget_s: 600, checks: ['ci'], current: null });
    const r = await T.runner().done;
    assert.equal(r.code, 0, `${r.out}${r.err}`);
    assert.deepEqual(T.checkouts(), [theirs]);
    T.g(['worktree', 'remove', '--force', path.join(T.wtDir, theirs)]);
  } finally { T.done(); }
});

// ===== A19: --draft =====

test("A19: recurring run <name> --draft runs the entry from this checkout's file, not main's, and logs nothing", () => {
  const T = setup('draft', { dr: check({ run: 'echo from-main' }) });
  try {
    write(path.join(T.old, JOBS), `${JSON.stringify({ dr: check({ run: 'echo from-draft' }) }, null, 2)}\n`);
    const before = T.allLines().length;
    const r = T.dt(['recurring', 'run', 'dr', '--draft']);
    assert.equal(r.status, 0, r.text);
    assert.match(r.out, /from-draft/);
    assert.doesNotMatch(r.out, /from-main/);
    assert.match(r.out, /pass/);
    assert.equal(T.allLines().length, before, 'a draft logs nothing');
    assert.equal(T.runs('dr').length, 0);
    assert.notEqual(T.dt(['recurring', 'run', 'nope', '--draft']).status, 0);
  } finally { T.done(); }
});

// ===== A20: the log alone, holds, and fleet status =====

test('A20: due times come from the log alone; checks run while Upkeep is drained or parked; fleet status knows run/recurring/ and a live lock', async () => {
  const T = setup('portable', { ci: check({ every: '1h', run: 'echo ok' }), dd: check({ every: '1d' }) });
  try {
    // (i) run once, then delete run/recurring/: the schedule is unchanged
    T.addRun('dd', { slot: iso(Date.now() - 1000), at: iso(Date.now() - 1000) });
    assert.equal((await T.runner().done).code, 0);
    assert.equal(T.runs('ci').length, 1);
    const before = T.due().checks;
    fs.rmSync(path.join(T.old, RUN, 'recurring'), { recursive: true, force: true });
    assert.deepEqual(T.due().checks, before);
    // (iii) run/recurring/ present (with a tail in it): a fresh fleet status names no loose file for it
    fs.mkdirSync(path.join(T.old, RUN, 'recurring', 'ci'), { recursive: true });
    fs.writeFileSync(path.join(T.old, RUN, 'recurring', 'ci', 'x.txt'), 'tail\n');
    const fsj = () => { const r = T.dt(['fleet', 'status', '--json', '--no-fetch']); return JSON.parse(r.out); };
    const blockers = () => fsj().blockers.join('\n');
    assert.doesNotMatch(blockers(), /didn't make[^\n]*recurring/);
    const holder = T.sleeper();
    T.putLock({ pid: holder, start: iso(Date.now()), budget_s: 600, checks: ['ci'], current: { name: 'ci', slot: iso(Date.now()) } });
    assert.match(blockers(), /recurring check is running/);
    assert.doesNotMatch(blockers(), /didn't make[^\n]*recurring/);
    fs.rmSync(T.lockFile);
    assert.doesNotMatch(blockers(), /recurring check is running/);
    // (ii) Upkeep drained, then parked: a due check still runs
    for (const [mode, extra] of [['drain', []], ['park', ['--reason', 'a test']]]) {
      T.ok(T.old, ['goal', 'hold', 'upkeep', mode, '--owner', ...extra], {});
      const n = T.runs('ci').length;
      // a slot above every earlier one, started two hours back: the next slot is an hour ago, so due
      T.addRun('ci', { slot: iso(Date.now()), at: iso(Date.now() - 2 * 3600000) });
      const d = T.dueOf('ci');
      assert.equal(d.due, true, JSON.stringify(d));
      assert.equal((await T.runner().done).code, 0);
      assert.equal(T.runs('ci').length, n + 2, `a check ran while Upkeep is ${mode}ed`);
      T.ok(T.old, ['goal', 'hold', 'upkeep', 'run', '--owner'], {});
    }
  } finally { T.done(); }
});

// ===== A21: supervisor.md =====

test('A21: supervisor.md documents checks: what runs, when and where, the lock, and where output goes', () => {
  const md = fs.readFileSync(path.join(kit, 'process', 'supervisor.md'), 'utf8');
  const i = md.indexOf('\n## Recurring jobs');
  assert.ok(i >= 0);
  const j = md.indexOf('\n## ', i + 5);
  const sec = md.slice(i, j < 0 ? undefined : j);
  for (const phrase of ['recurring run --due', 'run/recurring/.lock', 'unseeded', 'detached checkout of main', 'timeout_s', 'run/recurring/<name>/', "whatever Upkeep's hold", 'recurring run <name> --draft', 'recurring due', 'only looking', 'OD1']) assert.ok(sec.includes(phrase), `Recurring jobs names ${phrase}`);
});

// ===== the spec-1 additions =====

test('A9b: a run starts seconds before its line: the next unanchored slot follows the start', () => {
  const T = setup('start', { ci: check({ every: '1h' }) });
  try {
    const at = Date.now() - 50 * 60000;
    T.addRun('ci', { slot: iso(at - 2 * 3600000), at: iso(at), seconds: 600 });
    const d = T.dueOf('ci');
    assert.equal(Math.round(Date.parse(d.next) / 1000), Math.round((at - 600000 + 3600000) / 1000), JSON.stringify(d));
    assert.equal(d.due, true, 'started 60 min ago, so due');
  } finally { T.done(); }
});

test('A14b: a check that leaves a background process and exits 0 finishes, and its leftover is killed', async () => {
  const T = setup('leftover', { bg: check({ run: 'echo $$ > ../../docs/devteam/run/pg.txt; sleep 300 & echo started', timeout_s: 60 }) });
  try {
    const t0 = Date.now();
    const r = await T.runner().done;
    assert.equal(r.code, 0, `${r.out}${r.err}`);
    assert.ok(Date.now() - t0 < 20000, 'the runner did not wait on the leftover');
    assert.deepEqual(T.runs('bg').map(status), ['pass']);
    const pgid = Number(fs.readFileSync(path.join(T.old, RUN, 'pg.txt'), 'utf8'));
    await until(() => !groupAlive(pgid), 'the leftover killed');
  } finally { T.done(); }
});

test('A13b: a broken jobs file on main runs nothing, and recurring due says why', async () => {
  const T = setup('broken', { ci: check(), bad: { kind: 'check', title: 'Bad', what: 'no command', every: '1d' } });
  try {
    const d = T.dt(['recurring', 'due', '--json']);
    assert.equal(d.status, 1, d.text);
    assert.match(d.text, /recurring\.json/);
    const r = await T.runner().done;
    assert.equal(r.code, 0, `${r.out}${r.err}`);
    assert.match(r.err, /recurring\.json/);
    assert.equal(T.runs().length, 0);
  } finally { T.done(); }
});

test('A6b: a runner sent SIGTERM mid-check kills its check group, removes its checkout and releases its lock', async () => {
  const T = setup('term', { slow: check({ run: 'sleep 60' }) });
  try {
    const R1 = T.runner();
    await until(() => T.readLock()?.current?.pgid, 'the runner mid-check');
    const held = T.readLock();
    R1.child.kill('SIGTERM');
    const r = await R1.done;
    assert.equal(r.code, 143, `${r.out}${r.err}`);
    await until(() => !groupAlive(held.current.pgid), 'its check group gone');
    assert.deepEqual(T.checkouts(), []);
    assert.equal(T.readLock(), null);
  } finally { T.done(); }
});

test('A5b: the takeover race forced (one runner held before its unlink while the other takes the lock): still exactly one runs the check', async () => {
  const T = setup('race', { ci: check({ run: 'echo ok' }) });
  try {
    T.putLock({ pid: T.deadPid(), start: iso(Date.now() - 60000), budget_s: 600, checks: [], current: null });
    // a reads the stale lock twice and holds before removing it; b then takes it over; then a
    // removes b's fresh lock and makes its own, inside b's one-second re-read
    const gate = path.join(fs.mkdtempSync(path.join(T.base, 'gate-')), 'open');
    const a = T.runner(['recurring', 'run', '--due'], { DEVTEAM_TEST_RECURRING_UNLINK_GATE: gate });
    await until(() => fs.existsSync(`${gate}.waiting`) || a.child.exitCode !== null, 'a held at its unlink');
    const b = T.runner();
    await until(() => T.readLock()?.pid === b.child.pid || b.child.exitCode !== null, "b's lock in place");
    fs.writeFileSync(gate, '');
    const rs = await Promise.all([a.done, b.done]);
    for (const r of rs) assert.equal(r.code, 0, `${r.out}${r.err}`);
    assert.deepEqual(T.runs('ci').map(status), ['pass'], JSON.stringify(rs));
    // the loser learns it lost at its re-read a second after its create, and says so (not only
    // stopped later by its lock rewrite failing)
    assert.equal(rs.filter((r) => /holds the lock/.test(`${r.out}${r.err}`)).length, 1, JSON.stringify(rs));
    assert.equal(T.readLock(), null);
  } finally { T.done(); }
});

test('A2b: a check committed to main while wait runs is started', async () => {
  const T = setup('wait-new', {});
  const W = { kill() {} };
  try {
    Object.assign(W, startWait(T));
    await until(() => W.lines().length >= 3 || W.child.exitCode !== null, 'three snapshots');
    write(path.join(T.old, JOBS), `${JSON.stringify({ late: check({ run: 'echo late' }) }, null, 2)}\n`);
    T.g(['commit', '-qam', 'main: a job']);
    T.g(['push', '-q', 'origin', 'main']);
    T.g(['fetch', '-q', 'origin']);
    await until(() => T.runs('late').length === 1 || W.child.exitCode !== null, 'the new job run');
    assert.equal(W.starts().length, 1, JSON.stringify(W.lines().map((l) => l.children)));
  } finally { W.kill(); T.done(); }
});

test('A16b: a job landed and then edited to another every through answered questions starts its schedule at the edit', () => {
  const R = registrySetup('rc-landed');
  try {
    const first = check({ every: '1d', run: 'echo one' });
    const edited = check({ every: '6h', run: 'echo one' });
    R.jobsChore('recurring', () => ({ ci: first }));
    const q1 = R.yes({ recurring: { ci: first } });
    assert.equal(R.merge('recurring', ['--approved', q1]).status, 0);
    try { R.g(['worktree', 'remove', '--force', path.join(R.old, '.worktrees', 'chore-recurring')]); } catch {}
    try { R.g(['branch', '-D', 'chore-recurring']); } catch {}
    R.jobsChore('recurring', () => ({ ci: edited }));
    const q2 = R.yes({ recurring: { ci: edited } });
    const m = R.merge('recurring', ['--approved', q2]);
    assert.equal(m.status, 0, m.text);
    const act = R.acts().find((a) => a.class === 'merge-chore' && a.approved_by === q2);
    const d = JSON.parse(R.ok(['recurring', 'due', '--json'])).checks.find((c) => c.name === 'ci');
    assert.equal(Math.round(Date.parse(d.start) / 1000), Math.round(Date.parse(act.created_at) / 1000), JSON.stringify(d));
  } finally { R.done(); }
});

test('A12b: output over 16 KB whose cut falls inside a secret keeps no part of it: the tail starts at a line break', async () => {
  const aws = 'wJalrXUtnFEMIKMDENGbPxRfiCYEXAMPLEKEYzzz';
  const tailLines = Array.from({ length: 160 }, (_, i) => `${`tail line ${i} `.padEnd(99, '.')}\n`).join('');
  assert.equal(tailLines.length, 16000);
  const secret = `AWS_SECRET_ACCESS_KEY=${aws}\n`;
  // the last 16384 bytes start 384 bytes before the tail: 30 bytes before the pad, inside the secret's value
  const pad = `${'p'.repeat(353)}\n`;
  const text = `${'head line\n'.repeat(50)}${secret}${pad}${tailLines}`;
  const cut = text.length - 16384;
  const at = text.indexOf(secret);
  assert.ok(cut > at + 22 && cut < at + secret.length - 1, 'the cut falls inside the value');
  const T = setup('cut', { big: check({ run: 'cat scripts/out.txt' }) }, { files: { 'scripts/out.txt': text } });
  try {
    const r = await T.runner().done;
    assert.equal(r.code, 0, `${r.out}${r.err}`);
    const dir = path.join(T.old, RUN, 'recurring', 'big');
    const [tail] = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.ok(!tail.includes(aws.slice(-20)), `no part of the value: ${tail.slice(0, 120)}`);
    assert.ok(tail.startsWith('p') || tail.startsWith('tail line'), `the tail starts at a line: ${tail.slice(0, 60)}`);
    assert.ok(tail.includes('tail line 159'), "the output's end is kept");
  } finally { T.done(); }
});
