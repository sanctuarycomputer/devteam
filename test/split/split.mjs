#!/usr/bin/env node
// The split tool (cutover-tree@1). At any commit, generate the kit with its CLI in modules, prove a
// generated tree moved every declaration unchanged, or count what a split needs.
//   node test/split/split.mjs --at <sha> --out <dir>            write a full copy of the kit, split
//   node test/split/split.mjs --verify --at <sha> --tree <dir>  check a tree against the commit
//   node test/split/split.mjs --count --at <sha>                the sizing count, as markdown
// Options: --repo <dir> (default: this checkout), --split-dir <dir> (where manifest*.json are;
// default: this folder), --json. Exit 0 clean, 1 problems (each named), 2 refused (nothing written).
// Node 18+, built-ins only; needs git and tar. It writes nothing outside --out.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './lib/split.mjs';
import { count } from './lib/count.mjs';
import { kitParts, partsCount, partsNames, verify } from './lib/verify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
// an option's value is the word after it, never another option
const opt = (n) => { const i = args.indexOf(`--${n}`); if (i < 0) return undefined; const v = args[i + 1]; if (v === undefined || v.startsWith('--')) refuse(`--${n} needs a value`); return v; };
const say = (s) => process.stdout.write(`${s}\n`);
const refuse = (s) => { process.stderr.write(`split: ${s}\n`); process.exit(2); };
// git reads only the repository and folders named here, never the caller's GIT_* variables
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const run = (cmd, a, o = {}) => spawnSync(cmd, a, { maxBuffer: 1 << 30, env, ...o });
const git = (repo, a, o) => run('git', ['-C', repo, ...a], o);

const repoTop = git(here, ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
const repo = path.resolve(opt('repo') ?? repoTop.stdout?.trim() ?? '');
const splitDir = path.resolve(opt('split-dir') ?? here);
const at = opt('at');
if (!at) refuse('--at <sha> is required');
const r = git(repo, ['rev-parse', '--verify', '--quiet', `${at}^{commit}`], { encoding: 'utf8' });
if (r.status !== 0) refuse(`--at ${at} is not a commit in ${repo}`);
const sha = r.stdout.trim();
const manifests = fs.readdirSync(splitDir).filter((f) => /^manifest.*\.json$/.test(f)).sort()
  .map((f) => ({ name: f, M: JSON.parse(fs.readFileSync(path.join(splitDir, f), 'utf8')) }));
if (!manifests.length) refuse(`no manifest*.json in ${splitDir}`);
const show = (file) => { const x = git(repo, ['show', `${sha}:${file}`], { encoding: 'utf8' }); return x.status === 0 ? x.stdout : null; };
const sources = manifests.map(({ name, M }) => {
  const src = show(M.source);
  if (src === null) refuse(`${name}: ${M.source} is not in ${sha}`);
  return { name, M, src };
});

if (flag('count')) {
  for (const { M, src } of sources) say(count(build(src, M, { sha }), M, sha.slice(0, 8)));
  process.exit(0);
}

if (flag('verify')) {
  const tree = opt('tree');
  if (!tree || !fs.statSync(tree, { throwIfNoEntry: false })?.isDirectory()) refuse('--verify needs --tree <a generated tree>');
  const report = [];
  let bad = false;
  for (const { name, M, src } of sources) {
    const dir = path.join(tree, M.dir);
    const modules = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.mjs')) modules.push({ file: path.relative(tree, p).split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8') }); } };
    if (fs.existsSync(dir)) walk(dir);
    const problems = modules.length ? verify(src, M, modules) : [`no modules under ${M.dir}`];
    const kit = kitParts(src) ?? kitParts(show('docs/devteam/scripts/devteam.mjs') ?? '');
    let pc = null;
    if (!kit) problems.push(`independent count: no fileParts at ${sha}`);
    else {
      for (const x of partsNames(kit, src, M.source)) problems.push(`fileParts reads a declaration the scanner doesn't: ${x}`);
      pc = partsCount(kit, src, M.source, modules);
      if (!pc.equal) problems.push(`independent count: fileParts finds ${pc.source} declaration leaves in the source and ${pc.tree} in the tree; only in the source: ${pc.onlySource.slice(0, 5).join(' | ')}; only in the tree: ${pc.onlyTree.slice(0, 5).join(' | ')}`);
    }
    if (problems.length) bad = true;
    report.push({ manifest: name, source: M.source, modules: modules.length, problems, parts: pc && { equal: pc.equal, source: pc.source, tree: pc.tree } });
  }
  if (flag('json')) say(JSON.stringify({ sha, tree: path.resolve(tree), clean: !bad, report }, null, 2));
  else for (const x of report) {
    say(`${x.source} at ${sha.slice(0, 8)}: ${x.modules} modules, ${x.problems.length ? `${x.problems.length} problems` : 'clean'}${x.parts ? `; independent count ${x.parts.equal ? 'equal' : 'differs'} (${x.parts.source} declaration leaves in the source, ${x.parts.tree} in the tree)` : ''}`);
    for (const p of x.problems) say(`  ${p}`);
  }
  process.exit(bad ? 1 : 0);
}

// write a tree
const outArg = opt('out');
if (!outArg) refuse('--out <dir> is required (or --verify, or --count)');
const out = path.resolve(outArg);
const parent = path.dirname(out);
if (!fs.statSync(parent, { throwIfNoEntry: false })?.isDirectory()) refuse(`${parent} does not exist; make it first (the tool writes nothing outside --out)`);
const st = fs.statSync(out, { throwIfNoEntry: false });
if (st && (!st.isDirectory() || fs.readdirSync(out).length)) refuse(`${out} exists and is not an empty folder`);
// inside a work tree, or inside a repository's own .git folder
const inGit = git(st ? out : parent, ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' });
if (inGit.status === 0) refuse(`${out} is inside the git repository ${inGit.stdout.trim()}; write the tree outside any checkout`);
if (!/not a git repository/.test(inGit.stderr)) refuse(`can't tell whether ${out} is inside a git repository: ${inGit.stderr.trim()}`);

const builds = sources.map(({ name, M, src }) => ({ name, M, b: build(src, M, { sha }) }));
const problems = builds.flatMap(({ name, b }) => b.problems.map((p) => `${name}: ${p}`));
const files = builds.flatMap(({ b }) => [...b.modules.map((m) => ({ file: m.file, text: m.text })), ...(b.entry ? [b.entry] : [])]);
for (const f of files) {
  const abs = path.resolve(out, f.file);
  if (!abs.startsWith(out + path.sep)) problems.push(`${f.file} is outside --out`);
}
const there = git(repo, ['ls-tree', '-r', '--name-only', sha, '--', ...new Set(files.map((f) => f.file))], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
for (const f of there) problems.push(`${f} is already in ${sha.slice(0, 8)}; the split would overwrite it`);
// a folder above a generated file that the commit tracks as a link would be written through
const above = [...new Set(files.flatMap((f) => { const p = f.file.split('/'); return p.slice(1).map((_, i) => p.slice(0, i + 1).join('/')); }))];
if (above.length) for (const l of git(repo, ['ls-tree', sha, '--', ...above], { encoding: 'utf8' }).stdout.split('\n').filter((x) => x.startsWith('120000 '))) problems.push(`${l.split('\t')[1]} is a link in ${sha.slice(0, 8)}; the split would write through it`);
if (problems.length) { for (const p of problems) process.stderr.write(`split: ${p}\n`); process.stderr.write('split: nothing written\n'); process.exit(1); }

if (!st) fs.mkdirSync(out);
const tar = git(repo, ['archive', '--format=tar', sha]);
if (tar.status !== 0) refuse(`git archive ${sha} failed: ${tar.stderr}`);
const x = run('tar', ['-x', '-f', '-', '-C', out], { input: tar.stdout });
if (x.status !== 0) { process.stderr.write(`split: tar failed: ${x.stderr}\n`); process.exit(1); }
for (const f of files) { const abs = path.resolve(out, f.file); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, f.text); }
const summary = builds.map(({ M, b }) => ({ source: M.source, dir: M.dir, entry: M.entry, modules: b.modules.length, largest: Math.max(...b.modules.map((m) => m.lines.length)) }));
if (flag('json')) say(JSON.stringify({ sha, out, summary }, null, 2));
else for (const s of summary) say(`${s.source} at ${sha.slice(0, 8)}: ${s.modules} modules in ${s.dir} (largest ${s.largest} lines), entry ${s.entry}; tree at ${out}`);
