// A project's dashboard keeps its children light (kit-595, box-memory BOXMEM-S3): with no page open
// it starts a `hello` child every 30 s (it was every 10 s), `accounts-tick` once a minute and no
// other node child, and its own memory holds over many ticks.
//
// The seam is a probe every node process loads (NODE_OPTIONS --import); it acts only in the dashboard.
// There it puts every interval timer on a fake clock that only the test moves (it writes the fake ms
// to reach into <dir>/clock; Date.now runs ahead by the same amount), and it wraps child_process's
// execFile and spawn, so each child the dashboard starts is a line in <dir>/kids (the fake ms it
// started at, its command, its timeout) and its end another. Every 20 ms it writes <dir>/ack: the
// fake ms reached, the children still running and its own RSS. The real setTimeout is left alone.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fleetFixture, dashboardOnFreePort, PORTS, write } from './lib/kit.mjs';

const PROBE = `import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const dir = process.env.ZK_DIR;
if (dir && process.argv[2] === 'dashboard') {
  const say = (f, o) => fs.appendFileSync(dir + '/' + f, JSON.stringify(o) + '\\n');
  const realNow = Date.now.bind(Date);
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  let fake = 0;
  let seq = 0;
  let live = 0;
  Date.now = () => realNow() + fake;
  const timers = new Set();
  class FakeInterval {
    constructor(f, ms, args) { this.f = f; this.ms = Math.max(1, Number(ms) || 1); this.args = args; this.due = fake + this.ms; timers.add(this); }
    unref() { return this; }
    ref() { return this; }
    hasRef() { return false; }
    refresh() { this.due = fake + this.ms; return this; }
    close() { timers.delete(this); return this; }
  }
  globalThis.setInterval = (f, ms, ...args) => new FakeInterval(f, ms, args);
  globalThis.clearInterval = (t) => (t instanceof FakeInterval ? void timers.delete(t) : realClearInterval(t));
  for (const name of ['execFile', 'spawn']) {
    const real = cp[name];
    cp[name] = function (file, args, ...rest) {
      const c = real.call(this, file, args, ...rest);
      const o = rest.find((x) => x && typeof x === 'object') ?? {};
      const node = file === process.execPath;
      const cmd = node && Array.isArray(args) ? args.slice(1).join(' ') : String(file);
      const id = ++seq;
      live += 1;
      say('kids', { ev: 'start', id, at: fake, node, cmd, timeout: o.timeout ?? null, kill: o.killSignal ?? null });
      // on close, after execFile's own callback (registered first) has started what comes next
      c.once('close', () => { live -= 1; say('kids', { ev: 'end', id, at: fake, node, cmd }); });
      return c;
    };
  }
  syncBuiltinESMExports();
  let acks = 0;
  realSetInterval(() => {
    let target = NaN;
    try { target = Number(fs.readFileSync(dir + '/clock', 'utf8')); } catch {}
    if (Number.isFinite(target) && target > fake) {
      for (;;) {
        let next = null;
        for (const t of timers) if (t.due <= target && (!next || t.due < next.due)) next = t;
        if (!next) break;
        fake = next.due;
        next.due += next.ms;
        try { next.f(...next.args); } catch (e) { say('errors', { at: fake, e: String(e?.stack ?? e) }); }
      }
      fake = target;
    }
    fs.writeFileSync(dir + '/ack.tmp', JSON.stringify({ n: ++acks, fake, live, rss: process.memoryUsage().rss }));
    fs.renameSync(dir + '/ack.tmp', dir + '/ack');
  }, 20).unref();
}
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 60000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out after ${ms} ms: ${what}`);
    await sleep(10);
  }
}
const readJsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const ack = (X) => { try { return JSON.parse(fs.readFileSync(path.join(X.dir, 'ack'), 'utf8')); } catch { return null; } };
// the node children the dashboard started, by name (hello, accounts-tick, dashboard-data, …)
const kids = (X) => readJsonl(path.join(X.dir, 'kids')).filter((k) => k.ev === 'start' && k.node).map((k) => ({ ...k, name: k.cmd.split(' ')[0] }));
// the fake clock moved to ms, then settled: every child it started has ended, seen on three acks in a row
async function settle(X, ms) {
  fs.writeFileSync(path.join(X.dir, 'clock'), String(ms));
  let quiet = 0;
  let last = 0;
  return until(() => {
    const a = ack(X);
    if (!a || a.n === last) return false;
    last = a.n;
    quiet = a.fake === ms && a.live === 0 ? quiet + 1 : 0;
    return quiet >= 3 ? a : false;
  }, `the dashboard at fake ${ms} ms with no child running (last ack ${JSON.stringify(ack(X))}; ${X.d.out().slice(-400)})`, 120000);
}
async function walk(X, from, to, step) {
  let a = null;
  for (let t = from + step; t <= to; t += step) a = await settle(X, t);
  return a;
}

const fixtures = [];
after(async () => { for (const X of fixtures) { await X.d.stop(); X.F.done(); } });
async function start(name, off) {
  const F = fleetFixture(name);
  const dir = path.join(F.base, 'probe');
  fs.mkdirSync(dir);
  const probe = path.join(F.base, 'probe.mjs');
  write(probe, PROBE);
  const env = F.env({
    DEVTEAM_HUB_PORT: String(PORTS + off), DEVTEAM_PORT_BASE: String(PORTS + off + 1),
    // no hub of its own: the box's image stands for one, so the hub is no child of the dashboard
    DEVTEAM_IMAGE_HUB: String(PORTS + off),
    DEVTEAM_DATA_WAIT_MS: '600000',
    DEVTEAM_DATA_AT_ONCE: '0',
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import ${pathToFileURL(probe).href}`].filter(Boolean).join(' '),
    ZK_DIR: dir,
  });
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_HOME', 'DEVTEAM_PROJECT', 'DEVTEAM_DATA_REUSE_MS', 'DEVTEAM_ACCOUNTS_MS', 'DEVTEAM_PREVIEW_TICK_MS', 'DEVTEAM_KIT_WATCH_MS', 'TMUX', 'TMUX_PANE']) delete env[k];
  const { dash: d, port } = await dashboardOnFreePort(F.old, env);
  const X = { F, d, port, dir };
  fixtures.push(X);
  return X;
}

test('box-memory dashboard: a hello child every 30 s, accounts-tick once a minute, no other node child in a quiet minute; RSS holds over 30 ticks', { timeout: 600000 }, async () => {
  const X = await start('bm-dash', 0);
  // the start: its first hello (and what else it starts as it listens) ended
  await settle(X, 0);
  const atStart = kids(X).length;
  assert.ok(kids(X).some((k) => k.name === 'hello' && k.at === 0), `a hello at the start (${kids(X).map((k) => `${k.at} ${k.name}`).join(', ')})`);

  // two minutes of fake time, a second at a time, no page open
  let first = null;
  for (let t = 1000; t <= 120000; t += 1000) {
    const a = await settle(X, t);
    if (t === 30000) first = a;
  }
  const hellos = kids(X).filter((k) => k.name === 'hello').map((k) => k.at);
  assert.deepEqual(hellos, [0, 30000, 60000, 90000, 120000], 'a hello child every 30 s of fake time (not every 10 s)');
  const accounts = kids(X).filter((k) => k.name === 'accounts-tick').map((k) => k.at);
  assert.deepEqual(accounts, [60000, 120000], 'accounts-tick once a minute');
  const minute = kids(X).slice(atStart).filter((k) => k.at > 60000 && k.at <= 120000).map((k) => k.name).sort();
  assert.deepEqual(minute, ['accounts-tick', 'hello', 'hello'], 'the second minute: two hellos, one accounts-tick, no other node child');

  // on to the 30th hello tick after the first (fake 900 s), 5 s at a time
  const last = await walk(X, 120000, 900000, 5000);
  assert.equal(kids(X).filter((k) => k.name === 'hello' && k.at >= 30000).length, 30, '30 hello ticks from the first');
  const grew = last.rss - first.rss;
  assert.ok(grew < 30 * 1024 * 1024, `RSS after 30 ticks within 30 MB of after the first (${Math.round(first.rss / 1048576)} MB then ${Math.round(last.rss / 1048576)} MB)`);
  assert.deepEqual(readJsonl(path.join(X.dir, 'errors')), [], 'no timer threw');
});
