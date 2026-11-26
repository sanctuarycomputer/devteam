#!/usr/bin/env node
// The split tool (cutover-tree@1). At any commit, generate the kit with its CLI in modules, prove a
// generated tree moved every declaration unchanged, or count what a split needs.
//   node test/split/split.mjs --at <sha> --out <dir>            write a full copy of the kit, split
//   node test/split/split.mjs --verify --at <sha> --tree <dir>  check a tree against the commit
//   node test/split/split.mjs --count --at <sha>                the sizing count, as markdown
// Options: --repo <dir> (default: this checkout), --split-dir <dir> (where manifest*.json are;
// default: this folder), --json. Exit 0 clean, 1 problems (each named), 2 refused (nothing written).
// The overlay (lib/overlay.mjs) is every folder under <split dir>/overlay/, in name order. A tree with
// stale overlay items or conflicts is still written, and exits 0: the report (--json's `stale`) names
// each, and a tree with any is stale. --verify accepts the declarations the overlay names as changed.
// Node 18+, built-ins only; needs git and tar. It writes nothing outside --out.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, strip } from './lib/split.mjs';
import { count } from './lib/count.mjs';
import { items } from './lib/js.mjs';
import { applyOverlay, applyPatches, loadOverlay, regionProblems, restore } from './lib/overlay.mjs';
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

// the overlay, read before anything is written or checked: a malformed one refuses
const OV = await loadOverlay(splitDir);
if (OV.problems.length) { for (const p of OV.problems) process.stderr.write(`split: overlay: ${p}\n`); refuse('the overlay is malformed; nothing written'); }
const paths = git(repo, ['ls-tree', '-r', '--name-only', sha], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
const builds = sources.map(({ name, M, src }) => ({ name, M, src, b: build(src, M, { sha }) }));
const ov = await applyOverlay({ folders: OV.folders, ignored: OV.ignored, builds, show, paths, sha });
// the stale list --json carries (parity@1 reads it): stale items, and each conflict as one
const staleList = () => [...ov.report.stale, ...ov.report.conflicts.map((c) => ({ area: c.areas.join(' and '), kind: `${c.kind} conflict`, name: c.name, why: c.why }))];
const overlayLines = () => {
  const r = ov.report;
  const out = [`overlay: ${r.areas.length} folders (${r.areas.join(', ') || 'none'}), ${r.applied.length} applied, ${r.stale.length} stale, ${r.conflicts.length} conflicts${r.stale.length || r.conflicts.length ? '; the tree is stale' : ''}`];
  for (const a of r.applied) out.push(`  applied: ${a.area} ${a.kind} ${a.name}${a.sites.length ? ` (${a.sites.join('; ')})` : ''}`);
  for (const s of r.stale) out.push(`  stale: ${s.area} ${s.kind} ${s.name}: ${s.why}`);
  for (const c of r.conflicts) out.push(`  conflict: ${c.kind} ${c.name}, ${c.areas.join(' and ')}: ${c.why}`);
  for (const i of r.ignored) out.push(`  ignored: ${i}`);
  return out;
};

if (flag('verify')) {
  const tree = opt('tree');
  if (!tree || !fs.statSync(tree, { throwIfNoEntry: false })?.isDirectory()) refuse('--verify needs --tree <a generated tree>');
  const report = [];
  let bad = false;
  // what the overlay writes besides the generated modules (files/ files, files a rule wrote) is the
  // overlay's own, not moved declarations
  const overlayFiles = new Set([...ov.files.map((f) => f.path), ...[...ov.text.keys()].filter((f) => !ov.modules.has(f))]);
  for (const { name, M, src, b } of builds) {
    const dir = path.join(tree, M.dir);
    const modules = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.mjs')) modules.push({ file: path.relative(tree, p).split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8') }); } };
    if (fs.existsSync(dir)) walk(dir);
    const mine = modules.filter((m) => !overlayFiles.has(m.file));
    const accepted = ov.accepted.get(M.source) ?? new Set();
    const overlaid = new Map([...ov.modules].filter(([, s]) => s === M.source).map(([f]) => [f, ov.text.get(f)]));
    const back = restore(items(strip(src).text), mine, accepted, overlaid, b.builtins);
    // verify judges the restored modules; the tree's own regions and lengths are judged here
    const cap = mine.filter((m) => m.text.split('\n').length - (m.text.endsWith('\n') ? 1 : 0) > (M.cap ?? 2000)).map((m) => `over the cap: ${m.file} is ${m.text.split('\n').length - (m.text.endsWith('\n') ? 1 : 0)} lines (cap ${M.cap ?? 2000})`);
    const problems = mine.length ? [...back.problems, ...regionProblems(mine, b.builtins), ...cap, ...verify(src, M, back.modules).filter((p) => !p.startsWith('over the cap:'))] : [`no modules under ${M.dir}`];
    const kit = kitParts(src) ?? kitParts(show('docs/devteam/scripts/devteam.mjs') ?? '');
    let pc = null;
    let inTemplates = [];
    if (!kit) problems.push(`independent count: no fileParts at ${sha}`);
    else {
      // the declarations whose templates hold browser code at column 0 (a list of names; none by default)
      const tpl = M.templates ?? [];
      const tplOk = Array.isArray(tpl) && tpl.every((x) => typeof x === 'string');
      if (!tplOk) problems.push('manifest: templates must be a list of declaration names');
      const pn = partsNames(kit, src, M.source, tplOk ? tpl : []);
      for (const x of pn.refused) problems.push(`fileParts reads a declaration the scanner doesn't: ${x}`);
      for (const x of pn.unknown) problems.push(`manifest: templates names ${x}, which is not a top-level declaration`);
      inTemplates = pn.accepted;
      pc = partsCount(kit, src, M.source, back.modules);
      if (!pc.equal) problems.push(`independent count: fileParts finds ${pc.source} declaration leaves in the source and ${pc.tree} in the tree; only in the source: ${pc.onlySource.slice(0, 5).join(' | ')}; only in the tree: ${pc.onlyTree.slice(0, 5).join(' | ')}`);
    }
    if (problems.length) bad = true;
    report.push({ manifest: name, source: M.source, modules: mine.length, accepted: [...accepted].sort(), inTemplates, problems, parts: pc && { equal: pc.equal, source: pc.source, tree: pc.tree } });
  }
  if (flag('json')) say(JSON.stringify({ sha, tree: path.resolve(tree), clean: !bad, report }, null, 2));
  else for (const x of report) {
    say(`${x.source} at ${sha.slice(0, 8)}: ${x.modules} modules, ${x.problems.length ? `${x.problems.length} problems` : 'clean'}${x.parts ? `; independent count ${x.parts.equal ? 'equal' : 'differs'} (${x.parts.source} declaration leaves in the source, ${x.parts.tree} in the tree)` : ''}`);
    if (x.accepted.length) say(`  accepted as changed by the overlay: ${x.accepted.join(', ')}`);
    if (x.inTemplates.length) say(`  read by fileParts as declarations, inside a template the manifest names: ${x.inTemplates.join(', ')}`);
    for (const p of x.problems) say(`  ${p}`);
  }
  process.exit(bad ? 1 : 0);
}

// write a tree
const outArg = opt('out');
if (!outArg) refuse('--out <dir> is required (or --verify, or --count)');
const out = path.resolve(outArg);
const parent = path.dirname(out);
if (fs.lstatSync(out, { throwIfNoEntry: false })?.isSymbolicLink()) refuse(`${out} is a link; give the folder itself`);
if (!fs.statSync(parent, { throwIfNoEntry: false })?.isDirectory()) refuse(`${parent} does not exist; make it first (the tool writes nothing outside --out)`);
const st = fs.statSync(out, { throwIfNoEntry: false });
if (st && (!st.isDirectory() || fs.readdirSync(out).length)) refuse(`${out} exists and is not an empty folder`);
// inside a work tree, or inside a repository's own .git folder
const inGit = git(st ? out : parent, ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' });
if (inGit.status === 0) refuse(`${out} is inside the git repository ${inGit.stdout.trim()}; write the tree outside any checkout`);
if (!/not a git repository/.test(inGit.stderr)) refuse(`can't tell whether ${out} is inside a git repository: ${inGit.stderr.trim()}`);

const problems = builds.flatMap(({ name, b }) => b.problems.map((p) => `${name}: ${p}`));
const files = builds.flatMap(({ b }) => [...b.modules.map((m) => ({ file: m.file, text: m.text })), ...(b.entry ? [b.entry] : [])]);
// everything the overlay writes: generated files as overlaid, files rules wrote, files/ files
const generated = new Set(files.map((f) => f.file));
const writes = [...ov.text].filter(([file]) => !generated.has(file)).map(([file, text]) => ({ file, text }));
const all = [...new Set([...files.map((f) => f.file), ...writes.map((f) => f.file), ...ov.files.map((f) => f.path)])];
for (const f of all) {
  const abs = path.resolve(out, f);
  if (!abs.startsWith(out + path.sep)) problems.push(`${f} is outside --out`);
}
const there = git(repo, ['ls-tree', '-r', '--name-only', sha, '--', ...new Set(files.map((f) => f.file))], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
for (const f of there) problems.push(`${f} is already in ${sha.slice(0, 8)}; the split would overwrite it`);
// a file, or a folder above one, that the commit tracks as a link would be written through
const above = [...new Set(all.flatMap((f) => { const p = f.split('/'); return p.map((_, i) => p.slice(0, i + 1).join('/')); }))];
if (above.length) for (const l of git(repo, ['ls-tree', sha, '--', ...above], { encoding: 'utf8' }).stdout.split('\n').filter((x) => x.startsWith('120000 '))) problems.push(`${l.split('\t')[1]} is a link in ${sha.slice(0, 8)}; the split would write through it`);
// a written path the commit has as a folder, or a written path under one of its files (each path's
// own type: ls-tree lists a folder's children, cat-file the folder)
const allSet = new Set(all);
if (above.length) {
  const types = git(repo, ['cat-file', '--batch-check=%(objecttype)'], { encoding: 'utf8', input: above.map((p) => `${sha}:${p}\n`).join('') }).stdout.split('\n');
  above.forEach((p, i) => {
    const t = types[i]?.trim();
    if (t === 'tree' && allSet.has(p)) problems.push(`${p} is a folder in ${sha.slice(0, 8)}; the overlay can't write it as a file`);
    else if (t === 'blob' && !allSet.has(p)) problems.push(`${p} is a file in ${sha.slice(0, 8)}; the overlay can't write under it`);
  });
}
// one written path above another
for (const f of all) { const p = f.split('/'); for (let i = 1; i < p.length; i++) if (allSet.has(p.slice(0, i).join('/'))) problems.push(`${p.slice(0, i).join('/')} is written as a file and as a folder above ${f}`); }
if (problems.length) { for (const p of problems) process.stderr.write(`split: ${p}\n`); process.stderr.write('split: nothing written\n'); process.exit(1); }

if (!st) fs.mkdirSync(out);
const tar = git(repo, ['archive', '--format=tar', sha]);
if (tar.status !== 0) refuse(`git archive ${sha} failed: ${tar.stderr}`);
const x = run('tar', ['-x', '-f', '-', '-C', out], { input: tar.stdout });
if (x.status !== 0) { process.stderr.write(`split: tar failed: ${x.stderr}\n`); process.exit(1); }
const put = (file, data, mode) => { const abs = path.resolve(out, file); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, data); if (mode !== undefined) fs.chmodSync(abs, mode); };
for (const f of files) put(f.file, ov.text.get(f.file) ?? f.text);
for (const f of writes) put(f.file, f.text);
for (const f of ov.files) put(f.path, fs.readFileSync(f.abs), fs.statSync(f.abs).mode & 0o777);
applyPatches(out, OV.folders, ov.report, env);
const summary = builds.map(({ M, b }) => ({ source: M.source, dir: M.dir, entry: M.entry, modules: b.modules.length, largest: Math.max(...b.modules.map((m) => readLines(ov.text.get(m.file) ?? m.text))) }));
function readLines(t) { return t.split('\n').length - (t.endsWith('\n') ? 1 : 0); }
const stale = staleList();
if (flag('json')) say(JSON.stringify({ sha, out, summary, stale, overlay: ov.report }, null, 2));
else {
  for (const s of summary) say(`${s.source} at ${sha.slice(0, 8)}: ${s.modules} modules in ${s.dir} (largest ${s.largest} lines), ${s.entry ? `entry ${s.entry}` : 'no entry'}; tree at ${out}`);
  for (const l of overlayLines()) say(l);
}
