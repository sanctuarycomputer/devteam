import fs from 'node:fs';
const F = 'docs/devteam/dashboard/index.html';
const L = fs.readFileSync(F, 'utf8').split('\n');
const s = L.findIndex((l) => l.startsWith('/* term-js start */')), e = L.findIndex((l) => l.startsWith('/* term-js end */'));
const block = L.splice(s, e - s + 1);
const te = L.findIndex((l) => l.startsWith('/* threads-layer end */'));
L.splice(te + 1, 0, ...block);
fs.writeFileSync(F, L.join('\n'));
