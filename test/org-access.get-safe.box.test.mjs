// org-access A13 as a box, with the box's own standalone hub: every route's first GET.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PORTS } from './lib/kit.mjs';
import { envOf, getSafeFixture, operatorThreads, PARTS, sweep } from './lib/org-access-fixture.mjs';

test('org-access A13: no GET route of the dashboard or the hub changes durable state or starts a command that writes (box)', { timeout: 900000 }, async (t) => {
  const F = getSafeFixture();
  try {
    // a box: the public name set (and previews served on it), so the box's own branches run, and the
    // hub the image's (DEVTEAM_IMAGE_HUB: the dashboard leaves it to `devteam.mjs hub`, started alone)
    const box = envOf(F, { DEVTEAM_PUBLIC_URL: 'https://box.example.test', DEVTEAM_PREVIEWS: '1', PORT: String(PORTS + 41), DEVTEAM_IMAGE_HUB: String(PORTS) });
    operatorThreads(F);
    const failures = await sweep(t, F, 'box', box, PARTS.box[0]);
    assert.deepEqual(failures, [], 'every GET leaves durable state as it was, starts only reads and answers as it should');
  } finally { F.done(); }
});
