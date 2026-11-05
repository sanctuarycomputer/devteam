// End-to-end test of the kit against a throwaway repo: plan PR, worker lifecycle, questions,
// trust, corrections, forgery, log-sync, and the computed views. Run: node --test  (DEVTEAM_TEST_KEEP=1 keeps the fixture)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'devteam');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-kit-'));
const origin = path.join(tmp, 'origin.git');
const repo = path.join(tmp, 'repo');
const wt = (name) => path.join(repo, '.worktrees', name);
const DT = path.join(repo, 'docs', 'devteam', 'scripts', 'devteam.mjs');
// The tmux session a project's workers live in: devteam-<project>-<hash of the checkout's path>.
function sessionOf(root, name) { return `devteam-${name}-${crypto.createHash('sha1').update(fs.realpathSync(root)).digest('hex').slice(0, 6)}`; }
const S = () => sessionOf(repo, 'demo');
const ROLE = { sup: { DEVTEAM_ROLE: 'supervisor' }, planner: { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'billing' }, planner2: { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'other' }, alpha: { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'alpha' }, legacy: { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'legacy' }, worker: { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'bill-01-card' }, owner: {} };
const line = (o) => `${JSON.stringify({ v: 1, ...o })}\n`;
// tmux in this test talks to its own server, never the developer's (or a live fleet's) sessions.
process.env.TMUX_TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-tmux-'));
delete process.env.TMUX;
delete process.env.TMUX_PANE;
// Dashboards started by tests never use the machine's real ports or become its hub: the hub and
// the instance block move to ports the tests own.
// Each run owns a block of 100 ports, so two suites on one machine don't collide either: the
// file-wide hub and instance block at X, the ports test at X+30, the hub test at X+60.
const PORTS = 20000 + (process.pid % 290) * 100; // below 49152, where the OS hands out ephemeral ports
process.env.DEVTEAM_HUB_PORT = String(PORTS);
process.env.DEVTEAM_PORT_BASE = String(PORTS + 1);
const hasTmux = spawnSync('tmux', ['-V']).status === 0;
// A port the OS says is free: a random one in a range can land on a machine's own listener (macOS's
// AirPlay receiver holds 5000 and answers 403), which then passes the test's startup probe.
const freePort = () => new Promise((resolve, reject) => { const v = net.createServer(); v.on('error', reject); v.listen(0, '127.0.0.1', () => { const { port } = v.address(); v.close(() => resolve(port)); }); });
// Wait for a server the test started to answer: up to 30s, since a loaded machine starts it slowly;
// a server that never answers fails here, not at the test's first real request.
const serverUp = async (url) => { for (let i = 0; i < 300; i++) { try { await fetch(url); return; } catch { await new Promise((r) => setTimeout(r, 100)); } } throw new Error(`no server at ${url} after 30s`); };

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
    G = must(['goal', 'add', '--title', 'Self-serve billing', '--outcome', 'admins pay alone', '--measure', 'self-serve share', '--target', '80', '--unit', '%', '--direction', 'up', '--source', 'prod', '--check', 'echo 5', '--horizon', '2027-03-31', '--non-goals', 'enterprise invoicing', '--preconditions', 'cards work', 'prices defined', '--priority', '1'], { role: 'sup' });
    assert.match(G, /^g-\d{8}-\d{9}-supervisor$/);
    must(['goal', 'reading', G, '--run'], { role: 'sup' });
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

  await t.test('goal measures: the source says how a reading is taken, and nobody types one in', (t) => {
    const logDir = path.join(repo, 'docs/devteam/run/log');
    // the lines written by hand here would be forgeries to every later test: put the log back
    const snap = new Map(fs.readdirSync(logDir).map((f) => [f, fs.readFileSync(path.join(logDir, f))]));
    t.after(() => { for (const f of fs.readdirSync(logDir)) if (snap.has(f)) fs.writeFileSync(path.join(logDir, f), snap.get(f)); else fs.rmSync(path.join(logDir, f), { recursive: true, force: true }); });
    let n = 0;
    // a line written by hand, the way a session could write its own file
    const hand = (by, o) => {
      const d = new Date(Date.now() + n++);
      const file = path.join(logDir, fs.readdirSync(logDir).find((f) => f.startsWith(`${by}-`)) ?? `${by}-${d.toISOString().slice(0, 7)}.jsonl`);
      const id = o.op === 'set' ? o.id : `o-${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}-${by}`;
      fs.appendFileSync(file, line({ op: 'new', ...o, id, at: d.toISOString(), by }));
    };
    const readings = (g) => json(must(['goal', 'show', g, '--json'])).readings;
    const rest = ['--non-goals', 'everything else', '--preconditions', 'the work is merged'];
    // no source: a draft can't be approved without one
    const Gn = must(['goal', 'add', '--title', 'Sourceless', '--outcome', 'x', '--measure', 'things', '--target', '0', '--unit', 'n', '--direction', 'down', ...rest, '--priority', '41'], { role: 'sup' });
    assert.match(must(['goal', 'check', Gn]), /no source: how the fleet reads the measure \(repo, prod or owner/);
    assert.match(dt(['goal', 'set', Gn, '--source', 'vibes'], { role: 'sup' }).err, /--source is repo, prod or owner/);

    // repo: the kit runs the check on main and records main's sha; nobody types the number
    const Gr = must(['goal', 'add', '--title', 'Fewer scripts', '--outcome', 'one script', '--measure', 'files in scripts/', '--target', '0', '--unit', 'files', '--direction', 'down', '--source', 'repo', ...rest, '--priority', '42'], { role: 'sup' });
    assert.match(must(['goal', 'check', Gr]), /no check: the command whose last line is the number/);
    must(['goal', 'set', Gr, '--check', 'echo counting; ls docs/devteam/scripts | wc -l'], { role: 'sup' });
    assert.match(dt(['goal', 'reading', Gr, '--value', '0'], { role: 'sup' }).err, /the kit runs its check \(goal reading .* --run\), nobody types the number/);
    const main = git(['rev-parse', 'origin/main']);
    assert.match(must(['goal', 'reading', Gr, '--run'], { role: 'sup' }), new RegExp(`recorded 1 for ${Gr} \\(main at ${main.slice(0, 12)}\\)`));
    assert.deepEqual(readings(Gr).map((r) => [r.value, r.sha, r.source]), [[1, main, 'repo']]);
    hand('supervisor', { type: 'observation', source: 'repo', subject: Gr, kind: 'reading', detail: 'typed', measure: { value: 0, unit: 'files' }, sha: '0123456789abcdef0123456789abcdef01234567' });
    hand('supervisor', { type: 'observation', source: 'supervisor', subject: Gr, kind: 'reading', detail: 'typed', measure: { value: 0, unit: 'files' } });
    assert.equal(readings(Gr).length, 1, 'a repo reading counts only with a commit on main; a typed one never');
    assert.match(dt(['goal', 'status', Gr, 'met']).err, /check reads 1 on main .* not its target 0; --force/, 'met is read again, on main');
    // the check is the supervisor's command: run from the owner's terminal, it still can't act as the owner
    const Gx = must(['goal', 'add', '--title', 'Sly check', '--outcome', 'z', '--measure', 'zero', '--target', '0', '--unit', 'n', '--direction', 'down', '--source', 'repo', '--check', `node '${DT}' goal status ${Gn} abandoned >&2 || true; echo 0`, ...rest, '--priority', '45'], { role: 'sup' });
    must(['goal', 'status', Gx, 'met']);
    assert.notEqual(json(must(['goal', 'show', Gn, '--json'])).status, 'abandoned', "a check the owner's met runs is refused owner commands");

    // prod: run from the main checkout, the output kept
    const Gp = must(['goal', 'add', '--title', 'Prod count', '--outcome', 'y', '--measure', 'records synced', '--target', '10', '--unit', 'records', '--direction', 'up', '--source', 'prod', '--check', 'echo 7', ...rest, '--priority', '43'], { role: 'sup' });
    assert.match(dt(['goal', 'reading', Gp, '--value', '10'], { role: 'sup' }).err, /read from prod: the kit runs its check/);
    must(['goal', 'reading', Gp, '--run'], { role: 'sup' });
    hand('supervisor', { type: 'observation', source: 'supervisor', subject: Gp, kind: 'reading', detail: 'typed', measure: { value: 10, unit: 'records' } });
    assert.deepEqual(readings(Gp).map((r) => [r.value, r.source]), [[7, 'prod']]);

    // owner: target 1, unit attested, from 0; only the owner's yes moves it
    const Go = must(['goal', 'add', '--title', 'Sync validated', '--outcome', 'drifted records fix themselves', '--measure', 'validated on a real drifted record', '--source', 'owner', ...rest, '--priority', '44'], { role: 'sup' });
    assert.match(must(['goal', 'check', Go]), /no question: the yes\/no the owner answers/);
    must(['goal', 'set', Go, '--question', 'Have you validated sync on a drifted record in production?'], { role: 'sup' });
    const gc = must(['goal', 'check', Go]);
    for (const gap of [/no numeric target/, /no unit/, /no direction/, /no baseline reading/, /no source/]) assert.doesNotMatch(gc, gap);
    const ov = json(must(['goal', 'show', Go, '--json']));
    assert.deepEqual([ov.measure.target, ov.measure.unit, ov.measure.direction], [1, 'attested', 'up']);
    assert.match(dt(['goal', 'reading', Go, '--value', '1'], { role: 'sup' }).err, /the owner's yes: ask a goal-met question/);
    const metQ = (extra = []) => ['ask', '--class', 'goal-met', '--goal', Go, '--question', 'Have you validated sync on a drifted record in production?', ...extra];
    assert.match(dt(metQ(), { role: 'sup' }).err, /recommends the answer that meets it/);
    assert.match(dt(metQ(['--recommendation', 'yes', '--default', 'yes']), { role: 'sup' }).err, /has no --default/);
    assert.match(dt(['ask', '--class', 'goal-met', '--goal', Gr, '--question', 'Done?', '--recommendation', 'yes'], { role: 'sup' }).err, /is read from repo/);
    const Qwrong = must(['ask', '--class', 'release-scope', '--goal', Go, '--question', 'Is it validated?', '--recommendation', 'yes'], { role: 'sup' });
    must(['answer', Qwrong, 'yes']);
    assert.match(dt(['goal', 'reading', Go, '--approved', Qwrong], { role: 'sup' }).err, /class release-scope, not goal-met/);
    const Qm = must(metQ(['--recommendation', 'yes']), { role: 'sup' });
    assert.match(dt(['goal', 'reading', Go, '--approved', Qm], { role: 'sup' }).err, /not answered by the owner \(open\)/);
    assert.notEqual(dt(['answer', Qm, 'yes', '--from-chat', '--said', 'yes'], { role: 'sup' }).status, 0, 'goal-met is owner-only: never answered from chat');
    hand('supervisor', { type: 'observation', source: 'owner', subject: Go, kind: 'reading', detail: 'typed', measure: { value: 1, unit: 'attested' } });
    hand('supervisor', { type: 'observation', source: 'owner', subject: Go, kind: 'reading', detail: 'typed', measure: { value: 1, unit: 'attested' }, approved: Qm });
    assert.deepEqual(readings(Go), [], 'a hand-written reading attests nothing: not alone, not with an unanswered question');
    assert.match(dt(['goal', 'status', Go, 'met']).err, /met when the owner says so/);
    const Qno = must(metQ(['--recommendation', 'yes']), { role: 'sup' });
    must(['answer', Qno, 'not yet']);
    assert.match(dt(['goal', 'reading', Go, '--approved', Qno], { role: 'sup' }).err, /answered "not yet", not its recommendation/);
    const Qchat = must(metQ(['--recommendation', 'yes']), { role: 'sup' });
    hand('owner', { type: 'question', op: 'set', id: Qchat, channel: 'chat', answer: 'yes', said: 'yes' });
    assert.match(dt(['goal', 'reading', Go, '--approved', Qchat], { role: 'sup' }).err, /answered in chat/);
    hand('supervisor', { type: 'observation', source: 'owner', subject: Go, kind: 'reading', detail: 'typed', measure: { value: 1, unit: 'attested' }, approved: Qchat });
    assert.deepEqual(readings(Go), [], 'a chat answer written by hand attests nothing');
    // the hand-written line above cited Qm before the owner answered: it still counts for nothing
    must(['answer', Qm, 'yes']);
    assert.deepEqual(readings(Go), [], 'a reading written before the answer never counts');
    assert.match(must(['goal', 'reading', Go, '--approved', Qm], { role: 'sup' }), new RegExp(`recorded 1 for ${Go} \\(${Qm}\\)`));
    assert.match(dt(['goal', 'reading', Go, '--approved', Qm], { role: 'sup' }).err, /one answer, one reading/);
    hand('supervisor', { type: 'observation', source: 'owner', subject: Go, kind: 'reading', detail: 'again', measure: { value: 1, unit: 'attested' }, approved: Qm });
    assert.deepEqual(readings(Go).map((r) => [r.value, r.approved]), [[1, Qm]], 'each answer authorises one reading');
    must(['goal', 'status', Go, 'met']);
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
      spawnSync('tmux', ['new-session', '-d', '-s', S(), '-n', 'someone-else', 'sleep 600']);
      try {
        assert.match(staleF().detail, /its tmux window is gone/);
        assert.match(staleF().suggestion, /worker bill-01-card --resume/);
      } finally { spawnSync('tmux', ['kill-session', '-t', `=${S()}`]); }
    }
    // idle at its prompt with its own background shell still running: say so, and suggest the nudge
    if (hasTmux) {
      spawnSync('tmux', ['new-session', '-d', '-s', S(), '-n', 'bill-01-card', 'sh -c \'printf "done 11:07 AM\\n> \\n  bypass permissions on \\302\\267 1 shell \\302\\267 to manage\\n"; exec sleep 600\'']);
      try {
        for (let i = 0; i < 20 && !/1 shell/.test(spawnSync('tmux', ['capture-pane', '-p', '-t', `=${S()}:bill-01-card`], { encoding: 'utf8' }).stdout ?? ''); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
        assert.match(staleF().detail, /idle at its prompt with a background shell still running/);
        assert.match(staleF().suggestion, /send bill-01-card "check your background shell's result/);
      } finally { spawnSync('tmux', ['kill-session', '-t', `=${S()}`]); }
    }
    // stopped on an API or network error: say so, and suggest the nudge
    if (hasTmux) {
      spawnSync('tmux', ['new-session', '-d', '-s', S(), '-n', 'bill-01-card', 'sh -c \'printf "API Error: Cannot reach the API server - check your internet or DNS (ENOTFOUND)\\ndone 9:19 PM\\n> \\n"; exec sleep 600\'']);
      try {
        for (let i = 0; i < 20 && !/ENOTFOUND/.test(spawnSync('tmux', ['capture-pane', '-p', '-t', `=${S()}:bill-01-card`], { encoding: 'utf8' }).stdout ?? ''); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
        assert.match(staleF().detail, /stopped on an API or network error/);
        assert.match(staleF().suggestion, /send bill-01-card "the network dropped/);
      } finally { spawnSync('tmux', ['kill-session', '-t', `=${S()}`]); }
    }
    // the agent quit and left its window at a shell prompt: agent-exited, with the resume, not stale
    if (hasTmux) {
      spawnSync('tmux', ['new-session', '-d', '-s', S(), '-n', 'bill-01-card', 'sh']);
      try {
        const fs_ = json(must(['metrics', '--json'])).findings;
        const ex = fs_.find((f) => f.kind === 'agent-exited' && f.subject === 'bill-01-card');
        assert.ok(ex, 'a window back at a shell prompt is an exited agent');
        assert.match(ex.detail, /no agent is running .*at a \w+ prompt/);
        assert.match(ex.suggestion, /worker bill-01-card --resume/);
        assert.ok(!fs_.some((f) => f.kind === 'stale-worker' && f.subject === 'bill-01-card'), 'one finding, not two');
      } finally { spawnSync('tmux', ['kill-session', '-t', `=${S()}`]); }
    }
    const Qb = must(['ask', '--question', 'Store card fingerprints?', '--blocks', 'bill-01-card', '--recommendation', 'no'], { role: 'sup' });
    assert.ok(!staleW(), 'a question blocking it means it waits on the owner');
    must(['withdraw', Qb, '--reason', 'test'], { role: 'sup' });
    fs.writeFileSync(sfile, sbefore);
    // a worker frozen on a permission prompt looks busy in the log; its pane says otherwise
    if (hasTmux) {
      spawnSync('tmux', ['new-session', '-d', '-s', S(), '-n', 'bill-01-card', 'sh -c \'printf "Bash command\\n  rm -rf build\\nDo you want to proceed?\\n> 1. Yes\\n  2. No\\n"; exec sleep 600\'']);
      for (let i = 0; i < 20 && !/proceed/.test(spawnSync('tmux', ['capture-pane', '-p', '-t', `=${S()}:bill-01-card`], { encoding: 'utf8' }).stdout ?? ''); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      const f = json(must(['metrics', '--json'])).findings.find((x) => x.kind === 'blocked-prompt');
      assert.equal(f?.subject, 'bill-01-card', 'a blocked-prompt finding names the ticket');
      assert.match(f.detail, /Do you want to proceed\?/);
      assert.equal(json(must(['dashboard-data'])).progress.tickets.find((x) => x.id === 'bill-01-card').waiting.kind, 'prompt', 'the board can badge it');
      assert.match(must(['status']), /bill-01-card.*WAITING ON A PROMPT/);
      spawnSync('tmux', ['kill-server']);
      assert.ok(!json(must(['metrics', '--json'])).findings.some((x) => x.kind === 'blocked-prompt'), 'no pane, no finding');
      // a usage-limit banner, but not source code the pane shows that mentions a rate limit
      const limitPane = (text) => {
        spawnSync('tmux', ['new-session', '-d', '-s', S(), '-n', 'bill-01-card', `sh -c 'printf "${text}"; exec sleep 600'`]);
        for (let i = 0; i < 20 && !/limit/.test(spawnSync('tmux', ['capture-pane', '-p', '-t', `=${S()}:bill-01-card`], { encoding: 'utf8' }).stdout ?? ''); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
        const hit = json(must(['metrics', '--json'])).findings.find((x) => x.kind === 'blocked-prompt');
        spawnSync('tmux', ['kill-server']);
        return hit;
      };
      assert.ok(!limitPane('  43  # Request-path client: a rate limit never sleeps a web worker.\\n  44  def call\\n'), 'a numbered source line is not a banner');
      assert.ok(!limitPane('Retries back off when the API returns a rate limit error.\\n'), 'prose about rate limits is not a banner');
      assert.match(limitPane('5-hour limit reached - resets 3pm\\n')?.detail ?? '', /usage-limit banner/, 'a limit banner is');
      assert.match(limitPane('You have hit your usage limit. Try again later.\\n')?.detail ?? '', /usage-limit banner/, 'another harness\'s wording too');
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
    // main and the work change one file in different places: a clean merge still keeps the verdict,
    // though the three-dot diff's text moved; a hand edit in that merge voids it
    const onMain = (fn, msg) => {
      git(['worktree', 'add', '-q', '--detach', wt('main-moves'), 'origin/main']);
      fn(wt('main-moves'));
      git(['add', '-A'], wt('main-moves'));
      git(['commit', '-qm', msg], wt('main-moves'));
      git(['push', '-q', 'origin', 'HEAD:main'], wt('main-moves'));
      git(['worktree', 'remove', '--force', wt('main-moves')]);
      git(['fetch', '-q', 'origin']);
      git(['merge', '-q', '--ff-only', 'origin/main']);
      git(['fetch', '-q', 'origin'], wt('bill-01-card'));
    };
    const lines = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`);
    onMain((w) => write(path.join(w, 'billing/shared.md'), `${lines.join('\n')}\n`), 'shared file on main');
    git(['merge', '-q', '--no-edit', 'origin/main'], wt('bill-01-card'));
    write(path.join(wt('bill-01-card'), 'billing/shared.md'), `${lines.map((l, i) => (i === 1 ? 'line 2, the ticket\'s' : l)).join('\n')}\n`);
    git(['commit', '-qam', 'the work touches the shared file'], wt('bill-01-card'));
    const V = git(['rev-parse', 'HEAD'], wt('bill-01-card'));
    write(path.join(tdir, 'reviews/final-3.md'), review('reviewer-b', V));
    git(['add', '-A'], wt('bill-01-card'));
    git(['commit', '-qm', 'review 3'], wt('bill-01-card'));
    onMain((w) => { const f = path.join(w, 'billing/shared.md'); write(f, fs.readFileSync(f, 'utf8').replace('line 9', "line 9, main's")); }, 'main edits the shared file elsewhere');
    git(['merge', '-q', '--no-edit', 'origin/main'], wt('bill-01-card'));
    must(['check-ticket', 'bill-01-card', '--sha', git(['rev-parse', 'HEAD'], wt('bill-01-card')), ...pr]);
    fs.appendFileSync(path.join(wt('bill-01-card'), 'billing/shared.md'), 'slipped in during the merge\n');
    git(['commit', '-q', '--amend', '-a', '--no-edit'], wt('bill-01-card'));
    assert.match(dt(['check-ticket', 'bill-01-card', '--sha', git(['rev-parse', 'HEAD'], wt('bill-01-card')), ...pr]).out, /does not hold/, 'a hand edit inside the merge voids it');
    git(['reset', '-q', '--hard', H2], wt('bill-01-card'));
    // filling in a record later (an empty disposition cell, a missing Reviewer line) keeps the verdicts
    // after it; any other edit to the record still voids them
    const changes = (reviewer, sha, disp) => `${reviewer ? `- Reviewer: ${reviewer}\n\n` : ''}| Id | Severity | Rule | Where | Finding | Disposition |\n|---|---|---|---|---|---|\n| F1 | Important | spec | billing/card.js:1 | handles no error | ${disp} |\n\nVerdict: CHANGES ${sha}\n`;
    const head = () => git(['rev-parse', 'HEAD'], wt('bill-01-card'));
    const commitAll = (msg) => { git(['add', '-A'], wt('bill-01-card')); git(['commit', '-qm', msg], wt('bill-01-card')); };
    write(path.join(tdir, 'reviews/final-2.md'), changes(null, H2, ''));
    commitAll('an unnamed review asks for changes');
    fs.appendFileSync(path.join(wt('bill-01-card'), 'billing/card.js'), 'error handled\n');
    commitAll('fix');
    const fixed = head();
    write(path.join(tdir, 'reviews/final-3.md'), review('reviewer-b', fixed));
    commitAll('review 3');
    const r3 = dt(['check-ticket', 'bill-01-card', '--sha', head(), ...pr]);
    assert.doesNotMatch(r3.out, /final-2\.md: no "- Reviewer:" line/, 'an unnamed record a later pass superseded does not fail the ticket');
    assert.match(r3.out, /final-2\.md F1 \(Important\) has no disposition/);
    write(path.join(tdir, 'reviews/final-2.md'), changes('reviewer-a', H2, 'fixed'));
    commitAll('fill in final-2: its reviewer and the disposition');
    must(['check-ticket', 'bill-01-card', '--sha', head(), ...pr]);
    // a row with a stray empty cell before its disposition still has that disposition
    const wide = git(['rev-parse', 'HEAD'], wt('bill-01-card'));
    write(path.join(tdir, 'reviews/final-2.md'), changes('reviewer-a', H2, 'fixed').replace('| fixed |', '|  | fixed |'));
    commitAll('a wider row');
    assert.doesNotMatch(dt(['check-ticket', 'bill-01-card', '--sha', head(), ...pr]).out, /F1 \(Important\) has no disposition/, 'the disposition is read past the stray empty cell');
    git(['reset', '-q', '--hard', wide], wt('bill-01-card'));
    write(path.join(tdir, 'reviews/final-2.md'), changes('reviewer-a', H2, 'fixed').replace('handles no error', 'fine really'));
    commitAll('rewrite a finding');
    assert.match(dt(['check-ticket', 'bill-01-card', '--sha', head(), ...pr]).out, /final-3\.md: its verdict is at .* does not hold/, 'editing a finding voids the verdicts after it');
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
    // one answer, several acts, only when the question named them when it was asked
    assert.match(dt(['ask', '--question', 'x', '--class', 'gate-change', '--approves', 'bill-01-card'], { role: 'sup' }).err, /two or more acts/);
    assert.match(dt(['ask', '--question', 'x', '--class', 'gate-change', '--approves', 'bill-01-card,nope nope'], { role: 'sup' }).err, /--approves nope nope: name a ticket id/);
    assert.match(dt(['ask', '--kind', 'owner-action', '--question', 'x', '--approves', 'bill-01-card,chore-y'], { role: 'sup' }).err, /--approves belongs on an owner-decision/);
    const Qp = must(['ask', '--question', 'Exclude generated files from dead-code, and raise bill-01-card\'s ceiling?', '--class', 'gate-change', '--recommendation', 'yes to both', '--approves', 'chore-dead-code-generated,bill-01-card'], { role: 'sup' });
    assert.deepEqual(json(must(['questions', '--id', Qp, '--json']))[0].approves, ['chore-dead-code-generated', 'bill-01-card']);
    must(['answer', Qp, 'yes to both']);
    assert.match(dt(['act', '--class', 'gate-change', '--approved', Qp, '--', 'which?'], { role: 'sup' }).err, /approves chore-dead-code-generated, bill-01-card; name the one/);
    must(['act', '--class', 'gate-change', '--approved', Qp, '--refs', 'chore-dead-code-generated', '--', 'excluded generated files'], { role: 'sup' });
    assert.match(dt(['act', '--class', 'gate-change', '--approved', Qp, '--refs', 'chore-dead-code-generated', '--', 'again'], { role: 'sup' }).err, /already approved an act for chore-dead-code-generated/, 'each part once');
    must(['act', '--class', 'gate-change', '--approved', Qp, '--refs', 'bill-01-card', '--', 'raised the ceiling'], { role: 'sup' });
    assert.match(dt(['act', '--class', 'gate-change', '--approved', Qp, '--refs', 'bill-02-x', '--', 'and this'], { role: 'sup' }).err, /name the one this act is for/, 'nothing it did not name');
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

  await t.test('decisions: a call records the trust it rests on, acts carry it out, corrections land on the call', () => {
    const sup = { role: 'sup' };
    assert.equal(dt(['decide', '--class', 'release-scope', '--', 'slip BILL-S2'], sup).status, 3, 'decide asks first below rung 3, like act');
    const Qx = must(['ask', '--question', 'Ship the refund flow flagged?', '--class', 'release-scope', '--reasons', 'below-rung', '--recommendation', 'yes'], sup);
    must(['answer', Qx, 'yes']);
    assert.match(dt(['decide', '--class', 'release-scope', '--confidence', '2', '--approved', Qx, '--', 'x'], sup).err, /--confidence is a number from 0 to 1/);
    const D = must(['decide', '--class', 'release-scope', '--approved', Qx, '--options', 'ship flagged', 'hold a week', '--rationale', 'the flag makes it reversible', '--confidence', '0.8', '--refs', 'bill-01-card', '--', 'ship refunds behind a flag'], sup);
    assert.match(D, /^d-\d{8}-\d{9}-supervisor$/);
    const d = json(must(['log', '--id', D, '--json']));
    const dl = Array.isArray(d) ? d[0] : d;
    assert.equal(dl.authority, 'answer');
    assert.equal(dl.rung, 1, 'the rung it was decided on is snapshotted');
    // a decision written by hand can't carry trust it never had: an act under it is refused
    {
      const supFile = path.join(repo, 'docs/devteam/run/log', fs.readdirSync(path.join(repo, 'docs/devteam/run/log')).find((f) => /^supervisor-/.test(f)));
      const before = fs.readFileSync(supFile, 'utf8');
      const fid = 'd-20261101-235959000-supervisor';
      fs.appendFileSync(supFile, line({ id: fid, type: 'decision', op: 'new', at: new Date().toISOString(), by: 'supervisor', class: 'gate-change', what: 'drop the lint gate', refs: ['bill-01-card'], authority: 'answer', approved_by: Qx, reversible: true }));
      assert.match(dt(['act', '--decision', fid, '--', 'dropped it'], sup).err, /records authority it doesn't have \(gate-change is the owner's/);
      fs.appendFileSync(supFile, line({ id: 'd-20261101-235959001-supervisor', type: 'decision', op: 'new', at: new Date().toISOString(), by: 'supervisor', class: 'production-migration', what: 'migrate it', refs: ['bill-01-card'], authority: 'rung', reversible: true }));
      assert.match(dt(['act', '--decision', 'd-20261101-235959001-supervisor', '--', 'shipped'], sup).err, /production-migration is not on rung 3/);
      fs.writeFileSync(supFile, before);
    }
    assert.deepEqual(dl.options, ['ship flagged', 'hold a week']);
    assert.match(dt(['act', '--class', 'release-scope', '--approved', Qx, '--', 'again'], sup).err, new RegExp(`already approved a decision \\(${D}\\)`), 'the answer went to the decision');
    assert.match(dt(['act', '--decision', D, '--class', 'release-production', '--', 'x'], sup).err, /takes its class/);
    assert.match(dt(['act', '--decision', D, '--approved', Qx, '--', 'x'], sup).err, /takes its scope and approval/);
    const A1 = must(['act', '--decision', D, '--', 'turned the refund flag on in staging'], sup);
    const A2 = must(['act', '--decision', D, '--', 'turned it on in production'], sup);
    const acts = json(must(['log', '--type', 'act', '--json'])).filter((a) => a.decision === D);
    assert.deepEqual(acts.map((a) => a.id), [A1, A2], 'one decision, several acts');
    assert.ok(acts.every((a) => a.class === 'release-scope' && !a.approved_by && a.refs.includes('bill-01-card')), 'an act takes its class and refs from the decision');
    assert.match(dt(['correct', A1, '--reason', 'wrong']).err, new RegExp(`carried out ${D}.*problem add`, 's'), 'a correction goes to the decision, or is a problem');
    assert.match(dt(['status', '--decision', D], sup).err, /logs no act/);
    assert.match(dt(['act', '--decision', 'd-20990101-000000000-supervisor', '--', 'x'], sup).err, /no decision/);
    // the Decide view: the supervisor's call with its acts, and the owner's answer it rested on
    let recs = json(must(['decisions', '--json']));
    const rd = recs.find((r) => r.id === D && r.kind === 'decision');
    assert.deepEqual(rd.acts, [A1, A2]);
    assert.equal(rd.under.authority, 'answer');
    assert.deepEqual(recs.find((r) => r.id === Qx && r.kind === 'answer').acts, [D], "the owner's answer, shown as the owner's");
    assert.ok(recs.some((r) => r.kind === 'act' && r.class === 'release-production'), 'an act without a decision is its own call');
    assert.ok(!recs.some((r) => r.id === A1), 'an act under a decision is not a call of its own');
    // an act stays within what its decision covered
    assert.match(dt(['act', '--decision', D, '--refs', 'bill-02-x', '--', 'and this'], sup).err, /bill-02-x is outside it/);
    // another command's act may cite a decision only about what it acts on
    assert.match(dt(['withdraw', Qx, '--decision', D], sup).err, /is about bill-01-card; this withdraw is about/);
    // a project-wide preference is not authority over a class; a rule the owner scoped to the class is
    const K = json(must(['log', '--type', 'knowledge', '--json'])).find((k) => k.statement === 'flags first').id;
    assert.match(dt(['decide', '--class', 'release-scope', '--approved', K, '--', 'flag the export too'], sup).err, /applies to project; a standing rule authorises a call only when the owner scoped it/);
    const Qk = must(['ask', '--question', 'May exports always ship behind a flag?', '--class', 'release-scope', '--recommendation', 'yes'], sup);
    must(['answer', Qk, 'yes', '--rule', 'exports ship behind a flag', '--rule-scope', 'class:release-scope']);
    const K2 = json(must(['log', '--type', 'knowledge', '--json'])).find((k) => k.statement === 'exports ship behind a flag').id;
    const Dk = must(['decide', '--class', 'release-scope', '--approved', K2, '--', 'flag the export too'], sup);
    assert.equal(recs = json(must(['decisions', '--json', '--who', 'supervisor'])).find((r) => r.id === Dk).under.authority, 'standing-rule');
    const Dr = must(['decide', '--class', 'release-production', '--', 'ship v1.0.2'], sup);
    assert.equal(json(must(['decisions', '--json'])).find((r) => r.id === Dr).under.rung, 3);
    const Ds = must(['decide', '--class', 'release-production', '--', 'ship v1.1.0 next week'], sup);
    // trust moves on the decision: a correction drops the class, and the decision can't be carried out again
    must(['correct', Dr, '--reason', 'not before the freeze lifts']);
    const tr = json(must(['trust', '--json'])).find((r) => r.class === 'release-production');
    assert.equal(tr.rung, 1, 'a corrected decision drops its class');
    assert.equal(tr.history.pop().id, Dr, 'the rung history names the call');
    assert.match(dt(['act', '--decision', Dr, '--', 'tagged'], sup).err, /was corrected.*decide again/);
    assert.match(dt(['act', '--decision', Ds, '--', 'tagged v1.1.0'], sup).err, /dropped to rung 1 after .* was decided; decide again/, 'a call made on a rung lapses when the class drops');
    must(['repair', Dr, '--how', 'none'], sup);
    assert.ok(json(must(['decisions', '--json', '--corrected'])).some((r) => r.id === Dr && r.kind === 'decision'));
    const dash = json(must(['dashboard-data']));
    assert.ok(dash.ooda.decisions.some((r) => r.id === D), 'the dashboard has the Decide feed');
    assert.equal(dash.ooda.acts.find((a) => a.id === A1).under.decision, D);
  });

  await t.test('every field in the log schema says what it means (the sidepeek shows it as the key\'s tooltip)', () => {
    const s = JSON.parse(fs.readFileSync(path.join(kit, 'schema', 'log.schema.json'), 'utf8'));
    const bare = Object.entries(s.$defs.types).flatMap(([type, d]) => Object.entries(d.properties ?? {}).filter(([, v]) => !v.description).map(([k]) => `${type}.${k}`));
    assert.deepEqual(bare, [], 'add a description to each');
    const r = json(must(['record', G, '--json']));
    assert.equal(r.type, 'goal');
    assert.ok(r.fields.title && r.set_by && !('hold_by' in r.fields));
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
    assert.match(dt(['knowledge', 'add', '--kind', 'lesson', '--statement', 'mock smtp', '--scope', 'component:bill'], { role: 'sup' }).err, /a lesson names what it rests on/);
    assert.match(dt(['knowledge', 'add', '--kind', 'lesson', '--statement', 'mock smtp', '--evidence', 'o-20200101-000000000-nobody'], { role: 'sup' }).err, /no such log entry/);
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
    // a planner's monthly file is its own stream: lines older than its plan file's (landed later by
    // the plan PR) are in order
    const stamp = (ms) => { const d = new Date(Date.now() - ms); return { at: d.toISOString(), id: d.toISOString().replace(/[-:T]/g, '').replace('.', '').slice(0, 17) }; };
    const older = stamp(2 * 3600000), newer = stamp(3600000);
    const msgLine = (s, by) => line({ id: `m-${s.id.slice(0, 8)}-${s.id.slice(8)}-${by}`, type: 'message', op: 'new', at: s.at, by, to: 'supervisor', kind: 'info', text: 'x' });
    const onMainZ = (fn, msg) => {
      git(['worktree', 'add', '-q', '--detach', wt('zeta-main'), 'origin/main']);
      fn(wt('zeta-main'));
      git(['add', '-A'], wt('zeta-main'));
      git(['commit', '-qm', msg], wt('zeta-main'));
      git(['push', '-q', 'origin', 'HEAD:main'], wt('zeta-main'));
      git(['worktree', 'remove', '--force', wt('zeta-main')]);
    };
    onMainZ((w) => write(path.join(w, 'docs/devteam/project/log/plan-zeta.jsonl'), msgLine(newer, 'plan-zeta')), 'plan-zeta lands');
    git(['fetch', '-q', 'origin'], wt('chore-log'));
    git(['merge', '-q', '--no-edit', 'origin/main'], wt('chore-log'));
    const zetaMonthly = `docs/devteam/project/log/plan-zeta-${older.at.slice(0, 7)}.jsonl`;
    write(path.join(wt('chore-log'), zetaMonthly), msgLine(older, 'plan-zeta'));
    git(['add', zetaMonthly], wt('chore-log'));
    git(['commit', '-qm', 'sync the planner monthly file'], wt('chore-log'));
    must(['check-pr', '--head-ref', 'chore-log', '--sha', git(['rev-parse', 'HEAD'], wt('chore-log')), '--title', 'chore-log: sync', '--body-file', body], { role: 'sup' });
    git(['reset', '-q', '--hard', shaL], wt('chore-log'));
    onMainZ((w) => fs.rmSync(path.join(w, 'docs/devteam/project/log/plan-zeta.jsonl')), 'test cleanup: plan-zeta');
    git(['fetch', '-q', 'origin']);
    git(['merge', '-q', '--ff-only', 'origin/main']);
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

  await t.test('an answer one act recorded can approve the merge that lands it, once', () => {
    const setTo = (w, fn) => {
      const f = path.join(w, 'docs/devteam/project/settings.md');
      const txt = fs.readFileSync(f, 'utf8');
      const m = txt.match(/```json devteam\s*\n([\s\S]*?)\n```/);
      const j = JSON.parse(m[1]);
      fn(j);
      fs.writeFileSync(f, txt.replace(m[1], JSON.stringify(j, null, 2)));
    };
    // an answer one act recorded for this chore can approve the merge that lands it; a second use can't
    const Qc = must(['ask', '--question', 'Raise the dead-code ceiling to 230?', '--class', 'gate-change', '--reasons', 'owner-only', '--recommendation', 'yes'], { role: 'sup' });
    must(['answer', Qc, 'yes']);
    must(['act', '--class', 'gate-change', '--approved', Qc, '--refs', 'chore-wig-big', '--', 'dead-code ceiling to 230'], { role: 'sup' });
    git(['worktree', 'add', '-q', '-B', 'chore-wig-big', wt('wig-big'), 'origin/main']);
    setTo(wt('wig-big'), (j) => { j.gates = { ...(j.gates ?? {}), dead: { cmd: 'true', ceiling: 230 } }; });
    git(['commit', '-qam', 'big'], wt('wig-big'));
    git(['push', '-q', '-f', 'origin', 'chore-wig-big'], wt('wig-big'));
    const big = ['merge', '--chore', 'wig-big', '--dry-run', '--approved', Qc, '--title', 'chore-wig-big: ceiling', '--body-file', body];
    assert.doesNotMatch(dt(big, { role: 'sup' }).out, /already approved an act/, 'the merge lands what the act recorded');
    assert.match(dt(['act', '--class', 'gate-change', '--approved', Qc, '--refs', 'chore-wig-big', '--', 'again'], { role: 'sup' }).err, /already approved an act/, 'a second act on one answer is still refused');
    git(['worktree', 'remove', '--force', wt('wig-big')]);
  });

  await t.test("the owner's CI-fix rule approves a workflow-only chore that keeps every job", () => {
    const wf = '.github/workflows/devteam.yml';
    assert.ok(git(['show', `origin/main:${wf}`]), 'init --github put the workflow on main');
    const branch = (slug, edit) => {
      git(['worktree', 'add', '-q', '-B', `chore-${slug}`, wt(slug), 'origin/main']);
      edit(wt(slug));
      git(['add', '-A'], wt(slug));
      git(['commit', '-qm', slug], wt(slug));
      git(['push', '-q', '-f', 'origin', `chore-${slug}`], wt(slug));
      return ['merge', '--chore', slug, '--dry-run', '--title', `chore-${slug}: fix CI`, '--body-file', body];
    };
    const fix = branch('ci-fix-node', (w) => fs.writeFileSync(path.join(w, wf), fs.readFileSync(path.join(w, wf), 'utf8').replace('node-version: 22', 'node-version: 24')));
    assert.match(dt(fix, { role: 'sup' }).out, /outside project\//, 'no rule yet: the owner answers');
    const Q = must(['ask', '--question', 'Fix the broken CI file?', '--class', 'gate-change', '--reasons', 'owner-only', '--recommendation', 'yes', '--rule-scope', 'chore:ci-fix'], { role: 'sup' });
    must(['answer', Q, 'yes', '--rule', 'You may fix broken CI files without me.']);
    assert.match(must(fix, { role: 'sup' }), /changes only workflow files and keeps every job; approved by the owner's standing rule/);
    const drop = branch('ci-fix-drop', (w) => fs.writeFileSync(path.join(w, wf), fs.readFileSync(path.join(w, wf), 'utf8').replace(/\n {2}check-pr:[\s\S]*$/, '\n  other:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n')));
    assert.match(dt(drop, { role: 'sup' }).out, /doesn't cover removing jobs \(\.github\/workflows\/devteam\.yml: check-pr\)/, "a fix can't drop a check");
    const gut = branch('ci-fix-gut', (w) => fs.writeFileSync(path.join(w, wf), fs.readFileSync(path.join(w, wf), 'utf8').replace(/node docs\/devteam\/scripts\/devteam\.mjs check-pr[^\n]*/, 'true')));
    assert.match(dt(gut, { role: 'sup' }).out, /doesn't cover removing devteam's own check/, 'nor keep the job but empty it');
    const more = branch('ci-fix-more', (w) => { fs.writeFileSync(path.join(w, wf), fs.readFileSync(path.join(w, wf), 'utf8') + '\n'); fs.appendFileSync(path.join(w, 'README.md'), 'x\n'); });
    assert.match(dt(more, { role: 'sup' }).out, /covers only \.github\/workflows\/\*\.yml; this also changes README\.md/);
    const other = branch('tidy-workflow', (w) => fs.writeFileSync(path.join(w, wf), fs.readFileSync(path.join(w, wf), 'utf8') + '\n'));
    assert.match(dt(other, { role: 'sup' }).out, /outside project\//, 'only a ci-fix chore');
    for (const sl of ['ci-fix-node', 'ci-fix-drop', 'ci-fix-gut', 'ci-fix-more', 'tidy-workflow']) git(['worktree', 'remove', '--force', wt(sl)]);
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
      spawnSync('tmux', ['new-session', '-d', '-s', S(), '-n', 'plan-quiet', 'sleep 600']);
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
    assert.match(must(['planner', 'alpha', '--goal', G], { role: 'sup' }), /ticket numbers 02-21 reserved/);
    assert.match(must(['planner', 'beta', '--goal', G, '--id-block', '5'], { role: 'sup' }), /ticket numbers 22-26 reserved/);
    assert.match(dt(['planner', 'gamma', '--goal', G, '--id-block', '0'], { role: 'sup' }).err, /--id-block takes a whole number/);
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
    const Gi = must(['goal', 'add', '--title', 'Faster checkout', '--outcome', 'pay in under a minute', '--measure', 'median checkout', '--target', '60', '--unit', 's', '--direction', 'down', '--source', 'prod', '--check', 'echo 180', '--horizon', '2027-06-30', '--non-goals', 'mobile', '--preconditions', 'one-page form', '--priority', '7'], { role: 'sup' });
    must(['goal', 'reading', Gi, '--run'], { role: 'sup' });
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
    const sent = path.join(repo, 'docs/devteam/run/sent', `${encodeURIComponent(`${S()}:plan-enter`)}.json`);
    const enters = () => (fs.existsSync(keys) ? fs.readFileSync(keys, 'utf8').split('\n').length - 1 : 0);
    const resent = () => json(must(['log', '--type', 'observation', '--json'])).filter((o) => o.kind === 'resent-enter' && o.subject === 'plan-enter');
    const run = (screen, agoSec) => {
      spawnSync('tmux', ['kill-server']);
      fs.rmSync(keys, { force: true });
      const sf = path.join(tmp, 'screen.txt');
      write(sf, screen);
      write(sent, JSON.stringify({ text, at: new Date(Date.now() - agoSec * 1000).toISOString() }));
      spawnSync('tmux', ['new-session', '-d', '-x', '80', '-y', '24', '-s', S(), '-n', 'plan-enter', `${process.execPath} ${agent} ${sf} ${keys}`]);
      for (let i = 0; i < 30 && !/approved|devteam|Done/.test(spawnSync('tmux', ['capture-pane', '-p', '-t', `=${S()}:plan-enter`], { encoding: 'utf8' }).stdout ?? ''); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
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
    spawnSync('tmux', ['new-session', '-d', '-x', '80', '-y', '24', '-s', S(), '-n', 'plan-enter', `${process.execPath} ${agent} ${path.join(tmp, 'screen.txt')} ${keys}`]);
    for (let i = 0; i < 30 && !/approved|devteam/.test(spawnSync('tmux', ['capture-pane', '-p', '-t', `=${S()}:plan-enter`], { encoding: 'utf8' }).stdout ?? ''); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
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

  await t.test('goal holds: who may set what, merges wait on a park, let go and restore', () => {
    const hold = () => json(must(['goal', 'show', G, '--json'])).hold_view;
    // the supervisor drains a running goal, with a reason; it can't park one, or release the owner's hold
    assert.match(dt(['goal', 'hold', G, 'drain'], { role: 'sup' }).err, /--reason/);
    must(['goal', 'hold', G, 'drain', '--reason', 'billing waits on pricing'], { role: 'sup' });
    assert.deepEqual([hold().mode, hold().by], ['drain', 'supervisor']);
    assert.ok(json(must(['log', '--type', 'act', '--json'])).some((a) => a.class === 'goal-hold' && /drained "Self-serve billing"/.test(a.what)));
    assert.match(dt(['goal', 'hold', G, 'park', '--reason', 'x'], { role: 'sup' }).err, /only the owner parks a single goal/);
    must(['goal', 'hold', G, 'park', '--owner', '--reason', 'pausing billing for a week']);
    assert.deepEqual([hold().mode, hold().by], ['park', 'owner']);
    assert.match(dt(['goal', 'hold', G, 'run', '--reason', 'x'], { role: 'sup' }).err, /releases only a drain it set/);
    // a forged supervisor line is ignored by the fold, with why
    const supFile = fs.readdirSync(path.join(repo, 'docs/devteam/run/log')).find((f) => /^supervisor-/.test(f));
    fs.appendFileSync(path.join(repo, 'docs/devteam/run/log', supFile), line({ id: G, type: 'goal', op: 'set', at: new Date(Date.now() + 500).toISOString(), by: 'supervisor', hold: { mode: 'run' } }));
    assert.equal(hold().mode, 'park');
    assert.match(must(['log-check']), /the supervisor releases only a drain it set/);
    // a forged fleet line can't loosen the owner's park to a drain, and a forged undo puts back only what the op recorded
    const supPath = path.join(repo, 'docs/devteam/run/log', supFile);
    const before = fs.readFileSync(supPath, 'utf8');
    const forge = (hold0, dt0 = 600) => fs.appendFileSync(path.join(repo, 'docs/devteam/run/log', supFile), line({ id: G, type: 'goal', op: 'set', at: new Date(Date.now() + dt0).toISOString(), by: 'supervisor', hold: hold0 }));
    forge({ mode: 'drain', fleet: 'f-20261101-000000000', prior: { mode: 'park' } }, 700);
    assert.equal(hold().mode, 'park', 'a fleet drain never loosens a park');
    assert.match(must(['log-check']), /a fleet drain doesn't change a goal on park/);
    forge({ mode: 'run', undoes: 'f-20261101-000000000' }, 800);
    assert.equal(hold().mode, 'park', 'an undo of a fleet op not in force counts for nothing');
    fs.writeFileSync(supPath, before);
    // the roadmap and the track stand still while parked
    assert.match(must(['roadmap']), /Self-serve billing \[ready, parked\] -> no date while parked/);
    assert.equal(json(must(['goal', 'show', G, '--json'])).track, null);
    // its questions stay open and labelled; they don't count as the owner falling behind
    const Qh = must(['ask', '--question', 'Monthly or yearly plans?', '--goal', G, '--recommendation', 'monthly'], { role: 'sup' });
    assert.match(must(['questions']), new RegExp(`${Qh}  \\[owner-decision, open, its goal parked\\]`));
    // let go: abandoned, its questions leave the inbox; restore brings both back, parked
    must(['goal', 'decide', G, 'let-go', '--notes', 'not this quarter']);
    assert.equal(hold().mode, 'let-go');
    assert.doesNotMatch(must(['questions']), new RegExp(Qh));
    assert.ok(!json(must(['dashboard-data'])).questions.some((q) => q.id === Qh));
    assert.match(must(['validate']), /names goal g-[^,]+, which the owner let go/, 'a let-go goal\'s landed feature is a warning, not an error');
    assert.match(dt(['goal', 'hold', G, 'run', '--owner']).err, /goal decide .* restore/);
    assert.match(must(['goal', 'decide', G, 'restore']), /restored as ready, parked/);
    const gv = json(must(['goal', 'show', G, '--json']));
    assert.deepEqual([gv.status, gv.hold_view.mode], ['ready', 'park']);
    assert.match(must(['questions']), new RegExp(Qh));
    // run again; the owner's release lets the supervisor drain once more
    must(['goal', 'hold', G, 'run', '--owner']);
    must(['goal', 'hold', G, 'drain', '--reason', 'again'], { role: 'sup' });
    must(['goal', 'hold', G, 'run', '--reason', 'pricing landed'], { role: 'sup' });
    assert.equal(hold().mode, 'run');
    must(['answer', Qh, 'monthly']);
    // Upkeep: virtual until its first hold, held like any goal, never let go
    assert.match(must(['goal', 'list']), /^upkeep \[running\] Upkeep/m);
    must(['goal', 'hold', 'upkeep', 'drain', '--reason', 'quiet'], { role: 'sup' });
    assert.match(must(['goal', 'list']), /^upkeep \[(draining|drained): quiet\]/m);
    must(['goal', 'hold', 'upkeep', 'run', '--owner']);
    assert.equal(json(must(['dashboard-data'])).upkeep.mode, 'run');
    // two Upkeep lines made at once fold to one, and a hold on the second applies to the first
    const U = json(must(['dashboard-data'])).upkeep.id;
    const ownerFile = fs.readdirSync(path.join(repo, 'docs/devteam/run/log')).find((f) => /^owner-/.test(f));
    const at = new Date(Date.now() + 200).toISOString();
    const U2 = `g-${at.slice(0, 10).replace(/-/g, '')}-${at.slice(11, 23).replace(/[:.]/g, '')}-owner`;
    fs.appendFileSync(path.join(repo, 'docs/devteam/run/log', ownerFile), line({ id: U2, type: 'goal', op: 'new', at, by: 'owner', channel: 'cli', kind: 'upkeep', title: 'Upkeep' }));
    fs.appendFileSync(path.join(repo, 'docs/devteam/run/log', ownerFile), line({ id: U2, type: 'goal', op: 'set', at: new Date(Date.now() + 300).toISOString(), by: 'owner', channel: 'cli', hold: { mode: 'drain' } }));
    const up = json(must(['dashboard-data'])).upkeep;
    assert.deepEqual([up.id, up.mode], [U, 'drain']);
    must(['goal', 'hold', 'upkeep', 'run', '--owner']);
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
    const port = await freePort();
    const srv = spawn(process.execPath, [DT, 'dashboard', '--port', String(port)], { cwd: repo, env: { ...process.env, DEVTEAM_ROLE: '' }, stdio: 'ignore' });
    try {
      await serverUp(`http://127.0.0.1:${port}/`);
      const browser = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: `http://127.0.0.1:${port}` };
      // the data names the page version, so an open tab can tell it was updated underneath it
      const dataRes = await fetch(`http://127.0.0.1:${port}/api/data`);
      assert.match(dataRes.headers.get('x-devteam-page') ?? '', /^[0-9a-f]{16}$/);
      // the sidepeek's attributes: a record's stored fields, and the schema's words for each field
      const rec = await (await fetch(`http://127.0.0.1:${port}/api/record?id=${Qs}`)).json();
      assert.deepEqual([rec.id, rec.type, rec.created_by], [Qs, 'question', 'supervisor']);
      assert.ok(rec.fields.question && !('updates' in rec.fields) && !Object.keys(rec.fields).some((k) => k.startsWith('__')), 'stored fields only');
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/record?id=g-20200101-000000000-nobody`)).status, 404);
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/record?id=..%2Fx`)).status, 400);
      const docs = await (await fetch(`http://127.0.0.1:${port}/api/schema`)).json();
      assert.ok(docs.envelope.id && docs.types.decision.fields.authority && docs.types.ticket.fields.done_when);
      assert.ok(docs.types.goal.fields['milestones[].title'] && docs.types.feature.fields['stories[].text'], 'nested fields are keyed by path');
      assert.ok(!/approved_by k-/.test(docs.types.decision.fields.authority), "the owner's words (x-tip) where a description is written for agents");
      // a sidepeek's peek: the record, its history oldest first, and its kind's particulars
      const peek = async (q) => fetch(`http://127.0.0.1:${port}/api/peek?${new URLSearchParams(q)}`);
      const pq = await (await peek({ kind: 'q', id: Qs })).json();
      assert.equal(pq.record.id, Qs);
      assert.ok(pq.history.length && pq.history.every((l, i) => !i || pq.history[i - 1].at <= l.at));
      const pt = await (await peek({ kind: 'ticket', id: 'bill-01-card' })).json();
      assert.ok(pt.ticket && pt.deps && Array.isArray(pt.spend) && pt.history.some((l) => l.type === 'gate'));
      assert.ok(pt.history.every((l) => !('tests' in l) && l.type !== 'spend'), 'no per-test bulk or spend lines in a history');
      const own = pt.history.find((l) => l.id === 'bill-01-card' && l.op === 'set');
      assert.ok(own && own.prev, "a set line on the object carries what it replaced");
      const pg = await (await peek({ kind: 'goal', id: G })).json();
      assert.ok(pg.design === null || 'tldr' in pg.design);
      const ps = await (await peek({ kind: 'story', id: 'BILL-S1', rec: 'billing', tickets: 'bill-01-card' })).json();
      assert.equal(ps.record.id, 'billing', 'a story reads its feature\'s record');
      assert.equal((await peek({ kind: 'story', id: 'BILL-S1', rec: '../x' })).status, 400);
      assert.equal((await peek({ kind: 'ticket', id: 'nope-01-x' })).status, 404);
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

  await t.test('the tmux session is per project: devteam-<project>, a legacy devteam session kept, read-only commands write nothing', () => {
    const f = path.join(repo, 'docs/devteam/run/tmux-session');
    const had = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
    fs.rmSync(f, { force: true });
    try {
      assert.equal(must(['settings', '--get', 'tmux_session']), S(), 'the default names the project and this checkout');
      assert.ok(!fs.existsSync(f), 'resolving it writes nothing');
      const live = json(must(['fleet', 'status', '--json', '--no-fetch'], { role: 'sup' })).sessions.map((x) => x.name)[0];
      if (hasTmux && live) {
        const lw = wt(live);
        const made = !fs.existsSync(lw);
        if (made) fs.mkdirSync(lw, { recursive: true });
        try {
          // another project's window named like ours, started in its own checkout: not ours, nothing saved
          spawnSync('tmux', ['new-session', '-d', '-s', 'devteam', '-n', live, '-c', tmp]);
          try {
            assert.equal(must(['settings', '--get', 'tmux_session']), S(), "a window named like ours that started elsewhere is someone else's");
            assert.ok(!fs.existsSync(f), 'and nothing is saved');
          } finally { spawnSync('tmux', ['kill-session', '-t', '=devteam']); }
          // a legacy `devteam` session holding a window started in one of this checkout's worktrees keeps that name
          spawnSync('tmux', ['new-session', '-d', '-s', 'devteam', '-n', live, '-c', lw]);
          try {
            assert.equal(must(['settings', '--get', 'tmux_session']), 'devteam');
            assert.equal(fs.readFileSync(f, 'utf8').trim(), 'devteam', 'a legacy name is saved the moment it is found, so it cannot flip');
          } finally { spawnSync('tmux', ['kill-session', '-t', '=devteam']); fs.rmSync(f, { force: true }); }
        } finally { if (made) fs.rmSync(lw, { recursive: true, force: true }); }
      }
    } finally { if (had !== null) fs.writeFileSync(f, had); }
  });

  await t.test('computed views: metrics, roadmap, retro, dashboard data', () => {
    must(['metrics']);
    // init ignores the harnesses' runtime files; one tracked anyway is a finding with the fix
    const gi = fs.readFileSync(path.join(repo, '.gitignore'), 'utf8');
    assert.ok(['.claude/*.lock', '.claude/settings.local.json', '.claude/worktrees/'].every((p) => gi.split('\n').includes(p)), 'init ignores harness runtime files');
    write(path.join(repo, '.claude/scheduled_tasks.lock'), 'x');
    git(['add', '-f', '.claude/scheduled_tasks.lock']);
    git(['commit', '-qm', 'a lock, by accident']);
    const tr = json(must(['metrics', '--json'])).findings.find((f) => f.kind === 'tracked-runtime-file');
    assert.match(tr?.suggestion ?? '', /git rm --cached '\.claude\/scheduled_tasks\.lock', and add \.claude\/\*\.lock to \.gitignore/);
    git(['rm', '-q', '--cached', '.claude/scheduled_tasks.lock']);
    git(['commit', '-qm', 'untrack it']);
    fs.rmSync(path.join(repo, '.claude/scheduled_tasks.lock'));
    assert.ok(!json(must(['metrics', '--json'])).findings.some((f) => f.kind === 'tracked-runtime-file'));
    assert.match(must(['roadmap']), /Self-serve billing/);
    assert.match(must(['retro', '--print'], { role: 'sup' }), /## Numbers/);
    const d = json(must(['dashboard-data']));
    assert.equal(d.tickets.length, 1);
    assert.equal(d.ooda.goals.filter((g) => g.status !== 'abandoned').length, 1);
    assert.ok(d.ooda.trust.some((r) => r.class === 'release-scope' && r.rung === 1 && r.corrections === 1));
    assert.ok(d.ooda.acts.some((a) => a.id === A && a.correction?.reason === 'too early' && a.correction.repaired === 'fix-ticket'));
    assert.equal(d.progress.tickets.length, 1);
    assert.match(must(['history', 'bill-01-card']), /bill-01-card/);
    // a retro is an object: its closing line's id, its write-up, what it decided; the dashboard lists every one
    write(path.join(repo, 'docs/devteam/project/retros/2026-01-02.md'), '# Retro\n');
    const R1 = must(['retro', 'close', '2026-01-02', '--summary', 'two things went well', '--refs', A], { role: 'sup' });
    const rt = json(must(['dashboard-data'])).ooda.retro;
    assert.deepEqual(rt.all.map((r) => [r.id, r.file, r.refs]), [[R1, 'project/retros/2026-01-02.md', [A]]]);
    assert.equal(rt.last.id, R1);
    fs.rmSync(path.join(repo, 'docs/devteam/project/retros/2026-01-02.md'));
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
    // where production deploys whenever main changes, merging is releasing: release-production's authority
    landSettings((txt) => txt.replace('"gates": {', '"release": "merge", "gates": {'));
    const rung = json(must(['trust', '--json'])).find((r) => r.class === 'release-production').rung;
    assert.ok(rung < 3, 'release-production is below rung 3 here');
    const refused = dt(['merge', 'bill-01-card', '--dry-run'], { role: 'sup' });
    assert.match(`${refused.out}\n${refused.err}`, /merging deploys to production \(release: merge; it changes billing/, 'a deploying merge needs a release decision');
    const Qrel = must(['ask', '--class', 'release-production', '--reasons', 'below-rung', '--question', 'Release card capture with its merge?', '--recommendation', 'yes', '--ticket', 'bill-01-card'], { role: 'sup' });
    must(['answer', Qrel, 'yes']);
    const Drel = must(['decide', '--class', 'release-production', '--approved', Qrel, '--refs', 'bill-01-card', '--', 'release card capture by merging it'], { role: 'sup' });
    must(['merge', 'bill-01-card', '--decision', Drel], { role: 'sup' });
    const relAct = json(must(['log', '--type', 'act', '--json'])).find((a) => a.class === 'release-production' && a.refs.includes('bill-01-card'));
    assert.ok(relAct && relAct.decision === Drel && relAct.reversible === false, 'the release is logged as an act under its decision');
    git(['pull', '-q', '--ff-only', 'origin', 'main']);
    landSettings((txt) => txt.replace('"release": "merge", ', ''));
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

  await t.test('a ticket\'s merge gate fails validate only for overlaps that are its own (D4)', async () => {
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
    assert.match(json(must(['metrics', '--json'])).findings.find((f) => f.subject === 'bill-03-a' && f.kind === 'blocked').suggestion, /a question put only in your chat never reaches the Inbox/, 'and if it waits on the owner, the question was never asked');
    // wait: an open high finding returns at once; set aside, the wait runs to the tick or the next event
    assert.match(dt(['wait'], { role: 'worker' }).err, /wait: the supervisor does this/);
    assert.match(must(['wait', '--minutes', '0.05'], sup), /^high findings are open[\s\S]*blocked bill-03-a: blocked for/);
    for (const f of json(must(['metrics', '--json'])).findings.filter((x) => x.severity === 'high')) must(['ack', f.kind, f.subject, '--reason', 'testing wait'], sup);
    assert.match(must(['wait', '--minutes', '0.05'], sup), /^nothing new in 0\.05 min: the tick is due/);
    {
      const env = { ...process.env, DEVTEAM_ROLE: 'supervisor' };
      delete env.DEVTEAM_TICKET; delete env.DEVTEAM_FEATURE;
      const child = spawn(process.execPath, [DT, 'wait', '--minutes', '0.5'], { cwd: repo, env });
      let got = '';
      child.stdout.on('data', (b) => { got += b; });
      const done = new Promise((r) => child.on('close', r));
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
      const sent = spawnSync(process.execPath, [DT, 'send', 'supervisor', 'need a ruling on the shared module name', '--kind', 'blocked'], { cwd: repo, encoding: 'utf8', env: { ...env, DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'bill-03-a' } });
      assert.equal(sent.status, 0, sent.stderr);
      const Mw = sent.stdout.trim();
      await done;
      assert.match(got, new RegExp(`^something needs you:\\n  message ${Mw} \\[blocked\\] from bill-03-a`), 'a worker\'s message wakes it');
    }
    {
      // a message that lands during the tick, before wait looks, still wakes it, and only once
      const env = { ...process.env, DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'bill-03-a' };
      const early = spawnSync(process.execPath, [DT, 'send', 'supervisor', 'please review the fixture spec', '--kind', 'review-request'], { cwd: repo, encoding: 'utf8', env });
      assert.equal(early.status, 0, early.stderr);
      const Me = early.stdout.trim();
      assert.match(must(['wait', '--minutes', '0.05'], sup), new RegExp(`^something needs you:\\n  message ${Me} \\[review-request\\] from bill-03-a`), 'a message from during the tick is not taken for an old one');
      assert.match(must(['wait', '--minutes', '0.05'], sup), /^nothing new in 0\.05 min/, 'left open, it wakes the supervisor once');
    }
    const Qo = must(['ask', '--ticket', 'bill-03-a', '--question', 'Which shared module name?', '--recommendation', 'billing-shared'], sup);
    assert.deepEqual(kinds().filter((k) => k.startsWith('blocked')), ['blocked-on-owner'], "waiting on the owner's answer: say which question, don't tell the supervisor to act");
    assert.match(json(must(['metrics', '--json'])).findings.find((f) => f.kind === 'blocked-on-owner').detail, new RegExp(Qo));
    must(['withdraw', Qo, '--reason', 'test'], sup);
    // awaiting the word, with an owner question blocking it: waiting on the owner, not the supervisor
    const at2 = new Date(Date.now() - 2 * 3600000 + 1000);
    const stamp2 = at2.toISOString().replace(/[-:T]/g, '').replace('.', '').slice(0, 17);
    fs.appendFileSync(path.join(repo, 'docs/devteam/run/log/bill-03-a.jsonl'), line({ id: `h-${stamp2.slice(0, 8)}-${stamp2.slice(8)}-bill-03-a`, type: 'phase', op: 'new', at: at2.toISOString(), by: 'bill-03-a', to: 'awaiting-word' }));
    assert.ok(kinds().includes('waiting-on-supervisor'), 'awaiting the word with nothing else in the way');
    const Qw2 = must(['ask', '--question', 'Ship it?', '--blocks', 'bill-03-a', '--recommendation', 'yes'], sup);
    assert.ok(!kinds().includes('waiting-on-supervisor') && kinds().includes('blocked-on-owner'), "an owner question blocking it moves the wait to the owner");
    must(['withdraw', Qw2, '--reason', 'test'], sup);
    const at3 = new Date(Date.now() - 2 * 3600000 + 2000);
    const stamp3 = at3.toISOString().replace(/[-:T]/g, '').replace('.', '').slice(0, 17);
    fs.appendFileSync(path.join(repo, 'docs/devteam/run/log/bill-03-a.jsonl'), line({ id: `h-${stamp3.slice(0, 8)}-${stamp3.slice(8)}-bill-03-a`, type: 'phase', op: 'new', at: at3.toISOString(), by: 'bill-03-a', to: 'blocked' }));
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

  await t.test('review questions: a page pinned by hash, answered only by the owner\'s validated result', () => {
    const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
    const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>Match items to groups</title>\n<link rel="stylesheet" href="devteam-ui.css"><script src="devteam-ui.js"></script>\n<style>.chips { display: flex } .dot { background: url(data:image/gif;base64,R0lGOD) } .logo { background: url("/api/file?path=docs/x.png") }</style></head>\n<body><main id="view"></main>\n<script>\ndevteam.ready(({ data, draft, result, readonly }) => {\n  ui.grid({ data, draft, result, readonly, fields: [{ key: \'items\', label: \'Items\', type: \'multiselect\', options: \'items\' }, { key: \'note\', label: \'Note to the agent\', type: \'text\' }] });\n});\n</script></body></html>\n';
    // many-to-many: item b is proposed on two groups; group g3 has no proposal
    const DATA = JSON.stringify({ v: 1, title: 'Match items to groups', options: { items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] }, rows: [{ id: 'g1', title: 'One', proposal: { items: ['a', 'b'] } }, { id: 'g2', title: 'Two', proposal: { items: ['b'] } }, { id: 'g3', title: 'Three' }] }, null, 2);
    const SCHEMA = JSON.stringify({ type: 'object', required: ['v', 'question', 'review_sha256', 'rows'], properties: { rows: { type: 'array', items: { type: 'object', required: ['id', 'decided'], properties: { id: { type: 'string' }, decided: { type: 'boolean' }, values: { type: 'object', properties: { items: { type: 'array', items: { enum: ['a', 'b', 'c'] } } } } } } } } });
    // review check: the static rules, with line numbers
    const cdir = path.join(tmp, 'review-check');
    const page = (name, text) => { write(path.join(cdir, name), text); return path.join(cdir, name); };
    const good = page('page.html', PAGE);
    const dataFile = page('data.json', DATA);
    const schemaFile = page('result.schema.json', SCHEMA);
    assert.match(must(['review', 'check', good, '--data', dataFile, '--result-schema', schemaFile]), /^ok: .*\(3 rows, 2 with a proposal\)/m, 'the example page passes');
    const bad = (text, re, msg) => { const r = dt(['review', 'check', page('bad.html', text)]); assert.equal(r.status, 1, msg); assert.match(r.out, re, msg); };
    const doc = (body) => `<!doctype html><html><head><meta charset="utf-8"></head>\n<body>\n${body}\n</body></html>\n`;
    bad(doc('<script src="https://cdn.example.com/lib.js"></script>'), /^error: .*bad\.html:3: src "https:\/\/cdn\.example\.com\/lib\.js" leaves the page/m, 'an external script');
    bad(doc('<form><input name="x"></form>'), /bad\.html:3: <form> is not allowed/, 'a form');
    bad(doc('<meta http-equiv="Content-Security-Policy" content="default-src *">'), /http-equiv="Content-Security-Policy"> is not allowed/, 'a CSP meta');
    bad(doc('<style>.x { background: url(https://img.example.com/a.png) }</style>'), /url\( "https:\/\/img\.example\.com\/a\.png" leaves the page/, 'a non-relative url( in CSS');
    bad(doc('<img src="../../api/answer">'), /leaves the page/, 'a relative path that climbs out of the page folder');
    bad('<html><body>no doctype</body></html>', /not a complete HTML document/, 'a fragment');
    bad(doc(`<p>${'x'.repeat(5 * 1024 * 1024)}</p>`), /at most 4194304 \(4 MB\)/, 'a 5 MB page');
    const r0 = dt(['review', 'check', good, '--data', page('broken.json', '{"rows": [')]);
    assert.equal(r0.status, 1);
    assert.match(r0.out, /broken\.json: not valid JSON/, 'invalid data JSON');
    assert.match(dt(['review', 'check', good, '--data', page('dup.json', JSON.stringify({ rows: [{ id: 'g1' }, { id: 'g1' }] }))]).out, /id "g1" is repeated/);
    assert.match(dt(['review', 'check', good, '--result-schema', page('s.json', JSON.stringify({ type: 'object', oneOf: [] }))]).out, /schema\.oneOf: not a keyword the kit checks/, 'a schema keyword the checker would ignore');
    const warned = dt(['review', 'check', page('warn.html', doc('<label>Password</label><input type="password" name="password">\n<script>fetch("data.json")</script>'))]);
    assert.equal(warned.status, 0, 'warnings alone pass');
    assert.match(warned.out, /^warning: .*warn\.html:4: fetch\(: the page has no network/m);
    assert.match(warned.out, /warn\.html:3: a password field looks like a field for a secret; ask for secrets with --secrets/);

    // the page, its data and its schema are committed on the branch whose PR asks
    const rw = wt('review-demo');
    git(['worktree', 'add', '-q', '-b', 'review-demo', rw, 'origin/main']);
    const rel = 'docs/devteam/project/questions/match';
    write(path.join(rw, rel, 'page.html'), PAGE);
    write(path.join(rw, rel, 'data.json'), DATA);
    write(path.join(rw, rel, 'result.schema.json'), SCHEMA);
    write(path.join(rw, rel, 'plain.html'), PAGE.replace("ui.grid", "ui.form"));
    write(path.join(rw, rel, 'bad.html'), doc('<form></form>'));
    git(['add', '-A'], rw);
    git(['commit', '-qm', 'review page'], rw);
    const commit = git(['rev-parse', 'HEAD'], rw);
    const base = ['ask', '--kind', 'review', '--question', 'Which items belong to each group?', '--context', 'Three groups; I proposed what I could match.', '--ref', 'review-demo', '--page', `${rel}/page.html`, '--data', `${rel}/data.json`];
    const ask = (...extra) => dt([...base, ...extra], { role: 'sup' });
    assert.match(ask('--default', 'keep').err, /takes no --default: a review is never defaulted/);
    assert.match(ask('--secrets', '[{"name":"K","sink":"file:k"}]').err, /never carries a secret/);
    assert.match(ask('--choices', '[{"label":"x"}]').err, /choices are its page/);
    assert.match(dt(['ask', '--kind', 'review', '--question', 'x', '--ref', 'no-such-branch', '--page', `${rel}/page.html`], { role: 'sup' }).err, /--ref no-such-branch does not resolve/);
    assert.match(dt(['ask', '--kind', 'review', '--question', 'x', '--ref', 'review-demo', '--page', '../etc/passwd'], { role: 'sup' }).err, /without "\.\."/, 'a page never leaves the repo');
    assert.match(dt(['ask', '--kind', 'review', '--question', 'x', '--ref', 'review-demo', '--page', `${rel}/nope.html`], { role: 'sup' }).err, /not a file at review-demo/);
    assert.match(dt(['ask', '--kind', 'review', '--question', 'x', '--ref', 'review-demo', '--page', `${rel}/bad.html`], { role: 'sup' }).err, /does not pass its checks[\s\S]*<form> is not allowed/);
    assert.match(dt(['ask', '--question', 'x', '--page', `${rel}/page.html`], { role: 'sup' }).err, /--page belongs on a review question/);
    assert.match(dt([...base], { role: 'worker' }).err, /the supervisor does this/, 'a worker never asks');
    const Q1 = must([...base, '--result-schema', `${rel}/result.schema.json`], { role: 'sup' });
    const supLog = fs.readdirSync(path.join(repo, 'docs/devteam/run/log')).filter((f) => f.startsWith('supervisor-')).map((f) => fs.readFileSync(path.join(repo, 'docs/devteam/run/log', f), 'utf8')).join('');
    const askLine = supLog.split('\n').find((l) => l.includes(`"id":"${Q1}"`));
    assert.ok(Buffer.byteLength(askLine) < 1024, `the question line is small (${Buffer.byteLength(askLine)} bytes)`);
    const rv = JSON.parse(askLine).review;
    assert.equal(rv.commit, commit, 'pinned to the commit the ref named');
    assert.equal(rv.page.sha256, sha(PAGE));
    assert.equal(rv.data.sha256, sha(DATA));
    assert.equal(rv.result_schema.sha256, sha(SCHEMA));
    assert.deepEqual([rv.data.rows, rv.data.proposals, rv.allow_partial, rv.title], [3, 2, false, 'Match items to groups']);
    const view = (id) => json(must(['questions', '--id', id, '--json']))[0];
    let q = view(Q1);
    assert.deepEqual([q.kind, q.status, q.result_status, q.result, q.allow_partial], ['review', 'open', 'verified', null, false]);

    // the owner answers with a result; their process checks it against the pinned files
    const res = (id, rows, extra = {}) => JSON.stringify({ v: 1, question: id, review_sha256: sha(PAGE), data_sha256: sha(DATA), rows, ...extra });
    const answer = (id, body, role = 'owner') => dt(['answer', id, '--review-result', '-'], { role, input: body });
    const ok = [{ id: 'g1', decided: true, values: { items: ['a', 'b'] } }, { id: 'g2', decided: true, values: { items: ['b', 'c'] }, kept: true, note: 'c belongs here too' }, { id: 'g3', decided: true, values: { items: [] } }];
    assert.match(answer(Q1, res(Q1, ok), 'sup').err, /owner commands don't run in an agent session/, 'an agent never answers a review');
    assert.match(dt(['answer', Q1, 'looks good']).err, /is a review: answer it with its result/, 'never in free text');
    assert.match(dt(['answer', Q1, 'looks good', '--from-chat', '--said', 'looks good'], { role: 'sup' }).err, /answer --from-chat: .* is a review/, 'never from chat');
    assert.match(answer(Q1, res(Q1, ok, { review_sha256: sha('another page') })).err, /names page .*, not the page asked/);
    assert.match(answer(Q1, res(Q1, ok, { data_sha256: sha('other data') })).err, /names data .*, not the data asked/);
    assert.match(answer(Q1, res('q-20260101-000000000-supervisor', ok)).err, /is for q-20260101-000000000-supervisor, not/);
    assert.match(answer(Q1, res(Q1, [...ok, { id: 'g9', decided: true, values: {} }])).err, /"g9" is not a row of/);
    assert.match(answer(Q1, res(Q1, [...ok, ok[0]])).err, /"g1" is answered twice/);
    assert.match(answer(Q1, res(Q1, [ok[0], ok[1], { id: 'g3', decided: false }])).err, /\(g3\) is undecided; .* was asked without --allow-partial/);
    assert.match(answer(Q1, res(Q1, ok.slice(0, 2))).err, /1 row\(s\) of .* are not in the result \(g3\)/, 'a row left out is undecided too');
    assert.match(answer(Q1, res(Q1, [ok[0], { id: 'g2', decided: true, values: { items: ['z'] } }, ok[2]])).err, /does not satisfy .*result\.schema\.json[\s\S]*result\.rows\[1\]\.values\.items\[0\] must be one of a, b, c/);
    assert.match(answer(Q1, res(Q1, ok, { pad: 'x'.repeat(5 * 1024 * 1024) })).err, /at most 4194304 \(4 MB\)/);
    assert.match(answer(Q1, '{"v": 1,').err, /not valid JSON/);
    assert.equal(view(Q1).status, 'open', 'nothing refused was recorded');
    must(['answer', Q1, '--review-result', '-'], { input: res(Q1, ok) });
    q = view(Q1);
    assert.equal(q.status, 'answered');
    assert.equal(q.channel, 'cli');
    assert.equal(q.answer, 'Reviewed 3 rows: 1 kept, 1 changed, 1 set to none, 0 undecided');
    assert.deepEqual({ ...q.result, sha256: undefined, bytes: undefined }, { sha256: undefined, bytes: undefined, rows: 3, decided: 3, proposed: 2, kept: 1, changed: 1, cleared: 1, undecided: 0 });
    assert.equal(q.result_status, 'verified');
    assert.equal(q.matched, false, 'a changed proposal is not agreement');
    const resultFile = path.join(repo, 'docs/devteam/run/questions', Q1, 'result.json');
    const stored = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    assert.equal(sha(fs.readFileSync(resultFile)), q.result.sha256, "the owner's line names the file's hash");
    assert.deepEqual(stored.rows.map((r) => r.kept), [true, false, false], 'kept is recomputed: the page claimed g2 was kept');
    assert.equal(stored.rows[1].note, 'c belongs here too');
    assert.equal(stored.channel, 'cli');
    assert.match(answer(Q1, res(Q1, ok)).err, /already answered/);
    assert.match(must(['review', 'result', Q1, '--tsv'], { role: 'worker', cwd: rw }), /^g2\ttrue\tfalse\tb,c\tc belongs here too$/m, 'an agent reads the verified result');
    assert.equal(must(['review', 'result', Q1, '--json'], { role: 'sup' }), fs.readFileSync(resultFile, 'utf8').trim());
    // what the agent applied, against what the owner decided
    const applied = path.join(tmp, 'applied.json');
    write(applied, JSON.stringify(ok.map((r) => ({ id: r.id, values: r.values, evidence: 'migration 0042' }))));
    assert.match(must(['review', 'verify', Q1, '--applied', applied], { role: 'sup' }), /ok: 3 row\(s\) applied as the owner decided/);
    write(applied, JSON.stringify(ok.map((r) => ({ id: r.id, values: r.id === 'g2' ? { items: ['b'] } : r.values }))));
    const vr = dt(['review', 'verify', Q1, '--applied', applied], { role: 'sup' });
    assert.equal(vr.status, 1);
    assert.match(vr.out, /fail: g2: decided \{"items":\["b","c"\]\}, applied \{"items":\["b"\]\}/);

    // a partial answer only where the question allows it; agreement only when every proposal was kept
    const Q2 = must([...base, '--allow-partial'], { role: 'sup' });
    assert.equal(view(Q2).allow_partial, true);
    // a draft is the owner's partial progress: agents may read it, it is never an answer, and it goes when the answer lands
    assert.match(dt(['review', 'draft', Q2, '-'], { role: 'sup', input: '{"state":{}}' }).err, /owner commands don't run in an agent session/);
    must(['review', 'draft', Q2, '-'], { input: JSON.stringify({ state: { g1: 'kept' }, saved_at: '2026-11-03T00:00:00.000Z' }) });
    assert.match(must(['review', 'draft', Q2], { role: 'sup' }), /"g1": "kept"|"g1":"kept"/);
    assert.equal(view(Q2).status, 'open', 'a draft answers nothing');
    must(['answer', Q2, '--review-result', '-'], { input: res(Q2, [ok[0], { id: 'g2', decided: true, values: { items: ['b'] } }, { id: 'g3', decided: false }]) });
    q = view(Q2);
    assert.deepEqual([q.result.kept, q.result.undecided, q.matched], [2, 1, false], 'an undecided row is recorded, and is not agreement');
    assert.ok(!fs.existsSync(path.join(repo, 'docs/devteam/run/questions', Q2, 'draft.json')), 'the draft is gone once answered');
    const Q3 = must(base, { role: 'sup' });
    must(['answer', Q3, '--review-result', '-'], { input: res(Q3, [ok[0], { id: 'g2', decided: true, values: { items: ['b'] } }, { id: 'g3', decided: true }]) });
    assert.deepEqual([view(Q3).result.kept, view(Q3).result.proposed, view(Q3).matched], [2, 2, true], 'every proposal kept is agreement');
    // a result in any other shape is the page's business: accepted, hashed, never agreement
    const Q4 = must(['ask', '--kind', 'review', '--question', 'Sketch the layout you want', '--ref', 'review-demo', '--page', `${rel}/plain.html`], { role: 'sup' });
    const plainSha = sha(PAGE.replace('ui.grid', 'ui.form'));
    must(['answer', Q4, '--review-result', '-'], { input: JSON.stringify({ v: 1, question: Q4, review_sha256: plainSha, layout: { columns: 2, order: ['b', 'a'] } }) });
    q = view(Q4);
    assert.match(q.answer, /^Answered: \d+ bytes, sha256 [0-9a-f]{12}$/);
    assert.deepEqual(Object.keys(q.result).sort(), ['bytes', 'sha256']);
    assert.equal(q.matched, false);

    // forgery: the result fields are the owner's; an agent's line carrying them counts for nothing
    const Q5 = must(base, { role: 'sup' });
    const supFile = path.join(repo, 'docs/devteam/run/log', fs.readdirSync(path.join(repo, 'docs/devteam/run/log')).filter((f) => f.startsWith('supervisor-')).sort().pop());
    const workerFile = path.join(repo, 'docs/devteam/run/log/bill-01-card.jsonl');
    const before = [fs.readFileSync(supFile, 'utf8'), fs.existsSync(workerFile) ? fs.readFileSync(workerFile, 'utf8') : ''];
    const forged = { sha256: sha('x'), bytes: 1, rows: 3, decided: 3, proposed: 2, kept: 2, changed: 0, cleared: 0, undecided: 0 };
    fs.appendFileSync(supFile, line({ id: Q5, type: 'question', op: 'set', at: new Date().toISOString(), by: 'supervisor', answer: 'all kept', result: forged }));
    fs.appendFileSync(workerFile, line({ id: Q5, type: 'question', op: 'set', at: new Date().toISOString(), by: 'bill-01-card', result: forged }));
    fs.appendFileSync(workerFile, line({ id: Q5, type: 'question', op: 'set', at: new Date().toISOString(), by: 'owner', channel: 'cli', answer: 'all kept', result: forged }));
    const lc = dt(['log-check']);
    assert.notEqual(lc.status, 0);
    assert.match(lc.out, /supervisor may not set question\.answer, result/);
    assert.equal((lc.out.match(/^fail:/gm) ?? []).length, 3, 'log-check lists each forged line');
    q = view(Q5);
    assert.deepEqual([q.status, q.result, q.matched], ['open', null, null], 'the fold ignores them');
    fs.writeFileSync(supFile, before[0]);
    fs.writeFileSync(workerFile, before[1]);
    must(['log-check']);
    // sent back: the owner says why; there is no result
    assert.match(dt(['answer', Q5, '--decline']).err, /say why it goes back/);
    const Qo = must(['ask', '--question', 'Rename the items list?', '--recommendation', 'no'], { role: 'sup' });
    assert.match(dt(['answer', Qo, 'no', '--decline']).err, /--decline answer a review question/);
    assert.match(dt(['answer', Qo, '--review-result', '-'], { input: '{}' }).err, /--review-result and --decline answer a review question/);
    must(['withdraw', Qo, '--reason', 'test'], { role: 'sup' });
    must(['answer', Q5, 'Group the items by site first', '--decline']);
    q = view(Q5);
    assert.deepEqual([q.status, q.declined, q.result_status, q.answer, q.matched], ['answered', true, 'declined', 'Sent back: Group the items by site first', false]);
    assert.match(dt(['review', 'result', Q5], { role: 'sup' }).err, /was sent back/);

    // tamper: the question pins a commit, so a later commit on the branch changes nothing
    write(path.join(rw, rel, 'page.html'), PAGE.replace('Items', 'Things'));
    git(['commit', '-qam', 'edit the page after asking'], rw);
    assert.equal(json(must(['review', 'show', Q1, '--json'])).result_status, 'verified');
    // the result file is rewritten after the answer: every reader says so
    const good1 = fs.readFileSync(resultFile, 'utf8');
    fs.writeFileSync(resultFile, good1.replace('c belongs here too', 'c never belonged'));
    const tr = dt(['review', 'result', Q1, '--json'], { role: 'sup' });
    assert.equal(tr.status, 1);
    assert.match(tr.err, /the result is tampered/);
    assert.equal(view(Q1).result_status, 'tampered');
    assert.match(dt(['review', 'verify', Q1, '--applied', applied], { role: 'sup' }).err, /tampered/);
    fs.writeFileSync(resultFile, good1);
    assert.equal(view(Q1).result_status, 'verified');
    // the pinned commit leaves every branch: missing, unanswerable, and the metrics say so
    git(['checkout', '-q', '-b', 'review-gone'], rw);
    write(path.join(rw, rel, 'page.html'), PAGE.replace('Items', 'Entries'));
    git(['commit', '-qam', 'a page on a branch about to go'], rw);
    const Qm = must(['ask', '--kind', 'review', '--question', 'Short-lived?', '--ref', 'review-gone', '--page', `${rel}/page.html`], { role: 'sup' });
    assert.equal(json(must(['review', 'show', Qm, '--json'])).result_status, 'verified');
    git(['checkout', '-q', 'review-demo'], rw);
    git(['branch', '-q', '-D', 'review-gone']);
    const shown = json(must(['review', 'show', Qm, '--json']));
    assert.deepEqual([shown.result_status, shown.reachable], ['missing', false]);
    assert.ok(json(must(['metrics', '--json'])).findings.some((f) => f.kind === 'review-file-missing' && f.subject === Qm), 'metrics raise review-file-missing');
    assert.match(dt(['answer', Qm, '--review-result', '-'], { input: JSON.stringify({ v: 1, question: Qm, review_sha256: sha(PAGE.replace('Items', 'Entries')) }) }).err, /is gone or on no branch/);
    must(['withdraw', Qm, '--reason', 'test'], { role: 'sup' });
    assert.ok(!json(must(['metrics', '--json'])).findings.some((f) => f.kind === 'review-file-missing'), 'a withdrawn review raises nothing');
  });

  await t.test('hello: who this instance is, light enough for the hub; /api/hello answers from the last run; every route checks Host', async () => {
    const h = json(must(['hello', '--json']));
    assert.equal(h.devteam, 1);
    assert.equal(h.root, fs.realpathSync(repo));
    assert.equal(h.name, 'demo');
    assert.equal(typeof h.inbox, 'number');
    assert.equal(h.inbox, json(must(['questions', '--json'])).filter((q) => q.status === 'open').length, 'the Inbox count is the open questions');
    assert.ok(['run', 'drain', 'park'].includes(h.fleet.mode));
    assert.equal(typeof h.fleet.workers, 'number');
    assert.match(h.kit, /^(v\d+\.\d+\.\d+|unreleased)(\+local)?$/);
    const port = await freePort();
    const B = `http://127.0.0.1:${port}`;
    const srv = spawn(process.execPath, [DT, 'dashboard', '--port', String(port)], { cwd: repo, env: { ...process.env, DEVTEAM_ROLE: '' }, stdio: 'ignore' });
    try {
      await serverUp(`${B}/`);
      const j = await until(async () => { const x = await (await fetch(`${B}/api/hello`)).json(); return x.inbox !== null && x; }, 'the first hello run');
      assert.deepEqual([j.port, j.root, j.inbox], [port, h.root, h.inbox], 'the background run fills it in');
      const t0 = Date.now();
      await (await fetch(`${B}/api/hello`)).json();
      assert.ok(Date.now() - t0 < 300, 'answered from the last run, never recomputed');
      // a page elsewhere that points its own name at 127.0.0.1 sends its own Host: nothing, not even a read
      for (const route of ['/api/hello', '/api/data', '/']) assert.equal(await statusWithHost(port, route, `rebound.example:${port}`), 403, route);
    } finally { srv.kill(); }
  });

  await t.test('review questions on the dashboard: the page in a sandboxed frame, the answer from the owner\'s own panel', async () => {
    const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
    const fx = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'review');
    const PAGE = fs.readFileSync(path.join(fx, 'page.html'));
    const DATA = fs.readFileSync(path.join(fx, 'data.json'));
    const D = JSON.parse(DATA);
    assert.match(must(['review', 'check', path.join(fx, 'page.html'), '--data', path.join(fx, 'data.json')]), /^ok: .*\(6 rows, 5 with a proposal\)/m, 'the example page passes the static checks');
    const rw = wt('review-dash');
    git(['worktree', 'add', '-q', '-b', 'review-dash', rw, 'origin/main']);
    const rel = 'docs/devteam/project/questions/dash';
    write(path.join(rw, rel, 'page.html'), PAGE);
    write(path.join(rw, rel, 'data.json'), DATA);
    git(['add', '-A'], rw);
    git(['commit', '-qm', 'a review page'], rw);
    const ask = (q) => must(['ask', '--kind', 'review', '--question', q, '--ref', 'review-dash', '--page', `${rel}/page.html`, '--data', `${rel}/data.json`], { role: 'sup' });
    const Qa = ask('Which items belong to each group?');
    const Qd = ask('Which items belong to each group, again?');
    // a page on a branch that goes away
    git(['checkout', '-q', '-b', 'review-dash-gone'], rw);
    write(path.join(rw, rel, 'page.html'), String(PAGE).replace('Match items', 'Match things'));
    git(['commit', '-qam', 'a page on a branch about to go'], rw);
    const Qg = must(['ask', '--kind', 'review', '--question', 'Gone?', '--ref', 'review-dash-gone', '--page', `${rel}/page.html`], { role: 'sup' });
    git(['checkout', '-q', 'review-dash'], rw);
    git(['branch', '-q', '-D', 'review-dash-gone']);
    // a question whose page no longer hashes to its line (a hand-edited line, as tampering would leave)
    const supFile = path.join(repo, 'docs/devteam/run/log', fs.readdirSync(path.join(repo, 'docs/devteam/run/log')).filter((f) => f.startsWith('supervisor-')).sort().pop());
    const askLine = JSON.parse(fs.readFileSync(supFile, 'utf8').split('\n').find((l) => l.includes(`"id":"${Qa}"`)));
    // (dated before the secrets test's 2099 line, so no id the kit mints afterwards can be this one)
    const Qt = 'q-20991231-235958000-supervisor';
    fs.appendFileSync(supFile, line({ ...askLine, id: Qt, at: '2099-12-31T23:59:58.000Z', review: { ...askLine.review, page: { ...askLine.review.page, sha256: sha('another page') } } }));
    const view = (id) => json(must(['questions', '--id', id, '--json']))[0];

    const port = await freePort();
    const B = `http://127.0.0.1:${port}`;
    const srv = spawn(process.execPath, [DT, 'dashboard', '--port', String(port)], { cwd: repo, env: { ...process.env, DEVTEAM_ROLE: '' }, stdio: 'ignore' });
    try {
      await serverUp(`${B}/`);
      // the page: its bytes verbatim, only into a frame of the dashboard, under a policy with no network
      const frame = { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' };
      let r = await fetch(`${B}/review/${Qa}/`, { headers: frame });
      assert.equal(r.status, 200);
      assert.equal(sha(Buffer.from(await r.arrayBuffer())), sha(PAGE), 'the page, byte for byte');
      const csp = r.headers.get('content-security-policy');
      for (const d of ["default-src 'none'", "connect-src 'none'", 'sandbox allow-scripts', `frame-ancestors ${B}`, "form-action 'none'", "font-src 'none'", `script-src 'unsafe-inline' ${B}/review/`, `img-src data: blob: ${B}/api/file`]) assert.ok(csp.split('; ').includes(d), `the policy has ${d}: ${csp}`);
      assert.doesNotMatch(csp, /https:|\*/, 'no outside origin, no wildcard');
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.equal((await fetch(`${B}/review/${Qa}/`)).status, 403, 'opened top-level, without sec-fetch-dest: iframe, it is refused');
      assert.equal((await fetch(`${B}/review/${Qa}/`, { headers: { ...frame, 'sec-fetch-dest': 'document' } })).status, 403);
      assert.equal((await fetch(`${B}/review/${Qa}/`, { headers: { ...frame, 'sec-fetch-site': 'cross-site' } })).status, 403, 'framed by another site, it is refused');
      assert.equal((await fetch(`${B}/review/${Qg}/`, { headers: frame })).status, 404, 'the pinned commit is gone');
      r = await fetch(`${B}/review/${Qt}/`, { headers: frame });
      assert.equal(r.status, 403, `the page does not hash to its question: ${await r.clone().text()}`);
      assert.equal((await fetch(`${B}/review/q-20200101-000000000-supervisor/`, { headers: frame })).status, 404, 'no such question');
      // under a question's path the server serves the kit's two helper files, and nothing else
      r = await fetch(`${B}/review/${Qa}/devteam-ui.js`);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /^text\/javascript/);
      assert.equal(await r.text(), fs.readFileSync(path.join(kit, 'dashboard/devteam-ui.js'), 'utf8'));
      r = await fetch(`${B}/review/${Qa}/devteam-ui.css`);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /^text\/css/);
      for (const other of ['other.js', 'data.json', 'page.html', 'index.html', 'devteam-ui.js/x']) assert.equal((await fetch(`${B}/review/${Qa}/${other}`, { headers: frame })).status, 404, other);
      // a committed page previewed before anyone asks: same frame rules, no question
      const pv = new URLSearchParams({ path: `${rel}/page.html`, ref: 'review-dash' });
      r = await fetch(`${B}/review/preview/?${pv}`, { headers: frame });
      assert.equal(r.status, 200);
      assert.equal(sha(Buffer.from(await r.arrayBuffer())), sha(PAGE));
      assert.match(r.headers.get('content-security-policy'), /connect-src 'none'.*sandbox allow-scripts/);
      assert.equal((await fetch(`${B}/review/preview/?${pv}`)).status, 403);
      assert.equal((await fetch(`${B}/review/preview/?path=../x.html&ref=review-dash`, { headers: frame })).status, 400);
      assert.equal((await fetch(`${B}/review/preview/?${new URLSearchParams({ path: `${rel}/data.json`, ref: 'review-dash' })}`, { headers: frame })).status, 400, 'only a page');
      assert.equal((await fetch(`${B}/`)).headers.get('content-security-policy'), "frame-src 'self'", "the dashboard's frames stay on the dashboard, even when a frame navigates itself");

      // what the review view loads
      r = await fetch(`${B}/api/review?id=${Qa}`);
      let info = await r.json();
      assert.equal(r.status, 200);
      assert.deepEqual([info.status, info.result_status, info.draft, info.result_doc, info.question], ['open', 'verified', null, null, 'Which items belong to each group?']);
      assert.deepEqual(info.data, D, 'the data, from the pinned commit');
      assert.equal((await fetch(`${B}/api/review?id=not-a-qid`)).status, 400);
      assert.equal((await fetch(`${B}/api/review?id=q-20200101-000000000-supervisor`)).status, 404);
      assert.equal((await (await fetch(`${B}/api/review?id=${Qt}`)).json()).result_status, 'tampered');

      // the owner's actions: browser headers required; a sandboxed frame's (Origin: null) refused
      const browser = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: B };
      const postJ = (what, b, headers = browser) => fetch(`${B}/api/${what}`, { method: 'POST', headers, body: typeof b === 'string' ? b : JSON.stringify(b) });
      const rows = D.rows.map((x) => ({ id: x.id, decided: true, values: x.proposal ?? {} }));
      const result = { v: 1, question: Qa, review_sha256: sha(PAGE), data_sha256: sha(DATA), rows };
      const answerBody = (res) => ({ id: Qa, result: res, sha256: sha(JSON.stringify(res)) });
      const draftBody = { id: Qa, state: { rows: { g1: { decided: true, values: { items: ['a', 'b'] } } } }, saved_at: '2026-11-03T10:00:00.000Z' };
      for (const [w, b] of [['review-answer', answerBody(result)], ['review-draft', draftBody]]) {
        assert.equal((await postJ(w, b, { 'content-type': 'application/json' })).status, 403, `${w} without browser headers`);
        assert.equal((await postJ(w, b, { ...browser, origin: 'null', 'sec-fetch-site': 'cross-site' })).status, 403, `${w} from a sandboxed frame`);
        assert.equal((await postJ(w, b, { ...browser, origin: 'null' })).status, 403, `${w} with origin null`);
        assert.equal((await postJ(w, b, { 'content-type': 'application/json', origin: B })).status, 403, `${w} without sec-fetch-site`);
        for (let i = 0; i < 2; i++) {
          r = await postJ(w, JSON.stringify({ id: Qa, state: 'x'.repeat(5 * 1024 * 1024), result: {} }));
          assert.equal(r.status, 400, `${w}: a 5 MB body`);
          assert.match((await r.json()).error, /at most 4194304 \(4 MB\)/);
        }
      }
      assert.equal((await fetch(`${B}/api/review?id=${Qa}`)).status, 200, 'the server carries on');
      assert.equal(view(Qa).status, 'open', 'nothing refused was recorded');

      // a draft: saved on disk for the owner, never a log line, gone when the answer lands
      const logLines = () => fs.readdirSync(path.join(repo, 'docs/devteam/run/log')).reduce((n, f) => n + fs.readFileSync(path.join(repo, 'docs/devteam/run/log', f), 'utf8').split('\n').filter(Boolean).length, 0);
      const before = logLines();
      r = await postJ('review-draft', draftBody);
      assert.equal(r.status, 200, await r.clone().text());
      const draftFile = path.join(repo, 'docs/devteam/run/questions', Qa, 'draft.json');
      assert.deepEqual(JSON.parse(fs.readFileSync(draftFile, 'utf8')), { state: draftBody.state, saved_at: draftBody.saved_at });
      assert.equal(logLines(), before, 'a draft adds no log line');
      info = await (await fetch(`${B}/api/review?id=${Qa}`)).json();
      assert.deepEqual([info.draft.state, info.draft.saved_at], [draftBody.state, draftBody.saved_at], 'the view gets the draft back');

      // the answer: exactly the result the preview hashed, validated by the owner's own process
      r = await postJ('review-answer', { ...answerBody(result), sha256: sha('what the preview showed') });
      assert.equal(r.status, 400);
      assert.match((await r.json()).error, /not the one the preview showed/);
      assert.equal((await postJ('review-answer', { id: Qa, result })).status, 400, 'no hash, no answer');
      r = await postJ('review-answer', answerBody({ ...result, rows: rows.slice(1) }));
      assert.equal(r.status, 400);
      assert.match((await r.json()).error, /1 row\(s\) of .* are not in the result \(g1\)/, 'an undecided row, on a question asked without --allow-partial');
      assert.equal(view(Qa).status, 'open');
      r = await postJ('review-answer', answerBody(result));
      assert.equal(r.status, 200, await r.clone().text());
      assert.match((await r.json()).out, /^answered .*: Reviewed 6 rows: 5 kept, 0 changed, 1 set to none, 0 undecided/);
      const q = view(Qa);
      assert.deepEqual([q.status, q.channel, q.result_status], ['answered', 'dashboard', 'verified'], "the owner's line says it came from the dashboard");
      const stored = JSON.parse(fs.readFileSync(path.join(repo, 'docs/devteam/run/questions', Qa, 'result.json'), 'utf8'));
      assert.deepEqual([stored.channel, stored.rows.length], ['dashboard', 6]);
      assert.ok(!fs.existsSync(draftFile), 'the draft is gone once answered');
      r = await postJ('review-answer', answerBody(result));
      assert.equal(r.status, 400);
      assert.match((await r.json()).error, /already answered/, 'a second answer is refused');
      assert.equal((await postJ('review-draft', draftBody)).status, 400, 'and so is a draft for an answered review');
      // read-only replay: the stored result, and as TSV for the owner's own use
      info = await (await fetch(`${B}/api/review?id=${Qa}`)).json();
      assert.deepEqual([info.status, info.result_doc?.rows?.length, info.result.sha256], ['answered', 6, q.result.sha256]);
      r = await fetch(`${B}/api/review?id=${Qa}&format=tsv`);
      assert.equal(r.status, 200);
      assert.match(await r.text(), /^g1\ttrue\ttrue\ta,b\t$/m);

      // Send it back: the owner's reason, through the existing answer action
      assert.equal((await postJ('answer', { id: Qd, answer: 'Group the items by area first', decline: 'yes' })).status, 400);
      r = await postJ('answer', { id: Qd, answer: 'Group the items by area first', decline: true });
      assert.equal(r.status, 200, await r.clone().text());
      const qd = view(Qd);
      assert.deepEqual([qd.status, qd.declined, qd.answer, qd.channel, qd.result_status], ['answered', true, 'Sent back: Group the items by area first', 'dashboard', 'declined']);
    } finally { srv.kill(); }
    must(['withdraw', Qg, '--reason', 'test'], { role: 'sup' });
    must(['withdraw', Qt, '--reason', 'test'], { role: 'sup' });

    // the bridge listener, loaded from index.html by itself: only that frame, only an opaque
    // origin, only the known messages, within the caps; nothing else gets through
    const html = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');
    const src = html.slice(html.indexOf('/* review-bridge start */'), html.indexOf('/* review-bridge end */'));
    assert.ok(src.length > 200, 'the bridge block is marked in index.html');
    const ctx = vm.createContext({});
    vm.runInContext(src, ctx);
    const frameWin = {};
    const ev = (data, over = {}) => ({ source: frameWin, origin: 'null', data, ...over });
    const accept = (e) => JSON.parse(JSON.stringify(ctx.bridgeAccept(e, frameWin)));
    assert.deepEqual(accept(ev({ type: 'ready' })), { type: 'ready' });
    assert.deepEqual(accept(ev({ type: 'progress', done: 3, total: 6 })), { type: 'progress', done: 3, total: 6 });
    assert.deepEqual(accept(ev({ type: 'propose', result: { rows: [] }, answer: true, sha256: 'x' })), { type: 'propose', result: { rows: [] } }, 'only the fields its type allows');
    assert.deepEqual(accept(ev({ type: 'open', href: 'https://example.com/a?b=1' })), { type: 'open', href: 'https://example.com/a?b=1' });
    assert.deepEqual(accept(ev({ type: 'open', path: 'docs/a.md', ref: 'main' })), { type: 'open', path: 'docs/a.md', ref: 'main' });
    assert.deepEqual(accept(ev({ type: 'resize', height: 1e9 })), { type: 'resize', height: 100000 }, 'a height is clamped');
    assert.deepEqual(accept(ev({ type: 'markdown', id: 1, text: '**hi**' })), { type: 'markdown', id: 1, text: '**hi**' });
    const dropped = [
      [ev({ type: 'ready' }, { source: {} }), 'source', 'another window'],
      [ev({ type: 'ready' }, { source: null }), 'source', 'no window'],
      [ev({ type: 'ready' }, { origin: B }), 'origin', "the dashboard's own origin: not a sandboxed frame"],
      [ev({ type: 'ready' }, { origin: 'https://example.com' }), 'origin', 'another origin'],
      [ev({ type: 'answer', result: {} }), 'type', 'an unknown type'],
      [ev({ type: 'submit' }), 'type', 'an unknown type'],
      [ev({}), 'type', 'no type'],
      [ev('ready'), 'shape', 'not an object'],
      [ev([{ type: 'ready' }]), 'shape', 'an array'],
      [ev({ type: 'propose', result: { pad: 'x'.repeat(4 * 1024 * 1024) } }), 'size', 'an oversize proposal'],
      [ev({ type: 'draft', state: 'x'.repeat(4 * 1024 * 1024 + 1) }), 'size', 'an oversize draft'],
      [ev({ type: 'markdown', id: 1, text: 'x'.repeat(64 * 1024 + 1) }), 'size', 'oversize markdown'],
      [ev({ type: 'propose', result: [1] }), 'fields', 'a result that is not an object'],
      [ev({ type: 'draft' }), 'fields', 'a draft with no state'],
      [ev({ type: 'progress', done: 7, total: 6 }), 'fields', 'more done than there are'],
      [ev({ type: 'progress', done: 'all', total: 6 }), 'fields', 'not a number'],
      [ev({ type: 'open', href: 'http://example.com/' }), 'href', 'plain http'],
      [ev({ type: 'open', href: 'javascript:alert(1)' }), 'href', 'a script URL'],
      [ev({ type: 'open', href: 'https://user@example.com/' }), 'href', 'credentials in the URL'],
      [ev({ type: 'open', path: '../etc/passwd' }), 'path', 'a path out of the repo'],
      [ev({ type: 'open', path: '/etc/passwd' }), 'path', 'an absolute path'],
      [ev({ type: 'resize', height: Infinity }), 'fields', 'not a finite height'],
    ];
    for (const [e, why, msg] of dropped) assert.equal(accept(e).drop, why, msg);
    // the hash the panel shows when the page isn't a secure context is the owner's process's hash
    for (const n of [0, 3, 55, 56, 63, 64, 65, 1000]) {
      const bytes = crypto.randomBytes(n);
      assert.equal(ctx.sha256Js(new Uint8Array(bytes)), sha(bytes), `sha256 of ${n} bytes`);
    }

    // the helper files: the dashboard's tokens verbatim (dark mode too), and a script that loads nothing
    const tokens = (s) => s.slice(s.indexOf('/* devteam-ui tokens start */'), s.indexOf('/* devteam-ui tokens end */'));
    const css = fs.readFileSync(path.join(kit, 'dashboard/devteam-ui.css'), 'utf8');
    assert.match(tokens(html), /prefers-color-scheme: dark/);
    assert.equal(tokens(css), tokens(html), 'devteam-ui.css repeats the dashboard tokens');
    assert.doesNotMatch(css, /@import|url\(|@font-face/, 'the helper CSS loads nothing');
    const uiJs = fs.readFileSync(path.join(kit, 'dashboard/devteam-ui.js'), 'utf8');
    assert.doesNotMatch(uiJs, /\bimport\b|\bfetch\(|XMLHttpRequest|https?:\/\//, 'the helper script loads nothing');
    assert.doesNotThrow(() => new vm.Script(uiJs));
  });

  await t.test("review permanence: the owner's result lands in the PR that asked, by hash, and landed review files never change", async () => {
    const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
    const fx = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'review');
    const PAGE = fs.readFileSync(path.join(fx, 'page.html'), 'utf8');
    const DATA = fs.readFileSync(path.join(fx, 'data.json'), 'utf8');
    const D = JSON.parse(DATA);
    const cw = wt('chore-perm');
    git(['worktree', 'add', '-q', '-b', 'chore-perm', cw, 'origin/main']);
    const rel = 'docs/devteam/project/questions/perm';
    write(path.join(cw, rel, 'page.html'), PAGE);
    write(path.join(cw, rel, 'redraw.html'), PAGE.replace('Match items', 'Sort items'));
    write(path.join(cw, rel, 'data.json'), DATA);
    git(['add', '-A'], cw);
    git(['commit', '-qm', 'review pages'], cw);
    const ask = (q, page = 'page.html') => must(['ask', '--kind', 'review', '--question', q, '--ref', 'chore-perm', '--page', `${rel}/${page}`, '--data', `${rel}/data.json`], { role: 'sup' });
    const Qp = ask('Which items belong to each group, for good?');
    const Qn = ask('Which items belong to each group, unlanded?');
    const Qr = ask('Which items, sorted?', 'redraw.html');
    const view = (id) => json(must(['questions', '--id', id, '--json']))[0];
    const result = (id, page = PAGE) => JSON.stringify({ v: 1, question: id, review_sha256: sha(page), data_sha256: sha(DATA), rows: D.rows.map((x) => ({ id: x.id, decided: true, values: x.proposal ?? {} })) });
    const commitAll = (wtDir, msg) => { git(['add', '-A'], wtDir); git(['commit', '-qm', msg], wtDir); };
    const undo = (wtDir) => git(['reset', '-q', '--hard', 'HEAD~1'], wtDir);
    const checkPr = (branch, wtDir) => dt(['check-pr', '--head-ref', branch, '--sha', git(['rev-parse', 'HEAD'], wtDir), '--title', `${branch}: review pages`, '--body-file', body], { role: 'sup', cwd: wtDir });
    const resultRel = (id) => `docs/devteam/project/questions/${id}/result.json`;
    const dest = path.join(cw, resultRel(Qp));

    // nothing to copy before the owner answers, and a result for an unanswered question never lands
    assert.match(dt(['review', 'result', Qp, '--commit'], { role: 'sup', cwd: cw }).err, /has no result \(open\)/);
    write(dest, result(Qp));
    commitAll(cw, 'a result nobody gave');
    let r = checkPr('chore-perm', cw);
    assert.equal(r.status, 1);
    assert.match(r.out, new RegExp(`questions/${Qp}/result\\.json is not the owner's answer to ${Qp}: ${Qp} is open, with no owner result; if the owner has answered since, land the log .*\\. Copy it with \`review result ${Qp} --commit\``));
    undo(cw);

    must(['answer', Qp, '--review-result', '-'], { input: result(Qp) });
    must(['answer', Qn, '--review-result', '-'], { input: result(Qn) });
    const ownerSha = view(Qp).result.sha256;
    // --commit verifies both hashes first: a tampered run/ copy is refused, and nothing is written
    const runFile = path.join(repo, 'docs/devteam/run/questions', Qp, 'result.json');
    const good = fs.readFileSync(runFile);
    fs.writeFileSync(runFile, String(good).replace('"cli"', '"chat"'));
    r = dt(['review', 'result', Qp, '--commit'], { role: 'sup', cwd: cw });
    assert.equal(r.status, 1);
    assert.match(r.err, /the result is tampered/);
    assert.ok(!fs.existsSync(dest), 'nothing copied');
    fs.writeFileSync(runFile, good);
    // the owner's bytes, verified, into the PR that asked; check-pr holds them to the owner's hash
    assert.match(must(['review', 'result', Qp, '--commit'], { role: 'sup', cwd: cw }), new RegExp(`copied the owner's result for ${Qp} .* to ${resultRel(Qp)}\\n  git add ${resultRel(Qp)}$`));
    assert.equal(sha(fs.readFileSync(dest)), ownerSha, "the copy is the owner's bytes");
    assert.match(must(['review', 'result', Qp, '--commit'], { role: 'sup', cwd: cw }), /is already the owner's result/);
    commitAll(cw, "the owner's result");
    // a clone elsewhere (a moved fleet) has no run/questions: the committed copy shows and verifies the same answer
    git(['push', '-q', 'origin', 'chore-perm'], cw);
    const keep = fs.readFileSync(runFile);
    fs.rmSync(runFile);
    assert.equal(json(must(['questions', '--id', Qp, '--json']))[0].result_status, 'verified', 'the permanent copy verifies without run/questions');
    fs.writeFileSync(runFile, keep);
    git(['push', '-q', 'origin', '--delete', 'chore-perm'], cw);
    git(['update-ref', '-d', 'refs/remotes/origin/chore-perm']);
    must(['check-pr', '--head-ref', 'chore-perm', '--sha', git(['rev-parse', 'HEAD'], cw), '--title', 'chore-perm: review pages', '--body-file', body], { role: 'sup', cwd: cw });
    // one byte changed: refused, with both hashes
    const landedText = fs.readFileSync(dest, 'utf8');
    fs.writeFileSync(dest, landedText.replace('"cli"', '"clj"'));
    commitAll(cw, 'edit the result');
    r = checkPr('chore-perm', cw);
    assert.equal(r.status, 1);
    assert.match(r.out, new RegExp(`is not the owner's answer to ${Qp}: it hashes to [0-9a-f]{12}, and the owner's answer line names ${ownerSha.slice(0, 12)}`));
    undo(cw);
    // a page a live question pins never changes, even before it lands; one sent back may be redrawn in place
    write(path.join(cw, rel, 'page.html'), PAGE.replace('Match items', 'Match things'));
    commitAll(cw, 'edit the page after asking');
    r = checkPr('chore-perm', cw);
    assert.equal(r.status, 1);
    assert.match(r.out, new RegExp(`${rel}/page\\.html is pinned as the page of ${Qp} \\(answered\\), ${Qn} \\(answered\\); it never changes\\. Put a new page at a new path and ask a new question`));
    undo(cw);
    must(['answer', Qr, 'Sort them by area', '--decline']);
    write(path.join(cw, rel, 'redraw.html'), PAGE.replace('Match items', 'Sort items by area'));
    commitAll(cw, 'redraw the page sent back');
    must(['check-pr', '--head-ref', 'chore-perm', '--sha', git(['rev-parse', 'HEAD'], cw), '--title', 'chore-perm: review pages', '--body-file', body], { role: 'sup', cwd: cw });
    undo(cw);
    // a worker's copy goes in its own ticket folder, held to the same hash
    assert.match(must(['review', 'result', Qp, '--commit'], { role: 'worker', cwd: cw }), new RegExp(`git add docs/devteam/project/tickets/bill-01-card/questions/${Qp}/result\\.json$`));
    const tdest = path.join(cw, `docs/devteam/project/tickets/bill-01-card/questions/${Qp}/result.json`);
    assert.equal(sha(fs.readFileSync(tdest)), ownerSha);
    fs.writeFileSync(tdest, landedText.replace('"cli"', '"clj"'));
    commitAll(cw, 'a ticket copy, edited');
    assert.match(checkPr('chore-perm', cw).out, new RegExp(`tickets/bill-01-card/questions/${Qp}/result\\.json is not the owner's answer to ${Qp}: it hashes to`));
    undo(cw);

    // squash-merged, its branch deleted: the pinned commit is on no branch, and the files on main still verify
    const lw = wt('land-perm');
    git(['worktree', 'add', '-q', '--detach', lw, 'origin/main']);
    git(['merge', '--squash', '-q', 'chore-perm'], lw);
    git(['commit', '-qm', 'chore-perm: review pages (squashed)'], lw);
    git(['push', '-q', 'origin', 'HEAD:main'], lw);
    git(['worktree', 'remove', '--force', lw]);
    git(['worktree', 'remove', '--force', cw]);
    git(['branch', '-q', '-D', 'chore-perm']);
    git(['fetch', '-q', 'origin']);
    const shown = json(must(['review', 'show', Qp, '--json']));
    assert.deepEqual([shown.result_status, shown.reachable, shown.landed], ['verified', false, true], 'landed, not missing');
    assert.ok(shown.files.every((f) => f.status === 'verified' && f.landed), 'every pinned file verifies on main');
    assert.match(must(['review', 'show', Qp]), /no branch holds any more \(squash-merged\): its files are on main/);
    assert.equal(sha(must(['review', 'result', Qp, '--json'], { role: 'sup' }) + '\n'), ownerSha, 'the result still reads');
    // the dashboard serves the landed page from main, byte for byte
    {
      const port = await freePort();
      const B = `http://127.0.0.1:${port}`;
      const srv = spawn(process.execPath, [DT, 'dashboard', '--port', String(port)], { cwd: repo, env: { ...process.env, DEVTEAM_ROLE: '' }, stdio: 'ignore' });
      try {
        await serverUp(`${B}/`);
        const pr = await fetch(`${B}/review/${Qp}/`, { headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' } });
        assert.equal(pr.status, 200, 'a squash-merged page still opens');
        assert.equal(sha(Buffer.from(await pr.arrayBuffer())), sha(PAGE));
      } finally { srv.kill(); }
    }
    const stale = (on) => {
      const sfile = path.join(repo, 'docs/devteam/project/settings.md');
      const txt = fs.readFileSync(sfile, 'utf8');
      fs.writeFileSync(sfile, on ? txt.replace('"gates": {', '"stale_after_minutes": -1, "gates": {') : txt.replace('"stale_after_minutes": -1, ', ''));
    };
    let findings = json(must(['metrics', '--json'])).findings;
    assert.ok(!findings.some((f) => f.kind === 'review-file-missing' && [Qp, Qn].includes(f.subject)), 'a landed review is not missing');
    assert.ok(!findings.some((f) => f.kind === 'review-unlanded'), 'review-unlanded waits stale_after_minutes × 48');
    stale(true);
    try {
      findings = json(must(['metrics', '--json'])).findings;
      assert.ok(findings.some((f) => f.kind === 'review-unlanded' && f.subject === Qn && /review result .* --commit/.test(f.suggestion)), 'an answered review whose result is not on main');
      assert.ok(!findings.some((f) => f.kind === 'review-unlanded' && f.subject === Qp), 'its result is on main');
      assert.ok(!findings.some((f) => f.kind === 'review-unlanded' && f.subject === Qr), 'a review sent back has no result to land');
    } finally { stale(false); }

    // once on main, a review file never changes and is never deleted, whatever its question's status
    const nw = wt('chore-after');
    git(['worktree', 'add', '-q', '-b', 'chore-after', nw, 'origin/main']);
    const refused = (edit, re, msg) => { edit(); commitAll(nw, msg); const x = checkPr('chore-after', nw); assert.equal(x.status, 1, msg); assert.match(x.out, re, msg); undo(nw); };
    refused(() => write(path.join(nw, rel, 'page.html'), PAGE.replace('Match items', 'Match things')), new RegExp(`${rel}/page\\.html is pinned as the page of ${Qp} \\(answered\\), ${Qn} \\(answered\\), and is on main; it never changes`), 'a landed page is edited');
    refused(() => fs.rmSync(path.join(nw, rel, 'data.json')), new RegExp(`${rel}/data\\.json is pinned as the data of .*, and is on main; it is never deleted`), 'landed data is deleted');
    refused(() => write(path.join(nw, rel, 'redraw.html'), PAGE.replace('Match items', 'Sort them')), new RegExp(`redraw\\.html is pinned as the page of ${Qr} \\(sent back\\), and is on main; it never changes`), 'a landed page sent back is still on record');
    refused(() => fs.rmSync(path.join(nw, resultRel(Qp))), new RegExp(`${resultRel(Qp)}: the owner's answer to ${Qp} is on main; a landed review file is never deleted`), 'a landed result is deleted');
    refused(() => write(path.join(nw, resultRel(Qp)), landedText.replace('"cli"', '"clj"')), /is not the owner's answer to .*: it hashes to/, 'a landed result is edited');
    must(['check-pr', '--head-ref', 'chore-after', '--sha', git(['rev-parse', 'HEAD'], nw), '--title', 'chore-after: review pages', '--body-file', body], { role: 'sup', cwd: nw });
    git(['worktree', 'remove', '--force', nw]);
    git(['branch', '-q', '-D', 'chore-after']);
  });
});

// Moving the fleet: its own throwaway repo, an old machine and a fresh clone standing in for the new one.
// A throwaway origin, an old machine and a new one, for the fleet tests.
function fleetFixture(name) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `devteam-${name}-`));
  const org = path.join(base, 'origin.git');
  const old = path.join(base, 'old');
  const neu = path.join(base, 'new');
  const home = path.join(base, 'home');
  const tmuxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-tmux-'));
  const env = (role) => {
    const e = { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, 'claude'), CODEX_HOME: path.join(home, 'codex'), TMUX_TMPDIR: tmuxDir };
    for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'TMUX', 'TMUX_PANE']) delete e[k];
    return { ...e, ...role };
  };
  const run = (cwd, args, role = {}, input) => { const r = spawnSync(process.execPath, [path.join(cwd, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd, env: env(role), encoding: 'utf8', input }); return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
  const ok = (cwd, args, role, input) => { const r = run(cwd, args, role, input); assert.equal(r.status, 0, `${args.join(' ')}: ${r.err || r.out}`); return r.out; };
  const g = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  g(['init', '-q', '--bare', '-b', 'main', org], base); // the clone checks out origin's HEAD; CI's git defaults to master
  fs.mkdirSync(old);
  g(['init', '-q', '-b', 'main'], old);
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) g(['config', k, v], old);
  g(['remote', 'add', 'origin', org], old);
  fs.cpSync(kit, path.join(old, 'docs', 'devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
  ok(old, ['init', '--name', name]);
  const sf = path.join(old, 'docs/devteam/project/settings.md');
  fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"gates": {}', '"gates": {}, "forge": "git", "worktree_files": ["config/dev.key"], "agent_command": "true", "resume_command": "true"'));
  write(path.join(old, 'config/dev.key'), 'not a real key\n');
  write(path.join(old, '.gitignore'), `${fs.readFileSync(path.join(old, '.gitignore'), 'utf8')}config/dev.key\n`);
  g(['add', '-A'], old);
  g(['commit', '-qm', 'init'], old);
  g(['push', '-q', 'origin', 'main'], old);
  // the log lands (as merge --chore log would put it on main)
  const land = () => {
    const live = path.join(old, 'docs/devteam/run/log');
    for (const f of fs.readdirSync(live).filter((x) => x.endsWith('.jsonl'))) fs.copyFileSync(path.join(live, f), path.join(old, 'docs/devteam/project/log', f));
    g(['add', '-A', 'docs/devteam/project/log'], old);
    g(['commit', '-qm', 'chore-log: log through now'], old);
    g(['push', '-q', 'origin', 'main'], old);
  };
  const done = () => { fs.rmSync(tmuxDir, { recursive: true, force: true }); if (!process.env.DEVTEAM_TEST_KEEP) fs.rmSync(base, { recursive: true, force: true }); else console.log(`${name} fixture kept at ${base}`); };
  return { base, org, old, neu, home, env, run, ok, g, land, done };
}

test('fleet park: every session stops with a handoff, and a clone elsewhere picks it up with parity', () => {
  const F = fleetFixture('park');
  const { org, old, neu, home, env, run, ok, g, base } = F;
  const ID = 'ch-01-tidy';
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const WRK = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: ID };
  try {
    ok(old, ['ticket', 'add', ID, '--json', JSON.stringify({ title: 'tidy up', feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['tidy/**'], done_when: ['the tidy check passes'], notes: 'turns on tidy' })], SUP);

    // a planner logs one phase of its own: parked
    const pw = path.join(old, '.worktrees', 'plan-beta');
    g(['worktree', 'add', '-q', '-b', 'plan/beta', pw, 'origin/main'], old);
    assert.match(run(pw, ['phase', 'build'], { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'beta' }).err, /a planner logs only phase parked/);
    ok(pw, ['phase', 'parked', '--note', 'parked'], { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'beta' });
    assert.equal(json(ok(old, ['dashboard-data'])).planners.find((p) => p.feature === 'beta').parked, true);
    g(['worktree', 'remove', '--force', pw], old);
    g(['branch', '-q', '-D', 'plan/beta'], old);

    // a worker on a chore (Upkeep's) mid-build, with work committed but not pushed, and an edit not committed
    const ww = path.join(old, '.worktrees', ID);
    g(['worktree', 'add', '-q', '-b', `ticket/${ID}`, ww, 'origin/main'], old);
    ok(ww, ['phase', 'build', '--task', 'T1'], WRK);
    write(path.join(ww, 'tidy/a.txt'), 'a\n');
    g(['add', '-A'], ww);
    g(['commit', '-qm', 'T1'], ww);
    write(path.join(ww, 'tidy/b.txt'), 'b, not yet committed\n');

    // the old drain now asks which you mean; a worker can't park the fleet
    assert.match(run(old, ['drain', '--reason', 'x'], SUP).err, /fleet park stops every session .*fleet drain lets in-flight work finish/);
    assert.match(run(ww, ['fleet', 'park'], WRK).err, /fleet: the supervisor does this/);
    const parked = ok(old, ['fleet', 'park', '--reason', 'new laptop'], SUP);
    assert.match(parked, /parked the fleet \(f-\d{8}-\d{9}\): 1 goal\(s\) set to park, Upkeep included/);
    assert.match(parked, new RegExp(`told ${ID} to commit, push, write a handoff and park`));
    const act = json(ok(old, ['log', '--type', 'act', '--json'])).find((a) => a.class === 'fleet-park');
    assert.match(act.what, /^parked the fleet on \S+ \(f-\d{8}-\d{9}\): new laptop$/);
    const msg = json(ok(old, ['messages', '--to', ID, '--json'])).pop();
    assert.match(msg.text, /^Park: the fleet is parked \(new laptop\)\. .*devteam\.mjs handoff.*phase parked --note "parked"/);
    assert.equal(ok(old, ['fleet', 'park'], SUP), 'every goal is already parked; nothing to do');
    assert.match(ok(old, ['goal', 'park-sessions', '--all'], SUP), /every session it holds has been told/, 'a park ruling goes once per cause');
    assert.match(run(old, ['worker', ID, '--resume'], SUP).err, /its goal is parked: nothing starts for it.*--force/);
    assert.match(run(old, ['planner', 'gamma'], SUP).err, /--goal <g-id>/);
    const findings = json(ok(old, ['metrics', '--json'])).findings;
    assert.ok(!findings.some((f) => ['idle-capacity', 'idle-planning', 'park-unsent'].includes(f.kind)), 'nothing new is suggested while parked, and the ruling was sent');
    assert.match(ok(old, ['prompt', 'supervisor']), /^The fleet is parked .*This is the machine it was parked on/);
    assert.match(run(old, ['chore', 'start', 'retro-x'], SUP).err, /Upkeep is parked: no new upkeep chore starts/);

    // not ready: unpushed, uncommitted, not parked, no handoff, log not landed
    let st = json(ok(old, ['fleet', 'status', '--json'], SUP));
    assert.equal(st.ready, false);
    assert.equal(st.fleet.mode, 'park');
    const s0 = st.sessions.find((x) => x.name === ID);
    assert.deepEqual([s0.parked, s0.pushed, s0.clean], [false, false, false]);
    assert.ok(st.blockers.some((b) => /live log is not on main/.test(b)));
    assert.ok(st.checklist.some((c) => /config\/dev\.key/.test(c) && /secure channel/.test(c)), 'the checklist lists worktree_files');
    assert.ok(st.checklist.some((c) => /fleet unpark/.test(c)) && st.checklist.some((c) => /dashboard/.test(c)));
    assert.match(ok(old, ['drain', '--status'], SUP), /ready to move: no\n\nnew-machine checklist:/, 'drain --status is fleet status');

    // the worker does what the ruling says: commit, park without a handoff first (not ready), then the handoff
    g(['add', '-A'], ww);
    g(['commit', '-qm', 'WIP: park'], ww);
    // a branch that forked before a kit upgrade carries an older script: the main checkout's runs
    const wtScript = path.join(ww, 'docs/devteam/scripts/devteam.mjs');
    fs.writeFileSync(wtScript, fs.readFileSync(wtScript, 'utf8').replace('handoff: cmdHandoff, ', ''));
    assert.match(run(ww, ['handoff'], { ...WRK, DEVTEAM_OWN_KIT: '1' }, '').err, /unknown command "handoff"/, 'the stale copy lacks the command');
    assert.match(run(ww, ['handoff'], WRK, '').err, /the note is empty/, 'the main checkout\'s kit ran');
    g(['checkout', '--', 'docs/devteam/scripts/devteam.mjs'], ww);
    ok(ww, ['phase', 'parked', '--note', 'parked'], WRK);
    st = json(ok(old, ['fleet', 'status', '--json'], SUP));
    assert.deepEqual(st.sessions.map((x) => [x.parked, x.pushed, x.clean, x.handoff]), [[true, false, true, false]]);
    const upkeepState = () => json(ok(old, ['goal', 'show', 'upkeep', '--json'])).hold_view.state;
    assert.equal(upkeepState(), 'parking', 'stopped is not settled: still parking until it is pushed with its handoff');
    assert.match(ok(ww, ['handoff'], WRK, 'Done: T1. Next: write tidy/c.txt (T2). Open: none. Uncommitted: none.\n'), /handoff committed on ticket\/ch-01-tidy and pushed/);
    assert.equal(g(['log', '-1', '--format=%s', `origin/ticket/${ID}`], ww), `devteam handoff: ${ID}`, 'the handoff is a commit, not a file');
    assert.equal(g(['diff', '--name-only', 'HEAD~1', 'HEAD'], ww), '', 'it changes no file');
    st = json(ok(old, ['fleet', 'status', '--json'], SUP));
    assert.deepEqual(st.sessions.map((x) => [x.parked, x.pushed, x.clean, x.handoff]), [[true, true, true, true]]);
    assert.equal(st.ready, false, 'the log has not landed yet');
    assert.equal(upkeepState(), 'parked', 'pushed, clean and handed off: parked');
    F.land();
    // everything else that is only here blocks: no supervisor handoff, a loose run/ file, a worktree with unpushed work
    st = json(ok(old, ['fleet', 'status', '--json'], SUP));
    assert.ok(st.blockers.some((b) => /no supervisor handoff since the fleet park/.test(b)), 'the supervisor writes a handoff too');
    write(path.join(old, 'docs/devteam/run/research-notes.md'), 'notes\n');
    const cw = path.join(old, '.worktrees', 'chore-notes');
    g(['worktree', 'add', '-q', '-b', 'chore-notes', cw, 'origin/main'], old);
    write(path.join(cw, 'notes.txt'), 'x\n');
    g(['add', '-A'], cw);
    g(['commit', '-qm', 'notes'], cw);
    st = json(ok(old, ['fleet', 'status', '--json'], SUP));
    assert.ok(st.blockers.some((b) => /files in run\/ the kit didn't make, which don't move: research-notes\.md/.test(b)));
    assert.ok(st.blockers.some((b) => /worktrees holding work that isn't on the remote: chore-notes \(1 commit\(s\) on no remote\)/.test(b)));
    fs.rmSync(path.join(old, 'docs/devteam/run/research-notes.md'));
    g(['worktree', 'remove', '--force', cw], old);
    g(['branch', '-q', '-D', 'chore-notes'], old);
    // the supervisor's handoff: an annotated tag on origin, no file
    assert.match(ok(old, ['handoff', '--supervisor'], SUP, '# Supervisor handoff\n\nWaiting on: nothing. Next: restart ch-01-tidy.\n'), /pushed devteam-handoff\/f-/);
    assert.match(g(['ls-remote', '--tags', 'origin'], old), /refs\/tags\/devteam-handoff\/f-/);
    // agent memory outside the repo that changed after the handoff blocks; folded in before it, it doesn't
    const mem = path.join(home, 'claude', 'projects', fs.realpathSync(old).replace(/[^a-zA-Z0-9]/g, '-'), 'memory');
    write(path.join(mem, 'rule.md'), 'the owner said X\n');
    const later = new Date(Date.now() + 120000);
    fs.utimesSync(path.join(mem, 'rule.md'), later, later);
    st = json(ok(old, ['fleet', 'status', '--json'], SUP));
    assert.ok(st.blockers.some((b) => /agent memory outside the repo changed after the supervisor's handoff landed \(rule\.md\)/.test(b)));
    const earlier = new Date(Date.now() - 3600000);
    fs.utimesSync(path.join(mem, 'rule.md'), earlier, earlier);
    st = json(ok(old, ['fleet', 'status', '--json'], SUP));
    assert.deepEqual(st.blockers, []);
    assert.equal(st.ready, true);
    const oldStatus = ok(old, ['fleet', 'status'], SUP);
    assert.match(oldStatus, /ready to move: yes\nparity: [0-9a-f]{16} \(\d+ log entries\)/);
    const oldParity = /parity: ([0-9a-f]{16})/.exec(oldStatus)[1];

    // the new machine: a clone with no run/, no worktrees, no harness sessions
    g(['clone', '-q', org, neu], base);
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) g(['config', k, v], neu);
    assert.ok(!fs.existsSync(path.join(neu, 'docs/devteam/run/log')));
    assert.match(ok(neu, ['prompt', 'supervisor']), /^The fleet is parked .*This looks like the machine it moved to\. Before anything else: \(1\) DEVTEAM_ROLE=supervisor node docs\/devteam\/scripts\/devteam\.mjs fleet unpark/, 'the standard prompt sees the parked fleet, and that this is a fresh clone');
    // a pinned tool this machine's asdf hasn't installed is named before anything restarts
    const fakeBin = path.join(base, 'bin');
    write(path.join(fakeBin, 'asdf'), '#!/bin/sh\n[ "$1" = where ] && [ "$3" = 9.9.9 ] && exit 1\nexit 0\n');
    fs.chmodSync(path.join(fakeBin, 'asdf'), 0o755);
    write(path.join(neu, '.tool-versions'), 'nodejs 18.20.4\nruby 9.9.9 # pinned\n');
    const PINS = { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
    assert.match(ok(neu, ['prompt', 'supervisor'], PINS), /Before anything else: \(0\) this machine lacks the tools \.tool-versions pins \(ruby 9\.9\.9\): run asdf install/);
    const up = ok(neu, ['fleet', 'resume'], { ...SUP, ...PINS });
    assert.match(up, /before restarting anything: this machine lacks the tools \.tool-versions pins \(ruby 9\.9\.9\)/);
    fs.rmSync(path.join(neu, '.tool-versions'));
    assert.match(up, /run\/log was empty: rebuilt \d+ file\(s\)/);
    assert.equal(/parity: ([0-9a-f]{16})/.exec(up)?.[1], oldParity, 'the new machine holds exactly the log the old one did');
    assert.match(up, /## Handoff from the previous supervisor[\s\S]*Next: restart ch-01-tidy\./);
    assert.match(up, /unparked the fleet \(f-\d{8}-\d{9}\): Upkeep → run/);
    assert.match(up, new RegExp(`devteam\\.mjs worker ${ID} +its handoff note goes into its prompt`));
    assert.equal(json(ok(neu, ['fleet', 'status', '--json', '--no-fetch'], SUP)).fleet, null, 'the park is lifted');
    assert.doesNotMatch(ok(neu, ['prompt', 'supervisor']), /The fleet is parked/);
    assert.ok(json(ok(neu, ['log', '--type', 'act', '--json'])).some((a) => a.class === 'fleet-unpark'));

    // the restarted worker's prompt carries the handoff until it logs its first phase
    const wp = ok(neu, ['prompt', 'worker', ID]);
    assert.match(wp, /## Handoff from a parked session[\s\S]*the fleet was parked[\s\S]*Done: T1\. Next: write tidy\/c\.txt \(T2\)/);
    assert.match(wp, new RegExp(`the handoff commit [0-9a-f]{12} on ticket/${ID}`));
    const nw = path.join(neu, '.worktrees', ID);
    if (hasTmux) {
      // the supervisor runs inside an agent session: its markers must not reach the worker's agent
      const rs = spawnSync(process.execPath, [path.join(neu, 'docs/devteam/scripts/devteam.mjs'), 'worker', ID, '--resume'], { cwd: neu, env: env({ ...SUP, CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CONFIG_DIR: path.join(home, 'claude') }), encoding: 'utf8' });
      let pane = '';
      for (let i = 0; i < 150 && !/env -u/.test(pane); i++) { pane = spawnSync('tmux', ['capture-pane', '-p', '-J', '-t', `=${sessionOf(neu, 'park')}:${ID}`], { env: env({}), encoding: 'utf8' }).stdout ?? ''; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); }
      spawnSync('tmux', ['kill-server'], { env: env({}) });
      pane = pane.replace(/\n/g, ''); // the shell wraps a long command at the pane's width, even mid-word
      for (const k of ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION']) assert.match(pane, new RegExp(`env (-u \\w+ )*-u ${k} (-u \\w+ )*true `), `the agent starts without the supervisor's session marker ${k}`);
      assert.doesNotMatch(pane, /-u CLAUDE_CONFIG_DIR/, 'settings the owner exports stay');
      assert.equal(rs.status, 0, rs.stderr);
      assert.match(rs.stderr, /no worker session to resume for ch-01-tidy: its worktree was just made here.*starting it fresh with agent_command and its handoff note/);
      assert.equal(g(['rev-parse', 'HEAD'], nw), g(['rev-parse', `origin/ticket/${ID}`], neu), 'the worktree continues the pushed branch, not main');
      assert.match(fs.readFileSync(path.join(neu, `docs/devteam/run/prompts/${ID}.txt`), 'utf8'), /## Handoff from a parked session/);
    } else g(['worktree', 'add', '-q', '--track', '-b', `ticket/${ID}`, nw, `origin/ticket/${ID}`], neu);
    ok(nw, ['phase', 'build', '--task', 'T2'], WRK);
    assert.doesNotMatch(ok(neu, ['prompt', 'worker', ID]), /Handoff from a parked session/, 'after its first phase line the note is history');
  } finally {
    F.done();
  }
});

test('fleet drain: in-flight work finishes, nothing new starts, and a drained fleet moves with parity', () => {
  const F = fleetFixture('drain');
  const { org, old, neu, run, ok, g, base } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const ID = 'ch-01-small';
  const WRK = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: ID };
  try {
    ok(old, ['ticket', 'add', ID, '--json', JSON.stringify({ title: 'small', feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['small/**'], done_when: ['the small check passes'], notes: 'turns on small' })], SUP);
    ok(old, ['ticket', 'add', 'ch-02-later', '--json', JSON.stringify({ title: 'later', feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['later/**'], done_when: ['the later check passes'], notes: 'turns on later' })], SUP);
    const ww = path.join(old, '.worktrees', ID);
    g(['worktree', 'add', '-q', '-b', `ticket/${ID}`, ww, 'origin/main'], old);
    ok(ww, ['phase', 'build', '--task', 'T1'], WRK);
    assert.match(ok(old, ['fleet', 'drain', '--reason', 'quiet week'], SUP), /draining the fleet \(f-\d{8}-\d{9}\): 1 goal\(s\) set to drain/);
    assert.equal(json(ok(old, ['messages', '--to', ID, '--json'])).length, 0, 'a drain tells running sessions nothing: they finish');
    const ready = json(ok(old, ['ready', '--json']));
    assert.deepEqual(ready.ready, [], 'nothing new is ready');
    assert.ok(ready.waiting.some((w) => w.id === 'ch-02-later' && w.why === 'goal draining'));
    assert.match(run(old, ['worker', 'ch-02-later'], SUP).err, /its goal is draining: a draining goal finishes what is running and starts nothing new/);
    assert.match(ok(old, ['goal', 'list']), /^upkeep \[draining: quiet week\] Upkeep/m);
    let st = json(ok(old, ['fleet', 'status', '--json'], SUP));
    assert.equal(st.fleet.mode, 'drain');
    assert.ok(st.blockers.some((b) => new RegExp(`${ID}: still running \\(phase build\\): a drain finishes in-flight work`).test(b)));
    // the ticket finishes (merged, as merge would put it on main)
    write(path.join(ww, 'small/a.txt'), 'a\n');
    g(['add', '-A'], ww);
    g(['commit', '-qm', `${ID}: small`], ww);
    g(['push', '-q', 'origin', `ticket/${ID}`], ww);
    g(['merge', '-q', '--no-ff', '-m', `Merge pull request #1 from x/ticket/${ID}`, `ticket/${ID}`], old);
    g(['push', '-q', 'origin', 'main'], old);
    ok(ww, ['phase', 'done'], WRK);
    g(['worktree', 'remove', '--force', ww], old);
    assert.match(ok(old, ['goal', 'list']), /^upkeep \[drained: quiet week\]/m, 'drained once nothing of it runs');
    F.land();
    ok(old, ['handoff', '--supervisor'], SUP, 'Nothing in flight. Next: run Upkeep again.\n');
    st = json(ok(old, ['fleet', 'status', '--json'], SUP));
    assert.deepEqual(st.blockers, []);
    assert.equal(st.ready, true, 'a drained fleet, nothing running, can move');
    const oldParity = st.parity.hash;
    g(['clone', '-q', org, neu], base);
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) g(['config', k, v], neu);
    const up = ok(neu, ['fleet', 'undrain'], SUP);
    assert.equal(/parity: ([0-9a-f]{16})/.exec(up)?.[1], oldParity);
    assert.match(up, /undrained the fleet \(f-\d{8}-\d{9}\): Upkeep → run/);
    assert.deepEqual(json(ok(neu, ['ready', '--json'])).ready.map((r) => r.id), ['ch-02-later'], 'work starts again');
  } finally {
    F.done();
  }
});

// A fresh project of its own, for tests that need more than one instance on the machine.
function bareProject(base, name) {
  const r = path.join(base, name);
  fs.mkdirSync(r);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: r });
  fs.cpSync(kit, path.join(r, 'docs', 'devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
  const i = spawnSync(process.execPath, [path.join(r, 'docs/devteam/scripts/devteam.mjs'), 'init', '--name', name], { cwd: r, encoding: 'utf8' });
  assert.equal(i.status, 0, i.stderr);
  return r;
}
function startDashboard(root, env, args = []) {
  const p = spawn(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), 'dashboard', ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let o = '';
  p.stdout.on('data', (b) => { o += b; });
  p.stderr.on('data', (b) => { o += b; });
  return { p, out: () => o, stop: () => new Promise((r) => { if (p.exitCode !== null) return r(); p.on('close', r); p.kill(); }) };
}
async function until(f, what = 'the condition') {
  for (let i = 0; i < 300; i++) { const v = await f(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); }
  assert.fail(`timed out waiting for ${what}`);
}

test('dashboard ports: +1 from the highest instance, not the lowest free; a saved port reused; held ports skipped; pinned outside the block warned', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-ports-'));
  const P = PORTS + 31;
  const env = { ...process.env, DEVTEAM_HUB_PORT: String(PORTS + 30), DEVTEAM_PORT_BASE: String(P) };
  const on = (d, port) => until(() => new RegExp(`dashboard on http://127\\.0\\.0\\.1:${port}\\b`).test(d.out()), `a dashboard on ${port}`);
  const blocker = net.createServer().listen(P + 1, '127.0.0.1');
  const running = [];
  const start = (r, args) => { const d = startDashboard(r, env, args); running.push(d); return d; };
  try {
    const [A, B, C] = ['alpha', 'beta', 'carol'].map((n) => bareProject(base, n));
    const a = start(A);
    await on(a, P);
    assert.equal(fs.readFileSync(path.join(A, 'docs/devteam/run/dashboard-port'), 'utf8').trim(), String(P));
    const b = start(B);
    await on(b, P + 2); // P+1 is held by something that isn't devteam
    await a.stop();
    const c = start(C);
    await on(c, P + 3); // one past the highest instance (beta), though P is the lowest free
    await b.stop();
    const b2 = start(B);
    await on(b2, P + 2); // its saved port, though P is the lowest free and P+4 is one past carol
    const pinned = start(A, ['--port', String(await freePort())]);
    await until(() => new RegExp(`outside ${P}-${P + 24}: the hub won't list it`).test(pinned.out()), 'the warning for a pinned port outside the block');
  } finally {
    for (const d of running) await d.stop();
    blocker.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// A request with a Host the test chooses (fetch may not send one): the status code.
function statusWithHost(port, route, host, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: route, method, headers: { host, ...headers } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    r.on('error', reject);
    r.end();
  });
}


test('the hub: lists every instance on the machine, links to each one, moves when its dashboard stops, and does nothing else', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-hub-'));
  const HUB = PORTS + 60;
  const P = PORTS + 61;
  const env = { ...process.env, DEVTEAM_HUB_PORT: String(HUB), DEVTEAM_PORT_BASE: String(P), DEVTEAM_HUB_RETRY_MS: '500' };
  const list = async () => { try { return (await (await fetch(`http://127.0.0.1:${HUB}/instances.json`)).json()).instances; } catch { return null; } };
  const A = bareProject(base, 'alpha');
  const B = bareProject(base, 'beta');
  for (const r of [A, B]) execFileSync('sh', ['-c', 'git add -A && git -c user.email=t@t -c user.name=t commit -qm init'], { cwd: r });
  fs.appendFileSync(path.join(B, 'docs/devteam/scripts/devteam.mjs'), '\n// a local change\n');
  const a = startDashboard(A, env);
  let b;
  try {
    await until(() => a.out().includes(`127.0.0.1:${P}`), "alpha's dashboard");
    b = startDashboard(B, env);
    const both = await until(async () => { const l = await list(); return l?.length === 2 && l.every((x) => x.inbox !== null) && l; }, 'both instances listed with counts');
    assert.deepEqual(both.map((x) => [x.name, x.port]), [['alpha', P], ['beta', P + 1]], 'beta took the port after alpha: +1');
    assert.doesNotMatch(both[0].kit, /\+local$/, "alpha runs the kit it committed");
    assert.match(both[1].kit, /\+local$/, "beta's edited kit shows");
    const page = await fetch(`http://127.0.0.1:${HUB}/`);
    assert.match(await page.text(), /instances\.json/, 'the page reads the list from its own hub');
    assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/, 'and can talk to nothing else');
    assert.equal(await statusWithHost(HUB, '/instances.json', 'rebound.example'), 403, 'its own Host only');
    assert.equal(await statusWithHost(HUB, '/instances.json', `127.0.0.1:${HUB}`, 'POST'), 405, 'it only lists');
    assert.equal(await statusWithHost(HUB, '/instances.json', `127.0.0.1:${HUB}`, 'GET', { 'sec-fetch-site': 'cross-site' }), 403, "another site's page can't make it probe");
    assert.equal(await statusWithHost(HUB, '/', `127.0.0.1:${HUB}`, 'GET', { 'sec-fetch-site': 'cross-site' }), 200, 'the page itself opens from a link anywhere');
    await a.stop();
    const after = await until(async () => { const l = await list(); return l?.length === 1 && l; }, 'the hub, after alpha stops');
    assert.deepEqual(after.map((x) => x.name), ['beta'], 'whichever dashboard is left serves the hub and lists what is left');
    await b.stop();
    // something that isn't a devteam hub holds the port: the dashboard says so once and stays out of it
    const squatter = http.createServer((req, res) => res.end('hello')).listen(HUB, '127.0.0.1');
    try {
      const c = startDashboard(A, env);
      try {
        await until(() => fs.existsSync(path.join(A, 'docs/devteam/run/dashboard.log')) && /isn't a devteam hub/.test(fs.readFileSync(path.join(A, 'docs/devteam/run/dashboard.log'), 'utf8')), 'the dashboard noting the squatter');
      } finally { await c.stop(); }
    } finally { squatter.close(); }
  } finally {
    await a.stop();
    if (b) await b.stop();
    fs.rmSync(base, { recursive: true, force: true });
  }
});
