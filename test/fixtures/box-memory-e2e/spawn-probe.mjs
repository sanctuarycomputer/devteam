// The spawn-counting seam for test/box-memory-e2e.test.mjs (kit-598), as kit-595's
// test/box-memory-dashboard.test.mjs has it inline: loaded into every node process through
// NODE_OPTIONS --import, it acts only in a dashboard (argv[2] === 'dashboard') with ZK_DIR set. There
// it puts every interval timer on a fake clock that only the test moves (it writes the fake ms to
// reach into <dir>/clock; Date.now runs ahead by the same amount), and it wraps child_process's
// execFile and spawn, so each child the dashboard starts is a line in <dir>/kids (the fake ms it
// started at, whether it is node, its command, its timeout) and its end another. Every 20 ms it writes
// <dir>/ack: the fake ms reached, the children still running and its own RSS. The real setTimeout is
// left alone.
import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const dir = process.env.ZK_DIR;
if (dir && process.argv[2] === 'dashboard') {
  const say = (f, o) => fs.appendFileSync(dir + '/' + f, JSON.stringify(o) + '\n');
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
