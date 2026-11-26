// kit-954: the root package.json, .github/workflows/release.yml and test/release/package-check.mjs, the
// check release.yml's publish job runs before it publishes the kit to npm. Checks are numbered as in the
// ticket's spec (R1 to R12, and R7b).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { untar, KNOWN } from './release/package-check.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = path.join(REPO, 'test', 'release', 'package-check.mjs');
const AB = path.join(REPO, 'test', 'fixtures', 'alpha-build');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-release-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const scratch = (name) => { const d = path.join(tmp, `${++n}-${name}`); fs.mkdirSync(d, { recursive: true }); return d; };
const read = (f) => fs.readFileSync(f, 'utf8');

// ---- R1: the root package.json -------------------------------------------------------------------
test('R1 package.json names @sanctuarycomputer/devteam, no dependencies, no bin, files docs/devteam/ less project/ and run/, layout 1', () => {
  const p = JSON.parse(read(path.join(REPO, 'package.json')));
  assert.equal(p.name, '@sanctuarycomputer/devteam', 'R1 the name');
  assert.deepEqual(p.dependencies, {}, 'R1 "dependencies": {}');
  for (const k of ['devDependencies', 'peerDependencies', 'optionalDependencies', 'bundleDependencies', 'bundledDependencies']) assert.equal(p[k], undefined, `R1 no ${k}`);
  assert.equal(p.bin, undefined, 'R1 no bin');
  assert.equal(p.scripts, undefined, 'R1 no scripts');
  assert.deepEqual(p.files, ['docs/devteam/', '!docs/devteam/project/', '!docs/devteam/run/'], 'R1 files: docs/devteam/ less project/ and run/');
  assert.deepEqual(p.devteam, { layout: 1 }, 'R1 "devteam": { "layout": 1 }');
  assert.equal(p.repository?.url, 'git+https://github.com/sanctuarycomputer/devteam.git', 'R1 the repository the trusted publisher and provenance name');
});

// ---- R7 to R12: package-check against fixtures ---------------------------------------------------
// A fixture repo: this checkout's package.json, README.md and docs/devteam/ (the working tree's copies of
// the tracked files), plus `apps` (an apps/<app>/package.json each) and `extra` files, committed and
// tagged v1.2.3.
function fixtureRepo(name, { apps = [], extra = {} } = {}) {
  const d = scratch(name);
  const repo = path.join(d, 'repo');
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'package.json', 'README.md', 'docs/devteam'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const f of tracked) { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.copyFileSync(path.join(REPO, f), path.join(repo, f)); }
  for (const a of apps) extra[`apps/${a}/package.json`] = '{ "name": "app", "private": true }\n';
  for (const [f, text] of Object.entries(extra)) { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), text); }
  const g = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
  g('init', '-q', '-b', 'main');
  g('add', '-A');
  g('-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  g('-c', 'tag.gpgsign=false', 'tag', 'v1.2.3');
  const home = path.join(d, 'home');
  fs.mkdirSync(home);
  return { d, repo, home };
}
// the alpha-build fixture's out/ folders as the build job stages them, without the unknown-type files
function alphaDir(d, { keepUnknown = false } = {}) {
  const a = path.join(d, 'alpha');
  for (const app of fs.readdirSync(AB)) fs.cpSync(path.join(AB, app, 'out'), path.join(a, app), { recursive: true });
  if (!keepUnknown) {
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else if (!KNOWN.includes(path.extname(e.name).slice(1))) fs.rmSync(f); } };
    walk(a);
  }
  return a;
}
const env = (home) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(npm_config_|DEVTEAM_)/i.test(k))), HOME: home });
function check(fx, args) {
  const r = spawnSync(process.execPath, [CHECK, '--tag', 'v1.2.3', '--out', path.join(fx.d, 'out'), ...args], { cwd: fx.repo, env: env(fx.home), encoding: 'utf8', timeout: 120_000 });
  return { status: r.status, out: r.stdout, err: r.stderr };
}
const treeList = (fx) => execFileSync('git', ['ls-files', '--', 'README.md', 'docs/devteam'], { cwd: fx.repo, encoding: 'utf8' }).split('\n').filter((f) => f && !path.posix.basename(f).startsWith('.'));
const alphaList = (a) => { const out = []; const walk = (dir, rel) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.isDirectory()) walk(path.join(dir, e.name), `${rel}${e.name}/`); else out.push(`docs/devteam/alpha/${rel}${e.name}`); } }; walk(a, ''); return out; };

test('R7 it refuses a package.json declaring any dependency', () => {
  const base = JSON.parse(read(path.join(REPO, 'package.json')));
  for (const [what, change] of [
    ['dependencies', { dependencies: { leftpad: '1.0.0' } }],
    ['devDependencies', { devDependencies: { leftpad: '1.0.0' } }],
    ['peerDependencies', { peerDependencies: { leftpad: '1.0.0' } }],
    ['optionalDependencies', { optionalDependencies: { leftpad: '1.0.0' } }],
    ['bundleDependencies', { bundleDependencies: ['leftpad'] }],
    ['bundledDependencies', { bundledDependencies: ['leftpad'] }],
  ]) {
    const fx = fixtureRepo(`dep-${what}`, { extra: { 'package.json': `${JSON.stringify({ ...base, ...change }, null, 2)}\n` } });
    const r = check(fx, []);
    assert.equal(r.status, 1, `R7 ${what}: refused (${r.err})`);
    assert.match(r.err, new RegExp(`^package-check: refusing: package\\.json declares ${what} `, 'm'), `R7 ${what}: names it`);
  }
});

test('R7b it refuses a package.json with no dependencies key, a bin or scripts', () => {
  const base = JSON.parse(read(path.join(REPO, 'package.json')));
  const { dependencies, ...noDeps } = base;
  for (const [what, pkg, says] of [
    ['no dependencies key', noDeps, /^package-check: refusing: package\.json has no "dependencies": \{\}$/m],
    ['a bin', { ...base, bin: { devteam: 'docs/devteam/scripts/devteam.mjs' } }, /^package-check: refusing: package\.json declares a bin$/m],
    ['scripts', { ...base, scripts: { postinstall: 'node x.js' } }, /^package-check: refusing: package\.json declares scripts$/m],
  ]) {
    const fx = fixtureRepo(`pkg-${what.replaceAll(' ', '-')}`, { extra: { 'package.json': `${JSON.stringify(pkg, null, 2)}\n` } });
    const r = check(fx, []);
    assert.equal(r.status, 1, `R7b ${what}: refused (${r.err})`);
    assert.match(r.err, says, `R7b ${what}: says so`);
  }
});

test('R8 it refuses unless every docs/devteam/ file in the tarball but alpha/ is byte-identical to the tag\'s tree', () => {
  for (const [what, change, says] of [
    ['a changed kit file', (repo) => fs.appendFileSync(path.join(repo, 'docs/devteam/process/worker.md'), 'x'), /the tarball's docs\/devteam\/process\/worker\.md differs from refs\/tags\/v1\.2\.3's tree/],
    ['a kit file the tag lacks', (repo) => fs.writeFileSync(path.join(repo, 'docs/devteam/process/extra.md'), 'x'), /the tarball holds docs\/devteam\/process\/extra\.md, which isn't in refs\/tags\/v1\.2\.3's tree/],
    ['a changed README', (repo) => fs.appendFileSync(path.join(repo, 'README.md'), 'x'), /the tarball's README\.md differs from refs\/tags\/v1\.2\.3's tree/],
  ]) {
    const fx = fixtureRepo(`bytes-${what.replaceAll(' ', '-')}`);
    change(fx.repo);
    const r = check(fx, []);
    assert.equal(r.status, 1, `R8 ${what}: refused (${r.err})`);
    assert.match(r.err, says, `R8 ${what}: names the file`);
  }
});

test('R9 it refuses an alpha folder holding a file of an unknown type, or anything but files and folders', () => {
  const fx = fixtureRepo('alpha-unknown', { apps: ['dashboard', 'hub'] });
  const r = check(fx, ['--alpha', alphaDir(fx.d, { keepUnknown: true })]);
  assert.equal(r.status, 1, `R9 refused (${r.err})`);
  assert.match(r.err, /^package-check: refusing: the alpha's dashboard\/_next\/static\/chunks\/app\.js\.map is of an unknown type/m, 'R9 names the file');
  assert.ok(!fs.existsSync(path.join(fx.d, 'out', 'package.tgz')), 'R9 nothing packed');
  const fx2 = fixtureRepo('alpha-symlink', { apps: ['dashboard', 'hub'] });
  const a2 = alphaDir(fx2.d);
  fs.symlinkSync('/etc/hostname', path.join(a2, 'hub', 'host.txt'));
  const r2 = check(fx2, ['--alpha', a2]);
  assert.equal(r2.status, 1, `R9 a symlink: refused (${r2.err})`);
  assert.match(r2.err, /the alpha's hub\/host\.txt isn't a regular file/, 'R9 a symlink: names it');
});

test('R10 with no apps it packs no alpha folder, and refuses an alpha the tree\'s apps don\'t match', () => {
  const fx = fixtureRepo('no-apps');
  const r = check(fx, ['--alpha', path.join(fx.d, 'no-such-folder')]);
  assert.equal(r.status, 0, `R10 packs (${r.err})`);
  const names = [...untar(fs.readFileSync(path.join(fx.d, 'out', 'package.tgz'))).keys()];
  assert.ok(names.length > 10, 'R10 the kit is packed');
  assert.deepEqual(names.filter((f) => f.startsWith('package/docs/devteam/alpha')), [], 'R10 no alpha folder in the tarball');
  assert.ok(!fs.existsSync(path.join(fx.repo, 'docs/devteam/alpha')), 'R10 none staged');
  const fx2 = fixtureRepo('apps-unbuilt', { apps: ['dashboard'] });
  const r2 = check(fx2, []);
  assert.equal(r2.status, 1, `R10 an app the alpha lacks: refused (${r2.err})`);
  assert.match(r2.err, /the alpha holds no app, but the tree's apps are dashboard/, 'R10 names it');
});

test('R11 npm pack --dry-run lists the expected files for test/fixtures/alpha-build, and the tarball is them with the tag\'s version', () => {
  const fx = fixtureRepo('alpha-build', { apps: ['dashboard', 'hub'] });
  const a = alphaDir(fx.d);
  const r = check(fx, ['--alpha', a]);
  assert.equal(r.status, 0, `R11 packs (${r.err})`);
  const want = ['package.json', ...treeList(fx), ...alphaList(a)].sort();
  assert.deepEqual(read(path.join(fx.d, 'out', 'files.txt')).trim().split('\n'), want, 'R11 files.txt is the expected list');
  assert.match(r.out, /^ok: @sanctuarycomputer\/devteam@1\.2\.3, \d+ files, packed by npm \d+\.\d+\.\d+$/m, 'R11 ok line');
  const dry = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: fx.repo, env: env(fx.home), encoding: 'utf8', timeout: 120_000 });
  assert.equal(dry.status, 0, `R11 npm pack --dry-run runs (${dry.stderr})`);
  assert.deepEqual(JSON.parse(dry.stdout)[0].files.map((f) => f.path).sort(), want, 'R11 npm pack --dry-run lists the expected files');
  const files = untar(fs.readFileSync(path.join(fx.d, 'out', 'package.tgz')));
  assert.deepEqual([...files.keys()].map((f) => f.slice('package/'.length)).sort(), want, 'R11 the tarball holds them');
  assert.equal(JSON.parse(files.get('package/package.json').toString('utf8')).version, '1.2.3', 'R11 the version from the tag');
  assert.ok(files.get('package/docs/devteam/alpha/hub/threads/one/index.html').equals(fs.readFileSync(path.join(AB, 'hub', 'out', 'threads', 'one', 'index.html'))), 'R11 an alpha page, byte for byte');
});

test('R12 it refuses a tag that isn\'t vX.Y.Z, an npm older than --min-npm, and a package.json the tree doesn\'t hold', () => {
  const fx = fixtureRepo('tags');
  for (const tag of ['1.2.3', 'v1.2', 'v1.2.3-rc.1', 'v01.2.3']) {
    const r = spawnSync(process.execPath, [CHECK, '--tag', tag, '--tree', 'HEAD', '--out', path.join(fx.d, `out-${tag}`)], { cwd: fx.repo, env: env(fx.home), encoding: 'utf8' });
    assert.equal(r.status, 1, `R12 ${tag}: refused`);
    assert.match(r.stderr, /isn't a release tag vX\.Y\.Z|has a leading zero/, `R12 ${tag}: says why`);
  }
  const old = spawnSync(process.execPath, [CHECK, '--tag', 'v1.2.3', '--out', path.join(fx.d, 'out-npm'), '--min-npm', '999.0.0'], { cwd: fx.repo, env: env(fx.home), encoding: 'utf8' });
  assert.equal(old.status, 1, `R12 an npm older than --min-npm: refused (${old.stderr})`);
  assert.match(old.stderr, /^package-check: refusing: npm \d+\.\d+\.\d+ is older than 999\.0\.0$/m, 'R12 says so');
  const p = JSON.parse(read(path.join(fx.repo, 'package.json')));
  fs.writeFileSync(path.join(fx.repo, 'package.json'), `${JSON.stringify({ ...p, name: '@someone/else' }, null, 2)}\n`);
  const r = check(fx, []);
  assert.equal(r.status, 1, `R12 a changed package.json: refused (${r.err})`);
  assert.match(r.err, /the packed package\.json isn't the tree's with the tag's version/, 'R12 says so');
});
