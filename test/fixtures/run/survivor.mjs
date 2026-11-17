// Orphaned before cleanup, outside the tree the runner kills: it waits for its scratch folder (its
// TMPDIR) to go, up to 30 s, then asks for tmux -V (harmless even if a shim were broken), writes
// what it got to survivor.json, and exits.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { put } from './out.mjs';

const dir = os.tmpdir();
put('survivor-pid.json', { pid: process.pid, args: spawnSync('ps', ['-o', 'args=', '-p', String(process.pid)], { encoding: 'utf8' }).stdout.trim() });
const t0 = Date.now();
while (fs.existsSync(dir) && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 100));
const r = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
put('survivor.json', { status: r.status, stderr: r.stderr, gone: !fs.existsSync(dir) });
