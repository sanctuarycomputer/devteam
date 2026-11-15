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
  assert.equal(R.groupOf('test/x.test.mjs', "// see './lib/chrome.mjs' for how\nimport fs from 'node:fs';\n"), 'rest');
  assert.equal(R.groupOf('test/x.test.mjs', "const s = \"import('./lib/chrome.mjs')\";\n"), 'rest', 'a dynamic import inside a string');
  assert.equal(R.groupOf('test/run.test.mjs', src('test/run.test.mjs')), 'rest', 'this file names chrome.mjs only in strings');
  // the rule's known cost (run.mjs, CHROME_DYNAMIC): a quote earlier on the line hides the import
  assert.equal(R.groupOf('test/x.test.mjs', "if (x === '1') await import('./lib/chrome.mjs');\n"), 'rest');
  assert.equal(R.groupOf('test/x.test.mjs', "if (x) {\n  await import('./lib/chrome.mjs');\n}\n"), 'chrome');
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
  assert.equal(R.weightsFor(['x', 'y', 'z', 'new'], { x: 1, y: 2, z: 9 }).get('new'), 2, 'the median, not the mean');
  assert.equal(R.weightsFor(['w', 'x', 'y', 'z', 'new'], { w: 1, x: 2, y: 9, z: 10 }).get('new'), 5.5, 'an even count: the middle two averaged');
  const ones = new Map([['c', 1], ['a', 1], ['b', 1]]);
  assert.deepEqual(R.shard(['c', 'a', 'b'], ones, 1), [['a', 'b', 'c']], 'equal weights: by path');
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

// ---- running files (T3) ----
const { spawn } = await import('node:child_process');
const { PassThrough } = await import('node:stream');
const fx = (name) => `test/fixtures/run/${name}`;
const hasTmux = spawnSync('tmux', ['-V']).status === 0;
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
  const child = spawn(argv[0], argv[1], { cwd, env: nodeEnv(env), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
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

// The one slow run (all of search.test.mjs, done-when 1) starts now and overlaps the tests below.
const searchRun = runRunner(['test/search.test.mjs'], { deadline: 120000 });
searchRun.catch(() => {});

test('a passing file', async () => {
  const r = await searchRun;
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^# test\/search\.test\.mjs\n(TAP version 13\n)?/m);
  assert.match(r.stdout, /^summary: 1 file, concurrency 2$/m);
  assert.match(r.stdout, /^ok \d+ - \S/m, 'its tests ran');
  assert.doesNotMatch(r.stdout, /called recursively/);
  assert.match(r.stdout, /^test\/search\.test\.mjs {2}\d+\.\d {2}ok$/m);
});

test('exit codes', async (t) => {
  const { env } = fixtureEnv(t);
  for (const f of ['fail.mjs', 'throws.mjs', 'exit-nonzero.mjs']) {
    const r = await runRunner([fx(f)], { env });
    assert.equal(r.code, 1, `${f}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, new RegExp(`^failed: test/fixtures/run/${f.replace('.', '\\.')} \\(`, 'm'));
  }
  assert.equal((await runRunner([fx('pass.mjs')], { env })).code, 0);
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
  fs.writeFileSync(path.join(d, 'plain'), '');
  fs.symlinkSync(outside, path.join(d, 'to-outside'));
  fs.symlinkSync(path.join(outside, 's3'), path.join(d, 'link-to-s3'));
  const real = fs.realpathSync(d);
  assert.deepEqual(R.socketsUnder(d).sort(), [path.join(real, 'a', 'b', 's2'), path.join(real, 's1')]);
  assert.deepEqual(R.socketsUnder(path.join(d, 'no-such')), []);
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
const hangEnv = (t, extra = {}) => fixtureEnv(t, extra, killFixtures);
const allDead = async (o) => {
  for (const p of [o.file, o.detached, ...(o.server ? [o.server] : [])]) assert.ok(await deadSoon(p.pid), `pid ${p.pid} (${p.args}) is dead`);
  if (o.socket) assert.notEqual(spawnSync(realTmuxPath || 'tmux', ['-S', o.socket, 'has-session'], { stdio: 'ignore' }).status, 0, 'its tmux server is gone');
  assert.equal(fs.existsSync(o.scratch), false, 'its scratch folder is gone');
};

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
  assert.ok(Date.now() - t0 < 4000, 'bounded');
  assert.throws(() => R.stopTree(1, { snapshot: () => new Map() }), /together/);
});

test('a hung file is killed with its tree, and a survivor is refused tmux', async (t) => {
  const { out, env } = hangEnv(t, { DTR_SURVIVOR: '1' });
  const r = await runRunner(['--file-timeout', '5', fx('hang.mjs')], { env, deadline: 45000 });
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^timed out: test\/fixtures\/run\/hang\.mjs after 5 s \(last test finished: first passes\)$/m);
  assert.match(r.stdout, /^test\/fixtures\/run\/hang\.mjs {2}\d+\.\d {2}timed out/m);
  await allDead(readJson(path.join(out, 'pids.json')));
  assert.ok(await waitFor(path.join(out, 'survivor.json'), 10000), 'the survivor reported');
  const s = readJson(path.join(out, 'survivor.json'));
  assert.equal(s.status, 1);
  assert.match(s.stderr, /tmux refused/);
});

for (const [sig, how, code] of [['SIGINT', 'the runner\'s group', 130], ['SIGTERM', 'the runner', 143]]) {
  test(`${sig} to ${how} cleans up every running file`, async (t) => {
    const { out, env } = hangEnv(t);
    const run = runRunner([fx('hang.mjs')], { env, deadline: 45000 });
    assert.ok(await waitFor(path.join(out, 'pids.json'), 30000), 'the fixture started');
    assert.ok(run.alive(), 'the runner is still running');
    process.kill(sig === 'SIGINT' ? -run.child.pid : run.child.pid, sig);
    const r = await run;
    assert.equal(r.code, code, r.stdout + r.stderr);
    assert.match(r.stdout, /^interrupted$/m);
    await allDead(readJson(path.join(out, 'pids.json')));
  });
}
