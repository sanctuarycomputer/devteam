// The kit's upload routes (devteam.mjs) and the naming rules they share with the cloud gateway.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
// the suite's shared env scrub, tmux shim and stand-ins (before anything that reads the environment)
import './lib/kit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const kit = path.resolve(here, '..', 'docs', 'devteam');
// ports of its own, apart from the blocks lib/kit.mjs hands out (20000 and up); set after its import, so these win
const PORTS = 10000 + (process.pid % 90) * 100;
const HUB = PORTS;
const P = PORTS + 1;
process.env.DEVTEAM_HUB_PORT = String(HUB);
process.env.DEVTEAM_PORT_BASE = String(P);
process.env.DEVTEAM_HUB_RETRY_MS = '500';
delete process.env.DEVTEAM_CLAIM_TOKEN;
const G = await import('../cloud/gateway.mjs');

// --- the shared upload rules ---------------------------------------------------------------------
// The kit's copy of the rules, loaded from the script by itself (as modelFns loads its block).
function rulesFromKit() {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const i = src.indexOf('/* upload rules start */'), j = src.indexOf('/* upload rules end */');
  assert.ok(i >= 0 && j > i, 'the markers are missing: the upload rules block in devteam.mjs');
  return vm.runInContext(`${src.slice(i, j)}\n;({ UPLOAD_RULES, safeUploadName, dropPaste, isDropImage, dropSpace })`, vm.createContext({}));
}

const NAMES = [
  '../../etc/passwd', '..\\..\\windows\\system.ini', '..', '.', '', '.bashrc', '/',
  'a\u0000b\n\r\u001b[31m.PNG', '$(rm -rf ~).txt', '`id`;x\'y".pdf', '--help.txt',
  'café ‮evil.JPG', '日本語.png', 'archive.tar.GZ', 'no-extension', 'dots....', 'x.has spaces in ext',
  '.part', 'a'.repeat(300) + '.png', 'b'.repeat(250), 'x.' + 'y'.repeat(20), '....png', 'Ünïcödé.WEBP', 'a/b\\c.txt', '%2e%2e.txt', ' ', '.jpeg', 'A B.png', 'file.PDF', 'tab\there.txt',
];
const PATHS = [['/u/a.png'], ['/u/a.png', '/u/b.pdf'], ["/u/it's.txt"], ['/u/a.JPEG', '/u/b.webp']];
const plain = (r) => ({ ...r, folder: { source: r.folder.source, flags: r.folder.flags } });

test('the upload rules: devteam.mjs\'s copy equals the gateway\'s (A8)', () => {
  const K = rulesFromKit();
  assert.deepEqual(plain(K.UPLOAD_RULES), plain(G.UPLOAD_RULES));
  for (const raw of NAMES) assert.equal(K.safeUploadName(raw), G.safeUploadName(raw), JSON.stringify(raw));
  for (const p of PATHS) {
    assert.equal(K.dropPaste(p), G.dropPaste(p), JSON.stringify(p));
    assert.equal(K.dropSpace(p), G.dropSpace(p), JSON.stringify(p));
    for (const x of p) assert.equal(K.isDropImage(x), G.isDropImage(x), x);
  }
});
