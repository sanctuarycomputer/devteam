// The kit's tests in the generated tree (kit-893, cutover-tree@1 Tests in the tree, What a test change
// may do): the overlay's tests area (test/split/overlay/tests/) writes test/lib/cli-source.mjs, rewires
// every node:fs read of a test that names the CLI through cliRead (and, beside the gateway's area, each
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
