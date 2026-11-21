// browser-handover's timed profile scan (kit-67 C12), in a worker thread: the scan reads every profile
// file synchronously, which in the test's own thread would block the event loop that serves the fixture
// site and every chain's CLI. workerData: { profile, secrets, stop } (stop an Int32Array on a
// SharedArrayBuffer; 1 = stop). It posts { at, found, ms } per scan: a scan every 100 ms (the next
// starts 100 ms after the last started, or when it ends if it took longer), and once more after stop.
// The rules are scanProfile's (browser-handover-fixture.mjs): every regular file read whole as bytes,
// each secret looked for as UTF-8 and UTF-16LE; only a file or folder gone mid-scan (ENOENT) is passed
// over, any other error is posted as a find, never read as clean.
import { workerData, parentPort } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';

const { profile, secrets, stop } = workerData;
const needles = secrets.filter(Boolean).flatMap((s) => [Buffer.from(s, 'utf8'), Buffer.from(s, 'utf16le')]);
function scan() {
  const found = [];
  const walk = (dir) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT' && dir !== profile) return; throw e; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        let buf;
        try { buf = fs.readFileSync(p); } catch (err) { if (err.code === 'ENOENT') continue; throw err; }
        if (needles.some((n) => buf.includes(n))) found.push(path.relative(profile, p));
      }
    }
  };
  walk(profile);
  return found.sort();
}
const once = () => {
  const at = Date.now();
  let found;
  try { found = scan(); } catch (e) { found = [`(the scan failed: ${e.code ?? e.message})`]; }
  parentPort.postMessage({ at, found, ms: Date.now() - at });
  return at;
};
while (Atomics.load(stop, 0) === 0) {
  const at = once();
  const wait = 100 - (Date.now() - at);
  if (wait > 0) Atomics.wait(stop, 0, 0, wait);
}
once();
