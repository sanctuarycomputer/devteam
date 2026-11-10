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
import { coverageFns } from './lib/kit.mjs';

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
