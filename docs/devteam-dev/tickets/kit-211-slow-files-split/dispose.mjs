// kit-211: fill a review record's empty Disposition cell, keeping the row's shape (devteam.mjs dispose
// looks only under docs/devteam/project; this ticket's records live in docs/devteam-dev/tickets/).
//   node dispose.mjs <record.md> <finding id> "<fixed | wont-fix … | wrong …>"
import fs from 'node:fs';

const [file, fid, text] = process.argv.slice(2);
if (!file || !fid || !/^(fixed|wont-fix|wrong)\b/.test(text ?? '') || /[|\n]/.test(text)) { console.error('usage: node dispose.mjs <record.md> <id> "fixed|wont-fix …|wrong …" (one line, no |)'); process.exit(2); }
const lines = fs.readFileSync(file, 'utf8').split('\n');
const cells = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());
let disp = -1, width = 0, done = false;
for (let k = 0; k < lines.length && !done; k++) {
  if (!lines[k].trim().startsWith('|')) continue;
  const c = cells(lines[k]);
  if (c.map((x) => x.toLowerCase()).includes('disposition')) { disp = c.map((x) => x.toLowerCase()).indexOf('disposition'); width = c.length; continue; }
  if (c[0] !== fid || disp < 0) continue;
  if (c.length !== width) { console.error(`${fid}: ${c.length} cells, header has ${width}`); process.exit(1); }
  if (c[disp]) { console.error(`${fid} already disposed: ${c[disp]}`); process.exit(1); }
  c[disp] = text;
  lines[k] = `| ${c.join(' | ')} |`;
  done = true;
}
if (!done) { console.error(`no row ${fid}`); process.exit(1); }
fs.writeFileSync(file, lines.join('\n'));
