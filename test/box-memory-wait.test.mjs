// A supervisor's wait skips its log read and its messages child while the log key holds (kit-594):
// a quiet cycle starts only metrics and folds nothing; a log append, a new log file or main moving
// changes the key and reads once; findings from panes and time still wake it on the next cycle; and
// its memory holds over many cycles. Each check drives a real wait and reads its trace
// (DEVTEAM_TEST_WAIT_TRACE: one JSON line per snapshot), with short cycles (DEVTEAM_TEST_WAIT_CYCLE_MS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { threadsFixture, line, until, sessionOf, hasTmux, freePort, serverUp, write } from './lib/kit.mjs';

const TICKET = 'mw-01-pane';
const QUIET = [['metrics', '--json']];
const MESSAGES = ['messages', '--open', '--to', 'supervisor', '--json'];
const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;

// A project with one active ticket (a worker in build, written now) and no high finding open.
function fixture(name) {
  const F = threadsFixture(name);
  F.sup(['feature', 'add', 'memwait', '--json', JSON.stringify({ title: 'Memory wait', goals: [F.goal], stories: [{ id: 'MW-S1', text: 'wait stays light', release: 'v1.0.0' }] })]);
  F.sup(['ticket', 'add', TICKET, '--json', JSON.stringify({ title: TICKET, feature: 'memwait', component: 'web', kind: 'build', size: 'S', risk: 'normal', serves: ['MW-S1'], depends_on: [], touches: [`src/${TICKET}/**`], done_when: ['its test passes in CI'] })]);
  phaseLine(F, 'starting', 'build');
  const highs = () => JSON.parse(F.sup(['metrics', '--json'])).findings.filter((f) => f.severity === 'high');
  for (const f of highs()) F.sup(['ack', f.kind, f.subject, '--reason', 'test']);
  assert.deepEqual(highs().map((f) => `${f.kind} ${f.subject}`), [], 'no high finding open at the start');
  return { F, name, ticket: TICKET, DT: path.join(F.old, 'docs/devteam/scripts/devteam.mjs') };
}
// a worker's phase line as the kit writes it, now
function phaseLine(F, from, to, extra = {}) {
  const d = new Date();
  fs.mkdirSync(F.logDir, { recursive: true });
  fs.appendFileSync(path.join(F.logDir, `${TICKET}.jsonl`), line({ id: `h-${stamp(d)}-${TICKET}`, type: 'phase', op: 'new', at: d.toISOString(), by: TICKET, from, to, ...extra }));
}

// a real wait (never F.run/F.ok, which go through a pre-started process that ignores NODE_OPTIONS)
function startWait(X, envExtra = {}, minutes = 10) {
  const trace = path.join(fs.mkdtempSync(path.join(X.F.base, 'trace-')), 'trace.jsonl');
  const env = { ...X.F.env({ DEVTEAM_ROLE: 'supervisor' }), DEVTEAM_TEST_WAIT_TRACE: trace, DEVTEAM_TEST_WAIT_CYCLE_MS: '200', ...envExtra };
  delete env.DEVTEAM_TICKET;
  const child = spawn(process.execPath, [X.DT, 'wait', '--minutes', String(minutes)], { cwd: X.F.old, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (b) => { out += b; });
  child.stderr.on('data', (b) => { err += b; });
  const done = new Promise((r) => child.on('close', (code) => r({ code, out, err })));
  const lines = () => { try { return fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const kill = () => { try { child.kill('SIGKILL'); } catch {} };
  return { child, lines, done, kill, out: () => out, err: () => err };
}
// the trace once it holds a line matching pred (the wait still running, or its last line written)
async function untilLine(w, pred, what) {
  await until(() => w.lines().some(pred) || w.child.exitCode !== null, what);
  const hit = w.lines().find(pred);
  assert.ok(hit, `${what}: wait ended first (${w.out()}${w.err()})`);
  return hit;
}
// N: the cycle of the first snapshot started after t; a wait that ended before one started ended by N
async function afterChange(w, t) {
  await until(() => w.lines().some((l) => l.at > t) || w.child.exitCode !== null, 'a snapshot after the change');
  return w.lines().find((l) => l.at > t)?.cycle ?? Infinity;
}
// what wait printed once it returned; a wait still running three cycles past N fails here, not at
// the file's watchdog
async function returned(w, N) {
  await until(() => w.child.exitCode !== null || w.lines().some((l) => l.cycle > N + 3), 'wait to return');
  assert.ok(w.child.exitCode !== null, `wait still running 3 cycles after cycle ${N}: ${JSON.stringify(w.lines().at(-1))}`);
  return w.done;
}
const isQuiet = (l) => JSON.stringify(l.children) === JSON.stringify(QUIET) && l.log_reads === 0;
const count = (l, args) => l.children.filter((c) => JSON.stringify(c) === JSON.stringify(args)).length;
const git = (X, args) => execFileSync('git', args, { cwd: X.F.old, encoding: 'utf8' }).trim();

// Each check: cycle 0 and a quiet line, the change at t, then the first line whose key differs from
// cycle 0's, which must come by line N (the snapshot running at t may already catch it).
async function keyChange(X, w, change) {
  await untilLine(w, (l) => l.cycle >= 1, 'a quiet line');
  const t = Date.now();
  change();
  const N = await afterChange(w, t);
  const k0 = w.lines()[0].key;
  const hit = await untilLine(w, (l) => l.key !== k0, 'a line with a new key');
  assert.ok(hit.cycle <= N, `the key changed on cycle ${hit.cycle}, after the first snapshot started after the change (${N})`);
  return hit;
}

test('quiet cycles start only the metrics child and fold no log; the key holds while nothing changes', async (t) => {
  const X = fixture('mw-quiet');
  t.after(() => X.F.done());
  const w = startWait(X);
  try {
    await untilLine(w, (l) => l.cycle >= 3, 'four snapshots');
    const L = w.lines();
    assert.equal(L[0].log_reads, 1, 'the first snapshot reads the log');
    assert.equal(count(L[0], MESSAGES), 1, 'and starts messages once');
    assert.equal(count(L[0], ['metrics', '--json']), 1);
    for (const l of L.slice(1, 4)) {
      assert.deepEqual(l.children, QUIET, `cycle ${l.cycle} starts only metrics`);
      assert.equal(l.log_reads, 0, `cycle ${l.cycle} folds nothing`);
    }
    assert.equal(L[1].key, L[2].key, 'equal with nothing changed');
    assert.equal(L[0].key, L[1].key);
    assert.equal(L[1].key.split('\n')[0], `main ${git(X, ['rev-parse', 'origin/main'])}`, "the key starts with main's sha");
    assert.ok(w.child.exitCode === null, 'still waiting');
  } finally { w.kill(); }
});

test('an append to run/log changes the key, reads the log once and starts messages once', async (t) => {
  const X = fixture('mw-append');
  t.after(() => X.F.done());
  const w = startWait(X);
  try {
    const hit = await keyChange(X, w, () => phaseLine(X.F, 'build', 'build', { note: 'ping' }));
    assert.equal(hit.log_reads, 1, 'one fold');
    assert.equal(count(hit, MESSAGES), 1, 'one messages child');
    assert.equal(count(hit, ['metrics', '--json']), 1, 'one metrics child');
    assert.equal(hit.children.length, 2);
    const entry = (k) => k.split('\n').find((l) => l.startsWith(`run/${TICKET}.jsonl `));
    assert.ok(entry(hit.key) && entry(hit.key) !== entry(w.lines()[0].key), 'the appended file\'s entry is what changed');
    assert.equal(hit.key.split('\n')[0], w.lines()[0].key.split('\n')[0], 'main did not move');
    const next = await untilLine(w, (l) => l.cycle === hit.cycle + 1, 'the cycle after');
    assert.ok(isQuiet(next), `the cycle after is quiet: ${JSON.stringify(next)}`);
  } finally { w.kill(); }
});

test('a new file under project/log changes the key', async (t) => {
  const X = fixture('mw-newfile');
  t.after(() => X.F.done());
  const dir = path.join(X.F.old, 'docs/devteam/project/log');
  const file = path.join(dir, 'supervisor-2026-01.jsonl');
  const w = startWait(X);
  try {
    const hit = await keyChange(X, w, () => {
      fs.mkdirSync(dir, { recursive: true });
      write(file, line({ id: 'o-20260115-120000000-supervisor', type: 'observation', op: 'new', at: '2026-01-15T12:00:00.000Z', by: 'supervisor', subject: 'web', kind: 'note', detail: 'a line in a new log file', severity: 1, valence: 0 }));
    });
    assert.match(hit.key, /^project\/supervisor-2026-01\.jsonl \d+ /m, 'the new file is in the key');
    assert.equal(hit.log_reads, 1);
  } finally { w.kill(); }
  X.F.ok(X.F.old, ['log-check']);
});

test('main moving changes the key with nothing in the checkout changed', async (t) => {
  const X = fixture('mw-main');
  t.after(() => X.F.done());
  assert.equal(git(X, ['status', '--porcelain']), '', 'a clean checkout');
  const w = startWait(X);
  let moved = null;
  try {
    const hit = await keyChange(X, w, () => {
      moved = git(X, ['commit-tree', 'origin/main^{tree}', '-p', 'origin/main', '-m', 'main moves']);
      git(X, ['update-ref', 'refs/remotes/origin/main', moved]);
    });
    const [m0, ...rest0] = w.lines()[0].key.split('\n');
    const [m1, ...rest1] = hit.key.split('\n');
    assert.notEqual(m1, m0);
    assert.equal(m1, `main ${moved}`, "the key names main's new sha");
    assert.deepEqual(rest1, rest0, 'no log file changed');
    assert.equal(hit.log_reads, 1, 'read again at the new sha');
  } finally { w.kill(); }
  assert.equal(git(X, ['status', '--porcelain']), '', 'still clean');
});

test('a failed messages child is retried on the next cycle, not kept under the key', async (t) => {
  const X = fixture('mw-fail');
  t.after(() => X.F.done());
  const w = startWait(X, { DEVTEAM_TEST_WAIT_FAIL_MESSAGES: '1' });
  try {
    await untilLine(w, (l) => l.cycle >= 2, 'three snapshots');
    const L = w.lines();
    for (const l of L.slice(0, 2)) {
      assert.equal(count(l, MESSAGES), 1, `cycle ${l.cycle} starts messages`);
      assert.equal(l.log_reads, 1, `cycle ${l.cycle} reads the log`);
    }
    assert.ok(isQuiet(L[2]), `cycle 2 is quiet once messages answered: ${JSON.stringify(L[2])}`);
  } finally { w.kill(); }
});

test('a due sensor adds exactly one sensor poll child, and none while it is not due', async (t) => {
  const X = fixture('mw-sensor');
  t.after(() => X.F.done());
  const port = await freePort();
  // in a child process: the test's own event loop is blocked during its synchronous kit calls
  const srv = spawn(process.execPath, ['-e', `require('http').createServer((q, s) => s.end('ok')).listen(${port}, '127.0.0.1'); setTimeout(() => process.exit(0), 600000).unref()`], { stdio: 'ignore' });
  let w = null;
  try {
    await serverUp(`http://127.0.0.1:${port}/`);
    const sf = path.join(X.F.old, 'docs/devteam/project/settings.md');
    fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"gates": {', `"sensors": { "api": { "kind": "http", "url": "http://127.0.0.1:${port}/" } }, "gates": {`));
    git(X, ['commit', '-qm', 'a sensor', '--', 'docs/devteam/project/settings.md']);
    git(X, ['push', '-q', 'origin', 'HEAD:main']);
    w = startWait(X);
    await untilLine(w, (l) => l.cycle >= 3, 'four snapshots');
    const L = w.lines();
    const POLL = ['sensor', 'poll', '--due', '--json'];
    assert.equal(count(L[0], POLL), 1, `the due sensor is polled once: ${JSON.stringify(L[0].children)}`);
    assert.equal(count(L[0], MESSAGES), 1);
    assert.equal(count(L[0], ['metrics', '--json']), 1);
    assert.equal(L[0].children.length, 3);
    for (const l of L.slice(1, 4)) assert.ok(isQuiet(l), `cycle ${l.cycle}: not due, quiet: ${JSON.stringify(l)}`);
  } finally { w?.kill(); srv.kill(); }
});

test('a pane at a prompt wakes the wait on the next cycle, with the log unchanged', { skip: !hasTmux && 'tmux not installed' }, async (t) => {
  const X = fixture('mw-pane');
  const env = X.F.env();
  const S = sessionOf(X.F.old, X.name);
  t.after(() => { spawnSync('tmux', ['kill-session', '-t', `=${S}`], { env }); X.F.done(); });
  const w = startWait(X);
  try {
    await untilLine(w, (l) => l.cycle >= 1, 'a quiet line');
    spawnSync('tmux', ['new-session', '-d', '-s', S, '-n', TICKET, 'sh -c \'printf "Bash command\\n  rm -rf build\\nDo you want to proceed?\\n> 1. Yes\\n  2. No\\n"; exec sleep 600\''], { env });
    await until(() => /proceed/.test(spawnSync('tmux', ['capture-pane', '-p', '-t', `=${S}:${TICKET}`], { env, encoding: 'utf8' }).stdout ?? ''), 'the pane shows its prompt');
    const at = Date.now();
    const N = await afterChange(w, at);
    const { out } = await returned(w, N);
    assert.match(out, new RegExp(`^something needs you:\\n[\\s\\S]*finding blocked-prompt ${TICKET}: `));
    const L = w.lines();
    assert.ok(L.at(-1).cycle <= N, `woke on cycle ${L.at(-1).cycle}, after the first snapshot started after the prompt (${N})`);
    assert.equal(new Set(L.map((l) => l.key)).size, 1, 'the log key held throughout');
  } finally { w.kill(); }
});

test('a worker gone stale as time passes wakes the wait on the next cycle, with the log unchanged', async (t) => {
  const X = fixture('mw-stale');
  t.after(() => X.F.done());
  // a fake clock: each new process reads the offset once at its start; wait itself started at 0
  const dir = fs.mkdtempSync(path.join(X.F.base, 'clock-'));
  const clock = path.join(dir, 'clock.mjs');
  const offset = path.join(dir, 'offset');
  write(offset, '0');
  write(clock, `import fs from 'node:fs';
let off = 0;
try { off = Number(fs.readFileSync(process.env.DT_TEST_CLOCK, 'utf8')) || 0; } catch {}
if (off) {
  const Real = Date;
  globalThis.Date = class extends Real {
    constructor(...a) { if (a.length) super(...a); else super(Real.now() + off); }
    static now() { return Real.now() + off; }
  };
}
`);
  const w = startWait(X, { NODE_OPTIONS: `--import ${clock}`, DT_TEST_CLOCK: offset });
  try {
    await untilLine(w, (l) => l.cycle >= 1, 'a quiet line');
    write(offset, String((30 + 5) * 60000)); // stale_after_minutes (30) and five
    const at = Date.now();
    const N = await afterChange(w, at);
    const { out } = await returned(w, N);
    assert.match(out, new RegExp(`finding stale-worker ${TICKET}: silent for`));
    const L = w.lines();
    assert.ok(L.at(-1).cycle <= N, `woke on cycle ${L.at(-1).cycle}, after the first snapshot started after the clock moved (${N})`);
    assert.equal(new Set(L.map((l) => l.key)).size, 1, 'the log key held throughout');
  } finally { w.kill(); }
});

test("wait's memory holds over 20 cycles", async (t) => {
  const X = fixture('mw-rss');
  t.after(() => X.F.done());
  const w = startWait(X);
  try {
    await untilLine(w, (l) => l.cycle >= 10, 'ten cycles');
    phaseLine(X.F, 'build', 'build', { note: 'mid-run' }); // a read mid-run
    const L20 = await untilLine(w, (l) => l.cycle >= 20, 'twenty cycles');
    const L1 = w.lines()[1];
    assert.ok(w.lines().slice(11).some((l) => l.log_reads === 1), 'the append was read');
    const grew = L20.rss - L1.rss;
    assert.ok(grew <= 30 * 1024 * 1024, `RSS grew ${Math.round(grew / 1048576)} MB from cycle 1 to cycle 20`);
  } finally { w.kill(); }
});
