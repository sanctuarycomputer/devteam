// status says what a waiting ticket waits on: its unmerged dependencies by name, else the supervisor.
// A ticket blocked behind tickets that haven't merged was shown WAITING ON SUPERVISOR for hours, and
// read as a supervisor owing it a reply.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { threadsFixture } from './lib/kit.mjs';

test('status names the unmerged dependencies a waiting ticket waits on, and the supervisor only when none', () => {
  const F = threadsFixture('status-waiting');
  try {
    const H = 3600000;
    const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
    const phaseLine = (id, from, to, agoMs) => F.hand(id, { id: `h-${stamp(new Date(Date.now() - agoMs))}-${id}`, type: 'phase', from, to }, agoMs, `${id}.jsonl`);
    F.sup(['feature', 'add', 'wait', '--json', JSON.stringify({ title: 'Wait', goals: [F.goal], stories: [{ id: 'WT-S1', text: 'waiting reads right', release: 'v1.0.0' }] })]);
    const add = (id, depends_on = []) => F.sup(['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'wait', component: 'web', kind: 'build', size: 'S', risk: 'normal', serves: ['WT-S1'], depends_on, touches: [`src/${id}/**`], done_when: ['its test passes in CI'] })]);
    add('w-01-first');
    add('w-02-merged');
    add('w-03-behind', ['w-01-first', 'w-02-merged']);
    add('w-04-alone');
    add('w-05-planned-ahead', ['w-01-first']);
    add('w-06-asked', ['w-01-first']);
    F.g(['commit', '-qm', 'w-02-merged: done', '--allow-empty'], F.old);
    F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
    for (const id of ['w-03-behind', 'w-04-alone', 'w-06-asked']) { phaseLine(id, null, 'starting', 3 * H); phaseLine(id, 'starting', 'blocked', 2 * H); }
    F.hand('w-06-asked', { id: `m-${stamp(new Date(Date.now() - 90 * 60000))}-w-06-asked`, type: 'message', kind: 'blocked', to: 'supervisor', text: 'which API version?' }, 90 * 60000, 'w-06-asked.jsonl');
    // planned ahead of an unmerged dependency, now asking for its approve-plan: the supervisor's word
    phaseLine('w-05-planned-ahead', null, 'starting', 3 * H); phaseLine('w-05-planned-ahead', 'starting', 'awaiting-word', 2 * H);
    const row = (id) => F.sup(['status']).split('\n').find((l) => new RegExp(`\\s${id}(\\s|$)`).test(l)) ?? '';
    assert.match(row('w-03-behind'), /WAITING ON w-01-first TO MERGE\]/, 'names only the dependency still unmerged');
    assert.doesNotMatch(row('w-03-behind'), /SUPERVISOR|w-02-merged/);
    assert.match(row('w-04-alone'), /WAITING ON SUPERVISOR\]/, 'no dependency: the supervisor owes it');
    assert.match(row('w-05-planned-ahead'), /WAITING ON SUPERVISOR\]/, 'awaiting-word is the supervisor\'s word, dependencies or not');
    // blocked behind an unmerged dependency, but it asked the supervisor something still unanswered
    assert.match(row('w-06-asked'), /WAITING ON SUPERVISOR\]/, 'an unanswered message is the supervisor\'s, dependencies or not');
    // the blocked finding: none for a ticket held only by dependencies; still one when the supervisor owes it
    const blocked = JSON.parse(F.sup(['metrics', '--json'])).findings.filter((f) => f.kind === 'blocked').map((f) => f.subject);
    assert.ok(!blocked.includes('w-03-behind'), 'held only by its dependency: not a stuck session');
    assert.ok(blocked.includes('w-04-alone'), 'no dependency: the supervisor owes it');
    assert.ok(blocked.includes('w-06-asked'), 'an unanswered message: the supervisor owes it');
  } finally { F.done(); }
});
