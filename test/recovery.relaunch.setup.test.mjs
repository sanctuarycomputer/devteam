// A relaunch with a worktree_setup: it starts only with the full 100 s left, and hands the setup its
// deadline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasTmux, json, until, write } from './lib/kit.mjs';
import { clearSlots, fixture, UNDER, withSetup } from './lib/recovery-fixture.mjs';

// Session id's worktree made a real checkout of its own (ticket/<id>), with a setup marker that
// matches setup and its lockfiles, as setupMarker.state writes it: { v: 1, setup, files }, sha256s
// of the lockfiles at the root and one folder down.
function matchingMarker(F, id, setup) {
  const wt = path.join(F.root, '.worktrees', id);
  execFileSync('git', ['worktree', 'add', '--quiet', '-b', `ticket/${id}`, wt], { cwd: F.root });
  const LOCKS = ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'Gemfile.lock', 'uv.lock', 'poetry.lock', 'Pipfile.lock', 'Cargo.lock', 'go.sum', 'composer.lock'];
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const files = {};
  const dirs = ['', ...fs.readdirSync(wt, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name)];
  for (const d of dirs) for (const l of LOCKS) { const f = path.join(wt, d, l); if (fs.existsSync(f) && fs.lstatSync(f).isFile()) files[d ? `${d}/${l}` : l] = sha(fs.readFileSync(f)); }
  const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: wt, encoding: 'utf8' }).trim();
  write(path.join(gitDir, 'devteam-setup'), `${JSON.stringify({ v: 1, setup: sha(setup), files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) })}\n`);
}
test('with a worktree_setup, a later relaunch in a tick starts only with the full 100 s left', { skip: !hasTmux }, async () => {
  const F = fixture('setup');
  try {
    const sf = path.join(F.root, 'docs/devteam/project/settings.md');
    fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"project":', '"worktree_setup": "sleep 12",\n  "project":'));
    execFileSync('sh', ['-c', 'git add -A && git -c user.email=t@t -c user.name=t commit -qm setup'], { cwd: F.root });
    // a planner's resume runs home's worktree_setup too
    F.worker('demo-90-a'); F.planner('p91'); F.worker('demo-92-c');
    // 5f: a real checkout of its own whose setup marker matches: its resume skips the setup, so it is not held back
    F.worker('demo-93-marked');
    matchingMarker(F, 'demo-93-marked', 'sleep 12');
    F.tick(UNDER(F));
    assert.deepEqual(F.state().relaunched, ['demo-90-a', 'demo-93-marked'], 'the first took 12 s of the 110: under 100 s left for another with a setup to run, but enough for one whose marker matches');
    const record = json(fs.readFileSync(F.restartsFile, 'utf8'));
    assert.ok(!record['plan-p91'] && !record['demo-92-c'], 'the others are not claimed');
    F.tick(UNDER(F));
    assert.deepEqual(F.state().relaunched, ['plan-p91']);
  } finally { F.done(); }
});

test('5a: a relaunch hands its setup a deadline 5 s inside its own 100 s', { skip: !hasTmux }, async () => {
  const F = fixture('deadline');
  clearSlots();
  try {
    const log = path.join(F.base, 'deadline.log');
    withSetup(F, `echo "$DEVTEAM_SETUP_DEADLINE $(${process.execPath} -e 'console.log(Date.now())')" >> ${log}`);
    F.worker('demo-101-dl');
    const start = Date.now();
    assert.match(F.tick(UNDER(F)), /relaunched demo-101-dl/);
    const [deadline, clock] = fs.readFileSync(log, 'utf8').trim().split(' ').map(Number);
    assert.ok(Number.isFinite(deadline) && Number.isFinite(clock), fs.readFileSync(log, 'utf8'));
    assert.ok(start + 95000 <= deadline, `the deadline ${deadline} is at least the tick's start ${start} + 95 s`);
    assert.ok(deadline <= clock + 95000, `the deadline ${deadline} is no later than the setup's clock ${clock} + 95 s`);
  } finally { clearSlots(); F.done(); }
});

test('5a\': a relaunch that starts the tmux server leaves no deadline in it; a deadline already past is not handed down', { skip: !hasTmux }, async () => {
  const F = fixture('deadline-reboot');
  clearSlots();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-tmux-recovery-'));
  const env = (extra = {}) => ({ ...UNDER(F), TMUX_TMPDIR: dir, ...extra });
  try {
    // the stand-in agent says what deadline its window's environment holds
    const envLog = path.join(F.base, 'agent-env.log');
    write(path.join(F.base, 'relaunch.cjs'), `const fs = require('fs'); fs.appendFileSync(${JSON.stringify(envLog)}, (process.env.DEVTEAM_SETUP_DEADLINE ?? 'none') + '\\n'); fs.appendFileSync(${JSON.stringify(path.join(F.base, 'launched.log'))}, require('path').basename(process.cwd()) + '\\n'); setInterval(() => {}, 1000);`);
    withSetup(F, 'true');
    F.worker('demo-102-boot');
    assert.match(F.tick(env()), /relaunched demo-102-boot/);
    await until(() => F.relaunched().length === 1, 'resumed');
    const own = { encoding: 'utf8', env: { ...process.env, TMUX_TMPDIR: dir } };
    assert.equal(spawnSync('tmux', ['has-session', '-t', `=${F.session}`], own).status, 0, 'the server the relaunch started is up');
    const shown = spawnSync('tmux', ['show-environment', '-g', 'DEVTEAM_SETUP_DEADLINE'], own);
    if (shown.status === 0) assert.doesNotMatch(shown.stdout, /^DEVTEAM_SETUP_DEADLINE=/m, 'the server\'s environment has no deadline');
    else assert.match(shown.stderr, /unknown variable/, `the server answered, without the variable: ${shown.stderr}`);
    assert.deepEqual(fs.readFileSync(envLog, 'utf8').trim().split('\n'), ['none'], 'the window has no deadline');
    // a tick whose own deadline is already past: ignored, so the setup runs and the session comes back
    F.worker('demo-103-past');
    const out = F.tick(env({ DEVTEAM_SETUP_DEADLINE: String(Date.now() - 60000) }));
    assert.match(out, /relaunched demo-103-past/);
    assert.doesNotMatch(out, /could not relaunch/);
  } finally {
    spawnSync('tmux', ['kill-server'], { env: { ...process.env, TMUX_TMPDIR: dir } });
    fs.rmSync(dir, { recursive: true, force: true });
    clearSlots();
    F.done();
  }
});
