// org-access A13 on a laptop, part 1 of 3: the first slice of the routes, each GET and HEAD leaving state as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envOf, getSafeFixture, operatorThreads, PARTS, sweep } from './lib/org-access-fixture.mjs';

test('org-access A13: no GET route of the dashboard or the hub changes durable state or starts a command that writes (laptop, part 1 of 3)', { timeout: 900000 }, async (t) => {
  const F = getSafeFixture();
  try {
    const laptop = envOf(F);
    operatorThreads(F);
    const failures = await sweep(t, F, 'laptop', laptop, PARTS.laptop[0]);
    assert.deepEqual(failures, [], 'every GET leaves durable state as it was, starts only reads and answers as it should');
  } finally { F.done(); }
});
