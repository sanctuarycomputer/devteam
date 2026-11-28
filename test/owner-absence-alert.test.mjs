// A question only the owner can answer (no default) that holds up work, left past
// owner_absence_days: hello's alert names it, so the hub shows it and pushes it to the owner's
// devices. It clears when the question is answered or withdrawn; a question with a default, or one
// that holds nothing up, never shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, json } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const DAY = 86400000;

test('a blocking question with no default, past owner_absence_days, is on the alert until answered', () => {
  const F = fleetFixture('owner-absence');
  const { old, ok } = F;
  const alert = () => json(ok(old, ['hello', '--json', '--no-kit'])).alert ?? null;
  const dir = path.join(old, 'docs/devteam/run/log');
  // every line written so far, as if written that long ago
  const age = (ms) => { for (const f of fs.readdirSync(dir)) fs.writeFileSync(path.join(dir, f), fs.readFileSync(path.join(dir, f), 'utf8').replace(/"(at|asked_at|created_at)":"([^"]+)"/g, (all, k, t) => `"${k}":"${new Date(Date.parse(t) - ms).toISOString()}"`)); };
  const sf = path.join(old, 'docs/devteam/project/settings.md');
  const setDays = (d) => fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace(/("owner_absence_days": [^,]*, )?"gates": \{\}/, `"owner_absence_days": ${d}, "gates": {}`));
  try {
    const G = ok(old, ['goal', 'add', '--title', 'Billing', '--outcome', 'it works', '--priority', '1'], SUP);
    ok(old, ['feature', 'add', 'bill', '--json', JSON.stringify({ title: 'bill', goals: [G], stories: [{ id: 'BILL-S1', text: 'it works', release: 'v1.0.0' }] })], SUP);
    const add = (id) => ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'bill', component: 'app', kind: 'build', size: 'S', risk: 'normal', serves: ['BILL-S1'], depends_on: [], touches: [`src/${id}/**`], done_when: ['its test passes in CI'] })], SUP);
    add('app-01-bill');
    add('app-02-invoices');
    add('app-03-receipts');
    const ASKED = 'Charge per seat or per team? Seats scale with headcount, teams with how the buyer thinks about the product';
    const QA = ok(old, ['ask', '--question', ASKED, '--ticket', 'app-01-bill', '--blocks', 'app-02-invoices', '--recommendation', 'Per team'], SUP);
    // one with a default, and one with none that blocks nothing: never on the alert
    const QD = ok(old, ['ask', '--kind', 'clarification', '--question', 'Show prices with tax?', '--blocks', 'app-03-receipts', '--recommendation', 'Yes', '--default', 'Yes'], SUP);
    ok(old, ['ask', '--question', 'Which logo do you prefer?', '--recommendation', 'The blue one'], SUP);
    assert.equal(alert(), null, 'fresh: under the default of 2 days');

    age(3 * DAY);
    const a = alert();
    assert.ok(a, 'three days on: the alert carries it');
    assert.equal(a, `A question has waited on you 3 days and blocks 2 tickets: ${ASKED.slice(0, 80)}… (${QA})`, 'plain words: how long, what it blocks, the first 80 characters, the id');
    assert.doesNotMatch(a, /tax|logo/, 'not the one with a default, nor the one that blocks nothing');
    assert.doesNotMatch(a, new RegExp(QD));

    // the setting: a longer wait is not yet past it; a tiny one is
    setDays(5);
    assert.equal(alert(), null, 'under owner_absence_days');
    setDays(0.00001);
    assert.match(alert(), /^A question has waited on you 3 days and blocks 2 tickets: /);

    // a second, newer one: the oldest is named, with a count
    const QB = ok(old, ['ask', '--question', 'Stripe or Paddle?', '--blocks', 'app-03-receipts', '--recommendation', 'Stripe'], SUP);
    age(3600000);
    const two = alert();
    assert.match(two, new RegExp(`\\(${QA}, and 1 more\\)$`));
    assert.doesNotMatch(two, /Stripe/);

    // answered: the oldest goes, the next is named; withdrawn: nothing left
    ok(old, ['answer', QA, 'Per team']);
    assert.equal(alert(), `A question has waited on you under a day and blocks 1 ticket: Stripe or Paddle? (${QB})`);
    ok(old, ['withdraw', QB, '--reason', 'settled in the thread'], SUP);
    assert.equal(alert(), null, 'answered or withdrawn: the alert clears');
  } finally { F.done(); }
});
