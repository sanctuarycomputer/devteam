// kit-211 done-when 6: a preload that makes a test's folder removal throw, and says which processes
// the test started are still alive once its hooks have run. Linux (reads /proc).
//   PROBE_THROW=<regex on a path> PROBE_OUT=<file> node --import ./probe.mjs --test-name-pattern <re> <file>
// - fs.rmSync throws for a path matching PROBE_THROW (a fixture's folder);
// - the folders the test makes with fs.mkdtempSync are noted: those matching PROBE_THROW, and every
//   tmux folder (dt-tmux-) made after the first, which is lib/kit.mjs's own for the whole file;
// - every child the test process starts (spawn, execFile, fork, exec) is noted with its pid;
// - in a root-level after hook, which node runs once the file's tests and their own t.after hooks
//   are done, and so before any exit listener (lib/kit.mjs prepends one that kills leftover
//   dashboards, lib/chrome.mjs adds one for Chrome), it writes to PROBE_OUT one JSON line per process
//   still alive that the test started: a noted child, or any process of this user whose args or
//   environment name a noted folder (a tmux server by its TMUX_TMPDIR, a pane's agent, a
//   dashboard's children by their HOME). Then a last line: { file, children, dirs, left }. Then it
//   lib/cli.mjs's warm pool (test/lib/cli-runner.mjs: idle node processes the file keeps ready for
//   its next command, each gone with the file's process) is the file's, not a test's: it is counted
//   as pool, never as left. Then it exits, a second later (the reporter's last lines): a test whose hooks didn't let go of a child
//   would otherwise hold the process open, and no exit would come (plan review I3).
import cp from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { after } from 'node:test';

const THROW = process.env.PROBE_THROW ? new RegExp(process.env.PROBE_THROW) : null;
const OUT = process.env.PROBE_OUT;
const realRm = fs.rmSync;
fs.rmSync = function rmSync(p, ...rest) {
  if (THROW && THROW.test(String(p))) throw new Error(`probe: rmSync refused for ${p}`);
  return realRm.call(this, p, ...rest);
};
const dirs = [];
let tmuxDirs = 0;
const realMkdtemp = fs.mkdtempSync;
fs.mkdtempSync = function mkdtempSync(...a) {
  const d = realMkdtemp.apply(this, a);
  if (THROW && THROW.test(d)) dirs.push(d);
  else if (/[\\/]dt-tmux-[^\\/]*$/.test(d) && tmuxDirs++ > 0) dirs.push(d);
  return d;
};
const children = [];
for (const k of ['spawn', 'execFile', 'fork', 'exec']) {
  const real = cp[k];
  cp[k] = function (...a) {
    const c = real.apply(this, a);
    if (c?.pid) children.push(c.pid);
    return c;
  };
}
syncBuiltinESMExports();
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
function survivors() {
  const out = new Map();
  for (const p of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(p) || Number(p) === process.pid) continue;
    const args = read(`/proc/${p}/cmdline`);
    if (args === null) continue;
    const env = read(`/proc/${p}/environ`) ?? '';
    const stat = read(`/proc/${p}/stat`) ?? '';
    if (/\) Z /.test(stat)) continue; // a zombie holds nothing
    const named = dirs.find((d) => args.includes(d) || env.includes(d));
    if (named || children.includes(Number(p))) out.set(Number(p), { pid: Number(p), pgid: Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2]), why: named ? `names ${named}` : 'its child', args: args.split('\0').join(' ').slice(0, 200) });
  }
  return [...out.values()];
}
after(() => {
  if (!OUT) return;
  const all = survivors();
  const pool = all.filter((c) => /[\\/]test[\\/]lib[\\/]cli-runner\.mjs /.test(c.args));
  const left = all.filter((c) => !pool.includes(c));
  fs.appendFileSync(OUT, left.map((c) => `${JSON.stringify(c)}\n`).join('') + `${JSON.stringify({ file: process.argv.at(-1), children: children.length, pool: pool.length, dirs, left: left.length })}\n`);
  setTimeout(() => process.exit(), 1000);
});
