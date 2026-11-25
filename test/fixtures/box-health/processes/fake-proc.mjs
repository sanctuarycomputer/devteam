// A fake /proc and cgroup for the processes part (kit-837): a folder of <pid>/stat, cmdline, cwd (a
// symlink, whose target may not exist) and environ, an uptime and a cpu.stat. Nothing in it is this
// machine's. Each process's environ, and each argument after its first words, carries a marker
// the test looks for wherever the part's results and words go.
import fs from 'node:fs';
import path from 'node:path';

export const HZ = 100;
export const SECRET = 'SECRET-ARG-7f3a';
export const ENV_SECRET = 'SECRET-ENV-91c2';

// p: { pid, ppid = 1, comm = basename of argv[0], argv: [...], cwd, cpu = 0 (ticks), reaped = 0,
//      start (ticks after boot), pages = 100 }
export function fakeProc(dir, { uptime = 100000 } = {}) {
  const proc = path.join(dir, 'proc'), cgroup = path.join(dir, 'cgroup');
  fs.mkdirSync(proc, { recursive: true });
  fs.mkdirSync(cgroup, { recursive: true });
  const all = new Map();
  const box = {
    proc, cgroup, all,
    uptime(s) { fs.writeFileSync(path.join(proc, 'uptime'), `${s.toFixed(2)} 12345.67\n`); },
    usage(usec) { fs.writeFileSync(path.join(cgroup, 'cpu.stat'), `usage_usec ${usec}\nuser_usec 1\nsystem_usec 1\nnr_periods 0\n`); },
    stat(p) {
      const f = Array.from({ length: 50 }, () => '0');
      // each time split between user and system, so both are read
      f[0] = 'S'; f[1] = String(p.ppid); f[11] = String(Math.ceil(p.cpu / 2)); f[12] = String(Math.floor(p.cpu / 2)); f[13] = String(Math.ceil(p.reaped / 2)); f[14] = String(Math.floor(p.reaped / 2));
      f[19] = String(p.start); f[20] = '1000000'; f[21] = String(p.pages);
      fs.writeFileSync(path.join(proc, String(p.pid), 'stat'), `${p.pid} (${p.comm}) ${f.join(' ')}\n`);
    },
    add(spec) {
      const p = { ppid: 1, cpu: 0, reaped: 0, start: 1000, pages: 100, ...spec };
      p.comm ??= path.basename(p.argv?.[0] ?? 'x').slice(0, 15);
      const d = path.join(proc, String(p.pid));
      fs.mkdirSync(d, { recursive: true });
      const argv = p.argv ?? [];
      fs.writeFileSync(path.join(d, 'cmdline'), argv.length ? `${[...argv, `--marker=${SECRET}`].join('\0')}\0` : '');
      fs.writeFileSync(path.join(d, 'environ'), `HOME=/x\0TOKEN=${ENV_SECRET}\0`);
      fs.rmSync(path.join(d, 'cwd'), { force: true });
      if (p.cwd !== undefined) fs.symlinkSync(p.cwd, path.join(d, 'cwd'));
      all.set(p.pid, p);
      box.stat(p);
      return p;
    },
    set(pid, more) { const p = all.get(pid); Object.assign(p, more); box.stat(p); return p; },
    gone(pid) { fs.rmSync(path.join(proc, String(pid)), { recursive: true, force: true }); all.delete(pid); },
  };
  box.uptime(uptime);
  box.usage(0);
  return box;
}
