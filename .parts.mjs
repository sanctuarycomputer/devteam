import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const KIT = '/data/home/code/devteam-dev/.worktrees/kit-614-terminal-tabs/docs/devteam/scripts/devteam.mjs';
const src = fs.readFileSync(KIT, 'utf8').split('\n');
const a = src.findIndex((l) => l.startsWith('const PART_MARK ='));
const b = src.findIndex((l, i) => i > a && l.startsWith('/* parts end */'));
const code = src.slice(a, b).join('\n') + '\nreturn { partsChanged, fileParts };';
const { partsChanged, fileParts } = new Function(code)();
const F = 'docs/devteam/dashboard/index.html';
const base = execFileSync('git', ['-C', '/data/home/code/devteam-dev/.worktrees/kit-614-scratch', 'show', `a3831dbe:${F}`], { encoding: 'utf8', maxBuffer: 1 << 27 });
const head = fs.readFileSync(`/data/home/code/devteam-dev/.worktrees/kit-614-scratch/${F}`, 'utf8');
const named = ['thListHtml', 'TH_LISTS', 'TH_TITLES', 'thDraw', 'thDecide', 'tlRoute', 'inboxTyping'].map((name) => ({ name, added: false })).concat(['term-css', 'term-js'].map((name) => ({ name, added: true })));
console.log('gap:', JSON.stringify(partsChanged(base, head, F, named)));
const H = fileParts(head, F);
console.log('regions:', JSON.stringify(H.regions.filter((r) => /term/.test(r.name))));
// moved: the term-js region placed right after threads-layer end
{
  const L = head.split('\n');
  const s = L.findIndex((l) => /^\/\* term-js start \*\//.test(l)), e = L.findIndex((l) => /^\/\* term-js end \*\//.test(l));
  console.log('term-js markers', s + 1, e + 1, JSON.stringify(L[s]), JSON.stringify(L[e]));
  if (s >= 0 && e > s) {
    const block = L.splice(s, e - s + 1);
    const te = L.findIndex((l) => /^\/\* threads-layer end \*\//.test(l));
    L.splice(te + 1, 0, ...block);
    console.log('gap moved:', JSON.stringify(partsChanged(base, L.join('\n'), F, named)));
  }
}
