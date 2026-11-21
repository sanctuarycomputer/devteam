// ask --options takes each choice as its own value, or one JSON array of strings. One value with
// choices joined by | ("yes|no", "Merge it | Let it go") showed the owner a single choice reading that
// way: refused with the command that was meant. On a decision, whole words joined by , or / ("yes,no")
// are refused too, and so is a decision whose drawn choices (--choices, else --options) are one.
// Other kinds keep a lone "N/A". Where the kit writes the choices (goal-met), this check stays out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { threadsFixture } from './lib/kit.mjs';

test('ask refuses joined choices and one-choice decisions; separate values and JSON arrays work', () => {
  const F = threadsFixture('ask-options');
  try {
    const ask = (extra, kind = 'owner-decision') => spawnSync(process.execPath, [path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), 'ask', '--kind', kind, '--goal', F.goal, '--question', 'Can I merge #12 so the check passes?', '--recommendation', 'yes', ...extra], { cwd: F.old, env: F.env(F.SUP), encoding: 'utf8' });
    const refused = (r, re) => { assert.notEqual(r.status, 0, r.stdout); assert.match(r.stderr, re); };
    refused(ask(['--options', 'yes|no']), /--options takes each choice as its own value: --options "yes" "no"/);
    refused(ask(['--options', 'yes,no']), /--options takes each choice as its own value: --options "yes" "no"/);
    refused(ask(['--options', 'Merge it | Let it go']), /--options takes each choice as its own value: --options "Merge it" "Let it go"/);
    refused(ask(['--options', 'done']), /is one choice, so there is nothing to choose/);
    refused(ask(['--choices', JSON.stringify([{ label: 'yes' }])]), /--choices "yes" is one choice/);
    refused(ask(['--choices', JSON.stringify([{ label: 'yes|no' }])]), /--choices has one choice labelled "yes\|no": give each choice its own entry/);
    // a JSON array is separate choices, stored as such
    const arr = ask(['--options', '["yes","no"]']);
    assert.equal(arr.status, 0, arr.stderr);
    const id = arr.stdout.trim().split('\n').pop();
    const q = JSON.parse(F.sup(['questions', '--all', '--json'])).find((x) => x.id === id);
    assert.deepEqual(q.options, ['yes', 'no']);
    // separate values still work
    const ok = ask(['--options', 'yes', 'no']);
    assert.equal(ok.status, 0, ok.stderr);
    // on a kind where one choice is fine, a lone value with a slash is kept
    const na = ask(['--options', 'N/A', '--no-default', 'the owner names the account'], 'owner-action');
    assert.equal(na.status, 0, na.stderr);
  } finally { F.done(); }
});
