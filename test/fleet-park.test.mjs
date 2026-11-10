// Moving the fleet: park, and a clone elsewhere picking the work up.
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
import { kit, sessionOf, line, hasTmux, write, json, fleetFixture, until } from './lib/kit.mjs';

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
    const dash = json(ok(old, ['dashboard-data']));
    assert.equal(dash.planners.find((p) => p.feature === 'beta').parked, true);
    // the sidebar's pill: the kit's release, as hello reports it to the hub
    assert.ok(dash.kit, 'the dashboard says which kit it runs');
    assert.equal(dash.kit, json(ok(old, ['hello', '--json'])).kit);
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

test('fleet status: a superseded ticket with no window is not a session to park', () => {
  const F = fleetFixture('sup');
  const { old, ok, g } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const t = { title: 'tidy up', feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['tidy/**'], done_when: ['the tidy check passes'], notes: 'turns on tidy' };
  const ID = 'ch-95-gone';
  try {
    ok(old, ['ticket', 'add', ID, '--json', JSON.stringify(t)], SUP);
    ok(old, ['ticket', 'add', 'ch-96-next', '--json', JSON.stringify(t)], SUP);
    const ww = path.join(old, '.worktrees', ID);
    g(['worktree', 'add', '-q', '-b', `ticket/${ID}`, ww, 'origin/main'], old);
    ok(ww, ['phase', 'spec'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: ID });
    g(['worktree', 'remove', '--force', ww], old);
    assert.match(ok(old, ['fleet', 'status', '--no-fetch'], SUP), new RegExp(`${ID}: not parked`), 'an active ticket still counts');
    ok(old, ['ticket', 'set', ID, '--json', JSON.stringify({ superseded_by: 'ch-96-next' })], SUP);
    assert.doesNotMatch(ok(old, ['fleet', 'status', '--no-fetch'], SUP), new RegExp(`${ID}: not parked`), 'superseded, and no window: nothing to park');
  } finally { F.done(); }
});

test('a mistyped feature: refused at ticket add, and a superseded ticket with one no longer fails validate', () => {
  const F = fleetFixture('typo');
  const { old, run, ok } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const t = { title: 'tidy up', feature: 'nope', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['tidy/**'], done_when: ['the tidy check passes'], notes: 'turns on tidy' };
  try {
    assert.match(run(old, ['ticket', 'add', 'ch-98-typo', '--json', JSON.stringify(t)], SUP).err, /no feature "nope"/);
    ok(old, ['ticket', 'add', 'ch-97-good', '--json', JSON.stringify({ ...t, feature: 'chores' })], SUP);
    // one that got in before the check: a line the kit wrote earlier
    const log = path.join(old, 'docs/devteam/run/log', `supervisor-${new Date().toISOString().slice(0, 7)}.jsonl`);
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.appendFileSync(log, `${JSON.stringify({ v: 1, id: 'ch-99-typo', type: 'ticket', op: 'new', at: new Date().toISOString(), by: 'supervisor', ...t })}\n`);
    const v = () => { const r = run(old, ['validate'], SUP); return `${r.out ?? ''}${r.err ?? ''}`; };
    assert.match(v(), /feature "nope" is not in the log/);
    ok(old, ['ticket', 'set', 'ch-99-typo', '--json', JSON.stringify({ superseded_by: 'ch-97-good' })], SUP);
    assert.doesNotMatch(v(), /feature "nope" is not in the log/);
    // a stub feature whose only ticket is superseded needs no reviews of its own
    ok(old, ['feature', 'add', 'nope', '--json', JSON.stringify({ title: 'a stub', goals: [], preconditions: [], stories: [], design: 'project/designs/nope.md' })], SUP);
    assert.doesNotMatch(v(), /feature nope/);
  } finally { F.done(); }
});

test('a preview is gone with the worktree, stopped but kept on park, listed in the handoff, named in the resumed prompt', { skip: !hasTmux && 'no tmux' }, () => {
  const F = fleetFixture('previews');
  const { old, run, ok, g, env } = F;
  const ID = 'ch-01-tidy';
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const WRK = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: ID };
  const SERVER = 'node -e "require(\'http\').createServer((q,s)=>s.end(\'ok\')).listen(process.env.PORT)"';
  const dir = path.join(old, 'docs/devteam/run/previews');
  const rec = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
  const has = (name) => fs.existsSync(path.join(dir, `${name}.json`));
  const windows = () => (spawnSync('tmux', ['list-windows', '-a', '-F', '#{window_id} #{window_name}'], { env: env(), encoding: 'utf8' }).stdout ?? '').split('\n').filter(Boolean).map((l) => l.split(' ')[1]);
  const up = (name) => { const r = spawnSync('tmux', ['list-windows', '-a', '-F', '#{window_name}'], { env: env(), encoding: 'utf8' }); return (r.stdout ?? '').split('\n').includes(`dev~${name}`); };
  const prompt = () => fs.readFileSync(path.join(old, 'docs/devteam/run/prompts', `${ID}.txt`), 'utf8');
  try {
    ok(old, ['ticket', 'add', ID, '--json', JSON.stringify({ title: 'tidy up', feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['tidy/**'], done_when: ['the tidy check passes in CI'] })], SUP);
    const ww = path.join(old, '.worktrees', ID);
    g(['worktree', 'add', '-q', '-b', `ticket/${ID}`, ww, 'origin/main'], old);
    ok(ww, ['phase', 'build', '--task', 'T1'], WRK);
    const mine = /preview (\S+) /.exec(ok(ww, ['preview', '--run', SERVER], WRK))[1];
    const theirs = /preview (\S+) /.exec(ok(old, ['preview', '--run', SERVER], SUP))[1];
    const session = rec(mine).session;
    assert.equal(session, ID, 'the worker\'s preview names the worker');
    assert.ok(up(mine) && up(theirs));
    // a record of a server the agent runs itself, by this worker, listed too
    const agentRun = /preview (\S+) /.exec(ok(ww, ['preview', '65030', '--label', 'mine'], WRK))[1];

    // handoff lists them, before anything is stopped
    const said = ok(ww, ['handoff'], WRK, 'where I got to\n');
    assert.match(said, /handoff committed/);
    const msg = g(['log', '-1', '--format=%B'], ww);
    assert.match(msg, /## Previews running/);
    assert.ok(msg.includes(`"name": "${mine}"`) && !msg.includes(`"name": "${theirs}"`), 'only this session\'s');
    assert.match(msg, /"up": true/, 'as preview list --json says it, whether each answers');
    assert.ok(up(mine), 'handoff stops nothing');

    // parked: this worker's kit-started window stops, the records stay, another writer's is left
    ok(ww, ['phase', 'parked', '--note', 'parked'], WRK);
    assert.ok(!up(mine), 'its window stopped');
    assert.ok(up(theirs), 'another session\'s is left alone');
    assert.ok(has(mine) && rec(mine).run && has(agentRun), 'the records stay');

    // a resumed worker's prompt names what is not running
    ok(old, ['worker', ID, '--resume'], SUP);
    assert.ok(prompt().includes(`your preview ${mine} (${SERVER}, port ${rec(mine).port}) is not running; devteam.mjs preview start ${mine} brings it back`), prompt());
    assert.ok(!prompt().includes(`your preview ${agentRun} `), 'only what the kit can start (its record can still be in the handoff)');
    // start brings it back on the same name and port
    const port = rec(mine).port;
    ok(ww, ['preview', 'start', mine], WRK);
    assert.equal(rec(mine).port, port);
    assert.ok(up(mine));
    // with nothing down, the prompt says nothing of it
    ok(old, ['worker', ID, '--resume', '--force'], SUP);
    assert.ok(!prompt().includes('is not running; devteam.mjs preview start'), 'none down, nothing said');

    // the worktree goes: its window and its records go; another writer's stay
    ok(old, ['worker', ID, '--remove', '--force'], SUP);
    assert.ok(!up(mine), 'the window closes with the worktree');
    assert.ok(!has(mine) && !has(agentRun), 'and every record of that writer goes');
    assert.ok(has(theirs) && up(theirs));
    ok(old, ['preview', 'stop', theirs], SUP);
    assert.ok(!windows().some((n) => n?.startsWith('dev~')));
  } finally { F.done(); }
});
