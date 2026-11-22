// Imports lib/kit.mjs as a test file does, prints the temp dirs it sees and leaves a file in its TMPDIR.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../lib/kit.mjs';

fs.writeFileSync(path.join(os.tmpdir(), 'left-behind'), 'x');
process.stdout.write(JSON.stringify({ tmp: os.tmpdir(), shared: process.env.DEVTEAM_TEST_SHARED_TMP, tmux: process.env.TMUX_TMPDIR }));
