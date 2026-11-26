// The overlay's pages-docs area (kit-898, cutover-tree@1): a tree generated at this checkout's HEAD
// drops the old dashboard pages, and its README names the CLI's module paths where it named
// devteam.mjs's code. Each split runs with a split dir holding the manifests and this area only, so
// another area's staleness never fails this test. Two kinds of drift skip, naming what drifted (the
// parity run reports both), so a regular PR is never failed here: manifest drift that stops HEAD's
// split (every test), and a README that is no longer the one readme.patch was made from, when the
// patch no longer applies (P2). Any other result is judged.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const splitSrc = path.join(root, 'test', 'split');
const tool = path.join(splitSrc, 'split.mjs');
const AREA = 'pages-docs';
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GIT_|DEVTEAM_)/.test(k)));
const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', env, maxBuffer: 1 << 28, ...o });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'split-pages-docs-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const PAGES = ['index.html', 'hub.html', 'canvas.html', 'browser.html', 'devteam-ui.js', 'devteam-ui.css'].map((f) => `docs/devteam/dashboard/${f}`);
const LAYOUT_OLD = '  scripts/devteam.mjs          the one script (node, no dependencies)';
const IMAGE_OLD = 'the list is `IMAGE_RUNS` in `docs/devteam/scripts/devteam.mjs`';

// the split dir: every manifest*.json and this area alone
const splitDir = path.join(tmp, 'split');
fs.mkdirSync(path.join(splitDir, 'overlay'), { recursive: true });
const manifests = fs.readdirSync(splitSrc).filter((f) => /^manifest.*\.json$/.test(f));
for (const m of manifests) fs.copyFileSync(path.join(splitSrc, m), path.join(splitDir, m));
if (fs.existsSync(path.join(splitSrc, 'overlay', AREA))) fs.cpSync(path.join(splitSrc, 'overlay', AREA), path.join(splitDir, 'overlay', AREA), { recursive: true });

// split a repo at a commit into out, with --json; { r, j, read, has }
function split(repo, sha, out) {
  const r = run(process.execPath, [tool, '--repo', repo, '--split-dir', splitDir, '--at', sha, '--out', out, '--json'], { cwd: os.tmpdir() });
  let j = {};
  try { j = JSON.parse(r.stdout); } catch { /* the assertions name it */ }
  return { r, j, out, read: (f) => fs.readFileSync(path.join(out, f), 'utf8'), has: (f) => fs.existsSync(path.join(out, f)) };
}
const mine = (j, key) => (j.overlay?.[key] ?? []).filter((x) => x.area === AREA);
const items = (list) => list.map((x) => `${x.kind} ${x.name}`);
const readmeStale = (j) => mine(j, 'stale').find((s) => s.kind === 'patch' && s.name === 'readme.patch');

// ---- the kit's own HEAD ----
const sha = run('git', ['-C', root, 'rev-parse', 'HEAD']).stdout.trim();
const head = split(root, sha, path.join(tmp, 'head'));
// HEAD drifted from the manifest, as split-tool's H tests judge it (a start gone or out of order, a
// module past the cap, a form the scanner can't read): the split writes nothing, and every test here
// skips naming it, so a regular PR is never failed by drift the split tool hasn't caught up with.
// Any other refusal or crash runs the tests, which fail on it.
const DRIFT = [/^split: manifest[\w-]*\.json: manifest: module .+ (?:is not in the source|starts at line \d+, not after .+|must start at line 1)$/,
  /^split: manifest[\w-]*\.json: module .+ is \d+ lines, over the cap of \d+$/, /^split: manifest[\w-]*\.json: the declaration at line \d+ .* binds names the split can't read whole/,
  /^split: nothing written$/];
const splitLines = head.r.stderr.trim().split('\n').filter(Boolean);
const SPLIT_SKIP = head.r.status === 1 && splitLines.length > 0 && splitLines.every((l) => DRIFT.some((re) => re.test(l))) ? `HEAD's split stopped on manifest drift: ${splitLines.slice(0, 3).join('; ')}` : false;
// The README drifted at HEAD: its patch is stale with "no longer applies" and HEAD's README is not
// the one the patch was made from (the patch's full index line names that blob). A patch that fails
// on the very README it was made from is broken, not drifted, and P2 judges it.
const patchFile = path.join(splitSrc, 'overlay', AREA, 'patches', 'readme.patch');
const madeFrom = fs.existsSync(patchFile) ? fs.readFileSync(patchFile, 'utf8').match(/^index ([0-9a-f]{40})\.\./m)?.[1] : undefined;
const headReadme = run('git', ['-C', root, 'rev-parse', `${sha}:README.md`]).stdout.trim();
const drift = readmeStale(head.j);
const README_SKIP = SPLIT_SKIP || (drift && /^no longer applies/.test(drift.why) && madeFrom && madeFrom !== headReadme ? `the README drifted at HEAD (${headReadme.slice(0, 8)}, the patch was made from ${madeFrom.slice(0, 8)}); the parity run reports it: ${drift.why}` : false);

test('P1: at HEAD the tree has none of the old pages, devteam-ui.css included', { skip: SPLIT_SKIP }, () => {
  assert.equal(head.r.status, 0, head.r.stderr);
  for (const p of PAGES) assert.equal(head.has(p), false, `${p} is not in the tree`);
  const applied = items(mine(head.j, 'applied'));
  for (const p of PAGES) assert.ok(applied.includes(`file ${p}`), `the stand-in for ${p} is applied: ${applied.join('; ')}`);
  assert.ok(applied.includes('patch delete-pages.patch'), `the deletion is applied: ${applied.join('; ')}`);
  assert.deepEqual(items(mine(head.j, 'stale')).filter((s) => s !== 'patch readme.patch'), [], 'nothing else of the area is stale');
});

test('P2: at HEAD the README names the modules where it named devteam.mjs\'s code', { skip: README_SKIP }, () => {
  assert.equal(head.r.status, 0, head.r.stderr);
  assert.equal(readmeStale(head.j), undefined, `the README patch applies: ${readmeStale(head.j)?.why}`);
  assert.ok(items(mine(head.j, 'applied')).includes('patch readme.patch'), 'the README patch is applied');
  const src = run('git', ['-C', root, 'show', `${sha}:README.md`]).stdout.split('\n');
  const got = head.read('README.md').split('\n');
  // the module that declares IMAGE_RUNS in this tree
  const lib = path.join(head.out, 'docs', 'devteam', 'scripts', 'lib');
  const mods = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : mods.push(path.join(d, e.name)); };
  walk(lib);
  const owner = mods.filter((f) => /^export\s+(?:const|let|var)\s+IMAGE_RUNS\b/m.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(head.out, f).split(path.sep).join('/'));
  assert.equal(owner.length, 1, `one module declares IMAGE_RUNS: ${owner.join(', ')}`);
  const layout = got.filter((l) => /^ {2}scripts\//.test(l));
  assert.ok(layout.some((l) => /^ {2}scripts\/lib\/<module>\.mjs {2,}\S/.test(l)), `the layout lists scripts/lib/<module>.mjs: ${layout.join(' | ')}`);
  assert.ok(layout.some((l) => /^ {2}scripts\/cli\.mjs {2,}\S/.test(l)), `the layout lists scripts/cli.mjs: ${layout.join(' | ')}`);
  assert.ok(!got.includes(LAYOUT_OLD), 'the layout no longer calls devteam.mjs the one script');
  const image = got.filter((l) => l.includes('`IMAGE_RUNS` in `'));
  assert.equal(image.length, 1, 'one line names where IMAGE_RUNS is');
  assert.ok(image[0].includes(`the list is \`IMAGE_RUNS\` in \`${owner[0]}\``), `the release paragraph names ${owner[0]}`);
  assert.ok(!got.some((l) => l.includes(IMAGE_OLD)), 'no line names devteam.mjs for IMAGE_RUNS');
  // nothing else changed: the source less its two lines is the tree less the lines the patch added
  const added = new Set(got.filter((l) => !src.includes(l)));
  assert.deepEqual(got.filter((l) => !added.has(l)), src.filter((l) => l !== LAYOUT_OLD && !l.includes(IMAGE_OLD)), 'the README is otherwise unchanged');
});

// ---- a commit whose README and pages moved on: the README patch is stale, the pages still go ----
test('P3: where the README lines changed, the README patch is reported stale and the pages are still deleted', { skip: SPLIT_SKIP }, () => {
  const repo = path.join(tmp, 'drift');
  const put = (f, t) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), t); };
  const show = (f) => run('git', ['-C', root, 'show', `${sha}:${f}`]).stdout;
  for (const m of manifests) { const src = JSON.parse(fs.readFileSync(path.join(splitSrc, m), 'utf8')).source; put(src, show(src)); }
  const readme = show('README.md').replace(LAYOUT_OLD, '  scripts/devteam.mjs          the one script, still (node, no dependencies)').replace(IMAGE_OLD, 'the list is `IMAGE_RUNS` in `devteam.mjs`');
  assert.notEqual(readme, show('README.md'), 'the fixture README differs from HEAD\'s');
  put('README.md', readme);
  // the pages: index.html holds other text, canvas.html is gone
  for (const p of PAGES) if (!p.endsWith('canvas.html')) put(p, p.endsWith('index.html') ? '<!doctype html><p>a page that moved on</p>\n' : show(p));
  const g = (...a) => assert.equal(run('git', ['-C', repo, ...a]).status, 0, a.join(' '));
  g('init', '-q');
  g('add', '-A');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'drift');
  const at = run('git', ['-C', repo, 'rev-parse', 'HEAD']).stdout.trim();
  const d = split(repo, at, path.join(tmp, 'drift-tree'));
  assert.equal(d.r.status, 0, `a stale tree is still written: ${d.r.stderr}`);
  const s = readmeStale(d.j);
  assert.ok(s, `the README patch is stale: ${JSON.stringify(d.j.overlay?.stale)}`);
  assert.match(s.why, /^no longer applies/);
  assert.ok((d.j.stale ?? []).some((x) => x.area === AREA && x.kind === 'patch' && x.name === 'readme.patch'), '--json\'s stale list names it');
  assert.equal(d.read('README.md'), readme, 'the README is left as the commit has it');
  for (const p of PAGES) assert.equal(d.has(p), false, `${p} is not in the tree`);
  assert.ok(items(mine(d.j, 'applied')).includes('patch delete-pages.patch'), 'the deletion applies whatever the pages hold');
});
