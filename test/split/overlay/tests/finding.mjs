// The test-change check (cutover-tree@1, What a test change may do; kit-893): a test's text in the tree
// may differ from main's only in how it finds its source. The parity run (kit-895) calls
// sameBeyondFinding for every test whose text differs, and one it accepts is not "differing".
// The split doesn't read this file (its overlay loader lists it as ignored).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTestFile, rewireReads } from './rules.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const patchesDir = path.join(here, 'patches');

// This area's patch of one test file, if it has one: patches/<basename of the file>.patch, naming it.
function patchFor(file) {
  const p = path.join(patchesDir, `${path.posix.basename(file)}.patch`);
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, 'utf8');
  return text.includes(`\n+++ b/${file}\n`) ? p : null;
}
// git apply of one patch to one file's text, in a scratch folder: the patched text, or null.
function applied(file, text, patch) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'finding-'));
  try {
    fs.mkdirSync(path.join(d, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(d, file), text);
    const r = spawnSync('git', ['apply', '--whitespace=nowarn', patch], { cwd: d, encoding: 'utf8', env: { ...process.env, GIT_DIR: path.join(d, '.no-git') } });
    return r.status === 0 ? fs.readFileSync(path.join(d, file), 'utf8') : null;
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
}

// true when treeText is exactly what this area makes of sourceText: the one rule's rewrites (the
// gateway's reads, then the CLI's), then this area's patch of the file, if it has one (it has none
// today). Any other difference (an assertion, a selector, a timing) is false, and so is any file that
// is not a test.
export function sameBeyondFinding(sourceText, treeText, file) {
  if (typeof sourceText !== 'string' || typeof treeText !== 'string' || typeof file !== 'string' || !isTestFile(file)) return false;
  let want = rewireReads(file, sourceText, { gateway: true }).text;
  const p = patchFor(file);
  if (p) { const a = applied(file, want, p); if (a === null) return false; want = a; }
  return want === treeText;
}
