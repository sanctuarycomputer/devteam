// The supervisor: stopped, its own conversation, and its own pane's lost Enter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { findings, fixture, MENU } from './lib/accounts-fixture.mjs';
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
