// The box's operator reads the recurring registry (kit-331): `recurring list` and `recurring show`
// are in OPERATOR_READS, and every other recurring verb (`apply`, the one write) stays refused.
// Run with TMUX unset: nothing here starts tmux.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { kit } from './lib/kit.mjs';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-op-recurring-')));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
// its own HOME, and no DEVTEAM_* or tmux from the shell that runs the test
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(DEVTEAM_|TMUX)/.test(k)));
Object.assign(env, { HOME: path.join(tmp, 'home'), DEVTEAM_HUB_PORT: '1' });
fs.mkdirSync(env.HOME);

const JOB = { kind: 'check', title: 'CI on main', what: 'the kit CI on main is green', every: '6h', run: 'gh run list --limit 1' };
const r = path.join(tmp, 'proj');
const git = (args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: r, encoding: 'utf8', env });
const dt = (args, role) => spawnSync(process.execPath, [path.join(r, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: r, encoding: 'utf8', env: { ...env, DEVTEAM_ROLE: role }, timeout: 60000 });

fs.mkdirSync(r);
git(['init', '-q', '-b', 'main']);
fs.cpSync(kit, path.join(r, 'docs', 'devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
const init = dt(['init', '--name', 'proj'], 'supervisor');
assert.equal(init.status, 0, init.stderr);
fs.writeFileSync(path.join(r, 'docs/devteam/project/recurring.json'), `${JSON.stringify({ 'ci-main': JOB }, null, 2)}\n`);
git(['add', '-A']);
git(['commit', '-qm', 'init, with one job']);

test('the operator reads recurring list and recurring show', () => {
  const head = git(['rev-parse', 'HEAD']);
  for (const args of [['recurring', 'list'], ['recurring', 'list', '--json'], ['recurring', 'show', 'ci-main'], ['recurring', 'show', 'ci-main', '--json']]) {
    const x = dt(args, 'operator');
    assert.equal(x.status, 0, `${args.join(' ')}: ${x.stderr}`);
    assert.doesNotMatch(x.stderr, /only reads/, args.join(' '));
    assert.match(x.stdout, /ci-main/, args.join(' '));
  }
  assert.equal(JSON.parse(dt(['recurring', 'show', 'ci-main', '--json'], 'operator').stdout).entry.title, 'CI on main');
  // reads write nothing: the worktree is clean and main hasn't moved
  assert.equal(git(['status', '--porcelain']), '');
  assert.equal(git(['rev-parse', 'HEAD']), head);
});

// operator.md's list of the kit reads the operator may run names both, flags after the verb, and each
// form it names runs for the operator (a doc that names a read the gate refuses would mislead the box)
test('operator.md tells the operator it may read the recurring jobs, in forms the gate lets through', () => {
  const doc = fs.readFileSync(path.join(kit, 'process', 'operator.md'), 'utf8');
  const reads = doc.split('\n').find((l) => l.startsWith('Kit reads you can run in a repo'));
  assert.ok(reads, 'operator.md has its "Kit reads you can run" paragraph');
  const named = [...reads.matchAll(/`(recurring [^`]*)`/g)].map((m) => m[1]);
  assert.deepEqual(named, ['recurring list [--json]', 'recurring show <name> [--json]']);
  for (const form of named) {
    for (const args of [form.replace(' [--json]', ''), form.replace('[--json]', '--json')].map((s) => s.replace('<name>', 'ci-main').split(' '))) {
      const x = dt(args, 'operator');
      assert.equal(x.status, 0, `${args.join(' ')}: ${x.stderr}`);
    }
  }
});

test('the operator is refused every other recurring verb, apply (the write) included', () => {
  for (const args of [['recurring', 'apply', 'q-1'], ['recurring'], ['recurring', 'stop', 'ci-main']]) {
    const x = dt(args, 'operator');
    assert.notEqual(x.status, 0, args.join(' '));
    assert.match(x.stderr, /recurring: the operator only reads/, args.join(' '));
  }
  // the refusal is the operator's: the supervisor's apply gets past the gate to apply's own checks
  assert.doesNotMatch(dt(['recurring', 'apply', 'q-1'], 'supervisor').stderr, /only reads/);
});
