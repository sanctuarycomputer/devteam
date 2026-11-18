// Makes proc/ (a fake /proc with a fake cgroup at proc/cgroup/) and proc-expected.json (what a
// recorder must make of it: kit-591's target) from the one table below. Each process is
// proc/<pid>/ with cmdline (NUL-separated, a trailing NUL, as the real /proc), comm (with its
// newline), statm (seven page counts, resident second) and cwd, a symlink to an absolute path under
// two fake roots that don't exist (a recorder reads it with readlink, as the real /proc). Each row is
// written by hand from the contract's rules (the comment above memoryReadingProblem in devteam.mjs);
// the reading is summed from the rows and statm. Built-ins only: change the table here and run
// `node test/fixtures/box-memory/make-proc.mjs` to remake both.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PAGE = 4096;
const ROOTS = { 'devteam-dev': '/fixture/code/devteam-dev', mothership: '/fixture/code/mothership' };
const DEV = ROOTS['devteam-dev'], MS = ROOTS.mothership;
const DT = (root) => `${root}/docs/devteam/scripts/devteam.mjs`;
const AT = '2026-11-17T14:00:00Z';
// The cgroup: memory.current less inactive_file is the working set the box's gate counts.
const MAX = 51539607552;
const CURRENT = 23622320128;
const STAT = [
  ['anon', 15032385536], ['file', 8053063680], ['kernel', 536870912], ['kernel_stack', 41943040],
  ['sock', 4194304], ['shmem', 536870912], ['file_mapped', 1073741824], ['file_dirty', 8388608],
  ['inactive_anon', 2147483648], ['active_anon', 12884901888], ['inactive_file', 3221225472],
  ['active_file', 4294967296], ['unevictable', 0],
];

// pid, argv (empty for a kernel thread), comm, cwd (null: unreadable, no link), resident pages, and the row.
export const PROCESSES = [
  [27, [], 'kworker/0:1', null, 0, { kind: 'other' }],
  [640, ['sleep', '600'], 'sleep', '/tmp', 200, { kind: 'other' }],
  [700, ['/usr/bin/node', '/srv/other-user/app.js'], 'node', null, 12000, { kind: 'node' }],
  [812, ['bash'], 'bash', DEV, 1100, { kind: 'other', project: 'devteam-dev' }],
  [905, ['/bin/bash', '-l'], 'bash', '/fixture/code/devteam-dev-old', 900, { kind: 'other' }],
  [1001, ['claude'], 'claude', DEV, 98000, { kind: 'agent', project: 'devteam-dev' }],
  [1102, ['node', DT(DEV), 'dashboard'], 'node', DEV, 52000, { kind: 'devteam', subcommand: 'dashboard', project: 'devteam-dev' }],
  [1150, ['/usr/local/bin/node', DT(MS), 'wait', '--for', 'm-2-fixture'], 'node', MS, 18000, { kind: 'devteam', subcommand: 'wait', project: 'mothership' }],
  [1203, ['/home/fixture/.local/bin/claude', '--api-key=FIXTURE-SECRET-DO-NOT-KEEP', '--continue'], 'claude', `${DEV}/.worktrees/kit-1-fixture`, 140000,
    { kind: 'agent', project: 'devteam-dev', session: true }],
  [1240, ['node', DT(DEV), 'hello', '--json', '--pane'], 'node', `${DEV}/.worktrees/kit-1-fixture`, 24000, { kind: 'devteam', subcommand: 'hello', project: 'devteam-dev' }],
  [1302, ['codex'], 'codex', `${MS}/.worktrees/m-2-fixture/app`, 61000, { kind: 'agent', project: 'mothership', session: true }],
  [1311, ['/usr/local/bin/opencode'], 'opencode', `${MS}/.worktrees/m-3-fixture`, 45000, { kind: 'agent', project: 'mothership', session: true }],
  [1350, ['node', DT(MS), 'gate', 'ci', '--', 'npm', 'test'], 'MainThread', `${MS}/.worktrees/m-3-fixture`, 30000, { kind: 'devteam', subcommand: 'gate', project: 'mothership' }],
  [1388, ['npm ci'], 'npm ci', `${DEV}/.worktrees/kit-1-fixture`, 36000, { kind: 'install', project: 'devteam-dev' }],
  [1395, ['npm test'], 'npm test', `${DEV}/.worktrees/kit-1-fixture`, 14000, { kind: 'other', project: 'devteam-dev' }],
  [1420, ['/usr/lib/chromium/chromium', '--headless=new', '--remote-debugging-port=0', '--user-data-dir=/tmp/chromium-fixture'], 'chromium',
    `${MS}/.worktrees/m-2-fixture`, 75000, { kind: 'browser', project: 'mothership' }],
  [1440, ['node', '/usr/lib/node_modules/npm/bin/npm-cli.js', 'install'], 'node', `${MS}/.worktrees/m-3-fixture`, 33000, { kind: 'install', project: 'mothership' }],
  [1466, ['node', 'server.js'], 'node', `${MS}/.worktrees/m-2-fixture/app`, 15000, { kind: 'node', project: 'mothership' }],
  [1490, ['node', DT(MS), '--help'], 'node', MS, 11000, { kind: 'devteam', project: 'mothership' }],
];

// statm: size resident shared text lib data dt, in pages; a kernel thread's is all zero.
const statm = (res) => (res === 0 ? [0, 0, 0, 0, 0, 0, 0] : [res * 4 + 1024, res, Math.floor(res / 5), 1000, 0, Math.floor(res * 0.9), 0]).join(' ');

// Every file under proc/: { text } or { link }, by its path relative to proc/.
export function procFiles() {
  const files = {};
  for (const [pid, argv, comm, cwd, res] of PROCESSES) {
    files[`${pid}/cmdline`] = { text: argv.map((a) => `${a}\0`).join('') };
    files[`${pid}/comm`] = { text: `${comm}\n` };
    files[`${pid}/statm`] = { text: `${statm(res)}\n` };
    if (cwd !== null) files[`${pid}/cwd`] = { link: cwd };
  }
  files['cgroup/memory.max'] = { text: `${MAX}\n` };
  files['cgroup/memory.current'] = { text: `${CURRENT}\n` };
  files['cgroup/memory.stat'] = { text: STAT.map(([k, v]) => `${k} ${v}\n`).join('') };
  return files;
}

export function makeExpected() {
  const processes = {}, kinds = {}, devteam = {}, projects = {};
  let sessions = 0;
  for (const [pid, , , , res, row] of PROCESSES) {
    processes[pid] = row;
    const rss = res * PAGE;
    const k = (kinds[row.kind] ??= { n: 0, rss: 0 }); k.n++; k.rss += rss;
    if (row.subcommand) { const d = (devteam[row.subcommand] ??= { n: 0, rss: 0 }); d.n++; d.rss += rss; }
    if (row.session) sessions++;
    if (row.project) {
      const p = (projects[row.project] ??= { rss: 0 });
      p.rss += rss;
      if (row.session) p.sessions = (p.sessions ?? 0) + 1;
      if (row.subcommand) { p.devteam ??= {}; p.devteam[row.subcommand] = (p.devteam[row.subcommand] ?? 0) + rss; }
    }
  }
  const inactive = Object.fromEntries(STAT).inactive_file;
  // In the contract's order: the kinds as it lists them, a project's rss, sessions, devteam.
  const kindsInOrder = Object.fromEntries(['agent', 'browser', 'install', 'devteam', 'node', 'other'].filter((k) => kinds[k]).map((k) => [k, kinds[k]]));
  const projectsInOrder = Object.fromEntries(Object.entries(projects).map(([name, p]) => [name, { rss: p.rss, sessions: p.sessions, devteam: p.devteam }]));
  const reading = { v: 1, at: AT, working_set: CURRENT - inactive, max: MAX, source: 'cgroup', sessions, kinds: kindsInOrder, devteam, projects: projectsInOrder };
  return `${JSON.stringify({ roots: ROOTS, page_size: PAGE, processes, reading }, null, 2)}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  fs.rmSync(path.join(here, 'proc'), { recursive: true, force: true });
  for (const [rel, f] of Object.entries(procFiles())) {
    const p = path.join(here, 'proc', rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if ('link' in f) fs.symlinkSync(f.link, p); else fs.writeFileSync(p, f.text);
  }
  fs.writeFileSync(path.join(here, 'proc-expected.json'), makeExpected());
}
