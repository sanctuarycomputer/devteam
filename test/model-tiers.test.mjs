// Model tiers (worker.md §3): plans give each task `Model: fast | strong`, settings.model_tiers names
// the model per tier, and metrics checks plans against builds. model_tiers counts recent tickets'
// fast and strong tasks (merged in the last 14 days, or building in them, a plan only on its branch
// included), fast tasks built here on purpose, and model misses once per task. A ticket is unrouted
// when its plan has fast tasks not built here, its build cost at least $2 with none on an unpriced
// model, and under 5% of it went to a cheaper model than the dearest it used (priced, so no vendor's
// names are assumed). fast-tasks-unrouted fires at DEVTEAM_TIER_MIN_TICKETS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { threadsFixture } from './lib/kit.mjs';

const H = 3600000;
const DAY = 24 * H;
// tiers: 'fast', 'strong', 'fast-here' (built here on purpose), 'fast-bold' (written **Model**: fast)
const plan = (tiers) => `# Plan\n\nTL;DR: does the thing by the plain route.\n\n${tiers.map((t, i) => `## Task ${i + 1}\n\n- Files: src/x${i}.js\n${t === 'fast-bold' ? '- **Model**: fast' : `- **Model:** \`${t.replace('-here', '')}\``}\n${t === 'fast-here' ? '- Built here: a two-line rename next to the strong task\n' : ''}`).join('\n')}`;
const review = (extra = '') => `- Reviewer: r\n${extra}\n| Id | Severity | Rule | Where | Finding | Disposition |\n|---|---|---|---|---|---|\n\nVerdict: APPROVE 0000000\n`;

test('model_tiers: plans against builds, built here and unpriced left out, misses once per task, the finding over its floor', () => {
  const F = threadsFixture('model-tiers');
  try {
    F.sup(['feature', 'add', 'tiers', '--json', JSON.stringify({ title: 'Tiers', goals: [F.goal], stories: [{ id: 'TI-S1', text: 'tiers read right', release: 'v1.0.0' }] })]);
    const add = (id) => F.sup(['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'tiers', component: 'web', kind: 'build', size: 'S', risk: 'normal', serves: ['TI-S1'], depends_on: [], touches: [`src/${id}/**`], done_when: ['its test passes in CI'] })]);
    const dir = (id) => path.join(F.old, 'docs/devteam/project/tickets', id);
    let n = 0;
    const spend = (id, byModel, agoMs = 2 * H) => {
      const usd = Object.values(byModel).reduce((a, b) => a + b, 0);
      const by_model = Object.fromEntries(Object.entries(byModel).map(([m, u]) => [m, { usd: u, output_tokens: Math.round(u * 1000) }]));
      F.hand('supervisor', { id: `s-2026${String(++n).padStart(4, '0')}-000000000-supervisor`, type: 'spend', who: id, role: 'worker', phase: 'build', through: new Date(Date.now() - agoMs).toISOString(), usd, input_tokens: 0, output_tokens: 1000, cache_read_tokens: 0, cache_write_tokens: 0, by_model }, agoMs);
    };
    // merged, recent: [id, plan tiers, build spend by model]
    const merged = [
      ['ti-01-all-strong-build', ['fast', 'fast', 'strong'], { 'claude-opus-5-5': 10 }],
      ['ti-02-one-fast', ['fast-bold'], { 'claude-opus-5-5': 10 }],
      ['ti-03-routed', ['fast', 'fast'], { 'claude-opus-5-5': 6, 'claude-sonnet-5-5': 4 }],
      ['ti-04-strong-only', ['strong'], { 'claude-opus-5-5': 10 }],
      ['ti-05-cheap-build', ['fast'], { 'claude-opus-5-5': 1 }],
      ['ti-06-built-here', ['fast-here', 'strong'], { 'claude-opus-5-5': 10 }],
      ['ti-07-unpriced', ['fast'], { 'claude-opus-5-5': 6, 'acme-tiny-1': 4 }],
    ];
    for (const [id, tiers, by] of merged) { add(id); fs.mkdirSync(path.join(dir(id), 'reviews'), { recursive: true }); fs.writeFileSync(path.join(dir(id), 'plan.md'), plan(tiers)); spend(id, by); }
    // ti-02's fast task missed: noted in two passes of its task review and restated in the final, one miss
    for (const f of ['task-1.md', 'task-1-2.md', 'final-1.md']) fs.writeFileSync(path.join(dir('ti-02-one-fast'), 'reviews', f), review('- Model miss: fast\n'));
    // ti-03's second task missed, noted only in its first review (task-2.md, the usual place)
    fs.writeFileSync(path.join(dir('ti-03-routed'), 'reviews', 'task-2.md'), review('- Model miss: fast\n'));
    // one merged 20 days ago, out of the window
    add('ti-08-old-merge'); fs.mkdirSync(dir('ti-08-old-merge'), { recursive: true }); fs.writeFileSync(path.join(dir('ti-08-old-merge'), 'plan.md'), plan(['fast'])); spend('ti-08-old-merge', { 'claude-opus-5-5': 10 }, 21 * DAY);
    F.g(['add', '-A'], F.old);
    const old = new Date(Date.now() - 20 * DAY).toISOString();
    execFileSync('git', ['commit', '-q', '-m', 'ti-08-old-merge: done'], { cwd: F.old, env: { ...process.env, GIT_COMMITTER_DATE: old, GIT_AUTHOR_DATE: old } });
    for (const [id] of merged) F.g(['commit', '-qm', `${id}: done`, '--allow-empty'], F.old);
    F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
    // one not merged, building now, its plan only on its ticket branch
    add('ti-09-on-branch');
    F.g(['add', '-A'], F.old); F.g(['commit', '-qm', 'add ti-09', '--allow-empty'], F.old); F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
    F.g(['checkout', '-q', '-b', 'ticket/ti-09-on-branch'], F.old);
    fs.mkdirSync(dir('ti-09-on-branch'), { recursive: true }); fs.writeFileSync(path.join(dir('ti-09-on-branch'), 'plan.md'), plan(['fast', 'fast']));
    F.g(['add', '-A'], F.old); F.g(['commit', '-qm', 'ti-09 plan'], F.old); F.g(['push', '-q', 'origin', 'ticket/ti-09-on-branch'], F.old);
    F.g(['checkout', '-q', 'main'], F.old);
    spend('ti-09-on-branch', { 'claude-opus-5-5': 10 });

    const m = JSON.parse(F.sup(['metrics', '--json'], { DEVTEAM_TIER_MIN_TICKETS: '2' }));
    const mt = m.model_tiers;
    assert.equal(mt.tickets, 8, `seven merged in the window and one building on its branch; not the old merge: ${JSON.stringify(mt)}`);
    assert.equal(mt.fast_tasks, 10);
    assert.equal(mt.strong_tasks, 3);
    assert.equal(mt.fast_built_here, 1);
    assert.equal(mt.misses, 2, 'ti-02 missed once however many records say so, and ti-03 in a first review');
    assert.deepEqual(mt.unrouted.map((x) => x.id), ['ti-01-all-strong-build', 'ti-02-one-fast', 'ti-09-on-branch'], 'not routed, strong only, under $2, built here or unpriced');
    const f = m.findings.find((x) => x.kind === 'fast-tasks-unrouted');
    assert.ok(f, JSON.stringify(m.findings.map((x) => x.kind)));
    assert.match(JSON.stringify(f), /3 of 8 recent tickets planned fast tasks \(5 of 6\)/);
    // under the default floor (3) it still fires with three; at 4 it is quiet
    assert.ok(!JSON.parse(F.sup(['metrics', '--json'], { DEVTEAM_TIER_MIN_TICKETS: '4' })).findings.some((x) => x.kind === 'fast-tasks-unrouted'));

    // the tiers' models: a default, merged per tier, and a value off its shape falls back with a warning
    assert.deepEqual(JSON.parse(F.sup(['settings', '--get', 'model_tiers'])), { fast: 'sonnet', strong: 'opus' });
    const sp = path.join(F.old, 'docs/devteam/project/settings.md');
    const base = fs.readFileSync(sp, 'utf8');
    const withTiers = (v) => fs.writeFileSync(sp, base.replace(/```json devteam\s*\n\{/, `\`\`\`json devteam\n{ "model_tiers": ${JSON.stringify(v)},`));
    withTiers({ fast: 'haiku' });
    assert.deepEqual(JSON.parse(F.sup(['settings', '--get', 'model_tiers'])), { fast: 'haiku', strong: 'opus' }, 'a partial override keeps the other tier');
    withTiers({ cheap: 'haiku' });
    const raw = spawnSync(process.execPath, [path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), 'settings', '--get', 'model_tiers'], { cwd: F.old, env: F.env(F.SUP), encoding: 'utf8' });
    const r = { out: raw.stdout.trim(), err: raw.stderr };
    assert.deepEqual(JSON.parse(r.out), { fast: 'sonnet', strong: 'opus' }, 'off its shape: the default');
    assert.match(r.err, /model_tiers is .*not \{ "fast"/);
    fs.writeFileSync(sp, base);
  } finally { F.done(); }
});
