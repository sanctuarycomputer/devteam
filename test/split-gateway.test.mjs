// The gateway in the generated tree (kit-894, cutover-tree@1): test/split/manifest-gateway.json splits
// cloud/gateway.mjs into cloud/gateway/*.mjs, and the overlay's gateway area (test/split/overlay/gateway/)
// makes cloud/gateway.mjs their entry, points `here` and the main-module check at it, rewires the tests
// that read the gateway's text, and patches cloud/Dockerfile to copy the modules. One tree is generated
// at this checkout's HEAD with the real split dir; each test reads it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tool = path.join(root, 'test', 'split', 'split.mjs');
const splitDir = path.join(root, 'test', 'split');
// NODE_TEST_CONTEXT too: a test run this one starts would otherwise report to this runner, not print
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GIT_|DEVTEAM_|NODE_TEST_CONTEXT$)/.test(k)));
const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', env, maxBuffer: 1 << 28, timeout: 240e3, ...o });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'split-gateway-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const lines = (t) => t.split('\n').length - (t.endsWith('\n') ? 1 : 0);

// The split dir: the manifests and the tool as this checkout has them, with the overlay areas this file
// judges kept by name: the gateway's, and the tests' (kit-893), which takes over rewireGatewayReads.
// Another area (kit-898's deleted pages, say) can't change what this file judges; the parity run
// (kit-895) judges the areas together.
const KEEP = new Set(['gateway', 'tests']);
const gwSplit = path.join(tmp, 'split');
fs.cpSync(splitDir, gwSplit, { recursive: true });
for (const a of fs.existsSync(path.join(gwSplit, 'overlay')) ? fs.readdirSync(path.join(gwSplit, 'overlay')) : []) if (!KEEP.has(a)) fs.rmSync(path.join(gwSplit, 'overlay', a), { recursive: true, force: true });
const tree = path.join(tmp, 'tree');
const made = run(process.execPath, [tool, '--at', 'HEAD', '--repo', root, '--split-dir', gwSplit, '--out', tree, '--json'], { cwd: tmp });
let report = {};
try { report = JSON.parse(made.stdout); } catch { /* the first test names it */ }
const inTree = (f) => path.join(tree, f);
const read = (f) => (fs.existsSync(inTree(f)) ? fs.readFileSync(inTree(f), 'utf8') : null);
const source = fs.readFileSync(path.join(root, 'cloud', 'gateway.mjs'), 'utf8');
const gwItems = (report.overlay?.applied ?? []).filter((a) => a.area === 'gateway').map((a) => `${a.kind} ${a.name}`);
// a scratch HOME and ports away from the box's, every DEVTEAM_* variable unset
const home = fs.mkdtempSync(path.join(tmp, 'home-'));
const quiet = { ...env, HOME: home, DEVTEAM_HUB_PORT: '4999' };

const modsInTree = () => (fs.existsSync(inTree('cloud/gateway')) ? fs.readdirSync(inTree('cloud/gateway')).sort() : []);
let verified = null; // split --verify on the tree, once
const verifyTree = () => {
  if (!verified) {
    const v = run(process.execPath, [tool, '--verify', '--at', 'HEAD', '--repo', root, '--split-dir', gwSplit, '--tree', tree, '--json'], { cwd: tmp });
    let j = {};
    try { j = JSON.parse(v.stdout); } catch { /* the assertion names it */ }
    verified = { status: v.status, out: v.stdout + v.stderr, of: (s) => j.report?.find((x) => x.source === s) };
  }
  return verified;
};

test('G1c: every module but server.mjs is at most 2,000 lines', () => {
  const over = modsInTree().filter((m) => m !== 'server.mjs').map((m) => [m, lines(read(`cloud/gateway/${m}`))]).filter(([, n]) => n > 2000);
  assert.deepEqual(over, [], 'modules over 2,000 lines');
});

test('G1d: server.mjs holds only createGateway, in at most 3,000 lines (the gateway manifest\'s cap)', () => {
  const server = read('cloud/gateway/server.mjs') ?? '';
  assert.deepEqual([...server.matchAll(/^export (?:async )?(?:function|const|let|class) ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]), ['createGateway'], 'the server module holds only createGateway');
  assert.ok(lines(server) <= 3000, `server.mjs is ${lines(server)} lines`);
});

test('G1e: split --verify finds no problem in the gateway\'s modules', () => {
  const v = verifyTree();
  assert.deepEqual(v.of('cloud/gateway.mjs')?.problems, [], `the gateway verifies: ${v.out.slice(0, 2000)}`);
});

test('G1f: and none in the CLI\'s, so verify exits 0', () => {
  const v = verifyTree();
  assert.deepEqual(v.of('docs/devteam/scripts/devteam.mjs')?.problems, [], `the CLI verifies: ${v.out.slice(0, 2000)}`);
  assert.equal(v.status, 0, v.out.slice(0, 2000));
});

// The manifest's templates: verify accepts fileParts' reads inside a named declaration only.
function verifyWith(edit) {
  const dir = fs.mkdtempSync(path.join(tmp, 'split-'));
  fs.cpSync(gwSplit, dir, { recursive: true });
  const f = path.join(dir, 'manifest-gateway.json');
  if (fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify(edit(JSON.parse(fs.readFileSync(f, 'utf8'))), null, 2));
  const v = run(process.execPath, [tool, '--verify', '--at', 'HEAD', '--repo', root, '--split-dir', dir, '--tree', tree, '--json'], { cwd: tmp });
  let j = {};
  try { j = JSON.parse(v.stdout); } catch { /* each test's assertion names what is missing */ }
  return { status: v.status, gw: j.report?.find((x) => x.source === 'cloud/gateway.mjs'), cli: j.report?.find((x) => x.source === 'docs/devteam/scripts/devteam.mjs') };
}

test('G7a: verify lists each fileParts read inside CLIENT and PAGES as accepted, in both', () => {
  const v = verifyWith((m) => m);
  const acc = v.gw?.inTemplates ?? [];
  assert.ok(acc.some((x) => / in CLIENT$/.test(x)) && acc.some((x) => / in PAGES$/.test(x)), `reads accepted in both: ${acc.join(', ')}`);
  assert.ok(acc.every((x) => / in (?:CLIENT|PAGES)$/.test(x)), acc.join(', '));
  assert.equal(v.status, 0);
});

test('G7b: the CLI\'s verify result is as before: no problems, no template reads, the independent count equal', () => {
  const v = verifyWith((m) => m);
  assert.deepEqual([v.cli?.problems, v.cli?.inTemplates ?? [], v.cli?.parts?.equal, v.cli?.parts?.source === v.cli?.parts?.tree], [[], [], true, true]);
});

test('G7c: a read outside a named template is still refused, and a templates name that is no declaration is a problem', () => {
  const v = verifyWith((m) => ({ ...m, templates: ['CLIENT', 'NO_SUCH'] }));
  const refused = (v.gw?.problems ?? []).filter((p) => p.startsWith("fileParts reads a declaration the scanner doesn't: "));
  assert.ok(refused.length > 0, `PAGES's reads are refused: ${(v.gw?.problems ?? []).join(' | ')}`);
  assert.equal(v.status, 1);
  assert.ok((v.gw?.inTemplates ?? []).every((x) => / in CLIENT$/.test(x)), 'only CLIENT\'s reads are accepted');
  assert.ok(v.gw.problems.includes('manifest: templates names NO_SUCH, which is not a top-level declaration'), v.gw.problems.join(' | '));
});

test('G7d: templates that is not a list of names is a problem', () => {
  const v = verifyWith((m) => ({ ...m, templates: 'CLIENT' }));
  assert.ok((v.gw?.problems ?? []).includes('manifest: templates must be a list of declaration names'), (v.gw?.problems ?? []).join(' | '));
  assert.equal(v.status, 1);
});
