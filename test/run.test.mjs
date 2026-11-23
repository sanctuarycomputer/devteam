// test/run.mjs, the kit's test runner, and the shared temp dir the test libs read
// (DEVTEAM_TEST_SHARED_TMP). Fixtures are test/fixtures/run/*.mjs, never *.test.mjs, so no
// discovery runs them on their own.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const lib = path.join(testDir, 'lib');
const fresh = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `dtr-test-${name}-`));
const nodeEnv = (extra) => {
  const env = { ...process.env, ...extra };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  return env;
};

test('ports.mjs keeps its locks in DEVTEAM_TEST_SHARED_TMP', () => {
  const S = fresh('shared');
  const T = fresh('tmp');
  try {
    const code = `import fs from 'node:fs'; import path from 'node:path';
      import { LOCK_DIR, PORTS } from ${JSON.stringify(pathToFileURL(path.join(lib, 'ports.mjs')).href)};
      const lock = fs.readFileSync(path.join(LOCK_DIR, ((PORTS - 20000) / 100) + '.lock'), 'utf8');
      console.log(JSON.stringify({ LOCK_DIR, PORTS, pid: process.pid, lock }));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: nodeEnv({ DEVTEAM_TEST_SHARED_TMP: S, TMPDIR: T }), encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout);
    assert.equal(o.LOCK_DIR, path.join(S, 'devteam-kit-ports'));
    assert.equal(o.lock, String(o.pid));
    assert.equal(fs.existsSync(path.join(T, 'devteam-kit-ports')), false);
  } finally {
    fs.rmSync(S, { recursive: true, force: true });
    fs.rmSync(T, { recursive: true, force: true });
  }
});

test('cli-runner keeps its compile cache in DEVTEAM_TEST_SHARED_TMP', { skip: !module.enableCompileCache && 'no module.enableCompileCache before Node 22.1' }, () => {
  const S = fresh('shared');
  const T2 = fresh('tmp');
  try {
    const script = path.join(S, 'hello.mjs');
    fs.writeFileSync(script, 'console.log("hello");\n');
    const code = `import { runNode } from ${JSON.stringify(pathToFileURL(path.join(lib, 'cli.mjs')).href)};
      // a test's own env, without DEVTEAM_TEST_SHARED_TMP: the runner must have read it before the swap
      const r = runNode(${JSON.stringify(script)}, [], { env: { PATH: process.env.PATH, TMPDIR: ${JSON.stringify(T2)} } });
      console.log(JSON.stringify(r));`;
    // DEVTEAM_TEST_COLD would bypass the warm runner this checks
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: nodeEnv({ DEVTEAM_TEST_SHARED_TMP: S, DEVTEAM_TEST_COLD: undefined }), encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).stdout, 'hello\n');
    assert.ok(fs.existsSync(path.join(S, 'devteam-kit-compile-cache')), 'the cache is in the shared dir');
    assert.equal(fs.existsSync(path.join(T2, 'devteam-kit-compile-cache')), false);
  } finally {
    fs.rmSync(S, { recursive: true, force: true });
    fs.rmSync(T2, { recursive: true, force: true });
  }
});

// ---- the runner's pure parts (T2) ----
const R = await import('./run.mjs');
const root = R.ROOT;
const runMjs = path.join(testDir, 'run.mjs');
const src = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const allFiles = () => fs.readdirSync(testDir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => `test/${f}`);
const runSync = (args, opts = {}) => spawnSync(process.execPath, [runMjs, ...args], { cwd: root, encoding: 'utf8', timeout: 60000, env: nodeEnv(opts.env), ...opts });

test('groups by rule', () => {
  assert.equal(R.groupOf('test/kit.test.mjs', src('test/kit.test.mjs')), 'chain');
  assert.equal(R.groupOf('test/bounds.test.mjs', src('test/bounds.test.mjs')), 'alone');
  assert.equal(R.groupOf('test/dashboard.presses.test.mjs', src('test/dashboard.presses.test.mjs')), 'chrome');
  assert.equal(R.groupOf('test/search.test.mjs', src('test/search.test.mjs')), 'rest');
  assert.equal(R.groupOf('test/x.test.mjs', "const c = await import('./lib/chrome.mjs');\n"), 'chrome');
  assert.equal(R.groupOf('test/x.test.mjs', "// see './lib/chrome.mjs' for how\nimport fs from 'node:fs';\n"), 'rest');
  assert.equal(R.groupOf('test/x.test.mjs', "const s = \"import('./lib/chrome.mjs')\";\n"), 'rest', 'a dynamic import inside a string');
  assert.equal(R.groupOf('test/run.test.mjs', src('test/run.test.mjs')), 'rest', 'this file names chrome.mjs only in strings');
  // the rule's known cost (run.mjs, CHROME_DYNAMIC): a quote earlier on the line hides the import
  assert.equal(R.groupOf('test/x.test.mjs', "if (x === '1') await import('./lib/chrome.mjs');\n"), 'rest');
  assert.equal(R.groupOf('test/x.test.mjs', "if (x) {\n  await import('./lib/chrome.mjs');\n}\n"), 'chrome');
  const plan = R.planRun({ files: [], groups: ['chain', 'alone'], shard: null }, root);
  assert.deepEqual(plan.map((p) => p.file), ['test/bounds.test.mjs', 'test/browser-handover.close.test.mjs', 'test/kit.test.mjs']);
});

test('shards cover each file once and balance', () => {
  const w = new Map(Object.entries({ a: 10, b: 9, c: 5, d: 4, e: 1 }));
  assert.deepEqual(R.shard(['a', 'b', 'c', 'd', 'e'], w, 2), [['a', 'd', 'e'], ['b', 'c']]);
  const files = allFiles();
  const timings = JSON.parse(fs.existsSync(path.join(testDir, 'timings.json')) ? fs.readFileSync(path.join(testDir, 'timings.json'), 'utf8') : '{"files":{}}');
  // files, and every major's section: each deals every file once, at every n --shard takes
  for (const [name, map] of [['files', timings.files], ...Object.entries(timings.majors ?? {}).map(([m, v]) => [`majors.${m}`, v])]) {
    const weights = R.weightsFor(files, map);
    for (let n = 1; n <= 8; n++) {
      const shards = R.shard(files, weights, n);
      assert.equal(shards.length, n);
      const all = shards.flat();
      assert.equal(new Set(all).size, all.length, `no file twice at n=${n} (${name})`);
      assert.deepEqual([...all].sort(), files, `every file at n=${n} (${name})`);
    }
  }
  assert.equal(R.weightsFor(['x', 'y', 'z', 'new'], { x: 1, y: 2, z: 9 }).get('new'), 2, 'the median, not the mean');
  assert.equal(R.weightsFor(['w', 'x', 'y', 'z', 'new'], { w: 1, x: 2, y: 9, z: 10 }).get('new'), 5.5, 'an even count: the middle two averaged');
  const ones = new Map([['c', 1], ['a', 1], ['b', 1]]);
  assert.deepEqual(R.shard(['c', 'a', 'b'], ones, 1), [['a', 'b', 'c']], 'equal weights: by path');
  assert.equal(R.weightsFor(['new'], {}).get('new'), 1);
});

// ---- per-major weights (kit-220) ----
// A scratch root with its own test/timings.json: one chrome file (it imports ./lib/chrome.mjs) and
// rest files a, b, c, d and new.
const T = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [`test/${k}.test.mjs`, v]));
const L = (...names) => names.map((k) => `test/${k}.test.mjs`);
function weightsRoot(t, timings) {
  const dir = fresh('weights');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test', 'chromey.test.mjs'), "import { openChrome } from './lib/chrome.mjs';\n");
  for (const f of ['a', 'b', 'c', 'd', 'new']) fs.writeFileSync(path.join(dir, 'test', `${f}.test.mjs`), "import { test } from 'node:test';\n");
  fs.writeFileSync(path.join(dir, 'test', 'timings.json'), JSON.stringify(timings));
  return dir;
}
// every shard planRun deals, on the given Node major
const dealt = (dir, files, n, major) => Array.from({ length: n }, (_, k) => R.planRun({ files, groups: null, shard: { i: k + 1, n } }, dir, major).map((p) => p.file));

test('planRun deals by the running major\'s section', (t) => {
  const dir = weightsRoot(t, { files: T({ chromey: 176, a: 50, b: 40, c: 30, d: 20 }), majors: { 18: T({ chromey: 0.2, a: 50, b: 40, c: 30, d: 20 }) } });
  const files = L('chromey', 'a', 'b', 'c', 'd');
  assert.equal(R.planRun({ files, groups: null, shard: null }, dir, 18).find((p) => p.file === 'test/chromey.test.mjs').group, 'chrome');
  assert.deepEqual(dealt(dir, files, 2, 18), [L('a', 'd', 'chromey'), L('b', 'c')], 'Node 18: chromey weighs 0.2, its section\'s, not 176');
  assert.deepEqual(dealt(dir, files, 2, 22), [L('chromey'), L('a', 'b', 'c', 'd')], 'Node 22 has no section: files');
});

test('with no major given, planRun deals by the running Node major\'s section', (t) => {
  assert.equal(R.nodeMajor('18.20.4'), 18);
  assert.equal(R.nodeMajor('24.0.0'), 24);
  const here = String(Number(process.versions.node.split('.')[0]));
  assert.equal(R.nodeMajor(), Number(here));
  // as main() calls it: no third argument
  const dir = weightsRoot(t, { files: T({ chromey: 176, a: 50, b: 40, c: 30, d: 20 }), majors: { [here]: T({ chromey: 0.2, a: 50, b: 40, c: 30, d: 20 }) } });
  const files = L('chromey', 'a', 'b', 'c', 'd');
  const got = [1, 2].map((i) => R.planRun({ files, groups: null, shard: { i, n: 2 } }, dir).map((p) => p.file));
  assert.deepEqual(got, [L('a', 'd', 'chromey'), L('b', 'c')], `Node ${here}'s section, not files`);
});

test('no majors section deals as main does', (t) => {
  const timings = { files: T({ a: 10, b: 9, c: 5, d: 4, chromey: 1 }) };
  const dir = weightsRoot(t, timings);
  const files = L('a', 'b', 'c', 'd', 'chromey');
  const main = R.shard(files, R.weightsFor(files, timings.files), 2);
  assert.deepEqual(main, [L('a', 'd', 'chromey'), L('b', 'c')]);
  for (const major of [18, 22]) assert.deepEqual(dealt(dir, files, 2, major), main, `Node ${major}`);
});

test('a file missing from the section weighs its median; a major with none falls back', (t) => {
  const files = L('a', 'b', 'c', 'new');
  // new weighs 2 (the median of 1, 2, 9): c alone, then b, new, a; weighed 100, new is alone
  const byMedian = [L('c'), L('b', 'new', 'a')];
  const by100 = [L('new'), L('c', 'b', 'a')];
  const dir = weightsRoot(t, { files: T({ a: 1, b: 2, c: 9, new: 100 }), majors: { 18: T({ a: 1, b: 2, c: 9 }), 22: {} } });
  assert.deepEqual(dealt(dir, files, 2, 18), byMedian, 'Node 18: new is missing from its section, so it weighs the section\'s median, not files\' 100');
  assert.deepEqual(dealt(dir, files, 2, 20), by100, 'Node 20 has no section: files');
  assert.deepEqual(dealt(dir, files, 2, 22), by100, 'an empty section is no section: files');
  const dir2 = weightsRoot(t, { files: T({ a: 1, b: 2, c: 9 }), majors: { 18: T({ a: 1, b: 2, c: 9 }) } });
  assert.deepEqual(dealt(dir2, files, 2, 20), byMedian, 'no section and not in files: files\' median');
  for (const majors of [[], 'x', null, { 20: [1] }, { 20: 'x' }, { 20: T({ a: 'x', b: -1 }) }]) {
    const d = weightsRoot(t, { files: T({ a: 1, b: 2, c: 9, new: 100 }), majors });
    assert.deepEqual(dealt(d, files, 2, 20), by100, `majors ${JSON.stringify(majors)}: files`);
  }
});

test('timings.json has a section for every tested major', () => {
  const o = JSON.parse(src('test/timings.json'));
  assert.ok(typeof o.run === 'string' && o.run, 'the run id');
  for (const m of ['18', '20', '22', '24']) {
    const s = o.majors?.[m];
    assert.ok(s && typeof s === 'object' && !Array.isArray(s) && Object.keys(s).length, `a section for Node ${m}`);
    for (const [f, v] of Object.entries(s)) assert.ok(typeof v === 'number' && v >= 0, `Node ${m}: ${f} weighs ${v}`);
  }
});

test('the header documents per-major weights', () => {
  const head = src('test/run.mjs').split(/^import /m)[0];
  assert.match(head, /"majors"/);
  assert.match(head, /no section[^.]*\bfiles\b/i);
  assert.match(head, /missing from (?:its|that|the) section[^.]*median/i);
  assert.match(head, /n from 1 to 8/);
});

test('--shard takes n up to 8', () => {
  for (const ok of ['5/5', '1/5', '8/8', '1/8']) assert.deepEqual(R.parseArgs(['--shard', ok], {}, root).shard, { i: Number(ok.split('/')[0]), n: Number(ok.split('/')[1]) }, ok);
  for (const bad of ['0/5', '6/5', '0/8', '9/8', '1/9']) assert.throws(() => R.parseArgs(['--shard', bad], {}, root), /n from 1 to 8/, bad);
  for (const [a, code] of [['5/5', 0], ['8/8', 0], ['9/8', 2]]) assert.equal(runSync(['--list', '--shard', a]).status, code, a);
  assert.match(src('README.md'), /^- `--shard i\/n`: the i-th of n shards \(n from 1 to 8\)/m, 'README says 8 too');
});

test('parseArgs', () => {
  for (const bad of [['--file-timeout', '99999999'], ['--shard', '0/2'], ['--shard', '3/2'], ['--shard', '1/9'], ['--group', 'nope'], ['--concurrency', '0'], ['--bogus'], ['test/no-such.test.mjs']]) {
    assert.throws(() => R.parseArgs(bad, {}, root), R.UsageError, bad.join(' '));
  }
  assert.deepEqual(R.parseArgs(['--group', 'chain,alone'], {}, root).groups, ['chain', 'alone']);
  assert.equal(R.parseArgs([], {}, root).concurrency, 2);
  assert.equal(R.parseArgs([], { DEVTEAM_TEST_CONCURRENCY: '3' }, root).concurrency, 3);
  assert.equal(R.parseArgs(['--concurrency', '4'], { DEVTEAM_TEST_CONCURRENCY: '3' }, root).concurrency, 4);
  assert.deepEqual(R.parseArgs(['--shard', '2/3'], {}, root).shard, { i: 2, n: 3 });
  // the chrome group's cap: the flag, then the variable, then --concurrency on CI, else 1
  const cc = (argv, env) => R.parseArgs(argv, env, root).chromeConcurrency;
  assert.equal(cc([], {}), 1);
  assert.equal(cc(['--concurrency', '3'], { CI: 'true' }), 3);
  assert.equal(cc(['--concurrency', '3'], { CI: 'TRUE' }), 3);
  assert.equal(cc(['--concurrency', '3'], { CI: '1' }), 3);
  for (const ci of ['', '0', 'false', 'False']) assert.equal(cc(['--concurrency', '3'], { CI: ci }), 1, `CI=${ci}`);
  assert.equal(cc([], { DEVTEAM_TEST_CONCURRENCY: '4', CI: 'true' }), 4, 'CI follows the concurrency from the variable too');
  assert.equal(cc(['--concurrency', '3'], { CI: 'true', DEVTEAM_TEST_CHROME_CONCURRENCY: '2' }), 2, 'the variable beats CI');
  assert.equal(cc([], { DEVTEAM_TEST_CHROME_CONCURRENCY: '' }), 1, 'empty is unset');
  assert.equal(cc(['--concurrency', '3'], { CI: 'true', DEVTEAM_TEST_CHROME_CONCURRENCY: '' }), 3, 'empty is unset, so CI decides');
  assert.equal(cc(['--chrome-concurrency', '3'], { DEVTEAM_TEST_CHROME_CONCURRENCY: '2' }), 3, 'the flag beats the variable');
  for (const bad of [['--chrome-concurrency', '0'], ['--chrome-concurrency', 'abc'], ['--chrome-concurrency']]) assert.throws(() => R.parseArgs(bad, {}, root), R.UsageError, bad.join(' '));
  assert.throws(() => R.parseArgs([], { DEVTEAM_TEST_CHROME_CONCURRENCY: '0' }, root), R.UsageError);
  const link = path.join(fresh('link'), 'kit');
  fs.symlinkSync(root, link);
  try {
    const abs = path.join(root, 'test/search.test.mjs');
    const o = R.parseArgs(['./test/search.test.mjs', abs, path.join(link, 'test/search.test.mjs')], {}, root);
    assert.deepEqual(o.files, ['test/search.test.mjs']);
  } finally { fs.rmSync(path.dirname(link), { recursive: true, force: true }); }
  const out = fresh('outside');
  try {
    const f = path.join(out, 'elsewhere.test.mjs');
    fs.writeFileSync(f, "import { test } from 'node:test';\n");
    const o = R.parseArgs([f], {}, root);
    assert.deepEqual(o.files, [fs.realpathSync(f)], 'a file outside the root keeps its real absolute path');
    assert.deepEqual(R.planRun(o, root), [{ file: fs.realpathSync(f), group: 'rest', timeout: 300 }]);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('timeouts and rows', () => {
  assert.equal(R.timeoutOf('test/kit.test.mjs', 'chain', null), 600);
  assert.equal(R.timeoutOf('test/dashboard.instances.test.mjs', 'rest', null), 300);
  assert.equal(Object.keys(R.LONG).filter((f) => f.startsWith('test/dashboard')).length, 0);
  assert.equal(R.timeoutOf('test/search.test.mjs', 'rest', null), 300);
  assert.equal(R.timeoutOf('test/kit.test.mjs', 'chain', 7), 7);
  assert.equal(R.nearTimeout(251, 300), true);
  assert.equal(R.nearTimeout(249, 300), false);
  assert.match(R.rowFor({ file: 'test/a.test.mjs', run: 1, seconds: 251, result: 'ok', timeout: 300, repeat: 1 }), /^test\/a\.test\.mjs\s+251\.0\s+ok, near timeout$/);
  assert.doesNotMatch(R.rowFor({ file: 'test/a.test.mjs', run: 1, seconds: 249, result: 'ok', timeout: 300, repeat: 1 }), /near timeout|run/);
  assert.match(R.rowFor({ file: 'test/a.test.mjs', run: 2, seconds: 1, result: 'failed (exit 1)', timeout: 300, repeat: 3 }), /failed \(exit 1\) \(run 2\)$/);
});

test('lastFinished', () => {
  const tap = [
    'TAP version 13',
    '# Subtest: /abs/test/x.test.mjs',
    '    # Subtest: outer',
    '        # Subtest: inner',
    '        ok 1 - inner',
    '    ok 1 - outer',
    '    ok 2 - skipped one # SKIP not here',
    '    # Subtest: hangs',
    'ok 1 - /abs/test/x.test.mjs',
  ].join('\n');
  assert.equal(R.lastFinished(tap, '/abs/test/x.test.mjs'), 'skipped one');
  assert.equal(R.lastFinished('TAP version 13\nnot ok 3 - broke\n# Subtest: next\n', 'test/x.test.mjs'), 'broke');
  // Node 18 and 20 name the wrapper by its absolute path; the runner passes the relative one
  assert.equal(R.lastFinished('    ok 1 - inner one\nnot ok 1 - /abs/test/x.test.mjs\n', 'test/x.test.mjs'), 'inner one');
  // TAP escapes # and \ in a description
  assert.equal(R.lastFinished('ok 1 - a \\\\ b \\# c\n', 'test/x.test.mjs'), 'a \\ b # c');
  assert.equal(R.lastFinished('TAP version 13\n# Subtest: first\n', 'test/x.test.mjs'), null);
});

test('alone files run first, one at a time', () => {
  const plan = R.planRun({ files: ['test/search.test.mjs', 'test/bounds.test.mjs', 'test/kit.test.mjs'], groups: null, shard: null }, root);
  const steps = R.schedule(plan, 3);
  assert.deepEqual(steps.map((st) => [st.files.map((p) => p.file), st.limit]), [[['test/bounds.test.mjs'], 1], [['test/search.test.mjs', 'test/kit.test.mjs'], 3]]);
  assert.equal(steps[0].caps, undefined, 'the alone step has no caps');
  assert.deepEqual(steps[1].caps, { chrome: 3 }, 'no chrome concurrency given: no tighter cap than the step');
  assert.deepEqual(R.schedule(plan, 3, 1)[1].caps, { chrome: 1 });
});

test('nextIndex skips a group at its cap', () => {
  const q = [{ group: 'chrome' }, { group: 'chrome' }, { group: 'rest' }];
  assert.equal(R.nextIndex(q, new Map(), { chrome: 1 }), 0);
  assert.equal(R.nextIndex(q, new Map([['chrome', 1]]), { chrome: 1 }), 2);
  assert.equal(R.nextIndex(q.slice(0, 2), new Map([['chrome', 1]]), { chrome: 1 }), -1);
  assert.equal(R.nextIndex(q, new Map([['chrome', 1]]), { chrome: 5 }), 0, 'a cap above what runs');
  assert.equal(R.nextIndex(q, new Map([['chrome', 1]]), {}), 0, 'no caps');
  assert.equal(R.nextIndex([], new Map(), { chrome: 1 }), -1);
});

test('runPool rejects when a file cannot start, and settles when it starts nothing', { timeout: 5000 }, async () => {
  const stub = (p) => { if (p.file === 'b') throw new Error('boom'); return { done: Promise.resolve({ file: p.file }) }; };
  const items = [[{ file: 'a', group: 'rest' }, 1], [{ file: 'b', group: 'rest' }, 1]];
  await assert.rejects(R.runPool(items, 1, { running: new Set(), stopping: false }, {}, stub), /boom/);
  assert.deepEqual(await R.runPool([], 2, { running: new Set(), stopping: false }, {}, stub), []);
  assert.deepEqual(await R.runPool(items, 2, { running: new Set(), stopping: true }, {}, stub), [], 'a stopping pool starts nothing');
  const ok = (p) => ({ done: new Promise((r) => setTimeout(() => r({ file: p.file }), p.file === 'a' ? 50 : 10)) });
  const three = [[{ file: 'a', group: 'chrome' }, 1], [{ file: 'b', group: 'chrome' }, 1], [{ file: 'c', group: 'rest' }, 1]];
  assert.deepEqual((await R.runPool(three, 2, { running: new Set(), stopping: false }, { chrome: 1 }, ok)).map((x) => x.file), ['c', 'a', 'b'], 'c beside a, b after a; results in end order');
});

test('childArgs', () => {
  assert.deepEqual(R.childArgs('test/x.test.mjs'), ['--test', '--test-reporter=tap', 'test/x.test.mjs']);
});

test('--list prints the plan and runs nothing', () => {
  const r = runSync(['--list', 'test/kit.test.mjs', 'test/bounds.test.mjs', 'test/dashboard.instances.test.mjs', 'test/search.test.mjs']);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n').map((l) => l.split(/\s+/));
  assert.deepEqual(lines, [['test/bounds.test.mjs', 'alone', '300', 's'], ['test/kit.test.mjs', 'chain', '600', 's'], ['test/dashboard.instances.test.mjs', 'rest', '300', 's'], ['test/search.test.mjs', 'rest', '300', 's']]);
  const listed = [1, 2].flatMap((i) => { const s = runSync(['--list', '--shard', `${i}/2`]); assert.equal(s.status, 0, s.stderr); return s.stdout.trim().split('\n').filter(Boolean).map((l) => l.split(/\s+/)[0]); });
  assert.deepEqual([...listed].sort(), allFiles());
  const bad = runSync(['--list', '--shard', '3/2']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /shard/);
});

// ---- running files (T3) ----
const { spawn } = await import('node:child_process');
const { PassThrough } = await import('node:stream');
const fx = (name) => `test/fixtures/run/${name}`;
// the real tmux, past any shim: under run.mjs the first tmux on PATH is its shim, which refuses -V
const hasTmux = !!R.realTmux(process.env.PATH);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// dead: gone, or a zombie nobody has reaped yet
const isDead = (pid) => {
  try { process.kill(pid, 0); } catch (e) { return e.code === 'ESRCH'; }
  return /Z/.test(spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout ?? '');
};
const deadSoon = async (pid) => { for (let i = 0; i < 50; i++) { if (isDead(pid)) return true; await sleep(100); } return isDead(pid); };
const waitFor = async (f, ms) => { for (let i = 0; i < ms / 100; i++) { if (fs.existsSync(f)) return true; await sleep(100); } return fs.existsSync(f); };

// Every runner spawn has a deadline: past it, the runner's group is killed (only while the runner,
// its leader, hasn't exited, so the group can't be someone else's) and the call rejects.
function runRunner(args, { env, cwd = root, deadline = 60000, umask, script = runMjs } = {}) {
  const argv = umask ? ['sh', ['-c', `umask ${umask}; exec "$0" "$@"`, process.execPath, script, ...args]] : [process.execPath, [script, ...args]];
  // the caller's DEVTEAM_TEST_CONCURRENCY would change what the runner prints, and its CI (GitHub's
  // CI=true) or DEVTEAM_TEST_CHROME_CONCURRENCY the chrome group's cap; a test sets its own
  const child = spawn(argv[0], argv[1], { cwd, env: nodeEnv({ DEVTEAM_TEST_CONCURRENCY: undefined, DEVTEAM_TEST_CHROME_CONCURRENCY: undefined, CI: undefined, ...env }), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = [], err = [];
  child.stdout.on('data', (b) => out.push(b));
  child.stderr.on('data', (b) => err.push(b));
  const alive = () => child.exitCode === null && child.signalCode === null;
  const done = new Promise((resolve, reject) => {
    const t = setTimeout(() => { if (alive()) try { process.kill(-child.pid, 'SIGKILL'); } catch {} reject(new Error(`runner still running after ${deadline} ms: ${args.join(' ')}\n${Buffer.concat(out)}${Buffer.concat(err)}`)); }, deadline);
    child.on('close', (code, signal) => { clearTimeout(t); resolve({ code, signal, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() }); });
  });
  return Object.assign(done, { child, alive });
}
// after hooks run in the order they are registered, and stop at the first that throws: a teardown
// that reads the folder (killFixtures) goes before its removal
const fixtureEnv = (t, extra = {}, teardown = null) => {
  const out = fresh('out');
  if (teardown) t.after(() => teardown(out));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  return { out, env: { DTR_FIXTURE_OUT: out, ...extra } };
};

// A real kit test file, the quickest one (done-when 1 names search.test.mjs, which takes 25 to 45 s:
// its run is a verification row, kept out of this file's budget).
test('a passing file', async () => {
  const r = await runRunner(['test/browser-contract.test.mjs']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^# test\/browser-contract\.test\.mjs\n(TAP version 13\n)?/m);
  assert.match(r.stdout, /^summary: 1 file, concurrency 2$/m);
  assert.match(r.stdout, /^ok \d+ - \S/m, 'its tests ran');
  assert.doesNotMatch(r.stdout, /called recursively/);
  assert.match(r.stdout, /^test\/browser-contract\.test\.mjs {2}\d+\.\d {2}ok$/m);
});

test('exit codes', async (t) => {
  const { env } = fixtureEnv(t);
  for (const f of ['fail.mjs', 'throws.mjs', 'exit-nonzero.mjs']) {
    const r = await runRunner([fx(f)], { env });
    assert.equal(r.code, 1, `${f}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, new RegExp(`^failed: test/fixtures/run/${f.replace('.', '\\.')} \\(`, 'm'));
  }
  assert.equal((await runRunner([fx('pass.mjs')], { env })).code, 0);
  // the exit code decides, not the TAP: a failing todo test prints "not ok" and its file exits 0
  const todo = await runRunner([fx('todo-fails.mjs')], { env });
  assert.match(todo.stdout, /^not ok \d+ - known broken # TODO/m);
  assert.equal(todo.code, 0, todo.stdout + todo.stderr);
  assert.match(todo.stdout, /^test\/fixtures\/run\/todo-fails\.mjs {2}\d+\.\d {2}ok$/m);
  const both = await runRunner([fx('pass.mjs'), fx('fail.mjs')], { env });
  assert.equal(both.code, 1);
  assert.match(both.stdout, /^failed: test\/fixtures\/run\/fail\.mjs/m);
  assert.doesNotMatch(both.stdout, /^failed: test\/fixtures\/run\/pass\.mjs/m);
});

test('per-file temp and the shim', async (t) => {
  const { out, env } = fixtureEnv(t);
  const S = fresh('shared');
  t.after(() => fs.rmSync(S, { recursive: true, force: true }));
  // the first run, which makes the shim, under a umask that would leave it group-writable
  const r = await runRunner([fx('env.mjs')], { env: { ...env, DEVTEAM_TEST_SHARED_TMP: S }, umask: '002' });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const e = readJson(path.join(out, 'env.json'));
  if (fs.existsSync('/tmp')) assert.match(e.TMPDIR, /^\/tmp\/dtr-/);
  assert.equal(e.tmpdir, e.TMPDIR);
  assert.equal(fs.existsSync(e.TMPDIR), false, 'the scratch folder is gone');
  assert.equal(e.shared, S);
  const [first, second] = e.PATH.split(path.delimiter);
  assert.ok(first.startsWith(`${e.TMPDIR}/`), `kit's shim first: ${first}`);
  assert.equal(path.dirname(second), S);
  assert.match(path.basename(second), new RegExp(`^devteam-test-tmux-shim-run-${process.getuid()}-[0-9a-f]{12}$`));
  assert.match(fs.readFileSync(path.join(second, 'tmux'), 'utf8'), /tmux refused: TMUX_TMPDIR/);
  assert.equal(fs.statSync(second).mode & 0o777, 0o755);
  assert.equal(fs.statSync(path.join(second, 'tmux')).mode & 0o777, 0o755);
  const again = await runRunner([fx('env.mjs')], { env: { ...env, DEVTEAM_TEST_SHARED_TMP: S } });
  assert.equal(again.code, 0, again.stdout + again.stderr);
  assert.equal(readJson(path.join(out, 'env.json')).PATH.split(path.delimiter)[1], second, 'the shim is reused');
});

test('an unsafe shim is refused, and so is a shared dir that does not exist', async (t) => {
  const { out, env } = fixtureEnv(t);
  const S = fresh('shared');
  t.after(() => fs.rmSync(S, { recursive: true, force: true }));
  const e = { ...env, DEVTEAM_TEST_SHARED_TMP: S };
  assert.equal((await runRunner([fx('pass.mjs')], { env: e })).code, 0);
  const dir = fs.readdirSync(S).map((f) => path.join(S, f)).find((f) => /devteam-test-tmux-shim-run-/.test(f));
  assert.ok(dir, 'the shim dir was made');
  for (const [what, target, mode] of [['a group-writable dir', dir, 0o775], ['a group-writable shim', path.join(dir, 'tmux'), 0o775]]) {
    fs.chmodSync(target, mode);
    const r = await runRunner([fx('pass.mjs')], { env: e });
    assert.equal(r.code, 2, `${what}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /unsafe shim at /);
    fs.chmodSync(target, 0o755);
  }
  fs.rmSync(path.join(dir, 'tmux'));
  fs.symlinkSync('/bin/sh', path.join(dir, 'tmux'));
  const linked = await runRunner([fx('pass.mjs')], { env: e });
  assert.equal(linked.code, 2, 'a symlinked shim');
  const gone = await runRunner([fx('pass.mjs')], { env: { ...env, DEVTEAM_TEST_SHARED_TMP: path.join(S, 'no-such-dir') } });
  assert.equal(gone.code, 2, gone.stdout + gone.stderr);
  assert.match(gone.stderr, /DEVTEAM_TEST_SHARED_TMP .* is not a directory/);
  assert.deepEqual(fs.readdirSync(out), [], 'nothing ran');
});

test('socketsUnder finds the sockets inside a folder, never through a symlink', async (t) => {
  const net = await import('node:net');
  const d = fresh('sock');
  const outside = fresh('sock-out');
  const servers = [];
  t.after(() => { for (const v of servers) v.close(); fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  const listen = (f) => new Promise((resolve) => { const v = net.createServer(); servers.push(v); v.listen(f, resolve); });
  fs.mkdirSync(path.join(d, 'a', 'b'), { recursive: true });
  await listen(path.join(d, 's1'));
  await listen(path.join(d, 'a', 'b', 's2'));
  await listen(path.join(outside, 's3'));
  // s4 has one name: only the symlinked-dir rule keeps it out
  await listen(path.join(outside, 's4'));
  fs.writeFileSync(path.join(d, 'plain'), '');
  fs.symlinkSync(outside, path.join(d, 'to-outside'));
  fs.symlinkSync(path.join(outside, 's3'), path.join(d, 'link-to-s3'));
  // a socket hard-linked in from outside: the same socket as s3, whose other name isn't here
  let hard = true;
  try { fs.linkSync(path.join(outside, 's3'), path.join(d, 'hard-s3')); } catch { hard = false; }
  // a socket of this folder's with a second name in it too: still this folder's
  if (hard) fs.linkSync(path.join(d, 's1'), path.join(d, 'a', 's1-again'));
  const real = fs.realpathSync(d);
  const mine = [path.join(real, 'a', 'b', 's2'), path.join(real, 's1'), ...(hard ? [path.join(real, 'a', 's1-again')] : [])].sort();
  assert.deepEqual(R.socketsUnder(d).sort(), mine, hard ? 'no hard-linked socket from outside' : 'no link(2) for sockets here');
  assert.deepEqual(R.socketsUnder(path.join(d, 'no-such')), []);
  // a folder that is itself a symlink (a test replaced its TMPDIR with one) is walked not at all
  assert.deepEqual(R.socketsUnder(path.join(d, 'to-outside')), []);
});

test('a file never sees the TMUX of the session that ran the runner', async (t) => {
  const { out, env } = fixtureEnv(t);
  const r = await runRunner([fx('path.mjs')], { env: { ...env, TMUX: '/tmp/tmux-1000/default,1,0', TMUX_PANE: '%1' } });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const o = readJson(path.join(out, 'path.json'));
  assert.equal(o.TMUX, undefined);
  assert.equal(o.TMUX_PANE, undefined);
});

test('an unset PATH gives the child no empty PATH entry', async (t) => {
  const { out, env } = fixtureEnv(t);
  const r = await runRunner([fx('path.mjs')], { env: { ...env, PATH: undefined } });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const parts = readJson(path.join(out, 'path.json')).PATH.split(path.delimiter);
  assert.ok(parts.every(Boolean), `no empty entry: ${parts.join(':')}`);
});

test('the default shared dir', async (t) => {
  const { out, env } = fixtureEnv(t);
  const X = fresh('tmpdir');
  t.after(() => fs.rmSync(X, { recursive: true, force: true }));
  const r = await runRunner([fx('env.mjs')], { env: { ...env, DEVTEAM_TEST_SHARED_TMP: undefined, TMPDIR: X } });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(readJson(path.join(out, 'env.json')).shared, X);
});

test('two files at once claim distinct port blocks', async (t) => {
  const { out, env } = fixtureEnv(t);
  const S = fresh('shared');
  t.after(() => fs.rmSync(S, { recursive: true, force: true }));
  const r = await runRunner(['--concurrency', '2', fx('ports.mjs'), fx('ports-2.mjs')], { env: { ...env, DEVTEAM_TEST_SHARED_TMP: S } });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const got = fs.readdirSync(out).filter((f) => /^ports-\d+\.json$/.test(f)).map((f) => readJson(path.join(out, f)));
  assert.equal(got.length, 2);
  for (const g of got) {
    assert.equal(g.LOCK_DIR, path.join(S, 'devteam-kit-ports'));
    assert.ok(g.two, 'each saw the other hold a block');
  }
  assert.notEqual(got[0].PORTS, got[1].PORTS);
});

test('a file that ends on its own has its tmux servers killed and folder removed', { skip: !hasTmux && 'no tmux' }, async (t) => {
  const { out, env } = fixtureEnv(t);
  const r = await runRunner([fx('tmux-ends.mjs')], { env });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const o = readJson(path.join(out, 'tmux-ends.json'));
  assert.ok(o.server > 0);
  assert.ok(await deadSoon(o.server), `tmux server ${o.server} is dead`);
  assert.equal(fs.existsSync(o.scratch), false);
});

test('--repeat 3 names the failing run', async (t) => {
  const { env } = fixtureEnv(t);
  const r = await runRunner(['--repeat', '3', fx('flaky.mjs')], { env });
  assert.equal(r.code, 1, r.stdout + r.stderr);
  const rows = r.stdout.split('\n').filter((l) => l.startsWith('test/fixtures/run/flaky.mjs  '));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((l) => /failed/.test(l)), [false, true, false]);
  assert.match(rows[1], /\(run 2\)$/);
});

test('--timings writes wall seconds', async (t) => {
  const { out, env } = fixtureEnv(t);
  const f = path.join(out, 'timings.json');
  const r = await runRunner(['--timings', f, fx('pass.mjs')], { env });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const o = readJson(f);
  assert.ok('run' in o);
  assert.deepEqual(Object.keys(o.files), ['test/fixtures/run/pass.mjs']);
  assert.equal(typeof o.files['test/fixtures/run/pass.mjs'], 'number');
  assert.equal(o.node, Number(process.versions.node.split('.')[0]), 'the Node major beside the seconds');
});

test('--timings keeps the longest of a file\'s runs', async (t) => {
  const { out, env } = fixtureEnv(t);
  const f = path.join(out, 'timings.json');
  const r = await runRunner(['--repeat', '2', '--timings', f, fx('slow-once.mjs')], { env });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(readJson(f).files['test/fixtures/run/slow-once.mjs'] >= 1.5, 'the slow first run, not the quick second');
});

test('--list runs nothing', async (t) => {
  const { out, env } = fixtureEnv(t);
  const r = await runRunner(['--list', fx('env.mjs')], { env });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(fs.readdirSync(out), []);
});

test('a loud file', async (t) => {
  const { env } = fixtureEnv(t);
  const r = await runRunner([fx('loud.mjs')], { env });
  assert.equal(r.code, 0, r.stderr);
  // node --test may break a long line where its chunks split, so count the characters: none lost
  assert.ok(r.stdout.split('x').length - 1 >= 2048 * 1023, 'every x the file printed');
});

test('from another cwd, through a symlink', async (t) => {
  const { env } = fixtureEnv(t);
  const d = fresh('link');
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const L = path.join(d, 'kit');
  fs.symlinkSync(root, L);
  const r = await runRunner([path.join(L, fx('fail.mjs'))], { env, cwd: '/', script: path.join(L, 'test/run.mjs') });
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^failed: test\/fixtures\/run\/fail\.mjs/m);
});

test('through a symlink with --preserve-symlinks-main, it still runs', async (t) => {
  const { env } = fixtureEnv(t);
  const d = fresh('link');
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const L = path.join(d, 'kit');
  fs.symlinkSync(root, L);
  const r = await runRunner([path.join(L, fx('fail.mjs'))], { env: { ...env, NODE_OPTIONS: '--preserve-symlinks-main' }, cwd: '/', script: path.join(L, 'test/run.mjs') });
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^failed: test\/fixtures\/run\/fail\.mjs/m);
});

test('an empty shard', async (t) => {
  const { env } = fixtureEnv(t);
  const r = await runRunner(['--shard', '2/2', fx('pass.mjs')], { env });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^no files$/m);
});

test('drain', async () => {
  const s = new PassThrough();
  const t0 = Date.now();
  await R.drain(s, 200);
  assert.ok(Date.now() - t0 < 1200);
  const ended = new PassThrough();
  ended.end();
  ended.resume();
  await new Promise((r) => ended.on('end', r));
  const t1 = Date.now();
  await R.drain(ended, 5000);
  assert.ok(Date.now() - t1 < 1000, 'an ended stream drains at once');
});

// ---- the watchdog, cleanup and signals (T4) ----
const realTmuxPath = R.realTmux(process.env.PATH);
const argsOf = (pid) => spawnSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
// A fixture's processes, killed only if each still runs what it ran when it wrote its pid: a pid
// that died and was reused is someone else's.
function killFixtures(out) {
  const recs = [];
  for (const f of ['pids.json', 'survivor-pid.json']) { try { recs.push(readJson(path.join(out, f))); } catch {} }
  for (const o of recs) {
    for (const p of [o, o.file, o.detached, o.server]) if (p?.pid > 1 && !isDead(p.pid) && argsOf(p.pid) === p.args) try { process.kill(p.pid, 'SIGKILL'); } catch {}
    if (o.socket && realTmuxPath && /^\/tmp\/dtr-|^\/private\/tmp\/dtr-/.test(o.socket)) spawnSync(realTmuxPath, ['-S', o.socket, 'kill-server'], { stdio: 'ignore', timeout: 5000 });
  }
}
// a shared dir of the test's own, so its port locks can be read
const hangEnv = (t, extra = {}) => {
  const S = fresh('shared');
  const f = fixtureEnv(t, { DEVTEAM_TEST_SHARED_TMP: S, ...extra }, killFixtures);
  t.after(() => fs.rmSync(S, { recursive: true, force: true }));
  return { ...f, S };
};
// A killed file's port lock is freed: a SIGKILL skips its own exit hook, and a lock whose owner is
// gone otherwise holds its block for an hour, on every checkout on the machine.
const locksOf = (S) => { const d = path.join(S, 'devteam-kit-ports'); try { return fs.readdirSync(d).map((f) => Number(fs.readFileSync(path.join(d, f), 'utf8'))); } catch { return []; } };
const allDead = async (o, S) => {
  for (const p of [o.file, o.detached, ...(o.server ? [o.server] : [])]) assert.ok(await deadSoon(p.pid), `pid ${p.pid} (${p.args}) is dead`);
  if (S) assert.ok(!locksOf(S).includes(o.file.pid), `the killed file's port lock is freed: ${locksOf(S).join(' ')}`);
  if (o.socket) assert.notEqual(spawnSync(realTmuxPath || 'tmux', ['-S', o.socket, 'has-session'], { stdio: 'ignore' }).status, 0, 'its tmux server is gone');
  assert.equal(fs.existsSync(o.scratch), false, 'its scratch folder is gone');
};

test('freeLocks frees only the port locks of pids that are gone, and only the ones named', (t) => {
  const S = fresh('locks');
  t.after(() => fs.rmSync(S, { recursive: true, force: true }));
  const d = path.join(S, 'devteam-kit-ports');
  fs.mkdirSync(d);
  const [gone, goneUnnamed] = [9000091, 9000092];
  fs.writeFileSync(path.join(d, '1.lock'), String(process.pid));
  fs.writeFileSync(path.join(d, '2.lock'), String(gone));
  fs.writeFileSync(path.join(d, '3.lock'), String(goneUnnamed));
  // pid 1 is alive and, to anyone but root, answers kill(1, 0) with EPERM
  fs.writeFileSync(path.join(d, '4.lock'), '1');
  // the live pids are named too: a lock whose owner is alive is never freed
  assert.deepEqual(R.freeLocks(S, [process.pid, gone, 1]), [gone]);
  assert.deepEqual(fs.readdirSync(d).sort(), ['1.lock', '3.lock', '4.lock']);
  assert.deepEqual(R.freeLocks(path.join(S, 'no-such'), [gone]), []);
});

test('stopTree with scripted snapshots', () => {
  const [Rt, A, B, X, Y, Q, Z] = [9000001, 9000002, 9000003, 9000004, 9000005, 9000006, 9000007];
  const snap = (rows) => new Map(rows.map(([pid, ppid, stat]) => [pid, { ppid, stat }]));
  const snaps = [
    // A is the root's child; X's parent is never stopped
    snap([[Rt, 1, 'Ss'], [A, Rt, 'S'], [X, 1, 'S']]),
    // B, A's child, first appears now; A hasn't shown stopped yet
    snap([[Rt, 1, 'T'], [A, Rt, 'S'], [B, A, 'S'], [X, 1, 'S']]),
    snap([[Rt, 1, 'T'], [A, Rt, 'Tl'], [B, A, 'T'], [X, 1, 'S']]),
  ];
  let k = 0;
  const log = [];
  const r = R.stopTree(Rt, { snapshot: () => snaps[Math.min(k++, snaps.length - 1)], signal: (pid, sig) => log.push(`${sig} ${pid}`) });
  assert.deepEqual(log, [`SIGSTOP ${Rt}`, `SIGSTOP ${A}`, `SIGSTOP ${B}`, `SIGKILL ${B}`, `SIGKILL ${A}`, `SIGKILL ${Rt}`]);
  assert.deepEqual(r.killed, [B, A, Rt]);
  assert.deepEqual(r.unstopped, []);
  // in the final snapshot: Y never shows stopped (listed, not killed); Q is a zombie (neither, and
  // the walk doesn't wait on it); Z's parent changed since it was stopped (not killed)
  const s2 = [
    snap([[Rt, 1, 'S'], [Y, Rt, 'S'], [Q, Rt, 'S'], [Z, Y, 'S']]),
    snap([[Rt, 1, 'T'], [Y, Rt, 'Ss'], [Q, Rt, 'Z'], [Z, Y, 'T']]),
    snap([[Rt, 1, 'T'], [Y, Rt, 'Ss'], [Q, Rt, 'Z'], [Z, Rt, 'T']]),
  ];
  k = 0;
  const log2 = [];
  const t0 = Date.now();
  const r2 = R.stopTree(Rt, { snapshot: () => s2[Math.min(k++, s2.length - 1)], signal: (pid, sig) => log2.push(`${sig} ${pid}`) });
  assert.deepEqual(r2.killed, [Rt]);
  assert.deepEqual(r2.unstopped, [Y]);
  assert.ok(!log2.includes(`SIGKILL ${Q}`) && !log2.includes(`SIGKILL ${Y}`) && !log2.includes(`SIGKILL ${Z}`));
  // nothing the walk stopped is left stopped: what it didn't kill, it resumes (Q has exited); Z
  // shows a new parent while its old one (Y) lives, so the pid is another process's: left alone
  assert.deepEqual(log2.filter((l) => l.startsWith('SIGCONT')), [`SIGCONT ${Y}`]);
  assert.ok(Date.now() - t0 < 4000, 'bounded');
  assert.throws(() => R.stopTree(1, { snapshot: () => new Map() }), /together/);
});

// a clock the test moves: each call is 100 ms later, so the walk's 2 s bound passes at once
const fakeClock = () => { let t = 0; return () => (t += 100); };
const scripted = (rows, opts = {}) => {
  const snap = (r) => new Map(r.map(([pid, ppid, stat]) => [pid, { ppid, stat }]));
  let k = 0;
  const log = [];
  const r = R.stopTree(rows.root, { snapshot: () => { const x = rows.snaps[Math.min(k++, rows.snaps.length - 1)]; if (x instanceof Error) throw x; return snap(x); }, signal: (pid, sig) => log.push(`${sig} ${pid}`), now: fakeClock(), sleep: () => {}, ...opts });
  return { r, log };
};

test('stopTree kills a stopped child whose parent died during the walk', () => {
  const [Rt, A, B, C, D] = [9000011, 9000012, 9000013, 9000014, 9000015];
  // A dies (a zombie) and B, its stopped child, moves to pid 1; C's parent D is gone altogether
  const { r } = scripted({ root: Rt, snaps: [
    [[Rt, 1, 'S'], [A, Rt, 'S'], [D, Rt, 'S']],
    [[Rt, 1, 'T'], [A, Rt, 'T'], [B, A, 'S'], [D, Rt, 'T'], [C, D, 'S']],
    [[Rt, 1, 'T'], [A, Rt, 'Z'], [B, 1, 'T'], [C, 1, 'T']],
  ] });
  assert.deepEqual(r.killed, [C, B, Rt]);
});

test('stopTree, when ps fails mid-walk, kills what the last snapshot showed under its parent', () => {
  const [Rt, A, X] = [9000021, 9000022, 9000023];
  const { r, log } = scripted({ root: Rt, snaps: [[[Rt, 1, 'S'], [A, Rt, 'S'], [X, 1, 'S']], new Error('ps failed')] });
  assert.deepEqual(log, [`SIGSTOP ${Rt}`, `SIGSTOP ${A}`, `SIGKILL ${A}`, `SIGKILL ${Rt}`]);
  assert.match(r.error, /ps failed/);
  // the last good snapshot shows A under another parent: not killed
  const moved = scripted({ root: Rt, snaps: [[[Rt, 1, 'S'], [A, Rt, 'S']], [[Rt, 1, 'T'], [A, 1, 'S']], new Error('ps failed')] });
  assert.deepEqual(moved.r.killed, [Rt]);
  // no snapshot at all: the root alone, then the error
  const none = scripted({ root: Rt, snaps: [new Error('no ps')] });
  assert.deepEqual(none.log, [`SIGSTOP ${Rt}`, `SIGKILL ${Rt}`]);
  assert.match(none.r.error, /no ps/);
});

test('stopTree goes on past a pid it may not signal', () => {
  const [Rt, A, B, C] = [9000041, 9000042, 9000043, 9000044];
  const log = [];
  // C is A's child: with A not stopped, C isn't the walk's either
  const snaps = [[[Rt, 1, 'S'], [A, Rt, 'S'], [B, Rt, 'S'], [C, A, 'S']], [[Rt, 1, 'T'], [A, Rt, 'S'], [B, Rt, 'T'], [C, A, 'S']]];
  const snap = (r) => new Map(r.map(([pid, ppid, stat]) => [pid, { ppid, stat }]));
  let k = 0;
  // A belongs to another user: the real sender gets EPERM for it
  const r = R.stopTree(Rt, { snapshot: () => snap(snaps[Math.min(k++, 1)]), signal: R.signalWith((pid, sig) => { if (pid === A) throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); log.push(`${sig} ${pid}`); }), now: fakeClock(), sleep: () => {} });
  assert.deepEqual(r.killed, [B, Rt]);
  assert.deepEqual(r.stopped, [Rt, B]);
  assert.deepEqual(log, [`SIGSTOP ${Rt}`, `SIGSTOP ${B}`, `SIGKILL ${B}`, `SIGKILL ${Rt}`]);
});

test('stopTree always kills the root, its own unreaped child, and never waits on a zombie', () => {
  const [Rt, Q] = [9000031, 9000032];
  // the root never shows stopped within the bound
  const { r } = scripted({ root: Rt, snaps: [[[Rt, 1, 'R']]] });
  assert.deepEqual(r.killed, [Rt]);
  // a zombie child settles the walk at once: no 20 ms sleeps
  let sleeps = 0;
  scripted({ root: Rt, snaps: [[[Rt, 1, 'S'], [Q, Rt, 'S']], [[Rt, 1, 'T'], [Q, Rt, 'Z']]] }, { sleep: () => { sleeps++; } });
  assert.equal(sleeps, 0);
});

test('a hung file is killed with its tree, and a survivor is refused tmux', async (t) => {
  const { out, env, S } = hangEnv(t, { DTR_SURVIVOR: '1' });
  const r = await runRunner(['--file-timeout', '5', fx('hang.mjs')], { env, deadline: 45000 });
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^timed out: test\/fixtures\/run\/hang\.mjs after 5 s \(last test finished: first passes\)$/m);
  assert.match(r.stdout, /^test\/fixtures\/run\/hang\.mjs {2}\d+\.\d {2}timed out/m);
  await allDead(readJson(path.join(out, 'pids.json')), S);
  assert.ok(await waitFor(path.join(out, 'survivor.json'), 10000), 'the survivor reported');
  const s = readJson(path.join(out, 'survivor.json'));
  assert.equal(s.status, 1);
  assert.match(s.stderr, /tmux refused/);
});

test('an output pipe that closes stops the run and cleans up every running file', async (t) => {
  const { out, env, S } = hangEnv(t);
  const timings = path.join(S, 'timings.json');
  const run = runRunner(['--concurrency', '2', '--file-timeout', '20', '--timings', timings, fx('hang.mjs'), fx('slow.mjs')], { env, deadline: 45000 });
  // once the hung file is under way, our end of the runner's stdout goes; its next write hits EPIPE:
  // slow.mjs ending at about 6 s or, if it ended first, hang.mjs's timeout at 20 s
  assert.ok(await waitFor(path.join(out, 'pids.json'), 30000), 'the fixture started');
  assert.ok(run.alive(), 'the runner is still running');
  run.child.stdout.destroy();
  const r = await run;
  assert.equal(r.code, 141, r.stderr);
  assert.equal(fs.existsSync(timings), false, 'an interrupted run writes no timings');
  await allDead(readJson(path.join(out, 'pids.json')), S);
});

for (const [sig, how, code] of [['SIGINT', 'the runner\'s group', 130], ['SIGTERM', 'the runner', 143]]) {
  test(`${sig} to ${how} cleans up every running file`, async (t) => {
    const { out, env, S } = hangEnv(t);
    const run = runRunner([fx('hang.mjs')], { env, deadline: 45000 });
    assert.ok(await waitFor(path.join(out, 'pids.json'), 30000), 'the fixture started');
    assert.ok(run.alive(), 'the runner is still running');
    process.kill(sig === 'SIGINT' ? -run.child.pid : run.child.pid, sig);
    const r = await run;
    assert.equal(r.code, code, r.stdout + r.stderr);
    assert.match(r.stdout, /^interrupted$/m);
    assert.doesNotMatch(r.stdout, /^summary:/m, 'an interrupted run prints no summary');
    await allDead(readJson(path.join(out, 'pids.json')), S);
  });
}

// ---- the chrome group's cap (kit-597) ----
// Fixtures written at run time, into a folder of the test's own. Each records its start, waits until
// another fixture's run overlaps its own (a start, and no end yet or an end at or after its own start)
// or its wait passes, then records its end and whether it saw one. Files are written whole (renamed
// into place). The chrome line is a quoted one-line string here, so this file still groups as rest.
const CHROME_LINE = "if (process.env.DTR_NEVER) await import('./lib/chrome.mjs');";
const TIMED_BODY = [
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  "import { test } from 'node:test';",
  'const out = process.env.DTR_FIXTURE_OUT;',
  "const write = (f, o) => { const t = path.join(out, '.tmp-' + NAME); fs.writeFileSync(t, JSON.stringify(o)); fs.renameSync(t, path.join(out, f)); };",
  "const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(out, f), 'utf8')); } catch { return null; } };",
  "test('timed', async () => {",
  '  const start = Date.now();',
  "  write('start-' + NAME + '.json', { at: start });",
  "  const overlaps = () => fs.readdirSync(out).some((f) => { const m = /^start-(.+)\\.json$/.exec(f); if (!m || m[1] === NAME) return false; const end = read('end-' + m[1] + '.json'); return !end || end.at >= start; });",
  '  let saw = overlaps();',
  '  while (!saw && Date.now() - start < WAIT_MS) { await new Promise((r) => setTimeout(r, 50)); saw = overlaps(); }',
  "  write('end-' + NAME + '.json', { at: Date.now(), saw });",
  '});',
];
const timedSource = (name, { chrome, waitMs }) => [...(chrome ? [CHROME_LINE] : []), `const NAME = ${JSON.stringify(name)}, WAIT_MS = ${waitMs};`, ...TIMED_BODY, ''].join('\n');
const writeTimed = (dir, name, opts) => { const f = path.join(dir, `${name}.mjs`); fs.writeFileSync(f, timedSource(name, opts)); return f; };
const windowOf = (out, name) => ({ start: readJson(path.join(out, `start-${name}.json`)).at, ...(({ at, saw }) => ({ end: at, saw }))(readJson(path.join(out, `end-${name}.json`))) });
// at or after, as the fixtures count it: two files can start and end in the same millisecond
const overlap = (a, b) => a.start <= b.end && b.start <= a.end;
const timedEnv = (t) => {
  const f = fixtureEnv(t);
  const dir = fresh('timed');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { ...f, dir };
};

test('the timed fixtures group as chrome and rest', () => {
  assert.equal(R.groupOf('/x/a.mjs', timedSource('a', { chrome: true, waitMs: 1 })), 'chrome');
  assert.equal(R.groupOf('/x/r.mjs', timedSource('r', { chrome: false, waitMs: 1 })), 'rest');
});

test('off CI, two chrome files run one after the other', async (t) => {
  const { out, env, dir } = timedEnv(t);
  const files = ['a', 'b'].map((n) => writeTimed(dir, n, { chrome: true, waitMs: 1500 }));
  const r = await runRunner(['--concurrency', '2', ...files], { env });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const [a, b] = ['a', 'b'].map((n) => windowOf(out, n));
  assert.ok(a.end <= b.start || b.end <= a.start, `windows apart: ${JSON.stringify({ a, b })}`);
  assert.ok(!a.saw && !b.saw, 'neither saw the other running');
});

for (const [how, args, extra] of [
  ['--chrome-concurrency 2', ['--chrome-concurrency', '2'], {}],
  ['DEVTEAM_TEST_CHROME_CONCURRENCY=2', [], { DEVTEAM_TEST_CHROME_CONCURRENCY: '2' }],
  ['CI=true', [], { CI: 'true' }],
]) {
  test(`with ${how}, two chrome files run side by side`, async (t) => {
    const { out, env, dir } = timedEnv(t);
    const files = ['a', 'b'].map((n) => writeTimed(dir, n, { chrome: true, waitMs: 10000 }));
    const r = await runRunner(['--concurrency', '2', ...args, ...files], { env: { ...env, ...extra } });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const [a, b] = ['a', 'b'].map((n) => windowOf(out, n));
    assert.ok(overlap(a, b), `windows overlap: ${JSON.stringify({ a, b })}`);
    assert.ok(a.saw && b.saw, 'each saw the other running');
  });
}

test('off CI, a rest file runs beside a chrome file while the next chrome file waits', async (t) => {
  const { out, env, dir } = timedEnv(t);
  const files = [writeTimed(dir, 'a', { chrome: true, waitMs: 10000 }), writeTimed(dir, 'b', { chrome: true, waitMs: 1500 }), writeTimed(dir, 'r', { chrome: false, waitMs: 10000 })];
  const r = await runRunner(['--concurrency', '2', ...files], { env });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const [a, b, rr] = ['a', 'b', 'r'].map((n) => windowOf(out, n));
  assert.ok(overlap(a, rr), `r beside a: ${JSON.stringify({ a, rr })}`);
  assert.ok(b.start >= a.end, `b after a: ${JSON.stringify({ a, b })}`);
});

test('an interrupt while a chrome file waits for the cap: it never starts', async (t) => {
  const { out, env, dir } = timedEnv(t);
  const files = [writeTimed(dir, 'a', { chrome: true, waitMs: 10000 }), writeTimed(dir, 'b', { chrome: true, waitMs: 1500 })];
  const timings = path.join(dir, 'timings.json');
  const run = runRunner(['--concurrency', '2', '--timings', timings, ...files], { env, deadline: 45000 });
  assert.ok(await waitFor(path.join(out, 'start-a.json'), 20000), 'a started');
  assert.ok(run.alive(), 'the runner is still running');
  process.kill(run.child.pid, 'SIGINT');
  const r = await run;
  assert.equal(r.code, 130, r.stdout + r.stderr);
  await sleep(1000);
  assert.equal(fs.existsSync(path.join(out, 'start-b.json')), false, 'b never started');
  assert.doesNotMatch(r.stdout, /^summary:/m, 'an interrupted run prints no summary');
  assert.equal(fs.existsSync(timings), false, 'and writes no timings');
});

// ---- the Chrome flags (kit-597) ----
// chrome.mjs loaded by a path, not by name: a test of its arguments starts no browser, and this file
// stays in the rest group
test('openChrome starts Chrome with the lower-memory flags', async () => {
  const C = await import(pathToFileURL(path.join(lib, 'chrome.mjs')).href);
  const a = C.chromeArgs('/p');
  for (const f of ['--renderer-process-limit=2', '--disable-extensions', '--disable-component-update', '--disable-background-networking', '--js-flags=--max-old-space-size=256', '--headless=new', '--user-data-dir=/p', '--remote-debugging-port=0']) assert.ok(a.includes(f), f);
  assert.equal(a.at(-1), 'about:blank');
  assert.match(fs.readFileSync(path.join(lib, 'chrome.mjs'), 'utf8'), /spawn\(chromePath, chromeArgs\(profile\)/, 'openChrome spawns with the seam');
});

test('pruneCompileCache trims the shared compile cache, oldest first, once it passes its cap', () => {
  const S = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-'));
  try {
    const d = path.join(S, 'devteam-kit-compile-cache', 'v0-x64-test');
    fs.mkdirSync(d, { recursive: true });
    for (let i = 0; i < 10; i++) {
      const f = path.join(d, `e${i}`);
      fs.writeFileSync(f, Buffer.alloc(100));
      fs.utimesSync(f, 1000 + i, 1000 + i);
    }
    assert.equal(R.pruneCompileCache(S, 2000), 0, 'under its cap: nothing removed');
    assert.equal(R.pruneCompileCache(S, 800), 6, 'over its cap: trimmed to half of it');
    assert.deepEqual(fs.readdirSync(d).sort(), ['e6', 'e7', 'e8', 'e9'], 'the oldest went first');
    assert.equal(R.pruneCompileCache(path.join(S, 'none'), 800), 0, 'no cache yet: nothing to do');
  } finally {
    fs.rmSync(S, { recursive: true, force: true });
  }
});
