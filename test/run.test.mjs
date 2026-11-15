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
      const r = runNode(${JSON.stringify(script)}, [], { env: { ...process.env, TMPDIR: ${JSON.stringify(T2)} } });
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
