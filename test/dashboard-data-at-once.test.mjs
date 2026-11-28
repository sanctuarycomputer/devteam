// /api/data answered at once (cmdDashboard): a read with a last good build has it straight away
// while a newer build runs for the next read, marked stale only once that build is older than
// DATA_WAIT_MS; a read after an owner action waits for a build that shows it; and the last good
// build is kept on disk under the kit's print, so a dashboard that has just started answers its
// first read before its first build ends. Both pages (docs/devteam/dashboard and apps/dashboard)
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
  fs.appendFileSync(process.env.ZA_BUILDS, 'start ' + Date.now() + '\\n');
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  process.on('exit', () => fs.appendFileSync(process.env.ZA_BUILDS, 'end ' + Date.now() + '\\n'));
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
const files = { probe: path.join(F.base, 'probe.mjs'), builds: path.join(F.base, 'builds.txt'), sleep: path.join(F.base, 'sleep.txt') };
write(files.probe, PROBE);
write(files.builds, '');
write(files.sleep, '0');
const env = F.env({
  DEVTEAM_HUB_PORT: String(PORTS), DEVTEAM_PORT_BASE: String(PORTS + 1),
  CLAUDE_CONFIG_DIR: path.join(F.base, 'claude'), CODEX_HOME: path.join(F.base, 'codex'),
  // stale after 5 s, so the restart below sees a kept build marked stale without a long wait
  DEVTEAM_DATA_WAIT_MS: '5000',
  NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import ${pathToFileURL(files.probe).href}`].filter(Boolean).join(' '),
  ZA_BUILDS: files.builds, ZA_SLEEP: files.sleep,
});
for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_HOME', 'DEVTEAM_PROJECT', 'DEVTEAM_DATA_REUSE_MS', 'DEVTEAM_DATA_AT_ONCE', 'TMUX', 'TMUX_PANE']) delete env[k];
const kept = path.join(F.old, 'docs/devteam/run/cache/dashboard-data.last');
const logDir = path.join(F.old, 'docs/devteam/run/log');
let running = null;
after(async () => { await running?.stop(); F.done(); });

const setSleep = (ms) => fs.writeFileSync(files.sleep, String(ms));
function builds() {
  const lines = fs.readFileSync(files.builds, 'utf8').split('\n').filter(Boolean);
  const ends = lines.filter((l) => l.startsWith('end ')).map((l) => Number(l.slice(4)));
  return lines.filter((l) => l.startsWith('start ')).map((l, i) => ({ start: Number(l.slice(6)), end: ends[i] ?? null }));
}
const allEnded = () => builds().every((b) => b.end !== null);
async function start() {
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

  // the log moves and builds take 4 s: the read still answers at once, with the build it had
  setSleep(4000);
  await sleep(1100); // past generated_at's second, so a newer build says a newer time
  append();
  const was = builds().length;
  const quick = await data(url);
  assert.equal(quick.status, 200);
  assert.ok(quick.took < 1500, `answered at once, not after the 4 s build (${quick.took} ms)`);
  assert.equal(quick.body, first.body, 'with the last good build');
  await until(() => builds().length > was, 'the read started a newer build');
  // the child has said it ended a moment before its output reaches the dashboard: read until it has
  let next = null;
  await until(async () => { next = await data(url); return generated(next) > generated(first); }, 'a read with the newer build', 20000);
  assert.ok(next.took < 1500, `answered at once (${next.took} ms)`);

  // an owner action: the next read waits for a build that started after it
  setSleep(1000);
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
  setSleep(0);
  await running.stop();
  running = null;
});

test('a dashboard that has just started answers from the kept build, marked stale; another kit never reads it', { timeout: 240000 }, async () => {
  assert.ok(fs.existsSync(kept), 'the first test left a kept build');
  await sleep(5100); // older than DATA_WAIT_MS, and the last build's copy written
  const keptBody = fs.readFileSync(kept, 'utf8');
  // the warm build takes 6 s: the first read must not wait for it
  setSleep(8000);
  let url = await start();
  const r = await data(url);
  assert.equal(r.status, 200);
  assert.ok(r.took < 4000, `the first read after a start answered from the kept build (${r.took} ms)`);
  assert.equal(r.body, keptBody.slice(keptBody.indexOf('\n') + 1), 'the kept body, as it was');
  assert.equal(r.stale, 'true', 'marked stale: older than DATA_WAIT_MS');
  await until(allEnded, 'the warm build to end');
  await running.stop();
  running = null;

  // a kept build under another kit's print is not read: the first read waits for a build
  fs.writeFileSync(kept, `0000000000000000\n${keptBody.slice(keptBody.indexOf('\n') + 1)}`);
  setSleep(3000);
  url = await start();
  const w = await data(url);
  assert.equal(w.status, 200);
  assert.ok(w.took >= 1500, `waited for its own build (${w.took} ms)`);
  assert.equal(w.stale, null);
  setSleep(0);
});
