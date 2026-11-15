// starts a tmux server of its own (under a dt-tmux- folder lib/kit.mjs doesn't know), then ends
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { put } from './out.mjs';

test('starts a tmux server and ends', () => {
  const env = { ...process.env, TMUX_TMPDIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dt-tmux-')) };
  delete env.TMUX;
  const r = spawnSync('tmux', ['new-session', '-d', '-s', 'e', 'sleep 60'], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`tmux: ${r.stderr}`);
  const q = (f) => spawnSync('tmux', ['display', '-p', '-t', 'e', f], { env, encoding: 'utf8' }).stdout.trim();
  put('tmux-ends.json', { server: Number(q('#{pid}')), socket: q('#{socket_path}'), scratch: os.tmpdir() });
});
