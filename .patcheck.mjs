import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const plan = fs.readFileSync('/data/home/code/devteam-dev/.worktrees/records-kit-614-terminal-tabs/docs/devteam/project/tickets/kit-614-terminal-tabs/plan.md', 'utf8');
const files = { 'test/dashboard-terminal-tabs.test.mjs': null, 'test/dashboard-threads-sidebar.test.mjs': null };
for (const f of Object.keys(files)) files[f] = [...fs.readFileSync(`/data/home/code/devteam-dev/.worktrees/kit-614-scratch/${f}`, 'utf8').matchAll(/^test\((['"])(.*?)\1,/gm)].map((m) => m[2].replace(/\\'/g, "'"));
let bad = 0;
for (const m of plan.matchAll(/^\| (C\w+) \| (T\d) \| `(node --test --test-name-pattern=.*? (test\/\S+))`/gm)) {
  const [, id, , cmd, f] = m;
  try { execFileSync('bash', ['-n', '-c', cmd]); } catch { console.log(id, 'bash syntax'); bad++; continue; }
  const pat = execFileSync('bash', ['-c', `set -- ${cmd.replace(/^node --test /, '')}; printf %s "\${1#--test-name-pattern=}"`], { encoding: 'utf8' });
  const hits = files[f].filter((n) => new RegExp(pat).test(n));
  if (hits.length !== 1) { console.log(id, pat, hits.length); bad++; }
}
console.log('bad', bad);
