// kit-install@1 and alpha-build@1 (kit-952): the pin pair's generator, the install trees, the fake
// registry and npm, the alpha build's fake, the serving cases, and the package command's skeleton. The
// contract is the comment above packagePinPair in docs/devteam/scripts/devteam.mjs; the fakes are
// test/fixtures/kit-install/, test/fixtures/alpha-build/, test/fixtures/alpha-serving.json and
// test/lib/fake-registry.mjs. Checks are numbered as in the ticket's spec (C1 to C16).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { kit, testDir, bareProject } from './lib/kit.mjs';
import { startFakeRegistry, FAILURES, FIXTURES, NAME, PUBLIC, statement } from './lib/fake-registry.mjs';

const SRC = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
const KI = FIXTURES;
const AB = path.join(testDir, 'fixtures', 'alpha-build');
const SERVING = path.join(testDir, 'fixtures', 'alpha-serving.json');
const MARKER = '// devteam-launcher: kit-package@1';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-package-contract-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const read = (f) => fs.readFileSync(f, 'utf8');
const readJson = (f) => JSON.parse(read(f));
let n = 0;
const scratch = (name) => { const d = path.join(tmp, `${++n}-${name}`); fs.mkdirSync(d, { recursive: true }); return d; };

// packagePinPair, loaded alone: from its declaration to the first line that is a bare closing brace
function pinPairFn() {
  const a = SRC.indexOf('\nfunction packagePinPair(');
  assert.ok(a >= 0, 'devteam.mjs declares function packagePinPair');
  const b = SRC.indexOf('\n}\n', a);
  return vm.runInContext(`${SRC.slice(a, b + 2)}\npackagePinPair`, vm.createContext({}));
}
// the contract's comment: the // lines directly above packagePinPair
function contractComment() {
  const lines = SRC.slice(0, SRC.indexOf('\nfunction packagePinPair(') + 1).split('\n');
  lines.pop();
  const out = [];
  while (lines.length && lines.at(-1).startsWith('//')) out.unshift(lines.pop());
  return out.join('\n');
}
// a comment's text with its line breaks joined, for wording that wraps
const prose = (c) => c.replace(/\n\/\/ */g, ' ');
const pinOf = (m, layout) => ({ name: m.name, version: m.version, integrity: m.dist.integrity, resolved: m.dist.tarball, layout });
const MANIFEST = readJson(path.join(KI, 'manifest.json'));
const sha512 = (b) => crypto.createHash('sha512').update(b).digest();
// every file under dir, relative, with its bytes; symlinks as { link }
function tree(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
      const f = path.join(d, e.name), rel = path.relative(dir, f).split(path.sep).join('/');
      if (e.isSymbolicLink()) out[rel] = { link: fs.readlinkSync(f) };
      else if (e.isDirectory()) walk(f);
      else out[rel] = fs.readFileSync(f);
    }
  };
  walk(dir);
  return out;
}
function untar(tgz) {
  const d = scratch('untar');
  fs.writeFileSync(path.join(d, 'p.tgz'), tgz);
  const r = spawnSync('tar', ['-xzf', 'p.tgz'], { cwd: d, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  return tree(path.join(d, 'package'));
}
const sameTree = (a, b, what) => {
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), `${what}: the same files`);
  for (const k of Object.keys(a)) assert.ok(Buffer.isBuffer(a[k]) ? a[k].equals(b[k]) : a[k].link === b[k]?.link, `${what}: ${k} is the same`);
};

// ---- kit-install@1: the pin pair --------------------------------------------------------------

test('C1 packagePinPair writes test/fixtures/kit-install/pin/ byte for byte from the fixture manifest', () => {
  const pair = pinPairFn()(pinOf(MANIFEST, 1));
  assert.deepEqual(Object.keys(pair).sort(), ['package-lock.json', 'package.json'], 'C1 the pair is two files');
  for (const f of ['package.json', 'package-lock.json']) assert.equal(pair[f], read(path.join(KI, 'pin', f)), `C1 ${f} is the fixture's, byte for byte`);
});

test('C2 the same bytes whatever order the keys are given in', () => {
  const fn = pinPairFn();
  const pin = pinOf(MANIFEST, 1);
  const want = fn(pin);
  const orders = (ks) => (ks.length <= 1 ? [ks] : ks.flatMap((k, i) => orders([...ks.slice(0, i), ...ks.slice(i + 1)]).map((r) => [k, ...r])));
  const all = orders(Object.keys(pin));
  assert.equal(all.length, 120, 'C2 every order of the five keys');
  for (const ks of all) assert.deepEqual(fn(Object.fromEntries(ks.map((k) => [k, pin[k]]))), want, `C2 order ${ks.join(',')}`);
});

test('C3 the lockfile is version 3 with the root and the package only; package.json carries devteam.layout', () => {
  const fn = pinPairFn();
  for (const layout of [1, 2]) {
    const pair = fn(pinOf(MANIFEST, layout));
    const pj = JSON.parse(pair['package.json']), lock = JSON.parse(pair['package-lock.json']);
    assert.deepEqual(pj, { name: 'devteam-instance', private: true, dependencies: { [NAME]: MANIFEST.version }, devteam: { layout } }, `C3 package.json for layout ${layout}`);
    assert.equal(lock.lockfileVersion, 3, 'C3 lockfileVersion 3');
    assert.deepEqual(Object.keys(lock.packages), ['', `node_modules/${NAME}`], 'C3 exactly two entries under packages');
    assert.deepEqual(lock.packages[''], { name: 'devteam-instance', dependencies: pj.dependencies }, 'C3 the root entry: the name and the same dependencies');
    const e = lock.packages[`node_modules/${NAME}`];
    assert.deepEqual(Object.keys(e), ['version', 'resolved', 'integrity'], 'C3 the package entry: version, resolved, integrity, and no dependencies');
    assert.equal(e.version, MANIFEST.version, 'C3 its version');
    assert.ok(e.resolved.startsWith(PUBLIC), 'C3 resolved on the public registry');
    assert.equal(e.integrity, MANIFEST.dist.integrity, 'C3 its integrity');
    assert.ok(pair['package.json'].endsWith('}\n') && pair['package-lock.json'].endsWith('}\n'), 'C3 a final newline');
  }
});

const npmHere = spawnSync('npm', ['--version'], { encoding: 'utf8', timeout: 30000 }).status === 0;
test('C4 real npm ci --ignore-scripts --dry-run accepts the pair offline', { skip: npmHere || process.env.CI ? false : 'no npm on PATH here (CI has one, and there this check runs)' }, () => {
  assert.ok(npmHere, 'C4 npm is on PATH in CI');
  const d = scratch('npm-ci');
  for (const f of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(KI, 'pin', f), path.join(d, f));
  const u = path.join(tmp, `${n}-user-npmrc`), g = path.join(tmp, `${n}-global-npmrc`);
  fs.writeFileSync(u, ''); fs.writeFileSync(g, '');
  const env = { PATH: process.env.PATH, HOME: d, npm_config_userconfig: u, npm_config_globalconfig: g, npm_config_cache: path.join(d, '.cache') };
  const r = spawnSync('npm', ['ci', '--ignore-scripts', '--dry-run', '--offline', `--registry=${PUBLIC}`], { cwd: d, env, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, `C4 npm ci accepts the pair: ${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /added 1 package/, 'C4 one package');
});

test('C5 packagePinPair refuses bad input, guards in order, quoting nothing it was given', () => {
  const fn = pinPairFn();
  const pin = pinOf(MANIFEST, 1);
  const refused = (input, starts, what) => {
    assert.throws(() => fn(input), (e) => { assert.ok(e.message.startsWith(`packagePinPair: ${starts}`), `C5 ${what}: ${e.message}`); return true; }, `C5 ${what}`);
  };
  for (const bad of [null, undefined, 'x', 1, []]) refused(bad, 'takes', `${JSON.stringify(bad) ?? 'undefined'} whole`);
  refused({ ...pin, extra: 1 }, 'takes only', 'an unknown key');
  refused({ ...pin, extra: 1, name: 1 }, 'takes only', 'an unknown key before a bad name');
  for (const k of ['name', 'version', 'integrity', 'resolved', 'layout']) {
    const { [k]: _, ...rest } = pin;
    refused(rest, k, `${k} missing`);
    refused({ ...pin, [k]: null }, k, `${k} null`);
  }
  refused({ ...pin, name: `@a/${'b'.repeat(212)}` }, 'name', 'a name over 214 characters');
  refused({ ...pin, name: 'Upper/Case' }, 'name', 'not a package name');
  // each guard before the next: an input bad in both is refused by the earlier
  const bad = { name: 'Not A Name', version: 'v1.0.0', integrity: 'sha1-x', resolved: 'http://x/', layout: 3 };
  const order = ['name', 'version', 'integrity', 'resolved', 'layout'];
  for (let i = 0; i + 1 < order.length; i++) refused({ ...pin, [order[i]]: bad[order[i]], [order[i + 1]]: bad[order[i + 1]] }, order[i], `${order[i]} before ${order[i + 1]}`);
  for (const v of ['v0.101.0', '0.101', '0.101.0-rc.1', '01.0.0', '1234567890.0.0']) refused({ ...pin, version: v }, 'version', `version ${v}`);
  for (const i of ['sha1-abc', `sha512-${'A'.repeat(86)}`, `${MANIFEST.dist.integrity}x`]) refused({ ...pin, integrity: i }, 'integrity', 'integrity not one sha512');
  for (const r of ['http://registry.npmjs.org/@sanctuarycomputer/devteam/-/devteam-0.101.0.tgz', 'https://registry.example/@sanctuarycomputer/devteam/-/devteam-0.101.0.tgz', `${PUBLIC}@sanctuarycomputer/devteam/-/devteam-0.100.0.tgz`])
    refused({ ...pin, resolved: r }, 'resolved', `resolved ${r}`);
  for (const l of [0, 3, '1', 1.5]) refused({ ...pin, layout: l }, 'layout', `layout ${JSON.stringify(l)}`);
  try { fn({ ...pin, version: 'SECRET-WORD' }); } catch (e) { assert.ok(!e.message.includes('SECRET-WORD'), 'C5 a refusal never quotes what it refused'); }
  assert.equal(fn({ ...pin, name: 'devteam', resolved: `${PUBLIC}devteam/-/devteam-0.101.0.tgz` })['package.json'].includes('"devteam": "0.101.0"'), true, 'C5 an unscoped name');
});

// ---- kit-install@1: the trees -----------------------------------------------------------------

const TARBALLS = Object.fromEntries(fs.readdirSync(path.join(KI, 'registry')).filter((f) => f.endsWith('.tgz')).map((f) => [/^devteam-(.+)\.tgz$/.exec(f)[1], fs.readFileSync(path.join(KI, 'registry', f))]));
const folderOf = (version) => `${version}-${sha512(TARBALLS[version]).toString('hex').slice(0, 12)}`;
// One install folder, checked against the contract: its pair is packagePinPair's for its version and
// layout, node_modules/<name> is the tarball's content, and verified.json is as kit-install@1 says.
function checkFolder(dir, { version, layout, verified }) {
  const fn = pinPairFn();
  const name = path.basename(dir);
  assert.equal(name, folderOf(version), `C6 ${name}: <version>-<first 12 hex of the integrity's sha512>`);
  const integrity = `sha512-${sha512(TARBALLS[version]).toString('base64')}`;
  const pair = fn({ name: NAME, version, integrity, resolved: `${PUBLIC}${NAME}/-/devteam-${version}.tgz`, layout });
  for (const f of ['package.json', 'package-lock.json']) assert.equal(read(path.join(dir, f)), pair[f], `C6 ${name}/${f} is packagePinPair's`);
  const script = read(path.join(dir, 'node_modules', NAME, 'docs', 'devteam', 'scripts', 'devteam.mjs')).split('\n');
  const pkg = readJson(path.join(dir, 'node_modules', NAME, 'package.json'));
  assert.deepEqual(pkg.devteam, { layout }, `C6 ${name}: the package's package.json says its layout`);
  assert.equal(Boolean(pkg.bin) && fs.existsSync(path.join(dir, 'node_modules', NAME, 'docs', 'devteam', 'scripts', 'cli.mjs')), layout === 2, `C6 ${name}: bin and cli.mjs exactly from layout 2`);
  if (layout === 2) assert.equal(script[1], MARKER, `C7 ${name}: a layout-2 launcher's second line is the marker`);
  else assert.ok(!script.includes(MARKER), `C7 ${name}: a layout-1 package has no marker`);
  sameTree(tree(path.join(dir, 'node_modules', NAME)), untar(TARBALLS[version]), `C6 ${name}'s package`);
  const top = fs.readdirSync(dir).sort();
  assert.deepEqual(top, ['node_modules', 'package-lock.json', 'package.json', ...(verified === 'none' ? [] : ['verified.json'])].sort(), `C6 ${name} holds the pair, node_modules and ${verified === 'none' ? 'no verified.json' : 'verified.json'}`);
  if (verified === 'none') return null;
  const v = readJson(path.join(dir, 'verified.json'));
  assert.deepEqual(Object.keys(v), ['v', 'name', 'version', 'layout', 'integrity', 'integrity_ok', 'provenance_ok', 'provenance', 'at'], `C6 ${name}/verified.json's fields, in order`);
  assert.deepEqual(Object.keys(v.provenance), ['repo', 'workflow', 'ref', 'commit'], `C6 ${name}: provenance's fields, in order`);
  assert.deepEqual({ v: v.v, name: v.name, version: v.version, layout: v.layout, integrity: v.integrity }, { v: 1, name: NAME, version, layout, integrity }, `C6 ${name}: what was installed`);
  assert.equal(v.integrity_ok, true, `C6 ${name}: integrity_ok`);
  assert.equal(v.provenance_ok, verified === 'yes', `C6 ${name}: provenance_ok`);
  assert.ok(/^[\w.-]+\/[\w.-]+$/.test(v.provenance.repo) && v.provenance.workflow === '.github/workflows/release.yml' && v.provenance.ref === `refs/tags/v${version}` && /^[0-9a-f]{40}$/.test(v.provenance.commit), `C6 ${name}: provenance as read`);
  assert.equal(v.provenance.repo === 'sanctuarycomputer/devteam', verified === 'yes', `C6 ${name}: the repo is upstream's exactly when provenance_ok`);
  assert.ok(!Number.isNaN(Date.parse(v.at)) && new Date(v.at).toISOString() === v.at, `C6 ${name}: at`);
  return v;
}
const isVerified = (dir) => { try { const v = readJson(path.join(dir, 'verified.json')); return v.integrity_ok === true && v.provenance_ok === true; } catch { return false; } };

test('C6 test/fixtures/kit-install/ holds each tree kit-install@1 names, and C7 the launcher marker', () => {
  const L = path.join(KI, 'kit-link');
  const want = { '0.101.0': { layout: 1, verified: 'yes' }, '1.0.0': { layout: 2, verified: 'yes' }, '0.100.0': { layout: 1, verified: 'none' }, '0.99.0': { layout: 1, verified: 'provenance-false' } };
  const folders = fs.readdirSync(L).filter((f) => f !== 'current').sort();
  assert.deepEqual(folders, Object.keys(want).map(folderOf).sort(), 'C6 kit-link: a verified layout-1, a verified layout-2, an unverified and a provenance_ok false tree');
  for (const [version, w] of Object.entries(want)) checkFolder(path.join(L, folderOf(version)), { version, ...w });
  assert.equal(isVerified(path.join(L, folderOf('0.100.0'))), false, 'C6 no verified.json: unverified');
  assert.equal(isVerified(path.join(L, folderOf('0.99.0'))), false, 'C6 provenance_ok false: unverified');
  const cur = fs.lstatSync(path.join(L, 'current'));
  assert.ok(cur.isSymbolicLink(), 'C6 kit-link/current is a symlink');
  assert.equal(fs.readlinkSync(path.join(L, 'current')), folderOf('1.0.0'), "C6 a relative symlink to one folder's name");
  const F = path.join(KI, 'kit-file');
  assert.ok(fs.lstatSync(path.join(F, 'current')).isFile(), 'C6 kit-file/current is a file');
  assert.equal(read(path.join(F, 'current')), `${folderOf('0.101.0')}\n`, "C6 one line: one folder's name");
  checkFolder(path.join(F, folderOf('0.101.0')), { version: '0.101.0', layout: 1, verified: 'yes' });
  const H = path.join(KI, 'hub');
  const hub = fs.readdirSync(H).filter((f) => f !== 'current');
  assert.ok(hub.length >= 1, 'C6 a hub tree');
  for (const f of hub) {
    const v = checkFolder(path.join(H, f), { version: f.split('-')[0], layout: 2, verified: 'yes' });
    assert.equal(v.layout, 2, 'C6 the hub holds verified layout-2 installs only');
  }
  assert.equal(fs.readlinkSync(path.join(H, 'current')), folderOf('1.0.0'), 'C6 hub/current names the hub folder');
});

// ---- kit-install@1: the fake registry and npm -------------------------------------------------

const npmEnv = (reg, extra = {}) => {
  const u = path.join(reg.dir, 'user-npmrc'), g = path.join(reg.dir, 'global-npmrc');
  fs.writeFileSync(u, ''); fs.writeFileSync(g, '');
  const base = Object.fromEntries(Object.entries(reg.env()).filter(([k]) => !/^npm_config_/i.test(k)));
  return { ...base, npm_config_userconfig: u, npm_config_globalconfig: g, ...extra };
};
const FLAGS = (reg) => [`--registry=${reg.url}`, '--ignore-scripts'];
const npm = (reg, args, { cwd = reg.dir, env = npmEnv(reg) } = {}) => spawnSync('npm', args, { cwd, env, encoding: 'utf8', timeout: 60000 });
const pinDir = (version = '0.101.0', layout = 1) => {
  const d = scratch(`pin-${version}`);
  const integrity = `sha512-${sha512(TARBALLS[version]).toString('base64')}`;
  const pair = pinPairFn()({ name: NAME, version, integrity, resolved: `${PUBLIC}${NAME}/-/devteam-${version}.tgz`, layout });
  for (const [f, t] of Object.entries(pair)) fs.writeFileSync(path.join(d, f), t);
  return d;
};
const slsa = async (reg, version = '0.101.0') => {
  const r = await fetch(`${reg.url}-/npm/v1/attestations/${NAME.replace('/', '%2f')}@${version}`);
  if (r.status !== 200) return { status: r.status };
  const b = await r.json();
  const a = b.attestations.find((x) => x.predicateType === 'https://slsa.dev/provenance/v1');
  return { status: 200, st: JSON.parse(Buffer.from(a.bundle.dsseEnvelope.payload, 'base64')) };
};
const readFacts = (st) => ({
  digest: st.subject[0].digest.sha512,
  repo: st.predicate.buildDefinition.externalParameters.workflow.repository.replace(/^https:\/\/github\.com\//, ''),
  workflow: st.predicate.buildDefinition.externalParameters.workflow.path,
  ref: st.predicate.buildDefinition.externalParameters.workflow.ref,
  commit: st.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit,
});
const hex = (integrity) => Buffer.from(integrity.replace(/^sha512-/, ''), 'base64').toString('hex');

test('C12 the fake registry serves the manifest, the tarball and the attestations; its npm is first on PATH and installs the pin', async () => {
  const reg = await startFakeRegistry();
  try {
    assert.match(reg.url, /^http:\/\/127\.0\.0\.1:\d+\/$/, 'C12 a loopback port');
    const which = spawnSync('sh', ['-c', 'command -v npm'], { env: reg.env(), encoding: 'utf8' });
    assert.equal(which.stdout.trim(), path.join(reg.bin, 'npm'), 'C12 the fake npm is first on PATH');
    assert.equal(reg.env().DEVTEAM_NPM_REGISTRY, reg.url, 'C12 env() names the registry for the kit');
    assert.equal(reg.env({ ...process.env, HOME: os.homedir() }).HOME, reg.home, "C12 env() sets a HOME of the fake's own");
    assert.ok(reg.home.startsWith(reg.dir) && fs.statSync(reg.home).isDirectory(), "C12 inside the fake's folder");
    const m = await (await fetch(`${reg.url}${NAME.replace('/', '%2f')}/0.101.0`)).json();
    assert.deepEqual(m, MANIFEST, 'C12 the manifest is the fixture manifest');
    assert.deepEqual(m.devteam, { layout: 1 }, "C12 the manifest carries the package's layout");
    const m2 = await (await fetch(`${reg.url}${NAME.replace('/', '%2f')}/1.0.0`)).json();
    assert.deepEqual([m2.devteam, m2.bin], [{ layout: 2 }, { devteam: 'docs/devteam/scripts/cli.mjs' }], "C12 1.0.0's manifest: layout 2, and bin");
    const t = Buffer.from(await (await fetch(`${reg.url}${NAME}/-/devteam-0.101.0.tgz`)).arrayBuffer());
    assert.equal(`sha512-${sha512(t).toString('base64')}`, MANIFEST.dist.integrity, "C12 the tarball is the manifest's integrity");
    const v = npm(reg, ['view', `${NAME}@0.101.0`, '--json', ...FLAGS(reg)]);
    assert.equal(v.status, 0, v.stderr);
    assert.deepEqual(JSON.parse(v.stdout), MANIFEST, 'C12 npm view answers the manifest');
    const vi = npm(reg, ['view', `${NAME}@0.101.0`, 'dist.integrity', ...FLAGS(reg)]);
    assert.equal(vi.stdout.trim(), MANIFEST.dist.integrity, 'C12 npm view <field>');
    const d = pinDir();
    const ci = npm(reg, ['ci', ...FLAGS(reg)], { cwd: d });
    assert.equal(ci.status, 0, `C12 npm ci installs the pin: ${ci.stderr}`);
    sameTree(tree(path.join(d, 'node_modules', NAME)), tree(path.join(KI, 'kit-link', folderOf('0.101.0'), 'node_modules', NAME)), "C12 npm ci gives the verified tree's package");
    const au = npm(reg, ['audit', 'signatures', ...FLAGS(reg)], { cwd: d });
    assert.equal(au.status, 0, au.stderr);
    assert.match(au.stdout, /1 package has a verified attestation/, 'C12 audit signatures verifies the attestation');
    const { st } = await slsa(reg);
    assert.deepEqual(readFacts(st), { digest: hex(MANIFEST.dist.integrity), ...readJson(path.join(KI, 'kit-link', folderOf('0.101.0'), 'verified.json')).provenance }, "C12 the statement: the integrity's digest, and the verified tree's provenance");
    const calls = reg.calls();
    assert.deepEqual(calls.map((c) => [c.argv[0], c.status]), [['view', 0], ['view', 0], ['ci', 0], ['audit', 0]], 'C12 every call is recorded, with its exit');
    assert.deepEqual(Object.keys(calls[0].npm_env).sort(), ['npm_config_globalconfig', 'npm_config_userconfig'], "C12 with the npm config it saw");
  } finally { await reg.close(); }
  const sha = 'c'.repeat(40);
  const own = await startFakeRegistry({ commits: { '0.101.0': sha } });
  try {
    assert.equal(readFacts((await slsa(own)).st).commit, sha, "C12 commits: a test's own upstream commit is the statement's");
  } finally { await own.close(); }
});

test('C13 each failure, driven once', async () => {
  assert.deepEqual(FAILURES, ['unreachable', 'integrity', 'no-attestation', 'repo', 'workflow', 'ref', 'commit', 'digest', 'old-npm', 'hostile-env', 'server-error', 'attestation-gone'], 'C13 the failures kit-install@1 names, and an outage and an advertised bundle gone');
  const reg = await startFakeRegistry();
  const seen = [];
  try {
    const d = pinDir();
    const base = await slsa(reg);
    const want = readFacts(base.st);
    for (const f of FAILURES) {
      await reg.fail(f);
      if (f === 'unreachable') {
        await assert.rejects(fetch(`${reg.url}${NAME.replace('/', '%2f')}/0.101.0`), 'C13 unreachable: nothing answers');
        const v = npm(reg, ['view', `${NAME}@0.101.0`, '--json', ...FLAGS(reg)]);
        assert.equal(v.status, 1, 'C13 unreachable: npm view fails');
        assert.match(v.stderr, /npm error code (ECONN|UND_ERR)/, 'C13 unreachable: as a dropped connection');
      } else if (f === 'integrity') {
        const v = npm(reg, ['view', `${NAME}@0.101.0`, 'dist.integrity', ...FLAGS(reg)]);
        assert.notEqual(v.stdout.trim(), MANIFEST.dist.integrity, "C13 integrity: the registry's integrity differs from the pin's");
        const ci = npm(reg, ['ci', ...FLAGS(reg)], { cwd: pinDir() });
        assert.equal(ci.status, 1, 'C13 integrity: npm ci refuses');
        assert.match(ci.stderr, /EINTEGRITY/, 'C13 integrity: EINTEGRITY');
      } else if (f === 'no-attestation') {
        assert.equal((await slsa(reg)).status, 404, 'C13 no-attestation: the bundle is a 404');
        const mf = await (await fetch(`${reg.url}${NAME.replace('/', '%2f')}/0.101.0`)).json();
        assert.equal(mf.dist.attestations, undefined, 'C13 no-attestation: and the manifest advertises none');
        const au = npm(reg, ['audit', 'signatures', ...FLAGS(reg)], { cwd: (await installed(reg)) });
        assert.equal(au.status, 0, 'C13 no-attestation: audit signatures passes on registry signatures, as real npm does for none advertised (the kit must refuse it itself)');
        assert.doesNotMatch(au.stdout, /attestation/, 'C13 no-attestation: and verifies none');
      } else if (['repo', 'workflow', 'ref', 'commit', 'digest'].includes(f)) {
        const got = readFacts((await slsa(reg)).st);
        const differs = Object.keys(want).filter((k) => got[k] !== want[k]);
        assert.deepEqual(differs, [f], `C13 ${f}: the statement differs in ${f} only`);
        const au = npm(reg, ['audit', 'signatures', ...FLAGS(reg)], { cwd: (await installed(reg)) });
        assert.equal(au.status, f === 'digest' ? 1 : 0, `C13 ${f}: audit signatures ${f === 'digest' ? 'refuses a subject that is not the package' : 'passes: the signature is valid, the claim is not'}`);
      } else if (f === 'old-npm') {
        assert.equal(npm(reg, ['--version']).stdout.trim(), '9.4.2', 'C13 old-npm: npm --version is under 9.5');
        const au = npm(reg, ['audit', 'signatures', ...FLAGS(reg)], { cwd: (await installed(reg)) });
        assert.doesNotMatch(au.stdout, /attestation/, 'C13 old-npm: audit signatures checks no attestation');
      } else if (f === 'server-error') {
        assert.equal((await fetch(`${reg.url}${NAME.replace('/', '%2f')}/0.101.0`)).status, 503, 'C13 server-error: a 503');
        assert.equal((await slsa(reg)).status, 503, 'C13 server-error: the bundle too');
        const v = npm(reg, ['view', `${NAME}@0.101.0`, '--json', ...FLAGS(reg)]);
        assert.equal(v.status, 1, 'C13 server-error: npm view fails');
        assert.match(v.stderr, /npm error code E503/, 'C13 server-error: with E503');
        const cid = npm(reg, ['ci', '--dry-run', ...FLAGS(reg)], { cwd: d });
        assert.equal(cid.status, 1, 'C13 server-error: npm ci fails');
        assert.match(cid.stderr, /npm error code E503/, 'C13 server-error: npm ci with E503, never E404 (unpublished)');
        const au = npm(reg, ['audit', 'signatures', ...FLAGS(reg)], { cwd: (await installed(reg)) });
        assert.equal(au.status, 1, 'C13 server-error: audit signatures fails');
        assert.match(au.stderr, /npm error code E503/, 'C13 server-error: audit with E503, never E404 (attestation gone)');
      } else if (f === 'attestation-gone') {
        const mf = await (await fetch(`${reg.url}${NAME.replace('/', '%2f')}/0.101.0`)).json();
        assert.ok(mf.dist.attestations, 'C13 attestation-gone: the manifest advertises attestations');
        assert.equal((await slsa(reg)).status, 404, 'C13 attestation-gone: the bundle is a 404');
        const au = npm(reg, ['audit', 'signatures', ...FLAGS(reg)], { cwd: (await installed(reg)) });
        assert.equal(au.status, 1, 'C13 attestation-gone: audit signatures fails, as real npm does');
        assert.match(au.stderr, /npm error code E404/, 'C13 attestation-gone: E404');
      } else if (f === 'hostile-env') {
        const e = reg.env();
        assert.ok(Object.keys(e).some((k) => /^npm_config_registry$/i.test(k)) && Object.keys(e).some((k) => /^NPM_CONFIG_/.test(k)), 'C13 hostile-env: env() carries npm config pointing elsewhere');
        const raw = spawnSync('npm', ['view', `${NAME}@0.101.0`, '--json', ...FLAGS(reg)], { cwd: reg.dir, env: { ...e, ...npmEnv(reg) }, encoding: 'utf8', timeout: 60000 });
        assert.equal(raw.status, 1, 'C13 hostile-env: npm refuses a call that passed the config on');
        assert.match(raw.stderr, /npm config from the environment reached npm/, 'C13 hostile-env: and says so');
        assert.equal(npm(reg, ['view', `${NAME}@0.101.0`, '--json', ...FLAGS(reg)]).status, 0, 'C13 hostile-env: the same call with the config dropped passes');
      }
      seen.push(f);
    }
    await reg.fail(null);
    assert.equal(npm(reg, ['view', `${NAME}@0.101.0`, '--json', ...FLAGS(reg)]).status, 0, 'C13 no failure again: answered');
    assert.equal(npm(reg, ['ci', ...FLAGS(reg)], { cwd: d }).status, 0, 'C13 no failure again: installed');
  } finally { await Promise.all([reg.close(), reg.close()]); }
  assert.ok(!fs.existsSync(reg.dir), 'C13 close(), even twice at once, removes the fake\'s folder');
  assert.deepEqual(seen, FAILURES, 'C13 every failure was driven');
});
// a pin installed while no failure is set, for audit signatures to read
async function installed(reg) {
  const was = JSON.parse(fs.readFileSync(path.join(reg.dir, 'state.json'), 'utf8')).fail;
  await reg.fail(null);
  const d = pinDir();
  const ci = npm(reg, ['ci', ...FLAGS(reg)], { cwd: d });
  assert.equal(ci.status, 0, ci.stderr);
  await reg.fail(was);
  return d;
}

test('C14 the fake npm refuses a call that breaks the calling rules', async () => {
  const reg = await startFakeRegistry();
  try {
    const view = ['view', `${NAME}@0.101.0`, '--json'];
    const refused = (args, opts, re, what) => {
      const r = npm(reg, args, opts);
      assert.equal(r.status, 1, `C14 ${what}: refused`);
      assert.match(r.stderr, re, `C14 ${what}: ${r.stderr}`);
    };
    refused([...view, '--ignore-scripts'], {}, /exactly one --registry=/, 'no --registry');
    refused([...view, '--registry=http://127.0.0.1:9/', '--ignore-scripts'], {}, /exactly one --registry=/, 'another registry');
    refused([...view, `--registry=${PUBLIC}`, '--ignore-scripts'], {}, /exactly one --registry=/, 'the public registry while DEVTEAM_NPM_REGISTRY names the fake');
    refused([...view, `--registry=${reg.url}`, `--registry=${reg.url}`, '--ignore-scripts'], {}, /exactly one --registry=/, 'two --registry=');
    refused([...view, `--registry=${reg.url}`], {}, /--ignore-scripts/, 'no --ignore-scripts');
    refused([...view, ...FLAGS(reg)], { env: npmEnv(reg, { npm_config_cache: '/tmp/x' }) }, /npm config from the environment reached npm: npm_config_cache/, 'any other npm_config_ variable');
    refused([...view, ...FLAGS(reg)], { env: npmEnv(reg, { NPM_CONFIG_REGISTRY: 'http://127.0.0.1:9/' }) }, /npm config from the environment reached npm: NPM_CONFIG_REGISTRY/, 'an upper-case NPM_CONFIG_ variable');
    const env = npmEnv(reg);
    refused([...view, ...FLAGS(reg)], { env: { ...env, npm_config_globalconfig: env.npm_config_userconfig } }, /double-loading config/, 'one file for both configs');
    const full = path.join(reg.dir, 'full-npmrc');
    fs.writeFileSync(full, 'registry=http://127.0.0.1:9/\n');
    refused([...view, ...FLAGS(reg)], { env: { ...env, npm_config_userconfig: full } }, /is an empty file/, 'a config file that is not empty');
    refused(['install', ...FLAGS(reg)], {}, /isn't answered/, 'a command the contract does not use');
  } finally { await reg.close(); }
});

// ---- alpha-build@1 ----------------------------------------------------------------------------
// alpha-build@1 (feature kit-package-dist, with kit-package-apps): release.yml finds each app at
// apps/<app>/package.json (dashboard, hub) and, in a job with no id-token and no secrets, runs npm ci
// --ignore-scripts and npm run build there with DEVTEAM_BASE_PATH=/next. The build leaves apps/<app>/out/:
// - a static export made with trailingSlash: true, so every route is <route>/index.html;
// - only files of the known types (KNOWN below: .html .js .css .txt .json .svg .png .ico .webp .woff2);
// - out/csp-hashes.json, { "v": 1, "pages": { "<route without the base path, with a trailing slash>":
//   ["sha256-…"] } }: the SHA-256 (base64) of the exact text of every inline script (a <script> with no
//   src) on each page. Styles are not hashed: style-src keeps 'unsafe-inline' and gains 'self'.
// The build job hands only out/ to the publish job, as an artifact; the publish job refuses any other type
// and copies it to the package's docs/devteam/alpha/<app>/. No apps/<app>/ means no alpha folder, and the
// /next/ routes serve the why-page ("no pages yet"). From R (layout 2) the build job also builds each app
// with DEVTEAM_BASE_PATH empty into the package's docs/devteam/apps/<app>/, which kit-package-apps' serving
// patch serves at the root. A /next/ server ignores the query for the lookup and passes every case of
// test/fixtures/alpha-serving.json on a copy of an app's out/ (its outside file and symlinks made as the
// table says): a path that leaves the folder, decodes to . or .., a separator or a NUL, names an unknown
// type, or is over 2048 bytes is a 404, and a folder without its slash a 301 to it. The dashboard, the
// laptop hub and the gateway each run the whole table, and the gateway keeps its own copy of the serving
// function; each server's own test also asserts its exact /next/ policy string. The fake:
// test/fixtures/alpha-build/<app>/out/.

const KNOWN = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', txt: 'text/plain; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon', webp: 'image/webp', woff2: 'font/woff2' };
const APPS = ['dashboard', 'hub'];
const inlineScripts = (html) => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((m) => !/\bsrc\s*=/i.test(m[1])).map((m) => m[2]);

test('C8 each app\'s out/ is a trailingSlash export with two pages, a nested route, each known type and an unknown one', () => {
  assert.deepEqual(fs.readdirSync(AB).sort(), APPS, 'C8 dashboard and hub');
  for (const app of APPS) {
    const files = Object.keys(tree(path.join(AB, app, 'out')));
    const html = files.filter((f) => f.endsWith('.html'));
    for (const f of html) assert.equal(path.posix.basename(f), 'index.html', `C8 ${app}: every page is <route>/index.html (${f})`);
    assert.equal(html.length, 2, `C8 ${app}: two pages`);
    assert.ok(html.some((f) => f.split('/').length >= 3), `C8 ${app}: a nested route`);
    for (const f of html) assert.equal(inlineScripts(read(path.join(AB, app, 'out', f))).length, 1, `C8 ${app}/${f}: one inline script`);
    const exts = new Set(files.map((f) => path.posix.extname(f).slice(1)));
    for (const e of Object.keys(KNOWN)) assert.ok(exts.has(e), `C8 ${app}: a .${e} file`);
    assert.ok(files.some((f) => !KNOWN[path.posix.extname(f).slice(1)]), `C8 ${app}: an unknown-type file`);
  }
});

test('C9 csp-hashes.json holds each page\'s inline script hashes, keyed by route without the base path', () => {
  for (const app of APPS) {
    const O = path.join(AB, app, 'out');
    const h = readJson(path.join(O, 'csp-hashes.json'));
    assert.deepEqual(Object.keys(h), ['v', 'pages'], `C9 ${app}: v and pages only (no style hashes)`);
    assert.equal(h.v, 1, `C9 ${app}: v 1`);
    const pages = {};
    for (const f of Object.keys(tree(O)).filter((x) => x.endsWith('.html'))) {
      const route = `/${path.posix.dirname(f) === '.' ? '' : `${path.posix.dirname(f)}/`}`;
      pages[route] = inlineScripts(read(path.join(O, f))).map((s) => `sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}`);
    }
    assert.deepEqual(h.pages, pages, `C9 ${app}: the hashes, recomputed`);
    for (const k of Object.keys(h.pages)) assert.ok(k.startsWith('/') && k.endsWith('/') && !k.startsWith('/next'), `C9 ${app}: ${k} has no base path and a trailing slash`);
  }
});

// A reference /next/ server's lookup (the three real servers each keep their own): the table must be
// one a careful server passes and a careless one fails.
function careful(root, raw) {
  const NF = { status: 404, type: KNOWN.txt };
  if (Buffer.byteLength(raw) > 2048) return NF;
  const p = raw.split('?')[0];
  if (p === '/next') return { status: 301, type: null, location: '/next/' };
  if (!p.startsWith('/next/')) return NF;
  const segs = p.slice('/next/'.length).split('/');
  const parts = [];
  for (const [i, s] of segs.entries()) {
    let d;
    try { d = decodeURIComponent(s); } catch { return NF; }
    if (d === '') { if (i === segs.length - 1) continue; return NF; }
    if (d === '.' || d === '..' || /[/\\\0]/.test(d)) return NF;
    parts.push(d);
  }
  const top = fs.realpathSync(root);
  let real;
  try { real = fs.realpathSync(path.join(top, ...parts)); } catch { return NF; }
  const inside = (f) => f === top || f.startsWith(top + path.sep);
  if (!inside(real)) return NF;
  if (fs.statSync(real).isDirectory()) {
    if (!p.endsWith('/')) return { status: 301, type: null, location: `${p}/` };
    try { real = fs.realpathSync(path.join(real, 'index.html')); } catch { return NF; }
    if (!inside(real) || !fs.statSync(real).isFile()) return NF;
  }
  const type = KNOWN[path.extname(real).slice(1).toLowerCase()];
  if (!type) return NF;
  return { status: 200, type, file: path.relative(top, real).split(path.sep).join('/') };
}
function careless(root, raw, { twice = false } = {}) {
  let p = raw.split('?')[0];
  if (p === '/next') return { status: 301, type: null, location: '/next/' };
  try { p = decodeURIComponent(p); if (twice) p = decodeURIComponent(p); } catch { return { status: 400, type: KNOWN.txt }; }
  let f = path.join(root, p.slice('/next/'.length));
  try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); } catch { return { status: 404, type: KNOWN.txt }; }
  try { fs.accessSync(f); } catch { return { status: 404, type: KNOWN.txt }; }
  return { status: 200, type: KNOWN[path.extname(f).slice(1)] ?? 'application/octet-stream', file: path.relative(root, f).split(path.sep).join('/') };
}
function served(app) {
  const T = readJson(SERVING);
  const d = scratch(`serve-${app}`);
  const root = path.join(d, 'out');
  fs.cpSync(path.join(AB, app, 'out'), root, { recursive: true });
  fs.writeFileSync(path.resolve(root, T.outside.at), T.outside.text);
  for (const c of T.cases) if (c.symlink) fs.symlinkSync(c.symlink.to, path.join(root, c.symlink.at));
  return { T, root };
}
const outcome = (r) => ({ status: r.status, type: r.type, ...(r.location ? { location: r.location } : {}), ...(r.status === 200 ? { file: r.file } : {}) });
const expected = (c) => ({ status: c.status, type: c.type, ...(c.location ? { location: c.location } : {}), ...(c.status === 200 ? { file: c.file } : {}) });

test('C10 alpha-serving.json lists every case alpha-build@1 names, each with a status and a content type', () => {
  const T = readJson(SERVING);
  assert.equal(T.v, 1, 'C10 v 1');
  assert.equal(T.base, '/next', 'C10 the base');
  for (const c of T.cases) {
    assert.equal(typeof c.name, 'string', 'C10 a name');
    assert.ok(typeof c.path === 'string' && c.path.startsWith('/next'), `C10 ${c.name}: a request path`);
    assert.ok(Number.isInteger(c.status), `C10 ${c.name}: a status`);
    assert.ok('type' in c && (c.type === null ? c.status === 301 : Object.values(KNOWN).includes(c.type)), `C10 ${c.name}: a content type (null only on a redirect)`);
    if (c.status === 200) for (const app of APPS) assert.ok(fs.existsSync(path.join(AB, app, 'out', c.file)), `C10 ${c.name}: ${c.file} is in ${app}'s out/`);
    if (c.status === 301) assert.ok(c.location, `C10 ${c.name}: a redirect says where`);
  }
  const has = (what, pred) => assert.ok(T.cases.some(pred), `C10 the table has ${what}`);
  has('..', (c) => /(^|\/)\.\.(\/|$)/.test(c.path) && c.status === 404);
  has('%2e%2e', (c) => /%2e%2e/i.test(c.path) && c.status === 404);
  has('a double-encoded ..', (c) => /%252e%252e/i.test(c.path) && c.status === 404);
  has('a NUL', (c) => /%00/.test(c.path) && c.status === 404);
  has('a symlink out of the folder', (c) => c.symlink && c.symlink.to.startsWith('../') && c.status === 404);
  has('an unknown extension (404)', (c) => c.status === 404 && !c.path.includes('%') && !c.symlink && fs.existsSync(path.join(AB, 'dashboard', 'out', c.path.split('?')[0].slice(6))) && !KNOWN[path.extname(c.path.split('?')[0]).slice(1)]);
  has("a route's index.html", (c) => c.status === 200 && c.path.endsWith('/') && c.path.split('/').length > 3 && c.file.endsWith('/index.html'));
  has('a ?_rsc= query', (c) => c.path.includes('?_rsc=') && c.status === 200);
  has('bare /next', (c) => c.path === '/next' && c.status === 301 && c.location === '/next/');
  has('a request path over 2048 bytes', (c) => Buffer.byteLength(c.path) > 2048 && c.status === 404);
});

test('C11 a careful server passes the whole table on both apps; a careless one fails it', () => {
  for (const app of APPS) {
    const { T, root } = served(app);
    for (const c of T.cases) assert.deepEqual(outcome(careful(root, c.path)), expected(c), `C11 ${app}: ${c.name} (${c.path})`);
    const wrong = (opts) => T.cases.filter((c) => JSON.stringify(outcome(careless(root, c.path, opts))) !== JSON.stringify(expected(c))).map((c) => c.name);
    const once = wrong({}), twice = wrong({ twice: true });
    for (const name of ['..', '%2e%2e', 'a symlink out of the folder', 'an unknown extension (the file exists)']) assert.ok(once.includes(name), `C11 ${app}: the table catches a careless server on ${name}`);
    assert.ok(twice.includes('a double-encoded ..'), `C11 ${app}: the table catches a server that decodes twice`);
  }
});

// ---- the package command ----------------------------------------------------------------------

test('C15 devteam.mjs package prints usage naming pin, install and status; each subcommand is not built yet', () => {
  const root = bareProject(scratch('cli'), 'pkg');
  const home = scratch('home');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEVTEAM_') || /^DEVTEAM_(TEST_.*|CGROUP|MEMINFO)$/.test(k)));
  Object.assign(env, { HOME: home, DEVTEAM_HUB_PORT: '4999' });
  const dt = (args) => spawnSync(process.execPath, [path.join(root, 'docs', 'devteam', 'scripts', 'devteam.mjs'), ...args], { cwd: root, env, encoding: 'utf8', timeout: 60000 });
  for (const args of [['package'], ['package', 'nope']]) {
    const r = dt(args);
    assert.equal(r.status, 1, `C15 ${args.join(' ')}: exit 1`);
    assert.match(r.stderr, /usage: package pin <tag> \| package install \[--version v\] \[--into <dir>\] \| package status \[--json\]/, `C15 ${args.join(' ')}: the usage names pin, install and status`);
  }
  for (const sub of ['pin', 'install', 'status']) {
    const r = dt(['package', sub, ...(sub === 'pin' ? ['v0.101.0'] : [])]);
    assert.equal(r.status, 1, `C15 package ${sub}: exit 1`);
    assert.match(r.stderr, new RegExp(`package ${sub}: not built yet`), `C15 package ${sub}: not built yet`);
  }
});

// ---- the contract's text ----------------------------------------------------------------------

test('C16 the comment above packagePinPair states kit-install@1, and the alpha-build comment alpha-build@1', () => {
  const c = prose(contractComment());
  for (const [what, re] of [
    ['its name', /kit-install@1/],
    ['the settings', /package_name[\s\S]*alpha[\s\S]*settingsAt\(main\)|package_name[\s\S]*alpha[\s\S]*main's committed settings/],
    ['the pair and its expected version', /docs\/devteam\/package\.json[\s\S]*package-lock\.json[\s\S]*upstream_base/],
    ['the forced registry and the scrubbed config', /--registry=[\s\S]*--ignore-scripts[\s\S]*npm_config_userconfig and npm_config_globalconfig naming two different empty files[\s\S]*no other npm_config_\* or NPM_CONFIG_\*/],
    ['the test registry, loopback only', /DEVTEAM_NPM_REGISTRY[\s\S]*exactly http:\/\/127\.0\.0\.1:<port>\/[\s\S]*any other value \(localhost, \[::1\], https, a path\)[\s\S]*exit 1 naming the variable[\s\S]*never used or passed over for the public one/],
    ['npm 9.5', /older than 9\.5[\s\S]*a finding before layout 2, a refusal from it/],
    ['npm\'s answers', /npm E404 for the version is unpublished: a finding before layout 2, a refusal from it\. EINTEGRITY is\s+a refusal/],
    ['an outage is unreachable, never a refusal', /any status but 200 and 404 \(a 5xx, a 429\)[\s\S]*E5xx\/E429, are unreachable, never a refusal\. Unreachable is a finding\s+before layout 2; from it the step stops, changes nothing[\s\S]*nothing records the version as refused\), and the next run tries again/],
    ['never committed', /merge refuses a PR that adds or changes any path\s+under it/],
    ['layout read from the manifest', /layout is the manifest's devteam\.layout[\s\S]*never guessed/],
    ['provenance: the statement and its five facts', /-\/npm\/v1\/attestations[\s\S]*https:\/\/slsa\.dev\/provenance\/v1[\s\S]*sha512[\s\S]*release\.yml[\s\S]*refs\/tags\/v[\s\S]*gitCommit[\s\S]*default branch/],
    ['the bundle\'s guards', /at most 1 MiB[\s\S]*answers 200 or\s+404 \(else unreachable, as above\)[\s\S]*not a 404 \(no attestation\)[\s\S]*exactly one entry whose predicateType[\s\S]*subject is exactly one entry/],
    ['the named limit', /fetched separately/],
    ['the install tree', /\.kit\/<version>-<first 12 hex/],
    ['current and its refusals', /relative symlink whose target is one folder's name[\s\S]*at most 64 bytes[\s\S]*real folder \(not a symlink\) directly beside current[\s\S]*never followed/],
    ['verified.json', /verified\.json[\s\S]*integrity_ok[\s\S]*provenance_ok[\s\S]*at most 4 KiB[\s\S]*writes it last[\s\S]*never writes an _ok that is false[\s\S]*name, version, layout and integrity agree with the folder's name and its pair[\s\S]*anything else[\s\S]*is unverified/],
    ['the hub tree', /newer than the hub's current[\s\S]*~\/\.devteam\/hub\/<version>-<hash>[\s\S]*keeps current and the previous folder[\s\S]*layout-1 install never touches it/],
    ['the launcher refuses a marked target', /refuses to run a target that carries it/],
    ['the marker', new RegExp(MARKER.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))],
    ['the command', /package pin <tag>[\s\S]*install[\s\S]*--into[\s\S]*status/],
    ['the fakes', /test\/fixtures\/kit-install[\s\S]*test\/lib\/fake-registry\.mjs/],
  ]) assert.match(c, re, `C16 the comment states ${what}`);
  const t = fs.readFileSync(new URL(import.meta.url), 'utf8');
  const a = prose(t.slice(t.indexOf('// alpha-build@1 ('), t.indexOf('\nconst KNOWN = ')));
  for (const [what, re] of [
    ['the build job', /no id-token and no secrets[\s\S]*DEVTEAM_BASE_PATH=\/next/],
    ['trailingSlash and the known types', /trailingSlash: true[\s\S]*only files of the known types/],
    ['csp-hashes', /csp-hashes\.json[\s\S]*no src[\s\S]*Styles are not hashed/],
    ['the hand-over', /hands only out\/[\s\S]*docs\/devteam\/alpha\/<app>\//],
    ['no app folder', /No apps\/<app>\/ means no alpha folder[\s\S]*why-page/],
    ['the root build from R', /From R \(layout 2\)[\s\S]*DEVTEAM_BASE_PATH empty[\s\S]*docs\/devteam\/apps\/<app>\//],
    ['the serving table and the copies', /alpha-serving\.json[\s\S]*keeps its own copy of the serving function/],
  ]) assert.match(a, re, `C16 alpha-build@1's comment states ${what}`);
});
