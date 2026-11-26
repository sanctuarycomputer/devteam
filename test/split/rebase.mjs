#!/usr/bin/env node
// split --rebase (cutover-tree@1, "Work in flight"): carry a branch begun on the single-file CLI onto
// a tree whose CLI is in modules. It splits the branch's base and head into top-level items, and for
// each declaration the branch changed, added or removed, makes that change in the module of the tree
// that holds it, then regenerates the imports regions of the modules it touched. Other files the
// branch changed are applied as a patch; its changes to the old pages are listed as page work for an
// apps carry-over ticket, never applied. Anything it can't carry exactly is a conflict, named, and
// then nothing is written.
//   node test/split/rebase.mjs <branch> --onto <tree commit> [--name <new branch>] [--base <sha>]
// Options: --repo <dir> (default: this checkout), --split-dir <dir> (where manifest*.json are;
// default: this folder), --json. The new branch (default <branch>-modules) is one commit on the tree
// commit; it is made with git plumbing and a temporary index, so no work tree or index is touched.
// Exit 0 carried (the branch made), 1 conflicts (each named; nothing written), 2 refused.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { items } from './lib/js.mjs';
import { build, importLines, mentioned, parseImport, region, strip } from './lib/split.mjs';
import { readModule } from './lib/verify.mjs';

// The old pages the cutover tree deletes (cutover-tree@1): a change to one is apps work.
export const PAGES = ['docs/devteam/dashboard/index.html', 'docs/devteam/dashboard/hub.html', 'docs/devteam/dashboard/canvas.html', 'docs/devteam/dashboard/browser.html', 'docs/devteam/dashboard/devteam-ui.js'];

const keyOf = (it) => (it.kind === 'decl' ? it.names.join(',') : it.kind === 'mark' ? `marker ${it.names[0]}` : it.kind === 'head' ? '(head)' : `(${it.kind})`);
const linesOf = (L, it) => L.lines.slice(it.from - 1, it.to);
// a declaration's lines with export taken off its own line
const bareLines = (L, it) => { const ls = linesOf(L, it); if (it.kind === 'decl') ls[it.line - it.from] = ls[it.line - it.from].replace(/^export\s+/, ''); return ls; };
const exported = (L, it) => { const ls = bareLines(L, it); if (it.kind === 'decl') ls[it.line - it.from] = `export ${ls[it.line - it.from]}`; return ls; };
const byKey = (L) => { const m = new Map(); for (const it of L.items) { const k = keyOf(it); if (!m.has(k)) m.set(k, []); m.get(k).push(it); } return m; };
const label = (it) => (it.kind === 'decl' ? it.names.join(', ') : keyOf(it));

// The plan for one manifest source: base and head texts, the tree's modules ({ file, text }), the
// manifest. Pure. { modules: Map(file -> new text), carried: [..], conflicts: [..] }.
export function carry(baseSrc, headSrc, M, treeModules) {
  const conflicts = [];
  const carried = [];
  const sb = strip(baseSrc), sh = strip(headSrc);
  const B = items(sb.text), H = items(sh.text);
  for (const L of [B, H]) for (const it of L.items) if (it.unread) conflicts.push(`${label(it)}: binds names the scanner can't read whole (${L === B ? 'base' : 'head'})`);
  // a top-level statement outside every declaration, added or removed
  const count = new Map();
  for (const s of B.statements) count.set(s.text, (count.get(s.text) ?? 0) - 1);
  for (const s of H.statements) count.set(s.text, (count.get(s.text) ?? 0) + 1);
  for (const [L, sign, verb] of [[H, 1, 'adds'], [B, -1, 'removes']]) for (const s of L.statements) {
    if (Math.sign(count.get(s.text)) !== sign) continue;
    count.set(s.text, count.get(s.text) - sign);
    conflicts.push(`${s.item ? label(s.item) : '(head)'}: the branch ${verb} a top-level statement outside every declaration, after it: ${s.text.slice(0, 80)}`);
  }
  const bk = byKey(B), hk = byKey(H);
  // the tree's items, by key: { file, U, it }
  const tree = new Map();
  const mods = treeModules.map(({ file, text }) => {
    const { region: r, body } = readModule(text);
    const U = items(body.length ? `${body.join('\n')}\n` : '');
    const m = { file, region: r, U, segs: U.items.map((it) => ({ key: keyOf(it), lines: linesOf(U, it), it })), touched: false };
    for (const it of U.items) { const k = keyOf(it); if (!tree.has(k)) tree.set(k, []); tree.get(k).push({ m, it }); }
    return m;
  });
  const one = (k, what) => {
    const t = tree.get(k) ?? [];
    if (t.length !== 1) { conflicts.push(`${k}: ${what} is ${t.length ? `in ${t.length} places in the tree (${t.map((x) => x.m.file).join(', ')})` : 'in no module of the tree'}`); return null; }
    return t[0];
  };
  const same = (k, t, b) => {
    if (bareLines(t.m.U, t.it).join('\n') === bareLines(B, b).join('\n')) return true;
    conflicts.push(`${k}: the tree's copy in ${t.m.file} differs from the branch's base (an overlay override or rule site, or a change on main since the base); carry it by hand`);
    return false;
  };
  const removedNames = new Set(), addedNames = new Set();
  const keys = [...new Set([...bk.keys(), ...hk.keys()])];
  const edits = [];
  for (const k of keys) {
    const b = bk.get(k) ?? [], h = hk.get(k) ?? [];
    if (b.length > 1 || h.length > 1) {
      if (b.map((x) => linesOf(B, x).join('\n')).join('\0') !== h.map((x) => linesOf(H, x).join('\n')).join('\0')) conflicts.push(`${k}: appears more than once in the source, and the branch changes it`);
      continue;
    }
    const [bi] = b, [hi] = h;
    if (bi && hi && linesOf(B, bi).join('\n') === linesOf(H, hi).join('\n')) continue;
    const it = hi ?? bi;
    if (it.kind !== 'decl') { conflicts.push(`${k}: the branch changes a part of the source that is no declaration`); continue; }
    if (bi && hi) edits.push({ k, kind: 'changed', bi, hi });
    else if (bi) edits.push({ k, kind: 'removed', bi });
    else edits.push({ k, kind: 'added', hi });
  }
  for (const e of edits) {
    if (e.kind === 'changed' || e.kind === 'removed') {
      const t = one(e.k, `the declaration the branch ${e.kind === 'changed' ? 'changes' : 'removes'}`);
      if (!t || !same(e.k, t, e.bi)) continue;
      const seg = t.m.segs.find((s) => s.it === t.it);
      if (e.kind === 'changed') { seg.lines = exported(H, e.hi); seg.hi = e.hi; seg.bi = e.bi; }
      else { seg.lines = []; for (const nm of e.bi.names) removedNames.add(nm); }
      t.m.touched = true;
      carried.push({ declaration: e.k, change: e.kind, module: t.m.file });
    }
  }
  // an added declaration goes to the module a split of the head puts it in, after the nearest item
  // before it in the head that the base and that module hold (first in the module if none)
  const hb = build(headSrc, M);
  const modOf = new Map();
  for (const m of hb.modules) for (const it of m.items) modOf.set(keyOf(it), m.file);
  const byFile = new Map(mods.map((m) => [m.file, m]));
  for (const e of edits.filter((x) => x.kind === 'added')) {
    if (tree.has(e.k)) { conflicts.push(`${e.k}: the branch adds it, and the tree already has it`); continue; }
    const target = byFile.get(modOf.get(e.k));
    if (!target) { conflicts.push(`${e.k}: the branch adds it, and a split of the head puts it in ${modOf.get(e.k) ?? 'no module'}, which the tree lacks`); continue; }
    const at = H.items.indexOf(e.hi);
    let anchor = null;
    for (let j = at - 1; j >= 0 && !anchor; j--) {
      const k = keyOf(H.items[j]);
      if (modOf.get(k) !== target.file) break;
      const t = tree.get(k) ?? [];
      if (bk.has(k) && t.length === 1 && t[0].m === target) anchor = t[0];
    }
    let j = anchor ? target.segs.findIndex((x) => x.it === anchor.it) + 1 : 0;
    while (j < target.segs.length && target.segs[j].added) j++;
    target.segs.splice(j, 0, { key: e.k, lines: exported(H, e.hi), added: true, hi: e.hi });
    target.touched = true;
    for (const nm of e.hi.names) addedNames.add(nm);
    carried.push({ declaration: e.k, change: 'added', module: target.file });
  }
  if (conflicts.length) return { modules: new Map(), carried, conflicts };
  // regenerate the imports regions of every module touched, or that names a name added or removed
  const owner = new Map();
  const parsed = mods.map((m) => {
    const text = m.segs.flatMap((s) => s.lines);
    const U = items(text.length ? `${text.join('\n')}\n` : '');
    const own = new Set(U.items.flatMap((x) => (x.kind === 'decl' ? x.names : [])));
    for (const nm of own) owner.set(nm, m.file);
    return { m, body: text, U, own };
  });
  // a carried declaration that makes a site an overlay rule rewrites (cutover-tree@1) is a conflict:
  // a new import.meta, a new assignment to a let or var another module holds, or a declaration that
  // runs at load (no function) newly naming another module's declaration
  const lets = new Map();
  for (const p of parsed) for (const it of p.U.items) if (it.kind === 'decl' && (it.decl === 'let' || it.decl === 'var')) for (const nm of it.names) lets.set(nm, p.m.file);
  const ASSIGN = /([A-Za-z_$][\w$]*)\s*(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*\/%&|^])?=(?![=>])|([A-Za-z_$][\w$]*)\s*(?:\+\+|--)|(?:\+\+|--)\s*([A-Za-z_$][\w$]*)/g;
  const code = (L, it) => L.codeLines.slice(it.from - 1, it.to);
  const sites = (cl, file) => {
    const meta = cl.join('\n').split(/\bimport\s*\.\s*meta\b/).length - 1;
    const assigns = [];
    for (const c of cl) for (const x of c.matchAll(ASSIGN)) {
      const nm = x[1] ?? x[2] ?? x[3];
      const at = x.index + (x[0].indexOf(nm));
      if (c[at - 1] === '.' && c[at - 2] !== '.') continue;
      if (lets.has(nm) && lets.get(nm) !== file) assigns.push(nm);
    }
    const reads = [...mentioned(cl)].filter((nm) => owner.has(nm) && owner.get(nm) !== file);
    return { meta, assigns, reads };
  };
  for (const p of parsed) for (const sg of p.m.segs) {
    if (!sg.hi) continue;
    const h = sites(code(H, sg.hi), p.m.file);
    const b = sg.bi ? sites(code(B, sg.bi), p.m.file) : { meta: 0, assigns: [], reads: [] };
    const more = (a, c) => { const n = new Map(); for (const x of c) n.set(x, (n.get(x) ?? 0) + 1); return [...new Set(a.filter((x) => { const k = n.get(x) ?? 0; n.set(x, k - 1); return k <= 0; }))]; };
    if (h.meta > b.meta) conflicts.push(`${sg.key}: the branch adds a use of import.meta, which an overlay rule rewrites; carry it by hand`);
    const as = more(h.assigns, b.assigns);
    if (as.length) conflicts.push(`${sg.key}: the branch assigns ${as.join(', ')}, a let of another module (${as.map((x) => lets.get(x)).join(', ')}), which needs the overlay's setter; carry it by hand`);
    if (sg.hi.decl !== 'function') {
      const rd = h.reads.filter((x) => !b.reads.includes(x));
      if (rd.length) conflicts.push(`${sg.key}: runs at load and the branch has it name ${rd.join(', ')}, of another module, which the load-time rule may refuse; carry it by hand`);
    }
  }
  if (conflicts.length) return { modules: new Map(), carried, conflicts };
  // the builtins: the head's imports, then every tree region's import from outside the tree's modules
  const builtins = new Map(sh.imports.map((x) => [x.local, x.line]));
  for (const p of parsed) for (const l of p.m.region ?? []) {
    let b; try { b = parseImport(l); } catch { continue; }
    for (const x of b) if (!/from '\./.test(x.line) && !builtins.has(x.local)) builtins.set(x.local, x.line);
  }
  const out = new Map();
  for (const p of parsed) {
    const used = mentioned(p.U.codeLines);
    const names = [...removedNames, ...addedNames].some((nm) => used.has(nm) || (p.m.region ?? []).some((l) => new RegExp(`\\{ (?:\\w+ as )?${nm.replace(/\$/g, '\\$')} \\}`).test(l)));
    if (!p.m.touched && !names) continue;
    if (!p.m.region) { conflicts.push(`${p.m.file}: has no generated imports region to regenerate`); continue; }
    const fresh = importLines(p.m.file, used, p.own, owner, builtins);
    // a name the old region imported and the body still uses, that the new region can't supply
    for (const l of p.m.region) {
      let b; try { b = parseImport(l); } catch { continue; }
      for (const x of b) if (used.has(x.local) && !p.own.has(x.local) && !owner.has(x.local) && !builtins.has(x.local)) conflicts.push(`${p.m.file}: still uses ${x.local}, which nothing in the tree declares or imports any more (${l})`);
    }
    const lines = [...region(fresh), ...p.body];
    out.set(p.m.file, `${lines.join('\n')}\n`);
    if (lines.length > (M.cap ?? 2000)) carried.push({ warning: `${p.m.file} is ${lines.length} lines, over the cap of ${M.cap ?? 2000}` });
  }
  if (conflicts.length) return { modules: new Map(), carried, conflicts };
  return { modules: out, carried, conflicts };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(`--${n}`);
  const say = (s) => process.stdout.write(`${s}\n`);
  const refuse = (s) => { process.stderr.write(`split --rebase: ${s}\n`); process.exit(2); };
  const opt = (n) => { const i = args.indexOf(`--${n}`); if (i < 0) return undefined; const v = args[i + 1]; if (v === undefined || v.startsWith('--')) refuse(`--${n} needs a value`); return v; };
  const OPTS = new Set(['onto', 'name', 'base', 'repo', 'split-dir']);
  const positional = args.filter((a, i) => !a.startsWith('--') && !(i && OPTS.has(args[i - 1].slice(2)) && args[i - 1].startsWith('--')));
  if (positional.length !== 1) refuse('usage: rebase.mjs <branch> --onto <tree commit> [--name <new branch>] [--base <sha>]');
  // git reads only the repository named here, never the caller's GIT_* variables (its author and
  // committer names excepted, which name the commit made)
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') || /^GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL|DATE)$/.test(k)));
  const run = (cmd, a, o = {}) => spawnSync(cmd, a, { maxBuffer: 1 << 30, encoding: 'utf8', ...o, env: { ...env, ...(o.env ?? {}) } });
  const repoTop = run('git', ['-C', here, 'rev-parse', '--show-toplevel']);
  const repo = path.resolve(opt('repo') ?? repoTop.stdout?.trim() ?? '');
  const git = (a, o) => run('git', ['-C', repo, ...a], o);
  const commit = (ref, what) => { const r = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); if (r.status !== 0) refuse(`${what} ${ref} is not a commit in ${repo}`); return r.stdout.trim(); };
  const branch = positional[0];
  const head = commit(branch, 'the branch');
  const ontoArg = opt('onto');
  if (!ontoArg) refuse('--onto <tree commit> is required');
  const onto = commit(ontoArg, '--onto');
  let base;
  if (opt('base')) base = commit(opt('base'), '--base');
  else {
    const mb = git(['merge-base', head, onto]);
    if (mb.status !== 0) refuse(`${branch} and ${ontoArg} share no commit; give the branch's base with --base`);
    base = mb.stdout.trim();
  }
  if (git(['merge-base', '--is-ancestor', base, head]).status !== 0) refuse(`--base ${base.slice(0, 8)} is not an ancestor of ${branch}`);
  const name = opt('name') ?? `${branch.replace(/^refs\/heads\//, '')}-modules`;
  if (git(['check-ref-format', '--branch', name]).status !== 0) refuse(`${name} is not a branch name`);
  if (git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]).status === 0) refuse(`the branch ${name} exists; give another with --name`);
  const splitDir = path.resolve(opt('split-dir') ?? here);
  const manifests = fs.readdirSync(splitDir).filter((f) => /^manifest.*\.json$/.test(f)).sort().map((f) => JSON.parse(fs.readFileSync(path.join(splitDir, f), 'utf8')));
  if (!manifests.length) refuse(`no manifest*.json in ${splitDir}`);
  const show = (sha, file) => { const x = git(['show', `${sha}:${file}`]); return x.status === 0 ? x.stdout : null; };
  const lsTree = (sha, dir) => git(['ls-tree', '-r', '--name-only', sha, '--', dir]).stdout.split('\n').filter(Boolean);

  const changed = git(['diff', '--name-only', '--no-renames', '-z', base, head]).stdout.split('\0').filter(Boolean);
  const sources = new Set(manifests.map((M) => M.source));
  const conflicts = [], carried = [], pages = [];
  const write = new Map();
  for (const M of manifests) {
    if (!changed.includes(M.source)) continue;
    const bs = show(base, M.source), hs = show(head, M.source);
    if (bs === null || hs === null) { conflicts.push(`${M.source}: the branch ${bs === null ? 'adds' : 'deletes'} it`); continue; }
    const files = lsTree(onto, M.dir).filter((f) => f.endsWith('.mjs'));
    if (!files.length) { conflicts.push(`${M.source}: the tree has no modules under ${M.dir}`); continue; }
    const r = carry(bs, hs, M, files.map((file) => ({ file, text: show(onto, file) })));
    conflicts.push(...r.conflicts);
    carried.push(...r.carried.map((c) => ({ source: M.source, ...c })));
    for (const [f, t] of r.modules) write.set(f, t);
  }
  const rest = [];
  for (const f of changed) {
    if (sources.has(f)) continue;
    if (PAGES.includes(f)) pages.push(f); else rest.push(f);
  }
  const report = { branch, base, head, onto, name, carried, applied: rest, pages, conflicts };
  const print = (made) => {
    if (flag('json')) { say(JSON.stringify({ ...report, made: made ?? null }, null, 2)); return; }
    say(`${branch} (${base.slice(0, 8)}..${head.slice(0, 8)}) onto ${onto.slice(0, 8)}:`);
    for (const c of carried) say(c.warning ? `  warning: ${c.warning}` : `  carried: ${c.declaration} (${c.change}) in ${c.module}`);
    for (const f of rest) say(`  applied: ${f}`);
    for (const f of pages) say(`  page work for an apps carry-over ticket, not applied: ${f}`);
    for (const c of conflicts) say(`  conflict: ${c}`);
    say(made ? `made ${name} at ${made}` : 'conflicts: nothing written');
  };
  if (conflicts.length) { print(); process.exit(1); }

  // no process.exit inside: it would skip the finally that removes the temporary index
  class Stop extends Error {}
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'split-rebase-'));
  try {
    const idx = { env: { GIT_INDEX_FILE: path.join(tmp, 'index') } };
    const must = (r, what) => { if (r.status !== 0) { process.stderr.write(`split --rebase: ${what} failed: ${r.stderr}\n`); process.exitCode = 2; throw new Stop(); } return r.stdout; };
    must(git(['read-tree', onto], idx), 'git read-tree');
    if (rest.length) {
      const patch = must(git(['diff', '--binary', '--no-renames', '--full-index', base, head, '--', ...rest]), 'git diff');
      const ap = git(['apply', '--cached', '--whitespace=nowarn', '-'], { ...idx, input: patch });
      if (ap.status !== 0) {
        report.conflicts.push(...rest.map((f) => `${f}: the branch's change doesn't apply to the tree (${ap.stderr.trim().split('\n')[0]})`));
        print(); process.exitCode = 1; throw new Stop();
      }
    }
    for (const [f, t] of write) {
      const blob = must(git(['hash-object', '-w', '--stdin'], { input: t }), 'git hash-object').trim();
      const mode = git(['ls-tree', onto, '--', f]).stdout.split(' ')[0] || '100644';
      must(git(['update-index', '--add', '--cacheinfo', `${mode},${blob},${f}`], idx), 'git update-index');
    }
    const treeSha = must(git(['write-tree'], idx), 'git write-tree').trim();
    const msg = `${branch} carried onto the modules by split --rebase\n\nBase ${base}, head ${head}, onto ${onto}.${pages.length ? `\nPage work for an apps carry-over ticket, not applied: ${pages.join(', ')}.` : ''}\n`;
    const c = must(git(['commit-tree', treeSha, '-p', onto], { input: msg }), 'git commit-tree').trim();
    must(git(['update-ref', `refs/heads/${name}`, c, '']), 'git update-ref');
    print(c);
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
