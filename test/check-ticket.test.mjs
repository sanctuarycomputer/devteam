// check-ticket's verdict rules, loaded from the script by themselves: fillInOnly (what a later edit
// to a review record may fill in without voiding the verdicts after it) and verdictHolds (whether a
// verdict at V still holds at a later head), the latter against a throwaway git repo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { kit, gitReadFns } from './lib/kit.mjs';

for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR']) delete process.env[k];

const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
// a top-level function, from its line to the next column-0 "}"; a top-level const, its one line
function cut(name) {
  let i = src.indexOf(`\nfunction ${name}(`);
  if (i >= 0) { const j = src.indexOf('\n}\n', i); assert.ok(j > i, `the end of function ${name}`); return src.slice(i + 1, j + 2); }
  i = src.indexOf(`\nconst ${name} =`);
  assert.ok(i >= 0, `${name} is declared in devteam.mjs`);
  return src.slice(i + 1, src.indexOf('\n', i + 1));
}
const fns = vm.runInContext(`${['tableCells', 'disposed', 'fillInOnly', 'verdictHolds'].map(cut).join('\n')}\n;({ fillInOnly, verdictHolds })`, vm.createContext({ isHandoffFile: () => false }));
const { fillInOnly, verdictHolds } = fns;

const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
// a final review record: a Reviewer line, a Records line, one Important finding, the verdict
const record = ({ reviewer = 'reviewer-a', records = null, finding = 'handles no error', disp = '', verdict = 'APPROVE', sha = SHA } = {}) =>
  `# Final review, pass 1\n\n${reviewer ? `- Reviewer: ${reviewer}\n` : ''}- Reviewed: the whole branch\n${records ? `- Records: ${records}\n` : ''}\n| Id | Severity | Rule | Where | Finding | Disposition |\n|---|---|---|---|---|---|\n| F1 | Important | spec | a.js:1 | ${finding} | ${disp} |\n\nVerdict: ${verdict} ${sha}\n`;

test('A1: an added Records line is a fill-in, where verdictHolds allows one', () => {
  assert.equal(fillInOnly(record(), record({ records: SHA2 }), true), true);
  assert.equal(fillInOnly(record(), record({ records: SHA2 }), false), false, 'not where the record existed at V');
  assert.equal(fillInOnly(record(), record({ records: SHA2 })), false, 'not by default');
});

test('A2: a Reviewer line, a Records line and a filled Disposition in one edit', () => {
  assert.equal(fillInOnly(record({ reviewer: null }), record({ records: SHA2, disp: 'fixed' }), true), true);
});

test('A3: every other change to a record is still a change', () => {
  const cases = {
    'a Records line changed': [record({ records: SHA }), record({ records: SHA2 })],
    'a Records line removed': [record({ records: SHA }), record()],
    'a second Records line': [record({ records: SHA }), record({ records: SHA }).replace(`- Records: ${SHA}\n`, `- Records: ${SHA}\n- Records: ${SHA2}\n`)],
    'a Records line that is no full sha': [record(), record({ records: 'abc123' })],
    'a Records line and another line': [record(), record({ records: SHA2 }).replace('- Reviewed:', 'Also fine.\n- Reviewed:')],
    'an edited finding': [record(), record({ finding: 'fine really' })],
    'two Records lines added at once': [record(), record({ records: SHA }).replace(`- Records: ${SHA}\n`, `- Records: ${SHA}\n- Records: ${SHA2}\n`)],
    'two Reviewer lines added at once': [record({ reviewer: null }), record().replace('- Reviewer: reviewer-a\n', '- Reviewer: reviewer-a\n- Reviewer: reviewer-b\n')],
    'a malformed Records line counts as present': [record().replace('- Reviewed:', '-Records: abc\n- Reviewed:'), record({ records: SHA2 }).replace('- Reviewed:', '-Records: abc\n- Reviewed:')],
  };
  for (const [what, [a, b]] of Object.entries(cases)) assert.equal(fillInOnly(a, b, true), false, what);
});

test('A4: a filled Disposition and an added Reviewer line still fill in', () => {
  assert.equal(fillInOnly(record(), record({ disp: 'fixed' })), true);
  assert.equal(fillInOnly(record({ reviewer: null }), record()), true);
  assert.equal(fillInOnly(record({ disp: 'fixed' }), record({ disp: 'wrong' })), false, 'a given disposition stays');
});

// The repo: main has a.js; the branch adds a code commit (V0) and then the review record (V).
let dir, R, V0, V;
const DIR = 'docs/t/reviews/';
const FINAL = `${DIR}final-1.md`;
const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
const commit = (msg) => { g('add', '-A'); g('commit', '-qm', msg); return g('rev-parse', 'HEAD'); };
const revert = () => { g('revert', '--no-edit', 'HEAD'); return g('rev-parse', 'HEAD'); };
const from = (name, sha) => g('checkout', '-q', '-B', name, sha);
const holds = (v = V) => verdictHolds(v, g('rev-parse', 'HEAD'), DIR, R);
// a "does not hold" is only worth something when the range it judged has commits in it
const refused = (v = V) => { assert.notEqual(g('rev-list', `${v}..HEAD`, '^main'), '', 'the range has commits'); return !holds(v); };

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-ticket-'));
  g('init', '-q', '-b', 'main');
  g('config', 'user.name', 'Test');
  g('config', 'user.email', 'test@example.com');
  g('config', 'commit.gpgsign', 'false');
  put('a.js', 'one\n');
  commit('base');
  g('checkout', '-q', '-b', 'ticket/t');
  put('a.js', 'one\ntwo\n');
  V0 = commit('work');
  put(FINAL, record({ sha: V0 }));
  V = commit('final-1');
  R = { git: gitReadFns(dir).git, mainRef: () => 'main' };
});
after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

test('B1: a record edit and its exact revert change nothing', () => {
  from('case-1', V);
  put(FINAL, record({ sha: V0, finding: 'fine really' }));
  commit('rewrite a finding');
  revert();
  assert.equal(holds(), true);
});

test('B2: a code change and its exact revert change nothing', () => {
  from('case-2', V);
  put('a.js', 'one\ntwo\nthree\n');
  commit('code');
  revert();
  assert.equal(holds(), true);
});

test('B3: a hand restore that is not the exact inverse still voids', () => {
  from('case-3', V);
  put(FINAL, record({ sha: V0, finding: 'fine really' }));
  commit('rewrite a finding');
  put(FINAL, record({ sha: V0 }).replace('# Final review, pass 1', '# Final review'));
  commit('restore, with another change');
  assert.equal(refused(), true);
});

test('B4: a record edit with no revert voids', () => {
  from('case-4', V);
  put(FINAL, record({ sha: V0, finding: 'fine really' }));
  commit('rewrite a finding');
  assert.equal(refused(), true);
});

test('B5: a commit between a pair is still judged', () => {
  from('case-5', V);
  put(FINAL, record({ sha: V0, finding: 'fine really' }));
  const x = commit('rewrite a finding');
  put('a.js', 'one\ntwo\nthree\n');
  commit('code');
  g('revert', '--no-edit', x);
  assert.equal(refused(), true);
});

test('B6: a record written after V0 gains its Records line (the kit-64 shape)', () => {
  from('case-6', V0);
  put(FINAL, record({ sha: V0 }));
  commit('final-1');
  put(FINAL, record({ sha: V0, records: V0 }));
  commit('final-1 names its records');
  assert.equal(holds(V0), true);
});

test('B7: a dissent added and reverted still voids', () => {
  from('case-7', V);
  put(`${DIR}final-1b.md`, record({ reviewer: 'reviewer-b', verdict: 'CHANGES', sha: V0 }));
  commit('final-1b says CHANGES');
  revert();
  assert.equal(refused(), true);
});

test('B8: a record that existed at V cannot gain a Records line', () => {
  from('case-8', V);
  put(FINAL, record({ sha: V0, records: V }));
  commit('final-1 names its records');
  assert.equal(refused(), true);
});

test('B9: an edit, its revert and the revert of that leave the edit judged', () => {
  from('case-9', V);
  put(FINAL, record({ sha: V0, finding: 'fine really' }));
  commit('rewrite a finding');
  revert();
  revert();
  assert.equal(refused(), true);
});

test('B10: a commit already paired is never the match of a second one', () => {
  from('case-10', V);
  put(FINAL, record({ sha: V0, finding: 'fine really' }));
  commit('X1: rewrite a finding');
  put(FINAL, record({ sha: V0 }));
  put('a.js', 'one\ntwo\nthree\n');
  const w = commit('W: restore it, and change code');
  put(FINAL, record({ sha: V0, finding: 'fine really' }));
  commit('X2: rewrite it again');
  revert();
  g('revert', '--no-edit', w);
  // X1 pairs with Y (X2's revert); W with W's revert; X2's rewrite is what stands at the head
  assert.match(fs.readFileSync(path.join(dir, FINAL), 'utf8'), /fine really/);
  assert.equal(refused(), true);
});
