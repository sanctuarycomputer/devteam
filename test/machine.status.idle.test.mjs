// machine status's check-in, in parts (kit-221): a supervisor idle at its prompt is flagged; a refused
// claim, an unreadable one and a busy pane are not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hasTmux } from './lib/kit.mjs';
import { shown, statusFixture, tmuxSh } from './lib/machine-fixture.mjs';

test('status says at a glance what a check-in needs, and reads no pane it needn\'t: a supervisor idle at its prompt for 45 minutes is flagged', { skip: !hasTmux }, async () => {
  const S = await statusFixture();
  const { r, status } = S;
  try {
    // a supervisor up, idle at its prompt, its fleet running, and no tick or wait for 45 minutes: it
    // stopped its loop, and the check-in says so; its host check is the sign, as each tick and wait make one
    const claim = path.join(r, 'docs/devteam/run/host-claim.json');
    const beat = (checked, at = checked) => fs.writeFileSync(claim, JSON.stringify({ sha: 'x', at: new Date(Date.now() - at * 60000).toISOString(), machine: 'm', checked: Date.now() - checked * 60000 }));
    beat(138, 140);
    assert.match(status().stdout, /^attention: statused supervisor idle, not ticking for 138m$/m);
    beat(5, 140);
    assert.doesNotMatch(status().stdout, /supervisor idle/, 'a wait checks every 10 minutes however long it runs: waiting is not idle');
    beat(30);
    assert.doesNotMatch(status().stdout, /supervisor idle/, 'under 45 minutes: a tick can be that far apart');
    S.readNothing();
  } finally {
    S.done();
  }
});

test('status says at a glance what a check-in needs, and reads no pane it needn\'t: a refused claim, an unreadable one, and a busy pane are not flagged', { skip: !hasTmux }, async () => {
  const S = await statusFixture();
  const { a, r, status } = S;
  try {
    const claim = path.join(r, 'docs/devteam/run/host-claim.json');
    const beat = (checked, at = checked) => fs.writeFileSync(claim, JSON.stringify({ sha: 'x', at: new Date(Date.now() - at * 60000).toISOString(), machine: 'm', checked: Date.now() - checked * 60000 }));
    fs.writeFileSync(claim, JSON.stringify({ checked: Date.now() - 138 * 60000, refused: true }));
    assert.doesNotMatch(status().stdout, /supervisor idle/, 'another machine holds the repo: the kit told it to stop, so never told to tick');
    fs.writeFileSync(claim, '{ not json');
    assert.doesNotMatch(status().stdout, /supervisor idle/, 'a record it can\'t read says nothing');
    beat(138);
    // busy in a turn (a long step of a tick): not idle, however old the sign
    tmuxSh(['send-keys', '-t', a.pane, 'Enter']);
    await shown(a.pane, 'Ticking');
    const busy = status();
    assert.match(busy.stdout, new RegExp(`^statused .* pane=${a.pane} state=busy `, 'm'));
    assert.doesNotMatch(busy.stdout, /supervisor idle/, 'busy: not flagged');
    assert.ok(!fs.existsSync(path.join(r, 'docs/devteam/run/supervisor-pane')), 'reading a project writes nothing of its');
    S.readNothing();
  } finally {
    S.done();
  }
});
