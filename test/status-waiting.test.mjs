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
    F.g(['commit', '-qm', 'w-02-merged: done', '--allow-empty'], F.old);
    F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
    for (const id of ['w-03-behind', 'w-04-alone']) { phaseLine(id, null, 'starting', 3 * H); phaseLine(id, 'starting', 'blocked', 2 * H); }
    const row = (id) => F.sup(['status']).split('\n').find((l) => new RegExp(`\\s${id}(\\s|$)`).test(l)) ?? '';
    assert.match(row('w-03-behind'), /WAITING ON w-01-first TO MERGE\]/, 'names only the dependency still unmerged');
    assert.doesNotMatch(row('w-03-behind'), /SUPERVISOR|w-02-merged/);
    assert.match(row('w-04-alone'), /WAITING ON SUPERVISOR\]/, 'no dependency: the supervisor owes it');
  } finally { F.done(); }
});
