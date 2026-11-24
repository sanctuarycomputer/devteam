// kit-109: a thread about a live session's work goes straight to that session, which replies in it.
// The contract is log.schema.json@responder-2: an owner turn routed_to session names the session it
// was typed to (routed_session), and a ticket or planner writer writes turns in threads bound to it.
// Its fake is the hand-written lines below (C0 accepted, C1-C4, S3g, S3i refused), checked by
// log-check the way every reader folds them. Run with TMUX unset (the fixture's own tmux server).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dashboardOnFreePort, hasTmux, line, threadsFixture, write } from './lib/kit.mjs';

const W = 'web-09-live';
const X = 'web-08-other';
const M = 'web-07-merged';
const Y = 'web-06-slow';
const A = 'web-05-asks';
const CH = 'chore-05-pad';
const RULE = '\u2500'.repeat(80);
const MENU = [RULE, ' Bash command', '', '   npm test', '', ' Do you want to proceed?', ' \u276f 1. Yes', '   2. No', '', ' Esc to cancel'];
const FEAT = 'pricing';
const P = `plan-${FEAT}`;
const WORKER = (id = W) => ({ DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: id });
const PLANNER = (f = FEAT) => ({ DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: f });
const NO_TMUX = !hasTmux && 'no tmux';
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const item = (ref) => JSON.stringify({ kind: 'item', ref });
const month = () => new Date().toISOString().slice(0, 7);

test('kit-109 contract: log.schema.json@responder-2', async (t) => {
  const F = threadsFixture('session-contract');
  t.after(() => F.done());
  F.sup(['feature', 'add', FEAT, '--json', JSON.stringify({ title: 'Pricing', goals: [F.goal], stories: [{ id: 'PR-S1', text: 'a story', release: 'v1.0.0' }] })]);
  F.sup(['ticket', 'add', W, '--json', JSON.stringify({ title: W, feature: FEAT, component: 'web', kind: 'build', size: 'S', risk: 'normal', serves: ['PR-S1'], depends_on: [], touches: ['src/**'], done_when: ['its test passes in CI'] })]);
  const T = 't-20261110-100000000-owner';
  const thread = ['owner', { type: 'thread', id: T, title: 'The pricing page', subject: { kind: 'item', ref: `ticket:${W}` } }];
  const ok = (...ls) => { const r = F.checkWith(...ls); assert.equal(r.status, 0, r.said); };
  const refused = (why, ...ls) => { const r = F.checkWith(...ls); assert.notEqual(r.status, 0, `refused: ${why}`); assert.match(r.said, why); };
  const routed = (extra) => ['owner', { type: 'turn', thread: T, text: 'Make it two tiers', ...extra }];

  await t.test('C0: the fake: a turn routed to a session, a ticket turn, a planner turn in its monthly file, a session handoff', () => {
    ok(thread,
      routed({ routed_to: 'session', routed_session: W }),
      [W, { type: 'turn', thread: T, text: 'Two tiers it is' }, `${W}.jsonl`],
      [P, { type: 'turn', thread: T, text: 'Noted for the plan' }, `${P}-${month()}.jsonl`],
      [W, { type: 'message', id: `m-${new Date(Date.now() - 50000).toISOString().replace(/[-:.Z]/g, '').replace('T', '-')}-${W}`, to: 'supervisor', kind: 'handoff', text: 'The owner asks to merge it', re: null, sha: null, ticket: null, thread: T }, `${W}.jsonl`]);
  });
  await t.test('C1: routed_session with routed_to supervisor is refused', () => {
    refused(/routed_session goes with routed_to session/, thread, routed({ routed_to: 'supervisor', routed_session: W }));
  });
  await t.test('C2: routed_session naming the supervisor is refused', () => {
    refused(/routed_session is a ticket or planner/, thread, routed({ routed_to: 'session', routed_session: 'supervisor' }));
  });
  await t.test("C3: routed_session on a session's own turn is refused", () => {
    refused(/routed_session is on the owner's turns, with routed_to session/, thread, [W, { type: 'turn', thread: T, text: 'mine', routed_session: W }, `${W}.jsonl`]);
  });
  await t.test('C5: routed_session that no writer can have is refused (contract-1 F1)', () => {
    for (const v of ['9abc', 'owner-2026-11']) refused(/routed_session is a ticket or planner/, thread, routed({ routed_to: 'session', routed_session: v }));
  });
  await t.test('C4: routed_to session with no routed_session is refused', () => {
    refused(/routed_session goes with routed_to session/, thread, routed({ routed_to: 'session' }));
  });
  await t.test("S3g: log-check refuses a session turn with question, and keeps one without", () => {
    refused(/a session's turns ask nothing/, thread, [W, { type: 'turn', thread: T, text: 'asking', question: 'q-20990101-000000000-supervisor' }, `${W}.jsonl`]);
    ok(thread, [W, { type: 'turn', thread: T, text: 'fine' }, `${W}.jsonl`]);
  });
  await t.test("S3i: log-check refuses a planner's turn in its plan file", () => {
    // a plan file is read from the durable log (the plan branch's, landed), never the live one
    const pf = path.join(F.old, 'docs/devteam/project/log', `${P}.jsonl`);
    const was = fs.existsSync(pf) ? fs.readFileSync(pf) : null;
    const d = new Date(Date.now() - 30000);
    const stamp = `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
    try {
      fs.mkdirSync(path.dirname(pf), { recursive: true });
      fs.appendFileSync(pf, line({ op: 'new', type: 'turn', id: `u-${stamp}-${P}`, at: d.toISOString(), by: P, thread: T, text: 'in the plan file' }));
      refused(/a planner's turns belong in its monthly file/, thread);
    } finally {
      if (was === null) fs.rmSync(pf, { force: true }); else fs.writeFileSync(pf, was);
    }
  });
});

function fixture(name) {
  const F = threadsFixture(name);
  const session = F.sup(['settings', '--get', 'tmux_session']);
  const tmux = (args) => spawnSync('tmux', args, { env: F.env(), encoding: 'utf8' });
  const agentFile = path.join(F.base, 'agent.mjs');
  write(agentFile, "import fs from 'node:fs';\nprocess.stdout.write('stand-in\\n');\nprocess.stdin.on('data', (d) => fs.appendFileSync(process.argv[2], String(d)));\n");
  const hasSession = () => tmux(['has-session', '-t', `=${session}`]).status === 0;
  // a window in the fleet's session running a stand-in agent that logs what is typed into it
  const pane = (win, { shell = false } = {}) => {
    const keys = path.join(F.base, `keys-${win}.txt`);
    const cmd = shell ? 'sh' : `${process.execPath} ${agentFile} ${keys}`;
    const r = hasSession() ? tmux(['new-window', '-d', '-t', `=${session}:`, '-n', win, cmd]) : tmux(['new-session', '-d', '-x', '220', '-y', '50', '-s', session, '-n', win, cmd]);
    assert.equal(r.status, 0, r.stderr);
    if (!shell) for (let i = 0; i < 300 && !/stand-in/.test(tmux(['capture-pane', '-p', '-t', `=${session}:${win}`]).stdout ?? ''); i++) sleep(100);
    return { win, typed: () => (fs.existsSync(keys) ? fs.readFileSync(keys, 'utf8') : '') };
  };
  // a window whose agent shows a question menu and logs what is typed into it
  const asking = (win) => {
    const keys = path.join(F.base, `keys-${win}.txt`);
    const f = path.join(F.base, `menu-${win}.mjs`);
    write(f, `import fs from 'node:fs';\nprocess.stdout.write(${JSON.stringify(`${MENU.join('\n')}\n`)});\nprocess.stdin.on('data', (d) => fs.appendFileSync(${JSON.stringify(keys)}, String(d)));\n`);
    assert.equal(tmux(['new-window', '-d', '-t', `=${session}:`, '-n', win, `${process.execPath} ${f}`]).status, 0);
    for (let i = 0; i < 300 && !/Do you want to proceed/.test(tmux(['capture-pane', '-p', '-t', `=${session}:${win}`]).stdout ?? ''); i++) sleep(100);
    return { win, typed: () => (fs.existsSync(keys) ? fs.readFileSync(keys, 'utf8') : '') };
  };
  const kill = (win) => tmux(['kill-window', '-t', `=${session}:${win}`]);
  F.sup(['feature', 'add', 'olap', '--json', JSON.stringify({ title: 'Overlap', goals: [F.goal], stories: [{ id: 'OL-S1', text: 'a story', release: 'v1.0.0' }] })]);
  const ticket = (id) => F.sup(['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'olap', component: 'web', kind: 'build', size: 'S', risk: 'normal', serves: ['OL-S1'], depends_on: [], touches: ['src/**'], done_when: ['its test passes in CI'] })]);
  const phase = (id, to) => F.ok(F.old, ['phase', to], WORKER(id));
  // every line with this id, folded (op new first), with the file its op new is in
  const lineOf = (id) => {
    let o = null;
    for (const f of fs.readdirSync(F.logDir)) for (const l of fs.readFileSync(path.join(F.logDir, f), 'utf8').split('\n')) {
      if (!l.trim()) continue;
      const x = JSON.parse(l);
      if (x.id === id) o = { ...(o ?? {}), ...x, file: o?.file ?? f };
    }
    return o ?? {};
  };
  const supPane = F.standIn();
  const OWN = { DEVTEAM_SUPERVISOR: supPane.target };
  const newThread = (subject, words = 'first words') => {
    const T = F.owner(['thread', 'new', '--title', 'a thread', '--subject', subject, '--', words], OWN).split('\n')[0];
    const U = JSON.parse(F.owner(['thread', 'show', T, '--json'])).turns[0].id;
    return { T, U };
  };
  const say = (T, words) => F.owner(['thread', 'say', T, '--', words], OWN).split('\n')[0];
  const preview = (name, s) => write(path.join(F.old, 'docs/devteam/run/previews', `${name}.json`), JSON.stringify({ v: 1, name, port: 5173, project: 'p', session: s, label: 'x', cwd: F.old, at: new Date().toISOString(), expires: new Date(Date.now() + 86400000).toISOString() }));
  const findings = (kind) => JSON.parse(F.sup(['metrics', '--json'])).findings.filter((f) => f.kind === kind);
  // a supervisor setting, in the working settings.md (session_threads is not an owner setting)
  const sf = path.join(F.old, 'docs/devteam/project/settings.md');
  const setting = (k, v) => {
    const text = fs.readFileSync(sf, 'utf8');
    const block = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text);
    fs.writeFileSync(sf, text.replace(block[1], JSON.stringify({ ...JSON.parse(block[1]), [k]: v }, null, 2)));
  };
  const logSizes = () => fs.readdirSync(F.logDir).sort().map((f) => `${f}:${fs.statSync(path.join(F.logDir, f)).size}`).join();
  return { ...F, session, tmux, pane, asking, kill, ticket, phase, lineOf, supPane, OWN, newThread, say, preview, findings, setting, logSizes };
}

test('kit-109 session-bound threads', { skip: NO_TMUX, timeout: 600000 }, async (t) => {
  const F = fixture('session-threads');
  t.after(() => F.done());
  for (const id of [W, X, M, Y, A, CH]) { F.ticket(id); F.phase(id, 'build'); }
  F.g(['branch', `plan/${FEAT}`], F.old);
  F.g(['branch', 'plan/other'], F.old);
  const wp = F.pane(W);
  const pp = F.pane(P);
  F.pane(X);
  F.pane(M);
  F.pane(Y);
  F.pane(CH);
  const ap = F.asking(A);
  F.pane('plan-other');
  const rp = F.pane('responder');

  // ---- done-when 1: routing to the live session
  const tw = F.newThread(item(`ticket:${W}`));
  await t.test('S1a: ticket:<id> with its worker live: routed_to session, routed_session W', () => {
    const o = F.lineOf(tw.U);
    assert.deepEqual([o.routed_to, o.routed_session], ['session', W]);
  });
  await t.test("S1b: typed into W's pane only, as [devteam thread <t> from owner on ticket <id>]", () => {
    assert.match(wp.typed(), new RegExp(`\\[devteam thread ${tw.T} from owner on ticket ${W}\\]`));
    assert.ok(!F.supPane.typed().includes(tw.T) && !rp.typed().includes(tw.T), "not into the supervisor's or the responder's pane");
  });
  const tp = F.newThread(item(`planner:${FEAT}`));
  await t.test('S1c: planner:<feature> with its planner live: routed to plan-<feature>, typed into its pane', () => {
    const o = F.lineOf(tp.U);
    assert.deepEqual([o.routed_to, o.routed_session, /from owner on planner/.test(pp.typed())], ['session', P, true]);
  });
  F.preview('brave-otter', W);
  const tv = F.newThread(JSON.stringify({ kind: 'preview', name: 'brave-otter' }));
  await t.test("S1d: a preview whose record's session is W: routed to W", () => {
    const o = F.lineOf(tv.U);
    assert.deepEqual([o.routed_to, o.routed_session, wp.typed().includes(`[devteam thread ${tv.T} from owner on preview brave-otter]`), F.supPane.typed().includes(tv.T)], ['session', W, true, false]);
  });
  await t.test("S1h: W's pane asking a question: routed to W, held, printed as held, and never thread-undelivered", () => {
    const out = F.owner(['thread', 'new', '--title', 'held', '--subject', item(`ticket:${A}`), '--', 'while it asks'], F.OWN);
    const T = out.split('\n')[0];
    const U = JSON.parse(F.owner(['thread', 'show', T, '--json'])).turns[0].id;
    const und = path.join(F.old, 'docs/devteam/run/undelivered-turns.json');
    const recorded = fs.existsSync(und) && Object.hasOwn(JSON.parse(fs.readFileSync(und, 'utf8')), U);
    const got = [F.lineOf(U).routed_session, /recorded and held: the agent on web-05-asks's terminal is asking a question/.test(out), ap.typed().includes(T), recorded, F.findings('thread-undelivered').length];
    F.kill(A);
    assert.deepEqual(got, [A, true, false, false, 0], out);
  });
  await t.test('S1e: thread say routes the same way', () => {
    assert.equal(F.lineOf(F.say(tw.T, 'and another thing')).routed_session, W);
  });
  await t.test('S1f: thread reopen with words routes the same way', () => {
    F.owner(['thread', 'resolve', tv.T], F.OWN);
    F.owner(['thread', 'reopen', tv.T, '--', 'one more look'], F.OWN);
    const u = JSON.parse(F.owner(['thread', 'show', tv.T, '--json'])).turns.at(-1).id;
    assert.equal(F.lineOf(u).routed_session, W);
  });
  await t.test("S1g: an artifact drawn in W's worktree is not routed to W (ruling a-20261123-042800922)", () => {
    write(path.join(F.old, '.worktrees', W, 'docs/devteam/project/artifacts/mock-a/index.html'), '<p>x</p>');
    const ta = F.newThread(JSON.stringify({ kind: 'artifact', slug: 'mock-a', at: W }));
    const o = F.lineOf(ta.U);
    assert.ok(o.routed_to !== 'session' && !wp.typed().includes(ta.T) && ['supervisor', 'responder'].includes(o.routed_to), `routed by the other rules, not to W: ${o.routed_to}`);
  });

  // ---- done-when 2: falling through
  const fall = (label, setup, undo) => t.test(label, () => {
    setup();
    try {
      const U = F.say(tw.T, `while ${label}`);
      const o = F.lineOf(U);
      assert.ok(o.routed_to === 'responder' && o.routed_session === undefined && !wp.typed().includes(`while ${label}`), `fell through to the responder, typed nowhere near W: ${o.routed_to}/${o.routed_session}`);
    } finally { undo(); }
  });
  await fall('S2a: parked', () => F.phase(W, 'parked'), () => F.phase(W, 'build'));
  await fall('S2b: done', () => F.phase(W, 'done'), () => F.phase(W, 'build'));
  await fall('S2d: no window', () => F.kill(W), () => Object.assign(wp, F.pane(W)));
  await fall('S2e: its pane runs only a shell', () => { F.kill(W); F.pane(W, { shell: true }); }, () => { F.kill(W); Object.assign(wp, F.pane(W)); });
  await fall('S2g: session_threads false', () => F.setting('session_threads', false), () => F.setting('session_threads', true));
  await t.test('S2c: merged: a merged worker with its window still up falls through', () => {
    F.g(['checkout', '-q', '-b', `ticket/${M}`], F.old);
    write(path.join(F.old, 'src/m.txt'), 'm\n');
    F.g(['add', 'src/m.txt'], F.old);
    F.g(['commit', '-qm', `${M}: work`], F.old);
    F.g(['checkout', '-q', 'main'], F.old);
    F.g(['merge', '-q', '--no-ff', '-m', `Merge pull request #9 from o/ticket/${M}`, `ticket/${M}`], F.old);
    F.g(['push', '-q', 'origin', 'main'], F.old);
    const tm = F.newThread(item(`ticket:${M}`));
    const o = F.lineOf(tm.U);
    assert.ok(o.routed_to === 'responder' && o.routed_session === undefined, `fell through to the responder: ${o.routed_to}/${o.routed_session}`);
  });
  await t.test('S2h: a preview the supervisor offered is never bound', () => {
    F.preview('quiet-heron', 'supervisor');
    // a window named supervisor in the fleet's session, so only the binding can keep it from routing there
    F.pane('supervisor');
    let o;
    try { o = F.lineOf(F.newThread(JSON.stringify({ kind: 'preview', name: 'quiet-heron' })).U); } finally { F.kill('supervisor'); }
    assert.ok(o.routed_session === undefined && o.routed_to === 'responder', `routed to the responder: ${o.routed_to}/${o.routed_session}`);
  });
  await t.test("S2j: a thread holding the supervisor's open thread ask question goes to the supervisor first", () => {
    const { T } = F.newThread(item(`ticket:${X}`));
    F.sup(['thread', 'ask', T, '--question', 'Ship it?', '--options', 'Yes', 'No']);
    assert.equal(F.lineOf(F.say(T, 'Yes')).routed_to, 'supervisor');
    F.owner(['thread', 'resolve', T], F.OWN);
  });
  await t.test("S1i: a long owner turn is cut at 300 bytes in W's pane, as the supervisor's is", () => {
    F.say(tw.T, `long ${'L'.repeat(400)}`);
    const typed = wp.typed();
    assert.ok(typed.includes(`long ${'L'.repeat(295)}…`) && !typed.includes('L'.repeat(296)) && typed.includes(`thread show ${tw.T}`), typed.slice(-500));
  });
  await t.test('S2k: a malformed session_threads ("no") keeps routing on', () => {
    F.setting('session_threads', 'no');
    try { assert.equal(F.lineOf(F.say(tw.T, 'still yours?')).routed_session, W); } finally { F.setting('session_threads', true); }
  });
  await t.test("S2i: a chore-* artifact is never bound, even when a ticket of that name is live: its reply there is refused", () => {
    write(path.join(F.old, '.worktrees', CH, 'docs/devteam/project/artifacts/mock-c/index.html'), '<p>x</p>');
    const tc = F.newThread(JSON.stringify({ kind: 'artifact', slug: 'mock-c', at: CH }));
    const r = F.run(F.old, ['thread', 'reply', tc.T, 'mine?'], WORKER(CH));
    assert.match(`${r.err}${r.out}`, /this thread isn't about your work; send supervisor instead/);
  });

  // ---- done-when 3: who may reply
  await t.test("S3a: the bound writer's thread reply writes its turn, in its own file", () => {
    const r = F.run(F.old, ['thread', 'reply', tw.T, 'On it, the button moves today'], WORKER(W));
    const u = F.lineOf(r.out.split('\n')[0]);
    assert.deepEqual([u.by, u.file], [W, `${W}.jsonl`], r.err);
  });
  await t.test('S3b: another ticket writer is refused, writing nothing', () => {
    const before = F.logSizes();
    const r = F.run(F.old, ['thread', 'reply', tw.T, 'not mine'], WORKER(X));
    assert.match(`${r.err}${r.out}`, /this thread isn't about your work; send supervisor instead/);
    assert.equal(F.logSizes(), before);
  });
  await t.test('S3c: another planner is refused', () => {
    const before = F.logSizes();
    assert.match(Object.values(F.run(F.old, ['thread', 'reply', tp.T, 'not mine'], PLANNER('other'))).join(' '), /this thread isn't about your work/);
    assert.equal(F.logSizes(), before, 'nothing written');
  });
  const tg = F.newThread(item(`goal:${F.goal}`));
  await t.test('S3d: an unbound thread is refused', () => {
    const before = F.logSizes();
    assert.match(Object.values(F.run(F.old, ['thread', 'reply', tg.T, 'hello'], WORKER(W))).join(' '), /this thread isn't about your work/);
    assert.equal(F.logSizes(), before, 'nothing written');
  });
  await t.test("S3e: a planner's thread reply lands in its monthly file", () => {
    const r = F.run(F.old, ['thread', 'reply', tp.T, 'The plan keeps two tiers'], PLANNER());
    assert.match(F.lineOf(r.out.split('\n')[0]).file ?? `refused: ${r.err}`, new RegExp(`^${P}-\\d{4}-\\d{2}\\.jsonl$`));
  });
  await t.test("S3f: a planner's turn reaches /api/threads", async () => {
    const snap = F.snapLog();
    F.hand(P, { type: 'turn', thread: tp.T, text: 'by hand, two tiers' }, 1000, `${P}-${month()}.jsonl`);
    const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
    try {
      const { threads } = await (await fetch(`http://127.0.0.1:${port}/api/threads`)).json();
      assert.ok(threads.find((x) => x.id === tp.T).turns.some((x) => x.writer === P), 'a turn whose writer is the planner');
    } finally { dash.stop(); F.restoreLog(snap); }
  });
  await t.test("S3h: W may reply in an artifact thread drawn in its worktree (ruling a-20261123-042800922)", () => {
    write(path.join(F.old, '.worktrees', W, 'docs/devteam/project/artifacts/mock-b/index.html'), '<p>x</p>');
    const ta = F.newThread(JSON.stringify({ kind: 'artifact', slug: 'mock-b', at: W }));
    const r = F.run(F.old, ['thread', 'reply', ta.T, 'The mock now shows two tiers'], WORKER(W));
    assert.equal(F.lineOf(r.out.split('\n')[0]).by, W, r.err);
  });
  const tx = F.newThread(item(`ticket:${Y}`), 'y first');
  await t.test("S6h: after the supervisor answered, the session's reply needs --anyway; with it, it is written", () => {
    F.sup(['thread', 'reply', tx.T, 'The worker is busy; it ships today']);
    const before = F.logSizes();
    const r = F.run(F.old, ['thread', 'reply', tx.T, 'late answer', '--refs', `ticket:${Y}`], WORKER(Y));
    assert.match(`${r.err}${r.out}`, /the supervisor has answered this/);
    assert.equal(F.logSizes(), before, 'nothing written');
    const r2 = F.run(F.old, ['thread', 'reply', tx.T, 'late answer', '--refs', `ticket:${Y}`, '--anyway'], WORKER(Y));
    const u = F.lineOf(r2.out.split('\n')[0]);
    assert.deepEqual([u.by, u.refs], [Y, [`ticket:${Y}`]], r2.err);
  });
});
