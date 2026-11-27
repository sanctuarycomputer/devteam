// The overlay's apps-serve area (kit-984, apps@1 Serving, page-seam@1): in a tree generated at this
// checkout's HEAD, the CLI's dashboard, laptop hub and browser view serve the built apps from
// docs/devteam/apps/<app>/ under each page's own policy with hashed scripts, and every other route is
// as main serves it. The tree is split once, with the manifests and the areas load-time (so it runs),
// pages-docs (so the old pages are gone), apps-serve and apps-tests; test/fixtures/alpha-build/ is
// copied in as the root build. The source's own dashboard and hub answer first, on the same ports, and
// their answers are the expected values for every route this ticket keeps; then the tree's start.
// Skips, each naming its cause, never fail a regular PR: manifest drift that stops HEAD's split, and an
// item a check reads that went stale because its original changed on main (the parity run reports it,
// and the next apps ticket re-pins it). Anything else stale, any conflict, refusal or crash fails.
// Ports: +30/31 the hub and base, +32 the dashboard, +33 the browser view (the source's servers first,
// stopped before the tree's start on the same ports)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTS } from './lib/ports.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const splitSrc = path.join(root, 'test', 'split');
const tool = path.join(splitSrc, 'split.mjs');
const AREAS = ['load-time', 'pages-docs', 'apps-serve', 'apps-tests'];
const MINE = ['apps-serve', 'apps-tests'];
const AREA_DIR = path.join(splitSrc, 'overlay', 'apps-serve');
const HUB_PORT = PORTS + 30, PORT_BASE = PORTS + 31, DASH_PORT = PORTS + 32, VIEW_PORT = PORTS + 33;
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
// PATH and nothing else: no GIT_*, DEVTEAM_*, TMUX* or real HOME reaches git, the split or a server
const clean = { PATH: process.env.PATH };
const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', env: clean, maxBuffer: 1 << 28, timeout: 180000, ...o });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'split-apps-serve-'));
const kids = new Set();
const killKids = () => { for (const k of kids) try { process.kill(-k.pid, 'SIGKILL'); } catch {} };
// after() never runs when the top level throws: exit kills them all the same (and a signal exits)
process.on('exit', killKids);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
after(() => {
  killKids();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const git = (cwd, ...a) => run('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
const commitAll = (d, msg = 'x') => { for (const a of [['add', '-A'], ['commit', '-qm', msg]]) assert.equal(git(d, ...a).status, 0, `git ${a.join(' ')} in ${d}`); };

// ---- the split dir: the manifests, the split's lib, and the areas under test ----
const splitDir = path.join(tmp, 'split');
fs.mkdirSync(path.join(splitDir, 'overlay'), { recursive: true });
for (const m of fs.readdirSync(splitSrc).filter((f) => /^manifest.*\.json$/.test(f))) fs.copyFileSync(path.join(splitSrc, m), path.join(splitDir, m));
fs.cpSync(path.join(splitSrc, 'lib'), path.join(splitDir, 'lib'), { recursive: true });
for (const a of AREAS) if (fs.existsSync(path.join(splitSrc, 'overlay', a))) fs.cpSync(path.join(splitSrc, 'overlay', a), path.join(splitDir, 'overlay', a), { recursive: true });

// ---- the source, as a project its own init made (the source's servers run from it) ----
const sha = run('git', ['-C', root, 'rev-parse', 'HEAD']).stdout.trim();
const SRCDIR = path.join(tmp, 'source');
fs.mkdirSync(SRCDIR);
const tar = run('git', ['-C', root, 'archive', sha], { encoding: 'buffer' });
assert.equal(run('tar', ['-x', '-f', '-', '-C', SRCDIR], { input: tar.stdout, encoding: 'buffer' }).status, 0, 'the source extracts');
assert.equal(git(SRCDIR, 'init', '-q', '-b', 'main').status, 0);
commitAll(SRCDIR);
const homeOf = (name) => { const h = path.join(tmp, `home-${name}`); fs.mkdirSync(h, { recursive: true }); return h; };
const envOf = (name) => ({ ...clean, HOME: homeOf(name), DEVTEAM_OWN_KIT: '1', DEVTEAM_HUB_PORT: String(HUB_PORT), DEVTEAM_PORT_BASE: String(PORT_BASE) });
const made = run(process.execPath, ['docs/devteam/scripts/devteam.mjs', 'init'], { cwd: SRCDIR, env: envOf('init') });
assert.equal(made.status, 0, `the source's init makes a project: ${made.stderr}`);
commitAll(SRCDIR);
const PROJECT = ['.gitignore', '.gitleaks.toml', 'AGENTS.md', 'docs/devteam/project'];

// ---- the tree at HEAD, the project files copied in, committed before any build is copied ----
const TREE = path.join(tmp, 'tree');
const splitRun = run(process.execPath, [tool, '--repo', root, '--split-dir', splitDir, '--at', sha, '--out', TREE, '--json'], { cwd: tmp });
let J = {};
try { J = JSON.parse(splitRun.stdout); } catch { /* A1 names it */ }
const split = { status: splitRun.status, json: J, stderr: splitRun.stderr };
const treeMade = splitRun.status === 0 && fs.existsSync(path.join(TREE, 'docs/devteam/scripts/cli.mjs'));
if (treeMade) {
  for (const f of PROJECT) fs.cpSync(path.join(SRCDIR, f), path.join(TREE, f), { recursive: true });
  assert.equal(git(TREE, 'init', '-q', '-b', 'main').status, 0);
  git(TREE, 'remote', 'add', 'origin', 'https://github.com/sanctuarycomputer/devteam.git');
  commitAll(TREE);
}
// an area's applied and stale items, as 'kind name' strings, sorted
const itemsOf = (list, a) => (list ?? []).filter((x) => x.area === a).map((x) => `${x.kind} ${x.name}`).sort();
const area = (a) => ({ applied: itemsOf(J.overlay?.applied, a), stale: (J.overlay?.stale ?? []).filter((x) => x.area === a) });

// ---- skips ----
// HEAD drifted from the manifest, as split-tool's H tests judge it: the split writes nothing
const DRIFT = [/^split: manifest[\w-]*\.json: manifest: module .+ (?:is not in the source|starts at line \d+, not after .+|must start at line 1)$/,
  /^split: manifest[\w-]*\.json: module .+ is \d+ lines, over the cap of \d+$/, /^split: manifest[\w-]*\.json: the declaration at line \d+ .* binds names the split can't read whole/,
  /^split: nothing written$/];
const splitLines = splitRun.stderr.trim().split('\n').filter(Boolean);
const MANIFEST_SKIP = splitRun.status === 1 && splitLines.length > 0 && splitLines.every((l) => DRIFT.some((re) => re.test(l))) ? `HEAD's split stopped on manifest drift: ${splitLines.slice(0, 3).join('; ')}` : false;
// A stale item is drift when its original moved on main since the item was written: an override whose
// why is "the original changed" and whose source changed since the override's last commit; a patch that
// "no longer applies" to a file that is no longer the blob its index line names. Anything else is a
// failure (a wrong pin, a broken patch), never a skip.
const lastCommitOf = (rel) => run('git', ['-C', root, 'log', '-1', '--format=%H', '--', rel]).stdout.trim();
const SOURCE_OF = { IMAGE_RUNS: 'docs/devteam/scripts/devteam.mjs' };
const SHALLOW = run('git', ['-C', root, 'rev-parse', '--is-shallow-repository']).stdout.trim() === 'true';
function driftOf(s) {
  if (s.kind === 'override' && /^the original changed/.test(s.why)) {
    // no history to read (test.yml checks out at depth 1): skip, naming it; a run with history (the
    // box, the parity run) judges a wrong pin
    if (SHALLOW) return `${s.area}'s override ${s.name} is stale and this checkout is shallow, so drift on main can't be told from a wrong pin (${s.why.slice(0, 160)})`;
    const at = lastCommitOf(`test/split/overlay/${s.area}/overrides/${s.name}.mjs`);
    const src = SOURCE_OF[s.name] ?? 'docs/devteam/scripts/devteam.mjs';
    return at && run('git', ['-C', root, 'diff', '--quiet', at, sha, '--', src]).status === 1 ? `${s.area}'s override ${s.name} is stale: its original changed on main since it was pinned (${s.why.slice(0, 160)})` : false;
  }
  if (s.kind === 'patch' && /^no longer applies/.test(s.why)) {
    const p = path.join(splitSrc, 'overlay', s.area, 'patches', s.name);
    const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    const file = text.match(/^diff --git a\/(\S+) /m)?.[1];
    const blob = text.match(/^index ([0-9a-f]{40})\.\./m)?.[1];
    const now = file ? run('git', ['-C', root, 'rev-parse', `${sha}:${file}`]).stdout.trim() : '';
    return blob && now && blob !== now ? `${s.area}'s patch ${s.name} is stale: ${file} changed on main since the patch was made (${s.why.slice(0, 160)})` : false;
  }
  return false;
}
const STALE = (J.overlay?.stale ?? []);
const driftBy = (kind, name, a = 'apps-serve') => { for (const s of STALE) if (s.area === a && s.kind === kind && s.name === name) { const d = driftOf(s); if (d) return d; } return false; };
const SERVE = ['servePage', 'pageVersion', 'servePageAsset'];
const loadTimeStale = STALE.filter((s) => s.area === 'load-time');
const LOAD_TIME_SKIP = loadTimeStale.length ? `load-time is stale in HEAD's split (the parity run reports it): ${loadTimeStale.map((s) => `${s.kind} ${s.name}`).join(', ')}` : false;
// the items each check reads, by the first letter(s) of its id
const READS = {
  A: () => STALE.filter((s) => MINE.includes(s.area)).map(driftOf).find(Boolean) ?? false,
  D: () => SERVE.map((n) => driftBy('override', n)).find(Boolean) || LOAD_TIME_SKIP,
  W: () => driftBy('override', 'kitWatched') || LOAD_TIME_SKIP,
  I: () => driftBy('override', 'IMAGE_RUNS') || LOAD_TIME_SKIP,
  G1: () => driftBy('patch', 'gitignore.patch'),
  G2: () => driftBy('patch', 'box-image-yml.patch'),
  G3: () => driftBy('patch', 'test-yml.patch'),
  K: () => ['dashboard.kit-watch.test.mjs.patch', 'dashboard.kit-watch-pane.test.mjs.patch'].map((p) => driftBy('patch', p, 'apps-tests')).find(Boolean) ?? false,
};
// D, H, B, R, N, S all read the seam's three overrides and run the tree
for (const k of ['H', 'B', 'R', 'N', 'S']) READS[k] = READS.D;
function skipFor(id) {
  if (MANIFEST_SKIP) return MANIFEST_SKIP;
  if (!treeMade && !/^A/.test(id)) return false; // the test fails on it (A1 names the split's error)
  const k = Object.keys(READS).filter((x) => id.startsWith(x)).sort((a, b) => b.length - a.length)[0];
  return k ? READS[k]() : false;
}

// ---- requests ----
// One request, its path sent as written (no normalising of .. or %2e): { status, headers, body }.
function req(port, p, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { connection: 'close', ...headers }, timeout: 20000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', () => resolve({ status: 0, headers: {}, body: Buffer.alloc(0) }));
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', (e) => resolve({ status: 0, headers: {}, body: Buffer.from(String(e.message)), error: e.message }));
    r.end();
  });
}
const PORT_OF = { dash: DASH_PORT, hub: HUB_PORT, view: VIEW_PORT };
const keyOf = (server, method, p, headers = {}) => [server, method, p, ...Object.keys(headers).sort().map((h) => `${h}=${headers[h]}`)].join(' ');
const answerOf = (r) => ({ status: r.status, type: r.headers['content-type'] ?? null, csp: r.headers['content-security-policy'] ?? null });

// ---- servers ----
const until = async (f, ms, what) => { const end = Date.now() + ms; for (;;) { if (await f()) return; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 200)); } };
const refuses = (port) => new Promise((resolve) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); resolve(false); }); s.on('error', () => resolve(true)); });
function child(args, { cwd, env }) {
  const c = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  c.out = '';
  c.stdout.on('data', (b) => { c.out += b; });
  c.stderr.on('data', (b) => { c.out += b; });
  kids.add(c);
  return c;
}
async function stopAll(cs, ports) {
  for (const c of cs) { try { process.kill(-c.pid, 'SIGKILL'); } catch {} kids.delete(c); }
  for (const p of ports) await until(() => refuses(p), 20000, `port ${p} free`);
}
// The dashboard (which starts the laptop hub) of a project: the source's devteam.mjs or the tree's cli.mjs.
async function startDashboard(dir, script, name) {
  const d = child([script, 'dashboard', '--port', String(DASH_PORT)], { cwd: dir, env: envOf(name) });
  await until(async () => (await req(DASH_PORT, '/api/hello')).status === 200, 60000, `${name}'s dashboard (${d.out.slice(-400)})`);
  await until(async () => (await req(HUB_PORT, '/instances.json')).status === 200, 30000, `${name}'s hub (${d.out.slice(-400)})`);
  return d;
}
// The tree's browserViewServer, in a child that runs init() and then listens on VIEW_PORT.
const VIEW_CHILD = `const lib = process.argv[2];
const st = await import(lib + '/state.mjs');
await st.init();
const { browserViewServer } = await import(lib + '/browser-view.mjs');
const s = browserViewServer({});
s.listen(${VIEW_PORT}, '127.0.0.1', () => console.log('ready'));
`;
async function startView() {
  const f = path.join(tmp, 'view-child.mjs');
  fs.writeFileSync(f, VIEW_CHILD);
  const v = child([f, path.join(TREE, 'docs/devteam/scripts/lib')], { cwd: TREE, env: envOf('tree') });
  // a view that fails to start is B1's and N1's finding, not the harness's: they read view.out
  await until(() => /ready/.test(v.out) || v.exitCode !== null, 30000, 'the browser view');
  view = v;
  return v;
}
let treeKids = [];
let view = null; // the browser view's child: view.out says why it didn't start
async function startTree() {
  await stopAll(treeKids, [DASH_PORT, HUB_PORT, VIEW_PORT]);
  treeKids = [await startDashboard(TREE, 'docs/devteam/scripts/cli.mjs', 'tree'), await startView()];
}
const stopTree = () => stopAll(treeKids, [DASH_PORT, HUB_PORT, VIEW_PORT]).then(() => { treeKids = []; });
// A child that runs the tree's init() and prints JSON.stringify(expr), the module's exports in scope.
function treeCall(mod, expr) {
  const f = path.join(tmp, `call-${crypto.randomBytes(4).toString('hex')}.mjs`);
  fs.writeFileSync(f, [
    "import path from 'node:path';",
    'const lib = process.argv[2];',
    "const st = await import(lib + '/state.mjs');",
    'await st.init();',
    `const m = await import(lib + '/${mod}');`,
    // a Function body is sloppy code, so with () reads the module's exports as names
    `const value = new Function('m', 'kitDir', 'path', ${JSON.stringify(`with (m) { return (${expr}); }`)})(m, st.kitDir, path);`,
    'process.stdout.write(JSON.stringify(value));',
    'process.exit(0);',
  ].join('\n'));
  const r = run(process.execPath, [f, path.join(TREE, 'docs/devteam/scripts/lib')], { cwd: TREE, env: envOf('tree'), timeout: 60000 });
  assert.equal(r.status, 0, `treeCall ${mod}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

// ---- the build ----
const APPS = path.join(TREE, 'docs/devteam/apps');
const BROWSER_HTML = '<!doctype html><html><head><script src="/_next/static/chunks/app.js"></script></head><body><script>self.__b=1</script></body></html>';
const BROWSER_HASH = `sha256-${crypto.createHash('sha256').update('self.__b=1').digest('base64')}`;
const REVIEW = { 'devteam-ui.css': 'body{--t:1}\n', 'devteam-ui.js': 'window.__ui=1;\n' };
// test/fixtures/alpha-build/{dashboard,hub}/out as the tree's root build, with a browser route and the
// review helpers added to the dashboard's copy
function copyBuild() {
  fs.rmSync(APPS, { recursive: true, force: true });
  for (const app of ['dashboard', 'hub']) fs.cpSync(path.join(root, 'test/fixtures/alpha-build', app, 'out'), path.join(APPS, app), { recursive: true });
  const d = path.join(APPS, 'dashboard');
  fs.mkdirSync(path.join(d, 'browser'));
  fs.writeFileSync(path.join(d, 'browser/index.html'), BROWSER_HTML);
  const h = JSON.parse(fs.readFileSync(path.join(d, 'csp-hashes.json'), 'utf8'));
  h.pages['/browser/'] = [BROWSER_HASH];
  fs.writeFileSync(path.join(d, 'csp-hashes.json'), `${JSON.stringify(h, null, 2)}\n`);
  fs.mkdirSync(path.join(d, 'review'));
  for (const [f, t] of Object.entries(REVIEW)) fs.writeFileSync(path.join(d, 'review', f), t);
  const T = JSON.parse(fs.readFileSync(SERVING, 'utf8'));
  fs.writeFileSync(path.resolve(d, T.outside.at), T.outside.text);
  for (const c of T.cases) if (c.symlink) fs.symlinkSync(c.symlink.to, path.join(d, c.symlink.at));
}
const SERVING = path.join(root, 'test/fixtures/alpha-serving.json');
const hashesOf = (app, route) => JSON.parse(fs.readFileSync(path.join(APPS, app, 'csp-hashes.json'), 'utf8')).pages[route];

// The spec's §Policies rule, the test's own copy (never the tree's): script-src becomes 'self' plus the
// hashes; style-src gets 'self' first (the browser view's is 'self' alone); a missing script-src or
// style-src is appended; with default-src 'none', font-src 'self' and img-src 'self' data: are appended
// if absent (never on the browser view).
function transform(policy, hashes, { browser = false } = {}) {
  const ds = policy.split(';').map((d) => d.trim()).filter(Boolean);
  const H = hashes.map((h) => `'${h}'`);
  const has = (n) => ds.some((d) => d.split(/\s+/)[0] === n);
  const out = ds.map((d) => {
    const [n, ...v] = d.split(/\s+/);
    if (n === 'script-src') return ['script-src', "'self'", ...H].join(' ');
    if (n === 'style-src') return browser ? "style-src 'self'" : ['style-src', "'self'", ...v.filter((x) => x !== "'self'")].join(' ');
    return d;
  });
  if (!has('script-src')) out.push(['script-src', "'self'", ...H].join(' '));
  if (!has('style-src')) out.push(browser ? "style-src 'self'" : "style-src 'self' 'unsafe-inline'");
  if (!browser && ds.includes("default-src 'none'")) { if (!has('font-src')) out.push("font-src 'self'"); if (!has('img-src')) out.push("img-src 'self' data:"); }
  return out.join('; ');
}

// ---- the source's answers, recorded first on the same ports, then the tree's servers ----
// Every request a check compares with main: { server, method, path, headers }.
const LINK0 = 'kit-984-probe';
// S3: a path per reserved first segment that a route passes through (GET-only, exact-match routes)
const S3_PATHS = ['/api/hello', '/api/hello?x', '/api/hi/', '/upload', '/public/x.txt', '/review/a/b/c', '/review/preview/', '/view/artifact/x/', '/artifact/x.txt', '/public-manifest/x.txt', '/presence'];
const S3_PLANT = ['api/hello', 'api/hi/index.html', 'upload', 'public/x.txt', 'review/a/b/c', 'review/preview/index.html', 'view/artifact/x/index.html', 'artifact/x.txt', 'public-manifest/x.txt', 'presence'];
const REQS = [
  // D1-D3, H1: the page routes' policies at main (the tree's are these, transformed)
  { server: 'dash', method: 'GET', path: '/' },
  { server: 'dash', method: 'GET', path: '/index.html' },
  { server: 'dash', method: 'GET', path: `/view/artifact/${LINK0}` },
  { server: 'dash', method: 'GET', path: '/view/artifact/!' },
  { server: 'dash', method: 'GET', path: '/view/preview/apps-serve' },
  { server: 'dash', method: 'GET', path: '/view/preview/nonexistent-name' },
  { server: 'hub', method: 'GET', path: '/' },
  // R3, S3-S5: main's answers to what the export must not change
  { server: 'dash', method: 'GET', path: '/review/preview/other.js' },
  { server: 'dash', method: 'HEAD', path: '/review/preview/devteam-ui.js' },
  ...S3_PATHS.flatMap((p) => ['GET', 'HEAD'].map((method) => ({ server: 'dash', method, path: p }))),
  { server: 'dash', method: 'POST', path: '/logo.svg' },
  ...['/api/hello', '/api/data', '/upload/x', '/nothing.js'].map((p) => ({ server: 'dash', method: 'GET', path: p })),
  { server: 'dash', method: 'GET', path: '/review/preview/', headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' } },
  ...['/instances.json', '/nothing'].map((p) => ({ server: 'hub', method: 'GET', path: p })),
];
const SRC = {};
const PREVIEW = 'apps-serve';
// a preview record, in both projects, for /view/preview/<name> (readPreviews' shape)
function writePreviewRecord(dir) {
  const d = path.join(dir, 'docs/devteam/run/previews');
  fs.mkdirSync(d, { recursive: true });
  const far = new Date(Date.now() + 86400000).toISOString();
  fs.writeFileSync(path.join(d, `${PREVIEW}.json`), `${JSON.stringify({ name: PREVIEW, port: 39999, project: 'p', session: 's', label: 'x', cwd: dir, at: new Date().toISOString(), expires: far }, null, 2)}\n`);
}
// why the servers didn't start, for every check that needs them
let startError = null;
if (treeMade && !MANIFEST_SKIP) {
  copyBuild();
  if (!READS.D()) {
    try {
      for (const d of [SRCDIR, TREE]) writePreviewRecord(d);
      // the source first, on the same ports (its own project: the tree's build is not in it)
      const s = await startDashboard(SRCDIR, 'docs/devteam/scripts/devteam.mjs', 'source');
      for (const q of REQS) SRC[keyOf(q.server, q.method, q.path, q.headers)] = answerOf(await req(PORT_OF[q.server], q.path, q));
      await stopAll([s], [DASH_PORT, HUB_PORT]);
      await startTree();
    } catch (e) { startError = e; killKids(); }
  }
}
const started = () => { if (startError) throw new Error(`the servers didn't start: ${startError.message}`); };

test("A1: HEAD's split applies exactly apps-serve's and apps-tests' items, none of either stale, no conflict naming them", { skip: skipFor('A1') }, () => {
  assert.equal(split.status, 0, split.stderr);
  assert.deepEqual(area('apps-serve').applied, ['override IMAGE_RUNS', 'override kitWatched', 'override pageVersion', 'override servePage', 'override servePageAsset', 'patch box-image-yml.patch', 'patch gitignore.patch', 'patch test-yml.patch']);
  assert.deepEqual(area('apps-tests').applied, ['patch dashboard.kit-watch-pane.test.mjs.patch', 'patch dashboard.kit-watch.test.mjs.patch']);
  assert.deepEqual([...area('apps-serve').stale, ...area('apps-tests').stale], []);
  assert.deepEqual((J.overlay?.conflicts ?? []).filter((c) => c.areas.some((a) => MINE.includes(a))), []);
});

test('A3: the policy builder is the same text in the servePage and servePageAsset overrides', { skip: skipFor('A3') }, () => {
  const cut = (f) => {
    const t = fs.readFileSync(path.join(AREA_DIR, 'overrides', f), 'utf8');
    const m = /\n([ \t]*\/\/ policy builder start\n[\s\S]*?\n[ \t]*\/\/ policy builder end)\n/.exec(t);
    assert.ok(m, `${f} has the policy builder between its marker lines`);
    return m[1];
  };
  assert.equal(cut('servePageAsset.mjs'), cut('servePage.mjs'));
});

// ---- the pages (servePage, pageVersion) ----
const src = (server, p, headers) => { const a = SRC[keyOf(server, 'GET', p, headers)]; assert.ok(a, `the source answered ${server} ${p}`); return a; };
const readApp = (rel) => fs.readFileSync(path.join(APPS, rel));
const scriptSrcs = (csp) => csp.split('; ').filter((d) => d.startsWith('script-src '));
// one script-src, no 'unsafe-inline' in it
const shapeOk = (csp) => { const s = scriptSrcs(csp); assert.equal(s.length, 1, `one script-src in ${csp}`); assert.doesNotMatch(s[0], /unsafe-inline/); };
const NOTICE = "<!doctype html><meta charset=\"utf-8\"><title>devteam</title><p>This kit's pages aren't installed. They return at its next sync.</p>";

test('D1: the dashboard serves the build\'s index.html at / and /index.html, under today\'s policy with script-src \'self\' and the route\'s hashes', { skip: skipFor('D1') }, async () => {
  started();
  for (const p of ['/', '/index.html']) {
    const r = await req(DASH_PORT, p);
    assert.equal(r.status, 200, `${p}: ${r.body}`);
    assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.deepEqual(r.body, readApp('dashboard/index.html'), `${p} is the build's page`);
    assert.equal(r.headers['content-security-policy'], transform(src('dash', p).csp, hashesOf('dashboard', '/')));
    shapeOk(r.headers['content-security-policy']);
    assert.match(r.headers['content-security-policy'], /^frame-src 'self'.*; frame-ancestors 'self' http:\/\/127\.0\.0\.1:\d+; script-src 'self' 'sha256-[^']+'; style-src 'self' 'unsafe-inline'$/);
  }
});

test('D2: /view/artifact/<id> serves the build\'s index.html under the viewer\'s policy with the / hashes; a bad id is today\'s 404', { skip: skipFor('D2') }, async () => {
  started();
  const p = `/view/artifact/${LINK0}`;
  const r = await req(DASH_PORT, p);
  assert.equal(r.status, 200, String(r.body));
  assert.deepEqual(r.body, readApp('dashboard/index.html'));
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  assert.equal(r.headers['content-security-policy'], transform(src('dash', p).csp, hashesOf('dashboard', '/')));
  const bad = await req(DASH_PORT, '/view/artifact/!');
  assert.deepEqual(answerOf(bad), src('dash', '/view/artifact/!'));
});

test('D3: /view/preview/<name> serves the build\'s index.html under the preview\'s policy with the / hashes; an unknown name is today\'s 404', { skip: skipFor('D3') }, async () => {
  started();
  const p = `/view/preview/${PREVIEW}`;
  const r = await req(DASH_PORT, p);
  assert.equal(r.status, 200, String(r.body));
  assert.deepEqual(r.body, readApp('dashboard/index.html'));
  assert.equal(r.headers['content-security-policy'], transform(src('dash', p).csp, hashesOf('dashboard', '/')));
  assert.deepEqual(answerOf(await req(DASH_PORT, '/view/preview/nonexistent-name')), src('dash', '/view/preview/nonexistent-name'));
});

test('D4: /api/data\'s x-devteam-page is the first 16 hex of the sha256 of the build\'s index.html, read again after it changes', { skip: skipFor('D4') }, async () => {
  started();
  const f = path.join(APPS, 'dashboard/index.html');
  const was = fs.readFileSync(f);
  try {
    assert.equal((await req(DASH_PORT, '/api/data')).headers['x-devteam-page'], sha256(was).slice(0, 16));
    fs.appendFileSync(f, '<!-- x -->');
    assert.equal((await req(DASH_PORT, '/api/data')).headers['x-devteam-page'], sha256(fs.readFileSync(f)).slice(0, 16));
  } finally { fs.writeFileSync(f, was); }
});

test('H1: the laptop hub serves the hub build\'s index.html under today\'s hub policy with script-src \'self\' and its hashes, style-src \'self\', font-src and img-src', { skip: skipFor('H1') }, async () => {
  started();
  const r = await req(HUB_PORT, '/');
  assert.equal(r.status, 200, String(r.body));
  assert.deepEqual(r.body, readApp('hub/index.html'));
  const csp = r.headers['content-security-policy'];
  assert.equal(csp, transform(src('hub', '/').csp, hashesOf('hub', '/')));
  shapeOk(csp);
  assert.match(csp, /^default-src 'none'; /);
  assert.match(csp, /; font-src 'self'; img-src 'self' data:$/);
});

// needs no split: the checkout's browser.html against the override's copy of its base
test("B0: the override's browser base is browser.html's meta policy, its hashes aside", () => {
  const meta = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(fs.readFileSync(path.join(root, 'docs/devteam/dashboard/browser.html'), 'utf8'))?.[1];
  assert.ok(meta, 'browser.html has a meta policy');
  const f = path.join(AREA_DIR, 'overrides', 'servePage.mjs');
  const base = fs.existsSync(f) ? /^\s*const BROWSER_BASE = "([^"]+)";$/m.exec(fs.readFileSync(f, 'utf8'))?.[1] : undefined;
  assert.ok(base, 'servePage.mjs holds const BROWSER_BASE = "…"; on one line');
  // script-src and style-src with their sources dropped ('self' in the base, the hashes in the meta)
  const bare = (p, drop) => p.split(';').map((d) => d.trim().split(/\s+/)).map(([n, ...v]) => [n, ...(/^(script|style)-src$/.test(n) ? v.filter((t) => !drop.test(t)) : v)].join(' ')).join('; ');
  assert.equal(bare(base, /^'self'$/), bare(meta, /^'sha256-/));
});

test("B1: browserViewServer serves the build's browser/index.html at / under browser.html's policy with script-src 'self' and its hash, style-src 'self'", { skip: skipFor('B1') }, async () => {
  started();
  assert.match(view?.out ?? '', /ready/, `the browser view started: ${view?.out.slice(-400)}`);
  const r = await req(VIEW_PORT, '/');
  assert.equal(r.status, 200, String(r.body));
  assert.equal(r.body.toString(), BROWSER_HTML);
  assert.equal(r.headers['content-security-policy'], `default-src 'none'; script-src 'self' '${BROWSER_HASH}'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`);
});

// N1 to S8 move or change the build; each puts it back
test('N1: with no build, every page route serves the notice (503) under its policy with no hashes, and the browser view starts; a build copied in later is served', { skip: skipFor('N1') }, async () => {
  started();
  const aside = `${APPS}.aside`;
  fs.renameSync(APPS, aside);
  try {
    await startTree();
    assert.match(view.out, /ready/, `the browser view starts with no build: ${view.out.slice(-400)}`);
    const notice = async (port, p, policy) => {
      const r = await req(port, p);
      assert.equal(r.status, 503, `${p}: ${r.body}`);
      assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
      assert.equal(r.body.toString(), NOTICE);
      assert.equal(r.headers['content-security-policy'], policy, p);
    };
    for (const p of ['/', '/index.html', `/view/artifact/${LINK0}`, `/view/preview/${PREVIEW}`]) await notice(DASH_PORT, p, transform(src('dash', p).csp, []));
    await notice(HUB_PORT, '/', transform(src('hub', '/').csp, []));
    await notice(VIEW_PORT, '/', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
    assert.equal((await req(DASH_PORT, '/api/data')).headers['x-devteam-page'], '');
  } finally { fs.renameSync(aside, APPS); }
  const r = await req(VIEW_PORT, '/');
  assert.equal(r.status, 200, 'the browser view serves the build once it is there');
  assert.equal(r.body.toString(), BROWSER_HTML);
});

test('N2: a build whose csp-hashes.json is missing or not v1 serves 500, never a page without its hashes', { skip: skipFor('N2') }, async () => {
  started();
  const f = path.join(APPS, 'dashboard/csp-hashes.json');
  const was = fs.readFileSync(f);
  try {
    for (const bad of [null, '{"v":2,"pages":{"/":[]}}', 'not json']) {
      if (bad === null) fs.rmSync(f); else fs.writeFileSync(f, bad);
      const r = await req(DASH_PORT, '/');
      assert.equal(r.status, 500, `${bad ?? 'missing'}: ${r.status}`);
      assert.equal(r.body.toString(), 'this page could not be read\n');
    }
  } finally { fs.writeFileSync(f, was); }
});

test('S8 (pages): a hash that is not sha256-<44 base64> makes the page a 500, so a build never writes into the policy', { skip: skipFor('S8') }, async () => {
  started();
  const f = path.join(APPS, 'dashboard/csp-hashes.json');
  const was = fs.readFileSync(f);
  try {
    const h = JSON.parse(was);
    h.pages['/'] = ["sha256-x'; script-src *"];
    fs.writeFileSync(f, JSON.stringify(h));
    assert.equal((await req(DASH_PORT, '/')).status, 500);
  } finally { fs.writeFileSync(f, was); }
});

// ---- the rest of the export (servePageAsset) ----
const hubBase = () => src('hub', '/').csp;
const dashBase = `frame-src 'self'; frame-ancestors 'self' http://127.0.0.1:${HUB_PORT}`;
const srcOf = (server, method, p, headers) => { const a = SRC[keyOf(server, method, p, headers)]; assert.ok(a, `the source answered ${server} ${method} ${p}`); return a; };

test("R3: the review helpers come from the build's review/, to a GET, as main serves them", { skip: skipFor('R3') }, async () => {
  started();
  for (const [p, f, type] of [['/review/preview/devteam-ui.js', 'devteam-ui.js', 'text/javascript; charset=utf-8'], ['/review/q-20261127-000000000-probe/devteam-ui.css', 'devteam-ui.css', 'text/css; charset=utf-8']]) {
    const r = await req(DASH_PORT, p);
    assert.equal(r.status, 200, `${p}: ${r.body}`);
    assert.equal(r.headers['content-type'], type);
    assert.equal(r.body.toString(), REVIEW[f]);
  }
  assert.deepEqual(answerOf(await req(DASH_PORT, '/review/preview/other.js')), srcOf('dash', 'GET', '/review/preview/other.js'));
  const h = await req(DASH_PORT, '/review/preview/devteam-ui.js', { method: 'HEAD' });
  assert.equal(h.status, srcOf('dash', 'HEAD', '/review/preview/devteam-ui.js').status, 'a HEAD is not served the helper');
});

test("H2: the hub serves its build's files, and its own routes still answer", { skip: skipFor('H2') }, async () => {
  started();
  const r = await req(HUB_PORT, '/_next/static/chunks/app.js');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.deepEqual(r.body, readApp('hub/_next/static/chunks/app.js'));
  const i = await req(HUB_PORT, '/instances.json');
  assert.equal(i.status, 200);
  assert.equal(JSON.parse(i.body).hub, 1);
});

test("H3: the hub's route pages carry the hub's / policy with that route's hashes; a route with no entry is a 500", { skip: skipFor('H3') }, async () => {
  started();
  const r = await req(HUB_PORT, '/threads/one/');
  assert.equal(r.status, 200, String(r.body));
  assert.deepEqual(r.body, readApp('hub/threads/one/index.html'));
  assert.equal(r.headers['content-security-policy'], transform(hubBase(), hashesOf('hub', '/threads/one/')));
  const f = path.join(APPS, 'hub/csp-hashes.json');
  const was = fs.readFileSync(f);
  try {
    const h = JSON.parse(was);
    delete h.pages['/threads/one/'];
    fs.writeFileSync(f, JSON.stringify(h));
    assert.equal((await req(HUB_PORT, '/threads/one/')).status, 500);
  } finally { fs.writeFileSync(f, was); }
});

test('S1: the dashboard serves its build by alpha-serving.json at the root', { skip: skipFor('S1') }, async () => {
  started();
  const T = JSON.parse(fs.readFileSync(SERVING, 'utf8'));
  for (const c of T.cases) {
    if (c.path === '/next') continue;
    const p = c.path.slice('/next'.length);
    const r = await req(DASH_PORT, p);
    const what = `${c.name} (${p.slice(0, 80)})`;
    assert.equal(r.status, c.status, `${what}: status`);
    assert.equal(r.headers['content-type'] ?? null, c.type, `${what}: type`);
    if (c.status === 301) assert.equal(r.headers.location, c.location.slice('/next'.length), `${what}: location`);
    if (c.file) assert.deepEqual(r.body, readApp(`dashboard/${c.file}`), `${what}: bytes`);
  }
});

test("S2: a dashboard route's page carries pageCsp()'s base with that route's hashes", { skip: skipFor('S2') }, async () => {
  started();
  const r = await req(DASH_PORT, '/threads/one/');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-security-policy'], transform(dashBase, hashesOf('dashboard', '/threads/one/')));
});

test('S3: a static file under a reserved first segment never answers for a route', { skip: skipFor('S3') }, async () => {
  started();
  const d = path.join(APPS, 'dashboard');
  const made = [];
  try {
    for (const f of S3_PLANT) {
      const at = path.join(d, f);
      if (fs.existsSync(at)) continue;
      fs.mkdirSync(path.dirname(at), { recursive: true });
      fs.writeFileSync(at, `planted ${f}`);
      made.push(at);
    }
    for (const p of S3_PATHS) for (const method of ['GET', 'HEAD']) {
      const r = await req(DASH_PORT, p, { method });
      assert.ok(!(r.status === 200 && /^planted /.test(r.body.toString())), `${method} ${p} served the planted file`);
      const s = srcOf('dash', method, p);
      assert.deepEqual([r.status, r.headers['content-type'] ?? null], [s.status, s.type], `${method} ${p}`);
    }
  } finally {
    for (const at of made) fs.rmSync(at, { force: true });
    for (const top of ['api', 'upload', 'public', 'view', 'artifact', 'public-manifest', 'presence', 'review/a', 'review/preview']) {
      const at = path.join(d, top);
      if (fs.existsSync(at) && fs.statSync(at).isDirectory() && !fs.readdirSync(at, { recursive: true }).some((x) => fs.statSync(path.join(at, x)).isFile())) fs.rmSync(at, { recursive: true, force: true });
    }
  }
});

test('S4: a POST to an export file is answered as main answers it', { skip: skipFor('S4') }, async () => {
  started();
  const r = await req(DASH_PORT, '/logo.svg', { method: 'POST' });
  const s = srcOf('dash', 'POST', '/logo.svg');
  assert.deepEqual([r.status, r.headers['content-type'] ?? null], [s.status, s.type]);
});

test("S5: the routes' answers and policies are main's", { skip: skipFor('S5') }, async () => {
  started();
  const H = { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' };
  const cases = [...['/api/hello', '/api/data', '/upload/x', '/nothing.js'].map((p) => ['dash', p, {}]), ['dash', '/review/preview/', H], ...['/instances.json', '/nothing'].map((p) => ['hub', p, {}])];
  for (const [server, p, headers] of cases) {
    const r = await req(PORT_OF[server], p, { headers });
    const s = srcOf(server, 'GET', p, headers);
    assert.deepEqual([r.status, r.headers['content-security-policy'] ?? null], [s.status, s.csp], `${server} ${p}`);
  }
});

test("S6: the dashboard serves no /view/ or /browser/ page from its export; the browser view serves /_next/ only", { skip: skipFor('S6') }, async () => {
  started();
  const canvas = path.join(APPS, 'dashboard/view/canvas');
  fs.mkdirSync(canvas, { recursive: true });
  fs.writeFileSync(path.join(canvas, 'index.html'), '<!doctype html><p>canvas');
  try {
    for (const p of ['/view/canvas/', '/browser/']) assert.equal((await req(DASH_PORT, p)).status, 404, p);
  } finally { fs.rmSync(path.join(APPS, 'dashboard/view'), { recursive: true, force: true }); }
  const a = await req(VIEW_PORT, '/_next/static/chunks/app.js');
  assert.equal(a.status, 200);
  assert.deepEqual(a.body, readApp('dashboard/_next/static/chunks/app.js'));
  for (const p of ['/threads/one/', '/index.txt', '/socket']) assert.equal((await req(VIEW_PORT, p)).status, 404, `view ${p}`);
});

test("S7: HEAD /, /?_rsc= and /index.html?x are the root page under the base with / hashes", { skip: skipFor('S7') }, async () => {
  started();
  const policy = transform(dashBase, hashesOf('dashboard', '/'));
  const h = await req(DASH_PORT, '/', { method: 'HEAD' });
  assert.equal(h.status, 200);
  assert.equal(h.body.length, 0);
  assert.equal(h.headers['content-security-policy'], policy);
  for (const p of ['/?_rsc=x', '/index.html?x']) {
    const r = await req(DASH_PORT, p);
    assert.equal(r.status, 200, p);
    assert.deepEqual(r.body, readApp('dashboard/index.html'), p);
    assert.equal(r.headers['content-security-policy'], policy, p);
  }
});

test('S8 (assets): a bad hash under /threads/one/ makes /threads/one/ a 500', { skip: skipFor('S8') }, async () => {
  started();
  const f = path.join(APPS, 'dashboard/csp-hashes.json');
  const was = fs.readFileSync(f);
  try {
    const h = JSON.parse(was);
    h.pages['/threads/one/'] = ['sha256-short'];
    fs.writeFileSync(f, JSON.stringify(h));
    assert.equal((await req(DASH_PORT, '/threads/one/')).status, 500);
  } finally { fs.writeFileSync(f, was); }
});

// ---- the kit watch and the image's runs ----
test("W1: kitWatched watches self and each build's route index.html that exists", { skip: skipFor('W1') }, () => {
  const rel = (w) => w.slice(1).map((f) => path.relative(path.join(TREE, 'docs/devteam'), f));
  const w = treeCall('hub/image.mjs', "kitWatched('/x/cli.mjs')");
  assert.equal(w[0], '/x/cli.mjs');
  assert.deepEqual(rel(w), ['apps/dashboard/index.html', 'apps/dashboard/browser/index.html', 'apps/hub/index.html']);
  const hub = path.join(APPS, 'hub');
  fs.renameSync(hub, `${hub}.aside`);
  try { assert.deepEqual(rel(treeCall('hub/image.mjs', "kitWatched('/x/cli.mjs')")), ['apps/dashboard/index.html', 'apps/dashboard/browser/index.html']); } finally { fs.renameSync(`${hub}.aside`, hub); }
});

test('I1: a commit to the hub app or the shared code it imports is a minor for the image', { skip: skipFor('I1') }, () => {
  const A = git(TREE, 'rev-parse', 'HEAD').stdout.trim();
  for (const f of ['apps/dashboard/src/shared/probe.ts', 'apps/hub/src/x.tsx']) {
    try {
      fs.mkdirSync(path.dirname(path.join(TREE, f)), { recursive: true });
      fs.appendFileSync(path.join(TREE, f), '// kit-984 probe\n');
      assert.equal(git(TREE, 'add', '--', f).status, 0);
      assert.equal(git(TREE, 'commit', '-qm', `probe ${f}`).status, 0);
      const B = git(TREE, 'rev-parse', 'HEAD').stdout.trim();
      const r = run(process.execPath, ['docs/devteam/scripts/cli.mjs', 'box-pins', 'changed', '--since', A, '--to', B], { cwd: TREE, env: envOf('tree'), timeout: 120000 });
      assert.match(r.stdout, /^kind: minor/m, `${f}: ${r.stdout}${r.stderr}`);
    } finally { git(TREE, 'reset', '-q', '--hard', A); }
  }
});

// main's IMAGE_RUNS.parts, read as machine.box-pins.changed.test.mjs reads them
function sourceParts() {
  const t = fs.readFileSync(path.join(root, 'docs/devteam/scripts/devteam.mjs'), 'utf8');
  const at = t.indexOf('\nconst IMAGE_RUNS = {');
  assert.ok(at !== -1, 'IMAGE_RUNS is declared');
  const end = t.indexOf('\n};\n', at);
  return new Function(`return ${t.slice(at + '\nconst IMAGE_RUNS = '.length, end + 2)}`)().parts;
}
test("I2: IMAGE_RUNS names the hub app and the shared code as files, and serveAppFiles beside the seam", { skip: skipFor('I2') }, () => {
  const R = treeCall('box-pins.mjs', 'IMAGE_RUNS');
  assert.deepEqual(R.files, ['cloud/**', 'apps/hub/**', 'apps/dashboard/src/shared/**', 'docs/devteam/process/operator.md']);
  for (const p of ['servePage', 'servePageAsset', 'serveAppFiles', 'startHub']) assert.ok(R.parts.includes(p), p);
  assert.deepEqual(sourceParts().filter((p) => !R.parts.includes(p)), [], "every part of main's");
  assert.equal(R.parts.indexOf('serveAppFiles'), R.parts.indexOf('servePageAsset') + 1);
});

// ---- the patches ----
const treeText = (rel) => fs.readFileSync(path.join(TREE, rel), 'utf8');
test("G1: the tree's docs/devteam/.gitignore ignores apps/, so a build is never committed", { skip: skipFor('G1') }, () => {
  assert.ok(treeText('docs/devteam/.gitignore').split('\n').includes('apps/'));
  assert.equal(git(TREE, 'check-ignore', '-q', 'docs/devteam/apps/dashboard/index.html').status, 0);
});

test("G2: box-image.yml's paths name the hub app and the shared code, not hub.html", { skip: skipFor('G2') }, () => {
  const line = treeText('.github/workflows/box-image.yml').split('\n').find((l) => /^\s+paths:/.test(l));
  assert.ok(line, 'a paths: line');
  assert.match(line, /'apps\/hub\/\*\*'/);
  assert.match(line, /'apps\/dashboard\/src\/shared\/\*\*'/);
  assert.doesNotMatch(line, /hub\.html/);
});

test("G3: test.yml builds the apps once in build-apps, and every kit shard places the build before its first test run", { skip: skipFor('G3') }, () => {
  const lines = treeText('.github/workflows/test.yml').split('\n').filter((l) => !/^\s*#/.test(l));
  // a top-level job's lines, from its name to the next job's
  const job = (name) => {
    const at = lines.findIndex((l) => l === `  ${name}:`);
    assert.ok(at !== -1, `a job ${name}`);
    const end = lines.findIndex((l, i) => i > at && /^  [\w-]+:$/.test(l));
    return lines.slice(at, end === -1 ? undefined : end);
  };
  const b = job('build-apps').join('\n');
  assert.match(b, /node-version: 24\b/);
  assert.match(b, /for d in apps\/\*\/; do .*npm ci --ignore-scripts && DEVTEAM_BASE_PATH= npm run build/);
  assert.match(b, /uses: actions\/upload-artifact@v4\n\s+with:\n\s+name: apps-build/);
  const k = job('kit');
  assert.ok(k.some((l) => /^    needs: build-apps$/.test(l)), 'kit needs build-apps');
  const dl = k.findIndex((l) => /uses: actions\/download-artifact@v4/.test(l));
  assert.ok(dl !== -1 && /name: apps-build/.test(k[dl + 2]), 'kit downloads apps-build');
  const place = k.findIndex((l, i) => i > dl && /mv "\$d\/out" "docs\/devteam\/apps\/\$a"/.test(l));
  assert.ok(place !== -1, 'a step places each out/ at docs/devteam/apps/<app>/');
  const firstTest = k.findIndex((l) => /^\s+(- )?run: .*test\/run\.mjs/.test(l));
  assert.ok(firstTest !== -1 && place < firstTest, 'the build is placed before the first test step');
});
