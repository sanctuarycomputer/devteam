// The supervisor: stopped, its own conversation, and its own pane's lost Enter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { findings, fixture, FULL, MENU, ROOM } from './lib/accounts-fixture.mjs';
import { hasTmux, json, until, write } from './lib/kit.mjs';

test('a stopped supervisor: reported, in tmux or not, with or without cswap, and never typed into', { skip: !hasTmux }, async () => {
  const F = fixture('sup');
  try {
    const slug = fs.realpathSync(F.root).replace(/[^a-zA-Z0-9]/g, '-');
    const file = path.join(F.base, 'claude', 'projects', slug, 's.jsonl');
    const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
    const rl = { type: 'assistant', timestamp: ago(2), error: 'rate_limit', isApiErrorMessage: true, message: { content: [{ type: 'text', text: "You've hit your weekly limit" }] } };
    write(file, `${JSON.stringify({ type: 'user', message: { content: 'You are the supervisor for this repository' } })}\n${JSON.stringify(rl)}\n`);
    F.run(['accounts-tick'], { DEVTEAM_CSWAP: 'off' });
    assert.match(F.state().supervisor_limit.text, /weekly limit/);
    const f = findings(F).find((x) => x.kind === 'supervisor-at-limit');
    assert.equal(f?.severity, 'high');
    assert.match(json(F.run(['hello', '--json'], { DEVTEAM_ROLE: '' }).stdout).alert, /supervisor stopped at a usage limit/);
    // it carried on: no longer stopped
    fs.appendFileSync(file, `${JSON.stringify({ type: 'assistant', timestamp: ago(1), message: { content: [{ type: 'text', text: 'carrying on' }] } })}\n`);
    F.tick();
    assert.equal(F.state().supervisor_limit, null);
    // in tmux, with room, but its resume_command isn't Claude Code's: reported, not restarted (recovery.test.mjs has the restart)
    const s = F.agent('sup-pane', MENU, F.root);
    await until(() => s.shows().includes('Esc to cancel'), 'the menu');
    for (const n of ['supervisor-pane', 'supervisor-pane-role']) write(path.join(F.root, 'docs/devteam/run', n), `=${F.session}:sup-pane`);
    fs.appendFileSync(file, `${JSON.stringify(rl)}\n`);
    F.tick();
    F.tick();
    assert.match(F.state().supervisor_limit.text, /weekly limit/);
    assert.equal(s.keys(), '');
    assert.deepEqual(F.relaunched(), []);
    // an old stop is not news; a limit lasts a week at most
    write(file, `${JSON.stringify({ type: 'user', message: { content: 'You are the supervisor for this repository' } })}\n${JSON.stringify({ ...rl, timestamp: ago(24 * 8) })}\n`);
    F.tick();
    assert.equal(F.state().supervisor_limit, null);
    // someone else's session at a limit isn't the supervisor's, even one quoting its commands; one running them is
    write(path.join(path.dirname(file), 'quoted.jsonl'), `${JSON.stringify({ type: 'user', message: { content: 'review this' } })}\n${JSON.stringify({ type: 'assistant', timestamp: ago(3), message: { content: [{ type: 'text', text: 'it runs DEVTEAM_ROLE=supervisor node x' }, { type: 'tool_use', input: { command: "grep -n 'DEVTEAM_ROLE=supervisor node' README.md" } }] } })}\n${JSON.stringify(rl)}\n`);
    const other = path.join(path.dirname(file), 'other.jsonl');
    write(other, `${JSON.stringify({ type: 'user', message: { content: 'what does this do?' } })}\n${JSON.stringify(rl)}\n`);
    write(file, `${JSON.stringify({ type: 'user', message: { content: 'fix the tests' } })}\n`);
    F.tick();
    assert.equal(F.state().supervisor_limit, null);
    write(other, `${JSON.stringify({ type: 'user', message: { content: 'assume the role' } })}\n${JSON.stringify({ type: 'assistant', timestamp: ago(3), message: { content: [{ type: 'tool_use', input: { command: 'DEVTEAM_ROLE=supervisor node x fleet status' } }] } })}\n${JSON.stringify(rl)}\n`);
    F.tick();
    assert.match(F.state().supervisor_limit.text, /weekly limit/);
  } finally { F.done(); }
});

test('supervisor-session: the supervisor\'s own conversation, read from disk, and nothing rather than a guess', () => {
  const F = fixture('sid');
  const id = () => { const r = F.run(['supervisor-session'], { DEVTEAM_ROLE: '' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  // the fixture's resume_command is a stand-in; this command only answers for Claude Code's
  const sf = path.join(F.root, 'docs/devteam/project/settings.md');
  const resumeWith = (cmd) => { fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace(/"resume_command": ".*?"/, `"resume_command": ${JSON.stringify(cmd)}`)); execFileSync('sh', ['-c', `git add -A && git -c user.email=t@t -c user.name=t commit -qm resume`], { cwd: F.root }); }; // owner settings count as committed on main
  try {
    resumeWith('claude --continue --dangerously-skip-permissions');
    assert.equal(id(), '', 'no transcripts yet');
    const dir = path.join(F.base, 'claude', 'projects', fs.realpathSync(F.root).replace(/[^a-zA-Z0-9]/g, '-'));
    const user = (content) => JSON.stringify({ type: 'user', message: { content } });
    const ran = (command) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', input: { command } }] } });
    let at = Date.now() / 1000 - 100;
    const save = (name, text) => { const f = path.join(dir, `${name}.jsonl`); write(f, `${text}\n`); fs.utimesSync(f, at, at); at += 1; };
    save('owner', user('fix the typo'));
    assert.equal(id(), '', "the owner's own conversation isn't the supervisor's");
    save('started', user('You are the supervisor for this repository'));
    assert.equal(id(), 'started\n');
    save('quoting', `${user('what does DEVTEAM_ROLE=supervisor node x do?')}\n${ran('grep "DEVTEAM_ROLE=supervisor node" README.md')}`);
    assert.equal(id(), 'started\n', 'quoting the commands is not running them');
    save('adopted', `${user('be the supervisor')}\n${ran('DEVTEAM_ROLE=supervisor node docs/devteam/scripts/devteam.mjs status')}`);
    assert.equal(id(), 'adopted\n', 'the newest that ran them');
    save('big-head', `${JSON.stringify({ type: 'attachment', attachment: { content: 'x'.repeat(100 * 1024) } })}\n${user('You are the supervisor for this repository')}`);
    assert.equal(id(), 'big-head\n', 'a large attachment line before the prompt still finds it');
    save('setup', `${user('Use github.com/sanctuarycomputer/devteam to set up a fleet in this repo')}\n${ran('cd /x/website; export DEVTEAM_ROLE=supervisor; D="node docs/devteam/scripts/devteam.mjs"; $D status')}`);
    assert.equal(id(), 'setup\n', 'a session that set up its own fleet, exporting the role');
    save('exported', `${user('look around')}\n${ran('export DEVTEAM_ROLE=supervisor; echo hi')}`);
    assert.equal(id(), 'setup\n', 'exporting the role without running the kit is not running it');
    for (const n of ['a', 'b', 'c', 'd', 'e']) save(n, user('something else'));
    assert.equal(id(), '', 'past the newest five');
    save('started', user('You are the supervisor for this repository'));
    resumeWith('codex resume --last');
    assert.equal(id(), '', 'another harness');
  } finally { F.done(); }
});

test("the supervisor's own pane: a lost Enter is pressed, at most three times, never into a prompt, never while it works", { skip: !hasTmux }, async () => {
  const F = fixture('sup-enter');
  try {
    const text = '[devteam answer q-1 from owner] read it with: devteam.mjs questions --id q-1';
    const sent = path.join(F.root, 'docs/devteam/run/sent', `${encodeURIComponent(`${F.session}:sup-enter`)}.json`);
    const deliver = (agoSec) => write(sent, JSON.stringify({ text, at: new Date(Date.now() - agoSec * 1000).toISOString() }));
    const pane = (shown) => {
      spawnSync('tmux', ['kill-window', '-t', `=${F.session}:sup-enter`]);
      const s = F.agent('sup-enter', shown, F.root);
      for (const n of ['supervisor-pane', 'supervisor-pane-role']) write(path.join(F.root, 'docs/devteam/run', n), `=${F.session}:sup-enter`);
      return s;
    };
    // the incident: compacted while idle, an owner's answer typed in and its Enter lost
    const stuck = ['⏺ Compacted while idle', '─'.repeat(60), `❯ ${text}`, '─'.repeat(60), '  ⏵⏵ bypass permissions on (shift+tab to cycle)'];
    let s = pane(stuck);
    await until(() => s.shows().includes('devteam answer'), 'the stuck input');
    deliver(5);
    F.tick();
    assert.equal(s.keys(), '', 'typed seconds ago: a slow submit is not double-pressed');
    deliver(3600);
    F.tick();
    await until(() => s.keys() === '\r', 'one Enter');
    assert.equal(json(fs.readFileSync(sent, 'utf8')).tries, 1, 'kept for another try');
    F.tick();
    assert.equal(s.keys(), '\r', 'a second tick inside 30s presses nothing');
    // that Enter was lost too (the stand-in never takes it): 30s on, another, up to three in all
    const later = () => { const r = json(fs.readFileSync(sent, 'utf8')); write(sent, JSON.stringify({ ...r, at: new Date(Date.now() - 60 * 1000).toISOString() })); };
    later();
    F.tick();
    await until(() => s.keys() === '\r\r', 'a second Enter');
    later();
    F.tick();
    await until(() => s.keys() === '\r\r\r', 'a third Enter');
    assert.ok(!fs.existsSync(sent), 'and then it stops');
    F.tick();
    assert.equal(s.keys(), '\r\r\r', 'never a fourth');
    // a hand-written negative count gives no extra tries
    write(sent, JSON.stringify({ text, at: new Date(Date.now() - 3600 * 1000).toISOString(), tries: -5 }));
    F.tick();
    await until(() => s.keys() === '\r\r\r\r', 'a first try');
    assert.equal(json(fs.readFileSync(sent, 'utf8')).tries, 1, 'counted from zero');
    fs.rmSync(sent, { force: true });
    // a stale read: another process pressed and put the record back (a fresh time) between this
    // one's read and its claim; the claim reads it again and presses nothing
    deliver(3600);
    const slowDone = new Promise((r) => execFile(process.execPath, [path.join(F.root, 'docs/devteam/scripts/devteam.mjs'), 'accounts-tick'], { cwd: F.root, env: F.env({ DEVTEAM_LOST_ENTER_CLAIM_DELAY_MS: '3000' }) }, r));
    await new Promise((r) => setTimeout(r, 2000));
    write(sent, JSON.stringify({ text, at: new Date().toISOString(), tries: 1, typed_at: new Date(Date.now() - 3600 * 1000).toISOString() }));
    await slowDone;
    assert.equal(s.keys(), '\r\r\r\r', 'a record pressed a moment ago is not pressed again');
    assert.equal(json(fs.readFileSync(sent, 'utf8')).tries, 1, 'and it is put back as it was');
    fs.rmSync(sent, { force: true });
    // the echo of a submitted line, then the bottom changes after a press: a reply, or the owner typing
    // their own line (no client in a test, so only the bottom tells): no second or third Enter
    const echo = [`> ${text}`, '⏺ Done.', '─'.repeat(60), '❯ ', '─'.repeat(60), '  ⏵⏵ bypass permissions on (shift+tab to cycle)'];
    for (const after of [[`> ${text}`, '⏺ Done, and more besides.', '─'.repeat(60), '❯ ', '─'.repeat(60), '  ⏵⏵ bypass permissions on (shift+tab to cycle)'], [`> ${text}`, '⏺ Done.', '─'.repeat(60), '❯ and next could you', '─'.repeat(60), '  ⏵⏵ bypass permissions on (shift+tab to cycle)']]) {
      s = pane(echo);
      await until(() => s.shows().includes('Done.'), 'the echo');
      deliver(3600);
      F.tick();
      await until(() => s.keys() === '\r', 'the one Enter a static echo gets');
      s = pane(after);
      await until(() => s.shows().includes(after[3] === '❯ ' ? 'besides' : 'next could'), 'the changed bottom');
      later();
      F.tick();
      if (fs.existsSync(sent)) { later(); F.tick(); }
      assert.equal(s.keys(), '', `no more Enters once the bottom changed: ${after[1]} / ${after[3]}`);
      assert.ok(!fs.existsSync(sent), 'the rescue ends');
    }
    for (const shown of [[`❯ ${text}`, '✻ Thinking… (esc to interrupt)'], [`❯ ${text}`, 'Do you want to proceed?', '❯ 1. Yes', '  2. No'], [...MENU, `❯ ${text}`]]) {
      s = pane(shown);
      await until(() => s.shows().includes('devteam answer'), 'the pane');
      deliver(3600);
      F.tick();
      assert.equal(s.keys(), '', `left alone: ${shown[1]}`);
    }
  } finally { F.done(); }
});

test("the supervisor's own pane: a lost Enter is pressed again while only the harness chrome changes, never into a busy pane", { skip: !hasTmux }, async () => {
  const F = fixture('sup-chrome');
  try {
    const text = '[devteam answer q-1 from owner] read it with: devteam.mjs questions --id q-1';
    const sent = path.join(F.root, 'docs/devteam/run/sent', `${encodeURIComponent(`${F.session}:sup-chrome`)}.json`);
    const deliver = (agoSec) => write(sent, JSON.stringify({ text, at: new Date(Date.now() - agoSec * 1000).toISOString() }));
    const later = () => { const r = json(fs.readFileSync(sent, 'utf8')); write(sent, JSON.stringify({ ...r, at: new Date(Date.now() - 60 * 1000).toISOString() })); };
    let s;
    const pane = (shown) => {
      spawnSync('tmux', ['kill-window', '-t', `=${F.session}:sup-chrome`]);
      s = F.agent('sup-chrome', shown, F.root);
      for (const n of ['supervisor-pane', 'supervisor-pane-role']) write(path.join(F.root, 'docs/devteam/run', n), `=${F.session}:sup-chrome`);
      return s;
    };
    // each redraw is a new stand-in with its own keys: that pane's one Enter, and the record's count
    const step = async (shown, n) => {
      pane(shown);
      await until(() => s.shows().includes('devteam answer'), 'the pane');
      if (n > 1) later();
      F.tick();
      await until(() => s.keys() === '\r', `Enter ${n} of 3`);
      if (n < 3) assert.equal(json(fs.readFileSync(sent, 'utf8')).tries, n, `kept after try ${n}`);
      else assert.ok(!fs.existsSync(sent), 'and then it stops');
    };
    const R = '─'.repeat(60);
    const said = '⏺ The plan names each one as stricter than before.';
    // a Claude Code pane (like the saved incident pane): the footer, the agent list and the status
    // line's shell count change on their own while the text sits in the input; the shell ends at C
    const A = [said, '✻ Cogitated for 20s · done 9:56 PM · 1 shell still running', R, `❯ ${text}`, R, '⏵⏵ bypass permissions on · 1 shell · ↓ to manage', '◯ general-purpose  Re-review Task 2 fixes   20s · ↓ 46.1k tokens'];
    const B = [said, '✻ Cogitated for 20s · done 9:56 PM · 2 shells still running', R, `❯ ${text}`, R, '⏵⏵ bypass permissions on · PR #671 · 2 shells · ↓ to manage', '● main', '◯ general-purpose  Re-review Task 2 fixes   1m 5s · ↓ 52.3k tokens', '◯ Explore  Find the footer  4s · ↓ 1.2k tokens'];
    const C = [said, '✻ Cogitated for 20s · done 9:56 PM', R, `❯ ${text}`, R, '⏵⏵ bypass permissions on · ↓ to manage'];
    deliver(3600);
    await step(A, 1);
    await step(B, 2);
    await step(C, 3);
    F.tick();
    assert.equal(s.keys(), '\r', 'never a fourth');
    // another harness, no input box: its shell and agent lines change, then the shell line goes
    deliver(3600);
    await step(['⏺ Earlier output', `> ${text}`, '1 shell running', '◯ agent  12s · ↓ 3.1k tokens'], 1);
    await step(['⏺ Earlier output', `> ${text}`, '2 shells running', '◯ agent  40s · ↓ 9.8k tokens'], 2);
    await step(['⏺ Earlier output', `> ${text}`, '◯ agent  1m 2s · ↓ 1.2M tokens'], 3);
    // a rule in the output with the text below it: no input box there, so nothing is cut as a footer
    deliver(3600);
    await step(['⏺ Summary', R, `> ${text}`, '1 shell running'], 1);
    // never into a busy pane: busy only in the footer, or a spinner above a long agent list
    const agents = [1, 2, 3, 4, 5, 6, 7].map((n) => `◯ agent${n}  ${n}s · ↓ ${n}.1k tokens`);
    for (const [why, shown] of [['busy in the footer', [...A.slice(0, 5), '⏵⏵ bypass permissions on · 1 shell · esc to interrupt']], ['a spinner above a long agent list', ['⏺ work', '✻ Cogitating… (12s · ↓ 1.2k tokens · esc to interrupt)', R, `❯ ${text}`, R, '⏵⏵ bypass permissions on · 1 shell', ...agents]]]) {
      fs.rmSync(sent, { force: true });
      pane(shown);
      await until(() => s.shows().includes('devteam answer'), 'the busy pane');
      deliver(3600);
      F.tick();
      assert.equal(s.keys(), '', `left alone: ${why}`);
      assert.ok(fs.existsSync(sent), `the text is still there, so the record is kept: ${why}`);
    }
  } finally { F.done(); }
});

// After an account switch Claude Code can stop a session that waited on its limit with this line:
// the process has the new login and wants only a prompt, so the kit types one (kit-290).
const PROMPT = 'The kit: your login changed and the account has room now. Carry on.';
const STOP = 'Automatic continue stopped · your login changed or ended · send a prompt to continue';
const RULE = '─'.repeat(60);
// the old limit banner above the stop, as on the incident's panes
const stop = (mark = '⎿  ', input = '❯ ') => [MENU[0], `${mark}${STOP}`, RULE, input, RULE];
// A supervisor's pane, made here: the fixture's agent sets no environment. The role is always set,
// to the supervisor's or to nothing, so the tmux server's own environment can't decide it.
function supPane(F, win, shown, { role = 'supervisor', cwd = F.root } = {}) {
  const keys = path.join(F.base, `${win}.keys`);
  const prog = path.join(F.base, `${win}.cjs`);
  write(keys, '');
  write(prog, `const fs=require('fs');console.log(${JSON.stringify(shown)}.join('\\n'));process.stdin.setRawMode(true);process.stdin.on('data',(d)=>fs.appendFileSync(${JSON.stringify(keys)},d));`);
  if (spawnSync('tmux', ['has-session', '-t', `=${F.session}`]).status !== 0) execFileSync('tmux', ['new-session', '-d', '-s', F.session, '-n', 'dashboard', '-x', '120', '-y', '30', 'sleep 600']);
  fs.mkdirSync(cwd, { recursive: true });
  execFileSync('tmux', ['new-window', '-d', '-t', `=${F.session}:`, '-n', win, '-c', cwd, '-e', `DEVTEAM_ROLE=${role}`, process.execPath, prog]);
  for (const n of ['supervisor-pane', 'supervisor-pane-role']) write(path.join(F.root, 'docs/devteam/run', n), `=${F.session}:${win}`);
  return { keys: () => fs.readFileSync(keys, 'utf8'), shows: () => spawnSync('tmux', ['capture-pane', '-p', '-t', `=${F.session}:${win}`], { encoding: 'utf8' }).stdout };
}
const drawn = (...panes) => until(() => panes.every((p) => /Automatic|continue|\[y\/n\]|Stop and wait/.test(p.shows())), 'the panes drawn');

test('a supervisor stopped by a login change is sent one continue prompt once the account has room', { skip: !hasTmux }, async () => {
  const F = fixture('login-sup');
  try {
    // its transcript ends on the limit, so supervisor_limit reads set until it is continued
    const slug = fs.realpathSync(F.root).replace(/[^a-zA-Z0-9]/g, '-');
    const rl = { type: 'assistant', timestamp: new Date(Date.now() - 3600000).toISOString(), error: 'rate_limit', isApiErrorMessage: true, message: { content: [{ type: 'text', text: "You've hit your weekly limit" }] } };
    write(path.join(F.base, 'claude', 'projects', slug, 's.jsonl'), `${JSON.stringify({ type: 'user', message: { content: 'You are the supervisor for this repository' } })}\n${JSON.stringify(rl)}\n`);
    F.set(FULL);
    const s = supPane(F, 'sup', stop());
    await drawn(s);
    F.tick();
    F.tick();
    assert.equal(s.keys(), '', 'the account is still full');
    assert.match(F.state().supervisor_limit?.text ?? '', /weekly limit/);
    F.set(ROOM, `${JSON.stringify({ event: 'switch', to: 'b' })}\n`, 0);
    F.tick('--rotate');
    assert.equal(s.keys(), '', 'not in the tick that switched');
    F.set(ROOM);
    const out = F.tick();
    await until(() => s.keys() === `${PROMPT}\r`, 'the prompt and one Enter');
    assert.match(out, /continued supervisor: its login changed/);
    assert.doesNotMatch(out, /restarted supervisor/);
    assert.deepEqual(F.state().resumed, ['supervisor']);
    assert.equal(F.state().supervisor_limit, null, 'it is carrying on');
    assert.ok(json(F.run(['log', '--json']).stdout).some((o) => o.kind === 'login-continued' && o.subject === 'supervisor'));
    assert.deepEqual(F.relaunched(), [], 'nothing relaunched');
    F.tick();
    F.tick();
    assert.equal(s.keys(), `${PROMPT}\r`, 'once per stop');
  } finally { F.done(); }
  // only the supervisor's own pane: its process has the role, and it started in the main checkout
  const G = fixture('login-sup-who');
  try {
    const norole = supPane(G, 'norole', stop(), { role: '' });
    await drawn(norole);
    for (let i = 0; i < 3; i++) G.tick();
    const away = supPane(G, 'away', stop(), { cwd: path.join(G.base, 'away') });
    await drawn(away);
    for (let i = 0; i < 3; i++) G.tick();
    assert.equal(norole.keys(), '', 'a process without the role');
    assert.equal(away.keys(), '', 'a pane started outside the main checkout');
    const right = supPane(G, 'right', stop());
    await drawn(right);
    for (let i = 0; i < 3 && right.keys() === ''; i++) G.tick();
    await until(() => right.keys() === `${PROMPT}\r`, 'the real one continued');
    assert.equal(norole.keys() + away.keys(), '');
  } finally { G.done(); }
});

test("a worker or planner the kit launched, stopped by a login change, is sent one continue prompt; never one it didn't launch", { skip: !hasTmux }, async () => {
  const F = fixture('login-panes');
  try {
    // a bare stop under the banner: limitStop alone would read it as a limit stop and relaunch
    const w = F.worker('kit-9-w', stop(''));
    const p = F.planner('p', stop());
    const wrapped = F.planner('wrap', [MENU[0], '⎿  Automatic continue stopped · your login changed or ended · send a prompt', '   to continue', RULE, '❯ ', RULE]);
    const enter = F.planner('enter', stop('⎿  ', `❯ ${PROMPT}`));
    const nw = F.worker('kit-9-n', stop(), { launched: false });
    const np = F.planner('n', stop(), { launched: false });
    const seen = F.planner('seen', [...stop().slice(0, 2), `> ${PROMPT}`, '⏺ Carrying on.', RULE, '❯ ', RULE]);
    const later = F.planner('later', [...stop().slice(0, 2), '⏺ Done with that.', RULE, '❯ ', RULE]);
    const indented = F.planner('indented', [...stop().slice(0, 2), '  ⎿  Read 3 files', RULE, '❯ ', RULE]);
    await drawn(w, p, wrapped, enter, nw, np, seen, later, indented);
    const want = [[w, `${PROMPT}\r`], [p, `${PROMPT}\r`], [wrapped, `${PROMPT}\r`], [enter, '\r']];
    const resumed = [];
    F.tick();
    for (let i = 0; i < 8 && !want.every(([x, k]) => x.keys() === k); i++) {
      const out = F.tick();
      assert.ok((out.match(/continued /g) ?? []).length <= 1, 'one a tick');
      resumed.push(...F.state().resumed);
      await new Promise((r) => setTimeout(r, 300));
    }
    for (const [x, k] of want) await until(() => x.keys() === k, `keys ${JSON.stringify(k)}`);
    assert.deepEqual(resumed.sort(), ['kit-9-w', 'plan-enter', 'plan-p', 'plan-wrap']);
    F.tick();
    F.tick();
    for (const [x, k] of want) assert.equal(x.keys(), k, 'once per stop');
    for (const x of [nw, np, seen, later, indented]) assert.equal(x.keys(), '');
    assert.deepEqual(F.relaunched(), [], 'a prompt, never a relaunch');
  } finally { F.done(); }
});

test("a login-change stop with someone's text in the input, quoted, as content, busy or under a prompt is left alone", { skip: !hasTmux }, async () => {
  const F = fixture('login-not');
  try {
    const panes = [
      stop('⎿  ', "❯ hold on, I'm looking"),
      [MENU[0], `⎿  ${STOP}`, '╭──╮', '│ > some text │', '╰──╯'],
      [MENU[0], '⏺ It said "Automatic continue stopped · your login changed"', RULE, '❯ ', RULE],
      [`> ${STOP}`, RULE, '❯ ', RULE],
      [`12 ${STOP}`, RULE, '❯ ', RULE],
      [...stop(), '✻ Thinking… (esc to interrupt)'],
      [...stop().slice(0, 2), 'Allow this? [y/n]', RULE, '❯ ', RULE],
      [...stop().slice(0, 2), '  1. Upgrade your plan', '  2. Stop and wait for limit to reset', RULE, '❯ ', RULE],
    ].map((shown, i) => F.planner(`not${i}`, shown));
    const ctl = F.planner('ctl', stop());
    await drawn(...panes, ctl);
    for (let i = 0; i < 6 && ctl.keys() === ''; i++) F.tick();
    await until(() => ctl.keys() === `${PROMPT}\r`, 'the control continued');
    for (let i = 0; i < 3; i++) F.tick();
    panes.forEach((x, i) => assert.equal(x.keys(), '', `left alone: pane ${i}`));
    assert.deepEqual(F.relaunched(), []);
  } finally { F.done(); }
});
