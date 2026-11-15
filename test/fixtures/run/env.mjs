// what a test process sees, after lib/kit.mjs puts its own shim first on PATH
import os from 'node:os';
import { test } from 'node:test';
import '../../lib/kit.mjs';
import { put } from './out.mjs';

test('reports its env', () => {
  put('env.json', { TMPDIR: process.env.TMPDIR, tmpdir: os.tmpdir(), shared: process.env.DEVTEAM_TEST_SHARED_TMP, PATH: process.env.PATH });
});
