// The overlay's package-release area (kit-969, cutover-tree@1, alpha-build@1): a tree generated at this
// checkout's HEAD publishes layout 2 (package.json's layout and bin, the apps built at the root) and
// deploys the box from release.yml, after the publish (box-deploy.yml as a reusable workflow only).
// Checks are numbered as in the ticket's spec (S1 to S7, S10, S11).
// Each split runs with a split dir holding the manifests and this area only, so another area's
// staleness never fails S1 to S6; S7 runs the whole overlay for the conflict check. Two kinds of drift
// skip, naming what drifted (the parity run reports both), so a regular PR is never failed here:
// manifest drift that stops HEAD's split (every test), a release file that is no longer the one its
// patch was made from, when the patch no longer applies (the tests that read that file), and a
// test/release/package-check.mjs that is no longer the text its ledger entry was written against (the
// area writes it whole, so main's change would be lost: the parity run reports the void entry). Any other
// result is judged.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { judgeTest } from './split/parity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const splitSrc = path.join(root, 'test', 'split');
const tool = path.join(splitSrc, 'split.mjs');
const AREA = 'package-release';
const AB = path.join(root, 'test', 'fixtures', 'alpha-build');
const KNOWN = ['html', 'js', 'css', 'txt', 'json', 'svg', 'png', 'ico', 'webp', 'woff2'];
const BIN = { devteam: 'docs/devteam/scripts/cli.mjs' };
// CI set: npm skips its update check (a registry fetch per call) off CI too (plan-1 F2)
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GIT_|DEVTEAM_|npm_config_)/i.test(k))), CI: 'true' };
const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', env, maxBuffer: 1 << 28, timeout: 180_000, ...o });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'split-release-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const scratch = (name) => { const d = path.join(tmp, `${++n}-${name}`); fs.mkdirSync(d, { recursive: true }); return d; };
const PATCHES = { 'package-json.patch': 'package.json', 'release-yml.patch': '.github/workflows/release.yml', 'box-deploy-yml.patch': '.github/workflows/box-deploy.yml' };
// package-check.mjs is a file under test/, so the parity run judges it as a differing test: the area
// writes it whole (files/), and the ledger entry accepts it (test/split/ledger/tests/README.md)
const CHECK = 'test/release/package-check.mjs';
const CHECK_COPY = path.join(splitSrc, 'overlay', AREA, 'files', CHECK);
const ENTRY = path.join(splitSrc, 'ledger', 'tests', 'release', 'package-check.mjs.json');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// a split dir: every manifest*.json and the named areas
function splitDir(name, areas) {
  const d = path.join(scratch(name), 'split');
  fs.mkdirSync(path.join(d, 'overlay'), { recursive: true });
  for (const m of fs.readdirSync(splitSrc).filter((f) => /^manifest.*\.json$/.test(f))) fs.copyFileSync(path.join(splitSrc, m), path.join(d, m));
  for (const a of areas) if (fs.existsSync(path.join(splitSrc, 'overlay', a))) fs.cpSync(path.join(splitSrc, 'overlay', a), path.join(d, 'overlay', a), { recursive: true });
  return d;
}
// split this checkout at sha into out, with --json; { r, j, out, read, has }
function split(dir, sha, out) {
  const r = run(process.execPath, [tool, '--repo', root, '--split-dir', dir, '--at', sha, '--out', out, '--json'], { cwd: os.tmpdir() });
  let j = {};
  try { j = JSON.parse(r.stdout); } catch { /* the assertions name it */ }
  return { r, j, out, read: (f) => fs.readFileSync(path.join(out, f), 'utf8'), has: (f) => fs.existsSync(path.join(out, f)) };
}
const mine = (j, key) => (j.overlay?.[key] ?? []).filter((x) => x.area === AREA);
const items = (list) => list.map((x) => `${x.kind} ${x.name}`);

// ---- the kit's own HEAD, with this area alone ----
const sha = run('git', ['-C', root, 'rev-parse', 'HEAD']).stdout.trim();
const show = (f) => run('git', ['-C', root, 'show', `${sha}:${f}`]).stdout;
const head = split(splitDir('area', [AREA]), sha, path.join(tmp, 'head'));
// HEAD drifted from the manifest (split-tool's H tests' kinds): the split writes nothing, and every test
// skips naming it. Any other refusal or crash runs the tests, which fail on it.
const DRIFT = [/^split: manifest[\w-]*\.json: manifest: module .+ (?:is not in the source|starts at line \d+, not after .+|must start at line 1)$/,
  /^split: manifest[\w-]*\.json: module .+ is \d+ lines, over the cap of \d+$/, /^split: manifest[\w-]*\.json: the declaration at line \d+ .* binds names the split can't read whole/,
  /^split: nothing written$/];
const splitLines = head.r.stderr.trim().split('\n').filter(Boolean);
const SPLIT_SKIP = head.r.status === 1 && splitLines.length > 0 && splitLines.every((l) => DRIFT.some((re) => re.test(l))) ? `HEAD's split stopped on manifest drift: ${splitLines.slice(0, 3).join('; ')}` : false;
// A release file drifted at HEAD: its patch is stale with "no longer applies" and HEAD's file is not the
// blob the patch was made from (the patch's full index line). A patch that fails on the very file it was
// made from is broken, not drifted, and is judged.
function driftSkip(patch) {
  if (SPLIT_SKIP) return SPLIT_SKIP;
  const p = path.join(splitSrc, 'overlay', AREA, 'patches', patch);
  const madeFrom = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').match(/^index ([0-9a-f]{40})\.\./m)?.[1] : undefined;
  const now = run('git', ['-C', root, 'rev-parse', `${sha}:${PATCHES[patch]}`]).stdout.trim();
  const s = mine(head.j, 'stale').find((x) => x.kind === 'patch' && x.name === patch);
  return s && /^no longer applies/.test(s.why) && madeFrom && madeFrom !== now ? `${PATCHES[patch]} drifted at HEAD (${now.slice(0, 8)}, the patch was made from ${madeFrom.slice(0, 8)}); the parity run reports it: ${s.why}` : false;
}
// package-check.mjs drifted at HEAD: its text is not the one the ledger entry was written against
function checkSkip() {
  if (SPLIT_SKIP) return SPLIT_SKIP;
  let entry = null;
  try { entry = JSON.parse(fs.readFileSync(ENTRY, 'utf8')); } catch { return false; }
  const now = sha256(show(CHECK));
  return typeof entry?.source_sha256 === 'string' && entry.source_sha256 !== now ? `${CHECK} changed at HEAD (sha256 ${now.slice(0, 12)}, the area's copy and its ledger entry were written against ${entry.source_sha256.slice(0, 12)}); remake the copy and the entry; the parity run reports the void entry` : false;
}
// the area's whole copy of package-check.mjs written at HEAD
function checkWritten() {
  assert.equal(head.r.status, 0, head.r.stderr);
  assert.ok(items(mine(head.j, 'applied')).includes(`file ${CHECK}`), `the area writes ${CHECK}: ${items(mine(head.j, 'applied')).join('; ')}`);
  assert.equal(head.read(CHECK), fs.readFileSync(CHECK_COPY, 'utf8'), `the tree's ${CHECK} is the area's copy`);
}
// the patch applied at HEAD
function applied(patch) {
  assert.equal(head.r.status, 0, head.r.stderr);
  const s = mine(head.j, 'stale').find((x) => x.name === patch);
  assert.equal(s, undefined, `${patch} applies: ${s?.why}`);
  assert.ok(items(mine(head.j, 'applied')).includes(`patch ${patch}`), `${patch} is applied: ${items(mine(head.j, 'applied')).join('; ')}`);
}

// ---- a YAML reader for the subset the workflows are written in (release-workflow.test.mjs's) ----
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
const REL = '.github/workflows/release.yml';
const DEP = '.github/workflows/box-deploy.yml';
const step = (job, name) => job.steps.find((s) => s.name === name);
const RELEASE_ONLY = "github.event_name == 'release' && github.repository == 'sanctuarycomputer/devteam' && !github.event.release.prerelease";

test('S1 the tree\'s package.json: layout 2, bin devteam -> docs/devteam/scripts/cli.mjs, dependencies {}, nothing else changed', { skip: driftSkip('package-json.patch') }, () => {
  applied('package-json.patch');
  const was = JSON.parse(show('package.json'));
  const p = JSON.parse(head.read('package.json'));
  assert.deepEqual(p.devteam, { layout: 2 }, 'S1 "devteam": { "layout": 2 }');
  assert.deepEqual(p.bin, BIN, 'S1 bin { "devteam": "docs/devteam/scripts/cli.mjs" }');
  assert.deepEqual(p.dependencies, {}, 'S1 dependencies still {}');
  assert.ok(head.has(BIN.devteam), 'S1 the bin is a file of the tree');
  const { devteam: _a, bin: _b, ...rest } = p;
  const { devteam: _c, bin: _d, ...restWas } = was;
  assert.deepEqual(rest, restWas, 'S1 nothing else in package.json changed');
});

test('S2 release.yml\'s build job builds each app at /next and again with DEVTEAM_BASE_PATH empty, from a fresh out/, and hands the second on as apps', { skip: driftSkip('release-yml.patch') }, () => {
  applied('release-yml.patch');
  const w = yaml(head.read(REL));
  const build = w.jobs.build;
  assert.deepEqual(build.permissions, { contents: 'read' }, 'S2 the build job still has contents: read only');
  const up = build.steps.filter((s) => s.uses === 'actions/upload-artifact@v4');
  assert.deepEqual(up.map((s) => s.with), [
    { name: 'alpha', path: '${{ runner.temp }}/alpha/', 'if-no-files-found': 'ignore', 'retention-days': '1' },
    { name: 'apps', path: '${{ runner.temp }}/apps/', 'if-no-files-found': 'ignore', 'retention-days': '1' },
  ], 'S2 the build uploads alpha and apps');
  // run the step as Actions runs it (bash -eo pipefail), in a fixture with two apps and an npm that
  // records the base path its build saw and leaves a file only the /next build makes
  const d = scratch('build');
  const work = path.join(d, 'work');
  for (const app of ['dashboard', 'hub']) { fs.mkdirSync(path.join(work, 'apps', app), { recursive: true }); fs.writeFileSync(path.join(work, 'apps', app, 'package.json'), '{ "name": "app", "private": true }\n'); }
  const bin = path.join(d, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'npm'), `#!/bin/bash
set -e
[ "$1" = ci ] && exit 0
[ "$1 $2" = "run build" ] || exit 9
mkdir -p out
printf 'base=[%s] set=%s\\n' "$DEVTEAM_BASE_PATH" "\${DEVTEAM_BASE_PATH+yes}" > out/index.html
[ "$DEVTEAM_BASE_PATH" = /next ] && echo only-next > out/next-only.txt
exit 0
`, { mode: 0o755 });
  const temp = path.join(d, 'temp');
  fs.mkdirSync(temp);
  const s = step(build, 'Build each app');
  const r = run('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', s.run], { cwd: work, env: { ...env, PATH: `${bin}${path.delimiter}${env.PATH}`, RUNNER_TEMP: temp } });
  assert.equal(r.status, 0, `S2 the build step runs: ${r.stderr}`);
  for (const app of ['dashboard', 'hub']) {
    assert.equal(fs.readFileSync(path.join(temp, 'alpha', app, 'index.html'), 'utf8'), 'base=[/next] set=yes\n', `S2 ${app}'s alpha is built at /next`);
    assert.equal(fs.readFileSync(path.join(temp, 'apps', app, 'index.html'), 'utf8'), 'base=[] set=yes\n', `S2 ${app}'s root build has DEVTEAM_BASE_PATH set and empty`);
    assert.ok(fs.existsSync(path.join(temp, 'alpha', app, 'next-only.txt')), `S2 ${app}'s alpha keeps its own files`);
    assert.ok(!fs.existsSync(path.join(temp, 'apps', app, 'next-only.txt')), `S2 ${app}'s root build starts from a fresh out/`);
  }
});

test('S3 release.yml\'s check and publish jobs stage the apps with --apps; deploy calls box-deploy.yml after publish, on a full release only, passing the hook; the triggers are kept', { skip: driftSkip('release-yml.patch') }, () => {
  applied('release-yml.patch');
  const w = yaml(head.read(REL));
  const was = yaml(show(REL));
  assert.deepEqual(w.on.release, was.on.release, 'S3 the release event is kept');
  assert.deepEqual(w.on.pull_request, { paths: [...was.on.pull_request.paths.slice(0, 1), DEP, ...was.on.pull_request.paths.slice(1)] }, 'S3 a pull request that changes box-deploy.yml runs release.yml too, the rest of its paths kept');
  assert.deepEqual(Object.keys(w.on).sort(), Object.keys(was.on).sort(), 'S3 no other trigger');
  assert.equal(w.on.release.types[0], 'published', 'S3 on release: published');
  for (const name of ['check', 'publish']) {
    const job = w.jobs[name];
    const dl = job.steps.filter((s) => s.uses === 'actions/download-artifact@v4').map((s) => s.with);
    assert.deepEqual(dl, [
      { pattern: 'alpha', 'merge-multiple': 'true', path: '${{ runner.temp }}/alpha' },
      { pattern: 'apps', 'merge-multiple': 'true', path: '${{ runner.temp }}/apps' },
    ], `S3 ${name} downloads alpha and apps`);
    const c = step(job, 'Check the package').run;
    assert.match(c, /^node test\/release\/package-check\.mjs .*--alpha "\$RUNNER_TEMP\/alpha" --apps "\$RUNNER_TEMP\/apps" --out "\$RUNNER_TEMP\/pack"/m, `S3 ${name}'s check passes --apps`);
  }
  const dep = w.jobs.deploy;
  assert.ok(dep, 'S3 a deploy job');
  assert.equal(dep.uses, './.github/workflows/box-deploy.yml', 'S3 deploy calls box-deploy.yml from this commit');
  assert.equal(dep.needs, 'publish', 'S3 deploy runs only after publish succeeds');
  assert.equal(dep.if, RELEASE_ONLY, 'S3 deploy runs only on a full release in this repository');
  assert.deepEqual(dep.permissions, { contents: 'read', actions: 'read' }, 'S3 the called job gets what box-deploy needs, no more');
  assert.deepEqual(dep.secrets, { RENDER_DEPLOY_HOOK: '${{ secrets.RENDER_DEPLOY_HOOK }}' }, 'S3 the hook passed by name, nothing inherited');
  assert.equal(dep.steps, undefined, 'S3 deploy has no steps of its own');
  assert.equal(dep['runs-on'], undefined, 'S3 deploy has no runner of its own');
  assert.equal(w.jobs.publish.environment, 'npm-publish', 'S3 publish is still in npm-publish');
  assert.deepEqual(Object.keys(w.jobs).sort(), ['build', 'check', 'deploy', 'publish'], 'S3 the jobs');
});

test('S4 box-deploy.yml takes workflow_call only, and a patch\'s minor is read from box-deploy.yml\'s runs and release.yml\'s deploy jobs; its step otherwise keeps every line', { skip: driftSkip('box-deploy-yml.patch') }, () => {
  applied('box-deploy-yml.patch');
  const w = yaml(head.read(DEP));
  const was = yaml(show(DEP));
  assert.deepEqual(w.on, { workflow_call: { secrets: { RENDER_DEPLOY_HOOK: { required: 'false' } } } }, 'S4 workflow_call is the one trigger, its release trigger removed');
  assert.equal(w.concurrency, undefined, 'S4 no workflow-level concurrency');
  const job = w.jobs.deploy;
  assert.deepEqual(job.concurrency, was.concurrency, 'S4 the same concurrency, on the job');
  assert.equal(job.if, "github.repository == 'sanctuarycomputer/devteam' && github.event_name == 'release' && !github.event.release.prerelease", 'S4 only for a full release event in this repository');
  assert.equal(job.environment, 'box', 'S4 still in the box environment');
  assert.deepEqual(job.permissions, was.jobs.deploy.permissions, 'S4 the same permissions');
  const r = step(job, 'Deploy the box at this release\'s commit');
  const r0 = step(was.jobs.deploy, 'Deploy the box at this release\'s commit');
  assert.deepEqual(r.env, r0.env, 'S4 the step reads the same event fields');
  assert.match(r.run, /gh run list --workflow box-deploy\.yml --commit "\$base" -L 100 --json event,conclusion/, 'S4 a patch still reads box-deploy.yml\'s runs (a minor before R)');
  assert.match(r.run, /gh run list --workflow release\.yml --commit "\$base" -L 100 --json databaseId,event/, 'S4 and release.yml\'s runs at its minor');
  assert.match(r.run, /select\(\.name == "deploy \/ deploy" and \.conclusion == "success"\)/, 'S4 counting only a successful deploy job, never a run that only published');
  const now = new Set(r.run.split('\n'));
  assert.deepEqual(r0.run.split('\n').filter((l) => !now.has(l)).map((l) => l.trim()), [
    'echo "refusing $TAG: cloud/Dockerfile isn\'t stamped and pinned for it; run box-pins bump --release $TAG in a release-prep PR, merge it, and publish the release again"',
    '# any box-deploy run at the minor\'s commit, for its release, that concluded success',
  ], 'S4 the step drops only the minor\'s old advice and a comment; every other line is kept');
  assert.deepEqual(job.steps.slice(0, -1), was.jobs.deploy.steps.slice(0, -1), 'S4 the steps before it are unchanged');
});

// a git repo of the tree's package files (package.json, README.md, docs/devteam/) and apps/<app>/package.json
// stubs, committed, from which the tree's own package-check runs
function treeRepo(name, { pkg, apps = ['dashboard', 'hub'], before } = {}) {
  const d = scratch(name);
  const repo = path.join(d, 'repo');
  fs.mkdirSync(repo);
  for (const f of ['package.json', 'README.md']) fs.copyFileSync(path.join(head.out, f), path.join(repo, f));
  fs.cpSync(path.join(head.out, 'docs', 'devteam'), path.join(repo, 'docs', 'devteam'), { recursive: true });
  if (pkg) fs.writeFileSync(path.join(repo, 'package.json'), `${JSON.stringify(pkg(JSON.parse(head.read('package.json'))), null, 2)}\n`);
  for (const a of apps) { fs.mkdirSync(path.join(repo, 'apps', a), { recursive: true }); fs.writeFileSync(path.join(repo, 'apps', a, 'package.json'), '{ "name": "app", "private": true }\n'); }
  before?.(repo);
  const g = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe', env });
  g('init', '-q', '-b', 'main');
  g('add', '-A');
  g('-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'tree');
  g('-c', 'tag.gpgsign=false', 'tag', 'v1.2.3');
  const home = path.join(d, 'home');
  fs.mkdirSync(home);
  return { d, repo, home };
}
// the fixture's out/ folders as a build job stages them, known types only (or keeping the rest)
function built(d, name, { apps = fs.readdirSync(AB), keepUnknown = false } = {}) {
  const a = path.join(d, name);
  for (const app of apps) fs.cpSync(path.join(AB, app, 'out'), path.join(a, app), { recursive: true });
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else if (!keepUnknown && !KNOWN.includes(path.extname(e.name).slice(1))) fs.rmSync(f); } };
  if (fs.existsSync(a)) walk(a);
  return a;
}
const list = (dir, prefix) => { const out = []; const walk = (abs, rel) => { for (const e of fs.readdirSync(abs, { withFileTypes: true })) { if (e.isDirectory()) walk(path.join(abs, e.name), `${rel}${e.name}/`); else out.push(`${prefix}${rel}${e.name}`); } }; walk(dir, ''); return out.sort(); };
// a .tgz of the given entries ({ name, body }), as release-workflow.test.mjs writes one
function tgz(entries) {
  const blocks = [];
  for (const e of entries) {
    const body = Buffer.from(e.body ?? '');
    const h = Buffer.alloc(512);
    h.write(e.name, 0, 100, 'utf8');
    h.write('0000644\0', 100);
    h.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
    h.write('0', 156);
    h.write('ustar\0', 257);
    h.write('00', 263);
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return zlib.gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
// a fake npm first on PATH: it runs the real npm, and after a real pack puts $FAKE_NPM_TGZ in its place
function fakeNpm(d) {
  const bin = path.join(d, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const realNpm = execFileSync('sh', ['-c', 'command -v npm'], { encoding: 'utf8', env }).trim();
  fs.writeFileSync(path.join(bin, 'npm'), `#!${process.execPath}
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const a = process.argv.slice(2);
const r = spawnSync(${JSON.stringify(realNpm)}, a, { encoding: 'utf8', env: process.env });
if (process.env.FAKE_NPM_TGZ && a[0] === 'pack' && !a.includes('--dry-run') && r.status === 0) { const d = a[a.indexOf('--pack-destination') + 1]; for (const f of fs.readdirSync(d)) if (f.endsWith('.tgz')) fs.copyFileSync(process.env.FAKE_NPM_TGZ, path.join(d, f)); }
process.stdout.write(r.stdout ?? ''); process.stderr.write(r.stderr ?? ''); process.exit(r.status ?? 1);
`, { mode: 0o755 });
  return bin;
}
function check(fx, args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [path.join(head.out, 'test', 'release', 'package-check.mjs'), '--tag', 'v1.2.3', '--out', path.join(fx.d, 'out'), ...args], { cwd: fx.repo, env: { ...env, HOME: fx.home, ...extraEnv }, encoding: 'utf8', timeout: 180_000 });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

test('S5 npm pack --dry-run of the tree lists cli.mjs, lib/**, the launcher and the built apps, and its package check packs it with no dependency', { skip: checkSkip() || driftSkip('package-json.patch') }, () => {
  checkWritten();
  applied('package-json.patch');
  const fx = treeRepo('pack');
  const alpha = built(fx.d, 'alpha');
  const apps = built(fx.d, 'apps');
  const r = check(fx, ['--alpha', alpha, '--apps', apps]);
  assert.equal(r.status, 0, `S5 the tree's package check packs layout 2 (${r.err})`);
  const files = fs.readFileSync(path.join(fx.d, 'out', 'files.txt'), 'utf8').trim().split('\n');
  const dry = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--no-update-notifier'], { cwd: fx.repo, env: { ...env, HOME: fx.home }, encoding: 'utf8', timeout: 180_000 });
  assert.equal(dry.status, 0, `S5 npm pack --dry-run runs (${dry.stderr})`);
  const listed = JSON.parse(dry.stdout)[0].files.map((f) => f.path).sort();
  assert.deepEqual(listed, files, 'S5 the dry run lists what the check packed');
  const lib = list(path.join(head.out, 'docs', 'devteam', 'scripts', 'lib'), 'docs/devteam/scripts/lib/');
  assert.ok(lib.length > 10, `S5 the tree has its modules (${lib.length})`);
  for (const f of ['docs/devteam/scripts/cli.mjs', 'docs/devteam/scripts/devteam.mjs', ...lib]) assert.ok(listed.includes(f), `S5 the dry run lists ${f}`);
  const wantApps = list(apps, 'docs/devteam/apps/');
  assert.ok(wantApps.some((f) => f.endsWith('hub/threads/one/index.html')), 'S5 the fixture\'s nested route is staged');
  assert.deepEqual(listed.filter((f) => f.startsWith('docs/devteam/apps/')), wantApps, 'S5 the dry run lists exactly the built apps under docs/devteam/apps/');
  assert.deepEqual(listed.filter((f) => f.startsWith('docs/devteam/alpha/')), list(alpha, 'docs/devteam/alpha/'), 'S5 and the alpha');
  const pkg = JSON.parse(fs.readFileSync(path.join(fx.repo, 'package.json'), 'utf8'));
  assert.deepEqual([pkg.dependencies, pkg.devDependencies, pkg.peerDependencies, pkg.optionalDependencies, pkg.bin, pkg.devteam], [{}, undefined, undefined, undefined, BIN, { layout: 2 }], 'S5 no dependency, the bin, layout 2');
  assert.match(r.out, /^ok: @sanctuarycomputer\/devteam@1\.2\.3, \d+ files, packed by npm /m, 'S5 the ok line');
});

test('S6 the tree\'s package check refuses a layout-2 package whose bin or apps are wrong, and --apps or a bin on layout 1', { skip: checkSkip() }, () => {
  checkWritten();
  const cases = [
    ['a bin naming another file', { pkg: (p) => ({ ...p, bin: { devteam: 'docs/devteam/scripts/devteam.mjs' } }) }, (fx) => ['--apps', built(fx.d, 'apps')], /^package-check: refusing: package\.json's bin is \{"devteam":"docs\/devteam\/scripts\/devteam\.mjs"\}: layout 2's is \{"devteam":"docs\/devteam\/scripts\/cli\.mjs"\}$/m],
    ['a bin on layout 1', { pkg: (p) => ({ ...p, devteam: { layout: 1 } }) }, () => [], /^package-check: refusing: package\.json declares a bin$/m],
    ['--apps on layout 1', { pkg: (p) => { const { bin: _b, ...q } = p; return { ...q, devteam: { layout: 1 } }; } }, (fx) => ['--apps', built(fx.d, 'apps')], /^package-check: refusing: --apps is for a layout-2 package/m],
    ['apps missing an app', {}, (fx) => ['--apps', built(fx.d, 'apps', { apps: ['hub'] })], /^package-check: refusing: the apps holds hub, but the tree's apps are dashboard, hub$/m],
    ['no apps for a tree that has them', {}, () => [], /^package-check: refusing: the apps holds no app, but the tree's apps are dashboard, hub$/m],
    ['an app file of an unknown type', {}, (fx) => ['--apps', built(fx.d, 'apps', { keepUnknown: true })], /^package-check: refusing: the apps's \S+ is of an unknown type/m],
    ['layout 2 without cli.mjs', { before: (repo) => fs.rmSync(path.join(repo, 'docs', 'devteam', 'scripts', 'cli.mjs')) }, (fx) => ['--apps', built(fx.d, 'apps')], /^package-check: refusing: the tree has no docs\/devteam\/scripts\/cli\.mjs, the bin layout 2 names$/m],
    ['a tree that tracks docs/devteam/apps/', { before: (repo) => { fs.mkdirSync(path.join(repo, 'docs', 'devteam', 'apps', 'hub'), { recursive: true }); fs.writeFileSync(path.join(repo, 'docs', 'devteam', 'apps', 'hub', 'index.html'), '<p>committed</p>\n'); } }, (fx) => ['--apps', built(fx.d, 'apps')], /^package-check: refusing: the tree already has docs\/devteam\/apps\/$/m],
  ];
  for (const [what, o, args, want] of cases) {
    const fx = treeRepo(what.replace(/\W+/g, '-'), o);
    const r = check(fx, ['--alpha', built(fx.d, 'alpha'), ...args(fx)]);
    assert.equal(r.status, 1, `S6 ${what}: refused (${r.err}${r.out.slice(-200)})`);
    assert.match(r.err, want, `S6 ${what}`);
    assert.ok(!fs.existsSync(path.join(fx.d, 'out', 'package.tgz')), `S6 ${what}: no package.tgz`);
  }
  // a tarball whose apps file differs from the staged one, or holds one never staged (spec-2 F2-1)
  for (const [what, entry, want] of [
    ['an apps file whose packed bytes differ', { name: 'package/docs/devteam/apps/dashboard/index.html', body: 'not the staged bytes' }, /^package-check: refusing: the tarball's docs\/devteam\/apps\/dashboard\/index\.html differs from the apps'$/m],
    ['an apps file packed but never staged', { name: 'package/docs/devteam/apps/hub/never.html', body: 'x' }, /^package-check: refusing: the tarball holds docs\/devteam\/apps\/hub\/never\.html, which the apps didn't stage$/m],
  ]) {
    const fx = treeRepo(what.replace(/\W+/g, '-'));
    const swap = path.join(fx.d, 'swap.tgz');
    fs.writeFileSync(swap, tgz([entry]));
    const r = check(fx, ['--alpha', built(fx.d, 'alpha'), '--apps', built(fx.d, 'apps')], { PATH: `${fakeNpm(fx.d)}${path.delimiter}${env.PATH}`, FAKE_NPM_TGZ: swap });
    assert.equal(r.status, 1, `S6 ${what}: refused (${r.err})`);
    assert.match(r.err, want, `S6 ${what}`);
    assert.ok(!fs.existsSync(path.join(fx.d, 'out', 'package.tgz')), `S6 ${what}: no package.tgz`);
  }
});

test('S7 with the whole overlay at HEAD, the conflict check is clean for this area, and each of its patches applies', { skip: SPLIT_SKIP }, () => {
  const all = fs.readdirSync(path.join(splitSrc, 'overlay'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  assert.ok(all.includes(AREA), 'S7 the area is in the overlay');
  const t = split(splitDir('all', all), sha, path.join(tmp, 'all'));
  assert.equal(t.r.status, 0, t.r.stderr);
  const conflicts = (t.j.overlay?.conflicts ?? []).filter((c) => c.areas.includes(AREA));
  assert.deepEqual(conflicts, [], 'S7 no conflict names this area');
  const drifted = Object.keys(PATCHES).filter((p) => driftSkip(p));
  for (const p of Object.keys(PATCHES)) {
    if (drifted.includes(p)) continue;
    assert.ok(items(mine(t.j, 'applied')).includes(`patch ${p}`), `S7 ${p} is applied with every area: ${JSON.stringify(mine(t.j, 'stale'))}`);
  }
  assert.ok(items(mine(t.j, 'applied')).includes(`file ${CHECK}`), `S7 ${CHECK} is written with every area: ${JSON.stringify(mine(t.j, 'stale'))}`);
  assert.deepEqual(mine(t.j, 'stale').filter((s) => !drifted.includes(s.name)), [], 'S7 nothing of the area is stale');
});

// ---- box-deploy.yml's step, run as Actions runs it, in a repo tagged v9.1.0 (the minor a patch builds
// on). node stands in for box-pins (verify exits $VERIFY, changed exits 0: nothing the image runs
// changed); gh answers each run list from $RUNS_BOX or $RUNS_REL by --workflow, and run view from $JOBS;
// curl notes a call and answers 200. ----
function deployStep(env) {
  const d = scratch('deploy');
  const repo = path.join(d, 'repo');
  fs.mkdirSync(repo);
  const g = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe', env });
  g('init', '-q', '-b', 'main');
  g('-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'v9.1.0');
  g('-c', 'tag.gpgsign=false', 'tag', 'v9.1.0');
  const bin = path.join(d, 'bin');
  fs.mkdirSync(bin);
  const shim = (n, body) => fs.writeFileSync(path.join(bin, n), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  shim('node', '[ "$2 $3" = "box-pins verify" ] && exit "${VERIFY:-0}"\n[ "$2 $3" = "box-pins changed" ] && exit 0\nexit 9');
  shim('gh', 'echo "$*" >> "$CALLS"\ncase "$1 $2" in\n  "run list") case " $* " in *" --workflow box-deploy.yml "*) printf %s "$RUNS_BOX" ;; *" --workflow release.yml "*) printf %s "$RUNS_REL" ;; *) exit 1 ;; esac ;;\n  "run view") printf %s "$JOBS" ;;\n  *) exit 1 ;;\nesac');
  shim('curl', 'echo "$*" >> "$CURLS"\necho 200');
  const w = yaml(head.read(DEP));
  const file = path.join(d, 'step.sh');
  fs.writeFileSync(file, step(w.jobs.deploy, 'Deploy the box at this release\'s commit').run);
  const sha = g('rev-parse', 'HEAD').toString().trim();
  const e = { ...process.env, ...env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, SHA: sha, PUBLISHED: '2026-06-01T00:00:00Z', HOOK: 'https://hook.invalid/deploy', GH_TOKEN: 'fake', GH_REPO: 'sanctuarycomputer/devteam', CALLS: path.join(d, 'calls'), CURLS: path.join(d, 'curls'), RUNS_BOX: env.RUNS_BOX ?? '[]', RUNS_REL: env.RUNS_REL ?? '[]', JOBS: env.JOBS ?? '{"jobs":[]}' };
  for (const k of Object.keys(e)) if (/^(DEVTEAM_|GITHUB_|TMUX)/.test(k)) delete e[k];
  const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', file], { cwd: repo, env: e, encoding: 'utf8', timeout: 60_000 });
  const read = (n) => (fs.existsSync(path.join(d, n)) ? fs.readFileSync(path.join(d, n), 'utf8') : '');
  return { status: r.status, out: r.stdout + r.stderr, calls: read('calls'), curls: read('curls') };
}

test('S10 box-deploy\'s step: a patch lands when its minor deployed by box-deploy.yml or by release.yml\'s deploy job, never on a release run that only published; a minor that fails its stamp check is told to cut the next minor', { skip: driftSkip('box-deploy-yml.patch') }, () => {
  applied('box-deploy-yml.patch');
  const ok = { event: 'release', conclusion: 'success' };
  const jobs = (...js) => JSON.stringify({ jobs: js });
  const cases = [
    ['a minor box-deploy.yml deployed (before R)', { RUNS_BOX: JSON.stringify([ok]) }, 0, /^v9\.1\.1 is a patch: nothing the box image runs/m],
    ['a minor release.yml\'s deploy job deployed (R on)', { RUNS_REL: JSON.stringify([{ databaseId: 7, event: 'release' }]), JOBS: jobs({ name: 'publish', conclusion: 'success' }, { name: 'deploy / deploy', conclusion: 'success' }) }, 0, /^v9\.1\.1 is a patch/m],
    ['a release run that only published (before R)', { RUNS_REL: JSON.stringify([{ databaseId: 7, event: 'release' }]), JOBS: jobs({ name: 'build', conclusion: 'success' }, { name: 'publish', conclusion: 'success' }) }, 1, /^refusing v9\.1\.1: v9\.1\.0 never deployed, so the box isn't on it; cut v9\.2\.0$/m],
    ['a deploy job that failed', { RUNS_REL: JSON.stringify([{ databaseId: 7, event: 'release' }]), JOBS: jobs({ name: 'deploy / deploy', conclusion: 'failure' }) }, 1, /never deployed/],
    ['a pull_request run\'s deploy job', { RUNS_REL: JSON.stringify([{ databaseId: 7, event: 'pull_request' }]), JOBS: jobs({ name: 'deploy / deploy', conclusion: 'success' }) }, 1, /never deployed/],
  ];
  for (const [what, env, status, want] of cases) {
    const r = deployStep({ TAG: 'v9.1.1', ...env });
    assert.equal(r.status, status, `S10 ${what}: exit ${status} (${r.out})`);
    assert.match(r.out, want, `S10 ${what}`);
    assert.equal(r.curls, '', `S10 ${what}: a patch never calls the hook`);
  }
  const m = deployStep({ TAG: 'v9.2.0', VERIFY: '1' });
  assert.equal(m.status, 1, `S10 a minor whose stamp fails: exit 1 (${m.out})`);
  assert.match(m.out, /^refusing v9\.2\.0: cloud\/Dockerfile isn't stamped and pinned for it, and its package is already published, so it can't be published again; run box-pins bump --release v9\.3\.0 in a release-prep PR, merge it, and cut v9\.3\.0$/m, 'S10 a minor whose stamp fails is told to cut the next minor');
  assert.doesNotMatch(m.out, /publish the release again/, 'S10 never "publish the release again", which npm would refuse');
  assert.equal(m.curls, '', 'S10 a refused minor never calls the hook');
});

test('S11 the ledger entry accepts the area\'s package-check.mjs: its file and ticket, the copy\'s sha256, and HEAD\'s text as its source', { skip: checkSkip() }, () => {
  checkWritten();
  const entry = JSON.parse(fs.readFileSync(ENTRY, 'utf8'));
  assert.deepEqual(Object.keys(entry).sort(), ['file', 'sha256', 'source_sha256', 'ticket'], 'S11 the entry\'s fields');
  assert.equal(entry.file, CHECK, 'S11 the file');
  assert.equal(entry.ticket, 'kit-969-overlay-release', 'S11 the ticket that makes the change');
  assert.equal(entry.sha256, sha256(head.read(CHECK)), 'S11 sha256 is the tree\'s text');
  assert.equal(entry.source_sha256, sha256(show(CHECK)), 'S11 source_sha256 is HEAD\'s text');
  // parity's own judge, with a history in which this ticket merged and its diff wrote the copy and the
  // entry (spec-2 F2-2): a change to parity's rules that would refuse the entry turns this red
  const diff = [`test/split/overlay/${AREA}/files/${CHECK}`, 'test/split/ledger/tests/release/package-check.mjs.json'];
  const hist = { shallow: false, merged: (id) => id === 'kit-969-overlay-release', diffOf: (id) => (id === 'kit-969-overlay-release' ? diff : []) };
  const read = (rel) => { try { return { entry: JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')) }; } catch { return { none: true }; } };
  const verdict = judgeTest({ file: CHECK, treeText: head.read(CHECK), sourceText: show(CHECK), read, hist });
  assert.deepEqual(verdict, { accepted: true, ticket: 'kit-969-overlay-release' }, `S11 parity's judgeTest accepts the entry: ${verdict.why}`);
});
