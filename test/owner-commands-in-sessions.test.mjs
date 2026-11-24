// Every owner command refuses in a worker's or planner's session (kit-786): ownerWriter refuses when
// DEVTEAM_TICKET or DEVTEAM_FEATURE is set at all (empty too), whatever DEVTEAM_ROLE says, and when
// it runs from a ticket/ or plan/ checkout or from under a .worktrees folder with every variable
// cleared. A refused command writes nothing to the log. The owner's own terminal still writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture } from './lib/kit.mjs';

// ownerWriter's own refusal, as it names the session
const REFUSED = /owner commands don't run in a worker's or planner's session \(/;

test('every owner command refuses in a worker\'s or planner\'s session, and the owner\'s own terminal still writes', async () => {
  const F = fleetFixture('owner-sessions');
  const { old, g } = F;
  try {
    const SUP = { DEVTEAM_ROLE: 'supervisor' };
    const first = (s) => s.split('\n')[0];
    const goal = F.ok(old, ['goal', 'add', '--title', 'G', '--outcome', 'o', '--measure', 'm', '--target', '1', '--unit', 'u', '--direction', 'up', '--source', 'owner'], SUP);
    const obs = first(F.ok(old, ['observe', '--subject', 'kit', '--kind', 'note', '--detail', 'seen'], SUP));
    const lesson = first(F.ok(old, ['knowledge', 'add', '--kind', 'lesson', '--statement', 'a lesson worth keeping here', '--scope', 'project', '--evidence', obs], SUP));
    const problem = first(F.ok(old, ['problem', 'add', '--title', 'p', '--severity', '2'], SUP));
    const logDir = path.join(old, 'docs/devteam/run/log');
    // a review question, as ask --kind review leaves it (review draft looks it up before ownerWriter)
    const QR = 'q-20260101-000000000-supervisor';
    fs.appendFileSync(path.join(logDir, `supervisor-${new Date().toISOString().slice(0, 7)}.jsonl`), `${JSON.stringify({ v: 1, op: 'new', type: 'question', kind: 'review', review: { page: 'p.html' }, id: QR, at: new Date().toISOString(), by: 'supervisor', text: 'review these' })}\n`);
    // the checkouts a session works in: a ticket worktree and a detached one in home's .worktrees,
    // which is a link to a folder elsewhere (moved to a bigger disk), so their real paths have no
    // .worktrees in them; a detached one under another .worktrees folder (another repo's); and a
    // plan/ and a ticket/ checkout outside any .worktrees
    fs.mkdirSync(path.join(F.base, 'disk'));
    fs.symlinkSync(path.join(F.base, 'disk'), path.join(old, '.worktrees'));
    const wt = path.join(old, '.worktrees', 'web-1');
    const loose = path.join(old, '.worktrees', 'loose');
    const elsewhere = path.join(F.base, 'other', '.worktrees', 'loose2');
    const planCo = path.join(F.base, 'plan-co');
    const ticketCo = path.join(F.base, 'ticket-co');
    g(['worktree', 'add', '-q', '-b', 'ticket/web-1', wt], old);
    g(['worktree', 'add', '-q', '--detach', loose], old);
    g(['worktree', 'add', '-q', '--detach', elsewhere], old);
    g(['worktree', 'add', '-q', '-b', 'plan/f', planCo], old);
    g(['worktree', 'add', '-q', '-b', 'ticket/web-2', ticketCo], old);
    // home's kit, by absolute path from any checkout
    const kitDT = path.join(old, 'docs/devteam/scripts/devteam.mjs');
    const runAt = (cwd, args, env) => { const r = spawnSync(process.execPath, [kitDT, ...args], { cwd, env: F.env(env), encoding: 'utf8', input: '', timeout: 120000 }); return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
    // the same, without waiting: a refused run writes nothing, so a few run at once (the file stays
    // well inside CI's 300 s watchdog on its slowest runner)
    const runLater = (cwd, args, env) => new Promise((resolve) => {
      const c = spawn(process.execPath, [kitDT, ...args], { cwd, env: F.env(env), stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
      let out = '';
      let err = '';
      c.stdout.on('data', (d) => { out += d; });
      c.stderr.on('data', (d) => { err += d; });
      // a child that couldn't start is a failed run, named by its command's assertion, never a crash
      c.on('error', (e) => { err += `could not start: ${e.code ?? e.message}`; });
      c.on('close', (status) => resolve({ status, out: out.trim(), err: err.trim() }));
    });
    const pool = async (jobs, n = 4) => { const res = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < jobs.length) { const k = i++; res[k] = await jobs[k](); } })); return res; };
    // every log file and its bytes: nothing logged means this is the same after a run
    const snap = () => Object.fromEntries((fs.existsSync(logDir) ? fs.readdirSync(logDir) : []).sort().map((f) => [f, fs.readFileSync(path.join(logDir, f), 'utf8')]));
    const T = 't-20260101-000000000-owner';
    const Q = 'q-20260101-000000001-supervisor';
    // each owner command that goes through ownerWriter, as it reaches it. early: the sessions in
    // which the command's own guard refuses before ownerWriter does (still refused, nothing logged).
    // named: run in every session; the rest run with DEVTEAM_TICKET and with DEVTEAM_FEATURE set
    // (they all reach the same ownerWriter, and a run costs most of a second). ack --owner looks its
    // finding up before ownerWriter, so its other sessions are in test/multirepo-landing.test.mjs.
    const OT = /operator-thread: the owner's and the operator's, not from a/;
    const COMMANDS = [
      { named: true, args: ['answer', Q, 'yes'] },
      { named: true, args: ['thread', 'new', 'hello'], writes: true },
      { args: ['thread', 'say', T, 'hi'] },
      { args: ['thread', 'resolve', T] },
      { args: ['thread', 'reopen', T] },
      { args: ['artifact', 'publish', 'mock', '--owner', '--tree', 'a'.repeat(40)] },
      { args: ['artifact', 'unpublish', 'mock', '--owner'] },
      { args: ['review', 'draft', QR, 'draft.json'] },
      { args: ['secret', 'post', Q] },
      { args: ['correct', 'a-20260101-000000000-supervisor', '--reason', 'r'] },
      { named: true, args: ['observe', '--owner', '--subject', 'kit', '--kind', 'note', '--detail', 'd'], writes: true },
      { named: true, args: ['observe', '--owner', '--kind', 'finding-ack', '--source', 'ack', '--subject', `merged-without-merge x:${'b'.repeat(12)}`, '--detail', 'd'], writes: true },
      { args: ['observe-link', '--owner', '--url', 'https://example.com/x', '--title', 'x'], writes: true },
      { args: ['knowledge', 'add', '--owner', '--kind', 'lesson', '--statement', 'the owner\'s own lesson'] },
      { named: true, args: ['knowledge', 'set', lesson, '--owner', '--status', 'accepted'], writes: true },
      { args: ['problem', 'add', '--owner', '--title', 'p2', '--severity', '2'], writes: true },
      { args: ['problem', 'set', problem, '--owner', '--status', 'open'], writes: true },
      { args: ['goal', 'add', '--owner', '--title', 'G2', '--outcome', 'o', '--measure', 'm', '--target', '1', '--unit', 'u', '--direction', 'up', '--source', 'owner'], writes: true },
      { args: ['goal', 'set', goal, '--owner', '--title', 'G3'], writes: true },
      { args: ['goal', 'order', goal], writes: true },
      { named: true, args: ['goal', 'decide', Q, 'yes'] },
      { args: ['goal', 'approve', Q, 'yes'] },
      { args: ['goal', 'hold', goal, 'park', '--owner'], writes: true },
      { args: ['goal', 'status', goal, 'active'] },
      { args: ['goal', 'reading', goal, '--owner', '--value', '1'], writes: true },
      { args: ['ack', 'stale-worker', 'x', '--reason', 'r', '--owner'], early: { ticket: /ack --owner is the owner's/, feature: /ack --owner is the owner's/ } },
      { named: true, args: ['send', 'supervisor', 'hi', '--owner'], writes: true },
      { args: ['fleet', 'drain', '--owner'] },
      { args: ['fleet', 'park', '--owner'] },
      { args: ['fleet', 'undrain', '--owner'] },
      { args: ['fleet', 'unpark', '--owner'] },
      { args: ['fleet', 'host', '--take'] },
      { args: ['fleet', 'host', '--release'] },
      { args: ['sensor', 'ignore', 'fp1', '--owner', '--reason', 'r'] },
      { args: ['sensor', 'unignore', 'fp1', '--owner'] },
      { args: ['sensor', 'reconsider', 'sentry'] },
      { args: ['owner-setting', 'max_active_tickets', '3'] },
      { args: ['pane', 'answered', '--owner'] },
      { named: true, args: ['operator-thread', 'say', 'ot-1', 'hi'], early: { ticket: OT, feature: OT, blankRole: OT, wt: OT, plan: OT, ticketCo: OT } },
      { args: ['operator-thread', 'new', 'hello'], early: { ticket: OT, feature: OT } },
      { args: ['operator-thread', 'close', 'ot-1'], early: { ticket: OT, feature: OT } },
      { args: ['operator-thread', 'reopen', 'ot-1'], early: { ticket: OT, feature: OT } },
    ];
    // the sessions: the variables a worker or planner has (any value, empty too, whatever
    // DEVTEAM_ROLE says), and the checkouts it works in with every variable cleared
    const SESSIONS = {
      ticket: [old, { DEVTEAM_TICKET: 'web-1' }],
      feature: [old, { DEVTEAM_FEATURE: 'f' }],
      blankRole: [old, { DEVTEAM_ROLE: '', DEVTEAM_TICKET: 'web-1' }],
      emptyTicket: [old, { DEVTEAM_TICKET: '' }],
      emptyFeature: [old, { DEVTEAM_FEATURE: '' }],
      wt: [wt, {}],
      loose: [loose, {}],
      elsewhere: [elsewhere, {}],
      plan: [planCo, {}],
      ticketCo: [ticketCo, {}],
    };
    // A, B: DEVTEAM_TICKET and DEVTEAM_FEATURE set, every command; C to I: the rest, the named ones.
    // Each session's runs go a few at a time; after them, every log file is as it was (N), and a
    // line that appeared names the command that wrote it (its writer and what it says).
    for (const [name, [cwd, env]] of Object.entries(SESSIONS)) {
      const cs = COMMANDS.filter((c) => ['ticket', 'feature'].includes(name) || c.named);
      const where = `session ${name} (${JSON.stringify(env)} at ${path.relative(F.base, cwd) || '.'})`;
      const before = snap();
      const rs = await pool(cs.map((c) => () => runLater(cwd, c.args, env)));
      cs.forEach((c, k) => {
        const label = `${c.args.slice(0, 2).join(' ')} in ${where}`;
        assert.match(rs[k].err, c.early?.[name] ?? REFUSED, `${label}: refused: ${rs[k].err || rs[k].out}`);
        assert.notEqual(rs[k].status, 0, `${label}: exits non-zero`);
      });
      const after = snap();
      const added = Object.keys(after).flatMap((f) => after[f].slice((before[f] ?? '').length).split('\n').filter(Boolean).map((l) => `${f}: ${l.slice(0, 300)}`));
      assert.deepEqual(added, [], `nothing logged by the refused runs in ${where}`);
      assert.deepEqual(after, before, `every log file unchanged in ${where}`);
    }
    // the refusal says why, for the variable and for the checkout
    assert.match(runAt(old, ['observe', '--owner', '--subject', 'kit', '--kind', 'note', '--detail', 'd'], { DEVTEAM_TICKET: '' }).err, /\(DEVTEAM_TICKET=""\)/, 'R: names the variable, set empty');
    assert.match(runAt(ticketCo, ['observe', '--owner', '--subject', 'kit', '--kind', 'note', '--detail', 'd'], {}).err, /this checkout is on ticket\/web-2/, 'R: names the branch');
    assert.match(runAt(loose, ['observe', '--owner', '--subject', 'kit', '--kind', 'note', '--detail', 'd'], {}).err, /is under a \.worktrees folder/, 'R: names the folder');
    assert.match(runAt(planCo, ['observe', '--owner', '--subject', 'kit', '--kind', 'note', '--detail', 'd'], {}).err, /this checkout is on plan\/f/, 'R: names a plan/ branch');
    assert.match(runAt(old, ['observe', '--owner', '--subject', 'kit', '--kind', 'note', '--detail', 'd'], { DEVTEAM_FEATURE: 'f' }).err, /\(DEVTEAM_FEATURE="f"\)/, 'R: names DEVTEAM_FEATURE');
    // O: the owner's own terminal (no variables, home's main checkout): no command is refused as a
    // session, and each that has what it needs writes an owner line
    for (const c of COMMANDS) {
      const label = `${c.args.slice(0, 2).join(' ')} in the owner's own terminal`;
      const before = snap();
      const r = runAt(old, c.args, {});
      assert.doesNotMatch(r.err, REFUSED, `O: ${label} is not refused as a session`);
      if (!c.writes) continue;
      assert.equal(r.status, 0, `O: ${label} exits 0: ${r.err}`);
      const after = snap();
      const added = Object.keys(after).flatMap((f) => after[f].slice((before[f] ?? '').length).split('\n').filter(Boolean).map((l) => JSON.parse(l)));
      assert.ok(added.some((x) => x.by === 'owner'), `O: ${label} writes an owner line: ${JSON.stringify(added)}`);
    }
  } finally { F.done(); }
});

// kit-788: the supervisor's records of the owner's words (answer, goal decide and correct with
// --from-chat or --from-turn) take the same session check, run as the supervisor; the check reads the
// branch and the checkout with the caller's GIT_* variables dropped; and a session that leaves its
// worktree for a folder that is no checkout of home's, keeping DEVTEAM_HOME, is still one.
test('the supervisor\'s records of the owner\'s words refuse in a session too, and still write from the main checkout', async () => {
  const F = fleetFixture('owner-heard');
  const { old, g } = F;
  try {
    const SUP = { DEVTEAM_ROLE: 'supervisor' };
    const kitDT = path.join(old, 'docs/devteam/scripts/devteam.mjs');
    // only the variables a run names: none of this machine's own session, checkout or tmux
    const envOf = (extra) => {
      const e = F.env({});
      for (const k of Object.keys(e)) if (/^(DEVTEAM_|GIT_)/.test(k) || ['TMUX', 'TMUX_PANE'].includes(k)) delete e[k];
      return { ...e, ...extra };
    };
    const runAt = (cwd, args, env) => { const r = spawnSync(process.execPath, [kitDT, ...args], { cwd, env: envOf(env), encoding: 'utf8', input: '', timeout: 120000 }); return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
    const okAt = (cwd, args, env) => { const r = runAt(cwd, args, env); assert.equal(r.status, 0, `${args.join(' ')}: ${r.err || r.out}`); return r.out; };
    const logDir = path.join(old, 'docs/devteam/run/log');
    const snap = () => Object.fromEntries((fs.existsSync(logDir) ? fs.readdirSync(logDir) : []).sort().map((f) => [f, fs.readFileSync(path.join(logDir, f), 'utf8')]));
    const added = (before, after) => Object.keys(after).flatMap((f) => after[f].slice((before[f] ?? '').length).split('\n').filter(Boolean).map((l) => JSON.parse(l)));
    // the checkouts: a ticket worktree and a detached one in home's .worktrees, a ticket/ checkout
    // outside it, and a folder that is no checkout at all
    const wt = path.join(old, '.worktrees', 'web-1');
    const loose = path.join(old, '.worktrees', 'loose');
    const ticketCo = path.join(F.base, 'ticket-co');
    const plain = path.join(F.base, 'plain');
    g(['worktree', 'add', '-q', '-b', 'ticket/web-1', wt], old);
    g(['worktree', 'add', '-q', '--detach', loose], old);
    g(['worktree', 'add', '-q', '-b', 'ticket/web-2', ticketCo], old);
    fs.mkdirSync(plain);
    const mainGit = { GIT_DIR: path.join(old, '.git'), GIT_WORK_TREE: old };
    // git config the caller gives, through the environment or a HOME of theirs, with a value git
    // dies on: a read with it would find no branch
    const badConfig = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.bare', GIT_CONFIG_VALUE_0: 'notabool' };
    // another repo's checkout
    const sibling = path.join(F.base, 'sibling');
    g(['init', '-q', sibling], F.base);
    const badHome = path.join(F.base, 'bad-home');
    fs.mkdirSync(badHome);
    fs.writeFileSync(path.join(badHome, '.gitconfig'), '[core]\n\tbare = notabool\n');
    // the refusal: ownerWriter's session check, or the supervisor-only gate each path had already
    const REFUSED_HEARD = /owner commands don't run in a worker's or planner's session \(|records what the owner said/;
    const Q = 'q-20260101-000000001-supervisor';
    const G = 'g-20260101-000000001-supervisor';
    const A = 'a-20260101-000000001-supervisor';
    const U = 'u-20260101-000000001-owner';
    const HEARD = [
      ['answer', Q, 'yes', '--from-chat', '--said', 'yes'],
      ['answer', Q, 'yes', '--from-turn', U],
      ['goal', 'decide', G, 'approve', '--from-chat', '--said', 'approved'],
      ['goal', 'decide', G, 'approve', '--from-turn', U],
      ['correct', A, '--from-chat', '--said', 'that was wrong'],
      ['correct', A, '--from-turn', U, '--said', 'that was wrong'],
    ];
    const OWN = ['observe', '--owner', '--subject', 'kit', '--kind', 'note', '--detail', 'd'];
    // each session, as the supervisor's role claims it (H1-H8), and the plain owner command where the
    // check itself changed (OWNER_TOO, below): refused, and nothing logged
    const SESSIONS = {
      emptyTicket: [old, { ...SUP, DEVTEAM_TICKET: '' }],
      emptyFeature: [old, { ...SUP, DEVTEAM_FEATURE: '' }],
      ticket: [old, { ...SUP, DEVTEAM_TICKET: 'web-1' }],
      feature: [old, { ...SUP, DEVTEAM_FEATURE: 'f' }],
      wt: [wt, SUP],
      loose: [loose, SUP],
      gitDir: [ticketCo, { ...SUP, ...mainGit }],
      plainHome: [plain, { ...SUP, DEVTEAM_HOME: old }],
      configEnv: [ticketCo, { ...SUP, ...badConfig }],
    };
    const OWNER_TOO = { gitDir: [ticketCo, mainGit], plainHome: [plain, { DEVTEAM_HOME: old }], plainGitDir: [plain, { DEVTEAM_HOME: old, ...mainGit }], configEnv: [ticketCo, badConfig], configHome: [ticketCo, { HOME: badHome }], emptyHome: [plain, { DEVTEAM_HOME: '' }], siblingHome: [sibling, { DEVTEAM_HOME: old }] };
    // a refused run writes nothing, so a session's runs go a few at a time
    const runLater = (cwd, args, env) => new Promise((resolve) => {
      const c = spawn(process.execPath, [kitDT, ...args], { cwd, env: envOf(env), stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
      let out = '';
      let err = '';
      c.stdout.on('data', (d) => { out += d; });
      c.stderr.on('data', (d) => { err += d; });
      c.on('error', (e) => { err += `could not start: ${e.code ?? e.message}`; });
      c.on('close', (status) => resolve({ status, out: out.trim(), err: err.trim() }));
    });
    const pool = async (jobs, n = 4) => { const res = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < jobs.length) { const k = i++; res[k] = await jobs[k](); } })); return res; };
    for (const [name, [cwd, env]] of Object.entries(SESSIONS)) {
      const before = snap();
      const rs = await pool(HEARD.map((args) => () => runLater(cwd, args, env)));
      HEARD.forEach((args, k) => {
        assert.match(rs[k].err, REFUSED_HEARD, `${args.slice(0, args[0] === 'goal' ? 2 : 1).join(' ')} ${args.find((a) => a.startsWith('--from-'))} in session ${name}: refused: ${rs[k].err || rs[k].out}`);
        assert.notEqual(rs[k].status, 0, `${args.slice(0, args[0] === 'goal' ? 2 : 1).join(' ')} ${args.find((a) => a.startsWith('--from-'))} in session ${name}: exits non-zero`);
      });
      assert.deepEqual(added(before, snap()), [], `nothing logged in session ${name}`);
    }
    for (const [name, [cwd, env]] of Object.entries(OWNER_TOO)) {
      const before = snap();
      const r = runAt(cwd, OWN, env);
      assert.match(r.err, REFUSED, `observe --owner in ${name}: refused: ${r.err || r.out}`);
      assert.deepEqual(added(before, snap()), [], `nothing logged by observe --owner in ${name}`);
    }
    assert.match(runAt(plain, OWN, { DEVTEAM_HOME: old }).err, /DEVTEAM_HOME/, 'R: the refusal names DEVTEAM_HOME');
    // O: the supervisor in home's main checkout records each, as the owner's line; and a folder that
    // is no checkout, with no DEVTEAM_HOME (the box's hub runs there), still writes the owner's own
    // the supervisor's own pane, by every sign ownerWriter reads (no tmux server answers on this socket)
    const PANE = { ...SUP, TMUX: `${path.join(F.base, 'no-tmux')},1,0`, TMUX_PANE: '%7', DEVTEAM_SUPERVISOR: '%7' };
    const goal = okAt(old, ['goal', 'add', '--title', 'G', '--outcome', 'o', '--measure', 'm', '--target', '1', '--unit', 'u', '--direction', 'up', '--source', 'owner'], SUP);
    const wrote = (args, env, what) => {
      const before = snap();
      okAt(old, args, env);
      const lines = added(before, snap());
      assert.ok(lines.some((x) => x.by === 'owner'), `O: ${what} writes an owner line: ${JSON.stringify(lines)}`);
    };
    const asked = okAt(old, ['ask', '--question', 'Ship it?', '--recommendation', 'yes'], SUP);
    wrote(['answer', asked, 'yes', '--from-chat', '--said', 'yes, ship it'], PANE, 'answer --from-chat');
    const T = okAt(old, ['thread', 'new', '--title', 't', '--', 'hello'], {}).split('\n')[0];
    const Qt = okAt(old, ['thread', 'ask', T, '--question', 'Tell the team?', '--recommendation', 'Yes', '--goal', goal, '--stake', '1', '--urgency', '1'], SUP).split('\n')[0];
    const Ut = okAt(old, ['thread', 'say', T, '--', 'Yes'], {}).split('\n')[0];
    wrote(['answer', Qt, 'Yes', '--from-turn', Ut], SUP, 'answer --from-turn');
    const act = `a-${new Date().toISOString().replace(/\D/g, '').slice(0, 8)}-${new Date().toISOString().replace(/\D/g, '').slice(8, 17)}-supervisor`;
    fs.appendFileSync(path.join(logDir, `supervisor-${new Date().toISOString().slice(0, 7)}.jsonl`), `${JSON.stringify({ v: 1, op: 'new', type: 'act', id: act, at: new Date().toISOString(), by: 'supervisor', class: 'replan-within-feature', what: 'held a ticket', refs: [], reversible: true })}\n`);
    wrote(['correct', act, '--from-chat', '--said', 'that was the wrong call'], PANE, 'correct --from-chat');
    // a goal ready for the owner's decision on its design, as approvals.test.mjs makes one
    const Gd = okAt(old, ['goal', 'add', '--title', 'Floor', '--outcome', 'the floor holds', '--measure', 'gaps', '--target', '0', '--unit', 'gaps', '--direction', 'down', '--source', 'repo', '--check', 'echo 3', '--non-goals', 'none', '--preconditions', 'a'], SUP);
    okAt(old, ['goal', 'reading', Gd, '--run'], SUP);
    okAt(old, ['goal', 'set', Gd, '--priority', '1', '--milestones', JSON.stringify([{ title: 'Floor', target: 0, preconditions: [1], tickets: 2 }])], SUP);
    fs.mkdirSync(path.join(old, 'docs/devteam/project/designs'), { recursive: true });
    fs.writeFileSync(path.join(old, 'docs/devteam/project/designs/floor.md'), '# design\n');
    g(['add', '-A'], old);
    g(['commit', '-qm', 'design'], old);
    g(['push', '-q', 'origin', 'main'], old);
    okAt(old, ['ask', '--kind', 'goal-approval', '--goal', Gd, '--question', 'Approve the floor?', '--links', JSON.stringify([{ title: 'design', path: 'docs/devteam/project/designs/floor.md', ref: 'main' }])], SUP);
    wrote(['goal', 'decide', Gd, 'refine', '--notes', 'smaller', '--from-chat', '--said', 'make it smaller'], PANE, 'goal decide --from-chat');
    wrote(OWN, { DEVTEAM_HOME: old }, "observe --owner in home's main checkout with DEVTEAM_HOME set");
    const before = snap();
    okAt(plain, OWN, {});
    assert.ok(added(before, snap()).some((x) => x.by === 'owner'), 'O: observe --owner from a folder that is no checkout, no DEVTEAM_HOME, writes');
  } finally { F.done(); }
});
