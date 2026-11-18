// A hold on the owner holds only what the answer gates: a hold that waits on an owner question is
// refused until the ticket is split or the hold says --whole why no part can go ahead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleetFixture } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };

test('a hold on an owner question asks for a split or --whole; a hold on anything else is as it was', () => {
  const F = fleetFixture('hold-part');
  const { old, run, ok } = F;
  const t = { title: 'upgrade deps, restrict hosts', feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['deps/**', 'hosts/**'], done_when: ['the deps check passes'] };
  const hold = (id, held, ...extra) => run(old, ['ticket', 'set', id, '--json', JSON.stringify({ held }), ...extra], SUP);
  const heldOf = (id) => JSON.parse(ok(old, ['ticket', 'show', id], SUP)).held;
  try {
    for (const id of ['ch-01-both', 'ch-02-named', 'ch-03-plain']) ok(old, ['ticket', 'add', id, '--json', JSON.stringify(t)], SUP);
    // an open question about the ticket: holding it whole is refused, and the refusal says how to split
    const q = ok(old, ['ask', '--ticket', 'ch-01-both', '--question', 'Which hosts may it allow?', '--recommendation', 'only ours'], SUP);
    let r = hold('ch-01-both', 'waits on the hosts question');
    assert.notEqual(r.status, 0);
    assert.match(r.err, new RegExp(`ch-01-both waits on ${q}: hold only the part the answer gates`));
    assert.match(r.err, /Split the rest into its own ticket and let it run \(ticket add <new-id>/);
    assert.match(r.err, /--whole "<why>"/);
    assert.equal(heldOf('ch-01-both'), undefined, 'nothing held');
    // --whole with no reason is no reason
    assert.notEqual(hold('ch-01-both', 'waits on the hosts question', '--whole').status, 0);
    // split first: the part the answer gates is held with --whole, the rest is a ticket of its own, unheld
    ok(old, ['ticket', 'add', 'ch-04-deps', '--json', JSON.stringify({ ...t, title: 'upgrade deps', touches: ['deps/**'] })], SUP);
    ok(old, ['ticket', 'set', 'ch-01-both', '--json', JSON.stringify({ title: 'restrict hosts', touches: ['hosts/**'], done_when: ['the hosts check passes'] })], SUP);
    r = hold('ch-01-both', 'waits on the hosts question', '--whole', 'all that is left is the hosts list');
    assert.equal(r.status, 0, r.err);
    assert.equal(heldOf('ch-01-both'), 'waits on the hosts question (whole: all that is left is the hosts list)');
    assert.equal(heldOf('ch-04-deps'), undefined);
    // a reason that names a question id is the same, whatever ticket the question is about
    r = hold('ch-02-named', `waits on ${q}`);
    assert.notEqual(r.status, 0);
    assert.match(r.err, new RegExp(`ch-02-named waits on ${q}:`));
    // a hold that waits on no owner question needs neither; nor does a release
    assert.equal(hold('ch-03-plain', 'may duplicate ch-04-deps').status, 0);
    assert.equal(heldOf('ch-03-plain'), 'may duplicate ch-04-deps');
    assert.equal(hold('ch-01-both', null).status, 0, 'a release is never refused');
    // once the question is answered, the ticket no longer waits on it
    ok(old, ['answer', q, 'only ours']);
    assert.equal(hold('ch-01-both', 'waits for the cap').status, 0);
  } finally { F.done(); }
});
