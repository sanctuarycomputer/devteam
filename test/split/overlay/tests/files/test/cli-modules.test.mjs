// The rules of cli-modules@1 (the design's contract for the CLI in modules), checked on this checkout's
// docs/devteam/scripts/lib/. Written into the generated tree by test/split/overlay/tests (kit-893); at the
// source there are no modules yet, so each test skips there.
//   M1 every lib module, imported alone in its own Node, loads, prints nothing and exits 0
//   M2 import.meta.url appears in code only in lib/state.mjs and lib/settings.mjs
//   M3 every module opens with its imports region, as the modules' own declarations make it
//   M4 no module is over 2,000 lines
//   M5 no lib module imports the entry (cli.mjs) or the shim (devteam.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scan } from './split/lib/js.mjs';
import { parseImport } from './split/lib/split.mjs';
import { regionProblems } from './split/lib/overlay.mjs';
import { readModule } from './split/lib/verify.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = path.join(root, 'docs', 'devteam', 'scripts');
const lib = path.join(scripts, 'lib');
const walk = (d, acc = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, acc); else if (e.isFile() && p.endsWith('.mjs')) acc.push(p); } return acc; };
const files = fs.existsSync(lib) ? walk(lib) : [];
const rel = (p) => path.relative(root, p).split(path.sep).join('/');
const modules = files.map((p) => ({ file: rel(p), text: fs.readFileSync(p, 'utf8') }));
const skip = files.length ? false : 'no docs/devteam/scripts/lib/ here: the CLI is one file (the source, not the generated tree)';
const CAP = 2000;
const STATE_AND_SETTINGS = ['docs/devteam/scripts/lib/state.mjs', 'docs/devteam/scripts/lib/settings.mjs'];

test('M1 every lib module, imported alone, loads and prints nothing', { skip, timeout: 600e3 }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-modules-'));
  // a scratch HOME, every DEVTEAM_* and GIT_* variable unset, the hub's port away from the box's
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(DEVTEAM_|GIT_|NODE_TEST_CONTEXT$)/.test(k))), HOME: home, DEVTEAM_HUB_PORT: '4999' };
  const bad = [];
  try {
    for (const p of files) {
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(p).href)});`], { cwd: home, env, encoding: 'utf8', input: '', timeout: 60e3 });
      if (r.status !== 0 || r.signal || r.stdout || r.stderr) bad.push(`${rel(p)}: exit ${r.status}${r.signal ? ` (${r.signal})` : ''}${r.stdout ? `; stdout ${r.stdout.slice(0, 200)}` : ''}${r.stderr ? `; stderr ${r.stderr.slice(0, 300)}` : ''}`);
    }
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
  assert.deepEqual(bad, [], 'modules that do not load alone and quietly');
});

test('M2 import.meta.url is in code only in lib/state.mjs and lib/settings.mjs', { skip }, () => {
  const where = modules.filter((m) => !STATE_AND_SETTINGS.includes(m.file) && /\bimport\.meta\.url\b/.test(scan(m.text).code)).map((m) => m.file);
  assert.deepEqual(where, [], 'modules whose code reads import.meta.url');
});

test('M3 every module\'s imports region is as the modules\' declarations make it', { skip }, () => {
  // the source's own imports (node: builtins) are the ones the regions hold, by local name
  const builtins = new Map();
  for (const m of modules) for (const l of readModule(m.text).region ?? []) if (!/from '\.\.?\//.test(l)) for (const b of parseImport(l)) builtins.set(b.local, b.line);
  const missing = modules.filter((m) => !readModule(m.text).region).map((m) => `no imports region: ${m.file}`);
  assert.deepEqual([...missing, ...regionProblems(modules, builtins)], [], 'imports regions not as generated');
});

test('M4 no module is over 2,000 lines', { skip }, () => {
  const over = modules.map((m) => [m.file, m.text.split('\n').length - (m.text.endsWith('\n') ? 1 : 0)]).filter(([, n]) => n > CAP);
  assert.deepEqual(over, [], 'modules over the cap');
});

test('M5 no lib module imports the entry or the shim', { skip }, () => {
  const entry = new Set(['docs/devteam/scripts/cli.mjs', 'docs/devteam/scripts/devteam.mjs']);
  const bad = [];
  for (const m of modules) {
    const code = scan(m.text).code;
    // static imports and re-exports (from '<spec>'), bare imports, and import('<spec>') with a literal
    for (const x of m.text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"\n]+)\1/g)) {
      if (!/^(?:from|import)\b/.test(code.slice(x.index, x.index + 6))) continue; // in a comment or a string, which scan blanks
      const spec = x[2];
      if (!spec.startsWith('.')) continue;
      const to = path.posix.normalize(path.posix.join(path.posix.dirname(m.file), spec));
      if (entry.has(to)) bad.push(`${m.file} imports ${spec}`);
    }
  }
  assert.deepEqual(bad, [], 'lib modules that import the entry or the shim');
});
