// apps-try (kit-1022): test/split/apps-try.mjs runs the named test files against the built apps in a
// tree at HEAD, kept in the checkout's .apps-try/. Every case runs it on a fixture repository with a
// fake split (the commit's files, as git archive writes them), a fake build (an out/ and lib-dist/ naming
// the app) and a node that records its arguments, so nothing here builds an app or splits the kit.
// The lock lives in this file's own temp folder, never the machine's. The cases that run the command
// itself (L4, L5) run a copy of it in a fixture checkout whose split.mjs is the fake, so even a broken
// lock wait splits nothing real.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appsTry, Failure, LOCK_NAME, Refusal } from './split/apps-try.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tool = path.join(root, 'test', 'split', 'apps-try.mjs');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'split-apps-try-')));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GIT_|DEVTEAM_|TMUX)/.test(k)));
// maintenance.auto false: from git 2.47 a commit's automatic maintenance runs detached and outlives the
// command, so a fixture commit would leave a git process writing in a folder this file copies or removes
const git = (cwd, ...a) => { const r = spawnSync('git', ['-c', 'maintenance.auto=false', '-C', cwd, ...a], { encoding: 'utf8', env: base }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// ---- the fixture repository ----
const repo = path.join(tmp, 'repo');
const lockDir = path.join(tmp, 'locks');
const lock = path.join(lockDir, LOCK_NAME);
const probes = path.join(tmp, 'probes');
const splitLog = path.join(tmp, 'split.log');
const nodeLog = path.join(tmp, 'node.log');
fs.mkdirSync(lockDir);
fs.mkdirSync(probes);
// a test file in the fixture: records what it saw (its env, the lock, the served build), then passes
const probe = (name, { fail = false } = {}) => `import fs from 'node:fs';
import { test } from 'node:test';
test('${name}', () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(DEVTEAM_|GIT_|TMUX)/.test(k)));
  const lock = fs.existsSync(process.env.FAKE_LOCK) ? JSON.parse(fs.readFileSync(process.env.FAKE_LOCK, 'utf8')) : null;
  const served = fs.existsSync('docs/devteam/apps/dashboard/index.html') ? fs.readFileSync('docs/devteam/apps/dashboard/index.html', 'utf8') : null;
  fs.writeFileSync(process.env.PROBE_DIR + '/${name}.json', JSON.stringify({ env, home: process.env.HOME, cwd: process.cwd(), lock, served }));
  ${fail ? "throw new Error('fails on purpose');" : ''}
});
`;
write(path.join(repo, 'apps/dashboard/package.json'), '{ "name": "d" }\n');
write(path.join(repo, 'apps/dashboard/package-lock.json'), '{ "lock": 1 }\n');
write(path.join(repo, 'apps/dashboard/.gitignore'), 'node_modules/\n.next/\nout/\nlib-dist/\n');
write(path.join(repo, 'apps/dashboard/src/app/page.tsx'), 'export default 1;\n');
write(path.join(repo, 'apps/dashboard/src/shared/paths.ts'), 'export const a = 1;\n');
write(path.join(repo, 'apps/dashboard/scripts/csp-hashes.mjs'), '// hashes\n');
write(path.join(repo, 'apps/hub/package.json'), '{ "name": "h" }\n');
write(path.join(repo, 'apps/hub/package-lock.json'), '{ "lock": 1 }\n');
write(path.join(repo, 'apps/hub/.gitignore'), 'node_modules/\n.next/\nout/\nlib-dist/\n');
write(path.join(repo, 'apps/hub/src/app/page.tsx'), 'export default 2;\n');
write(path.join(repo, 'test/a.test.mjs'), probe('a'));
write(path.join(repo, 'test/b.test.mjs'), probe('b'));
write(path.join(repo, 'test/fail.test.mjs'), probe('fail', { fail: true }));
git(tmp, 'init', '-q', '-b', 'main', repo);
const commit = (msg) => { git(repo, 'add', '-A'); git(repo, '-c', 'user.name=t', '-c', 'user.email=t@localhost', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', msg); return git(repo, 'rev-parse', 'HEAD'); };
commit('fixture');

// the fake split, in a folder of its own (apps-try keys the tree on that folder's files too): the commit's
// files into --out, one log line with the lock it saw, an empty stale list
const splitDir = path.join(tmp, 'split-tool');
const fakeSplit = path.join(splitDir, 'split.mjs');
const fakeSplitText = `import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const a = process.argv.slice(2);
const opt = (n) => a[a.indexOf('--' + n) + 1];
const out = opt('out');
fs.mkdirSync(out);
const tar = spawnSync('git', ['-C', opt('repo'), 'archive', '--format=tar', opt('at')]);
spawnSync('tar', ['-x', '-f', '-', '-C', out], { input: tar.stdout });
const lock = fs.existsSync(process.env.FAKE_LOCK) ? JSON.parse(fs.readFileSync(process.env.FAKE_LOCK, 'utf8')) : null;
fs.appendFileSync(process.env.FAKE_SPLIT_LOG, JSON.stringify({ at: opt('at'), lock }) + '\\n');
process.stdout.write(JSON.stringify({ stale: [] }));
`;
write(fakeSplit, fakeSplitText);
write(path.join(splitDir, 'overlay', 'rule.txt'), 'one\n');
// the recording node: its arguments, then the real node
const fakeNode = path.join(tmp, 'fake-node.sh');
write(fakeNode, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${nodeLog}'\nexec '${process.execPath}' "$@"\n`);
fs.chmodSync(fakeNode, 0o755);

// the fake build: out/ and lib-dist/ naming the app and its source key; node_modules when it installs
let builds = [];
let failBuild = null;
const fakeBuild = ({ app, dir, install, env }) => {
  const held = fs.existsSync(lock) ? readJson(lock) : null;
  builds.push({ app, install, lock: held, base: env.DEVTEAM_BASE_PATH });
  if (failBuild === app) return { ok: false, why: 'fails on purpose' };
  if (install) write(path.join(dir, 'node_modules/.installed'), `${builds.length}\n`);
  write(path.join(dir, 'out/index.html'), `${app} built ${builds.length}\n`);
  write(path.join(dir, 'lib-dist/x.js'), `export const app = '${app}';\n`);
  return { ok: true };
};

const realHome = path.join(tmp, 'real-home');
fs.mkdirSync(realHome);
const env = { ...base, HOME: realHome, DEVTEAM_HUB_PORT: '4320', DEVTEAM_RUN: '/nowhere/run', DEVTEAM_TICKET: 'kit-x', GIT_DIR: '/nowhere/.git', TMUX: '/tmp/tmux-x/default,1,0', TMUX_PANE: '%1', FAKE_LOCK: lock, FAKE_SPLIT_LOG: splitLog, PROBE_DIR: probes };
let said = [];
const tryIt = (argv, o = {}) => { said = []; return appsTry({ argv, repo, cwd: repo, split: fakeSplit, build: fakeBuild, node: fakeNode, tmpdir: lockDir, env, say: (s) => said.push(s), stdio: 'ignore', pollMs: 50, ...o }); };
const tree = path.join(repo, '.apps-try', 'tree');
// a run that should end: 'still waiting' after ms instead of hanging the file
const within = (p, ms = 10000) => Promise.race([p, new Promise((r) => setTimeout(() => r('still waiting'), ms).unref())]);
const clearProbes = () => { for (const f of fs.readdirSync(probes)) fs.rmSync(path.join(probes, f)); };

test('R1 refuses with no file named, before writing anything or taking the lock', async () => {
  await assert.rejects(tryIt([]), (e) => e instanceof Refusal && /name the test files to run/.test(e.message));
  assert.equal(fs.existsSync(path.join(repo, '.apps-try')), false);
  assert.equal(fs.existsSync(lock), false);
  assert.equal(lines(splitLog).length, 0);
  // the command itself: exit 2, the same words
  const r = spawnSync(process.execPath, [tool], { encoding: 'utf8', env: { ...base, TMPDIR: lockDir }, cwd: tmp });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^apps-try: name the test files to run/);
  assert.equal(fs.existsSync(lock), false);
  // a copy outside any checkout: still the same refusal, before git is asked anything
  const outside = path.join(tmp, 'outside', 'test', 'split');
  write(path.join(outside, 'apps-try.mjs'), fs.readFileSync(tool));
  write(path.join(outside, 'parity.mjs'), fs.readFileSync(path.join(root, 'test/split/parity.mjs')));
  const o = spawnSync(process.execPath, [path.join(outside, 'apps-try.mjs')], { encoding: 'utf8', env: { ...base, TMPDIR: lockDir, GIT_CEILING_DIRECTORIES: tmp }, cwd: tmp });
  assert.equal(o.status, 2, o.stderr);
  assert.match(o.stderr, /^apps-try: name the test files to run/, 'refused for no file, not for the missing checkout');
});

test('R2 refuses an option, a file outside the checkout, and a file not in the tree', async () => {
  await assert.rejects(tryIt(['--all']), (e) => e instanceof Refusal && /unknown option --all/.test(e.message));
  await assert.rejects(tryIt(['../x.test.mjs']), (e) => e instanceof Refusal && /outside this checkout/.test(e.message));
  await assert.rejects(tryIt(['test']), (e) => e instanceof Refusal && /not a file in the tree/.test(e.message));
  assert.equal(fs.existsSync(lock), false, 'the lock is released after a refusal');
  await assert.rejects(tryIt(['.apps-try/tree/test/a.test.mjs']), (e) => e instanceof Refusal && /inside \.apps-try\//.test(e.message));
  await assert.rejects(tryIt(['test/none.test.mjs']), (e) => e instanceof Refusal && /not a file in the tree.*test\/none\.test\.mjs/.test(e.message));
  assert.equal(fs.existsSync(lock), false, 'the lock is released after a refusal');
  // reset: this case's runs built the first tree; the cases below start from none
  fs.rmSync(path.join(repo, '.apps-try'), { recursive: true, force: true });
  fs.rmSync(splitLog, { force: true });
  builds = [];
});

test('B1 the first run builds a tree for HEAD in .apps-try/, excluded, a repository of its own, both apps built', async () => {
  const head = git(repo, 'rev-parse', 'HEAD');
  assert.equal(await tryIt(['test/a.test.mjs']), 0, said.join('\n'));
  assert.deepEqual(lines(splitLog).map((l) => l.at), [head]);
  assert.deepEqual(builds.map((b) => [b.app, b.install]), [['dashboard', true], ['hub', true]]);
  assert.ok(builds.every((b) => b.base === ''), 'built with DEVTEAM_BASE_PATH empty');
  assert.equal(readJson(path.join(repo, '.apps-try', 'state.json')).sha, head);
  assert.equal(fs.readFileSync(path.join(tree, 'docs/devteam/apps/dashboard/index.html'), 'utf8'), 'dashboard built 1\n');
  assert.ok(fs.existsSync(path.join(tree, 'docs/devteam/apps/hub/index.html')));
  assert.equal(git(tree, 'rev-parse', '--show-toplevel'), tree, 'the tree is a repository of its own');
  const exclude = path.resolve(repo, git(repo, 'rev-parse', '--git-path', 'info/exclude'));
  assert.ok(fs.readFileSync(exclude, 'utf8').split('\n').includes('/.apps-try/'));
  assert.equal(git(repo, 'status', '--porcelain'), '', '.apps-try/ is not seen by git');
  assert.equal(readJson(path.join(probes, 'a.json')).served, 'dashboard built 1\n', 'the test saw the built app');
});

test('B2 a second run at the same HEAD reuses the tree and builds nothing', async () => {
  const before = lines(splitLog).length;
  builds = [];
  assert.equal(await tryIt(['test/a.test.mjs']), 0, said.join('\n'));
  assert.equal(lines(splitLog).length, before, 'no split');
  assert.deepEqual(builds, [], 'no build');
  assert.ok(said.some((s) => /reusing the tree/.test(s)));
});

test('B3 a new HEAD changing only the hub regenerates the tree and rebuilds only the hub, on the kept node_modules', async () => {
  write(path.join(repo, 'apps/hub/src/app/page.tsx'), 'export default 3;\n');
  const head = commit('hub only');
  builds = [];
  assert.equal(await tryIt(['test/a.test.mjs']), 0, said.join('\n'));
  assert.equal(lines(splitLog).at(-1).at, head);
  assert.deepEqual(builds.map((b) => [b.app, b.install]), [['hub', false]]);
  assert.equal(fs.readFileSync(path.join(tree, 'docs/devteam/apps/dashboard/index.html'), 'utf8'), 'dashboard built 1\n', 'the dashboard came over');
  assert.ok(fs.existsSync(path.join(tree, 'apps/dashboard/lib-dist/x.js')), 'its lib-dist came over');
});

test('B3b a new lockfile installs again: npm ci is skipped only on the same lockfile', async () => {
  write(path.join(repo, 'apps/hub/package-lock.json'), '{ "lock": 2 }\n');
  commit('hub lockfile');
  builds = [];
  assert.equal(await tryIt(['test/a.test.mjs']), 0, said.join('\n'));
  assert.deepEqual(builds.map((b) => [b.app, b.install]), [['hub', true]]);
});

test('B4 a change to the shared code or the build scripts rebuilds both apps; a change to a test alone rebuilds none', async () => {
  write(path.join(repo, 'apps/dashboard/src/shared/paths.ts'), 'export const a = 2;\n');
  commit('shared');
  builds = [];
  assert.equal(await tryIt(['test/a.test.mjs']), 0, said.join('\n'));
  assert.deepEqual(builds.map((b) => b.app), ['dashboard', 'hub']);
  write(path.join(repo, 'apps/dashboard/scripts/csp-hashes.mjs'), '// hashes, changed\n');
  commit('scripts');
  builds = [];
  assert.equal(await tryIt(['test/a.test.mjs']), 0, said.join('\n'));
  assert.deepEqual(builds.map((b) => b.app), ['dashboard', 'hub'], 'both builds run the dashboard\'s scripts');
  write(path.join(repo, 'test/b.test.mjs'), `${probe('b')}// changed\n`);
  const head = commit('test only');
  builds = [];
  assert.equal(await tryIt(['test/a.test.mjs']), 0, said.join('\n'));
  assert.equal(lines(splitLog).at(-1).at, head, 'the tree is regenerated');
  assert.deepEqual(builds, []);
});

test('B6 an uncommitted change to the split tool\'s folder (its overlay) regenerates the tree at the same HEAD', async () => {
  const before = lines(splitLog).length;
  write(path.join(splitDir, 'overlay', 'rule.txt'), 'two\n');
  assert.equal(await tryIt(['test/a.test.mjs']), 0, said.join('\n'));
  assert.equal(lines(splitLog).length, before + 1, 'regenerated');
  assert.equal(await tryIt(['test/a.test.mjs']), 0, said.join('\n'));
  assert.equal(lines(splitLog).length, before + 1, 'then reused');
});

test('B5 a failed build runs no test, exits through Failure, and is built again next time', async () => {
  write(path.join(repo, 'apps/hub/src/app/page.tsx'), 'export default 4;\n');
  commit('hub again');
  builds = [];
  failBuild = 'hub';
  clearProbes();
  await assert.rejects(tryIt(['test/a.test.mjs']), (e) => e instanceof Failure && /hub: fails on purpose/.test(e.message));
  assert.equal(fs.existsSync(path.join(probes, 'a.json')), false, 'no test ran');
  failBuild = null;
  builds = [];
  assert.equal(await tryIt(['test/a.test.mjs']), 0, said.join('\n'));
  assert.deepEqual(builds.map((b) => b.app), ['hub']);
});

test('B7 a reused tree whose served build is gone builds that app again', async () => {
  fs.rmSync(path.join(tree, 'docs/devteam/apps/hub'), { recursive: true });
  const before = lines(splitLog).length;
  builds = [];
  assert.equal(await tryIt(['test/a.test.mjs']), 0, said.join('\n'));
  assert.equal(lines(splitLog).length, before, 'the tree is reused');
  assert.deepEqual(builds.map((b) => b.app), ['hub'], 'only the app with no served build');
  assert.ok(fs.existsSync(path.join(tree, 'docs/devteam/apps/hub/index.html')));
});

test('B8 the tree\'s commit leaves no git maintenance running, even when git\'s config gives it work, so the tree is built whole', async () => {
  // from git 2.47 the snapshot's commit starts its automatic maintenance detached; this config gives that
  // maintenance real work (packing the loose objects, then deleting them) while apps-try copies and
  // removes the folder (kit-1060). parity's snapshot runs git with this process's own environment.
  const busy = path.join(tmp, 'busy-home');
  write(path.join(busy, '.gitconfig'), '[maintenance "loose-objects"]\n\tenabled = true\n\tauto = 1\n');
  // three new HEADs in a row (a test file only, so no app builds): the race, where there is one, hits
  // about half of the regenerations. A fourth runs the commit's maintenance in the foreground
  // (maintenance.autoDetach, git 2.47 and later; older gits always do), so on any git a maintenance that
  // ran has packed before the copy, and the no-pack assertion sees it (kit-1072)
  const was = process.env.HOME;
  process.env.HOME = busy;
  try {
    for (const n of [1, 2, 3, 4]) {
      if (n === 4) fs.appendFileSync(path.join(busy, '.gitconfig'), '[maintenance]\n\tautoDetach = false\n');
      write(path.join(repo, 'test/b.test.mjs'), `${probe('b')}// B8 ${n}\n`);
      const head = commit(`B8 ${n}`);
      assert.equal(await tryIt(['test/a.test.mjs']), 0, said.join('\n'));
      assert.equal(lines(splitLog).at(-1).at, head, 'the tree is regenerated');
      // no pack: this config packs the loose objects whenever the commit's maintenance runs, so a pack
      // in the tree means maintenance.auto false came after the snapshot's commit, not before (kit-1072);
      // a new repository's objects/pack is there and empty
      assert.deepEqual(fs.readdirSync(path.join(tree, '.git', 'objects', 'pack')).filter((f) => f.endsWith('.pack')), [], `the snapshot's commit ran no maintenance: the tree holds no pack (regeneration ${n})`);
    }
  } finally { if (was === undefined) delete process.env.HOME; else process.env.HOME = was; }
  // --local: the tree's own config, so a user's global maintenance.auto doesn't pass it
  const r = spawnSync('git', ['-C', tree, 'config', '--local', '--get', 'maintenance.auto'], { encoding: 'utf8', env: base });
  assert.equal(r.stdout.trim(), 'false', 'the tree\'s repository has automatic maintenance off');
});

test('N1 runs only the named files, with --test-concurrency=2, from the tree', async () => {
  clearProbes();
  fs.rmSync(nodeLog, { force: true });
  assert.equal(await tryIt(['test/a.test.mjs']), 0, said.join('\n'));
  assert.deepEqual(fs.readFileSync(nodeLog, 'utf8').trim().split('\n'), ['--test --test-concurrency=2 test/a.test.mjs']);
  assert.ok(fs.existsSync(path.join(probes, 'a.json')));
  assert.equal(fs.existsSync(path.join(probes, 'b.json')), false, 'b was not named, so it did not run');
  assert.equal(readJson(path.join(probes, 'a.json')).cwd, tree);
});

test('N2 the tests get a scratch HOME (removed after), hub port 4987, and no inherited DEVTEAM_*, GIT_* or TMUX', async () => {
  clearProbes();
  assert.equal(await tryIt(['test/a.test.mjs']), 0, said.join('\n'));
  const p = readJson(path.join(probes, 'a.json'));
  assert.notEqual(p.home, realHome);
  assert.ok(p.home.startsWith(path.join(lockDir, 'devteam-apps-try-home-')), p.home);
  assert.equal(fs.existsSync(p.home), false, 'the scratch HOME is removed');
  assert.deepEqual(p.env, { DEVTEAM_HUB_PORT: '4987' });
});

test('N3 a failing test file fails the run with its own status', async () => {
  assert.equal(await tryIt(['test/fail.test.mjs']), 1);
});

test('L1 holds the lock while it splits, builds and runs, and releases it after', async () => {
  write(path.join(repo, 'apps/dashboard/src/app/page.tsx'), 'export default 5;\n');
  commit('dashboard');
  builds = [];
  clearProbes();
  assert.equal(await tryIt(['test/a.test.mjs']), 0, said.join('\n'));
  assert.equal(lines(splitLog).at(-1).lock?.pid, process.pid, 'held while it split');
  assert.equal(builds[0].lock?.pid, process.pid, 'held while it built');
  assert.equal(readJson(path.join(probes, 'a.json')).lock?.pid, process.pid, 'held while the tests ran');
  assert.equal(fs.existsSync(lock), false, 'released');
});

test('L2 waits while another live apps-try holds the lock, and goes on once it is released', async () => {
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    fs.writeFileSync(lock, JSON.stringify({ pid: holder.pid, started: 'then', cwd: '/elsewhere' }));
    write(path.join(repo, 'test/a.test.mjs'), `${probe('a')}// L2\n`);
    const head = commit('L2');
    const p = tryIt(['test/a.test.mjs']);
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(said.some((s) => s.includes(`waiting for the apps-try holding ${lock} (pid ${holder.pid}`)), said.join('\n'));
    assert.notEqual(lines(splitLog).at(-1).at, head, 'nothing split while it waits');
    fs.unlinkSync(lock);
    assert.equal(await within(p), 0, said.join('\n'));
    assert.equal(lines(splitLog).at(-1).at, head);
  } finally { holder.kill('SIGKILL'); }
});

test('L3 takes over a lock whose holder is gone', async () => {
  const gone = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;
  fs.writeFileSync(lock, JSON.stringify({ pid: Number(gone), started: 'then', cwd: '/elsewhere' }));
  assert.equal(await within(tryIt(['test/a.test.mjs'])), 0, said.join('\n'));
  assert.ok(said.some((s) => s.includes(`pid ${gone} is gone`)), said.join('\n'));
  assert.equal(fs.existsSync(lock), false);
});

test('I1 a tree.new left by an interrupted run is removed, and a missing state regenerates the tree', async () => {
  fs.mkdirSync(path.join(repo, '.apps-try', 'tree.new', 'x'), { recursive: true });
  fs.rmSync(path.join(repo, '.apps-try', 'state.json'));
  const before = lines(splitLog).length;
  builds = [];
  assert.equal(await tryIt(['test/a.test.mjs']), 0, said.join('\n'));
  assert.equal(lines(splitLog).length, before + 1, 'regenerated');
  assert.deepEqual(builds.map((b) => b.app), ['dashboard', 'hub'], 'with no state, nothing is carried');
  assert.equal(fs.existsSync(path.join(repo, '.apps-try', 'tree.new')), false);
  assert.equal(fs.existsSync(path.join(tree, 'x')), false, 'nothing of the old tree.new is in the tree');
});

// the command as a developer runs it, in a fixture checkout: this apps-try and parity.mjs beside the fake
// split, a test file that records its pid and its runner's, then waits
const cliRepo = path.join(tmp, 'cli-repo');
write(path.join(cliRepo, 'test/split/apps-try.mjs'), fs.readFileSync(tool));
write(path.join(cliRepo, 'test/split/parity.mjs'), fs.readFileSync(path.join(root, 'test/split/parity.mjs')));
write(path.join(cliRepo, 'test/split/split.mjs'), fakeSplitText);
write(path.join(cliRepo, 'test/slow.test.mjs'), `import fs from 'node:fs';
import { test } from 'node:test';
test('slow', async () => {
  fs.writeFileSync(process.env.PROBE_DIR + '/slow.json', JSON.stringify({ pid: process.pid, ppid: process.ppid, home: process.env.HOME }));
  await new Promise((r) => setTimeout(r, 60000));
});
`);
git(tmp, 'init', '-q', '-b', 'main', cliRepo);
git(cliRepo, 'add', '-A');
git(cliRepo, '-c', 'user.name=t', '-c', 'user.email=t@localhost', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'cli fixture');
const cliEnv = { ...base, TMPDIR: lockDir, FAKE_LOCK: lock, FAKE_SPLIT_LOG: path.join(tmp, 'cli-split.log'), PROBE_DIR: probes };
const startCli = () => {
  // its own process group, so the whole of it goes when the case ends, whatever it started
  const cli = spawn(process.execPath, [path.join(cliRepo, 'test/split/apps-try.mjs'), 'test/slow.test.mjs'], { cwd: cliRepo, env: cliEnv, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  cli.err = '';
  cli.stderr.on('data', (d) => { cli.err += d; });
  cli.done = new Promise((r) => cli.on('exit', (code, signal) => r({ code, signal })));
  return cli;
};
const until = async (f, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end && !f()) await new Promise((r) => setTimeout(r, 50)); return f(); };

test('L4 the command takes its lock at <os tmpdir>/devteam-apps-try.lock: it waits there on a live holder, and a signal while it waits leaves nothing of its own', async () => {
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  // the lock is the holder's before the command starts
  fs.writeFileSync(lock, JSON.stringify({ pid: holder.pid, started: 'then', cwd: '/elsewhere' }));
  const cli = startCli();
  try {
    await until(() => cli.err.includes('waiting for'));
    assert.match(cli.err, new RegExp(`waiting for the apps-try holding ${lock.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(pid ${holder.pid}`));
    assert.equal(fs.existsSync(path.join(tmp, 'cli-split.log')), false, 'nothing split while it waits');
    // a signal while it waits: it goes, leaving the holder's lock and no file of its own
    process.kill(cli.pid, 'SIGTERM');
    const end = await Promise.race([cli.done, new Promise((r) => setTimeout(() => r('still running'), 10000))]);
    assert.deepEqual(end, { code: 143, signal: null }, cli.err);
    assert.deepEqual(fs.readdirSync(lockDir).filter((f) => f.startsWith(`${LOCK_NAME}.`)), [], 'no pending lock file left');
    assert.equal(readJson(lock).pid, holder.pid, 'the holder\'s lock is untouched');
  } finally {
    try { process.kill(-cli.pid, 'SIGKILL'); } catch {}
    holder.kill('SIGKILL');
    fs.rmSync(lock, { force: true });
  }
});

test('L5 a SIGTERM during the run stops the test run, releases the lock, removes the scratch HOME, and exits 143', async () => {
  clearProbes();
  const cli = startCli();
  try {
    assert.ok(await until(() => fs.existsSync(path.join(probes, 'slow.json'))), `the test never started:\n${cli.err}`);
    assert.equal(readJson(lock).pid, cli.pid, 'the command holds the lock while its test runs');
    const { ppid, home } = readJson(path.join(probes, 'slow.json'));
    assert.ok(fs.existsSync(home), 'the scratch HOME is there while the test runs');
    process.kill(cli.pid, 'SIGTERM');
    const end = await Promise.race([cli.done, new Promise((r) => setTimeout(() => r('still running'), 10000))]);
    assert.deepEqual(end, { code: 143, signal: null }, cli.err);
    assert.equal(fs.existsSync(lock), false, 'released');
    assert.equal(fs.existsSync(home), false, 'the scratch HOME is removed');
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    assert.ok(await until(() => !alive(ppid), 5000), 'the test runner was stopped');
  } finally {
    try { process.kill(-cli.pid, 'SIGKILL'); } catch {}
    fs.rmSync(lock, { force: true });
  }
});
