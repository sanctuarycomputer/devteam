// machine status's check-in, in parts (kit-221): the capacity line as accounts-tick last wrote it,
// none without one, and the reading it holds 20 minutes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hasTmux } from './lib/kit.mjs';
import { statusFixture } from './lib/machine-fixture.mjs';

test('status says at a glance what a check-in needs, and reads no pane it needn\'t: the capacity line, as accounts-tick last wrote it', { skip: !hasTmux }, async () => {
  const S = await statusFixture();
  const { r, status } = S;
  try {
    const accFile = path.join(r, 'docs/devteam/run/accounts.json');
    const accounts = JSON.parse(fs.readFileSync(accFile, 'utf8'));
    const withCap = (capacity) => { fs.writeFileSync(accFile, JSON.stringify({ ...accounts, capacity })); return status().stdout; };
    const blank = { active_week_pct: null, active_5h_pct: null, runs_out_at: null, next_reset_at: null, gap: false };
    const unread = withCap({ accounts: 3, room: 0, unknown: 3, ...blank });
    assert.match(unread, /^machine: capacity 0 of 3 accounts with room, 3 unknown \(usage unreadable\); active \?% week, \?% 5h; room runs out unknown; next reset -$/m);
    assert.doesNotMatch(unread, /NONE|THIN/, 'not knowing is no alarm');
    assert.match(withCap({ accounts: 3, room: 0, unknown: 0, ...blank }), /^machine: capacity 0 of 3 accounts with room NONE; .*room runs out now; /m, 'every account known full');
    assert.match(withCap({ accounts: 3, room: 1, unknown: 1, ...blank }), /^machine: capacity 1 of 3 accounts with room, 1 unknown \(usage unreadable\); /m, 'one with room and one unread is not thin');
    S.readNothing();
  } finally {
    S.done();
  }
});

test('status says at a glance what a check-in needs, and reads no pane it needn\'t: no capacity line without one, and the reading is held 20 minutes', { skip: !hasTmux }, async () => {
  const S = await statusFixture();
  const { last, r, status } = S;
  try {
    const accFile = path.join(r, 'docs/devteam/run/accounts.json');
    const accounts = JSON.parse(fs.readFileSync(accFile, 'utf8'));
    // no cswap, or an accounts-tick from before capacity: no capacity line at all
    const { capacity: _, ...none } = accounts;
    fs.writeFileSync(accFile, JSON.stringify(none));
    assert.doesNotMatch(status().stdout, /^machine: capacity/m);
    fs.writeFileSync(accFile, JSON.stringify(accounts));
    // the reading is held 20 minutes, so a manual re-run doesn't erase the change the next check-in should see
    const held = fs.readFileSync(last, 'utf8');
    status();
    assert.equal(fs.readFileSync(last, 'utf8'), held);
    S.readNothing();
  } finally {
    S.done();
  }
});
