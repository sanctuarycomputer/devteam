// kit-146: the artifact-annotations design's §End to end, run against the real kit in headless Chrome.
// One top-level test, a subtest per step, each reading what the last left (a failed step fails the rest).
import test from 'node:test';
import assert from 'node:assert/strict';
import { canDrive } from './lib/chrome.mjs';
import { harness, J } from './fixtures/artifact-viewer/harness.mjs';
import { buildStack, ok, SLUG, FAQ, PLAN, CHORE, OLD } from './fixtures/artifact-annotations-e2e/stack.mjs';

const WIN = { width: 1100, height: 800 };

test('artifact annotations, end to end', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 900000 }, async (t) => {
  const H = await harness(t, 'ann-e2e');
  const { F, visit } = H;
  const times = {};
  const step = (name, fn, opts = {}) => t.test(name, { timeout: 120000, ...opts }, async (s) => {
    const at = Date.now();
    try { await fn(s); } finally { times[name] = Date.now() - at; t.diagnostic(`${name}: ${times[name]} ms`); }
  });
  const stack = buildStack(F);

  // the four rows the library lists: pricing only in the planner's worktree, faq on main and in two drafts
  const ROWS = [[SLUG, PLAN], [FAQ, 'main'], [FAQ, CHORE], [FAQ, OLD]].map(([slug, at]) => `${slug} ${at}`).sort();
  const rows = (list) => list.map((a) => `${a.slug} ${a.at}`).sort();

  await step('step 1: pricing at plan-pricing only, faq on main and in two drafts', async () => {
    const listed = JSON.parse(ok(F, 'owner', ['artifacts', '--json'])).filter((a) => [SLUG, FAQ].includes(a.slug));
    assert.deepEqual(rows(listed), ROWS, 'artifacts --json lists the four rows');
    // the dashboard was up before the stack was built: a fresh visit lists the same four
    const V = await visit('#library', WIN);
    const listed5 = await V.settle(`JSON.stringify(DATA.library.artifacts.filter((a) => ['${SLUG}', '${FAQ}'].includes(a.slug)).map((a) => a.slug + ' ' + a.at).sort()) === ${J(J(ROWS))}`, 5000);
    assert.ok(listed5, `the dashboard's library lists the same four rows within 5 s: ${await V.p.ev("JSON.stringify(DATA.library.artifacts.map((a) => a.slug + ' ' + a.at))")}`);
  });

  void stack;
});
