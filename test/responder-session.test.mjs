// The responder's session (kit-103): devteam.mjs responder starts a session that answers the owner's
// thread turns at once, in a window and worktree of its own, with the workers' deny rules and no
// Stop hook; thread reply grows --pending, the owed turns it answers, and the responder's
// "the supervisor has answered this" guard; thread list --waiting --responder is its queue; its
// spend is its own; and responder_command is the owner's alone.
// Run: node --test test/responder-session.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dashboardOnFreePort, hasTmux, json, kit, threadsFixture, write } from './lib/kit.mjs';

const G = 1024 ** 3;
const SUP = { DEVTEAM_ROLE: 'supervisor' };
const RESPONDER = { DEVTEAM_ROLE: 'responder' };
const DEFAULT_DENY = ['gh pr merge*', 'gh api*', 'git push*main*', 'git push*--force*', 'git push*-f *', 'git push*+*'];
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const NO_TMUX = !hasTmux && 'no tmux';

// The fixture, with what every case here needs: settings on main (the owner's apply only from
// there), the fleet's tmux session and its windows, and a stand-in agent that records where and as
// whom it runs.
function fixture(name) {
  const F = threadsFixture(name);
  const sf = path.join(F.old, 'docs/devteam/project/settings.md');
  const edit = (patch) => {
    const text = fs.readFileSync(sf, 'utf8');
    const block = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text);
    fs.writeFileSync(sf, text.replace(block[1], JSON.stringify({ ...JSON.parse(block[1]), ...patch }, null, 2)));
  };
  // as the owner's PR would land it: committed on main and pushed
  const onMain = (patch, branches = ['main']) => {
    edit(patch);
    F.g(['commit', '-qam', `settings: ${Object.keys(patch).join(', ')}`], F.old);
    for (const b of branches) F.g(['push', '-q', 'origin', `HEAD:${b}`], F.old);
  };
  const session = F.ok(F.old, ['settings', '--get', 'tmux_session'], SUP);
  const tmux = (args) => spawnSync('tmux', args, { env: F.env(), encoding: 'utf8' });
  const windows = () => (tmux(['list-windows', '-t', `=${session}`, '-F', '#W']).stdout ?? '').split('\n').filter(Boolean);
  const agent = (tag) => {
    const file = path.join(F.base, `agent-${tag}.mjs`);
    const out = path.join(F.base, `agent-${tag}.json`);
    write(file, "import fs from 'node:fs';\nfs.writeFileSync(process.argv[2], JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(3), role: process.env.DEVTEAM_ROLE ?? null, ticket: process.env.DEVTEAM_TICKET ?? null, feature: process.env.DEVTEAM_FEATURE ?? null }));\nsetInterval(() => {}, 1000);\n");
    return { cmd: `${process.execPath} ${file} ${out}`, out };
  };
  // the stand-in's record, once it is whole (a file seen mid-write is read again)
  const ran = (a) => {
    for (let i = 0; i < 300; i++) {
      try { return JSON.parse(fs.readFileSync(a.out, 'utf8')); } catch {}
      sleep(100);
    }
    assert.fail(`the stand-in agent ${a.out} never ran`);
  };
  const wt = path.join(F.old, '.worktrees', 'responder');
  // the fleet's tmux session up before the kit looks, holding one idle window, so the responder's
  // is a new window in it; env: put in the server's global environment, as a leak from elsewhere
  const preSession = (env = {}) => {
    const idle = path.join(F.base, 'idle.mjs');
    write(idle, 'setInterval(() => {}, 1000);\n');
    assert.equal(tmux(['new-session', '-d', '-s', session, '-n', 'hold', `${process.execPath} ${idle}`]).status, 0);
    for (const [k, v] of Object.entries(env)) assert.equal(tmux(['set-environment', '-g', k, v]).status, 0);
  };
  return { ...F, edit, onMain, session, tmux, windows, agent, ran, wt, preSession };
}

test('R1: responder opens its window and detached worktree, runs responder_command (else agent_command), and makes no slot act or branch', { skip: NO_TMUX }, async (t) => {
  const F = fixture('responder-launch');
  t.after(() => F.done());
  {
    const A = F.agent('a');
    // agent_trust_command (the owner's) runs in the new worktree before the agent, as for a worker
    const trust = path.join(F.base, 'trust.mjs');
    const trusted = path.join(F.base, 'trusted.txt');
    write(trust, "import fs from 'node:fs';\nfs.writeFileSync(process.argv[2], `${process.env.DEVTEAM_WORKTREE}\\n${process.cwd()}\\n`);\n");
    F.onMain({ responder_command: A.cmd, agent_trust_command: `${process.execPath} ${trust} ${trusted}` });
    const branches = F.g(['for-each-ref', '--format=%(refname)', 'refs/heads'], F.old);
    // a DEVTEAM_TICKET and DEVTEAM_FEATURE in the tmux server's environment: the responder's shell unsets them
    F.preSession({ DEVTEAM_TICKET: 'kit-9-leak', DEVTEAM_FEATURE: 'leak' });
    await t.test('R1a: the window, its cwd, env and prompt', () => {
    const r = F.run(F.old, ['responder'], SUP);
    assert.equal(r.status, 0, r.err || r.out);
    assert.ok(F.windows().includes('responder'), `a window named responder in ${F.session}: ${F.windows()}`);
    const a = F.ran(A);
    assert.equal(fs.realpathSync(a.cwd), fs.realpathSync(F.wt), 'it runs in .worktrees/responder');
    assert.deepEqual([a.role, a.ticket, a.feature], ['responder', null, null], 'DEVTEAM_ROLE=responder, no ticket, no feature');
    assert.match(a.argv.join(' '), /run\/prompts\/responder\.txt/, 'its prompt file');
    });
    await t.test('R1d: agent_trust_command ran in the worktree, with DEVTEAM_WORKTREE its real path', () => {
    assert.ok(fs.existsSync(trusted), 'agent_trust_command ran');
    const [wtEnv, cwd] = fs.readFileSync(trusted, 'utf8').split('\n');
    assert.deepEqual([wtEnv, fs.realpathSync(cwd)], [fs.realpathSync(F.wt), fs.realpathSync(F.wt)]);
    });
    await t.test('R1b: detached at main, no branch, no worker-slots act', () => {
    const main = F.g(['rev-parse', 'origin/main'], F.old);
    assert.equal(F.g(['rev-parse', 'HEAD'], F.wt), main, 'the worktree is at main');
    assert.notEqual(spawnSync('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: F.wt }).status, 0, 'detached: on no branch');
    assert.equal(F.g(['for-each-ref', '--format=%(refname)', 'refs/heads'], F.old), branches, 'no branch made');
    assert.equal(json(F.ok(F.old, ['log', '--type', 'act', '--json'])).filter((x) => x.class === 'worker-slots').length, 0, 'no worker-slots act');
    });
    await t.test('R1e: an artifact in .worktrees/responder is no draft (its copy of main ages)', () => {
    const made = F.run(F.wt, ['artifact', 'new', 'probe-art', '--title', 'Probe', '--summary', 'a probe'], SUP);
    assert.equal(made.status, 0, made.err || made.out);
    const v = F.run(F.old, ['artifact', 'versions', 'probe-art', '--json'], SUP);
    assert.doesNotMatch(`${v.out}\n${v.err}`, /"worktree":\s*"responder"/, `no draft from the responder's worktree: ${v.out}`);
    assert.doesNotMatch(F.ok(F.old, ['artifacts', '--json'], SUP), /"responder"/, 'artifacts lists none from it');
    // left clean: a change in the responder's worktree refuses its next start (R2k)
    fs.rmSync(path.join(F.wt, 'docs/devteam/project/artifacts/probe-art'), { recursive: true, force: true });
    });
    await t.test('R1c: agent_command when responder_command is unset; a working-tree edit never runs', () => {

    // responder_command unset: agent_command runs; a working-tree edit of responder_command (not on
    // main) runs nothing, since the owner's settings apply as main has them
    const B = F.agent('b');
    const C = F.agent('c');
    F.onMain({ responder_command: undefined, agent_command: B.cmd });
    F.edit({ responder_command: C.cmd });
    assert.equal(F.run(F.old, ['responder', '--stop'], SUP).status, 0);
    const r2 = F.run(F.old, ['responder'], SUP);
    assert.equal(r2.status, 0, r2.err || r2.out);
    assert.equal(F.ran(B).role, 'responder', 'agent_command ran');
    sleep(1000);
    assert.ok(!fs.existsSync(C.out), "the working tree's responder_command never runs");
    // an empty responder_command is unset too
    fs.rmSync(B.out);
    F.edit({ responder_command: undefined });
    F.onMain({ responder_command: '' });
    assert.equal(F.run(F.old, ['responder', '--stop'], SUP).status, 0);
    assert.equal(F.run(F.old, ['responder'], SUP).status, 0);
    assert.equal(F.ran(B).role, 'responder', 'agent_command ran for an empty responder_command');
    });
  }
});

test('R2: one at a time, --stop and --resume, its refusals, and the fleet holds', { skip: NO_TMUX }, async (t) => {
  const F = fixture('responder-refusals');
  t.after(() => F.done());
  {
    const A = F.agent('a');
    F.onMain({ responder_command: A.cmd });
    await t.test('R2a: a worker, a planner, the responder and the owner are refused', () => {
    for (const [who, env, args, why] of [
      ['a worker', { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'kit-9-probe' }, [], /the supervisor does this/],
      ['a planner', { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'probe' }, [], /the supervisor does this/],
      ['the responder', RESPONDER, [], /the supervisor does this; hand it over/],
      ['the owner', {}, ['--owner'], /the supervisor starts the responder/],
      ['the dashboard', { DEVTEAM_CHANNEL: 'dashboard' }, [], /the supervisor starts the responder/],
      ['the hub', { DEVTEAM_CHANNEL: 'hub' }, [], /the supervisor starts the responder/],
    ]) {
      const r = F.run(F.old, ['responder', ...args], env);
      assert.notEqual(r.status, 0, `${who} is refused`);
      assert.match(r.err, why, who);
      assert.ok(!F.windows().includes('responder'), `${who}: no window`);
    }
    });
    await t.test('R2b: refused while settings.responder is false', () => {
    F.edit({ responder: false });
    assert.match(F.run(F.old, ['responder'], SUP).err, /settings\.responder is off/);
    F.edit({ responder: true });
    });
    await t.test('R2c: a second is refused; --stop kills it; --resume restarts a gone window', () => {

    assert.equal(F.run(F.old, ['responder'], SUP).status, 0);
    F.ran(A);
    const again = F.run(F.old, ['responder'], SUP);
    assert.notEqual(again.status, 0, 'a second one is refused');
    assert.match(again.err, /the responder is already running/);
    assert.match(F.run(F.old, ['responder', '--resume'], SUP).err, /has a live agent/, 'nor typed into a live one');
    assert.equal(F.run(F.old, ['responder', '--stop'], SUP).status, 0);
    assert.ok(!F.windows().includes('responder'), '--stop kills the window');
    fs.rmSync(A.out);
    assert.equal(F.run(F.old, ['responder', '--resume'], SUP).status, 0, '--resume restarts a gone window');
    assert.ok(F.windows().includes('responder'));
    F.ran(A);

    });
    await t.test('R2d: refused at the memory ceiling, except --resume', () => {
    assert.equal(F.run(F.old, ['responder', '--stop'], SUP).status, 0);
    const cg = fs.mkdtempSync(path.join(F.base, 'cgroup-'));
    fs.writeFileSync(path.join(cg, 'memory.max'), `${32 * G}\n`);
    fs.writeFileSync(path.join(cg, 'memory.current'), `${Math.round(27.2 * G + G)}\n`);
    fs.writeFileSync(path.join(cg, 'memory.stat'), `anon ${Math.round(27.2 * G)}\nfile ${G}\n`);
    const M = { ...SUP, DEVTEAM_CGROUP: cg, DEVTEAM_MEMINFO: path.join(F.base, 'none') };
    const full = F.run(F.old, ['responder'], M);
    assert.notEqual(full.status, 0);
    assert.match(full.err, /over its 80% ceiling/);
    assert.ok(!F.windows().includes('responder'));
    assert.equal(F.run(F.old, ['responder', '--resume'], M).status, 0, '--resume starts at the ceiling');

    });
    await t.test('R2e: a drain leaves it running; fleet park stops it until unpark', () => {
    F.ok(F.old, ['fleet', 'drain'], SUP);
    assert.ok(F.windows().includes('responder'), 'a drain leaves it running');
    F.ok(F.old, ['fleet', 'undrain'], SUP);
    F.ok(F.old, ['fleet', 'park'], SUP);
    assert.ok(!F.windows().includes('responder'), 'fleet park stops it');
    assert.match(F.run(F.old, ['responder'], SUP).err, /the fleet is parked/);
    F.ok(F.old, ['fleet', 'unpark'], SUP);
    assert.equal(F.run(F.old, ['responder'], SUP).status, 0);
    });
    await t.test('R2f: a fleet park with every goal already parked stops it too', () => {
    // each goal parked by its own hold (the owner's toggle) leaves the responder running
    for (const g of [F.goal, 'upkeep']) F.ok(F.old, ['goal', 'hold', g, 'park', '--reason', 'quiet week', '--owner'], {});
    assert.ok(F.windows().includes('responder'), "a goal's own hold leaves it");
    F.ok(F.old, ['fleet', 'park'], SUP);
    assert.ok(!F.windows().includes('responder'), 'fleet park stops it though nothing was left to hold');
    for (const g of [F.goal, 'upkeep']) F.ok(F.old, ['goal', 'hold', g, 'run', '--owner'], {});
    });
    await t.test('R2i: a refused fleet park (a worker, a planner, the responder) leaves it running', () => {
    if (!F.windows().includes('responder')) assert.equal(F.run(F.old, ['responder', '--resume'], SUP).status, 0);
    for (const env of [{ DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'kit-9-probe' }, { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'probe' }, RESPONDER]) {
      assert.notEqual(F.run(F.old, ['fleet', 'park'], env).status, 0, `${env.DEVTEAM_ROLE}: fleet park refused`);
      assert.ok(F.windows().includes('responder'), `${env.DEVTEAM_ROLE}: a refused park stops nothing`);
    }
    });
    await t.test("R2h: the owner's fleet park stops it too", () => {
    if (!F.windows().includes('responder')) assert.equal(F.run(F.old, ['responder', '--resume'], SUP).status, 0);
    assert.ok(F.windows().includes('responder'));
    F.ok(F.old, ['fleet', 'park', '--owner'], {});
    assert.ok(!F.windows().includes('responder'), "the owner's park stops it");
    F.ok(F.old, ['fleet', 'unpark', '--owner'], {});
    });
    await t.test('R2j: a .worktrees/responder that is no worktree of its own is refused; the main checkout keeps its branch', () => {
    assert.equal(F.run(F.old, ['responder', '--stop'], SUP).status, 0);
    const branch = F.g(['symbolic-ref', '--short', 'HEAD'], F.old);
    const aside = `${F.wt}-aside`;
    F.g(['worktree', 'move', F.wt, aside], F.old);
    fs.mkdirSync(F.wt);
    const r = F.run(F.old, ['responder'], SUP);
    assert.notEqual(r.status, 0, 'refused');
    assert.match(r.err, /is not a git worktree of its own/);
    assert.ok(r.err.includes(F.wt), 'the refusal names the folder');
    assert.equal(F.g(['symbolic-ref', '--short', 'HEAD'], F.old), branch, 'the main checkout is still on its branch');
    fs.rmdirSync(F.wt);
    F.g(['worktree', 'move', aside, F.wt], F.old);
    });
    await t.test('R2k: local changes in .worktrees/responder, tracked or untracked, refuse the refresh and are kept', () => {
    assert.equal(F.run(F.old, ['responder', '--stop'], SUP).status, 0);
    const planted = path.join(F.wt, 'NOTES-FOR-NEXT-TIME.md');
    fs.writeFileSync(planted, 'planted\n');
    let r = F.run(F.old, ['responder'], SUP);
    assert.notEqual(r.status, 0, 'an untracked file refuses');
    assert.match(r.err, /has local changes/);
    assert.ok(r.err.includes(F.wt), 'the refusal names the folder');
    assert.ok(fs.existsSync(planted), 'nothing removed');
    fs.rmSync(planted);
    const tracked = F.g(['ls-files'], F.wt).split('\n')[0];
    fs.appendFileSync(path.join(F.wt, tracked), 'edited\n');
    r = F.run(F.old, ['responder'], SUP);
    assert.notEqual(r.status, 0, 'a tracked edit refuses');
    assert.match(r.err, /has local changes/);
    F.g(['checkout', '--', tracked], F.wt);
    assert.ok(!F.windows().includes('responder'), 'no window');
    });
    await t.test('R2l: --resume into a window whose pane has exited starts the agent anew', () => {
    fs.rmSync(A.out, { force: true });
    const has = F.tmux(['has-session', '-t', `=${F.session}`]).status === 0;
    assert.equal(F.tmux(has ? ['new-window', '-d', '-t', `=${F.session}`, '-n', 'hold2', 'sleep 600'] : ['new-session', '-d', '-s', F.session, '-n', 'hold2', 'sleep 600']).status, 0);
    assert.equal(F.tmux(['set-option', '-g', 'remain-on-exit', 'on']).status, 0);
    assert.equal(F.tmux(['new-window', '-d', '-t', `=${F.session}`, '-n', 'responder', 'true']).status, 0);
    for (let i = 0; i < 50 && (F.tmux(['display-message', '-p', '-t', `=${F.session}:responder`, '#{pane_dead}']).stdout ?? '').trim() !== '1'; i++) sleep(100);
    F.tmux(['set-option', '-g', 'remain-on-exit', 'off']);
    const r = F.run(F.old, ['responder', '--resume'], SUP);
    assert.equal(r.status, 0, r.err || r.out);
    assert.equal(F.ran(A).role, 'responder', 'the agent runs in a live pane');
    F.tmux(['kill-window', '-t', `=${F.session}:hold2`]);
    assert.equal(F.run(F.old, ['responder', '--stop'], SUP).status, 0);
    });
    await t.test('R2g: --resume into a window left at a shell; --stop wins over --resume; a responder_command that is no string', () => {
    fs.rmSync(A.out, { force: true });
    const has = F.tmux(['has-session', '-t', `=${F.session}`]).status === 0;
    assert.equal(F.tmux(has ? ['new-window', '-d', '-t', `=${F.session}`, '-n', 'responder', 'sh'] : ['new-session', '-d', '-s', F.session, '-n', 'responder', 'sh']).status, 0);
    assert.match(F.run(F.old, ['responder'], SUP).err, /the responder is already running/, 'a window at a shell still needs --resume');
    assert.equal(F.run(F.old, ['responder', '--resume'], SUP).status, 0, '--resume types into the shell');
    F.ran(A);
    assert.equal(F.run(F.old, ['responder', '--stop', '--resume'], SUP).status, 0);
    assert.ok(!F.windows().includes('responder'), '--stop wins');
    F.onMain({ responder_command: 42 });
    const r = F.run(F.old, ['responder'], SUP);
    assert.notEqual(r.status, 0);
    assert.match(r.err, /responder_command is a shell command \(a string\)/);
    assert.ok(!F.windows().includes('responder'));
    });
  }
});

test('R3: the responder replies (--pending) and hands over; thread show, /api/threads and its queue', async (t) => {
  const F = fixture('responder-replies');
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  t.after(async () => { await dash.stop(); F.done(); });
  const T = F.owner(['thread', 'new', '--title', 'Header colour', '--', 'Make the header darker.']).split('\n')[0];
  let U;
  await t.test('R3a: thread reply --pending as the responder: a turn by responder, pending', () => {
  const r = F.run(F.old, ['thread', 'reply', T, 'Looking now.', '--pending'], RESPONDER);
  assert.equal(r.status, 0, r.err || r.out);
  U = r.out.split('\n')[0];
  assert.match(U, /^u-\S+-responder$/, 'a turn by responder');
  assert.equal(json(F.ok(F.old, ['log', '--id', U, '--json']))[0].pending, true, 'pending on its line');
  });
  await t.test('R3b: thread show names responder beside its time', () => {
  const shown = F.ok(F.old, ['thread', 'show', T]);
  assert.match(shown, new RegExp(`^\\S+ responder \\(${U}\\)`, 'm'), `thread show names responder beside its time:\n${shown}`);
  });
  await t.test('R3c: /api/threads shows it as the supervisor\'s, writer responder', async () => {
  const api = await (await fetch(`http://127.0.0.1:${port}/api/threads`)).json();
  const turn = api.threads.find((x) => x.id === T).turns.find((u) => u.id === U);
  assert.deepEqual([turn.by, turn.writer], ['supervisor', 'responder'], "/api/threads: the supervisor's side, written by responder");
  });
  await t.test('R3d: send --kind handoff --thread is accepted from the responder', () => {
  const h = F.run(F.old, ['send', 'supervisor', "Needs a decision (owner's turn)", '--kind', 'handoff', '--thread', T], RESPONDER);
  assert.equal(h.status, 0, h.err);
  assert.match(h.out, /^m-\S+-responder$/m);

  });
  await t.test('R3e: thread list --waiting --responder: owed turns routed to it, oldest first', () => {
  const thread = (title, ago) => F.hand('owner', { type: 'thread', title }, ago);
  const turn2 = (by, th, text, ago, extra = {}) => F.hand(by, { type: 'turn', thread: th, text, ...extra }, ago);
  const T2 = thread('second', 260000);
  const q2 = turn2('owner', T2, 'Second, but written first', 200000, { routed_to: 'responder' });
  const T1 = thread('first', 310000);
  const q1 = turn2('owner', T1, 'First in line', 300000, { routed_to: 'responder' });
  const T3 = thread('answered', 410000);
  turn2('owner', T3, 'Answered by the supervisor', 400000, { routed_to: 'responder' });
  turn2('supervisor', T3, 'Done.', 350000);
  const T4 = thread('supervisor routed', 510000);
  turn2('owner', T4, 'Routed to the supervisor', 500000, { routed_to: 'supervisor' });
  const T5 = thread('resolved', 610000);
  turn2('owner', T5, 'Then resolved', 600000, { routed_to: 'responder' });
  F.hand('owner', { type: 'thread', op: 'set', id: T5, status: 'resolved', outcome: null }, 590000);
  // resolved, then reopened with no words: the old turn is owed nothing still (the spine: a reopen's words make a turn owed)
  const T6 = thread('reopened', 710000);
  turn2('owner', T6, 'Before the resolve', 700000, { routed_to: 'responder' });
  F.hand('owner', { type: 'thread', op: 'set', id: T6, status: 'resolved', outcome: null }, 690000);
  F.hand('owner', { type: 'thread', op: 'set', id: T6, status: 'open' }, 680000);
  const list = json(F.ok(F.old, ['thread', 'list', '--waiting', '--responder', '--json'], RESPONDER));
  assert.deepEqual(list.map((x) => x.turn), [q1, q2], `owed turns routed to the responder, oldest first: ${JSON.stringify(list)}`);
  assert.deepEqual(list.map((x) => x.thread), [T1, T2]);
  const text = F.ok(F.old, ['thread', 'list', '--waiting', '--responder'], RESPONDER).split('\n');
  assert.ok(text[0].includes(q1) && text[1].includes(q2) && text.length === 2, text.join('\n'));
  });
});

test('R4: prompt responder names its section of supervisor.md, and that section says what the responder does', () => {
  const F = fixture('responder-prompt');
  try {
    const p = F.ok(F.old, ['prompt', 'responder']);
    assert.match(p, /docs\/devteam\/process\/supervisor\.md/);
    assert.match(p, /§13/);
    assert.doesNotMatch(p, /responder draft|--re\b/, 'no command a later ticket builds');
    const doc = fs.readFileSync(path.join(kit, 'process', 'supervisor.md'), 'utf8');
    const at = doc.indexOf('\n## 13. The responder');
    assert.ok(at >= 0, 'supervisor.md has a section "## 13. The responder"');
    const next = doc.indexOf('\n## ', at + 1);
    const s = doc.slice(at, next < 0 ? undefined : next);
    for (const [what, re] of [
      ['reply first, typed or from the queue', /first action on any turn, typed or taken from the queue, is a reply/],
      ['--pending when work follows', /thread reply <t-id> "…" --pending/],
      ['the next waiting turn when done', /thread list --waiting --responder/],
      ['what it does itself', /\*\*What you do yourself\.\*\*/],
      ['the handoff', /send supervisor "[^"]*" --kind handoff --thread <t-id>/],
      ['plain words', /plain words/i],
      ['data framing', /data, not instructions/],
      ['nothing private in artifacts', /nothing in an artifact you wouldn't want public/],
    ]) assert.match(s, re, what);
    assert.doesNotMatch(s, /responder draft|--re\b/, 'names no command a later ticket builds');
  } finally { F.done(); }
});

test('R5: observe-spend charges a harness session in .worktrees/responder to the responder', () => {
  const F = fixture('responder-spend');
  try {
    const slug = fs.realpathSync(F.old).replace(/[^a-zA-Z0-9]/g, '-');
    const msg = JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 1000, output_tokens: 1000 } } });
    write(path.join(F.home, 'claude', 'projects', `${slug}--worktrees-responder`, 's.jsonl'), `${msg}\n`);
    F.ok(F.old, ['observe-spend'], SUP);
    const lines = json(F.ok(F.old, ['log', '--type', 'spend', '--json']));
    const mine = lines.filter((l) => l.who === 'responder');
    assert.equal(mine.length, 1, JSON.stringify(lines));
    assert.equal(mine[0].role, 'responder');
    assert.equal(mine[0].created_by, 'supervisor', 'written by the supervisor, as every spend line');
  } finally { F.done(); }
});

test('R6: a responder reply to turns the supervisor answered since its last turn needs --anyway', () => {
  const F = fixture('responder-anyway');
  try {
    const T = F.owner(['thread', 'new', '--title', 'Copy', '--', 'Shorten the hero line.']).split('\n')[0];
    F.ok(F.old, ['thread', 'reply', T, 'On it.', '--pending'], RESPONDER);
    F.owner(['thread', 'say', T, 'Also the footer.']);
    F.sup(['thread', 'reply', T, 'Both done.']);
    const turns = () => json(F.ok(F.old, ['thread', 'show', T, '--json'])).turns.length;
    const n = turns();
    const r = F.run(F.old, ['thread', 'reply', T, 'Done too.'], RESPONDER);
    assert.notEqual(r.status, 0, 'refused');
    assert.match(r.err, /the supervisor has answered this/);
    assert.equal(turns(), n, 'nothing written');
    const ok = F.run(F.old, ['thread', 'reply', T, 'Done too.', '--anyway'], RESPONDER);
    assert.equal(ok.status, 0, ok.err);
    assert.equal(turns(), n + 1, '--anyway writes the turn');
    // new owner words after the supervisor's: the responder answers them with no --anyway
    F.owner(['thread', 'say', T, 'One more thing.']);
    assert.equal(F.run(F.old, ['thread', 'reply', T, 'Noted.'], RESPONDER).status, 0);
    // --anyway is the responder's
    assert.match(F.fails(['thread', 'reply', T, 'x', '--anyway'], SUP), /--anyway is the responder's/);
  } finally { F.done(); }
});

test('R7: thread reply prints the owed owner turns it answers, id and first 60 characters, before it writes', () => {
  const F = fixture('responder-owed');
  try {
    const long = 'Please make the checkout button larger and move it above the fold on mobile too.';
    const T = F.owner(['thread', 'new', '--title', 'Button', '--', long]).split('\n')[0];
    F.owner(['thread', 'say', T, 'And green.']);
    const [x, y] = json(F.ok(F.old, ['thread', 'show', T, '--json'])).turns.map((u) => u.id);
    const r = F.run(F.old, ['thread', 'reply', T, 'Will do.'], SUP);
    assert.equal(r.status, 0, r.err);
    assert.match(r.err, new RegExp(`answering ${x}: "${long.slice(0, 60)}…"`), r.err);
    assert.match(r.err, new RegExp(`answering ${y}: "And green\\."`), r.err);
    assert.match(r.out.split('\n')[0], /^u-\S+-supervisor$/, 'the id is still the first line it prints');
    // nothing owed: nothing printed
    const again = F.run(F.old, ['thread', 'reply', T, 'Done.'], SUP);
    assert.doesNotMatch(again.err, /answering/);
  } finally { F.done(); }
});

test('R8: the responder gets the workers\' deny rules and no Stop hook; responder_command and the rest are the owner\'s', { skip: NO_TMUX }, async (t) => {
  const F = fixture('responder-policy');
  t.after(() => F.done());
  {
    // the fleet's session first, its new windows running a recorder instead of a shell: nothing
    // typed into them runs (no real claude starts)
    const keys = path.join(F.base, 'typed.txt');
    const rec = path.join(F.base, 'recorder.mjs');
    write(rec, "import fs from 'node:fs';\nprocess.stdin.on('data', (d) => fs.appendFileSync(process.argv[2], String(d)));\nsetInterval(() => {}, 1000);\n");
    assert.equal(F.tmux(['new-session', '-d', '-s', F.session, '-n', 'hold', `${process.execPath} ${rec} ${keys}`]).status, 0);
    assert.equal(F.tmux(['set-option', '-t', F.session, 'default-command', `${process.execPath} ${rec} ${keys}`]).status, 0);
    const policy = path.join(F.old, 'docs/devteam/run/agent/responder-claude.json');
    const start = () => { const r = F.run(F.old, ['responder'], SUP); assert.equal(r.status, 0, r.err || r.out); return JSON.parse(fs.readFileSync(policy, 'utf8')); };
    const stop = () => { F.ok(F.old, ['responder', '--stop'], SUP); fs.rmSync(policy, { force: true }); };

    F.onMain({ responder_command: 'claude --model probe', agent_command: 'claude --model worker' });
    let p;
    await t.test('R8a: the default list as Bash rules, no Stop hook, started with that file', () => {
    p = start();
    assert.deepEqual(p.permissions.deny, DEFAULT_DENY.map((c) => `Bash(${c})`), "the workers' default list");
    assert.equal(p.hooks, undefined, 'no Stop hook');
    for (let i = 0; i < 50 && !/claude --settings/.test(fs.existsSync(keys) ? fs.readFileSync(keys, 'utf8') : ''); i++) sleep(100);
    assert.match(fs.readFileSync(keys, 'utf8'), new RegExp(`claude --settings '${policy.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}' --model probe`), 'started with that policy');

    });
    await t.test('R8b: the same list a worker gets', () => {
    F.ok(F.old, ['ticket', 'add', 'ch-01-a', '--json', JSON.stringify({ title: 'a', feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['ch/a/**'], done_when: ['the tidy check passes in CI'] })], SUP);
    F.ok(F.old, ['worker', 'ch-01-a'], SUP);
    const w = JSON.parse(fs.readFileSync(path.join(F.old, 'docs/devteam/run/agent/ch-01-a-claude.json'), 'utf8'));
    // the worker's file is byte for byte what makeSession wrote before the shared helper (spec 1.13)
    const kitMjs = path.join(F.old, 'docs', 'devteam', 'scripts', 'devteam.mjs');
    const want = `${JSON.stringify({ permissions: { deny: DEFAULT_DENY.map((c) => `Bash(${c})`) }, hooks: { Stop: [{ hooks: [{ type: 'command', command: `node '${kitMjs}' stop-ok` }] }] } }, null, 2)}\n`;
    assert.equal(fs.readFileSync(path.join(F.old, 'docs/devteam/run/agent/ch-01-a-claude.json'), 'utf8'), want, "the worker's policy file, unchanged");
    assert.deepEqual(p.permissions.deny, w.permissions.deny, "a worker's list");
    assert.ok(w.hooks?.Stop, 'the worker has its Stop hook; the responder has none');

    });
    await t.test("R8c: the project's own worker_denied_commands", () => {
    stop();
    F.onMain({ worker_denied_commands: ['git push*', 'npm publish*'] });
    p = start();
    assert.deepEqual(p.permissions.deny, ['Bash(git push*)', 'Bash(npm publish*)']);

    });
    await t.test('R8d: main_branch trunk', () => {
    stop();
    F.onMain({ worker_denied_commands: undefined, main_branch: 'trunk' }, ['main', 'trunk']);
    p = start();
    assert.ok(p.permissions.deny.includes('Bash(git push*trunk*)') && p.permissions.deny.includes('Bash(git push*main*)'), JSON.stringify(p.permissions.deny));

    });
    await t.test("R8e: settings set refuses responder_command; settings.responder defaults to true", () => {
    assert.match(F.run(F.old, ['settings', 'set', 'responder_command', 'x'], SUP).err, /responder_command is the owner's own setting/);
    assert.equal(F.ok(F.old, ['settings', '--get', 'responder'], SUP), 'true', 'settings.responder defaults to true');
    });
  }
});

test('R8f: a chore that changes responder_command needs the owner\'s answer; the docs list it among the owner\'s settings', () => {
  const F = fixture('responder-owner-setting');
  try {
    const wt = path.join(F.base, 'chore');
    F.g(['worktree', 'add', '-q', '-b', 'chore-resp', wt, 'origin/main'], F.old);
    const sf = path.join(wt, 'docs/devteam/project/settings.md');
    const text = fs.readFileSync(sf, 'utf8');
    const block = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text);
    fs.writeFileSync(sf, text.replace(block[1], JSON.stringify({ ...JSON.parse(block[1]), responder_command: 'claude --model other' }, null, 2)));
    F.g(['commit', '-qam', 'responder command'], wt);
    F.g(['push', '-q', 'origin', 'chore-resp'], wt);
    const body = path.join(F.base, 'body.md');
    write(body, '## One-way doors\n\nNone.\n');
    const r = F.run(F.old, ['merge', '--chore', 'resp', '--dry-run', '--title', 'chore-resp: responder command', '--body-file', body], SUP);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out + r.err, /changes owner settings: responder_command \(governance-edit\)/);
    const sup = fs.readFileSync(path.join(kit, 'process', 'supervisor.md'), 'utf8');
    const q = fs.readFileSync(path.join(kit, 'governance', 'quality.md'), 'utf8');
    assert.match(sup, /\*\*Owner settings, in any PR\.\*\*[^\n]*`agent_command`, `responder_command`/, 'supervisor.md lists it');
    assert.match(q, /`resume_command`, `responder_command`/, 'quality.md §4 lists it');
  } finally { F.done(); }
});

test('R6b: the responder\'s late follow-up to its own pending turn, after the supervisor answered, needs --anyway', () => {
  const F = fixture('responder-anyway-late');
  try {
    // the other backstop: the responder said it was on it, stalled, and the supervisor answered; its late follow-up needs --anyway too
    const T2 = F.owner(['thread', 'new', '--title', 'Stalled', '--', 'Rename the footer link.']).split('\n')[0];
    F.ok(F.old, ['thread', 'reply', T2, 'Doing it.', '--pending'], RESPONDER);
    F.sup(['thread', 'reply', T2, 'Done: renamed.']);
    const late = F.run(F.old, ['thread', 'reply', T2, 'Renamed.'], RESPONDER);
    assert.notEqual(late.status, 0, 'a late follow-up after the supervisor answered is refused');
    assert.match(late.err, /the supervisor has answered this/);
    assert.equal(F.run(F.old, ['thread', 'reply', T2, 'Renamed.', '--anyway'], RESPONDER).status, 0);
  } finally { F.done(); }
});

test('R7b: a turn before a resolve is owed nothing after a reopen with no words: nothing printed', () => {
  const F = fixture('responder-owed-reopen');
  try {
    // an owner turn followed by a resolve, then a reopen with no words: owed nothing, so nothing printed
    const T2 = F.owner(['thread', 'new', '--title', 'Later', '--', 'Never mind.']).split('\n')[0];
    F.owner(['thread', 'resolve', T2]);
    F.owner(['thread', 'reopen', T2]);
    const after = F.run(F.old, ['thread', 'reply', T2, 'Anything else?'], SUP);
    assert.equal(after.status, 0, after.err);
    assert.doesNotMatch(after.err, /answering/, 'a turn before a resolve is owed nothing after a bare reopen');
  } finally { F.done(); }
});

test('R6c: owner words after the supervisor\'s answer lift the guard: the responder replies with no --anyway', () => {
  const F = fixture('responder-anyway-owner-after');
  try {
    const T = F.owner(['thread', 'new', '--title', 'Logo', '--', 'Swap the logo.']).split('\n')[0];
    F.sup(['thread', 'reply', T, 'Swapped.']);
    F.owner(['thread', 'say', T, 'Thanks, and the favicon?']);
    const r = F.run(F.old, ['thread', 'reply', T, 'Looking at the favicon.'], RESPONDER);
    assert.equal(r.status, 0, `the owner spoke after the supervisor, so the responder may answer: ${r.err}`);
  } finally { F.done(); }
});
