// kit-954: the root package.json, .github/workflows/release.yml and test/release/package-check.mjs, the
// check release.yml's publish job runs before it publishes the kit to npm. Checks are numbered as in the
// ticket's spec (R1 to R15, and R7b).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
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

// ---- a YAML reader for the subset release.yml is written in ------------------------------------
// Block maps and lists, a list item that is a map, `|` block text, plain and quoted scalars, [] / {} and
// full-line comments. Anything else (anchors, aliases, folded text, flow maps with content, tabs, a
// comment after a value) throws, so the file can't drift into syntax this reads wrongly.
function yaml(text) {
  const lines = text.split('\n');
  if (lines.some((l) => /^\s*\t/.test(l))) throw new Error('yaml: a tab in the indentation');
  const indentOf = (l) => l.length - l.trimStart().length;
  const skip = (i) => { while (i < lines.length && (/^\s*$/.test(lines[i]) || /^\s*#/.test(lines[i]))) i++; return i; };
  const scalar = (s) => {
    s = s.trim();
    if (s === '{}') return {};
    if (s === '[]') return [];
    if (/^'.*'$/.test(s)) return s.slice(1, -1).replaceAll("''", "'");
    if (/^".*"$/.test(s)) return JSON.parse(s);
    if (/^\[.*\]$/.test(s)) return s.slice(1, -1).split(',').map((x) => scalar(x));
    if (/^[&*!>]|^\{| #/.test(s)) throw new Error(`yaml: unsupported scalar ${s}`);
    return s;
  };
  // the value after "key:" (rest), with the block below it when rest is empty or |
  const value = (rest, i, indent) => {
    if (rest === '|' || rest === '|-') {
      const body = [];
      let j = i + 1;
      while (j < lines.length && (/^\s*$/.test(lines[j]) || indentOf(lines[j]) > indent)) body.push(lines[j++]);
      while (body.length && /^\s*$/.test(body[body.length - 1])) body.pop();
      const cut = Math.min(...body.filter((l) => l.trim()).map(indentOf));
      return [body.map((l) => l.slice(cut)).join('\n') + (rest === '|' ? '\n' : ''), j];
    }
    if (rest !== '') return [scalar(rest), i + 1];
    const j = skip(i + 1);
    if (j >= lines.length || indentOf(lines[j]) <= indent) return [null, j];
    return block(j, indentOf(lines[j]));
  };
  const block = (i, indent) => {
    i = skip(i);
    if (lines[i].trimStart().startsWith('- ')) {
      const list = [];
      while (i < lines.length && indentOf(lines[i]) === indent && lines[i].trimStart().startsWith('- ')) {
        const item = lines[i].slice(indent + 2);
        if (/^[\w.-]+:( |$)/.test(item)) {
          lines[i] = `${' '.repeat(indent + 2)}${item}`;
          const [v, j] = block(i, indent + 2);
          list.push(v);
          i = skip(j);
        } else { list.push(scalar(item)); i = skip(i + 1); }
      }
      return [list, i];
    }
    const map = {};
    while (i < lines.length && indentOf(lines[i]) === indent && !lines[i].trimStart().startsWith('- ')) {
      const m = /^([\w.-]+):(?: (.*))?$/.exec(lines[i].trim());
      if (!m) throw new Error(`yaml: can't read line ${i + 1}: ${lines[i]}`);
      if (m[1] in map) throw new Error(`yaml: ${m[1]} twice`);
      const [v, j] = value((m[2] ?? '').trim(), i, indent);
      map[m[1]] = v;
      i = skip(j);
    }
    if (i < lines.length && indentOf(lines[i]) > indent) throw new Error(`yaml: line ${i + 1} is indented under nothing`);
    return [map, i];
  };
  const [doc, end] = block(0, 0);
  if (skip(end) < lines.length) throw new Error(`yaml: unread from line ${end + 1}`);
  return doc;
}

const WF = path.join(REPO, '.github', 'workflows', 'release.yml');
const wfText = () => read(WF);
const wf = () => yaml(wfText());
const runs = (job) => job.steps.map((s) => s.run ?? '').join('\n');
const uses = (job) => job.steps.map((s) => s.uses).filter(Boolean);

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

// ---- R2 to R6: release.yml -----------------------------------------------------------------------
test('R2 release.yml runs on release: published, only a full release in sanctuarycomputer/devteam, and on pull_request for its own paths', () => {
  const w = wf();
  assert.deepEqual(w.on.release, { types: ['published'] }, 'R2 release: published');
  assert.deepEqual(w.on.pull_request, { paths: ['.github/workflows/release.yml', 'package.json', 'apps/**', 'test/release/**'] }, 'R2 pull_request paths');
  assert.deepEqual(Object.keys(w.on).sort(), ['pull_request', 'release'], 'R2 no other trigger');
  assert.deepEqual(w.permissions, {}, 'R2 no permission by default');
  assert.equal(w.jobs.publish.if, "github.event_name == 'release' && github.repository == 'sanctuarycomputer/devteam' && !github.event.release.prerelease", 'R2 publish: a full release, here only');
  assert.equal(w.jobs.build.if, "github.event_name == 'pull_request' || (github.repository == 'sanctuarycomputer/devteam' && !github.event.release.prerelease)", 'R2 build: a PR, or a full release here');
});

test('R3 on a pull_request the publish job is skipped and check runs the same package check', () => {
  const w = wf();
  assert.deepEqual(Object.keys(w.jobs).sort(), ['build', 'check', 'publish'], 'R3 three jobs');
  assert.match(w.jobs.publish.if, /^github\.event_name == 'release' && /, 'R3 publish runs only on a release');
  assert.equal(w.jobs.check.if, "github.event_name == 'pull_request'", 'R3 check runs only on a PR');
  assert.equal(w.jobs.check.needs, 'build', 'R3 check needs build');
  assert.deepEqual(w.jobs.check.permissions, { contents: 'read' }, 'R3 check: contents: read only');
  assert.equal(w.jobs.check.environment, undefined, 'R3 check: no environment');
  assert.match(runs(w.jobs.check), /^node test\/release\/package-check\.mjs --tag v0\.0\.0 --tree HEAD --alpha "\$RUNNER_TEMP\/alpha" --out "\$RUNNER_TEMP\/pack" --min-npm 11\.5\.1$/m, 'R3 check runs package-check');
  assert.match(runs(w.jobs.check), /cat "\$RUNNER_TEMP\/pack\/files\.txt"; echo '```'; \} >> "\$GITHUB_STEP_SUMMARY"/, 'R3 the packed file list in the summary');
});

test('R4 build: contents: read only, no secrets, builds each apps/<app>/ with npm ci --ignore-scripts and npm run build at /next, uploads only out/', () => {
  const w = wf();
  const b = w.jobs.build;
  assert.deepEqual(b.permissions, { contents: 'read' }, 'R4 contents: read only');
  assert.equal(b.environment, undefined, 'R4 no environment');
  const text = JSON.stringify(b);
  assert.doesNotMatch(text, /\bsecrets\b|id-token|NODE_AUTH_TOKEN|NPM_TOKEN/, 'R4 no secret and no token');
  const r = runs(b);
  assert.match(r, /for pj in apps\/\*\/package\.json; do/, 'R4 each apps/<app>/ present');
  assert.match(r, /\(cd "apps\/\$app" && npm ci --ignore-scripts && DEVTEAM_BASE_PATH=\/next npm run build\)/, 'R4 npm ci --ignore-scripts, then npm run build at /next');
  assert.match(r, /cp -R "apps\/\$app\/out" "\$RUNNER_TEMP\/alpha\/\$app"/, 'R4 only out/ is staged');
  const up = b.steps.filter((s) => s.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(up.length, 1, 'R4 one upload');
  assert.deepEqual(up[0].with, { name: 'alpha', path: '${{ runner.temp }}/alpha/', 'if-no-files-found': 'ignore', 'retention-days': '1' }, 'R4 it uploads only the staged out/ folders');
  assert.equal(b.steps.find((s) => s.uses?.startsWith('actions/checkout@'))?.with?.['persist-credentials'], 'false', 'R4 no token left in the checkout');
});

test('R5 publish: id-token: write in npm-publish, no npm ci and no build, package-check before npm publish', () => {
  const w = wf();
  const p = w.jobs.publish;
  assert.deepEqual(p.permissions, { contents: 'read', 'id-token': 'write' }, 'R5 id-token: write');
  assert.equal(p.environment, 'npm-publish', 'R5 the npm-publish environment');
  assert.equal(p.needs, 'build', 'R5 after build');
  assert.deepEqual(Object.keys(p).sort(), ['environment', 'if', 'needs', 'permissions', 'runs-on', 'steps', 'timeout-minutes'], 'R5 nothing else in the job (no container, services or env)');
  assert.deepEqual(uses(p).map((u) => u.split('@')[0]), ['actions/checkout', 'actions/setup-node', 'actions/download-artifact'], 'R5 no other action');
  const r = runs(p);
  assert.doesNotMatch(r, /npm (ci|install|i|run|exec|rebuild)\b|npx |DEVTEAM_BASE_PATH/, 'R5 no npm ci and no build');
  const lines = r.split('\n');
  const at = (re) => lines.findIndex((l) => re.test(l));
  const checkAt = at(/^node test\/release\/package-check\.mjs --tag "\$TAG" --alpha "\$RUNNER_TEMP\/alpha" --out "\$RUNNER_TEMP\/pack" --min-npm 11\.5\.1$/);
  const pubAt = at(/^npm publish "\$RUNNER_TEMP\/pack\/package\.tgz" --access public --provenance --ignore-scripts$/);
  assert.ok(checkAt >= 0, 'R5 it runs package-check');
  assert.ok(pubAt > checkAt, 'R5 it publishes the checked tarball, after the check');
  assert.equal(p.steps.find((s) => s.name === 'Check the package')?.env?.TAG, '${{ github.event.release.tag_name }}', 'R5 the version comes from the tag');
  assert.equal(p.steps.find((s) => s.uses?.startsWith('actions/checkout@'))?.with?.['fetch-depth'], '0', 'R5 the tag is fetched');
  const dl = p.steps.find((s) => s.uses?.startsWith('actions/download-artifact@'));
  assert.deepEqual(dl.with, { pattern: 'alpha', 'merge-multiple': 'true', path: '${{ runner.temp }}/alpha' }, 'R5 it downloads only the alpha');
});

test('R6 the newest Node 24 everywhere, no cache; no npm token or secret read anywhere in the file', () => {
  const w = wf();
  for (const [name, job] of Object.entries(w.jobs)) {
    const sn = job.steps.filter((s) => s.uses?.startsWith('actions/setup-node@'));
    assert.equal(sn.length, 1, `R6 ${name}: one setup-node`);
    assert.deepEqual(sn[0].with, { 'node-version': '24', 'check-latest': 'true', 'package-manager-cache': 'false' }, `R6 ${name}: the newest Node 24, no cache, and no registry-url (which writes an .npmrc that reads a token)`);
  }
  assert.doesNotMatch(wfText().replace(/^\s*#.*$/gm, ''), /\bsecrets\b|NODE_AUTH_TOKEN|NPM_TOKEN|_authToken|registry-url/, 'R6 no token, no secret');
});

// ---- R7 to R12: package-check against fixtures ---------------------------------------------------
// A fixture repo: this checkout's package.json, README.md and docs/devteam/ (the working tree's copies of
// the tracked files), plus `apps` (an apps/<app>/package.json each) and `extra` files, committed and
// tagged v1.2.3; `before(repo)` runs just before the commit.
function fixtureRepo(name, { apps = [], extra = {}, before } = {}) {
  const d = scratch(name);
  const repo = path.join(d, 'repo');
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'package.json', 'README.md', 'docs/devteam'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const f of tracked) { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.copyFileSync(path.join(REPO, f), path.join(repo, f)); }
  for (const a of apps) extra[`apps/${a}/package.json`] = '{ "name": "app", "private": true }\n';
  for (const [f, text] of Object.entries(extra)) { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), text); }
  before?.(repo);
  const g = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
  g('init', '-q', '-b', 'main');
  g('add', '-A');
  g('-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  g('-c', 'tag.gpgsign=false', 'tag', 'v1.2.3');
  const home = path.join(d, 'home');
  fs.mkdirSync(home);
  return { d, repo, home };
}
// the alpha-build fixture's out/ folders (all, or `apps`) as the build job stages them, without the
// unknown-type files
function alphaDir(d, { keepUnknown = false, apps = fs.readdirSync(AB) } = {}) {
  const a = path.join(d, 'alpha');
  for (const app of apps) fs.cpSync(path.join(AB, app, 'out'), path.join(a, app), { recursive: true });
  if (!keepUnknown) {
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else if (!KNOWN.includes(path.extname(e.name).slice(1))) fs.rmSync(f); } };
    walk(a);
  }
  return a;
}
const env = (home) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(npm_config_|DEVTEAM_)/i.test(k))), HOME: home });
function check(fx, args, { cwd = fx.repo, extraEnv = {}, out = path.join(fx.d, 'out') } = {}) {
  const r = spawnSync(process.execPath, [CHECK, '--tag', 'v1.2.3', '--out', out, ...args], { cwd, env: { ...env(fx.home), ...extraEnv }, encoding: 'utf8', timeout: 120_000 });
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
    assert.ok(!fs.existsSync(path.join(fx.d, 'out', 'package.tgz')), `R8 ${what}: no tarball at the path the publish step reads`);
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

// ---- R13 to R15: the tarball reader, package-check's own guards, and what the tarball may carry ------
// A .tgz built by hand: entries { name, type ('0' a file), body, size (what the header says) }.
function tgz(entries) {
  const blocks = [];
  for (const e of entries) {
    const body = Buffer.from(e.body ?? '');
    const h = Buffer.alloc(512);
    h.write(e.name, 0, 100, 'utf8');
    h.write('0000644\0', 100);
    h.write(`${(e.size ?? body.length).toString(8).padStart(11, '0')}\0`, 124);
    h.write(e.type ?? '0', 156);
    h.write('ustar\0', 257);
    h.write('00', 263);
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return zlib.gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
const refusal = (fn) => { try { fn(); } catch (e) { return e.message; } return null; };
// a pax record "<len> <key>=<value>\n", its length counting itself
const paxRecord = (k, v) => { const rec = ` ${k}=${v}\n`; let n = rec.length + 1; while (`${n}${rec}`.length !== n) n = `${n}${rec}`.length; return `${n}${rec}`; };

test('R13 the tarball reader reads files and pax paths, and refuses links, duplicates, bad sizes and non-gzip', () => {
  const ok = untar(tgz([{ name: 'package/a.txt', body: 'a' }, { name: 'PaxHeader', type: 'x', body: paxRecord('path', 'package/long/b.txt') }, { name: 'package/short', body: 'b' }]));
  assert.deepEqual([...ok.keys()], ['package/a.txt', 'package/long/b.txt'], 'R13 a file, and a pax path');
  assert.equal(ok.get('package/long/b.txt').toString(), 'b', 'R13 its bytes');
  assert.match(refusal(() => untar(tgz([{ name: 'package/l', type: '2' }]))) ?? '', /the tarball holds package\/l, which isn't a regular file \(type 2\)/, 'R13 a link refuses');
  assert.match(refusal(() => untar(tgz([{ name: 'package/a', body: '1' }, { name: 'package/a', body: '2' }]))) ?? '', /the tarball holds package\/a twice/, 'R13 a duplicate refuses');
  assert.match(refusal(() => untar(tgz([{ name: 'package/a', body: 'a', size: 999999 }]))) ?? '', /the tarball is truncated or has a bad size field/, 'R13 a bad size refuses');
  assert.match(refusal(() => untar(Buffer.from('not gzip'))) ?? '', /the tarball isn't gzip/, 'R13 non-gzip refuses');
});

test('R14 package-check refuses bad usage, a bad --out or --alpha, the wrong folder, a missing tree, a staged or committed alpha, a bad app folder, a tree symlink and a package.json that isn\'t JSON', () => {
  const fx = fixtureRepo('guards', { apps: ['dashboard'] });
  const usage = spawnSync(process.execPath, [CHECK, '--out', path.join(fx.d, 'o')], { cwd: fx.repo, env: env(fx.home), encoding: 'utf8' });
  assert.equal(usage.status, 2, 'R14 no --tag: usage, exit 2');
  const full = path.join(fx.d, 'full');
  fs.mkdirSync(full);
  fs.writeFileSync(path.join(full, 'x'), 'x');
  const bad = path.join(fx.d, 'bad-alpha');
  fs.mkdirSync(path.join(bad, 'Bad_Name'), { recursive: true });
  const cases = [
    ['a non-empty --out', [], { out: full }, /--out .* isn't empty/],
    ['--out a file', [], { out: path.join(full, 'x') }, /--out .* isn't a folder/],
    ['--out inside docs/devteam', [], { out: path.join(fx.repo, 'docs', 'devteam', 'o') }, /--out is inside docs\/devteam\//],
    ['not the checkout\'s root', [], { cwd: path.join(fx.repo, 'docs') }, /run it from the checkout's root/],
    ['a missing tree', ['--tree', 'no-such-ref'], {}, /no-such-ref isn't a commit here/],
    ['--alpha a file', ['--alpha', path.join(full, 'x')], {}, /--alpha .* isn't a folder/],
    ['a bad app folder', ['--alpha', bad], {}, /the alpha's Bad_Name isn't an app's folder/],
  ];
  for (const [i, [what, args, opts, says]] of cases.entries()) {
    const r = check(fx, args, { out: path.join(fx.d, `out-${i}`), ...opts });
    assert.equal(r.status, 1, `R14 ${what}: refused (${r.err})`);
    assert.match(r.err, says, `R14 ${what}: says so`);
  }
  const staged = fixtureRepo('alpha-staged', { apps: ['dashboard'] });
  fs.mkdirSync(path.join(staged.repo, 'docs', 'devteam', 'alpha'));
  const r1 = check(staged, ['--alpha', alphaDir(staged.d, { apps: ['dashboard'] })]);
  assert.equal(r1.status, 1, `R14 an alpha already staged: refused (${r1.err})`);
  assert.match(r1.err, /docs\/devteam\/alpha\/ exists before the alpha is staged/, 'R14 an alpha already staged: says so');
  const committed = fixtureRepo('alpha-committed', { extra: { 'docs/devteam/alpha/x/index.html': 'x' } });
  const r2 = check(committed, []);
  assert.equal(r2.status, 1, `R14 an alpha in the tree: refused (${r2.err})`);
  assert.match(r2.err, /the tree already has docs\/devteam\/alpha\//, 'R14 an alpha in the tree: says so');
  const link = fixtureRepo('tree-symlink', { before: (repo) => fs.symlinkSync('worker.md', path.join(repo, 'docs', 'devteam', 'process', 'link.md')) });
  const r3 = check(link, []);
  assert.equal(r3.status, 1, `R14 a symlink in the tree: refused (${r3.err})`);
  assert.match(r3.err, /the tree's docs\/devteam\/process\/link\.md isn't a regular file \(mode 120000\)/, 'R14 a symlink in the tree: says so');
  const notJson = fixtureRepo('tree-not-json', { extra: { 'package.json': '{ not json\n' } });
  const r4 = check(notJson, []);
  assert.equal(r4.status, 1, `R14 a tree package.json that isn't JSON: refused (${r4.err})`);
  assert.match(r4.err, /^package-check: refusing: refs\/tags\/v1\.2\.3's package\.json isn't JSON$/m, 'R14 a tree package.json that isn\'t JSON: says so');
  const gone = fixtureRepo('checkout-no-package');
  fs.rmSync(path.join(gone.repo, 'package.json'));
  const r5 = check(gone, []);
  assert.equal(r5.status, 1, `R14 no package.json in the checkout: refused (${r5.err})`);
  assert.match(r5.err, /^package-check: refusing: the checkout's package\.json is missing or isn't JSON$/m, 'R14 no package.json in the checkout: says so');
  const other = fixtureRepo('apps-symlink', { apps: ['dashboard'], before: (repo) => fs.symlinkSync('package.json', path.join(repo, 'apps', 'dashboard', 'link.json')) });
  const r6 = check(other, ['--alpha', alphaDir(other.d, { apps: ['dashboard'] })]);
  assert.equal(r6.status, 0, `R14 a symlink elsewhere under apps/ doesn't block (${r6.err})`);
});

test('R15 package-check refuses a tarball carrying anything else or missing a kit file, and a dry run that differs; npm runs with no scripts and no config', () => {
  const base = JSON.parse(read(path.join(REPO, 'package.json')));
  const withTest = { ...base, files: [...base.files, 'test/'] };
  const fx1 = fixtureRepo('carries-test', { extra: { 'package.json': `${JSON.stringify(withTest, null, 2)}\n`, 'test/x.txt': 'x' } });
  const r1 = check(fx1, []);
  assert.equal(r1.status, 1, `R15 a file outside what the package carries: refused (${r1.err})`);
  assert.match(r1.err, /the tarball holds test\/x\.txt, outside what the package carries/, 'R15 says so');
  assert.ok(!fs.existsSync(path.join(fx1.d, 'out', 'package.tgz')), 'R15 no tarball at the publish path');
  const noProcess = { ...base, files: [...base.files, '!docs/devteam/process/'] };
  const fx2 = fixtureRepo('missing-kit-file', { extra: { 'package.json': `${JSON.stringify(noProcess, null, 2)}\n` } });
  const r2 = check(fx2, []);
  assert.equal(r2.status, 1, `R15 a kit file left out: refused (${r2.err})`);
  assert.match(r2.err, /the tarball is missing docs\/devteam\/process\//, 'R15 says so');
  // a fake npm first on PATH: it logs each call's arguments and npm_config_* variables, runs the real npm,
  // and with FAKE_NPM_DROP set leaves the last file out of a dry run's list
  const fx3 = fixtureRepo('fake-npm');
  const bin = path.join(fx3.d, 'bin');
  fs.mkdirSync(bin);
  const realNpm = execFileSync('sh', ['-c', 'command -v npm'], { encoding: 'utf8' }).trim();
  const log = path.join(fx3.d, 'npm-log.jsonl');
  fs.writeFileSync(path.join(bin, 'npm'), `#!${process.execPath}
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const a = process.argv.slice(2);
const cfg = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^npm_config_/i.test(k)));
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ a, cfg }) + '\\n');
const r = spawnSync(${JSON.stringify(realNpm)}, a, { encoding: 'utf8', env: process.env });
let out = r.stdout;
if (process.env.FAKE_NPM_DROP && a.includes('--dry-run')) { const j = JSON.parse(out); j[0].files.pop(); out = JSON.stringify(j); }
process.stdout.write(out); process.stderr.write(r.stderr); process.exit(r.status ?? 1);
`, { mode: 0o755 });
  const hostile = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, npm_config_registry: 'http://127.0.0.1:9/', NPM_CONFIG_IGNORE_SCRIPTS: 'false' };
  const r3 = check(fx3, [], { extraEnv: { ...hostile, FAKE_NPM_DROP: '1' } });
  assert.equal(r3.status, 1, `R15 a dry run that differs: refused (${r3.err})`);
  assert.match(r3.err, /npm pack --dry-run listed \d+ files and the tarball holds \d+: they differ/, 'R15 says so');
  const calls = read(log).trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(calls.some((c) => c.a.includes('pack')), 'R15 npm pack ran through the fake');
  for (const c of calls) {
    assert.ok(c.a.includes('--ignore-scripts'), `R15 --ignore-scripts on npm ${c.a.join(' ')}`);
    assert.deepEqual(Object.keys(c.cfg).sort(), ['npm_config_globalconfig', 'npm_config_userconfig'], `R15 no npm_config_* but the two empty files on npm ${c.a.join(' ')}`);
    assert.notEqual(c.cfg.npm_config_userconfig, c.cfg.npm_config_globalconfig, 'R15 two files');
    for (const f of Object.values(c.cfg)) assert.equal(read(f), '', `R15 ${f} is empty`);
  }
});
