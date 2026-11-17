// kit-212: each test/accounts.test.mjs top-level test's duration in a test.yml job log (spec
// reporter: "✔ <name> (<ms>ms)" at the start of a line).
//   node specdur.mjs <job.log> [test file]     prints a table in source order and the sum
import fs from 'node:fs';

const [log, file = 'test/accounts.test.mjs'] = process.argv.slice(2);
const RE = /^test\(\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.)*`)/gm;
const src = fs.readFileSync(file, 'utf8');
const names = []; let m;
while ((m = RE.exec(src))) names.push(Function(`return ${m[1]}`)());
const lines = fs.readFileSync(log, 'utf8').split('\n').map((l) => l.replace(/^\S+Z /, ''));
let sum = 0;
console.log('| s | test |\n|---|---|');
for (const n of names) {
  const hit = lines.map((l) => /^([✔✖﹣]) (.*) \(([\d.]+)ms\)( # SKIP.*)?$/.exec(l)).filter((x) => x && x[2] === n);
  const s = hit.length === 1 ? Number(hit[0][3]) / 1000 : null;
  if (s !== null) sum += s;
  console.log(`| ${s === null ? `? (${hit.length} matches)` : s.toFixed(1)} | ${n} |`);
}
console.log(`\n${names.length} tests, sum ${sum.toFixed(1)} s`);
