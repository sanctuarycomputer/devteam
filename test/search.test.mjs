// Search: ranked keyword search over the log and the project's markdown, quoted as data; ask's
// warnings about rules and answers that look like the new question.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchFns } from './lib/kit.mjs';

const S = searchFns();
const doc = (id, title, body = '', date = '2026-11-01') => ({ id, date, fields: [{ text: title, w: 2 }, { text: body, w: 1 }] });
const ids = (hits) => [...hits].map((h) => h.doc.id);

test('ranking: a title beats a mention, a phrase beats scattered words, words meet their kin', () => {
  const ix = S.searchIndex([
    doc('a', 'Salary window flake', 'pin the clock in the spec'),
    doc('b', 'Payroll export', 'the salary report has a window of a week; flaky on CI'),
    doc('c', 'Window cleaning', 'nothing to do with pay'),
    doc('d', 'Merges into main', 'a merged branch is deleted'),
    doc('e', 'stacks-08-salary-window-flake', 'the ticket'),
  ]);
  assert.deepEqual(ids(S.searchRank(ix, 'salary window flake')).slice(0, 2).sort(), ['a', 'e'], 'the titles first');
  assert.equal(ids(S.searchRank(ix, '"window flake"'))[0], 'a', 'the phrase as written ranks first');
  assert.ok(ids(S.searchRank(ix, 'flaky')).includes('a'), 'flaky meets flake');
  assert.ok(ids(S.searchRank(ix, 'merge')).includes('d'), 'merge meets merges and merged');
  assert.equal(ids(S.searchRank(ix, 'stacks-08-salary-window-flake'))[0], 'e', 'an id matches whole');
  assert.ok(ids(S.searchRank(ix, 'stacks')).includes('e'), 'and by its words');
  assert.equal(S.searchRank(ix, 'the of and').length, 0, 'stop words alone match nothing');
  // ties go to the newer
  const tie = S.searchIndex([doc('old', 'Deploy failed', '', '2026-01-01'), doc('new', 'Deploy failed', '', '2026-06-01')]);
  assert.deepEqual(ids(S.searchRank(tie, 'deploy')), ['new', 'old']);
});

test('similar: relative to the text itself, so it holds on any corpus', () => {
  const docs = [doc('q1', 'Always adopt new devteam releases without asking'), doc('q2', 'Which colour should the button be?'), ...Array.from({ length: 50 }, (_, i) => doc(`f${i}`, `filler ${i} about sensors and dashboards`))];
  const ix = S.searchIndex(docs);
  const row = (id) => ix.rows.find((r) => r.doc.id === id);
  const same = S.searchSimilar(ix, 'Always adopt new devteam releases without asking', row('q1'));
  assert.ok(same.ratio > 0.9 && same.coverage === 1, JSON.stringify(same));
  const near = S.searchSimilar(ix, 'Should we adopt devteam releases without asking each time?', row('q1'));
  assert.ok(near.ratio >= 0.5 && near.coverage >= 0.6, JSON.stringify(near));
  const far = S.searchSimilar(ix, 'Should we adopt devteam releases without asking each time?', row('q2'));
  assert.ok(far.ratio < 0.5 || far.coverage < 0.6, JSON.stringify(far));
});
