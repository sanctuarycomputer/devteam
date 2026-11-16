// kit-211 done-when 1: the sorted top-level test names of a file at the base against those of its
// split files at the head.
//   node names.mjs <base-ref> <head-ref> <name>…   (e.g. machine next-step)
// For each name: test/<name>.test.mjs at the base, test/<name>.*.test.mjs (and test/<name>.test.mjs
// if still there) at the head. Prints each list, the diff, and the counts; exits 1 on any difference.
import { execFileSync } from 'node:child_process';

const [base, head, ...subjects] = process.argv.slice(2);
if (!base || !head || !subjects.length) { console.error('usage: node names.mjs <base-ref> <head-ref> <name>…'); process.exit(2); }
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const filesAt = (ref, name) => git('ls-tree', '--name-only', ref, 'test/').split('\n').filter((f) => f === `test/${name}.test.mjs` || (f.startsWith(`test/${name}.`) && f.endsWith('.test.mjs')));
// a top-level test( call at the start of a line, its name a plain string literal
const RE = /^test\(\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.)*`)/gm;
const namesIn = (src) => { const out = []; let m; while ((m = RE.exec(src))) out.push(Function(`return ${m[1]}`)()); return out; };
// every test( at a line start, literal or not: a name this script can't read fails it, never passes it
const callsIn = (src) => (src.match(/^test\(/gm) ?? []).length;

let bad = false;
for (const name of subjects) {
  const read = (ref) => {
    const files = filesAt(ref, name);
    const per = files.map((f) => { const src = git('show', `${ref}:${f}`); const n = namesIn(src); if (n.length !== callsIn(src)) { console.log(`!! ${ref}:${f}: ${callsIn(src)} test( calls, ${n.length} names read`); bad = true; } return [f, n]; });
    return { files, per, all: per.flatMap(([, n]) => n).sort() };
  };
  const b = read(base), h = read(head);
  console.log(`## ${name}\n\nbase ${base}: ${b.files.join(', ')} (${b.all.length} tests)\nhead ${head}: ${h.files.join(', ')} (${h.all.length} tests)\n`);
  for (const [f, n] of h.per) console.log(`${f}: ${n.length}`);
  console.log('\nsorted names at the head:');
  for (const n of h.all) console.log(`  ${n}`);
  const onlyBase = b.all.filter((n, i) => b.all.indexOf(n) === i && b.all.filter((x) => x === n).length > h.all.filter((x) => x === n).length);
  const onlyHead = h.all.filter((n, i) => h.all.indexOf(n) === i && h.all.filter((x) => x === n).length > b.all.filter((x) => x === n).length);
  console.log(`\ndiff: ${onlyBase.length + onlyHead.length === 0 ? 'none' : ''}`);
  for (const n of onlyBase) console.log(`- ${n}`);
  for (const n of onlyHead) console.log(`+ ${n}`);
  console.log('');
  if (onlyBase.length || onlyHead.length || b.all.length !== h.all.length) bad = true;
}
process.exit(bad ? 1 : 0);
