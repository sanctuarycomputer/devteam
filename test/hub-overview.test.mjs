// The hub's Overview reads each project's hello: its pulse says whether the project is moving, how
// far along it is, what needs the owner, and what the fleet did each day for twelve weeks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, json, line } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };

test('hello carries a pulse: idle, moving, fully and partly blocked, building', () => {
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
    assert.equal(p.goal, null, 'a draft goal is not what it is working on');
    assert.equal(p.goals_open, 0);
    assert.equal(p.open_tickets, 1);
    assert.equal(p.done_tickets, 0);
    assert.equal(p.state, 'moving', 'open work, and the fleet wrote just now');
    assert.ok(p.activity.at(-1) >= 3, 'what the supervisor just wrote counts as today\'s activity');
    assert.ok(p.last_activity && Date.now() - Date.parse(p.last_activity) < 60000);

    // a question with no default holding up the only ticket: fully blocked
    ok(old, ['ask', '--question', 'Charge per seat or per team?', '--blocks', 'app-01-bill', '--recommendation', 'Per team'], SUP);
    p = pulse();
    assert.equal(p.state, 'blocked');
    assert.equal(p.blocking, 'full');
    assert.equal(p.blocked_tickets, 1);
    assert.match(p.attention[0], /^Fully blocked: all 1 open ticket wait on your answer to 1 question/);

    // a ticket that depends on it waits too; one that doesn't can move: partly blocked
    const add = (id, deps) => ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'bill', component: 'app', kind: 'build', size: 'S', risk: 'normal', serves: ['BILL-S1'], depends_on: deps, touches: [`src/${id}/**`], done_when: ['its test passes in CI'] })], SUP);
    add('app-02-invoices', ['app-01-bill']);
    p = pulse();
    assert.equal(p.blocking, 'full', 'what depends on a held ticket is held too');
    assert.equal(p.blocked_tickets, 2);
    add('app-03-receipts', []);
    p = pulse();
    assert.equal(p.blocking, 'partial');
    assert.equal(p.blocked_tickets, 2);
    assert.equal(p.open_tickets, 3);
    assert.notEqual(p.state, 'blocked');
    assert.match(p.attention[0], /^Partly blocked: 2 of 3 open tickets wait on your answer to 1 question; the rest can move/);

    // a worker mid-ticket, writing now: building, and still partly blocked
    const ym = new Date().toISOString().slice(0, 7);
    fs.appendFileSync(path.join(old, 'docs/devteam/run/log', 'app-03-receipts.jsonl'), line({ v: 1, id: `h-${ym.replace('-', '')}01-000000000-app-03-receipts`, type: 'phase', op: 'new', at: new Date().toISOString(), by: 'app-03-receipts', from: null, to: 'build' }));
    p = pulse();
    assert.equal(p.working, 1);
    assert.equal(p.state, 'building');
    assert.equal(p.blocking, 'partial');


    // the owner approves the goal: the card names it, with its own tickets merged of planned
    fs.appendFileSync(path.join(old, 'docs/devteam/run/log', `owner-${ym}.jsonl`), line({ id: G, type: 'goal', op: 'set', status: 'ready', at: new Date().toISOString(), by: 'owner', channel: 'cli' }));
    p = pulse();
    assert.deepEqual([p.goal?.title, p.goal?.done, p.goal?.total, p.goals_open], ['Billing', 0, 3, 1]);
  } finally { F.done(); }
});
