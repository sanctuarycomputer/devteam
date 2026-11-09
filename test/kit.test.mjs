// End-to-end test of the kit against a throwaway repo: plan PR, worker lifecycle, questions,
// trust, corrections, forgery, log-sync, and the computed views. The steps are in lib/chain.mjs.
// Run the suite: node --test --test-concurrency=8 test/*.test.mjs  (DEVTEAM_TEST_KEEP=1 keeps the fixtures;
// DEVTEAM_TEST_COLD=1 spawns every CLI call fresh instead of through lib/cli.mjs)
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { steps, snapshot, useFixture, tmp } from './lib/chain.mjs';
import { testDir } from './lib/kit.mjs';

// Steps that run in a fork of the fixture, beside the rest. A fork is copied at the step's place,
// so it starts from what the in-line steps before it left, without what earlier forks did; the
// steps after it go on without it. So a step is here only if no later assertion needs what it
// leaves: it puts back what it changes, or what it changes (its own questions, branches, worktrees,
// goals) only changes what a later listing or count holds. Consecutive steps in one entry run in
// one fork, in order, when a later one reads an earlier one's work. Every assertion still runs, but
// some see other values than they would in line: a listing without another fork's lines.
const FORKS = [
  ['goal measures:'],
  ['review-worktree:'],
  ['an answer the owner gave in the supervisor chat'],
  ['questions carry choices'],
  ['forged lines'],
  ['a chore PR that touches the kit'],
  ['a PR of any kind that changes owner settings'],
  ['an answer one act recorded'],
  ["the owner's CI-fix rule"],
  ['a standing owner rule approves upstream syncs'],
  ['a planner in flight'],
  ['parallel planners'],
  ['a fully defined goal nobody is planning'],
  ['a lost Enter'],
  ['a ready goal changes'],
  ['goal holds:'],
  ['secrets:'],
  ["merge waits for the forge's checks"],
  ['goal list flags'],
  ['approve-plan accepts', "a ticket's merge gate", 'spend is measured'],
  ['review questions: a page'],
  ['review questions on the dashboard'],
  ['dashboard: Library and the artifact viewer'],
  ['review permanence'],
  ['artifacts: new, check, list', 'artifacts: check-pr and merge refuse', 'artifacts: the dashboard serves them', 'artifacts: a question links one', 'artifacts: the Library data', 'public artifacts: an artifact-publish act', 'public artifacts: owner acts are records'],
];

const forked = new Map();
FORKS.forEach((group, g) => group.forEach((prefix) => {
  const i = steps.findIndex((s) => s.name.startsWith(prefix));
  if (i < 0) throw new Error(`FORKS names no step: ${prefix}`);
  forked.set(i, g);
}));

// Only the loaders a fork needs from this process's command line (the test runner adds many more).
const loaders = process.execArgv.flatMap((a, i, all) => (/^--(import|require)=/.test(a) ? [a] : /^(--import|--require|-r)$/.test(a) ? [a, all[i + 1]] : []));

function fork(t, indexes, n) {
  const dir = `${tmp}-fork-${n}`;
  snapshot(dir, indexes);
  const log = path.join(dir, 'fork.log');
  const fd = fs.openSync(log, 'w');
  const child = spawn(process.execPath, [...loaders, path.join(testDir, 'lib', 'fork.mjs')], { env: { ...process.env, DEVTEAM_FORK: dir }, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  const exited = new Promise((resolve) => { child.on('error', (e) => resolve(String(e))); child.on('close', (code, signal) => resolve(signal ?? code)); });
  return Promise.all(indexes.map((i) => t.test(steps[i].name, async (st) => {
    const code = await exited;
    const f = path.join(dir, `result-${i}.json`);
    const r = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    for (const d of r?.diagnostics ?? []) st.diagnostic(d);
    if (r?.skip !== null && r?.skip !== undefined) return st.skip(r.skip);
    if (r?.ok && code === 0) return;
    const e = new Error(`${r?.error?.message ?? `the fork exited ${code} with no result for this step`}\n(run in a fork of the fixture: ${log})\n${r?.error?.stack ?? fs.readFileSync(log, 'utf8').slice(-4000)}`);
    if (r?.error) Object.assign(e, { actual: r.error.actual, expected: r.error.expected, operator: r.error.operator });
    throw e;
  }))).finally(() => { if (!process.env.DEVTEAM_TEST_KEEP) fs.rmSync(dir, { recursive: true, force: true }); });
}

test('devteam kit', { concurrency: true }, async (t) => {
  useFixture(fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-kit-')));
  fs.writeFileSync(path.join(tmp, 'body.md'), '## One-way doors\n\nNone.\n');
  t.after(() => {
    spawnSync('tmux', ['kill-server']);
    if (!process.env.DEVTEAM_TEST_KEEP) fs.rmSync(tmp, { recursive: true, force: true }); else console.log(`fixture kept at ${tmp}`);
  });
  const forks = [];
  for (let i = 0; i < steps.length;) {
    if (!forked.has(i)) { await t.test(steps[i].name, steps[i].fn); i++; continue; }
    const g = forked.get(i);
    const group = [];
    for (; forked.get(i) === g; i++) group.push(i);
    forks.push(fork(t, group, forks.length + 1));
  }
  await Promise.all(forks);
});

