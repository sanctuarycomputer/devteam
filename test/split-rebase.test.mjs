// split --rebase (kit-896): test/split/rebase.mjs carries a branch begun on the single-file CLI onto
// a tree whose CLI is in modules. Every test runs on a fixture repo the test makes: a small CLI at
// docs/devteam/scripts/devteam.mjs, a tree commit holding it split by test/split's own build(), and
// branches off the source commit.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './split/lib/split.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tool = path.join(root, 'test', 'split', 'rebase.mjs');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GIT_|DEVTEAM_)/.test(k)));
const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', env, maxBuffer: 1 << 28, ...o });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'split-rebase-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const SRC = 'docs/devteam/scripts/devteam.mjs';
const LIB = 'docs/devteam/scripts/lib';
const PAGE = 'docs/devteam/dashboard/index.html';
const M = { source: SRC, dir: LIB, cap: 2000, modules: [{ name: 'one', from: { line: 1 } }, { name: 'two', from: { banner: '2. two' } }] };
const splitDir = path.join(tmp, 'split');
fs.mkdirSync(splitDir);
fs.writeFileSync(path.join(splitDir, 'manifest.json'), JSON.stringify(M));

const BASE = `#!/usr/bin/env node
// a fixture CLI
import fs from 'node:fs';
import path from 'node:path';

// ===== 1. one =====

const A = 1;
// greet someone
function greet(n) { return \`hi \${n}\`; }
function twice(x) { return x * 2; }

// ===== 2. two =====

let counter = 0;
function useA() { return A; }
function shout(n) { return greet(n).toUpperCase(); }
function size(p) { return fs.statSync(p).size; }
function overridden() { return 1; }
function gone() { return useA(); }
`;
const PAGE_TEXT = '<!doctype html>\n<title>Overview</title>\n<p>None</p>\n';

let n = 0;
// a repo: the source commit S, the tree commit T (the CLI split into lib/: S's, or treeSrc as main
// moved on since S), and what each test adds
function fixture(treeEdit, treeSrc) {
  const repo = path.join(tmp, `r${++n}`);
  fs.mkdirSync(repo);
  const git = (...a) => { const r = run('git', ['-C', repo, ...a]); assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  const put = (f, t) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), t); };
  put(SRC, BASE);
  put(PAGE, PAGE_TEXT);
  put('README.md', 'a fixture\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'S');
  const S = git('rev-parse', 'HEAD');
  if (treeSrc) put(SRC, treeSrc);
  const b = build(treeSrc ?? BASE, M);
  assert.deepEqual(b.problems, []);
  for (const m of b.modules) put(m.file, treeEdit ? treeEdit(m.file, m.text) : m.text);
  git('add', '-A');
  git('commit', '-q', '-m', 'T');
  const T = git('rev-parse', 'HEAD');
  // a branch off S: edit(text) gives its new source; files: other files it writes
  const branch = (name, edit, files = {}) => {
    git('checkout', '-q', '-b', name, S);
    if (edit) put(SRC, edit(BASE));
    for (const [f, t] of Object.entries(files)) put(f, t);
    git('add', '-A');
    git('commit', '-q', '-m', name);
    git('checkout', '-q', 'main');
    return git('rev-parse', name);
  };
  // the tool's temporary folder goes in a folder of the fixture's own, so the test sees it removed
  const tmpdir = path.join(tmp, `t${n}`);
  fs.mkdirSync(tmpdir);
  const rebase = (...a) => run(process.execPath, [tool, ...a, '--repo', repo, '--split-dir', splitDir], { cwd: os.tmpdir(), env: { ...env, TMPDIR: tmpdir } });
  // what the repo's own work tree and index hold, which the tool must never change
  const state = () => [git('status', '--porcelain', '--untracked-files=all'), fs.readFileSync(path.join(repo, '.git', 'index')).toString('hex')];
  const show = (ref, f) => run('git', ['-C', repo, 'show', `${ref}:${f}`]).stdout;
  const exists = (ref) => run('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${ref}`]).status === 0;
  return { repo, git, S, T, b, branch, rebase, show, exists, state, tmpdir };
}

// the branch of the first done-when: two functions changed (twice in one, size in two, size now
// naming twice and path, so two's region gains two imports), and a line of the old page
const twoFunctions = (s) => s
  .replace('function twice(x) { return x * 2; }', 'function twice(x) { return x * 3; }')
  .replace('function size(p) { return fs.statSync(p).size; }', 'function size(p) { return twice(fs.statSync(path.resolve(p)).size); }');
const f1 = fixture();
const feat = f1.branch('feat', twoFunctions, { [PAGE]: PAGE_TEXT.replace('None', 'Nothing yet') });
const s1 = f1.state();
const r1 = f1.rebase('feat', '--onto', 'main');

test('D1: a branch changing two functions is carried onto the tree as those two functions in their modules, with the imports regions regenerated', () => {
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  assert.ok(f1.exists('feat-modules'), 'the branch feat-modules is made');
  assert.equal(f1.git('rev-parse', 'feat-modules^'), f1.T, 'one commit on the tree commit');
  const files = f1.git('diff', '--name-only', f1.T, 'feat-modules').split('\n');
  assert.deepEqual(files, [`${LIB}/one.mjs`, `${LIB}/two.mjs`], 'the diff is the two modules and nothing else');
  const two = f1.show('feat-modules', `${LIB}/two.mjs`);
  assert.match(two, /^import \{ twice \} from '\.\/one\.mjs';$/m, 'two imports twice, which size now names');
  assert.match(two, /^import path from 'node:path';$/m, 'two imports path, which size now names');
  assert.match(two, /^export function size\(p\) \{ return twice\(fs\.statSync\(path\.resolve\(p\)\)\.size\); \}$/m);
  // each module is exactly what a split of the branch's head would make
  const want = build(twoFunctions(BASE), M);
  for (const m of want.modules) assert.equal(f1.show('feat-modules', m.file), m.text, `${m.file} as the split of the head`);
  assert.match(r1.stdout, /^ {2}carried: twice \(changed\) in docs\/devteam\/scripts\/lib\/one\.mjs$/m);
  assert.match(r1.stdout, /^ {2}carried: size \(changed\) in docs\/devteam\/scripts\/lib\/two\.mjs$/m);
  assert.equal(f1.git('rev-parse', 'feat'), feat, 'the branch itself unchanged');
});

test('S1: the repo\'s work tree and index are unchanged, and the temporary folder is gone, on success and on a conflict', () => {
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  assert.deepEqual(f1.state(), s1, 'work tree and index unchanged after a carry');
  assert.deepEqual(fs.readdirSync(f1.tmpdir), [], 'no temporary folder left after a carry');
  const f = fixture();
  f.branch('docs', null, { 'README.md': 'a fixture, changed\n' });
  fs.writeFileSync(path.join(f.repo, 'README.md'), 'the tree\'s own\n');
  f.git('commit', '-q', '-am', 'T2');
  const before = f.state();
  const r = f.rebase('docs', '--onto', 'main');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual(f.state(), before, 'work tree and index unchanged after a patch conflict');
  assert.deepEqual(fs.readdirSync(f.tmpdir), [], 'no temporary folder left after a patch conflict');
});

test('D2: the old page\'s change is listed as page work for an apps carry-over ticket, and not applied', () => {
  assert.match(r1.stdout, /^ {2}page work for an apps carry-over ticket, not applied: docs\/devteam\/dashboard\/index\.html$/m);
  assert.equal(f1.show('feat-modules', PAGE), PAGE_TEXT, 'the tree\'s page is unchanged');
});

test('D3a: a change to a declaration the overlay overrides is a conflict naming it, and nothing is written', () => {
  // the tree as an overlay leaves it: overridden() replaced
  const f = fixture((file, text) => text.replace('export function overridden() { return 1; }', 'export function overridden() { return 2; } // the overlay\'s'));
  f.branch('ov', (s) => s.replace('function overridden() { return 1; }', 'function overridden() { return 3; }'));
  const r = f.rebase('ov', '--onto', 'main');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^ {2}conflict: overridden: the tree's copy in docs\/devteam\/scripts\/lib\/two\.mjs differs from the branch's base/m);
  assert.match(r.stdout, /^conflicts: nothing written$/m);
  assert.equal(f.exists('ov-modules'), false, 'no branch made');
});

test('D3b: a top-level statement added outside every declaration is a conflict naming the declaration before it', () => {
  const f = fixture();
  f.branch('st', (s) => s.replace('function twice(x) { return x * 2; }\n', 'function twice(x) { return x * 2; }\nconsole.log(twice(A));\n'));
  const r = f.rebase('st', '--onto', 'main');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^ {2}conflict: twice: the branch adds a top-level statement outside every declaration, after it: console\.log\(twice\(A\)\);$/m);
  assert.equal(f.exists('st-modules'), false, 'no branch made');
});

test('A1: an added declaration goes after the one before it in the head; a removed one leaves, and the regions that named it lose it', () => {
  const f = fixture();
  const edit = (s) => s
    .replace('function greet(n) { return `hi ${n}`; }\n', 'function greet(n) { return `hi ${n}`; }\nfunction thrice(x) { return x * 3; }\n')
    .replace('function gone() { return useA(); }\n', '')
    .replace('// ===== 2. two =====\n\n', '// ===== 2. two =====\n\nfunction fresh() { return 0; }\n')
    .replace('function shout(n) { return greet(n).toUpperCase(); }', 'function shout(n) { return greet(n).toUpperCase() + thrice(1); }');
  f.branch('add', edit);
  const r = f.rebase('add', '--onto', 'main');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const want = build(edit(BASE), M);
  for (const m of want.modules) assert.equal(f.show('add-modules', m.file), m.text, `${m.file} as the split of the head`);
  assert.match(r.stdout, /^ {2}carried: thrice \(added\) in docs\/devteam\/scripts\/lib\/one\.mjs$/m);
  assert.match(r.stdout, /^ {2}carried: gone \(removed\) in docs\/devteam\/scripts\/lib\/two\.mjs$/m);
  assert.match(r.stdout, /^ {2}carried: fresh \(added\) in docs\/devteam\/scripts\/lib\/two\.mjs$/m, 'fresh goes where the split puts it: first in two');
});

test('I1: a regenerated region keeps an import the tree has and the branch\'s head lacks (main added it after the base)', () => {
  const moved = BASE.replace("import path from 'node:path';\n", "import path from 'node:path';\nimport os from 'node:os';\n")
    .replace('function size(p) { return fs.statSync(p).size; }\n', 'function size(p) { return fs.statSync(p).size; }\nfunction home() { return os.homedir(); }\n');
  const f = fixture(null, moved);
  f.branch('old', (s) => s.replace('function size(p) { return fs.statSync(p).size; }', 'function size(p) { return fs.statSync(p).size + 1; }'));
  const r = f.rebase('old', '--onto', 'main');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const two = f.show('old-modules', `${LIB}/two.mjs`);
  assert.match(two, /^import os from 'node:os';$/m, 'two still imports os, which home uses');
  assert.match(two, /^export function size\(p\) \{ return fs\.statSync\(p\)\.size \+ 1; \}$/m);
});

test('D3c: a carried declaration that makes a new overlay rule site is a conflict naming it: a let of another module assigned, import.meta, a load-time read of another module', () => {
  const cases = [
    ['as', (s) => s.replace('function twice(x) { return x * 2; }', 'function twice(x) { counter++; return x * 2; }'), /^ {2}conflict: twice: the branch assigns counter, a let of another module \(docs\/devteam\/scripts\/lib\/two\.mjs\)/m],
    ['meta', (s) => s.replace('function greet(n) { return `hi ${n}`; }', 'function greet(n) { return `hi ${n} ${import.meta.url}`; }'), /^ {2}conflict: greet: the branch adds a use of import\.meta/m],
    ['load', (s) => s.replace('const A = 1;', 'const A = useA.length;'), /^ {2}conflict: A: runs at load and the branch has it name useA, of another module/m],
  ];
  for (const [name, edit, re] of cases) {
    const f = fixture();
    f.branch(name, edit);
    const r = f.rebase(name, '--onto', 'main');
    assert.equal(r.status, 1, `${name}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, re);
    assert.equal(f.exists(`${name}-modules`), false, `${name}: no branch made`);
  }
});

test('A2: other files the branch changed are applied; one that does not apply to the tree is a conflict naming it', () => {
  const f = fixture();
  f.branch('docs', null, { 'README.md': 'a fixture, changed\n' });
  const r = f.rebase('docs', '--onto', 'main');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(f.show('docs-modules', 'README.md'), 'a fixture, changed\n');
  assert.match(r.stdout, /^ {2}applied: README\.md$/m);
  // the tree changed README.md since the base: the patch doesn't apply
  f.git('checkout', '-q', 'main');
  fs.writeFileSync(path.join(f.repo, 'README.md'), 'the tree\'s own\n');
  f.git('commit', '-q', '-am', 'T2');
  const r2 = f.rebase('docs', '--onto', 'main', '--name', 'docs-2');
  assert.equal(r2.status, 1, r2.stdout + r2.stderr);
  assert.match(r2.stdout, /^ {2}conflict: README\.md: the branch's change doesn't apply to the tree/m);
  assert.equal(f.exists('docs-2'), false, 'no branch made');
});

test('R1: refusals: a branch or --onto that is no commit, a --name that exists; nothing written', () => {
  const f = fixture();
  f.branch('x', twoFunctions);
  const refs = () => f.git('for-each-ref', '--format=%(refname)');
  const before = refs();
  for (const [a, re] of [
    [['nope', '--onto', 'main'], /the branch nope is not a commit/],
    [['x', '--onto', 'nope'], /--onto nope is not a commit/],
    [['x', '--onto', 'main', '--name', 'main'], /the branch main exists/],
    [['x'], /--onto <tree commit> is required/],
  ]) {
    const r = f.rebase(...a);
    assert.equal(r.status, 2, `${a.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, re);
  }
  assert.equal(refs(), before, 'no ref made');
});
