// End-to-end test of the kit against a throwaway repo: plan PR, worker lifecycle, questions,
// trust, corrections, forgery, log-sync, and the computed views. Run: node --test  (DEVTEAM_TEST_KEEP=1 keeps the fixture)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'devteam');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-kit-'));
const origin = path.join(tmp, 'origin.git');
const repo = path.join(tmp, 'repo');
const wt = (name) => path.join(repo, '.worktrees', name);
const DT = path.join(repo, 'docs', 'devteam', 'scripts', 'devteam.mjs');
const ROLE = { sup: { DEVTEAM_ROLE: 'supervisor' }, planner: { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'billing' }, planner2: { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'other' }, worker: { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'bill-01-card' }, owner: {} };
const line = (o) => `${JSON.stringify({ v: 1, ...o })}\n`;

function dt(args, { cwd = repo, role = 'owner' } = {}) {
  const env = { ...process.env, ...ROLE[role] };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE']) if (!(k in ROLE[role])) delete env[k];
  const r = spawnSync(process.execPath, [DT, ...args], { cwd, env, encoding: 'utf8' });
  return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}
const must = (args, opts) => { const r = dt(args, opts); assert.equal(r.status, 0, `${args.join(' ')}: ${r.err || r.out}`); return r.out; };
const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const review = (reviewer, sha) => `- Reviewer: ${reviewer}\n\n| Id | Severity | Rule | Where | Finding | Disposition |\n|---|---|---|---|---|---|\n\nVerdict: APPROVE ${sha}\n`;
const json = (s) => JSON.parse(s);
const body = path.join(tmp, 'body.md');
write(body, '## One-way doors\n\nNone.\n');

test('devteam kit', async (t) => {
  let G, Q, A, SHA1, H2;
  t.after(() => { if (!process.env.DEVTEAM_TEST_KEEP) fs.rmSync(tmp, { recursive: true, force: true }); else console.log(`fixture kept at ${tmp}`); });

  await t.test('init materializes project/, settings, agent config', () => {
    git(['init', '-q', '--bare', origin], tmp);
    fs.mkdirSync(repo);
    git(['init', '-q', '-b', 'main']);
    write(path.join(repo, 'CLAUDE.md'), '# Project\n');
    git(['config', 'user.email', 't@t']);
    git(['config', 'user.name', 't']);
    git(['remote', 'add', 'origin', origin]);
    fs.cpSync(kit, path.join(repo, 'docs', 'devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
    must(['init', '--name', 'demo', '--upstream-base', 'v0.2.0', '--github']);
    for (const f of ['docs/devteam/project/settings.md', 'docs/devteam/project/designs/architecture.md', '.github/workflows/devteam.yml']) assert.ok(fs.existsSync(path.join(repo, f)), f);
    assert.match(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8'), /docs\/devteam\/run\//);
    assert.match(fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), /process\/supervisor\.md/, 'AGENTS.md routes agents to their doc');
    assert.match(fs.readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8'), /@AGENTS\.md/, 'CLAUDE.md imports AGENTS.md');
    git(['add', '-A']);
    git(['commit', '-qm', 'init']);
    git(['push', '-q', 'origin', 'main']);
  });

  await t.test('goals: supervisor drafts, owner approves', () => {
    G = must(['goal', 'add', '--title', 'Self-serve billing', '--outcome', 'admins pay alone', '--measure', 'self-serve share', '--target', '80', '--unit', '%', '--direction', 'up', '--horizon', '2027-03-31', '--non-goals', 'enterprise invoicing', '--preconditions', 'cards work', 'prices defined', '--priority', '1'], { role: 'sup' });
    assert.match(G, /^g-\d{8}-\d{9}-supervisor$/);
    must(['goal', 'reading', G, '--value', '5'], { role: 'sup' });
    assert.notEqual(dt(['goal', 'approve', G], { role: 'sup' }).status, 0, 'supervisor cannot approve a goal');
    must(['goal', 'approve', G]);
    assert.equal(json(must(['goal', 'show', G, '--json'])).status, 'ready');
  });

  await t.test('planner writes feature and tickets into its own log file in its worktree', () => {
    git(['worktree', 'add', '-q', '-b', 'plan/billing', wt('plan-billing'), 'origin/main']);
    write(path.join(wt('plan-billing'), 'docs/devteam/project/designs/self-serve-billing.md'), '# Design: billing\n');
    const feature = { title: 'Billing', goals: [G], preconditions: [`${G}#1`], design: 'project/designs/self-serve-billing.md', stories: [{ id: 'BILL-S1', text: 'admin adds a card', release: 'v0.2.0' }] };
    must(['feature', 'add', 'billing', '--json', JSON.stringify(feature)], { cwd: wt('plan-billing'), role: 'planner' });
    const ticket = { title: 'card capture', feature: 'billing', component: 'bill', kind: 'build', size: 'S', risk: 'normal', serves: ['BILL-S1'], depends_on: [], touches: ['billing/**'], done_when: ['card test passes in CI'] };
    must(['ticket', 'add', 'bill-01-card', '--json', JSON.stringify(ticket)], { cwd: wt('plan-billing'), role: 'planner' });
    assert.notEqual(dt(['ticket', 'add', 'bill-01-card', '--json', '{"title":"x"}'], { cwd: wt('plan-billing'), role: 'planner' }).status, 0, 'duplicate id refused');
    assert.ok(fs.existsSync(path.join(wt('plan-billing'), 'docs/devteam/project/log/plan-billing.jsonl')), 'planner file in the worktree');
    assert.ok(!fs.readdirSync(path.join(repo, 'docs/devteam/run/log')).some((f) => f.startsWith('plan')), 'nothing planner-written in run/log');
    assert.doesNotMatch(must(['status']), /bill-01/, 'main does not see an unlanded plan');
    assert.notEqual(dt(['validate', '--strict'], { cwd: wt('plan-billing') }).status, 0, 'strict validate fails without reviews');
  });

  await t.test('plan PR: reviews make it valid, check-pr accepts it, tampering is caught', () => {
    git(['add', '-A'], wt('plan-billing'));
    git(['commit', '-qm', 'plan billing'], wt('plan-billing'));
    const sha0 = git(['rev-parse', 'HEAD'], wt('plan-billing'));
    write(path.join(wt('plan-billing'), 'docs/devteam/project/reviews/billing/graph-1.md'), review('reviewer-a', sha0));
    write(path.join(wt('plan-billing'), 'docs/devteam/project/reviews/self-serve-billing/design-1.md'), review('reviewer-a', sha0));
    git(['add', '-A'], wt('plan-billing'));
    git(['commit', '-qm', 'reviews'], wt('plan-billing'));
    SHA1 = git(['rev-parse', 'HEAD'], wt('plan-billing'));
    must(['validate', '--strict'], { cwd: wt('plan-billing') });
    git(['push', '-q', 'origin', 'plan/billing'], wt('plan-billing'));
    must(['check-pr', '--head-ref', 'plan/billing', '--sha', SHA1, '--title', 'plan-billing: billing'], { role: 'sup' });
    // a ticket changed after the graph review voids the verdict
    must(['ticket', 'set', 'bill-01-card', '--json', '{"risk":"high"}'], { cwd: wt('plan-billing'), role: 'planner' });
    git(['commit', '-qam', 'after review'], wt('plan-billing'));
    const voided = dt(['validate', '--strict'], { cwd: wt('plan-billing') });
    assert.notEqual(voided.status, 0);
    assert.match(voided.out, /does not hold/);
    git(['reset', '-q', '--hard', SHA1], wt('plan-billing'));
    // a planner for another feature cannot touch this one
    git(['worktree', 'add', '-q', '-b', 'plan/other', wt('plan-other'), 'plan/billing']);
    assert.notEqual(dt(['ticket', 'set', 'bill-01-card', '--json', '{"risk":"high"}'], { cwd: wt('plan-other'), role: 'planner2' }).status, 0, 'refused on write');
    fs.appendFileSync(path.join(wt('plan-other'), 'docs/devteam/project/log/plan-other.jsonl'), line({ id: 'bill-01-card', type: 'ticket', op: 'set', at: '2026-11-01T23:59:59.000Z', by: 'plan-other', risk: 'high' }));
    assert.equal(json(must(['ticket', 'show', 'bill-01-card'], { cwd: wt('plan-other') })).risk, 'normal', 'ignored by the fold');
    git(['worktree', 'remove', '--force', wt('plan-other')]);
    git(['branch', '-D', 'plan/other']);
    // a plan PR that touches another writer's log file
    write(path.join(wt('plan-billing'), 'docs/devteam/project/log/supervisor-2026-11.jsonl'), '{"v":1,"id":"q-20261101-000000000-supervisor","type":"question","op":"new","at":"2026-11-01T00:00:00.000Z","by":"supervisor","kind":"owner-decision","question":"x"}\n');
    git(['add', '-A'], wt('plan-billing'));
    git(['commit', '-qm', 'tamper'], wt('plan-billing'));
    const r = dt(['check-pr', '--head-ref', 'plan/billing', '--sha', git(['rev-parse', 'HEAD'], wt('plan-billing')), '--title', 'plan-billing: billing'], { role: 'sup' });
    assert.notEqual(r.status, 0);
    assert.match(r.out + r.err, /may not change/);
    git(['reset', '-q', '--hard', SHA1], wt('plan-billing'));
  });

  await t.test('landing the plan PR makes its tickets ready', () => {
    git(['merge', '-q', '--no-ff', '-m', 'Merge pull request #1 from x/plan/billing', 'plan/billing']);
    git(['push', '-q', 'origin', 'main']);
    assert.match(must(['status']), /ready.*bill-01-card/);
    must(['validate']);
    assert.match(must(['ready']), /bill-01-card/);
  });

  await t.test('worker: phases, gates, approvals, check-ticket at an exact head', () => {
    git(['worktree', 'add', '-q', '-b', 'ticket/bill-01-card', wt('bill-01-card'), 'origin/main']);
    const w = { cwd: wt('bill-01-card'), role: 'worker' };
    must(['phase', 'spec', '--usd', '0.5'], w);
    must(['phase', 'spec'], w);
    must(['phase', 'build', '--task', 'T1', '--usd', '2'], w);
    assert.equal(json(must(['log', '--type', 'phase', '--by', 'bill-01-card', '--json'])).length, 2, 'an unchanged phase within 15 min is not written');
    assert.doesNotMatch(must(['ready']), /bill-01/, 'a ticket with an active worker is not ready');
    must(['gate', 'test', '--', 'true'], w);
    assert.notEqual(dt(['gate', 'lint', '--', 'false'], w).status, 0, 'gate passes the exit status through');
    must(['act', '--class', 'approve-spec', '--refs', 'bill-01-card', '--', 'spec ok'], { role: 'sup' });
    must(['act', '--class', 'approve-plan', '--refs', 'bill-01-card', '--', 'plan ok'], { role: 'sup' });
    const tdir = path.join(wt('bill-01-card'), 'docs/devteam/project/tickets/bill-01-card');
    write(path.join(tdir, 'spec.md'), '# spec\n');
    write(path.join(tdir, 'plan.md'), '# plan\n');
    write(path.join(tdir, 'verification.md'), '| Done-when | Command | Result |\n|---|---|---|\n| card test | npm t | pass |\n');
    write(path.join(wt('bill-01-card'), 'billing/card.js'), 'code\n');
    git(['add', '-A'], wt('bill-01-card'));
    git(['commit', '-qm', 'bill-01-card: card capture'], wt('bill-01-card'));
    const h1 = git(['rev-parse', 'HEAD'], wt('bill-01-card'));
    write(path.join(tdir, 'reviews/final-1.md'), review('reviewer-b', h1));
    git(['add', '-A'], wt('bill-01-card'));
    git(['commit', '-qm', 'review'], wt('bill-01-card'));
    H2 = git(['rev-parse', 'HEAD'], wt('bill-01-card'));
    const pr = ['--title', 'bill-01-card: card capture', '--body-file', body];
    must(['check-ticket', 'bill-01-card', '--sha', H2, ...pr]);
    must(['check-pr', '--head-ref', 'ticket/bill-01-card', '--sha', H2, ...pr]);
    fs.appendFileSync(path.join(wt('bill-01-card'), 'billing/card.js'), 'more\n');
    git(['commit', '-qam', 'more'], wt('bill-01-card'));
    assert.notEqual(dt(['check-ticket', 'bill-01-card', '--sha', git(['rev-parse', 'HEAD'], wt('bill-01-card')), ...pr]).status, 0, 'a verdict does not hold past a code commit');
    git(['reset', '-q', '--hard', H2], wt('bill-01-card'));
    // a dissent in another track that names a wrong commit still counts as a dissent
    write(path.join(tdir, 'reviews/final-1b.md'), `- Reviewer: reviewer-c\n\nVerdict: CHANGES ${'0'.repeat(40)}\n`);
    git(['add', '-A'], wt('bill-01-card'));
    git(['commit', '-qm', 'dissent'], wt('bill-01-card'));
    const dissent = dt(['check-ticket', 'bill-01-card', '--sha', git(['rev-parse', 'HEAD'], wt('bill-01-card')), ...pr]);
    assert.notEqual(dissent.status, 0);
    assert.match(dissent.out, /final-1b\.md.*CHANGES/);
    git(['reset', '-q', '--hard', H2], wt('bill-01-card'));
    // a rename out of the footprint is a change outside touches
    git(['mv', 'AGENTS.md', 'billing/agents.md'], wt('bill-01-card'));
    git(['commit', '-qm', 'move'], wt('bill-01-card'));
    const h3 = git(['rev-parse', 'HEAD'], wt('bill-01-card'));
    write(path.join(tdir, 'reviews/final-2.md'), review('reviewer-b', h3));
    git(['add', '-A'], wt('bill-01-card'));
    git(['commit', '-qm', 'review 2'], wt('bill-01-card'));
    const moved = dt(['check-ticket', 'bill-01-card', '--sha', git(['rev-parse', 'HEAD'], wt('bill-01-card')), ...pr]);
    assert.notEqual(moved.status, 0);
    assert.match(moved.out, /outside touches: AGENTS\.md/);
    git(['reset', '-q', '--hard', H2], wt('bill-01-card'));
    git(['push', '-q', 'origin', 'ticket/bill-01-card'], wt('bill-01-card'));
  });

  await t.test('merge --dry-run runs the gates at the head as the supervisor', () => {
    const settings = path.join(repo, 'docs/devteam/project/settings.md');
    fs.writeFileSync(settings, fs.readFileSync(settings, 'utf8').replace('"gates": {}', '"gates": { "test": "test -f billing/card.js && test -f config/master.key && test -f .setup-ran", "lint": { "cmd": "true" }, "web": { "cmd": "false", "paths": ["web/**"] } }, "worktree_files": ["config/master.key"], "worktree_setup": "touch .setup-ran"'));
    write(path.join(repo, 'config/master.key'), 'secret\n');
    fs.appendFileSync(path.join(repo, '.gitignore'), 'config/master.key\n');
    must(['merge', 'bill-01-card', '--dry-run', '--title', 'bill-01-card: card capture', '--body-file', body], { role: 'sup' });
    const gates = json(must(['log', '--type', 'gate', '--by', 'supervisor', '--json']));
    // web is skipped: the PR changes nothing under web/
    assert.deepEqual(gates.map((g) => g.gate).sort(), ['lint', 'test']);
    assert.ok(gates.every((g) => g.ok && g.sha === H2));
    fs.writeFileSync(settings, fs.readFileSync(settings, 'utf8').replace('"test": "test -f billing/card.js && test -f config/master.key && test -f .setup-ran"', '"test": "false"'));
    const failed = dt(['merge', 'bill-01-card', '--dry-run', '--title', 'bill-01-card: card capture', '--body-file', body], { role: 'sup' });
    assert.notEqual(failed.status, 0);
    assert.match(failed.out, /gate test failed/);
    assert.ok(!fs.readdirSync(path.join(repo, '.worktrees')).some((d) => d.startsWith('tmp-')), 'no temp worktree left behind');
    fs.writeFileSync(settings, fs.readFileSync(settings, 'utf8').replace('"test": "false"', '"test": "test -f billing/card.js && test -f config/master.key && test -f .setup-ran"'));
    must(['phase', 'supervisor', '--usd', '3.5'], { role: 'sup' });
  });

  await t.test('questions, autonomy direction, the act gate, corrections', () => {
    Q = must(['ask', '--question', 'Ship card capture behind a flag?', '--class', 'release-scope', '--reasons', 'below-rung', '--recommendation', 'yes', '--options', 'yes', 'no', '--blocks', 'bill-01-card'], { role: 'sup' });
    assert.notEqual(dt(['answer', Q, 'yes'], { role: 'sup' }).status, 0, 'an agent cannot answer as the owner');
    must(['answer', Q, 'yes', '--autonomy', '2', '--rule', 'flags first']);
    assert.match(dt(['ask', '--kind', 'trust', '--class', 'release-scope', '--question', 'step up?'], { role: 'sup' }).err, /needs 90% of the last 10/, 'a trust question needs the evidence');
    const Qd = must(['ask', '--question', 'Rename the billing component?', '--class', 'priority-change', '--reasons', 'below-rung', '--recommendation', 'no', '--default', 'no'], { role: 'sup' });
    must(['answer', Qd, '--defaulted'], { role: 'sup' });
    assert.ok(json(must(['log', '--type', 'act', '--json'])).some((a) => a.class === 'apply-default' && a.refs.includes(Qd)), 'applying a default is an act');
    const rung = () => json(must(['trust', '--json'])).find((r) => r.class === 'release-scope').rung;
    assert.equal(rung(), 2, 'the owner moved the class to rung 2');
    assert.equal(dt(['act', '--class', 'release-scope', '--', 'slip BILL-S2'], { role: 'sup' }).status, 3, 'act refuses below rung 3 without an approval');
    A = must(['act', '--class', 'release-scope', '--approved', Q, '--', 'shipped behind a flag'], { role: 'sup' });
    assert.notEqual(dt(['act', '--class', 'release-scope', '--approved', Q, '--', 'again'], { role: 'sup' }).status, 0, 'an approval is used once');
    must(['correct', A, '--reason', 'too early']);
    assert.equal(rung(), 1, 'a correction drops the class to rung 1');
    must(['repair', A, '--how', 'fix-ticket'], { role: 'sup' });
    assert.notEqual(dt(['correct', A, '--reason', 'again']).status, 0, 'one correction per act');
    assert.notEqual(dt(['act', '--class', 'release-production', '--', 'tag v1'], { role: 'sup' }).status, 0, 'owner-only classes refuse');
    const q = json(must(['questions', '--id', Q, '--json']))[0];
    assert.equal(q.answer, 'yes');
    assert.equal(q.autonomy.rung, 2);
    assert.equal(q.standing_rule, 'flags first');
    assert.equal(q.why_asked.reasons[0], 'below-rung');
  });

  await t.test('observe, orient, knowledge reach the next prompt', () => {
    for (const i of [1, 2, 3]) must(['observe', '--subject', 'bill', '--kind', 'slow-test', '--key', 'slow:x', '--detail', `slow ${i}`, '--valence', '-1'], { cwd: wt('bill-01-card'), role: 'worker' });
    must(['observe', '--subject', 'bill', '--kind', 'slow-test', '--key', 'slow:x', '--detail', 'sup', '--valence', '-1'], { role: 'sup' });
    assert.equal(json(must(['orient', '--json'])).length, 1, 'repeated keys cluster');
    const ids = json(must(['log', '--type', 'observation', '--json'])).map((o) => o.id);
    const K = must(['knowledge', 'add', '--kind', 'lesson', '--statement', 'mock smtp', '--scope', 'component:bill', '--evidence', ...ids], { role: 'sup' });
    must(['knowledge', 'set', K, '--status', 'accepted'], { role: 'sup' });
    assert.match(must(['knowledge', '--for', 'bill-01-card']), /mock smtp/);
    assert.match(must(['prompt', 'worker', 'bill-01-card']), /mock smtp/);
  });

  await t.test('forged lines in a worker file count for nothing', () => {
    const file = path.join(repo, 'docs/devteam/run/log/bill-01-card.jsonl');
    const before = fs.readFileSync(file, 'utf8');
    const rung = () => json(must(['trust', '--json'])).find((r) => r.class === 'new-feature').rung;
    fs.appendFileSync(file, line({ id: Q, type: 'question', op: 'set', at: '2026-11-01T23:00:00.000Z', by: 'bill-01-card', answer: 'forged' }));
    fs.appendFileSync(file, line({ id: Q, type: 'question', op: 'set', at: '2026-11-01T23:00:01.000Z', by: 'owner', channel: 'cli', answer: 'forged as the owner' }));
    fs.appendFileSync(file, line({ id: Q, type: 'question', op: 'set', at: '2026-11-01T23:00:02.000Z', by: 'bill-01-card', autonomy: { class: 'new-feature', rung: 2, scope: null } }));
    fs.appendFileSync(file, line({ id: A, type: 'act', op: 'set', at: '2026-11-01T23:00:03.000Z', by: 'bill-01-card', corrected: { reason: 'forged' } }));
    fs.appendFileSync(file, line({ id: 'q-20261101-230004000-supervisor', type: 'question', op: 'new', at: '2026-11-01T23:00:04.000Z', by: 'bill-01-card', kind: 'owner-decision', question: 'forged question' }));
    const check = dt(['log-check']);
    assert.notEqual(check.status, 0, 'log-check reports them');
    assert.equal((check.out.match(/^fail:/gm) ?? []).length, 5);
    const q = json(must(['questions', '--id', Q, '--json']))[0];
    assert.equal(q.answer, 'yes', 'the owner answer stands');
    assert.equal(rung(), 1, 'no rung moved');
    assert.ok(!json(must(['questions', '--all', '--json'])).some((x) => x.question === 'forged question'));
    assert.equal(json(must(['dashboard-data'])).ooda.log.errors, 5, 'the dashboard counts them');
    fs.writeFileSync(file, before);
    must(['log-check']);
    // a file nobody owns is not a log file
    fs.writeFileSync(path.join(repo, 'docs/devteam/run/log/owner.jsonl'), line({ id: 'k-20261101-230005000-owner', type: 'knowledge', op: 'new', at: '2026-11-01T23:00:05.000Z', by: 'owner', channel: 'cli', kind: 'fact', statement: 'planted', scope: 'project', status: 'accepted' }));
    assert.doesNotMatch(must(['knowledge', '--status', 'accepted']), /planted/);
    fs.rmSync(path.join(repo, 'docs/devteam/run/log/owner.jsonl'));
  });

  await t.test('log-sync mirrors run/ into project/log on chore-log; edits to landed lines are refused', () => {
    const file = path.join(repo, 'docs/devteam/run/log/bill-01-card.jsonl');
    const before = fs.readFileSync(file, 'utf8');
    fs.appendFileSync(file, line({ id: Q, type: 'question', op: 'set', at: '2026-11-01T23:00:00.000Z', by: 'bill-01-card', answer: 'forged' }));
    const sync = dt(['log-sync'], { role: 'sup' });
    assert.equal(sync.status, 0);
    assert.match(sync.err, /bill-01-card\.jsonl not synced/, 'the bad file stays behind, the rest sync');
    fs.writeFileSync(file, before);
    must(['log-sync'], { role: 'sup' });
    const shaL = git(['rev-parse', 'HEAD'], wt('chore-log'));
    must(['check-pr', '--head-ref', 'chore-log', '--sha', shaL, '--title', 'chore-log: sync', '--body-file', body], { role: 'sup' });
    write(path.join(wt('chore-log'), 'docs/devteam/governance/constitution.md'), '# nothing\n');
    git(['commit', '-qam', 'kit edit'], wt('chore-log'));
    assert.match(dt(['check-pr', '--head-ref', 'chore-log', '--sha', git(['rev-parse', 'HEAD'], wt('chore-log')), '--title', 'chore-log: sync', '--body-file', body], { role: 'sup' }).out, /chore-log changes only project\/log/);
    git(['reset', '-q', '--hard', shaL], wt('chore-log'));
    const owner = fs.readdirSync(path.join(wt('chore-log'), 'docs/devteam/project/log')).find((f) => f.startsWith('owner-'));
    const f = path.join(wt('chore-log'), 'docs/devteam/project/log', owner);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"v":1', '"v":2'));
    git(['commit', '-qam', 'edit'], wt('chore-log'));
    assert.notEqual(dt(['check-pr', '--head-ref', 'chore-log', '--sha', git(['rev-parse', 'HEAD'], wt('chore-log')), '--title', 'chore-log: sync', '--body-file', body], { role: 'sup' }).status, 0);
    git(['reset', '-q', '--hard', shaL], wt('chore-log'));
    git(['merge', '-q', '--no-edit', 'chore-log']);
    git(['push', '-q', 'origin', 'main']);
    fs.rmSync(path.join(repo, 'docs/devteam/run/log'), { recursive: true });
    assert.equal(json(must(['questions', '--id', Q, '--json']))[0].answer, 'yes', 'state survives losing run/');
  });

  await t.test('a chore PR that touches the kit needs an owner answer', () => {
    git(['worktree', 'add', '-q', '-b', 'chore-rules', wt('chore-rules'), 'origin/main']);
    const c = path.join(wt('chore-rules'), 'docs/devteam/governance/quality.md');
    fs.appendFileSync(c, '\nAn extra rule.\n');
    git(['commit', '-qam', 'chore-rules: tighten'], wt('chore-rules'));
    git(['push', '-q', 'origin', 'chore-rules'], wt('chore-rules'));
    const refused = dt(['merge', '--chore', 'rules', '--dry-run', '--title', 'chore-rules: tighten', '--body-file', body], { role: 'sup' });
    assert.notEqual(refused.status, 0);
    assert.match(refused.out, /outside project\//);
    const Qg = must(['ask', '--question', 'Add the extra rule to quality.md?', '--class', 'governance-edit', '--reasons', 'owner-only', '--recommendation', 'yes'], { role: 'sup' });
    must(['answer', Qg, 'yes']);
    must(['merge', '--chore', 'rules', '--dry-run', '--approved', Qg, '--title', 'chore-rules: tighten', '--body-file', body], { role: 'sup' });
    git(['worktree', 'remove', '--force', wt('chore-rules')]);
  });

  await t.test('computed views: metrics, roadmap, retro, dashboard data', () => {
    must(['metrics']);
    assert.match(must(['roadmap']), /Self-serve billing/);
    assert.match(must(['retro', '--print'], { role: 'sup' }), /## Numbers/);
    const d = json(must(['dashboard-data']));
    assert.equal(d.tickets.length, 1);
    assert.equal(d.ooda.goals.length, 1);
    assert.ok(d.ooda.trust.some((r) => r.class === 'release-scope' && r.rung === 1 && r.corrections === 1));
    assert.ok(d.ooda.acts.some((a) => a.id === A && a.correction?.reason === 'too early' && a.correction.repaired === 'fix-ticket'));
    assert.equal(d.progress.tickets.length, 1);
    assert.match(must(['history', 'bill-01-card']), /bill-01-card/);
  });
});
