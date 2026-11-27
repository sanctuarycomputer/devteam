// kit-965 (DIST-S3, design kit-package-dist D7): the alpha end to end, on the kit's own code with nothing
// faked between the steps. release.yml's publish-job check (test/release/package-check.mjs) packs a
// tarball from a tagged fixture tree and test/fixtures/alpha-build's exports; a byte-identical copy of
// test/lib/fake-registry.mjs serves it (ruling m-20261127-202306877: the copy sits beside a registry
// folder of this file's own, so the same code serves this tarball); the real CLI pins and installs it in
// a project (package pin, package install) and into a folder as the box does (package install --version
// --into); and the project's dashboard, the laptop hub it starts and a gateway each serve /next/ from
// those installs. In Chrome each /next/ page loads with a securitypolicyviolation listener and records
// none, and its back link reaches the stable page at /. With alpha off (the project's setting alpha:
// false on main; DEVTEAM_ALPHA=0 for the gateway) all three serve the why-page.
// The fixture's pages have no back link: this file adds <a id="alpha-back" href="/"> to its own staged
// copy of each page before packing, standing in for the apps' apps/*/src/shared/back-link.tsx (ruling
// m-20261127-202305428), and checks the pages' inline-script hashes are unchanged.
// Every server runs with a scratch HOME, ports in this file's block (never 4320 or 4321; the gateway's
// are free ones, as test/gateway-alpha.test.mjs has them) and every DEVTEAM_* of the shell unset.
// Checks are numbered as in the ticket's spec (E1 to E8).
// Ports: +50 the dashboard's hub (the dashboard itself is pinned on a free port outside the block)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { PORTS, kit, testDir, bareProject, dashboardOnFreePort, until, freePort } from './lib/kit.mjs';
import { canDrive, openChrome, cleanup } from './lib/chrome.mjs';

const REPO = path.resolve(testDir, '..');
const HUB = PORTS + 50;
const VERSION = '0.102.0';
const TAG = `v${VERSION}`;
const NAME = '@sanctuarycomputer/devteam';
const NAME_PARTS = NAME.split('/');
const UPSTREAM = 'sanctuarycomputer/devteam';
const AB = path.join(testDir, 'fixtures', 'alpha-build');
const APPS = ['dashboard', 'hub'];
const PAGES = [['/next/', 'index.html', '/'], ['/next/threads/one/', path.join('threads', 'one', 'index.html'), '/threads/one/']];
const KNOWN = ['html', 'js', 'css', 'txt', 'json', 'svg', 'png', 'ico', 'webp', 'woff2'];
const BACK = '<a class="alpha-back" id="alpha-back" href="/">Back to the stable page</a>';
const WHY_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
// lib/kit.mjs has dropped the shell's DEVTEAM_* and set its own switches for every test (DEVTEAM_BOX=off,
// DEVTEAM_MEMORY_RECORD=off, DEVTEAM_CSWAP=off, DEVTEAM_SUPERVISOR_UP=off, and the runner's harness ones):
// they are kept in this process (which the gateway reads) and in the dashboard's and the installs'
// environments, so the servers run as CI's do (package-check's environment needs none and gets none)
const HARNESS = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('DEVTEAM_') && k !== 'DEVTEAM_HUB_PORT' && k !== 'DEVTEAM_PORT_BASE'));
const CONFIG_DIRS = /^(CLAUDE_CONFIG_DIR|CODEX_HOME|XDG_.*)$/;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-alpha-e2e-'));
let n = 0;
const scratch = (name) => { const d = path.join(tmp, `${++n}-${name}`); fs.mkdirSync(d, { recursive: true }); return d; };
const read = (f) => fs.readFileSync(f);
const g = (args, cwd) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
// the environment less every DEVTEAM_*, GIT_*, npm_config_* and config folder the kit reads before HOME
// (CONFIG_DIRS), with lib/kit.mjs's switches, this file's hub port and instance block
const clean = (home) => {
  const e = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEVTEAM_') && !/^GIT_/.test(k) && !/^npm_config_/i.test(k) && !CONFIG_DIRS.test(k)));
  return { ...e, ...HARNESS, HOME: home, DEVTEAM_HUB_PORT: String(HUB), DEVTEAM_PORT_BASE: String(PORTS + 1) };
};
// E8's guard: each environment a server or an install starts with has HOME under tmp and no DEVTEAM_*
// but this file's, and none of the config folders the kit reads before HOME (CONFIG_DIRS); the hub port is
// in this file's block and no port is 4320 or 4321
function guard(envs, ports) {
  for (const [what, env] of envs) {
    const extra = Object.keys(env).filter((k) => k.startsWith('DEVTEAM_') && !ALLOWED.includes(k));
    assert.deepEqual(extra, [], `E8 ${what}: no DEVTEAM_* but the ones this file sets`);
    assert.deepEqual(Object.keys(env).filter((k) => CONFIG_DIRS.test(k)), [], `E8 ${what}: no config folder the kit reads before HOME (CLAUDE_CONFIG_DIR, CODEX_HOME, XDG_*)`);
    assert.ok(String(env.HOME).startsWith(`${tmp}${path.sep}`), `E8 ${what}: HOME under the scratch folder (${env.HOME})`);
  }
  assert.ok(HUB >= PORTS && HUB < PORTS + 100, 'E8 the hub port is in the block');
  for (const p of ports) assert.ok(p !== 4320 && p !== 4321, `E8 port ${p} is not 4320 or 4321`);
}
const ALLOWED = [...Object.keys(HARNESS), 'DEVTEAM_HUB_PORT', 'DEVTEAM_PORT_BASE', 'DEVTEAM_DATA_WAIT_MS', 'DEVTEAM_NPM_REGISTRY', 'DEVTEAM_SIGSTORE_TEST_CA', 'DEVTEAM_GATEWAY_DIR', 'DEVTEAM_ALPHA_DIR', 'DEVTEAM_ALPHA'];
const sha256 = (s) => `sha256-${crypto.createHash('sha256').update(s).digest('base64')}`;
const inlineScripts = (html) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

function ask(port, p, { headers = {}, host = `127.0.0.1:${port}`, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const h = { host, ...headers, ...(cookie ? { cookie } : {}) };
    const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const body = Buffer.concat(chunks); let json = null; try { json = JSON.parse(body.toString('utf8')); } catch {} resolve({ status: res.statusCode, headers: res.headers, body, json }); });
    });
    r.on('error', reject);
    r.setTimeout(60000, () => r.destroy(new Error(`GET ${p}: no answer in 60 s`)));
    r.end();
  });
}

// ---- a software passkey for the gateway's claim (as test/gateway-alpha.test.mjs has it) ------------
function cbor(v) {
  const head = (mt, x) => (x < 24 ? Buffer.from([(mt << 5) | x]) : x < 256 ? Buffer.from([(mt << 5) | 24, x]) : Buffer.from([(mt << 5) | 25, x >> 8, x & 255]));
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error(`cbor: ${typeof v}`);
}
const u = (b) => Buffer.from(b).toString('base64url');
function passkey(opts, origin) {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
  const id = crypto.randomBytes(16);
  const cd = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: opts.challenge, origin }));
  const len = Buffer.alloc(2); len.writeUInt16BE(id.length);
  const ad = Buffer.concat([crypto.createHash('sha256').update(opts.rp.id).digest(), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, id, cbor(cose)]);
  return { rawId: u(id), clientDataJSON: u(cd), attestationObject: u(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]))) };
}

// ---- what every check shares, made once -----------------------------------------------------------
const S = {}; // { fx, staged, out, tgz, reg, project, into, dash, gw, gwOff, home, ports }
const later = [];
let G; // cloud/gateway.mjs, imported once HOME and the gateway's folder are this file's

// E1's tree: this checkout's tracked package.json, README.md and docs/devteam/, apps/<app>/package.json
// for both apps, committed and tagged TAG (as test/release-workflow.test.mjs's fixtureRepo makes it)
function fixtureTree() {
  const d = scratch('upstream');
  const repo = path.join(d, 'devteam');
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'package.json', 'README.md', 'docs/devteam'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const f of tracked) { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.copyFileSync(path.join(REPO, f), path.join(repo, f)); }
  for (const a of APPS) { fs.mkdirSync(path.join(repo, 'apps', a), { recursive: true }); fs.writeFileSync(path.join(repo, 'apps', a, 'package.json'), '{ "name": "app", "private": true }\n'); }
  g(['init', '-q', '-b', 'main'], repo);
  g(['add', '-A'], repo);
  g(['commit', '-qm', 'fixture'], repo);
  g(['tag', '-a', TAG, '-m', TAG], repo);
  return { d, repo, commit: g(['rev-parse', `${TAG}^{commit}`], repo) };
}
// the build job's staged out/ folders: the fixture's, less unknown types, each page with the back link
function stageAlpha(d) {
  const a = path.join(d, 'alpha');
  for (const app of APPS) fs.cpSync(path.join(AB, app, 'out'), path.join(a, app), { recursive: true });
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else if (!KNOWN.includes(path.extname(e.name).slice(1))) fs.rmSync(f); } };
  walk(a);
  for (const app of APPS) for (const [, file] of PAGES) {
    const f = path.join(a, app, file);
    const html = fs.readFileSync(f, 'utf8');
    assert.equal(html.split('</main>').length, 2, `${app}/${file}: one </main>`);
    fs.writeFileSync(f, html.replace('</main>', `${BACK}</main>`));
  }
  return a;
}
// a registry of this file's own: fake-registry.mjs copied byte for byte beside a fixtures/kit-install/
// registry/ holding the packed tarball and its provenance, so its FIXTURES names that folder
async function ownRegistry(tgz, commit, upstreamDir) {
  const r = scratch('registry');
  fs.mkdirSync(path.join(r, 'test', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(testDir, 'lib', 'fake-registry.mjs'), path.join(r, 'test', 'lib', 'fake-registry.mjs'));
  const reg = path.join(r, 'test', 'fixtures', 'kit-install', 'registry');
  fs.mkdirSync(reg, { recursive: true });
  fs.copyFileSync(tgz, path.join(reg, `devteam-${VERSION}.tgz`));
  fs.writeFileSync(path.join(reg, 'provenance.json'), `${JSON.stringify({ [VERSION]: { repo: UPSTREAM, workflow: '.github/workflows/release.yml', ref: `refs/tags/${TAG}`, commit } }, null, 2)}\n`);
  const copy = path.join(r, 'test', 'lib', 'fake-registry.mjs');
  const { startFakeRegistry } = await import(copy);
  // its own folder (state, npm, HOME) inside this file's scratch folder too: os.tmpdir() reads TMPDIR
  const was = process.env.TMPDIR;
  process.env.TMPDIR = r;
  let fake;
  try { fake = await startFakeRegistry({}); } finally { if (was === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = was; }
  later.push(() => fake.close());
  // the registry HOME's git reaches upstream (the tagged fixture tree) for the provenance's commit
  fs.writeFileSync(path.join(fake.home, '.gitconfig'), `[url "${upstreamDir}"]\n\tinsteadOf = https://github.com/${UPSTREAM}.git\n`);
  return { ...fake, copy, folder: reg };
}
// main's settings with alpha set, committed and pushed (the kit reads main as origin has it: mainRef)
function setAlpha(root, on) {
  const f = path.join(root, 'docs', 'devteam', 'project', 'settings.md');
  const text = fs.readFileSync(f, 'utf8');
  const m = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text);
  fs.writeFileSync(f, text.replace(m[0], () => `\`\`\`json devteam\n${JSON.stringify({ ...JSON.parse(m[1]), alpha: on }, null, 2)}\n\`\`\``));
  g(['add', 'docs/devteam/project/settings.md'], root);
  g(['commit', '-qm', `alpha ${on}`], root);
  g(['push', '-q', 'origin', 'HEAD:main'], root);
}
// a JSON route, once it says what is expected (the dashboard keeps a state 2 s), or its last answer
// asserted after 20 s
async function says(port, p, want, opts, label) {
  let last;
  for (let i = 0; i < 200; i++) {
    last = (await ask(port, p, opts)).json;
    if (JSON.stringify(last) === JSON.stringify(want)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.deepEqual(last, want, `${label}: ${p}`);
}
// a gateway, in this process, on a localhost name, claimed with a passkey: { port, box, origin, cookie }
async function gateway(name, env) {
  const port = await freePort();
  const origin = `http://box.localhost:${port}`;
  const ttydPage = path.join(tmp, `${name}-ttyd.html`);
  fs.writeFileSync(ttydPage, 'ttyd');
  const uploadsDir = path.join(tmp, `${name}-uploads`);
  fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o750 });
  const logs = [];
  const gw = G.createGateway({ publicUrl: origin, dir: path.join(process.env.DEVTEAM_GATEWAY_DIR, name), ttydPort: await freePort(), ttydPage, uploadsDir, log: (m) => logs.push(m), env });
  await new Promise((r) => gw.server.listen(port, '127.0.0.1', r));
  later.push(() => new Promise((r) => { gw.server.closeAllConnections?.(); gw.server.close(r); }));
  const token = /claim#([A-Za-z0-9_-]+)/.exec(logs.join('\n'))?.[1];
  assert.ok(token, `${name}: a claim link in its log`);
  const box = new URL(origin).host;
  let flow = ''; // the passkey ceremony's flow cookie, sent back on /auth/
  const post = (route, body) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: route, headers: { host: box, origin, 'content-type': 'application/json', ...(flow ? { cookie: flow } : {}) } }, (res) => {
      for (const c of res.headers['set-cookie'] ?? []) if (/^(?:__Host-)?devteam_flow=/.test(c)) flow = /;\s*Max-Age=0\b/i.test(c) ? '' : c.split(';')[0];
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') }));
    });
    r.on('error', reject);
    r.end(JSON.stringify(body));
  });
  const o = await post('/auth/claim/options', { token });
  assert.equal(o.status, 200, `${name}: claim options`);
  const v = await post('/auth/claim/verify', { token, ...passkey(o.json, origin) });
  assert.equal(v.status, 200, `${name}: claim verify`);
  const sc = v.headers['set-cookie']?.find((c) => c.startsWith('devteam_session='));
  assert.ok(sc, `${name}: a session cookie`);
  return { port, box, origin, cookie: sc.split(';')[0] };
}

before(async () => {
  // this process, which the gateway reads: HOME scratch, the config folders gone, lib/kit.mjs's switches kept
  for (const k of Object.keys(process.env)) if ((k.startsWith('DEVTEAM_') && !(k in HARNESS)) || CONFIG_DIRS.test(k)) delete process.env[k];
  S.home = scratch('home');
  process.env.HOME = S.home;
  process.env.DEVTEAM_HUB_PORT = String(HUB);
  process.env.DEVTEAM_PORT_BASE = String(PORTS + 1);
  process.env.DEVTEAM_GATEWAY_DIR = path.join(tmp, 'gateway');
  // E1: pack, as release.yml's publish job does (the real npm on PATH; no npm config, scratch HOME)
  S.fx = fixtureTree();
  S.staged = stageAlpha(S.fx.d);
  S.out = path.join(S.fx.d, 'pack');
  const env = Object.fromEntries(Object.entries(clean(S.home)).filter(([k]) => !k.startsWith('DEVTEAM_')));
  S.pack = spawnSync(process.execPath, [path.join(REPO, 'test', 'release', 'package-check.mjs'), '--tag', TAG, '--alpha', S.staged, '--out', S.out], { cwd: S.fx.repo, env, encoding: 'utf8', timeout: 90000, killSignal: 'SIGKILL' });
  S.tgz = path.join(S.out, 'package.tgz');
  if (S.pack.status !== 0) return;
  // E2: the registry, and a project pinned to it and installed
  S.reg = await ownRegistry(S.tgz, S.fx.commit, S.fx.repo);
  const base = scratch('project');
  const origin = path.join(base, 'origin.git');
  const root = bareProject(base, 'alpha');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  g(['remote', 'add', 'origin', origin], root);
  g(['add', '-A'], root);
  g(['commit', '-qm', 'init'], root);
  g(['push', '-q', 'origin', 'main'], root);
  const ienv = S.reg.env(clean(S.home));
  guard([['the installs', ienv]], []); // before the first install runs
  const dt = (args, cwd = root, file = path.join(root, 'docs', 'devteam', 'scripts', 'devteam.mjs')) => spawnSync(process.execPath, [file, ...args], { cwd, env: ienv, encoding: 'utf8', timeout: 90000, killSignal: 'SIGKILL' });
  S.pin = dt(['package', 'pin', TAG]);
  if (S.pin.status === 0) {
    g(['add', 'docs/devteam/package.json', 'docs/devteam/package-lock.json'], root);
    g(['commit', '-qm', `pin ${VERSION}`], root);
    g(['push', '-q', 'origin', 'HEAD:main'], root);
    S.install = dt(['package', 'install']);
  }
  S.project = root;
  // E3: --into, from a copy of the kit outside any repo (the box's case)
  const box = scratch('box');
  const opt = path.join(box, 'opt', 'kit');
  fs.cpSync(kit, opt, { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
  const cwd = path.join(box, 'cwd');
  fs.mkdirSync(cwd);
  S.into = path.join(box, 'opt', 'alpha');
  S.intoRun = dt(['package', 'install', '--version', VERSION, '--into', S.into], cwd, path.join(opt, 'scripts', 'devteam.mjs'));
  // the servers: the project's dashboard (which starts the laptop hub on HUB), and two gateways
  S.denv = { ...clean(scratch('dash-home')), DEVTEAM_DATA_WAIT_MS: '0' };
  S.envs = [['the dashboard', S.denv], ['the installs', ienv], ['this process (the gateway)', process.env]];
  guard(S.envs, [HUB]); // before the dashboard, the hub and the gateways start
  const { dash, port } = await dashboardOnFreePort(root, S.denv);
  later.push(() => dash.stop());
  S.dash = port;
  await until(async () => { try { return (await ask(HUB, '/instances.json')).status === 200; } catch { return false; } }, `the hub on ${HUB}`);
  G = await import('../cloud/gateway.mjs');
  S.gw = await gateway('on', { DEVTEAM_ALPHA_DIR: S.into });
  S.gwOff = await gateway('off', { DEVTEAM_ALPHA_DIR: S.into, DEVTEAM_ALPHA: '0' });
  S.ports = [S.dash, HUB, S.gw.port, S.gwOff.port];
}, { timeout: 240000 });
after(async () => {
  for (const f of later.reverse()) { try { await f(); } catch {} }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const pkgOf = (dir) => path.join(dir, 'node_modules', ...NAME_PARTS);
const kitCurrent = () => path.join(S.project, 'docs', 'devteam', '.kit', 'current');
const record = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'verified.json'), 'utf8'));
// the three servers: what each serves at /next/, read how, from which install's export
const servers = () => [
  { name: 'the dashboard', port: S.dash, app: 'dashboard', status: '/api/alpha', from: pkgOf(kitCurrent()) },
  { name: 'the laptop hub', port: HUB, app: 'hub', status: '/alpha.json', from: pkgOf(kitCurrent()) },
  { name: 'the gateway', port: S.gw.port, app: 'hub', status: '/alpha.json', from: pkgOf(S.into), host: S.gw.box, cookie: S.gw.cookie, origin: S.gw.origin },
];

test('E8 every server runs with a scratch HOME, no DEVTEAM_* of the shell, and ports in this file\'s block, never 4320 or 4321', () => {
  assert.ok(S.home.startsWith(tmp) && process.env.HOME === S.home, 'E8 HOME is scratch');
  assert.ok(S.envs && S.ports, 'E8 setup reached the servers (E1 packed)');
  guard(S.envs, S.ports);
});

test('E1 package-check, run as release.yml\'s publish job runs it, packs both apps\' alpha with the back link and the pages\' script hashes unchanged', () => {
  assert.equal(S.pack.status, 0, `E1 package-check exits 0 (${S.pack.stderr})`);
  assert.match(S.pack.stdout, new RegExp(`^ok: @sanctuarycomputer/devteam@${VERSION.replaceAll('.', '\\.')}, \\d+ files`, 'm'), 'E1 its ok line');
  const list = fs.readFileSync(path.join(S.out, 'files.txt'), 'utf8').split('\n');
  for (const app of APPS) for (const [, file, route] of PAGES) {
    const rel = `docs/devteam/alpha/${app}/${file.split(path.sep).join('/')}`;
    assert.ok(list.includes(rel), `E1 the tarball holds ${rel}`);
    const html = fs.readFileSync(path.join(S.staged, app, file), 'utf8');
    assert.ok(html.includes('id="alpha-back" href="/"'), `E1 ${app}${route}: the back link`);
    const hashes = JSON.parse(fs.readFileSync(path.join(S.staged, app, 'csp-hashes.json'), 'utf8')).pages[route];
    assert.deepEqual(inlineScripts(html).map(sha256), hashes, `E1 ${app}${route}: each inline script's hash is csp-hashes.json's`);
  }
});

test('E2 a byte-identical fake-registry.mjs serves the tarball; package pin and package install verify it into the project\'s .kit', () => {
  assert.ok(S.reg, 'E2 the registry started (E1 packed)');
  assert.ok(read(S.reg.copy).equals(read(path.join(testDir, 'lib', 'fake-registry.mjs'))), 'E2 the copy is test/lib/fake-registry.mjs byte for byte');
  assert.ok(S.reg.copy.startsWith(tmp) && S.reg.dir.startsWith(tmp) && S.reg.url.startsWith('http://127.0.0.1:'), 'E2 the copy and the registry\'s folder inside the scratch folder, on 127.0.0.1');
  assert.equal(S.pin.status, 0, `E2 package pin ${TAG} (${S.pin.stderr})`);
  assert.equal(S.install?.status, 0, `E2 package install (${S.install?.stderr})`);
  const rec = record(kitCurrent());
  assert.deepEqual([rec.name, rec.version, rec.integrity_ok, rec.provenance_ok, rec.provenance.repo, rec.provenance.ref, rec.provenance.commit], [NAME, VERSION, true, true, UPSTREAM, `refs/tags/${TAG}`, S.fx.commit], 'E2 verified.json: both checks passed, the provenance the fixture tag\'s');
  const tar = fs.readFileSync(path.join(S.staged, 'dashboard', 'index.html'));
  assert.ok(read(path.join(pkgOf(kitCurrent()), 'docs', 'devteam', 'alpha', 'dashboard', 'index.html')).equals(tar), 'E2 the installed dashboard page is the packed one');
  assert.ok(S.reg.requests().some((r) => r.url.includes(`devteam-${VERSION}.tgz`)), 'E2 the tarball came from this registry');
});

test('E3 package install --version --into, from a kit outside any repo, verifies it into the box\'s folder', () => {
  assert.equal(S.intoRun?.status, 0, `E3 exit 0 (${S.intoRun?.stdout}${S.intoRun?.stderr})`);
  const rec = record(S.into);
  assert.deepEqual([rec.version, rec.integrity_ok, rec.provenance_ok, rec.provenance.commit], [VERSION, true, true, S.fx.commit], 'E3 verified.json: both checks passed');
  assert.ok(read(path.join(pkgOf(S.into), 'docs', 'devteam', 'alpha', 'hub', 'index.html')).equals(read(path.join(S.staged, 'hub', 'index.html'))), 'E3 the hub export is the packed one');
});

test('E4 the dashboard, the laptop hub and a gateway each say verified and serve /next/ from their install', { timeout: 120000 }, async () => {
  for (const s of servers()) {
    await says(s.port, s.status, { on: true, verified: true, release: VERSION, why: null }, s, `E4 ${s.name}`);
    for (const [p, file] of PAGES) {
      const r = await ask(s.port, p, s);
      assert.equal(r.status, 200, `E4 ${s.name} ${p}: 200`);
      assert.ok(r.body.equals(read(path.join(s.from, 'docs', 'devteam', 'alpha', s.app, file))), `E4 ${s.name} ${p}: the installed ${s.app} page, byte for byte`);
    }
  }
});

const WATCH = "window.__cspv = []; document.addEventListener('securitypolicyviolation', (e) => window.__cspv.push(`${e.violatedDirective} ${e.blockedURI || 'inline'}`));";
async function page(chrome, keep, s, p) {
  const tab = await chrome.newPage();
  keep(() => tab.close());
  await tab.send('Page.enable');
  await tab.send('Runtime.enable');
  await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: WATCH });
  const origin = s.origin ?? `http://127.0.0.1:${s.port}`;
  if (s.cookie) {
    const [name, value] = s.cookie.split('=');
    const set = await tab.send('Network.setCookie', { name, value, url: `${origin}/`, path: '/', httpOnly: true });
    assert.equal(set.success, true, `${s.name}: the session cookie set in Chrome`);
  }
  await tab.send('Page.navigate', { url: `${origin}${p}` });
  return { tab, origin };
}
const loaded = async (tab, app, what) => {
  let ok = false;
  for (let i = 0; i < 150 && !ok; i++) { try { ok = await tab.ev(`document.readyState === 'complete' && self.__app === ${JSON.stringify(app)}`); } catch {} if (!ok) await new Promise((r) => setTimeout(r, 100)); }
  assert.ok(ok, `${what}: loaded and its app.js ran within 15 s; violations: ${JSON.stringify(await tab.ev('window.__cspv').catch(() => null))}`);
};

test('E5 in Chrome each /next/ page of the three loads, runs its script and records no policy violation', { skip: canDrive ? false : 'needs Chrome and Node 22 or later (a WebSocket)', timeout: 180000 }, async (t) => {
  const keep = cleanup(t);
  const chrome = await openChrome();
  keep(() => chrome.close());
  for (const s of servers()) for (const [p, file] of PAGES) {
    const { tab } = await page(chrome, keep, s, p);
    const what = `E5 ${s.name} ${p}`;
    await loaded(tab, s.app, what);
    const h1 = /<h1>([^<]*)<\/h1>/.exec(fs.readFileSync(path.join(s.from, 'docs', 'devteam', 'alpha', s.app, file), 'utf8'))[1];
    assert.equal(await tab.ev("document.querySelector('h1').textContent"), h1, `${what}: the fixture's page`);
    assert.deepEqual(await tab.ev('window.__cspv'), [], `${what}: no policy violation`);
  }
});

test('E6 in Chrome the back link on /next/threads/one/ reaches the stable page at /', { skip: canDrive ? false : 'needs Chrome and Node 22 or later (a WebSocket)', timeout: 180000 }, async (t) => {
  const keep = cleanup(t);
  const chrome = await openChrome();
  keep(() => chrome.close());
  for (const s of servers()) {
    const what = `E6 ${s.name}`;
    const stable = await ask(s.port, '/', s);
    assert.equal(stable.status, 200, `${what}: / answers 200`);
    // the stable page's title as served (the dashboard's script makes it "(n) devteam · <project>")
    const title = /<title>([^<]*)<\/title>/.exec(stable.body.toString('utf8'))?.[1];
    assert.ok(title, `${what}: the stable page has a title`);
    const { tab, origin } = await page(chrome, keep, s, '/next/threads/one/');
    await loaded(tab, s.app, `${what} /next/threads/one/`);
    await tab.click('#alpha-back');
    let at = null;
    for (let i = 0; i < 150; i++) { try { at = await tab.ev("location.pathname + '|' + document.readyState + '|' + document.title"); } catch {} if (at?.startsWith('/|complete|')) break; await new Promise((r) => setTimeout(r, 100)); }
    assert.equal(at?.split('|')[0], '/', `${what}: at / (${at})`);
    assert.equal(await tab.ev('location.origin'), origin, `${what}: on the same server`);
    assert.ok((await tab.ev('document.title')).includes(title), `${what}: the stable page's title holds the served one (${title})`);
    assert.equal(await tab.ev("performance.getEntriesByType('navigation')[0].responseStatus"), 200, `${what}: / answered 200`);
    assert.equal(await tab.ev("document.getElementById('alpha-back')"), null, `${what}: not an alpha page`);
    assert.equal(await tab.ev("document.documentElement.outerHTML.includes('alpha fixture')"), false, `${what}: nothing of the alpha`);
  }
});

test('E7 alpha off (the setting alpha: false on main; DEVTEAM_ALPHA=0) serves the why-page on the dashboard, the laptop hub and the gateway', { timeout: 200000 }, async () => {
  setAlpha(S.project, false);
  const off = [
    ...servers().slice(0, 2).map((s) => ({ ...s, words: /turned off/, csp: WHY_CSP })),
    { name: 'the gateway (DEVTEAM_ALPHA=0)', port: S.gwOff.port, status: '/alpha.json', host: S.gwOff.box, cookie: S.gwOff.cookie, words: /turned off on this box/, csp: G.ALPHA_WHY_CSP },
  ];
  for (const s of off) {
    await says(s.port, s.status, { on: false, verified: true, release: VERSION, why: 'off' }, s, `E7 ${s.name}`);
    for (const [p] of PAGES) {
      const r = await ask(s.port, p, s);
      const what = `E7 ${s.name} ${p}`;
      assert.equal(r.status, 200, `${what}: 200`);
      assert.equal(r.headers['content-type'], 'text/html; charset=utf-8', `${what}: html`);
      assert.equal(r.headers['content-security-policy'], s.csp, `${what}: the why-page's policy`);
      const body = r.body.toString('utf8');
      assert.match(body, s.words, `${what}: says off`);
      assert.match(body, /<a href="\/">/, `${what}: a link back to /`);
      assert.doesNotMatch(body, /alpha fixture|<script/, `${what}: nothing of the install`);
    }
  }
});
