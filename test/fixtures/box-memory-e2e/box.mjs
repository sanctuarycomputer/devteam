// The fixture box for test/box-memory-e2e.test.mjs (kit-598): a fake /proc with a fake cgroup at
// <dir>/cgroup/, written into a scratch folder by writeBox(dir) from the one table below. Two projects,
// alpha and beta, each with two agent sessions (an agent whose cwd is in <root>/.worktrees/), and a
// few other processes: an agent in a project's root (no session), a dashboard, a wait, a browser and
// a process in no project. The roots don't exist: the hub names them from its registry (their
// folder's name, with no settings.md to read). Each process is <pid>/ with cmdline (NUL-separated,
// a trailing NUL), comm, statm (seven page counts, resident second) and cwd (a symlink), as kit-590's
// test/fixtures/box-memory/make-proc.mjs writes them. Built-ins only.
import fs from 'node:fs';
import path from 'node:path';

export const PAGE = 4096;
export const ROOTS = { alpha: '/fixture/e2e/alpha', beta: '/fixture/e2e/beta' };
const A = ROOTS.alpha, B = ROOTS.beta;
const DT = (root) => `${root}/docs/devteam/scripts/devteam.mjs`;
// The cgroup: with DEVTEAM_MEMORY_COUNTS_CACHE=1 (as the box image sets) the working set is
// memory.current less memory.stat's inactive_file: 12 GiB - 2 GiB = 10 GiB of a 32 GiB cap.
export const MAX = 32 * 2 ** 30;
export const CURRENT = 12 * 2 ** 30;
export const INACTIVE_FILE = 2 * 2 ** 30;
export const WORKING_SET = CURRENT - INACTIVE_FILE;
const STAT = [['anon', 9 * 2 ** 30], ['file', 3 * 2 ** 30], ['shmem', 2 ** 28], ['inactive_file', INACTIVE_FILE], ['active_file', 2 ** 30]];

// pid, argv, comm, cwd, resident pages
export const PROCESSES = [
  [2001, ['claude'], 'claude', A, 30000],
  [2101, ['claude', '--continue'], 'claude', `${A}/.worktrees/a-1`, 120000],
  [2102, ['/home/fixture/.local/bin/claude'], 'claude', `${A}/.worktrees/a-2/src`, 100000],
  [2110, ['node', DT(A), 'dashboard'], 'node', A, 50000],
  [2120, ['/usr/lib/chromium/chromium', '--headless=new'], 'chromium', `${A}/.worktrees/a-1`, 70000],
  [2201, ['codex'], 'codex', `${B}/.worktrees/b-1`, 80000],
  [2202, ['claude'], 'claude', `${B}/.worktrees/b-2`, 60000],
  [2210, ['node', DT(B), 'wait', '--minutes', '10'], 'node', B, 20000],
  [2300, ['sleep', '600'], 'sleep', '/tmp', 100],
];
// What the hub must make of it: four sessions, two in each project.
export const SESSIONS = 4;
export const PROJECT_SESSIONS = { alpha: 2, beta: 2 };

const statm = (res) => [res * 4 + 1024, res, Math.floor(res / 5), 1000, 0, Math.floor(res * 0.9), 0].join(' ');

// Writes the box under dir: { proc, cgroup }, the paths for DEVTEAM_PROC and DEVTEAM_CGROUP.
export function writeBox(dir) {
  const put = (rel, text) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  for (const [pid, argv, comm, cwd, res] of PROCESSES) {
    put(`${pid}/cmdline`, argv.map((a) => `${a}\0`).join(''));
    put(`${pid}/comm`, `${comm}\n`);
    put(`${pid}/statm`, `${statm(res)}\n`);
    fs.symlinkSync(cwd, path.join(dir, String(pid), 'cwd'));
  }
  put('cgroup/memory.max', `${MAX}\n`);
  put('cgroup/memory.current', `${CURRENT}\n`);
  put('cgroup/memory.stat', STAT.map(([k, v]) => `${k} ${v}\n`).join(''));
  return { proc: dir, cgroup: path.join(dir, 'cgroup') };
}
