// A clock ahead of the machine's, for test/fast-threads-e2e.test.mjs (kit-107): loaded into every node
// process the test starts (NODE_OPTIONS=--import=<this file>, with DT_CLOCK_FILE naming a file that
// holds a number of ms), so the kit, the stub agent and the stub's kit commands all read the same
// "now", and the test can move it forward past a threshold (3 minutes for responder-overdue) without
// waiting for it. The offset only grows, so every line the kit writes is later than the one before.
// It is read again at most every 200 ms of real time, so a long-lived process (the stub, a dashboard)
// follows a move. File times move with it: the kit dates its locks by a file's mtime against
// Date.now() (a lock older than its stale limit is taken over), so every stat a process makes reads
// its times by the same offset, and a lock made a moment ago is a moment old; and a time the kit
// stamps on a file (utimes, with its shifted new Date()) is written back by the offset, so it reads as
// stamped, not twice ahead. With DT_CLOCK_FILE
// unset, missing or 0, Date and fs are left as they are.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const file = process.env.DT_CLOCK_FILE;
if (file) {
  const Real = Date;
  const realNow = Real.now.bind(Real);
  let off = 0;
  let readAt = -Infinity;
  const offset = () => {
    const t = realNow();
    if (t - readAt >= 200) {
      readAt = t;
      try { off = Number(fs.readFileSync(file, 'utf8').trim()) || 0; } catch { off = 0; }
    }
    return off;
  };
  const now = () => realNow() + offset();
  class ShiftedDate extends Real {
    constructor(...a) { if (a.length === 0) super(now()); else super(...a); }
    static now() { return now(); }
  }
  // Date() called as a function returns a string, as it does unshifted
  globalThis.Date = new Proxy(ShiftedDate, { apply: () => new Real(now()).toString() });
  // a Stats' times, by the offset
  const shift = (st) => {
    const o = offset();
    // a bigint Stats ({ bigint: true }) is left as it is: the kit reads none
    if (!st || !o || typeof st.mtimeMs !== 'number') return st;
    for (const k of ['atime', 'mtime', 'ctime', 'birthtime']) {
      const ms = st[`${k}Ms`] + o;
      Object.defineProperty(st, `${k}Ms`, { value: ms, writable: true, enumerable: true, configurable: true });
      Object.defineProperty(st, k, { value: new Real(ms), writable: true, enumerable: true, configurable: true });
    }
    return st;
  };
  for (const name of ['statSync', 'lstatSync', 'fstatSync']) {
    const f = fs[name];
    fs[name] = function (...a) { return shift(f.apply(this, a)); };
  }
  for (const name of ['stat', 'lstat', 'fstat']) {
    const f = fs[name];
    fs[name] = function (...a) { const cb = a.pop(); return f.apply(this, [...a, (e, st) => cb(e, shift(st))]); };
    const p = fs.promises[name === 'fstat' ? 'stat' : name];
    if (name !== 'fstat') fs.promises[name] = async (...a) => shift(await p(...a));
  }
  // a time given to utimes (a Date, a number of seconds, or a numeric string), back by the offset
  const back = (t) => {
    const o = offset();
    if (!o) return t;
    if (t instanceof Real) return new Real(t.getTime() - o);
    if (typeof t === 'number' || (typeof t === 'string' && t.trim() !== '' && !Number.isNaN(Number(t)))) return Number(t) - o / 1000;
    return t;
  };
  for (const name of ['utimesSync', 'futimesSync', 'lutimesSync']) {
    const f = fs[name];
    if (f) fs[name] = function (p, a, m) { return f.call(this, p, back(a), back(m)); };
  }
  for (const name of ['utimes', 'futimes', 'lutimes']) {
    const f = fs[name];
    if (f) fs[name] = function (p, a, m, cb) { return f.call(this, p, back(a), back(m), cb); };
    const pf = fs.promises[name];
    if (pf) fs.promises[name] = (p, a, m) => pf(p, back(a), back(m));
  }
  syncBuiltinESMExports();
}
