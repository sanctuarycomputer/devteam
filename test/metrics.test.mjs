// Review metrics by the category word each finding opens with (quality.md §3), and the worker
// prompt's first-pass sentence naming the author checks worker.md §4 asks for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { threadsFixture } from './lib/kit.mjs';

const HEAD = '| Id | Severity | Rule | Where | Finding | Disposition |\n|---|---|---|---|---|---|\n';
const rec = (verdict, rows = [], head = HEAD) => `- Reviewer: r\n\n${head}${rows.map((r, i) => `| R${i + 1} | ${r[0]} | ${r[1]} | a.js:1 | ${r[2]} | |\n`).join('')}\nVerdict: ${verdict} 0000000\n`;

test('metrics counts first passes\' blocking findings by category word; one without a category word counts as none', () => {
  const F = threadsFixture('metrics-categories');
  try {
    F.sup(['feature', 'add', 'mcat', '--json', JSON.stringify({ title: 'Mc', goals: [F.goal], stories: [{ id: 'MC-S1', text: 'categories count', release: 'v1.0.0' }] })]);
    const ids = ['m-01-one', 'm-02-two'];
    for (const id of ids) F.sup(['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'mcat', component: 'web', kind: 'build', size: 'S', risk: 'normal', serves: ['MC-S1'], depends_on: [], touches: [`src/${id}/**`], done_when: ['its test passes in CI'] })]);
    const put = (id, file, text) => { const d = path.join(F.old, 'docs/devteam/project/tickets', id, 'reviews'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, file), text); };
    put('m-01-one', 'spec-1.md', rec('CHANGES', [
      ['Important', 'spec §2', 'weak-check: passes with the feature removed'],
      ['Critical', 'L-LOGIC-3', '`code-fact`: wrong about git'],
      ['Important', 'spec §3', 'no category word here'],
      ['Important', 'spec §4', 'nit: an unlisted word is not a category'],
      ['Minor', 'spec §5', 'defect: Minor never counts'],
    ]));
    put('m-02-two', 'spec-1.md', rec('CHANGES', [['Important', 'spec §1', 'Weak-Check: case does not matter'], ['Important', 'spec §2', '**defect:** the colon inside the bold']]));
    // a second pass is not a first pass: never counted
    put('m-02-two', 'spec-2.md', rec('CHANGES', [['Critical', 'spec §1', 'defect: second pass']]));
    // a table with no Finding column: its findings have no category word
    put('m-01-one', 'plan-1.md', rec('CHANGES', [['Important', 'L-TEST-1', 'x']], '| Id | Severity | Rule | Where | Note | Disposition |\n|---|---|---|---|---|---|\n'));
    put('m-02-two', 'plan-1.md', rec('APPROVE'));
    // a stage whose first passes block on nothing is left out of the text line
    put('m-02-two', 'final-1.md', rec('APPROVE', [['Minor', 'spec §1', 'other: a nit']]));
    for (const id of ids) { F.g(['add', '-A'], F.old); F.g(['commit', '-qm', `${id}: done`, '--allow-empty'], F.old); }
    F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);

    // the text line: stages in a fixed order (spec before plan whatever order the folders list in),
    // the top three per stage, a stage with nothing blocking left out
    const text = F.sup(['metrics']);
    assert.ok(text.split('\n').includes('blocking categories (first passes): spec none 2, weak-check 2, code-fact 1; plan none 1'), text);
    const m = JSON.parse(F.sup(['metrics', '--json']));
    assert.deepEqual(m.reviews.by_stage.spec.top_blocking_categories, [{ category: 'none', count: 2 }, { category: 'weak-check', count: 2 }, { category: 'code-fact', count: 1 }, { category: 'defect', count: 1 }]);
    assert.deepEqual(m.reviews.by_stage.final.top_blocking_categories, []);
    assert.deepEqual(m.reviews.by_stage.plan.top_blocking_categories, [{ category: 'none', count: 1 }]);
    // the rule counts stay beside them
    assert.deepEqual(m.reviews.by_stage.plan.top_blocking_rules, [{ rule: 'L-TEST-1', count: 1 }]);
  } finally { F.done(); }
});

test('the worker prompt names the author checks: each check seen failing, each claim about code sourced', () => {
  const F = threadsFixture('metrics-prompt');
  try {
    F.sup(['feature', 'add', 'mprompt', '--json', JSON.stringify({ title: 'Mp', goals: [F.goal], stories: [{ id: 'MP-S1', text: 'prompt', release: 'v1.0.0' }] })]);
    F.sup(['ticket', 'add', 'p-01-one', '--json', JSON.stringify({ title: 'p', feature: 'mprompt', component: 'web', kind: 'build', size: 'S', risk: 'normal', serves: ['MP-S1'], depends_on: [], touches: ['src/p/**'], done_when: ['its test passes in CI'] })]);
    const p = F.sup(['prompt', 'worker', 'p-01-one']);
    const first = p.split('\n').find((l) => l.includes('first-pass checks in worker.md §4')) ?? '';
    assert.match(first, /seen failing against broken code/, first);
    assert.match(first, /claim about code sourced with a file:line or a command/, first);
  } finally { F.done(); }
});

// A fixture of goals at priorities 2, 3, 5 and 9 (F.goal is 1), a feature for each, and ticket(id,
// p, deps) to plan one under the goal at priority p.
const priorityFixture = (name) => {
  const F = threadsFixture(name);
  const goal = (title, p) => F.sup(['goal', 'add', '--title', title, '--outcome', 'it ships', '--measure', 'share', '--target', '80', '--unit', '%', '--direction', 'up', '--source', 'prod', '--check', 'echo 5', '--horizon', '2027-03-31', '--non-goals', 'none', '--preconditions', 'a', '--priority', String(p)]);
  const g = { 2: goal('High', 2), 3: goal('Middle', 3), 5: goal('Fifth', 5), 9: goal('Low', 9) };
  for (const p of [2, 3, 5, 9]) F.sup(['feature', 'add', `fp${p}`, '--json', JSON.stringify({ title: `F${p}`, goals: [g[p]], stories: [{ id: `P${p}-S1`, text: 'it works', release: 'v1.0.0' }] })]);
  const ticket = (id, p, deps = [], extra = {}) => F.sup(['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: `fp${p}`, component: 'web', kind: 'build', size: 'S', risk: 'normal', serves: [`P${p}-S1`], depends_on: deps, touches: [`src/${id}/**`], done_when: ['its test passes in CI'], ...extra })]);
  const findings = () => JSON.parse(F.sup(['metrics', '--json'])).findings;
  // what idle capacity offers (the fixture reads no machine, so memory never holds it back)
  const idle = () => findings().find((x) => x.kind === 'idle-capacity' && /ready$/.test(x.subject))?.suggestion;
  const rows = () => JSON.parse(F.sup(['ready', '--json'])).ready.map((r) => [r.id, r.priority, r.blocks?.priority ?? null]);
  return { F, g, ticket, findings, idle, rows };
};

// Goal priority orders ready past fix tickets, and a ticket takes the best priority of the goals
// that wait on it, directly or through other tickets.
test('ready orders by effective goal priority: work a higher goal waits on goes first, marked blocks pN', () => {
  const { F, g, ticket, idle, rows } = priorityFixture('ready-priority');
  try {
    // a p3 ticket waits on a p5 one; a p2 ticket waits on p9 work through another p9 ticket.
    // Added in this order, so no order below is the order they were planned in.
    ticket('pr-03-fifth', 5);
    ticket('pr-04-middle', 3, ['pr-03-fifth']);
    ticket('pr-01-low', 9);
    ticket('pr-05-link', 9, ['pr-01-low']);
    ticket('pr-02-high', 2, ['pr-05-link']);

    assert.deepEqual(rows(), [['pr-01-low', 2, 2], ['pr-03-fifth', 3, 3]]);
    assert.equal(JSON.parse(F.sup(['ready', '--json'])).ready[0].blocks.goal, g[2]);
    const text = F.sup(['ready']).split('\n');
    const at = (id) => text.findIndex((l) => l.includes(id));
    assert.ok(at('pr-01-low') >= 0 && at('pr-01-low') < at('pr-03-fifth'), text.join('\n'));
    assert.match(text[at('pr-01-low')], /\(blocks p2\)/);
    assert.match(text[at('pr-03-fifth')], /\(blocks p3\)/);
    // idle capacity names the workers to start in the same order
    assert.equal(idle(), 'make workers for: pr-01-low, pr-03-fifth');

    // the edge cut: the p9 tickets are their own priority again
    F.sup(['ticket', 'set', 'pr-02-high', '--json', JSON.stringify({ depends_on: [] })]);
    assert.deepEqual(rows(), [['pr-02-high', 2, null], ['pr-03-fifth', 3, 3], ['pr-01-low', 9, null]]);
    assert.doesNotMatch(F.sup(['ready']), /blocks p2/);
    assert.equal(idle(), 'make workers for: pr-02-high, pr-03-fifth, pr-01-low');

    // a fix ticket (Upkeep's: no priority) still comes first, in ready and in what idle capacity names
    F.hand('supervisor', { type: 'ticket', id: 'pr-06-fix', title: 'a fix', feature: 'chores', component: 'web', kind: 'fix', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['src/pr-06-fix/**'], done_when: ['it is fixed'] }, 1000);
    assert.deepEqual(rows()[0], ['pr-06-fix', null, null]);
    assert.equal(idle(), 'make workers for: pr-06-fix, pr-02-high, pr-03-fifth, pr-01-low');
  } finally { F.done(); }
});

// Priority orders the queue and never gates it: while the only p2 work can't start (blocked on its
// own goal's work, or held), a p9 ticket is ready and offered to idle capacity.
test('a lower-priority ticket still starts while higher-priority work is blocked or held', () => {
  const { F, ticket, idle, rows } = priorityFixture('ready-backfill');
  try {
    ticket('bf-01-first', 2, [], { held: 'waits on the owner' });
    ticket('bf-02-then', 2, ['bf-01-first']);
    ticket('bf-03-low', 9);
    assert.deepEqual(rows(), [['bf-03-low', 9, null]]);
    assert.deepEqual(JSON.parse(F.sup(['ready', '--json'])).held.map((h) => h.id), ['bf-01-first']);
    assert.equal(idle(), 'make workers for: bf-03-low');
  } finally { F.done(); }
});
