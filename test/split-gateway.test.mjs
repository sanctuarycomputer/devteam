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

test('G1a: the gateway area is applied whole, and nothing of it is stale', () => {
  assert.equal(made.status, 0, `split: ${made.stderr}`);
  assert.deepEqual(gwItems, ['rule here', 'rule gateway-source', 'rule entry', 'rule test-reads', 'patch dockerfile-gateway-modules.patch'], 'every item of the gateway area is applied');
  assert.deepEqual((report.stale ?? []).filter((s) => /gateway/.test(`${s.area} ${s.name}`)), [], 'nothing of the gateway is stale');
});

test('G1b: cloud/gateway.mjs is an entry: it declares nothing and loads each module under cloud/gateway/', () => {
  assert.deepEqual(modsInTree(), ['assets.mjs', 'base.mjs', 'pages.mjs', 'server.mjs']);
  const entry = read('cloud/gateway.mjs');
  assert.doesNotMatch(entry, /^(?:export )?(?:async )?(?:function|const|let|var|class) /m, 'the entry declares nothing');
  for (const m of modsInTree()) assert.match(entry, new RegExp(`^import '\\./gateway/${m.replace('.', '\\.')}';$`, 'm'), `the entry loads ${m}`);
});

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

// Every name a kit test takes from cloud/gateway.mjs: named imports, and G.<name> on a module bound by
// `const G = await import(... gateway.mjs ...)`.
function namesTestsImport() {
  const names = new Set();
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!['fixtures', 'split'].includes(e.name)) walk(p); } else if (e.name.endsWith('.mjs')) scan(fs.readFileSync(p, 'utf8')); } };
  const scan = (t) => {
    for (const m of t.matchAll(/import\s*\{([^}]*)\}\s*from\s*'[^']*cloud\/gateway\.mjs'/g)) for (const b of m[1].split(',')) { const n = b.trim().split(/\s+as\s+/)[0]; if (n) names.add(n); }
    for (const m of t.matchAll(/const ([A-Za-z_$][\w$]*) = await import\(([^;]*?)\);/g)) {
      if (!/gateway\.mjs/.test(m[2]) || !/cloud/.test(m[2])) continue;
      for (const u of t.matchAll(new RegExp(`(?<![\\w$.])${m[1].replace('$', '\\$')}\\.([A-Za-z_$][\\w$]*)`, 'g'))) names.add(u[1]);
    }
  };
  walk(path.join(root, 'test'));
  return [...names].sort();
}
const exportsOf = (file) => {
  const r = run(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(file)}); console.log(JSON.stringify(Object.keys(m).sort()));`], { cwd: tmp, env: quiet, timeout: 30e3 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test('G2: every name the kit\'s tests import from cloud/gateway.mjs is exported by the entry, which exports what the single file did', () => {
  const wanted = namesTestsImport();
  assert.ok(wanted.length >= 20 && wanted.includes('createGateway') && wanted.includes('paneSignature'), `the scan finds the tests' names: ${wanted.join(', ')}`);
  const have = exportsOf(inTree('cloud/gateway.mjs'));
  assert.deepEqual(wanted.filter((n) => !have.includes(n)), [], 'names the tests import that the entry does not export');
  assert.deepEqual(have, exportsOf(path.join(root, 'cloud', 'gateway.mjs')), 'the same exports as the single file');
});

test('G3: test/lib/gateway-source.mjs gives the single file\'s text, but for the here line the overlay rewrote', async () => {
  assert.ok(fs.existsSync(inTree('test/lib/gateway-source.mjs')), 'the overlay writes test/lib/gateway-source.mjs');
  const { gatewaySource } = await import(inTree('test/lib/gateway-source.mjs'));
  const a = gatewaySource().split('\n'), b = source.split('\n');
  assert.equal(a.length, b.length, 'as many lines as the source');
  const diff = a.map((l, i) => [i + 1, l, b[i]]).filter(([, x, y]) => x !== y);
  assert.deepEqual(diff.map(([, x, y]) => [y, x]), [["const here = path.dirname(fileURLToPath(import.meta.url));", "const here = path.dirname(fileURLToPath(new URL('../gateway.mjs', import.meta.url)));"]]);
});

// The kit's tests that hold the gateway's copies equal to the script's (the claim-link rule, BRANCH_AT, the
// preview lens and its framing rules, the upload rules), and the other tests that read the gateway's text,
// run inside the tree by name.
const COPIES = [
  ['test/gateway.test.mjs', ["the kit's preview lens and framing rules are the gateway's own: the laptop's relay serves the same bytes", "C5i the gateway's BRANCH_AT is the kit's, character for character", 'C4h a bad /c/ link does the same MAC work on an unlisted name', 'only boxImage reads DEVTEAM_KIT_RELEASE and DEVTEAM_BOX_TOOLS in gateway.mjs']],
  ['test/org-access.invites.test.mjs', ["org-access A2: the gateway's and devteam.mjs's claim-link rules are one, and a press the gateway redacted still reads as signed", "org-access A5: only a finished sign-in method flow mints a session (the gateway's source)"]],
  ['test/attachments.upload.test.mjs', ["the upload rules: devteam.mjs's copy equals the gateway's (A8)"]],
  ['test/dashboard.relay.test.mjs', ["the laptop's relay: the lens on GET alone, the app with localhost as its Host and Origin, its framing given way only to its lens"]],
];
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
for (const [file, names] of COPIES) {
  test(`G4: in the tree, ${file}'s tests on the gateway's copies and text pass (${names.length})`, { timeout: 200e3 }, () => {
    const pattern = `^(?:${names.map(reEscape).join('|')})$`;
    const r = run(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', `--test-name-pattern=${pattern}`, file], { cwd: tree, env: quiet, timeout: 180e3 });
    // each named test, at the top level of the TAP, as ok
    const top = new Map([...r.stdout.matchAll(/^(ok|not ok) \d+ - (.*)$/gm)].map((m) => [m[2], m[1]]));
    assert.deepEqual(names.map((n) => [n, top.get(n) ?? 'did not run']), names.map((n) => [n, 'ok']), `${file} in the tree:\n${r.stdout.slice(-3000)}${r.stderr.slice(-1000)}`);
    assert.equal(r.status, 0);
  });
}

test('G5a: the gateway\'s here is the entry\'s folder', () => {
  assert.match(read('cloud/gateway/base.mjs') ?? '', /^export const here = path\.dirname\(fileURLToPath\(new URL\('\.\.\/gateway\.mjs', import\.meta\.url\)\)\);$/m);
});

test('G5b: the main-module check is the entry\'s own, so importing the entry serves nothing', () => {
  // imported by a script file, as a test imports it: process.argv[1] is that file, not the entry
  const importer = path.join(tmp, 'imports-the-gateway.mjs');
  fs.writeFileSync(importer, `await import(${JSON.stringify(pathToFileURL(inTree('cloud/gateway.mjs')).href)});\n`);
  const r = run(process.execPath, [importer], { cwd: tmp, env: { ...quiet, PORT: '1' }, timeout: 20e3 });
  assert.deepEqual([r.error?.code, r.status, r.stdout, r.stderr], [undefined, 0, '', ''], 'importing the entry exits by itself and prints nothing: no server started');
  assert.doesNotMatch(read('cloud/gateway/pages.mjs') ?? 'no pages.mjs: process.argv', /process\.argv/, 'the command line is not in a module');
  assert.match(read('cloud/gateway.mjs'), /^if \(process\.argv\[1\] && fileURLToPath\(import\.meta\.url\) === fs\.realpathSync\(process\.argv\[1\]\)\) \{$/m, 'the entry runs it, on its own import.meta.url');
});

const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });

test('G5c: `node gateway.mjs serve` from the box\'s layout (gateway.mjs, gateway/, hub.html side by side) answers /healthz', { timeout: 60e3 }, async () => {
  assert.ok(fs.existsSync(inTree('cloud/gateway')), 'the tree has cloud/gateway/');
  const box = path.join(tmp, 'opt');
  fs.mkdirSync(box);
  fs.cpSync(inTree('cloud/gateway.mjs'), path.join(box, 'gateway.mjs'));
  fs.cpSync(inTree('cloud/gateway'), path.join(box, 'gateway'), { recursive: true });
  fs.writeFileSync(path.join(box, 'hub.html'), '<!doctype html><title>hub</title>');
  fs.writeFileSync(path.join(box, 'ttyd.html'), 'ttyd');
  const uploads = path.join(home, 'uploads');
  fs.mkdirSync(uploads, { mode: 0o750 });
  const port = await freePort();
  const c = spawn(process.execPath, [path.join(box, 'gateway.mjs'), 'serve'], { env: { ...quiet, DEVTEAM_GATEWAY_DIR: path.join(home, 'gw'), DEVTEAM_UPLOADS_DIR: uploads, DEVTEAM_PUBLIC_URL: `http://box.localhost:${port}`, PORT: String(port), DEVTEAM_TTYD_PORT: String(await freePort()) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  c.stdout.on('data', (b) => { out += b; });
  c.stderr.on('data', (b) => { out += b; });
  try {
    let body = null;
    for (const end = Date.now() + 20e3; body === null && c.exitCode === null && Date.now() < end;) {
      body = await fetch(`http://127.0.0.1:${port}/healthz`).then((r) => (r.ok ? r.text() : null), () => null);
      if (body === null) await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(body, 'ok', `/healthz from the entry: ${out}`);
    assert.match(out, /^image: none$/m, 'the command line ran');
  } finally {
    if (c.exitCode === null && c.signalCode === null) await new Promise((r) => { c.once('exit', r); c.kill('SIGTERM'); });
  }
});

test('G6: the tree\'s cloud/Dockerfile copies cloud/gateway/ beside gateway.mjs, mode 644, before the chmod -R that keeps it readable', () => {
  const d = read('cloud/Dockerfile');
  const L = d.split('\n');
  const at = (re) => L.findIndex((l) => re.test(l));
  const gw = at(/^COPY --chmod=644 cloud\/gateway\.mjs \/opt\/devteam\/gateway\.mjs$/);
  const mods = at(/^COPY --chmod=644 cloud\/gateway\/ \/opt\/devteam\/gateway\/$/);
  const chmod = L.findIndex((l, i) => i > mods && /chmod -R u=rwX,go=rX \/opt\/devteam/.test(l));
  assert.ok(gw >= 0, 'the entry is copied as today');
  assert.ok(mods > gw, 'the modules are copied beside it');
  assert.ok(chmod > mods, 'a chmod -R u=rwX,go=rX /opt/devteam after it makes the folder 755 and every module 644');
  assert.equal(d.replace(/\n# Its modules, beside it[^\n]*\n[^\n]*\nCOPY --chmod=644 cloud\/gateway\/ \/opt\/devteam\/gateway\/\n/, '\n'), fs.readFileSync(path.join(root, 'cloud', 'Dockerfile'), 'utf8'), 'and nothing else changes');
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

// The rewrite kit-893 folds into its rule, on the forms a test could take (task-2 review): the helper's
// import goes after the last import statement, never into the code after it; a const named with a $ is
// rewired like any other; a read whose arguments name the gateway but that the rule can't rewrite is refused.
test('G8: rewireGatewayReads puts its import after the imports, rewires a $ const, and refuses a read it can\'t rewrite', async () => {
  const { rewireGatewayReads } = await import(pathToFileURL(path.join(root, 'test', 'split', 'overlay', 'gateway', 'rules.mjs')).href);
  const file = 'test/some.test.mjs';
  const placed = rewireGatewayReads(file, [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    '',
    'function check(dir) {',
    "  const text = fs.readFileSync(path.join(dir, 'cloud', 'gateway.mjs'), 'utf8');",
    '  return text.length;',
    '}',
    '',
  ].join('\n'));
  assert.deepEqual(placed.text.split('\n').slice(0, 4), ["import fs from 'node:fs';", "import path from 'node:path';", "import { gatewaySource } from './lib/gateway-source.mjs';", ''], 'the helper\'s import follows the last import');
  assert.match(placed.text, /^ {2}const text = gatewaySource\(\);$/m);
  const checked = path.join(tmp, 'placed.mjs');
  fs.writeFileSync(checked, placed.text);
  const c = run(process.execPath, ['--check', checked]);
  assert.equal(c.status, 0, `the rewired file parses: ${c.stderr}`);
  const dollar = rewireGatewayReads(file, ["import fs from 'node:fs';", "import path from 'node:path';", "const $gw = path.join(root, 'cloud', 'gateway.mjs');", "const s = fs.readFileSync($gw, 'utf8');", ''].join('\n'));
  assert.match(dollar.text, /^const s = gatewaySource\(\);$/m, 'a read of $gw is rewired');
  assert.deepEqual(dollar.refused, []);
  const nested = rewireGatewayReads(file, ["import fs from 'node:fs';", "import path from 'node:path';", "const s = fs.readFileSync(path.join(repoRoot(), 'cloud', 'gateway.mjs'), 'utf8');", ''].join('\n'));
  assert.equal(nested.refused.length, 1, 'a read the rule can\'t rewrite is refused, naming its line');
  assert.match(nested.refused[0].site, /^line 3$/);
});
