// A goal's baseline is its first reading under the measure as it stands (planning.md §1): a change
// to what the measure reads (its check, source, question, unit or link) needs a fresh baseline, and
// the milestones step from that one, not from a reading of the old check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleetFixture, json } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };

test("a goal whose check changed: readings under the old check aren't its baseline", () => {
  const F = fleetFixture('goal-baseline');
  const { old, ok } = F;
  try {
    const G = ok(old, ['goal', 'add', '--title', 'Fewer gaps', '--outcome', 'the floor holds', '--measure', 'floor gaps', '--target', '0', '--unit', 'gaps', '--direction', 'down', '--source', 'prod', '--check', 'echo 6', '--non-goals', 'none', '--preconditions', 'a', 'b', 'c', 'd', '--priority', '1'], SUP);
    const check = () => json(ok(old, ['goal', 'show', G])).check;
    ok(old, ['goal', 'reading', G, '--run'], SUP);
    assert.ok(!check().definition.some((d) => /no baseline reading/.test(d)), 'read under its check: a baseline');

    // the check is widened: the 6 was a count of something else, so the goal must be read again
    ok(old, ['goal', 'set', G, '--check', 'echo 22'], SUP);
    assert.ok(check().definition.some((d) => /no baseline reading/.test(d)), 'the old reading is not a baseline for the new check');
    ok(old, ['goal', 'reading', G, '--run'], SUP);
    assert.ok(!check().definition.some((d) => /no baseline reading/.test(d)));

    // milestones step down from 22, the reading under the check as it stands
    const ms = [19, 13, 4, 0].map((target, i) => ({ title: `m${i + 1}`, target, preconditions: [i + 1], tickets: 1 }));
    ok(old, ['goal', 'set', G, '--milestones', JSON.stringify(ms)], SUP);
    assert.deepEqual(check().approval, []);

    // a change that leaves what is read alone (its wording, its target) keeps the baseline
    ok(old, ['goal', 'set', G, '--measure', 'floor gaps left', '--target', '0'], SUP);
    assert.deepEqual(check().approval, []);
    assert.ok(!check().definition.some((d) => /no baseline reading/.test(d)));
    assert.deepEqual(json(ok(old, ['goal', 'show', G])).readings.map((r) => r.value), [6, 22], 'the card still shows every reading');
    ok(old, ['log-check']);
  } finally { F.done(); }
});
