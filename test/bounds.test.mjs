// Tests that time the kit's code against a bound: CI runs this file alone, before the files that
// run side by side, so other tests' load never counts against the bound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { coverageFns, fleetFixture, line, searchCorpus } from './lib/kit.mjs';

test('coverage: bounded on a big tree; each glob compiled once, and owner suggestions match each file once', () => {
  const { coverage, ownerSuggestions, ownersOf } = coverageFns();
  // 50k paths in 1,000 folders under 10 apps; 30 globs over 10 components; a tenth of the folders unowned
  const paths = [];
  for (let d = 0; d < 1000; d++) for (let f = 0; f < 50; f++) paths.push(`app${d % 10}/m${d}/${d % 10 === 9 ? 'stray' : 'src'}/f${f}.rb`);
  const comps = Array.from({ length: 10 }, (_, i) => ({ name: `c${i}`, owns: [`app${i}/**/src/**`, `app${i}/m${i}/*.md`, `app${i}/{x,y}/**`] }));
  // the best of three runs, so a loaded machine's one slow run doesn't fail it
  const best = (fn) => Math.min(...[0, 1, 2].map(() => { const t0 = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t0) / 1e6; }));
  let cov;
  const ms = best(() => { cov = coverage(paths, comps, ['docs/devteam/**']); });
  assert.equal(cov.unowned.length, 5000);
  assert.ok(ms < 500, `coverage of 50k paths x 30 globs took ${ms.toFixed(0)} ms (bound 500)`);
  const unowned = new Set(cov.unowned);
  const ownerOf = (p) => ownersOf(p, comps, []).find((n) => n !== 'devteam') ?? null;
  let suggest;
  const ms2 = best(() => { suggest = ownerSuggestions(paths, unowned, ownerOf); for (const p of cov.unowned) suggest(p.slice(0, p.lastIndexOf('/') + 1)); });
  assert.ok(ms2 < 500, `suggestions for 100 unowned folders over 50k paths took ${ms2.toFixed(0)} ms (bound 500)`);
  assert.equal(suggest('app9/m9/stray/'), null, 'no owned path under app9/: nothing to suggest');
  assert.equal(ownerSuggestions(['a/x/1', 'a/y/2'], new Set(['a/y/2']), (p) => (p === 'a/x/1' ? 'api' : null))('a/y/'), 'api', 'the nearest folder above with an owned path');
});

test('the Inbox order: 200 open questions, twenty of them settling the rest, ranked on every read within a bound', () => {
  const F = fleetFixture('rank-bound');
  const { old, ok } = F;
  try {
    const SUP = { DEVTEAM_ROLE: 'supervisor' };
    const G = ok(old, ['goal', 'add', '--title', 'Big', '--outcome', 'x'], SUP);
    ok(old, ['goal', 'impact', G, '3', '--rationale', 'W1'], SUP);
    // written straight to the log: 180 details and 20 gates, each gate settling nine details
    const at = (i) => new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
    const id = (i) => `q-20260101-${String(i).padStart(9, '0')}-supervisor`;
    const q = (i, extra) => line({ id: id(i), type: 'question', op: 'new', at: at(i), by: 'supervisor', kind: 'owner-decision', question: `Question ${i}?`, goal: G, urgency: 1 + (i % 2), ...extra });
    let text = '';
    for (let i = 0; i < 180; i++) text += q(i, { stake: 1 + (i % 2) });
    for (let j = 0; j < 20; j++) text += q(180 + j, { stake: 3, choices: [{ label: 'Yes' }, { label: 'No' }], settles: Array.from({ length: 9 }, (_, k) => id(j * 9 + k)), settles_if: 'No' });
    fs.appendFileSync(path.join(old, 'docs/devteam/run/log', `supervisor-${new Date().toISOString().slice(0, 7)}.jsonl`), text);
    const timed = (args) => Math.min(...[0, 1, 2].map(() => { const t0 = process.hrtime.bigint(); ok(old, args); return Number(process.hrtime.bigint() - t0) / 1e6; }));
    const qs = JSON.parse(ok(old, ['questions', '--json']));
    assert.equal(qs.length, 200);
    assert.ok(qs.slice(0, 20).every((x) => x.rank.parts.settles.length === 9), 'the twenty that settle others are first');
    // against the same log with nothing to rank, so a slow machine's start-up doesn't count
    const base = timed(['goal', 'list']);
    const ms = timed(['questions', '--json']);
    assert.ok(ms < base + 1500, `ranking 200 questions took ${ms.toFixed(0)} ms, ${(ms - base).toFixed(0)} over reading the log (bound 1500 over)`);
  } finally { F.done(); }
});

test('search: a project of about six million characters is searched within a second of reading its log', () => {
  const F = fleetFixture('search-bound');
  const { old, ok } = F;
  try {
    const C = searchCorpus({ questions: 1500, observations: 12000, lessons: 500, words: 70 });
    const at = (i) => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)).toISOString();
    let text = '';
    let i = 0;
    for (const q of C.questions) text += line({ id: `q-20260101-${String(i).padStart(9, '0')}-supervisor`, type: 'question', op: 'new', at: at(i++), by: 'supervisor', kind: 'owner-decision', question: q.question, context: q.context });
    for (const o of C.observations) text += line({ id: `o-20260101-${String(i).padStart(9, '0')}-supervisor`, type: 'observation', op: 'new', at: at(i++), by: 'supervisor', source: 'repo', subject: o.subject, kind: 'note', detail: o.detail });
    for (const k of C.lessons) text += line({ id: `k-20260101-${String(i).padStart(9, '0')}-supervisor`, type: 'knowledge', op: 'new', at: at(i++), by: 'supervisor', kind: 'fact', statement: k.statement, scope: 'project', status: 'candidate' });
    assert.ok(text.length > 5e6, `${text.length} characters`);
    fs.mkdirSync(path.join(old, 'docs/devteam/run/log'), { recursive: true });
    fs.appendFileSync(path.join(old, 'docs/devteam/run/log', `supervisor-${new Date().toISOString().slice(0, 7)}.jsonl`), text);
    const timed = (args) => Math.min(...[0, 1, 2].map(() => { const t0 = process.hrtime.bigint(); ok(old, args); return Number(process.hrtime.bigint() - t0) / 1e6; }));
    // against the same log read without a search, so a slow machine's start-up doesn't count
    const base = timed(['knowledge', '--status', 'accepted']);
    const ms = timed(['search', C.questions[7].context]);
    assert.ok(ms < base + 1000, `search took ${ms.toFixed(0)} ms, ${(ms - base).toFixed(0)} over reading the log (bound 1000 over)`);
  } finally { F.done(); }
});
