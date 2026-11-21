// ask --options takes each choice as its own value. One value with choices joined by | , or /
// ("yes|no") showed the owner a single choice reading "yes|no", and a decision with one choice offers
// nothing to choose: both are refused, with the command that was meant. Separate values still work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { threadsFixture } from './lib/kit.mjs';

test('ask refuses choices joined into one --options value, and a decision with one choice', () => {
  const F = threadsFixture('ask-options');
  try {
    const run = (opts) => spawnSync(process.execPath, [path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), 'ask', '--kind', 'owner-decision', '--goal', F.goal, '--question', 'Can I merge #12 so the check passes?', '--recommendation', 'yes', '--options', ...opts], { cwd: F.old, env: F.env(F.SUP), encoding: 'utf8' });
    for (const [joined, want] of [['yes|no', '"yes" "no"'], ['yes,no', '"yes" "no"'], ['Approve / Refine / Let go', '"Approve" "Refine" "Let go"']]) {
      const r = run([joined]);
      if (want.includes('Let go')) {
        // a choice with a space in it isn't a joined list: still one choice, refused as that
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, /is one choice, so there is nothing to choose/);
        continue;
      }
      assert.notEqual(r.status, 0, `${joined} is refused`);
      assert.match(r.stderr, new RegExp(`--options takes each choice as its own value: --options ${want}`));
    }
    const one = run(['done']);
    assert.notEqual(one.status, 0);
    assert.match(one.stderr, /one choice, so there is nothing to choose/);
    const ok = run(['yes', 'no']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /^q-/m);
  } finally { F.done(); }
});
