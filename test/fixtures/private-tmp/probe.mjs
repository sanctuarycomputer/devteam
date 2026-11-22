// Imports lib/kit.mjs as a test file does, prints the temp dirs it sees and leaves a file in its TMPDIR.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hasTmux, tmuxShim } from '../../lib/kit.mjs';

fs.writeFileSync(path.join(os.tmpdir(), 'left-behind'), 'x');
// A tmux server of this file's own (through kit's shim), so the exit hook has one to end first.
let server = null;
if (hasTmux && process.env.PROBE_TMUX === '1') {
  spawnSync('tmux', ['new-session', '-d', '-s', 'probe', 'sleep 300']);
  server = Number(spawnSync('tmux', ['display-message', '-p', '-t', '=probe', '#{pid}'], { encoding: 'utf8' }).stdout.trim()) || null;
}
process.stdout.write(JSON.stringify({ tmp: os.tmpdir(), shared: process.env.DEVTEAM_TEST_SHARED_TMP, tmux: process.env.TMUX_TMPDIR, shim: tmuxShim, server }));
