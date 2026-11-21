// The spec sections worker.md §4 asks every author for, from kit-330's Proposals 1–3: a
// `## Today (sources)` table, a `red seen` cell per acceptance check (re-run by the spec reviewer,
// quality.md §3 Scoped), and `## Refusals and edges` in every spec; and the worker prompt names all
// three. One test per check, so each red is that check's own assertion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { kit, threadsFixture } from './lib/kit.mjs';

const read = (f) => fs.readFileSync(path.join(kit, f), 'utf8');
// a doc's `## <n>.` section, up to the next `## `
const section = (md, head) => {
  const i = md.indexOf(`\n${head}`);
  assert.ok(i >= 0, `${head} is a section`);
  const j = md.indexOf('\n## ', i + head.length + 1);
  return md.slice(i, j < 0 ? undefined : j);
};
const lineOf = (text, start) => text.split('\n').find((l) => l.startsWith(start)) ?? '';
const worker4 = () => section(read('process/worker.md'), '## 4. ');
const specRow = () => lineOf(worker4(), '| spec |');
const checksBullet = () => lineOf(worker4(), '- **Every done-when is shown by acceptance checks');
const sourcesBullet = () => lineOf(worker4(), '- **Every claim about existing code or a tool cites its source');
const scoped = () => lineOf(section(read('governance/quality.md'), '## 3. '), '- **Scoped.**');

test('A1: worker.md §4 asks every spec for a Today (sources) table, and the sources bullet points at it', () => {
  assert.match(specRow(), /`## Today \(sources\)` table: each claim about today's code or tools with its `file:line`, or the command run and the line it printed/, specRow());
  assert.match(sourcesBullet(), /in the spec's `## Today \(sources\)` table/, sourcesBullet());
  assert.match(sourcesBullet(), /run where its check will run \(a scratch HOME and cwd, `DEVTEAM_\*` unset\)/, sourcesBullet());
  assert.match(sourcesBullet(), /The reviewer reads only that table for code facts; a claim in the body that isn't in it is a finding/, sourcesBullet());
});

test('A2: worker.md §4 gives the acceptance table a red seen cell per check, deferred only to a plan task, each red its own', () => {
  const b = checksBullet();
  assert.match(b, /`check \| done-when \| fails when \| red seen`/, b);
  assert.match(b, /`command → the failing line`/, b);
  assert.match(b, /empty only as `deferred: plan task N`/, b);
  assert.match(b, /that check's own assertion, never one shadowed by an earlier failure in the same test/, b);
  assert.match(b, /the mutation removes only that behaviour, so another check doesn't catch it first/, b);
  assert.match(b, /Every done-when has at least one row/, b);
  assert.match(specRow(), /a `red seen` cell per check/, specRow());
});

test('A3: quality.md §3 has the spec reviewer re-run a red seen cell and treat an empty one as weak-check', () => {
  assert.match(scoped(), /The spec reviewer re-runs at least one `red seen` cell and sees its line fail; an empty cell \(not `deferred: plan task N`\) is a `weak-check` finding/, scoped());
});

test('A4: worker.md §4 asks every spec for Refusals and edges; a non-contract spec answers the four questions', () => {
  const r = specRow();
  assert.match(r, /edge cases \(every spec has a `## Refusals and edges` section: a spec that provides a contract lists,/, r);
  assert.match(r, /any other spec answers four questions, each in a line or `n\/a, because …`/, r);
  assert.match(r, /interrupted halfway \(a signal, a crash, a stop between two writes\)/, r);
  assert.match(r, /an older or newer kit running alongside \(shared caches, run files, worktrees\)/, r);
  assert.match(r, /a second actor at the same time/, r);
  assert.match(r, /existing records, tickets or touches that name what changes\); out of scope/, r);
});

test('A5: a contract spec keeps its per-input Refusals and edges rows', () => {
  assert.match(specRow(), /for each input, what bad input, a missing or null field and a value over a size limit get, and the order the guards run/, specRow());
});

test('A6: the worker prompt names all three spec sections in its first-pass checks', () => {
  const F = threadsFixture('spec-sections-prompt');
  try {
    F.sup(['feature', 'add', 'sprompt', '--json', JSON.stringify({ title: 'Sp', goals: [F.goal], stories: [{ id: 'SP-S1', text: 'prompt', release: 'v1.0.0' }] })]);
    F.sup(['ticket', 'add', 's-01-one', '--json', JSON.stringify({ title: 's', feature: 'sprompt', component: 'web', kind: 'build', size: 'S', risk: 'normal', serves: ['SP-S1'], depends_on: [], touches: ['src/s/**'], done_when: ['its test passes in CI'] })]);
    const p = F.sup(['prompt', 'worker', 's-01-one']);
    const first = p.split('\n').find((l) => l.includes('first-pass checks in worker.md §4')) ?? '';
    assert.match(first, /the acceptance table's red seen cell/, first);
    assert.match(first, /in the spec's Today \(sources\) table/, first);
    assert.match(first, /a Refusals and edges section in every spec/, first);
  } finally { F.done(); }
});
