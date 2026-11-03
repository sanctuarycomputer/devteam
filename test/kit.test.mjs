// End-to-end test of the kit against a throwaway repo: plan PR, worker lifecycle, questions,
// trust, corrections, forgery, log-sync, and the computed views. Run: node --test  (DEVTEAM_TEST_KEEP=1 keeps the fixture)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
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
const ROLE = { sup: { DEVTEAM_ROLE: 'supervisor' }, planner: { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'billing' }, planner2: { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'other' }, alpha: { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'alpha' }, legacy: { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'legacy' }, worker: { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'bill-01-card' }, owner: {} };
const line = (o) => `${JSON.stringify({ v: 1, ...o })}\n`;
// tmux in this test talks to its own server, never the developer's (or a live fleet's) sessions.
process.env.TMUX_TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-tmux-'));
delete process.env.TMUX;
delete process.env.TMUX_PANE;
const hasTmux = spawnSync('tmux', ['-V']).status === 0;

function dt(args, { cwd = repo, role = 'owner', input } = {}) {
  const env = { ...process.env, ...ROLE[role] };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE']) if (!(k in ROLE[role])) delete env[k];
  const r = spawnSync(process.execPath, [DT, ...args], { cwd, env, encoding: 'utf8', input });
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

  await t.test('init materializes project/, settings, agent config', (t) => {
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
    // the workflow is valid YAML: an expression inside a { … } flow mapping breaks it, and GitHub then runs no job at all
    const wf = path.join(repo, '.github/workflows/devteam.yml');
    assert.doesNotMatch(fs.readFileSync(wf, 'utf8'), /\{[^}\n]*\$\{\{/, 'no ${{ }} inside a flow mapping');
    const ry = spawnSync('ruby', ['-ryaml', '-e', 'w = YAML.load_file(ARGV[0]); exit(w["jobs"]["check-pr"]["steps"].size >= 3 ? 0 : 2)', wf], { encoding: 'utf8' });
    if (ry.error || /No version is set|command not found/.test(ry.stderr ?? '')) t.diagnostic('no runnable ruby: the workflow YAML was checked by pattern only');
    else assert.equal(ry.status, 0, `the workflow parses as YAML: ${ry.stderr}`);
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
    write(path.join(wt('plan-billing'), 'docs/devteam/project/designs/self-serve-billing.md'), '# Design: billing\n\n## Goals\n\nadmins pay alone\n');
    const feature = { title: 'Billing', goals: [G], preconditions: [`${G}#1`], design: 'project/designs/self-serve-billing.md', stories: [{ id: 'BILL-S1', text: 'admin adds a card', release: 'v0.2.0' }] };
    must(['feature', 'add', 'billing', '--json', JSON.stringify(feature)], { cwd: wt('plan-billing'), role: 'planner' });
    assert.match(dt(['validate'], { cwd: wt('plan-billing') }).out, /has no "## TL;DR" section/, 'a design being planned opens with its TL;DR');
    write(path.join(wt('plan-billing'), 'docs/devteam/project/designs/self-serve-billing.md'), '# Design: billing\n\n## TL;DR\n\n- cards first, stored by the processor\n\n## Goals\n\nadmins pay alone\n');
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
    const staleF = () => json(must(['metrics', '--json'])).findings.find((f) => f.kind === 'stale-worker' && f.subject === 'bill-01-card');
    assert.doesNotMatch(staleF().detail, /window is gone/, 'no tmux session: nothing claimed about the window');
    if (hasTmux) {
      spawnSync('tmux', ['new-session', '-d', '-s', 'devteam', '-n', 'someone-else', 'sleep 600']);
      try {
        assert.match(staleF().detail, /its tmux window is gone/);
        assert.match(staleF().suggestion, /worker bill-01-card --resume/);
      } finally { spawnSync('tmux', ['kill-session', '-t', 'devteam']); }
    }
    // idle at its prompt with its own background shell still running: say so, and suggest the nudge
    if (hasTmux) {
      spawnSync('tmux', ['new-session', '-d', '-s', 'devteam', '-n', 'bill-01-card', 'sh -c \'printf "done 11:07 AM\\n> \\n  bypass permissions on \\302\\267 1 shell \\302\\267 to manage\\n"; exec sleep 600\'']);
      try {
        for (let i = 0; i < 20 && !/1 shell/.test(spawnSync('tmux', ['capture-pane', '-p', '-t', 'devteam:bill-01-card'], { encoding: 'utf8' }).stdout ?? ''); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
        assert.match(staleF().detail, /idle at its prompt with a background shell still running/);
        assert.match(staleF().suggestion, /send bill-01-card "check your background shell's result/);
      } finally { spawnSync('tmux', ['kill-session', '-t', 'devteam']); }
    }
    // the agent quit and left its window at a shell prompt: agent-exited, with the resume, not stale
    if (hasTmux) {
      spawnSync('tmux', ['new-session', '-d', '-s', 'devteam', '-n', 'bill-01-card', 'sh']);
      try {
        const fs_ = json(must(['metrics', '--json'])).findings;
        const ex = fs_.find((f) => f.kind === 'agent-exited' && f.subject === 'bill-01-card');
        assert.ok(ex, 'a window back at a shell prompt is an exited agent');
        assert.match(ex.detail, /no agent is running .*at a \w+ prompt/);
        assert.match(ex.suggestion, /worker bill-01-card --resume/);
        assert.ok(!fs_.some((f) => f.kind === 'stale-worker' && f.subject === 'bill-01-card'), 'one finding, not two');
      } finally { spawnSync('tmux', ['kill-session', '-t', 'devteam']); }
    }
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
    assert.match(dt(['gate', 'v18.20.4', '--', 'true'], w).err, /must be a short lowercase word/, "a stray expansion can't record a junk gate");
    assert.match(dt(['gate', 'Usage: node [options]', '--', 'true'], w).err, /must be a short lowercase word/);
    assert.notEqual(dt(['gate', 'lint', '--', 'false'], w).status, 0, 'gate passes the exit status through');
    // a TDD red then green at the same HEAD with uncommitted work is not flakiness
    write(path.join(wt('bill-01-card'), 'billing/wip.test.js'), 'red\n');
    dt(['gate', 'tdd', '--', 'false'], w);
    must(['gate', 'tdd', '--', 'true'], w);
    fs.rmSync(path.join(wt('bill-01-card'), 'billing/wip.test.js'));
    assert.ok(!json(must(['metrics', '--json'])).gates.flaky_gates.some((g) => g.gate === 'tdd'), 'dirty runs are not flaky');
    assert.notEqual(dt(['act', '--class', 'approve-spec', '--refs', 'm-20261101-000000000-bill-01-card', '--', 'spec ok'], { role: 'sup' }).status, 0, 'an approval names its ticket');
    const openReview = () => json(must(['messages', '--to', 'supervisor', '--open', '--json'])).some((m) => m.created_by === 'bill-01-card' && m.kind === 'review-request');
    assert.ok(openReview(), 'asked, not yet answered');
    must(['act', '--class', 'approve-spec', '--refs', 'bill-01-card', '--', 'spec ok'], { role: 'sup' });
    assert.ok(!openReview(), 'the approval it asked for answers it, with no reply citing it');
    const tdir = path.join(wt('bill-01-card'), 'docs/devteam/project/tickets/bill-01-card');
    // approve-plan reads the committed plan, and the plan opens with its TL;DR
    assert.match(dt(['act', '--class', 'approve-plan', '--refs', 'bill-01-card', '--', 'plan ok'], { role: 'sup' }).err, /no plan\.md/);
    write(path.join(tdir, 'spec.md'), '# spec\n');
    write(path.join(tdir, 'plan.md'), '# plan\n\n## Tasks\n\n- T1 card capture\n');
    git(['add', '-A'], wt('bill-01-card'));
    git(['commit', '-qm', 'bill-01-card: spec and plan'], wt('bill-01-card'));
    assert.match(dt(['act', '--class', 'approve-plan', '--refs', 'bill-01-card', '--', 'plan ok'], { role: 'sup' }).err, /no "## TL;DR" section/);
    write(path.join(tdir, 'plan.md'), `# plan\n\n## TL;DR\n\n${Array.from({ length: 8 }, (_, i) => `- point ${i + 1}`).join('\n')}\n\n## Tasks\n\n- T1 card capture\n`);
    git(['commit', '-qam', 'bill-01-card: tldr'], wt('bill-01-card'));
    assert.match(dt(['act', '--class', 'approve-plan', '--refs', 'bill-01-card', '--', 'plan ok'], { role: 'sup' }).err, /8 bullets; seven at most/);
    write(path.join(tdir, 'plan.md'), '# plan\n\n## TL;DR\n\n- capture a card in billing/card.js\n- one test first, then the code\n\n```mermaid\nflowchart LR\n  a --> b\n```\n\n## Tasks\n\n- T1 card capture\n');
    git(['commit', '-qam', 'bill-01-card: tldr'], wt('bill-01-card'));
    must(['act', '--class', 'approve-plan', '--refs', 'bill-01-card', '--', 'plan ok'], { role: 'sup' });
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
    // worktree_files copies master.key; once it decrypts production (default credentials, no
    // production file), Health says so; a production file of its own makes it a dev/test key
    const kinds = () => json(must(['metrics', '--json'])).findings.map((x) => `${x.kind} ${x.subject}`);
    assert.ok(!kinds().some((k) => k.startsWith('production-key-in-worktrees')), 'no credentials, no finding');
    write(path.join(repo, 'config/credentials.yml.enc'), 'enc\n');
    assert.ok(kinds().includes('production-key-in-worktrees config/master.key'));
    write(path.join(repo, 'config/credentials/production.yml.enc'), 'enc\n');
    assert.ok(!kinds().some((k) => k.startsWith('production-key-in-worktrees')), 'production has its own key now');
    fs.rmSync(path.join(repo, 'config/credentials.yml.enc'));
    fs.rmSync(path.join(repo, 'config/credentials'), { recursive: true });
  });

  await t.test('review-worktree: a reviewer\'s detached, seeded tree at exactly a sha, and its removal', () => {
    const reviewWt = must(['review-worktree', 'bill-01-card', H2]);
    assert.equal(fs.realpathSync(reviewWt), fs.realpathSync(wt(`review-bill-01-${H2.slice(0, 8)}`)), 'named for the ticket\'s component and number and 8 hex of the sha, under .worktrees/');
    assert.equal(git(['rev-parse', 'HEAD'], reviewWt), H2, 'at exactly that sha');
    assert.match(git(['status', '--porcelain=v2', '--branch'], reviewWt), /# branch\.head \(detached\)/, 'detached, on no branch');
    assert.equal(fs.readFileSync(path.join(reviewWt, 'config/master.key'), 'utf8'), 'secret\n', 'worktree_files copied, as for a worker');
    assert.ok(fs.existsSync(path.join(reviewWt, '.setup-ran')), 'worktree_setup ran, as for a worker');
    const second = must(['review-worktree', 'bill-01-card', H2, '--name', 'b']);
    assert.equal(path.basename(second), `review-bill-01-${H2.slice(0, 8)}-b`, 'a second reviewer of one sha gets its own tree');
    assert.match(dt(['review-worktree', 'bill-01-card', H2]).err, /exists/, 'an existing path is refused');
    assert.match(dt(['review-worktree', 'no-such-ticket', H2]).err, /no ticket no-such-ticket/, 'an unknown ticket is refused');
    assert.match(dt(['review-worktree', 'bill-01-card', 'deadbeef']).err, /is not a commit/, 'a sha that resolves to no commit is refused');
    assert.match(dt(['review-worktree', 'bill-01-card', `${H2}^{tree}`]).err, /is not a commit/, 'a tree is not a commit');
    assert.match(dt(['review-worktree', 'bill-01-card', H2, '--name', '../x']).err, /--name/, 'the suffix is never a path');
    for (const bad of [wt('bill-01-card'), repo, path.join(tmp, 'review-elsewhere'), wt('review-not-a-worktree')]) {
      if (bad.endsWith('review-not-a-worktree')) fs.mkdirSync(bad, { recursive: true });
      const r = dt(['review-worktree', '--remove', bad]);
      assert.notEqual(r.status, 0, `--remove refuses ${bad}`);
      assert.match(r.err, /is not a review worktree/);
    }
    assert.ok(fs.existsSync(wt('bill-01-card')), "a worker's tree is left alone");
    fs.rmSync(wt('review-not-a-worktree'), { recursive: true });
    must(['review-worktree', '--remove', reviewWt]);
    must(['review-worktree', '--remove', path.relative(fs.realpathSync(repo), fs.realpathSync(second))]); // a relative path, from the main checkout
    assert.ok(!fs.existsSync(reviewWt) && !fs.existsSync(second), '--remove removes them');
    assert.doesNotMatch(git(['worktree', 'list']), /review-/, 'and git forgets them');
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

  await t.test('parallel planners number tickets from disjoint reserved blocks; validate and merge --plan hold them to it', (tt) => {
    if (!hasTmux) return tt.skip('no tmux');
    // the planner's agent is a no-op here
    landSettings((txt) => txt.replace('"gates": {', '"agent_command": "true", "resume_command": "true", "gates": {'));
    // two planners started together: blocks above main's highest number (bill-01) and each other's
    assert.match(must(['planner', 'alpha'], { role: 'sup' }), /ticket numbers 02-21 reserved/);
    assert.match(must(['planner', 'beta', '--id-block', '5'], { role: 'sup' }), /ticket numbers 22-26 reserved/);
    assert.match(dt(['planner', 'gamma', '--id-block', '0'], { role: 'sup' }).err, /--id-block takes a whole number/);
    const blocks = () => json(must(['log', '--type', 'act', '--json'])).filter((a) => a.id_block).map((a) => a.id_block);
    assert.deepEqual(blocks(), [{ feature: 'alpha', from: 2, to: 21 }, { feature: 'beta', from: 22, to: 26 }]);
    // the block is in the planner's prompt, and a relaunch keeps it rather than reserving another
    assert.match(fs.readFileSync(path.join(repo, 'docs/devteam/run/prompts/plan-alpha.txt'), 'utf8'), /Your ticket numbers: 02 to 21, reserved for this feature/);
    assert.match(must(['prompt', 'planner', 'beta']), /Your ticket numbers: 22 to 26/);
    assert.doesNotMatch(must(['prompt', 'planner', 'nobody']), /Your ticket numbers/);
    must(['planner', 'alpha', '--resume'], { role: 'sup' });
    assert.equal(blocks().length, 2);
    // validate on the plan branch: a ticket outside the block is a warning, one inside is not
    const aw = { cwd: wt('plan-alpha'), role: 'alpha' };
    const tk = (title) => JSON.stringify({ title, feature: 'alpha', component: 'al', kind: 'build', size: 'S', risk: 'normal', serves: ['AL-S1'], depends_on: [], touches: [`al/${title}/**`], done_when: ['tests pass'] });
    must(['feature', 'add', 'alpha', '--json', JSON.stringify({ title: 'Alpha', goals: [G], stories: [{ id: 'AL-S1', text: 'a', release: 'v0.2.0' }] })], aw);
    must(['ticket', 'add', 'al-02-one', '--json', tk('one')], aw);
    let v = dt(['validate'], { cwd: wt('plan-alpha') }).out;
    assert.doesNotMatch(v, /outside the block/);
    must(['ticket', 'add', 'al-30-far', '--json', tk('far')], aw);
    v = dt(['validate', '--strict'], { cwd: wt('plan-alpha') }).out;
    assert.match(v, /warning: al-30-far: its number is outside the block reserved for alpha \(02-21\)/);
    assert.doesNotMatch(v, /al-02-one: its number is outside/);
    // a planner made before blocks has none, so nothing to warn about
    git(['worktree', 'add', '-q', '-b', 'plan/legacy', wt('plan-legacy'), 'origin/main']);
    const lw = { cwd: wt('plan-legacy'), role: 'legacy' };
    must(['feature', 'add', 'legacy', '--json', JSON.stringify({ title: 'Legacy', goals: [G], stories: [{ id: 'LG-S1', text: 'l', release: 'v0.2.0' }] })], lw);
    must(['ticket', 'add', 'lg-90-old', '--json', tk('old').replace('"alpha"', '"legacy"').replace('AL-S1', 'LG-S1').replace('"al"', '"lg"')], lw);
    assert.doesNotMatch(dt(['validate', '--strict'], { cwd: wt('plan-legacy') }).out, /outside the block/);
    // a plan whose ticket id is already on main is refused outright at merge
    const pb = path.join(wt('plan-beta'), 'docs/devteam/project/log/plan-beta.jsonl');
    fs.appendFileSync(pb, line({ id: 'bill-01-card', type: 'ticket', op: 'new', at: '2026-11-02T00:00:00.000Z', by: 'plan-beta', title: 'card again', feature: 'beta', component: 'bill', kind: 'build', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: [], done_when: ['x'] }));
    for (const w of ['plan-alpha', 'plan-beta']) { git(['add', '-A'], wt(w)); git(['commit', '-qm', 'plan'], wt(w)); }
    const dup = dt(['merge', '--plan', 'beta', '--dry-run', '--title', 'plan-beta: beta', '--body-file', body], { role: 'sup' });
    assert.notEqual(dup.status, 0);
    assert.match(dup.out, /fail: ticket id already on main: bill-01-card; renumber/);
    assert.doesNotMatch(dt(['merge', '--plan', 'alpha', '--dry-run', '--title', 'plan-alpha: alpha', '--body-file', body], { role: 'sup' }).out, /already on main/);
    spawnSync('tmux', ['kill-server']);
    for (const f of ['alpha', 'beta', 'legacy']) { git(['worktree', 'remove', '--force', wt(`plan-${f}`)]); git(['branch', '-D', `plan/${f}`]); }
  });

  await t.test('a fully defined goal nobody is planning is idle planning', () => {
    const Gi = must(['goal', 'add', '--title', 'Faster checkout', '--outcome', 'pay in under a minute', '--measure', 'median checkout', '--target', '60', '--unit', 's', '--direction', 'down', '--horizon', '2027-06-30', '--non-goals', 'mobile', '--preconditions', 'one-page form', '--priority', '7'], { role: 'sup' });
    must(['goal', 'reading', Gi, '--value', '180'], { role: 'sup' });
    const idle = () => json(must(['metrics', '--json'])).findings.find((f) => f.kind === 'idle-planning');
    assert.match(idle()?.suggestion ?? '', new RegExp(Gi), 'nobody is designing it');
    const Qd = must(['ask', '--question', 'Which checkout first?', '--goal', Gi, '--recommendation', 'cards'], { role: 'sup' });
    assert.ok(!(idle()?.suggestion ?? '').includes(Gi), 'design questions open: someone is designing it');
    must(['withdraw', Qd, '--reason', 'test'], { role: 'sup' });
    // the one reason to hold it back: its design depends on another goal's, recorded with why
    const Gp = must(['goal', 'add', '--title', 'Checkout prerequisites', '--priority', '8'], { role: 'sup' });
    assert.doesNotMatch(must(['goal', 'check', Gp]), /horizon/, 'a date is the owner\'s to give, never a gap to fill');
    assert.match(dt(['goal', 'set', Gi, '--plan-after', Gp], { role: 'sup' }).err, /needs --reason/);
    must(['goal', 'set', Gi, '--plan-after', Gp, '--reason', 'the payment boundary is decided there'], { role: 'sup' });
    assert.ok(!(idle()?.suggestion ?? '').includes(Gi), 'waiting on another goal\'s design, recorded');
    must(['goal', 'status', Gp, 'abandoned']);
    assert.match(idle()?.suggestion ?? '', new RegExp(Gi), 'the goal it waited on was let go: plan it now');
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
      must(['metrics', '--json'], { role: 'sup' });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    };
    // the incident's pane: compacted while idle, the text unsubmitted in the input box (wrapped at 80 cols)
    const stuck = `⏺ Compacted while idle, before the prompt cache expired\n${'─'.repeat(60)}\n❯ ${text}\n${'─'.repeat(60)}\n  ⏵⏵ bypass permissions on (shift+tab to cycle)`;
    // a read by anyone but the supervisor (the dashboard, status, the owner) never presses a key
    spawnSync('tmux', ['kill-server']);
    fs.rmSync(keys, { force: true });
    write(path.join(tmp, 'screen.txt'), stuck);
    write(sent, JSON.stringify({ text, at: new Date(Date.now() - 3600 * 1000).toISOString() }));
    spawnSync('tmux', ['new-session', '-d', '-x', '80', '-y', '24', '-s', 'devteam', '-n', 'plan-enter', `${process.execPath} ${agent} ${path.join(tmp, 'screen.txt')} ${keys}`]);
    for (let i = 0; i < 30 && !/approved|devteam/.test(spawnSync('tmux', ['capture-pane', '-p', '-t', 'devteam:plan-enter'], { encoding: 'utf8' }).stdout ?? ''); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    must(['dashboard-data']);
    must(['metrics', '--json']);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    assert.equal(enters(), 0, 'the dashboard and the owner only look');
    assert.ok(fs.existsSync(sent), 'the delivery is still waiting for the supervisor');
    run(stuck, 3600);
    assert.equal(enters(), 1, 'exactly one Enter');
    assert.equal(resent().length, 1, 'and it is logged');
    assert.match(resent()[0].detail, /sha1 [0-9a-f]{12}/);
    assert.ok(!fs.existsSync(sent), 'the delivery is claimed');
    must(['metrics', '--json'], { role: 'sup' });
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

  await t.test('a ready goal changes through an answered goal-change question, by exactly the change it proposed', () => {
    const nonGoals = () => json(must(['goal', 'show', G, '--json'])).non_goals;
    const change = JSON.stringify({ non_goals: ['enterprise invoicing', 'refunds'] });
    assert.equal(json(must(['goal', 'show', G, '--json'])).status, 'ready');
    assert.match(dt(['goal', 'set', G, '--non-goals', 'x'], { role: 'sup' }).err, /only the owner changes it now \(class goal-change\)/, 'refused without --approved');
    const ask = (extra) => must(['ask', '--kind', 'owner-decision', '--question', 'Add refunds to the non-goals?', '--recommendation', 'Set it', '--options', 'Set it', 'Leave it', ...extra], { role: 'sup' });
    assert.match(dt(['ask', '--question', 'Change it?', '--class', 'goal-change', '--goal', G, '--recommendation', 'Set it'], { role: 'sup' }).err, /says the exact change/, 'a goal-change question names its change');
    assert.match(dt(['ask', '--question', 'Change it?', '--class', 'goal-change', '--goal', G, '--change', '{"status":"met"}'], { role: 'sup' }).err, /not status/, 'only goal fields the supervisor may propose');
    const Qwrong = ask(['--class', 'release-scope']);
    must(['answer', Qwrong, 'Set it']);
    assert.match(dt(['goal', 'set', G, '--approved', Qwrong], { role: 'sup' }).err, /class release-scope, not goal-change/, 'wrong class');
    const Qother = ask(['--class', 'goal-change', '--goal', 'g-20990101-000000000-supervisor', '--change', change]);
    must(['answer', Qother, 'Set it']);
    assert.match(dt(['goal', 'set', G, '--approved', Qother], { role: 'sup' }).err, new RegExp(`is about g-20990101-000000000-supervisor, not ${G}`), 'wrong goal');
    const Qopen = ask(['--class', 'goal-change', '--goal', G, '--change', change]);
    assert.match(dt(['goal', 'set', G, '--approved', Qopen], { role: 'sup' }).err, /not answered by the owner/, 'unanswered');
    must(['withdraw', Qopen, '--reason', 'test'], { role: 'sup' });
    const Qno = ask(['--class', 'goal-change', '--goal', G, '--change', change]);
    must(['answer', Qno, 'Leave it']);
    assert.match(dt(['goal', 'set', G, '--approved', Qno], { role: 'sup' }).err, /not its recommendation/, 'a declining answer authorises nothing');
    const Qok = ask(['--class', 'goal-change', '--goal', G, '--change', change]);
    must(['answer', Qok, 'Set it — refunds can wait']);
    assert.match(dt(['goal', 'set', G, '--approved', Qok, '--target', '10'], { role: 'sup' }).err, /pass no other fields/, 'the answer covers the proposed change, not another');
    must(['goal', 'set', G, '--approved', Qok], { role: 'sup' });
    assert.deepEqual(nonGoals(), ['enterprise invoicing', 'refunds']);
    // a guessed date is cleared the same way: the change sets horizon to null
    const Qdate = ask(['--class', 'goal-change', '--goal', G, '--change', JSON.stringify({ horizon: null })]);
    must(['answer', Qdate, 'Set it']);
    must(['goal', 'set', G, '--approved', Qdate], { role: 'sup' });
    assert.equal(json(must(['goal', 'show', G, '--json'])).horizon, null, 'the horizon is cleared');
    assert.doesNotMatch(must(['goal', 'check', G]), /horizon/);
    assert.equal(json(must(['goal', 'show', G, '--json'])).updates.find((u) => u.approved === Qok)?.non_goals?.length, 2, 'the set records which answer authorised it');
    assert.match(dt(['goal', 'set', G, '--approved', Qok], { role: 'sup' }).err, /already authorised a change/, 'one change per answer');
    assert.match(dt(['goal', 'set', G, '--non-goals', 'x', '--owner', '--approved', Qok]).err, /--approved is the supervisor/, 'the owner sets directly');
    // an answer given before questions recorded their change is carried forward, not re-asked: the
    // supervisor states the change, and it's logged as a carry-answer act the owner can correct
    const dir0 = path.join(repo, 'docs/devteam/run/log');
    const sup0 = path.join(dir0, fs.readdirSync(dir0).find((f) => /^supervisor-\d{4}-\d{2}\.jsonl$/.test(f)));
    const Qold = 'q-20261101-000000001-supervisor';
    fs.appendFileSync(sup0, line({ id: Qold, type: 'question', op: 'new', at: '2026-11-01T00:00:00.001Z', by: 'supervisor', kind: 'owner-decision', class: 'goal-change', goal: G, question: 'Give the goal one milestone?', recommendation: 'Set it', blocks: [], evidence: [], why_asked: { reasons: [] } }));
    must(['answer', Qold, 'Set it']);
    assert.match(dt(['goal', 'set', G, '--approved', Qold], { role: 'sup' }).err, /carry the owner's (earlier )?answer forward with/);
    must(['goal', 'set', G, '--approved', Qold, '--change', JSON.stringify({ priority: 3 })], { role: 'sup' });
    assert.equal(json(must(['goal', 'show', G, '--json'])).priority, 3, 'carried forward, not re-asked');
    assert.ok(json(must(['log', '--type', 'act', '--json'])).some((a) => a.class === 'carry-answer' && a.refs.includes(Qold)), 'and logged for the owner to see and correct');
    assert.match(dt(['goal', 'set', G, '--approved', Qok, '--change', JSON.stringify({ priority: 9 })], { role: 'sup' }).err, /already authorised|proposed its change/, 'a question that recorded its change applies only that');
    // written straight into the log, a set that differs from the approved change is ignored by the fold
    const Qok2 = ask(['--class', 'goal-change', '--goal', G, '--change', JSON.stringify({ priority: 2 })]);
    must(['answer', Qok2, 'Set it']);
    const dir = path.join(repo, 'docs/devteam/run/log');
    const file = path.join(dir, fs.readdirSync(dir).find((f) => /^supervisor-\d{4}-\d{2}\.jsonl$/.test(f)));
    const before = fs.readFileSync(file, 'utf8');
    fs.appendFileSync(file, line({ id: G, type: 'goal', op: 'set', at: new Date().toISOString(), by: 'supervisor', measure: { description: 'easier', target: 1, unit: '%', direction: 'up' }, approved: Qok2 }));
    assert.equal(json(must(['goal', 'show', G, '--json'])).measure.target, 80, 'a set other than the approved change changes nothing');
    assert.match(dt(['log-check']).out, /is not the change/);
    fs.writeFileSync(file, before);
  });

  await t.test('secrets: the owner posts straight to a sink; the log never holds a value', async (t) => {
    const VALUE = 'sk_test_51Hq"zz\\9-not-in-the-log';
    const CERT = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUQ\n-----END CERTIFICATE-----\n';
    const outside = path.join(tmp, 'uploaded.txt');
    const sinkScript = path.join(tmp, 'sink.mjs');
    write(sinkScript, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(outside)}, fs.readFileSync(0));\n`);
    const echoScript = path.join(tmp, 'echo.mjs');
    write(echoScript, `import fs from 'node:fs'; const v = fs.readFileSync(0, 'utf8'); console.error('bad key: ' + v + ' / ' + Buffer.from(v).toString('base64')); process.exit(1);\n`);
    const stdinSink = `stdin:${process.execPath} ${sinkScript}`;
    // stdin sinks run as the owner, so only commands the owner listed
    assert.match(dt(['ask', '--kind', 'owner-action', '--question', 'Key?', '--secrets', JSON.stringify([{ name: 'K', sink: stdinSink }])], { role: 'sup' }).err, /not in settings\.secret_commands/);
    landSettings((txt) => txt.replace('"gates": {', `"secret_commands": [${JSON.stringify(`${process.execPath} ${sinkScript}`)}, ${JSON.stringify(`${process.execPath} ${echoScript}`)}], "gates": {`));
    fs.appendFileSync(path.join(repo, '.gitignore'), 'config/*.key\nconfig/credentials/*.key\n');
    git(['commit', '-qam', 'ignore keys']);
    const slots = [{ name: 'STRIPE_TEST_KEY', sink: stdinSink }, { name: 'APNS_CERT', kind: 'file', sink: 'file:config/apns.key' }];
    // only an owner-action question declares secrets, with known sinks and names, and no default
    assert.match(dt(['ask', '--question', 'Key?', '--secrets', JSON.stringify(slots)], { role: 'sup' }).err, /owner-action/);
    assert.match(dt(['ask', '--kind', 'owner-action', '--question', 'Key?', '--secrets', JSON.stringify([{ name: 'k', sink: stdinSink }])], { role: 'sup' }).err, /UPPER_SNAKE_CASE/);
    assert.match(dt(['ask', '--kind', 'owner-action', '--question', 'Key?', '--secrets', JSON.stringify([{ name: 'K', sink: 'ftp:x' }])], { role: 'sup' }).err, /sink "ftp:x"/);
    assert.match(dt(['ask', '--kind', 'owner-action', '--question', 'Key?', '--secrets', JSON.stringify([{ name: 'K', sink: 'file:docs/devteam/run/k' }])], { role: 'sup' }).err, /not under devteam's run/);
    assert.match(dt(['ask', '--kind', 'owner-action', '--question', 'Key?', '--secrets', JSON.stringify([{ name: 'K', sink: 'sops:-x:a' }])], { role: 'sup' }).err, /no segment starting with -/);
    assert.match(dt(['ask', '--kind', 'owner-action', '--question', 'Key?', '--secrets', '["K"]'], { role: 'sup' }).err, /array of objects/);
    assert.match(dt(['ask', '--kind', 'owner-action', '--question', 'Key?', '--default', 'skip', '--secrets', JSON.stringify(slots)], { role: 'sup' }).err, /no --default/);
    const Qs = must(['ask', '--kind', 'owner-action', '--question', 'Post the Stripe test key and the APNs cert', '--secrets', JSON.stringify(slots)], { role: 'sup' });
    assert.match(dt(['secret', 'post', Qs, '--json'], { role: 'sup', input: '{}' }).err, /owner commands don't run in an agent session/);
    // the first slot alone: posted, the question stays open
    assert.match(must(['secret', 'post', Qs, '--json'], { input: JSON.stringify({ STRIPE_TEST_KEY: VALUE }) }), /posted STRIPE_TEST_KEY/);
    assert.equal(fs.readFileSync(outside, 'utf8'), VALUE, 'the sink got the value on stdin');
    let q = json(must(['questions', '--id', Qs, '--json']))[0];
    assert.equal(q.status, 'open');
    assert.deepEqual(q.secrets_posted.map((p) => p.name), ['STRIPE_TEST_KEY']);
    // the file slot, then the question is answered
    must(['secret', 'post', Qs, '--json'], { input: JSON.stringify({ APNS_CERT: { b64: Buffer.from(CERT).toString('base64') } }) });
    assert.equal(fs.readFileSync(path.join(repo, 'config/apns.key'), 'utf8'), CERT);
    assert.equal(fs.statSync(path.join(repo, 'config/apns.key')).mode & 0o777, 0o600);
    q = json(must(['questions', '--id', Qs, '--json']))[0];
    assert.equal(q.status, 'answered');
    assert.equal(q.answer, 'Posted 2 secrets');
    assert.match(dt(['secret', 'post', Qs, '--json'], { input: '{}' }).err, /already answered/);
    // a failing sink's output is shown redacted, raw and encoded
    const Qf = must(['ask', '--kind', 'owner-action', '--question', 'Upload it', '--secrets', JSON.stringify([{ name: 'UPLOAD', sink: `stdin:${process.execPath} ${echoScript}` }, { name: 'NOT_IGNORED', sink: 'file:README.md' }])], { role: 'sup' });
    const failed = dt(['secret', 'post', Qf, '--json'], { input: JSON.stringify({ UPLOAD: VALUE, NOT_IGNORED: 'x' }) });
    assert.notEqual(failed.status, 0);
    assert.match(failed.err, /bad key: \[secret:UPLOAD\] \/ \[secret:UPLOAD\]/);
    assert.match(failed.err, /README\.md is not gitignored/);
    assert.doesNotMatch(failed.err + failed.out, /sk_test_51Hq/);
    // encrypted stores: a fake sops and a fake bin/rails stand in for the real tools. The Rails
    // editor is `ruby`, so this needs one that runs in the fixture (an asdf shim with no
    // .tool-versions there refuses): skipped, and said so, without one.
    const rubyOk = spawnSync('ruby', ['-e', '0'], { cwd: repo }).status === 0;
    if (!rubyOk) t.diagnostic('skipped the rails-credentials and sops sinks: no runnable ruby here (set ASDF_RUBY_VERSION, or install one)');
    if (rubyOk) {
      // encrypted stores: a fake sops and a fake bin/rails stand in for the real tools
      const bin = path.join(tmp, 'fakebin');
      write(path.join(bin, 'sops'), `#!/bin/sh\n[ "$1" = set ] && [ "$2" = --value-stdin ] || { echo "flag provided but not defined: $2" >&2; exit 1; }\nnode -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(0,"utf8"));fs.appendFileSync(process.argv[1], process.argv[2]+": "+JSON.stringify(v)+"\\n")' "$3" "$4"\n`);
      fs.chmodSync(path.join(bin, 'sops'), 0o755);
      write(path.join(repo, 'bin/rails'), `#!/bin/sh\n# fake credentials:edit: plaintext stands in for the encrypted file\nf=config/credentials/$3.yml.enc; t=$(mktemp); cp "$f" "$t"\n[ -n "$FAKE_RAILS_SKIP" ] || $EDITOR "$t"\ncp "$t" "$f"; rm -f "$t"; echo "File encrypted and saved."\n`);
      fs.chmodSync(path.join(repo, 'bin/rails'), 0o755);
      write(path.join(repo, 'config/credentials/test.yml.enc'), '# a comment\nexpires: 2026-01-01\nstripe:\n  publishable: pk_test\n');
      write(path.join(repo, 'config/credentials/test.key'), 'testkey\n');
      write(path.join(repo, 'config/secrets.enc.yaml'), 'existing: 1\n');
      git(['add', 'bin/rails', 'config/credentials/test.yml.enc', 'config/secrets.enc.yaml']);
      git(['commit', '-qm', 'stores']);
      git(['push', '-q', 'origin', 'main']);
      const PATH0 = process.env.PATH;
      process.env.PATH = `${bin}${path.delimiter}${PATH0}`;
      try {
        const Qe = must(['ask', '--kind', 'owner-action', '--question', 'Stripe secret for tests', '--secrets', JSON.stringify([{ name: 'RAILS_STRIPE', sink: 'rails-credentials:test:stripe.secret_key' }, { name: 'SOPS_TOKEN', sink: 'sops:config/secrets.enc.yaml:api.token' }])], { role: 'sup' });
        // Rails ignoring the editor is not taken for success
        process.env.FAKE_RAILS_SKIP = '1';
        assert.match(dt(['secret', 'post', Qe, '--json'], { input: JSON.stringify({ RAILS_STRIPE: VALUE }) }).err, /editor did not finish/);
        delete process.env.FAKE_RAILS_SKIP;
        assert.match(must(['secret', 'post', Qe, '--json'], { input: JSON.stringify({ RAILS_STRIPE: VALUE, SOPS_TOKEN: 'tok-123456' }) }), /Land it: chore pr secret-\d+-\d+ --title/);
        const slug = `secret-${Qe.split('-').slice(1, 3).join('-')}`;
        const committed = git(['show', '--name-only', '--format=', `chore-${slug}`]).split('\n').filter(Boolean).sort();
        assert.deepEqual(committed, ['config/credentials/test.yml.enc', 'config/secrets.enc.yaml'], 'only the stores are committed, never the copied key');
        const yml = git(['show', `chore-${slug}:config/credentials/test.yml.enc`]);
        assert.match(yml, /expires: 2026-01-01/, 'a date survives the YAML round trip');
        assert.match(yml, /publishable: pk_test/);
        assert.ok(yml.includes('secret_key:'), 'the key is set');
        assert.match(git(['show', `chore-${slug}:config/secrets.enc.yaml`]), /\["api"\]\["token"\]: "tok-123456"/);
        assert.equal(json(must(['questions', '--id', Qe, '--json']))[0].answer, 'Posted 2 secrets');
        // a production secret behind a key on disk is flagged on the card; a test one isn't
        assert.equal(json(must(['questions', '--id', Qe, '--json']))[0].secrets[0].warning, null, 'test credentials: no warning');
        const mk = path.join(repo, 'config/master.key');
        if (!fs.existsSync(mk)) write(mk, 'k\n');
        const Qp = must(['ask', '--kind', 'owner-action', '--question', 'Prod token', '--secrets', JSON.stringify([{ name: 'PROD_TOKEN', sink: 'rails-credentials:default:svc.token' }])], { role: 'sup' });
        assert.match(json(must(['questions', '--id', Qp, '--json']))[0].secrets[0].warning, /config\/master\.key is on disk .* any agent on this machine can read the key/);
        fs.renameSync(mk, `${mk}.away`);
        try { assert.equal(json(must(['questions', '--id', Qp, '--json']))[0].secrets[0].warning, null, 'no key on disk, no warning'); } finally { fs.renameSync(`${mk}.away`, mk); }
        // the question approves its own secret chore, and a secrets question answered otherwise approves nothing
        const md = (approved) => dt(['merge', '--chore', slug, '--dry-run', '--approved', approved, '--title', `chore-${slug}: post secrets`, '--body-file', body], { role: 'sup' });
        const ok = md(Qe);
        assert.doesNotMatch(ok.out + ok.err, /approves only its own chore-secret PR/);
        const Qc = must(['ask', '--kind', 'owner-action', '--question', 'Another', '--secrets', JSON.stringify([{ name: 'X', sink: 'file:config/x.key' }])], { role: 'sup' });
        must(['answer', Qc, 'Can’t right now']);
        assert.match(md(Qc).out, /approves only its own chore-secret PR/);
      } finally {
        process.env.PATH = PATH0;
        delete process.env.FAKE_RAILS_SKIP;
      }
    }
    // a sink the kit can't read doesn't take the views down with it
    const supFile = fs.readdirSync(path.join(repo, 'docs/devteam/run/log')).find((f) => f.startsWith('supervisor-'));
    fs.appendFileSync(path.join(repo, 'docs/devteam/run/log', supFile), `${JSON.stringify({ v: 1, id: 'q-20991231-235959000-supervisor', type: 'question', op: 'new', at: '2099-12-31T23:59:59.000Z', by: 'supervisor', kind: 'owner-action', question: 'odd', secrets: [{ name: 'ODD', kind: 'string', sink: 'sops:nocolon' }] })}\n`);
    assert.match(must(['questions', '--id', 'q-20991231-235959000-supervisor', '--json']), /an unreadable sink/);
    must(['dashboard-data']);
    // the dashboard: browser headers required, a dead child doesn't kill the server, bytes decode whole
    const port = 4400 + Math.floor(Math.random() * 500);
    const srv = spawn(process.execPath, [DT, 'dashboard', '--port', String(port)], { cwd: repo, env: { ...process.env, DEVTEAM_ROLE: '' }, stdio: 'ignore' });
    try {
      for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
      const browser = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: `http://127.0.0.1:${port}` };
      const postSecret = (b, headers = browser) => fetch(`http://127.0.0.1:${port}/api/secret`, { method: 'POST', headers, body: JSON.stringify(b) });
      assert.equal((await postSecret({ id: Qs, values: {} }, { 'content-type': 'application/json' })).status, 403, 'a request without browser headers is refused');
      for (let i = 0; i < 3; i++) assert.equal((await postSecret({ id: 'q-20200101-000000000-supervisor', values: { A: 'x'.repeat(3 * 1024 * 1024) } })).status, 400);
      const Qd = must(['ask', '--kind', 'owner-action', '--question', 'Dashboard', '--secrets', JSON.stringify([{ name: 'UNI', sink: 'file:config/uni.key' }])], { role: 'sup' });
      const uni = `pässwörd-é-${'ä'.repeat(70000)}`;
      const r = await postSecret({ id: Qd, values: { UNI: uni } });
      assert.equal(r.status, 200, await r.clone().text());
      assert.equal(fs.readFileSync(path.join(repo, 'config/uni.key'), 'utf8'), uni, 'multibyte text arrives whole');
    } finally { srv.kill(); }
    // the dashboard keeps its own record of starting and stopping in run/, which outlives its window
    await new Promise((r) => (srv.exitCode !== null || srv.signalCode !== null ? r() : srv.once('exit', r)));
    const dlog = fs.readFileSync(path.join(repo, 'docs/devteam/run/dashboard.log'), 'utf8');
    assert.match(dlog, new RegExp(`started on http://127\\.0\\.0\\.1:${port}`));
    assert.match(dlog, /stopped by SIGTERM/);
    assert.doesNotMatch(dlog, /pässwörd/, 'never a request body');
    // no value anywhere devteam writes
    const logs = fs.readdirSync(path.join(repo, 'docs/devteam/run/log')).map((f) => fs.readFileSync(path.join(repo, 'docs/devteam/run/log', f), 'utf8')).join('');
    for (const form of [VALUE, JSON.stringify(VALUE).slice(1, -1), Buffer.from(VALUE).toString('base64'), 'MIIBszCCAVmgAwIBAgIUQ', 'tok-123456', 'pässwörd']) assert.ok(!logs.includes(form), `log holds ${form}`);
    for (const f of ['config/apns.key', 'config/uni.key', 'config/credentials/test.key']) fs.rmSync(path.join(repo, f), { force: true });
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

  await t.test("merge waits for the forge's checks at the head: pending is not passed, failing fails", () => {
    const bin = path.join(tmp, 'fakegh');
    const prFile = path.join(tmp, 'fakegh-pr.json');
    write(path.join(bin, 'gh'), `#!/bin/sh\n[ "$1 $2" = "pr view" ] && exec cat "${prFile}"\nexit 1\n`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    const pr = (checks) => fs.writeFileSync(prFile, JSON.stringify({ number: 7, headRefOid: H2, title: 'bill-01-card: card capture', body: fs.readFileSync(body, 'utf8'), isDraft: false, mergeStateStatus: 'UNSTABLE', url: 'https://example.test/pr/7', statusCheckRollup: checks }));
    const PATH0 = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${PATH0}`;
    try {
      const dry = () => { const r = dt(['merge', 'bill-01-card', '--dry-run', '--no-gates'], { role: 'sup' }); return r.out + r.err; };
      pr([{ __typename: 'StatusContext', context: 'continuous-integration/heroku', state: 'PENDING' }, { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' }]);
      assert.match(dry(), /checks are still running at .*: continuous-integration\/heroku; wait for them/, 'a pending status is not passed, required or not');
      pr([{ __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS', conclusion: null }]);
      assert.match(dry(), /still running .*: test/);
      pr([{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }, { __typename: 'StatusContext', context: 'deploy', state: 'ERROR' }]);
      assert.match(dry(), /checks failed at .*: test \(failure\), deploy \(error\)/);
      pr([{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }, { __typename: 'CheckRun', name: 'optional', status: 'COMPLETED', conclusion: 'SKIPPED' }, { __typename: 'StatusContext', context: 'continuous-integration/heroku', state: 'SUCCESS' }]);
      assert.doesNotMatch(dry(), /forge's checks/, 'all passed: nothing to wait for');
    } finally { process.env.PATH = PATH0; }
  });

  await t.test('forge git: merge lands the exact verified head on main without gh', () => {
    landSettings((txt) => txt.replace('"gates": {', '"forge": "git", "gates": {'));
    // a ratchet gate failing on main too: pre-existing debt, allowed, and not this PR's failure
    landSettings((txt) => txt.replace('"gates": {', '"gates": { "debt": { "cmd": "false", "mode": "ratchet" },'));
    assert.match(dt(['merge', 'bill-01-card'], { role: 'sup' }).err, /needs the PR text/);
    write(path.join(repo, 'docs/devteam/run/pr/ticket/bill-01-card.md'), `# bill-01-card: card capture\n\n${fs.readFileSync(body, 'utf8')}`);
    must(['merge', 'bill-01-card'], { role: 'sup' });
    git(['fetch', '-q', 'origin', 'main']);
    assert.equal(git(['rev-parse', 'origin/main^2']), H2, 'main merges the verified head');
    const debt = json(must(['log', '--type', 'gate', '--json'])).filter((g) => g.gate === 'debt');
    assert.ok(debt.length && debt.every((g) => !g.ok && g.preexisting), 'the failure is recorded as pre-existing');
    const dg = json(must(['metrics', '--json'])).gates.gates.find((g) => g.gate === 'debt');
    assert.deepEqual([dg.fail_rate, dg.preexisting_fails], [0, debt.length], "and not counted in the gate's fail rate");
    assert.ok(json(must(['log', '--type', 'act', '--json'])).some((a) => a.class === 'merge-word' && a.refs.includes('bill-01-card')));
    assert.match(must(['status']), /merged.*bill-01-card/);
    // its merge settles the worker's requests, replied to or not
    assert.ok(!json(must(['messages', '--to', 'supervisor', '--open', '--json'])).some((m) => m.created_by === 'bill-01-card'), 'a merged ticket asks nothing');
    assert.ok(!json(must(['dashboard-data'])).open_messages.some((m) => m.actor === 'bill-01-card'));
    // review churn is about tickets still in flight: a merged ticket with many passes raises nothing
    const r3 = path.join(repo, 'docs/devteam/project/tickets/bill-01-card/reviews/final-3.md');
    write(r3, review('reviewer-z', git(['rev-parse', 'HEAD'])));
    assert.ok(!json(must(['metrics', '--json'])).findings.some((f) => f.kind === 'review-churn' && f.subject === 'bill-01-card'));
    fs.rmSync(r3);
  });

  await t.test('goal list flags take separate values or one JSON array of strings, and refuse anything else that looks like JSON', () => {
    const sup = { role: 'sup' };
    const Gj = must(['goal', 'add', '--title', 'Refunds', '--preconditions', '["refund API", "ledger entries"]', '--non-goals', '["chargebacks"]', '--plan-after', JSON.stringify([G]), '--reason', 'billing first'], sup);
    let gv = json(must(['goal', 'show', Gj, '--json']));
    assert.deepEqual(gv.preconditions, ['refund API', 'ledger entries'], 'a JSON array is the list, not one item');
    assert.deepEqual(gv.non_goals, ['chargebacks']);
    assert.deepEqual(gv.plan_after.map((p) => p.goal), [G]);
    must(['goal', 'set', Gj, '--preconditions', 'refund API', 'ledger entries', 'emails sent', '--non-goals', 'chargebacks', 'disputes'], sup);
    gv = json(must(['goal', 'show', Gj, '--json']));
    assert.deepEqual(gv.preconditions, ['refund API', 'ledger entries', 'emails sent'], 'separate values still work');
    assert.deepEqual(gv.non_goals, ['chargebacks', 'disputes']);
    must(['goal', 'set', Gj, '--preconditions', 'refunds clear in a day'], sup);
    assert.deepEqual(json(must(['goal', 'show', Gj, '--json'])).preconditions, ['refunds clear in a day'], 'one plain value is one item');
    for (const [flag, bad] of [['--preconditions', '["a", "b"'], ['--preconditions', '[1, 2]'], ['--non-goals', '["a", {"b": 1}]'], ['--preconditions', '[not json]']]) {
      const r = dt(['goal', 'set', Gj, flag, bad], sup);
      assert.notEqual(r.status, 0, `${flag} ${bad} refused`);
      assert.match(r.err, /looks like JSON but is not an array of strings/);
    }
    const Gk = must(['goal', 'add', '--title', 'Braces', '--preconditions', '{"a": 1}'], sup);
    assert.deepEqual(json(must(['goal', 'show', Gk, '--json'])).preconditions, ['{"a": 1}'], 'only a value starting with [ is read as JSON');
    assert.deepEqual(json(must(['goal', 'show', Gj, '--json'])).preconditions, ['refunds clear in a day'], 'a refused set changes nothing');
  });

  await t.test('approve-plan accepts a one-way door the owner answered for the ticket\'s goal, cited, when the plan review says it covers the plan', () => {
    const sup = { role: 'sup' };
    const tk = { title: 'card vault', feature: 'billing', component: 'bill', kind: 'build', size: 'S', risk: 'high', serves: ['BILL-S1'], depends_on: [], touches: ['billing/vault/**'], done_when: ['vault test passes in CI'], one_way_doors: ['who may see card details'] };
    must(['ticket', 'add', 'bill-02-vault', '--json', JSON.stringify(tk)], sup);
    // the door answered while designing the goal (goals test); another goal's door; an unanswered one
    const D1 = json(must(['questions', '--json', '--all'])).find((q) => q.kind === 'one-way-door' && q.goal === G && q.status === 'answered')?.id;
    assert.ok(D1, 'the goal-level door from the design');
    const G2 = must(['goal', 'add', '--title', 'Invoices', '--outcome', 'finance exports invoices', '--measure', 'invoices exported', '--target', '10', '--unit', 'n', '--direction', 'up', '--horizon', '2027-06-30', '--non-goals', 'tax', '--preconditions', 'invoice model', '--priority', '8'], sup);
    const Dx = must(['ask', '--kind', 'one-way-door', '--goal', G2, '--question', 'Who may see invoices?', '--recommendation', 'finance only'], sup);
    must(['answer', Dx, 'finance only']);
    const Dopen = must(['ask', '--kind', 'one-way-door', '--goal', G, '--question', 'Keep card fingerprints?', '--recommendation', 'no'], sup);
    git(['worktree', 'add', '-q', '-b', 'ticket/bill-02-vault', wt('bill-02-vault'), 'HEAD']);
    const tdir = path.join(wt('bill-02-vault'), 'docs/devteam/project/tickets/bill-02-vault');
    const commit = (msg) => { git(['add', '-A'], wt('bill-02-vault')); git(['commit', '-qm', msg], wt('bill-02-vault')); return git(['rev-parse', 'HEAD'], wt('bill-02-vault')); };
    write(path.join(tdir, 'plan.md'), '# plan\n\n## TL;DR\n\n- store cards with the processor; admins see the last four\n\n## Tasks\n\n- T1 vault\n');
    const p1 = commit('bill-02-vault: plan');
    write(path.join(tdir, 'reviews/plan-1.md'), review('reviewer-a', p1));
    commit('bill-02-vault: plan review');
    const ap = (...extra) => dt(['act', '--class', 'approve-plan', '--refs', 'bill-02-vault', ...extra, '--', 'plan ok'], sup);
    assert.match(ap().err, /lists one-way doors; .*--approved <qid>/, 'not without citing the goal-level answer');
    assert.match(ap('--approved', Dx).err, new RegExp(`answered a one-way door for goal ${G2}, .*serves ${G}; an answer for another goal never covers this plan`));
    assert.match(ap('--approved', Dopen).err, /is not an answered question/, 'an unanswered door counts for nothing');
    assert.match(ap('--approved', D1).err, new RegExp(`must say "- Goal-level door: ${D1} covers this plan"`), 'the plan review says the plan stays inside the answer');
    // the statement must be in the latest approving review, for this qid
    write(path.join(tdir, 'reviews/plan-1.md'), review('reviewer-a', p1).replace('\n\n|', `\n- Goal-level door: ${Dx} covers this plan\n\n|`));
    commit('review names another door');
    assert.match(ap('--approved', D1).err, /must say "- Goal-level door:/);
    write(path.join(tdir, 'reviews/plan-1.md'), review('reviewer-a', p1).replace('\n\n|', `\n- Goal-level door: ${D1} covers this plan\n\n|`));
    commit('review covers the door');
    write(path.join(tdir, 'reviews/plan-2.md'), `- Reviewer: reviewer-c\n- Goal-level door: ${D1} covers this plan\n\nVerdict: CHANGES ${p1}\n`);
    commit('a later pass rejects');
    assert.match(ap('--approved', D1).err, /must say "- Goal-level door:/, 'a later CHANGES pass is the latest');
    write(path.join(tdir, 'reviews/plan-2.md'), `- Reviewer: reviewer-c\n- Goal-level door: ${D1} covers this plan.\n\nVerdict: APPROVE ${p1}\n`);
    commit('a later pass approves');
    const act = must(['act', '--class', 'approve-plan', '--refs', 'bill-02-vault', '--approved', D1, '--', 'plan ok'], sup);
    assert.equal(json(must(['log', '--type', 'act', '--json'])).find((a) => a.id === act).approved_by, D1, 'the act names the goal-level answer it used');
    // a goal-level answer is cited only for a ticket with a door; the ticket-level path is unchanged
    assert.match(dt(['act', '--class', 'approve-plan', '--refs', 'bill-01-card', '--approved', D1, '--', 'plan ok'], sup).err, /lists no one-way doors/);
    must(['ticket', 'set', 'bill-02-vault', '--json', JSON.stringify({ one_way_doors: ['who may see card details', 'keep fingerprints'] })], sup);
    const Dt = must(['ask', '--kind', 'one-way-door', '--ticket', 'bill-02-vault', '--question', 'Keep card fingerprints for this vault?', '--recommendation', 'no'], sup);
    fs.rmSync(path.join(tdir, 'reviews'), { recursive: true });
    commit('no reviews');
    assert.match(ap().err, /lists one-way doors/, 'an open ticket-level door is not an answer');
    must(['answer', Dt, 'no']);
    must(['act', '--class', 'approve-plan', '--refs', 'bill-02-vault', '--', 'plan ok'], sup);
    // a defaulted answer never counts: a one-way door never has a default, so it can't be defaulted
    assert.match(dt(['ask', '--kind', 'one-way-door', '--goal', G, '--question', 'x?', '--default', 'yes'], sup).err, /never has a default/);
    git(['worktree', 'remove', '--force', wt('bill-02-vault')]);
  });

  await t.test('a ticket\'s merge gate fails validate only for overlaps that are its own (D4)', () => {
    const sup = { role: 'sup' };
    const tk = (title) => JSON.stringify({ title, feature: 'billing', component: 'bill', kind: 'build', size: 'S', risk: 'normal', serves: ['BILL-S1'], depends_on: [], touches: ['billing/shared/**'], done_when: ['tests pass in CI'] });
    must(['ticket', 'add', 'bill-03-a', '--json', tk('a')], sup);
    must(['ticket', 'add', 'bill-04-b', '--json', tk('b')], sup);
    const v = (ticket) => { if (ticket) process.env.DEVTEAM_GATE_TICKET = ticket; try { const r = dt(['validate'], sup); return r.out + r.err; } finally { delete process.env.DEVTEAM_GATE_TICKET; } };
    const D4 = /bill-03-a and bill-04-b can run concurrently/;
    assert.match(v(), D4);
    assert.doesNotMatch(v().split('\n').filter((l) => D4.test(l)).join(), /not .*'s to fix/, 'unscoped, the supervisor sees an error');
    assert.match(v('bill-02-vault'), /warning: bill-03-a and bill-04-b .* not bill-02-vault's to fix/, "another ticket's gate only warns");
    assert.doesNotMatch(v('bill-03-a'), /not bill-03-a's to fix/, 'a ticket in the overlap still fails');
    must(['ticket', 'set', 'bill-04-b', '--json', JSON.stringify({ depends_on: ['bill-03-a'] })], sup);
    assert.doesNotMatch(v(), D4);
    // another ticket's own error (D3: a dependency the branch can't see) only warns under a gate
    must(['ticket', 'set', 'bill-04-b', '--json', JSON.stringify({ depends_on: ['bill-03-a', 'bill-99-later'] })], sup);
    assert.match(v(), /bill-04-b: depends_on "bill-99-later" does not exist \(D3\)$/m, 'unscoped: an error');
    assert.match(v('bill-02-vault'), /warning: bill-04-b: depends_on "bill-99-later" .*not bill-02-vault's to fix/);
    assert.doesNotMatch(v('bill-04-b'), /not bill-04-b's to fix/, "the ticket's own error still fails its gate");
    must(['ticket', 'set', 'bill-04-b', '--json', JSON.stringify({ depends_on: ['bill-03-a'] })], sup);
    // blocked for 2h: the supervisor's to unblock, unless it waits on the owner's answer to a question
    const at = new Date(Date.now() - 2 * 3600000);
    const stamp = at.toISOString().replace(/[-:T]/g, '').replace('.', '').slice(0, 17);
    fs.appendFileSync(path.join(repo, 'docs/devteam/run/log/bill-03-a.jsonl'), line({ id: `h-${stamp.slice(0, 8)}-${stamp.slice(8)}-bill-03-a`, type: 'phase', op: 'new', at: at.toISOString(), by: 'bill-03-a', to: 'blocked' }));
    const kinds = () => json(must(['metrics', '--json'])).findings.filter((f) => f.subject === 'bill-03-a').map((f) => f.kind);
    assert.ok(kinds().includes('blocked'), 'blocked for 2h on nobody in particular');
    const Qo = must(['ask', '--ticket', 'bill-03-a', '--question', 'Which shared module name?', '--recommendation', 'billing-shared'], sup);
    assert.deepEqual(kinds().filter((k) => k.startsWith('blocked')), ['blocked-on-owner'], "waiting on the owner's answer: say which question, don't tell the supervisor to act");
    assert.match(json(must(['metrics', '--json'])).findings.find((f) => f.kind === 'blocked-on-owner').detail, new RegExp(Qo));
    must(['withdraw', Qo, '--reason', 'test'], sup);
  });

  await t.test("spend is measured from the harnesses' own session logs, attributed and priced", () => {
    const home = path.join(tmp, 'harness-home');
    const slug = fs.realpathSync(repo).replace(/[^a-zA-Z0-9]/g, '-');
    const now = new Date().toISOString();
    // Claude Code: a worker's transcript in its worktree's folder; the same message on two lines counts once
    const msg = (id, model, u) => JSON.stringify({ type: 'assistant', timestamp: now, cwd: '/somewhere/else', message: { id, model, usage: u } });
    const u1 = { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 1000000, cache_creation_input_tokens: 0 };
    write(path.join(home, 'claude/projects', `${slug}--worktrees-bill-03-a`, 's1.jsonl'), [msg('m1', 'claude-opus-5-5', u1), msg('m1', 'claude-opus-5-5', u1), JSON.stringify({ type: 'user', message: { content: 'no usage here' } })].join('\n') + '\n');
    // a subagent of the supervisor, in the main checkout's folder; 1h cache writes cost 2x input
    write(path.join(home, 'claude/projects', slug, 's2', 'subagents', 'a.jsonl'), msg('m2', 'claude-sonnet-5-5', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 1000000, cache_creation: { ephemeral_1h_input_tokens: 1000000 } }) + '\n');
    // a reviewer the supervisor ran as its own subagent: its task names the ticket, so the ticket pays (final review)
    write(path.join(home, 'claude/projects', slug, 's3', 'subagents', 'r.jsonl'), [JSON.stringify({ type: 'user', message: { content: 'You are final reviewer A for bill-03-a. Your default verdict is not approved.' } }), msg('m4', 'claude-opus-5-5', { input_tokens: 0, output_tokens: 1000 })].join('\n') + '\n');
    // another project's folder is never read
    write(path.join(home, 'claude/projects', `${slug}-other`, 's.jsonl'), msg('m3', 'claude-opus-5-5', { input_tokens: 9e9, output_tokens: 0 }) + '\n');
    // Codex: a session in the main checkout, a model the kit can't price; totals are cumulative
    const ev = (o) => JSON.stringify({ timestamp: now, ...o });
    write(path.join(home, 'codex/sessions/2026/11/02/rollout-1.jsonl'), [
      ev({ type: 'session_meta', payload: { cwd: repo } }), ev({ type: 'turn_context', payload: { model: 'gpt-x' } }),
      ev({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 500, cached_input_tokens: 100, output_tokens: 50 } } } }),
      ev({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 800, cached_input_tokens: 100, output_tokens: 70 } } } }),
    ].join('\n') + '\n');
    const env0 = { c: process.env.CLAUDE_CONFIG_DIR, x: process.env.CODEX_HOME };
    process.env.CLAUDE_CONFIG_DIR = path.join(home, 'claude');
    process.env.CODEX_HOME = path.join(home, 'codex');
    try {
      const m = json(must(['metrics', '--json']));
      assert.equal(m.cost.source, 'measured');
      assert.equal(m.cost.by_model['claude-opus-5-5'].usd, 0.24, '1k in at $4 + 1k out at $20 + 1M cache reads at $0.20, counted once; plus the reviewer subagent');
      assert.equal(m.cost.by_model['claude-sonnet-5-5'].usd, 4, '1M one-hour cache writes at 2x $2');
      assert.equal(m.cost.by_ticket['bill-03-a'], 0.24, "charged to the ticket whose worktree it ran in, plus its reviewer subagent's $0.02");
      assert.equal(m.phase_usd.blocked, 0.22, 'and to the phase the ticket was in then');
      assert.equal(m.phase_usd['final-review'], 0.02, "the reviewer's to final review, not the supervisor");
      assert.equal(m.phase_usd.supervisor, 4, "the main checkout's sessions are the supervisor's");
      assert.equal(m.cost.tokens.output, 1000 + 1000 + 70);
      assert.deepEqual(Object.keys(m.cost.unpriced_models), ['gpt-x']);
      assert.ok(m.findings.some((f) => f.kind === 'unpriced-model' && /gpt-x/.test(f.subject)), 'tokens with no price are said, not dropped');
      assert.equal(json(must(['dashboard-data'])).tickets.find((x) => x.id === 'bill-03-a').usd, 0.244);
      assert.ok(fs.existsSync(path.join(repo, 'docs/devteam/run/cache/usage.json')), 'parsed files are cached');
      assert.equal(json(must(['metrics', '--json'])).cost.by_model['claude-opus-5-5'].usd, 0.24, 'the same from the cache');
      // observe: the supervisor's tick records spend lines; again records nothing new
      assert.match(must(['observe-metrics'], { role: 'sup' }), /recorded 3 spend line\(s\)/, 'one per agent and phase: bill-03-a (blocked, and final-review from its reviewer), and the supervisor (its subagent and the codex session in the main checkout)');
      assert.match(must(['observe-spend'], { role: 'sup' }), /recorded 0 spend line/);
      const lines = json(must(['log', '--type', 'spend', '--json']));
      assert.ok(lines.every((l) => l.created_by === 'supervisor' && l.through), 'written by the supervisor, each with how far it counted');
      assert.deepEqual(lines.filter((l) => l.who === 'bill-03-a').map((l) => l.phase).sort(), ['blocked', 'final-review']);
      assert.match(dt(['observe-spend'], { role: 'planner' }).err, /the supervisor does this/, 'a worker or planner never writes spend');
      // durable: with the harness logs gone, spend is the log's
      fs.rmSync(home, { recursive: true, force: true });
      const m2 = json(must(['metrics', '--json']));
      assert.equal(m2.cost.by_ticket['bill-03-a'], 0.24, 'spend survives the harness cleaning up its logs');
      assert.equal(m2.cost.by_model['claude-sonnet-5-5'].usd, 4);
      assert.deepEqual(Object.keys(m2.cost.unpriced_models), ['gpt-x'], 'unpriced tokens are kept on the line too');
    } finally {
      for (const [k, v] of [['CLAUDE_CONFIG_DIR', env0.c], ['CODEX_HOME', env0.x]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
});
