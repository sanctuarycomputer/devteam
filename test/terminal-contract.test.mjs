// The terminal routes (terminal@1, test/contracts/terminal.md): the contract states every route,
// guard, refusal and writer rule the design's "The routes" and "The owner's line comes first" set
// (C1 to C3, which read the document's own words), and the fake server the page's tests use
// (test/fixtures/term-fake.mjs) answers as the contract says (A1 to A3, C4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = () => fs.readFileSync(path.join(here, 'contracts', 'terminal.md'), 'utf8');
const has = (text, needle) => assert.ok(text.includes(needle), `the contract says ${JSON.stringify(needle)}`);
// The text from the `## ` heading naming `word` to the next `## ` heading (a `###` never cuts it).
function section(md, word) {
  const parts = md.split(/^## /m);
  const hit = parts.filter((p) => p.split('\n', 1)[0].includes(word));
  assert.equal(hit.length, 1, `one ## section names ${word}`);
  return hit[0];
}

test('terminal C1: the contract states the routes', () => {
  const md = contract();
  for (const n of [
    'terminal@1',
    'GET /api/term/token', 'GET /api/term/<which>/screen', 'GET /api/term/<which>/history?before=<n>&count=<k>',
    'POST /api/term/<which>/keys', 'POST /api/term/shell/open',
    '`pane`', '`state`', '`cols`', '`rows`', '`cursor`', '`modes`', '`history_size`', '`lines`', '`etag`', '`held`',
    'at most 500',
    '{ which, pane, page, seq, data | paste, token }',
    '`Sec-Fetch-Site: same-origin`', '`Origin` equal to `http://<Host>`', '`application/json`', '`127.0.0.1`, `localhost`, `::1`',
    'devteam-term-keys-v1', 'devteam-term-open-v1',
    '`400`', '`403`', '`409`', '`413`', '`423`', '`503`',
    'greater than the last',
  ]) has(md, n);
});

test('terminal C2: the Writers section', () => {
  const w = section(contract(), 'Writers');
  for (const n of [
    '`@devteam-owner-floor`', 'on every post', '`<epoch ms> open`', '`<epoch ms> done`', 'Enter (', 'Ctrl+C (',
    "Escape doesn't end a line", '3 s settle', '`ready`', '`busy`', '`dialog`', '`limit`', '`unknown`',
    '`paneAnswer` is exempt', '`run/type-lock-<pane id>`', 'pid and a stamp', 'refreshed between steps',
    'when the pid is dead', '60 s old', 're-entrant per call chain', '`AsyncLocalStorage`', 'where every wait is async',
    '`Atomics.wait`', 'only after taking it', 'after 10 s', '503 after 2 s', '`pane answered`',
    'once the floor is released', "owner's line open", '120000', '2 minutes',
    'Messages for the supervisor are waiting until you send or clear your line.',
    'Press Enter or Ctrl+C here to let them through.',
    "supervisor's pane only",
    'the keys and paste routes', '`typeNow`', '`typeInto`', '`flushHeld`', '`flushAllHeld`', '`resendLostEnter`',
    '`machine tell`', '`enterLanded`',
  ]) has(w, n);
});

test('terminal C3: consumers and logging', () => {
  const md = contract();
  for (const n of ['`index.html`', 'Supervisor and Shell tabs', '`cloud/gateway.mjs`', '`devteam.mjs`', 'never logged']) has(md, n);
});
