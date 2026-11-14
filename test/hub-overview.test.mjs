// The hub's Overview reads each project's hello: its pulse says whether the project is moving, how
// far along it is, what needs the owner, and what the fleet did each day for twelve weeks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, json, line } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };

test('hello carries a pulse: idle, moving, waiting on the owner, building', () => {
  const F = fleetFixture('hub-pulse');
  const { old, ok } = F;
  const pulse = () => json(ok(old, ['hello', '--json', '--no-kit'])).pulse;
  try {
    let p = pulse();
    assert.equal(p.state, 'idle', 'nothing open');
    assert.equal(p.activity.length, 84, 'twelve weeks, a day each');
    assert.ok(p.activity.every((n) => Number.isInteger(n) && n >= 0));
    assert.deepEqual(p.attention, []);

    // a goal, a feature and a ticket: open work
    const G = ok(old, ['goal', 'add', '--title', 'Billing', '--outcome', 'it works', '--priority', '1'], SUP);
    ok(old, ['feature', 'add', 'bill', '--json', JSON.stringify({ title: 'bill', goals: [G], stories: [{ id: 'BILL-S1', text: 'it works', release: 'v1.0.0' }] })], SUP);
    ok(old, ['ticket', 'add', 'app-01-bill', '--json', JSON.stringify({ title: 'Billing page', feature: 'bill', component: 'app', kind: 'build', size: 'S', risk: 'normal', serves: ['BILL-S1'], depends_on: [], touches: ['src/bill/**'], done_when: ['its test passes in CI'] })], SUP);
    p = pulse();
    assert.equal(p.open_tickets, 1);
    assert.equal(p.done_tickets, 0);
    assert.equal(p.state, 'moving', 'open work, and the fleet wrote just now');
    assert.ok(p.activity.at(-1) >= 3, 'what the supervisor just wrote counts as today\'s activity');
    assert.ok(p.last_activity && Date.now() - Date.parse(p.last_activity) < 60000);

    // a question with no default holding the ticket up: waiting on the owner
    ok(old, ['ask', '--question', 'Charge per seat or per team?', '--blocks', 'app-01-bill', '--recommendation', 'Per team'], SUP);
    p = pulse();
    assert.equal(p.state, 'waiting');
    assert.equal(p.holding, 1);
    assert.match(p.attention[0], /1 question with no default is holding up work/);

    // a worker mid-ticket, writing now: building, even with the question open
    const ym = new Date().toISOString().slice(0, 7);
    fs.appendFileSync(path.join(old, 'docs/devteam/run/log', 'app-01-bill.jsonl'), line({ v: 1, id: `h-${ym.replace('-', '')}01-000000000-app-01-bill`, type: 'phase', op: 'new', at: new Date().toISOString(), by: 'app-01-bill', from: null, to: 'build' }));
    p = pulse();
    assert.equal(p.working, 1);
    assert.equal(p.state, 'building');
  } finally { F.done(); }
});
