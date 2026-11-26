// kit-954: the root package.json, .github/workflows/release.yml and test/release/package-check.mjs, the
// check release.yml's publish job runs before it publishes the kit to npm. Checks are numbered as in the
// ticket's spec (R1 to R12, and R7b).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(f, 'utf8');

// ---- R1: the root package.json -------------------------------------------------------------------
test('R1 package.json names @sanctuarycomputer/devteam, no dependencies, no bin, files docs/devteam/ less project/ and run/, layout 1', () => {
  const p = JSON.parse(read(path.join(REPO, 'package.json')));
  assert.equal(p.name, '@sanctuarycomputer/devteam', 'R1 the name');
  assert.deepEqual(p.dependencies, {}, 'R1 "dependencies": {}');
  for (const k of ['devDependencies', 'peerDependencies', 'optionalDependencies', 'bundleDependencies', 'bundledDependencies']) assert.equal(p[k], undefined, `R1 no ${k}`);
  assert.equal(p.bin, undefined, 'R1 no bin');
  assert.equal(p.scripts, undefined, 'R1 no scripts');
  assert.deepEqual(p.files, ['docs/devteam/', '!docs/devteam/project/', '!docs/devteam/run/'], 'R1 files: docs/devteam/ less project/ and run/');
  assert.deepEqual(p.devteam, { layout: 1 }, 'R1 "devteam": { "layout": 1 }');
  assert.equal(p.repository?.url, 'git+https://github.com/sanctuarycomputer/devteam.git', 'R1 the repository the trusted publisher and provenance name');
});

