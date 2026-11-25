// What the pool part reads, faked: project roots holding a pool.json (and a dashboard-port), and the
// results of the processes part (kit-837's shape) and the disk part (kit-838's), built by the test.
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
export const poolText = (name) => fs.readFileSync(path.join(here, `${name}.json`), 'utf8');

// a project's root under dir: its run/cache/pool.json from fixture `file` (or none), and its
// run/dashboard-port when port is given
export function projectRoot(dir, { file, port, text } = {}) {
  const run = path.join(dir, 'docs', 'devteam', 'run');
  fs.mkdirSync(path.join(run, 'cache'), { recursive: true });
  if (file || text !== undefined) fs.writeFileSync(path.join(run, 'cache', 'pool.json'), text ?? poolText(file));
  if (port !== undefined) fs.writeFileSync(path.join(run, 'dashboard-port'), `${port}\n`);
  return dir;
}

// one place of the processes part: { root, project, worktree?, n, agents, cpu?, rss, tests, own }
export function place(root, project, worktree, { n = 1, agents = 0, cpu, rss = 0, tests = { n: 0, rss: 0 } } = {}) {
  return {
    root, project, ...(worktree === undefined ? {} : { worktree }), n, agents, ...(cpu === undefined ? {} : { cpu }), rss,
    tests: { n: tests.n, ...(cpu === undefined ? {} : { cpu: tests.cpu ?? 0 }), rss: tests.rss ?? 0 },
    own: { n: 0, ...(cpu === undefined ? {} : { cpu: 0 }), rss: 0 },
  };
}
// the processes part's result; with cpu false, a first walk's (no over_s, no CPU)
export function processes(places, { cpu = true, outside = { n: 2, agents: 0, cpu: 0.2, rss: 1000 }, unattributed = { cpu: 0.4 }, strays = [] } = {}) {
  const out = { at: 0, places, outside: cpu ? outside : { n: outside.n, agents: outside.agents, rss: outside.rss }, strays };
  if (cpu) { out.over_s = 15; out.unattributed = unattributed; }
  return out;
}
// the disk part's result: [[root, worktree, disk?, disk_at]]
export const disk = (rows) => ({ worktrees: rows.map(([root, worktree, bytes, at]) => ({ root, worktree, ...(bytes === undefined ? {} : { disk: bytes }), disk_at: at })) });
