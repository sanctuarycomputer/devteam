// A worktree's kit that differs from the main checkout's hands the run to main's copy, and says so
// on stderr, naming both files and DEVTEAM_OWN_KIT=1; stdout and the exit status stay main's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bareProject } from './lib/kit.mjs';

test("a worktree's differing kit says it runs the main checkout's, unless DEVTEAM_OWN_KIT=1", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-reexec-'));
  try {
    const home = path.join(base, 'home');
    const main = bareProject(base, 'reexec');
    const g = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) g(['config', k, v], main);
    g(['add', '-A'], main);
    g(['commit', '-qm', 'init'], main);
    const wt = path.join(main, '.worktrees', 'old-branch');
    g(['worktree', 'add', '-q', '-b', 'ticket/old', wt], main);
    // the worktree's copy differs, and prints a mark of its own when it runs
    const mainScript = fs.realpathSync(path.join(main, 'docs/devteam/scripts/devteam.mjs'));
    const wtScript = fs.realpathSync(path.join(wt, 'docs/devteam/scripts/devteam.mjs'));
    const text = fs.readFileSync(wtScript, 'utf8');
    const mark = '// Object.groupBy is Node 21+.';
    assert.ok(text.includes(mark), 'the hook line is in the kit');
    fs.writeFileSync(wtScript, text.replace(mark, `process.stderr.write('THE WORKTREE COPY RAN\\n');\n${mark}`));
    const env = { ...process.env, HOME: home, DEVTEAM_HUB_PORT: '1' };
    delete env.DEVTEAM_OWN_KIT;
    const run = (script, args, extra = {}) => { const r = spawnSync(process.execPath, [script, ...args], { cwd: wt, env: { ...env, ...extra }, encoding: 'utf8' }); return { status: r.status, out: r.stdout, err: r.stderr }; };
    const notice = (err) => err.split('\n').filter((l) => /DEVTEAM_OWN_KIT=1/.test(l));

    for (const args of [['help'], ['no-such-command']]) {
      const direct = run(mainScript, args);
      const viaWt = run(wtScript, args);
      assert.equal(viaWt.out, direct.out, `${args}: stdout is the main copy's`);
      assert.equal(viaWt.status, direct.status, `${args}: the exit status is the main copy's`);
      assert.doesNotMatch(viaWt.err, /THE WORKTREE COPY RAN/, `${args}: the worktree's copy did not run on`);
      const lines = notice(viaWt.err);
      assert.equal(lines.length, 1, `${args}: one notice line on stderr: ${viaWt.err}`);
      assert.ok(lines[0].includes(mainScript) && lines[0].includes(wtScript), `${args}: the notice names both files: ${lines[0]}`);
      assert.equal(viaWt.err.indexOf(lines[0]), 0, `${args}: the notice comes first, before the main copy writes`);
      assert.equal(viaWt.err.slice(lines[0].length + 1), direct.err, `${args}: the rest of stderr is the main copy's`);
    }
    assert.equal(run(wtScript, ['no-such-command']).status, 1, 'an unknown command still fails');

    const own = run(wtScript, ['help'], { DEVTEAM_OWN_KIT: '1' });
    assert.match(own.err, /THE WORKTREE COPY RAN/, "DEVTEAM_OWN_KIT=1 runs the worktree's copy");
    assert.deepEqual(notice(own.err), [], 'and says nothing about handing over');

    // a copy the same as main's runs itself, silently
    fs.writeFileSync(wtScript, text);
    assert.deepEqual(notice(run(wtScript, ['help']).err), [], 'a copy equal to main\'s says nothing');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
