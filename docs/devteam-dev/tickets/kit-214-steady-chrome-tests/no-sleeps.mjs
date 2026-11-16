// node no-sleeps.mjs: done-when 2's check. For each named test, its body (from its test( line to the
// next top-level "});"), and every fixed wait in it: `setTimeout(r, <n>)` or `setTimeout(w, <n>)`.
// Exits 1 if any is found. Timers inside page-side fixture strings are outside test bodies.
import fs from 'node:fs';
const named = [
  ['test/dashboard.test.mjs', 'presses: the page answers before the server'],
  ['test/dashboard.test.mjs', 'typing in the dashboard: a refresh never takes the field'],
  ['test/dashboard.test.mjs', 'threads on the dashboard page: Shift and point'],
  ['test/dashboard.test.mjs', "the viewer's reload button says when a newer version is ready"],
  ['test/dashboard.test.mjs', 'pins on an artifact: where its lens says'],
  ['test/pane-question.answer.test.mjs', 'a question that goes as the key is sent'],
];
let bad = 0;
for (const [file, start] of named) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const i = lines.findIndex((l) => /^test\(/.test(l) && l.includes(start));
  if (i < 0) { console.log(`MISSING ${file}: ${start}`); bad = 1; continue; }
  let j = i; while (j < lines.length && !/^\}\);\s*$/.test(lines[j])) j++;
  const hits = lines.slice(i, j + 1).map((l, k) => [i + k + 1, l]).filter(([, l]) => /setTimeout\(\s*[rw]\s*,\s*\d/.test(l) && !/^\s*\/\//.test(l));
  console.log(`${hits.length ? 'FOUND' : 'ok   '} ${file}:${i + 1}-${j + 1} ${start}${hits.map(([n, l]) => `\n  ${n}: ${l.trim()}`).join('')}`);
  if (hits.length) bad = 1;
}
process.exit(bad);
