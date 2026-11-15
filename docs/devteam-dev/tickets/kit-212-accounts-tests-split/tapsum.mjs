// kit-212: from a node --test TAP output (one file), the file's duration_ms and the sum of its
// top-level tests' duration_ms.   node tapsum.mjs <tap.out>
import fs from 'node:fs';
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n');
let sum = 0, n = 0, top = 0, file = null, pend = false, pass = null, fail = null;
for (const l of lines) {
  if (/^(not )?ok \d+ - /.test(l)) { n++; pend = true; continue; }
  const d = /^ {2}duration_ms: ([\d.]+)$/.exec(l);
  if (d && pend) { const s = Number(d[1]) / 1000; sum += s; top = Math.max(top, s); pend = false; continue; }
  const t = /^# duration_ms ([\d.]+)$/.exec(l); if (t) file = Number(t[1]) / 1000;
  const p = /^# pass (\d+)$/.exec(l); if (p) pass = Number(p[1]);
  const f = /^# fail (\d+)$/.exec(l); if (f) fail = Number(f[1]);
}
console.log(`tests ${n}, pass ${pass}, fail ${fail}, file ${file?.toFixed(1)} s, sum ${sum.toFixed(1)} s, gap ${(file - sum).toFixed(1)} s, longest ${top.toFixed(1)} s`);
