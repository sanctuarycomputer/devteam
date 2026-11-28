// A goal's approval takes only Approve, Refine or Let go (goal decide). The card's choices, from
// choicesOf from the dashboard app's built lib: a recommendation in other words ("Yes") marks
// Approve, and never becomes a choice of its own the press can't send.
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, 'apps', 'dashboard', 'lib-dist');
// with no lib-dist/, every test skips locally; under CI the file fails
const UNBUILT = fs.existsSync(LIB) ? false : 'build apps/dashboard first (npm run build)';
if (UNBUILT && process.env.CI) throw new Error(UNBUILT);
const test = (name, o, fn) => { if (typeof o === 'function') { fn = o; o = {}; } return nodeTest(name, UNBUILT ? { ...o, skip: UNBUILT } : o, fn); };
const lib = (...p) => import(pathToFileURL(path.join(LIB, ...p)).href);
const { choicesOf, wireWords } = UNBUILT ? {} : await lib('lib', 'words-plain.js');
const { wordsState } = UNBUILT ? {} : await lib('views', 'words', 'state.js');
// choicesOf reads GOAL_VERDICTS and the rest of its tables from wordsState
if (!UNBUILT) wireWords({ wordsState });

test('a goal approval recommended as "Yes" offers Approve, Refine and Let go, with Approve marked', () => {
  const choices = (q) => JSON.parse(JSON.stringify(choicesOf({ status: 'open', options: [], choices: [], secrets: [], ...q })));
  for (const rec of ['Yes', 'yes', 'Approve', 'Approved', null]) {
    const c = choices({ kind: 'goal-approval', recommendation: rec });
    assert.deepEqual(c.map((x) => x.label), ['Approve', 'Refine', 'Let go'], `recommendation ${rec}: only the three verdicts`);
    assert.deepEqual(c.filter((x) => x.rec).map((x) => x.label), rec ? ['Approve'] : [], `recommendation ${rec}: Approve is the one marked`);
  }
  // another kind keeps its recommendation as a choice of its own
  assert.deepEqual(choices({ kind: 'owner-decision', recommendation: 'Yes' }).map((x) => x.label), ['Yes']);
});
