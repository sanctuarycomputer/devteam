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
  assert.equal(R.groupOf('test/dashboard.test.mjs', src('test/dashboard.test.mjs')), 'chrome');
  assert.equal(R.groupOf('test/search.test.mjs', src('test/search.test.mjs')), 'rest');
  assert.equal(R.groupOf('test/x.test.mjs', "const c = await import('./lib/chrome.mjs');\n"), 'chrome');
  assert.equal(R.groupOf('test/x.test.mjs', "// see ./lib/chrome.mjs for how\nimport fs from 'node:fs';\n"), 'rest');
  const plan = R.planRun({ files: [], groups: ['chain', 'alone'], shard: null }, root);
  assert.deepEqual(plan.map((p) => p.file), ['test/bounds.test.mjs', 'test/kit.test.mjs']);
});

test('shards cover each file once and balance', () => {
  const w = new Map(Object.entries({ a: 10, b: 9, c: 5, d: 4, e: 1 }));
  assert.deepEqual(R.shard(['a', 'b', 'c', 'd', 'e'], w, 2), [['a', 'd', 'e'], ['b', 'c']]);
  const files = allFiles();
  const timings = JSON.parse(fs.existsSync(path.join(testDir, 'timings.json')) ? fs.readFileSync(path.join(testDir, 'timings.json'), 'utf8') : '{"files":{}}').files;
  const weights = R.weightsFor(files, timings);
  for (let n = 1; n <= 4; n++) {
    const shards = R.shard(files, weights, n);
    assert.equal(shards.length, n);
    const all = shards.flat();
    assert.equal(new Set(all).size, all.length, `no file twice at n=${n}`);
    assert.deepEqual([...all].sort(), files);
  }
  const m = R.weightsFor(['x', 'y', 'z', 'new'], { x: 1, y: 5, z: 9 });
  assert.equal(m.get('new'), 5);
  assert.equal(R.weightsFor(['new'], {}).get('new'), 1);
});

test('parseArgs', () => {
  for (const bad of [['--shard', '0/2'], ['--shard', '3/2'], ['--shard', '1/5'], ['--group', 'nope'], ['--concurrency', '0'], ['--bogus'], ['test/no-such.test.mjs']]) {
    assert.throws(() => R.parseArgs(bad, {}, root), R.UsageError, bad.join(' '));
  }
  assert.deepEqual(R.parseArgs(['--group', 'chain,alone'], {}, root).groups, ['chain', 'alone']);
  assert.equal(R.parseArgs([], {}, root).concurrency, 2);
  assert.equal(R.parseArgs([], { DEVTEAM_TEST_CONCURRENCY: '3' }, root).concurrency, 3);
  assert.equal(R.parseArgs(['--concurrency', '4'], { DEVTEAM_TEST_CONCURRENCY: '3' }, root).concurrency, 4);
  assert.deepEqual(R.parseArgs(['--shard', '2/3'], {}, root).shard, { i: 2, n: 3 });
  const link = path.join(fresh('link'), 'kit');
  fs.symlinkSync(root, link);
  try {
    const abs = path.join(root, 'test/search.test.mjs');
    const o = R.parseArgs(['./test/search.test.mjs', abs, path.join(link, 'test/search.test.mjs')], {}, root);
    assert.deepEqual(o.files, ['test/search.test.mjs']);
  } finally { fs.rmSync(path.dirname(link), { recursive: true, force: true }); }
});

test('timeouts and rows', () => {
  assert.equal(R.timeoutOf('test/kit.test.mjs', 'chain', null), 600);
  assert.equal(R.timeoutOf('test/dashboard.test.mjs', 'chrome', null), 600);
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
  assert.equal(R.lastFinished('TAP version 13\n# Subtest: first\n', 'test/x.test.mjs'), null);
});

test('childArgs', () => {
  assert.deepEqual(R.childArgs('test/x.test.mjs'), ['--test', '--test-reporter=tap', 'test/x.test.mjs']);
});

test('--list prints the plan and runs nothing', () => {
  const r = runSync(['--list', 'test/kit.test.mjs', 'test/bounds.test.mjs', 'test/dashboard.test.mjs', 'test/search.test.mjs']);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n').map((l) => l.split(/\s+/));
  assert.deepEqual(lines, [['test/bounds.test.mjs', 'alone', '300', 's'], ['test/kit.test.mjs', 'chain', '600', 's'], ['test/dashboard.test.mjs', 'chrome', '600', 's'], ['test/search.test.mjs', 'rest', '300', 's']]);
  const listed = [1, 2].flatMap((i) => { const s = runSync(['--list', '--shard', `${i}/2`]); assert.equal(s.status, 0, s.stderr); return s.stdout.trim().split('\n').filter(Boolean).map((l) => l.split(/\s+/)[0]); });
  assert.deepEqual([...listed].sort(), allFiles());
  const bad = runSync(['--list', '--shard', '3/2']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /shard/);
});
