// The split tool (kit-890): test/split/split.mjs writes the kit at a commit with its CLI in
// modules, --verify proves a tree moved every declaration unchanged, and --count is the sizing count.
// The F and R tests run on a fixture repo the test makes, so they always run. The H tests split this
// checkout's own HEAD with the real manifest and no overlay; when HEAD has drifted from the manifest (a start renamed,
// a module past the cap, a form the scanner can't read) they skip and name it, so a regular PR is
// never failed by drift the split tool hasn't caught up with yet.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { items } from './split/lib/js.mjs';
import { readModule } from './split/lib/verify.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tool = path.join(root, 'test', 'split', 'split.mjs');
const linker = path.join(root, 'test', 'split', 'lib', 'link.mjs');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GIT_|DEVTEAM_)/.test(k)));
const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', env, maxBuffer: 1 << 28, ...o });
const split = (...a) => run(process.execPath, [tool, ...a], { cwd: os.tmpdir() });
const link = (entry) => run(process.execPath, ['--experimental-vm-modules', '--no-warnings', linker, entry]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'split-tool-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const kitSrc = fs.readFileSync(path.join(root, 'docs', 'devteam', 'scripts', 'devteam.mjs'), 'utf8');
const PARTS = kitSrc.slice(kitSrc.indexOf('/* parts start */'), kitSrc.indexOf('/* parts end */') + '/* parts end */'.length);

// ---- the fixture: a small CLI-like source, in a git repo of its own ----
// It has what the kit's script has: a shebang, node: imports, banners, a region, a multi-line
// declaration list, a nested destructuring, a template with column-0 code-like lines, a regex with a
// backtick, a let other code assigns, load-time statements, and the kit's own parts region (so
// verify finds fileParts in the source).
const FIXTURE = `#!/usr/bin/env node
// a fixture CLI
import fs from 'node:fs';
import { join as pjoin, sep } from 'node:path';

// ===== 1. one =====

const A = 1,
  B = 2;
const {
  left,
  right: { inner = 0 },
  ...others
} = { left: 1, right: { inner: 2 }, x: 3 };
let counter = 0;
// bump the counter
function bump() { counter++; return counter; }
const TEMPLATE = \`
  if (x) {
}
\`;
const RE = /\`[{]/g;
${PARTS}

// ===== 2. two =====

/* big start */
function useAll() { return [A, B, left, inner, others, bump(), fs.existsSync, pjoin, sep, TEMPLATE, RE, typeof fileParts]; }
/* big end */
// assigns a let of another module (never called: in a module it would throw)
function reset() { counter = 0; }
if (process.argv[2] === 'run') process.stdout.write(\`\${useAll().length}\\n\`);

// tail start
async function load() { return A; }
function* gen() { yield B; }
var legacy = 1;
export const PRE = 2;
const{packed}=({packed:3});
// tail end
class Shape { area() { return legacy + PRE; } }
`;
const FM = { source: 'src/tool.mjs', dir: 'src/lib', entry: 'src/cli.mjs', cap: 2000, modules: [{ name: 'one', from: { line: 1 } }, { name: 'two', from: { banner: '2. two' } }, { name: 'three', from: { region: 'tail' } }, { name: 'four', from: { decl: 'Shape' } }], place: {} };
function fixtureRepo(name, source = FIXTURE, manifest = FM) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, 'repo', 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'split'));
  fs.writeFileSync(path.join(dir, 'repo', manifest.source), source);
  fs.writeFileSync(path.join(dir, 'repo', 'README.md'), 'fixture\n');
  fs.writeFileSync(path.join(dir, 'split', 'manifest.json'), JSON.stringify(manifest, null, 2));
  const g = (...a) => assert.equal(run('git', ['-C', path.join(dir, 'repo'), ...a]).status, 0, a.join(' '));
  g('init', '-q');
  g('add', '-A');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fixture');
  const sha = run('git', ['-C', path.join(dir, 'repo'), 'rev-parse', 'HEAD']).stdout.trim();
  const opts = ['--repo', path.join(dir, 'repo'), '--split-dir', path.join(dir, 'split'), '--at', sha];
  return { dir, sha, opts, out: path.join(dir, 'tree'), M: manifest };
}
const F = fixtureRepo('f');
const fSplit = split(...F.opts, '--out', F.out);
const fMod = (n) => path.join(F.out, 'src', 'lib', `${n}.mjs`);
const fVerify = () => split(...F.opts, '--verify', '--tree', F.out);
function mutated(file, change, verify) {
  const was = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, change(was));
  try { return verify(); } finally { fs.writeFileSync(file, was); }
}
// a module's first top-level declaration (that pick accepts): its key and its lines in the file
function firstDecl(file, pick = () => true) {
  const text = fs.readFileSync(file, 'utf8');
  const off = readModule(text).region.length + 2;
  const it = items(text.split('\n').slice(off).join('\n')).items.find((x) => x.kind === 'decl' && pick(x));
  return { name: it.names.join(','), from: it.from + off, to: it.to + off, line: it.line + off };
}

test('F1: the fixture splits into modules, each declaration exported, under a sorted imports region', () => {
  assert.equal(fSplit.status, 0, fSplit.stderr);
  assert.equal(fs.readFileSync(path.join(F.out, 'README.md'), 'utf8'), 'fixture\n');
  const two = readModule(fs.readFileSync(fMod('two'), 'utf8'));
  // every name two uses from one, the multi-line and nested ones too, and the node: bindings it uses
  assert.deepEqual(two.region, [
    "import fs from 'node:fs';",
    "import { A } from './one.mjs';",
    "import { B } from './one.mjs';",
    "import { RE } from './one.mjs';",
    "import { TEMPLATE } from './one.mjs';",
    "import { bump } from './one.mjs';",
    "import { counter } from './one.mjs';",
    "import { fileParts } from './one.mjs';",
    "import { inner } from './one.mjs';",
    "import { join as pjoin } from 'node:path';",
    "import { left } from './one.mjs';",
    "import { others } from './one.mjs';",
    "import { sep } from 'node:path';",
  ]);
  assert.match(fs.readFileSync(fMod('two'), 'utf8'), /^export function useAll\(\)/m);
  const one = fs.readFileSync(fMod('one'), 'utf8');
  for (const re of [/^export const A = 1,$/m, /^export const \{$/m, /^export let counter = 0;$/m, /^export function bump\(\)/m, /^export const TEMPLATE = `$/m, /^export function fileParts\(/m]) assert.match(one, re);
  assert.doesNotMatch(one, /^export \s*if \(x\)/m, 'a line inside a template is not a declaration');
});

test('F2: the fixture tree links and runs: the entry imports each module in order', () => {
  assert.equal(fSplit.status, 0, fSplit.stderr);
  const entry = path.join(F.out, 'src', 'cli.mjs');
  const code = fs.readFileSync(entry, 'utf8').split('\n').filter((l) => l && !l.startsWith('//'));
  assert.deepEqual(code, ['#!/usr/bin/env node', "import './lib/one.mjs';", "import './lib/two.mjs';", "import './lib/three.mjs';", "import './lib/four.mjs';"]);
  const l = link(entry);
  assert.equal(l.status, 0, l.stderr);
  const r = run(process.execPath, [entry, 'run']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '12\n');
});

test('F3: verify is clean on the fixture tree, and the independent count is equal', () => {
  assert.equal(fSplit.status, 0, fSplit.stderr);
  const v = split(...F.opts, '--verify', '--tree', F.out, '--json');
  assert.equal(v.status, 0, v.stdout);
  const j = JSON.parse(v.stdout).report[0];
  assert.deepEqual(j.problems, []);
  assert.equal(j.parts.equal, true);
  assert.ok(j.parts.source > 10 && j.parts.source === j.parts.tree, JSON.stringify(j.parts));
});

test('F4: verify names a dropped declaration', () => {
  const d = firstDecl(fMod('two'));
  const r = mutated(fMod('two'), (t) => t.split('\n').filter((_, i) => i + 1 < d.from || i + 1 > d.to).join('\n'), fVerify);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /^ {2}dropped: useAll is in no module$/m);
});

test('F5: verify names a doubled declaration', () => {
  const d = firstDecl(fMod('one'), (x) => x.names.includes('bump'));
  const text = fs.readFileSync(fMod('one'), 'utf8').split('\n').slice(d.from - 1, d.to).join('\n');
  const r = mutated(fMod('two'), (t) => `${t}${text}\n`, fVerify);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /^ {2}doubled: bump appears 2 times \(in src\/lib\/one\.mjs, src\/lib\/two\.mjs\), 1 in the source$/m);
});

test('F6: verify names a declaration with one byte changed, and so does the independent count', () => {
  const r = mutated(fMod('one'), (t) => t.replace('let counter = 0;', 'let counter = 1;'), fVerify);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /^ {2}changed: counter in src\/lib\/one\.mjs differs from the source at its line 1$/m);
  assert.match(r.stdout, /^ {2}independent count: fileParts finds (\d+) declaration leaves in the source and \1 in the tree; only in the source: let counter = 0;; only in the tree: let counter = 1;$/m);
});

test('F7: verify names a stale imports region and the import it misses', () => {
  const r = mutated(fMod('two'), (t) => t.replace("import { inner } from './one.mjs';\n", ''), fVerify);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /^ {2}stale imports region: src\/lib\/two\.mjs; missing import \{ inner \} from '\.\/one\.mjs';$/m);
});

test('F8: a declaration whose names the scanner can not read whole stops the split, named', () => {
  const G = fixtureRepo('unread', FIXTURE.replace('let counter = 0;', "const KEY = 'k';\nconst { [KEY]: picked } = { k: 1 };\nlet counter = 0;"));
  const r = split(...G.opts, '--out', G.out);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /binds names the split can't read whole \(read: \(unnamed\)\): const \{ \[KEY\]: picked \}/);
  assert.match(r.stderr, /nothing written/);
  assert.equal(fs.existsSync(G.out), false);
  // a second declaration on a declaration's line is never read, so it is refused the same way
  for (const [i, [line, read]] of [['let p = 1; let q = 2;', 'p'], ['function pa() {} function pb() {}', 'pa'], ['const px = 1; class PY {}', 'px']].entries()) {
    const H = fixtureRepo(`twoline${i}`, FIXTURE.replace('let counter = 0;', `${line}\nlet counter = 0;`));
    const h = split(...H.opts, '--out', H.out);
    assert.equal(h.status, 1, `${line}: ${h.stderr}`);
    assert.ok(h.stderr.includes(`binds names the split can't read whole (read: ${read}): ${line}`), h.stderr);
    assert.equal(fs.existsSync(H.out), false);
  }
  // so is a top-level declaration not at column 0, indented or after a comment: it starts no item.
  // A line starting with a comment belongs to the declaration below it, as fileParts has it.
  for (const [i, [line, item]] of [['  let q = 2;', 'p): let p = 1;'], ['/* c */ let q = 2;', 'counter): let counter = 0;'], ['/* c */ function q() {}', 'counter): let counter = 0;']].entries()) {
    const H = fixtureRepo(`offcol${i}`, FIXTURE.replace('let counter = 0;', `let p = 1;\n${line}\nlet counter = 0;`));
    const h = split(...H.opts, '--out', H.out);
    assert.equal(h.status, 1, `${line}: ${h.stderr}`);
    assert.ok(h.stderr.includes(`binds names the split can't read whole (read: ${item}`), `${line}: ${h.stderr}`);
    assert.equal(fs.existsSync(H.out), false);
  }
  // and so is one after a comment or template that ends mid-line, and one on the source's first line
  const after = (text) => FIXTURE.replace('let counter = 0;', `${text}\nlet counter = 0;`);
  for (const [i, [form, source]] of [
    ['comment closed mid-line', after('let p = 1;\n/* a\n */ let q = 2;')],
    ['comment closed mid-line, text on its last line', after('let p = 1;\n/*\n a */ let q = 2;')],
    ['template closed mid-line', after('let p = `a\nb`; let q = 2;')],
    ['indented, first line after the shebang', FIXTURE.replace(/^(#!.*\n)/, '$1  let q = 2;\n')],
    ['indented, first line', `  let q = 2;\n${FIXTURE.replace(/^#!.*\n/, '')}`],
    ['after a comment, first line', `/* c */ let q = 2;\n${FIXTURE.replace(/^#!.*\n/, '')}`],
    ['string continued with a backslash', after("let p = 'a\\\nb'; let q = 2;")],
    ['double-quoted string continued with a backslash', after('let p = "a\\\nb"; let q = 2;')],
    ['export default function after a ;', after('let p = 1; export default function q() {}')],
    ['export default class after a ;', after('let p = 1; export default class q {}')],
  ].entries()) {
    const H = fixtureRepo(`midline${i}`, source);
    const h = split(...H.opts, '--out', H.out);
    assert.equal(h.status, 1, `${form}: ${h.stderr}`);
    assert.match(h.stderr, /binds names the split can't read whole/, form);
    assert.equal(fs.existsSync(H.out), false, form);
  }
});

test('F9: verify names a declaration fileParts reads and the scanner does not', () => {
  // a column-0 line inside a template that fileParts reads as a declaration: the split can't be sure
  const G = fixtureRepo('ambiguous', FIXTURE.replace('  if (x) {\n}', 'const looksLikeOne = 1;\n}'));
  assert.equal(split(...G.opts, '--out', G.out).status, 0);
  const v = split(...G.opts, '--verify', '--tree', G.out);
  assert.equal(v.status, 1, v.stdout);
  assert.match(v.stdout, /^ {2}fileParts reads a declaration the scanner doesn't: looksLikeOne \(the leaf at line \d+\)$/m);
});

test('F10: a named override places a declaration in another module, and the tree verifies', () => {
  const G = fixtureRepo('placed', FIXTURE, { ...FM, place: { bump: 'two' } });
  assert.equal(split(...G.opts, '--out', G.out).status, 0);
  assert.match(fs.readFileSync(path.join(G.out, 'src/lib/two.mjs'), 'utf8'), /^export function bump\(\)/m);
  assert.doesNotMatch(fs.readFileSync(path.join(G.out, 'src/lib/one.mjs'), 'utf8'), /^export function bump\(\)/m);
  const v = split(...G.opts, '--verify', '--tree', G.out);
  assert.equal(v.status, 0, v.stdout);
});

test('F11: a manifest start that is not in the source stops the split, naming the module', () => {
  const G = fixtureRepo('lost', FIXTURE, { ...FM, modules: [FM.modules[0], { name: 'two', from: { banner: 'no such banner' } }] });
  const r = split(...G.opts, '--out', G.out);
  assert.equal(r.status, 1, r.stderr);
  assert.ok(r.stderr.includes('module two\'s start {"banner":"no such banner"} is not in the source'), r.stderr);
  assert.equal(fs.existsSync(G.out), false);
});

test('F12: a module over the cap stops the split, naming it', () => {
  const G = fixtureRepo('cap', FIXTURE, { ...FM, cap: 100 });
  const r = split(...G.opts, '--out', G.out);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /module src\/lib\/one\.mjs is \d+ lines, over the cap of 100/);
  assert.equal(fs.existsSync(G.out), false);
});

test('F13: --count prints the sizing count by module', () => {
  const r = split(...F.opts, '--count');
  assert.equal(r.status, 0, r.stderr);
  for (const re of [/^K1 count at [0-9a-f]{8} /m, /^\| one \| \d+ \| \d+ \|$/m, /^\| two \| \d+ \| 2 \|$/m, /^Load-time statement sites .*: 1$/m, /^import\.meta\.url: 0 uses; meaning the CLI: 0; meaning the scripts folder: 0$/m, /^Lets: 1 top-level; assigned from another module: 1 at 1 sites/m, /^Marker regions over 2,000 lines: none$/m]) assert.match(r.stdout, re);
});

test('F14: every start kind and declaration form: a region start at a line-comment marker, a declaration start, async, generator, var, class, and one already exported', () => {
  assert.equal(fSplit.status, 0, fSplit.stderr);
  const three = fs.readFileSync(fMod('three'), 'utf8');
  assert.match(three, /^\/\* imports end \*\/\n\/\/ tail start$/m, 'three starts at its region');
  for (const re of [/^export async function load\(\)/m, /^export function\* gen\(\)/m, /^export var legacy = 1;$/m, /^export const PRE = 2;$/m, /^\/\/ tail end$/m]) assert.match(three, re);
  assert.doesNotMatch(three, /export export|class Shape/);
  const four = readModule(fs.readFileSync(fMod('four'), 'utf8'));
  assert.deepEqual(four.region, ["import { PRE } from './three.mjs';", "import { legacy } from './three.mjs';"]);
  assert.deepEqual(four.body, ['export class Shape { area() { return legacy + PRE; } }']);
  assert.doesNotMatch(fs.readFileSync(fMod('two'), 'utf8'), /tail start|load|Shape/);
});

test('R1: split refuses an --out inside a git checkout or its .git folder, and writes nothing', () => {
  const repo = path.join(F.dir, 'repo');
  for (const out of [path.join(repo, 'out'), path.join(repo, '.git', 'out')]) {
    const r = split(...F.opts, '--out', out);
    assert.equal(r.status, 2, `${out}: ${r.stderr}`);
    assert.match(r.stderr, /is inside the git repository/);
    assert.equal(fs.existsSync(out), false);
  }
  // . from an empty folder inside the checkout
  fs.mkdirSync(path.join(repo, 'empty'));
  const dot = run(process.execPath, [tool, ...F.opts, '--out', '.'], { cwd: path.join(repo, 'empty') });
  assert.equal(dot.status, 2, dot.stderr);
  assert.match(dot.stderr, /is inside the git repository/);
  assert.deepEqual(fs.readdirSync(path.join(repo, 'empty')), []);
});

test('R2: split writes nothing outside --out', () => {
  const box = path.join(tmp, 'box');
  fs.mkdirSync(box);
  fs.writeFileSync(path.join(box, 'keep'), 'x');
  const before = run('git', ['-C', path.join(F.dir, 'repo'), 'status', '--porcelain', '--ignored']).stdout;
  const r = split(...F.opts, '--out', path.join(box, 'out'));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(box).sort(), ['keep', 'out']);
  assert.equal(fs.readFileSync(path.join(box, 'keep'), 'utf8'), 'x');
  assert.equal(run('git', ['-C', path.join(F.dir, 'repo'), 'status', '--porcelain', '--ignored']).stdout, before, 'the repo is unchanged');
  // a non-empty --out, or one whose parent is missing, is refused
  assert.equal(split(...F.opts, '--out', path.join(box, 'out')).status, 2);
  assert.equal(split(...F.opts, '--out', path.join(box, 'no', 'out')).status, 2);
  assert.equal(fs.existsSync(path.join(box, 'no')), false);
  // a flag is never taken for --out's value
  const stray = path.join(os.tmpdir(), '--json');
  const f = split(...F.opts, '--out', '--json');
  const wrote = fs.existsSync(stray);
  fs.rmSync(stray, { recursive: true, force: true });
  assert.equal(f.status, 2, f.stderr);
  assert.equal(wrote, false, 'nothing written at ./--json');
  // a link the commit tracks above a generated file is never written through
  const L = fixtureRepo('link');
  const elsewhere = path.join(L.dir, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.symlinkSync('../../elsewhere', path.join(L.dir, 'repo', 'src', 'lib'));
  assert.equal(run('git', ['-C', path.join(L.dir, 'repo'), 'add', 'src/lib']).status, 0);
  assert.equal(run('git', ['-C', path.join(L.dir, 'repo'), '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'link']).status, 0);
  const lsha = run('git', ['-C', path.join(L.dir, 'repo'), 'rev-parse', 'HEAD']).stdout.trim();
  const l = split('--repo', path.join(L.dir, 'repo'), '--split-dir', path.join(L.dir, 'split'), '--at', lsha, '--out', path.join(L.dir, 'out'));
  assert.equal(l.status, 1, l.stderr);
  assert.match(l.stderr, /^split: src\/lib is a link in [0-9a-f]{8}; the split would write through it$/m);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
  assert.equal(fs.existsSync(path.join(L.dir, 'out')), false);
  // the caller's GIT_* variables decide neither the repository read nor the refusal
  const gbox = path.join(tmp, 'gbox');
  fs.mkdirSync(gbox);
  const e = run(process.execPath, [tool, ...F.opts, '--out', path.join(gbox, 'out')], { cwd: os.tmpdir(), env: { ...env, GIT_DIR: path.join(L.dir, 'repo', '.git') } });
  assert.equal(e.status, 0, e.stderr);
  assert.ok(fs.existsSync(path.join(gbox, 'out', 'src', 'lib', 'four.mjs')));
  // an --out that is a link, even a dangling one, is refused by name
  const dl = path.join(gbox, 'dangling');
  fs.symlinkSync(path.join(gbox, 'nowhere'), dl);
  const d = split(...F.opts, '--out', dl);
  assert.equal(d.status, 2, d.stderr);
  assert.match(d.stderr, /^split: .*dangling is a link; give the folder itself$/m);
  assert.equal(fs.existsSync(path.join(gbox, 'nowhere')), false);
});

// ---- the kit's own HEAD, with the real manifest ----
const M = JSON.parse(fs.readFileSync(path.join(root, 'test', 'split', 'manifest.json'), 'utf8'));
const sha = run('git', ['-C', root, 'rev-parse', 'HEAD']).stdout.trim();
const tree = path.join(tmp, 'head');
const lib = path.join(tree, M.dir);
// the H tests judge the tool alone: a split dir with every manifest*.json and no overlay (each
// overlay area's own test judges that area)
const headDir = path.join(tmp, 'head-split');
fs.mkdirSync(headDir);
for (const m of fs.readdirSync(path.join(root, 'test', 'split')).filter((f) => /^manifest.*\.json$/.test(f))) fs.copyFileSync(path.join(root, 'test', 'split', m), path.join(headDir, m));
const H = ['--split-dir', headDir];
const headSplit = split(...H, '--at', sha, '--out', tree);
const headVerify = headSplit.status === 0 ? split(...H, '--verify', '--at', sha, '--tree', tree) : null;
// HEAD drifted from the manifest: the H tests skip, naming what drifted. Only these drift kinds
// skip (a start gone or out of order, a module past the cap, a form the scanner can't
// read, a declaration fileParts and the scanner read differently); any other problem, or a crash,
// runs the H tests, which fail on it. The F tests carry every form, so a tool defect fails there too.
const DRIFT = [/^split: manifest\.json: manifest: module .+ (?:is not in the source|starts at line \d+, not after .+|must start at line 1)$/,
  /^split: manifest\.json: module .+ is \d+ lines, over the cap of \d+$/, /^split: manifest\.json: the declaration at line \d+ .* binds names the split can't read whole/,
  /^split: nothing written$/, /^ {2}(?:unread: |over the cap: |fileParts reads a declaration the scanner doesn't: )/];
const drifted = (lines) => lines.length > 0 && lines.every((l) => DRIFT.some((re) => re.test(l)));
const splitLines = headSplit.stderr.trim().split('\n').filter(Boolean);
const verifyLines = headVerify ? headVerify.stdout.trim().split('\n').slice(1) : [];
const STALE = headSplit.status === 1 && drifted(splitLines) ? `HEAD's split stopped: ${splitLines.slice(0, 3).join('; ')}`
  : headVerify?.status === 1 && drifted(verifyLines) ? `HEAD's tree doesn't verify: ${verifyLines.slice(0, 3).join('; ')}` : false;

test('H1: at HEAD, a full copy of the kit with the CLI in the manifest\'s modules', { skip: STALE }, () => {
  assert.equal(headSplit.status, 0, headSplit.stderr);
  // every tracked file at the commit, byte for byte (a link as a link)
  const listed = run('git', ['-C', root, 'ls-tree', '-r', sha]).stdout.split('\n').filter(Boolean).map((l) => { const [meta, file] = l.split('\t'); const [mode, , blob] = meta.split(' '); return { mode, blob, file }; });
  const plain = listed.filter((x) => x.mode !== '120000' && x.mode !== '160000');
  const hashed = run('git', ['hash-object', '--stdin-paths'], { input: plain.map((x) => path.join(tree, x.file)).join('\n') }).stdout.trim().split('\n');
  plain.forEach((x, i) => assert.equal(hashed[i], x.blob, `${x.file} is byte-equal`));
  for (const x of listed.filter((y) => y.mode === '120000')) assert.equal(fs.readlinkSync(path.join(tree, x.file)), run('git', ['-C', root, 'cat-file', 'blob', x.blob]).stdout, `${x.file} is the same link`);
  // the modules: exactly the manifest's, each under the cap, each declaration exported, regions sorted
  const got = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : got.push(path.relative(lib, path.join(d, e.name)).split(path.sep).join('/')); };
  walk(lib);
  assert.deepEqual(got.sort(), M.modules.map((m) => `${m.name}.mjs`).sort());
  for (const m of M.modules) {
    const text = fs.readFileSync(path.join(lib, `${m.name}.mjs`), 'utf8');
    const n = text.split('\n').length - 1;
    assert.ok(n <= 2000, `${m.name} is ${n} lines`);
    const { region, body } = readModule(text);
    assert.ok(region, `${m.name} opens with an imports region`);
    for (const it of items(`${body.join('\n')}\n`).items) if (it.kind === 'decl') assert.ok(it.exported, `${m.name}: ${it.names} is exported`);
    for (const l of region) assert.match(l, /^import (?:\{ [\w$]+(?: as [\w$]+)? \}|[\w$]+|\* as [\w$]+) from '[^']+';$/, `${m.name}: ${l}`);
    assert.deepEqual(region, [...region].sort(), `${m.name}'s imports are sorted`);
    const c = run(process.execPath, ['--check', path.join(lib, `${m.name}.mjs`)]);
    assert.equal(c.status, 0, `${m.name}: ${c.stderr}`);
  }
});

test('H2: at HEAD, declarations go by banner section and marker region', { skip: STALE }, () => {
  const has = (name, re) => assert.match(fs.readFileSync(path.join(lib, `${name}.mjs`), 'utf8'), re, `${name} holds ${re}`);
  has('state', /^export const here = /m); // §2's first declaration (a banner start)
  has('log-sync', /^export (?:async )?function fetchMain\(/m); // a declaration start
  has('browser', /^\/\* browser start \*\/$/m); // a region start
  has('dispatch', /^\/\* dispatch start \*\/$/m);
  assert.doesNotMatch(fs.readFileSync(path.join(lib, 'base.mjs'), 'utf8'), /^export const here = /m);
});

test('H3: at HEAD, the default entry imports every module in manifest order, they link, and the dispatch runs last', { skip: STALE }, () => {
  const entry = path.join(tree, M.entry);
  const code = fs.readFileSync(entry, 'utf8').split('\n').filter((l) => l && !l.startsWith('//') && !l.startsWith('#!'));
  assert.deepEqual(code, M.modules.map((m) => `import './lib/${m.name}.mjs';`));
  const l = link(entry);
  assert.equal(l.status, 0, l.stderr);
  assert.match(l.stdout, new RegExp(`^linked ${M.modules.length + 1} modules$`, 'm'));
  const order = l.stdout.split('order:\n')[1].trim().split('\n');
  assert.deepEqual(order.slice(-2), ['lib/dispatch.mjs', 'cli.mjs'], 'the dispatch module runs after every other module');
});

test('H4: at HEAD, verify is clean and the independent count is equal', { skip: STALE }, () => {
  const v = split(...H, '--verify', '--at', sha, '--tree', tree, '--json');
  assert.equal(v.status, 0, v.stdout);
  const j = JSON.parse(v.stdout).report[0];
  assert.deepEqual(j.problems, []);
  assert.ok(j.parts.equal && j.parts.source > 2000 && j.parts.source === j.parts.tree, JSON.stringify(j.parts));
});

test('F15: verify names a declaration not exported, one added, a module with no imports region, an unsorted region, declarations out of order, and a module over the cap', () => {
  assert.equal(fSplit.status, 0, fSplit.stderr);
  const has = (r, re) => { assert.equal(r.status, 1, r.stdout); assert.ok(r.stdout.split('\n').some((l) => re.test(l)), `${re} in:\n${r.stdout}`); };
  has(mutated(fMod('one'), (s) => s.replace('export let counter = 0;', 'let counter = 0;'), fVerify), /^ {2}not exported: counter in src\/lib\/one\.mjs$/);
  has(mutated(fMod('two'), (s) => `${s}export function extra() {}\n`, fVerify), /^ {2}added: extra \(in src\/lib\/two\.mjs\) is not in the source$/);
  has(mutated(fMod('four'), (s) => s.split('\n').slice(4).join('\n'), fVerify), /^ {2}no imports region: src\/lib\/four\.mjs does not open with/);
  has(mutated(fMod('four'), (s) => { const l = s.split('\n'); [l[1], l[2]] = [l[2], l[1]]; return l.join('\n'); }, fVerify), /^ {2}stale imports region: src\/lib\/four\.mjs; not sorted$/);
  has(mutated(fMod('three'), (s) => s.replace('export var legacy = 1;\nexport const PRE = 2;', 'export const PRE = 2;\nexport var legacy = 1;'), fVerify), /^ {2}out of order: legacy in src\/lib\/three\.mjs comes after PRE, unlike the source$/);
  const capDir = path.join(F.dir, 'split-cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'manifest.json'), JSON.stringify({ ...F.M, cap: 5 }));
  has(split('--repo', path.join(F.dir, 'repo'), '--split-dir', capDir, '--at', F.sha, '--verify', '--tree', F.out), /^ {2}over the cap: src\/lib\/one\.mjs is \d+ lines \(cap 5\)$/);
});
