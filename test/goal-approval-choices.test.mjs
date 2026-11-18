// A goal's approval takes only Approve, Refine or Let go (goal decide). The card's choices, from
// choicesOf in the dashboard page run alone in vm: a recommendation in other words ("Yes") marks
// Approve, and never becomes a choice of its own the press can't send.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = fs.readFileSync(path.join(here, '..', 'docs', 'devteam', 'dashboard', 'index.html'), 'utf8');
const from = (start, end) => { const a = INDEX.indexOf(start); const b = INDEX.indexOf(end, a); assert.ok(a >= 0 && b > a, `${start} is in the page`); return INDEX.slice(a, b); };

test('a goal approval recommended as "Yes" offers Approve, Refine and Let go, with Approve marked', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`${from('const norm = ', '// An open owner-action without secrets')}\n${from('const isOa = ', '\n// What the supervisor suggested')}\nthis.choicesOf = choicesOf;`, ctx);
  const choices = (q) => JSON.parse(JSON.stringify(ctx.choicesOf({ status: 'open', options: [], choices: [], secrets: [], ...q })));
  for (const rec of ['Yes', 'yes', 'Approve', 'Approved', null]) {
    const c = choices({ kind: 'goal-approval', recommendation: rec });
    assert.deepEqual(c.map((x) => x.label), ['Approve', 'Refine', 'Let go'], `recommendation ${rec}: only the three verdicts`);
    assert.deepEqual(c.filter((x) => x.rec).map((x) => x.label), rec ? ['Approve'] : [], `recommendation ${rec}: Approve is the one marked`);
  }
  // another kind keeps its recommendation as a choice of its own
  assert.deepEqual(choices({ kind: 'owner-decision', recommendation: 'Yes' }).map((x) => x.label), ['Yes']);
});
