// Red runs for kit-614's acceptance checks: each mutation (or main's page) applied to the scratch copy, the named
// test run alone, its first failure line recorded, the page put back. Output: .mut-results.json and a table.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const ROOT = '/data/home/code/devteam-dev/.worktrees/kit-614-scratch';
const PAGE = `${ROOT}/docs/devteam/dashboard/index.html`;
const TEST = 'test/dashboard-terminal-tabs.test.mjs';
const original = fs.readFileSync(PAGE, 'utf8');
const main = execFileSync('git', ['-C', ROOT, 'show', 'origin/main:docs/devteam/dashboard/index.html'], { encoding: 'utf8', maxBuffer: 1 << 26 });
const muts = (await import(`${ROOT}/.mut-list.mjs`)).default;
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const out = fs.existsSync(`${ROOT}/.mut-results.json`) ? JSON.parse(fs.readFileSync(`${ROOT}/.mut-results.json`, 'utf8')) : {};
try {
  for (const m of muts) {
    if (only && !only.test(m.id)) continue;
    let page;
    if (m.main) page = main;
    else {
      page = original;
      for (const [a, b] of m.edits) {
        const n = page.split(a).length - 1;
        if (n !== 1) { out[m.id] = { error: `${n} matches for ${a.slice(0, 60)}` }; page = null; break; }
        page = page.replace(a, () => b);
      }
    }
    if (page === null) continue;
    fs.writeFileSync(PAGE, page);
    try { execFileSync(`${ROOT}/.run.sh`, [m.test ?? TEST, m.pattern], { stdio: 'ignore', timeout: 600000 }); } catch {}
    const txt = fs.readFileSync(`${ROOT}/.out.txt`, 'utf8');
    const fail = txt.split('\n').find((l) => /^not ok/.test(l)) ?? null;
    const err = (txt.match(/^\s+error: (?:\|-\n\s+)?(.+)$/m) ?? [])[1] ?? null;
    const exit = (txt.match(/^exit (\d+)/m) ?? [])[1];
    out[m.id] = { fail, err, exit, at: new Date().toISOString() };
    fs.writeFileSync(PAGE, original);
    fs.writeFileSync(`${ROOT}/.mut-results.json`, JSON.stringify(out, null, 1));
    console.log(m.id, exit, err);
  }
} finally {
  fs.writeFileSync(PAGE, original);
}
