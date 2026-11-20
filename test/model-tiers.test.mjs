// Model tiers (worker.md §3): plans give each task `Model: fast | strong`, settings.model_tiers names
// the model per tier, and metrics checks plans against builds. model_tiers counts recent tickets'
// fast and strong tasks and their model misses. A ticket is unrouted when its plan has fast tasks,
// its build cost at least $2, and under 5% of that went to a cheaper model than the dearest it used
// (priced, so no vendor's names are assumed). fast-tasks-unrouted fires at DEVTEAM_TIER_MIN_TICKETS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { threadsFixture } from './lib/kit.mjs';

const H = 3600000;
const plan = (tiers) => `# Plan\n\nTL;DR: does the thing by the plain route.\n\n${tiers.map((t, i) => `## Task ${i + 1}\n\n- Files: src/x${i}.js\n- **Model:** \`${t}\`\n`).join('\n')}`;

test('model_tiers: plans against builds, misses counted, fast-tasks-unrouted over the floor', () => {
  const F = threadsFixture('model-tiers');
  try {
    F.sup(['feature', 'add', 'tiers', '--json', JSON.stringify({ title: 'Tiers', goals: [F.goal], stories: [{ id: 'TI-S1', text: 'tiers read right', release: 'v1.0.0' }] })]);
    // [id, plan tiers, build spend by model]
    const cases = [
      ['ti-01-all-strong-build', ['fast', 'fast', 'strong'], { 'claude-opus-5-5': 10 }],
      ['ti-02-one-fast', ['fast'], { 'claude-opus-5-5': 10 }],
      ['ti-03-routed', ['fast', 'fast'], { 'claude-opus-5-5': 6, 'claude-sonnet-5-5': 4 }],
      ['ti-04-strong-only', ['strong'], { 'claude-opus-5-5': 10 }],
      ['ti-05-cheap-build', ['fast'], { 'claude-opus-5-5': 1 }],
    ];
    let n = 0;
    for (const [id, tiers, spend] of cases) {
      F.sup(['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'tiers', component: 'web', kind: 'build', size: 'S', risk: 'normal', serves: ['TI-S1'], depends_on: [], touches: [`src/${id}/**`], done_when: ['its test passes in CI'] })]);
      const dir = path.join(F.old, 'docs/devteam/project/tickets', id);
      fs.mkdirSync(path.join(dir, 'reviews'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'plan.md'), plan(tiers));
      const usd = Object.values(spend).reduce((a, b) => a + b, 0);
      const by_model = Object.fromEntries(Object.entries(spend).map(([m, u]) => [m, { usd: u, output_tokens: Math.round(u * 1000) }]));
      F.hand('supervisor', { id: `s-2026${String(++n).padStart(4, '0')}-000000000-supervisor`, type: 'spend', who: id, role: 'worker', phase: 'build', through: new Date(Date.now() - 2 * H).toISOString(), usd, input_tokens: 0, output_tokens: 1000, cache_read_tokens: 0, cache_write_tokens: 0, by_model }, 2 * H);
    }
    // ti-02's fast task had to be redone on strong
    fs.writeFileSync(path.join(F.old, 'docs/devteam/project/tickets/ti-02-one-fast/reviews/task-1-1.md'), '- Reviewer: r\n- Model miss: fast\n\n| Id | Severity | Rule | Where | Finding | Disposition |\n|---|---|---|---|---|---|\n\nVerdict: APPROVE 0000000\n');
    // all merge: a commit on main named for each ticket
    F.g(['add', '-A'], F.old);
    for (const [id] of cases) F.g(['commit', '-qm', `${id}: done`, '--allow-empty'], F.old);
    F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);

    const m = JSON.parse(F.sup(['metrics', '--json'], { DEVTEAM_TIER_MIN_TICKETS: '2' }));
    const mt = m.model_tiers;
    assert.equal(mt.tickets, 5, JSON.stringify(mt));
    assert.equal(mt.fast_tasks, 6);
    assert.equal(mt.strong_tasks, 2);
    assert.equal(mt.misses, 1);
    assert.equal(mt.miss_rate, 0.17);
    assert.equal(mt.build_usd, 41);
    assert.equal(mt.build_usd_cheaper, 4);
    // planned fast but built all on the dearest model, over $2: the first two; a strong-only plan,
    // a routed build and a $1 build are not
    assert.deepEqual(mt.unrouted.map((x) => x.id), ['ti-01-all-strong-build', 'ti-02-one-fast']);
    const f = m.findings.find((x) => x.kind === 'fast-tasks-unrouted');
    assert.ok(f, JSON.stringify(m.findings.map((x) => x.kind)));
    assert.match(JSON.stringify(f), /2 of 5 recent tickets planned fast tasks \(3 of 4\)/);
    // under the default floor (3 tickets) it stays quiet
    const q = JSON.parse(F.sup(['metrics', '--json']));
    assert.ok(!q.findings.some((x) => x.kind === 'fast-tasks-unrouted'));

    // the tiers' models are a setting, with a default, whose shape is checked
    assert.deepEqual(JSON.parse(F.sup(['settings', '--get', 'model_tiers'])), { fast: 'sonnet', strong: 'opus' });
  } finally { F.done(); }
});
