// devteam.mjs browserStartLock (kit-321): many starts of one checkout on one stale lock never run fn
// together. A race between three starters needs a precise interleaving that real processes hit only
// by luck, so this file schedules them itself: each starter is a worker thread running the function's
// own source, cut from devteam.mjs, with every fs call, sleep and step of fn a point where it parks
// until the test grants it. The schedule is a fixed script (T5-3's two cases, S1), a seeded random
// sweep over three kinds of stale lock (S2), the sweep with a starter killed mid-way (S2b), or a small
// unit case of one rule (S3). Each starter has a fake pid of its own, and browserAlive answers from
// the test's list of live fake pids, so a dead owner or a killed starter is dead to the code.
// DEVTEAM_TEST_LOCK_SOURCE names another devteam.mjs to cut the function from (a copy of main's, or a
// mutant); DEVTEAM_TEST_LOCK_SEEDS=<from>-<to> sweeps that range of seeds instead of the fixed lists;
// DEVTEAM_TEST_LOCK_TRACE=1 prints every run's schedule. The spec: tickets/kit-321-browser-lock-three-
// starters/spec.md (home), A1, A2, A2b and A4.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = process.env.DEVTEAM_TEST_LOCK_SOURCE || path.join(ROOT, 'docs', 'devteam', 'scripts', 'devteam.mjs');
const TRACE = process.env.DEVTEAM_TEST_LOCK_TRACE === '1';

// The function's source, from its declaration to the first line that is a lone closing brace. It may
// name only what the worker passes it (fs, path, crypto, process, browserTestEnv, browserAlive,
// browserSleep, die): anything else throws in the starter, and the run fails on that throw.
const text = fs.readFileSync(SOURCE, 'utf8');
const at = text.indexOf('async function browserStartLock(');
const end = at < 0 ? -1 : text.indexOf('\n}\n', at);
const SRC = at < 0 || end < 0 ? null : text.slice(at, end + 2);

// A run's tokens. The dead owner's pid is never live here; LIVE_OWNER and LIVE_CLAIM are put on the
// live list by the cases that plant them. A starter's pid is STARTER_PID + its index.
const DEAD = '2147483646-0123456789abcdef';
const DEAD_CLAIM = '2147483645-fedcba9876543210';
const LIVE_OWNER = 3001, LIVE_CLAIM = 3002, STARTER_PID = 1001;
const OLD = 200; // seconds back: past the 120 s stale rule
const NAMES = 'ABCDEFGH';
const STEP_CAP = 5000, GRANTS_PER_STEP = 50, READY_MS = 10000;

// The claim a remover of `seen` makes beside the lock (spec 3): start.lock.take.<k>.<n>, a symlink to
// the claimant's token.
const claimName = (seen, n = 0) => `start.lock.take.${crypto.createHash('sha256').update(seen ?? '').digest('hex').slice(0, 16)}.${n}`;

// The worker's control slots (an Int32Array over shared memory): its state, the op it is parked on,
// the grant flag it waits on and the length of the op's note (its arguments, for the trace).
const STATE = 0, OP = 1, GRANT = 2, NOTE = 3;
const RUNNING = 1, PARKED = 2, DONE = 3, ERROR = 4; // 0: never run yet
const OPS = ['enter', 'exit', 'sleep', ...Object.keys(fs).filter((k) => typeof fs[k] === 'function').sort()];

// The starter. It waits for a run's message, builds the function from the cut source with stand-ins,
// runs it on the run's lock and parks at every step; then it waits for the next run. Parking is shared
// memory only (no messages), so a step costs a thread wake, not an event-loop turn; the error's text,
// read once after the run, is the one message it sends.
const WORKER = `
'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ctl = new Int32Array(workerData.ctl), bell = new Int32Array(workerData.bell);
const live = new Int32Array(workerData.live), note = new Uint8Array(workerData.note);
const code = new Map(workerData.ops.map((o, i) => [o, i]));
const enc = new TextEncoder();
const ring = () => { Atomics.add(bell, 0, 1); Atomics.notify(bell, 0); };
function park(op, words) {
  if (!code.has(op)) throw new Error('harness: no op code for ' + op);
  const b = enc.encode(words).subarray(0, note.length);
  note.set(b);
  Atomics.store(ctl, ${NOTE}, b.length);
  Atomics.store(ctl, ${OP}, code.get(op));
  Atomics.store(ctl, ${GRANT}, 0);
  Atomics.store(ctl, ${STATE}, ${PARKED});
  ring();
  while (Atomics.load(ctl, ${GRANT}) === 0) Atomics.wait(ctl, ${GRANT}, 0);
}
const words = (a) => a.map((x) => (typeof x === 'string' ? path.basename(x) : typeof x === 'number' ? 'fd' : typeof x)).join(' ');
const pfs = new Proxy(fs, { get(t, p) {
  const v = Reflect.get(t, p);
  if (typeof v !== 'function' || typeof p !== 'string') return v;
  return function (...a) { park(p, words(a)); return v.apply(t, a); };
} });
const finish = (s) => { Atomics.store(ctl, ${STATE}, s); ring(); };
parentPort.on('message', async (m) => {
  const proc = { pid: m.pid, on() {}, off() {} };
  const env = (n) => (Object.prototype.hasOwnProperty.call(m.env, n) ? m.env[n] : undefined);
  const alive = (pid) => { if (!(pid > 0)) return false; for (let i = 0; i < live.length; i++) if (Atomics.load(live, i) === pid) return true; return false; };
  const sleep = async () => { park('sleep', ''); };
  // die throws here, where devteam.mjs's exits: so a prepared folder of this starter's still present
  // when it dies is reported, since in production nothing after die would remove it (task-2 T2-2).
  const die = (msg) => {
    const mine = fs.readdirSync(path.dirname(m.file)).filter((n) => n.startsWith(\`\${path.basename(m.file)}.lock.new.\${m.pid}-\`));
    throw new Error(mine.length ? \`died with its prepared folder still present: \${mine.join(' ')}\` : msg);
  };
  try {
    const lockFn = new Function('fs', 'path', 'crypto', 'process', 'browserTestEnv', 'browserAlive', 'browserSleep', 'die', "'use strict';\\n" + m.src + '\\nreturn browserStartLock;')(pfs, path, crypto, proc, env, alive, sleep, die);
    await lockFn(m.file, async () => { park('enter', ''); park('exit', ''); });
    finish(${DONE});
  } catch (e) {
    parentPort.postMessage({ run: m.run, slot: m.slot, error: String((e && e.stack) || e) });
    finish(${ERROR});
  }
});
`;

// The pool: workers kept across runs, since a fresh worker costs 100 to 200 ms (more on a busy box)
// and a sweep makes hundreds of runs. A worker that was killed, or left inside a hung run, is replaced
// by a spare started earlier, so the kill sweep doesn't wait on a worker's start at every seed.
const bell = new Int32Array(new SharedArrayBuffer(4));
const live = new Int32Array(new SharedArrayBuffer(4 * 16)); // slots 0 to 7: starters; 8 on: planted
const errorsSeen = new Map();
let pool = [], spares = [];
function spawnWorker() {
  const w = { ctl: new Int32Array(new SharedArrayBuffer(16)), note: new Uint8Array(new SharedArrayBuffer(256)) };
  w.worker = new Worker(WORKER, { eval: true, workerData: { ctl: w.ctl.buffer, bell: bell.buffer, live: live.buffer, note: w.note.buffer, ops: OPS } });
  w.worker.on('message', (m) => errorsSeen.set(`${m.run}:${m.slot}`, m.error));
  w.worker.on('error', (e) => errorsSeen.set(`crash:${w.id}`, String(e?.stack || e)));
  w.id = crypto.randomBytes(4).toString('hex');
  return w;
}
function workers(n) {
  while (pool.length < n) pool.push(spawnWorker());
  return pool.slice(0, n);
}
async function replace(w) {
  await w.worker.terminate();
  const fresh = spares.shift() ?? spawnWorker();
  spares.push(spawnWorker());
  pool = pool.map((x) => (x === w ? fresh : x));
}
after(async () => { await Promise.all([...pool, ...spares].map((w) => w.worker.terminate())); });

const turn = () => new Promise((r) => setTimeout(r, 1));

// xorshift32, so a seed names one schedule on every Node.
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2 ** 32; };
}

let runs = 0;
// One run: n starters on <dir>/start.lock, stepped to the end. `script` is a list of steps, each
// { who, until } (grant starter `who` until its next parked op is `until`, an fs method, enter, sleep,
// exit or '*' for one grant; or until it parks on enter or a sleep or finishes; at most 50 grants) or
// a function run on this thread between steps. After the script: a seeded random choice when `seed`
// is given, else round-robin. `kill`, a seed, kills one starter at a seeded step. Returns what the
// run's assertions read.
async function run({ dir, n, env = {}, script = [], seed = null, kill = null, livePids = [] }) {
  assert.ok(SRC, `browserStartLock was not found in ${SOURCE}`);
  const id = ++runs;
  const file = path.join(dir, 'start');
  const ws = workers(n);
  live.fill(0);
  livePids.forEach((p, i) => { live[8 + i] = p; });
  const pids = ws.map((_, i) => STARTER_PID + i);
  const r = { inside: new Set(), twice: [], entries: Array(n).fill(0), errors: Array(n).fill(null), hang: false, killed: null, killedHolding: false, trace: [], steps: 0 };
  const gone = new Set(); // finished or killed
  for (let i = 0; i < n; i++) {
    live[i] = pids[i];
    Atomics.store(ws[i].ctl, STATE, RUNNING);
    ws[i].worker.postMessage({ run: id, slot: i, src: SRC, file, pid: pids[i], env: { DEVTEAM_TEST_BROWSER_LOCK_WAIT_MS: '600000', ...env } });
  }
  const state = (i) => Atomics.load(ws[i].ctl, STATE);
  const opOf = (i) => OPS[Atomics.load(ws[i].ctl, OP)];
  const noteOf = (i) => Buffer.from(ws[i].note.slice(0, Atomics.load(ws[i].ctl, NOTE))).toString();
  // Block until every starter not yet gone is parked or finished: the schedule is decided only then.
  const ready = () => {
    const stop = Date.now() + READY_MS;
    for (;;) {
      const v = Atomics.load(bell, 0);
      if (ws.every((_, i) => gone.has(i) || state(i) >= PARKED)) return;
      const left = stop - Date.now();
      if (left <= 0) throw new Error(`harness: a starter neither parked nor finished in ${READY_MS / 1000} s (run ${id})`);
      Atomics.wait(bell, 0, v, left);
    }
  };
  // What starter i did since its grant: finished, or parked; entering fn when it parks on enter.
  const look = (i) => {
    const s = state(i);
    if (s === DONE || s === ERROR) { gone.add(i); r.inside.delete(i); if (s === ERROR) r.errors[i] = 'threw'; return; }
    if (opOf(i) === 'enter') {
      r.entries[i]++;
      r.inside.add(i);
      if (r.inside.size > 1) r.twice.push(`${[...r.inside].map((j) => NAMES[j]).join(' and ')} at step ${r.steps}`);
    }
  };
  const grant = (i) => {
    if (opOf(i) === 'exit') r.inside.delete(i);
    r.steps++;
    if (TRACE || r.trace.length < 400) r.trace.push(`${r.steps} ${NAMES[i]} ${opOf(i)}(${noteOf(i)})`);
    Atomics.store(ws[i].ctl, STATE, RUNNING);
    Atomics.store(ws[i].ctl, GRANT, 1);
    Atomics.notify(ws[i].ctl, GRANT);
    ready();
    look(i);
  };
  const parked = () => ws.map((_, i) => i).filter((i) => !gone.has(i));
  const pick = seed === null ? null : rng(seed);
  const killer = kill === null ? null : rng(kill ^ 0x5bd1e995);
  const killAt = killer ? 1 + Math.floor(killer() * 40) : -1;
  const ctx = { dir, file, lock: `${file}.lock` };
  let rr = n - 1;
  let broken = null;
  try {
    ready();
    for (const step of script) {
      if (typeof step === 'function') { step(ctx); continue; }
      for (let g = 0; g < GRANTS_PER_STEP && !gone.has(step.who) && r.steps < STEP_CAP; g++) {
        grant(step.who);
        if (gone.has(step.who) || step.until === '*') break;
        const op = opOf(step.who);
        if ((op === step.until && (!step.note || step.note.test(noteOf(step.who)))) || op === 'enter' || op === 'sleep') break;
      }
    }
    while (parked().length) {
      if (r.steps >= STEP_CAP) { r.hang = true; break; }
      if (r.steps === killAt && r.killed === null) {
        const v = parked()[Math.floor(killer() * parked().length)];
        r.killed = v;
        r.killedHolding = fs.readdirSync(dir).some((f) => {
          if (!f.startsWith('start.lock.take.')) return false;
          try { return fs.readlinkSync(path.join(dir, f)).startsWith(`${pids[v]}-`); } catch { return false; }
        });
        if (TRACE) r.trace.push(`${r.steps} ${NAMES[v]} killed${r.killedHolding ? ' holding its claim' : ''}`);
        await replace(ws[v]);
        live[v] = 0;
        gone.add(v);
        r.inside.delete(v);
        continue;
      }
      const ids = parked();
      let i;
      if (pick) i = ids[Math.floor(pick() * ids.length)];
      else { do rr = (rr + 1) % n; while (gone.has(rr)); i = rr; }
      grant(i);
    }
  } catch (e) {
    broken = e;
  }
  // A hung run's starters (or all of them, when the harness itself broke) are parked for good.
  if (r.hang || broken) for (let i = 0; i < n; i++) if (!gone.has(i) && (broken || state(i) === PARKED)) await replace(ws[i]);
  for (let i = 0; i < n; i++) {
    if (r.errors[i] === null) continue;
    for (let t = 0; t < 2000 && !errorsSeen.has(`${id}:${i}`); t++) await turn();
    r.errors[i] = errorsSeen.get(`${id}:${i}`) ?? 'threw (its error text never came)';
    errorsSeen.delete(`${id}:${i}`);
  }
  if (broken) throw broken;
  r.left = fs.readdirSync(dir).sort();
  if (TRACE) console.log(`run ${id} (seed ${seed}, kill ${kill}):\n  ${r.trace.join('\n  ')}`);
  return r;
}

// The four run assertions (and the case's own expectations), as a list of what went wrong.
// `errors`: a regex every starter's error must match (a timeout case), else none may throw.
// `entries`: how many times each starter must enter fn. `left`: the run folder's names at the end.
function problems(r, { entries = 1, errors = null, left = [] } = {}) {
  const out = [];
  if (r.twice.length) out.push(`two starters inside fn at once (${r.twice[0]})`);
  if (r.hang) out.push(`no end after ${STEP_CAP} steps (a hang); the folder holds ${JSON.stringify(r.left)}`);
  r.entries.forEach((e, i) => { if (i !== r.killed && e !== entries) out.push(`${NAMES[i]} entered fn ${e} times, not ${entries}`); });
  r.errors.forEach((e, i) => {
    if (i === r.killed) return;
    if (errors && !errors.test(e ?? '')) out.push(`${NAMES[i]} should have thrown ${errors}, got ${e === null ? 'no throw' : e.split('\n')[0]}`);
    if (!errors && e !== null) out.push(`${NAMES[i]} threw: ${e.split('\n')[0]}`);
  });
  if (!r.hang && left !== null && JSON.stringify(r.left) !== JSON.stringify([...left].sort())) out.push(`the folder holds ${JSON.stringify(r.left)}, not ${JSON.stringify([...left].sort())}`);
  return out;
}

// A fresh folder for a case, removed afterwards.
async function inTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-browser-lock-'));
  try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const back = (f, s = OLD) => { const t = new Date(Date.now() - s * 1000); fs.utimesSync(f, t, t); };

// The stale locks: a dead owner's; a live owner's whose owner file is over 120 s old; an ownerless
// folder (only an older kit or a hand leaves one) holding a stray file, over 120 s old.
const LOCKS = {
  'dead-owner': { plant(lock) { fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'owner'), DEAD); }, live: [] },
  'old live-owner': { plant(lock) { fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'owner'), `${LIVE_OWNER}-89abcdef01234567`); back(path.join(lock, 'owner')); }, live: [LIVE_OWNER] },
  'old ownerless': { plant(lock) { fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'stray'), 'x'); back(path.join(lock, 'stray')); back(lock); }, live: [] },
};

const failMsg = (r, list) => `${list.join('; ')}\nschedule (first ${r.trace.length} grants):\n  ${r.trace.join('\n  ')}`;

test('the function is cut from devteam.mjs', () => {
  assert.ok(SRC, `no "async function browserStartLock(" closed by a lone "}" line in ${SOURCE}`);
  assert.match(SRC, /^async function browserStartLock\(file, fn\) \{/);
});

// S1 (A1): T5-3's two put-back cases, scripted. B reads the dead owner's token; A takes the lock and
// makes its own; B renames A's live lock aside; C makes a lock on the free path; B puts A's back. In
// the ENOTEMPTY case C's owner is written first, so the put-back fails and removes A's lock; in the
// replace case C's folder is still empty, so the put-back replaces it and C's token lands in A's lock.
// Either way A and C both run fn. The steps name events, not lines, so they run against any code.
const T5_3 = {
  'S1a: the put-back fails ENOTEMPTY and removes the live lock': [
    { who: 1, until: 'renameSync', note: /^start\.lock start\.lock\./ }, { who: 0, until: 'enter' }, { who: 1, until: 'readFileSync' },
    { who: 2, until: 'enter' }, { who: 1, until: 'sleep' },
  ],
  'S1b: the put-back replaces a third starter\'s empty lock': [
    { who: 1, until: 'renameSync', note: /^start\.lock start\.lock\./ }, { who: 0, until: 'enter' }, { who: 1, until: 'readFileSync' },
    { who: 2, until: 'writeFileSync' }, { who: 1, until: 'sleep' }, { who: 2, until: 'enter' },
  ],
};
for (const [name, script] of Object.entries(T5_3)) {
  test(name, { timeout: 60000 }, () => inTmp(async (dir) => {
    LOCKS['dead-owner'].plant(path.join(dir, 'start.lock'));
    const r = await run({ dir, n: 3, script });
    const p = problems(r);
    assert.deepEqual(p, [], failMsg(r, p));
  }));
}

// S2 (A2): the seeded sweep. Each seed is one random schedule of 3 or 4 starters on one stale lock.
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const SEEDS_ENV = /^(\d+)-(\d+)$/.exec(process.env.DEVTEAM_TEST_LOCK_SEEDS ?? '');
// A search over a range has no time cap: the fixed lists keep each test well inside its cap.
const SWEEP_TIMEOUT = SEEDS_ENV ? Infinity : 120000;
const seeds = (list) => (SEEDS_ENV ? range(Number(SEEDS_ENV[1]), Number(SEEDS_ENV[2])) : list);
// The fixed lists (and KILL_SEEDS below) were chosen by searching seeds 1 to 400 against the
// mutants of the ticket's mutants.mjs (home, tickets/kit-321-browser-lock-three-starters) and main's
// lock (d7fc46e0); the rest is padding, and every seed passes at the head. The seeds there to catch:
//   main (d7fc46e0): dead 3: 30 42; dead 4: 5 34; live 3: 1 5; live 4: 1; ownerless 3: 16; ownerless 4: 11
//   M1 no claim: dead 3: 43 53; dead 4: 2 7; live 3: 43; live 4: 2; ownerless 3: 8; ownerless 4: 16
//   M2 split look(), no look under the claim: dead 3: 21 22; dead 4: 4 65; live 3: 21; live 4: 4;
//      ownerless 4: 162
//   M3 rmdir's error code ignored: ownerless 3: 41 253; ownerless 4: 222 (its only seeds in 1 to 400
//      that pass at the head)
//   M4 the old put-back: dead 3, dead 4, live 3, live 4: 1; ownerless 3 and 4: 4
// M5 (dead claims never passed over) is caught by KILL_SEEDS and S3; M6 (no token check under the
// claim) by no seed in 1 to 2000 that passes at the head, only by S3's release race.
const plus = (list, extra) => [...new Set([...list, ...extra])].sort((a, b) => a - b);
const SWEEP = {
  'dead-owner': { 3: plus(range(1, 20), [21, 22, 30, 42, 43, 53]), 4: plus(range(1, 15), [34, 65]) },
  'old live-owner': { 3: plus(range(1, 12), [21, 43]), 4: range(1, 15) },
  'old ownerless': { 3: plus(range(1, 10), [16, 41, 253]), 4: plus(range(1, 10), [11, 16, 162, 222]) },
};

// Runs every seed and returns one message naming each failing seed and its problems ('' when none
// failed), so a search over a range (DEVTEAM_TEST_LOCK_SEEDS) reads its catch from one assertion.
async function sweep(list, one) {
  const bad = [];
  for (const seed of list) {
    const p = await inTmp((dir) => one(seed, dir));
    if (p.length) bad.push([seed, p]);
  }
  return bad.length ? `failing seeds: ${bad.map(([s]) => s).join(' ')}\n${bad.map(([s, p]) => `  seed ${s}: ${p.join('; ')}`).join('\n')}` : '';
}

for (const [kind, lock] of Object.entries(LOCKS)) {
  for (const n of [3, 4]) {
    test(`S2: ${n} starters on the ${kind} lock, seeded sweep`, { timeout: SWEEP_TIMEOUT }, async () => {
      const bad = await sweep(seeds(SWEEP[kind][n]), async (seed, dir) => {
        lock.plant(path.join(dir, 'start.lock'));
        return problems(await run({ dir, n, seed, livePids: lock.live }));
      });
      assert.ok(!bad, bad);
    });
  }
}

// S2b (A2b): the sweep with one of 3 starters killed at a seeded step (its worker terminated where
// it is parked, its pid then dead). The survivors keep the run assertions; the killed starter counts
// inside fn until it is killed. Its leftovers (a claim, a prepared folder) may stay, but no lock. At
// least one seed must kill a starter while its claim stands, so the pass-over of a dead claim is
// reached and not only the take of a dead owner's lock.
// Catching: M5 10 14; M1 70 248; M2 21; M4 1 19; main 3 (search of 1 to 400, as for SWEEP above).
const KILL_SEEDS = plus(range(1, 20), [21, 70, 248]);
test('S2b: 3 starters on the dead-owner lock, one killed mid-way', { timeout: SWEEP_TIMEOUT }, async () => {
  let holding = 0;
  const bad = await sweep(seeds(KILL_SEEDS), async (seed, dir) => {
    LOCKS['dead-owner'].plant(path.join(dir, 'start.lock'));
    const r = await run({ dir, n: 3, seed, kill: seed });
    if (r.killedHolding) holding++;
    const p = problems(r, { left: null });
    if (!r.hang && r.left.includes('start.lock')) p.push(`start.lock is left: ${JSON.stringify(r.left)}`);
    return p;
  });
  const none = holding ? '' : 'no seed killed a starter while its claim (start.lock.take.*) stood';
  const msg = [bad, none].filter(Boolean).join('\n');
  assert.ok(!msg, msg);
});

// S3 (A4): the rules one at a time, each with one starter. A wait of 1 ms makes a start that can't
// take the lock on its first look time out at once, where the case expects it to yield.
const quick = { DEVTEAM_TEST_BROWSER_LOCK_WAIT_MS: '1' };
const ownerOf = (dir) => { try { return fs.readFileSync(path.join(dir, 'start.lock', 'owner'), 'utf8'); } catch { return null; } };
const unit = (name, body) => test(`S3: ${name}`, { timeout: 60000 }, () => inTmp(body));
const check = (r, want) => { const p = problems(r, want); assert.deepEqual(p, [], failMsg(r, p)); };

unit('a live claim on the stale token makes a taker yield, the lock untouched', async (dir) => {
  LOCKS['dead-owner'].plant(path.join(dir, 'start.lock'));
  fs.symlinkSync(`${LIVE_CLAIM}-0011223344556677`, path.join(dir, claimName(DEAD)));
  const r = await run({ dir, n: 1, env: quick, livePids: [LIVE_CLAIM] });
  check(r, { entries: 0, errors: /timed out/, left: ['start.lock', claimName(DEAD)] });
  assert.equal(ownerOf(dir), DEAD);
});

unit('a dead claimant\'s claim is passed over: the take succeeds and the dead claim is gone', async (dir) => {
  LOCKS['dead-owner'].plant(path.join(dir, 'start.lock'));
  fs.symlinkSync(DEAD_CLAIM, path.join(dir, claimName(DEAD)));
  check(await run({ dir, n: 1, env: quick }), {});
});

// The look under the claim: on a lock stale only by age (its owner alive), the taker is stepped to
// just past its claim, the owner's mtime is set to now, and the taker must find it no longer stale.
// On a dead owner's lock this would pass whatever the code did.
unit('a taker whose lock is fresh again when it looks under its claim returns to waiting', async (dir) => {
  const owner = `${LIVE_OWNER}-89abcdef01234567`;
  LOCKS['old live-owner'].plant(path.join(dir, 'start.lock'));
  const script = [{ who: 0, until: 'symlinkSync' }, { who: 0, until: '*' }, (c) => { const t = new Date(); fs.utimesSync(path.join(c.lock, 'owner'), t, t); }];
  const r = await run({ dir, n: 1, env: quick, script, livePids: [LIVE_OWNER] });
  check(r, { entries: 0, errors: /timed out/, left: ['start.lock'] });
  assert.equal(ownerOf(dir), owner);
  assert.ok(r.trace.some((l) => / symlinkSync\(/.test(l)), 'the taker never made a claim');
});

unit('a release leaves a lock whose owner changed', async (dir) => {
  const other = `${LIVE_OWNER}-0123012301230123`;
  const script = [{ who: 0, until: 'enter' }, { who: 0, until: '*' }, (c) => fs.writeFileSync(path.join(c.lock, 'owner'), other)];
  check(await run({ dir, n: 1, script, livePids: [LIVE_OWNER] }), { left: ['start.lock'] });
  assert.equal(ownerOf(dir), other);
});

// A's lock ages past 120 s inside fn; A's release reads its own token and stops before its claim; B
// takes the stale lock and enters fn; A's release then claims and looks again: it must find B's token
// and leave B's lock where it is, or C gets in beside B (task-2 T2-1).
unit('a release whose lock was taken while it reached its claim leaves the taker\'s lock', async (dir) => {
  const script = [
    { who: 0, until: 'enter' },
    (c) => back(path.join(c.lock, 'owner')),
    { who: 0, until: '*' }, { who: 0, until: '*' },
    { who: 0, until: 'symlinkSync' },
    { who: 1, until: 'enter' },
    { who: 0, until: 'sleep' },
    { who: 2, until: 'enter' },
  ];
  check(await run({ dir, n: 3, script }), {});
});

unit('an ownerless lock over 120 s old with other files in it is taken', async (dir) => {
  LOCKS['old ownerless'].plant(path.join(dir, 'start.lock'));
  check(await run({ dir, n: 1 }), {});
});

unit('a fresh ownerless lock with other files in it is not taken', async (dir) => {
  const lock = path.join(dir, 'start.lock');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'stray'), 'x');
  check(await run({ dir, n: 1, env: quick }), { entries: 0, errors: /timed out/, left: ['start.lock'] });
  assert.deepEqual(fs.readdirSync(lock), ['stray']);
});

unit('an empty start.lock is replaced by the start at once', async (dir) => {
  fs.mkdirSync(path.join(dir, 'start.lock'));
  check(await run({ dir, n: 1, env: quick }), {});
});

unit('a start that times out on a held lock leaves no prepared folder', async (dir) => {
  const lock = path.join(dir, 'start.lock');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'owner'), `${LIVE_OWNER}-89abcdef01234567`);
  check(await run({ dir, n: 1, env: quick, livePids: [LIVE_OWNER] }), { entries: 0, errors: /timed out/, left: ['start.lock'] });
});
