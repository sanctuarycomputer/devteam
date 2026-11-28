// /api/data answered at once on a slow project (cmdDashboard: its last build ran over DATA_QUICK_MS,
// 1 s here): a read with a last good build has it straight away while a newer build runs for the
// next read, marked stale only when it is out of date and a newer build is overdue; an idle
// dashboard is never marked stale; a read after an owner action waits for a build that shows it;
// and the last good build is kept on disk under the kit's print, so a dashboard restarted on the
// same kit answers its first read before its first build ends. A quick project's reads wait for a
// current build as before (kit-595 and kit-633's tests, test/dashboard-data and presence-changed). Both pages (docs/devteam/dashboard and apps/dashboard)
// read /api/data, so both have it.
// Ports: +0 hub, +1..25 (one dashboard at a time)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fleetFixture, dashboardOnFreePort, PORTS, write } from './lib/kit.mjs';

// each dashboard-data child records its start and end, and sleeps for what the sleep file says
const PROBE = `import fs from 'node:fs';
if (process.argv.slice(2).includes('dashboard-data') && process.env.ZA_BUILDS) {
  let ms = 0;
  try { ms = Number(fs.readFileSync(process.env.ZA_SLEEP, 'utf8')) || 0; } catch {}
  fs.appendFileSync(process.env.ZA_BUILDS, 'start ' + process.pid + ' ' + Date.now() + '\\n');
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  process.on('exit', () => fs.appendFileSync(process.env.ZA_BUILDS, 'end ' + process.pid + ' ' + Date.now() + '\\n'));
  // a build that fails, while the fail file says so
  if (fs.existsSync(process.env.ZA_FAIL)) process.exit(3);
}
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 60000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > end) assert.fail(`timed out after ${ms} ms: ${what}`);
    await sleep(20);
  }
}

const F = fleetFixture('data-at-once');
const files = { probe: path.join(F.base, 'probe.mjs'), builds: path.join(F.base, 'builds.txt'), sleep: path.join(F.base, 'sleep.txt'), fail: path.join(F.base, 'fail') };
write(files.probe, PROBE);
write(files.builds, '');
write(files.sleep, '2000');
const env = F.env({
  DEVTEAM_HUB_PORT: String(PORTS), DEVTEAM_PORT_BASE: String(PORTS + 1),
  CLAUDE_CONFIG_DIR: path.join(F.base, 'claude'), CODEX_HOME: path.join(F.base, 'codex'),
  // stale after 5 s, so the restart below sees a kept build marked stale without a long wait
  DEVTEAM_DATA_WAIT_MS: '5000',
  // a build over 1 s is a slow project's (the kit's 5 s); builds here sleep 2 s or more
  DEVTEAM_DATA_QUICK_MS: '1000',
  // a finished build served again for 1 s (the kit's 20 s): the idle poll below outlives it
  DEVTEAM_DATA_REUSE_MS: '1000',
  NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import ${pathToFileURL(files.probe).href}`].filter(Boolean).join(' '),
  ZA_BUILDS: files.builds, ZA_SLEEP: files.sleep, ZA_FAIL: files.fail,
});
for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_HOME', 'DEVTEAM_PROJECT', 'TMUX', 'TMUX_PANE']) delete env[k];
const kept = path.join(F.old, 'docs/devteam/run/cache/dashboard-data.last');
const logDir = path.join(F.old, 'docs/devteam/run/log');
let running = null;
after(async () => { await running?.stop(); F.done(); });

const setSleep = (ms) => fs.writeFileSync(files.sleep, String(ms));
function builds() {
  // paired by pid: a build killed with its dashboard never says it ended
  const lines = fs.readFileSync(files.builds, 'utf8').split('\n').filter(Boolean).map((l) => l.split(' '));
  const ends = new Map(lines.filter(([e]) => e === 'end').map(([, pid, t]) => [pid, Number(t)]));
  return lines.filter(([e]) => e === 'start').map(([, pid, t]) => ({ start: Number(t), end: ends.get(pid) ?? null }));
}
const allEnded = () => builds().every((b) => b.end !== null);
async function start() {
  // never two at once, even after a test that failed with one running: after() stops only the last
  await running?.stop();
  const { dash, port } = await dashboardOnFreePort(F.old, env);
  running = dash;
  return `http://127.0.0.1:${port}`;
}
async function data(url) {
  const t = Date.now();
  const r = await fetch(`${url}/api/data`);
  const body = await r.text();
  return { status: r.status, body, stale: r.headers.get('x-devteam-stale'), page: r.headers.get('x-devteam-page'), took: Date.now() - t, at: Date.now() };
}
// a log line: the dashboard's watch makes any kept build out of date
let n = 0;
function append() {
  const at = new Date().toISOString();
  fs.mkdirSync(logDir, { recursive: true });
  n += 1;
  fs.appendFileSync(path.join(logDir, `za-w-${at.slice(0, 7)}.jsonl`), `${JSON.stringify({ v: 1, id: `h-${at.replace(/\D/g, '').slice(0, 17)}${n}-za-w`, type: 'phase', op: 'new', at, by: 'za-w', to: 'done' })}\n`);
}
const generated = (r) => JSON.parse(r.body).generated_at;

test('a read has the last good build at once while a newer one runs; after an owner action it waits for one', { timeout: 240000 }, async () => {
  const url = await start();
  // the warm start's build, ended and written to disk
  await until(() => builds().length >= 1 && allEnded() && fs.existsSync(kept), 'the warm build and its kept copy');
  const first = await data(url);
  assert.equal(first.status, 200);
  assert.equal(first.stale, null, 'a young build is not marked stale');
  assert.ok(first.page, 'says its page version');

  // idle: nothing changes, builds come and go as reads outlive the reuse window, and no read is
  // marked stale (the page's "Newer data is taking a while" note never shows on a healthy dashboard)
  for (let i = 0; i < 8; i++) {
    const r = await data(url);
    assert.equal(r.stale, null, `idle read ${i + 1} is not marked stale`);
    await sleep(700);
  }
  // builds from here take 4 s, so the build the next read may start is still running when the log moves
  setSleep(4000);
  await until(allEnded, 'the idle builds to end');
  await sleep(500); // its output reaches the dashboard a moment after the child says it ended
  const base = await data(url);

  // the log moves and builds take 4 s: the read still answers at once, with the build it had
  await sleep(1100); // past generated_at's second, so a newer build says a newer time
  append();
  const was = builds().length;
  const quick = await data(url);
  assert.equal(quick.status, 200);
  assert.ok(quick.took < 1500, `answered at once, not after the 4 s build (${quick.took} ms)`);
  assert.equal(quick.body, base.body, 'with the last good build');
  await until(() => builds().length > was, 'the read started a newer build');
  // the child has said it ended a moment before its output reaches the dashboard: read until it has
  let next = null;
  await until(async () => { next = await data(url); return generated(next) > generated(base); }, 'a read with the newer build', 20000);
  assert.ok(next.took < 1500, `answered at once (${next.took} ms)`);

  // an owner action: the next read waits for a build that started after it
  setSleep(2000);
  await sleep(3500);
  const pr = await fetch(`${url}/api/owner-setting`, { method: 'POST', headers: { origin: url, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: JSON.stringify({ key: 'za', value: 1 }) });
  await pr.text();
  const posted = Date.now();
  const before = builds().length;
  const after1 = await data(url);
  const b = builds()[before];
  assert.ok(b, 'the read after the action started a build');
  assert.ok(b.start >= posted - 50, 'after the action was answered');
  assert.ok(after1.at >= b.end, `and was answered by it (${after1.took} ms)`);
  assert.equal(after1.stale, null);
  await running.stop();
  running = null;
});

test('a dashboard that has just started answers from the kept build, marked stale; a copy from another kit or cut short is never read', { timeout: 240000 }, async () => {
  assert.ok(fs.existsSync(kept), 'the first test left a kept build');
  await sleep(9000); // ended longer ago than a build (about 2 s) plus DATA_WAIT_MS, and its copy written
  const keptBody = fs.readFileSync(kept, 'utf8');
  // the warm build takes 8 s: the first read must not wait for it
  setSleep(8000);
  let url = await start();
  const r = await data(url);
  assert.equal(r.status, 200);
  assert.ok(r.took < 4000, `the first read after a start answered from the kept build (${r.took} ms)`);
  assert.equal(r.body, keptBody.slice(keptBody.indexOf('\n') + 1), 'the kept body, as it was');
  assert.equal(r.stale, 'true', 'marked stale: out of date, and ended longer ago than a build plus DATA_WAIT_MS');
  await until(allEnded, 'the warm build to end');
  await running.stop();
  running = null;

  // a kept build under another kit's print is not read, nor one cut short: the first read waits for a build
  const head = keptBody.slice(0, keptBody.indexOf('\n'));
  const body = keptBody.slice(keptBody.indexOf('\n') + 1);
  for (const bad of [`0000000000000000${head.slice(16)}\n${body}`, `${head}\n${body.slice(0, body.length >> 1)}`]) {
    fs.writeFileSync(kept, bad);
    setSleep(3000);
    url = await start();
    const w = await data(url);
    assert.equal(w.status, 200);
    assert.ok(w.took >= 1500, `waited for its own build (${w.took} ms)`);
    assert.equal(w.stale, null);
    JSON.parse(w.body);
    await until(allEnded, 'its build to end');
    await running.stop();
    running = null;
  }
  // a copy a dashboard that is gone was writing is cleared as one starts
  const litter = `${kept}.999999.1.tmp`;
  fs.writeFileSync(litter, 'half');
  setSleep(2000);
  url = await start();
  assert.ok(!fs.existsSync(litter), 'a dead writer\'s temp copy is gone');
  await until(allEnded, 'the warm build to end');
});

test('a moving log with builds slower than DATA_WAIT_MS shows no stale note while builds keep up, and one once a build hangs', { timeout: 240000 }, async () => {
  // builds of 7 s, over the 5 s wait: the served build is always older than the wait, never overdue
  setSleep(7000);
  const n0 = builds().length;
  const url = await start();
  await until(() => builds().length > n0 && allEnded(), 'its own warm build');
  await sleep(500);
  const appends = setInterval(append, 1000);
  try {
    const seen = [];
    const end = Date.now() + 40000;
    while (Date.now() < end) {
      const r = await data(url);
      assert.equal(r.status, 200);
      assert.ok(r.took < 1500, `answered at once (${r.took} ms)`);
      seen.push(r.stale ? 'STALE' : '-');
      await sleep(2000);
    }
    assert.ok(builds().length >= 4, `builds kept coming (${builds().length})`);
    assert.ok(!seen.includes('STALE'), `no read marked stale while builds keep up (${seen.join(' ')})`);
    // a build that hangs: the reads go on (each starts or shares a build, as a page's poll does), and
    // once the hanging one has run a build's length plus the wait past the last one's end, they say so
    setSleep(120000);
    const hangFrom = Date.now();
    let stale = null;
    await until(async () => { const r = await data(url); if (r.stale) stale = r; else await sleep(1000); return !!stale; }, 'a read marked stale once a build is overdue', 60000);
    assert.equal(stale.status, 200);
    assert.ok(builds().at(-1).end === null && builds().at(-1).start >= hangFrom - 50, 'while the hanging build, started after the hang was set, runs');
  } finally {
    clearInterval(appends);
    setSleep(0);
    await running.stop();
    running = null;
  }
});

test('on a quiet log, a build that fails marks the served data stale, and one that succeeds clears it', { timeout: 240000 }, async () => {
  setSleep(2000);
  const n0 = builds().length;
  const url = await start();
  // its own builds only: the last test's hanging build was killed with its dashboard and never said it ended
  await until(() => builds().length > n0 && builds().slice(n0).every((b) => b.end !== null), 'its own warm build');
  await sleep(1500); // past the 1 s reuse window: the next read starts a build
  assert.equal((await data(url)).stale, null, 'a good build, nothing logged: not stale');
  // a build that starts late (no read for a while, here 2 s builds and 9 s quiet) and a log line
  // landing while it runs: the data is out of date, but its successor is on time, so not stale
  await until(() => builds().slice(n0).every((b) => b.end !== null), 'no build of its own running');
  await sleep(9000);
  const late = await data(url); // starts the late build
  assert.equal(late.stale, null, 'the read that starts a late build: not stale');
  await sleep(300);
  append();
  for (let i = 0; i < 4; i++) {
    const r = await data(url);
    assert.equal(r.stale, null, `a log line during a late build that is on time: read ${i + 1} not stale`);
    await sleep(400);
  }
  await until(() => builds().slice(n0).every((b) => b.end !== null), 'the late build and its successor to end');
  await sleep(1500);
  fs.writeFileSync(files.fail, '');
  try {
    let stale = null;
    await until(async () => { const r = await data(url); if (r.stale) stale = r; else await sleep(500); return !!stale; }, 'a read marked stale after a failed build', 60000);
    assert.equal(stale.status, 200, 'still served, from the last good build');
  } finally { fs.rmSync(files.fail, { force: true }); }
  await until(async () => { const r = await data(url); if (r.stale) await sleep(500); return !r.stale; }, 'a read not marked stale once a build succeeds again', 60000);
  await running.stop();
  running = null;
});

