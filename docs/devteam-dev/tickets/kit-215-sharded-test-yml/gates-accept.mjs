// kit-215 (ruling m-20261115-205742695): devteam-dev's kit-merge-pr gate accepts the new job set.
// Feeds saved `gh pr checks 279 --json name,state,bucket` outputs to its checksRefusal:
//   node gates-accept.mjs <green.json> <failing.json>
// exits 0 only if the green head's checks (17 test.yml jobs among them) are accepted and the failing
// head's are refused, naming kit (18, chain) and tests.
import fs from 'node:fs';
import { checksRefusal } from '/data/home/code/devteam-dev/scripts/kit-merge-pr.mjs';

const [green, failing] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
const want = ['tests', ...[18, 20, 22, 24].flatMap((n) => ['chain', 'rest 1/2', 'rest 2/2', ...(n >= 22 ? ['chrome 1/2', 'chrome 2/2'] : [])].map((p) => `kit (${n}, ${p})`))];
let ok = true;
const check = (cond, msg) => { console.log(`${cond ? 'ok' : 'NOT OK'}: ${msg}`); if (!cond) ok = false; };

check(want.length === 17, `17 test.yml checks expected (${want.length})`);
for (const [label, list] of [['green', green], ['failing', failing]]) {
  const names = new Set(list.map((c) => c.name));
  check(want.every((n) => names.has(n)), `${label}: all 17 test.yml checks present (${list.length} checks in all)`);
}
const g = checksRefusal(green);
check(g === null, `green head accepted (checksRefusal: ${JSON.stringify(g)})`);
const f = checksRefusal(failing);
check(typeof f === 'string' && f.includes('kit (18, chain)') && f.includes('tests'), `failing head refused: ${f}`);
process.exit(ok ? 0 : 1);
