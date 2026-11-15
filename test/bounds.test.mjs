// Tests that hold the kit's code to a bound. Each bound is a count of operations, or a ratio of
// the code's time to a reference workload timed in this process just before, so a loaded machine
// slows both sides and the bound still holds; neither is a wall-clock limit. (run.mjs still runs
// this file alone, before the files that run side by side.)
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

const msOf = (fn) => { const t0 = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t0) / 1e6; };
// A workload's time over a reference's, both timed here, one after the other n times, the best of
// each kept: a burst of load hits one run, not the best of several, and steady load slows both.
const ratio = (work, ref, n) => { let w = Infinity, r = Infinity; for (let i = 0; i < n; i++) { r = Math.min(r, msOf(ref)); w = Math.min(w, msOf(work)); } return { w, r, x: w / r, say: `${w.toFixed(0)} ms against ${r.toFixed(0)} ms, ${(w / r).toFixed(2)}x` }; };

test('coverage: bounded on a big tree; each glob compiled once, and owner suggestions match each file once', (t) => {
  const { coverage, ownerSuggestions, ownersOf } = coverageFns();
  // every RegExp the kit's code builds in its context (a glob compiled), counted: the context's own
  // Function installs the count, so the loader is the kit's as it is
  const compiled = [];
  coverage.constructor('onNew', 'const R = RegExp; globalThis.RegExp = new Proxy(R, { construct(t, a) { onNew(String(a[0])); return Reflect.construct(t, a); } });')((src) => compiled.push(src));
  // 50k paths in 1,000 folders under 10 apps; 30 globs over 10 components; a tenth of the folders unowned
  const paths = [];
  for (let d = 0; d < 1000; d++) for (let f = 0; f < 50; f++) paths.push(`app${d % 10}/m${d}/${d % 10 === 9 ? 'stray' : 'src'}/f${f}.rb`);
  const comps = Array.from({ length: 10 }, (_, i) => ({ name: `c${i}`, owns: [`app${i}/**/src/**`, `app${i}/m${i}/*.md`, `app${i}/{x,y}/**`] }));
  const run = () => coverage(paths, comps, ['docs/devteam/**']);
  const cov = run();
  assert.equal(cov.unowned.length, 5000);
  // each glob compiled once in the process: once more on any later call, or per path, is caught at the end
  const once = (when) => { assert.equal(new Set(compiled).size, 31, `the 30 globs and the kit's line (${when})`); assert.equal(compiled.length, 31, `each glob compiled once in the process, not per call or per path: ${compiled.length} compiled (${when})`); };
  once('after one coverage');
  // the reference: the same paths against the same globs as plain RegExps written here, none of the
  // kit's code, so a slower matcher in the kit can't slow both sides; it doubles as an oracle
  const kitLine = /^docs\/devteam\/.*$/;
  const own = comps.flatMap((_, i) => [new RegExp(`^app${i}/.*src/.*$`), new RegExp(`^app${i}/m${i}/[^/]*\\.md$`), new RegExp(`^app${i}/(x|y)/.*$`)]);
  // every path asked of every glob, as coverage asks them all to find a contest
  const ref = () => paths.filter((p) => { let n = 0; for (const r of own) if (r.test(p)) n++; return !kitLine.test(p) && n === 0; });
  assert.deepEqual(ref(), [...cov.unowned], 'the reference finds the same unowned paths'); // copied: the kit's array is the context's
  const c = ratio(run, ref, 5);
  t.diagnostic(`coverage: ${c.say}`);
  assert.ok(c.x < 10, `coverage of 50k paths x 30 globs took ${c.say} the same matching with plain RegExps (bound 10x)`);
  const unowned = new Set(cov.unowned);
  // each owned path asked for its owner at most once, and only for a folder not yet indexed
  const asked = [];
  const ownerOf = (p) => { asked.push(p); return ownersOf(p, comps, []).find((n) => n !== 'devteam') ?? null; };
  const suggest = ownerSuggestions(paths, unowned, ownerOf);
  const dirs = cov.unowned.map((p) => p.slice(0, p.lastIndexOf('/') + 1));
  const got = dirs.map(suggest);
  const folders = new Set();
  for (const p of paths) if (!unowned.has(p)) for (let i = p.indexOf('/'); i !== -1; i = p.indexOf('/', i + 1)) folders.add(p.slice(0, i + 1));
  assert.equal(new Set(asked).size, asked.length, 'no path asked twice');
  assert.ok(asked.length <= folders.size, `${asked.length} owner asks for 100 unowned folders over 50k paths; at most one per folder holding an owned path (${folders.size})`);
  // the lookups, against the same walk up a plain Map built here (from the reference's owners): the
  // same answers, and a bounded multiple of the time; twenty rounds, so each side is long enough to time
  const ownerHere = (p) => { const k = own.findIndex((r) => r.test(p)); return k === -1 ? null : `c${Math.floor(k / 3)}`; };
  const firstHere = new Map();
  for (const p of paths) if (!unowned.has(p)) for (let i = p.indexOf('/'); i !== -1; i = p.indexOf('/', i + 1)) { const d = p.slice(0, i + 1); if (!firstHere.has(d)) firstHere.set(d, ownerHere(p)); }
  const suggestHere = (dir) => { for (let d = dir; d && d !== './'; d = d.slice(0, d.slice(0, -1).lastIndexOf('/') + 1)) if (firstHere.has(d)) return firstHere.get(d); return null; };
  assert.deepEqual(got, dirs.map(suggestHere), 'the suggestions are the nearest owned folder\'s owner');
  const rounds = (fn) => () => { for (let k = 0; k < 20; k++) for (const d of dirs) fn(d); };
  const l = ratio(rounds(suggest), rounds(suggestHere), 5);
  t.diagnostic(`suggestion lookups: ${l.say}`);
  assert.ok(l.x < 4, `100,000 suggestion lookups took ${l.say} the same walk up a plain Map (bound 4x)`);
  assert.equal(suggest('app9/m9/stray/'), null, 'no owned path under app9/: nothing to suggest');
  assert.equal(ownerSuggestions(['a/x/1', 'a/y/2'], new Set(['a/y/2']), (p) => (p === 'a/x/1' ? 'api' : null))('a/y/'), 'api', 'the nearest folder above with an owned path');
  once('after six coverage runs and 900 owner asks');
});

test('the Inbox order: 2,000 open questions, a tenth of them settling the rest, ranked on every read within a bound', (t) => {
  const F = fleetFixture('rank-bound');
  const { old, ok } = F;
  try {
    const SUP = { DEVTEAM_ROLE: 'supervisor' };
    const G = ok(old, ['goal', 'add', '--title', 'Big', '--outcome', 'x'], SUP);
    ok(old, ['goal', 'impact', G, '3', '--rationale', 'W1'], SUP);
    // written straight to the log: 1,800 details and 200 gates, each gate settling nine details. As
    // many as this, so the command's own work (read, fold, rank) outweighs starting a process
    const at = (i) => new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
    const id = (i) => `q-20260101-${String(i).padStart(9, '0')}-supervisor`;
    const q = (i, extra) => line({ id: id(i), type: 'question', op: 'new', at: at(i), by: 'supervisor', kind: 'owner-decision', question: `Question ${i}?`, goal: G, urgency: 1 + (i % 2), ...extra });
    let text = '';
    for (let i = 0; i < 1800; i++) text += q(i, { stake: 1 + (i % 2) });
    for (let j = 0; j < 200; j++) text += q(1800 + j, { stake: 3, choices: [{ label: 'Yes' }, { label: 'No' }], settles: Array.from({ length: 9 }, (_, k) => id(j * 9 + k)), settles_if: 'No' });
    fs.appendFileSync(path.join(old, 'docs/devteam/run/log', `supervisor-${new Date().toISOString().slice(0, 7)}.jsonl`), text);
    const qs = JSON.parse(ok(old, ['questions', '--json']));
    assert.equal(qs.length, 2000);
    assert.ok(qs.slice(0, 200).every((x) => x.rank.parts.settles.length === 9), 'the two hundred that settle others are first');
    // against reading the same log with nothing to rank: start-up and the read are on both sides
    const r = ratio(() => ok(old, ['questions', '--json']), () => ok(old, ['goal', 'list']), 5);
    t.diagnostic(`questions --json against goal list: ${r.say}`);
    assert.ok(r.x < 4.5, `reading and ranking 2,000 questions took ${r.say} reading the log for goal list (bound 4.5x)`);
  } finally { F.done(); }
});

test('search: a project of about six million characters is searched in a bounded multiple of reading its log', (t) => {
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
    // against the same log read without a search: start-up and the read are on both sides
    const r = ratio(() => ok(old, ['search', C.questions[7].context]), () => ok(old, ['knowledge', '--status', 'accepted']), 3);
    t.diagnostic(`search against knowledge: ${r.say}`);
    assert.ok(r.x < 8, `search took ${r.say} reading the log for knowledge (bound 8x)`);
  } finally { F.done(); }
});
