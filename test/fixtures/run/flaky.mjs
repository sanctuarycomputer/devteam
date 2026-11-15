// fails on its second run only: a counter in DTR_FIXTURE_OUT
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { outDir } from './out.mjs';

const f = path.join(outDir, 'flaky-count');
const n = (fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8')) : 0) + 1;
fs.writeFileSync(f, String(n));
test('fails on run 2', () => { if (n === 2) throw new Error('run 2'); });
