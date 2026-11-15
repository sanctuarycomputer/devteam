// Pulls a piece of .github/workflows/test-stress.yml out as plain text, for the check scripts.
//   node extract.mjs <yml> between '<start line>' '<end line>'   lines strictly between the two
//                                                                 (matched trimmed), dedented by
//                                                                 the start line's indent
//   node extract.mjs <yml> run-blocks                             every run: block's text, the
//                                                                 one-line form included
import fs from 'node:fs';

const [yml, mode, start, end] = process.argv.slice(2);
const lines = fs.readFileSync(yml, 'utf8').split('\n');
const indentOf = (l) => l.length - l.trimStart().length;

if (mode === 'between') {
  const i = lines.findIndex((l) => l.trim() === start);
  if (i < 0) { console.error(`extract: no line ${JSON.stringify(start)}`); process.exit(2); }
  const j = lines.findIndex((l, k) => k > i && l.trim() === end);
  if (j < 0) { console.error(`extract: no line ${JSON.stringify(end)} after the start`); process.exit(2); }
  const ind = indentOf(lines[i]);
  process.stdout.write(lines.slice(i + 1, j).map((l) => l.slice(Math.min(ind, indentOf(l)))).join('\n') + '\n');
} else if (mode === 'run-blocks') {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const ind = indentOf(lines[i]);
    if (!/^[|>][-+]?\s*$/.test(m[2])) { out.push(m[2]); continue; }
    for (let k = i + 1; k < lines.length && (lines[k].trim() === '' || indentOf(lines[k]) > ind); k++) out.push(lines[k]);
  }
  process.stdout.write(out.join('\n') + '\n');
} else {
  console.error('extract: mode is between or run-blocks');
  process.exit(2);
}
