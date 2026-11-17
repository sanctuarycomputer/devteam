// node times.mjs <spec-reporter log> <file…>: each file's top-level tests' times from a test.yml log
// (spec reporter: "✔ <name> (<n>ms)" at the top level), their sum and the slowest. A test's name is
// read from the file's own test('…') lines.
import fs from 'node:fs';
const [log, ...files] = process.argv.slice(2);
const lines = fs.readFileSync(log, 'utf8').split('\n').map((l) => l.replace(/^.*?\d{4}-\d\d-\d\dT[\d:.]+Z /, ''));
const top = new Map();
for (const l of lines) { const m = /^[✔✖﹣] (.*) \(([\d.]+)ms\)( # SKIP.*)?$/.exec(l); if (m) top.set(m[1], Number(m[2])); }
for (const f of files) {
  const names = [...fs.readFileSync(f, 'utf8').matchAll(/^test\((['"`])((?:\\.|(?!\1).)*)\1/gm)].map((m) => m[2].replace(/\\(.)/g, '$1'));
  const got = names.map((n) => [n, top.get(n)]);
  const missing = got.filter(([, ms]) => ms === undefined).map(([n]) => n);
  const ms = got.filter(([, v]) => v !== undefined).map(([, v]) => v);
  const slow = got.filter(([, v]) => v !== undefined).sort((a, b) => b[1] - a[1])[0];
  console.log(`${f}: ${names.length} tests, sum ${(ms.reduce((a, b) => a + b, 0) / 1000).toFixed(1)} s, slowest ${slow ? `${(slow[1] / 1000).toFixed(1)} s (${slow[0].slice(0, 70)})` : 'none'}${missing.length ? `; not found: ${missing.length}` : ''}`);
}
