// A passing test, then one that starts what a hung test leaves behind (a detached child in a
// process group of its own, a tmux server, and with DTR_SURVIVOR=1 a process orphaned before any
// cleanup), writes their pids to pids.json, and waits. Everything here ends by itself within 60 s.
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { hasTmux } from '../../lib/kit.mjs';
import { put } from './out.mjs';

const argsOf = (pid) => spawnSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
const survivor = path.join(path.dirname(fileURLToPath(import.meta.url)), 'survivor.mjs');

test('first passes', () => {});

test('hangs', async () => {
  const d = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)//dtr-fixture'], { detached: true, stdio: 'ignore' });
  const o = { file: { pid: process.pid, args: argsOf(process.pid) }, detached: { pid: d.pid, args: argsOf(d.pid) }, scratch: os.tmpdir() };
  if (hasTmux) {
    spawnSync('tmux', ['new-session', '-d', '-s', 'h', 'sleep 60']);
    const q = (f) => spawnSync('tmux', ['display', '-p', '-t', 'h', f], { encoding: 'utf8' }).stdout.trim();
    const pid = Number(q('#{pid}'));
    o.server = { pid, args: argsOf(pid) };
    o.socket = q('#{socket_path}');
  }
  // through a parent that exits at once: the survivor is orphaned before cleanup starts
  if (process.env.DTR_SURVIVOR === '1') spawnSync(process.execPath, ['-e', `require('child_process').spawn(process.execPath, [${JSON.stringify(survivor)}], { detached: true, stdio: 'ignore' }).unref()`]);
  put('pids.json', o);
  await new Promise((r) => setTimeout(r, 60000));
});
