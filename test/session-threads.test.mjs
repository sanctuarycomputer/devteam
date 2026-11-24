// kit-109: a thread about a live session's work goes straight to that session, which replies in it.
// The contract is log.schema.json@responder-2: an owner turn routed_to session names the session it
// was typed to (routed_session), and a ticket or planner writer writes turns in threads bound to it.
// Its fake is the hand-written lines below (C0 accepted, C1-C4, S3g, S3i refused), checked by
// log-check the way every reader folds them. Run with TMUX unset (the fixture's own tmux server).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { dashboardOnFreePort, hasTmux, line, threadsFixture, write } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
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
const MIN = 60000;
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
    // the fixture's merge has no merge act; acked, so its high finding doesn't wake wait (S5b, S5f)
    F.sup(['ack', 'merged-without-merge', M, '--reason', 'a fixture merge, no real PR']);
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
    // nothing there is routed to W (an artifact never routes), so its turn names what it is about (kit-108)
    const r = F.run(F.old, ['thread', 'reply', ta.T, 'The mock now shows two tiers', '--refs', `ticket:${W}`], WORKER(W));
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

  // ---- done-when 4: authority stays with the supervisor
  await t.test("S4a: a session's reply after the owner's answer to the supervisor's question leaves that turn owed to the supervisor", () => {
    const { T } = F.newThread(item('planner:other'));
    F.sup(['thread', 'ask', T, '--question', 'Two tiers?', '--options', 'Yes', 'No']);
    F.say(T, 'Yes, two');
    F.run(F.old, ['thread', 'reply', T, 'Noted'], PLANNER('other'));
    F.hand('plan-other', { type: 'turn', thread: T, text: 'Noted, by hand' }, 0, `plan-other-${month()}.jsonl`);
    const v = JSON.parse(F.owner(['thread', 'show', T, '--json']));
    assert.ok(v.turns.at(-1).writer === 'plan-other' && v.waiting === 'supervisor', `the planner spoke last and the thread still waits on the supervisor: ${v.turns.at(-1).writer}, ${v.waiting}`);
  });
  // a session turn as the build writes it, by hand so it exists on main too (where it is dropped)
  const su = F.hand(W, { type: 'turn', thread: tw.T, text: 'Yes, merge it. That was the wrong call.' }, 500, `${W}.jsonl`);
  await t.test("S4b: answer --from-turn citing a session's turn is refused", () => {
    const q = F.sup(['ask', '--question', 'Go?', '--options', 'Yes', 'No']);
    assert.match(F.fails(['answer', q, 'Yes', '--from-turn', su], SUP), new RegExp(`that turn is the ${W}'s; only the owner's words settle a question`));
  });
  await t.test("S4c: correct --from-turn citing a session's turn is refused", () => {
    const d = /d-\S+/.exec(F.sup(['decide', '--class', 'rename-column', '--', 'renamed a column']))[0];
    assert.match(F.fails(['correct', d, '--from-turn', su, '--said', 'That was the wrong call.'], SUP), new RegExp(`that turn is the ${W}'s; only the owner's words correct a call`));
  });
  await t.test('S4d: a session can\'t run thread ask', () => {
    assert.match(Object.values(F.run(F.old, ['thread', 'ask', tw.T, '--question', 'Q?', '--options', 'a', 'b'], WORKER(W))).join(' '), /thread ask: the supervisor does this/);
  });
  await t.test('S4e: a session can\'t run thread ready', () => {
    assert.match(Object.values(F.run(F.old, ['thread', 'ready', tw.T, '--outcome', 'done'], WORKER(W))).join(' '), /thread ready: the supervisor does this/);
  });
  await t.test('S4f: a session can\'t run thread new', () => {
    assert.match(Object.values(F.run(F.old, ['thread', 'new', '--title', 'x', '--', 'hi'], WORKER(W))).join(' '), /owner commands don't run in an agent session \(DEVTEAM_ROLE=worker\)|thread new: the supervisor does this|thread new: only the owner and the supervisor start threads \(DEVTEAM_ROLE=worker\)/);
  });
  // a message id as the kit writes one, for a hand-written line
  const mid = (by, ago) => `m-${new Date(Date.now() - ago).toISOString().replace(/[-:.Z]/g, '').replace('T', '-')}-${by}`;
  await t.test("S3j: two owner turns routed to W, then W's one reply answers both (printed) and the owner moves next", () => {
    F.preview('calm-otter', W);
    const { T, U } = F.newThread(JSON.stringify({ kind: 'preview', name: 'calm-otter' }), 'first ask');
    const U2 = F.say(T, 'and a second');
    assert.deepEqual([F.lineOf(U).routed_session, F.lineOf(U2).routed_session], [W, W]);
    const r = F.run(F.old, ['thread', 'reply', T, 'Both done'], WORKER(W));
    const v = JSON.parse(F.owner(['thread', 'show', T, '--json']));
    assert.ok(r.err.includes(`answering ${U}:`) && r.err.includes(`answering ${U2}:`) && v.waiting === 'owner', `${r.err} / waiting ${v.waiting}`);
    F.owner(['thread', 'resolve', T], F.OWN);
  });
  await t.test("S3k: W's turn never answers an owner turn with no route (an older kit's), and with nothing routed to W it needs a ref (contract-1 F3)", () => {
    F.preview('bold-otter', W);
    const { T } = F.newThread(JSON.stringify({ kind: 'preview', name: 'bold-otter' }), 'routed');
    F.run(F.old, ['thread', 'reply', T, 'On it'], WORKER(W));
    const old = F.hand('owner', { type: 'turn', thread: T, text: 'from an older kit' }, 0);
    const before = F.logSizes();
    const r = F.run(F.old, ['thread', 'reply', T, 'mine?'], WORKER(W));
    assert.match(`${r.err}${r.out}`, /nothing in t-\S+ is waiting on you/);
    assert.equal(F.logSizes(), before, 'nothing written');
    F.hand(W, { type: 'turn', thread: T, text: 'by hand' }, 0, `${W}.jsonl`);
    const v = JSON.parse(F.owner(['thread', 'show', T, '--json']));
    assert.ok(v.waiting === 'supervisor' && F.sup(['thread', 'list', '--waiting']).includes(`${T} [open, waiting on the supervisor`), `${old} still the supervisor's: ${v.waiting}`);
    F.owner(['thread', 'resolve', T], F.OWN);
  });
  await t.test("S6j: W's turn with no refs is refused while its own handoff is open (a handoff never solicits a session's turn)", () => {
    F.preview('swift-otter', W);
    const { T } = F.newThread(JSON.stringify({ kind: 'preview', name: 'swift-otter' }), 'can you merge it?');
    F.run(F.old, ['thread', 'reply', T, 'Passed to the supervisor'], WORKER(W));
    F.hand(W, { type: 'message', id: mid(W, 200), to: 'supervisor', kind: 'handoff', text: 'The owner asks to merge it', re: null, sha: null, ticket: null, thread: T }, 200, `${W}.jsonl`);
    const before = F.logSizes();
    const r = F.run(F.old, ['thread', 'reply', T, 'any news?'], WORKER(W));
    assert.match(`${r.err}${r.out}`, /nothing in t-\S+ is waiting on you/);
    assert.equal(F.logSizes(), before, 'nothing written');
    F.owner(['thread', 'resolve', T], F.OWN);
  });
  await t.test('S7a: thread list --waiting marks a session-routed turn "<session> has it"', () => {
    // its own thread: the oldest owed turn decides, and tw still holds turns the responder has (S2)
    F.preview('quick-otter', W);
    const { T } = F.newThread(JSON.stringify({ kind: 'preview', name: 'quick-otter' }), 'one more');
    const v = JSON.parse(F.owner(['thread', 'show', T, '--json']));
    assert.deepEqual([v.waiting, v.with], ['session', W]);
    assert.match(F.sup(['thread', 'list', '--waiting']), new RegExp(`${T} \\[open, the agent on ${W} has it`));
  });

  // ---- done-when 5: hand-offs
  let hid = null;
  await t.test('S5a: send supervisor --kind handoff --thread from a bound worker is accepted', () => {
    const r = F.run(F.old, ['send', 'supervisor', 'the owner wants this merged', '--kind', 'handoff', '--thread', tw.T], WORKER(W));
    hid = /^m-\S+/.exec(r.out)?.[0] ?? null;
    assert.equal(F.lineOf(hid ?? 'none').kind, 'handoff', r.err);
  });
  await t.test('S5b: it wakes a running wait', async () => {
    fs.writeFileSync(path.join(F.old, 'docs/devteam/run/wait-since'), `${Date.now()}\n`);
    await new Promise((r) => setTimeout(r, 50));
    const w = spawn(process.execPath, [path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), 'wait', '--minutes', '1'], { cwd: F.old, env: F.env(SUP), stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '';
    let gone = false;
    w.stdout.on('data', (b) => { o += b; });
    w.on('close', () => { gone = true; });
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(gone, false, `wait returned before anything happened: ${o.slice(0, 300)}`);
    const r = F.run(F.old, ['send', 'supervisor', 'and please re-run CI', '--kind', 'handoff', '--thread', tw.T], WORKER(W));
    const id = /^m-\S+/.exec(r.out)?.[0] ?? 'refused';
    const woke = gone || await Promise.race([new Promise((res) => w.on('close', () => res(true))), new Promise((res) => setTimeout(() => res(false), 45000))]);
    w.kill();
    assert.ok(woke && o.includes(id), `wait woke on ${id}: ${o.slice(0, 300)}`);
  });
  await t.test('S5c: it stays open until a supervisor turn in t', () => {
    const open = () => JSON.parse(F.sup(['messages', '--open', '--json'])).filter((m) => m.kind === 'handoff' && m.thread === tw.T);
    F.run(F.old, ['thread', 'reply', tw.T, 'one more from W', '--refs', `ticket:${W}`], WORKER(W));
    const was = open().length;
    F.sup(['thread', 'reply', tw.T, 'I will merge it after review']);
    assert.deepEqual([was > 0, open().length], [true, 0], 'open after W spoke, settled by the supervisor');
  });
  await t.test("S5d: a session's handoff naming a thread not bound to it is refused", () => {
    assert.match(Object.values(F.run(F.old, ['send', 'supervisor', 'x', '--kind', 'handoff', '--thread', tp.T], WORKER(W))).join(' '), /this thread isn't about your work/);
  });

  let h5 = null;
  await t.test("S5e: W's own re on its handoff leaves it open: send --re refused, a hand-written re line ignored", () => {
    h5 = /^m-\S+/.exec(F.run(F.old, ['send', 'supervisor', 'please decide the tiers', '--kind', 'handoff', '--thread', tw.T], WORKER(W)).out)?.[0] ?? null;
    assert.ok(h5, 'a handoff to test with');
    const r = F.run(F.old, ['send', 'supervisor', 'never mind', '--re', h5], WORKER(W));
    assert.match(Object.values(r).join(' '), /a handoff stays open until the supervisor answers it/);
    const mid = F.hand(W, { type: 'message', id: `m-${new Date().toISOString().replace(/[-:.Z]/g, '').replace('T', '-')}-${W}`, to: 'supervisor', kind: 'info', text: 'never mind', re: h5 }, 0, `${W}.jsonl`);
    assert.ok(JSON.parse(F.sup(['messages', '--json'])).some((m) => m.id === mid), 'the hand-written line is read');
    assert.equal(JSON.parse(F.sup(['messages', '--open', '--json'])).some((m) => m.id === h5), true, `the handoff ${h5} is still open`);
  });
  await t.test("S5g: the supervisor's re closes the handoff", () => {
    assert.ok(h5, 'S5e made a handoff');
    F.sup(['send', W, 'Two tiers: decided', '--kind', 'answer', '--re', h5]);
    assert.equal(JSON.parse(F.sup(['messages', '--open', '--json'])).some((m) => m.id === h5), false, `the handoff ${h5} is closed`);
  });
  await t.test('S5f: wait does not return on an owner turn routed to a session', async () => {
    fs.writeFileSync(path.join(F.old, 'docs/devteam/run/wait-since'), `${Date.now()}\n`);
    await new Promise((r) => setTimeout(r, 50));
    const w = spawn(process.execPath, [path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), 'wait', '--minutes', '1'], { cwd: F.old, env: F.env(SUP), stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '';
    let gone = false;
    w.stdout.on('data', (b) => { o += b; });
    w.on('close', () => { gone = true; });
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(gone, false, `wait returned before anything happened: ${o.slice(0, 300)}`);
    const U = F.say(tw.T, 'quick one for the worker');
    const woke = gone || await Promise.race([new Promise((res) => w.on('close', () => res(true))), new Promise((res) => setTimeout(() => res(false), 30000))]);
    w.kill();
    assert.equal(woke && o.includes(U), false, `wait stayed asleep on ${U}: ${o.slice(0, 200)}`);
  });

  // ---- done-when 6: session-overdue and thread-turn-unbound
  // Y's ticket thread is S6h's; this one binds to Y through a preview it offered
  const overdue = (w) => F.findings('session-overdue').filter((x) => x.subject === w);
  F.preview('slow-heron', Y);
  const ty = F.newThread(JSON.stringify({ kind: 'preview', name: 'slow-heron' }), 'y, the slow one');
  await t.test('S6a2: an owner turn routed to Y and owed 4 min raises no session-overdue', () => {
    F.hand('owner', { type: 'turn', thread: ty.T, text: 'four minutes ago', routed_to: 'session', routed_session: Y }, 4 * MIN);
    assert.deepEqual(overdue(Y), []);
  });
  let u6 = null;
  await t.test('S6a: session-overdue (high), one per session, subject Y, naming the turn owed past 5 min', () => {
    u6 = F.hand('owner', { type: 'turn', thread: ty.T, text: 'still there?', routed_to: 'session', routed_session: Y }, 6 * MIN);
    const f = overdue(Y);
    assert.ok(f.length === 1 && f[0].severity === 'high' && JSON.stringify(f[0]).includes(u6), JSON.stringify(f));
  });
  await t.test('S6k: a merged session with a turn routed to it owed 6 min: the finding still names the turn (liveness not required)', () => {
    const tm = JSON.parse(F.sup(['thread', 'list', '--json'])).find((x) => x.subject?.ref === `ticket:${M}`);
    const u = F.hand('owner', { type: 'turn', thread: tm.id, text: 'did it land?', routed_to: 'session', routed_session: M }, 6 * MIN);
    assert.ok(overdue(M).some((x) => JSON.stringify(x).includes(u)), JSON.stringify(overdue(M)));
  });
  let tpend = null;
  let pend6 = null;
  await t.test("S6b: the planner's pending turn, the last in its thread, with nothing after it for 10 min", () => {
    F.preview('calm-finch', P);
    tpend = F.hand('owner', { type: 'thread', title: 'pricing page', subject: { kind: 'preview', name: 'calm-finch' } }, 13 * MIN);
    // its owner turn answered by the planner's own pending reply, so only the pending rule can fire
    F.hand('owner', { type: 'turn', thread: tpend, text: 'the pricing page?', routed_to: 'session', routed_session: P }, 12 * MIN);
    const pend = pend6 = F.hand(P, { type: 'turn', thread: tpend, text: 'on it', pending: true }, 11 * MIN, `${P}-${month()}.jsonl`);
    const turns = JSON.parse(F.sup(['thread', 'show', tpend, '--json'])).turns;
    assert.equal(turns[turns.length - 1]?.id, pend, 'the pending turn is the last in its thread');
    assert.ok(overdue(P).some((x) => JSON.stringify(x).includes(pend)), `session-overdue names the pending turn: ${JSON.stringify(overdue(P))}`);
  });
  await t.test("S2f: while the planner's session-overdue is open, its planner thread goes to the responder", () => {
    const o = F.lineOf(F.say(tp.T, 'and the tiers?'));
    assert.deepEqual([o.routed_to, o.routed_session], ['responder', undefined]);
  });
  await t.test("S6c: while Y's is open, Y's threads go to the responder", () => {
    assert.equal(F.lineOf(F.say(ty.T, 'any news?')).routed_to, 'responder');
  });
  await t.test("S6d: while open, another session's threads still go to it", () => {
    assert.equal(F.lineOf(F.say(tw.T, 'and W?')).routed_session, W);
  });
  await t.test("S6e: the supervisor's reply clears Y's, and Y's next owner turn routes to Y again", () => {
    F.sup(['thread', 'reply', ty.T, 'The worker is busy; it ships today']);
    assert.deepEqual(overdue(Y), []);
    assert.equal(F.lineOf(F.say(ty.T, 'thanks, Y?')).routed_session, Y);
  });
  await t.test("S6f: the planner's own reply clears its finding", () => {
    const r = F.run(F.old, ['thread', 'reply', tpend, 'Two tiers, done', '--re', pend6], PLANNER());
    assert.match(r.out, /^u-/, r.err);
    assert.deepEqual(overdue(P), []);
  });
  await t.test("S6g: resolving the thread clears it", () => {
    const tm = JSON.parse(F.sup(['thread', 'list', '--json'])).find((x) => x.subject?.ref === `ticket:${M}`);
    F.owner(['thread', 'resolve', tm.id], F.OWN);
    assert.deepEqual(overdue(M), []);
  });
  await t.test('S6i: thread-turn-unbound (medium) flags a hand-written session turn in an unbound thread', () => {
    assert.deepEqual(F.findings('thread-turn-unbound'), [], 'none before');
    const u = F.hand(W, { type: 'turn', thread: tg.T, text: 'hand-written' }, MIN, `${W}.jsonl`);
    const f = F.findings('thread-turn-unbound');
    assert.ok(f.length === 1 && f[0].severity === 'medium' && JSON.stringify(f[0]).includes(u), JSON.stringify(f));
  });
});

// ---- done-when 7: the card, in Chrome
test("S7b: in Chrome the card labels a session's turn with its writer", { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 }, async (t) => {
  const later = cleanup(t);
  const F = threadsFixture('session-card');
  later(() => F.done());
  F.sup(['feature', 'add', 'olap', '--json', JSON.stringify({ title: 'Overlap', goals: [F.goal], stories: [{ id: 'OL-S1', text: 'a story', release: 'v1.0.0' }] })]);
  F.sup(['ticket', 'add', W, '--json', JSON.stringify({ title: W, feature: 'olap', component: 'web', kind: 'build', size: 'S', risk: 'normal', serves: ['OL-S1'], depends_on: [], touches: ['src/**'], done_when: ['its test passes in CI'] })]);
  const T = F.owner(['thread', 'new', '--title', 'Button', '--subject', item(`ticket:${W}`), '--', 'Move the button']).split('\n')[0];
  const T2 = F.owner(['thread', 'new', '--title', 'Plan', '--subject', item(`planner:${FEAT}`), '--', 'Two tiers?']).split('\n')[0];
  F.hand(W, { type: 'turn', thread: T, text: 'Moved it' }, 0, `${W}.jsonl`);
  F.hand(P, { type: 'turn', thread: T2, text: 'Two tiers it is' }, 0, `${P}-${month()}.jsonl`);
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  const label = async (id) => {
    await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#talk/${id}` });
    for (let i = 0; i < 300; i++) {
      const s = await p.ev(`[...document.querySelectorAll('#tl-c-turns .tl-turn .meta')].map((e) => e.textContent).join('|')`).catch(() => '');
      if (s && s.split('|').length >= 2) return s;
      await new Promise((r) => setTimeout(r, 100));
    }
    return '';
  };
  assert.match(await label(T), new RegExp(`\\|The agent on ${W} · `), "the worker's turn names its session in plain words");
  assert.match(await label(T2), new RegExp(`\\|The planner for ${FEAT} · `), "the planner's turn names it");
});

test("S7c: in Chrome a turn sent from the card into a live session's thread names that session, typed or held, never the supervisor", { skip: canDrive && !NO_TMUX ? false : 'needs Chrome, a Node with WebSocket, and tmux', timeout: 240000 }, async (t) => {
  const later = cleanup(t);
  const F = fixture('session-card-send');
  later(() => F.done());
  F.ticket(W);
  F.phase(W, 'build');
  // a second window keeps the fleet's session up when W's is replaced by an asking one
  F.pane('spare');
  F.pane(W);
  const { T } = F.newThread(item(`ticket:${W}`), 'first words');
  const { dash, port } = await dashboardOnFreePort(F.old, F.env(F.OWN));
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#talk/${T}` });
  for (let i = 0; i < 300 && !(await p.ev(`!document.getElementById('tl-card').hidden && TL.open === '${T}'`).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
  const seen = [];
  // send from the card, then read the line under the turns until it says want: every line it showed is kept
  const send = async (words, want) => {
    await p.ev(`(() => { const ta = document.getElementById('tl-c-text'); ta.value = ${JSON.stringify(words)}; ta.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-tl-send]').click(); return true; })()`);
    let last = '';
    for (let i = 0; i < 200; i++) {
      last = await p.ev(`document.getElementById('tl-c-state')?.textContent ?? ''`).catch(() => '');
      if (last) seen.push(last);
      if (want.test(last) && (await p.ev(`TL.threads.find((x) => x.id === '${T}')?.turns.some((u) => u.text === ${JSON.stringify(words)} && /^u-/.test(u.id))`).catch(() => false))) return last;
      await new Promise((r) => setTimeout(r, 100));
    }
    return last;
  };
  assert.match(await send('Move the button', /\S/), new RegExp(`^Sent to the agent on ${W}\\.$`), 'typed into its pane');
  F.kill(W);
  F.asking(W);
  assert.match(await send('and the colour', /^Held/), new RegExp(`^Held: the agent on ${W}'s terminal is asking something`), 'held');
  assert.ok(!seen.some((x) => /Not delivered|supervisor/.test(x)), `the card never named the supervisor or "Not delivered": ${[...new Set(seen)].join(' | ')}`);
});

test("S7d: the card's line for a turn routed to a session: typed, held, not typed, a reload, and 10 minutes on; never the supervisor's words", () => {
  const html = fs.readFileSync(new URL('../docs/devteam/dashboard/index.html', import.meta.url), 'utf8');
  const src = html.slice(html.indexOf('/* threads-core start */'), html.indexOf('/* threads-core end */'));
  const c = vm.createContext({ TextEncoder, URL });
  vm.runInContext(`${src}\n;globalThis.api = { tCardState };`, c);
  const card = c.api.tCardState;
  const turn = (minAgo, more = {}) => ({ turns: [{ by: 'owner', at: new Date(Date.now() - minAgo * MIN).toISOString(), text: 'hi', ...more }] });
  const landed = (minAgo) => turn(minAgo, { id: 'u-20261124-000000000-owner', routed_to: 'session', routed_session: W });
  const pend = turn(0, { id: undefined });
  const who = `the agent on ${W}`;
  const got = [
    card(pend, Date.now(), { session: 'typed', who }, true, null),
    card(pend, Date.now(), { session: 'held', who }, true, null),
    card(pend, Date.now(), { session: 'missed', who }, true, null),
    card(landed(0), Date.now(), undefined, true, { checked: null, undelivered: ['u-20261124-000000000-owner'] }),
    card(landed(11), Date.now(), { session: 'typed', who }, true, null),
    card(turn(0, { id: 'u-20261124-000000001-owner', routed_to: 'session', routed_session: P }), Date.now(), undefined, false, null),
  ];
  assert.deepEqual(got, [
    `Sent to ${who}.`,
    `Held: ${who}'s terminal is asking something, and these words must not answer it. They reach it once it is answered.`,
    `Still with ${who}: its terminal didn't take it, and the supervisor is told if there's no reply in 5 minutes.`,
    `Sent to ${who}; it replies here.`,
    `The agent on ${W} hasn't replied yet; the supervisor has been told.`,
    `Sent to the planner for ${FEAT}; it replies here.`,
  ]);
});

// ---- done-when 8: the docs, clause by clause, each in its own section
const kitDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'docs', 'devteam');
const section = (f, head) => {
  const d = fs.readFileSync(path.join(kitDir, f), 'utf8');
  const i = d.search(new RegExp(`^#{2,3} [^\\n]*${head}`, 'm'));
  if (i < 0) return '';
  const body = d.slice(i);
  const level = /^#+/.exec(body)[0].length;
  const nl = body.indexOf('\n') + 1;
  const j = body.slice(nl).search(new RegExp(`^#{1,${level}} `, 'm'));
  return j < 0 ? body : body.slice(0, nl + j);
};
for (const f of ['process/worker.md', 'process/planning.md']) {
  test(`S8a ${f}: a "Threads bound to you" section: reply first with thread reply`, () => assert.match(section(f, 'Threads bound to you'), /reply first[^\n]*thread reply/i));
  test(`S8b ${f}: plain words, no commands, flags or ids except as --refs (R2)`, () => assert.match(section(f, 'Threads bound to you'), /plain words[^\n]*no commands, flags or ids[^\n]*--refs/i));
  test(`S8c ${f}: stay within your ticket or plan; the owner's instruction binds only through the supervisor`, () => { const x = section(f, 'Threads bound to you'); assert.match(x, /within your (ticket|plan)/i); assert.match(x, /only through the supervisor/i); });
  test(`S8d ${f}: hand over the rest with send supervisor --kind handoff --thread`, () => assert.match(section(f, 'Threads bound to you'), /send supervisor "[^"]*" --kind handoff --thread/));
}
test("S8e supervisor.md §13: a bound thread is the responder's when its session isn't live, has session-overdue open, or session_threads is off", () => {
  const x = section('process/supervisor.md', '13\\. The responder');
  assert.match(x, /isn't live[^\n]*session-overdue[^\n]*session_threads/);
});
test('S8f supervisor.md "Threads on a preview": a live session gets the turn directly; the supervisor gets its hand-offs and session-overdue; a handoff is the session\'s account, not the owner\'s words', () => {
  const d = fs.readFileSync(path.join(kitDir, 'process/supervisor.md'), 'utf8');
  const p = (/\*\*Threads on a preview\.\*\*[^\n]*/.exec(d) ?? [''])[0];
  assert.match(p, /gets the turn directly/);
  assert.match(p, /hand-offs[^\n]*session-overdue/);
  assert.match(p, /not the owner's words/);
});
