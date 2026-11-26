#!/usr/bin/env node
// The check .github/workflows/release.yml runs before it publishes the kit to npm (kit-954), and that
// its pull_request run shows. Node 18 or later, built-ins only.
//
//   node test/release/package-check.mjs --tag vX.Y.Z --out <dir> [--tree <rev>] [--alpha <dir>] [--min-npm x.y.z]
//
// Run from the root of a checkout of the release's commit. In order, refusing at the first problem:
//  1. The tag is vX.Y.Z (each number at most 9 digits); --tree (default refs/tags/<tag>) names a commit;
//     --out is a new or empty folder outside docs/devteam/ (a file is refused, as for --alpha); the npm on
//     PATH is at least --min-npm.
//  2. The alpha (alpha-build@1): --alpha holds one folder per app, each the build job's apps/<app>/out/.
//     Its apps are exactly those with an apps/<app>/package.json in the tree (none, when the tree has
//     none; nothing else under apps/ is read), and it holds only folders and regular files of the known types (KNOWN). They are copied to
//     docs/devteam/alpha/<app>/, which must not exist before. No apps: no alpha folder.
//  3. package.json gets the tag's version (the number without its v), and nothing else changes in it.
//  4. npm pack --dry-run --json lists the files, then npm pack writes the tarball into <out>, each with
//     --ignore-scripts, no user or global npm config and no npm_config_* variable.
//  5. The tarball holds only regular files, all under package/, and exactly the dry run's list:
//     - package.json is the tree's with the tag's version, and declares no dependency (dependencies is
//       {}, and no devDependencies, peerDependencies, optionalDependencies or bundled ones), no bin and
//       no scripts;
//     - README.md and every file under docs/devteam/ but alpha/ is byte-identical to the tree's;
//     - every file under docs/devteam/alpha/ is one the alpha staged, byte for byte;
//     - every staged alpha file is in it, and so is every file of the tree's docs/devteam/ but project/,
//       run/ and dotfiles (npm leaves out .gitignore and .npmrc).
//     Only a tarball that passed all of it is renamed <out>/package.tgz, the path the publish step reads.
// It prints the packed files, one per line, writes them to <out>/files.txt and ends "ok: <name>@<version>,
// <n> files, packed by npm <npm's version>"; exit 0. A refusal prints "package-check: refusing: <why>" on
// stderr and exits 1; bad usage, 2.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';

// alpha-build@1's known types, by extension
export const KNOWN = ['html', 'js', 'css', 'txt', 'json', 'svg', 'png', 'ico', 'webp', 'woff2'];
const APP = /^[a-z0-9][a-z0-9-]*$/;
const DEP_KEYS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'bundleDependencies', 'bundledDependencies'];

class Refusal extends Error {}
const refuse = (why) => { throw new Refusal(why); };

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!['--tag', '--out', '--tree', '--alpha', '--min-npm'].includes(k) || argv[i + 1] === undefined) return null;
    o[k.slice(2)] = argv[i + 1];
  }
  return o.tag && o.out ? o : null;
}

const git = (root, a) => execFileSync('git', a, { cwd: root, maxBuffer: 1 << 30 });

// npm with no user or global config and no npm_config_* variable, scripts off
function npm(a, out) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_config_/i.test(k)));
  env.npm_config_userconfig = path.join(out, '.npmrc-user');
  env.npm_config_globalconfig = path.join(out, '.npmrc-global');
  const r = spawnSync('npm', [...a, '--ignore-scripts'], { env, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.error || r.status !== 0) refuse(`npm ${a.join(' ')} failed (${r.error?.message ?? `exit ${r.status}`}): ${(r.stderr ?? '').trim().slice(0, 400)}`);
  return r.stdout;
}

const newer = (have, need) => {
  const h = have.split(/[.-]/).map(Number);
  const n = need.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((h[i] || 0) !== n[i]) return (h[i] || 0) > n[i];
  return true;
};

// Every entry of a .tgz, as path -> bytes; anything but a regular file refuses.
export function untar(gz) {
  let buf;
  try { buf = zlib.gunzipSync(gz); } catch (e) { refuse(`the tarball isn't gzip (${e.message})`); }
  const files = new Map();
  let pax = {};
  for (let i = 0; i + 512 <= buf.length;) {
    const h = buf.subarray(i, i + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0[\s\S]*$/, '');
    const size = parseInt(str(124, 136).trim() || '0', 8);
    if (!Number.isSafeInteger(size) || size < 0 || i + 512 + size > buf.length) refuse('the tarball is truncated or has a bad size field');
    const type = h[156] === 0 ? '0' : String.fromCharCode(h[156]);
    let name = str(0, 100);
    const prefix = str(345, 500);
    if (str(257, 263).startsWith('ustar') && prefix) name = `${prefix}/${name}`;
    const body = Buffer.from(buf.subarray(i + 512, i + 512 + size));
    i += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      pax = {};
      for (const m of body.toString('utf8').matchAll(/^\d+ ([^=\n]+)=([^\n]*)$/gm)) pax[m[1]] = m[2];
      continue;
    }
    if (type === 'g') continue;
    if (pax.path) name = pax.path;
    pax = {};
    if (type !== '0') refuse(`the tarball holds ${name}, which isn't a regular file (type ${type})`);
    if (files.has(name)) refuse(`the tarball holds ${name} twice`);
    files.set(name, body);
  }
  return files;
}

// The tree's files under the given paths, as path -> blob sha; a symlink or submodule refuses.
function treeFiles(root, commit, paths) {
  const out = new Map();
  const raw = git(root, ['ls-tree', '-r', '-z', '--full-tree', commit, '--', ...paths]).toString('utf8');
  for (const e of raw.split('\0').filter(Boolean)) {
    const [meta, p] = [e.slice(0, e.indexOf('\t')), e.slice(e.indexOf('\t') + 1)];
    const [mode, type, sha] = meta.split(' ');
    if (type !== 'blob' || mode === '120000') refuse(`the tree's ${p} isn't a regular file (mode ${mode})`);
    out.set(p, sha);
  }
  return out;
}

// The alpha's files, as "<app>/<path>" -> absolute source path, after its checks.
function alphaFiles(dir, apps) {
  const files = new Map();
  if (dir && fs.existsSync(dir) && !fs.lstatSync(dir).isDirectory()) refuse(`--alpha ${dir} isn't a folder`);
  const have = dir && fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  for (const app of have) {
    const st = fs.lstatSync(path.join(dir, app));
    if (!st.isDirectory() || !APP.test(app)) refuse(`the alpha's ${app} isn't an app's folder`);
  }
  const want = [...apps].sort();
  if (!isDeepStrictEqual(have, want)) refuse(`the alpha holds ${have.length ? have.join(', ') : 'no app'}, but the tree's apps are ${want.length ? want.join(', ') : 'none'}`);
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs).sort()) {
      const a = path.join(abs, name);
      const r = `${rel}/${name}`;
      const st = fs.lstatSync(a);
      if (st.isDirectory()) walk(a, r);
      else if (!st.isFile()) refuse(`the alpha's ${r} isn't a regular file`);
      else if (!KNOWN.includes(path.extname(name).slice(1).toLowerCase())) refuse(`the alpha's ${r} is of an unknown type (known: ${KNOWN.join(', ')})`);
      else files.set(r, a);
    }
  };
  for (const app of have) walk(path.join(dir, app), app);
  return files;
}

function depsProblem(pkg) {
  for (const k of DEP_KEYS) {
    const v = pkg[k];
    if (v === undefined) continue;
    if (k === 'dependencies' && v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) continue;
    if (k !== 'dependencies' && ((Array.isArray(v) && !v.length) || (v && typeof v === 'object' && !Object.keys(v).length) || v === false)) continue;
    return `package.json declares ${k} (${JSON.stringify(v).slice(0, 120)}): the package has no dependencies`;
  }
  if (!pkg.dependencies) return 'package.json has no "dependencies": {}';
  if (pkg.bin !== undefined) return 'package.json declares a bin';
  if (pkg.scripts !== undefined) return 'package.json declares scripts';
  return null;
}

export function check(o, root = process.cwd()) {
  const m = /^v([0-9]{1,9})\.([0-9]{1,9})\.([0-9]{1,9})$/.exec(o.tag);
  if (!m) refuse(`${o.tag} isn't a release tag vX.Y.Z`);
  const version = `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}`;
  if (version !== o.tag.slice(1)) refuse(`${o.tag} has a leading zero`);
  root = fs.realpathSync(root);
  let top;
  try { top = fs.realpathSync(git(root, ['rev-parse', '--show-toplevel']).toString('utf8').trim()); } catch { refuse(`${root} isn't a git checkout`); }
  if (top !== root) refuse(`run it from the checkout's root (${top})`);
  const rev = o.tree ?? `refs/tags/${o.tag}`;
  let commit;
  try { commit = git(root, ['rev-parse', '--verify', '-q', `${rev}^{commit}`]).toString('utf8').trim(); } catch { refuse(`${rev} isn't a commit here`); }
  const out = path.resolve(root, o.out);
  if (out === path.join(root, 'docs', 'devteam') || out.startsWith(path.join(root, 'docs', 'devteam') + path.sep)) refuse('--out is inside docs/devteam/');
  if (fs.existsSync(out) && !fs.lstatSync(out).isDirectory()) refuse(`--out ${out} isn't a folder`);
  if (fs.existsSync(out) && fs.readdirSync(out).length) refuse(`--out ${out} isn't empty`);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, '.npmrc-user'), '');
  fs.writeFileSync(path.join(out, '.npmrc-global'), '');
  if (o['min-npm']) {
    const have = npm(['--version'], out).trim();
    if (!/^\d+\.\d+\.\d+/.test(have) || !newer(have, o['min-npm'])) refuse(`npm ${have} is older than ${o['min-npm']}`);
  }

  // 2. the alpha
  const tree = treeFiles(root, commit, ['package.json', 'README.md', 'docs/devteam']);
  if ([...tree.keys()].some((p) => p.startsWith('docs/devteam/alpha/'))) refuse('the tree already has docs/devteam/alpha/');
  // the tree's apps: each apps/<app>/package.json; nothing else under apps/ is read
  const appPaths = git(root, ['ls-tree', '-r', '-z', '--name-only', '--full-tree', commit, '--', 'apps']).toString('utf8').split('\0');
  const apps = new Set(appPaths.map((p) => /^apps\/([^/]+)\/package\.json$/.exec(p)?.[1]).filter(Boolean));
  const alpha = alphaFiles(o.alpha ? path.resolve(o.alpha) : null, apps);
  const alphaDir = path.join(root, 'docs', 'devteam', 'alpha');
  if (fs.existsSync(alphaDir)) refuse('docs/devteam/alpha/ exists before the alpha is staged');
  for (const [r, a] of alpha) {
    const dest = path.join(alphaDir, ...r.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(a, dest);
  }

  // 3. the version
  if (!tree.has('package.json')) refuse('the tree has no package.json');
  const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  let treePkg;
  try { treePkg = JSON.parse(git(root, ['cat-file', 'blob', tree.get('package.json')]).toString('utf8')); } catch { /* refused below */ }
  if (!object(treePkg)) refuse(`${rev}'s package.json isn't a JSON object`);
  const pkgPath = path.join(root, 'package.json');
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch { /* refused below */ }
  if (!object(pkg)) refuse('the checkout\'s package.json is missing or isn\'t a JSON object');
  pkg.version = version;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  // 4. pack
  let listed;
  try { listed = JSON.parse(npm(['pack', '--dry-run', '--json'], out))[0].files.map((f) => f.path).sort(); } catch (e) { if (e instanceof Refusal) throw e; refuse('npm pack --dry-run --json printed no file list'); }
  npm(['pack', '--pack-destination', out], out);
  const made = fs.readdirSync(out).filter((f) => f.endsWith('.tgz'));
  if (made.length !== 1) refuse(`npm pack left ${made.length} tarballs in --out`);
  const packed = path.join(out, made[0]);

  // 5. the tarball
  const entries = untar(fs.readFileSync(packed));
  const names = [];
  for (const [name, bytes] of entries) {
    if (!name.startsWith('package/') || name.split('/').some((s) => s === '..' || s === '.' || s === '') || name.includes('\\')) refuse(`the tarball holds ${name}, outside package/`);
    const rel = name.slice('package/'.length);
    names.push(rel);
    if (rel === 'package.json') {
      let packed;
      try { packed = JSON.parse(bytes.toString('utf8')); } catch { refuse('the packed package.json isn\'t JSON'); }
      const problem = depsProblem(packed);
      if (problem) refuse(problem);
      if (!isDeepStrictEqual(packed, { ...treePkg, version })) refuse('the packed package.json isn\'t the tree\'s with the tag\'s version');
    } else if (rel.startsWith('docs/devteam/alpha/')) {
      const src = alpha.get(rel.slice('docs/devteam/alpha/'.length));
      if (!src) refuse(`the tarball holds ${rel}, which the alpha didn't stage`);
      if (!bytes.equals(fs.readFileSync(src))) refuse(`the tarball's ${rel} differs from the alpha's`);
    } else if (rel === 'README.md' || rel.startsWith('docs/devteam/')) {
      if (!tree.has(rel)) refuse(`the tarball holds ${rel}, which isn't in ${rev}'s tree`);
      if (!bytes.equals(git(root, ['cat-file', 'blob', tree.get(rel)]))) refuse(`the tarball's ${rel} differs from ${rev}'s tree`);
    } else refuse(`the tarball holds ${rel}, outside what the package carries (package.json, README.md, docs/devteam/)`);
  }
  names.sort();
  if (!isDeepStrictEqual(names, listed)) refuse(`npm pack --dry-run listed ${listed.length} files and the tarball holds ${names.length}: they differ`);
  const want = ['package.json', ...[...alpha.keys()].map((r) => `docs/devteam/alpha/${r}`), ...[...tree.keys()].filter((p) => p !== 'package.json' && !/^docs\/devteam\/(project|run)\//.test(p) && !path.posix.basename(p).startsWith('.'))];
  for (const w of want) if (!entries.has(`package/${w}`)) refuse(`the tarball is missing ${w}`);
  // only a tarball that passed every check is at the path the publish step reads
  const tgz = path.join(out, 'package.tgz');
  fs.renameSync(packed, tgz);
  fs.writeFileSync(path.join(out, 'files.txt'), `${names.join('\n')}\n`);
  return { name: treePkg.name, version, files: names, tgz, npm: npm(['--version'], out).trim() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2));
  if (!o) {
    process.stderr.write('usage: node test/release/package-check.mjs --tag vX.Y.Z --out <dir> [--tree <rev>] [--alpha <dir>] [--min-npm x.y.z]\n');
    process.exit(2);
  }
  try {
    const r = check(o);
    process.stdout.write(`${r.files.join('\n')}\nok: ${r.name}@${r.version}, ${r.files.length} files, packed by npm ${r.npm}\n`);
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    process.stderr.write(`package-check: refusing: ${e.message}\n`);
    process.exit(1);
  }
}
