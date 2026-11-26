// Every ask of the owner is an Inbox question (supervisor.md §6): a supervisor's or the responder's
// thread reply whose words ask the owner something no question holds is refused, saying to ask it
// with thread ask (the question and the thread then link to each other); a reply that shows its
// question (--refs question:<id>, or the q-… id in the line) goes through; --no-ask "<why>" lets
// through words that only read as an ask. The supervisor's own window gets the same check from its
// Stop hook (stop-ok): once per stop, an ask with no q-… id sends it back to ask it in the Inbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { firstId, RATE, YN } from './lib/answer-words-fixture.mjs';
import { runNode } from './lib/cli.mjs';
import { threadsFixture } from './lib/kit.mjs';

test('thread reply: an ask of the owner names its Inbox question', async (t) => {
  const F = threadsFixture('owner-asks');
  t.after(() => F.done());
  const subject = { kind: 'item', ref: `goal:${F.goal}` };
  const T = F.owner(['thread', 'new', 'Narrow this to the EU launch', '--subject', JSON.stringify(subject)]).split('\n')[0];

  await t.test('a question mark with no question is refused, naming the line and thread ask', () => {
    const said = F.fails(['thread', 'reply', T, 'That drops the measure to EU orders; want me to propose the change?', '--refs', `goal:${F.goal}`], { DEVTEAM_ROLE: 'supervisor' });
    assert.match(said, /asks the owner something no Inbox question holds/);
    assert.match(said, /- That drops the measure to EU orders; want me to propose the change\?/);
    assert.match(said, new RegExp(`thread ask ${T} --question`));
  });

  await t.test('a list under "Waiting on you:" is asks too, a question mark or not', () => {
    const words = 'Done with the copy.\n\nWaiting on you:\n- Substack: remove the test address.\n- Rotate the four proposal passwords.';
    const said = F.fails(['thread', 'reply', T, words, '--refs', `goal:${F.goal}`], { DEVTEAM_ROLE: 'supervisor' });
    assert.match(said, /asks the owner 2 things/);
    assert.match(said, /- Substack: remove the test address\./);
    assert.match(said, /- Rotate the four proposal passwords\./);
  });

  await t.test('asked with thread ask, the question links the thread, and a reply showing it passes', () => {
    const Q = firstId(F.sup(['thread', 'ask', T, '--question', 'Propose narrowing the measure to EU orders?', '--choices', YN, '--recommendation', 'Yes', ...RATE]));
    const q = JSON.parse(F.sup(['questions', '--all', '--json'])).find((x) => x.id === Q);
    assert.equal(q.thread, T, 'the Inbox question names its thread');
    assert.match(F.sup(['thread', 'reply', T, 'Shall I propose it?', '--refs', `question:${Q}`]), /^u-/, 'one ask, one question shown');
    assert.match(F.sup(['thread', 'reply', T, `Still open: ${Q}, the EU measure?`, '--refs', `goal:${F.goal}`]), /^u-/, 'the id in the line');
    const said = F.fails(['thread', 'reply', T, 'Shall I propose it?\nAnd drop the US banner?', '--refs', `question:${Q}`], { DEVTEAM_ROLE: 'supervisor' });
    assert.match(said, /- And drop the US banner\?/, 'one question shown covers one ask, not two');
  });

  await t.test('no question mark and no list: nothing to file; code and quotes are words, not asks', () => {
    assert.match(F.sup(['thread', 'reply', T, 'Done: the measure reads EU orders now.', '--refs', `goal:${F.goal}`]), /^u-/);
    assert.match(F.sup(['thread', 'reply', T, 'You asked:\n> why EU only?\nBecause the launch is EU first.\n```\ngrep -c "?" orders.csv\n```', '--refs', `goal:${F.goal}`]), /^u-/);
  });

  await t.test('--no-ask lets through words that only read as an ask, and needs its why', () => {
    assert.match(F.fails(['thread', 'reply', T, 'Anything else?', '--refs', `goal:${F.goal}`, '--no-ask', ' '], { DEVTEAM_ROLE: 'supervisor' }), /--no-ask "<why>": say why/);
    assert.match(F.sup(['thread', 'reply', T, 'Anything else?', '--refs', `goal:${F.goal}`, '--no-ask', 'a sign-off, nothing waits on it']), /^u-/);
  });

  await t.test("the supervisor's own thread: its first words ask nothing unfiled", () => {
    F.owner(['thread', 'resolve', T]);
    const said = F.fails(['thread', 'new', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${F.goal}` }), '--', 'Should this goal cover Canada too?'], { DEVTEAM_ROLE: 'supervisor' });
    assert.match(said, /first words ask the owner something no Inbox question holds/);
  });
});

test("stop-ok: the supervisor's window sends an unfiled ask back once", (t) => {
  const F = threadsFixture('owner-asks-stop');
  t.after(() => F.done());
  const DT = path.join(F.old, 'docs/devteam/scripts/devteam.mjs');
  const transcript = path.join(F.old, 'transcript.jsonl');
  const stop = (input, role = 'supervisor') => {
    const env = { ...F.env({ DEVTEAM_ROLE: role }) };
    delete env.DEVTEAM_SUPERVISOR;
    const r = runNode(DT, ['stop-ok'], { cwd: F.old, env, input: JSON.stringify(input) });
    return { status: r.status, err: r.stderr };
  };
  const asks = 'Merged both.\n\nOpen questions for you:\n- SOPS copy: go for the updated draft?\n- Fourthwall: what should I do first?\n- q-20261120-001739159: is the Identity machine goal met?';
  let r = stop({ last_assistant_message: asks, stop_hook_active: false });
  assert.equal(r.status, 2, 'sent back');
  assert.match(r.err, /asked the owner 2 things in your window with no Inbox question/);
  assert.match(r.err, /- SOPS copy: go for the updated draft\?/);
  assert.doesNotMatch(r.err, /Identity machine/, 'the line with its q-… id is filed');
  assert.equal(stop({ last_assistant_message: asks, stop_hook_active: true }).status, 0, 'the second stop goes through');
  assert.equal(stop({ last_assistant_message: 'Ticked: 3 merged, 2 workers started.' }).status, 0, 'nothing asked');
  assert.equal(stop({ last_assistant_message: asks }, 'responder').status, 0, 'only the supervisor\'s window');
  // the transcript, when Claude Code gives no last_assistant_message: the newest assistant text
  fs.writeFileSync(transcript, [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Ship the banner?' }] } },
    { type: 'user', message: { content: 'ok' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Waiting on you:\n- Rotate the proposal passwords.' }, { type: 'tool_use', name: 'Bash' }] } },
  ].map((e) => JSON.stringify(e)).join('\n'));
  r = stop({ transcript_path: transcript });
  assert.equal(r.status, 2);
  assert.match(r.err, /- Rotate the proposal passwords\./);
  assert.doesNotMatch(r.err, /Ship the banner/, 'only the newest message');
});
