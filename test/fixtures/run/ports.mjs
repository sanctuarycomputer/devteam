// claims a port block, then holds it until a second file has seen both blocks held (up to 10 s)
import fs from 'node:fs';
import os from 'node:os';
import { test } from 'node:test';
import { LOCK_DIR, PORTS } from '../../lib/ports.mjs';
import { outDir, put } from './out.mjs';

const until = async (ok) => { for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 100)); return ok(); };
test('claims a block while another file does', async () => {
  const two = await until(() => fs.readdirSync(LOCK_DIR).filter((f) => f.endsWith('.lock')).length >= 2);
  put(`ports-${process.pid}.json`, { LOCK_DIR, PORTS, pid: process.pid, scratch: os.tmpdir(), two });
  await until(() => fs.readdirSync(outDir).filter((f) => /^ports-\d+\.json$/.test(f)).length >= 2);
});
