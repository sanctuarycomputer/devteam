// Live changes (kit-633, presence@1 §6 `changed`): a project's dashboard watches its run/log/ and
// tells every page that said here when the log changes, at most every 500 ms; and /api/data builds
// dashboard-data at most once every 3 s for every page, served only while young (3 s since it
// finished) and fresh (no log change and no POST action since it started).
//
// Two real dashboards, each on its own scratch fleet: W with fs.watch as it is, S with fs.watch
// stubbed to a watcher that never fires, so on S only the 1-second look and the look each GET makes
// can see a change. A probe (NODE_OPTIONS --import) records each dashboard-data child's start (the
// process's own creation time) and end, can make it sleep, and records each fs.watch call and, in the
// dashboard, when each `changed` frame is written to a connection (its send time, and the connection's port).
// The tests run in file order: A12 on W, then A12, A13 and A14 on S (A12 makes no /api/data GET).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fleetFixture, dashboardOnFreePort, PORTS, write } from './lib/kit.mjs';
import { openPresence } from './lib/presence-fake.mjs';

const PROBE = `import fs from 'node:fs';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
const argv = process.argv.slice(2);
if (argv.includes('dashboard-data') && process.env.ZQ_BUILDS) {
  // the sleep read before start is written: a test that changes it once it sees start changes the next build's
  let ms = 0;
  try { ms = Number(fs.readFileSync(process.env.ZQ_SLEEP, 'utf8')) || 0; } catch {}
  fs.appendFileSync(process.env.ZQ_BUILDS, 'start ' + Math.round(performance.timeOrigin) + '\\n');
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  process.on('exit', () => fs.appendFileSync(process.env.ZQ_BUILDS, 'end ' + Date.now() + '\\n'));
} else if (argv.includes('dashboard') && process.env.ZQ_WATCH) {
  // a changed frame as the dashboard writes it to a connection: the time it was written, and the port the
  // connection comes from (one line per connection), so the gaps are the dashboard's, not when a client read it
  const CHANGED = Buffer.from('{"t":"changed"}');
  const write = net.Socket.prototype.write;
  net.Socket.prototype.write = function (chunk, ...rest) {
    if (Buffer.isBuffer(chunk) && chunk.includes(CHANGED)) fs.appendFileSync(process.env.ZQ_SENT, Date.now() + ' ' + this.remotePort + '\\n');
    return write.call(this, chunk, ...rest);
  };
  const real = fs.watch;
  fs.watch = function (p, ...rest) {
    if (process.env.ZQ_STUB === '1') {
      fs.appendFileSync(process.env.ZQ_WATCH, 'stub ' + p + '\\n');
      const w = new EventEmitter();
      w.close = () => {};
      w.ref = () => w;
      w.unref = () => w;
      return w;
    }
    const w = real.call(this, p, ...rest);
    fs.appendFileSync(process.env.ZQ_WATCH, 'watch ' + p + '\\n');
    return w;
  };
}
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 30000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out after ${ms} ms: ${what}`);
    await sleep(10);
  }
}

// ---- the two dashboards, each started once, on first use ----
const fixtures = {};
function dash(which) {
  fixtures[which] ??= (async () => {
    const F = fleetFixture(`presence-${which}`);
    const files = { probe: path.join(F.base, 'probe.mjs'), builds: path.join(F.base, 'builds.txt'), sleep: path.join(F.base, 'sleep.txt'), watch: path.join(F.base, 'watch.txt'), sent: path.join(F.base, 'sent.txt') };
    write(files.probe, PROBE);
    for (const f of [files.builds, files.sleep, files.watch, files.sent]) write(f, '');
    const off = which === 'w' ? 0 : 30;
    const env = F.env({
      DEVTEAM_HUB_PORT: String(PORTS + off), DEVTEAM_PORT_BASE: String(PORTS + off + 1),
      CLAUDE_CONFIG_DIR: path.join(F.base, 'claude'), CODEX_HOME: path.join(F.base, 'codex'),
      // every GET waits for its own build, never the last good data
      DEVTEAM_DATA_WAIT_MS: '600000',
      DEVTEAM_DATA_AT_ONCE: '0',
      // a build served again for 3 s after it ends (the kit's 20 s, kit-595, set back for tests): these
      // checks are of kit-633's 3 s start gap and freshness, timed to it
      DEVTEAM_DATA_REUSE_MS: '3000',
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import ${pathToFileURL(files.probe).href}`].filter(Boolean).join(' '),
      ZQ_BUILDS: files.builds, ZQ_SLEEP: files.sleep, ZQ_WATCH: files.watch, ZQ_SENT: files.sent, ZQ_STUB: which === 's' ? '1' : '0',
    });
    for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_HOME', 'DEVTEAM_PROJECT', 'TMUX', 'TMUX_PANE']) delete env[k];
    const { dash: d, port } = await dashboardOnFreePort(F.old, env);
    const runDir = path.join(F.old, 'docs/devteam/run');
    return { F, d, port, url: `http://127.0.0.1:${port}`, runDir, logDir: path.join(runDir, 'log'), files };
  })();
  return fixtures[which];
}
after(async () => {
  await closeEvery();
  for (const p of Object.values(fixtures)) {
    const { F, d } = await p;
    await d.stop();
    F.done();
  }
});

// ---- the log: one whole valid line per append; its *.jsonl names and sizes ----
let lastMs = 0;
function append(X) {
  const ms = Math.max(Date.now(), lastMs + 1);
  lastMs = ms;
  const at = new Date(ms).toISOString();
  const stamp = `${at.slice(0, 10).replaceAll('-', '')}-${at.slice(11, 23).replace(/[:.]/g, '')}`;
  fs.mkdirSync(X.logDir, { recursive: true });
  fs.appendFileSync(path.join(X.logDir, `zq8-w-${at.slice(0, 7)}.jsonl`), `${JSON.stringify({ v: 1, id: `h-${stamp}-zq8-w`, type: 'phase', op: 'new', at, by: 'zq8-w', to: 'done' })}\n`);
  return Date.now();
}
function sig(X) {
  let names = [];
  try { names = fs.readdirSync(X.logDir).filter((f) => f.endsWith('.jsonl')).sort(); } catch {}
  return names.map((f) => { try { return `${f}:${fs.statSync(path.join(X.logDir, f)).size}`; } catch { return `${f}:-`; } }).join('|');
}

// ---- the probe's records ----
function builds(X) {
  const lines = fs.readFileSync(X.files.builds, 'utf8').split('\n').filter(Boolean);
  const starts = lines.filter((l) => l.startsWith('start ')).map((l) => Number(l.slice(6)));
  const ends = lines.filter((l) => l.startsWith('end ')).map((l) => Number(l.slice(4)));
  return starts.map((start, i) => ({ start, end: ends[i] ?? null }));
}
// the changed frames the dashboard wrote at or after `since`: { [connection's port]: [send times] }
function sentSince(X, since) {
  const by = {};
  for (const l of fs.readFileSync(X.files.sent, 'utf8').split('\n').filter(Boolean)) {
    const [at, port] = l.split(' ').map(Number);
    if (at >= since) (by[port] ??= []).push(at);
  }
  return by;
}
const watched = (X) => fs.readFileSync(X.files.watch, 'utf8').split('\n').filter(Boolean);
const setSleep = (X, ms) => fs.writeFileSync(X.files.sleep, String(ms));
// the n-th build (0-based) once it has started
const started = (X, n) => until(() => builds(X)[n], `build ${n + 1} to start`, 60000);

// ---- presence clients: each answers ping, says here, and stamps when each message arrives ----
const clients = new Set();
let spot = 0;
async function open(X) {
  const c = await openPresence(X.url);
  assert.equal(c.status, 101, 'the upgrade is taken');
  clients.add(c);
  c.times = c.messages.map(() => Date.now());
  const push = c.messages.push.bind(c.messages);
  c.messages.push = (m) => { c.times.push(Date.now()); return push(m); };
  let answered = 0;
  const pong = setInterval(() => { const pings = c.messages.filter((m) => m.t === 'ping').length; for (; answered < pings; answered++) c.send({ t: 'pong' }); }, 500);
  pong.unref();
  c.closed.then(() => clearInterval(pong));
  return c;
}
async function closeEvery() {
  const all = [...clients];
  clients.clear();
  await Promise.all(all.map(async (c) => { c.close(1000); await Promise.race([c.closed, sleep(5000)]); c.destroy(); }));
}
// n clients on one spot, each having said here and seen all n in people
async function here(X, n) {
  const at = { page: `zq8-board-${++spot}`, tab: null, peek: null, art: null, thread: null };
  const cs = [];
  for (let i = 0; i < n; i++) cs.push(await open(X));
  for (const c of cs) c.send({ t: 'here', at, visible: true });
  await Promise.all(cs.map((c) => c.next((m) => m.t === 'people' && m.people.flatMap((p) => p.conns).filter((x) => x.at.page === at.page).length === n, 10000)));
  return { cs, at };
}
// when each `changed` at or after index `mark` arrived on c
const changedAt = (c, mark = 0) => c.messages.map((m, i) => (i >= mark && m.t === 'changed' ? c.times[i] : null)).filter((t) => t !== null);
// the sentinel: the first client says here again with a fresh thread tag; every client's people
// naming it comes after anything the server sent that client before it
let tags = 0;
async function sentinel(cs, at) {
  const tag = `zq8-s${++tags}`;
  cs[0].send({ t: 'here', at: { ...at, thread: tag }, visible: true });
  const seen = await Promise.all(cs.map((c) => c.next((m) => m.t === 'people' && m.people.some((p) => p.conns.some((x) => x.conn === cs[0].you.conn && x.at.thread === tag)), 5000)));
  return seen.map((m, i) => cs[i].messages.indexOf(m));
}

// ---- A12 ----

test('presence A12: changed within 1 s, at most every 500 ms', { timeout: 240000 }, async () => {
  const W = await dash('w');
  const { cs, at } = await here(W, 3);
  // a fresh fleet has no run/log until its first line: the 1-second tick starts the watch once it exists
  append(W);
  await until(() => watched(W).includes(`watch ${W.logDir}`), `the dashboard to watch its run/log (fs.watch calls: ${watched(W).join(', ') || 'none'})`, 3000);
  await sleep(700);

  // (a) five appends, 700 ms apart: one changed each, on every client, within 1 s
  for (let i = 0; i < 5; i++) {
    const marks = cs.map((c) => c.messages.length);
    const t = append(W);
    await until(() => cs.every((c, k) => changedAt(c, marks[k]).length), `changed on every client after append ${i + 1}`, 5000);
    for (const [k, c] of cs.entries()) {
      const d = changedAt(c, marks[k])[0] - t;
      assert.ok(d <= 1000, `append ${i + 1}: client ${k + 1} got changed ${d} ms after it`);
    }
    await sleep(Math.max(0, t + 700 - Date.now()));
  }

  // (b) an append every 20 ms for 3 s: changed at least 450 ms apart, never dropped, the last one followed.
  // The gaps are the dashboard's own (when it wrote each frame, the probe's sent records), never when a client
  // read it: a client's clock reads a frame late when the test's own process is busy, and the next gap then
  // looks short (618 then 383 ms on kit-279's CI), though the dashboard sent each 500 ms apart.
  await sleep(600);
  const marks = cs.map((c) => c.messages.length);
  const since = Date.now();
  const end = since + 3000;
  let last = 0;
  while (Date.now() < end) { last = append(W); await sleep(20); }
  // every frame the dashboard wrote, read by every client: once each has as many as were sent (none dropped)
  await sleep(1200);
  const sent = sentSince(W, since);
  assert.equal(Object.keys(sent).length, cs.length, `a changed written to each client's connection (${JSON.stringify(sent)})`);
  const n = Object.values(sent)[0].length;
  for (const [port, ts] of Object.entries(sent)) {
    const gaps = ts.slice(1).map((t, i) => t - ts[i]);
    assert.ok(gaps.every((g) => g >= 450), `connection :${port}: changed at most every 500 ms (gaps ${gaps.join(', ')})`);
    // at least 5: the watch gives about 7 (one at once, then each 500 ms, and the last); the 1-second
    // look alone gives about 4, so a watch whose events reach nothing is red here
    assert.ok(ts.length >= 5 && ts.length <= 8, `connection :${port}: ${ts.length} changed in 3 s of growth (5 to 8)`);
    assert.ok(ts.some((t) => t > last && t <= last + 1000), `connection :${port}: a changed within 1 s after the last append`);
    assert.equal(ts.length, n, 'every connection is sent the same changed');
  }
  await until(() => cs.every((c, k) => changedAt(c, marks[k]).length >= n), `every client to read the ${n} changed sent`, 10000);
  for (const [k, c] of cs.entries()) assert.equal(changedAt(c, marks[k]).length, n, `client ${k + 1}: every changed sent, and no more`);

  // (c) no growth, no changed
  const quiet = cs.map((c) => c.messages.length);
  const before = sig(W);
  await sleep(1500);
  const ends = await sentinel(cs, at);
  assert.equal(sig(W), before, 'nothing wrote run/log in the quiet window');
  for (const [k, c] of cs.entries()) assert.deepEqual(c.messages.slice(quiet[k], ends[k]).filter((m) => m.t === 'changed'), [], `client ${k + 1}: no changed without growth`);
  await closeEvery();
});

test('presence A12: the 1-second look without fs.watch', { timeout: 240000 }, async () => {
  const S = await dash('s');
  const { cs } = await here(S, 2);
  assert.ok(watched(S).includes(`stub ${S.logDir}`), `fs.watch is the stub (${watched(S).join(', ') || 'no fs.watch call'})`);
  assert.ok(!watched(S).some((l) => l.startsWith('watch ')), 'no real watch on S');
  for (let i = 0; i < 3; i++) {
    const marks = cs.map((c) => c.messages.length);
    const t = append(S);
    await until(() => cs.every((c, k) => changedAt(c, marks[k]).length), `changed on both clients after append ${i + 1}`, 6000);
    for (const [k, c] of cs.entries()) {
      const d = changedAt(c, marks[k])[0] - t;
      assert.ok(d <= 2000, `append ${i + 1}: client ${k + 1} got changed ${d} ms after it`);
    }
    await sleep(Math.max(0, t + 1500 - Date.now()));
  }
  await closeEvery();
});

// ---- A13 and A14: /api/data on S, where only the 1-second look and each GET's own look see a change ----

// A GET of /api/data: its status, body, the headers the page reads, and when its answer had arrived.
async function data(X) {
  const r = await fetch(`${X.url}/api/data`);
  const body = await r.text();
  return { status: r.status, body, page: r.headers.get('x-devteam-page'), stale: r.headers.get('x-devteam-stale'), at: Date.now() };
}
// One of the dashboard's own POST actions, as its page sends it.
async function post(X, name, body) {
  const r = await fetch(`${X.url}/api/${name}`, { method: 'POST', headers: { origin: X.url, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await r.text();
  return { status: r.status, at: Date.now() };
}
const good = (r, what) => { assert.equal(r.status, 200, `${what}: 200`); assert.equal(r.stale, null, `${what}: its own build, not the last good data`); assert.ok(r.page, `${what}: says its page version`); };
// waits until the last build ended at least `ms` ago (so it is no longer young)
async function aged(X, ms = 3500) {
  if (!builds(X).length) return;
  await until(() => builds(X).at(-1).end !== null, 'the last build to end', 60000);
  const end = builds(X).at(-1).end;
  await sleep(Math.max(0, end + ms - Date.now()));
}
const GAP = 2700; // the spec's 3000 less room for one child's spawn to lag another's

test('presence A13: one build, shared, young and fresh', { timeout: 300000 }, async () => {
  const S = await dash('s');
  setSleep(S, 0);
  // the dashboard's own build as it starts listening (kit-595's warm start), ended and no longer young
  await started(S, 0);
  await aged(S);
  const w = builds(S).length;
  assert.equal(w, 1, 'one build as it started, none since');

  // (a) ten GETs at once: one build
  const ten = await Promise.all(Array.from({ length: 10 }, () => data(S)));
  ten.forEach((r, i) => good(r, `GET ${i + 1} of 10`));
  assert.equal(builds(S).length, w + 1, 'ten GETs at once start one build');
  assert.equal(new Set(ten.map((r) => r.body)).size, 1, 'and share it');

  // (b) young and fresh: served from it
  const s0 = sig(S);
  const b = await data(S);
  good(b, '(b)');
  assert.equal(sig(S), s0, 'nothing wrote run/log between');
  assert.ok(b.at - builds(S)[w].end < 3000, `(b) asked within 3 s of the build (${b.at - builds(S)[w].end} ms)`);
  assert.equal(builds(S).length, w + 1, 'a GET within 3 s of a fresh build is served from it');
  assert.equal(b.body, ten[0].body, 'the same data');

  // (c) an append during a build: a GET after it waits for the next build. B sleeps 1 s and the
  // builds after it don't, so without the 3 s cap B' would start about 1.5 s after B (red at 2700)
  await aged(S);
  setSleep(S, 1000);
  let n = builds(S).length;
  const g1 = data(S);
  const B = await started(S, n);
  setSleep(S, 0);
  assert.equal(builds(S)[n].end, null, 'B is running');
  const tApp = append(S);
  assert.equal(builds(S)[n].end, null, "the append landed while B ran");
  const g2 = data(S);
  const [r1, r2] = await Promise.all([g1, g2]);
  good(r1, '(c) the GET that started B');
  good(r2, '(c) the GET after the append');
  const [Bd, B2] = [builds(S)[n], builds(S)[n + 1]];
  assert.ok(B2, 'the GET after the append started a new build');
  assert.ok(B2.start >= tApp, 'the new build started after the append');
  assert.ok(B2.start >= Bd.end, 'one build at a time');
  assert.ok(B2.start - B.start >= GAP, `builds start at least 3 s apart (${B2.start - B.start} ms)`);
  assert.ok(r2.at >= B2.end, 'the GET after the append was answered by the new build');
  assert.ok(r1.at < B2.end, 'the GET that started B was answered by B');

  // (d) an append after a build, while it is young: the next GET waits for a new build
  n = builds(S).length;
  const tApp2 = append(S);
  const r3 = await data(S);
  good(r3, '(d)');
  assert.ok(tApp2 - B2.end < 3000, '(d) appended while the last build was young');
  const B3 = builds(S)[n];
  assert.ok(B3, 'an append after a young build: a new build');
  assert.ok(B3.start >= tApp2, 'started after the append');
  assert.ok(B3.start - B2.start >= GAP, `at least 3 s after the last start (${B3.start - B2.start} ms)`);
  assert.ok(r3.at >= B3.end, 'answered by it');

  // (e) a POST action (the ACTIONS table) during a build: the next GET waits for a new build
  await aged(S);
  setSleep(S, 6000);
  n = builds(S).length;
  const g4 = data(S);
  const C = await started(S, n);
  setSleep(S, 1000);
  const s1 = sig(S);
  const p = await post(S, 'preview-stop', { name: 'zqx-none' });
  assert.ok(p.status === 200 || p.status === 400, `preview-stop was answered (${p.status})`);
  assert.equal(builds(S)[n].end, null, 'C is still running when the POST is answered');
  assert.equal(sig(S), s1, 'the POST wrote nothing to run/log');
  const r5 = await data(S);
  const r4 = await g4;
  good(r4, "(e) C's own GET");
  good(r5, '(e) the GET after the POST');
  const [Cd, C2] = [builds(S)[n], builds(S)[n + 1]];
  assert.ok(C2, 'the GET after the POST started a new build');
  assert.ok(C2.start >= Cd.end, 'after C ended');
  assert.ok(r5.at >= C2.end, 'the GET after the POST was answered by the new build');
  assert.ok(r4.at < C2.end, "C's own GET was answered by C");

  // (f) a POST through another branch (owner-setting, refused before any child), after a young build
  setSleep(S, 0);
  n = builds(S).length;
  const s2 = sig(S);
  const q = await post(S, 'owner-setting', { key: 'zq8', value: 1 });
  assert.equal(q.status, 400, 'owner-setting refuses an unknown key');
  assert.equal(sig(S), s2, 'the POST wrote nothing to run/log');
  assert.ok(q.at - C2.end < 3000, '(f) posted while the last build was young');
  const r6 = await data(S);
  good(r6, '(f)');
  const D = builds(S)[n];
  assert.ok(D, 'a POST answered: the next GET gets a new build');
  assert.ok(D.start >= q.at - 50, 'started after the POST was answered');
  assert.ok(r6.at >= D.end, 'answered by it');
});

test('presence A14: at most four builds in 10 s', { timeout: 120000 }, async () => {
  const S = await dash('s');
  setSleep(S, 0);
  await aged(S);
  const n = builds(S).length;
  const t0 = Date.now();
  const gets = [];
  const poll = () => { for (let i = 0; i < 5; i++) gets.push(data(S)); };
  poll();
  const pollers = setInterval(poll, 1000);
  const appends = setInterval(() => append(S), 100);
  await sleep(Math.max(0, t0 + 10000 - Date.now()));
  clearInterval(pollers);
  clearInterval(appends);
  const all = await Promise.all(gets);
  all.forEach((r, i) => good(r, `GET ${i + 1}`));
  assert.ok(all.length >= 45, `five clients each once a second (${all.length} GETs)`);
  const inWindow = builds(S).slice(n).filter((x) => x.start >= t0 && x.start <= t0 + 10000);
  assert.ok(inWindow.length <= 4, `at most four builds in 10 s (${inWindow.length})`);
  assert.ok(inWindow.length >= 2, `the data keeps up with the log (${inWindow.length} builds)`);
});
