// sleeps 1.5 s on its first run only: a counter in DTR_FIXTURE_OUT
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { outDir } from './out.mjs';

const f = path.join(outDir, 'slow-count');
const n = (fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8')) : 0) + 1;
fs.writeFileSync(f, String(n));
test('is slow once', async () => { if (n === 1) await new Promise((r) => setTimeout(r, 1500)); });
