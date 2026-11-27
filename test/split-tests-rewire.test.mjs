// The kit's tests in the generated tree (kit-893, cutover-tree@1 Tests in the tree, What a test change
// may do): the overlay's tests area (test/split/overlay/tests/) writes test/lib/cli-source.mjs, rewires
// every node:fs read in every test file through cliRead (and, beside the gateway's area, each
// read of the gateway's text through gatewaySource) by one rule, writes the rules test
// test/cli-modules.test.mjs, and its finding.mjs is the test-change check the parity run calls. Three
// trees are generated at this checkout's HEAD, in parallel, from the manifests and the areas named:
//   A: gateway and tests (the split alone for the CLI: its modules are the source's declarations)
//   B: gateway, load-time and tests (the CLI as the tree runs it: cli.mjs, init(), the setters)
//   C: as A, with a patch this file makes for one test, as a test the rule can't match would have
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tool = path.join(root, 'test', 'split', 'split.mjs');
const splitSrc = path.join(root, 'test', 'split');
const AREA = path.join(splitSrc, 'overlay', 'tests');
const CLI = 'docs/devteam/scripts/devteam.mjs';
// W7's patch, made here from HEAD's file and put in tree C's copy of the area only
// dashboard-copy.test.mjs, or (if a ticket removes it) the first test file in test/
const PATCHED = fs.existsSync(path.join(root, 'test/dashboard-copy.test.mjs')) ? 'test/dashboard-copy.test.mjs' : `test/${fs.readdirSync(path.join(root, 'test')).filter((f) => f.endsWith('.test.mjs') && !f.startsWith('split-')).sort()[0]}`;
const PATCH = `${path.posix.basename(PATCHED)}.patch`;
const ADDED = '// a line only a patch adds (W7)';
// NODE_TEST_CONTEXT too: a test run this one starts would otherwise report to this runner, not print
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GIT_|DEVTEAM_|NODE_TEST_CONTEXT$|TMUX)/.test(k)));
const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', env, maxBuffer: 1 << 28, timeout: 240e3, ...o });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'split-tests-rewire-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const home = fs.mkdtempSync(path.join(tmp, 'home-'));
// a scratch HOME, the hub's port away from the box's, every DEVTEAM_* variable unset
const quiet = { ...env, HOME: home, DEVTEAM_HUB_PORT: '4999' };
const source = fs.readFileSync(path.join(root, CLI), 'utf8');
const sha = run('git', ['-C', root, 'rev-parse', 'HEAD']).stdout.trim();

// A split dir with the manifests, the tool's lib and the overlay areas named, and its tree at HEAD.
function splitDirWith(name, areas) {
  const d = path.join(tmp, `split-${name}`);
  fs.cpSync(splitSrc, d, { recursive: true });
  for (const a of fs.readdirSync(path.join(d, 'overlay'))) if (!areas.includes(a)) fs.rmSync(path.join(d, 'overlay', a), { recursive: true, force: true });
  return d;
}
function makeTree(name, areas, prepare) {
  const sd = splitDirWith(name, areas), out = path.join(tmp, `tree-${name}`);
  if (prepare) prepare(sd);
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [tool, '--at', sha, '--repo', root, '--split-dir', sd, '--out', out, '--json'], { cwd: tmp, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '', e = '';
    c.stdout.on('data', (b) => { o += b; });
    c.stderr.on('data', (b) => { e += b; });
    const kill = setTimeout(() => c.kill('SIGKILL'), 240e3);
    c.on('close', (status) => {
      clearTimeout(kill);
      let j = {};
      try { j = JSON.parse(o); } catch { /* the first test names it */ }
      resolve({ status, err: e, j, out, read: (f) => (fs.existsSync(path.join(out, f)) ? fs.readFileSync(path.join(out, f), 'utf8') : null) });
    });
  });
}
// the area's exports, loaded once; where the area is missing (main before this ticket) each test that
// uses one fails on it, not the whole file
const load = async (f, dir = AREA) => { try { return await import(pathToFileURL(path.join(dir, f)).href); } catch (err) { return { err }; } };
const rules = await load('rules.mjs'), finding = await load('finding.mjs');
// W7's patch: one line added to what the rule makes of HEAD's file (no patch where the rule is missing)
const patchedText = (() => {
  if (typeof rules.rewireReads !== 'function') return null;
  const s = run('git', ['-C', root, 'show', `${sha}:${PATCHED}`]).stdout;
  return s ? rules.rewireReads(PATCHED, s, { gateway: true }).text : null;
})();
const addPatch = (sd) => {
  if (patchedText === null) return;
  const l = patchedText.split('\n');
  const dir = path.join(sd, 'overlay', 'tests', 'patches');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, PATCH), `diff --git a/${PATCHED} b/${PATCHED}\n--- a/${PATCHED}\n+++ b/${PATCHED}\n@@ -1,3 +1,4 @@\n ${l[0]}\n+${ADDED}\n ${l[1]}\n ${l[2]}\n`);
};
const [A, B, C] = await Promise.all([makeTree('A', ['gateway', 'tests']), makeTree('B', ['gateway', 'load-time', 'tests']), makeTree('C', ['gateway', 'tests'], addPatch)]);
// every top-level await comes before the first test(): on Node 18 a root whose tests have all ended
// at an await runs after() early, which removes the trees
const jsLib = await import(pathToFileURL(path.join(splitSrc, 'lib', 'js.mjs')).href);
const mine = (T, key) => (T.j.overlay?.[key] ?? []).filter((x) => x.area === 'tests');
const items = (list) => list.map((x) => `${x.kind} ${x.name}`);
const need = (m, name) => { assert.equal(typeof m[name], 'function', `the tests area exports ${name}: ${m.err?.message ?? 'not exported'}`); return m[name]; };
const rewireCliReads = (...a) => need(rules, 'rewireCliReads')(...a);
const rewireReads = (...a) => need(rules, 'rewireReads')(...a);
const sameBeyondFinding = (...a) => need(finding, 'sameBeyondFinding')(...a);
const CLI_HELPER = 'test/lib/cli-source.mjs';
const helperOf = async (T) => (await import(pathToFileURL(path.join(T.out, CLI_HELPER)).href)).cliSource;

const expectItems = () => ['rule cli-source', 'rule test-reads', 'file test/cli-modules.test.mjs'];

test('W1: in both trees the tests area is applied whole, nothing of it stale, no conflict naming it', () => {
  for (const [n, T] of [['A', A], ['B', B]]) {
    assert.equal(T.status, 0, `tree ${n}: ${T.err}`);
    assert.deepEqual(items(mine(T, 'applied')), expectItems(), `tree ${n}: every item of the tests area is applied`);
    assert.deepEqual(mine(T, 'stale'), [], `tree ${n}: nothing of the tests area is stale`);
    assert.deepEqual((T.j.overlay?.conflicts ?? []).filter((c) => c.areas.includes('tests')), [], `tree ${n}: no conflict names the tests area`);
  }
});

test('W2: in tree A, cliSource() is the single file\'s source byte for byte', async () => {
  const cliSource = await helperOf(A);
  const got = cliSource();
  const a = got.split('\n'), b = source.split('\n');
  const first = a.findIndex((l, i) => l !== b[i]);
  assert.equal(got, source, `the helper's text differs from ${CLI} first at line ${first + 1}: ${JSON.stringify(a[first])} for ${JSON.stringify(b[first])}`);
});

test('W3: in tree B, a /* name start */ slice and a ^const line find the source\'s text, but where load-time changed a declaration', async () => {
  const got = (await helperOf(B))();
  // what load-time changed, by its own report: each site is "<module> <declaration or item> <what>"
  const changed = new Set((B.j.overlay?.applied ?? []).filter((a) => a.area === 'load-time').flatMap((a) => a.sites).map((s) => s.split(' ').slice(1).join(' ').match(/^(\(head\)|marker [\w.-]+ (?:start|end)|[A-Za-z_$][\w$,]*)/)?.[1]).flatMap((k) => (k && !k.startsWith('(') && !k.startsWith('marker') ? k.split(',') : [k])));
  assert.ok(changed.size > 20, `load-time's report names what it changed (${changed.size})`);
  const have = new Set(got.split('\n'));
  const consts = source.split('\n').filter((l) => /^const [A-Za-z_$][\w$]* =/.test(l));
  assert.ok(consts.length > 1000, `the source has its ^const lines (${consts.length})`);
  const lost = consts.filter((l) => !have.has(l) && !changed.has(l.match(/^const ([A-Za-z_$][\w$]*)/)[1]));
  assert.deepEqual(lost, [], '^const lines missing from the helper\'s text that load-time did not change');
  const slice = (s, k) => { const i = s.indexOf(`/* ${k} start */`), j = s.indexOf(`/* ${k} end */`); return i < 0 || j < i ? null : s.slice(i, j); };
  const names = [...new Set([...source.matchAll(/\/\* ([\w.-]+) start \*\//g)].map((m) => m[1]))];
  assert.ok(names.length > 20, `the source has its marker regions (${names.length})`);
  const declsIn = (s) => [...s.matchAll(/^(?:async )?(?:function\*? |const |let |var |class )([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const unexplained = names.filter((k) => slice(got, k) !== slice(source, k)).filter((k) => !changed.has(`marker ${k} start`) && !declsIn(slice(source, k) ?? '').some((n) => changed.has(n)));
  assert.deepEqual(unexplained, [], 'marker regions whose text differs where load-time changed nothing in them');
});

// ---- the rewrite, case by case: each way a test calls node:fs to read a file ----
// Only the callee changes: the read's arguments stay as written, and cliRead looks at the path when the
// test runs, so the path's form (a join, a URL, a helper's parameter, a copy's) is not the rule's concern.
const head = "import fs from 'node:fs';\nimport path from 'node:path';\nimport { readFileSync } from 'node:fs';\nimport fsp, { readFile } from 'node:fs/promises';\n// reads docs/devteam/scripts/devteam.mjs\n";
const IMPORT = /^import fsp, \{ readFile \} from 'node:fs\/promises';\nimport \{ cli\w+(?:, cli\w+)* \} from '\.\/lib\/cli-source\.mjs';$/m;
const FORMS = [
  ['fs.readFileSync', "const s = fs.readFileSync(p, 'utf8');", /^const s = cliRead\(fs\.readFileSync, fs, p, 'utf8'\);$/m],
  ['an imported readFileSync', 'const s = readFileSync(p);', /^const s = cliRead\(readFileSync, undefined, p\);$/m],
  ['fs.promises.readFile', "const s = await fs.promises.readFile(p, 'utf8');", /^const s = await cliReadAsync\(fs\.promises\.readFile, fs\.promises, p, 'utf8'\);$/m],
  ['a fs/promises module\'s readFile', 'const s = await fsp.readFile(p);', /^const s = await cliReadAsync\(fsp\.readFile, fsp, p\);$/m],
  ['an imported readFile', 'const s = await readFile(p);', /^const s = await cliReadAsync\(readFile, undefined, p\);$/m],
  ['a spread of a read', "const s = [...fs.readFileSync(p, 'utf8')];", /^const s = \[\.\.\.cliRead\(fs\.readFileSync, fs, p, 'utf8'\)\];$/m],
  ['a helper that reads any path', "const read = (...q) => fs.readFileSync(path.join(root, ...q), 'utf8');", /^const read = \(\.\.\.q\) => cliRead\(fs\.readFileSync, fs, path\.join\(root, \.\.\.q\), 'utf8'\);$/m],
  ['a callback fs.readFile', "fs.readFile(p, 'utf8', (e, s) => {});", /^cliReadCallback\(fs\.readFile, fs, p, 'utf8', \(e, s\) => \{\}\);$/m],
  ['a read handed on as a value', 'const io = { readFile: fs.promises.readFile, rs: fs.readFileSync, same: fs.readFileSync === x };', /^const io = \{ readFile: cliReaderAsync\(fs\.promises\.readFile, fs\.promises\), rs: cliReader\(fs\.readFileSync, fs\), same: fs\.readFileSync === x \};$/m],
  ['a read across lines', "const s = fs\n  .readFileSync(\n    p,\n    'utf8');", /^const s = cliRead\(fs\.readFileSync, fs, \n {4}p,\n {4}'utf8'\);$/m],
];
FORMS.forEach(([what, body, want], i) => {
  test(`W4: the rule sends a read by ${what} through cliRead, once, and the file still parses`, () => {
    const file = 'test/some.test.mjs';
    const r = rewireCliReads(file, `${head}\n${body}\n`);
    assert.deepEqual(r.refused, []);
    assert.match(r.text, want);
    assert.match(r.text, IMPORT, 'the helper\'s import follows the last import');
    assert.equal(rewireCliReads(file, r.text).text, r.text, 'a second pass changes nothing');
    const f = path.join(tmp, `w4-${i}.mjs`);
    fs.writeFileSync(f, r.text);
    assert.equal(run(process.execPath, ['--check', f]).status, 0, 'the rewired file parses');
  });
});
test('W4l: what is not a node:fs read is left as written, and a file with no node:fs import is unchanged', () => {
  const plain = "import { readFileSync } from './lib/kit.mjs';\n// docs/devteam/scripts/devteam.mjs\nconst s = readFileSync(p, 'utf8');\n";
  assert.equal(rewireCliReads('test/other.test.mjs', plain).text, plain, 'a file with no node:fs import');
  const notReads = `${head}const a = o.readFileSync(p);\nconst b = x.fs.readFileSync(p);\nconst c = { readFileSync: (f) => f };\nconst d = 'fs.readFileSync(p)';\n// fs.readFileSync(p)\nconst e = \`\${fs.existsSync(p)} fs.readFileSync(p)\`;\n`;
  assert.equal(rewireCliReads('test/some.test.mjs', notReads).text, notReads, 'a stand-in\'s, another object\'s, a key, a string, a comment, a template');
});

// A copy of tree A whose devteam.mjs is no longer the CLI's text (a stand-in for the shim, kit-892): a
// test passes there only if its reads of the CLI go through the helper.
const STAND_IN = "#!/usr/bin/env node\n// a stand-in for the shim: not the CLI's text\nthrow new Error('stand-in shim');\n";
const shimTree = (() => {
  let d = null;
  return () => {
    if (d) return d;
    d = path.join(tmp, 'tree-A-shim');
    fs.cpSync(A.out, d, { recursive: true });
    fs.writeFileSync(path.join(d, CLI), STAND_IN);
    return d;
  };
})();
test('W4r: in tree A with a stand-in shim, a rewired read of the CLI by any path form gets the single file\'s text; other files are read as they are', () => {
  const probe = `import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import fsp from 'node:fs/promises';
// reads docs/devteam/scripts/devteam.mjs by each path form, a copy, and a descriptor
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const kit = path.join(root, 'docs', 'devteam');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const at = path.join(kit, 'scripts', 'devteam.mjs');
const fd = fs.openSync(at, 'r');
const out = {
  join: fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8'),
  url: fs.readFileSync(new URL('../docs/devteam/scripts/devteam.mjs', import.meta.url), 'utf8'),
  fileURLToPath: fs.readFileSync(fileURLToPath(new URL('../docs/devteam/scripts/devteam.mjs', import.meta.url)), 'utf8'),
  relative: fs.readFileSync(path.relative(process.cwd(), at), 'utf8'),
  helper: read('docs', 'devteam', 'scripts', 'devteam.mjs'),
  options: fs.readFileSync(at, { encoding: 'utf8' }),
  imported: readFileSync(at, 'utf8'),
  buffer: fs.readFileSync(at).toString('utf8'),
  isBuffer: Buffer.isBuffer(fs.readFileSync(at)),
  bufferPath: fs.readFileSync(Buffer.from(at), 'utf8'),
  promises: await fs.promises.readFile(at, 'utf8'),
  fsp: await fsp.readFile(at, 'utf8'),
  callback: await new Promise((res, rej) => fs.readFile(at, 'utf8', (e, s) => (e ? rej(e) : res(s)))),
  copy: fs.readFileSync(process.argv[2], 'utf8'),
  descriptor: fs.readFileSync(fd, 'utf8'),
};
process.stdout.write(JSON.stringify(out));
`;
  const d = shimTree(), file = 'test/w4r-probe.mjs';
  const r = rewireCliReads(file, probe);
  fs.writeFileSync(path.join(d, file), r.text);
  const copy = path.join(tmp, 'w4r-copy', 'devteam.mjs');
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  fs.writeFileSync(copy, 'a fixture\'s copy\n');
  const p = run(process.execPath, [file, copy], { cwd: d, env: quiet, timeout: 60e3 });
  assert.equal(p.status, 0, p.stderr);
  const out = JSON.parse(p.stdout);
  for (const k of ['join', 'url', 'fileURLToPath', 'relative', 'helper', 'options', 'imported', 'buffer', 'bufferPath', 'promises', 'fsp', 'callback']) assert.ok(out[k] === source, `${k}: the read gets the single file's text (${JSON.stringify(String(out[k]).slice(0, 60))})`);
  assert.equal(out.isBuffer, true, 'a read with no encoding gets a Buffer');
  assert.equal(out.copy, 'a fixture\'s copy\n', 'a copy elsewhere is read as it is');
  assert.equal(out.descriptor, STAND_IN, 'a read by descriptor is the file\'s own');
});

// The oracle for "every read": in tree A, any reference to readFileSync or readFile (a call or not: an
// alias, a destructuring, a .call) on the file's node:fs import, or bare, in any test file, that is not
// cliRead's or cliReadAsync's first argument. It does not ask the rule what it rewrote, and it reads
// every test file, whether or not its text names the CLI.
function unwrapped(T, added) {
  const { scan } = jsLib;
  const left = [];
  let files = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(T.out, d), { withFileTypes: true })) {
      const f = `${d}/${e.name}`;
      if (e.isDirectory()) { if (f !== 'test/split') walk(f); continue; }
      if (!f.endsWith('.mjs') || f.startsWith('test/split-') || f === CLI_HELPER || f === 'test/lib/gateway-source.mjs' || added.has(f)) continue;
      const text = T.read(f);
      files++;
      const code = scan(text).code;
      const fsNames = [...text.matchAll(/^import (?:\* as )?([\w$]+)\b[^;]*?from '(?:node:)?fs(?:\/promises)?';/gm)].map((m) => m[1]);
      for (const m of code.matchAll(/(?<![\w$])(readFileSync|readFile)\b/g)) {
        const before = code.slice(Math.max(0, m.index - 60), m.index), after = code.slice(m.index + m[0].length, m.index + m[0].length + 3);
        const lineAt = text.slice(0, m.index).split('\n').length;
        if (/^import\b/.test(text.split('\n')[lineAt - 1])) continue;
        const member = /(?<!\.)\.\s*$/.test(before);
        if (member && !fsNames.some((n) => new RegExp(String.raw`(?<![\w$])(?<!(?:^|[^.])\.)${n.replace(/\$/g, '\\$')}\s*\.\s*(promises\s*\.\s*)?$`).test(before))) continue;
        if (!member && /^\s*:/.test(after)) continue;
        if (/cli(?:Read|Reader)(Async|Callback)?\(\s*([\w$]+\s*\.\s*)?(promises\s*\.\s*)?$/.test(before) && /^\s*,/.test(after)) continue;
        left.push(`${f}:${lineAt}: ${text.split('\n')[lineAt - 1].trim().slice(0, 120)}`);
      }
    }
  };
  walk('test');
  return { left, files };
}
test('W5: in tree A every node:fs read in a test file goes through the helper, by an oracle that is not the rule', (t) => {
  const added = new Set(mine(A, 'applied').filter((a) => a.kind === 'file').map((a) => a.name));
  const { left, files } = unwrapped(A, added);
  assert.ok(files >= 400, `the kit's test files (${files})`);
  assert.deepEqual(left, [], 'reads not through the helper left in the tree');
  const sites = mine(A, 'applied').find((a) => a.name === 'test-reads')?.sites ?? [];
  const through = sites.filter((s) => /node:fs reads? through cliRead/.test(s));
  assert.ok(through.length >= 300, `the rule sends the kit's tests' reads through the helper (${through.length} files)`);
  // the forms in use, for the PR body
  const count = (re) => through.reduce((n, s) => n + [...(A.read(s.split(' ')[0]) ?? '').matchAll(re)].length, 0);
  t.diagnostic(`files ${through.length}; cliRead(fs.readFileSync ${count(/cliRead\(fs\.readFileSync,/g)}; cliRead(readFileSync ${count(/cliRead\(readFileSync,/g)}; cliReadAsync(fs.promises.readFile ${count(/cliReadAsync\(fs\.promises\.readFile,/g)}; other cliReadAsync ${count(/cliReadAsync\((?!fs\.promises\.readFile,)/g)}`);
});

// Tests that read the CLI's text and run nothing, run in the stand-in copy: whole files, and one test of
// three more, each read by a form a path-based rule could not place (a helper's parameters, a fixture's
// module, an environment-chosen path), and two that read through a path imported from a fixture and never
// name the CLI. A row whose file, or whose named test, is gone at HEAD is skipped.
const RUNS = [
  ['test/pane-question.parse.test.mjs'], ['test/box-health-claude.test.mjs'], ['test/dashboard-loop.test.mjs'], ['test/dashboard-copy.test.mjs'],
  ['test/box-health-park.test.mjs'], ['test/box-health-room.test.mjs'],
  ['test/project-hosts-contract.test.mjs', 'every first segment the dashboard server answers is reserved'],
  ['test/browser-lock.test.mjs', 'the function is cut from devteam.mjs'],
];
for (const [file, name] of RUNS) {
  const at = path.join(root, file);
  const gone = (!fs.existsSync(at) && `${file} is gone at HEAD`) || (name && !fs.readFileSync(at, 'utf8').includes(name) && `${file} has no test "${name}" at HEAD`);
  test(`W6: in tree A with a stand-in shim, ${file}${name ? ` "${name}"` : ''} passes`, { timeout: 200e3, skip: gone }, () => {
    const r = run(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', ...(name ? [`--test-name-pattern=${name}`] : []), file], { cwd: shimTree(), env: quiet, timeout: 180e3 });
    assert.match(r.stdout, /^# fail 0$/m, `${file} in the tree:\n${r.stdout.slice(-3000)}${r.stderr.slice(-1000)}`);
    assert.doesNotMatch(r.stdout, /^# pass 0$/m, 'it ran tests');
    assert.equal(r.status, 0);
  });
}
test('W6: in tree A with a stand-in shim, the world fixture\'s checker cuts schemaErrors from the CLI\'s text', { skip: !fs.existsSync(path.join(root, 'test/fixtures/world/check.mjs')) && 'gone at HEAD' }, () => {
  const r = run(process.execPath, ['--input-type=module', '-e', "await import('./test/fixtures/world/check.mjs'); process.stdout.write('loaded');"], { cwd: shimTree(), env: quiet, timeout: 60e3 });
  assert.equal(r.stdout, 'loaded', r.stderr.slice(-1500));
});

test('W7: a patch in the area is applied after the rule, listed naming its test, and replayed by the test-change check', async () => {
  assert.notEqual(patchedText, null, 'the tests area exports rewireReads');
  assert.equal(C.status, 0, C.err);
  assert.deepEqual(mine(C, 'stale'), [], 'nothing of the tests area is stale in tree C');
  assert.deepEqual(mine(C, 'applied').find((a) => a.kind === 'patch' && a.name === PATCH)?.sites, [PATCHED], 'the patch is listed, naming the test');
  const l = patchedText.split('\n');
  assert.equal(C.read(PATCHED), [l[0], ADDED, ...l.slice(1)].join('\n'), 'the tree\'s file is the rule\'s text with the patch on it');
  const source0 = run('git', ['-C', root, 'show', `${sha}:${PATCHED}`]).stdout;
  const inC = await load('finding.mjs', path.join(tmp, 'split-C', 'overlay', 'tests'));
  assert.equal(inC.sameBeyondFinding?.(source0, C.read(PATCHED), PATCHED), true, 'the area\'s finding replays its patch');
  assert.equal(sameBeyondFinding(source0, C.read(PATCHED), PATCHED), false, 'without the patch in the area, the added line is a difference');
});

// ---- the test-change check ----
test('W8: sameBeyondFinding accepts a test that differs only in how it finds its source, and flags one whose assertion differs', () => {
  const file = 'test/some.test.mjs';
  const src = `${head.replace("import { kit, kit as KIT } from './lib/kit.mjs';\n", '')}import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { kit } from './lib/kit.mjs';\nconst src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');\ntest('t', () => { assert.ok(src.includes('cmdMerge')); });\n`;
  const tree = rewireReads(file, src, { gateway: true }).text;
  assert.notEqual(tree, src, 'the fixture is rewired');
  assert.equal(sameBeyondFinding(src, tree, file), true, 'only how it finds its source');
  assert.equal(sameBeyondFinding(src, tree.replace("includes('cmdMerge')", "includes('cmdDone')"), file), false, 'an assertion changed');
  assert.equal(sameBeyondFinding(src, tree.replace("test('t', () =>", "test('t', { timeout: 1 }, () =>"), file), false, 'a timing changed');
  assert.equal(sameBeyondFinding(src, src.replace("includes('cmdMerge')", "includes('cmdDone')"), file), false, 'an assertion changed with no finding change');
  assert.equal(sameBeyondFinding(src, tree, 'docs/devteam/scripts/devteam.mjs'), false, 'not a test');
});
// W9's source is this checkout and tree B is HEAD's, so a kit test edited and not yet committed shows here
// as a changed test the check does not accept; commit it (CI's checkout is HEAD's, so CI never sees this).
test('W9: with the parity run\'s own differing(), every test the tests area changed in tree B is accepted; only added files are left', async () => {
  const { differing, findingChecks } = await import(pathToFileURL(path.join(root, 'test', 'split', 'parity.mjs')).href);
  const without = differing({ source: root, tree: B.out });
  assert.ok(without.filter((d) => d.change === 'changed').length >= 50, `the area changes the kit's tests (${without.length} differ before the check)`);
  const left = differing({ source: root, tree: B.out, checks: await findingChecks(root) });
  assert.deepEqual(left.filter((d) => d.change === 'changed').map((d) => d.file), [], 'changed tests the check does not accept');
});

// ---- the rules test, in tree B, and each of its rules seen failing ----
// A copy of what the rules test reads (the CLI's folder, the split tool's lib, the test itself), with a
// change made to one module.
function rulesCopy(name, change) {
  const d = path.join(tmp, `rules-${name}`);
  for (const p of ['docs/devteam/scripts', 'test/split/lib', 'test/cli-modules.test.mjs']) fs.cpSync(path.join(B.out, p), path.join(d, p), { recursive: true });
  if (change) change(path.join(d, 'docs/devteam/scripts/lib'));
  return d;
}
const rulesRun = (cwd, pattern) => {
  const r = run(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', ...(pattern ? [`--test-name-pattern=${pattern}`] : []), 'test/cli-modules.test.mjs'], { cwd, env: quiet, timeout: 280e3 });
  return { r, top: new Map([...r.stdout.matchAll(/^(ok|not ok) \d+ - (M\d) /gm)].map((m) => [m[2], m[1]])) };
};
test('W10: in tree B, test/cli-modules.test.mjs passes M1 to M5', { timeout: 300e3 }, () => {
  const { r, top } = rulesRun(B.out);
  assert.deepEqual(['M1', 'M2', 'M3', 'M4', 'M5'].map((m) => [m, top.get(m) ?? 'did not run']), ['M1', 'M2', 'M3', 'M4', 'M5'].map((m) => [m, 'ok']), r.stdout.slice(-3000));
  assert.equal(r.status, 0);
});
const append = (f, s) => (lib) => fs.appendFileSync(path.join(lib, f), s);
const MUTANTS = [
  ['M1', 'a module that prints while it loads', append('links.mjs', "console.log('loaded');\n")],
  ['M2', 'import.meta.url in a module but state and settings', append('links.mjs', 'export const mutantWhereM2 = import.meta.url;\n')],
  ['M3', 'an import region with a line its module does not need', (lib) => { const f = path.join(lib, 'links.mjs'); const t = fs.readFileSync(f, 'utf8'); fs.writeFileSync(f, t.replace('/* imports end */', "import { notAName } from './base.mjs';\n/* imports end */")); }],
  ['M4', 'a module of 2,001 lines', append('links.mjs', '//\n'.repeat(2001))],
  ['M5', 'a lib module that imports the entry', append('links.mjs', "export const mutantLaterM5 = () => import('../cli.mjs');\n")],
];
for (const [m, what, change] of MUTANTS) {
  test(`W11: the rules test fails ${m} alone on ${what}`, { timeout: 300e3 }, () => {
    // M1 is the slow one (a Node per module): run it alone on its own mutant, the rest without it
    const { r, top } = rulesRun(rulesCopy(m, change), m === 'M1' ? '^M1 ' : '^M[2-5] ');
    const want = (m === 'M1' ? ['M1'] : ['M2', 'M3', 'M4', 'M5']).map((x) => [x, x === m ? 'not ok' : 'ok']);
    assert.deepEqual(want.map(([x]) => [x, top.get(x) ?? 'did not run']), want, r.stdout.slice(-3000));
  });
}
