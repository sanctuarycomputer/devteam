// Restarting: the record and the files any agent could write are untrusted and can stop nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, MENU } from './lib/accounts-fixture.mjs';
import { hasTmux, json, until, write } from './lib/kit.mjs';

test("the restart record is untrusted, and a crash's lock can't wedge it", { skip: !hasTmux }, async () => {
  const F = fixture('record');
  const lock = `${F.restartsFile}.lock`;
  const again = async (n) => { await until(() => F.relaunched().length === n, `relaunch ${n}`); await until(() => spawnSync('tmux', ['capture-pane', '-p', '-t', `=${F.session}:plan-r`], { encoding: 'utf8' }).stdout.includes('Esc to cancel'), 'the menu again'); };
  try {
    F.stopsAgain();
    const a = F.planner('r', MENU);
    await until(() => a.shows().includes('Esc to cancel'), 'the menu');
    F.tick();
    // the old form: a lone number
    write(F.restartsFile, JSON.stringify({ 'plan-r': Date.now() - 1000 }));
    assert.doesNotMatch(F.tick(), /restarted/, 'the old number form still throttles');
    write(F.restartsFile, JSON.stringify({ 'plan-r': Date.now() + 3600000 }));
    assert.match(F.tick(), /restarted plan-r/, 'a time in the future is ignored');
    await again(1);
    for (const junk of ['{"plan-r":[null,"x",{},-1]}', '[1,2]', 'not json', '"str"']) {
      write(F.restartsFile, junk);
      assert.match(F.tick(), /restarted plan-r/, junk);
      await again(F.relaunched().length);
    }
    assert.ok(Array.isArray(json(fs.readFileSync(F.restartsFile, 'utf8'))['plan-r']));
    // a lock left by a crash, old or dated ahead, doesn't hold the tick
    for (const when of [Date.now() - 60000, Date.now() + 3600000]) {
      write(F.restartsFile, '{}');
      fs.mkdirSync(lock, { recursive: true });
      fs.utimesSync(lock, new Date(when), new Date(when));
      const n = F.relaunched().length;
      assert.match(F.tick(), /restarted plan-r/);
      await until(() => F.relaunched().length === n + 1, 'relaunched despite the lock');
      await until(() => !fs.existsSync(lock), 'the lock cleared');
    }
  } finally { F.done(); }
});

test('files any agent could write can stop nothing', { skip: !hasTmux }, async () => {
  const F = fixture('files');
  try {
    const a = F.planner('a', [MENU[0], '> ']);
    await until(() => a.shows().includes('limit'), 'the pane');
    const resumed = path.join(F.root, 'docs/devteam/run/accounts-resumed.json');
    F.tick();
    fs.mkdirSync(resumed);
    assert.doesNotMatch(F.tick(), /restarted/, "if the attempt can't be recorded nothing is done");
    assert.deepEqual(F.relaunched(), []);
    fs.rmSync(resumed, { recursive: true });
    write(resumed, 'null');
    assert.match(F.tick(), /restarted plan-a/, 'a null throttle file');
    await until(() => F.relaunched().length === 1, 'relaunched');
    write(path.join(F.root, 'docs/devteam/run/accounts.json'), JSON.stringify({ at: new Date().toISOString(), needs_login: 5 }));
    assert.equal(F.run(['metrics', '--json']).status, 0, 'a mangled state file does not break metrics');
  } finally { F.done(); }
});
