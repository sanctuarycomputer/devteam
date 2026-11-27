#!/usr/bin/env node
// apps-src@1 The build's last step, run from an app's folder (npm run build): compiles the app's
// tsconfig.lib.json (src/lib/**, and for the dashboard its shared .ts modules) to plain ES2020
// modules in lib-dist/, which the ported node:vm tests import on Node 18 to 24. lib-dist/ is made
// afresh each time, and gets {"type":"module"}: Node 18 reads lib-dist/*.js as CommonJS without it.
// An app with nothing to compile yet (TypeScript's TS18003, "No inputs were found") gets the
// marker alone.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const app = process.cwd();
const out = path.join(app, 'lib-dist');
const tsc = path.join(app, 'node_modules', '.bin', 'tsc');
if (!fs.existsSync(path.join(app, 'tsconfig.lib.json'))) { console.error('lib-build: run it from an app folder (no tsconfig.lib.json here)'); process.exit(2); }
fs.rmSync(out, { recursive: true, force: true });
const r = spawnSync(tsc, ['-p', 'tsconfig.lib.json'], { cwd: app, encoding: 'utf8' });
const said = `${r.stdout ?? ''}${r.stderr ?? ''}`;
if (r.error) { console.error(`lib-build: ${r.error.message}`); process.exit(1); }
if (r.status !== 0 && !/\bTS18003\b/.test(said)) { process.stderr.write(said); process.exit(r.status ?? 1); }
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}\n');
console.log(r.status === 0 ? 'lib-build: lib-dist/ written' : 'lib-build: no src/lib modules yet; lib-dist/ holds the marker alone');
