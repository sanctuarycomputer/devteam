// presence@1 (test/contracts/presence.md): the contract states every message, part and limit the
// design's "The contract: presence@1" sets (C1, C2, which read the document's own words).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = () => fs.readFileSync(path.join(here, 'contracts', 'presence.md'), 'utf8');
const has = (text, needle) => assert.ok(text.includes(needle), `the contract says ${JSON.stringify(needle)}`);
// The text from the `## ` heading naming `word` to the next `## ` heading (a `###` never cuts it).
function section(md, word) {
  const parts = md.split(/^## /m);
  const hit = parts.filter((p) => p.split('\n', 1)[0].includes(word));
  assert.equal(hit.length, 1, `one ## section names ${word}`);
  return hit[0];
}
const all = (md, word, needles) => { const s = section(md, word); for (const n of needles) has(s, n); };

test('presence C1: the contract states every message, part and limit', () => {
  const md = contract();
  has(md, 'presence@1');
  all(md, 'The socket', ['GET /presence', 'x-devteam-relay', 'http://<Host>', 'okHost', 'before any of that payload is read']);
  all(md, 'Close codes', ['1008', '1002', '1001']);
  all(md, 'Who you are', ['x-devteam-person', '<id>;name=<name>', 'x-devteam-level', 'never from a message', '80 bytes']);
  all(md, 'Where you are', [
    '"page"', '"tab"', '"peek"', '"art"', '"thread"', 'A-Z a-z 0-9 . _ - : @ /', '1 to 120', 'h:',
    'first 16 lowercase hex characters', 'SHA-256', 'The same spot', '`page`, `tab`, `peek` and `art` all equal',
  ]);
  all(md, 'Messages', [
    '{ "t": "here", "at"', '{ "t": "move", "a"', '{ "t": "pong" }', '{ "t": "welcome", "presence": 1, "you"',
    '{ "t": "people", "people"', '{ "t": "move", "id", "conn", "a" }', '{ "t": "changed" }', '{ "t": "ping" }',
    "never to any connection of the sender's own person", 'data-presence', 'the selector alone',
    '250 ms', '500 ms', '20 s', '15 a second',
  ]);
  all(md, 'Limits', ['2048 bytes', '262144 bytes', '30 messages a second', '10 seconds in a row', '8 connections per person per server', '200 per server']);
  all(md, 'The page', ['1, 2, 4 … up to 30 s', 'never draws its own face', 'CSS.escape']);
});

test('presence C2: the lens, hub-visible, peek and present', () => {
  const md = contract();
  all(md, 'The lens', ['"type": "pointer"', '"type": "place"', '"type": "placed"', '"lens": 1', 'at most 8', 'viewport in CSS pixels']);
  all(md, 'hub-visible', [
    'dashboard-shell@3', '{ "devteam": "hub-visible"', 'hidden or shown', 'every load of a frame',
    "Presence's additions to shell@3's sender", "hasn't heard it counts as hidden",
  ]);
  has(section(md, 'Where you are'), "without a version and without `dashboard-shell@3`'s `view`");
  all(md, "The hello's", ['`present: [', '`present_more`', 'at most 50']);
});
