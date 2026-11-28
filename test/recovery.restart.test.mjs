// A supervisor stopped at a usage limit is restarted on its exact conversation, and when it is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasTmux, json, until, write } from './lib/kit.mjs';
import { CLAUDE_RESUME, findings, fixture, MENU, OFF, rateLimit, ROOM, SID, SKIP, SUP, supervisorPane, tmuxShim } from './lib/recovery-fixture.mjs';

const FULL = { schemaVersion: 1, accounts: [{ number: 1, email: 'a@x', active: true, usageStatus: 'ok', usage: { fiveHour: { pct: 100 }, sevenDay: { pct: 30 } } }] };
const withCswap = (F) => ({ DEVTEAM_CSWAP: F.cswap });
// the restart carries the supervisor's Stop hook (supervisor.md §6, Every ask is an Inbox question): --settings does not outlive its process
const hooked = (call) => { assert.match(call ?? '', /^supervisor\|--settings \S+\/run\/agent\/supervisor-claude\.json /, call); return call.replace(/--settings \S+ /, ''); };
const left = (F, pane) => { assert.equal(pane.keys(), ''); assert.deepEqual(F.claudeCalls(), []); assert.ok(!fs.existsSync(F.restartsFile) || !/"supervisor"/.test(fs.readFileSync(F.restartsFile, 'utf8')), 'no attempt spent'); };

test('not onto a full account: a known-full active account waits for room', { skip: !hasTmux }, async () => {
  const F = fixture('fullgone');
  try {
    F.worker('demo-60-f');
    write(F.list, JSON.stringify(FULL));
    F.tick({ DEVTEAM_CSWAP: F.cswap });
    assert.deepEqual(F.relaunched(), []);
    write(F.list, JSON.stringify(ROOM));
    assert.match(F.tick({ DEVTEAM_CSWAP: F.cswap }), /relaunched demo-60-f/);
  } finally { F.done(); }
});

test('a supervisor stopped at a limit is restarted on its exact conversation, no key to the old process, once the account has room and has settled', { skip: !hasTmux }, async () => {
  const F = fixture('suprestart', { resume: CLAUDE_RESUME });
  try {
    F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(F, MENU, { args: SKIP });
    await until(() => pane.shows().includes('Esc to cancel'), 'the menu');
    assert.equal(F.tick(withCswap(F)), '', 'the first tick: this project has not seen the account settle');
    assert.ok(F.state().supervisor_limit, 'not restarted yet: still reported');
    assert.deepEqual(F.claudeCalls(), []);
    const said = F.tick(withCswap(F));
    assert.match(said, /restarted the supervisor/);
    assert.equal(F.state().supervisor_limit, null, 'restarted this tick: not reported as stopped');
    await until(() => F.claudeCalls().length === 1, 'the stand-in claude ran');
    assert.equal(hooked(F.claudeCalls()[0]), `supervisor|--resume ${SID} --dangerously-skip-permissions You were restarted after a usage limit, on this same conversation. Carry on from where you were.`);
    assert.equal(pane.keys(), '', 'no key reaches the old process');
    assert.match(fs.readFileSync(F.restartsFile, 'utf8'), /"supervisor"/, 'the same record as the workers');
    const logged = json(F.run(['log', '--type', 'observation', '--json']).stdout);
    assert.ok(logged.some((o) => o.kind === 'limit-restarted' && o.subject === 'supervisor'));
  } finally { F.done(); }
});

test('the supervisor is not restarted when its pane is split, in the wrong directory, or there is no conversation to resume; a non-Claude resume_command is left alone', { skip: !hasTmux }, async () => {
  const ready = async (F, pane) => { await until(() => pane.shows().includes('Esc to cancel'), 'the menu'); F.tick(withCswap(F)); };
  // a split window
  const split = fixture('supsplit', { resume: CLAUDE_RESUME });
  try {
    split.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(split);
    await ready(split, pane);
    spawnSync('tmux', ['split-window', '-d', '-t', `=${split.session}:sup-pane`, 'sleep 600']);
    assert.equal(split.tick(withCswap(split)), '');
    assert.equal(pane.keys(), '');
    assert.deepEqual(split.claudeCalls(), []);
    assert.ok(split.state().supervisor_limit, 'reported instead');
  } finally { split.done(); }
  // a wrong directory
  const wrong = fixture('supwrong', { resume: CLAUDE_RESUME });
  try {
    wrong.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(wrong, MENU, { cwd: wrong.base });
    await ready(wrong, pane);
    assert.equal(wrong.tick(withCswap(wrong)), '');
    assert.deepEqual(wrong.claudeCalls(), []);
  } finally { wrong.done(); }
  // no conversation: a pane at a limit, but no transcript of the supervisor's
  const noId = fixture('supnoid', { resume: CLAUDE_RESUME });
  try {
    const pane = supervisorPane(noId);
    await ready(noId, pane);
    assert.equal(noId.tick(withCswap(noId)), '');
    assert.deepEqual(noId.claudeCalls(), []);
    assert.equal(pane.keys(), '');
  } finally { noId.done(); }
  // another harness: no --resume to build
  const other = fixture('supother', { resume: 'codex resume' });
  try {
    other.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(other);
    await ready(other, pane);
    assert.equal(other.tick(withCswap(other)), '');
    assert.equal(other.run(['supervisor-session'], { DEVTEAM_ROLE: '' }).stdout, '', 'another harness: no id at all');
    const f = findings(other).find((x) => x.kind === 'supervisor-at-limit');
    assert.ok(f, 'still reported');
    assert.doesNotMatch(f.suggestion, /codex/);
  } finally { other.done(); }
  // a claude resume_command with nothing to replace: left alone too
  const noCont = fixture('supnocont', { resume: 'claude --dangerously-skip-permissions' });
  try {
    noCont.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(noCont);
    await ready(noCont, pane);
    assert.equal(noCont.tick(withCswap(noCont)), '');
    assert.deepEqual(noCont.claudeCalls(), []);
  } finally { noCont.done(); }
});

test('the supervisor\'s restarts share the caps: past 3 in 6 hours it is left alone and reported', { skip: !hasTmux }, async () => {
  const F = fixture('supcap', { resume: CLAUDE_RESUME });
  try {
    F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(F);
    await until(() => pane.shows().includes('Esc to cancel'), 'the menu');
    F.tick(withCswap(F));
    write(F.restartsFile, JSON.stringify({ supervisor: [Date.now() - 3600000, Date.now() - 2 * 3600000, Date.now() - 3 * 3600000] }));
    assert.equal(F.tick(withCswap(F)), '');
    assert.ok(F.state().restart_gave_up.includes('supervisor'));
    assert.deepEqual(F.claudeCalls(), []);
    assert.equal(pane.keys(), '');
    assert.doesNotMatch(findings(F).find((f) => f.kind === 'restart-gave-up').suggestion, /=.*:supervisor/);
  } finally { F.done(); }
});

test('an ad-hoc agent at the banner in the recorded pane is left alone when the supervisor\'s own transcript is not at a limit, or its process is not the supervisor', { skip: !hasTmux }, async () => {
  const dayOld = new Date(Date.now() - 24 * 3600000).toISOString();
  // the review's repro: a supervisor that was stopped a day ago, not at a limit, and an owner's agent in that pane
  const F = fixture('supadhoc', { resume: CLAUDE_RESUME });
  try {
    F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, { type: 'assistant', timestamp: dayOld, message: { content: [{ type: 'text', text: 'stopping here' }] } }]);
    const pane = supervisorPane(F, MENU, { prefix: '' });
    await until(() => pane.shows().includes('Esc to cancel'), 'the banner');
    assert.equal(F.tick(withCswap(F)), '');
    assert.equal(F.tick(withCswap(F)), '');
    left(F, pane);
    assert.equal(F.state().supervisor_limit, null);
  } finally { F.done(); }
  // its transcript is not at a limit, even with the role in the pane's environment
  const R = fixture('suprole', { resume: CLAUDE_RESUME });
  try {
    R.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, { type: 'assistant', timestamp: dayOld, message: { content: [{ type: 'text', text: 'stopping here' }] } }]);
    const pane = supervisorPane(R);
    await until(() => pane.shows().includes('Esc to cancel'), 'the banner');
    R.tick(withCswap(R));
    assert.equal(R.tick(withCswap(R)), '');
    left(R, pane);
  } finally { R.done(); }
  // at a limit, but the process in the pane isn't running as the supervisor: reported, not restarted
  const N = fixture('supnorole', { resume: CLAUDE_RESUME });
  try {
    N.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(N, MENU, { prefix: '' });
    await until(() => pane.shows().includes('Esc to cancel'), 'the banner');
    N.tick(withCswap(N));
    assert.equal(N.tick(withCswap(N)), '');
    left(N, pane);
    assert.ok(N.state().supervisor_limit, 'still reported');
  } finally { N.done(); }
});

test('a process that can\'t be read: refused, reported, nothing spent', { skip: !hasTmux || process.platform === 'linux' }, async () => {
  const F = fixture('supunread', { resume: CLAUDE_RESUME });
  try {
    F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(F);
    await until(() => pane.shows().includes('Esc to cancel'), 'the menu');
    F.tick(withCswap(F));
    const noPs = fs.mkdtempSync(path.join(F.base, 'nops-'));
    write(path.join(noPs, 'ps'), '#!/bin/sh\nexit 1\n');
    fs.chmodSync(path.join(noPs, 'ps'), 0o755);
    const said = F.tick({ ...withCswap(F), PATH: `${noPs}${path.delimiter}${process.env.PATH}` });
    assert.match(said, /not restarted: could not read the environment/);
    left(F, pane);
    assert.match(F.state().supervisor_limit.refused, /could not read/);
    assert.match(findings(F).find((x) => x.kind === 'supervisor-at-limit').detail, /not restarted: could not read/);
  } finally { F.done(); }
});

test('the restart keeps the permissions the running supervisor had: no flag it wasn\'t started with, and the command it prints suggests none', { skip: !hasTmux }, async () => {
  // README step 9's start: no flag, under a shell
  const plain = fixture('supplain', { resume: CLAUDE_RESUME });
  try {
    plain.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(plain, MENU, { prefix: 'DEVTEAM_ROLE=supervisor ', shell: true });
    await until(() => pane.shows().includes('Esc to cancel'), 'the menu');
    plain.tick(withCswap(plain));
    assert.doesNotMatch(findings(plain).find((x) => x.kind === 'supervisor-at-limit').suggestion, /dangerously/, 'the finding, the flag absent from the process');
    assert.doesNotMatch(plain.run(['fleet', 'status', '--no-fetch'], { DEVTEAM_ROLE: '' }).stdout, /dangerously/, 'the recovery line');
    assert.match(plain.tick(withCswap(plain)), /restarted the supervisor/);
    await until(() => plain.claudeCalls().length === 1, 'the stand-in claude ran');
    assert.equal(hooked(plain.claudeCalls()[0]), `supervisor|--resume ${SID} You were restarted after a usage limit, on this same conversation. Carry on from where you were.`);
  } finally { plain.done(); }
  // started with it: carried over, and the printed command says so too
  const flagged = fixture('supflagged', { resume: CLAUDE_RESUME });
  try {
    flagged.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(flagged, MENU, { prefix: 'DEVTEAM_ROLE=supervisor ', shell: true, args: SKIP });
    await until(() => pane.shows().includes('Esc to cancel'), 'the menu');
    flagged.tick(withCswap(flagged));
    assert.ok(findings(flagged).find((x) => x.kind === 'supervisor-at-limit').suggestion.includes(`claude --resume ${SID}${SKIP}`), 'printed only: no Stop hook file is written, and none was yet');
    assert.match(flagged.run(['fleet', 'status', '--no-fetch'], { DEVTEAM_ROLE: '' }).stdout, new RegExp(`recovery .*claude --resume ${SID}${SKIP}`));
    assert.match(flagged.tick(withCswap(flagged)), /restarted the supervisor/);
    await until(() => flagged.claudeCalls().length === 1, 'the stand-in claude ran');
    assert.ok(hooked(flagged.claudeCalls()[0]).startsWith(`supervisor|--resume ${SID}${SKIP} `), flagged.claudeCalls()[0]);
  } finally { flagged.done(); }
});

test('a parked or drained fleet\'s supervisor at a limit is restarted, as recover brings it back: a supervisor is never down', { skip: !hasTmux }, async () => {
  for (const hold of [['park', '--reason', 'throttling spend'], ['drain', '--move', '--reason', 'moving']]) {
    const F = fixture(`supheld-${hold[0]}`, { resume: CLAUDE_RESUME });
    try {
      F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
      const pane = supervisorPane(F);
      await until(() => pane.shows().includes('Esc to cancel'), 'the menu');
      const held = F.run(['fleet', ...hold]);
      assert.equal(held.status, 0, held.stderr);
      F.tick(withCswap(F));
      assert.match(F.tick(withCswap(F)), /restarted the supervisor/, `fleet ${hold.join(' ')}: it still keeps the Inbox and answers threads`);
      await until(() => F.claudeCalls().length === 1, 'the stand-in claude ran');
      assert.ok(hooked(F.claudeCalls()[0]).startsWith(`supervisor|--resume ${SID}`), F.claudeCalls()[0]);
    } finally { F.done(); }
  }
});

test('a person at the pane: a half-typed line or a recently active client leaves it alone, and a re-check that finds nothing costs no attempt', { skip: !hasTmux }, async () => {
  const F = fixture('supdraft', { resume: CLAUDE_RESUME });
  try {
    F.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(F, [MENU[0], '> half a thou']);
    await until(() => pane.shows().includes('half a thou'), 'the draft');
    F.tick(withCswap(F));
    assert.equal(F.tick(withCswap(F)), '');
    left(F, pane);
  } finally { F.done(); }
  const G = fixture('supclient', { resume: CLAUDE_RESUME });
  try {
    G.writeTranscript(SID, [{ type: 'user', message: { content: SUP } }, rateLimit()]);
    const pane = supervisorPane(G, [MENU[0], '> ']);
    await until(() => pane.shows().includes('You\'ve hit'), 'the banner');
    execFileSync('tmux', ['select-window', '-t', `=${G.session}:sup-pane`]);
    G.tick(withCswap(G));
    const attached = tmuxShim(G, 'if [ "$1" = list-clients ]; then date +%s; exit 0; fi');
    assert.equal(G.tick({ ...withCswap(G), ...attached }), '', 'a client just pressed a key');
    left(G, pane);
    const idle = tmuxShim(G, 'if [ "$1" = list-clients ]; then echo $(( $(date +%s) - 3600 )); exit 0; fi');
    // the re-check right after the claim finds the banner gone: nothing done, no attempt taken
    const count = path.join(G.base, 'captures');
    const once = tmuxShim(G, `if [ "$1" = list-clients ]; then echo $(( $(date +%s) - 3600 )); exit 0; fi\nif [ "$1" = capture-pane ]; then n=$(cat ${count} 2>/dev/null || echo 0); n=$((n + 1)); echo $n > ${count}; if [ $n -gt 1 ]; then echo '> '; exit 0; fi; fi`);
    assert.equal(G.tick({ ...withCswap(G), ...once }), '');
    left(G, pane);
    assert.match(G.tick({ ...withCswap(G), ...idle }), /restarted the supervisor/, 'an idle client is nobody at the pane');
  } finally { G.done(); }
});

test('a tmux server the tick starts keeps no session markers, so windows opened there can run owner commands', { skip: !hasTmux }, async () => {
  const F = fixture('serverenv');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-tmux-recovery-'));
  try {
    F.worker('demo-70-e');
    assert.match(F.tick({ ...OFF, TMUX_TMPDIR: dir, CLAUDECODE: '1', DEVTEAM_CHANNEL: 'dashboard' }), /relaunched demo-70-e/);
    await until(() => F.relaunched().length === 1, 'relaunched');
    const global = spawnSync('tmux', ['show-environment', '-g'], { env: { ...process.env, TMUX_TMPDIR: dir }, encoding: 'utf8' }).stdout;
    assert.match(global, /^PATH=/m, 'it is the server\'s environment');
    assert.doesNotMatch(global, /^(DEVTEAM_ROLE|DEVTEAM_TICKET|DEVTEAM_FEATURE|DEVTEAM_CHANNEL|CLAUDECODE|CLAUDE_CODE_[A-Z_]+)=/m);
  } finally {
    spawnSync('tmux', ['kill-server'], { env: { ...process.env, TMUX_TMPDIR: dir } });
    fs.rmSync(dir, { recursive: true, force: true });
    F.done();
  }
});

test('--if-gone, its window made but nothing typed: says that, not that an old process has gone', { skip: !hasTmux }, () => {
  const F = fixture('ifgonefail');
  try {
    F.worker('demo-71-f', { launched: false });
    const r = F.run(['worker', 'demo-71-f', '--resume', '--if-gone'], tmuxShim(F, 'if [ "$1" = send-keys ]; then exit 1; fi'));
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /its new window has no agent in it/);
    assert.doesNotMatch(r.stderr, /old process/);
  } finally { F.done(); }
});
