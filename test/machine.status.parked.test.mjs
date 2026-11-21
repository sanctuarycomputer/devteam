// machine status's check-in, in parts (kit-221): a parked fleet's supervisor is not flagged, and an
// unparked one is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hasTmux } from './lib/kit.mjs';
import { dtIn, statusFixture } from './lib/machine-fixture.mjs';

test('status says at a glance what a check-in needs, and reads no pane it needn\'t: a parked fleet\'s supervisor is not flagged, and an unparked one is', { skip: !hasTmux }, async () => {
  const S = await statusFixture();
  const { r, status, sup } = S;
  try {
    const claim = path.join(r, 'docs/devteam/run/host-claim.json');
    const beat = (checked, at = checked) => fs.writeFileSync(claim, JSON.stringify({ sha: 'x', at: new Date(Date.now() - at * 60000).toISOString(), machine: 'm', checked: Date.now() - checked * 60000 }));
    beat(138);
    // a parked fleet's supervisor has nothing to start, and isn't flagged
    const sup2 = { ...sup, DEVTEAM_SUPERVISOR_UP: 'off' };
    const parked = dtIn(r, ['fleet', 'park', '--reason', 'a quiet week'], sup2);
    assert.equal(parked.status, 0, parked.stderr + parked.stdout);
    beat(138);
    const pk = status();
    assert.match(pk.stdout, /^statused sup=up fleet=park /m);
    assert.doesNotMatch(pk.stdout, /supervisor idle/, 'parked: not flagged');
    beat(138);
    const unparked = dtIn(r, ['fleet', 'unpark'], sup2);
    assert.equal(unparked.status, 0, unparked.stderr + unparked.stdout);
    assert.doesNotMatch(status().stdout, /supervisor idle/, 'an unpark is a start: it checks the claim, a sign of its loop');
    beat(138);
    assert.match(status().stdout, /^attention: statused supervisor idle, not ticking for 138m$/m, 'running again, and still idle');
    S.readNothing();
  } finally {
    S.done();
  }
});
