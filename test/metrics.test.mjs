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
