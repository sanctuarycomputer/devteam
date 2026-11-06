// Each test process owns a block of 100 ports between 20000 and 32699 (below 32768, where Linux
// starts handing out ephemeral ports; macOS starts at 49152): the file-wide hub and instance block at PORTS, the ports test at
// PORTS+30, the hub test at PORTS+60. A block is claimed with a lock file in the temp dir, so the
// suite's files running side by side, and another checkout's suite, never share one. The lock goes
// when the process exits; one left by a process that died is cleared once it is an hour old.
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
