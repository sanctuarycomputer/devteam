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
import { canDrive, openChrome } from './lib/chrome.mjs';
import {
  PARTS, buildApps, childEnv, compare, differing, firstData, history, gitOf, isClean, judgeStartup, judgeTest as judgeTestOf, mainlineOf,
  pageCommits, pageServer, parseArgs, parseTap, readEntry, sha256, summary, testEntryPath, unportedVm, weigh, report, build, runPart } from './split/parity.mjs';

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
// P judges the parity run alone: a split dir with every manifest*.json and no overlay, as
// split-tool's H tests do. An overlay area may change what FAST reads (pages-docs empties the
// dashboard page goal-approval-choices reads); each area's own test judges that area.
const pSplit = path.join(tmp, 'p-split');
fs.mkdirSync(pSplit);
for (const m of fs.readdirSync(path.join(root, 'test', 'split')).filter((f) => /^manifest.*\.json$/.test(f))) fs.copyFileSync(path.join(root, 'test', 'split', m), path.join(pSplit, m));
const P = run(process.execPath, [tool, '--at', 'HEAD', '--repo', root, '--split-dir', pSplit, '--work', pWork, '--files', FAST.join(','), '--startup-runs', '3', '--json'], { cwd: tmp, env: { ...env, HOME: pHome, DEVTEAM_TEST_CONCURRENCY: '2' }, timeout: 240000 });
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

test('C33: two run.mjs outputs joined (rest 1/5: alone, then the shard) are both read; a skip in the second\'s tree is failing', () => {
  const out = (file, line) => [`# ${file}`, 'TAP version 13', '# Subtest: t', line, '', 'summary: 1 file, concurrency 2', '', `${file}  1.0  ok`].join('\n');
  const joined = (line) => `${out('test/alone.test.mjs', 'ok 1 - t')}\n${out('test/shard.test.mjs', line)}\n`;
  const src = parseTap(joined('ok 1 - t')), tr = parseTap(joined('ok 1 - t # SKIP no tool'));
  assert.deepEqual(src.tests.map((x) => x.file), ['test/alone.test.mjs', 'test/shard.test.mjs'], 'the second output\'s tests are read');
  assert.deepEqual(compare(src, tr), [{ file: 'test/shard.test.mjs', name: 't', why: 'runs at the source, skipped in the tree' }]);
});

test('C37: a test name a file repeats is matched by occurrence: a skipped twin behind a passing one is failing', () => {
  const side = (second) => ({ files: ['test/r.test.mjs'], tests: [{ file: 'test/r.test.mjs', name: 'same', status: 'pass' }, { file: 'test/r.test.mjs', name: 'same', status: second }] });
  assert.deepEqual(compare(side('pass'), side('skip')), [{ file: 'test/r.test.mjs', name: 'same', why: 'runs at the source, skipped in the tree' }]);
  assert.deepEqual(compare(side('pass'), side('pass')), []);
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

test('C34: each of a stale item, a missing part, an unported node:vm test and an unaccepted differing test alone makes the report not clean; the summary lists a stale item', () => {
  const ok = { ...base, sha: 'a'.repeat(40), pages: 'no apps yet', startup: judgeStartup({ runs: 50, source_ms: 100, tree_ms: 100 }) };
  assert.equal(isClean(ok), true, 'the base is clean');
  assert.equal(isClean({ ...ok, stale: [{ area: 'tests', kind: 'hash conflict', name: 'x' }] }), false, 'a stale item');
  assert.equal(isClean({ ...ok, missing_parts: ['chrome 4/4'] }), false, 'a missing part');
  assert.equal(isClean({ ...ok, unported_vm: ['test/v.test.mjs'] }), false, 'an unported node:vm test');
  assert.equal(isClean({ ...ok, differing: [{ file: 'test/d.test.mjs', change: 'changed', accepted: false, why: 'no ledger entry' }] }), false, 'an unaccepted differing test');
  assert.equal(isClean({ ...ok, differing: [{ file: 'test/d.test.mjs', change: 'changed', accepted: true, ticket: 'kit-7-test' }] }), true, 'an accepted one is fine');
  const r = { ...ok, stale: [{ area: 'tests', kind: 'hash conflict', name: 'x' }] };
  r.clean = isClean(r);
  assert.match(summary(r), /- Stale items: 1\n/);
  assert.match(summary(r), /## Stale items \(1\)\n\n- \{"area":"tests","kind":"hash conflict","name":"x"\}/);
});

test('C16: a page three times today\'s weight and time is printed and leaves the report clean', () => {
  const r = { ...base, sha: 'a'.repeat(40), startup: judgeStartup({ runs: 50, source_ms: 100, tree_ms: 100 }), page_commits: { ...base.page_commits },
    pages: [{ page: 'hub', weight: { today: 70000, own: 210000, runtime: 135000, own_ratio: 3, whole_ratio: 4.9 }, time: { today_ms: 100, app_ms: 300, ratio: 3 } }] };
  r.clean = isClean(r);
  assert.equal(r.clean, true);
  assert.match(summary(r), /- Page hub: own 210\.0 KB vs today 70\.0 KB \(3\.00×\), runtime 135\.0 KB, whole 4\.90×; first data 300 ms vs today 100 ms \(3\.00×\) \(reported, never failing\)/);
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

test('C35: build carries split\'s --json stale items into build.json and still tests the stale tree', async () => {
  const stub = path.join(tmp, 'c35-split.mjs');
  write(stub, `import fs from 'node:fs';
const a = process.argv.slice(2);
if (a.includes('--verify')) { console.log(JSON.stringify({ clean: true, report: [] })); process.exit(0); }
const out = a[a.indexOf('--out') + 1];
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(out + '/README.md', 'tree');
console.log(JSON.stringify({ stale: [{ area: 'tests', kind: 'hash conflict', name: 'x' }] }));
`);
  const work = path.join(tmp, 'c35-work');
  const b = await build({ sha: LSHA, repo: L, work, startupRuns: 1, files: ['test/a.test.mjs'], split: stub });
  assert.equal(b.split.ok, true, 'a stale tree is built');
  assert.deepEqual(b.split.stale, [{ area: 'tests', kind: 'hash conflict', name: 'x' }]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(work, 'build.json'), 'utf8')).split.stale, b.split.stale);
});

test('C9: page commits after the baseline need a ledger entry; one names its tickets; before the baseline none count', () => {
  const pc = pageCommits({ git: lgit, mainline: LSHA, read, hist });
  assert.equal(pc.baseline, merges['kit-895-parity-run']);
  assert.deepEqual(pc.unacknowledged.map((c) => c.commit), [merges['kit-3-page'], merges['kit-14-page-late']]);
  assert.deepEqual(pc.unported, [{ commit: merges['kit-4-page'], open: [{ page: 'docs/devteam/dashboard/index.html', ticket: 'kit-6-later' }] }]);
  assert.ok(!JSON.stringify(pc).includes(merges['kit-2-before']), 'a page commit before the baseline is not listed');
});

// ---- A and W: apps, weight and time ----
function demoApp(dir) {
  write(path.join(dir, 'apps/demo/package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', private: true, scripts: { build: 'node build.mjs' } }));
  write(path.join(dir, 'apps/demo/package-lock.json'), JSON.stringify({ name: 'demo', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'demo', version: '1.0.0' } } }));
  write(path.join(dir, 'apps/demo/.npmrc'), 'audit=false\nfund=false\nupdate-notifier=false\n');
  write(path.join(dir, 'apps/demo/build.mjs'), `import fs from 'node:fs';
fs.mkdirSync('out', { recursive: true }); fs.mkdirSync('lib-dist', { recursive: true });
fs.writeFileSync('out/index.html', '<p>demo</p>');
fs.writeFileSync('out/base-path.txt', JSON.stringify(process.env.DEVTEAM_BASE_PATH ?? null));
fs.writeFileSync('lib-dist/x.js', 'export const x = 1;');
`);
}
test('C13: on Node 24 each app builds with an empty base path, out/ lands in docs/devteam/apps/<app>/, lib-dist/ stays', () => {
  const tree = path.join(tmp, 'apps-tree');
  demoApp(tree);
  const home = path.join(tmp, 'apps-home');
  fs.mkdirSync(home);
  const [a] = buildApps({ tree, home, major: 24 });
  assert.equal(a.ok, true, a.why);
  assert.equal(fs.readFileSync(path.join(tree, 'docs/devteam/apps/demo/index.html'), 'utf8'), '<p>demo</p>');
  assert.equal(fs.readFileSync(path.join(tree, 'docs/devteam/apps/demo/base-path.txt'), 'utf8'), '""');
  assert.ok(fs.existsSync(path.join(tree, 'apps/demo/lib-dist/x.js')));
  const other = path.join(tmp, 'apps-tree-22');
  demoApp(other);
  assert.deepEqual(buildApps({ tree: other, home, major: 22 }), [{ app: 'demo', ok: false, why: 'apps build on Node 24 only (this is Node 22)' }]);
  assert.equal(buildApps({ tree: path.join(tmp, 'no-apps'), home }), 'no apps yet');
});

const OUT = path.join(tmp, 'out');
write(path.join(OUT, 'index.html'), '<html><script src="/_next/static/chunks/rt.js"></script><script src="/_next/static/chunks/home.js"></script><script nomodule src="/_next/static/chunks/poly.js"></script><link rel="stylesheet" href="/_next/static/css/a.css"></html>');
write(path.join(OUT, 'view/canvas/index.html'), '<html><script src="/_next/static/chunks/rt.js"></script><script src="/_next/static/chunks/canvas.js"></script><link rel="stylesheet" href="/_next/static/css/a.css"></html>');
write(path.join(OUT, '404.html'), '<html><script src="/_next/static/chunks/rt.js"></script></html>');
write(path.join(OUT, '_next/static/chunks/rt.js'), 'r'.repeat(5000) + Math.random());
write(path.join(OUT, '_next/static/chunks/home.js'), 'fetch("/api/x").then((r) => r.json()).then(() => { document.body.dataset.data = "1"; });');
write(path.join(OUT, '_next/static/chunks/canvas.js'), 'c'.repeat(100));
write(path.join(OUT, '_next/static/chunks/poly.js'), 'p'.repeat(100000) + Math.random());
write(path.join(OUT, '_next/static/css/a.css'), 'body{}');

test('C14: the runtime is the files every exported page names; own is the rest plus the page; nomodule is not counted', async () => {
  const zlib = await import('node:zlib');
  const g = (f) => zlib.gzipSync(fs.readFileSync(path.join(OUT, f)), { level: 6 }).length;
  const w = weigh({ out: OUT, route: '/', oldHtml: Buffer.from('<p>today</p>') });
  assert.equal(w.runtime, g('_next/static/chunks/rt.js'));
  assert.equal(w.own, g('index.html') + g('_next/static/chunks/home.js') + g('_next/static/css/a.css'));
  assert.equal(w.today, zlib.gzipSync(Buffer.from('<p>today</p>'), { level: 6 }).length);
});

test('C15: time to first data, today and in the app; a page that asks for no data is not measured', { skip: canDrive ? false : 'needs Chrome and Node 22+ (lib/chrome.mjs canDrive)' }, async (t) => {
  const chrome = await openChrome();
  t.after(() => chrome.close());
  const today = await pageServer({ route: '/', html: '<script>fetch("/api/data").then((r) => r.json())</script>' });
  t.after(() => today.close());
  const app = await pageServer({ route: '/', html: fs.readFileSync(path.join(OUT, 'index.html')), out: OUT });
  t.after(() => app.close());
  const quiet = await pageServer({ route: '/', html: '<p>no data</p>' });
  t.after(() => quiet.close());
  assert.equal(typeof await firstData(chrome, `${today.origin}/`, { loads: 2 }), 'number');
  assert.equal(typeof await firstData(chrome, `${app.origin}/`, { loads: 2 }), 'number');
  assert.equal(await firstData(chrome, `${quiet.origin}/`, { loads: 1, wait: 1500 }), null);
});

// ---- Y: the workflows ----
const stress = fs.readFileSync(path.join(root, '.github/workflows/test-stress.yml'), 'utf8');
const testYml = fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8');
test('C3: PARTS are test.yml\'s Node 24 parts, in order, with alone first in rest 1/5', () => {
  const rows = [...testYml.matchAll(/^\s*- \{ node: 24, part: ([^,]+), key: ([^,]+), groups: ([^,]+), shard: '?([^,'} ]*)'?(, alone: true)?/gm)];
  assert.ok(rows.length >= 2, 'test.yml has Node 24 rows');
  assert.deepEqual(PARTS.map((p) => [p.part, p.key, p.groups, p.shard, !!p.alone]), rows.map((m) => [m[1], m[2], m[3], m[4], !!m[5]]));
});

test('C36: test-stress\'s parity-test matrix is PARTS, part for part and key for key', () => {
  const m = /^  parity-test:\n((?:    .*\n|\s*\n)*)/m.exec(stress)?.[1] ?? '';
  const rows = [...m.matchAll(/^\s*- \{ part: ([^,]+), key: ([^,}]+)/gm)].map((x) => [x[1], x[2].trim()]);
  assert.deepEqual(rows, PARTS.map((p) => [p.part, p.key]));
});

test('C31: the report step writes parity.md to the job summary and exits as the report, under GitHub\'s bash -e', () => {
  const step = /^      - name: report\n        run: \|\n((?: {10}.*\n)+)/m.exec(job('parity-report') ?? '')?.[1]?.replace(/^ {10}/gm, '');
  assert.ok(step, 'parity-report has a report step');
  const d = path.join(tmp, 'c31'), bin = path.join(d, 'bin'), rt = path.join(d, 'rt');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(rt, 'parity'), { recursive: true });
  // a stand-in for node: writes the report files and exits 1, as a report that isn't clean does
  write(path.join(bin, 'node'), '#!/bin/bash\necho "# parity@1: not clean" > "$RUNNER_TEMP/parity/parity.md"\necho summary\nexit 1\n');
  fs.chmodSync(path.join(bin, 'node'), 0o755);
  assert.equal(run('tar', ['-C', rt, '-cf', path.join(rt, 'parity-work.tar'), 'parity']).status, 0);
  write(path.join(d, 'step.sh'), step);
  const sum = path.join(d, 'summary.md');
  write(sum, '');
  const r = run('bash', ['--noprofile', '--norc', '-eo', 'pipefail', path.join(d, 'step.sh')], { cwd: d, env: { ...env, PATH: `${bin}:${env.PATH}`, RUNNER_TEMP: rt, GITHUB_STEP_SUMMARY: sum, SHA: 'a'.repeat(40) } });
  assert.equal(r.status, 1, `the step exits as the report: ${r.stderr}`);
  assert.match(fs.readFileSync(sum, 'utf8'), /# parity@1: not clean/, 'parity.md reaches the job summary');
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

test('C27: the parity parts get test.yml\'s tools and switches: the same pinned installs, the same rest parts, DEVTEAM_TEST_* passed through', () => {
  const blocks = (y) => [...y.matchAll(/^ *- if: matrix\.gitleaks\n *run: \|\n((?: {10}.*\n)+)/gm)].map((m) => m[1].replace(/^ +/gm, ''));
  assert.equal(blocks(testYml).length, 2, 'test.yml installs gitleaks, then sops and age');
  assert.deepEqual(blocks(stress), blocks(testYml));
  const gl = (y, re) => [...y.matchAll(re)].map((m) => m[1]);
  assert.deepEqual(gl(stress, /^\s*- \{ part: ([^,]+), key: [^,}]+, gitleaks: true \}/gm), gl(testYml, /^\s*- \{ node: 24, part: ([^,]+),.*gitleaks: true/gm));
  assert.match(stress, /DEVTEAM_TEST_GITLEAKS: \$\{\{ matrix\.gitleaks && '1' \|\| '' \}\}/);
  assert.match(stress, /DEVTEAM_TEST_SOPS: \$\{\{ matrix\.gitleaks && '1' \|\| '' \}\}/);
  const e = childEnv('/h', {}, { DEVTEAM_TEST_GITLEAKS: '1', DEVTEAM_TEST_SOPS: '1', DEVTEAM_ROLE: 'worker', DEVTEAM_RUN: '/x' });
  assert.equal(e.DEVTEAM_TEST_GITLEAKS, '1');
  assert.equal(e.DEVTEAM_TEST_SOPS, '1');
  assert.equal(e.DEVTEAM_ROLE, undefined);
  assert.equal(e.DEVTEAM_RUN, undefined);
  assert.equal(e.DEVTEAM_HUB_PORT, '4987', 'the hub port is off 4320');
  assert.match(e.DEVTEAM_CGROUP, /^\/nonexistent\//, 'the cgroup points nowhere');
  assert.match(e.DEVTEAM_MEMINFO, /^\/nonexistent\//, 'meminfo points nowhere');
  assert.equal(e.HOME, '/h');
});

const job = (name) => { const m = new RegExp(`^  ${name}:\\n((?:    .*\\n|\\s*\\n)*)`, 'm').exec(stress); return m ? m[1] : null; };
test('C10: test-stress runs parity daily and on PRs touching test/split, apps or package.json; stress never on a PR; test.yml has no parity', () => {
  const on = /^on:\n((?:  .*\n)+)/m.exec(stress)?.[1] ?? '';
  assert.match(on, /^  pull_request:\n    paths: \['test\/split\/\*\*', 'apps\/\*\*', 'package\.json'\]\n/m);
  assert.match(on, /^  schedule:/m);
  assert.match(job('stress') ?? '', /^    if: github\.event_name != 'pull_request'$/m);
  for (const j of ['parity-build', 'parity-test', 'parity-report']) assert.ok(job(j), `job ${j}`);
  assert.match(job('parity-build'), /^    if: github\.event_name != 'workflow_dispatch'$/m);
  assert.match(job('parity-report'), /name: parity-report\n/);
  assert.doesNotMatch(testYml, /parity/);
});

test('C11: the header no longer says the workflow is never a pull_request check, and says when parity runs on one', () => {
  const header = stress.slice(0, stress.indexOf('\non:'));
  assert.doesNotMatch(header, /Never a pull_request check/);
  assert.match(header, /pull request/i);
  assert.match(header, /test\/split\/, apps\/ or the root package\.json/);
  assert.match(header, /never required/i);
});

test('C38: parity-report never fails the run: the job and its report step carry continue-on-error, and the report artifact still uploads', () => {
  const j = job('parity-report') ?? '';
  assert.match(j, /^    continue-on-error: true$/m, 'the job carries continue-on-error');
  const step = /^      - name: report\n((?: {8,}.*\n)+)/m.exec(j)?.[1] ?? '';
  assert.match(step, /^        continue-on-error: true$/m, 'the report step carries continue-on-error, so the job\'s check is green while the step is red');
  assert.match(j, /^      - if: always\(\)\n        uses: actions\/upload-artifact@v4\n        with:\n          name: parity-report$/m, 'the report artifact uploads after a red step');
});
