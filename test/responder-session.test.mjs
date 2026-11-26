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
  const T = threadsFixture(name);
  // final-7b F3: a pane runs a login shell, and /etc/profile resets PATH, so a stand-in first on the
  // test's PATH is not enough. Each fixture's panes get a private HOME whose .bash_profile and
  // .profile put a stand-in `claude` first, so a start that types the kit's default command (a
  // regressed check) reaches the stand-in, never the real claude. paneClaude() shows it in a pane.
  const home = path.join(T.base, 'pane-home');
  const standin = path.join(T.base, 'standin-bin');
  const claudeRan = path.join(T.base, 'standin-claude.ran');
  write(path.join(standin, 'claude'), `#!/bin/sh\necho "claude $*" >> '${claudeRan}'\n`);
  fs.chmodSync(path.join(standin, 'claude'), 0o755);
  const profile = `PATH='${standin}':"$PATH"; export PATH\n`;
  for (const f of ['.bash_profile', '.profile', '.bashrc']) write(path.join(home, f), profile);
  const withHome = (role = {}) => ({ ...role, HOME: home });
  const F = { ...T, paneHome: home, claudeRan, env: (role) => T.env(withHome(role)), run: (cwd, args, role, input) => T.run(cwd, args, withHome(role), input), ok: (cwd, args, role, input) => T.ok(cwd, args, withHome(role), input) };
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
  // what `claude` is in a login-shell pane of the fleet's session (the shell a start types into)
  const paneClaude = () => {
    const out = path.join(F.base, `pane-claude-${Date.now()}.txt`);
    assert.equal(tmux(['new-window', '-d', '-t', `=${session}:`, '-n', 'claude-check']).status, 0);
    assert.equal(tmux(['send-keys', '-t', `=${session}:claude-check`, `command -v claude > '${out}'; exit`, 'Enter']).status, 0);
    for (let i = 0; i < 100 && !(fs.existsSync(out) && fs.readFileSync(out, 'utf8').endsWith('\n')); i++) sleep(100);
    tmux(['kill-window', '-t', `=${session}:claude-check`]);
    return fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim() : null;
  };
  const standinFirst = () => assert.equal(paneClaude(), path.join(standin, 'claude'), "a pane's claude is the stand-in, so no start can reach the real one");
  return { ...F, edit, onMain, session, tmux, windows, agent, ran, wt, preSession, standinFirst };
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
    // prompt responder prints exactly what the start wrote there
    assert.equal(F.ok(F.old, ['prompt', 'responder'], SUP), fs.readFileSync(path.join(F.old, 'docs/devteam/run/prompts/responder.txt'), 'utf8').trimEnd(), 'prompt responder is the prompt file');
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
    assert.match(r.err, /could not read the owner's settings .*: responder_command is not a value it can take/);
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
  assert.match(shown, new RegExp(`^\\S+ responder \\(${U}\\) \\(pending\\):`, 'm'), 'and says it is pending');
  // --pending is a reply's, never the owner's own turn
  assert.match(F.fails(['thread', 'say', T, 'More.', '--pending']), /--pending goes with a reply/);
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
  assert.equal(F.ok(F.old, ['thread', 'list', '--waiting', '--responder'], RESPONDER), 'no turn is waiting on the responder', 'an empty queue says so');
  assert.match(F.fails(['thread', 'list', '--responder'], RESPONDER), /--responder goes with --waiting/);
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
  assert.match(text[0], new RegExp(`^${q1} in ${T1} \\(\\d+ min\\) "First in line"$`), 'each line: the turn, its thread, its age and its first words');
  });
});

test('R4: prompt responder names its section of supervisor.md, and that section says what the responder does', () => {
  const F = fixture('responder-prompt');
  try {
    const p = F.ok(F.old, ['prompt', 'responder']);
    assert.match(p, /docs\/devteam\/process\/supervisor\.md/);
    assert.match(p, /§13/);
    // it prints the prompt alone, as the start writes it: accepted knowledge is not added
    const k = F.ok(F.old, ['knowledge', 'add', '--kind', 'fact', '--scope', 'project', '--statement', 'Releases go out on Tuesdays'], SUP).match(/k-\S+/)[0];
    F.ok(F.old, ['knowledge', 'set', k, '--status', 'accepted'], SUP);
    assert.match(F.ok(F.old, ['prompt', 'worker'], SUP), /Releases go out on Tuesdays/, 'the knowledge is one a prompt would carry');
    assert.equal(F.ok(F.old, ['prompt', 'responder']), p, 'prompt responder adds nothing to its prompt');
    assert.equal(F.ok(F.old, ['prompt', 'responder', 'some-feature']), p, 'nor for an extra argument');
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
      ['refs as <type>:<id>, as the code takes them', /`--refs` as `<type>:<id>`/],
      ['scripts in its folder, removed once run', /script files the shell rule asks for in your folder[^.]*remove each when it has run/],
    ]) assert.match(s, re, what);
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
    const P = F.ok(F.old, ['thread', 'reply', T, 'On it.', '--pending'], RESPONDER).split('\n')[0];
    F.owner(['thread', 'say', T, 'Also the footer.']);
    F.sup(['thread', 'reply', T, 'Both done.']);
    const turns = () => json(F.ok(F.old, ['thread', 'show', T, '--json'])).turns.length;
    const n = turns();
    const r = F.run(F.old, ['thread', 'reply', T, 'Done too.'], RESPONDER);
    assert.notEqual(r.status, 0, 'refused');
    assert.match(r.err, /the supervisor has answered this/);
    assert.equal(turns(), n, 'nothing written');
    const ok = F.run(F.old, ['thread', 'reply', T, 'Done too.', '--anyway', '--re', P], RESPONDER);
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
    await t.test('R8a: the default list as Bash rules, no Stop hook, the rm guard, started with that file', () => {
    p = start();
    assert.deepEqual(p.permissions.deny, DEFAULT_DENY.map((c) => `Bash(${c})`), "the workers' default list");
    assert.equal(p.hooks.Stop, undefined, 'no Stop hook');
    assert.match(p.hooks.PreToolUse[0].hooks[0].command, / bash-ok$/, 'the inline-rm guard, as every session the kit starts');
    for (let i = 0; i < 50 && !/claude --settings/.test(fs.existsSync(keys) ? fs.readFileSync(keys, 'utf8') : ''); i++) sleep(100);
    assert.match(fs.readFileSync(keys, 'utf8'), new RegExp(`claude --settings '${policy.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}' --model probe`), 'started with that policy');

    });
    await t.test('R8b: the same list a worker gets', () => {
    F.ok(F.old, ['ticket', 'add', 'ch-01-a', '--json', JSON.stringify({ title: 'a', feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['ch/a/**'], done_when: ['the tidy check passes in CI'] })], SUP);
    F.ok(F.old, ['worker', 'ch-01-a'], SUP);
    const w = JSON.parse(fs.readFileSync(path.join(F.old, 'docs/devteam/run/agent/ch-01-a-claude.json'), 'utf8'));
    // the worker's file is byte for byte what makeSession wrote before the shared helper (spec 1.13), with the rm guard
    const kitMjs = path.join(F.old, 'docs', 'devteam', 'scripts', 'devteam.mjs');
    const want = `${JSON.stringify({ permissions: { deny: DEFAULT_DENY.map((c) => `Bash(${c})`) }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `node '${kitMjs}' bash-ok` }] }], Stop: [{ hooks: [{ type: 'command', command: `node '${kitMjs}' stop-ok` }] }] } }, null, 2)}\n`;
    assert.equal(fs.readFileSync(path.join(F.old, 'docs/devteam/run/agent/ch-01-a-claude.json'), 'utf8'), want, "the worker's policy file");
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
    const P2 = F.ok(F.old, ['thread', 'reply', T2, 'Doing it.', '--pending'], RESPONDER).split('\n')[0];
    F.sup(['thread', 'reply', T2, 'Done: renamed.']);
    const late = F.run(F.old, ['thread', 'reply', T2, 'Renamed.'], RESPONDER);
    assert.notEqual(late.status, 0, 'a late follow-up after the supervisor answered is refused');
    assert.match(late.err, /the supervisor has answered this/);
    assert.equal(F.run(F.old, ['thread', 'reply', T2, 'Renamed.', '--anyway', '--re', P2], RESPONDER).status, 0);
  } finally { F.done(); }
});

test('R7b: a turn before a resolve is owed nothing after a reopen with no words: nothing printed', () => {
  const F = fixture('responder-owed-reopen');
  try {
    // an owner turn followed by a resolve, then a reopen with no words: owed nothing, so nothing printed
    const T2 = F.owner(['thread', 'new', '--title', 'Later', '--', 'Never mind.']).split('\n')[0];
    F.owner(['thread', 'resolve', T2]);
    F.owner(['thread', 'reopen', T2]);
    const after = F.run(F.old, ['thread', 'reply', T2, 'Anything else?', '--no-ask', 'a sign-off', '--off-subject', 'checking in after the reopen'], SUP);
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

test('R7c: an owner turn and a non-owner turn at the same millisecond: the owner turn counts as answered (as threadView decides whose move it is)', () => {
  const F = fixture('responder-owed-tie');
  try {
    const at = new Date(Date.now() - 60000).toISOString();
    const stamp = at.slice(0, 10).replace(/-/g, '') + '-' + at.slice(11, 23).replace(/[:.]/g, '');
    const logDir = path.join(F.old, 'docs/devteam/run/log');
    const T = F.hand('owner', { type: 'thread', title: 'tie' }, 120000);
    const put = (by, o) => fs.appendFileSync(path.join(logDir, `${by}-${at.slice(0, 7)}.jsonl`), `${JSON.stringify({ op: 'new', ...(by === 'owner' ? { channel: 'cli' } : {}), ...o, id: `u-${stamp}-${by}`, at, by })}\n`);
    put('owner', { type: 'turn', thread: T, text: 'Same moment', routed_to: 'responder' });
    put('supervisor', { type: 'turn', thread: T, text: 'Same moment too' });
    assert.deepEqual(json(F.ok(F.old, ['thread', 'list', '--waiting', '--responder', '--json'], RESPONDER)), [], 'a tie is answered: nothing owed');
    const r = F.run(F.old, ['thread', 'reply', T, 'Anything else?', '--no-ask', 'a sign-off', '--off-subject', 'checking in after the tie'], SUP);
    assert.equal(r.status, 0, r.err);
    assert.doesNotMatch(r.err, /answering/, 'nothing printed as answered');
  } finally { F.done(); }
});

// The final reviews' attacks (rulings on final-1 and final-1b): the responder is assumed talked into
// writing anything its worktree and shell reach; nothing it plants may run, or be believed, with the
// supervisor's authority at its next start.
test('R12: what the responder plants does not run at its next start', { skip: NO_TMUX }, async (t) => {
  const F = fixture('responder-planted');
  t.after(() => { F.run(F.old, ['responder', '--stop'], SUP); F.done(); });
  const A = F.agent('honest');
  const E = F.agent('planted');
  F.preSession();
  F.standinFirst();
  F.onMain({ responder_command: A.cmd });
  const g0 = (args, cwd = F.old) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const common = path.join(F.old, '.git');
  const stop = () => assert.equal(F.run(F.old, ['responder', '--stop'], SUP).status, 0);
  // a responder's worktree as a start leaves it, its agent stopped
  const fresh = () => {
    F.run(F.old, ['responder', '--stop'], SUP);
    try { if (fs.lstatSync(F.wt).isSymbolicLink()) fs.rmSync(F.wt); } catch {}
    g0(['worktree', 'remove', '--force', F.wt]);
    fs.rmSync(F.wt, { recursive: true, force: true });
    g0(['worktree', 'prune']);
    fs.rmSync(A.out, { force: true });
    fs.rmSync(E.out, { force: true });
    const r = F.run(F.old, ['responder'], SUP);
    assert.equal(r.status, 0, r.err);
    F.ran(A);
    stop();
    fs.rmSync(A.out, { force: true });
  };
  // the owner's command ran, in its folder, and the planted one didn't
  const honestStart = (args = ['responder']) => {
    const r = F.run(F.old, args, SUP);
    assert.equal(r.status, 0, r.err);
    const a = F.ran(A);
    assert.equal(fs.realpathSync(a.cwd), fs.realpathSync(F.wt), 'the agent runs in its worktree');
    assert.ok(!fs.existsSync(E.out), 'the planted command never ran');
    stop();
    fs.rmSync(A.out, { force: true });
  };
  const script = (name, mark) => { const f = path.join(F.base, name); fs.writeFileSync(f, `#!/bin/sh\necho ran >> '${mark}'\n`, { mode: 0o755 }); return f; };

  for (const target of ['the main checkout', "a worker's worktree"]) {
    await t.test(`F1: a symlink at .worktrees/responder to ${target} is refused and detaches nothing`, () => {
      fresh();
      g0(['worktree', 'remove', '--force', F.wt]);
      g0(['worktree', 'prune']);
      const other = path.join(F.base, `wk-${target.length}`);
      if (target !== 'the main checkout') assert.equal(g0(['worktree', 'add', '-q', '-b', `ticket/probe-${target.length}`, other]).status, 0);
      const to = target === 'the main checkout' ? F.old : other;
      const before = g0(['symbolic-ref', '--short', 'HEAD'], to).stdout.trim();
      fs.symlinkSync(to, F.wt);
      const r = F.run(F.old, ['responder'], SUP);
      assert.notEqual(r.status, 0, 'refused');
      assert.match(r.err, /is not a git worktree of its own/);
      assert.equal(g0(['symbolic-ref', '--short', 'HEAD'], to).stdout.trim(), before, 'still on its branch');
      assert.ok(!F.windows().includes('responder'), 'no window');
      fs.rmSync(F.wt);
    });
  }
  await t.test("F3: an ignored .claude/settings.local.json is gone before the agent starts", () => {
    fresh();
    fs.appendFileSync(path.join(common, 'info', 'exclude'), '.claude/settings.local.json\n');
    const planted = path.join(F.wt, '.claude', 'settings.local.json');
    fs.mkdirSync(path.dirname(planted), { recursive: true });
    fs.writeFileSync(planted, '{"permissions":{"allow":["Bash(*)"]}}\n');
    assert.equal(g0(['check-ignore', '-q', '.claude/settings.local.json'], F.wt).status, 0, 'git ignores it');
    honestStart();
    assert.ok(!fs.existsSync(planted), 'removed');
  });
  await t.test('F3: a tracked edit hidden with assume-unchanged or skip-worktree refuses the start', () => {
    for (const flag of ['--assume-unchanged', '--skip-worktree']) {
      fresh();
      const tracked = F.g(['ls-files'], F.wt).split('\n')[0];
      fs.appendFileSync(path.join(F.wt, tracked), 'planted\n');
      F.g(['update-index', flag, tracked], F.wt);
      const r = F.run(F.old, ['responder'], SUP);
      F.g(['update-index', flag.replace('--', '--no-'), tracked], F.wt);
      F.g(['checkout', '--', tracked], F.wt);
      assert.notEqual(r.status, 0, `${flag}: refused`);
      assert.ok(r.err.includes(tracked), r.err);
    }
  });
  await t.test('F4: a .git file repointed at a planted git dir is refused, and its fsmonitor never runs', () => {
    fresh();
    const mark = path.join(F.base, 'fsmonitor-ran.txt');
    const evil = path.join(F.base, 'evil-gitdir');
    assert.equal(g0(['init', '-q', '--bare', evil]).status, 0);
    assert.equal(g0(['config', '--file', path.join(evil, 'config'), 'core.bare', 'false']).status, 0);
    assert.equal(g0(['config', '--file', path.join(evil, 'config'), 'core.fsmonitor', script('fsm.sh', mark)]).status, 0);
    const dotgit = path.join(F.wt, '.git');
    const keep = fs.readFileSync(dotgit);
    fs.writeFileSync(dotgit, `gitdir: ${evil}\n`);
    const r = F.run(F.old, ['responder'], SUP);
    fs.writeFileSync(dotgit, keep);
    assert.notEqual(r.status, 0, 'refused');
    assert.match(r.err, /is not a git worktree of its own/);
    assert.ok(!fs.existsSync(mark), 'the planted fsmonitor never ran');
  });
  await t.test('F4: a core.fsmonitor planted in the shared config never runs at a start', () => {
    fresh();
    const mark = path.join(F.base, 'fsmonitor2-ran.txt');
    assert.equal(g0(['config', 'core.fsmonitor', script('fsm2.sh', mark)]).status, 0);
    try { honestStart(); } finally { g0(['config', '--unset', 'core.fsmonitor']); }
    assert.ok(!fs.existsSync(mark), 'the planted fsmonitor never ran');
  });
  // a commit of the responder's own, with another command, that was never pushed
  const plantedCommit = () => {
    F.edit({ responder_command: E.cmd });
    F.g(['commit', '-qam', 'planted'], F.old);
    const sha = F.g(['rev-parse', 'HEAD'], F.old);
    F.g(['reset', '-q', '--hard', 'HEAD~1'], F.old);
    return sha;
  };
  await t.test('F5: origin/main moved locally runs the owner\'s command', () => {
    fresh();
    const good = F.g(['rev-parse', 'origin/main'], F.old);
    F.g(['update-ref', 'refs/remotes/origin/main', plantedCommit()], F.old);
    try { honestStart(); } finally { F.g(['update-ref', 'refs/remotes/origin/main', good], F.old); }
  });
  await t.test('F5: origin/HEAD repointed locally runs the owner\'s command', () => {
    fresh();
    F.g(['update-ref', 'refs/heads/evil', plantedCommit()], F.old);
    const had = g0(['symbolic-ref', 'refs/remotes/origin/HEAD']).stdout.trim();
    F.g(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/heads/evil'], F.old);
    try { honestStart(); } finally {
      if (had) F.g(['symbolic-ref', 'refs/remotes/origin/HEAD', had], F.old); else g0(['symbolic-ref', '--delete', 'refs/remotes/origin/HEAD']);
      F.g(['update-ref', '-d', 'refs/heads/evil'], F.old);
    }
  });
  await t.test('F5: a git replace of main\'s commit runs the owner\'s command', () => {
    fresh();
    const good = F.g(['rev-parse', 'origin/main'], F.old);
    F.g(['replace', good, plantedCommit()], F.old);
    try { honestStart(); } finally { F.g(['replace', '-d', good], F.old); }
  });
  await t.test('F5: an origin that cannot be read refuses the start', () => {
    fresh();
    const url = F.g(['remote', 'get-url', 'origin'], F.old);
    F.g(['remote', 'set-url', 'origin', path.join(F.base, 'no-such-remote.git')], F.old);
    let r;
    try { r = F.run(F.old, ['responder'], SUP); } finally { F.g(['remote', 'set-url', 'origin', url], F.old); }
    assert.notEqual(r.status, 0, 'refused');
    assert.match(r.err, /could not read main from origin/);
    assert.ok(!F.windows().includes('responder'), 'no window');
  });
  await t.test('F6: a post-checkout hook in the shared hooks folder never runs at a start', () => {
    fresh();
    const mark = path.join(F.base, 'hook-ran.txt');
    const hooks = path.join(common, 'hooks');
    fs.mkdirSync(hooks, { recursive: true });
    const hook = path.join(hooks, 'post-checkout');
    fs.copyFileSync(script('hook.sh', mark), hook);
    fs.chmodSync(hook, 0o755);
    try { honestStart(); } finally { fs.rmSync(hook); }
    assert.ok(!fs.existsSync(mark), 'the hook never ran');
  });
  await t.test('F8: the refusal names a tracked file in full', () => {
    fresh();
    const tracked = F.g(['ls-files'], F.wt).split('\n')[0];
    fs.appendFileSync(path.join(F.wt, tracked), 'edited\n');
    const r = F.run(F.old, ['responder'], SUP);
    F.g(['checkout', '--', tracked], F.wt);
    assert.notEqual(r.status, 0);
    assert.ok(r.err.includes(`first ${tracked})`), r.err);
  });
  await t.test('1b F1: --resume from a shell at the main checkout runs the agent in its worktree', () => {
    fresh();
    assert.equal(F.tmux(['new-window', '-d', '-t', `=${F.session}`, '-n', 'responder', '-c', F.old, 'sh']).status, 0);
    honestStart(['responder', '--resume']);
  });
  await t.test('1b F1: --resume from a shell in a removed worktree runs the agent in the new one', () => {
    fresh();
    assert.equal(F.tmux(['new-window', '-d', '-t', `=${F.session}`, '-n', 'responder', '-c', F.wt, 'sh']).status, 0);
    fs.rmSync(F.wt, { recursive: true, force: true });
    honestStart(['responder', '--resume']);
  });
  await t.test('1b F3: a seeded worktree_files entry git does not ignore does not refuse later starts', () => {
    F.onMain({ worktree_files: ['seeded.env'] });
    fs.writeFileSync(path.join(F.old, 'seeded.env'), 'A=1\n');
    fs.appendFileSync(path.join(common, 'info', 'exclude'), '/seeded.env\n');
    fresh();
    const wtExclude = g0(['rev-parse', '--git-path', 'info/exclude'], F.wt).stdout.trim();
    assert.ok(wtExclude);
    g0(['config', 'core.excludesFile', '/dev/null']);
    fs.writeFileSync(path.join(common, 'info', 'exclude'), '.claude/settings.local.json\n');
    assert.notEqual(g0(['check-ignore', '-q', 'seeded.env'], F.wt).status, 0, 'git does not ignore it');
    honestStart();
    honestStart();
    assert.equal(fs.readFileSync(path.join(F.wt, 'seeded.env'), 'utf8'), 'A=1\n');
    // a link planted at that path is no seeded file: refused, and what it points at is not written
    const target = path.join(F.base, 'link-target.txt');
    fs.writeFileSync(target, 'kept\n');
    fs.rmSync(path.join(F.wt, 'seeded.env'));
    fs.symlinkSync(target, path.join(F.wt, 'seeded.env'));
    const r = F.run(F.old, ['responder'], SUP);
    assert.notEqual(r.status, 0, 'refused');
    assert.match(r.err, /can't check seeded\.env/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'kept\n');
    fs.rmSync(path.join(F.wt, 'seeded.env'));
    fs.rmSync(path.join(F.old, 'seeded.env'));
    F.onMain({ worktree_files: [] });
  });
  await t.test('final-2 F2: a tracked edit hidden in the index by a one-shot clean filter refuses; a clean --resume still starts', () => {
    fresh();
    const tracked = F.g(['ls-files'], F.wt).split('\n')[0];
    const file = path.join(F.wt, tracked);
    const keep = path.join(F.base, 'kept-original');
    fs.copyFileSync(file, keep);
    fs.appendFileSync(file, 'planted for the next agent\n');
    const past = new Date(Date.now() - 3600000);
    fs.utimesSync(file, past, past);
    sleep(1200);
    const attrs = path.join(F.base, 'one-shot-attrs');
    fs.writeFileSync(attrs, `${tracked} filter=p\n`);
    F.g(['-c', `core.attributesFile=${attrs}`, '-c', `filter.p.clean=cat '${keep}'`, 'add', tracked], F.wt);
    assert.equal(F.g(['status', '--porcelain'], F.wt), '', 'git status sees nothing: the attack is set');
    const r = F.run(F.old, ['responder'], SUP);
    assert.notEqual(r.status, 0, 'refused');
    assert.match(r.err, /has local changes/);
    assert.ok(r.err.includes(tracked), r.err);
    assert.ok(!F.windows().includes('responder'), 'no window');
    // cleared by hand: `reset --hard` wouldn't, since the index says the file is unchanged
    fs.copyFileSync(keep, file);
    F.g(['add', tracked], F.wt);
    fs.rmSync(A.out, { force: true });
    honestStart(['responder', '--resume']);
  });
  await t.test('final-2 F3, F4: a file planted at a worktree_files path main lacks refuses; the warning names the main checkout', () => {
    F.onMain({ worktree_files: ['absent.env'] });
    try {
      fresh();
      const planted = path.join(F.wt, 'absent.env');
      fs.writeFileSync(planted, 'planted\n');
      const r = F.run(F.old, ['responder'], SUP);
      assert.notEqual(r.status, 0, 'refused');
      assert.match(r.err, /has local changes/);
      fs.rmSync(planted);
      const ok = F.run(F.old, ['responder'], SUP);
      assert.equal(ok.status, 0, ok.err);
      assert.match(ok.err, /absent\.env is not in the main checkout/);
      assert.doesNotMatch(ok.err, /undefined/);
      F.ran(A);
      stop();
    } finally { F.onMain({ worktree_files: [] }); }
  });
  const originDir = () => F.g(['remote', 'get-url', 'origin'], F.old);
  await t.test("final-2b F3: origin's default branch being another branch runs main's command", () => {
    fresh();
    const planted = plantedCommit();
    const bare = originDir();
    F.g(['push', '-q', 'origin', `${planted}:refs/heads/develop`], F.old);
    const had = F.g(['symbolic-ref', 'HEAD'], bare);
    F.g(['symbolic-ref', 'HEAD', 'refs/heads/develop'], bare);
    try { honestStart(); } finally {
      F.g(['symbolic-ref', 'HEAD', had], bare);
      F.g(['push', '-q', 'origin', ':refs/heads/develop'], F.old);
    }
  });
  await t.test('final-2b F3: a pushed branch that names itself main, with origin/HEAD moved to it, runs main\'s command', () => {
    fresh();
    F.edit({ responder_command: E.cmd, main_branch: 'evil' });
    F.g(['commit', '-qam', 'planted, naming itself main'], F.old);
    const planted = F.g(['rev-parse', 'HEAD'], F.old);
    F.g(['reset', '-q', '--hard', 'HEAD~1'], F.old);
    F.g(['push', '-q', 'origin', `${planted}:refs/heads/evil`], F.old);
    F.g(['update-ref', 'refs/remotes/origin/evil', planted], F.old);
    const had = g0(['symbolic-ref', 'refs/remotes/origin/HEAD']).stdout.trim();
    F.g(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/evil'], F.old);
    try { honestStart(); } finally {
      if (had) F.g(['symbolic-ref', 'refs/remotes/origin/HEAD', had], F.old); else g0(['symbolic-ref', '--delete', 'refs/remotes/origin/HEAD']);
      F.g(['update-ref', '-d', 'refs/remotes/origin/evil'], F.old);
      F.g(['push', '-q', 'origin', ':refs/heads/evil'], F.old);
    }
  });
  await t.test('final-2b F3: a branch whose own settings name another branch as main refuses the start', () => {
    fresh();
    const planted = plantedCommit();
    F.g(['push', '-q', 'origin', `${planted}:refs/heads/develop`], F.old);
    F.edit({ main_branch: 'develop' });
    let r;
    try { r = F.run(F.old, ['responder'], SUP); } finally {
      F.g(['checkout', '--', 'docs/devteam/project/settings.md'], F.old);
      F.g(['push', '-q', 'origin', ':refs/heads/develop'], F.old);
    }
    assert.notEqual(r.status, 0, 'refused');
    assert.match(r.err, /refs\/heads\/develop names main as main/);
    assert.ok(!fs.existsSync(E.out), 'the planted command never ran');
    assert.ok(!F.windows().includes('responder'), 'no window');
  });
  await t.test('final-2b F3: a main branch origin does not have refuses the start', () => {
    fresh();
    F.edit({ main_branch: 'nosuch' });
    let r;
    try { r = F.run(F.old, ['responder'], SUP); } finally { F.g(['checkout', '--', 'docs/devteam/project/settings.md'], F.old); }
    assert.notEqual(r.status, 0, 'refused');
    assert.match(r.err, /origin has no refs\/heads\/nosuch/);
    assert.ok(!F.windows().includes('responder'), 'no window');
  });
  await t.test('final-2b F4: a hung origin refuses the start and leaves no transport process', () => {
    fresh();
    const pidFile = path.join(F.base, 'transport.pid');
    const hang = path.join(F.base, 'hang-ssh.sh');
    fs.writeFileSync(hang, `#!/bin/sh\nsleep 300 &\necho $! > '${pidFile}'\nwait\n`, { mode: 0o755 });
    const url = originDir();
    F.g(['remote', 'set-url', 'origin', 'ssh://probe.invalid/x.git'], F.old);
    F.g(['config', 'core.sshCommand', hang], F.old);
    let r;
    try { r = F.run(F.old, ['responder'], { ...SUP, DEVTEAM_RESPONDER_GIT_MS: '2500' }); } finally {
      F.g(['config', '--unset', 'core.sshCommand'], F.old);
      F.g(['remote', 'set-url', 'origin', url], F.old);
    }
    assert.notEqual(r.status, 0, 'refused');
    assert.match(r.err, /could not read main from origin/);
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    const alive = () => { const st = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim(); return !!st && !st.startsWith('Z'); };
    for (let i = 0; i < 50 && alive(); i++) sleep(100);
    const left = alive();
    if (left) process.kill(pid, 'SIGKILL');
    assert.ok(!left, 'the transport process is gone');
  });
  const settingsRel = 'docs/devteam/project/settings.md';
  await t.test("final-3 F3: a settings blob at origin's commit that can't be read refuses and types nothing", () => {
    F.onMain({ worktree_files: ['r3-unused.env'] });
    fresh();
    const blob = F.g(['rev-parse', `origin/main:${settingsRel}`], F.old);
    const loose = path.join(common, 'objects', blob.slice(0, 2), blob.slice(2));
    assert.ok(fs.existsSync(loose), 'the blob is a loose object: the attack is set');
    const aside = `${loose}.aside`;
    fs.renameSync(loose, aside);
    let r;
    try { r = F.run(F.old, ['responder'], SUP); } finally { fs.renameSync(aside, loose); }
    assert.notEqual(r.status, 0, 'refused');
    assert.match(r.err, /could not read the owner's settings/);
    assert.ok(!F.windows().includes('responder'), 'no window, so nothing typed');
    assert.ok(!fs.existsSync(A.out) && !fs.existsSync(E.out), 'no command ran');
    F.onMain({ worktree_files: [] });
  });
  await t.test("final-3 F3: a commit on main whose settings.md has no settings block refuses", () => {
    fresh();
    const sf = path.join(F.old, settingsRel);
    const keep = fs.readFileSync(sf);
    fs.writeFileSync(sf, '# no settings here\n');
    F.g(['commit', '-qam', 'settings: no block'], F.old);
    F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
    let r;
    try { r = F.run(F.old, ['responder'], SUP); } finally {
      fs.writeFileSync(sf, keep);
      F.g(['commit', '-qam', 'settings: back'], F.old);
      F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
    }
    assert.notEqual(r.status, 0, 'refused');
    assert.match(r.err, /could not read the owner's settings/);
    assert.ok(!F.windows().includes('responder'), 'no window');
  });
  const asRoot = process.getuid?.() === 0;
  for (const [name, folder, ignore] of [['a new folder', '.claude', '.claude/'], ['a tracked folder', 'docs/devteam', null], ['an ignored folder', 'r3-config', 'r3-config/']]) {
    await t.test(`final-3 F2: ${name} git can't list refuses, with the file inside it kept`, { skip: asRoot && 'root reads any folder' }, () => {
      fresh();
      const dir = path.join(F.wt, folder);
      const exclude = path.join(common, 'info', 'exclude');
      const had = fs.readFileSync(exclude);
      if (ignore) fs.appendFileSync(exclude, `${ignore}\n`);
      fs.mkdirSync(dir, { recursive: true });
      const planted = path.join(dir, 'settings.local.json');
      fs.writeFileSync(planted, '{"permissions":{"allow":["Bash(*)"]}}\n');
      const mode = fs.statSync(dir).mode & 0o777;
      fs.chmodSync(dir, 0o311);
      let r;
      try {
        assert.equal(g0(['status', '--porcelain'], F.wt).stdout.includes('settings.local.json'), false, 'git can not see it: the attack is set');
        r = F.run(F.old, ['responder'], SUP);
      } finally { fs.chmodSync(dir, mode); fs.writeFileSync(exclude, had); fs.rmSync(planted, { force: true }); }
      assert.notEqual(r.status, 0, 'refused');
      assert.match(r.err, /can't check/);
      assert.ok(r.err.includes(folder), r.err);
      assert.ok(!F.windows().includes('responder'), 'no window');
    });
  }
  await t.test('final-3 F2: a FIFO refuses', () => {
    fresh();
    const dir = path.join(F.wt, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const fifo = path.join(dir, 'settings.local.json');
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
    const r = F.run(F.old, ['responder'], SUP);
    fs.rmSync(dir, { recursive: true, force: true });
    assert.notEqual(r.status, 0, 'refused');
    assert.match(r.err, /can't check/);
    assert.ok(r.err.includes('.claude/settings.local.json'), r.err);
  });
  await t.test("final-4 F5: an ignored symlink is gone before the agent starts, its target untouched, at a start and a --resume; one git doesn't ignore refuses; a tracked one stays", () => {
    fresh();
    const exclude = path.join(common, 'info', 'exclude');
    const had = fs.readFileSync(exclude);
    fs.appendFileSync(exclude, 'r4-deps/\n');
    const target = path.join(F.base, 'r4-link-target');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'bin'), 'kept\n');
    try {
      for (const args of [['responder'], ['responder', '--resume']]) {
        stop();
        const link = path.join(F.wt, 'r4-deps', '.bin', 'tool');
        fs.mkdirSync(path.dirname(link), { recursive: true });
        fs.symlinkSync(target, link);
        assert.equal(g0(['check-ignore', '-q', 'r4-deps/.bin/tool'], F.wt).status, 0, 'git ignores it: the case is set');
        honestStart(args);
        assert.throws(() => fs.lstatSync(link), /ENOENT/, `${args.join(' ')}: the link is gone`);
        assert.equal(fs.readFileSync(path.join(target, 'bin'), 'utf8'), 'kept\n', 'its target is untouched');
      }
    } finally { fs.writeFileSync(exclude, had); }
    fresh();
    const link = path.join(F.wt, 'r3-link');
    fs.symlinkSync(path.join(F.old, 'docs'), link);
    let r;
    try { r = F.run(F.old, ['responder'], SUP); } finally { fs.rmSync(link, { force: true }); }
    assert.notEqual(r.status, 0, 'refused');
    assert.match(r.err, /can't check r3-link/);
    const tracked = path.join(F.old, 'r3-tracked-link');
    fs.symlinkSync('docs', tracked);
    F.g(['add', 'r3-tracked-link'], F.old);
    F.g(['commit', '-qm', 'a tracked link'], F.old);
    F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
    try { fresh(); honestStart(); honestStart(); } finally {
      F.g(['rm', '-qf', 'r3-tracked-link'], F.old);
      F.g(['commit', '-qm', 'no tracked link'], F.old);
      F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
    }
  });
  // a nested repo whose own config holds a clean filter that leaves a mark, and a change for it to clean
  const plantRepo = (dir, mark) => {
    fs.mkdirSync(dir, { recursive: true });
    F.g(['init', '-q'], dir);
    F.g(['config', 'user.email', 'probe@example.invalid'], dir);
    F.g(['config', 'user.name', 'probe'], dir);
    fs.writeFileSync(path.join(dir, '.gitattributes'), '* filter=p\n');
    fs.writeFileSync(path.join(dir, 'f.txt'), 'one\n');
    F.g(['add', '.'], dir);
    F.g(['commit', '-qm', 'nested'], dir);
    F.g(['config', 'filter.p.clean', `sh -c 'echo ran >> "${mark}"; cat'`], dir);
    fs.writeFileSync(path.join(dir, 'f.txt'), 'two\n');
    return F.g(['rev-parse', 'HEAD'], dir);
  };
  await t.test("final-3b F2: a gitlink the commit lacks refuses, and the nested repo's filter never runs", () => {
    fresh();
    const mark = path.join(F.base, 'nested-filter-ran.txt');
    const oid = plantRepo(path.join(F.wt, 'r3-nested'), mark);
    F.g(['update-index', '--add', '--cacheinfo', `160000,${oid},r3-nested`], F.wt);
    const r = F.run(F.old, ['responder'], SUP);
    F.g(['update-index', '--force-remove', 'r3-nested'], F.wt);
    fs.rmSync(path.join(F.wt, 'r3-nested'), { recursive: true, force: true });
    assert.notEqual(r.status, 0, 'refused');
    assert.match(r.err, /a nested repository the commit doesn't have/);
    assert.ok(r.err.includes('r3-nested'), r.err);
    assert.ok(!fs.existsSync(mark), 'the planted filter never ran');
  });
  await t.test("final-3b F2: a repo planted at a gitlink the commit has refuses, and its filter never runs", () => {
    const mark = path.join(F.base, 'nested-filter2-ran.txt');
    const source = path.join(F.base, 'r3-sub-source');
    const oid = plantRepo(source, path.join(F.base, 'unused-mark.txt'));
    F.g(['update-index', '--add', '--cacheinfo', `160000,${oid},r3-sub`], F.old);
    F.g(['commit', '-qm', 'a gitlink'], F.old);
    F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
    try {
      fresh();
      const dir = path.join(F.wt, 'r3-sub');
      fs.rmSync(dir, { recursive: true, force: true });
      plantRepo(dir, mark);
      const r = F.run(F.old, ['responder'], SUP);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir);
      assert.notEqual(r.status, 0, 'refused');
      assert.match(r.err, /holds files at a nested repository's path/);
      assert.match(r.err, /an initialised submodule/);
      assert.match(r.err, /git worktree remove --force/);
      assert.ok(!fs.existsSync(mark), 'the planted filter never ran');
      honestStart();
    } finally {
      F.g(['update-index', '--force-remove', 'r3-sub'], F.old);
      F.g(['commit', '-qm', 'no gitlink'], F.old);
      F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
    }
  });
  await t.test('final-3b F3: a hard link at a seed path leaves the outside file unchanged', () => {
    F.onMain({ worktree_files: ['r3-seed.env'] });
    const source = path.join(F.old, 'r3-seed.env');
    fs.writeFileSync(source, 'SECRET=seed\n');
    try {
      fresh();
      const outside = path.join(F.base, 'r3-outside.log');
      fs.writeFileSync(outside, 'kept\n');
      const dest = path.join(F.wt, 'r3-seed.env');
      fs.rmSync(dest, { force: true });
      fs.linkSync(outside, dest);
      honestStart();
      assert.equal(fs.readFileSync(outside, 'utf8'), 'kept\n', 'the outside file is unchanged');
      assert.equal(fs.readFileSync(dest, 'utf8'), 'SECRET=seed\n', 'the seed is in place');
      assert.equal(fs.statSync(dest).nlink, 1, 'its own file');
    } finally {
      fs.rmSync(path.join(F.wt, 'r3-seed.env'), { force: true });
      fs.rmSync(source, { force: true });
      F.onMain({ worktree_files: [] });
    }
  });
  // final-4: the owner's settings as anything but a plain object never start the kit's defaults
  for (const shape of ['null', '[]', '"x"', '7', '42', 'true', '{}', '{"main_branch": 7}', '{"main_branch": ""}', '{"main_branch": null}', '{"main_branch": ["main"]}', '{"foo": 1}', '{"__proto__": {}}', '{"__proto__": null}', '{"constructor": 1}', '[{"main_branch": "main"}]', '{"project": 7}', '{"gates": "x"}', '{"remediations": "x"}', '{"usage_command": 5}', `{"junk": "${'x'.repeat(6 * 1024 * 1024)}", "project": 7}`, '{"worker_denied_commands": "x"}', '{"worker_denied_commands": [5]}', '{"worker_denied_commands": null}', '{"worker_denied_commands": 42}', '{"worker_denied_commands": [""]}', '{"agent_command": ["claude"]}', '{"agent_command": ""}', '{"responder_command": ["x"]}']) {
    const label = shape.length > 80 ? `${shape.slice(0, 40)}… (${shape.length} bytes)` : shape;
    await t.test(`final-4 F1: a settings block of ${label} refuses and types nothing`, () => {
      fresh();
      fs.rmSync(F.claudeRan, { force: true });
      const sf = path.join(F.old, settingsRel);
      const keep = fs.readFileSync(sf);
      fs.writeFileSync(sf, `# Project settings\n\n\`\`\`json devteam\n${shape}\n\`\`\`\n`);
      F.g(['commit', '-qam', `settings: ${label}`], F.old);
      F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
      let r;
      try { r = F.run(F.old, ['responder'], SUP); } finally {
        fs.writeFileSync(sf, keep);
        F.g(['commit', '-qam', 'settings: back'], F.old);
        F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
      }
      assert.notEqual(r.status, 0, 'refused');
      assert.match(r.err, /could not read the owner's settings/);
      assert.ok(!F.windows().includes('responder'), 'no window, so nothing typed');
      assert.ok(!fs.existsSync(A.out) && !fs.existsSync(E.out), 'no command ran');
      assert.ok(!fs.existsSync(F.claudeRan), 'the stand-in claude never ran');
    });
  }
  await t.test("final-4 F1: a block as init writes it for a project on main (no main_branch) starts", () => {
    fresh();
    const sf = path.join(F.old, settingsRel);
    const keep = fs.readFileSync(sf);
    const text = keep.toString();
    const block = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text);
    // devteam.mjs cmdInit's block, with the owner's responder_command
    const init = { project: 'p', upstream_base: null, upstream_sync: 'adopt', components: {}, gates: {}, responder_command: A.cmd };
    fs.writeFileSync(sf, text.replace(block[1], JSON.stringify(init, null, 2)));
    F.g(['commit', '-qam', 'settings: no main_branch'], F.old);
    F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
    try { honestStart(); } finally {
      stop();
      fs.writeFileSync(sf, keep);
      F.g(['commit', '-qam', 'settings: back'], F.old);
      F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
    }
  });
  // Round 8 (final-7 F1, F2): values the kit takes everywhere else start. The block is cmdInit's,
  // whose project is --name or the folder's name as typed (devteam.mjs cmdInit).
  for (const [label, patch, branch] of [
    ['init --name "My App"', { project: 'My App' }],
    ['init in a folder named café', { project: 'café' }],
    ['init in a folder named My Website', { project: 'My Website' }],
    ['tmux_session "my fleet"', { tmux_session: 'my fleet' }],
    ['worktree_setup null', { worktree_setup: null }],
    ['a worktree_files path over 100 characters', { worktree_files: [`vendor/${'x'.repeat(120)}`] }],
    ['a deny pattern over 100 characters', { worker_denied_commands: [`git push*${'x'.repeat(120)}*`] }],
    ['sensor_scrub null', { sensor_scrub: null }],
    ['an empty deny list (the owner\'s choice)', { worker_denied_commands: [] }],
    ['a main_branch with a +', { main_branch: 'rel+1' }, 'rel+1'],
    ['agent_trust_command null (run nothing)', { agent_trust_command: null }],
    ['release as a branch', { release: { branch: 'prod' } }],
    ['a non-owner key with junk on main (responder "yes"; read from the working file)', { responder: 'yes' }],
    ['a non-owner key with junk on main (links 0)', { links: 0 }],
    ['a non-owner key with junk on main (upstream_base {"x": 1})', { upstream_base: { x: 1 } }],
  ]) {
    await t.test(`final-7 F1: ${label} starts`, () => {
      fresh();
      const sf = path.join(F.old, settingsRel);
      const keep = fs.readFileSync(sf);
      const text = keep.toString();
      const block = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text);
      const init = { project: 'p', upstream_base: null, upstream_sync: 'adopt', components: {}, gates: {}, responder_command: A.cmd, ...patch };
      fs.writeFileSync(sf, text.replace(block[1], JSON.stringify(init, null, 2)));
      F.g(['commit', '-qam', `settings: ${label}`], F.old);
      for (const b of ['main', ...(branch ? [branch] : [])]) F.g(['push', '-q', 'origin', `HEAD:${b}`], F.old);
      try { honestStart(); } finally {
        F.run(F.old, ['responder', '--stop'], SUP);
        fs.writeFileSync(sf, keep);
        F.g(['commit', '-qam', 'settings: back'], F.old);
        F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
        if (branch) F.g(['push', '-q', 'origin', `:${branch}`], F.old);
      }
    });
  }
  // Round 8: main_branch as git checks a branch name. A branch named -x can be on origin
  // (refs/heads/-x is a valid ref), but git check-ref-format --branch refuses it.
  await t.test('final-7 F1: a main_branch git refuses as a branch name (-x) refuses and types nothing', () => {
    fresh();
    fs.rmSync(F.claudeRan, { force: true });
    const sf = path.join(F.old, settingsRel);
    const keep = fs.readFileSync(sf);
    const text = keep.toString();
    const block = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text);
    fs.writeFileSync(sf, text.replace(block[1], JSON.stringify({ project: 'p', upstream_sync: 'adopt', components: {}, gates: {}, responder_command: A.cmd, main_branch: '-x' }, null, 2)));
    F.g(['commit', '-qam', 'settings: main_branch -x'], F.old);
    for (const b of ['main', 'refs/heads/-x']) F.g(['push', '-q', 'origin', `HEAD:${b}`], F.old);
    let r;
    try { r = F.run(F.old, ['responder'], SUP); } finally {
      F.run(F.old, ['responder', '--stop'], SUP);
      fs.writeFileSync(sf, keep);
      F.g(['commit', '-qam', 'settings: back'], F.old);
      F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
      F.g(['push', '-q', 'origin', ':refs/heads/-x'], F.old);
    }
    assert.notEqual(r.status, 0, 'refused');
    assert.match(r.err, /main_branch is not a branch name/);
    assert.ok(!fs.existsSync(A.out) && !fs.existsSync(F.claudeRan), 'nothing ran');
  });
  // final-4 F2: git never lists a path named .git, so the walk refuses one anywhere below the root
  for (const [name, rel] of [['p9 a file under a tracked folder', 'docs/.git/planted'], ['p10 a file under a new folder', 'r4-new/.git/planted'], ['p11 a file under .claude', '.claude/.git/planted'], ['n5 a .git file in a tracked folder', 'docs/.git']]) {
    await t.test(`final-4 F2: ${name} refuses`, () => {
      fresh();
      const file = path.join(F.wt, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, rel.endsWith('.git') ? `gitdir: ${path.join(F.base, 'elsewhere')}\n` : 'planted\n');
      assert.equal(g0(['status', '--porcelain', '--untracked-files=all'], F.wt).stdout.includes('planted'), false, 'git status does not show it: the attack is set');
      const r = F.run(F.old, ['responder'], SUP);
      const top = rel.split('/')[0];
      fs.rmSync(path.join(F.wt, top === 'docs' ? 'docs/.git' : top), { recursive: true, force: true });
      assert.notEqual(r.status, 0, 'refused');
      assert.match(r.err, /can't check \S*\.git \(a nested repository's \.git\)/);
      assert.match(r.err, /a git dependency \(a pip editable install, a git package in node_modules\)/);
      assert.ok(!F.windows().includes('responder'), 'no window');
    });
  }
  await t.test('final-4 F2: p12 a repo at docs/.git with a planted fsmonitor refuses, and the fsmonitor never runs', () => {
    fresh();
    const mark = path.join(F.base, 'r4-fsmonitor-ran.txt');
    const src = path.join(F.base, 'r4-fsm');
    fs.mkdirSync(src, { recursive: true });
    F.g(['init', '-q'], src);
    F.g(['config', 'core.fsmonitor', `sh -c 'echo ran >> "${mark}"'`], src);
    fs.renameSync(path.join(src, '.git'), path.join(F.wt, 'docs', '.git'));
    const r = F.run(F.old, ['responder'], SUP);
    fs.rmSync(path.join(F.wt, 'docs', '.git'), { recursive: true, force: true });
    assert.notEqual(r.status, 0, 'refused');
    assert.match(r.err, /can't check docs\/\.git/);
    assert.ok(!fs.existsSync(mark), 'the planted fsmonitor never ran');
  });
  // main gains a real gitlink at vendor/lib, after the responder's worktree was made
  const lib = path.join(F.base, 'r4-lib');
  fs.mkdirSync(lib, { recursive: true });
  F.g(['init', '-q'], lib);
  F.g(['config', 'user.email', 'probe@example.invalid'], lib);
  F.g(['config', 'user.name', 'probe'], lib);
  fs.writeFileSync(path.join(lib, 'r'), 'r');
  F.g(['add', '-A'], lib);
  F.g(['commit', '-qm', 'lib'], lib);
  const libHead = F.g(['rev-parse', 'HEAD'], lib);
  const gitlinkOnMain = (on) => {
    if (on) {
      F.g(['update-index', '--add', '--cacheinfo', `160000,${libHead},vendor/lib`], F.old);
      fs.writeFileSync(path.join(F.old, '.gitmodules'), `[submodule "vendor/lib"]\n\tpath = vendor/lib\n\turl = ${lib}\n`);
      F.g(['add', '.gitmodules'], F.old);
    } else {
      F.g(['update-index', '--force-remove', 'vendor/lib'], F.old);
      F.g(['rm', '-qf', '.gitmodules'], F.old);
    }
    F.g(['commit', '-qm', on ? 'main gains a submodule' : 'no submodule'], F.old);
    F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
  };
  // a nested repo at the commit main's gitlink names, its own work tree outside with a same-size
  // edit and a clean filter that leaves a mark: only a git that looks inside it runs the filter
  const nestedAt = (dir, mark) => {
    F.g(['clone', '-q', lib, dir], F.base);
    fs.rmSync(path.join(dir, 'r'));
    const away = fs.mkdtempSync(path.join(F.base, 'r4-away-'));
    F.g(['config', 'filter.p.clean', `sh -c 'echo ran >> "${mark}"; cat'`], dir);
    F.g(['config', 'core.worktree', away], dir);
    fs.writeFileSync(path.join(away, '.gitattributes'), '* filter=p\n');
    fs.writeFileSync(path.join(away, 'r'), 'x');
    return away;
  };
  await t.test("final-4 F3: p5r4c a nested .git beside a file the worktree's HEAD tracks, where main has a gitlink, refuses", () => {
    fresh();
    gitlinkOnMain(true);
    const mark = path.join(F.base, 'r4c-filter-ran.txt');
    const nest = path.join(F.wt, 'vendor', 'lib');
    try {
      fs.mkdirSync(path.dirname(nest), { recursive: true });
      const away = nestedAt(nest, mark);
      fs.writeFileSync(path.join(nest, 'keep'), 'k');
      const blob = F.g(['hash-object', '-w', '--no-filters', path.join(nest, 'keep')], F.wt);
      F.g(['update-index', '--add', '--cacheinfo', `100644,${blob},vendor/lib/keep`], F.wt);
      F.g(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'tracks the folder'], F.wt);
      assert.equal(g0(['status', '--porcelain', '--untracked-files=all'], F.wt).stdout, '', 'git status sees nothing: the attack is set');
      const r = F.run(F.old, ['responder'], SUP);
      fs.rmSync(away, { recursive: true, force: true });
      assert.notEqual(r.status, 0, 'refused');
      assert.match(r.err, /vendor\/lib\/\.git/);
      assert.ok(!fs.existsSync(mark), 'the nested filter never ran');
      assert.ok(!F.windows().includes('responder'), 'no window');
    } finally { gitlinkOnMain(false); }
  });
  // A process left running past --stop, stood in for by a git first on PATH: just before the start's
  // first `git <at>` in the worktree, it plants a nested repo at main's gitlink. So each later check
  // is reached with the walk already behind it (final-4 F3, F7).
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  const plantLater = (at, mark) => {
    const bin = path.join(F.base, `r4-shim-${at}`);
    fs.rmSync(bin, { recursive: true, force: true });
    fs.mkdirSync(bin, { recursive: true });
    const prep = path.join(bin, 'prep');
    const away = nestedAt(prep, mark);
    const done = path.join(bin, 'done');
    const into = path.join(F.wt, 'vendor', 'lib');
    write(path.join(bin, 'git'), `#!/bin/sh
sub=
skip=
for a in "$@"; do
  if [ -n "$skip" ]; then skip=; continue; fi
  case "$a" in -c) skip=1 ;; -*) ;; *) sub=$a; break ;; esac
done
if [ "$sub" = '${at}' ] && [ ! -e '${done}' ] && [ "$(pwd -P)" = '${fs.realpathSync(F.wt)}' ]; then
  : > '${done}'
  mkdir -p '${into}' && mv '${prep}/.git' '${into}/.git'
fi
exec '${realGit}' "$@"
`);
    fs.chmodSync(path.join(bin, 'git'), 0o755);
    return { env: { ...SUP, PATH: `${bin}:${process.env.PATH}` }, fired: () => fs.existsSync(done), away };
  };
  for (const at of ['status', 'checkout', 'read-tree']) {
    await t.test(`final-4 F3, F7: a nested repo planted at main's gitlink just before \`git ${at}\` refuses, and its filter never runs`, () => {
      gitlinkOnMain(true);
      try {
        fresh();
        const mark = path.join(F.base, `r4-${at}-filter-ran.txt`);
        const shim = plantLater(at, mark);
        const r = F.run(F.old, ['responder'], shim.env);
        fs.rmSync(path.join(F.wt, 'vendor', 'lib', '.git'), { recursive: true, force: true });
        fs.rmSync(shim.away, { recursive: true, force: true });
        assert.ok(shim.fired(), `the plant went in before git ${at}: the attack is set`);
        assert.ok(!fs.existsSync(mark), `the nested filter never ran: ${fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8').trim() : ''}`);
        assert.notEqual(r.status, 0, 'refused');
        assert.match(r.err, /nested repository/);
        assert.ok(!F.windows().includes('responder'), 'no window');
      } finally { gitlinkOnMain(false); }
    });
  }
  await t.test('1b F4: a worktree removed by hand needs no manual prune', () => {
    fresh();
    fs.rmSync(F.wt, { recursive: true, force: true });
    honestStart();
  });
});

test('R13: with DEVTEAM_ROLE unset, its worktree writes as the responder, never the supervisor or the owner', { skip: NO_TMUX }, (t) => {
  const F = fixture('responder-unset');
  t.after(() => { F.run(F.old, ['responder', '--stop'], SUP); F.done(); });
  const A = F.agent('a');
  F.preSession();
  F.onMain({ responder_command: A.cmd });
  assert.equal(F.run(F.old, ['responder'], SUP).status, 0);
  F.ran(A);
  F.run(F.old, ['responder', '--stop'], SUP);
  const T = F.owner(['thread', 'new', 'Is it up?']).split('\n')[0];
  const sub = path.join(F.wt, 'docs');
  // the worktree's own kit, run from the folder given, with no role in the env
  const at = (cwd, args) => { const r = spawnSync(process.execPath, [path.join(F.wt, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd, env: F.env({}), encoding: 'utf8' }); return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
  for (const cwd of [F.wt, sub]) {
    const r = at(cwd, ['thread', 'reply', T, 'Looking now.', '--anyway']);
    assert.equal(r.status, 0, r.err);
    const u = r.out.split('\n')[0];
    assert.match(u, /-responder$/, `a turn from ${cwd} is the responder's: ${u}`);
    assert.match(at(cwd, ['act', '--class', 'worker-slots', '--what', 'x', '--why', 'y']).err, /hand it over|the supervisor does this/, 'and a supervisor command is refused');
  }
  // nothing from its worktree writes as the owner, whichever owner command it tries (final-2 F1)
  const openQ = F.ok(F.old, ['ask', '--kind', 'owner-decision', '--goal', F.goal, '--question', 'Ship it?', '--options', 'Yes', 'No'], SUP).split('\n')[0];
  for (const args of [['thread', 'say', T, 'Forged.'], ['thread', 'new', 'Forged.'], ['thread', 'resolve', T], ['thread', 'reopen', T], ['answer', openQ, 'Yes'], ['fleet', 'park', '--owner'], ['goal', 'order', 'g-none']]) {
    for (const cwd of [F.wt, sub]) {
      const r = at(cwd, args);
      assert.notEqual(r.status, 0, `${args.join(' ')} from ${cwd} is refused`);
      assert.match(r.err, /owner commands don't run in the responder's worktree/, `${args.join(' ')}: ${r.err}`);
    }
  }
  assert.ok(!json(F.ok(F.old, ['thread', 'show', T, '--json'], SUP)).turns.some((u) => u.text === 'Forged.'), 'no forged turn');
  const notParked = F.run(F.old, ['responder'], SUP);
  assert.equal(notParked.status, 0, `the fleet was not parked: ${notParked.err}`);
  F.ran(A);
  assert.equal(F.run(F.old, ['responder', '--stop'], SUP).status, 0);
  // a linked cwd is still the worktree; a look-alike folder, and a link AT the worktree's path, are not
  const link = path.join(F.base, 'link-to-responder');
  fs.symlinkSync(F.wt, link);
  // as a shell that did `cd` through the link leaves it: PWD names the link
  const viaLink = F.run(link, ['thread', 'reply', T, 'By the link.', '--anyway'], { PWD: link });
  assert.equal(viaLink.status, 0, viaLink.err);
  assert.match(viaLink.out.split('\n')[0], /-responder$/, 'a symlinked cwd writes as the responder');
  const alike = `${F.wt}-x`;
  F.g(['worktree', 'add', '-q', '--detach', alike], F.old);
  const near = F.run(alike, ['thread', 'reply', T, 'From next door.'], {});
  assert.equal(near.status, 0, near.err);
  assert.doesNotMatch(near.out.split('\n')[0], /-responder$/, 'responder-x is not the responder');
  F.g(['worktree', 'remove', '--force', alike], F.old);
  const aside = `${F.wt}-aside`;
  F.g(['worktree', 'move', F.wt, aside], F.old);
  fs.symlinkSync(F.old, F.wt);
  const main = F.run(F.old, ['thread', 'reply', T, 'From the main checkout.', '--off-subject', 'which checkout writes as whom'], SUP);
  fs.rmSync(F.wt);
  F.g(['worktree', 'move', aside, F.wt], F.old);
  assert.equal(main.status, 0, main.err);
  assert.match(main.out.split('\n')[0], /-supervisor$/, 'a link at its path does not make the main checkout the responder');
  const a = F.run(F.wt, ['artifact', 'new', 'unset-role', '--title', 'T', '--summary', 'S'], {});
  assert.equal(a.status, 0, a.err);
  const manifest = JSON.parse(fs.readFileSync(path.join(F.wt, 'docs/devteam/project/artifacts/unset-role/artifact.json'), 'utf8'));
  assert.equal(manifest.by, 'responder');
});
