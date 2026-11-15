// kit-211 done-whens 2-3: per-file and per-test seconds from a GitHub job log of
// `node test/run.mjs` (each file's TAP under a "# <file>" header, then the runner's summary).
//   node tapdur.mjs <job.log>     prints a markdown table per file: its top-level tests, slowest first
import fs from 'node:fs';

const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').map((l) => l.replace(/^\S+Z /, ''));
const files = new Map();
let file = null, last = null, depth0 = false;
for (const l of lines) {
  const h = /^# (test\/\S+\.test\.mjs)$/.exec(l);
  if (h) { file = h[1]; files.set(file, { tests: [], wall: null }); continue; }
  const s = /^(test\/\S+\.test\.mjs)\s+([\d.]+)\s+(\S.*)$/.exec(l);
  if (s && files.has(s[1])) { files.get(s[1]).wall = Number(s[2]); files.get(s[1]).result = s[3]; continue; }
  if (!file) continue;
  const t = /^(not ok|ok) \d+ - (.*?)(\s+# SKIP.*)?$/.exec(l);
  if (t) { last = { name: t[2], ok: t[1] === 'ok', skip: !!t[3], s: null }; files.get(file).tests.push(last); depth0 = true; continue; }
  const d = /^ {2}duration_ms: ([\d.]+)$/.exec(l);
  if (d && last && depth0 && last.s === null) { last.s = Number(d[1]) / 1000; depth0 = false; }
}
let over = 0;
for (const [f, { tests, wall, result }] of files) {
  const sum = tests.reduce((a, t) => a + (t.s ?? 0), 0);
  const top = [...tests].sort((a, b) => (b.s ?? 0) - (a.s ?? 0));
  over += tests.filter((t) => t.s > 30).length;
  console.log(`### ${f}: wall ${wall} s (${result}), ${tests.length} tests, sum ${sum.toFixed(1)} s, longest ${top[0]?.s?.toFixed(1)} s\n`);
  console.log('| s | test |\n|---|---|');
  for (const t of top) console.log(`| ${t.s === null ? '?' : t.s.toFixed(1)} | ${t.skip ? '(skipped) ' : ''}${t.ok ? '' : 'NOT OK '}${t.name.slice(0, 140)} |`);
  console.log('');
}
console.log(`tests over 30 s: ${over}; files over 60 s wall: ${[...files.values()].filter((x) => x.wall > 60).length}`);
