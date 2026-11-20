// dispose fills one finding's Disposition cell, and only in a row as wide as its table's header: a
// "|" left unescaped inside a cell (a code span too) splits the row, and the cell dispose would fill
// is then another one (kit-162's final-4b B4-1 lost its Fix that way). Escaped pipes (\|) aren't breaks.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture } from './lib/kit.mjs';

const F = fleetFixture('dispose');
after(() => F.done());
const reviews = path.join(F.old, 'docs/devteam/project/tickets/t-1/reviews');
const WORKER = { DEVTEAM_ROLE: 'worker' };

// a record whose one finding row is `row`, under a seven-cell header with a Fix column before Disposition
const record = (row) => `# Final review, pass 4b\n\n- Reviewer: reviewer-b\n\n| Id | Severity | Rule | Where | Finding | Fix | Disposition |\n|---|---|---|---|---|---|---|\n${row}\n\nVerdict: CHANGES ${'a'.repeat(40)}\n`;
const put = (file, text) => { fs.mkdirSync(reviews, { recursive: true }); fs.writeFileSync(path.join(reviews, file), text); return path.join(reviews, file); };
const dispose = (file, fid, text) => F.run(F.old, ['dispose', 't-1', file, fid, text], WORKER);
// a row's cells as the kit counts them: a "|" with a backslash before it is no break
const cellCount = (row) => row.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).length;

test('a row split by an unescaped "|" in a code span is refused, the record unchanged', () => {
  const text = record('| B4-1 | Important | spec | a.js:1 | `a|b` splits the row | keep the `Fix` text | |');
  const file = put('final-4b.md', text);
  const r = dispose('final-4b.md', 'B4-1', 'fixed');
  assert.notEqual(r.status, 0, `dispose wrote the row: ${r.out}`);
  assert.match(r.err, /final-4b\.md/, 'the refusal names the record');
  assert.match(r.err, /B4-1/, 'and the row');
  assert.match(r.err, /line 7/, 'and its line');
  assert.match(r.err, /8 cells/, 'and the cells it has');
  assert.match(r.err, /header has 7/, 'and the header\'s');
  assert.match(r.err, /escape/i, 'and says to escape the pipes');
  assert.ok(r.err.includes('\\|'), 'as \\|');
  assert.equal(fs.readFileSync(file, 'utf8'), text, 'nothing is written');
});

test('a row with a cell fewer than its header is refused too, the record unchanged', () => {
  const text = record('| F2 | Important | spec | a.js:2 | the Fix cell went missing | |');
  const file = put('final-5.md', text);
  const r = dispose('final-5.md', 'F2', 'fixed');
  assert.notEqual(r.status, 0, `dispose wrote the row: ${r.out}`);
  assert.match(r.err, /F2/);
  assert.match(r.err, /6 cells/);
  assert.match(r.err, /header has 7/);
  assert.equal(fs.readFileSync(file, 'utf8'), text, 'nothing is written');
});

test('escaped pipes (\\|) are no cell breaks: the row is disposed, its Fix kept', () => {
  const file = put('final-6.md', record('| B6-1 | Important | spec | a.js:1 | `a\\|b` splits nothing | keep `x\\|y` here | |'));
  const r = dispose('final-6.md', 'B6-1', 'fixed in the next commit');
  assert.equal(r.status, 0, r.err);
  const row = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('| B6-1'));
  assert.equal(cellCount(row), 7, `the row keeps the header's seven cells: ${row}`);
  assert.ok(row.includes('| `a\\|b` splits nothing |'), `the Finding keeps its escaped pipe: ${row}`);
  assert.ok(row.includes('| keep `x\\|y` here |'), `the Fix is kept: ${row}`);
  assert.match(row, /\| fixed in the next commit \|$/);
});
