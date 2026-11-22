// lib/private-tmp.mjs: a test file run on its own gets a private TMPDIR, removed as it exits;
// under test/run.mjs (DEVTEAM_TEST_SHARED_TMP set) the runner's own folder is left as it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const probe = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'private-tmp', 'probe.mjs');
const run = (env) => {
  const r = spawnSync(process.execPath, [probe], { encoding: 'utf8', env, timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test('a file run on its own: its own short TMPDIR, the shared one named, and nothing left after it', () => {
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-ptmp-shared-'));
  try {
    const env = { ...process.env, TMPDIR: shared };
    delete env.DEVTEAM_TEST_SHARED_TMP;
    const before = fs.readdirSync(shared);
    const o = run(env);
    assert.match(path.basename(o.tmp), /^dtr-/);
    assert.notEqual(o.tmp, shared);
    assert.equal(o.shared, shared);
    assert.ok(o.tmux.startsWith(o.tmp + path.sep), `the tmux folder is inside it: ${o.tmux}`);
    assert.equal(fs.existsSync(o.tmp), false, 'removed as the process exits');
    const after = fs.readdirSync(shared).filter((n) => !before.includes(n) && n !== 'devteam-kit-ports');
    assert.deepEqual(after, [], 'nothing new in the shared temp dir');
  } finally { fs.rmSync(shared, { recursive: true, force: true }); }
});

test('under the runner: the TMPDIR it was given is kept', () => {
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-ptmp-shared-'));
  const mine = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-ptmp-file-'));
  try {
    const o = run({ ...process.env, TMPDIR: mine, DEVTEAM_TEST_SHARED_TMP: shared });
    assert.equal(o.tmp, mine);
    assert.equal(o.shared, shared);
    assert.ok(fs.existsSync(path.join(mine, 'left-behind')), 'the runner removes its own folder, not the file');
  } finally { for (const d of [shared, mine]) fs.rmSync(d, { recursive: true, force: true }); }
});
