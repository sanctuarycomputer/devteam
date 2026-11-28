// The overlay's package-hub area (kit-967, kit-package@1's hub, kit-install@1's hub tree): in the tree,
// a dashboard that starts the laptop hub runs it from ~/.devteam/hub/current when that names a verified
// layout-2 install (a child, `node <folder>/node_modules/<name>/docs/devteam/scripts/cli.mjs hub`, run in
// the dashboard's project), and in its own process as today otherwise. Checks are numbered as in the ticket's spec.
// The tree is generated once at this checkout's HEAD with the whole overlay; each dashboard runs the
// tree's cli.mjs in a project, with a scratch HOME, its hub port and instance block from free ports (never
// 4320), and every DEVTEAM_* but the test's own unset (test/lib/kit.mjs). Which process serves the hub is
// read from /proc: the one listening on the hub port, and its cwd. Linux only.
// Drift skips, naming it (the parity run reports both), so a regular PR is never failed here: manifest
// drift that stops HEAD's split, and an override whose original changed at HEAD. An override is drifted
// only when its pin is the hash of the original it was made from: the README's record of it, and, where
// git has the history, dashboardHub's item at the commit that last changed the area, which must be the
// same text. Any other stale pin is broken, and H1 judges it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { freePort } from './lib/kit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tool = path.join(root, 'test', 'split', 'split.mjs');
const AREA = 'package-hub';
const NAME = '@sanctuarycomputer/devteam';
const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GIT_|npm_config_)/i.test(k)));
const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', env: base, maxBuffer: 1 << 28, timeout: 180_000, ...o });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'split-hub-pointer-'));
const sleep = (n) => new Promise((r) => setTimeout(r, n));
// a bounded wait: the value, or null once ms have passed (the assertion after it names what was wanted)
const waitFor = async (f, ms = 30000) => { for (const end = Date.now() + ms; ;) { const v = await f(); if (v) return v; if (Date.now() > end) return null; await sleep(100); } };

// ---- the tree: HEAD, the whole overlay ----
const sha = run('git', ['-C', root, 'rev-parse', 'HEAD']).stdout.trim();
const KIT = path.join(tmp, 'kit');
const made = run(process.execPath, [tool, '--repo', root, '--split-dir', path.join(root, 'test', 'split'), '--at', sha, '--out', KIT, '--json'], { cwd: tmp });
let J = {};
try { J = JSON.parse(made.stdout); } catch { /* H1 names it */ }
const DRIFT = [/^split: manifest[\w-]*\.json: manifest: module .+ (?:is not in the source|starts at line \d+, not after .+|must start at line 1)$/,
  /^split: manifest[\w-]*\.json: module .+ is \d+ lines, over the cap of \d+$/, /^split: manifest[\w-]*\.json: the declaration at line \d+ .* binds names the split can't read whole/,
  /^split: nothing written$/];
const errs = made.stderr.trim().split('\n').filter(Boolean);
const mine = (k) => (J.overlay?.[k] ?? []).filter((x) => x.area === AREA || x.areas?.includes(AREA));
// the override's pin, and the original it was written against (the README's fenced block; and, unless
// the checkout is shallow, the item at the commit that last changed the area)
const { hash, findDecl } = await import(pathToFileURL(path.join(root, 'test', 'split', 'lib', 'overlay.mjs')).href);
const AREA_DIR = path.join(root, 'test', 'split', 'overlay', AREA);
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const PIN = /^\/\/ override dashboardHub sha256:([0-9a-f]{64})$/.exec(read(path.join(AREA_DIR, 'overrides', 'dashboardHub.mjs')).split('\n')[0])?.[1] ?? null;
const ORIGINAL = /^## The original\n[\s\S]*?\n```js\n([\s\S]*?)\n```$/m.exec(read(path.join(AREA_DIR, 'README.md')))?.[1] ?? null;
const shallow = run('git', ['-C', root, 'rev-parse', '--is-shallow-repository']).stdout.trim() !== 'false';
const LAST = shallow ? '' : run('git', ['-C', root, 'log', '-1', '--format=%H', '--', 'test/split/overlay/package-hub']).stdout.trim();
const AT_LAST = LAST ? findDecl(run('git', ['-C', root, 'show', `${LAST}:docs/devteam/scripts/devteam.mjs`]).stdout, 'dashboardHub')?.text ?? null : null;
const recorded = ORIGINAL !== null && hash(ORIGINAL) === PIN && (!LAST || AT_LAST === ORIGINAL);
const changed = mine('stale').find((s) => s.kind === 'override' && /^the original changed/.test(s.why) && recorded);
const DRIFTED = made.status === 1 && errs.length && errs.every((l) => DRIFT.some((re) => re.test(l))) ? `HEAD's split stopped on manifest drift: ${errs.slice(0, 3).join('; ')}`
  : changed ? `${changed.name} changed at HEAD (${changed.why}): remake the override against it (the area's README says how)` : false;
const SKIP = DRIFTED || (process.platform !== 'linux' ? 'reads /proc: Linux only' : made.status !== 0 ? 'no tree was written: H1 says why' : false);

test('H1: the whole overlay applies package-hub\'s override of dashboardHub, hash-pinned, with nothing of the area stale or in conflict', { skip: DRIFTED }, () => {
  assert.equal(made.status, 0, made.stderr);
  assert.deepEqual(mine('stale'), [], 'nothing of the area is stale');
  assert.deepEqual(mine('conflicts'), [], 'no conflict names the area');
  const applied = mine('applied').map((a) => `${a.kind} ${a.name}`);
  assert.deepEqual(applied, ['override dashboardHub'], 'the area applies its override, and only it');
  assert.equal(PIN, ORIGINAL === null ? 'the README has no original' : hash(ORIGINAL), 'line 1 pins the original the README records');
  if (LAST) assert.equal(ORIGINAL, AT_LAST, `the README's original is dashboardHub as it was at ${LAST.slice(0, 12)}, the area's last change`);
  assert.match(fs.readFileSync(path.join(KIT, 'docs/devteam/scripts/lib/dashboard/hub.mjs'), 'utf8'), /DEVTEAM_HUB_POINTER_MS/, 'the tree\'s dashboardHub is the override');
});

// ---- a project the source's init made, holding the tree ----
let pinPair = null, prune = null;
if (!SKIP && made.status === 0) {
  const SRC = path.join(tmp, 'src');
  fs.mkdirSync(SRC);
  const plain = { ...base, HOME: path.join(tmp, 'init-home'), DEVTEAM_HUB_PORT: String(await freePort()) };
  const tar = run('git', ['-C', root, 'archive', sha], { encoding: 'buffer' });
  assert.equal(run('tar', ['-x', '-f', '-', '-C', SRC], { input: tar.stdout }).status, 0, 'the source extracts');
  const git = (dir, ...a) => assert.equal(run('git', ['-C', dir, ...a], { env: plain }).status, 0, `git ${a.join(' ')}`);
  git(SRC, 'init', '-q');
  const init = run(process.execPath, ['docs/devteam/scripts/devteam.mjs', 'init'], { cwd: SRC, env: plain });
  assert.equal(init.status, 0, `the source's init makes a project: ${init.stderr}`);
  for (const f of ['.gitignore', '.gitleaks.toml', 'AGENTS.md', 'docs/devteam/project']) fs.cpSync(path.join(SRC, f), path.join(KIT, f), { recursive: true });
  for (const a of [['init', '-q'], ['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x']]) git(KIT, ...a);
  ({ packagePinPair: pinPair, packagePrune: prune } = await import(pathToFileURL(path.join(KIT, 'docs/devteam/scripts/lib/package.mjs')).href));
}

// ---- a hub tree under a scratch HOME ----
// an install as kit-install@1 has it: <version>-<12 hex>/ with the pair, verified.json and the package,
// here the tree itself (its docs/devteam but the project); opts: layout, verified, cli (the entry there)
function install(home, version, { layout = 2, verified = true, cli = true } = {}) {
  const digest = crypto.createHash('sha512').update(`${version}:${layout}`).digest();
  const integrity = `sha512-${digest.toString('base64')}`;
  const folder = `${version}-${digest.toString('hex').slice(0, 12)}`;
  const dir = path.join(home, '.devteam', 'hub', folder);
  const pkg = path.join(dir, 'node_modules', ...NAME.split('/'));
  fs.mkdirSync(pkg, { recursive: true });
  const pair = pinPair({ name: NAME, version, integrity, resolved: `https://registry.npmjs.org/${NAME}/-/devteam-${version}.tgz`, layout });
  for (const [f, t] of Object.entries(pair)) fs.writeFileSync(path.join(dir, f), t);
  fs.writeFileSync(path.join(pkg, 'package.json'), `${JSON.stringify({ name: NAME, version, devteam: { layout } })}\n`);
  fs.cpSync(path.join(KIT, 'docs', 'devteam'), path.join(pkg, 'docs', 'devteam'), { recursive: true, filter: (p) => !/[\\/]docs[\\/]devteam[\\/](project|run)([\\/]|$)/.test(p) });
  if (!cli) fs.rmSync(path.join(pkg, 'docs/devteam/scripts/cli.mjs'));
  const record = { v: 1, name: NAME, version, layout, integrity, integrity_ok: true, provenance_ok: verified, provenance: { repo: 'sanctuarycomputer/devteam', workflow: '.github/workflows/release.yml', ref: `refs/tags/v${version}`, commit: 'c'.repeat(40) }, at: '2026-11-27T00:00:00.000Z' };
  fs.writeFileSync(path.join(dir, 'verified.json'), `${JSON.stringify(record, null, 2)}\n`);
  return { folder, dir: fs.realpathSync(dir) };
}
// current switched as the install step switches it: a new symlink renamed over it
function point(home, folder) {
  const t = path.join(home, '.devteam', 'hub');
  const l = path.join(t, `.current-${crypto.randomBytes(4).toString('hex')}`);
  fs.symlinkSync(folder, l);
  fs.renameSync(l, path.join(t, 'current'));
}
let homes = 0;
const newHome = () => { const h = path.join(tmp, `home-${++homes}`); fs.mkdirSync(path.join(h, '.devteam', 'hub'), { recursive: true }); return h; };

// ---- /proc: who listens on a port, and where a process runs ----
function listener(port) {
  const hex = port.toString(16).toUpperCase().padStart(4, '0');
  const inodes = new Set();
  for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let t = '';
    try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const l of t.split('\n').slice(1)) { const c = l.trim().split(/\s+/); if (c[1]?.endsWith(`:${hex}`) && c[3] === '0A') inodes.add(c[9]); }
  }
  if (!inodes.size) return null;
  for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    let fds = [];
    try { fds = fs.readdirSync(`/proc/${pid}/fd`); } catch { continue; }
    for (const fd of fds) { let l = ''; try { l = fs.readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { continue; } const m = /^socket:\[(\d+)\]$/.exec(l); if (m && inodes.has(m[1])) return Number(pid); }
  }
  return null;
}
const cwdOf = (pid) => { try { return fs.readlinkSync(`/proc/${pid}/cwd`); } catch { return null; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
// the install a process runs from: where the cli.mjs on its command line leads now (resolved against its
// cwd, through any symlink), as a folder name under the hub tree; null for any other process
const ENTRY = '/docs/devteam/scripts/cli.mjs';
function fromOf(pid, hub) {
  let words = [];
  try { words = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0'); } catch { return null; }
  const w = words.find((x) => x.endsWith(ENTRY));
  if (!w) return null;
  let real;
  try { real = fs.realpathSync(path.resolve(cwdOf(pid) ?? '/', w)); } catch { return null; }
  const rel = path.relative(fs.realpathSync(hub), real);
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel.split(path.sep)[0];
}
// every process running from an install
const runningFrom = (hub, folder) => fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map(Number).filter((pid) => fromOf(pid, hub) === folder);

// ---- a dashboard from the tree, in a process group of its own ----
const dashes = new Set();
after(() => { for (const d of dashes) try { process.kill(-d.p.pid, 'SIGKILL'); } catch {} fs.rmSync(tmp, { recursive: true, force: true }); });
async function dashboard(home, hubPort, portBase) {
  const port = await freePort();
  const env = { ...base, HOME: home, DEVTEAM_HUB_PORT: String(hubPort), DEVTEAM_PORT_BASE: String(portBase), DEVTEAM_OWN_KIT: '1', DEVTEAM_DASHBOARD_RESTART: 'off', DEVTEAM_HUB_POINTER_MS: '200', DEVTEAM_HUB_RETRY_MS: '300', DEVTEAM_RUN: path.join(KIT, `.run-${port}`) };
  const p = spawn(process.execPath, [path.join(KIT, 'docs/devteam/scripts/cli.mjs'), 'dashboard', '--port', String(port)], { cwd: KIT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = '';
  p.stdout.on('data', (b) => { out += b; });
  p.stderr.on('data', (b) => { out += b; });
  const d = { p, port, log: () => { try { return fs.readFileSync(path.join(KIT, `.run-${port}`, "dashboard.log"), "utf8"); } catch { return ''; } }, out: () => out };
  dashes.add(d);
  d.stop = async () => { try { process.kill(-p.pid, 'SIGKILL'); } catch {} await waitFor(() => p.exitCode !== null || p.signalCode !== null, 10000); dashes.delete(d); };
  assert.ok(await waitFor(() => /dashboard on http/.test(out) || p.exitCode !== null, 60000), `the dashboard starts: ${out.slice(-600)}`);
  assert.match(out, /dashboard on http/, `the dashboard starts: ${out.slice(-600)}`);
  return d;
}
const hubList = async (hubPort) => { try { const r = await fetch(`http://127.0.0.1:${hubPort}/instances.json`, { headers: { 'sec-fetch-site': 'same-origin' }, signal: AbortSignal.timeout(3000) }); return await r.json(); } catch { return null; } };
const hubAnswers = async (hubPort) => (await hubList(hubPort))?.hub === 1;
const ports = async () => [await freePort(), await freePort()];

test('P1: with current naming no install, an unverified one, a verified layout-1 one, a layout-2 one without cli.mjs, or one whose hub ends at once, the hub runs in the dashboard\'s own process', { skip: SKIP }, async () => {
  const cases = [
    ['no current', () => null, /current names no install/],
    ['unverified', (h) => install(h, '1.2.0', { verified: false }).folder, /which is not verified/],
    ['layout 1', (h) => install(h, '1.0.0', { layout: 1 }).folder, /which is layout 1, not 2/],
    ['no cli.mjs', (h) => install(h, '1.0.0', { cli: false }).folder, /which has no node_modules\/@sanctuarycomputer\/devteam\/docs\/devteam\/scripts\/cli\.mjs/],
    ['a hub that ends at once', (h) => { const x = install(h, '1.0.0'); fs.writeFileSync(path.join(x.dir, 'node_modules', ...NAME.split('/'), 'docs/devteam/scripts/cli.mjs'), 'process.exit(3);\n'); return x.folder; }, /hub ended 3 times within 60 s of starting, last exit 3/],
  ];
  for (const [what, make, why] of cases) {
    const home = newHome();
    const f = make(home);
    if (f) point(home, f);
    const [hubPort, portBase] = await ports();
    const d = await dashboard(home, hubPort, portBase);
    const pid = await waitFor(async () => (await hubAnswers(hubPort)) && listener(hubPort));
    assert.equal(pid, d.p.pid, `${what}: the dashboard's own process serves the hub`);
    const list = await hubList(hubPort);
    assert.equal(typeof list?.kit, 'string', `${what}: the hub reports the project's kit, as today (${JSON.stringify(list.kit)})`);
    assert.match(d.log(), why, `${what}: the dashboard says why it runs the hub itself`);
    await d.stop();
  }
});

test('P2: a verified layout-2 current runs the hub from its folder; current moved to an unverified install keeps it there; moved to a newer verified one, the hub moves, and back to an older one it stays; its process\'s folder is kept by pruning while it runs, and removed once it stops', { skip: SKIP }, async () => {
  const home = newHome();
  const hub = path.join(home, '.devteam', 'hub');
  const A = install(home, '1.0.0'), B = install(home, '1.1.0'), U = install(home, '1.2.0', { verified: false });
  point(home, A.folder);
  const [hubPort, portBase] = await ports();
  const d = await dashboard(home, hubPort, portBase);
  // P2a: the hub runs from A, in a child of its own
  const a = await waitFor(async () => { const pid = (await hubAnswers(hubPort)) && listener(hubPort); return pid && pid !== d.p.pid && fromOf(pid, hub) === A.folder ? pid : null; });
  assert.ok(a, `P2a: a process of its own running ${A.folder}'s cli.mjs serves the hub (listener ${listener(hubPort)}, the dashboard ${d.p.pid}, running from ${fromOf(listener(hubPort), hub)})`);
  assert.equal(cwdOf(a), fs.realpathSync(KIT), 'P2a: it runs in the dashboard\'s project, where today\'s hub runs owner actions');
  // P2b: current names an unverified, newer install: the hub stays on A
  point(home, U.folder);
  assert.ok(await waitFor(() => /which is not verified; staying on 1\.0\.0-/.test(d.log()), 10000), `P2b: the dashboard says it stays: ${d.log().slice(-600)}`);
  await sleep(1500);
  assert.equal(listener(hubPort), a, 'P2b: A\'s process still serves the hub');
  // P2c: current names a newer verified install: the hub moves to it
  point(home, B.folder);
  const b = await waitFor(async () => { const pid = (await hubAnswers(hubPort)) && listener(hubPort); return pid && pid !== a && fromOf(pid, hub) === B.folder ? pid : null; });
  assert.ok(b, `P2c: a process running ${B.folder}'s cli.mjs serves the hub (listener ${listener(hubPort)}, running from ${fromOf(listener(hubPort), hub)})`);
  assert.ok(await waitFor(() => !alive(a), 10000), 'P2c: A\'s process has stopped');
  // P2c2: current names the older A again (verified): the hub stays on B
  point(home, A.folder);
  assert.ok(await waitFor(() => /names 1\.0\.0-\w+, not a newer @sanctuarycomputer\/devteam than 1\.1\.0-\w+; staying on it/.test(d.log()), 10000), `P2c2: the dashboard says it stays: ${d.log().slice(-600)}`);
  await sleep(1500);
  assert.equal(listener(hubPort), b, 'P2c2: B\'s process still serves the hub');
  // P2d: current moves on to the unverified U: pruning keeps U and the held B, and removes A
  point(home, U.folder);
  await sleep(1000);
  assert.equal(listener(hubPort), b, 'P2d: B\'s process still serves the hub');
  assert.deepEqual(prune(hub, [U.folder]), [A.folder], 'P2d: pruning removes A only');
  assert.ok(fs.existsSync(B.dir), 'P2d: B, held by its hub, is kept');
  // P2e: a child that dies is started again, from what current names (B, once current is back on it)
  point(home, B.folder);
  process.kill(b, 'SIGKILL');
  const b2 = await waitFor(async () => { const pid = (await hubAnswers(hubPort)) && listener(hubPort); return pid && pid !== b && fromOf(pid, hub) === B.folder ? pid : null; });
  assert.ok(b2, 'P2e: a new process from B serves the hub');
  // P2f: the dashboard's exit (SIGTERM to it alone) stops its hub; then pruning removes B
  process.kill(d.p.pid, 'SIGTERM');
  assert.ok(await waitFor(() => !alive(b2), 10000), 'P2f: B\'s hub stops with its dashboard');
  point(home, U.folder);
  assert.deepEqual(prune(hub, [U.folder]), [B.folder], 'P2f: B, no longer held, is removed');
  await d.stop();
});

test('P3: two dashboards with the same verified current run one hub between them', { skip: SKIP }, async () => {
  const home = newHome();
  const hub = path.join(home, '.devteam', 'hub');
  const A = install(home, '1.0.0');
  point(home, A.folder);
  const [hubPort, portBase] = await ports();
  const x = await dashboard(home, hubPort, portBase);
  assert.ok(await waitFor(async () => { const pid = (await hubAnswers(hubPort)) && listener(hubPort); return pid && fromOf(pid, hub) === A.folder; }), 'the first dashboard\'s hub runs from A');
  const y = await dashboard(home, hubPort, portBase);
  await sleep(3000);
  assert.equal(runningFrom(hub, A.folder).length, 1, `one process runs from A: ${runningFrom(hub, A.folder).join(', ')}`);
  assert.match(y.log(), /something answers on \d+; 1\.0\.0-\w+'s hub starts once it is free/, `the second says it waits: ${y.log().slice(-400)}`);
  await x.stop();
  await y.stop();
});

// dashboardHub alone, in a process of its own: its handle's close() (what a dashboard handing over to a
// new kit calls) on stdin's "close", the process kept alive after it
const HARNESS = `const { dashboardHub } = await import(process.argv[2]);
const h = dashboardHub((m) => process.stdout.write(m + '\\n'));
process.stdin.on('data', (b) => { if (String(b).includes('close')) { h.close(); process.stdout.write('closed\\n'); } });
process.stdin.resume();
`;
test('P4: close() stops the child hub while the dashboard lives on', { skip: SKIP }, async () => {
  const home = newHome();
  const hub = path.join(home, '.devteam', 'hub');
  const A = install(home, '1.0.0');
  point(home, A.folder);
  const [hubPort] = await ports();
  const file = path.join(tmp, 'harness.mjs');
  fs.writeFileSync(file, HARNESS);
  const h = spawn(process.execPath, [file, pathToFileURL(path.join(KIT, 'docs/devteam/scripts/lib/dashboard/hub.mjs')).href], { cwd: KIT, env: { ...base, HOME: home, DEVTEAM_HUB_PORT: String(hubPort), DEVTEAM_HUB_POINTER_MS: '200', DEVTEAM_HUB_RETRY_MS: '300' }, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  let out = '';
  h.stdout.on('data', (b) => { out += b; });
  h.stderr.on('data', (b) => { out += b; });
  dashes.add({ p: h });
  try {
    const a = await waitFor(async () => { const pid = (await hubAnswers(hubPort)) && listener(hubPort); return pid && pid !== h.pid && fromOf(pid, hub) === A.folder ? pid : null; });
    assert.ok(a, `the hub runs from A: ${out.slice(-400)}`);
    h.stdin.write('close\n');
    assert.ok(await waitFor(() => /closed/.test(out), 5000), 'close() ran');
    assert.ok(await waitFor(() => !alive(a), 5000), `close() stops A's hub while its dashboard lives (${alive(h.pid) ? 'alive' : 'gone'})`);
    assert.ok(alive(h.pid), 'the dashboard is still running');
  } finally { try { process.kill(-h.pid, 'SIGKILL'); } catch {} }
});
