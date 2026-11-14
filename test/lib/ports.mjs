// Each test process owns a block of 100 ports between 20000 and 32699 (below 32768, where Linux
// starts handing out ephemeral ports; macOS starts at 49152). A block is claimed with a lock file in
// the temp dir, so the suite's files running side by side, and another checkout's suite, never share
// one. The lock goes when the process exits; one left by a process that died is cleared once it is
// an hour old.
//
// Inside a block, a test names a hub port and an instance base. Only a dashboard that picks its own
// port, or a hub asked for its list (/instances.json), scans base..base+24, so such a base must be
// +75 or lower to stay in the block. A test that pins its dashboard with --port, and never asks the
// hub's list, scans nothing: only its hub port is bound, and that must be in the block. Tests in one
// file run one at a time, so their ranges may overlap, but a port one test binds should be one no
// test before it in that file can still be holding.
// The layout, by offset:
// - +0 the file-wide hub, +1..25 its instances (lib/kit.mjs's defaults, and the gateway test's)
// - +10/11 next-step's dashboard (pinned)
// - +30/31..55 the ports and viewer tests
// - +40/41, +42/43 the data-wait tests (pinned)
// - +56/57 focus, +58/59 presses (pinned, never asking the hub's list: their bases scan nothing)
// - +60/61..85 the hub test; the preview relays bind +62..79 inside it (never at once: serial only)
// - +70/71..95 accounts (its own file)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.join(os.tmpdir(), 'devteam-kit-ports');
const BLOCKS = 127;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function claim() {
  fs.mkdirSync(dir, { recursive: true });
  for (let k = 0; k < BLOCKS; k++) {
    const block = (process.pid + k) % BLOCKS;
    const f = path.join(dir, `${block}.lock`);
    try { fs.writeFileSync(f, String(process.pid), { flag: 'wx' }); return { block, f }; } catch {}
    try {
      const owner = Number(fs.readFileSync(f, 'utf8'));
      if (!alive(owner) && Date.now() - fs.statSync(f).mtimeMs > 3600000) fs.rmSync(f);
    } catch {}
  }
  throw new Error(`no free block of ports: ${dir} holds a lock for every one`);
}
const { block, f } = claim();
process.on('exit', () => { try { if (fs.readFileSync(f, 'utf8') === String(process.pid)) fs.rmSync(f); } catch {} });
export const PORTS = 20000 + block * 100;
