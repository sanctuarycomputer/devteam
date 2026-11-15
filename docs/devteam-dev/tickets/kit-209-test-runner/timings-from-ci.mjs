// Builds test/timings.json from a test.yml run's job logs (kit-209).
// usage: node timings-from-ci.mjs <run id> <repo root> <log file>... > test/timings.json
// Each log is `gh run view --job <id> --log` of a kit job. Node's TAP names no file for a test, so
// each top-level test ("ok N - <name>" at column 0) is matched to the test file that declares a
// top-level test of that name (a string literal, or a template whose ${…} parts match anything).
// A file's weight is the sum of its top-level tests' duration_ms (tests in a file run one after
// another), in seconds, the largest across the logs given; unmatched names are listed on stderr.
import fs from 'node:fs';
import path from 'node:path';

const [run, root, ...logs] = process.argv.slice(2);
if (!run || !root || !logs.length) { console.error('usage: node timings-from-ci.mjs <run id> <repo root> <log>...'); process.exit(2); }
const files = fs.readdirSync(path.join(root, 'test')).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => `test/${f}`);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const decl = new Map();
for (const f of files) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  const pats = [];
  for (const m of src.matchAll(/^(?:test|it|describe)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/gm)) {
    const raw = m[2].replace(/\\(['"`\\])/g, '$1');
    pats.push(m[1] === '`' ? new RegExp(`^${raw.split(/\$\{[^}]*\}/).map(esc).join('.*')}$`) : raw);
  }
  decl.set(f, pats);
}
const owner = (name) => { for (const [f, pats] of decl) if (pats.some((p) => (typeof p === 'string' ? p === name : p.test(name)))) return f; return null; };
const best = {};
const unmatched = new Set();
for (const log of logs) {
  const sums = {};
  const lines = fs.readFileSync(log, 'utf8').split('\n').map((l) => l.replace(/^[^\t]*\t[^\t]*\t﻿?\S+Z /, ''));
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:not )?ok \d+ - (.*?)(?: # (?:SKIP|TODO).*)?$/.exec(lines[i]);
    if (!m) continue;
    let ms = null;
    for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) { const d = /^ {2}duration_ms: ([\d.]+)/.exec(lines[j]); if (d) { ms = Number(d[1]); break; } }
    if (ms === null) continue;
    const f = owner(m[1]);
    if (!f) { unmatched.add(m[1]); continue; }
    sums[f] = (sums[f] ?? 0) + ms / 1000;
  }
  for (const [f, s] of Object.entries(sums)) best[f] = Math.max(best[f] ?? 0, s);
}
for (const n of unmatched) console.error(`unmatched: ${n}`);
const missing = files.filter((f) => !(f in best));
for (const f of missing) console.error(`no timing: ${f}`);
const out = { run, source: `sum of each file's top-level test durations (duration_ms), largest across jobs, from test.yml run ${run}`, files: Object.fromEntries(files.filter((f) => f in best).map((f) => [f, Math.round(best[f] * 10) / 10])) };
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
