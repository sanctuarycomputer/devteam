// machine status's check-in, in parts (kit-221): the daily review, a dashboard down, a kit at the
// latest, and the box's alert on the hub's line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hasTmux } from './lib/kit.mjs';
import { latestRelease, machine, statusFixture } from './lib/machine-fixture.mjs';

test('status says at a glance what a check-in needs, and reads no pane it needn\'t: the daily review, a dashboard down, a kit at the latest, and the box\'s alert', { skip: !hasTmux }, async () => {
  const S = await statusFixture();
  const { notes, r, rule, status } = S;
  try {
    // the review is done for the day once the notes have today's heading; an older one leaves it due
    fs.appendFileSync(notes, '\n## Review 2026-01-02\n');
    assert.match(status().stdout, /^machine: daily review due \(last 2026-01-02\)$/m);
    const today = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(notes, `\n## Review ${today} (UTC)\n1. **${rule}**: the owner's ruling, stays\n`);
    // one reading for both: nothing changes between them
    const done = status();
    assert.match(done.stdout, new RegExp(`^machine: daily review done ${today}$`, 'm'));
    assert.match(done.stdout, /^statused .* new-knowledge=1$/m);
    // a dashboard's port nothing answers is down; a repo whose kit is at the latest isn't behind
    fs.writeFileSync(path.join(r, 'docs/devteam/run/dashboard-port'), '9\n');
    fs.writeFileSync(latestRelease, 'v0.1.0\n');
    // and an alert raised: one reading says all three (the alert is on the hub's line, not the repo's)
    machine(['machine', 'alert', '--', 'look at the disk']);
    const st3 = status();
    assert.match(st3.stdout, /^statused .*dash=9\/DOWN/m);
    assert.doesNotMatch(st3.stdout, /behind=/);
    assert.match(st3.stdout, /^machine: hub \d+ DOWN; alert: look at the disk$/m);
    assert.doesNotMatch(st3.stdout, /^attention: statused: /m, "the box's alert, folded into hello's alert, is not repeated as the repo's");
    machine(['machine', 'alert', '--', '--clear']);
    S.readNothing();
  } finally {
    S.done();
  }
});
