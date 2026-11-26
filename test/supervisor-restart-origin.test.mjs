// accounts-tick's restart of a supervisor stopped at a usage limit types origin's resume_command (kit-764),
// and its origin read ends within 15 s and 5 s inside the restart's budget, a budget of 0 asking origin
// nothing (kit-780). Moved here from load-settings-moved-ref.test.mjs, which had grown past CI's 300 s.
// Run: node --test test/supervisor-restart-origin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hasTmux, until } from './lib/kit.mjs';
import { CLAUDE_RESUME, fixture as recoveryFixture, MENU, rateLimit, SID, SKIP, SUP as SUP_PROMPT, supervisorPane } from './lib/recovery-fixture.mjs';

// the restart carries the supervisor's Stop hook (supervisor.md §6, Every ask is an Inbox question): --settings does not outlive its process
const hooked = (call) => { assert.match(call ?? '', /^supervisor\|--settings \S+\/run\/agent\/supervisor-claude\.json /, call); return call.replace(/--settings \S+ /, ''); };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// accounts-tick isn't a launch, but it types the supervisor's resume_command into its pane after a
// usage limit (restartSupervisor): that command too is origin's, and a refused read restarts nothing.
test('accounts-tick restarts a supervisor stopped at a limit with origin\'s resume_command, and not at all while origin is unreadable', { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const cswap = (F) => ({ DEVTEAM_CSWAP: F.cswap });
  const stopped = async (F) => {
    F.writeTranscript(SID, [{ type: 'user', message: { content: SUP_PROMPT } }, rateLimit()]);
    const pane = supervisorPane(F, MENU, { args: SKIP });
    await until(() => pane.shows().includes('Esc to cancel'), 'the menu');
    // the first tick: this project has not seen the account settle
    assert.equal(F.tick(cswap(F)), '');
    return pane;
  };
  await t.test('origin/HEAD repointed at an unpushed commit with another resume_command: the owner\'s is typed', async () => {
    const F = recoveryFixture('origin-suprestart', { resume: CLAUDE_RESUME });
    const g = (args) => spawnSync('git', args, { cwd: F.root, encoding: 'utf8' }).stdout.trim();
    try {
      const pane = await stopped(F);
      const sf = path.join(F.root, 'docs/devteam/project/settings.md');
      const text = fs.readFileSync(sf, 'utf8');
      fs.writeFileSync(sf, text.replace(JSON.stringify(CLAUDE_RESUME), JSON.stringify('claude --continue --planted')));
      g(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'planted']);
      const planted = g(['rev-parse', 'HEAD']);
      g(['reset', '-q', '--hard', 'HEAD~1']);
      g(['update-ref', 'refs/remotes/origin/planted', planted]);
      g(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/planted']);
      assert.match(F.tick(cswap(F)), /restarted the supervisor/);
      await until(() => F.claudeCalls().length === 1, 'the stand-in claude ran');
      assert.equal(hooked(F.claudeCalls()[0]), `supervisor|--resume ${SID} --dangerously-skip-permissions You were restarted after a usage limit, on this same conversation. Carry on from where you were.`);
      assert.equal(pane.keys(), '', 'no key reaches the old process');
    } finally { F.done(); }
  });
  await t.test('origin unreadable: not restarted, the tick says why, nothing typed and no attempt spent', async () => {
    const F = recoveryFixture('origin-supdown', { resume: CLAUDE_RESUME });
    const g = (args) => spawnSync('git', args, { cwd: F.root, encoding: 'utf8' }).stdout.trim();
    try {
      const pane = await stopped(F);
      g(['remote', 'set-url', 'origin', path.join(F.base, 'no-such-remote.git')]);
      const said = F.tick(cswap(F));
      assert.match(said, /the supervisor is stopped at a usage limit and was not restarted: could not read main from origin \('[^']*no-such-remote\.git' does not appear to be a git repository\)/);
      sleep(1000);
      assert.deepEqual(F.claudeCalls(), [], 'nothing started');
      assert.equal(pane.keys(), '', 'nothing typed');
      assert.ok(!fs.existsSync(F.restartsFile) || !/"supervisor"/.test(fs.readFileSync(F.restartsFile, 'utf8')), 'no attempt spent');
    } finally { F.done(); }
  });
  // kit-780: the restart's origin read ends inside the restart's budget (5 s before it, as a
  // relaunch's child is given), so a hung origin can't hold the tick for the launch's own 30 s.
  // DEVTEAM_RESTART_BUDGET_MS (tests only, under DEVTEAM_TEST) makes the budget small enough to see.
  const hung = (F, g) => {
    const hang = path.join(F.base, 'hang-ssh.sh');
    fs.writeFileSync(hang, '#!/bin/sh\nexec sleep 300\n', { mode: 0o755 });
    g(['remote', 'set-url', 'origin', 'ssh://probe.invalid/x.git']);
    g(['config', 'core.sshCommand', hang]);
  };
  const timed = (F, env) => { const t0 = Date.now(); const said = F.tick({ ...cswap(F), ...env }); return { said, took: Date.now() - t0 }; };
  await t.test('origin hung, a tick\'s own budget: the restart\'s read ends within 15 s, not after 30 s; nothing typed', async () => {
    const F = recoveryFixture('origin-supcap', { resume: CLAUDE_RESUME });
    const g = (args) => spawnSync('git', args, { cwd: F.root, encoding: 'utf8' }).stdout.trim();
    try {
      const pane = await stopped(F);
      hung(F, g);
      const { said, took } = timed(F, {});
      assert.match(said, /the supervisor is stopped at a usage limit and was not restarted: could not read main from origin \(it did not answer in time\)/);
      assert.ok(took < 20000, `the read ended within its 15 s (the tick took ${took} ms), not after the launch's own 30 s`);
      assert.deepEqual(F.claudeCalls(), [], 'nothing started');
      assert.equal(pane.keys(), '', 'nothing typed');
    } finally { F.done(); }
  });
  await t.test('origin hung: the restart\'s read ends 5 s inside its budget, not after 30 s; nothing typed', async () => {
    const F = recoveryFixture('origin-suphung', { resume: CLAUDE_RESUME });
    const g = (args) => spawnSync('git', args, { cwd: F.root, encoding: 'utf8' }).stdout.trim();
    try {
      const pane = await stopped(F);
      hung(F, g);
      const { said, took } = timed(F, { DEVTEAM_TEST: '1', DEVTEAM_RESTART_BUDGET_MS: '8000' });
      assert.match(said, /the supervisor is stopped at a usage limit and was not restarted: could not read main from origin \(it did not answer in time\)/);
      assert.ok(took < 7000, `the read ended 5 s inside the restart's 8 s budget (the tick took ${took} ms), not after the launch's own 30 s`);
      assert.deepEqual(F.claudeCalls(), [], 'nothing started');
      assert.equal(pane.keys(), '', 'nothing typed');
    } finally { F.done(); }
  });
  await t.test('DEVTEAM_RESTART_BUDGET_MS without DEVTEAM_TEST: ignored, the read keeps its own bound', async () => {
    const F = recoveryFixture('origin-supknob', { resume: CLAUDE_RESUME });
    const g = (args) => spawnSync('git', args, { cwd: F.root, encoding: 'utf8' }).stdout.trim();
    try {
      await stopped(F);
      hung(F, g);
      const { said, took } = timed(F, { DEVTEAM_TEST: '', DEVTEAM_RESTART_BUDGET_MS: '8000', DEVTEAM_LAUNCH_ORIGIN_MS: '9000' });
      assert.match(said, /was not restarted: could not read main from origin \(it did not answer in time\)/);
      assert.ok(took >= 8500, `the knob is a test's only: the read ran to its own 9 s (the tick took ${took} ms)`);
    } finally { F.done(); }
  });
  await t.test('a budget of 0 only looks: origin isn\'t asked, so a hung origin costs the tick nothing and nothing is said', async () => {
    const F = recoveryFixture('origin-suplook', { resume: CLAUDE_RESUME });
    const g = (args) => spawnSync('git', args, { cwd: F.root, encoding: 'utf8' }).stdout.trim();
    try {
      const pane = await stopped(F);
      hung(F, g);
      const { said, took } = timed(F, { DEVTEAM_TEST: '1', DEVTEAM_RESTART_BUDGET_MS: '0', DEVTEAM_LAUNCH_ORIGIN_MS: '9000' });
      assert.doesNotMatch(said, /could not read main from origin/);
      assert.ok(took < 8000, `origin wasn't asked (the tick took ${took} ms)`);
      assert.equal(pane.keys(), '', 'nothing typed');
    } finally { F.done(); }
  });
});
