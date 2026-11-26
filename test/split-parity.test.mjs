// The parity run (kit-895): test/split/parity.mjs builds the cutover tree, runs the kit's tests in it
// beside the same tests at the commit, and reports what isn't at 1:1 (parity@1). The P tests run it on
// this checkout's HEAD with two fast files; the L tests check the ledgers on a fixture repo with merge
// commits; the A and W tests build a fixture app and weigh and time fixture pages; the Y tests read
// the workflows. Nothing here runs the whole suite: that is the parity job's, on GitHub's runners.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PARTS, childEnv, compare, differing, history, gitOf, isClean, judgeStartup, judgeTest as judgeTestOf, mainlineOf,
  pageCommits, parseArgs, parseTap, readEntry, sha256, summary, testEntryPath, unportedVm, report, runPart } from './split/parity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tool = path.join(root, 'test', 'split', 'parity.mjs');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GIT_|DEVTEAM_)/.test(k)));
const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', env, maxBuffer: 1 << 28, ...o });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'split-parity-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

// ---- P: the run on this checkout's HEAD ----
const FAST = ['test/goal-approval-choices.test.mjs', 'test/world-contract.test.mjs'];
const pHome = path.join(tmp, 'p-home');
fs.mkdirSync(pHome);
const pWork = path.join(tmp, 'p-work');
const P = run(process.execPath, [tool, '--at', 'HEAD', '--repo', root, '--work', pWork, '--files', FAST.join(','), '--startup-runs', '3', '--json'], { cwd: tmp, env: { ...env, HOME: pHome, DEVTEAM_TEST_CONCURRENCY: '2' }, timeout: 240000 });
const pr = (() => { try { return JSON.parse(P.stdout); } catch { return null; } })();

test('P1: --at HEAD writes parity.json and parity.md with every field the summary names', () => {
  assert.ok(pr, `no JSON (exit ${P.status}): ${P.stderr.slice(-2000)}`);
  assert.equal(pr.parity, 1);
  assert.match(pr.sha, /^[0-9a-f]{40}$/);
  if (!pr.split.ok) { assert.equal(pr.clean, false); assert.ok(pr.split.error); return; }
  assert.equal(typeof pr.verify.clean, 'boolean');
  assert.ok(Array.isArray(pr.stale));
  assert.ok(Array.isArray(pr.failing));
  assert.ok(Array.isArray(pr.unported_vm));
  assert.equal(typeof pr.startup.ratio, 'number');
  assert.equal(pr.pages, fs.existsSync(path.join(root, 'apps')) ? pr.pages : 'no apps yet');
  assert.ok(Array.isArray(pr.page_commits.unacknowledged) || pr.page_commits.why);
  const md = fs.readFileSync(path.join(pWork, 'parity.md'), 'utf8');
  for (const line of ['- Source: ', '- Verify: ', '- Stale items: ', '- Failing tests: ', '- Unported node:vm tests: ', '- Start-up (whoami, 3 runs each): ', '- Unacknowledged page commits: ']) assert.ok(md.includes(line), `parity.md lacks "${line}"`);
  assert.ok(md.includes('- Pages: no apps yet') || md.includes('- Page '), 'parity.md names the pages');
});

test('P2: both sides ran the named files, test by test, in the tree and at the source', () => {
  assert.ok(pr?.split.ok, 'the tree was built');
  const part = JSON.parse(fs.readFileSync(path.join(pWork, 'parts', 'files.json'), 'utf8'));
  for (const side of ['source', 'tree']) {
    assert.deepEqual(part[side].files, FAST, side);
    assert.ok(part[side].tests.filter((t) => t.status === 'pass').length >= 2, `${side} ran tests`);
  }
  assert.deepEqual(pr.failing, []);
});

test('C28: the source and the tree are git repositories of one commit, so tests that ask git about the kit work', () => {
  assert.ok(pr?.split.ok, 'the tree was built');
  for (const [side, want] of [['source', 'test/run.mjs'], ['tree', 'docs/devteam/scripts/cli.mjs']]) {
    const r = run('git', ['-C', path.join(pWork, side), 'ls-files', '--', want]);
    assert.equal(r.status, 0, `git ls-files in ${side}: ${r.stderr}`);
    assert.equal(r.stdout.trim(), want, side);
  }
  // the kit checkout's origin, as test.yml's checkout has it
  const o = run('git', ['-C', root, 'remote', 'get-url', 'origin']);
  for (const side of ['source', 'tree']) {
    const r = run('git', ['-C', path.join(pWork, side), 'remote', 'get-url', 'origin']);
    if (o.status === 0) assert.equal(r.stdout.trim(), o.stdout.trim(), `origin in ${side}`);
    else assert.notEqual(r.status, 0, `no origin in ${side}`);
  }
});

test('C29: start-up takes 50 runs a side unless told otherwise', () => {
  assert.equal(parseArgs(['--at', 'x']).startupRuns, 50);
  assert.equal(parseArgs(['--at', 'x', '--startup-runs', '3']).startupRuns, 3);
});

test('P3: refusals: no --at, a bad --at, a non-empty --work, an unknown part, an unknown option; nothing written', () => {
  // bounded, so a refusal that broke can never start a real run: two fast files, one start-up run, 60 s
  const safe = ['--files', FAST[0], '--startup-runs', '1'];
  const r = (...a) => run(process.execPath, [tool, ...a, ...safe], { cwd: tmp, env: { ...env, HOME: pHome }, timeout: 60000 });
  assert.equal(r().status, 2, 'no --at');
  assert.match(r('--at', 'nope-not-a-sha', '--repo', root).stderr, /is not a commit/);
  const full = path.join(tmp, 'full');
  write(path.join(full, 'x'), 'x');
  const s = r('--at', 'HEAD', '--repo', root, '--work', full);
  assert.match(s.stderr, /not an empty folder/);
  assert.equal(s.status, 2);
  assert.deepEqual(fs.readdirSync(full), ['x']);
  assert.match(r('--at', 'HEAD', '--bogus').stderr, /unknown option --bogus/);
  assert.match(r('test', '--work', pWork, '--part', 'rest 9/9').stderr, /--part wants one of|no build.json/);
  assert.match(r('--at', 'HEAD', '--repo', root, '--work', path.join(root, 'x-parity')).stderr, /inside the git repository/);
});

// ---- the comparison and the bounds ----
const TAP = [
  '# test/a.test.mjs',
  'TAP version 13',
  '# Subtest: outer',
  '    # Subtest: inner one',
  '    ok 1 - inner one',
  '    # Subtest: inner \\# two',
  '    not ok 2 - inner \\# two',
  '    1..2',
  'not ok 1 - outer',
  '# Subtest: skipped',
  'ok 2 - skipped # SKIP no Chrome',
  '# Subtest: later',
  'ok 3 - later # TODO not yet',
  '# test/b.test.mjs',
  'TAP version 13',
  '',
  'summary: 2 files, concurrency 2',
  '',
  'test/a.test.mjs  1.0  failed (exit 1)',
  'test/b.test.mjs  300.0  failed (timed out after 300 s)',
].join('\n');

test('C4: TAP gives each test its joined name and its status; a failed file with no failing test is one failure', () => {
  const { files, tests } = parseTap(TAP);
  assert.deepEqual(files, ['test/a.test.mjs', 'test/b.test.mjs']);
  assert.deepEqual(tests, [
    { file: 'test/a.test.mjs', name: 'outer > inner one', status: 'pass' },
    { file: 'test/a.test.mjs', name: 'outer > inner # two', status: 'fail' },
    { file: 'test/a.test.mjs', name: 'outer', status: 'fail' },
    { file: 'test/a.test.mjs', name: 'skipped', status: 'skip' },
    { file: 'test/a.test.mjs', name: 'later', status: 'todo' },
    { file: 'test/b.test.mjs', name: null, status: 'fail', why: 'failed (timed out after 300 s)' },
  ]);
});

test('C6: runs at the source and skipped in the tree is failing; skipped on both is not; absent or failing in the tree is', () => {
  const t = (name, status, file = 'test/a.test.mjs') => ({ file, name, status });
  const source = { files: ['test/a.test.mjs', 'test/gone.test.mjs'], tests: [t('runs', 'pass'), t('both skip', 'skip'), t('vanishes', 'pass'), t('breaks', 'pass'), t('was skipped', 'skip')] };
  const tree = { files: ['test/a.test.mjs'], tests: [t('runs', 'skip'), t('both skip', 'skip'), t('breaks', 'fail'), t('was skipped', 'pass')] };
  const f = compare(source, tree).map((x) => `${x.file}|${x.name}|${x.why}`).sort();
  assert.deepEqual(f, [
    'test/a.test.mjs|breaks|fails in the tree',
    'test/a.test.mjs|runs|runs at the source, skipped in the tree',
    'test/a.test.mjs|vanishes|runs at the source, absent in the tree',
    'test/gone.test.mjs|null|not in the tree',
  ]);
  // a part missing: a file the tree side never ran isn't counted (the report names the missing part)
  assert.ok(!compare(source, tree, { partial: true }).some((x) => x.why === 'not in the tree'), 'partial: no "not in the tree"');
});

const base = { split: { ok: true }, verify: { clean: true }, stale: [], missing_parts: [], failing: [], differing: [], unported_vm: [], apps: 'no apps yet', page_commits: { unacknowledged: [], unported: [] } };
test('C5: start-up over 10% slower makes the report not clean; 5% does not', () => {
  const slow = judgeStartup({ runs: 50, source_ms: 100, tree_ms: 120 });
  const fine = judgeStartup({ runs: 50, source_ms: 100, tree_ms: 105 });
  assert.equal(slow.ratio, 1.2);
  assert.equal(isClean({ ...base, startup: slow }), false);
  assert.equal(isClean({ ...base, startup: fine }), true);
});

// ---- L: the ledgers, on a fixture repo with merge commits ----
const L = path.join(tmp, 'ledger');
const lg = (...a) => { const r = run('git', ['-C', L, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]); assert.equal(r.status, 0, `${a.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const merges = {};
function mergeTicket(id, files) {
  lg('checkout', '-q', '-b', `ticket/${id}`, 'main');
  for (const [f, text] of Object.entries(files)) write(path.join(L, f), typeof text === 'function' ? text() : text);
  lg('add', '-A');
  lg('commit', '-qm', id);
  lg('checkout', '-q', 'main');
  lg('merge', '-q', '--no-ff', '-m', `Merge pull request #${Object.keys(merges).length + 1} from someone/ticket/${id}`, `ticket/${id}`);
  merges[id] = lg('rev-parse', 'HEAD');
}
fs.mkdirSync(L);
lg('init', '-q', '-b', 'main');
write(path.join(L, 'docs/devteam/dashboard/index.html'), '<p>1</p>');
write(path.join(L, 'docs/devteam/dashboard/hub.html'), '<p>1</p>');
write(path.join(L, 'test/a.test.mjs'), 'a');
lg('add', '-A');
lg('commit', '-qm', 'start');
mergeTicket('kit-2-before', { 'docs/devteam/dashboard/index.html': '<p>2</p>' });
mergeTicket('kit-895-parity-run', { 'test/split/parity.mjs': '// parity' });
mergeTicket('kit-3-page', { 'docs/devteam/dashboard/index.html': '<p>3</p>' });
mergeTicket('kit-4-page', { 'docs/devteam/dashboard/hub.html': '<p>4</p>', 'docs/devteam/dashboard/index.html': '<p>4</p>' });
mergeTicket('kit-5-ledger', { [`test/split/ledger/pages/${merges['kit-4-page']}.json`]: () => JSON.stringify({ commit: merges['kit-4-page'], pages: { 'docs/devteam/dashboard/hub.html': 'kit-4-page', 'docs/devteam/dashboard/index.html': 'kit-6-later' } }) });
mergeTicket('kit-7-test', { 'test/a.test.mjs': 'a2' });
mergeTicket('kit-8-overlay', { 'test/split/overlay/apps-tests/files/test/b.test.mjs': 'b2' });
mergeTicket('kit-9-patch', { 'test/split/overlay/apps-tests/patches/c.test.mjs.patch': 'p' });
mergeTicket('kit-10-other', { 'README.md': 'r' });
mergeTicket('kit-13-wrong-patch', { 'test/split/overlay/apps-tests/patches/sub/d.test.mjs.patch': 'p' });
mergeTicket('kit-14-page-late', { 'docs/devteam/dashboard/index.html': '<p>14</p>' });
const LSHA = lg('rev-parse', 'HEAD');
// a PR's head: branched before kit-7, it takes main in by a merge of main (second parent), then commits
lg('checkout', '-q', '-b', 'ticket/kit-12-branch', merges['kit-5-ledger']);
write(path.join(L, 'x.txt'), 'x');
lg('add', '-A');
lg('commit', '-qm', 'kit-12 work');
lg('merge', '-q', '--no-ff', '-m', "Merge branch 'main' into ticket/kit-12-branch", 'main');
write(path.join(L, 'y.txt'), 'y');
lg('add', '-A');
lg('commit', '-qm', 'kit-12 more');
const BRANCH = lg('rev-parse', 'HEAD');
lg('checkout', '-q', 'main');
const lgit = gitOf(L);
const hist = history(lgit, LSHA);
const entries = new Map();
const read = (rel) => (entries.has(rel) ? { entry: entries.get(rel) } : fs.existsSync(path.join(L, rel)) ? { entry: JSON.parse(fs.readFileSync(path.join(L, rel), 'utf8')) } : { none: true });
// entries are written against the source text 'orig' unless said; judgeTest reads that source unless said
const entry = (file, ticket, text, src = 'orig') => entries.set(testEntryPath(file), { file, ticket, sha256: sha256(text), source_sha256: src === null ? null : sha256(src) });
const judgeTest = (o) => judgeTestOf({ sourceText: 'orig', ...o });

test('C7: a differing test is accepted with a matching hash, a merged ticket and a PR diff that touches it', () => {
  entry('test/a.test.mjs', 'kit-7-test', 'a in the tree');
  assert.deepEqual(judgeTest({ file: 'test/a.test.mjs', treeText: 'a in the tree', read, hist }), { accepted: true, ticket: 'kit-7-test' });
});

test('C8: a wrong hash, an unmerged ticket, or a merged PR that didn\'t touch the test: not accepted, the rule named', () => {
  const judged = () => judgeTest({ file: 'test/a.test.mjs', treeText: 'a in the tree', read, hist });
  entry('test/a.test.mjs', 'kit-7-test', 'other text');
  assert.match(String(judged().why), /the tree's text has sha256/, 'a wrong hash is named');
  entry('test/a.test.mjs', 'kit-11-unmerged', 'a in the tree');
  assert.match(String(judged().why), /kit-11-unmerged is not merged/, 'an unmerged ticket is named');
  entry('test/a.test.mjs', 'kit-10-other', 'a in the tree');
  assert.match(String(judged().why), /doesn't touch test\/a\.test\.mjs/, 'a PR that didn\'t touch the test is named');
  assert.match(judgeTest({ file: 'test/none.test.mjs', treeText: 'x', read, hist }).why, /no ledger entry test\/split\/ledger\/tests\/none\.test\.mjs\.json/);
});

test('C18: the hash is of the tree\'s text, never the source\'s', () => {
  const src = path.join(tmp, 'c18-src'), tr = path.join(tmp, 'c18-tree');
  write(path.join(src, 'test/a.test.mjs'), 'a2');
  write(path.join(tr, 'test/a.test.mjs'), 'a2, rewritten in the tree');
  write(path.join(src, 'test/same.test.mjs'), 's');
  write(path.join(tr, 'test/same.test.mjs'), 's');
  assert.deepEqual(differing({ source: src, tree: tr }), [{ file: 'test/a.test.mjs', change: 'changed', treeText: 'a2, rewritten in the tree', sourceText: 'a2' }]);
  entry('test/a.test.mjs', 'kit-7-test', 'a2');
  assert.equal(judgeTest({ file: 'test/a.test.mjs', treeText: 'a2, rewritten in the tree', read, hist }).accepted, false);
  entry('test/a.test.mjs', 'kit-7-test', 'a2, rewritten in the tree');
  assert.equal(judgeTest({ file: 'test/a.test.mjs', treeText: 'a2, rewritten in the tree', read, hist }).accepted, true);
});

test('C19: a PR diff that touches only the overlay path making the test counts: files/test/<f> or patches/<f>.patch', () => {
  entry('test/b.test.mjs', 'kit-8-overlay', 'b2');
  assert.equal(judgeTest({ file: 'test/b.test.mjs', treeText: 'b2', read, hist }).accepted, true);
  entry('test/c.test.mjs', 'kit-9-patch', 'c2');
  assert.equal(judgeTest({ file: 'test/c.test.mjs', treeText: 'c2', read, hist }).accepted, true);
  // a patch counts only at its own path: patches/sub/d.test.mjs.patch is not test/d.test.mjs's
  entry('test/d.test.mjs', 'kit-13-wrong-patch', 'd2');
  assert.match(String(judgeTest({ file: 'test/d.test.mjs', treeText: 'd2', read, hist }).why), /doesn't touch test\/d\.test\.mjs/);
});

test('C21: on a PR head that took main in, merged tickets and page commits come from main\'s first-parent line', () => {
  const mainline = mainlineOf(lgit, BRANCH, 'main');
  assert.equal(mainline, LSHA, 'the latest main commit the branch holds');
  assert.equal(history(lgit, BRANCH).merged('kit-10-other'), false, 'the head\'s own first-parent line misses it (why main\'s is read)');
  assert.equal(history(lgit, mainline).merged('kit-10-other'), true);
  assert.equal(mainlineOf(lgit, BRANCH, 'no-such-ref'), BRANCH, 'no main ref: the sha itself');
});

test('C30: report() at a PR head that took main in reads main\'s line: a ticket and a page commit merged after the branch point count', async () => {
  const work = path.join(tmp, 'c30-work');
  write(path.join(work, 'build.json'), JSON.stringify({ parity: 1, sha: BRANCH, files: ['test/a.test.mjs'], split: { ok: true, stale: [] }, verify: { clean: true, problems: [] } }));
  write(path.join(work, 'parts/files.json'), JSON.stringify({ part: 'files', source: { files: [], tests: [] }, tree: { files: [], tests: [] } }));
  write(path.join(work, 'source/test/a.test.mjs'), 'orig');
  write(path.join(work, 'tree/test/a.test.mjs'), 'a in the tree');
  write(path.join(work, 'source', testEntryPath('test/a.test.mjs')), JSON.stringify({ file: 'test/a.test.mjs', ticket: 'kit-7-test', sha256: sha256('a in the tree'), source_sha256: sha256('orig') }));
  assert.equal(history(lgit, BRANCH).merged('kit-7-test'), false, 'the head\'s own line misses kit-7');
  const r = await report({ sha: BRANCH, repo: L, work, mainRef: 'main' });
  assert.equal(r.main, LSHA, 'report names mainline');
  assert.deepEqual(r.differing.map((d) => [d.file, d.accepted]), [['test/a.test.mjs', true]], 'kit-7, merged on main after the branch point, accepts the entry');
  assert.ok(r.page_commits.unacknowledged.some((c) => c.commit === merges['kit-14-page-late']), 'a page commit on main after the branch point is listed');
});

test('C24: an entry is void once the test changed on main since it was written (source_sha256)', () => {
  entry('test/a.test.mjs', 'kit-7-test', 'a in the tree', 'orig');
  const r = judgeTest({ file: 'test/a.test.mjs', treeText: 'a in the tree', sourceText: 'orig, and a new case on main', read, hist });
  assert.equal(r.accepted, false, 'a change on main voids the entry');
  assert.match(r.why, /changed on main since/);
  entry('test/new.test.mjs', 'kit-7-test', 'added in the tree', null);
  assert.match(String(judgeTest({ file: 'test/new.test.mjs', treeText: 'added in the tree', sourceText: null, read, hist }).why), /doesn't touch|not merged/, 'an added file pins source_sha256 null');
});

test('C25: a node:vm page test stays unported while its tree text still evaluates a page, rewritten or not', () => {
  const src = path.join(tmp, 'c25-src'), tr = path.join(tmp, 'c25-tree');
  const vm = "import vm from 'node:vm';\nconst page = read('docs/devteam/dashboard/index.html');\nconst cli = read('docs/devteam/scripts/devteam.mjs');\n";
  for (const f of ['same', 'rewritten', 'ported']) write(path.join(src, `test/${f}.test.mjs`), vm);
  write(path.join(src, 'test/plain.test.mjs'), "const x = 'index.html';\n");
  write(path.join(tr, 'test/same.test.mjs'), vm);
  write(path.join(tr, 'test/rewritten.test.mjs'), vm.replace("read('docs/devteam/scripts/devteam.mjs')", 'cliSource()'));
  write(path.join(tr, 'test/ported.test.mjs'), "import { x } from '../apps/dashboard/lib-dist/x.js';\n");
  write(path.join(tr, 'test/plain.test.mjs'), "const x = 'index.html';\n");
  assert.deepEqual(unportedVm({ source: src, tree: tr }), ['test/rewritten.test.mjs', 'test/same.test.mjs']);
});

test('C26: a ledger entry that is not JSON, too big, short of a field, or for another file is a bad entry', () => {
  const dir = path.join(tmp, 'c26');
  const put = (f, text) => write(path.join(dir, testEntryPath(f)), text);
  put('test/j.test.mjs', '{ not json');
  put('test/big.test.mjs', JSON.stringify({ file: 'test/big.test.mjs', pad: 'x'.repeat(70000) }));
  put('test/short.test.mjs', JSON.stringify({ file: 'test/short.test.mjs', ticket: 'kit-7-test' }));
  put('test/other.test.mjs', JSON.stringify({ file: 'test/else.test.mjs', ticket: 'kit-7-test', sha256: sha256('t'), source_sha256: null }));
  const why = (f) => judgeTest({ file: f, treeText: 't', read: (rel) => readEntry(dir, rel), hist }).why;
  assert.match(why('test/j.test.mjs'), /bad entry .*not JSON/);
  assert.match(why('test/big.test.mjs'), /bad entry .*over 65536 bytes/);
  assert.match(why('test/short.test.mjs'), /bad entry .*wants/);
  assert.match(why('test/other.test.mjs'), /bad entry .*wants \{ "file": "test\/other\.test\.mjs"/);
});

test('C2: a split that refuses gives a report that says the tree wasn\'t built, and isn\'t clean', () => {
  const sd = path.join(tmp, 'c2-split');
  write(path.join(sd, 'manifest.json'), JSON.stringify({ source: 'src/tool.mjs', dir: 'src/lib', entry: 'src/cli.mjs', cap: 2000, modules: [{ name: 'one', from: { line: 1 } }], place: {} }));
  const home = path.join(tmp, 'c2-home');
  fs.mkdirSync(home);
  const r = run(process.execPath, [tool, '--at', LSHA, '--repo', L, '--split-dir', sd, '--work', path.join(tmp, 'c2-work'), '--files', 'test/a.test.mjs', '--startup-runs', '1', '--json'], { cwd: tmp, env: { ...env, HOME: home }, timeout: 120000 });
  assert.equal(r.status, 1, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.split.ok, false);
  assert.match(j.split.error, /src\/tool\.mjs is not in/);
  assert.equal(j.clean, false);
  assert.match(fs.readFileSync(path.join(tmp, 'c2-work', 'parity.md'), 'utf8'), /- Verify: tree not built: split: manifest\.json: src\/tool\.mjs is not in/);
});

test('C9: page commits after the baseline need a ledger entry; one names its tickets; before the baseline none count', () => {
  const pc = pageCommits({ git: lgit, mainline: LSHA, read, hist });
  assert.equal(pc.baseline, merges['kit-895-parity-run']);
  assert.deepEqual(pc.unacknowledged.map((c) => c.commit), [merges['kit-3-page'], merges['kit-14-page-late']]);
  assert.deepEqual(pc.unported, [{ commit: merges['kit-4-page'], open: [{ page: 'docs/devteam/dashboard/index.html', ticket: 'kit-6-later' }] }]);
  assert.ok(!JSON.stringify(pc).includes(merges['kit-2-before']), 'a page commit before the baseline is not listed');
});

// ---- Y: the workflows ----
const testYml = fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8');
test('C3: PARTS are test.yml\'s Node 24 parts, in order, with alone first in rest 1/5', () => {
  const rows = [...testYml.matchAll(/^\s*- \{ node: 24, part: ([^,]+), key: ([^,]+), groups: ([^,]+), shard: '?([^,'} ]*)'?(, alone: true)?/gm)];
  assert.ok(rows.length >= 2, 'test.yml has Node 24 rows');
  assert.deepEqual(PARTS.map((p) => [p.part, p.key, p.groups, p.shard, !!p.alone]), rows.map((m) => [m[1], m[2], m[3], m[4], !!m[5]]));
});

test('C32: each part runs test.yml\'s commands for it: alone first where test.yml has it, then its group and shard', () => {
  const d = path.join(tmp, 'c32');
  const log = path.join(d, 'calls.jsonl');
  write(path.join(d, 'test/run.mjs'), `import fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\nconsole.log('TAP version 13');\n`);
  const rows = [...testYml.matchAll(/^\s*- \{ node: 24, part: ([^,]+), key: [^,]+, groups: ([^,]+), shard: '?([^,'} ]*)'?(, alone: true)?/gm)];
  assert.ok(rows.length >= 2, 'test.yml has Node 24 rows');
  for (const [, part, groups, shard, alone] of rows) {
    fs.rmSync(log, { force: true });
    runPart({ root: d, part: PARTS.find((p) => p.part === part), files: null, home: path.join(d, 'home'), concurrency: 1 });
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l).filter((a, i, all) => a !== '--concurrency' && all[i - 1] !== '--concurrency'));
    const want = [...(alone ? [['--group', 'alone']] : []), ['--group', groups, ...(shard ? ['--shard', shard] : [])]];
    assert.deepEqual(calls, want, part);
  }
});

