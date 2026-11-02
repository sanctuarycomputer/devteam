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
// tmux in this test talks to its own server, never the developer's (or a live fleet's) sessions.
process.env.TMUX_TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-tmux-'));
delete process.env.TMUX;
delete process.env.TMUX_PANE;
const hasTmux = spawnSync('tmux', ['-V']).status === 0;

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
// Owner settings apply as they are on main, so a test that changes them lands the change there.
const landSettings = (edit) => {
  const f = path.join(repo, 'docs/devteam/project/settings.md');
  fs.writeFileSync(f, edit(fs.readFileSync(f, 'utf8')));
  git(['commit', '-qm', 'settings', '--', 'docs/devteam/project/settings.md']);
  git(['push', '-q', 'origin', 'HEAD:main']);
};
const body = path.join(tmp, 'body.md');
write(body, '## One-way doors\n\nNone.\n');

test('devteam kit', async (t) => {
  let G, Q, A, SHA1, H2;
  t.after(() => {
    spawnSync('tmux', ['kill-server']);
    fs.rmSync(process.env.TMUX_TMPDIR, { recursive: true, force: true });
    if (!process.env.DEVTEAM_TEST_KEEP) fs.rmSync(tmp, { recursive: true, force: true }); else console.log(`fixture kept at ${tmp}`);
  });

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
    assert.match(dt(['goal', 'approve', G]).err, /no design up for approval/, 'a goal is approved on its design, not before');
    const design = [{ title: 'The approach', path: 'docs/devteam/project/designs/self-serve-billing.md', ref: 'plan/billing' }];
    assert.match(dt(['ask', '--kind', 'goal-approval', '--goal', G, '--question', 'Approve self-serve billing?'], { role: 'sup' }).err, /links the design/);
    // the design's open decisions are asked one by one first; the approval waits for them
    const D1 = must(['ask', '--kind', 'one-way-door', '--goal', G, '--question', 'Who may see card details?', '--recommendation', 'admins only'], { role: 'sup' });
    assert.match(dt(['ask', '--kind', 'goal-approval', '--goal', G, '--question', 'Approve?', '--links', JSON.stringify(design)], { role: 'sup' }).err, /still has open questions about its design/);
    must(['answer', D1, 'admins only']);
    // the design gives the goal its milestones before the owner sees it; the forecast rides along
    assert.match(dt(['ask', '--kind', 'goal-approval', '--goal', G, '--question', 'Approve?', '--links', JSON.stringify(design)], { role: 'sup' }).err, /no milestones/);
    must(['goal', 'set', G, '--milestones', JSON.stringify([{ title: 'Cards', target: 90, preconditions: [1], tickets: 4 }, { title: 'Prices', target: 80, preconditions: [1, 2], tickets: 6 }])], { role: 'sup' });
    const bad = must(['goal', 'check', G]);
    assert.match(bad, /milestone 2's target 80 does not move the measure up from 90/);
    assert.match(bad, /precondition 1 is in milestones 1 and 2/);
    must(['goal', 'set', G, '--milestones', JSON.stringify([{ title: 'Cards on file', target: 40, by: '2027-01-31', preconditions: [1], tickets: 4 }, { title: 'Self-serve prices', target: 80, preconditions: [2], tickets: 6 }])], { role: 'sup' });
    assert.doesNotMatch(must(['goal', 'check', G]), /^  milestones:/m);
    assert.match(must(['goal', 'forecast', G]), /1\. Cards on file: 40 % by 2027-01-31; about 4 tickets, unplanned; 1 waves to here at 5 slots[\s\S]*no measured rate yet/);
    const A1 = must(['ask', '--kind', 'goal-approval', '--goal', G, '--question', 'Approve self-serve billing, built as the design describes?', '--links', JSON.stringify(design)], { role: 'sup' });
    assert.match(json(must(['questions', '--id', A1, '--json']))[0].context, /Forecast \(computed\)/, 'the approval carries the forecast');
    assert.match(dt(['answer', A1, 'Approve']).err, /goal decide/, 'answered only as a goal decision');
    assert.match(dt(['goal', 'decide', G, 'refine']).err, /needs --notes/);
    must(['goal', 'decide', G, 'refine', '--notes', 'start with cards only; no invoices']);
    let gv = json(must(['goal', 'show', G, '--json']));
    assert.equal(gv.status, 'draft');
    assert.deepEqual(gv.decision, { verdict: 'refine', notes: 'start with cards only; no invoices', question: A1 });
    assert.equal(json(must(['questions', '--id', A1, '--json']))[0].answer, 'Refine — start with cards only; no invoices');
    const A2 = must(['ask', '--kind', 'goal-approval', '--goal', G, '--question', 'Approve the reworked billing design?', '--links', JSON.stringify(design)], { role: 'sup' });
    // the gate is at asking: an approval already in the owner's inbox stays answerable even if the
    // goal's milestones are incomplete (an approval asked before milestones were required)
    const msBefore = json(must(['goal', 'show', G, '--json'])).milestones;
    must(['goal', 'set', G, '--milestones', '[]'], { role: 'sup' });
    assert.match(must(['goal', 'check', G]), /no milestones/);
    must(['goal', 'decide', G, 'approve', '--notes', 'ship cards first']);
    must(['goal', 'set', G, '--milestones', JSON.stringify(msBefore), '--owner']);
    gv = json(must(['goal', 'show', G, '--json']));
    assert.equal(gv.status, 'ready');
    assert.equal(gv.decision.question, A2);
    assert.equal(json(must(['questions', '--id', A2, '--json']))[0].status, 'answered');
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
    assert.ok(!fs.readdirSync(path.join(repo, 'docs/devteam/run/log')).some((f) => f === 'plan-billing.jsonl'), 'the graph is not in run/log');
    // the planner's messages are live, so the supervisor sees them before the plan lands
    must(['send', 'supervisor', 'graph ready for review', '--kind', 'review-request'], { cwd: wt('plan-billing'), role: 'planner' });
    assert.match(must(['messages', '--to', 'supervisor']), /graph ready for review/);
    assert.ok(fs.readdirSync(path.join(repo, 'docs/devteam/run/log')).some((f) => /^plan-billing-\d{4}-\d{2}\.jsonl$/.test(f)));
    assert.doesNotMatch(must(['status']), /bill-01/, 'main does not see an unlanded plan');
    assert.notEqual(dt(['validate', '--strict'], { cwd: wt('plan-billing') }).status, 0, 'strict validate fails without reviews');
    // a feature's own design builds on the goal's design and cites it
    const pw = { cwd: wt('plan-billing'), role: 'planner' };
    write(path.join(wt('plan-billing'), 'docs/devteam/project/designs/billing-cards.md'), '# Cards\n');
    must(['feature', 'set', 'billing', '--json', '{"design":"project/designs/billing-cards.md"}'], pw);
    assert.match(dt(['validate'], { cwd: wt('plan-billing') }).out, /does not cite its goal's design \(designs\/self-serve-billing\.md\)/);
    write(path.join(wt('plan-billing'), 'docs/devteam/project/designs/billing-cards.md'), '# Cards\n\nBuilds on the goal design: designs/self-serve-billing.md.\n');
    assert.doesNotMatch(dt(['validate'], { cwd: wt('plan-billing') }).out, /does not cite/);
    must(['feature', 'set', 'billing', '--json', '{"design":"project/designs/self-serve-billing.md"}'], pw);
    // planning a later milestone while an earlier one is current is a warning
    must(['feature', 'set', 'billing', '--json', JSON.stringify({ preconditions: [`${G}#2`] })], pw);
    assert.match(dt(['validate'], { cwd: wt('plan-billing') }).out, /serves only milestone 2 .* milestone 1 is current/);
    must(['feature', 'set', 'billing', '--json', JSON.stringify({ preconditions: [`${G}#1`] })], pw);
    fs.rmSync(path.join(wt('plan-billing'), 'docs/devteam/project/designs/billing-cards.md'));
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
    // milestone 1 is planned; milestone 2's precondition waits for it rather than counting as a gap
    const gc = must(['goal', 'check', G]);
    assert.doesNotMatch(gc, /precondition 2 .* has no feature/);
    assert.match(gc, /later milestones: precondition 2 are planned once milestone 1 is met/);
    const rm = must(['roadmap']);
    assert.match(rm, /milestone 1 \[current\] Cards on file/);
    assert.match(rm, /milestone 2 \[later\] Self-serve prices .*about 6 tickets, unplanned/);
  });

  await t.test('a held ticket is left out of ready and idle capacity until released', () => {
    must(['ticket', 'set', 'bill-01-card', '--json', '{"held": "may duplicate the existing CI"}'], { role: 'sup' });
    const r = json(must(['ready', '--json']));
    assert.deepEqual(r.ready.map((x) => x.id), [], 'held is not ready');
    assert.deepEqual(r.held, [{ id: 'bill-01-card', held: 'may duplicate the existing CI' }]);
    assert.ok(!json(must(['metrics', '--json'])).findings.some((f) => f.kind === 'idle-capacity'), 'no idle-capacity finding for a held ticket');
    assert.equal(json(must(['dashboard-data'])).progress.tickets.find((x) => x.id === 'bill-01-card').held, 'may duplicate the existing CI');
    must(['ticket', 'set', 'bill-01-card', '--json', '{"held": null}'], { role: 'sup' });
    assert.match(must(['ready']), /bill-01-card/);
    must(['validate']);
    // any finding can be set aside for a while, by the supervisor or the owner, and stays visible
    const idle = json(must(['metrics', '--json'])).findings.find((f) => f.kind === 'idle-capacity');
    assert.ok(idle, 'released, it is idle capacity again');
    assert.notEqual(dt(['ack', 'idle-capacity', 'no such subject', '--reason', 'x'], { role: 'sup' }).status, 0, 'only a current finding');
    assert.notEqual(dt(['ack', 'idle-capacity', idle.subject, '--reason', 'x', '--owner'], { role: 'sup' }).status, 0, '--owner refuses in an agent session');
    must(['ack', 'idle-capacity', idle.subject, '--reason', 'starting it after the plan lands', '--owner']);
    const m = json(must(['metrics', '--json']));
    assert.ok(!m.findings.some((f) => f.kind === 'idle-capacity'), 'set aside');
    assert.equal(m.acknowledged.find((f) => f.kind === 'idle-capacity').ack.by, 'owner', 'and still listed, with who and why');
    // the owner can message a session as themselves
    must(['send', 'supervisor', 'take the afternoon off', '--owner']);
    const msg = json(must(['messages', '--to', 'supervisor', '--json'])).pop();
    assert.equal(msg.created_by, 'owner');
    assert.notEqual(dt(['send', 'supervisor', 'merge it', '--owner', '--kind', 'ruling']).status, 0, 'the owner sends info only');
    assert.notEqual(dt(['send', 'supervisor', 'hi', '--owner'], { role: 'sup' }).status, 0, '--owner refuses in an agent session');
  });

  await t.test('worker: phases, gates, approvals, check-ticket at an exact head', () => {
    git(['worktree', 'add', '-q', '-b', 'ticket/bill-01-card', wt('bill-01-card'), 'origin/main']);
    const w = { cwd: wt('bill-01-card'), role: 'worker' };
    must(['phase', 'spec', '--usd', '0.5'], w);
    must(['phase', 'spec'], w);
    must(['phase', 'build', '--task', 'T1', '--usd', '2'], w);
    assert.equal(json(must(['log', '--type', 'phase', '--by', 'bill-01-card', '--json'])).length, 2, 'an unchanged phase within 15 min is not written');
    assert.doesNotMatch(must(['ready']), /bill-01/, 'a ticket with an active worker is not ready');
    // a parked ticket waits on a ruling, not a new worker: not ready, not idle capacity
    const w0 = { cwd: wt('bill-01-card'), role: 'worker' };
    must(['phase', 'parked'], w0);
    const rp = json(must(['ready', '--json']));
    assert.ok(!rp.ready.some((x) => x.id === 'bill-01-card'));
    assert.deepEqual(rp.waiting, [{ id: 'bill-01-card', why: 'parked' }]);
    assert.ok(!json(must(['metrics', '--json'])).findings.some((f) => f.kind === 'idle-capacity'), 'no "make a worker" for a parked ticket');
    must(['phase', 'build', '--task', 'T1'], w0);
    // a worker waiting on the owner's answer to a question that blocks it is waiting, not stale
    const sfile = path.join(repo, 'docs/devteam/project/settings.md');
    const sbefore = fs.readFileSync(sfile, 'utf8');
    fs.writeFileSync(sfile, sbefore.replace('"gates": {', '"stale_after_minutes": -1, "gates": {'));
    const staleW = () => json(must(['metrics', '--json'])).findings.some((f) => f.kind === 'stale-worker' && f.subject === 'bill-01-card');
    assert.ok(staleW(), 'silent past the threshold and waiting on nobody: stale');
    const Qb = must(['ask', '--question', 'Store card fingerprints?', '--blocks', 'bill-01-card', '--recommendation', 'no'], { role: 'sup' });
    assert.ok(!staleW(), 'a question blocking it means it waits on the owner');
    must(['withdraw', Qb, '--reason', 'test'], { role: 'sup' });
    fs.writeFileSync(sfile, sbefore);
    // a worker frozen on a permission prompt looks busy in the log; its pane says otherwise
    if (hasTmux) {
      spawnSync('tmux', ['new-session', '-d', '-s', 'devteam', '-n', 'bill-01-card', 'sh -c \'printf "Bash command\\n  rm -rf build\\nDo you want to proceed?\\n> 1. Yes\\n  2. No\\n"; exec sleep 600\'']);
      for (let i = 0; i < 20 && !/proceed/.test(spawnSync('tmux', ['capture-pane', '-p', '-t', 'devteam:bill-01-card'], { encoding: 'utf8' }).stdout ?? ''); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      const f = json(must(['metrics', '--json'])).findings.find((x) => x.kind === 'blocked-prompt');
      assert.equal(f?.subject, 'bill-01-card', 'a blocked-prompt finding names the ticket');
      assert.match(f.detail, /Do you want to proceed\?/);
      assert.equal(json(must(['dashboard-data'])).progress.tickets.find((x) => x.id === 'bill-01-card').waiting.kind, 'prompt', 'the board can badge it');
      assert.match(must(['status']), /bill-01-card.*WAITING ON A PROMPT/);
      spawnSync('tmux', ['kill-server']);
      assert.ok(!json(must(['metrics', '--json'])).findings.some((x) => x.kind === 'blocked-prompt'), 'no pane, no finding');
    } else t.diagnostic('tmux not installed: blocked-prompt detection not exercised');
    assert.match(dt(['phase', 'awaiting-word'], w).err, /no open request/, 'waiting with nothing asked warns');
    must(['send', 'supervisor', 'spec and plan reviewed; approve please', '--kind', 'review-request'], w);
    assert.doesNotMatch(dt(['phase', 'awaiting-word', '--note', 'asked'], w).err, /no open request/);
    must(['gate', 'test', '--', 'true'], w);
    assert.notEqual(dt(['gate', 'lint', '--', 'false'], w).status, 0, 'gate passes the exit status through');
    // a TDD red then green at the same HEAD with uncommitted work is not flakiness
    write(path.join(wt('bill-01-card'), 'billing/wip.test.js'), 'red\n');
    dt(['gate', 'tdd', '--', 'false'], w);
    must(['gate', 'tdd', '--', 'true'], w);
    fs.rmSync(path.join(wt('bill-01-card'), 'billing/wip.test.js'));
    assert.ok(!json(must(['metrics', '--json'])).gates.flaky_gates.some((g) => g.gate === 'tdd'), 'dirty runs are not flaky');
    assert.notEqual(dt(['act', '--class', 'approve-spec', '--refs', 'm-20261101-000000000-bill-01-card', '--', 'spec ok'], { role: 'sup' }).status, 0, 'an approval names its ticket');
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
    // an escaped pipe inside a cell does not shift the Disposition column
    const piped = (disp) => `- Reviewer: reviewer-c\n\n| Id | Severity | Rule | Where | Finding | Disposition |\n|---|---|---|---|---|---|\n| F1 | Important | spec | a.rb:1 | \`find_each { \\|u\\| u }\` locks out | ${disp} |\n\nVerdict: APPROVE ${H2}\n`;
    write(path.join(tdir, 'reviews/final-1b.md'), piped('fixed'));
    git(['add', '-A'], wt('bill-01-card'));
    git(['commit', '-qm', 'piped review'], wt('bill-01-card'));
    must(['check-ticket', 'bill-01-card', '--sha', git(['rev-parse', 'HEAD'], wt('bill-01-card')), ...pr]);
    write(path.join(tdir, 'reviews/final-1b.md'), piped(''));
    git(['commit', '-qam', 'piped review, no disposition'], wt('bill-01-card'));
    const undisposed = dt(['check-ticket', 'bill-01-card', '--sha', git(['rev-parse', 'HEAD'], wt('bill-01-card')), ...pr]);
    assert.notEqual(undisposed.status, 0);
    assert.match(undisposed.out, /final-1b\.md F1 \(Important\) has no disposition/);
    git(['reset', '-q', '--hard', H2], wt('bill-01-card'));
    // a clean merge of main keeps the verdict: the ticket's own change is byte-identical to the reviewed one
    git(['worktree', 'add', '-q', '--detach', wt('main-moves'), 'origin/main']);
    write(path.join(wt('main-moves'), 'OTHER.md'), 'someone else\'s work\n');
    git(['add', '-A'], wt('main-moves'));
    git(['commit', '-qm', 'other work lands on main'], wt('main-moves'));
    git(['push', '-q', 'origin', 'HEAD:main'], wt('main-moves'));
    git(['worktree', 'remove', '--force', wt('main-moves')]);
    git(['fetch', '-q', 'origin']);
    git(['merge', '-q', '--ff-only', 'origin/main']);
    git(['fetch', '-q', 'origin'], wt('bill-01-card'));
    git(['merge', '-q', '--no-edit', 'origin/main'], wt('bill-01-card'));
    must(['check-ticket', 'bill-01-card', '--sha', git(['rev-parse', 'HEAD'], wt('bill-01-card')), ...pr]);
    // a merge that also changes the work (as a conflict fix might) voids it
    fs.appendFileSync(path.join(wt('bill-01-card'), 'billing/card.js'), 'resolved differently\n');
    git(['commit', '-q', '--amend', '-a', '--no-edit'], wt('bill-01-card'));
    assert.match(dt(['check-ticket', 'bill-01-card', '--sha', git(['rev-parse', 'HEAD'], wt('bill-01-card')), ...pr]).out, /does not hold|not at this head|review again|no final review/i, 'a merge that changes the work needs a new review');
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
    landSettings((txt) => txt.replace('"gates": {}', '"gates": { "test": "test -f billing/card.js && test -f config/master.key && test -f .setup-ran", "lint": { "cmd": "true" }, "web": { "cmd": "false", "paths": ["web/**"] } }, "worktree_files": ["config/master.key"], "worktree_setup": "touch .setup-ran"'));
    write(path.join(repo, 'config/master.key'), 'secret\n');
    fs.appendFileSync(path.join(repo, '.gitignore'), 'config/master.key\n');
    must(['merge', 'bill-01-card', '--dry-run', '--title', 'bill-01-card: card capture', '--body-file', body], { role: 'sup' });
    const gates = json(must(['log', '--type', 'gate', '--by', 'supervisor', '--json']));
    // web is skipped: the PR changes nothing under web/
    assert.deepEqual(gates.map((g) => g.gate).sort(), ['lint', 'test']);
    assert.ok(gates.every((g) => g.ok && g.sha === H2));
    // a gate edited in the main checkout but not landed doesn't count: owner settings apply as on main
    const sf = path.join(repo, 'docs/devteam/project/settings.md');
    const landed = fs.readFileSync(sf, 'utf8');
    fs.writeFileSync(sf, landed.replace('"test": "test -f billing/card.js && test -f config/master.key && test -f .setup-ran"', '"test": "true"'));
    const local = dt(['merge', 'bill-01-card', '--dry-run', '--title', 'bill-01-card: card capture', '--body-file', body], { role: 'sup' });
    assert.equal(local.status, 0);
    assert.match(local.err, /owner settings apply as they are on origin\/main/);
    fs.writeFileSync(sf, landed);
    landSettings((txt) => txt.replace('"test": "test -f billing/card.js && test -f config/master.key && test -f .setup-ran"', '"test": "false"'));
    const failed = dt(['merge', 'bill-01-card', '--dry-run', '--title', 'bill-01-card: card capture', '--body-file', body], { role: 'sup' });
    assert.notEqual(failed.status, 0);
    assert.match(failed.out, /gate test failed/);
    assert.ok(!fs.readdirSync(path.join(repo, '.worktrees')).some((d) => d.startsWith('tmp-')), 'no temp worktree left behind');
    landSettings((txt) => txt.replace('"test": "false"', '"test": "test -f billing/card.js && test -f config/master.key && test -f .setup-ran"'));
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
    assert.notEqual(dt(['act', '--class', 'gate-change', '--', 'drop a gate'], { role: 'sup' }).status, 0, 'owner-only classes refuse');
    // production releases are on the ladder: asked at rung 1, released and reported once the owner moves it to 3
    assert.equal(dt(['act', '--class', 'release-production', '--', 'tag v1'], { role: 'sup' }).status, 3, 'rung 1: ask first');
    const Qr = must(['ask', '--class', 'release-production', '--reasons', 'below-rung', '--question', 'Ship v1 to production?', '--recommendation', 'yes'], { role: 'sup' });
    must(['answer', Qr, 'yes', '--autonomy', '3']);
    must(['act', '--class', 'release-production', '--approved', Qr, '--', 'released v1'], { role: 'sup' });
    must(['act', '--class', 'release-production', '--', 'released v1.0.1, gates green at the tag'], { role: 'sup' });
    const q = json(must(['questions', '--id', Q, '--json']))[0];
    assert.equal(q.answer, 'yes');
    assert.equal(q.autonomy.rung, 2);
    assert.equal(q.standing_rule, 'flags first');
    assert.equal(q.why_asked.reasons[0], 'below-rung');
    assert.equal(q.channel, 'cli', 'an answer records where the owner typed it');
  });

  await t.test('an answer the owner gave in the supervisor chat: the owner\'s, quoted, listed for checking, never trust evidence', () => {
    const said = "you shouldn't need to ask me to submit those PRs";
    const Qc = must(['ask', '--question', 'Open upstream PRs without asking?', '--class', 'upstream-pr', '--reasons', 'below-rung', '--recommendation', 'yes'], { role: 'sup' });
    assert.notEqual(dt(['answer', Qc, 'yes', '--from-chat'], { role: 'sup' }).status, 0, "the owner's words are required");
    assert.notEqual(dt(['answer', Qc, 'yes', '--from-chat', '--said', said], { role: 'worker' }).status, 0, 'only the supervisor records a chat answer');
    assert.notEqual(dt(['answer', Qc, 'yes', '--from-chat', '--said', said]).status, 0, 'in their own terminal the owner answers directly');
    assert.match(dt(['answer', Qc, 'yes', '--autonomy', '3', '--from-chat', '--said', said], { role: 'sup' }).err, /not raise/, 'the supervisor cannot raise its own rung from chat');
    const Qd = must(['ask', '--question', 'Ship the schema migration?', '--kind', 'one-way-door', '--class', 'one-way-door', '--reasons', 'one-way-door', '--recommendation', 'yes'], { role: 'sup' });
    assert.match(dt(['answer', Qd, 'yes', '--from-chat', '--said', 'sure'], { role: 'sup' }).err, /reserved to the owner/, 'a one-way door is never answered from chat');
    must(['withdraw', Qd, '--reason', 'test'], { role: 'sup' });
    must(['answer', Qc, 'yes', '--from-chat', '--said', said], { role: 'sup' });
    const q = json(must(['questions', '--id', Qc, '--json']))[0];
    assert.equal(q.answered_by, 'owner');
    assert.equal(q.channel, 'chat');
    assert.equal(q.said, said);
    const tr = json(must(['trust', '--json'])).find((r) => r.class === 'upstream-pr');
    assert.equal(tr.rung, 1, 'a chat answer leaves the rung where the owner put it');
    assert.ok(!tr.agreement_questions.includes(Qc), 'a chat answer is not agreement evidence');
    const listed = json(must(["dashboard-data"])).ooda.answered.find((x) => x.id === Qc);
    assert.equal(listed?.channel, 'chat', 'the dashboard lists it for the owner to check');
    assert.equal(listed.said, said);
    must(['act', '--class', 'upstream-pr', '--approved', Qc, '--', 'opened an upstream PR'], { role: 'sup' });
  });

  await t.test('questions carry choices, links and owner actions; a ticket has a timeline', () => {
    const choices = [{ label: 'Publish now', detail: 'Freeze the format as 1.0.', effect: 'Mobile sign-in ships next week.' }, { label: 'Wait a release', detail: 'Keep it internal.' }];
    const links = [{ title: 'The spec', path: 'docs/devteam/project/tickets/bill-01-card/spec.md', ref: 'ticket/bill-01-card' }];
    const Qc = must(['ask', '--question', 'Let other apps rely on the token format?', '--choices', JSON.stringify(choices), '--links', JSON.stringify(links), '--recommendation', 'Publish now', '--confidence', '0.8', '--ticket', 'bill-01-card'], { role: 'sup' });
    const q = json(must(['questions', '--id', Qc, '--json']))[0];
    assert.deepEqual(q.choices, choices);
    assert.deepEqual(q.links, links);
    assert.notEqual(dt(['ask', '--question', 'x', '--links', '[{"title":"bad","path":"../etc/passwd"}]'], { role: 'sup' }).status, 0, 'a link never leaves the repo');
    must(['answer', Qc, 'Publish now — after the security review']);
    assert.equal(json(must(['questions', '--id', Qc, '--json']))[0].matched, true, 'a choice with a note still agrees with the recommendation');
    const Qa = must(['ask', '--kind', 'owner-action', '--question', 'Log in to Heroku in the main checkout', '--context', 'Run heroku login; the deploy check needs it.'], { role: 'sup' });
    assert.equal(json(must(['questions', '--id', Qa, '--json']))[0].kind, 'owner-action');
    must(['withdraw', Qa, '--reason', 'test'], { role: 'sup' });
    const tl = json(must(['timeline', 'bill-01-card', '--json']));
    assert.equal(tl.ticket.id, 'bill-01-card');
    assert.ok(tl.lines.some((l) => l.type === 'question' && l.id === Qc), 'the question about it');
    assert.ok(tl.lines.some((l) => l.type === 'question' && l.id === Qc && l.answer), 'and its answer, which names only the question');
    assert.ok(tl.lines.some((l) => l.type === 'phase'), "its worker's phases");
    assert.ok(tl.lines.some((l) => l.type === 'act'), 'acts that name it');
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
    // While its PR is open, the next sync extends chore-log, so a forge refusing force pushes accepts it.
    const first = git(['rev-parse', 'HEAD'], wt('chore-log'));
    git(['config', 'receive.denyNonFastForwards', 'true'], origin);
    // main moves meanwhile; the extended branch takes it in, so its PR is never behind
    git(['worktree', 'add', '-q', '--detach', wt('mover'), 'origin/main']);
    write(path.join(wt('mover'), 'MOVED.md'), 'main moved\n');
    git(['add', '-A'], wt('mover'));
    git(['commit', '-qm', 'main moves'], wt('mover'));
    git(['push', '-q', 'origin', 'HEAD:main'], wt('mover'));
    git(['worktree', 'remove', '--force', wt('mover')]);
    must(['observe', '--subject', 'bill-01-card', '--kind', 'note', '--detail', 'second sync'], { role: 'sup' });
    must(['log-sync'], { role: 'sup' });
    git(['fetch', '-q', 'origin']);
    git(['merge-base', '--is-ancestor', first, 'origin/chore-log']);
    git(['merge-base', '--is-ancestor', 'origin/main', 'origin/chore-log']);
    assert.notEqual(git(['rev-parse', 'origin/chore-log']), first, 'the second sync landed on top of the first');
    // squash-merged and deleted: the stale origin/chore-log is dropped and the next sync starts from main
    git(['config', 'receive.denyNonFastForwards', 'false'], origin);
    git(['worktree', 'add', '-q', '--detach', wt('squash'), 'origin/main']);
    git(['merge', '--squash', '-q', 'origin/chore-log'], wt('squash'));
    git(['commit', '-qm', 'chore-log: squashed'], wt('squash'));
    git(['push', '-q', 'origin', 'HEAD:main'], wt('squash'));
    git(['worktree', 'remove', '--force', wt('squash')]);
    git(['push', '-q', 'origin', '--delete', 'chore-log']);
    must(['observe', '--subject', 'bill-01-card', '--kind', 'note', '--detail', 'third sync'], { role: 'sup' });
    must(['log-sync'], { role: 'sup' });
    git(['fetch', '-q', 'origin']);
    assert.equal(git(['rev-parse', 'origin/chore-log^']), git(['rev-parse', 'origin/main']), 'after a squash merge the next sync is one commit on main, not the old branch');
    const addedLines = git(['diff', '--unified=0', 'origin/main', 'origin/chore-log']).split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    assert.equal(addedLines.length, 1, 'and carries only the new line');
    assert.match(addedLines[0], /third sync/);
    git(['config', 'receive.denyNonFastForwards', 'false'], origin);
    const shaL = git(['rev-parse', 'HEAD'], wt('chore-log'));
    const syncWt = must(['chore', 'start', 'devteam-sync-v0.2.1'], { role: 'sup' }).trim();
    assert.ok(fs.existsSync(syncWt), 'a sync chore is named by its tag (supervisor.md §9)');
    assert.ok(fs.existsSync(path.join(syncWt, 'config/master.key')) && fs.existsSync(path.join(syncWt, '.setup-ran')), 'chore start seeds worktree_files and runs worktree_setup, so gates run there');
    git(['worktree', 'remove', '--force', wt('chore-devteam-sync-v0.2.1')]);
    for (const bad of ['../escape', 'x.lock', 'a..b', 'Upper']) assert.match(dt(['chore', 'start', bad], { role: 'sup' }).err, /chore slug/, `chore start refuses ${bad}`);
    assert.match(dt(['chore', 'pr', '../escape', '--title', 't'], { role: 'sup' }).err, /chore slug/, 'chore pr checks the slug too');
    assert.match(dt(['merge', '--chore', '../escape', '--dry-run'], { role: 'sup' }).err, /chore slug/, 'merge --chore checks the slug too');
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

  await t.test('a PR of any kind that changes owner settings needs an answered question of that class', () => {
    const setTo = (w, fn) => {
      const f = path.join(w, 'docs/devteam/project/settings.md');
      const txt = fs.readFileSync(f, 'utf8');
      const m = txt.match(/```json devteam\s*\n([\s\S]*?)\n```/);
      const j = JSON.parse(m[1]);
      fn(j);
      fs.writeFileSync(f, txt.replace(m[1], JSON.stringify(j, null, 2)));
    };
    // a chore that only changes the supervisor's own settings needs no answer
    git(['worktree', 'add', '-q', '-b', 'chore-caps', wt('caps'), 'origin/main']);
    setTo(wt('caps'), (j) => { j.max_active_tickets = 3; });
    git(['commit', '-qam', 'caps'], wt('caps'));
    git(['push', '-q', 'origin', 'chore-caps'], wt('caps'));
    must(['merge', '--chore', 'caps', '--dry-run', '--title', 'chore-caps: fewer workers', '--body-file', body], { role: 'sup' });
    // a gate change is the owner's, even in a chore (project/ files are otherwise the supervisor's)
    setTo(wt('caps'), (j) => { j.gates = { ...(j.gates ?? {}), lint: 'true' }; j.upstream_repo = 'someone/fork'; });
    git(['commit', '-qam', 'gates'], wt('caps'));
    git(['push', '-q', 'origin', 'chore-caps'], wt('caps'));
    const args = ['merge', '--chore', 'caps', '--dry-run', '--title', 'chore-caps: gates', '--body-file', body];
    const r = dt(args, { role: 'sup' });
    assert.notEqual(r.status, 0);
    assert.match(r.out + r.err, /changes owner settings: gates \(gate-change\), upstream_repo \(governance-edit\)/);
    const Qw = must(['ask', '--question', 'Fewer workers?', '--class', 'priority-change', '--reasons', 'below-rung', '--recommendation', 'yes'], { role: 'sup' });
    must(['answer', Qw, 'yes']);
    assert.match(dt([...args, '--approved', Qw], { role: 'sup' }).out, /needs an answered gate-change or governance-edit question/, 'an answer of another class does not cover it');
    const Qgate = must(['ask', '--question', 'Add a lint gate and move upstream?', '--class', 'governance-edit', '--reasons', 'owner-only', '--recommendation', 'yes'], { role: 'sup' });
    must(['answer', Qgate, 'yes']);
    must([...args, '--approved', Qgate], { role: 'sup' });
    git(['worktree', 'remove', '--force', wt('caps')]);
  });

  await t.test('a standing owner rule approves upstream syncs, only when the kit files are upstream\'s verbatim', () => {
    // an upstream with a tagged release that changes one kit file
    const up = path.join(tmp, 'upstream');
    fs.mkdirSync(up);
    git(['init', '-q', '-b', 'main'], up);
    git(['config', 'user.email', 't@t'], up);
    git(['config', 'user.name', 't'], up);
    fs.cpSync(path.join(repo, 'docs/devteam'), path.join(up, 'docs/devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(path.join(repo, 'docs/devteam').length)) });
    fs.appendFileSync(path.join(up, 'docs/devteam/governance/quality.md'), '\nUpstream rule.\n');
    git(['add', '-A'], up);
    git(['commit', '-qm', 'release'], up);
    git(['tag', 'v0.3.0'], up);
    landSettings((txt) => txt.replace('"gates": {', `"upstream_repo": ${JSON.stringify(up)}, "gates": {`));
    // the sync chore copies that file verbatim (the dashed slug older kits needed resolves to the tag)
    git(['worktree', 'add', '-q', '-b', 'chore-devteam-sync-v0-3-0', wt('sync'), 'origin/main']);
    fs.copyFileSync(path.join(up, 'docs/devteam/governance/quality.md'), path.join(wt('sync'), 'docs/devteam/governance/quality.md'));
    git(['commit', '-qam', 'sync'], wt('sync'));
    git(['push', '-q', 'origin', 'chore-devteam-sync-v0-3-0'], wt('sync'));
    const args = ['merge', '--chore', 'devteam-sync-v0-3-0', '--dry-run', '--title', 'chore-devteam-sync-v0-3-0: adopt', '--body-file', body];
    assert.match(dt(args, { role: 'sup' }).out, /outside project\//, 'no standing rule yet: the owner answers each sync');
    // a rule the supervisor wrote and accepted itself doesn't count, only the owner's
    const Ks = must(['knowledge', 'add', '--kind', 'preference', '--statement', 'adopt upstream', '--scope', 'chore:devteam-sync'], { role: 'sup' });
    must(['knowledge', 'set', Ks, '--status', 'accepted'], { role: 'sup' });
    assert.match(dt(args, { role: 'sup' }).out, /outside project\//, "the supervisor can't grant itself standing approval");
    // a rule given on an unscoped question applies to the project, not to syncs; the supervisor can't
    // re-scope the owner's rule, the owner can
    const Qp = must(['ask', '--question', 'Adopt this release?', '--class', 'process-edit', '--reasons', 'owner-only', '--recommendation', 'yes'], { role: 'sup' });
    must(['answer', Qp, 'yes', '--rule', 'auto-adopt future releases']);
    const Kp = json(must(['knowledge', '--json'])).find((k) => k.statement === 'auto-adopt future releases');
    assert.equal(Kp.scope, 'project');
    assert.match(dt(args, { role: 'sup' }).out, /outside project\//, 'a project-wide rule is not a sync approval');
    must(['knowledge', 'set', Kp.id, '--scope', 'chore:devteam-sync'], { role: 'sup' });
    assert.match(dt(args, { role: 'sup' }).out, /outside project\//, "the supervisor can't re-scope the owner's rule");
    must(['knowledge', 'set', Kp.id, '--scope', 'chore:devteam-sync', '--owner']);
    assert.match(must(args, { role: 'sup' }), /match upstream v0\.3\.0 exactly/, 'the owner can');
    must(['knowledge', 'set', Kp.id, '--status', 'retired', '--owner']);
    assert.match(dt(args, { role: 'sup' }).out, /outside project\//, 'retired, it approves nothing');
    // the sync question names the scope, so a rule from the dashboard (no scope of its own) lands there
    const Qs = must(['ask', '--question', 'Adopt upstream releases without asking each time?', '--class', 'process-edit', '--reasons', 'owner-only', '--recommendation', 'yes', '--rule-scope', 'chore:devteam-sync'], { role: 'sup' });
    assert.equal(json(must(['questions', '--id', Qs, '--json']))[0].rule_scope, 'chore:devteam-sync');
    must(['answer', Qs, 'yes', '--rule', 'adopt upstream devteam releases as they ship']);
    assert.equal(json(must(['knowledge', '--json'])).find((k) => k.statement === 'adopt upstream devteam releases as they ship').scope, 'chore:devteam-sync');
    assert.match(must(args, { role: 'sup' }), /match upstream v0\.3\.0 exactly/);
    // a later release folded into the open sync PR is checked against the upstream_base the PR sets
    fs.appendFileSync(path.join(up, 'docs/devteam/governance/quality.md'), '\nAnother upstream rule.\n');
    git(['commit', '-qam', 'next release'], up);
    git(['tag', 'v0.3.1'], up);
    fs.copyFileSync(path.join(up, 'docs/devteam/governance/quality.md'), path.join(wt('sync'), 'docs/devteam/governance/quality.md'));
    const sf = path.join(wt('sync'), 'docs/devteam/project/settings.md');
    fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"gates": {', '"upstream_base": "v0.3.1", "gates": {'));
    git(['commit', '-qam', 'fold in v0.3.1'], wt('sync'));
    git(['push', '-q', 'origin', 'chore-devteam-sync-v0-3-0'], wt('sync'));
    assert.match(must(args, { role: 'sup' }), /match upstream v0\.3\.1 exactly/, 'folded release checked against the PR\'s upstream_base');
    // anything the supervisor wrote itself is not covered
    fs.appendFileSync(path.join(wt('sync'), 'docs/devteam/process/worker.md'), '\nA local edit.\n');
    git(['commit', '-qam', 'local'], wt('sync'));
    git(['push', '-q', 'origin', 'chore-devteam-sync-v0-3-0'], wt('sync'));
    const tampered = dt(args, { role: 'sup' });
    assert.notEqual(tampered.status, 0);
    assert.match(tampered.out + tampered.err, /these differ: .*worker\.md/);
    git(['worktree', 'remove', '--force', wt('sync')]);
  });

  await t.test('a planner in flight is watched like a worker: listed, and flagged when its window is gone', () => {
    git(['branch', 'plan/reports', 'origin/main']);
    const p = json(must(['dashboard-data'])).planners.find((x) => x.feature === 'reports');
    assert.ok(p, 'a plan branch not on main is a planner in flight');
    assert.equal(p.window, false);
    assert.ok(json(must(['metrics', '--json'])).findings.some((f) => f.kind === 'planner-gone' && f.subject === 'plan-reports'));
    assert.deepEqual(p.waiting_on_owner, [], 'no goal, so nothing to wait on from the owner');
    git(['branch', '-D', 'plan/reports']);
    assert.ok(!json(must(['dashboard-data'])).planners.some((x) => x.feature === 'reports'));
    // a planner silent for hours while its goal waits on the owner's answers is waiting, not stale
    if (hasTmux) {
      git(['worktree', 'add', '-q', '-b', 'plan/quiet', wt('plan-quiet'), 'origin/main']);
      // still designing: no feature line yet, so its goal comes from questions linking its branch
      write(path.join(wt('plan-quiet'), 'docs/devteam/project/designs/quiet.md'), '# Design\n');
      git(['add', '-A'], wt('plan-quiet'));
      const old = new Date(Date.now() - 2 * 3600000).toISOString();
      execFileSync('git', ['commit', '-qm', 'plan'], { cwd: wt('plan-quiet'), env: { ...process.env, GIT_AUTHOR_DATE: old, GIT_COMMITTER_DATE: old } });
      const past = new Date(Date.now() - 2 * 3600000);
      fs.utimesSync(path.join(wt('plan-quiet'), 'docs/devteam/project/designs/quiet.md'), past, past);
      spawnSync('tmux', ['new-session', '-d', '-s', 'devteam', '-n', 'plan-quiet', 'sleep 600']);
      const Qq = must(['ask', '--question', 'Which reports first?', '--goal', G, '--recommendation', 'monthly', '--links', JSON.stringify([{ title: 'design', path: 'docs/devteam/project/designs/quiet.md', ref: 'plan/quiet' }])], { role: 'sup' });
      const stale = () => json(must(['metrics', '--json'])).findings.some((f) => f.kind === 'stale-planner' && f.subject === 'plan-quiet');
      assert.ok(!stale(), 'waiting on the owner is not stale');
      const pq = json(must(['dashboard-data'])).planners.find((x) => x.feature === 'quiet');
      assert.deepEqual(pq.waiting_on_owner, [Qq]);
      assert.deepEqual(pq.goals, [G], "its goal, from the question linking its branch");
      must(['answer', Qq, 'monthly']);
      assert.ok(stale(), 'once answered, a silent planner is stale');
      spawnSync('tmux', ['kill-server']);
      git(['worktree', 'remove', '--force', wt('plan-quiet')]);
      git(['branch', '-D', 'plan/quiet']);
    }
  });

  await t.test('a fully defined goal nobody is planning is idle planning', () => {
    const Gi = must(['goal', 'add', '--title', 'Faster checkout', '--outcome', 'pay in under a minute', '--measure', 'median checkout', '--target', '60', '--unit', 's', '--direction', 'down', '--horizon', '2027-06-30', '--non-goals', 'mobile', '--preconditions', 'one-page form', '--priority', '7'], { role: 'sup' });
    must(['goal', 'reading', Gi, '--value', '180'], { role: 'sup' });
    const idle = () => json(must(['metrics', '--json'])).findings.find((f) => f.kind === 'idle-planning');
    assert.match(idle()?.suggestion ?? '', new RegExp(Gi), 'nobody is designing it');
    const Qd = must(['ask', '--question', 'Which checkout first?', '--goal', Gi, '--recommendation', 'cards'], { role: 'sup' });
    assert.ok(!(idle()?.suggestion ?? '').includes(Gi), 'design questions open: someone is designing it');
    must(['withdraw', Qd, '--reason', 'test'], { role: 'sup' });
    must(['goal', 'status', Gi, 'abandoned']);
  });

  await t.test('a lost Enter is pressed once, never into a prompt, never retyped', (tt) => {
    if (!hasTmux) return void tt.diagnostic('tmux not installed: lost-Enter recovery not exercised');
    git(['branch', 'plan/enter', 'origin/main']);
    const text = '[devteam info m-1 from supervisor] Owner approved the goal; plan the feature and tickets, then send the graph for review.';
    const keys = path.join(tmp, 'keys.txt');
    // A stand-in agent (not a shell): draws a screen, then logs every line of input it is sent.
    const agent = path.join(tmp, 'agent.mjs');
    write(agent, "import fs from 'node:fs';\nprocess.stdout.write(fs.readFileSync(process.argv[2], 'utf8'));\nprocess.stdin.on('data', (d) => fs.appendFileSync(process.argv[3], String(d)));\n");
    const sent = path.join(repo, 'docs/devteam/run/sent', `${encodeURIComponent('devteam:plan-enter')}.json`);
    const enters = () => (fs.existsSync(keys) ? fs.readFileSync(keys, 'utf8').split('\n').length - 1 : 0);
    const resent = () => json(must(['log', '--type', 'observation', '--json'])).filter((o) => o.kind === 'resent-enter' && o.subject === 'plan-enter');
    const run = (screen, agoSec) => {
      spawnSync('tmux', ['kill-server']);
      fs.rmSync(keys, { force: true });
      const sf = path.join(tmp, 'screen.txt');
      write(sf, screen);
      write(sent, JSON.stringify({ text, at: new Date(Date.now() - agoSec * 1000).toISOString() }));
      spawnSync('tmux', ['new-session', '-d', '-x', '80', '-y', '24', '-s', 'devteam', '-n', 'plan-enter', `${process.execPath} ${agent} ${sf} ${keys}`]);
      for (let i = 0; i < 30 && !/approved|devteam|Done/.test(spawnSync('tmux', ['capture-pane', '-p', '-t', 'devteam:plan-enter'], { encoding: 'utf8' }).stdout ?? ''); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      must(['metrics', '--json']);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    };
    // the incident's pane: compacted while idle, the text unsubmitted in the input box (wrapped at 80 cols)
    const stuck = `⏺ Compacted while idle, before the prompt cache expired\n${'─'.repeat(60)}\n❯ ${text}\n${'─'.repeat(60)}\n  ⏵⏵ bypass permissions on (shift+tab to cycle)`;
    run(stuck, 3600);
    assert.equal(enters(), 1, 'exactly one Enter');
    assert.equal(resent().length, 1, 'and it is logged');
    assert.match(resent()[0].detail, /sha1 [0-9a-f]{12}/);
    assert.ok(!fs.existsSync(sent), 'the delivery is claimed');
    must(['metrics', '--json']);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    assert.equal(enters(), 1, 'a second pass presses nothing');
    assert.equal(resent().length, 1);
    run(`❯ ${text}\nDo you want to proceed?\n❯ 1. Yes\n  2. No`, 3600);
    assert.equal(enters(), 0, 'never into a permission prompt');
    run(`❯ ${text}\n\n⏺ Done.\n${'line\n'.repeat(12)}❯ \n  ⏵⏵ bypass permissions on`, 3600);
    assert.equal(enters(), 0, 'submitted text: nothing to press');
    assert.ok(!fs.existsSync(sent), 'and the record is dropped');
    run(stuck, 5);
    assert.equal(enters(), 0, 'sent seconds ago: a slow submit is not double-pressed');
    run(`❯ ${text}\n✻ Thinking… (esc to interrupt)`, 3600);
    assert.equal(enters(), 0, 'a busy agent is left alone');
    assert.equal(resent().length, 1);
    fs.rmSync(sent, { force: true });
    must(['send', 'plan-enter', 'carry on'], { role: 'sup' });
    assert.match(json(fs.readFileSync(sent, 'utf8')).text, /^\[devteam info m-\S+ from supervisor\] carry on$/, 'a delivery records the exact text typed');
    spawnSync('tmux', ['kill-server']);
    fs.rmSync(sent, { force: true });
    git(['branch', '-D', 'plan/enter']);
  });

  await t.test('computed views: metrics, roadmap, retro, dashboard data', () => {
    must(['metrics']);
    assert.match(must(['roadmap']), /Self-serve billing/);
    assert.match(must(['retro', '--print'], { role: 'sup' }), /## Numbers/);
    const d = json(must(['dashboard-data']));
    assert.equal(d.tickets.length, 1);
    assert.equal(d.ooda.goals.filter((g) => g.status !== 'abandoned').length, 1);
    assert.ok(d.ooda.trust.some((r) => r.class === 'release-scope' && r.rung === 1 && r.corrections === 1));
    assert.ok(d.ooda.acts.some((a) => a.id === A && a.correction?.reason === 'too early' && a.correction.repaired === 'fix-ticket'));
    assert.equal(d.progress.tickets.length, 1);
    assert.match(must(['history', 'bill-01-card']), /bill-01-card/);
  });

  await t.test('forge git: merge lands the exact verified head on main without gh', () => {
    landSettings((txt) => txt.replace('"gates": {', '"forge": "git", "gates": {'));
    assert.match(dt(['merge', 'bill-01-card'], { role: 'sup' }).err, /needs the PR text/);
    write(path.join(repo, 'docs/devteam/run/pr/ticket/bill-01-card.md'), `# bill-01-card: card capture\n\n${fs.readFileSync(body, 'utf8')}`);
    must(['merge', 'bill-01-card'], { role: 'sup' });
    git(['fetch', '-q', 'origin', 'main']);
    assert.equal(git(['rev-parse', 'origin/main^2']), H2, 'main merges the verified head');
    assert.ok(json(must(['log', '--type', 'act', '--json'])).some((a) => a.class === 'merge-word' && a.refs.includes('bill-01-card')));
    assert.match(must(['status']), /merged.*bill-01-card/);
    // review churn is about tickets still in flight: a merged ticket with many passes raises nothing
    const r3 = path.join(repo, 'docs/devteam/project/tickets/bill-01-card/reviews/final-3.md');
    write(r3, review('reviewer-z', git(['rev-parse', 'HEAD'])));
    assert.ok(!json(must(['metrics', '--json'])).findings.some((f) => f.kind === 'review-churn' && f.subject === 'bill-01-card'));
    fs.rmSync(r3);
  });
});
